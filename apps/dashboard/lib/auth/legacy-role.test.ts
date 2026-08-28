import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLegacyJwtRole } from "./legacy-role";

const NON_ADMIN_GOVERNANCE_ROLES = [
  "AUDITOR",
  "DPO",
  "CISO",
  "REGULATOR_VIEW",
  "POLICY_APPROVER",
  "POLICY_OWNER",
  "RISK_MANAGER",
  "EVIDENCE_CURATOR",
  "CONTROL_ASSESSOR",
  "L1_APPROVER",
  "L2_APPROVER",
  "L3_APPROVER",
] as const;

describe("legacy JWT role resolver", () => {
  it("maps an empty role collection to user", () => {
    assert.equal(resolveLegacyJwtRole([]), "user");
  });

  it("maps null to user", () => {
    assert.equal(resolveLegacyJwtRole(null), "user");
  });

  it("maps undefined to user", () => {
    assert.equal(resolveLegacyJwtRole(undefined), "user");
  });

  it("maps exact GOVERNANCE_ADMIN to org_admin", () => {
    assert.equal(resolveLegacyJwtRole(["GOVERNANCE_ADMIN"]), "org_admin");
  });

  it("treats a string iterable as one exact role code", () => {
    assert.equal(resolveLegacyJwtRole("GOVERNANCE_ADMIN"), "org_admin");
    assert.equal(resolveLegacyJwtRole("AUDITOR"), "user");
  });

  for (const roleCode of NON_ADMIN_GOVERNANCE_ROLES) {
    it(`maps ${roleCode} to user`, () => {
      assert.equal(resolveLegacyJwtRole([roleCode]), "user");
    });
  }

  it("maps an unknown role and UUID string to user", () => {
    assert.equal(resolveLegacyJwtRole(["UNKNOWN_ROLE"]), "user");
    assert.equal(
      resolveLegacyJwtRole(["11111111-1111-4111-8111-111111111111"]),
      "user"
    );
  });

  it("maps multiple non-admin roles to user", () => {
    assert.equal(resolveLegacyJwtRole(["AUDITOR", "DPO"]), "user");
  });

  it("maps multiple roles containing GOVERNANCE_ADMIN to org_admin", () => {
    assert.equal(
      resolveLegacyJwtRole(["AUDITOR", "GOVERNANCE_ADMIN"]),
      "org_admin"
    );
  });

  it("is unaffected by duplicate GOVERNANCE_ADMIN entries", () => {
    assert.equal(
      resolveLegacyJwtRole(["GOVERNANCE_ADMIN", "GOVERNANCE_ADMIN"]),
      "org_admin"
    );
  });

  it("does not elevate case or formatting variants", () => {
    assert.equal(resolveLegacyJwtRole(["governance_admin"]), "user");
    assert.equal(resolveLegacyJwtRole(["Governance_Admin"]), "user");
    assert.equal(resolveLegacyJwtRole(["GOVERNANCE ADMIN"]), "user");
  });

  it("does not elevate the role name", () => {
    assert.equal(resolveLegacyJwtRole(["Governance Administrator"]), "user");
  });

  it("supports a generic iterable without changing matching semantics", () => {
    assert.equal(
      resolveLegacyJwtRole(new Set(["AUDITOR", "GOVERNANCE_ADMIN"])),
      "org_admin"
    );
  });
});
