import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { LocalRepositoryAdapter } from '../../src/discovery/adapters/local-repository-adapter';
import { DiscoveryPipeline, type DiscoveryRunResult } from '../../src/discovery/pipeline';
import { AgentKindDeclarationSpecification } from '../../src/discovery/strategies/agent-kind-declaration';
import { ModelReferenceDeclarationSpecification } from '../../src/discovery/strategies/model-reference-declaration';

const GOLDEN_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'discovery-validation-lab',
  'golden-repositories',
);

function fixedClock() {
  return { now: () => '2026-01-01T00:00:00.000Z' };
}

describe('Discovery Engine v1 end-to-end: LocalRepositoryAdapter -> DiscoveryPipeline -> candidate output', () => {
  it('discovers evidence-backed Agent and Model candidates in the 01-simple-agent golden repository', async () => {
    const pipeline = new DiscoveryPipeline(
      new LocalRepositoryAdapter(resolve(GOLDEN_ROOT, '01-simple-agent')),
      [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()],
      { clock: fixedClock() },
    );

    const result = await pipeline.run();

    assert.equal(result.run.status, 'SUCCEEDED');
    // The reserved .govia-lab/leak-agent.py canary must never reach the pipeline.
    assert.equal(
      result.candidates.every(
        (candidate) => !candidate.finding.sourceObject.externalId.includes('leak-agent'),
      ),
      true,
    );

    const agentCandidates = result.candidates.filter((c) => c.finding.candidateKind === 'AGENT');
    const modelCandidates = result.candidates.filter((c) => c.finding.candidateKind === 'MODEL');
    assert.equal(agentCandidates.length, 1);
    assert.equal(modelCandidates.length, 1);
    assert.equal(modelCandidates[0].displayValue, 'support-model-v1');

    for (const candidate of result.candidates) {
      assert.equal(candidate.finding.requiresReview, true);
      assert.equal(candidate.finding.createsCanonicalObject, false);
      assert.ok(candidate.evidence.locations.length > 0);
      assert.ok(candidate.evidence.hashes.length > 0);
    }
  });

  it('discovers multiple Agent/Model candidates in the 02-multi-agent golden repository', async () => {
    const pipeline = new DiscoveryPipeline(
      new LocalRepositoryAdapter(resolve(GOLDEN_ROOT, '02-multi-agent')),
      [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()],
      { clock: fixedClock() },
    );

    const result = await pipeline.run();

    const agentCandidates = result.candidates.filter((c) => c.finding.candidateKind === 'AGENT');
    assert.equal(agentCandidates.length, 3);
  });

  it('produces zero candidates for the 05-false-positives golden repository (no Agent self-declaration present)', async () => {
    const pipeline = new DiscoveryPipeline(
      new LocalRepositoryAdapter(resolve(GOLDEN_ROOT, '05-false-positives')),
      [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()],
      { clock: fixedClock() },
    );

    const result = await pipeline.run();
    assert.equal(result.candidates.filter((c) => c.finding.candidateKind === 'AGENT').length, 0);
  });

  it('is deterministic across repeated runs against the same golden repository', async () => {
    const build = () =>
      new DiscoveryPipeline(
        new LocalRepositoryAdapter(resolve(GOLDEN_ROOT, '01-simple-agent')),
        [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()],
        { clock: fixedClock() },
      );

    const first = await build().run();
    const second = await build().run();

    const strip = (result: DiscoveryRunResult) =>
      result.candidates.map((c) => ({
        candidateKind: c.finding.candidateKind,
        sourceObject: c.finding.sourceObject,
        displayValue: c.displayValue,
      }));

    assert.deepEqual(strip(first), strip(second));
  });
});
