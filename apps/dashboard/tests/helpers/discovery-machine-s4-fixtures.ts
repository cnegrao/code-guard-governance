import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { s3Cluster } from './discovery-machine-s3-fixtures';

export const S4_MIGRATION = '20261006134858_discovery_machine_propose_worker_v1.sql';
export const s4Source = () => readFileSync(new URL(`../../../../supabase/migrations/${S4_MIGRATION}`, import.meta.url), 'utf8');
export const isS4 = process.env.M16_DISCOVERY_HORIZON === 'S4';
export const horizon = isS4 ? 'S4' : 'S3';

/** Extend the existing adversarial fixture; preserve the historical S3 default. */
export async function s4Cluster(diagnostic: (message: string) => void) {
  const pg = await s3Cluster(diagnostic);
  try {
    const human = (await pg.inventory()).filter(p => p.app);
    await pg.owner('alter default privileges for role postgres in schema gov_repo grant execute on functions to public,anon,authenticated,service_role');
    await pg.owner(s4Source());
    assert.deepEqual((await pg.inventory()).filter(p => p.app), human);
    await pg.owner('alter default privileges for role postgres in schema gov_repo revoke execute on functions from public,anon,authenticated,service_role');
    return pg;
  } catch (error) { pg.stop(); throw error; }
}

export const boundaryCluster = isS4 ? s4Cluster : s3Cluster;
