import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asBusinessDomainId, asInformationDomainId, asOrganisationId, l14DomainSubjectOf } from '@council/canonical-contracts';
import { decideDomainProposalFingerprint, domainContentHash } from '@council/governance-review';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { domainKit } from '../helpers/m16-l14-domain-fixtures';

/**
 * M16-S1B.5 — BUSINESS_DOMAIN / INFORMATION_DOMAIN governed-registry lifecycle on real disposable PostgreSQL 17 (S1B5
 * horizon). Every command goes through the real public RPCs as service_role; every Authority Policy through the real AP
 * RPCs. Owner access is used only to read evidence and for rolled-back structural probes.
 */
test('M16 S1B.5 domain registry lifecycle (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B5' });
  t.after(() => c.stop());
  const { owner, exec, rejects } = c;
  const k = await domainKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const row = async (query: string) => JSON.parse(await one(`select coalesce((${query}), 'null'::json)`));
  const authz = (id: string) => row(`select to_json(a) from gov_repo.l14_authorization_decisions a where authorization_decision_id='${id}'`);
  const envelope = (id: string) => row(`select to_json(s) from gov_repo.l14_registry_states s where state_id='${id}'`);
  const ts = (value: string) => `'${value}'::timestamptz`;
  const ctx = await k.setup();

  // ---------------------------------------------------------------------------------------
  await t.test('ADMIT admits the existing L6 identity verbatim: ALLOW authorization pinned, empty head, no decision / state / trust', async () => {
    const l6 = l14DomainSubjectOf({ semanticIdentityKind: 'BUSINESS_DOMAIN', organisationId: asOrganisationId(ctx.org),
      businessDomainId: asBusinessDomainId('business-domain:customer') });
    assert.deepEqual(l6, { subjectKind: 'BUSINESS_DOMAIN', domainId: 'business-domain:customer' }, 'no parallel id namespace');
    await c.evidence(ctx.org, 'adm-ev-1');
    const before = await k.counts(ctx.org);
    const r = await exec(k.admitSql(ctx.registrar, { commandId: ctx.cmd('adm-1'), subject: l6, support: { status: 'PRESENT', evidenceIds: ['adm-ev-1'] } }));
    assert.deepEqual([r.outcome, r.command_kind, r.subject_kind, r.domain_id, r.replay, r.authorization_result, r.proposal_id,
      r.governance_decision_id, r.registry_state_id], ['ADMITTED', 'ADMIT_BUSINESS_DOMAIN', 'BUSINESS_DOMAIN', 'business-domain:customer',
      false, 'ALLOW', null, null, null]);
    const adm = await row(`select to_json(a) from gov_repo.l14_domain_admissions a where organisation_id='${ctx.org}' and domain_id='business-domain:customer'`);
    assert.deepEqual({ kind: adm.subject_kind, src: adm.source_class, by: adm.admitted_by_actor_user_id, authz: adm.admission_authorization_decision_id,
      support: adm.support_status }, { kind: 'BUSINESS_DOMAIN', src: 'LOCAL_HUMAN', by: ctx.registrar.id, authz: r.authorization_decision_id, support: 'PRESENT' });
    const a = await authz(r.authorization_decision_id);
    assert.deepEqual({ action: a.requested_action, subject: a.subject_kind, scope: a.scope_tag, exp: a.expectation_kind, hash: a.attempted_content_hash,
      basis: a.basis_version_id }, { action: 'ADMIT', subject: 'BUSINESS_DOMAIN', scope: 'ALL_ALLOWED_TARGETS', exp: 'EXPECTED_NONE',
      hash: domainContentHash('BUSINESS_DOMAIN', 'business-domain:customer'), basis: ctx.v1.version_id });
    assert.equal(await one(`select string_agg(permission||'/'||requested_action, ',') from gov_repo.l14_authorization_decision_rules
      where authorization_decision_id='${r.authorization_decision_id}'`), 'L14_DOMAIN_ADMIT/ADMIT');
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where owner_kind='ADMISSION'
      and admission_authorization_decision_id='${r.authorization_decision_id}' and admission_subject_kind='BUSINESS_DOMAIN' and evidence_id='adm-ev-1'`), '1');
    assert.deepEqual(await k.head(ctx.org, l6), { organisation_id: ctx.org, subject_kind: 'BUSINESS_DOMAIN', domain_id: l6.domainId, latest_state_id: null });
    const after = await k.counts(ctx.org);
    for (const table of ['l14_proposals', 'l14_governance_decisions', 'l14_registry_states', 'l14_domain_states', 'l14_domain_proposals']) {
      assert.equal(after[table], before[table], `${table}: admission is not validation`);
    }
    assert.equal(await k.resolve(ctx.org, l6, 'clock_timestamp()', 'clock_timestamp()'), null, 'admitted, never validated');
  });

  await t.test('the two kinds are distinct namespaces; a second ADMIT of the same identity is a stale expectation (GV009, nothing written)', async () => {
    const id = `shared-id-${ctx.label}`;
    const info = l14DomainSubjectOf({ semanticIdentityKind: 'INFORMATION_DOMAIN', organisationId: asOrganisationId(ctx.org),
      informationDomainId: asInformationDomainId(id) });
    const biz = { subjectKind: 'BUSINESS_DOMAIN', domainId: id } as const;
    const ri = await k.admit(ctx, ctx.registrar, 'ns-info', info);
    const rb = await k.admit(ctx, ctx.registrar, 'ns-biz', biz);
    assert.deepEqual([ri.command_kind, ri.subject_kind, rb.command_kind, rb.subject_kind],
      ['ADMIT_INFORMATION_DOMAIN', 'INFORMATION_DOMAIN', 'ADMIT_BUSINESS_DOMAIN', 'BUSINESS_DOMAIN']);
    assert.equal(await one(`select count(*) from gov_repo.l14_domain_admissions where organisation_id='${ctx.org}' and domain_id=${`'${id}'`}`), '2');
    const before = await k.counts(ctx.org);
    await rejects(c.svc(k.admitSql(ctx.registrar2, { commandId: ctx.cmd('ns-again'), subject: info })), 'GV009', /DOMAIN_ALREADY_ADMITTED/);
    assert.deepEqual(await k.counts(ctx.org), before, 'no authorization consumed, nothing admitted');
    // Another tenant may admit the same L6 id value: tenant isolation is part of every key.
    const other = await k.setup();
    assert.equal((await k.admit(other, other.registrar, 'ns-other', info)).outcome, 'ADMITTED');
  });

  await t.test('ADMIT shape: unknown kind / malformed id / expectation / source are rejected before any read; non-LOCAL_HUMAN is not executable', async () => {
    const s = k.subject('BUSINESS_DOMAIN', 'shape');
    const before = await k.counts(ctx.org);
    const fp = 'f'.repeat(64);
    for (const [name, input, detail] of [
      ['kind', { subject: { subjectKind: 'CONTROL_DEFINITION', domainId: s.domainId }, fingerprint: fp }, /DOMAIN_KIND_UNKNOWN/],
      ['party kind', { subject: { subjectKind: 'GOVERNANCE_PARTY', domainId: s.domainId }, fingerprint: fp }, /DOMAIN_KIND_UNKNOWN/],
      ['empty id', { subject: { ...s, domainId: '' }, fingerprint: fp }, /DOMAIN_ID_MALFORMED/],
      ['padded id', { subject: { ...s, domainId: ` ${s.domainId}` }, fingerprint: fp }, /DOMAIN_ID_MALFORMED/],
      ['control char', { subject: { ...s, domainId: `${s.domainId}\u0001x` }, fingerprint: fp }, /DOMAIN_ID_MALFORMED/],
      ['too long', { subject: { ...s, domainId: 'x'.repeat(501) }, fingerprint: fp }, /DOMAIN_ID_MALFORMED/],
      ['expectation', { subject: s, expectation: 'EXPECTED_CURRENT' }, /EXPECTATION_MALFORMED/],
      ['source', { subject: s, sourceClass: 'SCANNER', fingerprint: fp }, /SOURCE_CLASS_UNKNOWN/],
      ['seed', { subject: s, sourceClass: 'SYSTEM_SEED' }, /SOURCE_CLASS_NOT_EXECUTABLE/],
      ['connection', { subject: s, sourceClass: 'SOURCE_CONNECTION' }, /SOURCE_CLASS_NOT_EXECUTABLE/],
    ] as const) {
      await rejects(c.svc(k.admitSql(ctx.registrar, { commandId: ctx.cmd(`shape-${name}`), ...input } as never)), 'GV010', detail);
    }
    assert.equal((await k.admit(ctx, ctx.registrar, 'shape-500', { ...s, domainId: 'y'.repeat(500) })).outcome, 'ADMITTED', '500 characters is legal');
    const after = await k.counts(ctx.org);
    assert.equal(after.l14_authorization_decisions, before.l14_authorization_decisions + 1);
  });

  await t.test('unauthorized ADMIT is a durable DENY that admits nothing; the next authorized ADMIT of the same identity succeeds', async () => {
    const s = k.subject('INFORMATION_DOMAIN', 'deny');
    for (const [actor, name, reason] of [
      [ctx.member, 'member', 'NO_MATCHING_AUTHORITY_RULE'], [ctx.steward, 'steward', 'NO_MATCHING_AUTHORITY_RULE'],
      [ctx.party, 'party', 'NO_MATCHING_AUTHORITY_RULE'], [ctx.boot, 'admin', 'NO_MATCHING_AUTHORITY_RULE'],
      [ctx.contrib, 'contrib', 'SOURCE_NOT_AUTHORIZED'],
    ] as const) {
      const r = await exec(k.admitSql(actor, { commandId: ctx.cmd(`deny-${name}`), subject: s }));
      assert.deepEqual([r.outcome, r.authorization_result, r.deny_reason, r.domain_id, r.subject_kind], ['DENIED', 'DENY', reason, null, 'INFORMATION_DOMAIN'], name);
      assert.equal((await authz(r.authorization_decision_id)).attempted_content_hash, domainContentHash('INFORMATION_DOMAIN', s.domainId));
    }
    assert.equal(await k.head(ctx.org, s), null);
    assert.equal(await one(`select count(*) from gov_repo.l14_domain_admissions where domain_id='${s.domainId}'`), '0');
    assert.equal((await k.admit(ctx, ctx.registrar, 'deny-ok', s)).outcome, 'ADMITTED');
    // No effective Authority Policy: durable NO_EFFECTIVE_AUTHORITY (no bootstrap path for a registry subject).
    const bare = await k.setup(undefined, { bootstrap: false });
    const r = await exec(k.admitSql(bare.registrar, { commandId: bare.cmd('noap'), subject: s }));
    assert.deepEqual([r.outcome, r.deny_reason], ['DENIED', 'NO_EFFECTIVE_AUTHORITY']);
    assert.equal((await authz(r.authorization_decision_id)).authority_basis, null);
  });

  await t.test('SUBMIT: SUBMITTED only for an admitted identity of this tenant and kind; no authority, decision, state or head change', async () => {
    const s = await k.admitted(ctx, 'sub');
    await c.evidence(ctx.org, 'sub-ev-1');
    const before = await k.counts(ctx.org);
    const r = await exec(k.submitSql(ctx.member, { commandId: ctx.cmd('sub-1'), proposal: k.validateProposal(s),
      support: { status: 'PRESENT', evidenceIds: ['sub-ev-1'] } }));
    assert.deepEqual([r.outcome, r.command_kind, r.subject_kind, r.domain_id, r.authorization_decision_id, r.governance_decision_id, r.registry_state_id],
      ['SUBMITTED', 'SUBMIT_PROPOSAL', 'BUSINESS_DOMAIN', s.domainId, null, null, null]);
    const detail = await row(`select to_json(t) from gov_repo.l14_domain_proposals t where proposal_id='${r.proposal_id}'`);
    assert.deepEqual([detail.subject_kind, detail.intent, detail.domain_id, detail.requested_effective_from, detail.target_state_id],
      ['BUSINESS_DOMAIN', 'VALIDATE', s.domainId, null, null]);
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where owner_kind='PROPOSAL' and proposal_id='${r.proposal_id}'`), '1');
    const after = await k.counts(ctx.org);
    for (const table of ['l14_authorization_decisions', 'l14_governance_decisions', 'l14_registry_states', 'l14_domain_states']) {
      assert.equal(after[table], before[table], `${table}: a proposal is not validation authority`);
    }
    assert.equal((await k.head(ctx.org, s))!.latest_state_id, null);
    // Never admitted, other kind, foreign tenant: indistinguishable (GV010), nothing written.
    const foreign = await k.setup();
    const fs = await k.admitted(foreign, 'fx');
    const mid = await k.counts(ctx.org);
    for (const [name, subject] of [['never admitted', k.subject('BUSINESS_DOMAIN', 'nope')], ['other kind', { ...s, subjectKind: 'INFORMATION_DOMAIN' }],
      ['foreign tenant', fs]] as const) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`sub-${name}`), proposal: k.validateProposal(subject) })), 'GV010', /DOMAIN_NOT_ADMITTED/);
    }
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('sub-src'), proposal: { ...k.validateProposal(s), sourceClass: 'SOURCE_CONNECTION' } })),
      'GV010', /SOURCE_CLASS_NOT_EXECUTABLE/);
    assert.deepEqual(await k.counts(ctx.org), mid);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('sub-session'), proposal: k.validateProposal(s), session: { org: foreign.org } })), 'GV003');
    // Owner-level forgery: a relabelled envelope over a LOCAL_HUMAN admission cannot gain typed detail.
    await assert.rejects(c.bootstrapSql(`begin; insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
      values('${ctx.org}','11111111-1111-4111-8111-111111111111','BUSINESS_DOMAIN','VALIDATE','SOURCE_CONNECTION','${ctx.member.id}','NONE',now());
      insert into gov_repo.l14_domain_proposals(organisation_id,proposal_id,subject_kind,intent,domain_id)
      values('${ctx.org}','11111111-1111-4111-8111-111111111111','BUSINESS_DOMAIN','VALIDATE','${s.domainId}'); rollback;`), /DOMAIN_PROPOSAL_SOURCE_MISMATCH/);
    // ... nor typed detail of the other kind over a same-id envelope.
    await assert.rejects(c.bootstrapSql(`begin; insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
      values('${ctx.org}','22222222-2222-4222-8222-222222222222','INFORMATION_DOMAIN','VALIDATE','LOCAL_HUMAN','${ctx.member.id}','NONE',now());
      insert into gov_repo.l14_domain_proposals(organisation_id,proposal_id,subject_kind,intent,domain_id)
      values('${ctx.org}','22222222-2222-4222-8222-222222222222','BUSINESS_DOMAIN','VALIDATE','${s.domainId}'); rollback;`), /DOMAIN_PROPOSAL_SOURCE_MISMATCH/,
      'the guard finds no same-kind envelope (the envelope FK would reject it next)');
  });

  let lifecycle: { s: any; v1: string } | null = null;
  await t.test('first VALIDATE: exact governed state pinned to the admitted domain; L14_DOMAIN_VALIDATE over CURRENT roles + effective AP', async () => {
    const s = await k.admitted(ctx, 'val', 'INFORMATION_DOMAIN');
    await c.evidence(ctx.org, 'val-ev-1');
    const proposal = k.validateProposal(s);
    const submitted = await k.submit(ctx, ctx.member, 'val-submit', proposal);
    // The reason code is the proposal kind's: another kind's code is never accepted.
    await rejects(c.svc(k.decideSql(ctx.steward, { commandId: ctx.cmd('val-code'), proposalId: submitted.proposal_id, proposal,
      reasonCode: 'BUSINESS_DOMAIN_VALIDATED', fingerprint: 'f'.repeat(64) })), 'GV010', /DECISION_VOCABULARY_INVALID/);
    await rejects(c.svc(k.decideSql(ctx.steward, { commandId: ctx.cmd('val-code2'), proposalId: submitted.proposal_id, proposal,
      reasonCode: 'GOVERNANCE_PARTY_VALIDATED', fingerprint: 'f'.repeat(64) })), 'GV010', /DECISION_VOCABULARY_INVALID/);
    const r = await exec(k.decideSql(ctx.steward, { commandId: ctx.cmd('val-validate'), proposalId: submitted.proposal_id, proposal,
      support: { status: 'PRESENT', evidenceIds: ['val-ev-1'] } }));
    assert.deepEqual([r.outcome, r.state_kind, r.subject_kind, r.domain_id, r.authorization_result, r.deny_reason],
      ['VALIDATED', 'VALIDATED', 'INFORMATION_DOMAIN', s.domainId, 'ALLOW', null]);
    const st = await row(`select to_json(d) from gov_repo.l14_domain_states d where state_id='${r.registry_state_id}'`);
    assert.deepEqual([st.subject_kind, st.state_kind, st.domain_id, st.predecessor_state_id, st.revokes_state_id],
      ['INFORMATION_DOMAIN', 'VALIDATED', s.domainId, null, null]);
    const env = await envelope(r.registry_state_id);
    assert.deepEqual({ subject: env.subject_kind, trust: env.trust_state, source: env.source_class, decision: env.governance_decision_id,
      authz: env.authorization_decision_id, basis: env.authority_policy_version_id, support: env.support_status },
    { subject: 'INFORMATION_DOMAIN', trust: 'VALIDATED', source: 'LOCAL_HUMAN', decision: r.governance_decision_id,
      authz: r.authorization_decision_id, basis: ctx.v1.version_id, support: 'PRESENT' });
    const a = await authz(r.authorization_decision_id);
    assert.deepEqual({ action: a.requested_action, subject: a.subject_kind, scope: a.scope_tag, exp: a.expectation_kind, self: a.is_self_validation,
      proposal: a.proposal_id, hash: a.attempted_content_hash }, { action: 'VALIDATE', subject: 'INFORMATION_DOMAIN', scope: 'ALL_ALLOWED_TARGETS',
      exp: 'EXPECTED_NONE', self: false, proposal: submitted.proposal_id, hash: null });
    assert.equal(await one(`select string_agg(permission||'/'||requested_action||'/'||source_class||'/'||source_disposition||'/'||scope_tag, ',')
      from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${r.authorization_decision_id}'`),
    'L14_DOMAIN_VALIDATE/VALIDATE/LOCAL_HUMAN/AUTHORITATIVE/ALL_ALLOWED_TARGETS');
    assert.equal(await one(`select string_agg(role_id::text, ',') from gov_repo.l14_authorization_decision_roles where authorization_decision_id='${r.authorization_decision_id}'`),
      k.stewardRole);
    assert.equal(await one(`select reason_code from gov_repo.l14_governance_decisions where governance_decision_id='${r.governance_decision_id}'`), 'INFORMATION_DOMAIN_VALIDATED');
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where evidence_id='val-ev-1' and
      ((owner_kind='GOVERNANCE_DECISION' and governance_decision_id='${r.governance_decision_id}') or (owner_kind='REGISTRY_STATE' and registry_state_id='${r.registry_state_id}'))`), '2');
    assert.equal((await k.head(ctx.org, s))!.latest_state_id, r.registry_state_id);
    assert.equal(await k.resolve(ctx.org, s, 'clock_timestamp()', 'clock_timestamp()'), r.registry_state_id);
    // The same id under the other kind is a different subject: never validated by this decision.
    assert.equal(await k.resolve(ctx.org, { ...s, subjectKind: 'BUSINESS_DOMAIN' }, 'clock_timestamp()', 'clock_timestamp()'), null);
    // A domain validation validates nothing else (ADR §4): no assignment / applicability / other subject is created.
    assert.equal(await one(`select count(*) from gov_repo.l14_proposals where organisation_id='${ctx.org}'
      and subject_kind not in ('BUSINESS_DOMAIN','INFORMATION_DOMAIN','AUTHORITY_POLICY_VERSION')`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_registry_states where organisation_id='${ctx.org}'
      and subject_kind not in ('BUSINESS_DOMAIN','INFORMATION_DOMAIN')`), '0');
    assert.equal(await one(`select count(*) from gov_repo.canonical_objects where organisation_id='${ctx.org}'`), '0');
    lifecycle = { s, v1: r.registry_state_id };
  });

  await t.test('REJECT = decision without state; DEFER is non-terminal; a terminal proposal is never reused; correction = new linked proposal', async () => {
    const s = await k.admitted(ctx, 'rd');
    const proposal = k.validateProposal(s);
    const p1 = await k.submit(ctx, ctx.member, 'rd-p1', proposal);
    const deferred = await exec(k.decideSqlFor(ctx.steward, ctx.cmd('rd-defer'), p1.proposal_id, proposal, 'DEFER', null));
    assert.deepEqual([deferred.outcome, deferred.registry_state_id], ['DEFERRED', null]);
    const rejected = await exec(k.decideSqlFor(ctx.steward, ctx.cmd('rd-reject'), p1.proposal_id, proposal, 'REJECT', null));
    assert.deepEqual([rejected.outcome, rejected.registry_state_id, rejected.state_kind], ['REJECTED', null, null]);
    assert.equal(await one(`select string_agg(outcome||':'||reason_code, ',' order by decided_at) from gov_repo.l14_governance_decisions where proposal_id='${p1.proposal_id}'`),
      'DEFER:BUSINESS_DOMAIN_DEFERRED,REJECT:BUSINESS_DOMAIN_REJECTED');
    assert.equal((await k.head(ctx.org, s))!.latest_state_id, null, 'no state');
    for (const outcome of ['VALIDATE', 'REJECT', 'DEFER'] as const) {
      await rejects(c.svc(k.decideSqlFor(ctx.steward, ctx.cmd(`rd-again-${outcome}`), p1.proposal_id, proposal, outcome, null)), 'GV010', /PROPOSAL_TERMINAL/);
    }
    await rejects(c.svc(k.decideSqlFor(ctx.steward, ctx.cmd('rd-revoke-on-validate'), p1.proposal_id, proposal, 'REVOKE', null)), 'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    const other = await k.admitted(ctx, 'rd-other');
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rd-bad-prior'), proposal: k.validateProposal(other), prior: p1.proposal_id })),
      'GV010', /PRIOR_PROPOSAL_UNRESOLVED/);
    const p2 = await k.submit(ctx, ctx.member, 'rd-p2', proposal, p1.proposal_id);
    assert.equal(await one(`select prior_proposal_id from gov_repo.l14_proposals where proposal_id='${p2.proposal_id}'`), p1.proposal_id);
    assert.equal((await exec(k.decideSqlFor(ctx.steward, ctx.cmd('rd-validate-p2'), p2.proposal_id, proposal, 'VALIDATE', null))).outcome, 'VALIDATED');
    // A proposal of another registry subject is never decided here.
    const apProposal = await one(`select proposal_id from gov_repo.l14_proposals where organisation_id='${ctx.org}' and subject_kind='AUTHORITY_POLICY_VERSION' limit 1`);
    await rejects(c.svc(k.decideSqlFor(ctx.steward, ctx.cmd('rd-ap'), apProposal, proposal, 'VALIDATE', null)), 'GV010', /PROPOSAL_UNRESOLVED/);
  });

  await t.test('REVOKE pins the exact VALIDATED state, appends a tombstone, never mutates the target; history immutable', async () => {
    assert.ok(lifecycle);
    const { s, v1 } = lifecycle!;
    const targetRow = await one(`select s::text||'|'||d::text from gov_repo.l14_registry_states s join gov_repo.l14_domain_states d using (organisation_id, state_id) where state_id='${v1}'`);
    const other = await k.admitted(ctx, 'rv-other', 'INFORMATION_DOMAIN');
    const ov = await k.validate(ctx, 'rv-other', other);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rv-cross'), proposal: k.revokeProposal(s, ov.decided.registry_state_id) })),
      'GV010', /TARGET_STATE_UNRESOLVED/);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rv-none'), proposal: { ...k.revokeProposal(s, v1), targetStateId: null }, fingerprint: 'f'.repeat(64) })),
      'GV010', /TARGET_STATE_REQUIRED/);
    const r = await k.revoke(ctx, 'rv', s, v1);
    assert.deepEqual([r.decided.outcome, r.decided.state_kind], ['REVOKED', 'REVOKED']);
    const tomb = await row(`select to_json(d) from gov_repo.l14_domain_states d where state_id='${r.decided.registry_state_id}'`);
    assert.deepEqual([tomb.revokes_state_id, tomb.predecessor_state_id, tomb.subject_kind, tomb.domain_id], [v1, v1, s.subjectKind, s.domainId]);
    assert.equal(await one(`select s::text||'|'||d::text from gov_repo.l14_registry_states s join gov_repo.l14_domain_states d using (organisation_id, state_id) where state_id='${v1}'`),
      targetRow, 'the target VALIDATED state is byte-identical');
    assert.equal(await k.resolve(ctx.org, s, 'clock_timestamp()', 'clock_timestamp()'), null);
    const env = await envelope(v1);
    assert.equal(await k.resolve(ctx.org, s, ts(env.effective_from), ts(env.recorded_at)), v1, 'historical readback stays intact');
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rv-again'), proposal: k.revokeProposal(s, v1) })), 'GV010', /TARGET_ALREADY_REVOKED/);
    for (const sql of [
      `update gov_repo.l14_domain_states set state_kind=state_kind where state_id='${v1}'`,
      `delete from gov_repo.l14_domain_states where state_id='${v1}'`,
      'truncate gov_repo.l14_domain_states cascade',
      `update gov_repo.l14_domain_proposals set requested_effective_from=now() where organisation_id='${ctx.org}'`,
      `delete from gov_repo.l14_domain_proposals where organisation_id='${ctx.org}'`,
      'truncate gov_repo.l14_domain_proposals cascade',
      `update gov_repo.l14_domain_admissions set support_status='NONE' where organisation_id='${ctx.org}'`,
      `update gov_repo.l14_domain_admissions set domain_id=domain_id||'x' where organisation_id='${ctx.org}'`,
      `delete from gov_repo.l14_domain_admissions where organisation_id='${ctx.org}'`,
      'truncate gov_repo.l14_domain_admissions cascade',
      `update gov_repo.l14_registry_states set effective_from=now() where state_id='${v1}'`,
      `delete from gov_repo.l14_domain_heads where organisation_id='${ctx.org}'`,
      'truncate gov_repo.l14_domain_heads',
      `update gov_repo.l14_domain_heads set latest_state_id='${v1}' where organisation_id='${ctx.org}' and domain_id=${`'${s.domainId}'`}`,
      `update gov_repo.l14_domain_heads set domain_id=domain_id||'x' where organisation_id='${ctx.org}' and domain_id=${`'${s.domainId}'`}`,
      `insert into gov_repo.l14_domain_heads(organisation_id,subject_kind,domain_id,latest_state_id) values('${ctx.org}','BUSINESS_DOMAIN','${s.domainId}','${v1}')`,
    ]) {
      await assert.rejects(c.bootstrapSql(`begin; ${sql}; rollback;`), /L14_HISTORY_IMMUTABLE|55000/, sql);
    }
  });

  await t.test('temporal: future-dated not current early; authorized backdating; unauthorized dating is a durable DENY; recorded cutoff; R1 interval rule', async () => {
    const s = await k.admitted(ctx, 'tf');
    const future = await k.instant('2 hours');
    const fp = k.validateProposal(s, future);
    const fs = await k.submit(ctx, ctx.member, 'tf-s', fp);
    const denied = await exec(k.decideSqlFor(ctx.steward, ctx.cmd('tf-deny'), fs.proposal_id, fp, 'VALIDATE', null));
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED']);
    const v = await exec(k.decideSqlFor(ctx.flex, ctx.cmd('tf-ok'), fs.proposal_id, fp, 'VALIDATE', null));
    assert.equal(v.outcome, 'VALIDATED');
    assert.equal(await k.canonical(v.effective_from), future);
    assert.equal(await k.resolve(ctx.org, s, 'clock_timestamp()', 'clock_timestamp()'), null, 'a future-dated VALIDATED state is not valid now');
    assert.equal(await k.resolve(ctx.org, s, `${ts(future)} + interval '1 second'`, 'clock_timestamp()'), v.registry_state_id);
    const b = await k.admitted(ctx, 'tb', 'INFORMATION_DOMAIN');
    const past = await k.instant('-3 hours');
    const bp = k.validateProposal(b, past);
    const bs = await k.submit(ctx, ctx.member, 'tb-s', bp);
    const bdeny = await exec(k.decideSqlFor(ctx.steward, ctx.cmd('tb-deny'), bs.proposal_id, bp, 'VALIDATE', null));
    assert.deepEqual([bdeny.outcome, bdeny.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED']);
    const bv = await exec(k.decideSqlFor(ctx.flex, ctx.cmd('tb-ok'), bs.proposal_id, bp, 'VALIDATE', null));
    assert.equal(await k.canonical(bv.effective_from), past, 'authorized backdating');
    const env = await envelope(bv.registry_state_id);
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} + interval '1 minute'`, 'clock_timestamp()'), bv.registry_state_id);
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} + interval '1 minute'`, `${ts(env.recorded_at)} - interval '1 microsecond'`), null,
      'not yet known before its recorded instant');
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} - interval '1 minute'`, 'clock_timestamp()'), null, 'not effective before its start');
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
    const pp = k.revokeProposal(s, v.registry_state_id, future);
    const ps = await k.submit(ctx, ctx.member, 'tf-ps', pp);
    assert.equal((await exec(k.decideSqlFor(ctx.flex, ctx.cmd('tf-cancel'), ps.proposal_id, pp, 'REVOKE', v.registry_state_id))).outcome, 'REVOKED');
    assert.equal(await k.resolve(ctx.org, s, `${ts(future)} + interval '1 second'`, 'clock_timestamp()'), null, 'pending cancellation at its own instant');
  });

  await t.test('re-validation after a tombstone pins the predecessor; overlapping re-validation and stale expectations are rejected', async () => {
    const s = await k.admitted(ctx, 're');
    const v1 = (await k.validate(ctx, 're1', s)).decided;
    const dup = k.validateProposal(s);
    const ds = await k.submit(ctx, ctx.member, 're-dup', dup);
    await rejects(c.svc(k.decideSqlFor(ctx.steward, ctx.cmd('re-dup-v'), ds.proposal_id, dup, 'VALIDATE', v1.registry_state_id)), 'GV010', /DOMAIN_ALREADY_VALIDATED/);
    await rejects(c.svc(k.decideSqlFor(ctx.steward, ctx.cmd('re-blind'), ds.proposal_id, dup, 'DEFER', null)), 'GV009', /DOMAIN_STATE_EXISTS/);
    await rejects(c.svc(k.decideSqlFor(ctx.steward, ctx.cmd('re-stale'), ds.proposal_id, dup, 'DEFER', ds.proposal_id)), 'GV009', /DOMAIN_STATE_EXPECTATION_MISMATCH/);
    const r1 = (await k.revoke(ctx, 're-r1', s, v1.registry_state_id)).decided;
    const back = k.validateProposal(s, await k.instant('-1 hour'));
    const bs = await k.submit(ctx, ctx.member, 're-back', back);
    await rejects(c.svc(k.decideSqlFor(ctx.flex, ctx.cmd('re-back-v'), bs.proposal_id, back, 'VALIDATE', r1.registry_state_id)), 'GV011', /REVALIDATION_OVERLAPS_PRIOR_INTERVAL/);
    const v2 = (await k.validate(ctx, 're2', s)).decided;
    const d2 = await row(`select to_json(d) from gov_repo.l14_domain_states d where state_id='${v2.registry_state_id}'`);
    assert.deepEqual([d2.predecessor_state_id, d2.domain_id], [r1.registry_state_id, s.domainId]);
    assert.equal(await one(`select string_agg(s.state_kind, '>' order by s.recorded_at) from gov_repo.l14_registry_states s
      join gov_repo.l14_domain_states d using (organisation_id, state_id) where d.domain_id='${s.domainId}'`), 'VALIDATED>REVOKED>VALIDATED');
    assert.equal(await one(`select count(*) from gov_repo.l14_domain_admissions where domain_id='${s.domainId}'`), '1', 'no identity re-minted');
    assert.equal(await k.resolve(ctx.org, s, 'clock_timestamp()', 'clock_timestamp()'), v2.registry_state_id);
  });

  await t.test('replay: exact original result for ADMIT / SUBMIT / DECIDE; durable DENY survives later authority; GV007; GV008', async () => {
    const x = await k.setup();
    const s = k.subject('BUSINESS_DOMAIN', 'rp');
    const admitSql = k.admitSql(x.registrar, { commandId: x.cmd('rp-a'), subject: s });
    const admitDenySql = k.admitSql(x.member, { commandId: x.cmd('rp-ad'), subject: k.subject('INFORMATION_DOMAIN', 'rp-d') });
    const admitted = await exec(admitSql);
    const admitDenied = await exec(admitDenySql);
    const proposal = k.validateProposal(s);
    const submitSql = k.submitSql(x.member, { commandId: x.cmd('rp-s'), proposal });
    const submitted = await exec(submitSql);
    const allowSql = k.decideSqlFor(x.steward, x.cmd('rp-v'), submitted.proposal_id, proposal, 'VALIDATE', null);
    const denySql = k.decideSqlFor(x.member, x.cmd('rp-d'), submitted.proposal_id, proposal, 'DEFER', null);
    const denied = await exec(denySql);
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    const allowed = await exec(allowSql);
    await owner(`update gov_repo.governance_users set role_ids=array['${c.memberRole}','${k.stewardRole}','${k.registrarRole}']::uuid[] where user_id='${x.member.id}'`);
    await owner(`update gov_repo.governance_users set role_ids=array['${c.memberRole}']::uuid[] where user_id in ('${x.steward.id}','${x.registrar.id}')`);
    const before = await k.counts(x.org);
    const history = await k.historyDigest(x.org);
    for (const [sql, original] of [[admitSql, admitted], [admitDenySql, admitDenied], [submitSql, submitted], [allowSql, allowed], [denySql, denied]] as const) {
      const again = await exec(sql);
      assert.equal(again.replay, true);
      assert.deepEqual({ ...again, replay: false }, original, 'the ORIGINAL durable result');
    }
    assert.deepEqual(await k.counts(x.org), before, 'replay writes nothing');
    assert.equal(await k.historyDigest(x.org), history);
    await rejects(c.svc(k.decideSqlFor(x.steward, x.cmd('rp-v'), submitted.proposal_id, proposal, 'REJECT', null)), 'GV007');
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rp-s'), proposal: k.validateProposal(s, await k.instant('1 hour')) })), 'GV007');
    await rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('rp-a'), subject: { ...s, subjectKind: 'INFORMATION_DOMAIN' } })), 'GV007');
    const wrong = decideDomainProposalFingerprint({ organisationId: x.org, actorUserId: x.member.id, outcome: 'REJECT',
      proposalId: submitted.proposal_id, proposal, expectedCurrentStateId: null, support: { status: 'NONE', evidenceIds: [] } });
    await rejects(c.svc(k.decideSql(x.steward, { commandId: x.cmd('rp-fp'), proposalId: submitted.proposal_id, proposal, outcome: 'REJECT',
      expected: allowed.registry_state_id, fingerprint: wrong })), 'GV008');
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rp-fp2'), proposal, fingerprint: 'f'.repeat(64) })), 'GV008');
    await rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('rp-fp3'), subject: k.subject('BUSINESS_DOMAIN', 'fp3'), fingerprint: 'f'.repeat(64) })), 'GV008');
  });

  await t.test('authority: CURRENT roles and the CURRENT effective Authority Policy govern; self-validation follows the policy; other permission families never decide', async () => {
    const x = await k.setup();
    const s1 = await k.admitted(x, 'self');
    const p1 = k.validateProposal(s1);
    const own = await k.submit(x, x.steward, 'self-s', p1);
    const self = await exec(k.decideSqlFor(x.steward, x.cmd('self-v'), own.proposal_id, p1, 'VALIDATE', null));
    assert.deepEqual([self.outcome, self.deny_reason], ['DENIED', 'SELF_VALIDATION_NOT_PERMITTED']);
    assert.equal((await authz(self.authorization_decision_id)).is_self_validation, true);
    const flexOwn = await k.submit(x, x.flex, 'self-fs', p1);
    assert.equal((await exec(k.decideSqlFor(x.flex, x.cmd('self-fv'), flexOwn.proposal_id, p1, 'VALIDATE', null))).outcome, 'VALIDATED');
    const s2 = await k.admitted(x, 'auth', 'INFORMATION_DOMAIN');
    const p2 = k.validateProposal(s2);
    const sub2 = await k.submit(x, x.member, 'auth-s', p2);
    const contrib = await exec(k.decideSqlFor(x.contrib, x.cmd('auth-c'), sub2.proposal_id, p2, 'VALIDATE', null));
    assert.deepEqual([contrib.outcome, contrib.deny_reason], ['DENIED', 'SOURCE_NOT_AUTHORIZED']);
    for (const [actor, name] of [[x.registrar, 'auth-registrar'], [x.party, 'auth-party'], [x.boot, 'auth-admin'], [x.ops, 'auth-ops']] as const) {
      const r = await exec(k.decideSqlFor(actor, x.cmd(name), sub2.proposal_id, p2, 'VALIDATE', null));
      assert.deepEqual([r.outcome, r.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE'], name);
    }
    await owner(`update gov_repo.governance_users set role_ids=array['${c.memberRole}']::uuid[] where user_id='${x.steward2.id}'`);
    const gone = await exec(k.decideSqlFor(x.steward2, x.cmd('auth-v2'), sub2.proposal_id, p2, 'VALIDATE', null));
    assert.deepEqual([gone.outcome, gone.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    const v2 = await k.apSuccessor(x, 'auth-ap2', k.domainRules(2, {}, [`${k.stewardRole}:L14_DOMAIN_VALIDATE:VALIDATE`, `${k.registrarRole}:L14_DOMAIN_ADMIT:ADMIT`]));
    const after = await exec(k.decideSqlFor(x.steward, x.cmd('auth-v'), sub2.proposal_id, p2, 'VALIDATE', null));
    assert.deepEqual([after.outcome, after.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    assert.equal((await authz(after.authorization_decision_id)).basis_version_id, v2.admitted.version_id);
    const admitAfter = await exec(k.admitSql(x.registrar, { commandId: x.cmd('auth-adm'), subject: k.subject('BUSINESS_DOMAIN', 'after') }));
    assert.deepEqual([admitAfter.outcome, admitAfter.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    // D-14: a domain permission rule can only ever be organisation-local.
    await rejects(c.svc(c.admitSql(x.ops, { commandId: x.cmd('d14'), expected: { authorityPolicyId: x.v1.authority_policy_id,
      latestVersionId: v2.admitted.version_id }, rules: [...k.domainRules(3), c.rule(k.stewardRole, 'L14_DOMAIN_VALIDATE', 'VALIDATE',
      { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' })] })), 'GV010');
  });
});
