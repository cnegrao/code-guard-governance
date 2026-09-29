import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { successorKit } from '../helpers/m16-l14-successor-fixtures';

/**
 * M16-S1A.2R1 — no-resurrection corrective (adversarial finding F-1 BLOCKER, F-2 LOW) on real
 * disposable PostgreSQL 17. A backdated REVOKE must never erase an already-effective version's
 * reign and hand authority back to a superseded predecessor; only a successor still PENDING when
 * the tombstone is recorded can be cancelled. Every rejection is zero-residue and consumes no
 * command. Chain: broad grants → governance chain → S0 → S1A.1 → S1A.2 → S1A.2R1.
 */
test('M16 S1A.2R1 L14 Authority Policy no-resurrection (disposable PG17)', { timeout: 900_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message));
  t.after(() => c.stop());
  const k = await successorKit(c);
  const { owner, exec, counts, rejects } = c;
  const all = { validate: { allowBackdating: true, allowFutureDating: true }, revoke: { allowBackdating: true, allowFutureDating: true } };
  const shift = (ts: string, delta: string) => owner(
    `select to_char(('${ts}'::timestamptz + interval '${delta}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
  const commandCount = (org: string, command: string) => owner(
    `select (select count(*) from gov_repo.l14_command_results where organisation_id='${org}' and command_id='${command}')
          + (select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${org}' and command_id='${command}')`);

  /** v1 effective at E1, then v2 immediately effective at E2 (E1 < E2 < now); both grant every flag. */
  async function twoReigns() {
    const ctx = await k.setup(k.opsRules(0, all));
    await sleep(50);
    const { decided: s2, admitted: v2 } = await k.successor(ctx, 'reign2', k.opsRules(1, all));
    await sleep(50);
    return { ctx, s2, v2, s1: await k.state(ctx.org, ctx.s1.state_id), s2Row: await k.state(ctx.org, s2.state_id) };
  }
  /** Attempt a REVOKE that must fail GV011 with the given DETAIL and leave no residue at all. */
  async function rejectedRevoke(ctx: Awaited<ReturnType<typeof k.setup>>, target: any, requested: string | null, name: string, detail: RegExp) {
    const proposal = k.revokeProposal(target, requested);
    const submitted = await k.submit(ctx, ctx.member, `${name}-submit`, proposal);
    const head = await k.head(ctx.org);
    const before = await counts(ctx.org);
    const nowBefore = await k.resolve(ctx.org, 'clock_timestamp()', 'clock_timestamp()');
    const command = ctx.cmd(name);
    await rejects(c.svc(k.decideSqlFor(ctx, ctx.ops, command, submitted.proposal_id, proposal, 'REVOKE', head.latest_state_id)), 'GV011', detail);
    assert.deepEqual(await counts(ctx.org), before, 'zero residue: no authorization, decision, tombstone or result');
    assert.equal(await commandCount(ctx.org, command), '0', 'the command id was not consumed');
    assert.deepEqual(await k.head(ctx.org), head, 'no head movement');
    assert.equal(await k.resolve(ctx.org, 'clock_timestamp()', 'clock_timestamp()'), nowBefore, 'resolver unchanged');
    // The same command id is still free: reuse it for a different, legitimate command (DEFER).
    const reused = await exec(k.decideSqlFor(ctx, ctx.ops, command, submitted.proposal_id, proposal, 'DEFER', head.latest_state_id));
    assert.equal(reused.outcome, 'DEFERRED');
    assert.equal(reused.replay, false);
    return { proposal, submitted };
  }

  await t.test('A: already-effective current v2, backdated REVOKE R < E2 (allow_backdating) → GV011 BACKDATED_REVOKE_WOULD_RESURRECT; v1 never resurrects', async () => {
    const { ctx, s2Row, v2 } = await twoReigns();
    assert.equal(await k.resolve(ctx.org, 'clock_timestamp()', 'clock_timestamp()'), v2.version_id, 'before: v2 current');
    const R = await shift(s2Row.effective_from, '-1 microsecond');
    await rejectedRevoke(ctx, s2Row, R, 'a-revoke', /BACKDATED_REVOKE_WOULD_RESURRECT/);
    assert.equal(await k.resolve(ctx.org, 'clock_timestamp()', 'clock_timestamp()'), v2.version_id, 'after: v2 still current');
    assert.equal(await k.resolve(ctx.org, `'${s2Row.effective_from}'::timestamptz`, 'clock_timestamp()'), v2.version_id);
    assert.equal(await k.resolve(ctx.org, `'${R}'::timestamptz`, 'clock_timestamp()'), ctx.v1.version_id, 'v1 history before E2 untouched');
    assert.equal(await owner(`select count(*) from gov_repo.l14_authority_policy_states where organisation_id='${ctx.org}' and state_kind='REVOKED'`), '0');
  });

  await t.test('B: already-effective current v2, REVOKE R = E2 → GV011 BACKDATED_REVOKE_WOULD_RESURRECT; zero residue', async () => {
    const { ctx, s2Row, v2 } = await twoReigns();
    await rejectedRevoke(ctx, s2Row, await k.canonical(s2Row.effective_from), 'b-revoke', /BACKDATED_REVOKE_WOULD_RESURRECT/);
    assert.equal(await k.resolve(ctx.org, 'clock_timestamp()', 'clock_timestamp()'), v2.version_id);
  });

  await t.test('C: already-effective current v2, E2 < R < now with no successor → GV011 NO_EFFECTIVE_AUTHORITY_AT_CUTOVER; no fallback to v1', async () => {
    const { ctx, s2Row, v2 } = await twoReigns();
    const R = await shift(s2Row.effective_from, '1 microsecond');
    await rejectedRevoke(ctx, s2Row, R, 'c-revoke', /NO_EFFECTIVE_AUTHORITY_AT_CUTOVER/);
    await rejectedRevoke(ctx, s2Row, null, 'c-revoke-now', /NO_EFFECTIVE_AUTHORITY_AT_CUTOVER/);
    for (const at of [`'${R}'::timestamptz`, 'clock_timestamp()', `clock_timestamp() + interval '1 day'`]) {
      assert.equal(await k.resolve(ctx.org, at, `clock_timestamp() + interval '2 days'`), v2.version_id, `no fallback at ${at}`);
    }
  });

  await t.test('D: pending successor cancellation (R = now and R = E2) still succeeds; later knowledge only after the tombstone', async () => {
    for (const variant of ['now', 'at-E2'] as const) {
      const ctx = await k.setup(k.opsRules(0, all));
      const E2 = await k.instant('2 hours');
      const { decided: s2, admitted: v2 } = await k.successor(ctx, `d-${variant}`, k.opsRules(1, all), E2);
      const target = await k.state(ctx.org, s2.state_id);
      const rp = k.revokeProposal(target, variant === 'now' ? null : E2);
      const rs = await k.submit(ctx, ctx.member, `d-${variant}-rv-submit`, rp);
      const tomb = await k.decide(ctx, ctx.ops, `d-${variant}-rv`, rs, rp, 'REVOKE');
      assert.equal(tomb.outcome, 'REVOKED', variant);
      const later = `'${E2}'::timestamptz + interval '1 hour'`;
      assert.equal(await k.resolve(ctx.org, 'clock_timestamp()', 'clock_timestamp()'), ctx.v1.version_id, 'v1 remains current');
      assert.equal(await k.resolve(ctx.org, later, `${later} + interval '1 day'`), ctx.v1.version_id, 'cancelled v2 never effective after the tombstone');
      assert.equal(await k.resolve(ctx.org, later, `'${tomb.recorded_at}'::timestamptz - interval '1 microsecond'`), v2.version_id,
        'recorded cutoff before the tombstone keeps the prior knowledge');
      assert.equal(await k.resolve(ctx.org, later, `'${tomb.recorded_at}'::timestamptz`), ctx.v1.version_id, 'knowledge changes exactly at tombstone.recorded_at');
    }
  });

  await t.test('E: current v1 + VALIDATED future successor: REVOKE v1 at T succeeds; v1 before T, v2 from T, no gap', async () => {
    const ctx = await k.setup(k.opsRules(0, all));
    const T = await k.instant('2 hours');
    const { admitted: v2 } = await k.successor(ctx, 'e', k.opsRules(1, all), T);
    const rp = k.revokeProposal(await k.state(ctx.org, ctx.s1.state_id), T);
    const rs = await k.submit(ctx, ctx.member, 'e-rv-submit', rp);
    const tomb = await k.decide(ctx, ctx.ops, 'e-rv', rs, rp, 'REVOKE');
    assert.equal(tomb.outcome, 'REVOKED');
    const cutoff = `'${T}'::timestamptz + interval '1 day'`;
    assert.equal(await k.resolve(ctx.org, `'${T}'::timestamptz - interval '1 microsecond'`, cutoff), ctx.v1.version_id);
    assert.equal(await k.resolve(ctx.org, `'${T}'::timestamptz`, cutoff), v2.version_id);
    assert.equal(await k.resolve(ctx.org, `'${T}'::timestamptz + interval '1 year'`, cutoff), v2.version_id, 'no resurrection of v1 later');
  });

  await t.test('F: superseded predecessor v1 — revoke inside its reign → GV011; at/before its start → GV011; after v2 owns → allowed; v1 never current again', async () => {
    const { ctx, s1, s2Row, v2 } = await twoReigns();
    const inside = await shift(s1.effective_from, '1 microsecond');
    await rejectedRevoke(ctx, s1, inside, 'f-inside', /NO_EFFECTIVE_AUTHORITY_AT_CUTOVER/);
    await rejectedRevoke(ctx, s1, await k.canonical(s1.effective_from), 'f-at-start', /BACKDATED_REVOKE_WOULD_RESURRECT/);
    await rejectedRevoke(ctx, s1, await shift(s1.effective_from, '-1 second'), 'f-before', /BACKDATED_REVOKE_WOULD_RESURRECT/);
    const rp = k.revokeProposal(s1, await k.canonical(s2Row.effective_from));
    const rs = await k.submit(ctx, ctx.member, 'f-at-e2-submit', rp);
    const tomb = await k.decide(ctx, ctx.ops, 'f-at-e2', rs, rp, 'REVOKE');
    assert.equal(tomb.outcome, 'REVOKED', 'revocation at the instant v2 took over keeps continuity');
    assert.equal(await k.resolve(ctx.org, 'clock_timestamp()', 'clock_timestamp()'), v2.version_id);
    assert.equal(await k.resolve(ctx.org, `'${inside}'::timestamptz`, 'clock_timestamp()'), ctx.v1.version_id, 'v1 historical reign preserved, not erased');
    // With v1 revoked and v2 current, revoking v2 now must not resurrect v1.
    await rejectedRevoke(ctx, s2Row, null, 'f-v2-now', /NO_EFFECTIVE_AUTHORITY_AT_CUTOVER/);
  });

  await t.test('F-2: reusing a cancelled state\'s VALIDATED instant → closed GV011 EFFECTIVE_INSTANT_ALREADY_USED, never raw 23505', async () => {
    const ctx = await k.setup(k.opsRules(0, all));
    const E2 = await k.instant('2 hours');
    const { decided: s2 } = await k.successor(ctx, 'f2', k.opsRules(1, all), E2);
    const rp = k.revokeProposal(await k.state(ctx.org, s2.state_id));
    const rs = await k.submit(ctx, ctx.member, 'f2-revoke-submit', rp);
    const tomb = await k.decide(ctx, ctx.ops, 'f2-revoke', rs, rp, 'REVOKE');
    const v3 = await k.admitNext(ctx, ctx.ops, 'f2-v3', k.opsRules(2, all));
    const p3 = k.validateProposal(v3, E2);
    const s3 = await k.submit(ctx, ctx.member, 'f2-s3', p3);
    const before = await counts(ctx.org);
    await assert.rejects(c.svc(k.decideSqlFor(ctx, ctx.ops, ctx.cmd('f2-v3-validate'), s3.proposal_id, p3, 'VALIDATE', tomb.state_id)), (error: Error) => {
      assert.match(error.message, /GV011[\s\S]*EFFECTIVE_INSTANT_ALREADY_USED/);
      assert.doesNotMatch(error.message, /23505/);
      return true;
    });
    assert.deepEqual(await counts(ctx.org), before);
    assert.equal(await commandCount(ctx.org, ctx.cmd('f2-v3-validate')), '0');
  });

  await t.test('atomicity: a revocation waiting on a concurrent pending-successor cancellation re-evaluates continuity on the committed state', async () => {
    const ctx = await k.setup(k.opsRules(0, all));
    const T = await k.instant('2 hours');
    const { decided: s2 } = await k.successor(ctx, 'at', k.opsRules(1, all), T);
    const cancel = k.revokeProposal(await k.state(ctx.org, s2.state_id));
    const cs = await k.submit(ctx, ctx.member, 'at-cancel-submit', cancel);
    const cutover = k.revokeProposal(await k.state(ctx.org, ctx.s1.state_id), T);
    const us = await k.submit(ctx, ctx.member, 'at-cutover-submit', cutover);
    const monitor = c.session('m16_bootstrap'), s1 = c.session('service_role'), s2s = c.session('service_role');
    try {
      await s1.run('begin;');
      const first = await s1.run(k.decideSqlFor(ctx, ctx.ops, ctx.cmd('at-cancel'), cs.proposal_id, cancel, 'REVOKE', s2.state_id));
      assert.equal(first.err, '', first.err);
      const [p1, p2] = [(await s1.run('select pg_backend_pid();')).out.trim(), (await s2s.run('select pg_backend_pid();')).out.trim()];
      const pending = s2s.run(k.decideSqlFor(ctx, ctx.ops2, ctx.cmd('at-cutover'), us.proposal_id, cutover, 'REVOKE', s2.state_id));
      for (let i = 0; ; i++) {
        const state = (await monitor.run(`select coalesce((select wait_event_type from pg_stat_activity where pid=${p2}),'')||':'||(pg_blocking_pids(${p2}) @> array[${p1}])::text;`)).out.trim();
        if (state === 'Lock:true') break;
        assert.ok(i < 1000, 'cutover revoke never blocked on the guard');
        await sleep(20);
      }
      await s1.run('commit;');
      const second = await pending;
      assert.match(second.err, /GV009/, 'the stale expectation fails after the concurrent cancellation committed');
    } finally { await Promise.all([monitor.close(), s1.close(), s2s.close()]); }
    const head = await k.head(ctx.org);
    const before = await counts(ctx.org);
    await rejects(c.svc(k.decideSqlFor(ctx, ctx.ops2, ctx.cmd('at-cutover-2'), us.proposal_id, cutover, 'REVOKE', head.latest_state_id)), 'GV011',
      /NO_EFFECTIVE_AUTHORITY_AT_CUTOVER/);
    assert.deepEqual(await counts(ctx.org), before, 'with the successor cancelled, revoking v1 would leave a gap; nothing written');
    assert.equal(await k.resolve(ctx.org, `'${T}'::timestamptz + interval '1 day'`, `'${T}'::timestamptz + interval '2 days'`), ctx.v1.version_id);
  });

  await t.test('corrective catalog: v1 helper dropped, v2 owner-only invoker, exactly three service_role RPCs, postflight re-executes', async () => {
    assert.equal(await owner(`select to_regprocedure('gov_repo.l14_authority_policy_schedule_continuous_v1(uuid,text,uuid,timestamptz,uuid)') is null`), 't');
    const v2sig = `'gov_repo.l14_authority_policy_schedule_continuous_v2(uuid,text,uuid,timestamptz,timestamptz,uuid)'::regprocedure`;
    assert.equal(await owner(`select prosecdef from pg_proc where oid=${v2sig}`), 'f');
    for (const role of ['service_role', 'anon', 'authenticated']) {
      assert.equal(await owner(`select has_function_privilege('${role}', ${v2sig}, 'EXECUTE')`), 'f', role);
    }
    assert.equal(await owner(`select string_agg(proname::text || '(' || pg_get_function_identity_arguments(oid) || ')', ' | ' order by proname)
      from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l14\\_%' and has_function_privilege('service_role', oid, 'EXECUTE')`),
      'l14_admit_authority_policy_version_v1(p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint, p_verified_credential_epoch timestamp with time zone, p_command_id text, p_expected_authority_policy_id uuid, p_expected_latest_version_id uuid, p_source_class text, p_rules jsonb, p_support_status text, p_support_evidence_ids text[], p_caller_fingerprint text)'
      + ' | l14_decide_authority_policy_proposal_v1(p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint, p_verified_credential_epoch timestamp with time zone, p_command_id text, p_proposal_id uuid, p_outcome text, p_reason_code text, p_expected_current_state_id uuid, p_support_status text, p_support_evidence_ids text[], p_caller_fingerprint text)'
      + ' | l14_submit_proposal_v1(p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint, p_verified_credential_epoch timestamp with time zone, p_command_id text, p_subject_kind text, p_intent text, p_source_class text, p_authority_policy_id uuid, p_version_id uuid, p_content_hash text, p_requested_effective_from timestamp with time zone, p_target_state_id uuid, p_prior_proposal_id uuid, p_support_status text, p_support_evidence_ids text[], p_caller_fingerprint text)');
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const text = readFileSync(fileURLToPath(new URL('../../../../supabase/migrations/20260929140000_m16_s1a2r1_l14_no_resurrection_v1.sql', import.meta.url)), 'utf8');
    await owner(text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length));
    assert.equal(lastLine(await owner(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like '%\\_governed\\_v1'`)), '6');
  });
});
