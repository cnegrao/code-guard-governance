import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = path.join(ROOT, "lib/governance/persistence.ts");

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("boundary: lib/governance/persistence.ts is marked server-only", () => {
  const source = readSource();
  assert.match(source.trimStart(), /^import "server-only";/);
});

test("boundary: privileged Supabase client is never exported", async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  const persistence = await import("@/lib/governance/persistence");

  for (const name of Object.keys(persistence)) {
    assert.doesNotMatch(
      name.toLowerCase(),
      /(^|_)(db|client)$/,
      `export "${name}" looks like it could be the raw privileged client`
    );
  }
});

test("boundary: privileged client is scoped to the gov_repo schema with a distinguishing header", () => {
  const source = readSource();
  assert.match(source, /db:\s*\{\s*schema:\s*"gov_repo"\s*\}/);
  assert.match(source, /"x-codeguard-client":\s*"governance-os-review-privileged"/);
});

test("boundary: uses the service-role key, never the anon key", () => {
  const source = readSource();
  const clientCreation = source.match(/createClient\(([^)]*)\)/)?.[1] ?? "";
  assert.match(clientCreation, /supabaseServiceRoleKey/);
  assert.doesNotMatch(clientCreation, /supabaseAnonKey/);
});

// ---------------------------------------------------------------------------
// RPC call shape — each RPC's exact parameter key set is asserted so a
// silently-dropped or renamed field is caught immediately, without needing a
// live database round trip for this class of regression.
// ---------------------------------------------------------------------------

function rpcParamKeys(source: string, rpcName: string): string[] {
  const call = source.match(new RegExp(`privilegedDb\\.rpc\\("${rpcName}",\\s*\\{([\\s\\S]*?)\\n\\s*\\}\\)`))?.[1] ?? "";
  return [...call.matchAll(/^\s*(p_\w+):/gm)].map((m) => m[1]).sort();
}

test("RPC call: create_review_subject sends exactly the expected parameters", () => {
  const keys = rpcParamKeys(readSource(), "create_review_subject");
  assert.deepEqual(
    keys,
    [
      "p_review_subject_id",
      "p_organisation_id",
      "p_finding_id",
      "p_candidate_kind",
      "p_source_connection_id",
      "p_source_external_type",
      "p_source_external_id",
      "p_detected_at",
      "p_assertion_ids",
      "p_evidence_ids",
    ].sort()
  );
});

test("RPC call: apply_review_transition sends exactly the expected parameters", () => {
  const keys = rpcParamKeys(readSource(), "apply_review_transition");
  assert.deepEqual(
    keys,
    [
      "p_organisation_id",
      "p_review_subject_id",
      "p_finding_id",
      "p_previous_state",
      "p_new_state",
      "p_actor_kind",
      "p_actor_reference",
      "p_actor_rule_code",
      "p_actor_rule_version",
      "p_occurred_at",
      "p_evidence_ids",
      "p_reason_code",
      "p_command_id",
      "p_event_id",
    ].sort()
  );
});

test("RPC call: record_authorization_decision sends exactly the expected parameters", () => {
  const keys = rpcParamKeys(readSource(), "record_authorization_decision");
  assert.deepEqual(
    keys,
    [
      "p_authorization_decision_id",
      "p_organisation_id",
      "p_review_subject_id",
      "p_actor_reference",
      "p_subject_kind",
      "p_subject_candidate_id",
      "p_subject_candidate_merge_id",
      "p_requested_action",
      "p_result",
      "p_evaluated_at",
      "p_policy_reference",
    ].sort()
  );
});

test("RPC call: record_authorized_reconciliation never sends a caller-supplied p_result — only record_authorization_decision may pass a result value", () => {
  const source = readSource();
  const call = source.match(/privilegedDb\.rpc\("record_authorized_reconciliation",\s*\{([\s\S]*?)\n\s*\}\)/)?.[1] ?? "";
  assert.notEqual(call, "", "expected to find the record_authorized_reconciliation call");
  assert.doesNotMatch(call, /p_result:/, "Transaction B must always record ALLOW server-side, never trust a caller-supplied result");
});

test("boundary: a DENY authorization result is never passed into persistAuthorizedReconciliation's RPC call (only persistAuthorizationDecision handles DENY)", () => {
  const source = readSource();
  const fn = source.match(/async persistAuthorizedReconciliation\([\s\S]*?\n {2}\},/)?.[0] ?? "";
  assert.notEqual(fn, "");
  assert.doesNotMatch(fn, /'DENY'/);
  assert.doesNotMatch(fn, /"DENY"/);
});

test("boundary: every read of a reconciliation decision envelope verifies its content hash before rehydration", () => {
  const source = readSource();
  const getChainFn = source.match(/async getReconciliationAuditChain\([\s\S]*?\n {2}\},/)?.[0] ?? "";
  const verifyIndex = getChainFn.indexOf("verifyEnvelopeIntegrity(");
  const rehydrateIndex = getChainFn.indexOf("rehydrateEnvelopeByFamily(");
  assert.ok(verifyIndex > -1 && rehydrateIndex > -1, "expected both a hash verification call and a rehydration call");
  assert.ok(verifyIndex < rehydrateIndex, "content-hash verification must happen before rehydration, not after");
});

test("boundary: fetched reconciliation decision organisationId is cross-checked against the requested tenant after rehydration", () => {
  const source = readSource();
  const getChainFn = source.match(/async getReconciliationAuditChain\([\s\S]*?\n {2}\},/)?.[0] ?? "";
  assert.match(getChainFn, /decision\.organisationId !== organisationId/);
});
