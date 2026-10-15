import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { m17s5Kit, NONE } from '../helpers/m17-s5-fixtures';
import { lit } from '../helpers/m16-governed-write-fixtures';

test('M17-S5 treatment O46/O47/O48, authority, replay and dependencies (PG17)', { timeout: 600_000 }, async t => {
  const c = await l14Cluster(m => t.diagnostic(m), { horizon: 'M17S5' });
  t.after(() => c.stop());
  const k = await m17s5Kit(c), x = await k.setup();
  const r = await k.risk(x, 'risk');
  let n = 0;
  const name = () => `case-${++n}`;
  const fresh = (over = {}) => k.proposal(x, r.stateId, { treatmentOrdinalKey: name(), ...over });
  const reject = async (sql: string, detail: string) => assert.rejects(c.svc(sql), new RegExp(detail));
  const stateText = (id: string) => k.one(`select s::text from gov_repo.l15_risk_treatment_states s where organisation_id='${x.org}' and state_id='${id}'`);
  const unrelated = () => k.one(`select md5(coalesce(string_agg(v,'|' order by v),'')) from (
    ${['l14_fact_states','l14_registry_states','l14_control_applicability_states','l14_control_assessment_states','canonical_objects','canonical_relationships'].map(t => `select '${t}:'||s::text v from gov_repo.${t} s where organisation_id='${x.org}'`).join(' union all ')}) a`);

  for (const option of ['MITIGATE','AVOID','TRANSFER'] as const) await t.test(`O46 accepted ${option}; planning date does not expire treatment`, async () => {
    const p = fresh({ treatmentOption: option, targetImplementationDate: '2001-01-01' });
    const result = await k.treat(x, name(), p);
    assert.equal(result.decided.outcome, 'VALIDATED');
    const read = await k.read(x.member, p);
    assert.equal(read.treatment_status, 'PLANNED');
    assert.equal(read.current_state.target_implementation_date, '2001-01-01');
    assert.equal(read.current_state.effective_to, null);
  });
  for (const option of ['ACCEPT','WAIVED','RESIDUAL','mitigate']) await t.test(`O46 rejects option ${option} in PostgreSQL`, async () => {
    await reject(k.submitSql(x.member, { commandId: x.cmd(name()), proposal: fresh(), fingerprint: 'b'.repeat(64), raw: { p_treatment_option: lit(option) } }), 'TREATMENT_OPTION_UNKNOWN');
  });
  for (const status of ['verified','failed','VERIFIED','FAILED','WAIVED']) await t.test(`O46 rejects status ${status} in PostgreSQL`, async () => {
    await reject(k.submitSql(x.member, { commandId: x.cmd(name()), proposal: fresh(), fingerprint: 'b'.repeat(64), raw: { p_implementation_status: lit(status) } }), 'IMPLEMENTATION_STATUS_UNKNOWN');
  });
  await t.test('O47 successor has its own decision/evidence and leaves predecessor, pins and support byte-identical', async () => {
    const ctrl = await k.control(x, 'o47-control');
    const p = fresh({ controlDefinitionVersionIds: [ctrl.versionId] });
    const beforeM16 = await unrelated();
    const planned = await k.treat(x, name(), p, k.evidence(x));
    const predecessor = await stateText(planned.stateId);
    const pinText = await k.one(`select p::text from gov_repo.l15_risk_treatment_state_control_pins p where state_id='${planned.stateId}'`);
    const links = await k.one(`select string_agg(l::text,'|' order by link_id) from gov_repo.l15_support_links l where owner_risk_treatment_state_id='${planned.stateId}'`);
    const next = { ...p, expectedCurrentStateId: planned.stateId, implementationStatus: 'IMPLEMENTED' as const };
    const submitted = await k.submit(x, name(), next);
    await reject(k.decideSql(x.treatment, { commandId: x.cmd(name()), proposalId: submitted.proposal_id, proposal: next }), 'IMPLEMENTATION_EVIDENCE_REQUIRED');
    const implemented = await k.decide(x, name(), submitted, next, { support: k.evidence(x) });
    assert.equal(implemented.outcome, 'VALIDATED');
    assert.notEqual(implemented.governance_decision_id, planned.decided.governance_decision_id);
    assert.equal(implemented.predecessor_state_id, planned.stateId);
    assert.equal(await stateText(planned.stateId), predecessor);
    assert.equal(await k.one(`select p::text from gov_repo.l15_risk_treatment_state_control_pins p where state_id='${planned.stateId}'`), pinText);
    assert.equal(await k.one(`select string_agg(l::text,'|' order by link_id) from gov_repo.l15_support_links l where owner_risk_treatment_state_id='${planned.stateId}'`), links);
    assert.equal((await k.read(x.member, p)).treatment_status, 'IMPLEMENTED');
    assert.equal(await unrelated(), beforeM16, 'naming controls creates no M16/canonical state');
  });
  await t.test('O48 control invalidation identifies exact pin, preserves history/as-of and permits REVOKE', async () => {
    const ctrl = await k.control(x, 'o48-control');
    const p = fresh({ controlDefinitionVersionIds: [ctrl.versionId] });
    const treatment = await k.treat(x, name(), p);
    const at = await k.instant('0 seconds'), history = await k.history(x.org);
    await k.ck.revoke(x.control as never, 'o48-revoke', ctrl.version, ctrl.stateId);
    const read = await k.read(x.member, p);
    assert.equal(read.resolution, 'CONTROL_DEFINITION_DEPENDENCY_INVALID');
    assert.equal(read.dependency_id, ctrl.stateId);
    assert.equal(read.current_state, null);
    assert.equal(await k.history(x.org), history);
    assert.equal((await k.read(x.member, p, at, at)).treatment_status, 'PLANNED');
    const rev = k.revocation(p, treatment.stateId, 'TREATMENT_FAILED');
    const s = await k.submit(x, name(), rev);
    assert.equal((await k.decide(x, name(), s, rev, { outcome: 'REVOKE' })).outcome, 'REVOKED');
    await reject(k.submitSql(x.member, { commandId: x.cmd(name()), proposal: fresh({ controlDefinitionVersionIds: [ctrl.versionId] }) }), 'CONTROL_DEPENDENCY_NOT_VALID');
  });
  await t.test('O48 multiple controls normalized; second invalid pin is identified; revalidation never repins', async () => {
    const a = await k.control(x, 'multi-a'), b = await k.control(x, 'multi-b');
    const p = fresh({ controlDefinitionVersionIds: [b.versionId,a.versionId] });
    const result = await k.treat(x, name(), p);
    assert.equal(result.decided.control_pins.length, 2);
    const digest = await k.history(x.org);
    await k.ck.revoke(x.control as never, 'multi-revoke', b.version, b.stateId);
    await k.ck.validate(x.control as never, 'multi-revalidate', b.version);
    assert.equal((await k.read(x.member, p)).dependency_id, b.stateId);
    assert.equal(await k.history(x.org), digest);
  });
  for (const option of ['AVOID','TRANSFER'] as const) await t.test(`controls forbidden for ${option}`, async () => {
    await reject(k.submitSql(x.member, { commandId: x.cmd(name()), proposal: fresh(), fingerprint: 'b'.repeat(64),
      raw: { p_treatment_option: lit(option), p_control_definition_version_ids: `array['${randomUUID()}']::uuid[]` } }), 'CONTROL_PINS_NOT_PERMITTED');
  });
  await t.test('exact risk dependency; successor risk receives no treatment; old key remains revocable', async () => {
    const otherRisk = await k.risk(x, 'supersede-risk');
    const p = k.proposal(x, otherRisk.stateId);
    const treatment = await k.treat(x, name(), p);
    const at = await k.instant('0 seconds'), digest = await k.history(x.org);
    await k.k3.revokeRisk(x, 'risk-revoke', otherRisk.subject, otherRisk.scen, otherRisk.stateId);
    const riskHead = await k.k3.head(x.org, otherRisk.subject, otherRisk.scen.id);
    const successor = await k.k3.validateRisk(x, 'risk-revalidate', otherRisk.subject, otherRisk.scen, { over: { expectedCurrentStateId: riskHead } });
    assert.equal((await k.read(x.member, p)).dependency_id, otherRisk.stateId);
    assert.equal((await k.read(x.member, { ...p, governedRiskStateId: successor.stateId })).resolution, 'NO_STATE');
    assert.equal((await k.read(x.member, p, at, at)).treatment_status, 'PLANNED');
    assert.equal(await k.history(x.org), digest);
    const rev = k.revocation(p, treatment.stateId);
    const submitted = await k.submit(x, name(), rev);
    assert.equal((await k.decide(x, name(), submitted, rev, { outcome: 'REVOKE' })).outcome, 'REVOKED');
  });
  await t.test('replay returns original durable result; changed payload and fingerprint mismatch fail', async () => {
    const p = fresh(), cmd = x.cmd(name());
    const sql = k.submitSql(x.member, { commandId: cmd, proposal: p });
    const submitted = await c.exec(sql);
    assert.deepEqual(await c.exec(sql), { ...submitted, replay: true });
    await reject(k.submitSql(x.member, { commandId: cmd, proposal: { ...p, targetImplementationDate: '2030-01-01' } }), 'REPLAY_CONFLICT');
    await reject(k.submitSql(x.member, { commandId: x.cmd(name()), proposal: p, fingerprint: 'b'.repeat(64) }), 'CALLER_FINGERPRINT_DIFFERS');
    const decisionSql = k.decideSql(x.treatment, { commandId: x.cmd(name()), proposalId: submitted.proposal_id, proposal: p });
    const decision = await c.exec(decisionSql);
    const rev = k.revocation(p, decision.state_id), rs = await k.submit(x, name(), rev);
    await k.decide(x, name(), rs, rev, { outcome: 'REVOKE' });
    assert.deepEqual(await c.exec(decisionSql), { ...decision, replay: true });
  });
  await t.test('durable DENY consumes command, requires current L15 authority; self-validation denied', async () => {
    const p = fresh(), submitted = await k.submit(x, name(), p);
    const sql = k.decideSql(x.member, { commandId: x.cmd(name()), proposalId: submitted.proposal_id, proposal: p });
    const denied = await c.exec(sql);
    assert.equal(denied.outcome, 'DENIED');
    assert.equal(denied.state_id, null);
    assert.deepEqual(await c.exec(sql), { ...denied, replay: true });
    assert.equal((await k.decide(x, name(), submitted, p, {}, x.l14Resp)).outcome, 'DENIED');
    const selfP = fresh(), selfS = await k.submit(x, name(), selfP, {}, x.treatment);
    assert.equal((await k.decide(x, name(), selfS, selfP)).outcome, 'DENIED');
  });
  await t.test('DEFER nonterminal; REJECT terminal; neither creates state', async () => {
    const p = fresh(), s = await k.submit(x, name(), p);
    assert.equal((await k.decide(x, name(), s, p, { outcome: 'DEFER' })).state_id, null);
    assert.equal((await k.decide(x, name(), s, p, { outcome: 'REJECT' })).outcome, 'REJECTED');
    await reject(k.decideSql(x.treatment, { commandId: x.cmd(name()), proposalId: s.proposal_id, proposal: p }), 'PROPOSAL_TERMINAL');
  });
  for (const reason of ['TREATMENT_FAILED','TREATMENT_WITHDRAWN','RECORDED_IN_ERROR'] as const) await t.test(`closed revocation reason ${reason}`, async () => {
    const p = fresh(), result = await k.treat(x, name(), p), rev = k.revocation(p, result.stateId, reason);
    const s = await k.submit(x, name(), rev);
    assert.equal((await k.decide(x, name(), s, rev, { outcome: 'REVOKE' })).treatment_revocation_reason, reason);
  });
  await t.test('unknown revocation reason rejected before fingerprint check', async () => {
    await reject(k.submitSql(x.member, { commandId: x.cmd(name()), proposal: fresh(), fingerprint: 'b'.repeat(64), raw: { p_treatment_revocation_reason: "'ACCEPTED'" } }), 'TREATMENT_REVOCATION_REASON_UNKNOWN');
  });
  await t.test('foreign risk/party/control and support never resolve across tenants', async () => {
    const y = await k.setup(), yr = await k.risk(y, 'foreign-risk'), yc = await k.control(y, 'foreign-control');
    for (const [over, detail] of [
      [{ governedRiskStateId: yr.stateId }, 'GOVERNED_RISK_STATE_UNRESOLVED'],
      [{ responsibleGovernancePartyId: y.responsible.partyId, partyValidatedStateId: y.responsible.decided.registry_state_id }, 'PARTY_PIN_UNRESOLVED'],
      [{ controlDefinitionVersionIds: [yc.versionId] }, 'CONTROL_DEPENDENCY_NOT_VALID'],
    ] as const) await reject(k.submitSql(x.member, { commandId: x.cmd(name()), proposal: fresh(over) }), detail);
    await assert.rejects(k.submit(x, name(), fresh(), { support: k.evidence(y) }));
    assert.equal((await k.read(y.member, fresh())).resolution, 'NO_STATE');
  });
  await t.test('O48 invalid responsible party; immutable as-of and cleanup after dependency invalidation', async () => {
    const p = fresh(), result = await k.treat(x, name(), p), at = await k.instant('0 seconds'), digest = await k.history(x.org);
    await k.pk.revoke(x.party as never, 'party-revoke', x.responsible.partyId, x.responsible.decided.registry_state_id);
    const read = await k.read(x.member, p);
    assert.equal(read.resolution, 'GOVERNANCE_PARTY_DEPENDENCY_INVALID');
    assert.equal(read.dependency_id, p.partyValidatedStateId);
    assert.equal(await k.history(x.org), digest);
    assert.equal((await k.read(x.member, p, at, at)).treatment_status, 'PLANNED');
    const rev = k.revocation(p, result.stateId), s = await k.submit(x, name(), rev);
    assert.equal((await k.decide(x, name(), s, rev, { outcome: 'REVOKE' })).outcome, 'REVOKED');
  });
});
