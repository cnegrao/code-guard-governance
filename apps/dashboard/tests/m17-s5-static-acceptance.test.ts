import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
const root = new URL('../../../', import.meta.url);
const name = '20261015122639_m17_s5_risk_treatment_v1.sql';
const sql = readFileSync(new URL(`supabase/migrations/${name}`,root),'utf8');
test('S5 is additive after S4 and introduces only five treatment stores', () => {
  const names = readdirSync(new URL('supabase/migrations',root)).filter(f => /^\d{14}.*sql$/.test(f)).sort();
  assert.deepEqual(names.slice(names.indexOf(name)),[name,'20261016021012_m17_s6_residual_risk_acceptance_v1.sql', '20261017020733_m17_s7a_read_projections_v1.sql', '20261019130000_m17_s7b_passport_risk_overlay_v1.sql', '20261019140000_m17_s7c_final_security_closure_v1.sql', '20261020031523_m17_s7d_adversarial_corrective_v1.sql']);
  assert.equal([...sql.matchAll(/CREATE TABLE gov_repo\./g)].length,5);
  assert.doesNotMatch(sql,/\bDROP\s+(TABLE|COLUMN|FUNCTION|TRIGGER|VIEW|ROLE)\b/i);
});
test('S5 has no M16 fact, canonical, Passport, S6 or root mutation', () => {
  assert.doesNotMatch(sql,/(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\s+gov_repo\.(l14_fact_states|l14_registry_states|l14_support_links|canonical_\w+|l14_authority_\w+)/i);
  assert.doesNotMatch(sql,/CREATE(?: OR REPLACE)? FUNCTION gov_repo\.l15_authorization_allow_guard_v1|SET CONSTRAINTS|RISK_ACCEPTANCE|RESIDUAL/);
  assert.doesNotMatch(sql,/gov_repo\.l15_risk_assessment_/,'S4 is not a treatment dependency');
});
test('S5 exact dependencies and no control applicability write', () => {
  for (const helper of ['l15_governed_risk_state_current_v1','l14_governance_party_valid_state_v1','l14_control_definition_valid_state_v1']) assert.ok(sql.includes(helper));
  assert.doesNotMatch(sql,/(INSERT INTO|UPDATE|DELETE FROM)\s+gov_repo\.l14_control_(applicability|assessment)/i);
  assert.match(sql,/IMPLEMENTATION_EVIDENCE_REQUIRED/);
  assert.match(sql,/PIN_OWNER_NOT_IN_TRANSACTION/);
});
