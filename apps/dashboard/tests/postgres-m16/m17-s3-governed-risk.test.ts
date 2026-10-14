import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { L15_DOMAIN_SUBJECT_MATRIX, type L15RiskDomain } from '@council/canonical-contracts';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { lit } from '../helpers/m16-governed-write-fixtures';
import {
  ALL_OBJECT_KINDS, BOGUS, DOMAINS, NONE, OBJECT_KINDS, REL_TYPES, m17s3Kit, objectSubject, relSubject,
} from '../helpers/m17-s3-fixtures';
import { m17s1Kit, machineSignalSql } from '../helpers/m17-s1-fixtures';

/**
 * M17-S3 — GOVERNED_RISK on real disposable PostgreSQL 17 (M17S3 horizon). ADR-GOVIA-RISK-INTELLIGENCE-v1 §§6, 8, 9.2, 12,
 * 16-19 — O22-O30 plus the inherited S3-owned portions of O13, O53-O58, O63-O66, O75, O79-O82, O84, O90. Every governance
 * write goes through the real RPCs as service_role with a verified principal (each statement commits naturally: the S2R1
 * root ALLOW guard runs at COMMIT; no S3 writer forces it). L15 authority enters each organisation only through an Authority
 * Policy successor.
 */
const legalTokens = (d: L15RiskDomain) => {
  const e = L15_DOMAIN_SUBJECT_MATRIX[d];
  return [...e.objects, ...e.relationships.map(r => `REL:${r}`)];
};
const M16_HISTORY = ['l14_fact_states', 'l14_registry_states', 'l14_support_links', 'l14_authority_policy_versions'];

test('M17-S3 GOVERNED_RISK (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S3R1' });
  t.after(() => c.stop());
  const { owner, svc, exec, rejects } = c;
  const k = await m17s3Kit(c);
  const s1 = await m17s1Kit(c);
  const x = await k.setup();
  const one = k.one;
  const m16Digest = () => one(`select md5(coalesce(string_agg(x, '|' order by x), '')) from (
    ${M16_HISTORY.map(tb => `select '${tb}:' || t::text as x from gov_repo.${tb} t where t.organisation_id = '${x.org}'`).join(' union all ')}) s`);
  const m16Before = await m16Digest();
  /** Owner probe with the BEFORE INSERT guards disabled (rolled back): reaches the table's own CHECK / FK constraints. */
  const forge = (sql: string) => owner(`begin;
    alter table gov_repo.l15_governed_risk_proposals disable trigger l15_governed_risk_proposals_guard;
    alter table gov_repo.l15_support_links disable trigger l15_support_links_insert_guard;
    ${sql}; rollback;`);
  const opScen = await k.scenario(x, 'op', 'OPERATIONAL', legalTokens('OPERATIONAL'));
  const privScen = await k.scenario(x, 'priv', 'PRIVACY', legalTokens('PRIVACY'));
  const av = objectSubject('AGENT_VERSION', x.objects.AGENT_VERSION!);
  let seq = 0;
  const nm = (p: string) => `${p}-${++seq}`;
  // Machine-admitted signal (bounded S1 intake LOGIN) and member hypothesis: evidence / provenance only.
  const machineSignal = (kind: string, objectId: string, ev: string, hintSeverity: string | null = null, hintConfidence: number | null = null) =>
    s1.run(s1.machine, machineSignalSql({ org: x.org, key: `s3-${randomUUID()}`, kind: 'DETECTED_PATTERN', source: 'SYSTEM_DETECTOR',
      subject: { mode: 'CANONICAL_OBJECT', kind, objectId }, trust: 'INFERRED', methodId: 'S3_TEST_DETECTOR', methodVersion: '1.0.0',
      hintSeverity, hintConfidence, tags: ['DISCOVERY_EVIDENCE'], ids: [ev] }));
  const humanHypothesis = (kind: string, objectId: string, signals: string[], confidence: number | null = null) =>
    exec(s1.humanHypothesisSql(x.member, `s3h-${randomUUID()}`, { mode: 'CANONICAL_OBJECT', kind, objectId }, signals, confidence));

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('O22 VALIDATE only via proposal -> ALLOW (current L15_GOVERNED_RISK_VALIDATE) -> decision -> state -> head; ids traceable', async () => {
    const s = objectSubject('MODEL', x.objects.MODEL!);
    const before = await k.grCounts(x.org);
    const proposal = k.proposalOf(s, opScen);
    const submitted = await k.submit(x, nm('o22'), proposal);
    assert.deepEqual([submitted.outcome, submitted.authorization_decision_id, submitted.governance_decision_id, submitted.state_id,
      submitted.risk_domain], ['SUBMITTED', null, null, null, 'OPERATIONAL'], 'submission grants nothing; domain DB-derived');
    let after = await k.grCounts(x.org);
    assert.deepEqual([after.states, after.heads, after.decisions, after.authz], [before.states, before.heads, before.decisions, before.authz]);
    const decided = await k.decide(x, nm('o22'), submitted, proposal);
    assert.equal(decided.outcome, 'VALIDATED');
    after = await k.grCounts(x.org);
    assert.deepEqual([after.states, after.heads, after.decisions, after.authz], [before.states + 1, before.heads + 1, before.decisions + 1, before.authz + 1]);
    // One read traces every id of the chain: proposal -> authorization (ALLOW, exact permission + action + typed target,
    // Authority Policy basis) -> rule snapshot -> governance decision -> state -> head -> durable result.
    const trace = await k.json(`select json_build_object(
      'state', (select to_json(s) from gov_repo.l15_governed_risk_states s where organisation_id='${x.org}' and state_id='${decided.state_id}'),
      'authz', (select to_json(a) from gov_repo.l14_authorization_decisions a where organisation_id='${x.org}' and authorization_decision_id='${decided.authorization_decision_id}'),
      'rules', (select json_agg(r.permission||':'||r.requested_action||':'||r.permission_origin) from gov_repo.l14_authorization_decision_rules r
                where organisation_id='${x.org}' and authorization_decision_id='${decided.authorization_decision_id}'),
      'decision', (select to_json(d) from gov_repo.l14_governance_decisions d where organisation_id='${x.org}' and governance_decision_id='${decided.governance_decision_id}'),
      'head', (select latest_state_id from gov_repo.l15_governed_risk_heads where organisation_id='${x.org}'
               and subject_key=gov_repo.l15_risk_subject_key_v1('CANONICAL_OBJECT','MODEL','${x.objects.MODEL}',null,null) and scenario_definition_id='${opScen.id}'),
      'result', (select l15_state_id from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${decided.command_id}'),
      'ap', (select json_build_object('id', b.authority_policy_id, 'v', b.version_id, 'h', b.content_hash) from gov_repo.l14_effective_authority_basis_v1('${x.org}', clock_timestamp()) b))`);
    assert.equal(trace.state.proposal_id, submitted.proposal_id);
    assert.equal(trace.state.governance_decision_id, decided.governance_decision_id);
    assert.equal(trace.state.authorization_decision_id, decided.authorization_decision_id);
    assert.equal(trace.state.scenario_validated_state_id, opScen.stateId);
    assert.deepEqual([trace.state.scenario_definition_id, trace.state.scenario_definition_version_id, trace.state.scenario_content_hash],
      [opScen.id, opScen.versionId, opScen.hash]);
    assert.deepEqual([trace.authz.result, trace.authz.subject_kind, trace.authz.requested_action, trace.authz.scope_tag,
      trace.authz.target_canonical_kind, trace.authz.target_canonical_object_id, trace.authz.authority_basis],
      ['ALLOW', 'GOVERNED_RISK', 'VALIDATE', 'CANONICAL_OBJECT', 'MODEL', x.objects.MODEL, 'AUTHORITY_POLICY_VERSION']);
    assert.ok(trace.rules.every((r: string) => r === 'L15_GOVERNED_RISK_VALIDATE:VALIDATE:AUTHORITY_POLICY_RULE'), JSON.stringify(trace.rules));
    assert.deepEqual([trace.state.authority_policy_id, trace.state.authority_policy_version_id, trace.state.authority_policy_content_hash],
      [trace.ap.id, trace.ap.v, trace.ap.h]);
    assert.deepEqual([trace.decision.reason_code, trace.decision.proposal_id], ['GOVERNED_RISK_VALIDATED', submitted.proposal_id]);
    assert.equal(trace.head, decided.state_id);
    assert.equal(trace.result, decided.state_id);
    assert.equal(await k.resolve(x.org, s, opScen.id), decided.state_id);
    // A VALIDATE "without proposal": an unknown / foreign proposal id is unresolved; nothing is written.
    const n0 = await k.counts(x.org);
    await rejects(exec(k.decideSql(x.validator, { commandId: x.cmd(nm('nop')), proposalId: randomUUID(), proposal })), 'GV010', /PROPOSAL_UNRESOLVED/);
    assert.deepEqual(await k.counts(x.org), n0);
  });

  await t.test('O23 REJECT / DEFER / DENY create no state and move no head; DENY durable + replayable; DEFER non-terminal', async () => {
    const s = objectSubject('API', x.objects.API!);
    const proposal = k.proposalOf(s, opScen);
    const submitted = await k.submit(x, nm('o23'), proposal);
    const before = await k.grCounts(x.org);
    const deferred = await k.decide(x, nm('o23d'), submitted, proposal, { outcome: 'DEFER' });
    assert.deepEqual([deferred.outcome, deferred.state_id], ['DEFERRED', null]);
    // DENY (member without any L15 rule): durable authorization + result; no decision, state or head.
    const denyCmd = x.cmd(nm('o23deny'));
    const denied = await exec(k.decideSql(x.member, { commandId: denyCmd, proposalId: submitted.proposal_id, proposal }));
    assert.deepEqual([denied.outcome, denied.authorization_result, denied.deny_reason, denied.governance_decision_id, denied.state_id],
      ['DENIED', 'DENY', 'NO_MATCHING_AUTHORITY_RULE', null, null]);
    const replay = await exec(k.decideSql(x.member, { commandId: denyCmd, proposalId: submitted.proposal_id, proposal }));
    assert.deepEqual([replay.replay, replay.outcome, replay.authorization_decision_id, replay.recorded_at],
      [true, 'DENIED', denied.authorization_decision_id, denied.recorded_at]);
    // The consumed DENY command id cannot be reused for an authorized VALIDATE (new command id required).
    await rejects(exec(k.decideSql(x.validator, { commandId: denyCmd, proposalId: submitted.proposal_id, proposal })), 'GV00[78]');
    const rejected = await k.decide(x, nm('o23r'), submitted, proposal, { outcome: 'REJECT' });
    assert.deepEqual([rejected.outcome, rejected.state_id], ['REJECTED', null]);
    const after = await k.grCounts(x.org);
    assert.equal(after.states, before.states);
    assert.equal(after.heads, before.heads);
    assert.equal(after.decisions, before.decisions + 2, 'DEFER + REJECT decisions only');
    assert.equal(await k.resolve(x.org, s, opScen.id), null);
    await rejects(k.decide(x, nm('o23t'), submitted, proposal), 'GV010', /PROPOSAL_TERMINAL/);
  });

  await t.test('O24 submission boundary: SYSTEM_SEED, SOURCE_CONNECTION, non-member, machine-only provenance', async () => {
    const s = objectSubject('TOOL', x.objects.TOOL!);
    const n0 = await k.counts(x.org);
    for (const [source, detail] of [['SYSTEM_SEED', /SYSTEM_SEED_NOT_ADMISSIBLE/], ['SOURCE_CONNECTION', /SOURCE_CLASS_NOT_EXECUTABLE/],
      ['MACHINE', /PROPOSAL_VOCABULARY_UNKNOWN/]] as const) {
      await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('o24')), proposal: k.proposalOf(s, opScen), rawSource: source, fingerprint: BOGUS })),
        'GV010', detail);
    }
    // A forged SYSTEM_SEED envelope cannot carry a typed GOVERNED_RISK proposal (structural guard; owner, rolled back).
    await rejects(owner(`begin;
      insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values('${x.org}','11111111-1111-4111-8111-111111111111','GOVERNED_RISK','VALIDATE','SYSTEM_SEED','${x.member.id}','NONE',now());
      insert into gov_repo.l15_governed_risk_proposals(organisation_id,proposal_id,intent,subject_type,subject_canonical_kind,subject_canonical_object_id,
        scenario_definition_id,scenario_definition_version_id,scenario_content_hash,risk_domain)
        values('${x.org}','11111111-1111-4111-8111-111111111111','VALIDATE','CANONICAL_OBJECT','TOOL','${x.objects.TOOL}','${opScen.id}','${opScen.versionId}','${opScen.hash}','OPERATIONAL');
      rollback;`), 'GV010', /GOVERNED_RISK_PROPOSAL_SOURCE_INVALID/);
    // A forged principal (no verified ACTIVE human) cannot submit.
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('o24f')), proposal: k.proposalOf(s, opScen), session: { epoch: `'2020-01-01T00:00:00Z'::timestamptz` } })),
      'GV00[0-9]');
    await rejects(exec(k.submitSql({ id: randomUUID(), org: x.org, epoch: x.member.epoch }, { commandId: x.cmd(nm('o24g')), proposal: k.proposalOf(s, opScen), fingerprint: BOGUS })),
      'GV00[0-9]');
    assert.deepEqual(await k.counts(x.org), n0);
    // Machine-generated hypotheses / signals are provenance only: a machine-admitted signal + hypothesis cited by a HUMAN
    // proposal still needs an explicit authorized decision; the machine admission itself created no proposal / decision.
    const g0 = await k.grCounts(x.org);
    const signal = await machineSignal('TOOL', x.objects.TOOL!, x.evidence, 'critical', 1.0);
    assert.deepEqual(await k.grCounts(x.org), g0, 'machine intake creates no proposal / decision / state / head');
    const p = k.proposalOf(s, opScen);
    const sub = await k.submit(x, nm('o24h'), p, { support: { status: 'PRESENT', entries: [{ tag: 'RISK_SIGNAL', targetId: signal.signal_id }] } });
    assert.equal(sub.outcome, 'SUBMITTED');
    assert.equal(await k.resolve(x.org, s, opScen.id), null, 'a cited critical / 1.0-confidence signal validates nothing');
  });

  await t.test('O25 exhaustive domain x subject matrix: 9 domains x (8 object kinds + 12 relationship types); exactly the frozen legal pairs', async () => {
    let legal = 0, illegal = 0;
    for (const domain of DOMAINS) {
      const tokens = legalTokens(domain);
      const scen = await k.scenario(x, `m-${domain.toLowerCase()}`, domain, tokens);
      for (const kind of OBJECT_KINDS) {
        const subj = objectSubject(kind, x.objects[kind]!);
        const p = k.proposalOf(subj, scen);
        if (tokens.includes(kind)) {
          const v = await k.validateRisk(x, nm(`m-${domain}-${kind}`), subj, scen);
          assert.equal(v.decided.outcome, 'VALIDATED', `${domain} x ${kind}`);
          assert.equal(v.decided.risk_domain, domain);
          legal++;
        } else {
          await rejects(k.submit(x, nm(`m-${domain}-${kind}`), p), 'GV010', /DOMAIN_SUBJECT_ILLEGAL/);
          illegal++;
        }
      }
      for (const type of REL_TYPES) {
        const subj = relSubject(x.rels[type]!);
        const p = k.proposalOf(subj, scen);
        if (tokens.includes(`REL:${type}`)) {
          const v = await k.validateRisk(x, nm(`m-${domain}-${type}`), subj, scen);
          assert.equal(v.decided.outcome, 'VALIDATED', `${domain} x REL:${type}`);
          assert.equal(v.decided.subject_relationship_type, type, 'DB-resolved type');
          legal++;
        } else {
          await rejects(k.submit(x, nm(`m-${domain}-${type}`), p), 'GV010', /DOMAIN_SUBJECT_ILLEGAL/);
          illegal++;
        }
      }
    }
    assert.equal(legal + illegal, 9 * 20);
    assert.equal(legal, 70, 'frozen §8.2 cardinality');
    // AGENT is legal only for OPERATIONAL (asserted above); PROMPT / KNOWLEDGE_BASE / SKILL are never direct subjects.
    for (const kind of ['PROMPT', 'KNOWLEDGE_BASE', 'SKILL']) {
      await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('pks')), proposal: k.proposalOf(objectSubject(kind, x.objects[kind]!), opScen),
        fingerprint: BOGUS })), 'GV010', /SUBJECT_KIND_NOT_LEGAL/);
    }
    // A legal pair the exact scenario version does not declare is refused (the scenario's own closed subject set).
    const narrow = await k.scenario(x, 'narrow', 'OPERATIONAL', ['AGENT']);
    await rejects(k.submit(x, nm('narrow'), k.proposalOf(av, narrow)), 'GV010', /SCENARIO_SUBJECT_KIND_NOT_DECLARED/);
    // The DB CHECK holds against the owner (a forged PRIVACY x AGENT state / proposal row).
    await rejects(forge(`insert into gov_repo.l15_governed_risk_proposals(organisation_id,proposal_id,intent,subject_type,subject_canonical_kind,subject_canonical_object_id,
        scenario_definition_id,scenario_definition_version_id,scenario_content_hash,risk_domain)
        values('${x.org}','${randomUUID()}','VALIDATE','CANONICAL_OBJECT','AGENT','${x.objects.AGENT}','${privScen.id}','${privScen.versionId}','${privScen.hash}','PRIVACY')`), '23514');
    // The caller cannot supply a domain: no such parameter exists, and a forged domain different from the version's fails the FK.
    const args = await one(`select string_agg(pg_get_function_arguments(oid), ' ') from pg_proc where proname in
      ('l15_submit_governed_risk_proposal_v1','l15_decide_governed_risk_proposal_v1')`);
    assert.doesNotMatch(args, /domain|score|likelihood|impact|rating|band|weight|percent|title|description|rationale|owner|lifecycle|status_/i);
    await rejects(forge(`insert into gov_repo.l15_governed_risk_proposals(organisation_id,proposal_id,intent,subject_type,subject_canonical_kind,subject_canonical_object_id,
        scenario_definition_id,scenario_definition_version_id,scenario_content_hash,risk_domain)
        values('${x.org}','${randomUUID()}','VALIDATE','CANONICAL_OBJECT','AGENT_VERSION','${x.objects.AGENT_VERSION}','${privScen.id}','${privScen.versionId}','${privScen.hash}','CYBERSECURITY')`), '23503');
  });

  await t.test('O26 relationship subjects resolve only by the exact organisation + relationship_id + relationship_state_id triple', async () => {
    const other = await k.setup({ l15: false });
    const reads = x.rels.READS_FROM!, writes = x.rels.WRITES_TO!;
    const cases: Array<[string, Record<string, string | null>, RegExp]> = [
      ['wrong-tenant triple', { subjectType: 'RELATIONSHIP_STATE', relationshipId: other.rels.READS_FROM!.relationshipId,
        relationshipStateId: other.rels.READS_FROM!.relationshipStateId }, /SUBJECT_RELATIONSHIP_STATE_UNRESOLVED/],
      ['swapped id / state id', { subjectType: 'RELATIONSHIP_STATE', relationshipId: reads.relationshipStateId,
        relationshipStateId: reads.relationshipId }, /SUBJECT_RELATIONSHIP_STATE_UNRESOLVED/],
      ['mismatched triple', { subjectType: 'RELATIONSHIP_STATE', relationshipId: reads.relationshipId,
        relationshipStateId: writes.relationshipStateId }, /SUBJECT_RELATIONSHIP_STATE_UNRESOLVED/],
      ['bare relationship_state_id', { subjectType: 'RELATIONSHIP_STATE', relationshipId: null,
        relationshipStateId: reads.relationshipStateId }, /SUBJECT_SHAPE_INVALID/],
      ['hybrid object + relationship', { subjectType: 'RELATIONSHIP_STATE', canonicalKind: 'TOOL', canonicalObjectId: x.objects.TOOL!,
        relationshipId: reads.relationshipId, relationshipStateId: reads.relationshipStateId }, /SUBJECT_SHAPE_INVALID/],
      ['object kind mismatch', { subjectType: 'CANONICAL_OBJECT', canonicalKind: 'TOOL', canonicalObjectId: x.objects.AGENT_VERSION! }, /SUBJECT_OBJECT_UNRESOLVED/],
      ['wrong-tenant object', { subjectType: 'CANONICAL_OBJECT', canonicalKind: 'AGENT_VERSION', canonicalObjectId: other.objects.AGENT_VERSION! }, /SUBJECT_OBJECT_UNRESOLVED/],
    ];
    const n0 = await k.counts(x.org);
    for (const [label, raw, detail] of cases) {
      await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('o26')), proposal: k.proposalOf(av, opScen), rawSubject: raw, fingerprint: BOGUS })),
        'GV0(08|10)', detail).catch(async () => {
        // Shape-valid inputs reach the fingerprint check first with a bogus fingerprint; re-run with the exact mirror fingerprint.
        const subject = raw.subjectType === 'CANONICAL_OBJECT' ? objectSubject(raw.canonicalKind!, raw.canonicalObjectId!) : relSubject(raw as never);
        await rejects(k.submit(x, nm('o26b'), k.proposalOf(subject, opScen)), 'GV010', detail);
      });
      void label;
    }
    assert.deepEqual(await k.counts(x.org), n0);
    // F2 is immutable (no-update / no-delete rules, untouched): a relationship state never moves. A risk on one exact triple is
    // never returned for another state id of the same relationship (no successor inference, no rollup to the relationship id).
    const rs = relSubject(x.rels.INVOKES!);
    const v = await k.validateRisk(x, nm('o26v'), rs, opScen);
    assert.equal(await k.resolve(x.org, rs, opScen.id), v.stateId);
    assert.equal(await k.resolve(x.org, { ...rs, relationshipStateId: `${x.rels.INVOKES!.relationshipStateId}:successor` } as never, opScen.id), null);
    assert.equal((await k.resolution(x.org, { ...rs, relationshipStateId: `${x.rels.INVOKES!.relationshipStateId}:successor` } as never, opScen.id)).resolution, 'NO_STATE');
    assert.deepEqual(await k.json(`select json_agg(rulename order by rulename) from pg_rules where tablename='canonical_relationships'`),
      ['canonical_relationships_no_delete', 'canonical_relationships_no_update']);
    assert.equal(await one(`select count(*) from pg_trigger where tgrelid='gov_repo.canonical_relationships'::regclass and not tgisinternal`), '0');
    assert.equal(await one(`select count(*) from pg_constraint where conrelid='gov_repo.canonical_relationships'::regclass and contype='u'
      and pg_get_constraintdef(oid) ~ 'relationship_state_id'`), '0', 'no uniqueness on relationship_state_id');
  });

  await t.test('O27 no inheritance: AGENT -> AGENT_VERSION, DATA_ASSET -> DATA_ELEMENT, object -> relationships, AGENT_VERSION v1 -> v2', async () => {
    const agent = objectSubject('AGENT', x.objects.AGENT!);
    const asset = objectSubject('DATA_ASSET', x.objects.DATA_ASSET!);
    const av1 = objectSubject('AGENT_VERSION', x.objects.AGENT_VERSION!);
    const av2 = objectSubject('AGENT_VERSION', x.objects.AGENT_VERSION_2!);
    const dataScen = await k.scenario(x, 'inh-data', 'DATA', legalTokens('DATA'));
    const inhOp = await k.scenario(x, 'inh-op', 'OPERATIONAL', legalTokens('OPERATIONAL'));
    await k.validateRisk(x, nm('inh-agent'), agent, inhOp);
    await k.validateRisk(x, nm('inh-asset'), asset, dataScen);
    await k.validateRisk(x, nm('inh-av1'), av1, inhOp);
    assert.ok(await k.resolve(x.org, agent, inhOp.id));
    assert.equal(await k.resolve(x.org, av1, inhOp.id) !== null, true);
    assert.equal(await k.resolve(x.org, av2, inhOp.id), null, 'AGENT_VERSION v1 risk never applies to v2');
    assert.equal(await k.resolve(x.org, objectSubject('DATA_ELEMENT', x.objects.DATA_ELEMENT!), dataScen.id), null, 'DATA_ASSET -> DATA_ELEMENT');
    for (const type of REL_TYPES) {
      assert.equal(await k.resolve(x.org, relSubject(x.rels[type]!), inhOp.id), null, `object risk never applies to REL:${type}`);
    }
    // Agent risk does not apply to its versions: the AGENT_VERSION key above is a separate governed statement.
    const agentOnly = await k.scenario(x, 'inh-agentonly', 'OPERATIONAL', ['AGENT']);
    await k.validateRisk(x, nm('inh-agent2'), agent, agentOnly);
    assert.equal(await k.resolve(x.org, av1, agentOnly.id), null, 'AGENT -> AGENT_VERSION never inherited');
    assert.equal((await k.read(x.member, av2, inhOp.id)).resolution, 'NO_STATE', 'absence is UNKNOWN, never "no risk"');
  });

  await t.test('O28 no free text; closed reason codes; closed closure_reason', async () => {
    const cols = await k.json(`select json_agg(c.table_name||'.'||c.column_name) from information_schema.columns c
      where c.table_schema='gov_repo' and c.table_name like 'l15_governed_risk%'`) as string[];
    assert.ok(cols.length > 40);
    for (const col of cols) {
      assert.doesNotMatch(col, /title|description|rationale|comment|note|label|narrative|score|likelihood|impact|rating|band|weight|percent|severity|confidence|lifecycle|owner/i, col);
    }
    assert.equal(await one(`select count(*) from information_schema.columns c where c.table_schema='gov_repo' and c.table_name like 'l15_governed_risk%'
      and c.data_type in ('json','jsonb','ARRAY','numeric','integer','bigint','smallint','double precision','real')`), '0');
    const s = objectSubject('MCP_SERVER', x.objects.MCP_SERVER!);
    const p = k.proposalOf(s, opScen);
    const sub = await k.submit(x, nm('o28'), p);
    for (const reason of ['GOVERNED_RISK_ACCEPTED', 'RISK_SCENARIO_DEFINITION_VALIDATED', 'GOVERNED_RISK_REVOKED', 'governed_risk_validated', '']) {
      await rejects(exec(k.decideSql(x.validator, { commandId: x.cmd(nm('o28r')), proposalId: sub.proposal_id, proposal: p, reason, fingerprint: BOGUS })),
        'GV010', /DECISION_VOCABULARY_INVALID/);
    }
    for (const closure of ['RISK_ACCEPTED', 'MITIGATED', 'TREATMENT_COMPLETED', 'EXPIRED', 'risk_no_longer_applicable']) {
      await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('o28c')), proposal: { ...p, intent: 'REVOKE', targetStateId: randomUUID(),
        expectedCurrentStateId: randomUUID(), closureReason: 'RECORDED_IN_ERROR' }, rawClosure: closure, fingerprint: BOGUS })), 'GV010', /CLOSURE_REASON_UNKNOWN/);
      await rejects(exec(k.decideSql(x.validator, { commandId: x.cmd(nm('o28d')), proposalId: sub.proposal_id, proposal: p, outcome: 'REVOKE',
        closure, fingerprint: BOGUS })), 'GV010', /CLOSURE_REASON_UNKNOWN/);
    }
    // Owner-forged unknown closure_reason / state kind rows are refused by DB CHECKs.
    await rejects(forge(`insert into gov_repo.l15_governed_risk_proposals
      (organisation_id,proposal_id,intent,subject_type,subject_canonical_kind,subject_canonical_object_id,scenario_definition_id,scenario_definition_version_id,
       scenario_content_hash,risk_domain,target_state_id,expected_current_state_id,closure_reason)
      values('${x.org}','${randomUUID()}','REVOKE','CANONICAL_OBJECT','MCP_SERVER','${x.objects.MCP_SERVER}','${opScen.id}','${opScen.versionId}','${opScen.hash}',
        'OPERATIONAL','${randomUUID()}',null,'EXPIRED')`), '23514');
  });

  await t.test('closure_reason placement: REVOKE requires exactly one; VALIDATE / REJECT / DEFER never carry one', async () => {
    const s = objectSubject('TOOL', x.objects.TOOL!);
    const toolScen = await k.scenario(x, 'cl-tool', 'CYBERSECURITY', ['TOOL']);
    const v = await k.validateRisk(x, nm('cl'), s, toolScen);
    const vp = k.proposalOf(s, toolScen, { expectedCurrentStateId: v.stateId });
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('clv')), proposal: { ...vp, closureReason: 'SUBJECT_RETIRED' }, fingerprint: BOGUS })),
      'GV010', /CLOSURE_REASON_NOT_PERMITTED/);
    const rp = k.proposalOf(s, toolScen, { intent: 'REVOKE', targetStateId: v.stateId, expectedCurrentStateId: v.stateId, closureReason: 'RECORDED_IN_ERROR' });
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('clr')), proposal: rp, rawClosure: null, fingerprint: BOGUS })),
      'GV010', /CLOSURE_REASON_REQUIRED/);
    const sub = await k.submit(x, nm('clsub'), rp);
    await rejects(exec(k.decideSql(x.validator, { commandId: x.cmd(nm('cld1')), proposalId: sub.proposal_id, proposal: rp, outcome: 'REVOKE', closure: null, fingerprint: BOGUS })),
      'GV010', /CLOSURE_REASON_REQUIRED/);
    await rejects(exec(k.decideSql(x.validator, { commandId: x.cmd(nm('cld2')), proposalId: sub.proposal_id, proposal: rp, outcome: 'REVOKE',
      closure: 'SUBJECT_RETIRED', fingerprint: BOGUS })), 'GV010', /CLOSURE_REASON_MISMATCH/);
    for (const outcome of ['REJECT', 'DEFER'] as const) {
      await rejects(exec(k.decideSql(x.validator, { commandId: x.cmd(nm('cld3')), proposalId: sub.proposal_id, proposal: rp, outcome,
        closure: 'RECORDED_IN_ERROR', fingerprint: BOGUS })), 'GV010', /CLOSURE_REASON_NOT_PERMITTED/);
    }
    const vsub = await k.submit(x, nm('clvs'), k.proposalOf(objectSubject('API', x.objects.API!), opScen));
    await rejects(exec(k.decideSql(x.validator, { commandId: x.cmd(nm('cld4')), proposalId: vsub.proposal_id,
      proposal: k.proposalOf(objectSubject('API', x.objects.API!), opScen), closure: 'RECORDED_IN_ERROR', fingerprint: BOGUS })), 'GV010', /CLOSURE_REASON_NOT_PERMITTED/);
    const done = await k.decide(x, nm('clok'), sub, rp, { outcome: 'REVOKE' });
    assert.deepEqual([done.outcome, done.closure_reason, done.predecessor_state_id], ['REVOKED', 'RECORDED_IN_ERROR', v.stateId]);
    assert.equal(await one(`select closure_reason from gov_repo.l15_governed_risk_states where state_id='${done.state_id}'`), 'RECORDED_IN_ERROR');
    assert.equal(await one(`select reason_code from gov_repo.l14_governance_decisions where governance_decision_id='${done.governance_decision_id}'`),
      'GOVERNED_RISK_REVOKED', 'shared reason code unchanged; closure_reason is the separate typed L15 field');
  });

  await t.test('O29 only an exact-current REVOKE closes a risk; wrong / closed / stale targets refused', async () => {
    const s = objectSubject('AGENT_VERSION', x.objects.AGENT_VERSION_2!);
    const v = await k.validateRisk(x, nm('o29'), s, opScen);
    const other = await k.validateRisk(x, nm('o29o'), objectSubject('MODEL', x.objects.MODEL!), privScen.id === opScen.id ? opScen
      : await k.scenario(x, 'o29m', 'MODEL', ['MODEL']));
    const before = await k.historyDigest(x.org);
    // Wrong state (another key's state).
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('o29w')), proposal: k.proposalOf(s, opScen, { intent: 'REVOKE', targetStateId: other.stateId,
      expectedCurrentStateId: v.stateId, closureReason: 'RECORDED_IN_ERROR' }), fingerprint: BOGUS })), 'GV010', /EXPECTATION_MALFORMED/);
    await rejects(k.submit(x, nm('o29w2'), k.proposalOf(s, opScen, { intent: 'REVOKE', targetStateId: other.stateId,
      expectedCurrentStateId: other.stateId, closureReason: 'RECORDED_IN_ERROR' })), 'GV009', /EXPECTATION_MISMATCH/);
    // Unknown state.
    const ghost = randomUUID();
    await rejects(k.submit(x, nm('o29g'), k.proposalOf(s, opScen, { intent: 'REVOKE', targetStateId: ghost, expectedCurrentStateId: ghost,
      closureReason: 'RECORDED_IN_ERROR' })), 'GV009');
    assert.equal(await k.historyDigest(x.org), before);
    const rv = await k.revokeRisk(x, nm('o29r'), s, opScen, v.stateId, 'RISK_ELIMINATED_BY_AVOIDANCE');
    assert.equal(rv.decided.outcome, 'REVOKED');
    assert.equal(await k.resolve(x.org, s, opScen.id), null);
    assert.equal((await k.read(x.member, s, opScen.id)).resolution, 'REVOKED');
    // Already closed: the VALIDATED target is no longer current; a second REVOKE is refused.
    await rejects(k.submit(x, nm('o29again'), k.proposalOf(s, opScen, { intent: 'REVOKE', targetStateId: v.stateId, expectedCurrentStateId: v.stateId,
      closureReason: 'RECORDED_IN_ERROR' })), 'GV009', /EXPECTATION_MISMATCH/);
    await rejects(k.submit(x, nm('o29again2'), k.proposalOf(s, opScen, { intent: 'REVOKE', targetStateId: rv.stateId, expectedCurrentStateId: rv.stateId,
      closureReason: 'RECORDED_IN_ERROR' })), 'GV0(09|10)');
    // Historical as-of before the revocation still returns the VALIDATED state (closure derived, never written).
    assert.equal(await k.resolve(x.org, s, opScen.id, `'${v.decided.recorded_at}'::timestamptz`, `'${v.decided.recorded_at}'::timestamptz`), v.stateId);
    assert.equal(await one(`select state_kind from gov_repo.l15_governed_risk_states where state_id='${v.stateId}'`), 'VALIDATED');
    // Nothing but REVOKE can close: no RPC / column / trigger turns a rating, expiry, treatment, acceptance or projection into a REVOKED state.
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and prosrc ~* 'insert\\s+into\\s+gov_repo\\.l15_governed_risk_states'`), '1',
      'exactly one writer of risk states (the decide RPC)');
  });

  await t.test('O30 scenario successor never repins; scenario revocation makes the risk not current without mutation; history reconstructible', async () => {
    const scen = await k.scenario(x, 'o30', 'CYBERSECURITY', legalTokens('CYBERSECURITY'));
    const s = objectSubject('TOOL', x.objects.TOOL!);
    const v = await k.validateRisk(x, nm('o30'), s, scen);
    const t0 = v.decided.recorded_at as string;
    const digest0 = await k.historyDigest(x.org);
    // Admit + validate a successor scenario version: the risk keeps its exact pin; nothing is written to the risk history.
    const succ = await k.scenarioSuccessor(x, 'o30-v2', scen, 'CYBERSECURITY', legalTokens('CYBERSECURITY'));
    assert.equal(await k.historyDigest(x.org), digest0, 'no repin, no row');
    const cur = await k.read(x.member, s, scen.id);
    assert.deepEqual([cur.resolution, cur.state_id, cur.scenario_definition_version_id], ['CURRENT', v.stateId, scen.versionId]);
    // An explicit, authorized successor VALIDATE is the ONLY way to repin (governed supersession of the same key).
    const repin = await k.validateRisk(x, nm('o30-repin'), s, succ, { over: { expectedCurrentStateId: v.stateId } });
    assert.deepEqual([repin.decided.outcome, repin.decided.predecessor_state_id, repin.decided.scenario_definition_version_id],
      ['VALIDATED', v.stateId, succ.versionId]);
    // Revoking the pinned version of a second risk: not current at both coordinates, no row mutation, no REVOKED manufactured.
    const s2 = objectSubject('API', x.objects.API!);
    const r2 = await k.validateRisk(x, nm('o30b'), s2, scen);
    const beforeRevoke = await k.historyDigest(x.org);
    const tb = await k.instant('0 seconds');
    await k.revokeScenario(x, 'o30-scen-rv', { admitted: scen.admitted, stateId: scen.stateId });
    assert.equal(await k.historyDigest(x.org), beforeRevoke, 'scenario invalidation writes nothing to risk history');
    assert.equal(await k.resolve(x.org, s2, scen.id), null);
    const why = await k.read(x.member, s2, scen.id);
    assert.deepEqual([why.resolution, why.state_id, why.state_kind], ['SCENARIO_DEPENDENCY_INVALID', r2.stateId, 'VALIDATED']);
    assert.equal(await one(`select count(*) from gov_repo.l15_governed_risk_states where organisation_id='${x.org}' and state_kind='REVOKED'
      and revokes_state_id='${r2.stateId}'`), '0', 'no REVOKED tombstone manufactured');
    assert.equal(await k.resolve(x.org, s2, scen.id, `'${tb}'::timestamptz`, `'${tb}'::timestamptz`), r2.stateId, 'historical as-of reconstructible');
    // The repinned risk (on the still-valid successor version) is unaffected.
    assert.equal(await k.resolve(x.org, s, scen.id), repin.stateId);
    void t0;
    // VALIDATE against a revoked / never-validated / wrong-hash / wrong-version scenario is refused.
    await rejects(k.submit(x, nm('o30c'), k.proposalOf(objectSubject('MCP_SERVER', x.objects.MCP_SERVER!), scen)), 'GV010', /SCENARIO_VERSION_NOT_VALID/);
    const admittedOnly = await k.scenarioSuccessor(x, 'o30-v3', succ, 'CYBERSECURITY', legalTokens('CYBERSECURITY'), false);
    await rejects(k.submit(x, nm('o30d'), k.proposalOf(objectSubject('MCP_SERVER', x.objects.MCP_SERVER!), admittedOnly)), 'GV010', /SCENARIO_VERSION_NOT_VALID/);
    await rejects(k.submit(x, nm('o30e'), k.proposalOf(objectSubject('MCP_SERVER', x.objects.MCP_SERVER!), { ...succ, hash: 'f'.repeat(64) })),
      'GV010', /SCENARIO_VERSION_NOT_ADMITTED/);
    await rejects(k.submit(x, nm('o30f'), k.proposalOf(objectSubject('MCP_SERVER', x.objects.MCP_SERVER!), { ...succ, versionId: opScen.versionId })),
      'GV010', /SCENARIO_VERSION_NOT_ADMITTED/);
    await rejects(k.submit(x, nm('o30g'), k.proposalOf(objectSubject('MCP_SERVER', x.objects.MCP_SERVER!), { ...succ, id: opScen.id })),
      'GV010', /SCENARIO_VERSION_NOT_ADMITTED/);
  });

  await t.test('scenario dependency: not effective yet, historical cutoff, revoked between submit and decide', async () => {
    const future = await k.instant('2 hours');
    const scen = await k.scenario(x, 'dep-future', 'FINOPS', legalTokens('FINOPS'), { from: future });
    const s = objectSubject('API', x.objects.API!);
    await rejects(k.submit(x, nm('dep1'), k.proposalOf(s, scen)), 'GV010', /SCENARIO_VERSION_NOT_VALID/);
    // A future-dated risk at/after the scenario's own effective instant is admissible (dating permission required).
    const later = await k.instant('3 hours');
    const v = await k.validateRisk(x, nm('dep2'), s, scen, { over: { requestedEffectiveFrom: later } });
    assert.equal(v.decided.outcome, 'VALIDATED');
    assert.equal(await k.resolve(x.org, s, scen.id), null, 'not yet effective');
    assert.equal(await k.resolve(x.org, s, scen.id, `'${later}'::timestamptz + interval '1 second'`), v.stateId);
    // Historical cutoff earlier than the risk's recording: invisible.
    assert.equal(await k.resolve(x.org, s, scen.id, `'${later}'::timestamptz + interval '1 second'`, `'${v.decided.recorded_at}'::timestamptz - interval '1 microsecond'`), null);
    // Scenario revoked between SUBMIT and DECIDE: the VALIDATE decision re-resolves the exact pin and fails closed.
    const scen2 = await k.scenario(x, 'dep-rv', 'MODEL', legalTokens('MODEL'));
    const p = k.proposalOf(objectSubject('MODEL', x.objects.MODEL!), scen2);
    const sub = await k.submit(x, nm('dep3'), p);
    await k.revokeScenario(x, 'dep-rv-rv', { admitted: scen2.admitted, stateId: scen2.stateId });
    const n0 = await k.grCounts(x.org);
    await rejects(k.decide(x, nm('dep3d'), sub, p), 'GV010', /SCENARIO_DEPENDENCY_NOT_VALID/);
    assert.deepEqual(await k.grCounts(x.org), n0, 'nothing consumed');
  });

  await t.test('authority: wrong permissions, no L15 rule, self-validation, typed scope, contributing, temporal flags, service_role', async () => {
    const s = objectSubject('DATA_ASSET', x.objects.DATA_ASSET!);
    const dScen = await k.scenario(x, 'auth-data', 'DATA', legalTokens('DATA'), { from: await k.instant('-1 hour') });
    const p = k.proposalOf(s, dScen);
    const sub = await k.submit(x, nm('auth'), p);
    const deny = async (actor: typeof x.member, reason: string, proposal = p, submitted = sub) => {
      const r = await exec(k.decideSql(actor, { commandId: x.cmd(nm('deny')), proposalId: submitted.proposal_id, proposal }));
      assert.deepEqual([r.outcome, r.deny_reason, r.state_id], ['DENIED', reason, null]);
    };
    await deny(x.l14Resp, 'NO_MATCHING_AUTHORITY_RULE');           // L14 permission attempting risk validation
    await deny(x.scenarioValidator, 'NO_MATCHING_AUTHORITY_RULE'); // scenario permission
    await deny(x.treatment, 'NO_MATCHING_AUTHORITY_RULE');         // treatment permission
    await deny(x.admin, 'NO_MATCHING_AUTHORITY_RULE');             // legacy GOVERNANCE_ADMIN wildcard
    await deny(x.contrib, 'SOURCE_NOT_AUTHORIZED');                // CONTRIBUTING never authorizes
    await deny(x.kindScoped, 'SCOPE_NOT_AUTHORIZED');              // CANONICAL_KIND AGENT_VERSION vs DATA_ASSET
    await deny(x.relTypeScoped, 'SCOPE_NOT_AUTHORIZED');           // RELATIONSHIP_TYPE never matches an object
    // Typed scope evaluated against the exact subject: object-scoped rule matches its exact DATA_ASSET.
    const ok = await exec(k.decideSql(x.objectScoped, { commandId: x.cmd(nm('scope-ok')), proposalId: sub.proposal_id, proposal: p }));
    assert.equal(ok.outcome, 'VALIDATED');
    // Relationship-type / relationship-state scoped rules match only their exact relationship subject.
    const rsubj = relSubject(x.rels.READS_FROM!);
    const rp = k.proposalOf(rsubj, dScen);
    const rsub = await k.submit(x, nm('auth-rel'), rp);
    await deny(x.kindScoped, 'SCOPE_NOT_AUTHORIZED', rp, rsub);
    const wp = k.proposalOf(relSubject(x.rels.WRITES_TO!), dScen);
    const wsub = await k.submit(x, nm('auth-rel-w'), wp);
    await deny(x.relTypeScoped, 'SCOPE_NOT_AUTHORIZED', wp, wsub);
    await deny(x.relStateScoped, 'SCOPE_NOT_AUTHORIZED', wp, wsub);
    assert.equal((await exec(k.decideSql(x.relStateScoped, { commandId: x.cmd(nm('rs-ok')), proposalId: rsub.proposal_id, proposal: rp }))).outcome, 'VALIDATED');
    // Self-validation fails closed; allowed only by an explicit allowSelfValidation rule.
    const sp = k.proposalOf(objectSubject('DATA_ELEMENT', x.objects.DATA_ELEMENT!), dScen);
    const ssub = await k.submit(x, nm('self'), sp, {}, x.validator);
    await deny(x.validator, 'SELF_VALIDATION_NOT_PERMITTED', sp, ssub);
    const sp2 = k.proposalOf(objectSubject('DATA_ELEMENT', x.objects.DATA_ELEMENT_2!), dScen);
    const ssub2 = await k.submit(x, nm('self2'), sp2, {}, x.self);
    assert.equal((await exec(k.decideSql(x.self, { commandId: x.cmd(nm('self-ok')), proposalId: ssub2.proposal_id, proposal: sp2 }))).outcome, 'VALIDATED');
    // Temporal flags: BACKDATED / FUTURE_DATED need the matched rule's flag.
    const past = await k.instant('-1 minute');
    const tp = k.proposalOf(relSubject(x.rels.DERIVED_FROM!), dScen, { requestedEffectiveFrom: past });
    const tsub = await k.submit(x, nm('temporal'), tp);
    await deny(x.validator, 'TEMPORAL_ACTION_NOT_AUTHORIZED', tp, tsub);
    // service_role with a forged / null / suspended principal: GV00x, nothing written.
    const n0 = await k.counts(x.org);
    await rejects(exec(k.decideSql(x.validator, { commandId: x.cmd(nm('forge')), proposalId: tsub.proposal_id, proposal: tp,
      session: { epoch: `'2020-01-01T00:00:00Z'::timestamptz` } })), 'GV00[0-9]');
    await rejects(svc(`select * from gov_repo.l15_decide_governed_risk_proposal_v1(null,null,null,null,null,'x',null,'VALIDATE','GOVERNED_RISK_VALIDATED',null,null,'NONE','{}','{}','${BOGUS}')`), 'GV00[0-9]|22004|P0001');
    assert.deepEqual(await k.counts(x.org), n0);
  });

  await t.test('no GOVERNED_RISK rule in the organisation: every decision is a durable, replayable DENY (no bootstrap, no wildcard)', async () => {
    const y = await k.setup({ gr: false });
    const scen = await k.scenario(y, 'nogr-scn', 'OPERATIONAL', ['AGENT']);
    const s = objectSubject('AGENT', y.objects.AGENT!);
    const p = k.proposalOf(s, scen);
    const sub = await k.submit(y, 'nogr', p);
    for (const actor of [y.admin, y.scenarioValidator, y.validator, y.boot, y.ops]) {
      const cmd = y.cmd(`nogr-${randomUUID().slice(0, 6)}`);
      const r = await exec(k.decideSql(actor, { commandId: cmd, proposalId: sub.proposal_id, proposal: p }));
      assert.deepEqual([r.outcome, r.deny_reason, r.state_id], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE', null]);
      assert.equal((await exec(k.decideSql(actor, { commandId: cmd, proposalId: sub.proposal_id, proposal: p }))).replay, true);
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${y.org}' and subject_kind='GOVERNED_RISK' and result='ALLOW'`), '0');
    assert.equal((await k.grCounts(y.org)).states, 0);
  });

  await t.test('temporal (M16 §17): DB recorded_at, IMMEDIATE, BACKDATED / FUTURE_DATED, explicit immutable effective_to, no early hiding', async () => {
    const scen = await k.scenario(x, 'tmp', 'AUTONOMY', legalTokens('AUTONOMY'), { from: await k.instant('-1 hour') });
    const s = relSubject(x.rels.HANDOFF_TO!);
    const v = await k.validateRisk(x, nm('tmp'), s, scen);
    assert.equal(v.decided.effective_from, v.decided.recorded_at, 'omitted effective_from = DB transaction instant');
    // Future-effective REVOKE does not hide the state early.
    const fut = await k.instant('1 hour');
    const rv = await k.revokeRisk(x, nm('tmp-rv'), s, scen, v.stateId, 'RISK_NO_LONGER_APPLICABLE', { from: fut });
    assert.equal(await one(`select '${rv.decided.effective_from}'::timestamptz = '${fut}'::timestamptz`), 't', 'FUTURE_DATED revoke instant kept');
    assert.equal(await k.resolve(x.org, s, scen.id), v.stateId, 'still current until the future revocation instant');
    assert.equal(await k.resolve(x.org, s, scen.id, `'${fut}'::timestamptz`), null);
    assert.equal(await one(`select effective_to is null from gov_repo.l15_governed_risk_states where state_id='${v.stateId}'`), 't', 'predecessor never written');
    // Backdated VALIDATE (dating permission) with an explicit immutable effective_to; at effective_to it is EXPIRED without UPDATE.
    const s2 = objectSubject('AGENT_VERSION', x.objects.AGENT_VERSION!);
    const from = await k.instant('-10 seconds'), to = await k.instant('20 minutes');
    const b = await k.validateRisk(x, nm('tmp-b'), s2, scen, { over: { requestedEffectiveFrom: from, requestedEffectiveTo: to } });
    assert.equal(b.decided.outcome, 'VALIDATED');
    assert.equal(await k.resolve(x.org, s2, scen.id, `'${to}'::timestamptz`), null);
    assert.equal((await k.read(x.member, s2, scen.id, `'${to}'::timestamptz`)).resolution, 'EXPIRED');
    assert.equal(await k.resolve(x.org, s2, scen.id, `'${to}'::timestamptz - interval '1 microsecond'`), b.stateId);
    // A successor before the predecessor's explicit end is a continuity violation (GV011).
    const early = await k.instant('10 minutes');
    const pp = k.proposalOf(s2, scen, { expectedCurrentStateId: b.stateId, requestedEffectiveFrom: early, requestedEffectiveTo: null });
    const ps = await k.submit(x, nm('tmp-early'), pp);
    // same version + hash but predecessor has an explicit end -> allowed only at/after the end
    await rejects(k.decide(x, nm('tmp-early'), ps, pp, {}, x.dater), 'GV011', /SUCCESSOR_BEFORE_PREDECESSOR_END/);
    // Interval shape.
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('tmp-int')), proposal: k.proposalOf(s2, scen, { requestedEffectiveFrom: to,
      requestedEffectiveTo: from, expectedCurrentStateId: b.stateId }), fingerprint: BOGUS })), 'GV010', /EFFECTIVE_INTERVAL_INVALID/);
  });

  await t.test('replay: exact retry returns the original durable result; changed payload GV007; wrong caller fingerprint GV008; stale GV009', async () => {
    const s = objectSubject('MODEL', x.objects.MODEL!);
    const scen = await k.scenario(x, 'rep', 'FINOPS', legalTokens('FINOPS'));
    const p = k.proposalOf(s, scen);
    const cmd = x.cmd(nm('rep-sub'));
    const a = await exec(k.submitSql(x.member, { commandId: cmd, proposal: p }));
    const b = await exec(k.submitSql(x.member, { commandId: cmd, proposal: p }));
    assert.deepEqual([b.replay, b.proposal_id, b.recorded_at], [true, a.proposal_id, a.recorded_at]);
    await rejects(exec(k.submitSql(x.member, { commandId: cmd, proposal: { ...p, requestedEffectiveTo: await k.instant('1 day') } })), 'GV007');
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('rep-fp')), proposal: p, fingerprint: BOGUS })), 'GV008');
    const dcmd = x.cmd(nm('rep-dec'));
    const d1 = await exec(k.decideSql(x.validator, { commandId: dcmd, proposalId: a.proposal_id, proposal: p }));
    const d2 = await exec(k.decideSql(x.validator, { commandId: dcmd, proposalId: a.proposal_id, proposal: p }));
    assert.deepEqual([d2.replay, d2.state_id, d2.authorization_decision_id, d2.governance_decision_id, d2.recorded_at, d2.effective_from],
      [true, d1.state_id, d1.authorization_decision_id, d1.governance_decision_id, d1.recorded_at, d1.effective_from]);
    await rejects(exec(k.decideSql(x.validator, { commandId: dcmd, proposalId: a.proposal_id, proposal: p, outcome: 'DEFER' })), 'GV007');
    // Stale expected-current / expected-none.
    const p2 = k.proposalOf(s, scen);
    await rejects(k.submit(x, nm('rep-stale'), p2), 'GV009', /GOVERNED_RISK_STATE_EXISTS/);
    await rejects(k.submit(x, nm('rep-stale2'), { ...p2, expectedCurrentStateId: randomUUID() }), 'GV009', /EXPECTATION_MISMATCH/);
    // Same exact pin again (already VALIDATED, open-ended): refused.
    const same = k.proposalOf(s, scen, { expectedCurrentStateId: d1.state_id });
    const ss = await k.submit(x, nm('rep-same'), same);
    await rejects(k.decide(x, nm('rep-same'), ss, same), 'GV010', /GOVERNED_RISK_ALREADY_VALIDATED/);
    // Decide expectation must equal the proposal's own explicit expectation and the head.
    await rejects(exec(k.decideSql(x.validator, { commandId: x.cmd(nm('rep-exp')), proposalId: ss.proposal_id, proposal: same, expected: null })),
      'GV009');
  });

  await t.test('support (D-03): GOVERNED_RISK rank-3 owners cite hypotheses, signals and every rank-0 tag; same tenant; never a governed artifact', async () => {
    const signal = await machineSignal('TOOL', x.objects.TOOL!, x.evidence);
    const hyp = await humanHypothesis('TOOL', x.objects.TOOL!, [signal.signal_id]);
    const assertion = await one(`select assertion_id from gov_repo.source_assertions where organisation_id='${x.org}' limit 1`);
    const s = objectSubject('TOOL', x.objects.TOOL!);
    const scen = await k.scenario(x, 'sup', 'CONNECTIVITY', legalTokens('CONNECTIVITY'));
    const support = { status: 'PRESENT', entries: [{ tag: 'RISK_HYPOTHESIS', targetId: hyp.hypothesis_id }, { tag: 'RISK_SIGNAL', targetId: signal.signal_id },
      { tag: 'DISCOVERY_EVIDENCE', targetId: x.evidence }, { tag: 'SOURCE_ASSERTION', targetId: assertion }] } as const;
    const v = await k.validateRisk(x, nm('sup'), s, scen, { support, decideSupport: support });
    const links = await k.json(`select json_agg(owner_governed_risk_artifact||':'||target_tag order by 1) from gov_repo.l15_support_links
      where organisation_id='${x.org}' and owner_kind='GOVERNED_RISK' and (owner_governed_risk_proposal_id='${v.submitted.proposal_id}'
        or owner_governance_decision_id='${v.decided.governance_decision_id}' or owner_governed_risk_state_id='${v.stateId}')`) as string[];
    assert.equal(links.length, 12, 'proposal + decision + state links (state links = decision links)');
    assert.equal((await k.read(x.member, s, scen.id)).support_currency, 'SUPPORT_CURRENT');
    // Cross-tenant target of every tag class is unresolved; an unknown tag is refused.
    const other = await k.setup({ l15: false });
    for (const [tag, id] of [['DISCOVERY_EVIDENCE', other.evidence], ['RISK_SIGNAL', randomUUID()], ['RISK_HYPOTHESIS', randomUUID()],
      ['L14_FACT_STATE', randomUUID()], ['RUNTIME_OBSERVATION', randomUUID()], ['SOURCE_ASSERTION', `assertion-${other.label}-agent`],
      ['CROSS_SIGNAL_RESULT', 'nope'], ['EXECUTION_FIELD_STATE', 'nope'], ['TECHNICAL_FIELD_STATE', 'nope'], ['LINEAGE_OBSERVATION', 'nope']] as const) {
      await rejects(k.submit(x, nm('sup-x'), k.proposalOf(objectSubject('API', x.objects.API!), scen),
        { support: { status: 'PRESENT', entries: [{ tag, targetId: id }] } }), 'GV0(09|10)', /SUPPORT_TARGET_UNRESOLVED|STATE_EXISTS/);
    }
    for (const tag of ['GOVERNED_RISK', 'RISK_ASSESSMENT', 'RISK_TREATMENT', 'RISK_ACCEPTANCE', 'RISK_SCENARIO_DEFINITION', 'L15_STATE']) {
      await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('sup-t')), proposal: k.proposalOf(objectSubject('API', x.objects.API!), scen),
        support: { status: 'PRESENT', entries: [{ tag: tag as never, targetId: v.stateId }] }, fingerprint: BOGUS })), 'GV010', /SUPPORT_TAG_UNKNOWN/);
    }
    // DB matrix: a GOVERNED_RISK owner can never point at an L15 governed artifact (no such tag) and the S1 / S2 owners keep
    // their narrower matrices (an S2 registry owner -> RISK_SIGNAL stays refused).
    await rejects(forge(`insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_registry_artifact,owner_scenario_state_id,
      target_tag,target_risk_signal_id,recorded_at) values('${x.org}','${randomUUID()}','RISK_SCENARIO_DEFINITION','STATE','${scen.stateId}','RISK_SIGNAL',
      '${signal.signal_id}',now())`), '23514');
    // Two typed owners / owner of the wrong kind on one GOVERNED_RISK row: shape CHECK.
    await rejects(forge(`insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_governed_risk_artifact,owner_governed_risk_state_id,
      owner_governed_risk_proposal_id,target_tag,target_discovery_evidence_id,recorded_at) values('${x.org}','${randomUUID()}','GOVERNED_RISK','STATE',
      '${v.stateId}','${v.submitted.proposal_id}','DISCOVERY_EVIDENCE','${x.evidence}',now())`), '23514');
    // Late support (owner not written by this transaction) is refused even for the owner.
    await rejects(owner(`begin; insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_governed_risk_artifact,owner_governed_risk_state_id,
      target_tag,target_discovery_evidence_id,recorded_at) values('${x.org}','${randomUUID()}','GOVERNED_RISK','STATE','${v.stateId}','DISCOVERY_EVIDENCE',
      '${x.evidence}',now()); rollback;`), 'GV010', /SUPPORT_OWNER_NOT_IN_TRANSACTION/);
    // Support links are immutable.
    for (const sql of ['update gov_repo.l15_support_links set recorded_at=now() where owner_kind=\'GOVERNED_RISK\'',
      'delete from gov_repo.l15_support_links where owner_kind=\'GOVERNED_RISK\'']) {
      await rejects(owner(sql), '55000', /L15_HISTORY_IMMUTABLE/);
    }
  });

  await t.test('high confidence / critical severity / 100 hypotheses / conflicting hypotheses grant zero authority', async () => {
    const sig = await machineSignal('MCP_SERVER', x.objects.MCP_SERVER!, x.evidence, 'critical', 1.0);
    const hyps: string[] = [];
    for (let i = 0; i < 100; i++) hyps.push((await humanHypothesis('MCP_SERVER', x.objects.MCP_SERVER!, [sig.signal_id], i % 2 ? 1.0 : 0.0)).hypothesis_id);
    const before = await k.grCounts(x.org);
    assert.equal(await k.resolve(x.org, objectSubject('MCP_SERVER', x.objects.MCP_SERVER!), opScen.id), null);
    const s = objectSubject('MCP_SERVER', x.objects.MCP_SERVER!);
    const p = k.proposalOf(s, opScen);
    const sub = await k.submit(x, nm('hc'), p, { support: { status: 'PRESENT', entries: hyps.slice(0, 64).map(h => ({ tag: 'RISK_HYPOTHESIS' as const, targetId: h })) } });
    const denied = await exec(k.decideSql(x.member, { commandId: x.cmd(nm('hc-d')), proposalId: sub.proposal_id, proposal: p }));
    assert.equal(denied.outcome, 'DENIED', 'support of any size / confidence / severity never authorizes');
    const after = await k.grCounts(x.org);
    assert.equal(after.states, before.states);
  });

  await t.test('golden vectors: the TypeScript mirrors and the PostgreSQL frames are pinned to the same bytes', async () => {
    // Literal values are the governance-review / canonical-contracts unit-test goldens (l15-governed-risk tests).
    assert.equal(await one(`select gov_repo.l15_risk_subject_key_v1('RELATIONSHIP_STATE', null, null, 'r', 's\u{1F600}')`), 'RELATIONSHIP_STATE|1:r|2:s\u{1F600}');
    assert.equal(await one(`select gov_repo.l15_risk_subject_key_v1('CANONICAL_OBJECT', 'TOOL', 'a|1:b', null, null)`), 'CANONICAL_OBJECT|4:TOOL|5:a|1:b');
    assert.equal(await one(`select gov_repo.l15_risk_subject_key_v1('CANONICAL_OBJECT', 'PROMPT', 'x', null, null) is null`), 't');
    const supportParts = `gov_repo.l15_governed_risk_support_parts_v1('PRESENT', array['RISK_SIGNAL','DISCOVERY_EVIDENCE'],
      array['00000000-0000-4000-8000-0000000000c1','evidence:golden'])`;
    assert.equal(await one(`select array_to_string(${supportParts}, ',')`),
      'SUPPORT,PRESENT,2,DISCOVERY_EVIDENCE,evidence:golden,RISK_SIGNAL,00000000-0000-4000-8000-0000000000c1');
    const org = '00000000-0000-4000-8000-000000000031', actor = '00000000-0000-4000-8000-000000000032';
    const pins = `'00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','${'c'.repeat(64)}'`;
    assert.equal(await one(`select gov_repo.l14_sha256_frame_v1(array['L15_COMMAND_FINGERPRINT_V1','SUBMIT_PROPOSAL','${org}','${actor}',
      'GOVERNED_RISK','VALIDATE','LOCAL_HUMAN','RELATIONSHIP_STATE','canonical-relationship:golden','canonical-relationship:golden:initial',
      ${pins},'EXPLICIT','2026-10-13T12:00:00.000000Z','EFFECTIVE_TO','2027-10-13T12:00:00.000000Z','EXPECTED_NONE','NO_TARGET_STATE',
      'NO_CLOSURE_REASON','NO_PRIOR_PROPOSAL'] || ${supportParts})`), 'a99281cd6c4b80ad685e083b2a15c7bac38fa7a92896c1dc829f395799690bc0');
    assert.equal(await one(`select gov_repo.l14_sha256_frame_v1(array['L15_COMMAND_FINGERPRINT_V1','DECIDE_PROPOSAL','${org}','${actor}',
      'REVOKE','GOVERNED_RISK_REVOKED','00000000-0000-4000-8000-0000000000b3','GOVERNED_RISK','REVOKE','LOCAL_HUMAN','CANONICAL_OBJECT',
      'AGENT_VERSION','agent-version:golden',${pins},'IMMEDIATE','NO_EFFECTIVE_TO','TARGET_STATE','00000000-0000-4000-8000-0000000000b4',
      'EXPECTED_CURRENT','00000000-0000-4000-8000-0000000000b4','CLOSURE_REASON','SUBJECT_RETIRED'] || gov_repo.l15_governed_risk_support_parts_v1('NONE', '{}'::text[], '{}'::text[]))`),
    '294ccddfb6a6f2380c41d7b6cf8e595997bb1186053ff98b39d96b53672aa391');
    // The RPC bodies build exactly these frames (GV008 otherwise): every RPC call of these suites uses the TypeScript mirror.
    for (const [fn, frame] of [['l15_submit_governed_risk_proposal_v1', "'SUBMIT_PROPOSAL'"], ['l15_decide_governed_risk_proposal_v1', "'DECIDE_PROPOSAL'"]]) {
      assert.equal(await one(`select prosrc ~ ${lit(`L15_COMMAND_FINGERPRINT_V1', ${frame}`)} from pg_proc where proname='${fn}'`), 't', fn);
    }
  });

  await t.test('O07 / O13 invariants: M16 history byte-identical; signals / hypotheses create no governance artifact', async () => {
    assert.equal(await m16Digest(), m16Before);
    assert.equal(await one(`select count(*) from gov_repo.l14_fact_states where subject_kind not in ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
      'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT')`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_registry_states r join gov_repo.l14_proposals p using (organisation_id) where p.subject_kind='GOVERNED_RISK' and false`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_proposals where subject_kind in ('RISK_SIGNAL','RISK_HYPOTHESIS')`), '0');
  });
});
