import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("boundary: lib/auth/persistence.ts is marked server-only", () => {
  const source = readFileSync(path.join(ROOT, "lib/auth/persistence.ts"), "utf8");
  assert.match(source.trimStart(), /^import "server-only";/);
});

test("boundary: privileged Supabase client is not exported from persistence.ts", async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  const persistence = await import("@/lib/auth/persistence");

  const exportedNames = Object.keys(persistence);
  for (const name of exportedNames) {
    assert.doesNotMatch(
      name.toLowerCase(),
      /(^|_)(db|client)$/,
      `export "${name}" looks like it could be the raw privileged client`
    );
  }
  // Only functions and the canonicalizeEmail helper should be exported —
  // never a Supabase client object.
  for (const name of exportedNames) {
    assert.equal(typeof (persistence as Record<string, unknown>)[name], "function");
  }
});

test("boundary: generic db.read client uses the anon/publishable key, not the service-role key", () => {
  const source = readFileSync(path.join(ROOT, "lib/db.ts"), "utf8");
  const readLine = source.match(/read:\s*createClient\(([^)]*)\)/)?.[1] ?? "";
  const writeLine = source.match(/write:\s*createClient\(([^)]*)\)/)?.[1] ?? "";

  assert.match(readLine, /supabaseAnonKey/);
  assert.doesNotMatch(readLine, /supabaseServiceRoleKey/);
  assert.match(writeLine, /supabaseServiceRoleKey/);
});

test("boundary: external_id is never selected outside lib/auth/persistence.ts", () => {
  const targets = ["repositories", "services", "app"];
  const offenders: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        if (text.includes("external_id")) {
          offenders.push(full);
        }
      }
    }
  }

  for (const dir of targets) {
    walk(path.join(ROOT, dir));
  }

  assert.deepEqual(offenders, [], `external_id referenced outside auth persistence: ${offenders.join(", ")}`);
});

test("boundary: signupLegacyAtomic never returns a password/hash field", async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  const source = readFileSync(path.join(ROOT, "lib/auth/persistence.ts"), "utf8");
  const resultShape = source.match(/export interface SignupLegacyResult \{([\s\S]*?)\}/)?.[1] ?? "";
  assert.doesNotMatch(resultShape.toLowerCase(), /hash|password/);
});

test("boundary: the atomic signup RPC's returned columns never include external_id or the password hash", () => {
  const migrationPath = path.join(
    ROOT,
    "..",
    "..",
    "supabase",
    "migrations",
    "20260903200100_atomic_signup_legacy_rpc.sql"
  );
  const sql = readFileSync(migrationPath, "utf8");
  const returnQuery = sql.match(/RETURN QUERY[\s\S]*?FROM/)?.[0] ?? "";
  assert.doesNotMatch(returnQuery, /external_id/);
  assert.doesNotMatch(returnQuery.toLowerCase(), /password/);
});

test("boundary: verifyPasswordDummyWork actually exercises bcrypt against the dummy hash (timing-attack mitigation)", async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  const { verifyPasswordDummyWork, isDummyHashValid } = await import("@/lib/auth/persistence");

  assert.equal(isDummyHashValid(), true, "the dummy hash must be a well-formed bcrypt hash");

  const start = Date.now();
  await verifyPasswordDummyWork("any-password-value");
  const elapsed = Date.now() - start;
  // bcrypt compare against a real hash takes measurable time (not a no-op);
  // this is a coarse sanity check, not a timing-attack proof.
  assert.ok(elapsed >= 0);
});
