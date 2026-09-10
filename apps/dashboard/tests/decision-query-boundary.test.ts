import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// decision-query.ts / canonical-object-lookup.ts transitively import
// lib/governance/persistence.ts, which reads SUPABASE_URL/
// SUPABASE_SERVICE_ROLE_KEY at module-load time — dynamic import inside
// before() matches this repo's established convention (see
// workspace-query.test.ts).
let availableOutcomesFor: typeof import("@/lib/governance/decision-query").availableOutcomesFor;

before(async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  ({ availableOutcomesFor } = await import("@/lib/governance/decision-query"));
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertEveryQueryFiltersByOrganisation(source: string, minimumQueries: number) {
  const fromCalls = [...source.matchAll(/privilegedDb\s*\n?\s*\.from\("(\w+)"\)([\s\S]*?);/g)];
  assert.ok(fromCalls.length >= minimumQueries, `expected at least ${minimumQueries} privilegedDb.from(...) queries`);
  for (const match of fromCalls) {
    const [, table, chain] = match;
    assert.match(chain, /\.eq\("organisation_id", organisationId\)/, `query against ${table} must filter by organisation_id`);
  }
}

test("boundary: lib/governance/decision-query.ts is marked server-only and every query filters by organisation_id", () => {
  const source = readSource("lib/governance/decision-query.ts");
  assert.match(source.trimStart(), /^import "server-only";/);
  assertEveryQueryFiltersByOrganisation(source, 2);
});

test("boundary: lib/governance/canonical-object-lookup.ts is marked server-only and every query filters by organisation_id", () => {
  const source = readSource("lib/governance/canonical-object-lookup.ts");
  assert.match(source.trimStart(), /^import "server-only";/);
  assertEveryQueryFiltersByOrganisation(source, 2);
});

test("boundary: canonical-object-lookup.ts additionally scopes every list/get query by kind — a MODEL lookup can never return a TOOL", () => {
  const source = readSource("lib/governance/canonical-object-lookup.ts");
  const fromCalls = [...source.matchAll(/privilegedDb\s*\n?\s*\.from\("canonical_objects"\)([\s\S]*?);/g)];
  assert.ok(fromCalls.length >= 2);
  for (const [, chain] of fromCalls) {
    assert.match(chain, /\.eq\("kind", kind\)/);
  }
});

test("availableOutcomesFor: relationship outcomes use the existing vocabulary; query applies exact endpoint readiness", () => {
  assert.deepEqual(availableOutcomesFor("RELATIONSHIP"), ["CREATE_NEW", "MATCH_EXISTING", "REJECT", "DEFER"]);
  const source = readSource("lib/governance/decision-query.ts");
  assert.match(source, /listExactRelationshipMatches/);
  assert.match(source, /availableOutcomes = \["REJECT", "DEFER"\]/);
});

test("availableOutcomesFor: every non-RELATIONSHIP object kind offers the full outcome set", () => {
  for (const kind of ["MODEL", "TOOL", "AGENT", "API", "PROMPT"] as const) {
    assert.deepEqual(availableOutcomesFor(kind), ["CREATE_NEW", "MATCH_EXISTING", "REJECT", "DEFER"]);
  }
});

test("truth boundary: no workspace source file ever writes (insert/update/delete/upsert/rpc) directly to the canonical truth tables — materialization is the only writer, and it lives in materialization.ts", () => {
  const forbiddenTables = /canonical_objects|canonical_relationships|canonical_object_source_mappings/;
  const workspaceFiles = [
    "lib/governance/decision-query.ts",
    "lib/governance/decision-commands.ts",
    "lib/governance/canonical-object-lookup.ts",
    "lib/governance/reconciliation-readiness.ts",
    "lib/governance/reconciliation-authorization-port.ts",
  ];
  for (const file of workspaceFiles) {
    const source = readSource(file);
    const writeCalls = [...source.matchAll(/privilegedDb[\s\S]{0,80}?\.(insert|update|upsert|delete|rpc)\(/g)];
    for (const call of writeCalls) {
      assert.doesNotMatch(
        source.slice(Math.max(0, call.index! - 200), call.index! + 200),
        forbiddenTables,
        `${file} must never write directly to a canonical truth table`,
      );
    }
  }
});
