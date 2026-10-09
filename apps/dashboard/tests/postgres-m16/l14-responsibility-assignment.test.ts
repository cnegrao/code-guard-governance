import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { L14ResponsibilityRole, L14ResponsibilityTargetKind } from '@council/canonical-contracts';
import { decideResponsibilityAssignmentProposalFingerprint } from '@council/governance-review';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { lit } from '../helpers/m16-governed-write-fixtures';
import { BOGUS_FINGERPRINT, responsibilityKit, type Key } from '../helpers/m16-l14-responsibility-fixtures';

/**
 * M16-S1C.1 — RESPONSIBILITY_ASSIGNMENT (the first authoritative M16 fact family) on real disposable PostgreSQL 17 (S1C1
 * horizon). Every command goes through the real public RPCs as service_role; every GovernanceParty through the real S1B.1
 * Party RPCs; every Authority Policy through the real AP RPCs. Owner access is used only to seed administrator support rows
 * (canonical objects, evidence, directory profiles), to read evidence and for rolled-back structural probes.
 */
test('M16 S1C.1 responsibility assignment lifecycle (disposable PG17)', { timeout: 2_400_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C1' });
  t.after(() => c.stop());
  const { owner, exec, rejects } = c;
  const k = await responsibilityKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const row = async (query: string) => JSON.parse(await one(`select coalesce((${query}), 'null'::json)`));
  const authz = (id: string) => row(`select to_json(a) from gov_repo.l14_authorization_decisions a where authorization_decision_id='${id}'`);
  const fact = (id: string) => row(`select to_json(s) from gov_repo.l14_fact_states s where fact_state_id='${id}'`);
  const ts = (value: string) => `'${value}'::timestamptz`;
  const now = 'clock_timestamp()';

  await t.test('no automatic promotion: the migration created no fact, head, proposal or decision for any organisation', async () => {
    for (const table of ['l14_fact_states', 'l14_responsibility_assignment_states', 'l14_responsibility_assignment_proposals',
      'l14_responsibility_assignment_heads']) {
      assert.equal(await one(`select count(*) from gov_repo.${table}`), '0', table);
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_decisions where subject_kind='RESPONSIBILITY_ASSIGNMENT'`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where fact_state_id is not null`), '0');
  });

  const ctx = await k.setup();
  const p1 = await k.party(ctx, 'p1');
  const p2 = await k.party(ctx, 'p2');
  const p3 = await k.party(ctx, 'p3', 'GROUP');

  // ---------------------------------------------------------------------------------------
  await t.test('every LEGAL pairing validates through proposal → authorization → decision → fact → head → resolver', async () => {
    const legal: Array<[L14ResponsibilityTargetKind, keyof typeof ctx.objects, L14ResponsibilityRole]> = [
      ['AGENT', 'agent', 'BUSINESS_OWNER'], ['AGENT', 'agent', 'TECHNICAL_OWNER'], ['DATA_ASSET', 'asset', 'DATA_OWNER'],
      ['DATA_ASSET', 'asset', 'DATA_STEWARD'], ['DATA_ELEMENT', 'element', 'DATA_OWNER'], ['DATA_ELEMENT', 'element', 'DATA_STEWARD']];
    for (const [kind, object, role] of legal) {
      const key = k.keyOf(kind, ctx.objects[object], role, p1.partyId);
      const before = await k.counts(ctx.org);
      const proposal = k.validateProposal(key, p1.stateId);
      const submitted = await k.submit(ctx, ctx.member, `legal-${role}-${kind}-submit`, proposal);
      assert.deepEqual([submitted.outcome, submitted.command_kind, submitted.subject_kind, submitted.authorization_decision_id,
        submitted.governance_decision_id, submitted.fact_state_id, submitted.target_kind, submitted.target_canonical_object_id,
        submitted.responsibility_role, submitted.governance_party_id, submitted.party_validated_state_id],
      ['SUBMITTED', 'SUBMIT_PROPOSAL', 'RESPONSIBILITY_ASSIGNMENT', null, null, null, kind, ctx.objects[object], role, p1.partyId, p1.stateId]);
      const mid = await k.counts(ctx.org);
      assert.equal(mid.l14_proposals, before.l14_proposals + 1);
      assert.equal(mid.l14_responsibility_assignment_proposals, before.l14_responsibility_assignment_proposals + 1);
      for (const table of ['l14_authorization_decisions', 'l14_governance_decisions', 'l14_fact_states', 'l14_responsibility_assignment_states',
        'l14_responsibility_assignment_heads'] as const) {
        assert.equal(mid[table], before[table], `submission writes no ${table}`);
      }
      const decided = await k.decide(ctx, ctx.rs, `legal-${role}-${kind}-validate`, submitted, proposal);
      assert.deepEqual([decided.outcome, decided.state_kind, decided.effective_to, decided.authorization_result, decided.expectation_kind],
        ['VALIDATED', 'VALIDATED', null, 'ALLOW', 'EXPECTED_NONE']);
      const a = await authz(decided.authorization_decision_id);
      assert.deepEqual({ action: a.requested_action, subject: a.subject_kind, scope: a.scope_tag, kind: a.target_canonical_kind,
        object: a.target_canonical_object_id, basis: a.basis_version_id, self: a.is_self_validation },
      { action: 'VALIDATE', subject: 'RESPONSIBILITY_ASSIGNMENT', scope: 'CANONICAL_OBJECT', kind, object: ctx.objects[object],
        basis: ctx.v1.version_id, self: false });
      assert.equal(await one(`select string_agg(permission||'/'||requested_action||'/'||scope_tag, ',') from gov_repo.l14_authorization_decision_rules
        where authorization_decision_id='${decided.authorization_decision_id}'`), 'L14_RESPONSIBILITY_VALIDATE/VALIDATE/ALL_ALLOWED_TARGETS');
      const f = await fact(decided.fact_state_id);
      assert.deepEqual([f.subject_kind, f.state_kind, f.trust_state, f.source_class, f.predecessor_state_id, f.governance_decision_id,
        f.authority_policy_version_id], ['RESPONSIBILITY_ASSIGNMENT', 'VALIDATED', 'VALIDATED', 'LOCAL_HUMAN', null,
        decided.governance_decision_id, ctx.v1.version_id]);
      assert.equal(await k.head(ctx.org, key), decided.fact_state_id);
      assert.equal(await k.resolve(ctx.org, key, now, now), decided.fact_state_id);
      assert.equal(await one(`select reason_code from gov_repo.l14_governance_decisions where governance_decision_id='${decided.governance_decision_id}'`),
        'RESPONSIBILITY_ASSIGNMENT_VALIDATED');
    }
    assert.deepEqual((await k.current(ctx.org, 'AGENT', ctx.objects.agent)).map(r => r.split(':')[0]), ['BUSINESS_OWNER', 'TECHNICAL_OWNER']);
    assert.deepEqual((await k.current(ctx.org, 'DATA_ASSET', ctx.objects.asset)).map(r => r.split(':')[0]), ['DATA_OWNER', 'DATA_STEWARD']);
    assert.deepEqual((await k.current(ctx.org, 'DATA_ELEMENT', ctx.objects.element)).map(r => r.split(':')[0]), ['DATA_OWNER', 'DATA_STEWARD']);
    // Absence is UNKNOWN (no row), never an implied owner.
    assert.deepEqual(await k.current(ctx.org, 'AGENT', ctx.objects.agent2), []);
    assert.deepEqual(await k.current(ctx.org, 'AGENT_VERSION', ctx.objects.agentVersion), []);
  });

  await t.test('every ILLEGAL pairing and every non-responsibility kind is rejected before anything is written', async () => {
    const before = await k.counts(ctx.org);
    const illegal: Array<[string, string, string, RegExp]> = [
      ['AGENT', ctx.objects.agent, 'DATA_OWNER', /RESPONSIBILITY_ROLE_TARGET_ILLEGAL/],
      ['AGENT', ctx.objects.agent, 'DATA_STEWARD', /RESPONSIBILITY_ROLE_TARGET_ILLEGAL/],
      ['DATA_ASSET', ctx.objects.asset, 'BUSINESS_OWNER', /RESPONSIBILITY_ROLE_TARGET_ILLEGAL/],
      ['DATA_ASSET', ctx.objects.asset, 'TECHNICAL_OWNER', /RESPONSIBILITY_ROLE_TARGET_ILLEGAL/],
      ['DATA_ELEMENT', ctx.objects.element, 'BUSINESS_OWNER', /RESPONSIBILITY_ROLE_TARGET_ILLEGAL/],
      ['DATA_ELEMENT', ctx.objects.element, 'TECHNICAL_OWNER', /RESPONSIBILITY_ROLE_TARGET_ILLEGAL/],
      ...(['BUSINESS_OWNER', 'TECHNICAL_OWNER', 'DATA_OWNER', 'DATA_STEWARD'].map(r =>
        ['AGENT_VERSION', ctx.objects.agentVersion, r, /RESPONSIBILITY_TARGET_KIND_ILLEGAL/] as [string, string, string, RegExp])),
      ...(['MODEL', 'TOOL', 'MCP_SERVER', 'API', 'PROMPT', 'KNOWLEDGE_BASE', 'SKILL', 'OWNER', 'agent'].map(kind =>
        [kind, ctx.objects.model, 'BUSINESS_OWNER', /RESPONSIBILITY_TARGET_KIND_ILLEGAL/] as [string, string, string, RegExp])),
      ['AGENT', ctx.objects.agent, 'OWNER', /RESPONSIBILITY_ROLE_UNKNOWN/],
      ['AGENT', ctx.objects.agent, 'business_owner', /RESPONSIBILITY_ROLE_UNKNOWN/],
      ['DATA_ASSET', ctx.objects.asset, 'DATA_CUSTODIAN', /RESPONSIBILITY_ROLE_UNKNOWN/],
    ];
    for (const [kind, object, role, detail] of illegal) {
      const proposal = { ...k.validateProposal(k.keyOf('AGENT', object, 'BUSINESS_OWNER', p1.partyId), p1.stateId),
        targetKind: kind as L14ResponsibilityTargetKind, responsibilityRole: role as L14ResponsibilityRole };
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`illegal-${kind}-${role}`), proposal, fingerprint: BOGUS_FINGERPRINT })),
        'GV010', detail);
    }
    assert.deepEqual(await k.counts(ctx.org), before, 'nothing written');
  });

  await t.test('exact target identity: wrong tenant, wrong kind for a real id, missing / malformed id are rejected; never by name / label', async () => {
    const other = await k.setup();
    const before = await k.counts(ctx.org);
    for (const [name, kind, object, detail, syntactic] of [
      ['wrong tenant', 'AGENT', other.objects.agent, /TARGET_OBJECT_UNRESOLVED/, false],
      ['wrong kind for a real agent id', 'DATA_ASSET', ctx.objects.agent, /TARGET_OBJECT_UNRESOLVED/, false],
      ['wrong kind for a real asset id', 'DATA_ELEMENT', ctx.objects.asset, /TARGET_OBJECT_UNRESOLVED/, false],
      ['missing id', 'AGENT', `canonical-object:missing-${randomUUID()}`, /TARGET_OBJECT_UNRESOLVED/, false],
      ['label instead of id', 'AGENT', `${ctx.label}-agent`, /TARGET_OBJECT_UNRESOLVED/, false],
      ['untrimmed id', 'AGENT', ` ${ctx.objects.agent}`, /TARGET_OBJECT_ID_MALFORMED/, true],
      ['empty id', 'AGENT', '', /TARGET_OBJECT_ID_MALFORMED/, true],
    ] as const) {
      const role: L14ResponsibilityRole = kind === 'AGENT' ? 'BUSINESS_OWNER' : 'DATA_OWNER';
      const proposal = k.validateProposal(k.keyOf(kind, object, role, p1.partyId), p1.stateId);
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`target-${name}`), proposal,
        fingerprint: syntactic ? BOGUS_FINGERPRINT : undefined })), 'GV010', detail);
    }
    assert.deepEqual(await k.counts(ctx.org), before);
  });

  await t.test('Party dependency: missing / unvalidated / foreign / other-Party states rejected; a revoked Party never validates', async () => {
    const other = await k.setup();
    const foreign = await k.party(other, 'foreign');
    const unvalidated = await k.admittedParty(ctx, 'unval');
    const key = (party: string) => k.keyOf('AGENT', ctx.objects.agent2, 'BUSINESS_OWNER', party);
    const submitFails = async (name: string, party: string, state: string, detail: RegExp) =>
      rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`dep-${name}`), proposal: k.validateProposal(key(party), state) })), 'GV010', detail);
    await submitFails('missing-party', randomUUID(), randomUUID(), /PARTY_UNRESOLVED/);
    await submitFails('unvalidated-party', unvalidated, randomUUID(), /PARTY_DEPENDENCY_UNRESOLVED/);
    await submitFails('foreign-party', foreign.partyId, foreign.stateId, /PARTY_UNRESOLVED/);
    await submitFails('foreign-state-substitution', p1.partyId, foreign.stateId, /PARTY_DEPENDENCY_UNRESOLVED/);
    await submitFails('other-party-state', p1.partyId, p2.stateId, /PARTY_DEPENDENCY_UNRESOLVED/);
    // A revoked Party: its old VALIDATED state is still an exact VALIDATED row (proposal accepted), but it is not the valid
    // Party state at the effective instant, so the decision is refused and consumes nothing.
    const gone = await k.party(ctx, 'gone');
    await k.revokeParty(ctx, 'gone', gone);
    const proposal = k.validateProposal(key(gone.partyId), gone.stateId);
    const submitted = await k.submit(ctx, ctx.member, 'dep-revoked-submit', proposal);
    const before = await k.counts(ctx.org);
    await rejects(c.svc(k.decideSql(ctx.rs, { commandId: ctx.cmd('dep-revoked-validate'), proposalId: submitted.proposal_id, proposal })),
      'GV010', /PARTY_DEPENDENCY_NOT_VALID/);
    assert.deepEqual(await k.counts(ctx.org), before, 'no authorization / decision / fact consumed');
  });

  await t.test('PII boundary: directory profile values never reach a proposal, authorization, decision, fact, result or support link', async () => {
    const pii = { name: `Ana Example ${randomUUID()}`, email: `ana.${randomUUID()}@example.invalid`, phone: '+351 900 000 000',
      profile: `Profile ${randomUUID()}` };
    const person = await k.party(ctx, 'pii');
    await owner(`insert into gov_repo.governance_party_directory_profiles(organisation_id,governance_party_id,party_kind,display_name,email,phone,
      profile_text,governance_user_id,updated_at) values ('${ctx.org}','${person.partyId}','PERSON',${lit(pii.name)},${lit(pii.email)},${lit(pii.phone)},
      ${lit(pii.profile)},'${ctx.member.id}',now())`);
    const a = await k.assign(ctx, 'pii', k.keyOf('DATA_ELEMENT', ctx.objects.element2, 'DATA_STEWARD', person.partyId), person);
    assert.equal(a.decided.outcome, 'VALIDATED');
    const dump = await one(`select string_agg(x, '|') from (${['l14_proposals', 'l14_responsibility_assignment_proposals', 'l14_authorization_decisions',
      'l14_governance_decisions', 'l14_fact_states', 'l14_responsibility_assignment_states', 'l14_responsibility_assignment_heads',
      'l14_command_results', 'l14_support_links'].map(t => `select t::text as x from gov_repo.${t} t where organisation_id='${ctx.org}'`).join(' union all ')}) s`);
    for (const value of Object.values(pii)) assert.ok(!dump.includes(value), `no ${value} in L14 history`);
    assert.ok(!JSON.stringify(a.decided).includes(pii.email) && !JSON.stringify(a.submitted).includes(pii.name));
    // Profile erasure never alters fact history.
    const digest = await k.historyDigest(ctx.org);
    await owner(`update gov_repo.governance_party_directory_profiles set display_name=null,email=null,phone=null,profile_text=null,
      governance_user_id=null,external_identity_ref=null,erasure_state='ERASED' where governance_party_id='${person.partyId}'`);
    assert.equal(await k.historyDigest(ctx.org), digest);
    assert.equal(await k.resolve(ctx.org, a.proposal, now, now), a.stateId, 'the fact stays current: the profile is not authority');
  });

  await t.test('source boundary: SYSTEM_SEED / SOURCE_CONNECTION never masquerade as LOCAL_HUMAN; the structural guard backs the RPC', async () => {
    const key = k.keyOf('DATA_ASSET', ctx.objects.asset2, 'DATA_STEWARD', p1.partyId);
    for (const sourceClass of ['SYSTEM_SEED', 'SOURCE_CONNECTION'] as const) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`src-${sourceClass}`), fingerprint: BOGUS_FINGERPRINT,
        proposal: { ...k.validateProposal(key, p1.stateId), sourceClass } })), 'GV010', /SOURCE_CLASS_NOT_EXECUTABLE/);
    }
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('src-unknown'), fingerprint: BOGUS_FINGERPRINT,
      proposal: { ...k.validateProposal(key, p1.stateId), sourceClass: 'SCANNER' as never } })), 'GV010', /PROPOSAL_VOCABULARY_UNKNOWN/);
    // Even the owner cannot write a non-LOCAL_HUMAN typed proposal (rolled back).
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
      insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values ('${ctx.org}','00000000-0000-4000-8000-000000000001','RESPONSIBILITY_ASSIGNMENT','VALIDATE','SYSTEM_SEED','${ctx.member.id}','NONE',now());
      insert into gov_repo.l14_responsibility_assignment_proposals(organisation_id,proposal_id,intent,target_kind,target_canonical_object_id,
        responsibility_role,governance_party_id,party_kind,party_validated_state_id)
        values ('${ctx.org}','00000000-0000-4000-8000-000000000001','VALIDATE','DATA_ASSET',${lit(ctx.objects.asset2)},'DATA_STEWARD',
          '${p1.partyId}','PERSON','${p1.stateId}');
      rollback;`), /RESPONSIBILITY_PROPOSAL_SOURCE_INVALID/);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('authority: only L14_RESPONSIBILITY_VALIDATE over the exact typed target scope, current roles, current policy; durable DENY', async () => {
    const x = await k.setup();
    const pa = await k.party(x, 'auth');
    const deny = async (name: string, actor: typeof x.rs, key: Key, reason: string, options: { from?: string | null; self?: boolean } = {}) => {
      const proposal = k.validateProposal(key, pa.stateId, options.from ?? null);
      const submitted = await k.submit(x, options.self ? actor : x.member, `${name}-submit`, proposal);
      const r = await exec(k.decideSql(actor, { commandId: x.cmd(`${name}-decide`), proposalId: submitted.proposal_id, proposal }));
      assert.deepEqual([r.outcome, r.authorization_result, r.deny_reason, r.governance_decision_id, r.fact_state_id],
        ['DENIED', 'DENY', reason, null, null], name);
      const a = await authz(r.authorization_decision_id);
      assert.deepEqual([a.scope_tag, a.target_canonical_kind, a.target_canonical_object_id], ['CANONICAL_OBJECT', key.targetKind, key.targetCanonicalObjectId]);
      // Durable: the identical retry replays the original DENY (no new authorization).
      const again = await exec(k.decideSql(actor, { commandId: x.cmd(`${name}-decide`), proposalId: submitted.proposal_id, proposal }));
      assert.deepEqual([again.replay, again.outcome, again.authorization_decision_id, again.recorded_at], [true, 'DENIED', r.authorization_decision_id, r.recorded_at]);
      assert.equal(await k.head(x.org, key), null, 'a DENY creates no head');
      return { proposal, submitted, r };
    };
    const agentKey = k.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', pa.partyId);
    const assetKey = k.keyOf('DATA_ASSET', x.objects.asset, 'DATA_OWNER', pa.partyId);
    const asset2Key = k.keyOf('DATA_ASSET', x.objects.asset2, 'DATA_OWNER', pa.partyId);
    await deny('member', x.member2, agentKey, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('party-steward', x.steward, agentKey, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('ap-admin', x.boot, agentKey, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('contributor', x.rcontrib, agentKey, 'SOURCE_NOT_AUTHORIZED');
    await deny('kind-scope-mismatch', x.rkind, assetKey, 'SCOPE_NOT_AUTHORIZED');
    await deny('object-scope-mismatch', x.robject, asset2Key, 'SCOPE_NOT_AUTHORIZED');
    await deny('relationship-scope', x.rrel, agentKey, 'SCOPE_NOT_AUTHORIZED');
    await deny('self-validation', x.rs, agentKey, 'SELF_VALIDATION_NOT_PERMITTED', { self: true });
    await deny('backdated', x.rs, agentKey, 'TEMPORAL_ACTION_NOT_AUTHORIZED', { from: await k.instant('-1 hour') });
    await deny('future-dated', x.rs, agentKey, 'TEMPORAL_ACTION_NOT_AUTHORIZED', { from: await k.instant('+1 hour') });
    // Exact typed scopes authorize their exact targets only.
    const byKind = await k.assign(x, 'kind-ok', agentKey, pa, { validator: x.rkind });
    assert.equal(byKind.decided.outcome, 'VALIDATED');
    assert.equal(await one(`select string_agg(scope_tag||'/'||coalesce(scope_canonical_kind,'-'), ',') from gov_repo.l14_authorization_decision_rules
      where authorization_decision_id='${byKind.decided.authorization_decision_id}'`), 'CANONICAL_KIND/AGENT');
    const byObject = await k.assign(x, 'object-ok', assetKey, pa, { validator: x.robject });
    assert.equal(byObject.decided.outcome, 'VALIDATED');
    assert.equal(await one(`select string_agg(scope_tag||'/'||coalesce(scope_canonical_object_id,'-'), ',') from gov_repo.l14_authorization_decision_rules
      where authorization_decision_id='${byObject.decided.authorization_decision_id}'`), `CANONICAL_OBJECT/${x.objects.asset}`);
    // Self-validation only where the effective policy explicitly allows it.
    const selfKey = k.keyOf('DATA_ELEMENT', x.objects.element, 'DATA_STEWARD', pa.partyId);
    const proposal = k.validateProposal(selfKey, pa.stateId);
    const submitted = await k.submit(x, x.rflex, 'self-ok-submit', proposal);
    const self = await k.decide(x, x.rflex, 'self-ok', submitted, proposal);
    assert.deepEqual([self.outcome, (await authz(self.authorization_decision_id)).is_self_validation], ['VALIDATED', true]);
    // Authority changes: a NEW command after losing the role is denied; the old DENY command id never becomes ALLOW.
    const lost = k.keyOf('AGENT', x.objects.agent2, 'TECHNICAL_OWNER', pa.partyId);
    const lp = k.validateProposal(lost, pa.stateId);
    const ls = await k.submit(x, x.member, 'lost-submit', lp);
    await owner(`update gov_repo.governance_users set role_ids='{}'::uuid[] where user_id='${x.rs2.id}'`);
    const lr = await exec(k.decideSql(x.rs2, { commandId: x.cmd('lost-decide'), proposalId: ls.proposal_id, proposal: lp }));
    assert.deepEqual([lr.outcome, lr.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    await owner(`update gov_repo.governance_users set role_ids=array['${k.stewardRole}']::uuid[] where user_id='${x.rs2.id}'`);
    const replayed = await exec(k.decideSql(x.rs2, { commandId: x.cmd('lost-decide'), proposalId: ls.proposal_id, proposal: lp }));
    assert.deepEqual([replayed.replay, replayed.outcome], [true, 'DENIED'], 'changed eligibility requires a new command id');
    const fresh = await exec(k.decideSql(x.rs2, { commandId: x.cmd('lost-decide-2'), proposalId: ls.proposal_id, proposal: lp }));
    assert.equal(fresh.outcome, 'VALIDATED');
  });

  await t.test('requested action = exact outcome; closed reason codes; proposal terminality; DEFER non-terminal; correction = new linked proposal', async () => {
    const x = await k.setup();
    const pa = await k.party(x, 'term');
    const key = k.keyOf('AGENT', x.objects.agent, 'TECHNICAL_OWNER', pa.partyId);
    const proposal = k.validateProposal(key, pa.stateId);
    const submitted = await k.submit(x, x.member, 'term-submit', proposal);
    const sql = (name: string, outcome: 'VALIDATE' | 'REJECT' | 'DEFER' | 'REVOKE', reasonCode?: string) =>
      k.decideSql(x.rs, { commandId: x.cmd(name), proposalId: submitted.proposal_id, proposal, outcome, reasonCode,
        fingerprint: reasonCode ? BOGUS_FINGERPRINT : undefined });
    await rejects(c.svc(sql('term-wrong-reason', 'VALIDATE', 'RESPONSIBILITY_ASSIGNMENT_REJECTED')), 'GV010', /DECISION_VOCABULARY_INVALID/);
    await rejects(c.svc(sql('term-free-text', 'VALIDATE', 'Looks fine to me')), 'GV010', /DECISION_VOCABULARY_INVALID/);
    await rejects(c.svc(sql('term-other-subject', 'VALIDATE', 'GOVERNANCE_PARTY_VALIDATED')), 'GV010', /DECISION_VOCABULARY_INVALID/);
    await rejects(c.svc(sql('term-revoke-on-validate', 'REVOKE')), 'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    const deferred = await exec(sql('term-defer', 'DEFER'));
    assert.deepEqual([deferred.outcome, deferred.fact_state_id], ['DEFERRED', null]);
    const deferred2 = await exec(sql('term-defer-2', 'DEFER'));
    assert.equal(deferred2.outcome, 'DEFERRED', 'DEFER is non-terminal');
    const validated = await exec(sql('term-validate', 'VALIDATE'));
    assert.equal(validated.outcome, 'VALIDATED');
    for (const outcome of ['REJECT', 'DEFER'] as const) {
      await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd(`term-after-${outcome}`), proposalId: submitted.proposal_id, proposal, outcome,
        expected: validated.fact_state_id })), 'GV010', /PROPOSAL_TERMINAL/);
    }
    // REJECT is terminal; a correction is a NEW proposal linked to the prior one (same key).
    const key2 = k.keyOf('DATA_ASSET', x.objects.asset, 'DATA_OWNER', pa.partyId);
    const p2 = k.validateProposal(key2, pa.stateId);
    const s2 = await k.submit(x, x.member, 'rej-submit', p2);
    const rejected = await exec(k.decideSql(x.rs, { commandId: x.cmd('rej'), proposalId: s2.proposal_id, proposal: p2, outcome: 'REJECT' }));
    assert.deepEqual([rejected.outcome, rejected.fact_state_id, await k.head(x.org, key2)], ['REJECTED', null, null]);
    await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd('rej-then-validate'), proposalId: s2.proposal_id, proposal: p2 })), 'GV010', /PROPOSAL_TERMINAL/);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rej-bad-prior'), proposal: p2, prior: submitted.proposal_id })), 'GV010',
      /PRIOR_PROPOSAL_UNRESOLVED/);
    const corrected = await k.submit(x, x.member, 'rej-correction', p2, s2.proposal_id);
    assert.equal(await one(`select prior_proposal_id from gov_repo.l14_proposals where proposal_id='${corrected.proposal_id}'`), s2.proposal_id);
    assert.equal((await k.decide(x, x.rs, 'rej-correction-validate', corrected, p2)).outcome, 'VALIDATED');
    // REVOKE intent: REVOKE / REJECT / DEFER only; it pins the exact current state and never replaces it.
    const rp = k.revokeProposal(key, pa.stateId, validated.fact_state_id);
    const rs = await k.submit(x, x.member, 'rv-submit', rp);
    await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd('rv-validate'), proposalId: rs.proposal_id, proposal: rp, outcome: 'VALIDATE',
      expected: validated.fact_state_id })), 'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    assert.equal((await exec(k.decideSql(x.rs, { commandId: x.cmd('rv-defer'), proposalId: rs.proposal_id, proposal: rp, outcome: 'DEFER',
      expected: validated.fact_state_id }))).outcome, 'DEFERRED');
    const revoked = await exec(k.decideSql(x.rs, { commandId: x.cmd('rv-revoke'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE',
      expected: validated.fact_state_id }));
    const f = await fact(revoked.fact_state_id);
    assert.deepEqual([revoked.outcome, f.revokes_state_id, f.predecessor_state_id, f.effective_to], ['REVOKED', validated.fact_state_id,
      validated.fact_state_id, null]);
    assert.equal(await one(`select reason_code from gov_repo.l14_governance_decisions where governance_decision_id='${revoked.governance_decision_id}'`),
      'RESPONSIBILITY_ASSIGNMENT_REVOKED');
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-again'), proposal: rp })), 'GV010', /TARGET_ALREADY_REVOKED/);
    // REVOKE pins the exact dependency of its target.
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-dep-mismatch'),
      proposal: k.revokeProposal(key2, (await k.party(x, 'other-dep')).stateId, corrected.proposal_id) })), 'GV010', /PARTY_DEPENDENCY_UNRESOLVED|TARGET_STATE_UNRESOLVED/);
  });

  await t.test('replay: exact retry returns the ORIGINAL durable result; changed payload GV007; wrong fingerprint GV008; stale GV009', async () => {
    const x = await k.setup();
    const pa = await k.party(x, 'rp');
    const key = k.keyOf('DATA_ASSET', x.objects.asset, 'DATA_STEWARD', pa.partyId);
    const proposal = k.validateProposal(key, pa.stateId);
    const subSql = k.submitSql(x.member, { commandId: x.cmd('rp-submit'), proposal });
    const submitted = await exec(subSql);
    const subAgain = await exec(subSql);
    assert.deepEqual([subAgain.replay, subAgain.proposal_id, subAgain.recorded_at], [true, submitted.proposal_id, submitted.recorded_at]);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rp-submit'), proposal: { ...proposal, requestedEffectiveTo: await k.instant('+1 day') } })),
      'GV007', /COMMAND_ID_REUSED_WITH_DIFFERENT_SEMANTICS/);
    const decSql = k.decideSql(x.rs, { commandId: x.cmd('rp-decide'), proposalId: submitted.proposal_id, proposal });
    const decided = await exec(decSql);
    const before = await k.counts(x.org);
    const again = await exec(decSql);
    for (const field of ['outcome', 'authorization_decision_id', 'governance_decision_id', 'fact_state_id', 'effective_from', 'effective_to', 'recorded_at',
      'command_fingerprint']) assert.equal(again[field], decided[field], field);
    assert.equal(again.replay, true);
    assert.deepEqual(await k.counts(x.org), before, 'a replay writes nothing');
    await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd('rp-decide'), proposalId: submitted.proposal_id, proposal, outcome: 'DEFER' })),
      'GV007', /COMMAND_ID_REUSED_WITH_DIFFERENT_SEMANTICS/);
    // A deliberately WRONG caller fingerprint (PostgreSQL recomputes it): one framing part changed.
    const wrong = decideResponsibilityAssignmentProposalFingerprint({ organisationId: x.org, actorUserId: x.rs.id, outcome: 'VALIDATE',
      proposalId: submitted.proposal_id, proposal: { ...proposal, responsibilityRole: 'DATA_OWNER' }, expectedCurrentStateId: null,
      support: { status: 'NONE', evidenceIds: [] } });
    await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd('rp-wrong-fp'), proposalId: submitted.proposal_id, proposal, fingerprint: wrong })),
      'GV008', /CALLER_FINGERPRINT_DIFFERS/);
    // Stale expectation: an explicit expected-none when the key already has a state, or a wrong expected state.
    const p2 = k.validateProposal(key, pa.stateId);
    const s2 = await k.submit(x, x.member, 'rp-dup-submit', p2);
    const beforeRefused = await k.counts(x.org);
    await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd('rp-stale-none'), proposalId: s2.proposal_id, proposal: p2, expected: null })),
      'GV009', /RESPONSIBILITY_ASSIGNMENT_STATE_EXISTS/);
    await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd('rp-stale-wrong'), proposalId: s2.proposal_id, proposal: p2, expected: randomUUID() })),
      'GV009', /STATE_EXPECTATION_MISMATCH/);
    // The same steward Party twice on the same target: one active assignment per key.
    await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd('rp-dup'), proposalId: s2.proposal_id, proposal: p2, expected: decided.fact_state_id })),
      'GV010', /RESPONSIBILITY_ASSIGNMENT_ALREADY_VALIDATED/);
    assert.deepEqual(await k.counts(x.org), beforeRefused, 'none of the refused commands consumed anything');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('cardinality (sequential): one BUSINESS_OWNER / TECHNICAL_OWNER per AGENT, one DATA_OWNER per DATA_ASSET / DATA_ELEMENT', async () => {
    const x = await k.setup();
    const [a, b] = [await k.party(x, 'ca'), await k.party(x, 'cb', 'ORGANISATIONAL_UNIT')];
    for (const [kind, object, role] of [['AGENT', x.objects.agent, 'BUSINESS_OWNER'], ['AGENT', x.objects.agent, 'TECHNICAL_OWNER'],
      ['DATA_ASSET', x.objects.asset, 'DATA_OWNER'], ['DATA_ELEMENT', x.objects.element, 'DATA_OWNER']] as const) {
      const first = await k.assign(x, `card-${kind}-${role}-a`, k.keyOf(kind, object, role, a.partyId), a);
      assert.equal(first.decided.outcome, 'VALIDATED');
      const key = k.keyOf(kind, object, role, b.partyId);
      const proposal = k.validateProposal(key, b.stateId);
      const submitted = await k.submit(x, x.member, `card-${kind}-${role}-b-submit`, proposal);
      const before = await k.counts(x.org);
      await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd(`card-${kind}-${role}-b`), proposalId: submitted.proposal_id, proposal })),
        'GV009', /RESPONSIBILITY_SINGLE_OWNER_CONFLICT/);
      assert.deepEqual(await k.counts(x.org), before, 'the loser consumed nothing');
      assert.deepEqual((await k.current(x.org, kind, object)).filter(r => r.startsWith(`${role}:`)).map(r => r.split(':')[1]), [a.partyId]);
    }
    // The other role of the same agent and the same role of another target are independent.
    const other = await k.assign(x, 'card-other-target', k.keyOf('DATA_ASSET', x.objects.asset2, 'DATA_OWNER', b.partyId), b);
    assert.equal(other.decided.outcome, 'VALIDATED');
  });

  await t.test('DATA_STEWARD: several different Parties coexist on one DATA_ASSET / DATA_ELEMENT; the same Party at most once', async () => {
    const x = await k.setup();
    const parties = [await k.party(x, 'sa'), await k.party(x, 'sb', 'GROUP'), await k.party(x, 'sc')];
    for (const [kind, object] of [['DATA_ASSET', x.objects.asset], ['DATA_ELEMENT', x.objects.element]] as const) {
      for (const [i, p] of parties.entries()) {
        assert.equal((await k.assign(x, `stew-${kind}-${i}`, k.keyOf(kind, object, 'DATA_STEWARD', p.partyId), p)).decided.outcome, 'VALIDATED');
      }
      assert.deepEqual((await k.current(x.org, kind, object)).map(r => r.split(':')[1]).sort(), parties.map(p => p.partyId).sort());
      const dupKey = k.keyOf(kind, object, 'DATA_STEWARD', parties[0]!.partyId);
      const dup = k.validateProposal(dupKey, parties[0]!.stateId);
      const s = await k.submit(x, x.member, `stew-${kind}-dup-submit`, dup);
      await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd(`stew-${kind}-dup`), proposalId: s.proposal_id, proposal: dup,
        expected: await k.head(x.org, dupKey) })), 'GV010', /RESPONSIBILITY_ASSIGNMENT_ALREADY_VALIDATED/);
    }
  });

  await t.test('owner replacement: P1 → (overlap rejected) → explicit revoke → P2 at a non-overlapping instant; P1 history byte-identical', async () => {
    const x = await k.setup();
    const [a, b] = [await k.party(x, 'ra'), await k.party(x, 'rb')];
    const keyA = k.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', a.partyId);
    const keyB = k.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', b.partyId);
    const first = await k.assign(x, 'rep-a', keyA, a);
    const p1Rows = await k.stateRows(x.org, first.stateId);
    const pb = k.validateProposal(keyB, b.stateId);
    const sb = await k.submit(x, x.member, 'rep-b-submit', pb);
    await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd('rep-b-overlap'), proposalId: sb.proposal_id, proposal: pb })), 'GV009',
      /RESPONSIBILITY_SINGLE_OWNER_CONFLICT/);
    const tBefore = await one('select clock_timestamp()::text');
    const revoked = await k.revoke(x, 'rep-a', keyA, a.stateId, first.stateId);
    assert.equal(revoked.decided.outcome, 'REVOKED');
    const replaced = await exec(k.decideSql(x.rs, { commandId: x.cmd('rep-b'), proposalId: sb.proposal_id, proposal: pb }));
    assert.equal(replaced.outcome, 'VALIDATED');
    assert.ok(replaced.effective_from >= revoked.decided.effective_from, 'no effective-time overlap');
    assert.equal(await k.stateRows(x.org, first.stateId), p1Rows, 'P1 fact history byte-identical; no party-id rewrite');
    assert.equal(await one(`select count(*) from gov_repo.l14_responsibility_assignment_states where fact_state_id='${first.stateId}'
      and governance_party_id='${a.partyId}'`), '1');
    assert.equal(await one(`select count(*) from gov_repo.l14_responsibility_assignment_states where governance_party_id='${b.partyId}'
      and predecessor_state_id is not null`), '0', 'P2 is a different fact key with its own lineage root');
    // As-of: before the replacement → P1; now → P2.
    assert.equal(await k.resolve(x.org, keyA, ts(tBefore), ts(tBefore)), first.stateId);
    assert.equal(await k.resolve(x.org, keyA, ts(tBefore), now), first.stateId, 'still valid where it was valid');
    assert.equal(await k.resolve(x.org, keyA, now, now), null);
    assert.equal(await k.resolve(x.org, keyB, now, now), replaced.fact_state_id);
    assert.equal(await k.resolve(x.org, keyB, ts(tBefore), now), null);
    assert.deepEqual((await k.current(x.org, 'AGENT', x.objects.agent, ts(tBefore), ts(tBefore))).map(r => r.split(':')[1]), [a.partyId]);
    assert.deepEqual((await k.current(x.org, 'AGENT', x.objects.agent)).map(r => r.split(':')[1]), [b.partyId]);
  });

  await t.test('explicit effective_to: strictly after the start, immutable, fingerprinted; expiry without UPDATE; replacement exactly at the end', async () => {
    const x = await k.setup();
    const [a, b] = [await k.party(x, 'ea', 'PERSON', await k.instant('-2 hours')), await k.party(x, 'eb', 'PERSON', await k.instant('-2 hours'))];
    const keyA = k.keyOf('DATA_ASSET', x.objects.asset, 'DATA_OWNER', a.partyId);
    const keyB = k.keyOf('DATA_ASSET', x.objects.asset, 'DATA_OWNER', b.partyId);
    const start = await k.instant('-90 minutes');
    // effective_to == / < effective_from: rejected at submission (both explicit) …
    for (const [name, to] of [['eq', start], ['lt', await k.instant('-100 minutes')]] as const) {
      await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd(`et-${name}`), proposal: k.validateProposal(keyA, a.stateId, start, to),
        fingerprint: BOGUS_FINGERPRINT })), 'GV010', /EFFECTIVE_INTERVAL_INVALID/);
    }
    // … and at decision time for an IMMEDIATE start whose end is not after the DB instant (nothing consumed).
    const imm = k.validateProposal(keyA, a.stateId, null, await k.instant('-1 minute'));
    const immSub = await k.submit(x, x.member, 'et-imm-submit', imm);
    const before = await k.counts(x.org);
    await rejects(c.svc(k.decideSql(x.rflex, { commandId: x.cmd('et-imm'), proposalId: immSub.proposal_id, proposal: imm })), 'GV010',
      /EFFECTIVE_INTERVAL_INVALID/);
    assert.deepEqual(await k.counts(x.org), before);
    // A valid explicit interval in the past (BACKDATED, flex): already expired, never UPDATEd.
    const end = await k.instant('-30 minutes');
    const expired = await k.assign(x, 'et-a', keyA, a, { from: start, to: end });
    const f = await fact(expired.stateId);
    assert.deepEqual([await k.canonical(f.effective_from), await k.canonical(f.effective_to)], [start, end]);
    assert.equal(await k.canonical(expired.decided.effective_to), end, 'the durable result carries the immutable end');
    const rows = await k.stateRows(x.org, expired.stateId);
    assert.equal(await k.resolve(x.org, keyA, now, now), null, 'ceases to be current at its end, without UPDATE');
    assert.equal(await k.resolve(x.org, keyA, ts(await k.instant('-60 minutes')), now), expired.stateId, 'historical as-of inside the interval');
    assert.equal(await k.resolve(x.org, keyA, ts(end), now), null, 'half-open: the end instant is outside');
    // Overlapping another Party's interval: rejected; starting exactly at the prior end: accepted.
    const overlap = k.validateProposal(keyB, b.stateId, await k.instant('-45 minutes'));
    const os = await k.submit(x, x.member, 'et-b-overlap-submit', overlap);
    await rejects(c.svc(k.decideSql(x.rflex, { commandId: x.cmd('et-b-overlap'), proposalId: os.proposal_id, proposal: overlap })), 'GV009',
      /RESPONSIBILITY_SINGLE_OWNER_CONFLICT/);
    const exact = await k.assign(x, 'et-b', keyB, b, { from: end });
    assert.equal(exact.decided.outcome, 'VALIDATED');
    assert.equal(await k.resolve(x.org, keyB, now, now), exact.stateId);
    assert.equal(await k.stateRows(x.org, expired.stateId), rows, 'the expired fact is byte-identical');
    // The same key after its own explicit end: a lineage successor, never before the end.
    const keyA2 = k.keyOf('DATA_ELEMENT', x.objects.element, 'DATA_STEWARD', a.partyId);
    const e1 = await k.assign(x, 'et-a2', keyA2, a, { from: start, to: end });
    const tooEarly = k.validateProposal(keyA2, a.stateId, await k.instant('-40 minutes'));
    const te = await k.submit(x, x.member, 'et-a2-early-submit', tooEarly);
    await rejects(c.svc(k.decideSql(x.rflex, { commandId: x.cmd('et-a2-early'), proposalId: te.proposal_id, proposal: tooEarly,
      expected: e1.stateId })), 'GV011', /REVALIDATION_OVERLAPS_PRIOR_INTERVAL/);
    const succ = await k.assign(x, 'et-a2-succ', keyA2, a, { from: end });
    assert.equal((await fact(succ.stateId)).predecessor_state_id, e1.stateId);
    // A REVOKE never carries an end of its own and must fall inside its target's interval.
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('et-revoke-to'), fingerprint: BOGUS_FINGERPRINT,
      proposal: { ...k.revokeProposal(keyA2, a.stateId, succ.stateId), requestedEffectiveTo: await k.instant('+1 day') } })), 'GV010',
    /EFFECTIVE_TO_NOT_PERMITTED/);
    const key3 = k.keyOf('AGENT', x.objects.agent, 'TECHNICAL_OWNER', a.partyId);
    const bounded = await k.assign(x, 'et-bounded', key3, a, { from: start, to: end });
    const late = k.revokeProposal(key3, a.stateId, bounded.stateId, await k.instant('-10 minutes'));
    const ls = await k.submit(x, x.member, 'et-late-submit', late);
    await rejects(c.svc(k.decideSql(x.rflex, { commandId: x.cmd('et-late'), proposalId: ls.proposal_id, proposal: late, outcome: 'REVOKE',
      expected: bounded.stateId })), 'GV011', /REVOKE_AFTER_TARGET_EXPIRY/);
    const early = k.revokeProposal(key3, a.stateId, bounded.stateId, await k.instant('-2 hours'));
    const es = await k.submit(x, x.member, 'et-early-submit', early);
    await rejects(c.svc(k.decideSql(x.rflex, { commandId: x.cmd('et-early'), proposalId: es.proposal_id, proposal: early, outcome: 'REVOKE',
      expected: bounded.stateId })), 'GV011', /REVOKE_BEFORE_TARGET_EFFECTIVE/);
  });

  await t.test('temporal: omitted start = DB instant; explicit past / future need explicit permission; a future fact never hides the current one', async () => {
    const x = await k.setup();
    const [a, b] = [await k.party(x, 'ta'), await k.party(x, 'tb')];
    const before = await one('select clock_timestamp()::text');
    const imm = await k.assign(x, 'tm-imm', k.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', a.partyId), a, { to: await k.instant('+1 hour') });
    const f = await fact(imm.stateId);
    assert.equal(f.effective_from, f.recorded_at, 'IMMEDIATE = the DB transaction instant');
    assert.ok(Date.parse(f.effective_from) >= Date.parse(before));
    // The future successor (another Party) starts exactly at the current fact's end: both coexist without overlap.
    const fut = await k.assign(x, 'tm-fut', k.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', b.partyId), b, { from: await k.canonical(f.effective_to) });
    assert.equal(fut.decided.outcome, 'VALIDATED');
    assert.deepEqual((await k.current(x.org, 'AGENT', x.objects.agent)).map(r => r.split(':')[1]), [a.partyId], 'the future fact hides nothing');
    assert.deepEqual((await k.current(x.org, 'AGENT', x.objects.agent, ts(await k.instant('+2 hours')))).map(r => r.split(':')[1]), [b.partyId]);
    // Recorded-time axis: a cutoff before the decision's recorded_at never sees it.
    assert.equal(await k.resolve(x.org, k.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', a.partyId), now, ts(before)), null);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('O49: a Party revocation invalidates the assignment as current truth without any history mutation; no silent repin', async () => {
    const x = await k.setup();
    const p = await k.party(x, 'o49');
    const key = k.keyOf('DATA_ASSET', x.objects.asset, 'DATA_OWNER', p.partyId);
    const a = await k.assign(x, 'o49', key, p);
    assert.equal(await k.resolve(x.org, key, now, now), a.stateId, 'step 3: the resolver returns the assignment');
    const rows = await k.stateRows(x.org, a.stateId);
    const digest = await k.factDigest(x.org);
    const beforeRevoke = await one('select clock_timestamp()::text');
    const pr = await k.revokeParty(x, 'o49', p);
    const T = pr.effective_from as string;
    const R = await one(`select recorded_at::text from gov_repo.l14_registry_states where state_id='${pr.registry_state_id}'`);
    assert.equal(await k.stateRows(x.org, a.stateId), rows, 'step 5: responsibility history byte-identical');
    assert.equal(await k.factDigest(x.org), digest, 'no responsibility row of the organisation changed (the Party revocation is Party history only)');
    assert.equal(await k.resolve(x.org, key, ts(T), ts(R)), null, 'step 6: at T with a cutoff seeing the revocation → UNKNOWN');
    assert.equal(await k.resolve(x.org, key, now, now), null);
    assert.deepEqual(await k.current(x.org, 'DATA_ASSET', x.objects.asset), [], 'no current responsibility of the asset');
    assert.equal(await k.resolve(x.org, key, ts(beforeRevoke), ts(beforeRevoke)), a.stateId, 'step 7: an earlier cutoff keeps the historical fact');
    assert.equal(await k.resolve(x.org, key, ts(beforeRevoke), now), a.stateId, 'valid where it was valid');
    // Step 8: re-validating the Party mints a NEW Party state; the old assignment is NOT repinned.
    const p2 = await k.revalidateParty(x, 'o49', p);
    assert.notEqual(p2.stateId, p.stateId);
    assert.equal(await k.resolve(x.org, key, now, now), null, 'no silent repin to the replacement Party state');
    assert.equal(await k.stateRows(x.org, a.stateId), rows);
    // A new assignment can never pin the invalidated dependency …
    const stale = k.validateProposal(k.keyOf('DATA_ELEMENT', x.objects.element, 'DATA_STEWARD', p.partyId), p.stateId);
    const ss = await k.submit(x, x.member, 'o49-stale-submit', stale);
    await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd('o49-stale'), proposalId: ss.proposal_id, proposal: stale })), 'GV010',
      /PARTY_DEPENDENCY_NOT_VALID/);
    // … and restoring the SAME key requires explicit governance: revoke the old assignment, then a new decision pinning the new state.
    const direct = k.validateProposal(key, p2.stateId);
    const ds = await k.submit(x, x.member, 'o49-direct-submit', direct);
    await rejects(c.svc(k.decideSql(x.rs, { commandId: x.cmd('o49-direct'), proposalId: ds.proposal_id, proposal: direct, expected: a.stateId })),
      'GV010', /RESPONSIBILITY_ASSIGNMENT_ALREADY_VALIDATED/);
    const ended = await k.revoke(x, 'o49-end', key, p.stateId, a.stateId);
    assert.equal(ended.decided.outcome, 'REVOKED', 'a dependency-invalid assignment can still be ended explicitly');
    const restored = await k.decide(x, x.rs, 'o49-restore', ds, direct);
    assert.equal(restored.outcome, 'VALIDATED');
    assert.equal(await k.resolve(x.org, key, now, now), restored.fact_state_id);
    assert.equal((await fact(restored.fact_state_id)).predecessor_state_id, ended.decided.fact_state_id);
    assert.equal(await k.stateRows(x.org, a.stateId), rows);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('atomicity: an induced failure after the decision (at the head CAS / the fact INSERT) rolls the whole command back', async () => {
    for (const [name, table, timing] of [['head', 'l14_responsibility_assignment_heads', 'before update'],
      ['fact', 'l14_responsibility_assignment_states', 'before insert']] as const) {
      const x = await k.setup();
      const p = await k.party(x, `atom-${name}`);
      await c.evidence(x.org, `atom-${name}-ev`);
      const key = k.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', p.partyId);
      const proposal = k.validateProposal(key, p.stateId);
      const submitted = await k.submit(x, x.member, `atom-${name}-submit`, proposal);
      const commandId = x.cmd(`atom-${name}`);
      const sql = k.decideSql(x.rs, { commandId, proposalId: submitted.proposal_id, proposal, support: { status: 'PRESENT', evidenceIds: [`atom-${name}-ev`] } });
      const before = await k.counts(x.org);
      const history = await k.historyDigest(x.org);
      // Disposable-cluster-only failure injection: raises only once the governance decision of this command exists.
      await c.bootstrapSql(`create function public.s1c1_induced_failure() returns trigger language plpgsql
          set search_path = pg_catalog, pg_temp as $f$
          begin
            if not exists (select 1 from gov_repo.l14_governance_decisions d where d.organisation_id = new.organisation_id
                             and d.proposal_id = '${submitted.proposal_id}' and d.outcome = 'VALIDATE') then
              raise exception 'S1C1_INDUCED_FAILURE_WITHOUT_DECISION';
            end if;
            raise exception 'S1C1_INDUCED_FAILURE' using errcode = 'P0001';
          end $f$;
        create trigger zz_s1c1_induced_failure ${timing} on gov_repo.${table} for each row execute function public.s1c1_induced_failure();
        alter table gov_repo.${table} enable always trigger zz_s1c1_induced_failure;`);
      try {
        await assert.rejects(c.svc(sql), (error: Error) => {
          assert.match(error.message, /S1C1_INDUCED_FAILURE/);
          assert.doesNotMatch(error.message, /WITHOUT_DECISION/, 'the failure fired after the decision was written in the same transaction');
          return true;
        });
      } finally {
        await c.bootstrapSql(`drop trigger if exists zz_s1c1_induced_failure on gov_repo.${table}; drop function if exists public.s1c1_induced_failure();`);
      }
      assert.equal(await one(`select count(*) from pg_trigger where tgname='zz_s1c1_induced_failure'`), '0');
      assert.equal(await one(`select count(*) from gov_repo.l14_governance_decisions where proposal_id='${submitted.proposal_id}'`), '0', 'no decision');
      assert.equal(await one(`select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${x.org}' and command_id='${commandId}'`), '0');
      assert.equal(await one(`select count(*) from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${commandId}'`), '0',
        'the command is not consumed');
      assert.equal(await one(`select count(*) from gov_repo.l14_support_links where evidence_id='atom-${name}-ev'`), '0', 'no support link');
      assert.deepEqual(await k.counts(x.org), before, 'no fact, head or any other L14 row');
      assert.equal(await k.historyDigest(x.org), history);
      const r = await exec(sql);
      assert.deepEqual([r.outcome, r.replay], ['VALIDATED', false], 'the very same command now succeeds (not a replay)');
      assert.equal(await one(`select count(*) from gov_repo.l14_support_links where owner_kind='FACT_STATE' and fact_state_id='${r.fact_state_id}'`), '1');
    }
  });
});
