import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const base = 'ded847bf7bc685b371f36664f50b69e9bdb535d1';
const record = 'docs/trust-assurance/l01-lx02-containment-status-v1.json';
const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
const status = JSON.parse(read(record));

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
  assert.equal(git(['diff', '--name-only', base, '--', ...frozen]), '');
  assert.equal(git(['ls-files', '--others', '--exclude-standard', '--', ...frozen]), '');
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
    for (const name of names) assert.equal(extract(read(path), name), extract(before, name), `${path}:${name}`);
  }
});
test('source locators identify exact normalized bytes and the candidate contains only authorized application/evidence paths', () => {
  assert.ok(Object.keys(status.source_sha256).length >= 25);
  for (const [path, expected] of Object.entries(status.source_sha256)) {
    assert.equal(createHash('sha256').update(read(path)).digest('hex'), expected, path);
  }
  assert.equal(existsSync('apps/dashboard/components/agents/CompliancePanel.tsx'), false);
  const allowed = new Set([...Object.keys(status.source_sha256), record, status.evidence,
    'docs/trust-assurance/verify-v1-s1b-c1.test.mjs', 'docs/agent/ARCHITECTURE_INDEX.md',
    'apps/dashboard/components/agents/CompliancePanel.tsx']);
  const changed = [git(['diff', '--name-only', base]), git(['ls-files', '--others', '--exclude-standard'])]
    .flatMap(text => text.split('\n').filter(Boolean));
  for (const file of changed) assert.ok(allowed.has(file), `unscoped candidate file: ${file}`);
});
