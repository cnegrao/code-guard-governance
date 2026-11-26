import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { asOrganisationId, type OrganisationId } from '@council/canonical-contracts';
import { asReviewSubjectId, EndpointResolutionError, normalizedObjectIdentity, type ReviewState } from '@council/governance-review';
import type { GovernanceWritePrincipal } from '../auth/governance-write-principal';
import { privilegedDb, createGovernedReviewPersistence } from './persistence';
import { rehydrateNormalizedCandidate, normalizedCandidateEnvelopeHash } from './discovery-intake-persistence';
import { workspaceCommands } from './workspace-commands';
import { submitReconciliationDecision, triggerMaterialization } from './decision-commands';
import { getGovernanceDecisionDetail } from './decision-query';
import { sourceName } from './source-name';
import { canonicalEndpointResolution } from './relationship-resolution';
import { chainItem, collectAgentChain, duplicateCreateErrors, executeChain, latestDiscoveryChain, objectIdentityKey, orderChain, referenceCandidates, selectedChain,
  ChainCommandError, type AgentChainPlan, type AlreadyGovernedChainItem, type ChainCandidate, type ChainMatch } from './agent-chain';

export interface ChainAnchor { reviewId?: string; canonicalId?: string }
interface CandidateRow { envelope: unknown; envelope_hash: string; acquisition_run_id: string }
interface RunRow { run_id: string; source_connection_id: string; started_at: string; source_version: string | null }
interface ReviewRow { review_subject_id: string; finding_id: string; state: ReviewState }
interface MappingRow {
  candidate_id: string; canonical_object_id: string; canonical_object_kind: string;
  source_connection_id: string; source_external_type: string; source_external_id: string;
  normalized_object_identity: string; created_by_decision_id: string;
}
interface ObjectRow { canonical_object_id: string; kind: string }
interface RelationshipRow { relationship_id: string; relationship_type: string; source_canonical_object_id: string; target_canonical_object_id: string; valid_to: string | null }
interface InvocationRow { review_subject_id: string; reconciliation_decision_id: string }
interface OperationRow { reconciliation_decision_id: string; status: string; resulting_canonical_object_id: string | null; resulting_relationship_id: string | null }

/** Exhaustive, ordered tenant reads with an explicit cap. Never return a
 * truncated chain as complete. No schema or direct write capability is added. */
async function readRows<T>(org: OrganisationId, table: string, columns: string, order: string): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await privilegedDb.from(table).select(columns).eq('organisation_id', org)
      .order(order).range(offset, offset + 199);
    if (error || !Array.isArray(data)) throw new Error('CHAIN_READ_FAILED');
    result.push(...data as unknown as T[]);
    if (result.length > 10000) throw new ChainCommandError('The chain read limit was exceeded; use individual review.');
    if (data.length < 200) return result;
  }
}

export async function previewAgentChain(org: OrganisationId, anchor: ChainAnchor): Promise<AgentChainPlan> {
  if (!!anchor.reviewId === !!anchor.canonicalId) throw new ChainCommandError('Select one AGENT.');
  const [candidates, reviews, mappings, objects, relationships, decisions, operations, runs] = await Promise.all([
    readRows<CandidateRow>(org, 'discovery_candidates', 'envelope,envelope_hash,acquisition_run_id', 'candidate_id'),
    readRows<ReviewRow>(org, 'review_subjects', 'review_subject_id,finding_id,state', 'review_subject_id'),
    readRows<MappingRow>(org, 'canonical_normalized_object_mappings', 'candidate_id,canonical_object_id,canonical_object_kind,source_connection_id,source_external_type,source_external_id,normalized_object_identity,created_by_decision_id', 'mapping_id'),
    readRows<ObjectRow>(org, 'canonical_objects', 'canonical_object_id,kind', 'canonical_object_id'),
    readRows<RelationshipRow>(org, 'canonical_relationships', 'relationship_id,relationship_type,source_canonical_object_id,target_canonical_object_id,valid_to', 'relationship_id'),
    readRows<InvocationRow>(org, 'reconciliation_invocations', 'review_subject_id,reconciliation_decision_id', 'invocation_id'),
    readRows<OperationRow>(org, 'materialization_operations', 'reconciliation_decision_id,status,resulting_canonical_object_id,resulting_relationship_id', 'materialization_operation_id'),
    readRows<RunRow>(org, 'acquisition_runs', 'run_id,source_connection_id,started_at,source_version', 'run_id'),
  ]);
  const byFinding = new Map(reviews.map(row => [row.finding_id, row]));
  const decisionIds = new Set(decisions.map(row => row.review_subject_id));
  const byRun = new Map(runs.map(run => [run.run_id, run]));
  const all: ChainCandidate[] = candidates.map(row => {
    const candidate = rehydrateNormalizedCandidate(row.envelope);
    if (normalizedCandidateEnvelopeHash(candidate) !== row.envelope_hash) throw new Error('CHAIN_CANDIDATE_HASH_MISMATCH');
    const run = byRun.get(row.acquisition_run_id);
    if (!run || run.source_connection_id !== candidate.sourceObject.connectionId || !Number.isFinite(Date.parse(run.started_at))) {
      throw new ChainCommandError('Discovery run provenance is unavailable or inconsistent. Use individual review.');
    }
    const review = byFinding.get(candidate.findingId);
    const ids = [...new Set(mappings.filter(m => m.candidate_id === candidate.candidateId).map(m => m.canonical_object_id))];
    if (ids.length > 1) throw new ChainCommandError('A source mapping is ambiguous; use individual review.');
    const decision = decisions.find(d => d.review_subject_id === review?.review_subject_id);
    const applied = operations.find(o => o.reconciliation_decision_id === decision?.reconciliation_decision_id && o.status === 'APPLIED');
    return { candidate, reviewSubjectId: review?.review_subject_id, state: review?.state,
      canonicalId: ids[0] ?? applied?.resulting_canonical_object_id ?? applied?.resulting_relationship_id ?? undefined,
      hasDecision: !!review && decisionIds.has(review.review_subject_id),
      discoveryRun: { id: run.run_id, startedAt: run.started_at, sourceVersion: run.source_version ?? undefined } };
  });
  let members: ChainCandidate[];
  try { members = collectAgentChain(all, anchor); }
  catch { throw new ChainCommandError('No exact AGENT source was found for this anchor. Open its individual review.'); }
  const latest = latestDiscoveryChain(members);
  const alreadyGoverned: AlreadyGovernedChainItem[] = [];
  const resolvedMembers = await Promise.all(latest.current.map(async row => {
    const c = row.candidate;
    if (c.candidateKind !== 'AGENT' || row.reviewSubjectId) return row;
    const unresolved = { ...row, canonicalId: undefined };
    try {
      // DEC-REV-001-B: read the existing exact binding. Do not create a review,
      // promote this candidate, reconcile it again or write another mapping.
      const resolved = await canonicalEndpointResolution.resolveEndpoint(org, {
        referenceKind: 'CANDIDATE', candidateKind: 'AGENT', candidateId: c.candidateId,
      });
      if (resolved.organisationId !== org || resolved.kind !== 'AGENT') return unresolved;
      const identity = normalizedObjectIdentity(c);
      const exact = mappings.filter(m => m.canonical_object_kind === 'AGENT' &&
        m.source_connection_id === c.sourceObject.connectionId && m.source_external_type === c.sourceObject.externalType &&
        m.source_external_id === c.sourceObject.externalId && m.normalized_object_identity === identity);
      if (exact.length !== 1 || exact[0].canonical_object_id !== resolved.objectId || !exact[0].created_by_decision_id) return unresolved;
      const origin = all.find(r => r.candidate.candidateId === exact[0].candidate_id)?.candidate;
      const name = sourceName('AGENT', c.proposedIdentity) ?? c.sourceObject.externalId;
      alreadyGoverned.push({ candidateId: c.candidateId, sourceName: name, sourceId: c.sourceObject.externalId, kind: 'AGENT',
        canonicalId: resolved.objectId, mappedSourceName: origin?.candidateKind === 'AGENT' ? sourceName('AGENT', origin.proposedIdentity) ?? name : name,
        earlierDecisionId: exact[0].created_by_decision_id });
      return { ...row, canonicalId: resolved.objectId };
    } catch (error) {
      if (error instanceof EndpointResolutionError) return unresolved;
      throw error;
    }
  }));
  alreadyGoverned.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const pending = resolvedMembers.filter(row => !row.canonicalId);
  const matchKey = objectIdentityKey;
  const canonicalKinds = new Map(objects.map(o => [o.canonical_object_id, o.kind]));
  const matchesByIdentity = new Map<string, Map<string, ChainMatch>>();
  for (const row of all) {
    const c = row.candidate;
    if (!row.canonicalId || c.candidateKind === 'RELATIONSHIP' || !['AGENT', 'AGENT_VERSION', 'MODEL', 'TOOL', 'PROMPT'].includes(c.candidateKind) ||
      canonicalKinds.get(row.canonicalId) !== c.candidateKind) continue;
    const key = matchKey(c);
    if (!key) continue;
    const matches = matchesByIdentity.get(key) ?? new Map<string, ChainMatch>();
    matches.set(row.canonicalId, { id: row.canonicalId, label: sourceName(c.candidateKind, c.proposedIdentity) ?? row.canonicalId });
    matchesByIdentity.set(key, matches);
  }
  const items = pending.map(row => {
    const c = row.candidate;
    // Exact normalized identity is a reconciliation signal, never authority.
    // The human sees and authorizes the proposed target. Merely sharing a kind
    // (or a display name) is insufficient even when only one object exists.
    const key = c.candidateKind === 'RELATIONSHIP' ? undefined : matchKey(c);
    const matches = key ? [...(matchesByIdentity.get(key)?.values() ?? [])].sort((a, b) => a.id.localeCompare(b.id)) : [];
    const item = chainItem(row, resolvedMembers, matches, all);
    if (c.candidateKind !== 'RELATIONSHIP' && !key) item.needsIndividualReview = 'Normalized identity unavailable; needs individual review.';
    return item;
  });
  // For an endpoint being matched in this same batch, preview relationships
  // against that explicitly proposed target. A newly-created endpoint cannot
  // have an existing canonical edge before the governed object exists.
  for (const item of items) {
    const row = pending.find(r => r.candidate.candidateId === item.candidateId)!;
    if (row.candidate.candidateKind !== 'RELATIONSHIP') continue;
    const c = row.candidate;
    const endpointIds = [c.sourceEndpoint, c.targetEndpoint].map(ref => {
      const endpoints = referenceCandidates(ref, resolvedMembers);
      if (endpoints.length !== 1) return undefined;
      return endpoints[0].canonicalId ?? items.find(i => i.candidateId === endpoints[0].candidate.candidateId)?.match?.id;
    });
    if (endpointIds.every(Boolean)) {
      const matches = relationships.filter(r => !r.valid_to && r.relationship_type === c.relationshipTypeCode &&
        r.source_canonical_object_id === endpointIds[0] && r.target_canonical_object_id === endpointIds[1]);
      if (matches.length > 1) item.needsIndividualReview = 'Multiple reconciliation candidates; needs individual review.';
      if (matches.length) { item.outcome = 'MATCH_EXISTING'; item.match = { id: matches[0].relationship_id, label: matches[0].relationship_id }; }
    }
  }
  const ordered = orderChain(items);
  const errors = [...latest.errors, ...duplicateCreateErrors(ordered)];
  const previewKey = createHash('sha256').update(JSON.stringify([org, anchor, ordered,
    alreadyGoverned, latest.superseded, errors, members.map(r => [normalizedCandidateEnvelopeHash(r.candidate), r.discoveryRun])])).digest('hex');
  return { items: ordered, alreadyGoverned, superseded: latest.superseded, errors, previewKey, batchId: randomUUID() };
}

export interface ApproveChainInput {
  anchor: ChainAnchor;
  previewKey: string;
  batchId: string;
  selectedIds: string[];
  justification: string;
}

export async function approveAgentChain(principal: GovernanceWritePrincipal, input: ApproveChainInput) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.batchId) || !input.justification.trim() || input.justification.length > 4000) {
    throw new ChainCommandError('A batch identifier and one justification of at most 4000 characters are required.');
  }
  const org = asOrganisationId(principal.organisationId);
  const plan = await previewAgentChain(org, input.anchor);
  if (plan.previewKey !== input.previewKey) throw new ChainCommandError('The chain changed. Reload the preview before approving.');
  if (plan.errors.length) throw new ChainCommandError(plan.errors.join(' '));
  let selected;
  try { selected = selectedChain(plan.items, input.selectedIds); }
  catch { throw new ChainCommandError('Select eligible items and all their pending dependencies.'); }
  const port = createGovernedReviewPersistence(principal);
  // Existing immutable reasonCode is the audit carrier. Each individual
  // certification and reconciliation retains the same human and batch reason.
  const reasonCode = `Agent chain batch ${input.batchId}\n${input.justification.trim()}`;
  return executeChain(input.batchId, selected, async (item, step) => {
    const base = { organisationId: org, actorUserId: principal.actorUserId,
      writePrincipal: principal, reviewSubjectId: asReviewSubjectId(item.reviewSubjectId), reasonCode };
    if (step === 'CONFIRM' || step === 'CERTIFY') {
      const result = step === 'CONFIRM' ? await workspaceCommands.confirmReview({ ...base, expectedState: 'PROPOSED' }, port)
        : await workspaceCommands.certifyReview({ ...base, expectedState: 'CONFIRMED' }, port);
      if (result.kind !== 'APPLIED' && result.kind !== 'REPLAYED') throw new ChainCommandError(`${step}: ${result.kind}`);
      return {};
    }
    if (step === 'RECONCILE') {
      const result = await submitReconciliationDecision({ ...base, requestedOutcome: item.outcome,
        ...(item.kind === 'RELATIONSHIP' ? { matchCanonicalRelationshipId: item.match?.id } : { matchCanonicalObjectId: item.match?.id }) });
      if (result.kind !== 'APPLIED' && result.kind !== 'REPLAYED') throw new ChainCommandError(`RECONCILE: ${result.kind}`);
      return { decisionId: result.reconciliationDecisionId };
    }
    const result = await triggerMaterialization(base);
    if ((result.kind !== 'APPLIED' && result.kind !== 'REPLAYED') || result.result.result.status !== 'APPLIED') {
      throw new ChainCommandError(`MATERIALIZE: ${result.kind}`);
    }
    const value = result.result;
    return { canonicalId: value.family === 'OBJECT' ? value.result.canonicalObjectId : value.result.relationshipId };
  }, async item => {
    const detail = await getGovernanceDecisionDetail(org, asReviewSubjectId(item.reviewSubjectId));
    return { applied: detail?.materialization?.status === 'APPLIED',
      canonicalId: detail?.materialization?.canonicalObjectId ?? detail?.materialization?.relationshipId };
  });
}
