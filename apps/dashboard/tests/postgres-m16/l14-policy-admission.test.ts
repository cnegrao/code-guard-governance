import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { L14_POLICY_VERSION_CHANGE_SUMMARY } from '@council/canonical-contracts';
import { admitGovernancePolicyFingerprint, admitPolicyVersionFingerprint, governancePolicyContentHash, policyVersionContentHash } from '@council/governance-review';
import { l14Cluster, lastLine, NONE } from '../helpers/m16-l14-fixtures';
import { policyKit } from '../helpers/m16-l14-policy-fixtures';

/**
 * M16-S1B.3 — POLICY CONTENT ADMISSION on real disposable PostgreSQL 17 (S1B3 horizon: the full canonical chain +
 * S1B.2R1/R2/R3 + the post-R3 discovery slices + S1B.3). Every policy command and read goes through the real public
 * RPCs as service_role; every Authority Policy through the real AP RPCs. Owner access is used only to read evidence,
 * to insert explicit LEGACY rows, and for rolled-back structural probes.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADMIT_POLICY_SIG = 'gov_repo.l14_admit_governance_policy_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,text,text,text,text,text,text[],text)';
const ADMIT_VERSION_SIG = 'gov_repo.l14_admit_policy_version_v1(uuid,uuid,bigint,bigint,timestamptz,text,uuid,uuid,text,text,text,text,text[],text)';
const READ_SIG = 'gov_repo.l14_read_policy_descriptors_v1(uuid,uuid,bigint,bigint,timestamptz,uuid)';
const NON_AUTHORITY = ['l14_governance_decisions', 'l14_registry_states', 'l14_proposals', 'l14_governance_party_states',
  'l14_authority_policy_states', 'l14_governance_parties'] as const;

test('M16 S1B.3 policy content admission (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B3' });
  t.after(() => c.stop());
  const { owner, exec, rejects } = c;
  const k = await policyKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const row = async (query: string) => JSON.parse(await one(`select coalesce((${query}), 'null'::json)`));
  const authz = (id: string) => row(`select to_json(a) from gov_repo.l14_authorization_decisions a where authorization_decision_id='${id}'`);
  const policyRow = (id: string) => row(`select to_json(p) from gov_repo.governance_policies p where policy_id='${id}'`);
  const versionRow = (id: string) => row(`select to_json(v) from gov_repo.policy_versions v where version_id='${id}'`);
  const ctx = await k.setup();

  let policyId = '';
  let v1 = '';
  // ---------------------------------------------------------------------------------------
  await t.test('[1,29,36-41] policy identity ADMIT ALLOW: DB-minted id, D-4 owner NULL, created_by = actor, lineage, no decision/state/version', async () => {
    await c.evidence(ctx.org, 'pa-ev-1');
    const d = k.descriptor('POL-ALPHA', 'Acceptable Use — Política', 'security');
    const before = await k.counts(ctx.org);
    const r = await exec(k.admitPolicySql(ctx.author, { commandId: ctx.cmd('pa-1'), descriptor: d, support: { status: 'PRESENT', evidenceIds: ['pa-ev-1'] } }));
    assert.deepEqual([r.outcome, r.command_kind, r.subject_kind, r.replay, r.authorization_result, r.deny_reason],
      ['ADMITTED', 'ADMIT_GOVERNANCE_POLICY', 'POLICY_VERSION', false, 'ALLOW', null]);
    assert.match(r.policy_id, UUID_V4, 'random (v4) opaque identity minted by PostgreSQL');
    assert.notEqual(r.policy_id, ctx.author.id);
    assert.deepEqual([r.version_id, r.version_number, r.content_hash], [null, null, null], 'an identity ADMIT admits no version');
    policyId = r.policy_id;
    const p = await policyRow(policyId);
    assert.deepEqual({ org: p.organisation_id, code: p.policy_code, title: p.title, type: p.policy_type, owner: p.owner_user_id,
      parent: p.parent_policy_id, current: p.current_version_id, by: p.created_by, description: p.description, approver: p.approver_user_id },
    { org: ctx.org, code: 'POL-ALPHA', title: 'Acceptable Use — Política', type: 'security', owner: null, parent: null, current: null,
      by: ctx.author.id, description: null, approver: null }, 'D-4: owner_user_id NULL; created_by = verified actor; no hierarchy; no version pointer');
    const lineage = await row(`select to_json(a) from gov_repo.l14_policy_admissions a where policy_id='${policyId}'`);
    const a = await authz(r.authorization_decision_id);
    assert.deepEqual({ org: lineage.organisation_id, authz: lineage.admission_authorization_decision_id, result: lineage.admission_authorization_result,
      subject: lineage.admission_subject_kind, action: lineage.admission_requested_action, source: lineage.source_class, support: lineage.support_status,
      actor: lineage.admitted_by_actor_user_id, at: lineage.recorded_at },
    { org: ctx.org, authz: r.authorization_decision_id, result: 'ALLOW', subject: 'POLICY_VERSION', action: 'ADMIT', source: 'LOCAL_HUMAN',
      support: 'PRESENT', actor: ctx.author.id, at: a.evaluated_at });
    assert.deepEqual({ result: a.result, action: a.requested_action, subject: a.subject_kind, scope: a.scope_tag, basis: a.authority_basis,
      bv: a.basis_version_id, bh: a.basis_content_hash, exp: a.expectation_kind, el: a.expected_latest_version_id, hash: a.attempted_content_hash,
      proposal: a.proposal_id, self: a.is_self_validation, actor: a.actor_user_id, src: a.source_class },
    { result: 'ALLOW', action: 'ADMIT', subject: 'POLICY_VERSION', scope: 'ALL_ALLOWED_TARGETS', basis: 'AUTHORITY_POLICY_VERSION',
      bv: ctx.v1.version_id, bh: ctx.v1.content_hash, exp: 'EXPECTED_NONE', el: null, hash: governancePolicyContentHash(d), proposal: null,
      self: null, actor: ctx.author.id, src: 'LOCAL_HUMAN' });
    assert.equal(r.attempted_content_hash, governancePolicyContentHash(d), 'DB descriptor hash = TypeScript mirror');
    assert.equal(p.created_at, a.evaluated_at);
    // Authority = the matched immutable rule of the CURRENT persisted role, never JWT/email/service_role.
    assert.equal(await one(`select string_agg(permission||'/'||requested_action||'/'||source_class||'/'||source_disposition||'/'||scope_tag||'/'||permission_origin, ',')
      from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${r.authorization_decision_id}'`),
    'L14_POLICY_CONTENT_ADMIT/ADMIT/LOCAL_HUMAN/AUTHORITATIVE/ALL_ALLOWED_TARGETS/AUTHORITY_POLICY_RULE');
    assert.equal(await one(`select string_agg(role_id::text, ',') from gov_repo.l14_authorization_decision_roles where authorization_decision_id='${r.authorization_decision_id}'`),
      k.authorRole);
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where owner_kind='ADMISSION' and admission_authorization_decision_id='${r.authorization_decision_id}'
      and evidence_id='pa-ev-1' and admission_subject_kind='POLICY_VERSION' and admission_requested_action='ADMIT'`), '1');
    const after = await k.counts(ctx.org);
    for (const table of [...NON_AUTHORITY, 'policy_versions', 'l14_policy_version_admissions']) {
      assert.equal(after[table], before[table], `${table}: ADMIT != VALIDATE, no proposal/decision/state/version/trust`);
    }
    assert.deepEqual([after.governance_policies, after.l14_policy_admissions, after.l14_command_results, after.l14_authorization_decisions],
      [before.governance_policies + 1, before.l14_policy_admissions + 1, before.l14_command_results + 1, before.l14_authorization_decisions + 1]);
  });

  await t.test('[29,30,43] the caller cannot choose policy_id / version_id / organisation / actor / owner / change_summary: no such parameter exists', async () => {
    const inputs = async (sig: string) => one(`select string_agg(a.name, ',' order by a.ord) from pg_proc p,
      rows from (unnest(p.proargnames), unnest(p.proargmodes)) with ordinality a(name, mode, ord) where p.oid='${sig}'::regprocedure and a.mode in ('i','b','v')`);
    assert.equal(await inputs(ADMIT_POLICY_SIG), 'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,'
      + 'p_verified_credential_epoch,p_command_id,p_expectation_kind,p_policy_code,p_title,p_policy_type,p_source_class,p_support_status,'
      + 'p_support_evidence_ids,p_caller_fingerprint');
    assert.equal(await inputs(ADMIT_VERSION_SIG), 'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,'
      + 'p_verified_credential_epoch,p_command_id,p_policy_id,p_expected_latest_version_id,p_content_markdown,p_content_hash,p_source_class,'
      + 'p_support_status,p_support_evidence_ids,p_caller_fingerprint');
    assert.equal(await inputs(READ_SIG), 'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,'
      + 'p_verified_credential_epoch,p_policy_id');
    const policySql = k.admitPolicySql(ctx.author, { commandId: ctx.cmd('choose'), descriptor: k.descriptor('POL-CHOOSE') });
    const versionSql = k.admitVersionSql(ctx.author, { commandId: ctx.cmd('choose'), policyId, content: '# chosen' });
    for (const [sql, extra] of [[policySql, `p_policy_id => '${ctx.author.id}'::uuid`], [policySql, `p_owner_user_id => '${ctx.author.id}'::uuid`],
      [policySql, `p_organisation_id => '${ctx.org}'::uuid`], [versionSql, `p_version_id => '${ctx.author.id}'::uuid`],
      [versionSql, `p_change_summary => 'caller rationale'`], [versionSql, `p_version_number => 7`], [versionSql, `p_version_label => 'v99'`],
      [versionSql, `p_actor_user_id => '${ctx.member.id}'::uuid`]] as const) {
      await rejects(c.svc(sql.replace('p_command_id =>', `${extra}, p_command_id =>`)), '42883');
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${ctx.cmd('choose')}'`), '0');
  });

  await t.test('[2,4,39,40,41,42] first version expected-none: DB hash = Node SHA-256 of the exact UTF-8 bytes; constant change_summary; no legacy authority written', async () => {
    const content = '# Política de IA — 政策 🚀\r\n\n  trailing spaces kept  \r\né vs é\n';
    const nodeHash = createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
    assert.equal(policyVersionContentHash(content), nodeHash);
    await c.evidence(ctx.org, 'va-ev-1');
    const before = await k.counts(ctx.org);
    const r = await exec(k.admitVersionSql(ctx.author, { commandId: ctx.cmd('va-1'), policyId, content,
      support: { status: 'PRESENT', evidenceIds: ['va-ev-1'] } }));
    assert.deepEqual([r.outcome, r.command_kind, r.subject_kind, r.policy_id, r.version_number, r.version_label, r.content_hash, r.expectation_kind,
      r.expected_latest_version_id], ['ADMITTED', 'ADMIT_POLICY_VERSION', 'POLICY_VERSION', policyId, 1, 'v1', nodeHash, 'EXPECTED_NONE', null]);
    assert.match(r.version_id, UUID_V4);
    v1 = r.version_id;
    const v = await versionRow(v1);
    assert.equal(v.content_markdown, content, 'stored byte-for-byte (no normalization)');
    assert.equal(v.content_hash, nodeHash, 'DB-computed hash = Node SHA-256 mirror');
    assert.equal(await one(`select encode(sha256(convert_to(content_markdown,'UTF8')),'hex') from gov_repo.policy_versions where version_id='${v1}'`), nodeHash);
    assert.deepEqual({ org: v.organisation_id, policy: v.policy_id, summary: v.change_summary, by: v.created_by, reviewed: v.reviewed_by,
      approved: v.approved_by, at: v.approval_date, qes: v.qes_signature_id, ledger: v.ledger_entry_seq },
    { org: ctx.org, policy: policyId, summary: L14_POLICY_VERSION_CHANGE_SUMMARY, by: ctx.author.id, reviewed: null, approved: null, at: null,
      qes: null, ledger: null });
    assert.equal(L14_POLICY_VERSION_CHANGE_SUMMARY, 'M16_POLICY_VERSION_ADMISSION');
    const p = await policyRow(policyId);
    assert.deepEqual([p.current_version_id, p.owner_user_id, p.created_by], [null, null, ctx.author.id], 'current_version_id never written');
    const lineage = await row(`select to_json(a) from gov_repo.l14_policy_version_admissions a where version_id='${v1}'`);
    assert.deepEqual([lineage.policy_id, lineage.content_hash, lineage.predecessor_version_id, lineage.admission_authorization_decision_id,
      lineage.admitted_by_actor_user_id, lineage.support_status, lineage.source_class], [policyId, nodeHash, null, r.authorization_decision_id,
      ctx.author.id, 'PRESENT', 'LOCAL_HUMAN']);
    const a = await authz(r.authorization_decision_id);
    assert.deepEqual([a.attempted_content_hash, a.expectation_kind, a.expected_latest_version_id, a.subject_kind], [nodeHash, 'EXPECTED_NONE', null, 'POLICY_VERSION']);
    const after = await k.counts(ctx.org);
    for (const table of NON_AUTHORITY) assert.equal(after[table], before[table], `${table}: no decision / validation / trust`);
    assert.deepEqual([after.policy_versions, after.l14_policy_version_admissions], [before.policy_versions + 1, before.l14_policy_version_admissions + 1]);
  });

  let v2 = '';
  await t.test('[3,31] second version needs the exact expected latest; stale expectations are GV009 and never consumed', async () => {
    const before = await k.counts(ctx.org);
    await rejects(c.svc(k.admitVersionSql(ctx.author, { commandId: ctx.cmd('va-2'), policyId, content: '# v2', expected: null })),
      'GV009', /POLICY_VERSION_EXISTS/);
    await rejects(c.svc(k.admitVersionSql(ctx.author, { commandId: ctx.cmd('va-2'), policyId, content: '# v2', expected: ctx.author.id })),
      'GV009', /POLICY_VERSION_EXPECTATION_MISMATCH/);
    assert.deepEqual(await k.counts(ctx.org), before, 'a stale command consumes nothing');
    const r = await exec(k.admitVersionSql(ctx.author2, { commandId: ctx.cmd('va-2'), policyId, content: '# v2', expected: v1 }));
    assert.deepEqual([r.outcome, r.version_number, r.version_label, r.expectation_kind, r.expected_latest_version_id], ['ADMITTED', 2, 'v2', 'EXPECTED_CURRENT', v1]);
    v2 = r.version_id;
    assert.equal(await one(`select predecessor_version_id from gov_repo.l14_policy_version_admissions where version_id='${v2}'`), v1);
    const a = await authz(r.authorization_decision_id);
    assert.deepEqual([a.expectation_kind, a.expected_latest_version_id], ['EXPECTED_CURRENT', v1]);
    // The superseded expectation is now stale.
    await rejects(c.svc(k.admitVersionSql(ctx.author, { commandId: ctx.cmd('va-3'), policyId, content: '# v3', expected: v1 })),
      'GV009', /POLICY_VERSION_EXPECTATION_MISMATCH/);
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${ctx.cmd('va-3')}'`), '0');
    assert.equal((await exec(k.admitVersionSql(ctx.author, { commandId: ctx.cmd('va-3'), policyId, content: '# v3', expected: v2 }))).version_number, 3);
  });

  await t.test('[28] content hash mismatch / malformed hash fail closed (GV010), nothing consumed; the store guard is the backstop', async () => {
    const before = await k.counts(ctx.org);
    const latest = await one(`select version_id from gov_repo.l14_policy_version_admissions va where policy_id='${policyId}'
      and not exists (select 1 from gov_repo.l14_policy_version_admissions s where s.predecessor_version_id=va.version_id)`);
    for (const [hash, detail] of [['0'.repeat(64), /CONTENT_HASH_MISMATCH/], [policyVersionContentHash('# something else'), /CONTENT_HASH_MISMATCH/],
      [policyVersionContentHash('# v4').toUpperCase(), /CONTENT_HASH_MALFORMED/], ['abc', /CONTENT_HASH_MALFORMED/]] as const) {
      // The TS mirror refuses to frame a malformed hash at all; the DB check precedes the fingerprint comparison.
      const fingerprint = /^[0-9a-f]{64}$/.test(hash) ? undefined : 'a'.repeat(64);
      await rejects(c.svc(k.admitVersionSql(ctx.author, { commandId: ctx.cmd('hash'), policyId, content: '# v4', expected: latest, contentHash: hash,
        fingerprint })), 'GV010', detail);
    }
    assert.deepEqual(await k.counts(ctx.org), before);
    // Even the owner cannot store a version whose hash differs from the DB SHA-256 of its UTF-8 bytes.
    await rejects(owner(`insert into gov_repo.policy_versions(organisation_id,policy_id,version_number,version_label,content_markdown,content_hash,change_summary,created_by)
      values('${ctx.org}','${policyId}',99,'x','# v4',repeat('0',64),'x','${ctx.author.id}')`), '23514', /POLICY_VERSION_CONTENT_HASH_MISMATCH/);
  });

  await t.test('[5,6,26,27] replay: exact replay returns the ORIGINAL; DENY replay survives a role grant and an AP change; GV007 payload change; GV008 fingerprint', async () => {
    const x = await k.setup();
    const allowSql = k.admitPolicySql(x.author, { commandId: x.cmd('r-allow'), descriptor: k.descriptor('R-ALLOW') });
    const allowed = await exec(allowSql);
    const denySql = k.admitPolicySql(x.member, { commandId: x.cmd('r-deny'), descriptor: k.descriptor('R-DENY') });
    const denied = await exec(denySql);
    assert.deepEqual([denied.outcome, denied.deny_reason, denied.policy_id], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE', null]);
    const vAllowSql = k.admitVersionSql(x.author, { commandId: x.cmd('rv-allow'), policyId: allowed.policy_id, content: '# r' });
    const vAllowed = await exec(vAllowSql);
    const vDenySql = k.admitVersionSql(x.member, { commandId: x.cmd('rv-deny'), policyId: allowed.policy_id, content: '# r2', expected: vAllowed.version_id });
    const vDenied = await exec(vDenySql);
    assert.deepEqual([vDenied.outcome, vDenied.expectation_kind, vDenied.expected_latest_version_id, vDenied.attempted_content_hash, vDenied.version_id],
      ['DENIED', 'EXPECTED_CURRENT', vAllowed.version_id, policyVersionContentHash('# r2'), null], 'DENY keeps the F-4 audit evidence');
    // Authority changes AFTER the originals: the member gains the author role; a successor AP removes the author grant.
    await owner(`update gov_repo.governance_users set role_ids=array['${c.memberRole}','${k.authorRole}']::uuid[] where user_id='${x.member.id}'`);
    await k.apSuccessor(x, 'r-ap2', [...k.policyRules(1, [`${k.authorRole}:L14_POLICY_CONTENT_ADMIT:ADMIT`]),
      c.rule(c.memberRole, 'L14_POLICY_CONTENT_ADMIT', 'ADMIT')]);
    const before = await k.counts(x.org);
    for (const [sql, original] of [[allowSql, allowed], [denySql, denied], [vAllowSql, vAllowed], [vDenySql, vDenied]] as const) {
      const replay = await exec(sql);
      assert.equal(replay.replay, true);
      assert.deepEqual({ ...replay, replay: false }, original, 'the ORIGINAL durable result, never re-evaluated');
    }
    assert.deepEqual(await k.counts(x.org), before, 'replay writes nothing');
    // Re-evaluation happens only for a NEW command: now the member is authorized and the author is not.
    assert.equal((await exec(k.admitPolicySql(x.member, { commandId: x.cmd('r-new-member'), descriptor: k.descriptor('R-NEW') }))).outcome, 'ADMITTED');
    assert.equal((await exec(k.admitPolicySql(x.author, { commandId: x.cmd('r-new-author'), descriptor: k.descriptor('R-NEW-2') }))).deny_reason,
      'NO_MATCHING_AUTHORITY_RULE');
    // Same command id + changed payload → GV007 (REPLAY_CONFLICT); wrong caller fingerprint → GV008. Nothing consumed.
    await rejects(c.svc(k.admitPolicySql(x.author, { commandId: x.cmd('r-allow'), descriptor: k.descriptor('R-ALLOW', 'Changed title') })),
      'GV007', /L14_REPLAY_CONFLICT[\s\S]*COMMAND_ID_REUSED_WITH_DIFFERENT_SEMANTICS/);
    await rejects(c.svc(k.admitVersionSql(x.author, { commandId: x.cmd('rv-allow'), policyId: allowed.policy_id, content: '# changed' })), 'GV007');
    await rejects(c.svc(k.admitPolicySql(x.member, { commandId: x.cmd('r-allow'), descriptor: k.descriptor('R-ALLOW') })), 'GV007', /REPLAY_CONFLICT/);
    await rejects(c.svc(k.admitPolicySql(x.author, { commandId: x.cmd('r-fp'), descriptor: k.descriptor('R-FP'), fingerprint: 'a'.repeat(64) })),
      'GV008', /CALLER_FINGERPRINT_DIFFERS/);
    await rejects(c.svc(k.admitPolicySql(x.author, { commandId: x.cmd('r-fp'), descriptor: k.descriptor('R-FP'),
      fingerprint: admitGovernancePolicyFingerprint({ organisationId: x.org, actorUserId: x.author.id, descriptor: k.descriptor('R-FP', 'Other'),
        sourceClass: 'LOCAL_HUMAN', support: NONE }) })), 'GV008');
    await rejects(c.svc(k.admitVersionSql(x.author, { commandId: x.cmd('r-fp'), policyId: allowed.policy_id, content: '# fp', expected: vAllowed.version_id,
      fingerprint: admitPolicyVersionFingerprint({ organisationId: x.org, actorUserId: x.author.id, policyId: allowed.policy_id, expectedLatestVersionId: null,
        contentHash: policyVersionContentHash('# fp'), sourceClass: 'LOCAL_HUMAN', support: NONE }) })), 'GV008');
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${x.cmd('r-fp')}'`), '0');
  });

  await t.test('[19-22,24,6] durable DENY: no AP, missing permission, wrong permission, wrong subject family, CONTRIBUTING source; DENY consumes, admits nothing', async () => {
    const x = await k.setup();
    const p = await exec(k.admitPolicySql(x.author, { commandId: x.cmd('d-p'), descriptor: k.descriptor('D-P') }));
    for (const [actor, name, reason] of [[x.member, 'd-member', 'NO_MATCHING_AUTHORITY_RULE'], [x.validator, 'd-validator', 'NO_MATCHING_AUTHORITY_RULE'],
      [x.party, 'd-party', 'NO_MATCHING_AUTHORITY_RULE'], [x.ops, 'd-ops', 'NO_MATCHING_AUTHORITY_RULE'],
      [x.contrib, 'd-contrib', 'SOURCE_NOT_AUTHORIZED']] as const) {
      for (const kind of ['policy', 'version'] as const) {
        const before = await k.counts(x.org);
        const r = await exec(kind === 'policy'
          ? k.admitPolicySql(actor, { commandId: x.cmd(`${name}-p`), descriptor: k.descriptor(`${name}-p`.slice(0, 20)) })
          : k.admitVersionSql(actor, { commandId: x.cmd(`${name}-v`), policyId: p.policy_id, content: `# ${name}` }));
        assert.deepEqual([r.outcome, r.deny_reason, r.authorization_result, r.policy_id, r.version_id], ['DENIED', reason, 'DENY', null, null], `${name} ${kind}`);
        const after = await k.counts(x.org);
        assert.deepEqual({ ...after, l14_authorization_decisions: 0, l14_command_results: 0, l14_authorization_decision_roles: 0, l14_authorization_decision_rules: 0 },
          { ...before, l14_authorization_decisions: 0, l14_command_results: 0, l14_authorization_decision_roles: 0, l14_authorization_decision_rules: 0 },
          'only the durable authorization (+ snapshots) and the command result are written');
        assert.deepEqual([after.l14_authorization_decisions, after.l14_command_results], [before.l14_authorization_decisions + 1, before.l14_command_results + 1]);
        const a = await authz(r.authorization_decision_id);
        assert.match(a.attempted_content_hash, /^[0-9a-f]{64}$/, 'F-4: the attempted content is audited on DENY');
        assert.equal(a.basis_version_id, x.v1.version_id);
      }
    }
    // service_role capability, a GOVERNANCE_ADMIN system role, a GovernanceParty or an AP-admin role is never policy authority.
    assert.equal((await exec(k.admitPolicySql(x.boot, { commandId: x.cmd('d-boot'), descriptor: k.descriptor('D-BOOT') }))).deny_reason, 'NO_MATCHING_AUTHORITY_RULE');
    // No effective Authority Policy at all: explicit NULL basis, never a bootstrap fallback.
    const bare = await k.setup(undefined, { bootstrap: false });
    const r = await exec(k.admitPolicySql(bare.boot, { commandId: bare.cmd('no-policy'), descriptor: k.descriptor('NO-AP') }));
    assert.deepEqual([r.outcome, r.deny_reason], ['DENIED', 'NO_EFFECTIVE_AUTHORITY']);
    const a = await authz(r.authorization_decision_id);
    assert.deepEqual([a.authority_basis, a.basis_version_id, a.basis_content_hash], [null, null, null]);
    assert.equal(await one(`select count(*) from gov_repo.governance_policies where organisation_id='${bare.org}'`), '0');
    // DENY consumed the command id: a later grant does not turn its replay into an ALLOW.
    await owner(`update gov_repo.governance_users set role_ids=array['${k.authorRole}']::uuid[] where user_id='${x.member.id}'`);
    assert.equal((await exec(k.admitPolicySql(x.member, { commandId: x.cmd('d-member-p'), descriptor: k.descriptor('d-member-p') }))).outcome, 'DENIED');
    assert.equal((await exec(k.admitPolicySql(x.member, { commandId: x.cmd('d-member-p2'), descriptor: k.descriptor('d-member-p2') }))).outcome, 'ADMITTED');
  });

  await t.test('[24,25] source-class rule + unknown vocabulary / malformed shape fail closed BEFORE anything is written (command not consumed)', async () => {
    const x = await k.setup();
    const p = await exec(k.admitPolicySql(x.author, { commandId: x.cmd('s-p'), descriptor: k.descriptor('S-P') }));
    const before = await k.counts(x.org);
    const BAD_FP = 'a'.repeat(64); // all of these fail BEFORE the fingerprint comparison
    for (const [input, detail] of [
      [{ sourceClass: 'SOURCE_CONNECTION' }, /SOURCE_CLASS_NOT_EXECUTABLE/], [{ sourceClass: 'SYSTEM_SEED' }, /SOURCE_CLASS_NOT_EXECUTABLE/],
      [{ sourceClass: 'SCANNER' }, /SOURCE_CLASS_UNKNOWN/], [{ sourceClass: 'LLM' }, /SOURCE_CLASS_UNKNOWN/],
      [{ descriptor: k.descriptor('S-X', 'T', 'ROBOT' as never) }, /POLICY_TYPE_UNKNOWN/],
      [{ descriptor: k.descriptor('bad code') }, /POLICY_CODE_INVALID/], [{ descriptor: k.descriptor('X'.repeat(21)) }, /POLICY_CODE_INVALID/],
      [{ descriptor: k.descriptor('-LEAD') }, /POLICY_CODE_INVALID/], [{ descriptor: k.descriptor('S-T', ' padded') }, /POLICY_TITLE_INVALID/],
      [{ descriptor: k.descriptor('S-T', 'line\nbreak') }, /POLICY_TITLE_INVALID/], [{ descriptor: k.descriptor('S-T', 'x'.repeat(256)) }, /POLICY_TITLE_INVALID/],
      [{ descriptor: k.descriptor('S-T', '') }, /POLICY_TITLE_INVALID/],
      [{ expectation: 'EXPECTED_CURRENT' }, /EXPECTATION_MALFORMED/], [{ expectation: null }, /EXPECTATION_MALFORMED/],
      [{ support: { status: 'PRESENT', evidenceIds: [] } }, /SUPPORT_MALFORMED/], [{ support: { status: 'MAYBE', evidenceIds: [] } }, /SUPPORT_MALFORMED/],
    ] as const) {
      await rejects(c.svc(k.admitPolicySql(x.author, { commandId: x.cmd('shape'), descriptor: k.descriptor('S-OK'), fingerprint: BAD_FP, ...input } as never)),
        'GV010', detail);
    }
    for (const [input, detail] of [
      [{ sourceClass: 'SOURCE_CONNECTION' }, /SOURCE_CLASS_NOT_EXECUTABLE/], [{ sourceClass: 'ROBOT' }, /SOURCE_CLASS_UNKNOWN/],
      [{ content: '' }, /POLICY_CONTENT_INVALID/], [{ content: 'x'.repeat(1_048_577) }, /POLICY_CONTENT_INVALID/],
      [{ policyId: null }, /POLICY_REQUIRED/],
    ] as const) {
      await rejects(c.svc(k.admitVersionSql(x.author, { commandId: x.cmd('shape'), policyId: p.policy_id, content: '# ok', contentHash: '0'.repeat(64),
        fingerprint: BAD_FP, ...input } as never)), 'GV010', detail);
    }
    await rejects(c.svc(k.admitPolicySql(x.author, { commandId: x.cmd('shape'), descriptor: k.descriptor('S-OK'), support: { status: 'PRESENT', evidenceIds: ['ghost'] } })),
      'GV010', /SUPPORT_REFERENCE_UNRESOLVED/);
    assert.deepEqual(await k.counts(x.org), before);
    // An unknown permission / action / scope can never even be persisted in an Authority Policy rule.
    await rejects(owner(`begin; alter table gov_repo.l14_authority_policy_rules disable trigger user;
      insert into gov_repo.l14_authority_policy_rules (organisation_id, authority_policy_id, version_id, rule_ordinal, role_id, permission, requested_action,
        source_class, source_disposition, scope_tag, allow_self_validation, allow_future_dating, allow_backdating)
      values ('${x.org}', '${x.v1.authority_policy_id}', '${x.v1.version_id}', 999, '${k.authorRole}', 'L14_POLICY_ADMIN', 'ADMIT', 'LOCAL_HUMAN', 'AUTHORITATIVE',
        'ALL_ALLOWED_TARGETS', false, false, false); rollback;`), '23514');
    assert.equal((await exec(k.admitPolicySql(x.author, { commandId: x.cmd('shape'), descriptor: k.descriptor('S-OK') }))).outcome, 'ADMITTED', 'command id still free');
  });

  await t.test('[23] D-14: a non-ALL_ALLOWED_TARGETS L14_POLICY_CONTENT_ADMIT rule is rejected at persistence; a legacy one can never authorize (SCOPE_NOT_AUTHORIZED)', async () => {
    const x = await k.setup();
    const h = await k.ap.head(x.org);
    const scoped = [...k.policyRules(2, [`${k.authorRole}:L14_POLICY_CONTENT_ADMIT:ADMIT`]),
      c.rule(k.authorRole, 'L14_POLICY_CONTENT_ADMIT', 'ADMIT', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' })];
    const before = await k.counts(x.org);
    await rejects(c.svc(c.admitSql(x.ops, { commandId: x.cmd('d14'), rules: scoped,
      expected: { authorityPolicyId: x.v1.authority_policy_id, latestVersionId: h.latest_version_id } })), 'GV010', /RULE_REGISTRY_SCOPE_INVALID/);
    assert.deepEqual(await k.counts(x.org), before, 'no invalid rule persisted');
    // A legacy-shaped scoped rule (the insertion guard lifted only inside a rolled-back transaction) is effective
    // through the REAL AP lifecycle, yet the evaluator still never authorizes a non-ALL scope for policy content.
    const s = c.session('m16_bootstrap');
    try {
      await s.run(`begin; alter table gov_repo.l14_authority_policy_rules disable trigger l14_authority_policy_rules_registry_scope_guard;
        alter table gov_repo.l14_authority_policy_rules drop constraint l14_authority_policy_rules_registry_scope_check;`);
      const run = async (sql: string) => { const out = await s.run(sql); assert.equal(out.err, '', out.err); return JSON.parse(lastLine(out.out)); };
      const admitted = await run(c.admitSql(x.ops, { commandId: x.cmd('d14-legacy'), rules: scoped,
        expected: { authorityPolicyId: x.v1.authority_policy_id, latestVersionId: h.latest_version_id } }));
      assert.equal(admitted.outcome, 'ADMITTED');
      const proposal = c.proposalFor(admitted);
      const submitted = await run(c.submitSql(x.member, { commandId: x.cmd('d14-legacy-s'), proposal }));
      const decided = await run(c.decideSql(x.ops, { commandId: x.cmd('d14-legacy-v'), proposalId: submitted.proposal_id, proposal,
        expected: h.latest_state_id }));
      assert.equal(decided.outcome, 'VALIDATED');
      const denied = await run(k.admitPolicySql(x.author, { commandId: x.cmd('d14-admit'), descriptor: k.descriptor('D14') }));
      assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'SCOPE_NOT_AUTHORIZED']);
      await s.run('rollback;');
    } finally { await s.close(); }
    assert.equal(await one(`select count(*) from gov_repo.l14_authority_policy_rules where organisation_id='${x.org}' and scope_tag<>'ALL_ALLOWED_TARGETS'
      and permission='L14_POLICY_CONTENT_ADMIT'`), '0');
  });

  await t.test('[10-18] verified principal: cross-tenant, unknown/inactive actor, inactive organisation, stale epoch, expired / over-age / future session fail (GV00x); nothing consumed', async () => {
    const x = await k.setup();
    const other = await k.setup();
    const p = await exec(k.admitPolicySql(x.author, { commandId: x.cmd('sess-p'), descriptor: k.descriptor('SESS-P') }));
    const now = '(floor(extract(epoch from clock_timestamp()))::bigint)';
    const cases = [
      ['[10] principal org = another tenant', x.author, { org: other.org }, 'GV003', /ACTOR_UNAVAILABLE_OR_NOT_MEMBER/],
      ['[14] non-member actor', { ...x.author, id: other.author.id }, {}, 'GV003', /ACTOR_UNAVAILABLE_OR_NOT_MEMBER/],
      ['[15] stale credential epoch', x.author, { epoch: `'2020-01-01T00:00:00Z'::timestamptz` }, 'GV002', /CREDENTIAL_EPOCH_MISMATCH/],
      ['[16] expired session', x.author, { exp: `${now} - 1` }, 'GV001', /SESSION_EXPIRED/],
      ['[17] over-age session', x.author, { iat: `${now} - 28801` }, 'GV001', /SESSION_MAX_AGE_EXCEEDED/],
      ['[18] future-issued session', x.author, { iat: `${now} + 60` }, 'GV001', /IAT_AHEAD_OF_DATABASE_CLOCK/],
    ] as const;
    const before = await k.counts(x.org);
    for (const [name, actor, session, code, detail] of cases) {
      await rejects(c.svc(k.admitPolicySql(actor, { commandId: x.cmd('sess'), descriptor: k.descriptor('SESS-NEW'), session })), code, detail);
      await rejects(c.svc(k.admitVersionSql(actor, { commandId: x.cmd('sess'), policyId: p.policy_id, content: '# s', session })), code, detail);
      await rejects(c.svc(k.readSql(actor, null, session)), code, detail);
      t.diagnostic(`${name}: ${code}`);
    }
    await owner(`update gov_repo.governance_users set status='suspended' where user_id='${x.author2.id}'`);
    await rejects(c.svc(k.admitPolicySql(x.author2, { commandId: x.cmd('sess'), descriptor: k.descriptor('SESS-NEW') })), 'GV003', /ACTOR_UNAVAILABLE_OR_NOT_MEMBER/);
    await rejects(c.svc(k.readSql(x.author2)), 'GV003');
    assert.deepEqual(await k.counts(x.org), before, 'nothing consumed');
    // [13] inactive organisation.
    await owner(`update gov_repo.organisations set is_active=false where organisation_id='${other.org}'`);
    await rejects(c.svc(k.admitPolicySql(other.author, { commandId: other.cmd('sess'), descriptor: k.descriptor('SESS-ORG') })), 'GV003', /ORGANISATION_UNAVAILABLE/);
    await rejects(c.svc(k.readSql(other.member)), 'GV003', /ORGANISATION_UNAVAILABLE/);
    await owner(`update gov_repo.organisations set is_active=true where organisation_id='${other.org}'`);
    assert.equal((await exec(k.admitPolicySql(x.author, { commandId: x.cmd('sess'), descriptor: k.descriptor('SESS-NEW') }))).outcome, 'ADMITTED');
  });

  await t.test('[11,35] the parent must be an M16-admitted policy of the SAME tenant: legacy-only and foreign policies are rejected identically (GV010)', async () => {
    const x = await k.setup();
    const other = await k.setup();
    const foreign = await exec(k.admitPolicySql(other.author, { commandId: other.cmd('foreign'), descriptor: k.descriptor('FOREIGN') }));
    const legacy = await k.legacyPolicy(x.org, x.boot.id, 'LEGACY-1');
    const before = await k.counts(x.org);
    for (const [policyId, expected] of [[legacy.policyId, null], [legacy.policyId, legacy.versionId], [foreign.policy_id, null],
      [x.author.id, null]] as const) {
      await rejects(c.svc(k.admitVersionSql(x.author, { commandId: x.cmd('parent'), policyId, content: '# child', expected })), 'GV010', /POLICY_NOT_ADMITTED/);
    }
    assert.deepEqual(await k.counts(x.org), before, 'not consumed; the legacy row is not promoted');
    assert.equal(await one(`select count(*) from gov_repo.policy_versions where policy_id='${foreign.policy_id}'`), '0');
    // A legacy row's code still reserves the code (tenant-local uniqueness), never its authority.
    await rejects(c.svc(k.admitPolicySql(x.author, { commandId: x.cmd('dup-legacy'), descriptor: k.descriptor('LEGACY-1') })), 'GV010', /POLICY_CODE_EXISTS/);
  });

  await t.test('[33] policy_code is unique per tenant (GV010 POLICY_CODE_EXISTS, not consumed) and never across tenants', async () => {
    const x = await k.setup();
    const other = await k.setup();
    assert.equal((await exec(k.admitPolicySql(x.author, { commandId: x.cmd('code-1'), descriptor: k.descriptor('SHARED-CODE') }))).outcome, 'ADMITTED');
    await rejects(c.svc(k.admitPolicySql(x.author2, { commandId: x.cmd('code-2'), descriptor: k.descriptor('SHARED-CODE', 'Another title', 'risk') })),
      'GV010', /POLICY_CODE_EXISTS/);
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${x.cmd('code-2')}'`), '0');
    assert.equal((await exec(k.admitPolicySql(other.author, { commandId: other.cmd('code-1'), descriptor: k.descriptor('SHARED-CODE') }))).outcome,
      'ADMITTED', 'another tenant may use the same code');
  });

  await t.test('[7,8,9,11] controlled descriptor read: admitted-only, same tenant only, NOT_VALIDATED, no content body / legacy authority fields', async () => {
    const x = await k.setup();
    const other = await k.setup();
    const pa = await exec(k.admitPolicySql(x.author, { commandId: x.cmd('rd-a'), descriptor: k.descriptor('RD-A', 'Read A', 'data') }));
    const pb = await exec(k.admitPolicySql(x.author, { commandId: x.cmd('rd-b'), descriptor: k.descriptor('RD-B', 'Read B', 'ethics') }));
    const a1 = await exec(k.admitVersionSql(x.author, { commandId: x.cmd('rd-a1'), policyId: pa.policy_id, content: '# A1' }));
    const a2 = await exec(k.admitVersionSql(x.author, { commandId: x.cmd('rd-a2'), policyId: pa.policy_id, content: '# A2', expected: a1.version_id }));
    const legacy = await k.legacyPolicy(x.org, x.boot.id, 'RD-LEGACY');
    // A legacy-shaped (owner-inserted, never admitted) version under an ADMITTED policy, with legacy approval.
    const stray = await one(`insert into gov_repo.policy_versions(organisation_id,policy_id,version_number,version_label,content_markdown,change_summary,status,approved_by,approval_date,created_by)
      values('${x.org}','${pa.policy_id}',3,'3.0','# stray','legacy','approved','${x.boot.id}',now(),'${x.boot.id}') returning version_id`);
    // Legacy status of an ADMITTED policy flipped to approved: still never M16 validation.
    await owner(`update gov_repo.governance_policies set status='approved' where policy_id='${pa.policy_id}'`);
    await exec(k.admitPolicySql(other.author, { commandId: other.cmd('rd-foreign'), descriptor: k.descriptor('RD-FOREIGN') }));
    const rows = await k.read(x.member);
    assert.deepEqual(rows.map(r => [r.policy_code, r.version_number, r.version_label]), [['RD-A', 1, 'v1'], ['RD-A', 2, 'v2'], ['RD-B', null, null]]);
    assert.deepEqual(Object.keys(rows[0]!).sort(), ['content_hash', 'policy_admission_authorization_decision_id', 'policy_code', 'policy_id', 'policy_recorded_at',
      'policy_type', 'title', 'validation_state', 'version_admission_authorization_decision_id', 'version_id', 'version_label', 'version_number',
      'version_recorded_at'], 'no content_markdown, status, approval, QES or version pointer');
    assert.ok(rows.every(r => r.validation_state === 'NOT_VALIDATED'), 'NOT_VALIDATED until S1B.4, whatever the legacy status');
    assert.deepEqual({ ...rows[1], version_recorded_at: null, policy_recorded_at: null }, { policy_id: pa.policy_id, policy_code: 'RD-A', title: 'Read A',
      policy_type: 'data', policy_admission_authorization_decision_id: pa.authorization_decision_id, policy_recorded_at: null, version_id: a2.version_id,
      version_number: 2, version_label: 'v2', content_hash: policyVersionContentHash('# A2'), version_admission_authorization_decision_id: a2.authorization_decision_id,
      version_recorded_at: null, validation_state: 'NOT_VALIDATED' });
    assert.ok(!rows.some(r => r.policy_id === legacy.policyId || r.version_id === stray || r.version_id === legacy.versionId), 'legacy rows excluded');
    assert.deepEqual((await k.read(x.member, pb.policy_id)).map(r => r.policy_code), ['RD-B']);
    assert.deepEqual(await k.read(x.member, legacy.policyId), [], 'a legacy policy id is not readable');
    // Tenant isolation: the other tenant sees only its own admitted policy, even when it names x's policy id.
    assert.deepEqual((await k.read(other.member)).map(r => r.policy_code), ['RD-FOREIGN']);
    assert.deepEqual(await k.read(other.member, pa.policy_id), []);
    // Any ACTIVE member of the tenant may read descriptors; reading writes nothing.
    const before = await k.counts(x.org);
    assert.equal((await k.read(x.validator)).length, 3);
    assert.deepEqual(await k.counts(x.org), before);
  });

  await t.test('immutability: lineage is append-only; an admitted descriptor (and its D-4 nullity) is frozen; legacy rows stay legacy-mutable', async () => {
    const x = await k.setup();
    const p = await exec(k.admitPolicySql(x.author, { commandId: x.cmd('im-p'), descriptor: k.descriptor('IM-P') }));
    const v = await exec(k.admitVersionSql(x.author, { commandId: x.cmd('im-v'), policyId: p.policy_id, content: '# im' }));
    for (const statement of [
      `update gov_repo.l14_policy_admissions set support_status='PRESENT' where policy_id='${p.policy_id}'`,
      `delete from gov_repo.l14_policy_admissions where policy_id='${p.policy_id}'`,
      `update gov_repo.l14_policy_version_admissions set predecessor_version_id=null where version_id='${v.version_id}'`,
      `delete from gov_repo.l14_policy_version_admissions where version_id='${v.version_id}'`,
      'truncate gov_repo.l14_policy_admissions cascade', 'truncate gov_repo.l14_policy_version_admissions',
    ]) await rejects(owner(statement), '55000', /L14_HISTORY_IMMUTABLE/);
    for (const set of [`owner_user_id='${x.author.id}'`, `title='Renamed'`, `policy_code='IM-Q'`, `policy_type='risk'`, `description='free text'`,
      `parent_policy_id='${p.policy_id}'`]) {
      await rejects(owner(`update gov_repo.governance_policies set ${set} where policy_id='${p.policy_id}'`), '55000', /M16_ADMITTED_DESCRIPTOR/);
    }
    for (const statement of [`update gov_repo.policy_versions set change_summary='x' where version_id='${v.version_id}'`,
      `delete from gov_repo.policy_versions where version_id='${v.version_id}'`, `delete from gov_repo.governance_policies where policy_id='${p.policy_id}'`]) {
      await rejects(owner(statement), '55000', /POLICY_STORE_HISTORY_IMMUTABLE/);
    }
    // A never-admitted legacy row keeps its legacy (non-authoritative) mutability, and still confers no admission.
    const legacy = await k.legacyPolicy(x.org, x.boot.id, 'IM-LEGACY', false);
    await owner(`update gov_repo.governance_policies set title='Legacy renamed', owner_user_id=null where policy_id='${legacy.policyId}'`);
    assert.equal(await one(`select count(*) from gov_repo.l14_policy_admissions where policy_id='${legacy.policyId}'`), '0');
  });

  await t.test('structural guards: lineage cannot be fabricated for a legacy row, a DENY, a reused authorization or a mismatched expectation', async () => {
    const x = await k.setup();
    const legacy = await k.legacyPolicy(x.org, x.boot.id, 'SG-LEGACY');
    const denied = await exec(k.admitPolicySql(x.member, { commandId: x.cmd('sg-deny'), descriptor: k.descriptor('SG-DENY') }));
    const p = await exec(k.admitPolicySql(x.author, { commandId: x.cmd('sg-p'), descriptor: k.descriptor('SG-P') }));
    const v = await exec(k.admitVersionSql(x.author, { commandId: x.cmd('sg-v'), policyId: p.policy_id, content: '# sg' }));
    const insertAdmission = (policyId: string, authzId: string, actor = x.author.id) => owner(`begin;
      insert into gov_repo.l14_policy_admissions(organisation_id,policy_id,admission_authorization_decision_id,source_class,support_status,admitted_by_actor_user_id,recorded_at)
      select '${x.org}','${policyId}','${authzId}','LOCAL_HUMAN','NONE','${actor}',evaluated_at from gov_repo.l14_authorization_decisions where authorization_decision_id='${authzId}';
      rollback;`);
    // The BEFORE INSERT guard runs before any FK / unique check: a DENY, a version's authorization, or a genuine policy
    // ALLOW re-pointed at a legacy row (legacy owner set, descriptor differs) are all refused with a closed reason.
    await rejects(insertAdmission(legacy.policyId, denied.authorization_decision_id), 'GV010', /POLICY_ADMISSION_AUTHORIZATION_MISMATCH/);
    await rejects(insertAdmission(legacy.policyId, v.authorization_decision_id), 'GV010', /POLICY_ADMISSION_AUTHORIZATION_MISMATCH/);
    await rejects(insertAdmission(legacy.policyId, p.authorization_decision_id), 'GV010', /POLICY_ADMISSION_CONTENT_MISMATCH/);
    // A legacy version under an admitted policy cannot be grafted into the lineage (wrong authorization / expectation /
    // non-constant change_summary).
    const stray = await one(`insert into gov_repo.policy_versions(organisation_id,policy_id,version_number,version_label,content_markdown,change_summary,created_by)
      values('${x.org}','${p.policy_id}',5,'5.0','# stray','legacy','${x.author.id}') returning version_id`);
    const graft = (authzId: string, predecessor: string | null) => owner(`begin;
      insert into gov_repo.l14_policy_version_admissions(organisation_id,policy_id,version_id,content_hash,predecessor_version_id,admission_authorization_decision_id,
        source_class,support_status,admitted_by_actor_user_id,recorded_at)
      select '${x.org}','${p.policy_id}','${stray}',(select content_hash from gov_repo.policy_versions where version_id='${stray}'),
        ${predecessor === null ? 'null' : `'${predecessor}'`}, a.authorization_decision_id,'LOCAL_HUMAN','NONE',a.actor_user_id,a.evaluated_at
        from gov_repo.l14_authorization_decisions a where a.authorization_decision_id='${authzId}';
      rollback;`);
    await rejects(graft(p.authorization_decision_id, v.version_id), 'GV010', /POLICY_VERSION_ADMISSION_AUTHORIZATION_MISMATCH/);
    await rejects(graft(v.authorization_decision_id, null), 'GV010', /POLICY_VERSION_ADMISSION_AUTHORIZATION_MISMATCH/);
    assert.equal(await one(`select count(*) from gov_repo.l14_policy_admissions where policy_id='${legacy.policyId}'`), '0');
  });
});
