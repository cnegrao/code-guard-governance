import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  activatedAt,activation,baseFixture,chain,entryFixture,historySql,immutableTables,ledgerFoundationCluster,
  ledgerRepo,legacyInventorySql,lit,orgA,orgB,replay,seedLedger,sourceGuardsSql,v2Tables,vectors,vectorSql,
} from '../helpers/ledger-v2-foundation-fixtures';

const tableList=v2Tables.map(lit).join(',');
const relationFilter=`relnamespace='gov_repo'::regnamespace AND relname IN (${tableList})`;
const helperFilter="pronamespace='gov_repo'::regnamespace AND starts_with(proname,'ledger_v2_')";

test('M17.5 S1A1-1 inactive foundation: canonical PG17 / exact crypto / closed privileges / immutable evidence', {timeout:900_000},async t=>{
  const pg=await ledgerFoundationCluster(message=>t.diagnostic(message));
  t.after(()=>pg.stop());
  const {owner,svc,bootstrapSql}=pg;
  const rawHistoryHashes=Object.fromEntries(replay.historical.map(f=>[f.path,createHash('sha256').update(readFileSync(join(ledgerRepo,f.path))).digest('hex')]));
  await seedLedger(pg);
  const legacyBefore=await owner(legacyInventorySql),historyBefore=await owner(historySql),guardsBefore=await owner(sourceGuardsSql);
  const definerBefore=await owner("SELECT array_agg(oid ORDER BY oid)::text FROM pg_proc WHERE prosecdef AND pronamespace='gov_repo'::regnamespace");
  const appRoutinesBefore=await owner(`SELECT jsonb_agg(oid ORDER BY oid)::text FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace
    AND (has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE') OR has_function_privilege('service_role',oid,'EXECUTE'))`);
  const defaultsBefore=await owner('SELECT jsonb_agg(to_jsonb(d) ORDER BY oid)::text FROM pg_default_acl d');
  const sourceSchemaBefore=await owner(`SELECT jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'nullable',NOT attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)::text
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='gov_repo.governance_ledger'::regclass AND a.attnum>0 AND NOT a.attisdropped`);

  await t.test('A–K: full migration replay preserves valid interleaved legacy history, duplicate source UUIDs, bodies, ACLs and guards',async()=>{
    assert.equal(pg.applied.length,99);
    await pg.applyFoundation();
    assert.equal(pg.applied.length,100);
    assert.equal(await owner(legacyInventorySql),legacyBefore);
    assert.equal(await owner(historySql),historyBefore);
    assert.equal(await owner(sourceGuardsSql),guardsBefore);
    assert.equal(await svc('SELECT is_valid FROM gov_repo.ledger_verify(1,NULL)'),'t');
    assert.equal(await owner('SELECT count(*)-count(DISTINCT entry_id) FROM gov_repo.governance_ledger'),'1');
    assert.equal(await owner(`SELECT jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'nullable',NOT attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)::text
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='gov_repo.governance_ledger'::regclass AND a.attnum>0 AND NOT a.attisdropped`),sourceSchemaBefore);
    const hashes=JSON.parse(legacyBefore).map((p:{signature:string;sha256:string})=>[p.signature,p.sha256]);
    assert.deepEqual(hashes,[
      ['gov_repo.ledger_append(character varying,text,character varying,uuid,uuid,inet,uuid,jsonb)','8137f591bdd717ef18cbdc8b6146aab349626903aa9d080cebe55806190ae830'],
      ['gov_repo.ledger_verify(bigint,bigint)','d52b7bc1d274cb11dd7ef4d3424d4056deba1df9846eb1195007f3695e091ec4'],
    ]);
  });

  const counts=async()=>JSON.parse(await owner(`SELECT jsonb_build_object(${v2Tables.flatMap(name=>[lit(name),`(SELECT count(*) FROM gov_repo.${name})`]).join(',')})`));
  const emptyCounts=Object.fromEntries(v2Tables.map(n=>[n,0]));
  await t.test('G–I: no epoch, automatic genesis, tenant entry, legacy ref, head or source capture exists',async()=>{
    assert.deepEqual(await counts(),emptyCounts);
    assert.equal(await owner('SELECT count(*) FROM gov_repo.ledger_integrity_epochs_v2 WHERE is_active'),'0');
    assert.equal(await owner(`SELECT count(*) FROM pg_trigger WHERE tgrelid='gov_repo.governance_ledger'::regclass
      AND NOT tgisinternal AND tgfoid IN(SELECT oid FROM pg_proc WHERE ${helperFilter})`),'0');
  });

  await t.test('D: exact table, identity, index, RLS and immutable-trigger inventory',async()=>{
    const expectedColumns:Record<string,string[]>={
      ledger_integrity_epochs_v2:['activation_id','algorithm','algorithm_version','serialization_version','migration_identifier','activated_at','legacy_high_watermark','legacy_tip_hash','is_active'],
      ledger_global_append_head_v2:['singleton','activation_id','last_global_sequence','last_global_hash'],
      ledger_tenant_genesis_v2:['organisation_id','chain_id','activation_id','algorithm_version','serialization_version','activated_at','first_entry_recorded_at','genesis_hash'],
      ledger_tenant_heads_v2:['organisation_id','chain_id','last_tenant_sequence','last_tenant_hash','committed_count'],
      ledger_tenant_entries_v2:['organisation_id','chain_id','activation_id','algorithm_version','serialization_version','tenant_sequence','tenant_entry_id','source_entry_sequence','source_entry_id','previous_tenant_hash','tenant_hash','event_type','event_description','subject_type','subject_id','actor_user_id','actor_ip','actor_session_id','event_timestamp','recorded_at','payload'],
      ledger_tenant_legacy_refs_v2:['legacy_ref_id','organisation_id','source_entry_sequence'],
    };
    assert.deepEqual(JSON.parse(await owner(`SELECT jsonb_object_agg(relname,cols) FROM
      (SELECT c.relname,jsonb_agg(a.attname ORDER BY a.attnum) cols FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE ${relationFilter} AND a.attnum>0 AND NOT a.attisdropped GROUP BY c.relname) x`)),expectedColumns);
    const identities=JSON.parse(await owner(`SELECT jsonb_agg(jsonb_build_object('table',r.relname,'type',c.contype,
      'keys',(SELECT string_agg(a.attname,',' ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num),
      'target',CASE WHEN c.contype='f' THEN c.confrelid::regclass::text ELSE NULL END,
      'targetKeys',CASE WHEN c.contype='f' THEN (SELECT string_agg(a.attname,',' ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num) ELSE NULL END)
      ORDER BY r.relname,c.contype,c.conname) FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
      WHERE ${relationFilter} AND c.contype IN('p','u','f')`)) as {table:string;type:string;keys:string;target:string|null;targetKeys:string|null}[];
    const keys=(type:string)=>identities.filter(c=>c.type===type).map(c=>`${c.table}:${c.keys}`).sort();
    assert.deepEqual(keys('p'),[
      'ledger_integrity_epochs_v2:activation_id','ledger_global_append_head_v2:singleton',
      'ledger_tenant_genesis_v2:organisation_id,chain_id','ledger_tenant_heads_v2:organisation_id,chain_id',
      'ledger_tenant_entries_v2:organisation_id,chain_id,tenant_sequence','ledger_tenant_legacy_refs_v2:legacy_ref_id',
    ].sort());
    assert.deepEqual(keys('u'),[
      'ledger_integrity_epochs_v2:activation_id,algorithm_version,serialization_version,activated_at',
      'ledger_tenant_genesis_v2:organisation_id','ledger_tenant_genesis_v2:organisation_id,chain_id,activation_id,algorithm_version,serialization_version',
      'ledger_tenant_entries_v2:source_entry_sequence','ledger_tenant_entries_v2:organisation_id,tenant_entry_id',
      'ledger_tenant_legacy_refs_v2:source_entry_sequence',
    ].sort());
    assert.deepEqual(identities.filter(c=>c.type==='f').map(c=>`${c.table}:${c.keys}->${c.target}:${c.targetKeys}`).sort(),[
      'ledger_global_append_head_v2:activation_id->gov_repo.ledger_integrity_epochs_v2:activation_id',
      'ledger_tenant_genesis_v2:organisation_id->gov_repo.organisations:organisation_id',
      'ledger_tenant_genesis_v2:activation_id,algorithm_version,serialization_version,activated_at->gov_repo.ledger_integrity_epochs_v2:activation_id,algorithm_version,serialization_version,activated_at',
      'ledger_tenant_heads_v2:organisation_id,chain_id->gov_repo.ledger_tenant_genesis_v2:organisation_id,chain_id',
      'ledger_tenant_entries_v2:organisation_id,chain_id,activation_id,algorithm_version,serialization_version->gov_repo.ledger_tenant_genesis_v2:organisation_id,chain_id,activation_id,algorithm_version,serialization_version',
      'ledger_tenant_entries_v2:organisation_id,source_entry_sequence->gov_repo.governance_ledger:organisation_id,entry_sequence',
      'ledger_tenant_legacy_refs_v2:organisation_id->gov_repo.organisations:organisation_id',
      'ledger_tenant_legacy_refs_v2:organisation_id,source_entry_sequence->gov_repo.governance_ledger:organisation_id,entry_sequence',
    ].sort());
    assert.equal(await owner(`SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE ${relationFilter}`),'15');
    assert.equal(await owner(`SELECT bool_and(i.indisvalid AND i.indisready) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE ${relationFilter}`),'t');
    assert.equal(await owner(`SELECT count(*) FROM pg_constraint WHERE conrelid IN(SELECT oid FROM pg_class WHERE ${relationFilter}) AND NOT convalidated`),'0');
    assert.equal(await owner(`SELECT count(*) FROM pg_class WHERE ${relationFilter} AND relrowsecurity`),'6');
    assert.equal(await owner(`SELECT count(*) FROM pg_policy WHERE polrelid IN(SELECT oid FROM pg_class WHERE ${relationFilter})`),'0');
    assert.equal(await owner(`SELECT count(*) FROM pg_trigger WHERE tgrelid IN(SELECT oid FROM pg_class WHERE ${relationFilter}) AND NOT tgisinternal AND tgenabled='A'`),'13');
    assert.equal(await owner(`SELECT count(*) FROM pg_trigger WHERE tgname='ledger_v2_entry_structure' AND tgdeferrable AND tginitdeferred`),'1');
    assert.equal(await owner(`SELECT count(*) FROM pg_constraint WHERE conrelid='gov_repo.governance_ledger'::regclass AND conname='ledger_v2_source_org_sequence_key'`),'1');
    assert.equal(await owner(`SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE ${relationFilter} AND a.attnum>0 AND (a.attidentity<>'' OR a.attgenerated<>'')`),'0');
  });

  await t.test('E/F/T/U: real catalog ACLs and application attempts fail closed despite broad defaults; zero definer/RPC delta',async()=>{
    assert.equal(await owner('SELECT jsonb_agg(to_jsonb(d) ORDER BY oid)::text FROM pg_default_acl d'),defaultsBefore);
    assert.equal(await owner(`SELECT count(*) FROM pg_class c CROSS JOIN aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE ${relationFilter} AND a.grantee<>c.relowner`),'0');
    assert.equal(await owner(`SELECT count(*) FROM pg_attribute a WHERE a.attrelid IN(SELECT oid FROM pg_class WHERE ${relationFilter}) AND a.attacl IS NOT NULL`),'0');
    assert.equal(await owner(`SELECT count(*) FROM pg_proc p CROSS JOIN aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE ${helperFilter} AND a.grantee<>p.proowner`),'0');
    assert.equal(await owner(`SELECT count(*) FROM pg_class WHERE ${relationFilter} AND pg_get_userbyid(relowner)<>'postgres'`),'0');
    const functions=JSON.parse(await owner(`SELECT jsonb_agg(jsonb_build_object('name',proname,'signature',oid::regprocedure::text,
      'owner',pg_get_userbyid(proowner),'volatility',provolatile,'definer',prosecdef,'config',proconfig,'acl',proacl) ORDER BY proname) FROM pg_proc WHERE ${helperFilter}`)) as any[];
    assert.equal(functions.length,11);
    assert.deepEqual(functions.map(f=>f.name),['ledger_v2_decimal','ledger_v2_entry_bytes','ledger_v2_entry_structure','ledger_v2_frame','ledger_v2_genesis_bytes','ledger_v2_head_identity','ledger_v2_immutable','ledger_v2_integer','ledger_v2_ip','ledger_v2_json','ledger_v2_timestamp']);
    for(const f of functions){
      assert.equal(f.owner,'postgres');assert.equal(f.definer,false);assert.deepEqual(f.config,['search_path=pg_catalog, pg_temp']);
      assert.equal(f.volatility,['ledger_v2_entry_structure','ledger_v2_immutable','ledger_v2_head_identity'].includes(f.name)?'v':'i');
    }
    for(const role of ['anon','authenticated','service_role','govia_ledger_executor']){
      assert.equal(await owner(`SELECT count(*) FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(priv) WHERE ${relationFilter} AND has_table_privilege('${role}',c.oid,p.priv)`),'0',role);
      assert.equal(await owner(`SELECT count(*) FROM pg_attribute a CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(priv) WHERE a.attrelid IN(SELECT oid FROM pg_class WHERE ${relationFilter}) AND a.attnum>0 AND has_column_privilege('${role}',a.attrelid,a.attnum,p.priv)`),'0',role);
      assert.equal(await owner(`SELECT count(*) FROM pg_proc WHERE ${helperFilter} AND has_function_privilege('${role}',oid,'EXECUTE')`),'0',role);
    }
    for(const role of ['anon','authenticated','service_role'] as const){
      for(const table of v2Tables){
        const probes=[`SELECT count(*) FROM gov_repo.${table}`,`INSERT INTO gov_repo.${table} DEFAULT VALUES`,
          `UPDATE gov_repo.${table} SET ${table==='ledger_global_append_head_v2'?'singleton':table==='ledger_integrity_epochs_v2'?'activation_id':table==='ledger_tenant_legacy_refs_v2'?'legacy_ref_id':'organisation_id'}=DEFAULT`,
          `DELETE FROM gov_repo.${table}`,`TRUNCATE gov_repo.${table}`];
        // One psql per role/table, real SQL permission checks caught in subtransactions.
        const block=probes.map(q=>`BEGIN EXECUTE ${lit(q)}; RAISE EXCEPTION 'UNEXPECTED_CAPABILITY'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;`).join('\n');
        await pg.sql(`DO $probe$ BEGIN ${block} END $probe$;`,role);
      }
      await assert.rejects(pg.sql("SELECT gov_repo.ledger_v2_json('{}')",role),/42501[\s\S]*permission denied for function ledger_v2_json/);
    }
    await bootstrapSql(`CREATE ROLE ledger_v2_public_probe NOLOGIN; GRANT USAGE ON SCHEMA gov_repo TO ledger_v2_public_probe;`);
    await assert.rejects(bootstrapSql(`SET ROLE ledger_v2_public_probe; SELECT * FROM gov_repo.ledger_tenant_entries_v2`),/42501[\s\S]*permission denied for table/);
    await assert.rejects(bootstrapSql(`SET ROLE ledger_v2_public_probe; SELECT gov_repo.ledger_v2_json('{}')`),/42501[\s\S]*permission denied for function/);
    assert.equal(await owner("SELECT array_agg(oid ORDER BY oid)::text FROM pg_proc WHERE prosecdef AND pronamespace='gov_repo'::regnamespace"),definerBefore);
    assert.equal(await owner(`SELECT jsonb_agg(oid ORDER BY oid)::text FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace
      AND (has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE') OR has_function_privilege('service_role',oid,'EXECUTE'))`),appRoutinesBefore);
    // Negative control: the catalog capability predicate actually detects a grant.
    assert.equal(await owner(`BEGIN; GRANT SELECT ON gov_repo.ledger_tenant_entries_v2 TO service_role;
      SELECT has_table_privilege('service_role','gov_repo.ledger_tenant_entries_v2','SELECT'); ROLLBACK;`),'t');
    assert.equal(await owner(`SELECT has_table_privilege('service_role','gov_repo.ledger_tenant_entries_v2','SELECT')`),'f');
  });

  await t.test('L–P: all 41 original expected bytes AND SHA-256 digests are exact; environments cannot change serialization',async()=>{
    assert.equal(vectors.length,41);
    for(const vector of vectors){
      const actual=JSON.parse(await owner(`SELECT json_build_object('hex',encode(b,'hex'),'sha256',encode(sha256(b),'hex')) FROM(SELECT ${vectorSql(vector)} b) v`));
      assert.deepEqual(actual,{hex:vector.hex,sha256:vector.sha256},vector.name);
    }
    const v=(name:string)=>vectors.find(v=>v.name===name)!;
    for(const [a,b] of [['key-order-a','key-order-b'],['negative-zero','zero'],['exponent','exponent-expanded'],['ipv6','ipv6-equivalent'],['ordinary-event','timezone-equivalent']])assert.equal(v(a).hex,v(b).hex,`${a}=${b}`);
    for(const [a,b] of [['text-null','text-empty'],['array-order-a','array-order-b'],['genesis','genesis-other-organisation'],
      ['ordinary-event','other-organisation'],['ordinary-event','other-chain'],['ordinary-event','other-activation'],['ordinary-event','other-predecessor'],['ordinary-event','source-identity'],['ordinary-event','microsecond']])assert.notEqual(v(a).sha256,v(b).sha256,`${a}!=${b}`);
    const ordinary=v('ordinary-event');
    assert.equal(await owner(`SET timezone='Asia/Tokyo'; SET datestyle='SQL, DMY'; SET extra_float_digits=-3;
      SELECT encode(${vectorSql(ordinary)},'hex')`),ordinary.hex);
    for(const [value,expected] of [['1e-100','0.'+'0'.repeat(99)+'1'],['-123.450000','-123.45'],['1e100','1'+'0'.repeat(100)]])
      assert.equal(await owner(`SELECT convert_from(gov_repo.ledger_v2_decimal(${lit(value)}::numeric),'UTF8')`),expected);
  });

  await t.test('D/Q/R: owner-only rollback fixture enforces identities, all evidence-column updates, deletes and truncates',async()=>{
    const fixture=baseFixture+entryFixture()+' SET CONSTRAINTS ALL IMMEDIATE;';
    assert.equal(await owner(`BEGIN; ${fixture} SELECT count(*) FROM gov_repo.ledger_tenant_entries_v2; ROLLBACK;`),'1');
    const noRewrite=`DO $immutable_test$ DECLARE r record; BEGIN
      FOR r IN SELECT c.relname,a.attname FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
        WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname IN (${immutableTables.map(lit).join(',')}) AND a.attnum>0 AND NOT a.attisdropped LOOP
        BEGIN EXECUTE format('UPDATE gov_repo.%I SET %I=%I',r.relname,r.attname,r.attname);
          RAISE EXCEPTION 'UPDATE_ALLOWED:%:%',r.relname,r.attname;
        EXCEPTION WHEN object_not_in_prerequisite_state THEN
          IF SQLERRM<>'LEDGER_V2_IMMUTABLE' THEN RAISE; END IF;
        END;
      END LOOP;
    END $immutable_test$;`;
    await owner(`BEGIN; ${fixture} ${noRewrite} ROLLBACK;`);
    for(const table of immutableTables){
      await assert.rejects(owner(`BEGIN; ${fixture} DELETE FROM gov_repo.${table}; COMMIT;`),/55000[\s\S]*LEDGER_V2_IMMUTABLE/,table);
      await assert.rejects(owner(`BEGIN; ${fixture} TRUNCATE gov_repo.${table} CASCADE; COMMIT;`),/55000[\s\S]*LEDGER_V2_(IMMUTABLE|HEAD_IDENTITY_IMMUTABLE)/,table);
    }
    for(const q of [
      `UPDATE gov_repo.ledger_tenant_heads_v2 SET organisation_id='${orgB}'`,
      `UPDATE gov_repo.ledger_tenant_heads_v2 SET chain_id=gen_random_uuid()`,
      `UPDATE gov_repo.ledger_global_append_head_v2 SET activation_id=gen_random_uuid()`,
      `UPDATE gov_repo.ledger_global_append_head_v2 SET singleton=false`,
      'DELETE FROM gov_repo.ledger_tenant_heads_v2','DELETE FROM gov_repo.ledger_global_append_head_v2',
      'TRUNCATE gov_repo.ledger_tenant_heads_v2','TRUNCATE gov_repo.ledger_global_append_head_v2',
    ])await assert.rejects(owner(`BEGIN; ${fixture} ${q}; COMMIT;`),/55000[\s\S]*LEDGER_V2_HEAD_IDENTITY_IMMUTABLE/);
    // Only technical values may advance; no application was granted this capability.
    assert.equal(await owner(`BEGIN; ${fixture}
      UPDATE gov_repo.ledger_tenant_heads_v2 SET last_tenant_sequence=1,committed_count=1,last_tenant_hash=(SELECT tenant_hash FROM gov_repo.ledger_tenant_entries_v2);
      UPDATE gov_repo.ledger_global_append_head_v2 SET last_global_sequence=5;
      SELECT committed_count FROM gov_repo.ledger_tenant_heads_v2; ROLLBACK;`),'1');
    const rejected:[string,string,RegExp][]=[
      ['cross-organisation source',entryFixture({organisation_id:`'${orgA}'::uuid`},2),/23503/],
      ['cross-organisation chain',entryFixture({organisation_id:`'${orgB}'::uuid`}),/23503/],
      ['different chain',entryFixture({chain_id:'gen_random_uuid()'}),/23503/],
      ['different activation',entryFixture({activation_id:'gen_random_uuid()'}),/23503/],
      ['unsupported version',entryFixture({serialization_version:'2'}),/22023[\s\S]*LEDGER_V2_UNSUPPORTED_ENTRY/],
      ['source UUID mismatch',entryFixture({source_entry_id:'gen_random_uuid()'}),/23514[\s\S]*LEDGER_V2_SOURCE_IDENTITY/],
      ['missing predecessor',entryFixture({tenant_sequence:'3::bigint'}),/23514[\s\S]*LEDGER_V2_SEQUENCE_OR_PREDECESSOR/],
      ['wrong predecessor',entryFixture({previous_tenant_hash:"decode(repeat('cd',32),'hex')"}),/23514[\s\S]*LEDGER_V2_SEQUENCE_OR_PREDECESSOR/],
      ['wrong first recorded time',entryFixture({recorded_at:"l.recorded_at+interval '1 microsecond'"}),/23514[\s\S]*LEDGER_V2_FIRST_RECORDED_MISMATCH/],
    ];
    for(const [name,insert,error] of rejected)await assert.rejects(owner(`BEGIN; ${baseFixture} ${insert} SET CONSTRAINTS ALL IMMEDIATE; COMMIT;`),error,name);
    const successor=entryFixture({tenant_sequence:'2::bigint',tenant_entry_id:'gen_random_uuid()',
      previous_tenant_hash:'(SELECT tenant_hash FROM gov_repo.ledger_tenant_entries_v2 WHERE tenant_sequence=1)'},3);
    assert.equal(await owner(`BEGIN; ${fixture} ${successor} SET CONSTRAINTS ALL IMMEDIATE;
      SELECT string_agg(tenant_sequence::text,',' ORDER BY tenant_sequence) FROM gov_repo.ledger_tenant_entries_v2; ROLLBACK;`),'1,2');
    await assert.rejects(owner(`BEGIN; ${fixture} ${entryFixture({tenant_sequence:'2::bigint',tenant_entry_id:'gen_random_uuid()',previous_tenant_hash:'(SELECT tenant_hash FROM gov_repo.ledger_tenant_entries_v2 LIMIT 1)'})} COMMIT;`),/23505/,'source may not be captured twice');
    await assert.rejects(owner(`BEGIN; ${baseFixture} INSERT INTO gov_repo.ledger_tenant_legacy_refs_v2(organisation_id,source_entry_sequence) VALUES('${orgB}',1); COMMIT;`),/23503/,'legacy source must be own organisation');
    await assert.rejects(owner(`BEGIN; ${baseFixture} INSERT INTO gov_repo.ledger_tenant_legacy_refs_v2(organisation_id,source_entry_sequence) VALUES('${orgA}',4); COMMIT;`),/23505/,'no duplicate legacy mapping');
    assert.deepEqual(await counts(),emptyCounts);
  });

  await t.test('S: unsupported encodings reject atomically without consuming an epoch, source row, head or legacy reference',async()=>{
    const ordinary=vectors.find(v=>v.name==='ordinary-event')!;
    const probes=[
      "gov_repo.ledger_v2_frame(12,''::bytea)","gov_repo.ledger_v2_frame(0,''::bytea)",
      "gov_repo.ledger_v2_decimal('NaN')","gov_repo.ledger_v2_decimal('Infinity')","gov_repo.ledger_v2_decimal('-Infinity')",
      "gov_repo.ledger_v2_timestamp('infinity')", "gov_repo.ledger_v2_json('NaN'::jsonb)",
      `gov_repo.ledger_v2_json(('"' || chr(92) || 'u0000"')::jsonb)`,
      vectorSql({...ordinary,args:{...ordinary.args,previous:'ab'}}),
      vectorSql({...ordinary,args:{...ordinary.args,sequence:'0'}}),
    ];
    for(const expression of probes){
      // Bootstrap controls role switching only in this disposable transaction:
      // the unchanged legacy append is service-only, serializers are owner-only.
      await assert.rejects(bootstrapSql(`BEGIN; SET LOCAL ROLE postgres; ${baseFixture}
        SET LOCAL ROLE service_role;
        SELECT gov_repo.ledger_append('ABORTED','must roll back','SYSTEM',gen_random_uuid(),gen_random_uuid(),NULL,'${orgA}','{}');
        SET LOCAL ROLE postgres;
        SELECT ${expression}; COMMIT;`),/22[0-9A-Z]{3}/,expression);
      assert.deepEqual(await counts(),emptyCounts);
      assert.equal(await owner(historySql),historyBefore,'all source rows and hash bytes survive aborted transaction');
    }
  });

  await t.test('postflight: historical raw bytes unchanged; source behavior still legacy; V2 remains inactive',async()=>{
    for(const file of replay.historical)assert.equal(createHash('sha256').update(readFileSync(join(ledgerRepo,file.path))).digest('hex'),rawHistoryHashes[file.path],file.path);
    assert.deepEqual(await counts(),emptyCounts);
    assert.equal(await owner(legacyInventorySql),legacyBefore);
    assert.equal(await owner(sourceGuardsSql),guardsBefore);
    assert.equal(await svc('SELECT is_valid FROM gov_repo.ledger_verify(1,NULL)'),'t');
    const sequence=await svc(`SELECT gov_repo.ledger_append('AFTER_V2_SCHEMA','still legacy','SYSTEM',gen_random_uuid(),gen_random_uuid(),NULL,'${orgA}','{}')`);
    assert.ok(Number(sequence)>4);
    assert.deepEqual(await counts(),emptyCounts,'a real app append after migration creates no V2 state');
    assert.equal(await svc('SELECT is_valid FROM gov_repo.ledger_verify(1,NULL)'),'t');
    const catalog={
      replay:{historical:121,canonicalPrior:99,applied:pg.applied,excluded:replay.excluded},
      environment:{serverVersionNum:await owner('SHOW server_version_num'),pgvector:await owner("SELECT extversion FROM pg_extension WHERE extname='vector'"),bin:process.env.M16_PG17_BIN},
      tables:JSON.parse(await owner(`SELECT jsonb_agg(jsonb_build_object('table',relname,'owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'acl',relacl) ORDER BY relname) FROM pg_class WHERE ${relationFilter}`)),
      columns:JSON.parse(await owner(`SELECT jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl) ORDER BY c.relname,a.attnum)
        FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE ${relationFilter} AND a.attnum>0 AND NOT a.attisdropped`)),
      constraints:JSON.parse(await owner(`SELECT jsonb_agg(jsonb_build_object('table',r.relname,'name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated) ORDER BY r.relname,c.conname) FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid WHERE ${relationFilter}`)),
      indexes:JSON.parse(await owner(`SELECT jsonb_agg(jsonb_build_object('table',c.relname,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY c.relname,i.indexrelid::regclass::text) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE ${relationFilter}`)),
      triggers:JSON.parse(await owner(`SELECT jsonb_agg(jsonb_build_object('table',r.relname,'name',g.tgname,'definition',pg_get_triggerdef(g.oid),'enabled',g.tgenabled) ORDER BY r.relname,g.tgname) FROM pg_trigger g JOIN pg_class r ON r.oid=g.tgrelid WHERE ${relationFilter} AND NOT g.tgisinternal`)),
      functions:JSON.parse(await owner(`SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'owner',pg_get_userbyid(proowner),'volatility',provolatile,'securityDefiner',prosecdef,'config',proconfig,'acl',proacl) ORDER BY proname) FROM pg_proc WHERE ${helperFilter}`)),
      defaults:JSON.parse(defaultsBefore),legacyFunctions:JSON.parse(legacyBefore),inactive:await counts(),goldenVectors:vectors.map(v=>({name:v.name,sha256:v.sha256,result:'PASS'})),
    };
    const directory=join(ledgerRepo,'.artifacts/agent');mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,'ledger-v2-foundation-catalog.json'),JSON.stringify(catalog,null,2)+'\n');
    t.diagnostic('Measured catalog written to .artifacts/agent/ledger-v2-foundation-catalog.json; active epochs=0; all six technical tables empty');
  });
});
