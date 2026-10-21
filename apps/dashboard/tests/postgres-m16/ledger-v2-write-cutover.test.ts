import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ledgerFoundationCluster, ledgerRepo, seedLedger, historySql, orgA, orgB, v2Tables, vectors, vectorSql, lit } from '../helpers/ledger-v2-foundation-fixtures';

const migration = '20261021134359_m175_v1_s1a1_2a_ledger_v2_write_cutover.sql';
const activate = `CALL gov_repo.ledger_v2_activate(ARRAY['discovery_scan','talk_governance_logging']);`;
type Actor = { id: string; org: string; epoch: string };
const now = 'floor(extract(epoch from clock_timestamp()))::bigint';
function append(a: Actor, overrides: Record<string,string> = {}) {
  const args = { p_verified_organisation_id: lit(a.org), p_verified_actor_user_id: lit(a.id),
    p_verified_session_iat: `(${now}-10)`, p_verified_session_exp: `(${now}+3600)`, p_verified_credential_epoch: `${lit(a.epoch)}::timestamptz`,
    p_event_type: "'WRITE_TEST'", p_event_desc: "'retained operational record'", p_subject_type: "'SYSTEM'",
    p_subject_id: lit(a.id), p_organisation_id: lit(a.org), p_payload: `'{"retained":"not governance truth"}'::jsonb`, ...overrides };
  return `SELECT gov_repo.ledger_append_v2(${Object.entries(args).map(([k,v])=>`${k}=>${v}`).join(',')});`;
}

test('S1A1-2A real PG17 write/cutover, principal security, atomic capture and observed concurrency', { timeout: 900_000 }, async t => {
  const pg = await ledgerFoundationCluster(m=>t.diagnostic(m)); t.after(()=>pg.stop());
  const { owner, svc, bootstrapSql } = pg;
  await seedLedger(pg); await pg.applyFoundation();
  const history = await owner(historySql);
  const baselineDefiners = Number(await owner('SELECT count(*) FROM pg_proc WHERE prosecdef'));
  await owner(readFileSync(join(ledgerRepo,'supabase/migrations',migration),'utf8'));
  const count = (table: string) => owner(`SELECT count(*) FROM gov_repo.${table}`);
  const state = () => owner(`SELECT jsonb_build_object('source',(SELECT jsonb_agg(to_jsonb(l) ORDER BY entry_sequence) FROM gov_repo.governance_ledger l),
    'global',(SELECT to_jsonb(g) FROM gov_repo.ledger_global_append_head_v2 g),
    'genesis',(SELECT jsonb_agg(to_jsonb(g) ORDER BY organisation_id) FROM gov_repo.ledger_tenant_genesis_v2 g),
    'heads',(SELECT jsonb_agg(to_jsonb(h) ORDER BY organisation_id) FROM gov_repo.ledger_tenant_heads_v2 h),
    'entries',(SELECT jsonb_agg(to_jsonb(v) ORDER BY source_entry_sequence) FROM gov_repo.ledger_tenant_entries_v2 v))::text`);
  const newOrg = async () => { const org=randomUUID(); await owner(`INSERT INTO gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code)
    VALUES('${org}','V2_${org.slice(0,8)}','Test','Test','BR')`); return org; };
  const mkActor = async (org: string): Promise<Actor> => {
    const id=randomUUID();
    await owner(`INSERT INTO gov_repo.governance_users(user_id,email,full_name,organisation_id,status,role_ids)
      SELECT '${id}','${id}@example.invalid','Fixture','${org}','active',ARRAY[role_id]
      FROM gov_repo.governance_roles WHERE role_code='POLICY_OWNER';`);
    await bootstrapSql(`BEGIN; ALTER TABLE gov_repo.governance_users DISABLE TRIGGER trg_governance_users_credential_epoch_v1;
      UPDATE gov_repo.governance_users SET password_changed_at=clock_timestamp()-interval '12 hours' WHERE user_id='${id}';
      ALTER TABLE gov_repo.governance_users ENABLE ALWAYS TRIGGER trg_governance_users_credential_epoch_v1; COMMIT;`);
    return {id,org,epoch:await owner(`SELECT password_changed_at::text FROM gov_repo.governance_users WHERE user_id='${id}'`)};
  };
  const a=await mkActor(orgA), b=await mkActor(orgB);
  await t.test('preparation alone: epoch=0, no tenant state, principal and raw writes unavailable, original bytes preserved',async()=>{
    for(const table of v2Tables)assert.equal(await count(table),'0');
    assert.equal(await owner(historySql),history);
    await assert.rejects(svc(append(a)),/LEDGER_V2_INACTIVE/);
    await assert.rejects(svc(`SELECT gov_repo.ledger_append('X','d','S',gen_random_uuid(),gen_random_uuid(),NULL,'${orgA}','{}')`),/permission denied for function ledger_append/);
    assert.equal(Number(await owner('SELECT count(*) FROM pg_proc WHERE prosecdef')),baselineDefiners+1);
  });
  await t.test('activation checks exact writer/prerequisite contract; owner-only and atomic rollback',async()=>{
    for(const role of ['service_role','anon','authenticated'] as const) await assert.rejects(pg.sql(activate,role),/permission denied/);
    await assert.rejects(owner(`CALL gov_repo.ledger_v2_activate(ARRAY['untracked_writer']);`),/ACTIVATION_CONTRACT/);
    await assert.rejects(owner(`BEGIN; GRANT INSERT ON gov_repo.governance_ledger TO service_role; ${activate} COMMIT;`),/ACTIVATION_CONTRACT/);
    await assert.rejects(owner(`BEGIN; ALTER TABLE gov_repo.governance_ledger DISABLE TRIGGER ledger_v2_capture; ${activate} COMMIT;`),/ACTIVATION_CONTRACT/);
    await assert.rejects(owner(`BEGIN; ALTER FUNCTION gov_repo.ledger_v2_json(jsonb) SECURITY DEFINER; ${activate} COMMIT;`),/ACTIVATION_CONTRACT/);
    await owner(`BEGIN; ${activate} ROLLBACK;`);
    for(const table of v2Tables)assert.equal(await count(table),'0');
    assert.equal(await owner(historySql),history);
  });
  await t.test('broken legacy validity is allowed without rehash/backfill or tenant dependence; malformed legacy tip aborts',async()=>{
    const before=await state();
    const result=await owner(`BEGIN; DROP RULE governance_ledger_immutable_core ON gov_repo.governance_ledger;
      UPDATE gov_repo.governance_ledger SET payload='{"legacy":"broken"}' WHERE entry_sequence=2;
      ${activate} SELECT is_valid FROM gov_repo.ledger_verify(1,NULL); ${append(a)}
      SELECT count(*) FROM gov_repo.ledger_tenant_entries_v2; ROLLBACK;`);
    assert.match(result,/f\s+[0-9a-f-]{36}\s+1/);
    assert.equal(await state(),before);
    await assert.rejects(owner(`BEGIN; DROP RULE governance_ledger_immutable_core ON gov_repo.governance_ledger;
      UPDATE gov_repo.governance_ledger SET entry_hash=repeat('z',64) WHERE entry_sequence=4; ${activate} COMMIT;`),/22023/);
    assert.equal(await state(),before);
  });
  const monitor=pg.session('m16_bootstrap'); t.after(()=>monitor.close());
  async function blocked(pid: string, holder: string) {
    for(let n=0;n<150;n++) {
      const r=await monitor.run(`SELECT wait_event_type='Lock' AND pg_blocking_pids(pid) @> ARRAY[${holder}] FROM pg_stat_activity WHERE pid=${pid};`);
      if(r.out==='t')return;
      await new Promise(r=>setTimeout(r,20));
    }
    assert.fail(`no observed lock dependency ${pid} -> ${holder}`);
  }
  await t.test('cutover blocks behind real in-flight source lock; boundary acquired after drain',async()=>{
    const holder=pg.session('postgres'), operator=pg.session('postgres');
    try {
      const holderPid=(await holder.run('SELECT pg_backend_pid();')).out;
      const operatorPid=(await operator.run('SELECT pg_backend_pid();')).out;
      assert.equal((await holder.run('BEGIN; LOCK TABLE gov_repo.governance_ledger IN ROW EXCLUSIVE MODE;')).err,'');
      const pending=operator.run(activate); await blocked(operatorPid,holderPid);
      assert.equal(await count('ledger_integrity_epochs_v2'),'0');
      await holder.run('COMMIT;'); assert.equal((await pending).err,'');
    } finally {await holder.close(); await operator.close();}
    assert.equal(await count('ledger_integrity_epochs_v2'),'1');
    assert.equal(await owner('SELECT legacy_high_watermark FROM gov_repo.ledger_integrity_epochs_v2'),'4');
    assert.equal(await count('ledger_tenant_legacy_refs_v2'),'4');
    assert.equal(await count('ledger_tenant_entries_v2'),'0');
    assert.equal(await owner(historySql),history);
    await assert.rejects(owner(activate),/ALREADY_ACTIVATED/);
  });
  const head = (org: string) => owner(`SELECT to_jsonb(h)::text FROM gov_repo.ledger_tenant_heads_v2 h WHERE organisation_id='${org}'`);
  await t.test('A/B cutover fixture: independent lazy genesis, A1 B1 A2, no legacy backfill, no B change to A head',async()=>{
    const id=await svc(append(a)); assert.match(id,/^[0-9a-f-]{36}$/);
    assert.equal(await owner(`SELECT last_tenant_sequence FROM gov_repo.ledger_tenant_heads_v2 WHERE organisation_id='${orgA}'`),'1');
    const a1=await head(orgA); await svc(append(b)); assert.equal(await head(orgA),a1);
    await svc(append(a));
    assert.equal(await owner(`SELECT string_agg(tenant_sequence::text,',' ORDER BY tenant_sequence) FROM gov_repo.ledger_tenant_entries_v2 WHERE organisation_id='${orgA}'`),'1,2');
    assert.equal(await owner(`SELECT count(*) FROM gov_repo.ledger_tenant_entries_v2 WHERE source_entry_sequence<=4`),'0');
    assert.equal(await owner(`SELECT bool_and(v.previous_tenant_hash=g.genesis_hash) FROM gov_repo.ledger_tenant_entries_v2 v JOIN gov_repo.ledger_tenant_genesis_v2 g USING(organisation_id,chain_id) WHERE tenant_sequence=1`),'t');
    assert.equal(await owner(`SELECT jsonb_agg(to_jsonb(l) ORDER BY entry_sequence)::text FROM gov_repo.governance_ledger l WHERE entry_sequence<=4`),history);
  });
  await t.test('principal transport is unconditional: absent, expired, stale, disabled, cross-org and actor mismatch denied without mutation',async()=>{
    const before=await state();
    const invalidPrincipals: Record<string,string>[] = [
      {p_verified_organisation_id:'NULL',p_verified_actor_user_id:'NULL',p_verified_session_iat:'NULL',p_verified_session_exp:'NULL',p_verified_credential_epoch:'NULL'},
      {p_verified_session_iat:`(${now}-4000)`,p_verified_session_exp:`(${now}-1)`},
      {p_verified_credential_epoch:`${lit(a.epoch)}::timestamptz-interval '1 microsecond'`},
      {p_verified_organisation_id:lit(orgB)}, {p_organisation_id:lit(orgB)},
      {p_verified_actor_user_id:lit(b.id)}, {p_verified_actor_user_id:lit(randomUUID())},
    ];
    for(const overrides of invalidPrincipals) await assert.rejects(svc(append(a,overrides)),/GV00[1234]/);
    await owner(`UPDATE gov_repo.governance_users SET status='suspended' WHERE user_id='${a.id}'`);
    await assert.rejects(svc(append(a)),/GV003/);
    await owner(`UPDATE gov_repo.governance_users SET status='active' WHERE user_id='${a.id}'`);
    assert.equal(await state(),before);
    for(const role of ['anon','authenticated'] as const) await assert.rejects(pg.sql(append(a),role),/permission denied/);
  });
  await t.test('actual application ACLs deny all table access, legacy append/verify, internal helper and capture control',async()=>{
    for(const role of ['service_role','anon','authenticated'] as const) {
      for(const table of v2Tables)for(const sql of [`SELECT * FROM gov_repo.${table}`,`INSERT INTO gov_repo.${table} DEFAULT VALUES`,
        `UPDATE gov_repo.${table} SET ${table==='ledger_integrity_epochs_v2'?'is_active=is_active':table==='ledger_global_append_head_v2'?'singleton=singleton':'organisation_id=organisation_id'}`,
        `DELETE FROM gov_repo.${table}`,`TRUNCATE gov_repo.${table}`]) await assert.rejects(pg.sql(sql,role),/permission denied/);
      await assert.rejects(pg.sql('SELECT * FROM gov_repo.ledger_verify(1,NULL)',role),/permission denied/);
      await assert.rejects(pg.sql(`SELECT gov_repo.ledger_append('OLD','d','S',gen_random_uuid(),gen_random_uuid(),NULL,'${orgA}','{}')`,role),/permission denied for function ledger_append/);
      await assert.rejects(pg.sql("SELECT gov_repo.ledger_v2_json('{}')",role),/permission denied/);
      await assert.rejects(pg.sql('ALTER TABLE gov_repo.governance_ledger DISABLE TRIGGER ledger_v2_capture',role),/must be owner/);
      await assert.rejects(pg.sql('INSERT INTO gov_repo.governance_ledger DEFAULT VALUES',role),/permission denied/);
    }
    assert.equal(await owner(`SELECT count(*) FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace AND proname IN ('ledger_tenant_verify_v2','ledger_tenant_events_v2','ledger_tenant_event_v2')`),'0');
  });
  async function contend(left: Actor, right: Actor, rollback=false) {
    const holder=pg.session('service_role'), waiter=pg.session('service_role');
    try {
      const hp=(await holder.run('SELECT pg_backend_pid();')).out, wp=(await waiter.run('SELECT pg_backend_pid();')).out;
      assert.equal((await holder.run(`BEGIN; ${append(left)}`)).err,'');
      const pending=waiter.run(append(right)); await blocked(wp,hp);
      assert.equal((await holder.run(rollback?'ROLLBACK;':'COMMIT;')).err,'');
      assert.equal((await pending).err,'');
    } finally { await holder.close(); await waiter.close(); }
  }
  await t.test('real contention: concurrent same-tenant first/subsequent, different tenants and rollback; no duplicate genesis/predecessor',async()=>{
    const c=await mkActor(await newOrg()), d=await mkActor(await newOrg());
    await contend(c,c); await contend(c,c); await contend(c,d); await contend(c,c,true);
    assert.equal(await owner(`SELECT count(*) FROM gov_repo.ledger_tenant_genesis_v2 WHERE organisation_id='${c.org}'`),'1');
    assert.equal(await owner(`SELECT last_tenant_sequence FROM gov_repo.ledger_tenant_heads_v2 WHERE organisation_id='${c.org}'`),'6');
    assert.equal(await owner(`SELECT bool_and(previous_hash=prev) FROM (SELECT previous_hash,lag(entry_hash) OVER(ORDER BY entry_sequence) prev FROM gov_repo.governance_ledger) q WHERE prev IS NOT NULL`),'t');
  });
  await t.test('explicit global head row contention blocks rather than skipping predecessor',async()=>{
    const holder=pg.session('postgres'), waiter=pg.session('service_role');
    try {
      const hp=(await holder.run('SELECT pg_backend_pid();')).out, wp=(await waiter.run('SELECT pg_backend_pid();')).out;
      assert.equal((await holder.run('BEGIN; SELECT last_global_sequence FROM gov_repo.ledger_global_append_head_v2 WHERE singleton FOR UPDATE;')).err,'');
      const pending=waiter.run(append(b)); await blocked(wp,hp);
      await holder.run('COMMIT;'); assert.equal((await pending).err,'');
    }finally{await holder.close();await waiter.close();}
  });
  await t.test('global head timeout fails closed with no row/head mutation and no legacy fallback',async()=>{
    const before=await state();
    const holder=pg.session('postgres'), waiter=pg.session('service_role');
    try {
      const hp=(await holder.run('SELECT pg_backend_pid();')).out, wp=(await waiter.run('SELECT pg_backend_pid();')).out;
      assert.equal((await holder.run('BEGIN; SELECT last_global_sequence FROM gov_repo.ledger_global_append_head_v2 WHERE singleton FOR UPDATE;')).err,'');
      const pending=waiter.run(append(a)); await blocked(wp,hp);
      assert.match((await pending).err,/55P03/);
      await holder.run('ROLLBACK;'); assert.equal(await state(),before);
    }finally{await holder.close();await waiter.close();}
  });
  await t.test('rollback and serializer/capture/head/coverage faults roll back complete source and both heads',async()=>{
    const before=await state();
    await svc(`BEGIN; ${append(a)} ROLLBACK;`); assert.equal(await state(),before);
    for(const prefix of [
      `REVOKE EXECUTE ON FUNCTION gov_repo.ledger_v2_json(jsonb) FROM govia_ledger_executor;`,
      `ALTER TABLE gov_repo.ledger_tenant_entries_v2 ADD CONSTRAINT injected_capture_failure CHECK(false) NOT VALID;`,
      `ALTER TABLE gov_repo.ledger_tenant_heads_v2 ADD CONSTRAINT injected_head_failure CHECK(last_tenant_sequence=0) NOT VALID;`,
      `ALTER TABLE gov_repo.ledger_global_append_head_v2 ADD CONSTRAINT injected_global_head_failure CHECK(last_global_sequence=0) NOT VALID;`,
      `CREATE TRIGGER injected_double_capture AFTER INSERT ON gov_repo.governance_ledger FOR EACH ROW EXECUTE FUNCTION gov_repo.ledger_v2_capture();`,
      `ALTER TABLE gov_repo.governance_ledger DISABLE TRIGGER ledger_v2_capture;`,
    ]) {
      await assert.rejects(bootstrapSql(`BEGIN; SET LOCAL ROLE postgres; ${prefix} SET LOCAL ROLE service_role; ${append(a)} COMMIT;`),/42501|23514|P0002/);
      assert.equal(await state(),before);
    }
    await assert.rejects(owner(`BEGIN; ALTER TABLE gov_repo.governance_ledger DISABLE TRIGGER ledger_v2_capture;
      SELECT gov_repo.ledger_append('MISSING','d','S','${a.id}','${a.id}',NULL,'${orgA}','{}');
      SET CONSTRAINTS gov_repo.ledger_v2_coverage IMMEDIATE; COMMIT;`),/23514[\s\S]*ATOMIC_COVERAGE/);
    assert.equal(await state(),before);
    // IMMEDIATE constraints remain correct: capture advances both heads before checks.
    await svc(`BEGIN; SET CONSTRAINTS ALL IMMEDIATE; ${append(a)} COMMIT;`);
    // No idempotency key in this record API: identical submissions create distinct retained records.
    assert.notEqual(await svc(append(a)),await svc(append(a)));
  });
  await t.test('post-cutover captured fields cannot drift; legacy omitted fields and QES anchors preserve prior semantics',async()=>{
    const seq=await owner('SELECT max(entry_sequence) FROM gov_repo.governance_ledger');
    const before=await owner(`SELECT to_jsonb(l)::text FROM gov_repo.governance_ledger l WHERE entry_sequence=${seq}`);
    for(const assignment of ["event_description='changed'","actor_ip='198.51.100.4'","actor_session_id=gen_random_uuid()",
      "event_timestamp=clock_timestamp()",`organisation_id='${orgB}'`]) {
      await assert.rejects(owner(`UPDATE gov_repo.governance_ledger SET ${assignment} WHERE entry_sequence=${seq}`),/SOURCE_IMMUTABLE|23503/);
      assert.equal(await owner(`SELECT to_jsonb(l)::text FROM gov_repo.governance_ledger l WHERE entry_sequence=${seq}`),before);
    }
    // Existing immutable-core rule may suppress updates before row triggers; values still cannot change.
    for(const assignment of ["entry_sequence=entry_sequence+1000","entry_id=gen_random_uuid()","event_type='changed'","subject_type='changed'",
      'subject_id=gen_random_uuid()','actor_user_id=gen_random_uuid()',"payload='{}'",'recorded_at=clock_timestamp()']) {
      await owner(`UPDATE gov_repo.governance_ledger SET ${assignment} WHERE entry_sequence=${seq}`);
      assert.equal(await owner(`SELECT to_jsonb(l)::text FROM gov_repo.governance_ledger l WHERE entry_sequence=${seq}`),before);
    }
    await owner(`BEGIN; UPDATE gov_repo.governance_ledger SET qes_anchor='external QES metadata' WHERE entry_sequence=${seq};
      UPDATE gov_repo.governance_ledger SET event_description='legacy description unchanged in scope' WHERE entry_sequence=1; ROLLBACK;`);
    assert.equal(await owner(`SELECT to_jsonb(l)::text FROM gov_repo.governance_ledger l WHERE entry_sequence=${seq}`),before);
    await assert.rejects(owner('TRUNCATE gov_repo.ledger_tenant_entries_v2'),/55000[\s\S]*LEDGER_V2_IMMUTABLE/);
    // Canonical source FKs also cascade into historical policy tables. Their
    // earlier immutable guard can reject before the V2 guard runs.
    await assert.rejects(owner('TRUNCATE gov_repo.governance_ledger CASCADE'),/55000[\s\S]*(?:POLICY_STORE_HISTORY_IMMUTABLE|LEDGER_V2_IMMUTABLE)/);
    assert.equal(await owner(`SELECT to_jsonb(l)::text FROM gov_repo.governance_ledger l WHERE entry_sequence=${seq}`),before);
  });
  await t.test('golden41 unchanged, complete committed coverage/heads/contiguous tenant sequences; global gaps valid',async()=>{
    for(const v of vectors)assert.equal(await owner(`SELECT encode(${vectorSql(v)},'hex')||':'||encode(sha256(${vectorSql(v)}),'hex')`),`${v.hex}:${v.sha256}`,v.name);
    assert.equal(await owner(`SELECT bool_and(tenant_sequence=n) FROM (SELECT tenant_sequence,row_number() OVER(PARTITION BY organisation_id ORDER BY tenant_sequence) n FROM gov_repo.ledger_tenant_entries_v2) q`),'t');
    assert.equal(await owner(`SELECT count(*) FROM gov_repo.governance_ledger l LEFT JOIN gov_repo.ledger_tenant_entries_v2 v ON v.source_entry_sequence=l.entry_sequence WHERE l.entry_sequence>4 AND v.source_entry_sequence IS NULL`),'0');
    assert.equal(await owner(`SELECT bool_and(h.last_tenant_sequence=q.n AND h.last_tenant_hash=q.hash AND h.committed_count=q.n)
      FROM gov_repo.ledger_tenant_heads_v2 h CROSS JOIN LATERAL (SELECT tenant_sequence n,tenant_hash hash FROM gov_repo.ledger_tenant_entries_v2 v
      WHERE v.organisation_id=h.organisation_id ORDER BY tenant_sequence DESC LIMIT 1) q`),'t');
    assert.equal(await owner(`SELECT h.last_global_sequence=l.entry_sequence AND h.last_global_hash=decode(l.entry_hash,'hex') FROM gov_repo.ledger_global_append_head_v2 h
      CROSS JOIN LATERAL (SELECT * FROM gov_repo.governance_ledger ORDER BY entry_sequence DESC LIMIT 1) l`),'t');
    assert.equal(await owner('SELECT is_valid FROM gov_repo.ledger_verify(1,NULL)'),'t');
    assert.equal(await owner('SELECT max(entry_sequence)>count(*) FROM gov_repo.governance_ledger'),'t','aborts consume global serial only');
  });
  await t.test('global divergence cannot enter tenant preimage or mutate independent A chain',async()=>{
    const aBefore=await head(orgA);
    const tenantBefore=await owner('SELECT jsonb_agg(to_jsonb(v) ORDER BY source_entry_sequence)::text FROM gov_repo.ledger_tenant_entries_v2 v');
    await bootstrapSql(`BEGIN; SET LOCAL ROLE postgres; DROP RULE governance_ledger_immutable_core ON gov_repo.governance_ledger;
      UPDATE gov_repo.governance_ledger SET entry_hash=repeat('a',64) WHERE entry_sequence=2;
      SELECT is_valid FROM gov_repo.ledger_verify(1,NULL); ROLLBACK;`).then(out=>assert.match(out,/f/));
    assert.equal(await owner('SELECT jsonb_agg(to_jsonb(v) ORDER BY source_entry_sequence)::text FROM gov_repo.ledger_tenant_entries_v2 v'),tenantBefore);
    await svc(append(b)); assert.equal(await head(orgA),aBefore);
    assert.equal(await owner(`SELECT jsonb_agg(to_jsonb(l) ORDER BY entry_sequence)::text FROM gov_repo.governance_ledger l WHERE entry_sequence<=4`),history);
  });
  const catalog=JSON.parse(await owner(`SELECT jsonb_build_object(
    'routines',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
      'kind',p.prokind,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl,
      'sha256',encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex')) ORDER BY p.proname)
      FROM pg_proc p WHERE p.pronamespace='gov_repo'::regnamespace AND (p.proname LIKE 'ledger_v2_%' OR p.proname IN ('ledger_append','ledger_append_v2','ledger_verify'))),
    'tables',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'acl',c.relacl,
      'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)))
      FROM pg_class c WHERE c.relnamespace='gov_repo'::regnamespace AND (c.relname LIKE 'ledger_%_v2' OR c.relname='governance_ledger')),
    'policies',(SELECT jsonb_agg(to_jsonb(p)) FROM pg_policies p WHERE p.schemaname='gov_repo' AND p.tablename LIKE 'ledger_%_v2'),
    'server',current_setting('server_version_num'),'vector',(SELECT extversion FROM pg_extension WHERE extname='vector'))::text`));
  writeFileSync(join(ledgerRepo,'.artifacts/agent/ledger-v2-write-catalog.json'),JSON.stringify(catalog,null,2)+'\n');
  t.diagnostic('Catalog: .artifacts/agent/ledger-v2-write-catalog.json; no hosted access; no tenant read RPC');
});
