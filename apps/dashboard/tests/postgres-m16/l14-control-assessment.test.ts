import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { L14ControlApplicabilityTarget } from '@council/canonical-contracts';
import { decideControlAssessmentProposalFingerprint } from '@council/governance-review';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { ALL_KINDS } from '../helpers/m16-l14-control-applicability-fixtures';
import { ASSESSMENT_OUTCOMES, BOGUS_FINGERPRINT, controlAssessmentKit, inDays } from '../helpers/m16-l14-control-assessment-fixtures';

/**
 * M16-S1C.5 — CONTROL_ASSESSMENT (the fifth and final authoritative M16 fact family) on real disposable PostgreSQL 17 (S1C5
 * horizon). Every command goes through the real public RPCs as service_role; every control definition through the real S1B.6
 * RPCs, every applicability through the real S1C.4 RPCs and every Authority Policy through the real AP RPCs. Owner access is
 * used only to seed administrator support rows (canonical objects, canonical relationships, evidence), to read evidence and
 * for rolled-back structural probes.
 */
test('M16 S1C.5 control assessment lifecycle (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C5' });
  t.after(() => c.stop());
  const { owner, exec, rejects } = c;
  const k = await controlAssessmentKit(c);
  const ca = k.cak;
  const one = async (query: string) => lastLine(await owner(query));
  const row = async (query: string) => JSON.parse(await one(`select coalesce((${query}), 'null'::json)`));
  const authz = (id: string) => row(`select to_json(a) from gov_repo.l14_authorization_decisions a where authorization_decision_id='${id}'`);
  const fact = (id: string) => row(`select to_json(s) from gov_repo.l14_fact_states s where fact_state_id='${id}'`);
  const detail = (id: string) => row(`select to_json(s) from gov_repo.l14_control_assessment_states s where fact_state_id='${id}'`);
  const ts = (value: string) => `'${value}'::timestamptz`;
  const now = 'clock_timestamp()';

  await t.test('no automatic promotion; exactly five fact families; CONTROL_FINDING is never a family; WAIVED is never storable', async () => {
    for (const table of ['l14_control_assessment_states', 'l14_control_assessment_proposals', 'l14_control_assessment_heads']) {
      assert.equal(await one(`select count(*) from gov_repo.${table}`), '0', table);
    }
    for (const table of ['l14_fact_states', 'l14_proposals', 'l14_governance_decisions', 'l14_authorization_decisions', 'l14_command_results']) {
      assert.equal(await one(`select count(*) from gov_repo.${table} where subject_kind='CONTROL_ASSESSMENT'`), '0', table);
    }
    assert.equal(await one(`select pg_get_constraintdef(oid) from pg_constraint where conname='l14_fact_states_subject_kind_check'`),
      "CHECK ((subject_kind = ANY (ARRAY['RESPONSIBILITY_ASSIGNMENT'::text, 'BUSINESS_CONTEXT_ASSIGNMENT'::text, 'POLICY_APPLICABILITY'::text, 'CONTROL_APPLICABILITY'::text, 'CONTROL_ASSESSMENT'::text])))");
    // No finding relation / routine / vocabulary: CONTROL_FINDING is never a sixth family or an independent authority surface.
    assert.equal(await one(`select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname like 'l14\\_%finding%'`), '0');
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l14\\_%finding%'`), '0');
    assert.equal(await one(`select count(*) from pg_constraint where connamespace='gov_repo'::regnamespace and conname like 'l14\\_%'
      and pg_get_constraintdef(oid) ~ '(FINDING|WAIVED)'`), '0');
    for (const subject of ['CONTROL_FINDING', 'WAIVER']) {
      await assert.rejects(owner(`insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values (gen_random_uuid(), gen_random_uuid(), '${subject}', 'VALIDATE', 'LOCAL_HUMAN', gen_random_uuid(), 'NONE', now())`),
      /l14_proposals_subject_kind_check/, subject);
    }
    // The legacy control_assessments / control_findings tables stay quarantined: no S1C.5 routine reads them.
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace
      and (proname like 'l14\\_%control\\_assessment%' or proname = 'l14_lock_control_applicability_dependency_guard_shared_v1')
      and prosrc ~ '(^|[^A-Za-z0-9_])(control_assessments|control_findings|conformity_assessments)([^A-Za-z0-9_]|$)'`), '0');
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace
      and (proname like 'l14\\_%control\\_assessment%' or proname = 'l14_lock_control_applicability_dependency_guard_shared_v1')
      and prosrc ~* '(control_code|\\mtitle\\M|\\mdescription\\M|\\mcg_|cg-ag|\\mscore|coverage|maturity|\\mrisk|waiver|finding|\\mstatus\\M)'`), '0');
  });

  const ctx = await k.setup();

  // ---------------------------------------------------------------------------------------
  await t.test('object applicabilities: all 11 kinds are assessable through their exact APPLIES state (proposal → authz → decision → fact → head → resolver)', async () => {
    for (const kind of ALL_KINDS) {
      const target = ca.objectTarget(kind, ctx.objects.byKind[kind]);
      const applies = await k.applicability(ctx, `obj-${kind}`, target);
      const before = await k.counts(ctx.org);
      const until = inDays(90);
      const proposal = k.validateProposal(applies.stateId, 'SATISFIED', until);
      const submitted = await k.submit(ctx, ctx.member, `obj-${kind}-submit`, proposal);
      assert.deepEqual([submitted.outcome, submitted.command_kind, submitted.subject_kind, submitted.authorization_decision_id,
        submitted.governance_decision_id, submitted.fact_state_id, submitted.control_applicability_state_id, submitted.control_definition_id,
        submitted.control_definition_version_id, submitted.content_hash, submitted.assessment_outcome],
      ['SUBMITTED', 'SUBMIT_PROPOSAL', 'CONTROL_ASSESSMENT', null, null, null, applies.stateId, applies.pin.subject.controlDefinitionId,
        applies.pin.subject.controlDefinitionVersionId, applies.pin.subject.contentHash, 'SATISFIED'], kind);
      const afterSubmit = await k.counts(ctx.org);
      assert.deepEqual([afterSubmit.l14_authorization_decisions, afterSubmit.l14_governance_decisions, afterSubmit.l14_fact_states,
        afterSubmit.l14_control_assessment_heads], [before.l14_authorization_decisions, before.l14_governance_decisions,
        before.l14_fact_states, before.l14_control_assessment_heads], `${kind}: submission creates no authorization / decision / fact / head`);
      const decided = await k.decide(ctx, ctx.as, `obj-${kind}-validate`, submitted, proposal);
      assert.deepEqual([decided.outcome, decided.state_kind, decided.predecessor_state_id, decided.assessment_outcome,
        await ca.canonical(decided.valid_until)], ['VALIDATED', 'VALIDATED', null, 'SATISFIED', until], kind);
      const a = await authz(decided.authorization_decision_id);
      assert.deepEqual([a.scope_tag, a.target_canonical_kind, a.target_canonical_object_id, a.target_relationship_type, a.result, a.requested_action,
        a.subject_kind], ['CANONICAL_OBJECT', kind, ctx.objects.byKind[kind], null, 'ALLOW', 'VALIDATE', 'CONTROL_ASSESSMENT'], `${kind}: scope = applicability target`);
      // valid_until IS the envelope effective_to (no second end column).
      assert.equal(await ca.canonical((await fact(decided.fact_state_id)).effective_to), until);
      const d = await detail(decided.fact_state_id);
      assert.deepEqual([d.control_applicability_state_id, d.applicability, d.applicability_state_kind, d.control_definition_validated_state_id],
        [applies.stateId, 'APPLIES', 'VALIDATED', applies.pin.stateId], kind);
      assert.equal(await k.head(ctx.org, applies.stateId), decided.fact_state_id, kind);
      assert.equal(await k.resolve(ctx.org, applies.stateId), decided.fact_state_id, kind);
      assert.deepEqual(await k.current(ctx.org, target),
        [`${applies.pin.subject.controlDefinitionId}|${applies.stateId}|SATISFIED|${decided.fact_state_id}`], kind);
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_control_assessment_states where organisation_id='${ctx.org}'`), '11');
    assert.equal(await one(`select count(*) from information_schema.columns where table_schema='gov_repo'
      and table_name in ('l14_control_assessment_states','l14_control_assessment_proposals','l14_control_assessment_heads')
      and column_name in ('valid_until','effective_to','score','finding','waiver','rationale','target_type','control_code','title')`), '0');
  });

  await t.test('relationship-state applicabilities are assessable; scope = the exact state + DB-resolved type of the PINNED applicability', async () => {
    const x = await k.setup();
    const reads = ca.relTarget(x.rels.reads);
    const applies = await k.applicability(x, 'rel', reads);
    const r = await k.assess(x, 'rel', applies.stateId, { outcome: 'PARTIALLY_SATISFIED' });
    const a = await authz(r.decided.authorization_decision_id);
    assert.deepEqual([a.scope_tag, a.target_relationship_type, a.target_relationship_id, a.target_relationship_state_id, a.target_canonical_kind],
      ['RELATIONSHIP_STATE', 'READS_FROM', x.rels.reads.relationshipId, x.rels.reads.relationshipStateId, null]);
    assert.equal(await k.outcome(x.org, applies.stateId), 'PARTIALLY_SATISFIED');
    assert.deepEqual(await k.current(x.org, reads), [`${applies.pin.subject.controlDefinitionId}|${applies.stateId}|PARTIALLY_SATISFIED|${r.stateId}`]);
    // Nothing is rolled up / forward to the relationship id, another state or an endpoint object.
    assert.deepEqual(await k.current(x.org, ca.relTarget(x.rels.exposes)), []);
    assert.deepEqual(await k.current(x.org, ca.objectTarget('AGENT', x.objects.byKind.AGENT)), []);
    assert.deepEqual(await k.current(x.org, ca.objectTarget('DATA_ASSET', x.objects.byKind.DATA_ASSET)), []);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('exact applicability pin: unknown / foreign / DOES_NOT_APPLY / REVOKED tombstone / another family / null all fail closed', async () => {
    const x = await k.setup();
    const other = await k.setup();
    const target = ca.objectTarget('TOOL', x.objects.byKind.TOOL);
    const applies = await k.applicability(x, 'pin', target);
    const dna = await k.applicability(x, 'pin-dna', ca.objectTarget('PROMPT', x.objects.byKind.PROMPT), { applicability: 'DOES_NOT_APPLY' });
    const foreign = await k.applicability(other, 'pin-foreign', ca.objectTarget('TOOL', other.objects.byKind.TOOL));
    const toRevoke = await k.applicability(x, 'pin-rv', ca.objectTarget('MODEL', x.objects.byKind.MODEL));
    const tomb = await ca.revoke(x as never, 'pin-rv', toRevoke.target, toRevoke.pin, toRevoke.stateId);
    const before = await k.counts(x.org);
    const submitPin = (name: string, stateId: string) => c.svc(k.submitSql(x.member, { commandId: x.cmd(name), proposal: k.validateProposal(stateId) }));
    await rejects(submitPin('pin-unknown', randomUUID()), 'GV010', /CONTROL_APPLICABILITY_STATE_UNRESOLVED/);
    await rejects(submitPin('pin-foreign', foreign.stateId), 'GV010', /CONTROL_APPLICABILITY_STATE_UNRESOLVED/);
    await rejects(submitPin('pin-dna', dna.stateId), 'GV010', /CONTROL_APPLICABILITY_DOES_NOT_APPLY/);
    await rejects(submitPin('pin-tombstone', tomb.decided.fact_state_id), 'GV010', /CONTROL_APPLICABILITY_STATE_NOT_VALIDATED/);
    // A control definition state / another family's fact / a control definition id is never an applicability state.
    await rejects(submitPin('pin-cd-state', applies.pin.stateId), 'GV010', /CONTROL_APPLICABILITY_STATE_UNRESOLVED/);
    await rejects(submitPin('pin-cd-id', applies.pin.subject.controlDefinitionId), 'GV010', /CONTROL_APPLICABILITY_STATE_UNRESOLVED/);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('pin-null'), fingerprint: BOGUS_FINGERPRINT, proposal: k.validateProposal(applies.stateId),
      raw: { applicabilityStateId: null } })), 'GV010', /CONTROL_APPLICABILITY_STATE_REQUIRED/);
    assert.deepEqual(await k.counts(x.org), before, 'nothing was written');
    // Structural backstop: the composite FK onto the S1C.4 pin key refuses a DOES_NOT_APPLY / mismatched tuple even for the owner.
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
      insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values ('${x.org}','00000000-0000-4000-8000-0000000000a1','CONTROL_ASSESSMENT','VALIDATE','LOCAL_HUMAN','${x.member.id}','NONE',now());
      alter table gov_repo.l14_control_assessment_proposals disable trigger l14_control_assessment_proposals_guard;
      insert into gov_repo.l14_control_assessment_proposals(organisation_id,proposal_id,intent,control_applicability_state_id,applicability_target_key,
        control_definition_id,control_definition_version_id,content_hash,control_definition_validated_state_id,assessment_outcome,requested_valid_until)
        select organisation_id,'00000000-0000-4000-8000-0000000000a1','VALIDATE',fact_state_id,target_key,control_definition_id,
          control_definition_version_id,content_hash,control_definition_validated_state_id,'SATISFIED',now() + interval '1 day'
        from gov_repo.l14_control_applicability_states where fact_state_id='${dna.stateId}';
      rollback;`), /l14_control_assessment_proposals_applicability_fkey/);
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
      insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values ('${x.org}','00000000-0000-4000-8000-0000000000a2','CONTROL_ASSESSMENT','VALIDATE','LOCAL_HUMAN','${x.member.id}','NONE',now());
      alter table gov_repo.l14_control_assessment_proposals disable trigger l14_control_assessment_proposals_guard;
      insert into gov_repo.l14_control_assessment_proposals(organisation_id,proposal_id,intent,control_applicability_state_id,applicability_target_key,
        control_definition_id,control_definition_version_id,content_hash,control_definition_validated_state_id,assessment_outcome,requested_valid_until)
        select organisation_id,'00000000-0000-4000-8000-0000000000a2','VALIDATE',fact_state_id,target_key,control_definition_id,
          '${randomUUID()}',content_hash,control_definition_validated_state_id,'SATISFIED',now() + interval '1 day'
        from gov_repo.l14_control_applicability_states where fact_state_id='${applies.stateId}';
      rollback;`), /l14_control_assessment_proposals_applicability_fkey/);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('outcomes: exactly the five closed outcomes; WAIVED is refused explicitly; NOT_ASSESSED is positive; absence is UNKNOWN', async () => {
    const x = await k.setup();
    for (const [i, outcome] of ASSESSMENT_OUTCOMES.entries()) {
      const kind = ALL_KINDS[i];
      const applies = await k.applicability(x, `out-${outcome}`, ca.objectTarget(kind, x.objects.byKind[kind]));
      const r = await k.assess(x, `out-${outcome}`, applies.stateId, { outcome });
      assert.deepEqual([r.decided.outcome, r.decided.assessment_outcome, await k.outcome(x.org, applies.stateId)], ['VALIDATED', outcome, outcome]);
    }
    const applies = await k.applicability(x, 'out-neg', ca.objectTarget('SKILL', x.objects.byKind.SKILL));
    assert.equal(await k.outcome(x.org, applies.stateId), 'UNKNOWN', 'no assessment yet = UNKNOWN (never NOT_ASSESSED)');
    assert.deepEqual(await k.current(x.org, applies.target), [], 'an applicable control without assessment yields no row');
    const before = await k.counts(x.org);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('out-waived'), fingerprint: BOGUS_FINGERPRINT,
      proposal: k.validateProposal(applies.stateId), raw: { outcome: 'WAIVED' } })), 'GV010', /CONTROL_ASSESSMENT_WAIVED_UNSUPPORTED/);
    for (const outcome of ['waived', 'EXEMPT', 'EXCEPTION', 'COMPLIANT', 'PASS', 'FAIL', 'PARTIAL', 'UNKNOWN', 'NOT_APPLICABLE', 'SCORE_80', '', null]) {
      await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd(`out-${outcome}`), fingerprint: BOGUS_FINGERPRINT,
        proposal: k.validateProposal(applies.stateId), raw: { outcome } })), 'GV010', /CONTROL_ASSESSMENT_OUTCOME_UNKNOWN/);
    }
    assert.deepEqual(await k.counts(x.org), before, 'nothing was written');
    // The typed tables themselves refuse WAIVED (closed CHECK on proposal and state).
    for (const table of ['l14_control_assessment_proposals', 'l14_control_assessment_states']) {
      assert.equal(await one(`select count(*) from pg_constraint where conrelid='gov_repo.${table}'::regclass and contype='c'
        and pg_get_constraintdef(oid) like '%assessment_outcome%' and pg_get_constraintdef(oid) not like '%WAIVED%'
        and pg_get_constraintdef(oid) like '%INSUFFICIENT_EVIDENCE%'`), '1', table);
    }
  });

  // ---------------------------------------------------------------------------------------
  await t.test('valid_until: mandatory on VALIDATE, absent on REVOKE, strictly after effective_from, IS effective_to; expiry → UNKNOWN without UPDATE', async () => {
    const x = await k.setup();
    const pin = await ca.control(x as never, 'vu', await ca.instant('-1 day'));
    const applies = await k.applicability(x, 'vu', ca.objectTarget('API', x.objects.byKind.API), { pin, from: await ca.instant('-20 hours') });
    const before = await k.counts(x.org);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('vu-missing'), fingerprint: BOGUS_FINGERPRINT,
      proposal: k.validateProposal(applies.stateId, 'SATISFIED', null) })), 'GV010', /VALID_UNTIL_REQUIRED/);
    const start = await ca.instant('-10 hours');
    for (const [name, until] of [['eq', start], ['lt', await ca.instant('-11 hours')]] as const) {
      await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd(`vu-${name}`), fingerprint: BOGUS_FINGERPRINT,
        proposal: k.validateProposal(applies.stateId, 'SATISFIED', until, start) })), 'GV010', /EFFECTIVE_INTERVAL_INVALID/);
    }
    // IMMEDIATE start with a valid_until already in the past: refused at DECIDE, nothing consumed.
    const pastUntil = k.validateProposal(applies.stateId, 'SATISFIED', await ca.instant('-1 minute'));
    const ps = await k.submit(x, x.member, 'vu-past-submit', pastUntil);
    const beforeDecide = await k.counts(x.org);
    await rejects(c.svc(k.decideSql(x.as, { commandId: x.cmd('vu-past'), proposalId: ps.proposal_id, proposal: pastUntil })), 'GV010',
      /EFFECTIVE_INTERVAL_INVALID/);
    assert.deepEqual(await k.counts(x.org), beforeDecide, 'a refused interval consumes nothing');
    assert.equal(before.l14_fact_states, beforeDecide.l14_fact_states);
    // A bounded backdated assessment: [start, end) answers inside, UNKNOWN at / after end (half-open), with no row update.
    const end = await ca.instant('-2 hours');
    const bounded = await k.assess(x, 'vu-bounded', applies.stateId, { from: start, until: end, outcome: 'NOT_SATISFIED' });
    const rows = await k.stateRows(x.org, bounded.stateId);
    const f = await fact(bounded.stateId);
    assert.deepEqual([await ca.canonical(f.effective_from), await ca.canonical(f.effective_to), await ca.canonical(bounded.decided.valid_until)],
      [start, end, end]);
    assert.equal(await k.outcome(x.org, applies.stateId), 'UNKNOWN', 'expired = UNKNOWN; the head alone never overrides expiry');
    assert.equal(await k.head(x.org, applies.stateId), bounded.stateId);
    assert.equal(await k.outcome(x.org, applies.stateId, ts(await ca.instant('-5 hours'))), 'NOT_SATISFIED');
    assert.equal(await k.resolve(x.org, applies.stateId, ts(end)), null, 'half-open at valid_until');
    assert.equal(await k.resolve(x.org, applies.stateId, `${ts(end)} - interval '1 microsecond'`), bounded.stateId);
    assert.equal(await k.stateRows(x.org, bounded.stateId), rows, 'expiry wrote nothing');
    // REVOKE never carries a valid_until of its own (and cannot revoke an already-expired assessment).
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('vu-revoke-until'), fingerprint: BOGUS_FINGERPRINT,
      proposal: { ...k.revokeProposal(applies.stateId, bounded.stateId, 'NOT_SATISFIED'), requestedValidUntil: inDays(1) } })),
    'GV010', /VALID_UNTIL_NOT_PERMITTED/);
    const late = k.revokeProposal(applies.stateId, bounded.stateId, 'NOT_SATISFIED');
    const ls = await k.submit(x, x.member, 'vu-late-submit', late);
    await rejects(c.svc(k.decideSql(x.as, { commandId: x.cmd('vu-late'), proposalId: ls.proposal_id, proposal: late, outcome: 'REVOKE',
      expected: bounded.stateId })), 'GV011', /REVOKE_AFTER_TARGET_EXPIRY/);
    // Renewal after expiry (gap = UNKNOWN) is a governed successor.
    const renewed = await k.assess(x, 'vu-renew', applies.stateId, { outcome: 'SATISFIED' });
    assert.deepEqual([renewed.decided.predecessor_state_id, await k.outcome(x.org, applies.stateId)], [bounded.stateId, 'SATISFIED']);
    assert.equal(await k.outcome(x.org, applies.stateId, `${ts(end)} + interval '1 minute'`), 'UNKNOWN', 'the gap stays UNKNOWN');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('source boundary: SYSTEM_SEED / SOURCE_CONNECTION / scanner / LLM never masquerade as LOCAL_HUMAN; structural guard backs the RPC', async () => {
    const applies = await k.applicability(ctx, 'src', ca.objectTarget('AGENT', ctx.objects.agent2));
    for (const sourceClass of ['SYSTEM_SEED', 'SOURCE_CONNECTION'] as const) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`src-${sourceClass}`), fingerprint: BOGUS_FINGERPRINT,
        proposal: { ...k.validateProposal(applies.stateId), sourceClass } })), 'GV010', /SOURCE_CLASS_NOT_EXECUTABLE/);
    }
    for (const sourceClass of ['SCANNER', 'LLM', 'CG_AG']) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`src-${sourceClass}`), fingerprint: BOGUS_FINGERPRINT,
        proposal: k.validateProposal(applies.stateId), raw: { sourceClass } })), 'GV010', /PROPOSAL_VOCABULARY_UNKNOWN/);
    }
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
      insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values ('${ctx.org}','00000000-0000-4000-8000-0000000000b1','CONTROL_ASSESSMENT','VALIDATE','SOURCE_CONNECTION','${ctx.member.id}','NONE',now());
      insert into gov_repo.l14_control_assessment_proposals(organisation_id,proposal_id,intent,control_applicability_state_id,applicability_target_key,
        control_definition_id,control_definition_version_id,content_hash,control_definition_validated_state_id,assessment_outcome,requested_valid_until)
        select organisation_id,'00000000-0000-4000-8000-0000000000b1','VALIDATE',fact_state_id,target_key,control_definition_id,
          control_definition_version_id,content_hash,control_definition_validated_state_id,'SATISFIED',now() + interval '1 day'
        from gov_repo.l14_control_applicability_states where fact_state_id='${applies.stateId}';
      rollback;`), /CONTROL_ASSESSMENT_PROPOSAL_SOURCE_INVALID/);
    // The generic S1A proposal RPC never executes CONTROL_ASSESSMENT (no unbounded intake path).
    assert.equal(await one(`select count(*) from gov_repo.l14_proposals where subject_kind='CONTROL_ASSESSMENT' and organisation_id='${ctx.org}'
      and proposal_id not in (select proposal_id from gov_repo.l14_control_assessment_proposals)`), '0');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('authority: L14_CONTROL_ASSESSMENT_VALIDATE over the pinned applicability target scope (object AND relationship-state); durable DENY', async () => {
    const x = await k.setup();
    const agent = await k.applicability(x, 'auth-agent', ca.objectTarget('AGENT', x.objects.byKind.AGENT));
    const asset = await k.applicability(x, 'auth-asset', ca.objectTarget('DATA_ASSET', x.objects.byKind.DATA_ASSET));
    const asset2 = await k.applicability(x, 'auth-asset2', ca.objectTarget('DATA_ASSET', x.objects.asset2));
    const exposes = await k.applicability(x, 'auth-exposes', ca.relTarget(x.rels.exposes));
    const reads = await k.applicability(x, 'auth-reads', ca.relTarget(x.rels.reads));
    const mcp = await k.applicability(x, 'auth-mcp', ca.objectTarget('MCP_SERVER', x.objects.byKind.MCP_SERVER));
    let n = 0;
    const deny = async (name: string, actor: typeof x.as, applicabilityStateId: string, reason: string, options: { from?: string | null; self?: boolean } = {}) => {
      const proposal = k.validateProposal(applicabilityStateId, 'SATISFIED', inDays(10), options.from ?? null);
      const submitted = await k.submit(x, options.self ? actor : x.member, `${name}-${++n}-submit`, proposal);
      const r = await exec(k.decideSql(actor, { commandId: x.cmd(`${name}-decide`), proposalId: submitted.proposal_id, proposal }));
      assert.deepEqual([r.outcome, r.authorization_result, r.deny_reason, r.governance_decision_id, r.fact_state_id], ['DENIED', 'DENY', reason, null, null], name);
      const again = await exec(k.decideSql(actor, { commandId: x.cmd(`${name}-decide`), proposalId: submitted.proposal_id, proposal }));
      assert.deepEqual([again.replay, again.outcome, again.authorization_decision_id, again.recorded_at], [true, 'DENIED', r.authorization_decision_id, r.recorded_at]);
      assert.equal(await k.head(x.org, applicabilityStateId), null, 'a DENY creates no head');
    };
    await deny('member', x.member2, agent.stateId, 'NO_MATCHING_AUTHORITY_RULE');
    // Applicability / control definition / AP administration never implies assessment authority.
    await deny('applicability-steward', x.cs, agent.stateId, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('applicability-only-role', x.asapplicability, agent.stateId, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('cd-steward', x.steward, agent.stateId, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('ap-admin', x.boot, agent.stateId, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('contributor', x.ascontrib, agent.stateId, 'SOURCE_NOT_AUTHORIZED');
    await deny('kind-scope-mismatch', x.askind, asset.stateId, 'SCOPE_NOT_AUTHORIZED');
    await deny('object-scope-mismatch', x.asobject, asset2.stateId, 'SCOPE_NOT_AUTHORIZED');
    await deny('canonical-kind-on-relationship', x.askind, reads.stateId, 'SCOPE_NOT_AUTHORIZED');
    await deny('relationship-type-on-object', x.asreltype, mcp.stateId, 'SCOPE_NOT_AUTHORIZED');
    await deny('relationship-state-on-object', x.asrelstate, asset.stateId, 'SCOPE_NOT_AUTHORIZED');
    await deny('relationship-type-mismatch', x.asreltype, reads.stateId, 'SCOPE_NOT_AUTHORIZED');
    await deny('relationship-state-mismatch', x.asrelstate, exposes.stateId, 'SCOPE_NOT_AUTHORIZED');
    await deny('self-validation', x.as, agent.stateId, 'SELF_VALIDATION_NOT_PERMITTED', { self: true });
    await deny('backdated', x.as, agent.stateId, 'TEMPORAL_ACTION_NOT_AUTHORIZED', { from: await ca.instant('-1 minute') });
    await deny('future-dated', x.as, agent.stateId, 'TEMPORAL_ACTION_NOT_AUTHORIZED', { from: await ca.instant('+1 hour') });
    const rulesOf = (id: string) => one(`select string_agg(scope_tag||'/'||coalesce(scope_canonical_kind,scope_relationship_type,scope_relationship_state_id,'-'), ',')
      from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${id}'`);
    const byKind = await k.assess(x, 'kind-ok', agent.stateId, { validator: x.askind });
    assert.equal(await rulesOf(byKind.decided.authorization_decision_id), 'CANONICAL_KIND/AGENT');
    assert.equal((await k.assess(x, 'object-ok', asset.stateId, { validator: x.asobject })).decided.outcome, 'VALIDATED');
    const byType = await k.assess(x, 'type-ok', exposes.stateId, { validator: x.asreltype });
    assert.equal(await rulesOf(byType.decided.authorization_decision_id), 'RELATIONSHIP_TYPE/EXPOSES');
    const byState = await k.assess(x, 'state-ok', reads.stateId, { validator: x.asrelstate });
    assert.equal(await rulesOf(byState.decided.authorization_decision_id), `RELATIONSHIP_STATE/${x.rels.reads.relationshipStateId}`);
    // Self-validation only where the effective Authority Policy explicitly allows it.
    const sp = k.validateProposal(mcp.stateId);
    const ss = await k.submit(x, x.asflex, 'self-flex-submit', sp);
    const self = await k.decide(x, x.asflex, 'self-flex', ss, sp);
    assert.deepEqual([self.outcome, (await authz(self.authorization_decision_id)).is_self_validation], ['VALIDATED', true]);
    // Authority changes: a NEW command after losing the role is denied; the old DENY command id never becomes ALLOW.
    const lostA = await k.applicability(x, 'auth-lost', ca.objectTarget('AGENT', x.objects.agent2));
    const lp = k.validateProposal(lostA.stateId);
    const ls = await k.submit(x, x.member, 'lost-submit', lp);
    await owner(`update gov_repo.governance_users set role_ids='{}'::uuid[] where user_id='${x.as2.id}'`);
    const lr = await exec(k.decideSql(x.as2, { commandId: x.cmd('lost-decide'), proposalId: ls.proposal_id, proposal: lp }));
    assert.deepEqual([lr.outcome, lr.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    await owner(`update gov_repo.governance_users set role_ids=array['${k.assessorRole}']::uuid[] where user_id='${x.as2.id}'`);
    assert.equal((await exec(k.decideSql(x.as2, { commandId: x.cmd('lost-decide'), proposalId: ls.proposal_id, proposal: lp }))).replay, true);
    assert.equal((await exec(k.decideSql(x.as2, { commandId: x.cmd('lost-decide-2'), proposalId: ls.proposal_id, proposal: lp }))).outcome, 'VALIDATED');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('requested action = exact outcome; closed reason codes; terminality; DEFER non-terminal; correction = new linked proposal; REVOKE pins', async () => {
    const x = await k.setup();
    const applies = await k.applicability(x, 'term', ca.objectTarget('KNOWLEDGE_BASE', x.objects.byKind.KNOWLEDGE_BASE));
    const proposal = k.validateProposal(applies.stateId);
    const submitted = await k.submit(x, x.member, 'term-submit', proposal);
    const sql = (name: string, outcome: 'VALIDATE' | 'REJECT' | 'DEFER' | 'REVOKE', reasonCode?: string) =>
      k.decideSql(x.as, { commandId: x.cmd(name), proposalId: submitted.proposal_id, proposal, outcome, reasonCode,
        fingerprint: reasonCode ? BOGUS_FINGERPRINT : undefined });
    for (const [i, reason] of ['CONTROL_ASSESSMENT_REJECTED', 'Looks satisfied', 'CONTROL_APPLICABILITY_VALIDATED', 'CONTROL_ASSESSMENT_WAIVED',
      'CONTROL_FINDING_VALIDATED'].entries()) {
      await rejects(c.svc(sql(`term-reason-${i}`, 'VALIDATE', reason)), 'GV010', /DECISION_VOCABULARY_INVALID/);
    }
    await rejects(c.svc(sql('term-revoke-on-validate', 'REVOKE')), 'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    assert.deepEqual([(await exec(sql('term-defer', 'DEFER'))).outcome, (await exec(sql('term-defer-2', 'DEFER'))).outcome], ['DEFERRED', 'DEFERRED']);
    const validated = await exec(sql('term-validate', 'VALIDATE'));
    assert.equal(validated.outcome, 'VALIDATED');
    await rejects(c.svc(k.decideSql(x.as, { commandId: x.cmd('term-after'), proposalId: submitted.proposal_id, proposal, outcome: 'REJECT',
      expected: validated.fact_state_id })), 'GV010', /PROPOSAL_TERMINAL/);
    // REJECT is terminal; correction = NEW proposal linked to the prior one (same key).
    const other = await k.applicability(x, 'term-other', ca.objectTarget('SKILL', x.objects.byKind.SKILL));
    const p2 = k.validateProposal(other.stateId, 'INSUFFICIENT_EVIDENCE');
    const s2 = await k.submit(x, x.member, 'rej-submit', p2);
    const rejected = await exec(k.decideSql(x.as, { commandId: x.cmd('rej'), proposalId: s2.proposal_id, proposal: p2, outcome: 'REJECT' }));
    assert.deepEqual([rejected.outcome, rejected.fact_state_id, await k.head(x.org, other.stateId)], ['REJECTED', null, null]);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rej-bad-prior'), proposal: p2, prior: submitted.proposal_id })), 'GV010',
      /PRIOR_PROPOSAL_UNRESOLVED/);
    const corrected = await k.submit(x, x.member, 'rej-correction', p2, s2.proposal_id);
    assert.equal(await one(`select prior_proposal_id from gov_repo.l14_proposals where proposal_id='${corrected.proposal_id}'`), s2.proposal_id);
    assert.equal((await k.decide(x, x.as, 'rej-correction-validate', corrected, p2)).outcome, 'VALIDATED');
    // REVOKE pins the exact current VALIDATED assessment of the same key + outcome.
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-outcome'),
      proposal: k.revokeProposal(applies.stateId, validated.fact_state_id, 'NOT_SATISFIED') })), 'GV010', /CONTROL_ASSESSMENT_TARGET_STATE_MISMATCH/);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-other-key'),
      proposal: k.revokeProposal(other.stateId, validated.fact_state_id) })), 'GV010', /TARGET_STATE_UNRESOLVED/);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-unknown'),
      proposal: k.revokeProposal(applies.stateId, randomUUID()) })), 'GV010', /TARGET_STATE_UNRESOLVED/);
    const rp = k.revokeProposal(applies.stateId, validated.fact_state_id);
    const rs = await k.submit(x, x.member, 'rv-submit', rp);
    await rejects(c.svc(k.decideSql(x.as, { commandId: x.cmd('rv-validate'), proposalId: rs.proposal_id, proposal: rp, outcome: 'VALIDATE',
      expected: validated.fact_state_id })), 'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    const revoked = await exec(k.decideSql(x.as, { commandId: x.cmd('rv-revoke'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE',
      expected: validated.fact_state_id }));
    const f = await fact(revoked.fact_state_id);
    assert.deepEqual([revoked.outcome, f.revokes_state_id, f.predecessor_state_id, f.effective_to, revoked.valid_until],
      ['REVOKED', validated.fact_state_id, validated.fact_state_id, null, null]);
    assert.equal(await one(`select reason_code from gov_repo.l14_governance_decisions where governance_decision_id='${revoked.governance_decision_id}'`),
      'CONTROL_ASSESSMENT_REVOKED');
    assert.equal(await k.outcome(x.org, applies.stateId), 'UNKNOWN', 'a revoked assessment is UNKNOWN (never NOT_ASSESSED)');
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-again'), proposal: rp })), 'GV010', /TARGET_STATE_NOT_VALIDATED|TARGET_ALREADY_REVOKED/);
    // Revalidation after a revocation is a governed successor of the tombstone.
    const reval = await k.assess(x, 'rv-reval', applies.stateId, { outcome: 'NOT_ASSESSED' });
    assert.deepEqual([reval.decided.predecessor_state_id, await k.outcome(x.org, applies.stateId)], [revoked.fact_state_id, 'NOT_ASSESSED']);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('replay: exact retry returns the ORIGINAL durable result; changed payload GV007; wrong fingerprint GV008; stale GV009; no-op GV010', async () => {
    const x = await k.setup();
    const applies = await k.applicability(x, 'rp', ca.relTarget(x.rels.reads));
    const until = inDays(60);
    const proposal = k.validateProposal(applies.stateId, 'SATISFIED', until);
    const subSql = k.submitSql(x.member, { commandId: x.cmd('rp-submit'), proposal });
    const submitted = await exec(subSql);
    const subAgain = await exec(subSql);
    assert.deepEqual([subAgain.replay, subAgain.proposal_id, subAgain.recorded_at], [true, submitted.proposal_id, submitted.recorded_at]);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rp-submit'), proposal: { ...proposal, assessmentOutcome: 'NOT_SATISFIED' } })),
      'GV007', /COMMAND_ID_REUSED_WITH_DIFFERENT_SEMANTICS/);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rp-submit'), proposal: { ...proposal, requestedValidUntil: inDays(61) } })),
      'GV007', /COMMAND_ID_REUSED_WITH_DIFFERENT_SEMANTICS/);
    const decSql = k.decideSql(x.as, { commandId: x.cmd('rp-decide'), proposalId: submitted.proposal_id, proposal });
    const decided = await exec(decSql);
    const before = await k.counts(x.org);
    const again = await exec(decSql);
    for (const field of ['outcome', 'authorization_decision_id', 'governance_decision_id', 'fact_state_id', 'effective_from', 'valid_until', 'recorded_at',
      'command_fingerprint', 'control_applicability_state_id', 'control_definition_id', 'control_definition_version_id', 'content_hash', 'assessment_outcome']) {
      assert.equal(again[field], decided[field], field);
    }
    assert.equal(again.replay, true);
    assert.deepEqual(await k.counts(x.org), before, 'a replay writes nothing');
    await rejects(c.svc(k.decideSql(x.as, { commandId: x.cmd('rp-decide'), proposalId: submitted.proposal_id, proposal, outcome: 'DEFER' })),
      'GV007', /COMMAND_ID_REUSED_WITH_DIFFERENT_SEMANTICS/);
    const wrong = decideControlAssessmentProposalFingerprint({ organisationId: x.org, actorUserId: x.as.id, outcome: 'VALIDATE',
      proposalId: submitted.proposal_id, proposal: { ...proposal, assessmentOutcome: 'NOT_SATISFIED' }, expectedCurrentStateId: null,
      support: { status: 'NONE', evidenceIds: [] } });
    await rejects(c.svc(k.decideSql(x.as, { commandId: x.cmd('rp-wrong-fp'), proposalId: submitted.proposal_id, proposal, fingerprint: wrong })),
      'GV008', /CALLER_FINGERPRINT_DIFFERS/);
    const p2 = k.validateProposal(applies.stateId, 'NOT_SATISFIED', until);
    const s2 = await k.submit(x, x.member, 'rp-succ-submit', p2);
    const dup = k.validateProposal(applies.stateId, 'SATISFIED', until);
    const ds = await k.submit(x, x.member, 'rp-dup-submit', dup);
    const beforeRefused = await k.counts(x.org);
    await rejects(c.svc(k.decideSql(x.as, { commandId: x.cmd('rp-stale-none'), proposalId: s2.proposal_id, proposal: p2, expected: null })),
      'GV009', /CONTROL_ASSESSMENT_STATE_EXISTS/);
    await rejects(c.svc(k.decideSql(x.as, { commandId: x.cmd('rp-stale-wrong'), proposalId: s2.proposal_id, proposal: p2, expected: randomUUID() })),
      'GV009', /STATE_EXPECTATION_MISMATCH/);
    await rejects(c.svc(k.decideSql(x.as, { commandId: x.cmd('rp-dup'), proposalId: ds.proposal_id, proposal: dup, expected: decided.fact_state_id })),
      'GV010', /CONTROL_ASSESSMENT_ALREADY_VALIDATED/);
    assert.deepEqual(await k.counts(x.org), beforeRefused, 'none of the refused commands consumed anything');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('renewal / correction: same-key successors; predecessor byte-identical; closure derived; earlier cutoffs keep the predecessor', async () => {
    const x = await k.setup();
    const applies = await k.applicability(x, 'ren', ca.objectTarget('DATA_ELEMENT', x.objects.byKind.DATA_ELEMENT));
    const s1 = await k.assess(x, 'ren-1', applies.stateId, { outcome: 'PARTIALLY_SATISFIED', until: inDays(30) });
    const s1Rows = await k.stateRows(x.org, s1.stateId);
    const tBetween = await one('select clock_timestamp()::text');
    // Correction BEFORE the predecessor's valid_until (another outcome): a successor; closure derived, never written.
    const s2 = await k.assess(x, 'ren-2', applies.stateId, { outcome: 'SATISFIED', until: inDays(30) });
    assert.deepEqual([s2.decided.outcome, s2.decided.expectation_kind, s2.decided.expected_current_state_id, s2.decided.predecessor_state_id],
      ['VALIDATED', 'EXPECTED_CURRENT', s1.stateId, s1.stateId]);
    assert.equal(await k.head(x.org, applies.stateId), s2.stateId);
    assert.equal(await one(`select count(*) from gov_repo.l14_control_assessment_heads where organisation_id='${x.org}'`), '1');
    assert.equal(await k.stateRows(x.org, s1.stateId), s1Rows, 'predecessor byte-identical (incl. xmin / ctid)');
    assert.equal(await k.outcome(x.org, applies.stateId), 'SATISFIED');
    assert.equal(await k.outcome(x.org, applies.stateId, ts(tBetween), ts(tBetween)), 'PARTIALLY_SATISFIED', 'earlier cutoff sees the predecessor');
    assert.equal(await k.outcome(x.org, applies.stateId, now, ts(tBetween)), 'PARTIALLY_SATISFIED', 'a later successor never leaks into an earlier cutoff');
    // Renewal with the same outcome and a later valid_until.
    const s3 = await k.assess(x, 'ren-3', applies.stateId, { outcome: 'SATISFIED', until: inDays(120) });
    assert.deepEqual([s3.decided.predecessor_state_id, await ca.canonical(s3.decided.valid_until)], [s2.stateId, s3.proposal.requestedValidUntil]);
    // A successor may not start before its predecessor started.
    const early = k.validateProposal(applies.stateId, 'NOT_SATISFIED', inDays(5), await ca.instant('-1 hour'));
    const es = await k.submit(x, x.member, 'ren-early-submit', early);
    await rejects(c.svc(k.decideSql(x.asflex, { commandId: x.cmd('ren-early'), proposalId: es.proposal_id, proposal: early, expected: s3.stateId })),
      'GV011', /SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE/);
    // A future renewal does not prematurely hide the current assessment.
    const T = await ca.instant('+2 hours');
    const s4 = await k.assess(x, 'ren-4', applies.stateId, { outcome: 'NOT_SATISFIED', from: T, until: inDays(200) });
    assert.equal(await k.resolve(x.org, applies.stateId), s3.stateId, 'still the current one before T');
    assert.equal(await k.resolve(x.org, applies.stateId, ts(T)), s4.stateId);
    assert.equal(await one(`select count(*) from gov_repo.l14_control_assessment_states where organisation_id='${x.org}'
      and control_applicability_state_id='${applies.stateId}'`), '4');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('no carry-over: a superseded / revoked / DOES_NOT_APPLY / dependency-invalid applicability makes its assessment historical', async () => {
    const x = await k.setup();
    // 1. Supersession by another version of the same control on the same target (APPLIES → APPLIES).
    const target = ca.objectTarget('AGENT_VERSION', x.objects.byKind.AGENT_VERSION);
    const s1 = await k.applicability(x, 'nc', target);
    const a1 = await k.assess(x, 'nc-1', s1.stateId, { outcome: 'SATISFIED' });
    const a1Rows = await k.stateRows(x.org, a1.stateId);
    const digest = await k.factDigest(x.org);
    const tBefore = await one('select clock_timestamp()::text');
    const v2 = await ca.nextVersion(x as never, 'nc-v2', s1.pin);
    const s2 = (await ca.apply(x as never, 'nc-s2', target, v2)).stateId;
    assert.equal(await k.outcome(x.org, s1.stateId), 'UNKNOWN', 'the assessment of S1 is historical once S1 is superseded');
    assert.equal(await k.outcome(x.org, s2), 'UNKNOWN', 'S2 starts WITHOUT a current assessment (never transferred)');
    assert.deepEqual(await k.current(x.org, target), [], 'the current applicability has no current assessment');
    assert.equal(await k.outcome(x.org, s1.stateId, ts(tBefore), ts(tBefore)), 'SATISFIED', 'history answers its own coordinates');
    assert.equal(await k.stateRows(x.org, a1.stateId), a1Rows);
    assert.equal(await k.factDigest(x.org), digest, 'no assessment row was written or changed by the applicability successor');
    assert.equal(await k.head(x.org, s2), null);
    // A new assessment of the superseded S1 is refused (no successor selected automatically); the current S2 is a fresh key.
    const stale = k.validateProposal(s1.stateId, 'NOT_SATISFIED');
    const ss = await k.submit(x, x.member, 'nc-stale-submit', stale);
    const before = await k.counts(x.org);
    await rejects(c.svc(k.decideSql(x.as, { commandId: x.cmd('nc-stale'), proposalId: ss.proposal_id, proposal: stale, expected: a1.stateId })),
      'GV010', /CONTROL_APPLICABILITY_DEPENDENCY_NOT_VALID/);
    assert.deepEqual(await k.counts(x.org), before, 'nothing consumed');
    const a2 = await k.assess(x, 'nc-2', s2, { outcome: 'NOT_SATISFIED' });
    assert.deepEqual([a2.decided.predecessor_state_id, a2.decided.expectation_kind], [null, 'EXPECTED_NONE']);
    assert.deepEqual(await k.current(x.org, target), [`${s1.pin.subject.controlDefinitionId}|${s2}|NOT_SATISFIED|${a2.stateId}`]);
    // 2. APPLIES → DOES_NOT_APPLY successor: the assessment is historical, and DOES_NOT_APPLY never yields an assessment row.
    const t2 = ca.objectTarget('DATA_ASSET', x.objects.asset2);
    const d1 = await k.applicability(x, 'nc-dna', t2);
    await k.assess(x, 'nc-dna', d1.stateId);
    await ca.apply(x as never, 'nc-dna-succ', t2, d1.pin, { applicability: 'DOES_NOT_APPLY' });
    assert.equal(await k.outcome(x.org, d1.stateId), 'UNKNOWN');
    assert.deepEqual(await k.current(x.org, t2), [], 'DOES_NOT_APPLY is never positive satisfaction');
    // 3. Applicability REVOKED: historical; the assessment can still be ended explicitly (cleanup never blocked).
    const t3 = ca.objectTarget('PROMPT', x.objects.byKind.PROMPT);
    const r1 = await k.applicability(x, 'nc-rv', t3);
    const ra = await k.assess(x, 'nc-rv', r1.stateId, { outcome: 'INSUFFICIENT_EVIDENCE' });
    await ca.revoke(x as never, 'nc-rv', t3, r1.pin, r1.stateId);
    assert.equal(await k.outcome(x.org, r1.stateId), 'UNKNOWN');
    const cleanup = await k.revoke(x, 'nc-rv-cleanup', r1.stateId, ra.stateId, 'INSUFFICIENT_EVIDENCE');
    assert.deepEqual([cleanup.decided.outcome, cleanup.decided.predecessor_state_id], ['REVOKED', ra.stateId]);
    // 4. O49 chain: the CONTROL_DEFINITION pinned by the applicability is revoked → applicability AND assessment UNKNOWN;
    //    re-validation of the control (CS2) never revives the old assessment; restoration needs new applicability + assessment.
    const t4 = ca.objectTarget('TOOL', x.objects.byKind.TOOL);
    const o1 = await k.applicability(x, 'nc-o49', t4);
    const oa = await k.assess(x, 'nc-o49', o1.stateId);
    const oaRows = await k.stateRows(x.org, oa.stateId);
    await ca.revokeControlDefinition(x as never, 'nc-o49', o1.pin);
    assert.deepEqual([await ca.outcome(x.org, t4, o1.pin.subject.controlDefinitionId), await k.outcome(x.org, o1.stateId)], ['UNKNOWN', 'UNKNOWN']);
    const cs2 = await ca.revalidateControlDefinition(x as never, 'nc-o49', o1.pin);
    assert.equal(await k.outcome(x.org, o1.stateId), 'UNKNOWN', 'no silent repin of the applicability, hence no revived assessment');
    assert.equal(await k.stateRows(x.org, oa.stateId), oaRows);
    const o2 = (await ca.apply(x as never, 'nc-o49-restore', t4, cs2)).stateId;
    assert.equal(await k.outcome(x.org, o2), 'UNKNOWN', 'the restored applicability starts without an assessment');
    // REJECT / DEFER of an assessment proposal whose applicability became invalid also stay possible.
    const dp = k.validateProposal(o1.stateId);
    const dps = await k.submit(x, x.member, 'nc-dispose-submit', dp);
    assert.equal((await exec(k.decideSql(x.as, { commandId: x.cmd('nc-defer'), proposalId: dps.proposal_id, proposal: dp, outcome: 'DEFER',
      expected: oa.stateId }))).outcome, 'DEFERRED');
    assert.equal((await exec(k.decideSql(x.as, { commandId: x.cmd('nc-reject'), proposalId: dps.proposal_id, proposal: dp, outcome: 'REJECT',
      expected: oa.stateId }))).outcome, 'REJECTED');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('applicability validity at effective_from: before its start, after its explicit end, or future-only applicability refuse', async () => {
    const x = await k.setup();
    const pin = await ca.control(x as never, 'av', await ca.instant('-2 days'));
    const startA = await ca.instant('-10 hours');
    const endA = await ca.instant('-1 hour');
    const bounded = await k.applicability(x, 'av-bounded', ca.objectTarget('API', x.objects.byKind.API), { pin, from: startA, to: endA });
    const refused = async (name: string, from: string | null, stateId: string) => {
      const p = k.validateProposal(stateId, 'SATISFIED', inDays(3), from);
      const s = await k.submit(x, x.member, `${name}-submit`, p);
      const before = await k.counts(x.org);
      await rejects(c.svc(k.decideSql(x.asflex, { commandId: x.cmd(name), proposalId: s.proposal_id, proposal: p,
        expected: await k.head(x.org, stateId) })), 'GV010', /CONTROL_APPLICABILITY_DEPENDENCY_NOT_VALID/);
      assert.deepEqual(await k.counts(x.org), before, `${name}: nothing consumed`);
    };
    await refused('av-before-start', await ca.instant('-11 hours'), bounded.stateId);
    await refused('av-after-end', null, bounded.stateId);
    // Inside the applicability interval a backdated assessment validates (its own valid_until may outlive the applicability:
    // reads still require the applicability to be valid at the read instant).
    const inside = await k.assess(x, 'av-inside', bounded.stateId, { from: await ca.instant('-5 hours'), outcome: 'SATISFIED' });
    assert.equal(inside.decided.outcome, 'VALIDATED');
    assert.equal(await k.outcome(x.org, bounded.stateId, ts(await ca.instant('-4 hours'))), 'SATISFIED');
    assert.equal(await k.outcome(x.org, bounded.stateId), 'UNKNOWN', 'the applicability expired: the assessment is no longer current');
    const future = await k.applicability(x, 'av-future', ca.objectTarget('MODEL', x.objects.byKind.MODEL), { pin, from: await ca.instant('+3 hours') });
    await refused('av-future-now', null, future.stateId);
    const fa = await k.assess(x, 'av-future-ok', future.stateId, { from: await ca.instant('+4 hours') });
    assert.equal(fa.decided.outcome, 'VALIDATED');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('temporal: omitted start = DB instant; past / future need explicit permission; REVOKE has no end of its own', async () => {
    const x = await k.setup();
    const pin = await ca.control(x as never, 'tm', await ca.instant('-1 day'));
    const before = await one('select clock_timestamp()::text');
    const imm = await k.applicability(x, 'tm-imm', ca.objectTarget('AGENT', x.objects.byKind.AGENT), { pin, from: await ca.instant('-20 hours') });
    const r = await k.assess(x, 'tm-imm', imm.stateId);
    const f = await fact(r.stateId);
    assert.equal(f.effective_from, f.recorded_at, 'IMMEDIATE = the DB transaction instant');
    assert.ok(Date.parse(f.effective_from) >= Date.parse(before));
    for (const [name, offset, kind] of [['past', '-90 minutes', 'API'], ['future', '+1 hour', 'PROMPT']] as const) {
      const a = await k.applicability(x, `tm-${name}`, ca.objectTarget(kind, x.objects.byKind[kind]), { pin, from: await ca.instant('-20 hours') });
      const p = k.validateProposal(a.stateId, 'SATISFIED', inDays(2), await ca.instant(offset));
      const s = await k.submit(x, x.member, `tm-${name}-submit`, p);
      const denied = await exec(k.decideSql(x.as, { commandId: x.cmd(`tm-${name}-deny`), proposalId: s.proposal_id, proposal: p }));
      assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED'], name);
      const passed = await exec(k.decideSql(x.asflex, { commandId: x.cmd(`tm-${name}-pass`), proposalId: s.proposal_id, proposal: p }));
      assert.deepEqual([passed.outcome, await ca.canonical(passed.effective_from)], ['VALIDATED', p.requestedEffectiveFrom], name);
    }
    const ra = await k.applicability(x, 'tm-rv', ca.objectTarget('SKILL', x.objects.byKind.SKILL), { pin, from: await ca.instant('-20 hours') });
    const bounded = await k.assess(x, 'tm-rv', ra.stateId, { from: await ca.instant('-2 hours'), until: inDays(1) });
    const tooEarly = k.revokeProposal(ra.stateId, bounded.stateId, 'SATISFIED', await ca.instant('-3 hours'));
    const tes = await k.submit(x, x.member, 'tm-rv-early-submit', tooEarly);
    await rejects(c.svc(k.decideSql(x.asflex, { commandId: x.cmd('tm-rv-early'), proposalId: tes.proposal_id, proposal: tooEarly, outcome: 'REVOKE',
      expected: bounded.stateId })), 'GV011', /REVOKE_BEFORE_TARGET_EFFECTIVE/);
    const rv = await k.revoke(x, 'tm-rv', ra.stateId, bounded.stateId);
    assert.deepEqual([(await fact(rv.decided.fact_state_id)).effective_to, rv.decided.valid_until], [null, null]);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('atomicity: an induced failure after the decision (at the typed state INSERT / the head CAS) rolls the whole command back', async () => {
    for (const [name, table, timing] of [['fact', 'l14_control_assessment_states', 'before insert'],
      ['head', 'l14_control_assessment_heads', 'before update']] as const) {
      const x = await k.setup();
      const applies = await k.applicability(x, `atom-${name}`, name === 'fact' ? ca.objectTarget('AGENT', x.objects.byKind.AGENT) : ca.relTarget(x.rels.reads));
      await c.evidence(x.org, `atom-as-${name}-ev`);
      const proposal = k.validateProposal(applies.stateId);
      const submitted = await k.submit(x, x.member, `atom-${name}-submit`, proposal);
      const commandId = x.cmd(`atom-${name}`);
      const sql = k.decideSql(x.as, { commandId, proposalId: submitted.proposal_id, proposal,
        support: { status: 'PRESENT', evidenceIds: [`atom-as-${name}-ev`] } });
      const before = await k.counts(x.org);
      const history = await k.historyDigest(x.org);
      await c.bootstrapSql(`create function public.s1c5_induced_failure() returns trigger language plpgsql
          set search_path = pg_catalog, pg_temp as $f$
          begin
            if not exists (select 1 from gov_repo.l14_governance_decisions d where d.organisation_id = new.organisation_id
                             and d.proposal_id = '${submitted.proposal_id}' and d.outcome = 'VALIDATE') then
              raise exception 'S1C5_INDUCED_FAILURE_WITHOUT_DECISION';
            end if;
            raise exception 'S1C5_INDUCED_FAILURE' using errcode = 'P0001';
          end $f$;
        create trigger zz_s1c5_induced_failure ${timing} on gov_repo.${table} for each row execute function public.s1c5_induced_failure();
        alter table gov_repo.${table} enable always trigger zz_s1c5_induced_failure;`);
      try {
        await assert.rejects(c.svc(sql), (error: Error) => {
          assert.match(error.message, /S1C5_INDUCED_FAILURE/);
          assert.doesNotMatch(error.message, /WITHOUT_DECISION/, 'the failure fired after the decision was written in the same transaction');
          return true;
        });
      } finally {
        await c.bootstrapSql(`drop trigger if exists zz_s1c5_induced_failure on gov_repo.${table}; drop function if exists public.s1c5_induced_failure();`);
      }
      assert.equal(await one(`select count(*) from gov_repo.l14_governance_decisions where proposal_id='${submitted.proposal_id}'`), '0', 'no decision');
      assert.equal(await one(`select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${x.org}' and command_id='${commandId}'`), '0');
      assert.equal(await one(`select count(*) from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${commandId}'`), '0');
      assert.equal(await one(`select count(*) from gov_repo.l14_support_links where evidence_id='atom-as-${name}-ev'`), '0', 'no support link');
      assert.deepEqual(await k.counts(x.org), before, 'no fact envelope, typed state, head or any other L14 row');
      assert.equal(await k.historyDigest(x.org), history);
      const r = await exec(sql);
      assert.deepEqual([r.outcome, r.replay], ['VALIDATED', false], 'the very same command now succeeds (not a replay)');
      assert.equal(await one(`select count(*) from gov_repo.l14_support_links where owner_kind='FACT_STATE' and fact_state_id='${r.fact_state_id}'`), '1');
    }
  });
});
