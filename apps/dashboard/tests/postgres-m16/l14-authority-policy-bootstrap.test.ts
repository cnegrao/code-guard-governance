import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { authorityPolicyContentHash, admitAuthorityPolicyVersionFingerprint } from '@council/governance-review';
import * as fx from '../helpers/m16-governed-write-fixtures';
import { L14_TABLES, NONE, l14Cluster, lastLine, rule, type Actor } from '../helpers/m16-l14-fixtures';

/**
 * M16-S1A.1 — L14 Authority Policy first-policy bootstrap on real disposable PostgreSQL 17.
 * Fixture chain includes the broad 20260818013113 service_role default grants, the full
 * governance persistence chain, all S0 migrations, then the S1A.1 migration.
 */
test('M16 S1A.1 L14 Authority Policy bootstrap (disposable PG17)', { timeout: 900_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message));
  t.after(() => c.stop());
  const { owner, exec, rejects, counts, admitSql, submitSql, decideSql, adminRole, memberRole } = c;
  const policyRules = (extra: Parameters<typeof rule>[3] = {}) => [
    rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
    rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE', extra),
    rule(memberRole, 'L14_PARTY_VALIDATE', 'VALIDATE', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' }),
  ];
  const commandRow = (org: string, command: string) =>
    owner(`select count(*) from gov_repo.l14_command_results where organisation_id='${org}' and command_id=${fx.lit(command)}`);
  const zero = Object.fromEntries(L14_TABLES.map(table => [table, 0]));

  // ---------------------------------------------------------------------------------------
  const orgA = await c.newOrg();
  const adminA = await c.mkUser(orgA, [adminRole]);
  const memberA = await c.mkUser(orgA, [memberRole]);
  let admittedA: Record<string, any>;

  await t.test('first ADMIT: seeded system GOVERNANCE_ADMIN → ADMITTED (identity + v1 + rules + head; no decision/state)', async () => {
    const rules = policyRules();
    admittedA = await exec(admitSql(adminA, { commandId: 'a-admit-1', rules }));
    assert.equal(admittedA.replay, false);
    assert.equal(admittedA.outcome, 'ADMITTED');
    assert.equal(admittedA.authorization_result, 'ALLOW');
    assert.equal(admittedA.deny_reason, null);
    assert.equal(admittedA.governance_decision_id, null, 'ADMIT never manufactures a governance decision');
    assert.equal(admittedA.state_id, null, 'ADMIT never creates a VALIDATED state');
    const n = await counts(orgA);
    assert.deepEqual(n, { ...zero, l14_authority_policies: 1, l14_authority_policy_versions: 1, l14_authority_policy_rules: 3,
      l14_authorization_decisions: 1, l14_authorization_decision_roles: 1, l14_authorization_decision_rules: 1,
      l14_authority_policy_heads: 1, l14_command_results: 1 });
    const head = JSON.parse(lastLine(await owner(`select to_json(h) from gov_repo.l14_authority_policy_heads h where organisation_id='${orgA}'`)));
    assert.equal(head.latest_version_id, admittedA.version_id);
    assert.equal(head.latest_state_id, null);
    const version = JSON.parse(lastLine(await owner(`select to_json(v) from gov_repo.l14_authority_policy_versions v where organisation_id='${orgA}'`)));
    assert.equal(version.version_number, 1);
    assert.equal(version.predecessor_version_id, null);
    assert.equal(version.support_status, 'NONE');
    assert.equal(version.source_class, 'LOCAL_HUMAN');
    assert.equal(version.admission_authorization_decision_id, admittedA.authorization_decision_id);
  });

  await t.test('DB content hash: PostgreSQL recomputes it from the typed rule set; order-independent; equals the TS mirror', async () => {
    const rules = policyRules();
    assert.equal(admittedA.content_hash, authorityPolicyContentHash(rules), 'TS mirror equals the DB-authored hash');
    assert.equal(await owner(`select gov_repo.l14_stored_authority_policy_content_hash_v1('${orgA}','${admittedA.authority_policy_id}','${admittedA.version_id}')`),
      admittedA.content_hash, 'recomputation from the stored immutable rows matches');
    const orgR = await c.newOrg();
    const adminR = await c.mkUser(orgR, [adminRole]);
    const reversed = await exec(admitSql(adminR, { commandId: 'r-admit', rules: [...rules].reverse() }));
    assert.equal(reversed.content_hash, admittedA.content_hash, 'caller rule order never changes the content hash');
    const ordinals = await owner(`select string_agg(permission, ',' order by rule_ordinal) from gov_repo.l14_authority_policy_rules where organisation_id='${orgR}'`);
    assert.equal(ordinals, await owner(`select string_agg(permission, ',' order by rule_ordinal) from gov_repo.l14_authority_policy_rules where organisation_id='${orgA}'`),
      'DB assigns canonical ordinals regardless of caller order');
    const changed = await c.newOrg();
    const adminChanged = await c.mkUser(changed, [adminRole]);
    const different = await exec(admitSql(adminChanged, { commandId: 'x-admit', rules: policyRules({ allowSelfValidation: true }) }));
    assert.notEqual(different.content_hash, admittedA.content_hash, 'a single flag difference changes the hash');
  });

  await t.test('DB command fingerprint equals the TS mirror and binds actor/org/expectation/content/support', async () => {
    const stored = await owner(`select command_fingerprint from gov_repo.l14_command_results where organisation_id='${orgA}' and command_id='a-admit-1'`);
    assert.equal(stored, admittedA.command_fingerprint);
    const base = { organisationId: orgA, actorUserId: adminA.id, expected: null, sourceClass: 'LOCAL_HUMAN' as const, rules: policyRules(), support: NONE };
    assert.equal(admitAuthorityPolicyVersionFingerprint(base), stored);
    const variants = [
      { ...base, actorUserId: memberA.id }, { ...base, organisationId: randomUUID() },
      { ...base, expected: { authorityPolicyId: randomUUID(), latestVersionId: randomUUID() } },
      { ...base, rules: policyRules({ allowFutureDating: true }) },
      { ...base, support: { status: 'PRESENT' as const, evidenceIds: ['e'] } },
    ];
    for (const variant of variants) assert.notEqual(admitAuthorityPolicyVersionFingerprint(variant), stored);
  });

  await t.test('stable identity: exactly one Authority Policy per organisation, enforced by the database', async () => {
    await rejects(owner(`insert into gov_repo.l14_authority_policies(organisation_id,authority_policy_id,established_at)
      values('${orgA}','${randomUUID()}',now())`), '23505', /l14_authority_policies_one_per_organisation/);
  });

  await t.test('replay same/same returns the exact ORIGINAL result (recorded_at, ids) and writes nothing', async () => {
    const before = await counts(orgA);
    const again = await exec(admitSql(adminA, { commandId: 'a-admit-1', rules: policyRules() }));
    assert.equal(again.replay, true);
    assert.deepEqual({ ...again, replay: false }, admittedA, 'identical original durable result');
    assert.deepEqual(await counts(orgA), before);
  });

  await t.test('replay same/different → GV007 L14_REPLAY_CONFLICT with no new state', async () => {
    const before = await counts(orgA);
    await rejects(c.svc(admitSql(adminA, { commandId: 'a-admit-1', rules: policyRules({ allowBackdating: true }) })), 'GV007', /L14_REPLAY_CONFLICT/);
    assert.deepEqual(await counts(orgA), before);
  });

  await t.test('wrong caller fingerprint → GV008; command_id not consumed', async () => {
    const org = await c.newOrg();
    const admin = await c.mkUser(org, [adminRole]);
    await rejects(c.svc(admitSql(admin, { commandId: 'w-admit', rules: policyRules(), fingerprint: 'a'.repeat(64) })), 'GV008', /L14_FINGERPRINT_MISMATCH/);
    const tampered = admitAuthorityPolicyVersionFingerprint({ organisationId: org, actorUserId: admin.id, expected: null,
      sourceClass: 'LOCAL_HUMAN', rules: policyRules({ allowSelfValidation: true }), support: NONE });
    await rejects(c.svc(admitSql(admin, { commandId: 'w-admit', rules: policyRules(), fingerprint: tampered })), 'GV008');
    assert.deepEqual(await counts(org), zero, 'nothing written, command not consumed');
    const ok = await exec(admitSql(admin, { commandId: 'w-admit', rules: policyRules() }));
    assert.equal(ok.outcome, 'ADMITTED', 'the same command id is still available after a rejected fingerprint');
  });

  await t.test('second independent first ADMIT after identity exists (expected-none) → GV009, never a durable DENY', async () => {
    const before = await counts(orgA);
    await rejects(c.svc(admitSql(adminA, { commandId: 'a-admit-2', rules: policyRules() })), 'GV009', /L14_STALE_EXPECTATION/);
    await rejects(c.svc(admitSql(memberA, { commandId: 'a-admit-3', rules: policyRules() })), 'GV009');
    assert.deepEqual(await counts(orgA), before);
    assert.equal(await commandRow(orgA, 'a-admit-2'), '0');
  });

  await t.test('ordinary user → durable DENY BOOTSTRAP_ROLE_REQUIRED; exact DENY replay; role grant + SAME command stays DENY; NEW command admits', async () => {
    const org = await c.newOrg();
    const user = await c.mkUser(org, [memberRole]);
    const denied = await exec(admitSql(user, { commandId: 'd-admit-1', rules: policyRules() }));
    assert.equal(denied.outcome, 'DENIED');
    assert.equal(denied.authorization_result, 'DENY');
    assert.equal(denied.deny_reason, 'BOOTSTRAP_ROLE_REQUIRED');
    assert.deepEqual(await counts(org), { ...zero, l14_authorization_decisions: 1, l14_authorization_decision_roles: 1, l14_command_results: 1 },
      'DENY persists only its authorization decision (+ locked role snapshot) and command result');
    const snapshot = JSON.parse(lastLine(await owner(`select json_agg(r) from gov_repo.l14_authorization_decision_roles r where organisation_id='${org}'`)));
    assert.deepEqual(snapshot.map((r: any) => [r.role_id, r.role_code, r.is_system_role]), [[memberRole, 'L14_MEMBER', false]]);
    const replay = await exec(admitSql(user, { commandId: 'd-admit-1', rules: policyRules() }));
    assert.deepEqual({ ...replay, replay: false }, denied);
    assert.equal(replay.replay, true);
    await owner(`update gov_repo.governance_users set role_ids=array['${memberRole}','${adminRole}']::uuid[] where user_id='${user.id}'`);
    const stillDenied = await exec(admitSql(user, { commandId: 'd-admit-1', rules: policyRules() }));
    assert.equal(stillDenied.replay, true);
    assert.equal(stillDenied.outcome, 'DENIED', 'changed eligibility never re-evaluates the consumed attempt');
    assert.equal(stillDenied.recorded_at, denied.recorded_at);
    const allowed = await exec(admitSql(user, { commandId: 'd-admit-2', rules: policyRules() }));
    assert.equal(allowed.outcome, 'ADMITTED', 'a NEW command under the new eligibility is authorized (still expected-none)');
  });

  await t.test('seeded GOVERNANCE_ADMIN flipped to is_system_role=false → DENY', async () => {
    const org = await c.newOrg();
    const admin = await c.mkUser(org, [adminRole]);
    await owner(`update gov_repo.governance_roles set is_system_role=false where role_id='${adminRole}'`);
    try {
      const result = await exec(admitSql(admin, { commandId: 'f-admit', rules: policyRules() }));
      assert.equal(result.deny_reason, 'BOOTSTRAP_ROLE_REQUIRED');
      assert.equal(await owner(`select is_system_role from gov_repo.l14_authorization_decision_roles where organisation_id='${org}'`), 'f',
        'the snapshot records the actual locked persisted role basis');
    } finally {
      await owner(`update gov_repo.governance_roles set is_system_role=true where role_id='${adminRole}'`);
    }
  });

  await t.test('lookalike role codes with is_system_role=true → DENY (exact role_code match only)', async () => {
    for (const code of ['governance_admin', 'GOVERNANCE_ADMIN ', 'GOVERNANCE_ADMINISTRATOR', ' GOVERNANCE_ADMIN']) {
      const roleId = randomUUID();
      await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
        values('${roleId}',${fx.lit(code)},'Lookalike','system',true)`);
      const org = await c.newOrg();
      const user = await c.mkUser(org, [roleId]);
      const result = await exec(admitSql(user, { commandId: 'l-admit', rules: policyRules() }));
      assert.equal(result.deny_reason, 'BOOTSTRAP_ROLE_REQUIRED', `lookalike ${JSON.stringify(code)} must not bootstrap`);
    }
  });

  await t.test('base eligibility failures raise GV001/GV002/GV003 and never consume the command_id', async () => {
    const org = await c.newOrg();
    const admin = await c.mkUser(org, [adminRole]);
    const otherOrg = await c.newOrg();
    await rejects(c.svc(admitSql(admin, { commandId: 'e-1', rules: policyRules(), session: { org: otherOrg } })), 'GV003', /ACTOR_UNAVAILABLE_OR_NOT_MEMBER/);
    await rejects(c.svc(admitSql(admin, { commandId: 'e-1', rules: policyRules(), session: { epoch: `'${admin.epoch}'::timestamptz + interval '1 microsecond'` } })),
      'GV002', /CREDENTIAL_EPOCH_MISMATCH/);
    await rejects(c.svc(admitSql(admin, { commandId: 'e-1', rules: policyRules(),
      session: { iat: '(floor(extract(epoch from clock_timestamp()))::bigint - 32000)' } })), 'GV001', /SESSION_MAX_AGE_EXCEEDED/);
    await owner(`update gov_repo.governance_users set status='suspended' where user_id='${admin.id}'`);
    await rejects(c.svc(admitSql(admin, { commandId: 'e-1', rules: policyRules() })), 'GV003');
    await owner(`update gov_repo.governance_users set status='active' where user_id='${admin.id}'`);
    await owner(`update gov_repo.organisations set is_active=false where organisation_id='${org}'`);
    await rejects(c.svc(admitSql(admin, { commandId: 'e-1', rules: policyRules() })), 'GV003', /ORGANISATION_UNAVAILABLE/);
    await owner(`update gov_repo.organisations set is_active=true where organisation_id='${org}'`);
    assert.deepEqual(await counts(org), zero);
    assert.deepEqual(await counts(otherOrg), zero);
    assert.equal((await exec(admitSql(admin, { commandId: 'e-1', rules: policyRules() }))).outcome, 'ADMITTED');
  });

  await t.test('closed rule/command contract: unknown/illegal values fail closed with GV010 and write nothing', async () => {
    const org = await c.newOrg();
    const admin = await c.mkUser(org, [adminRole]);
    const foreignOrg = await c.newOrg();
    const foreign = fx.canonicalObjectKit(foreignOrg, 'l14-foreign', 'AGENT', { proposedIdentity: { agentCode: 'foreign' }, identity: 'foreign' });
    await owner(foreign.sql);
    const bad = (overrides: Record<string, unknown>) => JSON.stringify([{ ...rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'), ...overrides }]);
    const cases: Array<[string, string, RegExp]> = [
      ['unknown permission', bad({ permission: 'L14_EVERYTHING' }), /RULE_VOCABULARY_UNKNOWN/],
      ['legacy wildcard permission', bad({ permission: '*.*.*' }), /RULE_VOCABULARY_UNKNOWN/],
      ['unknown action', bad({ requestedAction: 'APPROVE' }), /RULE_VOCABULARY_UNKNOWN/],
      ['unknown scope tag', bad({ scopeTag: 'EVERYTHING' }), /RULE_VOCABULARY_UNKNOWN/],
      ['wildcard kind operand', bad({ permission: 'L14_PARTY_VALIDATE', requestedAction: 'VALIDATE', scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: '*' }), /RULE_VOCABULARY_UNKNOWN/],
      ['unknown source class', bad({ sourceClass: 'SCANNER' }), /RULE_VOCABULARY_UNKNOWN/],
      ['unknown disposition', bad({ sourceDisposition: 'MAYBE' }), /RULE_VOCABULARY_UNKNOWN/],
      ['authority policy rule with canonical scope', bad({ permission: 'L14_AUTHORITY_POLICY_ADMIN', requestedAction: 'VALIDATE', scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' }), /RULE_AUTHORITY_SCOPE_INVALID/],
      ['ADMIT permission with VALIDATE action', bad({ requestedAction: 'VALIDATE' }), /RULE_PERMISSION_ACTION_INCOMPATIBLE/],
      ['ADMIT rule granting self-validation', bad({ allowSelfValidation: true }), /RULE_ADMIT_FLAGS_INVALID/],
      ['scope operand shape', bad({ scopeCanonicalKind: 'AGENT' }), /RULE_SCOPE_OPERANDS_INVALID/],
      ['free-form scope JSON key', JSON.stringify([{ ...rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'), scopeExpression: '*' }]), /RULE_SHAPE_INVALID/],
      ['missing key', JSON.stringify([{ roleId: adminRole }]), /RULE_SHAPE_INVALID/],
      ['non-array transport', JSON.stringify({ roleId: adminRole }), /RULES_MALFORMED/],
      ['unresolved role', bad({ roleId: randomUUID() }), /RULE_ROLE_UNRESOLVED/],
      ['non-canonical role text', bad({ roleId: adminRole.toUpperCase() }), /RULE_ROLE_MALFORMED/],
      ['cross-tenant canonical object', bad({ permission: 'L14_PARTY_VALIDATE', requestedAction: 'VALIDATE', scopeTag: 'CANONICAL_OBJECT',
        scopeCanonicalKind: 'AGENT', scopeCanonicalObjectId: foreign.objectId }), /RULE_SCOPE_REFERENCE_UNRESOLVED/],
      ['unresolved relationship state', bad({ permission: 'L14_PARTY_VALIDATE', requestedAction: 'VALIDATE', scopeTag: 'RELATIONSHIP_STATE',
        scopeRelationshipId: 'canonical-relationship:none', scopeRelationshipStateId: 'state:none' }), /RULE_SCOPE_REFERENCE_UNRESOLVED/],
      ['duplicate rule', JSON.stringify([rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'), rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT')]), /RULE_DUPLICATE/],
    ];
    for (const [label, raw, detail] of cases) {
      await rejects(c.svc(admitSql(admin, { commandId: `bad-${label}`, rules: [], rawRules: `${fx.lit(raw)}::jsonb`, fingerprint: 'b'.repeat(64) })), 'GV010', detail);
    }
    await rejects(c.svc(admitSql(admin, { commandId: 'bad-source', rules: policyRules(), sourceClass: 'SOURCE_CONNECTION' })), 'GV010', /SOURCE_CLASS_NOT_EXECUTABLE/);
    await rejects(c.svc(admitSql(admin, { commandId: 'bad-seed', rules: policyRules(), sourceClass: 'SYSTEM_SEED' })), 'GV010', /SOURCE_CLASS_NOT_EXECUTABLE/);
    assert.deepEqual(await counts(org), zero);
  });

  await t.test('typed scope operands resolve within the tenant (CANONICAL_OBJECT FK + exact read-only RELATIONSHIP_STATE triple)', async () => {
    const org = await c.newOrg();
    const admin = await c.mkUser(org, [adminRole]);
    const agent = fx.canonicalObjectKit(org, 'l14-agent', 'AGENT', { proposedIdentity: { agentCode: 'l14-agent' }, identity: 'l14-agent' });
    const model = fx.canonicalObjectKit(org, 'l14-model', 'MODEL', { proposedIdentity: { modelReference: 'l14-model' }, identity: 'l14-model' });
    await owner(`${agent.sql}\n${model.sql}`);
    // Fixture-only insert of an existing relationship state; S1A never writes this table.
    await owner(`insert into gov_repo.canonical_relationships(relationship_id,organisation_id,relationship_state_id,relationship_type,
      source_canonical_object_id,source_kind,target_canonical_object_id,target_kind,valid_from,recorded_at,created_by_decision_id)
      values('rel:l14','${org}','rel:l14:state','USES_MODEL',${fx.lit(agent.objectId)},'AGENT',${fx.lit(model.objectId)},'MODEL',now(),now(),'decision-l14-agent')`);
    const relationshipsBefore = await owner(`select md5(string_agg(t::text, '|' order by relationship_id)) from gov_repo.canonical_relationships t`);
    const rules = [
      rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE'),
      rule(memberRole, 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE', { scopeTag: 'CANONICAL_OBJECT', scopeCanonicalKind: 'AGENT', scopeCanonicalObjectId: agent.objectId }),
      rule(memberRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'REVOKE', { scopeTag: 'RELATIONSHIP_STATE', scopeRelationshipId: 'rel:l14', scopeRelationshipStateId: 'rel:l14:state' }),
      rule(memberRole, 'L14_CONTROL_APPLICABILITY_VALIDATE', 'DEFER', { scopeTag: 'RELATIONSHIP_TYPE', scopeRelationshipType: 'USES_MODEL', sourceClass: 'SOURCE_CONNECTION', sourceDisposition: 'CONTRIBUTING' }),
    ];
    const result = await exec(admitSql(admin, { commandId: 'scope-admit', rules }));
    assert.equal(result.outcome, 'ADMITTED');
    assert.equal(await owner(`select count(*) from gov_repo.l14_authority_policy_rules where organisation_id='${org}'`), '4');
    assert.equal(await owner(`select md5(string_agg(t::text, '|' order by relationship_id)) from gov_repo.canonical_relationships t`), relationshipsBefore,
      'canonical_relationships unchanged (F2 untouched)');
  });

  await t.test('support NONE/PRESENT: exact tenant discovery_evidence ids only; malformed/cross-tenant rejected', async () => {
    const org = await c.newOrg();
    const admin = await c.mkUser(org, [adminRole]);
    const otherOrg = await c.newOrg();
    await c.evidence(org, 'ev-1');
    await c.evidence(org, 'ev-2');
    await c.evidence(otherOrg, 'ev-foreign');
    await rejects(c.svc(admitSql(admin, { commandId: 's-1', rules: policyRules(), support: { status: 'NONE', evidenceIds: ['ev-1'] }, fingerprint: 'c'.repeat(64) })), 'GV010', /SUPPORT_MALFORMED/);
    await rejects(c.svc(admitSql(admin, { commandId: 's-1', rules: policyRules(), support: { status: 'PRESENT', evidenceIds: [] }, fingerprint: 'c'.repeat(64) })), 'GV010', /SUPPORT_MALFORMED/);
    await rejects(c.svc(admitSql(admin, { commandId: 's-1', rules: policyRules(), support: { status: 'PRESENT', evidenceIds: ['ev-foreign'] } })), 'GV010', /SUPPORT_REFERENCE_UNRESOLVED/);
    await rejects(c.svc(admitSql(admin, { commandId: 's-1', rules: policyRules(), support: { status: 'PRESENT', evidenceIds: ['ev-missing'] } })), 'GV010', /SUPPORT_REFERENCE_UNRESOLVED/);
    assert.deepEqual(await counts(org), zero);
    const result = await exec(admitSql(admin, { commandId: 's-1', rules: policyRules(), support: { status: 'PRESENT', evidenceIds: ['ev-2', 'ev-1'] } }));
    assert.equal(result.outcome, 'ADMITTED');
    assert.equal(await owner(`select support_status from gov_repo.l14_authority_policy_versions where organisation_id='${org}'`), 'PRESENT');
    assert.equal(await owner(`select string_agg(evidence_id, ',' order by evidence_id) from gov_repo.l14_support_links
      where organisation_id='${org}' and owner_kind='AUTHORITY_POLICY_VERSION_ADMISSION' and version_id='${result.version_id}'`), 'ev-1,ev-2');
    assert.equal(await owner(`select count(*) from gov_repo.l14_support_links where organisation_id='${orgA}'`), '0', 'NONE means zero links');
  });

  await t.test('no legacy evidence target: the only support FK target is gov_repo.discovery_evidence', async () => {
    const targets = await owner(`select string_agg(distinct confrelid::regclass::text, ',' order by confrelid::regclass::text) from pg_constraint
      where conrelid='gov_repo.l14_support_links'::regclass and contype='f' and confrelid::regclass::text not like 'gov_repo.l14\\_%'`);
    assert.equal(targets, 'gov_repo.discovery_evidence');
    assert.equal(await owner(`select count(*) from pg_depend d join pg_class c on c.oid=d.refobjid
      where c.relname='evidence' and c.relnamespace='gov_repo'::regnamespace and d.objid in
        (select oid from pg_constraint where conrelid::regclass::text like 'gov_repo.l14\\_%')`), '0');
  });

  // ---------------------------------------------------------------------------------------
  let proposalA: Record<string, any>;
  const firstProposal = () => c.proposalFor(admittedA);

  await t.test('proposal: any active same-tenant member submits; no authority decision, no governance decision, no head change', async () => {
    const before = await counts(orgA);
    proposalA = await exec(submitSql(memberA, { commandId: 'a-submit-1', proposal: firstProposal() }));
    assert.equal(proposalA.outcome, 'SUBMITTED');
    assert.equal(proposalA.authorization_decision_id, null);
    assert.equal(proposalA.governance_decision_id, null);
    const after = await counts(orgA);
    assert.deepEqual(after, { ...before, l14_proposals: before.l14_proposals + 1,
      l14_authority_policy_version_proposals: before.l14_authority_policy_version_proposals + 1, l14_command_results: before.l14_command_results + 1 });
    assert.equal(await owner(`select latest_state_id is null from gov_repo.l14_authority_policy_heads where organisation_id='${orgA}'`), 't');
    const replay = await exec(submitSql(memberA, { commandId: 'a-submit-1', proposal: firstProposal() }));
    assert.deepEqual({ ...replay, replay: false }, proposalA, 'proposal replay returns the original');
    await c.evidence(orgA, 'ev-a');
    await rejects(c.svc(submitSql(memberA, { commandId: 'a-submit-1', proposal: firstProposal(), support: { status: 'PRESENT', evidenceIds: ['ev-a'] } })), 'GV007');
  });

  await t.test('proposal rejections: cross-tenant version/evidence, explicit bootstrap time, wrong fingerprint, non-executable kinds', async () => {
    const orgB = await c.newOrg();
    const memberB = await c.mkUser(orgB, [memberRole]);
    await c.evidence(orgB, 'ev-b');
    const before = await counts(orgA);
    await rejects(c.svc(submitSql(memberB, { commandId: 'x-1', proposal: firstProposal() })), 'GV010', /PINNED_VERSION_UNRESOLVED/);
    await rejects(c.svc(submitSql(memberA, { commandId: 'x-2', proposal: firstProposal(), support: { status: 'PRESENT', evidenceIds: ['ev-b'] } })), 'GV010', /SUPPORT_REFERENCE_UNRESOLVED/);
    for (const at of ['2030-01-01T00:00:00.000000Z', '2020-01-01T00:00:00.000000Z']) {
      await rejects(c.svc(submitSql(memberA, { commandId: 'x-3', proposal: c.proposalFor(admittedA, at) })), 'GV010', /BOOTSTRAP_EFFECTIVE_FROM_NOT_PERMITTED/);
    }
    await rejects(c.svc(submitSql(memberA, { commandId: 'x-4', proposal: firstProposal(), fingerprint: 'd'.repeat(64) })), 'GV008');
    await rejects(c.svc(submitSql(memberA, { commandId: 'x-5', proposal: { ...firstProposal(), subjectKind: 'GOVERNANCE_PARTY' } })), 'GV010', /SUBJECT_KIND_NOT_EXECUTABLE/);
    await rejects(c.svc(submitSql(memberA, { commandId: 'x-6', proposal: { ...firstProposal(), sourceClass: 'SOURCE_CONNECTION' } })), 'GV010', /SOURCE_CLASS_NOT_EXECUTABLE/);
    await rejects(c.svc(submitSql(memberA, { commandId: 'x-7', proposal: { ...firstProposal(), intent: 'REVOKE', targetStateId: randomUUID() } })), 'GV010', /TARGET_STATE_UNRESOLVED/);
    await rejects(c.svc(submitSql(memberA, { commandId: 'x-8', proposal: { ...firstProposal(), contentHash: 'f'.repeat(64) } })), 'GV010', /PINNED_VERSION_UNRESOLVED/);
    assert.deepEqual(await counts(orgA), before);
    assert.deepEqual(await counts(orgB), Object.fromEntries(L14_TABLES.map(table => [table, 0])));
  });

  // ---------------------------------------------------------------------------------------
  await t.test('first VALIDATE: non-admin → durable DENY; admin REJECT/DEFER → BOOTSTRAP_ACTION_NOT_PERMITTED; none creates a decision/state', async () => {
    const before = await counts(orgA);
    const denied = await exec(decideSql(memberA, { commandId: 'a-decide-member', proposalId: proposalA.proposal_id, proposal: firstProposal() }));
    assert.equal(denied.outcome, 'DENIED');
    assert.equal(denied.deny_reason, 'BOOTSTRAP_ROLE_REQUIRED');
    for (const outcome of ['REJECT', 'DEFER'] as const) {
      const result = await exec(decideSql(adminA, { commandId: `a-decide-${outcome}`, proposalId: proposalA.proposal_id, proposal: firstProposal(), outcome }));
      assert.equal(result.deny_reason, 'BOOTSTRAP_ACTION_NOT_PERMITTED', outcome);
    }
    const after = await counts(orgA);
    assert.equal(after.l14_governance_decisions, before.l14_governance_decisions);
    assert.equal(after.l14_authority_policy_states, 0);
    assert.equal(after.l14_authorization_decisions, before.l14_authorization_decisions + 3);
    const replay = await exec(decideSql(memberA, { commandId: 'a-decide-member', proposalId: proposalA.proposal_id, proposal: firstProposal() }));
    assert.deepEqual({ ...replay, replay: false }, denied);
  });

  await t.test('explicit past/future effective_from under bootstrap → durable DENY TEMPORAL_ACTION_NOT_AUTHORIZED', async () => {
    for (const [label, at] of [['future', '2031-01-01T00:00:00.000000Z'], ['past', '2021-01-01T00:00:00.000000Z']]) {
      // Fixture-injected proposal (the submission RPC itself refuses explicit time for v1).
      const proposalId = randomUUID();
      await owner(`insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values('${orgA}','${proposalId}','AUTHORITY_POLICY_VERSION','VALIDATE','LOCAL_HUMAN','${adminA.id}','NONE',now());
        insert into gov_repo.l14_authority_policy_version_proposals(organisation_id,proposal_id,intent,authority_policy_id,version_id,content_hash,requested_effective_from)
        values('${orgA}','${proposalId}','VALIDATE','${admittedA.authority_policy_id}','${admittedA.version_id}','${admittedA.content_hash}','${at}')`);
      const result = await exec(decideSql(adminA, { commandId: `a-decide-${label}`, proposalId, proposal: c.proposalFor(admittedA, at) }));
      assert.equal(result.outcome, 'DENIED');
      assert.equal(result.deny_reason, 'TEMPORAL_ACTION_NOT_AUTHORIZED');
    }
    assert.equal((await counts(orgA)).l14_authority_policy_states, 0);
  });

  let validatedA: Record<string, any>;
  await t.test('first VALIDATE: system GOVERNANCE_ADMIN validates the exact first version → decision + first VALIDATED state + head', async () => {
    await rejects(c.svc(decideSql(adminA, { commandId: 'a-validate', proposalId: proposalA.proposal_id, proposal: firstProposal(), fingerprint: 'e'.repeat(64) })), 'GV008');
    validatedA = await exec(decideSql(adminA, { commandId: 'a-validate', proposalId: proposalA.proposal_id, proposal: firstProposal() }));
    assert.equal(validatedA.outcome, 'VALIDATED');
    assert.equal(validatedA.authorization_result, 'ALLOW');
    assert.ok(validatedA.governance_decision_id && validatedA.state_id);
    assert.equal(validatedA.effective_from, validatedA.recorded_at, 'DB-authored immediate effective instant');
    const state = JSON.parse(lastLine(await owner(`select to_json(s) from gov_repo.l14_authority_policy_states s where organisation_id='${orgA}'`)));
    assert.equal(state.state_kind, 'VALIDATED');
    assert.equal(state.predecessor_state_id, null);
    assert.equal(state.revokes_state_id, null);
    assert.equal(state.trust_state, 'VALIDATED');
    assert.equal(state.authority_basis, 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1');
    assert.equal(state.version_id, admittedA.version_id);
    assert.equal(state.content_hash, admittedA.content_hash);
    assert.equal(await owner(`select latest_state_id from gov_repo.l14_authority_policy_heads where organisation_id='${orgA}'`), validatedA.state_id);
    const decision = JSON.parse(lastLine(await owner(`select to_json(d) from gov_repo.l14_governance_decisions d where organisation_id='${orgA}'`)));
    assert.equal(decision.outcome, 'VALIDATE');
    assert.equal(decision.reason_code, 'AUTHORITY_POLICY_VALIDATED');
    assert.equal(decision.proposal_id, proposalA.proposal_id);
    assert.equal(decision.authorization_decision_id, validatedA.authorization_decision_id);
    assert.equal(state.governance_decision_id, decision.governance_decision_id);
    assert.equal((await counts(orgA)).l14_authority_policy_states, 1);
  });

  await t.test('authorization snapshot: actor, org, action, subject, scope, basis, locked role basis, permission, proposal, command lineage', async () => {
    const authz = JSON.parse(lastLine(await owner(`select to_json(a) from gov_repo.l14_authorization_decisions a
      where organisation_id='${orgA}' and authorization_decision_id='${validatedA.authorization_decision_id}'`)));
    assert.equal(authz.actor_user_id, adminA.id);
    assert.equal(authz.requested_action, 'VALIDATE');
    assert.equal(authz.subject_kind, 'AUTHORITY_POLICY_VERSION');
    assert.equal(authz.scope_tag, 'ALL_ALLOWED_TARGETS');
    assert.equal(authz.authority_basis, 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1');
    assert.equal(authz.basis_version_id, null);
    assert.equal(authz.subject_version_id, admittedA.version_id);
    assert.equal(authz.proposal_id, proposalA.proposal_id);
    assert.equal(authz.command_id, 'a-validate');
    assert.equal(authz.command_fingerprint, validatedA.command_fingerprint);
    assert.equal(authz.is_self_validation, false, 'member submitted, admin validated');
    const roles = JSON.parse(lastLine(await owner(`select json_agg(r) from gov_repo.l14_authorization_decision_roles r where authorization_decision_id='${authz.authorization_decision_id}'`)));
    assert.deepEqual(roles.map((r: any) => [r.role_code, r.is_system_role]), [['GOVERNANCE_ADMIN', true]]);
    const grants = JSON.parse(lastLine(await owner(`select json_agg(r) from gov_repo.l14_authorization_decision_rules r where authorization_decision_id='${authz.authorization_decision_id}'`)));
    assert.deepEqual(grants.map((r: any) => [r.permission_origin, r.permission, r.requested_action, r.scope_tag]),
      [['SYSTEM_BOOTSTRAP', 'L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE', 'ALL_ALLOWED_TARGETS']]);
    assert.equal(await owner(`select count(*) from gov_repo.l14_authorization_decisions where authorization_decision_id='${authz.authorization_decision_id}'
      and (actor_user_id::text like '%@%')`), '0');
  });

  await t.test('first VALIDATE replay: exact original decision/state/times; changed replay → GV007', async () => {
    const before = await counts(orgA);
    const replay = await exec(decideSql(adminA, { commandId: 'a-validate', proposalId: proposalA.proposal_id, proposal: firstProposal() }));
    assert.equal(replay.replay, true);
    assert.deepEqual({ ...replay, replay: false }, validatedA);
    await rejects(c.svc(decideSql(adminA, { commandId: 'a-validate', proposalId: proposalA.proposal_id, proposal: firstProposal(), outcome: 'DEFER' })), 'GV007');
    assert.deepEqual(await counts(orgA), before);
  });

  await t.test('bootstrap self-validation (submitter = validator) is permitted only for the exact first version', async () => {
    const org = await c.newOrg();
    const admin = await c.mkUser(org, [adminRole]);
    const { validated } = await c.bootstrapPolicy(admin, 'self', policyRules());
    assert.equal(validated.outcome, 'VALIDATED');
    assert.equal(await owner(`select is_self_validation from gov_repo.l14_authorization_decisions where authorization_decision_id='${validated.authorization_decision_id}'`), 't');
  });

  // S1A.2 supersedes the S1A.1 "successor lifecycle not available" placeholders: non-first
  // commands are now authorized by the effective LOCAL policy. Bootstrap still never reopens.
  await t.test('bootstrap never reopens: after the first policy every command is decided by the local policy, never the bootstrap', async () => {
    const before = await counts(orgA);
    await rejects(c.svc(admitSql(adminA, { commandId: 'n-1', rules: policyRules() })), 'GV009');
    const successor = await exec(admitSql(adminA, { commandId: 'n-2', rules: policyRules({ allowFutureDating: true }),
      expected: { authorityPolicyId: admittedA.authority_policy_id, latestVersionId: admittedA.version_id } }));
    assert.equal(successor.outcome, 'ADMITTED');
    const second = await exec(submitSql(memberA, { commandId: 'n-3', proposal: firstProposal() }));
    await rejects(c.svc(decideSql(adminA, { commandId: 'n-4', proposalId: second.proposal_id, proposal: firstProposal() })), 'GV009', /AUTHORITY_POLICY_STATE_EXISTS/);
    await rejects(c.svc(decideSql(adminA, { commandId: 'n-5', proposalId: second.proposal_id, proposal: firstProposal(), expected: validatedA.state_id })), 'GV010', /VERSION_ALREADY_VALIDATED/);
    const rejected = await exec(decideSql(adminA, { commandId: 'n-6', proposalId: second.proposal_id, proposal: firstProposal(), outcome: 'REJECT', expected: validatedA.state_id }));
    assert.equal(rejected.deny_reason, 'NO_MATCHING_AUTHORITY_RULE', 'the local policy grants no REJECT; the bootstrap is not consulted');
    await rejects(c.svc(decideSql(adminA, { commandId: 'n-7', proposalId: proposalA.proposal_id, proposal: firstProposal() })), 'GV010', /PROPOSAL_TERMINAL/);
    const bases = JSON.parse(lastLine(await owner(`select json_agg(authority_basis || ':' || coalesce(basis_version_id::text, '-') order by evaluated_at)
      from gov_repo.l14_authorization_decisions where organisation_id='${orgA}' and command_id in ('n-2','n-6')`)));
    assert.deepEqual(bases, [`AUTHORITY_POLICY_VERSION:${admittedA.version_id}`, `AUTHORITY_POLICY_VERSION:${admittedA.version_id}`]);
    assert.equal(await owner(`select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${orgA}'
      and authority_basis='SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1' and evaluated_at > '${validatedA.recorded_at}'::timestamptz`), '0');
    const after = await counts(orgA);
    assert.equal(after.l14_authority_policy_states, before.l14_authority_policy_states, 'no state written');
    assert.equal(after.l14_governance_decisions, before.l14_governance_decisions, 'no governance decision written');
  });

  await t.test('bitemporal resolver: first state by effective + recorded coordinates; no earlier visibility; no fabrication', async () => {
    const resolve = (at: string, cutoff: string) => owner(`select coalesce(json_agg(r), '[]') from gov_repo.l14_effective_authority_policy_version_v1('${orgA}', ${at}, ${cutoff}) r`)
      .then(out => JSON.parse(lastLine(out)) as any[]);
    const recorded = `'${validatedA.recorded_at}'::timestamptz`;
    const now = await resolve('clock_timestamp()', 'clock_timestamp()');
    assert.equal(now.length, 1);
    assert.equal(now[0].version_id, admittedA.version_id);
    assert.equal(now[0].state_id, validatedA.state_id);
    assert.equal((await resolve(recorded, recorded)).length, 1, 'effective exactly at its own recorded instant');
    assert.equal((await resolve(`${recorded} - interval '1 microsecond'`, 'clock_timestamp()')).length, 0, 'not effective before effective_from');
    assert.equal((await resolve('clock_timestamp()', `${recorded} - interval '1 microsecond'`)).length, 0, 'earlier knowledge cutoff cannot see the later validation');
    const future = await resolve(`clock_timestamp() + interval '10 years'`, `clock_timestamp() + interval '10 years'`);
    assert.equal(future.length, 1, 'a future cutoff fabricates no state');
    assert.equal(future[0].state_id, validatedA.state_id);
    const empty = await c.newOrg();
    assert.equal((await owner(`select count(*) from gov_repo.l14_effective_authority_policy_version_v1('${empty}', clock_timestamp(), clock_timestamp())`)), '0');
  });

  await t.test('immutability: UPDATE/DELETE/TRUNCATE on every history table raises, even as owner; head identity fixed', async () => {
    const history = L14_TABLES.filter(table => table !== 'l14_authority_policy_heads');
    for (const table of history) {
      assert.notEqual(await owner(`select count(*) from gov_repo.${table}`), '0', `${table} has rows to protect`);
      await rejects(owner(`update gov_repo.${table} set organisation_id=organisation_id`), '55000', /L14_HISTORY_IMMUTABLE/);
      await rejects(owner(`delete from gov_repo.${table}`), '55000', /L14_HISTORY_IMMUTABLE/);
      await rejects(owner(`truncate gov_repo.${table} cascade`), '55000', /L14_HISTORY_IMMUTABLE/);
    }
    await rejects(owner(`delete from gov_repo.l14_authority_policy_heads where organisation_id='${orgA}'`), '55000');
    await rejects(owner(`update gov_repo.l14_authority_policy_heads set latest_state_id=null where organisation_id='${orgA}'`), '55000');
    await rejects(owner(`update gov_repo.l14_authority_policy_heads set authority_policy_id='${randomUUID()}' where organisation_id='${orgA}'`), '55000');
    await rejects(owner(`truncate gov_repo.l14_authority_policy_heads`), '55000');
    await rejects(owner(`delete from gov_repo.governance_roles where role_id='${memberRole}'`), '23503', /l14_authority_policy_rules_role_fkey|l14_authorization_decision/);
    assert.equal((await counts(orgA)).l14_authority_policy_states, 1);
  });
});
