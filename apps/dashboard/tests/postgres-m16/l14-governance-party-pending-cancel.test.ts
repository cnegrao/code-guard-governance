import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14GovernancePartyMigration, l14GovernancePartyPendingCancelMigration } from '../helpers/disposable-m16-postgres';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { partyKit } from '../helpers/m16-l14-party-fixtures';

/**
 * M16-S1B.1R1 — pending GovernanceParty validation cancellation (REVOKE at >= the target's
 * effective_from) on real disposable PostgreSQL 17. The cluster starts at the historical S1B1
 * horizon, real Party history is written through the real RPCs and the old strict rule is observed;
 * only then is the corrective applied, so compatibility is proven on genuine S1B.1 rows.
 */
const DECIDE = 'gov_repo.l14_decide_governance_party_proposal_v1(uuid,uuid,bigint,bigint,timestamptz,text,uuid,text,text,uuid,text,text[],text)';
const GUARD = 'gov_repo.l14_governance_party_state_guard_v1()';
const postflightOf = (name: string, tag: string) => {
  const text = readFileSync(fileURLToPath(new URL(`../../../../supabase/migrations/${name}`, import.meta.url)), 'utf8');
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.startsWith('DO $postflight$') && block.includes(tag));
  return block;
};

test('M16 S1B.1R1 GovernanceParty pending validation cancellation (disposable PG17)', { timeout: 1_200_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B1' });
  t.after(() => c.stop());
  const { owner, exec, rejects } = c;
  const k = await partyKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const envelope = async (id: string) => JSON.parse(await one(`select to_json(s) from gov_repo.l14_registry_states s where state_id='${id}'`));
  const stateText = (id: string) => one(`select s::text||'#'||d::text from gov_repo.l14_registry_states s
    join gov_repo.l14_governance_party_states d using (organisation_id, state_id) where s.state_id='${id}'`);
  const shift = (ts: string, delta: string) => one(`select to_char(('${ts}'::timestamptz + interval '${delta}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
  const ts = (value: string, delta = '0 microsecond') => `('${value}'::timestamptz + interval '${delta}')`;
  const NOW = 'clock_timestamp()';

  // ---------------------------------------------------------------------------------------
  // Historical S1B.1 behaviour (before the corrective): equal-instant REVOKE was GV011.
  // ---------------------------------------------------------------------------------------
  const hist = await k.setup();
  const histV = await k.validated(hist, 'hist', 'PERSON', await k.instant('2 hours'), hist.flex);
  const histE = await k.canonical(histV.decided.effective_from);
  const histRp = k.revokeProposal(histV.partyId, histV.decided.registry_state_id, 'PERSON', histE);
  const histRs = await k.submit(hist, hist.member, 'hist-r-submit', histRp);
  const histDecideSql = k.decideSql(hist.flex, { commandId: hist.cmd('hist-cancel'), proposalId: histRs.proposal_id, proposal: histRp,
    outcome: 'REVOKE', expected: histV.decided.registry_state_id });
  await rejects(c.svc(histDecideSql), 'GV011', /REVOKE_NOT_AFTER_TARGET_EFFECTIVE/);
  assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${hist.cmd('hist-cancel')}'`), '0', 'not consumed');
  const histDigest = await k.historyDigest(hist.org);
  const surface = () => one(`select md5(string_agg(p.oid::regprocedure::text||'|'||p.prosecdef||'|'||array_to_string(p.proconfig,';')||'|'
      ||coalesce(array_to_string(p.proacl,';'),'-')||'|'||pg_get_function_result(p.oid)||'|'||p.provolatile::text, E'\\n' order by p.oid::regprocedure::text))
    from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l14\\_%'`);
  const bodiesExcept = () => one(`select md5(string_agg(p.oid::regprocedure::text||':'||p.prosrc, E'\\n' order by p.oid::regprocedure::text))
    from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l14\\_%'
      and p.oid not in ('${DECIDE}'::regprocedure, '${GUARD}'::regprocedure)`);
  const relations = () => one(`select md5(string_agg(c.relname||':'||c.relkind::text||':'||coalesce(array_to_string(c.relacl,';'),'-'), ',' order by c.relname))
    from pg_class c where c.relnamespace='gov_repo'::regnamespace and (c.relname like 'l14\\_%' or c.relname='governance_party_directory_profiles')`);
  const [surfaceBefore, bodiesBefore, relationsBefore] = [await surface(), await bodiesExcept(), await relations()];
  const decideSrcBefore = await owner(`select prosrc from pg_proc where oid='${DECIDE}'::regprocedure`);

  await c.migrate(l14GovernancePartyPendingCancelMigration);

  await t.test('O. corrective is additive: identical RPC signatures / ACLs / definer shape, only the two layers change, surface unchanged, both postflights re-execute', async () => {
    assert.equal(await surface(), surfaceBefore, 'every l14 routine keeps its exact signature, result type, volatility, definer flag, config and ACL');
    assert.equal(await bodiesExcept(), bodiesBefore, 'no other routine body changed');
    assert.equal(await relations(), relationsBefore, 'no relation / relation ACL changed');
    assert.equal(await one(`select string_agg(proname::text, ',' order by proname::text) from pg_proc
      where pronamespace='gov_repo'::regnamespace and proname like 'l14\\_%' and has_function_privilege('service_role', oid, 'EXECUTE')`),
    'l14_admit_authority_policy_version_v1,l14_admit_governance_party_v1,l14_decide_authority_policy_proposal_v1,'
      + 'l14_decide_governance_party_proposal_v1,l14_submit_governance_party_proposal_v1,l14_submit_proposal_v1');
    const after = await owner(`select prosrc from pg_proc where oid='${DECIDE}'::regprocedure`);
    const strip = (src: string) => src.replace(/\r/g, '').split('\n').filter(l => !/REVOKE_(NOT_AFTER|BEFORE)_TARGET_EFFECTIVE|p_outcome = 'REVOKE' AND|^\s*-- R1:|^\s*-- revocation strictly BEFORE/.test(l)).join('\n');
    assert.equal(strip(after), strip(decideSrcBefore), 'the decide body differs ONLY in the REVOKE interval rule');
    await owner(postflightOf(l14GovernancePartyMigration, 'M16_S1B1_POSTFLIGHT'));
    await owner(postflightOf(l14GovernancePartyPendingCancelMigration, 'M16_S1B1R1_POSTFLIGHT'));
    assert.equal(await k.historyDigest(hist.org), histDigest, 'historical S1B.1 rows untouched');
    assert.equal(await one(`select count(*) from pg_constraint where confrelid='gov_repo.canonical_relationships'::regclass
      and conrelid in (select oid from pg_class where relnamespace='gov_repo'::regnamespace and relname like 'l14\\_%')`), '0', 'F2 untouched');
  });

  await t.test('state guard and decide RPC agree exactly: equality legal, strictly-before GV011 REVOKE_BEFORE_TARGET_EFFECTIVE', async () => {
    const guard = await owner(`select prosrc from pg_proc where oid='${GUARD}'::regprocedure`);
    const decide = await owner(`select prosrc from pg_proc where oid='${DECIDE}'::regprocedure`);
    assert.match(guard, /IF NEW\.state_kind = 'REVOKED' AND v_envelope\.effective_from < v_related_from THEN\s+RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';/);
    assert.match(decide, /IF p_outcome = 'REVOKE' AND v_effective_from < v_latest_from THEN\s+RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';/);
    for (const src of [guard, decide]) {
      assert.ok(!src.includes('REVOKE_NOT_AFTER_TARGET_EFFECTIVE'));
      assert.ok(src.includes('REVALIDATION_OVERLAPS_PRIOR_INTERVAL'), 're-validation rule unchanged');
    }
    // The previously rejected historical command (same id, same fingerprint) now succeeds: no fingerprint change.
    const r = await exec(histDecideSql);
    assert.deepEqual([r.outcome, r.replay], ['REVOKED', false]);
    assert.equal(await k.canonical(r.effective_from), histE);
    // Defence in depth: the trigger alone (RPC check bypassed by a direct owner insert) enforces the same rule.
    const x = await k.setup();
    const v = await k.validated(x, 'gd');
    const rp = k.revokeProposal(v.partyId, v.decided.registry_state_id);
    const rs = await k.submit(x, x.member, 'gd-r-submit', rp);
    const decided = await k.decide(x, x.steward, 'gd-defer', rs, rp, 'DEFER');
    const E = (await envelope(v.decided.registry_state_id)).effective_from;
    const probe = (effective: string) => owner(`begin;
      insert into gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
        requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation, authority_basis, basis_authority_policy_id,
        basis_version_id, basis_content_hash, result, evaluated_at, expectation_kind, expected_current_state_id)
      select organisation_id, '00000000-0000-4000-8000-00000000a001', 'probe-cmd', repeat('a',64), actor_user_id, 'REVOKE', subject_kind, scope_tag,
        source_class, proposal_id, is_self_validation, authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash, 'ALLOW',
        evaluated_at, 'EXPECTED_CURRENT', '${v.decided.registry_state_id}'
      from gov_repo.l14_authorization_decisions where authorization_decision_id='${decided.authorization_decision_id}';
      insert into gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind, command_fingerprint, actor_user_id, outcome,
        authorization_decision_id, proposal_id, recorded_at)
      select organisation_id, 'probe-cmd', 'DECIDE_PROPOSAL', 'GOVERNANCE_PARTY', repeat('a',64), actor_user_id, 'DENIED',
        '00000000-0000-4000-8000-00000000a001', proposal_id, now() from gov_repo.l14_authorization_decisions where authorization_decision_id='${decided.authorization_decision_id}';
      insert into gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id, subject_kind, outcome, reason_code,
        authorization_decision_id, actor_user_id, support_status, decided_at)
      select organisation_id, '00000000-0000-4000-8000-00000000d001', proposal_id, 'GOVERNANCE_PARTY', 'REVOKE', 'GOVERNANCE_PARTY_REVOKED',
        '00000000-0000-4000-8000-00000000a001', actor_user_id, 'NONE', now() from gov_repo.l14_authorization_decisions where authorization_decision_id='${decided.authorization_decision_id}';
      insert into gov_repo.l14_registry_states (organisation_id, state_id, subject_kind, state_kind, predecessor_state_id, revokes_state_id, effective_from,
        recorded_at, governance_decision_id, authorization_decision_id, authority_policy_id, authority_policy_version_id, authority_policy_content_hash,
        trust_state, source_class, support_status)
      select organisation_id, '00000000-0000-4000-8000-00000000e001', 'GOVERNANCE_PARTY', 'REVOKED', '${v.decided.registry_state_id}',
        '${v.decided.registry_state_id}', ${effective}, clock_timestamp(), '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000a001',
        basis_authority_policy_id, basis_version_id, basis_content_hash, 'VALIDATED', 'LOCAL_HUMAN', 'NONE'
      from gov_repo.l14_authorization_decisions where authorization_decision_id='${decided.authorization_decision_id}';
      insert into gov_repo.l14_governance_party_states (organisation_id, state_id, state_kind, governance_party_id, party_kind, predecessor_state_id, revokes_state_id)
      values ('${x.org}', '00000000-0000-4000-8000-00000000e001', 'REVOKED', '${v.partyId}', 'PERSON', '${v.decided.registry_state_id}', '${v.decided.registry_state_id}');
      select 'guard-accepted';
      rollback;`);
    assert.match(await probe(`'${E}'::timestamptz`), /guard-accepted/, 'the trigger accepts effective_from = target effective_from');
    await rejects(probe(`'${E}'::timestamptz - interval '1 microsecond'`), 'GV011', /REVOKE_BEFORE_TARGET_EFFECTIVE/);
    assert.equal(await one(`select count(*) from gov_repo.l14_registry_states where state_id='00000000-0000-4000-8000-00000000e001'`), '0');
  });

  // ---------------------------------------------------------------------------------------
  const ctx = await k.setup();

  await t.test('A-G. pending FUTURE validation cancelled at its own instant E: tombstone appended, target byte-identical, head advanced, bitemporal matrix', async () => {
    const v = await k.validated(ctx, 'pend', 'PERSON', await k.instant('1 hour'), ctx.flex);
    const V = v.decided.registry_state_id as string;
    const E = await k.canonical(v.decided.effective_from);
    const R1 = (await envelope(V)).recorded_at as string;
    assert.equal(await k.resolve(ctx.org, v.partyId, NOW, NOW), null, 'E has not occurred yet');
    const targetBefore = await stateText(V);
    const rp = k.revokeProposal(v.partyId, V, 'PERSON', E);
    const rs = await k.submit(ctx, ctx.member, 'pend-r-submit', rp);
    const r = await exec(k.decideSql(ctx.flex, { commandId: ctx.cmd('pend-cancel'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE', expected: V }));
    assert.deepEqual([r.outcome, r.state_kind, r.governance_party_id], ['REVOKED', 'REVOKED', v.partyId]);
    const tomb = await envelope(r.registry_state_id);
    assert.equal(await k.canonical(tomb.effective_from), E, 'the tombstone is effective exactly at E (no 1 µs artificial validity)');
    assert.deepEqual([tomb.revokes_state_id, tomb.predecessor_state_id], [V, V]);
    const R2 = tomb.recorded_at as string;
    assert.ok(Date.parse(R2) > Date.parse(R1));
    assert.equal(await one(`select requested_action from gov_repo.l14_authorization_decisions where authorization_decision_id='${r.authorization_decision_id}'`), 'REVOKE');
    assert.equal(await stateText(V), targetBefore, 'B. the target row is byte-identical');
    assert.equal((await k.head(ctx.org, v.partyId))!.latest_state_id, r.registry_state_id, 'C. head advanced to the tombstone');
    const matrix: Array<[string, string, string | null, string]> = [
      [ts(E), ts(R2, '-1 microsecond'), V, 'D. cutoff before the tombstone: original knowledge visible at E'],
      [ts(E, '1 hour'), ts(R2, '-1 microsecond'), V, 'D. ... and after E'],
      [ts(E), ts(R2), null, 'E. cutoff at the tombstone: cancelled from E'],
      [ts(E, '1 hour'), NOW, null, 'E. ... and after E'],
      [ts(E), NOW, null, 'F. no artificial validity exactly at E'],
      [ts(E, '-1 microsecond'), ts(R2, '-1 microsecond'), null, 'G. before E: never valid (old knowledge)'],
      [ts(E, '-1 microsecond'), NOW, null, 'G. before E: never valid (current knowledge)'],
      [ts(E), ts(R1, '-1 microsecond'), null, 'before the validation was even recorded'],
    ];
    for (const [business, cutoff, expected, label] of matrix) assert.equal(await k.resolve(ctx.org, v.partyId, business, cutoff), expected, label);
    // M. replay of the successful equal-E REVOKE.
    const before = await k.counts(ctx.org);
    const replay = await exec(k.decideSql(ctx.flex, { commandId: ctx.cmd('pend-cancel'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE', expected: V }));
    assert.equal(replay.replay, true);
    assert.deepEqual({ ...replay, replay: false }, r, 'M. the ORIGINAL durable REVOKE result');
    assert.deepEqual(await k.counts(ctx.org), before);
    // Pending cancellation needs the future-dating grant: the steward (no flags) gets a durable DENY.
    const w = await k.validated(ctx, 'pend-w', 'PERSON', await k.instant('1 hour'), ctx.flex);
    const wE = await k.canonical(w.decided.effective_from);
    const wp = k.revokeProposal(w.partyId, w.decided.registry_state_id, 'PERSON', wE);
    const ws = await k.submit(ctx, ctx.member, 'pend-w-r-submit', wp);
    const denied = await exec(k.decideSql(ctx.steward, { commandId: ctx.cmd('pend-w-steward'), proposalId: ws.proposal_id, proposal: wp, outcome: 'REVOKE',
      expected: w.decided.registry_state_id }));
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED']);
  });

  let backdated = { partyId: '', V1: '', E: '', tomb: '', R2: '' };
  await t.test('H. already-effective VALIDATED at E, later BACKDATED REVOKE at exactly E with allow_backdating: appended; earlier cutoffs keep the original knowledge', async () => {
    const v = await k.validated(ctx, 'bk');
    const V = v.decided.registry_state_id as string;
    const E = await k.canonical(v.decided.effective_from);
    await one(`select pg_sleep(0.01)`);
    assert.equal(await k.resolve(ctx.org, v.partyId, NOW, NOW), V, 'already effective');
    const targetBefore = await stateText(V);
    const rp = k.revokeProposal(v.partyId, V, 'PERSON', E);
    const rs = await k.submit(ctx, ctx.member, 'bk-r-submit', rp);
    const r = await exec(k.decideSql(ctx.flex, { commandId: ctx.cmd('bk-revoke'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE', expected: V }));
    assert.equal(r.outcome, 'REVOKED');
    assert.equal(await one(`select bool_and(allow_backdating)::text from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${r.authorization_decision_id}'`),
      'true', 'authorized by the matched rule\'s backdating grant');
    const tomb = await envelope(r.registry_state_id);
    assert.equal(await k.canonical(tomb.effective_from), E);
    assert.equal(await stateText(V), targetBefore);
    const R2 = tomb.recorded_at as string;
    for (const [business, cutoff, expected, label] of [
      [ts(E), ts(R2, '-1 microsecond'), V, 'earlier cutoff: valid from E as then known'],
      [NOW, ts(R2, '-1 microsecond'), V, 'earlier cutoff: still valid now as then known'],
      [ts(E), NOW, null, 'current knowledge: revoked from E'],
      [NOW, NOW, null, 'current knowledge: not valid now'],
    ] as Array<[string, string, string | null, string]>) {
      assert.equal(await k.resolve(ctx.org, v.partyId, business, cutoff), expected, label);
    }
    backdated = { partyId: v.partyId, V1: V, E, tomb: r.registry_state_id, R2 };
  });

  await t.test('I. the same backdated equal-E REVOKE without allow_backdating: durable DENY TEMPORAL_ACTION_NOT_AUTHORIZED; no tombstone', async () => {
    const v = await k.validated(ctx, 'nb');
    const V = v.decided.registry_state_id as string;
    const E = await k.canonical(v.decided.effective_from);
    await one(`select pg_sleep(0.01)`);
    const rp = k.revokeProposal(v.partyId, V, 'PERSON', E);
    const rs = await k.submit(ctx, ctx.member, 'nb-r-submit', rp);
    const before = await k.counts(ctx.org);
    const r = await exec(k.decideSql(ctx.steward, { commandId: ctx.cmd('nb-revoke'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE', expected: V }));
    assert.deepEqual([r.outcome, r.deny_reason, r.registry_state_id, r.governance_decision_id], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED', null, null]);
    const after = await k.counts(ctx.org);
    for (const table of ['l14_registry_states', 'l14_governance_party_states', 'l14_governance_decisions']) assert.equal(after[table], before[table], table);
    assert.equal((await k.head(ctx.org, v.partyId))!.latest_state_id, V);
    assert.equal(await k.resolve(ctx.org, v.partyId, NOW, NOW), V);
  });

  await t.test('J-K. re-validation of the same Party at exactly E after the equal-E tombstone: unique resolver result, lineage VALIDATED → REVOKED → VALIDATED', async () => {
    const { partyId, V1, E, tomb, R2 } = backdated;
    const vp = k.validateProposal(partyId, 'PERSON', E);
    const vs = await k.submit(ctx, ctx.member, 'bk-v2-submit', vp);
    const v2 = await exec(k.decideSql(ctx.flex, { commandId: ctx.cmd('bk-v2'), proposalId: vs.proposal_id, proposal: vp, expected: tomb }));
    assert.deepEqual([v2.outcome, v2.governance_party_id], ['VALIDATED', partyId]);
    assert.equal(await k.canonical(v2.effective_from), E);
    const env = await envelope(v2.registry_state_id);
    assert.equal(env.predecessor_state_id, tomb);
    const R3 = env.recorded_at as string;
    assert.equal(await one(`select string_agg(s.state_kind, '>' order by s.recorded_at) from gov_repo.l14_registry_states s
      join gov_repo.l14_governance_party_states d using (organisation_id, state_id) where d.governance_party_id='${partyId}'`), 'VALIDATED>REVOKED>VALIDATED');
    for (const [business, cutoff, expected, label] of [
      [ts(E), NOW, v2.registry_state_id, 'final cutoff at E: the NEW state, the old one excluded'],
      [NOW, NOW, v2.registry_state_id, 'final cutoff now'],
      [ts(E, '-1 microsecond'), NOW, null, 'before E: nothing'],
      [ts(E), ts(R3, '-1 microsecond'), null, 'between tombstone and re-validation knowledge'],
      [ts(E), ts(R2, '-1 microsecond'), V1, 'before the tombstone knowledge: the original'],
    ] as Array<[string, string, string | null, string]>) {
      assert.equal(await k.resolve(ctx.org, partyId, business, cutoff), expected, label);
    }
    // K. uniqueness: exactly one raw candidate at the final cutoff (no ambiguity to fail closed on).
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_party_valid_state_v1('${ctx.org}','${partyId}',${ts(E)},${NOW})`), '1');
    assert.equal(await one(`select count(*) from gov_repo.l14_registry_states s join gov_repo.l14_governance_party_states d using (organisation_id, state_id)
      where d.governance_party_id='${partyId}' and s.state_kind='VALIDATED' and s.effective_from <= ${ts(E)}
        and not exists (select 1 from gov_repo.l14_registry_states r where r.revokes_state_id=s.state_id and r.effective_from <= ${ts(E)})`), '1');
  });

  await t.test('L. a REVOKE strictly BEFORE the target effective_from is still GV011 (1 µs), and consumes nothing', async () => {
    const v = await k.validated(ctx, 'sb', 'GROUP', await k.instant('1 hour'), ctx.flex);
    const E = await k.canonical(v.decided.effective_from);
    const rp = k.revokeProposal(v.partyId, v.decided.registry_state_id, 'GROUP', await shift(E, '-1 microsecond'));
    const rs = await k.submit(ctx, ctx.member, 'sb-r-submit', rp);
    const before = await k.counts(ctx.org);
    await rejects(c.svc(k.decideSql(ctx.flex, { commandId: ctx.cmd('sb-revoke'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE',
      expected: v.decided.registry_state_id })), 'GV011', /REVOKE_BEFORE_TARGET_EFFECTIVE/);
    assert.deepEqual(await k.counts(ctx.org), before);
    assert.equal((await k.head(ctx.org, v.partyId))!.latest_state_id, v.decided.registry_state_id);
  });

  await t.test('N. concurrent equal-E cancellations of one pending state linearize: one tombstone; the loser GV009 and not consumed', async () => {
    const monitor = c.session('m16_bootstrap');
    const s1 = c.session('service_role'), s2 = c.session('service_role');
    try {
      const v = await k.validated(ctx, 'cc', 'PERSON', await k.instant('1 hour'), ctx.flex);
      const V = v.decided.registry_state_id as string;
      const E = await k.canonical(v.decided.effective_from);
      const rp = k.revokeProposal(v.partyId, V, 'PERSON', E);
      const [ra, rb] = [await k.submit(ctx, ctx.member, 'cc-ra', rp), await k.submit(ctx, ctx.member, 'cc-rb', rp)];
      const pid = async (s: typeof s1) => (await s.run('select pg_backend_pid();')).out.trim();
      const [p1, p2] = [await pid(s1), await pid(s2)];
      await s1.run('begin;');
      const first = await s1.run(k.decideSql(ctx.flex, { commandId: ctx.cmd('cc-a'), proposalId: ra.proposal_id, proposal: rp, outcome: 'REVOKE', expected: V }));
      assert.equal(first.err, '', first.err);
      const pending = s2.run(k.decideSql(ctx.flex, { commandId: ctx.cmd('cc-b'), proposalId: rb.proposal_id, proposal: rp, outcome: 'REVOKE', expected: V }));
      let blocked = false;
      for (let i = 0; i < 1000 && !blocked; i++) {
        blocked = (await monitor.run(`select coalesce((select wait_event_type from pg_stat_activity where pid=${p2}),'')||':'||(pg_blocking_pids(${p2}) @> array[${p1}])::text;`)).out.trim() === 'Lock:true';
        if (!blocked) await sleep(20);
      }
      assert.ok(blocked, 'the second cancellation waited on the first (registry subject guard)');
      await s1.run('commit;');
      const second = await pending;
      assert.equal(JSON.parse(lastLine(first.out)).outcome, 'REVOKED');
      assert.match(second.err, /GV009/, second.err);
      assert.equal(await one(`select count(*) from gov_repo.l14_registry_states where revokes_state_id='${V}'`), '1');
      assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${ctx.cmd('cc-b')}'`), '0');
    } finally { await Promise.all([s1.close(), s2.close(), monitor.close()]); }
  });
});
