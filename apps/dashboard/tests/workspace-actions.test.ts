import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

import {
  deriveAllowedGovernanceActions,
  hasGovernanceReviewAuthority,
  NO_ALLOWED_GOVERNANCE_ACTIONS,
} from "@/lib/governance/workspace-actions";
import { REVIEW_STATE } from "@council/governance-review";

test("workspace-actions: an actor without review authority is allowed nothing, regardless of state", () => {
  for (const state of Object.values(REVIEW_STATE)) {
    assert.deepEqual(deriveAllowedGovernanceActions(state, false), NO_ALLOWED_GOVERNANCE_ACTIONS);
  }
});

test("workspace-actions: DETECTED allows only propose (with authority)", () => {
  const allowed = deriveAllowedGovernanceActions(REVIEW_STATE.DETECTED, true);
  assert.deepEqual(allowed, { canPropose: true, canConfirm: false, canCertify: false, canReject: true });
});

test("workspace-actions: PROPOSED allows only confirm and reject (with authority)", () => {
  const allowed = deriveAllowedGovernanceActions(REVIEW_STATE.PROPOSED, true);
  assert.deepEqual(allowed, { canPropose: false, canConfirm: true, canCertify: false, canReject: true });
});

test("workspace-actions: CONFIRMED allows only certify and reject (with authority)", () => {
  const allowed = deriveAllowedGovernanceActions(REVIEW_STATE.CONFIRMED, true);
  assert.deepEqual(allowed, { canPropose: false, canConfirm: false, canCertify: true, canReject: true });
});

test("workspace-actions: CERTIFIED is terminal — no action is ever allowed, even with authority", () => {
  const allowed = deriveAllowedGovernanceActions(REVIEW_STATE.CERTIFIED, true);
  assert.deepEqual(allowed, NO_ALLOWED_GOVERNANCE_ACTIONS);
});

test("workspace-actions: REJECTED is terminal — no action is ever allowed, even with authority", () => {
  const allowed = deriveAllowedGovernanceActions(REVIEW_STATE.REJECTED, true);
  assert.deepEqual(allowed, NO_ALLOWED_GOVERNANCE_ACTIONS);
});

test("workspace-actions: only the verified org_admin session role carries governance review authority", () => {
  assert.equal(hasGovernanceReviewAuthority("org_admin"), true);
  assert.equal(hasGovernanceReviewAuthority("user"), false);
  assert.equal(hasGovernanceReviewAuthority(""), false);
  assert.equal(hasGovernanceReviewAuthority("ORG_ADMIN"), false, "role check must not be case-insensitive to an unverified value");
});
