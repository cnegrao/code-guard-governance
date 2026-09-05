import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { LocalRepositoryAdapter } from '../../src/discovery/adapters/local-repository-adapter';
import type { DetectionMatch, DetectionSpecification } from '../../src/discovery/detection-specification';
import { DiscoveryPipeline, type DiscoveryRunResult } from '../../src/discovery/pipeline';
import { AgentKindDeclarationSpecification } from '../../src/discovery/strategies/agent-kind-declaration';
import { ModelReferenceDeclarationSpecification } from '../../src/discovery/strategies/model-reference-declaration';

const FIXED_TIMESTAMPS = ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z'];

function fixedClock(sequence: readonly string[] = FIXED_TIMESTAMPS) {
  let index = 0;
  return {
    now: () => sequence[Math.min(index++, sequence.length - 1)],
  };
}

async function withTempRepository(
  build: (root: string) => Promise<void>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'discovery-engine-pipeline-'));
  try {
    await build(root);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Strips fields that legitimately vary per run (run identity, timestamps). */
function stableFingerprint(result: DiscoveryRunResult): unknown {
  return {
    candidates: result.candidates.map((candidate) => ({
      candidateKind: candidate.finding.candidateKind,
      sourceObject: candidate.finding.sourceObject,
      confidence: candidate.finding.confidence,
      reviewStatus: candidate.finding.reviewStatus,
      requiresReview: candidate.finding.requiresReview,
      createsCanonicalObject: candidate.finding.createsCanonicalObject,
      displayValue: candidate.displayValue,
      trustState: candidate.assertion.trustState,
      evidenceLocations: candidate.evidence.locations,
      evidenceHashes: candidate.evidence.hashes,
      redactedExcerpt: candidate.evidence.redactedExcerpt,
    })),
    warnings: result.warnings,
  };
}

describe('DiscoveryPipeline', () => {
  it('produces evidence-backed candidates that are never governed truth', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(
          join(root, 'agent.py'),
          ['class SupportAgent:', '    kind = "agent"', '    model = MODEL_REFERENCE', ''].join('\n'),
        );
        await writeFile(join(root, 'model.py'), 'MODEL_REFERENCE = "support-model-v1"\n');
      },
      async (root) => {
        const pipeline = new DiscoveryPipeline(
          new LocalRepositoryAdapter(root),
          [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()],
          { clock: fixedClock() },
        );
        const result = await pipeline.run();

        assert.equal(result.candidates.length, 2);
        for (const candidate of result.candidates) {
          assert.equal(candidate.finding.findingNature, 'CANDIDATE');
          assert.equal(candidate.finding.requiresReview, true);
          assert.equal(candidate.finding.createsCanonicalObject, false);
          assert.equal(candidate.finding.reviewStatus, 'UNREVIEWED');
          assert.equal(candidate.assertion.trustState, 'INFERRED');
        }

        const kinds = result.candidates.map((candidate) => candidate.finding.candidateKind).sort();
        assert.deepEqual(kinds, ['AGENT', 'MODEL']);
      },
    );
  });

  it('re-running against unchanged content is deterministic apart from run identity/timestamps', async () => {
    await withTempRepository(
      async (root) => {
        await mkdir(join(root, 'src'), { recursive: true });
        await writeFile(join(root, 'src', 'agent.py'), 'kind = "agent"\n');
        await writeFile(join(root, 'src', 'model.py'), 'modelReference = "gpt-x"\n');
      },
      async (root) => {
        const buildPipeline = () =>
          new DiscoveryPipeline(
            new LocalRepositoryAdapter(root),
            [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()],
            { clock: fixedClock() },
          );

        const first = await buildPipeline().run();
        const second = await buildPipeline().run();

        assert.notEqual(first.run.runId, second.run.runId, 'each run has its own identity');
        assert.deepEqual(stableFingerprint(first), stableFingerprint(second));
      },
    );
  });

  it('skips an unreadable artifact with a warning instead of throwing', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(join(root, 'binary.bin'), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
        await writeFile(join(root, 'agent.py'), 'kind = "agent"\n');
      },
      async (root) => {
        const pipeline = new DiscoveryPipeline(
          new LocalRepositoryAdapter(root),
          [new AgentKindDeclarationSpecification()],
          { clock: fixedClock() },
        );
        const result = await pipeline.run();

        assert.equal(result.candidates.length, 1);
        assert.equal(result.warnings.length, 1);
        assert.equal(result.warnings[0].locator, 'binary.bin');
        assert.equal(result.run.status, 'SUCCEEDED');
      },
    );
  });

  it('skips an artifact exceeding the configured size limit with a warning', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(join(root, 'huge.txt'), 'kind = "agent"\n'.repeat(1000));
      },
      async (root) => {
        const pipeline = new DiscoveryPipeline(
          new LocalRepositoryAdapter(root),
          [new AgentKindDeclarationSpecification()],
          { clock: fixedClock(), maxArtifactSizeBytes: 10 },
        );
        const result = await pipeline.run();

        assert.equal(result.candidates.length, 0);
        assert.equal(result.warnings.length, 1);
        assert.match(result.warnings[0].reason, /byte limit/);
      },
    );
  });

  it('fails closed (throws) when the source cannot be enumerated at all', async () => {
    const missingAdapter = new LocalRepositoryAdapter(join(tmpdir(), 'discovery-engine-missing-root'));
    const pipeline = new DiscoveryPipeline(missingAdapter, [new AgentKindDeclarationSpecification()]);
    await assert.rejects(pipeline.run());
  });

  it('isolates a failing specification to a warning without losing other candidates', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(join(root, 'agent.py'), 'kind = "agent"\n');
      },
      async (root) => {
        const throwingSpecification: DetectionSpecification = {
          code: 'throwing-specification',
          version: '1.0.0',
          candidateKind: 'TOOL',
          isSatisfiedBy(): readonly DetectionMatch[] {
            throw new Error('deliberately broken specification');
          },
        };

        const pipeline = new DiscoveryPipeline(
          new LocalRepositoryAdapter(root),
          [new AgentKindDeclarationSpecification(), throwingSpecification],
          { clock: fixedClock() },
        );
        const result = await pipeline.run();

        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0].finding.candidateKind, 'AGENT');
        assert.equal(result.warnings.length, 1);
        assert.match(result.warnings[0].reason, /throwing-specification/);
      },
    );
  });

  it('produces an empty, valid result for an empty repository', async () => {
    await withTempRepository(
      async () => {},
      async (root) => {
        const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [
          new AgentKindDeclarationSpecification(),
        ]);
        const result = await pipeline.run();

        assert.deepEqual(result.candidates, []);
        assert.deepEqual(result.warnings, []);
        assert.equal(result.run.status, 'SUCCEEDED');
      },
    );
  });

  it('does not deduplicate independent evidence-backed candidates for identical detections', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(join(root, 'one.py'), 'kind = "agent"\n');
        await writeFile(join(root, 'two.py'), 'kind = "agent"\n');
      },
      async (root) => {
        const pipeline = new DiscoveryPipeline(
          new LocalRepositoryAdapter(root),
          [new AgentKindDeclarationSpecification()],
          { clock: fixedClock() },
        );
        const result = await pipeline.run();

        assert.equal(result.candidates.length, 2);
        const findingIds = result.candidates.map((candidate) => candidate.finding.findingId);
        assert.equal(new Set(findingIds).size, 2, 'each candidate keeps a distinct finding identity');
      },
    );
  });

  it('produces output shaped by the canonical-contracts DiscoveryFinding/Evidence/SourceAssertion contracts', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(join(root, 'agent.py'), 'kind = "agent"\n');
      },
      async (root) => {
        const pipeline = new DiscoveryPipeline(
          new LocalRepositoryAdapter(root),
          [new AgentKindDeclarationSpecification()],
          { clock: fixedClock() },
        );
        const result = await pipeline.run();
        const [candidate] = result.candidates;

        assert.deepEqual(
          Object.keys(candidate.finding).sort(),
          [
            'assertionIds',
            'candidateKind',
            'confidence',
            'createsCanonicalObject',
            'detectedAt',
            'evidenceIds',
            'findingId',
            'findingNature',
            'requiresReview',
            'reviewStatus',
            'sourceObject',
          ].sort(),
        );
        assert.deepEqual(
          Object.keys(candidate.assertion).sort(),
          [
            'assertionId',
            'sourceObject',
            'runId',
            'snapshot',
            'method',
            'trustState',
            'confidence',
            'observedAt',
            'recordedAt',
            'evidenceIds',
          ].sort(),
        );
        assert.deepEqual(
          Object.keys(candidate.evidence).sort(),
          ['evidenceId', 'handling', 'locations', 'hashes', 'redactedExcerpt', 'capturedAt'].sort(),
        );
      },
    );
  });
});
