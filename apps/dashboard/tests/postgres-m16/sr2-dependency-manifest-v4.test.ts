import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { m3Baseline,applyM3,collectV4,v4FixtureUrl,m3Migrations } from '../helpers/sr2-m3-fixtures';

test('H1 V4 independent empty 109-migration replay matches current M3 horizon',{timeout:900000},async t=>{
 const pg=await m3Baseline(m=>t.diagnostic(m));t.after(()=>pg.stop());await applyM3(pg);
 const actual=await collectV4(pg.owner),expected=JSON.parse(readFileSync(v4FixtureUrl,'utf8'));
 assert.equal(actual.document.manifest,'GOVIA_SR2_DEPENDENCY_MANIFEST_V4');assert.deepEqual(actual.document.missing,[]);
 assert.deepEqual(actual,{document:expected.document,sha256:expected.sha256});assert.deepEqual(m3Migrations(),expected.migrations);
 assert.equal(expected.migrations.length,109);assert.equal(actual.document.routines.length,28);assert.equal(actual.document.relations.length,45);
 const controls=actual.document.relations.filter((r:any)=>r.identity.startsWith('gov_repo.sr2_operational_disclosure_'));
 assert.equal(controls.length,2);
 for(const r of controls){assert.equal(r.owner,'postgres');assert.equal(r.rls,true);assert.equal(r.policy_count,0);assert.equal(r.indexes.length,1);}
 const constraints=controls.flatMap((r:any)=>r.constraints);
 assert.equal(constraints.filter((c:any)=>c.type==='c').length,11);
 assert.equal(constraints.filter((c:any)=>c.type==='f').length,3);
 assert.equal(constraints.filter((c:any)=>c.type==='p').length,2);
 const operational=actual.document.relations.filter((r:any)=>r.identity.startsWith('gov_repo.sr2_operational_'));
 const triggers=operational.flatMap((r:any)=>r.triggers);
 assert.equal(triggers.length,15);assert.ok(triggers.every((tr:any)=>tr.enabled==='A'));
 t.diagnostic('H1_V4_INDEPENDENT_REPLAY '+actual.sha256);
});
