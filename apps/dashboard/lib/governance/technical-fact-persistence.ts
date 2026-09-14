import 'server-only';
import { asOrganisationId, asCanonicalObjectId, asSourceConnectionId, asSourceSystemId, asExternalId, asIsoTimestamp,
  validateTechnicalFact, type AcquisitionRun, type TechnicalFact, type TechnicalFactProposal, type TechnicalFactObservation, type FieldAuthorityPolicy,
  type FieldReconciliationDecision, type GovernedTechnicalFieldState, type OrganisationId, type TrustedInboundConnection } from '@council/canonical-contracts';
import { StaleFieldDecisionError, StaleFieldPolicyError, type TechnicalFactPersistencePort, type FieldReviewContext } from '@council/governance-review';
import { privilegedDb } from './persistence';

// JSON is database transport only. Domain values are reconstructed from the
// explicit SQL columns; no vendor JSON or arbitrary fact-value column exists.
type Row = Record<string, any>;
type Table = 'technical_source_connections' | 'technical_field_policies' | 'technical_field_policy_heads' | 'technical_fact_proposals' |
  'technical_fact_observations' | 'technical_fact_observation_assertions' | 'technical_fact_observation_evidence' |
  'technical_fact_source_heads' | 'technical_field_decisions' | 'technical_field_decision_observations' |
  'technical_source_snapshot_heads' |
  'technical_field_states' | 'canonical_normalized_object_mappings' | 'canonical_objects';
async function rows(table: Table, org: OrganisationId, filter: Readonly<Record<string,string>> = {}): Promise<Row[]> {
  const result: Row[] = [];
  for (let start = 0; ; start += 500) {
    let query = privilegedDb.from(table).select('*').eq('organisation_id',org);
    for (const [k,v] of Object.entries(filter)) query = query.eq(k,v);
    // Stable ordering for paging; all these tables have an immutable key.
    const order = table === 'technical_source_connections' ? 'connection_id' : table === 'technical_field_policies' || table === 'technical_field_policy_heads' ? 'policy_id' :
      table === 'technical_fact_observation_assertions' ? 'assertion_id' : table === 'technical_fact_observation_evidence' ? 'evidence_id' :
      table === 'technical_field_decisions' ? 'decision_id' : table === 'technical_field_states' ? 'state_id' :
      table === 'canonical_normalized_object_mappings' ? 'mapping_id' : table === 'canonical_objects' ? 'canonical_object_id' :
      table === 'technical_fact_proposals' ? 'proposal_id' : table === 'technical_source_snapshot_heads' ? 'snapshot_id' : 'observation_id';
    query = query.order(order);
    if (table === 'technical_field_policies') query = query.order('version'); // Paging only, never applicability.
    const { data,error } = await query.range(start,start+499);
    if (error) throw new Error(`TECHNICAL_FACT_READ_FAILED: ${table}`);
    result.push(...(data ?? [])); if (!data || data.length < 500) return result;
  }
}
function one(values: Row[], label: string): Row { if (values.length !== 1) throw new TypeError(label); return values[0]; }
function fact(row: Row): TechnicalFact {
  const value = row.field_key === 'structuralKind' ? row.structural_kind : row.field_key === 'technicalName' ? row.technical_name :
    row.field_key === 'technicalDescription' ? row.technical_description : row.field_key === 'qualifiedTechnicalLocator' ? row.qualified_technical_locator : row.native_type;
  const result = { objectKind: row.object_kind, field: row.field_key, value } as TechnicalFact;
  validateTechnicalFact(result); return result;
}
export async function configuredTechnicalConnection(org: OrganisationId, connectionId: string): Promise<TrustedInboundConnection> {
  const r = one(await rows('technical_source_connections',org,{connection_id:connectionId}),'TRUSTED_CONNECTION_NOT_FOUND');
  return { organisationId: org, sourceSystem: { sourceSystemId: asSourceSystemId(r.source_system_id), family: r.family,
    displayName: r.display_name, provider: { providerCode:r.provider_code,resolution:'EXPLICIT' } },
    connection:{connectionId:asSourceConnectionId(r.connection_id),sourceSystemId:asSourceSystemId(r.source_system_id)} };
}
export async function startExchangeAcquisitionRun(org:OrganisationId,run:AcquisitionRun) {
  const {data,error}=await privilegedDb.rpc('start_exchange_acquisition_run',{p_organisation_id:org,p_run:run});
  if(error)throw new Error(`EXCHANGE_ACQUISITION_FAILED: ${error.message}`);
  const r=one(data??[],'EXCHANGE_ACQUISITION_RESULT_MISSING');
  return {replay:r.replay as boolean,runId:run.runId,status:r.status as AcquisitionRun['status']};
}
async function observations(org: OrganisationId, proposalId: string): Promise<TechnicalFactObservation[]> {
  return Promise.all((await rows('technical_fact_observations',org,{proposal_id:proposalId})).map(async r => {
    const [a,e] = await Promise.all([rows('technical_fact_observation_assertions',org,{observation_id:r.observation_id}), rows('technical_fact_observation_evidence',org,{observation_id:r.observation_id})]);
    if (!a.length || !e.length) throw new TypeError('FACT_DURABLE_SUPPORT_MISSING');
    return { organisationId:org,observationId:r.observation_id,proposalId,candidateId:r.candidate_id,observedAt:asIsoTimestamp(r.observed_at),snapshotId:r.snapshot_id,
      support:{assertionIds:a.map(r=>r.assertion_id),evidenceIds:e.map(r=>r.evidence_id)} };
  }));
}
async function loadProposal(org: OrganisationId, id: string): Promise<TechnicalFactProposal> {
  const r = one(await rows('technical_fact_proposals',org,{proposal_id:id}),'FACT_PROPOSAL_NOT_FOUND');
  const cfg = await configuredTechnicalConnection(org,r.connection_id);
  const obs = await observations(org,id);
  const origin = obs.find(o=>o.candidateId===r.candidate_id);
  if (!origin || !['DECLARED','IMPORTED'].includes(r.trust_state)) throw new TypeError('FACT_ORIGIN_MISSING');
  return { proposalId:id,organisationId:org,candidateId:r.candidate_id,fact:fact(r),support:origin.support,
    sourceAttribute:{code:r.attribute_code,path:r.attribute_path},sourceSystem:cfg.sourceSystem,
    sourceObject:{connectionId:cfg.connection.connectionId,externalId:asExternalId(r.external_id),externalType:r.external_type},
    normalizedObjectIdentity:r.normalized_object_identity,trustState:r.trust_state };
}
function policy(r: Row): FieldAuthorityPolicy {
  return {organisationId:asOrganisationId(r.organisation_id),policyId:r.policy_id,version:r.version,objectKind:r.object_kind,field:r.field_key,
    sourceSystemId:r.source_system_id,providerCode:r.provider_code,disposition:r.disposition,
    ...(r.connection_id ? {connectionId:r.connection_id}:{}),...(r.rule_code ? {deterministicRule:{code:r.rule_code,version:r.rule_version}}:{})};
}
export const technicalFactPersistence: TechnicalFactPersistencePort = {
  async recordProposal(proposal,observation) {
    const {error} = await privilegedDb.rpc('record_technical_fact',{p_organisation_id:proposal.organisationId,p_proposal:proposal,p_observation:observation});
    if (error) throw new Error(`FACT_PERSISTENCE_FAILED: ${error.message}`);
  },
  async getReviewContext(org,id): Promise<FieldReviewContext> {
    const proposal = await loadProposal(org,id);
    const mappings = await rows('canonical_normalized_object_mappings',org,{source_connection_id:proposal.sourceObject.connectionId,
      source_external_type:proposal.sourceObject.externalType,source_external_id:proposal.sourceObject.externalId,
      canonical_object_kind:proposal.fact.objectKind,normalized_object_identity:proposal.normalizedObjectIdentity});
    const objects = await Promise.all(mappings.map(async m=> {
      const o = one(await rows('canonical_objects',org,{canonical_object_id:m.canonical_object_id,kind:proposal.fact.objectKind}),'FACT_CANONICAL_OBJECT_MISSING');
      return {organisationId:org,objectId:asCanonicalObjectId(o.canonical_object_id),kind:proposal.fact.objectKind};
    }));
    if (objects.length > 1) throw new TypeError('FACT_MAPPING_AMBIGUOUS');
    const sourceHead = one(await rows('technical_fact_source_heads',org,{connection_id:proposal.sourceObject.connectionId,
      external_type:proposal.sourceObject.externalType,external_id:proposal.sourceObject.externalId,object_kind:proposal.fact.objectKind,field_key:proposal.fact.field}),'FACT_SOURCE_HEAD_MISSING');
    const snapshotHead = one(await rows('technical_source_snapshot_heads',org,{connection_id:proposal.sourceObject.connectionId,
      external_type:proposal.sourceObject.externalType,external_id:proposal.sourceObject.externalId}),'FACT_SOURCE_SNAPSHOT_MISSING');
    let current: GovernedTechnicalFieldState | undefined;
    if (objects[0]) {
      const history = await rows('technical_field_states',org,{canonical_object_id:objects[0].objectId,field_key:proposal.fact.field});
      const heads = history.filter(s=>!history.some(successor=>successor.previous_state_id===s.state_id));
      if (heads.length > 1) throw new TypeError('FIELD_STATE_AMBIGUOUS');
      if (heads[0]) {
        const s=heads[0], p=await loadProposal(org,s.proposal_id);
        current={organisationId:org,stateId:s.state_id,canonicalObject:objects[0],fact:p.fact,proposalId:p.proposalId,
          decisionId:s.decision_id,recordedAt:asIsoTimestamp(s.recorded_at),...(s.previous_state_id ? {previousStateId:s.previous_state_id}:{})};
      }
    }
    return {proposal,observations:await observations(org,id),canonicalObjects:objects,currentSourceObservationId:sourceHead.observation_id,currentSourceSnapshotId:snapshotHead.snapshot_id,
      policies:(await rows('technical_field_policies',org)).map(policy),
      policyHeads:(await rows('technical_field_policy_heads',org)).map(h=>({organisationId:asOrganisationId(h.organisation_id),policyId:h.policy_id,version:h.version})),
      ...(current ? {current}:{})};
  },
  async getDecision(org,id) {
    const found=await rows('technical_field_decisions',org,{decision_id:id}); if (!found.length) return undefined;
    const r=one(found,'FIELD_DECISION_AMBIGUOUS');
    const obs=await rows('technical_field_decision_observations',org,{decision_id:id});
    const states=await rows('technical_field_states',org,{decision_id:id});
    const decision: FieldReconciliationDecision={organisationId:org,decisionId:id,canonicalObject:{organisationId:org,objectId:asCanonicalObjectId(r.canonical_object_id),kind:r.object_kind},
      field:r.field_key,proposalId:r.proposal_id,observationIds:obs.map(o=>o.observation_id),expectedSourceObservationId:r.expected_source_observation_id,
      expectedSourceSnapshotId:r.expected_source_snapshot_id,
      ...(r.expected_current_state_id ? {expectedCurrentStateId:r.expected_current_state_id}:{}),
      ...(r.policy_id ? {policyId:r.policy_id,policyVersion:r.policy_version}:{}),outcome:r.outcome,decidedAt:asIsoTimestamp(new Date(r.decided_at).toISOString()),
      actor:r.actor_kind==='HUMAN' ? {authorityKind:'HUMAN',actorReference:r.actor_reference} : {authorityKind:'DETERMINISTIC_RULE',ruleCode:r.actor_reference,ruleVersion:r.rule_version}};
    return {decision,...(states[0] ? {stateId:states[0].state_id}:{})};
  },
  async recordDecision(decision) {
    const {data,error}=await privilegedDb.rpc('record_technical_field_decision',{p_organisation_id:decision.organisationId,p_decision:decision});
    if (error?.message?.includes('FIELD_STALE_SOURCE')) throw new StaleFieldDecisionError();
    if (error?.message?.includes('FIELD_STALE_POLICY')) throw new StaleFieldPolicyError();
    if (error) throw new Error(`FIELD_DECISION_FAILED: ${error.message}`);
    const r=one(data??[],'FIELD_DECISION_RESULT_MISSING');
    return {replay:r.replay,...(r.state_id ? {stateId:r.state_id}:{})};
  },
};

/** Tenant-local review queue, including pending, conflicting and historical proposals. */
export async function listTechnicalFactProposalIds(org: OrganisationId): Promise<string[]> {
  return (await rows('technical_fact_proposals',org)).map(p=>p.proposal_id);
}
export async function technicalFieldDecisionHistory(org: OrganisationId,proposalId:string) {
  return Promise.all((await rows('technical_field_decisions',org,{proposal_id:proposalId})).map(async r=>
    (await technicalFactPersistence.getDecision(org,r.decision_id))!.decision));
}
