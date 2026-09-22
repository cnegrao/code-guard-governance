import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { asOrganisationId } from '@council/canonical-contracts';

import { GitHubSourceAdapter } from '../../src/discovery/adapters/github-source-adapter';
import { LocalRepositoryAdapter } from '../../src/discovery/adapters/local-repository-adapter';
import { correlateAgentVersions } from '../../src/discovery/agent-version-correlation';
import { normalizeObjectCandidate } from '../../src/discovery/object-candidate-normalization';
import { DiscoveryPipeline } from '../../src/discovery/pipeline';
import {
  correlateAgentUsesModelRelationships,
  type RelationshipCorrelationContext,
} from '../../src/discovery/relationship-correlation';
import { AgentKindDeclarationSpecification } from '../../src/discovery/strategies/agent-kind-declaration';
import {
  FrameworkImportSignalSpecification,
} from '../../src/discovery/strategies/framework-import-signal';
import { ModelReferenceDeclarationSpecification } from '../../src/discovery/strategies/model-reference-declaration';
import { ToolListDeclarationSpecification } from '../../src/discovery/strategies/tool-list-declaration';

const OBSERVED_AT = '2026-01-01T00:00:00.000Z';

function fixedClock() {
  return { now: () => OBSERVED_AT };
}

/**
 * Independent reimplementation of the scanner's internal, non-exported
 * `stableSuffix` (evidence-assembly.ts / technical-profile-signal.ts /
 * agent-version-correlation.ts all define their own copy of this exact
 * sha256-hex-truncated-to-32 formula). Used only to hand-compute the
 * pre-Phase-2 ID formulas from first principles, independent of the
 * production code path, so a backward-compatibility test proves the actual
 * formula rather than merely re-running the same (possibly still-buggy)
 * production code.
 */
function stableSuffixLike(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

const OWNER = 'acme';
const REPO = 'agents';
const REF = 'main';

/** Queues exactly the fetch responses one full pipeline run against GitHubSourceAdapter makes:
 * commit resolution, then the recursive tree, then one contents fetch per file (sorted locator order). */
function mockGitHubFetch(sha: string, files: Record<string, string>): typeof globalThis.fetch {
  const locators = Object.keys(files).sort();
  const queue: unknown[] = [
    { sha },
    {
      truncated: false,
      tree: locators.map((locator) => ({
        path: locator,
        type: 'blob',
        size: Buffer.byteLength(files[locator], 'utf8'),
      })),
    },
    ...locators.map((locator) => ({
      type: 'file',
      encoding: 'base64',
      content: Buffer.from(files[locator], 'utf8').toString('base64'),
      path: locator,
    })),
  ];
  return (async () => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error('Unexpected network request');
    }
    return { ok: true, json: async () => next };
  }) as unknown as typeof globalThis.fetch;
}

function githubAdapter(sha: string, files: Record<string, string>): GitHubSourceAdapter {
  return new GitHubSourceAdapter({ owner: OWNER, repo: REPO, ref: REF, fetchImpl: mockGitHubFetch(sha, files) });
}

const OBJECT_SPECIFICATIONS = () => [
  new AgentKindDeclarationSpecification(),
  new ModelReferenceDeclarationSpecification(),
  new ToolListDeclarationSpecification(),
];

async function scanGitHub(
  sha: string,
  files: Record<string, string>,
  specifications = OBJECT_SPECIFICATIONS(),
) {
  const pipeline = new DiscoveryPipeline(githubAdapter(sha, files), specifications, { clock: fixedClock() });
  return pipeline.run();
}

async function withTempRepository(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'github-source-version-propagation-'));
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

describe('GitHub source version propagation: acquisition run', () => {
  it('resolves the branch to an immutable SHA and propagates commit:<sha> into run.sourceVersion', async () => {
    const sha = 'a'.repeat(40);
    const result = await scanGitHub(sha, { 'agent.py': 'kind = "agent"\n' });
    assert.equal(result.run.sourceVersion, `commit:${sha}`);
    assert.equal(result.run.status, 'SUCCEEDED');
  });

  it('fails closed before producing any discovery output when GitHub source version resolution fails', async () => {
    const fetchImpl = (async () => ({
      ok: false,
      json: async () => ({ message: 'not found' }),
    })) as unknown as typeof globalThis.fetch;
    const adapter = new GitHubSourceAdapter({ owner: OWNER, repo: REPO, ref: REF, fetchImpl });
    const pipeline = new DiscoveryPipeline(adapter, [new AgentKindDeclarationSpecification()], {
      clock: fixedClock(),
    });

    await assert.rejects(pipeline.run());
  });
});

describe('GitHub source version propagation: snapshot and evidence', () => {
  it('propagates the exact run.sourceVersion into snapshot.sourceVersion and the raw SHA into EvidenceLocation.commit', async () => {
    const sha = 'b'.repeat(40);
    const result = await scanGitHub(sha, { 'agent.py': 'kind = "agent"\n' });

    assert.equal(result.candidates.length, 1);
    const [candidate] = result.candidates;
    assert.equal(candidate.assertion.snapshot?.sourceVersion, `commit:${sha}`);
    assert.equal(candidate.evidence.locations.length, 1);
    const [location] = candidate.evidence.locations;
    assert.equal(location.kind, 'REPOSITORY');
    assert.equal(location.commit, sha);
    assert.equal(/^[0-9a-f]{40}$/.test(location.commit ?? ''), true, 'commit is the raw lowercase 40-hex SHA, never "commit:<sha>"');
  });

  it('technical-profile signals receive the identical sourceVersion/snapshot/evidence-location treatment as DiscoveryCandidate evidence', async () => {
    const sha = 'c'.repeat(40);
    const text = ['class SupportAgent:', '    kind = "agent"', 'from langgraph import StateGraph'].join('\n');
    const pipeline = new DiscoveryPipeline(githubAdapter(sha, { 'agent.py': text }), OBJECT_SPECIFICATIONS(), {
      clock: fixedClock(),
      signalSpecifications: [new FrameworkImportSignalSpecification()],
    });
    const result = await pipeline.run();

    assert.equal(result.technicalProfileSignals.length, 1);
    const [signal] = result.technicalProfileSignals;
    assert.equal(signal.assertion.snapshot?.sourceVersion, `commit:${sha}`);
    assert.equal(signal.evidence.locations[0].commit, sha);
  });
});

describe('GitHub source version propagation: cross-commit separation', () => {
  it('the same connection/path/content/detector/lines/display value under a different commit SHA produces distinct provenance and discovery identities', async () => {
    const files = { 'agent.py': 'class SupportAgent:\n    kind = "agent"\n' };
    const shaA = '1'.repeat(40);
    const shaB = '2'.repeat(40);
    const specs = [new AgentKindDeclarationSpecification()];

    const resultA = await scanGitHub(shaA, files, specs);
    const resultB = await scanGitHub(shaB, files, specs);
    assert.equal(resultA.candidates.length, 1);
    assert.equal(resultB.candidates.length, 1);
    const [a] = resultA.candidates;
    const [b] = resultB.candidates;

    // Same connection (same owner/repo), same path, same content, same detector, same lines, same display value.
    assert.equal(a.finding.sourceObject.connectionId, b.finding.sourceObject.connectionId);
    assert.equal(a.finding.sourceObject.externalId, b.finding.sourceObject.externalId);
    assert.equal(a.displayValue, b.displayValue);
    assert.deepEqual(
      a.evidence.locations.map((l) => [l.lineStart, l.lineEnd]),
      b.evidence.locations.map((l) => [l.lineStart, l.lineEnd]),
    );

    // Yet every provenance/discovery identity differs.
    assert.notEqual(a.assertion.snapshot?.snapshotId, b.assertion.snapshot?.snapshotId);
    assert.notEqual(a.evidence.evidenceId, b.evidence.evidenceId);
    assert.notEqual(a.assertion.assertionId, b.assertion.assertionId);
    assert.notEqual(a.finding.findingId, b.finding.findingId);
    assert.notEqual(a.evidence.locations[0].commit, b.evidence.locations[0].commit);

    const normalizedA = normalizeObjectCandidate(a);
    const normalizedB = normalizeObjectCandidate(b);
    assert.equal(normalizedA.status, 'NORMALIZED');
    assert.equal(normalizedB.status, 'NORMALIZED');
    if (normalizedA.status === 'NORMALIZED' && normalizedB.status === 'NORMALIZED') {
      assert.notEqual(normalizedA.candidate.candidateId, normalizedB.candidate.candidateId);
    }
  });

  it('cross-commit separation extends to AGENT_VERSION correlation identities', async () => {
    const files = {
      'agent.py': ['class SupportAgent:', '    kind = "agent"', '    modelReference = "gpt-x"'].join('\n'),
    };
    const shaA = '3'.repeat(40);
    const shaB = '4'.repeat(40);
    const specs = [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()];

    const resultA = await scanGitHub(shaA, files, specs);
    const resultB = await scanGitHub(shaB, files, specs);
    const versionsA = correlateAgentVersions(resultA.candidates, [], { observedAt: OBSERVED_AT });
    const versionsB = correlateAgentVersions(resultB.candidates, [], { observedAt: OBSERVED_AT });

    assert.equal(versionsA.length, 1);
    assert.equal(versionsB.length, 1);
    assert.notEqual(versionsA[0].finding.findingId, versionsB[0].finding.findingId);
    assert.notEqual(versionsA[0].candidate.candidateId, versionsB[0].candidate.candidateId);
  });
});

describe('GitHub source version propagation: same-commit determinism', () => {
  it('repeated scanning of the same immutable commit with identical evidence reproduces the same version-scoped discovery IDs apart from run UUID/timestamps', async () => {
    const sha = '5'.repeat(40);
    const files = { 'agent.py': 'kind = "agent"\n', 'model.py': 'modelReference = "gpt-x"\n' };
    const specs = () => [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()];

    const first = await scanGitHub(sha, files, specs());
    const second = await scanGitHub(sha, files, specs());

    assert.notEqual(first.run.runId, second.run.runId, 'each run keeps its own run identity');
    assert.equal(first.run.sourceVersion, second.run.sourceVersion);
    assert.equal(first.candidates.length, second.candidates.length);

    const stable = (result: typeof first) =>
      result.candidates
        .map((candidate) => ({
          findingId: candidate.finding.findingId,
          assertionId: candidate.assertion.assertionId,
          evidenceId: candidate.evidence.evidenceId,
          snapshotId: candidate.assertion.snapshot?.snapshotId,
          commit: candidate.evidence.locations[0]?.commit,
        }))
        .sort((left, right) => left.findingId.localeCompare(right.findingId));

    assert.deepEqual(stable(first), stable(second));
  });
});

describe('GitHub source version propagation: canonical semantic stability', () => {
  it('different source versions with identical declaration semantics propose the identical canonical identity, while discovery identity and technical revision fingerprint stay stable/version-scoped correctly', async () => {
    const files = {
      'agent.py': ['class SupportAgent:', '    kind = "agent"', '    modelReference = "gpt-x"'].join('\n'),
    };
    const shaA = '6'.repeat(40);
    const shaB = '7'.repeat(40);
    const specs = [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()];

    const resultA = await scanGitHub(shaA, files, specs);
    const resultB = await scanGitHub(shaB, files, specs);

    const agentA = resultA.candidates.find((c) => c.finding.candidateKind === 'AGENT')!;
    const agentB = resultB.candidates.find((c) => c.finding.candidateKind === 'AGENT')!;
    const normA = normalizeObjectCandidate(agentA);
    const normB = normalizeObjectCandidate(agentB);
    assert.equal(normA.status, 'NORMALIZED');
    assert.equal(normB.status, 'NORMALIZED');
    if (normA.status === 'NORMALIZED' && normB.status === 'NORMALIZED') {
      assert.deepEqual(normA.candidate.proposedIdentity, normB.candidate.proposedIdentity, 'canonical proposedIdentity never carries sourceVersion/commit');
      assert.notEqual(normA.candidate.candidateId, normB.candidate.candidateId, 'discovery-layer candidateId still stays version-scoped');
    }

    const versionsA = correlateAgentVersions(resultA.candidates, [], { observedAt: OBSERVED_AT });
    const versionsB = correlateAgentVersions(resultB.candidates, [], { observedAt: OBSERVED_AT });
    assert.equal(versionsA.length, 1);
    assert.equal(versionsB.length, 1);
    assert.equal(
      versionsA[0].technicalRevisionFingerprint,
      versionsB[0].technicalRevisionFingerprint,
      'identical semantic technical evidence => identical technical revision fingerprint, never contaminated by sourceVersion',
    );
    assert.notEqual(
      versionsA[0].candidate.candidateId,
      versionsB[0].candidate.candidateId,
      'the source-scoped AGENT_VERSION candidateId still differs per immutable commit',
    );
    assert.deepEqual(versionsA[0].candidate.proposedIdentity, versionsB[0].candidate.proposedIdentity);
  });
});

describe('GitHub source version propagation: no mixed-version correlation', () => {
  it('never merges AGENT_VERSION support across two different commits of what looks like the same file', async () => {
    const files = {
      'agent.py': ['class SupportAgent:', '    kind = "agent"', '    modelReference = "gpt-x"'].join('\n'),
    };
    const shaA = '8'.repeat(40);
    const shaB = '9'.repeat(40);
    const specs = [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()];

    const resultA = await scanGitHub(shaA, files, specs);
    const resultB = await scanGitHub(shaB, files, specs);
    const merged = [...resultA.candidates, ...resultB.candidates];

    const versions = correlateAgentVersions(merged, [], { observedAt: OBSERVED_AT });
    assert.equal(versions.length, 2, 'two immutable commits of the same file never collapse into one AGENT_VERSION');
    assert.notEqual(versions[0].candidate.candidateId, versions[1].candidate.candidateId);

    const evidenceIdsA = new Set(resultA.candidates.flatMap((c) => c.finding.evidenceIds));
    const evidenceIdsB = new Set(resultB.candidates.flatMap((c) => c.finding.evidenceIds));
    for (const version of versions) {
      const fromA = version.finding.evidenceIds.filter((id) => evidenceIdsA.has(id));
      const fromB = version.finding.evidenceIds.filter((id) => evidenceIdsB.has(id));
      const touchesA = fromA.length > 0;
      const touchesB = fromB.length > 0;
      assert.notEqual(touchesA, touchesB, 'each AGENT_VERSION must draw all of its support from exactly one commit, never both');
    }
  });

  it('relationship correlation never binds an AGENT_VERSION from one commit to MODEL evidence from a different commit', async () => {
    const files = {
      'agent.py': ['class SupportAgent:', '    kind = "agent"', '    modelReference = "gpt-x"'].join('\n'),
    };
    const shaA = 'aa11'.repeat(10);
    const shaB = 'bb22'.repeat(10);
    const specs = [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()];

    const resultA = await scanGitHub(shaA, files, specs);
    const resultB = await scanGitHub(shaB, files, specs);
    const merged = [...resultA.candidates, ...resultB.candidates];

    const context: RelationshipCorrelationContext = {
      organisationId: asOrganisationId('org-cross-version-test'),
      connectionId: merged[0].finding.sourceObject.connectionId,
      agentVersions: correlateAgentVersions(merged, [], { observedAt: OBSERVED_AT }),
      technicalProfileSignals: [],
    };

    const relationships = correlateAgentUsesModelRelationships(merged, { observedAt: OBSERVED_AT, context });
    assert.equal(relationships.length, 2, 'one USES_MODEL relationship per commit, never merged into one');

    const modelEvidenceIdsA = new Set(
      resultA.candidates.filter((c) => c.finding.candidateKind === 'MODEL').flatMap((c) => c.finding.evidenceIds),
    );
    const modelEvidenceIdsB = new Set(
      resultB.candidates.filter((c) => c.finding.candidateKind === 'MODEL').flatMap((c) => c.finding.evidenceIds),
    );
    for (const relationship of relationships) {
      const usesA = relationship.candidate.evidenceIds.some((id) => modelEvidenceIdsA.has(id));
      const usesB = relationship.candidate.evidenceIds.some((id) => modelEvidenceIdsB.has(id));
      assert.notEqual(usesA, usesB, 'relationship support must come from exactly one commit, never both');
    }
  });
});

describe('GitHub source version propagation: LocalRepositoryAdapter regression', () => {
  it('never fabricates a sourceVersion, snapshot.sourceVersion, or EvidenceLocation.commit for a local (unversioned) scan', async () => {
    await withTempRepository({ 'agent.py': 'kind = "agent"\n' }, async (root) => {
      const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [new AgentKindDeclarationSpecification()], {
        clock: fixedClock(),
      });
      const result = await pipeline.run();

      assert.equal(result.run.sourceVersion, undefined);
      assert.equal(result.candidates.length, 1);
      const [candidate] = result.candidates;
      assert.equal(candidate.assertion.snapshot?.sourceVersion, undefined);
      assert.equal('commit' in candidate.evidence.locations[0], false);
    });
  });
});

describe('GitHub source version propagation: unversioned backward compatibility', () => {
  it('reproduces the exact pre-Phase-2 evidenceId/assertionId/findingId/snapshotId formulas for an unversioned LocalRepositoryAdapter candidate', async () => {
    await withTempRepository({ 'agent.py': 'class SupportAgent:\n    kind = "agent"\n' }, async (root) => {
      const specification = new AgentKindDeclarationSpecification();
      const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [specification], { clock: fixedClock() });
      const result = await pipeline.run();

      assert.equal(result.run.sourceVersion, undefined);
      assert.equal(result.candidates.length, 1);
      const [candidate] = result.candidates;

      // Every input below is read back from the actual output (connectionId,
      // locator, matched line span, display value, content hash) rather than
      // guessed, so this reproduces the pre-Phase-2 formula from first
      // principles: hash([old inputs]) with NO extra element — not run
      // through any Phase-2 code path.
      const connectionId = candidate.finding.sourceObject.connectionId;
      const locator = candidate.finding.sourceObject.externalId;
      const [location] = candidate.evidence.locations;
      const contentHash = candidate.evidence.hashes[0].value;

      const oldIdSeed = [
        connectionId,
        locator,
        specification.code,
        specification.version,
        String(location.lineStart),
        String(location.lineEnd),
        candidate.displayValue,
      ];

      assert.equal(candidate.evidence.evidenceId, `evidence:${stableSuffixLike(oldIdSeed)}`);
      assert.equal(candidate.assertion.assertionId, `source-assertion:${stableSuffixLike(oldIdSeed)}`);
      assert.equal(
        candidate.finding.findingId,
        `discovery-finding:${stableSuffixLike([...oldIdSeed, specification.candidateKind])}`,
      );
      assert.equal(
        candidate.assertion.snapshot?.snapshotId,
        `source-snapshot:${stableSuffixLike([connectionId, locator, contentHash])}`,
      );

      const normalized = normalizeObjectCandidate(candidate);
      assert.equal(normalized.status, 'NORMALIZED');
      if (normalized.status === 'NORMALIZED') {
        assert.equal(
          normalized.candidate.candidateId,
          `candidate:${normalized.candidate.candidateKind.toLowerCase()}:${stableSuffixLike([
            candidate.finding.findingId,
            normalized.candidate.candidateKind,
          ])}`,
        );
      }
    });
  });

  it('reproduces the exact pre-Phase-2 technical-profile-signal evidenceId/assertionId/snapshotId formulas for an unversioned run', async () => {
    await withTempRepository(
      { 'agent.py': ['class SupportAgent:', '    kind = "agent"', 'from langgraph import StateGraph'].join('\n') },
      async (root) => {
        const specification = new FrameworkImportSignalSpecification();
        const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [new AgentKindDeclarationSpecification()], {
          clock: fixedClock(),
          signalSpecifications: [specification],
        });
        const result = await pipeline.run();

        assert.equal(result.run.sourceVersion, undefined);
        assert.equal(result.technicalProfileSignals.length, 1);
        const [signal] = result.technicalProfileSignals;

        const connectionId = signal.sourceObject.connectionId;
        const locator = signal.sourceObject.externalId;
        const [location] = signal.evidence.locations;
        const contentHash = signal.evidence.hashes[0].value;

        const oldIdSeed = [
          connectionId,
          locator,
          specification.code,
          specification.version,
          String(location.lineStart),
          String(location.lineEnd),
          signal.value,
        ];

        assert.equal(signal.evidence.evidenceId, `evidence:${stableSuffixLike(oldIdSeed)}`);
        assert.equal(signal.assertion.assertionId, `source-assertion:${stableSuffixLike(oldIdSeed)}`);
        assert.equal(
          signal.assertion.snapshot?.snapshotId,
          `source-snapshot:${stableSuffixLike([connectionId, locator, contentHash])}`,
        );
      },
    );
  });

  it('reproduces the exact pre-Phase-2 AGENT_VERSION source-scope hash input for an unversioned run', async () => {
    await withTempRepository(
      { 'agent.py': ['class SupportAgent:', '    kind = "agent"', '    modelReference = "gpt-x"'].join('\n') },
      async (root) => {
        const pipeline = new DiscoveryPipeline(
          new LocalRepositoryAdapter(root),
          [new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()],
          { clock: fixedClock() },
        );
        const result = await pipeline.run();
        assert.equal(result.run.sourceVersion, undefined);

        const versions = correlateAgentVersions(result.candidates, [], { observedAt: OBSERVED_AT });
        assert.equal(versions.length, 1);
        const [version] = versions;

        const agent = result.candidates.find((c) => c.finding.candidateKind === 'AGENT')!;
        const sourceObject = agent.finding.sourceObject;
        // Old (pre-Phase-2) 3-element source-scope input: no sourceVersion
        // element at all for an unversioned run.
        const expectedSourceScope = stableSuffixLike([
          sourceObject.connectionId,
          sourceObject.externalType,
          sourceObject.externalId,
        ]);
        const expectedSuffix = stableSuffixLike([expectedSourceScope, version.technicalRevisionFingerprint]);

        assert.equal(version.finding.findingId, `discovery-finding:agent-version:${expectedSuffix}`);
        assert.equal(version.candidate.candidateId, `candidate:agent-version:${expectedSuffix}`);
      },
    );
  });

  it('extends the AGENT_VERSION source-scope hash input with sourceVersion only when a version is actually present', async () => {
    const sha = 'd'.repeat(40);
    const files = { 'agent.py': ['class SupportAgent:', '    kind = "agent"', '    modelReference = "gpt-x"'].join('\n') };
    const result = await scanGitHub(sha, files, [
      new AgentKindDeclarationSpecification(),
      new ModelReferenceDeclarationSpecification(),
    ]);

    const versions = correlateAgentVersions(result.candidates, [], { observedAt: OBSERVED_AT });
    assert.equal(versions.length, 1);
    const [version] = versions;

    const agent = result.candidates.find((c) => c.finding.candidateKind === 'AGENT')!;
    const sourceObject = agent.finding.sourceObject;
    const expectedSourceScope = stableSuffixLike([
      sourceObject.connectionId,
      sourceObject.externalType,
      sourceObject.externalId,
      `commit:${sha}`,
    ]);
    const expectedSuffix = stableSuffixLike([expectedSourceScope, version.technicalRevisionFingerprint]);

    assert.equal(version.candidate.candidateId, `candidate:agent-version:${expectedSuffix}`);
  });
});
