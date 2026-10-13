import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lastLine, l14Cluster } from '../helpers/m16-l14-fixtures';
import { MACHINE, m17s1Kit, machineHypothesisSql, machineSignalSql, objectSubject, type SignalOps } from '../helpers/m17-s1-fixtures';

/**
 * M17-S1R1 — closed privilege surface of the ACTUAL machine intake LOGIN (ACP delta review, F-S1-4 hardening) on real
 * disposable PostgreSQL 17. Each negative case is a real LOGIN that holds govia_l15_machine_intake_caller PLUS exactly one
 * enlargement; every one is refused by gov_repo.l15_machine_role_safe_v1 (via l15_require_machine_intake_identity_v1) before any
 * write, and nothing is written anywhere.
 */
const INTAKE_SIG = 'gov_repo.l15_admit_machine_signal_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,timestamp with time zone,text,text,text,uuid,text[],text[])';
const READ_SIG = 'gov_repo.l15_read_signals_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text)';
const L14_SUBMIT = 'gov_repo.l14_submit_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)';

test('M17-S1R1 actual machine LOGIN closed surface (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S1' });
  t.after(() => c.stop());
  const { bootstrapSql, rejects } = c;
  const k = await m17s1Kit(c);
  const org = await c.newOrg();
  const agentVersion = await k.object(org, 'AGENT_VERSION');
  const evidence = await k.evidence(org);
  const signal = (key: string): SignalOps => ({ org, key, kind: 'DETECTED_ABSENCE', source: 'SYSTEM_DETECTOR',
    subject: objectSubject('AGENT_VERSION', agentVersion.id), trust: 'INFERRED', methodId: 'SCANNER_DETECTED_RISK:RISK-NO-README',
    methodVersion: '1.0.0', hintSeverity: 'info', tags: ['DISCOVERY_EVIDENCE'], ids: [evidence] });
  const safe = async (login: string) => lastLine(await bootstrapSql(
    `select gov_repo.l15_machine_role_safe_v1('${login}'::regrole, '${login}')::text`));

  await t.test('1. a clean dedicated LOGIN holding only the capability admits a machine signal and hypothesis', async () => {
    assert.equal(await safe(MACHINE), 'true');
    const r = await k.run(k.machine, machineSignalSql(signal('clean-1')));
    assert.equal(r.replayed, false);
    const h = await k.run(k.machine, machineHypothesisSql({ org, key: 'clean-h', generator: 'DETERMINISTIC_RULE',
      subject: objectSubject('AGENT_VERSION', agentVersion.id), methodId: 'RULE', methodVersion: '1', signals: [r.signal_id] }));
    assert.equal(h.replayed, false);
    assert.equal(lastLine(await k.machine(`select current_user`)), MACHINE);
  });

  const governanceBefore = await k.governanceCounts();
  const l15Before = await k.l15Counts();
  let n = 0;
  /** A fresh LOGIN with the capability and exactly one enlargement; the intake call must be refused. */
  async function refused(label: string, enlargement: (login: string) => string, create = 'login inherit') {
    const login = `l15_neg_${++n}`;
    await bootstrapSql(`create role ${login} ${create}; grant govia_l15_machine_intake_caller to ${login}; ${enlargement(login)}`);
    assert.equal(await safe(login), 'false', label);
    await rejects(k.as(login)(machineSignalSql(signal(`neg-${n}`))), '42501', /L15_INTAKE_IDENTITY_INELIGIBLE/);
    await rejects(k.as(login)(machineHypothesisSql({ org, key: `neg-h-${n}`, generator: 'DETERMINISTIC_RULE',
      subject: objectSubject('AGENT_VERSION', agentVersion.id), methodId: 'RULE', methodVersion: '1', signals: ['00000000-0000-4000-8000-000000000001'] })),
    '42501', /L15_INTAKE_IDENTITY_INELIGIBLE/);
  }

  await t.test('2-9. every enlargement of the actual LOGIN is refused', async () => {
    await refused('2. service_role membership', l => `grant service_role to ${l};`);
    await refused('2b. authenticated membership', l => `grant authenticated to ${l};`);
    await bootstrapSql(`create role l15_unrelated nologin;`);
    await refused('3. unrelated role membership', l => `grant l15_unrelated to ${l};`);
    await refused('3b. dormant SET-only / no-INHERIT membership', l => `grant l15_unrelated to ${l} with inherit false, set false;`);
    await refused('3c. capability granted WITH ADMIN OPTION', l => `grant govia_l15_machine_intake_caller to ${l} with admin option;`);
    await refused('3d. transitive membership through a nested role', l => `create role l15_outer_${n + 1} nologin; grant l15_unrelated to l15_outer_${n + 1};
      grant l15_outer_${n + 1} to ${l};`);
    await refused('3e. predefined role pg_read_all_data', l => `grant pg_read_all_data to ${l};`);
    await bootstrapSql(`create role l15_table_reader nologin; grant usage on schema gov_repo to l15_table_reader;
      grant select, insert on gov_repo.organisations to l15_table_reader;`);
    await refused('4. role granting SELECT / INSERT on a gov_repo table', l => `grant l15_table_reader to ${l};`);
    await refused('4b. direct SELECT on a gov_repo table', l => `grant select on gov_repo.discovery_evidence to ${l};`);
    await refused('4c. column privilege on a gov_repo table', l => `grant select (organisation_id) on gov_repo.organisations to ${l};`);
    await refused('4d. direct privilege on an L15 table', l => `grant select on gov_repo.l15_risk_signals to ${l};`);
    await refused('5. EXECUTE on an unrelated SECURITY DEFINER (L15 read RPC)', l => `grant execute on function ${READ_SIG} to ${l};`);
    await refused('5b. EXECUTE on an L14 governance RPC', l => `grant execute on function ${L14_SUBMIT} to ${l};`);
    await refused('5c. EXECUTE on an owner-only gov_repo helper', l => `grant execute on function gov_repo.l15_frame_hash_v1(text[]) to ${l};`);
    await refused('6. CREATE on the database', l => `grant create on database postgres to ${l};`);
    await refused('7. CREATE on an application schema', l => `grant create on schema gov_repo to ${l};`);
    await refused('7b. CREATE on schema public', l => `grant create on schema public to ${l};`);
    await refused('8. expired LOGIN (rolvaliduntil in the past)', () => '', `login inherit valid until '2000-01-01'`);
    for (const flag of ['createdb', 'createrole', 'replication', 'bypassrls']) {
      await refused(`9. privileged LOGIN flag ${flag}`, () => '', `login inherit ${flag}`);
    }
    // A NOLOGIN role (e.g. the capability itself) is never an intake identity.
    assert.equal(await safe('govia_l15_machine_intake_caller'), 'false');
  });

  await t.test('10. refused identities wrote nothing: zero signals / hypotheses / links / decisions / authorizations', async () => {
    assert.deepEqual(await k.l15Counts(), l15Before);
    assert.deepEqual(await k.governanceCounts(), governanceBefore);
  });

  await t.test('the clean LOGIN still reaches exactly the two intake RPCs and cannot execute any L14 / L15 governance or read RPC', async () => {
    await rejects(k.machine(`select gov_repo.l14_submit_proposal_v1(null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null)`),
      '42501', /permission denied/);
    await rejects(k.machine(`select * from ${READ_SIG.replace(/\(.*\)$/, '')}(null,null,null,null,null,null,null,null,null,null)`), '42501', /permission denied/);
    assert.deepEqual(JSON.parse(lastLine(await bootstrapSql(`select json_agg(p.proname order by p.proname) from pg_proc p
      where p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
        and (p.prosecdef or p.pronamespace='gov_repo'::regnamespace) and has_function_privilege('${MACHINE}', p.oid, 'EXECUTE')`))),
    ['l15_admit_machine_hypothesis_v1', 'l15_admit_machine_signal_v1']);
    assert.equal(await safe(MACHINE), 'true');
  });

  await t.test('negative controls: a rolled-back enlargement of the clean LOGIN is detected, and the boundary returns after rollback', async () => {
    const probe = async (ddl: string) => lastLine(await bootstrapSql(`begin; ${ddl};
      select gov_repo.l15_machine_role_safe_v1('${MACHINE}'::regrole, '${MACHINE}')::text; rollback;`));
    for (const ddl of [`grant select on gov_repo.organisations to ${MACHINE}`, `grant service_role to ${MACHINE}`,
      `grant execute on function ${READ_SIG} to ${MACHINE}`, `grant create on schema gov_repo to ${MACHINE}`,
      `alter role ${MACHINE} createdb`, `alter role ${MACHINE} valid until '2000-01-01'`,
      `grant execute on function ${INTAKE_SIG} to l15_unrelated; grant l15_unrelated to govia_l15_machine_intake_caller`]) {
      assert.equal(await probe(ddl), 'false', ddl);
    }
    assert.equal(await safe(MACHINE), 'true');
    // The identity helpers are owner-only SECURITY INVOKER with a pinned path; no application role can call them.
    for (const role of ['service_role', 'authenticated', 'anon'] as const) {
      await rejects(c.sql(`select gov_repo.l15_machine_role_safe_v1(0::oid, 'x')`, role), '42501', /permission denied/);
    }
    await rejects(k.machine(`select gov_repo.l15_machine_role_safe_v1(0::oid, 'x')`), '42501', /permission denied/);
  });
});
