import assert from 'node:assert/strict';
import { test } from 'node:test';
import { credentialMigration, disposableM16Postgres } from '../helpers/disposable-m16-postgres';

test('M16 S0.3.1 canonical disposable PG17 credential security', { timeout: 120000 }, async t => {
  const pg = await disposableM16Postgres(message => t.diagnostic(message));
  const { sql, bootstrapSql, migrate } = pg;
  t.after(() => pg.stop());
  const table = 'gov_repo.governance_users';
  const helper = 'gov_repo.enforce_credential_epoch_v1()';
  const trigger = 'trg_governance_users_credential_epoch_v1';
  const org = '11111111-1111-1111-1111-111111111111';
  const epoch = (email: string) => sql(`select password_changed_at::text from ${table} where email='${email}'`);
  const insert = (email: string, supplied?: string) => sql(`insert into ${table}
    (email, full_name, organisation_id${supplied === undefined ? '' : ',password_changed_at'})
    values ('${email}', 'Fixture', '${org}'${supplied === undefined ? '' : `,${supplied}`}) returning password_changed_at::text;`);
  const advancingUpdate = async (email: string, update: string) => {
    assert.equal(await sql(`with prior as materialized (select password_changed_at from ${table} where email='${email}'),
      changed as (update ${table} set ${update} where email='${email}' returning password_changed_at)
      select changed.password_changed_at > prior.password_changed_at from changed, prior;`), 't');
  };
  await sql(`insert into gov_repo.organisations (organisation_id,org_code,legal_name,display_name,country_code)
    values ('${org}','M16','M16 fixture','M16 fixture','BR');`);
  await insert('null-one@example.invalid');
  await insert('null-two@example.invalid');
  await insert('valid@example.invalid', "'2020-01-01T00:00:00.123456Z'");
  await insert('future@example.invalid', "clock_timestamp() + interval '1 day'");

  await t.test('role topology: distinct bootstrap, NOSUPERUSER postgres owner, service role and unprivileged roles', async () => {
    assert.equal(await sql('select current_user'), 'service_role');
    assert.equal(await sql('select current_user', 'postgres'), 'postgres');
    assert.equal(await bootstrapSql('select current_user'), 'm16_bootstrap');
    const rows = JSON.parse(await bootstrapSql(`select json_agg(r order by rolname) from
      (select rolname, rolsuper, rolbypassrls from pg_roles where rolname in
      ('m16_bootstrap','postgres','service_role','anon','authenticated')) r;`));
    assert.deepEqual(rows, [
      { rolname: 'anon', rolsuper: false, rolbypassrls: false },
      { rolname: 'authenticated', rolsuper: false, rolbypassrls: false },
      { rolname: 'm16_bootstrap', rolsuper: true, rolbypassrls: true },
      { rolname: 'postgres', rolsuper: false, rolbypassrls: true },
      { rolname: 'service_role', rolsuper: false, rolbypassrls: true },
    ]);
    assert.equal(await sql(`select pg_get_userbyid(relowner) from pg_class where oid='${table}'::regclass`), 'postgres');
    t.diagnostic(JSON.stringify(rows));
  });
  await t.test('3. future legacy non-null aborts migration atomically, preserving old schema and values', async () => {
    const future = await epoch('future@example.invalid');
    await assert.rejects(migrate(credentialMigration), /M16_CREDENTIAL_EPOCH_FUTURE_LEGACY_VALUE/);
    assert.equal(await epoch('future@example.invalid'), future);
    assert.equal(await sql(`select count(*) from ${table} where password_changed_at is null`), '2');
    assert.equal(await sql(`select attnotnull from pg_attribute where attrelid='${table}'::regclass and attname='password_changed_at'`), 'f');
    assert.equal(await sql(`select to_regprocedure('${helper}') is null`), 't');
    assert.doesNotMatch(await sql("select pg_get_function_result('gov_repo.signup_legacy(varchar,varchar,varchar,varchar)'::regprocedure)"), /password_changed_at/);
    await sql(`delete from ${table} where email='future@example.invalid'`);
  });
  await t.test('cutover lock waits for an in-flight writer before capturing the DB instant', async () => {
    // A real concurrent writer authors a valid epoch after migration starts waiting.
    // Capturing cutover before the lock would reject that epoch as future.
    const writer = sql(`begin; lock table ${table} in row exclusive mode;
      select pg_sleep(2);
      insert into ${table} (email,full_name,organisation_id,password_changed_at)
      values ('concurrent@example.invalid','Concurrent','${org}',clock_timestamp()); commit;`);
    async function waitForLock(mode: string, granted: boolean) {
      for (let i = 0; i < 100; i++) {
        if (await bootstrapSql(`select exists(select 1 from pg_locks where relation='${table}'::regclass
          and mode='${mode}' and granted=${granted})`) === 't') return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail(`Expected ${mode} granted=${granted}`);
    }
    await waitForLock('RowExclusiveLock', true);
    const migration = migrate(credentialMigration);
    // Attach handlers immediately so an unexpected SQL failure cannot be unhandled.
    const completed = Promise.all([writer, migration]);
    await waitForLock('ShareRowExclusiveLock', false);
    await completed;
    assert.equal(await sql(`select a.password_changed_at >= b.password_changed_at from ${table} a, ${table} b
      where a.email='null-one@example.invalid' and b.email='concurrent@example.invalid'`), 't');
  });
  await t.test('1. legacy NULLs receive one DB-authored cutover epoch', async () => {
    assert.equal(await epoch('null-one@example.invalid'), await epoch('null-two@example.invalid'));
    assert.equal(await sql(`select password_changed_at <= clock_timestamp() from ${table} where email='null-one@example.invalid'`), 't');
  });
  await t.test('2. valid legacy non-null remains unchanged at microsecond precision', async () => {
    assert.equal(await sql(`select password_changed_at = '2020-01-01T00:00:00.123456Z'::timestamptz from ${table} where email='valid@example.invalid'`), 't');
  });
  await t.test('4. no NULL rows remain', async () => {
    assert.equal(await sql(`select count(*) from ${table} where password_changed_at is null`), '0');
  });
  await t.test('5. catalog attnotnull is true', async () => {
    assert.equal(await sql(`select attnotnull from pg_attribute where attrelid='${table}'::regclass and attname='password_changed_at'`), 't');
  });
  for (const [n, label, supplied] of [[6, 'omitted', undefined], [7, 'old', "'1900-01-01'"], [8, 'future', "'2100-01-01'"], [8, 'explicit-null', 'null']] as const) {
    await t.test(`${n}. INSERT ${label}: base table authors epoch`, async () => {
      const before = await sql('select clock_timestamp()::text');
      const value = await insert(`${label}@example.invalid`, supplied);
      assert.equal(await sql(`select '${value}'::timestamptz >= '${before}'::timestamptz and '${value}'::timestamptz <= clock_timestamp()`), 't');
    });
  }
  await t.test('9. changing credential material increases epoch', async () => {
    await advancingUpdate('omitted@example.invalid', "external_id='bcrypt:fixture-material'");
  });
  await t.test('10. effective backward/equal clock: two updates strictly advance by one microsecond', async () => {
    // Owner-only setup simulates an OLD epoch ahead of the current DB wall clock.
    // This is not a claim of resistance to owner DDL; production function is unmodified.
    await bootstrapSql(`begin; alter table ${table} disable trigger ${trigger};
      update ${table} set password_changed_at='2100-01-01T00:00:00Z' where email='valid@example.invalid';
      alter table ${table} enable always trigger ${trigger}; commit;`);
    await advancingUpdate('valid@example.invalid', "external_id='idp:first'");
    await advancingUpdate('valid@example.invalid', "external_id='idp:second'");
    assert.equal(await sql(`select password_changed_at='2100-01-01T00:00:00.000002Z'::timestamptz
      from ${table} where email='valid@example.invalid'`), 't');
  });
  await t.test('11. independently updating epoch to past/future/NULL preserves old epoch', async () => {
    const before = await epoch('omitted@example.invalid');
    for (const value of ["'1900-01-01'", "'2100-01-01'", 'null']) {
      await sql(`update ${table} set password_changed_at=${value} where email='omitted@example.invalid'`);
      assert.equal(await epoch('omitted@example.invalid'), before);
    }
  });
  await t.test('12. null to value, value to null, different IdP values all advance; same value preserves', async () => {
    for (const value of ["'idp:first'", 'null', "'idp:second'", "'idp:third'"]) {
      await advancingUpdate('old@example.invalid', `external_id=${value}, password_changed_at='1900-01-01'`);
    }
    const before = await epoch('old@example.invalid');
    await sql(`update ${table} set external_id='idp:third' where email='old@example.invalid'`);
    assert.equal(await epoch('old@example.invalid'), before);
  });
  await t.test('13. signup_legacy returns the exact persisted epoch and preserves identity/role/bcrypt contract', async () => {
    assert.equal(await sql(`with created as materialized (
      select * from gov_repo.signup_legacy('signup@example.invalid','bcrypt:fixture','Signup','Signup Org'))
      select count(*)=1 and bool_and(password_changed_at is not null) from created`), 't');
    // A second statement can see writes performed by the RPC in the preceding statement.
    assert.equal(await sql(`select external_id='bcrypt:fixture' and cardinality(role_ids)=1 and password_changed_at is not null
      from ${table} where email='signup@example.invalid'`), 't');
    assert.equal(await sql(`do $test$ declare r record; stored timestamptz; begin
      select * into r from gov_repo.signup_legacy('exact@example.invalid','bcrypt:fixture','Exact','Exact Org');
      select password_changed_at into stored from ${table} where user_id=r.user_id;
      if stored is distinct from r.password_changed_at then raise exception 'epoch mismatch'; end if;
      end $test$; select true;`), 't');
  });
  await t.test('14. direct service_role DML executes trigger despite no helper EXECUTE', async () => {
    assert.equal(await sql(`select has_function_privilege(current_user,'${helper}','EXECUTE')`), 'f');
    await advancingUpdate('omitted@example.invalid', "external_id='idp:direct-service'");
  });
  await t.test('15. auto-updatable invoker view reaches base trigger', async () => {
    await sql(`create view gov_repo.m16_compat_users with (security_invoker=true) as select * from ${table};
      grant select,insert,update on gov_repo.m16_compat_users to service_role;`, 'postgres');
    const before = await epoch('old@example.invalid');
    await sql("update gov_repo.m16_compat_users set external_id='idp:view',password_changed_at='1900-01-01' where email='old@example.invalid'");
    assert.equal(await sql(`select password_changed_at > '${before}'::timestamptz from ${table} where email='old@example.invalid'`), 't');
    await sql(`insert into gov_repo.m16_compat_users(email,full_name,organisation_id,password_changed_at)
      values ('view-insert@example.invalid','View','${org}','1900-01-01')`);
    assert.equal(await sql(`select password_changed_at > '2000-01-01' from ${table} where email='view-insert@example.invalid'`), 't');
  });
  await t.test('16. ON CONFLICT changing external_id advances epoch', async () => {
    const before = await epoch('old@example.invalid');
    await sql(`insert into ${table}(email,full_name,organisation_id,external_id,password_changed_at)
      values ('old@example.invalid','Conflict','${org}','idp:upsert','1900-01-01')
      on conflict(email) do update set external_id=excluded.external_id,password_changed_at=excluded.password_changed_at;`);
    assert.equal(await sql(`select password_changed_at > '${before}'::timestamptz from ${table} where email='old@example.invalid'`), 't');
  });
  await t.test('17. ON CONFLICT epoch-only assignment cannot bypass trigger', async () => {
    const before = await epoch('old@example.invalid');
    await sql(`insert into ${table}(email,full_name,organisation_id,password_changed_at)
      values ('old@example.invalid','Conflict','${org}','1900-01-01')
      on conflict(email) do update set password_changed_at=excluded.password_changed_at;`);
    assert.equal(await epoch('old@example.invalid'), before);
  });
  await t.test('18. dynamic DML compatibility fixture reaches base trigger', async () => {
    const before = await epoch('old@example.invalid');
    await sql(`do $fixture$ begin execute 'update gov_repo.governance_users set external_id=$1,password_changed_at=$2 where email=$3'
      using 'idp:dynamic','1900-01-01'::timestamptz,'old@example.invalid'; end $fixture$;`);
    assert.equal(await sql(`select password_changed_at > '${before}'::timestamptz from ${table} where email='old@example.invalid'`), 't');
  });
  await t.test('19. pg_trigger tgenabled=A and plain BEFORE INSERT OR UPDATE', async () => {
    assert.equal(await sql(`select tgenabled from pg_trigger where tgrelid='${table}'::regclass and tgname='${trigger}'`), 'A');
    assert.equal(await sql(`select tgtype=23 and tgattr=''::int2vector from pg_trigger where tgrelid='${table}'::regclass and tgname='${trigger}'`), 't');
  });
  await t.test('20. bootstrap superuser replica mode still enforces INSERT, credential UPDATE and epoch-only UPDATE', async () => {
    const before = await epoch('old@example.invalid');
    await bootstrapSql(`set session_replication_role=replica;
      insert into ${table}(email,full_name,organisation_id,password_changed_at)
      values ('replica@example.invalid','Replica','${org}','1900-01-01');
      update ${table} set external_id='idp:replica',password_changed_at='1900-01-01' where email='old@example.invalid';`);
    assert.equal(await sql(`select password_changed_at > '${before}'::timestamptz from ${table} where email='old@example.invalid'`), 't');
    assert.equal(await sql(`select password_changed_at > '2000-01-01' from ${table} where email='replica@example.invalid'`), 't');
    const replica = await epoch('replica@example.invalid');
    await bootstrapSql(`set session_replication_role=replica; update ${table} set password_changed_at=null where email='replica@example.invalid'`);
    assert.equal(await epoch('replica@example.invalid'), replica);
  });
  await t.test('21. catalog ACL postflight: trigger helper has no PUBLIC/anon/authenticated/service_role EXECUTE', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(await sql(`select has_function_privilege('${role}','${helper}','EXECUTE')`), 'f');
    }
    assert.equal(await sql(`select count(*) from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid='${helper}'::regprocedure and a.privilege_type='EXECUTE' and a.grantee=0`), '0');
    assert.equal(await sql(`select provolatile='v' and not prosecdef and proconfig=array['search_path=pg_catalog']
      from pg_proc where oid='${helper}'::regprocedure`), 't');
    t.diagnostic(`Trigger ACL: ${await sql(`select proacl::text from pg_proc where oid='${helper}'::regprocedure`)}`);
  });
  await t.test('22. signup has one overload and exact application EXECUTE grants after legacy defaults', async () => {
    assert.equal(await sql("select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname='signup_legacy'"), '1');
    const fn = 'gov_repo.signup_legacy(varchar,varchar,varchar,varchar)';
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(await sql(`select has_function_privilege('${role}','${fn}','EXECUTE')`), role === 'service_role' ? 't' : 'f');
    }
    assert.equal(await sql(`select count(*) from pg_proc p, lateral aclexplode(p.proacl) a
      where p.oid='${fn}'::regprocedure and a.grantee=0`), '0');
    t.diagnostic(`Signup ACL: ${await sql(`select proacl::text from pg_proc where oid='${fn}'::regprocedure`)}`);
  });
});
