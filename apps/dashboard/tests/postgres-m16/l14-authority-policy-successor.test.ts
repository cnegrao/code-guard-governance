import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine, rule } from '../helpers/m16-l14-fixtures';
import { successorKit } from '../helpers/m16-l14-successor-fixtures';

/**
 * M16-S1A.2 — Authority Policy successor lifecycle on real disposable PostgreSQL 17:
 * effective-policy evaluation, successor ADMIT/VALIDATE/REJECT/DEFER/REVOKE, temporal flags,
 * continuity (no gap / no overlap / no resurrection), bitemporal readback, durable DENY and
 * replay. Chain: broad legacy grants → governance chain → all S0 → S1A.1 → S1A.2.
 */
test('M16 S1A.2 L14 Authority Policy successor lifecycle (disposable PG17)', { timeout: 900_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message));
  t.after(() => c.stop());
  const k = await successorKit(c);
  const { owner, exec, rejects, counts, adminRole, memberRole } = c;
  const authz = async (org: string, id: string) => JSON.parse(lastLine(await owner(
    `select to_json(a) from gov_repo.l14_authorization_decisions a where organisation_id='${org}' and authorization_decision_id='${id}'`)));
  const snapshotRules = async (org: string, id: string) => JSON.parse((await owner(`select coalesce(json_agg(r order by snapshot_ordinal), '[]')::text
    from gov_repo.l14_authorization_decision_rules r where organisation_id='${org}' and authorization_decision_id='${id}'`)).replace(/\r?\n/g, ' ')) as any[];
  const storedHash = (org: string, policy: string, version: string) =>
    owner(`select gov_repo.l14_stored_authority_policy_content_hash_v1('${org}','${policy}','${version}')`);

  // ---------------------------------------------------------------------------------------
  await t.test('precondition A: action-sensitive self-basis — ADMIT/VALIDATE basis=subject rejected; REVOKE/REJECT/DEFER allowed', async () => {
    const ctx = await k.setup();
    const v1 = ctx.v1;
    const insert = (action: string) => owner(`begin;
      insert into gov_repo.l14_authorization_decisions(organisation_id,authorization_decision_id,command_id,command_fingerprint,actor_user_id,
        requested_action,subject_kind,scope_tag,source_class,subject_authority_policy_id,subject_version_id,authority_basis,
        basis_authority_policy_id,basis_version_id,basis_content_hash,result,deny_reason,evaluated_at)
      values('${ctx.org}',gen_random_uuid(),'probe-${action}',repeat('a',64),'${ctx.ops.id}','${action}','AUTHORITY_POLICY_VERSION',
        'ALL_ALLOWED_TARGETS','LOCAL_HUMAN','${v1.authority_policy_id}','${v1.version_id}','AUTHORITY_POLICY_VERSION',
        '${v1.authority_policy_id}','${v1.version_id}','${v1.content_hash}','ALLOW',null,now());
      rollback;`);
    for (const action of ['ADMIT', 'VALIDATE']) await rejects(insert(action), '23514', /l14_authorization_decisions_no_self_basis_check/);
    for (const action of ['REJECT', 'DEFER', 'REVOKE']) await insert(action);
    const stateCheck = await owner(`select pg_get_constraintdef(oid) from pg_constraint where conname='l14_authority_policy_states_no_self_basis_check'`);
    assert.match(stateCheck, /state_kind = 'REVOKED'/);
  });

  await t.test('precondition B: NULL basis only for DENY NO_EFFECTIVE_AUTHORITY; never for ALLOW or any other DENY', async () => {
    const ctx = await k.setup();
    const probe = (result: string, reason: string | null, basis: string) => owner(`begin;
      insert into gov_repo.l14_authorization_decisions(organisation_id,authorization_decision_id,command_id,command_fingerprint,actor_user_id,
        requested_action,subject_kind,scope_tag,source_class,authority_basis,result,deny_reason,evaluated_at)
      values('${ctx.org}',gen_random_uuid(),'probe',repeat('a',64),'${ctx.ops.id}','ADMIT','AUTHORITY_POLICY_VERSION',
        'ALL_ALLOWED_TARGETS','LOCAL_HUMAN',${basis},'${result}',${reason ? `'${reason}'` : 'null'},now());
      rollback;`);
    await probe('DENY', 'NO_EFFECTIVE_AUTHORITY', 'null');
    await rejects(probe('ALLOW', null, 'null'), '23514', /basis_shape_check/);
    await rejects(probe('DENY', 'NO_MATCHING_AUTHORITY_RULE', 'null'), '23514', /basis_shape_check/);
    await rejects(probe('DENY', 'NO_EFFECTIVE_AUTHORITY', `'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1'`), '23514', /no_effective_basis_check/);
  });

  await t.test('state uniqueness indexes: one VALIDATED per version, one tombstone per target, no equal VALIDATED instant', async () => {
    const defs = (await owner(`select string_agg(indexdef, E'\\n' order by indexname) from pg_indexes where schemaname='gov_repo'
      and indexname in ('l14_authority_policy_states_validated_version_uidx','l14_authority_policy_states_revocation_target_uidx',
        'l14_authority_policy_states_validated_instant_uidx')`)).replace(/\r/g, '');
    assert.match(defs, /UNIQUE INDEX l14_authority_policy_states_revocation_target_uidx .*\(organisation_id, revokes_state_id\) WHERE \(state_kind = 'REVOKED'/);
    assert.match(defs, /UNIQUE INDEX l14_authority_policy_states_validated_instant_uidx .*\(organisation_id, effective_from\) WHERE \(state_kind = 'VALIDATED'/);
    assert.match(defs, /UNIQUE INDEX l14_authority_policy_states_validated_version_uidx .*\(organisation_id, version_id\) WHERE \(state_kind = 'VALIDATED'/);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('successor ADMIT ALLOW: current effective v1 authorizes v2; exact basis + recomputed hash + rule snapshot; no decision/state', async () => {
    const ctx = await k.setup();
    const before = await counts(ctx.org);
    const v2 = await k.admitNext(ctx, ctx.ops, 'v2', k.opsRules(1));
    assert.equal(v2.outcome, 'ADMITTED');
    assert.equal(v2.governance_decision_id, null);
    assert.equal(v2.state_id, null);
    const version = JSON.parse(lastLine(await owner(`select to_json(v) from gov_repo.l14_authority_policy_versions v where version_id='${v2.version_id}'`)));
    assert.equal(version.version_number, 2);
    assert.equal(version.predecessor_version_id, ctx.v1.version_id);
    assert.equal((await k.head(ctx.org)).latest_version_id, v2.version_id);
    const a = await authz(ctx.org, v2.authorization_decision_id);
    assert.equal(a.authority_basis, 'AUTHORITY_POLICY_VERSION');
    assert.equal(a.basis_version_id, ctx.v1.version_id);
    assert.equal(a.basis_content_hash, await storedHash(ctx.org, ctx.v1.authority_policy_id, ctx.v1.version_id), 'basis hash = recomputation');
    assert.equal(a.subject_version_id, v2.version_id);
    const snap = await snapshotRules(ctx.org, v2.authorization_decision_id);
    assert.deepEqual(snap.map(r => [r.permission_origin, r.permission, r.requested_action, r.source_disposition, r.basis_version_id]),
      [['AUTHORITY_POLICY_RULE', 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT', 'AUTHORITATIVE', ctx.v1.version_id]]);
    const after = await counts(ctx.org);
    assert.equal(after.l14_governance_decisions, before.l14_governance_decisions);
    assert.equal(after.l14_authority_policy_states, before.l14_authority_policy_states);
  });

  await t.test('successor ADMIT DENY: NO_EFFECTIVE_AUTHORITY (explicit NULL basis, durable, replayable)', async () => {
    const org = await c.newOrg();
    const boot = await c.mkUser(org, [adminRole, k.opsRole]);
    const v1 = await exec(c.admitSql(boot, { commandId: 'nea-v1', rules: k.opsRules() })); // admitted, never validated
    const sql = c.admitSql(boot, { commandId: 'nea-v2', rules: k.opsRules(3),
      expected: { authorityPolicyId: v1.authority_policy_id, latestVersionId: v1.version_id } });
    const denied = await exec(sql);
    assert.equal(denied.deny_reason, 'NO_EFFECTIVE_AUTHORITY');
    const a = await authz(org, denied.authorization_decision_id);
    assert.deepEqual([a.authority_basis, a.basis_authority_policy_id, a.basis_version_id, a.basis_content_hash], [null, null, null, null]);
    assert.equal((await snapshotRules(org, denied.authorization_decision_id)).length, 0);
    assert.equal((await counts(org)).l14_authority_policy_versions, 1);
    const replay = await exec(sql);
    assert.deepEqual({ ...replay, replay: false }, denied);
  });

  await t.test('successor ADMIT DENY: NO_MATCHING_AUTHORITY_RULE; SOURCE_NOT_AUTHORIZED (contributing / non-authoritative / other source / contradictory key)', async () => {
    const ctx = await k.setup();
    const noRule = await k.admitNext(ctx, ctx.member, 'm-admit', k.opsRules(2));
    assert.equal(noRule.deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
    const variants: Array<[string, Parameters<typeof rule>[3][]]> = [
      ['contributing', [{ sourceDisposition: 'CONTRIBUTING' }]],
      ['non-authoritative', [{ sourceDisposition: 'NON_AUTHORITATIVE' }]],
      ['source-connection', [{ sourceClass: 'SOURCE_CONNECTION' }]],
      ['contradictory', [{}, { sourceDisposition: 'NON_AUTHORITATIVE' }]],
    ];
    for (const [label, overrides] of variants) {
      const srcRole = randomUUID();
      await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
        values('${srcRole}','L14_SRC_${label.toUpperCase().replace(/-/g, '_')}','Src','organisation',false)`);
      const org = await k.setup([...k.opsRules(), ...overrides.map(o => rule(srcRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT', o))]);
      const actor = await c.mkUser(org.org, [srcRole]);
      const denied = await k.admitNext(org, actor, `src-${label}`, k.opsRules(4));
      assert.equal(denied.deny_reason, 'SOURCE_NOT_AUTHORIZED', label);
      assert.ok((await snapshotRules(org.org, denied.authorization_decision_id)).length >= 1, 'evaluated rules snapshotted');
    }
  });

  await t.test('SCOPE_NOT_AUTHORIZED is structurally unreachable for Authority Policy rules and returned by the evaluator for non-organisation scopes', async () => {
    const ctx = await k.setup([...k.opsRules(), rule(memberRole, 'L14_PARTY_VALIDATE', 'REJECT', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' })]);
    const result = JSON.parse(lastLine(await owner(`select to_json(e) from gov_repo.l14_evaluate_authority_rules_v1('${ctx.org}',
      '${ctx.v1.authority_policy_id}','${ctx.v1.version_id}',array['${memberRole}']::uuid[],'L14_PARTY_VALIDATE','REJECT',false,'IMMEDIATE') e`)));
    assert.equal(result.deny_reason, 'SCOPE_NOT_AUTHORIZED');
    await rejects(owner(`insert into gov_repo.l14_authority_policy_rules select organisation_id,authority_policy_id,version_id,99,role_id,
      'L14_AUTHORITY_POLICY_ADMIN','REJECT',source_class,source_disposition,'CANONICAL_KIND','AGENT',null,null,null,null,false,false,false
      from gov_repo.l14_authority_policy_rules where version_id='${ctx.v1.version_id}' limit 1`), '23514', /authority_scope_check/);
  });

  await t.test('successor self-authorization: rules only in the proposed successor never authorize its ADMIT or VALIDATE', async () => {
    const ctx = await k.setup();
    const selfRole = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${selfRole}','L14_SELF_GRANT','Self','organisation',false)`);
    const actor = await c.mkUser(ctx.org, [selfRole]);
    const grantsSelf = [...k.opsRules(5), rule(selfRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
      rule(selfRole, 'L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE', { allowSelfValidation: true })];
    assert.equal((await k.admitNext(ctx, actor, 'self-admit', grantsSelf)).deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
    const v2 = await k.admitNext(ctx, ctx.ops, 'self-v2', grantsSelf);
    const proposal = k.validateProposal(v2);
    const submitted = await k.submit(ctx, actor, 'self-submit', proposal);
    const denied = await k.decide(ctx, actor, 'self-validate', submitted, proposal);
    assert.equal(denied.deny_reason, 'NO_MATCHING_AUTHORITY_RULE', 'v2 is not effective and cannot be its own basis');
    assert.equal((await authz(ctx.org, denied.authorization_decision_id)).basis_version_id, ctx.v1.version_id);
  });

  await t.test('stale expected version → GV009 and consumes no command', async () => {
    const ctx = await k.setup();
    await k.admitNext(ctx, ctx.ops, 'stale-v2', k.opsRules(1));
    const before = await counts(ctx.org);
    await rejects(c.svc(k.admitNextSql(ctx, ctx.ops, ctx.cmd('stale-v3'), k.opsRules(2), ctx.v1.version_id)), 'GV009', /EXPECTED_HEAD_MISMATCH/);
    await rejects(c.svc(c.admitSql(ctx.ops, { commandId: ctx.cmd('stale-v3'), rules: k.opsRules(2),
      expected: { authorityPolicyId: randomUUID(), latestVersionId: (await k.head(ctx.org)).latest_version_id } })), 'GV009');
    assert.deepEqual(await counts(ctx.org), before);
  });

  await t.test('ALLOW replay after L14 authority change: original ADMITTED/VALIDATED result; NEW command denied', async () => {
    const ctx = await k.setup();
    const h = await k.head(ctx.org);
    const admitSql = k.admitNextSql(ctx, ctx.ops, ctx.cmd('r-v2'), k.opsRules(6), h.latest_version_id);
    const admitted = await exec(admitSql);
    const proposal = k.validateProposal(admitted);
    const submitted = await k.submit(ctx, ctx.member, 'r-submit', proposal);
    const decideSql = k.decideSqlFor(ctx, ctx.ops, ctx.cmd('r-validate'), submitted.proposal_id, proposal, 'VALIDATE', h.latest_state_id);
    const validated = await exec(decideSql);
    assert.equal(validated.outcome, 'VALIDATED');
    await owner(`update gov_repo.governance_users set role_ids=array['${memberRole}']::uuid[] where user_id='${ctx.ops.id}'`);
    const before = await counts(ctx.org);
    const replayAdmit = await exec(admitSql);
    assert.equal(replayAdmit.replay, true);
    assert.deepEqual({ ...replayAdmit, replay: false }, admitted, 'original ids and recorded_at');
    const replayDecide = await exec(decideSql);
    assert.equal(replayDecide.replay, true);
    assert.deepEqual({ ...replayDecide, replay: false }, validated);
    assert.deepEqual(await counts(ctx.org), before, 'no new authorization evaluation or state');
    const fresh = await k.admitNext(ctx, ctx.ops, 'r-v3', k.opsRules(7));
    assert.equal(fresh.deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
    const p2 = await k.submit(ctx, ctx.member, 'r-submit-2', proposal);
    const freshDecide = await k.decide(ctx, ctx.ops, 'r-reject', p2, proposal, 'REJECT');
    assert.equal(freshDecide.deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
  });

  await t.test('DENY replay after authority change: the original DENY stays DENY; a NEW command is allowed', async () => {
    const ctx = await k.setup();
    const h = await k.head(ctx.org);
    const sql = k.admitNextSql(ctx, ctx.member, ctx.cmd('d-v2'), k.opsRules(8), h.latest_version_id);
    const denied = await exec(sql);
    assert.equal(denied.deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
    await owner(`update gov_repo.governance_users set role_ids=array['${memberRole}','${k.opsRole}']::uuid[] where user_id='${ctx.member.id}'`);
    const replay = await exec(sql);
    assert.deepEqual({ ...replay, replay: false }, denied);
    assert.equal((await k.admitNext(ctx, ctx.member, 'd-v2b', k.opsRules(8))).outcome, 'ADMITTED');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('successor proposals: VALIDATE keeps explicit time exactly; REVOKE pins an exact VALIDATED target; no authority side effects', async () => {
    const ctx = await k.setup();
    const v2 = await k.admitNext(ctx, ctx.ops, 'p-v2', k.opsRules(1));
    const future = await k.instant('2 hours');
    const before = await counts(ctx.org);
    const p = await k.submit(ctx, ctx.member, 'p-validate', k.validateProposal(v2, future));
    assert.equal(await k.canonical(await owner(`select requested_effective_from::text from gov_repo.l14_authority_policy_version_proposals where proposal_id='${p.proposal_id}'`)), future);
    const s1 = await k.state(ctx.org, ctx.s1.state_id);
    const r = await k.submit(ctx, ctx.member, 'p-revoke', k.revokeProposal(s1));
    assert.equal(r.outcome, 'SUBMITTED');
    const after = await counts(ctx.org);
    assert.equal(after.l14_authorization_decisions, before.l14_authorization_decisions);
    assert.equal(after.l14_governance_decisions, before.l14_governance_decisions);
    assert.equal(after.l14_authority_policy_states, before.l14_authority_policy_states);
    await rejects(c.svc(c.submitSql(ctx.member, { commandId: ctx.cmd('p-r1'), proposal: { ...k.revokeProposal(s1), targetStateId: null } })), 'GV010');
    await rejects(c.svc(c.submitSql(ctx.member, { commandId: ctx.cmd('p-r2'), proposal: { ...k.revokeProposal(s1), versionId: v2.version_id, contentHash: v2.content_hash } })), 'GV010', /TARGET_STATE_PIN_MISMATCH/);
    await rejects(c.svc(c.submitSql(ctx.member, { commandId: ctx.cmd('p-r3'), proposal: { ...k.revokeProposal(s1), targetStateId: randomUUID() } })), 'GV010', /TARGET_STATE_UNRESOLVED/);
    const other = await k.setup();
    await rejects(c.svc(c.submitSql(other.member, { commandId: 'p-r4', proposal: k.revokeProposal(s1) })), 'GV010', /PINNED_VERSION_UNRESOLVED/);
    await rejects(c.svc(c.submitSql(ctx.member, { commandId: ctx.cmd('p-r5'), proposal: { ...k.validateProposal(v2), targetStateId: s1.state_id } })), 'GV010', /TARGET_STATE_NOT_PERMITTED/);
  });

  await t.test('immediate VALIDATE: v2 from the DB instant; predecessor byte-identical; bitemporal cutover', async () => {
    const ctx = await k.setup();
    const s1Before = await k.stateRowText(ctx.org, ctx.s1.state_id);
    const { decided, admitted } = await k.successor(ctx, 'imm', k.opsRules(1));
    assert.equal(decided.outcome, 'VALIDATED');
    assert.equal(decided.effective_from, decided.recorded_at);
    const s2 = await k.state(ctx.org, decided.state_id);
    assert.equal(s2.predecessor_state_id, ctx.s1.state_id);
    assert.equal(s2.revokes_state_id, null);
    assert.equal(s2.basis_version_id, ctx.v1.version_id);
    assert.equal(s2.authority_basis, 'AUTHORITY_POLICY_VERSION');
    assert.equal((await k.head(ctx.org)).latest_state_id, decided.state_id);
    assert.equal(await k.stateRowText(ctx.org, ctx.s1.state_id), s1Before, 'predecessor row untouched');
    const at = k.ts(decided.recorded_at);
    assert.equal(await k.resolve(ctx.org, 'clock_timestamp()', 'clock_timestamp()'), admitted.version_id);
    assert.equal(await k.resolve(ctx.org, `${at} - interval '1 microsecond'`, 'clock_timestamp()'), ctx.v1.version_id);
    assert.equal(await k.resolve(ctx.org, 'clock_timestamp()', `${at} - interval '1 microsecond'`), ctx.v1.version_id, 'earlier knowledge');
  });

  await t.test('future VALIDATE: denied without allow_future_dating; allowed with it; predecessor stays effective until T', async () => {
    const noFlag = await k.setup();
    const future = await k.instant('1 hour');
    const denied = (await k.successor(noFlag, 'f', k.opsRules(1), future)).decided;
    assert.equal(denied.deny_reason, 'TEMPORAL_ACTION_NOT_AUTHORIZED');
    assert.equal((await counts(noFlag.org)).l14_authority_policy_states, 1);
    const ctx = await k.setup(k.opsRules(0, { validate: { allowFutureDating: true } }));
    const T = await k.instant('1 hour');
    const { decided, admitted } = await k.successor(ctx, 'f', k.opsRules(1), T);
    assert.equal(decided.outcome, 'VALIDATED');
    assert.equal(await k.canonical(decided.effective_from), T);
    assert.equal(await k.resolve(ctx.org, 'clock_timestamp()', 'clock_timestamp()'), ctx.v1.version_id, 'future successor invisible before T');
    assert.equal(await k.resolve(ctx.org, `${k.ts(T)} - interval '1 microsecond'`, 'clock_timestamp()'), ctx.v1.version_id);
    assert.equal(await k.resolve(ctx.org, k.ts(T), 'clock_timestamp()'), admitted.version_id);
    const auth = await authz(ctx.org, decided.authorization_decision_id);
    assert.equal(auth.basis_version_id, ctx.v1.version_id);
  });

  await t.test('backdated VALIDATE: denied without allow_backdating; allowed with it; later knowledge of the past, earlier cutoffs unchanged', async () => {
    const noFlag = await k.setup();
    await sleep(1100);
    const pastNo = await k.instant('-500 milliseconds');
    assert.equal((await k.successor(noFlag, 'b', k.opsRules(1), pastNo)).decided.deny_reason, 'TEMPORAL_ACTION_NOT_AUTHORIZED');
    const ctx = await k.setup(k.opsRules(0, { validate: { allowBackdating: true } }));
    await sleep(1100);
    const T = await k.instant('-500 milliseconds');
    // v2 becomes the effective basis for later commands, so it carries the backdating grant too.
    const { decided, admitted } = await k.successor(ctx, 'b', k.opsRules(1, { validate: { allowBackdating: true } }), T);
    assert.equal(decided.outcome, 'VALIDATED');
    assert.equal(await k.canonical(decided.effective_from), T);
    const between = `${k.ts(T)} + interval '1 microsecond'`;
    assert.equal(await k.resolve(ctx.org, between, 'clock_timestamp()'), admitted.version_id, 'later knowledge: v2 at the past instant');
    assert.equal(await k.resolve(ctx.org, between, `${k.ts(decided.recorded_at)} - interval '1 microsecond'`), ctx.v1.version_id,
      'earlier recorded cutoff still sees v1 at that instant');
    // T at/before the current schedule's latest instant is a continuity violation (with the flag).
    const tooEarly = await k.canonical(ctx.s1.effective_from);
    const v3 = await k.admitNext(ctx, ctx.ops, 'b-v3', k.opsRules(2));
    const p3 = k.validateProposal(v3, tooEarly);
    const s3 = await k.submit(ctx, ctx.member, 'b-submit3', p3);
    const beforeCounts = await counts(ctx.org);
    await rejects(c.svc(k.decideSqlFor(ctx, ctx.ops, ctx.cmd('b-validate3'), s3.proposal_id, p3, 'VALIDATE', decided.state_id)), 'GV011', /L14_CONTINUITY_VIOLATION/);
    assert.deepEqual(await counts(ctx.org), beforeCounts, 'continuity failure writes nothing and consumes no command');
  });

  await t.test('strictly increasing effective_from: an earlier or equal future instant than a pending successor → GV011', async () => {
    const ctx = await k.setup(k.opsRules(0, { validate: { allowFutureDating: true } }));
    const T2 = await k.instant('2 hours');
    const v2 = (await k.successor(ctx, 'i2', k.opsRules(1), T2)).decided;
    for (const [label, when] of [['equal', T2], ['earlier', await k.instant('1 hour')]] as const) {
      const v3 = await k.admitNext(ctx, ctx.ops, `i3-${label}`, k.opsRules(label === 'equal' ? 2 : 3));
      const p = k.validateProposal(v3, when);
      const s = await k.submit(ctx, ctx.member, `i3-submit-${label}`, p);
      await rejects(c.svc(k.decideSqlFor(ctx, ctx.ops, ctx.cmd(`i3-validate-${label}`), s.proposal_id, p, 'VALIDATE', v2.state_id)), 'GV011');
    }
  });

  await t.test('self-validation: submitter = validator denied without allow_self_validation, allowed with it', async () => {
    const ctx = await k.setup();
    const v2 = await k.admitNext(ctx, ctx.ops, 'sv-v2', k.opsRules(1));
    const p = k.validateProposal(v2);
    const s = await k.submit(ctx, ctx.ops, 'sv-submit', p);
    const denied = await k.decide(ctx, ctx.ops, 'sv-validate', s, p);
    assert.equal(denied.deny_reason, 'SELF_VALIDATION_NOT_PERMITTED');
    assert.equal((await authz(ctx.org, denied.authorization_decision_id)).is_self_validation, true);
    assert.equal((await k.decide(ctx, ctx.ops2, 'sv-validate-other', s, p)).outcome, 'VALIDATED', 'another authorized actor may validate');
    const ok = await k.setup(k.opsRules(0, { validate: { allowSelfValidation: true } }));
    const w2 = await k.admitNext(ok, ok.ops, 'sv-v2', k.opsRules(1));
    const q = k.validateProposal(w2);
    const sub = await k.submit(ok, ok.ops, 'sv-submit', q);
    assert.equal((await k.decide(ok, ok.ops, 'sv-validate', sub, q)).outcome, 'VALIDATED');
  });

  await t.test('duplicate validation of a version → GV010; stale expected state → GV009; neither consumes a command', async () => {
    const ctx = await k.setup();
    const { admitted, decided, proposal } = await k.successor(ctx, 'dup', k.opsRules(1));
    const again = await k.submit(ctx, ctx.member, 'dup-submit2', proposal);
    const before = await counts(ctx.org);
    await rejects(c.svc(k.decideSqlFor(ctx, ctx.ops, ctx.cmd('dup-validate2'), again.proposal_id, proposal, 'VALIDATE', decided.state_id)), 'GV010', /VERSION_ALREADY_VALIDATED/);
    await rejects(c.svc(k.decideSqlFor(ctx, ctx.ops, ctx.cmd('dup-validate3'), again.proposal_id, proposal, 'VALIDATE', ctx.s1.state_id)), 'GV009');
    assert.deepEqual(await counts(ctx.org), before);
    assert.ok(admitted.version_id);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('REJECT / DEFER: authorized decisions without state; DEFER then VALIDATE; terminal REJECT → correction needs a new linked proposal', async () => {
    const ctx = await k.setup();
    const v2 = await k.admitNext(ctx, ctx.ops, 'rd-v2', k.opsRules(1));
    const p = k.validateProposal(v2);
    const s = await k.submit(ctx, ctx.member, 'rd-submit', p);
    const states = (await counts(ctx.org)).l14_authority_policy_states;
    const deferred = await k.decide(ctx, ctx.ops, 'rd-defer', s, p, 'DEFER');
    assert.equal(deferred.outcome, 'DEFERRED');
    assert.ok(deferred.governance_decision_id);
    assert.equal(deferred.state_id, null);
    const validated = await k.decide(ctx, ctx.ops, 'rd-validate', s, p);
    assert.equal(validated.outcome, 'VALIDATED', 'DEFER is non-terminal');
    assert.equal((await counts(ctx.org)).l14_authority_policy_states, states + 1);
    const v3 = await k.admitNext(ctx, ctx.ops, 'rd-v3', k.opsRules(2));
    const p3 = k.validateProposal(v3);
    const s3 = await k.submit(ctx, ctx.member, 'rd-submit3', p3);
    const headBefore = await k.head(ctx.org);
    const rejected = await k.decide(ctx, ctx.ops, 'rd-reject', s3, p3, 'REJECT');
    assert.equal(rejected.outcome, 'REJECTED');
    assert.equal(rejected.state_id, null);
    assert.deepEqual(await k.head(ctx.org), headBefore, 'REJECT never moves the head');
    await rejects(c.svc(k.decideSqlFor(ctx, ctx.ops, ctx.cmd('rd-validate3'), s3.proposal_id, p3, 'VALIDATE', headBefore.latest_state_id)), 'GV010', /PROPOSAL_TERMINAL/);
    const corrected = await exec(c.submitSql(ctx.member, { commandId: ctx.cmd('rd-correct'), proposal: p3, prior: s3.proposal_id }));
    assert.equal((await k.decide(ctx, ctx.ops, 'rd-validate-corrected', corrected, p3)).outcome, 'VALIDATED');
    const noRule = await k.setup([rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'), rule(k.opsRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT')]);
    const w2 = await k.admitNext(noRule, noRule.ops, 'rd-w2', k.opsRules(1));
    const q = k.validateProposal(w2);
    const sq = await k.submit(noRule, noRule.member, 'rd-wsubmit', q);
    assert.equal((await k.decide(noRule, noRule.ops, 'rd-wdefer', sq, q, 'DEFER')).deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
  });

  await t.test('REVOKE: pending future successor cancelled; it never becomes effective; exact revokes_state_id; double revoke rejected', async () => {
    const ctx = await k.setup(k.opsRules(0, { validate: { allowFutureDating: true } }));
    const T2 = await k.instant('2 hours');
    const { decided: s2, admitted: v2 } = await k.successor(ctx, 'pc', k.opsRules(1), T2);
    const s2Row = await k.state(ctx.org, s2.state_id);
    const s1Before = await k.stateRowText(ctx.org, ctx.s1.state_id);
    const s2Before = await k.stateRowText(ctx.org, s2.state_id);
    const rp = k.revokeProposal(s2Row);
    const rs = await k.submit(ctx, ctx.member, 'pc-revoke-submit', rp);
    await rejects(c.svc(k.decideSqlFor(ctx, ctx.ops, ctx.cmd('pc-as-validate'), rs.proposal_id, rp, 'VALIDATE', s2.state_id)), 'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    const revoked = await k.decide(ctx, ctx.ops, 'pc-revoke', rs, rp, 'REVOKE');
    assert.equal(revoked.outcome, 'REVOKED');
    const tomb = await k.state(ctx.org, revoked.state_id);
    assert.equal(tomb.state_kind, 'REVOKED');
    assert.equal(tomb.revokes_state_id, s2.state_id);
    assert.equal(tomb.predecessor_state_id, s2.state_id, 'lineage predecessor = the expected head state');
    assert.equal(tomb.version_id, v2.version_id);
    assert.equal(tomb.content_hash, v2.content_hash);
    assert.equal(await k.stateRowText(ctx.org, ctx.s1.state_id), s1Before);
    assert.equal(await k.stateRowText(ctx.org, s2.state_id), s2Before, 'the revoked target is never edited');
    for (const at of ['clock_timestamp()', k.ts(T2), `${k.ts(T2)} + interval '10 days'`]) {
      assert.equal(await k.resolve(ctx.org, at, `${k.ts(T2)} + interval '10 days'`), ctx.v1.version_id, `cancelled v2 never effective (${at})`);
    }
    assert.equal(await k.resolve(ctx.org, k.ts(T2), `${k.ts(tomb.recorded_at)} - interval '1 microsecond'`), v2.version_id,
      'knowledge before the revocation still showed the scheduled v2');
    const again = await k.submit(ctx, ctx.member, 'pc-revoke-submit2', rp);
    await rejects(c.svc(k.decideSqlFor(ctx, ctx.ops, ctx.cmd('pc-revoke2'), again.proposal_id, rp, 'REVOKE', revoked.state_id)), 'GV010', /TARGET_ALREADY_REVOKED/);
    // After cancellation a new successor may take an instant before the cancelled one.
    const T3 = await k.instant('1 hour');
    assert.equal((await k.successor(ctx, 'pc3', k.opsRules(2), T3)).decided.outcome, 'VALIDATED');
  });

  await t.test('REVOKE the currently effective policy without a successor → GV011; nothing written; no fallback', async () => {
    const ctx = await k.setup();
    const s1 = await k.state(ctx.org, ctx.s1.state_id);
    const rp = k.revokeProposal(s1);
    const rs = await k.submit(ctx, ctx.member, 'nc-submit', rp);
    const before = await counts(ctx.org);
    await rejects(c.svc(k.decideSqlFor(ctx, ctx.ops, ctx.cmd('nc-revoke'), rs.proposal_id, rp, 'REVOKE', ctx.s1.state_id)), 'GV011', /NO_EFFECTIVE_AUTHORITY_AT_CUTOVER/);
    assert.deepEqual(await counts(ctx.org), before);
    assert.equal(await k.resolve(ctx.org, 'clock_timestamp()', 'clock_timestamp()'), ctx.v1.version_id);
  });

  await t.test('REVOKE a superseded predecessor after a backdated/immediate takeover never resurrects it', async () => {
    const ctx = await k.setup();
    const { decided: s2, admitted: v2 } = await k.successor(ctx, 'sp', k.opsRules(1));
    const s1 = await k.state(ctx.org, ctx.s1.state_id);
    const rp = k.revokeProposal(s1);
    const rs = await k.submit(ctx, ctx.member, 'sp-revoke-submit', rp);
    const revoked = await k.decide(ctx, ctx.ops, 'sp-revoke', rs, rp, 'REVOKE');
    assert.equal(revoked.outcome, 'REVOKED');
    assert.equal(await k.resolve(ctx.org, 'clock_timestamp()', 'clock_timestamp()'), v2.version_id);
    assert.equal((await authz(ctx.org, revoked.authorization_decision_id)).basis_version_id, v2.version_id);
    // Revoking the now-current v2 without a successor is a continuity violation (no resurrection of v1).
    const s2Row = await k.state(ctx.org, s2.state_id);
    const rp2 = k.revokeProposal(s2Row);
    const rs2 = await k.submit(ctx, ctx.member, 'sp-revoke2-submit', rp2);
    await rejects(c.svc(k.decideSqlFor(ctx, ctx.ops, ctx.cmd('sp-revoke2'), rs2.proposal_id, rp2, 'REVOKE', revoked.state_id)), 'GV011');
  });

  await t.test('REVOKE current target at the successor cutover: self-basis revocation, no gap; immediate would gap → GV011; flag enforced', async () => {
    const ctx = await k.setup(k.opsRules(0, { validate: { allowFutureDating: true }, revoke: { allowFutureDating: true } }));
    const T2 = await k.instant('2 hours');
    const { decided: s2, admitted: v2 } = await k.successor(ctx, 'ct', k.opsRules(1), T2);
    const s1 = await k.state(ctx.org, ctx.s1.state_id);
    const immediate = k.revokeProposal(s1);
    const ri = await k.submit(ctx, ctx.member, 'ct-imm-submit', immediate);
    await rejects(c.svc(k.decideSqlFor(ctx, ctx.ops, ctx.cmd('ct-imm'), ri.proposal_id, immediate, 'REVOKE', s2.state_id)), 'GV011',
      /NO_EFFECTIVE_AUTHORITY_AT_CUTOVER/);
    const atCutover = k.revokeProposal(s1, T2);
    const rc = await k.submit(ctx, ctx.member, 'ct-cut-submit', atCutover);
    const revoked = await k.decide(ctx, ctx.ops, 'ct-cut', rc, atCutover, 'REVOKE');
    assert.equal(revoked.outcome, 'REVOKED');
    const a = await authz(ctx.org, revoked.authorization_decision_id);
    assert.equal(a.basis_version_id, ctx.v1.version_id);
    assert.equal(a.subject_version_id, ctx.v1.version_id, 'the current policy authorized revocation of itself');
    const tomb = await k.state(ctx.org, revoked.state_id);
    assert.equal(tomb.basis_version_id, tomb.version_id);
    assert.equal(tomb.revokes_state_id, ctx.s1.state_id);
    const cutoff = `${k.ts(T2)} + interval '1 day'`;
    assert.equal(await k.resolve(ctx.org, 'clock_timestamp()', cutoff), ctx.v1.version_id);
    assert.equal(await k.resolve(ctx.org, `${k.ts(T2)} - interval '1 microsecond'`, cutoff), ctx.v1.version_id);
    assert.equal(await k.resolve(ctx.org, k.ts(T2), cutoff), v2.version_id, 'no gap at the cutover');
    assert.equal(await k.resolve(ctx.org, `${k.ts(T2)} + interval '1 hour'`, cutoff), v2.version_id);
    // Without the future-dating flag on REVOKE the same revocation is a durable DENY.
    const noFlag = await k.setup(k.opsRules(0, { validate: { allowFutureDating: true } }));
    const U2 = await k.instant('2 hours');
    const t2 = (await k.successor(noFlag, 'ct', k.opsRules(1), U2)).decided;
    const nf = k.revokeProposal(await k.state(noFlag.org, noFlag.s1.state_id), U2);
    const nfs = await k.submit(noFlag, noFlag.member, 'ct-nf-submit', nf);
    const nfd = await exec(k.decideSqlFor(noFlag, noFlag.ops, noFlag.cmd('ct-nf'), nfs.proposal_id, nf, 'REVOKE', t2.state_id));
    assert.equal(nfd.deny_reason, 'TEMPORAL_ACTION_NOT_AUTHORIZED');
  });

  await t.test('bitemporal matrix: effective × recorded coordinates across v1 → v2(future) → v3 cancel/replace', async () => {
    const ctx = await k.setup(k.opsRules(0, { validate: { allowFutureDating: true } }));
    const T2 = await k.instant('3 hours');
    const { decided: s2, admitted: v2 } = await k.successor(ctx, 'bm', k.opsRules(1), T2);
    const r2 = s2.recorded_at;
    const rp = k.revokeProposal(await k.state(ctx.org, s2.state_id));
    const rs = await k.submit(ctx, ctx.member, 'bm-revoke-submit', rp);
    const tomb = await k.decide(ctx, ctx.ops, 'bm-revoke', rs, rp, 'REVOKE');
    const T3 = await k.instant('4 hours');
    const { decided: s3, admitted: v3 } = await k.successor(ctx, 'bm3', k.opsRules(2), T3);
    const far = `${k.ts(T3)} + interval '1 day'`;
    const cases: Array<[string, string, string | null]> = [
      [`${k.ts(ctx.s1.effective_from)} - interval '1 microsecond'`, far, null],
      [k.ts(ctx.s1.effective_from), far, ctx.v1.version_id],
      [k.ts(T2), `${k.ts(r2)} - interval '1 microsecond'`, ctx.v1.version_id],
      [k.ts(T2), k.ts(r2), v2.version_id],
      [k.ts(T2), `${k.ts(tomb.recorded_at)} - interval '1 microsecond'`, v2.version_id],
      [k.ts(T2), k.ts(tomb.recorded_at), ctx.v1.version_id],
      [k.ts(T3), `${k.ts(s3.recorded_at)} - interval '1 microsecond'`, ctx.v1.version_id],
      [k.ts(T3), far, v3.version_id],
      [`${k.ts(T3)} - interval '1 microsecond'`, far, ctx.v1.version_id],
      ['clock_timestamp()', far, ctx.v1.version_id],
    ];
    for (const [at, cutoff, expected] of cases) {
      assert.equal(await k.resolve(ctx.org, at, cutoff), expected, `at=${at} cutoff=${cutoff}`);
    }
    const history = await owner(`select count(*) from gov_repo.l14_authority_policy_states where organisation_id='${ctx.org}'`);
    assert.equal(history, '4', 's1, s2, tombstone, s3 — append-only');
  });

  await t.test('successor authorization snapshot: actor/org/action/subject/scope/source/time/result/roles/basis/rules/proposal/command', async () => {
    const ctx = await k.setup();
    const { decided, admitted, submitted } = await k.successor(ctx, 'snap', k.opsRules(1));
    const a = await authz(ctx.org, decided.authorization_decision_id);
    assert.deepEqual([a.actor_user_id, a.organisation_id, a.requested_action, a.subject_kind, a.scope_tag, a.source_class, a.result],
      [ctx.ops.id, ctx.org, 'VALIDATE', 'AUTHORITY_POLICY_VERSION', 'ALL_ALLOWED_TARGETS', 'LOCAL_HUMAN', 'ALLOW']);
    assert.equal(a.subject_version_id, admitted.version_id);
    assert.equal(a.proposal_id, submitted.proposal_id);
    assert.equal(a.command_id, ctx.cmd('snap-validate'));
    assert.equal(a.command_fingerprint, decided.command_fingerprint);
    assert.equal(a.evaluated_at, decided.recorded_at);
    assert.deepEqual([a.authority_basis, a.basis_authority_policy_id, a.basis_version_id],
      ['AUTHORITY_POLICY_VERSION', ctx.v1.authority_policy_id, ctx.v1.version_id]);
    assert.equal(a.basis_content_hash, await storedHash(ctx.org, ctx.v1.authority_policy_id, ctx.v1.version_id));
    const roles = JSON.parse(lastLine(await owner(`select json_agg(role_code) from gov_repo.l14_authorization_decision_roles where authorization_decision_id='${a.authorization_decision_id}'`)));
    assert.deepEqual(roles, ['L14_POLICY_OPS']);
    const snap = await snapshotRules(ctx.org, a.authorization_decision_id);
    assert.equal(snap.length, 1);
    const used = JSON.parse(lastLine(await owner(`select to_json(r) from gov_repo.l14_authority_policy_rules r where version_id='${ctx.v1.version_id}' and rule_ordinal=${snap[0].basis_rule_ordinal}`)));
    assert.deepEqual([used.permission, used.requested_action, used.role_id], ['L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE', k.opsRole]);
  });

  await t.test('S1A.2 migration postflight re-executes cleanly on the final catalog', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const text = readFileSync(fileURLToPath(new URL('../../../../supabase/migrations/20260929130000_m16_s1a2_l14_authority_policy_successor_v1.sql', import.meta.url)), 'utf8');
    await owner(text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length));
    await rejects(owner(`select * from gov_repo.l14_evaluate_authority_rules_v1(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'{}'::uuid[],'x','y',false,'IMMEDIATE')`)
      .then(() => c.sql(`select * from gov_repo.l14_authority_policy_schedule_continuous_v1(gen_random_uuid(),null,null,null,null)`, 'service_role')), '42501');
  });
});
