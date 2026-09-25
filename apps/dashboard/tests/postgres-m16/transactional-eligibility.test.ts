import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { credentialMigration, disposableM16Postgres, eligibilityMigration, migrationSource } from '../helpers/disposable-m16-postgres';

type Session = ReturnType<Awaited<ReturnType<typeof disposableM16Postgres>>['session']>;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('M16 S0.3.2 canonical disposable PG17 transactional governance eligibility', { timeout: 600000 }, async t => {
  const pg = await disposableM16Postgres(message => t.diagnostic(message));
  const { sql, bootstrapSql, migrate } = pg;
  t.after(() => pg.stop());
  await migrate(credentialMigration);
  await migrate(eligibilityMigration);

  const helper = 'gov_repo.lock_and_resolve_governance_session_eligibility_v1';
  const helperSig = `${helper}(uuid,uuid,bigint,bigint)`;
  const users = 'gov_repo.governance_users';
  const roles = 'gov_repo.governance_roles';
  const orgs = 'gov_repo.organisations';
  const trigger = 'trg_governance_users_credential_epoch_v1';
  const orgA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const orgB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const orgOff = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const r1 = '00000000-0000-0000-0000-000000000001';
  const r2 = '00000000-0000-0000-0000-000000000002';
  const r3 = '00000000-0000-0000-0000-000000000003';
  const owner = (query: string) => sql(query, 'postgres');
  const lastLine = (out: string) => out.replace(/\r/g, '').trim().split('\n').pop() as string;

  await owner(`insert into ${orgs} (organisation_id,org_code,legal_name,display_name,country_code,is_active) values
    ('${orgA}','ELIG_A','Elig A','Elig A','PT',true),
    ('${orgB}','ELIG_B','Elig B','Elig B','PT',true),
    ('${orgOff}','ELIG_OFF','Elig Off','Elig Off','PT',false);
    insert into ${roles} (role_id,role_code,role_name,role_tier,is_system_role) values
    ('${r1}','M16_R1','R1','organisation',false),('${r2}','M16_R2','R2','organisation',false),
    ('${r3}','M16_R3','R3','organisation',false);`);
  const adminRole = await sql(`select role_id from ${roles} where role_code='GOVERNANCE_ADMIN' and is_system_role`);
  const ownerRole = await sql(`select role_id from ${roles} where role_code='POLICY_OWNER'`);
  const arr = (...ids: string[]) => ids.length ? `array[${ids.map(id => `'${id}'`).join(',')}]::uuid[]` : `'{}'::uuid[]`;

  // Owner-only fixture: the trigger is disabled and re-enabled ALWAYS in ONE bootstrap
  // transaction to seed an exact epoch (same technique as the S0.3.1 monotonicity fixture).
  // ALTER TABLE needs no other session to hold governance_users locks at that moment.
  const setEpoch = (id: string, expression: string) => bootstrapSql(`begin;
    alter table ${users} disable trigger ${trigger};
    update ${users} set password_changed_at=${expression} where user_id='${id}';
    alter table ${users} enable always trigger ${trigger}; commit;`);
  // Real users get a credential epoch 12h old: older than every tested iat (incl. the 8h case).
  async function mkUser(roleIds: string, opts: { org?: string; status?: string } = {}) {
    const id = randomUUID();
    await sql(`insert into ${users}(user_id,email,full_name,organisation_id,status,role_ids)
      values ('${id}','${id}@example.invalid','Fixture','${opts.org ?? orgA}','${opts.status ?? 'active'}',${roleIds})`);
    await setEpoch(id, `clock_timestamp() - interval '12 hours'`);
    return id;
  }

  // DB-derived times: `t.s` is the DB integer second read in the SAME statement. If the
  // second is about to roll over, wait past it first so exact boundary cases cannot flake.
  const stableSecond = `do $stable$ begin
    if (extract(epoch from clock_timestamp())::numeric % 1) > 0.8 then perform pg_sleep(0.3); end if; end $stable$;`;
  const uuidArg = (value: string) => value === 'null' ? 'null::uuid' : `'${value}'::uuid`;
  const call = (org: string, user: string, iat = 't.s - 10', exp = 't.s + 3600') =>
    `with t as materialized (select floor(extract(epoch from clock_timestamp()))::bigint as s)
     select to_json(h) from t, lateral ${helper}(${uuidArg(org)},${uuidArg(user)},${iat},${exp}) h;`;
  const eligible = async (user: string, org = orgA, iat?: string, exp?: string) =>
    JSON.parse(lastLine(await owner(`${stableSecond} ${call(org, user, iat, exp)}`)));
  const rejects = (query: string, code: string, token: string, detail?: string) =>
    assert.rejects(owner(query), (error: Error) => {
      assert.match(error.message, new RegExp(`${code}[\\s\\S]*M16_ELIGIBILITY_${token}`));
      if (detail) assert.match(error.message, new RegExp(detail));
      return true;
    });
  const rejected = (user: string, code: string, token: string, detail?: string, org = orgA, iat?: string, exp?: string) =>
    rejects(`${stableSecond} ${call(org, user, iat, exp)}`, code, token, detail);
  const TEMPORAL = ['GV001', 'SESSION_TEMPORALLY_INVALID'] as const;
  const STALE = ['GV002', 'CREDENTIAL_STALE'] as const;
  const INELIGIBLE = ['GV003', 'ACTOR_OR_ORGANISATION_INELIGIBLE'] as const;
  const ROLESET = ['GV004', 'ROLE_SET_INVALID'] as const;
  const ISOLATION = ['GV005', 'UNSUPPORTED_TRANSACTION_ISOLATION'] as const;

  // ---- concurrency machinery: distinct real sessions, contention observed in the catalog ----
  const monitor = pg.session('m16_bootstrap');
  t.after(() => monitor.close());
  const pidOf = async (session: Session) => (await session.run('select pg_backend_pid();')).out.trim();
  // Pids must be read BEFORE the blocked statement starts (sessions are serial).
  async function awaitBlocked(b: string, h: string) {
    for (let i = 0; i < 500; i++) {
      const state = (await monitor.run(`select coalesce((select wait_event_type from pg_stat_activity where pid=${b}),'')
        ||':'||(pg_blocking_pids(${b}) @> array[${h}])::text;`)).out.trim();
      if (state === 'Lock:true') return;
      await sleep(20);
    }
    assert.fail('writer never observed blocked (wait_event_type=Lock, pg_blocking_pids contains holder)');
  }
  /** holder (open tx) has already run the helper; writer must WAIT, then proceed once holder commits. */
  async function concurrentWriter(holder: Session, writerSql: string) {
    const writer = pg.session('service_role'); // real application role DML
    const [writerPid, holderPid] = [await pidOf(writer), await pidOf(holder)];
    let settled = false;
    const pending = writer.run(writerSql).then(result => { settled = true; return result; });
    await awaitBlocked(writerPid, holderPid);
    assert.equal(settled, false, 'concurrent writer must be blocked while eligibility holds the lock');
    return async () => {
      await holder.run('commit;');
      const result = await pending;
      assert.equal(result.err, '', `writer must succeed after holder commit: ${result.err}`);
      await writer.close();
    };
  }
  async function heldEligibility(user: string, org = orgA, iat?: string, exp?: string) {
    const holder = pg.session('postgres');
    await holder.run('begin;');
    const result = await holder.run(`${call(org, user, iat, exp)}`);
    assert.equal(result.err, '', result.err);
    return { holder, row: JSON.parse(lastLine(result.out)) };
  }

  await t.test('catalog: one canonical helper; DEFINER, VOLATILE, pinned search_path, lock_timeout, owner-only ACL', async () => {
    assert.equal(await sql(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like '%eligibility%'`), '1');
    assert.equal(await sql(`select prosecdef and provolatile='v' and prolang=(select oid from pg_language where lanname='plpgsql')
      and pg_get_userbyid(proowner)='postgres' from pg_proc where oid='${helperSig}'::regprocedure`), 't');
    assert.equal(await sql(`select proconfig::text from pg_proc where oid='${helperSig}'::regprocedure`), '{search_path=pg_catalog,lock_timeout=5s}');
    assert.equal(await sql(`select proacl::text from pg_proc where oid='${helperSig}'::regprocedure`), '{postgres=X/postgres}');
    assert.equal(await sql(`select count(*) from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid='${helperSig}'::regprocedure and a.privilege_type='EXECUTE' and a.grantee=0`), '0', 'PUBLIC has no EXECUTE');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(await sql(`select has_function_privilege('${role}','${helperSig}','EXECUTE')`), 'f');
    }
    assert.equal(await sql(`select has_function_privilege('postgres','${helperSig}','EXECUTE')`), 't');
    // Source regressions (behavior itself is proven by the tests below).
    // Comments are documentation; assert on executable text only.
    const source = (await sql(`select prosrc from pg_proc where oid='${helperSig}'::regprocedure`)).replace(/--[^\r\n]*/g, '');
    assert.doesNotMatch(source, /\bEXCEPTION\s+WHEN\b/i, 'no exception swallowing');
    assert.doesNotMatch(source, /\bEXECUTE\b/i, 'no dynamic SQL');
    assert.doesNotMatch(source, /KEY SHARE/i);
    assert.doesNotMatch(source, /transaction_timestamp|statement_timestamp|\bnow\(\)/i);
    assert.doesNotMatch(source, /\.permissions\b/i);
    assert.doesNotMatch(await sql(`select pg_get_function_result('${helperSig}'::regprocedure)`), /permissions/);
    assert.match(migrationSource(eligibilityMigration), /FOR SHARE OF o[\s\S]*FOR SHARE OF u[\s\S]*FOR SHARE OF gr/);
    t.diagnostic(`Helper ACL: ${await sql(`select proacl::text from pg_proc where oid='${helperSig}'::regprocedure`)}; config: ${await sql(`select proconfig::text from pg_proc where oid='${helperSig}'::regprocedure`)}`);
  });
  await t.test('service_role/anon/authenticated cannot directly execute; service_role DML still works on the lock-bearing rows', async () => {
    const id = await mkUser(arr());
    for (const role of ['service_role', 'anon', 'authenticated'] as const) {
      await assert.rejects(sql(call(orgA, id), role), /42501|permission denied for function/i);
    }
    await sql(`update ${users} set department='dml-ok' where user_id='${id}'`);
  });
  await t.test('legacy role authority catalog: governance_users.role_ids is the only role-like column; no grant relation', async () => {
    assert.deepEqual(JSON.parse(await sql(`select json_agg(table_name||'.'||column_name order by table_name,column_name)
      from information_schema.columns where table_schema='gov_repo' and column_name ~* 'role'`)), [
      'governance_roles.is_system_role', 'governance_roles.role_code', 'governance_roles.role_description',
      'governance_roles.role_id', 'governance_roles.role_name', 'governance_roles.role_tier', 'governance_users.role_ids',
    ]);
    assert.equal(await sql(`select json_agg(column_name) from information_schema.columns
      where table_schema='gov_repo' and table_name='governance_users' and column_name ~* 'role'`), '["role_ids"]');
    assert.equal(await sql(`select data_type||':'||udt_name from information_schema.columns
      where table_schema='gov_repo' and table_name='governance_users' and column_name='role_ids'`), 'ARRAY:_uuid');
    t.diagnostic('Role-like columns: governance_roles.* are role DEFINITIONS; governance_users.role_ids is the sole assignment authority, guarded by the governance_users row lock');
  });

  await t.test('1/12. eligible admin; narrow DB-derived return shape; roles sorted; no permissions', async () => {
    const id = await mkUser(arr(r3, adminRole, r1));
    const row = await eligible(id);
    assert.deepEqual(Object.keys(row).sort(), ['actor_user_id', 'checked_at', 'has_governance_admin', 'organisation_id', 'role_codes', 'role_ids']);
    assert.equal(row.actor_user_id, id);
    assert.equal(row.organisation_id, orgA);
    assert.equal(row.has_governance_admin, true);
    assert.deepEqual(row.role_ids, [...row.role_ids].sort(), 'returned role ids are in ascending lock order');
    assert.equal(row.role_ids.length, 3);
    assert.deepEqual([...row.role_codes].sort(), ['GOVERNANCE_ADMIN', 'M16_R1', 'M16_R3']);
    assert.equal(await sql(`select h.checked_at between t0.c and clock_timestamp()
      from (select clock_timestamp() c) t0, lateral ${helper}('${orgA}','${id}',
        floor(extract(epoch from t0.c))::bigint - 10, floor(extract(epoch from t0.c))::bigint + 3600) h`, 'postgres'), 't',
      'checked_at is the database clock, bracketed by clock_timestamp() readings');
  });
  await t.test('2-6. missing/inactive org, missing/inactive user, cross-tenant all fail closed', async () => {
    const id = await mkUser(arr(adminRole));
    await rejected(id, ...INELIGIBLE, 'ORGANISATION_UNAVAILABLE', randomUUID());
    const inOff = await mkUser(arr(adminRole), { org: orgOff });
    await rejected(inOff, ...INELIGIBLE, 'ORGANISATION_UNAVAILABLE', orgOff);
    await rejected(randomUUID(), ...INELIGIBLE, 'ACTOR_UNAVAILABLE_OR_NOT_MEMBER');
    for (const status of ['suspended', 'pending', 'deactivated']) {
      await rejected(await mkUser(arr(adminRole), { status }), ...INELIGIBLE, 'ACTOR_UNAVAILABLE_OR_NOT_MEMBER');
    }
    await rejected(await mkUser(arr(adminRole), { org: orgB }), ...INELIGIBLE, 'ACTOR_UNAVAILABLE_OR_NOT_MEMBER'); // called with orgA
    await rejected(id, ...INELIGIBLE, 'IDENTITY_REQUIRED', 'null');
    await rejected('null', ...INELIGIBLE, 'IDENTITY_REQUIRED');
  });
  await t.test('7-10. NULL role_ids, NULL element, duplicates, multi-dimensional, unresolved role fail closed', async () => {
    await bootstrapSql(`alter table ${users} alter column role_ids drop not null`);
    try {
      const nullRoles = await mkUser(arr(adminRole));
      await sql(`update ${users} set role_ids=null where user_id='${nullRoles}'`);
      await rejected(nullRoles, ...ROLESET, 'MALFORMED_ROLE_ASSIGNMENT');
      const nullElement = await mkUser(`array['${adminRole}',null]::uuid[]`);
      await rejected(nullElement, ...ROLESET, 'MALFORMED_ROLE_ASSIGNMENT');
      await rejected(await mkUser(arr(adminRole, adminRole)), ...ROLESET, 'MALFORMED_ROLE_ASSIGNMENT');
      await rejected(await mkUser(`array[array['${r1}'::uuid],array['${r2}'::uuid]]`), ...ROLESET, 'MALFORMED_ROLE_ASSIGNMENT');
      await rejected(await mkUser(arr(adminRole, randomUUID())), ...ROLESET, 'ASSIGNED_ROLE_UNRESOLVED');
      await sql(`update ${users} set role_ids='{}' where role_ids is null`);
    } finally {
      await bootstrapSql(`alter table ${users} alter column role_ids set not null`);
    }
    assert.equal(await sql(`select attnotnull from pg_attribute where attrelid='${users}'::regclass and attname='role_ids'`), 't');
  });
  await t.test('11/13/14. empty roles => no admin; non-system GOVERNANCE_ADMIN and other system roles => no admin', async () => {
    const empty = await eligible(await mkUser(arr()));
    assert.equal(empty.has_governance_admin, false);
    assert.deepEqual(empty.role_ids, []);
    assert.deepEqual(empty.role_codes, []);
    const plain = await eligible(await mkUser(arr(ownerRole)));
    assert.equal(plain.has_governance_admin, false);
    assert.deepEqual(plain.role_codes, ['POLICY_OWNER']);
    const spoof = await mkUser(arr(adminRole));
    await owner(`update ${roles} set is_system_role=false where role_id='${adminRole}'`);
    try { assert.equal((await eligible(spoof)).has_governance_admin, false); }
    finally { await owner(`update ${roles} set is_system_role=true where role_id='${adminRole}'`); }
    assert.equal((await eligible(spoof)).has_governance_admin, true);
  });

  await t.test('15-16. credential freshness strictly greater than epoch second, all microsecond phases', async () => {
    const id = await mkUser(arr());
    const epochSecond = `(select floor(extract(epoch from password_changed_at))::bigint from ${users} where user_id='${id}')`;
    for (const micros of [0, 1, 500000, 999999]) {
      await setEpoch(id, `date_trunc('second', clock_timestamp()) - interval '100 seconds' + interval '${micros} microseconds'`);
      await rejected(id, ...STALE, 'SESSION_NOT_AFTER_CREDENTIAL_EPOCH', orgA, epochSecond, `${epochSecond} + 3600`);
      await rejected(id, ...STALE, 'SESSION_NOT_AFTER_CREDENTIAL_EPOCH', orgA, `${epochSecond} - 1`, `${epochSecond} + 3600`);
      const row = await eligible(id, orgA, `${epochSecond} + 1`, `${epochSecond} + 3600`);
      assert.equal(row.actor_user_id, id, `epoch .${micros}: iat = floor+1 satisfies the credential condition`);
    }
  });
  await t.test('17-18. backend-ahead bound is against the DB clock: +5s accepted, +6s rejected', async () => {
    const id = await mkUser(arr());
    assert.equal((await eligible(id, orgA, 't.s + 5', 't.s + 3600')).actor_user_id, id);
    await rejected(id, ...TEMPORAL, 'IAT_AHEAD_OF_DATABASE_CLOCK', orgA, 't.s + 6', 't.s + 3600');
    await rejected(id, ...TEMPORAL, 'IAT_AHEAD_OF_DATABASE_CLOCK', orgA, 't.s + 3600', 't.s + 7200');
  });
  await t.test('19-20. exp must be strictly after the DB current second', async () => {
    const id = await mkUser(arr());
    await rejected(id, ...TEMPORAL, 'SESSION_EXPIRED', orgA, 't.s - 10', 't.s');
    await rejected(id, ...TEMPORAL, 'SESSION_EXPIRED', orgA, 't.s - 10', 't.s - 1');
    assert.equal((await eligible(id, orgA, 't.s - 10', 't.s + 1')).actor_user_id, id);
    assert.equal((await eligible(id, orgA, 't.s - 10', 't.s + 3600')).actor_user_id, id);
  });
  await t.test('21-22. maximum authoritative age 28800s is not extended by the +5s allowance', async () => {
    const id = await mkUser(arr());
    assert.equal((await eligible(id, orgA, 't.s - 28800', 't.s + 60')).actor_user_id, id);
    await rejected(id, ...TEMPORAL, 'SESSION_MAX_AGE_EXCEEDED', orgA, 't.s - 28801', 't.s + 60');
    await rejected(id, ...TEMPORAL, 'SESSION_MAX_AGE_EXCEEDED', orgA, 't.s - 28805', 't.s + 60');
  });
  await t.test('23-24. malformed session shape: exp<=iat, zero, negative, NULL', async () => {
    const id = await mkUser(arr());
    const shape = (iat: string, exp: string) => rejected(id, ...TEMPORAL, 'MALFORMED_SESSION_TIMESTAMPS', orgA, iat, exp);
    await shape('t.s - 10', 't.s - 10');
    await shape('t.s - 10', 't.s - 11');
    await shape('0', 't.s + 60');
    await shape('-5', 't.s + 60');
    await shape('t.s - 10', '0');
    await shape('t.s - 10', '-1');
    await shape('null::bigint', 't.s + 60');
    await shape('t.s - 10', 'null::bigint');
  });

  await t.test('isolation: READ COMMITTED accepted; READ UNCOMMITTED, REPEATABLE READ and SERIALIZABLE fail closed', async () => {
    const id = await mkUser(arr());
    const inTx = (level: string) => `begin isolation level ${level}; ${call(orgA, id)} commit;`;
    assert.match(lastLine(await owner(inTx('read committed'))), /actor_user_id/);
    for (const level of ['repeatable read', 'serializable', 'read uncommitted']) {
      await rejects(inTx(level), ...ISOLATION, 'READ_COMMITTED_REQUIRED');
    }
    await rejects(`set default_transaction_isolation='repeatable read'; ${call(orgA, id)}`, ...ISOLATION);
  });

  await t.test('reentrancy: second same-transaction call uses a FRESH database clock (near-return recheck)', async () => {
    const id = await mkUser(arr(adminRole));
    const session = pg.session('postgres');
    try {
      const s = Number((await session.run('select floor(extract(epoch from clock_timestamp()))::bigint;')).out);
      await session.run('begin;');
      const first = await session.run(call(orgA, id, String(s - 10), String(s + 2)));
      assert.equal(first.err, '', first.err);
      await sleep(3200); // same transaction; transaction_timestamp() is now stale, locks still held
      const second = await session.run(call(orgA, id, String(s - 10), String(s + 2)));
      assert.match(second.err, /GV001[\s\S]*SESSION_TEMPORALLY_INVALID[\s\S]*SESSION_EXPIRED/);
      await session.run('rollback;');
      await session.run('begin;');
      const a = JSON.parse(lastLine((await session.run(call(orgA, id))).out)).checked_at;
      await sleep(50);
      const b = JSON.parse(lastLine((await session.run(call(orgA, id))).out)).checked_at;
      assert.ok(new Date(b) > new Date(a), 'fresh clock_timestamp per call');
      await session.run('commit;');
    } finally { await session.close(); }
  });
  await t.test('clock is read AFTER lock acquisition: a lock wait that outlives exp rejects', async () => {
    const id = await mkUser(arr(adminRole));
    const blocker = pg.session('postgres');
    const waiter = pg.session('postgres');
    try {
      await blocker.run(`begin; select 1 from ${orgs} where organisation_id='${orgA}' for update;`);
      const [waiterPid, blockerPid] = [await pidOf(waiter), await pidOf(blocker)];
      const pending = waiter.run(call(orgA, id, 't.s - 10', 't.s + 2'));
      await awaitBlocked(waiterPid, blockerPid);
      await sleep(3000); // < lock_timeout 5s; exp (start-second + 2) has passed by acquisition
      await blocker.run('commit;');
      const result = await pending;
      assert.match(result.err, /GV001[\s\S]*SESSION_EXPIRED/, 'DB clock after the wait, not transaction start');
      assert.equal(result.out, '');
    } finally { await blocker.close(); await waiter.close(); }
  });

  await t.test('30. organisation is_active update waits behind the FOR SHARE lock, then eligibility fails', async () => {
    const id = await mkUser(arr(adminRole), { org: orgB });
    const { holder, row } = await heldEligibility(id, orgB);
    assert.equal(row.has_governance_admin, true);
    const release = await concurrentWriter(holder, `update ${orgs} set is_active=false where organisation_id='${orgB}';`);
    await release();
    await holder.close();
    await rejected(id, ...INELIGIBLE, 'ORGANISATION_UNAVAILABLE', orgB);
    await owner(`update ${orgs} set is_active=true where organisation_id='${orgB}'`);
    assert.equal((await eligible(id, orgB)).actor_user_id, id);
  });
  await t.test('31. user status update waits, then eligibility fails', async () => {
    const id = await mkUser(arr(adminRole));
    const { holder } = await heldEligibility(id);
    const release = await concurrentWriter(holder, `update ${users} set status='suspended' where user_id='${id}';`);
    await release();
    await holder.close();
    await rejected(id, ...INELIGIBLE, 'ACTOR_UNAVAILABLE_OR_NOT_MEMBER');
  });
  await t.test('32. membership (organisation_id) move waits, then the old org/user pair fails', async () => {
    const id = await mkUser(arr(adminRole));
    const { holder } = await heldEligibility(id);
    const release = await concurrentWriter(holder, `update ${users} set organisation_id='${orgB}' where user_id='${id}';`);
    await release();
    await holder.close();
    await rejected(id, ...INELIGIBLE, 'ACTOR_UNAVAILABLE_OR_NOT_MEMBER', orgA);
    assert.equal((await eligible(id, orgB)).organisation_id, orgB);
  });
  await t.test('33. role revocation (role_ids update) waits; next call has_governance_admin=false', async () => {
    const id = await mkUser(arr(adminRole, ownerRole));
    const { holder, row } = await heldEligibility(id);
    assert.equal(row.has_governance_admin, true);
    const release = await concurrentWriter(holder, `update ${users} set role_ids=${arr(ownerRole)} where user_id='${id}';`);
    await release();
    await holder.close();
    assert.equal((await eligible(id)).has_governance_admin, false);
  });
  await t.test('34. ABSENT-GRANT: adding a previously absent admin role waits on the user row lock', async () => {
    const id = await mkUser(arr(ownerRole));
    const { holder, row } = await heldEligibility(id);
    assert.equal(row.has_governance_admin, false);
    const release = await concurrentWriter(holder, `update ${users} set role_ids=${arr(ownerRole, adminRole)} where user_id='${id}';`);
    await release();
    await holder.close();
    assert.equal((await eligible(id)).has_governance_admin, true, 'a NEW call observes the newly committed grant');
  });
  await t.test('35. credential rotation (external_id) waits, advances the epoch, and stales the previous iat', async () => {
    const id = await mkUser(arr(adminRole));
    const before = await sql(`select password_changed_at::text from ${users} where user_id='${id}'`);
    const { holder } = await heldEligibility(id);
    const release = await concurrentWriter(holder, `update ${users} set external_id='idp:rotated' where user_id='${id}';`);
    await release();
    await holder.close();
    assert.equal(await sql(`select password_changed_at > '${before}'::timestamptz from ${users} where user_id='${id}'`), 't');
    await rejected(id, ...STALE, 'SESSION_NOT_AFTER_CREDENTIAL_EPOCH', orgA, 't.s - 10');
    assert.equal((await eligible(id, orgA, 't.s + 1', 't.s + 3600')).actor_user_id, id, 'a session issued after the rotation is eligible');
  });
  await t.test('36. assigned role DEFINITION (is_system_role, role_code) updates wait; results follow the committed definition', async () => {
    const id = await mkUser(arr(r2, adminRole));
    const { holder, row } = await heldEligibility(id);
    assert.equal(row.has_governance_admin, true);
    const release = await concurrentWriter(holder, `update ${roles} set is_system_role=false where role_id='${adminRole}';`);
    await release();
    await holder.close();
    try { assert.equal((await eligible(id)).has_governance_admin, false); }
    finally { await owner(`update ${roles} set is_system_role=true where role_id='${adminRole}'`); }
    const second = await heldEligibility(id);
    const rename = await concurrentWriter(second.holder, `update ${roles} set role_code='M16_R2_RENAMED' where role_id='${r2}';`);
    await rename();
    await second.holder.close();
    assert.ok((await eligible(id)).role_codes.includes('M16_R2_RENAMED'));
    await owner(`update ${roles} set role_code='M16_R2' where role_id='${r2}'`);
    assert.equal((await eligible(id)).has_governance_admin, true);
  });

  await t.test('37. role locks are taken in ascending role_id order regardless of stored array order', async () => {
    // Stored order is [r3, r1, r2]; sorted lock order must be r1, r2, r3.
    const id = await mkUser(arr(r3, r1, r2));
    const probe = pg.session('service_role');
    const locked = async (table: string, key: string, value: string) => {
      await probe.run('begin;');
      const result = await probe.run(`select 1 from ${table} where ${key}='${value}' for update nowait;`);
      await probe.run('rollback;');
      if (result.err === '') return false;
      assert.match(result.err, /55P03/);
      return true;
    };
    try {
      // (a) A is blocked acquiring r2 => r1 already held, r3 (stored FIRST) not yet taken.
      // (b) A is blocked acquiring r1 => nothing of r2/r3 taken although r3 is first in the array.
      for (const [blockedRole, expectHeld, expectFree] of [[r2, [r1], [r3]], [r1, [], [r2, r3]]] as const) {
        const blocker = pg.session('postgres');
        const actor = pg.session('postgres');
        await blocker.run(`begin; select 1 from ${roles} where role_id='${blockedRole}' for update;`);
        await actor.run('begin;');
        const [actorPid, blockerPid] = [await pidOf(actor), await pidOf(blocker)];
        const pending = actor.run(call(orgA, id));
        await awaitBlocked(actorPid, blockerPid);
        assert.equal(await locked(orgs, 'organisation_id', orgA), true, 'organisation lock held first');
        assert.equal(await locked(users, 'user_id', id), true, 'user lock held before any role lock');
        for (const held of expectHeld) assert.equal(await locked(roles, 'role_id', held), true, `lower role ${held} held`);
        for (const free of expectFree) assert.equal(await locked(roles, 'role_id', free), false, `higher role ${free} not yet locked`);
        await blocker.run('rollback;');
        assert.equal((await pending).err, '');
        // Once complete, all three roles are held under the still-open transaction.
        for (const role of [r1, r2, r3]) assert.equal(await locked(roles, 'role_id', role), true);
        await actor.run('rollback;');
        await blocker.close(); await actor.close();
      }
      t.diagnostic('Lock order proven by FOR UPDATE NOWAIT probes: org, user, r1<r2<r3 although role_ids stored as [r3,r1,r2]');
    } finally { await probe.close(); }
  });

  await t.test('38. bounded lock_timeout: blocked org/user/role fails with 55P03, never eligibility; GUC is function-local', async () => {
    const id = await mkUser(arr(adminRole));
    const targets: Array<[string, string, string]> = [
      [orgs, 'organisation_id', orgA], [users, 'user_id', id], [roles, 'role_id', adminRole],
    ];
    for (const [table, key, value] of targets) {
      const blocker = pg.session('postgres');
      try {
        await blocker.run(`begin; select 1 from ${table} where ${key}='${value}' for update;`);
        const started = Date.now();
        await assert.rejects(owner(call(orgA, id)), (error: Error) => {
          assert.match(error.message, /55P03|lock timeout|lock_not_available/i);
          assert.doesNotMatch(error.message, /"actor_user_id"/);
          return true;
        });
        const elapsed = Date.now() - started;
        assert.ok(elapsed >= 4000 && elapsed < 20000, `${table}: bounded ~5s timeout, got ${elapsed}ms`);
        t.diagnostic(`lock_timeout on ${table}: rejected after ${elapsed}ms`);
      } finally { await blocker.run('rollback;'); await blocker.close(); }
    }
    const probe = pg.session('postgres');
    try {
      const before = (await probe.run('show lock_timeout;')).out.trim();
      await probe.run('begin;');
      assert.equal((await probe.run(call(orgA, id))).err, '');
      assert.equal((await probe.run('show lock_timeout;')).out.trim(), before, 'function-local lock_timeout restored on exit');
      await probe.run('rollback;');
    } finally { await probe.close(); }
  });

  await t.test('no eligibility state leaks across failures: a failed call leaves no locks that block writers after rollback', async () => {
    const id = await mkUser(arr(adminRole));
    await rejected(id, ...TEMPORAL, 'SESSION_EXPIRED', orgA, 't.s - 10', 't.s');
    await sql(`update ${users} set department='after-failure' where user_id='${id}'`);
    await sql(`update ${orgs} set legal_name=legal_name where organisation_id='${orgA}'`);
  });
});
