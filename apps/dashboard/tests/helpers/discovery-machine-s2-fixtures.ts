import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fullChainCluster, r1PostflightAfterR2, r2Postflight, r3Postflight, s1b2Postflight } from './m16-definer-surface-fixtures';

export const S2_MIGRATION = '20261002190148_discovery_machine_s2_control_plane_v1.sql';
export const s2Source = () => readFileSync(new URL(`../../../../supabase/migrations/${S2_MIGRATION}`, import.meta.url), 'utf8');
export const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
export const TABLES = ['machine_principals','machine_credential_generations','machine_execution_bindings','machine_binding_revisions','machine_invocation_audit'];
export const RAW = ['apply_review_transition','record_authorized_reconciliation','materialize_object_reconciliation',
  'materialize_relationship_reconciliation','record_technical_field_decision','record_execution_field_decision','record_authorization_decision'];
export async function s2Cluster(diagnostic: (message: string) => void) {
  const pg = await fullChainCluster(diagnostic, { r3: true });
  try {
    // Every original postflight runs verbatim on the unchanged historical horizon.
    await pg.owner(s1b2Postflight()); await pg.owner(r1PostflightAfterR2());
    await pg.owner(r2Postflight()); await pg.owner(r3Postflight());
    const before = await pg.inventory();
    const human = before.filter(p => p.app);
    assert.equal(human.length, 22);
    // Hostile creator defaults: S2 must close actual inherited ACLs, not rely on intended defaults/RLS.
    await pg.owner(`alter default privileges for role postgres in schema gov_repo grant all on tables to public,anon,authenticated,service_role;
      alter default privileges for role postgres in schema gov_repo grant all on sequences to public,anon,authenticated,service_role`);
    await pg.owner(s2Source());
    assert.deepEqual((await pg.inventory()).filter(p => !p.name.startsWith('machine_')), before);
    await pg.owner(s1b2Postflight()); await pg.owner(r1PostflightAfterR2());
    await pg.owner(r2Postflight()); await pg.owner(r3Postflight());
    const text=s2Source();
    const post=text.slice(text.indexOf('DO $postflight$'),text.indexOf('$postflight$;')+'$postflight$;'.length);
    // Each injected drift is rolled back when psql exits on the expected postflight exception.
    for (const attack of [
      'grant select on gov_repo.machine_principals to service_role',
      'grant truncate on gov_repo.machine_invocation_audit to public',
      'grant execute on function gov_repo.machine_lock_eligibility_v1(uuid,bigint) to public',
      'grant create on schema gov_repo to govia_discovery_control_owner',
      'alter table gov_repo.machine_principals disable row level security',
    ]) await assert.rejects(pg.bootstrapSql(`begin; ${attack}; ${post}; rollback`),/S2_POSTFLIGHT/);
    await pg.owner(post);
    // The existing runtime accepts a role string and passes it as psql -U (no SET ROLE).
    // Its historical TS union stays unchanged; only this S2 fixture widens that type.
    const login = (query: string, role: string) => pg.sql(query, role as Parameters<typeof pg.sql>[1]);
    const loginSession = (role: string) => pg.session(role as Parameters<typeof pg.session>[0]);
    return { ...pg, login, loginSession, human };
  } catch (error) { pg.stop(); throw error; }
}
