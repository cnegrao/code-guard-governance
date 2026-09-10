import assert from "node:assert/strict";
import { test } from "node:test";
import { asCanonicalObjectId, type NormalizedObjectCandidate, type NormalizedRelationshipCandidate, type CanonicalObjectIdentity } from "@council/canonical-contracts";
import { asReviewSubjectId, createReviewSubject, propose, confirm, certify, canonicalRelationshipId, normalizedObjectIdentity, requireExactCanonicalMapping, EndpointResolutionError, invokeRelationshipReconciliation, invokeObjectReconciliation, materializeReconciliationDecision, stableCandidateContent, type RelationshipReconciliationInvocationCommand, type ReconciliationAuditChainEntry, type MaterializationPorts } from "../src/index.ts";
import { ORG_A, ORG_B, HUMAN_ALICE, MACHINE_RULE, OBSERVED_AT, LATER_AT, makeRelationshipFinding, makeObjectFinding, makeAllowingAuthorizationPort } from "./fixtures.ts";

const scope = { connectionId: "connection:repository:one", externalType: "file", externalId: "shared.py" } as const;
const versionId = (value: string) => `candidate:agent-version:${value.repeat(32)}`;
function object(kind: string, id: string, proposedIdentity: unknown): NormalizedObjectCandidate {
  return { candidateKind: kind, candidateId: id, findingId: `finding:${id}`, sourceObject: scope,
    proposedIdentity, confidence: 1, requiresReconciliation: true, assertionIds: ["assertion:fixture"], evidenceIds: ["evidence:fixture"] } as never;
}
const ref = (candidate: NormalizedObjectCandidate) => ({ referenceKind: "CANDIDATE" as const, candidateKind: candidate.candidateKind, candidateId: candidate.candidateId });
const canonical = (org: typeof ORG_A, kind: CanonicalObjectIdentity["kind"], id: string): CanonicalObjectIdentity => ({ organisationId: org, kind, objectId: asCanonicalObjectId(id) });
function mappingKey(org: string, candidate: NormalizedObjectCandidate) {
  return stableCandidateContent([org, candidate.sourceObject, candidate.candidateKind, normalizedObjectIdentity(candidate)]);
}

test("typed mapping separates same-source Agent, V1 and V2 without versionCode", () => {
  const agent = object("AGENT", "agent:row", { agentCode: "Owner" });
  const v1 = object("AGENT_VERSION", versionId("a"), { agent: ref(agent) });
  const v2 = object("AGENT_VERSION", versionId("b"), { agent: ref(agent) });
  const keys = [agent, v1, v2].map(c => mappingKey(ORG_A, c));
  assert.equal(new Set(keys).size, 3);
  assert.equal(keys[1], mappingKey(ORG_A, structuredClone(v1)));
  assert.notEqual(keys[1], mappingKey(ORG_B, v1));
  assert.equal("versionCode" in v1.proposedIdentity, false);
});
test("ordinary detector row/location IDs are not normalized mapping identity", () => {
  const a = object("TOOL", "candidate:row:one", { declarationKey: "search" });
  const b = { ...a, candidateId: "row:two", findingId: "line:999" } as NormalizedObjectCandidate;
  assert.equal(mappingKey(ORG_A, a), mappingKey(ORG_A, b));
  assert.notEqual(mappingKey(ORG_A, a), mappingKey(ORG_A, object("TOOL", "row:three", { declarationKey: "write" })));
});
for (const id of ["", "row-uuid", "candidate:agent-version:unknown", "v1", "2026-09-09"]) {
  test(`version discriminator ${JSON.stringify(id)} fails closed`, () => {
    assert.throws(() => normalizedObjectIdentity(object("AGENT_VERSION", id, { versionCode: "declared-but-not-a-discriminator" })), EndpointResolutionError);
  });
}
for (const [label, rows] of [
  ["zero mappings (including legacy-only)", []],
  ["multiple exact mappings", [canonical(ORG_A, "AGENT_VERSION", "v1"), canonical(ORG_A, "AGENT_VERSION", "v2")]],
  ["wrong kind", [canonical(ORG_A, "AGENT", "v1")]],
  ["cross tenant", [canonical(ORG_B, "AGENT_VERSION", "v1")]],
] as const) test(`${label} fails closed`, () => assert.throws(() => requireExactCanonicalMapping(ORG_A, "AGENT_VERSION", rows), EndpointResolutionError));
test("one exact canonical mapping suffices without rich AgentVersion metadata", () => {
  assert.deepEqual(requireExactCanonicalMapping(ORG_A, "AGENT_VERSION", [canonical(ORG_A, "AGENT_VERSION", "version")]), canonical(ORG_A, "AGENT_VERSION", "version"));
});
test("DATA_ELEMENT uses normalized parent identity and path, never parent row ID", () => {
  const parent = object("DATA_ASSET", "parent:row:1", { sourceReference: "customer_table" });
  const element = object("DATA_ELEMENT", "element:row", { parentDataAsset: ref(parent), elementPath: "email" });
  assert.throws(() => normalizedObjectIdentity(element), EndpointResolutionError);
  assert.equal(normalizedObjectIdentity(element, parent), normalizedObjectIdentity(element, { ...parent, candidateId: "different-row" } as NormalizedObjectCandidate));
});

function world(seed = "one", type = "USES_TOOL", version = "a") {
  const finding = makeRelationshipFinding(`m7:${seed}`);
  const sourceCandidate = object("AGENT_VERSION", versionId(version), { agent: { referenceKind: "SOURCE_OBJECT", candidateKind: "AGENT", sourceObject: scope } });
  const targetCandidate = object(type === "USES_MODEL" ? "MODEL" : "TOOL", "candidate:target", type === "USES_MODEL" ? { modelReference: "model-x" } : { declarationKey: "search" });
  const candidate: NormalizedRelationshipCandidate = { candidateId: `candidate:rel:${seed}` as never, candidateKind: "RELATIONSHIP", findingId: finding.findingId,
    sourceObject: finding.sourceObject, assertionIds: finding.assertionIds, evidenceIds: finding.evidenceIds, confidence: 1, requiresReconciliation: true,
    relationshipTypeCode: type, sourceEndpoint: ref(sourceCandidate), targetEndpoint: ref(targetCandidate) };
  let subject = createReviewSubject({ reviewSubjectId: asReviewSubjectId(`subject:${seed}`), organisationId: ORG_A, finding, candidate });
  for (const [transition, expectedState, actor] of [[propose, "DETECTED", MACHINE_RULE], [confirm, "PROPOSED", HUMAN_ALICE], [certify, "CONFIRMED", HUMAN_ALICE]] as const) {
    subject = transition(subject, { commandId: `${seed}:${expectedState}`, organisationId: ORG_A, findingId: finding.findingId, expectedState, actor, occurredAt: LATER_AT, reasonCode: "GOVERNED" } as never).subject;
  }
  const source = canonical(ORG_A, "AGENT_VERSION", `canonical:version:${version}`);
  const target = canonical(ORG_A, targetCandidate.candidateKind, "canonical:target");
  const mappings = new Map<string, CanonicalObjectIdentity[]>([[sourceCandidate.candidateId, [source]], [targetCandidate.candidateId, [target]]]);
  const id = canonicalRelationshipId(ORG_A, type as never, source.objectId, target.objectId);
  const support = { assertionIds: candidate.assertionIds, evidenceIds: candidate.evidenceIds };
  const empty = { assertionIds: [], evidenceIds: [] };
  const state = { organisationId: ORG_A, relationshipId: id, relationshipStateId: `${id}:initial`, relationshipType: type,
    source: { canonicalObject: source }, target: { canonicalObject: target }, validFrom: OBSERVED_AT, recordedAt: OBSERVED_AT,
    boundTechnicalFingerprint: { algorithm: "sha256", schemaVersion: "fixture-v1", value: "supported-fingerprint" },
    support: { relationship: support, boundTechnicalFingerprint: support, bindingConfiguration: { configurationHash: empty, configurationLocator: empty } } };
  const endpointResolution = {
    async getRelationshipCandidate(org: typeof ORG_A, id: string) { return org === ORG_A && id === candidate.candidateId ? structuredClone(candidate) : undefined; },
    async resolveEndpoint(org: typeof ORG_A, reference: typeof candidate.sourceEndpoint) {
      return requireExactCanonicalMapping(org, reference.candidateKind, reference.referenceKind === "CANDIDATE" ? mappings.get(reference.candidateId) ?? [] : []);
    },
  };
  function command(outcome: "CREATE_NEW" | "MATCH_EXISTING" | "REJECT" | "DEFER" = "CREATE_NEW"): RelationshipReconciliationInvocationCommand {
    return { commandId: `cmd:${seed}:${outcome}`, organisationId: ORG_A, finding, candidate, reviewSubject: subject, actor: HUMAN_ALICE,
      authorizationPort: makeAllowingAuthorizationPort({ organisationId: ORG_A, subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId }, requestedAction: outcome, actor: HUMAN_ALICE }),
      reasonCode: "EXPLICIT_REVIEW", requestedAt: LATER_AT, endpointResolution,
      requestedDecision: outcome === "CREATE_NEW" ? { outcome, authorizedState: state as never } : outcome === "MATCH_EXISTING" ? { outcome, matchedState: state as never } : { outcome } };
  }
  return { candidate, finding, subject, mappings, sourceCandidate, targetCandidate, source, target, state, command };
}

for (const type of ["USES_MODEL", "USES_TOOL"]) test(`${type}: human governed decision preserves canonical AGENT_VERSION and support`, async () => {
  const w = world(type, type); const result = await invokeRelationshipReconciliation(w.command());
  assert.equal(result.decision.outcome, "CREATE_NEW");
  if (result.decision.outcome !== "CREATE_NEW") throw new Error("wrong outcome");
  assert.deepEqual(result.decision.authorizedState.source, { canonicalObject: w.source });
  assert.equal(result.decision.relationshipCandidateId, w.candidate.candidateId);
  assert.deepEqual(result.decision.evidenceIds, w.candidate.evidenceIds);
  assert.deepEqual(result.decision.assertionIds, w.candidate.assertionIds);
  assert.equal("versionCode" in result.decision.authorizedState.source, false);
});

for (const outcome of ["CREATE_NEW", "MATCH_EXISTING"] as const) {
  for (const endpoint of ["source", "target"] as const) {
    for (const fault of ["missing", "ambiguous", "wrong-tenant", "wrong-kind", "wrong-object"] as const) {
      test(`${outcome}: ${endpoint} ${fault} mapping fails closed`, async () => {
        const w = world(`${outcome}:${endpoint}:${fault}`);
        const candidate = endpoint === "source" ? w.sourceCandidate : w.targetCandidate;
        const exact = endpoint === "source" ? w.source : w.target;
        w.mappings.set(candidate.candidateId, fault === "missing" ? [] : fault === "ambiguous" ? [exact, exact] : [{ ...exact,
          ...(fault === "wrong-tenant" ? { organisationId: ORG_B } : fault === "wrong-kind" ? { kind: "AGENT" as const } : { objectId: asCanonicalObjectId("substituted") }) }]);
        await assert.rejects(() => invokeRelationshipReconciliation(w.command(outcome)));
      });
    }
  }
  test(`${outcome}: directed reversal and wrong relationship type fail closed`, async () => {
    const w = world(`reverse:${outcome}`); const cmd = w.command(outcome);
    for (const state of [{ ...w.state, source: w.state.target, target: w.state.source }, { ...w.state, relationshipType: "USES_MODEL" }]) {
      await assert.rejects(() => invokeRelationshipReconciliation({ ...cmd, requestedDecision: outcome === "CREATE_NEW" ? { outcome, authorizedState: state as never } : { outcome, matchedState: state as never } }));
    }
  });
}
test("candidate substitution after certification cannot authorize truth", async () => {
  const w = world("substitution"); const cmd = w.command();
  await assert.rejects(() => invokeRelationshipReconciliation({ ...cmd, candidate: { ...w.candidate, candidateId: "another-candidate" as never } }));
  await assert.rejects(() => invokeRelationshipReconciliation({ ...cmd, candidate: { ...w.candidate, confidence: 0.5 } }));
});
test("missing candidate support cannot borrow evidence from the certified finding", async () => {
  const w = world("missing-support");
  Object.assign(w.candidate, { assertionIds: [], evidenceIds: [] });
  await assert.rejects(() => invokeRelationshipReconciliation(w.command()));
});
test("certified review alone, absent resolver, machine actors and denied scope cannot authorize truth", async () => {
  const w = world("authority"); const cmd = w.command();
  await assert.rejects(() => invokeRelationshipReconciliation({ ...cmd, endpointResolution: undefined }));
  await assert.rejects(() => invokeRelationshipReconciliation({ ...cmd, reviewSubject: { ...w.subject, state: "PROPOSED" } }));
  await assert.rejects(() => invokeRelationshipReconciliation({ ...cmd, actor: MACHINE_RULE }));
  await assert.rejects(() => invokeRelationshipReconciliation({ ...cmd, organisationId: ORG_B }));
});
test("same authorized command replay is stable; conflicting finalized payload fails", async () => {
  const w = world("replay"); const cmd = w.command();
  const first = await invokeRelationshipReconciliation(cmd);
  const replay = await invokeRelationshipReconciliation({ ...cmd, priorInvocation: first.audit });
  assert.equal(replay.kind, "REPLAYED"); assert.deepEqual(replay.decision, first.decision);
  await assert.rejects(() => invokeRelationshipReconciliation({ ...cmd, reasonCode: "changed", priorInvocation: first.audit }));
});
test("canonical relationship ID is directed, tenant scoped and independent of review/candidate/time", () => {
  const a = world("candidate-one"), b = world("candidate-two");
  assert.equal(a.state.relationshipId, b.state.relationshipId);
  assert.notEqual(a.state.relationshipId, canonicalRelationshipId(ORG_B, "USES_TOOL", a.source.objectId, a.target.objectId));
  assert.notEqual(a.state.relationshipId, canonicalRelationshipId(ORG_A, "USES_TOOL", a.target.objectId, a.source.objectId));
  assert.notEqual(a.state.relationshipId, world("v2", "USES_TOOL", "b").state.relationshipId);
});

test("persisted decisions materialize idempotently; reject/defer retain audit without writes; V2 preserves V1", async () => {
  const chains = new Map<string, ReconciliationAuditChainEntry>();
  const edges = new Map<string, unknown>(); const operations = new Map<string, string>();
  const ports: MaterializationPorts = {
    governance: { getReconciliationAuditChain: async (org: typeof ORG_A, id: string) => org === ORG_A ? chains.get(id) : undefined } as never,
    materialization: {
      findActiveObjectSourceMapping: async () => undefined,
      materializeObjectReconciliation: async () => { throw new Error("implicit object creation forbidden"); },
      materializeRelationshipReconciliation: async input => {
        assert.ok(chains.has(input.reconciliationDecisionId));
        const replay = operations.has(input.reconciliationDecisionId);
        if (!replay && input.outcome === "CREATE_NEW") { assert.ok(!edges.has(input.relationshipId)); edges.set(input.relationshipId, structuredClone(input)); }
        if (input.outcome === "MATCH_EXISTING") assert.ok(edges.has(input.relationshipId));
        operations.set(input.reconciliationDecisionId, input.relationshipId);
        return { replay, status: "APPLIED", relationshipId: input.relationshipId };
      },
    },
  };
  for (const producer of ["scanner", "L8", "LLM", "Graph", "PROPOSED"]) {
    await assert.rejects(() => materializeReconciliationDecision(ports, { organisationId: ORG_A, reconciliationDecisionId: producer }));
  }
  let v1: unknown;
  for (const [seed, outcome, version] of [["create-v1", "CREATE_NEW", "a"], ["match", "MATCH_EXISTING", "a"], ["reject", "REJECT", "a"], ["defer", "DEFER", "a"], ["create-v2", "CREATE_NEW", "b"]] as const) {
    const w = world(seed, "USES_TOOL", version); const result = await invokeRelationshipReconciliation(w.command(outcome));
    const chain = { family: "RELATIONSHIP" as const, decision: result.decision, invocation: result.audit, authorization: result.authorization };
    chains.set(result.decision.decisionId, chain);
    const input = { organisationId: ORG_A, reconciliationDecisionId: result.decision.decisionId };
    const first = await materializeReconciliationDecision(ports, input);
    const second = await materializeReconciliationDecision(ports, input);
    if (outcome === "REJECT" || outcome === "DEFER") { assert.equal(first.applicable, false); assert.equal(second.applicable, false); }
    else { assert.equal(first.applicable, true); assert.equal(second.applicable && second.result.replay, true); }
    assert.deepEqual(chain.decision.evidenceIds, w.candidate.evidenceIds);
    if (seed === "create-v1") v1 = structuredClone(edges.get(w.state.relationshipId));
  }
  assert.equal(edges.size, 2); assert.equal(operations.size, 3); assert.equal(chains.size, 5);
  assert.deepEqual([...edges.values()][0], v1);
  const firstChain = [...chains.values()][0];
  chains.set("substituted-decision", firstChain);
  await assert.rejects(() => materializeReconciliationDecision(ports, { organisationId: ORG_A, reconciliationDecisionId: "substituted-decision" }));
});


test("governed same-file Agent and two normalized revisions map independently and replay exactly", async () => {
  const agent = object("AGENT", "candidate:agent", { agentCode: "Owner" });
  const versions = ["a", "b"].map(revision => object("AGENT_VERSION", versionId(revision), { agent: ref(agent) }));
  const chains = new Map<string, ReconciliationAuditChainEntry>();
  const subjects = new Map<string, ReturnType<typeof createReviewSubject>>();
  const candidates = new Map<string, NormalizedObjectCandidate>();
  const mappings = new Map<string, CanonicalObjectIdentity>();
  const applied = new Set<string>();
  const ports: MaterializationPorts = {
    governance: { getReviewSubject: async (org: typeof ORG_A, id: string) => org === ORG_A ? subjects.get(id) : undefined, getReconciliationAuditChain: async (org: typeof ORG_A, id: string) => org === ORG_A ? chains.get(id) : undefined } as never,
    materialization: {
      findActiveObjectSourceMapping: async () => undefined,
      materializeRelationshipReconciliation: async () => { throw new Error("object governance cannot create edges"); },
      materializeObjectReconciliation: async input => {
        const candidate = candidates.get(input.reconciliationDecisionId)!;
        assert.ok(chains.has(input.reconciliationDecisionId));
        assert.equal(input.sourceExternalId, scope.externalId);
        const key = mappingKey(input.organisationId, candidate);
        const identity = canonical(input.organisationId, input.canonicalObjectKind, input.canonicalObjectId);
        if (candidate.candidateKind === "AGENT_VERSION") assert.ok(mappings.has(mappingKey(input.organisationId, agent)));
        if (mappings.has(key)) assert.deepEqual(mappings.get(key), identity);
        const replay = applied.has(input.reconciliationDecisionId);
        mappings.set(key, identity); applied.add(input.reconciliationDecisionId);
        return { replay, status: "APPLIED", canonicalObjectId: input.canonicalObjectId, mappingId: key };
      },
    },
  };
  for (const candidate of [agent, ...versions]) {
    const finding = { ...makeObjectFinding("AGENT", candidate.candidateId), candidateKind: candidate.candidateKind, findingId: candidate.findingId,
      sourceObject: candidate.sourceObject, assertionIds: candidate.assertionIds, evidenceIds: candidate.evidenceIds };
    let subject = createReviewSubject({ reviewSubjectId: asReviewSubjectId(`review:${candidate.candidateId}`), organisationId: ORG_A, finding, candidate });
    for (const [transition, expectedState, actor] of [[propose, "DETECTED", MACHINE_RULE], [confirm, "PROPOSED", HUMAN_ALICE], [certify, "CONFIRMED", HUMAN_ALICE]] as const) {
      subject = transition(subject, { commandId: `${candidate.candidateId}:${expectedState}`, organisationId: ORG_A, findingId: finding.findingId,
        expectedState, actor, occurredAt: LATER_AT, reasonCode: "GOVERNED" } as never).subject;
    }
    subjects.set(subject.reviewSubjectId, subject);
    const result = await invokeObjectReconciliation({ commandId: `decide:${candidate.candidateId}`, organisationId: ORG_A, finding, candidate, reviewSubject: subject,
      actor: HUMAN_ALICE, requestedAt: LATER_AT, reasonCode: "EXPLICIT_GOVERNANCE",
      authorizationPort: makeAllowingAuthorizationPort({ organisationId: ORG_A, subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId }, requestedAction: "CREATE_NEW", actor: HUMAN_ALICE }),
      requestedDecision: { outcome: "CREATE_NEW", subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: candidate.candidateKind },
        canonicalObject: canonical(ORG_A, candidate.candidateKind, `canonical:${candidate.candidateId}`) } });
    chains.set(result.decision.decisionId, { family: "OBJECT", decision: result.decision, invocation: result.audit, authorization: result.authorization });
    candidates.set(result.decision.decisionId, candidate);
    const input = { organisationId: ORG_A, reconciliationDecisionId: result.decision.decisionId };
    await materializeReconciliationDecision(ports, input);
    const replay = await materializeReconciliationDecision(ports, input);
    assert.equal(replay.applicable && replay.result.replay, true);
    const exact = mappings.get(mappingKey(ORG_A, structuredClone(candidate)))!;
    assert.equal(requireExactCanonicalMapping(ORG_A, candidate.candidateKind, [exact]).objectId, `canonical:${candidate.candidateId}`);
    assert.equal("versionCode" in candidate.proposedIdentity, false);
  }
  assert.equal(mappings.size, 3);
  assert.equal(new Set([...mappings.values()].map(value => value.objectId)).size, 3);
  assert.equal(applied.size, 3);
});
