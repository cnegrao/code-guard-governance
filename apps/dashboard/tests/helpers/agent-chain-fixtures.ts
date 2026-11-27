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

export function twoDiscoveryRunsFixture() {
  function run(id: string, sourceVersion: string, startedAt: string) {
    const agent = candidate('AGENT', `agent:${id}`, { agentCode: 'TriagemManifestacaoAgent' });
    const model = candidate('MODEL', `model:${id}`, { modelReference: 'triagem-model' });
    const prompt = candidate('PROMPT', `prompt:${id}`, { declarationKey: 'TRIAGEM_PROMPT' });
    const tools = ['classificar_manifestacao', 'mascarar_dados_pessoais'].map(name => candidate('TOOL', `${name}:${id}`, { declarationKey: name }));
    const version = candidate('AGENT_VERSION', `version:${id}`, { agent: { referenceKind: 'CANDIDATE', candidateKind: 'AGENT', candidateId: agent.candidate.candidateId } }, {
      assertionIds: [agent, model, prompt, ...tools].flatMap(row => row.candidate.assertionIds),
      evidenceIds: [agent, model, prompt, ...tools].flatMap(row => row.candidate.evidenceIds),
    });
    const relationships = [model, ...tools].map(target => candidate('RELATIONSHIP', `relationship:${target.candidate.candidateId}`, undefined, {
      relationshipTypeCode: target.candidate.candidateKind === 'MODEL' ? 'USES_MODEL' : 'USES_TOOL',
      sourceEndpoint: { referenceKind: 'CANDIDATE', candidateKind: 'AGENT_VERSION', candidateId: version.candidate.candidateId },
      targetEndpoint: { referenceKind: 'CANDIDATE', candidateKind: target.candidate.candidateKind, candidateId: target.candidate.candidateId },
    }));
    const all = [agent, version, model, prompt, ...tools, ...relationships];
    all.forEach(row => { row.discoveryRun = { id, sourceVersion, startedAt }; });
    return { id, sourceVersion, startedAt, agent, version, model, prompt, tools, relationships, all };
  }
  const old = run('run-old', '7b5aaf9', '2026-11-26T10:00:00Z');
  const latest = run('run-new', '77f0128', '2026-11-26T11:00:00Z');
  return { old, latest, all: [...old.all, ...latest.all] };
}
