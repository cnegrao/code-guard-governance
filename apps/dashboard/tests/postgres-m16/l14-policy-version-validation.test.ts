import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decidePolicyVersionProposalFingerprint } from '@council/governance-review';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { policyValidationKit } from '../helpers/m16-l14-policy-validation-fixtures';

/**
 * M16-S1B.4 — POLICY_VERSION governance lifecycle on real disposable PostgreSQL 17 (S1B4 horizon). Every command goes
 * through the real public RPCs as service_role; every Authority Policy through the real AP RPCs and every policy /
 * version admission through the real S1B.3 RPCs. Owner access is used only to read evidence and for rolled-back
 * structural probes. Bracketed numbers are the S1B.4 acceptance items.
 */
test('M16 S1B.4 POLICY_VERSION governance validation lifecycle (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B4' });
  t.after(() => c.stop());
  const { owner, exec, rejects } = c;
  const k = await policyValidationKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const row = async (query: string) => JSON.parse(await one(`select coalesce((${query}), 'null'::json)`));
  const authz = (id: string) => row(`select to_json(a) from gov_repo.l14_authorization_decisions a where authorization_decision_id='${id}'`);
  const envelope = (id: string) => row(`select to_json(s) from gov_repo.l14_registry_states s where state_id='${id}'`);
  const ts = (value: string) => `'${value}'::timestamptz`;
  /** Every reused-store and S1B.3 lineage row of an organisation, full-row text (VALIDATE never touches them). */
  const storeDigest = (org: string) => one(`select md5(string_agg(x, '|' order by x)) from (
    select 'p:'||p::text as x from gov_repo.governance_policies p where organisation_id='${org}'
    union all select 'v:'||v::text from gov_repo.policy_versions v where organisation_id='${org}'
    union all select 'a:'||a::text from gov_repo.l14_policy_admissions a where organisation_id='${org}'
    union all select 'va:'||va::text from gov_repo.l14_policy_version_admissions va where organisation_id='${org}') s`);
  const ctx = await k.setup();

  // ---------------------------------------------------------------------------------------
  await t.test('[1,5] an exact admitted tuple receives a VALIDATE proposal: SUBMITTED; no authority, decision, state, head or content change', async () => {
    const s = await k.admitted(ctx, 'sub');
    await c.evidence(ctx.org, 'sub-ev-1');
    const before = await k.counts(ctx.org);
    const stores = await storeDigest(ctx.org);
    const r = await exec(k.submitSql(ctx.member, { commandId: ctx.cmd('sub-1'), proposal: k.validateProposal(s),
      support: { status: 'PRESENT', evidenceIds: ['sub-ev-1'] } }));
    assert.deepEqual([r.outcome, r.command_kind, r.subject_kind, r.replay, r.authorization_decision_id, r.governance_decision_id, r.registry_state_id],
      ['SUBMITTED', 'SUBMIT_PROPOSAL', 'POLICY_VERSION', false, null, null, null]);
    assert.deepEqual([r.policy_id, r.version_id, r.content_hash], [s.policyId, s.versionId, s.contentHash]);
    const detail = await row(`select to_json(t) from gov_repo.l14_policy_version_proposals t where proposal_id='${r.proposal_id}'`);
    assert.deepEqual({ intent: detail.intent, p: detail.policy_id, v: detail.version_id, h: detail.content_hash, eff: detail.requested_effective_from,
      target: detail.target_state_id }, { intent: 'VALIDATE', p: s.policyId, v: s.versionId, h: s.contentHash, eff: null, target: null });
    const envelopeRow = await row(`select to_json(p) from gov_repo.l14_proposals p where proposal_id='${r.proposal_id}'`);
    assert.deepEqual([envelopeRow.subject_kind, envelopeRow.source_class, envelopeRow.submitted_by_actor_user_id],
      ['POLICY_VERSION', await one(`select source_class from gov_repo.l14_policy_version_admissions where version_id='${s.versionId}'`), ctx.member.id]);
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where owner_kind='PROPOSAL' and proposal_id='${r.proposal_id}' and evidence_id='sub-ev-1'`), '1');
    const after = await k.counts(ctx.org);
    for (const table of ['l14_authorization_decisions', 'l14_governance_decisions', 'l14_registry_states', 'l14_policy_version_states', 'l14_policy_version_heads']) {
      assert.equal(after[table], before[table], `${table}: a proposal is not validation authority`);
    }
    assert.equal(after.l14_policy_version_proposals, before.l14_policy_version_proposals + 1);
    assert.equal(await k.head(ctx.org, s), null, 'no head before the first state');
    assert.equal(await storeDigest(ctx.org), stores, 'policy content / admission lineage untouched');
  });

  await t.test('[2,3,4] legacy-only, foreign-tenant and wrong policy / version / hash tuples are never subjects (GV010, nothing written)', async () => {
    const s = await k.admitted(ctx, 'neg');
    const other = await k.admitted(ctx, 'neg2');
    const legacy = await k.pk.legacyPolicy(ctx.org, ctx.author.id, `${ctx.label}-LEG`.slice(0, 20));
    const legacyHash = await one(`select content_hash from gov_repo.policy_versions where version_id='${legacy.versionId}'`);
    const foreign = await k.setup();
    const fs = await k.admitted(foreign, 'fx');
    const before = await k.counts(ctx.org);
    for (const [name, subject] of [
      ['legacy-only version', { policyId: legacy.policyId, versionId: legacy.versionId!, contentHash: legacyHash }],
      ['foreign tenant version', fs],
      ['wrong content hash', { ...s, contentHash: other.contentHash }],
      ['wrong policy for the version', { ...s, policyId: other.policyId }],
      ['wrong version for the policy', { ...s, versionId: other.versionId }],
      ['unknown version', { ...s, versionId: '00000000-0000-4000-8000-000000000000' }],
    ] as const) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`neg-${name}`), proposal: k.validateProposal(subject) })),
        'GV010', /POLICY_VERSION_NOT_ADMITTED/);
    }
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('neg-hash'), proposal: k.validateProposal({ ...s, contentHash: 'ABC' }), fingerprint: 'f'.repeat(64) })),
      'GV010', /CONTENT_HASH_MALFORMED/);
    assert.deepEqual(await k.counts(ctx.org), before);
    // A foreign-tenant principal can never act on this tenant either (the tenant comes only from the verified session).
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('neg-session'), proposal: k.validateProposal(s), session: { org: foreign.org } })), 'GV003');
  });

  await t.test('[11] source class is the admission lineage source class: relabelling is rejected (RPC) and structurally impossible (guard)', async () => {
    const s = await k.admitted(ctx, 'src');
    for (const label of ['SOURCE_CONNECTION', 'SYSTEM_SEED'] as const) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`src-${label}`), proposal: { ...k.validateProposal(s), sourceClass: label } })),
        'GV010', /SOURCE_CLASS_LINEAGE_MISMATCH/);
    }
    // Owner-level forgery: an envelope relabelled SOURCE_CONNECTION over a LOCAL_HUMAN lineage cannot gain typed detail.
    const forged = `begin; insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
      values('${ctx.org}','11111111-1111-4111-8111-111111111111','POLICY_VERSION','VALIDATE','SOURCE_CONNECTION','${ctx.member.id}','NONE',now());
      insert into gov_repo.l14_policy_version_proposals(organisation_id,proposal_id,intent,policy_id,version_id,content_hash)
      values('${ctx.org}','11111111-1111-4111-8111-111111111111','VALIDATE','${s.policyId}','${s.versionId}','${s.contentHash}'); rollback;`;
    await assert.rejects(c.bootstrapSql(forged), /GV010|POLICY_VERSION_PROPOSAL_SOURCE_MISMATCH/);
  });

  let lifecycle: { s: any; v1: string; submitted: any; proposal: any } | null = null;
  await t.test('[6,7,8,9,10,12,13,21] first VALIDATE: exact governed state pinned to the tuple; L14_POLICY_VERSION_VALIDATE over CURRENT roles + effective AP; descriptor VALIDATED, never a body', async () => {
    const s = await k.admitted(ctx, 'val');
    const d0 = await k.descriptor(ctx.member, s);
    assert.deepEqual([d0.validation_state, d0.validation_state_id, d0.validation_effective_from, d0.latest_validation_state_id], ['NOT_VALIDATED', null, null, null]);
    await c.evidence(ctx.org, 'val-ev-1');
    const proposal = k.validateProposal(s);
    const submitted = await k.submit(ctx, ctx.member, 'val-submit', proposal);
    const r = await exec(k.decideSql(ctx.validator, { commandId: ctx.cmd('val-validate'), proposalId: submitted.proposal_id, proposal,
      support: { status: 'PRESENT', evidenceIds: ['val-ev-1'] } }));
    assert.deepEqual([r.outcome, r.state_kind, r.authorization_result, r.deny_reason], ['VALIDATED', 'VALIDATED', 'ALLOW', null]);
    const st = await row(`select to_json(d) from gov_repo.l14_policy_version_states d where state_id='${r.registry_state_id}'`);
    assert.deepEqual({ k: st.state_kind, p: st.policy_id, v: st.version_id, h: st.content_hash, pred: st.predecessor_state_id, rev: st.revokes_state_id },
      { k: 'VALIDATED', p: s.policyId, v: s.versionId, h: s.contentHash, pred: null, rev: null });
    const env = await envelope(r.registry_state_id);
    assert.deepEqual({ subject: env.subject_kind, trust: env.trust_state, source: env.source_class, decision: env.governance_decision_id,
      authz: env.authorization_decision_id, basis: env.authority_policy_version_id, support: env.support_status },
    { subject: 'POLICY_VERSION', trust: 'VALIDATED', source: 'LOCAL_HUMAN', decision: r.governance_decision_id,
      authz: r.authorization_decision_id, basis: ctx.v1.version_id, support: 'PRESENT' });
    const a = await authz(r.authorization_decision_id);
    assert.deepEqual({ action: a.requested_action, subject: a.subject_kind, scope: a.scope_tag, basis: a.authority_basis, bv: a.basis_version_id,
      bh: a.basis_content_hash, exp: a.expectation_kind, self: a.is_self_validation, proposal: a.proposal_id, hash: a.attempted_content_hash },
    { action: 'VALIDATE', subject: 'POLICY_VERSION', scope: 'ALL_ALLOWED_TARGETS', basis: 'AUTHORITY_POLICY_VERSION', bv: ctx.v1.version_id,
      bh: ctx.v1.content_hash, exp: 'EXPECTED_NONE', self: false, proposal: submitted.proposal_id, hash: null });
    assert.equal(await one(`select string_agg(permission||'/'||requested_action||'/'||source_class||'/'||source_disposition||'/'||scope_tag, ',')
      from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${r.authorization_decision_id}'`),
    'L14_POLICY_VERSION_VALIDATE/VALIDATE/LOCAL_HUMAN/AUTHORITATIVE/ALL_ALLOWED_TARGETS', '[8] the exact permission + action rule');
    assert.equal(await one(`select string_agg(role_id::text, ',') from gov_repo.l14_authorization_decision_roles where authorization_decision_id='${r.authorization_decision_id}'`),
      k.pk.validatorRole, '[9] the CURRENT persisted role');
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where evidence_id='val-ev-1' and
      ((owner_kind='GOVERNANCE_DECISION' and governance_decision_id='${r.governance_decision_id}') or (owner_kind='REGISTRY_STATE' and registry_state_id='${r.registry_state_id}'))`), '2');
    assert.deepEqual(await k.head(ctx.org, s), { organisation_id: ctx.org, policy_id: s.policyId, version_id: s.versionId, content_hash: s.contentHash,
      latest_state_id: r.registry_state_id });
    const d1 = await k.descriptor(ctx.member, s);
    assert.deepEqual([d1.validation_state, d1.validation_state_id, d1.latest_validation_state_id], ['VALIDATED', r.registry_state_id, r.registry_state_id]);
    assert.equal(d1.validation_effective_from, r.effective_from);
    assert.ok(!Object.keys(d1).some(key => /content_markdown|status$|approv|qes|current_version|change_summary|owner/.test(key)), '[13] no body / legacy field');
    assert.equal(await k.resolve(ctx.org, s, 'clock_timestamp()', 'clock_timestamp()'), r.registry_state_id);
    lifecycle = { s, v1: r.registry_state_id, submitted, proposal };
  });

  await t.test('[39,40,41,42] VALIDATE writes no legacy status/approval/QES, no current_version_id, no applicability, no trust outside governed state', async () => {
    const s = await k.admitted(ctx, 'leg');
    const before = await storeDigest(ctx.org);
    const v = await k.validate(ctx, 'leg', s);
    const revoked = await k.revoke(ctx, 'leg-r', s, v.decided.registry_state_id);
    assert.equal(revoked.decided.outcome, 'REVOKED');
    assert.equal(await storeDigest(ctx.org), before, 'governance_policies / policy_versions / admission lineage byte-identical');
    assert.equal(await one(`select coalesce(current_version_id::text,'null') from gov_repo.governance_policies where policy_id='${s.policyId}'`), 'null');
    assert.equal(await one(`select (approved_by is null and approval_date is null and qes_signature_id is null)::text
      from gov_repo.policy_versions where version_id='${s.versionId}'`), 'true', 'no legacy approval / QES written by VALIDATE');
    assert.equal(await one(`select v.status::text||'/'||p.status::text from gov_repo.policy_versions v join gov_repo.governance_policies p using (policy_id)
      where v.version_id='${s.versionId}'`), 'draft/draft', 'legacy status stays the admission default (never set by VALIDATE / REVOKE)');
    assert.equal(await one(`select count(*) from gov_repo.l14_proposals where organisation_id='${ctx.org}' and subject_kind <> 'POLICY_VERSION' and subject_kind <> 'AUTHORITY_POLICY_VERSION'`), '0',
      'no POLICY_APPLICABILITY (or any other subject) proposal is created');
    assert.equal(await one(`select count(*) from gov_repo.l14_registry_states where organisation_id='${ctx.org}' and subject_kind <> 'POLICY_VERSION'`), '0');
    assert.equal(await one(`select string_agg(distinct trust_state, ',') from gov_repo.l14_registry_states where organisation_id='${ctx.org}'`), 'VALIDATED');
  });

  await t.test('[14,15,16,17] REJECT = decision without state; DEFER is non-terminal; a terminal proposal is never reused; correction = new linked proposal', async () => {
    const s = await k.admitted(ctx, 'rd');
    const proposal = k.validateProposal(s);
    const p1 = await k.submit(ctx, ctx.member, 'rd-p1', proposal);
    const deferred = await exec(k.decideSqlFor(ctx.validator, ctx.cmd('rd-defer'), p1.proposal_id, proposal, 'DEFER', null));
    assert.deepEqual([deferred.outcome, deferred.registry_state_id], ['DEFERRED', null]);
    const rejected = await exec(k.decideSqlFor(ctx.validator, ctx.cmd('rd-reject'), p1.proposal_id, proposal, 'REJECT', null));
    assert.deepEqual([rejected.outcome, rejected.registry_state_id, rejected.state_kind], ['REJECTED', null, null]);
    assert.equal(await one(`select string_agg(outcome||':'||reason_code, ',' order by decided_at) from gov_repo.l14_governance_decisions where proposal_id='${p1.proposal_id}'`),
      'DEFER:POLICY_VERSION_DEFERRED,REJECT:POLICY_VERSION_REJECTED');
    assert.equal(await k.head(ctx.org, s), null, 'no state, no head');
    for (const outcome of ['VALIDATE', 'REJECT', 'DEFER'] as const) {
      await rejects(c.svc(k.decideSqlFor(ctx.validator, ctx.cmd(`rd-again-${outcome}`), p1.proposal_id, proposal, outcome, null)), 'GV010', /PROPOSAL_TERMINAL/);
    }
    // Outcome must be compatible with the immutable intent.
    await rejects(c.svc(k.decideSqlFor(ctx.validator, ctx.cmd('rd-revoke-on-validate'), p1.proposal_id, proposal, 'REVOKE', null)), 'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    // Correction: a NEW proposal linked to the terminal one (same exact tuple only).
    const other = await k.admitted(ctx, 'rd-other');
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rd-bad-prior'), proposal: k.validateProposal(other), prior: p1.proposal_id })),
      'GV010', /PRIOR_PROPOSAL_UNRESOLVED/);
    const p2 = await k.submit(ctx, ctx.member, 'rd-p2', proposal, p1.proposal_id);
    assert.equal(await one(`select prior_proposal_id from gov_repo.l14_proposals where proposal_id='${p2.proposal_id}'`), p1.proposal_id);
    const ok = await exec(k.decideSqlFor(ctx.validator, ctx.cmd('rd-validate-p2'), p2.proposal_id, proposal, 'VALIDATE', null));
    assert.equal(ok.outcome, 'VALIDATED');
  });

  await t.test('[18,19,20,43] REVOKE pins the exact VALIDATED state, appends a tombstone, never mutates the target; descriptor REVOKED; history immutable', async () => {
    assert.ok(lifecycle);
    const { s, v1 } = lifecycle!;
    const targetRow = await one(`select s::text||'|'||d::text from gov_repo.l14_registry_states s join gov_repo.l14_policy_version_states d using (organisation_id, state_id) where state_id='${v1}'`);
    // The target must be a state of THIS tuple and VALIDATED.
    const other = await k.admitted(ctx, 'rv-other');
    const ov = await k.validate(ctx, 'rv-other', other);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rv-cross'), proposal: k.revokeProposal(s, ov.decided.registry_state_id) })),
      'GV010', /TARGET_STATE_UNRESOLVED/);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rv-none'), proposal: { ...k.revokeProposal(s, v1), targetStateId: null }, fingerprint: 'f'.repeat(64) })),
      'GV010', /TARGET_STATE_REQUIRED/);
    const r = await k.revoke(ctx, 'rv', s, v1);
    assert.deepEqual([r.decided.outcome, r.decided.state_kind], ['REVOKED', 'REVOKED']);
    const tomb = await row(`select to_json(d) from gov_repo.l14_policy_version_states d where state_id='${r.decided.registry_state_id}'`);
    assert.deepEqual([tomb.revokes_state_id, tomb.predecessor_state_id, tomb.policy_id, tomb.version_id, tomb.content_hash], [v1, v1, s.policyId, s.versionId, s.contentHash]);
    assert.equal(await one(`select s::text||'|'||d::text from gov_repo.l14_registry_states s join gov_repo.l14_policy_version_states d using (organisation_id, state_id) where state_id='${v1}'`),
      targetRow, 'the target VALIDATED state is byte-identical');
    const d = await k.descriptor(ctx.member, s);
    assert.deepEqual([d.validation_state, d.validation_state_id, d.latest_validation_state_id], ['REVOKED', r.decided.registry_state_id, r.decided.registry_state_id]);
    assert.equal(await k.resolve(ctx.org, s, 'clock_timestamp()', 'clock_timestamp()'), null);
    assert.equal(await k.resolve(ctx.org, s, ts(lifecycle!.s && (await envelope(v1)).effective_from), ts((await envelope(v1)).recorded_at)), v1,
      'historical readback stays intact');
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rv-again'), proposal: k.revokeProposal(s, v1) })), 'GV010', /TARGET_ALREADY_REVOKED/);
    // [43] every history table is immutable (UPDATE / DELETE / TRUNCATE raise, even for the owner); the head is never deleted.
    for (const sql of [
      `update gov_repo.l14_policy_version_states set state_kind=state_kind where state_id='${v1}'`,
      `delete from gov_repo.l14_policy_version_states where state_id='${v1}'`,
      'truncate gov_repo.l14_policy_version_states cascade',
      `update gov_repo.l14_policy_version_proposals set requested_effective_from=now() where organisation_id='${ctx.org}'`,
      `delete from gov_repo.l14_policy_version_proposals where organisation_id='${ctx.org}'`,
      'truncate gov_repo.l14_policy_version_proposals cascade',
      `update gov_repo.l14_registry_states set effective_from=now() where state_id='${v1}'`,
      `delete from gov_repo.l14_policy_version_heads where organisation_id='${ctx.org}'`,
      'truncate gov_repo.l14_policy_version_heads',
      `update gov_repo.l14_policy_version_heads set latest_state_id='${v1}' where organisation_id='${ctx.org}' and version_id='${s.versionId}'`,
    ]) {
      await assert.rejects(c.bootstrapSql(`begin; ${sql}; rollback;`), /L14_HISTORY_IMMUTABLE|55000/, sql);
    }
  });

  await t.test('[21,22,23,24,25,26] temporal: future-dated not current early; authorized backdating; unauthorized dating is a durable DENY; recorded cutoff', async () => {
    const s = await k.admitted(ctx, 'tf');
    const future = await k.instant('2 hours');
    const fp = k.validateProposal(s, future);
    const fs = await k.submit(ctx, ctx.member, 'tf-s', fp);
    // [26] the plain validator has no future-dating grant.
    const denied = await exec(k.decideSqlFor(ctx.validator, ctx.cmd('tf-deny'), fs.proposal_id, fp, 'VALIDATE', null));
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED']);
    const v = await exec(k.decideSqlFor(ctx.flex, ctx.cmd('tf-ok'), fs.proposal_id, fp, 'VALIDATE', null));
    assert.equal(v.outcome, 'VALIDATED');
    assert.equal(await k.canonical(v.effective_from), future);
    const d = await k.descriptor(ctx.member, s);
    assert.deepEqual([d.validation_state, d.validation_state_id, d.latest_validation_state_id], ['NOT_VALIDATED', null, v.registry_state_id],
      '[23] a future-dated VALIDATED state is not VALIDATED now');
    assert.equal(await k.resolve(ctx.org, s, 'clock_timestamp()', 'clock_timestamp()'), null);
    assert.equal(await k.resolve(ctx.org, s, `${ts(future)} + interval '1 second'`, 'clock_timestamp()'), v.registry_state_id);
    // Backdating.
    const b = await k.admitted(ctx, 'tb');
    const past = await k.instant('-3 hours');
    const bp = k.validateProposal(b, past);
    const bs = await k.submit(ctx, ctx.member, 'tb-s', bp);
    const bdeny = await exec(k.decideSqlFor(ctx.validator, ctx.cmd('tb-deny'), bs.proposal_id, bp, 'VALIDATE', null));
    assert.deepEqual([bdeny.outcome, bdeny.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED'], '[25]');
    const bv = await exec(k.decideSqlFor(ctx.flex, ctx.cmd('tb-ok'), bs.proposal_id, bp, 'VALIDATE', null));
    assert.equal(await k.canonical(bv.effective_from), past, '[24] authorized backdating');
    const env = await envelope(bv.registry_state_id);
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} + interval '1 minute'`, 'clock_timestamp()'), bv.registry_state_id);
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} + interval '1 minute'`, `${ts(env.recorded_at)} - interval '1 microsecond'`), null,
      '[22] not yet known before its recorded instant');
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} - interval '1 minute'`, 'clock_timestamp()'), null, 'not effective before its start');
    // [21] REVOKE cannot precede the target's effective_from; equality (cancellation from the start) is legal.
    const early = await k.instant('-4 hours');
    const rp = k.revokeProposal(b, bv.registry_state_id, early);
    const rs = await k.submit(ctx, ctx.member, 'tb-rs', rp);
    await rejects(c.svc(k.decideSqlFor(ctx.flex, ctx.cmd('tb-revoke-early'), rs.proposal_id, rp, 'REVOKE', bv.registry_state_id)), 'GV011', /REVOKE_BEFORE_TARGET_EFFECTIVE/);
    const cp = k.revokeProposal(b, bv.registry_state_id, past);
    const cs = await k.submit(ctx, ctx.member, 'tb-cs', cp);
    const cancelled = await exec(k.decideSqlFor(ctx.flex, ctx.cmd('tb-cancel'), cs.proposal_id, cp, 'REVOKE', bv.registry_state_id));
    assert.equal(cancelled.outcome, 'REVOKED');
    const cenv = await envelope(cancelled.registry_state_id);
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} + interval '1 minute'`, 'clock_timestamp()'), null, 'cancelled from its own start');
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} + interval '1 minute'`, `${ts(cenv.recorded_at)} - interval '1 microsecond'`), bv.registry_state_id,
      'the earlier knowledge stays visible at an earlier recorded cutoff');
    // Pending cancellation of the future-dated state at its own instant.
    const pp = k.revokeProposal(s, v.registry_state_id, future);
    const ps = await k.submit(ctx, ctx.member, 'tf-ps', pp);
    assert.equal((await exec(k.decideSqlFor(ctx.flex, ctx.cmd('tf-cancel'), ps.proposal_id, pp, 'REVOKE', v.registry_state_id))).outcome, 'REVOKED');
    assert.equal(await k.resolve(ctx.org, s, `${ts(future)} + interval '1 second'`, 'clock_timestamp()'), null);
  });

  await t.test('[27,28,29] re-validation after a tombstone pins the predecessor; overlapping re-validation and stale expectations are rejected', async () => {
    const s = await k.admitted(ctx, 're');
    const v1 = (await k.validate(ctx, 're1', s)).decided;
    // [28] a second VALIDATED over a VALIDATED head never exists.
    const dup = k.validateProposal(s);
    const ds = await k.submit(ctx, ctx.member, 're-dup', dup);
    await rejects(c.svc(k.decideSqlFor(ctx.validator, ctx.cmd('re-dup-v'), ds.proposal_id, dup, 'VALIDATE', v1.registry_state_id)), 'GV010', /POLICY_VERSION_ALREADY_VALIDATED/);
    // [29] stale / blind expectations.
    await rejects(c.svc(k.decideSqlFor(ctx.validator, ctx.cmd('re-blind'), ds.proposal_id, dup, 'DEFER', null)), 'GV009', /POLICY_VERSION_STATE_EXISTS/);
    await rejects(c.svc(k.decideSqlFor(ctx.validator, ctx.cmd('re-stale'), ds.proposal_id, dup, 'DEFER', ds.proposal_id)), 'GV009', /POLICY_VERSION_STATE_EXPECTATION_MISMATCH/);
    const r1 = (await k.revoke(ctx, 're-r1', s, v1.registry_state_id)).decided;
    // [28] a backdated re-validation before the tombstone overlaps the revoked interval.
    const back = k.validateProposal(s, await k.instant('-1 hour'));
    const bs = await k.submit(ctx, ctx.member, 're-back', back);
    await rejects(c.svc(k.decideSqlFor(ctx.flex, ctx.cmd('re-back-v'), bs.proposal_id, back, 'VALIDATE', r1.registry_state_id)), 'GV011', /REVALIDATION_OVERLAPS_PRIOR_INTERVAL/);
    // [27] the SAME exact tuple is re-validated (no new version is invented); the predecessor is the tombstone.
    const v2 = (await k.validate(ctx, 're2', s)).decided;
    assert.equal(v2.outcome, 'VALIDATED');
    const d2 = await row(`select to_json(d) from gov_repo.l14_policy_version_states d where state_id='${v2.registry_state_id}'`);
    assert.deepEqual([d2.predecessor_state_id, d2.version_id, d2.content_hash], [r1.registry_state_id, s.versionId, s.contentHash]);
    assert.equal(await one(`select string_agg(s.state_kind, '>' order by s.recorded_at) from gov_repo.l14_registry_states s
      join gov_repo.l14_policy_version_states d using (organisation_id, state_id) where d.version_id='${s.versionId}'`), 'VALIDATED>REVOKED>VALIDATED');
    assert.equal(await one(`select count(*) from gov_repo.l14_policy_version_admissions where policy_id='${s.policyId}'`), '1', 'no version invented');
    assert.equal((await k.descriptor(ctx.member, s)).validation_state, 'VALIDATED');
    assert.equal(await k.resolve(ctx.org, s, 'clock_timestamp()', 'clock_timestamp()'), v2.registry_state_id);
  });

  await t.test('[34,35,36,37] replay: exact original result; durable DENY survives later authority; changed payload GV007; wrong fingerprint GV008', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'rp');
    const proposal = k.validateProposal(s);
    const submitSql = k.submitSql(x.member, { commandId: x.cmd('rp-s'), proposal });
    const submitted = await exec(submitSql);
    const allowSql = k.decideSqlFor(x.validator, x.cmd('rp-v'), submitted.proposal_id, proposal, 'VALIDATE', null);
    const denySql = k.decideSqlFor(x.member, x.cmd('rp-d'), submitted.proposal_id, proposal, 'DEFER', null);
    const denied = await exec(denySql);
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    const allowed = await exec(allowSql);
    // Authority changes AFTER the originals.
    await owner(`update gov_repo.governance_users set role_ids=array['${c.memberRole}','${k.pk.validatorRole}']::uuid[] where user_id='${x.member.id}'`);
    await owner(`update gov_repo.governance_users set role_ids=array['${c.memberRole}']::uuid[] where user_id='${x.validator.id}'`);
    const before = await k.counts(x.org);
    const history = await k.historyDigest(x.org);
    for (const [sql, original] of [[submitSql, submitted], [allowSql, allowed], [denySql, denied]] as const) {
      const again = await exec(sql);
      assert.equal(again.replay, true);
      assert.deepEqual({ ...again, replay: false }, original, 'the ORIGINAL durable result (ids, recorded_at, effective_from, decision, state)');
    }
    assert.deepEqual(await k.counts(x.org), before, 'replay writes nothing');
    assert.equal(await k.historyDigest(x.org), history);
    // [36] same command id, changed payload.
    await rejects(c.svc(k.decideSqlFor(x.validator, x.cmd('rp-v'), submitted.proposal_id, proposal, 'REJECT', null)), 'GV007');
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rp-s'), proposal: k.validateProposal(s, await k.instant('1 hour')) })), 'GV007');
    // [37] the caller's fingerprint is an assertion only.
    const wrong = decidePolicyVersionProposalFingerprint({ organisationId: x.org, actorUserId: x.member.id, outcome: 'REJECT',
      proposalId: submitted.proposal_id, proposal, expectedCurrentStateId: null, support: { status: 'NONE', evidenceIds: [] } });
    await rejects(c.svc(k.decideSql(x.validator, { commandId: x.cmd('rp-fp'), proposalId: submitted.proposal_id, proposal, outcome: 'REJECT',
      expected: allowed.registry_state_id, fingerprint: wrong })), 'GV008');
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rp-fp2'), proposal, fingerprint: 'f'.repeat(64) })), 'GV008');
    // Changed eligibility needs a NEW command id: the member (now a validator) is authorized for a new one.
    const p2 = await k.submit(x, x.author, 'rp-s2', k.revokeProposal(s, allowed.registry_state_id));
    assert.equal((await exec(k.decideSqlFor(x.member, x.cmd('rp-new'), p2.proposal_id, k.revokeProposal(s, allowed.registry_state_id), 'REVOKE', allowed.registry_state_id))).outcome, 'REVOKED');
  });

  await t.test('[9,10,32,33,38] authority: CURRENT roles and the CURRENT effective Authority Policy govern; self-validation follows the policy; CONTRIBUTING never authorizes', async () => {
    const x = await k.setup();
    // [38] the validator proposing and validating its own proposal: denied unless the matched rule allows self-validation.
    const s1 = await k.admitted(x, 'self');
    const p1 = k.validateProposal(s1);
    const own = await k.submit(x, x.validator, 'self-s', p1);
    const self = await exec(k.decideSqlFor(x.validator, x.cmd('self-v'), own.proposal_id, p1, 'VALIDATE', null));
    assert.deepEqual([self.outcome, self.deny_reason], ['DENIED', 'SELF_VALIDATION_NOT_PERMITTED']);
    assert.equal((await authz(self.authorization_decision_id)).is_self_validation, true);
    const flexOwn = await k.submit(x, x.flex, 'self-fs', p1);
    assert.equal((await exec(k.decideSqlFor(x.flex, x.cmd('self-fv'), flexOwn.proposal_id, p1, 'VALIDATE', null))).outcome, 'VALIDATED',
      'a self-validation grant on the matched rule authorizes it');
    // CONTRIBUTING rule never authorizes.
    const s2 = await k.admitted(x, 'auth');
    const p2 = k.validateProposal(s2);
    const sub2 = await k.submit(x, x.member, 'auth-s', p2);
    const contrib = await exec(k.decideSqlFor(x.contribValidator, x.cmd('auth-c'), sub2.proposal_id, p2, 'VALIDATE', null));
    assert.deepEqual([contrib.outcome, contrib.deny_reason], ['DENIED', 'SOURCE_NOT_AUTHORIZED']);
    // A different permission family (S1B.3 content ADMIT, Party ADMIT) never validates.
    for (const [actor, name] of [[x.author, 'auth-author'], [x.party, 'auth-party'], [x.boot, 'auth-admin']] as const) {
      const r = await exec(k.decideSqlFor(actor, x.cmd(name), sub2.proposal_id, p2, 'VALIDATE', null));
      assert.deepEqual([r.outcome, r.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE'], name);
    }
    // [32] role removed → the CURRENT persisted roles govern.
    await owner(`update gov_repo.governance_users set role_ids=array['${c.memberRole}']::uuid[] where user_id='${x.validator2.id}'`);
    const gone = await exec(k.decideSqlFor(x.validator2, x.cmd('auth-v2'), sub2.proposal_id, p2, 'VALIDATE', null));
    assert.deepEqual([gone.outcome, gone.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    // [33] a successor Authority Policy removing the validator's VALIDATE grant governs the next command.
    const v2 = await k.pk.apSuccessor(x, 'auth-ap2', k.validationRules(2, {}, [`${k.pk.validatorRole}:L14_POLICY_VERSION_VALIDATE:VALIDATE`]));
    const after = await exec(k.decideSqlFor(x.validator, x.cmd('auth-v'), sub2.proposal_id, p2, 'VALIDATE', null));
    assert.deepEqual([after.outcome, after.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    assert.equal((await authz(after.authorization_decision_id)).basis_version_id, v2.admitted.version_id);
  });
});
