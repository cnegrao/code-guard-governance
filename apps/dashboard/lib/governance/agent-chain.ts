import type { NormalizedCandidate, PreCanonicalObjectReference, SourceObjectIdentity } from '@council/canonical-contracts';
import type { ReviewState } from '@council/governance-review';
import { sourceName } from './source-name';

/** A preview is a proposal only. No transition or canonical write lives here. */
export interface ChainCandidate {
  candidate: NormalizedCandidate;
  reviewSubjectId?: string;
  state?: ReviewState;
  canonicalId?: string;
  hasDecision?: boolean;
}
export interface ChainMatch { id: string; label: string }
export interface AgentChainItem {
  reviewSubjectId: string;
  candidateId: string;
  sourceName: string;
  sourceId: string;
  kind: string;
  state: ReviewState;
  dependencies: string[];
  outcome: 'CREATE_NEW' | 'MATCH_EXISTING';
  match?: ChainMatch;
  needsIndividualReview?: string;
}
export interface AgentChainPlan { items: AgentChainItem[]; previewKey: string; batchId: string }
export type ChainStep = 'CONFIRM' | 'CERTIFY' | 'RECONCILE' | 'MATERIALIZE';
export interface ChainItemResult {
  reviewSubjectId: string;
  status: 'MATERIALIZED' | 'FAILED' | 'NOT_RUN' | 'UNKNOWN';
  completedSteps: ChainStep[];
  failedStep?: ChainStep;
  error?: string;
  canonicalId?: string;
  decisionId?: string;
}
export interface AgentChainResult { batchId: string; items: ChainItemResult[] }

const sameSource = (a: SourceObjectIdentity, b: SourceObjectIdentity) =>
  a.connectionId === b.connectionId && a.externalType === b.externalType && a.externalId === b.externalId;

/** SOURCE_OBJECT references are accepted only when they name one exact candidate.
 * A file never selects one of several same-kind declarations or versions. */
export function referenceCandidates(ref: PreCanonicalObjectReference, all: readonly ChainCandidate[]): ChainCandidate[] {
  return all.filter(({ candidate: c }) => c.candidateKind === ref.candidateKind &&
    (ref.referenceKind === 'CANDIDATE' ? c.candidateId === ref.candidateId : sameSource(c.sourceObject, ref.sourceObject)));
}

export function collectAgentChain(all: readonly ChainCandidate[], anchor: { reviewId?: string; canonicalId?: string }): ChainCandidate[] {
  const roots = all.filter(r => r.candidate.candidateKind === 'AGENT' &&
    (anchor.reviewId ? r.reviewSubjectId === anchor.reviewId : r.canonicalId === anchor.canonicalId));
  if (!roots.length) throw new Error('AGENT_NOT_FOUND');
  const rootIds = new Set(roots.map(r => r.candidate.candidateId));
  const versions = all.filter(r => {
    if (r.candidate.candidateKind !== 'AGENT_VERSION') return false;
    const parents = referenceCandidates(r.candidate.proposedIdentity.agent, all);
    return parents.some(parent => rootIds.has(parent.candidate.candidateId));
  });
  // The version's persisted correlation support binds these declarations to
  // that revision. A shared file path alone cannot admit an object.
  const objects = all.filter(({ candidate: c }) => ['MODEL', 'TOOL', 'PROMPT'].includes(c.candidateKind) &&
    versions.some(({ candidate: v }) => sameSource(c.sourceObject, v.sourceObject) && c.assertionIds.length > 0 && c.evidenceIds.length > 0 &&
      c.assertionIds.every(id => v.assertionIds.includes(id)) && c.evidenceIds.every(id => v.evidenceIds.includes(id))));
  const members = [...roots, ...versions, ...objects];
  const ids = new Set(members.map(r => r.candidate.candidateId));
  const relationships = all.filter(({ candidate: c }) => {
    if (c.candidateKind !== 'RELATIONSHIP' || !['USES_MODEL', 'USES_TOOL', 'DERIVED_FROM'].includes(c.relationshipTypeCode)) return false;
    return [c.sourceEndpoint, c.targetEndpoint].every(ref => {
      const found = referenceCandidates(ref, all);
      return found.some(endpoint => ids.has(endpoint.candidate.candidateId));
    });
  });
  return [...members, ...relationships];
}

export function reconciliationProposal(matches: readonly ChainMatch[]): Pick<AgentChainItem, 'outcome' | 'match' | 'needsIndividualReview'> {
  if (matches.length > 1) return { outcome: 'MATCH_EXISTING', needsIndividualReview: 'Multiple reconciliation candidates; needs individual review.' };
  return matches.length === 1 ? { outcome: 'MATCH_EXISTING', match: matches[0] } : { outcome: 'CREATE_NEW' };
}

export function chainItem(row: ChainCandidate, members: readonly ChainCandidate[], matches: readonly ChainMatch[]): AgentChainItem {
  const c = row.candidate;
  const refs = c.candidateKind === 'AGENT_VERSION' ? [c.proposedIdentity.agent]
    : c.candidateKind === 'RELATIONSHIP' ? [c.sourceEndpoint, c.targetEndpoint] : [];
  const dependencies = refs.flatMap(ref => referenceCandidates(ref, members))
    .filter(r => !r.canonicalId).map(r => r.reviewSubjectId ?? `missing:${r.candidate.candidateId}`);
  const identity = c.candidateKind === 'RELATIONSHIP' ? null : sourceName(c.candidateKind, c.proposedIdentity);
  const reason = refs.some(ref => referenceCandidates(ref, members).length !== 1) ? 'An endpoint or parent is ambiguous; needs individual review.'
    : row.hasDecision ? 'An existing reconciliation decision requires individual review.'
    : !row.reviewSubjectId || !row.state || !['PROPOSED', 'CONFIRMED', 'CERTIFIED'].includes(row.state)
      ? 'A pending human review is unavailable; needs individual review.' : undefined;
  return {
    reviewSubjectId: row.reviewSubjectId ?? `missing:${c.candidateId}`, candidateId: c.candidateId,
    sourceName: identity ?? (c.candidateKind === 'RELATIONSHIP' ? c.relationshipTypeCode : c.sourceObject.externalId),
    sourceId: c.sourceObject.externalId, kind: c.candidateKind, state: row.state ?? 'DETECTED', dependencies,
    ...reconciliationProposal(matches), ...(reason ? { needsIndividualReview: reason } : {}),
  };
}

/** Stable topological ordering. Cycles and unavailable dependencies fail closed. */
export function orderChain(items: readonly AgentChainItem[]): AgentChainItem[] {
  const ordered: AgentChainItem[] = [];
  const pending = new Map(items.map(item => [item.reviewSubjectId, item]));
  if (pending.size !== items.length) throw new Error('DUPLICATE_REVIEW');
  while (pending.size) {
    const ready = [...pending.values()].filter(item => item.dependencies.every(id => !pending.has(id)))
      .sort((a, b) => a.reviewSubjectId.localeCompare(b.reviewSubjectId));
    if (!ready.length) throw new Error('DEPENDENCY_CYCLE');
    for (const item of ready) { ordered.push(item); pending.delete(item.reviewSubjectId); }
  }
  const byId = new Map(ordered.map(item => [item.reviewSubjectId, item]));
  return ordered.map(item => {
    const blocked = item.dependencies.some(id => !byId.has(id) || byId.get(id)?.needsIndividualReview);
    const next = blocked ? { ...item, needsIndividualReview: 'A dependency needs individual review.' } : item;
    byId.set(item.reviewSubjectId, next);
    return next;
  });
}

export function selectedChain(items: readonly AgentChainItem[], selectedIds: readonly string[]): AgentChainItem[] {
  const selected = new Set(selectedIds);
  if (!selected.size || selected.size !== selectedIds.length || selectedIds.some(id => !items.some(item => item.reviewSubjectId === id))) throw new Error('INVALID_SELECTION');
  const result = orderChain(items).filter(item => selected.has(item.reviewSubjectId));
  for (const item of result) {
    if (item.needsIndividualReview || item.dependencies.some(id => !selected.has(id))) throw new Error('DEPENDENCY_NOT_SELECTED');
  }
  return result;
}

/** Sequential coordination only. Every write is supplied by the existing
 * governed services. A failure never rolls back or advances another item. */
export async function executeChain(
  batchId: string, items: readonly AgentChainItem[],
  run: (item: AgentChainItem, step: ChainStep) => Promise<{ decisionId?: string; canonicalId?: string }>,
  inspectFailure: (item: AgentChainItem) => Promise<{ applied: boolean; canonicalId?: string }>,
): Promise<AgentChainResult> {
  const results: ChainItemResult[] = items.map(item => ({ reviewSubjectId: item.reviewSubjectId, status: 'NOT_RUN', completedSteps: [] }));
  for (let index = 0; index < items.length; index++) {
    const item = items[index], result = results[index];
    const steps: ChainStep[] = [...(item.state === 'PROPOSED' ? ['CONFIRM' as const] : []),
      ...(item.state !== 'CERTIFIED' ? ['CERTIFY' as const] : []), 'RECONCILE', 'MATERIALIZE'];
    for (const step of steps) {
      try {
        Object.assign(result, await run(item, step));
        result.completedSteps.push(step);
      } catch (error) {
        result.status = 'FAILED'; result.failedStep = step;
        result.error = error instanceof ChainCommandError ? error.message : 'The governed operation failed. Review this item before retrying.';
        // A lost RPC response may follow a committed write. Read its receipt;
        // if that read also fails, report UNKNOWN, never assert rollback.
        try {
          const persisted = await inspectFailure(item);
          if (persisted.applied) { result.status = 'MATERIALIZED'; result.canonicalId = persisted.canonicalId; }
        } catch { result.status = 'UNKNOWN'; }
        return { batchId, items: results };
      }
    }
    result.status = 'MATERIALIZED';
  }
  return { batchId, items: results };
}

export class ChainCommandError extends Error {}
