import "server-only";

import type {
  DiscoveryCandidateKind,
  Evidence,
  EvidenceHash,
  EvidenceLocation,
  OrganisationId,
} from "@council/canonical-contracts";
import {
  REVIEW_STATE,
  asReviewSubjectId,
  type ReviewAuditEvent,
  type ReviewState,
  type ReviewSubjectId,
} from "@council/governance-review";

import { canonicalStringify, privilegedDb, sha256Hex } from "./persistence";
import { governanceReviewPersistence } from "./persistence";

/**
 * Governance Workspace read side (CQRS query path). Server-only: never
 * imported by client components. Every query here is explicitly filtered by
 * organisationId — the privileged Supabase client bypasses RLS as
 * service_role (RLS only restricts by *role*, not by tenant, exactly as in
 * apps/dashboard/lib/governance/persistence.ts), so this explicit filter is
 * the actual tenant boundary, matching that adapter's own established
 * pattern.
 */

export const REVIEW_QUEUE_DEFAULT_PAGE_SIZE = 25;
export const REVIEW_QUEUE_MAX_PAGE_SIZE = 100;

const NEEDS_REVIEW_STATES: readonly ReviewState[] = [
  REVIEW_STATE.DETECTED,
  REVIEW_STATE.PROPOSED,
  REVIEW_STATE.CONFIRMED,
];

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface ReviewQueueFilter {
  readonly state?: ReviewState;
  readonly candidateKind?: string;
  readonly sourceConnectionId?: string;
  readonly search?: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface ReviewQueueItem {
  readonly reviewSubjectId: string;
  readonly candidateKind: DiscoveryCandidateKind;
  readonly state: ReviewState;
  readonly findingId: string;
  readonly sourceConnectionId: string;
  readonly sourceExternalType: string;
  readonly sourceExternalId: string;
  readonly detectedAt: string;
  readonly evidenceCount: number;
  readonly assertionCount: number;
}

export interface ReviewQueuePage {
  readonly items: readonly ReviewQueueItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly hasMore: boolean;
}

interface ReviewQueueRow {
  review_subject_id: string;
  candidate_kind: string;
  state: string;
  finding_id: string;
  source_connection_id: string;
  source_external_type: string;
  source_external_id: string;
  detected_at: string;
  evidence_count: number;
  assertion_count: number;
}

function reviewQueueItemFromRow(row: ReviewQueueRow): ReviewQueueItem {
  return {
    reviewSubjectId: row.review_subject_id,
    candidateKind: row.candidate_kind as DiscoveryCandidateKind,
    state: row.state as ReviewState,
    findingId: row.finding_id,
    sourceConnectionId: row.source_connection_id,
    sourceExternalType: row.source_external_type,
    sourceExternalId: row.source_external_id,
    detectedAt: row.detected_at,
    evidenceCount: row.evidence_count,
    assertionCount: row.assertion_count,
  };
}

/**
 * Sanitizes a user-supplied search term before it is interpolated into a
 * PostgREST `.or(...)` filter string. Two distinct concerns:
 *   1. ILIKE wildcard characters (%, _, \) are escaped so the term is matched
 *      literally, not as a pattern.
 *   2. PostgREST's or-filter mini-language has no escape for its own
 *      structural delimiters (`,` separates conditions, `(`/`)` group them);
 *      a term containing them could inject an unintended extra filter clause
 *      (still confined to this table/tenant — organisation_id is a separate,
 *      non-string-built filter — but never intended query behavior). These
 *      are stripped outright rather than escaped, since they are not
 *      meaningful characters in a finding/source-identifier search anyway.
 */
function escapeIlikeTerm(term: string): string {
  return term.replace(/[,()]/g, "").replace(/[%_\\]/g, (match) => `\\${match}`);
}

export async function listReviewQueue(
  organisationId: OrganisationId,
  filter: ReviewQueueFilter,
): Promise<ReviewQueuePage> {
  const pageSize = Math.min(Math.max(Math.trunc(filter.pageSize) || REVIEW_QUEUE_DEFAULT_PAGE_SIZE, 1), REVIEW_QUEUE_MAX_PAGE_SIZE);
  const page = Math.max(Math.trunc(filter.page) || 1, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize; // fetch one extra row to detect hasMore without a second count query

  let query = privilegedDb
    .from("review_subject_queue")
    .select(
      "review_subject_id, candidate_kind, state, finding_id, source_connection_id, source_external_type, source_external_id, detected_at, evidence_count, assertion_count, triage_rank",
    )
    .eq("organisation_id", organisationId);

  if (filter.state) query = query.eq("state", filter.state);
  if (filter.candidateKind) query = query.eq("candidate_kind", filter.candidateKind);
  if (filter.sourceConnectionId) query = query.eq("source_connection_id", filter.sourceConnectionId);
  if (filter.search && filter.search.trim().length > 0) {
    const term = escapeIlikeTerm(filter.search.trim());
    query = query.or(`finding_id.ilike.%${term}%,source_external_id.ilike.%${term}%`);
  }

  const { data, error } = await query
    .order("triage_rank", { ascending: true })
    .order("detected_at", { ascending: false })
    .order("review_subject_id", { ascending: false })
    .range(from, to);

  if (error) throw new Error(`review_subject_queue query failed: ${error.message}`);

  const rows = (data ?? []) as ReviewQueueRow[];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

  return { items: pageRows.map(reviewQueueItemFromRow), page, pageSize, hasMore };
}

// ---------------------------------------------------------------------------
// Executive summary
// ---------------------------------------------------------------------------

export interface WorkspaceSummary {
  readonly needsReview: number;
  readonly detected: number;
  readonly proposed: number;
  readonly confirmed: number;
  readonly certified: number;
  readonly objectFindingsNeedingReview: number;
  readonly relationshipFindingsNeedingReview: number;
}

async function countReviewSubjectsByState(organisationId: OrganisationId, state: ReviewState): Promise<number> {
  const { count, error } = await privilegedDb
    .from("review_subjects")
    .select("review_subject_id", { count: "exact", head: true })
    .eq("organisation_id", organisationId)
    .eq("state", state);
  if (error) throw new Error(`review_subjects count query failed: ${error.message}`);
  return count ?? 0;
}

async function countNeedsReviewByRelationshipFlag(
  organisationId: OrganisationId,
  isRelationship: boolean,
): Promise<number> {
  const base = privilegedDb
    .from("review_subjects")
    .select("review_subject_id", { count: "exact", head: true })
    .eq("organisation_id", organisationId)
    .in("state", [...NEEDS_REVIEW_STATES]);
  const { count, error } = isRelationship
    ? await base.eq("candidate_kind", "RELATIONSHIP")
    : await base.neq("candidate_kind", "RELATIONSHIP");
  if (error) throw new Error(`review_subjects count query failed: ${error.message}`);
  return count ?? 0;
}

export async function getWorkspaceSummary(organisationId: OrganisationId): Promise<WorkspaceSummary> {
  const [detected, proposed, confirmed, certified, objectFindingsNeedingReview, relationshipFindingsNeedingReview] =
    await Promise.all([
      countReviewSubjectsByState(organisationId, REVIEW_STATE.DETECTED),
      countReviewSubjectsByState(organisationId, REVIEW_STATE.PROPOSED),
      countReviewSubjectsByState(organisationId, REVIEW_STATE.CONFIRMED),
      countReviewSubjectsByState(organisationId, REVIEW_STATE.CERTIFIED),
      countNeedsReviewByRelationshipFlag(organisationId, false),
      countNeedsReviewByRelationshipFlag(organisationId, true),
    ]);

  return {
    needsReview: detected + proposed + confirmed,
    detected,
    proposed,
    confirmed,
    certified,
    objectFindingsNeedingReview,
    relationshipFindingsNeedingReview,
  };
}

// ---------------------------------------------------------------------------
// Review subject detail — identity, evidence, assertions, provenance, history
// ---------------------------------------------------------------------------

export type EvidencePresentation =
  | {
      readonly evidenceId: string;
      readonly handling: "HASH_ONLY";
      readonly capturedAt: string;
      readonly hashes: readonly EvidenceHash[];
      readonly locations: readonly EvidenceLocation[];
    }
  | {
      readonly evidenceId: string;
      readonly handling: "REDACTED" | "NON_SENSITIVE";
      readonly capturedAt: string;
      readonly hashes: readonly EvidenceHash[];
      readonly locations: readonly EvidenceLocation[];
      readonly redactedExcerpt?: string;
    };

export interface SourceAssertionPresentation {
  readonly assertionId: string;
  readonly runId: string;
  readonly sourceConnectionId: string;
  readonly sourceExternalType: string;
  readonly sourceExternalId: string;
  readonly methodCode: string;
  readonly methodVersion?: string;
  readonly trustState: string;
  readonly confidence?: number;
  readonly observedAt: string;
  readonly recordedAt: string;
}

export interface AcquisitionRunSummary {
  readonly runId: string;
  readonly sourceConnectionId: string;
  readonly sourceSystemId: string;
  readonly adapterName: string;
  readonly adapterVersion: string;
  readonly mode: string;
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface GovernanceHistoryEntry {
  readonly eventId: string;
  readonly previousState: ReviewState;
  readonly newState: ReviewState;
  readonly actorKind: "HUMAN" | "DETERMINISTIC_RULE";
  readonly actorReference?: string;
  readonly actorRuleCode?: string;
  readonly actorRuleVersion?: string;
  readonly occurredAt: string;
  readonly reasonCode?: string;
}

export interface ReviewSubjectDetail {
  readonly reviewSubjectId: string;
  readonly organisationId: string;
  readonly candidateKind: DiscoveryCandidateKind;
  readonly state: ReviewState;
  readonly findingId: string;
  readonly sourceConnectionId: string;
  readonly sourceExternalType: string;
  readonly sourceExternalId: string;
  readonly detectedAt: string;
  readonly evidence: readonly EvidencePresentation[];
  readonly assertions: readonly SourceAssertionPresentation[];
  readonly acquisitionRuns: readonly AcquisitionRunSummary[];
  readonly history: readonly GovernanceHistoryEntry[];
}

/**
 * Server-side evidence sensitivity policy. This is the sole place that
 * decides what an Evidence record's content may render as; the UI never
 * receives (and therefore cannot leak) anything beyond what this function
 * returns. HASH_ONLY never carries redactedExcerpt even if a malformed
 * upstream record somehow included one — never trust the persisted envelope's
 * shape alone to be safe merely because its own `handling` field says so.
 */
function presentEvidence(evidence: Evidence): EvidencePresentation {
  const base = {
    evidenceId: evidence.evidenceId,
    capturedAt: evidence.capturedAt,
    hashes: evidence.hashes,
    locations: evidence.locations,
  };
  if (evidence.handling === "HASH_ONLY") {
    return { ...base, handling: "HASH_ONLY" };
  }
  return {
    ...base,
    handling: evidence.handling,
    ...(evidence.redactedExcerpt ? { redactedExcerpt: evidence.redactedExcerpt } : {}),
  };
}

interface DiscoveryEvidenceRow {
  evidence_id: string;
  handling: string;
  captured_at: string;
  envelope: unknown;
  envelope_hash: string;
}

function verifyAndParseEvidenceEnvelope(row: DiscoveryEvidenceRow): Evidence {
  const recomputed = sha256Hex(canonicalStringify(row.envelope));
  if (recomputed !== row.envelope_hash) {
    throw new Error(`Evidence ${row.evidence_id} failed content-hash verification on read`);
  }
  return row.envelope as Evidence;
}

async function hydrateEvidence(
  organisationId: OrganisationId,
  evidenceIds: readonly string[],
): Promise<EvidencePresentation[]> {
  if (evidenceIds.length === 0) return [];
  const { data, error } = await privilegedDb
    .from("discovery_evidence")
    .select("evidence_id, handling, captured_at, envelope, envelope_hash")
    .eq("organisation_id", organisationId)
    .in("evidence_id", [...evidenceIds]);
  if (error) throw new Error(`discovery_evidence query failed: ${error.message}`);
  return ((data ?? []) as DiscoveryEvidenceRow[]).map((row) => presentEvidence(verifyAndParseEvidenceEnvelope(row)));
}

interface SourceAssertionRow {
  assertion_id: string;
  run_id: string;
  source_connection_id: string;
  source_external_type: string;
  source_external_id: string;
  method_code: string;
  method_version: string | null;
  trust_state: string;
  confidence: number | null;
  observed_at: string;
  recorded_at: string;
}

async function hydrateAssertions(
  organisationId: OrganisationId,
  assertionIds: readonly string[],
): Promise<SourceAssertionPresentation[]> {
  if (assertionIds.length === 0) return [];
  const { data, error } = await privilegedDb
    .from("source_assertions")
    .select(
      "assertion_id, run_id, source_connection_id, source_external_type, source_external_id, method_code, method_version, trust_state, confidence, observed_at, recorded_at",
    )
    .eq("organisation_id", organisationId)
    .in("assertion_id", [...assertionIds]);
  if (error) throw new Error(`source_assertions query failed: ${error.message}`);
  return ((data ?? []) as SourceAssertionRow[]).map((row) => ({
    assertionId: row.assertion_id,
    runId: row.run_id,
    sourceConnectionId: row.source_connection_id,
    sourceExternalType: row.source_external_type,
    sourceExternalId: row.source_external_id,
    methodCode: row.method_code,
    ...(row.method_version ? { methodVersion: row.method_version } : {}),
    trustState: row.trust_state,
    ...(row.confidence !== null ? { confidence: row.confidence } : {}),
    observedAt: row.observed_at,
    recordedAt: row.recorded_at,
  }));
}

interface AcquisitionRunRow {
  run_id: string;
  source_connection_id: string;
  source_system_id: string;
  adapter_name: string;
  adapter_version: string;
  mode: string;
  status: string;
  started_at: string;
  completed_at: string | null;
}

async function hydrateAcquisitionRuns(
  organisationId: OrganisationId,
  runIds: readonly string[],
): Promise<AcquisitionRunSummary[]> {
  if (runIds.length === 0) return [];
  const { data, error } = await privilegedDb
    .from("acquisition_runs")
    .select("run_id, source_connection_id, source_system_id, adapter_name, adapter_version, mode, status, started_at, completed_at")
    .eq("organisation_id", organisationId)
    .in("run_id", [...runIds]);
  if (error) throw new Error(`acquisition_runs query failed: ${error.message}`);
  return ((data ?? []) as AcquisitionRunRow[]).map((row) => ({
    runId: row.run_id,
    sourceConnectionId: row.source_connection_id,
    sourceSystemId: row.source_system_id,
    adapterName: row.adapter_name,
    adapterVersion: row.adapter_version,
    mode: row.mode,
    status: row.status,
    startedAt: row.started_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  }));
}

function historyEntryFromEvent(event: ReviewAuditEvent): GovernanceHistoryEntry {
  const actor = event.actor;
  return {
    eventId: event.eventId,
    previousState: event.previousState,
    newState: event.newState,
    actorKind: actor.authorityKind,
    ...(actor.authorityKind === "HUMAN"
      ? { actorReference: actor.actorReference }
      : { actorRuleCode: actor.ruleCode, actorRuleVersion: actor.ruleVersion }),
    occurredAt: event.occurredAt,
    ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
  };
}

export async function getReviewSubjectDetail(
  organisationId: OrganisationId,
  reviewSubjectId: ReviewSubjectId,
): Promise<ReviewSubjectDetail | undefined> {
  const chain = await governanceReviewPersistence.getReviewAuditChain(organisationId, reviewSubjectId);
  if (!chain) return undefined;
  const { subject, events } = chain;

  const [evidence, assertions] = await Promise.all([
    hydrateEvidence(organisationId, subject.evidenceIds),
    hydrateAssertions(organisationId, subject.assertionIds),
  ]);

  const runIds = [...new Set(assertions.map((assertion) => assertion.runId))];
  const acquisitionRuns = await hydrateAcquisitionRuns(organisationId, runIds);

  return {
    reviewSubjectId: subject.reviewSubjectId,
    organisationId: subject.organisationId,
    candidateKind: subject.candidateKind,
    state: subject.state,
    findingId: subject.findingId,
    sourceConnectionId: subject.sourceObject.connectionId,
    sourceExternalType: subject.sourceObject.externalType,
    sourceExternalId: subject.sourceObject.externalId,
    detectedAt: subject.detectedAt,
    evidence,
    assertions,
    acquisitionRuns,
    history: events.map(historyEntryFromEvent),
  };
}

// Exported for direct unit testing of otherwise-pure, security-critical logic
// (evidence presentation policy, search-term escaping) without needing to
// mock the Supabase client — matching this repo's existing test-layering
// convention (see lib/governance/persistence.ts's own exports).
export { asReviewSubjectId, escapeIlikeTerm, presentEvidence };
