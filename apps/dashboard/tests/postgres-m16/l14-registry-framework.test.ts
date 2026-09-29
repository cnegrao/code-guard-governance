import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { supportParts } from '@council/governance-review';
import { l14RegistryFrameworkMigration } from '../helpers/disposable-m16-postgres';
import * as fx from '../helpers/m16-governed-write-fixtures';
import { L14_TABLES, NONE, l14Cluster, lastLine, rule, type Actor } from '../helpers/m16-l14-fixtures';
import { successorKit } from '../helpers/m16-l14-successor-fixtures';

/**
 * M16-S1B.0 — governed-registry framework + typed target-scope evidence on real disposable
 * PostgreSQL 17. The cluster starts at the S1A horizon, real S1A history is written through the
 * real Authority Policy RPCs, and only then is the S1B.0 migration applied — so historical
 * compatibility is proven on genuine S1A rows, not on an empty schema. Structural probes of the
 * (not yet executable) registry framework run as the table owner inside rolled-back transactions,
 * except the one committed registry-state chain used by the immutability probes.
 */
const REGISTRY = ['GOVERNANCE_PARTY', 'BUSINESS_DOMAIN', 'INFORMATION_DOMAIN', 'CONTROL_DEFINITION', 'POLICY_VERSION'] as const;
const REGISTRY_PERMISSIONS = ['L14_PARTY_ADMIT', 'L14_DOMAIN_ADMIT', 'L14_CONTROL_DEFINITION_ADMIT', 'L14_POLICY_CONTENT_ADMIT',
  'L14_PARTY_VALIDATE', 'L14_DOMAIN_VALIDATE', 'L14_CONTROL_DEFINITION_VALIDATE', 'L14_POLICY_VERSION_VALIDATE'] as const;
const FACT_PERMISSIONS = ['L14_RESPONSIBILITY_VALIDATE', 'L14_BUSINESS_CONTEXT_VALIDATE', 'L14_POLICY_APPLICABILITY_VALIDATE',
  'L14_CONTROL_APPLICABILITY_VALIDATE', 'L14_CONTROL_ASSESSMENT_VALIDATE'] as const;
const NEW_COLUMNS: Record<string, readonly string[]> = {
  l14_authorization_decisions: ['target_canonical_kind', 'target_canonical_object_id', 'target_relationship_type',
    'target_relationship_id', 'target_relationship_state_id', 'attempted_content_hash', 'expectation_kind',
    'expected_latest_version_id', 'expected_current_state_id'],
  l14_authorization_decision_rules: ['scope_canonical_kind', 'scope_canonical_object_id', 'scope_relationship_type',
    'scope_relationship_id', 'scope_relationship_state_id'],
  l14_command_results: ['subject_kind', 'registry_state_id'],
  l14_support_links: ['admission_authorization_decision_id', 'admission_authorization_result', 'admission_subject_kind',
    'admission_requested_action', 'registry_state_id'],
};
const HEX = (c: string) => c.repeat(64);

test('M16 S1B.0 registry framework + typed target-scope evidence (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message)); // S1A horizon: S1B.0 is applied below
  t.after(() => c.stop());
  const { owner, exec, rejects, adminRole, memberRole } = c;
  const lit = fx.lit;
  const q = (value: string | null) => (value === null ? 'null' : lit(value));
  const one = async (query: string) => lastLine(await owner(query));
  const probe = (body: string) => owner(`begin;\n${body};\nrollback;`);
  const kit = await successorKit(c);

  // ---------------------------------------------------------------------------------------
  // Historical S1A data, written BEFORE the S1B.0 migration exists.
  // ---------------------------------------------------------------------------------------
  const hist = await kit.setup(); // v1 includes the S1A-legal L14_PARTY_VALIDATE CANONICAL_KIND rule
  const denied = await exec(c.admitSql(hist.member, { commandId: hist.cmd('pre-deny'), rules: kit.opsRules(9),
    expected: { authorityPolicyId: hist.v1.authority_policy_id, latestVersionId: hist.v1.version_id } }));
  assert.equal(denied.outcome, 'DENIED');
  const rejectedAdmit = await kit.admitNext(hist, hist.ops, 'pre-v2-admit', kit.opsRules(2));
  const rejectedProposal = kit.validateProposal(rejectedAdmit);
  const rejectedSubmit = await kit.submit(hist, hist.member, 'pre-v2-submit', rejectedProposal);
  await kit.decide(hist, hist.ops, 'pre-v2-defer', rejectedSubmit, rejectedProposal, 'DEFER');
  await kit.decide(hist, hist.ops, 'pre-v2-reject', rejectedSubmit, rejectedProposal, 'REJECT');
  await c.evidence(hist.org, 'hist-ev-1');
  const evidenced = await exec(c.admitSql(hist.ops, { commandId: hist.cmd('pre-v3-admit'), rules: kit.opsRules(3),
    support: { status: 'PRESENT', evidenceIds: ['hist-ev-1'] },
    expected: { authorityPolicyId: hist.v1.authority_policy_id, latestVersionId: rejectedAdmit.version_id } }));
  assert.equal(evidenced.outcome, 'ADMITTED');
  const replayProbe = c.admitSql(hist.member, { commandId: hist.cmd('pre-deny'), rules: kit.opsRules(9),
    expected: { authorityPolicyId: hist.v1.authority_policy_id, latestVersionId: hist.v1.version_id } });

  const tableDigest = async (table: string, drop: readonly string[]) => one(`select coalesce(md5(string_agg(x, '|' order by x)), 'empty')
    from (select (to_jsonb(t) - ${drop.length ? `array[${drop.map(lit).join(',')}]` : `'{}'::text[]`})::text as x from gov_repo.${table} t) s`);
  const catalogOf = (table: string) => one(`select md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid), '|' order by conname)
      from pg_constraint where conrelid='gov_repo.${table}'::regclass), '') || '#' ||
    coalesce((select string_agg(indexname||':'||indexdef, '|' order by indexname) from pg_indexes where schemaname='gov_repo' and tablename='${table}'), '') || '#' ||
    coalesce((select string_agg(tgname||':'||tgenabled::text, '|' order by tgname) from pg_trigger where tgrelid='gov_repo.${table}'::regclass), '') || '#' ||
    coalesce((select string_agg(attname||':'||format_type(atttypid, atttypmod)||':'||attnotnull, '|' order by attnum)
      from pg_attribute where attrelid='gov_repo.${table}'::regclass and attnum>0 and not attisdropped), ''))`);
  const before: Record<string, string> = {};
  for (const table of L14_TABLES) before[table] = await tableDigest(table, []);
  const relationshipsCatalogBefore = await catalogOf('canonical_relationships');
  const relationshipRowsBefore = await one(`select coalesce(md5(string_agg(t::text, '|' order by relationship_id, relationship_state_id)), 'empty') from gov_repo.canonical_relationships t`);
  const rpcSourcesBefore = await one(`select md5(string_agg(proname||':'||prosrc, '|' order by proname)) from pg_proc
    where pronamespace='gov_repo'::regnamespace and proname in ('l14_admit_authority_policy_version_v1','l14_submit_proposal_v1','l14_decide_authority_policy_proposal_v1')`);
  const evaluatorBefore = await one(`select md5(prosrc) from pg_proc where oid='gov_repo.l14_evaluate_authority_rules_v1(uuid,uuid,uuid,uuid[],text,text,boolean,text)'::regprocedure`);
  const parserBefore = await one(`select md5(prosrc) from pg_proc where oid='gov_repo.l14_parse_authority_policy_rules_v1(uuid,jsonb)'::regprocedure`);

  await c.migrate(l14RegistryFrameworkMigration);

  // ---------------------------------------------------------------------------------------
  await t.test('migration applies cleanly on real S1A history; every historical row is unchanged; all new constraints VALID', async () => {
    for (const table of L14_TABLES) {
      assert.equal(await tableDigest(table, NEW_COLUMNS[table] ?? []), before[table], `${table}: historical columns unchanged`);
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where subject_kind <> 'AUTHORITY_POLICY_VERSION' or registry_state_id is not null`), '0',
      'logical backfill: every historical command result is AUTHORITY_POLICY_VERSION');
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results`), '9', 'the nine historical S1A commands (incl. one durable DENY)');
    assert.equal(await one(`select count(*) from gov_repo.l14_authorization_decisions where scope_tag <> 'ALL_ALLOWED_TARGETS'
      or coalesce(target_canonical_kind, target_canonical_object_id, target_relationship_type, target_relationship_id, target_relationship_state_id,
                  attempted_content_hash, expectation_kind, expected_latest_version_id::text, expected_current_state_id::text) is not null`), '0',
      'historical authorizations remain ALL_ALLOWED_TARGETS with legacy-shaped (NULL) audit evidence');
    assert.equal(await one(`select count(*) from gov_repo.l14_authorization_decision_rules where coalesce(scope_canonical_kind, scope_canonical_object_id,
      scope_relationship_type, scope_relationship_id, scope_relationship_state_id) is not null or scope_tag <> 'ALL_ALLOWED_TARGETS'`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where owner_kind in ('ADMISSION','REGISTRY_STATE')`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_registry_states`), '0');
    // Every constraint on the L14 surface is VALIDATED except the deliberately NOT VALID D-14 check.
    assert.equal(await one(`select string_agg(conname, ',' order by conname) from pg_constraint k join pg_class c on c.oid=k.conrelid
      where c.relnamespace='gov_repo'::regnamespace and c.relname like 'l14\\_%' and not k.convalidated`),
      'l14_authority_policy_rules_registry_scope_check');
    assert.ok(Number(await one(`select count(*) from gov_repo.l14_authority_policy_rules where permission='L14_PARTY_VALIDATE' and scope_tag='CANONICAL_KIND'`)) >= 1,
      'the S1A-legal registry CANONICAL_KIND rule is still stored (never rewritten)');
    await rejects(owner(`begin; alter table gov_repo.l14_authority_policy_rules validate constraint l14_authority_policy_rules_registry_scope_check; rollback;`), '23514');
  });

  await t.test('no Authority Policy RPC regression: bodies byte-identical; historical DENY replays exactly; successor ADMIT/SUBMIT/VALIDATE/REJECT/DEFER still work', async () => {
    assert.equal(await one(`select md5(string_agg(proname||':'||prosrc, '|' order by proname)) from pg_proc
      where pronamespace='gov_repo'::regnamespace and proname in ('l14_admit_authority_policy_version_v1','l14_submit_proposal_v1','l14_decide_authority_policy_proposal_v1')`),
      rpcSourcesBefore, 'D-11: the three public AP RPC bodies are unchanged');
    assert.equal(await one(`select md5(prosrc) from pg_proc where oid='gov_repo.l14_evaluate_authority_rules_v1(uuid,uuid,uuid,uuid[],text,text,boolean,text)'::regprocedure`),
      evaluatorBefore, 'the rule evaluator is unchanged');
    assert.equal(await one(`select md5(prosrc) from pg_proc where oid='gov_repo.l14_parse_authority_policy_rules_v1(uuid,jsonb)'::regprocedure`),
      parserBefore, 'the audited rule parser is unchanged (D-14 is enforced at insertion, after replay arbitration)');
    const replay = await exec(replayProbe);
    assert.equal(replay.replay, true);
    assert.deepEqual({ ...replay, replay: false }, denied, 'a pre-migration DENY replays its ORIGINAL durable result');

    const compliant = kit.opsRules(4).filter(r => r.permission !== 'L14_PARTY_VALIDATE');
    const next = await kit.successor(hist, 'post-v4', compliant);
    assert.equal(next.admitted.outcome, 'ADMITTED');
    assert.equal(next.decided.outcome, 'VALIDATED');
    const deny = await exec(c.admitSql(hist.member, { commandId: hist.cmd('post-deny'), rules: compliant,
      expected: { authorityPolicyId: hist.v1.authority_policy_id, latestVersionId: next.admitted.version_id } }));
    assert.equal(deny.outcome, 'DENIED');
    assert.equal(deny.deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
    const denyReplay = await exec(c.admitSql(hist.member, { commandId: hist.cmd('post-deny'), rules: compliant,
      expected: { authorityPolicyId: hist.v1.authority_policy_id, latestVersionId: next.admitted.version_id } }));
    assert.deepEqual({ ...denyReplay, replay: false }, deny);
    const other = await kit.admitNext(hist, hist.ops, 'post-v5-admit', kit.opsRules(5).filter(r => r.permission !== 'L14_PARTY_VALIDATE'));
    const proposal = kit.validateProposal(other);
    const submitted = await kit.submit(hist, hist.member, 'post-v5-submit', proposal);
    assert.equal((await kit.decide(hist, hist.ops, 'post-v5-defer', submitted, proposal, 'DEFER')).outcome, 'DEFERRED');
    assert.equal((await kit.decide(hist, hist.ops, 'post-v5-reject', submitted, proposal, 'REJECT')).outcome, 'REJECTED');
    // New AP rows keep the legacy AP shape: ALL + NULL target, NULL audit evidence, subject AP.
    assert.equal(await one(`select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${hist.org}'
      and (expectation_kind is not null or target_canonical_kind is not null or subject_kind <> 'AUTHORITY_POLICY_VERSION')`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where organisation_id='${hist.org}' and subject_kind <> 'AUTHORITY_POLICY_VERSION'`), '0');
    // The replaced snapshot helper still snapshots the AP rules the evaluator used (ALL scope, NULL operands).
    assert.ok(Number(await one(`select count(*) from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${next.decided.authorization_decision_id}'`)) >= 1);
  });

  // ---------------------------------------------------------------------------------------
  // A post-migration organisation with a validated policy whose v2 carries every legal scope.
  // ---------------------------------------------------------------------------------------
  const org = await c.newOrg();
  const admin = await c.mkUser(org, [adminRole, kit.opsRole]);
  const actor = await c.mkUser(org, [memberRole]);
  const agent = fx.canonicalObjectKit(org, 's1b0-agent', 'AGENT', { proposedIdentity: { agentCode: 's1b0-agent' }, identity: 's1b0-agent' });
  const model = fx.canonicalObjectKit(org, 's1b0-model', 'MODEL', { proposedIdentity: { modelReference: 's1b0-model' }, identity: 's1b0-model' });
  await owner(`${agent.sql}\n${model.sql}`);
  // Fixture-only relationship state (as S1A did); S1B.0 never writes canonical_relationships.
  await owner(`insert into gov_repo.canonical_relationships(relationship_id,organisation_id,relationship_state_id,relationship_type,
    source_canonical_object_id,source_kind,target_canonical_object_id,target_kind,valid_from,recorded_at,created_by_decision_id)
    values('rel:s1b0','${org}','rel:s1b0:state','USES_MODEL',${lit(agent.objectId)},'AGENT',${lit(model.objectId)},'MODEL',now(),now(),'decision-s1b0-agent')`);
  const relationshipRowsWithFixture = await one(`select md5(string_agg(t::text, '|' order by relationship_id, relationship_state_id)) from gov_repo.canonical_relationships t`);
  const boot = await c.bootstrapPolicy(admin, 's1b0', kit.opsRules(0).filter(r => r.permission !== 'L14_PARTY_VALIDATE'));
  const basis = boot.admitted as { authority_policy_id: string; version_id: string; content_hash: string };
  const nonAllScopes = (): Array<Partial<Parameters<typeof rule>[3]>> => [
    { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' },
    { scopeTag: 'CANONICAL_OBJECT', scopeCanonicalKind: 'AGENT', scopeCanonicalObjectId: agent.objectId },
    { scopeTag: 'RELATIONSHIP_TYPE', scopeRelationshipType: 'USES_MODEL' },
    { scopeTag: 'RELATIONSHIP_STATE', scopeRelationshipId: 'rel:s1b0', scopeRelationshipStateId: 'rel:s1b0:state' },
  ];
  const actionOf = (permission: string) => (permission.endsWith('_ADMIT') ? 'ADMIT' : 'VALIDATE') as 'ADMIT' | 'VALIDATE';
  const v2Rules = [
    ...kit.opsRules(0).filter(r => r.permission !== 'L14_PARTY_VALIDATE'),
    ...REGISTRY_PERMISSIONS.map(p => rule(memberRole, p, actionOf(p))),
    ...FACT_PERMISSIONS.flatMap(p => nonAllScopes().map(scope => rule(memberRole, p, 'VALIDATE', scope))),
    ...FACT_PERMISSIONS.map(p => rule(memberRole, p, 'REVOKE')),
  ];
  let v2: Record<string, any>;

  await t.test('D-14: registry permissions + ALL_ALLOWED_TARGETS and fact permissions + every legal scope are still admitted', async () => {
    v2 = await exec(c.admitSql(admin, { commandId: 's1b0-v2-admit', rules: v2Rules,
      expected: { authorityPolicyId: basis.authority_policy_id, latestVersionId: basis.version_id } }));
    assert.equal(v2.outcome, 'ADMITTED', JSON.stringify(v2));
    assert.equal(await one(`select count(*) from gov_repo.l14_authority_policy_rules where organisation_id='${org}' and version_id='${v2.version_id}'`), String(v2Rules.length));
    assert.equal(await one(`select string_agg(distinct scope_tag, ',' order by scope_tag) from gov_repo.l14_authority_policy_rules
      where organisation_id='${org}' and version_id='${v2.version_id}' and permission like '%\\_VALIDATE' and permission not in (${REGISTRY_PERMISSIONS.map(lit).join(',')})
        and permission <> 'L14_AUTHORITY_POLICY_ADMIN'`), 'ALL_ALLOWED_TARGETS,CANONICAL_KIND,CANONICAL_OBJECT,RELATIONSHIP_STATE,RELATIONSHIP_TYPE');
  });

  await t.test('D-14: a NEW rule for any registry permission with any non-ALL scope fails closed (GV010) and writes nothing', async () => {
    const countsBefore = await c.counts(org);
    let n = 0;
    for (const permission of REGISTRY_PERMISSIONS) {
      for (const scope of nonAllScopes()) {
        const rules = [rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'), rule(memberRole, permission, actionOf(permission), scope)];
        await rejects(c.svc(c.admitSql(admin, { commandId: `d14-${++n}`, rules,
          expected: { authorityPolicyId: basis.authority_policy_id, latestVersionId: v2.version_id } })), 'GV010', /RULE_REGISTRY_SCOPE_INVALID/);
      }
    }
    assert.equal(n, 32);
    assert.deepEqual(await c.counts(org), countsBefore, 'the authorized ADMIT rolled back entirely: no command, authorization, version or rule');
    // An actor WITHOUT admission authority is denied before any rule could be stored: a durable DENY,
    // no version, no rule (the content is never admitted either way).
    const deniedIllegal = await exec(c.admitSql(actor, { commandId: 'd14-unauthorized',
      rules: [rule(memberRole, 'L14_PARTY_VALIDATE', 'VALIDATE', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' })],
      expected: { authorityPolicyId: basis.authority_policy_id, latestVersionId: v2.version_id } }));
    assert.equal(deniedIllegal.outcome, 'DENIED');
    const afterDeny = await c.counts(org);
    assert.equal(afterDeny.l14_authority_policy_versions, countsBefore.l14_authority_policy_versions);
    assert.equal(afterDeny.l14_authority_policy_rules, countsBefore.l14_authority_policy_rules);
    // The insertion guard also stops the table owner; the NOT VALID CHECK is an independent backstop.
    const directInsert = `insert into gov_repo.l14_authority_policy_rules(organisation_id,authority_policy_id,version_id,rule_ordinal,role_id,permission,
      requested_action,source_class,source_disposition,scope_tag,scope_canonical_kind,allow_self_validation,allow_future_dating,allow_backdating)
      values('${org}','${basis.authority_policy_id}','${v2.version_id}',999,'${memberRole}','L14_DOMAIN_VALIDATE','VALIDATE','LOCAL_HUMAN',
      'AUTHORITATIVE','CANONICAL_KIND','AGENT',false,false,false)`;
    await rejects(probe(directInsert), 'GV010', /RULE_REGISTRY_SCOPE_INVALID/);
    await rejects(probe(`alter table gov_repo.l14_authority_policy_rules disable trigger l14_authority_policy_rules_registry_scope_guard; ${directInsert}`),
      '23514', /l14_authority_policy_rules_registry_scope_check/);
    assert.equal(await one(`select tgenabled from pg_trigger where tgname='l14_authority_policy_rules_registry_scope_guard'`), 'A', 'guard still ALWAYS after rollback');
    // A legacy stored registry non-ALL rule can never authorize: the unchanged evaluator fails closed.
    const legacy = JSON.parse(await one(`select to_json(e) from gov_repo.l14_evaluate_authority_rules_v1('${hist.org}',
      '${hist.v1.authority_policy_id}','${hist.v1.version_id}',array['${memberRole}']::uuid[],'L14_PARTY_VALIDATE','VALIDATE',false,'IMMEDIATE') e`));
    assert.equal(legacy.deny_reason, 'SCOPE_NOT_AUTHORIZED');
  });

  // ---------------------------------------------------------------------------------------
  // Structural builders (owner fixtures; no registry RPC exists in S1B.0).
  // ---------------------------------------------------------------------------------------
  interface Authz {
    id?: string; command?: string; subject?: string; action?: string; scope?: string; result?: 'ALLOW' | 'DENY'; deny?: string | null;
    basis?: 'POLICY' | 'NONE' | 'BOOTSTRAP'; basisVersion?: { authority_policy_id: string; version_id: string; content_hash: string };
    proposal?: string | null; selfValidation?: boolean | null; subjectAp?: string | null; subjectVersion?: string | null;
    targetKind?: string | null; targetObject?: string | null; targetRelType?: string | null; targetRel?: string | null; targetRelState?: string | null;
    attempted?: string | null; expectation?: string | null; expectedVersion?: string | null; expectedState?: string | null; by?: Actor;
  }
  function authzSql(a: Authz) {
    const result = a.result ?? 'ALLOW';
    const b = a.basis ?? (result === 'ALLOW' ? 'POLICY' : 'NONE');
    const bv = a.basisVersion ?? basis;
    const proposal = a.proposal ?? null;
    return `insert into gov_repo.l14_authorization_decisions(organisation_id,authorization_decision_id,command_id,command_fingerprint,actor_user_id,
      requested_action,subject_kind,scope_tag,source_class,proposal_id,is_self_validation,subject_authority_policy_id,subject_version_id,
      authority_basis,basis_authority_policy_id,basis_version_id,basis_content_hash,result,deny_reason,evaluated_at,
      target_canonical_kind,target_canonical_object_id,target_relationship_type,target_relationship_id,target_relationship_state_id,
      attempted_content_hash,expectation_kind,expected_latest_version_id,expected_current_state_id)
      values('${org}','${a.id ?? randomUUID()}',${lit(a.command ?? `cmd-${randomUUID()}`)},'${HEX('c')}','${(a.by ?? actor).id}',
      ${lit(a.action ?? 'ADMIT')},${lit(a.subject ?? 'GOVERNANCE_PARTY')},${lit(a.scope ?? 'ALL_ALLOWED_TARGETS')},'LOCAL_HUMAN',
      ${proposal === null ? 'null' : `'${proposal}'`},${proposal === null ? 'null' : String(a.selfValidation ?? false)},
      ${q(a.subjectAp ?? null)},${q(a.subjectVersion ?? null)},
      ${b === 'POLICY' ? `'AUTHORITY_POLICY_VERSION','${bv.authority_policy_id}','${bv.version_id}','${bv.content_hash}'`
        : b === 'BOOTSTRAP' ? `'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1',null,null,null` : 'null,null,null,null'},
      '${result}',${result === 'ALLOW' ? 'null' : lit(a.deny ?? (b === 'NONE' ? 'NO_EFFECTIVE_AUTHORITY' : 'NO_MATCHING_AUTHORITY_RULE'))},clock_timestamp(),
      ${q(a.targetKind ?? null)},${q(a.targetObject ?? null)},${q(a.targetRelType ?? null)},${q(a.targetRel ?? null)},${q(a.targetRelState ?? null)},
      ${q(a.attempted ?? null)},${a.expectation === undefined ? `'NOT_APPLICABLE'` : q(a.expectation)},${q(a.expectedVersion ?? null)},${q(a.expectedState ?? null)})`;
  }
  const proposalSql = (id: string, subject: string, intent: 'VALIDATE' | 'REVOKE' = 'VALIDATE') =>
    `insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
     values('${org}','${id}',${lit(subject)},'${intent}','LOCAL_HUMAN','${actor.id}','NONE',clock_timestamp())`;
  const decisionSql = (o: { id: string; proposal: string; authz: string; subject?: string; outcome?: string; reason?: string; apTarget?: boolean }) => {
    const subject = o.subject ?? 'GOVERNANCE_PARTY', outcome = o.outcome ?? 'VALIDATE';
    const reason = o.reason ?? `${subject}_${({ VALIDATE: 'VALIDATED', REJECT: 'REJECTED', DEFER: 'DEFERRED', REVOKE: 'REVOKED' } as Record<string, string>)[outcome]}`;
    return `insert into gov_repo.l14_governance_decisions(organisation_id,governance_decision_id,proposal_id,subject_kind,outcome,reason_code,
      authorization_decision_id,actor_user_id,target_authority_policy_id,target_version_id,target_content_hash,support_status,decided_at)
      values('${org}','${o.id}','${o.proposal}',${lit(subject)},${lit(outcome)},${lit(reason)},'${o.authz}','${admin.id}',
      ${o.apTarget ? `'${basis.authority_policy_id}','${basis.version_id}','${basis.content_hash}'` : 'null,null,null'},'NONE',clock_timestamp())`;
  };
  interface StateInput { id: string; decision: string; authz: string; subject?: string; kind?: 'VALIDATED' | 'REVOKED'; predecessor?: string | null;
    revokes?: string | null; trust?: string; basisVersion?: { authority_policy_id: string; version_id: string; content_hash: string } }
  const stateSql = (s: StateInput) => {
    const bv = s.basisVersion ?? basis;
    return `insert into gov_repo.l14_registry_states(organisation_id,state_id,subject_kind,state_kind,predecessor_state_id,revokes_state_id,
      effective_from,recorded_at,governance_decision_id,authorization_decision_id,authority_policy_id,authority_policy_version_id,
      authority_policy_content_hash,trust_state,source_class,support_status)
      values('${org}','${s.id}',${lit(s.subject ?? 'GOVERNANCE_PARTY')},'${s.kind ?? 'VALIDATED'}',${q(s.predecessor ?? null)},${q(s.revokes ?? null)},
      clock_timestamp(),clock_timestamp(),'${s.decision}','${s.authz}','${bv.authority_policy_id}','${bv.version_id}','${bv.content_hash}',
      ${lit(s.trust ?? 'VALIDATED')},'LOCAL_HUMAN','NONE')`;
  };
  const resultSql = (o: { command: string; kind: string; outcome: string; subject?: string | null; authz?: string | null; proposal?: string | null;
    decision?: string | null; registryState?: string | null; apPolicy?: string | null; apVersion?: string | null }) =>
    `insert into gov_repo.l14_command_results(organisation_id,command_id,command_kind,command_fingerprint,actor_user_id,outcome,
      authorization_decision_id,proposal_id,governance_decision_id,authority_policy_id,version_id,${o.subject === null ? '' : 'subject_kind,'}registry_state_id,recorded_at)
      values('${org}',${lit(o.command)},${lit(o.kind)},'${HEX('c')}','${actor.id}',${lit(o.outcome)},${q(o.authz ?? null)},${q(o.proposal ?? null)},
      ${q(o.decision ?? null)},${q(o.apPolicy ?? null)},${q(o.apVersion ?? null)},${o.subject === null ? '' : `${lit(o.subject ?? 'GOVERNANCE_PARTY')},`}${q(o.registryState ?? null)},clock_timestamp())`;

  await t.test('typed request target: exactly ALL_ALLOWED_TARGETS | CANONICAL_OBJECT | RELATIONSHIP_STATE shapes (D-7)', async () => {
    const fact = { subject: 'POLICY_APPLICABILITY', action: 'VALIDATE', result: 'DENY' as const, basis: 'NONE' as const };
    // Positive shapes (rolled back; deferred command FK never reached).
    await probe(authzSql({ ...fact }));
    await probe(authzSql({ ...fact, scope: 'CANONICAL_OBJECT', targetKind: 'AGENT', targetObject: agent.objectId }));
    await probe(authzSql({ ...fact, scope: 'RELATIONSHIP_STATE', targetRelType: 'USES_MODEL', targetRel: 'rel:s1b0', targetRelState: 'rel:s1b0:state' }));
    // Future resolution is exact read-only; the operands themselves carry no FK/uniqueness (F2).
    await probe(authzSql({ ...fact, scope: 'RELATIONSHIP_STATE', targetRelType: 'USES_MODEL', targetRel: 'rel:none', targetRelState: 'state:none' }));
    const bad: Array<[string, Authz, string, RegExp]> = [
      ['CANONICAL_KIND is not a request shape', { ...fact, scope: 'CANONICAL_KIND', targetKind: 'AGENT' }, '23514', /l14_authorization_decisions_request_target_check/],
      ['RELATIONSHIP_TYPE is not a request shape', { ...fact, scope: 'RELATIONSHIP_TYPE', targetRelType: 'USES_MODEL' }, '23514', /l14_authorization_decisions_request_target_check/],
      ['ALL with an operand', { ...fact, targetKind: 'AGENT' }, '23514', /l14_authorization_decisions_request_target_check/],
      ['object without id', { ...fact, scope: 'CANONICAL_OBJECT', targetKind: 'AGENT' }, '23514', /l14_authorization_decisions_request_target_check/],
      ['object with relationship operand', { ...fact, scope: 'CANONICAL_OBJECT', targetKind: 'AGENT', targetObject: agent.objectId, targetRel: 'rel:s1b0' },
        '23514', /l14_authorization_decisions_request_target_check/],
      ['relationship state without resolved type', { ...fact, scope: 'RELATIONSHIP_STATE', targetRel: 'rel:s1b0', targetRelState: 'rel:s1b0:state' },
        '23514', /l14_authorization_decisions_request_target_check/],
      ['relationship state without state id', { ...fact, scope: 'RELATIONSHIP_STATE', targetRelType: 'USES_MODEL', targetRel: 'rel:s1b0' },
        '23514', /l14_authorization_decisions_request_target_check/],
      ['unknown target kind', { ...fact, scope: 'CANONICAL_OBJECT', targetKind: 'POLICY', targetObject: agent.objectId }, '23514', /target_vocabulary_check/],
      ['unknown relationship type', { ...fact, scope: 'RELATIONSHIP_STATE', targetRelType: 'OWNS', targetRel: 'r', targetRelState: 's' }, '23514', /target_vocabulary_check/],
      ['untrimmed operand', { ...fact, scope: 'CANONICAL_OBJECT', targetKind: 'AGENT', targetObject: ` ${agent.objectId}` }, '23514', /target_operand_check/],
      ['declared kind differs from the object', { ...fact, scope: 'CANONICAL_OBJECT', targetKind: 'MODEL', targetObject: agent.objectId }, '23503', /target_object_fkey/],
      ['unknown canonical object', { ...fact, scope: 'CANONICAL_OBJECT', targetKind: 'AGENT', targetObject: 'canonical-object:none' }, '23503', /target_object_fkey/],
      ['registry subject with a canonical target', { subject: 'GOVERNANCE_PARTY', scope: 'CANONICAL_OBJECT', targetKind: 'AGENT', targetObject: agent.objectId },
        '23514', /organisation_scope_check/],
      ['AP subject with a canonical target', { subject: 'AUTHORITY_POLICY_VERSION', scope: 'CANONICAL_OBJECT', targetKind: 'AGENT', targetObject: agent.objectId,
        expectation: null }, '23514', /organisation_scope_check/],
      ['registry subject with the bootstrap basis', { basis: 'BOOTSTRAP' }, '23514', /bootstrap_subject_check/],
      ['registry subject with a bootstrap deny reason', { result: 'DENY', basis: 'POLICY', deny: 'BOOTSTRAP_ROLE_REQUIRED' }, '23514', /bootstrap_subject_check/],
      ['registry subject with AP subject columns', { subjectAp: randomUUID(), subjectVersion: randomUUID() }, '23514', /ap_subject_check/],
    ];
    for (const [label, input, code, detail] of bad) await rejects(probe(authzSql(input)), code, detail).catch(error => { throw new Error(`${label}: ${error}`); });
    // Cross-tenant canonical object: never resolves.
    const foreignOrg = await c.newOrg();
    const foreign = fx.canonicalObjectKit(foreignOrg, 's1b0-foreign', 'AGENT', { proposedIdentity: { agentCode: 's1b0-foreign' }, identity: 's1b0-foreign' });
    await owner(foreign.sql);
    await rejects(probe(authzSql({ ...fact, scope: 'CANONICAL_OBJECT', targetKind: 'AGENT', targetObject: foreign.objectId })), '23503', /target_object_fkey/);
    // F2: no FK / uniqueness / index on any relationship operand.
    assert.equal(await one(`select count(*) from pg_constraint k join pg_attribute a on a.attrelid=k.conrelid and a.attnum=any(k.conkey)
      where k.conrelid in ('gov_repo.l14_authorization_decisions'::regclass,'gov_repo.l14_authorization_decision_rules'::regclass)
        and k.contype in ('f','u','p','x') and a.attname like '%relationship%'`), '0');
    assert.equal(await one(`select count(*) from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
      where i.indrelid in ('gov_repo.l14_authorization_decisions'::regclass,'gov_repo.l14_authorization_decision_rules'::regclass)
        and a.attname like '%relationship%'`), '0');
  });

  await t.test('F-4 audit columns: nullable for legacy AP rows; required, closed and shape-checked for every other subject; FK-less', async () => {
    assert.equal(await one(`select string_agg(column_name||':'||is_nullable, ',' order by column_name) from information_schema.columns
      where table_schema='gov_repo' and table_name='l14_authorization_decisions'
        and column_name in ('attempted_content_hash','expectation_kind','expected_latest_version_id','expected_current_state_id')`),
      'attempted_content_hash:YES,expectation_kind:YES,expected_current_state_id:YES,expected_latest_version_id:YES');
    // Stale / unknown expected ids and an attempted hash remain recordable (no FK) on an ADMIT DENY.
    await probe(authzSql({ result: 'DENY', basis: 'NONE', attempted: HEX('a'), expectation: 'EXPECTED_CURRENT',
      expectedVersion: randomUUID(), expectedState: randomUUID() }));
    await probe(authzSql({ expectation: 'EXPECTED_NONE' }));
    await probe(authzSql({ subject: 'AUTHORITY_POLICY_VERSION', result: 'DENY', basis: 'NONE', expectation: null })); // legacy AP shape
    const bad: Array<[string, Authz, RegExp]> = [
      ['registry subject without evidence', { expectation: null }, /audit_shape_check/],
      ['unknown expectation kind', { expectation: 'MAYBE' }, /audit_(vocabulary|shape)_check/],
      ['EXPECTED_NONE with an id', { expectation: 'EXPECTED_NONE', expectedState: randomUUID() }, /audit_shape_check/],
      ['EXPECTED_CURRENT without an id', { expectation: 'EXPECTED_CURRENT' }, /audit_shape_check/],
      ['NOT_APPLICABLE with an id', { expectation: 'NOT_APPLICABLE', expectedVersion: randomUUID() }, /audit_shape_check/],
      ['attempted hash on a non-ADMIT action', { action: 'VALIDATE', attempted: HEX('a') }, /audit_vocabulary_check/],
      ['malformed attempted hash', { attempted: 'A'.repeat(64) }, /audit_vocabulary_check/],
      ['AP row with partial evidence but no expectation kind', { subject: 'AUTHORITY_POLICY_VERSION', result: 'DENY', basis: 'NONE', expectation: null,
        attempted: HEX('a') }, /audit_shape_check/],
    ];
    for (const [label, input, detail] of bad) await rejects(probe(authzSql(input)), '23514', detail).catch(error => { throw new Error(`${label}: ${error}`); });
    assert.equal(await one(`select count(*) from pg_constraint k join pg_attribute a on a.attrelid=k.conrelid and a.attnum=any(k.conkey)
      where k.conrelid='gov_repo.l14_authorization_decisions'::regclass and k.contype='f'
        and a.attname in ('expected_latest_version_id','expected_current_state_id','attempted_content_hash')`), '0');
  });

  await t.test('rule snapshot: the unchanged-signature helper copies every exact immutable operand; a mismatching copy is rejected', async () => {
    assert.equal(await one(`select pg_get_function_identity_arguments('gov_repo.l14_snapshot_policy_rules_v1'::regproc)`),
      'p_organisation_id uuid, p_authorization_decision_id uuid, p_authority_policy_id uuid, p_version_id uuid, p_rule_ordinals integer[]');
    const authz = randomUUID();
    const compared = await one(`begin;
      ${authzSql({ id: authz, subject: 'POLICY_APPLICABILITY', action: 'VALIDATE', result: 'DENY', basis: 'POLICY', basisVersion: v2 as never,
        deny: 'SCOPE_NOT_AUTHORIZED' })};
      select gov_repo.l14_snapshot_policy_rules_v1('${org}','${authz}','${basis.authority_policy_id}','${v2.version_id}',
        (select array_agg(rule_ordinal) from gov_repo.l14_authority_policy_rules where organisation_id='${org}' and version_id='${v2.version_id}'));
      select json_build_object(
        'rules', (select count(*) from gov_repo.l14_authority_policy_rules where organisation_id='${org}' and version_id='${v2.version_id}'),
        'snapshots', (select count(*) from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${authz}'),
        'exact', (select count(*) from gov_repo.l14_authorization_decision_rules s join gov_repo.l14_authority_policy_rules r
          on r.organisation_id=s.organisation_id and r.authority_policy_id=s.basis_authority_policy_id and r.version_id=s.basis_version_id
          and r.rule_ordinal=s.basis_rule_ordinal
          where s.authorization_decision_id='${authz}' and (s.permission,s.requested_action,s.source_class,s.source_disposition,s.scope_tag,
            s.allow_self_validation,s.allow_future_dating,s.allow_backdating) = (r.permission,r.requested_action,r.source_class,r.source_disposition,
            r.scope_tag,r.allow_self_validation,r.allow_future_dating,r.allow_backdating)
            and s.scope_canonical_kind is not distinct from r.scope_canonical_kind and s.scope_canonical_object_id is not distinct from r.scope_canonical_object_id
            and s.scope_relationship_type is not distinct from r.scope_relationship_type and s.scope_relationship_id is not distinct from r.scope_relationship_id
            and s.scope_relationship_state_id is not distinct from r.scope_relationship_state_id),
        'tags', (select string_agg(distinct scope_tag, ',' order by scope_tag) from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${authz}'),
        'objects', (select count(*) from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${authz}' and scope_canonical_object_id=${lit(agent.objectId)}),
        'states', (select count(*) from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${authz}' and scope_relationship_state_id='rel:s1b0:state'));
      rollback;`);
    const r = JSON.parse(compared);
    assert.equal(r.snapshots, r.rules);
    assert.equal(r.exact, r.rules, 'every snapshot row is an exact copy of its immutable rule');
    assert.equal(r.tags, 'ALL_ALLOWED_TARGETS,CANONICAL_KIND,CANONICAL_OBJECT,RELATIONSHIP_STATE,RELATIONSHIP_TYPE');
    assert.equal(r.objects, FACT_PERMISSIONS.length);
    assert.equal(r.states, FACT_PERMISSIONS.length);
    const ordinal = await one(`select rule_ordinal from gov_repo.l14_authority_policy_rules where organisation_id='${org}' and version_id='${v2.version_id}'
      and scope_tag='CANONICAL_OBJECT' order by rule_ordinal limit 1`);
    const snapshotRow = (id: string, operands: string) => `insert into gov_repo.l14_authorization_decision_rules(organisation_id,authorization_decision_id,
      snapshot_ordinal,permission_origin,permission,requested_action,source_class,source_disposition,scope_tag,scope_canonical_kind,scope_canonical_object_id,
      allow_self_validation,allow_future_dating,allow_backdating,basis_authority_policy_id,basis_version_id,basis_rule_ordinal)
      select '${org}','${id}',1,'AUTHORITY_POLICY_RULE',permission,requested_action,source_class,source_disposition,scope_tag,${operands},
        allow_self_validation,allow_future_dating,allow_backdating,authority_policy_id,version_id,rule_ordinal
      from gov_repo.l14_authority_policy_rules where organisation_id='${org}' and version_id='${v2.version_id}' and rule_ordinal=${ordinal}`;
    const id2 = randomUUID();
    const setup = authzSql({ id: id2, subject: 'POLICY_APPLICABILITY', action: 'VALIDATE', result: 'DENY', basis: 'POLICY', basisVersion: v2 as never, deny: 'SCOPE_NOT_AUTHORIZED' });
    await probe(`${setup}; ${snapshotRow(id2, 'scope_canonical_kind, scope_canonical_object_id')}`);
    await rejects(probe(`${setup}; ${snapshotRow(id2, `scope_canonical_kind, ${lit(model.objectId)}`)}`), 'GV010', /RULE_SNAPSHOT_MISMATCH/);
    await rejects(probe(`${setup}; ${snapshotRow(id2, `'MODEL', scope_canonical_object_id`)}`), 'GV010', /RULE_SNAPSHOT_MISMATCH/);
    await rejects(probe(`${setup}; ${snapshotRow(id2, 'null, null')}`), 'GV010', /RULE_SNAPSHOT_MISMATCH/);
    // The typed shape CHECK itself (isolated on a bootstrap-origin row, which the rule guard does not compare).
    await rejects(probe(`${setup}; insert into gov_repo.l14_authorization_decision_rules(organisation_id,authorization_decision_id,snapshot_ordinal,permission_origin,
      permission,requested_action,source_class,source_disposition,scope_tag,scope_canonical_kind,allow_self_validation,allow_future_dating,allow_backdating)
      values('${org}','${id2}',1,'SYSTEM_BOOTSTRAP','L14_AUTHORITY_POLICY_ADMIN','VALIDATE','LOCAL_HUMAN','AUTHORITATIVE','ALL_ALLOWED_TARGETS','AGENT',false,false,false)`),
      '23514', /l14_authorization_decision_rules_scope_shape_check/);
    await rejects(probe(`${setup}; insert into gov_repo.l14_authorization_decision_rules(organisation_id,authorization_decision_id,snapshot_ordinal,permission_origin,
      permission,requested_action,source_class,source_disposition,scope_tag,scope_canonical_kind,allow_self_validation,allow_future_dating,allow_backdating)
      values('${org}','${id2}',1,'SYSTEM_BOOTSTRAP','L14_RESPONSIBILITY_VALIDATE','VALIDATE','LOCAL_HUMAN','AUTHORITATIVE','CANONICAL_KIND','AGENT',false,false,false)`),
      '23514', /bootstrap_scope_check/);
  });

  // ---------------------------------------------------------------------------------------
  // One committed registry-state chain (VALIDATED -> REVOKED) + an ADMIT, built from the widened envelopes.
  // ---------------------------------------------------------------------------------------
  const ids = { p1: randomUUID(), a1: randomUUID(), d1: randomUUID(), s1: randomUUID(), p2: randomUUID(), a2: randomUUID(), d2: randomUUID(),
    s2: randomUUID(), a3: randomUUID() };
  await c.evidence(org, 's1b0-ev-1');

  await t.test('widened envelopes: a complete registry VALIDATE -> REVOKE chain + ADMIT commits through the SAME decision framework', async () => {
    await owner(`begin;
      ${proposalSql(ids.p1, 'GOVERNANCE_PARTY')};
      ${authzSql({ id: ids.a1, command: 'reg-validate', action: 'VALIDATE', proposal: ids.p1, expectation: 'EXPECTED_NONE' })};
      ${decisionSql({ id: ids.d1, proposal: ids.p1, authz: ids.a1 })};
      ${stateSql({ id: ids.s1, decision: ids.d1, authz: ids.a1 })};
      ${resultSql({ command: 'reg-validate', kind: 'DECIDE_PROPOSAL', outcome: 'VALIDATED', authz: ids.a1, proposal: ids.p1, decision: ids.d1, registryState: ids.s1 })};
      commit;`);
    await owner(`begin;
      ${proposalSql(ids.p2, 'GOVERNANCE_PARTY', 'REVOKE')};
      ${authzSql({ id: ids.a2, command: 'reg-revoke', action: 'REVOKE', proposal: ids.p2, expectation: 'EXPECTED_CURRENT', expectedState: ids.s1 })};
      ${decisionSql({ id: ids.d2, proposal: ids.p2, authz: ids.a2, outcome: 'REVOKE' })};
      ${stateSql({ id: ids.s2, decision: ids.d2, authz: ids.a2, kind: 'REVOKED', predecessor: ids.s1, revokes: ids.s1 })};
      ${resultSql({ command: 'reg-revoke', kind: 'DECIDE_PROPOSAL', outcome: 'REVOKED', authz: ids.a2, proposal: ids.p2, decision: ids.d2, registryState: ids.s2 })};
      insert into gov_repo.l14_support_links(organisation_id,support_link_id,owner_kind,registry_state_id,evidence_id)
        values('${org}',gen_random_uuid(),'REGISTRY_STATE','${ids.s2}','s1b0-ev-1');
      commit;`);
    await owner(`begin;
      ${authzSql({ id: ids.a3, command: 'reg-admit', action: 'ADMIT', expectation: 'EXPECTED_NONE' })};
      ${resultSql({ command: 'reg-admit', kind: 'ADMIT_GOVERNANCE_PARTY', outcome: 'ADMITTED', authz: ids.a3 })};
      insert into gov_repo.l14_support_links(organisation_id,support_link_id,owner_kind,admission_authorization_decision_id,admission_authorization_result,
        admission_subject_kind,admission_requested_action,evidence_id)
        values('${org}',gen_random_uuid(),'ADMISSION','${ids.a3}','ALLOW','GOVERNANCE_PARTY','ADMIT','s1b0-ev-1');
      commit;`);
    const states = JSON.parse(await one(`select json_agg(json_build_object('kind',state_kind,'outcome',decision_outcome,'revoked',revoked_state_kind) order by state_kind desc)
      from gov_repo.l14_registry_states where organisation_id='${org}'`));
    assert.deepEqual(states, [{ kind: 'VALIDATED', outcome: 'VALIDATE', revoked: null }, { kind: 'REVOKED', outcome: 'REVOKE', revoked: 'VALIDATED' }]);
  });

  await t.test('governance decisions: registry subjects in the same table; closed subject x outcome reason matrix; subject/action-exact references', async () => {
    const mk = (subject: string, outcome = 'VALIDATE', action = outcome) => {
      const p = randomUUID(), a = randomUUID();
      return { p, a, setup: `${proposalSql(p, subject, outcome === 'REVOKE' ? 'REVOKE' : 'VALIDATE')};
        ${authzSql({ id: a, subject, action, proposal: p, expectation: 'EXPECTED_NONE' })}` };
    };
    for (const subject of REGISTRY) {
      for (const outcome of ['VALIDATE', 'REJECT', 'DEFER', 'REVOKE']) {
        const b = mk(subject, outcome);
        await probe(`${b.setup}; ${decisionSql({ id: randomUUID(), proposal: b.p, authz: b.a, subject, outcome })}`);
      }
    }
    const b = mk('GOVERNANCE_PARTY');
    const bad: Array<[string, string, string, RegExp]> = [
      ['AP reason on a registry subject', decisionSql({ id: randomUUID(), proposal: b.p, authz: b.a, reason: 'AUTHORITY_POLICY_VALIDATED' }), '23514', /reason_check/],
      ['another subject\'s reason', decisionSql({ id: randomUUID(), proposal: b.p, authz: b.a, reason: 'BUSINESS_DOMAIN_VALIDATED' }), '23514', /reason_check/],
      ['free-text reason', decisionSql({ id: randomUUID(), proposal: b.p, authz: b.a, reason: 'looks fine to me' }), '23514', /reason_(code_)?check/],
      ['registry subject with AP target pins', decisionSql({ id: randomUUID(), proposal: b.p, authz: b.a, apTarget: true }), '23514', /target_shape_check/],
      ['outcome differs from the authorized action', decisionSql({ id: randomUUID(), proposal: b.p, authz: b.a, outcome: 'DEFER' }), '23503', /authorization_action_fkey/],
      ['subject differs from the authorization', decisionSql({ id: randomUUID(), proposal: b.p, authz: b.a, subject: 'BUSINESS_DOMAIN' }), '23503', /fkey/],
      ['fact subject (not widened)', decisionSql({ id: randomUUID(), proposal: b.p, authz: b.a, subject: 'POLICY_APPLICABILITY', reason: 'POLICY_APPLICABILITY_VALIDATED' }),
        '23514', /reason_code_check|subject_kind_check/],
    ];
    for (const [label, sqlText, code, detail] of bad) await rejects(probe(`${b.setup}; ${sqlText}`), code, detail).catch(error => { throw new Error(`${label}: ${error}`); });
    // A DENY authorization can never back a governance decision; an AP decision still requires AP pins.
    const d = { p: randomUUID(), a: randomUUID() };
    await rejects(probe(`${proposalSql(d.p, 'GOVERNANCE_PARTY')}; ${authzSql({ id: d.a, action: 'VALIDATE', proposal: d.p, result: 'DENY', basis: 'POLICY' })};
      ${decisionSql({ id: randomUUID(), proposal: d.p, authz: d.a })}`), '23503');
    await rejects(probe(`update gov_repo.l14_governance_decisions set reason_code=reason_code where organisation_id='${org}'`), '55000', /L14_HISTORY_IMMUTABLE/);
  });

  await t.test('registry-state envelope: kind/revocation/lineage/decision/basis shapes are enforced generically', async () => {
    const bundle = (outcome: 'VALIDATE' | 'REVOKE', subject = 'GOVERNANCE_PARTY', basisVersion = basis) => {
      const p = randomUUID(), a = randomUUID(), d = randomUUID();
      return { p, a, d, sql: `${proposalSql(p, subject, outcome === 'REVOKE' ? 'REVOKE' : 'VALIDATE')};
        ${authzSql({ id: a, subject, action: outcome, proposal: p, expectation: 'EXPECTED_NONE', basisVersion })};
        ${decisionSql({ id: d, proposal: p, authz: a, subject, outcome })}` };
    };
    const v = bundle('VALIDATE'), r = bundle('REVOKE');
    for (const subject of REGISTRY) {
      const s = bundle('VALIDATE', subject);
      await probe(`${s.sql}; ${stateSql({ id: randomUUID(), decision: s.d, authz: s.a, subject })}`);
    }
    // Revalidation after revoke (lineage continues from the tombstone): generically legal.
    await probe(`${v.sql}; ${stateSql({ id: randomUUID(), decision: v.d, authz: v.a, predecessor: ids.s2 })}`);
    const bad: Array<[string, string, string, RegExp]> = [
      ['VALIDATED carrying a revocation target', `${v.sql}; ${stateSql({ id: randomUUID(), decision: v.d, authz: v.a, revokes: ids.s1, predecessor: ids.s2 })}`,
        '23514', /l14_registry_states_kind_check/],
      ['REVOKED without a target', `${r.sql}; ${stateSql({ id: randomUUID(), decision: r.d, authz: r.a, kind: 'REVOKED', predecessor: ids.s2 })}`,
        '23514', /l14_registry_states_kind_check/],
      ['first state REVOKED', `${r.sql}; ${stateSql({ id: randomUUID(), decision: r.d, authz: r.a, kind: 'REVOKED', revokes: ids.s1 })}`,
        '23514', /l14_registry_states_first_check/],
      ['second successor of one predecessor', `${v.sql}; ${stateSql({ id: randomUUID(), decision: v.d, authz: v.a, predecessor: ids.s1 })}`,
        '23505', /l14_registry_states_successor_unique/],
      ['a state revoked twice', `${r.sql}; ${stateSql({ id: randomUUID(), decision: r.d, authz: r.a, kind: 'REVOKED', predecessor: ids.s2, revokes: ids.s1 })}`,
        '23505', /l14_registry_states_revocation_target_uidx/],
      ['revoking a REVOKED state', `${r.sql}; ${stateSql({ id: randomUUID(), decision: r.d, authz: r.a, kind: 'REVOKED', predecessor: ids.s2, revokes: ids.s2 })}`,
        '23503', /l14_registry_states_revokes_fkey/],
      ['VALIDATED from a REVOKE decision', `${r.sql}; ${stateSql({ id: randomUUID(), decision: r.d, authz: r.a, predecessor: ids.s2 })}`,
        '23503', /l14_registry_states_(decision|authorization)_fkey/],
      ['cross-subject lineage', (() => { const s = bundle('VALIDATE', 'BUSINESS_DOMAIN');
        return `${s.sql}; ${stateSql({ id: randomUUID(), decision: s.d, authz: s.a, subject: 'BUSINESS_DOMAIN', predecessor: ids.s2 })}`; })(),
        '23503', /l14_registry_states_predecessor_fkey/],
      ['cross-subject revocation', (() => { const gv = bundle('VALIDATE'), gs = randomUUID(), bv = bundle('VALIDATE', 'BUSINESS_DOMAIN'),
          br = bundle('REVOKE', 'BUSINESS_DOMAIN'), bs = randomUUID();
        return `${gv.sql}; ${stateSql({ id: gs, decision: gv.d, authz: gv.a, predecessor: ids.s2 })};
          ${bv.sql}; ${stateSql({ id: bs, decision: bv.d, authz: bv.a, subject: 'BUSINESS_DOMAIN' })}; ${br.sql};
          ${stateSql({ id: randomUUID(), decision: br.d, authz: br.a, subject: 'BUSINESS_DOMAIN', kind: 'REVOKED', predecessor: bs, revokes: gs })}`; })(),
        '23503', /l14_registry_states_revokes_fkey/],
      ['subject differs from its decision', `${v.sql}; ${stateSql({ id: randomUUID(), decision: v.d, authz: v.a, subject: 'BUSINESS_DOMAIN' })}`,
        '23503', /fkey/],
      ['decision reused', `${v.sql}; ${stateSql({ id: randomUUID(), decision: ids.d1, authz: ids.a1, predecessor: ids.s2 })}`,
        '23505', /l14_registry_states_(decision|authorization)_unique/],
      ['basis differs from the authorization basis', `${v.sql}; ${stateSql({ id: randomUUID(), decision: v.d, authz: v.a, predecessor: ids.s2, basisVersion: v2 as never })}`,
        '23503', /l14_registry_states_authorization_fkey/],
      ['non-VALIDATED trust', `${v.sql}; ${stateSql({ id: randomUUID(), decision: v.d, authz: v.a, predecessor: ids.s2, trust: 'DECLARED' })}`,
        '23514', /trust_state/],
      ['AP subject in the registry envelope', `${v.sql}; ${stateSql({ id: randomUUID(), decision: v.d, authz: v.a, subject: 'AUTHORITY_POLICY_VERSION' })}`,
        '23514', /subject_kind/],
    ];
    for (const [label, sqlText, code, detail] of bad) await rejects(probe(sqlText), code, detail).catch(error => { throw new Error(`${label}: ${error}`); });
    // A basis-less (DENY) or bootstrap authorization can never back a state.
    const deny = { p: randomUUID(), a: randomUUID() };
    await rejects(probe(`${v.sql}; ${proposalSql(deny.p, 'GOVERNANCE_PARTY')}; ${authzSql({ id: deny.a, action: 'VALIDATE', proposal: deny.p, result: 'DENY', basis: 'NONE' })};
      ${stateSql({ id: randomUUID(), decision: v.d, authz: deny.a, predecessor: ids.s2 })}`), '23503');
  });

  await t.test('no JSON/EAV truth: the envelope has exactly its typed columns, no subject content, and no JSON anywhere in L14', async () => {
    assert.equal(await one(`select string_agg(attname||':'||format_type(atttypid, atttypmod), ',' order by attnum) from pg_attribute
      where attrelid='gov_repo.l14_registry_states'::regclass and attnum>0 and not attisdropped`),
      ['organisation_id:uuid', 'state_id:uuid', 'subject_kind:text', 'state_kind:text', 'decision_outcome:text', 'predecessor_state_id:uuid',
        'revokes_state_id:uuid', 'revoked_state_kind:text', 'effective_from:timestamp with time zone', 'recorded_at:timestamp with time zone',
        'governance_decision_id:uuid', 'authorization_decision_id:uuid', 'authorization_result:text', 'authority_policy_id:uuid',
        'authority_policy_version_id:uuid', 'authority_policy_content_hash:text', 'trust_state:text', 'source_class:text', 'support_status:text'].join(','));
    assert.equal(await one(`select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid
      where c.relnamespace='gov_repo'::regnamespace and c.relname like 'l14\\_%' and a.attnum>0 and not a.attisdropped
        and a.atttypid in ('json'::regtype,'jsonb'::regtype,'text[]'::regtype,'jsonb[]'::regtype)`), '0');
    assert.equal(await one(`select string_agg(attname, ',' order by attname) from pg_attribute where attrelid='gov_repo.l14_registry_states'::regclass
      and attgenerated='s'`), 'decision_outcome,revoked_state_kind', 'derived columns are generated, never caller-supplied');
    await rejects(probe(`insert into gov_repo.l14_registry_states(organisation_id,state_id,subject_kind,state_kind,decision_outcome,effective_from,recorded_at,
      governance_decision_id,authorization_decision_id,authority_policy_id,authority_policy_version_id,authority_policy_content_hash,trust_state,source_class,support_status)
      values('${org}',gen_random_uuid(),'GOVERNANCE_PARTY','VALIDATED','REVOKE',now(),now(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
      '${HEX('a')}','VALIDATED','LOCAL_HUMAN','NONE')`), '428C9');
  });

  await t.test('immutability: registry states + every widened envelope raise on UPDATE / DELETE / TRUNCATE, even for the owner', async () => {
    for (const table of ['l14_registry_states', 'l14_command_results', 'l14_authorization_decisions', 'l14_authorization_decision_rules',
      'l14_governance_decisions', 'l14_support_links', 'l14_proposals']) {
      for (const statement of [`update gov_repo.${table} set organisation_id=organisation_id where organisation_id='${org}'`,
        `delete from gov_repo.${table} where organisation_id='${org}'`, `truncate gov_repo.${table} cascade`]) {
        await rejects(owner(statement), '55000', /L14_HISTORY_IMMUTABLE/).catch(error => { throw new Error(`${table}: ${statement}: ${error}`); });
      }
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_registry_states where organisation_id='${org}'`), '2');
    assert.equal(await one(`select count(*) from pg_constraint where confrelid='gov_repo.l14_registry_states'::regclass and confdeltype<>'a'`), '0',
      'no cascade / set-null path into the envelope');
    assert.equal(await one(`select count(*) from pg_constraint where conrelid='gov_repo.l14_registry_states'::regclass and contype='f' and confdeltype<>'a'`), '0');
  });

  await t.test('command results + support links: subject-exact registry shapes; AP invariants unchanged', async () => {
    const admitAuthz = () => { const a = randomUUID(); return { a, sql: authzSql({ id: a, command: `c-${a}`, action: 'ADMIT', expectation: 'EXPECTED_NONE' }) }; };
    const x = admitAuthz();
    const bad: Array<[string, string, string, RegExp]> = [
      ['registry admission inheriting the AP default', `${x.sql}; ${resultSql({ command: `c-${x.a}`, kind: 'ADMIT_GOVERNANCE_PARTY', outcome: 'ADMITTED', authz: x.a, subject: null })}`,
        '23514', /command_subject_check|shape_check/],
      ['admission kind of another subject', `${x.sql}; ${resultSql({ command: `c-${x.a}`, kind: 'ADMIT_BUSINESS_DOMAIN', outcome: 'ADMITTED', authz: x.a })}`,
        '23514', /command_subject_check/],
      ['registry row with AP pins', `${x.sql}; ${resultSql({ command: `c-${x.a}`, kind: 'ADMIT_GOVERNANCE_PARTY', outcome: 'ADMITTED', authz: x.a,
        apPolicy: basis.authority_policy_id, apVersion: basis.version_id })}`, '23514', /shape_check/],
      ['registry ADMITTED with a state', `${x.sql}; ${resultSql({ command: `c-${x.a}`, kind: 'ADMIT_GOVERNANCE_PARTY', outcome: 'ADMITTED', authz: x.a, registryState: ids.s1 })}`,
        '23514', /shape_check/],
      ['result subject differs from the authorization', `${x.sql}; ${resultSql({ command: `c-${x.a}`, kind: 'DECIDE_PROPOSAL', outcome: 'DENIED', authz: x.a,
        proposal: ids.p1, subject: 'BUSINESS_DOMAIN' })}`, '23503', /fkey/],
      ['VALIDATED without a registry state', `${x.sql}; ${resultSql({ command: `c-${x.a}`, kind: 'DECIDE_PROPOSAL', outcome: 'VALIDATED', authz: x.a,
        proposal: ids.p1, decision: ids.d1 })}`, '23514', /shape_check/],
      ['AP row with a registry state', `${resultSql({ command: 'ap-bad', kind: 'SUBMIT_PROPOSAL', outcome: 'SUBMITTED', subject: null, proposal: boot.submitted.proposal_id,
        apVersion: basis.version_id, registryState: ids.s1 })}`, '23514', /shape_check/],
      ['unknown command kind', `${resultSql({ command: 'bad-kind', kind: 'APPROVE_EVERYTHING', outcome: 'SUBMITTED', proposal: ids.p1 })}`, '23514', /command_kind_check|shape_check|command_subject_check/],
    ];
    for (const [label, sqlText, code, detail] of bad) await rejects(probe(sqlText), code, detail).catch(error => { throw new Error(`${label}: ${error}`); });
    await probe(`${x.sql}; ${resultSql({ command: `c-${x.a}`, kind: 'ADMIT_GOVERNANCE_PARTY', outcome: 'DENIED', authz: x.a })}`);
    await probe(`${resultSql({ command: 'sub-ok', kind: 'SUBMIT_PROPOSAL', outcome: 'SUBMITTED', proposal: ids.p1 })}`);
    // Support links: ADMISSION only to a registry ALLOW ADMIT authorization; REGISTRY_STATE only to a state.
    await c.evidence(org, 's1b0-ev-2');
    const link = (cols: string, vals: string, evidenceId = 's1b0-ev-2') => `insert into gov_repo.l14_support_links(organisation_id,support_link_id,owner_kind,${cols},evidence_id)
      values('${org}',gen_random_uuid(),${vals},'${evidenceId}')`;
    const deny = randomUUID();
    const linkBad: Array<[string, string, string, RegExp]> = [
      ['admission of a VALIDATE authorization', link('admission_authorization_decision_id,admission_authorization_result,admission_subject_kind,admission_requested_action',
        `'ADMISSION','${ids.a1}','ALLOW','GOVERNANCE_PARTY','ADMIT'`), '23503', /admission_fkey/],
      ['admission of a DENY authorization', `${authzSql({ id: deny, result: 'DENY', basis: 'NONE' })}; ${link('admission_authorization_decision_id,admission_authorization_result,admission_subject_kind,admission_requested_action',
        `'ADMISSION','${deny}','ALLOW','GOVERNANCE_PARTY','ADMIT'`)}`, '23503', /admission_fkey/],
      ['admission of an AP authorization', link('admission_authorization_decision_id,admission_authorization_result,admission_subject_kind,admission_requested_action',
        `'ADMISSION','${boot.admitted.authorization_decision_id}','ALLOW','AUTHORITY_POLICY_VERSION','ADMIT'`), '23514', /admission_shape_check/],
      ['admission with the wrong subject', link('admission_authorization_decision_id,admission_authorization_result,admission_subject_kind,admission_requested_action',
        `'ADMISSION','${ids.a3}','ALLOW','BUSINESS_DOMAIN','ADMIT'`), '23503', /admission_fkey/],
      ['admission owner with a state', link('admission_authorization_decision_id,admission_authorization_result,admission_subject_kind,admission_requested_action,registry_state_id',
        `'ADMISSION','${ids.a3}','ALLOW','GOVERNANCE_PARTY','ADMIT','${ids.s1}'`), '23514', /owner_check/],
      ['legacy owner with a new column', link('proposal_id,registry_state_id', `'PROPOSAL','${ids.p1}','${ids.s1}'`), '23514', /owner_check/],
      ['unknown registry state', link('registry_state_id', `'REGISTRY_STATE','${randomUUID()}'`), '23503', /registry_state_fkey/],
      ['duplicate evidence on a state', link('registry_state_id', `'REGISTRY_STATE','${ids.s2}'`, 's1b0-ev-1'), '23505', /registry_state_uidx/],
      ['cross-tenant evidence', link('registry_state_id', `'REGISTRY_STATE','${ids.s1}'`, 'hist-ev-1'), '23503', /evidence_fkey/],
      ['partially NULL admission key', link('admission_authorization_decision_id', `'ADMISSION','${ids.a1}'`), '23514', /admission_shape_check/],
    ];
    for (const [label, sqlText, code, detail] of linkBad) await rejects(probe(sqlText), code, detail).catch(error => { throw new Error(`${label}: ${error}`); });
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where organisation_id='${org}' and owner_kind in ('ADMISSION','REGISTRY_STATE')`), '2');
  });

  await t.test('replay-first support canonicalization: deterministic byte-ordered framing, identical to S1A parts, with NO reference lookup', async () => {
    const parts = async (status: string, idList: string[]) => JSON.parse(await one(`select to_json(gov_repo.l14_support_syntactic_parts_v1(${lit(status)},
      ${idList.length ? `array[${idList.map(lit).join(',')}]::text[]` : `'{}'::text[]`}))`)) as string[];
    const odd = ['z', 'a', 'é', 'Z', '😀', 'ab', 'a b'];
    const sorted = await parts('PRESENT', odd);
    assert.deepEqual(sorted, supportParts({ status: 'PRESENT', evidenceIds: odd }), 'byte-for-byte equal to the TypeScript mirror (UTF-8 byte order)');
    assert.deepEqual(await parts('PRESENT', [...odd].reverse()), sorted, 'caller order never matters');
    assert.deepEqual(await parts('NONE', []), ['NONE', '0']);
    // No lookup: ids that exist nowhere canonicalize without error ...
    assert.deepEqual(await parts('PRESENT', ['ghost-2', 'ghost-1']), ['PRESENT', '2', 'ghost-1', 'ghost-2']);
    // ... while the S1A resolver-bound helper rejects them, and gives the SAME parts for resolvable ids.
    await rejects(owner(`select gov_repo.l14_support_parts_v1('${org}','PRESENT',array['ghost-1']::text[])`), 'GV010', /SUPPORT_REFERENCE_UNRESOLVED/);
    assert.equal(await one(`select gov_repo.l14_support_parts_v1('${org}','PRESENT',array['s1b0-ev-1']::text[])::text`),
      await one(`select gov_repo.l14_support_syntactic_parts_v1('PRESENT',array['s1b0-ev-1']::text[])::text`));
    assert.equal(await one(`select (prosrc ~* 'gov_repo\.|discovery_evidence') from pg_proc where oid='gov_repo.l14_support_syntactic_parts_v1(text,text[])'::regprocedure`),
      'f', 'the syntactic helper references no gov_repo relation');
    assert.equal(await one(`select pronargs from pg_proc where oid='gov_repo.l14_support_syntactic_parts_v1(text,text[])'::regprocedure`), '2', 'it takes no organisation');
    for (const [status, list] of [['NONE', ['a']], ['PRESENT', []], ['PRESENT', ['a', 'a']], ['MAYBE', []], ['PRESENT', [' a']], ['PRESENT', ['']]] as Array<[string, string[]]>) {
      await rejects(owner(`select gov_repo.l14_support_syntactic_parts_v1(${lit(status)}, ${list.length ? `array[${list.map(lit).join(',')}]::text[]` : `'{}'::text[]`})`),
        'GV010', /SUPPORT_MALFORMED/);
    }
    await rejects(owner(`select gov_repo.l14_support_syntactic_parts_v1('PRESENT', array['a',null]::text[])`), 'GV010', /SUPPORT_MALFORMED/);
    await rejects(owner(`select gov_repo.l14_support_syntactic_parts_v1('PRESENT', (select array_agg('e'||g) from generate_series(1,201) g))`), 'GV010', /SUPPORT_MALFORMED/);
    // Deferred (post-replay) resolution: exact tenant evidence only.
    await owner(`select gov_repo.l14_resolve_support_v1('${org}', array['s1b0-ev-1']::text[])`);
    await owner(`select gov_repo.l14_resolve_support_v1('${org}', '{}'::text[])`);
    await rejects(owner(`select gov_repo.l14_resolve_support_v1('${org}', array['hist-ev-1']::text[])`), 'GV010', /SUPPORT_REFERENCE_UNRESOLVED/);
    await rejects(owner(`select gov_repo.l14_resolve_support_v1('${org}', array['ghost']::text[])`), 'GV010', /SUPPORT_REFERENCE_UNRESOLVED/);
  });

  await t.test('F2 untouched: canonical_relationships catalog and rows unchanged; no FK into it from L14', async () => {
    assert.equal(await catalogOf('canonical_relationships'), relationshipsCatalogBefore, 'no DDL: constraints/indexes/triggers/columns identical');
    assert.equal(relationshipRowsBefore, 'empty');
    assert.equal(await one(`select md5(string_agg(t::text, '|' order by relationship_id, relationship_state_id)) from gov_repo.canonical_relationships t`),
      relationshipRowsWithFixture, 'no DML beyond the test fixture row');
    assert.equal(await one(`select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid
      where k.confrelid='gov_repo.canonical_relationships'::regclass and c.relname like 'l14\\_%'`), '0');
  });

  await t.test('fixture sanity: NONE support constant and the S1A table list are unchanged', () => {
    assert.deepEqual(NONE, { status: 'NONE', evidenceIds: [] });
    assert.equal(L14_TABLES.length, 13);
  });
});
