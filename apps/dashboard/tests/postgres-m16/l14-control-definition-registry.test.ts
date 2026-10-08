import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { controlDefinitionContentHash, decideControlDefinitionProposalFingerprint } from '@council/governance-review';
import { newAgent } from '../helpers/m16-definer-surface-fixtures';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { controlDefinitionKit } from '../helpers/m16-l14-control-definition-fixtures';

/**
 * M16-S1B.6 — CONTROL_DEFINITION governed-registry lifecycle on real disposable PostgreSQL 17 (S1B6 horizon). Every
 * command goes through the real public RPCs as service_role; every Authority Policy through the real AP RPCs. Owner
 * access is used only to read evidence, to seed legacy CG-AG rows and for rolled-back structural probes.
 */
test('M16 S1B.6 control definition registry lifecycle (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B6' });
  t.after(() => c.stop());
  const { owner, exec, rejects } = c;
  const k = await controlDefinitionKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const row = async (query: string) => JSON.parse(await one(`select coalesce((${query}), 'null'::json)`));
  const authz = (id: string) => row(`select to_json(a) from gov_repo.l14_authorization_decisions a where authorization_decision_id='${id}'`);
  const envelope = (id: string) => row(`select to_json(s) from gov_repo.l14_registry_states s where state_id='${id}'`);
  const version = (id: string) => row(`select to_json(v) from gov_repo.l14_control_definition_versions v where control_definition_version_id='${id}'`);
  const ts = (value: string) => `'${value}'::timestamptz`;
  const ctx = await k.setup();

  // ---------------------------------------------------------------------------------------
  await t.test('first ADMIT: caller ids preserved verbatim, DB content hash, stable identity created; no decision / state / head / trust', async () => {
    const cdid = randomUUID(), vid = randomUUID();
    const content = { controlCode: 'AC-01', title: 'Access review', description: 'Quarterly access review.\n\tIncludes service accounts.' };
    await c.evidence(ctx.org, 'adm-ev-1');
    const before = await k.counts(ctx.org);
    const r = await exec(k.admitSql(ctx.registrar, { commandId: ctx.cmd('adm-1'), controlDefinitionId: cdid, versionId: vid, content,
      support: { status: 'PRESENT', evidenceIds: ['adm-ev-1'] } }));
    const hash = controlDefinitionContentHash(content);
    assert.deepEqual([r.outcome, r.command_kind, r.subject_kind, r.control_definition_id, r.control_definition_version_id, r.predecessor_version_id,
      r.content_hash, r.attempted_content_hash, r.expectation_kind, r.expected_latest_version_id, r.replay, r.authorization_result, r.proposal_id,
      r.governance_decision_id, r.registry_state_id], ['ADMITTED', 'ADMIT_CONTROL_DEFINITION_VERSION', 'CONTROL_DEFINITION', cdid, vid, null,
      hash, hash, 'EXPECTED_NONE', null, false, 'ALLOW', null, null, null]);
    const identity = await row(`select to_json(d) from gov_repo.l14_control_definitions d where control_definition_id='${cdid}'`);
    assert.deepEqual([identity.organisation_id, identity.admission_authorization_decision_id], [ctx.org, r.authorization_decision_id]);
    const v = await version(vid);
    assert.deepEqual({ cdid: v.control_definition_id, code: v.control_code, title: v.title, description: v.description, hash: v.content_hash,
      pred: v.predecessor_version_id, src: v.source_class, by: v.admitted_by_actor_user_id, support: v.support_status },
    { cdid, code: content.controlCode, title: content.title, description: content.description, hash, pred: null, src: 'LOCAL_HUMAN',
      by: ctx.registrar.id, support: 'PRESENT' });
    assert.equal(await one(`select gov_repo.l14_control_definition_content_hash_v1(${['AC-01', 'Access review', content.description]
      .map(s => `'${s.replace(/'/g, "''")}'`).join(',')})`), hash, 'PostgreSQL and the TypeScript mirror frame identically');
    const a = await authz(r.authorization_decision_id);
    assert.deepEqual({ action: a.requested_action, subject: a.subject_kind, scope: a.scope_tag, exp: a.expectation_kind, hash: a.attempted_content_hash,
      basis: a.basis_version_id }, { action: 'ADMIT', subject: 'CONTROL_DEFINITION', scope: 'ALL_ALLOWED_TARGETS', exp: 'EXPECTED_NONE', hash,
      basis: ctx.v1.version_id });
    assert.equal(await one(`select string_agg(permission||'/'||requested_action, ',') from gov_repo.l14_authorization_decision_rules
      where authorization_decision_id='${r.authorization_decision_id}'`), 'L14_CONTROL_DEFINITION_ADMIT/ADMIT');
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where owner_kind='ADMISSION'
      and admission_authorization_decision_id='${r.authorization_decision_id}' and admission_subject_kind='CONTROL_DEFINITION'`), '1');
    const after = await k.counts(ctx.org);
    assert.equal(after.l14_control_definitions, before.l14_control_definitions + 1);
    assert.equal(after.l14_control_definition_versions, before.l14_control_definition_versions + 1);
    for (const table of ['l14_proposals', 'l14_governance_decisions', 'l14_registry_states', 'l14_control_definition_states',
      'l14_control_definition_proposals', 'l14_control_definition_heads']) {
      assert.equal(after[table], before[table], `${table}: admission is not validation`);
    }
    assert.equal(await k.resolve(ctx.org, { controlDefinitionId: cdid, controlDefinitionVersionId: vid, contentHash: hash },
      'clock_timestamp()', 'clock_timestamp()'), null, 'ADMITTED != VALIDATED');
  });

  await t.test('content hash: a wrong caller hash never becomes authority (GV010, nothing consumed); owner-level forged hashes are rejected', async () => {
    const before = await k.counts(ctx.org);
    const content = k.content('hash');
    const other = k.content('hash-other');
    await rejects(c.svc(k.admitSql(ctx.registrar, { commandId: ctx.cmd('hash-1'), controlDefinitionId: randomUUID(), versionId: randomUUID(),
      content, contentHash: controlDefinitionContentHash(other) })), 'GV010', /CONTENT_HASH_MISMATCH/);
    await rejects(c.svc(k.admitSql(ctx.registrar, { commandId: ctx.cmd('hash-2'), controlDefinitionId: randomUUID(), versionId: randomUUID(),
      content, contentHash: 'A'.repeat(64) })), 'GV010', /CONTENT_HASH_MALFORMED/);
    assert.deepEqual(await k.counts(ctx.org), before);
    // Even the owner cannot store a version whose content does not hash to its stored (authorized) hash: re-insert an exact
    // admitted row with one changed title in a rolled-back owner transaction.
    const { version: v } = await k.admitFirst(ctx, 'hash-ok');
    await assert.rejects(c.bootstrapSql(`begin;
      create temp table s1b6_probe on commit drop as select * from gov_repo.l14_control_definition_versions where control_definition_version_id='${v.controlDefinitionVersionId}';
      alter table gov_repo.l14_control_definition_versions disable trigger l14_control_definition_versions_immutable;
      delete from gov_repo.l14_control_definition_versions where control_definition_version_id='${v.controlDefinitionVersionId}';
      alter table gov_repo.l14_control_definition_versions enable always trigger l14_control_definition_versions_immutable;
      insert into gov_repo.l14_control_definition_versions select organisation_id,control_definition_id,control_definition_version_id,control_code,
        title||' (edited)',description,content_hash,predecessor_version_id,admission_authorization_decision_id,admission_authorization_result,
        admission_subject_kind,admission_requested_action,source_class,support_status,admitted_by_actor_user_id,recorded_at from s1b6_probe;
      rollback;`), /CONTROL_DEFINITION_VERSION_CONTENT_HASH_MISMATCH/);
    assert.equal((await version(v.controlDefinitionVersionId)).title, v.content.title, 'rolled back');
  });

  let chain: { v1: any; v2: any } | null = null;
  await t.test('successor version: same stable identity, explicit expected-latest pin, linear lineage; stale / blind / NONE-over-existing rejected', async () => {
    const { version: v1 } = await k.admitFirst(ctx, 'chain');
    const c2 = k.content('chain', { controlCode: 'CTRL-chain-renamed', title: 'Control chain v2' });
    const { r: r2, version: v2 } = await k.admitNext(ctx, 'chain-v2', v1, c2);
    assert.deepEqual([r2.outcome, r2.control_definition_id, r2.control_definition_version_id, r2.predecessor_version_id, r2.expectation_kind,
      r2.expected_latest_version_id], ['ADMITTED', v1.controlDefinitionId, v2.controlDefinitionVersionId, v1.controlDefinitionVersionId,
      'EXPECTED_CURRENT', v1.controlDefinitionVersionId]);
    assert.notEqual(v2.contentHash, v1.contentHash, 'control_code changes only through a new version (new hash)');
    assert.equal(await one(`select count(*) from gov_repo.l14_control_definitions where control_definition_id='${v1.controlDefinitionId}'`), '1',
      'one stable identity across versions');
    assert.equal((await version(v1.controlDefinitionVersionId)).control_code, 'CTRL-chain', 'the first version content is unchanged');
    const before = await k.counts(ctx.org);
    // Stale expectation (pins v1 although v2 is latest), expected-none over an existing identity, expected-current on an unknown identity.
    await rejects(c.svc(k.admitSql(ctx.registrar, { commandId: ctx.cmd('chain-stale'), controlDefinitionId: v1.controlDefinitionId, versionId: randomUUID(),
      content: k.content('stale'), expectation: { kind: 'EXPECTED_CURRENT', latestVersionId: v1.controlDefinitionVersionId } })),
    'GV009', /CONTROL_DEFINITION_VERSION_EXPECTATION_MISMATCH/);
    await rejects(c.svc(k.admitSql(ctx.registrar, { commandId: ctx.cmd('chain-none'), controlDefinitionId: v1.controlDefinitionId, versionId: randomUUID(),
      content: k.content('none') })), 'GV009', /CONTROL_DEFINITION_EXISTS/);
    await rejects(c.svc(k.admitSql(ctx.registrar, { commandId: ctx.cmd('chain-unknown'), controlDefinitionId: randomUUID(), versionId: randomUUID(),
      content: k.content('unknown'), expectation: { kind: 'EXPECTED_CURRENT', latestVersionId: v2.controlDefinitionVersionId } })),
    'GV009', /CONTROL_DEFINITION_VERSION_EXPECTATION_MISMATCH/);
    // A blind / incoherent expectation is never accepted.
    for (const [name, kind, latest] of [['blind', 'EXPECTED_CURRENT', null], ['none-with-id', 'EXPECTED_NONE', v2.controlDefinitionVersionId],
      ['unknown-kind', 'LATEST', null], ['null-kind', null, null]] as const) {
      await rejects(c.svc(k.admitSql(ctx.registrar, { commandId: ctx.cmd(`chain-${name}`), controlDefinitionId: v1.controlDefinitionId,
        versionId: randomUUID(), content: k.content(name), rawExpectationKind: kind, rawExpectedLatest: latest, fingerprint: 'f'.repeat(64) })),
      'GV010', /EXPECTATION_MALFORMED/);
    }
    assert.deepEqual(await k.counts(ctx.org), before, 'nothing consumed');
    assert.equal(await one(`select string_agg(control_definition_version_id::text||'<'||coalesce(predecessor_version_id::text,'-'), ',' order by recorded_at)
      from gov_repo.l14_control_definition_versions where control_definition_id='${v1.controlDefinitionId}'`),
    `${v1.controlDefinitionVersionId}<-,${v2.controlDefinitionVersionId}<${v1.controlDefinitionVersionId}`);
    // An identity is never created by a successor's (EXPECTED_CURRENT) authorization, nor without its root version; a
    // version can never commit without its identity (deferred FK).
    await assert.rejects(c.bootstrapSql(`begin; insert into gov_repo.l14_control_definitions(organisation_id,control_definition_id,admission_authorization_decision_id,recorded_at)
      select organisation_id, gen_random_uuid(), authorization_decision_id, evaluated_at from gov_repo.l14_authorization_decisions
      where authorization_decision_id='${r2.authorization_decision_id}'; rollback;`), /CONTROL_DEFINITION_IDENTITY_AUTHORIZATION_MISMATCH/);
    assert.equal(await one(`select count(*) from gov_repo.l14_control_definitions where admission_authorization_decision_id='${r2.authorization_decision_id}'`), '0');
    assert.equal(await one(`select condeferrable::text||'|'||condeferred::text from pg_constraint where conname='l14_control_definition_versions_identity_fkey'`),
      'true|true');
    chain = { v1, v2 };
  });

  await t.test('version id reuse: duplicate id (same or changed content, same or other identity) is rejected; ids are tenant scoped', async () => {
    assert.ok(chain);
    const { v1, v2 } = chain!;
    const before = await k.counts(ctx.org);
    for (const [name, cdid, versionId, content, expectation] of [
      ['same-content', v1.controlDefinitionId, v1.controlDefinitionVersionId, v1.content, { kind: 'EXPECTED_CURRENT', latestVersionId: v2.controlDefinitionVersionId }],
      ['changed-content', v1.controlDefinitionId, v1.controlDefinitionVersionId, k.content('changed'), { kind: 'EXPECTED_CURRENT', latestVersionId: v2.controlDefinitionVersionId }],
      ['other-identity', randomUUID(), v2.controlDefinitionVersionId, v2.content, { kind: 'EXPECTED_NONE' }],
      ['other-identity-changed', randomUUID(), v1.controlDefinitionVersionId, k.content('changed-2'), { kind: 'EXPECTED_NONE' }],
    ] as const) {
      await rejects(c.svc(k.admitSql(ctx.registrar, { commandId: ctx.cmd(`dup-${name}`), controlDefinitionId: cdid,
        versionId, content, expectation: expectation as never })), 'GV009', /CONTROL_DEFINITION_VERSION_ID_EXISTS/);
    }
    // Pinning the new version id as its own expected latest is never a legal expectation.
    await rejects(c.svc(k.admitSql(ctx.registrar, { commandId: ctx.cmd('dup-self-expect'), controlDefinitionId: v1.controlDefinitionId,
      versionId: v2.controlDefinitionVersionId, content: v2.content, rawExpectationKind: 'EXPECTED_CURRENT',
      rawExpectedLatest: v2.controlDefinitionVersionId, fingerprint: 'f'.repeat(64) })), 'GV010', /EXPECTATION_MALFORMED/);
    assert.deepEqual(await k.counts(ctx.org), before);
    assert.equal((await version(v2.controlDefinitionVersionId)).control_code, v2.content.controlCode, 'stored content unchanged');
    // The same caller-supplied ids in another tenant are a different identity.
    const other = await k.setup();
    const r = await exec(k.admitSql(other.registrar, { commandId: other.cmd('tenant'), controlDefinitionId: v1.controlDefinitionId,
      versionId: v1.controlDefinitionVersionId, content: v1.content }));
    assert.equal(r.outcome, 'ADMITTED');
    assert.equal(await one(`select count(*) from gov_repo.l14_control_definition_versions where control_definition_version_id='${v1.controlDefinitionVersionId}'`), '2');
    // Identity id and version id are distinct values.
    const same = randomUUID();
    await rejects(c.svc(k.admitSql(ctx.registrar, { commandId: ctx.cmd('dup-self'), controlDefinitionId: same, versionId: same,
      content: k.content('self'), fingerprint: 'f'.repeat(64) })), 'GV010', /CONTROL_DEFINITION_IDS_REQUIRED/);
  });

  await t.test('ADMIT shape: bounded content, closed source vocabulary; SYSTEM_SEED / SOURCE_CONNECTION never masquerade as LOCAL_HUMAN', async () => {
    const before = await k.counts(ctx.org);
    const fp = 'f'.repeat(64);
    const base = k.content('shape');
    for (const [name, input, detail] of [
      ['code empty', { content: { ...base, controlCode: '' } }, /CONTROL_CODE_MALFORMED/],
      ['code padded', { content: { ...base, controlCode: ' X' } }, /CONTROL_CODE_MALFORMED/],
      ['code newline', { content: { ...base, controlCode: 'A\nB' } }, /CONTROL_CODE_MALFORMED/],
      ['code long', { content: { ...base, controlCode: 'c'.repeat(129) } }, /CONTROL_CODE_MALFORMED/],
      ['title control', { content: { ...base, title: 'T\u0001' } }, /CONTROL_TITLE_MALFORMED/],
      ['title long', { content: { ...base, title: 't'.repeat(513) } }, /CONTROL_TITLE_MALFORMED/],
      ['description empty', { content: { ...base, description: '' } }, /CONTROL_DESCRIPTION_MALFORMED/],
      ['description trailing newline', { content: { ...base, description: 'd\n' } }, /CONTROL_DESCRIPTION_MALFORMED/],
      ['description CR', { content: { ...base, description: 'a\rb' } }, /CONTROL_DESCRIPTION_MALFORMED/],
      ['description long', { content: { ...base, description: 'd'.repeat(8193) } }, /CONTROL_DESCRIPTION_MALFORMED/],
      ['source', { content: base, sourceClass: 'SCANNER' }, /SOURCE_CLASS_UNKNOWN/],
      ['seed', { content: base, sourceClass: 'SYSTEM_SEED' }, /SOURCE_CLASS_NOT_EXECUTABLE/],
      ['connection', { content: base, sourceClass: 'SOURCE_CONNECTION' }, /SOURCE_CLASS_NOT_EXECUTABLE/],
    ] as const) {
      await rejects(c.svc(k.admitSql(ctx.registrar, { commandId: ctx.cmd(`shape-${name}`), controlDefinitionId: randomUUID(), versionId: randomUUID(),
        contentHash: 'a'.repeat(64), fingerprint: fp, ...input } as never)), 'GV010', detail);
    }
    const max = { controlCode: 'c'.repeat(128), title: 'é'.repeat(512), description: `${'d'.repeat(4000)}\n\t${'e'.repeat(4190)}` };
    assert.equal((await k.admitFirst(ctx, 'shape-max', max)).r.outcome, 'ADMITTED', 'the exact bounds are legal (characters, not bytes)');
    assert.equal((await k.counts(ctx.org)).l14_authorization_decisions, before.l14_authorization_decisions + 1);
  });

  await t.test('unauthorized ADMIT is a durable DENY that admits nothing; no effective Authority Policy denies durably', async () => {
    const cdid = randomUUID(), vid = randomUUID(), content = k.content('deny');
    for (const [actor, name, reason] of [
      [ctx.member, 'member', 'NO_MATCHING_AUTHORITY_RULE'], [ctx.steward, 'steward', 'NO_MATCHING_AUTHORITY_RULE'],
      [ctx.domain, 'domain', 'NO_MATCHING_AUTHORITY_RULE'], [ctx.boot, 'admin', 'NO_MATCHING_AUTHORITY_RULE'],
      [ctx.contrib, 'contrib', 'SOURCE_NOT_AUTHORIZED'],
    ] as const) {
      const r = await exec(k.admitSql(actor, { commandId: ctx.cmd(`deny-${name}`), controlDefinitionId: cdid, versionId: vid, content }));
      assert.deepEqual([r.outcome, r.authorization_result, r.deny_reason, r.control_definition_id, r.control_definition_version_id, r.content_hash,
        r.attempted_content_hash], ['DENIED', 'DENY', reason, null, null, null, controlDefinitionContentHash(content)], name);
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_control_definitions where control_definition_id='${cdid}'`), '0');
    assert.equal((await exec(k.admitSql(ctx.registrar, { commandId: ctx.cmd('deny-ok'), controlDefinitionId: cdid, versionId: vid, content }))).outcome,
      'ADMITTED', 'the denied ids stay available');
    const bare = await k.setup(undefined, { bootstrap: false });
    const r = await exec(k.admitSql(bare.registrar, { commandId: bare.cmd('noap'), controlDefinitionId: randomUUID(), versionId: randomUUID(), content }));
    assert.deepEqual([r.outcome, r.deny_reason], ['DENIED', 'NO_EFFECTIVE_AUTHORITY']);
    assert.equal((await authz(r.authorization_decision_id)).authority_basis, null);
  });

  await t.test('SUBMIT pins the exact admitted tuple; no authority / decision / state / head; unadmitted, mismatched, foreign and laundered tuples rejected', async () => {
    const v = await k.admitted(ctx, 'sub');
    await c.evidence(ctx.org, 'sub-ev-1');
    const before = await k.counts(ctx.org);
    const r = await exec(k.submitSql(ctx.member, { commandId: ctx.cmd('sub-1'), proposal: k.validateProposal(v),
      support: { status: 'PRESENT', evidenceIds: ['sub-ev-1'] } }));
    assert.deepEqual([r.outcome, r.command_kind, r.subject_kind, r.control_definition_id, r.control_definition_version_id, r.content_hash,
      r.authorization_decision_id, r.governance_decision_id, r.registry_state_id],
    ['SUBMITTED', 'SUBMIT_PROPOSAL', 'CONTROL_DEFINITION', v.controlDefinitionId, v.controlDefinitionVersionId, v.contentHash, null, null, null]);
    const detail = await row(`select to_json(t) from gov_repo.l14_control_definition_proposals t where proposal_id='${r.proposal_id}'`);
    assert.deepEqual([detail.intent, detail.control_definition_id, detail.control_definition_version_id, detail.content_hash,
      detail.requested_effective_from, detail.target_state_id], ['VALIDATE', v.controlDefinitionId, v.controlDefinitionVersionId, v.contentHash, null, null]);
    const after = await k.counts(ctx.org);
    for (const table of ['l14_authorization_decisions', 'l14_governance_decisions', 'l14_registry_states', 'l14_control_definition_states',
      'l14_control_definition_heads']) {
      assert.equal(after[table], before[table], `${table}: a proposal is not validation authority`);
    }
    const foreign = await k.setup();
    const fv = await k.admitted(foreign, 'fx');
    const sibling = await k.admitted(ctx, 'sub-sibling');
    const mid = await k.counts(ctx.org);
    for (const [name, subject] of [
      ['never admitted', { controlDefinitionId: randomUUID(), controlDefinitionVersionId: randomUUID(), contentHash: v.contentHash }],
      ['hash mismatch', { ...v, contentHash: controlDefinitionContentHash(k.content('other')) }],
      ['version of another identity', { ...v, controlDefinitionVersionId: sibling.controlDefinitionVersionId }],
      ['identity of another version', { ...v, controlDefinitionId: sibling.controlDefinitionId }],
      ['foreign tenant', fv],
    ] as const) {
      await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd(`sub-${name}`), proposal: k.validateProposal(subject as never) })),
        'GV010', /CONTROL_DEFINITION_VERSION_NOT_ADMITTED/);
    }
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('sub-src'), proposal: { ...k.validateProposal(v), sourceClass: 'SOURCE_CONNECTION' } })),
      'GV010', /SOURCE_CLASS_NOT_EXECUTABLE/);
    assert.deepEqual(await k.counts(ctx.org), mid);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('sub-session'), proposal: k.validateProposal(v), session: { org: foreign.org } })), 'GV003');
    // Owner-level laundering: a SYSTEM_SEED envelope over a LOCAL_HUMAN version cannot gain typed detail.
    await assert.rejects(c.bootstrapSql(`begin; insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
      values('${ctx.org}','11111111-1111-4111-8111-111111111111','CONTROL_DEFINITION','VALIDATE','SYSTEM_SEED','${ctx.member.id}','NONE',now());
      insert into gov_repo.l14_control_definition_proposals(organisation_id,proposal_id,intent,control_definition_id,control_definition_version_id,content_hash)
      values('${ctx.org}','11111111-1111-4111-8111-111111111111','VALIDATE','${v.controlDefinitionId}','${v.controlDefinitionVersionId}','${v.contentHash}'); rollback;`),
    /CONTROL_DEFINITION_PROPOSAL_SOURCE_MISMATCH/);
  });

  let lifecycle: { v: any; s1: string } | null = null;
  await t.test('first VALIDATE: state pins the exact (identity, version, hash) tuple; L14_CONTROL_DEFINITION_VALIDATE over CURRENT roles + effective AP', async () => {
    const v = await k.admitted(ctx, 'val');
    await c.evidence(ctx.org, 'val-ev-1');
    const proposal = k.validateProposal(v);
    const submitted = await k.submit(ctx, ctx.member, 'val-submit', proposal);
    for (const code of ['BUSINESS_DOMAIN_VALIDATED', 'POLICY_VERSION_VALIDATED', 'CONTROL_DEFINITION_REJECTED']) {
      await rejects(c.svc(k.decideSql(ctx.steward, { commandId: ctx.cmd(`val-code-${code}`), proposalId: submitted.proposal_id, proposal,
        reasonCode: code, fingerprint: 'f'.repeat(64) })), 'GV010', /DECISION_VOCABULARY_INVALID/);
    }
    const r = await exec(k.decideSql(ctx.steward, { commandId: ctx.cmd('val-validate'), proposalId: submitted.proposal_id, proposal,
      support: { status: 'PRESENT', evidenceIds: ['val-ev-1'] } }));
    assert.deepEqual([r.outcome, r.state_kind, r.subject_kind, r.control_definition_id, r.control_definition_version_id, r.content_hash,
      r.authorization_result, r.deny_reason], ['VALIDATED', 'VALIDATED', 'CONTROL_DEFINITION', v.controlDefinitionId,
      v.controlDefinitionVersionId, v.contentHash, 'ALLOW', null]);
    const st = await row(`select to_json(d) from gov_repo.l14_control_definition_states d where state_id='${r.registry_state_id}'`);
    assert.deepEqual([st.state_kind, st.control_definition_id, st.control_definition_version_id, st.content_hash, st.predecessor_state_id,
      st.revokes_state_id], ['VALIDATED', v.controlDefinitionId, v.controlDefinitionVersionId, v.contentHash, null, null]);
    const env = await envelope(r.registry_state_id);
    assert.deepEqual({ subject: env.subject_kind, trust: env.trust_state, source: env.source_class, decision: env.governance_decision_id,
      authz: env.authorization_decision_id, basis: env.authority_policy_version_id, support: env.support_status },
    { subject: 'CONTROL_DEFINITION', trust: 'VALIDATED', source: 'LOCAL_HUMAN', decision: r.governance_decision_id,
      authz: r.authorization_decision_id, basis: ctx.v1.version_id, support: 'PRESENT' });
    const a = await authz(r.authorization_decision_id);
    assert.deepEqual({ action: a.requested_action, subject: a.subject_kind, exp: a.expectation_kind, self: a.is_self_validation, proposal: a.proposal_id },
      { action: 'VALIDATE', subject: 'CONTROL_DEFINITION', exp: 'EXPECTED_NONE', self: false, proposal: submitted.proposal_id });
    assert.equal(await one(`select string_agg(permission||'/'||requested_action||'/'||source_class||'/'||source_disposition||'/'||scope_tag, ',')
      from gov_repo.l14_authorization_decision_rules where authorization_decision_id='${r.authorization_decision_id}'`),
    'L14_CONTROL_DEFINITION_VALIDATE/VALIDATE/LOCAL_HUMAN/AUTHORITATIVE/ALL_ALLOWED_TARGETS');
    assert.equal(await one(`select string_agg(role_id::text, ',') from gov_repo.l14_authorization_decision_roles where authorization_decision_id='${r.authorization_decision_id}'`),
      k.stewardRole);
    assert.equal(await one(`select reason_code from gov_repo.l14_governance_decisions where governance_decision_id='${r.governance_decision_id}'`),
      'CONTROL_DEFINITION_VALIDATED');
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where evidence_id='val-ev-1' and
      ((owner_kind='GOVERNANCE_DECISION' and governance_decision_id='${r.governance_decision_id}') or (owner_kind='REGISTRY_STATE' and registry_state_id='${r.registry_state_id}'))`), '2');
    const h = await k.head(ctx.org, v);
    assert.deepEqual([h!.latest_state_id, h!.content_hash], [r.registry_state_id, v.contentHash]);
    assert.equal(await k.resolve(ctx.org, v, 'clock_timestamp()', 'clock_timestamp()'), r.registry_state_id);
    // Exactness: a different hash / version / tenant never resolves this state.
    assert.equal(await k.resolve(ctx.org, { ...v, contentHash: 'b'.repeat(64) }, 'clock_timestamp()', 'clock_timestamp()'), null);
    assert.equal(await k.resolve(ctx.org, { ...v, controlDefinitionVersionId: randomUUID() }, 'clock_timestamp()', 'clock_timestamp()'), null);
    assert.equal(await k.resolve(randomUUID(), v, 'clock_timestamp()', 'clock_timestamp()'), null);
    // A control validation validates nothing else: no applicability / assignment / assessment / canonical object.
    assert.equal(await one(`select count(*) from gov_repo.l14_proposals where organisation_id='${ctx.org}'
      and subject_kind not in ('CONTROL_DEFINITION','AUTHORITY_POLICY_VERSION')`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_registry_states where organisation_id='${ctx.org}' and subject_kind <> 'CONTROL_DEFINITION'`), '0');
    assert.equal(await one(`select count(*) from gov_repo.canonical_objects where organisation_id='${ctx.org}'`), '0');
    assert.equal(await one(`select count(*) from pg_class where relnamespace='gov_repo'::regnamespace
      and relname ~ '(applicability|assessment|assignment|coverage|maturity|risk_score|control_score)' and relname like 'l14\\_%'`), '0',
    'no applicability / assessment / score structure exists');
    lifecycle = { v, s1: r.registry_state_id };
  });

  await t.test('ADMITTED != VALIDATED: a second admitted version neither validates itself nor revokes / replaces the first', async () => {
    assert.ok(lifecycle);
    const { v, s1 } = lifecycle!;
    const before = await k.historyDigest(ctx.org);
    const headBefore = await k.head(ctx.org, v);
    const { version: v2 } = await k.admitNext(ctx, 'val-v2', v, k.content('val', { title: 'Control val, revised' }));
    assert.equal(await k.resolve(ctx.org, v2, 'clock_timestamp()', 'clock_timestamp()'), null, 'the new version is not validated');
    assert.equal(await k.resolve(ctx.org, v, 'clock_timestamp()', 'clock_timestamp()'), s1, 'the first version stays validated');
    assert.deepEqual(await k.head(ctx.org, v), headBefore, 'the first version head is unchanged');
    assert.equal(await k.head(ctx.org, v2), null, 'no head for an unvalidated version');
    assert.equal(await one(`select count(*) from gov_repo.l14_control_definition_states where control_definition_id='${v.controlDefinitionId}'`), '1');
    assert.equal(await one(`select count(*) from gov_repo.l14_registry_states where organisation_id='${ctx.org}' and recorded_at >
      (select recorded_at from gov_repo.l14_registry_states where state_id='${s1}')`), '0', 'admission wrote no state at all');
    assert.notEqual(await k.historyDigest(ctx.org), before);
    // Both versions may be VALIDATED at once: each exact tuple has its own lineage; nothing selects a "current" one.
    const val2 = await k.validate(ctx, 'val-v2', v2);
    assert.equal(val2.decided.outcome, 'VALIDATED');
    assert.equal(await k.resolve(ctx.org, v, 'clock_timestamp()', 'clock_timestamp()'), s1);
    assert.equal(await k.resolve(ctx.org, v2, 'clock_timestamp()', 'clock_timestamp()'), val2.decided.registry_state_id);
    assert.equal(await one(`select count(*) from information_schema.columns where table_schema='gov_repo' and table_name like 'l14\\_control%'
      and column_name ~ '(current|latest_version|effective_version)'`), '0', 'no implicit current governed version pointer');
  });

  await t.test('REJECT = decision without state; DEFER is non-terminal; a terminal proposal is never reused; correction = new linked proposal', async () => {
    const v = await k.admitted(ctx, 'rd');
    const proposal = k.validateProposal(v);
    const p1 = await k.submit(ctx, ctx.member, 'rd-p1', proposal);
    const deferred = await exec(k.decideSqlFor(ctx.steward, ctx.cmd('rd-defer'), p1.proposal_id, proposal, 'DEFER', null));
    assert.deepEqual([deferred.outcome, deferred.registry_state_id], ['DEFERRED', null]);
    const rejected = await exec(k.decideSqlFor(ctx.steward, ctx.cmd('rd-reject'), p1.proposal_id, proposal, 'REJECT', null));
    assert.deepEqual([rejected.outcome, rejected.registry_state_id, rejected.state_kind], ['REJECTED', null, null]);
    assert.equal(await one(`select string_agg(outcome||':'||reason_code, ',' order by decided_at) from gov_repo.l14_governance_decisions where proposal_id='${p1.proposal_id}'`),
      'DEFER:CONTROL_DEFINITION_DEFERRED,REJECT:CONTROL_DEFINITION_REJECTED');
    assert.equal(await k.head(ctx.org, v), null, 'no state, no head');
    for (const outcome of ['VALIDATE', 'REJECT', 'DEFER'] as const) {
      await rejects(c.svc(k.decideSqlFor(ctx.steward, ctx.cmd(`rd-again-${outcome}`), p1.proposal_id, proposal, outcome, null)), 'GV010', /PROPOSAL_TERMINAL/);
    }
    await rejects(c.svc(k.decideSqlFor(ctx.steward, ctx.cmd('rd-revoke-on-validate'), p1.proposal_id, proposal, 'REVOKE', null)), 'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
    const other = await k.admitted(ctx, 'rd-other');
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rd-bad-prior'), proposal: k.validateProposal(other), prior: p1.proposal_id })),
      'GV010', /PRIOR_PROPOSAL_UNRESOLVED/);
    const p2 = await k.submit(ctx, ctx.member, 'rd-p2', proposal, p1.proposal_id);
    assert.equal(await one(`select prior_proposal_id from gov_repo.l14_proposals where proposal_id='${p2.proposal_id}'`), p1.proposal_id);
    assert.equal((await exec(k.decideSqlFor(ctx.steward, ctx.cmd('rd-validate-p2'), p2.proposal_id, proposal, 'VALIDATE', null))).outcome, 'VALIDATED');
    const apProposal = await one(`select proposal_id from gov_repo.l14_proposals where organisation_id='${ctx.org}' and subject_kind='AUTHORITY_POLICY_VERSION' limit 1`);
    await rejects(c.svc(k.decideSqlFor(ctx.steward, ctx.cmd('rd-ap'), apProposal, proposal, 'VALIDATE', null)), 'GV010', /PROPOSAL_UNRESOLVED/);
  });

  await t.test('REVOKE pins the exact VALIDATED state of the same tuple, appends a tombstone, never mutates the target; history immutable', async () => {
    assert.ok(lifecycle);
    const { v, s1 } = lifecycle!;
    const targetRow = await one(`select s::text||'|'||d::text from gov_repo.l14_registry_states s join gov_repo.l14_control_definition_states d using (organisation_id, state_id) where state_id='${s1}'`);
    const other = await k.admitted(ctx, 'rv-other');
    const ov = await k.validate(ctx, 'rv-other', other);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rv-cross'), proposal: k.revokeProposal(v, ov.decided.registry_state_id) })),
      'GV010', /TARGET_STATE_UNRESOLVED/);
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rv-none'), proposal: { ...k.revokeProposal(v, s1), targetStateId: null }, fingerprint: 'f'.repeat(64) })),
      'GV010', /TARGET_STATE_REQUIRED/);
    const r = await k.revoke(ctx, 'rv', v, s1);
    assert.deepEqual([r.decided.outcome, r.decided.state_kind, r.decided.control_definition_version_id], ['REVOKED', 'REVOKED', v.controlDefinitionVersionId]);
    const tomb = await row(`select to_json(d) from gov_repo.l14_control_definition_states d where state_id='${r.decided.registry_state_id}'`);
    assert.deepEqual([tomb.revokes_state_id, tomb.predecessor_state_id, tomb.control_definition_version_id, tomb.content_hash],
      [s1, s1, v.controlDefinitionVersionId, v.contentHash]);
    assert.equal(await one(`select s::text||'|'||d::text from gov_repo.l14_registry_states s join gov_repo.l14_control_definition_states d using (organisation_id, state_id) where state_id='${s1}'`),
      targetRow, 'the target VALIDATED state is byte-identical');
    assert.equal(await k.resolve(ctx.org, v, 'clock_timestamp()', 'clock_timestamp()'), null);
    const env = await envelope(s1);
    assert.equal(await k.resolve(ctx.org, v, ts(env.effective_from), ts(env.recorded_at)), s1, 'historical readback stays intact');
    await rejects(c.svc(k.submitSql(ctx.member, { commandId: ctx.cmd('rv-again'), proposal: k.revokeProposal(v, s1) })), 'GV010', /TARGET_ALREADY_REVOKED/);
    for (const sql of [
      `update gov_repo.l14_control_definition_states set state_kind=state_kind where state_id='${s1}'`,
      `delete from gov_repo.l14_control_definition_states where state_id='${s1}'`,
      'truncate gov_repo.l14_control_definition_states cascade',
      `update gov_repo.l14_control_definition_proposals set requested_effective_from=now() where organisation_id='${ctx.org}'`,
      `delete from gov_repo.l14_control_definition_proposals where organisation_id='${ctx.org}'`,
      'truncate gov_repo.l14_control_definition_proposals cascade',
      `update gov_repo.l14_control_definition_versions set title=title||'x' where organisation_id='${ctx.org}'`,
      `update gov_repo.l14_control_definition_versions set control_code='CG-AG-001' where organisation_id='${ctx.org}'`,
      `update gov_repo.l14_control_definition_versions set content_hash=repeat('0',64) where organisation_id='${ctx.org}'`,
      `delete from gov_repo.l14_control_definition_versions where organisation_id='${ctx.org}'`,
      'truncate gov_repo.l14_control_definition_versions cascade',
      `update gov_repo.l14_control_definitions set control_definition_id=gen_random_uuid() where organisation_id='${ctx.org}'`,
      `delete from gov_repo.l14_control_definitions where organisation_id='${ctx.org}'`,
      'truncate gov_repo.l14_control_definitions cascade',
      `update gov_repo.l14_registry_states set effective_from=now() where state_id='${s1}'`,
      `delete from gov_repo.l14_control_definition_heads where organisation_id='${ctx.org}'`,
      'truncate gov_repo.l14_control_definition_heads',
      `update gov_repo.l14_control_definition_heads set latest_state_id='${s1}' where organisation_id='${ctx.org}' and control_definition_version_id='${v.controlDefinitionVersionId}'`,
      `update gov_repo.l14_control_definition_heads set control_definition_version_id=gen_random_uuid() where organisation_id='${ctx.org}'`,
      `update gov_repo.l14_control_definition_heads set latest_state_id=null where organisation_id='${ctx.org}'`,
      `insert into gov_repo.l14_control_definition_heads(organisation_id,control_definition_id,control_definition_version_id,content_hash,latest_state_id)
        values('${ctx.org}','${v.controlDefinitionId}','${v.controlDefinitionVersionId}','${v.contentHash}','${s1}')`,
    ]) {
      await assert.rejects(c.bootstrapSql(`begin; ${sql}; rollback;`), /L14_HISTORY_IMMUTABLE|55000/, sql);
    }
  });

  await t.test('temporal: future-dated not current early; authorized backdating; unauthorized dating is a durable DENY; recorded cutoff; R1 interval rule', async () => {
    const v = await k.admitted(ctx, 'tf');
    const future = await k.instant('2 hours');
    const fp = k.validateProposal(v, future);
    const fs = await k.submit(ctx, ctx.member, 'tf-s', fp);
    const denied = await exec(k.decideSqlFor(ctx.steward, ctx.cmd('tf-deny'), fs.proposal_id, fp, 'VALIDATE', null));
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED']);
    const vf = await exec(k.decideSqlFor(ctx.flex, ctx.cmd('tf-ok'), fs.proposal_id, fp, 'VALIDATE', null));
    assert.equal(vf.outcome, 'VALIDATED');
    assert.equal(await k.canonical(vf.effective_from), future);
    assert.equal(await k.resolve(ctx.org, v, 'clock_timestamp()', 'clock_timestamp()'), null, 'a future-dated VALIDATED state is not valid now');
    assert.equal(await k.resolve(ctx.org, v, `${ts(future)} + interval '1 second'`, 'clock_timestamp()'), vf.registry_state_id);
    const b = await k.admitted(ctx, 'tb');
    const past = await k.instant('-3 hours');
    const bp = k.validateProposal(b, past);
    const bs = await k.submit(ctx, ctx.member, 'tb-s', bp);
    const bdeny = await exec(k.decideSqlFor(ctx.steward, ctx.cmd('tb-deny'), bs.proposal_id, bp, 'VALIDATE', null));
    assert.deepEqual([bdeny.outcome, bdeny.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED']);
    const bv = await exec(k.decideSqlFor(ctx.flex, ctx.cmd('tb-ok'), bs.proposal_id, bp, 'VALIDATE', null));
    assert.equal(await k.canonical(bv.effective_from), past, 'authorized backdating');
    const env = await envelope(bv.registry_state_id);
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} + interval '1 minute'`, 'clock_timestamp()'), bv.registry_state_id);
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} + interval '1 minute'`, `${ts(env.recorded_at)} - interval '1 microsecond'`), null,
      'not yet known before its recorded instant');
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} - interval '1 minute'`, 'clock_timestamp()'), null, 'not effective before its start');
    const early = await k.instant('-4 hours');
    const rp = k.revokeProposal(b, bv.registry_state_id, early);
    const rs = await k.submit(ctx, ctx.member, 'tb-rs', rp);
    await rejects(c.svc(k.decideSqlFor(ctx.flex, ctx.cmd('tb-revoke-early'), rs.proposal_id, rp, 'REVOKE', bv.registry_state_id)), 'GV011', /REVOKE_BEFORE_TARGET_EFFECTIVE/);
    const cp = k.revokeProposal(b, bv.registry_state_id, past);
    const cs = await k.submit(ctx, ctx.member, 'tb-cs', cp);
    const cancelled = await exec(k.decideSqlFor(ctx.flex, ctx.cmd('tb-cancel'), cs.proposal_id, cp, 'REVOKE', bv.registry_state_id));
    assert.equal(cancelled.outcome, 'REVOKED');
    const cenv = await envelope(cancelled.registry_state_id);
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} + interval '1 minute'`, 'clock_timestamp()'), null, 'cancelled from its own start');
    assert.equal(await k.resolve(ctx.org, b, `${ts(past)} + interval '1 minute'`, `${ts(cenv.recorded_at)} - interval '1 microsecond'`), bv.registry_state_id,
      'the earlier knowledge stays visible at an earlier recorded cutoff');
    const pp = k.revokeProposal(v, vf.registry_state_id, future);
    const ps = await k.submit(ctx, ctx.member, 'tf-ps', pp);
    assert.equal((await exec(k.decideSqlFor(ctx.flex, ctx.cmd('tf-cancel'), ps.proposal_id, pp, 'REVOKE', vf.registry_state_id))).outcome, 'REVOKED');
    assert.equal(await k.resolve(ctx.org, v, `${ts(future)} + interval '1 second'`, 'clock_timestamp()'), null, 'pending cancellation at its own instant');
  });

  await t.test('re-validation of the SAME exact version after a tombstone pins the predecessor; overlap and stale expectations are rejected', async () => {
    const v = await k.admitted(ctx, 're');
    const s1 = (await k.validate(ctx, 're1', v)).decided;
    const dup = k.validateProposal(v);
    const ds = await k.submit(ctx, ctx.member, 're-dup', dup);
    await rejects(c.svc(k.decideSqlFor(ctx.steward, ctx.cmd('re-dup-v'), ds.proposal_id, dup, 'VALIDATE', s1.registry_state_id)), 'GV010', /CONTROL_DEFINITION_ALREADY_VALIDATED/);
    await rejects(c.svc(k.decideSqlFor(ctx.steward, ctx.cmd('re-blind'), ds.proposal_id, dup, 'DEFER', null)), 'GV009', /CONTROL_DEFINITION_STATE_EXISTS/);
    await rejects(c.svc(k.decideSqlFor(ctx.steward, ctx.cmd('re-stale'), ds.proposal_id, dup, 'DEFER', ds.proposal_id)), 'GV009', /CONTROL_DEFINITION_STATE_EXPECTATION_MISMATCH/);
    const r1 = (await k.revoke(ctx, 're-r1', v, s1.registry_state_id)).decided;
    const back = k.validateProposal(v, await k.instant('-1 hour'));
    const bs = await k.submit(ctx, ctx.member, 're-back', back);
    await rejects(c.svc(k.decideSqlFor(ctx.flex, ctx.cmd('re-back-v'), bs.proposal_id, back, 'VALIDATE', r1.registry_state_id)), 'GV011', /REVALIDATION_OVERLAPS_PRIOR_INTERVAL/);
    const s2 = (await k.validate(ctx, 're2', v)).decided;
    const d2 = await row(`select to_json(d) from gov_repo.l14_control_definition_states d where state_id='${s2.registry_state_id}'`);
    assert.deepEqual([d2.predecessor_state_id, d2.control_definition_version_id], [r1.registry_state_id, v.controlDefinitionVersionId]);
    assert.equal(await one(`select string_agg(s.state_kind, '>' order by s.recorded_at) from gov_repo.l14_registry_states s
      join gov_repo.l14_control_definition_states d using (organisation_id, state_id) where d.control_definition_version_id='${v.controlDefinitionVersionId}'`),
    'VALIDATED>REVOKED>VALIDATED');
    assert.equal(await k.resolve(ctx.org, v, 'clock_timestamp()', 'clock_timestamp()'), s2.registry_state_id);
  });

  await t.test('replay: exact original result for ADMIT (first + successor) / SUBMIT / DECIDE; durable DENY survives later authority; GV007; GV008', async () => {
    const x = await k.setup();
    const cdid = randomUUID(), vid = randomUUID(), vid2 = randomUUID();
    const content = k.content('rp'), content2 = k.content('rp2');
    const admitSql = k.admitSql(x.registrar, { commandId: x.cmd('rp-a'), controlDefinitionId: cdid, versionId: vid, content });
    const admitted = await exec(admitSql);
    const nextSql = k.admitSql(x.registrar, { commandId: x.cmd('rp-a2'), controlDefinitionId: cdid, versionId: vid2, content: content2,
      expectation: { kind: 'EXPECTED_CURRENT', latestVersionId: vid } });
    const next = await exec(nextSql);
    const admitDenySql = k.admitSql(x.member, { commandId: x.cmd('rp-ad'), controlDefinitionId: randomUUID(), versionId: randomUUID(), content });
    const admitDenied = await exec(admitDenySql);
    const v = { controlDefinitionId: cdid, controlDefinitionVersionId: vid, contentHash: controlDefinitionContentHash(content) };
    const proposal = k.validateProposal(v);
    const submitSql = k.submitSql(x.member, { commandId: x.cmd('rp-s'), proposal });
    const submitted = await exec(submitSql);
    const allowSql = k.decideSqlFor(x.steward, x.cmd('rp-v'), submitted.proposal_id, proposal, 'VALIDATE', null);
    const denySql = k.decideSqlFor(x.member, x.cmd('rp-d'), submitted.proposal_id, proposal, 'DEFER', null);
    const denied = await exec(denySql);
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    const allowed = await exec(allowSql);
    await owner(`update gov_repo.governance_users set role_ids=array['${c.memberRole}','${k.stewardRole}','${k.registrarRole}']::uuid[] where user_id='${x.member.id}'`);
    await owner(`update gov_repo.governance_users set role_ids=array['${c.memberRole}']::uuid[] where user_id in ('${x.steward.id}','${x.registrar.id}')`);
    const before = await k.counts(x.org);
    const history = await k.historyDigest(x.org);
    for (const [sql, original] of [[admitSql, admitted], [nextSql, next], [admitDenySql, admitDenied], [submitSql, submitted], [allowSql, allowed],
      [denySql, denied]] as const) {
      const again = await exec(sql);
      assert.equal(again.replay, true);
      assert.deepEqual({ ...again, replay: false }, original, 'the ORIGINAL durable result');
    }
    assert.deepEqual(await k.counts(x.org), before, 'replay writes nothing');
    assert.equal(await k.historyDigest(x.org), history);
    // GV007: same command id, changed semantic payload (content, ids, outcome, temporal intent).
    await rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('rp-a'), controlDefinitionId: cdid, versionId: vid, content: k.content('rp-changed') })), 'GV007');
    await rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('rp-a'), controlDefinitionId: cdid, versionId: randomUUID(), content })), 'GV007');
    await rejects(c.svc(k.decideSqlFor(x.steward, x.cmd('rp-v'), submitted.proposal_id, proposal, 'REJECT', null)), 'GV007');
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rp-s'), proposal: k.validateProposal(v, await k.instant('1 hour')) })), 'GV007');
    // GV008: the caller fingerprint differs from the PostgreSQL recomputation.
    const wrong = decideControlDefinitionProposalFingerprint({ organisationId: x.org, actorUserId: x.member.id, outcome: 'REJECT',
      proposalId: submitted.proposal_id, proposal, expectedCurrentStateId: null, support: { status: 'NONE', evidenceIds: [] } });
    await rejects(c.svc(k.decideSql(x.steward, { commandId: x.cmd('rp-fp'), proposalId: submitted.proposal_id, proposal, outcome: 'REJECT',
      expected: allowed.registry_state_id, fingerprint: wrong })), 'GV008');
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('rp-fp2'), proposal, fingerprint: 'f'.repeat(64) })), 'GV008');
    await rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('rp-fp3'), controlDefinitionId: randomUUID(), versionId: randomUUID(),
      content, fingerprint: 'f'.repeat(64) })), 'GV008');
  });

  await t.test('authority: CURRENT roles and the CURRENT effective Authority Policy govern; self-validation follows the policy; other families never decide', async () => {
    const x = await k.setup();
    const v1 = await k.admitted(x, 'self');
    const p1 = k.validateProposal(v1);
    const own = await k.submit(x, x.steward, 'self-s', p1);
    const self = await exec(k.decideSqlFor(x.steward, x.cmd('self-v'), own.proposal_id, p1, 'VALIDATE', null));
    assert.deepEqual([self.outcome, self.deny_reason], ['DENIED', 'SELF_VALIDATION_NOT_PERMITTED']);
    assert.equal((await authz(self.authorization_decision_id)).is_self_validation, true);
    const flexOwn = await k.submit(x, x.flex, 'self-fs', p1);
    assert.equal((await exec(k.decideSqlFor(x.flex, x.cmd('self-fv'), flexOwn.proposal_id, p1, 'VALIDATE', null))).outcome, 'VALIDATED');
    const v2 = await k.admitted(x, 'auth');
    const p2 = k.validateProposal(v2);
    const sub2 = await k.submit(x, x.member, 'auth-s', p2);
    const contrib = await exec(k.decideSqlFor(x.contrib, x.cmd('auth-c'), sub2.proposal_id, p2, 'VALIDATE', null));
    assert.deepEqual([contrib.outcome, contrib.deny_reason], ['DENIED', 'SOURCE_NOT_AUTHORIZED']);
    for (const [actor, name] of [[x.registrar, 'auth-registrar'], [x.domain, 'auth-domain'], [x.boot, 'auth-admin'], [x.ops, 'auth-ops']] as const) {
      const r = await exec(k.decideSqlFor(actor, x.cmd(name), sub2.proposal_id, p2, 'VALIDATE', null));
      assert.deepEqual([r.outcome, r.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE'], name);
    }
    await owner(`update gov_repo.governance_users set role_ids=array['${c.memberRole}']::uuid[] where user_id='${x.steward2.id}'`);
    const gone = await exec(k.decideSqlFor(x.steward2, x.cmd('auth-v2'), sub2.proposal_id, p2, 'VALIDATE', null));
    assert.deepEqual([gone.outcome, gone.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    const ap2 = await k.apSuccessor(x, 'auth-ap2', k.controlRules(2, {}, [`${k.stewardRole}:L14_CONTROL_DEFINITION_VALIDATE:VALIDATE`,
      `${k.registrarRole}:L14_CONTROL_DEFINITION_ADMIT:ADMIT`]));
    const after = await exec(k.decideSqlFor(x.steward, x.cmd('auth-v'), sub2.proposal_id, p2, 'VALIDATE', null));
    assert.deepEqual([after.outcome, after.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    assert.equal((await authz(after.authorization_decision_id)).basis_version_id, ap2.admitted.version_id);
    const admitAfter = await exec(k.admitSql(x.registrar, { commandId: x.cmd('auth-adm'), controlDefinitionId: randomUUID(), versionId: randomUUID(),
      content: k.content('after') }));
    assert.deepEqual([admitAfter.outcome, admitAfter.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    // D-14: a control-definition permission rule can only ever be organisation-local.
    await rejects(c.svc(c.admitSql(x.ops, { commandId: x.cmd('d14'), expected: { authorityPolicyId: x.v1.authority_policy_id,
      latestVersionId: ap2.admitted.version_id }, rules: [...k.controlRules(3), c.rule(k.stewardRole, 'L14_CONTROL_DEFINITION_VALIDATE', 'VALIDATE',
      { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' })] })), 'GV010');
  });

  await t.test('CG-AG boundary: cg_* flags, legacy gap scores and CG-AG codes never admit, validate or resolve a control definition', async () => {
    const x = await k.setup();
    // A legacy agent whose compliance trigger sets cg_ag_001/002/003/007 = true, and its legacy gap "score".
    const agent = await newAgent(owner, x.org, x.boot.id, 'CG-AGENT-1');
    assert.equal(await one(`select (cg_ag_001_registered and cg_ag_002_owner and cg_ag_003_model_reg is not null)::text from gov_repo.agents where agent_id='${agent}'`), 'true');
    await owner(`update gov_repo.agents set cg_ag_008_audit_trail=true, cg_ag_010_classified=true, cg_ag_012_autonomous_governed=true where agent_id='${agent}'`);
    const gaps = await c.svc(`select count(*) from gov_repo.agent_compliance_gaps('${x.org}')`);
    assert.ok(Number(lastLine(gaps)) >= 0, 'the legacy score function still runs as before');
    const counts = await k.counts(x.org);
    for (const table of ['l14_control_definitions', 'l14_control_definition_versions', 'l14_control_definition_states', 'l14_control_definition_proposals',
      'l14_control_definition_heads', 'l14_registry_states']) {
      assert.equal(counts[table], 0, `${table}: no cg_* flag / CG-AG score creates governed state`);
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_proposals where organisation_id='${x.org}' and subject_kind <> 'AUTHORITY_POLICY_VERSION'`), '0');
    // A CG-AG catalogue entry may only enter as LOCAL_HUMAN content of an explicitly admitted version; it is not validated by admission.
    const cg = { controlCode: 'CG-AG-001', title: 'Agent Inventory', description: 'Every AI agent must be formally registered in the master agent inventory before operating.' };
    const { version: v, r } = await k.admitFirst(x, 'cg', cg);
    assert.equal(r.outcome, 'ADMITTED');
    assert.match(v.controlDefinitionId, /^[0-9a-f-]{36}$/, 'the identity is an opaque UUID, never the CG-AG id');
    assert.equal(await k.resolve(x.org, v, 'clock_timestamp()', 'clock_timestamp()'), null, 'admitted CG-AG content is not validated');
    await rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('cg-seed'), controlDefinitionId: randomUUID(), versionId: randomUUID(), content: cg,
      sourceClass: 'SYSTEM_SEED' })), 'GV010', /SOURCE_CLASS_NOT_EXECUTABLE/);
    // Same control code under another identity: a different subject; resolution never matches by control code.
    const { version: twin } = await k.admitFirst(x, 'cg-twin', cg);
    const validated = await k.validate(x, 'cg', v);
    assert.equal(await k.resolve(x.org, twin, 'clock_timestamp()', 'clock_timestamp()'), null, 'same control_code, other identity: not validated');
    assert.equal(await k.resolve(x.org, v, 'clock_timestamp()', 'clock_timestamp()'), validated.decided.registry_state_id);
    // Flipping every legacy flag off changes nothing governed; governed state changes nothing legacy.
    const digest = await k.historyDigest(x.org);
    await owner(`update gov_repo.agents set cg_ag_008_audit_trail=false, cg_ag_010_classified=false where agent_id='${agent}'`);
    assert.equal(await k.historyDigest(x.org), digest);
    assert.equal(await k.resolve(x.org, v, 'clock_timestamp()', 'clock_timestamp()'), validated.decided.registry_state_id);
    assert.equal(await one(`select (cg_ag_008_audit_trail or cg_ag_010_classified)::text from gov_repo.agents where agent_id='${agent}'`), 'false');
    // No foreign key, column or routine of the S1B.6 surface references the legacy agent registry.
    assert.equal(await one(`select count(*) from pg_constraint where contype='f' and conrelid::regclass::text like 'gov_repo.l14\\_control%'
      and confrelid in ('gov_repo.agents'::regclass, 'gov_repo.agent_resource_links'::regclass, 'gov_repo.ai_systems'::regclass)`), '0');
  });
});
