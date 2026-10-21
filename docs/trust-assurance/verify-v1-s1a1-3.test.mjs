import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const base = 'af5657213aec858c4896063c271621d12327849a';
const file = 'docs/trust-assurance/lx08-audit-containment-status-v2.json';
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
const read = path => readFileSync(path, 'utf8');

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
  assert.equal(git(['diff', '--name-only', base, '--', ...untouched]), '');
  assert.equal(git(['diff', '--cached', '--name-only', base, '--', ...untouched]), '');
});
