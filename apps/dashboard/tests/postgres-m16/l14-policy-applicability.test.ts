import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { L14PolicyApplicabilityTarget } from '@council/canonical-contracts';
import { decidePolicyApplicabilityProposalFingerprint, policyVersionContentHash } from '@council/governance-review';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { lit } from '../helpers/m16-governed-write-fixtures';
import { ALL_KINDS, BOGUS_FINGERPRINT, policyApplicabilityKit, type PolicyPin } from '../helpers/m16-l14-policy-applicability-fixtures';

/**
 * M16-S1C.3 — POLICY_APPLICABILITY (the third authoritative M16 fact family) on real disposable PostgreSQL 17 (S1C3 horizon).
 * Every command goes through the real public RPCs as service_role; every policy / version through the real S1B.3 RPCs and
 * every POLICY_VERSION validation / revocation through the real S1B.4 RPCs; every Authority Policy through the real AP RPCs.
 * Owner access is used only to seed administrator support rows (canonical objects, canonical relationships, legacy policy
 * rows, evidence), to read evidence and for rolled-back structural probes.
 */
test('M16 S1C.3 policy applicability lifecycle (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C3' });
  t.after(() => c.stop());
  const { owner, exec, rejects } = c;
  const k = await policyApplicabilityKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const row = async (query: string) => JSON.parse(await one(`select coalesce((${query}), 'null'::json)`));
  const authz = (id: string) => row(`select to_json(a) from gov_repo.l14_authorization_decisions a where authorization_decision_id='${id}'`);
  const fact = (id: string) => row(`select to_json(s) from gov_repo.l14_fact_states s where fact_state_id='${id}'`);
  const detail = (id: string) => row(`select to_json(s) from gov_repo.l14_policy_applicability_states s where fact_state_id='${id}'`);
  const ts = (value: string) => `'${value}'::timestamptz`;
  const now = 'clock_timestamp()';

  await t.test('no automatic promotion: the migration created no fact / head / proposal / decision; legacy policy surfaces stay inert', async () => {
    for (const table of ['l14_policy_applicability_states', 'l14_policy_applicability_proposals', 'l14_policy_applicability_heads']) {
      assert.equal(await one(`select count(*) from gov_repo.${table}`), '0', table);
    }
    for (const table of ['l14_fact_states', 'l14_proposals', 'l14_governance_decisions', 'l14_authorization_decisions', 'l14_command_results']) {
      assert.equal(await one(`select count(*) from gov_repo.${table} where subject_kind='POLICY_APPLICABILITY'`), '0', table);
    }
    // The legacy mapping table / pointer exist only as non-authoritative legacy surfaces no S1C.3 routine reads.
    assert.equal(await one(`select (to_regclass('gov_repo.policy_mandate_mappings') is not null)::text`), 'true');
    assert.equal(await one(`select count(*) from pg_proc where (proname like 'l14\\_%policy\\_applicab%' or proname in
      ('l14_resolve_relationship_state_target_v1','l14_evaluate_relationship_state_authority_rules_v1','l14_lock_policy_version_dependency_guard_shared_v1'))
      and prosrc ~ '(policy_mandate_mappings|current_version_id|\\mstatus\\M|approved_by|content_markdown)'`), '0');
  });

  const ctx = await k.setup();
  const p1 = await k.policy(ctx, 'base');

  // ---------------------------------------------------------------------------------------
  await t.test('object targets: all 11 canonical kinds are structurally legal exact targets (proposal → authz → decision → fact → head → resolver)', async () => {
    for (const kind of ALL_KINDS) {
      const target = k.objectTarget(kind, ctx.objects.byKind[kind]);
      const before = await k.counts(ctx.org);
      const proposal = k.validateProposal(target, p1);
      const submitted = await k.submit(ctx, ctx.member, `obj-${kind}-submit`, proposal);
      assert.deepEqual([submitted.outcome, submitted.command_kind, submitted.subject_kind, submitted.authorization_decision_id,
        submitted.governance_decision_id, submitted.fact_state_id, submitted.target_type, submitted.target_canonical_kind,
        submitted.target_canonical_object_id, submitted.target_relationship_id, submitted.policy_id, submitted.version_id,
        submitted.content_hash, submitted.policy_version_validated_state_id, submitted.applicability],
      ['SUBMITTED', 'SUBMIT_PROPOSAL', 'POLICY_APPLICABILITY', null, null, null, 'CANONICAL_OBJECT', kind, ctx.objects.byKind[kind], null,
        p1.subject.policyId, p1.subject.versionId, p1.subject.contentHash, p1.stateId, 'APPLIES'], kind);
      const afterSubmit = await k.counts(ctx.org);
      assert.deepEqual([afterSubmit.l14_authorization_decisions, afterSubmit.l14_governance_decisions, afterSubmit.l14_fact_states,
        afterSubmit.l14_policy_applicability_heads], [before.l14_authorization_decisions, before.l14_governance_decisions,
        before.l14_fact_states, before.l14_policy_applicability_heads], `${kind}: submission creates no authorization / decision / fact / head`);
      const decided = await k.decide(ctx, ctx.ps, `obj-${kind}-validate`, submitted, proposal);
      assert.deepEqual([decided.outcome, decided.state_kind, decided.predecessor_state_id, decided.applicability], ['VALIDATED', 'VALIDATED', null, 'APPLIES'], kind);
      const a = await authz(decided.authorization_decision_id);
      assert.deepEqual([a.scope_tag, a.target_canonical_kind, a.target_canonical_object_id, a.target_relationship_type, a.result, a.requested_action,
        a.subject_kind], ['CANONICAL_OBJECT', kind, ctx.objects.byKind[kind], null, 'ALLOW', 'VALIDATE', 'POLICY_APPLICABILITY'], kind);
      assert.equal(await k.head(ctx.org, target, p1.subject.policyId), decided.fact_state_id, kind);
      assert.equal(await k.resolve(ctx.org, target, p1.subject.policyId, now, now), decided.fact_state_id, kind);
      assert.deepEqual(await k.current(ctx.org, target), [`${p1.subject.policyId}|${p1.subject.versionId}|APPLIES|${decided.fact_state_id}`], kind);
    }
    assert.equal(await one(`select count(distinct target_canonical_kind) from gov_repo.l14_policy_applicability_states where organisation_id='${ctx.org}'`), '11');
  });

  await t.test('exact object identity: wrong tenant, wrong declared kind, missing object, a name instead of an id, a foreign object reject', async () => {
    const other = await k.setup();
    const before = await k.counts(ctx.org);
    const cases: Array<[string, L14PolicyApplicabilityTarget]> = [
      ['wrong declared kind', k.objectTarget('MODEL', ctx.objects.byKind.AGENT)],
      ['missing object', k.objectTarget('AGENT', 'canonical-object:does-not-exist')],
      ['name instead of id', k.objectTarget('AGENT', 'Customer Support Agent')],
      ['foreign object', k.objectTarget('AGENT', other.objects.byKind.AGENT)],
    ];
    for (const [name, target] of cases) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`objneg-${name}`), proposal: k.validateProposal(target, p1) })), 'GV010',
        /TARGET_OBJECT_UNRESOLVED/);
    }
    // Wrong tenant: the verified principal's organisation is the only tenant (a session claiming another organisation fails).
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('objneg-tenant'), session: { org: other.org },
      proposal: k.validateProposal(k.objectTarget('AGENT', ctx.objects.byKind.AGENT), p1) })), 'GV00[0-9]');
    // Unknown kind / malformed id.
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('objneg-kind'), fingerprint: BOGUS_FINGERPRINT,
      proposal: k.validateProposal(k.objectTarget('AGENT', ctx.objects.byKind.AGENT), p1), raw: { kind: 'BUSINESS_DOMAIN' } })), 'GV010',
    /TARGET_CANONICAL_KIND_UNKNOWN/);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('objneg-ws'), fingerprint: BOGUS_FINGERPRINT,
      proposal: k.validateProposal(k.objectTarget('AGENT', ctx.objects.byKind.AGENT), p1), raw: { objectId: ` ${ctx.objects.byKind.AGENT}` } })), 'GV010',
    /TARGET_OBJECT_ID_MALFORMED/);
    assert.deepEqual(await k.counts(ctx.org), before, 'nothing was written');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('relationship-state targets: the exact triple resolves; every partial / foreign / mismatched / hybrid shape rejects', async () => {
    const x = await k.setup();
    const pin = await k.policy(x, 'rel');
    const other = await k.setup();
    const reads = k.relTarget(x.rels.reads);
    // Exact valid triple → usable target, authorized as RELATIONSHIP_STATE with the DB-resolved type.
    const ok = await k.apply(x, 'rel-ok', reads, pin);
    assert.deepEqual([ok.decided.outcome, ok.decided.target_type, ok.decided.target_relationship_id, ok.decided.target_relationship_state_id,
      ok.decided.target_canonical_kind], ['VALIDATED', 'RELATIONSHIP_STATE', x.rels.reads.relationshipId, x.rels.reads.relationshipStateId, null]);
    const a = await authz(ok.decided.authorization_decision_id);
    assert.deepEqual([a.scope_tag, a.target_relationship_type, a.target_relationship_id, a.target_relationship_state_id, a.target_canonical_kind,
      a.target_canonical_object_id], ['RELATIONSHIP_STATE', 'READS_FROM', x.rels.reads.relationshipId, x.rels.reads.relationshipStateId, null, null]);
    assert.equal(await k.resolve(x.org, reads, pin.subject.policyId, now, now), ok.stateId);
    const before = await k.counts(x.org);
    const submitRel = (name: string, relationshipId: string, relationshipStateId: string) => c.svc(k.submitSql(x.member, { commandId: x.cmd(name),
      proposal: k.validateProposal(k.relTarget({ relationshipId, relationshipStateId }), pin) }));
    await rejects(submitRel('rel-wrong-org', other.rels.reads.relationshipId, other.rels.reads.relationshipStateId), 'GV010', /TARGET_RELATIONSHIP_STATE_UNRESOLVED/);
    await rejects(submitRel('rel-wrong-id', `${x.rels.reads.relationshipId}-x`, x.rels.reads.relationshipStateId), 'GV010', /TARGET_RELATIONSHIP_STATE_UNRESOLVED/);
    await rejects(submitRel('rel-wrong-state', x.rels.reads.relationshipId, x.rels.exposes.relationshipStateId), 'GV010', /TARGET_RELATIONSHIP_STATE_UNRESOLVED/);
    await rejects(submitRel('rel-successor-state', x.rels.reads.relationshipId, `${x.rels.reads.relationshipId}:v2`), 'GV010',
      /TARGET_RELATIONSHIP_STATE_UNRESOLVED/);
    // A bare state id (no relationship id) and a relationship id without a state are impossible shapes.
    const base = k.validateProposal(reads, pin);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rel-bare-state'), fingerprint: BOGUS_FINGERPRINT, proposal: base,
      raw: { relationshipId: null } })), 'GV010', /TARGET_RELATIONSHIP_ID_MALFORMED/);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rel-no-state'), fingerprint: BOGUS_FINGERPRINT, proposal: base,
      raw: { relationshipStateId: null } })), 'GV010', /TARGET_RELATIONSHIP_STATE_ID_MALFORMED/);
    // Hybrid shapes (object operands on a relationship target / relationship operands on an object target) and unknown types.
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rel-hybrid-1'), fingerprint: BOGUS_FINGERPRINT, proposal: base,
      raw: { kind: 'TOOL', objectId: x.objects.byKind.TOOL } })), 'GV010', /POLICY_APPLICABILITY_TARGET_UNION_INVALID/);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rel-hybrid-2'), fingerprint: BOGUS_FINGERPRINT,
      proposal: k.validateProposal(k.objectTarget('TOOL', x.objects.byKind.TOOL), pin), raw: { relationshipId: x.rels.reads.relationshipId } })),
    'GV010', /POLICY_APPLICABILITY_TARGET_UNION_INVALID/);
    for (const targetType of ['RELATIONSHIP', 'RELATIONSHIP_TYPE', 'POLICY', null]) {
      await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd(`rel-type-${targetType}`), fingerprint: BOGUS_FINGERPRINT, proposal: base,
        raw: { targetType } })), 'GV010', /POLICY_APPLICABILITY_TARGET_TYPE_UNKNOWN/);
    }
    assert.deepEqual(await k.counts(x.org), before, 'nothing was written');
    // The structural CHECK backs the RPC: a hybrid row is impossible even for the owner (rolled back).
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
      insert into gov_repo.l14_policy_applicability_heads(organisation_id,target_type,target_canonical_kind,target_canonical_object_id,
        target_relationship_id,target_relationship_state_id,policy_id)
      values ('${x.org}','RELATIONSHIP_STATE','TOOL',${lit(x.objects.byKind.TOOL)},${lit(x.rels.reads.relationshipId)},
        ${lit(x.rels.reads.relationshipStateId)},'${pin.subject.policyId}'); rollback;`), /target_union_check|null value in column "target_key"/);
  });

  await t.test('relationship-state read boundary: no rollup to the relationship id, no roll-forward, no endpoint inheritance, no type inference', async () => {
    const x = await k.setup();
    const pin = await k.policy(x, 'rb');
    const reads = k.relTarget(x.rels.reads);
    const r = await k.apply(x, 'rb', reads, pin);
    assert.equal(await k.outcome(x.org, reads, pin.subject.policyId), 'APPLIES');
    // Another relationship state (even of another relationship of the same / another type) is UNKNOWN.
    assert.equal(await k.outcome(x.org, k.relTarget(x.rels.exposes), pin.subject.policyId), 'UNKNOWN');
    assert.equal(await k.outcome(x.org, k.relTarget({ relationshipId: x.rels.reads.relationshipId, relationshipStateId: `${x.rels.reads.relationshipId}:v2` }),
      pin.subject.policyId), 'UNKNOWN', 'no roll-forward to a later state of the relationship');
    assert.deepEqual(await k.current(x.org, k.relTarget(x.rels.exposes)), []);
    // Endpoints (AGENT → DATA_ASSET) never inherit from the relationship state, and vice versa.
    assert.deepEqual(await k.current(x.org, k.objectTarget('AGENT', x.objects.byKind.AGENT)), []);
    assert.deepEqual(await k.current(x.org, k.objectTarget('DATA_ASSET', x.objects.byKind.DATA_ASSET)), []);
    const objPin = await k.apply(x, 'rb-obj', k.objectTarget('MCP_SERVER', x.objects.byKind.MCP_SERVER), pin);
    assert.equal(objPin.decided.outcome, 'VALIDATED');
    assert.equal(await k.outcome(x.org, k.relTarget(x.rels.exposes), pin.subject.policyId), 'UNKNOWN', 'an endpoint applicability never flows to its relationship');
    // A relationship-id-only read is impossible: the resolver requires the exact triple (missing state → no key → UNKNOWN).
    assert.equal(await one(`select count(*) from gov_repo.l14_policy_applicability_valid_state_v1('${x.org}', 'RELATIONSHIP_STATE', null, null,
      ${lit(x.rels.reads.relationshipId)}, null, '${pin.subject.policyId}', clock_timestamp(), clock_timestamp())`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_policy_applicabilities_current_v1('${x.org}', 'RELATIONSHIP_STATE', null, null, null,
      ${lit(x.rels.reads.relationshipStateId)}, clock_timestamp(), clock_timestamp())`), '0', 'no bare-state-id read');
    assert.equal(r.decided.outcome, 'VALIDATED');
  });

  await t.test('ambiguous exact relationship-state lookup fails closed (disposable sabotage: the PK of the F2 table dropped inside a rolled-back txn)', async () => {
    const x = await k.setup();
    const pin = await k.policy(x, 'amb');
    const reads = k.relTarget(x.rels.reads);
    const proposal = k.validateProposal(reads, pin);
    const submitted = await k.submit(x, x.member, 'amb-submit', proposal);
    const dup = `alter table gov_repo.canonical_relationships drop constraint canonical_relationships_pkey cascade;
      alter table gov_repo.canonical_relationships drop constraint canonical_relationships_organisation_id_unique cascade;
      insert into gov_repo.canonical_relationships(relationship_id,organisation_id,relationship_state_id,relationship_type,source_canonical_object_id,
        source_kind,target_canonical_object_id,target_kind,valid_from,valid_to,recorded_at,created_by_decision_id)
      select relationship_id,organisation_id,relationship_state_id,relationship_type,source_canonical_object_id,source_kind,target_canonical_object_id,
        target_kind,valid_from,now(),recorded_at,created_by_decision_id from gov_repo.canonical_relationships
      where organisation_id='${x.org}' and relationship_id=${lit(x.rels.reads.relationshipId)};`;
    const decide = k.decideSql(x.ps, { commandId: x.cmd('amb-decide'), proposalId: submitted.proposal_id, proposal });
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres; ${dup} set local role service_role; ${decide} rollback;`),
      /GV010[\s\S]*TARGET_RELATIONSHIP_STATE_AMBIGUOUS/);
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres; ${dup} set local role service_role;
      ${k.submitSql(x.member, { commandId: x.cmd('amb-submit-2'), proposal })} rollback;`), /GV010[\s\S]*TARGET_RELATIONSHIP_STATE_AMBIGUOUS/);
    // After the rollback the production catalog and the target are intact, and the same decision now succeeds.
    assert.equal(await one(`select count(*) from pg_constraint where conname='canonical_relationships_pkey'`), '1');
    const r = await exec(decide);
    assert.equal(r.outcome, 'VALIDATED');
    // A validated fact on a target that later becomes ambiguous resolves UNKNOWN (rolled back).
    assert.equal(await c.bootstrapSql(`begin; set local role postgres; ${dup}
      select count(*) from gov_repo.l14_policy_applicability_valid_state_v1('${x.org}', ${k.targetOperands(reads).join(',')}, '${pin.subject.policyId}',
        clock_timestamp(), clock_timestamp()); rollback;`), '0');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('policy dependency: unadmitted / legacy-only / unvalidated / revoked / foreign / wrong ids / wrong hash / wrong state fail closed', async () => {
    const x = await k.setup();
    const pin = await k.policy(x, 'dep');
    const v2 = await k.nextVersion(x, 'dep-v2', pin);
    const otherPolicy = await k.policy(x, 'dep-other');
    const foreign = await k.setup();
    const foreignPin = await k.policy(foreign, 'dep-foreign');
    const target = k.objectTarget('AGENT', x.objects.byKind.AGENT);
    const legacy = await k.pvk.pk.legacyPolicy(x.org, x.member.id, `${x.label}-legacy`);
    const unvalidated = await k.admittedOnly(x, 'dep-unval');
    const submitWith = (name: string, dep: Partial<PolicyPin['subject']> & { stateId?: string }) => c.svc(k.submitSql(x.member, {
      commandId: x.cmd(name), proposal: k.validateProposal(target, { subject: { ...pin.subject, ...dep }, stateId: dep.stateId ?? pin.stateId }) }));
    const before = await k.counts(x.org);
    await rejects(submitWith('dep-legacy', { policyId: legacy.policyId, versionId: legacy.versionId! }), 'GV010', /POLICY_UNRESOLVED/);
    await rejects(submitWith('dep-unadmitted-policy', { policyId: randomUUID() }), 'GV010', /POLICY_UNRESOLVED/);
    await rejects(submitWith('dep-foreign', { ...foreignPin.subject, stateId: foreignPin.stateId }), 'GV010', /POLICY_UNRESOLVED/);
    await rejects(submitWith('dep-wrong-policy', { policyId: otherPolicy.subject.policyId }), 'GV010', /POLICY_VERSION_UNRESOLVED/);
    await rejects(submitWith('dep-wrong-version', { versionId: randomUUID() }), 'GV010', /POLICY_VERSION_UNRESOLVED/);
    await rejects(submitWith('dep-unvalidated', { ...unvalidated, stateId: randomUUID() }), 'GV010', /POLICY_VERSION_DEPENDENCY_UNRESOLVED/);
    await rejects(submitWith('dep-wrong-state', { stateId: v2.stateId }), 'GV010', /POLICY_VERSION_DEPENDENCY_UNRESOLVED/);
    await rejects(submitWith('dep-other-policy-state', { stateId: otherPolicy.stateId }), 'GV010', /POLICY_VERSION_DEPENDENCY_UNRESOLVED/);
    await rejects(submitWith('dep-foreign-state', { stateId: foreignPin.stateId }), 'GV010', /POLICY_VERSION_DEPENDENCY_UNRESOLVED/);
    assert.deepEqual(await k.counts(x.org), before, 'nothing was written');
    // A revoked version: the proposal pins a genuinely VALIDATED state, but the decision fails closed (nothing consumed).
    const rv = await k.policy(x, 'dep-rv');
    const p = k.validateProposal(target, rv);
    const s = await k.submit(x, x.member, 'dep-rv-submit', p);
    await k.revokePolicyVersion(x, 'dep-rv', rv);
    const mid = await k.counts(x.org);
    await rejects(c.svc(k.decideSql(x.ps, { commandId: x.cmd('dep-rv-decide'), proposalId: s.proposal_id, proposal: p })), 'GV010',
      /POLICY_VERSION_DEPENDENCY_NOT_VALID/);
    assert.deepEqual(await k.counts(x.org), mid, 'a revoked dependency consumes nothing');
    // A future-effective version is not yet valid for an immediate applicability.
    const future = await k.policy(x, 'dep-future', await k.instant('+2 hours'));
    const fp = k.validateProposal(k.objectTarget('MODEL', x.objects.byKind.MODEL), future);
    const fs = await k.submit(x, x.member, 'dep-future-submit', fp);
    await rejects(c.svc(k.decideSql(x.ps, { commandId: x.cmd('dep-future-decide'), proposalId: fs.proposal_id, proposal: fp })), 'GV010',
      /POLICY_VERSION_DEPENDENCY_NOT_VALID/);
    // The legacy current_version_id pointer is never authority: pointing it at V2 changes nothing about a V1 applicability.
    const v1fact = await k.apply(x, 'dep-ptr', k.objectTarget('TOOL', x.objects.byKind.TOOL), pin);
    assert.equal(await k.resolve(x.org, k.objectTarget('TOOL', x.objects.byKind.TOOL), pin.subject.policyId, now, now), v1fact.stateId);
    assert.equal((await detail(v1fact.stateId)).version_id, pin.subject.versionId);
  });

  await t.test('O29 exact DB-verified hash tuple: A-G', async () => {
    const x = await k.setup();
    const pin = await k.policy(x, 'o29');
    const v2 = await k.nextVersion(x, 'o29-v2', pin);
    const other = await k.policy(x, 'o29-other');
    const foreign = await k.setup();
    const foreignPin = await k.policy(foreign, 'o29-foreign');
    const target = k.objectTarget('PROMPT', x.objects.byKind.PROMPT);
    const tryHash = (name: string, contentHash: string, subject = pin.subject) => c.svc(k.submitSql(x.member, { commandId: x.cmd(name),
      proposal: k.validateProposal(target, { subject: { ...subject, contentHash }, stateId: pin.stateId }) }));
    const flip = (h: string) => h.slice(0, 10) + (h[10] === 'a' ? 'b' : 'a') + h.slice(11);
    const before = await k.counts(x.org);
    // B. same policy / version, one nibble changed.
    await rejects(tryHash('o29-b', flip(pin.subject.contentHash)), 'GV010', /POLICY_VERSION_UNRESOLVED/);
    // C. a valid hash belonging to another version of the same policy.
    await rejects(tryHash('o29-c', v2.subject.contentHash), 'GV010', /POLICY_VERSION_UNRESOLVED/);
    // D. a valid hash belonging to another policy.
    await rejects(tryHash('o29-d', other.subject.contentHash), 'GV010', /POLICY_VERSION_UNRESOLVED/);
    // E. a foreign-tenant tuple (policy, version, hash, state).
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('o29-e'), proposal: k.validateProposal(target, foreignPin) })), 'GV010', /POLICY_UNRESOLVED/);
    // F. knowing a valid-looking SHA-256 grants nothing (the genuine hash of other content, a random digest, uppercase hex).
    await rejects(tryHash('o29-f1', policyVersionContentHash('# forged policy content')), 'GV010', /POLICY_VERSION_UNRESOLVED/);
    await rejects(tryHash('o29-f2', randomUUID().replace(/-/g, '').repeat(2)), 'GV010', /POLICY_VERSION_UNRESOLVED/);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('o29-f3'), fingerprint: BOGUS_FINGERPRINT, proposal: k.validateProposal(target, pin),
      raw: { contentHash: pin.subject.contentHash.toUpperCase() } })), 'GV010', /CONTENT_HASH_MALFORMED/);
    assert.deepEqual(await k.counts(x.org), before, 'none of B-F wrote anything');
    // A. the exact DB-verified tuple passes …
    const ok = await k.apply(x, 'o29-a', target, pin);
    assert.equal(ok.decided.outcome, 'VALIDATED');
    // G. … and the state stores exactly the DB-resolved immutable tuple (the hardened store row's hash, the admission lineage's
    //    hash and the S1B.4 validated state's hash are all the same value).
    const stored = await detail(ok.stateId);
    const db = await row(`select json_build_object('store', pv.content_hash::text, 'admission', va.content_hash::text, 'state', ps.content_hash::text)
      from gov_repo.policy_versions pv join gov_repo.l14_policy_version_admissions va on va.organisation_id=pv.organisation_id and va.version_id=pv.version_id
      join gov_repo.l14_policy_version_states ps on ps.organisation_id=pv.organisation_id and ps.state_id='${pin.stateId}'
      where pv.organisation_id='${x.org}' and pv.version_id='${pin.subject.versionId}'`);
    assert.deepEqual([stored.policy_id, stored.version_id, stored.content_hash, stored.policy_version_validated_state_id],
      [pin.subject.policyId, pin.subject.versionId, pin.subject.contentHash, pin.stateId]);
    assert.deepEqual([db.store, db.admission, db.state], [stored.content_hash, stored.content_hash, stored.content_hash]);
    // Even the owner cannot store a swapped hash: the composite FK onto the S1B.4 state rejects it (rolled back).
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
      insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values ('${x.org}','00000000-0000-4000-8000-000000000029','POLICY_APPLICABILITY','VALIDATE','LOCAL_HUMAN','${x.member.id}','NONE',now());
      insert into gov_repo.l14_policy_applicability_proposals(organisation_id,proposal_id,intent,target_type,target_canonical_kind,target_canonical_object_id,
        policy_id,version_id,content_hash,policy_version_validated_state_id,applicability)
        values ('${x.org}','00000000-0000-4000-8000-000000000029','VALIDATE','CANONICAL_OBJECT','PROMPT',${lit(x.objects.byKind.PROMPT)},
          '${pin.subject.policyId}','${pin.subject.versionId}','${v2.subject.contentHash}','${pin.stateId}','APPLIES'); rollback;`),
    /policy_version_fkey/);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('source boundary: SYSTEM_SEED / SOURCE_CONNECTION / scanner / LLM never masquerade as LOCAL_HUMAN; the structural guard backs the RPC', async () => {
    const target = k.objectTarget('API', ctx.objects.byKind.API);
    for (const sourceClass of ['SYSTEM_SEED', 'SOURCE_CONNECTION'] as const) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`src-${sourceClass}`), fingerprint: BOGUS_FINGERPRINT,
        proposal: { ...k.validateProposal(target, p1), sourceClass } })), 'GV010', /SOURCE_CLASS_NOT_EXECUTABLE/);
    }
    for (const sourceClass of ['SCANNER', 'LLM', 'MAPPING']) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`src-${sourceClass}`), fingerprint: BOGUS_FINGERPRINT,
        proposal: { ...k.validateProposal(target, p1), sourceClass: sourceClass as never } })), 'GV010', /PROPOSAL_VOCABULARY_UNKNOWN/);
    }
    for (const applicability of ['UNKNOWN', 'PARTIAL', 'CONDITIONAL', 'WAIVED', 'EXEMPT', 'NOT_APPLICABLE', 'DEFAULT', 'INHERITED', null]) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`outcome-${applicability}`), fingerprint: BOGUS_FINGERPRINT,
        proposal: k.validateProposal(target, p1), raw: { applicability } })), 'GV010', /POLICY_APPLICABILITY_OUTCOME_UNKNOWN/);
    }
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
      insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values ('${ctx.org}','00000000-0000-4000-8000-000000000001','POLICY_APPLICABILITY','VALIDATE','SOURCE_CONNECTION','${ctx.member.id}','NONE',now());
      insert into gov_repo.l14_policy_applicability_proposals(organisation_id,proposal_id,intent,target_type,target_canonical_kind,target_canonical_object_id,
        policy_id,version_id,content_hash,policy_version_validated_state_id,applicability)
        values ('${ctx.org}','00000000-0000-4000-8000-000000000001','VALIDATE','CANONICAL_OBJECT','API',${lit(ctx.objects.byKind.API)},
          '${p1.subject.policyId}','${p1.subject.versionId}','${p1.subject.contentHash}','${p1.stateId}','APPLIES');
      rollback;`), /POLICY_APPLICABILITY_PROPOSAL_SOURCE_INVALID/);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('authority: L14_POLICY_APPLICABILITY_VALIDATE over the exact typed target scope (object AND relationship-state union); durable DENY', async () => {
    const x = await k.setup();
    const pin = await k.policy(x, 'auth');
    const deny = async (name: string, actor: typeof x.ps, target: L14PolicyApplicabilityTarget, reason: string, options: { from?: string | null; self?: boolean } = {}) => {
      const proposal = k.validateProposal(target, pin, 'APPLIES', options.from ?? null);
      const submitted = await k.submit(x, options.self ? actor : x.member, `${name}-submit`, proposal);
      const r = await exec(k.decideSql(actor, { commandId: x.cmd(`${name}-decide`), proposalId: submitted.proposal_id, proposal }));
      assert.deepEqual([r.outcome, r.authorization_result, r.deny_reason, r.governance_decision_id, r.fact_state_id], ['DENIED', 'DENY', reason, null, null], name);
      const a = await authz(r.authorization_decision_id);
      assert.equal(a.scope_tag, target.targetType, name);
      const again = await exec(k.decideSql(actor, { commandId: x.cmd(`${name}-decide`), proposalId: submitted.proposal_id, proposal }));
      assert.deepEqual([again.replay, again.outcome, again.authorization_decision_id, again.recorded_at], [true, 'DENIED', r.authorization_decision_id, r.recorded_at]);
      assert.equal(await k.head(x.org, target, pin.subject.policyId), null, 'a DENY creates no head');
    };
    const agent = k.objectTarget('AGENT', x.objects.byKind.AGENT);
    const asset = k.objectTarget('DATA_ASSET', x.objects.byKind.DATA_ASSET);
    const asset2 = k.objectTarget('DATA_ASSET', x.objects.asset2);
    const exposes = k.relTarget(x.rels.exposes);
    const reads = k.relTarget(x.rels.reads);
    await deny('member', x.member2, agent, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('pv-validator', x.validator, agent, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('responsibility-steward', x.presp, agent, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('ap-admin', x.boot, agent, 'NO_MATCHING_AUTHORITY_RULE');
    await deny('contributor', x.pcontrib, agent, 'SOURCE_NOT_AUTHORIZED');
    await deny('kind-scope-mismatch', x.pkind, asset, 'SCOPE_NOT_AUTHORIZED');
    await deny('object-scope-mismatch', x.pobject, asset2, 'SCOPE_NOT_AUTHORIZED');
    // Object-only scopes never authorize a relationship-state target, and relationship scopes never authorize an object.
    await deny('canonical-kind-on-relationship', x.pkind, reads, 'SCOPE_NOT_AUTHORIZED');
    await deny('canonical-object-on-relationship', x.pobject, reads, 'SCOPE_NOT_AUTHORIZED');
    await deny('relationship-type-on-object', x.preltype, k.objectTarget('MCP_SERVER', x.objects.byKind.MCP_SERVER), 'SCOPE_NOT_AUTHORIZED');
    await deny('relationship-state-on-object', x.prelstate, asset, 'SCOPE_NOT_AUTHORIZED');
    // Relationship-type scope matches only the DB-resolved type of the exact state; relationship-state scope only the exact triple.
    await deny('relationship-type-mismatch', x.preltype, reads, 'SCOPE_NOT_AUTHORIZED');
    await deny('relationship-state-mismatch', x.prelstate, exposes, 'SCOPE_NOT_AUTHORIZED');
    await deny('self-validation', x.ps, agent, 'SELF_VALIDATION_NOT_PERMITTED', { self: true });
    await deny('self-validation-rel-other-scope', x.pselfrel, reads, 'SCOPE_NOT_AUTHORIZED', { self: true });
    await deny('backdated', x.ps, agent, 'TEMPORAL_ACTION_NOT_AUTHORIZED', { from: await k.instant('-1 minute') });
    await deny('future-dated', x.ps, agent, 'TEMPORAL_ACTION_NOT_AUTHORIZED', { from: await k.instant('+1 hour') });
    const rulesOf = (id: string) => one(`select string_agg(scope_tag||'/'||coalesce(scope_canonical_kind,scope_relationship_type,scope_relationship_state_id,'-'), ',')
      from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${id}'`);
    const byKind = await k.apply(x, 'kind-ok', agent, pin, { validator: x.pkind });
    assert.equal(await rulesOf(byKind.decided.authorization_decision_id), 'CANONICAL_KIND/AGENT');
    const byObject = await k.apply(x, 'object-ok', asset, pin, { validator: x.pobject });
    assert.equal(byObject.decided.outcome, 'VALIDATED');
    const byType = await k.apply(x, 'type-ok', exposes, pin, { validator: x.preltype });
    assert.equal(await rulesOf(byType.decided.authorization_decision_id), 'RELATIONSHIP_TYPE/EXPOSES');
    const byState = await k.apply(x, 'state-ok', reads, pin, { validator: x.prelstate });
    assert.equal(await rulesOf(byState.decided.authorization_decision_id), `RELATIONSHIP_STATE/${x.rels.reads.relationshipStateId}`);
    // Relationship-type scope is authorization scope only: it confers no applicability on any other state of that type.
    assert.equal(await k.outcome(x.org, reads, pin.subject.policyId), 'APPLIES');
    // Self-validation only where the effective policy explicitly allows it for the exact action + target scope.
    const self = await (async () => {
      const p2 = await k.policy(x, 'auth-self');
      const proposal = k.validateProposal(exposes, p2);
      const submitted = await k.submit(x, x.pselfrel, 'self-rel-submit', proposal);
      return k.decide(x, x.pselfrel, 'self-rel', submitted, proposal);
    })();
    assert.deepEqual([self.outcome, (await authz(self.authorization_decision_id)).is_self_validation], ['VALIDATED', true]);
    // Authority changes: a NEW command after losing the role is denied; the old DENY command id never becomes ALLOW.
    const lost = k.objectTarget('AGENT', x.objects.agent2);
    const lp = k.validateProposal(lost, pin);
    const ls = await k.submit(x, x.member, 'lost-submit', lp);
    await owner(`update gov_repo.governance_users set role_ids='{}'::uuid[] where user_id='${x.ps2.id}'`);
    const lr = await exec(k.decideSql(x.ps2, { commandId: x.cmd('lost-decide'), proposalId: ls.proposal_id, proposal: lp }));
    assert.deepEqual([lr.outcome, lr.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    await owner(`update gov_repo.governance_users set role_ids=array['${k.stewardRole}']::uuid[] where user_id='${x.ps2.id}'`);
    assert.deepEqual([(await exec(k.decideSql(x.ps2, { commandId: x.cmd('lost-decide'), proposalId: ls.proposal_id, proposal: lp }))).replay], [true]);
    assert.equal((await exec(k.decideSql(x.ps2, { commandId: x.cmd('lost-decide-2'), proposalId: ls.proposal_id, proposal: lp }))).outcome, 'VALIDATED');
  });

  await t.test('requested action = exact outcome; closed reason codes; terminality; DEFER non-terminal; correction = new linked proposal; REVOKE pins', async () => {
    const x = await k.setup();
    const pin = await k.policy(x, 'term');
    const target = k.objectTarget('KNOWLEDGE_BASE', x.objects.byKind.KNOWLEDGE_BASE);
    const proposal = k.validateProposal(target, pin);
    const submitted = await k.submit(x, x.member, 'term-submit', proposal);
    const sql = (name: string, outcome: 'VALIDATE' | 'REJECT' | 'DEFER' | 'REVOKE', reasonCode?: string) =>
      k.decideSql(x.ps, { commandId: x.cmd(name), proposalId: submitted.proposal_id, proposal, outcome, reasonCode,
        fingerprint: reasonCode ? BOGUS_FINGERPRINT : undefined });
    for (const reason of ['POLICY_APPLICABILITY_REJECTED', 'It clearly applies', 'POLICY_VERSION_VALIDATED', 'BUSINESS_CONTEXT_ASSIGNMENT_VALIDATED']) {
      await rejects(c.svc(sql(`term-reason-${reason.length}`, 'VALIDATE', reason)), 'GV010', /DECISION_VOCABULARY_INVALID/);
    }
    await rejects(c.svc(sql('term-revoke-on-validate', 'REVOKE')), 'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    assert.deepEqual([(await exec(sql('term-defer', 'DEFER'))).outcome, (await exec(sql('term-defer-2', 'DEFER'))).outcome], ['DEFERRED', 'DEFERRED'],
      'DEFER is non-terminal');
    const validated = await exec(sql('term-validate', 'VALIDATE'));
    assert.equal(validated.outcome, 'VALIDATED');
    await rejects(c.svc(k.decideSql(x.ps, { commandId: x.cmd('term-after'), proposalId: submitted.proposal_id, proposal, outcome: 'REJECT',
      expected: validated.fact_state_id })), 'GV010', /PROPOSAL_TERMINAL/);
    // REJECT is terminal; correction = NEW proposal linked to the prior one (same key).
    const t2 = k.objectTarget('SKILL', x.objects.byKind.SKILL);
    const p2 = k.validateProposal(t2, pin, 'DOES_NOT_APPLY');
    const s2 = await k.submit(x, x.member, 'rej-submit', p2);
    const rejected = await exec(k.decideSql(x.ps, { commandId: x.cmd('rej'), proposalId: s2.proposal_id, proposal: p2, outcome: 'REJECT' }));
    assert.deepEqual([rejected.outcome, rejected.fact_state_id, await k.head(x.org, t2, pin.subject.policyId)], ['REJECTED', null, null]);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rej-bad-prior'), proposal: p2, prior: submitted.proposal_id })), 'GV010',
      /PRIOR_PROPOSAL_UNRESOLVED/);
    const corrected = await k.submit(x, x.member, 'rej-correction', p2, s2.proposal_id);
    assert.equal(await one(`select prior_proposal_id from gov_repo.l14_proposals where proposal_id='${corrected.proposal_id}'`), s2.proposal_id);
    assert.equal((await k.decide(x, x.ps, 'rej-correction-validate', corrected, p2)).outcome, 'VALIDATED');
    // REVOKE pins the exact current VALIDATED state + tuple + dependency + outcome.
    const v2 = await k.nextVersion(x, 'term-v2', pin);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-tuple'), proposal: k.revokeProposal(target, v2, validated.fact_state_id) })),
      'GV010', /POLICY_APPLICABILITY_TARGET_STATE_MISMATCH/);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-outcome'), proposal: k.revokeProposal(target, pin, validated.fact_state_id, 'DOES_NOT_APPLY') })),
      'GV010', /POLICY_APPLICABILITY_TARGET_STATE_MISMATCH/);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-other-key'), proposal: k.revokeProposal(t2, pin, validated.fact_state_id) })),
      'GV010', /TARGET_STATE_UNRESOLVED/);
    const rp = k.revokeProposal(target, pin, validated.fact_state_id);
    const rs = await k.submit(x, x.member, 'rv-submit', rp);
    await rejects(c.svc(k.decideSql(x.ps, { commandId: x.cmd('rv-validate'), proposalId: rs.proposal_id, proposal: rp, outcome: 'VALIDATE',
      expected: validated.fact_state_id })), 'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    const revoked = await exec(k.decideSql(x.ps, { commandId: x.cmd('rv-revoke'), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE',
      expected: validated.fact_state_id }));
    const f = await fact(revoked.fact_state_id);
    assert.deepEqual([revoked.outcome, f.revokes_state_id, f.predecessor_state_id, f.effective_to], ['REVOKED', validated.fact_state_id, validated.fact_state_id, null]);
    assert.equal(await one(`select reason_code from gov_repo.l14_governance_decisions where governance_decision_id='${revoked.governance_decision_id}'`),
      'POLICY_APPLICABILITY_REVOKED');
    assert.equal(await k.outcome(x.org, target, pin.subject.policyId), 'UNKNOWN', 'a revoked key is UNKNOWN (never DOES_NOT_APPLY)');
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rv-again'), proposal: rp })), 'GV010', /TARGET_ALREADY_REVOKED/);
  });

  await t.test('replay: exact retry returns the ORIGINAL durable result; changed payload GV007; wrong fingerprint GV008; stale GV009; no-op successor GV010', async () => {
    const x = await k.setup();
    const pin = await k.policy(x, 'rp');
    const target = k.relTarget(x.rels.reads);
    const proposal = k.validateProposal(target, pin);
    const subSql = k.submitSql(x.member, { commandId: x.cmd('rp-submit'), proposal });
    const submitted = await exec(subSql);
    const subAgain = await exec(subSql);
    assert.deepEqual([subAgain.replay, subAgain.proposal_id, subAgain.recorded_at], [true, submitted.proposal_id, submitted.recorded_at]);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rp-submit'), proposal: { ...proposal, applicability: 'DOES_NOT_APPLY' } })),
      'GV007', /COMMAND_ID_REUSED_WITH_DIFFERENT_SEMANTICS/);
    const decSql = k.decideSql(x.ps, { commandId: x.cmd('rp-decide'), proposalId: submitted.proposal_id, proposal });
    const decided = await exec(decSql);
    const before = await k.counts(x.org);
    const again = await exec(decSql);
    for (const field of ['outcome', 'authorization_decision_id', 'governance_decision_id', 'fact_state_id', 'effective_from', 'effective_to', 'recorded_at',
      'command_fingerprint', 'policy_id', 'version_id', 'content_hash', 'policy_version_validated_state_id', 'applicability', 'target_relationship_id']) {
      assert.equal(again[field], decided[field], field);
    }
    assert.equal(again.replay, true);
    assert.deepEqual(await k.counts(x.org), before, 'a replay writes nothing');
    await rejects(c.svc(k.decideSql(x.ps, { commandId: x.cmd('rp-decide'), proposalId: submitted.proposal_id, proposal, outcome: 'DEFER' })),
      'GV007', /COMMAND_ID_REUSED_WITH_DIFFERENT_SEMANTICS/);
    const wrong = decidePolicyApplicabilityProposalFingerprint({ organisationId: x.org, actorUserId: x.ps.id, outcome: 'VALIDATE',
      proposalId: submitted.proposal_id, proposal: { ...proposal, applicability: 'DOES_NOT_APPLY' }, expectedCurrentStateId: null,
      support: { status: 'NONE', evidenceIds: [] } });
    await rejects(c.svc(k.decideSql(x.ps, { commandId: x.cmd('rp-wrong-fp'), proposalId: submitted.proposal_id, proposal, fingerprint: wrong })),
      'GV008', /CALLER_FINGERPRINT_DIFFERS/);
    const p2 = k.validateProposal(target, pin, 'DOES_NOT_APPLY');
    const s2 = await k.submit(x, x.member, 'rp-succ-submit', p2);
    const dup = k.validateProposal(target, pin);
    const ds = await k.submit(x, x.member, 'rp-dup-submit', dup);
    const beforeRefused = await k.counts(x.org);
    await rejects(c.svc(k.decideSql(x.ps, { commandId: x.cmd('rp-stale-none'), proposalId: s2.proposal_id, proposal: p2, expected: null })),
      'GV009', /POLICY_APPLICABILITY_STATE_EXISTS/);
    await rejects(c.svc(k.decideSql(x.ps, { commandId: x.cmd('rp-stale-wrong'), proposalId: s2.proposal_id, proposal: p2, expected: randomUUID() })),
      'GV009', /STATE_EXPECTATION_MISMATCH/);
    await rejects(c.svc(k.decideSql(x.ps, { commandId: x.cmd('rp-dup'), proposalId: ds.proposal_id, proposal: dup, expected: decided.fact_state_id })),
      'GV010', /POLICY_APPLICABILITY_ALREADY_VALIDATED/);
    assert.deepEqual(await k.counts(x.org), beforeRefused, 'none of the refused commands consumed anything');
  });

  // ---------------------------------------------------------------------------------------
  await t.test('supersession: P/V1/APPLIES → P/V2/APPLIES on the SAME key (1-9); V1 byte-identical; closure derived; version never in the key', async () => {
    const x = await k.setup();
    const v1 = await k.policy(x, 'sup');
    const v2 = await k.nextVersion(x, 'sup-v2', v1);
    const target = k.objectTarget('DATA_ASSET', x.objects.byKind.DATA_ASSET);
    const policyId = v1.subject.policyId;
    // 1. P/V1/APPLIES validates.
    const s1 = await k.apply(x, 'sup-1', target, v1);
    const s1Rows = await k.stateRows(x.org, s1.stateId);
    const tBetween = await one('select clock_timestamp()::text');
    // 2. P/V2/APPLIES successor validates on the same target + policy.
    const s2 = await k.apply(x, 'sup-2', target, v2);
    assert.deepEqual([s2.decided.outcome, s2.decided.expectation_kind, s2.decided.expected_current_state_id, s2.decided.version_id],
      ['VALIDATED', 'EXPECTED_CURRENT', s1.stateId, v2.subject.versionId]);
    // 3. Same head advances.
    assert.equal(await k.head(x.org, target, policyId), s2.stateId);
    assert.equal(await one(`select count(*) from gov_repo.l14_policy_applicability_heads where organisation_id='${x.org}' and policy_id='${policyId}'`), '1');
    // 4. Predecessor unchanged (incl. xmin / ctid).
    assert.equal(await k.stateRows(x.org, s1.stateId), s1Rows);
    // 5. Successor predecessor = exact prior state.
    assert.deepEqual([(await fact(s2.stateId)).predecessor_state_id, (await detail(s2.stateId)).predecessor_state_id, s2.decided.predecessor_state_id],
      [s1.stateId, s1.stateId, s1.stateId]);
    // 6. Version id / hash / dependency / outcome are not in the head key.
    assert.equal(await one(`select count(*) from information_schema.columns where table_schema='gov_repo' and table_name='l14_policy_applicability_heads'
      and column_name in ('version_id','content_hash','policy_version_validated_state_id','applicability')`), '0');
    const r2 = await fact(s2.stateId);
    const [T2, R2] = [r2.effective_from as string, r2.recorded_at as string];
    // 7. Old effective period resolves V1.
    assert.equal((await k.resolveRow(x.org, target, policyId, ts(tBetween), now))?.version_id, v1.subject.versionId);
    // 8. New effective period resolves V2.
    assert.equal((await k.resolveRow(x.org, target, policyId, ts(T2), now))?.version_id, v2.subject.versionId);
    assert.equal(await k.resolve(x.org, target, policyId, now, now), s2.stateId);
    // 9. An earlier recorded cutoff cannot see the later successor.
    assert.equal(await k.resolve(x.org, target, policyId, now, ts(tBetween)), s1.stateId);
    assert.equal(await k.resolve(x.org, target, policyId, ts(T2), `${ts(R2)} - interval '1 microsecond'`), s1.stateId);
    // No UPDATE / DELETE of history ever ran.
    assert.equal(await one(`select coalesce(sum(n_tup_upd + n_tup_del), 0) from pg_stat_user_tables where schemaname='gov_repo'
      and relname in ('l14_policy_applicability_states','l14_policy_applicability_proposals','l14_fact_states')`), '0');
    // A successor may never start before its predecessor's start.
    const back = k.validateProposal(target, v1, 'DOES_NOT_APPLY', await k.instant('-1 hour'));
    const bs = await k.submit(x, x.member, 'sup-back-submit', back);
    await rejects(c.svc(k.decideSql(x.pflex, { commandId: x.cmd('sup-back'), proposalId: bs.proposal_id, proposal: back, expected: s2.stateId })),
      'GV011', /SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE/);
  });

  await t.test('outcome supersession: APPLIES → DOES_NOT_APPLY (same version) and DOES_NOT_APPLY → APPLIES (new version) are governed successors', async () => {
    const x = await k.setup();
    const v1 = await k.policy(x, 'oc');
    const target = k.relTarget(x.rels.exposes);
    const policyId = v1.subject.policyId;
    const a = await k.apply(x, 'oc-1', target, v1);
    const aRows = await k.stateRows(x.org, a.stateId);
    const b = await k.apply(x, 'oc-2', target, v1, { applicability: 'DOES_NOT_APPLY' });
    assert.deepEqual([b.decided.outcome, b.decided.predecessor_state_id, b.decided.applicability, b.decided.version_id],
      ['VALIDATED', a.stateId, 'DOES_NOT_APPLY', v1.subject.versionId]);
    assert.equal(await k.outcome(x.org, target, policyId), 'DOES_NOT_APPLY');
    const v2 = await k.nextVersion(x, 'oc-v2', v1);
    const cc = await k.apply(x, 'oc-3', target, v2);
    assert.deepEqual([cc.decided.predecessor_state_id, cc.decided.applicability, cc.decided.version_id], [b.stateId, 'APPLIES', v2.subject.versionId]);
    assert.equal(await k.outcome(x.org, target, policyId), 'APPLIES');
    assert.equal(await k.stateRows(x.org, a.stateId), aRows);
    assert.equal(await one(`select string_agg(applicability||':'||version_id, ',' order by f.recorded_at) from gov_repo.l14_policy_applicability_states s
      join gov_repo.l14_fact_states f using (organisation_id, fact_state_id) where s.organisation_id='${x.org}' and s.policy_id='${policyId}'`),
    `APPLIES:${v1.subject.versionId},DOES_NOT_APPLY:${v1.subject.versionId},APPLIES:${v2.subject.versionId}`);
  });

  await t.test('DOES_NOT_APPLY is a positive governed assertion; absence is UNKNOWN — never collapsed', async () => {
    const x = await k.setup();
    const pin = await k.policy(x, 'dna');
    const [dnaT, noneT] = [k.objectTarget('MODEL', x.objects.byKind.MODEL), k.objectTarget('TOOL', x.objects.byKind.TOOL)];
    const d = await k.apply(x, 'dna', dnaT, pin, { applicability: 'DOES_NOT_APPLY' });
    const r = await k.resolveRow(x.org, dnaT, pin.subject.policyId, now, now);
    assert.deepEqual([r?.fact_state_id, r?.applicability], [d.stateId, 'DOES_NOT_APPLY'], 'validated DOES_NOT_APPLY → a governed row');
    assert.equal(await k.resolveRow(x.org, noneT, pin.subject.policyId, now, now), null, 'no fact → no row (UNKNOWN)');
    assert.deepEqual(await k.current(x.org, dnaT), [`${pin.subject.policyId}|${pin.subject.versionId}|DOES_NOT_APPLY|${d.stateId}`]);
    assert.deepEqual(await k.current(x.org, noneT), []);
    assert.equal(await one(`select count(*) from pg_constraint where conrelid='gov_repo.l14_policy_applicability_states'::regclass
      and pg_get_constraintdef(oid) like '%UNKNOWN%'`), '0', 'UNKNOWN is never a stored value');
  });

  await t.test('future successor does not prematurely hide its predecessor', async () => {
    const x = await k.setup();
    const v1 = await k.policy(x, 'fs');
    const v2 = await k.nextVersion(x, 'fs-v2', v1);
    const target = k.objectTarget('AGENT_VERSION', x.objects.byKind.AGENT_VERSION);
    const s1 = await k.apply(x, 'fs-1', target, v1);
    const T2 = await k.instant('+1 hour');
    // A future-effective applicability needs its dependency valid at T2 (V2 is validated now, open-ended).
    const s2 = await k.apply(x, 'fs-2', target, v2, { from: T2 });
    assert.deepEqual([s2.decided.outcome, await k.canonical(s2.decided.effective_from), await k.head(x.org, target, v1.subject.policyId)],
      ['VALIDATED', T2, s2.stateId]);
    assert.equal(await k.resolve(x.org, target, v1.subject.policyId, now, now), s1.stateId, 'V1 stays current before V2 starts');
    assert.equal(await k.resolve(x.org, target, v1.subject.policyId, `${ts(T2)} - interval '1 microsecond'`, now), s1.stateId);
    assert.equal(await k.resolve(x.org, target, v1.subject.policyId, ts(T2), now), s2.stateId);
  });

  await t.test('temporal: omitted start = DB instant; past / future need explicit permission; immutable effective_to; REVOKE has no end of its own', async () => {
    const x = await k.setup();
    const pin = await k.policy(x, 'tm', await k.instant('-3 hours'));
    const pin2 = await k.policy(x, 'tm2', await k.instant('-3 hours'));
    const before = await one('select clock_timestamp()::text');
    const imm = await k.apply(x, 'tm-imm', k.objectTarget('AGENT', x.objects.byKind.AGENT), pin);
    const f = await fact(imm.stateId);
    assert.equal(f.effective_from, f.recorded_at, 'IMMEDIATE = the DB transaction instant');
    assert.ok(Date.parse(f.effective_from) >= Date.parse(before));
    for (const [name, offset, kind] of [['past', '-90 minutes', 'API'], ['future', '+1 hour', 'PROMPT']] as const) {
      const target = k.objectTarget(kind, x.objects.byKind[kind]);
      const p = k.validateProposal(target, pin, 'APPLIES', await k.instant(offset));
      const s = await k.submit(x, x.member, `tm-${name}-submit`, p);
      const denied = await exec(k.decideSql(x.ps, { commandId: x.cmd(`tm-${name}-deny`), proposalId: s.proposal_id, proposal: p }));
      assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED'], name);
      const passed = await exec(k.decideSql(x.pflex, { commandId: x.cmd(`tm-${name}-pass`), proposalId: s.proposal_id, proposal: p }));
      assert.deepEqual([passed.outcome, await k.canonical(passed.effective_from)], ['VALIDATED', p.requestedEffectiveFrom], name);
    }
    const keyT = k.objectTarget('DATA_ELEMENT', x.objects.byKind.DATA_ELEMENT);
    const start = await k.instant('-90 minutes');
    for (const [name, to] of [['eq', start], ['lt', await k.instant('-100 minutes')]] as const) {
      await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd(`et-${name}`), proposal: k.validateProposal(keyT, pin, 'APPLIES', start, to),
        fingerprint: BOGUS_FINGERPRINT })), 'GV010', /EFFECTIVE_INTERVAL_INVALID/);
    }
    const end = await k.instant('-30 minutes');
    const expired = await k.apply(x, 'et-a', keyT, pin, { from: start, to: end });
    assert.equal(await k.canonical(expired.decided.effective_to), end);
    assert.equal(await k.outcome(x.org, keyT, pin.subject.policyId), 'UNKNOWN', 'expiry → UNKNOWN without UPDATE');
    assert.equal(await k.resolve(x.org, keyT, pin.subject.policyId, ts(await k.instant('-60 minutes')), now), expired.stateId);
    assert.equal(await k.resolve(x.org, keyT, pin.subject.policyId, ts(end), now), null, 'half-open');
    const early = k.validateProposal(keyT, pin, 'DOES_NOT_APPLY', await k.instant('-45 minutes'));
    const es = await k.submit(x, x.member, 'et-early-submit', early);
    await rejects(c.svc(k.decideSql(x.pflex, { commandId: x.cmd('et-early'), proposalId: es.proposal_id, proposal: early, expected: expired.stateId })),
      'GV011', /SUCCESSOR_BEFORE_PREDECESSOR_END/);
    const exact = await k.apply(x, 'et-exact', keyT, pin, { applicability: 'DOES_NOT_APPLY', from: end });
    assert.deepEqual([exact.decided.outcome, exact.decided.predecessor_state_id], ['VALIDATED', expired.stateId]);
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('et-revoke-to'), fingerprint: BOGUS_FINGERPRINT,
      proposal: { ...k.revokeProposal(keyT, pin, exact.stateId, 'DOES_NOT_APPLY'), requestedEffectiveTo: await k.instant('+1 day') } })),
    'GV010', /EFFECTIVE_TO_NOT_PERMITTED/);
    const keyB = k.objectTarget('AGENT', x.objects.agent2);
    const bounded = await k.apply(x, 'et-bounded', keyB, pin2, { from: start, to: end });
    const late = k.revokeProposal(keyB, pin2, bounded.stateId, 'APPLIES', await k.instant('-10 minutes'));
    const ls = await k.submit(x, x.member, 'et-late-submit', late);
    await rejects(c.svc(k.decideSql(x.pflex, { commandId: x.cmd('et-late'), proposalId: ls.proposal_id, proposal: late, outcome: 'REVOKE',
      expected: bounded.stateId })), 'GV011', /REVOKE_AFTER_TARGET_EXPIRY/);
    const tooEarly = k.revokeProposal(keyB, pin2, bounded.stateId, 'APPLIES', await k.instant('-2 hours'));
    const tes = await k.submit(x, x.member, 'et-early-rv-submit', tooEarly);
    await rejects(c.svc(k.decideSql(x.pflex, { commandId: x.cmd('et-early-rv'), proposalId: tes.proposal_id, proposal: tooEarly, outcome: 'REVOKE',
      expected: bounded.stateId })), 'GV011', /REVOKE_BEFORE_TARGET_EFFECTIVE/);
    // A backdated applicability needs its dependency valid at the backdated instant (pin is valid from -3h; a fresh pin is not).
    const fresh = await k.policy(x, 'tm-fresh');
    const bd = k.validateProposal(k.objectTarget('SKILL', x.objects.byKind.SKILL), fresh, 'APPLIES', await k.instant('-1 hour'));
    const bds = await k.submit(x, x.member, 'tm-bd-submit', bd);
    await rejects(c.svc(k.decideSql(x.pflex, { commandId: x.cmd('tm-bd'), proposalId: bds.proposal_id, proposal: bd })), 'GV010',
      /POLICY_VERSION_DEPENDENCY_NOT_VALID/);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('O49: a POLICY_VERSION revocation invalidates the applicability without history mutation; no auto-repin; restoration = new successor', async () => {
    const x = await k.setup();
    // 1. P / V1 / H / PS1 is VALIDATED.
    const ps1 = await k.policy(x, 'o49');
    // 2-3. Applicabilities (one object, one relationship state) pin PS1; the resolver returns their governed outcomes.
    const objTarget = k.objectTarget('DATA_ASSET', x.objects.byKind.DATA_ASSET);
    const relTargetR = k.relTarget(x.rels.reads);
    const objA = { ...(await k.apply(x, 'o49-obj', objTarget, ps1)), target: objTarget };
    const relA = { ...(await k.apply(x, 'o49-rel', relTargetR, ps1, { applicability: 'DOES_NOT_APPLY' })), target: relTargetR };
    assert.deepEqual([await k.outcome(x.org, objTarget, ps1.subject.policyId), await k.outcome(x.org, relTargetR, ps1.subject.policyId)],
      ['APPLIES', 'DOES_NOT_APPLY']);
    const rows = [await k.stateRows(x.org, objA.stateId), await k.stateRows(x.org, relA.stateId)];
    const digest = await k.factDigest(x.org);
    const beforeRevoke = await one('select clock_timestamp()::text');
    // 4. PS1 is REVOKED at T.
    const pr = await k.revokePolicyVersion(x, 'o49', ps1);
    const T = pr.effective_from as string;
    const R = await one(`select recorded_at::text from gov_repo.l14_registry_states where state_id='${pr.registry_state_id}'`);
    // 5. Applicability history byte-identical.
    assert.deepEqual([await k.stateRows(x.org, objA.stateId), await k.stateRows(x.org, relA.stateId)], rows);
    assert.equal(await k.factDigest(x.org), digest);
    // 6. At effective_at >= T with a cutoff seeing the revocation → UNKNOWN.
    for (const a of [objA, relA]) {
      assert.equal(await k.resolve(x.org, a.target, ps1.subject.policyId, ts(T), ts(R)), null);
      assert.equal(await k.outcome(x.org, a.target, ps1.subject.policyId), 'UNKNOWN');
      assert.deepEqual(await k.current(x.org, a.target), []);
      // 7. An earlier recorded cutoff retains the historical applicability.
      assert.equal(await k.resolve(x.org, a.target, ps1.subject.policyId, ts(beforeRevoke), ts(beforeRevoke)), a.stateId);
      assert.equal(await k.resolve(x.org, a.target, ps1.subject.policyId, now, `${ts(R)} - interval '1 microsecond'`), a.stateId);
    }
    // 8. The policy version is revalidated as PS2.
    const ps2 = await k.revalidatePolicyVersion(x, 'o49', ps1);
    assert.notEqual(ps2.stateId, ps1.stateId);
    // 9. The old applicability MUST NOT auto-repin PS1 → PS2 (no current_version_id fallback either).
    assert.equal((await detail(objA.stateId)).policy_version_validated_state_id, ps1.stateId);
    assert.equal(await k.outcome(x.org, objA.target, ps1.subject.policyId), 'UNKNOWN', 'no silent repin to PS2');
    assert.deepEqual([await k.stateRows(x.org, objA.stateId), await k.stateRows(x.org, relA.stateId)], rows);
    // A new applicability can never pin the invalidated PS1 (the revalidated replacement state is never substituted) …
    const stale = k.validateProposal(k.objectTarget('AGENT', x.objects.byKind.AGENT), ps1);
    const ss = await k.submit(x, x.member, 'o49-stale-submit', stale);
    await rejects(c.svc(k.decideSql(x.ps, { commandId: x.cmd('o49-stale'), proposalId: ss.proposal_id, proposal: stale })), 'GV010',
      /POLICY_VERSION_DEPENDENCY_NOT_VALID/);
    // 10. … and restoring the SAME key is a NEW governed successor pinning PS2 (same policy / version / hash, new dependency).
    const restored = await k.apply(x, 'o49-restore', objA.target, ps2);
    assert.deepEqual([restored.decided.outcome, restored.decided.predecessor_state_id, restored.decided.policy_version_validated_state_id,
      restored.decided.version_id, restored.decided.content_hash], ['VALIDATED', objA.stateId, ps2.stateId, ps1.subject.versionId, ps1.subject.contentHash]);
    assert.equal(await k.resolve(x.org, objA.target, ps1.subject.policyId, now, now), restored.stateId);
    assert.equal(await k.resolve(x.org, objA.target, ps1.subject.policyId, ts(beforeRevoke), now), objA.stateId, 'PS1 history answers its own instant');
    // An applicability whose dependency became invalid can still be explicitly ended (cleanup is never blocked).
    const cleanup = await k.revoke(x, 'o49-rel-cleanup', relA.target, ps1, relA.stateId, 'DOES_NOT_APPLY');
    assert.deepEqual([cleanup.decided.outcome, cleanup.decided.predecessor_state_id], ['REVOKED', relA.stateId]);
  });

  // ---------------------------------------------------------------------------------------
  await t.test('atomicity: an induced failure after the decision (at the typed state INSERT / the head CAS) rolls the whole command back', async () => {
    for (const [name, table, timing] of [['fact', 'l14_policy_applicability_states', 'before insert'],
      ['head', 'l14_policy_applicability_heads', 'before update']] as const) {
      const x = await k.setup();
      const pin = await k.policy(x, `atom-${name}`);
      await c.evidence(x.org, `atom-${name}-ev`);
      const target = name === 'fact' ? k.objectTarget('AGENT', x.objects.byKind.AGENT) : k.relTarget(x.rels.reads);
      const proposal = k.validateProposal(target, pin);
      const submitted = await k.submit(x, x.member, `atom-${name}-submit`, proposal);
      const commandId = x.cmd(`atom-${name}`);
      const sql = k.decideSql(x.ps, { commandId, proposalId: submitted.proposal_id, proposal, support: { status: 'PRESENT', evidenceIds: [`atom-${name}-ev`] } });
      const before = await k.counts(x.org);
      const history = await k.historyDigest(x.org);
      await c.bootstrapSql(`create function public.s1c3_induced_failure() returns trigger language plpgsql
          set search_path = pg_catalog, pg_temp as $f$
          begin
            if not exists (select 1 from gov_repo.l14_governance_decisions d where d.organisation_id = new.organisation_id
                             and d.proposal_id = '${submitted.proposal_id}' and d.outcome = 'VALIDATE') then
              raise exception 'S1C3_INDUCED_FAILURE_WITHOUT_DECISION';
            end if;
            raise exception 'S1C3_INDUCED_FAILURE' using errcode = 'P0001';
          end $f$;
        create trigger zz_s1c3_induced_failure ${timing} on gov_repo.${table} for each row execute function public.s1c3_induced_failure();
        alter table gov_repo.${table} enable always trigger zz_s1c3_induced_failure;`);
      try {
        await assert.rejects(c.svc(sql), (error: Error) => {
          assert.match(error.message, /S1C3_INDUCED_FAILURE/);
          assert.doesNotMatch(error.message, /WITHOUT_DECISION/, 'the failure fired after the decision was written in the same transaction');
          return true;
        });
      } finally {
        await c.bootstrapSql(`drop trigger if exists zz_s1c3_induced_failure on gov_repo.${table}; drop function if exists public.s1c3_induced_failure();`);
      }
      assert.equal(await one(`select count(*) from gov_repo.l14_governance_decisions where proposal_id='${submitted.proposal_id}'`), '0', 'no decision');
      assert.equal(await one(`select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${x.org}' and command_id='${commandId}'`), '0');
      assert.equal(await one(`select count(*) from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${commandId}'`), '0');
      assert.equal(await one(`select count(*) from gov_repo.l14_support_links where evidence_id='atom-${name}-ev'`), '0', 'no support link');
      assert.deepEqual(await k.counts(x.org), before, 'no fact envelope, typed state, head or any other L14 row');
      assert.equal(await k.historyDigest(x.org), history);
      const r = await exec(sql);
      assert.deepEqual([r.outcome, r.replay], ['VALIDATED', false], 'the very same command now succeeds (not a replay)');
      assert.equal(await one(`select count(*) from gov_repo.l14_support_links where owner_kind='FACT_STATE' and fact_state_id='${r.fact_state_id}'`), '1');
    }
  });
});
