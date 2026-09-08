import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

interface MockState {
  session: { orgId: string; userId: string; role: string };
  detail: unknown;
  submitOutcome: unknown;
  materializeOutcome: unknown;
}

const state: MockState = {
  session: { orgId: "org-1", userId: "user-1", role: "org_admin" },
  detail: null,
  submitOutcome: { kind: "APPLIED", reconciliationDecisionId: "reconciliation-decision:1", outcome: "CREATE_NEW" },
  materializeOutcome: { kind: "APPLIED", result: { applicable: true, family: "OBJECT", result: { replay: false, status: "APPLIED", canonicalObjectId: "c-1", mappingId: "m-1" } } },
};

mock.module("@/lib/session", {
  namedExports: {
    getOrgId: async () => state.session.orgId,
    getUserId: async () => state.session.userId,
    getSessionContext: async () => ({
      userId: state.session.userId,
      orgId: state.session.orgId,
      email: "test@example.com",
      role: state.session.role,
    }),
  },
});

mock.module("@/lib/governance/workspace-query", {
  namedExports: { asReviewSubjectId: (id: string) => id },
});

mock.module("@/lib/governance/decision-query", {
  namedExports: {
    getGovernanceDecisionDetail: async () => state.detail,
  },
});

mock.module("@/lib/governance/decision-commands", {
  namedExports: {
    submitReconciliationDecision: async () => state.submitOutcome,
    triggerMaterialization: async () => state.materializeOutcome,
  },
});

let decisionRoute: typeof import("../app/api/governance/workspace/reviews/[id]/decision/route");
let materializeRoute: typeof import("../app/api/governance/workspace/reviews/[id]/materialize/route");

before(async () => {
  decisionRoute = await import("@/app/api/governance/workspace/reviews/[id]/decision/route");
  materializeRoute = await import("@/app/api/governance/workspace/reviews/[id]/materialize/route");
});

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("decision GET: a review subject not found returns a plain 404", async () => {
  state.detail = undefined;
  const res = await decisionRoute.GET(new Request("http://localhost/api/x"), makeParams("rs-missing"));
  assert.equal(res.status, 404);
});

test("decision GET: a found detail is passed through", async () => {
  state.detail = { reviewSubjectId: "rs-1", readiness: { ready: true, reason: "READY" }, availableOutcomes: ["CREATE_NEW"] };
  const res = await decisionRoute.GET(new Request("http://localhost/api/x"), makeParams("rs-1"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.reviewSubjectId, "rs-1");
});

test("decision POST: an invalid requestedOutcome is rejected with 400 before reaching the command layer", async () => {
  const res = await decisionRoute.POST(makePostRequest({ requestedOutcome: "DELETE_EVERYTHING", reasonCode: "x" }), makeParams("rs-1"));
  assert.equal(res.status, 400);
});

test("decision POST: FORBIDDEN outcome maps to 403", async () => {
  state.submitOutcome = { kind: "FORBIDDEN", message: "no" };
  const res = await decisionRoute.POST(makePostRequest({ requestedOutcome: "CREATE_NEW", reasonCode: "x" }), makeParams("rs-1"));
  assert.equal(res.status, 403);
});

test("decision POST: NOT_READY outcome maps to 409 and reports the reason code, not a raw domain error", async () => {
  state.submitOutcome = { kind: "NOT_READY", reason: "FINDING_ONLY" };
  const res = await decisionRoute.POST(makePostRequest({ requestedOutcome: "CREATE_NEW", reasonCode: "x" }), makeParams("rs-1"));
  const json = await res.json();
  assert.equal(res.status, 409);
  assert.equal(json.reason, "FINDING_ONLY");
});

test("decision POST: a successful APPLIED outcome returns 200 with the reconciliationDecisionId", async () => {
  state.submitOutcome = { kind: "APPLIED", reconciliationDecisionId: "reconciliation-decision:1", outcome: "CREATE_NEW" };
  const res = await decisionRoute.POST(makePostRequest({ requestedOutcome: "CREATE_NEW", reasonCode: "x" }), makeParams("rs-1"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.reconciliationDecisionId, "reconciliation-decision:1");
});

test("decision POST: never forwards a client-supplied organisationId, actor, or role — only server session values reach the command layer", async () => {
  const source = readFileSync(new URL("../app/api/governance/workspace/reviews/[id]/decision/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /body\.organisationId|body\.actorUserId|body\.sessionRole|body\.role/);
  assert.match(source, /organisationId:\s*asOrganisationId\(orgId\)/);
  assert.match(source, /actorUserId:\s*userId/);
  assert.match(source, /sessionRole:\s*role/);
});

test("decision POST: never accepts a raw reconciliation outcome envelope or canonical object from the client beyond the semantic requestedOutcome/matchCanonicalObjectId/reasonCode fields", async () => {
  const source = readFileSync(new URL("../app/api/governance/workspace/reviews/[id]/decision/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /body\.canonicalObject|body\.decision\b|body\.envelope/);
});

test("materialize POST: never accepts a client-supplied reconciliationDecisionId — it is always resolved server-side from the review subject", async () => {
  const source = readFileSync(new URL("../app/api/governance/workspace/reviews/[id]/materialize/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /body\.reconciliationDecisionId/);
});

test("materialize POST: NOT_APPLICABLE outcome maps to 409 with the domain reason, not a fabricated success", async () => {
  state.materializeOutcome = { kind: "NOT_APPLICABLE", reason: "NOT_MATERIALIZING_OUTCOME" };
  const res = await materializeRoute.POST(new Request("http://localhost/api/x", { method: "POST" }), makeParams("rs-1"));
  const json = await res.json();
  assert.equal(res.status, 409);
  assert.equal(json.reason, "NOT_MATERIALIZING_OUTCOME");
});

test("materialize POST: a successful APPLIED outcome returns 200 with the result", async () => {
  state.materializeOutcome = {
    kind: "APPLIED",
    result: { applicable: true, family: "OBJECT", result: { replay: false, status: "APPLIED", canonicalObjectId: "c-1", mappingId: "m-1" } },
  };
  const res = await materializeRoute.POST(new Request("http://localhost/api/x", { method: "POST" }), makeParams("rs-1"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.outcome, "APPLIED");
});
