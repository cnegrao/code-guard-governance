import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { credentialMigration, disposableM16Postgres, eligibilityMigration, epochBindingMigration, governedWriteWrapperMigration, migrationSource, objectMaterializationCompatMigration } from '../helpers/disposable-m16-postgres';
import * as fx from '../helpers/m16-governed-write-fixtures';

type Session = ReturnType<Awaited<ReturnType<typeof disposableM16Postgres>>['session']>;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const lastLine = (out: string) => out.replace(/\r/g, '').trim().split('\n').pop() as string;

const GUARD = 'gov_repo.require_governed_write_eligibility_v1';
const GUARD_SIG = `${GUARD}(uuid,uuid,bigint,bigint,timestamptz)`;
const HELPER_SIG = 'gov_repo.lock_and_resolve_governance_session_eligibility_v1(uuid,uuid,bigint,bigint,timestamptz)';
const PRINCIPAL_PARAMS = 'p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint, p_verified_credential_epoch timestamp with time zone';

interface Prepared { readonly args: (actor: string, org: string, tamper?: Record<string, unknown>) => Record<string, string>; readonly counts: string }
interface Family {
  readonly key: string; readonly wrapper: string; readonly underlying: string; readonly columns: string[];
  /** Table written LAST by the underlying write (blocking it there leaves earlier writes in flight). */
  readonly blockTable: string; readonly earlierTable: string; readonly xminTable: string;
  readonly embedded: boolean;
  prepare(ctx: Ctx): Promise<Prepared>;
}
interface Ctx { org: string; actor: string; label: string; epoch: string }

test('M16 S0.3.3B canonical disposable PG17 governed write wrappers (expand phase)', { timeout: 3_600_000 }, async t => {
  const pg = await disposableM16Postgres(message => t.diagnostic(message), { governanceWriteChain: true });
  const { sql, bootstrapSql, migrate } = pg;
  t.after(() => pg.stop());
  await migrate(credentialMigration);
  await migrate(eligibilityMigration);
  await migrate(epochBindingMigration);
  // S0.3.3B0 (committed a056d1a3, audited, CLOSED): corrects materialize_object_reconciliation's
  // PG17-incompatible ON CONFLICT before the governed wrapper is layered over it. Applied here,
  // never re-authored — the object family now receives the same acceptance coverage as every
  // other wrapper family.
  await migrate(objectMaterializationCompatMigration);

  // Optional local filter (developer convenience only): M16_WRAPPER_FILTER='regex' skips other subtests.
  const filter = process.env.M16_WRAPPER_FILTER ? new RegExp(process.env.M16_WRAPPER_FILTER) : undefined;
  const sub = (name: string, fn: () => Promise<void>) => t.test(name, { skip: filter !== undefined && !filter.test(name) }, fn);
  const owner = (query: string) => sql(query, 'postgres');
  const svc = (query: string) => sql(query, 'service_role');
  const users = 'gov_repo.governance_users';
  const roles = 'gov_repo.governance_roles';
  const orgs = 'gov_repo.organisations';
  const trigger = 'trg_governance_users_credential_epoch_v1';
  const underlyingSigs = [
    'gov_repo.apply_review_transition', 'gov_repo.record_authorization_decision', 'gov_repo.record_authorized_reconciliation',
    'gov_repo.materialize_object_reconciliation', 'gov_repo.materialize_relationship_reconciliation',
    'gov_repo.record_technical_field_decision', 'gov_repo.record_execution_field_decision'];
  const snapshotAcls = () => sql(`select md5(coalesce((select string_agg(p.oid::regprocedure::text||'='||coalesce(p.proacl::text,'null'),';' order by p.oid::regprocedure::text)
      from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname = any(array[${underlyingSigs.map(s => `'${s.slice(9)}'`).join(',')}])),'')),
    (select md5(string_agg(c.relname||'='||coalesce(c.relacl::text,'null'),';' order by c.relname)) from pg_class c
      where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p','v','m','f','S'))`, 'm16_bootstrap');
  const aclBefore = await snapshotAcls();
  const tablePrivBefore = await sql(`select md5(string_agg(c.relname||'='||coalesce(c.relacl::text,'null'),';' order by c.relname)) from pg_class c
    where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p','v','m','f','S')`, 'm16_bootstrap');
  await migrate(governedWriteWrapperMigration);

  let orgCounter = 0;
  const nextOrgNumber = () => `${++orgCounter}`;
  const adminRole = await sql(`select role_id from ${roles} where role_code='GOVERNANCE_ADMIN' and is_system_role`);
  const ownerRole = await sql(`select role_id from ${roles} where role_code='POLICY_OWNER'`);
  const extraRole = randomUUID();
  await owner(`insert into ${roles}(role_id,role_code,role_name,role_tier,is_system_role) values('${extraRole}','M16_EXTRA','Extra','organisation',false)`);
  const arr = (...ids: string[]) => ids.length ? `array[${ids.map(id => `'${id}'`).join(',')}]::uuid[]` : `'{}'::uuid[]`;

  async function newOrg(active = true) {
    const id = randomUUID();
    const n = nextOrgNumber();
    await owner(`insert into ${orgs}(organisation_id,org_code,legal_name,display_name,country_code,is_active) values('${id}','WRAP_${n}','Wrap ${n}','Wrap ${n}','PT',${active})`);
    return id;
  }
  const setEpoch = (id: string, expression: string) => bootstrapSql(`begin;
    alter table ${users} disable trigger ${trigger};
    update ${users} set password_changed_at=${expression} where user_id='${id}';
    alter table ${users} enable always trigger ${trigger}; commit;`);
  async function mkUser(roleIds: string, org: string, status = 'active') {
    const id = randomUUID();
    await sql(`insert into ${users}(user_id,email,full_name,organisation_id,status,role_ids) values('${id}','${id}@example.invalid','Fixture','${org}','${status}',${roleIds})`);
    await setEpoch(id, `clock_timestamp() - interval '12 hours'`);
    const epoch = await owner(`select password_changed_at::text from ${users} where user_id='${id}'`);
    return { id, epoch: `'${epoch}'::timestamptz` };
  }
  let scenarioCounter = 0;
  const targetOrg = await newOrg();

  // ---------- concurrency machinery (same technique as the S0.3.2 helper suite) ----------
  const monitor = pg.session('m16_bootstrap');
  t.after(() => monitor.close());
  const pidOf = async (session: Session) => (await session.run('select pg_backend_pid();')).out.trim();
  async function awaitBlocked(blocked: string, holder: string) {
    for (let i = 0; i < 1000; i++) {
      const state = (await monitor.run(`select coalesce((select wait_event_type from pg_stat_activity where pid=${blocked}),'')
        ||':'||(pg_blocking_pids(${blocked}) @> array[${holder}])::text;`)).out.trim();
      if (state === 'Lock:true') return;
      await sleep(20);
    }
    assert.fail('session never observed blocked by the expected holder');
  }
  const dbSeconds = async () => Number(lastLine((await monitor.run(`select floor(extract(epoch from clock_timestamp()))::bigint;`)).out));
  const stableSecond = () => bootstrapSql(`do $s$ begin if (extract(epoch from clock_timestamp())::numeric % 1) > 0.7 then perform pg_sleep(0.4); end if; end $s$;`);

  // ---------- families: real underlying functions, real fixtures ----------
  const count = (table: string, org: string) => `(select count(*) from gov_repo.${table} where organisation_id='${org}')`;
  const families: Family[] = [
    { key: 'A-review-transition', wrapper: 'apply_review_transition_governed_v1', underlying: 'apply_review_transition',
      columns: ['event_id', 'new_state', 'occurred_at', 'previous_state', 'replay', 'review_subject_id', 'revision', 'state'],
      blockTable: 'outbox_events', earlierTable: 'review_audit_events', xminTable: 'review_audit_events', embedded: false,
      async prepare(ctx) {
        const kit = fx.reviewedObjectKit(ctx.org, ctx.label, 'DETECTED');
        await owner(kit.sql);
        return { args: () => fx.reviewTransitionArgs(ctx.label, kit),
          counts: `select ${count('review_audit_events', ctx.org)}||':'||${count('outbox_events', ctx.org)}||':'||(select revision||state from gov_repo.review_subjects where review_subject_id='${kit.subject}')` };
      } },
    { key: 'B-authorized-reconciliation', wrapper: 'record_authorized_reconciliation_governed_v1', underlying: 'record_authorized_reconciliation',
      columns: ['authorization_decision_id', 'invocation_id', 'reconciliation_decision_id', 'replay'],
      blockTable: 'outbox_events', earlierTable: 'reconciliation_decisions', xminTable: 'reconciliation_decisions', embedded: true,
      async prepare(ctx) {
        const kit = fx.reviewedObjectKit(ctx.org, ctx.label, 'CERTIFIED');
        await owner(kit.sql);
        return { args: (actor, org, tamper) => fx.governedReconciliationArgs(ctx.label, org, kit, actor, tamper),
          counts: `select ${count('reconciliation_decisions', ctx.org)}||':'||${count('reconciliation_invocations', ctx.org)}||':'||${count('authorization_decisions', ctx.org)}||':'||${count('outbox_events', ctx.org)}||':'||${count('reconciliation_command_locks', ctx.org)}` };
      } },
    { key: 'C-materialize-object', wrapper: 'materialize_object_reconciliation_governed_v1', underlying: 'materialize_object_reconciliation',
      columns: ['canonical_object_id', 'mapping_id', 'replay', 'status'],
      blockTable: 'outbox_events', earlierTable: 'materialization_operations', xminTable: 'materialization_operations', embedded: false,
      async prepare(ctx) {
        const kit = fx.reviewedObjectKit(ctx.org, ctx.label, 'CERTIFIED');
        await owner(kit.sql);
        // The unchanged, still-executable legacy production function records the decision to materialize.
        await svc(fx.legacyReconciliationSql(ctx.label, ctx.org, kit, ctx.actor));
        return { args: () => fx.materializeObjectArgs(ctx.label, kit),
          counts: `select ${count('materialization_operations', ctx.org)}||':'||${count('canonical_objects', ctx.org)}||':'||${count('canonical_normalized_object_mappings', ctx.org)}||':'||${count('outbox_events', ctx.org)}||':'||${count('materialization_locks', ctx.org)}` };
      } },
    { key: 'C-materialize-relationship', wrapper: 'materialize_relationship_reconciliation_governed_v1', underlying: 'materialize_relationship_reconciliation',
      columns: ['relationship_id', 'replay', 'status'],
      blockTable: 'outbox_events', earlierTable: 'materialization_operations', xminTable: 'materialization_operations', embedded: false,
      async prepare(ctx) {
        const kit = fx.relationshipKit(ctx.org, ctx.label, ctx.actor);
        await owner(kit.sql);
        await svc(kit.legacyDecisionSql);
        return { args: () => kit.args,
          counts: `select ${count('materialization_operations', ctx.org)}||':'||${count('canonical_relationships', ctx.org)}||':'||${count('outbox_events', ctx.org)}||':'||${count('materialization_locks', ctx.org)}` };
      } },
    { key: 'D-technical-field-decision', wrapper: 'record_technical_field_decision_governed_v1', underlying: 'record_technical_field_decision',
      columns: ['replay', 'state_id'],
      blockTable: 'technical_field_decision_observations', earlierTable: 'technical_field_decisions', xminTable: 'technical_field_decisions', embedded: true,
      async prepare(ctx) {
        const kit = fx.technicalKit(ctx.org, ctx.label);
        await owner(kit.sql);
        return { args: (actor, org, tamper) => ({ p_decision: fx.jsonLit(kit.decision(`tdec-${ctx.label}`, actor, { organisationId: org, ...tamper })) }),
          counts: `select ${count('technical_field_decisions', ctx.org)}||':'||${count('technical_field_decision_observations', ctx.org)}||':'||${count('technical_field_states', ctx.org)}` };
      } },
    { key: 'E-execution-field-decision', wrapper: 'record_execution_field_decision_governed_v1', underlying: 'record_execution_field_decision',
      columns: ['replay', 'state_id'],
      blockTable: 'execution_field_states', earlierTable: 'execution_field_decisions', xminTable: 'execution_field_decisions', embedded: true,
      async prepare(ctx) {
        const kit = fx.executionKit(ctx.org, ctx.label);
        await owner(kit.sql);
        return { args: (actor, org, tamper) => ({ p_decision: fx.jsonLit(kit.decision(`edec-${ctx.label}`, actor, { organisationId: org, ...tamper })) }),
          counts: `select ${count('execution_field_decisions', ctx.org)}||':'||${count('execution_field_states', ctx.org)}` };
      } },
  ];

  interface Scenario { readonly ctx: Ctx; readonly prepared: Prepared; readonly counts: () => Promise<string> }
  async function scenario(fam: Family, opts: { roles?: string; status?: string; orgActive?: boolean } = {}): Promise<Scenario> {
    const org = await newOrg(opts.orgActive ?? true);
    const user = await mkUser(opts.roles ?? arr(adminRole), org, opts.status ?? 'active');
    const label = `${fam.key.split('-')[0].toLowerCase()}${fam.key.includes('relationship') ? 'r' : ''}${++scenarioCounter}`;
    const ctx: Ctx = { org, actor: user.id, label, epoch: user.epoch };
    const prepared = await fam.prepare(ctx);
    return { ctx, prepared, counts: async () => lastLine(await owner(prepared.counts)) };
  }
  const principalArgs = (ctx: Ctx, o: { org?: string; actor?: string; iat?: string; exp?: string; epoch?: string } = {}) => ({
    p_verified_organisation_id: `'${o.org ?? ctx.org}'::uuid`, p_verified_actor_user_id: `'${o.actor ?? ctx.actor}'::uuid`,
    p_verified_session_iat: o.iat ?? `(floor(extract(epoch from clock_timestamp()))::bigint - 10)`,
    p_verified_session_exp: o.exp ?? `(floor(extract(epoch from clock_timestamp()))::bigint + 3600)`,
    p_verified_credential_epoch: o.epoch ?? ctx.epoch });
  const callSql = (fam: Family, s: Scenario, o: Parameters<typeof principalArgs>[1] = {}, tamper?: Record<string, unknown>) =>
    `select to_json(w) from gov_repo.${fam.wrapper}(${fx.named({ ...principalArgs(s.ctx, o), ...s.prepared.args(o.actor ?? s.ctx.actor, s.ctx.org, tamper) })}) w;`;
  const rejects = (query: string, code: string, token: string, detail?: string, role: 'service_role' | 'postgres' | 'anon' | 'authenticated' = 'service_role') =>
    assert.rejects(sql(query, role), (error: Error) => {
      assert.match(error.message, new RegExp(`${code}[\\s\\S]*${token}`), error.message);
      if (detail) assert.match(error.message, new RegExp(detail), error.message);
      return true;
    });
  const GV = {
    ORG: ['GV003', 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE', 'ORGANISATION_UNAVAILABLE'],
    ACTOR: ['GV003', 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE', 'ACTOR_UNAVAILABLE_OR_NOT_MEMBER'],
    STALE: ['GV002', 'M16_ELIGIBILITY_CREDENTIAL_STALE', 'CREDENTIAL_EPOCH_MISMATCH'],
    ROLESET: ['GV004', 'M16_ELIGIBILITY_ROLE_SET_INVALID', 'ASSIGNED_ROLE_UNRESOLVED|MALFORMED_ROLE_ASSIGNMENT'],
    ISOLATION: ['GV005', 'M16_ELIGIBILITY_UNSUPPORTED_TRANSACTION_ISOLATION', 'READ_COMMITTED_REQUIRED'],
    EXPIRED: ['GV001', 'M16_ELIGIBILITY_SESSION_TEMPORALLY_INVALID', 'SESSION_EXPIRED'],
    DENIED: ['GV006', 'M16_WRITE_AUTHORITY_DENIED', 'GOVERNANCE_ADMIN_REQUIRED'],
    EMB_ORG: ['GV003', 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE', 'EMBEDDED_ORGANISATION_MISMATCH'],
    EMB_ACTOR: ['GV003', 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE', 'EMBEDDED_ACTOR_MISMATCH'],
    EMB_KIND: ['GV003', 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE', 'EMBEDDED_ACTOR_NOT_HUMAN'],
  } as const;
  type GvCase = readonly [string, string, string];
  const expectGv = (query: string, gv: GvCase) => rejects(query, gv[0], gv[1], gv[2]);

  // =====================================================================================
  await sub('catalog: guard + six wrappers are DEFINER/VOLATILE/plpgsql functions with pinned search_path, exact ACL, no exception handling', async () => {
    assert.equal(await sql(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like '%\\_governed\\_v1'`), '6');
    assert.equal(await sql(`select pg_get_function_identity_arguments('${GUARD_SIG}'::regprocedure)`), PRINCIPAL_PARAMS);
    assert.equal(await sql(`select pg_get_function_result('${GUARD_SIG}'::regprocedure)`), 'void');
    assert.equal(await sql(`select proacl::text from pg_proc where oid='${GUARD_SIG}'::regprocedure`), '{postgres=X/postgres}');
    for (const role of ['service_role', 'anon', 'authenticated']) assert.equal(await sql(`select has_function_privilege('${role}','${GUARD_SIG}','EXECUTE')`), 'f');
    assert.equal(await sql(`select count(*) from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='${GUARD_SIG}'::regprocedure and a.privilege_type='EXECUTE' and a.grantee=0`), '0');
    const inventory: string[] = [];
    for (const fam of [{ wrapper: 'require_governed_write_eligibility_v1', underlying: null }, ...families]) {
      const oid = (await sql(`select p.oid from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname='${fam.wrapper}'`)).trim();
      assert.match(oid, /^\d+$/, `${fam.wrapper} must exist exactly once`);
      assert.equal(await sql(`select prosecdef and provolatile='v' and prokind='f' and prolang=(select oid from pg_language where lanname='plpgsql')
        and pg_get_userbyid(proowner)='postgres' from pg_proc where oid=${oid}`), 't', `${fam.wrapper}: DEFINER, VOLATILE, function (not procedure), plpgsql, owner postgres`);
      assert.equal(await sql(`select proconfig::text from pg_proc where oid=${oid}`), '{"search_path=pg_catalog, pg_temp"}');
      assert.equal(await sql(`select pg_get_function_identity_arguments(${oid})`).then(s => s.startsWith(PRINCIPAL_PARAMS)), true, `${fam.wrapper}: first five arguments are the verified principal`);
      const source = (await sql(`select prosrc from pg_proc where oid=${oid}`)).replace(/--[^\r\n]*/g, '');
      assert.doesNotMatch(source, /\bEXCEPTION\s+WHEN\b/i, `${fam.wrapper}: no exception block can swallow a failure`);
      assert.doesNotMatch(source, /\bEXECUTE\b/i, `${fam.wrapper}: no dynamic SQL`);
      assert.doesNotMatch(source, /\b(COMMIT|ROLLBACK|SAVEPOINT|PERFORM\s+pg_sleep)\b/i);
      assert.doesNotMatch(source, /\bpermissions\b/i, 'no L14 / permissions interpretation');
      if (fam.underlying) {
        assert.equal(await sql(`select pg_get_function_result(${oid})`), await sql(`select pg_get_function_result('gov_repo.${fam.underlying}'::regproc)`), `${fam.wrapper}: result shape identical to ${fam.underlying}`);
        // Order in the source: guard, then the underlying call, then the guard again.
        const positions = [...source.matchAll(/require_governed_write_eligibility_v1|gov_repo\.(apply_review_transition|record_authorized_reconciliation|materialize_object_reconciliation|materialize_relationship_reconciliation|record_technical_field_decision|record_execution_field_decision)\(/g)].map(m => m[0]);
        assert.deepEqual(positions.map(p => p.startsWith('require') ? 'guard' : 'write'), ['guard', 'write', 'guard'], `${fam.wrapper}: helper#1 -> nested write -> helper#2`);
        assert.equal(await sql(`select proacl::text from pg_proc where oid=${oid}`), '{postgres=X/postgres,service_role=X/postgres}');
        for (const role of ['anon', 'authenticated']) assert.equal(await sql(`select has_function_privilege('${role}',${oid},'EXECUTE')`), 'f');
        assert.equal(await sql(`select has_function_privilege('service_role',${oid},'EXECUTE')`), 't');
        assert.equal(await sql(`select count(*) from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=${oid} and a.privilege_type='EXECUTE' and a.grantee=0`), '0');
      }
      inventory.push(`${fam.wrapper}: ${await sql(`select proacl::text from pg_proc where oid=${oid}`)}`);
    }
    t.diagnostic(`Governed objects ACL:\n${inventory.join('\n')}`);
    // The guard calls the SINGLE canonical helper; the helper itself is unchanged and owner-only.
    assert.match((await sql(`select prosrc from pg_proc where oid='${GUARD_SIG}'::regprocedure`)), /gov_repo\.lock_and_resolve_governance_session_eligibility_v1\(/);
    assert.equal(await sql(`select proacl::text from pg_proc where oid='${HELPER_SIG}'::regprocedure`), '{postgres=X/postgres}');
    assert.equal(await sql(`select prosrc ~ 'GOVERNANCE_ADMIN' and prosrc ~ 'is_system_role' from pg_proc where oid='${HELPER_SIG}'::regprocedure`), 't');
  });

  await sub('EXPAND phase: underlying legacy RPCs are STILL executable by service_role (transitional bypass, NOT closed in S0.3.3B)', async () => {
    const report: string[] = [];
    for (const name of underlyingSigs) {
      const oid = (await sql(`select p.oid from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname='${name.slice(9)}'`)).trim();
      assert.match(oid, /^\d+$/);
      assert.equal(await sql(`select has_function_privilege('service_role',${oid},'EXECUTE')`), 't', `${name} must remain callable by service_role in this phase`);
      for (const role of ['anon', 'authenticated']) assert.equal(await sql(`select has_function_privilege('${role}',${oid},'EXECUTE')`), 'f');
      report.push(`${name}: service_role EXECUTE = true (expected, expand phase); ACL ${await sql(`select proacl::text from pg_proc where oid=${oid}`)}`);
    }
    t.diagnostic(`TRANSITIONAL DIRECT-RPC BYPASS (not a bypass-closure PASS; revocation is S0.3.3D):\n${report.join('\n')}`);
    // The wrapper migration changed NO pre-existing ACL: underlying function ACLs and every table ACL are byte-identical.
    assert.equal(await snapshotAcls().then(s => s.split('\n')[0]), aclBefore.split('\n')[0], 'underlying function ACLs unchanged by the wrapper migration');
    const tablePrivAfter = await sql(`select md5(string_agg(c.relname||'='||coalesce(c.relacl::text,'null'),';' order by c.relname)) from pg_class c
      where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p','v','m','f','S')`, 'm16_bootstrap');
    assert.equal(tablePrivAfter, tablePrivBefore, 'no table/sequence/view privilege changed: no new direct table-DML path');
  });

  await sub('ACL negative controls: default-privilege service_role EXECUTE on an un-revoked guard is DETECTED by the postflight logic', async () => {
    // A guard clone created WITHOUT the explicit revoke inherits the legacy default privilege (service_role EXECUTE).
    await owner(`create function gov_repo.negctl_guard_v1() returns void language sql as 'select 1'`);
    assert.equal(await sql(`select has_function_privilege('service_role','gov_repo.negctl_guard_v1()','EXECUTE')`), 't', 'legacy defaults DO grant service_role');
    assert.match(await sql(`select proacl::text from pg_proc where oid='gov_repo.negctl_guard_v1()'::regprocedure`), /service_role=X\/postgres/);
    // Run the migration's REAL postflight block after each deliberate ACL regression; it must raise, then roll back.
    const source = migrationSource(governedWriteWrapperMigration);
    const block = source.slice(source.indexOf('DO $postflight$'), source.indexOf('$postflight$;', source.indexOf('DO $postflight$') + 20) + '$postflight$;'.length);
    assert.match(block, /^DO \$postflight\$/);
    await owner(`begin; ${block} rollback;`); // intended ACL: passes
    const regressions: Array<[string, string, RegExp]> = [
      ['guard granted to service_role (missing explicit revoke)', `grant execute on function ${GUARD_SIG} to service_role;`, /guard has EXECUTE for a non-owner/],
      ['guard granted to PUBLIC', `grant execute on function ${GUARD_SIG} to public;`, /guard has EXECUTE for a non-owner/],
      ['wrapper granted to PUBLIC', `grant execute on function gov_repo.apply_review_transition_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,text,text,timestamptz,text[],text,text,text) to public;`, /has PUBLIC EXECUTE/],
      ['wrapper granted to anon', `grant execute on function gov_repo.record_technical_field_decision_governed_v1(uuid,uuid,bigint,bigint,timestamptz,jsonb) to anon;`, /executable by anon/],
      ['wrapper revoked from service_role', `revoke execute on function gov_repo.record_execution_field_decision_governed_v1(uuid,uuid,bigint,bigint,timestamptz,jsonb) from service_role;`, /not executable by service_role/],
    ];
    for (const [name, ddl, expected] of regressions) {
      await assert.rejects(owner(`begin; ${ddl} ${block} rollback;`), (error: Error) => { assert.match(error.message, expected, name); return true; }, name);
    }
    await owner(`drop function gov_repo.negctl_guard_v1()`);
  });

  await sub('direct denial: service_role/anon/authenticated cannot execute the guard; anon/authenticated cannot execute any wrapper', async () => {
    const id = randomUUID();
    const call = `select ${GUARD}('${id}'::uuid,'${id}'::uuid,1::bigint,2::bigint,now())`;
    for (const role of ['service_role', 'anon', 'authenticated'] as const) await rejects(call, '42501', 'permission denied for (function|schema)', undefined, role);
    const org = await newOrg();
    const user = await mkUser(arr(adminRole), org);
    for (const role of ['anon', 'authenticated'] as const) {
      await rejects(`select * from gov_repo.${families[0].wrapper}('${org}'::uuid,'${user.id}'::uuid,1::bigint,2::bigint,now(),'a','b','c','d',now(),'{}'::text[],null::text,'e','f')`,
        '42501', 'permission denied for (function|schema)', undefined, role);
    }
  });

  await sub('table-DML residual MEASURED (PRODUCTION_SECURITY_GATE_RESIDUAL; not remediated, not a new path)', async () => {
    const tables = ['review_subjects', 'review_audit_events', 'outbox_events', 'authorization_decisions', 'reconciliation_decisions', 'reconciliation_invocations',
      'canonical_objects', 'canonical_relationships', 'materialization_operations', 'technical_field_decisions', 'technical_field_states',
      'execution_field_decisions', 'execution_field_states'];
    const lines: string[] = [];
    for (const table of tables) {
      const privileges = JSON.parse(await sql(`select json_object_agg(p, has_table_privilege('service_role','gov_repo.${table}',p)) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p`));
      lines.push(`service_role on gov_repo.${table}: ${Object.entries(privileges).filter(([, v]) => v).map(([k]) => k).join(',') || 'none'}`);
      for (const role of ['anon', 'authenticated']) assert.equal(await sql(`select has_table_privilege('${role}','gov_repo.${table}','INSERT')`), 'f');
    }
    t.diagnostic(`MEASURED service_role table privileges on authoritative tables (residual, unchanged by S0.3.3B):\n${lines.join('\n')}`);
  });

  // =====================================================================================
  for (const fam of families) {
    await sub(`${fam.key}: basic wrapper behaviour, identity binding, fail-closed set, no surviving mutation`, async () => {
      // eligible current admin succeeds; result shape identical to the underlying contract
      const ok = await scenario(fam);
      const before = await ok.counts();
      const row = JSON.parse(lastLine(await svc(callSql(fam, ok))));
      assert.deepEqual(Object.keys(row).sort(), fam.columns, 'wrapper result columns identical to the underlying contract');
      assert.equal(row.replay, false);
      assert.notEqual(await ok.counts(), before, 'the authoritative write happened');
      // an identical replay through the wrapper is the underlying replay, unchanged
      const after = await ok.counts();
      const replay = JSON.parse(lastLine(await svc(callSql(fam, ok))));
      assert.equal(replay.replay, true);
      assert.equal(await ok.counts(), after, 'replay wrote nothing');

      const rejectedCases: Array<[string, Scenario, GvCase, Parameters<typeof principalArgs>[1]?]> = [];
      rejectedCases.push(['no governance admin', await scenario(fam, { roles: arr(ownerRole) }), GV.DENIED]);
      rejectedCases.push(['no roles at all', await scenario(fam, { roles: arr() }), GV.DENIED]);
      rejectedCases.push(['inactive organisation', await scenario(fam, { orgActive: false }), GV.ORG]);
      rejectedCases.push(['suspended actor', await scenario(fam, { status: 'suspended' }), GV.ACTOR]);
      const cross = await scenario(fam);
      rejectedCases.push(['cross-tenant actor (principal names another organisation)', cross, GV.ACTOR, { org: targetOrg }]);
      const stale = await scenario(fam);
      rejectedCases.push(['stale credential epoch', stale, GV.STALE, { epoch: `(${stale.ctx.epoch} - interval '1 microsecond')` }]);
      const bad = await scenario(fam, { roles: arr(adminRole, randomUUID()) });
      rejectedCases.push(['unresolved assigned role', bad, GV.ROLESET]);
      const dup = await scenario(fam, { roles: `array['${adminRole}','${adminRole}']::uuid[]` });
      rejectedCases.push(['malformed (duplicate) role set', dup, GV.ROLESET]);
      const expired = await scenario(fam);
      rejectedCases.push(['expired session', expired, GV.EXPIRED, { iat: `(floor(extract(epoch from clock_timestamp()))::bigint - 100)`, exp: `(floor(extract(epoch from clock_timestamp()))::bigint - 1)` }]);
      for (const [name, s, gv, o] of rejectedCases) {
        const b = await s.counts();
        await expectGv(callSql(fam, s, o ?? {}), gv);
        assert.equal(await s.counts(), b, `${name}: no mutation may survive`);
      }
      // unsupported isolation: rejected by the canonical helper, nothing written
      const iso = await scenario(fam);
      const isoBefore = await iso.counts();
      await expectGv(`begin isolation level repeatable read; ${callSql(fam, iso)} rollback;`, GV.ISOLATION);
      assert.equal(await iso.counts(), isoBefore);

      if (fam.embedded) {
        // Correct verified parameters must not be able to smuggle a different tenant/actor inside the JSON.
        const other = randomUUID();
        const tampers: Array<[string, Record<string, unknown>, GvCase]> = fam.key.startsWith('B')
          ? [['embedded organisation', { organisationId: targetOrg }, GV.EMB_ORG],
             ['embedded actor', { authority: { authorityKind: 'HUMAN', actorReference: other } }, GV.EMB_ACTOR],
             ['embedded non-HUMAN authority', { authority: { authorityKind: 'DETERMINISTIC_RULE', ruleCode: 'r', ruleVersion: '1' } }, GV.EMB_KIND],
             ['embedded actor missing', { authority: null }, GV.EMB_KIND]]
          : [['embedded organisation', { organisationId: targetOrg }, GV.EMB_ORG],
             ['embedded canonicalObject organisation', { canonicalObject: { organisationId: targetOrg, objectId: 'x', kind: 'DATA_ASSET' } }, GV.EMB_ORG],
             ['embedded actor', { actor: { authorityKind: 'HUMAN', actorReference: other } }, GV.EMB_ACTOR],
             ['embedded non-HUMAN actor', { actor: { authorityKind: 'DETERMINISTIC_RULE', ruleCode: 'r', ruleVersion: '1' } }, GV.EMB_KIND]];
        for (const [name, tamper, gv] of tampers) {
          const s = await scenario(fam);
          const b = await s.counts();
          await expectGv(callSql(fam, s, {}, tamper), gv);
          assert.equal(await s.counts(), b, `${name}: no mutation may survive`);
        }
      } else {
        // Flat identity is derived: the verified actor is what the underlying write records.
        if (fam.key.startsWith('A')) {
          assert.equal(await owner(`select actor_kind||':'||actor_reference from gov_repo.review_audit_events where organisation_id='${ok.ctx.org}'`), `HUMAN:${ok.ctx.actor}`);
        }
      }
      if (fam.key.startsWith('B')) {
        assert.equal(await owner(`select authority_kind||':'||authority_reference from gov_repo.reconciliation_decisions where organisation_id='${ok.ctx.org}'`), `HUMAN:${ok.ctx.actor}`);
        assert.equal(await owner(`select actor_kind||':'||actor_reference from gov_repo.reconciliation_invocations where organisation_id='${ok.ctx.org}'`), `HUMAN:${ok.ctx.actor}`);
        assert.equal(await owner(`select actor_reference from gov_repo.authorization_decisions where organisation_id='${ok.ctx.org}'`), ok.ctx.actor);
      }
    });
  }

  // =====================================================================================
  for (const fam of families) {
    await sub(`${fam.key}: helper#1 -> write -> helper#2 in ONE transaction (pre-commit invisibility, xmin, held locks)`, async () => {
      const s = await scenario(fam);
      const before = await s.counts();
      const session = pg.session('service_role');
      try {
      await session.run('begin;');
      const result = await session.run(callSql(fam, s));
      assert.equal(result.err, '', result.err);
      assert.equal(JSON.parse(lastLine(result.out)).replay, false);
      // Same backend + transaction: every row the underlying function wrote carries THIS transaction's xid.
      const xmin = (await session.run(`select count(*)||':'||bool_and(xmin::text::bigint = txid_current() % 4294967296) from gov_repo.${fam.xminTable} where organisation_id='${s.ctx.org}';`)).out.trim();
      assert.match(xmin, /^[1-9]\d*:true$/, `rows written by ${fam.underlying} have xmin == current transaction (${xmin})`);
      // Another backend cannot observe anything before COMMIT (READ COMMITTED).
      assert.equal(await owner(`select count(*) from gov_repo.${fam.xminTable} where organisation_id='${s.ctx.org}'`), '0');
      assert.equal(await s.counts(), before, 'no other backend sees any part of the mutation before COMMIT');
      // Helper-held locks are STILL held after the write (retained until COMMIT): eligibility writers are blocked.
      const probe = (from: string, where: string) => owner(`select 1 from ${from} where ${where} for no key update nowait`);
      await rejects(`select 1 from ${orgs} where organisation_id='${s.ctx.org}' for no key update nowait`, '55P03', 'could not obtain lock', undefined, 'postgres');
      await rejects(`select 1 from ${users} where user_id='${s.ctx.actor}' for no key update nowait`, '55P03', 'could not obtain lock', undefined, 'postgres');
      await rejects(`select 1 from ${roles} where role_id='${adminRole}' for no key update nowait`, '55P03', 'could not obtain lock', undefined, 'postgres');
      await rejects(`set lock_timeout='300ms'; update ${users} set department='blocked' where user_id='${s.ctx.actor}';`, '55P03', 'lock timeout', undefined, 'postgres');
      await session.run('commit;');
      assert.notEqual(await owner(`select count(*) from gov_repo.${fam.xminTable} where organisation_id='${s.ctx.org}'`), '0');
      await probe(orgs, `organisation_id='${s.ctx.org}'`); // released at COMMIT
      await probe(users, `user_id='${s.ctx.actor}'`);
      assert.notEqual(await s.counts(), before);
      } finally { await session.close(); }
    });
  }

  // =====================================================================================
  for (const fam of families) {
    await sub(`${fam.key}: helper#2 failure (session expires DURING the nested write) rolls the whole mutation back`, async () => {
      const s = await scenario(fam);
      const before = await s.counts();
      await stableSecond();
      const now = await dbSeconds();
      const exp = now + 3;
      const blocker = pg.session('m16_bootstrap');
      const writerSession = pg.session('service_role');
      try {
      await blocker.run(`begin; lock table gov_repo.${fam.blockTable} in share row exclusive mode;`);
      const [writerPid, blockerPid] = [await pidOf(writerSession), await pidOf(blocker)];
      const pending = writerSession.run(callSql(fam, s, { iat: `${now - 20}`, exp: `${exp}` }));
      await awaitBlocked(writerPid, blockerPid);
      // Proof that the mutation had genuinely begun: the blocked backend already holds RowExclusiveLock on an EARLIER written table,
      // and it is waiting on the LATER one. helper#1 already passed (it precedes every write).
      const held = (await monitor.run(`select string_agg(c.relname||':'||l.mode||':'||l.granted, ',' order by c.relname) from pg_locks l join pg_class c on c.oid=l.relation
        where l.pid=${writerPid} and c.relnamespace='gov_repo'::regnamespace and c.relname in ('${fam.earlierTable}','${fam.blockTable}');`)).out;
      assert.match(held, new RegExp(`${fam.earlierTable}:RowExclusiveLock:true`), `nested write already holds ${fam.earlierTable}: ${held}`);
      assert.match(held, new RegExp(`${fam.blockTable}:RowExclusiveLock:false`), `nested write is waiting on ${fam.blockTable}: ${held}`);
      assert.equal(await s.counts(), before, 'another session sees nothing while the write is in flight');
      // Let the DB clock pass the session expiry, then release the nested write.
      for (let i = 0; i < 400 && (await dbSeconds()) < exp; i++) await sleep(50);
      assert.ok((await dbSeconds()) >= exp, 'DB clock passed exp');
      await blocker.run('rollback;');
      const result = await pending;
      assert.match(result.err, /GV001[\s\S]*M16_ELIGIBILITY_SESSION_TEMPORALLY_INVALID/, result.err);
      assert.match(result.err, /SESSION_EXPIRED/);
      assert.equal(result.out, '', 'no result returned');
      assert.equal(await s.counts(), before, 'helper#2 failure rolled back EVERY nested mutation (incl. outbox rows)');
      // The transaction is really gone: the same command can now be executed with a live session (not a replay).
      const retry = JSON.parse(lastLine(await svc(callSql(fam, s))));
      assert.equal(retry.replay, false, 'nothing of the failed command survived');
      } finally { await Promise.all([blocker.close(), writerSession.close()]); }
    });
  }

  // =====================================================================================
  interface Change {
    readonly key: string; readonly roles?: string; readonly sql: (c: Ctx) => string; readonly restore?: string;
    readonly next: 'ok' | GvCase; readonly timeoutLock: 'organisation' | 'user' | 'role'; readonly aOrderSql?: (c: Ctx) => string;
  }
  const changes: Change[] = [
    { key: 'organisation deactivation', sql: c => `update ${orgs} set is_active=false where organisation_id='${c.org}';`, next: GV.ORG, timeoutLock: 'organisation' },
    { key: 'actor status suspension', sql: c => `update ${users} set status='suspended' where user_id='${c.actor}';`, next: GV.ACTOR, timeoutLock: 'user' },
    { key: 'organisation membership move', sql: c => `update ${users} set organisation_id='${targetOrg}' where user_id='${c.actor}';`, next: GV.ACTOR, timeoutLock: 'user' },
    { key: 'role revocation', sql: c => `update ${users} set role_ids='{}'::uuid[] where user_id='${c.actor}';`, next: GV.DENIED, timeoutLock: 'user' },
    // B/C orders start from a NON-admin actor and the grant is the previously absent admin role;
    // in order A (wrapper in flight => already admin) the previously absent grant is an additional role.
    { key: 'previously absent admin grant', roles: arr(ownerRole), sql: c => `update ${users} set role_ids=role_ids||'${adminRole}'::uuid where user_id='${c.actor}';`, next: 'ok',
      timeoutLock: 'user', aOrderSql: c => `update ${users} set role_ids=role_ids||'${extraRole}'::uuid where user_id='${c.actor}';` },
    { key: 'credential external_id rotation / epoch advance', sql: c => `update ${users} set external_id='bcrypt:rotated-${c.label}' where user_id='${c.actor}';`, next: GV.STALE, timeoutLock: 'user' },
    { key: 'assigned role definition change', sql: () => `update ${roles} set is_system_role=false where role_id='${adminRole}';`,
      restore: `update ${roles} set is_system_role=true where role_id='${adminRole}';`, next: GV.DENIED, timeoutLock: 'role' },
  ];
  const nextExpected = async (fam: Family, s: Scenario, ch: Change, replay: boolean) => {
    const b = await s.counts();
    if (ch.next === 'ok') {
      const row = JSON.parse(lastLine(await svc(callSql(fam, s))));
      assert.equal(row.replay, replay, 'the next command succeeded under the newly committed authority state');
    } else {
      await expectGv(callSql(fam, s), ch.next);
      assert.equal(await s.counts(), b, 'the next command was rejected before any write');
    }
  };

  for (const fam of families) {
    for (const ch of changes) {
      // Order A: wrapper first. Eligibility locks win, the change BLOCKS until the wrapper commits, then governs the next command.
      await sub(`${fam.key} x ${ch.key}: order A (wrapper first)`, async () => {
        const isGrant = ch.aOrderSql !== undefined;
        const s = await scenario(fam); // an in-flight wrapper requires a current admin
        const blocker = pg.session('m16_bootstrap');
        const wrapperSession = pg.session('service_role');
        const writer = pg.session('postgres');
        try {
          await blocker.run(`begin; lock table gov_repo.${fam.blockTable} in share row exclusive mode;`);
          const [wrapperPid, blockerPid, writerPid] = [await pidOf(wrapperSession), await pidOf(blocker), await pidOf(writer)];
          const pendingWrapper = wrapperSession.run(callSql(fam, s));
          await awaitBlocked(wrapperPid, blockerPid);
          const pendingWriter = writer.run(isGrant ? ch.aOrderSql!(s.ctx) : ch.sql(s.ctx));
          await awaitBlocked(writerPid, wrapperPid); // the authority change WAITS for the in-flight wrapper's locks
          await blocker.run('rollback;');
          const wrapperResult = await pendingWrapper;
          assert.equal(wrapperResult.err, '', `in-flight wrapper completes under the authority it locked: ${wrapperResult.err}`);
          assert.equal(JSON.parse(lastLine(wrapperResult.out)).replay, false);
          const writerResult = await pendingWriter;
          assert.equal(writerResult.err, '', writerResult.err);
          if (isGrant) {
            const roleIds = JSON.parse(lastLine(await owner(`select to_json(h.role_ids) from ${HELPER_SIG.replace('(uuid,uuid,bigint,bigint,timestamptz)', '')}('${s.ctx.org}','${s.ctx.actor}',
              floor(extract(epoch from clock_timestamp()))::bigint-10,floor(extract(epoch from clock_timestamp()))::bigint+3600,${s.ctx.epoch}) h`)));
            assert.ok(roleIds.includes(extraRole), 'the next command observes the newly granted (previously absent) role');
            await nextExpected(fam, s, { ...ch, next: 'ok' }, true);
          } else {
            await nextExpected(fam, s, ch, true);
          }
        } finally {
          await Promise.all([blocker.close(), wrapperSession.close(), writer.close()]);
          if (ch.restore) await owner(ch.restore);
        }
      });

      // Order B: the change commits first; the wrapper evaluates the committed new state.
      await sub(`${fam.key} x ${ch.key}: order B (change commits first)`, async () => {
        const s = await scenario(fam, { roles: ch.roles });
        try {
          await owner(ch.sql(s.ctx));
          const b = await s.counts();
          if (ch.next === 'ok') {
            const row = JSON.parse(lastLine(await svc(callSql(fam, s))));
            assert.equal(row.replay, false);
            assert.notEqual(await s.counts(), b, 'the wrapper was allowed by the committed grant and wrote');
          } else {
            await expectGv(callSql(fam, s), ch.next);
            assert.equal(await s.counts(), b, 'rejected before any write');
          }
        } finally {
          if (ch.restore) await owner(ch.restore);
        }
      });

      // Order C1: the change's lock is held; it commits within the helper's 5s lock timeout.
      await sub(`${fam.key} x ${ch.key}: order C (change lock held, commit within 5s)`, async () => {
        const s = await scenario(fam, { roles: ch.roles });
        const holder = pg.session('postgres');
        const wrapperSession = pg.session('service_role');
        try {
          await holder.run(`begin; ${ch.sql(s.ctx)}`);
          const [holderPid, wrapperPid] = [await pidOf(holder), await pidOf(wrapperSession)];
          const b = await s.counts();
          const pending = wrapperSession.run(callSql(fam, s));
          await awaitBlocked(wrapperPid, holderPid); // helper#1 waits on the locked authority row
          await holder.run('commit;');
          const result = await pending;
          if (ch.next === 'ok') {
            assert.equal(result.err, '', result.err);
            assert.equal(JSON.parse(lastLine(result.out)).replay, false);
            assert.notEqual(await s.counts(), b);
          } else {
            assert.match(result.err, new RegExp(`${ch.next[0]}[\\s\\S]*${ch.next[1]}`), result.err);
            assert.equal(await s.counts(), b, 'the wrapper evaluated the newly committed state and wrote nothing');
          }
        } finally {
          await Promise.all([holder.close(), wrapperSession.close()]);
          if (ch.restore) await owner(ch.restore);
        }
      });

      // Order C2: the change lock is held BEYOND the helper's lock_timeout: 55P03 and zero mutation.
      await sub(`${fam.key} x ${ch.key}: order C (change lock held past lock_timeout => 55P03, zero mutation)`, async () => {
        const s = await scenario(fam, { roles: ch.roles });
        const holder = pg.session('postgres');
        const wrapperSession = pg.session('service_role');
        try {
          await holder.run(`begin; ${ch.sql(s.ctx)}`);
          const [holderPid, wrapperPid] = [await pidOf(holder), await pidOf(wrapperSession)];
          const b = await s.counts();
          const started = Date.now();
          const pending = wrapperSession.run(callSql(fam, s));
          await awaitBlocked(wrapperPid, holderPid);
          const result = await pending;
          assert.match(result.err, /55P03[\s\S]*lock timeout/, result.err);
          assert.ok(Date.now() - started >= 4500, 'helper waited for its 5s lock_timeout before failing');
          assert.equal(result.out, '');
          await holder.run('rollback;');
          assert.equal(await s.counts(), b, '55P03 left zero mutation');
        } finally {
          await Promise.all([holder.close(), wrapperSession.close()]);
          if (ch.restore) await owner(ch.restore);
        }
      });
    }
  }

  await sub('failure paths do not retain eligibility locks (writer is not blocked after a GV006 / GV002 failure)', async () => {
    const s = await scenario(families[0], { roles: arr(ownerRole) });
    await expectGv(callSql(families[0], s), GV.DENIED);
    await owner(`set lock_timeout='500ms'; update ${users} set department='free' where user_id='${s.ctx.actor}'; update ${orgs} set legal_name=legal_name where organisation_id='${s.ctx.org}';`);
  });

  await sub('final: legacy RPCs still executable by service_role and application ACL unchanged after all scenarios', async () => {
    for (const name of underlyingSigs) {
      assert.equal(await sql(`select has_function_privilege('service_role',(select p.oid from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname='${name.slice(9)}'),'EXECUTE')`), 't');
    }
    assert.equal(await snapshotAcls().then(s => s.split('\n')[0]), aclBefore.split('\n')[0]);
  });
});
