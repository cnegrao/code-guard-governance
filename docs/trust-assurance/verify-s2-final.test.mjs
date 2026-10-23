// Remaining final gate: Git candidate boundary, staging, links and whitespace.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const git = args => execFileSync('git', args, { encoding:'utf8' }).trim();
const start = '38314b7ea20e479f4d108ea1b48fd37c78d37ebf';
const files = [
  'docs/agent/ARCHITECTURE_INDEX.md',
  'docs/codex/evidence/2026-10-20-m17.5-s2-gaps-claims.md',
  ...['gap-register-v0.json','gap-register-v0.md','commercial-claims-register-v0.json','commercial-claims-register-v0.md','verify-s2.test.mjs','verify-s2-final.test.mjs'].map(f=>'docs/trust-assurance/'+f),
].sort();
test('S2 final: exactly eight additive documentation/check files staged; zero runtime/migration/API/UI delta; whitespace', () => {
  assert.equal(git(['branch','--show-current']), 'feat/m17.5-trust-assurance-v0');
  const actual = git(['diff','--name-only',start,'--']).split('\n').filter(Boolean).sort();
  assert.deepEqual(actual, files);
  assert.deepEqual(git(['diff','--cached','--name-only','--']).split('\n').filter(Boolean).sort(), files);
  assert.equal(git(['diff','--name-only','--']), '', 'unstaged changes');
  assert.equal(git(['ls-files','--others','--exclude-standard']), '', 'untracked files');
  for (const path of files.filter(f => f !== 'docs/agent/ARCHITECTURE_INDEX.md')) {
    assert.equal(git(['ls-tree',start,'--',path]), '', 'only additive S2 files');
  }
  assert.equal(git(['diff','--check']), '');
  assert.equal(git(['diff','--cached','--check']), '');
});
test('S2 final: relative links resolve and handoff states documentary counts and boundaries', () => {
  for (const file of files.filter(f=>f.endsWith('.md'))) {
    const md = readFileSync(file,'utf8');
    for (const match of md.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^(?:https?:|#)/.test(link)) continue;
      assert.ok(existsSync(resolve(dirname(file),link.split('#')[0])), file+': '+link);
    }
  }
  const handoff = readFileSync(files.find(f=>f.includes('s2-gaps-claims')),'utf8');
  for (const phrase of [start,'61','42','34','INELIGIBLE','NOT_ASSERTED','S3','zero','L01','L02','L03','L04']) assert.ok(handoff.includes(phrase), phrase);
});
