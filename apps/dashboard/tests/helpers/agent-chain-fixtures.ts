import type { NormalizedCandidate } from '@council/canonical-contracts';
import { createHash } from 'node:crypto';
import type { AgentChainItem, ChainCandidate } from '../../lib/governance/agent-chain';

export function candidate(kind: string, id: string, identity: unknown = {}, extra: Record<string, unknown> = {}): ChainCandidate {
  const candidateId = kind === 'AGENT_VERSION' ? `candidate:agent-version:${createHash('sha256').update(id).digest('hex').slice(0, 32)}` : id;
  return { candidate: { candidateKind: kind, candidateId, findingId: `finding:${id}`,
    sourceObject: { connectionId: 'conn', externalType: 'file', externalId: 'agent.ts' },
    assertionIds: [`assertion:${id}`], evidenceIds: [`evidence:${id}`], confidence: 1, requiresReconciliation: true,
    proposedIdentity: identity, ...extra } as unknown as NormalizedCandidate,
    reviewSubjectId: `review:${id}`, state: 'PROPOSED' };
}
export function chainFixture() {
  const agent = candidate('AGENT', 'agent', { agentCode: 'support_agent' });
  const model = candidate('MODEL', 'model', { modelReference: 'source-model' });
  const tool = candidate('TOOL', 'tool', { declarationKey: 'source-tool' });
  const prompt = candidate('PROMPT', 'prompt', { declarationKey: 'source-prompt' });
  const version = candidate('AGENT_VERSION', 'version', { agent: { referenceKind: 'CANDIDATE', candidateKind: 'AGENT', candidateId: 'agent' } }, {
    assertionIds: [agent, model, tool, prompt].flatMap(row => row.candidate.assertionIds),
    evidenceIds: [agent, model, tool, prompt].flatMap(row => row.candidate.evidenceIds),
  });
  const relationship = candidate('RELATIONSHIP', 'relationship', undefined, {
    relationshipTypeCode: 'USES_MODEL',
    sourceEndpoint: { referenceKind: 'CANDIDATE', candidateKind: 'AGENT_VERSION', candidateId: version.candidate.candidateId },
    targetEndpoint: { referenceKind: 'CANDIDATE', candidateKind: 'MODEL', candidateId: 'model' },
  });
  return { agent, version, model, tool, prompt, relationship, all: [relationship, prompt, version, tool, model, agent] };
}
export function item(id: string, kind = 'MODEL', dependencies: string[] = []): AgentChainItem {
  return { reviewSubjectId: id, candidateId: `candidate:${id}`, sourceName: id, sourceId: 'agent.ts', kind,
    dependencies, outcome: 'CREATE_NEW', state: 'PROPOSED' };
}
