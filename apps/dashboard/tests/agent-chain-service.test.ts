import { before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { asOrganisationId } from '@council/canonical-contracts';
import { chainFixture } from './helpers/agent-chain-fixtures';

const org = asOrganisationId('org-chain');
const principal = { organisationId: org, actorUserId: 'carlos', issuedAtSeconds: 1700000000, expiresAtSeconds: 1700003600, credentialEpoch: '2026-11-26T00:00:00.000000+00:00' };
const governedPort = { tag: 'governed-port' };
let tables: Record<string, Record<string, unknown>[]>;
let calls: { step: string; input: Record<string, unknown>; port?: unknown }[];
let reads: string[];
let failReview: string | undefined;
let authenticationFails = false;
class AuthenticationError extends Error {}

mock.module('@/lib/auth', { namedExports: {
  SessionAuthenticationError: AuthenticationError,
  requireVerifiedGovernancePrincipal: async () => {
    if (authenticationFails) throw new AuthenticationError();
    return { ...principal, userId: principal.actorUserId };
  },
} });
mock.module('@/lib/governance/persistence', { namedExports: {
  createGovernedReviewPersistence: (value: unknown) => { assert.deepEqual(value, principal); return governedPort; },
  privilegedDb: { from(table: string) {
    let filtered: Record<string, unknown>[] = [];
    const query = {
      select() { return query; },
      eq(key: string, value: string) {
        assert.equal(key, 'organisation_id'); assert.equal(value, org); reads.push(table);
        filtered = (tables[table] ?? []).filter(row => row.organisation_id === value); return query;
      },
      order() { return query; },
      async range(start: number, end: number) { return { data: filtered.slice(start, end + 1), error: null }; },
    };
    return query;
  } },
} });
mock.module('@/lib/governance/discovery-intake-persistence', { namedExports: {
  rehydrateNormalizedCandidate: (value: unknown) => value,
  normalizedCandidateEnvelopeHash: (value: unknown) => JSON.stringify(value),
} });
mock.module('@/lib/governance/workspace-commands', { namedExports: {
  workspaceCommands: {
    confirmReview: async (input: Record<string, unknown>, port: unknown) => {
      calls.push({ step: 'CONFIRM', input, port }); return { kind: 'APPLIED' };
    },
    certifyReview: async (input: Record<string, unknown>, port: unknown) => {
      calls.push({ step: 'CERTIFY', input, port }); return { kind: input.reviewSubjectId === failReview ? 'FORBIDDEN' : 'APPLIED' };
    },
  },
} });
mock.module('@/lib/governance/decision-commands', { namedExports: {
  submitReconciliationDecision: async (input: Record<string, unknown>) => {
    calls.push({ step: 'RECONCILE', input }); return { kind: 'APPLIED', reconciliationDecisionId: `decision:${input.reviewSubjectId}` };
  },
  triggerMaterialization: async (input: Record<string, unknown>) => {
    calls.push({ step: 'MATERIALIZE', input });
    const family = input.reviewSubjectId === 'review:relationship' ? 'RELATIONSHIP' : 'OBJECT';
    return { kind: 'APPLIED', result: { applicable: true, family, result: { status: 'APPLIED',
      canonicalObjectId: `canonical:${input.reviewSubjectId}`, relationshipId: 'canonical-relationship' } } };
  },
} });
mock.module('@/lib/governance/decision-query', { namedExports: { getGovernanceDecisionDetail: async () => ({}) } });

let service: typeof import('../lib/governance/agent-chain-service');
let route: typeof import('../app/api/governance/workspace/agent-chain/route');
before(async () => {
  service = await import('../lib/governance/agent-chain-service');
  route = await import('../app/api/governance/workspace/agent-chain/route');
});
beforeEach(() => {
  const { all } = chainFixture();
  tables = {
    discovery_candidates: all.map(row => ({ envelope: row.candidate, envelope_hash: JSON.stringify(row.candidate), organisation_id: org })),
    review_subjects: all.map(row => ({ organisation_id: org, review_subject_id: row.reviewSubjectId, finding_id: row.candidate.findingId, state: row.state })),
  };
  calls = []; reads = []; failReview = undefined; authenticationFails = false;
});
async function approval() {
  const anchor = { reviewId: 'review:agent' };
  const plan = await service.previewAgentChain(org, anchor);
  return { anchor, previewKey: plan.previewKey, batchId: plan.batchId,
    selectedIds: plan.items.filter(item => !item.needsIndividualReview).map(item => item.reviewSubjectId), justification: 'I reviewed the source declarations and all selected matches.' };
}
function addModelMatch(id: string, modelReference = 'source-model') {
  tables.canonical_objects ??= [];
  tables.canonical_normalized_object_mappings ??= [];
  tables.canonical_objects.push({ organisation_id: org, canonical_object_id: id, kind: 'MODEL' });
  const envelope = { ...chainFixture().model.candidate, candidateId: `mapped:${id}`, findingId: `mapped-finding:${id}`,
    assertionIds: [`mapped-assertion:${id}`], evidenceIds: [`mapped-evidence:${id}`], proposedIdentity: { modelReference } };
  tables.discovery_candidates.push({ organisation_id: org, envelope, envelope_hash: JSON.stringify(envelope) });
  tables.canonical_normalized_object_mappings.push({ organisation_id: org, candidate_id: envelope.candidateId, canonical_object_id: id });
}

test('preview is read-only, tenant-scoped, complete and exposes source names and dependency order', async () => {
  const plan = await service.previewAgentChain(org, { reviewId: 'review:agent' });
  assert.equal(plan.items.length, 6);
  assert.ok(plan.items.some(item => item.sourceName === 'source-prompt'));
  assert.equal(plan.items.at(-1)?.kind, 'RELATIONSHIP');
  assert.equal(calls.length, 0);
  assert.equal(new Set(reads).size, 7);
  assert.equal(plan.previewKey, (await service.previewAgentChain(org, { reviewId: 'review:agent' })).previewKey);
});

test('approval calls only governed services, with one reconciliation per item and the same principal, batch and typed justification', async () => {
  const input = await approval();
  const result = await service.approveAgentChain(principal, input);
  assert.ok(result.items.every(item => item.status === 'MATERIALIZED'));
  assert.equal(calls.filter(call => call.step === 'RECONCILE').length, 6);
  assert.equal(calls.filter(call => call.step === 'MATERIALIZE').length, 6);
  for (const call of calls) {
    assert.equal(call.input.organisationId, org);
    assert.equal(call.input.actorUserId, principal.actorUserId);
    assert.equal(call.input.writePrincipal, principal);
    assert.equal(call.input.reasonCode, `Agent chain batch ${input.batchId}\n${input.justification}`);
    if (call.step === 'CONFIRM' || call.step === 'CERTIFY') assert.equal(call.port, governedPort);
  }
  assert.equal(result.items.at(-1)?.canonicalId, 'canonical-relationship');
});

test('ambiguity is visible, excluded by default, and cannot be forced into the server execution', async () => {
  addModelMatch('one'); addModelMatch('two');
  const plan = await service.previewAgentChain(org, { reviewId: 'review:agent' });
  assert.match(plan.items.find(item => item.kind === 'MODEL')!.needsIndividualReview!, /Multiple/);
  assert.ok(plan.items.find(item => item.kind === 'RELATIONSHIP')!.needsIndividualReview);
  const input = await approval();
  await assert.rejects(service.approveAgentChain(principal, { ...input, selectedIds: [...input.selectedIds, 'review:model'] }), /eligible items/);
  assert.equal(calls.length, 0);
});

test('stale preview, missing justification, existing decision and missing dependencies all prevent writes', async () => {
  const input = await approval();
  await assert.rejects(service.approveAgentChain(principal, { ...input, justification: ' ' }), /justification/);
  await assert.rejects(service.approveAgentChain(principal, { ...input, selectedIds: ['review:version'] }), /dependencies/);
  tables.reconciliation_invocations = [{ organisation_id: org, review_subject_id: 'review:agent' }];
  await assert.rejects(service.approveAgentChain(principal, input), /chain changed/);
  assert.equal(calls.length, 0);
});

test('a governed refusal stops immediately and retains exact completed and untouched item receipts', async () => {
  const input = await approval(); failReview = input.selectedIds[1];
  const result = await service.approveAgentChain(principal, input);
  assert.equal(result.items[0].status, 'MATERIALIZED');
  assert.equal(result.items[1].status, 'FAILED');
  assert.equal(result.items[1].failedStep, 'CERTIFY');
  assert.ok(result.items.slice(2).every(item => item.status === 'NOT_RUN'));
  assert.equal(calls.at(-1)?.step, 'CERTIFY');
  assert.equal(calls.length, 6);
});

test('API ignores forged actor/tenant/plan fields and passes only session authority to governed services', async () => {
  const input = await approval();
  const response = await route.POST(new Request('http://localhost/api/agent-chain', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, organisationId: 'another-tenant', actorUserId: 'attacker', items: [{ requestedOutcome: 'MATCH_EXISTING' }] }) }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items.length, 6);
  assert.ok(calls.every(call => call.input.organisationId === org && call.input.actorUserId === 'carlos'));
  assert.ok(calls.filter(call => call.step === 'RECONCILE').every(call => call.input.requestedOutcome === 'CREATE_NEW'));
});

test('API rejects unauthenticated and malformed requests without writes', async () => {
  const request = () => new Request('http://localhost/api/agent-chain', { method: 'POST', body: '{}' });
  authenticationFails = true;
  assert.equal((await route.POST(request())).status, 401);
  authenticationFails = false;
  assert.equal((await route.POST(request())).status, 400);
  assert.equal(calls.length, 0);
});

test('paged reads never silently truncate the chain, and unrelated tenant data cannot enter it', async () => {
  const extras = Array.from({ length: 205 }, (_, i) => ({ ...tables.review_subjects[0], review_subject_id: `extra:${i}`, finding_id: `extra:${i}` }));
  tables.review_subjects.push(...extras, { ...tables.review_subjects[0], organisation_id: 'other', review_subject_id: 'forged-review' });
  const plan = await service.previewAgentChain(org, { reviewId: 'review:agent' });
  assert.equal(plan.items.length, 6);
  assert.equal(reads.filter(table => table === 'review_subjects').length, 2);
  assert.ok(!plan.items.some(item => item.reviewSubjectId === 'forged-review'));
});

test('a different normalized identity is never proposed as a match merely because the kind is the same', async () => {
  addModelMatch('unrelated', 'different-model');
  let plan = await service.previewAgentChain(org, { reviewId: 'review:agent' });
  assert.equal(plan.items.find(item => item.kind === 'MODEL')?.outcome, 'CREATE_NEW');
  addModelMatch('exact');
  plan = await service.previewAgentChain(org, { reviewId: 'review:agent' });
  assert.equal(plan.items.find(item => item.kind === 'MODEL')?.match?.id, 'exact');
  const input = await approval();
  await service.approveAgentChain(principal, input);
  const model = calls.find(call => call.step === 'RECONCILE' && call.input.reviewSubjectId === 'review:model');
  assert.equal(model?.input.requestedOutcome, 'MATCH_EXISTING');
  assert.equal(model?.input.matchCanonicalObjectId, 'exact');
});

test('applied relationship receipts leave the pending preview, without re-deciding or re-materializing', async () => {
  tables.reconciliation_invocations = [{ organisation_id: org, review_subject_id: 'review:relationship', reconciliation_decision_id: 'applied-decision' }];
  tables.materialization_operations = [{ organisation_id: org, reconciliation_decision_id: 'applied-decision', status: 'APPLIED', resulting_relationship_id: 'governed-edge' }];
  const plan = await service.previewAgentChain(org, { reviewId: 'review:agent' });
  assert.ok(!plan.items.some(item => item.kind === 'RELATIONSHIP'));
  assert.equal(calls.length, 0);
});
