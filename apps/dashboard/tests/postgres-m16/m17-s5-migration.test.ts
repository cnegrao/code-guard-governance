import assert from 'node:assert/strict';
import { test } from 'node:test';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { m17S5RiskTreatmentMigration } from '../helpers/disposable-m16-postgres';

test('S5 migration depends on S3 only; no S4 objects required', async t => {
  const c = await l14Cluster(m => t.diagnostic(m), { horizon: 'M17S3R1' });
  t.after(() => c.stop());
  await c.migrate(m17S5RiskTreatmentMigration);
  assert.equal((await c.owner("select to_regclass('gov_repo.l15_risk_assessment_states') is null")).trim(), 't');
  assert.equal((await c.owner("select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname like 'l15_risk_treatment%' and relkind='r'")).trim(), '5');
});
