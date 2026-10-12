import assert from 'node:assert/strict';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { lit } from '../helpers/m16-governed-write-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';
import { businessContextKit } from '../helpers/m16-l14-business-context-fixtures';
import { policyApplicabilityKit } from '../helpers/m16-l14-policy-applicability-fixtures';
import { controlApplicabilityKit } from '../helpers/m16-l14-control-applicability-fixtures';
import { controlAssessmentKit, inDays } from '../helpers/m16-l14-control-assessment-fixtures';
import { readProjectionKit, type PassportRow } from '../helpers/m16-l14-read-projection-fixtures';

/**
 * M16 read-projection closure — O32 (ADR §22 Passport governed projection) and O41 (ADR §18.2 conflict read projection) on real
 * disposable PostgreSQL 17 (M16RP horizon = the full S1C.5 catalog + the closure migration). Every governed fact is created through
 * the real S1C.1 .. S1C.5 RPCs; both projections are called ONLY through their SECURITY DEFINER RPCs as service_role with a
 * verified principal. No fixture writes a projection row: there is none to write.
 */
test('M16 read-projection closure: O32 Passport governed projection and O41 conflict projection (disposable PG17)', { timeout: 2_400_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M16RP' });
  t.after(() => c.stop());
  const { owner, rejects } = c;
  const rk = await responsibilityKit(c);
  const bk = await businessContextKit(c);
  const pak = await policyApplicabilityKit(c);
  const cak = await controlApplicabilityKit(c);
  const ask = await controlAssessmentKit(c, cak);
  const rp = readProjectionKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const nowText = () => one(`select clock_timestamp()::text`);
  const families = (rows: readonly PassportRow[]) => rows.map(r => `${r.fact_family}:${r.target_kind}`).sort();
  /** Exact support evidence ids recorded for one owner (owner session; the projection must return exactly these). */
  const supportOf = async (org: string, ownerKind: string, column: string, id: string) => JSON.parse(await one(`select coalesce(json_agg(evidence_id
    order by evidence_id collate "C"), '[]') from gov_repo.l14_support_links where organisation_id='${org}' and owner_kind='${ownerKind}'
    and ${column}='${id}'`)) as string[];

  await t.test('O32 family 3: exact AGENT responsibility with lineage; Party revocation => UNKNOWN without history mutation; no AgentVersion inheritance', async () => {
    const x = await rk.setup();
    const p = await rk.party(x, 'own');
    const key = rk.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', p.partyId);
    const [ev1, ev2] = [await c.evidence(x.org, `${x.label}-ev-proposal`), await c.evidence(x.org, `${x.label}-ev-decision`)];
    const proposal = rk.validateProposal(key, p.stateId);
    const submitted = await rk.submit(x, x.member, 'own-submit', proposal, null, { status: 'PRESENT', evidenceIds: [ev1] });
    const decided = await rk.decide(x, x.rs, 'own-validate', submitted, proposal, 'VALIDATE', { status: 'PRESENT', evidenceIds: [ev2] });
    assert.equal(decided.outcome, 'VALIDATED');
    const before = await rp.authoritySnapshot();
    const rows = await rp.passport(x.member, x.objects.agent);
    assert.equal(await rp.authoritySnapshot(), before, 'the Passport projection writes nothing');
    assert.deepEqual(families(rows), ['RESPONSIBILITY_ASSIGNMENT:AGENT']);
    const [row] = rows;
    assert.equal(row.target_canonical_object_id, x.objects.agent);
    assert.equal(row.responsibility_role, 'BUSINESS_OWNER');
    assert.equal(row.governance_party_id, p.partyId);
    assert.equal(row.party_validated_state_id, p.stateId);
    assert.equal(row.fact_state_id, decided.fact_state_id);
    assert.equal(row.predecessor_state_id, null);
    assert.equal(row.trust_state, 'VALIDATED');
    assert.equal(row.source_class, 'LOCAL_HUMAN');
    assert.equal(row.proposal_id, submitted.proposal_id);
    assert.equal(row.governance_decision_id, decided.governance_decision_id);
    assert.deepEqual([row.decision_outcome, row.decision_reason_code], ['VALIDATE', 'RESPONSIBILITY_ASSIGNMENT_VALIDATED']);
    assert.equal(row.authorization_decision_id, decided.authorization_decision_id);
    assert.equal(row.authorization_result, 'ALLOW');
    assert.equal(row.authority_policy_version_id, x.v1.version_id);
    // Family 14: exactly the normalized support recorded for this state / decision / proposal — nothing invented.
    assert.deepEqual(row.proposal_support_evidence_ids, await supportOf(x.org, 'PROPOSAL', 'proposal_id', submitted.proposal_id));
    assert.deepEqual(row.proposal_support_evidence_ids, [ev1]);
    assert.deepEqual(row.decision_support_evidence_ids, await supportOf(x.org, 'GOVERNANCE_DECISION', 'governance_decision_id', decided.governance_decision_id));
    assert.deepEqual(row.fact_support_evidence_ids, await supportOf(x.org, 'FACT_STATE', 'fact_state_id', decided.fact_state_id));
    assert.ok(row.decision_support_evidence_ids.includes(ev2));
    assert.equal(row.read_effective_at, row.read_recorded_cutoff, 'one DB instant for both coordinates by default');
    // No AgentVersion inheritance: selecting a version adds no responsibility row for it.
    assert.deepEqual(families(await rp.passport(x.member, x.objects.agent, { versionId: x.objects.agentVersion })), ['RESPONSIBILITY_ASSIGNMENT:AGENT']);
    // Party revocation => UNKNOWN (no row) at current coordinates; historical as-of still reads the fact; history untouched.
    const rowsBefore = await rk.stateRows(x.org, decided.fact_state_id);
    const beforeRevoke = await nowText();
    await rk.revokeParty(x, 'own', p);
    assert.equal(await rk.stateRows(x.org, decided.fact_state_id), rowsBefore, 'no historical row is mutated');
    assert.deepEqual(await rp.passport(x.member, x.objects.agent), []);
    const asOf = await rp.passport(x.member, x.objects.agent, { at: lit(beforeRevoke), cutoff: lit(beforeRevoke) });
    assert.deepEqual(asOf.map(r => r.fact_state_id), [decided.fact_state_id]);
    // A re-validated Party is never auto-selected for the old assignment (a new governed decision is required).
    await rk.revalidateParty(x, 'own', p);
    assert.deepEqual(await rp.passport(x.member, x.objects.agent), []);
  });

  await t.test('O32 family 4: exact AGENT BUSINESS_DOMAIN binding; Domain revocation => UNKNOWN; other targets / kinds never surface', async () => {
    const x = await bk.setup();
    const d = await bk.domain(x, 'bd');
    const bound = await bk.assign(x, 'bd', bk.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN'), d);
    // An INFORMATION_DOMAIN of a DATA_ASSET and a BUSINESS_DOMAIN of another AGENT are never Passport facts of this AGENT.
    await bk.assign(x, 'asset-info', bk.keyOf('DATA_ASSET', x.objects.asset, 'INFORMATION_DOMAIN'), await bk.domain(x, 'info', 'INFORMATION_DOMAIN'));
    await bk.assign(x, 'agent2', bk.keyOf('AGENT', x.objects.agent2, 'BUSINESS_DOMAIN'), await bk.domain(x, 'bd2'));
    const rows = await rp.passport(x.member, x.objects.agent, { versionId: x.objects.agentVersion });
    assert.deepEqual(families(rows), ['BUSINESS_CONTEXT_ASSIGNMENT:AGENT']);
    assert.deepEqual([rows[0].semantic_kind, rows[0].domain_id, rows[0].domain_validated_state_id, rows[0].fact_state_id],
      ['BUSINESS_DOMAIN', d.subject.domainId, d.stateId, bound.stateId]);
    const historyBefore = await bk.stateRows(x.org, bound.stateId);
    const beforeRevoke = await nowText();
    await bk.revokeDomain(x, 'bd', d);
    assert.equal(await bk.stateRows(x.org, bound.stateId), historyBefore);
    assert.deepEqual(await rp.passport(x.member, x.objects.agent), [], 'Domain invalidation => UNKNOWN');
    assert.deepEqual((await rp.passport(x.member, x.objects.agent, { at: lit(beforeRevoke), cutoff: lit(beforeRevoke) })).map(r => r.fact_state_id),
      [bound.stateId], 'historical as-of readback');
  });

  await t.test('O32 family 12 (policy): APPLIES and explicit DOES_NOT_APPLY; exact targets; PolicyVersion revocation => UNKNOWN', async () => {
    const x = await pak.setup();
    const agent = pak.objectTarget('AGENT', x.objects.byKind.AGENT);
    const version = pak.objectTarget('AGENT_VERSION', x.objects.byKind.AGENT_VERSION);
    const [pol1, pol2, pol3] = [await pak.policy(x, 'p1'), await pak.policy(x, 'p2'), await pak.policy(x, 'p3')];
    const applies = await pak.apply(x, 'p1-agent', agent, pol1);
    const dna = await pak.apply(x, 'p2-agent', agent, pol2, { applicability: 'DOES_NOT_APPLY' });
    const versionOnly = await pak.apply(x, 'p3-version', version, pol3);
    const agentOnly = await rp.passport(x.member, x.objects.byKind.AGENT);
    assert.deepEqual(agentOnly.map(r => `${r.target_kind}:${r.policy_id}:${r.applicability}:${r.fact_state_id}`).sort(), [
      `AGENT:${pol1.subject.policyId}:APPLIES:${applies.stateId}`, `AGENT:${pol2.subject.policyId}:DOES_NOT_APPLY:${dna.stateId}`].sort(),
      'DOES_NOT_APPLY is an explicit governed negative, never UNKNOWN; AGENT_VERSION facts never surface on the AGENT');
    const withVersion = await rp.passport(x.member, x.objects.byKind.AGENT, { versionId: x.objects.byKind.AGENT_VERSION });
    assert.deepEqual(withVersion.filter(r => r.target_kind === 'AGENT_VERSION').map(r => `${r.policy_id}:${r.fact_state_id}`),
      [`${pol3.subject.policyId}:${versionOnly.stateId}`], 'only facts targeted exactly to the selected AGENT_VERSION');
    assert.equal(withVersion.filter(r => r.target_kind === 'AGENT').length, 2, 'AGENT facts are never copied onto the AgentVersion');
    const row = agentOnly.find(r => r.fact_state_id === applies.stateId)!;
    assert.deepEqual([row.policy_version_id, row.policy_content_hash, row.policy_version_validated_state_id],
      [pol1.subject.versionId, pol1.subject.contentHash, pol1.stateId], 'exact pinned policy version dependency lineage');
    await pak.revokePolicyVersion(x, 'p1', pol1);
    assert.deepEqual((await rp.passport(x.member, x.objects.byKind.AGENT)).map(r => r.fact_state_id), [dna.stateId],
      'a dependency-invalid applicability disappears (UNKNOWN); the explicit DOES_NOT_APPLY stays');
  });

  await t.test('O32 family 12 (controls): applicability + exact assessment; DOES_NOT_APPLY never assessed; expiry / supersession / CD revocation; identity alone gives nothing', async () => {
    const x = await ask.setup();
    const agentId = x.objects.byKind.AGENT;
    const target = cak.objectTarget('AGENT', agentId);
    // Canonical identity alone: zero control rows (no implied coverage).
    assert.deepEqual(await rp.passport(x.member, agentId), []);
    assert.deepEqual(await rp.passport(x.member, x.objects.agent2), []);
    const a = await ask.applicability(x, 'ctl-a', target);
    const until = inDays(5);
    const assessed = await ask.assess(x, 'ctl-a', a.stateId, { outcome: 'PARTIALLY_SATISFIED', until });
    const dnaPin = await cak.control(x, 'ctl-dna');
    const dna = await ask.applicability(x, 'ctl-dna', target, { pin: dnaPin, applicability: 'DOES_NOT_APPLY' });
    const rows = await rp.passport(x.member, agentId);
    assert.deepEqual(rows.map(r => `${r.fact_family}:${r.control_definition_id}:${r.applicability}:${r.assessment_outcome ?? '-'}`).sort(), [
      `CONTROL_APPLICABILITY:${a.pin.subject.controlDefinitionId}:APPLIES:-`,
      `CONTROL_APPLICABILITY:${dnaPin.subject.controlDefinitionId}:DOES_NOT_APPLY:-`,
      `CONTROL_ASSESSMENT:${a.pin.subject.controlDefinitionId}:APPLIES:PARTIALLY_SATISFIED`].sort());
    const assessmentRow = rows.find(r => r.fact_family === 'CONTROL_ASSESSMENT')!;
    assert.equal(assessmentRow.control_applicability_state_id, a.stateId, 'the assessment of EXACTLY the APPLIES applicability state');
    assert.equal(assessmentRow.fact_state_id, assessed.stateId);
    assert.equal(assessmentRow.effective_to, (await one(`select to_json(${lit(until)}::timestamptz)#>>'{}'`)), 'valid_until is the effective_to');
    assert.ok(!rows.some(r => r.fact_family === 'CONTROL_ASSESSMENT' && r.control_definition_id === dnaPin.subject.controlDefinitionId));
    for (const column of ['policy_id', 'responsibility_role', 'domain_id']) assert.ok(rows.every(r => r[column] === null), `${column} absent`);
    assert.ok(!Object.keys(rows[0]).some(k => /score|coverage|percent|risk|maturity/.test(k)), 'no score / coverage / risk column exists');
    // Expiry: at a business instant after valid_until the assessment is not current (the applicability still is).
    const later = lit(inDays(6));
    assert.deepEqual((await rp.passport(x.member, agentId, { at: later, cutoff: 'clock_timestamp()' })).map(r => r.fact_family).sort(),
      ['CONTROL_APPLICABILITY', 'CONTROL_APPLICABILITY']);
    // Supersession of the applicability (a new version of the same control): the old assessment never carries over.
    const v2 = await cak.nextVersion(x, 'ctl-a', a.pin);
    const successor = await cak.apply(x, 'ctl-a-v2', target, v2);
    const afterSuccession = await rp.passport(x.member, agentId);
    assert.ok(afterSuccession.some(r => r.fact_family === 'CONTROL_APPLICABILITY' && r.fact_state_id === successor.stateId));
    assert.ok(!afterSuccession.some(r => r.fact_family === 'CONTROL_ASSESSMENT'), 'assessments never carry across successor applicability states');
    // CONTROL_DEFINITION revocation: the dependent applicability disappears (UNKNOWN), DOES_NOT_APPLY of another control stays.
    await cak.revokeControlDefinition(x, 'ctl-a-v2', v2);
    assert.deepEqual((await rp.passport(x.member, agentId)).map(r => r.fact_state_id), [dna.stateId]);
  });

  await t.test('O32: AGENT <-> AGENT_VERSION no inheritance for control applicability / assessment', async () => {
    const x = await ask.setup();
    const versionTarget = cak.objectTarget('AGENT_VERSION', x.objects.byKind.AGENT_VERSION);
    const va = await ask.applicability(x, 'v-ctl', versionTarget);
    await ask.assess(x, 'v-ctl', va.stateId);
    assert.deepEqual(await rp.passport(x.member, x.objects.byKind.AGENT), [], 'a version fact never surfaces on the AGENT');
    const withVersion = await rp.passport(x.member, x.objects.byKind.AGENT, { versionId: x.objects.byKind.AGENT_VERSION });
    assert.deepEqual(families(withVersion), ['CONTROL_APPLICABILITY:AGENT_VERSION', 'CONTROL_ASSESSMENT:AGENT_VERSION']);
    // A non-AGENT root or a non-AGENT_VERSION "version" resolves nothing.
    assert.deepEqual(await rp.passport(x.member, x.objects.byKind.AGENT_VERSION), []);
    assert.deepEqual(await rp.passport(x.member, x.objects.byKind.AGENT, { versionId: x.objects.byKind.MODEL }), []);
  });

  await t.test('O32: tenant isolation; legacy owner / business_domain / cg_* values never become Passport truth; malformed reads refused', async () => {
    const x = await rk.setup();
    const p = await rk.party(x, 'iso');
    await rk.assign(x, 'iso', rk.keyOf('AGENT', x.objects.agent, 'TECHNICAL_OWNER', p.partyId), p);
    const y = await rk.setup();
    assert.deepEqual(await rp.passport(y.member, x.objects.agent), [], 'a foreign tenant cannot surface another tenant\'s fact');
    await rejects(rp.passport(x.member, x.objects.agent, { session: { org: y.org } }), 'GV003');
    // Legacy registry values for the same organisation: owner, business_domain and CG-AG flags set — never projected.
    await owner(`insert into gov_repo.agents(agent_code,name,description,agent_type,owner_user_id,technical_owner_id,business_domain,
        organisation_id,created_by,cg_ag_002_owner,cg_ag_007_oversight)
      values('LEG-${x.label.slice(-6)}','legacy','legacy',(enum_range(null::gov_repo.agent_type))[1],'${x.member.id}','${x.rs.id}',
        'LEGACY_DOMAIN','${x.org}','${x.member.id}',true,true)`);
    assert.deepEqual(await rp.passport(x.member, x.objects.agent2), [], 'legacy values never populate M16 Passport truth');
    const rows = await rp.passport(x.member, x.objects.agent);
    assert.deepEqual(families(rows), ['RESPONSIBILITY_ASSIGNMENT:AGENT']);
    assert.ok(!JSON.stringify(rows).includes('LEGACY_DOMAIN') && !JSON.stringify(rows).includes(x.member.id));
    await rejects(c.svc(rp.passportSql(x.member, x.objects.agent, null, 'clock_timestamp()', null)), 'GV010', /PASSPORT_READ_SHAPE_INVALID/);
    await rejects(c.svc(rp.passportSql(x.member, null as unknown as string)), 'GV010', /PASSPORT_READ_SHAPE_INVALID/);
  });

  // ---------------------------------------------------------------------------------------------------------------------------
  // O41 — conflict projection.
  // ---------------------------------------------------------------------------------------------------------------------------
  await t.test('O41: RESOLVED / CONFLICT / INSUFFICIENT_EVIDENCE over BUSINESS_CONTEXT_ASSIGNMENT; no ranking; later decision resolves without deleting history', async () => {
    const x = await bk.setup();
    const key = rp.objectKey('BUSINESS_CONTEXT_ASSIGNMENT', 'AGENT', x.objects.agent, { semanticKind: 'BUSINESS_DOMAIN' });
    const empty = await rp.conflict(x.member, key);
    assert.deepEqual([empty.outcome, empty.live, empty.distinct, empty.rows.length], ['INSUFFICIENT_EVIDENCE', 0, 0, 1], 'absence never fabricates a winner');
    const [d1, d2] = [await bk.domain(x, 'c1'), await bk.domain(x, 'c2')];
    const bkKey = bk.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN');
    const p1 = bk.validateProposal(bkKey, d1);
    const s1 = await bk.submit(x, x.member, 'c1-submit', p1, null, { status: 'PRESENT', evidenceIds: [await c.evidence(x.org, `${x.label}-c1`)] });
    const single = await rp.conflict(x.member, key);
    assert.deepEqual([single.outcome, single.live, single.distinct], ['INSUFFICIENT_EVIDENCE', 1, 1], 'one unresolved proposal is insufficient');
    // An identical typed content from another submitter corroborates; it is not a material conflict.
    const s1b = await bk.submit(x, x.member2, 'c1b-submit', p1);
    const same = await rp.conflict(x.member, key);
    assert.deepEqual([same.outcome, same.live, same.distinct], ['INSUFFICIENT_EVIDENCE', 2, 1]);
    // A materially different domain for the SAME key: CONFLICT, both proposals preserved with their support, never ranked.
    const p2 = bk.validateProposal(bkKey, d2);
    const s2 = await bk.submit(x, x.member2, 'c2-submit', p2);
    const before = await rp.authoritySnapshot();
    const conflict = await rp.conflict(x.member, key);
    assert.equal(await rp.authoritySnapshot(), before, 'the conflict projection writes nothing');
    assert.deepEqual([conflict.outcome, conflict.live, conflict.distinct, conflict.fact], ['CONFLICT', 3, 2, null]);
    assert.deepEqual(conflict.proposals.map(r => r.proposal_id), [s1.proposal_id, s1b.proposal_id, s2.proposal_id].sort(),
      'ordered by opaque proposal id only (never support, recency or source)');
    assert.deepEqual(conflict.proposals.find(r => r.proposal_id === s1.proposal_id)!.proposal_support_evidence_ids, [`${x.label}-c1`]);
    assert.deepEqual(new Set(conflict.proposals.map(r => r.domain_id)), new Set([d1.subject.domainId, d2.subject.domainId]));
    assert.ok(conflict.proposals.every(r => !('winner' in r) && r.fact_state_id === null));
    // DEFER is non-terminal: still CONFLICT. REJECT of the lone d2 proposal leaves identical contents => INSUFFICIENT_EVIDENCE.
    await bk.decide(x, x.bs, 'c2-defer', s2, p2, 'DEFER');
    const deferred = await rp.conflict(x.member, key);
    assert.equal(deferred.outcome, 'CONFLICT');
    assert.equal(deferred.proposals.find(r => r.proposal_id === s2.proposal_id)!.proposal_deferred, true);
    const beforeReject = await nowText();
    await bk.decide(x, x.bs, 'c2-reject', s2, p2, 'REJECT');
    assert.deepEqual([(await rp.conflict(x.member, key)).outcome, (await rp.conflict(x.member, key)).live], ['INSUFFICIENT_EVIDENCE', 2]);
    assert.equal((await rp.conflict(x.member, key, { at: lit(beforeReject), cutoff: lit(beforeReject) })).outcome, 'CONFLICT', 'bitemporal: as known then');
    // A later governed decision makes the read RESOLVED; the competing proposal history is not deleted.
    const s3 = await bk.submit(x, x.member2, 'c3-submit', p2);
    assert.equal((await rp.conflict(x.member, key)).outcome, 'CONFLICT');
    const decided = await bk.decide(x, x.bs, 'c3-validate', s3, p2);
    const resolved = await rp.conflict(x.member, key);
    assert.deepEqual([resolved.outcome, resolved.fact?.fact_state_id, resolved.fact?.domain_id, resolved.fact?.governance_decision_id],
      ['RESOLVED', decided.fact_state_id, d2.subject.domainId, decided.governance_decision_id]);
    assert.equal(resolved.proposals.length, 0, 'RESOLVED references the governed fact only');
    assert.equal(await one(`select count(*) from gov_repo.l14_proposals where organisation_id='${x.org}' and proposal_id in
      ('${s1.proposal_id}','${s1b.proposal_id}','${s2.proposal_id}')`), '3', 'competing proposal history is retained');
  });

  await t.test('O41: different logical keys never conflict (RESPONSIBILITY party / POLICY id); tenant isolation; shape refusal', async () => {
    const x = await rk.setup();
    const [a, b] = [await rk.party(x, 'ka'), await rk.party(x, 'kb')];
    for (const party of [a, b]) {
      await rk.submit(x, x.member, `k-${party.partyId.slice(0, 6)}`, rk.validateProposal(rk.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', party.partyId), party.stateId));
    }
    for (const party of [a, b]) {
      const r = await rp.conflict(x.member, rp.objectKey('RESPONSIBILITY_ASSIGNMENT', 'AGENT', x.objects.agent,
        { responsibilityRole: 'BUSINESS_OWNER', governancePartyId: party.partyId }));
      assert.deepEqual([r.outcome, r.live], ['INSUFFICIENT_EVIDENCE', 1], 'owner keys include the Party: never collapsed into one key');
    }
    const y = await rk.setup();
    const foreign = await rp.conflict(y.member, rp.objectKey('RESPONSIBILITY_ASSIGNMENT', 'AGENT', x.objects.agent,
      { responsibilityRole: 'BUSINESS_OWNER', governancePartyId: a.partyId }));
    assert.deepEqual([foreign.outcome, foreign.live, foreign.rows.length], ['INSUFFICIENT_EVIDENCE', 0, 1], 'nothing of another tenant surfaces');
    await rejects(rp.conflict(x.member, rp.objectKey('RESPONSIBILITY_ASSIGNMENT', 'AGENT', x.objects.agent,
      { responsibilityRole: 'BUSINESS_OWNER', governancePartyId: a.partyId }), { session: { org: y.org } }), 'GV003');
    const malformed = [
      { subjectKind: 'RESPONSIBILITY_ASSIGNMENT', targetType: 'CANONICAL_OBJECT', targetCanonicalKind: 'AGENT', targetCanonicalObjectId: x.objects.agent, responsibilityRole: 'BUSINESS_OWNER' },
      { subjectKind: 'BUSINESS_CONTEXT_ASSIGNMENT', targetType: 'CANONICAL_OBJECT', targetCanonicalKind: 'AGENT', targetCanonicalObjectId: x.objects.agent, semanticKind: 'BUSINESS_DOMAIN', policyId: a.partyId },
      { subjectKind: 'POLICY_APPLICABILITY', targetType: 'CANONICAL_OBJECT', targetCanonicalKind: 'AGENT', targetCanonicalObjectId: x.objects.agent, targetRelationshipId: 'r', policyId: a.partyId },
      { subjectKind: 'CONTROL_ASSESSMENT', targetType: 'CANONICAL_OBJECT', targetCanonicalKind: 'AGENT', targetCanonicalObjectId: x.objects.agent, controlApplicabilityStateId: a.partyId },
      { subjectKind: 'CONTROL_APPLICABILITY', targetType: 'CANONICAL_OBJECT', targetCanonicalKind: 'PARTY', targetCanonicalObjectId: x.objects.agent, controlDefinitionId: a.partyId },
      { subjectKind: 'RESPONSIBILITY_ASSIGNMENT', targetType: 'CANONICAL_OBJECT', targetCanonicalKind: 'AGENT', targetCanonicalObjectId: x.objects.agent, responsibilityRole: 'OWNER', governancePartyId: a.partyId },
    ] as const;
    for (const key of malformed) await rejects(rp.conflict(x.member, key), 'GV010', /FACT_KEY_SHAPE_INVALID/);
    await rejects(rp.conflict(x.member, { subjectKind: 'GOVERNANCE_PARTY' as never }), 'GV010', /FACT_SUBJECT_KIND_UNKNOWN/);
    await rejects(rp.conflict(x.member, { subjectKind: 'CONTROL_FINDING' as never }), 'GV010', /FACT_SUBJECT_KIND_UNKNOWN/);
  });

  await t.test('O41: POLICY_APPLICABILITY — RESOLVED; dependency-invalid old fact cannot be RESOLVED; per-policy keys independent', async () => {
    const x = await pak.setup();
    const agent = pak.objectTarget('AGENT', x.objects.byKind.AGENT);
    const [pol1, pol2] = [await pak.policy(x, 'k1'), await pak.policy(x, 'k2')];
    const applied = await pak.apply(x, 'k1', agent, pol1);
    const key = rp.objectKey('POLICY_APPLICABILITY', 'AGENT', x.objects.byKind.AGENT, { policyId: pol1.subject.policyId });
    const resolved = await rp.conflict(x.member, key);
    assert.deepEqual([resolved.outcome, resolved.fact?.fact_state_id, resolved.fact?.applicability, resolved.fact?.policy_version_validated_state_id],
      ['RESOLVED', applied.stateId, 'APPLIES', pol1.stateId]);
    // Two different-policy proposals on the same target are different keys: no conflict anywhere.
    await pak.submit(x, x.member, 'k2-a', pak.validateProposal(agent, pol2, 'APPLIES'));
    assert.deepEqual([(await rp.conflict(x.member, { ...key, policyId: pol2.subject.policyId })).outcome], ['INSUFFICIENT_EVIDENCE']);
    // The same policy, a different target (AGENT_VERSION): its own key.
    assert.equal((await rp.conflict(x.member, rp.objectKey('POLICY_APPLICABILITY', 'AGENT_VERSION', x.objects.byKind.AGENT_VERSION,
      { policyId: pol1.subject.policyId }))).outcome, 'INSUFFICIENT_EVIDENCE');
    const beforeRevoke = await nowText();
    await pak.revokePolicyVersion(x, 'k1', pol1);
    const invalid = await rp.conflict(x.member, key);
    assert.deepEqual([invalid.outcome, invalid.fact], ['INSUFFICIENT_EVIDENCE', null], 'a dependency-invalid old fact is never RESOLVED');
    assert.equal((await rp.conflict(x.member, key, { at: lit(beforeRevoke), cutoff: lit(beforeRevoke) })).outcome, 'RESOLVED');
    // Two live, materially different (APPLIES vs DOES_NOT_APPLY) proposals for the now-unresolved key: CONFLICT.
    const pin = await pak.revalidatePolicyVersion(x, 'k1', pol1);
    await pak.submit(x, x.member, 'k1-applies', pak.validateProposal(agent, pin, 'APPLIES'));
    await pak.submit(x, x.member2, 'k1-dna', pak.validateProposal(agent, pin, 'DOES_NOT_APPLY'));
    assert.deepEqual([(await rp.conflict(x.member, key)).outcome, (await rp.conflict(x.member, key)).distinct], ['CONFLICT', 2]);
  });

  await t.test('O41: CONTROL_APPLICABILITY and CONTROL_ASSESSMENT keys (relationship-state target and exact applicability state)', async () => {
    const x = await ask.setup();
    const rel = cak.relTarget(x.rels.reads);
    const pin = await cak.control(x, 'rel-ctl');
    const relKey = { subjectKind: 'CONTROL_APPLICABILITY', targetType: 'RELATIONSHIP_STATE', targetRelationshipId: x.rels.reads.relationshipId,
      targetRelationshipStateId: x.rels.reads.relationshipStateId, controlDefinitionId: pin.subject.controlDefinitionId } as const;
    await cak.submit(x, x.member, 'rel-applies', cak.validateProposal(rel, pin, 'APPLIES'));
    await cak.submit(x, x.member2, 'rel-dna', cak.validateProposal(rel, pin, 'DOES_NOT_APPLY'));
    assert.equal((await rp.conflict(x.member, relKey)).outcome, 'CONFLICT');
    const applied = await ask.applicability(x, 'as', cak.objectTarget('AGENT', x.objects.byKind.AGENT));
    const asKey = { subjectKind: 'CONTROL_ASSESSMENT', controlApplicabilityStateId: applied.stateId } as const;
    const until = inDays(10);
    const [sat, notSat] = [ask.validateProposal(applied.stateId, 'SATISFIED', until), ask.validateProposal(applied.stateId, 'NOT_SATISFIED', until)];
    const s1 = await ask.submit(x, x.member, 'as-sat', sat);
    await ask.submit(x, x.member2, 'as-not', notSat);
    const competing = await rp.conflict(x.member, asKey);
    assert.deepEqual([competing.outcome, competing.proposals.map(r => r.assessment_outcome).sort()], ['CONFLICT', ['NOT_SATISFIED', 'SATISFIED']]);
    const decided = await ask.decide(x, x.as, 'as-sat-validate', s1, sat);
    const resolved = await rp.conflict(x.member, asKey);
    assert.deepEqual([resolved.outcome, resolved.fact?.fact_state_id, resolved.fact?.assessment_outcome], ['RESOLVED', decided.fact_state_id, 'SATISFIED']);
    const expired = await rp.conflict(x.member, asKey, { at: lit(inDays(11)), cutoff: 'clock_timestamp()' });
    assert.deepEqual([expired.outcome, expired.fact, expired.live], ['INSUFFICIENT_EVIDENCE', null, 1],
      'an expired assessment is never RESOLVED; the one remaining live proposal is not a conflict and never a winner');
  });

  await t.test('O32 / O41: service_role holds no direct authority-table read; the projections are its only read path', async () => {
    for (const table of ['l14_fact_states', 'l14_responsibility_assignment_states', 'l14_control_assessment_states', 'l14_proposals',
      'l14_support_links', 'l14_governance_decisions']) {
      await assert.rejects(c.svc(`select count(*) from gov_repo.${table}`), /permission denied/);
    }
    for (const call of [`gov_repo.l14_responsibility_assignments_current_v1(gen_random_uuid(), 'AGENT', 'x', now(), now())`,
      `gov_repo.l14_control_assessments_current_v1(gen_random_uuid(), 'CANONICAL_OBJECT', 'AGENT', 'x', null, null, now(), now())`,
      `gov_repo.l14_business_context_assignment_valid_state_v1(gen_random_uuid(), 'AGENT', 'x', 'BUSINESS_DOMAIN', now(), now())`]) {
      await assert.rejects(c.svc(`select count(*) from ${call}`), /permission denied for function/);
    }
  });
});
