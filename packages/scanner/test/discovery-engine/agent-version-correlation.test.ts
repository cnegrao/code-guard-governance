import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { asExternalId } from '@council/canonical-contracts';

import {
  AgentVersionCorrelationStrategy,
  correlateAgentVersions,
  type AgentVersionCorrelationResult,
} from '../../src/discovery/agent-version-correlation';
import { normalizeObjectCandidate } from '../../src/discovery/object-candidate-normalization';
import { DiscoveryPipeline } from '../../src/discovery/pipeline';
import { LocalRepositoryAdapter } from '../../src/discovery/adapters/local-repository-adapter';
import { AgentKindDeclarationSpecification } from '../../src/discovery/strategies/agent-kind-declaration';
import { ModelReferenceDeclarationSpecification } from '../../src/discovery/strategies/model-reference-declaration';
import { ToolListDeclarationSpecification } from '../../src/discovery/strategies/tool-list-declaration';
import type { DiscoveryCandidate } from '../../src/discovery/evidence-assembly';

const OBSERVED_AT = '2026-01-01T00:00:00.000Z';

function fixedClock() {
  return { now: () => OBSERVED_AT };
}

function correlate(candidates: readonly DiscoveryCandidate[]): readonly AgentVersionCorrelationResult[] {
  return new AgentVersionCorrelationStrategy().correlate(candidates, OBSERVED_AT);
}

async function withTempRepository(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'agent-version-correlation-'));
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

let candidateSeq = 0;

/** Defaults to a real, non-generic Agent identity ("TestAgent") so a caller
 * exercising the positive correlation path does not need to restate it on
 * every fixture; pass displayValue: 'agent' explicitly to exercise the
 * fail-closed (unidentifiable Agent) path instead. */
function buildCandidate(params: {
  readonly kind: 'AGENT' | 'MODEL' | 'TOOL';
  readonly file: string;
  readonly displayValue?: string;
  readonly connectionId?: string;
}): DiscoveryCandidate {
  candidateSeq += 1;
  const seed = `test-candidate-${candidateSeq}`;
  const connectionId = params.connectionId ?? 'connection-test';
  const displayValue = params.displayValue ?? (params.kind === 'AGENT' ? 'TestAgent' : `${params.kind.toLowerCase()}-${candidateSeq}`);

  return {
    finding: {
      findingId: `discovery-finding:${seed}` as never,
      findingNature: 'CANDIDATE',
      candidateKind: params.kind,
      sourceObject: {
        connectionId: connectionId as never,
        externalType: 'file',
        externalId: asExternalId(params.file),
      },
      assertionIds: [`source-assertion:${seed}` as never],
      evidenceIds: [`evidence:${seed}` as never],
      confidence: 0.6,
      reviewStatus: 'UNREVIEWED',
      requiresReview: true,
      createsCanonicalObject: false,
      detectedAt: OBSERVED_AT as never,
    },
    assertion: {} as never,
    evidence: {} as never,
    displayValue,
  };
}

describe('AgentVersionCorrelationStrategy: POSITIVE CORRELATION', () => {
  it('correlates one identifiable Agent with its Model into one AGENT_VERSION candidate', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'gpt-x' });

    const results = correlate([agent, model]);
    assert.equal(results.length, 1);
    const [result] = results;
    assert.equal(result.finding.candidateKind, 'AGENT_VERSION');
    assert.equal(result.finding.requiresReview, true);
    assert.equal(result.finding.createsCanonicalObject, false);
    assert.equal(result.finding.reviewStatus, 'UNREVIEWED');
    assert.equal(result.candidate.candidateKind, 'AGENT_VERSION');
    assert.equal(result.candidate.requiresReconciliation, true);
    assert.equal(result.candidate.proposedIdentity.agent.referenceKind, 'SOURCE_OBJECT');
    assert.equal(result.candidate.proposedIdentity.agent.candidateKind, 'AGENT');
  });

  it('correlates one identifiable Agent with its Tools alone (no Model) into one AGENT_VERSION candidate', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    const tool = buildCandidate({ kind: 'TOOL', file: 'src/agent.py', displayValue: 'lookup_customer' });

    const results = correlate([agent, tool]);
    assert.equal(results.length, 1);
  });

  it('discovers a real evidence-backed AGENT_VERSION in the 01-simple-agent-shaped fixture (class-enclosed kind = "agent")', async () => {
    await withTempRepository(
      {
        'src/customer_support_agent.py': [
          'MODEL_REFERENCE = "support-model-v1"',
          '',
          'class CustomerSupportAgent:',
          '    kind = "agent"',
          '    model = MODEL_REFERENCE',
          '    tools = [lookup_customer]',
          '',
        ].join('\n'),
      },
      async (root) => {
        const { candidates } = await scan(root);
        const results = correlate(candidates);
        assert.equal(results.length, 1);
        const [result] = results;
        assert.equal(result.candidate.proposedIdentity.agent.referenceKind, 'SOURCE_OBJECT');
      },
    );
  });
});

describe('AgentVersionCorrelationStrategy: FAIL CLOSED', () => {
  it('does not correlate when the Agent itself has no derivable identity (generic "agent" value)', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py', displayValue: 'agent' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'gpt-x' });

    assert.equal(correlate([agent, model]).length, 0);
  });

  it('does not correlate an identifiable Agent with zero correlated technical evidence (Minimum evidence for AGENT_VERSION)', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    assert.equal(correlate([agent]).length, 0);
  });

  it('AGENT may still normalize on its own even when AGENT_VERSION fails closed for lack of technical evidence', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    const normalized = normalizeObjectCandidate(agent);
    assert.equal(normalized.status, 'NORMALIZED');
    assert.equal(correlate([agent]).length, 0);
  });

  it('fails closed on multiple Agents declared in the same file (ambiguous pairing)', () => {
    const agentOne = buildCandidate({ kind: 'AGENT', file: 'src/agents.py' });
    const agentTwo = buildCandidate({ kind: 'AGENT', file: 'src/agents.py' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agents.py', displayValue: 'gpt-x' });

    assert.equal(correlate([agentOne, agentTwo, model]).length, 0);
  });

  it('does not correlate across unrelated files even when a Model literal coincides', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    const unrelatedModel = buildCandidate({ kind: 'MODEL', file: 'docs/unrelated.py', displayValue: 'gpt-x' });

    assert.equal(correlate([agent, unrelatedModel]).length, 0);
  });

  it('fails closed when endpoint candidates come from inconsistent source connections', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py', connectionId: 'connection-a' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'gpt-x', connectionId: 'connection-b' });

    assert.equal(correlate([agent, model]).length, 0);
  });

  it('never fabricates a versionCode: proposedIdentity.versionCode is always absent', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'gpt-x' });

    // Exercises the free function directly (not just the class wrapper), the
    // same "strategy classes are individually usable" pattern
    // object-candidate-normalization.test.ts and relationship-correlation.test.ts
    // both already establish.
    const [result] = correlateAgentVersions([agent, model], { observedAt: OBSERVED_AT });
    assert.ok(result);
    assert.equal(result.candidate.proposedIdentity.versionCode, undefined);
    assert.deepEqual(Object.keys(result.candidate.proposedIdentity).sort(), ['agent']);
  });
});

describe('AgentVersionCorrelationStrategy: DETERMINISM', () => {
  it('produces the identical AGENT_VERSION identity for the identical fingerprint inputs across independent correlation runs', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'gpt-x' });

    const first = correlate([agent, model]);
    const second = correlate([agent, model]);
    assert.deepEqual(
      first.map((r) => r.candidate.candidateId),
      second.map((r) => r.candidate.candidateId),
    );
  });

  it('is unaffected by candidate array traversal order', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'gpt-x' });
    const tool = buildCandidate({ kind: 'TOOL', file: 'src/agent.py', displayValue: 'lookup' });

    const forward = correlate([agent, model, tool]);
    const reversed = correlate([tool, model, agent]);
    assert.deepEqual(
      forward.map((r) => r.candidate.candidateId).sort(),
      reversed.map((r) => r.candidate.candidateId).sort(),
    );
  });

  it('two different Agents that happen to share the same agentCode and technical evidence never collapse into the same AGENT_VERSION (parent identity is part of the fingerprint)', () => {
    const agentOne = buildCandidate({ kind: 'AGENT', file: 'src/a.py' });
    const toolOne = buildCandidate({ kind: 'TOOL', file: 'src/a.py', displayValue: 'alpha' });

    const agentTwo = buildCandidate({ kind: 'AGENT', file: 'src/b.py' });
    const toolTwo = buildCandidate({ kind: 'TOOL', file: 'src/b.py', displayValue: 'alpha' });

    const [resultOne] = correlate([agentOne, toolOne]);
    const [resultTwo] = correlate([agentTwo, toolTwo]);
    assert.ok(resultOne);
    assert.ok(resultTwo);
    // Both Agents share the exact same default agentCode ("TestAgent") and the
    // exact same Tool identifier ("alpha"), yet they are two distinct source
    // occurrences (different files) and must never be assigned the same
    // AGENT_VERSION identity merely because their technical projection matches.
    assert.notEqual(resultOne.candidate.candidateId, resultTwo.candidate.candidateId);
  });

  it('duplicate technical signals do not change the resulting version identity', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    const toolOnce = buildCandidate({ kind: 'TOOL', file: 'src/agent.py', displayValue: 'alpha' });
    const toolDupA = buildCandidate({ kind: 'TOOL', file: 'src/agent.py', displayValue: 'alpha' });
    const toolDupB = buildCandidate({ kind: 'TOOL', file: 'src/agent.py', displayValue: 'alpha' });

    const [single] = correlate([agent, toolOnce]);
    const [duplicated] = correlate([agent, toolDupA, toolDupB]);
    assert.ok(single);
    assert.ok(duplicated);
    assert.equal(single.candidate.candidateId, duplicated.candidate.candidateId);
  });

  it('repeated identical real scans of the same repository produce the same AGENT_VERSION identity', async () => {
    await withTempRepository(
      { 'src/agent.py': ['class SupportAgent:', '    kind = "agent"', '    modelReference = "gpt-x"', ''].join('\n') },
      async (root) => {
        const first = correlate((await scan(root)).candidates);
        const second = correlate((await scan(root)).candidates);
        assert.equal(first.length, 1);
        assert.equal(second.length, 1);
        assert.equal(first[0]!.candidate.candidateId, second[0]!.candidate.candidateId);
      },
    );
  });
});

describe('AgentVersionCorrelationStrategy: SEMANTIC CHANGE', () => {
  it('a changed correlated Model reference produces a changed AGENT_VERSION identity while the Agent identity is unchanged', () => {
    // The same Agent occurrence (identical DiscoveryCandidate/findingId) is
    // reused for both correlations, so the only variable is the correlated
    // Model's declared reference — isolating the model change as the sole
    // cause of any AGENT_VERSION identity difference.
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    const modelA = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'model-a' });
    const modelB = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'model-b' });

    const [resultA] = correlate([agent, modelA]);
    const [resultB] = correlate([agent, modelB]);
    assert.ok(resultA);
    assert.ok(resultB);
    assert.notEqual(resultA.candidate.candidateId, resultB.candidate.candidateId);

    const agentIdentity = normalizeObjectCandidate(agent);
    assert.equal(agentIdentity.status, 'NORMALIZED');
  });

  it('an unrelated candidate elsewhere in the scan never changes an Agent\'s AGENT_VERSION identity', () => {
    // Same Agent + same Model occurrence in both correlations; the only
    // variable is the presence of a wholly unrelated candidate detected in a
    // different file during the same scan.
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'gpt-x' });
    const unrelatedModel = buildCandidate({ kind: 'MODEL', file: 'docs/unrelated.py', displayValue: 'unrelated-model' });

    const [withoutExtra] = correlate([agent, model]);
    const [withExtra] = correlate([agent, model, unrelatedModel]);
    assert.ok(withoutExtra);
    assert.ok(withExtra);
    assert.equal(withoutExtra.candidate.candidateId, withExtra.candidate.candidateId);
  });
});

describe('AgentVersionCorrelationStrategy: EVIDENCE / PROVENANCE', () => {
  it('the AGENT_VERSION finding unions assertion/evidence ids from the Agent and every correlated Model/Tool', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'gpt-x' });
    const tool = buildCandidate({ kind: 'TOOL', file: 'src/agent.py', displayValue: 'alpha' });

    const [result] = correlate([agent, model, tool]);
    assert.ok(result);
    for (const source of [agent, model, tool]) {
      for (const id of source.finding.assertionIds) {
        assert.ok(result.finding.assertionIds.includes(id));
      }
      for (const id of source.finding.evidenceIds) {
        assert.ok(result.finding.evidenceIds.includes(id));
      }
    }
  });

  it('never marks an AGENT_VERSION candidate as governed truth', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'gpt-x' });

    const [result] = correlate([agent, model]);
    assert.ok(result);
    assert.equal(result.finding.reviewStatus, 'UNREVIEWED');
    assert.equal(result.finding.requiresReview, true);
    assert.equal(result.finding.createsCanonicalObject, false);
    assert.equal(result.candidate.requiresReconciliation, true);
  });
});

describe('AgentVersionCorrelationStrategy: AUTHORITY CEILING', () => {
  it('the correlation module never imports or references confirm/certify/authorize/reconcile/materialize', () => {
    const modulePath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'src',
      'discovery',
      'agent-version-correlation.ts',
    );
    const source = readFileSync(modulePath, 'utf8');
    for (const forbidden of ['confirm(', 'certify(', 'authorize(', 'reconcile(', 'materializ']) {
      assert.ok(!source.includes(forbidden), `must never reference "${forbidden}"`);
    }
  });
});
