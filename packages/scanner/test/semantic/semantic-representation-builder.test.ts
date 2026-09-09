import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  asCanonicalObjectId,
  asNormalizedCandidateId,
  asOrganisationId,
  asSourceAssertionId,
  asEvidenceId,
  createSemanticContentFingerprint,
  type CanonicalObjectKind,
  type DiscoveryCandidateKind,
  type SemanticRepresentationSubjectReference,
} from '@council/canonical-contracts';

import { TestOnlyDeterministicEmbeddingProvider } from './test-only-deterministic-embedding-provider';
import { buildSemanticRepresentation, computeSemanticRepresentationId } from '../../src/semantic/semantic-representation-builder';

const organisationId = asOrganisationId('org-1');

function canonicalSubject(id = 'co-1', kind: CanonicalObjectKind = 'AGENT_VERSION'): SemanticRepresentationSubjectReference {
  return {
    subjectKind: 'CANONICAL_OBJECT',
    organisationId,
    canonicalObjectId: asCanonicalObjectId(id),
    canonicalObjectKind: kind,
  };
}

function candidateSubject(id = 'cand-1', kind: DiscoveryCandidateKind = 'AGENT_VERSION'): SemanticRepresentationSubjectReference {
  return {
    subjectKind: 'NORMALIZED_CANDIDATE',
    organisationId,
    candidateId: asNormalizedCandidateId(id),
    candidateKind: kind,
  };
}

const projectionInput = {
  subjectKind: 'CANONICAL_OBJECT' as const,
  objectKind: 'AGENT_VERSION',
  knownTechnicalFacts: [['runtimeFramework', 'LangGraph']] as ReadonlyArray<readonly [string, string]>,
};

// Isolated unit-test support; no durable rows or production provenance are fabricated.
const support = { assertionIds: [asSourceAssertionId('assertion-1')], evidenceIds: [] };
const generatedAt = '2026-09-09T00:00:00.000Z';

describe('buildSemanticRepresentation', () => {
  it('rejects empty support', async () => {
    await assert.rejects(buildSemanticRepresentation({
      subject: canonicalSubject(), projection: projectionInput,
      provider: new TestOnlyDeterministicEmbeddingProvider(4),
      support: { assertionIds: [], evidenceIds: [] }, generatedAt,
    }), /SEMANTIC_REPRESENTATION_SUPPORT_REQUIRED/);
  });

  it('rejects provider dimension mismatch', async () => {
    const provider = new TestOnlyDeterministicEmbeddingProvider(4);
    provider.embed = async () => ({ vector: [0.1, 0.2] });
    await assert.rejects(buildSemanticRepresentation({
      subject: canonicalSubject(), projection: projectionInput, provider, support, generatedAt,
    }), { name: 'SemanticRepresentationDimensionMismatchError' });
  });

  for (const field of ['algorithm', 'schemaVersion', 'value'] as const) {
    it(`binds representationId to fingerprint ${field}`, async () => {
      const rep = await buildSemanticRepresentation({
        subject: canonicalSubject(), projection: projectionInput,
        provider: new TestOnlyDeterministicEmbeddingProvider(4), support, generatedAt,
      });
      assert.equal(computeSemanticRepresentationId(rep), rep.representationId);
      const changed = createSemanticContentFingerprint({ ...rep.contentFingerprint, [field]: 'different' });
      assert.notEqual(computeSemanticRepresentationId({ ...rep, contentFingerprint: changed }), rep.representationId);
    });
  }

  it('provenance changes do not change representation identity or fingerprint', async () => {
    const input = { subject: canonicalSubject(), projection: projectionInput,
      provider: new TestOnlyDeterministicEmbeddingProvider(4), support, generatedAt };
    const a = await buildSemanticRepresentation(input);
    const b = await buildSemanticRepresentation({ ...input, support: {
      assertionIds: [], evidenceIds: [asEvidenceId('evidence-1')],
    } });
    assert.equal(a.representationId, b.representationId);
    assert.deepEqual(a.contentFingerprint, b.contentFingerprint);
    assert.notDeepEqual(a.support, b.support);
  });

  it('generatedAt changes do not change representation identity', async () => {
    const input = { subject: canonicalSubject(), projection: projectionInput,
      provider: new TestOnlyDeterministicEmbeddingProvider(4), support, generatedAt };
    const a = await buildSemanticRepresentation(input);
    const b = await buildSemanticRepresentation({ ...input, generatedAt: '2026-09-10T00:00:00.000Z' });
    assert.equal(a.representationId, b.representationId);
  });

  it('produces a frozen, dimension-matching SemanticRepresentation', async () => {
    const provider = new TestOnlyDeterministicEmbeddingProvider(6);
    const rep = await buildSemanticRepresentation({
      subject: canonicalSubject(),
      projection: projectionInput,
      provider,
      support,
      generatedAt,
    });
    assert.ok(Object.isFrozen(rep));
    assert.equal(rep.vector.length, 6);
    assert.equal(rep.organisationId, organisationId);
  });

  it('is idempotent: rebuilding from identical inputs reproduces the identical representationId', async () => {
    const provider = new TestOnlyDeterministicEmbeddingProvider(4);
    const a = await buildSemanticRepresentation({ subject: canonicalSubject(), projection: projectionInput, provider, support, generatedAt });
    const b = await buildSemanticRepresentation({ subject: canonicalSubject(), projection: projectionInput, provider, support, generatedAt });
    assert.equal(a.representationId, b.representationId);
  });

  it('a changed content fingerprint changes representationId', async () => {
    const provider = new TestOnlyDeterministicEmbeddingProvider(4);
    const a = await buildSemanticRepresentation({ subject: canonicalSubject(), projection: projectionInput, provider, support, generatedAt });
    const changedProjection = { ...projectionInput, knownTechnicalFacts: [['runtimeFramework', 'CrewAI']] as ReadonlyArray<readonly [string, string]> };
    const b = await buildSemanticRepresentation({ subject: canonicalSubject(), projection: changedProjection, provider, support, generatedAt });
    assert.notEqual(a.representationId, b.representationId);
  });

  it('a changed embedding model version changes representationId even with identical content', async () => {
    const providerV1 = new TestOnlyDeterministicEmbeddingProvider(4);
    const a = await buildSemanticRepresentation({ subject: canonicalSubject(), projection: projectionInput, provider: providerV1, support, generatedAt });

    class ProviderV2 extends TestOnlyDeterministicEmbeddingProvider {
      override readonly modelVersion = 'v2';
    }
    const b = await buildSemanticRepresentation({ subject: canonicalSubject(), projection: projectionInput, provider: new ProviderV2(4), support, generatedAt });
    assert.notEqual(a.representationId, b.representationId);
  });

  it('a changed declared dimension changes representationId', async () => {
    const a = await buildSemanticRepresentation({ subject: canonicalSubject(), projection: projectionInput, provider: new TestOnlyDeterministicEmbeddingProvider(4), support, generatedAt });
    const b = await buildSemanticRepresentation({ subject: canonicalSubject(), projection: projectionInput, provider: new TestOnlyDeterministicEmbeddingProvider(8), support, generatedAt });
    assert.notEqual(a.representationId, b.representationId);
  });

  it('a CANONICAL_OBJECT subject and a NORMALIZED_CANDIDATE subject with otherwise-identical inputs produce different representationIds', async () => {
    const provider = new TestOnlyDeterministicEmbeddingProvider(4);
    const canonicalRep = await buildSemanticRepresentation({ subject: canonicalSubject(), projection: projectionInput, provider, support, generatedAt });
    const candidateRep = await buildSemanticRepresentation({ subject: candidateSubject(), projection: projectionInput, provider, support, generatedAt });
    assert.notEqual(canonicalRep.representationId, candidateRep.representationId);
  });

  it('an unrelated organisationId change changes representationId (tenant isolation of identity)', async () => {
    const provider = new TestOnlyDeterministicEmbeddingProvider(4);
    const a = await buildSemanticRepresentation({ subject: canonicalSubject(), projection: projectionInput, provider, support, generatedAt });
    const otherOrgSubject: SemanticRepresentationSubjectReference = {
      subjectKind: 'CANONICAL_OBJECT',
      organisationId: asOrganisationId('org-2'),
      canonicalObjectId: asCanonicalObjectId('co-1'),
      canonicalObjectKind: 'AGENT_VERSION',
    };
    const b = await buildSemanticRepresentation({ subject: otherOrgSubject, projection: projectionInput, provider, support, generatedAt });
    assert.notEqual(a.representationId, b.representationId);
  });
});
