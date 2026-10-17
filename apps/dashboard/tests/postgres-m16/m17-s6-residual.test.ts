import assert from 'node:assert/strict';
import { test } from 'node:test';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { m17s6Kit } from '../helpers/m17-s6-fixtures';

test('S6 residual foundation on PG17: exact inherent pin, empty sets, replay, eligibility and historical cutoff', { timeout: 600_000 }, async t => {
  const c = await l14Cluster(m => t.diagnostic(m), { horizon: 'M17S6' });
  t.after(() => c.stop());
  const k = await m17s6Kit(c), x = await k.setup();
  const r = await k.risk(x, 'risk'), m = await k.methodology(x, 'method');
  const until = await k.instant('20 days');
  const i = await k.k4.assess(x, 'inherent', k.k4.insufficient(r.stateId, m, until));
  const p = k.proposal(r.stateId, m, i.stateId, until);
  const a = await k.assess(x, 'residual', p);
  await t.test('zero pins legal, INSUFFICIENT inherent legal, DB cell derives CRITICAL', async () => {
    assert.equal(a.decided.rating_band, 'CRITICAL');
    const read = await k.read(x.member, r.stateId);
    assert.equal(read.resolution, 'CURRENT');
    assert.equal(read.current_state.inherent_assessment_state_id, i.stateId);
    assert.deepEqual(read.current_state.treatment_state_ids, []);
    assert.deepEqual(read.current_state.control_assessment_state_ids, []);
  });
  await t.test('exact submit and decide replay; changed command is GV007', async () => {
    assert.equal((await k.submit(x, 'residual-submit', p)).replay, true);
    assert.equal((await k.decide(x, 'residual-decide', a.submitted, p)).replay, true);
    await c.rejects(k.submit(x, 'residual-submit', { ...p, likelihoodLevelCode: 'L2' }), 'GV007');
  });
  const at = await k.instant('0 seconds'), before = await k.historyDigest(x.org);
  await k.k4.revokeAssessment(x, 'inherent-revoke', r.stateId, m, i.stateId);
  await t.test('O40/O41: dependency invalidation is UNKNOWN, failed exact pin named; historical cutoff remains CURRENT', async () => {
    const read = await k.read(x.member, r.stateId);
    assert.equal(read.resolution, 'DEPENDENCY_INVALID');
    assert.equal(read.assessment_status, 'UNKNOWN');
    assert.equal(read.current_state, null);
    assert.equal(read.dependency_kind, 'INHERENT_RISK_ASSESSMENT');
    assert.equal(read.dependency_id, i.stateId);
    assert.equal((await k.read(x.member, r.stateId, at, at)).resolution, 'CURRENT');
    assert.equal((await k.k4.read(x.member, r.stateId)).assessment_status, 'UNKNOWN');
    assert.ok(before);
  });
  await t.test('own expiry takes precedence over failed dependency', async () => {
    assert.equal((await k.read(x.member, r.stateId, until)).resolution, 'EXPIRED');
  });
});
