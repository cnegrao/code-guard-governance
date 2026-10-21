import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
const base='a8b8bece4f19f105e418b89996693dfaf2d0c9e1';
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
const added=['docs/trust-assurance/v0-closure-errata-v1.json','docs/trust-assurance/v0-closure-errata-v1.md','docs/trust-assurance/errata-render-v1.mjs','docs/trust-assurance/verify-e1.test.mjs','docs/trust-assurance/verify-e1-final.test.mjs','docs/codex/evidence/2026-10-20-m17.5-v0-e1-adversarial-errata.md'];
test('E1 final: exact additive staged scope, historical preservation and zero runtime/database/API/UI delta',()=>{
 assert.deepEqual(git(['diff','--cached','--name-status',base]).split('\n').sort(),[...added.map(p=>'A\t'+p),'M\tdocs/agent/ARCHITECTURE_INDEX.md'].sort());
 assert.equal(git(['diff','--name-only']),'');assert.equal(git(['ls-files','--others','--exclude-standard']),'');
 git(['diff','--check']);git(['diff','--cached','--check']);
 const prior=git(['show',base+':docs/agent/ARCHITECTURE_INDEX.md']);
 const current=readFileSync('docs/agent/ARCHITECTURE_INDEX.md','utf8').replace(/\r\n/g,'\n').trim();
 assert.equal(current.split('\n').filter(l=>!l.startsWith('- [M17.5-V0-E1 ')).join('\n').replace(/\n{3,}/g,'\n\n'),prior);
});
test('E1 final: discoverable local links and complete handoff',()=>{
 for(const p of ['docs/agent/ARCHITECTURE_INDEX.md',added[5]]){
  const body=readFileSync(p,'utf8');
  for(const m of body.matchAll(/\]\(([^)]+)\)/g)){const target=m[1].split('#')[0];if(target&&!target.includes('://'))assert.ok(existsSync(resolve(dirname(p),target)),p+': '+target);}
 }
 const handoff=readFileSync(added[5],'utf8');
 for(const phrase of [base,'M17.5 V0 READINESS PACK: CLOSED / PASS','M17.5 overall: OPEN','V1-A1','V1-A2','UNRESOLVED','61','42','38','LX08_AUDIT_TRAIL','HOLD','No PR','V1-S0 and M18 not started','No runtime','Final HEAD'])assert.ok(handoff.includes(phrase),phrase);
});
