import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const base = 'ded847bf7bc685b371f36664f50b69e9bdb535d1';
const record = 'docs/trust-assurance/l01-lx02-containment-status-v1.json';
const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
const status = JSON.parse(read(record));


// These are closed historical snapshots, independent of later authorized slices.
const historicalStart = 'ded847bf7bc685b371f36664f50b69e9bdb535d1';
const historicalClose = '8a10a99a42dd2a5554c44d056d9fc31378433e04';
const historicalBodies = new Map();
const at = (commit, path) => {
  const key = commit + ':' + path;
  if (!historicalBodies.has(key)) historicalBodies.set(key, execFileSync('git', ['show', key], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 }));
  return historicalBodies.get(key).replace(/\r\n/g, '\n');
};
const changed = (paths = []) => git(['diff', '--name-only', historicalStart, historicalClose, '--', ...paths]).trim().split('\n').filter(Boolean);
function assertClosed(end = historicalClose, begin = historicalStart) {
  git(['merge-base', '--is-ancestor', begin, end]);
  git(['merge-base', '--is-ancestor', end, 'HEAD']);
  assert.equal(begin, historicalStart, 'historical start must remain frozen');
  assert.equal(end, historicalClose, 'historical close must remain frozen');
}
function assertHistoricalPin(p, commit, exactAnchor = false) {
  assert.equal(p.selection_commit, commit, 'historical selection commit');
  const body = at(commit, p.path);
  if (p.git_blob) assert.equal(p.git_blob, git(['rev-parse', commit + ':' + p.path]).trim());
  assert.equal(createHash('sha256').update(body).digest('hex'), p.sha256_lf_utf8, p.path);
  if (p.line) {
    const line = body.split('\n')[p.line - 1];
    if (exactAnchor) assert.equal(line?.trim(), p.anchor); else assert.ok(line?.includes(p.anchor), 'historical anchor: ' + p.path);
    assert.equal(p.locator, 'https://github.com/cnegrao/code-guard-governance/blob/' + commit + '/' + p.path + '#L' + p.line);
  }
}
// Existing S1 evidence supplies a recorded hash/anchor/locator for scope-only guards too.
// No hash or anchor is generated from the body being verified.
function closureEvidence() {
  const e = JSON.parse(at(historicalClose, 'docs/trust-assurance/evidence-index-v0.json')).evidence[0];
  return { path: e.path, line: e.line, anchor: e.anchor, selection_commit: e.source_commit,
    sha256_lf_utf8: e.content_sha256_lf_utf8, locator: e.exact_locator };
}
const evidenceCommit = 'acb95f84036b9bd5759c8afa04460bf1a004595f';
function verifyHorizon() {
  assertClosed();
  assertHistoricalPin(closureEvidence(), evidenceCommit);
}
function rejectHistoricalMutations(scopeChecks, pin = closureEvidence(), commit = evidenceCommit) {
  verifyHorizon();
  for (const [check, files] of scopeChecks) {
    check(files);
    assert.throws(() => check([...files, 'supabase/migrations/__unauthorized_during_slice__.sql']), /scope|unchanged|Expected/i);
  }
  assert.throws(() => assertClosed(git(['rev-parse', 'HEAD']).trim()), /historical close/);
  assert.throws(() => assertClosed(git(['rev-parse', historicalStart + '^']).trim()), /Command failed/);
  assertHistoricalPin(pin, commit);
  for (const mutation of [
    { sha256_lf_utf8: '0'.repeat(64) }, { anchor: '__MUTATED_HISTORICAL_ANCHOR__' },
    { locator: pin.locator.replace(commit, git(['rev-parse', 'HEAD']).trim()) },
    { selection_commit: git(['rev-parse', 'HEAD']).trim() },
  ]) assert.throws(() => assertHistoricalPin({ ...pin, ...mutation }, commit));
}

test('additive L01/LX02 classification records every local criterion and preserves all OPEN/HOLD boundaries', () => {
  assert.equal(status.starting_head, base);
  assert.equal(status.slice, 'M17.5-V1-S1B CHECKPOINT 1');
  assert.equal(status.slice_status, 'CLOSED / PASS');
  assert.equal(status.verification_scope, 'LOCAL_SOURCE_APPLICATION_UI_AND_MOCKED_DATABASE_TRANSPORT');
  assert.equal(status.hosted_verified, false);
  for (const [gate, count] of [['L01', 10], ['LX02', 6]]) {
    assert.equal(status.gates[gate].classification, 'CONTAINED / PASS - LOCAL');
    assert.equal(status.gates[gate].criteria.length, count);
    assert.deepEqual(status.gates[gate].criteria.map(c => c.id), Array.from({ length: count }, (_, i) => i + 1));
    assert.ok(status.gates[gate].criteria.every(c => c.result === 'PASS' && c.proof.length));
  }
  assert.equal(status.v1_s1b_status, 'OPEN'); assert.equal(status.m17_5_status, 'OPEN');
  for (const key of ['controlled_demo_readiness', 'external_publication_readiness', 'tenant_assurance_readiness', 'certification_readiness', 'm18']) assert.equal(status[key], 'HOLD');
  assert.deepEqual(status.remaining_s1b_exposure_gates, ['L02', 'L03', 'LX01', 'LX03', 'LX04', 'LX05', 'LX06', 'LX07']);
  assert.deepEqual(status.s1c_later, ['L04', 'LX09_DORMANT_PDF_GENERATORS']);
  assert.equal(status.next_checkpoint_started, false);
  assert.match(status.next_checkpoint_proposal, /CHECKPOINT 2 - L02.*L03/);
  assert.equal(status.database_schema_delta, 0); assert.equal(status.migration_delta, 0); assert.equal(status.hosted_delta, 0);
  assert.equal(status.historical_records_modified, false);
  const evidence = read(status.evidence);
  for (const heading of ['Public contract before/after', 'UI and empty/all-pass behavior', 'Individual closure criteria', 'Remaining gates and exact next proposal']) assert.ok(evidence.includes(heading));
  assert.match(evidence, /PASS 20\/20/); assert.match(evidence, /PASS 11\/11/);
});
test('all migrations, canonical authority, LX08 and historical exposure artifacts remain byte-unchanged', () => {
  const frozen = ['supabase', 'apps/extension/supabase', 'graphos-complete', 'packages', 'docs/architecture',
    'apps/dashboard/lib/governance', 'apps/dashboard/app/api/audit', 'apps/dashboard/components/audit',
    'apps/dashboard/services/knowledge-graph.ts', 'apps/dashboard/repositories/talk.ts',
    'apps/dashboard/repositories/reports.ts', 'apps/dashboard/services/reports.ts',
    'docs/trust-assurance/legacy-containment-register-v0.md',
    'docs/trust-assurance/v0-closure-errata-v1.md', 'docs/trust-assurance/v0-closure-errata-v1.json',
    'docs/trust-assurance/v1-hub-read-contract.md', 'docs/trust-assurance/v1-hub-read-contract.json',
    'docs/trust-assurance/lx08-audit-containment-status-v1.json', 'docs/trust-assurance/lx08-audit-containment-status-v2.json'];
  verifyHorizon();
  assertC1Frozen(changed(frozen));
  assert.equal(JSON.parse(read('docs/trust-assurance/lx08-audit-containment-status-v2.json')).classification, 'CONTAINED / PASS');
});
test('legacy control read/persistence and manual-state validation functions are unchanged from starting HEAD', () => {
  const extract = (text, name) => {
    const match = text.match(new RegExp(`export async function ${name}\\([\\s\\S]*?(?=\\nexport |$)`));
    assert.ok(match, name); return match[0].trim();
  };
  for (const [file, names] of [
    ['repositories/agents.ts', ['getAgentCompliance', 'updateAgentCompliance']],
    ['repositories/systems.ts', ['getSystemCompliance', 'updateSystemCompliance']],
    ['services/agents.ts', ['assessCompliance']], ['services/systems.ts', ['assessCompliance']],
  ]) {
    const path = `apps/dashboard/${file}`;
    const before = git(['show', `${base}:${path}`]).replace(/\r\n/g, '\n');
    for (const name of names) assert.equal(extract(at(historicalClose,path), name), extract(before, name), `${path}:${name}`);
  }
});
test('source locators identify exact normalized bytes and the candidate contains only authorized application/evidence paths', () => {
  verifyHorizon();
  assert.ok(Object.keys(status.source_sha256).length >= 25);
  for (const [path, expected] of Object.entries(status.source_sha256)) {
    assert.equal(createHash('sha256').update(at(historicalClose,path)).digest('hex'), expected, path);
  }
  assert.equal(git(['ls-tree', historicalClose, '--', 'apps/dashboard/components/agents/CompliancePanel.tsx']), '');
  assertC1Scope();
});

function assertC1Scope(files = changed()) {
  const allowed = new Set([...Object.keys(status.source_sha256), record, status.evidence,
    'docs/trust-assurance/verify-v1-s1b-c1.test.mjs', 'docs/agent/ARCHITECTURE_INDEX.md',
    'apps/dashboard/components/agents/CompliancePanel.tsx']);
  for (const file of files) assert.ok(allowed.has(file), `unscoped candidate file: ${file}`);
}

function assertC1Frozen(files) {
  assert.deepEqual(files, [], 'historical C1 protected paths must remain unchanged');
}

test('verify-v1-s1b-c1: historical scope, boundary, hash, anchor and locator mutations fail closed', () => {
  rejectHistoricalMutations([[assertC1Frozen, []], [assertC1Scope, changed()]]);
});
