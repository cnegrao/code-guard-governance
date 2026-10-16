import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../../../supabase/migrations/20261016021012_m17_s6_residual_risk_acceptance_v1.sql', import.meta.url), 'utf8');
test('S6 Phase A reuses assessment stores; normalized pin sets have bidirectional equality and transaction ownership', () => {
  assert.doesNotMatch(sql, /CREATE TABLE gov_repo\.l15_residual/i);
  for (const table of ['proposal_treatment','state_treatment','proposal_control_assessment','state_control_assessment'])
    assert.ok(sql.includes(`CREATE TABLE gov_repo.l15_risk_assessment_${table}_pins`));
  assert.ok((sql.match(/EXCEPT SELECT/g) ?? []).length >= 4);
  assert.match(sql, /xmin=pg_current_xact_id\(\)::xid/);
  assert.match(sql, /RESIDUAL_PIN_SET_MISMATCH/);
});
test('O38/O43: S6 performs no M16 DML and introduces no inferred effectiveness or score', () => {
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE) gov_repo\.l14_(?:fact_states|registry_states|control_|responsibility_|business_context_|policy_applicability|governance_part)/i);
  assert.doesNotMatch(sql, /residual_risk_score|effectiveness|WAIVED/);
  assert.match(sql, /a\.applicability='APPLIES'/);
  assert.match(sql, /cause_kind text,cause_id uuid,cause_resolution text/);
});
