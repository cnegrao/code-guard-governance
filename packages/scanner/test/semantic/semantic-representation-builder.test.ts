import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  asCanonicalObjectId,
  asNormalizedCandidateId,
  asOrganisationId,
  type CanonicalObjectKind,
  type DiscoveryCandidateKind,
  type SemanticRepresentationSubjectReference,
} from '@council/canonical-contracts';

import { TestOnlyDeterministicEmbeddingProvider } from '../../src/semantic/embedding-provider';
import { buildSemanticRepresentation } from '../../src/semantic/semantic-representation-builder';

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

const support = { assertionIds: [], evidenceIds: [] };
const generatedAt = '2026-09-09T00:00:00.000Z';

describe('buildSemanticRepresentation', () => {
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
