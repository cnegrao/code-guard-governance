import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const base = 'c377b48f3cf4d7976538c63d1b80878ff485719f';
const adr = 'docs/architecture/ADR-GOVIA-TENANT-LEDGER-INTEGRITY-v2.md';
const evidence = 'docs/codex/evidence/2026-10-20-m17.5-v1-s1a0-ledger-architecture.md';
const stop = 'docs/codex/evidence/2026-10-20-m17.5-v1-s1a-lx08-audit-containment.md';
const status = 'docs/trust-assurance/lx08-audit-containment-status-v1.json';
const index = 'docs/agent/ARCHITECTURE_INDEX.md';
const allowed = [adr, evidence, stop, status, index, 'docs/trust-assurance/verify-v1-s1a0.test.mjs'];
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
const read = path => readFileSync(path, 'utf8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('S1A0: exact documentation scope; committed history and runtime remain unchanged', () => {
  assert.equal(git(['branch', '--show-current']), 'feat/m17.5-trust-assurance-v0');
  git(['merge-base', '--is-ancestor', base, 'HEAD']);
  const changes = new Set([
    ...git(['diff', '--name-only', base]).split('\n'),
    ...git(['diff', '--cached', '--name-only', base]).split('\n'),
    ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
  ].filter(Boolean));
  assert.deepEqual([...changes].sort(), [...allowed].sort());
  git(['diff', '--check']);
  git(['diff', '--cached', '--check']);
  for (const file of allowed) assert.ok(!/[\t ]+$/m.test(read(file)), file);
  const oldIndex = git(['show', `${base}:${index}`]);
  const content = read(index).replace(/\r\n/g, '\n');
  const oldEntries = content.slice(content.indexOf('- [M17.5-V1-S0 ')).trimEnd();
  assert.equal(`# Architecture index\n\n${oldEntries}`, oldIndex);
});

test('S1A0: original local STOP bytes and status record are preserved', () => {
  const marker = '## Append-only S1A0 architecture follow-up';
  const raw = readFileSync(stop);
  const position = raw.indexOf(Buffer.from(marker));
  assert.ok(position > 0);
  // The follow-up separator adds one newline after the original terminal newline.
  const original = raw.subarray(0, position - 1);
  assert.equal(sha(original), '68e435ab7b692e1d67a0537f34219dc84ca7e52d9b0c8d65a017efa5b0021590');
  assert.equal(sha(readFileSync(status)), 'a23a323643abb80c38a71c0e4e7eef78ab596bf5f579251e27b786784a59b4c7');
  const historical = JSON.parse(read(status));
  assert.equal(historical.classification, 'NEEDS_CONTAINMENT');
  assert.equal(historical.implemented, false);
  assert.equal(historical.security_tests_passed, false);
});

test('S1A0: exact baseline locators prove the global model and established session basis', () => {
  const migration = 'supabase/migrations/20260818003710_gov_repo_identity_and_ledger.sql';
  const source = git(['show', `${base}:${migration}`]);
  const lines = source.split('\n');
  assert.match(lines[131], /select entry_hash.*order by entry_sequence desc limit 1 for update skip locked/);
  assert.match(lines[133], /v_prev_hash \|\| p_event_type \|\| p_subject_id::text \|\| p_actor_user_id::text \|\| v_now::text \|\| p_payload::text/);
  assert.doesNotMatch(lines[133], /organisation|sequence/);
  assert.match(lines[146], /where entry_sequence >= p_from_sequence/);
  assert.doesNotMatch(lines[146], /organisation/);
  const basis = git(['show', `${base}:supabase/migrations/20260929120000_m16_s1a_l14_authority_policy_v1.sql`]);
  assert.match(basis, /CREATE FUNCTION gov_repo\.l14_session_basis_v1\(/);
  assert.match(basis, /lock_and_resolve_governance_session_eligibility_v1/);
  const refs = [...read(adr).matchAll(/https:\/\/github\.com\/cnegrao\/code-guard-governance\/blob\/([a-f0-9]{40})\/([^\s)]+)#L(\d+)/g)];
  assert.ok(refs.length >= 14);
  for (const [, commit, file, line] of refs) {
    assert.equal(commit, base);
    const body = git(['show', `${base}:${file}`]).split('\n');
    assert.ok(Number(line) >= 1 && Number(line) <= body.length, `${file}:${line}`);
  }
});

test('S1A0: local artifact links resolve and closure keeps implementation/exposure on hold', () => {
  for (const file of [adr, evidence, index, stop]) {
    for (const [, targetWithHash] of read(file).matchAll(/\]\(([^)]+)\)/g)) {
      const target = targetWithHash.split('#')[0];
      if (target && !target.includes('://')) assert.ok(existsSync(resolve(dirname(file), target)), `${file}: ${target}`);
    }
  }
  const body = read(adr);
  for (const phrase of ['GLOBAL_INTERLEAVED', 'LEGACY_GLOBAL_ONLY', 'LEGACY_NON_AUTHORITATIVE',
    'GOVIA_LEDGER_TENANT_GENESIS_V2', 'GOVIA_LEDGER_TENANT_V2',
    'VALID | BROKEN | EMPTY | UNKNOWN', 'one\nSQL statement snapshot',
    'NEEDS_CONTAINMENT', 'IMPLEMENTATION NOT RESUMED', 'forward-only']) {
    assert.ok(body.includes(phrase), `Required design boundary: ${phrase}`);
  }
  const report = read(evidence);
  for (const gate of ['CONTROLLED_DEMO_READINESS', 'EXTERNAL_PUBLICATION_READINESS',
    'TENANT_ASSURANCE_READINESS', 'CERTIFICATION_READINESS', 'M18']) {
    assert.ok(report.includes(`${gate}: **HOLD**`), gate);
  }
  assert.ok(report.includes('Runtime/database/migration/API/UI delta: **0 / 0 / 0 / 0 / 0**'));
  assert.ok(report.includes('M17.5-V1-S1A1'));
});
