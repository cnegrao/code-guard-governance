import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ledgerRepo } from './ledger-v2-foundation-fixtures';
import { operationalCluster } from './sr2-a3-fixtures';
import { applyM1, collectV2, v2FixtureUrl, routineSnapshot } from './sr1-numeric-fixtures';
import type { DependencyManifest } from './sr2-dependency-manifest';

export const m2Migration='20261029121855_m175_pre_a4_m2_a2_score_first_capacity_v1.sql';
export const m2Source=()=>readFileSync(join(ledgerRepo,'supabase/migrations',m2Migration),'utf8');
export const v3FixtureUrl=new URL('../fixtures/sr2-dependency-manifest-v3.json',import.meta.url);
export const v3Query=()=>readFileSync(new URL('./sr2-dependency-manifest-v3.sql',import.meta.url),'utf8');
export const m2Migrations=()=>readdirSync(join(ledgerRepo,'supabase/migrations'))
 .filter(n=>/^\d{14}_[a-z0-9_]+\.sql$/.test(n)&&n<=m2Migration).sort()
 .map(name=>({name,sha256_lf:createHash('sha256').update(readFileSync(join(ledgerRepo,'supabase/migrations',name),'utf8').replaceAll('\r','')).digest('hex')}));
export async function collectV3(owner:(sql:string)=>Promise<string>):Promise<DependencyManifest>{
 const actual=JSON.parse(await owner('BEGIN READ ONLY;'+v3Query()+'COMMIT;'));
 assert.equal(actual.document.manifest,'GOVIA_SR2_DEPENDENCY_MANIFEST_V3');assert.deepEqual(actual.document.missing,[]);return actual;
}
export async function m2Baseline(diagnostic:(s:string)=>void){
 const pg=await operationalCluster(diagnostic);
 try{await applyM1(pg);const v2=JSON.parse(readFileSync(v2FixtureUrl,'utf8'));
  assert.deepEqual(await collectV2(pg.owner),{document:v2.document,sha256:v2.sha256});return pg;}
 catch(e){pg.stop();throw e;}
}
export async function applyM2(pg:Awaited<ReturnType<typeof operationalCluster>>){
 const before=JSON.parse(await pg.owner(routineSnapshot));
 const old=before.find((p:any)=>p.proname==='technical_semantic_context_search_v1');assert.ok(old);
 await pg.owner(m2Source());const after=JSON.parse(await pg.owner(routineSnapshot));
 assert.notEqual(after.find((p:any)=>p.oid===old.oid).prosrc,old.prosrc);
 assert.deepEqual(after.map((p:any)=>p.oid===old.oid?{...p,prosrc:old.prosrc}:p),before,'exact body-only replacement preserves all routine capabilities');
 await pg.owner(m2Source());assert.deepEqual(JSON.parse(await pg.owner(routineSnapshot)),after,'idempotent reapplication');
 return {before,after};
}
