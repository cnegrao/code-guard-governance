import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { L14BusinessContextSemanticKind, L14BusinessContextTargetKind } from '@council/canonical-contracts';
import { decideBusinessContextAssignmentProposalFingerprint } from '@council/governance-review';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { lit } from '../helpers/m16-governed-write-fixtures';
import { BOGUS_FINGERPRINT, businessContextKit, type Key } from '../helpers/m16-l14-business-context-fixtures';

/**
 * M16-S1C.2 — BUSINESS_CONTEXT_ASSIGNMENT (the second authoritative M16 fact family) on real disposable PostgreSQL 17 (S1C2
 * horizon). Every command goes through the real public RPCs as service_role; every domain through the real S1B.5 domain
 * RPCs; every Authority Policy through the real AP RPCs. Owner access is used only to seed administrator support rows
 * (canonical objects, evidence, legacy columns), to read evidence and for rolled-back structural probes.
 */
test('M16 S1C.2 business context assignment lifecycle (disposable PG17)', { timeout: 2_400_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C2' });
  t.after(() => c.stop());
  const { owner, exec, rejects } = c;
  const k = await businessContextKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const row = async (query: string) => JSON.parse(await one(`select coalesce((${query}), 'null'::json)`));
  const authz = (id: string) => row(`select to_json(a) from gov_repo.l14_authorization_decisions a where authorization_decision_id='${id}'`);
  const fact = (id: string) => row(`select to_json(s) from gov_repo.l14_fact_states s where fact_state_id='${id}'`);
  const detail = (id: string) => row(`select to_json(s) from gov_repo.l14_business_context_assignment_states s where fact_state_id='${id}'`);
  const ts = (value: string) => `'${value}'::timestamptz`;
  const now = 'clock_timestamp()';

  await t.test('no automatic promotion: the migration created no fact / head / proposal / decision; legacy domain strings stay inert', async () => {
    for (const table of ['l14_business_context_assignment_states', 'l14_business_context_assignment_proposals',
      'l14_business_context_assignment_heads']) {
      assert.equal(await one(`select count(*) from gov_repo.${table}`), '0', table);
    }
    for (const table of ['l14_fact_states', 'l14_proposals', 'l14_governance_decisions', 'l14_authorization_decisions', 'l14_command_results']) {
      assert.equal(await one(`select count(*) from gov_repo.${table} where subject_kind='BUSINESS_CONTEXT_ASSIGNMENT'`), '0', table);
    }
    // The legacy free-text domain columns exist only as non-authoritative legacy values.
    assert.equal(await one(`select count(*) from information_schema.columns where table_schema='gov_repo'
      and table_name in ('agents','ai_systems') and column_name='business_domain'`), '2');
  });

  const ctx = await k.setup();
  const fin = await k.domain(ctx, 'finance', 'BUSINESS_DOMAIN');
  const retail = await k.domain(ctx, 'retail', 'BUSINESS_DOMAIN');
  const pii = await k.domain(ctx, 'customer-pii', 'INFORMATION_DOMAIN');
  const tx = await k.domain(ctx, 'transactions', 'INFORMATION_DOMAIN');

  // ---------------------------------------------------------------------------------------
  await t.test('every LEGAL pairing validates through proposal → authorization → decision → fact → head → resolver', async () => {
    const legal: Array<[L14BusinessContextTargetKind, keyof typeof ctx.objects, L14BusinessContextSemanticKind, typeof fin]> = [
      ['AGENT', 'agent', 'BUSINESS_DOMAIN', fin], ['DATA_ASSET', 'asset', 'BUSINESS_DOMAIN', fin],
      ['DATA_ASSET', 'asset', 'INFORMATION_DOMAIN', pii], ['DATA_ELEMENT', 'element', 'INFORMATION_DOMAIN', pii]];
    for (const [kind, object, semantic, pin] of legal) {
      const key = k.keyOf(kind, ctx.objects[object], semantic);
      const before = await k.counts(ctx.org);
      const proposal = k.validateProposal(key, pin);
      const submitted = await k.submit(ctx, ctx.member, `legal-${kind}-${semantic}-submit`, proposal);
      assert.deepEqual([submitted.outcome, submitted.command_kind, submitted.subject_kind, submitted.authorization_decision_id,
        submitted.governance_decision_id, submitted.fact_state_id, submitted.target_kind, submitted.target_canonical_object_id,
        submitted.semantic_kind, submitted.domain_id, submitted.domain_validated_state_id],
      ['SUBMITTED', 'SUBMIT_PROPOSAL', 'BUSINESS_CONTEXT_ASSIGNMENT', null, null, null, kind, ctx.objects[object], semantic,
        pin.subject.domainId, pin.stateId]);
      const mid = await k.counts(ctx.org);
      assert.equal(mid.l14_proposals, before.l14_proposals + 1);
      assert.equal(mid.l14_business_context_assignment_proposals, before.l14_business_context_assignment_proposals + 1);
      for (const table of ['l14_authorization_decisions', 'l14_governance_decisions', 'l14_fact_states', 'l14_business_context_assignment_states',
        'l14_business_context_assignment_heads', 'l14_registry_states', 'l14_domain_states'] as const) {
        assert.equal(mid[table], before[table], `submission writes no ${table}`);
      }
      const decided = await k.decide(ctx, ctx.bs, `legal-${kind}-${semantic}-validate`, submitted, proposal);
      assert.deepEqual([decided.outcome, decided.state_kind, decided.effective_to, decided.authorization_result, decided.expectation_kind,
        decided.predecessor_state_id], ['VALIDATED', 'VALIDATED', null, 'ALLOW', 'EXPECTED_NONE', null]);
      const a = await authz(decided.authorization_decision_id);
      assert.deepEqual({ action: a.requested_action, subject: a.subject_kind, scope: a.scope_tag, kind: a.target_canonical_kind,
        object: a.target_canonical_object_id, basis: a.basis_version_id, self: a.is_self_validation },
      { action: 'VALIDATE', subject: 'BUSINESS_CONTEXT_ASSIGNMENT', scope: 'CANONICAL_OBJECT', kind, object: ctx.objects[object],
        basis: ctx.v1.version_id, self: false });
      assert.equal(await one(`select string_agg(permission||'/'||requested_action||'/'||scope_tag, ',') from gov_repo.l14_authorization_decision_rules
        where authorization_decision_id='${decided.authorization_decision_id}'`), 'L14_BUSINESS_CONTEXT_VALIDATE/VALIDATE/ALL_ALLOWED_TARGETS');
      const f = await fact(decided.fact_state_id);
      assert.deepEqual([f.subject_kind, f.state_kind, f.trust_state, f.source_class, f.predecessor_state_id, f.governance_decision_id,
        f.authority_policy_version_id], ['BUSINESS_CONTEXT_ASSIGNMENT', 'VALIDATED', 'VALIDATED', 'LOCAL_HUMAN', null,
        decided.governance_decision_id, ctx.v1.version_id]);
      const d = await detail(decided.fact_state_id);
      assert.deepEqual([d.domain_id, d.domain_validated_state_id, d.semantic_kind], [pin.subject.domainId, pin.stateId, semantic]);
      assert.equal(await k.head(ctx.org, key), decided.fact_state_id);
      const r = await k.resolveRow(ctx.org, key, now, now);
      assert.deepEqual([r?.fact_state_id, r?.domain_id, r?.domain_validated_state_id], [decided.fact_state_id, pin.subject.domainId, pin.stateId]);
      assert.equal(await one(`select reason_code from gov_repo.l14_governance_decisions where governance_decision_id='${decided.governance_decision_id}'`),
        'BUSINESS_CONTEXT_ASSIGNMENT_VALIDATED');
      // No domain registry row is touched by an assignment (validating a fact never validates / mutates its dependency).
      const after = await k.counts(ctx.org);
      for (const table of ['l14_domain_admissions', 'l14_domain_states', 'l14_domain_heads', 'l14_registry_states'] as const) {
        assert.equal(after[table], before[table], table);
      }
    }
    // DATA_ASSET carries one BUSINESS_DOMAIN and one INFORMATION_DOMAIN; AGENT one BUSINESS; DATA_ELEMENT one INFORMATION.
    assert.deepEqual((await k.current(ctx.org, 'DATA_ASSET', ctx.objects.asset)).map(r => r.split('|').slice(0, 2).join('|')),
      [`BUSINESS_DOMAIN|${fin.subject.domainId}`, `INFORMATION_DOMAIN|${pii.subject.domainId}`]);
    assert.deepEqual((await k.current(ctx.org, 'AGENT', ctx.objects.agent)).map(r => r.split('|')[0]), ['BUSINESS_DOMAIN']);
    assert.deepEqual((await k.current(ctx.org, 'DATA_ELEMENT', ctx.objects.element)).map(r => r.split('|')[0]), ['INFORMATION_DOMAIN']);
    // Absence is UNKNOWN (no row), never a default domain.
    assert.deepEqual(await k.current(ctx.org, 'AGENT', ctx.objects.agent2), []);
    assert.equal(await k.resolve(ctx.org, k.keyOf('DATA_ASSET', ctx.objects.asset2, 'BUSINESS_DOMAIN'), now, now), null);
  });

  await t.test('every ILLEGAL pairing, every non-supported kind and every unknown semantic kind is rejected before anything is written', async () => {
    const before = await k.counts(ctx.org);
    const illegal: Array<[string, string, string, RegExp]> = [
      ['AGENT', ctx.objects.agent, 'INFORMATION_DOMAIN', /BUSINESS_CONTEXT_SEMANTIC_KIND_TARGET_ILLEGAL/],
      ['DATA_ELEMENT', ctx.objects.element, 'BUSINESS_DOMAIN', /BUSINESS_CONTEXT_SEMANTIC_KIND_TARGET_ILLEGAL/],
      ['AGENT_VERSION', ctx.objects.agentVersion, 'BUSINESS_DOMAIN', /BUSINESS_CONTEXT_TARGET_KIND_ILLEGAL/],
      ['AGENT_VERSION', ctx.objects.agentVersion, 'INFORMATION_DOMAIN', /BUSINESS_CONTEXT_TARGET_KIND_ILLEGAL/],
      ...(['MODEL', 'TOOL', 'MCP_SERVER', 'API', 'PROMPT', 'KNOWLEDGE_BASE', 'SKILL', 'DOMAIN', 'agent'].flatMap(kind =>
        ['BUSINESS_DOMAIN', 'INFORMATION_DOMAIN'].map(sk => [kind, ctx.objects.model, sk, /BUSINESS_CONTEXT_TARGET_KIND_ILLEGAL/] as [string, string, string, RegExp]))),
      ...(['DOMAIN', 'SEMANTIC_DOMAIN', 'BUSINESS_AREA', 'DATA_DOMAIN', 'BUSINESS_TERM', 'CAPABILITY', 'PURPOSE', 'business_domain', ''].map(sk =>
        ['DATA_ASSET', ctx.objects.asset, sk, /BUSINESS_CONTEXT_SEMANTIC_KIND_UNKNOWN/] as [string, string, string, RegExp])),
    ];
    for (const [kind, object, semantic, reason] of illegal) {
      const proposal = { ...k.validateProposal(k.keyOf('DATA_ASSET', object, 'BUSINESS_DOMAIN'), fin),
        targetKind: kind as L14BusinessContextTargetKind, semanticKind: semantic as L14BusinessContextSemanticKind };
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`illegal-${kind}-${semantic}`), proposal, fingerprint: BOGUS_FINGERPRINT })),
        'GV010', reason);
    }
    assert.deepEqual(await k.counts(ctx.org), before, 'nothing written');
    // Even the owner cannot store an illegal pairing (closed CHECK on the typed tables).
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
      insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values ('${ctx.org}','00000000-0000-4000-8000-0000000000a1','BUSINESS_CONTEXT_ASSIGNMENT','VALIDATE','LOCAL_HUMAN','${ctx.member.id}','NONE',now());
      insert into gov_repo.l14_business_context_assignment_proposals(organisation_id,proposal_id,intent,target_kind,target_canonical_object_id,
        semantic_kind,domain_id,domain_validated_state_id)
        values ('${ctx.org}','00000000-0000-4000-8000-0000000000a1','VALIDATE','AGENT',${lit(ctx.objects.agent)},'INFORMATION_DOMAIN',
          ${lit(pii.subject.domainId)},'${pii.stateId}');
      rollback;`), /l14_business_context_assignment_proposals_matrix_check/);
  });

  await t.test('exact target identity: wrong tenant, wrong kind for a real id, missing / label / malformed id are rejected', async () => {
    const other = await k.setup();
    const before = await k.counts(ctx.org);
    for (const [name, kind, object, detailRe, syntactic] of [
      ['wrong tenant', 'AGENT', other.objects.agent, /TARGET_OBJECT_UNRESOLVED/, false],
      ['wrong kind for a real agent id', 'DATA_ASSET', ctx.objects.agent, /TARGET_OBJECT_UNRESOLVED/, false],
      ['wrong kind for a real asset id', 'AGENT', ctx.objects.asset, /TARGET_OBJECT_UNRESOLVED/, false],
      ['missing id', 'AGENT', `canonical-object:missing-${randomUUID()}`, /TARGET_OBJECT_UNRESOLVED/, false],
      ['label instead of id', 'AGENT', `${ctx.label}-agent`, /TARGET_OBJECT_UNRESOLVED/, false],
      ['untrimmed id', 'AGENT', ` ${ctx.objects.agent}`, /TARGET_OBJECT_ID_MALFORMED/, true],
      ['empty id', 'AGENT', '', /TARGET_OBJECT_ID_MALFORMED/, true],
    ] as const) {
      const proposal = k.validateProposal(k.keyOf(kind, object, 'BUSINESS_DOMAIN'), fin);
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`target-${name}`), proposal,
        fingerprint: syntactic ? BOGUS_FINGERPRINT : undefined })), 'GV010', detailRe);
    }
    assert.deepEqual(await k.counts(ctx.org), before);
  });

  await t.test('domain dependency: missing / unadmitted / unvalidated / cross-tenant / wrong-kind / other-domain / revoked / free-text never validate', async () => {
    const other = await k.setup();
    const foreign = await k.domain(other, 'foreign', 'BUSINESS_DOMAIN');
    const unvalidated = await k.admittedDomain(ctx, 'unval', 'BUSINESS_DOMAIN');
    // The same opaque id admitted in BOTH namespaces: the semantic kind is part of the domain identity.
    const sharedId = `shared-domain:${randomUUID()}`;
    await k.dk.admit(ctx as never, ctx.registrar, 'shared-b-admit', { subjectKind: 'BUSINESS_DOMAIN', domainId: sharedId });
    await k.dk.admit(ctx as never, ctx.registrar, 'shared-i-admit', { subjectKind: 'INFORMATION_DOMAIN', domainId: sharedId });
    const sharedInfo = (await k.dk.validate(ctx as never, 'shared-i', { subjectKind: 'INFORMATION_DOMAIN', domainId: sharedId })).decided;
    const key = k.keyOf('DATA_ASSET', ctx.objects.asset2, 'BUSINESS_DOMAIN');
    const before = await k.counts(ctx.org);
    const submitFails = async (name: string, domainId: string, stateId: string, reason: RegExp, syntactic = false) =>
      rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`dep-${name}`), fingerprint: syntactic ? BOGUS_FINGERPRINT : undefined,
        proposal: { ...k.validateProposal(key, fin), domainId, domainValidatedStateId: stateId } })), 'GV010', reason);
    await submitFails('missing-domain', `business-domain:missing-${randomUUID()}`, randomUUID(), /DOMAIN_UNRESOLVED/);
    await submitFails('legacy-free-text', 'Financial Services', fin.stateId, /DOMAIN_UNRESOLVED/);
    await submitFails('label-of-a-real-domain', 'finance', fin.stateId, /DOMAIN_UNRESOLVED/);
    await submitFails('unvalidated', unvalidated.domainId, randomUUID(), /DOMAIN_DEPENDENCY_UNRESOLVED/);
    await submitFails('cross-tenant-domain', foreign.subject.domainId, foreign.stateId, /DOMAIN_UNRESOLVED/);
    await submitFails('cross-tenant-state-substitution', fin.subject.domainId, foreign.stateId, /DOMAIN_DEPENDENCY_UNRESOLVED/);
    await submitFails('other-domain-state', fin.subject.domainId, retail.stateId, /DOMAIN_DEPENDENCY_UNRESOLVED/);
    await submitFails('information-domain-as-business', pii.subject.domainId, pii.stateId, /DOMAIN_UNRESOLVED/);
    await submitFails('same-id-wrong-kind-state', sharedId, sharedInfo.registry_state_id, /DOMAIN_DEPENDENCY_UNRESOLVED/);
    await submitFails('untrimmed-domain-id', ` ${fin.subject.domainId}`, fin.stateId, /DOMAIN_ID_MALFORMED/, true);
    assert.deepEqual(await k.counts(ctx.org), before, 'nothing written');
    // A revoked domain: its old VALIDATED state is still an exact VALIDATED row (proposal accepted), but it is not the valid
    // domain state at the effective instant, so the decision is refused and consumes nothing.
    const gone = await k.domain(ctx, 'gone');
    await k.revokeDomain(ctx, 'gone', gone);
    const proposal = k.validateProposal(key, gone);
    const submitted = await k.submit(ctx, ctx.member, 'dep-revoked-submit', proposal);
    const mid = await k.counts(ctx.org);
    await rejects(c.svc(k.decideSql(ctx.bs, { commandId: ctx.cmd('dep-revoked-validate'), proposalId: submitted.proposal_id, proposal })),
      'GV010', /DOMAIN_DEPENDENCY_NOT_VALID/);
    assert.deepEqual(await k.counts(ctx.org), mid, 'no authorization / decision / fact consumed');
    // A future-dated domain is not yet valid now.
    const pending = await k.domain(ctx, 'pending', 'BUSINESS_DOMAIN', await k.instant('+1 hour'));
    const pp = k.validateProposal(key, pending);
    const ps = await k.submit(ctx, ctx.member, 'dep-pending-submit', pp);
    await rejects(c.svc(k.decideSql(ctx.bs, { commandId: ctx.cmd('dep-pending'), proposalId: ps.proposal_id, proposal: pp })),
      'GV010', /DOMAIN_DEPENDENCY_NOT_VALID/);
  });

  await t.test('source boundary: SYSTEM_SEED / SOURCE_CONNECTION / scanner never masquerade as LOCAL_HUMAN; the structural guard backs the RPC', async () => {
    const key = k.keyOf('DATA_ASSET', ctx.objects.asset2, 'INFORMATION_DOMAIN');
    for (const sourceClass of ['SYSTEM_SEED', 'SOURCE_CONNECTION'] as const) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`src-${sourceClass}`), fingerprint: BOGUS_FINGERPRINT,
        proposal: { ...k.validateProposal(key, tx), sourceClass } })), 'GV010', /SOURCE_CLASS_NOT_EXECUTABLE/);
    }
    for (const sourceClass of ['SCANNER', 'LLM', 'CATALOG']) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`src-${sourceClass}`), fingerprint: BOGUS_FINGERPRINT,
        proposal: { ...k.validateProposal(key, tx), sourceClass: sourceClass as never } })), 'GV010', /PROPOSAL_VOCABULARY_UNKNOWN/);
    }
    // Even the owner cannot write a non-LOCAL_HUMAN typed proposal (rolled back).
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
      insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values ('${ctx.org}','00000000-0000-4000-8000-000000000001','BUSINESS_CONTEXT_ASSIGNMENT','VALIDATE','SOURCE_CONNECTION','${ctx.member.id}','NONE',now());
      insert into gov_repo.l14_business_context_assignment_proposals(organisation_id,proposal_id,intent,target_kind,target_canonical_object_id,
        semantic_kind,domain_id,domain_validated_state_id)
        values ('${ctx.org}','00000000-0000-4000-8000-000000000001','VALIDATE','DATA_ASSET',${lit(ctx.objects.asset2)},'INFORMATION_DOMAIN',
          ${lit(tx.subject.domainId)},'${tx.stateId}');
      rollback;`), /BUSINESS_CONTEXT_PROPOSAL_SOURCE_INVALID/);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('authority: only L14_BUSINESS_CONTEXT_VALIDATE over the exact typed target scope, current roles, current policy; durable DENY', async () => {
    const x = await k.setup();
    const d = await k.domain(x, 'auth');
    const deny = async (name: string, actor: typeof x.bs, key: Key, reason: string, options: { from?: string | null; self?: boolean } = {}) => {
      const proposal = k.validateProposal(key, d, options.from ?? null);
      const submitted = await k.submit(x, options.self ? actor : x.member, `${name}-submit`, proposal);
      const r = await exec(k.decideSql(actor, { commandId: x.cmd(`${name}-decide`), proposalId: submitted.proposal_id, proposal }));
      assert.deepEqual([r.outcome, r.authorization_result, r.deny_reason, r.governance_decision_id, r.fact_state_id],
        ['DENIED', 'DENY', reason, null, null], name);
      const a = await authz(r.authorization_decision_id);
      assert.deepEqual([a.scope_tag, a.target_canonical_kind, a.target_canonical_object_id], ['CANONICAL_OBJECT', key.targetKind, key.targetCanonicalObjectId]);
      const again = await exec(k.decideSql(actor, { commandId: x.cmd(`${name}-decide`), proposalId: submitted.proposal_id, proposal }));
      assert.deepEqual([again.replay, again.outcome, again.authorization_decision_id, again.recorded_at], [true, 'DENIED', r.authorization_decision_id, r.recorded_at]);
      assert.equal(await k.head(x.org, key), null, 'a DENY creates no head');
    };
    const agentKey = k.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN');
    const assetKey = k.keyOf('DATA_ASSET', x.objects.asset, 'BUSINESS_DOMAIN');
    const asset2Key = k.keyOf('DATA_ASSET', x.objects.asset2, 'BUSINESS_DOMAIN');
    await deny('member', x.member2, agentKey, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('domain-steward', x.steward, agentKey, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('domain-registrar', x.registrar, agentKey, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('responsibility-steward', x.bresp, agentKey, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('ap-admin', x.boot, agentKey, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('contributor', x.bcontrib, agentKey, 'SOURCE_NOT_AUTHORIZED');
    await deny('kind-scope-mismatch', x.bkind, assetKey, 'SCOPE_NOT_AUTHORIZED');
    await deny('object-scope-mismatch', x.bobject, asset2Key, 'SCOPE_NOT_AUTHORIZED');
    await deny('relationship-scope', x.brel, agentKey, 'SCOPE_NOT_AUTHORIZED');
    await deny('self-validation', x.bs, agentKey, 'SELF_VALIDATION_NOT_PERMITTED', { self: true });
    await deny('backdated', x.bs, agentKey, 'TEMPORAL_ACTION_NOT_AUTHORIZED', { from: await k.instant('-1 minute') });
    await deny('future-dated', x.bs, agentKey, 'TEMPORAL_ACTION_NOT_AUTHORIZED', { from: await k.instant('+1 hour') });
    const byKind = await k.assign(x, 'kind-ok', agentKey, d, { validator: x.bkind });
    assert.equal(byKind.decided.outcome, 'VALIDATED');
    assert.equal(await one(`select string_agg(scope_tag||'/'||coalesce(scope_canonical_kind,'-'), ',') from gov_repo.l14_authorization_decision_rules
      where authorization_decision_id='${byKind.decided.authorization_decision_id}'`), 'CANONICAL_KIND/AGENT');
    const byObject = await k.assign(x, 'object-ok', assetKey, d, { validator: x.bobject });
    assert.equal(byObject.decided.outcome, 'VALIDATED');
    assert.equal(await one(`select string_agg(scope_tag||'/'||coalesce(scope_canonical_object_id,'-'), ',') from gov_repo.l14_authorization_decision_rules
      where authorization_decision_id='${byObject.decided.authorization_decision_id}'`), `CANONICAL_OBJECT/${x.objects.asset}`);
    // Self-validation only where the effective policy explicitly allows it.
    const info = await k.domain(x, 'auth-info', 'INFORMATION_DOMAIN');
    const selfKey = k.keyOf('DATA_ELEMENT', x.objects.element, 'INFORMATION_DOMAIN');
    const proposal = k.validateProposal(selfKey, info);
    const submitted = await k.submit(x, x.bflex, 'self-ok-submit', proposal);
    const self = await k.decide(x, x.bflex, 'self-ok', submitted, proposal);
    assert.deepEqual([self.outcome, (await authz(self.authorization_decision_id)).is_self_validation], ['VALIDATED', true]);
    // Authority changes: a NEW command after losing the role is denied; the old DENY command id never becomes ALLOW.
    const lost = k.keyOf('AGENT', x.objects.agent2, 'BUSINESS_DOMAIN');
    const lp = k.validateProposal(lost, d);
    const ls = await k.submit(x, x.member, 'lost-submit', lp);
    await owner(`update gov_repo.governance_users set role_ids='{}'::uuid[] where user_id='${x.bs2.id}'`);
    const lr = await exec(k.decideSql(x.bs2, { commandId: x.cmd('lost-decide'), proposalId: ls.proposal_id, proposal: lp }));
    assert.deepEqual([lr.outcome, lr.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    await owner(`update gov_repo.governance_users set role_ids=array['${k.stewardRole}']::uuid[] where user_id='${x.bs2.id}'`);
    const replayed = await exec(k.decideSql(x.bs2, { commandId: x.cmd('lost-decide'), proposalId: ls.proposal_id, proposal: lp }));
    assert.deepEqual([replayed.replay, replayed.outcome], [true, 'DENIED'], 'changed eligibility requires a new command id');
    const fresh = await exec(k.decideSql(x.bs2, { commandId: x.cmd('lost-decide-2'), proposalId: ls.proposal_id, proposal: lp }));
    assert.equal(fresh.outcome, 'VALIDATED');
  });

  await t.test('requested action = exact outcome; closed reason codes; proposal terminality; DEFER non-terminal; correction = new linked proposal', async () => {
    const x = await k.setup();
    const d = await k.domain(x, 'term');
    const key = k.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN');
    const proposal = k.validateProposal(key, d);
    const submitted = await k.submit(x, x.member, 'term-submit', proposal);
    const sql = (name: string, outcome: 'VALIDATE' | 'REJECT' | 'DEFER' | 'REVOKE', reasonCode?: string) =>
      k.decideSql(x.bs, { commandId: x.cmd(name), proposalId: submitted.proposal_id, proposal, outcome, reasonCode,
        fingerprint: reasonCode ? BOGUS_FINGERPRINT : undefined });
    await rejects(c.svc(sql('term-wrong-reason', 'VALIDATE', 'BUSINESS_CONTEXT_ASSIGNMENT_REJECTED')), 'GV010', /DECISION_VOCABULARY_INVALID/);
    await rejects(c.svc(sql('term-free-text', 'VALIDATE', 'Clearly the finance domain')), 'GV010', /DECISION_VOCABULARY_INVALID/);
    await rejects(c.svc(sql('term-other-subject', 'VALIDATE', 'BUSINESS_DOMAIN_VALIDATED')), 'GV010', /DECISION_VOCABULARY_INVALID/);
    await rejects(c.svc(sql('term-other-family', 'VALIDATE', 'RESPONSIBILITY_ASSIGNMENT_VALIDATED')), 'GV010', /DECISION_VOCABULARY_INVALID/);
    await rejects(c.svc(sql('term-revoke-on-validate', 'REVOKE')), 'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    const deferred = await exec(sql('term-defer', 'DEFER'));
    assert.deepEqual([deferred.outcome, deferred.fact_state_id], ['DEFERRED', null]);
    assert.equal((await exec(sql('term-defer-2', 'DEFER'))).outcome, 'DEFERRED', 'DEFER is non-terminal');
    const validated = await exec(sql('term-validate', 'VALIDATE'));
    assert.equal(validated.outcome, 'VALIDATED');
    for (const outcome of ['REJECT', 'DEFER'] as const) {
      await rejects(c.svc(k.decideSql(x.bs, { commandId: x.cmd(`term-after-${outcome}`), proposalId: submitted.proposal_id, proposal, outcome,
        expected: validated.fact_state_id })), 'GV010', /PROPOSAL_TERMINAL/);
    }
    // REJECT is terminal; a correction is a NEW proposal linked to the prior one (same key).
    const key2 = k.keyOf('DATA_ASSET', x.objects.asset, 'BUSINESS_DOMAIN');
    const p2 = k.validateProposal(key2, d);
    const s2 = await k.submit(x, x.member, 'rej-submit', p2);
    const rejected = await exec(k.decideSql(x.bs, { commandId: x.cmd('rej'), proposalId: s2.proposal_id, proposal: p2, outcome: 'REJECT' }));
    assert.deepEqual([rejected.outcome, rejected.fact_state_id, await k.head(x.org, key2)], ['REJECTED', null, null]);
    await rejects(c.svc(k.decideSql(x.bs, { commandId: x.cmd('rej-then-validate'), proposalId: s2.proposal_id, proposal: p2 })), 'GV010', /PROPOSAL_TERMINAL/);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rej-bad-prior'), proposal: p2, prior: submitted.proposal_id })), 'GV010',
      /PRIOR_PROPOSAL_UNRESOLVED/);
    const corrected = await k.submit(x, x.member, 'rej-correction', p2, s2.proposal_id);
    assert.equal(await one(`select prior_proposal_id from gov_repo.l14_proposals where proposal_id='${corrected.proposal_id}'`), s2.proposal_id);
    assert.equal((await k.decide(x, x.bs, 'rej-correction-validate', corrected, p2)).outcome, 'VALIDATED');
    // REVOKE intent: REVOKE / REJECT / DEFER only; it pins the exact current state + domain + dependency.
    const rp = k.revokeProposal(key, d, validated.fact_state_id);
    const rs = await k.submit(x, x.member, 'rv-submit', rp);
    await rejects(c.svc(k.decideSql(x.bs, { commandId: x.cmd('rv-validate'), proposalId: rs.proposal_id, proposal: rp, outcome: 'VALIDATE',
      expected: validated.fact_state_id })), 'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    assert.equal((await exec(k.decideSql(x.bs, { commandId: x.cmd('rv-defer'), proposalId: rs.proposal_id, proposal: rp, outcome: 'DEFER',
      expected: validated.fact_state_id }))).outcome, 'DEFERRED');
    const revoked = await exec(k.decideSql(x.bs, { commandId: x.cmd('rv-revoke'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE',
      expected: validated.fact_state_id }));
    const f = await fact(revoked.fact_state_id);
    assert.deepEqual([revoked.outcome, f.revokes_state_id, f.predecessor_state_id, f.effective_to, revoked.predecessor_state_id],
      ['REVOKED', validated.fact_state_id, validated.fact_state_id, null, validated.fact_state_id]);
    assert.equal(await one(`select reason_code from gov_repo.l14_governance_decisions where governance_decision_id='${revoked.governance_decision_id}'`),
      'BUSINESS_CONTEXT_ASSIGNMENT_REVOKED');
    assert.equal(await k.resolve(x.org, key, now, now), null, 'a revoked key is UNKNOWN');
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-again'), proposal: rp })), 'GV010', /TARGET_ALREADY_REVOKED/);
    // REVOKE pins the exact domain + dependency of its target.
    const other = await k.domain(x, 'other-dep');
    const s3 = await k.assign(x, 'rv-dep', k.keyOf('AGENT', x.objects.agent2, 'BUSINESS_DOMAIN'), d);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-dep-mismatch'),
      proposal: k.revokeProposal(k.keyOf('AGENT', x.objects.agent2, 'BUSINESS_DOMAIN'), other, s3.stateId) })), 'GV010', /DOMAIN_DEPENDENCY_MISMATCH/);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-other-key'),
      proposal: k.revokeProposal(k.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN'), d, s3.stateId) })), 'GV010', /TARGET_STATE_UNRESOLVED/);
  });

  await t.test('replay: exact retry returns the ORIGINAL durable result; changed payload GV007; wrong fingerprint GV008; stale GV009', async () => {
    const x = await k.setup();
    const d = await k.domain(x, 'rp', 'INFORMATION_DOMAIN');
    const key = k.keyOf('DATA_ASSET', x.objects.asset, 'INFORMATION_DOMAIN');
    const proposal = k.validateProposal(key, d);
    const subSql = k.submitSql(x.member, { commandId: x.cmd('rp-submit'), proposal });
    const submitted = await exec(subSql);
    const subAgain = await exec(subSql);
    assert.deepEqual([subAgain.replay, subAgain.proposal_id, subAgain.recorded_at], [true, submitted.proposal_id, submitted.recorded_at]);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rp-submit'), proposal: { ...proposal, requestedEffectiveTo: await k.instant('+1 day') } })),
      'GV007', /COMMAND_ID_REUSED_WITH_DIFFERENT_SEMANTICS/);
    const decSql = k.decideSql(x.bs, { commandId: x.cmd('rp-decide'), proposalId: submitted.proposal_id, proposal });
    const decided = await exec(decSql);
    const before = await k.counts(x.org);
    const again = await exec(decSql);
    for (const field of ['outcome', 'authorization_decision_id', 'governance_decision_id', 'fact_state_id', 'effective_from', 'effective_to', 'recorded_at',
      'command_fingerprint', 'domain_id', 'domain_validated_state_id']) assert.equal(again[field], decided[field], field);
    assert.equal(again.replay, true);
    assert.deepEqual(await k.counts(x.org), before, 'a replay writes nothing');
    await rejects(c.svc(k.decideSql(x.bs, { commandId: x.cmd('rp-decide'), proposalId: submitted.proposal_id, proposal, outcome: 'DEFER' })),
      'GV007', /COMMAND_ID_REUSED_WITH_DIFFERENT_SEMANTICS/);
    const wrong = decideBusinessContextAssignmentProposalFingerprint({ organisationId: x.org, actorUserId: x.bs.id, outcome: 'VALIDATE',
      proposalId: submitted.proposal_id, proposal: { ...proposal, semanticKind: 'BUSINESS_DOMAIN' }, expectedCurrentStateId: null,
      support: { status: 'NONE', evidenceIds: [] } });
    await rejects(c.svc(k.decideSql(x.bs, { commandId: x.cmd('rp-wrong-fp'), proposalId: submitted.proposal_id, proposal, fingerprint: wrong })),
      'GV008', /CALLER_FINGERPRINT_DIFFERS/);
    // Stale expectation: explicit expected-none when the key already has a state, or a wrong expected state.
    const other = await k.domain(x, 'rp-other', 'INFORMATION_DOMAIN');
    const p2 = k.validateProposal(key, other);
    const s2 = await k.submit(x, x.member, 'rp-succ-submit', p2);
    const dup = k.validateProposal(key, d);
    const ds = await k.submit(x, x.member, 'rp-dup-submit', dup);
    const beforeRefused = await k.counts(x.org);
    await rejects(c.svc(k.decideSql(x.bs, { commandId: x.cmd('rp-stale-none'), proposalId: s2.proposal_id, proposal: p2, expected: null })),
      'GV009', /BUSINESS_CONTEXT_ASSIGNMENT_STATE_EXISTS/);
    await rejects(c.svc(k.decideSql(x.bs, { commandId: x.cmd('rp-stale-wrong'), proposalId: s2.proposal_id, proposal: p2, expected: randomUUID() })),
      'GV009', /STATE_EXPECTATION_MISMATCH/);
    // The SAME domain + SAME dependency again on an open-ended VALIDATED key: one active assignment, no no-op successor.
    await rejects(c.svc(k.decideSql(x.bs, { commandId: x.cmd('rp-dup'), proposalId: ds.proposal_id, proposal: dup, expected: decided.fact_state_id })),
      'GV010', /BUSINESS_CONTEXT_ASSIGNMENT_ALREADY_VALIDATED/);
    assert.deepEqual(await k.counts(x.org), beforeRefused, 'none of the refused commands consumed anything');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('supersession: D1 → D2 on the SAME key appends a successor; head moves; D1 byte-identical; closure derived; no UPDATE', async () => {
    const x = await k.setup();
    const [d1, d2] = [await k.domain(x, 'sup-fin'), await k.domain(x, 'sup-retail')];
    const key = k.keyOf('DATA_ASSET', x.objects.asset, 'BUSINESS_DOMAIN');
    const s1 = await k.assign(x, 'sup-1', key, d1);
    const s1Rows = await k.stateRows(x.org, s1.stateId);
    const tBetween = await one('select clock_timestamp()::text');
    const s2 = await k.assign(x, 'sup-2', key, d2);
    // 1-3. Both validated; the head moved to D2 on the SAME key.
    assert.deepEqual([s2.decided.outcome, s2.decided.expectation_kind, s2.decided.expected_current_state_id, s2.decided.predecessor_state_id],
      ['VALIDATED', 'EXPECTED_CURRENT', s1.stateId, s1.stateId]);
    assert.equal(await k.head(x.org, key), s2.stateId);
    // 4. D1 rows byte-identical (incl. xmin / ctid: never UPDATEd, never rewritten).
    assert.equal(await k.stateRows(x.org, s1.stateId), s1Rows, 'D1 envelope + detail untouched');
    // 5. D2's predecessor is D1 (envelope and typed detail).
    assert.deepEqual([(await fact(s2.stateId)).predecessor_state_id, (await detail(s2.stateId)).predecessor_state_id], [s1.stateId, s1.stateId]);
    assert.deepEqual([(await detail(s1.stateId)).domain_id, (await detail(s2.stateId)).domain_id], [d1.subject.domainId, d2.subject.domainId]);
    // 6. The domain is NOT part of the head key: one head row for the key, keyed without domain_id.
    assert.equal(await one(`select count(*) from gov_repo.l14_business_context_assignment_heads where organisation_id='${x.org}'
      and target_canonical_object_id='${x.objects.asset}' and semantic_kind='BUSINESS_DOMAIN'`), '1');
    assert.equal(await one(`select count(*) from information_schema.columns where table_schema='gov_repo'
      and table_name='l14_business_context_assignment_heads' and column_name='domain_id'`), '0');
    const r2 = await fact(s2.stateId);
    const [T2, R2] = [r2.effective_from as string, r2.recorded_at as string];
    // 7. Before D2's effective time → D1.
    assert.equal(await k.resolve(x.org, key, ts(tBetween), now), s1.stateId);
    // 8. After D2's effective time → D2.
    assert.equal(await k.resolve(x.org, key, ts(T2), now), s2.stateId);
    assert.equal(await k.resolve(x.org, key, now, now), s2.stateId);
    // 9. An earlier recorded cutoff cannot see the later-recorded D2: historical knowledge still says D1, even at T >= T2.
    assert.equal(await k.resolve(x.org, key, now, ts(tBetween)), s1.stateId);
    assert.equal(await k.resolve(x.org, key, ts(T2), `${ts(R2)} - interval '1 microsecond'`), s1.stateId);
    assert.deepEqual((await k.current(x.org, 'DATA_ASSET', x.objects.asset, now, ts(tBetween))).map(r => r.split('|').slice(0, 2).join('|')),
      [`BUSINESS_DOMAIN|${d1.subject.domainId}`]);
    // 10. Two states of the key in history, one active at any instant; no UPDATE / DELETE of history ever ran.
    assert.equal(await one(`select count(*) from gov_repo.l14_business_context_assignment_states where organisation_id='${x.org}'
      and target_canonical_object_id='${x.objects.asset}' and semantic_kind='BUSINESS_DOMAIN'`), '2');
    assert.equal(await one(`select coalesce(sum(n_tup_upd + n_tup_del), 0) from pg_stat_user_tables where schemaname='gov_repo'
      and relname in ('l14_business_context_assignment_states','l14_business_context_assignment_proposals','l14_fact_states')`), '0');
    // A re-supersession back to D1 (new successor, same key) is legal; it never reopens S1.
    const s3 = await k.assign(x, 'sup-3', key, d1);
    assert.deepEqual([(await fact(s3.stateId)).predecessor_state_id, await k.head(x.org, key)], [s2.stateId, s3.stateId]);
    assert.equal(await k.stateRows(x.org, s1.stateId), s1Rows);
    // A successor may never start before its predecessor's start.
    const back = k.validateProposal(key, d2, await k.instant('-1 hour'));
    const bs = await k.submit(x, x.member, 'sup-back-submit', back);
    await rejects(c.svc(k.decideSql(x.bflex, { commandId: x.cmd('sup-back'), proposalId: bs.proposal_id, proposal: back, expected: s3.stateId })),
      'GV011', /SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE/);
  });

  await t.test('supersession: a FUTURE successor does not prematurely hide the current predecessor', async () => {
    const x = await k.setup();
    const [d1, d2] = [await k.domain(x, 'fs-1', 'INFORMATION_DOMAIN'), await k.domain(x, 'fs-2', 'INFORMATION_DOMAIN')];
    const key = k.keyOf('DATA_ELEMENT', x.objects.element, 'INFORMATION_DOMAIN');
    const s1 = await k.assign(x, 'fs-1', key, d1);
    const T2 = await k.instant('+1 hour');
    const s2 = await k.assign(x, 'fs-2', key, d2, { from: T2 });
    assert.deepEqual([s2.decided.outcome, await k.canonical(s2.decided.effective_from), await k.head(x.org, key)], ['VALIDATED', T2, s2.stateId]);
    assert.equal(await k.resolve(x.org, key, now, now), s1.stateId, 'D1 stays current before D2 starts');
    assert.equal(await k.resolve(x.org, key, `${ts(T2)} - interval '1 microsecond'`, now), s1.stateId);
    assert.equal(await k.resolve(x.org, key, ts(T2), now), s2.stateId, 'D2 from its start');
    assert.equal(await k.resolve(x.org, key, `${ts(T2)} + interval '1 day'`, now), s2.stateId);
  });

  await t.test('temporal: omitted start = DB instant; past / future need explicit permission; effective_to rules; expiry without UPDATE', async () => {
    const x = await k.setup();
    const d = await k.domain(x, 'tm', 'BUSINESS_DOMAIN', await k.instant('-3 hours'));
    const d2 = await k.domain(x, 'tm2', 'BUSINESS_DOMAIN', await k.instant('-3 hours'));
    const before = await one('select clock_timestamp()::text');
    // Omitted start = the DB transaction instant.
    const imm = await k.assign(x, 'tm-imm', k.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN'), d);
    const f = await fact(imm.stateId);
    assert.equal(f.effective_from, f.recorded_at, 'IMMEDIATE = the DB transaction instant');
    assert.ok(Date.parse(f.effective_from) >= Date.parse(before));
    assert.equal(await k.resolve(x.org, k.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN'), now, ts(before)), null,
      'a cutoff before the decision never sees it');
    // Past / future without permission = DENY; with permission = PASS.
    for (const [name, offset, object] of [['past', '-90 minutes', 'asset'], ['future', '+1 hour', 'asset2']] as const) {
      const key = k.keyOf('DATA_ASSET', x.objects[object], 'BUSINESS_DOMAIN');
      const p = k.validateProposal(key, d, await k.instant(offset));
      const s = await k.submit(x, x.member, `tm-${name}-submit`, p);
      const denied = await exec(k.decideSql(x.bs, { commandId: x.cmd(`tm-${name}-deny`), proposalId: s.proposal_id, proposal: p }));
      assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED'], name);
      const passed = await exec(k.decideSql(x.bflex, { commandId: x.cmd(`tm-${name}-pass`), proposalId: s.proposal_id, proposal: p }));
      assert.deepEqual([passed.outcome, await k.canonical(passed.effective_from)], ['VALIDATED', p.requestedEffectiveFrom], name);
    }
    // effective_to == / < effective_from: rejected at submission (both explicit) …
    const keyT = k.keyOf('DATA_ELEMENT', x.objects.element, 'INFORMATION_DOMAIN');
    const info = await k.domain(x, 'tm-info', 'INFORMATION_DOMAIN', await k.instant('-3 hours'));
    const start = await k.instant('-90 minutes');
    for (const [name, to] of [['eq', start], ['lt', await k.instant('-100 minutes')]] as const) {
      await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd(`et-${name}`), proposal: k.validateProposal(keyT, info, start, to),
        fingerprint: BOGUS_FINGERPRINT })), 'GV010', /EFFECTIVE_INTERVAL_INVALID/);
    }
    // … and at decision time for an IMMEDIATE start whose end is not after the DB instant (nothing consumed).
    const im = k.validateProposal(keyT, info, null, await k.instant('-1 minute'));
    const ims = await k.submit(x, x.member, 'et-imm-submit', im);
    const mid = await k.counts(x.org);
    await rejects(c.svc(k.decideSql(x.bflex, { commandId: x.cmd('et-imm'), proposalId: ims.proposal_id, proposal: im })), 'GV010', /EFFECTIVE_INTERVAL_INVALID/);
    assert.deepEqual(await k.counts(x.org), mid);
    // A valid explicit interval in the past (BACKDATED, flex): already expired, never UPDATEd; historical interval visible.
    const end = await k.instant('-30 minutes');
    const expired = await k.assign(x, 'et-a', keyT, info, { from: start, to: end });
    const ef = await fact(expired.stateId);
    assert.deepEqual([await k.canonical(ef.effective_from), await k.canonical(ef.effective_to)], [start, end]);
    assert.equal(await k.canonical(expired.decided.effective_to), end, 'the durable result carries the immutable end');
    const rows = await k.stateRows(x.org, expired.stateId);
    assert.equal(await k.resolve(x.org, keyT, now, now), null, 'expiry → UNKNOWN, without UPDATE');
    assert.equal(await k.resolve(x.org, keyT, ts(await k.instant('-60 minutes')), now), expired.stateId, 'historical interval visible');
    assert.equal(await k.resolve(x.org, keyT, ts(end), now), null, 'half-open: the end instant is outside');
    // Successor before the explicit predecessor end: rejected; exactly at the end: PASS; the gap case is covered below.
    const info2 = await k.domain(x, 'tm-info2', 'INFORMATION_DOMAIN', await k.instant('-3 hours'));
    const early = k.validateProposal(keyT, info2, await k.instant('-45 minutes'));
    const es = await k.submit(x, x.member, 'et-early-submit', early);
    await rejects(c.svc(k.decideSql(x.bflex, { commandId: x.cmd('et-early'), proposalId: es.proposal_id, proposal: early, expected: expired.stateId })),
      'GV011', /SUCCESSOR_BEFORE_PREDECESSOR_END/);
    const exact = await k.assign(x, 'et-exact', keyT, info2, { from: end });
    assert.deepEqual([exact.decided.outcome, (await fact(exact.stateId)).predecessor_state_id], ['VALIDATED', expired.stateId]);
    assert.equal(await k.resolve(x.org, keyT, now, now), exact.stateId);
    assert.equal(await k.resolve(x.org, keyT, ts(await k.instant('-60 minutes')), now), expired.stateId, 'the expired predecessor keeps its interval');
    assert.equal(await k.stateRows(x.org, expired.stateId), rows, 'the expired fact is byte-identical');
    // Successor AFTER an explicit end: a gap is permitted and is UNKNOWN.
    const keyG = k.keyOf('DATA_ASSET', x.objects.asset, 'INFORMATION_DOMAIN');
    const g1 = await k.assign(x, 'gap-1', keyG, info, { from: start, to: await k.instant('-60 minutes') });
    const gapStart = await k.instant('-40 minutes');
    const g2 = await k.assign(x, 'gap-2', keyG, info2, { from: gapStart });
    assert.equal(await k.resolve(x.org, keyG, ts(await k.instant('-70 minutes')), now), g1.stateId);
    assert.equal(await k.resolve(x.org, keyG, ts(await k.instant('-50 minutes')), now), null, 'the gap is UNKNOWN');
    assert.equal(await k.resolve(x.org, keyG, now, now), g2.stateId);
    // A REVOKE never carries an end of its own and must fall inside its target's interval.
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('et-revoke-to'), fingerprint: BOGUS_FINGERPRINT,
      proposal: { ...k.revokeProposal(keyG, info2, g2.stateId), requestedEffectiveTo: await k.instant('+1 day') } })), 'GV010', /EFFECTIVE_TO_NOT_PERMITTED/);
    const keyB = k.keyOf('AGENT', x.objects.agent2, 'BUSINESS_DOMAIN');
    const bounded = await k.assign(x, 'et-bounded', keyB, d2, { from: start, to: end });
    const late = k.revokeProposal(keyB, d2, bounded.stateId, await k.instant('-10 minutes'));
    const ls = await k.submit(x, x.member, 'et-late-submit', late);
    await rejects(c.svc(k.decideSql(x.bflex, { commandId: x.cmd('et-late'), proposalId: ls.proposal_id, proposal: late, outcome: 'REVOKE',
      expected: bounded.stateId })), 'GV011', /REVOKE_AFTER_TARGET_EXPIRY/);
    const tooEarly = k.revokeProposal(keyB, d2, bounded.stateId, await k.instant('-2 hours'));
    const tes = await k.submit(x, x.member, 'et-early-rv-submit', tooEarly);
    await rejects(c.svc(k.decideSql(x.bflex, { commandId: x.cmd('et-early-rv'), proposalId: tes.proposal_id, proposal: tooEarly, outcome: 'REVOKE',
      expected: bounded.stateId })), 'GV011', /REVOKE_BEFORE_TARGET_EFFECTIVE/);
    // Re-validation after a tombstone never starts before it.
    const keyR = k.keyOf('DATA_ELEMENT', x.objects.element2, 'INFORMATION_DOMAIN');
    const r1 = await k.assign(x, 'rv-1', keyR, info);
    const rv = await k.revoke(x, 'rv-1', keyR, info, r1.stateId);
    const reval = k.validateProposal(keyR, info2, await k.instant('-20 minutes'));
    const rs = await k.submit(x, x.member, 'rv-reval-submit', reval);
    await rejects(c.svc(k.decideSql(x.bflex, { commandId: x.cmd('rv-reval'), proposalId: rs.proposal_id, proposal: reval,
      expected: rv.decided.fact_state_id })), 'GV011', /REVALIDATION_OVERLAPS_PRIOR_INTERVAL/);
    const ok = await k.assign(x, 'rv-2', keyR, info2);
    assert.deepEqual([ok.decided.outcome, (await fact(ok.stateId)).predecessor_state_id], ['VALIDATED', rv.decided.fact_state_id]);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('O49: a domain revocation invalidates the assignment without history mutation; no silent repin; restoration = new governed state', async () => {
    const x = await k.setup();
    const ds1 = await k.domain(x, 'o49');
    const key = k.keyOf('DATA_ASSET', x.objects.asset, 'BUSINESS_DOMAIN');
    const a = await k.assign(x, 'o49', key, ds1);
    // 1-3. The domain state DS1 is VALIDATED, the assignment pins it, the resolver returns it.
    assert.equal(await k.resolve(x.org, key, now, now), a.stateId);
    const rows = await k.stateRows(x.org, a.stateId);
    const digest = await k.factDigest(x.org);
    const beforeRevoke = await one('select clock_timestamp()::text');
    // 4. DS1 is revoked at T.
    const dr = await k.revokeDomain(x, 'o49', ds1);
    const T = dr.effective_from as string;
    const R = await one(`select recorded_at::text from gov_repo.l14_registry_states where state_id='${dr.registry_state_id}'`);
    // 5. Assignment history byte-identical.
    assert.equal(await k.stateRows(x.org, a.stateId), rows, 'business-context history byte-identical');
    assert.equal(await k.factDigest(x.org), digest, 'no business-context row of the organisation changed');
    // 6. At T with a cutoff seeing the revocation → UNKNOWN.
    assert.equal(await k.resolve(x.org, key, ts(T), ts(R)), null);
    assert.equal(await k.resolve(x.org, key, now, now), null);
    assert.deepEqual(await k.current(x.org, 'DATA_ASSET', x.objects.asset), [], 'no current business context of the asset');
    // 7. An earlier recorded cutoff keeps the historical fact.
    assert.equal(await k.resolve(x.org, key, ts(beforeRevoke), ts(beforeRevoke)), a.stateId);
    assert.equal(await k.resolve(x.org, key, now, `${ts(R)} - interval '1 microsecond'`), a.stateId, 'the system did not yet know the revocation');
    assert.equal(await k.resolve(x.org, key, ts(beforeRevoke), now), a.stateId, 'valid where it was valid');
    // 8. Domain re-validation creates DS2.
    const ds2 = await k.revalidateDomain(x, 'o49', ds1);
    assert.notEqual(ds2.stateId, ds1.stateId);
    // 9. The old assignment stays pinned to DS1: no automatic repin.
    assert.equal((await detail(a.stateId)).domain_validated_state_id, ds1.stateId);
    assert.equal(await k.resolve(x.org, key, now, now), null, 'no silent repin to DS2');
    assert.equal(await k.stateRows(x.org, a.stateId), rows);
    // A new assignment can never pin the invalidated dependency …
    const stale = k.validateProposal(k.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN'), ds1);
    const ss = await k.submit(x, x.member, 'o49-stale-submit', stale);
    await rejects(c.svc(k.decideSql(x.bs, { commandId: x.cmd('o49-stale'), proposalId: ss.proposal_id, proposal: stale })), 'GV010',
      /DOMAIN_DEPENDENCY_NOT_VALID/);
    // 10. … and restoring the SAME key is a NEW governed successor pinning DS2 (same domain id, new dependency).
    const restored = await k.assign(x, 'o49-restore', key, ds2);
    assert.deepEqual([restored.decided.outcome, restored.decided.predecessor_state_id, restored.decided.domain_validated_state_id],
      ['VALIDATED', a.stateId, ds2.stateId]);
    assert.equal(await k.resolve(x.org, key, now, now), restored.stateId);
    assert.equal(await k.resolve(x.org, key, ts(beforeRevoke), now), a.stateId, 'the DS1-pinned history still answers its own instant');
    assert.equal(await k.stateRows(x.org, a.stateId), rows);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('O26 no inheritance: agent → agent version, asset → element, parent → child, object → relationship never confer a domain', async () => {
    const x = await k.setup();
    const [b, i] = [await k.domain(x, 'inh-b'), await k.domain(x, 'inh-i', 'INFORMATION_DOMAIN')];
    await k.assign(x, 'inh-agent', k.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN'), b);
    await k.assign(x, 'inh-asset-b', k.keyOf('DATA_ASSET', x.objects.asset, 'BUSINESS_DOMAIN'), b);
    await k.assign(x, 'inh-asset-i', k.keyOf('DATA_ASSET', x.objects.asset, 'INFORMATION_DOMAIN'), i);
    // An AGENT's BusinessDomain implies nothing for an AGENT_VERSION (illegal target, and no inherited row).
    assert.deepEqual(await k.current(x.org, 'AGENT_VERSION', x.objects.agentVersion), []);
    assert.equal(await k.resolve(x.org, k.keyOf('AGENT_VERSION' as never, x.objects.agentVersion, 'BUSINESS_DOMAIN'), now, now), null);
    // A DATA_ASSET's BusinessDomain / InformationDomain imply nothing for any DATA_ELEMENT.
    for (const element of [x.objects.element, x.objects.element2]) {
      assert.deepEqual(await k.current(x.org, 'DATA_ELEMENT', element), [], 'a data element without an explicit assignment is UNKNOWN');
      assert.equal(await k.resolve(x.org, k.keyOf('DATA_ELEMENT', element, 'INFORMATION_DOMAIN'), now, now), null);
      assert.equal(await k.resolve(x.org, k.keyOf('DATA_ELEMENT', element, 'BUSINESS_DOMAIN' as never), now, now), null);
    }
    // Parent → child: the asset's and the agent's siblings / children stay UNKNOWN (no lookup through any relationship).
    assert.deepEqual(await k.current(x.org, 'DATA_ASSET', x.objects.asset2), []);
    assert.deepEqual(await k.current(x.org, 'AGENT', x.objects.agent2), []);
    // Object → relationship: a relationship is never a business-context target and no resolver reads canonical_relationships.
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('inh-rel'), fingerprint: BOGUS_FINGERPRINT,
      proposal: { ...k.validateProposal(k.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN'), b), targetKind: 'READS_FROM' as never } })),
    'GV010', /BUSINESS_CONTEXT_TARGET_KIND_ILLEGAL/);
    assert.deepEqual(await k.current(x.org, 'READS_FROM', x.objects.agent), []);
    assert.equal(await one(`select count(*) from pg_proc where proname like 'l14\\_%business\\_context%' and prosrc ~ 'canonical_relationships'`), '0');
    assert.equal(await one(`select count(*) from pg_depend d join pg_proc p on p.oid=d.objid where d.classid='pg_proc'::regclass
      and p.proname like 'l14\\_%business\\_context%' and d.refobjid='gov_repo.canonical_relationships'::regclass`), '0');
    // A missing explicit assignment remains UNKNOWN even after an explicit one exists for the same agent's other kind.
    assert.equal(await k.resolve(x.org, k.keyOf('AGENT', x.objects.agent, 'INFORMATION_DOMAIN' as never), now, now), null);
  });

  await t.test('legacy / discovery boundary: legacy business_domain strings and scanner-style labels never become governed context', async () => {
    const x = await k.setup();
    const legacy = 'Financial Services';
    // A legacy agent row with a free-text business_domain exists in the same organisation (administrator support row).
    await owner(`insert into gov_repo.agents(agent_code,name,description,agent_type,owner_user_id,business_domain,organisation_id,created_by)
      values ('BC-LEGACY','Legacy agent','legacy','assistive','${x.member.id}',${lit(legacy)},'${x.org}','${x.member.id}')`);
    assert.deepEqual(await k.current(x.org, 'AGENT', x.objects.agent), [], 'no business context exists without a governed assignment');
    const before = await k.counts(x.org);
    for (const value of [legacy, 'Healthcare', 'Customer Support']) {
      await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd(`legacy-${value}`), proposal: {
        ...k.validateProposal(k.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN'), { subject: { subjectKind: 'BUSINESS_DOMAIN', domainId: value },
          stateId: randomUUID() }) } })), 'GV010', /DOMAIN_UNRESOLVED/);
    }
    assert.deepEqual(await k.counts(x.org), before);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('atomicity: an induced failure after the decision (at the fact detail INSERT / the head CAS) rolls the whole command back', async () => {
    for (const [name, table, timing] of [['fact', 'l14_business_context_assignment_states', 'before insert'],
      ['head', 'l14_business_context_assignment_heads', 'before update']] as const) {
      const x = await k.setup();
      const d = await k.domain(x, `atom-${name}`);
      await c.evidence(x.org, `atom-${name}-ev`);
      const key = k.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN');
      const proposal = k.validateProposal(key, d);
      const submitted = await k.submit(x, x.member, `atom-${name}-submit`, proposal);
      const commandId = x.cmd(`atom-${name}`);
      const sql = k.decideSql(x.bs, { commandId, proposalId: submitted.proposal_id, proposal, support: { status: 'PRESENT', evidenceIds: [`atom-${name}-ev`] } });
      const before = await k.counts(x.org);
      const history = await k.historyDigest(x.org);
      // Disposable-cluster-only failure injection: raises only once the governance decision of this command exists.
      await c.bootstrapSql(`create function public.s1c2_induced_failure() returns trigger language plpgsql
          set search_path = pg_catalog, pg_temp as $f$
          begin
            if not exists (select 1 from gov_repo.l14_governance_decisions d where d.organisation_id = new.organisation_id
                             and d.proposal_id = '${submitted.proposal_id}' and d.outcome = 'VALIDATE') then
              raise exception 'S1C2_INDUCED_FAILURE_WITHOUT_DECISION';
            end if;
            raise exception 'S1C2_INDUCED_FAILURE' using errcode = 'P0001';
          end $f$;
        create trigger zz_s1c2_induced_failure ${timing} on gov_repo.${table} for each row execute function public.s1c2_induced_failure();
        alter table gov_repo.${table} enable always trigger zz_s1c2_induced_failure;`);
      try {
        await assert.rejects(c.svc(sql), (error: Error) => {
          assert.match(error.message, /S1C2_INDUCED_FAILURE/);
          assert.doesNotMatch(error.message, /WITHOUT_DECISION/, 'the failure fired after the decision was written in the same transaction');
          return true;
        });
      } finally {
        await c.bootstrapSql(`drop trigger if exists zz_s1c2_induced_failure on gov_repo.${table}; drop function if exists public.s1c2_induced_failure();`);
      }
      assert.equal(await one(`select count(*) from pg_trigger where tgname='zz_s1c2_induced_failure'`), '0');
      assert.equal(await one(`select count(*) from gov_repo.l14_governance_decisions where proposal_id='${submitted.proposal_id}'`), '0', 'no decision');
      assert.equal(await one(`select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${x.org}' and command_id='${commandId}'`), '0',
        'no authorization');
      assert.equal(await one(`select count(*) from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${commandId}'`), '0',
        'the command is not consumed');
      assert.equal(await one(`select count(*) from gov_repo.l14_support_links where evidence_id='atom-${name}-ev'`), '0', 'no support link');
      assert.deepEqual(await k.counts(x.org), before, 'no fact envelope, typed state, head or any other L14 row');
      assert.equal(await k.historyDigest(x.org), history);
      const r = await exec(sql);
      assert.deepEqual([r.outcome, r.replay], ['VALIDATED', false], 'the very same command now succeeds (not a replay)');
      assert.equal(await one(`select count(*) from gov_repo.l14_support_links where owner_kind='FACT_STATE' and fact_state_id='${r.fact_state_id}'`), '1');
    }
  });
});
