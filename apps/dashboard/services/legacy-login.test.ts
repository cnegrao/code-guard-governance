import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { getAuthContextFromToken } from "@/lib/auth";
import { resolveLegacyJwtRole } from "@/lib/auth/legacy-role";
import { signLegacyToken } from "@/lib/auth/token";
import {
  executeLegacyLogin,
  type LegacyLoginDependencies,
  LegacyLoginRoleResolutionError,
} from "./legacy-login";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANISATION_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ROLE_ID = "33333333-3333-4333-8333-333333333333";
const AUDITOR_ROLE_ID = "44444444-4444-4444-8444-444444444444";
const DPO_ROLE_ID = "55555555-5555-4555-8555-555555555555";
const ORPHAN_ROLE_ID = "66666666-6666-4666-8666-666666666666";

describe("legacy login role stabilization", () => {
  it("executes authentication and role resolution in the required order", async () => {
    const operations: string[] = [];

    await executeLegacyLogin(
      "user@example.com",
      "password",
      dependencies({
        async findUserByEmail() {
          operations.push("find-user");
          return user([ADMIN_ROLE_ID]);
        },
        async verifyPassword() {
          operations.push("verify-password");
          return true;
        },
        async getOrg() {
          operations.push("get-org");
          return organisation();
        },
        async resolveRoleCodesByIds() {
          operations.push("resolve-role-codes");
          return ["GOVERNANCE_ADMIN"];
        },
        resolveLegacyJwtRole(roleCodes) {
          operations.push("resolve-jwt-role");
          return resolveLegacyJwtRole(roleCodes);
        },
        async signToken() {
          operations.push("sign-token");
          return "server-only-token";
        },
      })
    );

    assert.deepEqual(operations, [
      "find-user",
      "verify-password",
      "get-org",
      "resolve-role-codes",
      "resolve-jwt-role",
      "sign-token",
    ]);
  });

  const mappingCases: Array<{
    name: string;
    roleIds: string[];
    roleCodes: string[];
    expected: "org_admin" | "user";
  }> = [
    {
      name: "maps empty role_ids to user",
      roleIds: [],
      roleCodes: [],
      expected: "user",
    },
    {
      name: "maps a valid GOVERNANCE_ADMIN to org_admin",
      roleIds: [ADMIN_ROLE_ID],
      roleCodes: ["GOVERNANCE_ADMIN"],
      expected: "org_admin",
    },
    {
      name: "maps AUDITOR to user",
      roleIds: [AUDITOR_ROLE_ID],
      roleCodes: ["AUDITOR"],
      expected: "user",
    },
    {
      name: "maps DPO to user",
      roleIds: [DPO_ROLE_ID],
      roleCodes: ["DPO"],
      expected: "user",
    },
    {
      name: "maps CISO to user",
      roleIds: [AUDITOR_ROLE_ID],
      roleCodes: ["CISO"],
      expected: "user",
    },
    {
      name: "maps REGULATOR_VIEW to user",
      roleIds: [AUDITOR_ROLE_ID],
      roleCodes: ["REGULATOR_VIEW"],
      expected: "user",
    },
    {
      name: "maps POLICY_APPROVER to user",
      roleIds: [AUDITOR_ROLE_ID],
      roleCodes: ["POLICY_APPROVER"],
      expected: "user",
    },
    {
      name: "ignores an orphan UUID and maps no resolved role to user",
      roleIds: [ORPHAN_ROLE_ID],
      roleCodes: [],
      expected: "user",
    },
    {
      name: "maps multiple roles containing GOVERNANCE_ADMIN to org_admin",
      roleIds: [AUDITOR_ROLE_ID, ADMIN_ROLE_ID],
      roleCodes: ["AUDITOR", "GOVERNANCE_ADMIN"],
      expected: "org_admin",
    },
    {
      name: "maps multiple roles without GOVERNANCE_ADMIN to user",
      roleIds: [AUDITOR_ROLE_ID, DPO_ROLE_ID],
      roleCodes: ["AUDITOR", "DPO"],
      expected: "user",
    },
  ];

  for (const mappingCase of mappingCases) {
    it(mappingCase.name, async () => {
      assert.equal(
        await issuedRoleFor(mappingCase.roleIds, mappingCase.roleCodes),
        mappingCase.expected
      );
    });
  }

  it("keeps every other governance role at user", async () => {
    const otherRoleCodes = [
      "POLICY_OWNER",
      "RISK_MANAGER",
      "EVIDENCE_CURATOR",
      "CONTROL_ASSESSOR",
      "L1_APPROVER",
      "L2_APPROVER",
      "L3_APPROVER",
    ];

    assert.equal(
      await issuedRoleFor([AUDITOR_ROLE_ID], otherRoleCodes),
      "user"
    );
  });

  it("does not infer org_admin merely from non-empty role_ids", async () => {
    assert.equal(
      await issuedRoleFor([AUDITOR_ROLE_ID], ["AUDITOR"]),
      "user"
    );
  });

  it("fails closed and emits no JWT when role resolution fails technically", async () => {
    let tokenSigned = false;

    await assert.rejects(
      () =>
        executeLegacyLogin(
          "user@example.com",
          "password",
          dependencies({
            resolveRoleCodesByIds: async () => {
              throw new Error("sensitive SQL and UUID details");
            },
            async signToken() {
              tokenSigned = true;
              return "must-not-be-issued";
            },
          })
        ),
      (error: unknown) => {
        assert.ok(error instanceof LegacyLoginRoleResolutionError);
        assert.doesNotMatch(error.message, /SQL|UUID|database/i);
        return true;
      }
    );

    assert.equal(tokenSigned, false);
  });

  it("keeps the emitted authentication context marked LEGACY", async () => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-only-legacy-login-secret";

    try {
      const result = await executeLegacyLogin(
        "user@example.com",
        "password",
        dependencies({
          findUserByEmail: async () => user([ADMIN_ROLE_ID]),
          resolveRoleCodesByIds: async () => ["GOVERNANCE_ADMIN"],
          signToken: signLegacyToken,
        })
      );
      const context = await getAuthContextFromToken(result.token);

      assert.equal(context?.role.source, "LEGACY");
      assert.equal(context?.role.value, "org_admin");
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });

  it("does not use role_ids length or non-canonical role attributes", async () => {
    const source = await readFile(
      new URL("./legacy-login.ts", import.meta.url),
      "utf8"
    );

    assert.doesNotMatch(source, /role_ids\??\.length|roleIds\??\.length/);
    assert.doesNotMatch(
      source,
      /role_name|permissions|role_tier|is_system_role/i
    );
  });

  it("maps role-resolution failures to a sanitized 503 response", async () => {
    const routeSource = await readFile(
      new URL("../app/api/auth/login/route.ts", import.meta.url),
      "utf8"
    );

    assert.match(routeSource, /LegacyLoginRoleResolutionError/);
    assert.match(routeSource, /Authentication unavailable/);
    assert.match(routeSource, /status:\s*503/);
  });
});

async function issuedRoleFor(
  roleIds: string[],
  roleCodes: string[]
): Promise<"org_admin" | "user"> {
  let issuedRole: "org_admin" | "user" | undefined;

  await executeLegacyLogin(
    "user@example.com",
    "password",
    dependencies({
      findUserByEmail: async () => user(roleIds),
      async resolveRoleCodesByIds(receivedRoleIds) {
        assert.deepEqual(receivedRoleIds, roleIds);
        return roleCodes;
      },
      async signToken(payload) {
        assert.ok(payload.role === "org_admin" || payload.role === "user");
        issuedRole = payload.role;
        return "server-only-token";
      },
    })
  );

  assert.ok(issuedRole);
  return issuedRole;
}

function dependencies(
  overrides: Partial<LegacyLoginDependencies> = {}
): LegacyLoginDependencies {
  return {
    findUserByEmail: async () => user([]),
    verifyPassword: async () => true,
    getOrg: async () => organisation(),
    resolveRoleCodesByIds: async () => [],
    resolveLegacyJwtRole,
    signToken: async () => "server-only-token",
    ...overrides,
  };
}

function user(roleIds: string[]) {
  return {
    user_id: USER_ID,
    email: "user@example.com",
    full_name: "Test User",
    organisation_id: ORGANISATION_ID,
    status: "active",
    role_ids: roleIds,
    external_id: "bcrypt:test-only",
  };
}

function organisation() {
  return {
    organisation_id: ORGANISATION_ID,
    name: "Test Organisation",
    code: "TEST_ORGANISATION",
    external_refs: { industry_profile: "technology" },
  };
}
