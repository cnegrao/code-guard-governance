import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { asIsoTimestamp } from "@council/canonical-contracts";

// workspace-query.ts transitively imports lib/governance/persistence.ts, which
// reads SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY at module-load time. A static
// top-level import would run that module body before this file's own env-var
// setup, so this must be a dynamic import inside `before()` (see
// governance-persistence-boundary.test.ts for the established convention).
let presentEvidence: typeof import("@/lib/governance/workspace-query").presentEvidence;
let escapeIlikeTerm: typeof import("@/lib/governance/workspace-query").escapeIlikeTerm;

before(async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  ({ presentEvidence, escapeIlikeTerm } = await import("@/lib/governance/workspace-query"));
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = path.join(ROOT, "lib/governance/workspace-query.ts");

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("boundary: lib/governance/workspace-query.ts is marked server-only", () => {
  assert.match(readSource().trimStart(), /^import "server-only";/);
});

test("boundary: every gov_repo query in this module explicitly filters by organisation_id — the privileged client bypasses RLS as service_role, so this filter is the actual tenant boundary", () => {
  const source = readSource();
  const fromCalls = [...source.matchAll(/privilegedDb\s*\n?\s*\.from\("(\w+)"\)([\s\S]*?);/g)];
  assert.ok(fromCalls.length >= 5, "expected multiple privilegedDb.from(...) queries in this module");
  for (const match of fromCalls) {
    const [, table, chain] = match;
    assert.match(chain, /\.eq\("organisation_id", organisationId\)/, `query against ${table} must filter by organisation_id`);
  }
});

test("boundary: the queue query orders by triage_rank before detected_at, so items needing human attention always sort first", () => {
  const source = readSource();
  const triageIndex = source.indexOf('.order("triage_rank"');
  const detectedIndex = source.indexOf('.order("detected_at"');
  assert.ok(triageIndex > -1 && detectedIndex > -1);
  assert.ok(triageIndex < detectedIndex, "triage_rank must be the primary sort key, detected_at secondary");
});

test("boundary: queue pagination is bounded — page size is clamped to REVIEW_QUEUE_MAX_PAGE_SIZE regardless of caller input", () => {
  const source = readSource();
  assert.match(source, /Math\.min\(Math\.max\(Math\.trunc\(filter\.pageSize\)[\s\S]*?REVIEW_QUEUE_MAX_PAGE_SIZE\)/);
});

test("evidence policy: HASH_ONLY never carries a redactedExcerpt, even if the stored envelope has one (defensive fail-closed)", () => {
  const presented = presentEvidence({
    evidenceId: "ev-1",
    handling: "HASH_ONLY",
    capturedAt: asIsoTimestamp(new Date().toISOString()),
    hashes: [{ algorithm: "sha256", value: "abc" }],
    locations: [],
    // A malformed upstream record could in principle carry this; the
    // presentation policy must strip it regardless of what handling claims.
    redactedExcerpt: "this must never reach the client",
  } as never);
  assert.equal(presented.handling, "HASH_ONLY");
  assert.equal("redactedExcerpt" in presented, false);
});

test("evidence policy: REDACTED exposes only the already-redacted excerpt plus identity/hash/location metadata", () => {
  const presented = presentEvidence({
    evidenceId: "ev-2",
    handling: "REDACTED",
    capturedAt: asIsoTimestamp(new Date().toISOString()),
    hashes: [{ algorithm: "sha256", value: "def" }],
    locations: [{ kind: "REPOSITORY", locator: "loc" as never, path: "src/x.ts" }],
    redactedExcerpt: "REDACTED***",
  } as never);
  assert.equal(presented.handling, "REDACTED");
  assert.equal((presented as { redactedExcerpt?: string }).redactedExcerpt, "REDACTED***");
  assert.deepEqual(Object.keys(presented).sort(), ["capturedAt", "evidenceId", "handling", "hashes", "locations", "redactedExcerpt"]);
});

test("evidence policy: NON_SENSITIVE exposes the same safe structured metadata shape as REDACTED — never a raw envelope dump", () => {
  const presented = presentEvidence({
    evidenceId: "ev-3",
    handling: "NON_SENSITIVE",
    capturedAt: asIsoTimestamp(new Date().toISOString()),
    hashes: [],
    locations: [],
  } as never);
  assert.equal(presented.handling, "NON_SENSITIVE");
  assert.deepEqual(Object.keys(presented).sort(), ["capturedAt", "evidenceId", "handling", "hashes", "locations"]);
});

test("evidence policy: presentation decision happens in this server-only module, not in a client component", () => {
  const uiSource = readFileSync(path.join(ROOT, "app/(dashboard)/governance/reviews/[id]/page.tsx"), "utf8");
  assert.doesNotMatch(uiSource, /handling\s*===\s*["']HASH_ONLY["']/, "the client must never branch on evidence handling to decide what to render — the server already decided");
});

test("search escaping: ILIKE wildcard and escape characters are neutralized so a search term cannot inject an unintended pattern", () => {
  assert.equal(escapeIlikeTerm("50%_off\\"), "50\\%\\_off\\\\");
});

test("search escaping: PostgREST or-filter structural characters (comma, parens) are stripped so a search term cannot inject an extra filter clause outside the intended two ilike conditions", () => {
  assert.equal(escapeIlikeTerm("x,state.eq.CERTIFIED"), "xstate.eq.CERTIFIED");
  assert.equal(escapeIlikeTerm("a(b)c"), "abc");
});
