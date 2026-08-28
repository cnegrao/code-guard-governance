import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  assertLegacyAuthConfigured,
  createLegacySessionResponse,
  getAuthContextFromToken,
} from "@/lib/auth";
import { signLegacyToken } from "@/lib/auth/token";
import {
  executeLegacySignup,
  type LegacySignupDependencies,
  LegacySignupRoleUnavailableError,
} from "./legacy-signup";

const ADMIN_ROLE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ORGANISATION_ID = "33333333-3333-4333-8333-333333333333";

const SIGNUP_INPUT = {
  email: "admin@example.com",
  password: "test-password",
  fullName: "Admin User",
  orgName: "Test Organisation",
  industry: "technology",
};

describe("legacy signup role stabilization", () => {
  it("resolves GOVERNANCE_ADMIN before writes and signs only after persistence", async () => {
    const operations: string[] = [];
    let persistedRoleIds: readonly string[] = [];

    const result = await executeLegacySignup(
      SIGNUP_INPUT,
      dependencies({
        assertAuthConfigured() {
          operations.push("validate-jwt");
        },
        async findRoleByCode(roleCode) {
          operations.push(`find-role:${roleCode}`);
          return { roleId: ADMIN_ROLE_ID, roleCode };
        },
        async createOrg() {
          operations.push("create-org");
          return organisation();
        },
        async createUser(input) {
          operations.push("create-user");
          persistedRoleIds = input.roleIds;
          return user([...input.roleIds]);
        },
        async signToken(payload) {
          operations.push(`sign:${payload.role}`);
          return "server-only-token";
        },
      })
    );

    assert.deepEqual(operations, [
      "validate-jwt",
      "find-role:GOVERNANCE_ADMIN",
      "create-org",
      "create-user",
      "sign:org_admin",
    ]);
    assert.deepEqual(persistedRoleIds, [ADMIN_ROLE_ID]);
    assert.equal(result.token, "server-only-token");
  });

  it("does not create an organisation when GOVERNANCE_ADMIN is absent", async () => {
    let organisationCreated = false;

    await assert.rejects(
      () =>
        executeLegacySignup(
          SIGNUP_INPUT,
          dependencies({
            findRoleByCode: async () => null,
            async createOrg() {
              organisationCreated = true;
              return organisation();
            },
          })
        ),
      LegacySignupRoleUnavailableError
    );

    assert.equal(organisationCreated, false);
  });

  it("does not create an organisation when the role lookup fails technically", async () => {
    let organisationCreated = false;

    await assert.rejects(
      () =>
        executeLegacySignup(
          SIGNUP_INPUT,
          dependencies({
            findRoleByCode: async () => {
              throw new Error("sensitive SQL details");
            },
            async createOrg() {
              organisationCreated = true;
              return organisation();
            },
          })
        ),
      (error: unknown) => {
        assert.ok(error instanceof LegacySignupRoleUnavailableError);
        assert.doesNotMatch(error.message, /SQL|role_id/i);
        return true;
      }
    );

    assert.equal(organisationCreated, false);
  });

  it("fails before writes when the resolved role ID is not a UUID", async () => {
    let organisationCreated = false;

    await assert.rejects(
      () =>
        executeLegacySignup(
          SIGNUP_INPUT,
          dependencies({
            findRoleByCode: async () => ({
              roleId: "not-a-uuid",
              roleCode: "GOVERNANCE_ADMIN",
            }),
            async createOrg() {
              organisationCreated = true;
              return organisation();
            },
          })
        ),
      LegacySignupRoleUnavailableError
    );

    assert.equal(organisationCreated, false);
  });

  it("does not accept a different role code from the lookup result", async () => {
    let organisationCreated = false;

    await assert.rejects(
      () =>
        executeLegacySignup(
          SIGNUP_INPUT,
          dependencies({
            findRoleByCode: async () => ({
              roleId: ADMIN_ROLE_ID,
              roleCode: "AUDITOR",
            }),
            async createOrg() {
              organisationCreated = true;
              return organisation();
            },
          })
        ),
      LegacySignupRoleUnavailableError
    );

    assert.equal(organisationCreated, false);
  });

  it("does not sign org_admin unless the persisted user confirms the admin role", async () => {
    let tokenSigned = false;

    await assert.rejects(
      () =>
        executeLegacySignup(
          SIGNUP_INPUT,
          dependencies({
            createUser: async () => user([]),
            async signToken() {
              tokenSigned = true;
              return "must-not-be-issued";
            },
          })
        ),
      LegacySignupRoleUnavailableError
    );

    assert.equal(tokenSigned, false);
  });

  it("keeps the JWT LEGACY and the signup JSON free of the token", async () => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-only-legacy-signup-secret";

    try {
      const result = await executeLegacySignup(
        SIGNUP_INPUT,
        dependencies({
          assertAuthConfigured: assertLegacyAuthConfigured,
          signToken: signLegacyToken,
        })
      );
      const context = await getAuthContextFromToken(result.token);
      const response = createLegacySessionResponse(result, 201);
      const body = await response.json();

      assert.equal(context?.role.source, "LEGACY");
      assert.equal(context?.role.value, "org_admin");
      assert.equal(response.status, 201);
      assert.deepEqual(body, { session: result.session });
      assert.equal("token" in body, false);
      assert.equal("token" in body.session, false);
      assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });

  it("uses no role name, permissions, or hard-coded administrative UUID", async () => {
    const signupSource = await readFile(
      new URL("./legacy-signup.ts", import.meta.url),
      "utf8"
    );
    const usersSource = await readFile(
      new URL("../repositories/users.ts", import.meta.url),
      "utf8"
    );

    assert.match(signupSource, /findRoleByCode\(GOVERNANCE_ADMIN_ROLE_CODE\)/);
    assert.doesNotMatch(signupSource, /role_name|permissions/);
    assert.doesNotMatch(
      signupSource,
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
    );
    assert.match(usersSource, /role_ids:\s*\[\.\.\.input\.roleIds\]/);
    assert.doesNotMatch(usersSource, /role_ids:\s*\[\]/);
  });

  it("keeps the stabilized signup wiring unchanged", async () => {
    const source = await readFile(new URL("./auth.ts", import.meta.url), "utf8");

    assert.match(
      source,
      /return executeLegacySignup\(input, \{[\s\S]*assertAuthConfigured: assertLegacyAuthConfigured,[\s\S]*findRoleByCode,[\s\S]*createOrg: orgRepo\.createOrg,[\s\S]*createUser: userRepo\.createUser,[\s\S]*signToken: signLegacyToken,[\s\S]*\}\);/
    );
  });
});

function dependencies(
  overrides: Partial<LegacySignupDependencies> = {}
): LegacySignupDependencies {
  return {
    assertAuthConfigured() {},
    findRoleByCode: async () => ({
      roleId: ADMIN_ROLE_ID,
      roleCode: "GOVERNANCE_ADMIN",
    }),
    createOrg: async () => organisation(),
    createUser: async (input) => user([...input.roleIds]),
    signToken: async () => "server-only-token",
    ...overrides,
  };
}

function organisation() {
  return {
    organisation_id: ORGANISATION_ID,
    name: SIGNUP_INPUT.orgName,
    code: "TEST_ORGANISATION",
    external_refs: { industry_profile: SIGNUP_INPUT.industry },
  };
}

function user(roleIds: string[]) {
  return {
    user_id: USER_ID,
    email: SIGNUP_INPUT.email,
    full_name: SIGNUP_INPUT.fullName,
    organisation_id: ORGANISATION_ID,
    status: "active",
    role_ids: roleIds,
  };
}
