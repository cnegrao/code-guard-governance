import { test } from "node:test";
import assert from "node:assert/strict";

import { REVIEW_STATE, RECONCILIATION_INPUT_STATUS } from "@council/governance-review";

import { deriveReconciliationReadiness, RECONCILIATION_READINESS_REASON } from "@/lib/governance/reconciliation-readiness";

const BASE = {
  reviewState: REVIEW_STATE.CERTIFIED,
  recoveryStatus: RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE,
  hasExistingReconciliationDecision: false,
  isMaterializedApplied: false,
};

test("readiness: a non-CERTIFIED review subject is never ready, regardless of recovery status", () => {
  for (const state of [REVIEW_STATE.DETECTED, REVIEW_STATE.PROPOSED, REVIEW_STATE.CONFIRMED, REVIEW_STATE.REJECTED]) {
    const readiness = deriveReconciliationReadiness({ ...BASE, reviewState: state });
    assert.equal(readiness.ready, false);
    assert.equal(readiness.reason, RECONCILIATION_READINESS_REASON.NOT_CERTIFIED);
  }
});

test("readiness: CERTIFIED + OBJECT_INPUT_AVAILABLE (MODEL/TOOL) is READY", () => {
  const readiness = deriveReconciliationReadiness(BASE);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, RECONCILIATION_READINESS_REASON.READY);
});

test("readiness: CERTIFIED + RELATIONSHIP_INPUT_AVAILABLE is READY", () => {
  const readiness = deriveReconciliationReadiness({
    ...BASE,
    recoveryStatus: RECONCILIATION_INPUT_STATUS.RELATIONSHIP_INPUT_AVAILABLE,
  });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, RECONCILIATION_READINESS_REASON.READY);
});

test("readiness: CERTIFIED + FINDING_ONLY (AGENT) is NOT READY — never fabricated as READY", () => {
  const readiness = deriveReconciliationReadiness({
    ...BASE,
    recoveryStatus: RECONCILIATION_INPUT_STATUS.FINDING_ONLY,
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, RECONCILIATION_READINESS_REASON.FINDING_ONLY);
});

test("readiness: CERTIFIED + INPUT_UNAVAILABLE (legacy) is NOT READY", () => {
  const readiness = deriveReconciliationReadiness({
    ...BASE,
    recoveryStatus: RECONCILIATION_INPUT_STATUS.INPUT_UNAVAILABLE,
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, RECONCILIATION_READINESS_REASON.INPUT_UNAVAILABLE);
});

test("readiness: an existing reconciliation decision blocks further reconciliation as ALREADY_RECONCILED, even though input is otherwise available", () => {
  const readiness = deriveReconciliationReadiness({ ...BASE, hasExistingReconciliationDecision: true });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, RECONCILIATION_READINESS_REASON.ALREADY_RECONCILED);
});

test("readiness: an applied materialization takes priority over ALREADY_RECONCILED as ALREADY_MATERIALIZED", () => {
  const readiness = deriveReconciliationReadiness({
    ...BASE,
    hasExistingReconciliationDecision: true,
    isMaterializedApplied: true,
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, RECONCILIATION_READINESS_REASON.ALREADY_MATERIALIZED);
});

test("readiness: NOT_CERTIFIED is checked before any input-recovery reason — certification is the first gate", () => {
  const readiness = deriveReconciliationReadiness({
    ...BASE,
    reviewState: REVIEW_STATE.CONFIRMED,
    recoveryStatus: RECONCILIATION_INPUT_STATUS.FINDING_ONLY,
    hasExistingReconciliationDecision: true,
    isMaterializedApplied: true,
  });
  assert.equal(readiness.reason, RECONCILIATION_READINESS_REASON.NOT_CERTIFIED);
});
