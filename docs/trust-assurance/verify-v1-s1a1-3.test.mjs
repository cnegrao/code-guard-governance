import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const base = 'af5657213aec858c4896063c271621d12327849a';
const file = 'docs/trust-assurance/lx08-audit-containment-status-v2.json';
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
const read = path => readFileSync(path, 'utf8');


// These are closed historical snapshots, independent of later authorized slices.
const historicalStart = 'af5657213aec858c4896063c271621d12327849a';
const historicalClose = 'ded847bf7bc685b371f36664f50b69e9bdb535d1';
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

test('current additive LX08 status records sixteen local PASS gates and preserves every readiness HOLD', () => {
  const status = JSON.parse(read(file));
  assert.equal(status.record_version, 2);
  assert.equal(status.slice, 'M17.5-V1-S1A1-3');
  assert.equal(status.slice_status, 'CLOSED / PASS');
  assert.equal(status.classification, 'CONTAINED / PASS');
  assert.equal(status.starting_head, base);
  assert.equal(status.verification_scope, 'LOCAL_SOURCE_APPLICATION_AND_DISPOSABLE_PG17');
  assert.equal(status.hosted_verified, false);
  assert.equal(status.hosted_delta, 0); assert.equal(status.migration_delta, 0);
  assert.equal(status.closure_criteria.length, 16);
  assert.deepEqual(status.closure_criteria.map(c => c.id), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.ok(status.closure_criteria.every(c => c.result === 'PASS' && c.proof.length > 0));
  for (const key of ['controlled_demo_readiness', 'external_publication_readiness', 'tenant_assurance_readiness', 'certification_readiness', 'm18']) assert.equal(status[key], 'HOLD');
  assert.equal(status.m17_5_status, 'OPEN'); assert.equal(status.next_slice_started, false);
  assert.equal(status.next_slice_proposal, 'M17.5-V1-S1B — LIVE LEGACY ASSURANCE EXPOSURE CONTAINMENT');
  assert.deepEqual(status.remaining_exposure_gates, ['L01', 'L02', 'L03', 'L04', 'LX01', 'LX02', 'LX03', 'LX04', 'LX05', 'LX06', 'LX07', 'LX09_DORMANT_PDF_GENERATORS']);
  assert.ok(existsSync(status.evidence));
  const receipt = read(status.evidence);
  assert.match(receipt, /M17.5-V1-S1A1-3 CLOSED \/ PASS/);
  assert.match(receipt, /LX08_AUDIT_TRAIL CONTAINED \/ PASS/);
  assert.doesNotMatch(receipt, /PENDING REMAINING VERIFICATION|PENDING COMPLETION/);
});

test('historical LX08 STOP/E1 documents remain unchanged; no DB/migration/adapter/authority delta', () => {
  const status = JSON.parse(read(file));
  assert.equal(status.previous_record, 'docs/trust-assurance/lx08-audit-containment-status-v1.json');
  assert.equal(JSON.parse(read(status.previous_record)).classification, 'NEEDS_CONTAINMENT');
  const untouched = [status.previous_record, 'docs/trust-assurance/v0-closure-errata-v1.md', 'docs/trust-assurance/v0-closure-errata-v1.json',
    'docs/architecture', 'supabase/migrations', 'apps/extension/supabase/migrations', 'apps/dashboard/lib/governance/ledger-read.ts',
    'apps/dashboard/lib/governance/ledger-write.ts', 'packages/canonical-contracts', 'packages/governance-review'];
  verifyHorizon();
  assertLX08Frozen(changed(untouched));
});

function assertLX08Frozen(files) {
  assert.deepEqual(files, [], 'historical LX08 protected paths must remain unchanged');
}

test('verify-v1-s1a1-3: historical scope, boundary, hash, anchor and locator mutations fail closed', () => {
  rejectHistoricalMutations([[assertLX08Frozen, []]]);
});
