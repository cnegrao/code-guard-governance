import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  l14GovernancePartyMigration, l14GovernancePartyPendingCancelMigration, l14PolicyStoreHardeningMigration,
} from '../helpers/disposable-m16-postgres';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { L14_S1B1_TABLES, partyKit } from '../helpers/m16-l14-party-fixtures';

const PUBLIC_RPCS = [
  'l14_admit_authority_policy_version_v1', 'l14_admit_governance_party_v1', 'l14_decide_authority_policy_proposal_v1',
  'l14_decide_governance_party_proposal_v1', 'l14_submit_governance_party_proposal_v1', 'l14_submit_proposal_v1',
];
const TABLES = ['governance_policies', 'policy_versions'] as const;
const APP_ROLES = ['anon', 'authenticated', 'service_role'] as const;
const GUARDS = ['policy_store_history_immutable_v1()', 'policy_store_policy_identity_guard_v1()', 'policy_store_version_content_hash_guard_v1()'];

const postflightOf = (name: string, tag: string) => {
  const text = readFileSync(fileURLToPath(new URL(`../../../../supabase/migrations/${name}`, import.meta.url)), 'utf8');
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.startsWith('DO $postflight$') && block.includes(tag), `${tag} extracted`);
  return block;
};

/**
 * Independent real-catalog checker for the reused policy stores (does not reuse the migration's SQL):
 * both tables, every view (any schema, transitively) and every definer routine reaching them, owned /
 * defaulted sequences, inheritance and RLS policies.
 */
const CHECKER_SQL = `
with recursive privs as (select unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) as p),
roles as (select unnest(array['anon','authenticated','service_role']) as r),
base as (select oid, relname::text as name from pg_class where oid in ('gov_repo.governance_policies'::regclass,'gov_repo.policy_versions'::regclass)),
reach(oid) as (
  select w.ev_class from pg_rewrite w join pg_depend d on d.classid='pg_rewrite'::regclass and d.objid=w.oid
  where d.refobjid in (select oid from base) and w.ev_class not in (select oid from base)
  union select w.ev_class from reach join pg_depend d on d.refobjid=reach.oid and d.classid='pg_rewrite'::regclass
  join pg_rewrite w on w.oid=d.objid where w.ev_class<>reach.oid),
rels as (select oid, name, 'table' as k from base union select c.oid, c.relname::text, 'view' from reach join pg_class c on c.oid=reach.oid),
seqs as (select distinct s.oid, s.relname::text as name from pg_class s join pg_depend d on d.objid=s.oid and d.classid='pg_class'::regclass
  where s.relkind='S' and d.refobjid in (select oid from base)
  union select distinct s.oid, s.relname::text from pg_attrdef ad join pg_depend d on d.classid='pg_attrdef'::regclass and d.objid=ad.oid
  join pg_class s on s.oid=d.refobjid and s.relkind='S' where ad.adrelid in (select oid from base)),
fns as (select p.oid, p.proname::text as name, p.proowner, p.proacl from pg_proc p
  where p.prosecdef and p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
    and (p.prosrc ~ '(^|[^A-Za-z0-9_$])(governance_policies|policy_versions)([^A-Za-z0-9_$]|$)'
      or exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.refobjid in (select oid from base)))),
v(line) as (
  select k||'-priv:'||r||':'||p||':'||name from rels, roles, privs where has_table_privilege(r, oid, p)
  union all select k||'-column-priv:'||r||':'||name from rels, roles where has_any_column_privilege(r, oid, 'SELECT, INSERT, UPDATE, REFERENCES')
  union all select 'non-owner-grant:'||b.name from base b join pg_class c on c.oid=b.oid, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee<>c.relowner
  union all select 'column-acl:'||b.name from base b where exists (select 1 from pg_attribute where attrelid=b.oid and attacl is not null)
  union all select 'sequence-priv:'||r||':'||sp||':'||name from seqs, roles, unnest(array['USAGE','SELECT','UPDATE']) sp where has_sequence_privilege(r, oid, sp)
  union all select 'routine-execute:'||r||':'||name from fns, roles where has_function_privilege(r, oid, 'EXECUTE')
  union all select 'routine-public:'||name from fns, aclexplode(coalesce(proacl, acldefault('f', proowner))) a where a.grantee=0
  union all select 'rls-policy:'||polname from pg_policy where polrelid in (select oid from base)
  union all select 'rls-disabled:'||b.name from base b join pg_class c on c.oid=b.oid where not c.relrowsecurity
  union all select 'inheritance:'||inhrelid::regclass::text from pg_inherits where inhrelid in (select oid from base) or inhparent in (select oid from base)
  union all select 'guard-not-always:'||t.tgname from pg_trigger t where t.tgrelid in (select oid from base) and not t.tgisinternal
    and t.tgname <> 'trg_governance_policies_updated_at' and t.tgenabled <> 'A'
  union all select 'cascade-fk:'||conname from pg_constraint where contype='f'
    and (conrelid='gov_repo.policy_versions'::regclass or confrelid='gov_repo.policy_versions'::regclass) and (confdeltype not in ('a','r') or confupdtype not in ('a','r'))
)
select coalesce(string_agg(line, E'\\n' order by line), '') from v;`;

test('M16 S1B.2 policy-store ACL / postflight / surface (disposable PG17, S1B2 horizon)', { timeout: 900_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B2' });
  t.after(() => c.stop());
  const { owner, bootstrapSql, sql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const violations = async () => (await bootstrapSql(CHECKER_SQL)).split('\n').map(line => line.trim()).filter(Boolean);
  const postflight = postflightOf(l14PolicyStoreHardeningMigration, 'M16_S1B2_POSTFLIGHT');
  // Production-faithful schema usage (003944) so denials are table-level, not schema-level.
  await owner(`grant usage on schema gov_repo to anon, authenticated`);
  // Real S1B.1 Party history on the S1B2 horizon (regression: the Party lifecycle still works end to end).
  const k = await partyKit(c);
  const ctx = await k.setup();
  const party = await k.validated(ctx, 's1b2');

  await t.test('postflight: zero violations with the hostile 013113 defaults in the chain; S1B.2, S1B.1 and S1B.1R1 postflights re-execute cleanly', async () => {
    assert.equal(await one(`select count(*) from pg_default_acl d where d.defaclnamespace='gov_repo'::regnamespace`), '3',
      'the hostile 20260818013113 default privileges are present');
    assert.deepEqual(await violations(), []);
    await owner(postflight);
    await owner(postflight);
    await owner(postflightOf(l14GovernancePartyMigration, 'M16_S1B1_POSTFLIGHT'));
    await owner(postflightOf(l14GovernancePartyPendingCancelMigration, 'M16_S1B1R1_POSTFLIGHT'));
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_parties where governance_party_id='${party.partyId}'`), '1');
  });

  await t.test('D-13: every application role is denied every operation on both tables, INCLUDING service_role SELECT', async () => {
    for (const table of TABLES) {
      for (const role of APP_ROLES) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
          assert.equal(await one(`select has_table_privilege('${role}','gov_repo.${table}','${privilege}')`), 'f', `${role} ${privilege} ${table}`);
        }
        assert.equal(await one(`select has_table_privilege('public','gov_repo.${table}','SELECT')`), 'f');
        for (const statement of [`select 1 from gov_repo.${table} limit 1`, `select organisation_id from gov_repo.${table} limit 1`,
          `insert into gov_repo.${table} default values`, `update gov_repo.${table} set organisation_id=organisation_id`,
          `delete from gov_repo.${table}`, `truncate gov_repo.${table}`]) {
          await assert.rejects(sql(statement, role), (error: Error) => { assert.match(error.message, /42501/, `${role}: ${statement}`); return true; });
        }
      }
    }
    for (const guard of GUARDS) {
      assert.equal(await one(`select prosecdef::text||':'||prorettype::regtype::text||':'||array_to_string(proconfig,';')
        from pg_proc where oid='gov_repo.${guard}'::regprocedure`), 'false:trigger:search_path=pg_catalog, pg_temp', guard);
      assert.equal(await one(`select coalesce(string_agg(a.grantee::regrole::text||'='||a.privilege_type, ','), '')
        from pg_proc p, aclexplode(p.proacl) a where p.oid='gov_repo.${guard}'::regprocedure`), 'postgres=EXECUTE', `${guard} owner-only`);
    }
    assert.equal(await one(`select count(*) from pg_policy where polrelid in ('gov_repo.governance_policies'::regclass,'gov_repo.policy_versions'::regclass)`),
      '0', 'legacy USING(true) / org-scoped policies dropped; no replacement policy invented');
  });

  await t.test('surface: no new public L14 RPC (exactly six service_role RPCs), l14 relation set unchanged, no Policy lifecycle object', async () => {
    assert.equal(await one(`select string_agg(proname::text, ',' order by proname::text) from pg_proc
      where pronamespace='gov_repo'::regnamespace and proname like 'l14\\_%' and has_function_privilege('service_role', oid, 'EXECUTE')`), PUBLIC_RPCS.join(','));
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l14\\_%' and prosecdef`), '6');
    assert.equal(await one(`select string_agg(relname::text, ',' order by relname::text collate "C") from pg_class
      where relnamespace='gov_repo'::regnamespace and relname like 'l14\\_%' and relkind in ('r','p','v','m','S','f')`), [...L14_S1B1_TABLES].sort().join(','));
    assert.equal(await one(`select count(*) from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname not like 'policy\\_store\\_%'
      and p.prosrc ~ '(^|[^A-Za-z0-9_$])(governance_policies|policy_versions)([^A-Za-z0-9_$]|$)'
      and (p.prosecdef or has_function_privilege('service_role', p.oid, 'EXECUTE')) and p.prorettype <> 'trigger'::regtype`), '0',
      'no application-callable routine reaches a policy store');
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like '%\\_governed\\_v1'`), '6');
    assert.equal(await one(`select count(*) from pg_constraint where confrelid='gov_repo.canonical_relationships'::regclass
      and conrelid in ('gov_repo.governance_policies'::regclass,'gov_repo.policy_versions'::regclass)`), '0', 'F2 untouched');
  });

  interface Control { key: string; apply: string; expect: RegExp; cleanup: string; as?: 'bootstrap' }
  const controls: Control[] = [
    { key: 'table direct DML (INSERT)', apply: `grant insert on gov_repo.policy_versions to service_role`,
      expect: /^table-priv:service_role:INSERT:policy_versions$/m, cleanup: `revoke insert on gov_repo.policy_versions from service_role` },
    { key: 'service_role SELECT restored', apply: `grant select on gov_repo.governance_policies to service_role`,
      expect: /^table-priv:service_role:SELECT:governance_policies$/m, cleanup: `revoke select on gov_repo.governance_policies from service_role` },
    { key: 'PUBLIC grant', apply: `grant select on gov_repo.policy_versions to public`,
      expect: /^table-priv:anon:SELECT:policy_versions$/m, cleanup: `revoke select on gov_repo.policy_versions from public` },
    { key: 'TRUNCATE / REFERENCES / TRIGGER / MAINTAIN', apply: `grant truncate, references, trigger, maintain on gov_repo.policy_versions to authenticated`,
      expect: /(?=[\s\S]*^table-priv:authenticated:TRUNCATE:policy_versions$)(?=[\s\S]*^table-priv:authenticated:REFERENCES:policy_versions$)(?=[\s\S]*^table-priv:authenticated:TRIGGER:policy_versions$)(?=[\s\S]*^table-priv:authenticated:MAINTAIN:policy_versions$)/m,
      cleanup: `revoke truncate, references, trigger, maintain on gov_repo.policy_versions from authenticated` },
    { key: 'column-level privilege', apply: `grant select (content_markdown) on gov_repo.policy_versions to anon`,
      expect: /(?=[\s\S]*^table-column-priv:anon:policy_versions$)(?=[\s\S]*^column-acl:policy_versions$)/m,
      cleanup: `revoke select (content_markdown) on gov_repo.policy_versions from anon` },
    { key: 'sequence privileges (default-privilege reintroduction via an owned sequence)',
      apply: `create sequence gov_repo.negctl_pv_seq owned by gov_repo.policy_versions.version_number`,
      expect: /^sequence-priv:service_role:USAGE:negctl_pv_seq$/m, cleanup: `drop sequence gov_repo.negctl_pv_seq` },
    { key: 'routine EXECUTE (default-privilege reintroduction via a definer reader)',
      apply: `create function gov_repo.negctl_policy_reader() returns bigint language sql security definer
        set search_path = pg_catalog, pg_temp as 'select count(*) from gov_repo.policy_versions'`,
      expect: /(?=[\s\S]*^routine-execute:service_role:negctl_policy_reader$)(?=[\s\S]*^routine-public:negctl_policy_reader$)/m,
      cleanup: `drop function gov_repo.negctl_policy_reader()` },
    { key: 'writable view (default-privilege reintroduction)', apply: `create view gov_repo.negctl_policy_view as select * from gov_repo.governance_policies`,
      expect: /(?=[\s\S]*^view-priv:service_role:UPDATE:negctl_policy_view$)(?=[\s\S]*^view-priv:service_role:SELECT:negctl_policy_view$)/m,
      cleanup: `drop view gov_repo.negctl_policy_view` },
    { key: 'security_invoker view in another schema granted to authenticated', apply: `create view public.negctl_pv_bridge with (security_invoker=true) as
        select * from gov_repo.policy_versions; grant select, update on public.negctl_pv_bridge to authenticated`,
      expect: /^view-priv:authenticated:UPDATE:negctl_pv_bridge$/m, cleanup: `drop view public.negctl_pv_bridge` },
    { key: 'view over a view (transitive)', apply: `create view gov_repo.negctl_inner as select policy_id from gov_repo.governance_policies;
        revoke all on gov_repo.negctl_inner from service_role; create view public.negctl_outer as select * from gov_repo.negctl_inner;
        grant select on public.negctl_outer to anon`,
      expect: /^view-priv:anon:SELECT:negctl_outer$/m, cleanup: `drop view public.negctl_outer; drop view gov_repo.negctl_inner` },
    { key: 'inherited role grant', as: 'bootstrap', apply: `create role negctl_group nologin; set role postgres;
        grant select on gov_repo.policy_versions to negctl_group; reset role; grant negctl_group to authenticated`,
      expect: /(?=[\s\S]*^table-priv:authenticated:SELECT:policy_versions$)(?=[\s\S]*^non-owner-grant:policy_versions$)/m,
      cleanup: `revoke negctl_group from authenticated; set role postgres; revoke select on gov_repo.policy_versions from negctl_group; reset role; drop role negctl_group` },
    { key: 'inheritance child table', apply: `create table gov_repo.negctl_pv_child () inherits (gov_repo.policy_versions)`,
      expect: /^inheritance:gov_repo\.negctl_pv_child$/m, cleanup: `drop table gov_repo.negctl_pv_child` },
    { key: 'broad RLS policy reintroduced', apply: `create policy negctl_all on gov_repo.policy_versions for all to service_role using (true) with check (true)`,
      expect: /^rls-policy:negctl_all$/m, cleanup: `drop policy negctl_all on gov_repo.policy_versions` },
  ];
  for (const control of controls) {
    await t.test(`negative control detected by the checker AND the S1B.2 postflight: ${control.key}`, async () => {
      const run = control.as === 'bootstrap' ? bootstrapSql : owner;
      await run(control.apply);
      try {
        const found = (await violations()).join('\n');
        assert.match(found, control.expect, `checker missed ${control.key}:\n${found}`);
        await assert.rejects(owner(postflight), /M16_S1B2_POSTFLIGHT/, 'the S1B.2 migration postflight fails closed');
      } finally {
        await run(control.cleanup);
      }
      assert.deepEqual(await violations(), [], 'clean again after the control is removed');
    });
  }

  await t.test('postflight also fails closed on disabled/extra/missing guards, a cascade FK, a JSON column, a changed owner constraint or an l14 policy object', async () => {
    const trg = (table: string, name: string) => [`alter table gov_repo.${table} disable trigger ${name}`, `alter table gov_repo.${table} enable always trigger ${name}`];
    for (const [apply, cleanup] of [
      trg('policy_versions', 'policy_versions_content_hash_guard'),
      trg('policy_versions', 'policy_versions_immutable'),
      trg('policy_versions', 'policy_versions_no_truncate'),
      trg('governance_policies', 'governance_policies_identity_guard'),
      trg('governance_policies', 'governance_policies_no_delete'),
      trg('governance_policies', 'governance_policies_no_truncate'),
      ['alter table gov_repo.policy_versions enable trigger policy_versions_immutable', 'alter table gov_repo.policy_versions enable always trigger policy_versions_immutable'],
      [`create trigger negctl_rewrite before insert on gov_repo.policy_versions for each row execute function gov_repo.set_updated_at()`,
        'drop trigger negctl_rewrite on gov_repo.policy_versions'],
      ['alter table gov_repo.policy_versions drop constraint policy_versions_content_hash_sha256_utf8_check',
        `alter table gov_repo.policy_versions add constraint policy_versions_content_hash_sha256_utf8_check
          check (content_hash::text = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(content_markdown, 'UTF8')), 'hex')) not valid`],
      ['alter table gov_repo.policy_versions drop constraint policy_versions_organisation_policy_version_hash_unique',
        'alter table gov_repo.policy_versions add constraint policy_versions_organisation_policy_version_hash_unique unique (organisation_id, policy_id, version_id, content_hash)'],
      [`alter table gov_repo.policy_versions drop constraint policy_versions_organisation_policy_fkey, add constraint policy_versions_organisation_policy_fkey
          foreign key (organisation_id, policy_id) references gov_repo.governance_policies (organisation_id, policy_id) on update restrict on delete cascade`,
        `alter table gov_repo.policy_versions drop constraint policy_versions_organisation_policy_fkey, add constraint policy_versions_organisation_policy_fkey
          foreign key (organisation_id, policy_id) references gov_repo.governance_policies (organisation_id, policy_id) on update restrict on delete restrict`],
      ['alter table gov_repo.policy_versions alter column organisation_id drop not null', 'alter table gov_repo.policy_versions alter column organisation_id set not null'],
      ['alter table gov_repo.governance_policies add column negctl_payload jsonb', 'alter table gov_repo.governance_policies drop column negctl_payload'],
      ['alter table gov_repo.governance_policies alter column owner_user_id drop not null', 'alter table gov_repo.governance_policies alter column owner_user_id set not null'],
      ['alter table gov_repo.policy_versions disable row level security', 'alter table gov_repo.policy_versions enable row level security'],
      ['create table gov_repo.l14_policy_version_states (x int)', 'drop table gov_repo.l14_policy_version_states'],
      [`create function gov_repo.policy_store_negctl_v1() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as 'begin return new; end'`,
        'drop function gov_repo.policy_store_negctl_v1()'],
    ]) {
      await owner(apply!);
      try { await assert.rejects(owner(postflight), /M16_S1B2_POSTFLIGHT/, apply); } finally { await owner(cleanup!); }
    }
    await owner(postflight);
    assert.deepEqual(await violations(), []);
  });
});
