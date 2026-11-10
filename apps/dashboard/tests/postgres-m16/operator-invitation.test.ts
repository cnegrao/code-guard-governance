import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hash, compare } from 'bcryptjs';
import { disposableM16Postgres, credentialMigration } from '../helpers/disposable-m16-postgres';

const migration = '20261108002618_governance_operator_invitation_v1.sql';
const org = 'a0000000-0000-4000-8000-000000000001';
const other = 'a0000000-0000-4000-8000-000000000002';
const quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
test('operator invitations: real disposable PG17 identity, ACLs, expiry, atomic consumption and traceability', { timeout: 120000 }, async t => {
  const pg = await disposableM16Postgres(message => t.diagnostic(message));
  t.after(() => pg.stop());
  const { sql, migrate } = pg;
  await migrate(credentialMigration);
  // The existing helper pins historical horizons. Apply this new additive
  // migration verbatim only in this explicit successor test.
  await sql(readFileSync(new URL(`../../../../supabase/migrations/${migration}`, import.meta.url), 'utf8'), 'postgres');
  await sql(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code) values
    ('${org}','INVITE_TEST','Local invitation fixture','Fixture','BR'),('${other}','OTHER_TEST','Other fixture','Other','BR');`, 'postgres');
  const password = randomBytes(24).toString('base64url'); // Disposable fixture only, never a hosted operator credential.
  const credential = 'bcrypt:' + await hash(password, 12);
  const token = () => createHash('sha256').update(randomBytes(32)).digest('hex');
  const issueSql = (email: string, digest: string, orgId = org, code = 'INVITE_TEST', expiry = "clock_timestamp()+interval '1 hour'") =>
    `select gov_repo.issue_governance_operator_invitation_v1('${orgId}','${code}',${quote(email)},'Local fixture',${quote(digest)},${expiry},'Disposable administrative test');`;
  const preview = (digest: string) => sql(`select gov_repo.preview_governance_operator_invitation_v1(${quote(digest)});`);
  const redeem = (digest: string, value = credential) => sql(`select gov_repo.redeem_governance_operator_invitation_v1(${quote(digest)},${quote(value)});`);
  await t.test('only the database administrator can issue; public roles cannot inspect or redeem', async () => {
    for (const role of ['service_role','anon','authenticated'] as const) await assert.rejects(sql(issueSql('denied@example.invalid',token()),role), /permission denied/);
    for (const role of ['anon','authenticated'] as const) {
      await assert.rejects(sql(`select gov_repo.preview_governance_operator_invitation_v1('${token()}')`,role), /permission denied/);
      await assert.rejects(sql(`select * from gov_repo.governance_operator_invitations_v1`,role), /permission denied/);
    }
    assert.equal(await sql(`select count(*) from gov_repo.governance_operator_invitations_v1`), '0');
  });
  const first = token();
  await t.test('org pin, expiry and pre-existing identities fail closed without new users', async () => {
    await assert.rejects(sql(issueSql('pin@example.invalid',token(),org,'WRONG'), 'postgres'), /OPERATOR_ORGANISATION_UNAVAILABLE/);
    await assert.rejects(sql(issueSql('expired@example.invalid',token(),org,'INVITE_TEST',"clock_timestamp()-interval '1 second'"), 'postgres'), /check constraint/);
    await assert.rejects(sql(issueSql('long@example.invalid',token(),org,'INVITE_TEST',"clock_timestamp()+interval '25 hours'"), 'postgres'), /check constraint/);
    await sql(`insert into gov_repo.governance_users(email,full_name,organisation_id) values('existing@example.invalid','Existing fixture','${other}')`);
    await assert.rejects(sql(issueSql('existing@example.invalid',token()), 'postgres'), /OPERATOR_IDENTITY_ALREADY_EXISTS/);
    assert.equal(await sql(`select organisation_id::text from gov_repo.governance_users where email='existing@example.invalid'`), other);
    assert.equal(await sql(`select count(*) from gov_repo.governance_users where organisation_id='${org}'`), '0');
  });
  await t.test('issuance binds safe metadata and audit; preview never carries hash or raw capability', async () => {
    const receipt = JSON.parse(await sql(issueSql('operator@example.invalid',first),'postgres'));
    assert.equal(receipt.organisationId,org);
    assert.equal(receipt.token_hash,undefined);
    const view = JSON.parse(await preview(first));
    assert.equal(view.email,'operator@example.invalid'); assert.equal(view.organisationCode,'INVITE_TEST'); assert.equal(view.roleCode,'GOVERNANCE_ADMIN');
    assert.equal(JSON.stringify(view).includes(first),false);
    assert.equal(await sql(`select issued_by_db_role||':'||issued_by_session_user from gov_repo.governance_operator_invitations_v1 where token_hash='${first}'`),'postgres:postgres');
    await assert.rejects(sql(`update gov_repo.governance_operator_invitations_v1 set email='attacker@example.invalid' where token_hash='${first}'`),/permission denied/);
    await assert.rejects(sql(`update gov_repo.governance_operator_invitations_v1 set organisation_id='${other}' where token_hash='${first}'`,'postgres'),/OPERATOR_INVITATION_IMMUTABLE/);
    await assert.rejects(redeem(first,'bcrypt:not-a-password-hash'),/OPERATOR_PASSWORD_HASH_INVALID/);
    await assert.rejects(redeem(token()),/OPERATOR_INVITATION_UNAVAILABLE/);
    assert.equal(await sql(`select count(*) from gov_repo.governance_users where organisation_id='${org}'`),'0');
  });
  await t.test('two simultaneous consumers create exactly one real row with a DB-authored epoch', async () => {
    const results = await Promise.allSettled([redeem(first),redeem(first)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    const user = JSON.parse(await sql(`select row_to_json(u) from (select user_id,email,organisation_id,external_id,password_changed_at,status,role_ids from gov_repo.governance_users where email='operator@example.invalid') u`));
    assert.equal(user.organisation_id,org); assert.equal(user.status,'active');
    assert.equal(await compare(password,user.external_id.slice(7)),true);
    assert.ok(user.password_changed_at);
    assert.equal(await sql(`select count(*) from gov_repo.governance_roles where role_code='GOVERNANCE_ADMIN' and is_system_role and role_id='${user.role_ids[0]}'`),'1');
    assert.equal(await sql(`select state||':'||redeemed_by_db_role from gov_repo.governance_operator_invitations_v1 where token_hash='${first}'`),'REDEEMED:service_role');
    await assert.rejects(preview(first),/OPERATOR_INVITATION_UNAVAILABLE/);
    await assert.rejects(redeem(first),/OPERATOR_INVITATION_UNAVAILABLE/);
    await assert.rejects(sql(`update gov_repo.governance_operator_invitations_v1 set state='REVOKED' where token_hash='${first}'`,'postgres'),/OPERATOR_INVITATION_IMMUTABLE/);
    await assert.rejects(sql(`delete from gov_repo.governance_operator_invitations_v1`,'postgres'),/OPERATOR_INVITATION_IMMUTABLE/);
    assert.equal(await sql('select count(*) from gov_repo.organisations'),'2');
  });
  await t.test('reissue revokes the old capability; later org inactivity and role revocation deny activation', async () => {
    const old=token(), next=token();
    await sql(issueSql('reissue@example.invalid',old),'postgres');
    await sql(issueSql('reissue@example.invalid',next),'postgres');
    await assert.rejects(preview(old),/OPERATOR_INVITATION_UNAVAILABLE/);
    assert.equal(await sql(`select count(*) from gov_repo.governance_operator_invitations_v1 where token_hash='${old}' and state='REVOKED' and revoked_at is not null`),'1');
    await sql(`update gov_repo.organisations set is_active=false where organisation_id='${org}'`,'postgres');
    await assert.rejects(redeem(next),/OPERATOR_INVITATION_UNAVAILABLE/);
    await sql(`update gov_repo.organisations set is_active=true where organisation_id='${org}'; update gov_repo.governance_roles set is_system_role=false where role_code='GOVERNANCE_ADMIN'`,'postgres');
    await assert.rejects(redeem(next),/OPERATOR_INVITATION_UNAVAILABLE/);
    assert.equal(await sql(`select count(*) from gov_repo.governance_users where email='reissue@example.invalid'`),'0');
    await sql(`update gov_repo.governance_roles set is_system_role=true where role_code='GOVERNANCE_ADMIN'`,'postgres');
  });
  await t.test('real expiry denies consumption and preserves an unused receipt', async () => {
    const short=token();
    await sql(issueSql('short@example.invalid',short,org,'INVITE_TEST',"clock_timestamp()+interval '0.2 seconds'"),'postgres');
    await sql('select pg_sleep(0.25)');
    await assert.rejects(redeem(short),/OPERATOR_INVITATION_UNAVAILABLE/);
    assert.equal(await sql(`select state from gov_repo.governance_operator_invitations_v1 where token_hash='${short}'`),'ISSUED');
    assert.equal(await sql(`select count(*) from gov_repo.governance_users where email='short@example.invalid'`),'0');
  });
});
