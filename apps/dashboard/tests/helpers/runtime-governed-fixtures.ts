import { org, foreign, sql, literal, composite } from './runtime-database';

/** Explicit administrator fixtures in the disposable DB, before runtime admission.
 * These are governed/source support fixtures, not a runtime canonical creation path. */
export async function seedGovernedSupport(runSql: (query: string) => Promise<string> = sql) {
  for (const [tenant, suffix, kind, external] of [
    [org,'m142-version','AGENT_VERSION','agent.ts'], [foreign,'m142-foreign-version','AGENT_VERSION','foreign.ts'],
    [org,'m142-model','MODEL','requested-model'], [foreign,'m142-foreign-model','MODEL','requested-model'],
    [org,'m142-agent','AGENT','agent.ts'],
  ]) {
    const candidate = kind === 'AGENT_VERSION' ? 'candidate:agent-version:' + (tenant===org?'a':'b').repeat(32) : 'candidate:'+suffix;
    const source='catalog-'+suffix; const run='run-'+suffix; const finding='finding-'+suffix; const decision='decision-'+suffix;
    const identity=kind==='AGENT_VERSION'?candidate:kind==='MODEL'?'requested-model':'agent-code';
    const envelope={candidateId:candidate,candidateKind:kind,sourceObject:{connectionId:source,externalType:'source',externalId:external},
      findingId:finding,assertionIds:['assertion-'+suffix],evidenceIds:[],confidence:1,requiresReconciliation:true,
      proposedIdentity:kind==='MODEL'?{modelReference:identity}:kind==='AGENT'?{agentCode:identity}:{} };
    await runSql(`insert into gov_repo.acquisition_runs(run_id,organisation_id,source_connection_id,source_system_id,adapter_name,adapter_version,mode,status,started_at)
      values('${run}','${tenant}','${source}','catalog','fixture','1','FULL','RUNNING',now());
      insert into gov_repo.discovery_findings(organisation_id,finding_id,finding_nature,candidate_kind,source_connection_id,source_external_type,source_external_id,
      confidence,review_status,requires_review,creates_canonical_object,detected_at,acquisition_run_id,contract_version,envelope,envelope_hash)
      values('${tenant}','${finding}','CANDIDATE','${kind}','${source}','source',${literal(external)},1,'ACCEPTED',true,false,now(),'${run}','1.0','{}',repeat('a',64));
      insert into gov_repo.discovery_candidates(organisation_id,candidate_id,candidate_kind,candidate_family,finding_id,source_connection_id,source_external_type,source_external_id,
      confidence,requires_reconciliation,proposed_identity,acquisition_run_id,contract_version,envelope,envelope_hash)
      values('${tenant}','${candidate}','${kind}','OBJECT','${finding}','${source}','source',${literal(external)},1,true,${literal(JSON.stringify(envelope.proposedIdentity))}::jsonb,
      '${run}','1.0',${literal(JSON.stringify(envelope))}::jsonb,repeat('a',64));
      insert into gov_repo.source_assertions(organisation_id,assertion_id,run_id,source_connection_id,source_external_type,source_external_id,snapshot_id,
      method_code,trust_state,observed_at,recorded_at,contract_version,envelope,envelope_hash)
      values('${tenant}','assertion-${suffix}','${run}','${source}','source',${literal(external)},'snapshot-${suffix}','fixture','DECLARED',now(),now(),'1.0','{}',repeat('a',64));
      insert into gov_repo.discovery_candidate_assertions values('${tenant}','${candidate}','assertion-${suffix}');
      insert into gov_repo.reconciliation_decisions(decision_id,organisation_id,family,outcome,candidate_kind,authority_kind,authority_reference,reason_code,decided_at,
      subject_candidate_id,canonical_object_id,canonical_object_kind,contract_version,envelope,envelope_hash)
      values('${decision}','${tenant}','OBJECT','CREATE_NEW','${kind}','HUMAN','fixture-admin','MANUAL_APPROVAL',now(),'${candidate}','${suffix}','${kind}','1.0','{}',repeat('a',64));
      insert into gov_repo.canonical_objects(canonical_object_id,organisation_id,kind,created_by_decision_id) values('${suffix}','${tenant}','${kind}','${decision}');
      insert into gov_repo.canonical_normalized_object_mappings(mapping_id,organisation_id,canonical_object_id,canonical_object_kind,source_connection_id,source_external_type,source_external_id,
      normalized_object_identity,candidate_id,created_by_decision_id,match_method,valid_from)
      values('mapping-${suffix}','${tenant}','${suffix}','${kind}','${source}','source',${literal(external)},'${identity}','${candidate}','${decision}','MANUAL',now());`);
  }
  await runSql(`insert into gov_repo.execution_source_snapshots values('${org}','m13-snapshot','m13-scope','candidate:agent-version:${'a'.repeat(32)}',
   'catalog-m142-version','catalog','provider','source','agent.ts','entrypoint','snapshot-m142-version',repeat('a',32),'1.0','UNKNOWN',now(),'fixture-digest');`);
}
export function binding() {
  return {organisation_id:org,binding_id:'binding',connection_id:'m142-20260917-runtime-a',producer_identity:'producer',deployment_reference:'deployment',artifact_digest:'c'.repeat(64),
    entrypoint_reference:'entrypoint',agent_version_id:'m142-version',agent_version_kind:'AGENT_VERSION',mapping_id:'mapping-m142-version',
    candidate_id:'candidate:agent-version:'+'a'.repeat(32),source_snapshot_id:'snapshot-m142-version',proof_method:'VERIFIED_RELEASE_ASSOCIATION_V1',proof_version:'1.0.0',verified_by:'fixture-admin'};
}
export function registerBinding(value: Record<string, unknown>) {
  return sql(`select gov_repo.register_runtime_binding('${org}','m142-20260917-runtime-a',${composite(value,'runtime_deployment_bindings')});`);
}
export async function authorityState(): Promise<string> {
  return sql(`select md5(jsonb_build_array(
   (select jsonb_agg(to_jsonb(o) order by canonical_object_id) from gov_repo.canonical_objects o),
   (select jsonb_agg(to_jsonb(r) order by relationship_id) from gov_repo.canonical_relationships r),
   (select jsonb_agg(to_jsonb(s) order by snapshot_id) from gov_repo.execution_source_snapshots s),
   (select jsonb_agg(to_jsonb(s) order by state_id) from gov_repo.execution_field_states s),
   (select jsonb_agg(to_jsonb(d) order by decision_id) from gov_repo.execution_field_decisions d),
   (select jsonb_agg(to_jsonb(h) order by source_scope) from gov_repo.execution_source_heads h),
   (select jsonb_agg(to_jsonb(p) order by canonical_object_id) from gov_repo.agent_version_technical_profiles p),
   (select jsonb_agg(to_jsonb(p) order by proposal_id) from gov_repo.agent_version_technical_profile_proposals p))::text);`);
}
