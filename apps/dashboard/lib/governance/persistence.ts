import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import {
  CANONICAL_OBJECT_KIND,
  RECONCILIATION_AUTHORITY_KIND,
  asCandidateMergeId,
  asDiscoveryFindingId,
  asEvidenceId,
  asExternalId,
  asIsoTimestamp,
  asNormalizedCandidateId,
  asOrganisationId,
  asReconciliationDecisionId,
  asSourceAssertionId,
  asSourceConnectionId,
  rehydrateObjectReconciliationDecision,
  rehydrateRelationshipReconciliationDecision,
  type CanonicalObjectKind,
  type DiscoveryCandidateKind,
  type MergeCandidatesReconciliationDecision,
  type MultipleCandidateIds,
  type OrganisationId,
  type ReconciliationAuthority,
  type ReconciliationDecision,
  type RelationshipReconciliationDecision,
  type SourceObjectIdentity,
} from "@council/canonical-contracts";
import {
  asReconciliationInvocationId,
  asReviewSubjectId,
  asReviewTransitionId,
  type AuthorizationDecisionPersistenceResult,
  type AuthorizedReconciliationPersistenceInput,
  type AuthorizedReconciliationPersistenceResult,
  type GovernanceReviewPersistencePort,
  type PersistedReconciliationDecision,
  type PersistedReconciliationFamily,
  type ReconciliationAuditChainEntry,
  type ReconciliationAuthorizationResult,
  type ReconciliationInvocationAuditEvent,
  type ReviewAuditChain,
  type ReviewAuditEvent,
  type ReviewSubject,
  type ReviewSubjectId,
  type ReviewSubjectPersistenceResult,
  type ReviewTransitionPersistenceResult,
  type TransitionResult,
} from "@council/governance-review";

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

const supabaseUrl = getEnv("SUPABASE_URL");
const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

const privilegedDb = createClient(supabaseUrl, supabaseServiceRoleKey, {
  db: { schema: "gov_repo" },
  global: {
    headers: {
      "x-codeguard-client": "governance-os-review-privileged",
    },
  },
});

// ---------------------------------------------------------------------------
// Deterministic canonical-envelope hashing. This adapter is the sole author
// and sole re-verifier of envelope_hash / payload_hash: the database only
// format-checks it (char(64) hex). A row this application did not just write
// is never trusted merely because it came back from storage — every read
// recomputes this hash and rejects a mismatch.
// ---------------------------------------------------------------------------

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`,
  );
  return `{${entries.join(",")}}`;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function hashEnvelope(decision: PersistedReconciliationDecision): string {
  return sha256Hex(canonicalStringify(decision));
}

// ---------------------------------------------------------------------------
// Authority <-> row mapping. ReconciliationAuthority is a HUMAN/DETERMINISTIC_RULE
// union; review_audit_events allows both, while reconciliation_decisions and
// reconciliation_invocations are HUMAN-only by DB CHECK (governance-review's
// assertHumanActor guarantees this before either row can ever be produced).
// ---------------------------------------------------------------------------

interface ActorColumns {
  readonly actor_kind: string;
  readonly actor_reference: string | null;
  readonly actor_rule_code: string | null;
  readonly actor_rule_version: string | null;
}

function actorToColumns(actor: ReconciliationAuthority): ActorColumns {
  if (actor.authorityKind === "HUMAN") {
    return {
      actor_kind: "HUMAN",
      actor_reference: actor.actorReference,
      actor_rule_code: null,
      actor_rule_version: null,
    };
  }
  return {
    actor_kind: "DETERMINISTIC_RULE",
    actor_reference: null,
    actor_rule_code: actor.ruleCode,
    actor_rule_version: actor.ruleVersion,
  };
}

function actorFromColumns(row: ActorColumns): ReconciliationAuthority {
  if (row.actor_kind === "HUMAN") {
    if (!row.actor_reference) {
      throw new TypeError("Stored HUMAN actor is missing actor_reference");
    }
    return { authorityKind: RECONCILIATION_AUTHORITY_KIND.HUMAN, actorReference: row.actor_reference };
  }
  if (row.actor_kind === "DETERMINISTIC_RULE") {
    if (!row.actor_rule_code || !row.actor_rule_version) {
      throw new TypeError("Stored DETERMINISTIC_RULE actor is missing ruleCode/ruleVersion");
    }
    return {
      authorityKind: RECONCILIATION_AUTHORITY_KIND.DETERMINISTIC_RULE,
      ruleCode: row.actor_rule_code,
      ruleVersion: row.actor_rule_version,
    };
  }
  throw new TypeError(`Unrecognized stored actor_kind: ${row.actor_kind}`);
}

function sourceObjectFromRow(row: {
  source_connection_id: string;
  source_external_type: string;
  source_external_id: string;
}): SourceObjectIdentity {
  return {
    connectionId: asSourceConnectionId(row.source_connection_id),
    externalType: row.source_external_type,
    externalId: asExternalId(row.source_external_id),
  };
}

// ---------------------------------------------------------------------------
// MERGE_CANDIDATES rehydration. canonical-contracts exports a public
// rehydrator for the object and relationship families
// (rehydrateObjectReconciliationDecision / rehydrateRelationshipReconciliationDecision)
// but not for MergeCandidatesReconciliationDecision, because that type is only
// ever constructed via createCandidateMergeRecord + a manual Object.freeze
// inside governance-review's reconciliation-invocation.ts — it was never
// previously round-tripped through storage. This fills that one gap with the
// same allowlist discipline (reject unknown fields, validate every value)
// rather than trusting stored JSON.
// ---------------------------------------------------------------------------

function isCanonicalObjectKindValue(value: unknown): value is CanonicalObjectKind {
  return typeof value === "string" && (Object.values(CANONICAL_OBJECT_KIND) as string[]).includes(value);
}

const MERGE_DECISION_ALLOWED_FIELDS = [
  "decisionId",
  "organisationId",
  "outcome",
  "candidateKind",
  "authority",
  "reasonCode",
  "assertionIds",
  "evidenceIds",
  "decidedAt",
  "contributingCandidateIds",
  "candidateMergeId",
] as const;

function requiredNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new TypeError(`${label} must be an array of strings`);
  }
  return value as string[];
}

function rehydrateMergeCandidatesDecision(value: unknown): MergeCandidatesReconciliationDecision {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Merge-candidates reconciliation decision must be an object");
  }
  const input = value as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (!(MERGE_DECISION_ALLOWED_FIELDS as readonly string[]).includes(key)) {
      throw new TypeError(`Merge-candidates reconciliation decision cannot include field "${key}"`);
    }
  }

  if (input.outcome !== "MERGE_CANDIDATES") {
    throw new TypeError('Merge-candidates reconciliation decision outcome must be "MERGE_CANDIDATES"');
  }
  if (!isCanonicalObjectKindValue(input.candidateKind)) {
    throw new TypeError("Merge-candidates reconciliation decision candidateKind must be a canonical object kind");
  }

  const authorityInput = input.authority;
  if (
    typeof authorityInput !== "object" ||
    authorityInput === null ||
    (authorityInput as Record<string, unknown>).authorityKind !== "HUMAN" ||
    typeof (authorityInput as Record<string, unknown>).actorReference !== "string" ||
    ((authorityInput as Record<string, unknown>).actorReference as string).trim().length === 0
  ) {
    throw new TypeError(
      "Merge-candidates reconciliation decision requires HUMAN authority with a non-empty actorReference",
    );
  }

  const assertionIds = requiredStringArray(input.assertionIds, "Merge-candidates reconciliation decision assertionIds").map(
    asSourceAssertionId,
  );
  const evidenceIds = requiredStringArray(input.evidenceIds, "Merge-candidates reconciliation decision evidenceIds").map(
    asEvidenceId,
  );

  const contributingRaw = requiredStringArray(
    input.contributingCandidateIds,
    "Merge-candidates reconciliation decision contributingCandidateIds",
  );
  if (contributingRaw.length < 2) {
    throw new TypeError("Merge-candidates reconciliation decision requires at least two contributing candidates");
  }
  if (new Set(contributingRaw).size !== contributingRaw.length) {
    throw new TypeError("Merge-candidates reconciliation decision contributing candidates must be unique");
  }
  const contributingCandidateIds = contributingRaw.map(asNormalizedCandidateId) as unknown as MultipleCandidateIds;

  return Object.freeze({
    decisionId: asReconciliationDecisionId(requiredNonEmptyString(input.decisionId, "decisionId")),
    organisationId: asOrganisationId(requiredNonEmptyString(input.organisationId, "organisationId")),
    outcome: "MERGE_CANDIDATES",
    candidateKind: input.candidateKind,
    authority: Object.freeze({
      authorityKind: "HUMAN",
      actorReference: (authorityInput as Record<string, unknown>).actorReference as string,
    }),
    reasonCode: requiredNonEmptyString(input.reasonCode, "reasonCode"),
    assertionIds: Object.freeze(assertionIds),
    evidenceIds: Object.freeze(evidenceIds),
    decidedAt: asIsoTimestamp(requiredNonEmptyString(input.decidedAt, "decidedAt")),
    contributingCandidateIds,
    candidateMergeId: asCandidateMergeId(requiredNonEmptyString(input.candidateMergeId, "candidateMergeId")),
  }) as MergeCandidatesReconciliationDecision;
}

function rehydrateEnvelopeByFamily(
  family: PersistedReconciliationFamily,
  envelope: unknown,
): PersistedReconciliationDecision {
  if (family === "OBJECT") return rehydrateObjectReconciliationDecision(envelope);
  if (family === "RELATIONSHIP") return rehydrateRelationshipReconciliationDecision(envelope);
  return rehydrateMergeCandidatesDecision(envelope);
}

/** Recomputes envelope_hash from the fetched envelope and rejects a mismatch — never trusts stored JSON merely because this application wrote it. */
function verifyEnvelopeIntegrity(envelope: unknown, storedHash: string, decisionId: string): void {
  const recomputed = sha256Hex(canonicalStringify(envelope));
  if (recomputed !== storedHash) {
    throw new Error(`Reconciliation decision ${decisionId} failed content-hash verification on read`);
  }
}

// ---------------------------------------------------------------------------
// Domain <-> row reconstruction
// ---------------------------------------------------------------------------

interface ReviewSubjectRow {
  review_subject_id: string;
  organisation_id: string;
  finding_id: string;
  candidate_kind: string;
  source_connection_id: string;
  source_external_type: string;
  source_external_id: string;
  state: string;
  detected_at: string;
  last_transition_id: string | null;
  revision: number;
}

function reviewSubjectFromRow(
  row: ReviewSubjectRow,
  assertionIds: string[],
  evidenceIds: string[],
  lastTransition: ReviewAuditEvent | undefined,
): ReviewSubject {
  return Object.freeze({
    reviewSubjectId: asReviewSubjectId(row.review_subject_id),
    organisationId: asOrganisationId(row.organisation_id),
    candidateKind: row.candidate_kind as DiscoveryCandidateKind,
    findingId: asDiscoveryFindingId(row.finding_id),
    sourceObject: sourceObjectFromRow(row),
    assertionIds: Object.freeze(assertionIds.map(asSourceAssertionId)),
    evidenceIds: Object.freeze(evidenceIds.map(asEvidenceId)),
    state: row.state as ReviewSubject["state"],
    detectedAt: asIsoTimestamp(row.detected_at),
    ...(lastTransition ? { lastTransition } : {}),
  });
}

interface ReviewAuditEventRow {
  event_id: string;
  review_subject_id: string;
  organisation_id: string;
  finding_id: string;
  previous_state: string;
  new_state: string;
  actor_kind: string;
  actor_reference: string | null;
  actor_rule_code: string | null;
  actor_rule_version: string | null;
  occurred_at: string;
  reason_code: string | null;
  command_id: string;
}

function reviewAuditEventFromRow(row: ReviewAuditEventRow, evidenceIds: string[]): ReviewAuditEvent {
  return Object.freeze({
    eventId: asReviewTransitionId(row.event_id),
    reviewSubjectId: asReviewSubjectId(row.review_subject_id),
    findingId: asDiscoveryFindingId(row.finding_id),
    organisationId: asOrganisationId(row.organisation_id),
    previousState: row.previous_state as ReviewAuditEvent["previousState"],
    newState: row.new_state as ReviewAuditEvent["newState"],
    actor: actorFromColumns(row),
    occurredAt: asIsoTimestamp(row.occurred_at),
    evidenceIds: Object.freeze(evidenceIds.map(asEvidenceId)),
    ...(row.reason_code ? { reasonCode: row.reason_code } : {}),
    commandId: row.command_id,
  });
}

async function fetchEvidenceIds(table: string, column: string, id: string): Promise<string[]> {
  const { data } = await privilegedDb.from(table).select("evidence_id").eq(column, id);
  return (data ?? []).map((row: { evidence_id: string }) => row.evidence_id);
}

// ---------------------------------------------------------------------------
// Port implementation
// ---------------------------------------------------------------------------

export const governanceReviewPersistence: GovernanceReviewPersistencePort = {
  async createReviewSubject(subject: ReviewSubject): Promise<ReviewSubjectPersistenceResult> {
    const { data, error } = await privilegedDb.rpc("create_review_subject", {
      p_review_subject_id: subject.reviewSubjectId,
      p_organisation_id: subject.organisationId,
      p_finding_id: subject.findingId,
      p_candidate_kind: subject.candidateKind,
      p_source_connection_id: subject.sourceObject.connectionId,
      p_source_external_type: subject.sourceObject.externalType,
      p_source_external_id: subject.sourceObject.externalId,
      p_detected_at: subject.detectedAt,
      p_assertion_ids: [...subject.assertionIds],
      p_evidence_ids: [...subject.evidenceIds],
    });
    if (error) throw new Error(`create_review_subject failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { replay: boolean };
    return { replay: row.replay, subject };
  },

  async getReviewSubject(
    organisationId: OrganisationId,
    reviewSubjectId: ReviewSubjectId,
  ): Promise<ReviewSubject | undefined> {
    const { data: subjectRow } = await privilegedDb
      .from("review_subjects")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq("review_subject_id", reviewSubjectId)
      .maybeSingle();

    if (!subjectRow) return undefined;
    const row = subjectRow as ReviewSubjectRow;

    const [{ data: assertionRows }, evidenceIds] = await Promise.all([
      privilegedDb.from("review_subject_assertions").select("assertion_id").eq("review_subject_id", reviewSubjectId),
      fetchEvidenceIds("review_subject_evidence", "review_subject_id", reviewSubjectId),
    ]);
    const assertionIds = (assertionRows ?? []).map((r: { assertion_id: string }) => r.assertion_id);

    let lastTransition: ReviewAuditEvent | undefined;
    if (row.last_transition_id) {
      const { data: eventRow } = await privilegedDb
        .from("review_audit_events")
        .select("*")
        .eq("event_id", row.last_transition_id)
        .maybeSingle();
      if (eventRow) {
        const eventEvidenceIds = await fetchEvidenceIds(
          "review_audit_event_evidence",
          "event_id",
          row.last_transition_id,
        );
        lastTransition = reviewAuditEventFromRow(eventRow as ReviewAuditEventRow, eventEvidenceIds);
      }
    }

    return reviewSubjectFromRow(row, assertionIds, evidenceIds, lastTransition);
  },

  async persistReviewTransition(result: TransitionResult): Promise<ReviewTransitionPersistenceResult> {
    const { subject, event } = result;
    const actorColumns = actorToColumns(event.actor);

    const { data, error } = await privilegedDb.rpc("apply_review_transition", {
      p_organisation_id: subject.organisationId,
      p_review_subject_id: subject.reviewSubjectId,
      p_finding_id: subject.findingId,
      p_previous_state: event.previousState,
      p_new_state: event.newState,
      p_actor_kind: actorColumns.actor_kind,
      p_actor_reference: actorColumns.actor_reference,
      p_actor_rule_code: actorColumns.actor_rule_code,
      p_actor_rule_version: actorColumns.actor_rule_version,
      p_occurred_at: event.occurredAt,
      p_evidence_ids: [...event.evidenceIds],
      p_reason_code: event.reasonCode ?? null,
      p_command_id: event.commandId,
      p_event_id: event.eventId,
    });
    if (error) throw new Error(`apply_review_transition failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { replay: boolean; revision: number; state: string };

    return {
      replay: row.replay,
      event,
      subject: Object.freeze({
        ...subject,
        state: row.state as ReviewSubject["state"],
        lastTransition: event,
      }),
    };
  },

  async getReviewAuditChain(
    organisationId: OrganisationId,
    reviewSubjectId: ReviewSubjectId,
  ): Promise<ReviewAuditChain | undefined> {
    const subject = await governanceReviewPersistence.getReviewSubject(organisationId, reviewSubjectId);
    if (!subject) return undefined;

    const { data: eventRows } = await privilegedDb
      .from("review_audit_events")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq("review_subject_id", reviewSubjectId)
      .order("recorded_at", { ascending: true });

    const events = await Promise.all(
      ((eventRows ?? []) as ReviewAuditEventRow[]).map(async (row) => {
        const evidenceIds = await fetchEvidenceIds("review_audit_event_evidence", "event_id", row.event_id);
        return reviewAuditEventFromRow(row, evidenceIds);
      }),
    );

    return { subject, events };
  },

  async persistAuthorizationDecision(
    result: ReconciliationAuthorizationResult,
    context: { readonly reviewSubjectId: ReviewSubjectId | undefined },
  ): Promise<AuthorizationDecisionPersistenceResult> {
    const { data, error } = await privilegedDb.rpc("record_authorization_decision", {
      p_authorization_decision_id: result.authorizationDecisionId,
      p_organisation_id: result.organisationId,
      p_review_subject_id: context.reviewSubjectId ?? null,
      p_actor_reference: result.actorReference,
      p_subject_kind: result.subject.subjectKind,
      p_subject_candidate_id: result.subject.subjectKind === "CANDIDATE" ? result.subject.candidateId : null,
      p_subject_candidate_merge_id:
        result.subject.subjectKind === "CANDIDATE_MERGE" ? result.subject.candidateMergeId : null,
      p_requested_action: result.requestedAction,
      p_result: result.result,
      p_evaluated_at: result.evaluatedAt,
      p_policy_reference: result.policyReference ?? null,
    });
    if (error) throw new Error(`record_authorization_decision failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as {
      replay: boolean;
      authorization_decision_id: string;
      result: "ALLOW" | "DENY";
    };
    return { replay: row.replay, authorizationDecisionId: row.authorization_decision_id, result: row.result };
  },

  async persistAuthorizedReconciliation(
    input: AuthorizedReconciliationPersistenceInput,
  ): Promise<AuthorizedReconciliationPersistenceResult> {
    const { family, authorization, invocation, decision } = input;
    const envelopeHash = hashEnvelope(decision);
    const actorColumns = actorToColumns(invocation.actor);
    if (actorColumns.actor_kind !== "HUMAN" || !actorColumns.actor_reference) {
      throw new TypeError("Authorized reconciliation requires a HUMAN actor with a non-empty actorReference");
    }

    let candidateKind: string;
    let subjectCandidateId: string | null = null;
    let subjectCandidateMergeId: string | null = null;
    let canonicalObjectId: string | null = null;
    let canonicalObjectKind: string | null = null;
    let relationshipCandidateId: string | null = null;
    let relationshipTypeCode: string | null = null;
    let candidateMergeId: string | null = null;
    let mergeMemberCandidateIds: string[] = [];

    if (family === "OBJECT") {
      const objectDecision = decision as ReconciliationDecision;
      if (objectDecision.outcome === "MERGE_CANDIDATES") {
        throw new TypeError("OBJECT family reconciliation decision cannot have outcome MERGE_CANDIDATES");
      }
      candidateKind = objectDecision.candidateKind;
      if (objectDecision.subject.subjectKind === "CANDIDATE") {
        subjectCandidateId = objectDecision.subject.candidateId;
      } else {
        subjectCandidateMergeId = objectDecision.subject.candidateMergeId;
      }
      if ("canonicalObject" in objectDecision && objectDecision.canonicalObject) {
        canonicalObjectId = objectDecision.canonicalObject.objectId;
        canonicalObjectKind = objectDecision.canonicalObject.kind;
      }
    } else if (family === "RELATIONSHIP") {
      const relationshipDecision = decision as RelationshipReconciliationDecision;
      candidateKind = "RELATIONSHIP";
      relationshipCandidateId = relationshipDecision.relationshipCandidateId;
      relationshipTypeCode = relationshipDecision.relationshipTypeCode;
    } else {
      const mergeDecision = decision as MergeCandidatesReconciliationDecision;
      candidateKind = mergeDecision.candidateKind;
      candidateMergeId = mergeDecision.candidateMergeId;
      mergeMemberCandidateIds = [...mergeDecision.contributingCandidateIds];
    }

    const { data, error } = await privilegedDb.rpc("record_authorized_reconciliation", {
      p_organisation_id: decision.organisationId,
      p_review_subject_id: invocation.reviewSubjectId ?? null,
      p_authorization_decision_id: authorization.authorizationDecisionId,
      p_authorization_actor_reference: authorization.actorReference,
      p_authorization_subject_kind: authorization.subject.subjectKind,
      p_authorization_subject_candidate_id:
        authorization.subject.subjectKind === "CANDIDATE" ? authorization.subject.candidateId : null,
      p_authorization_subject_candidate_merge_id:
        authorization.subject.subjectKind === "CANDIDATE_MERGE" ? authorization.subject.candidateMergeId : null,
      p_requested_action: authorization.requestedAction,
      p_authorization_evaluated_at: authorization.evaluatedAt,
      p_policy_reference: authorization.policyReference ?? null,
      p_invocation_id: invocation.invocationId,
      p_command_id: invocation.commandId,
      p_command_fingerprint: invocation.commandFingerprint,
      p_requested_at: invocation.requestedAt,
      p_reason_code: invocation.reasonCode,
      p_decision_id: decision.decisionId,
      p_family: family,
      p_outcome: decision.outcome,
      p_candidate_kind: candidateKind,
      p_authority_reference: actorColumns.actor_reference,
      p_decided_at: decision.decidedAt,
      p_subject_candidate_id: subjectCandidateId,
      p_subject_candidate_merge_id: subjectCandidateMergeId,
      p_canonical_object_id: canonicalObjectId,
      p_canonical_object_kind: canonicalObjectKind,
      p_relationship_candidate_id: relationshipCandidateId,
      p_relationship_type_code: relationshipTypeCode,
      p_candidate_merge_id: candidateMergeId,
      p_merge_member_candidate_ids: mergeMemberCandidateIds,
      p_assertion_ids: [...decision.assertionIds],
      p_evidence_ids: [...decision.evidenceIds],
      p_contract_version: "1.1",
      p_envelope: decision,
      p_envelope_hash: envelopeHash,
    });
    if (error) throw new Error(`record_authorized_reconciliation failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as {
      replay: boolean;
      authorization_decision_id: string;
      invocation_id: string;
      reconciliation_decision_id: string;
    };

    return {
      replay: row.replay,
      authorizationDecisionId: row.authorization_decision_id,
      invocationId: row.invocation_id,
      reconciliationDecisionId: row.reconciliation_decision_id,
    };
  },

  async getReconciliationAuditChain(
    organisationId: OrganisationId,
    reconciliationDecisionId: string,
  ): Promise<ReconciliationAuditChainEntry | undefined> {
    const { data: decisionRow } = await privilegedDb
      .from("reconciliation_decisions")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq("decision_id", reconciliationDecisionId)
      .maybeSingle();
    if (!decisionRow) return undefined;

    const family = decisionRow.family as PersistedReconciliationFamily;
    verifyEnvelopeIntegrity(decisionRow.envelope, decisionRow.envelope_hash, reconciliationDecisionId);
    const decision = rehydrateEnvelopeByFamily(family, decisionRow.envelope);
    if (decision.organisationId !== organisationId) {
      throw new Error(`Reconciliation decision ${reconciliationDecisionId} envelope organisation mismatch`);
    }

    const { data: invocationRow } = await privilegedDb
      .from("reconciliation_invocations")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq("reconciliation_decision_id", reconciliationDecisionId)
      .maybeSingle();
    if (!invocationRow) {
      throw new Error(`Reconciliation decision ${reconciliationDecisionId} has no matching invocation record`);
    }

    const { data: authorizationRow } = await privilegedDb
      .from("authorization_decisions")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq("authorization_decision_id", invocationRow.authorization_decision_id)
      .maybeSingle();
    if (!authorizationRow) {
      throw new Error(`Reconciliation decision ${reconciliationDecisionId} has no matching authorization record`);
    }

    const invocation: ReconciliationInvocationAuditEvent = Object.freeze({
      invocationId: asReconciliationInvocationId(invocationRow.invocation_id),
      commandId: invocationRow.command_id,
      organisationId: asOrganisationId(invocationRow.organisation_id),
      reviewSubjectId: invocationRow.review_subject_id
        ? asReviewSubjectId(invocationRow.review_subject_id)
        : undefined,
      authorizationDecisionId: invocationRow.authorization_decision_id,
      reconciliationDecisionId: asReconciliationDecisionId(invocationRow.reconciliation_decision_id),
      requestedAction: invocationRow.requested_action,
      actor: actorFromColumns(invocationRow),
      requestedAt: asIsoTimestamp(invocationRow.requested_at),
      reasonCode: invocationRow.reason_code,
      commandFingerprint: invocationRow.command_fingerprint,
    });

    const authorization: ReconciliationAuthorizationResult = Object.freeze({
      authorizationDecisionId: authorizationRow.authorization_decision_id,
      result: authorizationRow.result,
      organisationId: asOrganisationId(authorizationRow.organisation_id),
      actorReference: authorizationRow.actor_reference,
      subject:
        authorizationRow.subject_kind === "CANDIDATE"
          ? ({
              subjectKind: "CANDIDATE" as const,
              candidateId: asNormalizedCandidateId(authorizationRow.subject_candidate_id),
            } as const)
          : ({
              subjectKind: "CANDIDATE_MERGE" as const,
              candidateMergeId: asCandidateMergeId(authorizationRow.subject_candidate_merge_id),
            } as const),
      requestedAction: authorizationRow.requested_action,
      evaluatedAt: asIsoTimestamp(authorizationRow.evaluated_at),
      ...(authorizationRow.policy_reference ? { policyReference: authorizationRow.policy_reference } : {}),
    });

    return { family, authorization, invocation, decision };
  },
};

// Exported for direct unit testing of otherwise-pure, security-critical
// logic (hashing, rehydration, actor mapping) without needing to mock the
// Supabase client — actual RPC/query behavior is proven separately by the
// controlled Supabase runtime gate (see docs/codex/evidence/), matching this
// repo's existing test-layering convention.
export {
  actorFromColumns,
  actorToColumns,
  canonicalStringify,
  hashEnvelope,
  rehydrateEnvelopeByFamily,
  rehydrateMergeCandidatesDecision,
  sha256Hex,
  verifyEnvelopeIntegrity,
};
