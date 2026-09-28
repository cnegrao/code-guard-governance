import { createHash } from 'node:crypto';

/**
 * S0.3.3B fixtures for the REAL governance persistence chain in the disposable PG17 profile.
 * Administrator-only support rows (findings, candidates, canonical objects, mappings, policies,
 * snapshots) are inserted directly, exactly like the M15 disposable fixtures; the AUTHORITATIVE
 * write under test is always performed by the real production function or wrapper.
 * Every kit is unique per label so scenarios never share mutable authority state.
 */
export const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;
export const jsonLit = (value: unknown) => `${lit(JSON.stringify(value))}::jsonb`;
const HASH = `repeat('a',64)`;
export const hex32 = (label: string) => createHash('sha256').update(label).digest('hex').slice(0, 32);
const frame = (parts: string[]) => parts.map(part => `${Buffer.byteLength(part)}:${part}`).join('');

/** Named-notation argument list: `p_a => <sql>, ...` (values are already SQL text). */
export const named = (args: Record<string, string>) => Object.entries(args).map(([key, value]) => `${key} => ${value}`).join(',\n  ');

export interface CanonicalObjectKit { candidate: string; objectId: string; kind: string; connection: string; externalId: string; identity: string; sql: string }

/** run + finding + OBJECT candidate + human decision + canonical object + exact typed mapping. */
export function canonicalObjectKit(org: string, label: string, kind: string, opts: { connection?: string; externalType?: string; externalId?: string;
  proposedIdentity: Record<string, string>; identity: string; candidateId?: string; snapshot?: string }): CanonicalObjectKit {
  const connection = opts.connection ?? `conn-${label}`;
  const externalType = opts.externalType ?? 'source';
  const externalId = opts.externalId ?? `${label}.ts`;
  const candidate = opts.candidateId ?? `candidate:${label}`;
  const objectId = `canonical-object:${label}`;
  const run = `run-${label}`, finding = `finding-${label}`, decision = `decision-${label}`;
  const envelope = { candidateId: candidate, candidateKind: kind, sourceObject: { connectionId: connection, externalType, externalId }, findingId: finding,
    assertionIds: [`assertion-${label}`], evidenceIds: [], confidence: 1, requiresReconciliation: true, proposedIdentity: opts.proposedIdentity };
  const sql = `insert into gov_repo.acquisition_runs(run_id,organisation_id,source_connection_id,source_system_id,adapter_name,adapter_version,mode,status,started_at)
    values(${lit(run)},'${org}',${lit(connection)},'catalog','fixture','1','FULL','RUNNING',now());
    insert into gov_repo.discovery_findings(organisation_id,finding_id,finding_nature,candidate_kind,source_connection_id,source_external_type,source_external_id,
      confidence,review_status,requires_review,creates_canonical_object,detected_at,acquisition_run_id,contract_version,envelope,envelope_hash)
      values('${org}',${lit(finding)},'CANDIDATE',${lit(kind)},${lit(connection)},${lit(externalType)},${lit(externalId)},1,'ACCEPTED',true,false,now(),${lit(run)},'1.0','{}',${HASH});
    insert into gov_repo.discovery_candidates(organisation_id,candidate_id,candidate_kind,candidate_family,finding_id,source_connection_id,source_external_type,source_external_id,
      confidence,requires_reconciliation,proposed_identity,acquisition_run_id,contract_version,envelope,envelope_hash)
      values('${org}',${lit(candidate)},${lit(kind)},'OBJECT',${lit(finding)},${lit(connection)},${lit(externalType)},${lit(externalId)},1,true,${jsonLit(opts.proposedIdentity)},
      ${lit(run)},'1.0',${jsonLit(envelope)},${HASH});
    insert into gov_repo.source_assertions(organisation_id,assertion_id,run_id,source_connection_id,source_external_type,source_external_id,snapshot_id,
      method_code,trust_state,observed_at,recorded_at,contract_version,envelope,envelope_hash)
      values('${org}',${lit(`assertion-${label}`)},${lit(run)},${lit(connection)},${lit(externalType)},${lit(externalId)},${lit(opts.snapshot ?? `snapshot-${label}`)},'fixture','DECLARED',now(),now(),'1.0','{}',${HASH});
    insert into gov_repo.reconciliation_decisions(decision_id,organisation_id,family,outcome,candidate_kind,authority_kind,authority_reference,reason_code,decided_at,
      subject_candidate_id,canonical_object_id,canonical_object_kind,contract_version,envelope,envelope_hash)
      values(${lit(decision)},'${org}','OBJECT','CREATE_NEW',${lit(kind)},'HUMAN','fixture-admin','MANUAL_APPROVAL',now(),${lit(candidate)},${lit(objectId)},${lit(kind)},'1.0','{}',${HASH});
    insert into gov_repo.canonical_objects(canonical_object_id,organisation_id,kind,created_by_decision_id) values(${lit(objectId)},'${org}',${lit(kind)},${lit(decision)});
    insert into gov_repo.canonical_normalized_object_mappings(mapping_id,organisation_id,canonical_object_id,canonical_object_kind,source_connection_id,source_external_type,source_external_id,
      normalized_object_identity,candidate_id,created_by_decision_id,match_method,valid_from)
      values(${lit(`mapping-${label}`)},'${org}',${lit(objectId)},${lit(kind)},${lit(connection)},${lit(externalType)},${lit(externalId)},${lit(opts.identity)},${lit(candidate)},${lit(decision)},'MANUAL',now());`;
  return { candidate, objectId, kind, connection, externalId, identity: opts.identity, sql };
}

/** Un-reconciled OBJECT candidate + its review subject in the requested state (no canonical object yet). */
export function reviewedObjectKit(org: string, label: string, state: 'DETECTED' | 'CERTIFIED', kind = 'MODEL') {
  const connection = `conn-${label}`, externalType = 'source', externalId = `${label}.ts`;
  const candidate = `candidate:${label}`, finding = `finding-${label}`, run = `run-${label}`, subject = `review-${label}`;
  const proposedIdentity = { modelReference: `model-${label}` };
  const envelope = { candidateId: candidate, candidateKind: kind, sourceObject: { connectionId: connection, externalType, externalId }, findingId: finding,
    assertionIds: [`assertion-${label}`], evidenceIds: [], confidence: 1, requiresReconciliation: true, proposedIdentity };
  const sql = `insert into gov_repo.acquisition_runs(run_id,organisation_id,source_connection_id,source_system_id,adapter_name,adapter_version,mode,status,started_at)
    values(${lit(run)},'${org}',${lit(connection)},'catalog','fixture','1','FULL','RUNNING',now());
    insert into gov_repo.discovery_findings(organisation_id,finding_id,finding_nature,candidate_kind,source_connection_id,source_external_type,source_external_id,
      confidence,review_status,requires_review,creates_canonical_object,detected_at,acquisition_run_id,contract_version,envelope,envelope_hash)
      values('${org}',${lit(finding)},'CANDIDATE',${lit(kind)},${lit(connection)},${lit(externalType)},${lit(externalId)},1,'ACCEPTED',true,false,now(),${lit(run)},'1.0','{}',${HASH});
    ${state === 'CERTIFIED' ? `insert into gov_repo.discovery_candidates(organisation_id,candidate_id,candidate_kind,candidate_family,finding_id,source_connection_id,source_external_type,source_external_id,
      confidence,requires_reconciliation,proposed_identity,acquisition_run_id,contract_version,envelope,envelope_hash)
      values('${org}',${lit(candidate)},${lit(kind)},'OBJECT',${lit(finding)},${lit(connection)},${lit(externalType)},${lit(externalId)},1,true,${jsonLit(proposedIdentity)},
      ${lit(run)},'1.0',${jsonLit(envelope)},${HASH});` : ''}
    insert into gov_repo.review_subjects(review_subject_id,organisation_id,finding_id,candidate_kind,source_connection_id,source_external_type,source_external_id,state,detected_at)
      values(${lit(subject)},'${org}',${lit(finding)},${lit(kind)},${lit(connection)},${lit(externalType)},${lit(externalId)},'${state}',now());`;
  return { sql, subject, finding, candidate, kind, connection, externalType, externalId, canonicalObjectId: `canonical-object:${label}` };
}

const reconcileBusiness = (label: string, org: string, kit: ReturnType<typeof reviewedObjectKit>, actor: string, envelopeOverride?: Record<string, unknown>) => {
  const envelope = { organisationId: org, decisionId: `decision-${label}`, outcome: 'CREATE_NEW', candidateKind: kit.kind,
    authority: { authorityKind: 'HUMAN', actorReference: actor }, ...envelopeOverride };
  return {
    p_review_subject_id: lit(kit.subject), p_authorization_decision_id: lit(`authz-${label}`), p_authorization_subject_kind: `'CANDIDATE'`,
    p_authorization_subject_candidate_id: lit(kit.candidate), p_authorization_subject_candidate_merge_id: 'null::text', p_requested_action: `'CREATE_NEW'`,
    p_authorization_evaluated_at: 'now()', p_policy_reference: `'GOVERNANCE_REVIEWER_ROLE_V1'`, p_invocation_id: lit(`invocation-${label}`),
    p_command_id: lit(`command-${label}`), p_command_fingerprint: lit(`fingerprint-${label}`), p_requested_at: 'now()', p_reason_code: `'MANUAL_APPROVAL'`,
    p_decision_id: lit(`decision-${label}`), p_family: `'OBJECT'`, p_outcome: `'CREATE_NEW'`, p_candidate_kind: lit(kit.kind), p_decided_at: 'now()',
    p_subject_candidate_id: lit(kit.candidate), p_subject_candidate_merge_id: 'null::text', p_canonical_object_id: lit(kit.canonicalObjectId),
    p_canonical_object_kind: lit(kit.kind), p_relationship_candidate_id: 'null::text', p_relationship_type_code: 'null::text', p_candidate_merge_id: 'null::text',
    p_merge_member_candidate_ids: `'{}'::text[]`, p_assertion_ids: `'{}'::text[]`, p_evidence_ids: `'{}'::text[]`, p_contract_version: `'1.1'`,
    p_envelope: jsonLit(envelope), p_envelope_hash: HASH,
  } as Record<string, string>;
};

/** Business arguments (after the five verified principal arguments) of record_authorized_reconciliation_governed_v1. */
export const governedReconciliationArgs = (label: string, org: string, kit: ReturnType<typeof reviewedObjectKit>, actor: string, envelopeOverride?: Record<string, unknown>) =>
  reconcileBusiness(label, org, kit, actor, envelopeOverride);

/** Legacy record_authorized_reconciliation call (the unchanged, still-executable production function). */
export function legacyReconciliationSql(label: string, org: string, kit: ReturnType<typeof reviewedObjectKit>, actor: string) {
  const args = { p_organisation_id: `'${org}'::uuid`, p_authorization_actor_reference: lit(actor), p_authority_reference: lit(actor), ...reconcileBusiness(label, org, kit, actor) };
  return `select to_json(r) from gov_repo.record_authorized_reconciliation(${named(args)}) r;`;
}

export const materializeObjectArgs = (label: string, kit: ReturnType<typeof reviewedObjectKit>) => ({
  p_reconciliation_decision_id: lit(`decision-${label}`), p_invocation_id: lit(`invocation-${label}`), p_outcome: `'CREATE_NEW'`,
  p_canonical_object_id: lit(kit.canonicalObjectId), p_canonical_object_kind: lit(kit.kind), p_source_connection_id: lit(kit.connection),
  p_source_external_type: lit(kit.externalType), p_source_external_id: lit(kit.externalId), p_match_method: `'MANUAL'`,
  p_idempotency_fingerprint: `repeat('b',64)`, p_occurred_at: 'now()',
}) as Record<string, string>;

export function reviewTransitionArgs(label: string, kit: ReturnType<typeof reviewedObjectKit>) {
  return { p_review_subject_id: lit(kit.subject), p_finding_id: lit(kit.finding), p_previous_state: `'DETECTED'`, p_new_state: `'PROPOSED'`,
    p_occurred_at: 'now()', p_evidence_ids: `'{}'::text[]`, p_reason_code: 'null::text', p_command_id: lit(`cmd-${label}`), p_event_id: lit(`evt-${label}`) } as Record<string, string>;
}

/** Everything required for a real, valid CREATE_NEW EXPOSES relationship materialization. */
export function relationshipKit(org: string, label: string, actor: string) {
  const source = canonicalObjectKit(org, `${label}-src`, 'MCP_SERVER', { proposedIdentity: { serverReference: `server-${label}` }, identity: `server-${label}` });
  const target = canonicalObjectKit(org, `${label}-tgt`, 'TOOL', { proposedIdentity: { declarationKey: `tool-${label}` }, identity: `tool-${label}` });
  const relationshipId = `canonical-relationship:${createHash('sha256').update(frame([org, 'EXPOSES', source.objectId, target.objectId]), 'utf8').digest('hex')}`;
  const stateId = `${relationshipId}:initial`;
  const candidate = `candidate:rel-${label}`, finding = `finding-rel-${label}`, run = `run-rel-${label}`, subject = `review-rel-${label}`;
  const connection = `conn-rel-${label}`;
  const validFrom = '2026-09-01T00:00:00.000Z';
  const endpointRef = (kit: CanonicalObjectKit) => ({ referenceKind: 'CANDIDATE', candidateKind: kit.kind, candidateId: kit.candidate });
  const envelope = { candidateId: candidate, candidateKind: 'RELATIONSHIP', assertionIds: [`assertion-rel-${label}`], evidenceIds: [`evidence-rel-${label}`] };
  const decisionEnvelope = { organisationId: org, decisionId: `decision-rel-${label}`, outcome: 'CREATE_NEW', authority: { authorityKind: 'HUMAN', actorReference: actor },
    assertionIds: [`assertion-rel-${label}`], evidenceIds: [`evidence-rel-${label}`],
    authorizedState: { organisationId: org, relationshipId, relationshipStateId: stateId, relationshipType: 'EXPOSES', validFrom, recordedAt: validFrom,
      source: { canonicalObject: { organisationId: org, objectId: source.objectId, kind: 'MCP_SERVER' } },
      target: { canonicalObject: { organisationId: org, objectId: target.objectId, kind: 'TOOL' } } } };
  const sql = `${source.sql}
    ${target.sql}
    insert into gov_repo.acquisition_runs(run_id,organisation_id,source_connection_id,source_system_id,adapter_name,adapter_version,mode,status,started_at)
      values(${lit(run)},'${org}',${lit(connection)},'catalog','fixture','1','FULL','RUNNING',now());
    insert into gov_repo.discovery_findings(organisation_id,finding_id,finding_nature,candidate_kind,source_connection_id,source_external_type,source_external_id,
      confidence,review_status,requires_review,creates_canonical_object,detected_at,acquisition_run_id,contract_version,envelope,envelope_hash)
      values('${org}',${lit(finding)},'CANDIDATE','RELATIONSHIP',${lit(connection)},'source',${lit(`rel-${label}`)},1,'ACCEPTED',true,false,now(),${lit(run)},'1.0','{}',${HASH});
    insert into gov_repo.discovery_candidates(organisation_id,candidate_id,candidate_kind,candidate_family,finding_id,source_connection_id,source_external_type,source_external_id,
      confidence,requires_reconciliation,relationship_type_code,source_endpoint,target_endpoint,acquisition_run_id,contract_version,envelope,envelope_hash)
      values('${org}',${lit(candidate)},'RELATIONSHIP','RELATIONSHIP',${lit(finding)},${lit(connection)},'source',${lit(`rel-${label}`)},1,true,'EXPOSES',
      ${jsonLit(endpointRef(source))},${jsonLit(endpointRef(target))},${lit(run)},'1.0',${jsonLit(envelope)},${HASH});
    insert into gov_repo.review_subjects(review_subject_id,organisation_id,finding_id,candidate_kind,source_connection_id,source_external_type,source_external_id,state,detected_at)
      values(${lit(subject)},'${org}',${lit(finding)},'RELATIONSHIP',${lit(connection)},'source',${lit(`rel-${label}`)},'CERTIFIED',now());`;
  const legacyDecisionSql = `select to_json(r) from gov_repo.record_authorized_reconciliation(${named({
    p_organisation_id: `'${org}'::uuid`, p_review_subject_id: lit(subject), p_authorization_decision_id: lit(`authz-rel-${label}`),
    p_authorization_actor_reference: lit(actor), p_authorization_subject_kind: `'CANDIDATE'`, p_authorization_subject_candidate_id: lit(candidate),
    p_authorization_subject_candidate_merge_id: 'null::text', p_requested_action: `'CREATE_NEW'`, p_authorization_evaluated_at: 'now()',
    p_policy_reference: `'GOVERNANCE_REVIEWER_ROLE_V1'`, p_invocation_id: lit(`invocation-rel-${label}`), p_command_id: lit(`command-rel-${label}`),
    p_command_fingerprint: lit(`fingerprint-rel-${label}`), p_requested_at: 'now()', p_reason_code: `'MANUAL_APPROVAL'`, p_decision_id: lit(`decision-rel-${label}`),
    p_family: `'RELATIONSHIP'`, p_outcome: `'CREATE_NEW'`, p_candidate_kind: `'RELATIONSHIP'`, p_authority_reference: lit(actor), p_decided_at: 'now()',
    p_subject_candidate_id: 'null::text', p_subject_candidate_merge_id: 'null::text', p_canonical_object_id: 'null::text', p_canonical_object_kind: 'null::text',
    p_relationship_candidate_id: lit(candidate), p_relationship_type_code: `'EXPOSES'`, p_candidate_merge_id: 'null::text', p_merge_member_candidate_ids: `'{}'::text[]`,
    p_assertion_ids: `array[${lit(`assertion-rel-${label}`)}]`, p_evidence_ids: `array[${lit(`evidence-rel-${label}`)}]`, p_contract_version: `'1.1'`,
    p_envelope: jsonLit(decisionEnvelope), p_envelope_hash: HASH })}) r;`;
  const args = {
    p_reconciliation_decision_id: lit(`decision-rel-${label}`), p_invocation_id: lit(`invocation-rel-${label}`), p_outcome: `'CREATE_NEW'`,
    p_relationship_id: lit(relationshipId), p_relationship_state_id: lit(stateId), p_relationship_type: `'EXPOSES'`,
    p_source_canonical_object_id: lit(source.objectId), p_source_kind: `'MCP_SERVER'`, p_target_canonical_object_id: lit(target.objectId), p_target_kind: `'TOOL'`,
    p_valid_from: `'${validFrom}'::timestamptz`, p_recorded_at: `'${validFrom}'::timestamptz`, p_idempotency_fingerprint: `repeat('c',64)`,
  } as Record<string, string>;
  return { sql, legacyDecisionSql, args, relationshipId };
}

/** Technical DATA_ASSET field review support; decisions use DEFER (no policy needed) unless the caller supplies one. */
export function technicalKit(org: string, label: string) {
  const conn = `tconn-${label}`, ext = `table-${label}`, snapshot = `tsnap-${label}`, observation = `tobs-${label}`, proposal = `tprop-${label}`;
  const object = canonicalObjectKit(org, `tech-${label}`, 'DATA_ASSET', { connection: conn, externalType: 'catalog-table', externalId: ext,
    proposedIdentity: { sourceReference: `ref-${label}` }, identity: `ref-${label}`, snapshot });
  const sql = `insert into gov_repo.technical_source_connections(connection_id,organisation_id,source_system_id,provider_code,family,display_name)
      values(${lit(conn)},'${org}','catalog','provider','CATALOG','Fixture');
    ${object.sql}
    insert into gov_repo.technical_fact_proposals(organisation_id,proposal_id,candidate_id,object_kind,field_key,technical_name,connection_id,source_system_id,
      external_type,external_id,normalized_object_identity,trust_state,attribute_code,attribute_path)
      values('${org}',${lit(proposal)},${lit(object.candidate)},'DATA_ASSET','technicalName',${lit(`name-${label}`)},${lit(conn)},'catalog','catalog-table',${lit(ext)},${lit(`ref-${label}`)},'IMPORTED','name','name');
    insert into gov_repo.technical_fact_observations(organisation_id,observation_id,proposal_id,candidate_id,observed_at,snapshot_id)
      values('${org}',${lit(observation)},${lit(proposal)},${lit(object.candidate)},now(),${lit(snapshot)});
    insert into gov_repo.technical_fact_observation_assertions(organisation_id,observation_id,assertion_id) values('${org}',${lit(observation)},${lit(`assertion-tech-${label}`)});
    insert into gov_repo.technical_source_snapshots(organisation_id,connection_id,external_type,external_id,snapshot_id) values('${org}',${lit(conn)},'catalog-table',${lit(ext)},${lit(snapshot)});
    insert into gov_repo.technical_source_snapshot_heads(organisation_id,connection_id,external_type,external_id,snapshot_id) values('${org}',${lit(conn)},'catalog-table',${lit(ext)},${lit(snapshot)});
    insert into gov_repo.technical_fact_source_heads(organisation_id,connection_id,external_type,external_id,object_kind,field_key,observation_id)
      values('${org}',${lit(conn)},'catalog-table',${lit(ext)},'DATA_ASSET','technicalName',${lit(observation)});`;
  const decision = (id: string, actor: string, overrides: Record<string, unknown> = {}) => ({
    organisationId: org, decisionId: id, canonicalObject: { organisationId: org, objectId: object.objectId, kind: 'DATA_ASSET' }, field: 'technicalName',
    proposalId: proposal, observationIds: [observation], expectedSourceObservationId: observation, expectedSourceSnapshotId: snapshot, outcome: 'DEFER',
    actor: { authorityKind: 'HUMAN', actorReference: actor }, decidedAt: '2026-09-25T12:00:00.000Z', ...overrides });
  return { sql, decision, objectId: object.objectId };
}

/** AGENT_VERSION execution snapshot + AUTHORITATIVE PRINCIPAL policy: ACCEPT_PROPOSED writes a decision AND a state row. */
export function executionKit(org: string, label: string) {
  const object = canonicalObjectKit(org, `exec-${label}`, 'AGENT_VERSION', { candidateId: `candidate:agent-version:${hex32(label)}`,
    proposedIdentity: {}, identity: `candidate:agent-version:${hex32(label)}` });
  const snapshot = `esnap-${label}`, scope = `escope-${label}`, policy = `epol-${label}`;
  const sql = `${object.sql}
    insert into gov_repo.execution_source_snapshots(organisation_id,snapshot_id,source_scope,candidate_id,connection_id,source_system_id,provider_code,external_type,external_id,
      declaration_key,source_snapshot_id,fingerprint_value,fingerprint_schema,authorization_state,recorded_at,content_digest)
      values('${org}',${lit(snapshot)},${lit(scope)},${lit(object.candidate)},${lit(object.connection)},'catalog','provider','source',${lit(object.externalId)},'entrypoint',
      ${lit(`snapshot-exec-${label}`)},${lit(hex32(`fp-${label}`))},'1.0','UNKNOWN',now(),'digest');
    insert into gov_repo.execution_source_heads(organisation_id,source_scope,snapshot_id) values('${org}',${lit(scope)},${lit(snapshot)});
    insert into gov_repo.execution_field_policies(organisation_id,policy_id,version,field_key,source_system_id,provider_code,connection_id,disposition)
      values('${org}',${lit(policy)},'1','PRINCIPAL','catalog','provider',null,'AUTHORITATIVE');
    insert into gov_repo.execution_field_policy_heads(organisation_id,policy_id,version) values('${org}',${lit(policy)},'1');`;
  const decision = (id: string, actor: string, overrides: Record<string, unknown> = {}) => ({
    organisationId: org, decisionId: id, canonicalObject: { organisationId: org, kind: 'AGENT_VERSION', objectId: object.objectId }, snapshotId: snapshot,
    field: 'PRINCIPAL', outcome: 'ACCEPT_PROPOSED', policyId: policy, policyVersion: '1', actor: { authorityKind: 'HUMAN', actorReference: actor },
    decidedAt: '2026-09-25T12:00:00.000Z', ...overrides });
  return { sql, decision };
}
