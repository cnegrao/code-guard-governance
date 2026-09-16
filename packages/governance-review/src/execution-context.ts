import { createHash } from 'node:crypto';
import { createExecutionFact, DIRECT_EXECUTION_FIELDS, sourceObjectIdentityKey, type ExecutionSourceSnapshot,
  type ExecutionFieldDecision, type ExecutionFieldAuthorityPolicy, type ExecutionFieldAuthorityPolicyHead,
  type CanonicalObjectIdentity, type OrganisationId } from '@council/canonical-contracts';
import { stableCandidateContent } from './canonical-endpoint-resolution';

export const executionDigest = (v: unknown): string => createHash('sha256').update(stableCandidateContent(v)).digest('hex');
function closed(value: unknown, required: readonly string[], optional: readonly string[] = []): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d)) ||
    required.some(k => !Object.hasOwn(value,k)) ||
    Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) throw new TypeError('EXECUTION_SNAPSHOT_INVALID');
}
export function validateExecutionSnapshot(snapshot: ExecutionSourceSnapshot): void {
  closed(snapshot,['organisationId','snapshotId','sourceScope','agentVersionCandidateId','sourceObject','sourceSystemId','providerCode',
    'declarationKey','sourceSnapshotId','behaviorFingerprint','recordedAt','authorizationState','facts']);
  closed(snapshot.sourceObject,['connectionId','externalType','externalId']);
  closed(snapshot.behaviorFingerprint,['algorithm','schemaVersion','value']);
  if (!snapshot.organisationId || snapshot.authorizationState !== 'UNKNOWN' || !snapshot.declarationKey ||
    !/^candidate:agent-version:[a-f0-9]{32}$/.test(snapshot.agentVersionCandidateId) ||
    !snapshot.sourceSystemId || !snapshot.providerCode || !snapshot.sourceSnapshotId ||
    !snapshot.sourceObject.connectionId || !snapshot.sourceObject.externalId || !snapshot.sourceObject.externalType ||
    snapshot.behaviorFingerprint.algorithm !== 'sha256' || !['1.0','1.1'].includes(snapshot.behaviorFingerprint.schemaVersion) ||
    !/^[a-f0-9]{32}$/.test(snapshot.behaviorFingerprint.value) || !Number.isFinite(Date.parse(snapshot.recordedAt)) ||
    !Array.isArray(snapshot.facts) || snapshot.facts.length > 193) throw new TypeError('EXECUTION_SNAPSHOT_INVALID');
  for (const item of snapshot.facts) {
    closed(item,['fact','assertionId','evidenceId'],['toolCandidateId']);
    const fact = createExecutionFact(item.fact);
    if(stableCandidateContent(fact)!==stableCandidateContent(item.fact))throw new TypeError('EXECUTION_FACT_NOT_CANONICAL');
    if (!DIRECT_EXECUTION_FIELDS.includes(fact.field as never) || !item.assertionId || !item.evidenceId ||
      (fact.field === 'CAPABILITY' ? !item.toolCandidateId : item.toolCandidateId !== undefined)) throw new TypeError('EXECUTION_FACT_SUPPORT_INVALID');
  }
  if (snapshot.facts.filter(f => f.fact.field === 'PRINCIPAL').length > 1) throw new TypeError('EXECUTION_PRINCIPAL_AMBIGUOUS');
  const scope = executionDigest([sourceObjectIdentityKey(snapshot.sourceObject), snapshot.declarationKey]);
  const id = executionDigest([snapshot.organisationId, scope, snapshot.agentVersionCandidateId, snapshot.sourceSnapshotId,
    snapshot.facts.map(f => ({ fact: f.fact, assertionId: f.assertionId, evidenceId: f.evidenceId, toolCandidateId: f.toolCandidateId }))]);
  if (snapshot.sourceScope !== scope || snapshot.snapshotId !== `execution-snapshot:${id}`) throw new TypeError('EXECUTION_IDENTITY_MISMATCH');
}
export interface ExecutionReviewContext {
  readonly snapshot: ExecutionSourceSnapshot;
  readonly object?: CanonicalObjectIdentity<'AGENT_VERSION'>;
  readonly currentSourceSnapshotId?: string;
  readonly currentStateId?: string;
  readonly policies: readonly ExecutionFieldAuthorityPolicy[];
  readonly policyHeads: readonly ExecutionFieldAuthorityPolicyHead[];
}
export interface ExecutionContextPersistencePort {
  recordSnapshot(snapshot: ExecutionSourceSnapshot): Promise<void>;
  getReviewContext(org: OrganisationId, snapshotId: string, field: ExecutionFieldDecision['field']): Promise<ExecutionReviewContext>;
  getDecision(org: OrganisationId, id: string): Promise<{ decision: ExecutionFieldDecision; stateId?: string } | undefined>;
  /** Transaction must repeat source, mapping, policy and predecessor checks. */
  recordDecision(decision: ExecutionFieldDecision): Promise<{ replay: boolean; stateId?: string }>;
}
export function executionPolicy(ctx: ExecutionReviewContext, field: ExecutionFieldDecision['field']) {
  const s = ctx.snapshot;
  const heads = ctx.policyHeads.filter(h => h.organisationId === s.organisationId);
  if (new Set(heads.map(h => h.policyId)).size !== heads.length) throw new TypeError('EXECUTION_POLICY_AMBIGUOUS');
  const policies = heads.map(h => {
    const matches = ctx.policies.filter(p => p.organisationId === h.organisationId && p.policyId === h.policyId && p.version === h.version);
    if (matches.length !== 1 || !h.version) throw new TypeError('EXECUTION_POLICY_INVALID'); return matches[0];
  }).filter(p => p.objectKind === 'AGENT_VERSION' && p.field === field && p.sourceSystemId === s.sourceSystemId &&
    p.providerCode === s.providerCode && (!p.connectionId || p.connectionId === s.sourceObject.connectionId));
  if (policies.length > 1) throw new TypeError('EXECUTION_POLICY_AMBIGUOUS');
  return policies[0];
}
/** Same governed field outcomes/explicit policy heads as M10. Human V1 only. */
export async function reconcileExecutionField(decision: ExecutionFieldDecision, port: ExecutionContextPersistencePort,
  authorization: { authorize(decision: ExecutionFieldDecision): boolean | Promise<boolean> }) {
  decision = structuredClone(decision);
  if (!authorization || !await authorization.authorize(decision) || decision.actor.authorityKind !== 'HUMAN' ||
      !decision.actor.actorReference.trim()) throw new TypeError('EXECUTION_REVIEW_FORBIDDEN');
  if (!decision.decisionId || !DIRECT_EXECUTION_FIELDS.includes(decision.field) ||
    !['ACCEPT_PROPOSED','KEEP_CURRENT','DEFER','REJECT_PROPOSED'].includes(decision.outcome) ||
    !Number.isFinite(Date.parse(decision.decidedAt))) throw new TypeError('EXECUTION_DECISION_INVALID');
  const previous = await port.getDecision(decision.organisationId, decision.decisionId);
  if (previous) {
    if (stableCandidateContent(previous.decision) !== stableCandidateContent(decision)) throw new TypeError('EXECUTION_REPLAY_CONFLICT');
    return { replay: true, stateId: previous.stateId };
  }
  const ctx = await port.getReviewContext(decision.organisationId, decision.snapshotId, decision.field);
  validateExecutionSnapshot(ctx.snapshot);
  if (ctx.snapshot.organisationId !== decision.organisationId || ctx.snapshot.snapshotId !== decision.snapshotId ||
    !ctx.object || ctx.object.kind !== 'AGENT_VERSION' || decision.canonicalObject.kind !== 'AGENT_VERSION' ||
    ctx.object.organisationId !== decision.organisationId || decision.canonicalObject.organisationId !== decision.organisationId ||
    ctx.object.objectId !== decision.canonicalObject.objectId) throw new TypeError('EXECUTION_BINDING_MISMATCH');
  if (ctx.currentSourceSnapshotId !== decision.snapshotId) throw new TypeError('EXECUTION_STALE_SOURCE');
  if (ctx.currentStateId !== decision.expectedCurrentStateId) throw new TypeError('EXECUTION_STALE_STATE');
  const policy = executionPolicy(ctx, decision.field);
  if (policy?.policyId !== decision.policyId || policy?.version !== decision.policyVersion) throw new TypeError('EXECUTION_STALE_POLICY');
  if (decision.outcome === 'ACCEPT_PROPOSED' && (!policy || !['AUTHORITATIVE','CONTRIBUTING'].includes(policy.disposition))) throw new TypeError('EXECUTION_NO_FIELD_AUTHORITY');
  return port.recordDecision(decision);
}
