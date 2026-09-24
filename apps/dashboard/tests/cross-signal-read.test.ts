import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, mock, test } from 'node:test';
import { asCanonicalObjectId, asOrganisationId, type RuntimeObservation } from '@council/canonical-contracts';
import { runtimeToRow } from '../lib/governance/runtime-row';
import { exact, fixture } from './helpers/runtime-fixtures';

const org = asOrganisationId('11111111-1111-1111-1111-111111111111');
const foreign = asOrganisationId('22222222-2222-2222-2222-222222222222');
const subjectId = 'agent-version-1';
// runtime-fixtures.ts bakes this exact organisationId into every fixture()/exact() value
// (evidence references, binding proof, etc.) - reused here rather than overriding a subset
// of those baked-in fields and breaking validatePersistedRuntimeObservation's own cross-checks.
const runtimeOrg = fixture('MODEL_CALL').organisationId;

type Row = Record<string, any>;
let tables: Record<string, Row[]>;

const db = {
  from(table: string) {
    const filters: [string, unknown][] = [];
    const rows = () => (tables[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value));
    const query: any = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      order() { return query; },
      range() { return Promise.resolve({ data: rows(), error: null }); },
      maybeSingle() { const r = rows(); return Promise.resolve({ data: r[0] ?? null, error: null }); },
      then(resolve: any, reject: any) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); },
    };
    return query;
  },
  // Mocks gov_repo.read_runtime_observation_exact (20260923060000_cross_signal_persistence_v1.sql):
  // an exact (organisationId, observationId, connectionId) equality lookup returning zero or one
  // row - never trace/span/time-proximity matching. Mirrors the real RPC's `returns table(observation jsonb)`.
  rpc(name: string, params: Record<string, unknown>) {
    if (name !== 'read_runtime_observation_exact') return Promise.resolve({ data: null, error: { message: 'UNKNOWN_RPC' } });
    const match = (tables.runtime_observations ?? []).filter(row =>
      row.organisation_id === params.p_organisation_id &&
      row.observation_id === params.p_observation_id &&
      row.connection_id === params.p_connection_id);
    return Promise.resolve({ data: match.map(row => ({ observation: row })), error: null });
  },
};

let mod: typeof import('../lib/governance/cross-signal-read');
before(async () => {
  mock.module('../lib/governance/persistence', { namedExports: { privilegedDb: db } });
  mod = await import('../lib/governance/cross-signal-read');
});
beforeEach(() => {
  tables = { canonical_objects: [], execution_field_states: [], execution_source_facts: [], canonical_relationships: [], runtime_observations: [] };
});

function canonicalObject(objectId = subjectId, organisationId = org, kind = 'AGENT_VERSION') {
  return { organisation_id: organisationId, canonical_object_id: objectId, kind };
}
const subject = { organisationId: org, objectId: asCanonicalObjectId(subjectId), kind: 'AGENT_VERSION' as const };

// -----------------------------------------------------------------------------
// A. Trusted subject resolution
// -----------------------------------------------------------------------------

test('1. exact tenant + exact AGENT_VERSION subject resolves', async () => {
  tables.canonical_objects = [canonicalObject()];
  const resolved = await mod.resolveTrustedAgentVersionSubject(org, subjectId);
  assert.deepEqual(resolved, { organisationId: org, objectId: subjectId, kind: 'AGENT_VERSION' });
});

test('missing canonical AGENT_VERSION resolves undefined, never fabricated', async () => {
  const resolved = await mod.resolveTrustedAgentVersionSubject(org, subjectId);
  assert.equal(resolved, undefined);
});

test('3. cross-tenant canonical_objects row is never treated as this tenant\'s subject', async () => {
  tables.canonical_objects = [canonicalObject(subjectId, foreign)];
  const resolved = await mod.resolveTrustedAgentVersionSubject(org, subjectId);
  assert.equal(resolved, undefined);
});

// -----------------------------------------------------------------------------
// A2. Fail-closed boundary on a caller-SUPPLIED subject (not a database row).
// The cross-tenant test above proves a foreign DB row is never selected; these
// prove a foreign-tenant INPUT subject is rejected before any read happens,
// even when matching rows would otherwise exist for that objectId.
// -----------------------------------------------------------------------------

test('A2.1. foreign-tenant subject passed to resolvePrincipalDesignTimeBaseline fails closed before returning a baseline', async () => {
  tables.execution_field_states = [principalState()];
  tables.execution_source_facts = [principalFact('snapshot:1')];
  const foreignSubject = { organisationId: foreign, objectId: asCanonicalObjectId(subjectId), kind: 'AGENT_VERSION' as const };
  await assert.rejects(mod.resolvePrincipalDesignTimeBaseline(org, foreignSubject), /CROSS_SIGNAL_SUBJECT_CROSS_TENANT/);
});

test('A2.2. foreign-tenant subject passed to resolveDependencyGovernedStates fails closed before returning relationships', async () => {
  tables.canonical_relationships = [relationshipRow()];
  const foreignSubject = { organisationId: foreign, objectId: asCanonicalObjectId(subjectId), kind: 'AGENT_VERSION' as const };
  await assert.rejects(mod.resolveDependencyGovernedStates(org, foreignSubject, 'USES_TOOL'), /CROSS_SIGNAL_SUBJECT_CROSS_TENANT/);
});

test('A2.3. same-tenant exact subject still resolves normally with the boundary check in place', async () => {
  tables.execution_field_states = [principalState()];
  tables.execution_source_facts = [principalFact('snapshot:1')];
  tables.canonical_relationships = [relationshipRow()];
  const baseline = await mod.resolvePrincipalDesignTimeBaseline(org, subject);
  assert.ok(baseline);
  assert.equal(baseline!.executionFieldStateId, 'state:1');
  const states = await mod.resolveDependencyGovernedStates(org, subject, 'USES_TOOL');
  assert.equal(states.length, 1);
});

test('A2.4. a runtime value whose kind is not AGENT_VERSION fails closed, even though TypeScript already constrains the compile-time type', async () => {
  const forgedKindSubject = { organisationId: org, objectId: asCanonicalObjectId(subjectId), kind: 'AGENT' } as unknown as typeof subject;
  await assert.rejects(mod.resolvePrincipalDesignTimeBaseline(org, forgedKindSubject), /CROSS_SIGNAL_SUBJECT_KIND_INVALID/);
  await assert.rejects(mod.resolveDependencyGovernedStates(org, forgedKindSubject, 'USES_TOOL'), /CROSS_SIGNAL_SUBJECT_KIND_INVALID/);
});

// -----------------------------------------------------------------------------
// B. PRINCIPAL_IDENTITY design-time adapter
// -----------------------------------------------------------------------------

function principalFact(snapshotId: string, overrides: Row = {}) {
  return { organisation_id: org, snapshot_id: snapshotId, ordinal: 0, field_key: 'PRINCIPAL',
    principal_kind: 'SERVICE_ACCOUNT', principal_provider: 'provider', principal_authority: 'authority',
    principal_reference: 'reference', assertion_id: 'assertion', evidence_id: 'evidence', ...overrides };
}
function principalState(overrides: Row = {}) {
  return { organisation_id: org, state_id: 'state:1', canonical_object_id: subjectId, field_key: 'PRINCIPAL',
    snapshot_id: 'snapshot:1', decision_id: 'decision:1', previous_state_id: null, recorded_at: '2026-09-15T00:00:00.000Z', ...overrides };
}

test('4. principal state resolves exact stateId + decisionId + snapshotId', async () => {
  tables.execution_field_states = [principalState()];
  tables.execution_source_facts = [principalFact('snapshot:1')];
  const baseline = await mod.resolvePrincipalDesignTimeBaseline(org, subject);
  assert.ok(baseline);
  assert.equal(baseline!.executionFieldStateId, 'state:1');
  assert.equal(baseline!.decisionId, 'decision:1');
  assert.equal(baseline!.snapshotId, 'snapshot:1');
  assert.deepEqual(baseline!.principal, { kind: 'SERVICE_ACCOUNT', providerCode: 'provider', authorityReference: 'authority', principalReference: 'reference' });
});

test('5. principal row from another AGENT_VERSION is never selected', async () => {
  tables.execution_field_states = [principalState({ canonical_object_id: 'another-agent-version' })];
  tables.execution_source_facts = [principalFact('snapshot:1')];
  const baseline = await mod.resolvePrincipalDesignTimeBaseline(org, subject);
  assert.equal(baseline, undefined);
});

test('6. non-PRINCIPAL execution state is never selected for a PRINCIPAL baseline', async () => {
  tables.execution_field_states = [principalState({ field_key: 'CAPABILITY', state_id: 'state:capability' })];
  const baseline = await mod.resolvePrincipalDesignTimeBaseline(org, subject);
  assert.equal(baseline, undefined);
});

test('7. missing materialized PRINCIPAL baseline is represented as missing, never fabricated', async () => {
  const baseline = await mod.resolvePrincipalDesignTimeBaseline(org, subject);
  assert.equal(baseline, undefined);
});

// -----------------------------------------------------------------------------
// C. DEPENDENCY_TARGET_IDENTITY design-time adapter
// -----------------------------------------------------------------------------

function relationshipRow(overrides: Row = {}) {
  return { organisation_id: org, relationship_id: 'rel:1', relationship_state_id: 'rel:1:initial', relationship_type: 'USES_TOOL',
    source_canonical_object_id: subjectId, source_kind: 'AGENT_VERSION', target_canonical_object_id: 'tool-a', target_kind: 'TOOL',
    valid_from: '2026-09-01T00:00:00.123456+00:00', valid_to: null, created_by_decision_id: 'decision:rel-1', ...overrides };
}

test('8. multiple simultaneous governed dependency states are returned, not collapsed to one', async () => {
  tables.canonical_relationships = [relationshipRow(), relationshipRow({ relationship_id: 'rel:2', relationship_state_id: 'rel:2:initial', target_canonical_object_id: 'tool-b' })];
  const states = await mod.resolveDependencyGovernedStates(org, subject, 'USES_TOOL');
  assert.equal(states.length, 2);
  assert.deepEqual(new Set(states.map(s => s.target.objectId)), new Set(['tool-a', 'tool-b']));
});

test('9. dependency relationship from another AGENT_VERSION is never selected', async () => {
  tables.canonical_relationships = [relationshipRow({ relationship_id: 'rel:other', source_canonical_object_id: 'another-agent-version' })];
  const states = await mod.resolveDependencyGovernedStates(org, subject, 'USES_TOOL');
  assert.equal(states.length, 0);
});

test('10. dependency target canonical identity is preserved exactly', async () => {
  tables.canonical_relationships = [relationshipRow({ target_canonical_object_id: 'tool-exact', target_kind: 'TOOL' })];
  const [state] = await mod.resolveDependencyGovernedStates(org, subject, 'USES_TOOL');
  assert.deepEqual(state.target, { organisationId: org, objectId: 'tool-exact', kind: 'TOOL' });
  assert.equal(state.relationshipId, 'rel:1');
  assert.equal(state.relationshipStateId, 'rel:1:initial');
  assert.equal(state.decisionId, 'decision:rel-1');
});

test('11. validFrom/validTo are preserved exactly, never replaced with recorded_at/created_at precision', async () => {
  tables.canonical_relationships = [relationshipRow({ valid_from: '2026-09-01T00:00:00.123456+00:00', valid_to: '2026-10-01T00:00:00.654321+00:00' })];
  const [state] = await mod.resolveDependencyGovernedStates(org, subject, 'USES_TOOL');
  assert.equal(state.validFrom, '2026-09-01T00:00:00.123456+00:00');
  assert.equal(state.validTo, '2026-10-01T00:00:00.654321+00:00');
});

test('12. expired and future-dated governed states both remain available, unfiltered by the adapter', async () => {
  tables.canonical_relationships = [
    relationshipRow({ relationship_id: 'rel:expired', relationship_state_id: 'rel:expired:initial', target_canonical_object_id: 'tool-expired', valid_from: '2020-01-01T00:00:00.000000+00:00', valid_to: '2020-02-01T00:00:00.000000+00:00' }),
    relationshipRow({ relationship_id: 'rel:future', relationship_state_id: 'rel:future:initial', target_canonical_object_id: 'tool-future', valid_from: '2099-01-01T00:00:00.000000+00:00' }),
  ];
  const states = await mod.resolveDependencyGovernedStates(org, subject, 'USES_TOOL');
  assert.equal(states.length, 2);
});

// -----------------------------------------------------------------------------
// D. Runtime observation adapter
// -----------------------------------------------------------------------------

function runtimeRow(overrides: Partial<RuntimeObservation> = {}) {
  const observation: RuntimeObservation = { ...fixture('MODEL_CALL'), ...overrides } as RuntimeObservation;
  return { ...runtimeToRow(observation), recorded_at: '2026-09-17T00:00:00.000000+00:00' };
}
const reference = { observationId: fixture('MODEL_CALL').observationId, connectionId: fixture('MODEL_CALL').sourceConnection.connectionId };

test('13. runtime observation resolves by exact persisted observation identity', async () => {
  tables.runtime_observations = [runtimeRow()];
  const observation = await mod.readPersistedRuntimeObservation(runtimeOrg, reference);
  assert.equal(observation.observationId, reference.observationId);
  assert.equal(observation.sourceConnection.connectionId, reference.connectionId);
  assert.equal(observation.recordedAt.state, 'KNOWN');
});

test('14. runtime observation cross-tenant mismatch fails closed', async () => {
  tables.runtime_observations = [runtimeRow()];
  await assert.rejects(mod.readPersistedRuntimeObservation(foreign, reference), /CROSS_SIGNAL_RUNTIME_OBSERVATION_NOT_FOUND/);
});

test('14b. runtime observation read never matches by trace/span alone - only exact (org, observationId, connectionId)', async () => {
  tables.runtime_observations = [runtimeRow()];
  const wrongObservation = { ...reference, observationId: '99999999-9999-4999-8999-999999999999' as typeof reference.observationId };
  await assert.rejects(mod.readPersistedRuntimeObservation(runtimeOrg, wrongObservation), /CROSS_SIGNAL_RUNTIME_OBSERVATION_NOT_FOUND/);
  const wrongConnection = { ...reference, connectionId: 'some-other-connection' as typeof reference.connectionId };
  await assert.rejects(mod.readPersistedRuntimeObservation(runtimeOrg, wrongConnection), /CROSS_SIGNAL_RUNTIME_OBSERVATION_NOT_FOUND/);
});

test('15. EXACT runtime binding whose canonical AGENT_VERSION does not exist fails closed before comparison', async () => {
  const runtime = { ...fixture('MODEL_CALL'), binding: exact(), recordedAt: { state: 'KNOWN' as const, value: '2026-09-17T00:00:00.000Z' } } as RuntimeObservation;
  await assert.rejects(mod.assertRuntimeSubjectProven(runtimeOrg, runtime), /CROSS_SIGNAL_RUNTIME_SUBJECT_NOT_FOUND/);
});

test('EXACT runtime binding proven when its AGENT_VERSION exists for this tenant', async () => {
  const bound = exact();
  tables.canonical_objects = [canonicalObject(bound.state === 'EXACT' ? bound.agentVersion.objectId : '', runtimeOrg)];
  const runtime = { ...fixture('MODEL_CALL'), binding: bound, recordedAt: { state: 'KNOWN' as const, value: '2026-09-17T00:00:00.000Z' } } as RuntimeObservation;
  await assert.doesNotReject(mod.assertRuntimeSubjectProven(runtimeOrg, runtime));
});

test('16. UNRESOLVED runtime binding remains unresolved evidence and is never guessed', async () => {
  const runtime = { ...fixture('MODEL_CALL'), recordedAt: { state: 'KNOWN' as const, value: '2026-09-17T00:00:00.000Z' } } as RuntimeObservation;
  assert.equal(runtime.binding.state, 'UNRESOLVED');
  await assert.doesNotReject(mod.assertRuntimeSubjectProven(runtimeOrg, runtime));
  assert.deepEqual(tables.canonical_objects, []);
});

// -----------------------------------------------------------------------------
// E/F. No EAV/SELECT * and no write path
// -----------------------------------------------------------------------------

const source = readFileSync(new URL('../lib/governance/cross-signal-read.ts', import.meta.url), 'utf8');

test('17. no SELECT * or arbitrary JSON/EAV table read path is introduced', () => {
  assert.doesNotMatch(source, /select\(\s*['"]\*['"]\s*\)/);
  // M15.3A's runtime read boundary legitimately transports its closed, typed
  // column set through one RPC's jsonb return value (mirroring
  // gov_repo.runtime_readback's own existing transport encoding) - never an
  // arbitrary JSON/EAV escape hatch. What must never appear is a raw
  // .select(...) of a jsonb/json *column* straight off a table.
  assert.doesNotMatch(source, /\.select\([^)]*\bjsonb?\b[^)]*\)/i);
});

test('18. no canonical/runtime/execution write (mutation) path exists in this slice', () => {
  assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\(/);
  // M15.3A introduces exactly one legitimate READ-ONLY RPC
  // (gov_repo.read_runtime_observation_exact) as the M14 runtime_observations
  // read boundary. This still proves no mutation/write RPC exists anywhere
  // in the M15 read adapter: any other RPC name, or more than one distinct
  // RPC call, fails this test.
  const rpcCalls = [...source.matchAll(/privilegedDb\.rpc\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.deepEqual(new Set(rpcCalls), new Set(['read_runtime_observation_exact']));
});
