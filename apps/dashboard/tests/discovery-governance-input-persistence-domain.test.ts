import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  asDiscoveryFindingId,
  asEvidenceId,
  asExternalId,
  asIsoTimestamp,
  asNormalizedCandidateId,
  asSourceAssertionId,
  asSourceConnectionId,
  FINDING_REVIEW_STATUS,
  type DiscoveryFinding,
  type NormalizedObjectCandidate,
  type NormalizedRelationshipCandidate,
} from "@council/canonical-contracts";

// lib/governance/discovery-intake-persistence.ts transitively imports
// lib/governance/persistence.ts, which reads SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY at module-load time (mirrors
// tests/discovery-intake-persistence-domain.test.ts).
let discoveryFindingEnvelopeHash: typeof import("@/lib/governance/discovery-intake-persistence").discoveryFindingEnvelopeHash;
let normalizedCandidateEnvelopeHash: typeof import("@/lib/governance/discovery-intake-persistence").normalizedCandidateEnvelopeHash;
let rehydrateDiscoveryFinding: typeof import("@/lib/governance/discovery-intake-persistence").rehydrateDiscoveryFinding;
let rehydrateNormalizedCandidate: typeof import("@/lib/governance/discovery-intake-persistence").rehydrateNormalizedCandidate;

before(async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  const mod = await import("@/lib/governance/discovery-intake-persistence");
  ({ discoveryFindingEnvelopeHash, normalizedCandidateEnvelopeHash, rehydrateDiscoveryFinding, rehydrateNormalizedCandidate } = mod);
});

const DETECTED_AT = asIsoTimestamp("2026-01-01T00:00:00.000Z");

function makeFinding(overrides: Partial<DiscoveryFinding> = {}): DiscoveryFinding {
  return {
    findingId: asDiscoveryFindingId("discovery-finding:agent:1"),
    findingNature: "CANDIDATE",
    candidateKind: "AGENT",
    sourceObject: {
      connectionId: asSourceConnectionId("connection:1"),
      externalType: "file",
      externalId: asExternalId("agent.py"),
    },
    assertionIds: [asSourceAssertionId("assertion:1")],
    evidenceIds: [asEvidenceId("evidence:1")],
    confidence: 0.9,
    reviewStatus: FINDING_REVIEW_STATUS.UNREVIEWED,
    requiresReview: true,
    createsCanonicalObject: false,
    detectedAt: DETECTED_AT,
    ...overrides,
  } as DiscoveryFinding;
}

function makeRelationshipCandidate(
  overrides: Partial<NormalizedRelationshipCandidate> = {},
): NormalizedRelationshipCandidate {
  return {
    candidateId: asNormalizedCandidateId("candidate:relationship:1"),
    candidateKind: "RELATIONSHIP",
    sourceObject: {
      connectionId: asSourceConnectionId("connection:1"),
      externalType: "file",
      externalId: asExternalId("agent.py"),
    },
    findingId: asDiscoveryFindingId("discovery-finding:relationship:1"),
    assertionIds: [asSourceAssertionId("assertion:1")],
    evidenceIds: [asEvidenceId("evidence:1")],
    confidence: 0.9,
    requiresReconciliation: true,
    relationshipTypeCode: "USES_MODEL",
    sourceEndpoint: {
      referenceKind: "SOURCE_OBJECT",
      sourceObject: {
        connectionId: asSourceConnectionId("connection:1"),
        externalType: "file",
        externalId: asExternalId("agent.py"),
      },
      candidateKind: "AGENT",
    },
    targetEndpoint: {
      referenceKind: "SOURCE_OBJECT",
      sourceObject: {
        connectionId: asSourceConnectionId("connection:1"),
        externalType: "file",
        externalId: asExternalId("model.py"),
      },
      candidateKind: "MODEL",
    },
    ...overrides,
  } as NormalizedRelationshipCandidate;
}

function makeObjectCandidate(overrides: Partial<NormalizedObjectCandidate> = {}): NormalizedObjectCandidate {
  return {
    candidateId: asNormalizedCandidateId("candidate:agent:1"),
    candidateKind: "AGENT",
    sourceObject: {
      connectionId: asSourceConnectionId("connection:1"),
      externalType: "file",
      externalId: asExternalId("agent.py"),
    },
    findingId: asDiscoveryFindingId("discovery-finding:agent:1"),
    assertionIds: [asSourceAssertionId("assertion:1")],
    evidenceIds: [asEvidenceId("evidence:1")],
    confidence: 0.9,
    requiresReconciliation: true,
    proposedIdentity: { agentCode: "MY_AGENT", displayName: "My Agent" },
    ...overrides,
  } as NormalizedObjectCandidate;
}

// ---------------------------------------------------------------------------
// HASH
// ---------------------------------------------------------------------------

test("discoveryFindingEnvelopeHash: identical content hashes identically; different content hashes differently", () => {
  const a = makeFinding();
  const b = makeFinding({ confidence: 0.1 });
  assert.equal(discoveryFindingEnvelopeHash(a), discoveryFindingEnvelopeHash(makeFinding()));
  assert.notEqual(discoveryFindingEnvelopeHash(a), discoveryFindingEnvelopeHash(b));
  assert.match(discoveryFindingEnvelopeHash(a), /^[0-9a-f]{64}$/);
});

test("normalizedCandidateEnvelopeHash: identical content hashes identically; different content hashes differently, across both OBJECT and RELATIONSHIP families", () => {
  const rel = makeRelationshipCandidate();
  const relChanged = makeRelationshipCandidate({ relationshipTypeCode: "USES_TOOL" });
  assert.equal(normalizedCandidateEnvelopeHash(rel), normalizedCandidateEnvelopeHash(makeRelationshipCandidate()));
  assert.notEqual(normalizedCandidateEnvelopeHash(rel), normalizedCandidateEnvelopeHash(relChanged));

  const obj = makeObjectCandidate();
  const objChanged = makeObjectCandidate({ proposedIdentity: { agentCode: "OTHER_AGENT" } });
  assert.equal(normalizedCandidateEnvelopeHash(obj), normalizedCandidateEnvelopeHash(makeObjectCandidate()));
  assert.notEqual(normalizedCandidateEnvelopeHash(obj), normalizedCandidateEnvelopeHash(objChanged));
});

// ---------------------------------------------------------------------------
// REHYDRATION: exact round-trip
// ---------------------------------------------------------------------------

test("rehydrateDiscoveryFinding: exact round-trip through JSON (as it would come back from jsonb) for an AGENT finding", () => {
  const finding = makeFinding();
  const roundTripped = rehydrateDiscoveryFinding(JSON.parse(JSON.stringify(finding)));
  assert.deepEqual(roundTripped, finding);
});

test("rehydrateDiscoveryFinding: exact round-trip for a RELATIONSHIP finding", () => {
  const finding = makeFinding({
    findingId: asDiscoveryFindingId("discovery-finding:relationship:1"),
    candidateKind: "RELATIONSHIP",
  });
  const roundTripped = rehydrateDiscoveryFinding(JSON.parse(JSON.stringify(finding)));
  assert.deepEqual(roundTripped, finding);
});

test("rehydrateDiscoveryFinding: proposedIdentity/confidence/reviewStatus/source identity all survive exactly", () => {
  const finding = makeFinding({ confidence: 0.42, reviewStatus: FINDING_REVIEW_STATUS.ACCEPTED });
  const roundTripped = rehydrateDiscoveryFinding(JSON.parse(JSON.stringify(finding)));
  assert.equal(roundTripped.confidence, 0.42);
  assert.equal(roundTripped.reviewStatus, "ACCEPTED");
  assert.deepEqual(roundTripped.sourceObject, finding.sourceObject);
  assert.deepEqual([...roundTripped.assertionIds], [...finding.assertionIds]);
  assert.deepEqual([...roundTripped.evidenceIds], [...finding.evidenceIds]);
});

test("rehydrateDiscoveryFinding: rejects an unknown field (fail closed, never silently ignore tampering)", () => {
  const finding = JSON.parse(JSON.stringify(makeFinding())) as Record<string, unknown>;
  finding.injected = "malicious";
  assert.throws(() => rehydrateDiscoveryFinding(finding), /cannot include field "injected"/);
});

test("rehydrateDiscoveryFinding: rejects requiresReview=false / createsCanonicalObject=true (the machine authority ceiling this schema encodes)", () => {
  const findingA = JSON.parse(JSON.stringify(makeFinding())) as Record<string, unknown>;
  findingA.requiresReview = false;
  assert.throws(() => rehydrateDiscoveryFinding(findingA), /requiresReview must be true/);

  const findingB = JSON.parse(JSON.stringify(makeFinding())) as Record<string, unknown>;
  findingB.createsCanonicalObject = true;
  assert.throws(() => rehydrateDiscoveryFinding(findingB), /createsCanonicalObject must be false/);
});

test("rehydrateNormalizedCandidate: exact round-trip for a RELATIONSHIP candidate — endpoints and direction survive exactly", () => {
  const candidate = makeRelationshipCandidate();
  const roundTripped = rehydrateNormalizedCandidate(JSON.parse(JSON.stringify(candidate)));
  assert.deepEqual(roundTripped, candidate);
});

test("rehydrateNormalizedCandidate: exact round-trip for an OBJECT candidate — proposedIdentity survives exactly", () => {
  const candidate = makeObjectCandidate();
  const roundTripped = rehydrateNormalizedCandidate(JSON.parse(JSON.stringify(candidate)));
  assert.deepEqual(roundTripped, candidate);
});

test("rehydrateNormalizedCandidate: DATA_ELEMENT requires parentDataAsset + elementPath in proposedIdentity", () => {
  const candidate = makeObjectCandidate({
    candidateKind: "DATA_ELEMENT",
    proposedIdentity: {
      parentDataAsset: { referenceKind: "SOURCE_OBJECT", sourceObject: makeFinding().sourceObject, candidateKind: "DATA_ASSET" },
      elementPath: "$.field",
    },
  } as never);
  const roundTripped = rehydrateNormalizedCandidate(JSON.parse(JSON.stringify(candidate)));
  assert.deepEqual(roundTripped, candidate);

  const missingElementPath = JSON.parse(JSON.stringify(candidate)) as Record<string, unknown>;
  delete (missingElementPath.proposedIdentity as Record<string, unknown>).elementPath;
  assert.throws(() => rehydrateNormalizedCandidate(missingElementPath), /elementPath is required/);
});

test("rehydrateNormalizedCandidate: rejects an unknown field (fail closed)", () => {
  const candidate = JSON.parse(JSON.stringify(makeRelationshipCandidate())) as Record<string, unknown>;
  candidate.injected = "malicious";
  assert.throws(() => rehydrateNormalizedCandidate(candidate), /cannot include field "injected"/);
});

test("rehydrateNormalizedCandidate: rejects an OBJECT candidate carrying relationship-only fields, and vice versa", () => {
  const objectWithRelFields = JSON.parse(JSON.stringify(makeObjectCandidate())) as Record<string, unknown>;
  objectWithRelFields.relationshipTypeCode = "USES_MODEL";
  assert.throws(() => rehydrateNormalizedCandidate(objectWithRelFields), /cannot include field "relationshipTypeCode"/);

  const relWithProposedIdentity = JSON.parse(JSON.stringify(makeRelationshipCandidate())) as Record<string, unknown>;
  relWithProposedIdentity.proposedIdentity = { displayName: "x" };
  assert.throws(() => rehydrateNormalizedCandidate(relWithProposedIdentity), /cannot include field "proposedIdentity"/);
});

test("rehydrateNormalizedCandidate: rejects requiresReconciliation=false", () => {
  const candidate = JSON.parse(JSON.stringify(makeRelationshipCandidate())) as Record<string, unknown>;
  candidate.requiresReconciliation = false;
  assert.throws(() => rehydrateNormalizedCandidate(candidate), /requiresReconciliation must be true/);
});

// ---------------------------------------------------------------------------
// INTEGRITY: tampered envelope fails closed (recompute-and-compare, the same
// discipline as persistence.ts's verifyEnvelopeIntegrity for reconciliation
// decisions).
// ---------------------------------------------------------------------------

test("INTEGRITY: a hash recomputed over a tampered envelope no longer matches the originally stored hash", () => {
  const finding = makeFinding();
  const storedHash = discoveryFindingEnvelopeHash(finding);
  const tampered = { ...finding, confidence: 0.01 };
  const recomputed = discoveryFindingEnvelopeHash(tampered);
  assert.notEqual(recomputed, storedHash, "a tampered envelope must never recompute to the originally stored hash");
});

test("INTEGRITY: candidate/finding kind mismatch is rejected by rehydration's own candidateKind enumeration, not merely accepted as a valid CanonicalObjectKind", () => {
  const candidate = JSON.parse(JSON.stringify(makeRelationshipCandidate())) as Record<string, unknown>;
  candidate.candidateKind = "NOT_A_REAL_KIND";
  assert.throws(() => rehydrateNormalizedCandidate(candidate), /must be a known DiscoveryCandidateKind/);
});
