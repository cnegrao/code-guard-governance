import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  asCanonicalObjectId,
  asEvidenceId,
  asNormalizedCandidateId,
  asOrganisationId,
  asSourceAssertionId,
  type EmbeddingProviderMetadata,
  type SemanticRepresentationSubjectReference,
} from "@council/canonical-contracts";

import type {
  SemanticRepresentationPersistencePort,
  SemanticRepresentationRecordInput,
  SemanticRepresentationRecordResult,
} from "../src/semantic-representation-port.ts";

/**
 * In-memory reference implementation, exactly mirroring the documented
 * contract on SemanticRepresentationPersistencePort: idempotent on
 * representationId, no governance gate, no canonical mutation of any kind.
 * Used here only to prove the port's shape is implementable and its
 * documented replay semantics are exercisable — the real adapter lives in
 * apps/dashboard and talks to Supabase, never tested here.
 */
class InMemorySemanticRepresentationPersistence implements SemanticRepresentationPersistencePort {
  private readonly rows = new Map<string, SemanticRepresentationRecordInput>();

  async recordSemanticRepresentation(
    input: SemanticRepresentationRecordInput,
  ): Promise<SemanticRepresentationRecordResult> {
    const key = `${input.organisationId}:${input.representationId}`;
    const existing = this.rows.get(key);
    if (existing) {
      const replay = JSON.stringify(existing) === JSON.stringify(input);
      if (!replay) {
        throw new Error("SEMANTIC_REPRESENTATION_IDEMPOTENCY_CONFLICT");
      }
      return { replay: true, representationId: input.representationId };
    }
    this.rows.set(key, input);
    return { replay: false, representationId: input.representationId };
  }

  size(): number {
    return this.rows.size;
  }
}

const organisationId = asOrganisationId("org-1");

function embeddingProvider(dimension = 3): EmbeddingProviderMetadata {
  return { providerId: "TEST_ONLY_DETERMINISTIC", modelId: "test-only-hash-embedding", modelVersion: "v1", dimension };
}

function canonicalObjectSubject(): SemanticRepresentationSubjectReference {
  return {
    subjectKind: "CANONICAL_OBJECT",
    organisationId,
    canonicalObjectId: asCanonicalObjectId("co-1"),
    canonicalObjectKind: "AGENT_VERSION",
  };
}

function recordInput(overrides: Partial<SemanticRepresentationRecordInput> = {}): SemanticRepresentationRecordInput {
  return {
    organisationId,
    representationId: "rep-1",
    subject: canonicalObjectSubject(),
    projectionSchemaVersion: "GOVIA_SEMANTIC_CONTENT_V1",
    contentFingerprintAlgorithm: "sha256",
    contentFingerprintSchemaVersion: "GOVIA_SEMANTIC_CONTENT_V1",
    contentFingerprintValue: "deadbeef",
    embeddingProvider: embeddingProvider(),
    vector: [0.1, 0.2, 0.3],
    support: { assertionIds: [asSourceAssertionId("assertion-1")], evidenceIds: [asEvidenceId("evidence-1")] },
    generatedAt: "2026-09-09T00:00:00.000Z",
    ...overrides,
  };
}

describe("SemanticRepresentationPersistencePort (reference implementation)", () => {
  it("first call is not a replay and durably stores exactly one row", async () => {
    const port = new InMemorySemanticRepresentationPersistence();
    const result = await port.recordSemanticRepresentation(recordInput());
    assert.equal(result.replay, false);
    assert.equal(port.size(), 1);
  });

  it("a reused representationId with identical content replays without adding a row", async () => {
    const port = new InMemorySemanticRepresentationPersistence();
    await port.recordSemanticRepresentation(recordInput());
    const replay = await port.recordSemanticRepresentation(recordInput());
    assert.equal(replay.replay, true);
    assert.equal(port.size(), 1);
  });

  it("a reused representationId with different content fails closed instead of silently overwriting", async () => {
    const port = new InMemorySemanticRepresentationPersistence();
    await port.recordSemanticRepresentation(recordInput());
    await assert.rejects(
      () => port.recordSemanticRepresentation(recordInput({ contentFingerprintValue: "different-value" })),
      /SEMANTIC_REPRESENTATION_IDEMPOTENCY_CONFLICT/,
    );
  });

  it("a NORMALIZED_CANDIDATE subject is a distinct, independently storable row", async () => {
    const port = new InMemorySemanticRepresentationPersistence();
    await port.recordSemanticRepresentation(recordInput());
    const candidateSubject: SemanticRepresentationSubjectReference = {
      subjectKind: "NORMALIZED_CANDIDATE",
      organisationId,
      candidateId: asNormalizedCandidateId("cand-1"),
      candidateKind: "AGENT_VERSION",
    };
    await port.recordSemanticRepresentation(
      recordInput({ representationId: "rep-2", subject: candidateSubject }),
    );
    assert.equal(port.size(), 2);
  });
});
