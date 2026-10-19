import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration=readFileSync(new URL('../../../supabase/migrations/20261019130000_m17_s7b_passport_risk_overlay_v1.sql',import.meta.url),'utf8');
const analysis=readFileSync(new URL('../../../packages/graphos/src/governed/l15-risk-analysis.ts',import.meta.url),'utf8');
const overlay=readFileSync(new URL('../lib/governance/passport-risk-overlay-read.ts',import.meta.url),'utf8');
const model=readFileSync(new URL('../lib/governance/agent-passport.ts',import.meta.url),'utf8');

test('O69 exposure is only the exact-subject versioned M12 traversal and never legacy propagation',()=>{
  assert.match(analysis,/traverseCanonicalGraph/);assert.match(analysis,/GOVIA_BLAST_RADIUS_V1/);assert.match(analysis,/M17_EXACT_RISK_SUBJECT_REQUIRED/);
  assert.doesNotMatch(analysis,/agent_risk_propagation|recompute_risk_propagation|propagateRisk|\/api\/graph\/risk/i);
  assert.doesNotMatch(analysis,/\.rpc\(|\.insert\(|\.update\(|\.delete\(|fetch\(/);
});

test('O70 vector adapter reuses governed M12 retrieval with no provider, merge, link or scenario selection',()=>{
  assert.match(analysis,/retrieveCanonicalVectors/);assert.match(analysis,/scenarioSelection: 'NONE'/);
  assert.doesNotMatch(analysis,/OpenAI|embedding.*API|deduplic|supersed|merge|create.*link/i);
});

test('O71 deterministic LLM stub exposes no governance, evidence or proposal capability',()=>{
  assert.match(analysis,/runL15LlmBoundaryStub/);assert.match(analysis,/evidenceStorage: 'PROHIBITED'/);
  assert.match(analysis,/proposalSubmission: 'PROHIBITED'/);assert.match(analysis,/decisionActor: 'PROHIBITED'/);
  assert.doesNotMatch(analysis,/generateText|streamText|chat\.completions|responses\.create|fetch\(/);
});

test('O72 overlay is one read-only exact-subject projection over the existing 16 families',()=>{
  assert.equal((model.match(/\['[^']+', '[^']+'\]/g)??[]).length>=16,true);
  assert.match(migration,/p_subject_canonical_kind NOT IN \('AGENT','AGENT_VERSION'\)/);
  assert.match(migration,/l15_read_risk_projections_v1/);assert.match(migration,/overlay_status:=CASE WHEN pg_catalog\.jsonb_array_length\(items\)=0 THEN 'UNKNOWN'/);
  assert.doesNotMatch(migration,/CREATE (?:TABLE|VIEW|TYPE|SEQUENCE)|ADD COLUMN|\b(?:INSERT INTO|UPDATE|DELETE FROM|MERGE INTO)\b/i);
  assert.doesNotMatch(`${migration}\n${overlay}`,/risk_level|risk_entries|risk_treatments|agent_risk_propagation/i);
  assert.match(overlay,/NON-AUTHORITATIVE ANALYSIS/);assert.match(model,/riskOverlay: PassportRiskOverlay/);
  for(const [domain,family] of [['PRIVACY','privacy'],['DATA','data'],['AUTHORIZATION','authorization'],['AUTONOMY','behavior'],
    ['MODEL','model'],['CONNECTIVITY','connectivity'],['OPERATIONAL','runtime'],['FINOPS','runtime']] as const)
    assert.match(migration,new RegExp(`WHEN '${domain}' THEN '${family}'`));
  assert.match(migration,/WHEN 'CYBERSECURITY' THEN CASE WHEN r\.subject_canonical_kind='AGENT_VERSION' THEN 'behavior' ELSE 'tools' END/);
});
