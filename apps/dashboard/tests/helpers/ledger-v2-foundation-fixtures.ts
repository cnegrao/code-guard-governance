import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disposableM16Postgres, fullPrimaryChainMigrations } from './disposable-m16-postgres';

export const ledgerRepo = fileURLToPath(new URL('../../../../', import.meta.url));
export const ledgerMigration = '20261021030240_m175_v1_s1a1_1_tenant_ledger_v2_inactive.sql';
export const replay = JSON.parse(readFileSync(join(ledgerRepo,'apps/dashboard/tests/fixtures/ledger-v2-migration-replay-v1.json'),'utf8')) as {
  base: string; historicalCount: number; canonicalHistoricalCount: number; appliedCount: number;
  applied: string[]; historical: {path:string;oid:string}[]; excluded:{path:string;reason:string}[];
};
export const v2Tables = ['ledger_integrity_epochs_v2','ledger_global_append_head_v2','ledger_tenant_genesis_v2',
  'ledger_tenant_heads_v2','ledger_tenant_entries_v2','ledger_tenant_legacy_refs_v2'] as const;
export const immutableTables = ['ledger_integrity_epochs_v2','ledger_tenant_genesis_v2','ledger_tenant_entries_v2','ledger_tenant_legacy_refs_v2'] as const;
export const lit = (value: unknown): string => value === null ? 'NULL' : `'${String(value).replaceAll("'","''")}'`;
export const orgA='11111111-1111-4111-8111-111111111111', orgB='99999999-9999-4999-8999-999999999999';
export const chain='22222222-2222-4222-8222-222222222222', activation='33333333-3333-4333-8333-333333333333';
export const firstEntry='44444444-4444-4444-8444-444444444444';
export const activatedAt='2026-10-20T00:00:00.123456+00:00';

export interface Vector {name:string;kind:string;args:any;hex:string;sha256:string}
export const vectors: Vector[] = JSON.parse(readFileSync(join(ledgerRepo,'apps/dashboard/tests/fixtures/ledger-v2-serialization-v1.json'),'utf8')).vectors;
export function vectorSql(vector: Vector): string {
  const a=vector.args;
  if(vector.kind==='genesis')return `gov_repo.ledger_v2_genesis_bytes(${lit(a.organisation)},${lit(a.chain)},${lit(a.activation)},${lit(a.activated_at)})`;
  if(vector.kind==='entry')return `gov_repo.ledger_v2_entry_bytes(${[
    lit(a.organisation),lit(a.chain),lit(a.activation),lit(a.sequence),lit(a.entry),`decode(${lit(a.previous)},'hex')`,lit(a.source_entry),
    lit(a.event_type),lit(a.description),lit(a.subject_type),lit(a.subject),lit(a.actor),lit(a.ip),lit(a.session),lit(a.event_at),lit(a.recorded_at),lit(a.payload)
  ].join(',')})`;
  if(vector.kind==='text')return `gov_repo.ledger_v2_frame(1,convert_to(${lit(a)},'UTF8'))`;
  if(vector.kind==='decimal')return `gov_repo.ledger_v2_frame(6,gov_repo.ledger_v2_decimal(${lit(a)}::numeric))`;
  if(vector.kind==='timestamp')return `gov_repo.ledger_v2_timestamp(${lit(a)})`;
  throw new Error(`Unsupported test vector kind ${vector.kind}`);
}

/** Every canonical migration through this slice, with REAL pgvector required. Older horizons stay unchanged. */
export async function ledgerFoundationCluster(diagnostic: (message:string)=>void) {
  const bin=process.env.M16_PG17_BIN;
  assert.ok(bin,'M16_PG17_BIN must select a development-complete PG17 explicitly');
  assert.ok(existsSync(resolve(bin,'../lib/vector.dll')) || process.platform!=='win32','real pgvector DLL required');
  const canonical=readdirSync(join(ledgerRepo,'supabase/migrations')).filter(n=>/^\d{14}_[a-z0-9_]+\.sql$/.test(n)&&n<=ledgerMigration).sort();
  assert.deepEqual(canonical,replay.applied.map(p=>p.split('/').at(-1)),'no omitted canonical file');
  assert.equal(canonical.length,100);
  const pg=await disposableM16Postgres(diagnostic,{fullPrimaryChain:true});
  const owner=(q:string)=>pg.sql(q,'postgres'),svc=(q:string)=>pg.sql(q,'service_role');
  const applied=[...fullPrimaryChainMigrations()];
  try {
    assert.equal(await owner('SHOW server_version_num'),'170011');
    assert.equal(await owner("SELECT extversion FROM pg_extension WHERE extname='vector'"),'0.8.7');
    assert.equal(await owner("SELECT count(*) FROM pg_am WHERE amname='hnsw'"),'1');
    for(const name of canonical){
      if(name===ledgerMigration || applied.includes(name))continue;
      await owner(readFileSync(join(ledgerRepo,'supabase/migrations',name),'utf8'));
      applied.push(name);
    }
    assert.deepEqual(applied,canonical.slice(0,-1),'all 99 historical canonical files executed, in order');
  }catch(error){pg.stop();throw error;}
  const applyFoundation=async()=>{
    await owner(readFileSync(join(ledgerRepo,'supabase/migrations',ledgerMigration),'utf8'));
    applied.push(ledgerMigration);
    assert.deepEqual(applied,canonical);
    diagnostic(`Canonical replay PASS: 99 historical + 1 additive = ${applied.length}; REAL PG17.11 / pgvector0.8.7; no stand-in`);
  };
  return {...pg,owner,svc,applyFoundation,applied};
}

export const legacyInventorySql=`SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
  'sha256',encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex'),
  'body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'config',p.proconfig) ORDER BY p.proname)::text
  FROM pg_proc p WHERE pronamespace='gov_repo'::regnamespace AND proname IN ('ledger_append','ledger_verify')`;
export const historySql='SELECT jsonb_agg(to_jsonb(l) ORDER BY entry_sequence)::text FROM gov_repo.governance_ledger l';
export const sourceGuardsSql=`SELECT jsonb_build_object(
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'def',pg_get_triggerdef(oid)) ORDER BY tgname),'[]') FROM pg_trigger WHERE tgrelid='gov_repo.governance_ledger'::regclass AND NOT tgisinternal),
 'rules',(SELECT jsonb_agg(jsonb_build_object('name',rulename,'def',pg_get_ruledef(oid)) ORDER BY rulename) FROM pg_rewrite WHERE ev_class='gov_repo.governance_ledger'::regclass),
 'acl',(SELECT relacl FROM pg_class WHERE oid='gov_repo.governance_ledger'::regclass),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='gov_repo' AND tablename='governance_ledger'))::text`;

export async function seedLedger(pg: Awaited<ReturnType<typeof ledgerFoundationCluster>>) {
  await pg.owner(`INSERT INTO gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code)
    VALUES('${orgA}','V2_A','A','A','BR'),('${orgB}','V2_B','B','B','BR');`);
  for(const [org,event] of [[orgA,'A1'],[orgB,'B1'],[orgA,'A2']])
    await pg.svc(`SELECT gov_repo.ledger_append('${event}','description','SYSTEM',gen_random_uuid(),gen_random_uuid(),'192.0.2.9','${org}','{"exact":123456789012345678901234567890}')`);
  // Real legacy UUID duplicates are legal: preserve a VALID global chain while
  // repeating entry_id. V2 must locate source by org/sequence, not UUID alone.
  await pg.owner(`INSERT INTO gov_repo.governance_ledger(entry_id,event_type,event_description,subject_type,subject_id,actor_user_id,
      actor_ip,actor_session_id,organisation_id,event_timestamp,recorded_at,previous_hash,entry_hash,payload,qes_anchor)
    SELECT first.entry_id,'DUPLICATE_UUID','duplicate source id','SYSTEM',tail.subject_id,tail.actor_user_id,
      NULL,NULL,'${orgA}',tail.event_timestamp,tail.recorded_at,tail.entry_hash,
      encode(sha256(convert_to(tail.entry_hash || 'DUPLICATE_UUID' || tail.subject_id::text || tail.actor_user_id::text || tail.recorded_at::text || tail.payload::text,'UTF8')),'hex'),
      tail.payload,'legacy anchor'
    FROM gov_repo.governance_ledger tail CROSS JOIN gov_repo.governance_ledger first
    WHERE tail.entry_sequence=3 AND first.entry_sequence=1;`);
  assert.equal(await pg.svc('SELECT is_valid FROM gov_repo.ledger_verify(1,NULL)'),'t');
}

/** Owner-only structural fixture, always enclosed in BEGIN/ROLLBACK. Never an active epoch. */
export const baseFixture=`
 INSERT INTO gov_repo.ledger_integrity_epochs_v2 VALUES('${activation}','SHA-256',2,1,'OWNER_TEST_ONLY','${activatedAt}',4,decode(repeat('ab',32),'hex'),false);
 INSERT INTO gov_repo.ledger_global_append_head_v2 VALUES(true,'${activation}',4,decode(repeat('ab',32),'hex'));
 INSERT INTO gov_repo.ledger_tenant_genesis_v2
 SELECT '${orgA}','${chain}','${activation}',2,1,'${activatedAt}',l.recorded_at,
   sha256(gov_repo.ledger_v2_genesis_bytes('${orgA}','${chain}','${activation}','${activatedAt}'))
 FROM gov_repo.governance_ledger l WHERE l.entry_sequence=1;
 INSERT INTO gov_repo.ledger_tenant_heads_v2 SELECT organisation_id,chain_id,0,genesis_hash,0 FROM gov_repo.ledger_tenant_genesis_v2;
 INSERT INTO gov_repo.ledger_tenant_legacy_refs_v2(organisation_id,source_entry_sequence) VALUES('${orgA}',4);`;

export const entryColumns=['organisation_id','chain_id','activation_id','algorithm_version','serialization_version','tenant_sequence',
  'tenant_entry_id','source_entry_sequence','source_entry_id','previous_tenant_hash','event_type','event_description','subject_type',
  'subject_id','actor_user_id','actor_ip','actor_session_id','event_timestamp','recorded_at','payload'];
export function entryFixture(overrides: Record<string,string> = {},source=1): string {
  const values:Record<string,string>={organisation_id:'l.organisation_id',chain_id:`'${chain}'::uuid`,activation_id:`'${activation}'::uuid`,
    algorithm_version:'2',serialization_version:'1',tenant_sequence:'1::bigint',tenant_entry_id:`'${firstEntry}'::uuid`,
    source_entry_sequence:'l.entry_sequence',source_entry_id:'l.entry_id',previous_tenant_hash:'g.genesis_hash',
    event_type:'l.event_type::text',event_description:'l.event_description',subject_type:'l.subject_type::text',subject_id:'l.subject_id',
    actor_user_id:'l.actor_user_id',actor_ip:'l.actor_ip',actor_session_id:'l.actor_session_id',event_timestamp:'l.event_timestamp',recorded_at:'l.recorded_at',payload:'l.payload',...overrides};
  return `WITH v AS (SELECT ${entryColumns.map(c=>`${values[c]} AS ${c}`).join(',')}
    FROM gov_repo.governance_ledger l CROSS JOIN gov_repo.ledger_tenant_genesis_v2 g WHERE l.entry_sequence=${source})
    INSERT INTO gov_repo.ledger_tenant_entries_v2(${entryColumns.join(',')},tenant_hash)
    SELECT ${entryColumns.join(',')},sha256(gov_repo.ledger_v2_entry_bytes(organisation_id,chain_id,activation_id,tenant_sequence,
      tenant_entry_id,previous_tenant_hash,source_entry_id,event_type,event_description,subject_type,subject_id,actor_user_id,actor_ip,
      actor_session_id,event_timestamp,recorded_at,payload,algorithm_version,serialization_version)) FROM v;`;
}
