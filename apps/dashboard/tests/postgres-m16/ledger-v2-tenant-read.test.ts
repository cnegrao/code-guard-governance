import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ledgerFoundationCluster, ledgerRepo, seedLedger, orgA, orgB, lit, v2Tables } from '../helpers/ledger-v2-foundation-fixtures';

const migration='20261021201316_m175_v1_s1a1_2b_ledger_v2_tenant_read.sql';
const writeMigration='20261021134359_m175_v1_s1a1_2a_ledger_v2_write_cutover.sql';
const activate=`CALL gov_repo.ledger_v2_activate(ARRAY['discovery_scan','talk_governance_logging']);`;
const now='floor(extract(epoch from clock_timestamp()))::bigint';
type Actor={id:string;org:string;epoch:string};
function principal(a:Actor,overrides:Record<string,string>={}) {
  return Object.entries({p_verified_organisation_id:lit(a.org),p_verified_actor_user_id:lit(a.id),
    p_verified_session_iat:`(${now}-10)`,p_verified_session_exp:`(${now}+3600)`,
    p_verified_credential_epoch:`${lit(a.epoch)}::timestamptz`,p_organisation_id:lit(a.org),...overrides})
    .map(([k,v])=>`${k}=>${v}`).join(',');
}
const verify=(a:Actor,o:Record<string,string>={})=>`gov_repo.ledger_tenant_verify_v2(${principal(a,o)})`;
const list=(a:Actor,args='',o:Record<string,string>={})=>`gov_repo.ledger_tenant_events_v2(${principal(a,o)}${args?','+args:''})`;
const detail=(a:Actor,kind:string,id:string,o:Record<string,string>={})=>
  `gov_repo.ledger_tenant_event_v2(${principal(a,o)},p_kind=>${lit(kind)},p_event_id=>${lit(id)})`;
const append=(a:Actor)=>`SELECT gov_repo.ledger_append_v2(${principal(a)},p_event_type=>'READ_TEST',
  p_event_desc=>'Retained record',p_subject_type=>'SYSTEM',p_subject_id=>${lit(a.id)},
  p_payload=>'{"human_oversight_verified":true,"oversight_level":"FULL","semantic_truth":false}'::jsonb);`;

test('S1A1-2B real PG17 tenant read boundary, cryptographic coverage, ACLs and snapshots',{timeout:900_000},async t=>{
  const pg=await ledgerFoundationCluster(m=>t.diagnostic(m));t.after(()=>pg.stop());
  const {owner,svc,bootstrapSql}=pg;
  await seedLedger(pg);await pg.applyFoundation();
  await owner(readFileSync(join(ledgerRepo,'supabase/migrations',writeMigration),'utf8'));
  const oldState=()=>owner(`SELECT jsonb_build_object('routines',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p
    WHERE pronamespace='gov_repo'::regnamespace AND (proname LIKE 'ledger_v2_%' OR proname IN('ledger_append','ledger_append_v2','ledger_verify'))),
    'tables',(SELECT jsonb_agg(jsonb_build_object('name',relname,'owner',relowner,'acl',relacl,'rls',relrowsecurity) ORDER BY relname)
      FROM pg_class WHERE relnamespace='gov_repo'::regnamespace AND relkind='r'),
    'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attrelid,attnum) FROM pg_attribute a WHERE attacl IS NOT NULL),
    'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d))::text`);
  // New helper is removed from comparison, leaving the exact old routine catalog unchanged.
  const before=JSON.parse(await oldState());
  const definerBefore=Number(await owner('SELECT count(*) FROM pg_proc WHERE prosecdef'));
  await owner(readFileSync(join(ledgerRepo,'supabase/migrations',migration),'utf8'));
  const after=JSON.parse(await oldState());
  after.routines=after.routines.filter((p:any)=>p.proname!=='ledger_v2_event_document');
  assert.deepEqual(after,before,'no old routine/table/column/default ACL mutation');
  assert.equal(Number(await owner('SELECT count(*) FROM pg_proc WHERE prosecdef')),definerBefore+3);
  const newOrg=async()=>{const id=randomUUID();await owner(`INSERT INTO gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code)
    VALUES('${id}','R_${id.slice(0,8)}','Read','Read','BR')`);return id;};
  const actor=async(org:string):Promise<Actor>=>{
    const id=randomUUID();await owner(`INSERT INTO gov_repo.governance_users(user_id,email,full_name,organisation_id,status,role_ids)
      SELECT '${id}','${id}@example.invalid','Reader','${org}','active',ARRAY[role_id] FROM gov_repo.governance_roles WHERE role_code='POLICY_OWNER'`);
    await bootstrapSql(`BEGIN; ALTER TABLE gov_repo.governance_users DISABLE TRIGGER trg_governance_users_credential_epoch_v1;
      UPDATE gov_repo.governance_users SET password_changed_at=clock_timestamp()-interval '12 hours' WHERE user_id='${id}';
      ALTER TABLE gov_repo.governance_users ENABLE ALWAYS TRIGGER trg_governance_users_credential_epoch_v1; COMMIT;`);
    return {id,org,epoch:await owner(`SELECT password_changed_at::text FROM gov_repo.governance_users WHERE user_id='${id}'`)};
  };
  const a=await actor(orgA),b=await actor(orgB),empty=await actor(await newOrg());
  const read=async(a:Actor)=>JSON.parse(await svc(`SELECT ${verify(a)}`));
  const page=async(a:Actor,args='')=>JSON.parse(await svc(`SELECT ${list(a,args)}`));
  await t.test('inactive migration never activates; owner-only activation still works after read addition',async()=>{
    for(const table of v2Tables)assert.equal(await owner(`SELECT count(*) FROM gov_repo.${table}`),'0');
    assert.equal((await read(a)).status,'UNKNOWN');
    for(const role of ['service_role','anon','authenticated'] as const)await assert.rejects(pg.sql(activate,role),/permission denied/);
    await owner(activate);
    assert.deepEqual([(await read(a)).status,(await read(a)).history],['EMPTY','LEGACY_GLOBAL_ONLY']);
    assert.deepEqual([(await read(empty)).status,(await read(empty)).history],['EMPTY','NO_LEGACY_ENTRIES']);
  });
  const aIds:string[]=[];aIds.push(await svc(append(a)));await svc(append(b));
  aIds.push(await svc(append(a)));aIds.push(await svc(append(a)));
  const bPage=await page(b);const bId=bPage.events.find((x:any)=>x.kind==='V2').event_id;
  const bLegacy=bPage.events.find((x:any)=>x.kind==='LEGACY').event_id;
  const aBaseline=await read(a),bBaseline=await read(b);
  await t.test('A/B independently VALID; V2+legacy retains separate history and payload authority',async()=>{
    assert.equal(aBaseline.status,'VALID');assert.equal(aBaseline.checked_entries,'3');assert.equal(aBaseline.verified_through,'3');
    assert.equal(aBaseline.history,'LEGACY_GLOBAL_ONLY');assert.equal(bBaseline.status,'VALID');
    await svc(append(empty));assert.deepEqual([(await read(empty)).status,(await read(empty)).history],['VALID','NO_LEGACY_ENTRIES']);
    const p=await page(a);assert.equal(p.events.length,6);
    assert.equal(p.events[0].payload.human_oversight_verified,true);
    for(const e of p.events){assert.equal(e.legacy_payload_authority,'LEGACY_NON_AUTHORITATIVE');
      assert.equal(e.payload_authority,e.kind==='V2'?'RETAINED_RECORD_ONLY':'LEGACY_NON_AUTHORITATIVE');}
    assert.equal(aBaseline.integrity_meaning,'RETAINED_RECORD_INTEGRITY_ONLY');
  });

  // Superuser/owner-only negative fixtures. DDL/bytes always roll back; ordinary roles cannot do this.
  const loosen=`
    ${[...v2Tables,'governance_ledger'].map(n=>`ALTER TABLE gov_repo.${n} DISABLE TRIGGER ALL;`).join('\n')}
    DROP RULE governance_ledger_immutable_core ON gov_repo.governance_ledger;
    DROP RULE governance_ledger_no_delete ON gov_repo.governance_ledger;
    DO $checks$ DECLARE c record; BEGIN FOR c IN SELECT conrelid::regclass AS tab,conname FROM pg_constraint
      WHERE connamespace='gov_repo'::regnamespace AND contype='c'
        AND conrelid IN(${[...v2Tables,'governance_ledger'].map(n=>`'gov_repo.${n}'::regclass`).join(',')}) LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.tab,c.conname); END LOOP; END $checks$; SET LOCAL ROLE postgres;`;
  async function corrupt(sql:string,expected:string,target:Actor=a,other:Actor=b,reason?:string){
    const raw=await bootstrapSql(`BEGIN; ${loosen} ${sql}; SET LOCAL ROLE service_role;
      SELECT jsonb_build_object('target',${verify(target)},'other',${verify(other)}); ROLLBACK;`);
    const x=JSON.parse(raw);assert.equal(x.target.status,expected,sql);if(reason)assert.equal(x.target.reason,reason,sql);
    assert.deepEqual(x.other,other===b?bBaseline:aBaseline,'foreign corruption cannot change own verification');
    return x.target;
  }
  await t.test('cryptographic isolation: A corrupt hash does not affect B and B corruption does not affect A',async()=>{
    await corrupt(`UPDATE gov_repo.ledger_tenant_entries_v2 SET tenant_hash=decode(repeat('ab',32),'hex') WHERE tenant_entry_id='${aIds[1]}'`,'BROKEN');
    await corrupt(`UPDATE gov_repo.ledger_tenant_entries_v2 SET tenant_hash=decode(repeat('ab',32),'hex') WHERE tenant_entry_id='${bId}'`,'BROKEN',b,a);
  });
  await t.test('complete population: missing middle/tail/all capture, dangling/extra entry, captured content/UUID/org and head failures',async()=>{
    const cases=[
      `DELETE FROM gov_repo.ledger_tenant_entries_v2 WHERE tenant_entry_id='${aIds[1]}'`,
      `DELETE FROM gov_repo.ledger_tenant_entries_v2 WHERE tenant_entry_id='${aIds[2]}'`,
      `DELETE FROM gov_repo.ledger_tenant_entries_v2 WHERE organisation_id='${orgA}'`,
      `UPDATE gov_repo.ledger_tenant_entries_v2 SET source_entry_sequence=999999 WHERE tenant_entry_id='${aIds[1]}'`,
      `UPDATE gov_repo.ledger_tenant_entries_v2 SET source_entry_id=gen_random_uuid() WHERE tenant_entry_id='${aIds[1]}'`,
      `UPDATE gov_repo.ledger_tenant_entries_v2 SET event_description='tampered' WHERE tenant_entry_id='${aIds[1]}'`,
      `UPDATE gov_repo.governance_ledger SET event_description='source-only drift' WHERE entry_sequence=(SELECT source_entry_sequence FROM gov_repo.ledger_tenant_entries_v2 WHERE tenant_entry_id='${aIds[1]}')`,
      `DELETE FROM gov_repo.governance_ledger WHERE entry_sequence=(SELECT source_entry_sequence FROM gov_repo.ledger_tenant_entries_v2 WHERE tenant_entry_id='${aIds[1]}')`,
      `UPDATE gov_repo.ledger_tenant_entries_v2 SET tenant_entry_id=gen_random_uuid() WHERE tenant_entry_id='${aIds[1]}'`,
      `UPDATE gov_repo.ledger_tenant_entries_v2 SET activation_id=gen_random_uuid() WHERE tenant_entry_id='${aIds[1]}'`,
      `UPDATE gov_repo.ledger_tenant_entries_v2 SET chain_id=gen_random_uuid() WHERE tenant_entry_id='${aIds[1]}'`,
      `UPDATE gov_repo.ledger_tenant_entries_v2 SET previous_tenant_hash=decode(repeat('ab',32),'hex') WHERE tenant_entry_id='${aIds[1]}'`,
      `UPDATE gov_repo.ledger_tenant_heads_v2 SET committed_count=42 WHERE organisation_id='${orgA}'`,
      `UPDATE gov_repo.ledger_tenant_heads_v2 SET last_tenant_sequence=42 WHERE organisation_id='${orgA}'`,
      `UPDATE gov_repo.ledger_tenant_heads_v2 SET last_tenant_hash=decode(repeat('ab',32),'hex') WHERE organisation_id='${orgA}'`,
      `UPDATE gov_repo.ledger_tenant_genesis_v2 SET genesis_hash=decode(repeat('ab',32),'hex') WHERE organisation_id='${orgA}'`,
      `UPDATE gov_repo.governance_ledger SET organisation_id='${orgB}' WHERE entry_sequence=(SELECT source_entry_sequence FROM gov_repo.ledger_tenant_entries_v2 WHERE tenant_entry_id='${aIds[1]}')`,
    ];
    // This source org reassignment deliberately changes B's own source population too.
    for(const sql of cases.slice(0,-1))await corrupt(sql,'BROKEN');
    const reassigned=await bootstrapSql(`BEGIN; ${loosen} ${cases.at(-1)}; SET LOCAL ROLE service_role; SELECT ${verify(a)}; ROLLBACK;`);
    assert.equal(JSON.parse(reassigned).status,'BROKEN');
    const first=await owner(`SELECT source_entry_sequence FROM gov_repo.ledger_tenant_entries_v2 WHERE tenant_entry_id='${aIds[0]}'`);
    await corrupt(`UPDATE gov_repo.ledger_tenant_entries_v2 SET source_entry_sequence=${first} WHERE tenant_entry_id='${aIds[1]}'`.replace('UPDATE','ALTER TABLE gov_repo.ledger_tenant_entries_v2 DROP CONSTRAINT ledger_tenant_entries_v2_source_entry_sequence_key; UPDATE'),'BROKEN');
    await corrupt(`INSERT INTO gov_repo.ledger_tenant_entries_v2 SELECT organisation_id,chain_id,activation_id,algorithm_version,serialization_version,
      4,gen_random_uuid(),999999,source_entry_id,previous_tenant_hash,tenant_hash,event_type,event_description,subject_type,subject_id,
      actor_user_id,actor_ip,actor_session_id,event_timestamp,recorded_at,payload FROM gov_repo.ledger_tenant_entries_v2 WHERE tenant_entry_id='${aIds[0]}'`,'BROKEN');
  });
  await t.test('unsupported encodings/missing metadata/dependencies => UNKNOWN; never BROKEN',async()=>{
    await corrupt(`UPDATE gov_repo.ledger_tenant_entries_v2 SET serialization_version=99 WHERE tenant_entry_id='${aIds[0]}'`,'UNKNOWN',a,b,'UNSUPPORTED_ENCODING');
    await corrupt(`DELETE FROM gov_repo.ledger_tenant_heads_v2 WHERE organisation_id='${orgA}'`,'UNKNOWN');
    await corrupt(`DELETE FROM gov_repo.ledger_tenant_genesis_v2 WHERE organisation_id='${orgA}'`,'UNKNOWN');
    await corrupt(`UPDATE gov_repo.ledger_tenant_heads_v2 SET last_tenant_hash=decode('ab','hex') WHERE organisation_id='${orgA}'`,'UNKNOWN');
    const x=JSON.parse(await bootstrapSql(`BEGIN; ${loosen} UPDATE gov_repo.ledger_integrity_epochs_v2 SET is_active=false;
      SET LOCAL ROLE service_role; SELECT ${verify(a)}; ROLLBACK;`));assert.equal(x.status,'UNKNOWN');assert.equal(x.history,'UNKNOWN');
    const unavailable=JSON.parse(await owner(`BEGIN; ALTER TABLE gov_repo.ledger_tenant_entries_v2 RENAME TO owner_dependency_missing;
      SELECT ${verify(a)}; ROLLBACK;`));assert.equal(unavailable.status,'UNKNOWN');assert.equal(unavailable.reason,'ACQUISITION_UNAVAILABLE');
  });
  await t.test('scan bounds on either source or captured population => UNKNOWN with no prefix assurance',async()=>{
    const source=`INSERT INTO gov_repo.governance_ledger(event_type,event_description,subject_type,subject_id,actor_user_id,organisation_id,
      event_timestamp,recorded_at,previous_hash,entry_hash,payload)
      SELECT 'BOUND','bounded','SYSTEM','${a.id}','${a.id}','${orgA}',clock_timestamp(),clock_timestamp(),repeat('a',64),repeat('a',64),'{}'
      FROM generate_series(1,10001);`;
    const x=await corrupt(source,'UNKNOWN',a,b,'SCAN_BOUND');assert.equal(x.checked_entries,null);assert.equal(x.verified_through,null);
    await corrupt(`INSERT INTO gov_repo.ledger_tenant_entries_v2 SELECT organisation_id,chain_id,activation_id,algorithm_version,serialization_version,
      n+100,gen_random_uuid(),n+100000,source_entry_id,previous_tenant_hash,tenant_hash,event_type,event_description,subject_type,subject_id,
      actor_user_id,actor_ip,actor_session_id,event_timestamp,recorded_at,payload FROM gov_repo.ledger_tenant_entries_v2 CROSS JOIN generate_series(1,10001) n
      WHERE tenant_entry_id='${aIds[0]}'`,'UNKNOWN',a,b,'SCAN_BOUND');
  });
  await t.test('all three RPCs unconditionally reject missing/spoofed/stale/expired/disabled/ineligible principals and cross-org targets',async()=>{
    const invalid:Record<string,string>[]=[{p_organisation_id:lit(orgB)},{p_organisation_id:lit(randomUUID())},
      {p_verified_organisation_id:lit(orgB)},{p_verified_actor_user_id:lit(b.id)},{p_verified_actor_user_id:lit(randomUUID())},
      {p_verified_session_exp:`(${now}-1)`,p_verified_session_iat:`(${now}-4000)`},
      {p_verified_session_iat:`(${now}-86400)`},
      {p_verified_credential_epoch:`${lit(a.epoch)}::timestamptz-interval '1 microsecond'`},
      {p_verified_organisation_id:'NULL',p_verified_actor_user_id:'NULL',p_verified_session_iat:'NULL',p_verified_session_exp:'NULL',p_verified_credential_epoch:'NULL'}];
    for(const o of invalid)for(const expr of [verify(a,o),list(a,'',o),detail(a,'V2',aIds[0],o)])await assert.rejects(svc(`SELECT ${expr}`),/GV00[1234]/);
    for(const sql of [`UPDATE gov_repo.governance_users SET status='suspended' WHERE user_id='${a.id}'`,
      `UPDATE gov_repo.organisations SET is_active=false WHERE organisation_id='${orgA}'`]){
      for(const expr of [verify(a),list(a),detail(a,'V2',aIds[0])])await assert.rejects(owner(`BEGIN; ${sql}; SELECT ${expr}; ROLLBACK;`),/GV003/);
    }
    for(const role of ['anon','authenticated'] as const)for(const expr of [verify(a),list(a),detail(a,'V2',aIds[0])])await assert.rejects(pg.sql(`SELECT ${expr}`,role),/permission denied/);
  });
  await t.test('detail foreign and nonexistent handles indistinguishable for V2 and legacy; exact own detail only',async()=>{
    for(const [kind,foreign] of [['V2',bId],['LEGACY',bLegacy]]){
      assert.equal(await svc(`SELECT ${detail(a,kind,foreign)} IS NULL`),'t');
      assert.equal(await svc(`SELECT ${detail(a,kind,randomUUID())} IS NULL`),'t');
    }
    for(const e of (await page(a)).events){const x=JSON.parse(await svc(`SELECT ${detail(a,e.kind,e.event_id)}`));assert.deepEqual(x,e);}
    await assert.rejects(svc(`SELECT ${detail(a,'GLOBAL',aIds[0])}`),/22023/);
  });
  await t.test('deterministic bounded paging: own cursors, no global ordering in output, exact literal filters',async()=>{
    const full=await page(a),seen:any[]=[];let c:string|null=null;
    do{const p=await page(a,`p_limit=>2${c?`,p_cursor=>${lit(c)}`:''}`);seen.push(...p.events);c=p.next_cursor;}while(c);
    assert.deepEqual(seen,full.events);assert.deepEqual(seen.filter(e=>e.kind==='V2').map(e=>e.tenant_sequence),['3','2','1']);
    assert.equal(new Set(seen.map(e=>e.event_id)).size,seen.length);
    for(const e of seen){assert.equal(e.organisation_id,orgA);assert.match(e.event_id,/^[0-9a-f-]{36}$/);}
    const p=await page(a,'p_limit=>1');assert.match(p.next_cursor,/^V2:[0-9a-f-]{36}$/);
    for(const c of [p.next_cursor,'V2:'+randomUUID(),'LEGACY:'+bLegacy,'garbage','V2:1']){
      if(c===p.next_cursor)await assert.rejects(svc(`SELECT ${list(b,`p_cursor=>${lit(c)}`)}`),/22023[\s\S]*INVALID_CURSOR/);
      else await assert.rejects(svc(`SELECT ${list(a,`p_cursor=>${lit(c)}`)}`),/22023[\s\S]*INVALID_CURSOR/);
    }
    for(const n of ['0','101','NULL','-1'])await assert.rejects(svc(`SELECT ${list(a,`p_limit=>${n}`)}`),/22023/);
    assert.equal((await page(a,"p_event_type=>'READ_TEST'")).events.length,3);
    assert.deepEqual((await page(a,`p_event_type=>${lit("READ_TEST%' OR true --")}`)).events,[]);
    const forbidden=['entry_sequence','source_entry_sequence','source_entry_id','previous_hash','entry_hash','previous_tenant_hash','tenant_hash','global','total'];
    for(const key of forbidden)assert.ok(!Object.hasOwn(full,key));
    for(const e of full.events)for(const key of forbidden)assert.ok(!Object.hasOwn(e,key));
  });
  await t.test('global BROKEN and global verifier unusable leave V2 unchanged; semantic-false legacy remains non-authoritative',async()=>{
    const x=JSON.parse(await bootstrapSql(`BEGIN; ${loosen}
      UPDATE gov_repo.governance_ledger SET entry_hash=repeat('b',64),payload='{"oversight_verified":true,"semantic_truth":false}' WHERE entry_sequence=1;
      SELECT jsonb_build_object('global',(SELECT is_valid FROM gov_repo.ledger_verify(1,NULL)),
        'tenant',${verify(a)},'events',${list(a)}); ROLLBACK;`));
    assert.equal(x.global,false);assert.deepEqual(x.tenant,aBaseline);
    assert.equal(x.events.events.find((e:any)=>e.payload.semantic_truth===false&&e.kind==='LEGACY').payload_authority,'LEGACY_NON_AUTHORITATIVE');
    const unavailable=JSON.parse(await bootstrapSql(`BEGIN; ALTER FUNCTION gov_repo.ledger_verify(bigint,bigint) RENAME TO owner_global_verifier_unavailable;
      SELECT ${verify(a)}; ROLLBACK;`));assert.deepEqual(unavailable,aBaseline);
  });
  await t.test('snapshot race: append holds uncommitted source/entry/head; verifier retains coherent pre-state through commit, next call sees post-state',async()=>{
    const writer=pg.session('service_role'),reader=pg.session('service_role'),monitor=pg.session('m16_bootstrap');
    const gate='ledger_v2_read_snapshot_gate';
    try{
      const wp=(await writer.run('SELECT pg_backend_pid();')).out,rp=(await reader.run('SELECT pg_backend_pid();')).out;
      // Observe the actual integrity query reaching its first canonical hash inside its snapshot.
      // Owner-only wrapper around an unchanged serializer, restored by transaction at cleanup.
      await bootstrapSql(`ALTER FUNCTION gov_repo.ledger_v2_genesis_bytes(uuid,uuid,uuid,timestamptz,integer,integer) RENAME TO ledger_v2_genesis_bytes_original;
        CREATE FUNCTION gov_repo.ledger_v2_genesis_bytes(uuid,uuid,uuid,timestamptz,integer DEFAULT 2,integer DEFAULT 1)
        RETURNS bytea LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $gate$
        BEGIN IF current_setting('application_name')='ledger_v2_read_test' THEN PERFORM pg_advisory_xact_lock(175,99); END IF;
          RETURN gov_repo.ledger_v2_genesis_bytes_original($1,$2,$3,$4,$5,$6); END $gate$;
        ALTER FUNCTION gov_repo.ledger_v2_genesis_bytes(uuid,uuid,uuid,timestamptz,integer,integer) OWNER TO postgres;
        REVOKE ALL ON FUNCTION gov_repo.ledger_v2_genesis_bytes(uuid,uuid,uuid,timestamptz,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
        GRANT EXECUTE ON FUNCTION gov_repo.ledger_v2_genesis_bytes(uuid,uuid,uuid,timestamptz,integer,integer) TO govia_ledger_executor;`);
      // Complete the append first, before taking the verification-only observation gate.
      assert.equal((await writer.run(`BEGIN; ${append(a)}`)).err,'');
      await monitor.run('BEGIN; SELECT pg_advisory_xact_lock(175,99);');
      await reader.run("SET application_name='ledger_v2_read_test';");
      const mp=(await monitor.run('SELECT pg_backend_pid();')).out;
      const pending=reader.run(`SELECT ${verify(a)};`);
      let observed=false;
      for(let i=0;i<200;i++){
        const r=await bootstrapSql(`SELECT wait_event_type='Lock' AND pg_blocking_pids(pid) @> ARRAY[${mp}] FROM pg_stat_activity WHERE pid=${rp}`);
        if(r==='t'){observed=true;break;}await new Promise(r=>setTimeout(r,10));
      }
      assert.ok(observed,`${gate}: real reader ${rp} blocked by monitor ${mp}, writer ${wp} retains append`);
      assert.equal((await writer.run('COMMIT;')).err,'');
      await monitor.run('COMMIT;');const pre=await pending;assert.equal(pre.err,'');
      assert.deepEqual(JSON.parse(pre.out),aBaseline,'no mixed old population/new head VALID');
      const post=await read(a);assert.equal(post.status,'VALID');assert.equal(post.checked_entries,'4');assert.equal(post.verified_through,'4');
    }finally{
      await writer.close();await reader.close();await monitor.close();
      await bootstrapSql(`DROP FUNCTION gov_repo.ledger_v2_genesis_bytes(uuid,uuid,uuid,timestamptz,integer,integer);
        ALTER FUNCTION gov_repo.ledger_v2_genesis_bytes_original(uuid,uuid,uuid,timestamptz,integer,integer) RENAME TO ledger_v2_genesis_bytes;`);
    }
  });
  await t.test('isolated server adapter -> actual service-role RPC -> real PG17 data; exact epoch and denial semantics',async()=>{
    Object.assign(process.env,{SUPABASE_URL:'http://127.0.0.1:9',SUPABASE_ANON_KEY:'local-anon',SUPABASE_SERVICE_ROLE_KEY:'local-service'});
    const {db}=await import('../../lib/db');const calls:string[]=[];
    Object.assign(db,{write:{rpc:async(name:string,args:Record<string,unknown>)=>{
      assert.ok(['ledger_tenant_verify_v2','ledger_tenant_events_v2','ledger_tenant_event_v2'].includes(name));calls.push(name);
      try{return {data:JSON.parse(await svc(`SELECT coalesce(${'gov_repo.'+name}(${Object.entries(args).map(([k,v])=>`${k}=>${lit(v)}`).join(',')}),'null'::jsonb)`)),error:null};}
      catch(e){const message=String(e);return {data:null,error:{code:message.match(/(?:ERROR:\s+)([A-Z0-9]{5}):/)?.[1]??'XX000',message}};}
    }}});
    const adapter=await import('../../lib/governance/ledger-read');
    const p={userId:a.id,organisationId:a.org,credentialEpoch:a.epoch,issuedAtSeconds:Number(await owner(`SELECT ${now}-10`)),
      expiresAtSeconds:Number(await owner(`SELECT ${now}+3600`)),informational:{role:'ignored'}};
    assert.equal((await adapter.verifyTenantLedger(p)).status,'VALID');
    const first=await adapter.listTenantLedgerEvents(p,{limit:2});assert.equal(first.events.length,2);assert.ok(first.next_cursor);
    const next=await adapter.listTenantLedgerEvents(p,{limit:2,cursor:first.next_cursor!});assert.equal(next.events.length,2);
    for(const e of first.events)assert.deepEqual(await adapter.getTenantLedgerEvent(p,e.kind,e.event_id),e);
    assert.equal(await adapter.getTenantLedgerEvent(p,'V2',bId),null);
    await assert.rejects(()=>adapter.listTenantLedgerEvents(p,{cursor:'LEGACY:'+bLegacy}),RangeError);
    await assert.rejects(()=>adapter.verifyTenantLedger({...p,organisationId:b.org}),adapter.LedgerReadAuthorizationError);
    await assert.rejects(()=>adapter.verifyTenantLedger({...p,credentialEpoch:'2000-01-01T00:00:00.000001+00:00'}),adapter.LedgerReadAuthorizationError);
    assert.deepEqual(new Set(calls),new Set(['ledger_tenant_verify_v2','ledger_tenant_events_v2','ledger_tenant_event_v2']));
  });
  await t.test('measured ACL catalog: exactly three new definers, private invoker helper, no application tamper/SELECT grants',async()=>{
    const routines=JSON.parse(await owner(`SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(proowner),
      'definer',prosecdef,'volatility',provolatile,'config',proconfig,'acl',proacl,
      'publicExecute',EXISTS(SELECT FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
      'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE'),
      'executorExecute',has_function_privilege('govia_ledger_executor',p.oid,'EXECUTE')) ORDER BY proname)
      FROM pg_proc p WHERE pronamespace='gov_repo'::regnamespace AND proname IN('ledger_tenant_verify_v2','ledger_tenant_events_v2','ledger_tenant_event_v2','ledger_v2_event_document')`));
    assert.equal(routines.length,4);
    for(const r of routines){assert.equal(r.owner,'postgres');assert.equal(r.publicExecute,false);assert.equal(r.anonExecute,false);assert.equal(r.authenticatedExecute,false);
      assert.equal(r.executorExecute,false);assert.equal(r.serviceExecute,r.definer);assert.equal(r.definer,r.volatility==='v');
      assert.ok(r.config.includes('search_path=pg_catalog, pg_temp'));}
    for(const role of ['service_role','anon','authenticated'] as const){
      for(const table of v2Tables)await assert.rejects(pg.sql(`SELECT * FROM gov_repo.${table}`,role),/permission denied/);
      await assert.rejects(pg.sql(`SELECT gov_repo.ledger_v2_event_document('${orgA}','V2','${aIds[0]}')`,role),/permission denied/);
      await assert.rejects(pg.sql('SELECT * FROM gov_repo.ledger_verify(1,NULL)',role),/permission denied/);
      await assert.rejects(pg.sql(`UPDATE gov_repo.ledger_tenant_entries_v2 SET payload='{}'`,role),/permission denied/);
    }
    writeFileSync(join(ledgerRepo,'.artifacts/agent/ledger-v2-read-catalog.json'),JSON.stringify({routines,
      tables:after.tables,columns:after.columns,defaults:after.defaults,server:'170011',vector:'0.8.7',definerDelta:3},null,2)+'\n');
  });
});
