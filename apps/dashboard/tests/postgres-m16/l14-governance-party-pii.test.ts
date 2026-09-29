import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { L14_PARTY_PROFILE_PII_FIELDS } from '@council/canonical-contracts';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { L14_S1B1_TABLES, partyKit } from '../helpers/m16-l14-party-fixtures';

/**
 * M16-S1B.1 — the GovernanceParty PII boundary on real disposable PostgreSQL 17. Proven on the
 * CATALOG (columns, constraints, routine signatures), not on application payloads. The directory /
 * profile table has no application privilege and no RPC, so profile writes here run as the owner in
 * this disposable, test-only cluster (mostly inside rolled-back transactions).
 */
const PII_NAME = /(^|_)(name|email|phone|profile|display|external|erasure)(_|$)/;
const ALLOWED_USER_FK_COLUMNS = ['actor_user_id', 'admitted_by_actor_user_id', 'submitted_by_actor_user_id'];

test('M16 S1B.1 GovernanceParty PII boundary (disposable PG17)', { timeout: 1_200_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B1R1' });
  t.after(() => c.stop());
  const { owner, exec, rejects } = c;
  const k = await partyKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const lines = (out: string) => out.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const ctx = await k.setup();
  // Full Party history: ADMIT (with support), VALIDATE, REVOKE, re-VALIDATE, plus a denied ADMIT.
  await c.evidence(ctx.org, 'pii-ev');
  const a = await k.validated(ctx, 'pii');
  const r = await k.revoke(ctx, 'pii-r', a.partyId, a.decided.registry_state_id);
  const vp = k.validateProposal(a.partyId);
  const vs = await k.submit(ctx, ctx.member, 'pii-v2-submit', vp);
  await k.decide(ctx, ctx.steward, 'pii-v2', vs, vp);
  const deniedSql = k.admitSql(ctx.member, { commandId: ctx.cmd('pii-deny'), support: { status: 'PRESENT', evidenceIds: ['pii-ev'] } });
  const denied = await exec(deniedSql);
  const admitSql = k.admitSql(ctx.registrar, { commandId: ctx.cmd('pii-admit') });
  const group = await exec(k.admitSql(ctx.registrar, { commandId: ctx.cmd('pii-group'), partyKind: 'GROUP' }));
  assert.equal(r.decided.outcome, 'REVOKED');

  await t.test('catalog: no immutable L14 structure has a PII column, a profile reference, or a non-actor user reference', async () => {
    const columns = lines(await owner(`select c.relname||'.'||a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid
      where c.relnamespace='gov_repo'::regnamespace and c.relname like 'l14\\_%' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by 1`));
    assert.ok(columns.length > 150, 'the whole L14 surface is inspected');
    assert.deepEqual(columns.filter(col => PII_NAME.test(col.split('.')[1]!) || (L14_PARTY_PROFILE_PII_FIELDS as readonly string[]).includes(col.split('.')[1]!)), []);
    assert.deepEqual(lines(await owner(`select c.relname||'.'||a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid
      where c.relname in ('l14_governance_parties','l14_governance_party_proposals','l14_governance_party_states','l14_governance_party_heads')
        and c.relnamespace='gov_repo'::regnamespace and a.attnum>0 and not a.attisdropped order by c.relname, a.attnum`)), [
      'l14_governance_parties.organisation_id', 'l14_governance_parties.governance_party_id', 'l14_governance_parties.party_kind',
      'l14_governance_parties.source_class', 'l14_governance_parties.admitted_by_actor_user_id',
      'l14_governance_parties.admission_authorization_decision_id', 'l14_governance_parties.admission_authorization_result',
      'l14_governance_parties.admission_subject_kind', 'l14_governance_parties.admission_requested_action',
      'l14_governance_parties.support_status', 'l14_governance_parties.admitted_at',
      'l14_governance_party_heads.organisation_id', 'l14_governance_party_heads.governance_party_id', 'l14_governance_party_heads.party_kind',
      'l14_governance_party_heads.latest_state_id',
      'l14_governance_party_proposals.organisation_id', 'l14_governance_party_proposals.proposal_id', 'l14_governance_party_proposals.subject_kind',
      'l14_governance_party_proposals.intent', 'l14_governance_party_proposals.governance_party_id', 'l14_governance_party_proposals.party_kind',
      'l14_governance_party_proposals.requested_effective_from', 'l14_governance_party_proposals.target_state_id',
      'l14_governance_party_proposals.target_state_kind',
      'l14_governance_party_states.organisation_id', 'l14_governance_party_states.state_id', 'l14_governance_party_states.subject_kind',
      'l14_governance_party_states.state_kind', 'l14_governance_party_states.governance_party_id', 'l14_governance_party_states.party_kind',
      'l14_governance_party_states.predecessor_state_id', 'l14_governance_party_states.predecessor_state_kind',
      'l14_governance_party_states.revokes_state_id', 'l14_governance_party_states.revoked_state_kind',
    ], 'the exact, PII-free Party column set');
    // Every free-form text column of the Party tables is a closed vocabulary (CHECKed), so nothing free-text is representable.
    const openText = lines(await owner(`select c.relname||'.'||a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid
      where c.relname in ('l14_governance_parties','l14_governance_party_proposals','l14_governance_party_states','l14_governance_party_heads')
        and c.relnamespace='gov_repo'::regnamespace and a.attnum>0 and not a.attisdropped and a.atttypid='text'::regtype and a.attgenerated=''
        and not exists (select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='c' and a.attnum = any(k.conkey))`));
    assert.deepEqual(openText, []);
    assert.equal(await one(`select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid
      where c.relnamespace='gov_repo'::regnamespace and c.relname like 'l14\\_%' and k.confrelid='gov_repo.governance_party_directory_profiles'::regclass`), '0');
    const userRefs = lines(await owner(`select distinct a.attname from pg_constraint k join pg_class c on c.oid=k.conrelid
      join pg_attribute a on a.attrelid=k.conrelid and a.attnum = any(k.conkey)
      where c.relnamespace='gov_repo'::regnamespace and c.relname like 'l14\\_%' and k.contype='f'
        and k.confrelid='gov_repo.governance_users'::regclass order by 1`));
    assert.ok(userRefs.every(col => ALLOWED_USER_FK_COLUMNS.includes(col)), `only authorization/audit actor columns reference users: ${userRefs}`);
    // No view and no JSON anywhere could smuggle profile content into the L14 surface.
    assert.equal(await one(`select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='gov_repo'::regnamespace
      and c.relname like 'l14\\_%' and a.atttypid in ('json'::regtype,'jsonb'::regtype) and not a.attisdropped`), '0');
  });

  await t.test('RPC surfaces: no Party RPC accepts or returns PII; a PII argument is not representable (42883)', async () => {
    for (const rpc of ['l14_admit_governance_party_v1', 'l14_submit_governance_party_proposal_v1', 'l14_decide_governance_party_proposal_v1']) {
      const names = lines(await owner(`select unnest(proargnames) from pg_proc where proname='${rpc}'`));
      assert.ok(names.length > 10);
      assert.deepEqual(names.filter(n => PII_NAME.test(n) || /governance_user/.test(n)), [], rpc);
      assert.deepEqual(names.filter(n => /user_id/.test(n)), ['p_verified_actor_user_id'], `${rpc}: only the verified actor`);
    }
    for (const extra of ['p_display_name', 'p_email', 'p_phone', 'p_profile_text', 'p_governance_user_id', 'p_external_identity_ref']) {
      const sql = k.admitSql(ctx.registrar, { commandId: ctx.cmd(`pii-${extra}`) }).replace('p_command_id =>', `${extra} => 'x', p_command_id =>`);
      await rejects(c.svc(sql), '42883');
    }
    const result = await exec(admitSql);
    assert.deepEqual(Object.keys(result).sort(), ['authorization_decision_id', 'authorization_result', 'command_fingerprint', 'command_id', 'command_kind',
      'deny_reason', 'effective_from', 'governance_decision_id', 'governance_party_id', 'outcome', 'party_kind', 'proposal_id', 'recorded_at',
      'registry_state_id', 'replay', 'state_kind', 'subject_kind'], 'the durable result carries no PII field');
  });

  await t.test('profile correction, pseudonymisation and erasure never change one byte of Party history (rolled back)', async () => {
    const digestSql = `select 'd:'||md5(string_agg(x, '|' order by x)) from (${L14_S1B1_TABLES.map(tb =>
      `select '${tb}:'||t::text as x from gov_repo.${tb} t`).join(' union all ')}) s;`;
    const mapped = await c.mkUser(ctx.org, [c.memberRole]);
    const pid = a.partyId;
    const out = lines(await owner(`begin;
      ${digestSql}
      insert into gov_repo.governance_party_directory_profiles (organisation_id, governance_party_id, party_kind, display_name, email, phone,
        profile_text, governance_user_id, external_identity_ref, erasure_state, updated_at, updated_by_actor_user_id)
      values ('${ctx.org}', '${pid}', 'PERSON', 'Ada Lovelace', 'ada@example.invalid', '+351 000 000 000', 'Analyst', '${mapped.id}', 'idp:ada', 'ACTIVE',
        clock_timestamp(), '${ctx.boot.id}');
      ${digestSql}
      update gov_repo.governance_party_directory_profiles set display_name='Ada King', email='ada.king@example.invalid', updated_at=clock_timestamp()
        where governance_party_id='${pid}';
      ${digestSql}
      update gov_repo.governance_party_directory_profiles set display_name='Person 7f3a', email=null, phone=null, governance_user_id=null,
        external_identity_ref=null, erasure_state='PSEUDONYMISED', updated_at=clock_timestamp() where governance_party_id='${pid}';
      ${digestSql}
      update gov_repo.governance_party_directory_profiles set display_name=null, profile_text=null, erasure_state='ERASED', updated_at=clock_timestamp()
        where governance_party_id='${pid}';
      ${digestSql}
      select 'state:'||erasure_state||':'||coalesce(display_name,'∅')||':'||coalesce(email,'∅') from gov_repo.governance_party_directory_profiles
        where governance_party_id='${pid}';
      delete from gov_repo.governance_party_directory_profiles where governance_party_id='${pid}';
      ${digestSql}
      rollback;`));
    const digests = out.filter(l => l.startsWith('d:'));
    assert.equal(digests.length, 6);
    assert.equal(new Set(digests).size, 1, 'every L14 row of every table is byte-identical through the whole profile lifecycle');
    assert.ok(out.includes('state:ERASED:∅:∅'));
    // The resolver ignores profiles entirely.
    assert.equal(await k.resolve(ctx.org, pid, 'clock_timestamp()', 'clock_timestamp()'), (await k.head(ctx.org, pid))!.latest_state_id);
  });

  await t.test('profile data never enters a fingerprint, history row or result; replays are unaffected by profile content', async () => {
    const marker = `pii-marker-${randomUUID()}`;
    await owner(`insert into gov_repo.governance_party_directory_profiles (organisation_id, governance_party_id, party_kind, display_name, email,
      profile_text, external_identity_ref, updated_at) values ('${ctx.org}', '${group.governance_party_id}', 'GROUP', '${marker}', '${marker}@example.invalid',
      '${marker}', '${marker}', clock_timestamp())`);
    const hits = await one(`select count(*) from (${L14_S1B1_TABLES.map(tb => `select t::text as x from gov_repo.${tb} t`).join(' union all ')}) s
      where s.x like '%${marker}%'`);
    assert.equal(hits, '0', 'no L14 row contains any profile value');
    // Replays (ALLOW and DENY) return the original durable results unchanged; the TS fingerprint needs no profile input.
    const replayGroup = await exec(k.admitSql(ctx.registrar, { commandId: ctx.cmd('pii-group'), partyKind: 'GROUP' }));
    assert.deepEqual({ ...replayGroup, replay: false }, group);
    assert.deepEqual({ ...(await exec(deniedSql)), replay: false }, denied);
    assert.ok(!JSON.stringify(replayGroup).includes(marker));
    await owner(`delete from gov_repo.governance_party_directory_profiles where governance_party_id='${group.governance_party_id}'`);
  });

  await t.test('deleting a mapped governance user clears ONLY the mapping; history stays identical', async () => {
    const mapped = await c.mkUser(ctx.org, [c.memberRole]);
    await owner(`insert into gov_repo.governance_party_directory_profiles (organisation_id, governance_party_id, party_kind, display_name, email,
      governance_user_id, erasure_state, updated_at) values ('${ctx.org}', '${a.partyId}', 'PERSON', 'Mapped', 'mapped@example.invalid',
      '${mapped.id}', 'ACTIVE', clock_timestamp())`);
    const before = await k.historyDigest(ctx.org);
    const profileBefore = await one(`select display_name||'|'||email||'|'||erasure_state from gov_repo.governance_party_directory_profiles where governance_party_id='${a.partyId}'`);
    await owner(`delete from gov_repo.governance_users where user_id='${mapped.id}'`);
    assert.equal(await one(`select coalesce(governance_user_id::text,'NULL') from gov_repo.governance_party_directory_profiles where governance_party_id='${a.partyId}'`), 'NULL');
    assert.equal(await one(`select display_name||'|'||email||'|'||erasure_state from gov_repo.governance_party_directory_profiles where governance_party_id='${a.partyId}'`),
      profileBefore, 'only the mapping column changed');
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_parties where governance_party_id='${a.partyId}'`), '1');
    assert.equal(await k.historyDigest(ctx.org), before);
    // A user that authored L14 history cannot be deleted at all (actor audit is immutable).
    await rejects(owner(`delete from gov_repo.governance_users where user_id='${ctx.registrar.id}'`), '23503');
    await owner(`delete from gov_repo.governance_party_directory_profiles where governance_party_id='${a.partyId}'`);
  });

  await t.test('mapping rules: PERSON only, one Party per user, same tenant, erasure shapes, fixed binding, undeletable identity', async () => {
    const other = await k.setup();
    const foreignUser = await c.mkUser(other.org, [c.memberRole]);
    const u = await c.mkUser(ctx.org, [c.memberRole]);
    const second = await exec(k.admitSql(ctx.registrar, { commandId: ctx.cmd('pii-second') }));
    const ou = await exec(k.admitSql(ctx.registrar, { commandId: ctx.cmd('pii-ou'), partyKind: 'ORGANISATIONAL_UNIT' }));
    const ins = (party: string, kind: string, extra: string, values: string) => owner(`begin; insert into gov_repo.governance_party_directory_profiles
      (organisation_id, governance_party_id, party_kind, updated_at${extra}) values ('${ctx.org}', '${party}', '${kind}', clock_timestamp()${values}); rollback;`);
    await ins(a.partyId, 'PERSON', ', governance_user_id', `, '${u.id}'`);
    await rejects(ins(group.governance_party_id, 'GROUP', ', governance_user_id', `, '${u.id}'`), '23514', /mapping_kind_check/);
    await rejects(ins(ou.governance_party_id, 'ORGANISATIONAL_UNIT', ', governance_user_id', `, '${u.id}'`), '23514', /mapping_kind_check/);
    await rejects(owner(`begin; insert into gov_repo.governance_party_directory_profiles (organisation_id, governance_party_id, party_kind, governance_user_id, updated_at)
      values ('${ctx.org}', '${a.partyId}', 'PERSON', '${u.id}', clock_timestamp()), ('${ctx.org}', '${second.governance_party_id}', 'PERSON', '${u.id}', clock_timestamp());
      rollback;`), '23505', /user_unique/);
    await rejects(ins(a.partyId, 'PERSON', ', governance_user_id', `, '${foreignUser.id}'`), '23503', /user_fkey/);
    await rejects(ins(a.partyId, 'GROUP', '', ''), '23503', /party_fkey/);
    await rejects(ins(randomUUID(), 'PERSON', '', ''), '23503', /party_fkey/);
    await rejects(owner(`begin; insert into gov_repo.governance_party_directory_profiles (organisation_id, governance_party_id, party_kind, updated_at)
      values ('${other.org}', '${a.partyId}', 'PERSON', clock_timestamp()); rollback;`), '23503', /party_fkey/);
    for (const [cols, vals] of [[', display_name, erasure_state', `, 'x', 'ERASED'`], [', email, erasure_state', `, 'a@b.c', 'ERASED'`],
      [', phone, erasure_state', `, '1', 'ERASED'`], [', profile_text, erasure_state', `, 'x', 'ERASED'`],
      [', external_identity_ref, erasure_state', `, 'x', 'ERASED'`], [', governance_user_id, erasure_state', `, '${u.id}', 'ERASED'`],
      [', email, erasure_state', `, 'a@b.c', 'PSEUDONYMISED'`], [', governance_user_id, erasure_state', `, '${u.id}', 'PSEUDONYMISED'`],
      [', erasure_state', `, 'FORGOTTEN'`]]) {
      await rejects(ins(a.partyId, 'PERSON', cols!, vals!), '23514');
    }
    await ins(a.partyId, 'PERSON', ', display_name, erasure_state', `, 'Pseudonym 1', 'PSEUDONYMISED'`);
    await ins(a.partyId, 'PERSON', ', erasure_state', `, 'ERASED'`);
    // The binding to the immutable Party never changes, and the Party can never be deleted under a profile.
    await owner(`insert into gov_repo.governance_party_directory_profiles (organisation_id, governance_party_id, party_kind, updated_at)
      values ('${ctx.org}', '${second.governance_party_id}', 'PERSON', clock_timestamp())`);
    await rejects(owner(`update gov_repo.governance_party_directory_profiles set governance_party_id='${a.partyId}' where governance_party_id='${second.governance_party_id}'`),
      'GV010', /PROFILE_PARTY_BINDING_IMMUTABLE/);
    await rejects(owner(`update gov_repo.governance_party_directory_profiles set party_kind='GROUP' where governance_party_id='${second.governance_party_id}'`),
      'GV010|23503');
    await rejects(owner(`delete from gov_repo.l14_governance_parties where governance_party_id='${second.governance_party_id}'`), '55000');
    assert.equal(await one(`select confdeltype::text||confupdtype::text from pg_constraint where conname='governance_party_directory_profiles_party_fkey'`), 'rr');
    assert.equal(await one(`select confdeltype::text||':'||array_to_string(confdelsetcols,',') from pg_constraint where conname='governance_party_directory_profiles_user_fkey'`),
      `n:${await one(`select attnum from pg_attribute where attrelid='gov_repo.governance_party_directory_profiles'::regclass and attname='governance_user_id'`)}`);
    assert.equal(await one(`select pg_get_constraintdef(oid) from pg_constraint where conname='governance_users_organisation_user_unique'`), 'UNIQUE (organisation_id, user_id)');
    await owner(`delete from gov_repo.governance_party_directory_profiles where governance_party_id='${second.governance_party_id}'`);
  });

  await t.test('no application access to the profile surface and no profile RPC (L14 Party permissions are irrelevant to it)', async () => {
    for (const role of ['service_role', 'authenticated', 'anon'] as const) {
      for (const statement of ['select 1 from gov_repo.governance_party_directory_profiles limit 1',
        `insert into gov_repo.governance_party_directory_profiles (organisation_id, governance_party_id, party_kind, updated_at) values ('${ctx.org}', '${a.partyId}', 'PERSON', now())`,
        'update gov_repo.governance_party_directory_profiles set email=null', 'delete from gov_repo.governance_party_directory_profiles',
        'truncate gov_repo.governance_party_directory_profiles']) {
        await assert.rejects(c.sql(statement, role), /42501/, `${role}: ${statement}`);
      }
    }
    assert.equal(await one(`select count(*) from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.prosrc like '%governance_party_directory_profiles%'`), '0',
      'no routine (public or internal) reads or writes the profile table');
    const PARTY_PROFILE = `(p.proname ~ 'part(y|ies).*profile|directory' or p.prosrc ~ 'directory_profiles')`;
    assert.equal(await one(`select count(*) from pg_proc p where p.pronamespace='gov_repo'::regnamespace and ${PARTY_PROFILE}
      and (p.prosecdef or has_function_privilege('service_role', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`), '0',
      'no profile RPC');
    assert.equal(await one(`select string_agg(proname, ',' order by proname) from pg_proc p where p.pronamespace='gov_repo'::regnamespace and ${PARTY_PROFILE}`),
      'l14_governance_party_profile_guard_v1', 'the only Party-profile routine is the owner-only binding guard trigger function');
    assert.equal(await one(`select count(*) from pg_rewrite w join pg_depend d on d.objid=w.oid
      where d.refobjid='gov_repo.governance_party_directory_profiles'::regclass and w.ev_class<>d.refobjid`), '0', 'no view exposes it');
  });
});
