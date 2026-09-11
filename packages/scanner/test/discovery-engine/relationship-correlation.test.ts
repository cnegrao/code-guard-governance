import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { asOrganisationId, asSourceConnectionId } from '@council/canonical-contracts';
import { DiscoveryPipeline } from '../../src/discovery/pipeline';
import { correlateAgentVersions } from '../../src/discovery/agent-version-correlation';
import { normalizeObjectCandidate } from '../../src/discovery/object-candidate-normalization';
import { RelationshipCorrelationStrategy, correlateAgentUsesModelRelationships, correlateAgentUsesToolRelationships, type RelationshipCorrelationContext } from '../../src/discovery/relationship-correlation';
import type { DiscoveryCandidate } from '../../src/discovery/evidence-assembly';
import type { SourceAdapter } from '../../src/discovery/source-adapter';
import { AgentKindDeclarationSpecification } from '../../src/discovery/strategies/agent-kind-declaration';
import { ModelReferenceDeclarationSpecification } from '../../src/discovery/strategies/model-reference-declaration';
import { ToolListDeclarationSpecification } from '../../src/discovery/strategies/tool-list-declaration';
import { PromptDeclarationSpecification } from '../../src/discovery/strategies/prompt-declaration';
import { McpServerDeclarationSpecification } from '../../src/discovery/strategies/mcp-server-declaration';
import { ApiDeclarationSpecification } from '../../src/discovery/strategies/api-declaration';
import { KnowledgeBaseDeclarationSpecification } from '../../src/discovery/strategies/knowledge-base-declaration';
import { SkillListDeclarationSpecification } from '../../src/discovery/strategies/skill-list-declaration';

const observedAt = '2026-09-09T12:00:00.000Z';
const org = asOrganisationId('org-a');
const direct = 'class Assistant:\n    kind = "agent"\n    modelReference = "model-a"\n    tools = [lookup]\n';

async function scan(text = direct, locator = 'agent.py') {
  const adapter: SourceAdapter = {
    adapterName: 'fixture', adapterVersion: '1',
    describeSource: () => ({ displayName: 'binding-fixture', family: 'REPOSITORY', providerCode: 'fixture' }),
    listArtifacts: async () => [{ locator, kind: 'file', sizeBytes: text.length }],
    readArtifact: async () => ({ ok: true, content: { locator, text, encoding: 'utf8', contentHash: createHash('sha256').update(text).digest('hex') } }),
  };
  return new DiscoveryPipeline(adapter, [
    new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification(),
    new ToolListDeclarationSpecification(), new PromptDeclarationSpecification(),
    new McpServerDeclarationSpecification(), new ApiDeclarationSpecification(),
    new KnowledgeBaseDeclarationSpecification(), new SkillListDeclarationSpecification(),
  ], { clock: { now: () => observedAt } }).run();
}

function context(candidates: readonly DiscoveryCandidate[]): RelationshipCorrelationContext {
  return { organisationId: org, connectionId: candidates[0]?.finding.sourceObject.connectionId ?? asSourceConnectionId('empty'),
    agentVersions: correlateAgentVersions(candidates, [], { observedAt }), technicalProfileSignals: [] };
}
function correlate(candidates: readonly DiscoveryCandidate[], scope = context(candidates), time = observedAt) {
  return new RelationshipCorrelationStrategy().correlate(candidates, time, scope);
}

describe('L9 exact AgentVersion declaration bindings', () => {
  it('MODEL and TOOL direct properties produce exact normalized AGENT_VERSION endpoints with evidence', async () => {
    const { candidates } = await scan();
    const scope = context(candidates);
    const results = correlate(candidates, scope);
    assert.equal(results.length, 2);
    for (const { finding, candidate } of results) {
      assert.deepEqual(candidate.sourceEndpoint, { referenceKind: 'CANDIDATE', candidateKind: 'AGENT_VERSION', candidateId: scope.agentVersions[0].candidate.candidateId });
      const targetKind = candidate.relationshipTypeCode === 'USES_MODEL' ? 'MODEL' : 'TOOL';
      const target = candidates.find((item) => item.finding.candidateKind === targetKind)!;
      const normalized = normalizeObjectCandidate(target);
      assert.equal(normalized.status, 'NORMALIZED');
      if (normalized.status !== 'NORMALIZED') throw new Error('missing target');
      assert.deepEqual(candidate.targetEndpoint, { referenceKind: 'CANDIDATE', candidateKind: targetKind, candidateId: normalized.candidate.candidateId });
      for (const id of [...scope.agentVersions[0].finding.evidenceIds, target.evidence.evidenceId]) assert.ok(candidate.evidenceIds.includes(id));
      for (const id of [...scope.agentVersions[0].finding.assertionIds, target.assertion.assertionId]) assert.ok(candidate.assertionIds.includes(id));
      assert.equal(new Set(candidate.assertionIds).size, candidate.assertionIds.length);
      assert.equal(new Set(candidate.evidenceIds).size, candidate.evidenceIds.length);
      assert.equal(finding.reviewStatus, 'UNREVIEWED');
      assert.equal(finding.requiresReview, true);
      assert.equal(finding.createsCanonicalObject, false);
      assert.equal(candidate.requiresReconciliation, true);
    }
    assert.equal(correlateAgentUsesModelRelationships(candidates, { observedAt, context: scope }).length, 1);
    assert.equal(correlateAgentUsesToolRelationships(candidates, { observedAt, context: scope }).length, 1);
  });

  it('supports flat TS object declarations and multiple explicit tools', async () => {
    const { candidates } = await scan('export const assistant = {\n  kind: "agent",\n  modelReference: "model-a",\n  tools: [lookup, search],\n};', 'agent.ts');
    assert.equal(correlate(candidates).length, 3);
  });

  for (const [kind, declaration, remove] of [
    ['MODEL', 'modelReference = "model-a"', '    modelReference = "model-a"\n'],
    ['TOOL', 'tools = [lookup]', '    tools = [lookup]\n'],
  ]) it(`${kind}: an existing target elsewhere cannot bind to an evidenced version`, async () => {
    const source = await scan(direct.replace(remove, ''));
    const target = await scan(declaration, 'unrelated.py');
    assert.equal(context(source.candidates).agentVersions.length, 1);
    assert.ok(target.candidates.some((item) => item.finding.candidateKind === kind));
    const results = correlate([...source.candidates, ...target.candidates]);
    assert.equal(results.length, 1, 'only the other, directly bound family remains');
    assert.ok(results.every((item) => item.candidate.targetEndpoint.candidateKind !== kind));
  });

  it('shared names across files do not cause repository-wide fan-out or borrow binding evidence', async () => {
    const a = await scan(direct, 'a.py');
    const b = await scan(direct.replace('Assistant', 'Other'), 'b.py');
    const inputs = [...a.candidates, ...b.candidates];
    const results = correlate(inputs);
    assert.equal(results.length, 4, 'two direct bindings per version, no cross-file pairs');
    for (const result of results) {
      const file = result.candidate.sourceObject.externalId;
      const own = inputs.filter((item) => item.finding.sourceObject.externalId === file);
      assert.deepEqual(new Set(result.candidate.evidenceIds), new Set(own.flatMap((item) => item.finding.evidenceIds)));
      assert.deepEqual(new Set(result.candidate.assertionIds), new Set(own.flatMap((item) => item.finding.assertionIds)));
      const foreign = inputs.filter((item) => item.finding.sourceObject.externalId !== file);
      assert.ok(foreign.every((item) => !result.candidate.evidenceIds.includes(item.evidence.evidenceId)));
    }
  });

  it('SDK and documentation/tool prose add no relationship to an existing version', async () => {
    const source = await scan('import openai\n' + direct.replace('    modelReference = "model-a"\n', ''));
    const docs = await scan('The modelReference is model-a. The tools include lookup.\n# modelReference = "model-a"\n# tools = [lookup]', 'README.md');
    assert.equal(context(source.candidates).agentVersions.length, 1);
    assert.equal(docs.candidates.length, 0);
    const results = correlate([...source.candidates, ...docs.candidates]);
    assert.deepEqual(results.map((item) => item.candidate.relationshipTypeCode), ['USES_TOOL']);
    const modelOnly = await scan(direct.replace('    tools = [lookup]\n', '') + '# tools can include lookup\n');
    assert.deepEqual(correlate(modelOnly.candidates).map((item) => item.candidate.relationshipTypeCode), ['USES_MODEL']);
  });

  for (const [name, text] of Object.entries({
    'module copresence': 'class Assistant:\n    kind = "agent"\nmodelReference = "model-a"\ntools = [lookup]',
    'another declaration': 'class Assistant:\n    kind = "agent"\nclass Unrelated:\n    modelReference = "model-a"\n    tools = [lookup]',
    'SDK import': 'import openai\nclass Assistant:\n    kind = "agent"',
    'unrelated function': 'class Assistant:\n    kind = "agent"\ndef lookup():\n    pass',
    'nested function': 'class Assistant:\n    kind = "agent"\n    def unrelated():\n        modelReference = "model-a"\n        tools = [lookup]',
    'ambiguous agents': direct + '\nclass Other:\n    kind = "agent"',
    'duplicate model fields': direct + '    modelReference = "model-b"',
    'duplicate tools fields': direct + '    tools = [other]',
    'multiline string': 'text = """\n' + direct + '"""',
    'block comment': '/*\nconst assistant = {\n  kind: "agent",\n  tools: [lookup],\n};\n*/',
    'nested object': 'const assistant = {\n  kind: "agent",\n  nested: {\n    tools: [lookup],\n  },\n};',
  })) it(`${name} cannot prove a binding`, async () => {
    const { candidates } = await scan(text, name.includes('object') || name.includes('comment') ? 'agent.ts' : 'agent.py');
    assert.equal(correlate(candidates).length, 0);
  });

  it('missing version/context fails closed, including compatibility entry points', async () => {
    const { candidates } = await scan();
    assert.deepEqual(correlate(candidates, { ...context(candidates), agentVersions: [] }), []);
    assert.deepEqual(new RelationshipCorrelationStrategy().correlate(candidates, observedAt), []);
    assert.deepEqual(correlateAgentUsesModelRelationships(candidates, { observedAt }), []);
    assert.deepEqual(correlateAgentUsesToolRelationships(candidates, { observedAt }), []);
  });

  it('wrong source kind fails closed', async () => {
    const { candidates } = await scan();
    const scope = context(candidates);
    const wrong = { ...scope.agentVersions[0], candidate: { ...scope.agentVersions[0].candidate, candidateKind: 'AGENT' } };
    assert.deepEqual(correlate(candidates, { ...scope, agentVersions: [wrong as never] }), []);
  });

  for (const mutation of ['missing binding', 'empty evidence', 'empty assertions', 'missing location', 'wrong target', 'unnormalizable target', 'missing snapshot', 'wrong snapshot', 'wrong owner', 'wrong marker']) {
    it(`${mutation} fails closed`, async () => {
      const { candidates } = await scan(direct.replace('    tools = [lookup]\n', ''));
      const changed = candidates.map((item): DiscoveryCandidate => {
        if (item.finding.candidateKind !== 'MODEL') return item;
        switch (mutation) {
          case 'missing binding': return { ...item, behaviorBinding: undefined };
          case 'empty evidence': return { ...item, finding: { ...item.finding, evidenceIds: [] } };
          case 'empty assertions': return { ...item, finding: { ...item.finding, assertionIds: [] } };
          case 'missing location': return { ...item, evidence: { ...item.evidence, locations: [] } };
          case 'wrong target': return { ...item, finding: { ...item.finding, candidateKind: 'API' } };
          case 'unnormalizable target': return { ...item, displayValue: '' };
          case 'missing snapshot': return { ...item, assertion: { ...item.assertion, snapshot: undefined } };
          case 'wrong snapshot': return { ...item, assertion: { ...item.assertion, snapshot: { ...item.assertion.snapshot!, snapshotId: 'different' as never } } };
          case 'wrong owner': return { ...item, behaviorBinding: { ...item.behaviorBinding!, agentDeclarationKey: 'Unrelated' } };
          default: return { ...item, behaviorBinding: { ...item.behaviorBinding!, agentMarkerLine: 99 } };
        }
      });
      assert.deepEqual(correlate(changed), []);
    });
  }

  it('missing source or target never fabricates an endpoint', async () => {
    const { candidates } = await scan();
    for (const kind of ['AGENT', 'MODEL', 'TOOL']) {
      const remaining = candidates.filter((item) => item.finding.candidateKind !== kind);
      const results = correlate(remaining);
      if (kind === 'AGENT') assert.equal(results.length, 0);
      else assert.ok(results.every((item) => item.candidate.targetEndpoint.candidateKind !== kind));
    }
  });

  it('an exact version ID cannot repair missing source provenance', async () => {
    const { candidates } = await scan();
    const scope = context(candidates);
    for (const field of ['assertionIds', 'evidenceIds'] as const) {
      const stripped = { ...scope.agentVersions[0], candidate: { ...scope.agentVersions[0].candidate, [field]: [] } };
      assert.deepEqual(correlate(candidates, { ...scope, agentVersions: [stripped] }), []);
    }
  });

  it('V1/V2 retain separate bindings even to the same normalized target', async () => {
    const first = await scan();
    const second = await scan(direct.replace('[lookup]', '[search]'));
    const a = correlate(first.candidates).find((item) => item.candidate.relationshipTypeCode === 'USES_MODEL')!;
    const b = correlate(second.candidates).find((item) => item.candidate.relationshipTypeCode === 'USES_MODEL')!;
    assert.deepEqual(a.candidate.targetEndpoint, b.candidate.targetEndpoint);
    assert.notDeepEqual(a.candidate.sourceEndpoint, b.candidate.sourceEndpoint);
    assert.notEqual(a.candidate.candidateId, b.candidate.candidateId);
    assert.deepEqual(correlate(first.candidates).find((item) => item.candidate.relationshipTypeCode === 'USES_MODEL'), a);
    assert.deepEqual(correlate(second.candidates, context(first.candidates)), []);
  });

  it('V1 -> Model A and V2 -> Model B stay distinct; both versions using Tool X also stay distinct', async () => {
    const a = await scan();
    const b = await scan(direct.replace('model-a', 'model-b'));
    assert.deepEqual(normalizeObjectCandidate(a.candidates.find((item) => item.finding.candidateKind === 'AGENT')!),
      normalizeObjectCandidate(b.candidates.find((item) => item.finding.candidateKind === 'AGENT')!), 'logical Agent is unchanged');
    const first = correlate(a.candidates);
    const second = correlate(b.candidates);
    for (const [kind, relationshipType] of [['MODEL', 'USES_MODEL'], ['TOOL', 'USES_TOOL']]) {
      const relations = [...first, ...second].filter((item) => item.candidate.relationshipTypeCode === relationshipType);
      assert.equal(relations.length, 2);
      assert.notEqual(relations[0].candidate.candidateId, relations[1].candidate.candidateId);
      assert.notDeepEqual(relations[0].candidate.sourceEndpoint, relations[1].candidate.sourceEndpoint);
      if (kind === 'TOOL') assert.deepEqual(relations[0].candidate.targetEndpoint, relations[1].candidate.targetEndpoint);
      else assert.notDeepEqual(relations[0].candidate.targetEndpoint, relations[1].candidate.targetEndpoint);
      for (const [index, run] of [a, b].entries()) {
        const normalized = normalizeObjectCandidate(run.candidates.find((item) => item.finding.candidateKind === kind)!);
        assert.equal(normalized.status, 'NORMALIZED');
        if (normalized.status !== 'NORMALIZED') throw new Error('missing target');
        assert.deepEqual(relations[index].candidate.targetEndpoint, { referenceKind: 'CANDIDATE', candidateKind: kind, candidateId: normalized.candidate.candidateId });
      }
    }
    assert.deepEqual(correlate(a.candidates), first, 'V1 replay does not change after V2');
  });

  it('same binding replay is deterministic across time, order and duplicates', async () => {
    const { candidates } = await scan();
    const scope = context(candidates);
    const a = correlate(candidates);
    const b = correlate([...candidates].reverse(), { ...scope, agentVersions: [...scope.agentVersions, ...scope.agentVersions] }, '2026-09-10T12:00:00.000Z');
    assert.deepEqual(a.map((item) => item.candidate), b.map((item) => item.candidate));
  });

  it('organisation changes identity; foreign connection endpoints fail closed', async () => {
    const { candidates } = await scan();
    const scope = context(candidates);
    assert.notDeepEqual(correlate(candidates).map((item) => item.candidate.candidateId), correlate(candidates, { ...scope, organisationId: asOrganisationId('org-b') }).map((item) => item.candidate.candidateId));
    assert.deepEqual(correlate(candidates, { ...scope, organisationId: '' as never }), []);
    const mixed = candidates.map((item) => item.finding.candidateKind !== 'MODEL' ? item : { ...item, finding: { ...item.finding, sourceObject: { ...item.finding.sourceObject, connectionId: asSourceConnectionId('foreign') } } });
    assert.deepEqual(correlate(mixed, scope), []);
  });

  it('Prompt plaintext remains protected and declaration identity survives content changes', async () => {
    const first = await scan('SYSTEM_PROMPT = "private prompt one"\n' + direct);
    const second = await scan('SYSTEM_PROMPT = "private prompt two"\n' + direct);
    const prompt = (items: readonly DiscoveryCandidate[]) => normalizeObjectCandidate(items.find((item) => item.finding.candidateKind === 'PROMPT')!);
    assert.deepEqual(prompt(first.candidates), prompt(second.candidates));
    const a = correlate(first.candidates);
    const b = correlate(second.candidates);
    assert.equal(a.length, 2);
    assert.notDeepEqual(a.map((item) => item.candidate.sourceEndpoint), b.map((item) => item.candidate.sourceEndpoint));
    assert.doesNotMatch(JSON.stringify([...a, ...b, ...first.candidates.map((item) => item.evidence)]), /private prompt/);
    assert.ok([...a, ...b].every((item) => item.candidate.relationshipTypeCode !== 'USES_PROMPT'));
  });

  for (const [kind, locator, content] of [
    ['MCP_SERVER', 'mcp.json', '{"serverIdentity":"catalog"}'],
    ['API', 'api.py', 'SERVICE_API = {\n    "id": "service-api",\n}'],
    ['KNOWLEDGE_BASE', 'kb.yaml', 'knowledge_base:\n  identity: handbook'],
    // Synthetic in-memory locator only; never reads any .claude filesystem.
    ['SKILL', '.claude/skills/example/SKILL.md', 'fixture'],
    ['PROMPT', 'prompt.py', 'SYSTEM_PROMPT = "protected"'],
  ]) it(`${kind}: discovered target remains BLOCKED_CORRELATION, no fabrication`, async () => {
    const target = await scan(content, locator);
    const discoveredTarget = target.candidates.find((item) => item.finding.candidateKind === kind)!;
    assert.ok(discoveredTarget);
    assert.equal(normalizeObjectCandidate(discoveredTarget).status, 'NORMALIZED');
    const agent = await scan();
    const results = correlate([...agent.candidates, ...target.candidates]);
    assert.equal(results.length, 2);
    assert.ok(results.every((item) => item.candidate.targetEndpoint.candidateKind !== kind));
    assert.ok(results.every((item) => item.candidate.sourceEndpoint.candidateKind === 'AGENT_VERSION'));

    // Correlation-boundary fixture only: model a normalizable target colocated
    // in the version's artifact, without claiming its real detector supports
    // that file shape (MCP JSON / KB YAML / Skill paths have separate formats).
    // No new detector or positive binding is invented. All source/snapshot
    // consistency gates are satisfied so absence of binding is decisive.
    const anchor = agent.candidates[0];
    const colocated: DiscoveryCandidate = {
      ...discoveredTarget,
      finding: { ...discoveredTarget.finding, sourceObject: anchor.finding.sourceObject },
      assertion: { ...discoveredTarget.assertion, sourceObject: anchor.assertion.sourceObject, snapshot: anchor.assertion.snapshot },
      evidence: { ...discoveredTarget.evidence, locations: anchor.evidence.locations, hashes: anchor.evidence.hashes },
    };
    const sameFileInputs = [...agent.candidates, colocated];
    assert.equal(colocated.behaviorBinding, undefined);
    assert.equal(normalizeObjectCandidate(colocated).status, 'NORMALIZED');
    assert.equal(context(sameFileInputs).agentVersions.length, 1);
    const sameFile = correlate(sameFileInputs);
    assert.equal(sameFile.length, 2);
    assert.ok(sameFile.every((item) => item.candidate.sourceEndpoint.candidateKind === 'AGENT_VERSION' &&
      item.candidate.targetEndpoint.candidateKind !== kind));
  });

  it('L8 inputs and governance/Graph authority are absent; legacy behavior emission removed', () => {
    const correlation = readFileSync(new URL('../../src/discovery/relationship-correlation.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(correlation, /from ['"].*(?:semantic|governance-review|graphos)|PossibleMatchCandidate|createReviewSubject\(|materializ\w*\(|reconcil\w*\(|\.rpc\(/i);
    for (const unrelated of ['EXPOSES', 'HANDOFF_TO', 'READS_FROM', 'WRITES_TO']) {
      assert.ok(!correlation.includes(unrelated), `${unrelated} remains outside discovery correlation`);
    }
    const legacy = readFileSync(new URL('../../src/unified.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(legacy, /kind:\s*['"](?:USES_MODEL|USES_TOOL|USES_MCP|INVOKES|USES_PROMPT|USES_KNOWLEDGE_BASE|USES_SKILL)['"]/);
    for (const unrelated of ['OWNED_BY', 'IMPACTS_RISK']) assert.ok(legacy.includes(`kind: '${unrelated}'`));
  });
});
