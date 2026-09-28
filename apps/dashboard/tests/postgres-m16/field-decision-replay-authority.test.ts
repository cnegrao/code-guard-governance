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
 * M16-S0.3.3R3 — closes Finding H-1 at the real database layer: proves that
 * record_technical_field_decision_governed_v1 and
 * record_execution_field_decision_governed_v1's own replay/idempotency
 * arbitration (inside gov_repo.record_technical_field_decision /
 * gov_repo.record_execution_field_decision) cooperates correctly with the
 * outer require_governed_write_eligibility_v1 guard: an identical replay of
 * an already-persisted decision still re-checks CURRENT authority, and is
 * denied (GV006 / GV002) exactly like a first-time write would be, never
 * silently accepted because the row already exists.
 */
test('M16 S0.3.3R3 canonical disposable PG17 technical/execution field decision replay authority', { timeout: 600_000 }, async t => {
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
  const roles = 'gov_repo.governance_roles';
  const users = 'gov_repo.governance_users';
  const orgs = 'gov_repo.organisations';
  const trigger = 'trg_governance_users_credential_epoch_v1';
  const adminRole = await sql(`select role_id from ${roles} where role_code='GOVERNANCE_ADMIN' and is_system_role`);
  const nonAdminRole = randomUUID();
  await owner(`insert into ${roles}(role_id,role_code,role_name,role_tier,is_system_role) values('${nonAdminRole}','R3_NON_ADMIN','Non-admin','organisation',false)`);

  let orgCounter = 0;
  async function newOrg() {
    const id = randomUUID();
    const n = ++orgCounter;
    await owner(`insert into ${orgs}(organisation_id,org_code,legal_name,display_name,country_code,is_active) values('${id}','R3_${n}','R3 ${n}','R3 ${n}','PT',true)`);
    return id;
  }
  const setEpoch = (id: string, expression: string) => bootstrapSql(`begin;
    alter table ${users} disable trigger ${trigger};
    update ${users} set password_changed_at=${expression} where user_id='${id}';
    alter table ${users} enable always trigger ${trigger}; commit;`);
  async function mkUser(org: string) {
    const id = randomUUID();
    await sql(`insert into ${users}(user_id,email,full_name,organisation_id,status,role_ids) values('${id}','${id}@example.invalid','Fixture','${org}','active',array['${adminRole}']::uuid[])`);
    await setEpoch(id, `clock_timestamp() - interval '12 hours'`);
    const epoch = await owner(`select password_changed_at::text from ${users} where user_id='${id}'`);
    return { id, epoch: `'${epoch}'::timestamptz` };
  }
  const revokeAdmin = (userId: string) => owner(`update ${users} set role_ids=array['${nonAdminRole}']::uuid[] where user_id='${userId}'`);
  const rotateCredential = (userId: string) => setEpoch(userId, `clock_timestamp()`);

  const principalArgs = (org: string, actor: string, epoch: string) => ({
    p_verified_organisation_id: `'${org}'::uuid`, p_verified_actor_user_id: `'${actor}'::uuid`,
    p_verified_session_iat: '(floor(extract(epoch from clock_timestamp()))::bigint - 10)',
    p_verified_session_exp: '(floor(extract(epoch from clock_timestamp()))::bigint + 3600)',
    p_verified_credential_epoch: epoch,
  });
  const rejectsGv = (query: string, code: string) => assert.rejects(svc(query), (error: Error) => {
    assert.match(error.message, new RegExp(code), error.message);
    return true;
  });

  interface FamilyUnderTest {
    readonly label: string;
    readonly wrapper: string;
    readonly table: 'technical_field_decisions' | 'execution_field_decisions';
    buildDecisionSql(org: string, kitLabel: string, id: string, actor: string): { readonly sql: string; readonly decisionArg: string };
  }
  const families: FamilyUnderTest[] = [
    {
      label: 'D-technical-field-decision', wrapper: 'record_technical_field_decision_governed_v1', table: 'technical_field_decisions',
      buildDecisionSql(org, kitLabel, id, actor) {
        const kit = fx.technicalKit(org, kitLabel);
        return { sql: kit.sql, decisionArg: fx.jsonLit(kit.decision(id, actor)) };
      },
    },
    {
      label: 'E-execution-field-decision', wrapper: 'record_execution_field_decision_governed_v1', table: 'execution_field_decisions',
      buildDecisionSql(org, kitLabel, id, actor) {
        const kit = fx.executionKit(org, kitLabel);
        return { sql: kit.sql, decisionArg: fx.jsonLit(kit.decision(id, actor)) };
      },
    },
  ];

  for (const fam of families) {
    await t.test(`${fam.label}: A (first write) / B (identical replay) / C (admin revoked) / D (stale credential epoch)`, async () => {
      // ---- A + B: same org/user throughout, since only the actor's CURRENT
      // authority (not the decision content) is what changes between calls. ----
      const orgAB = await newOrg();
      const userAB = await mkUser(orgAB);
      const built = fam.buildDecisionSql(orgAB, 'ab', `decision-${fam.label}-ab`, userAB.id);
      await owner(built.sql);
      const callAB = (epoch = userAB.epoch) =>
        `select to_json(w) from gov_repo.${fam.wrapper}(${fx.named({ ...principalArgs(orgAB, userAB.id, epoch), p_decision: built.decisionArg })}) w;`;

      const first = JSON.parse(lastLine(await svc(callAB())));
      assert.equal(first.replay, false, `${fam.label} A: first write must not be a replay`);

      const replay = JSON.parse(lastLine(await svc(callAB())));
      assert.equal(replay.replay, true, `${fam.label} B: an identical replay through the governed wrapper must report replay=true`);
      assert.equal(replay.state_id, first.state_id, `${fam.label} B: replay must return the SAME persisted state, never a new one`);

      // ---- C: revoke GOVERNANCE_ADMIN, then replay the IDENTICAL decision. ----
      await revokeAdmin(userAB.id);
      await rejectsGv(callAB(), 'GV006');
      // No new mutation and no fabricated replay success occurred.
      const afterRevoke = await owner(`select count(*) from gov_repo.${fam.table} where organisation_id='${orgAB}'`);
      assert.equal(afterRevoke, '1', `${fam.label} C: the GV006 denial must not have produced a second row or any mutation`);

      // ---- D: fresh org/user (credential rotation must not affect A/B/C's org). ----
      const orgD = await newOrg();
      const userD = await mkUser(orgD);
      const builtD = fam.buildDecisionSql(orgD, 'd', `decision-${fam.label}-d`, userD.id);
      await owner(builtD.sql);
      const callD = (epoch: string) =>
        `select to_json(w) from gov_repo.${fam.wrapper}(${fx.named({ ...principalArgs(orgD, userD.id, epoch), p_decision: builtD.decisionArg })}) w;`;

      const firstD = JSON.parse(lastLine(await svc(callD(userD.epoch))));
      assert.equal(firstD.replay, false, `${fam.label} D: first write (pre-rotation) must not be a replay`);

      const staleEpoch = userD.epoch;
      await rotateCredential(userD.id);
      // Submit the IDENTICAL decision again, but with the caller still presenting the OLD (now-stale) principal epoch.
      await rejectsGv(callD(staleEpoch), 'GV002');
      const afterRotate = await owner(`select count(*) from gov_repo.${fam.table} where organisation_id='${orgD}'`);
      assert.equal(afterRotate, '1', `${fam.label} D: the GV002 denial must not have produced a second row or any mutation`);
    });
  }
});
