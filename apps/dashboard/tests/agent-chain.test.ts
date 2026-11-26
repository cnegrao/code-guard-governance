import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainItem, collectAgentChain, executeChain, orderChain, reconciliationProposal, selectedChain, ChainCommandError } from '../lib/governance/agent-chain';
import { candidate, chainFixture, item } from './helpers/agent-chain-fixtures';

test('chain follows the exact agent parent and revision support, including prompts and behavior endpoints', () => {
  const { all, version } = chainFixture();
  const unrelated = candidate('MODEL', 'unrelated', { modelReference: 'same-file-only' });
  const otherAgent = candidate('AGENT', 'other', { agentCode: 'other' });
  const otherVersion = candidate('AGENT_VERSION', 'other-version', { agent: { referenceKind: 'CANDIDATE', candidateKind: 'AGENT', candidateId: 'other' } });
  const result = collectAgentChain([...all, unrelated, otherAgent, otherVersion], { reviewId: 'review:agent' });
  assert.deepEqual(result.map(row => row.candidate.candidateId).sort(), ['agent', 'model', 'prompt', 'relationship', 'tool', version.candidate.candidateId].sort());
  assert.throws(() => collectAgentChain(all, { reviewId: 'review:model' }), /AGENT_NOT_FOUND/);
});

test('canonical AGENT anchor retains pending versions while canonical dependencies are omitted', () => {
  const fixture = chainFixture(); fixture.agent.canonicalId = 'canonical-agent';
  const members = collectAgentChain(fixture.all, { canonicalId: 'canonical-agent' });
  const version = chainItem(fixture.version, members, []);
  assert.deepEqual(version.dependencies, []);
  assert.equal(members.length, 6);
});

test('dependency order always places AGENT before AGENT_VERSION and both endpoints before relationships', () => {
  const fixture = chainFixture();
  const items = fixture.all.map(row => chainItem(row, fixture.all, []));
  const ordered = orderChain(items);
  const position = (id: string) => ordered.findIndex(row => row.reviewSubjectId === `review:${id}`);
  assert.ok(position('agent') < position('version'));
  assert.ok(position('version') < position('relationship'));
  assert.ok(position('model') < position('relationship'));
  assert.deepEqual(orderChain([...items].reverse()), ordered);
  assert.throws(() => orderChain([item('a', 'AGENT_VERSION', ['b']), item('b', 'AGENT', ['a'])]), /DEPENDENCY_CYCLE/);
});

test('multiple matches stay outside the batch and block their dependents', () => {
  const proposal = reconciliationProposal([{ id: 'one', label: 'one' }, { id: 'two', label: 'two' }]);
  assert.equal(proposal.match, undefined);
  assert.match(proposal.needsIndividualReview!, /individual review/);
  const ordered = orderChain([{ ...item('agent', 'AGENT'), ...proposal }, item('version', 'AGENT_VERSION', ['agent']), item('rel', 'RELATIONSHIP', ['version'])]);
  assert.ok(ordered.every(row => row.needsIndividualReview));
  assert.throws(() => selectedChain(ordered, ['agent']), /DEPENDENCY_NOT_SELECTED/);
  assert.deepEqual(reconciliationProposal([{ id: 'one', label: 'one' }]), { outcome: 'MATCH_EXISTING', match: { id: 'one', label: 'one' } });
  assert.deepEqual(reconciliationProposal([]), { outcome: 'CREATE_NEW' });
});

test('deselection never silently drops a requested item or its dependency', () => {
  const items = [item('agent', 'AGENT'), item('version', 'AGENT_VERSION', ['agent'])];
  assert.throws(() => selectedChain(items, ['version']), /DEPENDENCY_NOT_SELECTED/);
  assert.throws(() => selectedChain(items, ['forged']), /INVALID_SELECTION/);
  assert.throws(() => selectedChain(items, ['agent', 'agent']), /INVALID_SELECTION/);
  assert.deepEqual(selectedChain(items, ['agent']).map(row => row.reviewSubjectId), ['agent']);
});

test('ambiguous source parent is visible for individual review and never chosen by file or recency', () => {
  const fixture = chainFixture();
  const version = candidate('AGENT_VERSION', 'source-version', { agent: { referenceKind: 'SOURCE_OBJECT', candidateKind: 'AGENT', sourceObject: fixture.agent.candidate.sourceObject } });
  const all = [...fixture.all, candidate('AGENT', 'other-agent', { agentCode: 'second' }), version];
  const members = collectAgentChain(all, { reviewId: 'review:agent' });
  assert.ok(members.includes(version));
  assert.match(chainItem(version, all, []).needsIndividualReview!, /ambiguous/);
});

test('first error preserves completed items, identifies failed step and never calls later steps or items', async () => {
  const calls: string[] = [];
  const result = await executeChain('batch', [item('a'), item('b'), item('c')], async (row, step) => {
    calls.push(`${row.reviewSubjectId}:${step}`);
    if (row.reviewSubjectId === 'b' && step === 'CERTIFY') throw new ChainCommandError('CERTIFY: FORBIDDEN');
    return step === 'MATERIALIZE' ? { canonicalId: 'canonical:a' } : {};
  }, async () => ({ applied: false }));
  assert.deepEqual(calls, ['a:CONFIRM', 'a:CERTIFY', 'a:RECONCILE', 'a:MATERIALIZE', 'b:CONFIRM', 'b:CERTIFY']);
  assert.deepEqual(result.items.map(row => row.status), ['MATERIALIZED', 'FAILED', 'NOT_RUN']);
  assert.equal(result.items[1].failedStep, 'CERTIFY');
  assert.deepEqual(result.items[1].completedSteps, ['CONFIRM']);
});

test('lost materialization response reads its committed receipt and still stops, or reports UNKNOWN if read fails', async () => {
  for (const readFails of [false, true]) {
    const result = await executeChain('batch', [{ ...item('a'), state: 'CERTIFIED' }, item('b')], async (_row, step) => {
      if (step === 'MATERIALIZE') throw new Error('private transport diagnostics');
      return { decisionId: 'decision:a' };
    }, async () => {
      if (readFails) throw new Error('read unavailable');
      return { applied: true, canonicalId: 'canonical:a' };
    });
    assert.equal(result.items[0].status, readFails ? 'UNKNOWN' : 'MATERIALIZED');
    assert.equal(result.items[1].status, 'NOT_RUN');
    assert.doesNotMatch(JSON.stringify(result), /private transport/);
    assert.equal(result.items[0].decisionId, 'decision:a');
  }
});
