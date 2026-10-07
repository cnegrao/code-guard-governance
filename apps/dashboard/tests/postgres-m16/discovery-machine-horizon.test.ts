import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { definerCapabilitySurfaceMigration as r1, runtimeExecutionClosureMigration as r2,
  s0ExecutionContextClosureMigration as r3, fullPrimaryChainMigrations, historicalPrimaryChainMigrations } from '../helpers/disposable-m16-postgres';
import { S2_MIGRATION } from '../helpers/discovery-machine-s2-fixtures';

test('S2 harness preserves exact historical R1/R2/R3 boundary and rejects corrupt identities/order', () => {
  const names = readdirSync(new URL('../../../../supabase/migrations/', import.meta.url)).filter(n => /^\d{14}_[a-z0-9_]+\.sql$/.test(n)).sort();
  const historical = names.filter(n => n <= r3);
  assert.deepEqual(historical.slice(-3), [r1,r2,r3]);
  const expected = historical.slice(0,-3);
  assert.deepEqual(fullPrimaryChainMigrations(), expected);
  assert.deepEqual(historicalPrimaryChainMigrations([...historical,S2_MIGRATION]), expected);
  assert.deepEqual(historicalPrimaryChainMigrations([...historical,S2_MIGRATION,'20990101000000_unrelated_future.sql']), expected);
  assert.throws(() => historicalPrimaryChainMigrations([...expected,r2,r1,r3]));
  for (const step of [r1,r2,r3]) {
    assert.throws(() => historicalPrimaryChainMigrations(historical.filter(n => n !== step)));
    assert.throws(() => historicalPrimaryChainMigrations(historical.map(n => n === step ? n.replace('_m16_', '_wrong_') : n).sort()));
    assert.throws(() => historicalPrimaryChainMigrations([...historical,step].sort()));
  }
});
