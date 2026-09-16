import 'server-only';
import { createBehaviorFingerprint, sourceObjectIdentityKey, type ExecutionSourceSnapshot, type OrganisationId, type DirectExecutionFact } from '@council/canonical-contracts';
import { executionDigest, validateExecutionSnapshot, type ExecutionContextPersistencePort, type DiscoveryIntakePersistencePort } from '@council/governance-review';
import type { AgentVersionCorrelationResult, DiscoveryCandidate } from '@council/scanner';

export async function recordExecutionSource(org:OrganisationId,version:AgentVersionCorrelationResult,agent:DiscoveryCandidate,
  sourceSystemId:string,providerCode:string,intake:DiscoveryIntakePersistencePort,persistence:ExecutionContextPersistencePort) {
  const declaration=agent.executionDeclaration;
  if(!declaration||!version.executionFacts?.length||!agent.assertion.snapshot) return;
  if(agent.finding.candidateKind!=='AGENT'||version.candidate.candidateKind!=='AGENT_VERSION'||
    sourceObjectIdentityKey(agent.finding.sourceObject)!==sourceObjectIdentityKey(version.candidate.sourceObject)||
    !version.candidate.assertionIds.includes(agent.assertion.assertionId))throw new Error('EXECUTION_BINDING_MISMATCH');
  const values=[...version.executionFacts].sort((a,b)=>JSON.stringify(a.fact).localeCompare(JSON.stringify(b.fact)));
  for(const value of values) {
    if(value.assertion.snapshot?.snapshotId!==agent.assertion.snapshot.snapshotId || value.assertion.trustState!=='DECLARED')throw new Error('EXECUTION_SUPPORT_MISMATCH');
    await intake.recordEvidence(org,value.evidence); await intake.recordSourceAssertion(org,value.assertion);
  }
  const facts=values.map(v=>({fact:v.fact as DirectExecutionFact,assertionId:v.assertion.assertionId,evidenceId:v.evidence.evidenceId,...(v.toolCandidateId?{toolCandidateId:v.toolCandidateId}:{})}));
  const sourceScope=executionDigest([sourceObjectIdentityKey(agent.finding.sourceObject),declaration.declarationKey]);
  const snapshot:ExecutionSourceSnapshot={organisationId:org,sourceScope,
    snapshotId:`execution-snapshot:${executionDigest([org,sourceScope,version.candidate.candidateId,agent.assertion.snapshot.snapshotId,facts])}`,
    agentVersionCandidateId:version.candidate.candidateId,sourceObject:agent.finding.sourceObject,sourceSystemId,providerCode,
    declarationKey:declaration.declarationKey,sourceSnapshotId:agent.assertion.snapshot.snapshotId,
    behaviorFingerprint:createBehaviorFingerprint({algorithm:'sha256',schemaVersion:version.behaviorFingerprintSchemaVersion??'1.0',value:version.technicalRevisionFingerprint}),
    recordedAt:agent.assertion.recordedAt,authorizationState:'UNKNOWN',facts};
  validateExecutionSnapshot(snapshot);await persistence.recordSnapshot(snapshot);
}
