import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  asCanonicalObjectId, asNormalizedCandidateId, asOrganisationId, asSemanticRepresentationId,
  asSourceAssertionId, createSemanticContentFingerprint, createSemanticRepresentation,
  type SemanticRepresentation,
} from '@council/canonical-contracts';
import { compareSemanticRepresentations, createPossibleMatchCandidate, semanticSpaceIdentity,
  type PossibleMatchCandidate, type SemanticComparisonFamily, type SimilarityPolicy } from '../../src/semantic/similarity';
import { clusterPossibleMatches } from '../../src/semantic/possible-match-clustering';
import { buildSemanticRepresentation } from '../../src/semantic/semantic-representation-builder';

const organisationId = asOrganisationId('fixture-org');
const computedAt = '2026-09-09T00:00:00.000Z';
const policy: SimilarityPolicy = { policyVersion: 'fixture-policy-v1', metric: 'COSINE',
  comparisonFamily: 'AGENT', threshold: 0.8 };

function representation(id: string, family: SemanticComparisonFamily = 'AGENT',
  vector: readonly number[] = [1, 0]): SemanticRepresentation {
  return createSemanticRepresentation({ organisationId,
    representationId: asSemanticRepresentationId(`fixture-rep-${id}`),
    subject: { subjectKind: 'CANONICAL_OBJECT', organisationId,
      canonicalObjectId: asCanonicalObjectId(id), canonicalObjectKind: family },
    embeddingProvider: { providerId: 'TEST_ONLY', modelId: 'fixture', modelVersion: '1', dimension: 2 },
    projectionSchemaVersion: 'GOVIA_SEMANTIC_CONTENT_V1',
    contentFingerprint: createSemanticContentFingerprint({ algorithm: 'sha256', schemaVersion: 'fixture', value: id }),
    vector, support: { assertionIds: [asSourceAssertionId(`fixture-assertion-${id}`)], evidenceIds: [] }, generatedAt: computedAt,
  });
}

const source = representation('a'), target = representation('b');
function input(overrides: Partial<Parameters<typeof compareSemanticRepresentations>[0]> = {}) {
  return { organisationId, source, target, policy, computedAt, ...overrides };
}
function edge(a: string, b: string): PossibleMatchCandidate {
  return createPossibleMatchCandidate(input({ source: representation(a), target: representation(b) }))!;
}
function clusters(candidates: readonly PossibleMatchCandidate[]) {
  return clusterPossibleMatches({ organisationId, semanticSpace: semanticSpaceIdentity(source), policy, computedAt, candidates });
}

describe('L8 compatible semantic space and tenancy', () => {
  it('accepts the identical persisted L7 space and request tenant', () => {
    assert.equal(compareSemanticRepresentations(input()).score, 1);
    assert.deepEqual(semanticSpaceIdentity(source), {
      projectionSchemaVersion: source.projectionSchemaVersion, providerId: 'TEST_ONLY',
      modelId: 'fixture', modelVersion: '1', dimension: 2,
    });
  });
  for (const field of ['providerId', 'modelId', 'modelVersion'] as const) {
    it(`rejects a different ${field} even at the same dimension`, () => {
      assert.throws(() => compareSemanticRepresentations(input({ target: {
        ...target, embeddingProvider: { ...target.embeddingProvider, [field]: 'different' },
      } })), /L8_INCOMPATIBLE_SEMANTIC_SPACE/);
    });
    it(`rejects missing ${field}`, () => {
      assert.throws(() => compareSemanticRepresentations(input({ target: {
        ...target, embeddingProvider: { ...target.embeddingProvider, [field]: '' },
      } })), /L8_NONEMPTY_IDENTIFIER_REQUIRED/);
    });
  }
  it('rejects a different projection schema', () => {
    assert.throws(() => compareSemanticRepresentations(input({ target: {
      ...target, projectionSchemaVersion: 'GOVIA_SEMANTIC_CONTENT_V2',
    } })), /L8_INCOMPATIBLE_SEMANTIC_SPACE/);
  });
  it('rejects a different dimension with an internally valid vector', () => {
    assert.throws(() => compareSemanticRepresentations(input({ target: {
      ...target, embeddingProvider: { ...target.embeddingProvider, dimension: 3 }, vector: [1, 0, 0],
    } })), /L8_INCOMPATIBLE_SEMANTIC_SPACE/);
  });
  it('rejects both foreign representations even when their tenants match each other', () => {
    assert.throws(() => compareSemanticRepresentations(input({ organisationId: asOrganisationId('other') })), /L8_TENANT_MISMATCH/);
  });
  it('rejects one foreign representation', () => {
    assert.throws(() => compareSemanticRepresentations(input({ target: {
      ...target, organisationId: asOrganisationId('other'),
    } })), /L8_TENANT_MISMATCH/);
  });
  it('rejects a foreign subject hidden inside a same-tenant representation', () => {
    assert.throws(() => compareSemanticRepresentations(input({ target: {
      ...target, subject: { ...target.subject, organisationId: asOrganisationId('other') },
    } })), /organisationId/);
  });
  it('rejects unknown runtime subject families', () => {
    assert.throws(() => compareSemanticRepresentations(input({ target: {
      ...target, subject: { ...target.subject, subjectKind: 'UNKNOWN' } as never,
    } })), /L8_UNSUPPORTED_SUBJECT/);
  });
});

describe('L8 mathematically honest cosine', () => {
  for (const [label, left, right] of [
    ['left zero', [0, 0], [1, 0]],
    ['right zero', [1, 0], [0, 0]],
    ['both zero', [0, 0], [0, 0]],
  ] as const) {
    it(`fails closed with the domain error for ${label}`, () => {
      const request = input({ source: { ...source, vector: left }, target: { ...target, vector: right } });
      for (const operation of [compareSemanticRepresentations, createPossibleMatchCandidate]) {
        assert.throws(() => operation(request), { name: 'TypeError', message: 'L8_ZERO_VECTOR' });
      }
    });
  }
  it('keeps near-boundary and general finite nonzero scores bounded without rescaling', () => {
    for (const vector of [[1, 1 + Number.EPSILON], [-1, -1 - Number.EPSILON],
      [1, -1], [1e308, 1], [Number.MIN_VALUE, 1], [3, 4]]) {
      const score = compareSemanticRepresentations(input({
        source: { ...source, vector: [1, 1] }, target: { ...target, vector },
      })).score;
      assert.ok(Number.isFinite(score));
      assert.ok(score >= -1 && score <= 1);
    }
  });
  for (const [label, vector, expected] of [
    ['aligned', [1, 0], 1], ['orthogonal', [0, 1], 0], ['opposite', [-1, 0], -1],
    ['non-unit', [30, 40], 0.6], ['very large', [1e308, 0], 1], ['subnormal', [Number.MIN_VALUE, 0], 1],
  ] as const) {
    it(`computes ${label} vectors without governance rescaling`, () => {
      assert.equal(compareSemanticRepresentations(input({ target: { ...target, vector } })).score, expected);
    });
  }
  it('replays deterministically and symmetrically', () => {
    const request = input({ source: { ...source, vector: [0.1, 0.3] }, target: { ...target, vector: [-0.2, 0.8] } });
    assert.deepEqual(compareSemanticRepresentations(request), compareSemanticRepresentations(request));
    assert.deepEqual(compareSemanticRepresentations(request), compareSemanticRepresentations({
      ...request, source: request.target, target: request.source,
    }));
  });
  it('preserves exact multidimensional alignment at threshold 1 without an epsilon', () => {
    const aligned = input({ source: { ...source, vector: [1, 1] }, target: { ...target, vector: [3, 3] },
      policy: { ...policy, threshold: 1 } });
    assert.equal(createPossibleMatchCandidate(aligned)!.score, 1);
    assert.equal(compareSemanticRepresentations({ ...aligned, target: { ...target, vector: [-3, -3] } }).score, -1);
    assert.equal(createPossibleMatchCandidate({ ...aligned, target: { ...target, vector: [3, 2.99] } }), null);
  });
  for (const vector of [[1], [1, 0, 0]]) {
    it(`never pads or truncates ${vector.length} components`, () => {
      assert.throws(() => compareSemanticRepresentations(input({ target: { ...target, vector } })),
        { name: 'SemanticRepresentationDimensionMismatchError' });
      assert.deepEqual(vector, vector.length === 1 ? [1] : [1, 0, 0]);
    });
  }
  for (const vector of [[0, 0], [NaN, 1], [Infinity, 0], [1, -Infinity]]) {
    it(`rejects invalid/undefined cosine ${String(vector)}`, () => {
      assert.throws(() => compareSemanticRepresentations(input({ target: { ...target, vector } })));
    });
  }
});

describe('L8 possible matches and analytical policy', () => {
  it('deduplicates A/B and B/A by identical content-addressed identity and output', () => {
    assert.deepEqual(createPossibleMatchCandidate(input()), createPossibleMatchCandidate(input({ source: target, target: source })));
  });
  it('canonicalizes the complete candidate for nontrivial cosine in both execution directions', () => {
    const request = input({ source: { ...source, vector: [0.1, 0.3] },
      target: { ...target, vector: [-0.2, 0.8] } });
    const forward = createPossibleMatchCandidate(request)!;
    const reverse = createPossibleMatchCandidate({ ...request, source: request.target, target: request.source })!;
    assert.ok(forward);
    assert.ok(forward.score > policy.threshold && forward.score < 1);
    assert.deepEqual(forward, reverse);
    assert.deepEqual(forward.left.subject, source.subject);
    assert.deepEqual(forward.right.subject, target.subject);
    const later = createPossibleMatchCandidate({ ...request, source: request.target, target: request.source,
      computedAt: '2026-09-10T00:00:00Z' })!;
    assert.deepEqual({ ...later, computedAt }, forward);
  });
  it('excludes same representation', () => {
    assert.throws(() => createPossibleMatchCandidate(input({ target: source })), /L8_SELF_MATCH_EXCLUDED/);
  });
  it('excludes different representation versions of the same subject', () => {
    const version = { ...source, representationId: asSemanticRepresentationId('new-version') };
    assert.throws(() => createPossibleMatchCandidate(input({ target: version })), /L8_SELF_MATCH_EXCLUDED/);
    assert.throws(() => createPossibleMatchCandidate(input({ source: version, target: source })), /L8_SELF_MATCH_EXCLUDED/);
  });
  it('excludes the same representation ID even with inconsistent subjects', () => {
    const sameId = { ...target, representationId: source.representationId };
    assert.throws(() => createPossibleMatchCandidate(input({ target: sameId })), /L8_SELF_MATCH_EXCLUDED/);
    assert.throws(() => createPossibleMatchCandidate(input({ source: sameId, target: source })), /L8_SELF_MATCH_EXCLUDED/);
  });
  it('excludes timestamps and provenance from pair identity', () => {
    const later = createPossibleMatchCandidate(input({ computedAt: '2026-09-10T00:00:00Z',
      target: { ...target, support: { assertionIds: [asSourceAssertionId('new-support')], evidenceIds: [] } } }))!;
    assert.equal(later.candidateId, createPossibleMatchCandidate(input())!.candidateId);
    assert.notEqual(later.computedAt, computedAt);
  });
  for (const change of [{ policyVersion: 'fixture-policy-v2' }, { threshold: 0.9 }]) {
    it(`binds full policy changes to identity ${JSON.stringify(change)}`, () => {
      assert.notEqual(createPossibleMatchCandidate(input({ policy: { ...policy, ...change } }))!.candidateId,
        createPossibleMatchCandidate(input())!.candidateId);
    });
  }
  it('emits no candidate below threshold (absence is not FALSE identity)', () => {
    assert.equal(createPossibleMatchCandidate(input({ target: representation('b', 'AGENT', [0, 1]) })), null);
  });
  it('emits at the inclusive configured threshold', () => {
    assert.equal(createPossibleMatchCandidate(input({ policy: { ...policy, threshold: 1 } }))!.score, 1);
  });
  it('accepts thresholds -1 and 0 inclusively without converting the score to confidence', () => {
    for (const [threshold, vector] of [[-1, [-1, 0]], [0, [0, 1]]] as const) {
      const candidate = createPossibleMatchCandidate(input({ target: { ...target, vector },
        policy: { ...policy, threshold } }))!;
      assert.equal(candidate.score, threshold);
      assert.equal(candidate.status, 'ANALYTICAL');
    }
  });
  for (const threshold of [NaN, Infinity, -1.01, 1.01, undefined]) {
    it(`rejects invalid or missing threshold ${String(threshold)}`, () => {
      assert.throws(() => createPossibleMatchCandidate(input({ policy: { ...policy, threshold } as SimilarityPolicy })), /L8_INVALID_POLICY/);
    });
  }
  it('requires a versioned policy and supported metric', () => {
    assert.throws(() => createPossibleMatchCandidate(input({ policy: { ...policy, policyVersion: '' } })));
    assert.throws(() => createPossibleMatchCandidate(input({ policy: { ...policy, metric: 'L2' } as never })), /L8_INVALID_POLICY/);
  });
  it('requires a valid explicit computation context', () => {
    assert.throws(() => createPossibleMatchCandidate(input({ computedAt: '' })), /L8_INVALID_COMPUTED_AT/);
  });
  it('high scores retain only local analytical status and no authority fields', () => {
    const candidate = createPossibleMatchCandidate(input())!;
    assert.equal(candidate.score, 1);
    assert.equal(candidate.status, 'ANALYTICAL');
    assert.deepEqual(Object.keys(candidate).sort(), ['organisationId', 'comparisonFamily', 'left', 'right',
      'semanticSpace', 'metric', 'score', 'algorithmVersion', 'policy', 'computedAt', 'candidateId', 'status', 'eligibility'].sort());
    assert.doesNotMatch(JSON.stringify(candidate), /VALIDATED|confidence|trust|MATCH_EXISTING/);
  });
});

describe('L8 protected entity families', () => {
  for (const family of ['AGENT', 'AGENT_VERSION', 'DATA_ELEMENT', 'PROMPT'] as const) {
    it(`compares existing ${family} representations without creating any subject`, () => {
      const a = representation('a', family), b = representation('b', family);
      const before = JSON.stringify([a, b]);
      const result = createPossibleMatchCandidate(input({ source: a, target: b,
        policy: { ...policy, comparisonFamily: family } }))!;
      assert.equal(result.comparisonFamily, family);
      assert.equal(JSON.stringify([a, b]), before);
      assert.deepEqual(result.left.subject, a.subject);
    });
  }
  it('never conflates AGENT and AGENT_VERSION', () => {
    assert.throws(() => createPossibleMatchCandidate(input({ target: representation('b', 'AGENT_VERSION') })), /L8_FAMILY_MISMATCH/);
  });
  it('fails closed for cross-kind PROMPT/DATA_ELEMENT', () => {
    assert.throws(() => createPossibleMatchCandidate(input({ source: representation('a', 'PROMPT'),
      target: representation('b', 'DATA_ELEMENT'), policy: { ...policy, comparisonFamily: 'PROMPT' } })), /L8_FAMILY_MISMATCH/);
  });
  it('does not introduce CONFIGURATION as a canonical kind or comparison entity', () => {
    assert.throws(() => createPossibleMatchCandidate(input({ policy: { ...policy,
      comparisonFamily: 'CONFIGURATION' } as never })), /L8_UNSUPPORTED_FAMILY/);
  });
  it('preserves candidate/canonical namespaces within the same entity family', () => {
    const candidate = { ...source, subject: { subjectKind: 'NORMALIZED_CANDIDATE' as const,
      organisationId, candidateKind: 'AGENT' as const, candidateId: asNormalizedCandidateId('a') } };
    const result = createPossibleMatchCandidate(input({ source: candidate }))!;
    assert.deepEqual(new Set([result.left.subject.subjectKind, result.right.subject.subjectKind]),
      new Set(['NORMALIZED_CANDIDATE', 'CANONICAL_OBJECT']));
  });
  it('requires provenance even when a runtime caller bypasses the L7 constructor', () => {
    assert.throws(() => compareSemanticRepresentations(input({ source: {
      ...source, support: { assertionIds: [], evidenceIds: [] },
    } })), /SUPPORT_REQUIRED/);
  });
  it('strips accidental raw content, vectors and metadata from every output boundary', () => {
    const marker = 'RAW_PROMPT_SECRET_MARKER';
    const wide = { ...source, rawPrompt: marker, credentials: marker,
      subject: { ...source.subject, rawPrompt: marker },
      embeddingProvider: { ...source.embeddingProvider, apiKey: marker },
      support: { ...source.support, excerpt: marker } };
    const result = createPossibleMatchCandidate(input({ source: wide,
      policy: { ...policy, rawPrompt: marker } as SimilarityPolicy }))!;
    assert.doesNotMatch(JSON.stringify(result), /RAW_PROMPT_SECRET_MARKER|vector|rawPrompt|credentials|apiKey|excerpt/);
    assert.deepEqual(result.left.support.assertionIds, source.support.assertionIds);
    assert.ok(Object.isFrozen(result.left.subject));
    assert.ok(Object.isFrozen(result.left.support.assertionIds));
    assert.doesNotMatch(JSON.stringify(clusters([result])), /RAW_PROMPT_SECRET_MARKER|vector/);
  });
  it('compares evidence-backed non-secret configuration projections through AGENT_VERSION L7', async () => {
    const build = (id: string, value: string) => buildSemanticRepresentation({
      subject: representation(id, 'AGENT_VERSION').subject,
      projection: { subjectKind: 'CANONICAL_OBJECT', objectKind: 'AGENT_VERSION',
        knownTechnicalFacts: [['runtimeFramework', value]] },
      provider: { providerId: 'TEST_ONLY', modelId: 'test-only-fixture', modelVersion: '1', dimension: 2,
        embed: async () => ({ vector: [1, 0] }) },
      support: source.support, generatedAt: computedAt,
    });
    const a = await build('config-a', 'LangGraph'), b = await build('config-b', 'LangGraph');
    assert.equal(createPossibleMatchCandidate(input({ source: a, target: b,
      policy: { ...policy, comparisonFamily: 'AGENT_VERSION' } }))!.status, 'ANALYTICAL');
    await assert.rejects(build('secret-config', 'api_key=fixture-secret'), /secret\/credential/);
  });
});

describe('L8 conservative connected components', () => {
  it('fails closed on conflicting scores for the same analytical pair identity', () => {
    const ab = edge('a', 'b');
    assert.throws(() => clusters([ab, { ...ab, score: 0.9 }]), /L8_CONFLICTING_EDGE_REPLAY/);
  });
  it('rejects one representation id bound to different subjects across valid individual edges', () => {
    const ab = edge('a', 'b');
    const cd = createPossibleMatchCandidate(input({ source: { ...representation('c'),
      representationId: source.representationId }, target: representation('d') }))!;
    assert.throws(() => clusters([ab, cd]), /L8_REPRESENTATION_SUBJECT_CONFLICT/);
  });
  it('forms deterministic components independent of edge traversal and duplicates', () => {
    const ab = edge('a', 'b'), bc = edge('b', 'c'), de = edge('d', 'e');
    const result = clusters([ab, bc, de]);
    assert.deepEqual(result, clusters([de, bc, ab, ab]));
    assert.deepEqual(result.map(c => c.members.length).sort(), [2, 3]);
    assert.equal(result.find(c => c.members.length === 3)!.candidateIds.length, 2);
    assert.ok(result.every(c => c.status === 'ANALYTICAL'));
  });
  it('preserves complete clusters under reversed pair orientation, edge order and duplicates', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('d', 'e')];
    const reversed = edges.map(candidate => ({ ...candidate, left: candidate.right, right: candidate.left })).reverse();
    const expected = clusters(edges);
    assert.deepEqual(clusters(reversed), expected);
    assert.deepEqual(clusters([...reversed, ...edges, ...reversed]), expected);
    assert.deepEqual(clusters([edge('e', 'd'), edge('c', 'b'), edge('b', 'a')]), expected);
    assert.throws(() => clusters([{ ...reversed[0], candidateId: 'forged' }]), /L8_INVALID_PAIR_IDENTITY/);
    assert.throws(() => clusters([edges[0], { ...reversed[2], score: 0.9 }]), /L8_CONFLICTING_EDGE_REPLAY/);
  });
  it('returns an empty population without fabricating DataElements or singleton entities', () => {
    assert.deepEqual(clusterPossibleMatches({ organisationId, semanticSpace: semanticSpaceIdentity(source),
      policy: { ...policy, comparisonFamily: 'DATA_ELEMENT' }, computedAt, candidates: [] }), []);
  });
  it('cluster identity ignores timestamps and edge representation versions, preserving sorted subjects', () => {
    const first = edge('a', 'b');
    const later = createPossibleMatchCandidate(input({ source: {
      ...source, representationId: asSemanticRepresentationId('new-rep-a') },
      computedAt: '2026-09-10T00:00:00Z' }))!;
    assert.notEqual(first.candidateId, later.candidateId);
    assert.equal(clusters([first])[0].clusterId, clusters([later])[0].clusterId);
  });
  for (const [label, mutate] of [
    ['tenant', (c: PossibleMatchCandidate) => ({ ...c, organisationId: asOrganisationId('other') })],
    ['subject tenant', (c: PossibleMatchCandidate) => ({ ...c, left: { ...c.left,
      subject: { ...c.left.subject, organisationId: asOrganisationId('other') } } })],
    ['space', (c: PossibleMatchCandidate) => ({ ...c, semanticSpace: { ...c.semanticSpace, modelVersion: '2' } })],
    ['family', (c: PossibleMatchCandidate) => ({ ...c, comparisonFamily: 'PROMPT' })],
    ['policy version', (c: PossibleMatchCandidate) => ({ ...c, policy: { ...c.policy, policyVersion: 'v2' } })],
    ['policy threshold', (c: PossibleMatchCandidate) => ({ ...c, policy: { ...c.policy, threshold: 0.9 } })],
    ['self-match', (c: PossibleMatchCandidate) => ({ ...c, right: c.left })],
    ['forged id', (c: PossibleMatchCandidate) => ({ ...c, candidateId: 'forged' })],
    ['high trust', (c: PossibleMatchCandidate) => ({ ...c, status: 'VALIDATED' })],
    ['below threshold', (c: PossibleMatchCandidate) => ({ ...c, score: 0.1 })],
    ['nonfinite score', (c: PossibleMatchCandidate) => ({ ...c, score: NaN })],
    ['out of range score', (c: PossibleMatchCandidate) => ({ ...c, score: 2 })],
    ['different algorithm', (c: PossibleMatchCandidate) => ({ ...c, algorithmVersion: 'other' })],
  ] as const) {
    it(`rejects mixed or invalid ${label} before producing any cluster`, () => {
      assert.throws(() => clusters([edge('a', 'b'), mutate(edge('b', 'c')) as PossibleMatchCandidate]));
    });
  }
});

describe('L8 authority and infrastructure boundary', () => {
  for (const file of ['similarity.ts', 'possible-match-clustering.ts']) {
    it(`${file} has no authority, database, L9, Graph or provider execution dependency`, () => {
      const text = readFileSync(new URL(`../../src/semantic/${file}`, import.meta.url), 'utf8');
      const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
      assert.ok(imports.every(name => ['node:crypto', '@council/canonical-contracts', './similarity'].includes(name)));
      assert.doesNotMatch(text, /createCanonicalObject\s*\(|createReviewSubject\s*\(|reconcil\w*\s*\(|certify\w*\s*\(|materializ\w*\s*\(|\.rpc\s*\(|\.embed\s*\(|fetch\s*\(|agent_embeddings|coding_memory|hnsw|ivfflat/i);
    });
  }
});
