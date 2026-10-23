import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('additive checkpoint record closes only the deterministic report surface and preserves every HOLD', () => {
    const root = resolve(__dirname, '../../../..');
    const status = JSON.parse(readFileSync(resolve(root, 'docs/trust-assurance/l03-extension-deterministic-containment-status-v1.json'), 'utf8'));
    assert.equal(status.slice_status, 'CLOSED / PASS');
    assert.equal(status.l03_deterministic_report_surface, 'CONTAINED / PASS - LOCAL');
    assert.equal(status.l03_overall, 'NEEDS_CONTAINMENT');
    assert.equal(status.v1_s1b_status, 'OPEN');
    assert.equal(status.m17_5_status, 'OPEN');
    for (const value of Object.values(status.readiness)) assert.equal(value, 'HOLD');
    for (const key of ['database_delta', 'migration_delta', 'hosted_delta']) assert.equal(status[key], 0);
    assert.equal(status.next_micro_phase_started, false);
    assert.match(status.next_micro_phase, /C2B-2.*LLM.*DEEP-AUDIT/);
    assert.equal(status.hosted_verified, false);
    assert.equal(status.validation.extension_global_typecheck, 'BASELINE_TS2589_UNCHANGED');
});
