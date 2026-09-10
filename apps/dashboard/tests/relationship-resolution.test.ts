import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, test, mock } from "node:test";
import { asOrganisationId, asIsoTimestamp, type NormalizedRelationshipCandidate } from "@council/canonical-contracts";
import { canonicalRelationshipId, EndpointResolutionError, asReviewSubjectId, stableCandidateContent } from "@council/governance-review";

const org = asOrganisationId("11111111-1111-1111-1111-111111111111");
const foreign = asOrganisationId("22222222-2222-2222-2222-222222222222");
const at = asIsoTimestamp("2026-09-09T12:00:00.000Z");
const source = { referenceKind: "CANDIDATE", candidateKind: "AGENT_VERSION", candidateId: `candidate:agent-version:${"a".repeat(32)}` } as const;
const target = { referenceKind: "CANDIDATE", candidateKind: "TOOL", candidateId: "candidate:tool" } as const;
const candidate: NormalizedRelationshipCandidate = { candidateId: "candidate:relationship" as never, candidateKind: "RELATIONSHIP", findingId: "finding:relationship" as never,
  sourceObject: { connectionId: "connection" as never, externalType: "file", externalId: "agent.py" as never }, sourceEndpoint: source as never, targetEndpoint: target as never,
  relationshipTypeCode: "USES_TOOL", assertionIds: ["assertion:1" as never], evidenceIds: ["evidence:1" as never], confidence: 1, requiresReconciliation: true };
type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let endpoints: Record<string, Row[]>;
let readCalls: { table: string; filters: [string, unknown][] }[];
let existingDecisionId: string | undefined;
let chain: any;
let persisted: any[];
const subject = { reviewSubjectId: asReviewSubjectId("review:relationship"), organisationId: org, candidateKind: "RELATIONSHIP", findingId: candidate.findingId,
  sourceObject: candidate.sourceObject, assertionIds: candidate.assertionIds, evidenceIds: candidate.evidenceIds, state: "CERTIFIED", detectedAt: at };
const finding = { ...candidate, detectedAt: at, requiresReview: true, createsCanonicalObject: false };
const db = {
  from(table: string) {
    const filters: [string, unknown][] = []; let limit = Infinity;
    readCalls.push({ table, filters });
    const result = () => {
      assert.ok(table in tables, `unexpected read table ${table}`);
      return tables[table].filter(row => filters.every(([key, value]) => row[key] === value)).slice(0, limit);
    };
    const query = { select: (_fields: string) => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return query; }, limit: (n: number) => { limit = n; return query; },
      maybeSingle: async () => { const rows = result(); assert.ok(rows.length <= 1); return { data: rows[0], error: null }; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(resolve),
    };
    return query;
  },
  async rpc(name: string, args: Row) {
    assert.equal(name, "resolve_canonical_endpoint", "resolution cannot invoke materialization");
    const data = args.p_organisation_id === org ? endpoints[args.p_reference.candidateId] ?? [] : [];
    return { data, error: data.length ? null : { message: "ENDPOINT_NOT_CANONICAL" } };
  },
};
mock.module("@/lib/governance/persistence", { namedExports: { privilegedDb: db, canonicalStringify: stableCandidateContent,
  sha256Hex: (value: string) => createHash("sha256").update(value).digest("hex"), governanceReviewPersistence: {
  getReviewSubject: async (tenant: string) => tenant === org ? subject : undefined,
  getReconciliationAuditChain: async () => chain,
  persistAuthorizedReconciliation: async (input: any) => { persisted.push(input); return { replay: false, reconciliationDecisionId: input.decision.decisionId }; },
} } });
mock.module("@/lib/governance/reconciliation-input", { namedExports: { getReconciliationInputForReviewSubject: async () => ({ status: "RELATIONSHIP_INPUT_AVAILABLE", reviewSubject: subject, finding, candidate }) } });
mock.module("@/lib/governance/decision-query", { namedExports: { findReconciliationDecisionIdForReviewSubject: async () => existingDecisionId, findMaterializationForDecision: async () => undefined } });
mock.module("@/lib/governance/materialization", { namedExports: { materializationPersistence: {} } });
let service: typeof import("@/lib/governance/relationship-resolution");
let commands: typeof import("@/lib/governance/decision-commands");
let hash: typeof import("@/lib/governance/discovery-intake-persistence").normalizedCandidateEnvelopeHash;
before(async () => {
  service = await import("@/lib/governance/relationship-resolution");
  commands = await import("@/lib/governance/decision-commands");
  ({ normalizedCandidateEnvelopeHash: hash } = await import("@/lib/governance/discovery-intake-persistence"));
});
function reset() {
  tables = {
    discovery_candidates: [{ organisation_id: org, candidate_id: candidate.candidateId, candidate_kind: "RELATIONSHIP", envelope: candidate, envelope_hash: hash(candidate) }],
    canonical_normalized_object_mappings: [{ organisation_id: org, mapping_id: "mapping:source", candidate_id: source.candidateId }],
    agent_version_technical_profile_proposals: [{ organisation_id: org, agent_version_candidate_id: source.candidateId,
      behavior_fingerprint_algorithm: "sha256", behavior_fingerprint_schema_version: "v1", behavior_fingerprint_value: "supported-fingerprint" }],
    canonical_relationships: [],
  };
  endpoints = { [source.candidateId]: [{ canonical_object_id: "canonical:version", canonical_object_kind: "AGENT_VERSION", mapping_id: "mapping:source" }],
    [target.candidateId]: [{ canonical_object_id: "canonical:tool", canonical_object_kind: "TOOL", mapping_id: "mapping:target" }] };
  readCalls = []; persisted = []; chain = undefined; existingDecisionId = undefined;
}
function existing(overrides: Row = {}) {
  return { organisation_id: org, relationship_id: canonicalRelationshipId(org, "USES_TOOL", "canonical:version", "canonical:tool"),
    relationship_state_id: "state:existing", relationship_type: "USES_TOOL", source_canonical_object_id: "canonical:version", source_kind: "AGENT_VERSION",
    target_canonical_object_id: "canonical:tool", target_kind: "TOOL", valid_to: null, ...overrides };
}
const commandInput = { organisationId: org, actorUserId: "reviewer:1", sessionRole: "org_admin", reviewSubjectId: subject.reviewSubjectId, reasonCode: "EXPLICIT_GOVERNANCE" };

test("server CREATE_NEW resolves canonical refs and real supported fingerprint; no versionCode or raw payload", async () => {
  reset(); const decision = await service.relationshipRequestedDecision(org, candidate, "CREATE_NEW", at);
  assert.equal(decision.outcome, "CREATE_NEW"); if (decision.outcome !== "CREATE_NEW") throw new Error("wrong outcome");
  assert.deepEqual(decision.authorizedState.source, { canonicalObject: { organisationId: org, kind: "AGENT_VERSION", objectId: "canonical:version" } });
  assert.equal(decision.authorizedState.relationshipId, canonicalRelationshipId(org, "USES_TOOL", "canonical:version", "canonical:tool"));
  assert.doesNotMatch(JSON.stringify(decision), /versionCode|rawPrompt|plaintext/);
  for (const call of readCalls) assert.ok(call.filters.some(([key, value]) => key === "organisation_id" && value === org));
});
test("real dashboard command persists a governed relationship decision with resolver revalidation", async () => {
  reset(); const result = await commands.submitReconciliationDecision({ ...commandInput, requestedOutcome: "CREATE_NEW" });
  assert.equal(result.kind, "APPLIED"); assert.equal(persisted.length, 1);
  assert.equal(persisted[0].decision.relationshipCandidateId, candidate.candidateId);
  assert.equal(persisted[0].decision.authorizedState.source.canonicalObject.kind, "AGENT_VERSION");
  assert.deepEqual(persisted[0].decision.evidenceIds, candidate.evidenceIds);
  chain = persisted[0]; existingDecisionId = chain.decision.decisionId;
  assert.equal((await commands.submitReconciliationDecision({ ...commandInput, requestedOutcome: "CREATE_NEW" })).kind, "REPLAYED");
  assert.equal((await commands.submitReconciliationDecision({ ...commandInput, requestedOutcome: "REJECT" })).kind, "PERSISTENCE_CONFLICT");
  assert.equal(persisted.length, 1);
});
for (const outcome of ["REJECT", "DEFER"] as const) test(`dashboard ${outcome} requires durable candidate but no canonical endpoints or writes`, async () => {
  reset(); endpoints = {};
  assert.equal((await commands.submitReconciliationDecision({ ...commandInput, requestedOutcome: outcome })).kind, "APPLIED");
  assert.equal(persisted[0].decision.outcome, outcome);
  assert.equal("authorizedState" in persisted[0].decision, false);
  chain = persisted[0]; existingDecisionId = chain.decision.decisionId;
  assert.equal((await commands.submitReconciliationDecision({ ...commandInput, requestedOutcome: outcome })).kind, "REPLAYED");
});
test("exact existing relationship is listed and matched, including its existing state ID", async () => {
  reset(); const row = existing(); tables.canonical_relationships = [row];
  assert.equal((await service.listExactRelationshipMatches(org, candidate)).length, 1);
  const decision = await service.relationshipRequestedDecision(org, candidate, "MATCH_EXISTING", at, row.relationship_id);
  assert.equal(decision.outcome, "MATCH_EXISTING"); if (decision.outcome !== "MATCH_EXISTING") throw new Error("wrong outcome");
  assert.equal(decision.matchedState.relationshipStateId, row.relationship_state_id);
  assert.equal((await commands.submitReconciliationDecision({ ...commandInput, requestedOutcome: "MATCH_EXISTING", matchCanonicalRelationshipId: row.relationship_id })).kind, "APPLIED");
});
for (const [label, override] of [
  ["wrong source", { source_canonical_object_id: "another" }], ["wrong target", { target_canonical_object_id: "another" }],
  ["wrong type", { relationship_type: "USES_MODEL" }], ["wrong tenant", { organisation_id: foreign }],
  ["wrong source kind", { source_kind: "AGENT" }], ["wrong target kind", { target_kind: "MODEL" }],
  ["reversed", { source_canonical_object_id: "canonical:tool", target_canonical_object_id: "canonical:version" }],
  ["inactive", { valid_to: at }],
] as const) test(`MATCH_EXISTING ${label} fails closed`, async () => {
  reset(); tables.canonical_relationships = [existing(override)];
  assert.equal((await service.listExactRelationshipMatches(org, candidate)).length, 0);
  await assert.rejects(() => service.relationshipRequestedDecision(org, candidate, "MATCH_EXISTING", at, existing().relationship_id), EndpointResolutionError);
});
test("client cannot select a different relationship ID despite an exact available match", async () => {
  reset(); tables.canonical_relationships = [existing()];
  await assert.rejects(() => service.relationshipRequestedDecision(org, candidate, "MATCH_EXISTING", at, "forged-id"), EndpointResolutionError);
});
for (const side of [source, target]) {
  for (const fault of ["zero", "multiple", "wrong-kind"] as const) test(`${side.candidateKind}: ${fault} canonical endpoint fails closed`, async () => {
    reset(); const row = endpoints[side.candidateId][0];
    endpoints[side.candidateId] = fault === "zero" ? [] : fault === "multiple" ? [row, row] : [{ ...row, canonical_object_kind: "AGENT" }];
    await assert.rejects(() => service.relationshipRequestedDecision(org, candidate, "CREATE_NEW", at), EndpointResolutionError);
  });
}
test("foreign tenant cannot resolve canonical endpoints or read the relationship candidate", async () => {
  reset(); await assert.rejects(() => service.canonicalEndpointResolution.resolveEndpoint(foreign, source as never), EndpointResolutionError);
  assert.equal(await service.canonicalEndpointResolution.getRelationshipCandidate(foreign, candidate.candidateId), undefined);
});
test("candidate substitution/hash mismatch fails before a decision is persisted", async () => {
  reset(); tables.discovery_candidates[0].envelope = { ...candidate, relationshipTypeCode: "USES_MODEL" };
  const result = await commands.submitReconciliationDecision({ ...commandInput, requestedOutcome: "CREATE_NEW" });
  assert.equal(result.kind, "INVALID_REQUEST"); assert.equal(persisted.length, 0);
});
for (const count of [0, 2]) test(`missing/ambiguous supported behavior fingerprint (${count}) fails closed`, async () => {
  reset(); const p = tables.agent_version_technical_profile_proposals[0];
  tables.agent_version_technical_profile_proposals = count ? [p, { ...p, behavior_fingerprint_value: "different" }] : [];
  await assert.rejects(() => service.relationshipRequestedDecision(org, candidate, "CREATE_NEW", at), EndpointResolutionError);
});
test("non-behavior EXPOSES uses the same exact resolver without inventing a behavior fingerprint", async () => {
  reset(); const exposes = { ...candidate, relationshipTypeCode: "EXPOSES", sourceEndpoint: { ...source, candidateKind: "MCP_SERVER" } } as NormalizedRelationshipCandidate;
  endpoints[source.candidateId][0].canonical_object_kind = "MCP_SERVER";
  const decision = await service.relationshipRequestedDecision(org, exposes, "CREATE_NEW", at);
  assert.equal(decision.outcome, "CREATE_NEW"); if (decision.outcome !== "CREATE_NEW") throw new Error("wrong outcome");
  assert.equal("boundTechnicalFingerprint" in decision.authorizedState, false);
});
