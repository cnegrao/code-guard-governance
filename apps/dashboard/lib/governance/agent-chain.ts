import type { NormalizedCandidate, PreCanonicalObjectReference, SourceObjectIdentity } from '@council/canonical-contracts';
import { normalizedObjectIdentity, type ReviewState } from '@council/governance-review';
import { sourceName } from './source-name';

/** A preview is a proposal only. No transition or canonical write lives here. */
export interface ChainCandidate {
  candidate: NormalizedCandidate;
  reviewSubjectId?: string;
  state?: ReviewState;
  canonicalId?: string;
  hasDecision?: boolean;
  discoveryRun?: { id: string; startedAt: string; sourceVersion?: string };
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
  dependencyLabels?: string[];
  identityKey?: string;
  outcome: 'CREATE_NEW' | 'MATCH_EXISTING';
  match?: ChainMatch;
  needsIndividualReview?: string;
}
export interface SupersededChainItem {
  candidateId: string; reviewSubjectId?: string; sourceName: string; kind: string; sourceId: string;
  runId: string; sourceVersion?: string; newerRunId: string; newerSourceVersion?: string;
}
export interface AgentChainPlan { items: AgentChainItem[]; superseded: SupersededChainItem[]; errors: string[]; previewKey: string; batchId: string }
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

export function objectIdentityKey(c: NormalizedCandidate): string | undefined {
  if (c.candidateKind === 'RELATIONSHIP') return undefined;
  try { return JSON.stringify([c.candidateKind, normalizedObjectIdentity(c)]); }
  catch { return undefined; }
}
function scopedIdentity(c: NormalizedCandidate) {
  const key = objectIdentityKey(c);
  return key ? JSON.stringify([c.sourceObject.connectionId, c.sourceObject.externalType, c.sourceObject.externalId, key]) : undefined;
}
function discoveryIdentity(c: NormalizedCandidate) {
  const key = objectIdentityKey(c);
  // One configured repository/source connection across acquisition runs.
  // Artifact locations remain provenance and may move between commits.
  return key ? JSON.stringify([c.sourceObject.connectionId, key]) : undefined;
}
function candidateName(c: NormalizedCandidate): string {
  return c.candidateKind === 'RELATIONSHIP' ? c.relationshipTypeCode : sourceName(c.candidateKind, c.proposedIdentity) ?? c.sourceObject.externalId;
}

/** SOURCE_OBJECT references are accepted only when they name one exact candidate.
 * A file never selects one of several same-kind declarations or versions. */
export function referenceCandidates(ref: PreCanonicalObjectReference, all: readonly ChainCandidate[]): ChainCandidate[] {
  return all.filter(({ candidate: c }) => c.candidateKind === ref.candidateKind &&
    (ref.referenceKind === 'CANDIDATE' ? c.candidateId === ref.candidateId : sameSource(c.sourceObject, ref.sourceObject)));
}

export function collectAgentChain(all: readonly ChainCandidate[], anchor: { reviewId?: string; canonicalId?: string }): ChainCandidate[] {
  const anchors = all.filter(r => r.candidate.candidateKind === 'AGENT' &&
    (anchor.reviewId ? r.reviewSubjectId === anchor.reviewId : r.canonicalId === anchor.canonicalId));
  if (!anchors.length) throw new Error('AGENT_NOT_FOUND');
  // Include the new source proposal, not an inferred canonical mapping. It
  // still needs its own human MATCH_EXISTING decision before its dependents.
  const anchorKeys = new Set(anchors.map(r => discoveryIdentity(r.candidate)).filter(Boolean));
  const roots = all.filter(r => r.candidate.candidateKind === 'AGENT' &&
    (anchors.includes(r) || anchorKeys.has(discoveryIdentity(r.candidate))));
  const rootIds = new Set(roots.map(r => r.candidate.candidateId));
  const versions = all.filter(r => {
    if (r.candidate.candidateKind !== 'AGENT_VERSION') return false;
    const parents = referenceCandidates(r.candidate.proposedIdentity.agent, all);
    return parents.some(parent => rootIds.has(parent.candidate.candidateId)) ||
      (!parents.length && roots.some(root => sameSource(root.candidate.sourceObject, r.candidate.sourceObject)));
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

/** Select proposal provenance only. Canonical versions/endpoints and immutable
 * candidate envelopes are never rewritten or chosen by recency. */
export function latestDiscoveryChain(members: readonly ChainCandidate[]) {
  const groups = new Map<string, ChainCandidate[]>();
  const errors: string[] = [];
  for (const row of members) {
    const c = row.candidate;
    if (c.candidateKind === 'RELATIONSHIP') continue;
    let key = discoveryIdentity(c) ?? c.candidateId;
    if (c.candidateKind === 'AGENT_VERSION') {
      const exactParents = referenceCandidates(c.proposedIdentity.agent, members);
      // Source context can group an unresolved proposal for display/recency
      // only. chainItem still requires its original exact parent reference;
      // this never supplies a canonical endpoint or a substitute parent.
      const parents = exactParents.length ? exactParents : members.filter(parent => parent.candidate.candidateKind === 'AGENT' && sameSource(parent.candidate.sourceObject, c.sourceObject));
      const parentKeys = [...new Set(parents.map(parent => discoveryIdentity(parent.candidate)).filter(Boolean))];
      // Select the newest discovery run for this logical parent's proposal
      // set. Keep every distinct technical revision in that same run; the
      // AGENT_VERSION normalized identity remains its exact discriminator.
      key = JSON.stringify(['version-proposal-run', c.sourceObject.connectionId, parentKeys.length === 1 ? parentKeys[0] : c.proposedIdentity.agent]);
    }
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const current: ChainCandidate[] = [];
  const superseded: SupersededChainItem[] = [];
  const replacements = new Map<string, ChainCandidate>();
  function retire(row: ChainCandidate, newer: ChainCandidate) {
    replacements.set(row.candidate.candidateId, newer);
    superseded.push({ candidateId: row.candidate.candidateId, reviewSubjectId: row.reviewSubjectId,
      sourceName: candidateName(row.candidate), kind: row.candidate.candidateKind, sourceId: row.candidate.sourceObject.externalId,
      runId: row.discoveryRun?.id ?? 'UNKNOWN', sourceVersion: row.discoveryRun?.sourceVersion,
      newerRunId: newer.discoveryRun!.id, newerSourceVersion: newer.discoveryRun?.sourceVersion });
  }
  for (const group of groups.values()) {
    if (group.length === 1) { current.push(group[0]); continue; }
    if (group.some(row => !row.discoveryRun || !Number.isFinite(Date.parse(row.discoveryRun.startedAt)))) {
      errors.push(`Discovery run chronology is unavailable for ${candidateName(group[0].candidate)}. Use individual review.`);
      current.push(...group); continue;
    }
    const newestTime = Math.max(...group.map(row => Date.parse(row.discoveryRun!.startedAt)));
    const newest = group.filter(row => Date.parse(row.discoveryRun!.startedAt) === newestTime);
    if (new Set(newest.map(row => row.discoveryRun!.id)).size !== 1) {
      errors.push(`Discovery runs have tied start times for ${candidateName(group[0].candidate)}. Use individual review.`);
      current.push(...group); continue;
    }
    current.push(...newest);
    for (const row of group.filter(row => !newest.includes(row))) retire(row, newest[0]);
  }
  for (const row of members) {
    const c = row.candidate;
    if (c.candidateKind !== 'RELATIONSHIP') continue;
    const refs = [c.sourceEndpoint, c.targetEndpoint];
    const absent = refs.filter(ref => !referenceCandidates(ref, current).length);
    const replacement = absent.flatMap(ref => referenceCandidates(ref, members)).map(endpoint => replacements.get(endpoint.candidate.candidateId)).find(Boolean);
    if (absent.length && replacement?.discoveryRun) retire(row, replacement);
    else current.push(row);
  }
  return { current, superseded, errors };
}

export function duplicateCreateErrors(items: readonly AgentChainItem[]): string[] {
  const creates = new Map<string, AgentChainItem>();
  const errors: string[] = [];
  for (const item of items) {
    if (item.outcome !== 'CREATE_NEW' || !item.identityKey) continue;
    const previous = creates.get(item.identityKey);
    if (previous) errors.push(`Duplicate CREATE NEW identity: ${previous.sourceName} (${previous.kind}, ${previous.sourceId}) and ${item.sourceName} (${item.kind}, ${item.sourceId}). This preview cannot be approved.`);
    creates.set(item.identityKey, item);
  }
  return errors;
}

export function reconciliationProposal(matches: readonly ChainMatch[]): Pick<AgentChainItem, 'outcome' | 'match' | 'needsIndividualReview'> {
  if (matches.length > 1) return { outcome: 'MATCH_EXISTING', needsIndividualReview: 'Multiple reconciliation candidates; needs individual review.' };
  return matches.length === 1 ? { outcome: 'MATCH_EXISTING', match: matches[0] } : { outcome: 'CREATE_NEW' };
}

export function chainItem(row: ChainCandidate, members: readonly ChainCandidate[], matches: readonly ChainMatch[], sourceHistory = members): AgentChainItem {
  const c = row.candidate;
  const refs = c.candidateKind === 'AGENT_VERSION' ? [c.proposedIdentity.agent]
    : c.candidateKind === 'RELATIONSHIP' ? [c.sourceEndpoint, c.targetEndpoint] : [];
  const dependencyRows = refs.flatMap(ref => referenceCandidates(ref, members)).filter(r => !r.canonicalId);
  const missingRefs = refs.filter(ref => !referenceCandidates(ref, members).length);
  const referenceLabel = (ref: PreCanonicalObjectReference) => {
    const rows = referenceCandidates(ref, sourceHistory);
    const names = rows.length ? rows.map(r => candidateName(r.candidate)).join(', ')
      : members.filter(r => r.candidate.candidateKind === ref.candidateKind && sameSource(r.candidate.sourceObject, c.sourceObject)).map(r => candidateName(r.candidate)).join(', ') || c.sourceObject.externalId;
    return `${ref.candidateKind} proposal ${names}${ref.referenceKind === 'CANDIDATE' ? ` (${ref.candidateId})` : ''}`;
  };
  const dependencies = [...dependencyRows.map(r => r.reviewSubjectId ?? `missing:${r.candidate.candidateId}`),
    ...missingRefs.map(ref => `missing:${ref.referenceKind === 'CANDIDATE' ? ref.candidateId : ref.sourceObject.externalId}`)];
  const dependencyLabels = [...dependencyRows.map(r => `${r.candidate.candidateKind} ${candidateName(r.candidate)}${r.reviewSubjectId ? '' : ' — missing pending review'}`), ...missingRefs.map(referenceLabel)];
  const identity = c.candidateKind === 'RELATIONSHIP' ? null : sourceName(c.candidateKind, c.proposedIdentity);
  const ambiguous = refs.filter(ref => referenceCandidates(ref, members).length > 1 || (ref.referenceKind === 'SOURCE_OBJECT' &&
    new Set(referenceCandidates(ref, sourceHistory).map(r => scopedIdentity(r.candidate))).size > 1));
  const reason = missingRefs.length ? `Missing ${missingRefs.map(referenceLabel).join('; ')}; needs individual review.`
    : ambiguous.length ? `Ambiguous ${ambiguous.map(referenceLabel).join('; ')}; needs individual review.`
    : row.hasDecision ? 'An existing reconciliation decision requires individual review.'
    : !row.reviewSubjectId || !row.state || !['PROPOSED', 'CONFIRMED', 'CERTIFIED'].includes(row.state)
      ? `A pending human review is unavailable for ${c.candidateKind} ${candidateName(c)} (${c.candidateId}); needs individual review.` : undefined;
  const identityKey = c.candidateKind !== 'RELATIONSHIP' ? objectIdentityKey(c)
    : JSON.stringify(['RELATIONSHIP', c.relationshipTypeCode, ...refs.map(ref => referenceCandidates(ref, members).map(r => objectIdentityKey(r.candidate)).sort())]);
  return {
    reviewSubjectId: row.reviewSubjectId ?? `missing:${c.candidateId}`, candidateId: c.candidateId,
    sourceName: identity ?? (c.candidateKind === 'RELATIONSHIP' ? c.relationshipTypeCode : c.sourceObject.externalId),
    sourceId: c.sourceObject.externalId, kind: c.candidateKind, state: row.state ?? 'DETECTED', dependencies, dependencyLabels, identityKey,
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
    const blocked = item.dependencies.filter(id => !byId.has(id) || byId.get(id)?.needsIndividualReview);
    const labels = blocked.map(id => byId.get(id)?.sourceName ?? item.dependencyLabels?.[item.dependencies.indexOf(id)] ?? id);
    const next = blocked.length ? { ...item, needsIndividualReview: item.needsIndividualReview ?? `A dependency needs individual review: ${labels.join(', ')}.` } : item;
    byId.set(item.reviewSubjectId, next);
    return next;
  });
}

export function selectedChain(items: readonly AgentChainItem[], selectedIds: readonly string[]): AgentChainItem[] {
  const selected = new Set(selectedIds);
  if (!selected.size || selected.size !== selectedIds.length || selectedIds.some(id => !items.some(item => item.reviewSubjectId === id))) throw new Error('INVALID_SELECTION');
  const result = orderChain(items).filter(item => selected.has(item.reviewSubjectId));
  const duplicateErrors = duplicateCreateErrors(result);
  if (duplicateErrors.length) throw new ChainCommandError(duplicateErrors.join(' '));
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
