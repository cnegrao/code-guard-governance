import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, mock, test } from "node:test";
import { asOrganisationId, type NormalizedObjectCandidate } from "@council/canonical-contracts";
import { asReviewSubjectId, stableCandidateContent } from "@council/governance-review";

const org = asOrganisationId("11111111-1111-1111-1111-111111111111");
const foreign = asOrganisationId("22222222-2222-2222-2222-222222222222");
const scope = { connectionId: "repo", externalType: "file", externalId: "shared.py" };
const at = "2026-09-10T12:00:00.000Z";
function object(kind = "MODEL", revision = "a"): NormalizedObjectCandidate {
  return { candidateKind: kind, candidateId: kind === "AGENT_VERSION" ? `candidate:agent-version:${revision.repeat(32)}` : `candidate:${kind}:${revision}`,
    findingId: `finding:${kind}:${revision}`, sourceObject: scope, confidence: 1, requiresReconciliation: true,
    assertionIds: ["assertion:1"], evidenceIds: ["evidence:1"], proposedIdentity: kind === "AGENT_VERSION"
      ? { agent: { referenceKind: "SOURCE_OBJECT", candidateKind: "AGENT", sourceObject: scope } }
      : kind === "AGENT" ? { agentCode: "Owner" } : { modelReference: "model-x" } } as never;
}
type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let current: NormalizedObjectCandidate;
let persisted: Row[];
let reads: { table: string; filters: [string, unknown][] }[];
const subject = () => ({ reviewSubjectId: asReviewSubjectId("review:new"), organisationId: org, candidateKind: current.candidateKind,
  findingId: current.findingId, sourceObject: current.sourceObject, assertionIds: current.assertionIds,
  evidenceIds: current.evidenceIds, state: "CERTIFIED", detectedAt: at });
const db = {
  from(table: string) {
    const filters: [string, unknown][] = []; let limit = Infinity;
    reads.push({ table, filters });
    const result = () => tables[table].filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)).slice(0, limit);
    const query = { select: (_fields: string) => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      in: (key: string, values: readonly unknown[]) => { filters.push([key, values]); return query; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return query; }, limit: (n: number) => { limit = n; return query; },
      maybeSingle: async () => { const rows = result(); return { data: rows.length === 1 ? rows[0] : null, error: rows.length > 1 ? { message: "multiple rows" } : null }; },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(resolve),
    }; return query;
  },
  rpc() { throw new Error("No migration or canonical write may occur during legacy preflight"); },
};
mock.module("@/lib/governance/persistence", { namedExports: { privilegedDb: db, canonicalStringify: stableCandidateContent,
  sha256Hex: (value: string) => createHash("sha256").update(value).digest("hex"), governanceReviewPersistence: {
    getReviewSubject: async () => subject(), persistAuthorizedReconciliation: async (input: Row) => {
      persisted.push(input); return { replay: false, reconciliationDecisionId: input.decision.decisionId };
    },
  } } });
mock.module("@/lib/governance/reconciliation-input", { namedExports: { getReconciliationInputForReviewSubject: async () => ({
  status: "OBJECT_INPUT_AVAILABLE", reviewSubject: subject(), candidate: current,
  finding: { ...current, findingNature: "CANDIDATE", requiresReview: true, createsCanonicalObject: false, detectedAt: at },
}) } });
mock.module("@/lib/governance/decision-query", { namedExports: { findReconciliationDecisionIdForReviewSubject: async () => undefined, findMaterializationForDecision: async () => undefined } });
let legacy: typeof import("@/lib/governance/legacy-object-mapping");
let commands: typeof import("@/lib/governance/decision-commands");
let hash: typeof import("@/lib/governance/discovery-intake-persistence").normalizedCandidateEnvelopeHash;
before(async () => {
  legacy = await import("@/lib/governance/legacy-object-mapping");
  commands = await import("@/lib/governance/decision-commands");
  ({ normalizedCandidateEnvelopeHash: hash } = await import("@/lib/governance/discovery-intake-persistence"));
});
function reset(historical = object(), tenant = org) {
  current = structuredClone(historical); persisted = []; reads = [];
  tables = {
    canonical_object_source_mappings: [{ organisation_id: tenant, canonical_object_kind: historical.candidateKind, canonical_object_id: "canonical:old",
      created_by_decision_id: "decision:old", source_connection_id: scope.connectionId, source_external_type: scope.externalType, source_external_id: scope.externalId, valid_to: null }],
    reconciliation_decisions: [{ organisation_id: tenant, decision_id: "decision:old", family: "OBJECT", outcome: "CREATE_NEW",
      canonical_object_id: "canonical:old", canonical_object_kind: historical.candidateKind, subject_candidate_id: historical.candidateId }],
    discovery_candidates: [{ organisation_id: tenant, candidate_id: historical.candidateId, candidate_kind: historical.candidateKind, candidate_family: "OBJECT",
      source_connection_id: scope.connectionId, source_external_type: scope.externalType, source_external_id: scope.externalId,
      envelope: historical, envelope_hash: hash(historical) }],
    canonical_objects: [{ organisation_id: tenant, canonical_object_id: "canonical:old", kind: historical.candidateKind }],
  };
}
const input = { organisationId: org, actorUserId: "reviewer", sessionRole: "org_admin", reviewSubjectId: asReviewSubjectId("review:new"), reasonCode: "GOVERNED" };

test("legacy-only same semantic object with a new discovery row cannot authorize duplicate CREATE_NEW", async () => {
  reset(); current = { ...current, candidateId: "candidate:rescan" as never, findingId: "finding:rescan" as never };
  const result = await commands.submitReconciliationDecision({ ...input, requestedOutcome: "CREATE_NEW" });
  assert.equal(result.kind, "PERSISTENCE_CONFLICT"); assert.equal(persisted.length, 0);
  assert.equal(tables.canonical_objects.length, 1); assert.equal(tables.canonical_object_source_mappings.length, 1);
});
test("legacy AGENT mapping does not block same-source AGENT_VERSION object governance", async () => {
  reset(object("AGENT")); current = object("AGENT_VERSION");
  assert.equal((await commands.submitReconciliationDecision({ ...input, requestedOutcome: "CREATE_NEW" })).kind, "APPLIED");
  assert.equal(persisted[0].decision.canonicalObject.kind, "AGENT_VERSION");
});
test("legacy AgentVersion V1 cannot collapse a proven V2 and identical V1 cannot CREATE_NEW", async () => {
  reset(object("AGENT_VERSION"));
  assert.equal((await commands.submitReconciliationDecision({ ...input, requestedOutcome: "CREATE_NEW" })).kind, "PERSISTENCE_CONFLICT");
  current = object("AGENT_VERSION", "b");
  assert.equal((await commands.submitReconciliationDecision({ ...input, requestedOutcome: "CREATE_NEW" })).kind, "APPLIED");
  assert.equal(persisted.length, 1); assert.equal("versionCode" in current.proposedIdentity, false);
});
test("same-kind different normalized Model identity remains independent", async () => {
  reset(); current = { ...object("MODEL", "b"), proposedIdentity: { modelReference: "model-y" } } as never;
  assert.equal((await commands.submitReconciliationDecision({ ...input, requestedOutcome: "CREATE_NEW" })).kind, "APPLIED");
});
for (const fault of ["missing-decision", "missing-candidate", "missing-discriminator", "multiple-mappings", "wrong-tenant-candidate", "wrong-kind-object", "wrong-source-candidate", "substituted-envelope"]) {
  test(`ambiguous same-kind legacy history (${fault}) fails closed without guessing`, async () => {
    reset(object("AGENT_VERSION"));
    if (fault === "missing-decision") tables.reconciliation_decisions = [];
    if (fault === "missing-candidate") tables.discovery_candidates = [];
    if (fault === "missing-discriminator") {
      const row = tables.discovery_candidates[0]; row.candidate_id = row.envelope.candidateId = "row:legacy";
      row.envelope_hash = hash(row.envelope); tables.reconciliation_decisions[0].subject_candidate_id = "row:legacy";
    }
    if (fault === "multiple-mappings") tables.canonical_object_source_mappings.push({ ...tables.canonical_object_source_mappings[0], canonical_object_id: "canonical:another" });
    if (fault === "wrong-tenant-candidate") tables.discovery_candidates[0].organisation_id = foreign;
    if (fault === "wrong-kind-object") tables.canonical_objects[0].kind = "AGENT";
    if (fault === "wrong-source-candidate") tables.discovery_candidates[0].source_external_id = "other.py";
    if (fault === "substituted-envelope") tables.discovery_candidates[0].envelope = object("AGENT_VERSION", "b");
    const result = await commands.submitReconciliationDecision({ ...input, requestedOutcome: "CREATE_NEW" });
    assert.equal(result.kind, "PERSISTENCE_CONFLICT"); assert.equal(persisted.length, 0);
    await assert.rejects(() => legacy.assertLegacyObjectCompatibility(org, current, "MATCH_EXISTING", "canonical:old"), legacy.LegacyObjectMappingConflict);
  });
}
test("exact historical reconstruction is tenant scoped, deterministic and read-only on replay", async () => {
  reset(); const snapshot = structuredClone(tables);
  for (let i = 0; i < 2; i++) await legacy.assertLegacyObjectCompatibility(org, current, "MATCH_EXISTING", "canonical:old");
  assert.deepEqual(tables, snapshot);
  assert.ok(reads.every(call => call.filters.some(([key, value]) => key === "organisation_id" && value === org)));
  await assert.rejects(() => legacy.assertLegacyObjectCompatibility(org, current, "MATCH_EXISTING", "canonical:wrong"), legacy.LegacyObjectMappingConflict);
  reset(object(), foreign);
  assert.equal((await commands.submitReconciliationDecision({ ...input, requestedOutcome: "CREATE_NEW" })).kind, "APPLIED");
});
test("governed MATCH_EXISTING selects the historical object without creating another object", async () => {
  reset();
  const result = await commands.submitReconciliationDecision({ ...input, requestedOutcome: "MATCH_EXISTING", matchCanonicalObjectId: "canonical:old" });
  assert.equal(result.kind, "APPLIED"); assert.equal(persisted[0].decision.canonicalObject.objectId, "canonical:old");
  assert.equal(tables.canonical_objects.length, 1);
});
