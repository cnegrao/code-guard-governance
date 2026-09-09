import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as contracts from "../src/index.ts";

const orgA = contracts.asOrganisationId("org-a");
const orgB = contracts.asOrganisationId("org-b");

function canonicalObjectSubject(organisationId, id = "co-1", kind = "AGENT_VERSION") {
  return {
    subjectKind: "CANONICAL_OBJECT",
    organisationId,
    canonicalObjectId: contracts.asCanonicalObjectId(id),
    canonicalObjectKind: kind,
  };
}

function candidateSubject(organisationId, id = "cand-1", kind = "AGENT_VERSION") {
  return {
    subjectKind: "NORMALIZED_CANDIDATE",
    organisationId,
    candidateId: contracts.asNormalizedCandidateId(id),
    candidateKind: kind,
  };
}

function fingerprint(value = "abc123") {
  return contracts.createSemanticContentFingerprint({
    algorithm: "sha256",
    schemaVersion: "GOVIA_SEMANTIC_CONTENT_V1",
    value,
  });
}

function provider(dimension = 4) {
  return { providerId: "TEST_ONLY_DETERMINISTIC", modelId: "test-only-hash-embedding", modelVersion: "v1", dimension };
}

function representationDraft(overrides = {}) {
  const subject = overrides.subject ?? canonicalObjectSubject(orgA);
  return {
    representationId: contracts.asSemanticRepresentationId("rep-1"),
    organisationId: subject.organisationId,
    subject,
    projectionSchemaVersion: "GOVIA_SEMANTIC_CONTENT_V1",
    contentFingerprint: fingerprint(),
    embeddingProvider: provider(4),
    vector: [0.1, 0.2, 0.3, 0.4],
    support: { assertionIds: [], evidenceIds: [] },
    generatedAt: "2026-09-09T00:00:00.000Z",
    ...overrides,
  };
}

describe("SemanticRepresentation subject model", () => {
  it("CANONICAL_OBJECT and NORMALIZED_CANDIDATE subjects are structurally distinct", () => {
    const canonical = canonicalObjectSubject(orgA);
    const candidate = candidateSubject(orgA);
    assert.equal(canonical.subjectKind, "CANONICAL_OBJECT");
    assert.equal(candidate.subjectKind, "NORMALIZED_CANDIDATE");
    assert.notEqual(
      contracts.semanticRepresentationSubjectKey(canonical),
      contracts.semanticRepresentationSubjectKey(candidate),
    );
  });

  it("subject keys differ across tenants for the same otherwise-identical subject fields", () => {
    const keyA = contracts.semanticRepresentationSubjectKey(canonicalObjectSubject(orgA));
    const keyB = contracts.semanticRepresentationSubjectKey(canonicalObjectSubject(orgB));
    assert.notEqual(keyA, keyB);
  });

  it("subject keys are stable for identical inputs", () => {
    const keyA = contracts.semanticRepresentationSubjectKey(canonicalObjectSubject(orgA, "co-1", "AGENT_VERSION"));
    const keyB = contracts.semanticRepresentationSubjectKey(canonicalObjectSubject(orgA, "co-1", "AGENT_VERSION"));
    assert.equal(keyA, keyB);
  });
});

describe("SemanticContentFingerprint", () => {
  it("rejects an empty algorithm/schemaVersion/value", () => {
    assert.throws(() => contracts.createSemanticContentFingerprint({ algorithm: "", schemaVersion: "v1", value: "x" }));
    assert.throws(() => contracts.createSemanticContentFingerprint({ algorithm: "sha256", schemaVersion: "", value: "x" }));
    assert.throws(() => contracts.createSemanticContentFingerprint({ algorithm: "sha256", schemaVersion: "v1", value: "" }));
  });

  it("freezes a valid fingerprint", () => {
    const fp = fingerprint("deadbeef");
    assert.ok(Object.isFrozen(fp));
    assert.equal(fp.value, "deadbeef");
  });
});

describe("createSemanticRepresentation", () => {
  it("builds and freezes a valid representation", () => {
    const rep = contracts.createSemanticRepresentation(representationDraft());
    assert.ok(Object.isFrozen(rep));
    assert.ok(Object.isFrozen(rep.vector));
    assert.ok(Object.isFrozen(rep.embeddingProvider));
    assert.ok(Object.isFrozen(rep.support));
    assert.equal(rep.vector.length, 4);
  });

  it("fails closed on a dimension mismatch instead of truncating or padding", () => {
    assert.throws(
      () => contracts.createSemanticRepresentation(representationDraft({ vector: [0.1, 0.2] })),
      contracts.SemanticRepresentationDimensionMismatchError,
    );
  });

  it("rejects a non-positive or non-integer declared dimension", () => {
    assert.throws(() =>
      contracts.createSemanticRepresentation(
        representationDraft({ embeddingProvider: provider(0), vector: [] }),
      ),
    );
    assert.throws(() =>
      contracts.createSemanticRepresentation(
        representationDraft({ embeddingProvider: provider(1.5), vector: [0.1] }),
      ),
    );
  });

  it("rejects a non-finite vector component", () => {
    assert.throws(() =>
      contracts.createSemanticRepresentation(representationDraft({ vector: [0.1, Number.NaN, 0.3, 0.4] })),
    );
    assert.throws(() =>
      contracts.createSemanticRepresentation(representationDraft({ vector: [0.1, Infinity, 0.3, 0.4] })),
    );
  });

  it("rejects a representation whose organisationId does not match its subject's organisationId", () => {
    const subject = canonicalObjectSubject(orgA);
    assert.throws(() =>
      contracts.createSemanticRepresentation(representationDraft({ subject, organisationId: orgB })),
    );
  });

  it("rejects an empty projectionSchemaVersion", () => {
    assert.throws(() => contracts.createSemanticRepresentation(representationDraft({ projectionSchemaVersion: "" })));
  });

  it("accepts either subject family without conflating them", () => {
    const canonicalRep = contracts.createSemanticRepresentation(representationDraft({ subject: canonicalObjectSubject(orgA) }));
    const candidateRep = contracts.createSemanticRepresentation(representationDraft({ subject: candidateSubject(orgA) }));
    assert.equal(canonicalRep.subject.subjectKind, "CANONICAL_OBJECT");
    assert.equal(candidateRep.subject.subjectKind, "NORMALIZED_CANDIDATE");
  });
});
