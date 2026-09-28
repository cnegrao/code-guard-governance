import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  contractRawRpcRevocationMigration, credentialMigration, disposableM16Postgres, eligibilityMigration,
  epochBindingMigration, governedWriteWrapperMigration, objectMaterializationCompatMigration,
} from '../helpers/disposable-m16-postgres';
import * as fx from '../helpers/m16-governed-write-fixtures';

const lastLine = (out: string) => out.replace(/\r/g, '').trim().split('\n').pop() as string;

/**
 * M16-S0.3.3D — CONTRACT phase ACL proof.
 *
 * Proves, against a real disposable PostgreSQL 17 cluster (never migration text
 * alone), that after the D revocation migration:
 *  A. service_role can no longer execute any of the seven raw write RPCs;
 *  B. service_role retains EXECUTE on all six governed *_governed_v1 wrappers;
 *  C/D/E. PUBLIC/anon/authenticated can execute neither the raw functions nor
 *     the wrappers (and never could);
 *  F. the private guard (require_governed_write_eligibility_v1) remains
 *     owner-only, deniable to service_role/PUBLIC/anon/authenticated;
 *  G. a governed wrapper still successfully executes a valid HUMAN write for a
 *     current GOVERNANCE_ADMIN actor;
 *  H. a governed wrapper still returns GV006 for a current non-admin actor;
 *  I. no direct raw-RPC bypass remains for a HUMAN write (A, restated at the
 *     level of the exact same actor/session that G proves can write through
 *     the wrapper).
 */

// Dummy positional arguments sufficient only to reach PostgreSQL's permission
// check (which fires before the function body ever executes); their VALUES are
// never meant to satisfy any business rule.
function dummyArg(type: string): string {
  switch (type) {
    case 'uuid': return `'11111111-1111-1111-1111-111111111111'::uuid`;
    case 'timestamptz': return 'now()';
    case 'text[]': return `'{}'::text[]`;
    case 'jsonb': return `'{}'::jsonb`;
    case 'char': return `'x'::char`;
    case 'text': return `'x'`;
    default: throw new Error(`unhandled dummy arg type: ${type}`);
  }
}
const dummyCall = (name: string, types: string[]) => `select ${name}(${types.map(dummyArg).join(', ')})`;

const RAW_SIGNATURES: Record<string, string[]> = {
  'gov_repo.apply_review_transition':
    ['uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'timestamptz', 'text[]', 'text', 'text', 'text'],
  'gov_repo.record_authorization_decision':
    ['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'timestamptz', 'text'],
  'gov_repo.record_authorized_reconciliation':
    ['uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'timestamptz', 'text', 'text', 'text', 'text', 'timestamptz',
      'text', 'text', 'text', 'text', 'text', 'text', 'timestamptz', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
      'text[]', 'text[]', 'text[]', 'text', 'jsonb', 'char'],
  'gov_repo.materialize_object_reconciliation':
    ['uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'char', 'timestamptz'],
  'gov_repo.materialize_relationship_reconciliation':
    ['uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'timestamptz', 'timestamptz', 'char'],
  'gov_repo.record_technical_field_decision': ['uuid', 'jsonb'],
  'gov_repo.record_execution_field_decision': ['uuid', 'jsonb'],
};
const RAW_NAMES = Object.keys(RAW_SIGNATURES);
const GUARD_SIG = 'gov_repo.require_governed_write_eligibility_v1(uuid, uuid, bigint, bigint, timestamptz)';

test('M16 S0.3.3D canonical disposable PG17 contract-phase raw RPC revocation', { timeout: 600_000 }, async t => {
  const pg = await disposableM16Postgres(message => t.diagnostic(message), { governanceWriteChain: true });
  const { sql, bootstrapSql, migrate } = pg;
  t.after(() => pg.stop());
  await migrate(credentialMigration);
  await migrate(eligibilityMigration);
  await migrate(epochBindingMigration);
  await migrate(objectMaterializationCompatMigration);
  await migrate(governedWriteWrapperMigration);
  await migrate(contractRawRpcRevocationMigration);

  const owner = (query: string) => sql(query, 'postgres');
  const svc = (query: string) => sql(query, 'service_role');
  const rejects = (query: string, code: string, role: 'service_role' | 'anon' | 'authenticated' = 'service_role') =>
    assert.rejects(sql(query, role), (error: Error) => {
      assert.match(error.message, new RegExp(code), `${role}: ${query} -> ${error.message}`);
      return true;
    }, `${role} must be denied: ${query}`);

  await t.test('A/I: service_role can no longer execute any of the seven raw write RPCs (no direct-RPC bypass remains)', async () => {
    for (const name of RAW_NAMES) {
      await rejects(dummyCall(name, RAW_SIGNATURES[name]!), '42501', 'service_role');
    }
  });

  await t.test('C/D/E: PUBLIC/anon/authenticated can execute none of the seven raw write RPCs (aclexplode + has_function_privilege, real catalog state)', async () => {
    for (const name of RAW_NAMES) {
      const oidLiteral = `'${name}(${RAW_SIGNATURES[name]!.join(', ')})'::regprocedure`;
      assert.equal(await sql(`select count(*) from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=${oidLiteral} and a.privilege_type='EXECUTE' and a.grantee=0`), '0', `${name}: PUBLIC must have no EXECUTE`);
      for (const role of ['anon', 'authenticated'] as const) {
        assert.equal(await sql(`select has_function_privilege('${role}',${oidLiteral},'EXECUTE')`), 'f', `${name}: ${role} must have no EXECUTE`);
        await rejects(dummyCall(name, RAW_SIGNATURES[name]!), '42501', role);
      }
    }
  });

  await t.test('B: service_role retains EXECUTE on all six governed wrappers, unchanged by the D revocation', async () => {
    const oids = (await sql(`select p.oid from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname like '%\\_governed\\_v1'`))
      .split('\n').map(s => s.trim()).filter(Boolean);
    assert.equal(oids.length, 6, 'exactly six governed wrappers must exist');
    for (const oid of oids) {
      assert.equal(await sql(`select has_function_privilege('service_role',${oid},'EXECUTE')`), 't', `wrapper oid ${oid}: service_role must retain EXECUTE`);
    }
  });

  await t.test('C/D/E (wrappers): PUBLIC/anon/authenticated cannot execute any governed wrapper, unchanged by the D revocation', async () => {
    const oids = (await sql(`select p.oid from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname like '%\\_governed\\_v1'`))
      .split('\n').map(s => s.trim()).filter(Boolean);
    for (const oid of oids) {
      assert.equal(await sql(`select count(*) from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=${oid} and a.privilege_type='EXECUTE' and a.grantee=0`), '0', `wrapper oid ${oid}: PUBLIC must have no EXECUTE`);
      for (const role of ['anon', 'authenticated'] as const) {
        assert.equal(await sql(`select has_function_privilege('${role}',${oid},'EXECUTE')`), 'f', `wrapper oid ${oid}: ${role} must have no EXECUTE`);
      }
    }
  });

  await t.test('F: the private guard remains owner-only — denied to service_role/PUBLIC/anon/authenticated, unchanged by the D revocation', async () => {
    for (const role of ['service_role', 'anon', 'authenticated'] as const) {
      assert.equal(await sql(`select has_function_privilege('${role}','${GUARD_SIG}'::regprocedure,'EXECUTE')`), 'f', `guard: ${role} must have no EXECUTE`);
      await rejects(`select ${GUARD_SIG.replace(/\(.*$/, '')}('11111111-1111-1111-1111-111111111111'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,1::bigint,2::bigint,now())`, '42501', role);
    }
    assert.equal(await sql(`select count(*) from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid='${GUARD_SIG}'::regprocedure and a.privilege_type='EXECUTE' and a.grantee <> p.proowner`), '0', 'guard: only its owner may hold EXECUTE');
  });

  // ---------------------------------------------------------------------------
  // G/H: an actual governed write still succeeds for a current admin, and is
  // still denied (GV006) for a current non-admin — proving the six-wrapper
  // path is fully intact after the seven-function contraction.
  // ---------------------------------------------------------------------------
  const roles = 'gov_repo.governance_roles';
  const users = 'gov_repo.governance_users';
  const orgs = 'gov_repo.organisations';
  const trigger = 'trg_governance_users_credential_epoch_v1';
  const adminRole = await sql(`select role_id from ${roles} where role_code='GOVERNANCE_ADMIN' and is_system_role`);
  let orgCounter = 0;
  async function newOrg() {
    const id = randomUUID();
    const n = ++orgCounter;
    await owner(`insert into ${orgs}(organisation_id,org_code,legal_name,display_name,country_code,is_active) values('${id}','DDD_${n}','D ${n}','D ${n}','PT',true)`);
    return id;
  }
  const setEpoch = (id: string, expression: string) => bootstrapSql(`begin;
    alter table ${users} disable trigger ${trigger};
    update ${users} set password_changed_at=${expression} where user_id='${id}';
    alter table ${users} enable always trigger ${trigger}; commit;`);
  async function mkUser(roleIds: string, org: string) {
    const id = randomUUID();
    await sql(`insert into ${users}(user_id,email,full_name,organisation_id,status,role_ids) values('${id}','${id}@example.invalid','Fixture','${org}','active',${roleIds})`);
    await setEpoch(id, `clock_timestamp() - interval '12 hours'`);
    const epoch = await owner(`select password_changed_at::text from ${users} where user_id='${id}'`);
    return { id, epoch: `'${epoch}'::timestamptz` };
  }
  const principalArgs = (org: string, actor: string, epoch: string) => ({
    p_verified_organisation_id: `'${org}'::uuid`, p_verified_actor_user_id: `'${actor}'::uuid`,
    p_verified_session_iat: '(floor(extract(epoch from clock_timestamp()))::bigint - 10)',
    p_verified_session_exp: '(floor(extract(epoch from clock_timestamp()))::bigint + 3600)',
    p_verified_credential_epoch: epoch,
  });

  await t.test('G: a governed wrapper still successfully executes a valid HUMAN write for a current GOVERNANCE_ADMIN actor', async () => {
    const org = await newOrg();
    const user = await mkUser(`array['${adminRole}']::uuid[]`, org);
    const kit = fx.reviewedObjectKit(org, 'ddd-g', 'DETECTED');
    await owner(kit.sql);
    const args = { ...principalArgs(org, user.id, user.epoch), ...fx.reviewTransitionArgs('ddd-g', kit) };
    const row = JSON.parse(lastLine(await svc(`select to_json(w) from gov_repo.apply_review_transition_governed_v1(${fx.named(args)}) w;`)));
    assert.equal(row.replay, false, 'the write actually happened (not a replay)');
    assert.equal(row.new_state, 'PROPOSED');
  });

  await t.test('H: a governed wrapper still returns GV006 for a current non-admin actor (never a fabricated success, never a raw-RPC fallback)', async () => {
    const org = await newOrg();
    const nonAdminRole = randomUUID();
    await owner(`insert into ${roles}(role_id,role_code,role_name,role_tier,is_system_role) values('${nonAdminRole}','D_NON_ADMIN','Non-admin','organisation',false)`);
    const user = await mkUser(`array['${nonAdminRole}']::uuid[]`, org);
    const kit = fx.reviewedObjectKit(org, 'ddd-h', 'DETECTED');
    await owner(kit.sql);
    const args = { ...principalArgs(org, user.id, user.epoch), ...fx.reviewTransitionArgs('ddd-h', kit) };
    await assert.rejects(svc(`select to_json(w) from gov_repo.apply_review_transition_governed_v1(${fx.named(args)}) w;`),
      (error: Error) => { assert.match(error.message, /GV006[\s\S]*M16_WRITE_AUTHORITY_DENIED/); return true; });
    // And the raw RPC is not a viable fallback for this same actor/session either.
    await rejects(dummyCall('gov_repo.apply_review_transition', RAW_SIGNATURES['gov_repo.apply_review_transition']!), '42501', 'service_role');
  });
});
