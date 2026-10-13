import assert from 'node:assert/strict';
import { test } from 'node:test';
import { m17S1R1MachineLoginClosureMigration, m17S1SignalsHypothesesMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { l15SecurityViolationsSql, type DefinerInventoryEntry } from '../helpers/m17-l15-security-profile';

/**
 * M17-S1 — L15 privilege / ACL / definer-capability surface on real disposable PostgreSQL 17 (ADR §24; O59-O62 profile,
 * O14, O73, O74, O76 re-proven on the post-S1 catalog). The cluster is built to the exact post-S0 catalog, the ACL surface is
 * measured, the S1 migration is applied, and the surface is measured again.
 */
const CFG = 'search_path=pg_catalog, pg_temp;lock_timeout=5s';
/** The seven L15 SECURITY DEFINER routines (owner, body SHA-256, config). Any change requires re-review of this inventory. */
export const L15_S1_DEFINER_INVENTORY: readonly DefinerInventoryEntry[] = [
  { sig: 'gov_repo.l15_admit_human_hypothesis_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,numeric,uuid[])', owner: 'postgres', sha: '9b44f7d25a87151776f51756c34bf54c654c6445c7b4c3b8e7cf642b10dfee46', cfg: CFG },
  { sig: 'gov_repo.l15_admit_human_signal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,timestamp with time zone,text[],text[])', owner: 'postgres', sha: '5d9906f8e699f915dc925f7b185103075942d98eccdcd2fec0e48e1e55e4cf60', cfg: CFG },
  { sig: 'gov_repo.l15_admit_machine_hypothesis_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,uuid[])', owner: 'postgres', sha: '75934cfdbcd0684c7c20751e0e599c51a32757a5e8079be2827da94ac5401675', cfg: CFG },
  { sig: 'gov_repo.l15_admit_machine_signal_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,timestamp with time zone,text,text,text,uuid,text[],text[])', owner: 'postgres', sha: '1122d2f1a6f1925c5ccd8dc8e62907af12c7e6b60f39bdbbb974c627ee5f6d98', cfg: CFG },
  { sig: 'gov_repo.l15_read_hypothesis_dispositions_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text)', owner: 'postgres', sha: '759086fea06b757f854963ffd9fa507606aeb3c4ead241f02d194e44adc3b487', cfg: CFG },
  { sig: 'gov_repo.l15_read_signals_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text)', owner: 'postgres', sha: '2e7809bbbf935582b9e95cfcd7deb7665ddf61f7c3866d7cce23e1b5e9ac0fd4', cfg: CFG },
  { sig: 'gov_repo.l15_support_completeness_guard_v1()', owner: 'postgres', sha: '93411b42b31461bc4e407cf2c275168068dfc5ff4463050c4b6458c5f6b4822d', cfg: 'search_path=pg_catalog, pg_temp' },
];
/** The four member RPCs service_role may EXECUTE (verified principal re-derived in-RPC). */
const SERVICE_ROLE_RPCS = L15_S1_DEFINER_INVENTORY.map(e => e.sig).filter(s => /l15_(admit_human|read_)/.test(s));
const MACHINE_RPCS = ['l15_admit_machine_hypothesis_v1', 'l15_admit_machine_signal_v1'];

test('M17-S1 L15 security / ACL / definer surface (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S1', stopBefore: m17S1SignalsHypothesesMigration });
  t.after(() => c.stop());
  const { owner, rejects, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const surface = async () => JSON.parse(await one(`select json_build_object(
    'application_definers', (select count(*) from pg_proc p where p.prosecdef and p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
      and not exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
      and (has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),
    'service_role_l15_rpcs', (select count(*) from pg_proc p where p.proname like 'l15\\_%' and has_function_privilege('service_role',p.oid,'EXECUTE')),
    'technical_intake_rpcs', (select count(*) from pg_proc p where p.proname like 'l15\\_%' and exists (select 1 from pg_roles r where r.rolname='govia_l15_machine_intake_caller')
      and has_function_privilege('govia_l15_machine_intake_caller',p.oid,'EXECUTE')),
    'l15_definers', (select count(*) from pg_proc where proname like 'l15\\_%' and prosecdef),
    'l15_routines', (select count(*) from pg_proc where proname like 'l15\\_%'),
    'l15_tables', (select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname like 'l15\\_%' and relkind='r'),
    'service_role_l15_table_privileges', (select count(*) from pg_class c cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr
      where c.relnamespace='gov_repo'::regnamespace and c.relname like 'l15\\_%' and c.relkind='r' and has_table_privilege('service_role',c.oid,pr)))`));

  const before = await surface();
  t.diagnostic(`ACL surface before S1: ${JSON.stringify(before)}`);
  assert.deepEqual(before, { application_definers: 45, service_role_l15_rpcs: 0, technical_intake_rpcs: 0, l15_definers: 0, l15_routines: 4,
    l15_tables: 0, service_role_l15_table_privileges: 0 });
  await c.migrate(m17S1SignalsHypothesesMigration);
  await c.migrate(m17S1R1MachineLoginClosureMigration);
  const after = await surface();
  t.diagnostic(`ACL surface after S1: ${JSON.stringify(after)}`);
  assert.deepEqual(after, { application_definers: 49, service_role_l15_rpcs: 4, technical_intake_rpcs: 2, l15_definers: 7, l15_routines: 25,
    l15_tables: 3, service_role_l15_table_privileges: 0 });

  await t.test('the migration is additive and refuses to re-run (preflight) without changing anything', async () => {
    await rejects(owner(migrationSource(m17S1SignalsHypothesesMigration)), '55000', /M17_S1_PREFLIGHT/);
    await rejects(owner(migrationSource(m17S1R1MachineLoginClosureMigration)), '55000', /M17_S1R1_PREFLIGHT/);
    assert.deepEqual(await surface(), after);
  });

  await t.test('O59-O62 L15 profile: clean with the exact seven-definer inventory and the four service_role RPCs', async () => {
    assert.deepEqual(JSON.parse(lastLine(await owner(l15SecurityViolationsSql(L15_S1_DEFINER_INVENTORY, SERVICE_ROLE_RPCS)))), []);
    // Without the inventory every definer is flagged; an unapproved application EXECUTE is flagged.
    const bare = JSON.parse(lastLine(await owner(l15SecurityViolationsSql()))) as string[];
    assert.equal(bare.filter(v => v.startsWith('DEFINER_NOT_INVENTORIED')).length, 7);
    assert.equal(bare.filter(v => v.startsWith('ROUTINE_EXECUTE service_role')).length, 4);
    const probe = async (ddl: string) => JSON.parse(lastLine(await owner(`begin; ${ddl}; ${l15SecurityViolationsSql(L15_S1_DEFINER_INVENTORY, SERVICE_ROLE_RPCS)} rollback;`))) as string[];
    assert.ok((await probe(`grant select on gov_repo.l15_risk_signals to service_role`)).includes('TABLE_PRIVILEGE service_role SELECT l15_risk_signals'));
    assert.ok((await probe(`grant insert on gov_repo.l15_support_links to authenticated`)).includes('TABLE_PRIVILEGE authenticated INSERT l15_support_links'));
    assert.ok((await probe(`grant execute on function gov_repo.l15_frame_hash_v1(text[]) to anon`)).includes('ROUTINE_EXECUTE anon gov_repo.l15_frame_hash_v1(text[])'));
    assert.ok((await probe(`alter function gov_repo.l15_read_signals_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text) set search_path = public`))
      .some(v => v.startsWith('ROUTINE_SEARCH_PATH gov_repo.l15_read_signals_v1')));
    assert.ok((await probe(`alter table gov_repo.l15_support_links disable trigger l15_support_links_immutable`)).includes('NO_IMMUTABILITY l15_support_links'));
  });

  await t.test('O14: the capability role reaches exactly the two machine intake RPCs; no L14 / L15 governance path; NOLOGIN', async () => {
    assert.deepEqual(JSON.parse(await one(`select json_agg(p.proname order by p.proname) from pg_proc p
      where p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
        and (p.prosecdef or p.pronamespace='gov_repo'::regnamespace) and has_function_privilege('govia_l15_machine_intake_caller',p.oid,'EXECUTE')`)), MACHINE_RPCS);
    assert.equal(await one(`select rolcanlogin::text||rolinherit::text||rolsuper::text||rolbypassrls::text from pg_roles where rolname='govia_l15_machine_intake_caller'`),
      'falsefalsefalsefalse');
    assert.equal(await one(`select count(*) from pg_class c where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','v','m','p')
      and has_table_privilege('govia_l15_machine_intake_caller',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')`), '0');
    // No L15 propose / decide / admit-registry / bootstrap routine exists in S1 at all (S2+), and service_role holds none.
    assert.equal(await one(`select count(*) from pg_proc where proname like 'l15\\_%' and proname ~ '(propose|decide|submit|validate|bootstrap|admit_risk)'`), '0');
    // The machine RPCs are not service_role's: the M16 human executor cannot impersonate a detector.
    for (const name of MACHINE_RPCS) {
      assert.equal(await one(`select bool_or(has_function_privilege('service_role',oid,'EXECUTE'))::text from pg_proc where proname='${name}'`), 'false');
    }
    await bootstrapSql(`create role l15_sec_login login inherit; grant govia_l15_machine_intake_caller to l15_sec_login;`);
    await rejects(c.sql(`select gov_repo.l14_decide_control_assessment_proposal_v1(null,null,null,null,null,null,null,null,null,null,null,null,null)`, 'l15_sec_login' as never),
      '42501', /permission denied/);
    await bootstrapSql(`drop role l15_sec_login;`);
  });

  await t.test('O73 / O74 / O76 re-proven on the post-S1 catalog; M16 untouched', async () => {
    const vocab = async (rel: string, con: string) => JSON.parse(await one(`select json_agg(m[1] order by m[1]) from pg_constraint k,
      regexp_matches(pg_get_constraintdef(k.oid), '''([A-Z0-9_]+)''', 'g') m where k.conrelid='gov_repo.${rel}'::regclass and k.conname='${con}'`)) as string[];
    assert.equal((await vocab('l14_authority_policy_rules', 'l14_authority_policy_rules_permission_check')).length, 23);
    assert.equal((await vocab('l14_authorization_decision_rules', 'l14_authorization_decision_rules_permission_check')).length, 23);
    assert.equal((await vocab('l14_fact_states', 'l14_fact_states_subject_kind_check')).length, 5);
    assert.equal(await one(`select count(*) from pg_constraint where conrelid in (select oid from pg_class where relname like 'l14\\_%')
      and pg_get_constraintdef(oid) ~ 'RISK_(SIGNAL|HYPOTHESIS)'`), '0');
    // l14_support_links is not reused or widened; no constraint references an l15 table from an l14 table.
    assert.equal(await one(`select count(*) from pg_constraint where conrelid in (select oid from pg_class where relname like 'l14\\_%')
      and confrelid in (select oid from pg_class where relname like 'l15\\_%')`), '0');
    assert.equal(await one(`select count(*) from information_schema.columns where table_schema='gov_repo' and table_name='l14_support_links'
      and column_name ~ 'risk|signal|hypothesis|l15'`), '0');
  });
});
