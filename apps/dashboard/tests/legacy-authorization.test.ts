import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLegacyJwtRole,
  resolveRoleSetFailClosed,
  createLegacyAuthAdapter,
  JWT_ROLE_ORG_ADMIN,
  JWT_ROLE_USER,
} from "../lib/auth/legacy-authorization";

test("authz: GOVERNANCE_ADMIN + is_system_role=true elevates to org_admin", () => {
  const role = resolveLegacyJwtRole([{ role_code: "GOVERNANCE_ADMIN", is_system_role: true }]);
  assert.equal(role, JWT_ROLE_ORG_ADMIN);
});

test("authz: GOVERNANCE_ADMIN + is_system_role=false does NOT elevate", () => {
  const role = resolveLegacyJwtRole([{ role_code: "GOVERNANCE_ADMIN", is_system_role: false }]);
  assert.equal(role, JWT_ROLE_USER);
});

test("authz: lowercase/case variants of the role code do NOT elevate", () => {
  const role = resolveLegacyJwtRole([{ role_code: "governance_admin", is_system_role: true }]);
  assert.equal(role, JWT_ROLE_USER);
});

test("authz: AUDITOR/DPO/CISO system roles do NOT elevate", () => {
  for (const code of ["AUDITOR", "DPO", "CISO"]) {
    const role = resolveLegacyJwtRole([{ role_code: code, is_system_role: true }]);
    assert.equal(role, JWT_ROLE_USER, `expected ${code} to not elevate`);
  }
});

test("authz: unknown/orphan role fails closed to non-admin", () => {
  const role = resolveLegacyJwtRole([{ role_code: "UNKNOWN_ROLE", is_system_role: true }]);
  assert.equal(role, JWT_ROLE_USER);
});

test("authz: empty role list fails closed to non-admin", () => {
  assert.equal(resolveLegacyJwtRole([]), JWT_ROLE_USER);
});

test("authz: no role_ids.length elevation — empty roleIdsFromUser fails closed", () => {
  const resolved = resolveRoleSetFailClosed({
    roleIdsFromUser: [],
    resolvedRoles: [{ role_id: "r1", role_code: "GOVERNANCE_ADMIN", is_system_role: true }],
  });
  assert.equal(resolved.jwtRole, JWT_ROLE_USER);
  assert.deepEqual(resolved.roleCodes, []);
});

test("authz: requested role id not present in resolved roles fails closed (orphan id)", () => {
  const resolved = resolveRoleSetFailClosed({
    roleIdsFromUser: ["missing-id"],
    resolvedRoles: [{ role_id: "r1", role_code: "GOVERNANCE_ADMIN", is_system_role: true }],
  });
  assert.equal(resolved.jwtRole, JWT_ROLE_USER);
  assert.deepEqual(resolved.roleCodes, []);
});

test("authz: fully resolved GOVERNANCE_ADMIN system role elevates end-to-end", () => {
  const resolved = resolveRoleSetFailClosed({
    roleIdsFromUser: ["r1"],
    resolvedRoles: [{ role_id: "r1", role_code: "GOVERNANCE_ADMIN", is_system_role: true }],
  });
  assert.equal(resolved.jwtRole, JWT_ROLE_ORG_ADMIN);
});

test("authz: a non-system role reusing the GOVERNANCE_ADMIN code string does not elevate (no wildcard/spoof)", () => {
  const resolved = resolveRoleSetFailClosed({
    roleIdsFromUser: ["r1"],
    resolvedRoles: [{ role_id: "r1", role_code: "GOVERNANCE_ADMIN", is_system_role: false }],
  });
  assert.equal(resolved.jwtRole, JWT_ROLE_USER);
});

test("authz adapter: isSystemAdmin() requires the same verified elevation as jwtRole", () => {
  const spoofedAdapter = createLegacyAuthAdapter(["r1"], [
    { role_id: "r1", role_code: "GOVERNANCE_ADMIN", is_system_role: false },
  ]);
  assert.equal(spoofedAdapter.isSystemAdmin(), false);
  assert.equal(spoofedAdapter.hasAnyElevatedRole(), false);

  const verifiedAdapter = createLegacyAuthAdapter(["r1"], [
    { role_id: "r1", role_code: "GOVERNANCE_ADMIN", is_system_role: true },
  ]);
  assert.equal(verifiedAdapter.isSystemAdmin(), true);
  assert.equal(verifiedAdapter.hasAnyElevatedRole(), true);
});

test("authz: no wildcard authorization — hasPermission only matches concrete or explicit '*' segments granted", () => {
  const adapter = createLegacyAuthAdapter(["r1"], [
    {
      role_id: "r1",
      role_code: "AUDITOR",
      is_system_role: true,
      permissions: ["audit.findings.read"],
    },
  ]);
  assert.equal(adapter.hasPermission("audit", "findings", "read"), true);
  assert.equal(adapter.hasPermission("audit", "findings", "write"), false);
  assert.equal(adapter.hasPermission("billing", "invoices", "read"), false);
});
