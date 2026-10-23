// Remaining final gates only; does not rerun the passed source/trace/fixture suite.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
const start='c354691e8dc24e771c4887a999f57f2165dc14ac';
const files=[
  'docs/agent/ARCHITECTURE_INDEX.md',
  'docs/codex/evidence/2026-10-20-m17.5-s3-award-readiness.md',
  ...['award-readiness-matrix-v0.json','award-readiness-matrix-v0.md','award-calendar-v0.json','award-calendar-v0.md','award-render-v0.mjs','verify-s3.test.mjs','verify-s3-final.test.mjs'].map(f=>'docs/trust-assurance/'+f),
].sort();
test('S3 final: exactly nine documentary paths staged; additive scope and zero runtime/database/migration/API/UI delta',()=>{
  assert.equal(git(['branch','--show-current']),'feat/m17.5-trust-assurance-v0');
  assert.equal(git(['rev-parse','HEAD']),start,'required starting HEAD before authorized commit');
  assert.deepEqual(git(['diff','--name-only',start,'--']).split('\n').filter(Boolean).sort(),files);
  assert.deepEqual(git(['diff','--cached','--name-only']).split('\n').filter(Boolean).sort(),files);
  assert.equal(git(['diff','--name-only']),'');
  assert.equal(git(['ls-files','--others','--exclude-standard']),'');
  for(const file of files.filter(f=>f!=='docs/agent/ARCHITECTURE_INDEX.md'))assert.equal(git(['ls-tree',start,'--',file]),'','only additive S3 documents/checks');
  assert.equal(git(['diff','--check']),'');assert.equal(git(['diff','--cached','--check']),'');
});
test('S3 final: relative links, handoff counts, source issues and exact proposed S4',()=>{
  for(const file of files.filter(f=>f.endsWith('.md'))) {
    const text=readFileSync(file,'utf8');
    for(const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link=match[1];if(/^(?:https?:|#)/.test(link))continue;
      assert.ok(existsSync(resolve(dirname(file),link.split('#')[0])),file+': '+link);
    }
  }
  const text=readFileSync(files.find(f=>f.includes('s3-award-readiness')),'utf8');
  for(const phrase of [start,'12','6','25','17','14 capabilities','39 evidence','10 gaps','14 claims','UNKNOWN','SOURCE_PENDING','ELIGIBILITY_UNKNOWN','zero','L01','L02','L03','L04','APDSI','EAIF','PNI','S4','Product/Customer KPI Framework','not started'])assert.ok(text.includes(phrase),'handoff '+phrase);
});
