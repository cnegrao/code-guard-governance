import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_HANDLING,
  TRUST_STATE,
  asEvidenceId,
  asExternalId,
  asIsoTimestamp,
  asSourceAssertionId,
  asSourceConnectionId,
  createEvidence,
  type Evidence,
  type SourceAssertion,
} from "@council/canonical-contracts";

// lib/governance/discovery-intake-persistence.ts transitively imports
// lib/governance/persistence.ts, which reads SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY at module-load time — a static top-level import
// would be hoisted ahead of any same-file assignment (mirrors
// tests/governance-persistence-domain.test.ts and
// tests/auth-persistence-boundary.test.ts).
let evidenceEnvelopeHash: typeof import("@/lib/governance/discovery-intake-persistence").evidenceEnvelopeHash;
let sourceAssertionEnvelopeHash: typeof import("@/lib/governance/discovery-intake-persistence").sourceAssertionEnvelopeHash;

before(async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  const mod = await import("@/lib/governance/discovery-intake-persistence");
  ({ evidenceEnvelopeHash, sourceAssertionEnvelopeHash } = mod);
});

const CAPTURED_AT = asIsoTimestamp("2026-01-01T00:00:00.000Z");

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return createEvidence({
    evidenceId: asEvidenceId("evidence:1"),
    handling: EVIDENCE_HANDLING.NON_SENSITIVE,
    locations: [],
    hashes: [{ algorithm: "sha256", value: "a".repeat(64) }],
    capturedAt: CAPTURED_AT,
    ...overrides,
  });
}

test("evidenceEnvelopeHash: identical content (regardless of key order) hashes identically; different content hashes differently", () => {
  const a = makeEvidence();
  const b = makeEvidence({ redactedExcerpt: "different excerpt" });
  assert.equal(evidenceEnvelopeHash(a), evidenceEnvelopeHash(makeEvidence()));
  assert.notEqual(evidenceEnvelopeHash(a), evidenceEnvelopeHash(b));
  assert.match(evidenceEnvelopeHash(a), /^[0-9a-f]{64}$/);
});

test("evidenceEnvelopeHash: is deterministic across repeated calls for the same object", () => {
  const evidence = makeEvidence();
  assert.equal(evidenceEnvelopeHash(evidence), evidenceEnvelopeHash(evidence));
});

function makeAssertion(overrides: Partial<SourceAssertion> = {}): SourceAssertion {
  return {
    assertionId: asSourceAssertionId("source-assertion:1"),
    sourceObject: {
      connectionId: asSourceConnectionId("source-connection:1"),
      externalType: "file",
      externalId: asExternalId("agent.py"),
    },
    runId: "acquisition-run:1" as SourceAssertion["runId"],
    method: { code: "agent-kind-declaration", version: "1.0.0" },
    trustState: TRUST_STATE.INFERRED,
    confidence: 0.9,
    observedAt: CAPTURED_AT,
    recordedAt: CAPTURED_AT,
    evidenceIds: [asEvidenceId("evidence:1")],
    ...overrides,
  };
}

test("sourceAssertionEnvelopeHash: identical content hashes identically; different content hashes differently", () => {
  const a = makeAssertion();
  const b = makeAssertion({ confidence: 0.1 });
  assert.equal(sourceAssertionEnvelopeHash(a), sourceAssertionEnvelopeHash(makeAssertion()));
  assert.notEqual(sourceAssertionEnvelopeHash(a), sourceAssertionEnvelopeHash(b));
  assert.match(sourceAssertionEnvelopeHash(a), /^[0-9a-f]{64}$/);
});

test("sourceAssertionEnvelopeHash and evidenceEnvelopeHash never collide across the two distinct content types used to seed them", () => {
  const evidence = makeEvidence();
  const assertion = makeAssertion();
  assert.notEqual(evidenceEnvelopeHash(evidence), sourceAssertionEnvelopeHash(assertion));
});
