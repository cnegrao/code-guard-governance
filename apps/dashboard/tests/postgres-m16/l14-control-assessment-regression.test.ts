import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { lit, named } from '../helpers/m16-governed-write-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';
import { businessContextKit } from '../helpers/m16-l14-business-context-fixtures';
import { policyApplicabilityKit } from '../helpers/m16-l14-policy-applicability-fixtures';
import { controlApplicabilityKit } from '../helpers/m16-l14-control-applicability-fixtures';
import { controlAssessmentKit } from '../helpers/m16-l14-control-assessment-fixtures';

/**
 * M16-S1C.5 — S1C.1 / S1C.1R1 / S1C.2 / S1C.3 / S1C.4 / S1B.6 regression on the S1C.5 catalog (S1C5 horizon). S1C.5 widens the
 * shared fact framework a last time (l14_fact_states subject vocabulary, the command-result fact branch, the fact guard): the four
 * earlier families must keep their exact behaviour — RESPONSIBILITY single-owner cardinality, O45, O49 Party invalidation and both
 * Party race orders; BUSINESS_CONTEXT supersession, O49 and both Domain race orders; POLICY_APPLICABILITY supersession, O49 and both
 * POLICY_VERSION race orders; CONTROL_APPLICABILITY supersession, O49 and both CONTROL_DEFINITION race orders — the S1B.6 registry
 * keeps its lifecycle, an assessment never mutates its applicability, and the five families never mix (CONTROL_FINDING is never a
 * family). Their own suites keep their own horizons unchanged.
 */
test('M16 S1C.5 keeps S1C.1 / S1C.1R1 / S1C.2 / S1C.3 / S1C.4 / S1B.6 green on the final fact framework (disposable PG17)', { timeout: 2_400_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C5' });
  t.after(() => c.stop());
  const { owner, rejects } = c;
  const rk = await responsibilityKit(c);
  const bk = await businessContextKit(c);
  const pak = await policyApplicabilityKit(c);
  const cak = await controlApplicabilityKit(c);
  const ask = await controlAssessmentKit(c, cak);
  const one = async (query: string) => lastLine(await owner(query));
  const json = (out: string) => JSON.parse(lastLine(out));
  const ts = (value: string) => `'${value}'::timestamptz`;
  const now = 'clock_timestamp()';
  const monitor = c.session('m16_bootstrap');
  t.after(() => monitor.close());
  type Session = ReturnType<typeof c.session>;
  const pidOf = async (session: Session) => (await session.run('select pg_backend_pid();')).out.trim();
  async function race(first: string, second: string) {
    const s1 = c.session('service_role'), s2 = c.session('service_role');
    try {
      await s1.run('begin;');
      const a = await s1.run(first);
      assert.equal(a.err, '', a.err);
      const [p1, p2] = [await pidOf(s1), await pidOf(s2)];
      const pending = s2.run(second);
      for (let i = 0; ; i++) {
        const state = (await monitor.run(`select coalesce((select wait_event_type from pg_stat_activity where pid=${p2}),'')
          ||':'||(pg_blocking_pids(${p2}) @> array[${p1}])::text;`)).out.trim();
        if (state === 'Lock:true') break;
        assert.ok(i < 1000, 'session never observed blocked by the expected holder');
        await sleep(20);
      }
      await s1.run('commit;');
      return { first: a, second: await pending };
    } finally { await Promise.all([s1.close(), s2.close()]); }
  }

  await t.test('S1C.1: single-owner cardinality race, O45 steward coexistence, O49 Party invalidation unchanged', async () => {
    const x = await rk.setup();
    const [a, b] = [await rk.party(x, 'sa'), await rk.party(x, 'sb', 'GROUP')];
    const [pa, pb] = [rk.validateProposal(rk.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', a.partyId), a.stateId),
      rk.validateProposal(rk.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', b.partyId), b.stateId)];
    const [sa, sb] = [await rk.submit(x, x.member, 'sa-submit', pa), await rk.submit(x, x.member, 'sb-submit', pb)];
    const { first, second } = await race(rk.decideSqlFor(x.rs, x.cmd('sa'), sa.proposal_id, pa, 'VALIDATE', null),
      rk.decideSqlFor(x.rs2, x.cmd('sb'), sb.proposal_id, pb, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV009[\s\S]*RESPONSIBILITY_SINGLE_OWNER_CONFLICT/, second.err);
    for (const party of [a, b]) {
      assert.equal((await rk.assign(x, `st-${party.partyId.slice(0, 4)}`, rk.keyOf('DATA_ELEMENT', x.objects.element, 'DATA_STEWARD', party.partyId), party))
        .decided.outcome, 'VALIDATED');
    }
    assert.equal((await rk.current(x.org, 'DATA_ELEMENT', x.objects.element)).length, 2, 'O45: two stewards coexist');
    const key = rk.keyOf('DATA_ASSET', x.objects.asset2, 'DATA_OWNER', a.partyId);
    const held = await rk.assign(x, 'o49', key, a);
    const rows = await rk.stateRows(x.org, held.stateId);
    const beforeRevoke = await one('select clock_timestamp()::text');
    await rk.revokeParty(x, 'o49', a);
    assert.equal(await rk.stateRows(x.org, held.stateId), rows);
    assert.equal(await rk.resolve(x.org, key, now, now), null);
    assert.equal(await rk.resolve(x.org, key, ts(beforeRevoke), ts(beforeRevoke)), held.stateId);
  });

  for (const order of [1, 2] as const) {
    await t.test(`S1C.1R1 Party dependency race order ${order} unchanged on the S1C.5 catalog`, async () => {
      const x = await rk.setup();
      const p = await rk.party(x, `r${order}`);
      const key = rk.keyOf('DATA_ASSET', x.objects.asset, 'DATA_OWNER', p.partyId);
      const q = rk.validateProposal(key, p.stateId);
      const s = await rk.submit(x, x.member, `r${order}-submit`, q);
      const rp = rk.pk.revokeProposal(p.partyId, p.stateId);
      const rs = await rk.pk.submit(x as never, x.member, `r${order}-party-rv-submit`, rp);
      const validate = rk.decideSqlFor(x.rs, x.cmd(`r${order}`), s.proposal_id, q, 'VALIDATE', null);
      const revoke = rk.pk.decideSqlFor(x as never, x.steward, x.cmd(`r${order}-party-rv`), rs.proposal_id, rp, 'REVOKE', p.stateId);
      if (order === 1) {
        const { first, second } = await race(revoke, validate);
        assert.equal(json(first.out).outcome, 'REVOKED');
        assert.match(second.err, /GV010[\s\S]*PARTY_DEPENDENCY_NOT_VALID/, second.err);
        assert.equal(await rk.head(x.org, key), null);
      } else {
        const { first, second } = await race(validate, revoke);
        const [a, r] = [json(first.out), json(second.out)];
        assert.deepEqual([a.outcome, r.outcome], ['VALIDATED', 'REVOKED']);
        assert.equal(await rk.resolve(x.org, key, now, now), null);
        assert.equal(await rk.resolve(x.org, key, ts(a.recorded_at), ts(a.recorded_at)), a.fact_state_id);
      }
    });
  }

  await t.test('S1C.2: supersession, O49 Domain invalidation and both Domain dependency race orders unchanged', async () => {
    const x = await bk.setup();
    const [d1, d2] = [await bk.domain(x, 'sup-1'), await bk.domain(x, 'sup-2')];
    const key = bk.keyOf('DATA_ASSET', x.objects.asset, 'BUSINESS_DOMAIN');
    const s1 = await bk.assign(x, 'sup-1', key, d1);
    const s1Rows = await bk.stateRows(x.org, s1.stateId);
    const s2 = await bk.assign(x, 'sup-2', key, d2);
    assert.deepEqual([s2.decided.predecessor_state_id, await bk.head(x.org, key)], [s1.stateId, s2.stateId]);
    assert.equal(await bk.stateRows(x.org, s1.stateId), s1Rows);
    // O49 Domain.
    await bk.revokeDomain(x, 'o49', d2);
    assert.equal(await bk.resolve(x.org, key, now, now), null);
    // Race order 1: the domain revocation holds the exclusive guard; the waiting assignment fails closed.
    const d3 = await bk.domain(x, 'r1');
    const k1 = bk.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN');
    const p1 = bk.validateProposal(k1, d3);
    const q1 = await bk.submit(x, x.member, 'r1-submit', p1);
    const rv1 = bk.dk.revokeProposal(d3.subject, d3.stateId);
    const rs1 = await bk.dk.submit(x as never, x.member, 'r1-dom-rv-submit', rv1);
    const o1 = await race(bk.dk.decideSqlFor(x.steward, x.cmd('r1-dom-rv'), rs1.proposal_id, rv1, 'REVOKE', d3.stateId),
      bk.decideSqlFor(x.bs, x.cmd('r1'), q1.proposal_id, p1, 'VALIDATE', null));
    assert.match(o1.second.err, /GV010[\s\S]*DOMAIN_DEPENDENCY_NOT_VALID/, o1.second.err);
    // Race order 2: the assignment holds the shared guard; the revocation commits after it and invalidates it.
    const d4 = await bk.domain(x, 'r2', 'INFORMATION_DOMAIN');
    const k2 = bk.keyOf('DATA_ELEMENT', x.objects.element, 'INFORMATION_DOMAIN');
    const p2 = bk.validateProposal(k2, d4);
    const q2 = await bk.submit(x, x.member, 'r2-submit', p2);
    const rv2 = bk.dk.revokeProposal(d4.subject, d4.stateId);
    const rs2 = await bk.dk.submit(x as never, x.member, 'r2-dom-rv-submit', rv2);
    const o2 = await race(bk.decideSqlFor(x.bs, x.cmd('r2'), q2.proposal_id, p2, 'VALIDATE', null),
      bk.dk.decideSqlFor(x.steward, x.cmd('r2-dom-rv'), rs2.proposal_id, rv2, 'REVOKE', d4.stateId));
    assert.deepEqual([json(o2.first.out).outcome, json(o2.second.out).outcome], ['VALIDATED', 'REVOKED']);
    assert.equal(await bk.resolve(x.org, k2, now, now), null);
  });

  await t.test('S1C.3: supersession, O49 POLICY_VERSION invalidation and both POLICY_VERSION dependency race orders unchanged', async () => {
    const x = await pak.setup();
    const v1 = await pak.policy(x, 'pa');
    const v2 = await pak.nextVersion(x, 'pa-v2', v1);
    const target = pak.objectTarget('DATA_ASSET', x.objects.byKind.DATA_ASSET);
    const s1 = await pak.apply(x, 'pa-1', target, v1);
    const s1Rows = await pak.stateRows(x.org, s1.stateId);
    const s2 = await pak.apply(x, 'pa-2', target, v2, { applicability: 'DOES_NOT_APPLY' });
    assert.deepEqual([s2.decided.predecessor_state_id, await pak.head(x.org, target, v1.subject.policyId), s2.decided.applicability],
      [s1.stateId, s2.stateId, 'DOES_NOT_APPLY']);
    assert.equal(await pak.stateRows(x.org, s1.stateId), s1Rows);
    // O49 POLICY_VERSION: revoking V2's state makes the key UNKNOWN; history unchanged.
    const before = await one('select clock_timestamp()::text');
    await pak.revokePolicyVersion(x, 'pa-o49', v2);
    assert.equal(await pak.outcome(x.org, target, v1.subject.policyId), 'UNKNOWN');
    assert.equal(await pak.resolve(x.org, target, v1.subject.policyId, ts(before), ts(before)), s2.stateId);
    // Race order 1: the POLICY_VERSION revocation holds the exclusive guard; the waiting applicability fails closed.
    const p3 = await pak.policy(x, 'pa-r1');
    const t3 = pak.relTarget(x.rels.reads);
    const q3 = pak.validateProposal(t3, p3);
    const a3 = await pak.submit(x, x.member, 'pa-r1-submit', q3);
    const rv3 = pak.pvk.revokeProposal(p3.subject, p3.stateId);
    const rs3 = await pak.pvk.submit(x as never, x.member, 'pa-r1-pv-rv-submit', rv3);
    const o1 = await race(pak.pvk.decideSqlFor(x.validator, x.cmd('pa-r1-pv-rv'), rs3.proposal_id, rv3, 'REVOKE', p3.stateId),
      pak.decideSqlFor(x.ps, x.cmd('pa-r1'), a3.proposal_id, q3, 'VALIDATE', null));
    assert.match(o1.second.err, /GV010[\s\S]*POLICY_VERSION_DEPENDENCY_NOT_VALID/, o1.second.err);
    // Race order 2: the applicability holds the shared guard; the revocation commits after it and invalidates it.
    const p4 = await pak.policy(x, 'pa-r2');
    const t4 = pak.objectTarget('TOOL', x.objects.byKind.TOOL);
    const q4 = pak.validateProposal(t4, p4);
    const a4 = await pak.submit(x, x.member, 'pa-r2-submit', q4);
    const rv4 = pak.pvk.revokeProposal(p4.subject, p4.stateId);
    const rs4 = await pak.pvk.submit(x as never, x.member, 'pa-r2-pv-rv-submit', rv4);
    const o2 = await race(pak.decideSqlFor(x.ps, x.cmd('pa-r2'), a4.proposal_id, q4, 'VALIDATE', null),
      pak.pvk.decideSqlFor(x.validator, x.cmd('pa-r2-pv-rv'), rs4.proposal_id, rv4, 'REVOKE', p4.stateId));
    assert.deepEqual([json(o2.first.out).outcome, json(o2.second.out).outcome], ['VALIDATED', 'REVOKED']);
    assert.equal(await pak.outcome(x.org, t4, p4.subject.policyId), 'UNKNOWN');
  });

  await t.test('S1B.6: ControlDefinition admission / validation / revocation / re-validation unchanged; a later version never self-validates', async () => {
    const x = await cak.setup();
    const v1 = await cak.cdk.admitted(x as never, 'reg');
    const validated = await cak.cdk.validate(x as never, 'reg', v1);
    const state1 = validated.decided.registry_state_id as string;
    assert.equal(await cak.cdk.resolve(x.org, v1, now, now), state1);
    const { version: v2 } = await cak.cdk.admitNext(x as never, 'reg-v2', v1, cak.cdk.content('reg-v2'));
    assert.equal(await cak.cdk.resolve(x.org, v2, now, now), null, 'an admitted successor is never VALIDATED by admission');
    assert.equal(await cak.cdk.resolve(x.org, v1, now, now), state1, 'admitting V2 never revokes V1');
    const before = await one('select clock_timestamp()::text');
    await cak.cdk.revoke(x as never, 'reg-rv', v1, state1);
    assert.equal(await cak.cdk.resolve(x.org, v1, now, now), null);
    assert.equal(await cak.cdk.resolve(x.org, v1, ts(before), ts(before)), state1);
    const revalidated = await cak.cdk.validate(x as never, 'reg-reval', v1);
    assert.notEqual(revalidated.decided.registry_state_id, state1, 're-validation is a NEW state');
    assert.equal(await cak.cdk.resolve(x.org, v1, now, now), revalidated.decided.registry_state_id);
    // A CONTROL_APPLICABILITY on top never alters any registry row (identity, versions, states, heads, registry envelope).
    const regRowsSql = `select md5(string_agg(x, '|' order by x)) from (${['l14_control_definitions', 'l14_control_definition_versions',
      'l14_control_definition_states', 'l14_control_definition_proposals', 'l14_control_definition_heads', 'l14_registry_states']
      .map(table => `select '${table}:'||t::text as x from gov_repo.${table} t where organisation_id='${x.org}'`).join(' union all ')}) s`;
    const regRows = await one(regRowsSql);
    const a = await cak.apply(x, 'reg-ca', cak.objectTarget('AGENT', x.objects.byKind.AGENT),
      { subject: cak.cdk.subjectOf(v1), stateId: revalidated.decided.registry_state_id as string });
    assert.equal(a.decided.outcome, 'VALIDATED');
    assert.equal(await one(regRowsSql), regRows);
  });

  await t.test('S1C.4 never mutates or reinterprets POLICY_APPLICABILITY state on the same target; family answers are independent', async () => {
    const x = await pak.setup();
    const pin = await pak.policy(x, 'iso');
    const target = pak.objectTarget('MODEL', x.objects.byKind.MODEL);
    const pa = await pak.apply(x, 'iso', target, pin, { applicability: 'DOES_NOT_APPLY' });
    const paDigest = await pak.factDigest(x.org);
    const paRows = await pak.stateRows(x.org, pa.stateId);
    // A CONTROL_APPLICABILITY on another organisation's identical shape and on this organisation's target never touch S1C.3 rows.
    const y = await cak.setup();
    const cpin = await cak.control(y, 'iso');
    await cak.apply(y, 'iso', cak.objectTarget('MODEL', y.objects.byKind.MODEL), cpin);
    assert.equal(await pak.factDigest(x.org), paDigest);
    assert.equal(await pak.stateRows(x.org, pa.stateId), paRows);
    assert.equal(await pak.outcome(x.org, target, pin.subject.policyId), 'DOES_NOT_APPLY');
    assert.deepEqual(await cak.current(x.org, cak.objectTarget('MODEL', x.objects.byKind.MODEL)), [],
      'a policy applicability never surfaces as control applicability (UNKNOWN)');
    assert.deepEqual((await pak.current(y.org, pak.objectTarget('MODEL', y.objects.byKind.MODEL))), [],
      'a control applicability never surfaces as policy applicability');
    // Keys are family-scoped: the same target key + an id from the other family never resolves.
    assert.equal(await one(`select count(*) from gov_repo.l14_control_applicability_valid_state_v1('${x.org}', ${pak.targetOperands(target).join(',')},
      '${pin.subject.policyId}'::uuid, clock_timestamp(), clock_timestamp())`), '0');
  });

  await t.test('S1C.4: supersession, O49 CONTROL_DEFINITION invalidation and both CONTROL_DEFINITION race orders unchanged; assessments never touch applicability rows', async () => {
    const x = await ask.setup();
    const v1 = await cak.control(x as never, 'ca');
    const v2 = await cak.nextVersion(x as never, 'ca-v2', v1);
    const target = cak.objectTarget('DATA_ASSET', x.objects.byKind.DATA_ASSET);
    const s1 = await cak.apply(x as never, 'ca-1', target, v1);
    const s1Rows = await cak.stateRows(x.org, s1.stateId);
    // An assessment of S1 (and its revocation) never writes or rewrites any CONTROL_APPLICABILITY row.
    const caDigest = await ask.applicabilityDigest(x.org);
    const a1 = await ask.assess(x, 'ca-as', s1.stateId);
    await ask.revoke(x, 'ca-as', s1.stateId, a1.stateId);
    assert.equal(await ask.applicabilityDigest(x.org), caDigest, 'assessment commands never touch the applicability history / heads');
    const s2 = await cak.apply(x as never, 'ca-2', target, v2, { applicability: 'DOES_NOT_APPLY' });
    assert.deepEqual([s2.decided.predecessor_state_id, await cak.head(x.org, target, v1.subject.controlDefinitionId), s2.decided.applicability],
      [s1.stateId, s2.stateId, 'DOES_NOT_APPLY']);
    assert.equal(await cak.stateRows(x.org, s1.stateId), s1Rows);
    const before = await one('select clock_timestamp()::text');
    await cak.revokeControlDefinition(x as never, 'ca-o49', v2);
    assert.equal(await cak.outcome(x.org, target, v1.subject.controlDefinitionId), 'UNKNOWN');
    assert.equal(await cak.resolve(x.org, target, v1.subject.controlDefinitionId, ts(before), ts(before)), s2.stateId);
    // Race order 1: the CONTROL_DEFINITION revocation holds the exclusive guard; the waiting applicability fails closed.
    const p3 = await cak.control(x as never, 'ca-r1');
    const t3 = cak.relTarget(x.rels.reads);
    const q3 = cak.validateProposal(t3, p3);
    const a3 = await cak.submit(x as never, x.member, 'ca-r1-submit', q3);
    const rv3 = cak.cdk.revokeProposal(p3.subject, p3.stateId);
    const rs3 = await cak.cdk.submit(x as never, x.member, 'ca-r1-cd-rv-submit', rv3);
    const o1 = await race(cak.cdk.decideSqlFor(x.steward, x.cmd('ca-r1-cd-rv'), rs3.proposal_id, rv3, 'REVOKE', p3.stateId),
      cak.decideSqlFor(x.cs, x.cmd('ca-r1'), a3.proposal_id, q3, 'VALIDATE', null));
    assert.match(o1.second.err, /GV010[\s\S]*CONTROL_DEFINITION_DEPENDENCY_NOT_VALID/, o1.second.err);
    // Race order 2: the applicability holds the shared guard; the revocation commits after it and invalidates it.
    const p4 = await cak.control(x as never, 'ca-r2');
    const t4 = cak.objectTarget('TOOL', x.objects.byKind.TOOL);
    const q4 = cak.validateProposal(t4, p4);
    const a4 = await cak.submit(x as never, x.member, 'ca-r2-submit', q4);
    const rv4 = cak.cdk.revokeProposal(p4.subject, p4.stateId);
    const rs4 = await cak.cdk.submit(x as never, x.member, 'ca-r2-cd-rv-submit', rv4);
    const o2 = await race(cak.decideSqlFor(x.cs, x.cmd('ca-r2'), a4.proposal_id, q4, 'VALIDATE', null),
      cak.cdk.decideSqlFor(x.steward, x.cmd('ca-r2-cd-rv'), rs4.proposal_id, rv4, 'REVOKE', p4.stateId));
    assert.deepEqual([json(o2.first.out).outcome, json(o2.second.out).outcome], ['VALIDATED', 'REVOKED']);
    assert.equal(await cak.outcome(x.org, t4, p4.subject.controlDefinitionId), 'UNKNOWN');
  });

  await t.test('the five families never mix; CONTROL_FINDING is never a family; the generic RPC still refuses every fact family', async () => {
    const x = await ask.setup();
    const applies = await ask.applicability(x, 'mix', cak.objectTarget('AGENT', x.objects.byKind.AGENT));
    await ask.assess(x, 'mix', applies.stateId);
    const px = await pak.setup();
    await pak.apply(px, 'mix', pak.objectTarget('AGENT', px.objects.byKind.AGENT), await pak.policy(px, 'mix'));
    for (const [detail, subject] of [['l14_responsibility_assignment_states', 'RESPONSIBILITY_ASSIGNMENT'],
      ['l14_business_context_assignment_states', 'BUSINESS_CONTEXT_ASSIGNMENT'], ['l14_policy_applicability_states', 'POLICY_APPLICABILITY'],
      ['l14_control_applicability_states', 'CONTROL_APPLICABILITY'], ['l14_control_assessment_states', 'CONTROL_ASSESSMENT']] as const) {
      assert.equal(await one(`select count(*) from gov_repo.l14_fact_states f join gov_repo.${detail} d
        on d.organisation_id=f.organisation_id and d.fact_state_id=f.fact_state_id where f.subject_kind<>'${subject}'`), '0', detail);
    }
    for (const [subject, detail] of [['CONTROL_APPLICABILITY', 'l14_control_applicability_states'], ['CONTROL_ASSESSMENT', 'l14_control_assessment_states']] as const) {
      assert.equal(await one(`select count(*) from gov_repo.l14_fact_states f where subject_kind='${subject}' and not exists
        (select 1 from gov_repo.${detail} d where d.organisation_id=f.organisation_id and d.fact_state_id=f.fact_state_id)`), '0', subject);
    }
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
      select gov_repo.l14_lock_fact_subject_guard_v1(gen_random_uuid(), 'CONTROL_FINDING', array['KEY','x']); rollback;`), /GUARD_KEY_INVALID/);
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres; insert into gov_repo.l14_fact_states(organisation_id,fact_state_id,subject_kind,
      state_kind,effective_from,recorded_at,governance_decision_id,authorization_decision_id,authority_policy_id,authority_policy_version_id,
      authority_policy_content_hash,trust_state,source_class,support_status) values ('${x.org}',gen_random_uuid(),'CONTROL_FINDING','VALIDATED',now(),now(),
      gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('a',64),'VALIDATED','LOCAL_HUMAN','NONE'); rollback;`),
    /l14_fact_states_subject_kind_check/);
    // A CONTROL_APPLICABILITY envelope can never carry a CONTROL_ASSESSMENT detail: the typed detail FK pins the subject.
    await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
      alter table gov_repo.l14_control_assessment_states disable trigger l14_control_assessment_states_guard;
      insert into gov_repo.l14_control_assessment_states(organisation_id,fact_state_id,subject_kind,state_kind,control_applicability_state_id,
      applicability_target_key,control_definition_id,control_definition_version_id,content_hash,control_definition_validated_state_id,assessment_outcome)
      select organisation_id, fact_state_id, 'CONTROL_ASSESSMENT', 'VALIDATED', fact_state_id, target_key, control_definition_id,
        control_definition_version_id, content_hash, control_definition_validated_state_id, 'SATISFIED'
      from gov_repo.l14_control_applicability_states where organisation_id='${x.org}' limit 1; rollback;`), /envelope_fkey|violates/);
    for (const family of ['POLICY_APPLICABILITY', 'CONTROL_APPLICABILITY', 'CONTROL_ASSESSMENT']) {
      await rejects(c.svc(`select * from gov_repo.l14_submit_proposal_v1(${named({ ...c.principal(x.member), p_command_id: lit(x.cmd(`generic-${family}`)),
        p_subject_kind: lit(family), p_intent: `'VALIDATE'`, p_source_class: `'LOCAL_HUMAN'`, p_authority_policy_id: 'null::uuid',
        p_version_id: 'null::uuid', p_content_hash: 'null::text', p_requested_effective_from: 'null::timestamptz', p_target_state_id: 'null::uuid',
        p_prior_proposal_id: 'null::uuid', p_support_status: `'NONE'`, p_support_evidence_ids: `'{}'::text[]`, p_caller_fingerprint: `repeat('a',64)` })})`),
      'GV010', /SUBJECT_KIND_NOT_EXECUTABLE/);
    }
  });
});
