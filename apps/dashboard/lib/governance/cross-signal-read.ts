import 'server-only';
import {
  asCanonicalObjectId, asIsoTimestamp, asRelationshipId, asRelationshipStateId,
  type CanonicalObjectIdentity, type CanonicalObjectKind, type CrossSignalDependencyRelationshipType,
  type OrganisationId, type RuntimeObservation, type RuntimeObservationId, type SourceConnectionId,
} from '@council/canonical-contracts';
import {
  validatePersistedRuntimeObservation,
  type CrossSignalDependencyGovernedState, type CrossSignalPrincipalDesignTimeBaseline,
} from '@council/governance-review';
import { privilegedDb } from './persistence';
import { executionRows, executionFactFromRow, type ExecutionRow } from './execution-context-read';
import { currentFieldState } from './agent-passport';
import { runtimeColumns, runtimeFromRow } from './runtime-row';

/**
 * GOV IA M15.2 - dashboard-layer exact read/resolution adapters for the M15 V1
 * pure comparison inputs (packages/governance-review/src/cross-signal-comparison.ts).
 * Frozen architecture: docs/architecture/ADR-GOVIA-CROSS-SIGNAL-RECONCILIATION-AND-DRIFT-v1.md
 *
 * READ-ONLY. No canonical/execution/relationship/runtime write path exists here.
 * These adapters resolve evidence only - they never assign VALIDATED, CERTIFY,
 * or otherwise promote runtime admission / observation into governance authority.
 * RUNTIME ADMISSION != GOVERNANCE AUTHORITY. OBSERVATION != GOVERNANCE AUTHORITY.
 */

// -----------------------------------------------------------------------------
// A. TRUSTED SUBJECT RESOLUTION
// -----------------------------------------------------------------------------

/**
 * Independently proves an AGENT_VERSION exists in canonical_objects for this
 * organisation. Never trusts a RuntimeObservation.binding claim, a fingerprint,
 * a candidate id or a source-name guess as canonical existence proof. Reuses
 * execution-context-read.ts's own explicit canonical_objects column allowlist
 * and tenant-membership assertion rather than a parallel read path.
 */
export async function resolveTrustedAgentVersionSubject(
  organisationId: OrganisationId,
  objectId: string,
): Promise<CanonicalObjectIdentity<'AGENT_VERSION'> | undefined> {
  const rows = await executionRows(organisationId, 'canonical_objects', { canonical_object_id: objectId, kind: 'AGENT_VERSION' });
  if (rows.length > 1) throw new Error('CROSS_SIGNAL_SUBJECT_AMBIGUOUS');
  if (rows.length !== 1 || rows[0].canonical_object_id !== objectId) return undefined;
  return Object.freeze({ organisationId, objectId: asCanonicalObjectId(objectId), kind: 'AGENT_VERSION' as const });
}

/**
 * Fail-closed boundary check for a caller-supplied AGENT_VERSION subject,
 * shared by every adapter below that accepts one as a parameter. Checked
 * independently of TypeScript's compile-time CanonicalObjectIdentity<'AGENT_VERSION'>
 * narrowing - a runtime value can still carry a forged organisationId or a
 * kind other than AGENT_VERSION - and evaluated before any database read.
 * Never substitutes the trusted organisationId for a mismatched one and
 * never reconstructs a new subject from objectId alone; a mismatch fails
 * closed with no fuzzy/candidate/source-name fallback.
 */
function assertTrustedAgentVersionSubject(organisationId: OrganisationId, subject: CanonicalObjectIdentity<'AGENT_VERSION'>): void {
  const s = subject as unknown as { readonly organisationId?: unknown; readonly objectId?: unknown; readonly kind?: unknown };
  if (s.organisationId !== organisationId) throw new Error('CROSS_SIGNAL_SUBJECT_CROSS_TENANT');
  if (s.kind !== 'AGENT_VERSION') throw new Error('CROSS_SIGNAL_SUBJECT_KIND_INVALID');
  if (typeof s.objectId !== 'string' || !s.objectId) throw new Error('CROSS_SIGNAL_SUBJECT_INVALID');
}

// -----------------------------------------------------------------------------
// B. PRINCIPAL_IDENTITY DESIGN-TIME ADAPTER
// -----------------------------------------------------------------------------

/**
 * Resolves the exact materialized PRINCIPAL execution_field_states row - via
 * M13's own currentFieldState state-chain semantics, never decidedAt/recordedAt
 * ordering - and its exact backing execution_source_facts value. Returns
 * undefined, never a fabricated baseline, when no PRINCIPAL state is
 * materialized for this AGENT_VERSION yet (DESIGN_TIME_BASELINE_MISSING is
 * the pure comparison's own responsibility to report).
 */
export async function resolvePrincipalDesignTimeBaseline(
  organisationId: OrganisationId,
  subject: CanonicalObjectIdentity<'AGENT_VERSION'>,
): Promise<CrossSignalPrincipalDesignTimeBaseline | undefined> {
  assertTrustedAgentVersionSubject(organisationId, subject);
  const states = await executionRows(organisationId, 'execution_field_states', { canonical_object_id: subject.objectId, field_key: 'PRINCIPAL' });
  if (states.some(row => row.canonical_object_id !== subject.objectId)) throw new Error('CROSS_SIGNAL_PRINCIPAL_SUBJECT_MISMATCH');
  const current = currentFieldState(states as Array<ExecutionRow & { state_id: string; previous_state_id: string | null }>);
  if (!current) return undefined;
  const facts = await executionRows(organisationId, 'execution_source_facts', { snapshot_id: current.snapshot_id, field_key: 'PRINCIPAL' });
  if (facts.length !== 1) throw new Error('CROSS_SIGNAL_PRINCIPAL_FACT_AMBIGUOUS');
  const fact = executionFactFromRow(facts[0]);
  if (fact.field !== 'PRINCIPAL') throw new Error('CROSS_SIGNAL_PRINCIPAL_FACT_INVALID');
  return Object.freeze({
    canonicalObject: subject,
    field: 'PRINCIPAL' as const,
    executionFieldStateId: current.state_id,
    decisionId: current.decision_id,
    snapshotId: current.snapshot_id,
    principal: fact.principal,
  });
}

// -----------------------------------------------------------------------------
// C. DEPENDENCY_TARGET_IDENTITY DESIGN-TIME ADAPTER
// -----------------------------------------------------------------------------

const RELATIONSHIP_COLUMNS = 'relationship_id,relationship_state_id,relationship_type,source_canonical_object_id,' +
  'source_kind,target_canonical_object_id,target_kind,valid_from,valid_to,created_by_decision_id';

/**
 * Reads every governed canonical_relationships row for this exact
 * (organisationId, source AGENT_VERSION, relationshipType) - never
 * pre-collapsed to one target, never filtered to only the currently-active
 * (valid_to is null) edge. The pure comparison alone resolves the effective
 * [validFrom, validTo) set against RuntimeObservation.startedAtUnixNano, so
 * expired/future rows are preserved here rather than discarded.
 *
 * validFrom/validTo are passed through as the raw PostgREST timestamptz
 * strings via asIsoTimestamp, never round-tripped through `new Date(...)`
 * .toISOString() - that would silently truncate the microsecond precision
 * Postgres actually returns, changing the relationship's fact-time boundary.
 */
export async function resolveDependencyGovernedStates(
  organisationId: OrganisationId,
  subject: CanonicalObjectIdentity<'AGENT_VERSION'>,
  relationshipType: CrossSignalDependencyRelationshipType,
): Promise<readonly CrossSignalDependencyGovernedState[]> {
  assertTrustedAgentVersionSubject(organisationId, subject);
  const { data, error } = await privilegedDb.from('canonical_relationships')
    .select(`organisation_id,${RELATIONSHIP_COLUMNS}`)
    .eq('organisation_id', organisationId)
    .eq('source_canonical_object_id', subject.objectId)
    .eq('source_kind', 'AGENT_VERSION')
    .eq('relationship_type', relationshipType);
  if (error) throw new Error('CROSS_SIGNAL_DEPENDENCY_READ_FAILED');
  const rows = (data ?? []) as Array<Record<string, any>>;
  if (rows.some(row => row.organisation_id !== organisationId || row.source_canonical_object_id !== subject.objectId)) {
    throw new Error('CROSS_SIGNAL_DEPENDENCY_TENANT_MISMATCH');
  }
  return Object.freeze(rows.map(row => Object.freeze({
    relationshipId: asRelationshipId(row.relationship_id),
    relationshipStateId: asRelationshipStateId(row.relationship_state_id),
    decisionId: row.created_by_decision_id,
    source: subject,
    relationshipType: row.relationship_type as CrossSignalDependencyRelationshipType,
    target: Object.freeze({ organisationId, objectId: asCanonicalObjectId(row.target_canonical_object_id), kind: row.target_kind as CanonicalObjectKind }),
    validFrom: asIsoTimestamp(row.valid_from),
    ...(row.valid_to ? { validTo: asIsoTimestamp(row.valid_to) } : {}),
  })));
}

// -----------------------------------------------------------------------------
// D. RUNTIME OBSERVATION ADAPTER
// -----------------------------------------------------------------------------

const RUNTIME_READ_COLUMNS = [...new Set(['organisation_id', 'observation_id', 'connection_id', 'recorded_at', ...runtimeColumns.map(([column]) => column)])].join(',');

/**
 * Exact read of one persisted RuntimeObservation by (organisationId,
 * observationId, connectionId), reusing runtime-row.ts's explicit typed
 * column allowlist and M14's own validatePersistedRuntimeObservation
 * reject-before-attempt boundary - never SELECT *, never a raw payload.
 *
 * NOTE: gov_repo.runtime_observations (20260917021203_runtime_observability_v1.sql)
 * currently does `revoke all on gov_repo.runtime_observations from
 * public,anon,authenticated,service_role` - only the admit_runtime_observation
 * SECURITY DEFINER RPC's own inline readback can reach this table today. This
 * adapter is written to the read model the ADR anticipates ("resolved back to
 * ... the runtime table at read time", ADR SS15), but a real deployment needs a
 * follow-up migration (out of scope for this read-only M15.2 slice) granting a
 * scoped read path before this query can succeed against Postgres.
 */
export async function readPersistedRuntimeObservation(
  organisationId: OrganisationId,
  reference: { readonly observationId: RuntimeObservationId; readonly connectionId: SourceConnectionId },
): Promise<RuntimeObservation> {
  const { data, error } = await privilegedDb.from('runtime_observations')
    .select(RUNTIME_READ_COLUMNS)
    .eq('organisation_id', organisationId)
    .eq('observation_id', reference.observationId)
    .eq('connection_id', reference.connectionId)
    .maybeSingle();
  if (error) throw new Error('CROSS_SIGNAL_RUNTIME_READ_FAILED');
  if (!data) throw new Error('CROSS_SIGNAL_RUNTIME_OBSERVATION_NOT_FOUND');
  const row = data as Record<string, any>;
  if (row.organisation_id !== organisationId || row.observation_id !== reference.observationId || row.connection_id !== reference.connectionId) {
    throw new Error('CROSS_SIGNAL_RUNTIME_TENANT_MISMATCH');
  }
  return validatePersistedRuntimeObservation(runtimeFromRow(row));
}

/**
 * For an EXACT-bound observation, independently re-proves the bound
 * AGENT_VERSION exists for this tenant before it may be used as a comparison
 * subject - the binding's own claim is never sufficient on its own. UNRESOLVED
 * bindings are left untouched as valid runtime evidence: the pure comparison
 * itself returns INSUFFICIENT_EVIDENCE/RUNTIME_BINDING_UNRESOLVED for those.
 */
export async function assertRuntimeSubjectProven(organisationId: OrganisationId, runtime: RuntimeObservation): Promise<void> {
  if (runtime.binding.state !== 'EXACT') return;
  const { agentVersion } = runtime.binding;
  if (agentVersion.organisationId !== organisationId) throw new Error('CROSS_SIGNAL_RUNTIME_SUBJECT_CROSS_TENANT');
  const proven = await resolveTrustedAgentVersionSubject(organisationId, agentVersion.objectId);
  if (!proven) throw new Error('CROSS_SIGNAL_RUNTIME_SUBJECT_NOT_FOUND');
}
