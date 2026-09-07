import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

interface MockSession {
  orgId: string;
  userId: string;
  role: string;
}

interface MockState {
  session: MockSession;
  detail: unknown;
  detailThrows: boolean;
  queuePage: unknown;
  summary: unknown;
  summaryThrows: boolean;
  commandOutcome: unknown;
}

const state: MockState = {
  session: { orgId: "org-1", userId: "user-1", role: "org_admin" },
  detail: null,
  detailThrows: false,
  queuePage: { items: [], page: 1, pageSize: 25, hasMore: false },
  summary: { needsReview: 0, detected: 0, proposed: 0, confirmed: 0, certified: 0, objectFindingsNeedingReview: 0, relationshipFindingsNeedingReview: 0 },
  summaryThrows: false,
  commandOutcome: { kind: "APPLIED", subject: { state: "CONFIRMED" } },
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
  namedExports: {
    asReviewSubjectId: (id: string) => id,
    getReviewSubjectDetail: async () => {
      if (state.detailThrows) throw new Error("connection to postgres://internal-host failed");
      return state.detail;
    },
    listReviewQueue: async () => state.queuePage,
    getWorkspaceSummary: async () => {
      if (state.summaryThrows) throw new Error("connection to postgres://internal-host failed");
      return state.summary;
    },
    REVIEW_QUEUE_DEFAULT_PAGE_SIZE: 25,
    REVIEW_QUEUE_MAX_PAGE_SIZE: 100,
  },
});

mock.module("@/lib/governance/workspace-commands", {
  namedExports: {
    workspaceCommands: {
      proposeReview: async () => state.commandOutcome,
      confirmReview: async () => state.commandOutcome,
      certifyReview: async () => state.commandOutcome,
      rejectReview: async () => state.commandOutcome,
    },
  },
});

let detailRoute: typeof import("../app/api/governance/workspace/reviews/[id]/route");
let queueRoute: typeof import("../app/api/governance/workspace/reviews/route");
let summaryRoute: typeof import("../app/api/governance/workspace/summary/route");

before(async () => {
  detailRoute = await import("@/app/api/governance/workspace/reviews/[id]/route");
  queueRoute = await import("@/app/api/governance/workspace/reviews/route");
  summaryRoute = await import("@/app/api/governance/workspace/summary/route");
});

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePutRequest(body: unknown) {
  return new Request("http://localhost/api/governance/workspace/reviews/rs-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("detail route: a review subject not found (including a cross-tenant lookup) returns a plain 404, not an internal error", async () => {
  state.detail = undefined;
  const res = await detailRoute.GET(new Request("http://localhost/api/x"), makeParams("rs-missing"));
  assert.equal(res.status, 404);
  const json = await res.json();
  assert.equal(json.error, "Review subject not found.");
});

test("detail route: an internal query failure is sanitized, never leaking connection strings or table names", async () => {
  state.detailThrows = true;
  const res = await detailRoute.GET(new Request("http://localhost/api/x"), makeParams("rs-1"));
  state.detailThrows = false;
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(JSON.stringify(json).includes("postgres://"), false);
});

test("detail route: allowedActions is attached server-side from state + session role, never trusted from the client", async () => {
  state.detail = { state: "PROPOSED", reviewSubjectId: "rs-1" };
  state.session.role = "org_admin";
  const res = await detailRoute.GET(new Request("http://localhost/api/x"), makeParams("rs-1"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(json.allowedActions, { canPropose: false, canConfirm: true, canCertify: false, canReject: true });
});

test("detail route: a non-admin session role sees no allowed actions even though the state would otherwise permit them", async () => {
  state.detail = { state: "PROPOSED", reviewSubjectId: "rs-1" };
  state.session.role = "user";
  const res = await detailRoute.GET(new Request("http://localhost/api/x"), makeParams("rs-1"));
  const json = await res.json();
  state.session.role = "org_admin";
  assert.deepEqual(json.allowedActions, { canPropose: false, canConfirm: false, canCertify: false, canReject: false });
});

test("action route: an unrecognized action name is rejected with 400 — the endpoint never accepts an arbitrary target state", async () => {
  const res = await detailRoute.PUT(
    makePutRequest({ action: "SET_STATE", expectedState: "PROPOSED", targetState: "CERTIFIED" }),
    makeParams("rs-1"),
  );
  assert.equal(res.status, 400);
});

test("action route: a missing/invalid expectedState is rejected with 400", async () => {
  const res = await detailRoute.PUT(makePutRequest({ action: "CONFIRM", expectedState: "NOT_A_STATE" }), makeParams("rs-1"));
  assert.equal(res.status, 400);
});

test("action route: FORBIDDEN outcome maps to 403 with a sanitized message", async () => {
  state.commandOutcome = { kind: "FORBIDDEN", message: "no" };
  const res = await detailRoute.PUT(makePutRequest({ action: "CONFIRM", expectedState: "PROPOSED" }), makeParams("rs-1"));
  assert.equal(res.status, 403);
});

test("action route: STALE_REVIEW_SUBJECT outcome maps to 409 and reports the current state without applying anything", async () => {
  state.commandOutcome = { kind: "STALE_REVIEW_SUBJECT", currentState: "CONFIRMED" };
  const res = await detailRoute.PUT(makePutRequest({ action: "CONFIRM", expectedState: "PROPOSED" }), makeParams("rs-1"));
  const json = await res.json();
  assert.equal(res.status, 409);
  assert.equal(json.outcome, "STALE_REVIEW_SUBJECT");
  assert.equal(json.currentState, "CONFIRMED");
});

test("action route: a successful APPLIED outcome returns 200 with the new state", async () => {
  state.commandOutcome = { kind: "APPLIED", subject: { state: "CONFIRMED" } };
  const res = await detailRoute.PUT(makePutRequest({ action: "CONFIRM", expectedState: "PROPOSED" }), makeParams("rs-1"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.state, "CONFIRMED");
});

test("action route: never forwards a client-supplied organisationId, actor, or role — only server session values reach the command layer", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../app/api/governance/workspace/reviews/[id]/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /body\.organisationId|body\.actorUserId|body\.sessionRole|body\.role/);
  assert.match(source, /organisationId:\s*asOrganisationId\(orgId\)/);
  assert.match(source, /actorUserId:\s*userId/);
  assert.match(source, /sessionRole:\s*role/);
});

test("queue route: invalid state filter is rejected with 400 rather than silently ignored", async () => {
  const res = await queueRoute.GET(new Request("http://localhost/api/x?state=NOT_A_STATE"));
  assert.equal(res.status, 400);
});

test("queue route: invalid kind filter is rejected with 400", async () => {
  const res = await queueRoute.GET(new Request("http://localhost/api/x?kind=NOT_A_KIND"));
  assert.equal(res.status, 400);
});

test("queue route: a valid request passes through the query result", async () => {
  state.queuePage = { items: [{ reviewSubjectId: "rs-1" }], page: 1, pageSize: 25, hasMore: false };
  const res = await queueRoute.GET(new Request("http://localhost/api/x?state=PROPOSED"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.items.length, 1);
});

test("summary route: an internal failure is sanitized, never a raw 500 with internal details", async () => {
  state.summaryThrows = true;
  const res = await summaryRoute.GET();
  state.summaryThrows = false;
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(JSON.stringify(json).includes("postgres://"), false);
});

test("summary route: a healthy request passes the summary through unchanged", async () => {
  const res = await summaryRoute.GET();
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(json, state.summary);
});
