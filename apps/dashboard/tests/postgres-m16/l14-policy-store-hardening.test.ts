import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { l14PolicyStoreHardeningMigration } from '../helpers/disposable-m16-postgres';
import { L14_TABLES, l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { PARTY_TABLES } from '../helpers/m16-l14-party-fixtures';

/** Exact stored bytes: base64 -> bytea -> text, so CR / tabs / NFC-vs-NFD survive psql untouched. */
const text = (value: string) => `convert_from(decode('${Buffer.from(value, 'utf8').toString('base64')}','base64'),'UTF8')`;
/** Independent test mirror of D-3: lowercase hex SHA-256 over the exact UTF-8 bytes, no normalization. */
const mirror = (value: string) => createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
const ALL_L14 = [...L14_TABLES, 'l14_registry_states', ...PARTY_TABLES];

/**
 * M16-S1B.2 on real legacy policy history. The cluster is S1B1R1 on the chain that carries the existing
 * policy-store prerequisites (policyStore: true); legacy policies/versions, hostile pre-existing grants,
 * a legacy writable bridge view and a legacy SECURITY DEFINER score routine are seeded THEN the S1B.2
 * migration is applied (first aborted atomically by an orphan version, then successfully).
 */
test('M16 S1B.2 reused policy-store hardening (disposable PG17)', { timeout: 900_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B1R1', policyStore: true });
  t.after(() => c.stop());
  const { owner, bootstrapSql, sql, migrate, newOrg, mkUser } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const rejects = (promise: Promise<unknown>, code: string, message?: RegExp) => assert.rejects(promise, (error: Error) => {
    assert.match(error.message, new RegExp(`\\b${code}\\b`), error.message);
    if (message) assert.match(error.message, message, error.message);
    return true;
  });

  // ---- Legacy world (before S1B.2) ------------------------------------------------------------
  const orgA = await newOrg(), orgB = await newOrg();
  const userA = await mkUser(orgA, []), userB = await mkUser(orgB, []);
  const policy = async (org: string, user: string, code: string, extra = '') => {
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_policies(policy_id,policy_code,title,policy_type,owner_user_id,organisation_id,created_by${extra ? ',status,approver_user_id' : ''})
      values('${id}','${code}','Legacy ${code}','risk','${user}','${org}','${user}'${extra})`);
    return id;
  };
  const legacyVersion = async (policyId: string, user: string, n: number, content: string, hash: string, approved = false) => {
    const id = randomUUID();
    await owner(`insert into gov_repo.policy_versions(version_id,policy_id,version_number,version_label,content_markdown,content_hash,change_summary,
        status,approved_by,approval_date,created_by)
      values('${id}','${policyId}',${n},'v${n}',${text(content)},'${hash}','legacy change',
        '${approved ? 'approved' : 'draft'}',${approved ? `'${user}'` : 'null'},${approved ? `'2026-01-02T03:04:05.123456Z'` : 'null'},'${user}')`);
    return id;
  };
  const pA = await policy(orgA, userA.id, 'POL-A', `,'approved','${userA.id}'`);
  const pB = await policy(orgB, userB.id, 'POL-B');
  const legacyContent = 'Legacy policy\r\n  body\twith trailing space ';
  const vA1 = await legacyVersion(pA, userA.id, 1, legacyContent, mirror(legacyContent), true);
  // A legacy hash that is NOT the canonical D-3 hash (uppercase): legacy data, must not be rewritten.
  const vA2 = await legacyVersion(pA, userA.id, 2, 'second', mirror('second').toUpperCase());
  const vB1 = await legacyVersion(pB, userB.id, 1, 'org B content', 'f'.repeat(64));
  await owner(`update gov_repo.governance_policies set current_version_id='${vA1}' where policy_id='${pA}'`);

  // Hostile pre-existing exposure (production-faithful: 003944 grants gov_repo USAGE to anon/authenticated).
  await owner(`grant usage on schema gov_repo to anon, authenticated;
    grant select on gov_repo.governance_policies to authenticated;
    grant select (content_markdown), update (status) on gov_repo.policy_versions to anon;
    create view public.gov_governance_policies as select * from gov_repo.governance_policies;
    grant select, insert, update, delete on public.gov_governance_policies to service_role;
    create function gov_repo.legacy_policy_score(p_org uuid) returns bigint language sql security definer
      as 'select count(*) from gov_repo.governance_policies where organisation_id = p_org';
    grant execute on function gov_repo.legacy_policy_score(uuid) to service_role, authenticated;`);
  assert.equal(await sql(`select count(*) from gov_repo.policy_versions`, 'service_role'), '3', 'legacy: service_role reads versions (013113)');
  assert.equal(await one(`select has_table_privilege('authenticated','gov_repo.governance_policies','SELECT')::text
    ||has_column_privilege('anon','gov_repo.policy_versions','content_markdown','SELECT')::text`), 'truetrue', 'legacy: hostile grants in place');

  const policiesSnapshot = `select string_agg(to_jsonb(p)::text, E'\\n' order by p.policy_id) from gov_repo.governance_policies p`;
  const versionsSnapshot = `select string_agg((to_jsonb(v) - 'organisation_id')::text, E'\\n' order by v.version_id) from gov_repo.policy_versions v`;
  const l14Total = `select ${ALL_L14.map(n => `(select count(*) from gov_repo.${n})`).join('+')}`;
  const policiesBefore = await one(policiesSnapshot);
  const versionsBefore = await one(versionsSnapshot);
  const l14Before = await one(l14Total);
  const catalogBefore = await one(`select json_build_object(
    'col', (select count(*) from pg_attribute where attrelid='gov_repo.policy_versions'::regclass and attname='organisation_id' and not attisdropped),
    'fk', (select confdeltype from pg_constraint where conname='policy_versions_policy_id_fkey'),
    'trg', (select count(*) from pg_trigger where tgrelid='gov_repo.policy_versions'::regclass and not tgisinternal),
    'pol', (select count(*) from pg_policy where polrelid in ('gov_repo.policy_versions'::regclass,'gov_repo.governance_policies'::regclass)),
    'svc', has_table_privilege('service_role','gov_repo.policy_versions','SELECT'),
    'fn', (select count(*) from pg_proc where proname like 'policy\\_store\\_%'))`);

  await t.test('migration aborts atomically on an unrecoverable integrity violation (orphan version): nothing applied', async () => {
    const orphan = randomUUID();
    await bootstrapSql(`set session_replication_role = replica;
      insert into gov_repo.policy_versions(version_id,policy_id,version_number,version_label,content_markdown,content_hash,change_summary,created_by)
      values('${orphan}','${randomUUID()}',1,'v1','x',repeat('0',64),'orphan','${userA.id}')`);
    await rejects(migrate(l14PolicyStoreHardeningMigration), '23503', /M16_S1B2_PREFLIGHT: policy version\(s\) without a parent policy/);
    const after = await one(`select json_build_object(
      'col', (select count(*) from pg_attribute where attrelid='gov_repo.policy_versions'::regclass and attname='organisation_id' and not attisdropped),
      'fk', (select confdeltype from pg_constraint where conname='policy_versions_policy_id_fkey'),
      'trg', (select count(*) from pg_trigger where tgrelid='gov_repo.policy_versions'::regclass and not tgisinternal),
      'pol', (select count(*) from pg_policy where polrelid in ('gov_repo.policy_versions'::regclass,'gov_repo.governance_policies'::regclass)),
      'svc', has_table_privilege('service_role','gov_repo.policy_versions','SELECT'),
      'fn', (select count(*) from pg_proc where proname like 'policy\\_store\\_%'))`);
    assert.equal(after, catalogBefore, 'catalog identical after the aborted migration');
    assert.deepEqual(JSON.parse(after), { col: 0, fk: 'c', trg: 0, pol: 4, svc: true, fn: 0 });
    await bootstrapSql(`set session_replication_role = replica; delete from gov_repo.policy_versions where version_id='${orphan}'`);
    assert.equal(await one(versionsSnapshot), versionsBefore);
  });

  await t.test('migration applies over representative legacy rows: backfill from the parent only; every other value byte-identical', async () => {
    await migrate(l14PolicyStoreHardeningMigration);
    assert.equal(await one(policiesSnapshot), policiesBefore, 'governance_policies rows byte-identical (updated_at untouched)');
    assert.equal(await one(versionsSnapshot), versionsBefore, 'policy_versions rows byte-identical except the new organisation_id');
    assert.equal(await one(`select string_agg(v.version_id||'='||v.organisation_id, ',' order by v.version_id) from gov_repo.policy_versions v`),
      [[vA1, orgA], [vA2, orgA], [vB1, orgB]].sort((x, y) => x[0].localeCompare(y[0])).map(([v, o]) => `${v}=${o}`).join(','));
    assert.equal(await one(`select count(*) from gov_repo.policy_versions v join gov_repo.governance_policies p on p.policy_id=v.policy_id
      where p.organisation_id is distinct from v.organisation_id`), '0', 'every version has exactly its parent organisation');
    assert.equal(await one(`select attnotnull from pg_attribute where attrelid='gov_repo.policy_versions'::regclass and attname='organisation_id'`), 't');
  });

  await t.test('existing rows are NOT promoted: no L14 state/decision/authorization/support; legacy status/approval/current_version_id untouched', async () => {
    assert.equal(await one(l14Total), l14Before);
    assert.equal(l14Before, '0');
    assert.equal(await one(`select status||':'||approved_by||':'||to_char(approval_date at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US') from gov_repo.policy_versions where version_id='${vA1}'`),
      `approved:${userA.id}:2026-01-02 03:04:05.123456`);
    assert.equal(await one(`select status||':'||current_version_id from gov_repo.governance_policies where policy_id='${pA}'`), `approved:${vA1}`);
    assert.equal(await one(`select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname ~ '^l14_.*polic(y|ies)'
      and relname not like 'l14\\_authority\\_%'`), '0', 'no L14 Policy lifecycle relation');
  });

  await t.test('tenancy: exact composite RESTRICT FK, cross-tenant rejected, required tenant keys, parent key reused (not duplicated)', async () => {
    assert.equal(await one(`select pg_get_constraintdef(oid) from pg_constraint where conname='policy_versions_organisation_policy_fkey'`),
      'FOREIGN KEY (organisation_id, policy_id) REFERENCES gov_repo.governance_policies(organisation_id, policy_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
    assert.equal(await one(`select count(*) from pg_constraint where conrelid='gov_repo.policy_versions'::regclass and contype='f'
      and confrelid='gov_repo.governance_policies'::regclass`), '1', 'the historical CASCADE FK is gone');
    assert.equal(await one(`select string_agg(pg_get_constraintdef(oid), ' | ' order by conname) from pg_constraint
      where conrelid='gov_repo.policy_versions'::regclass and contype in ('u','p')`),
      'UNIQUE (organisation_id, policy_id, version_id, content_hash) | UNIQUE (organisation_id, policy_id, version_id) | PRIMARY KEY (version_id) | UNIQUE (policy_id, version_number)');
    assert.equal(await one(`select count(*) from pg_constraint where conrelid='gov_repo.governance_policies'::regclass and contype='u'
      and pg_get_constraintdef(oid)='UNIQUE (organisation_id, policy_id)'`), '1');
    const content = 'cross tenant';
    await rejects(owner(`insert into gov_repo.policy_versions(policy_id,organisation_id,version_number,version_label,content_markdown,change_summary,created_by)
      values('${pA}','${orgB}',9,'v9',${text(content)},'x','${userB.id}')`), '23503', /policy_versions_organisation_policy_fkey/);
    await rejects(owner(`insert into gov_repo.policy_versions(policy_id,version_number,version_label,content_markdown,change_summary,created_by)
      values('${pA}',9,'v9',${text(content)},'x','${userA.id}')`), '23502', /organisation_id/);
    // A matching-tenant version is accepted; the pair resolves only through the exact tenant tuple.
    const ok = await one(`insert into gov_repo.policy_versions(policy_id,organisation_id,version_number,version_label,content_markdown,change_summary,created_by)
      values('${pA}','${orgA}',3,'v3',${text(content)},'x','${userA.id}') returning organisation_id||':'||content_hash`);
    assert.equal(ok, `${orgA}:${mirror(content)}`);
  });

  await t.test('delete semantics: policy with versions RESTRICTED (FK and guard), version DELETE/TRUNCATE rejected, no cascade erases history', async () => {
    const before = await one(`select count(*) from gov_repo.policy_versions`);
    await rejects(owner(`delete from gov_repo.governance_policies where policy_id='${pA}'`), '55000', /POLICY_STORE_HISTORY_IMMUTABLE/);
    // Even with the history guard bypassed (superuser replica mode disables only non-ALWAYS triggers AND FK
    // enforcement), the ALWAYS guard still fires.
    await rejects(bootstrapSql(`set session_replication_role = replica; delete from gov_repo.governance_policies where policy_id='${pA}'`), '55000');
    // With the guard dropped in a rolled-back transaction, the RESTRICT FK alone still blocks deletion.
    await rejects(bootstrapSql(`begin; drop trigger governance_policies_no_delete on gov_repo.governance_policies;
      delete from gov_repo.governance_policies where policy_id='${pA}'; rollback;`), '23503', /policy_versions_organisation_policy_fkey/);
    await rejects(owner(`delete from gov_repo.policy_versions where version_id='${vA1}'`), '55000', /policy_versions:DELETE/);
    await rejects(owner(`truncate gov_repo.policy_versions`), '0A000'); // the fk_current_version cross-reference stops it first
    await rejects(owner(`truncate gov_repo.policy_versions cascade`), '55000', /:TRUNCATE/);
    await rejects(owner(`truncate gov_repo.governance_policies cascade`), '55000');
    await rejects(bootstrapSql(`truncate gov_repo.organisations cascade`), '55000'); // a cascading TRUNCATE reaches the guards
    await rejects(bootstrapSql(`delete from gov_repo.organisations where organisation_id='${orgB}'`), '23503');
    assert.equal(await one(`select count(*) from gov_repo.policy_versions`), before);
    assert.equal(await one(`select count(*) from pg_constraint where contype='f' and (conrelid='gov_repo.policy_versions'::regclass
      or confrelid='gov_repo.policy_versions'::regclass) and (confdeltype not in ('a','r') or confupdtype not in ('a','r'))`), '0');
  });

  await t.test('hash: exact UTF-8 SHA-256 authored/accepted, mismatch rejected, DB == independent mirror == pgcrypto, no normalization', async () => {
    const insert = (content: string, hash: string | null, n: number) => owner(`insert into gov_repo.policy_versions(policy_id,organisation_id,version_number,
        version_label,content_markdown,content_hash,change_summary,created_by)
      values('${pB}','${orgB}',${n},'v${n}',${text(content)},${hash === null ? 'null' : `'${hash}'`},'x','${userB.id}') returning content_hash`);
    const variants = [
      'Policy', 'Policy ', ' Policy', 'Policy\n', 'Policy\r\n', 'Policy\t', 'policy', 'POLICY', 'Pol  icy',
      'Café', 'Café', '# Heading\n\n- item', '#  Heading\n\n- item', '﻿Policy', '',
    ];
    const hashes = new Set<string>();
    let n = 100;
    for (const content of variants) {
      const expected = mirror(content);
      // Omitted hash -> DB-authored; identical to the independent mirror and to pgcrypto digest.
      assert.equal(lastLine(await insert(content, null, n++)), expected, JSON.stringify(content));
      assert.equal(await one(`select encode(extensions.digest(convert_to(${text(content)},'UTF8'),'sha256'),'hex')`), expected);
      // Exact caller hash accepted.
      assert.equal(lastLine(await insert(content, expected, n++)), expected);
      hashes.add(expected);
    }
    assert.equal(hashes.size, variants.length, 'every byte/text-different content hashes differently (whitespace, newline, CRLF, case, NFC/NFD, BOM)');
    await rejects(insert('Policy', mirror('Policy ').toString(), n++), '23514', /POLICY_VERSION_CONTENT_HASH_MISMATCH/);
    await rejects(insert('Policy', mirror('Policy').toUpperCase(), n++), '23514', /POLICY_VERSION_CONTENT_HASH_MISMATCH/);
    await rejects(insert('Policy', mirror('Policy').slice(0, 63), n++), '23514', /POLICY_VERSION_CONTENT_HASH_MISMATCH/);
    await rejects(insert('Policy\r\n', mirror('Policy\n'), n++), '23514', /POLICY_VERSION_CONTENT_HASH_MISMATCH/);
    // The NOT VALID CHECK backstop still rejects a wrong hash when the guard is dropped (rolled back).
    await rejects(bootstrapSql(`begin; drop trigger policy_versions_content_hash_guard on gov_repo.policy_versions;
      insert into gov_repo.policy_versions(policy_id,organisation_id,version_number,version_label,content_markdown,content_hash,change_summary,created_by)
      values('${pB}','${orgB}',999,'v',${text('x')},repeat('a',64),'x','${userB.id}'); rollback;`), '23514', /policy_versions_content_hash_sha256_utf8_check/);
    assert.equal(await one(`select convalidated from pg_constraint where conname='policy_versions_content_hash_sha256_utf8_check'`), 'f');
  });

  await t.test('historical legacy hashes are NOT rewritten (even non-canonical ones)', async () => {
    assert.equal(await one(`select content_hash from gov_repo.policy_versions where version_id='${vA2}'`), mirror('second').toUpperCase());
    assert.equal(await one(`select content_hash from gov_repo.policy_versions where version_id='${vB1}'`), 'f'.repeat(64));
    assert.equal(await one(`select content_hash from gov_repo.policy_versions where version_id='${vA1}'`), mirror(legacyContent));
    assert.equal(await one(versionsSnapshot.replace('from gov_repo.policy_versions v', `from gov_repo.policy_versions v where v.version_id in ('${vA1}','${vA2}','${vB1}')`)),
      versionsBefore);
  });

  await t.test('D-5: UPDATE of EVERY policy_versions column raises 55000 (legacy status/approval, content, hash, identity, tenant, provenance)', async () => {
    const assignments = [
      `version_id=gen_random_uuid()`, `policy_id='${pB}'`, `organisation_id='${orgB}'`, `version_number=42`, `version_label='x'`,
      `content_markdown='changed'`, `content_hash=repeat('0',64)`, `change_summary='x'`, `status='approved'`, `status='draft'`,
      `reviewed_by='${userA.id}'`, `approved_by=null, approval_date=null`, `approval_date=now(), approved_by='${userA.id}'`,
      `qes_signature_id=null`, `ledger_entry_seq=null`, `created_at=now()`, `created_by='${userB.id}'`, `status=status`,
    ];
    const columns = (await one(`select string_agg(attname, ',' order by attnum) from pg_attribute
      where attrelid='gov_repo.policy_versions'::regclass and attnum>0 and not attisdropped`)).split(',');
    for (const column of columns) assert.ok(assignments.some(a => a.startsWith(`${column}=`) || a.includes(` ${column}=`)), `covers ${column}`);
    for (const assignment of assignments) {
      await rejects(owner(`update gov_repo.policy_versions set ${assignment} where version_id='${vA1}'`), '55000', /policy_versions:UPDATE/);
    }
    await rejects(bootstrapSql(`set session_replication_role = replica; update gov_repo.policy_versions set status='rejected' where version_id='${vA1}'`),
      '55000', /policy_versions:UPDATE/); // ALWAYS triggers survive superuser replica mode
    await owner(`create view gov_repo.negctl_pv_view as select * from gov_repo.policy_versions`);
    try {
      await rejects(owner(`update gov_repo.negctl_pv_view set status='rejected' where version_id='${vA1}'`), '55000', /policy_versions:UPDATE/);
      await rejects(owner(`delete from gov_repo.negctl_pv_view where version_id='${vA1}'`), '55000', /policy_versions:DELETE/);
    } finally { await owner(`drop view gov_repo.negctl_pv_view`); }
    assert.equal(await one(versionsSnapshot.replace('from gov_repo.policy_versions v', `from gov_repo.policy_versions v where v.version_id in ('${vA1}','${vA2}','${vB1}')`)),
      versionsBefore, 'nothing changed');
  });

  await t.test('governance_policies: identity/provenance immutable, DELETE/TRUNCATE rejected; legacy descriptive edits allowed and create no M16 authority', async () => {
    for (const assignment of [`policy_id=gen_random_uuid()`, `organisation_id='${orgA}'`, `created_at=now()`, `created_by='${userA.id}'`]) {
      await rejects(owner(`update gov_repo.governance_policies set ${assignment} where policy_id='${pB}'`), '55000', /IDENTITY_OR_PROVENANCE/);
    }
    await rejects(owner(`delete from gov_repo.governance_policies where policy_id='${pB}'`), '55000');
    await rejects(owner(`truncate gov_repo.governance_policies`), '0A000');
    await rejects(owner(`truncate gov_repo.governance_policies cascade`), '55000', /:TRUNCATE/);
    // A policy without versions is still never deleted.
    const lonely = await policy(orgA, userA.id, 'POL-EMPTY');
    await rejects(owner(`delete from gov_repo.governance_policies where policy_id='${lonely}'`), '55000');
    const l14 = await one(l14Total);
    await owner(`update gov_repo.governance_policies set title='Renamed', description='d', status='deprecated', policy_code='POL-B2',
      owner_user_id='${userB.id}', approver_user_id='${userB.id}' where policy_id='${pB}'`);
    assert.equal(await one(`select title||':'||status||':'||(updated_at > created_at) from gov_repo.governance_policies where policy_id='${pB}'`),
      'Renamed:deprecated:true', 'legacy descriptive fields remain mutable legacy data (updated_at trigger intact)');
    assert.equal(await one(l14Total), l14, 'a legacy status change creates no L14 row');
  });

  await t.test('owner_user_id constraint unchanged (D-4 deferred); current_version_id is legacy/inert (never consumed by S1B.2)', async () => {
    assert.equal(await one(`select attnotnull from pg_attribute where attrelid='gov_repo.governance_policies'::regclass and attname='owner_user_id'`), 't');
    assert.equal(await one(`select pg_get_constraintdef(oid) from pg_constraint where conname='governance_policies_owner_user_id_fkey'`),
      'FOREIGN KEY (owner_user_id) REFERENCES gov_repo.governance_users(user_id)');
    assert.equal(await one(`select count(*) from pg_proc where (proname like 'policy\\_store\\_%' or proname like 'l14\\_%') and prosrc ~ 'current_version_id'`), '0');
    assert.equal(await one(`select pg_get_constraintdef(oid) from pg_constraint where conname='fk_current_version'`),
      'FOREIGN KEY (current_version_id) REFERENCES gov_repo.policy_versions(version_id) DEFERRABLE INITIALLY DEFERRED', 'legacy pointer kept for legacy consumers');
    // Repointing the legacy pointer is a legacy descriptive edit: it validates nothing and creates no L14 row.
    const l14 = await one(l14Total);
    await owner(`update gov_repo.governance_policies set current_version_id='${vA2}' where policy_id='${pA}'`);
    assert.equal(await one(l14Total), l14);
  });

  await t.test('D-13: pre-existing hostile grants, the legacy bridge view and the legacy definer routine are all closed', async () => {
    for (const role of ['anon', 'authenticated', 'service_role'] as const) {
      for (const statement of [`select 1 from gov_repo.policy_versions limit 1`, `select 1 from gov_repo.governance_policies limit 1`,
        `select content_markdown from gov_repo.policy_versions limit 1`, `update gov_repo.policy_versions set status='draft'`,
        `insert into gov_repo.governance_policies default values`, `delete from gov_repo.policy_versions`, `truncate gov_repo.policy_versions`,
        `select 1 from public.gov_governance_policies limit 1`, `update public.gov_governance_policies set title='x'`,
        `select gov_repo.legacy_policy_score(gen_random_uuid())`]) {
        await rejects(sql(statement, role), '42501', undefined);
      }
    }
    // Consequence recorded for the audit: the invoker mapping trigger (20260901134812) reads governance_policies,
    // so service_role can no longer write policy_mandate_mappings directly either.
    await rejects(sql(`insert into gov_repo.policy_mandate_mappings(policy_id, mandate_id)
      select '${pA}', mandate_id from gov_repo.mandates limit 1`, 'service_role'), '42501');
  });
});
