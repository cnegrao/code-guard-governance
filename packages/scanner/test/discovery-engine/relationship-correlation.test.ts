import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { LocalRepositoryAdapter } from '../../src/discovery/adapters/local-repository-adapter';
import { DiscoveryPipeline, type DiscoveryRunResult } from '../../src/discovery/pipeline';
import type { DiscoveryCandidate } from '../../src/discovery/evidence-assembly';
import {
  RelationshipCorrelationStrategy,
  correlateAgentUsesModelRelationships,
  type RelationshipCorrelationResult,
} from '../../src/discovery/relationship-correlation';
import { AgentKindDeclarationSpecification } from '../../src/discovery/strategies/agent-kind-declaration';
import { ModelReferenceDeclarationSpecification } from '../../src/discovery/strategies/model-reference-declaration';
import { asExternalId } from '@council/canonical-contracts';

const GOLDEN_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'discovery-validation-lab',
  'golden-repositories',
);

const OBSERVED_AT = '2026-01-01T00:00:00.000Z';

function fixedClock() {
  return { now: () => OBSERVED_AT };
}

async function runDiscovery(scenario: string): Promise<DiscoveryRunResult> {
  const pipeline = new DiscoveryPipeline(
    new LocalRepositoryAdapter(resolve(GOLDEN_ROOT, scenario)),
    [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()],
    { clock: fixedClock() },
  );
  return pipeline.run();
}

function correlate(candidates: readonly DiscoveryCandidate[]): readonly RelationshipCorrelationResult[] {
  return new RelationshipCorrelationStrategy().correlate(candidates, OBSERVED_AT);
}

describe('RelationshipCorrelationStrategy: AGENT -> USES_MODEL -> MODEL', () => {
  it('correlates one Agent using one Model in the 01-simple-agent golden repository', async () => {
    const result = await runDiscovery('01-simple-agent');
    const relationships = correlate(result.candidates);

    assert.equal(relationships.length, 1);
    const [relationship] = relationships;
    assert.equal(relationship.finding.candidateKind, 'RELATIONSHIP');
    assert.equal(relationship.finding.requiresReview, true);
    assert.equal(relationship.finding.createsCanonicalObject, false);
    assert.equal(relationship.candidate.requiresReconciliation, true);
    assert.equal(relationship.candidate.relationshipTypeCode, 'USES_MODEL');
    assert.equal(relationship.candidate.sourceEndpoint.candidateKind, 'AGENT');
    assert.equal(relationship.candidate.targetEndpoint.candidateKind, 'MODEL');
  });

  it('correlates multiple Agents each using their own Model across different files (02-multi-agent)', async () => {
    const result = await runDiscovery('02-multi-agent');
    const relationships = correlate(result.candidates);

    // billing_agent.ts and triage_agent.ts each declare exactly one Agent
    // and one Model in the same file; retention_agent.ts is presumed to
    // follow the same shape. Every relationship must point at endpoints
    // observed in the very same source artifact.
    assert.ok(relationships.length >= 2);
    for (const relationship of relationships) {
      const sourceRef = relationship.candidate.sourceEndpoint;
      const targetRef = relationship.candidate.targetEndpoint;
      assert.equal(sourceRef.referenceKind, 'SOURCE_OBJECT');
      assert.equal(targetRef.referenceKind, 'SOURCE_OBJECT');
      if (sourceRef.referenceKind === 'SOURCE_OBJECT' && targetRef.referenceKind === 'SOURCE_OBJECT') {
        assert.equal(sourceRef.sourceObject.externalId, targetRef.sourceObject.externalId);
      }
    }
  });

  it('does not correlate Agents in 03-monorepo whose files reference a model via a bare identifier (no MODEL_REFERENCE/modelReference declaration observed)', async () => {
    const result = await runDiscovery('03-monorepo');
    const relationships = correlate(result.candidates);

    const agentCandidates = result.candidates.filter((c) => c.finding.candidateKind === 'AGENT');
    const modelCandidates = result.candidates.filter((c) => c.finding.candidateKind === 'MODEL');
    assert.ok(agentCandidates.length >= 2);
    // No Model candidates are detected here at all (this fixture references
    // the model through a bare identifier, not the recognized declaration
    // shape), so correlation correctly finds no evidence-backed pairing.
    assert.equal(modelCandidates.length, 0);
    assert.equal(relationships.length, 0);
  });

  it('produces zero relationships for the 05-false-positives golden repository', async () => {
    const result = await runDiscovery('05-false-positives');
    const relationships = correlate(result.candidates);
    assert.equal(relationships.length, 0);
  });

  it('does not correlate an Agent without any Model candidate in its file', () => {
    const agentOnly = [
      buildCandidate({ kind: 'AGENT', file: 'src/lonely_agent.py', displayValue: 'agent' }),
    ];
    assert.equal(correlate(agentOnly).length, 0);
  });

  it('does not correlate a Model without any Agent candidate in its file', () => {
    const modelOnly = [
      buildCandidate({ kind: 'MODEL', file: 'src/unused_model.py', displayValue: 'orphan-model' }),
    ];
    assert.equal(correlate(modelOnly).length, 0);
  });

  it('preserves evidence/provenance: relationship assertion+evidence ids are drawn from both endpoints', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py', displayValue: 'agent' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'model-v1' });

    const [relationship] = correlate([agent, model]);
    assert.ok(relationship);
    for (const id of agent.finding.assertionIds) {
      assert.ok(relationship.finding.assertionIds.includes(id));
    }
    for (const id of model.finding.assertionIds) {
      assert.ok(relationship.finding.assertionIds.includes(id));
    }
    for (const id of [...agent.finding.evidenceIds, ...model.finding.evidenceIds]) {
      assert.ok(relationship.finding.evidenceIds.includes(id));
    }
  });

  it('is deterministic across repeated correlation of the same candidate set', async () => {
    const result = await runDiscovery('01-simple-agent');
    const first = correlate(result.candidates);
    const second = correlate(result.candidates);
    assert.deepEqual(
      first.map((r) => r.candidate.candidateId),
      second.map((r) => r.candidate.candidateId),
    );
  });

  it('fails closed on duplicate Model declarations in the same file (ambiguous pairing)', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py', displayValue: 'agent' });
    const modelOne = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'model-a' });
    const modelTwo = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'model-b' });

    assert.equal(correlate([agent, modelOne, modelTwo]).length, 0);
  });

  it('fails closed on multiple Agents declared in the same file (ambiguous pairing)', () => {
    const agentOne = buildCandidate({ kind: 'AGENT', file: 'src/agents.py', displayValue: 'agent' });
    const agentTwo = buildCandidate({ kind: 'AGENT', file: 'src/agents.py', displayValue: 'agent' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agents.py', displayValue: 'model-v1' });

    assert.equal(correlate([agentOne, agentTwo, model]).length, 0);
  });

  it('does not correlate across unrelated files even when the same model string literal appears in both', () => {
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py', displayValue: 'agent' });
    const unrelatedModel = buildCandidate({
      kind: 'MODEL',
      file: 'docs/unrelated-notes.py',
      displayValue: 'shared-model-name',
    });

    assert.equal(correlate([agent, unrelatedModel]).length, 0);
  });

  it('fails closed when endpoint candidates come from inconsistent source connections', () => {
    const agent = buildCandidate({
      kind: 'AGENT',
      file: 'src/agent.py',
      displayValue: 'agent',
      connectionId: 'connection-a',
    });
    const model = buildCandidate({
      kind: 'MODEL',
      file: 'src/agent.py',
      displayValue: 'model-v1',
      connectionId: 'connection-b',
    });

    assert.equal(correlate([agent, model]).length, 0);
  });

  it('never correlates the reserved .govia-lab canary agent excluded from discovery (01-simple-agent)', async () => {
    const result = await runDiscovery('01-simple-agent');
    const relationships = correlate(result.candidates);
    for (const relationship of relationships) {
      const endpoints = [relationship.candidate.sourceEndpoint, relationship.candidate.targetEndpoint];
      for (const endpoint of endpoints) {
        if (endpoint.referenceKind === 'SOURCE_OBJECT') {
          assert.ok(!endpoint.sourceObject.externalId.includes('leak-agent'));
        }
      }
    }
  });

  it('produces the same relationship set regardless of candidate array order (reordered traversal)', async () => {
    const result = await runDiscovery('02-multi-agent');
    const forward = correlate(result.candidates);
    const reversed = correlate([...result.candidates].reverse());

    const strip = (relationships: readonly RelationshipCorrelationResult[]) =>
      relationships
        .map((r) => r.candidate.candidateId)
        .slice()
        .sort();

    assert.deepEqual(strip(forward), strip(reversed));
  });

  it('never marks a relationship candidate as governed truth', async () => {
    const result = await runDiscovery('01-simple-agent');
    const relationships = correlate(result.candidates);
    assert.ok(relationships.length > 0);
    for (const relationship of relationships) {
      assert.equal(relationship.finding.reviewStatus, 'UNREVIEWED');
      assert.equal(relationship.finding.requiresReview, true);
      assert.equal(relationship.finding.createsCanonicalObject, false);
      assert.equal(relationship.candidate.requiresReconciliation, true);
    }
  });

  it('deduplicates evidence/assertion ids shared between the two correlated endpoints', () => {
    const sharedSeed = 'shared-evidence-seed';
    const agent = buildCandidate({ kind: 'AGENT', file: 'src/agent.py', displayValue: 'agent' });
    const model = buildCandidate({ kind: 'MODEL', file: 'src/agent.py', displayValue: 'model-v1' });
    const agentWithSharedIds: DiscoveryCandidate = {
      ...agent,
      finding: {
        ...agent.finding,
        assertionIds: [...agent.finding.assertionIds, `source-assertion:${sharedSeed}` as never],
        evidenceIds: [...agent.finding.evidenceIds, `evidence:${sharedSeed}` as never],
      },
    };
    const modelWithSharedIds: DiscoveryCandidate = {
      ...model,
      finding: {
        ...model.finding,
        assertionIds: [`source-assertion:${sharedSeed}` as never],
        evidenceIds: [`evidence:${sharedSeed}` as never],
      },
    };

    const [relationship] = correlateAgentUsesModelRelationships(
      [agentWithSharedIds, modelWithSharedIds],
      { observedAt: OBSERVED_AT },
    );
    assert.ok(relationship);
    assert.equal(new Set(relationship.finding.evidenceIds).size, relationship.finding.evidenceIds.length);
    assert.equal(new Set(relationship.finding.assertionIds).size, relationship.finding.assertionIds.length);
    assert.ok(relationship.finding.evidenceIds.includes(`evidence:${sharedSeed}` as never));
  });
});

let candidateSeq = 0;

function buildCandidate(params: {
  readonly kind: 'AGENT' | 'MODEL';
  readonly file: string;
  readonly displayValue: string;
  readonly connectionId?: string;
}): DiscoveryCandidate {
  candidateSeq += 1;
  const seed = `test-candidate-${candidateSeq}`;
  const connectionId = params.connectionId ?? 'connection-test';

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
    displayValue: params.displayValue,
  };
}
