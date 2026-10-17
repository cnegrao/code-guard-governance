import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as c from '../src/index.ts';
test('S6 v2 enables residual with closed eligibility vocabulary and preserves v1', () => {
  assert.deepEqual(c.L15_RISK_ASSESSMENT_V2_EXECUTABLE_BASES, ['INHERENT', 'RESIDUAL']);
  assert.deepEqual(c.L15_RISK_ASSESSMENT_EXECUTABLE_BASES, ['INHERENT']);
  assert.deepEqual(c.L15_RESIDUAL_RESOLUTIONS, ['CURRENT', 'DEPENDENCY_INVALID', 'EXPIRED', 'ABSENT']);
});
test('S6 contract keeps exact IDs and diagnostics without a numeric rating or effectiveness field', () => {
  const src = readFileSync(new URL('../src/l15-residual-risk-assessment.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const field of ['inherentAssessmentStateId', 'methodologyValidatedStateId', 'treatmentStateIds', 'controlAssessmentStateIds', 'causeKind', 'causeId', 'causeResolution']) assert.ok(src.includes(field), field);
  assert.doesNotMatch(src, /:\s*number\b|residualScore|effectiveness|weight|percent/i);
});
