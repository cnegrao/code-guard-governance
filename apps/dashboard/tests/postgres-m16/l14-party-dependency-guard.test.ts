import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import {
  l14PartyDependencyGuardMigration, l14ResponsibilityAssignmentMigration, migrationSource,
} from '../helpers/disposable-m16-postgres';
import { INVENTORY_SQL, type InventoryRow } from '../helpers/m16-definer-surface-fixtures';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';

/**
 * M16-S1C.1R1 — Party dependency commit-boundary closure of the S1C.1 RESPONSIBILITY_ASSIGNMENT decide RPC, on real
 * disposable PostgreSQL 17 (S1C1R1 horizon, stopped before the corrective migration so its preflight / effective-catalog
 * postflight can be exercised). Distinct backends contend for the real locks; blocking is observed via pg_stat_activity +
 * pg_blocking_pids from a monitor session, never by sleeping alone.
 */
const DECIDE = 'gov_repo.l14_decide_responsibility_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)';
const GUARD = 'gov_repo.l14_lock_party_dependency_guard_shared_v1(uuid,uuid)';
const ROUTINE_DIGEST = `select md5(string_agg(oid::regprocedure::text||':'||encode(sha256(convert_to(prosrc,'UTF8')),'hex')||':'||coalesce(array_to_string(proconfig,';'),'-')
  ||':'||coalesce(proacl::text,'-')||':'||prosecdef::text||':'||pg_get_userbyid(proowner), ',' order by oid::regprocedure::text collate "C")) from pg_proc
  where pronamespace='gov_repo'::regnamespace and proname not in ('l14_decide_responsibility_assignment_proposal_v1','l14_lock_party_dependency_guard_shared_v1')`;
const TABLE_DIGEST = `select md5(string_agg(c.oid::regclass::text||'|'||coalesce(c.relacl::text,'-')||'|'||
  coalesce((select string_agg(conname||':'||pg_get_constraintdef(k.oid), ',' order by conname) from pg_constraint k where k.conrelid=c.oid),'')||'|'||
  coalesce((select string_agg(tgname||':'||tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid=c.oid and not tgisinternal),''),
  ',' order by c.oid::regclass::text collate "C")) from pg_class c where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p','v','m')`;
const F2_DIGEST = `select md5(concat_ws('|',
  (select string_agg(conname||':'||pg_get_constraintdef(oid), ',' order by conname) from pg_constraint where conrelid='gov_repo.canonical_relationships'::regclass or confrelid='gov_repo.canonical_relationships'::regclass),
  (select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid='gov_repo.canonical_relationships'::regclass),
  (select relacl::text from pg_class where oid='gov_repo.canonical_relationships'::regclass),
  (select count(*)::text from gov_repo.canonical_relationships)));`;
const s1c1Decide = () => {
  const text = migrationSource(l14ResponsibilityAssignmentMigration);
  const start = text.indexOf('CREATE FUNCTION gov_repo.l14_decide_responsibility_assignment_proposal_v1(');
  return text.slice(start, text.indexOf('$decide_responsibility$;', start) + '$decide_responsibility$;'.length);
};
const postflight = () => {
  const text = migrationSource(l14PartyDependencyGuardMigration);
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.includes('M16_S1C1R1_POSTFLIGHT'));
  return block;
};

test('M16 S1C.1R1 Party dependency commit-boundary closure (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C1R1', stopBefore: l14PartyDependencyGuardMigration });
  t.after(() => c.stop());
  const { owner, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const json = (out: string) => JSON.parse(lastLine(out));
  const inventory = async (): Promise<InventoryRow[]> => JSON.parse(await bootstrapSql(INVENTORY_SQL));
  const k = await responsibilityKit(c);
  const pk = k.pk;
  const now = 'clock_timestamp()';

  const routinesBefore = await one(ROUTINE_DIGEST);
  const tablesBefore = await one(TABLE_DIGEST);
  const f2Before = await one(F2_DIGEST);
  const inventoryBefore = await inventory();
  const decideBefore = await one(`select coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';')||'|'||prosecdef::text||'|'||pg_get_userbyid(proowner)
    from pg_proc where oid='${DECIDE}'::regprocedure`);
  assert.equal(inventoryBefore.filter(p => p.app).length, 37, 'the S1C.2 application definer surface is 37');
  assert.equal(inventoryBefore.filter(p => p.app && p.owner_store).length, 27);

  await t.test('preflight: the exact S1C.2 catalog is required; a break aborts with nothing applied', async () => {
    for (const [brk, fix, message] of [
      [`alter function ${DECIDE} set lock_timeout = '6s'`, `alter function ${DECIDE} set lock_timeout = '5s'`, /differs from its S1C\.2 owner\/body\/config/],
      ['create table gov_repo.l14_probe (id int)', 'drop table gov_repo.l14_probe', /unexpected l14 relation set/],
    ] as const) {
      await bootstrapSql(`set role postgres; ${brk}`);
      try {
        await assert.rejects(c.migrate(l14PartyDependencyGuardMigration), (e: Error) => /M16_S1C1R1_PREFLIGHT/.test(e.message) && message.test(e.message));
      } finally { await bootstrapSql(`set role postgres; ${fix}`); }
      assert.equal(await one(`select count(*) from pg_proc where proname='l14_lock_party_dependency_guard_shared_v1'`), '0');
      assert.equal(await one(ROUTINE_DIGEST), routinesBefore);
    }
  });

  await t.test('apply: only the decide RPC body changes (in place) + one owner-only invoker helper; surface stays 37 / 27; F2 untouched', async () => {
    const oldBody = await one(`select to_json(prosrc) from pg_proc where oid='${DECIDE}'::regprocedure`);
    await c.migrate(l14PartyDependencyGuardMigration);
    await assert.rejects(c.migrate(l14PartyDependencyGuardMigration), /M16_S1C1R1_PREFLIGHT/, 'not re-appliable');
    await owner(postflight());
    assert.equal(await one(ROUTINE_DIGEST), routinesBefore, 'every other gov_repo routine is byte-identical');
    assert.equal(await one(TABLE_DIGEST), tablesBefore, 'no table / constraint / trigger changed');
    assert.equal(await one(F2_DIGEST), f2Before);
    assert.equal(await one(`select pg_get_userbyid(proowner)||'|'||coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';')||'|'||prosecdef::text
      from pg_proc where oid='${GUARD}'::regprocedure`), 'postgres|{postgres=X/postgres}|search_path=pg_catalog, pg_temp|false');
    assert.equal(await one(`select coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';')||'|'||prosecdef::text||'|'||pg_get_userbyid(proowner)
      from pg_proc where oid='${DECIDE}'::regprocedure`), decideBefore, 'same ACL, config, SECURITY DEFINER, owner');
    const newBody = JSON.parse(await one(`select to_json(prosrc) from pg_proc where oid='${DECIDE}'::regprocedure`)) as string;
    const strip = (body: string) => body.replace(/^\s*--.*$\n/gm, '');
    assert.equal(strip(newBody).replace(`  IF p_outcome = 'VALIDATE' THEN
    PERFORM gov_repo.l14_lock_party_dependency_guard_shared_v1(v_org, v_proposal.governance_party_id);
  END IF;
`, ''), strip(JSON.parse(oldBody) as string), 'the body is the merged S1C.1 body plus exactly the VALIDATE-only shared Party guard');
    const after = await inventory();
    assert.equal(after.filter(p => p.app).length, 37);
    assert.equal(after.filter(p => p.app && p.owner_store).length, 27);
    const changed = after.filter(p => inventoryBefore.find(b => b.fn === p.fn)?.sha256 !== p.sha256).map(p => p.fn);
    assert.deepEqual(changed, [DECIDE], 'exactly one approved definer changed, in place');
    const sha = after.find(p => p.fn === DECIDE)!.sha256;
    assert.ok(postflight().includes(`'${sha}'`), 'the new decide body hash is pinned in the effective postflight');
    await assert.rejects(c.sql(`select gov_repo.l14_lock_party_dependency_guard_shared_v1(gen_random_uuid(), gen_random_uuid())`, 'service_role'),
      /42501|permission denied/);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(await one(`select has_function_privilege('${role}', '${GUARD}'::regprocedure, 'EXECUTE')::text`), 'false', role);
    }
    assert.equal(await one(`select count(*) from pg_constraint where conname='canonical_objects_kind_check'
      and array_length(regexp_split_to_array(pg_get_constraintdef(oid), ''''), 1) = 23`), '1', '11 canonical kinds');
  });

  await t.test('postflight negative controls: guard / decide drift is detected', async () => {
    const block = postflight();
    const inTxn = (setup: string) => bootstrapSql(`begin;\n${setup}\n${block}\nrollback;`);
    for (const [name, setup, expected] of [
      ['merged S1C.1 decide body restored (no Party guard)', `set local role postgres; ${s1c1Decide().replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')} reset role;`,
        /body hash changed/],
      ['guard made SECURITY DEFINER', `alter function ${GUARD} security definer;`, /owner-only SECURITY INVOKER|drifted/],
      ['guard granted to service_role', `grant execute on function ${GUARD} to service_role;`, /owner-only SECURITY INVOKER|twenty|nineteen/],
      ['guard search_path drift', `alter function ${GUARD} set search_path = public, pg_temp;`, /search_path not pinned/],
      ['guard made EXCLUSIVE', `set local role postgres; create or replace function ${GUARD.replace('(uuid,uuid)', '(p_organisation_id uuid, p_governance_party_id uuid)')}
        returns void language plpgsql volatile set search_path = pg_catalog, pg_temp as $g$ begin
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(gov_repo.frame_identity(ARRAY[p_organisation_id::text,
          'l14-registry-subject-guard-v1', 'GOVERNANCE_PARTY', p_governance_party_id::text]), 0)); end $g$; reset role;`, /drifted/],
      ['guard in another lock namespace', `set local role postgres; create or replace function ${GUARD.replace('(uuid,uuid)', '(p_organisation_id uuid, p_governance_party_id uuid)')}
        returns void language plpgsql volatile set search_path = pg_catalog, pg_temp as $g$ begin
        perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(gov_repo.frame_identity(ARRAY[p_organisation_id::text,
          'l14-party-dependency-guard-v1', 'GOVERNANCE_PARTY', p_governance_party_id::text]), 0)); end $g$; reset role;`, /drifted/],
    ] as const) {
      await assert.rejects(inTxn(setup), (e: Error) => {
        assert.match(e.message, /M16_S1C1R1_POSTFLIGHT/, `${name}: ${e.message}`);
        assert.match(e.message, expected, `${name}: ${e.message}`);
        return true;
      });
    }
    // The helper and the new decide body never reach a policy / registry store, Party PII, F2 or another fact family.
    const bodies = JSON.parse(await one(`select json_agg(prosrc) from pg_proc where oid in ('${GUARD}'::regprocedure, '${DECIDE}'::regprocedure)`)) as string[];
    assert.equal(bodies.length, 2);
    const corpus = bodies.join('\n----\n');
    assert.ok(corpus.includes("'l14-registry-subject-guard-v1', 'GOVERNANCE_PARTY'") && corpus.includes('RESPONSIBILITY_SINGLE_OWNER_CONFLICT')
      && corpus.includes('gov_repo.l14_governance_party_valid_state_v1('), 'both bodies are scanned in full');
    for (const forbidden of [/governance_policies/, /policy_versions/, /l14_policy_/, /l14_control_definition/, /l14_domain_/, /directory_profile/,
      /display_name/, /\bemail\b/i, /\bphone\b/i, /profile_text/, /governance_users/, /owner_user_id/, /canonical_relationships/, /BUSINESS_CONTEXT/,
      /APPLICABILITY/, /ASSESSMENT/, /\bstatus\b/,
      // Permitted Party dependency mechanics: the shared registry-subject lock key and the existing exact Party resolver
      // (gov_repo.l14_governance_party_valid_state_v1). Forbidden: any Party registry mutation or direct Party table / profile read.
      /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+gov_repo\.(l14_governance_part|l14_registry_states|l14_authority_policy|governance_users)/i,
      /\bgov_repo\.l14_governance_part(ies|y_states|y_heads|y_proposals)\b/i]) {
      assert.doesNotMatch(corpus, forbidden, String(forbidden));
    }
  });

  // ---------------------------------------------------------------------------------------
  const monitor = c.session('m16_bootstrap');
  t.after(() => monitor.close());
  type Session = ReturnType<typeof c.session>;
  const pidOf = async (session: Session) => (await session.run('select pg_backend_pid();')).out.trim();
  async function race(first: string, second: string) {
    const s1 = c.session('service_role'), s2 = c.session('service_role');
    try {
      await s1.run('begin;');
      const a = await s1.run(first);
      assert.equal(a.err, '', a.err);
      const [p1, p2] = [await pidOf(s1), await pidOf(s2)];
      const pending = s2.run(second);
      for (let i = 0; ; i++) {
        const state = (await monitor.run(`select coalesce((select wait_event_type from pg_stat_activity where pid=${p2}),'')
          ||':'||(pg_blocking_pids(${p2}) @> array[${p1}])::text;`)).out.trim();
        if (state === 'Lock:true') break;
        assert.ok(i < 1000, 'session never observed blocked by the expected holder');
        await sleep(20);
      }
      await s1.run('commit;');
      return { first: a, second: await pending };
    } finally { await Promise.all([s1.close(), s2.close()]); }
  }
  async function parallel(first: string, second: string) {
    const s1 = c.session('service_role'), s2 = c.session('service_role');
    try {
      await s1.run('begin;');
      const a = await s1.run(first);
      assert.equal(a.err, '', a.err);
      const b = await s2.run(second, 15_000);
      assert.equal(b.err, '', b.err);
      await s1.run('commit;');
      return { first: a, second: b };
    } finally { await Promise.all([s1.close(), s2.close()]); }
  }
  const forCommand = async (org: string, commandId: string) => JSON.parse(await one(`select json_build_object(
    'authz',(select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${org}' and command_id='${commandId}'),
    'result',(select count(*) from gov_repo.l14_command_results where organisation_id='${org}' and command_id='${commandId}'))`));

  await t.test('race order 1: Party REVOKE holds the EXCLUSIVE registry guard; the waiting VALIDATE fails PARTY_DEPENDENCY_NOT_VALID and consumes nothing', async () => {
    const x = await k.setup();
    const p = await k.party(x, 'r1');
    const key = k.keyOf('DATA_ASSET', x.objects.asset, 'DATA_OWNER', p.partyId);
    const q = k.validateProposal(key, p.stateId);
    const s = await k.submit(x, x.member, 'r1-submit', q);
    const rp = pk.revokeProposal(p.partyId, p.stateId);
    const rs = await pk.submit(x as never, x.member, 'r1-party-rv-submit', rp);
    const before = await k.counts(x.org);
    const { first, second } = await race(pk.decideSqlFor(x as never, x.steward, x.cmd('r1-party-rv'), rs.proposal_id, rp, 'REVOKE', p.stateId),
      k.decideSqlFor(x.rs, x.cmd('r1'), s.proposal_id, q, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'REVOKED');
    assert.match(second.err, /GV010[\s\S]*PARTY_DEPENDENCY_NOT_VALID/, second.err);
    const after = await k.counts(x.org);
    for (const table of ['l14_fact_states', 'l14_responsibility_assignment_states', 'l14_responsibility_assignment_heads', 'l14_support_links']) {
      assert.equal(after[table], before[table], `${table}: nothing consumed`);
    }
    for (const table of ['l14_authorization_decisions', 'l14_governance_decisions', 'l14_command_results']) {
      assert.equal(after[table], before[table] + 1, `${table}: only the Party revocation wrote`);
    }
    assert.deepEqual(await forCommand(x.org, x.cmd('r1')), { authz: 0, result: 0 }, 'no authorization / result for the failed decision');
    assert.equal(await k.head(x.org, key), null);
  });

  await t.test('race order 2: VALIDATE holds the SHARED Party guard; the Party REVOKE waits, commits after it, and invalidates it (O49)', async () => {
    const x = await k.setup();
    const p = await k.party(x, 'r2');
    const key = k.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', p.partyId);
    const q = k.validateProposal(key, p.stateId);
    const s = await k.submit(x, x.member, 'r2-submit', q);
    const rp = pk.revokeProposal(p.partyId, p.stateId);
    const rs = await pk.submit(x as never, x.member, 'r2-party-rv-submit', rp);
    const { first, second } = await race(k.decideSqlFor(x.rs, x.cmd('r2'), s.proposal_id, q, 'VALIDATE', null),
      pk.decideSqlFor(x as never, x.steward, x.cmd('r2-party-rv'), rs.proposal_id, rp, 'REVOKE', p.stateId));
    const a = json(first.out), r = json(second.out);
    assert.deepEqual([a.outcome, r.outcome], ['VALIDATED', 'REVOKED']);
    assert.ok(Date.parse(a.recorded_at) < Date.parse(r.recorded_at), 'the fact committed before the revocation was recorded');
    const rows = await k.stateRows(x.org, a.fact_state_id);
    assert.equal(await k.resolve(x.org, key, now, now), null, 'current responsibility → UNKNOWN after the revocation');
    const at = `'${a.recorded_at}'::timestamptz`;
    assert.equal(await k.resolve(x.org, key, at, at), a.fact_state_id, 'earlier coordinates stay historically resolvable');
    assert.equal(await k.stateRows(x.org, a.fact_state_id), rows, 'history byte-identical');
    // A dependency-invalid assignment can still be ended explicitly (REVOKE takes no Party guard and checks no Party validity).
    const ended = await k.revoke(x, 'r2-end', key, p.stateId, a.fact_state_id);
    assert.equal(ended.decided.outcome, 'REVOKED');
  });

  await t.test('parallelism: two VALIDATEs pinning the SAME Party on different keys hold the shared guard concurrently', async () => {
    const x = await k.setup();
    const p = await k.party(x, 'par');
    const [qa, qb] = [k.validateProposal(k.keyOf('AGENT', x.objects.agent, 'TECHNICAL_OWNER', p.partyId), p.stateId),
      k.validateProposal(k.keyOf('DATA_ELEMENT', x.objects.element, 'DATA_STEWARD', p.partyId), p.stateId)];
    const [sa, sb] = [await k.submit(x, x.member, 'par-a-submit', qa), await k.submit(x, x.member, 'par-b-submit', qb)];
    const { first, second } = await parallel(k.decideSqlFor(x.rs, x.cmd('par-a'), sa.proposal_id, qa, 'VALIDATE', null),
      k.decideSqlFor(x.rs2, x.cmd('par-b'), sb.proposal_id, qb, 'VALIDATE', null));
    assert.deepEqual([json(first.out).outcome, json(second.out).outcome], ['VALIDATED', 'VALIDATED']);
  });

  await t.test('S1C.1 behaviour on the corrected catalog: sequential O49, single-owner conflict and steward coexistence unchanged', async () => {
    const x = await k.setup();
    const [a, b] = [await k.party(x, 'sa'), await k.party(x, 'sb')];
    const keyA = k.keyOf('DATA_ASSET', x.objects.asset2, 'DATA_OWNER', a.partyId);
    const held = await k.assign(x, 'sa', keyA, a);
    const pb = k.validateProposal(k.keyOf('DATA_ASSET', x.objects.asset2, 'DATA_OWNER', b.partyId), b.stateId);
    const sb = await k.submit(x, x.member, 'sb-submit', pb);
    await c.rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd('sb'), proposalId: sb.proposal_id, proposal: pb })), 'GV009', /RESPONSIBILITY_SINGLE_OWNER_CONFLICT/);
    for (const party of [a, b]) {
      assert.equal((await k.assign(x, `st-${party.partyId.slice(0, 4)}`, k.keyOf('DATA_ELEMENT', x.objects.element2, 'DATA_STEWARD', party.partyId), party))
        .decided.outcome, 'VALIDATED');
    }
    await k.revokeParty(x, 'sa', a);
    assert.equal(await k.resolve(x.org, keyA, now, now), null);
    const stale = k.validateProposal(k.keyOf('AGENT', x.objects.agent2, 'BUSINESS_OWNER', a.partyId), a.stateId);
    const ss = await k.submit(x, x.member, 'stale-submit', stale);
    await c.rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd('stale'), proposalId: ss.proposal_id, proposal: stale })), 'GV010', /PARTY_DEPENDENCY_NOT_VALID/);
    assert.ok(held.stateId);
  });
});
