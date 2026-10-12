import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { L14AuthorityPolicyRule } from '@council/canonical-contracts';
import { m17S0AuthorityExtensionMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { l14Cluster, lastLine, rule, type Actor } from '../helpers/m16-l14-fixtures';
import { controlAssessmentKit, inDays } from '../helpers/m16-l14-control-assessment-fixtures';
import { l15SecurityViolationsSql } from '../helpers/m17-l15-security-profile';

/**
 * M17-S0 — Authority / security / root contracts + legacy compatibility hardening on real disposable PostgreSQL 17.
 * ADR-GOVIA-RISK-INTELLIGENCE-v1 (ACCEPTED / FROZEN) O01-O07, O53-O62, O73-O78, O85-O91 (S0-owned portions) and
 * ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1 (D-01). The cluster is built to the exact post-M16 catalog, populated with
 * real M16 governance history through the real public RPCs (Authority Policy, CONTROL_DEFINITION registry,
 * CONTROL_APPLICABILITY and CONTROL_ASSESSMENT facts, DENY / REJECT outcomes) plus legacy risk rows; then the S0 migration is
 * applied and every check runs against the migrated catalog. No L15 store exists in S0: direct envelope inserts made as the
 * owner (inside transactions that never persist) stand in for the future L15 RPCs to prove what the shared envelope admits.
 */

const L14_PERMISSIONS = ['L14_AUTHORITY_POLICY_ADMIT', 'L14_PARTY_ADMIT', 'L14_DOMAIN_ADMIT', 'L14_CONTROL_DEFINITION_ADMIT',
  'L14_POLICY_CONTENT_ADMIT', 'L14_AUTHORITY_POLICY_ADMIN', 'L14_PARTY_VALIDATE', 'L14_DOMAIN_VALIDATE', 'L14_CONTROL_DEFINITION_VALIDATE',
  'L14_POLICY_VERSION_VALIDATE', 'L14_RESPONSIBILITY_VALIDATE', 'L14_BUSINESS_CONTEXT_VALIDATE', 'L14_POLICY_APPLICABILITY_VALIDATE',
  'L14_CONTROL_APPLICABILITY_VALIDATE', 'L14_CONTROL_ASSESSMENT_VALIDATE'];
const L15_PERMISSIONS = ['L15_RISK_SCENARIO_ADMIT', 'L15_RISK_SCENARIO_VALIDATE', 'L15_RISK_METHODOLOGY_ADMIT', 'L15_RISK_METHODOLOGY_VALIDATE',
  'L15_GOVERNED_RISK_VALIDATE', 'L15_RISK_ASSESSMENT_VALIDATE', 'L15_RISK_TREATMENT_VALIDATE', 'L15_RISK_ACCEPTANCE_VALIDATE'];
const M16_SUBJECTS = ['AUTHORITY_POLICY_VERSION', 'GOVERNANCE_PARTY', 'BUSINESS_DOMAIN', 'INFORMATION_DOMAIN', 'CONTROL_DEFINITION',
  'POLICY_VERSION', 'RESPONSIBILITY_ASSIGNMENT', 'BUSINESS_CONTEXT_ASSIGNMENT', 'POLICY_APPLICABILITY', 'CONTROL_APPLICABILITY',
  'CONTROL_ASSESSMENT'];
const L15_SUBJECTS = ['RISK_SCENARIO_DEFINITION', 'RISK_METHODOLOGY', 'GOVERNED_RISK', 'RISK_ASSESSMENT', 'RISK_TREATMENT', 'RISK_ACCEPTANCE'];
const OUTCOMES = ['VALIDATED', 'REJECTED', 'DEFERRED', 'REVOKED'];
const reasonCodes = (subjects: readonly string[]) =>
  subjects.flatMap(s => OUTCOMES.map(o => `${s === 'AUTHORITY_POLICY_VERSION' ? 'AUTHORITY_POLICY' : s}_${o}`));
const M16_COMMANDS = ['ADMIT_AUTHORITY_POLICY_VERSION', 'SUBMIT_PROPOSAL', 'DECIDE_PROPOSAL', 'ADMIT_GOVERNANCE_PARTY', 'ADMIT_BUSINESS_DOMAIN',
  'ADMIT_INFORMATION_DOMAIN', 'ADMIT_CONTROL_DEFINITION_VERSION', 'ADMIT_GOVERNANCE_POLICY', 'ADMIT_POLICY_VERSION'];
const L15_COMMANDS = ['ADMIT_RISK_SCENARIO_DEFINITION_VERSION', 'ADMIT_RISK_METHODOLOGY_VERSION'];
const sorted = (values: readonly string[]) => [...values].sort();

const ENVELOPE = ['l14_authority_policies', 'l14_authority_policy_versions', 'l14_authority_policy_rules', 'l14_proposals',
  'l14_authority_policy_version_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
  'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_authority_policy_states', 'l14_authority_policy_heads',
  'l14_command_results', 'l14_support_links', 'l14_fact_states', 'l14_registry_states'];
const WIDENED = new Set([
  'l14_authority_policy_rules.l14_authority_policy_rules_permission_check',
  'l14_authorization_decision_rules.l14_authorization_decision_rules_permission_check',
  'l14_authorization_decisions.l14_authorization_decisions_subject_kind_check',
  'l14_proposals.l14_proposals_subject_kind_check',
  'l14_governance_decisions.l14_governance_decisions_subject_kind_check',
  'l14_governance_decisions.l14_governance_decisions_reason_code_check',
  'l14_command_results.l14_command_results_subject_kind_check',
  'l14_command_results.l14_command_results_command_kind_check',
  'l14_command_results.l14_command_results_command_subject_check',
  'l14_command_results.l14_command_results_shape_check',
]);

test('M17-S0 authority / security / root contracts + legacy hardening (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S0', stopBefore: m17S0AuthorityExtensionMigration });
  t.after(() => c.stop());
  const { owner, svc, exec, rejects, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const json = async (query: string) => JSON.parse(await one(query));
  const vocabulary = async (conname: string) => json(`select coalesce(json_agg(distinct m.v[1] order by m.v[1]), '[]')
    from pg_constraint k cross join lateral regexp_matches(pg_get_constraintdef(k.oid), '''([A-Z0-9_]+)''', 'g') as m(v)
    where k.connamespace = 'gov_repo'::regnamespace and k.conname = '${conname}'`) as Promise<string[]>;
  const constraintDefs = async () => json(`select json_object_agg(replace(c.conrelid::regclass::text, 'gov_repo.', '') || '.' || c.conname,
    pg_get_constraintdef(c.oid)) from pg_constraint c join pg_class r on r.oid = c.conrelid
    where r.relnamespace = 'gov_repo'::regnamespace`) as Promise<Record<string, string>>;
  const digest = async (tables: readonly string[]) => one(`select md5(string_agg(x, '|' order by x)) from (
    ${tables.map(tb => `select '${tb}:' || t::text as x from gov_repo.${tb} t`).join(' union all ')}) s`);
  const LEGACY = ['risk_entries', 'risk_treatments', 'agents', 'governance_ledger'];
  const agentColumns = () => one(`select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''),
    ',' order by ordinal_position) from information_schema.columns where table_schema = 'gov_repo' and table_name = 'agents'`);

  // ---- Real M16 governance history through the real RPCs (AP bootstrap, CONTROL_DEFINITION registry, two fact families,
  //      VALIDATE / REVOKE / REJECT / DENY outcomes) + legacy risk rows written by the owner (administrator support rows).
  const k = await controlAssessmentKit(c);
  const ctx = await k.setup();
  const applies = await k.applicability(ctx, 'pre', k.cak.objectTarget('AGENT', ctx.objects.byKind.AGENT));
  const assessed = await k.assess(ctx, 'pre-assess', applies.stateId, { outcome: 'NOT_SATISFIED' });
  await k.revoke(ctx, 'pre', applies.stateId, assessed.stateId, 'NOT_SATISFIED');
  const denyProposal = k.validateProposal(applies.stateId, 'SATISFIED', inDays(10));
  const denySubmitted = await k.submit(ctx, ctx.member, 'pre-deny-submit', denyProposal);
  const denied = await k.decide(ctx, ctx.asapplicability, 'pre-deny', denySubmitted, denyProposal);
  assert.equal(denied.outcome, 'DENIED');
  const rejected = await k.decide(ctx, ctx.as, 'pre-reject', denySubmitted, denyProposal, 'REJECT');
  assert.equal(rejected.outcome, 'REJECTED');
  await owner(`insert into gov_repo.risk_entries(risk_code,title,description,risk_category,risk_domain,likelihood,impact,
      residual_risk_score,owner_user_id,organisation_id,related_agent_ids)
    values ('LEG-1','Legacy risk','legacy','operational','ai',5,5,20,'${ctx.member.id}','${ctx.org}','{}');
    insert into gov_repo.risk_treatments(risk_id,treatment_type,treatment_plan,due_date,responsible_id,status)
      select risk_id,'accept','legacy plan',current_date,'${ctx.member.id}','verified' from gov_repo.risk_entries where risk_code = 'LEG-1';
    insert into gov_repo.agents(agent_code,name,description,agent_type,owner_user_id,organisation_id,created_by,risk_level,ai_act_risk_class)
      values ('LEG-AG','Legacy agent','legacy','assistive','${ctx.member.id}','${ctx.org}','${ctx.member.id}','critical','high');`);
  // Positive control: before S0, service_role CAN write the legacy register (the freeze below is a real change).
  await svc(`update gov_repo.risk_entries set title = title where false; update gov_repo.risk_treatments set status = status where false;`);

  const beforeDefs = await constraintDefs();
  const beforeEnvelope = await digest(ENVELOPE);
  const beforeTyped = await digest(['l14_control_assessment_states', 'l14_control_assessment_proposals', 'l14_control_assessment_heads',
    'l14_control_applicability_states', 'l14_control_applicability_proposals', 'l14_control_definition_versions']);
  const beforeLegacy = await digest(LEGACY);
  const beforeAgentColumns = await agentColumns();
  const beforeCounts = await json(`select json_object_agg(t, n) from (${ENVELOPE.map(tb =>
    `select '${tb}' as t, (select count(*) from gov_repo.${tb}) as n`).join(' union all ')}) s`);

  await t.test('preflight is exact: the migration refuses a pre-existing L15 object and changes nothing', async () => {
    await assert.rejects(owner(`begin; create table gov_repo.l15_probe(x int); ${migrationSource(m17S0AuthorityExtensionMigration).replace(/^BEGIN;/m, '').replace(/COMMIT;\s*$/, '')} rollback;`),
      /M17_S0_PREFLIGHT: an L15 object already exists/);
    assert.equal(await one(`select count(*) from pg_class where relname = 'l15_probe'`), '0');
    assert.deepEqual(await vocabulary('l14_authorization_decisions_subject_kind_check'), sorted(M16_SUBJECTS));
  });

  await c.migrate(m17S0AuthorityExtensionMigration);

  await t.test('O77 / O86 / O89 / O07: every pre-existing M16 governance row, legacy risk row and agent column is byte-identical', async () => {
    assert.equal(await digest(ENVELOPE), beforeEnvelope);
    assert.equal(await digest(['l14_control_assessment_states', 'l14_control_assessment_proposals', 'l14_control_assessment_heads',
      'l14_control_applicability_states', 'l14_control_applicability_proposals', 'l14_control_definition_versions']), beforeTyped);
    assert.equal(await digest(LEGACY), beforeLegacy);
    assert.equal(await agentColumns(), beforeAgentColumns, 'no column / default / NOT NULL change on agents');
    assert.equal(await one(`select risk_level::text || '/' || ai_act_risk_class::text from gov_repo.agents where agent_code = 'LEG-AG'`), 'critical/high');
    assert.ok(Number(beforeCounts.l14_fact_states) >= 2 && Number(beforeCounts.l14_authorization_decisions) >= 6, JSON.stringify(beforeCounts));
  });

  await t.test('O73 / O75: exact widened vocabularies (23 permissions, 17 subjects, 68 reason codes, 11 command kinds)', async () => {
    for (const conname of ['l14_authority_policy_rules_permission_check', 'l14_authorization_decision_rules_permission_check']) {
      const values = await vocabulary(conname);
      assert.equal(values.length, 23, conname);
      assert.deepEqual(values, sorted([...L14_PERMISSIONS, ...L15_PERMISSIONS]), conname);
    }
    for (const conname of ['l14_authorization_decisions_subject_kind_check', 'l14_proposals_subject_kind_check',
      'l14_governance_decisions_subject_kind_check', 'l14_command_results_subject_kind_check']) {
      const values = await vocabulary(conname);
      assert.equal(values.length, 17, conname);
      assert.deepEqual(values, sorted([...M16_SUBJECTS, ...L15_SUBJECTS]), conname);
      assert.ok(!values.includes('RISK_SIGNAL') && !values.includes('RISK_HYPOTHESIS'), conname);
    }
    const reasons = await vocabulary('l14_governance_decisions_reason_code_check');
    assert.deepEqual(reasons, sorted([...reasonCodes(M16_SUBJECTS), ...reasonCodes(L15_SUBJECTS)]));
    assert.equal(reasons.filter(r => L15_SUBJECTS.some(s => r.startsWith(`${s}_`))).length, 24);
    assert.equal(reasons.length, 68);
    const commands = await vocabulary('l14_command_results_command_kind_check');
    assert.deepEqual(commands, sorted([...M16_COMMANDS, ...L15_COMMANDS]));
    assert.deepEqual(commands.filter(x => !M16_COMMANDS.includes(x)), sorted(L15_COMMANDS));
    // The reason-code rule itself is untouched (one closed code per subject x outcome; no free text).
    assert.equal(beforeDefs['l14_governance_decisions.l14_governance_decisions_reason_check'],
      (await constraintDefs())['l14_governance_decisions.l14_governance_decisions_reason_check']);
  });

  await t.test('O74 / O76 / O01 / O02 / O07: only the amendment surfaces changed; frozen M16 / canonical vocabularies byte-identical', async () => {
    const after = await constraintDefs();
    const changed = Object.keys(beforeDefs).filter(key => after[key] !== beforeDefs[key]).sort();
    assert.deepEqual(changed, [...WIDENED].sort());
    assert.deepEqual(Object.keys(after).filter(key => !(key in beforeDefs)).sort(), [
      'l14_authority_policy_rules.l14_authority_policy_rules_l15_registry_scope_check',
      'l14_authorization_decision_rules.l14_authorization_decision_rules_l15_no_bootstrap_check',
      'l14_authorization_decisions.l14_authorization_decisions_l15_registry_target_check',
      'l14_authorization_decisions.l14_authorization_decisions_l15_risk_target_check',
      'l14_authorization_decisions.l15_authorization_decisions_allow_guard',
    ]);
    // l14_fact_states / l14_registry_states / l14_support_links / every M16 typed table: byte-identical constraint definitions.
    for (const key of Object.keys(beforeDefs).filter(x => /^l14_(fact_states|registry_states|support_links|control_|policy_|responsibility_|business_context_|governance_party|domain)/.test(x))) {
      assert.equal(after[key], beforeDefs[key], key);
    }
    assert.deepEqual(await vocabulary('l14_fact_states_subject_kind_check'), sorted(['RESPONSIBILITY_ASSIGNMENT', 'BUSINESS_CONTEXT_ASSIGNMENT',
      'POLICY_APPLICABILITY', 'CONTROL_APPLICABILITY', 'CONTROL_ASSESSMENT']));
    assert.deepEqual(await vocabulary('canonical_objects_kind_check'), sorted(['AGENT', 'AGENT_VERSION', 'MODEL', 'TOOL', 'MCP_SERVER', 'API',
      'PROMPT', 'KNOWLEDGE_BASE', 'DATA_ASSET', 'DATA_ELEMENT', 'SKILL']));
    assert.equal((await vocabulary('canonical_relationships_type_check')).length, 12);
    assert.ok(!(await vocabulary('canonical_relationships_type_check')).some(x => /RISK|MITIGATES/.test(x)));
    for (const conname of ['l14_authority_policy_rules_requested_action_check', 'l14_authority_policy_rules_source_class_check',
      'l14_authority_policy_rules_source_disposition_check', 'l14_authority_policy_rules_scope_tag_check']) {
      assert.equal(after[`l14_authority_policy_rules.${conname}`], beforeDefs[`l14_authority_policy_rules.${conname}`], conname);
    }
    assert.deepEqual(await vocabulary('l14_authority_policy_rules_requested_action_check'), sorted(['ADMIT', 'VALIDATE', 'REJECT', 'DEFER', 'REVOKE']));
    // WAIVED is still not a CONTROL_ASSESSMENT outcome.
    assert.equal(await one(`select count(*) from pg_constraint where connamespace = 'gov_repo'::regnamespace and pg_get_constraintdef(oid) ~ 'WAIVED'`), '0');
    // F2: no trigger, no relationship_state_id uniqueness; the migration text has no canonical_relationships DDL / DML.
    const text = migrationSource(m17S0AuthorityExtensionMigration).replace(/--[^\n]*/g, '');
    assert.doesNotMatch(text, /(ALTER|CREATE|DROP|INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+(TABLE\s+)?(gov_repo\.)?canonical_relationships/i);
    assert.doesNotMatch(text, /UNIQUE\s*(INDEX[^;]*)?\([^)]*relationship_state_id/i);
    assert.equal(await one(`select count(*) from pg_trigger where tgrelid = 'gov_repo.canonical_relationships'::regclass and not tgisinternal`), '0');
    // No L15 bootstrap routine; no L15 store in S0; the bootstrap basis CHECK is unchanged.
    assert.equal(await one(`select count(*) from pg_proc where proname ~* 'l15.*bootstrap|bootstrap.*l15'`), '0');
    assert.equal(await one(`select count(*) from pg_class where relnamespace = 'gov_repo'::regnamespace and relname like 'l15\\_%'`), '0');
    assert.equal(after['l14_authorization_decisions.l14_authorization_decisions_bootstrap_subject_check'],
      beforeDefs['l14_authorization_decisions.l14_authorization_decisions_bootstrap_subject_check']);
  });

  await t.test('existing L14 behaviour is unchanged after the widening (VALIDATE / DENY / REJECT on the M16 regression fixture)', async () => {
    const applies2 = await k.applicability(ctx, 'post', k.cak.objectTarget('DATA_ASSET', ctx.objects.byKind.DATA_ASSET));
    const ok = await k.assess(ctx, 'post-assess', applies2.stateId, { outcome: 'SATISFIED' });
    assert.equal(ok.decided.outcome, 'VALIDATED');
    assert.equal(await k.outcome(ctx.org, applies2.stateId), 'SATISFIED');
    const proposal = k.validateProposal(applies2.stateId, 'PARTIALLY_SATISFIED', inDays(5));
    const submitted = await k.submit(ctx, ctx.member, 'post-deny-submit', proposal);
    const deny = await k.decide(ctx, ctx.asapplicability, 'post-deny', submitted, proposal);
    assert.equal(deny.outcome, 'DENIED'); assert.equal(deny.deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
    const replay = await k.decide(ctx, ctx.asapplicability, 'post-deny', submitted, proposal);
    assert.equal(replay.replay, true); assert.equal(replay.authorization_decision_id, deny.authorization_decision_id);
    // An L14 decision never snapshots an L15 permission.
    assert.equal(await one(`select count(*) from gov_repo.l14_authorization_decision_rules where permission like 'L15\\_%'`), '0');
  });

  // ---- Authority Policy successor carrying L15 rules (the ONLY way L15 authority enters an organisation).
  const role = async (code: string) => {
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','${code}','${code}','organisation',false)`);
    return id;
  };
  const riskRole = await role('M17_RISK_STEWARD');
  const selfRole = await role('M17_RISK_SELF_STEWARD');
  const steward = await c.mkUser(ctx.org, [riskRole]);
  const selfSteward = await c.mkUser(ctx.org, [selfRole]);
  const admin = await c.mkUser(ctx.org, [c.adminRole]);
  const l15Rules = (): L14AuthorityPolicyRule[] => [
    rule(riskRole, 'L15_RISK_SCENARIO_ADMIT', 'ADMIT'),
    ...(['VALIDATE', 'REJECT', 'DEFER', 'REVOKE'] as const).map(a => rule(riskRole, 'L15_RISK_SCENARIO_VALIDATE', a)),
    rule(riskRole, 'L15_RISK_METHODOLOGY_ADMIT', 'ADMIT'),
    rule(riskRole, 'L15_RISK_METHODOLOGY_VALIDATE', 'VALIDATE'),
    rule(riskRole, 'L15_GOVERNED_RISK_VALIDATE', 'VALIDATE', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT_VERSION' }),
    rule(riskRole, 'L15_GOVERNED_RISK_VALIDATE', 'REJECT'),
    rule(riskRole, 'L15_RISK_ASSESSMENT_VALIDATE', 'VALIDATE'),
    rule(riskRole, 'L15_RISK_TREATMENT_VALIDATE', 'VALIDATE'),
    rule(riskRole, 'L15_RISK_ACCEPTANCE_VALIDATE', 'VALIDATE'),
    rule(selfRole, 'L15_GOVERNED_RISK_VALIDATE', 'VALIDATE', { allowSelfValidation: true }),
  ];
  const head = async () => json(`select to_json(h) from gov_repo.l14_authority_policy_heads h where organisation_id = '${ctx.org}'`);
  async function successor(name: string, rules: readonly L14AuthorityPolicyRule[]) {
    const h = await head();
    const admitted = await exec(c.admitSql(ctx.ops, { commandId: `${ctx.label}-${name}-admit`, rules,
      expected: { authorityPolicyId: h.authority_policy_id, latestVersionId: h.latest_version_id } }));
    const proposal = c.proposalFor(admitted);
    const submitted = await exec(c.submitSql(ctx.member, { commandId: `${ctx.label}-${name}-submit`, proposal }));
    const decided = await exec(c.decideSql(ctx.ops, { commandId: `${ctx.label}-${name}-validate`, proposalId: submitted.proposal_id,
      proposal, expected: h.latest_state_id }));
    return { admitted, decided };
  }
  const evaluate = async (version: string, roles: readonly string[], permission: string, action: string, self = false,
    target = `'AGENT_VERSION', '${ctx.objects.byKind.AGENT_VERSION}'`) => json(`select to_json(e) from gov_repo.l14_evaluate_target_authority_rules_v1(
      '${ctx.org}', (select authority_policy_id from gov_repo.l14_authority_policies where organisation_id = '${ctx.org}'), '${version}',
      array[${roles.map(r => `'${r}'`).join(',')}]::uuid[], '${permission}', '${action}', ${self}, 'IMMEDIATE', ${target}) e`);
  const v1Version = (await head()).latest_version_id as string;

  await t.test('O55 / O54: with no L15 rule every L15 permission is NO_MATCHING_AUTHORITY_RULE, even for the wildcard legacy admin role', async () => {
    assert.match(await one(`select permissions::text from gov_repo.governance_roles where role_id = '${c.adminRole}'`), /\*/);
    for (const permission of L15_PERMISSIONS) {
      const action = permission.endsWith('_ADMIT') ? 'ADMIT' : 'VALIDATE';
      for (const roles of [[c.adminRole], [riskRole], [k.assessorRole, c.adminRole, riskRole]]) {
        const r = await evaluate(v1Version, roles, permission, action);
        assert.equal(r.deny_reason, 'NO_MATCHING_AUTHORITY_RULE', `${permission} ${roles}`);
      }
    }
  });

  await t.test('O76: the first-policy bootstrap rejects every L15 permission; nothing is written', async () => {
    const org = await c.newOrg();
    const boot = await c.mkUser(org, [c.adminRole]);
    for (const [i, permission] of L15_PERMISSIONS.entries()) {
      const rules = [rule(c.adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
        rule(c.adminRole, permission as L14AuthorityPolicyRule['permission'], permission.endsWith('_ADMIT') ? 'ADMIT' : 'VALIDATE')];
      await rejects(exec(c.admitSql(boot, { commandId: `boot-l15-${i}`, rules })), 'L14_INVALID_COMMAND', /RULE_L15_BOOTSTRAP_FORBIDDEN/);
    }
    const counts = await c.counts(org);
    assert.ok(Object.values(counts).every(n => Number(n) === 0), JSON.stringify(counts));
    // The bootstrap still works without L15 rules (unchanged M16 behaviour), and the bootstrap grant snapshot is L14-only.
    const first = await c.bootstrapPolicy(boot, 'boot-ok', [rule(c.adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT')]);
    assert.equal(first.validated.outcome, 'VALIDATED');
    assert.equal(await one(`select string_agg(distinct permission, ',' order by permission) from gov_repo.l14_authorization_decision_rules
      where organisation_id = '${org}' and permission_origin = 'SYSTEM_BOOTSTRAP'`), 'L14_AUTHORITY_POLICY_ADMIN,L14_AUTHORITY_POLICY_ADMIT');
    await assert.rejects(owner(`begin; insert into gov_repo.l14_authorization_decision_rules(organisation_id,authorization_decision_id,snapshot_ordinal,
        permission_origin,permission,requested_action,source_class,source_disposition,scope_tag,allow_self_validation,allow_future_dating,allow_backdating)
      select organisation_id, authorization_decision_id, 99, 'SYSTEM_BOOTSTRAP', 'L15_GOVERNED_RISK_VALIDATE', 'VALIDATE', 'LOCAL_HUMAN',
        'AUTHORITATIVE', 'ALL_ALLOWED_TARGETS', false, false, false
      from gov_repo.l14_authorization_decisions where organisation_id = '${org}' limit 1; rollback;`),
    /l14_authorization_decision_rules_l15_no_bootstrap_check|L15_PERMISSION_SUBJECT_MISMATCH/);
  });

  await t.test('O54: unknown / non-governance permissions, wrong action pairing and non-local L15 registry scope fail closed', async () => {
    const h = await head();
    const attempt = (name: string, extra: string) => exec(c.admitSql(ctx.ops, { commandId: `${ctx.label}-${name}`, rules: [],
      expected: { authorityPolicyId: h.authority_policy_id, latestVersionId: h.latest_version_id },
      fingerprint: 'f'.repeat(64), rawRules: `${extra}::jsonb` }));
    const raw = (permission: string, action: string, scope: Record<string, unknown> = {}) => `'${JSON.stringify([{ roleId: riskRole, permission,
      requestedAction: action, sourceClass: 'LOCAL_HUMAN', sourceDisposition: 'AUTHORITATIVE', scopeTag: 'ALL_ALLOWED_TARGETS',
      scopeCanonicalKind: null, scopeCanonicalObjectId: null, scopeRelationshipType: null, scopeRelationshipId: null,
      scopeRelationshipStateId: null, allowSelfValidation: false, allowFutureDating: false, allowBackdating: false, ...scope }])}'`;
    for (const permission of ['L15_RISK_SIGNAL_VALIDATE', 'L15_RISK_HYPOTHESIS_VALIDATE', 'L15_GOVERNED_RISK_ADMIT', 'L15_RISK_ADMIN', 'l15_governed_risk_validate']) {
      await rejects(attempt(`unknown-${permission}`, raw(permission, 'VALIDATE')), 'L14_INVALID_COMMAND', /RULE_VOCABULARY_UNKNOWN/);
    }
    await rejects(attempt('bad-action', raw('L15_GOVERNED_RISK_VALIDATE', 'ADMIT')), 'L14_INVALID_COMMAND', /RULE_PERMISSION_ACTION_INCOMPATIBLE/);
    await rejects(attempt('bad-action-2', raw('L15_RISK_SCENARIO_ADMIT', 'VALIDATE')), 'L14_INVALID_COMMAND', /RULE_PERMISSION_ACTION_INCOMPATIBLE/);
    await rejects(attempt('bad-scope', raw('L15_RISK_METHODOLOGY_VALIDATE', 'VALIDATE', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' })),
      'L14_INVALID_COMMAND', /RULE_REGISTRY_SCOPE_INVALID/);
    await rejects(attempt('bad-scope-2', raw('L15_RISK_SCENARIO_ADMIT', 'ADMIT', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' })),
      'L14_INVALID_COMMAND', /RULE_REGISTRY_SCOPE_INVALID/);
    // DB boundary independent of the RPC: an L15 rule can never be written into the bootstrap-admitted first version.
    await rejects(owner(`begin; insert into gov_repo.l14_authority_policy_rules(organisation_id,authority_policy_id,version_id,rule_ordinal,role_id,
        permission,requested_action,source_class,source_disposition,scope_tag,allow_self_validation,allow_future_dating,allow_backdating)
      select organisation_id, authority_policy_id, version_id, 900, '${riskRole}', 'L15_GOVERNED_RISK_VALIDATE', 'VALIDATE', 'LOCAL_HUMAN',
        'AUTHORITATIVE', 'ALL_ALLOWED_TARGETS', false, false, false
      from gov_repo.l14_authority_policy_versions where organisation_id = '${ctx.org}' and version_number = 1; rollback;`),
    'L14_INVALID_COMMAND', /RULE_L15_BOOTSTRAP_FORBIDDEN/);
    assert.equal((await head()).latest_version_id, h.latest_version_id, 'no successor was admitted');
  });

  const l15 = await successor('l15', [...k.rules(ctx.objects, ctx.rels), ...l15Rules()]);
  const l15Version = l15.admitted.version_id as string;

  await t.test('O78: one Authority Policy identity per organisation; L15 rules live in a normal successor of that same policy', async () => {
    assert.equal(l15.decided.outcome, 'VALIDATED');
    assert.equal(await one(`select count(*) from gov_repo.l14_authority_policies where organisation_id = '${ctx.org}'`), '1');
    assert.equal(await one(`select count(*) from (select organisation_id from gov_repo.l14_authority_policies group by 1 having count(*) > 1) s`), '0');
    assert.equal(await one(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'l14_authority_policies_one_per_organisation'`),
      'UNIQUE (organisation_id)');
    assert.equal(await one(`select count(*) from gov_repo.l14_authority_policy_rules where organisation_id = '${ctx.org}'
      and version_id = '${l15Version}' and permission like 'L15\\_%'`), String(l15Rules().length));
    assert.equal(await one(`select a.authority_basis from gov_repo.l14_authority_policy_versions v join gov_repo.l14_authorization_decisions a
      on a.organisation_id = v.organisation_id and a.authorization_decision_id = v.admission_authorization_decision_id
      where v.version_id = '${l15Version}'`), 'AUTHORITY_POLICY_VERSION');
  });

  await t.test('O54: the table itself refuses a non-local L15 registry rule even in a policy-admitted version', async () => {
    await assert.rejects(owner(`begin; insert into gov_repo.l14_authority_policy_rules(organisation_id,authority_policy_id,version_id,rule_ordinal,role_id,
        permission,requested_action,source_class,source_disposition,scope_tag,scope_canonical_kind,allow_self_validation,allow_future_dating,allow_backdating)
      values ('${ctx.org}', '${l15.admitted.authority_policy_id}', '${l15Version}', 900, '${riskRole}', 'L15_RISK_SCENARIO_VALIDATE', 'VALIDATE',
        'LOCAL_HUMAN', 'AUTHORITATIVE', 'CANONICAL_KIND', 'AGENT', false, false, false); rollback;`),
    /l14_authority_policy_rules_l15_registry_scope_check/);
  });

  await t.test('O53 / O56 / O54: L14 <-> L15 permission isolation, typed scope and self-validation on the effective policy', async () => {
    // L15 permission authorizes its own action / scope only.
    assert.equal((await evaluate(l15Version, [riskRole], 'L15_GOVERNED_RISK_VALIDATE', 'VALIDATE')).deny_reason, null);
    assert.equal((await evaluate(l15Version, [riskRole], 'L15_GOVERNED_RISK_VALIDATE', 'VALIDATE', false,
      `'AGENT', '${ctx.objects.byKind.AGENT}'`)).deny_reason, 'SCOPE_NOT_AUTHORIZED');
    assert.equal((await evaluate(l15Version, [riskRole], 'L15_GOVERNED_RISK_VALIDATE', 'DEFER')).deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
    assert.equal((await evaluate(l15Version, [riskRole], 'L15_GOVERNED_RISK_VALIDATE', 'VALIDATE', true)).deny_reason, 'SELF_VALIDATION_NOT_PERMITTED');
    assert.equal((await evaluate(l15Version, [selfRole], 'L15_GOVERNED_RISK_VALIDATE', 'VALIDATE', true)).deny_reason, null);
    // An L14 role (incl. the CONTROL_ASSESSMENT assessor and the wildcard admin) never holds an L15 permission ...
    for (const permission of L15_PERMISSIONS) {
      const action = permission.endsWith('_ADMIT') ? 'ADMIT' : 'VALIDATE';
      assert.equal((await evaluate(l15Version, [k.assessorRole, c.adminRole, k.cak.stewardRole], permission, action)).deny_reason,
        'NO_MATCHING_AUTHORITY_RULE', permission);
    }
    // ... and an L15 role never holds an L14 permission.
    for (const permission of L14_PERMISSIONS) {
      const action = permission.endsWith('_ADMIT') ? 'ADMIT' : 'VALIDATE';
      assert.equal((await evaluate(l15Version, [riskRole, selfRole], permission, action)).deny_reason, 'NO_MATCHING_AUTHORITY_RULE', permission);
    }
    // Unknown permission / action tags fail closed; an unknown temporal class raises.
    assert.equal((await evaluate(l15Version, [riskRole], 'L15_RISK_SIGNAL_VALIDATE', 'VALIDATE')).deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
    assert.equal((await evaluate(l15Version, [riskRole], 'L15_GOVERNED_RISK_VALIDATE', 'APPROVE')).deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
    await rejects(owner(`select gov_repo.l14_evaluate_authority_rules_v1('${ctx.org}', gen_random_uuid(), '${l15Version}', array['${riskRole}']::uuid[],
      'L15_RISK_SCENARIO_ADMIT', 'ADMIT', false, 'SOMETIME')`), 'L14_INVALID_COMMAND', /TEMPORAL_CLASS_INVALID/);
    // The closed DB mapping: exactly one L15 permission per L15 subject x action; null for every L14 / non-governance subject.
    const mapping = await json(`select json_object_agg(s || ':' || a, gov_repo.l15_governance_permission_v1(s, a)) from
      unnest(array[${[...M16_SUBJECTS, ...L15_SUBJECTS, 'RISK_SIGNAL', 'RISK_HYPOTHESIS', 'RISK'].map(x => `'${x}'`).join(',')}]) s
      cross join unnest(array['ADMIT','VALIDATE','REJECT','DEFER','REVOKE','APPROVE']) a`);
    for (const [key, permission] of Object.entries(mapping)) {
      const [subject, action] = key.split(':');
      if (!L15_SUBJECTS.includes(subject!) || action === 'APPROVE') assert.equal(permission, null, key);
      else if (action === 'ADMIT') assert.equal(permission, subject === 'RISK_SCENARIO_DEFINITION' ? 'L15_RISK_SCENARIO_ADMIT'
        : subject === 'RISK_METHODOLOGY' ? 'L15_RISK_METHODOLOGY_ADMIT' : null, key);
      else assert.ok(typeof permission === 'string' && permission.startsWith('L15_') && permission.endsWith('_VALIDATE'), key);
    }
  });

  // ---- Shared envelope: what an L15 decision can and cannot look like (owner-made rows inside transactions that never persist).
  const policyId = (await head()).authority_policy_id as string;
  const versionHash = await one(`select content_hash from gov_repo.l14_authority_policy_versions where version_id = '${l15Version}'`);
  const ruleOrdinal = async (permission: string, action: string) => one(`select rule_ordinal from gov_repo.l14_authority_policy_rules
    where version_id = '${l15Version}' and permission = '${permission}' and requested_action = '${action}' order by rule_ordinal limit 1`);
  interface Envelope {
    subject?: string; action?: string; actor?: Actor; basis?: 'policy' | 'bootstrap'; scope?: string; kind?: string | null;
    objectId?: string | null; expectation?: string; snapshot?: { permission: string; action: string } | null; reason?: string;
    command?: { kind: string; outcome: string; governance: boolean; proposal: boolean }; result?: 'ALLOW' | 'DENY';
    finish?: 'commit' | 'immediate-rollback'; pre?: string;
  }
  function envelopeSql(e: Envelope) {
    const subject = e.subject ?? 'GOVERNED_RISK', action = e.action ?? 'REJECT', actor = e.actor ?? steward;
    const P = randomUUID(), A = randomUUID(), G = randomUUID(), cmd = `m17-env-${randomUUID()}`;
    const command = e.command ?? { kind: 'DECIDE_PROPOSAL', outcome: action === 'REJECT' ? 'REJECTED' : 'DEFERRED', governance: true, proposal: true };
    const scope = e.scope ?? 'CANONICAL_OBJECT';
    const kind = e.kind === undefined ? (scope === 'CANONICAL_OBJECT' ? 'AGENT_VERSION' : null) : e.kind;
    const objectId = e.objectId === undefined ? (kind ? ctx.objects.byKind[kind as keyof typeof ctx.objects.byKind] ?? null : null) : e.objectId;
    const result = e.result ?? 'ALLOW';
    const bootstrap = e.basis === 'bootstrap';
    const past = { VALIDATE: 'VALIDATED', REJECT: 'REJECTED', DEFER: 'DEFERRED', REVOKE: 'REVOKED' } as Record<string, string>;
    return `begin;
      ${e.pre ?? ''}
      ${command.proposal ? `insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values ('${ctx.org}','${P}','${subject}','VALIDATE','LOCAL_HUMAN','${ctx.member.id}','NONE',now());` : ''}
      insert into gov_repo.l14_authorization_decisions(organisation_id,authorization_decision_id,command_id,command_fingerprint,actor_user_id,
        requested_action,subject_kind,scope_tag,source_class,proposal_id,is_self_validation,authority_basis,basis_authority_policy_id,basis_version_id,
        basis_content_hash,result,deny_reason,evaluated_at,target_canonical_kind,target_canonical_object_id,target_relationship_type,
        target_relationship_id,target_relationship_state_id,expectation_kind)
      values ('${ctx.org}','${A}','${cmd}',repeat('c',64),'${actor.id}','${action}','${subject}','${scope}','LOCAL_HUMAN',
        ${command.proposal ? `'${P}'` : 'null'},${command.proposal ? 'false' : 'null'},
        ${bootstrap ? `'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1', null, null, null` : `'AUTHORITY_POLICY_VERSION','${policyId}','${l15Version}','${versionHash}'`},
        '${result}',${result === 'ALLOW' ? 'null' : `'NO_MATCHING_AUTHORITY_RULE'`},now(),
        ${kind ? `'${kind}'` : 'null'},${objectId ? `'${objectId}'` : 'null'},
        ${scope === 'RELATIONSHIP_STATE' ? `'${ctx.rels.reads.relationshipType}','${ctx.rels.reads.relationshipId}','${ctx.rels.reads.relationshipStateId}'` : 'null,null,null'},
        '${e.expectation ?? (action === 'ADMIT' ? 'NOT_APPLICABLE' : 'EXPECTED_NONE')}');
      ${e.snapshot ? `insert into gov_repo.l14_authorization_decision_rules(organisation_id,authorization_decision_id,snapshot_ordinal,permission_origin,
          permission,requested_action,source_class,source_disposition,scope_tag,scope_canonical_kind,allow_self_validation,allow_future_dating,
          allow_backdating,basis_authority_policy_id,basis_version_id,basis_rule_ordinal)
        select '${ctx.org}','${A}',1,'AUTHORITY_POLICY_RULE',r.permission,r.requested_action,r.source_class,r.source_disposition,r.scope_tag,
          r.scope_canonical_kind,r.allow_self_validation,r.allow_future_dating,r.allow_backdating,'${policyId}','${l15Version}',r.rule_ordinal
        from gov_repo.l14_authority_policy_rules r where r.version_id = '${l15Version}' and r.permission = '${e.snapshot.permission}'
          and r.requested_action = '${e.snapshot.action}' order by r.rule_ordinal limit 1;` : ''}
      ${command.governance ? `insert into gov_repo.l14_governance_decisions(organisation_id,governance_decision_id,proposal_id,subject_kind,outcome,
          reason_code,authorization_decision_id,actor_user_id,support_status,decided_at)
        values ('${ctx.org}','${G}','${P}','${subject}','${action}','${e.reason ?? `${subject}_${past[action]}`}','${A}','${actor.id}','NONE',now());` : ''}
      insert into gov_repo.l14_command_results(organisation_id,command_id,command_kind,command_fingerprint,actor_user_id,outcome,
        authorization_decision_id,proposal_id,governance_decision_id,recorded_at,subject_kind)
      values ('${ctx.org}','${cmd}','${command.kind}',repeat('c',64),'${actor.id}','${command.outcome}','${A}',
        ${command.proposal ? `'${P}'` : 'null'},${command.governance ? `'${G}'` : 'null'},now(),'${subject}');
      ${e.finish === 'immediate-rollback' ? 'set constraints all immediate; rollback;' : 'commit;'}`;
  }
  const envelopeCount = () => one(`select count(*) from gov_repo.l14_authorization_decisions where subject_kind in (${L15_SUBJECTS.map(s => `'${s}'`).join(',')})`);
  const policyRule = async (permission: string, action: string) => { assert.notEqual(await ruleOrdinal(permission, action), ''); return { permission, action }; };

  await t.test('O73 / O75 / O76: the envelope admits each L15 subject only in its closed shape; RISK_SIGNAL / RISK_HYPOTHESIS never', async () => {
    // Positive controls (never persisted): a complete L15 REJECT / DEFER envelope resting on the exact mapped L15 rule.
    await owner(envelopeSql({ snapshot: await policyRule('L15_GOVERNED_RISK_VALIDATE', 'REJECT'), finish: 'immediate-rollback' }));
    await owner(envelopeSql({ subject: 'RISK_SCENARIO_DEFINITION', action: 'DEFER', scope: 'ALL_ALLOWED_TARGETS', kind: null,
      snapshot: await policyRule('L15_RISK_SCENARIO_VALIDATE', 'DEFER'), finish: 'immediate-rollback' }));
    await owner(envelopeSql({ subject: 'RISK_SCENARIO_DEFINITION', action: 'ADMIT', scope: 'ALL_ALLOWED_TARGETS', kind: null,
      snapshot: await policyRule('L15_RISK_SCENARIO_ADMIT', 'ADMIT'),
      command: { kind: 'ADMIT_RISK_SCENARIO_DEFINITION_VERSION', outcome: 'ADMITTED', governance: false, proposal: false }, finish: 'immediate-rollback' }));
    await owner(envelopeSql({ action: 'REJECT', scope: 'RELATIONSHIP_STATE', kind: null,
      snapshot: await policyRule('L15_GOVERNED_RISK_VALIDATE', 'REJECT'), finish: 'immediate-rollback' }));
    for (const store of ['RISK_SIGNAL', 'RISK_HYPOTHESIS', 'RISK', 'WAIVER']) {
      await assert.rejects(owner(envelopeSql({ subject: store, finish: 'immediate-rollback' })), /subject_kind_check/, store);
      await assert.rejects(owner(`insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values ('${ctx.org}',gen_random_uuid(),'${store}','VALIDATE','LOCAL_HUMAN','${ctx.member.id}','NONE',now())`), /l14_proposals_subject_kind_check/, store);
      await assert.rejects(owner(`insert into gov_repo.l14_fact_states(organisation_id,fact_state_id,subject_kind) values ('${ctx.org}',gen_random_uuid(),'${store}')`),
        /violates|null value/, store);
    }
    // L15 subjects never enter the M16 fact / registry envelopes.
    for (const subject of L15_SUBJECTS) {
      await assert.rejects(owner(`begin; insert into gov_repo.l14_fact_states(organisation_id,fact_state_id,subject_kind) values ('${ctx.org}',gen_random_uuid(),'${subject}'); rollback;`),
        /l14_fact_states_subject_kind_check|null value/, subject);
    }
    assert.match(await one(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'l14_registry_states_subject_kind_check'`),
      /^(?!.*RISK).*$/);
    // Free-form / mismatched reason codes, wrong command kinds, the deferred VALIDATED / REVOKED results, illegal targets.
    const snap = await policyRule('L15_GOVERNED_RISK_VALIDATE', 'REJECT');
    await assert.rejects(owner(envelopeSql({ snapshot: snap, reason: 'GOVERNED_RISK_ACCEPTED', finish: 'immediate-rollback' })), /l14_governance_decisions_reason(_code)?_check/);
    await assert.rejects(owner(envelopeSql({ snapshot: snap, reason: 'RISK_ASSESSMENT_REJECTED', finish: 'immediate-rollback' })), /l14_governance_decisions_reason_check/);
    await assert.rejects(owner(envelopeSql({ subject: 'GOVERNED_RISK', action: 'ADMIT', snapshot: null,
      command: { kind: 'ADMIT_RISK_SCENARIO_DEFINITION_VERSION', outcome: 'DENIED', governance: false, proposal: false }, result: 'DENY',
      finish: 'immediate-rollback' })), /l15_risk_target_check|command_subject_check/);
    await assert.rejects(owner(envelopeSql({ snapshot: snap, command: { kind: 'ADMIT_GOVERNED_RISK', outcome: 'ADMITTED', governance: false, proposal: false },
      finish: 'immediate-rollback' })), /command_kind_check/);
    await assert.rejects(owner(envelopeSql({ action: 'VALIDATE', snapshot: await policyRule('L15_GOVERNED_RISK_VALIDATE', 'VALIDATE'),
      command: { kind: 'DECIDE_PROPOSAL', outcome: 'VALIDATED', governance: true, proposal: true }, finish: 'immediate-rollback' })),
    /l14_command_results_shape_check/);
    await assert.rejects(owner(envelopeSql({ scope: 'ALL_ALLOWED_TARGETS', kind: null, snapshot: snap, finish: 'immediate-rollback' })), /l15_risk_target_check/);
    await assert.rejects(owner(envelopeSql({ kind: 'PROMPT', snapshot: snap, finish: 'immediate-rollback' })), /l15_risk_target_check/);
    await assert.rejects(owner(envelopeSql({ subject: 'RISK_METHODOLOGY', action: 'DEFER', kind: 'AGENT', snapshot: null, result: 'DENY',
      command: { kind: 'DECIDE_PROPOSAL', outcome: 'DENIED', governance: false, proposal: true }, finish: 'immediate-rollback' })), /l15_registry_target_check/);
    assert.equal(await envelopeCount(), '0');
  });

  await t.test('O53 / O90 / O55: an L15 ALLOW is impossible without the mapped effective-policy L15 rule and a verified ACTIVE human', async () => {
    // No rule snapshot at all (e.g. a technical caller "deciding" directly): rejected at commit.
    await rejects(owner(envelopeSql({ snapshot: null })), 'L14_INVALID_COMMAND', /L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    // An L14 permission (even a real rule of the effective policy) never authorizes an L15 subject.
    await rejects(owner(envelopeSql({ snapshot: { permission: 'L14_CONTROL_ASSESSMENT_VALIDATE', action: 'REJECT' } })),
      'L14_INVALID_COMMAND', /L15_PERMISSION_SUBJECT_MISMATCH/);
    // The wrong L15 permission (another subject's) or the wrong action never authorizes.
    await rejects(owner(envelopeSql({ snapshot: { permission: 'L15_RISK_ASSESSMENT_VALIDATE', action: 'VALIDATE' } })),
      'L14_INVALID_COMMAND', /L15_PERMISSION_SUBJECT_MISMATCH/);
    await rejects(owner(envelopeSql({ action: 'REJECT', snapshot: { permission: 'L15_GOVERNED_RISK_VALIDATE', action: 'VALIDATE' } })),
      'L14_INVALID_COMMAND', /L15_PERMISSION_SUBJECT_MISMATCH/);
    // An L14 subject never snapshots an L15 rule.
    await rejects(owner(envelopeSql({ subject: 'CONTROL_ASSESSMENT', snapshot: { permission: 'L15_GOVERNED_RISK_VALIDATE', action: 'REJECT' } })),
      'L14_INVALID_COMMAND', /L15_PERMISSION_SUBJECT_MISMATCH/);
    // The bootstrap basis never applies to an L15 subject (the unchanged M16 CHECK).
    await assert.rejects(owner(envelopeSql({ basis: 'bootstrap', snapshot: null, finish: 'immediate-rollback' })),
      /bootstrap_subject_check|basis_shape_check/);
    // A suspended / cross-tenant actor never decides, even with the exact rule (O57 at the DB boundary: an actor change
    // inside the committing transaction fails closed at commit).
    const snap = await policyRule('L15_GOVERNED_RISK_VALIDATE', 'REJECT');
    await rejects(owner(envelopeSql({ snapshot: snap, pre: `update gov_repo.governance_users set status = 'suspended' where user_id = '${steward.id}';` })),
      'L14_INVALID_COMMAND', /L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    await rejects(owner(envelopeSql({ snapshot: snap, pre: `update gov_repo.organisations set is_active = false where organisation_id = '${ctx.org}';` })),
      'L14_INVALID_COMMAND', /L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    const otherOrg = await c.newOrg();
    const outsider = await c.mkUser(otherOrg, [riskRole]);
    await rejects(owner(envelopeSql({ snapshot: snap, actor: outsider })), 'L14_INVALID_COMMAND', /L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    assert.equal(await one(`select status::text from gov_repo.governance_users where user_id = '${steward.id}'`), 'active');
    assert.equal(await envelopeCount(), '0');
  });

  await t.test('O90 / O58 / O59: service_role is a technical capability only — no envelope privilege, no L15 path, no forged principal', async () => {
    for (const table of ['l14_authorization_decisions', 'l14_authorization_decision_rules', 'l14_proposals', 'l14_governance_decisions',
      'l14_command_results', 'l14_authority_policy_rules']) {
      await assert.rejects(svc(`insert into gov_repo.${table} default values`), /permission denied/, table);
      await assert.rejects(svc(`select 1 from gov_repo.${table} limit 1`), /permission denied/, table);
    }
    for (const fn of ['gov_repo.l15_governance_permission_v1(text,text)', 'gov_repo.l15_decision_rule_isolation_guard_v1()',
      'gov_repo.l15_authorization_allow_guard_v1()', 'gov_repo.l15_authority_policy_rule_admission_basis_guard_v1()',
      'gov_repo.l14_parse_authority_policy_rules_v1(uuid,jsonb)', 'gov_repo.l14_evaluate_target_authority_rules_v1(uuid,uuid,uuid,uuid[],text,text,boolean,text,text,text)']) {
      for (const r of ['service_role', 'authenticated', 'anon']) {
        assert.equal(await one(`select has_function_privilege('${r}', '${fn}', 'EXECUTE')`), 'f', `${r} ${fn}`);
      }
    }
    await assert.rejects(svc(`select gov_repo.l15_governance_permission_v1('GOVERNED_RISK','VALIDATE')`), /permission denied/);
    // The only shared proposal RPC refuses an L15 subject even for a verified human (it is AUTHORITY_POLICY_VERSION-only).
    const proposal = { ...c.proposalFor(l15.admitted), subjectKind: 'GOVERNED_RISK' } as never;
    await assert.rejects(exec(c.submitSql(steward, { commandId: 'm17-l15-submit', proposal, fingerprint: 'e'.repeat(64) })), /GV0\d\d|L14_/);
    // service_role with a forged / non-human / inactive principal never reaches authorization (verified-principal gate).
    const ghost: Actor = { id: randomUUID(), org: ctx.org, epoch: steward.epoch };
    await assert.rejects(exec(c.decideSql(ghost, { commandId: 'm17-ghost', proposalId: l15.decided.proposal_id, proposal: c.proposalFor(l15.admitted),
      outcome: 'REVOKE', expected: null })), /GV00[1-5]|M16_ELIGIBILITY/);
    await assert.rejects(exec(c.decideSql(steward, { commandId: 'm17-cross', proposalId: l15.decided.proposal_id, proposal: c.proposalFor(l15.admitted),
      outcome: 'REVOKE', expected: null, session: { org: (await c.newOrg()) } })), /GV00[1-5]|M16_ELIGIBILITY/);
    assert.equal(await envelopeCount(), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id in ('m17-ghost','m17-cross','m17-l15-submit')`), '0');
  });

  await t.test('O89 / D-05: application roles hold no INSERT / UPDATE / DELETE / TRUNCATE on the legacy risk register; history unchanged', async () => {
    for (const table of ['risk_entries', 'risk_treatments']) {
      for (const r of ['service_role', 'authenticated', 'anon']) {
        for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
          assert.equal(await one(`select has_table_privilege('${r}', 'gov_repo.${table}', '${p}')`), 'f', `${r} ${p} ${table}`);
        }
        assert.equal(await one(`select has_any_column_privilege('${r}', 'gov_repo.${table}', 'INSERT, UPDATE')`), 'f');
      }
      await assert.rejects(svc(`update gov_repo.${table} set created_at = created_at`), /permission denied/);
      await assert.rejects(svc(`delete from gov_repo.${table}`), /permission denied/);
      await assert.rejects(svc(`truncate gov_repo.${table}`), /permission denied/);
      await assert.rejects(c.sql(`delete from gov_repo.${table}`, 'authenticated'), /permission denied/);
      await assert.rejects(c.sql(`delete from gov_repo.${table}`, 'anon'), /permission denied/);
      assert.ok(Number(lastLine(await svc(`select count(*) from gov_repo.${table}`))) >= 1, 'legacy consumers can still read (labeled)');
    }
    await assert.rejects(svc(`insert into gov_repo.risk_entries(risk_code,title,description,risk_category,risk_domain,likelihood,impact,owner_user_id,organisation_id)
      values ('LEG-2','x','x','operational','ai',1,1,'${ctx.member.id}','${ctx.org}')`), /permission denied/);
    // The ON DELETE CASCADE path from risk_entries cannot be reached by any application role.
    await assert.rejects(svc(`delete from gov_repo.risk_entries where risk_code = 'LEG-1'`), /permission denied/);
    assert.equal(await digest(LEGACY), beforeLegacy);
    // Negative control: a re-granted write privilege is detected by the same predicate the postflight uses.
    const regranted = await owner(`begin; grant insert on gov_repo.risk_entries to service_role;
      select has_table_privilege('service_role','gov_repo.risk_entries','INSERT'); rollback;`);
    assert.equal(lastLine(regranted), 't');
    assert.equal(await one(`select has_table_privilege('service_role','gov_repo.risk_entries','INSERT')`), 'f');
  });

  await t.test('O59 / O60 / O61 / O62 framework: the L15 ACL profile is clean and detects one rolled-back negative control per class', async () => {
    const clean = JSON.parse(lastLine(await owner(l15SecurityViolationsSql())));
    assert.deepEqual(clean, []);
    // The four S0 routines are owner-only SECURITY INVOKER with a pinned search_path (not part of the definer inventory).
    assert.equal(await one(`select count(*) from pg_proc where pronamespace = 'gov_repo'::regnamespace and proname like 'l15\\_%'
      and not prosecdef and proconfig = array['search_path=pg_catalog, pg_temp']`), '4');
    const probe = async (ddl: string) => JSON.parse(lastLine(await owner(`begin; ${ddl}; ${l15SecurityViolationsSql()} rollback;`))) as string[];
    const has = (violations: string[], prefix: RegExp) => assert.ok(violations.some(v => prefix.test(v)), `${prefix} not in ${JSON.stringify(violations)}`);
    const historyTable = `create table gov_repo.l15_probe_states(organisation_id uuid, id uuid primary key);
      revoke all on gov_repo.l15_probe_states from service_role`;
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      has(await probe(`${historyTable}; grant ${privilege} on gov_repo.l15_probe_states to service_role`), new RegExp(`^TABLE_PRIVILEGE service_role ${privilege} `));
    }
    has(await probe(`${historyTable}; grant select (id) on gov_repo.l15_probe_states to authenticated`), /^COLUMN_PRIVILEGE authenticated /);
    has(await probe(`${historyTable}; grant select on gov_repo.l15_probe_states to public`), /^PUBLIC_GRANT l15_probe_states/);
    has(await probe(`create sequence gov_repo.l15_probe_seq; revoke all on sequence gov_repo.l15_probe_seq from service_role;
      grant usage on sequence gov_repo.l15_probe_seq to anon`), /^SEQUENCE_PRIVILEGE anon USAGE /);
    // Inherited / default privileges (the broad 20260818013113 defaults grant service_role everything on new gov_repo tables).
    has(await probe(`create table gov_repo.l15_probe_defaults(id int)`), /^TABLE_PRIVILEGE service_role SELECT l15_probe_defaults/);
    has(await probe(`create function gov_repo.l15_probe_rpc() returns int language sql security definer set search_path = pg_catalog, pg_temp
      as 'select 1'; revoke all on function gov_repo.l15_probe_rpc() from public; grant execute on function gov_repo.l15_probe_rpc() to service_role`),
    /^DEFINER_NOT_INVENTORIED gov_repo\.l15_probe_rpc\(\)/);
    has(await probe(`create function gov_repo.l15_probe_rpc() returns int language sql as 'select 1';
      revoke all on function gov_repo.l15_probe_rpc() from public; grant execute on function gov_repo.l15_probe_rpc() to authenticated`),
    /^ROUTINE_EXECUTE authenticated gov_repo\.l15_probe_rpc\(\)/);
    has(await probe(`create function gov_repo.l15_probe_rpc() returns int language sql as 'select 1'`), /^ROUTINE_SEARCH_PATH gov_repo\.l15_probe_rpc\(\)/);
    has(await probe(historyTable), /^NO_IMMUTABILITY l15_probe_states/);
    has(await probe(`${historyTable}; create table gov_repo.l15_probe_child(id uuid references gov_repo.l15_probe_states(id) on delete cascade);
      revoke all on gov_repo.l15_probe_child from service_role`), /^CASCADE_FK /);
    has(await probe(`${historyTable}; create table gov_repo.l15_probe_sub() inherits (gov_repo.l15_probe_states);
      revoke all on gov_repo.l15_probe_sub from service_role`), /^INHERITANCE /);
    // A properly hardened probe history table passes (the checker is not trivially failing).
    assert.deepEqual(await probe(`${historyTable};
      create trigger p_immutable before update or delete on gov_repo.l15_probe_states for each row execute function gov_repo.l14_history_immutable_v1();
      create trigger p_no_truncate before truncate on gov_repo.l15_probe_states for each statement execute function gov_repo.l14_history_immutable_v1();
      alter table gov_repo.l15_probe_states enable always trigger p_immutable; alter table gov_repo.l15_probe_states enable always trigger p_no_truncate`), []);
    assert.equal(await one(`select count(*) from pg_class where relname like 'l15\\_probe%'`), '0');
    // The application SECURITY DEFINER surface is still exactly the 45 post-M16 routines (none created / replaced by S0).
    assert.equal(await one(`select count(*) from pg_proc p where p.prosecdef and p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
      and not exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
      and (has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))`), '45');
  });

  await t.test('immutability: the widened envelope history still refuses UPDATE / DELETE / TRUNCATE, even for the owner', async () => {
    for (const table of ['l14_authority_policy_rules', 'l14_authorization_decisions', 'l14_command_results']) {
      await assert.rejects(owner(`update gov_repo.${table} set organisation_id = organisation_id where organisation_id = '${ctx.org}'`), /L14_|immutable|GV0/i, table);
      await assert.rejects(owner(`truncate gov_repo.${table} cascade`), /L14_|immutable|GV0|cannot truncate/i, table);
    }
    void bootstrapSql;
  });
});
