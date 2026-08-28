import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  findRoleByCode,
  resolveRoleCodesByIds,
  RolesRepositoryError,
} from "./roles";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const AUDITOR_ID = "22222222-2222-4222-8222-222222222222";
const ORPHAN_ID = "33333333-3333-4333-8333-333333333333";

describe("legacy governance roles repository", () => {
  it("finds GOVERNANCE_ADMIN by exact role code", async () => {
    let requestedCode: string | undefined;
    const queries = queryStub({
      findByCode: async (roleCode) => {
        requestedCode = roleCode;
        return success([
          {
            role_id: ADMIN_ID,
            role_code: "GOVERNANCE_ADMIN",
            role_name: "Ignored name",
            permissions: ["ignored.permission"],
          },
        ]);
      },
    });

    const role = await findRoleByCode("GOVERNANCE_ADMIN", queries);

    assert.equal(requestedCode, "GOVERNANCE_ADMIN");
    assert.deepEqual(role, {
      roleId: ADMIN_ID,
      roleCode: "GOVERNANCE_ADMIN",
    });
  });

  it("returns null when GOVERNANCE_ADMIN is absent", async () => {
    const role = await findRoleByCode(
      "GOVERNANCE_ADMIN",
      queryStub({ findByCode: async () => success([]) })
    );

    assert.equal(role, null);
  });

  it("does not turn a technical find error into absence", async () => {
    await assert.rejects(
      () =>
        findRoleByCode(
          "GOVERNANCE_ADMIN",
          queryStub({ findByCode: async () => failure() })
        ),
      RolesRepositoryError
    );
  });

  it("fails closed if a supposedly unique role code is ambiguous", async () => {
    await assert.rejects(
      () =>
        findRoleByCode(
          "GOVERNANCE_ADMIN",
          queryStub({
            findByCode: async () =>
              success([
                { role_id: ADMIN_ID, role_code: "GOVERNANCE_ADMIN" },
                { role_id: AUDITOR_ID, role_code: "GOVERNANCE_ADMIN" },
              ]),
          })
        ),
      RolesRepositoryError
    );
  });

  it("resolves a valid UUID to its role code", async () => {
    const codes = await resolveRoleCodesByIds(
      [ADMIN_ID],
      queryStub({
        findByIds: async () =>
          success([{ role_id: ADMIN_ID, role_code: "GOVERNANCE_ADMIN" }]),
      })
    );

    assert.deepEqual(codes, ["GOVERNANCE_ADMIN"]);
  });

  it("resolves multiple UUIDs to deterministic role codes", async () => {
    const codes = await resolveRoleCodesByIds(
      [AUDITOR_ID, ADMIN_ID],
      queryStub({
        findByIds: async () =>
          success([
            { role_id: AUDITOR_ID, role_code: "AUDITOR" },
            { role_id: ADMIN_ID, role_code: "GOVERNANCE_ADMIN" },
          ]),
      })
    );

    assert.deepEqual(codes, ["AUDITOR", "GOVERNANCE_ADMIN"]);
  });

  it("ignores an orphan UUID and returns only found role codes", async () => {
    const codes = await resolveRoleCodesByIds(
      [ADMIN_ID, ORPHAN_ID],
      queryStub({
        findByIds: async () =>
          success([{ role_id: ADMIN_ID, role_code: "GOVERNANCE_ADMIN" }]),
      })
    );

    assert.deepEqual(codes, ["GOVERNANCE_ADMIN"]);
  });

  it("returns an empty list when every UUID is orphaned", async () => {
    const codes = await resolveRoleCodesByIds(
      [ORPHAN_ID],
      queryStub({ findByIds: async () => success([]) })
    );

    assert.deepEqual(codes, []);
  });

  it("deduplicates UUIDs before querying and role codes before returning", async () => {
    let requestedIds: readonly string[] = [];
    const codes = await resolveRoleCodesByIds(
      [ADMIN_ID, ADMIN_ID],
      queryStub({
        findByIds: async (roleIds) => {
          requestedIds = roleIds;
          return success([
            { role_id: ADMIN_ID, role_code: "GOVERNANCE_ADMIN" },
            { role_id: ADMIN_ID, role_code: "GOVERNANCE_ADMIN" },
          ]);
        },
      })
    );

    assert.deepEqual(requestedIds, [ADMIN_ID]);
    assert.deepEqual(codes, ["GOVERNANCE_ADMIN"]);
  });

  it("fails closed on a technical role resolution error", async () => {
    await assert.rejects(
      () =>
        resolveRoleCodesByIds(
          [ADMIN_ID],
          queryStub({ findByIds: async () => failure() })
        ),
      RolesRepositoryError
    );
  });

  it("does not use role_name, permissions, or a hard-coded admin UUID", async () => {
    const source = await readFile(new URL("./roles.ts", import.meta.url), "utf8");

    assert.doesNotMatch(source, /role_name/);
    assert.doesNotMatch(source, /permissions/);
    assert.doesNotMatch(
      source,
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
    );
  });
});

function queryStub(overrides: {
  findByCode?: (roleCode: string) => Promise<QueryResult>;
  findByIds?: (roleIds: readonly string[]) => Promise<QueryResult>;
} = {}) {
  return {
    findByCode: overrides.findByCode ?? (async () => success([])),
    findByIds: overrides.findByIds ?? (async () => success([])),
  };
}

interface QueryResult {
  data: unknown;
  error: unknown | null;
}

function success(data: unknown): QueryResult {
  return { data, error: null };
}

function failure(): QueryResult {
  return { data: null, error: { message: "technical database failure" } };
}
