// Remaining final staged scope, links, handoff and whitespace gates only.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const git=a=>execFileSync('git',a,{encoding:'utf8'}).trim();
const start='38df55d8b1b1009adbb76faed63f3b7c622f914e';
const handoff='docs/codex/evidence/2026-10-20-m17.5-s5-v0-closure.md';
const files=['docs/agent/ARCHITECTURE_INDEX.md',handoff,...['v0-closure-review.json','v0-closure-review.md','closure-render-v0.mjs','verify-s5.test.mjs','verify-s5-final.test.mjs'].map(p=>'docs/trust-assurance/'+p)].sort();
test('S5 final: seven staged documentary paths, additive review and zero runtime/database/migration/API/UI delta',()=>{
 assert.equal(git(['branch','--show-current']),'feat/m17.5-trust-assurance-v0');assert.equal(git(['rev-parse','HEAD']),start);
 assert.deepEqual(git(['diff','--name-only',start,'--']).split('\n').filter(Boolean).sort(),files);
 assert.deepEqual(git(['diff','--cached','--name-only']).split('\n').filter(Boolean).sort(),files);
 assert.equal(git(['diff','--name-only']),'');assert.equal(git(['ls-files','--others','--exclude-standard']),'');
 for(const p of files.filter(p=>p!=='docs/agent/ARCHITECTURE_INDEX.md'))assert.equal(git(['ls-tree',start,'--',p]),'');
 assert.equal(git(['diff','--check']),'');assert.equal(git(['diff','--cached','--check']),'');
});
test('S5 final: all local Markdown links and complete handoff boundary/next action resolve',()=>{
 for(const p of files.filter(p=>p.endsWith('.md')))for(const m of readFileSync(p,'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
  if(/^(?:https?:|#)/.test(m[1]))continue;assert.ok(existsSync(resolve(dirname(p),m[1].split('#')[0])),p+': '+m[1]);
 }
 const text=readFileSync(handoff,'utf8');
 for(const phrase of [start,'Final HEAD','V0_DOCUMENTARY_CLOSURE: PASS','CONTROLLED_DEMO_READINESS: HOLD','EXTERNAL_PUBLICATION_READINESS: HOLD','TENANT_ASSURANCE_READINESS: HOLD','CERTIFICATION_READINESS: HOLD','61','42','38','109','11','49','INTERNAL_ONLY','M17.5 V0 READINESS PACK: CLOSED / PASS','Overall M17.5 remains open','No PostgreSQL','No PR','V1-S0','not started'])assert.ok(text.includes(phrase),'handoff '+phrase);
 const d=JSON.parse(readFileSync('docs/trust-assurance/v0-closure-review.json','utf8'));
 for(const a of d.readiness_pack)assert.ok(text.includes(a.artifact),'reviewed artifact '+a.artifact);
});
