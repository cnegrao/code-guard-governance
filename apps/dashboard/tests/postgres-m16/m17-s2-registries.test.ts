import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  L15_DOMAIN_SUBJECT_MATRIX, L15_RISK_DOMAINS, L15_SCENARIO_SUBJECT_TOKENS, isLegalL15ScenarioSubject,
  type L15MethodologyVersionContent,
} from '@council/canonical-contracts';
import { methodologyContentHash, scenarioContentHash } from '@council/governance-review';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import {
  METHODOLOGY, NONE, REGISTRY_TABLES, SCENARIO, m17s2Kit, methodologyContent, rawMethodology, rawScenario, scenarioContent,
} from '../helpers/m17-s2-fixtures';
import { MACHINE, m17s1Kit, machineSignalSql, unresolved } from '../helpers/m17-s1-fixtures';

/**
 * M17-S2 — RISK_SCENARIO_DEFINITION + RISK_METHODOLOGY governed L15 registries on real disposable PostgreSQL 17 (M17S2
 * horizon). ADR-GOVIA-RISK-INTELLIGENCE-v1 §§7, 8.2, 9.2, 12, 17 — O19, O20, O21 plus the inherited S2-owned portions of
 * O01, O02, O04-O07, O53-O58, O62-O66, O73-O82, O84, O90. Every governance write goes through the real RPCs as service_role
 * with a verified principal; the L15 authority enters each organisation only through an Authority Policy successor.
 */
const M16_HISTORY = ['l14_authority_policies', 'l14_authority_policy_versions', 'l14_authority_policy_rules', 'l14_fact_states',
  'l14_registry_states', 'l14_support_links', 'l14_control_definitions', 'l14_control_definition_versions',
  'l14_control_definition_states', 'l14_control_definition_proposals', 'l14_control_definition_heads'];

test('M17-S2 scenario / methodology registries (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S2' });
  t.after(() => c.stop());
  const { owner, svc, exec, rejects } = c;
  const k = await m17s2Kit(c);
  const s1 = await m17s1Kit(c);
  const one = k.one, json = k.json;
    const x = await k.setup();
  const m16Digest = () => one(`select md5(string_agg(x, '|' order by x)) from (
    ${M16_HISTORY.map(tb => `select '${tb}:' || t::text as x from gov_repo.${tb} t where t.organisation_id = '${x.org}'`).join(' union all ')}) s`);
  const m16Before = await m16Digest();
  const registryCounts = async (org = x.org) => k.counts(org);
  const noGovernedState = async (org = x.org) => {
    const n = await registryCounts(org);
    return n.l15_risk_scenario_definition_states + n.l15_risk_methodology_states + n.l15_risk_scenario_definition_heads
      + n.l15_risk_methodology_heads;
  };

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('O19 scenario: ADMIT is not VALIDATE; DB hash; caller ids verbatim; normalized content; order-independent hash', async () => {
    const content = scenarioContent({ riskDomain: 'CYBERSECURITY', subjectKinds: ['TOOL', 'REL:USES_TOOL', 'MCP_SERVER'],
      references: [{ namespace: 'SCANNER_RULE_ID', code: 'RISK-AUTH-GAP' }, { namespace: 'CG_AG_CONTROL_ID', code: 'CG-AG-003' },
        { namespace: 'ORGANISATION_SCENARIO_CODE', code: 'CYB.TOOL-01' }] });
    const id = randomUUID(), ver = randomUUID();
    const before = await registryCounts();
    const r = await exec(k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('o19-s'), identityId: id, versionId: ver }, content));
    assert.deepEqual([r.outcome, r.authorization_result, r.scenario_definition_id, r.scenario_definition_version_id, r.predecessor_version_id,
      r.proposal_id, r.governance_decision_id, r.state_id], ['ADMITTED', 'ALLOW', id, ver, null, null, null, null]);
    assert.equal(r.content_hash, scenarioContentHash(content));
    assert.equal(await one(`select gov_repo.l15_risk_scenario_stored_content_hash_v1('${x.org}','${ver}')`), r.content_hash);
    // Input order never changes the DB hash.
    const shuffled = { ...content, subjectKinds: [...content.subjectKinds].reverse(), references: [...content.references].reverse() };
    assert.equal(await one(`select gov_repo.l15_risk_scenario_content_hash_v1(${['riskDomain', 'subjectKinds', 'ns', 'codes'].map((_, i) => {
      const raw = rawScenario(shuffled);
      const v = [raw.domain, raw.subjects, raw.ns, raw.codes][i];
      return Array.isArray(v) ? `array[${v.map(s => `'${s}'`).join(',')}]::text[]` : `'${v}'`;
    }).join(',')})`), r.content_hash);
    const after = await registryCounts();
    assert.equal(after.l15_risk_scenario_definitions, before.l15_risk_scenario_definitions + 1);
    assert.equal(after.l15_risk_scenario_definition_versions, before.l15_risk_scenario_definition_versions + 1);
    assert.equal(after.l15_risk_scenario_definition_subject_kinds, before.l15_risk_scenario_definition_subject_kinds + 3);
    assert.equal(after.l15_risk_scenario_definition_references, before.l15_risk_scenario_definition_references + 3);
    for (const tb of ['l15_risk_scenario_definition_states', 'l15_risk_scenario_definition_heads', 'l15_risk_scenario_definition_proposals',
      'l14_proposals', 'l14_governance_decisions', 'l15_support_links']) assert.equal(after[tb], before[tb], `ADMIT writes no ${tb}`);
    assert.equal(await k.resolve(SCENARIO, x.org, r, 'clock_timestamp()', 'clock_timestamp()'), null, 'admitted is not VALIDATED');
  });

  await t.test('O19 / attacks 1-2: a wrong caller content hash is rejected before any mutation (scenario + methodology)', async () => {
    const before = await registryCounts();
    const sc = scenarioContent({}, 'WRONG-HASH');
    await rejects(svc(k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('wh-s'), identityId: randomUUID(), versionId: randomUUID(),
      hash: 'f'.repeat(64) }, sc)), 'GV010', /CONTENT_HASH_MISMATCH/);
    const mc = methodologyContent();
    await rejects(svc(k.admitMethodologySql(x.methodologyAdmitter, { commandId: x.cmd('wh-m'), identityId: randomUUID(), versionId: randomUUID(),
      hash: methodologyContentHash(methodologyContent(2, 2)) }, mc)), 'GV010', /CONTENT_HASH_MISMATCH/);
    // A caller hash of DIFFERENT content with a fingerprint that matches it is still rejected (the DB hashes its own input).
    await rejects(svc(k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('wh-s2'), identityId: randomUUID(), versionId: randomUUID(),
      hash: scenarioContentHash(scenarioContent({}, 'OTHER')) }, sc)), 'GV010', /CONTENT_HASH_MISMATCH/);
    await rejects(svc(k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('wh-s3'), identityId: randomUUID(), versionId: randomUUID(),
      hash: 'NOT-A-HASH' }, sc)), 'GV010', /CONTENT_HASH_MALFORMED/);
    await rejects(svc(k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('wh-s4'), identityId: randomUUID(), versionId: randomUUID(),
      fingerprint: 'c'.repeat(64) }, sc)), 'GV008', /CALLER_FINGERPRINT_DIFFERS/);
    assert.deepEqual(await registryCounts(), before, 'nothing written, no command consumed');
  });

  await t.test('O19 methodology: ADMIT is not VALIDATE; DB hash over the complete normalized content; input order irrelevant', async () => {
    const content = methodologyContent(4, 3, { assessmentValidityMaximum: { months: 6, days: 0, microseconds: 0 } });
    const id = randomUUID(), ver = randomUUID();
    const r = await exec(k.admitMethodologySql(x.methodologyAdmitter, { commandId: x.cmd('o19-m'), identityId: id, versionId: ver }, content));
    assert.deepEqual([r.outcome, r.methodology_id, r.methodology_version_id, r.state_id], ['ADMITTED', id, ver, null]);
    assert.equal(r.content_hash, methodologyContentHash(content));
    assert.equal(await one(`select gov_repo.l15_risk_methodology_stored_content_hash_v1('${x.org}','${ver}')`), r.content_hash);
    const shuffled: L15MethodologyVersionContent = { ...content, likelihoodScale: [...content.likelihoodScale].reverse(),
      impactScale: [...content.impactScale].reverse(), ratingMatrix: [...content.ratingMatrix].reverse() };
    assert.equal(methodologyContentHash(shuffled), r.content_hash);
    const raw = rawMethodology(shuffled);
    const arr = (v: readonly unknown[], t2 = 'text') => `array[${v.map(s => (t2 === 'integer' ? String(s) : `'${s}'`)).join(',')}]::${t2}[]`;
    assert.equal(await one(`select gov_repo.l15_risk_methodology_content_hash_v1(${arr(raw.likCodes)},${arr(raw.likOrd, 'integer')},${arr(raw.likNs)},
      ${arr(raw.likDef)},${arr(raw.impCodes)},${arr(raw.impOrd, 'integer')},${arr(raw.impNs)},${arr(raw.impDef)},${arr(raw.mLik)},${arr(raw.mImp)},
      ${arr(raw.mBand)},'${raw.validity}'::interval)`), r.content_hash);
    assert.deepEqual(await json(`select json_build_object('l', (select count(*) from gov_repo.l15_risk_methodology_likelihood_levels where methodology_version_id='${ver}'),
      'i', (select count(*) from gov_repo.l15_risk_methodology_impact_levels where methodology_version_id='${ver}'),
      'c', (select count(*) from gov_repo.l15_risk_methodology_rating_cells where methodology_version_id='${ver}'),
      'v', (select assessment_validity_maximum::text from gov_repo.l15_risk_methodology_versions where methodology_version_id='${ver}'))`),
    { l: 4, i: 3, c: 12, v: '6 mons' });
    assert.equal(await k.resolve(METHODOLOGY, x.org, r, 'clock_timestamp()', 'clock_timestamp()'), null, 'no implicit validation');
    assert.equal(await noGovernedState(), 0);
  });

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('O19 / O53 / attacks 11-15: ADMIT and decisions need the exact mapped L15 permission; every other authority is a durable DENY', async () => {
    const y = await k.setup();
    const deny = async (label: string, r: Record<string, any>, reason = 'NO_MATCHING_AUTHORITY_RULE') => {
      assert.deepEqual([r.outcome, r.authorization_result, r.deny_reason], ['DENIED', 'DENY', reason], label);
    };
    // 11. ADMIT with only an L14 permission (CONTROL_DEFINITION ADMIT/VALIDATE).
    await deny('L14 only (scenario)', await k.admitScenario(y, 'l14-s', undefined, {}, y.l14Steward));
    await deny('L14 only (methodology)', await k.admitMethodology(y, 'l14-m', undefined, {}, y.l14Steward));
    // 12. ADMIT with the wrong L15 registry permission.
    await deny('methodology ADMIT on scenario', await k.admitScenario(y, 'wrong-s', undefined, {}, y.methodologyAdmitter));
    await deny('scenario ADMIT on methodology', await k.admitMethodology(y, 'wrong-m', undefined, {}, y.scenarioAdmitter));
    await deny('VALIDATE permission cannot ADMIT', await k.admitScenario(y, 'val-s', undefined, {}, y.scenarioValidator));
    // Admitted versions (correct permission) for the decision attacks.
    const sa = await k.admitScenario(y, 'ok-s');
    const ma = await k.admitMethodology(y, 'ok-m');
    const sp = k.proposalOf(SCENARIO, sa), mp = k.proposalOf(METHODOLOGY, ma);
    const ss = await exec(k.submitSql(y.member, { commandId: y.cmd('ok-s-sub'), proposal: sp }));
    const ms = await exec(k.submitSql(y.member, { commandId: y.cmd('ok-m-sub'), proposal: mp }));
    for (const [label, actor, prop, sub] of [
      ['13. ADMIT-only actor decides scenario', y.scenarioAdmitter, sp, ss], ['13. ADMIT-only actor decides methodology', y.methodologyAdmitter, mp, ms],
      ['11. L14-only actor decides scenario', y.l14Steward, sp, ss], ['14. scenario permission on methodology', y.scenarioValidator, mp, ms],
      ['15. methodology permission on scenario', y.methodologyValidator, sp, ss], ['legacy GOVERNANCE_ADMIN wildcard', y.admin, sp, ss],
    ] as const) {
      for (const outcome of ['VALIDATE', 'REJECT', 'DEFER'] as const) {
        await deny(`${label} ${outcome}`, await exec(k.decideSql(actor, { commandId: y.cmd(`${label}-${outcome}`), proposalId: sub.proposal_id,
          proposal: prop, outcome })));
      }
    }
    // A scenario proposal cannot be decided through the methodology RPC (and vice versa): the proposal does not resolve.
    await rejects(svc(k.decideSql(y.methodologyValidator, { commandId: y.cmd('cross-rpc'), proposalId: ss.proposal_id, proposal: sp, via: METHODOLOGY,
      reason: 'RISK_METHODOLOGY_VALIDATED', fingerprint: 'a'.repeat(64) })), 'GV010', /PROPOSAL_UNRESOLVED/);
    assert.equal(await noGovernedState(y.org), 0, 'DENY wrote no state / head');
    // Every DENY snapshotted no rule of another subject; an L14 rule was never snapshotted for an L15 decision.
    assert.equal(await one(`select count(*) from gov_repo.l14_authorization_decision_rules r join gov_repo.l14_authorization_decisions a
      using (organisation_id, authorization_decision_id) where a.organisation_id='${y.org}' and a.subject_kind in ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY')
      and r.permission is distinct from gov_repo.l15_governance_permission_v1(a.subject_kind, a.requested_action)`), '0');
    // The correctly authorized validator succeeds on the same proposals.
    assert.equal((await exec(k.decideSql(y.scenarioValidator, { commandId: y.cmd('ok-s-v'), proposalId: ss.proposal_id, proposal: sp }))).outcome, 'VALIDATED');
    assert.equal((await exec(k.decideSql(y.methodologyValidator, { commandId: y.cmd('ok-m-v'), proposalId: ms.proposal_id, proposal: mp }))).outcome, 'VALIDATED');
    // Each L15 ALLOW snapshotted exactly the mapped L15 permission for its action.
    assert.deepEqual(await json(`select json_agg(distinct a.subject_kind || ':' || a.requested_action || ':' || r.permission order by a.subject_kind || ':' || a.requested_action || ':' || r.permission)
      from gov_repo.l14_authorization_decisions a join gov_repo.l14_authorization_decision_rules r using (organisation_id, authorization_decision_id)
      where a.organisation_id='${y.org}' and a.result='ALLOW' and a.subject_kind in ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY')`),
    ['RISK_METHODOLOGY:ADMIT:L15_RISK_METHODOLOGY_ADMIT', 'RISK_METHODOLOGY:VALIDATE:L15_RISK_METHODOLOGY_VALIDATE',
      'RISK_SCENARIO_DEFINITION:ADMIT:L15_RISK_SCENARIO_ADMIT', 'RISK_SCENARIO_DEFINITION:VALIDATE:L15_RISK_SCENARIO_VALIDATE']);
  });

  await t.test('O55 / attack 16: an organisation without any L15 rule gets a durable, replayable DENY for every registry command (no L15 bootstrap)', async () => {
    const z = await k.setup(false);
    const content = scenarioContent({}, 'NO-RULE');
    const ops = { commandId: z.cmd('nr-s'), identityId: randomUUID(), versionId: randomUUID() };
    for (const actor of [z.admin, z.boot, z.scenarioAdmitter]) {
      const r = await exec(k.admitScenarioSql(actor, { ...ops, commandId: `${ops.commandId}-${actor.id.slice(0, 8)}` }, content));
      assert.deepEqual([r.outcome, r.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    }
    const r1 = await exec(k.admitScenarioSql(z.scenarioAdmitter, ops, content));
    const r2 = await exec(k.admitScenarioSql(z.scenarioAdmitter, ops, content));
    assert.deepEqual([r2.replay, r2.authorization_decision_id, r2.recorded_at], [true, r1.authorization_decision_id, r1.recorded_at]);
    await rejects(svc(k.admitScenarioSql(z.scenarioAdmitter, ops, scenarioContent({}, 'NO-RULE-CHANGED'))), 'GV007', /COMMAND_ID_REUSED/);
    const m = await exec(k.admitMethodologySql(z.methodologyAdmitter, { commandId: z.cmd('nr-m'), identityId: randomUUID(), versionId: randomUUID() }, methodologyContent()));
    assert.deepEqual([m.outcome, m.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    const n = await registryCounts(z.org);
    assert.equal(n.l15_risk_scenario_definition_versions + n.l15_risk_methodology_versions, 0, 'DENY admits no version');
  });

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('O04 / attacks 3-6: closed domains; exhaustive domain x subject matrix; empty / duplicate / non-direct subjects rejected', async () => {
    // The DB matrix equals the frozen §8.2 TS matrix over every domain x token (9 x 20 + unknowns).
    const dbMatrix = await json(`select json_object_agg(d || '|' || s, gov_repo.l15_risk_domain_subject_legal_v1(d, s))
      from unnest(array[${[...L15_RISK_DOMAINS, 'COMPLIANCE'].map(d => `'${d}'`).join(',')}]) d
      cross join unnest(array[${[...L15_SCENARIO_SUBJECT_TOKENS, 'PROMPT', 'SKILL', 'KNOWLEDGE_BASE', 'REL:UNKNOWN'].map(s => `'${s}'`).join(',')}]) s`) as Record<string, boolean>;
    let legal = 0;
    for (const [key, value] of Object.entries(dbMatrix)) {
      const [d, s] = key.split('|') as [string, string];
      assert.equal(value, isLegalL15ScenarioSubject(d, s), key);
      if (value) legal++;
    }
    assert.equal(legal, Object.values(L15_DOMAIN_SUBJECT_MATRIX).reduce((n, e) => n + e.objects.length + e.relationships.length, 0));
    assert.equal(dbMatrix['OPERATIONAL|AGENT'], true);
    for (const d of L15_RISK_DOMAINS.filter(d => d !== 'OPERATIONAL')) assert.equal(dbMatrix[`${d}|AGENT`], false, `AGENT only for OPERATIONAL (${d})`);
    const before = await registryCounts();
    const attempt = (label: string, raw: Parameters<typeof k.admitScenarioSqlRaw>[2]) => svc(k.admitScenarioSqlRaw(x.scenarioAdmitter,
      { commandId: x.cmd(`dom-${label}`), identityId: randomUUID(), versionId: randomUUID() }, raw));
    const base = rawScenario(scenarioContent({}, 'DOM'));
    for (const d of ['COMPLIANCE', 'REGULATORY', 'LEGAL', 'FINANCIAL', 'STRATEGIC', 'REPUTATIONAL', 'TECHNOLOGY', 'THIRD_PARTY',
      'ARCHITECTURAL', 'privacy', 'UNKNOWN', '']) {
      await rejects(attempt(`d-${d}`, { ...base, domain: d }), 'GV010', /RISK_DOMAIN_UNKNOWN/);
    }
    await rejects(attempt('d-null', { ...base, domain: null }), 'GV010', /RISK_DOMAIN_UNKNOWN/);
    await rejects(attempt('agent-privacy', { ...base, subjects: ['AGENT'] }), 'GV010', /DOMAIN_SUBJECT_ILLEGAL/);
    await rejects(attempt('model-privacy', { ...base, subjects: ['DATA_ELEMENT', 'REL:USES_MODEL'] }), 'GV010', /DOMAIN_SUBJECT_ILLEGAL/);
    await rejects(attempt('empty', { ...base, subjects: [] }), 'GV010', /SUBJECT_KINDS_EMPTY/);
    await rejects(attempt('dup', { ...base, subjects: ['DATA_ELEMENT', 'DATA_ELEMENT'] }), 'GV010', /SUBJECT_KIND_DUPLICATE/);
    for (const s of ['PROMPT', 'KNOWLEDGE_BASE', 'SKILL', 'REL:PROMPT', 'READS_FROM', 'data_element']) {
      await rejects(attempt(`tok-${s}`, { ...base, subjects: [s] }), 'GV010', /SUBJECT_KIND_UNKNOWN/);
    }
    await rejects(attempt('null-subject', { ...base, subjects: ['DATA_ELEMENT', null] }), 'GV010', /SUBJECT_KINDS_MALFORMED/);
    assert.deepEqual(await registryCounts(), before, 'nothing admitted, nothing consumed');
    // Owner-level forgery: an illegal (domain, subject) row is rejected by the table CHECK even inside a version's transaction.
    await assert.rejects(owner(`insert into gov_repo.l15_risk_scenario_definition_subject_kinds(organisation_id, scenario_definition_version_id, risk_domain, subject_kind)
      select organisation_id, scenario_definition_version_id, 'PRIVACY', 'AGENT' from gov_repo.l15_risk_scenario_definition_versions limit 1`),
    /l15_risk_scenario_definition_subject_kinds_legal_check|REGISTRY_CONTENT_NOT_IN_VERSION_TRANSACTION/);
    // Legal: AGENT for OPERATIONAL; every relationship type for OPERATIONAL.
    const op = await k.admitScenario(x, 'op', scenarioContent({ riskDomain: 'OPERATIONAL', subjectKinds: ['AGENT', ...L15_SCENARIO_SUBJECT_TOKENS.filter(s => s.startsWith('REL:'))] }, 'OP-1'));
    assert.equal(op.outcome, 'ADMITTED');
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_scenario_definition_subject_kinds where scenario_definition_version_id='${op.scenario_definition_version_id}'`), '13');
  });

  await t.test('typed reference codes: closed namespaces, bounded syntax, no free text, no duplicates; never identity', async () => {
    const base = rawScenario(scenarioContent({}, 'REF'));
    const attempt = (label: string, ns: string[], codes: string[]) => svc(k.admitScenarioSqlRaw(x.scenarioAdmitter,
      { commandId: x.cmd(`ref-${label}`), identityId: randomUUID(), versionId: randomUUID() }, { ...base, ns, codes }));
    await rejects(attempt('none', [], []), 'GV010', /REFERENCES_MALFORMED/);
    await rejects(attempt('mismatch', ['SCANNER_RULE_ID'], []), 'GV010', /REFERENCES_MALFORMED/);
    await rejects(attempt('ns', ['URL'], ['https://example.invalid']), 'GV010', /REFERENCE_NAMESPACE_UNKNOWN/);
    await rejects(attempt('label', ['ORGANISATION_SCENARIO_CODE'], ['Sensitive data read by agent']), 'GV010', /REFERENCE_CODE_MALFORMED/);
    await rejects(attempt('scanner-lower', ['SCANNER_RULE_ID'], ['risk-no-readme']), 'GV010', /REFERENCE_CODE_MALFORMED/);
    await rejects(attempt('cgag', ['CG_AG_CONTROL_ID'], ['CG-AG-1']), 'GV010', /REFERENCE_CODE_MALFORMED/);
    await rejects(attempt('long', ['ORGANISATION_SCENARIO_CODE'], ['A'.repeat(65)]), 'GV010', /REFERENCE_CODE_MALFORMED/);
    await rejects(attempt('dup', ['CG_AG_CONTROL_ID', 'CG_AG_CONTROL_ID'], ['CG-AG-001', 'CG-AG-001']), 'GV010', /REFERENCE_DUPLICATE/);
    // The SAME references under two identities are two independent scenarios (references never define identity).
    const same = scenarioContent({}, 'SAME-REF');
    const a = await k.admitScenario(x, 'same-a', same), b = await k.admitScenario(x, 'same-b', same);
    assert.notEqual(a.scenario_definition_id, b.scenario_definition_id);
    assert.equal(a.content_hash, b.content_hash, 'identical content hashes, distinct identities');
    const va = await k.validate(x, 'same-a-v', SCENARIO, a);
    assert.equal(va.decided.outcome, 'VALIDATED');
    assert.equal(await k.resolve(SCENARIO, x.org, b, 'clock_timestamp()', 'clock_timestamp()'), null, 'validating one never resolves the other');
  });

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('O20 / attacks 26-36: scale cardinality, ordinals, codes, total matrix, bands and validity maximum (RPC + TS mirror)', async () => {
    const before = await registryCounts();
    const valid = methodologyContent(3, 3);
    const attempt = (label: string, raw: Parameters<typeof k.admitMethodologySqlRaw>[2]) => svc(k.admitMethodologySqlRaw(x.methodologyAdmitter,
      { commandId: x.cmd(`o20-${label}`), identityId: randomUUID(), versionId: randomUUID() }, raw));
    const r = rawMethodology(valid);
    const one1 = rawMethodology(methodologyContent(1, 3)), eight = rawMethodology({ ...methodologyContent(7, 3) });
    const lik8 = { ...eight, likCodes: [...eight.likCodes, 'L8'], likOrd: [...eight.likOrd, 8], likNs: [...eight.likNs, 'ORGANISATION_DEFINITION_CODE'],
      likDef: [...eight.likDef, 'DEF-L8'], mLik: [...eight.mLik, 'L8', 'L8', 'L8'], mImp: [...eight.mImp, 'I1', 'I2', 'I3'], mBand: [...eight.mBand, 'HIGH', 'HIGH', 'HIGH'] };
    const imp1 = rawMethodology(methodologyContent(3, 1));
    const imp8base = rawMethodology(methodologyContent(3, 7));
    const imp8 = { ...imp8base, impCodes: [...imp8base.impCodes, 'I8'], impOrd: [...imp8base.impOrd, 8], impNs: [...imp8base.impNs, 'ORGANISATION_DEFINITION_CODE'],
      impDef: [...imp8base.impDef, 'DEF-I8'], mLik: [...imp8base.mLik, 'L1', 'L2', 'L3'], mImp: [...imp8base.mImp, 'I8', 'I8', 'I8'], mBand: [...imp8base.mBand, 'LOW', 'LOW', 'LOW'] };
    await rejects(attempt('lik1', one1), 'GV010', /LIKELIHOOD_SCALE_SIZE_INVALID/);
    await rejects(attempt('lik8', lik8), 'GV010', /LIKELIHOOD_SCALE_SIZE_INVALID/);
    await rejects(attempt('imp1', imp1), 'GV010', /IMPACT_SCALE_SIZE_INVALID/);
    await rejects(attempt('imp8', imp8), 'GV010', /IMPACT_SCALE_SIZE_INVALID/);
    await rejects(attempt('dup-ord', { ...r, likOrd: [1, 1, 3] }), 'GV010', /LIKELIHOOD_LEVEL_ORDINAL_INVALID/);
    await rejects(attempt('gap-ord', { ...r, impOrd: [1, 2, 4] }), 'GV010', /IMPACT_LEVEL_ORDINAL_INVALID/);
    await rejects(attempt('zero-ord', { ...r, likOrd: [0, 1, 2] }), 'GV010', /LIKELIHOOD_LEVEL_ORDINAL_INVALID/);
    await rejects(attempt('dup-code', { ...r, likCodes: ['L1', 'L1', 'L3'] }), 'GV010', /LIKELIHOOD_LEVEL_CODE_DUPLICATE/);
    await rejects(attempt('bad-code', { ...r, impCodes: ['i1', 'I2', 'I3'] }), 'GV010', /IMPACT_LEVEL_CODE_MALFORMED/);
    await rejects(attempt('bad-def', { ...r, likDef: ['free text definition', 'DEF-L2', 'DEF-L3'] }), 'GV010', /LIKELIHOOD_DEFINITION_REFERENCE_MALFORMED/);
    await rejects(attempt('bad-def-ns', { ...r, impNs: ['URL', 'ORGANISATION_DEFINITION_CODE', 'ORGANISATION_DEFINITION_CODE'] }), 'GV010', /IMPACT_DEFINITION_REFERENCE_MALFORMED/);
    await rejects(attempt('missing-cell', { ...r, mLik: r.mLik.slice(1), mImp: r.mImp.slice(1), mBand: r.mBand.slice(1) }), 'GV010', /RATING_MATRIX_INCOMPLETE/);
    await rejects(attempt('dup-cell', { ...r, mLik: [...r.mLik.slice(1), 'L3'], mImp: [...r.mImp.slice(1), 'I3'], mBand: [...r.mBand.slice(1), 'LOW'] }),
      'GV010', /RATING_MATRIX_CELL_DUPLICATE/);
    await rejects(attempt('extra-cell', { ...r, mLik: [...r.mLik, 'L1'], mImp: [...r.mImp, 'I1'], mBand: [...r.mBand, 'LOW'] }), 'GV010', /RATING_MATRIX_CELL_DUPLICATE/);
    await rejects(attempt('unknown-level', { ...r, mLik: ['L9', ...r.mLik.slice(1)] }), 'GV010', /RATING_MATRIX_LEVEL_UNKNOWN/);
    await rejects(attempt('cross-scale-level', { ...r, mImp: ['L1', ...r.mImp.slice(1)] }), 'GV010', /RATING_MATRIX_LEVEL_UNKNOWN/);
    for (const band of ['SEVERE', 'low', 'NONE', '9']) {
      await rejects(attempt(`band-${band}`, { ...r, mBand: [band, ...r.mBand.slice(1)] }), 'GV010', /RATING_BAND_UNKNOWN/);
    }
    for (const v of ['0 days', '-1 days', '1 day -2 hours', '-1 mons 40 days', '00:00:00']) {
      await rejects(attempt(`validity-${v}`, { ...r, validity: v }), 'GV010', /ASSESSMENT_VALIDITY_MAXIMUM_INVALID/);
    }
    await rejects(attempt('validity-null', { ...r, validity: null }), 'GV010', /ASSESSMENT_VALIDITY_MAXIMUM_INVALID/);
    await rejects(attempt('null-level', { ...r, likCodes: ['L1', null, 'L3'] }), 'GV010', /LIKELIHOOD_SCALE_MALFORMED/);
    assert.deepEqual(await registryCounts(), before, 'nothing admitted, nothing consumed');
    // The TS mirror rejects the same content with the same closed reason (preflight UX only).
    assert.throws(() => methodologyContentHash(methodologyContent(1, 3)), /LIKELIHOOD_SCALE_SIZE_INVALID/);
    assert.throws(() => methodologyContentHash({ ...valid, ratingMatrix: valid.ratingMatrix.slice(1) }), /RATING_MATRIX_INCOMPLETE/);
    assert.throws(() => methodologyContentHash({ ...valid, assessmentValidityMaximum: { months: 0, days: 0, microseconds: 0 } }), /ASSESSMENT_VALIDITY_MAXIMUM_INVALID/);
    // Complete valid matrices are accepted at both bounds (2 x 2 and 7 x 7) and asymmetric sizes.
    for (const [n, m] of [[2, 2], [7, 7], [2, 7], [5, 3]] as const) {
      const ok = await k.admitMethodology(x, `o20-ok-${n}x${m}`, methodologyContent(n, m));
      assert.equal(ok.outcome, 'ADMITTED');
      assert.equal(await one(`select count(*) from gov_repo.l15_risk_methodology_rating_cells where methodology_version_id='${ok.methodology_version_id}'`), String(n * m));
    }
  });

  await t.test('O20 at commit: even the owner cannot add a cell / level to an admitted version or commit a non-total matrix', async () => {
    const ok = await k.admitMethodology(x, 'o20-owner');
    // Outside the version's transaction: refused immediately.
    await assert.rejects(owner(`insert into gov_repo.l15_risk_methodology_rating_cells values ('${x.org}', '${ok.methodology_version_id}', 'L1', 'I1', 'LOW')`),
      /REGISTRY_CONTENT_NOT_IN_VERSION_TRANSACTION|duplicate key/);
    await assert.rejects(owner(`insert into gov_repo.l15_risk_methodology_likelihood_levels values ('${x.org}', '${ok.methodology_version_id}', 4, 'L4',
      'ORGANISATION_DEFINITION_CODE', 'DEF-L4')`), /REGISTRY_CONTENT_NOT_IN_VERSION_TRANSACTION/);
    // Inside the version's own transaction (owner calling the RPC, then forging an extra level): the commit guard refuses.
    const content = methodologyContent(2, 2);
    const ver = randomUUID();
    const sql = k.admitMethodologySql(x.methodologyAdmitter, { commandId: x.cmd('o20-forge'), identityId: randomUUID(), versionId: ver }, content);
    await assert.rejects(owner(`begin; ${sql} insert into gov_repo.l15_risk_methodology_likelihood_levels values ('${x.org}', '${ver}', 3, 'L3',
      'ORGANISATION_DEFINITION_CODE', 'DEF-L3'); commit;`), /RISK_METHODOLOGY_VERSION_CONTENT_INCOMPLETE/);
    const sver = randomUUID();
    const ssql = k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('o20-sforge'), identityId: randomUUID(), versionId: sver }, scenarioContent({}, 'FORGE'));
    await assert.rejects(owner(`begin; ${ssql} insert into gov_repo.l15_risk_scenario_definition_references values ('${x.org}', '${sver}',
      'CG_AG_CONTROL_ID', 'CG-AG-009'); commit;`), /RISK_SCENARIO_DEFINITION_VERSION_CONTENT_INCOMPLETE/);
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_methodology_versions where methodology_version_id in ('${ver}')`), '0');
  });

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('identity / version lineage (attacks 7-8): opaque ids, linear lineage, no reuse, no fork; v2 neither validates nor revokes v1', async () => {
    const v1 = await k.admitScenario(x, 'lin-1');
    const id = v1.scenario_definition_id as string;
    // 7. a version id reused under another identity (or the same) is refused.
    await rejects(svc(k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('lin-reuse'), identityId: randomUUID(),
      versionId: v1.scenario_definition_version_id }, scenarioContent({}, 'LIN-R'))), 'GV009', /RISK_SCENARIO_DEFINITION_VERSION_ID_EXISTS/);
    // EXPECTED_NONE over an existing identity, a blind / stale predecessor.
    await rejects(svc(k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('lin-none'), identityId: id, versionId: randomUUID() },
      scenarioContent({}, 'LIN-N'))), 'GV009', /RISK_SCENARIO_DEFINITION_EXISTS/);
    const v2 = await exec(k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('lin-2'), identityId: id, versionId: randomUUID(),
      expectation: { kind: 'EXPECTED_CURRENT', latestVersionId: v1.scenario_definition_version_id } }, scenarioContent({ riskDomain: 'DATA',
      subjectKinds: ['DATA_ASSET'] }, 'LIN-2')));
    assert.deepEqual([v2.outcome, v2.predecessor_version_id], ['ADMITTED', v1.scenario_definition_version_id]);
    // 8. stale predecessor (v1 is no longer the latest).
    await rejects(svc(k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('lin-stale'), identityId: id, versionId: randomUUID(),
      expectation: { kind: 'EXPECTED_CURRENT', latestVersionId: v1.scenario_definition_version_id } }, scenarioContent({}, 'LIN-S'))),
    'GV009', /RISK_SCENARIO_DEFINITION_VERSION_EXPECTATION_MISMATCH/);
    // A foreign organisation's identity reads as unknown (cross-tenant predecessor).
    const other = await k.setup();
    await rejects(svc(k.admitScenarioSql(other.scenarioAdmitter, { commandId: other.cmd('lin-foreign'), identityId: id, versionId: randomUUID(),
      expectation: { kind: 'EXPECTED_CURRENT', latestVersionId: v2.scenario_definition_version_id } }, scenarioContent({}, 'LIN-F'))),
    'GV009', /RISK_SCENARIO_DEFINITION_VERSION_EXPECTATION_MISMATCH/);
    // Admitting v2 did not validate / revoke / replace v1; both are governed independently.
    assert.equal(await k.resolve(SCENARIO, x.org, v1, 'clock_timestamp()', 'clock_timestamp()'), null);
    const s1v = await k.validate(x, 'lin-1-v', SCENARIO, v1), s2v = await k.validate(x, 'lin-2-v', SCENARIO, v2);
    assert.equal(s1v.decided.outcome, 'VALIDATED');
    assert.equal(s2v.decided.outcome, 'VALIDATED');
    assert.equal(await k.resolve(SCENARIO, x.org, v1, 'clock_timestamp()', 'clock_timestamp()'), s1v.decided.state_id);
    assert.equal(await k.resolve(SCENARIO, x.org, v2, 'clock_timestamp()', 'clock_timestamp()'), s2v.decided.state_id);
    // No "current version" pointer exists anywhere; the identity row carries no content.
    assert.equal(await one(`select count(*) from information_schema.columns where table_schema='gov_repo' and table_name like 'l15\\_risk\\_%'
      and column_name ~ '(current|latest)_version'`), '0');
    assert.deepEqual(await json(`select json_agg(column_name order by ordinal_position) from information_schema.columns
      where table_schema='gov_repo' and table_name='l15_risk_scenario_definitions'`),
    ['organisation_id', 'scenario_definition_id', 'admission_authorization_decision_id', 'admission_authorization_result',
      'admission_subject_kind', 'admission_requested_action', 'recorded_at']);
  });

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('proposal / decision lifecycle: REJECT / DEFER write no state; terminality + correction; exact REVOKE (attacks 24-25); re-validation; immutable history', async () => {
    const v = await k.admitMethodology(x, 'lc');
    const p = k.proposalOf(METHODOLOGY, v);
    const s1sub = await exec(k.submitSql(x.member, { commandId: x.cmd('lc-s1'), proposal: p }));
    const deferred = await exec(k.decideSql(x.methodologyValidator, { commandId: x.cmd('lc-defer'), proposalId: s1sub.proposal_id, proposal: p, outcome: 'DEFER' }));
    assert.deepEqual([deferred.outcome, deferred.state_id], ['DEFERRED', null]);
    const rejected = await exec(k.decideSql(x.methodologyValidator, { commandId: x.cmd('lc-reject'), proposalId: s1sub.proposal_id, proposal: p, outcome: 'REJECT' }));
    assert.deepEqual([rejected.outcome, rejected.state_id], ['REJECTED', null]);
    await rejects(svc(k.decideSql(x.methodologyValidator, { commandId: x.cmd('lc-after-reject'), proposalId: s1sub.proposal_id, proposal: p })),
      'GV010', /PROPOSAL_TERMINAL/);
    assert.equal((await registryCounts()).l15_risk_methodology_states, 0, 'REJECT / DEFER wrote no state');
    // Correction: a new proposal linked to the rejected one.
    const s2sub = await exec(k.submitSql(x.member, { commandId: x.cmd('lc-s2'), proposal: p, prior: s1sub.proposal_id }));
    const validated = await exec(k.decideSql(x.methodologyValidator, { commandId: x.cmd('lc-v'), proposalId: s2sub.proposal_id, proposal: p }));
    assert.equal(validated.outcome, 'VALIDATED');
    assert.equal(await one(`select l15_state_id from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${x.cmd('lc-v')}'`), validated.state_id);
    const stateRow = await one(`select s::text from gov_repo.l15_risk_methodology_states s where state_id='${validated.state_id}'`);
    // Double VALIDATE of the same tuple is impossible (stale expectation / already validated).
    const s3sub = await exec(k.submitSql(x.member, { commandId: x.cmd('lc-s3'), proposal: p }));
    await rejects(svc(k.decideSql(x.methodologyValidator, { commandId: x.cmd('lc-v2'), proposalId: s3sub.proposal_id, proposal: p })), 'GV009', /STATE_EXISTS/);
    await rejects(svc(k.decideSql(x.methodologyValidator, { commandId: x.cmd('lc-v3'), proposalId: s3sub.proposal_id, proposal: p,
      expected: validated.state_id })), 'GV010', /RISK_METHODOLOGY_ALREADY_VALIDATED/);
    // 24. REVOKE targeting another tuple's state / an unknown state / the wrong intent.
    const w = await k.admitMethodology(x, 'lc-w');
    const wv = await k.validate(x, 'lc-w-v', METHODOLOGY, w);
    await rejects(svc(k.submitSql(x.member, { commandId: x.cmd('lc-rv-wrong'), proposal: { ...p, intent: 'REVOKE', targetStateId: wv.decided.state_id } })),
      'GV010', /TARGET_STATE_UNRESOLVED/);
    await rejects(svc(k.submitSql(x.member, { commandId: x.cmd('lc-rv-unknown'), proposal: { ...p, intent: 'REVOKE', targetStateId: randomUUID() } })),
      'GV010', /TARGET_STATE_UNRESOLVED/);
    const revoked = await k.revoke(x, 'lc-rv', METHODOLOGY, v, validated.state_id);
    assert.equal(revoked.decided.outcome, 'REVOKED');
    // 25. REVOKE an already revoked state / stale expected current.
    await rejects(svc(k.submitSql(x.member, { commandId: x.cmd('lc-rv-again'), proposal: { ...p, intent: 'REVOKE', targetStateId: validated.state_id } })),
      'GV010', /TARGET_ALREADY_REVOKED/);
    const rp = { ...p, intent: 'REVOKE' as const, targetStateId: validated.state_id };
    await rejects(svc(k.decideSql(x.methodologyValidator, { commandId: x.cmd('lc-rv-stale'), proposalId: revoked.submitted.proposal_id, proposal: rp,
      outcome: 'REVOKE', expected: validated.state_id })), 'GV010', /PROPOSAL_TERMINAL/);
    // The predecessor row is byte-identical after revocation (successor never edits it).
    assert.equal(await one(`select s::text from gov_repo.l15_risk_methodology_states s where state_id='${validated.state_id}'`), stateRow);
    // Re-validation after the tombstone, then lineage VALIDATED > REVOKED > VALIDATED; head = tail.
    const re = await k.validate(x, 'lc-re', METHODOLOGY, v, x.methodologyValidator, revoked.decided.state_id);
    assert.equal(re.decided.outcome, 'VALIDATED');
    assert.equal(await one(`select string_agg(state_kind, '>' order by recorded_at) from gov_repo.l15_risk_methodology_states where methodology_version_id='${v.methodology_version_id}'`),
      'VALIDATED>REVOKED>VALIDATED');
    assert.equal(await one(`select latest_state_id from gov_repo.l15_risk_methodology_heads where methodology_version_id='${v.methodology_version_id}'`), re.decided.state_id);
    // The head is reconstructible: the lineage state without a successor.
    assert.equal(await one(`select s.state_id from gov_repo.l15_risk_methodology_states s where s.methodology_version_id='${v.methodology_version_id}'
      and not exists (select 1 from gov_repo.l15_risk_methodology_states n where n.predecessor_state_id = s.state_id)`), re.decided.state_id);
    // Every state pins its exact decision, authorization and effective Authority Policy version + hash.
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_methodology_states s join gov_repo.l14_governance_decisions d
      on d.organisation_id=s.organisation_id and d.governance_decision_id=s.governance_decision_id and d.proposal_id=s.proposal_id
      join gov_repo.l14_authorization_decisions a on a.organisation_id=s.organisation_id and a.authorization_decision_id=s.authorization_decision_id
       and a.basis_version_id=s.authority_policy_version_id and a.basis_content_hash=s.authority_policy_content_hash and a.result='ALLOW'
      where s.methodology_version_id='${v.methodology_version_id}'`), '3');
  });

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('O21 / attacks 17-20, 42: SYSTEM_SEED is provenance only — no validation by seeding, no authority, human decision required', async () => {
    const y = await k.setup();
    const seedContent = scenarioContent({ riskDomain: 'CYBERSECURITY', subjectKinds: ['TOOL'],
      references: [{ namespace: 'SCANNER_RULE_ID', code: 'RISK-NO-RATE-LIMIT' }, { namespace: 'CG_AG_CONTROL_ID', code: 'CG-AG-007' }] }, 'SEED-1');
    // A seed version still needs the ADMIT permission: an unauthorized seeder gets a durable DENY.
    const deniedSeed = await k.admitScenario(y, 'seed-deny', seedContent, { sourceClass: 'SYSTEM_SEED' }, y.member);
    assert.deepEqual([deniedSeed.outcome, deniedSeed.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    await rejects(svc(k.admitScenarioSql(y.scenarioAdmitter, { commandId: y.cmd('seed-sc'), identityId: randomUUID(), versionId: randomUUID(),
      sourceClass: 'SOURCE_CONNECTION', fingerprint: 'a'.repeat(64) }, seedContent)), 'GV010', /SOURCE_CLASS_NOT_EXECUTABLE/);
    const seeded = await k.admitScenario(y, 'seed', seedContent, { sourceClass: 'SYSTEM_SEED' });
    assert.equal(seeded.outcome, 'ADMITTED');
    assert.equal(await one(`select source_class from gov_repo.l15_risk_scenario_definition_versions where scenario_definition_version_id='${seeded.scenario_definition_version_id}'`), 'SYSTEM_SEED');
    const seedProposal = k.proposalOf(SCENARIO, seeded, { sourceClass: 'SYSTEM_SEED' });
    // A seed proposal must carry PRESENT DISCOVERY_EVIDENCE / SOURCE_ASSERTION support.
    await rejects(svc(k.submitSql(y.member, { commandId: y.cmd('seed-nosupport'), proposal: seedProposal, fingerprint: 'a'.repeat(64) })),
      'GV010', /SYSTEM_SEED_SUPPORT_REQUIRED/);
    // Laundering: a LOCAL_HUMAN proposal over a SYSTEM_SEED version (and vice versa) is refused.
    await rejects(svc(k.submitSql(y.member, { commandId: y.cmd('seed-launder'), proposal: { ...seedProposal, sourceClass: 'LOCAL_HUMAN' } })),
      'GV010', /SOURCE_CLASS_LINEAGE_MISMATCH/);
    const support = { status: 'PRESENT' as const, entries: [{ tag: 'DISCOVERY_EVIDENCE' as const, targetId: y.evidence },
      { tag: 'SOURCE_ASSERTION' as const, targetId: y.assertion }] };
    // The seed proposal is submitted (human-mediated) by the validator itself; it creates no validation.
    const before = await registryCounts(y.org);
    const sub = await exec(k.submitSql(y.scenarioValidator, { commandId: y.cmd('seed-submit'), proposal: seedProposal, support }));
    assert.equal(sub.outcome, 'SUBMITTED');
    const afterSubmit = await registryCounts(y.org);
    assert.equal(afterSubmit.l15_risk_scenario_definition_states, before.l15_risk_scenario_definition_states, 'seeding validates nothing');
    assert.equal(afterSubmit.l15_support_links, before.l15_support_links + 2, 'seed provenance support links written with the proposal');
    assert.equal(await k.resolve(SCENARIO, y.org, seeded, 'clock_timestamp()', 'clock_timestamp()'), null);
    // 17/42. No seed / source / scanner provenance creates authority: ADMIT-only, L14-only, member and admin are denied.
    for (const [label, actor] of [['admitter', y.scenarioAdmitter], ['l14', y.l14Steward], ['member', y.member], ['admin', y.admin]] as const) {
      const r = await exec(k.decideSql(actor, { commandId: y.cmd(`seed-deny-${label}`), proposalId: sub.proposal_id, proposal: seedProposal }));
      assert.deepEqual([r.outcome, r.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE'], label);
    }
    // 20. Self-validation (the submitter deciding its own proposal) fails closed absent an explicit policy grant.
    const self = await exec(k.decideSql(y.scenarioValidator, { commandId: y.cmd('seed-self'), proposalId: sub.proposal_id, proposal: seedProposal }));
    assert.deepEqual([self.outcome, self.deny_reason], ['DENIED', 'SELF_VALIDATION_NOT_PERMITTED']);
    // 18. The machine intake LOGIN cannot reach any registry RPC (EXECUTE denied).
    await rejects(s1.machine(k.decideSql(y.scenarioValidator2, { commandId: y.cmd('seed-machine'), proposalId: sub.proposal_id, proposal: seedProposal })),
      '42501', /permission denied/);
    await rejects(s1.machine(k.admitScenarioSql(y.scenarioAdmitter, { commandId: y.cmd('seed-machine-admit'), identityId: randomUUID(),
      versionId: randomUUID() }, seedContent)), '42501', /permission denied/);
    // 19. service_role without a verified principal (forged / inactive / foreign actor) gets nothing.
    await rejects(svc(k.decideSql(y.scenarioValidator2, { commandId: y.cmd('seed-forged'), proposalId: sub.proposal_id, proposal: seedProposal,
      session: { epoch: `'2000-01-01'::timestamptz` } })), 'GV00[1-5]');
    await rejects(svc(`select gov_repo.l15_decide_scenario_proposal_v1(null,null,null,null,null,'${y.cmd('seed-null')}','${sub.proposal_id}',
      'VALIDATE','RISK_SCENARIO_DEFINITION_VALIDATED',null,'NONE','{}','{}','${'a'.repeat(64)}')`), 'GV00[1-5]|L14_|M16_');
    assert.equal(await k.resolve(SCENARIO, y.org, seeded, 'clock_timestamp()', 'clock_timestamp()'), null, 'still not VALIDATED');
    // Only a normal authorized, verified ACTIVE human decision under the effective Authority Policy validates it.
    const ok = await exec(k.decideSql(y.scenarioValidator2, { commandId: y.cmd('seed-validate'), proposalId: sub.proposal_id, proposal: seedProposal, support }));
    assert.deepEqual([ok.outcome, ok.state_kind], ['VALIDATED', 'VALIDATED']);
    assert.deepEqual(await json(`select json_build_object('source', s.source_class, 'support', s.support_status, 'actor', d.actor_user_id,
        'rule_source', (select string_agg(distinct r.source_class || '/' || r.source_disposition || '/' || r.permission_origin, ',')
          from gov_repo.l14_authorization_decision_rules r where r.organisation_id=s.organisation_id and r.authorization_decision_id=s.authorization_decision_id),
        'authz_source', a.source_class, 'basis', a.authority_basis)
      from gov_repo.l15_risk_scenario_definition_states s
      join gov_repo.l14_governance_decisions d on d.organisation_id=s.organisation_id and d.governance_decision_id=s.governance_decision_id
      join gov_repo.l14_authorization_decisions a on a.organisation_id=s.organisation_id and a.authorization_decision_id=s.authorization_decision_id
      where s.state_id='${ok.state_id}'`),
    { source: 'SYSTEM_SEED', support: 'PRESENT', actor: y.scenarioValidator2.id, rule_source: 'LOCAL_HUMAN/AUTHORITATIVE/AUTHORITY_POLICY_RULE',
      authz_source: 'SYSTEM_SEED', basis: 'AUTHORITY_POLICY_VERSION' });
    // The same holds for a seed methodology (no default methodology is ever shipped / validated by seeding).
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_methodology_versions where source_class='SYSTEM_SEED'`), '0', 'no default methodology shipped');
    const sm = await k.admitMethodology(y, 'seed-m', methodologyContent(5, 5), { sourceClass: 'SYSTEM_SEED' });
    const smp = k.proposalOf(METHODOLOGY, sm, { sourceClass: 'SYSTEM_SEED' });
    const smsub = await exec(k.submitSql(y.member, { commandId: y.cmd('seed-m-submit'), proposal: smp, support: k.evidenceSupport(y.evidence) }));
    assert.equal(await k.resolve(METHODOLOGY, y.org, sm, 'clock_timestamp()', 'clock_timestamp()'), null);
    assert.equal((await exec(k.decideSql(y.methodologyValidator, { commandId: y.cmd('seed-m-v'), proposalId: smsub.proposal_id, proposal: smp }))).outcome, 'VALIDATED');
  });

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('O79-O82 / O84 / attacks 37-40: rank-3 registry support targets DISCOVERY_EVIDENCE / SOURCE_ASSERTION only; same tenant; with the owner', async () => {
    const v = await k.admitScenario(x, 'sup');
    const p = k.proposalOf(SCENARIO, v);
    const runtime = await s1.evidence(x.org);
    const sig = await s1.run(s1.machine, machineSignalSql({ org: x.org, key: 'sup-sig', kind: 'DETECTED_ABSENCE', source: 'SYSTEM_DETECTOR',
      subject: unresolved(), trust: 'INFERRED', methodId: 'SCANNER_DETECTED_RISK:RISK-NO-README', methodVersion: '1',
      tags: ['DISCOVERY_EVIDENCE'], ids: [runtime] }));
    const before = await registryCounts();
    for (const [tag, id] of [['RISK_SIGNAL', sig.signal_id], ['RISK_HYPOTHESIS', randomUUID()], ['RUNTIME_OBSERVATION', randomUUID()],
      ['L14_FACT_STATE', randomUUID()], ['TECHNICAL_FIELD_STATE', 'tstate'], ['LINEAGE_OBSERVATION', 'f'], ['CROSS_SIGNAL_RESULT', 'c'],
      ['EXECUTION_FIELD_STATE', 'e']] as const) {
      await rejects(svc(k.submitSql(x.member, { commandId: x.cmd(`sup-${tag}`), proposal: p, fingerprint: 'a'.repeat(64),
        support: { status: 'PRESENT', entries: [{ tag, targetId: id }] } as never })), 'GV010', /SUPPORT_TARGET_NOT_ADMISSIBLE/);
    }
    await rejects(svc(k.submitSql(x.member, { commandId: x.cmd('sup-unknown'), proposal: p, fingerprint: 'a'.repeat(64),
      support: { status: 'PRESENT', entries: [{ tag: 'GOVERNED_RISK', targetId: randomUUID() }] } as never })), 'GV010', /SUPPORT_TAG_UNKNOWN/);
    // Cross-tenant DISCOVERY_EVIDENCE / SOURCE_ASSERTION.
    const other = await k.setup();
    for (const [tag, id] of [['DISCOVERY_EVIDENCE', other.evidence], ['SOURCE_ASSERTION', other.assertion]] as const) {
      await rejects(svc(k.submitSql(x.member, { commandId: x.cmd(`sup-x-${tag}`), proposal: p,
        support: { status: 'PRESENT', entries: [{ tag, targetId: id }] } })), 'GV010', /SUPPORT_TARGET_UNRESOLVED/);
    }
    await rejects(svc(k.submitSql(x.member, { commandId: x.cmd('sup-dup'), proposal: p, fingerprint: 'a'.repeat(64),
      support: { status: 'PRESENT', entries: [{ tag: 'DISCOVERY_EVIDENCE', targetId: x.evidence }, { tag: 'DISCOVERY_EVIDENCE', targetId: x.evidence }] } })),
    'GV010', /SUPPORT_DUPLICATE/);
    await rejects(svc(k.submitSql(x.member, { commandId: x.cmd('sup-status'), proposal: p, fingerprint: 'a'.repeat(64),
      support: { status: 'NONE', entries: [{ tag: 'DISCOVERY_EVIDENCE', targetId: x.evidence }] } as never })), 'GV010', /SUPPORT_MALFORMED/);
    assert.deepEqual(await registryCounts(), before, 'nothing written');
    // Admissible support on proposal, decision and state.
    const support = { status: 'PRESENT' as const, entries: [{ tag: 'SOURCE_ASSERTION' as const, targetId: x.assertion }] };
    const sub = await exec(k.submitSql(x.member, { commandId: x.cmd('sup-ok'), proposal: p, support }));
    const dec = await exec(k.decideSql(x.scenarioValidator, { commandId: x.cmd('sup-ok-v'), proposalId: sub.proposal_id, proposal: p, support }));
    assert.deepEqual(await json(`select json_agg(owner_registry_artifact order by owner_registry_artifact) from gov_repo.l15_support_links
      where organisation_id='${x.org}' and owner_kind='RISK_SCENARIO_DEFINITION' and target_source_assertion_id='${x.assertion}'
        and coalesce(owner_scenario_proposal_id::text, owner_governance_decision_id::text, owner_scenario_state_id::text) in
          ('${sub.proposal_id}','${dec.governance_decision_id}','${dec.state_id}')`), ['DECISION', 'PROPOSAL', 'STATE']);
    // Exhaustive owner x tag matrix at the DB (rolled back): the two registry owners accept exactly DISCOVERY_EVIDENCE / SOURCE_ASSERTION.
    const tags = ['DISCOVERY_EVIDENCE', 'SOURCE_ASSERTION', 'RUNTIME_OBSERVATION', 'CROSS_SIGNAL_RESULT', 'EXECUTION_FIELD_STATE',
      'TECHNICAL_FIELD_STATE', 'LINEAGE_OBSERVATION', 'L14_FACT_STATE', 'RISK_SIGNAL', 'RISK_HYPOTHESIS'];
    const bare = await exec(k.submitSql(x.member, { commandId: x.cmd('sup-bare'), proposal: p }));
    for (const tag of tags) {
      // The CHECK is probed with the (owner-in-transaction) guard disabled inside a rolled-back transaction.
      const probe = owner(`begin; alter table gov_repo.l15_support_links disable trigger l15_support_links_insert_guard;
        insert into gov_repo.l15_support_links(organisation_id, link_id, owner_kind, owner_registry_artifact,
        owner_scenario_proposal_id, target_tag, target_discovery_evidence_id, target_source_assertion_id, target_risk_signal_id, recorded_at)
        values ('${x.org}', gen_random_uuid(), 'RISK_SCENARIO_DEFINITION', 'PROPOSAL', '${bare.proposal_id}', '${tag}',
          ${tag === 'DISCOVERY_EVIDENCE' ? `'${x.evidence}'` : 'null'}, ${tag === 'SOURCE_ASSERTION' ? `'${x.assertion}'` : 'null'},
          ${tag === 'RISK_SIGNAL' ? `'${sig.signal_id}'` : 'null'}, now()); rollback;`);
      if (tag === 'DISCOVERY_EVIDENCE' || tag === 'SOURCE_ASSERTION') {
        await probe;
      } else {
        await assert.rejects(probe, /l15_support_links_owner_target_matrix_check|l15_support_links_target_shape_check/, `${tag} refused`);
      }
    }
    // Legal pair, but never after the owner's transaction (guard enabled).
    await assert.rejects(owner(`insert into gov_repo.l15_support_links(organisation_id, link_id, owner_kind, owner_registry_artifact,
      owner_scenario_state_id, target_tag, target_discovery_evidence_id, recorded_at)
      values ('${x.org}', gen_random_uuid(), 'RISK_SCENARIO_DEFINITION', 'STATE', '${dec.state_id}', 'DISCOVERY_EVIDENCE', '${x.evidence}', now())`),
    /SUPPORT_OWNER_NOT_IN_TRANSACTION/);
    // With the guard disabled (rolled back): a cross-tenant target fails the composite FK; two owners / a mismatched owner
    // column fail the shape CHECK.
    const raw = (sql: string) => owner(`begin; alter table gov_repo.l15_support_links disable trigger l15_support_links_insert_guard; ${sql}; rollback;`);
    await assert.rejects(raw(`insert into gov_repo.l15_support_links(organisation_id, link_id, owner_kind, owner_registry_artifact,
      owner_scenario_state_id, target_tag, target_discovery_evidence_id, recorded_at)
      values ('${x.org}', gen_random_uuid(), 'RISK_SCENARIO_DEFINITION', 'STATE', '${dec.state_id}', 'DISCOVERY_EVIDENCE', '${other.evidence}', now())`),
    /l15_support_links_discovery_evidence_fkey/);
    await assert.rejects(raw(`insert into gov_repo.l15_support_links(organisation_id, link_id, owner_kind, owner_registry_artifact,
      owner_scenario_state_id, target_tag, target_source_assertion_id, recorded_at)
      values ('${x.org}', gen_random_uuid(), 'RISK_SCENARIO_DEFINITION', 'STATE', '${dec.state_id}', 'SOURCE_ASSERTION', '${other.assertion}', now())`),
    /l15_support_links_source_assertion_fkey/);
    await assert.rejects(raw(`insert into gov_repo.l15_support_links(organisation_id, link_id, owner_kind, owner_registry_artifact,
      owner_scenario_state_id, owner_scenario_proposal_id, target_tag, target_discovery_evidence_id, recorded_at)
      values ('${x.org}', gen_random_uuid(), 'RISK_SCENARIO_DEFINITION', 'STATE', '${dec.state_id}', '${sub.proposal_id}', 'DISCOVERY_EVIDENCE', '${x.evidence}', now())`),
    /l15_support_links_owner_shape_check/);
    await assert.rejects(raw(`insert into gov_repo.l15_support_links(organisation_id, link_id, owner_kind, owner_registry_artifact,
      owner_scenario_state_id, target_tag, target_discovery_evidence_id, recorded_at)
      values ('${x.org}', gen_random_uuid(), 'RISK_METHODOLOGY', 'STATE', '${dec.state_id}', 'DISCOVERY_EVIDENCE', '${x.evidence}', now())`),
    /l15_support_links_owner_shape_check/);
    await assert.rejects(raw(`insert into gov_repo.l15_support_links(organisation_id, link_id, owner_kind, owner_registry_artifact,
      owner_signal_id, owner_signal_kind, owner_scenario_state_id, target_tag, target_discovery_evidence_id, recorded_at)
      values ('${x.org}', gen_random_uuid(), 'RISK_SIGNAL', null, '${sig.signal_id}', 'DETECTED_ABSENCE', '${dec.state_id}', 'DISCOVERY_EVIDENCE', '${x.evidence}', now())`),
    /l15_support_links_owner_shape_check/);
    // A registry DECISION owner of the other subject kind is refused by the guard (enabled).
    await assert.rejects(owner(`begin; ${k.decideSql(x.scenarioValidator, { commandId: x.cmd('sup-kind'), proposalId: (await exec(k.submitSql(x.member,
      { commandId: x.cmd('sup-kind-s'), proposal: p }))).proposal_id, proposal: p, outcome: 'DEFER', expected: dec.state_id })}
      insert into gov_repo.l15_support_links(organisation_id, link_id, owner_kind, owner_registry_artifact, owner_governance_decision_id, target_tag,
        target_discovery_evidence_id, recorded_at)
      select organisation_id, gen_random_uuid(), 'RISK_METHODOLOGY', 'DECISION', governance_decision_id, 'DISCOVERY_EVIDENCE', '${x.evidence}', now()
      from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${x.cmd('sup-kind')}'; rollback;`), /SUPPORT_OWNER_NOT_IN_TRANSACTION/);
    // O84: no json / array / free-text reference column on l15_support_links.
    assert.equal(await one(`select count(*) from information_schema.columns where table_schema='gov_repo' and table_name='l15_support_links'
      and (data_type in ('json','jsonb','ARRAY') or column_name ~ '(label|description|note|text|url)')`), '0');
  });

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('O63 / O64: temporal — immediate = DB instant; BACKDATED / FUTURE_DATED need policy; future never hides early; bitemporal resolver', async () => {
    const past = await k.instant('-10 days'), future = await k.instant('10 days');
    const v = await k.admitScenario(x, 'tmp');
    const pastProposal = k.proposalOf(SCENARIO, v, { requestedEffectiveFrom: past });
    const sub = await exec(k.submitSql(x.member, { commandId: x.cmd('tmp-s'), proposal: pastProposal }));
    const d1 = await exec(k.decideSql(x.scenarioValidator, { commandId: x.cmd('tmp-v'), proposalId: sub.proposal_id, proposal: pastProposal }));
    assert.deepEqual([d1.outcome, d1.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED']);
    const d2 = await exec(k.decideSql(x.dater, { commandId: x.cmd('tmp-v2'), proposalId: sub.proposal_id, proposal: pastProposal }));
    assert.equal(d2.outcome, 'VALIDATED');
    assert.equal(await one(`select to_char(effective_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from gov_repo.l15_risk_scenario_definition_states where state_id='${d2.state_id}'`), past);
    // Recorded after the cutoff → invisible, although effective in the past.
    assert.equal(await k.resolve(SCENARIO, x.org, v, 'clock_timestamp()', `'${past}'::timestamptz`), null);
    assert.equal(await k.resolve(SCENARIO, x.org, v, 'clock_timestamp()', 'clock_timestamp()'), d2.state_id);
    assert.equal(await k.resolve(SCENARIO, x.org, v, `'${past}'::timestamptz - interval '1 day'`, 'clock_timestamp()'), null, 'not yet effective');
    // A future-effective REVOKE never hides the current state early; it applies from its instant.
    const rp = k.proposalOf(SCENARIO, v, { intent: 'REVOKE', targetStateId: d2.state_id, requestedEffectiveFrom: future });
    const rsub = await exec(k.submitSql(x.member, { commandId: x.cmd('tmp-r'), proposal: rp }));
    const r1 = await exec(k.decideSql(x.scenarioValidator, { commandId: x.cmd('tmp-r1'), proposalId: rsub.proposal_id, proposal: rp, outcome: 'REVOKE', expected: d2.state_id }));
    assert.deepEqual([r1.outcome, r1.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED']);
    const r2 = await exec(k.decideSql(x.dater, { commandId: x.cmd('tmp-r2'), proposalId: rsub.proposal_id, proposal: rp, outcome: 'REVOKE', expected: d2.state_id }));
    assert.equal(r2.outcome, 'REVOKED');
    assert.equal(await k.resolve(SCENARIO, x.org, v, 'clock_timestamp()', 'clock_timestamp()'), d2.state_id, 'future revocation does not hide early');
    assert.equal(await k.resolve(SCENARIO, x.org, v, `'${future}'::timestamptz + interval '1 second'`, 'clock_timestamp()'), null);
    assert.equal(await k.resolve(SCENARIO, x.org, v, `'${future}'::timestamptz + interval '1 second'`, `'${future}'::timestamptz - interval '20 days'`), null);
    // The resolver never answers for another version, a wrong hash or another tenant.
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_scenario_definition_valid_state_v1('${x.org}', '${v.scenario_definition_id}',
      '${randomUUID()}', '${v.content_hash}', clock_timestamp(), clock_timestamp())`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_scenario_definition_valid_state_v1('${x.org}', '${v.scenario_definition_id}',
      '${v.scenario_definition_version_id}', '${'0'.repeat(64)}', clock_timestamp(), clock_timestamp())`), '0');
    const other = await k.setup();
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_scenario_definition_valid_state_v1('${other.org}', '${v.scenario_definition_id}',
      '${v.scenario_definition_version_id}', '${v.content_hash}', clock_timestamp(), clock_timestamp())`), '0');
  });

  await t.test('O65: replay — exact retry returns the original durable result; changed payload GV007; wrong caller fingerprint GV008', async () => {
    const content = scenarioContent({}, 'RPL');
    const ops = { commandId: x.cmd('rpl-a'), identityId: randomUUID(), versionId: randomUUID() };
    const a1 = await exec(k.admitScenarioSql(x.scenarioAdmitter, ops, content));
    const a2 = await exec(k.admitScenarioSql(x.scenarioAdmitter, ops, content));
    assert.deepEqual([a2.replay, a2.recorded_at, a2.authorization_decision_id, a2.content_hash], [true, a1.recorded_at, a1.authorization_decision_id, a1.content_hash]);
    await rejects(svc(k.admitScenarioSql(x.scenarioAdmitter, ops, scenarioContent({}, 'RPL-CHANGED'))), 'GV007');
    await rejects(svc(k.admitScenarioSql(x.scenarioAdmitter, { ...ops, versionId: randomUUID() }, content)), 'GV007');
    const p = k.proposalOf(SCENARIO, a1);
    const s1r = await exec(k.submitSql(x.member, { commandId: x.cmd('rpl-s'), proposal: p }));
    const s2r = await exec(k.submitSql(x.member, { commandId: x.cmd('rpl-s'), proposal: p }));
    assert.deepEqual([s2r.replay, s2r.proposal_id], [true, s1r.proposal_id]);
    await rejects(svc(k.submitSql(x.member, { commandId: x.cmd('rpl-s'), proposal: p, support: k.evidenceSupport(x.evidence) })), 'GV007');
    const d1 = await exec(k.decideSql(x.scenarioValidator, { commandId: x.cmd('rpl-d'), proposalId: s1r.proposal_id, proposal: p }));
    const d2 = await exec(k.decideSql(x.scenarioValidator, { commandId: x.cmd('rpl-d'), proposalId: s1r.proposal_id, proposal: p }));
    assert.deepEqual([d2.replay, d2.state_id, d2.recorded_at, d2.effective_from], [true, d1.state_id, d1.recorded_at, d1.effective_from]);
    await rejects(svc(k.decideSql(x.scenarioValidator, { commandId: x.cmd('rpl-d'), proposalId: s1r.proposal_id, proposal: p, outcome: 'DEFER' })), 'GV007');
    await rejects(svc(k.decideSql(x.scenarioValidator, { commandId: x.cmd('rpl-d2'), proposalId: s1r.proposal_id, proposal: p, fingerprint: 'e'.repeat(64) })), 'GV008');
    // A DENY is durable: the exact retry replays the original DENY; a changed payload under the consumed id is GV007.
    const dops = { commandId: x.cmd('rpl-deny'), identityId: randomUUID(), versionId: randomUUID() };
    const dn = await exec(k.admitScenarioSql(x.member, dops, content));
    const dn2 = await exec(k.admitScenarioSql(x.member, dops, content));
    assert.deepEqual([dn.outcome, dn2.outcome, dn2.replay, dn2.authorization_decision_id], ['DENIED', 'DENIED', true, dn.authorization_decision_id]);
    await rejects(svc(k.admitScenarioSql(x.member, { ...dops, versionId: randomUUID() }, content)), 'GV007');
  });

  await t.test('attack 23 / O58: wrong-tenant proposal, version, state and principal are refused (header / body tenant ignored)', async () => {
    const other = await k.setup();
    const v = await k.admitScenario(x, 'ten');
    const p = k.proposalOf(SCENARIO, v);
    await rejects(svc(k.submitSql(other.member, { commandId: other.cmd('ten-sub'), proposal: p })), 'GV010', /RISK_SCENARIO_DEFINITION_VERSION_NOT_ADMITTED/);
    const sub = await exec(k.submitSql(x.member, { commandId: x.cmd('ten-sub'), proposal: p }));
    await rejects(svc(k.decideSql(other.scenarioValidator, { commandId: other.cmd('ten-dec'), proposalId: sub.proposal_id, proposal: p })),
      'GV010', /PROPOSAL_UNRESOLVED/);
    // A verified principal of org B naming org A's id in the principal fails eligibility (tenant from the verified principal only).
    await rejects(svc(k.decideSql(other.scenarioValidator, { commandId: x.cmd('ten-dec2'), proposalId: sub.proposal_id, proposal: p,
      session: { org: x.org } })), 'GV00[1-5]');
    const dec = await exec(k.decideSql(x.scenarioValidator, { commandId: x.cmd('ten-v'), proposalId: sub.proposal_id, proposal: p }));
    const ov = await k.admitScenario(other, 'ten-o');
    await rejects(svc(k.submitSql(other.member, { commandId: other.cmd('ten-rv'), proposal: k.proposalOf(SCENARIO, ov,
      { intent: 'REVOKE', targetStateId: dec.state_id }) })), 'GV010', /TARGET_STATE_UNRESOLVED/);
    assert.equal(await k.resolve(SCENARIO, other.org, v, 'clock_timestamp()', 'clock_timestamp()'), null);
  });

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('O62 / attack 41: every registry history table refuses UPDATE / DELETE / TRUNCATE (owner + replica superuser); heads only advance', async () => {
    const history = REGISTRY_TABLES.filter(tb => !tb.endsWith('_heads'));
    for (const tb of history) {
      await assert.rejects(owner(`update gov_repo.${tb} set organisation_id = organisation_id where true`), /L15_HISTORY_IMMUTABLE/, `${tb} UPDATE`);
      await assert.rejects(owner(`delete from gov_repo.${tb} where true`), /L15_HISTORY_IMMUTABLE/, `${tb} DELETE`);
      await assert.rejects(owner(`truncate gov_repo.${tb} cascade`), /L15_HISTORY_IMMUTABLE/, `${tb} TRUNCATE`);
      await assert.rejects(c.bootstrapSql(`set session_replication_role = replica; delete from gov_repo.${tb} where true;`), /L15_HISTORY_IMMUTABLE/);
    }
    for (const tb of ['l15_risk_scenario_definition_heads', 'l15_risk_methodology_heads']) {
      await assert.rejects(owner(`delete from gov_repo.${tb} where true`), /L15_HISTORY_IMMUTABLE/);
      await assert.rejects(owner(`truncate gov_repo.${tb}`), /L15_HISTORY_IMMUTABLE/);
      await assert.rejects(owner(`update gov_repo.${tb} set latest_state_id = null where latest_state_id is not null`), /L15_HISTORY_IMMUTABLE/);
    }
    await assert.rejects(owner(`update gov_repo.l14_command_results set l15_state_id = null where l15_state_id is not null`), /L14_HISTORY_IMMUTABLE/);
    // No FK action anywhere can rewrite / erase L15 registry history.
    assert.equal(await one(`select count(*) from pg_constraint k join pg_class c on c.oid in (k.conrelid, k.confrelid)
      where c.relname like 'l15\\_%' and k.contype='f' and (k.confdeltype in ('c','n','d') or k.confupdtype in ('c','n','d'))`), '0');
    // The command result l15_state_id must name the exact L15 state of its decision.
    await assert.rejects(owner(`insert into gov_repo.l14_command_results(organisation_id, command_id, command_kind, subject_kind, command_fingerprint,
      actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id, l15_state_id, recorded_at)
      select organisation_id, 'forged-result', 'DECIDE_PROPOSAL', 'RISK_SCENARIO_DEFINITION', repeat('a',64), '${x.member.id}', 'VALIDATED',
        authorization_decision_id, proposal_id, governance_decision_id, gen_random_uuid(), recorded_at
      from gov_repo.l15_risk_scenario_definition_states where organisation_id='${x.org}' limit 1`), /COMMAND_RESULT_L15_STATE_MISMATCH/);
  });

  await t.test('O01 / O02 / O04-O07 / O31 / O73-O76: frozen vocabularies, no score column, M16 history byte-identical across the run', async () => {
    const vocab = async (rel: string, col: string) => json(`select json_agg(m.v[1] order by m.v[1]) from pg_constraint k
      cross join lateral regexp_matches(pg_get_constraintdef(k.oid), '''([A-Za-z0-9_:]+)''', 'g') m(v)
      where k.conrelid='gov_repo.${rel}'::regclass and k.contype='c' and pg_get_constraintdef(k.oid) like '%${col}%' and pg_get_constraintdef(k.oid) like '%ANY%'`);
    assert.deepEqual(await vocab('l15_risk_scenario_definition_versions', 'risk_domain'), [...L15_RISK_DOMAINS].sort());
    assert.deepEqual(await vocab('l15_risk_methodology_rating_cells', 'rating_band'), ['CRITICAL', 'HIGH', 'LOW', 'MODERATE']);
    assert.deepEqual(await vocab('l15_risk_scenario_definition_subject_kinds', 'subject_kind'), [...L15_SCENARIO_SUBJECT_TOKENS].sort());
    assert.equal(await one(`select count(*) from pg_constraint where conrelid='gov_repo.canonical_objects'::regclass and conname='canonical_objects_kind_check'
      and pg_get_constraintdef(oid) ~ 'RISK'`), '0');
    assert.deepEqual((await json(`select json_agg(m.v[1] order by m.v[1]) from pg_constraint k cross join lateral regexp_matches(pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') m(v)
      where k.conrelid='gov_repo.l14_fact_states'::regclass and k.conname='l14_fact_states_subject_kind_check'`)).length, 5);
    // O31 (S2 portion): the only numeric columns of the L15 registries are the scale ordinals.
    assert.deepEqual(await json(`select json_agg(table_name || '.' || column_name order by table_name) from information_schema.columns
      where table_schema='gov_repo' and table_name = any (array[${REGISTRY_TABLES.map(tb => `'${tb}'`).join(',')}]) and data_type in ('smallint','integer','bigint','numeric','real','double precision')`),
    ['l15_risk_methodology_impact_levels.ordinal', 'l15_risk_methodology_likelihood_levels.ordinal']);
    assert.equal(await one(`select count(*) from information_schema.columns where table_schema='gov_repo' and table_name like 'l15\\_%'
      and column_name ~ '(score|weight|percent|product|title|description|rationale|label)'`), '0');
    // O05: no L15 fact-family store exists yet (S3+); the registries are not fact families.
    assert.equal(await one(`select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname ~ '^l15_(governed_risk|risk_assessment|risk_treatment|risk_acceptance)'`), '0');
    // O74: l14_fact_states / l14_registry_states / l14_support_links carry no L15 row and no L15 column.
    assert.equal(await one(`select (select count(*) from gov_repo.l14_registry_states where subject_kind like 'RISK%')
      + (select count(*) from gov_repo.l14_fact_states where subject_kind like 'RISK%')
      + (select count(*) from information_schema.columns where table_schema='gov_repo' and table_name in ('l14_registry_states','l14_fact_states','l14_support_links')
         and column_name ~ 'l15|risk')`), '0');
    // O07 / O77: every M16 history table digest is unchanged by the whole S2 run (the S2 RPCs never write M16 stores).
    assert.equal(await m16Digest(), m16Before, 'no M16 history row of the organisation changed');
    assert.equal(await one(`select (select count(*) from gov_repo.l14_registry_states) + (select count(*) from gov_repo.l14_fact_states)
      + (select count(*) from gov_repo.l14_support_links) + (select count(*) from gov_repo.l14_control_definition_versions)`), '0',
    'the S2 RPCs never write an M16 registry / fact / support store');
    // O02: F2 untouched.
    assert.equal(await one(`select count(*) from pg_trigger where tgrelid='gov_repo.canonical_relationships'::regclass and not tgisinternal`), '0');
    assert.equal(lastLine(await owner(`select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid where k.confrelid='gov_repo.canonical_relationships'::regclass and c.relname like 'l15\\_%'`)), '0');
    void MACHINE; void NONE;
  });
});
