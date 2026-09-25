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

test("every existing privileged route derives current roles from persistence", () => {
  for (const route of ["execution-context", "technical-facts", "reviews/[id]", "reviews/[id]/decision", "reviews/[id]/materialize"]) {
    const source = readFileSync(join(root, "app/api/governance/workspace", route, "route.ts"), "utf8");
    assert.match(source, /requireVerifiedGovernancePrincipal\(\)/, route);
    assert.match(source, /await resolveCurrentGovernanceRole\(principal\)/, route);
    assert.doesNotMatch(source, /informational|body\.(?:role|currentRole|actorUserId|organisationId)/, route);
  }
});
