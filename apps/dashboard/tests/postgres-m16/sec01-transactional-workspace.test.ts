import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock, test } from 'node:test';
import { l14Cluster, lastLine, type Actor } from '../helpers/m16-l14-fixtures';
import { canonicalObjectKit, lit, named } from '../helpers/m16-governed-write-fixtures';
import { m17s3Kit, objectSubject } from '../helpers/m17-s3-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';

const migration = '20261111123119_sec01_transactional_workspace_acquisition_v1.sql';
const fn = 'gov_repo.read_executive_workspace_v1';
const sig = `${fn}(uuid,uuid,bigint,bigint,timestamptz,integer)`;
const dir = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('SEC-01 actual PG17 acquisition, independent transactions, discriminating revocation and app integration', { timeout: 1_200_000 }, async t => {
  const c = await l14Cluster(m => t.diagnostic(m), { horizon: 'M17S7B' });
  t.after(() => c.stop());
  const tail = readdirSync(dir).filter(n => /^\d{14}_.*\.sql$/.test(n) && n > '20261019130000_m17_s7b_passport_risk_overlay_v1.sql' && n < migration).sort();
  // The historical harness migrate() deliberately admits only its frozen
  // M17S7D horizon. Replay later files verbatim through the owner connection,
  // as the existing SR1/SR2 suites do; never expand that historical allowlist.
  for (const n of tail) await c.owner(readFileSync(join(dir, n), 'utf8'));
  const inventory = () => c.owner(`select jsonb_agg(to_jsonb(p) order by oid)::text from pg_proc p
    where pronamespace='gov_repo'::regnamespace and proname<>'read_executive_workspace_v1'`);
  const permissions = () => c.owner(`select jsonb_build_object('tables',(select jsonb_agg(to_jsonb(c) order by oid) from pg_class c
    where relnamespace='gov_repo'::regnamespace),'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),
    'members',(select jsonb_agg(to_jsonb(m) order by roleid,member) from pg_auth_members m))::text`);
  const [priorRoutines, priorPermissions] = await Promise.all([inventory(), permissions()]);
  await c.owner(readFileSync(join(dir, migration), 'utf8'));
  assert.equal(await inventory(), priorRoutines, 'all prior routine bodies/owners/config/ACL remain exact');
  assert.equal(await permissions(), priorPermissions, 'no table/default/member privilege or schema delta');
  t.diagnostic(`Canonical tail replay: ${tail.length} files + SEC-01; real PG17 with unchanged prior routines/table privileges`);

  const call = (a: Actor, page = 1, overrides: Record<string, string> = {}) => `select ${fn}(${named({ ...c.principal(a), p_page: String(page), ...overrides })});`;
  const acquire = async (a: Actor, page = 1) => JSON.parse(lastLine(await c.svc(call(a, page))));
  const helper = (a: Actor) => `select * from gov_repo.lock_and_resolve_governance_session_eligibility_v1(
    '${a.org}','${a.id}',floor(extract(epoch from clock_timestamp()))::bigint-10,
    floor(extract(epoch from clock_timestamp()))::bigint+3600,'${a.epoch}');`;
  let serial = 0;
  async function estate(count = 1) {
    const org = await c.newOrg(), actor = await c.mkUser(org, [c.memberRole]);
    const kits = Array.from({ length: count }, () => {
      const label = `sec01-${String(++serial).padStart(4, '0')}`;
      return canonicalObjectKit(org, label, 'AGENT', { proposedIdentity: { reference: label }, identity: label });
    });
    if (kits.length) await c.owner(kits.map(k => k.sql).join('\n'));
    return { org, actor, ids: kits.map(k => k.objectId).sort() };
  }
  const monitor = c.session('m16_bootstrap'); t.after(() => monitor.close());
  type Session = ReturnType<typeof c.session>;
  const session = (role: 'postgres' | 'service_role' | 'm16_bootstrap') => {
    const raw = c.session(role);
    // psql sentinels do not execute an unterminated query. Enforce the framing
    // here for every dynamic writer/probe, not just PID reads.
    const s = { ...raw, run: (sql: string) => raw.run(sql.trimEnd().endsWith(';') ? sql : `${sql};`) };
    t.after(() => s.close()); return s;
  };
  const pid = async (s: Session) => {
    const r = await s.run('select pg_backend_pid();');
    assert.equal(r.err, '', r.err); const value = r.out.trim(); assert.match(value, /^\d+$/); return value;
  };
  async function blocked(waiter: string, holder: string) {
    for (let i = 0; i < 250; i++) {
      const state = (await monitor.run(`select coalesce((select wait_event_type from pg_stat_activity where pid=${waiter}),'')
        ||':'||(pg_blocking_pids(${waiter}) @> array[${holder}])::text;`)).out.trim();
      if (state === 'Lock:true') return;
      await delay(10);
    }
    assert.fail(`backend ${waiter} never observed waiting on ${holder}`);
  }

  await t.test('catalog posture: only service_role can call; canonical eligibility remains owner-only', async () => {
    assert.equal(await c.owner(`select pg_get_userbyid(proowner)='postgres' and prosecdef and provolatile='v'
      from pg_proc where oid='${sig}'::regprocedure`), 't');
    assert.match(await c.owner(`select proconfig::text from pg_proc where oid='${sig}'::regprocedure`), /default_transaction_isolation=read committed/);
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await c.owner(`select has_function_privilege('${role}','${sig}','execute')`), 'f');
      const x = await estate(0);
      await c.rejects(c.sql(call(x.actor), role as 'anon' | 'authenticated'), '42501');
    }
    assert.equal(await c.owner(`select has_function_privilege('service_role','${sig}','execute')`), 't');
    assert.equal(await c.owner(`select has_function_privilege('service_role',
      'gov_repo.lock_and_resolve_governance_session_eligibility_v1(uuid,uuid,bigint,bigint,timestamptz)','execute')`), 'f');
  });
  await t.test('all identity counts and pages are tenant-isolated, deterministic and complete above the former 200-row chunk', async () => {
    const x = await estate(205), foreign = await estate(2), ids: string[] = [];
    for (let p = 1; p <= 18; p++) {
      const r = await acquire(x.actor, p);
      assert.equal(r.organisation_id, x.org); assert.equal(r.objects.length, 205); assert.equal(r.page, p);
      assert.ok(r.objects.every((o: { organisation_id: string }) => o.organisation_id === x.org));
      ids.push(...r.subjects.map((s: { id: string }) => s.id));
      assert.ok(!JSON.stringify(r).includes(foreign.ids[0]));
    }
    assert.deepEqual(ids, x.ids); assert.equal(new Set(ids).size, 205);
    assert.equal((await acquire(x.actor, 999)).page, 18);
    assert.equal((await acquire(x.actor, 0)).page, 1);
  });
  await t.test('zero Agents still executes canonical admission; current roleless user is eligible without invented permissions', async () => {
    const org = await c.newOrg(), a = await c.mkUser(org, []);
    assert.deepEqual((await acquire(a)).subjects, []);
    await c.owner(`update gov_repo.governance_users set status='suspended' where user_id='${a.id}'`);
    await c.rejects(c.svc(call(a)), 'GV003');
  });
  await t.test('committed revocations and tenant substitution deny before any protected read; no empty/UNKNOWN fallback', async () => {
    for (const [sql, code] of [
      [(x: Awaited<ReturnType<typeof estate>>) => `update gov_repo.governance_users set external_id='rotated' where user_id='${x.actor.id}'`, 'GV002'],
      [(x: Awaited<ReturnType<typeof estate>>) => `update gov_repo.organisations set is_active=false where organisation_id='${x.org}'`, 'GV003'],
      [(x: Awaited<ReturnType<typeof estate>>) => `update gov_repo.governance_users set status='suspended' where user_id='${x.actor.id}'`, 'GV003'],
    ] as const) {
      const x = await estate(); await c.owner(sql(x)); await c.rejects(c.svc(call(x.actor)), code);
    }
    const x = await estate(), other = await c.newOrg();
    await c.rejects(c.svc(call(x.actor, 1, { p_verified_organisation_id: lit(other) })), 'GV003');
    await c.rejects(c.svc(call(x.actor, 1, { p_verified_session_exp: '1' })), 'GV001');
    await c.rejects(c.svc(`begin isolation level repeatable read; ${call(x.actor)} commit;`), 'GV005');
    await c.rejects(c.svc(`begin isolation level serializable; ${call(x.actor)} commit;`), 'GV005');
    const bad = await c.mkUser(x.org, [randomUUID()]);
    await c.rejects(c.svc(call(bad)), 'GV004');
  });
  await t.test('discriminant: the R2 independent-admission protocol permits credential revocation during protected acquisition', async st => {
    const x = await estate(), reader = session('postgres'), gate = session('postgres'), writer = session('service_role');
    st.after(() => gate.run('rollback;'));
    // Reproduce R2's residual window on real persisted rows: initial admission,
    // identity acquisition, final USER snapshot, revocation, final ORG response.
    // The canonical initial helper is stronger than R2's independent checks,
    // but releasing it before acquisition still leaves the same final window.
    await reader.run(helper(x.actor));
    const identity = await reader.run(`select count(*) from gov_repo.canonical_objects where organisation_id='${x.org}';`);
    assert.equal(identity.out.trim(), '1');
    const finalUser = await reader.run(`select status='active' and password_changed_at='${x.actor.epoch}'::timestamptz
      from gov_repo.governance_users where user_id='${x.actor.id}' and organisation_id='${x.org}';`);
    assert.equal(finalUser.out.trim(), 't');
    await gate.run('begin; lock table gov_repo.organisations in access exclusive mode;');
    const [rp, gp] = await Promise.all([pid(reader), pid(gate)]);
    const reading = reader.run(`select is_active from gov_repo.organisations where organisation_id='${x.org}';`);
    await blocked(rp, gp);
    const w = await writer.run(`update gov_repo.governance_users set external_id='revoked-between-reads' where user_id='${x.actor.id}';`);
    assert.equal(w.err, '');
    const observation = { writerCommittedBeforeReadFinished: true, disclosedAgentCount: 1 };
    const secureCriterion = (o: typeof observation) => assert.equal(o.writerCommittedBeforeReadFinished, false);
    assert.throws(() => secureCriterion(observation), assert.AssertionError, 'the same security criterion fails the vulnerable protocol');
    await gate.run('commit;');
    assert.equal((await reading).out.trim(), 't');
    t.diagnostic(`Vulnerable negative control: ${JSON.stringify(observation)}; secure criterion FAIL as expected`);
    await c.rejects(c.svc(call(x.actor)), 'GV002');
  });

  for (const count of [0, 1]) await t.test(`ORG/USER/ROLE locks precede identity acquisition and survive its result until commit (${count} Agents)`, async st => {
    const x = await estate(count), reader = session('service_role'), gate = session('postgres');
    let pendingRead: Promise<unknown> = Promise.resolve();
    st.after(async () => { await gate.run('rollback;'); await pendingRead.catch(() => {}); await reader.run('rollback;'); });
    await gate.run('begin; lock table gov_repo.canonical_objects in access exclusive mode;');
    await reader.run('begin isolation level read committed;');
    const [rp, gp] = await Promise.all([pid(reader), pid(gate)]);
    let modelReleased = false;
    const reading = reader.run(call(x.actor)).then(r => { modelReleased = true; return r; });
    pendingRead = reading;
    await blocked(rp, gp);
    assert.equal(modelReleased, false, 'no result during protected acquisition');
    for (const probe of [
      `select 1 from gov_repo.organisations where organisation_id='${x.org}' for update nowait`,
      `select 1 from gov_repo.governance_users where user_id='${x.actor.id}' for update nowait`,
      `select 1 from gov_repo.governance_roles where role_id='${c.memberRole}' for update nowait`,
    ]) await c.rejects(c.owner(probe), '55P03');
    const writers = [
      `update gov_repo.organisations set display_name='concurrent' where organisation_id='${x.org}'`,
      `update gov_repo.governance_users set external_id='concurrent-rotation' where user_id='${x.actor.id}'`,
      `update gov_repo.governance_roles set role_name='concurrent' where role_id='${c.memberRole}'`,
    ].map(sql => ({ s: session('service_role'), sql }));
    const pids = await Promise.all(writers.map(w => pid(w.s)));
    let completed = 0;
    const pending = writers.map(w => w.s.run(w.sql).then(r => { completed++; return r; }));
    for (const wp of pids) await blocked(wp, rp);
    assert.equal(completed, 0);
    await gate.run('commit;');
    const result = await reading; assert.equal(result.err, '', result.err);
    assert.equal(JSON.parse(lastLine(result.out)).objects.length, count);
    for (const wp of pids) await blocked(wp, rp);
    assert.equal(completed, 0, 'locks remain held after function result, until outer transaction commits');
    await reader.run('commit;');
    for (const r of await Promise.all(pending)) assert.equal(r.err, '', r.err);
    assert.equal(completed, 3);
    t.diagnostic(`Corrected ${count}-Agent acquisition: ORG/USER/ROLE NOWAIT=55P03; all 3 independent writers observed Lock:true; released only after commit`);
    await c.rejects(c.svc(call(x.actor)), 'GV002');
  });
  await t.test('revocation already in progress wins admission: wait then deny without reading identities', async st => {
    const x = await estate(), writer = session('service_role'), reader = session('service_role');
    st.after(() => writer.run('rollback;'));
    await writer.run(`begin; update gov_repo.governance_users set external_id='first' where user_id='${x.actor.id}';`);
    const [wp, rp] = await Promise.all([pid(writer), pid(reader)]);
    const pending = reader.run(call(x.actor)); await blocked(rp, wp); await writer.run('commit;');
    const r = await pending; assert.match(r.err, /GV002/); assert.doesNotMatch(r.out, /objects|subjects/);
  });
  await t.test('real acquisition/transaction failures yield no buffered JSON; no catch or partial result', async st => {
    const x = await estate(), gate = session('postgres');
    st.after(() => gate.run('rollback;'));
    await gate.run('begin; lock table gov_repo.canonical_objects in access exclusive mode;');
    // statement_timeout is earlier than the function-local M16 lock timeout.
    await c.rejects(c.svc(`set statement_timeout='150ms'; ${call(x.actor)}`), '57014');
    await gate.run('commit;');
    const s = session('service_role');
    const read = await s.run(`begin; ${call(x.actor)}`); assert.equal(read.err, '');
    const broken = await s.run('select 1/0;'); assert.match(broken.err, /22012/);
    await s.run('commit;');
    // A transport must discard its local buffered read after a transaction
    // error, even though the SELECT itself produced a value before COMMIT.
    assert.equal((await acquire(x.actor)).objects.length, 1);
  });
  await t.test('real governed risk and L14 projections retain exact subject lineage within the acquisition', async () => {
    const k = await m17s3Kit(c), x = await k.setup(), id = x.objects.AGENT!;
    const scenario = await k.scenario(x, 'sec01-operational', 'OPERATIONAL', ['AGENT']);
    const proposal = k.proposalOf(objectSubject('AGENT', id), scenario);
    const submitted = await k.submit(x, 'sec01-risk', proposal); await k.decide(x, 'sec01-risk', submitted, proposal);
    const before = await k.historyDigest(x.org), r = await acquire(x.member);
    assert.equal(await k.historyDigest(x.org), before, 'read creates no authority history');
    const subject = r.subjects.find((s: { id: string }) => s.id === id);
    assert.equal(subject.risks.overlay_status, 'PRESENT');
    assert.equal(subject.risks.items[0].subjectCanonicalObjectId, id);
    assert.equal(subject.risks.items[0].lineage.proposalId, submitted.proposal_id);
    assert.ok(Array.isArray(subject.facts));
    // Bind the actual production adapter to this real service-role SQL path.
    const calls: string[] = [];
    let forceCommitFailure = false;
    mock.module('../../lib/governance/persistence', { namedExports: { privilegedDb: { rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name); assert.equal(name, 'read_executive_workspace_v1');
      try {
        const commitGuard = forceCommitFailure ? `create temporary table sec01_commit_guard(id int primary key, parent int,
          foreign key(parent) references sec01_commit_guard(id) deferrable initially deferred);
          insert into sec01_commit_guard values(1,2);` : '';
        const q = `begin isolation level read committed; ${commitGuard} select ${fn}(${named(Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'number' ? String(v) : lit(String(v))])))}); commit;`;
        const data = JSON.parse(lastLine(await c.svc(q)));
        return { data, error: null, status: 200 };
      } catch (e) { return { data: null, error: { code: (String(e).match(/\b(GV\d{3}|42501|57014)\b/) ?? [])[1] ?? 'XX000' }, status: 400 }; }
    } } } });
    const { getExecutiveWorkspace, ExecutiveAuthorizationError } = await import('../../lib/workspace/executive-query');
    const now = Math.floor(Date.now() / 1000);
    const p = { organisationId: x.org, actorUserId: x.member.id, issuedAtSeconds: now - 10, expiresAtSeconds: now + 3600, credentialEpoch: x.member.epoch };
    const model = await getExecutiveWorkspace(p);
    assert.equal(model.risks[0].lineage.proposalId, submitted.proposal_id); assert.equal(calls.length, 1);
    forceCommitFailure = true; await assert.rejects(getExecutiveWorkspace(p), /EXECUTIVE_ACQUISITION_FAILED/);
    forceCommitFailure = false;
    t.diagnostic('Adapter real commit-failure probe: deferred FK fails at COMMIT after the SELECT; buffered acquisition discarded');
    await c.owner(`update gov_repo.governance_users set external_id='after-commit' where user_id='${x.member.id}'`);
    assert.equal(model.agentCount, 1, 'later revocation cannot retract the already committed model');
    await assert.rejects(getExecutiveWorkspace(p), ExecutiveAuthorizationError);
  });
  await t.test('existing L14 governed facts are acquired exactly without creating or changing authority history', async () => {
    const k = await responsibilityKit(c), x = await k.setup(), party = await k.party(x, 'sec01');
    const proposal = k.validateProposal(k.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', party.partyId), party.stateId);
    const submitted = await k.submit(x, x.member, 'sec01-submit', proposal);
    const decided = await k.decide(x, x.rs, 'sec01-validate', submitted, proposal, 'VALIDATE');
    const before = await c.counts(x.org), r = await acquire(x.member);
    assert.deepEqual(await c.counts(x.org), before);
    const subject = r.subjects.find((s: { id: string }) => s.id === x.objects.agent);
    assert.equal(subject.facts.length, 1);
    assert.equal(subject.facts[0].fact_state_id, decided.fact_state_id);
    assert.equal(subject.facts[0].target_canonical_object_id, x.objects.agent);
    assert.equal(subject.facts[0].fact_family, 'RESPONSIBILITY_ASSIGNMENT');
  });
});
