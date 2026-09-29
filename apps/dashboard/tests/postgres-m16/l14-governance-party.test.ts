import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admitGovernancePartyFingerprint, governancePartyContentHash } from '@council/governance-review';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { partyKit } from '../helpers/m16-l14-party-fixtures';

/**
 * M16-S1B.1 — GOVERNANCE_PARTY lifecycle on real disposable PostgreSQL 17 (S1B1 horizon). Every
 * Party command goes through the real public RPCs as service_role; every Authority Policy through
 * the real AP RPCs. Owner access is used only to read evidence and for rolled-back structural probes.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('M16 S1B.1 GovernanceParty registry lifecycle (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B1' });
  t.after(() => c.stop());
  const { owner, exec, rejects } = c;
  const k = await partyKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const row = async (query: string) => JSON.parse(await one(`select coalesce((${query}), 'null'::json)`));
  const authz = (id: string) => row(`select to_json(a) from gov_repo.l14_authorization_decisions a where authorization_decision_id='${id}'`);
  const envelope = (id: string) => row(`select to_json(s) from gov_repo.l14_registry_states s where state_id='${id}'`);
  const ts = (value: string) => `'${value}'::timestamptz`;
  const ctx = await k.setup();

  // ---------------------------------------------------------------------------------------
  await t.test('ADMIT ALLOW: PostgreSQL-minted opaque UUID, immutable admission, head without state, no decision / state', async () => {
    await c.evidence(ctx.org, 'adm-ev-1');
    const before = await k.counts(ctx.org);
    const r = await exec(k.admitSql(ctx.registrar, { commandId: ctx.cmd('admit-1'), partyKind: 'GROUP',
      support: { status: 'PRESENT', evidenceIds: ['adm-ev-1'] } }));
    assert.equal(r.outcome, 'ADMITTED');
    assert.equal(r.command_kind, 'ADMIT_GOVERNANCE_PARTY');
    assert.equal(r.subject_kind, 'GOVERNANCE_PARTY');
    assert.equal(r.party_kind, 'GROUP');
    assert.equal(r.replay, false);
    assert.match(r.governance_party_id, UUID_V4, 'random (v4) opaque identity');
    assert.notEqual(r.governance_party_id, ctx.registrar.id, 'never the actor/user id');
    assert.equal(await one(`select count(*) from gov_repo.governance_users where user_id='${r.governance_party_id}'`), '0');
    assert.equal(r.proposal_id, null);
    assert.equal(r.governance_decision_id, null);
    assert.equal(r.registry_state_id, null);
    const party = await row(`select to_json(p) from gov_repo.l14_governance_parties p where governance_party_id='${r.governance_party_id}'`);
    assert.deepEqual({ org: party.organisation_id, kind: party.party_kind, source: party.source_class, by: party.admitted_by_actor_user_id,
      authz: party.admission_authorization_decision_id, result: party.admission_authorization_result, subject: party.admission_subject_kind,
      action: party.admission_requested_action, support: party.support_status },
    { org: ctx.org, kind: 'GROUP', source: 'LOCAL_HUMAN', by: ctx.registrar.id, authz: r.authorization_decision_id, result: 'ALLOW',
      subject: 'GOVERNANCE_PARTY', action: 'ADMIT', support: 'PRESENT' });
    const a = await authz(r.authorization_decision_id);
    assert.deepEqual({ result: a.result, action: a.requested_action, subject: a.subject_kind, scope: a.scope_tag, basis: a.authority_basis,
      bv: a.basis_version_id, bh: a.basis_content_hash, exp: a.expectation_kind, hash: a.attempted_content_hash, proposal: a.proposal_id,
      self: a.is_self_validation, apSubject: a.subject_authority_policy_id },
    { result: 'ALLOW', action: 'ADMIT', subject: 'GOVERNANCE_PARTY', scope: 'ALL_ALLOWED_TARGETS', basis: 'AUTHORITY_POLICY_VERSION',
      bv: ctx.v1.version_id, bh: ctx.v1.content_hash, exp: 'EXPECTED_NONE', hash: governancePartyContentHash('GROUP'), proposal: null,
      self: null, apSubject: null });
    assert.equal(party.admitted_at, a.evaluated_at);
    // Authority = the actual matched immutable rule of the CURRENT persisted role, never JWT/email.
    assert.equal(await one(`select string_agg(permission||'/'||requested_action||'/'||source_class||'/'||source_disposition||'/'||scope_tag||'/'||permission_origin, ',')
      from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${r.authorization_decision_id}'`),
    'L14_PARTY_ADMIT/ADMIT/LOCAL_HUMAN/AUTHORITATIVE/ALL_ALLOWED_TARGETS/AUTHORITY_POLICY_RULE');
    assert.equal(await one(`select string_agg(role_id::text, ',') from gov_repo.l14_authorization_decision_roles where authorization_decision_id='${r.authorization_decision_id}'`),
      k.registrarRole);
    assert.deepEqual(await k.head(ctx.org, r.governance_party_id),
      { organisation_id: ctx.org, governance_party_id: r.governance_party_id, party_kind: 'GROUP', latest_state_id: null });
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where owner_kind='ADMISSION' and admission_authorization_decision_id='${r.authorization_decision_id}'
      and evidence_id='adm-ev-1' and admission_subject_kind='GOVERNANCE_PARTY'`), '1');
    const after = await k.counts(ctx.org);
    for (const table of ['l14_governance_decisions', 'l14_registry_states', 'l14_governance_party_states', 'l14_proposals']) {
      assert.equal(after[table], before[table], `${table}: ADMIT != VALIDATE`);
    }
    assert.equal(after.l14_governance_parties, before.l14_governance_parties + 1);
    // Same actor, same content, a different command → a different, independently minted identity.
    const again = await exec(k.admitSql(ctx.registrar, { commandId: ctx.cmd('admit-2'), partyKind: 'GROUP' }));
    assert.equal(again.outcome, 'ADMITTED');
    assert.notEqual(again.governance_party_id, r.governance_party_id);
  });

  await t.test('no caller-supplied Party id: the RPC has no such parameter; the identity column is DB-defaulted', async () => {
    assert.equal(await one(`select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
      where d.adrelid='gov_repo.l14_governance_parties'::regclass and a.attname='governance_party_id'`), 'gen_random_uuid()');
    assert.equal(await one(`select array_to_string(proargnames, ',') from pg_proc where oid='gov_repo.l14_admit_governance_party_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,text,text,text,text[],text)'::regprocedure`),
      'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,'
      + 'p_command_id,p_expectation_kind,p_party_kind,p_source_class,p_support_status,p_support_evidence_ids,p_caller_fingerprint,'
      + 'replay,command_id,command_kind,subject_kind,outcome,command_fingerprint,authorization_decision_id,authorization_result,deny_reason,'
      + 'proposal_id,governance_decision_id,governance_party_id,party_kind,registry_state_id,state_kind,effective_from,recorded_at');
    const sql = k.admitSql(ctx.registrar, { commandId: ctx.cmd('admit-with-id') }).replace('p_command_id =>',
      `p_governance_party_id => '${ctx.registrar.id}'::uuid, p_command_id =>`);
    await rejects(c.svc(sql), '42883');
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${ctx.cmd('admit-with-id')}'`), '0');
  });

  await t.test('ADMIT durable DENY (NO_MATCHING, SOURCE via CONTRIBUTING rule, NO_EFFECTIVE_AUTHORITY): no Party minted, no decision/state/head', async () => {
    for (const [actor, name, reason] of [[ctx.member, 'deny-member', 'NO_MATCHING_AUTHORITY_RULE'], [ctx.steward, 'deny-steward', 'NO_MATCHING_AUTHORITY_RULE'],
      [ctx.contrib, 'deny-contrib', 'SOURCE_NOT_AUTHORIZED']] as const) {
      const before = await k.counts(ctx.org);
      const r = await exec(k.admitSql(actor, { commandId: ctx.cmd(name) }));
      assert.equal(r.outcome, 'DENIED', name);
      assert.equal(r.deny_reason, reason, name);
      assert.equal(r.authorization_result, 'DENY');
      assert.equal(r.governance_party_id, null, 'no Party id is minted on DENY');
      const after = await k.counts(ctx.org);
      assert.deepEqual({ ...after, l14_authorization_decisions: 0, l14_command_results: 0, l14_authorization_decision_roles: 0, l14_authorization_decision_rules: 0 },
        { ...before, l14_authorization_decisions: 0, l14_command_results: 0, l14_authorization_decision_roles: 0, l14_authorization_decision_rules: 0 },
        'only the durable authorization (+ snapshots) and the command result are written');
      assert.equal(after.l14_authorization_decisions, before.l14_authorization_decisions + 1);
      assert.equal(after.l14_command_results, before.l14_command_results + 1);
      const a = await authz(r.authorization_decision_id);
      assert.equal(a.attempted_content_hash, governancePartyContentHash('PERSON'), 'F-4: the attempted content is audited');
      assert.equal(a.expectation_kind, 'EXPECTED_NONE');
    }
    // An organisation with no effective Authority Policy: explicit NULL basis, never bootstrap.
    const bare = await k.setup(undefined, { bootstrap: false });
    const r = await exec(k.admitSql(bare.boot, { commandId: bare.cmd('no-policy') }));
    assert.deepEqual([r.outcome, r.deny_reason], ['DENIED', 'NO_EFFECTIVE_AUTHORITY']);
    const a = await authz(r.authorization_decision_id);
    assert.deepEqual([a.authority_basis, a.basis_version_id], [null, null], 'a system GOVERNANCE_ADMIN gets no bootstrap for a registry subject');
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_parties where organisation_id='${bare.org}'`), '0');
  });

  await t.test('ADMIT replay: ALLOW replays the SAME minted id; DENY replay survives a later role grant and Authority Policy change; GV007 / GV008', async () => {
    const x = await k.setup();
    const allowSql = k.admitSql(x.registrar, { commandId: x.cmd('r-allow'), partyKind: 'ORGANISATIONAL_UNIT' });
    const allowed = await exec(allowSql);
    const denySql = k.admitSql(x.member, { commandId: x.cmd('r-deny') });
    const denied = await exec(denySql);
    assert.equal(denied.outcome, 'DENIED');
    // Authority changes AFTER the originals: the member gains a role, and a successor AP moves Party ADMIT
    // from the registrar role to the member role.
    await owner(`update gov_repo.governance_users set role_ids=array['${c.memberRole}','${k.stewardRole}']::uuid[] where user_id='${x.member.id}'`);
    await k.apSuccessor(x, 'r-ap2', [...k.partyRules(1, {}, [`${k.registrarRole}:L14_PARTY_ADMIT:ADMIT`]),
      c.rule(c.memberRole, 'L14_PARTY_ADMIT', 'ADMIT')]);
    const before = await k.counts(x.org);
    const allowReplay = await exec(allowSql);
    assert.equal(allowReplay.replay, true);
    assert.deepEqual({ ...allowReplay, replay: false }, allowed, 'the ORIGINAL ALLOW result, same governance_party_id');
    const denyReplay = await exec(denySql);
    assert.deepEqual({ ...denyReplay, replay: false }, denied, 'the ORIGINAL DENY, never re-evaluated');
    assert.deepEqual(await k.counts(x.org), before, 'replay writes nothing');
    // Re-evaluation only happens for a NEW command: now the member is authorized, the registrar is not.
    assert.equal((await exec(k.admitSql(x.member, { commandId: x.cmd('r-new-member') }))).outcome, 'ADMITTED');
    assert.equal((await exec(k.admitSql(x.registrar, { commandId: x.cmd('r-new-registrar') }))).deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
    // Same command id + different semantics → GV007; wrong caller fingerprint → GV008. Nothing consumed.
    await rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('r-allow'), partyKind: 'PERSON' })), 'GV007', /COMMAND_ID_REUSED_WITH_DIFFERENT_SEMANTICS/);
    await rejects(c.svc(k.admitSql(x.member, { commandId: x.cmd('r-allow'), partyKind: 'ORGANISATIONAL_UNIT' })), 'GV007');
    await rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('r-fp'), fingerprint: 'a'.repeat(64) })), 'GV008', /CALLER_FINGERPRINT_DIFFERS/);
    await rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('r-fp'), partyKind: 'GROUP',
      fingerprint: admitGovernancePartyFingerprint({ organisationId: x.org, actorUserId: x.registrar.id,
        partyKind: 'PERSON', sourceClass: 'LOCAL_HUMAN', support: { status: 'NONE', evidenceIds: [] } }) })), 'GV008');
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${x.cmd('r-fp')}'`), '0');
  });

  await t.test('ADMIT closed shape + base eligibility failures raise before anything is written (command not consumed)', async () => {
    const x = await k.setup();
    const before = await k.counts(x.org);
    const BAD_FP = 'a'.repeat(64); // these all fail BEFORE the fingerprint comparison
    for (const [input, code, detail] of [
      [{ partyKind: 'ROBOT', fingerprint: BAD_FP }, 'GV010', /PARTY_KIND_UNKNOWN/],
      [{ sourceClass: 'SOURCE_CONNECTION', fingerprint: BAD_FP }, 'GV010', /SOURCE_CLASS_NOT_EXECUTABLE/],
      [{ sourceClass: 'ROBOT', fingerprint: BAD_FP }, 'GV010', /SOURCE_CLASS_UNKNOWN/],
      [{ expectation: 'EXPECTED_CURRENT', fingerprint: BAD_FP }, 'GV010', /EXPECTATION_MALFORMED/],
      [{ expectation: null, fingerprint: BAD_FP }, 'GV010', /EXPECTATION_MALFORMED/],
      [{ support: { status: 'PRESENT', evidenceIds: [] }, fingerprint: BAD_FP }, 'GV010', /SUPPORT_MALFORMED/],
      [{ command: ' padded', fingerprint: BAD_FP }, 'GV010', /COMMAND_ID_INVALID/],
      [{ session: { epoch: `'2020-01-01T00:00:00Z'::timestamptz` } }, 'GV002', /CREDENTIAL_EPOCH_MISMATCH/],
      [{ session: { exp: '(floor(extract(epoch from clock_timestamp()))::bigint - 1)' } }, 'GV001', /SESSION_EXPIRED/],
      [{ session: { org: ctx.org } }, 'GV003', /ACTOR_UNAVAILABLE_OR_NOT_MEMBER/],
      // Existence is resolved after arbitration, with the correct fingerprint.
      [{ support: { status: 'PRESENT', evidenceIds: ['ghost'] } }, 'GV010', /SUPPORT_REFERENCE_UNRESOLVED/],
    ] as const) {
      const { command, ...rest } = input as unknown as { command?: string };
      await rejects(c.svc(k.admitSql(x.registrar, { commandId: command ?? x.cmd('shape'), ...rest } as never)), code, detail);
    }
    assert.deepEqual(await k.counts(x.org), before);
    await owner(`update gov_repo.governance_users set status='suspended' where user_id='${x.registrar2.id}'`);
    await rejects(c.svc(k.admitSql(x.registrar2, { commandId: x.cmd('shape') })), 'GV003');
    assert.deepEqual(await k.counts(x.org), before, 'nothing consumed');
    assert.equal((await exec(k.admitSql(x.registrar, { commandId: x.cmd('shape') }))).outcome, 'ADMITTED', 'the command id is still free');
  });

  await t.test('replay-first ordering: support existence is resolved AFTER replay arbitration; cross-tenant support rejected for new commands', async () => {
    const x = await k.setup();
    const other = await k.setup();
    await c.evidence(x.org, 'rf-ev-1');
    await c.evidence(other.org, 'rf-foreign');
    const support = { status: 'PRESENT' as const, evidenceIds: ['rf-ev-1'] };
    const denySql = k.admitSql(x.member, { commandId: x.cmd('rf-deny'), support });
    const denied = await exec(denySql);
    assert.equal(denied.outcome, 'DENIED');
    // The (otherwise immutable) evidence row disappears afterwards (owner-only fixture; the table's
    // own DO INSTEAD NOTHING rule is lifted just for this delete and restored in the same transaction).
    await owner(`begin; alter table gov_repo.discovery_evidence disable rule discovery_evidence_no_delete;
      delete from gov_repo.discovery_evidence where organisation_id='${x.org}' and evidence_id='rf-ev-1';
      alter table gov_repo.discovery_evidence enable rule discovery_evidence_no_delete; commit;`);
    assert.equal(await one(`select count(*) from gov_repo.discovery_evidence where evidence_id='rf-ev-1'`), '0');
    const replay = await exec(denySql);
    assert.deepEqual({ ...replay, replay: false }, denied, 'the ORIGINAL result, not GV010 SUPPORT_REFERENCE_UNRESOLVED');
    // A NEW command with the vanished or a foreign-tenant evidence id fails GV010 after arbitration; not consumed.
    const before = await k.counts(x.org);
    await rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('rf-new'), support })), 'GV010', /SUPPORT_REFERENCE_UNRESOLVED/);
    await rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('rf-new'), support: { status: 'PRESENT', evidenceIds: ['rf-foreign'] } })),
      'GV010', /SUPPORT_REFERENCE_UNRESOLVED/);
    await rejects(c.svc(k.admitSql(x.member, { commandId: x.cmd('rf-new'), support: { status: 'PRESENT', evidenceIds: ['rf-foreign'] } })),
      'GV010', /SUPPORT_REFERENCE_UNRESOLVED/, );
    assert.deepEqual(await k.counts(x.org), before);
    // Ordering is structural: syntactic support canonicalization happens before arbitration, existence after.
    const src = await owner(`select prosrc from pg_proc where oid='gov_repo.l14_admit_governance_party_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,text,text,text,text[],text)'::regprocedure`);
    const at = (needle: string) => { const i = src.indexOf(needle); assert.ok(i >= 0, needle); return i; };
    assert.ok(at('l14_session_basis_v1') < at('l14_support_syntactic_parts_v1'));
    assert.ok(at('l14_support_syntactic_parts_v1') < at('L14_FINGERPRINT_MISMATCH'));
    assert.ok(at('L14_FINGERPRINT_MISMATCH') < at('l14_lock_authority_policy_guard_shared_v1'));
    assert.ok(at('l14_lock_authority_policy_guard_shared_v1') < at('l14_lock_command_guard_v1'));
    assert.ok(at('l14_lock_command_guard_v1') < at('l14_replay_arbitrate_v1'));
    assert.ok(at('l14_replay_arbitrate_v1') < at('l14_resolve_support_v1'));
    assert.ok(at('l14_resolve_support_v1') < at('l14_effective_authority_basis_v1'));
    assert.ok(at('l14_effective_authority_basis_v1') < at('l14_evaluate_authority_rules_v1'));
    assert.ok(!src.includes('l14_support_parts_v1('), 'the S1A resolver-bound support helper is not used');
    for (const rpc of ['l14_submit_governance_party_proposal_v1', 'l14_decide_governance_party_proposal_v1']) {
      const s = await owner(`select prosrc from pg_proc where proname='${rpc}'`);
      assert.ok(s.indexOf('l14_replay_arbitrate_v1') < s.indexOf('l14_resolve_support_v1'), rpc);
      assert.ok(s.indexOf('l14_lock_registry_subject_guard_v1') < s.indexOf('l14_replay_arbitrate_v1'), rpc);
      assert.ok(!s.includes('l14_support_parts_v1('), rpc);
    }
  });

  await t.test('D-14 frozen: a NEW non-ALL registry rule fails at persistence (GV010, nothing written); an unauthorized proposer gets the durable DENY first', async () => {
    const x = await k.setup();
    const bad = [...k.partyRules(2), c.rule(k.stewardRole, 'L14_PARTY_VALIDATE', 'VALIDATE', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' })];
    const h = await k.ap.head(x.org);
    const before = await k.counts(x.org);
    const admitAp = (actor: typeof x.ops, name: string) => c.admitSql(actor, { commandId: x.cmd(name), rules: bad,
      expected: { authorityPolicyId: x.v1.authority_policy_id, latestVersionId: h.latest_version_id } });
    await rejects(c.svc(admitAp(x.ops, 'd14-ops')), 'GV010', /RULE_REGISTRY_SCOPE_INVALID/);
    assert.deepEqual(await k.counts(x.org), before, 'no invalid rule persisted, no authority, no command consumed');
    const denied = await exec(admitAp(x.member, 'd14-member'));
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE'], 'accepted ordering: durable DENY first');
    assert.equal(await one(`select count(*) from gov_repo.l14_authority_policy_rules where organisation_id='${x.org}' and scope_tag<>'ALL_ALLOWED_TARGETS'`), '0');
    assert.deepEqual({ ...(await exec(admitAp(x.member, 'd14-member'))), replay: false }, denied, 'exact replay preserved');
  });

  // ---------------------------------------------------------------------------------------
  const party = await exec(k.admitSql(ctx.registrar, { commandId: ctx.cmd('p-admit'), partyKind: 'PERSON' }));
  const pid = party.governance_party_id as string;

  await t.test('proposal: any ACTIVE member submits; exact Party + kind; no authority side effects; replay; GV007', async () => {
    const before = await k.counts(ctx.org);
    const proposal = k.validateProposal(pid);
    const s = await exec(k.submitSql(ctx.member, { commandId: ctx.cmd('p-submit'), proposal }));
    assert.deepEqual([s.outcome, s.command_kind, s.subject_kind, s.governance_party_id, s.party_kind, s.authorization_decision_id, s.governance_decision_id, s.registry_state_id],
      ['SUBMITTED', 'SUBMIT_PROPOSAL', 'GOVERNANCE_PARTY', pid, 'PERSON', null, null, null]);
    const after = await k.counts(ctx.org);
    assert.deepEqual([after.l14_proposals, after.l14_governance_party_proposals, after.l14_command_results],
      [before.l14_proposals + 1, before.l14_governance_party_proposals + 1, before.l14_command_results + 1]);
    for (const table of ['l14_authorization_decisions', 'l14_governance_decisions', 'l14_registry_states', 'l14_governance_party_states',
      'l14_authorization_decision_rules', 'l14_authorization_decision_roles']) assert.equal(after[table], before[table], table);
    assert.equal((await k.head(ctx.org, pid))!.latest_state_id, null, 'head untouched');
    const typed = await row(`select to_json(t) from gov_repo.l14_governance_party_proposals t where proposal_id='${s.proposal_id}'`);
    assert.deepEqual([typed.governance_party_id, typed.party_kind, typed.intent, typed.requested_effective_from, typed.target_state_id],
      [pid, 'PERSON', 'VALIDATE', null, null]);
    assert.equal(await one(`select submitted_by_actor_user_id from gov_repo.l14_proposals where proposal_id='${s.proposal_id}'`), ctx.member.id);
    const replay = await exec(k.submitSql(ctx.member, { commandId: ctx.cmd('p-submit'), proposal }));
    assert.deepEqual({ ...replay, replay: false }, s);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('p-submit'), proposal: { ...proposal, requestedEffectiveFrom: await k.instant('1 hour') } })), 'GV007');
    // Shape / reference failures (nothing consumed).
    // Shape failures precede the fingerprint comparison (the TS mirror refuses to frame them at all).
    const probe = async (p: typeof proposal, detail: RegExp, actor = ctx.member, prior: string | null = null, fingerprint?: string) =>
      rejects(c.svc(k.submitSql(actor, { commandId: ctx.cmd('p-bad'), proposal: p, prior, fingerprint })), 'GV010', detail);
    const other = await k.setup();
    const foreign = await exec(k.admitSql(other.registrar, { commandId: other.cmd('foreign'), partyKind: 'PERSON' }));
    await probe({ ...proposal, targetStateId: pid }, /TARGET_STATE_NOT_PERMITTED/, ctx.member, null, 'a'.repeat(64));
    await probe({ ...proposal, intent: 'REVOKE' }, /TARGET_STATE_REQUIRED/, ctx.member, null, 'a'.repeat(64));
    await probe({ ...proposal, partyKind: 'ROBOT' as never }, /PROPOSAL_VOCABULARY_UNKNOWN/, ctx.member, null, 'a'.repeat(64));
    await probe({ ...proposal, partyKind: 'GROUP' }, /PARTY_UNRESOLVED/);
    await probe({ ...proposal, governancePartyId: foreign.governance_party_id }, /PARTY_UNRESOLVED/, ctx.member);
    await probe({ ...proposal, governancePartyId: ctx.member.id }, /PARTY_UNRESOLVED/);
    await probe(k.revokeProposal(pid, pid), /TARGET_STATE_UNRESOLVED/);
    await probe({ ...proposal, sourceClass: 'SOURCE_CONNECTION' }, /SOURCE_CLASS_NOT_EXECUTABLE/);
    await probe(proposal, /PRIOR_PROPOSAL_UNRESOLVED/, ctx.member, foreign.authorization_decision_id);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('p-bad'), proposal, session: { org: other.org } })), 'GV003');
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${ctx.cmd('p-bad')}'`), '0');
  });

  let v1State = '';
  await t.test('VALIDATE ALLOW: authorization + governance decision + VALIDATED envelope/detail + head + support lineage + durable result', async () => {
    await c.evidence(ctx.org, 'val-ev-1');
    const proposal = k.validateProposal(pid);
    const s = await k.submit(ctx, ctx.member, 'v-submit', proposal);
    const r = await exec(k.decideSql(ctx.steward, { commandId: ctx.cmd('v-validate'), proposalId: s.proposal_id, proposal, outcome: 'VALIDATE',
      expected: null, support: { status: 'PRESENT', evidenceIds: ['val-ev-1'] } }));
    assert.deepEqual([r.outcome, r.state_kind, r.governance_party_id, r.party_kind, r.authorization_result], ['VALIDATED', 'VALIDATED', pid, 'PERSON', 'ALLOW']);
    v1State = r.registry_state_id;
    const env = await envelope(v1State);
    assert.deepEqual({ subject: env.subject_kind, kind: env.state_kind, pred: env.predecessor_state_id, rev: env.revokes_state_id, gd: env.governance_decision_id,
      az: env.authorization_decision_id, trust: env.trust_state, source: env.source_class, support: env.support_status, apv: env.authority_policy_version_id,
      aph: env.authority_policy_content_hash },
    { subject: 'GOVERNANCE_PARTY', kind: 'VALIDATED', pred: null, rev: null, gd: r.governance_decision_id, az: r.authorization_decision_id,
      trust: 'VALIDATED', source: 'LOCAL_HUMAN', support: 'PRESENT', apv: ctx.v1.version_id, aph: ctx.v1.content_hash });
    assert.equal(env.effective_from, env.recorded_at, 'IMMEDIATE: the DB instant');
    assert.equal(r.effective_from, env.effective_from);
    const detail = await row(`select to_json(d) from gov_repo.l14_governance_party_states d where state_id='${v1State}'`);
    assert.deepEqual([detail.governance_party_id, detail.party_kind, detail.state_kind, detail.predecessor_state_id], [pid, 'PERSON', 'VALIDATED', null]);
    const gd = await row(`select to_json(d) from gov_repo.l14_governance_decisions d where governance_decision_id='${r.governance_decision_id}'`);
    assert.deepEqual([gd.subject_kind, gd.outcome, gd.reason_code, gd.proposal_id, gd.actor_user_id, gd.target_authority_policy_id],
      ['GOVERNANCE_PARTY', 'VALIDATE', 'GOVERNANCE_PARTY_VALIDATED', s.proposal_id, ctx.steward.id, null]);
    const a = await authz(r.authorization_decision_id);
    assert.deepEqual([a.requested_action, a.is_self_validation, a.expectation_kind, a.expected_current_state_id, a.proposal_id, a.attempted_content_hash],
      ['VALIDATE', false, 'EXPECTED_NONE', null, s.proposal_id, null]);
    assert.equal(await one(`select string_agg(permission||'/'||requested_action, ',') from gov_repo.l14_authorization_decision_rules
      where authorization_decision_id='${r.authorization_decision_id}'`), 'L14_PARTY_VALIDATE/VALIDATE');
    assert.equal((await k.head(ctx.org, pid))!.latest_state_id, v1State);
    assert.equal(await one(`select string_agg(owner_kind, ',' order by owner_kind) from gov_repo.l14_support_links where evidence_id='val-ev-1'`),
      'GOVERNANCE_DECISION,REGISTRY_STATE');
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${ctx.cmd('v-validate')}' and registry_state_id='${v1State}'
      and subject_kind='GOVERNANCE_PARTY'`), '1');
    const replay = await exec(k.decideSql(ctx.steward, { commandId: ctx.cmd('v-validate'), proposalId: s.proposal_id, proposal, outcome: 'VALIDATE',
      expected: null, support: { status: 'PRESENT', evidenceIds: ['val-ev-1'] } }));
    assert.deepEqual({ ...replay, replay: false }, r, 'the original durable decision result');
  });

  await t.test('a Party that was never revoked cannot receive a second (overlapping) VALIDATED state', async () => {
    const proposal = k.validateProposal(pid);
    const s = await k.submit(ctx, ctx.member, 'v2-submit', proposal);
    await rejects(c.svc(k.decideSql(ctx.steward, { commandId: ctx.cmd('v2-none'), proposalId: s.proposal_id, proposal, expected: null })),
      'GV009', /PARTY_STATE_EXISTS/);
    await rejects(c.svc(k.decideSql(ctx.steward, { commandId: ctx.cmd('v2-current'), proposalId: s.proposal_id, proposal, expected: v1State })),
      'GV010', /PARTY_ALREADY_VALIDATED/);
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_party_states where governance_party_id='${pid}'`), '1');
    // Even the owner cannot append a second lineage root (VALIDATED -> VALIDATED is structurally impossible).
    assert.match(await one(`select string_agg(indexname, ',' order by indexname) from pg_indexes where tablename='l14_governance_party_states'`),
      /l14_governance_party_states_root_uidx/);
  });

  await t.test('durable decision DENY variants (NO_MATCHING, SELF_VALIDATION, TEMPORAL back/future); DENY consumes the command; replay survives a role grant', async () => {
    const x = await k.setup();
    const p = await exec(k.admitSql(x.registrar, { commandId: x.cmd('d-admit') }));
    const proposal = k.validateProposal(p.governance_party_id);
    const s = await k.submit(x, x.member, 'd-submit', proposal);
    const ownProposal = await k.submit(x, x.steward, 'd-own-submit', proposal);
    const back = k.validateProposal(p.governance_party_id, 'PERSON', await k.instant('-1 hour'));
    const future = k.validateProposal(p.governance_party_id, 'PERSON', await k.instant('1 hour'));
    const sBack = await k.submit(x, x.member, 'd-back-submit', back);
    const sFuture = await k.submit(x, x.member, 'd-future-submit', future);
    const cases = [
      [x.member, 'd-member', s, proposal, 'NO_MATCHING_AUTHORITY_RULE'],
      [x.registrar, 'd-registrar', s, proposal, 'NO_MATCHING_AUTHORITY_RULE'],
      [x.steward, 'd-self', ownProposal, proposal, 'SELF_VALIDATION_NOT_PERMITTED'],
      [x.steward, 'd-back', sBack, back, 'TEMPORAL_ACTION_NOT_AUTHORIZED'],
      [x.steward, 'd-future', sFuture, future, 'TEMPORAL_ACTION_NOT_AUTHORIZED'],
    ] as const;
    const denials: Record<string, Record<string, any>> = {};
    for (const [actor, name, sub, prop, reason] of cases) {
      const before = await k.counts(x.org);
      const r = await exec(k.decideSql(actor, { commandId: x.cmd(name), proposalId: sub.proposal_id, proposal: prop, expected: null }));
      assert.deepEqual([r.outcome, r.deny_reason, r.governance_decision_id, r.registry_state_id, r.proposal_id], ['DENIED', reason, null, null, sub.proposal_id], name);
      const after = await k.counts(x.org);
      for (const table of ['l14_governance_decisions', 'l14_registry_states', 'l14_governance_party_states']) assert.equal(after[table], before[table], `${name}: ${table}`);
      assert.equal((await k.head(x.org, p.governance_party_id))!.latest_state_id, null);
      denials[name] = r;
    }
    assert.equal((await authz(denials['d-self']!.authorization_decision_id)).is_self_validation, true);
    // DENY consumed its command: a later role grant does not turn the replay into an ALLOW.
    await owner(`update gov_repo.governance_users set role_ids=array['${c.memberRole}','${k.flexRole}']::uuid[] where user_id='${x.member.id}'`);
    const replay = await exec(k.decideSql(x.member, { commandId: x.cmd('d-member'), proposalId: s.proposal_id, proposal, expected: null }));
    assert.deepEqual({ ...replay, replay: false }, denials['d-member']);
    // A NEW command is re-evaluated (the member now holds flex, whose rule permits its self-validation of s).
    assert.equal((await exec(k.decideSql(x.member, { commandId: x.cmd('d-member-2'), proposalId: s.proposal_id, proposal, expected: null }))).outcome, 'VALIDATED');
  });

  await t.test('REJECT / DEFER: DEFER is nonterminal; VALIDATE and REJECT terminate; correction needs a new linked proposal', async () => {
    const x = await k.setup();
    const p = await exec(k.admitSql(x.registrar, { commandId: x.cmd('rd-admit') }));
    const proposal = k.validateProposal(p.governance_party_id);
    const s = await k.submit(x, x.member, 'rd-submit', proposal);
    const defer = await k.decide(x, x.steward, 'rd-defer', s, proposal, 'DEFER');
    assert.deepEqual([defer.outcome, defer.registry_state_id], ['DEFERRED', null]);
    assert.equal(await one(`select reason_code from gov_repo.l14_governance_decisions where governance_decision_id='${defer.governance_decision_id}'`), 'GOVERNANCE_PARTY_DEFERRED');
    const defer2 = await k.decide(x, x.steward2, 'rd-defer-2', s, proposal, 'DEFER');
    assert.equal(defer2.outcome, 'DEFERRED', 'DEFER is nonterminal (repeatable)');
    const reject = await k.decide(x, x.steward, 'rd-reject', s, proposal, 'REJECT');
    assert.deepEqual([reject.outcome, reject.registry_state_id], ['REJECTED', null]);
    for (const outcome of ['VALIDATE', 'REJECT', 'DEFER'] as const) {
      await rejects(c.svc(k.decideSql(x.steward2, { commandId: x.cmd(`rd-after-${outcome}`), proposalId: s.proposal_id, proposal, outcome, expected: null })),
        'GV010', /PROPOSAL_TERMINAL/);
    }
    await rejects(c.svc(k.decideSql(x.steward, { commandId: x.cmd('rd-revoke-outcome'), proposalId: s.proposal_id, proposal, outcome: 'REVOKE', expected: null })),
      'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    await rejects(c.svc(k.decideSql(x.steward, { commandId: x.cmd('rd-reason'), proposalId: s.proposal_id, proposal, outcome: 'DEFER', expected: null,
      reasonCode: 'AUTHORITY_POLICY_DEFERRED' })), 'GV010', /DECISION_VOCABULARY_INVALID/);
    assert.equal((await k.head(x.org, p.governance_party_id))!.latest_state_id, null, 'REJECT/DEFER never create a state');
    // Correction: a NEW proposal linked to the rejected one, then VALIDATE.
    const corrected = await exec(k.submitSql(x.member, { commandId: x.cmd('rd-correct'), proposal, prior: s.proposal_id }));
    assert.equal(await one(`select prior_proposal_id from gov_repo.l14_proposals where proposal_id='${corrected.proposal_id}'`), s.proposal_id);
    assert.equal((await k.decide(x, x.steward, 'rd-correct-validate', corrected, proposal)).outcome, 'VALIDATED');
    // A REVOKE-intent proposal: REVOKE / REJECT / DEFER only.
    const vState = (await k.head(x.org, p.governance_party_id))!.latest_state_id!;
    const rp = k.revokeProposal(p.governance_party_id, vState);
    const rs = await k.submit(x, x.member, 'rd-rsubmit', rp);
    await rejects(c.svc(k.decideSql(x.steward, { commandId: x.cmd('rd-r-validate'), proposalId: rs.proposal_id, proposal: rp, outcome: 'VALIDATE', expected: vState })),
      'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    assert.equal((await k.decide(x, x.steward, 'rd-r-defer', rs, rp, 'DEFER')).outcome, 'DEFERRED');
    assert.equal((await k.decide(x, x.steward, 'rd-r-reject', rs, rp, 'REJECT')).outcome, 'REJECTED');
    assert.equal((await k.head(x.org, p.governance_party_id))!.latest_state_id, vState, 'a rejected revocation changes nothing');
  });

  await t.test('self-validation: submitter validating requires allow_self_validation (steward DENY, flex ALLOW)', async () => {
    const x = await k.setup();
    const p = await exec(k.admitSql(x.registrar, { commandId: x.cmd('sv-admit') }));
    const proposal = k.validateProposal(p.governance_party_id);
    const byFlex = await k.submit(x, x.flex, 'sv-flex-submit', proposal);
    const r = await exec(k.decideSql(x.flex, { commandId: x.cmd('sv-flex'), proposalId: byFlex.proposal_id, proposal, expected: null }));
    assert.equal(r.outcome, 'VALIDATED');
    assert.equal((await authz(r.authorization_decision_id)).is_self_validation, true);
    assert.equal(await one(`select bool_and(allow_self_validation)::text from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${r.authorization_decision_id}'`), 'true');
  });

  await t.test('temporal dating: immediate = DB instant; explicit past needs allow_backdating; explicit future needs allow_future_dating', async () => {
    const x = await k.setup();
    const past = await k.instant('-2 hours'), futureAt = await k.instant('2 hours');
    const a = await k.validated(x, 'td-back', 'PERSON', past, x.flex);
    assert.equal(a.decided.outcome, 'VALIDATED');
    assert.equal(await k.canonical(a.decided.effective_from), past, 'backdated effective_from = the requested instant');
    const env = await envelope(a.decided.registry_state_id);
    assert.ok(Date.parse(env.recorded_at) > Date.parse(env.effective_from));
    const b = await k.validated(x, 'td-future', 'GROUP', futureAt, x.flex);
    assert.equal(await k.canonical(b.decided.effective_from), futureAt);
    assert.equal(await k.resolve(x.org, b.partyId, 'clock_timestamp()', 'clock_timestamp()'), null, 'future-dated: not yet valid');
    assert.equal(await k.resolve(x.org, b.partyId, ts(futureAt), 'clock_timestamp()'), b.decided.registry_state_id);
    const flags = await one(`select string_agg(allow_backdating::text||'/'||allow_future_dating::text, ',') from gov_repo.l14_authorization_decision_rules
      where authorization_decision_id in ('${a.decided.authorization_decision_id}','${b.decided.authorization_decision_id}')`);
    assert.equal(flags, 'true/true,true/true');
  });

  let rState = '';
  await t.test('REVOKE: exact target, target row immutable, REVOKED tombstone appended, head advanced; double revoke rejected', async () => {
    const before = await one(`select s::text||'#'||d::text from gov_repo.l14_registry_states s join gov_repo.l14_governance_party_states d using (organisation_id, state_id)
      where s.state_id='${v1State}'`);
    const rp = k.revokeProposal(pid, v1State);
    const rs = await k.submit(ctx, ctx.member, 'rv-submit', rp);
    const rs2 = await k.submit(ctx, ctx.member, 'rv-submit-2', rp);
    const r = await k.decide(ctx, ctx.steward, 'rv-revoke', rs, rp, 'REVOKE');
    assert.deepEqual([r.outcome, r.state_kind, r.governance_party_id], ['REVOKED', 'REVOKED', pid]);
    rState = r.registry_state_id;
    const env = await envelope(rState);
    assert.deepEqual([env.state_kind, env.revokes_state_id, env.predecessor_state_id], ['REVOKED', v1State, v1State]);
    assert.equal(await one(`select reason_code from gov_repo.l14_governance_decisions where governance_decision_id='${r.governance_decision_id}'`), 'GOVERNANCE_PARTY_REVOKED');
    assert.equal(await one(`select s::text||'#'||d::text from gov_repo.l14_registry_states s join gov_repo.l14_governance_party_states d using (organisation_id, state_id)
      where s.state_id='${v1State}'`), before, 'the target state is never modified');
    assert.equal((await k.head(ctx.org, pid))!.latest_state_id, rState);
    // Double revoke: the second pending proposal is stale (GV009) or, with the current expectation, already revoked (GV010).
    await rejects(c.svc(k.decideSql(ctx.steward, { commandId: ctx.cmd('rv-2a'), proposalId: rs2.proposal_id, proposal: rp, outcome: 'REVOKE', expected: v1State })), 'GV009');
    await rejects(c.svc(k.decideSql(ctx.steward, { commandId: ctx.cmd('rv-2b'), proposalId: rs2.proposal_id, proposal: rp, outcome: 'REVOKE', expected: rState })),
      'GV010', /TARGET_ALREADY_REVOKED/);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rv-submit-3'), proposal: rp })), 'GV010', /TARGET_ALREADY_REVOKED/);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rv-submit-4'), proposal: k.revokeProposal(pid, rState) })), 'GV010', /TARGET_STATE_NOT_VALIDATED/);
    for (const statement of [`update gov_repo.l14_registry_states set effective_from=now() where state_id='${v1State}'`,
      `delete from gov_repo.l14_governance_party_states where state_id='${v1State}'`,
      `update gov_repo.l14_governance_parties set party_kind='GROUP' where governance_party_id='${pid}'`,
      `delete from gov_repo.l14_governance_parties where governance_party_id='${pid}'`,
      `update gov_repo.l14_governance_party_proposals set target_state_id=null where governance_party_id='${pid}'`,
      'truncate gov_repo.l14_governance_parties cascade', 'truncate gov_repo.l14_governance_party_states cascade']) {
      await rejects(owner(statement), '55000', /L14_HISTORY_IMMUTABLE/);
    }
  });

  await t.test('re-validation after the tombstone: same Party identity, new proposal/authorization/decision, predecessor = tombstone, no overlap', async () => {
    const tR = await k.canonical((await envelope(rState)).effective_from);
    const minus1 = await one(`select to_char(('${tR}'::timestamptz - interval '1 microsecond') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
    const overlapping = k.validateProposal(pid, 'PERSON', minus1);
    const so = await k.submit(ctx, ctx.member, 'rv-overlap-submit', overlapping);
    await rejects(c.svc(k.decideSql(ctx.flex, { commandId: ctx.cmd('rv-overlap'), proposalId: so.proposal_id, proposal: overlapping, expected: rState })),
      'GV011', /REVALIDATION_OVERLAPS_PRIOR_INTERVAL/);
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${ctx.cmd('rv-overlap')}'`), '0', 'not consumed');
    const exact = k.validateProposal(pid, 'PERSON', tR);
    const se = await k.submit(ctx, ctx.member, 'rv-exact-submit', exact);
    const v2 = await exec(k.decideSql(ctx.flex, { commandId: ctx.cmd('rv-exact'), proposalId: se.proposal_id, proposal: exact, expected: rState }));
    assert.deepEqual([v2.outcome, v2.governance_party_id], ['VALIDATED', pid], 'the SAME Party identity is re-validated (no replacement Party)');
    assert.equal(await k.canonical(v2.effective_from), tR, 'may begin exactly at the revocation instant');
    const env = await envelope(v2.registry_state_id);
    assert.deepEqual([env.predecessor_state_id, env.revokes_state_id], [rState, null]);
    assert.notEqual(v2.authorization_decision_id, (await envelope(v1State)).authorization_decision_id);
    assert.equal((await k.head(ctx.org, pid))!.latest_state_id, v2.registry_state_id);
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_parties where organisation_id='${ctx.org}' and admission_authorization_decision_id='${party.authorization_decision_id}'`), '1');
  });

  await t.test('REVOKE must fall strictly inside the target validity (GV011); immediate REVOKE of a pending future state fails closed', async () => {
    const x = await k.setup();
    const a = await k.validated(x, 'ri');
    const tV = await k.canonical(a.decided.effective_from);
    for (const [name, at] of [['ri-at', tV], ['ri-before', await one(`select to_char(('${tV}'::timestamptz - interval '1 second') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`)]]) {
      const rp = k.revokeProposal(a.partyId, a.decided.registry_state_id, 'PERSON', at);
      const rs = await k.submit(x, x.member, `${name}-submit`, rp);
      await rejects(c.svc(k.decideSql(x.flex, { commandId: x.cmd(name), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE',
        expected: a.decided.registry_state_id })), 'GV011', /REVOKE_NOT_AFTER_TARGET_EFFECTIVE/);
    }
    const f = await k.validated(x, 'rf', 'PERSON', await k.instant('1 hour'), x.flex);
    const rp = k.revokeProposal(f.partyId, f.decided.registry_state_id);
    const rs = await k.submit(x, x.member, 'rf-revoke-submit', rp);
    await rejects(c.svc(k.decideSql(x.steward, { commandId: x.cmd('rf-now'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE',
      expected: f.decided.registry_state_id })), 'GV011', /REVOKE_NOT_AFTER_TARGET_EFFECTIVE/);
    // Revocation needs the exact dating grant too (steward has none): future-dated inside the validity → DENY.
    const later = k.revokeProposal(f.partyId, f.decided.registry_state_id, 'PERSON', await k.instant('3 hours'));
    const ls = await k.submit(x, x.member, 'rf-later-submit', later);
    assert.equal((await exec(k.decideSql(x.steward, { commandId: x.cmd('rf-later-steward'), proposalId: ls.proposal_id, proposal: later, outcome: 'REVOKE',
      expected: f.decided.registry_state_id }))).deny_reason, 'TEMPORAL_ACTION_NOT_AUTHORIZED');
    assert.equal((await exec(k.decideSql(x.flex, { commandId: x.cmd('rf-later-flex'), proposalId: ls.proposal_id, proposal: later, outcome: 'REVOKE',
      expected: f.decided.registry_state_id }))).outcome, 'REVOKED');
  });

  await t.test('head / compare-and-set: stale expectations are GV009 and never consumed; the head only advances along lineage', async () => {
    const x = await k.setup();
    const a = await k.validated(x, 'cas');
    const s = a.decided.registry_state_id as string;
    const rp = k.revokeProposal(a.partyId, s);
    const rs = await k.submit(x, x.member, 'cas-rsubmit', rp);
    const before = await k.counts(x.org);
    await rejects(c.svc(k.decideSql(x.steward, { commandId: x.cmd('cas-none'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE', expected: null })),
      'GV009', /PARTY_STATE_EXISTS/);
    await rejects(c.svc(k.decideSql(x.steward, { commandId: x.cmd('cas-other'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE', expected: a.admitted.authorization_decision_id })),
      'GV009', /PARTY_STATE_EXPECTATION_MISMATCH/);
    assert.deepEqual(await k.counts(x.org), before, 'a stale command consumes nothing');
    assert.equal((await exec(k.decideSql(x.steward, { commandId: x.cmd('cas-none'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE', expected: s }))).outcome,
      'REVOKED', 'the same command id succeeds once current');
    // Direct owner writes cannot bend the pointer.
    const other = await k.validated(x, 'cas-other-party');
    for (const statement of [
      `update gov_repo.l14_governance_party_heads set latest_state_id='${other.decided.registry_state_id}' where governance_party_id='${a.partyId}'`,
      `update gov_repo.l14_governance_party_heads set latest_state_id=null where governance_party_id='${a.partyId}'`,
      `update gov_repo.l14_governance_party_heads set latest_state_id='${s}' where governance_party_id='${a.partyId}'`,
      `update gov_repo.l14_governance_party_heads set party_kind='GROUP' where governance_party_id='${a.partyId}'`,
      `delete from gov_repo.l14_governance_party_heads where governance_party_id='${a.partyId}'`,
      'truncate gov_repo.l14_governance_party_heads',
      `insert into gov_repo.l14_governance_party_heads values ('${x.org}', gen_random_uuid(), 'PERSON', '${s}')`,
    ]) {
      await assert.rejects(owner(statement), /55000|23503|23505/, statement);
    }
    await rejects(owner(`update gov_repo.l14_governance_party_heads set latest_state_id='${s}' where governance_party_id='${a.partyId}'`), '55000', /LINEAGE/);
  });

  await t.test('bitemporal resolver: as-of matrix across validation, revocation and re-validation; recorded cutoff; no fallback; ambiguity fails closed', async () => {
    const x = await k.setup();
    const a = await k.validated(x, 'bt');
    const t1 = await k.canonical(a.decided.effective_from);
    const r = await k.revoke(x, 'bt-r', a.partyId, a.decided.registry_state_id);
    const t2 = await k.canonical(r.decided.effective_from);
    const vp = k.validateProposal(a.partyId);
    const vs = await k.submit(x, x.member, 'bt-v2-submit', vp);
    const v2 = await k.decide(x, x.steward, 'bt-v2', vs, vp);
    const t3 = await k.canonical(v2.effective_from);
    const at = (base: string, delta = '0') => `('${base}'::timestamptz + interval '${delta} microsecond')`;
    const NOW = 'clock_timestamp()';
    const V1 = a.decided.registry_state_id, V2 = v2.registry_state_id;
    const matrix: Array<[string, string, string | null]> = [
      [at(t1, '-1'), NOW, null], [at(t1), NOW, V1], [at(t2, '-1'), NOW, V1], [at(t2), NOW, null],
      [at(t3, '-1'), NOW, null], [at(t3), NOW, V2], [NOW, NOW, V2],
      // As known at earlier recorded cutoffs.
      [NOW, at(t1, '-1'), null], [NOW, at(t2, '-1'), V1], [NOW, at(t3, '-1'), null], [at(t2, '-1'), at(t2, '-1'), V1],
    ];
    for (const [business, cutoff, expected] of matrix) {
      assert.equal(await k.resolve(x.org, a.partyId, business, cutoff), expected, `${business} as of ${cutoff}`);
    }
    // Backdated revocation: business history corrected, the earlier knowledge preserved.
    const b = await k.validated(x, 'bt-b', 'PERSON', await k.instant('-3 hours'), x.flex);
    const rb = await k.revoke(x, 'bt-rb', b.partyId, b.decided.registry_state_id, 'PERSON', await k.instant('-1 hour'), x.flex);
    const rbRecorded = (await envelope(rb.decided.registry_state_id)).recorded_at;
    const mid = `(clock_timestamp() - interval '30 minutes')`;
    assert.equal(await k.resolve(x.org, b.partyId, mid, `('${rbRecorded}'::timestamptz - interval '1 microsecond')`), b.decided.registry_state_id);
    assert.equal(await k.resolve(x.org, b.partyId, mid, NOW), null);
    // No fallback: an admitted-but-never-validated Party, an unknown id, another tenant.
    const bare = await exec(k.admitSql(x.registrar, { commandId: x.cmd('bt-bare') }));
    assert.equal(await k.resolve(x.org, bare.governance_party_id, NOW, NOW), null);
    assert.equal(await k.resolve(x.org, x.member.id, NOW, NOW), null);
    assert.equal(await k.resolve(ctx.org, a.partyId, NOW, NOW), null, 'another tenant never resolves it');
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_party_valid_state_v1('${x.org}', null, now(), now())`), '0', 'STRICT');
    // Ambiguity fails closed: force two concurrently-valid states (rolled back; bootstrap disables the structural guards).
    const q = await k.validated(x, 'bt-q');
    const out = await c.bootstrapSql(`begin;
      alter table gov_repo.l14_governance_party_states disable trigger all;
      drop index gov_repo.l14_governance_party_states_root_uidx;
      update gov_repo.l14_governance_party_states set governance_party_id='${a.partyId}' where state_id='${q.decided.registry_state_id}';
      select 'raw:'||count(*) from gov_repo.l14_governance_party_states d join gov_repo.l14_registry_states s using (organisation_id, state_id)
        where d.governance_party_id='${a.partyId}' and s.state_kind='VALIDATED' and not exists (
          select 1 from gov_repo.l14_registry_states r where r.revokes_state_id=s.state_id);
      select 'resolved:'||count(*) from gov_repo.l14_governance_party_valid_state_v1('${x.org}', '${a.partyId}', clock_timestamp(), clock_timestamp());
      rollback;`);
    assert.match(out, /raw:2/);
    assert.match(out, /resolved:0/);
    assert.equal(await k.resolve(x.org, a.partyId, NOW, NOW), V2, 'restored after rollback');
    const src = await owner(`select prosrc from pg_proc where proname='l14_governance_party_valid_state_v1'`);
    assert.ok(!/governance_users|directory_profiles|governance_party_heads/.test(src), 'no user/profile/head fallback');
  });

  await t.test('structural guards: a Party state detail must mirror its envelope and its decided proposal (rolled-back owner probes)', async () => {
    const x = await k.setup();
    const a = await k.validated(x, 'sg');
    const b = await k.validated(x, 'sg-b');
    // Re-point an existing detail at another Party inside a rolled-back transaction: rejected by the guard.
    await rejects(owner(`begin; insert into gov_repo.l14_governance_party_states (organisation_id, state_id, state_kind, governance_party_id, party_kind)
      values ('${x.org}', '${b.decided.registry_state_id}', 'VALIDATED', '${a.partyId}', 'PERSON'); rollback;`), 'GV010', /PARTY_STATE_PROPOSAL_MISMATCH/);
    await rejects(owner(`begin; insert into gov_repo.l14_governance_party_states (organisation_id, state_id, state_kind, governance_party_id, party_kind)
      values ('${x.org}', gen_random_uuid(), 'VALIDATED', '${a.partyId}', 'PERSON'); rollback;`), 'GV010', /PARTY_STATE_ENVELOPE_MISMATCH/);
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_party_states where organisation_id='${x.org}'`), '2');
  });
});
