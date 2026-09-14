import { asIsoTimestamp, sourceObjectIdentityKey, validateTechnicalFact, type InboundAdapterEnvelope, type TrustedInboundConnection, type NormalizedObjectCandidate } from '@council/canonical-contracts';
import { bindTechnicalFact, factObservation, factDigest, type TechnicalFactPersistencePort } from './technical-facts.ts';
import type { DiscoveryIntakePersistencePort } from './discovery-intake-port.ts';
import type { GovernanceReviewPersistencePort } from './persistence-port.ts';
import type { MaterializationPersistencePort } from './materialization-port.ts';
import { normalizedObjectIdentity } from './canonical-endpoint-resolution.ts';
import { createReviewSubject } from './review-subject.ts';
import { asReviewSubjectId } from './identifiers.ts';
import { PassThroughSemanticProposalStrategy } from './semantic-proposal-strategy.ts';

function only(object: object, keys: readonly string[]): void {
  if (!object || typeof object !== 'object' || Object.getPrototypeOf(object) !== Object.prototype || Object.keys(object).some(k => !keys.includes(k))) throw new TypeError('INBOUND_FORBIDDEN_PROPERTY');
}
function unique<T>(items: readonly T[], key: (item: T) => string): Map<string,T> {
  if (!Array.isArray(items) || items.length > 5000) throw new TypeError('INBOUND_COLLECTION_LIMIT');
  const result = new Map<string,T>();
  for (const item of items) {
    const id = key(item);
    if (!id || result.has(id)) throw new TypeError('INBOUND_DUPLICATE_ID');
    result.set(id,item);
  }
  return result;
}
/** Complete reference gate for the closed DATA_ASSET/DATA_ELEMENT exchange population. */
export function validateInboundExchange(e: InboundAdapterEnvelope, trusted: TrustedInboundConnection, adapter: { name: string; version: string }): void {
  only(e, ['contractVersion','sourceSystem','connection','run','objects','snapshots','assertions','evidence','findings','candidates','technicalFacts']);
  only(e.sourceSystem, ['sourceSystemId','family','displayName','provider']);
  only(e.sourceSystem.provider, ['providerCode','resolution']);
  only(e.connection, ['connectionId','sourceSystemId']);
  only(e.run, ['runId','connection','mode','status','adapterName','adapterVersion','sourceVersion','checkpoint','startedAt','completedAt']);
  only(e.run.connection, ['connectionId','sourceSystemId']);
  if (!trusted.organisationId || e.contractVersion !== '1.0' || e.connection.connectionId !== trusted.connection.connectionId ||
    e.connection.sourceSystemId !== trusted.connection.sourceSystemId || e.sourceSystem.sourceSystemId !== trusted.sourceSystem.sourceSystemId ||
    e.sourceSystem.sourceSystemId !== e.connection.sourceSystemId || e.sourceSystem.family !== trusted.sourceSystem.family ||
    e.sourceSystem.provider.providerCode !== trusted.sourceSystem.provider.providerCode || e.sourceSystem.provider.resolution !== 'EXPLICIT' ||
    e.run.connection.connectionId !== e.connection.connectionId || e.run.connection.sourceSystemId !== e.connection.sourceSystemId ||
    e.run.adapterName !== adapter.name || e.run.adapterVersion !== adapter.version || e.run.status !== 'RUNNING') throw new TypeError('INBOUND_CONNECTION_MISMATCH');
  const objects = unique(e.objects, o => sourceObjectIdentityKey(o.identity));
  const source = (s: InboundAdapterEnvelope['objects'][number]['identity']) => {
    only(s, ['connectionId','externalType','externalId']);
    if (s.connectionId !== trusted.connection.connectionId || !s.externalId || !s.externalType || !objects.has(sourceObjectIdentityKey(s))) throw new TypeError('INBOUND_UNKNOWN_SOURCE');
  };
  for (const o of e.objects) {
    only(o, ['identity','displayName','objectPath','parent','sourceVersion','observedAt']);
    source(o.identity); if (o.parent) source(o.parent);
  }
  const snapshots = unique(e.snapshots, s => s.snapshotId), evidence = unique(e.evidence, s => s.evidenceId), assertions = unique(e.assertions, s => s.assertionId), findings = unique(e.findings, f => f.findingId), candidates = unique(e.candidates, c => c.candidateId);
  for (const s of e.snapshots) { only(s, ['snapshotId','sourceObject','observedAt','sourceVersion','contentHash','locator']); source(s.sourceObject); if (s.contentHash.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(s.contentHash.value)) throw new TypeError('INBOUND_SNAPSHOT_HASH'); }
  for (const v of e.evidence) {
    only(v, ['evidenceId','handling','locations','hashes','capturedAt']);
    if (v.handling !== 'HASH_ONLY' || !v.hashes.length || v.hashes.some(h => h.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(h.value))) throw new TypeError('INBOUND_EVIDENCE_HANDLING');
    for (const hash of v.hashes) only(hash,['algorithm','value']);
    for (const location of v.locations) {
      only(location,['kind','locator']);
      if (location.kind !== 'SOURCE_OBJECT' || typeof location.locator !== 'string' || /[?#]|:\/\/[^/]+@/.test(location.locator)) throw new TypeError('INBOUND_UNSAFE_LOCATOR');
    }
  }
  const support = (s: { assertionIds: readonly string[]; evidenceIds: readonly string[] }) => {
    if (!s.assertionIds.length || !s.evidenceIds.length || s.assertionIds.some(id => !assertions.has(id)) || s.evidenceIds.some(id => !evidence.has(id))) throw new TypeError('INBOUND_DANGLING_SUPPORT');
    for (const id of s.assertionIds) if (assertions.get(id)!.evidenceIds.some(ev => !s.evidenceIds.includes(ev))) throw new TypeError('INBOUND_SUPPORT_MISMATCH');
  };
  for (const a of e.assertions) {
    only(a, ['assertionId','sourceObject','runId','snapshot','method','trustState','observedAt','recordedAt','syncedAt','effectivePeriod','sourceAttribute','evidenceIds']);
    source(a.sourceObject);
    only(a.method,['code','version']);
    if (a.sourceAttribute) only(a.sourceAttribute,['code','path']);
    if (a.snapshot) { only(a.snapshot,['snapshotId','sourceObject','observedAt','sourceVersion','contentHash','locator']);only(a.snapshot.contentHash,['algorithm','value']); }
    if (a.effectivePeriod) only(a.effectivePeriod,['validFrom','validTo']);
    if (a.trustState !== 'IMPORTED' || a.runId !== e.run.runId || a.method.code !== adapter.name || a.method.version !== adapter.version ||
      !a.snapshot || JSON.stringify(a.snapshot) !== JSON.stringify(snapshots.get(a.snapshot.snapshotId)) ||
      sourceObjectIdentityKey(a.snapshot.sourceObject) !== sourceObjectIdentityKey(a.sourceObject) ||
      !a.evidenceIds.length || a.evidenceIds.some(id => !evidence.get(id)?.hashes.some(h => h.value === a.snapshot!.contentHash.value))) throw new TypeError('INBOUND_ASSERTION_MISMATCH');
  }
  for (const f of e.findings) {
    only(f, ['findingId','findingNature','candidateKind','sourceObject','assertionIds','evidenceIds','confidence','reviewStatus','requiresReview','createsCanonicalObject','detectedAt']);
    source(f.sourceObject); support(f);
    if (f.findingNature !== 'CANDIDATE' || f.reviewStatus !== 'UNREVIEWED' || f.requiresReview !== true || f.createsCanonicalObject !== false ||
      f.assertionIds.some(id => sourceObjectIdentityKey(assertions.get(id)!.sourceObject) !== sourceObjectIdentityKey(f.sourceObject))) throw new TypeError('INBOUND_FINDING_MISMATCH');
  }
  for (const c of e.candidates) {
    only(c, ['candidateId','candidateKind','findingId','sourceObject','assertionIds','evidenceIds','confidence','requiresReconciliation','proposedIdentity']);
    source(c.sourceObject); support(c);
    const f = findings.get(c.findingId);
    if (!f || f.candidateKind !== c.candidateKind || sourceObjectIdentityKey(f.sourceObject) !== sourceObjectIdentityKey(c.sourceObject) ||
      c.requiresReconciliation !== true || !Number.isFinite(c.confidence) || c.confidence < 0 || c.confidence > 1 ||
      c.assertionIds.some(id => !f.assertionIds.includes(id)) || c.evidenceIds.some(id => !f.evidenceIds.includes(id))) throw new TypeError('INBOUND_CANDIDATE_MISMATCH');
    if (c.candidateKind === 'DATA_ASSET') {
      only(c.proposedIdentity, ['sourceReference','displayName']); normalizedObjectIdentity(c);
    } else if (c.candidateKind === 'DATA_ELEMENT') {
      only(c.proposedIdentity, ['parentDataAsset','elementPath','displayName']);
      const ref = c.proposedIdentity.parentDataAsset;
      only(ref, ['referenceKind','candidateKind','candidateId']);
      const p = ref.referenceKind === 'CANDIDATE' ? candidates.get(ref.candidateId) : undefined;
      if (!p || p.candidateKind !== 'DATA_ASSET' || ref.candidateKind !== 'DATA_ASSET' ||
        sourceObjectIdentityKey(objects.get(sourceObjectIdentityKey(c.sourceObject))!.parent!) !== sourceObjectIdentityKey(p.sourceObject)) throw new TypeError('INBOUND_PARENT_MISMATCH');
      normalizedObjectIdentity(c,p);
    } else throw new TypeError('INBOUND_UNSUPPORTED_KIND');
  }
  for (const t of e.technicalFacts ?? []) {
    only(t, ['candidateId','fact','support','sourceAttribute']); only(t.support, ['assertionIds','evidenceIds']); only(t.sourceAttribute, ['code','path']);
    validateTechnicalFact(t.fact); support(t.support);
    const c = candidates.get(t.candidateId);
    if (!c || c.candidateKind !== t.fact.objectKind || t.support.assertionIds.some(id => !c.assertionIds.includes(id) ||
      assertions.get(id)!.sourceAttribute?.path !== t.sourceAttribute.path) || t.support.evidenceIds.some(id => !c.evidenceIds.includes(id))) throw new TypeError('INBOUND_FACT_SUPPORT_MISMATCH');
  }
}
export interface InboundExchangePorts {
  readonly intake: DiscoveryIntakePersistencePort;
  readonly review: GovernanceReviewPersistencePort;
  readonly materialization: MaterializationPersistencePort;
  readonly facts: TechnicalFactPersistencePort;
  /** Durable ownership check; a caller-supplied tenant wrapper alone is insufficient. */
  assertConfiguredConnection(context: TrustedInboundConnection): Promise<void>;
}
export async function intakeInboundExchange(inputEnvelope: InboundAdapterEnvelope, trusted: TrustedInboundConnection,
  adapter: { name: string; version: string }, ports: InboundExchangePorts): Promise<readonly string[]> {
  const envelope = structuredClone(inputEnvelope);
  validateInboundExchange(envelope,trusted,adapter);
  await ports.assertConfiguredConnection(trusted);
  const run = await ports.intake.startAcquisitionRun(trusted.organisationId, envelope.run);
  if (run.replay && run.status === 'SUCCEEDED') {
    return (envelope.technicalFacts ?? []).map(t => {
      const c = envelope.candidates.find(c=>c.candidateId===t.candidateId) as NormalizedObjectCandidate;
      const ref = c.candidateKind === 'DATA_ELEMENT' ? c.proposedIdentity.parentDataAsset : undefined;
      const parent = ref?.referenceKind === 'CANDIDATE' ? envelope.candidates.find(p=>p.candidateId===ref.candidateId) as NormalizedObjectCandidate : undefined;
      return bindTechnicalFact(trusted,t,c,parent).proposalId;
    });
  }
  for (const e of envelope.evidence) await ports.intake.recordEvidence(trusted.organisationId,e);
  for (const a of envelope.assertions) await ports.intake.recordSourceAssertion(trusted.organisationId,a);
  const ordered = [...envelope.candidates].sort((a,b) => Number(a.candidateKind === 'DATA_ELEMENT') - Number(b.candidateKind === 'DATA_ELEMENT')) as NormalizedObjectCandidate[];
  let created = 0, governed = 0, proposed = 0;
  for (const c of ordered) {
    const finding = envelope.findings.find(f => f.findingId === c.findingId)!;
    await ports.intake.recordDiscoveryFinding(trusted.organisationId,finding,envelope.run.runId);
    await ports.intake.recordNormalizedCandidate(trusted.organisationId,c,envelope.run.runId);
    const parentRef = c.candidateKind === 'DATA_ELEMENT' ? c.proposedIdentity.parentDataAsset : undefined;
    const parent = parentRef?.referenceKind === 'CANDIDATE' ? ordered.find(p => p.candidateId === parentRef.candidateId) : undefined;
    const mapping = await ports.materialization.findActiveObjectSourceMapping({ organisationId: trusted.organisationId,
      sourceConnectionId: c.sourceObject.connectionId, sourceExternalType: c.sourceObject.externalType, sourceExternalId: c.sourceObject.externalId,
      canonicalObjectKind: c.candidateKind, normalizedObjectIdentity: normalizedObjectIdentity(c,parent) });
    if (mapping) { governed++; continue; }
    const reviewSubjectId = asReviewSubjectId(`exchange-review:${factDigest([trusted.organisationId,c.findingId])}`);
    let subject = await ports.review.getReviewSubject(trusted.organisationId,reviewSubjectId);
    if (!subject) {
      const result = await ports.review.createReviewSubject(createReviewSubject({ reviewSubjectId, organisationId: trusted.organisationId, finding, candidate: c }));
      if (!result.replay) created++;
      subject = result.subject;
    }
    if (subject.state === 'DETECTED') {
      const transition = await ports.review.persistReviewTransition(new PassThroughSemanticProposalStrategy().propose(finding,
        { organisationId:trusted.organisationId,reviewSubjectId,commandId:`exchange-propose:${reviewSubjectId}`,occurredAt:finding.detectedAt },c));
      if (!transition.replay) proposed++;
    }
  }
  const ids: string[] = [];
  for (const t of envelope.technicalFacts ?? []) {
    const c = ordered.find(c => c.candidateId === t.candidateId)!;
    const parentRef = c.candidateKind === 'DATA_ELEMENT' ? c.proposedIdentity.parentDataAsset : undefined;
    const parent = parentRef?.referenceKind === 'CANDIDATE' ? ordered.find(c => c.candidateId === parentRef.candidateId) : undefined;
    const proposal = bindTechnicalFact(trusted,t,c,parent);
    await ports.facts.recordProposal(proposal,factObservation(proposal,envelope.run.startedAt)); ids.push(proposal.proposalId);
  }
  await ports.intake.completeAcquisitionRun(trusted.organisationId, { ...envelope.run, status: 'SUCCEEDED', completedAt: asIsoTimestamp(new Date().toISOString()) },
    { artifactsScanned: envelope.objects.length, findingsDetected: envelope.findings.length, objectCandidates: ordered.length,
      relationshipCandidates: 0, reviewSubjectsCreated: created, proposalsCreated: proposed, alreadyGoverned: governed, itemFailures: 0 });
  return ids;
}
