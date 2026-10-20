import assert from 'node:assert/strict';
import { l14Cluster, type L14Cluster } from './m16-l14-fixtures';
import { m17S7CFinalSecurityClosureMigration, m17S7DAdversarialCorrectiveMigration } from './disposable-m16-postgres';

export async function s7dCluster(diagnostic: (message: string) => void) {
  const c = await l14Cluster(diagnostic, { horizon: 'M17S7B' });
  try {
    await c.migrate(m17S7CFinalSecurityClosureMigration);
    const before = await s7dSnapshot(c);
    await c.migrate(m17S7DAdversarialCorrectiveMigration);
    assert.deepEqual(await s7dSnapshot(c), before, 'S7D migration rewrites no durable row');
    return c;
  } catch (error) { await c.stop(); throw error; }
}

/** Content digests, not just counts: all L15 tables, the shared governance
 * envelope (including command results/rule/role snapshots), and legacy evidence.
 * No query_to_xml or fixture shortcuts; every store is read from the real DB. */
export async function s7dSnapshot(c: L14Cluster) {
  const tables = JSON.parse(await c.owner(`select json_agg(c.relname order by c.relname)
    from pg_class c where c.relnamespace='gov_repo'::regnamespace and c.relkind='r'
      and (c.relname like 'l15\\_%' escape '\\' or c.relname like 'l14\\_%' escape '\\' or c.relname='evidence')`)) as string[];
  assert.ok(tables.length > 40);
  return JSON.parse(await c.owner(`select json_agg(q order by name) from (${tables.map(name =>
    `select '${name}' name, md5(coalesce(string_agg(row_to_json(t)::text,'|' order by row_to_json(t)::text),'')) digest from gov_repo.${name} t`
  ).join(' union all ')}) q`));
}
