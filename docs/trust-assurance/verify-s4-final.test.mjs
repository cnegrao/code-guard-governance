// Remaining final documentary gates only; reuse passing focused metadata checks.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const git=a=>execFileSync('git',a,{encoding:'utf8'}).trim();
const start='e56d9d8b9ed729b982f234e20a5658e0f9d60be3';
const handoff='docs/codex/evidence/2026-10-20-m17.5-s4-kpi-framework.md';
const files=['docs/agent/ARCHITECTURE_INDEX.md',handoff,...['kpi-framework-v0.json','kpi-framework-v0.md','kpi-render-v0.mjs','verify-s4.test.mjs','verify-s4-final.test.mjs'].map(p=>'docs/trust-assurance/'+p)].sort();
test('S4 final: seven staged documentation paths; zero runtime/database/migration/API/UI delta',()=>{
 assert.equal(git(['branch','--show-current']),'feat/m17.5-trust-assurance-v0');
 assert.equal(git(['rev-parse','HEAD']),start,'required starting HEAD before authorized commit');
 assert.deepEqual(git(['diff','--name-only',start,'--']).split('\n').filter(Boolean).sort(),files);
 assert.deepEqual(git(['diff','--cached','--name-only']).split('\n').filter(Boolean).sort(),files);
 assert.equal(git(['diff','--name-only']),'');assert.equal(git(['ls-files','--others','--exclude-standard']),'');
 for(const p of files.filter(p=>p!=='docs/agent/ARCHITECTURE_INDEX.md'))assert.equal(git(['ls-tree',start,'--',p]),'','S4 artifacts additive only');
 assert.equal(git(['diff','--check']),'');assert.equal(git(['diff','--cached','--check']),'');
});
test('S4 final: links, delivered completeness and concrete S5 handoff',()=>{
 for(const p of files.filter(p=>p.endsWith('.md')))for(const m of readFileSync(p,'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
  if(/^(?:https?:|#)/.test(m[1]))continue;
  assert.ok(existsSync(resolve(dirname(p),m[1].split('#')[0])),p+': '+m[1]);
 }
 const d=JSON.parse(readFileSync('docs/trust-assurance/kpi-framework-v0.json','utf8'));
 for(const r of d.readiness_pack){for(const id of r.source_ids??[])assert.ok(existsSync(d.source_artifacts.find(s=>s.source_id===id).path));for(const p of r.paths??[])assert.ok(existsSync(p));}
 const text=readFileSync(handoff,'utf8');
 for(const phrase of [start,'Final HEAD','11','PRODUCT: 5','TENANT: 6','DEFINITION_ONLY: 7','PRODUCT_DOCUMENTARY_ONLY: 4','COUNT','PARTITIONED_COUNT','UNKNOWN','zero','PRESENT','PARTIAL','MISSING','S5 not started','M17.5-S5','No PostgreSQL','No PR','No deployment','No tenant query','not proof of containment','PASS'])assert.ok(text.includes(phrase),'handoff '+phrase);
 for(const r of d.readiness_pack)assert.ok(text.includes(r.artifact),'handoff artifact '+r.artifact);
});
