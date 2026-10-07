import {
  asCanonicalObjectId, asIsoTimestamp, asRelationshipId, asRelationshipStateId, runtimeKnown, type CrossSignalComparisonResult,
} from '@council/canonical-contracts';
import {
  comparePrincipalIdentityDesignTimeVsRuntime, compareDependencyTargetIdentityDesignTimeVsRuntime, crossSignalComparisonIdentity,
  validatePersistedRuntimeObservation,
} from '@council/governance-review';
import { runtimeFromRow, runtimeToRow } from '../../lib/governance/runtime-row';
import { fixture, exact } from './runtime-fixtures';
import { seedGovernedSupport, binding } from './runtime-governed-fixtures';
import { org as runtimeOrg, foreign as runtimeForeign, literal, composite, config, admission } from './runtime-database';

type Run = (query: string) => Promise<string>;

/**
 * M15 runtime support on the full primary chain (owner-only fixture rows): the two M15 tenants, governed M14 support,
 * the PRINCIPAL execution field state, two USES_MODEL canonical relationships (only ever READ by the runtime owner),
 * and an active runtime source + deployment binding. Every routine under test then runs through its real SQL surface.
 */
export async function m15RuntimeKit(owner: Run) {
  await owner(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code)
    values('${runtimeOrg}','m15-a','M15 A','M15 A','BR'),('${runtimeForeign}','m15-b','M15 B','M15 B','BR');`);
  await seedGovernedSupport(owner);
  await owner(`insert into gov_repo.execution_field_decisions
      (organisation_id,decision_id,canonical_object_id,snapshot_id,field_key,outcome,actor_reference,decided_at,content_digest)
      values('${runtimeOrg}','m15-principal-decision','m142-version','m13-snapshot','PRINCIPAL','ACCEPT_PROPOSED','fixture-admin',now(),'fixture');
    insert into gov_repo.execution_field_states(organisation_id,state_id,canonical_object_id,field_key,snapshot_id,decision_id,recorded_at)
      values('${runtimeOrg}','m15-principal-state','m142-version','PRINCIPAL','m13-snapshot','m15-principal-decision',now());
    insert into gov_repo.reconciliation_decisions(decision_id,organisation_id,family,outcome,candidate_kind,authority_kind,authority_reference,reason_code,decided_at,
      subject_candidate_id,canonical_object_id,canonical_object_kind,contract_version,envelope,envelope_hash)
      values('m15-model-decision','${runtimeOrg}','OBJECT','CREATE_NEW','MODEL','HUMAN','fixture-admin','MANUAL_APPROVAL',now(),'candidate:m15-model-2','m15-model-2','MODEL','1.0','{}',repeat('a',64));
    insert into gov_repo.canonical_objects(canonical_object_id,organisation_id,kind,created_by_decision_id) values('m15-model-2','${runtimeOrg}','MODEL','m15-model-decision');`);
  const observation = fixture('MODEL_CALL');
  const subject = { organisationId: observation.organisationId, objectId: asCanonicalObjectId('m142-version'), kind: 'AGENT_VERSION' as const };
  const principal = { kind: 'WORKLOAD_IDENTITY' as const, providerCode: 'provider', authorityReference: 'realm', principalReference: 'workload' };
  const states = ['m142-model', 'm15-model-2'].map((target, i) => ({
    relationshipId: asRelationshipId(`m15-rel-${i}`), relationshipStateId: asRelationshipStateId(`m15-state-${i}`), decisionId: `m15-rel-decision-${i}`,
    source: subject, relationshipType: 'USES_MODEL' as const,
    target: { organisationId: subject.organisationId, objectId: asCanonicalObjectId(target), kind: 'MODEL' as const },
    validFrom: asIsoTimestamp('2026-09-01T00:00:00.000Z'),
  }));
  for (const state of states) {
    await owner(`insert into gov_repo.reconciliation_decisions(decision_id,organisation_id,family,outcome,candidate_kind,authority_kind,authority_reference,reason_code,decided_at,
        relationship_candidate_id,relationship_type_code,contract_version,envelope,envelope_hash)
        values('${state.decisionId}','${runtimeOrg}','RELATIONSHIP','CREATE_NEW','USES_MODEL','HUMAN','fixture-admin','MANUAL_APPROVAL',now(),'candidate:${state.relationshipId}','USES_MODEL','1.0','{}',repeat('a',64));
      insert into gov_repo.canonical_relationships(organisation_id,relationship_id,relationship_state_id,relationship_type,source_canonical_object_id,source_kind,
        target_canonical_object_id,target_kind,valid_from,recorded_at,created_by_decision_id)
        values('${runtimeOrg}','${state.relationshipId}','${state.relationshipStateId}','USES_MODEL','m142-version','AGENT_VERSION','${state.target.objectId}','MODEL','${state.validFrom}',now(),'${state.decisionId}');`);
  }
  const connection = observation.sourceConnection.connectionId;
  await owner(`select gov_repo.register_runtime_source('${runtimeOrg}','${connection}','system','provider','producer','fixture-admin');
    select gov_repo.configure_runtime_source('${runtimeOrg}','${connection}',${composite(config(), 'runtime_source_configurations')});
    select gov_repo.activate_runtime_source('${runtimeOrg}','${connection}','1',true,'fixture-admin');
    select gov_repo.register_runtime_binding('${runtimeOrg}','${connection}',${composite(binding(), 'runtime_deployment_bindings')});`);
  const runtimeInput = { ...observation, binding: exact(), context: { ...observation.context,
    principal: runtimeKnown({ value: principal, support: { evidence: observation.provenance.evidence,
      method: { code: 'DIRECT_RUNTIME_MEASUREMENT' as const, version: '1.0.0' as const } } }) } };
  const admissionSql = admission(runtimeToRow(runtimeInput));
  const readSql = (tenant: string, observationId: string) =>
    `select observation from gov_repo.read_runtime_observation_exact('${tenant}',${literal(connection)},'${observationId}')`;
  const recordSql = (result: CrossSignalComparisonResult) => `select row_to_json(reply) from gov_repo.record_cross_signal_comparison_result('${runtimeOrg}',
    ${literal(crossSignalComparisonIdentity(result))},${literal(JSON.stringify(result))}::jsonb) reply;`;
  /** The two real M15 comparison results over an admitted observation row. */
  const results = (admittedRow: Record<string, unknown>) => {
    const runtime = validatePersistedRuntimeObservation(runtimeFromRow(admittedRow as never));
    const evaluatedAt = asIsoTimestamp('2026-09-23T12:00:00.000Z');
    return {
      principal: comparePrincipalIdentityDesignTimeVsRuntime({ organisationId: subject.organisationId, subject, runtime, evaluatedAt,
        designTime: { canonicalObject: subject, field: 'PRINCIPAL', executionFieldStateId: 'm15-principal-state', decisionId: 'm15-principal-decision',
          snapshotId: 'm13-snapshot', principal } }),
      dependency: compareDependencyTargetIdentityDesignTimeVsRuntime({ organisationId: subject.organisationId, subject, runtime, evaluatedAt, governedStates: states }),
    };
  };
  return { runtimeOrg, runtimeForeign, connection, admissionSql, readSql, recordSql, results };
}
