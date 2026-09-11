import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, mock, test } from "node:test";
import { asOrganisationId, asNormalizedCandidateId, asDiscoveryFindingId, asSourceConnectionId, asExternalId,
  asSourceAssertionId, asEvidenceId, asIsoTimestamp, type NormalizedRelationshipCandidate, type RelationshipDiscoveryFinding } from "@council/canonical-contracts";
import { stableCandidateContent, asReviewSubjectId } from "@council/governance-review";
import { lineageObservationFinding } from "@/lib/governance/lineage-observation";

const org = asOrganisationId("11111111-1111-1111-1111-111111111111");
const foreign = asOrganisationId("22222222-2222-2222-2222-222222222222");
const hash = (value: unknown) => createHash("sha256").update(stableCandidateContent(value)).digest("hex");
const sourceObject = { connectionId: asSourceConnectionId("connection:sql"), externalType: "file", externalId: asExternalId("load.sql") };
const candidate: NormalizedRelationshipCandidate = { candidateId: asNormalizedCandidateId(`candidate:relationship:${"a".repeat(32)}`), candidateKind: "RELATIONSHIP",
  findingId: asDiscoveryFindingId("finding:origin"), sourceObject, relationshipTypeCode: "DERIVED_FROM", confidence: 1, requiresReconciliation: true,
  sourceEndpoint: { referenceKind: "CANDIDATE", candidateKind: "DATA_ELEMENT", candidateId: asNormalizedCandidateId("element:target") },
  targetEndpoint: { referenceKind: "CANDIDATE", candidateKind: "DATA_ELEMENT", candidateId: asNormalizedCandidateId("element:source") },
  assertionIds: [asSourceAssertionId("assertion:1")], evidenceIds: [asEvidenceId("evidence:1")] };
const finding: RelationshipDiscoveryFinding = { findingId: candidate.findingId, findingNature: "CANDIDATE", candidateKind: "RELATIONSHIP", sourceObject,
  confidence: 1, reviewStatus: "UNREVIEWED", requiresReview: true, createsCanonicalObject: false,
  detectedAt: asIsoTimestamp("2026-09-10T12:00:00.000Z"), assertionIds: candidate.assertionIds, evidenceIds: candidate.evidenceIds };
type Row = Record<string, any>;
let rpcResult: Row;
let rpcCall: Row;
let tables: Record<string, Row[]>;
let reads: { table: string; filters: [string, unknown][] }[];
const subject = { reviewSubjectId: asReviewSubjectId("review:lineage"), organisationId: org, findingId: finding.findingId,
  candidateKind: "RELATIONSHIP", state: "CERTIFIED", sourceObject, detectedAt: finding.detectedAt,
  assertionIds: candidate.assertionIds, evidenceIds: candidate.evidenceIds };
const db = {
  rpc: async (name: string, args: Row) => { assert.equal(name, "record_lineage_observation"); rpcCall = args; return rpcResult; },
  from(table: string) {
    const filters: [string, unknown][] = []; let range = [0, Infinity];
    reads.push({ table, filters });
    const result = () => {
      assert.ok(table in tables, `unexpected query ${table}`);
      return tables[table].filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value))
        .slice(range[0], range[1] + 1);
    };
    const q = { select: (_: string) => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      in: (key: string, value: unknown[]) => { filters.push([key, value]); return q; }, order: (_: string) => q,
      range: (start: number, end: number) => { range = [start, end]; return q; },
      maybeSingle: async () => { const rows = result(); assert.ok(rows.length < 2); return { data: rows[0], error: null }; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(resolve) };
    return q;
  },
};
mock.module("@/lib/governance/persistence", { namedExports: { privilegedDb: db, canonicalStringify: stableCandidateContent,
  sha256Hex: (value: string) => createHash("sha256").update(value).digest("hex"),
  governanceReviewPersistence: { getReviewAuditChain: async (tenant: string) => tenant === org ? { subject, events: [] } : undefined } } });
let persistence: typeof import("@/lib/governance/discovery-intake-persistence").discoveryIntakePersistence;
let detail: typeof import("@/lib/governance/workspace-query").getReviewSubjectDetail;
before(async () => {
  ({ discoveryIntakePersistence: persistence } = await import("@/lib/governance/discovery-intake-persistence"));
  ({ getReviewSubjectDetail: detail } = await import("@/lib/governance/workspace-query"));
});
const response = () => ({ data: [{ candidate, candidate_hash: hash(candidate), finding, finding_hash: hash(finding) }], error: null });

test("adapter attaches a separate observation through one tenant-scoped RPC and returns immutable origin", async () => {
  rpcResult = response();
  const current = { ...candidate, evidenceIds: ["evidence:2" as never], assertionIds: ["assertion:2" as never] };
  const currentFinding = { ...finding, evidenceIds: current.evidenceIds, assertionIds: current.assertionIds };
  const result = await persistence.recordLineageObservation!(org, currentFinding, current, "run:2" as never);
  assert.deepEqual(result, { candidate, finding });
  assert.equal(rpcCall.p_organisation_id, org);
  assert.equal(rpcCall.p_acquisition_run_id, "run:2");
  assert.equal(rpcCall.p_candidate.candidateId, candidate.candidateId);
  assert.notEqual(rpcCall.p_observation.findingId, candidate.findingId);
  assert.deepEqual(rpcCall.p_observation.evidenceIds, current.evidenceIds);
  assert.equal(rpcCall.p_observation_hash, hash(rpcCall.p_observation));
});
test("adapter refuses tampered origin envelopes, different candidates and RPC support conflicts", async () => {
  rpcResult = response(); rpcResult.data[0].candidate_hash = "bad";
  await assert.rejects(persistence.recordLineageObservation!(org, finding, candidate, "run:1" as never), /HASH_MISMATCH/);
  rpcResult = response(); rpcResult.data[0].candidate = { ...candidate, candidateId: "candidate:substitution" };
  rpcResult.data[0].candidate_hash = hash(rpcResult.data[0].candidate);
  await assert.rejects(persistence.recordLineageObservation!(org, finding, candidate, "run:1" as never), /CONTEXT_MISMATCH/);
  rpcResult = { data: null, error: { message: "LINEAGE_OBSERVATION_SUPPORT_MISSING" } };
  await assert.rejects(persistence.recordLineageObservation!(org, finding, candidate, "run:1" as never), /SUPPORT_MISSING/);
});
test("observation identity deduplicates support ordering and capture time without changing semantic identity", () => {
  const first = { ...candidate, evidenceIds: ["ev:b", "ev:a"] as never, assertionIds: ["as:b", "as:a"] as never };
  const second = { ...first, evidenceIds: ["ev:a", "ev:b", "ev:a"] as never, assertionIds: ["as:a", "as:b"] as never };
  assert.equal(lineageObservationFinding(finding, first).findingId,
    lineageObservationFinding({ ...finding, detectedAt: "2026-09-11T12:00:00.000Z" as never }, second).findingId);
  assert.notEqual(lineageObservationFinding(finding, first).findingId, lineageObservationFinding(finding, candidate).findingId);
  assert.equal(first.candidateId, candidate.candidateId);
  const reordered = { ...candidate, sourceEndpoint: {
    candidateId: candidate.sourceEndpoint.referenceKind === "CANDIDATE" ? candidate.sourceEndpoint.candidateId : '' as never,
    candidateKind: "DATA_ELEMENT" as const, referenceKind: "CANDIDATE" as const,
  } };
  assert.equal(lineageObservationFinding(finding, reordered).findingId, lineageObservationFinding(finding, candidate).findingId);
});
test("review detail exposes both observation histories under the same tenant, leaving CERTIFIED support unchanged", async () => {
  const secondCandidate = { ...candidate, evidenceIds: ["evidence:2" as never], assertionIds: ["assertion:2" as never] };
  const observations = [lineageObservationFinding(finding, candidate), lineageObservationFinding(finding, secondCandidate)];
  const row = (envelope: Row) => ({ organisation_id: org, finding_id: envelope.findingId, envelope, envelope_hash: hash(envelope) });
  tables = {
    discovery_candidates: [{ ...row(candidate), candidate_id: candidate.candidateId }],
    discovery_findings: [row(finding), ...observations.map(row)],
    lineage_candidate_observations: observations.map(item => ({ organisation_id: org, candidate_id: candidate.candidateId, observation_finding_id: item.findingId })),
    discovery_evidence: [1, 2].map(i => {
      const envelope = { evidenceId: `evidence:${i}`, handling: i === 2 ? "HASH_ONLY" : "NON_SENSITIVE", capturedAt: finding.detectedAt,
        hashes: [{ algorithm: "sha256", value: `snapshot:${i}` }], locations: [], redactedExcerpt: i === 2 ? "must-not-leak" : "INSERT INTO target" };
      return { organisation_id: org, evidence_id: envelope.evidenceId, envelope, envelope_hash: hash(envelope) };
    }),
    source_assertions: [1, 2].map(i => ({ organisation_id: org, assertion_id: `assertion:${i}`, run_id: `run:${i}`, confidence: 1,
      method_code: "sql-insert-select-column-lineage", method_version: "1.0.0", trust_state: "DECLARED" })),
    acquisition_runs: [],
  };
  tables.lineage_candidate_observations.push({ organisation_id: foreign, candidate_id: candidate.candidateId, observation_finding_id: "foreign-finding" });
  reads = [];
  const result = await detail(org, subject.reviewSubjectId);
  assert.equal(result?.state, "CERTIFIED");
  assert.equal(result?.evidence.length, 1);
  assert.equal(result?.assertions.length, 1);
  assert.equal(result?.lineageObservations?.length, 2);
  assert.deepEqual(result?.lineageObservations?.map(item => item.assertions[0].assertionId), ["assertion:1", "assertion:2"]);
  assert.ok(!JSON.stringify(result).includes("must-not-leak"));
  assert.ok(!JSON.stringify(result).includes("foreign-finding"));
  assert.ok(reads.every(read => read.filters.some(([key, value]) => key === "organisation_id" && value === org)));
  assert.equal(await detail(foreign, subject.reviewSubjectId), undefined);
});
