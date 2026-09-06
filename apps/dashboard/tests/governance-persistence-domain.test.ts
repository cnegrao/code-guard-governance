import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  asIsoTimestamp,
  createObjectReconciliationDecision,
  type ReconciliationAuthority,
} from "@council/canonical-contracts";

// lib/governance/persistence.ts reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// at module-load time, so it must be dynamically imported only after these
// are set — a static top-level import would be hoisted ahead of any
// same-file assignment (mirrors tests/auth-persistence-boundary.test.ts).
let actorFromColumns: typeof import("@/lib/governance/persistence").actorFromColumns;
let actorToColumns: typeof import("@/lib/governance/persistence").actorToColumns;
let canonicalStringify: typeof import("@/lib/governance/persistence").canonicalStringify;
let hashEnvelope: typeof import("@/lib/governance/persistence").hashEnvelope;
let rehydrateEnvelopeByFamily: typeof import("@/lib/governance/persistence").rehydrateEnvelopeByFamily;
let rehydrateMergeCandidatesDecision: typeof import("@/lib/governance/persistence").rehydrateMergeCandidatesDecision;
let sha256Hex: typeof import("@/lib/governance/persistence").sha256Hex;
let verifyEnvelopeIntegrity: typeof import("@/lib/governance/persistence").verifyEnvelopeIntegrity;

before(async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  const persistence = await import("@/lib/governance/persistence");
  ({
    actorFromColumns,
    actorToColumns,
    canonicalStringify,
    hashEnvelope,
    rehydrateEnvelopeByFamily,
    rehydrateMergeCandidatesDecision,
    sha256Hex,
    verifyEnvelopeIntegrity,
  } = persistence);
});

// ---------------------------------------------------------------------------
// canonicalStringify / hashEnvelope — determinism
// ---------------------------------------------------------------------------

test("canonicalStringify: key order does not affect the output", () => {
  const a = { z: 1, a: 2, m: { y: 1, x: 2 } };
  const b = { a: 2, z: 1, m: { x: 2, y: 1 } };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});

test("canonicalStringify: array element order is preserved (not sorted)", () => {
  const a = { list: [1, 2, 3] };
  const b = { list: [3, 2, 1] };
  assert.notEqual(canonicalStringify(a), canonicalStringify(b));
});

test("hashEnvelope: identical content (regardless of key order) hashes identically; different content hashes differently", () => {
  const decisionA = { decisionId: "d1", outcome: "REJECT", reasonCode: "x" } as any;
  const decisionAReordered = { reasonCode: "x", outcome: "REJECT", decisionId: "d1" } as any;
  const decisionB = { decisionId: "d1", outcome: "REJECT", reasonCode: "y" } as any;

  assert.equal(hashEnvelope(decisionA), hashEnvelope(decisionAReordered));
  assert.notEqual(hashEnvelope(decisionA), hashEnvelope(decisionB));
  assert.match(hashEnvelope(decisionA), /^[0-9a-f]{64}$/);
});

test("sha256Hex: matches a known SHA-256 vector", () => {
  assert.equal(
    sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".slice(0, 64)
  );
});

// ---------------------------------------------------------------------------
// actor mapping round trip
// ---------------------------------------------------------------------------

test("actorToColumns / actorFromColumns: HUMAN round-trips exactly", () => {
  const actor: ReconciliationAuthority = { authorityKind: "HUMAN", actorReference: "user:alice" };
  const columns = actorToColumns(actor);
  assert.deepEqual(columns, {
    actor_kind: "HUMAN",
    actor_reference: "user:alice",
    actor_rule_code: null,
    actor_rule_version: null,
  });
  assert.deepEqual(actorFromColumns(columns), actor);
});

test("actorToColumns / actorFromColumns: DETERMINISTIC_RULE round-trips exactly", () => {
  const actor: ReconciliationAuthority = {
    authorityKind: "DETERMINISTIC_RULE",
    ruleCode: "AUTO_PROPOSE",
    ruleVersion: "1.0",
  };
  const columns = actorToColumns(actor);
  assert.deepEqual(columns, {
    actor_kind: "DETERMINISTIC_RULE",
    actor_reference: null,
    actor_rule_code: "AUTO_PROPOSE",
    actor_rule_version: "1.0",
  });
  assert.deepEqual(actorFromColumns(columns), actor);
});

test("actorFromColumns: fails closed on a HUMAN row with a missing actor_reference (forged/corrupted row)", () => {
  assert.throws(
    () => actorFromColumns({ actor_kind: "HUMAN", actor_reference: null, actor_rule_code: null, actor_rule_version: null }),
    /actor_reference/
  );
});

test("actorFromColumns: fails closed on an unrecognized actor_kind", () => {
  assert.throws(
    () => actorFromColumns({ actor_kind: "SOMETHING_ELSE", actor_reference: null, actor_rule_code: null, actor_rule_version: null }),
    /Unrecognized stored actor_kind/
  );
});

// ---------------------------------------------------------------------------
// MERGE_CANDIDATES rehydration — the one family canonical-contracts does not
// itself export a public rehydrator for.
// ---------------------------------------------------------------------------

const ORG = "org:11111111-1111-1111-1111-111111111111";
const VALID_MERGE_ENVELOPE = {
  decisionId: "reconciliation-decision:merge-1",
  organisationId: ORG,
  outcome: "MERGE_CANDIDATES",
  candidateKind: "AGENT",
  authority: { authorityKind: "HUMAN", actorReference: "user:alice" },
  reasonCode: "duplicate-agents",
  assertionIds: ["assertion:1"],
  evidenceIds: ["evidence:1"],
  decidedAt: "2026-01-01T00:00:00.000Z",
  contributingCandidateIds: ["candidate:b", "candidate:a"],
  candidateMergeId: "candidate-merge:1",
};

test("rehydrateMergeCandidatesDecision: valid envelope round-trips with sorted, deduplicated contributingCandidateIds preserved as given (adapter does not silently reorder)", () => {
  const decision = rehydrateMergeCandidatesDecision(VALID_MERGE_ENVELOPE);
  assert.equal(decision.decisionId, VALID_MERGE_ENVELOPE.decisionId);
  assert.equal(decision.organisationId, ORG);
  assert.equal(decision.outcome, "MERGE_CANDIDATES");
  assert.equal(decision.candidateKind, "AGENT");
  assert.equal(decision.authority.authorityKind, "HUMAN");
  assert.deepEqual([...decision.contributingCandidateIds], ["candidate:b", "candidate:a"]);
  assert.equal(decision.candidateMergeId, "candidate-merge:1");
  assert.ok(Object.isFrozen(decision));
});

test("rehydrateMergeCandidatesDecision: fails closed on an unknown extra field", () => {
  assert.throws(
    () => rehydrateMergeCandidatesDecision({ ...VALID_MERGE_ENVELOPE, injected: "malicious" }),
    /cannot include field "injected"/
  );
});

test("rehydrateMergeCandidatesDecision: fails closed on a wrong outcome", () => {
  assert.throws(
    () => rehydrateMergeCandidatesDecision({ ...VALID_MERGE_ENVELOPE, outcome: "CREATE_NEW" }),
    /outcome must be "MERGE_CANDIDATES"/
  );
});

test("rehydrateMergeCandidatesDecision: fails closed on a non-canonical candidateKind", () => {
  assert.throws(
    () => rehydrateMergeCandidatesDecision({ ...VALID_MERGE_ENVELOPE, candidateKind: "RELATIONSHIP" }),
    /candidateKind must be a canonical object kind/
  );
});

test("rehydrateMergeCandidatesDecision: fails closed on DETERMINISTIC_RULE authority (machine authority forbidden for canonical reconciliation)", () => {
  assert.throws(
    () =>
      rehydrateMergeCandidatesDecision({
        ...VALID_MERGE_ENVELOPE,
        authority: { authorityKind: "DETERMINISTIC_RULE", ruleCode: "X", ruleVersion: "1" },
      }),
    /requires HUMAN authority/
  );
});

test("rehydrateMergeCandidatesDecision: fails closed on fewer than two contributing candidates", () => {
  assert.throws(
    () => rehydrateMergeCandidatesDecision({ ...VALID_MERGE_ENVELOPE, contributingCandidateIds: ["candidate:a"] }),
    /at least two contributing candidates/
  );
});

test("rehydrateMergeCandidatesDecision: fails closed on duplicate contributing candidates", () => {
  assert.throws(
    () =>
      rehydrateMergeCandidatesDecision({
        ...VALID_MERGE_ENVELOPE,
        contributingCandidateIds: ["candidate:a", "candidate:a"],
      }),
    /must be unique/
  );
});

test("rehydrateMergeCandidatesDecision: fails closed on a malformed (non-object) envelope", () => {
  assert.throws(() => rehydrateMergeCandidatesDecision("not-an-object"), /must be an object/);
  assert.throws(() => rehydrateMergeCandidatesDecision(null), /must be an object/);
});

// ---------------------------------------------------------------------------
// rehydrateEnvelopeByFamily dispatch + verifyEnvelopeIntegrity
// ---------------------------------------------------------------------------

test("rehydrateEnvelopeByFamily: OBJECT family dispatches to canonical-contracts' own rehydrator and round-trips a real decision", () => {
  const decision = createObjectReconciliationDecision({
    decisionId: "reconciliation-decision:obj-1",
    organisationId: ORG,
    outcome: "REJECT",
    candidateKind: "AGENT",
    authority: { authorityKind: "HUMAN", actorReference: "user:alice" },
    reasonCode: "not-eligible",
    assertionIds: ["assertion:1"],
    evidenceIds: ["evidence:1"],
    decidedAt: asIsoTimestamp("2026-01-01T00:00:00.000Z"),
    subject: { subjectKind: "CANDIDATE", candidateId: "candidate:agent-1", candidateKind: "AGENT" },
  } as any);

  const rehydrated = rehydrateEnvelopeByFamily("OBJECT", decision);
  assert.deepEqual(rehydrated, decision);
});

test("rehydrateEnvelopeByFamily: CANDIDATE_MERGE family dispatches to the local merge rehydrator", () => {
  const rehydrated = rehydrateEnvelopeByFamily("CANDIDATE_MERGE", VALID_MERGE_ENVELOPE);
  assert.equal(rehydrated.outcome, "MERGE_CANDIDATES");
});

test("verifyEnvelopeIntegrity: accepts a matching hash and rejects a tampered envelope", () => {
  const envelope = { a: 1, b: 2 };
  const validHash = hashEnvelope(envelope as any);
  assert.doesNotThrow(() => verifyEnvelopeIntegrity(envelope, validHash, "decision:1"));

  const tampered = { a: 1, b: 999 };
  assert.throws(
    () => verifyEnvelopeIntegrity(tampered, validHash, "decision:1"),
    /failed content-hash verification/
  );
});
