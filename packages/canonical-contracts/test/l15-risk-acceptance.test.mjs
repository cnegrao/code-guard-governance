import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {L15_RISK_ACCEPTANCE_RESOLUTIONS,L15_RISK_TREATMENT_OPTIONS} from '../src/index.ts';
test('acceptance is explicit, bounded and independent of treatment vocabulary',()=>{
  assert.deepEqual(L15_RISK_ACCEPTANCE_RESOLUTIONS,['CURRENT','DEPENDENCY_INVALID','EXPIRED','ABSENT']);
  assert.deepEqual(L15_RISK_TREATMENT_OPTIONS,['MITIGATE','AVOID','TRANSFER']);
  const src=readFileSync(new URL('../src/l15-risk-acceptance.ts',import.meta.url),'utf8');
  for(const field of ['residualAssessmentStateId','governedRiskStateId','requestedValidUntil','validUntil','expectedCurrentStateId','targetStateId']) assert.ok(src.includes(field));
  assert.doesNotMatch(src,/WAIVED|waiver|exception|effectiveness|coverage|score|:\s*number/);
});
