import assert from 'node:assert/strict';
import { test } from 'node:test';
import { L15_RISK_TREATMENT_OPTIONS, L15_RISK_TREATMENT_IMPLEMENTATION_STATUSES, L15_RISK_TREATMENT_REVOCATION_REASONS } from '../src/l15-risk-treatment.ts';
test('S5 options are exactly MITIGATE, AVOID, TRANSFER', () => assert.deepEqual(L15_RISK_TREATMENT_OPTIONS, ['MITIGATE','AVOID','TRANSFER']));
test('S5 implementation statuses are exactly PLANNED, IMPLEMENTED', () => assert.deepEqual(L15_RISK_TREATMENT_IMPLEMENTATION_STATUSES, ['PLANNED','IMPLEMENTED']));
test('S5 revocation reasons are closed', () => assert.deepEqual(L15_RISK_TREATMENT_REVOCATION_REASONS, ['TREATMENT_FAILED','TREATMENT_WITHDRAWN','RECORDED_IN_ERROR']));
