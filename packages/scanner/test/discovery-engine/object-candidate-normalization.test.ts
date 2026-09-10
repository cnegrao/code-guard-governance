import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import type {
  DiscoveryCandidateKind,
  NormalizedAgentCandidate,
  NormalizedModelCandidate,
  NormalizedToolCandidate,
} from '@council/canonical-contracts';

import { LocalRepositoryAdapter } from '../../src/discovery/adapters/local-repository-adapter';
import {
  AgentCandidateNormalizationStrategy,
  ModelCandidateNormalizationStrategy,
  normalizeObjectCandidate,
  OBJECT_NORMALIZATION_REASON_CODE,
  ToolCandidateNormalizationStrategy,
} from '../../src/discovery/object-candidate-normalization';
import { DiscoveryPipeline } from '../../src/discovery/pipeline';
import { AgentKindDeclarationSpecification } from '../../src/discovery/strategies/agent-kind-declaration';
import { ModelReferenceDeclarationSpecification } from '../../src/discovery/strategies/model-reference-declaration';
import { ToolListDeclarationSpecification } from '../../src/discovery/strategies/tool-list-declaration';
import type { DiscoveryCandidate } from '../../src/discovery/evidence-assembly';

function fixedClock() {
  return { now: () => '2026-01-01T00:00:00.000Z' };
}

async function withTempRepository(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'object-candidate-normalization-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const filePath = join(root, name);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function scan(root: string) {
  const pipeline = new DiscoveryPipeline(
    new LocalRepositoryAdapter(root),
    [
      new AgentKindDeclarationSpecification(),
      new ModelReferenceDeclarationSpecification(),
      new ToolListDeclarationSpecification(),
    ],
    { clock: fixedClock() },
  );
  return pipeline.run();
}

function byKind(candidates: readonly DiscoveryCandidate[], kind: DiscoveryCandidateKind): DiscoveryCandidate {
  const found = candidates.find((c) => c.finding.candidateKind === kind);
  if (!found) throw new Error(`no ${kind} candidate found`);
  return found;
}

describe('Object Candidate Normalization V1: NORMALIZATION MAP (real detector output)', () => {
  it('AGENT: a bare "kind = agent" marker with no enclosing declaration is NOT_SAFELY_NORMALIZABLE (no captured identity)', async () => {
    await withTempRepository({ 'agent.py': 'kind = "agent"\n' }, async (root) => {
      const { candidates } = await scan(root);
      const agent = byKind(candidates, 'AGENT');
      const result = normalizeObjectCandidate(agent);
      assert.equal(result.status, 'NOT_SAFELY_NORMALIZABLE');
      if (result.status === 'NOT_SAFELY_NORMALIZABLE') {
        assert.equal(result.candidateKind, 'AGENT');
        assert.equal(result.reasonCode, OBJECT_NORMALIZATION_REASON_CODE.AGENT_IDENTITY_NOT_DERIVABLE);
      }
    });
  });

  it('AGENT: the enclosing Python class name is promoted exactly to proposedIdentity.agentCode', async () => {
    await withTempRepository(
      { 'agent.py': ['class CustomerSupportAgent:', '    kind = "agent"', ''].join('\n') },
      async (root) => {
        const { candidates } = await scan(root);
        const agent = byKind(candidates, 'AGENT');
        assert.equal(agent.displayValue, 'CustomerSupportAgent');
        const result = normalizeObjectCandidate(agent);
        assert.equal(result.status, 'NORMALIZED');
        if (result.status !== 'NORMALIZED') return;
        assert.deepEqual(result.candidate.proposedIdentity, { agentCode: 'CustomerSupportAgent' });
      },
    );
  });

  it('AGENT: the enclosing TypeScript const object-literal name is promoted exactly to proposedIdentity.agentCode', async () => {
    await withTempRepository(
      { 'agent.ts': ['export const billingAgent = {', '  kind: "agent",', '};', ''].join('\n') },
      async (root) => {
        const { candidates } = await scan(root);
        const agent = byKind(candidates, 'AGENT');
        assert.equal(agent.displayValue, 'billingAgent');
        const result = normalizeObjectCandidate(agent);
        assert.equal(result.status, 'NORMALIZED');
        if (result.status !== 'NORMALIZED') return;
        assert.deepEqual(result.candidate.proposedIdentity, { agentCode: 'billingAgent' });
      },
    );
  });

  it('MODEL: ModelReferenceDeclarationSpecification displayValue is promoted exactly to proposedIdentity.modelReference', async () => {
    await withTempRepository({ 'model.py': 'MODEL_REFERENCE = "support-model-v1"\n' }, async (root) => {
      const { candidates } = await scan(root);
      const model = byKind(candidates, 'MODEL');
      const result = normalizeObjectCandidate(model);
      assert.equal(result.status, 'NORMALIZED');
      if (result.status !== 'NORMALIZED') return;
      const candidate = result.candidate as NormalizedModelCandidate;
      assert.equal(candidate.candidateKind, 'MODEL');
      assert.equal(candidate.findingId, model.finding.findingId);
      assert.deepEqual(candidate.sourceObject, model.finding.sourceObject);
      assert.deepEqual([...candidate.assertionIds], [...model.finding.assertionIds]);
      assert.deepEqual([...candidate.evidenceIds], [...model.finding.evidenceIds]);
      assert.equal(candidate.confidence, model.finding.confidence);
      assert.equal(candidate.requiresReconciliation, true);
      assert.deepEqual(candidate.proposedIdentity, { modelReference: 'support-model-v1' });
    });
  });

  it('TOOL: ToolListDeclarationSpecification displayValue is promoted exactly to proposedIdentity.declarationKey', async () => {
    await withTempRepository({ 'agent.py': 'tools = [lookup_customer]\n' }, async (root) => {
      const { candidates } = await scan(root);
      const tool = byKind(candidates, 'TOOL');
      const result = normalizeObjectCandidate(tool);
      assert.equal(result.status, 'NORMALIZED');
      if (result.status !== 'NORMALIZED') return;
      const candidate = result.candidate as NormalizedToolCandidate;
      assert.equal(candidate.candidateKind, 'TOOL');
      assert.equal(candidate.findingId, tool.finding.findingId);
      assert.deepEqual(candidate.sourceObject, tool.finding.sourceObject);
      assert.equal(candidate.requiresReconciliation, true);
      assert.deepEqual(candidate.proposedIdentity, { declarationKey: 'lookup_customer' });
    });
  });
});

describe('Object Candidate Normalization V1: DETERMINISM', () => {
  it('unchanged source produces the same candidateId and proposedIdentity across independent scans', async () => {
    await withTempRepository({ 'model.py': 'modelReference = "gpt-x"\n' }, async (root) => {
      const first = normalizeObjectCandidate(byKind((await scan(root)).candidates, 'MODEL'));
      const second = normalizeObjectCandidate(byKind((await scan(root)).candidates, 'MODEL'));
      assert.equal(first.status, 'NORMALIZED');
      assert.equal(second.status, 'NORMALIZED');
      if (first.status !== 'NORMALIZED' || second.status !== 'NORMALIZED') return;
      assert.equal(first.candidate.candidateId, second.candidate.candidateId);
      assert.deepEqual(first.candidate.proposedIdentity, second.candidate.proposedIdentity);
      assert.deepEqual(first.candidate, second.candidate);
    });
  });

  it('repeated normalization of the same DiscoveryCandidate object is deep-equivalent (pure function, no hidden state)', async () => {
    await withTempRepository({ 'agent.py': 'tools = [alpha, beta]\n' }, async (root) => {
      const { candidates } = await scan(root);
      const tool = candidates.find((c) => c.displayValue === 'alpha')!;
      const first = normalizeObjectCandidate(tool);
      const second = normalizeObjectCandidate(tool);
      assert.deepEqual(first, second);
    });
  });

  it('wall-clock change (different scan-time clock) does not affect candidateId or proposedIdentity', async () => {
    await withTempRepository({ 'model.py': 'MODEL_REFERENCE = "wall-clock-model"\n' }, async (root) => {
      const pipelineA = new DiscoveryPipeline(
        new LocalRepositoryAdapter(root),
        [new ModelReferenceDeclarationSpecification()],
        { clock: { now: () => '2026-01-01T00:00:00.000Z' } },
      );
      const pipelineB = new DiscoveryPipeline(
        new LocalRepositoryAdapter(root),
        [new ModelReferenceDeclarationSpecification()],
        { clock: { now: () => '2030-06-15T12:34:56.000Z' } },
      );
      const resultA = normalizeObjectCandidate((await pipelineA.run()).candidates[0]!);
      const resultB = normalizeObjectCandidate((await pipelineB.run()).candidates[0]!);
      assert.equal(resultA.status, 'NORMALIZED');
      assert.equal(resultB.status, 'NORMALIZED');
      if (resultA.status !== 'NORMALIZED' || resultB.status !== 'NORMALIZED') return;
      assert.equal(resultA.candidate.candidateId, resultB.candidate.candidateId);
      assert.deepEqual(resultA.candidate.proposedIdentity, resultB.candidate.proposedIdentity);
    });
  });

  it('AGENT: an unchanged class-enclosed declaration produces the same candidateId and agentCode across independent scans', async () => {
    await withTempRepository(
      { 'agent.py': ['class RepeatableAgent:', '    kind = "agent"', ''].join('\n') },
      async (root) => {
        const first = normalizeObjectCandidate(byKind((await scan(root)).candidates, 'AGENT'));
        const second = normalizeObjectCandidate(byKind((await scan(root)).candidates, 'AGENT'));
        assert.equal(first.status, 'NORMALIZED');
        assert.equal(second.status, 'NORMALIZED');
        if (first.status !== 'NORMALIZED' || second.status !== 'NORMALIZED') return;
        assert.equal(first.candidate.candidateId, second.candidate.candidateId);
        assert.deepEqual(first.candidate.proposedIdentity, second.candidate.proposedIdentity);
      },
    );
  });
});

describe('Object Candidate Normalization V1: SEMANTIC CHANGE', () => {
  it('a changed model reference literal produces a changed proposedIdentity and a changed candidateId', async () => {
    await withTempRepository({ 'model.py': 'MODEL_REFERENCE = "model-a"\n' }, async (rootA) => {
      const resultA = normalizeObjectCandidate(byKind((await scan(rootA)).candidates, 'MODEL'));
      await withTempRepository({ 'model.py': 'MODEL_REFERENCE = "model-b"\n' }, async (rootB) => {
        const resultB = normalizeObjectCandidate(byKind((await scan(rootB)).candidates, 'MODEL'));
        assert.equal(resultA.status, 'NORMALIZED');
        assert.equal(resultB.status, 'NORMALIZED');
        if (resultA.status !== 'NORMALIZED' || resultB.status !== 'NORMALIZED') return;
        const candidateA = resultA.candidate as NormalizedModelCandidate;
        const candidateB = resultB.candidate as NormalizedModelCandidate;
        assert.notEqual(candidateA.proposedIdentity.modelReference, candidateB.proposedIdentity.modelReference);
        assert.notEqual(candidateA.candidateId, candidateB.candidateId);
      });
    });
  });

  it('two different Tool declarations in the same file do not collapse into the same candidate', async () => {
    await withTempRepository({ 'agent.py': 'tools = [alpha, beta]\n' }, async (root) => {
      const { candidates } = await scan(root);
      const tools = candidates.filter((c) => c.finding.candidateKind === 'TOOL');
      assert.equal(tools.length, 2);
      const normalized = tools.map((t) => normalizeObjectCandidate(t));
      assert.ok(normalized.every((r) => r.status === 'NORMALIZED'));
      const ids = normalized.map((r) => (r.status === 'NORMALIZED' ? r.candidate.candidateId : ''));
      assert.notEqual(ids[0], ids[1]);
      const identities = normalized.map((r) =>
        r.status === 'NORMALIZED' ? (r.candidate as NormalizedToolCandidate).proposedIdentity.declarationKey : '',
      );
      assert.deepEqual(identities.sort(), ['alpha', 'beta']);
    });
  });

  it('candidateId never collides across different candidate kinds for the same underlying artifact', async () => {
    await withTempRepository(
      { 'agent.py': ['kind = "agent"', 'modelReference = "shared-name"', 'tools = [shared_name]', ''].join('\n') },
      async (root) => {
        const { candidates } = await scan(root);
        const model = byKind(candidates, 'MODEL');
        const tool = byKind(candidates, 'TOOL');
        const modelResult = normalizeObjectCandidate(model);
        const toolResult = normalizeObjectCandidate(tool);
        assert.equal(modelResult.status, 'NORMALIZED');
        assert.equal(toolResult.status, 'NORMALIZED');
        if (modelResult.status !== 'NORMALIZED' || toolResult.status !== 'NORMALIZED') return;
        assert.notEqual(modelResult.candidate.candidateId, toolResult.candidate.candidateId);
        assert.notEqual(modelResult.candidate.findingId, toolResult.candidate.findingId);
      },
    );
  });

  it('AGENT: two different enclosing declaration names in the same scan produce different identities', async () => {
    await withTempRepository(
      {
        'a.py': ['class AlphaAgent:', '    kind = "agent"', ''].join('\n'),
        'b.py': ['class BetaAgent:', '    kind = "agent"', ''].join('\n'),
      },
      async (root) => {
        const { candidates } = await scan(root);
        const agents = candidates.filter((c) => c.finding.candidateKind === 'AGENT');
        assert.equal(agents.length, 2);
        const normalized = agents.map((a) => normalizeObjectCandidate(a));
        assert.ok(normalized.every((r) => r.status === 'NORMALIZED'));
        const codes = normalized.map((r) =>
          r.status === 'NORMALIZED' ? (r.candidate as NormalizedAgentCandidate).proposedIdentity.agentCode : '',
        );
        assert.deepEqual(codes.sort(), ['AlphaAgent', 'BetaAgent']);
        const ids = normalized.map((r) => (r.status === 'NORMALIZED' ? r.candidate.candidateId : ''));
        assert.notEqual(ids[0], ids[1]);
      },
    );
  });

  it('the identical model reference literal declared in two different files never collapses into the same candidate (same display label, different semantic objects)', async () => {
    await withTempRepository(
      { 'a/model.py': 'MODEL_REFERENCE = "gpt-4"\n', 'b/model.py': 'MODEL_REFERENCE = "gpt-4"\n' },
      async (root) => {
        const { candidates } = await scan(root);
        const models = candidates.filter((c) => c.finding.candidateKind === 'MODEL');
        assert.equal(models.length, 2);
        const normalized = models.map((m) => normalizeObjectCandidate(m));
        assert.ok(normalized.every((r) => r.status === 'NORMALIZED'));
        const ids = normalized.map((r) => (r.status === 'NORMALIZED' ? r.candidate.candidateId : ''));
        assert.notEqual(ids[0], ids[1], 'two distinct source artifacts must never share a candidateId merely because their displayValue matches');
        const findingIds = normalized.map((r) => (r.status === 'NORMALIZED' ? r.candidate.findingId : ''));
        assert.notEqual(findingIds[0], findingIds[1]);
      },
    );
  });
});

describe('Object Candidate Normalization V1: FAIL CLOSED', () => {
  it('AGENT: an enclosing declaration literally named "agent" (case-insensitive) is still treated as the unresolved generic value, never promoted to identity', async () => {
    await withTempRepository(
      { 'agent.py': ['class Agent:', '    kind = "agent"', ''].join('\n') },
      async (root) => {
        const { candidates } = await scan(root);
        const agent = byKind(candidates, 'AGENT');
        assert.equal(agent.displayValue, 'Agent');
        const result = normalizeObjectCandidate(agent);
        assert.equal(result.status, 'NOT_SAFELY_NORMALIZABLE');
        if (result.status === 'NOT_SAFELY_NORMALIZABLE') {
          assert.equal(result.reasonCode, OBJECT_NORMALIZATION_REASON_CODE.AGENT_IDENTITY_NOT_DERIVABLE);
        }
      },
    );
  });

  it('AGENT: two declarations with an identical class name in two different files never collapse into the same candidate', async () => {
    await withTempRepository(
      {
        'a/agent.py': ['class SharedName:', '    kind = "agent"', ''].join('\n'),
        'b/agent.py': ['class SharedName:', '    kind = "agent"', ''].join('\n'),
      },
      async (root) => {
        const { candidates } = await scan(root);
        const agents = candidates.filter((c) => c.finding.candidateKind === 'AGENT');
        assert.equal(agents.length, 2);
        const normalized = agents.map((a) => normalizeObjectCandidate(a));
        assert.ok(normalized.every((r) => r.status === 'NORMALIZED'));
        const ids = normalized.map((r) => (r.status === 'NORMALIZED' ? r.candidate.candidateId : ''));
        assert.notEqual(
          ids[0],
          ids[1],
          'identical displayName across different SourceConnection/artifact boundaries must never be silently merged',
        );
      },
    );
  });

  it('a DATA_ASSET without supported declaration evidence fails closed rather than being normalized', () => {
    const fabricated: DiscoveryCandidate = {
      finding: {
        findingId: 'discovery-finding:fabricated' as never,
        findingNature: 'CANDIDATE',
        candidateKind: 'DATA_ASSET' as never,
        sourceObject: { connectionId: 'source-connection:x' as never, externalType: 'file', externalId: 'x.py' as never },
        assertionIds: ['source-assertion:x' as never],
        evidenceIds: ['evidence:x' as never],
        confidence: 0.6,
        reviewStatus: 'UNREVIEWED',
        requiresReview: true,
        createsCanonicalObject: false,
        detectedAt: '2026-01-01T00:00:00.000Z' as never,
      },
      assertion: {} as never,
      evidence: {} as never,
      displayValue: 'some-data-asset',
    };

    const result = normalizeObjectCandidate(fabricated);
    assert.equal(result.status, 'NOT_SAFELY_NORMALIZABLE');
    if (result.status === 'NOT_SAFELY_NORMALIZABLE') {
      assert.equal(result.reasonCode, OBJECT_NORMALIZATION_REASON_CODE.DATA_DECLARATION_NOT_SUPPORTED);
    }
  });

  it('a RELATIONSHIP-kind finding routed to the object dispatcher by mistake fails closed, never treated as an object', () => {
    const misrouted: DiscoveryCandidate = {
      finding: {
        findingId: 'discovery-finding:relationship-misrouted' as never,
        findingNature: 'CANDIDATE',
        candidateKind: 'RELATIONSHIP' as never,
        sourceObject: { connectionId: 'source-connection:x' as never, externalType: 'file', externalId: 'x.py' as never },
        assertionIds: [],
        evidenceIds: [],
        confidence: 0.6,
        reviewStatus: 'UNREVIEWED',
        requiresReview: true,
        createsCanonicalObject: false,
        detectedAt: '2026-01-01T00:00:00.000Z' as never,
      },
      assertion: {} as never,
      evidence: {} as never,
      displayValue: 'irrelevant',
    };

    const result = normalizeObjectCandidate(misrouted);
    assert.equal(result.status, 'NOT_SAFELY_NORMALIZABLE');
    if (result.status === 'NOT_SAFELY_NORMALIZABLE') {
      assert.equal(result.reasonCode, OBJECT_NORMALIZATION_REASON_CODE.UNSUPPORTED_CANDIDATE_KIND);
    }
  });

  it('a whitespace-only displayValue fails closed for MODEL rather than producing a blank identity', () => {
    const blank: DiscoveryCandidate = {
      finding: {
        findingId: 'discovery-finding:blank-model' as never,
        findingNature: 'CANDIDATE',
        candidateKind: 'MODEL',
        sourceObject: { connectionId: 'source-connection:x' as never, externalType: 'file', externalId: 'x.py' as never },
        assertionIds: ['source-assertion:x' as never],
        evidenceIds: ['evidence:x' as never],
        confidence: 0.6,
        reviewStatus: 'UNREVIEWED',
        requiresReview: true,
        createsCanonicalObject: false,
        detectedAt: '2026-01-01T00:00:00.000Z' as never,
      },
      assertion: {} as never,
      evidence: {} as never,
      displayValue: '   ',
    };

    const result = normalizeObjectCandidate(blank);
    assert.equal(result.status, 'NOT_SAFELY_NORMALIZABLE');
    if (result.status === 'NOT_SAFELY_NORMALIZABLE') {
      assert.equal(result.reasonCode, OBJECT_NORMALIZATION_REASON_CODE.EMPTY_IDENTITY_VALUE);
    }
  });

  it('a whitespace-only displayValue fails closed for TOOL rather than producing a blank identity', () => {
    const blank: DiscoveryCandidate = {
      finding: {
        findingId: 'discovery-finding:blank-tool' as never,
        findingNature: 'CANDIDATE',
        candidateKind: 'TOOL',
        sourceObject: { connectionId: 'source-connection:x' as never, externalType: 'file', externalId: 'x.py' as never },
        assertionIds: ['source-assertion:x' as never],
        evidenceIds: ['evidence:x' as never],
        confidence: 0.6,
        reviewStatus: 'UNREVIEWED',
        requiresReview: true,
        createsCanonicalObject: false,
        detectedAt: '2026-01-01T00:00:00.000Z' as never,
      },
      assertion: {} as never,
      evidence: {} as never,
      displayValue: '',
    };

    const result = normalizeObjectCandidate(blank);
    assert.equal(result.status, 'NOT_SAFELY_NORMALIZABLE');
    if (result.status === 'NOT_SAFELY_NORMALIZABLE') {
      assert.equal(result.reasonCode, OBJECT_NORMALIZATION_REASON_CODE.EMPTY_IDENTITY_VALUE);
    }
  });
});

describe('Object Candidate Normalization V1: FINDING <-> CANDIDATE INTEGRITY', () => {
  it('every NORMALIZED candidate cites exactly the same assertionIds/evidenceIds as its finding and requiresReconciliation is true', async () => {
    await withTempRepository(
      { 'agent.py': ['MODEL_REFERENCE = "integrity-model"', 'tools = [integrity_tool]', ''].join('\n') },
      async (root) => {
        const { candidates } = await scan(root);
        for (const candidate of candidates) {
          const result = normalizeObjectCandidate(candidate);
          if (result.status !== 'NORMALIZED') continue;
          assert.equal(result.candidate.findingId, candidate.finding.findingId);
          assert.equal(result.candidate.candidateKind, candidate.finding.candidateKind);
          assert.deepEqual(result.candidate.sourceObject, candidate.finding.sourceObject);
          assert.deepEqual([...result.candidate.assertionIds], [...candidate.finding.assertionIds]);
          assert.deepEqual([...result.candidate.evidenceIds], [...candidate.finding.evidenceIds]);
          assert.equal(result.candidate.confidence, candidate.finding.confidence);
          assert.equal(result.candidate.requiresReconciliation, true);
        }
      },
    );
  });
});

describe('Object Candidate Normalization V1: AUTHORITY CEILING', () => {
  it('the normalization module never imports or references confirm/certify/authorize/reconcile/materialize', () => {
    const modulePath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'src',
      'discovery',
      'object-candidate-normalization.ts',
    );
    const source = readFileSync(modulePath, 'utf8');
    for (const forbidden of ['confirm(', 'certify(', 'authorize(', 'reconcile(', 'materializ']) {
      assert.ok(!source.includes(forbidden), `must never reference "${forbidden}"`);
    }
  });
});

describe('Object Candidate Normalization V1: strategy classes are individually usable', () => {
  it('AgentCandidateNormalizationStrategy returns NOT_SAFELY_NORMALIZABLE for the bare generic marker', async () => {
    await withTempRepository({ 'agent.py': 'kind = "agent"\n' }, async (root) => {
      const agent = byKind((await scan(root)).candidates, 'AGENT');
      const strategy = new AgentCandidateNormalizationStrategy();
      assert.equal(strategy.candidateKind, 'AGENT');
      assert.equal(strategy.normalize(agent).status, 'NOT_SAFELY_NORMALIZABLE');
    });
  });

  it('AgentCandidateNormalizationStrategy agrees with the dispatcher for a real enclosing declaration', async () => {
    await withTempRepository(
      { 'agent.py': ['class StrategyAgent:', '    kind = "agent"', ''].join('\n') },
      async (root) => {
        const agent = byKind((await scan(root)).candidates, 'AGENT');
        const strategy = new AgentCandidateNormalizationStrategy();
        assert.deepEqual(strategy.normalize(agent), normalizeObjectCandidate(agent));
        assert.equal(strategy.normalize(agent).status, 'NORMALIZED');
      },
    );
  });

  it('ModelCandidateNormalizationStrategy and ToolCandidateNormalizationStrategy agree with the dispatcher', async () => {
    await withTempRepository(
      { 'agent.py': ['MODEL_REFERENCE = "strategy-model"', 'tools = [strategy_tool]', ''].join('\n') },
      async (root) => {
        const { candidates } = await scan(root);
        const model = byKind(candidates, 'MODEL');
        const tool = byKind(candidates, 'TOOL');

        const modelStrategy = new ModelCandidateNormalizationStrategy();
        const toolStrategy = new ToolCandidateNormalizationStrategy();

        assert.deepEqual(modelStrategy.normalize(model), normalizeObjectCandidate(model));
        assert.deepEqual(toolStrategy.normalize(tool), normalizeObjectCandidate(tool));
      },
    );
  });
});
