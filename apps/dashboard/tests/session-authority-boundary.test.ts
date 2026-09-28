import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
function productionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (["tests", "node_modules", ".next", ".git"].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? productionSources(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}
const identityHeader = /x-codeguard-(?:user(?:-id)?|org(?:-id)?|email|role)\b/i;

test("all production dashboard sources prohibit caller identity headers and removed session helpers", () => {
  const files = productionSources(root);
  assert.ok(files.length > 100, "scan must cover the full application, not selected routes");
  assert.equal(existsSync(join(root, "lib/session.ts")), false);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const name = relative(root, file).replaceAll("\\", "/");
    assert.doesNotMatch(source, identityHeader, name);
    assert.doesNotMatch(source, /(?:@\/lib\/session|\bgetSessionContext\s*\(|\bgetOrgId\s*\(|\bgetUserId\s*\()/, name);
    if (name !== "lib/auth/session-token.ts") {
      assert.doesNotMatch(source, /\bjwtVerify\b|\bjwt\.(?:verify|decode)\s*\(/, name);
    }
    if (name !== "lib/auth.ts") {
      assert.doesNotMatch(source, /\b(?:getSession|verifyToken)\s*\(|\binformational(?:\?\.)?\.role\b|\bsession\.role\b/, name);
    }
  }
});

test("identity header guard catches all prohibited names but preserves client/signature metadata", () => {
  for (const name of ["user", "user-id", "org", "org-id", "email", "role"]) {
    assert.match(`headers.get("x-codeguard-${name}")`, identityHeader);
  }
  for (const name of ["client", "signature"]) assert.doesNotMatch(`headers.get("x-codeguard-${name}")`, identityHeader);
});

// M16-S0.3.3C-R1: the app-level role resolved from persistence is a UI/
// read-model concern only now — it must never gate a HUMAN write ahead of
// the governed DB wrapper (Finding C-R1-01). Only reviews/[id]'s GET still
// resolves a role at all (for its allowedActions read-model); every other
// route, and every write handler, must not.
test("every existing privileged route authenticates via a verified principal; only GET/read paths may additionally resolve a role, and never a write handler", () => {
  const routesWithNoRoleResolution = ["execution-context", "technical-facts", "reviews/[id]/decision", "reviews/[id]/materialize"];
  for (const route of routesWithNoRoleResolution) {
    const source = readFileSync(join(root, "app/api/governance/workspace", route, "route.ts"), "utf8");
    assert.match(source, /requireVerifiedGovernancePrincipal\(\)/, route);
    assert.doesNotMatch(source, /resolveCurrentGovernanceRole/, route);
    assert.doesNotMatch(source, /informational|body\.(?:role|currentRole|actorUserId|organisationId)/, route);
  }

  const reviewSource = readFileSync(join(root, "app/api/governance/workspace/reviews/[id]/route.ts"), "utf8");
  assert.match(reviewSource, /requireVerifiedGovernancePrincipal\(\)/, "reviews/[id]");
  assert.match(reviewSource, /await resolveCurrentGovernanceRole\(principal\)/, "reviews/[id]");
  assert.doesNotMatch(reviewSource, /informational|body\.(?:role|currentRole|actorUserId|organisationId)/, "reviews/[id]");
  const putIndex = reviewSource.indexOf("export async function PUT");
  assert.notEqual(putIndex, -1, "reviews/[id]/route.ts must still export PUT");
  assert.doesNotMatch(reviewSource.slice(putIndex), /resolveCurrentGovernanceRole/, "reviews/[id] PUT must not resolve or gate on a role");
});
