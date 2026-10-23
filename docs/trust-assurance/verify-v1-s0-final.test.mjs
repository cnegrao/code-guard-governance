import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const base='a85f97225777e1dd1fd67109a349c3be6e45d0ad';
const root='docs/trust-assurance/';
const handoff='docs/codex/evidence/2026-10-20-m17.5-v1-s0-hub-read-contract.md';
const added=['docs/architecture/ADR-GOVIA-TRUST-ASSURANCE-HUB-v1.md',root+'v1-hub-read-contract.md',root+'v1-hub-read-contract.json',root+'verify-v1-s0.test.mjs',root+'verify-v1-s0-final.test.mjs',handoff];
const index='docs/agent/ARCHITECTURE_INDEX.md';
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
const read=p=>readFileSync(p,'utf8').replace(/\r\n/g,'\n');

test('V1-S0 final: exact staged documentation scope, historical preservation and whitespace',()=>{
 assert.equal(git(['rev-parse','HEAD']),base);assert.equal(git(['branch','--show-current']),'feat/m17.5-trust-assurance-v0');
 assert.deepEqual(git(['diff','--cached','--name-status',base]).split('\n').sort(),[...added.map(p=>'A\t'+p),'M\t'+index].sort());
 assert.equal(git(['diff','--name-only']),'');assert.equal(git(['ls-files','--others','--exclude-standard']),'');
 git(['diff','--check']);git(['diff','--cached','--check']);
 const old=git(['show',base+':'+index]);
 const body=read(index).trim().split('\n').filter(l=>!l.startsWith('- [M17.5-V1-S0 ')).join('\n').replace(/\n{3,}/g,'\n\n');
 assert.equal(body,old);
});

test('V1-S0 final: links, handoff evidence, all HOLDs and exact proposed next slice',()=>{
 for(const p of [index,...added.filter(p=>p.endsWith('.md'))])for(const m of read(p).matchAll(/\]\(([^)]+)\)/g)){const target=m[1].split('#')[0];if(target&&!target.includes('://'))assert.ok(existsSync(resolve(dirname(p),target)),p+': '+target);}
 const h=read(handoff);
 for(const text of [base,'Final HEAD','V1-A1: RESOLVED_ARCHITECTURALLY_ONLY','V1-A2: RESOLVED_ARCHITECTURALLY_ONLY','D-V1-01','D-V1-15','W-V1-01','40 read categories','45 immutable historical input pins','42','38','61','14','LX08','V1-S1A','No blocker to documentary S0 closure','No M18-specific API','Runtime/database/migration/API/UI delta: **0 / 0 / 0 / 0 / 0**','Focused verification: **6 tests PASS**'])assert.ok(h.includes(text),text);
 for(const state of ['CONTROLLED_DEMO_READINESS','EXTERNAL_PUBLICATION_READINESS','TENANT_ASSURANCE_READINESS','CERTIFICATION_READINESS'])assert.ok(h.includes(state+': **HOLD**'));
 assert.ok(h.includes('M18: **HOLD**'));assert.ok(!h.includes('pending execution'));
});
