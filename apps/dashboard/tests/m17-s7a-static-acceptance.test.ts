import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const sql=readFileSync(new URL('../../../supabase/migrations/20261017020733_m17_s7a_read_projections_v1.sql',import.meta.url),'utf8');
test('S7A is one read-only projection surface with no truth store or canonical vocabulary change',()=>{
  assert.match(sql,/CREATE FUNCTION gov_repo\.l15_read_risk_projections_v1\(/);
  assert.doesNotMatch(sql,/CREATE (?:TABLE|VIEW|TYPE|SEQUENCE)|ADD COLUMN|canonical_relationships|CanonicalObjectKind/i);
  assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE|DELETE FROM|MERGE INTO)\b/i);
  assert.match(sql,/SECURITY DEFINER[\s\S]*SET search_path=pg_catalog,pg_temp/);
  assert.match(sql,/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC,anon,authenticated,service_role/);
});
test('O68 lifecycle is the frozen seven-state first-match order and is never persisted',()=>{
  const order=['CLOSED','RESIDUAL_ACCEPTED','RESIDUAL_ASSESSED','TREATMENT_IMPLEMENTED','TREATMENT_APPROVED','ASSESSED','IDENTIFIED'];
  let cursor=-1; for(const value of order){const next=sql.indexOf(`'${value}'`,cursor+1);assert.ok(next>cursor,value);cursor=next;}
  assert.doesNotMatch(sql,/\b(?:lifecycle|conflict_outcome)\s+text\s+(?:NOT NULL|DEFAULT|CHECK)/i);
});
test('O67 conflict is exact-key and categorical; forbidden selectors cannot choose a winner',()=>{
  assert.match(sql,/WHEN v_resolution\.resolution='CURRENT' THEN 'RESOLVED'[\s\S]*distinct_content_count>=2 THEN 'CONFLICT'[\s\S]*'INSUFFICIENT_EVIDENCE'/);
  assert.match(sql,/p\.scenario_definition_id=p_scenario_definition_id/);
  assert.doesNotMatch(sql,/ORDER BY\s+(?:confidence|rating|submitted_at|source_class|scanner|generator|exposure)/i);
});
test('O45 and control coverage reuse exact M16 reads without inheritance, scores or mutation',()=>{
  assert.match(sql,/p_subject_canonical_kind IN \('AGENT','DATA_ASSET','DATA_ELEMENT'\)/);
  assert.match(sql,/l14_control_applicabilities_current_v1/);assert.match(sql,/l14_control_assessments_current_v1/);
  assert.match(sql,/ca\.applicability='APPLIES'/);assert.match(sql,/ELSE 'UNKNOWN'/);
  assert.doesNotMatch(sql,/percentage|weighted|coverage_score|acceptance.*waiver|effectiveness/i);
});
