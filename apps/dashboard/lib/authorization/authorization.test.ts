import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import type { AuthContext } from "@/types/auth";
import {
  AuthenticationRequiredError,
  createRequireAuth,
  PERMISSIONS,
  PermissionDeniedError,
  requirePermission,
} from "./index";
import { LegacyRoleAuthorizationAdapter } from "./legacy-role-authorization-adapter";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANISATION_ID = "22222222-2222-4222-8222-222222222222";
const APPROVED_PERMISSIONS = [
  "portfolio:read",
  "agents:read",
  "agents:write",
  "agents:assess",
  "systems:read",
  "systems:write",
  "systems:assess",
  "ownership:assign",
  "discovery:read",
  "discovery:execute",
  "discovery:review",
  "audit:read",
  "reports:read",
  "graph:read",
  "governance:query",
] as const;

describe("authorization kernel", () => {
  const adapter = new LegacyRoleAuthorizationAdapter();

  it("requireAuth returns a valid AuthContext", async () => {
    const context = legacyContext("org_admin");
    const requireAuth = createRequireAuth(async () => context);

    assert.equal(await requireAuth(), context);
  });

  it("requireAuth throws AuthenticationRequiredError without a context", async () => {
    const requireAuth = createRequireAuth(async () => null);

    await assert.rejects(requireAuth, AuthenticationRequiredError);
  });

  it("grants org_admin exactly the 15 approved permissions", async () => {
    const permissions = await adapter.permissionsFor(legacyContext("org_admin"));

    assert.deepEqual(sorted(PERMISSIONS), sorted(APPROVED_PERMISSIONS));
    assert.equal(permissions.size, 15);
    assert.deepEqual(sorted(permissions), sorted(APPROVED_PERMISSIONS));
  });

  it("grants user exactly the four provisional read permissions", async () => {
    const permissions = await adapter.permissionsFor(legacyContext("user"));

    assert.deepEqual(sorted(permissions), [
      "agents:read",
      "graph:read",
      "portfolio:read",
      "systems:read",
    ]);
  });

  it("grants an unknown role zero permissions", async () => {
    const permissions = await adapter.permissionsFor(legacyContext("unknown"));

    assert.equal(permissions.size, 0);
  });

  it("grants super_admin zero permissions", async () => {
    const permissions = await adapter.permissionsFor(legacyContext("super_admin"));

    assert.equal(permissions.size, 0);
  });

  it("grants a non-LEGACY source zero permissions", async () => {
    const context = {
      ...legacyContext("org_admin"),
      role: { source: "RBAC", value: "org_admin" },
    } as unknown as AuthContext;

    const permissions = await adapter.permissionsFor(context);
    assert.equal(permissions.size, 0);
  });

  it("allows a permission present in the central policy", async () => {
    await assert.doesNotReject(() =>
      requirePermission(legacyContext("user"), "agents:read")
    );
  });

  it("throws PermissionDeniedError for an absent permission", async () => {
    await assert.rejects(
      () => requirePermission(legacyContext("user"), "agents:write"),
      PermissionDeniedError
    );
  });

  it("contains no wildcard permission and has no role fallback", async () => {
    assert.equal(PERMISSIONS.some((permission) => permission.includes("*")), false);
    assert.equal(
      (await adapter.permissionsFor(legacyContext("not-configured"))).size,
      0
    );
  });

  it("does not import a database or query governance_roles", async () => {
    const source = await readFile(
      new URL("./legacy-role-authorization-adapter.ts", import.meta.url),
      "utf8"
    );

    assert.doesNotMatch(source, /from\s+["']@\/lib\/db["']/);
    assert.doesNotMatch(source, /from\s+["']@\/repositories\//);
    assert.doesNotMatch(
      source,
      /\.from\(\s*["']governance_roles["']\s*\)/
    );
  });
});

function legacyContext(role: string): AuthContext {
  return {
    userId: USER_ID,
    organisationId: ORGANISATION_ID,
    email: "user@example.com",
    role: { source: "LEGACY", value: role },
  };
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}
