import assert from 'node:assert/strict';
import { test } from 'node:test';
import { l14ReadProjectionMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { INVENTORY_SQL, type InventoryRow } from '../helpers/m16-definer-surface-fixtures';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';
import { controlApplicabilityKit } from '../helpers/m16-l14-control-applicability-fixtures';
import { controlAssessmentKit } from '../helpers/m16-l14-control-assessment-fixtures';
import { L14_ALL_TABLES } from '../helpers/m16-l14-read-projection-fixtures';

/**
 * M16 read-projection closure — privilege closure, preflight, exact security-surface postflight and one rolled-back negative
 * control per privilege / structure class, on real disposable PostgreSQL 17. The M16RP horizon is stopped right before the
 * closure migration so the suite can seed real S1C.1 / S1C.4 / S1C.5 history, snapshot the post-S1C.5 catalog, prove the preflight
 * aborts atomically, then apply the migration itself. Historical postflights are never altered.
 */
const PASSPORT = 'gov_repo.l14_read_passport_governance_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone)';
const CONFLICT = 'gov_repo.l14_read_fact_conflict_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,uuid,text,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)';
const NEW_RPCS = [CONFLICT, PASSPORT] as const;
const RESOLVER = 'gov_repo.l14_responsibility_assignments_current_v1(uuid,text,text,timestamp with time zone,timestamp with time zone)';
const postflight = () => {
  const text = migrationSource(l14ReadProjectionMigration);
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.startsWith('DO $postflight$') && block.includes('M16_RP_POSTFLIGHT'));
  return block;
};
/** Every gov_repo routine body + config + ACL + owner + security mode, except the two new projections. */
const ROUTINE_DIGEST = `select md5(string_agg(oid::regprocedure::text||':'||encode(sha256(convert_to(prosrc,'UTF8')),'hex')||':'||coalesce(array_to_string(proconfig,';'),'-')
  ||':'||coalesce(proacl::text,'-')||':'||pg_get_userbyid(proowner)||':'||prosecdef::text||':'||provolatile::text, ',' order by oid::regprocedure::text collate "C"))
  from pg_proc where pronamespace='gov_repo'::regnamespace and proname not in ('l14_read_passport_governance_v1','l14_read_fact_conflict_v1')`;
/** Every gov_repo relation definition (ACL, RLS, columns, constraints, indexes, triggers, policies). */
const TABLE_DIGEST = `select md5(string_agg(c.oid::regclass::text||'|'||c.relkind::text||'|'||coalesce(c.relacl::text,'-')||'|'||c.relrowsecurity::text||'|'||
  coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull||':'||coalesce(attacl::text,'-'), ',' order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped),'')||'|'||
  coalesce((select string_agg(conname||':'||pg_get_constraintdef(k.oid), ',' order by conname) from pg_constraint k where k.conrelid=c.oid),'')||'|'||
  coalesce((select string_agg(indexrelid::regclass::text, ',' order by indexrelid::regclass::text) from pg_index where indrelid=c.oid),'')||'|'||
  coalesce((select string_agg(tgname||':'||tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid=c.oid and not tgisinternal),'')||'|'||
  coalesce((select string_agg(polname||':'||polcmd::text, ',' order by polname) from pg_policy where polrelid=c.oid),''),
  ',' order by c.oid::regclass::text collate "C")) from pg_class c where c.relnamespace='gov_repo'::regnamespace`;
const ROWS_DIGEST = `select md5(string_agg(x, '|' order by x)) from (${L14_ALL_TABLES.map(t =>
  `select '${t}:'||to_jsonb(t)::text as x from gov_repo.${t} t`).join(' union all ')} union all
  select 'canonical_relationships:'||to_jsonb(t)::text from gov_repo.canonical_relationships t) s`;
const DEFAULT_ACL = `select coalesce(string_agg(defaclrole::regrole::text||':'||defaclnamespace::text||':'||defaclobjtype::text||':'||defaclacl::text, ',' order by 1), '-') from pg_default_acl`;
/** Rewrites one projection body through pg_get_functiondef (same identity / signature / return shape / owner). */
const rewrite = (fn: string, from: string, to: string) => `do $rw$ declare v text := pg_get_functiondef('${fn}'::regprocedure);
  begin if strpos(v, ${`'${from.replace(/'/g, "''")}'`}) = 0 then raise exception 'rewrite anchor missing'; end if;
  execute replace(v, ${`'${from.replace(/'/g, "''")}'`}, ${`'${to.replace(/'/g, "''")}'`}); end $rw$`;

test('M16 read-projection closure: privilege closure, preflight, postflight negative controls (disposable PG17)', { timeout: 2_400_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M16RP', stopBefore: l14ReadProjectionMigration });
  t.after(() => c.stop());
  const { owner, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const inventory = async (): Promise<InventoryRow[]> => JSON.parse(await bootstrapSql(INVENTORY_SQL));

  // Real pre-closure history (S1C.1 responsibility, S1C.4 applicability, S1C.5 assessment): never rewritten by a read projection.
  const rk = await responsibilityKit(c);
  const hist = await rk.setup();
  const party = await rk.party(hist, 'hist');
  await rk.assign(hist, 'hist', rk.keyOf('AGENT', hist.objects.agent, 'BUSINESS_OWNER', party.partyId), party);
  const ck = await controlApplicabilityKit(c);
  const ak = await controlAssessmentKit(c, ck);
  const actx = await ak.setup();
  const applied = await ak.applicability(actx, 'hist', ck.objectTarget('AGENT', actx.objects.byKind.AGENT));
  await ak.assess(actx, 'hist', applied.stateId);
  const routinesBefore = await one(ROUTINE_DIGEST);
  const tablesBefore = await one(TABLE_DIGEST);
  const rowsBefore = await one(ROWS_DIGEST);
  const defaultAclBefore = await one(DEFAULT_ACL);
  const inventoryBefore = await inventory();
  assert.equal(inventoryBefore.filter(p => p.app).length, 43, 'the post-S1C.5 application definer surface is 43');
  assert.equal(inventoryBefore.filter(p => p.app && p.owner_store).length, 33, 'the post-S1C.5 canonical-owner class is 33');

  await t.test('preflight: the exact post-S1C.5 catalog is required; each break aborts atomically with nothing applied', async () => {
    const notApplied = async () => {
      assert.equal(await one(`select count(*) from pg_proc where proname in ('l14_read_passport_governance_v1','l14_read_fact_conflict_v1')`), '0');
      assert.equal(await one(ROUTINE_DIGEST), routinesBefore);
      assert.equal(await one(TABLE_DIGEST), tablesBefore);
      assert.equal(await one(ROWS_DIGEST), rowsBefore);
    };
    for (const [name, brk, fix, message] of [
      ['extra application definer', `create function public.rp_probe() returns integer language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        grant execute on function public.rp_probe() to service_role`, 'drop function public.rp_probe()', /not exactly the 43 post-S1C\.5 baseline/],
      ['reused resolver granted to service_role', `grant execute on function ${RESOLVER} to service_role`,
        `revoke execute on function ${RESOLVER} from service_role`, /is not an owner-only postgres SECURITY INVOKER helper/],
      ['a new l14 relation (second store)', 'create table gov_repo.l14_conflict_probe (x integer)', 'drop table gov_repo.l14_conflict_probe',
        /unexpected l14 relation set/],
      ['projection name already taken', `create function gov_repo.l14_read_fact_conflict_v1() returns integer language sql set search_path = pg_catalog, pg_temp as 'select 1';
        revoke all on function gov_repo.l14_read_fact_conflict_v1() from public`, 'drop function gov_repo.l14_read_fact_conflict_v1()', /read-projection routine already exists/],
    ] as const) {
      await owner(brk);
      await assert.rejects(c.migrate(l14ReadProjectionMigration), (error: Error) => {
        assert.match(error.message, /M16_RP_PREFLIGHT/, name);
        assert.match(error.message, message, name);
        return true;
      });
      await owner(fix);
      await notApplied();
    }
  });

  await c.migrate(l14ReadProjectionMigration);

  await t.test('postflight facts: exact surface 45 / 35; exact ACLs; nothing else changed (routines, tables, rows, defaults, F2)', async () => {
    const after = await inventory();
    assert.equal(after.filter(p => p.app).length, 45, 'application definer surface 43 -> 45');
    assert.equal(after.filter(p => p.app && p.owner_store).length, 35, 'canonical-owner class 33 -> 35');
    assert.deepEqual(after.filter(p => p.app).map(p => p.fn).filter(fn => !inventoryBefore.some(b => b.app && b.fn === fn)).sort(), [...NEW_RPCS].sort());
    for (const fn of NEW_RPCS) {
      const row = after.find(p => p.fn === fn)!;
      assert.deepEqual([row.owner, row.public, row.anon, row.authenticated, row.service_role, row.config],
        ['postgres', false, false, false, true, 'search_path=pg_catalog, pg_temp;lock_timeout=5s'], fn);
      assert.equal(await one(`select proacl::text||'|'||prosecdef::text||'|'||provolatile::text from pg_proc where oid='${fn}'::regprocedure`),
        '{postgres=X/postgres,service_role=X/postgres}|true|v', fn);
    }
    assert.equal(await one(ROUTINE_DIGEST), routinesBefore, 'every pre-existing routine (incl. every reused resolver) is byte-identical');
    assert.equal(await one(TABLE_DIGEST), tablesBefore, 'no relation / column / constraint / index / trigger / policy / ACL changed');
    assert.equal(await one(ROWS_DIGEST), rowsBefore, 'no L14 or canonical_relationships row changed');
    assert.equal(await one(DEFAULT_ACL), defaultAclBefore, 'no default privilege changed');
    // Actual denied operations with the intended roles.
    for (const role of ['anon', 'authenticated'] as const) {
      await assert.rejects(c.sql(`select * from gov_repo.l14_read_fact_conflict_v1(null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null)`, role),
        /permission denied for (function|schema)/);
      await assert.rejects(c.sql(`select * from gov_repo.l14_read_passport_governance_v1(null,null,null,null,null,null,null,null,null)`, role),
        /permission denied for (function|schema)/);
    }
    for (const table of L14_ALL_TABLES) await assert.rejects(c.svc(`select 1 from gov_repo.${table} limit 1`), /permission denied for table/, table);
    // service_role reaches the projection; an unverified principal is refused before any read.
    await assert.rejects(c.svc(`select * from gov_repo.l14_read_passport_governance_v1(gen_random_uuid(), gen_random_uuid(), 1, 2, now(), 'x', null, null, null)`),
      /GV00[13]/);
    // Clean postflight re-run (the negative controls below must each break exactly this).
    await bootstrapSql(`begin; ${postflight()} rollback;`);
  });

  await t.test('postflight negative controls: each privilege / structure class is detected (rolled back)', async () => {
    const trg = `create function public.rp_trg() returns trigger language plpgsql set search_path = pg_catalog as 'begin return new; end'`;
    const controls: readonly (readonly [string, string, RegExp])[] = [
      // Routine EXECUTE class.
      ['PUBLIC EXECUTE on a projection', `grant execute on function ${PASSPORT} to public`, /has PUBLIC EXECUTE|EXECUTE is not exactly/],
      ['anon EXECUTE on a projection', `grant execute on function ${CONFLICT} to anon`, /executable by anon|EXECUTE is not exactly/],
      ['authenticated EXECUTE on a projection', `grant execute on function ${PASSPORT} to authenticated`, /executable by authenticated|EXECUTE is not exactly/],
      ['service_role EXECUTE on a reused resolver', `grant execute on function ${RESOLVER} to service_role`, /internal helper .* must be owner-only/],
      ['default privileges reintroduce EXECUTE', 'alter default privileges for role postgres in schema gov_repo grant execute on functions to service_role',
        /default privileges grant PUBLIC \/ application EXECUTE/],
      ['an extra application definer', `create function public.rp_probe() returns integer language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        grant execute on function public.rp_probe() to service_role`, /CLOSED_SURFACE unapproved|surface is not exactly 45/],
      ['an overload of a projection', `create function gov_repo.l14_read_fact_conflict_v1(uuid) returns integer language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        revoke all on function gov_repo.l14_read_fact_conflict_v1(uuid) from public; grant execute on function gov_repo.l14_read_fact_conflict_v1(uuid) to service_role`,
        /RPC surface must be exactly|overload of approved routine|surface is not exactly 45/],
      // Definer shape / owner / config / body.
      ['SECURITY INVOKER flip', `alter function ${PASSPORT} security invoker`, /shape \/ owner \/ config drifted/],
      ['owner drift', `alter function ${CONFLICT} owner to govia_legacy_read_executor`, /shape \/ owner \/ config drifted/],
      ['search_path drift', `alter function ${PASSPORT} set search_path = public, pg_catalog, pg_temp`, /shape \/ owner \/ config drifted|search_path not pinned/],
      ['volatility drift', `alter function ${CONFLICT} stable`, /shape \/ owner \/ config drifted/],
      ['a projection write', rewrite(PASSPORT, 'RETURN QUERY', 'INSERT INTO gov_repo.l14_support_links SELECT * FROM gov_repo.l14_support_links WHERE false; RETURN QUERY'),
        /writes, locks, reads a head \/ legacy/],
      ['a legacy owner / business_domain read', rewrite(PASSPORT, 'RETURN QUERY', 'PERFORM 1 FROM gov_repo.agents AS lg WHERE lg.business_domain IS NOT NULL; RETURN QUERY'),
        /writes, locks, reads a head \/ legacy/],
      ['a cg_* flag read', rewrite(CONFLICT, 'RETURN QUERY', 'PERFORM 1 FROM pg_catalog.pg_class AS cg_ag_002_owner WHERE false; RETURN QUERY'),
        /writes, locks, reads a head \/ legacy/],
      ['a head read as truth', rewrite(CONFLICT, 'RETURN QUERY', 'PERFORM 1 FROM gov_repo.l14_business_context_assignment_heads LIMIT 1; RETURN QUERY'),
        /writes, locks, reads a head \/ legacy/],
      ['a confidence / recency ranking', rewrite(CONFLICT, 'ORDER BY x.c_ord, x.c_proposal', 'ORDER BY x.c_ord, x.c_submitted DESC /* confidence */'),
        /writes, locks, reads a head \/ legacy|body hash changed/],
      ['a reused resolver bypassed', rewrite(PASSPORT, 'gov_repo.l14_control_assessments_current_v1(', 'gov_repo.l14_control_applicabilities_current_v1('),
        /bypasses a reused resolver/],
      ['a body hash drift', rewrite(CONFLICT, "'INSUFFICIENT_EVIDENCE' END AS v", "'INSUFFICIENT_EVIDENCE' END AS v "), /body hash changed/],
      // Table / column privilege classes on authoritative history (service_role must never read L14 directly).
      ['service_role SELECT on fact history', 'grant select on gov_repo.l14_fact_states to service_role', /holds SELECT on l14_fact_states|non-owner table grant/],
      ['service_role column SELECT', 'grant select (fact_state_id) on gov_repo.l14_responsibility_assignment_states to service_role', /column-level grants|column privilege/],
      ['service_role INSERT', 'grant insert on gov_repo.l14_proposals to service_role', /non-owner table grant|holds INSERT/],
      ['TRUNCATE', 'grant truncate on gov_repo.l14_control_assessment_states to service_role', /non-owner table grant|holds TRUNCATE/],
      ['REFERENCES', 'grant references on gov_repo.l14_governance_decisions to authenticated', /non-owner table grant|holds REFERENCES/],
      ['TRIGGER', 'grant trigger on gov_repo.l14_support_links to anon', /non-owner table grant|holds TRIGGER/],
      ['MAINTAIN', 'grant maintain on gov_repo.l14_authorization_decisions to service_role', /non-owner table grant|holds MAINTAIN/],
      ['an RLS policy', 'create policy rp_leak on gov_repo.l14_fact_states for select using (true)', /carries an RLS policy/],
      ['RLS disabled', 'alter table gov_repo.l14_control_assessment_states disable row level security', /RLS-enabled ordinary table/],
      // View / sequence / inheritance exposure.
      ['a readable view over history', 'create view public.rp_leak as select fact_state_id from gov_repo.l14_fact_states; grant select on public.rp_leak to service_role',
        /holds SELECT on view rp_leak/],
      ['a writable view over history', 'create view public.rp_leak_w as select * from gov_repo.l14_proposals; grant insert, update on public.rp_leak_w to authenticated',
        /holds (INSERT|UPDATE) on view rp_leak_w/],
      ['a PUBLIC view over history', 'create view public.rp_leak_p as select * from gov_repo.l14_support_links; grant select on public.rp_leak_p to public',
        /has a PUBLIC grant/],
      ['a sequence leak', `set role postgres; create sequence gov_repo.rp_probe_seq owned by gov_repo.l14_fact_states.fact_state_id; reset role;
        grant usage on sequence gov_repo.rp_probe_seq to service_role`, /holds a privilege on sequence rp_probe_seq/],
      ['inheritance from history', 'create table public.rp_child () inherits (gov_repo.l14_fact_states)', /inheritance involves L14 history/],
      // Second truth store / vocabularies / F2.
      ['a second store (new l14 relation)', 'create table gov_repo.l14_conflict_states (x integer)', /unexpected l14 relation set/],
      ['a sixth fact family', `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_subject_kind_check,
        add constraint l14_fact_states_subject_kind_check check (subject_kind in ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
        'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT','CONTROL_FINDING')) not valid`, /fact families \(5\) changed/],
      ['F2: a trigger on canonical_relationships', `${trg}; create trigger rp_t before insert on gov_repo.canonical_relationships for each row execute function public.rp_trg()`,
        /F2 boundary violated/],
    ];
    for (const [name, brk, message] of controls) {
      await assert.rejects(bootstrapSql(`begin; ${brk}; ${postflight()} rollback;`), (error: Error) => {
        assert.match(error.message, /M16_RP_POSTFLIGHT/, `${name}: ${error.message}`);
        assert.match(error.message, message, `${name}: ${error.message}`);
        return true;
      }, name);
    }
    // Every control rolled back: the clean postflight still passes and nothing changed.
    await bootstrapSql(`begin; ${postflight()} rollback;`);
    assert.equal(await one(ROUTINE_DIGEST), routinesBefore);
    assert.equal(await one(TABLE_DIGEST), tablesBefore);
    assert.equal(await one(ROWS_DIGEST), rowsBefore);
  });
});
