import 'server-only';
import { validateTechnicalFact, type TechnicalFact } from '@council/canonical-contracts';
import { currentFieldState, type DataFieldFact, type PassportProvenance, type RelationshipFact } from './agent-passport';
import type { PassportReader, ProposalRow } from './passport-read-store';

function typedFact(row: ProposalRow): TechnicalFact {
  const value = row.field_key === 'structuralKind' ? row.structural_kind : row.field_key === 'technicalName' ? row.technical_name :
    row.field_key === 'technicalDescription' ? row.technical_description : row.field_key === 'qualifiedTechnicalLocator' ? row.qualified_technical_locator : row.native_type;
  const fact = { objectKind: row.object_kind, field: row.field_key, value } as TechnicalFact;
  validateTechnicalFact(fact);
  if (!['IMPORTED', 'DECLARED'].includes(row.trust_state)) throw new Error('PASSPORT_FIELD_TRUST_INVALID');
  return fact;
}

export async function readPassportDataFields(read: PassportReader, access: RelationshipFact,
  support: (assertions: readonly string[], evidence: readonly string[]) => Promise<Pick<PassportProvenance, 'sources' | 'evidence'>>,
): Promise<DataFieldFact[]> {
  if (!access.versionId || !['READS_FROM', 'WRITES_TO'].includes(access.relationshipType) ||
    !['DATA_ASSET', 'DATA_ELEMENT'].includes(access.targetKind)) return [];
  const objectId = access.targetId;
  const history = await read('technical_field_states', { canonical_object_id: objectId });
  const fields = [...new Set(history.map(s => s.field_key))].sort();
  const mappings = await read('canonical_normalized_object_mappings', { canonical_object_id: objectId });
  const result: DataFieldFact[] = [];
  for (const field of fields) {
    const state = currentFieldState(history.filter(s => s.field_key === field))!;
    const [proposal] = await read('technical_fact_proposals', { proposal_id: state.proposal_id });
    const [decision] = await read('technical_field_decisions', { decision_id: state.decision_id });
    if (!proposal || !decision || state.object_kind !== access.targetKind || proposal.object_kind !== access.targetKind ||
      proposal.field_key !== field || decision.outcome !== 'ACCEPT_PROPOSED' || decision.canonical_object_id !== objectId ||
      decision.object_kind !== state.object_kind || decision.field_key !== field || decision.proposal_id !== state.proposal_id ||
      !decision.policy_id || !decision.policy_version) throw new Error('PASSPORT_FIELD_STATE_INVALID');
    const exactMappings = await read('canonical_normalized_object_mappings', {
      source_connection_id: proposal.connection_id, source_external_type: proposal.external_type,
      source_external_id: proposal.external_id, canonical_object_kind: proposal.object_kind,
      normalized_object_identity: proposal.normalized_object_identity,
    });
    if (exactMappings.length !== 1 || exactMappings[0].canonical_object_id !== objectId) throw new Error('PASSPORT_FIELD_MAPPING_INVALID');
    const [observation] = await read('technical_fact_observations', { observation_id: decision.expected_source_observation_id });
    if (!observation || observation.proposal_id !== proposal.proposal_id || observation.snapshot_id !== decision.expected_source_snapshot_id) {
      throw new Error('PASSPORT_FIELD_OBSERVATION_INVALID');
    }
    const assertions = await read('technical_fact_observation_assertions', { observation_id: observation.observation_id });
    const evidence = await read('technical_fact_observation_evidence', { observation_id: observation.observation_id });
    if (!assertions.length || !evidence.length) throw new Error('PASSPORT_FIELD_SUPPORT_MISSING');
    const provenance = await support(assertions.map(a => a.assertion_id), evidence.map(e => e.evidence_id));
    if (provenance.sources.length !== assertions.length || provenance.evidence.length !== evidence.length) throw new Error('PASSPORT_FIELD_SUPPORT_MISSING');
    const [head] = await read('technical_field_policy_heads', { policy_id: decision.policy_id });
    const competing = new Set<string>();
    for (const mapping of mappings) {
      const proposals = await read('technical_fact_proposals', { connection_id: mapping.source_connection_id,
        external_type: mapping.source_external_type, external_id: mapping.source_external_id,
        object_kind: proposal.object_kind, field_key: field, normalized_object_identity: mapping.normalized_object_identity });
      for (const other of proposals) {
        if (other.proposal_id !== proposal.proposal_id && typedFact(other).value !== typedFact(proposal).value) competing.add(other.proposal_id);
      }
    }
    result.push({ type: 'data-field', id: `${access.id}:${state.state_id}`, objectId, versionId: access.versionId,
      accessRelationshipId: access.id, stateId: state.state_id, fact: typedFact(proposal),
      source: { systemId: proposal.source_system_id, connectionId: proposal.connection_id, externalId: proposal.external_id,
        externalType: proposal.external_type, trust: proposal.trust_state },
      competingProposalIds: [...competing].sort(),
      provenance: { storage: 'technical_field_states', authority: 'GOVERNED_FIELD_STATE', ...provenance,
        decisionId: decision.decision_id, decidedAt: decision.decided_at, recordedAt: state.recorded_at,
        snapshotId: observation.snapshot_id, observedAt: observation.observed_at,
        policy: { policyId: decision.policy_id, acceptedVersion: decision.policy_version, activeVersion: head?.version } },
    });
  }
  // Re-read the immutable chain to detect concurrent acceptance during composition.
  // This is not a transaction-wide snapshot; every fact retains its exact state/time.
  const after = await read('technical_field_states', { canonical_object_id: objectId });
  if (history.map(s => s.state_id).sort().join('\n') !== after.map(s => s.state_id).sort().join('\n')) {
    throw new Error('PASSPORT_FIELD_STATE_CHANGED_RETRY');
  }
  return result;
}
