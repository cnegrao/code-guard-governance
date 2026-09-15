import 'server-only';
import { TRUST_STATE, type OrganisationId } from '@council/canonical-contracts';
import { getCanonicalObjectForMatch } from './canonical-object-lookup';
import { family, type AgentPassport360, type IdentityFact, type MappingFact, type PassportProvenance,
  type PassportVersionContext, type ProfileFact, type ProfileField, type RelationshipFact } from './agent-passport';
import { passportReader, type ObjectRow, type RelationshipRow } from './passport-read-store';
import { readPassportDataFields } from './passport-field-query';

/** Server-only CQRS read composition. No command port, RPC, provider or generated facts. */
export async function getAgentPassport(org: OrganisationId, canonicalObjectId: string, selectedVersionId?: string): Promise<AgentPassport360 | undefined> {
  if (selectedVersionId !== undefined && !selectedVersionId.trim()) return undefined;
  const readAt = Date.now();
  function effectiveNow(validFrom: string, validTo?: string | null) {
    const start = Date.parse(validFrom);
    const end = validTo == null ? undefined : Date.parse(validTo);
    if (!Number.isFinite(start) || (end !== undefined && (!Number.isFinite(end) || end < start))) {
      throw new Error('PASSPORT_TEMPORAL_STATE_INVALID');
    }
    return start <= readAt && (end === undefined || readAt < end);
  }
  // Reuse the existing exact organisation + kind + ID gate. Never inspect legacy agents.
  if (!await getCanonicalObjectForMatch(org, 'AGENT', canonicalObjectId)) return undefined;
  const read = passportReader(org);
  const [agent] = await read('canonical_objects', { canonical_object_id: canonicalObjectId, kind: 'AGENT' });
  if (!agent) return undefined;
  const objects = new Map<string, ObjectRow>([[agent.canonical_object_id, agent]]);
  async function object(id: string, kind: ObjectRow['kind']) {
    const existing = objects.get(id);
    if (existing) return existing.kind === kind ? existing : undefined;
    const [row] = await read('canonical_objects', { canonical_object_id: id, kind });
    if (row) objects.set(id, row);
    return row;
  }
  async function support(assertionIds: readonly string[], evidenceIds: readonly string[]): Promise<Pick<PassportProvenance, 'sources' | 'evidence'>> {
    const sources: PassportProvenance['sources'][number][] = [];
    const evidence: PassportProvenance['evidence'][number][] = [];
    for (const id of [...new Set(assertionIds)].sort()) {
      const [a] = await read('source_assertions', { assertion_id: id });
      if (!a) continue;
      if (!Object.values(TRUST_STATE).includes(a.trust_state)) throw new Error('PASSPORT_TRUST_INVALID');
      const [run] = await read('acquisition_runs', { run_id: a.run_id });
      sources.push({ assertionId: a.assertion_id, connectionId: a.source_connection_id, externalType: a.source_external_type,
        externalId: a.source_external_id, trust: a.trust_state, method: a.method_code,
        observedAt: a.observed_at, recordedAt: a.recorded_at, runId: a.run_id, sourceSystemId: run?.source_system_id });
    }
    for (const id of [...new Set(evidenceIds)].sort()) {
      const [e] = await read('discovery_evidence', { evidence_id: id });
      // Metadata only. No raw or redacted Prompt body is loaded or serialized.
      if (e) evidence.push({ evidenceId: e.evidence_id, handling: e.handling, capturedAt: e.captured_at });
    }
    return { sources, evidence };
  }
  const decisionCache = new Map<string, Promise<Pick<PassportProvenance, 'sources' | 'evidence' | 'decisionId' | 'decidedAt' | 'reviewSubjectId'>>>();
  function decisionSupport(id: string) {
    let result = decisionCache.get(id);
    if (!result) {
      result = (async () => {
        const [decision] = await read('reconciliation_decisions', { decision_id: id });
        if (!decision || !['CREATE_NEW', 'MATCH_EXISTING'].includes(decision.outcome)) throw new Error('PASSPORT_GOVERNANCE_SUPPORT_MISSING');
        const assertions = await read('reconciliation_decision_assertions', { decision_id: id });
        const evidence = await read('reconciliation_decision_evidence', { decision_id: id });
        const invocations = await read('reconciliation_invocations', { reconciliation_decision_id: id });
        const reviewIds = [...new Set(invocations.flatMap(i => i.review_subject_id ? [i.review_subject_id] : []))];
        let reviewSubjectId: string | undefined;
        if (reviewIds.length === 1) {
          const [review] = await read('review_subjects', { review_subject_id: reviewIds[0] });
          reviewSubjectId = review?.review_subject_id;
        }
        return { decisionId: id, decidedAt: decision.decided_at, reviewSubjectId,
          ...await support(assertions.map(a => a.assertion_id), evidence.map(e => e.evidence_id)) };
      })();
      decisionCache.set(id, result);
    }
    return result;
  }
  async function identity(row: ObjectRow): Promise<IdentityFact> {
    return { type: 'identity', id: row.canonical_object_id, objectId: row.canonical_object_id, objectKind: row.kind, organisationId: org,
      provenance: { storage: 'canonical_objects', authority: 'GOVERNED_IDENTITY', recordedAt: row.created_at,
        revision: row.revision, ...await decisionSupport(row.created_by_decision_id) } };
  }
  const canonicalAgent = await identity(agent);
  const versionContexts: PassportVersionContext[] = [];
  const related = await read('canonical_normalized_object_mappings', { parent_canonical_object_id: agent.canonical_object_id, canonical_object_kind: 'AGENT_VERSION' });
  for (const id of [...new Set(related.map(m => m.canonical_object_id))].sort()) {
    const allMappings = await read('canonical_normalized_object_mappings', { canonical_object_id: id, canonical_object_kind: 'AGENT_VERSION' });
    // A match can connect several source identities. Every available parent must agree.
    if (!allMappings.length || allMappings.some(m => m.parent_canonical_object_id !== agent.canonical_object_id) ||
      !allMappings.some(m => effectiveNow(m.valid_from))) continue;
    if (!await object(id, 'AGENT_VERSION')) continue;
    versionContexts.push({ objectId: id, versionCode: null, associationMappingIds: allMappings.map(m => m.mapping_id).sort() });
  }
  if (selectedVersionId && !versionContexts.some(v => v.objectId === selectedVersionId)) return undefined;
  const selected = selectedVersionId ?? null; // Even a single version is never called current automatically.
  const identityFacts = [canonicalAgent];
  for (const v of versionContexts) identityFacts.push(await identity(objects.get(v.objectId)!));
  const discovery: MappingFact[] = [];
  for (const id of [canonicalObjectId, ...(selected ? [selected] : [])]) {
    const normalized = await read('canonical_normalized_object_mappings', { canonical_object_id: id });
    const coarse = await read('canonical_object_source_mappings', { canonical_object_id: id });
    for (const m of normalized) {
      if (!effectiveNow(m.valid_from)) continue;
      if (m.canonical_object_kind !== objects.get(id)?.kind) continue;
      discovery.push({ type: 'mapping', id: m.mapping_id, objectId: id, connectionId: m.source_connection_id,
        externalId: m.source_external_id, externalType: m.source_external_type,
        provenance: { storage: 'canonical_normalized_object_mappings', authority: 'GOVERNED_MAPPING', validFrom: m.valid_from,
          ...await decisionSupport(m.created_by_decision_id) } });
    }
    for (const m of coarse.filter(m => effectiveNow(m.valid_from, m.valid_to))) {
      if (m.canonical_object_kind !== objects.get(id)?.kind) continue;
      if (normalized.some(n => effectiveNow(n.valid_from) && n.source_connection_id === m.source_connection_id && n.source_external_type === m.source_external_type && n.source_external_id === m.source_external_id)) continue;
      discovery.push({ type: 'mapping', id: m.mapping_id, objectId: id, connectionId: m.source_connection_id,
        externalId: m.source_external_id, externalType: m.source_external_type,
        provenance: { storage: 'canonical_object_source_mappings', authority: 'GOVERNED_MAPPING', validFrom: m.valid_from, validTo: m.valid_to ?? undefined,
          ...await decisionSupport(m.created_by_decision_id) } });
    }
  }
  const profileFacts: ProfileFact[] = [];
  if (selected) {
    const [profile] = await read('agent_version_technical_profiles', { canonical_object_id: selected });
    if (profile) {
      const assertions = await read('agent_version_technical_profile_field_assertions', { canonical_object_id: selected });
      const evidence = await read('agent_version_technical_profile_field_evidence', { canonical_object_id: selected });
      const values: readonly [ProfileField, string | null][] = [
        ['behaviorFingerprint', `${profile.behavior_fingerprint_algorithm}:${profile.behavior_fingerprint_schema_version}:${profile.behavior_fingerprint_value}`],
        ['buildReference', profile.build_reference], ['runtimeFrameworkReference', profile.runtime_framework_reference],
        ['entrypointReference', profile.entrypoint_reference], ['configurationReference', profile.configuration_reference],
      ];
      for (const [field, value] of values) {
        if (!value) continue;
        profileFacts.push({ type: 'profile', id: `${selected}:${field}`, versionId: selected, field, value,
          provenance: { storage: 'agent_version_technical_profiles', authority: 'GOVERNED_PROFILE', revision: profile.revision,
            profileOriginProposalId: profile.source_proposal_id,
            recordedAt: profile.updated_at, ...await support(assertions.filter(a => a.field_name === field).map(a => a.assertion_id),
              evidence.filter(e => e.field_name === field).map(e => e.evidence_id)) } });
      }
    }
  }
  async function relationship(row: RelationshipRow): Promise<RelationshipFact | undefined> {
    if (!effectiveNow(row.valid_from, row.valid_to) || !await object(row.source_canonical_object_id, row.source_kind) || !await object(row.target_canonical_object_id, row.target_kind)) return undefined;
    return { type: 'relationship', id: row.relationship_id, stateId: row.relationship_state_id,
      relationshipType: row.relationship_type, sourceId: row.source_canonical_object_id, sourceKind: row.source_kind,
      targetId: row.target_canonical_object_id, targetKind: row.target_kind,
      ...(row.source_kind === 'AGENT_VERSION' ? { versionId: row.source_canonical_object_id } : {}),
      provenance: { storage: 'canonical_relationships', authority: 'GOVERNED_RELATIONSHIP', validFrom: row.valid_from, validTo: row.valid_to ?? undefined,
        recordedAt: row.recorded_at, revision: row.revision, ...await decisionSupport(row.created_by_decision_id) } };
  }
  const relationships: RelationshipFact[] = [];
  const edgeRows = selected ? await read('canonical_relationships', { source_canonical_object_id: selected, source_kind: 'AGENT_VERSION' }) : [];
  edgeRows.push(...await read('canonical_relationships', { target_canonical_object_id: canonicalObjectId, target_kind: 'AGENT', relationship_type: 'HANDOFF_TO' }));
  for (const row of edgeRows) {
    const edge = await relationship(row);
    if (edge && !relationships.some(r => r.id === edge.id)) relationships.push(edge);
  }
  const access = relationships.filter(r => r.versionId === selected && ['READS_FROM', 'WRITES_TO'].includes(r.relationshipType));
  const dataFields = (await Promise.all(access.map(a => readPassportDataFields(read, a, support)))).flat();
  // One-hop governed column lineage only when the selected version actually accesses that column.
  for (const dataId of [...new Set(access.filter(a => a.targetKind === 'DATA_ELEMENT').map(a => a.targetId))].sort()) {
    const lineage = await read('canonical_relationships', { source_canonical_object_id: dataId, source_kind: 'DATA_ELEMENT', relationship_type: 'DERIVED_FROM' });
    for (const row of lineage) {
      const edge = await relationship(row);
      if (edge && !relationships.some(r => r.id === edge.id)) relationships.push(edge);
    }
  }
  relationships.sort((a, b) => a.id.localeCompare(b.id));
  const model = relationships.filter(r => r.versionId === selected && r.relationshipType === 'USES_MODEL');
  const tools = relationships.filter(r => r.versionId === selected && ['USES_TOOL', 'USES_MCP', 'INVOKES'].includes(r.relationshipType));
  const technology = profileFacts.filter(f => f.field !== 'behaviorFingerprint');
  const versionGap = selected ? [] : ['Selected AgentVersion: UNKNOWN. Select an exactly associated version to inspect version-specific facts.'];
  const allFacts = [...identityFacts, ...discovery, ...profileFacts, ...relationships, ...dataFields];
  const families: AgentPassport360['families'] = [
    // V1 required Identity scope is the exact canonical tenant/kind/ID, not a friendly name.
    family('identity', identityFacts, []),
    family('discovery', discovery, discovery.every(f => f.provenance.sources.length && f.provenance.evidence.length) ? [] : ['Discovery support: UNKNOWN for some mappings.']),
    family('ownership', [], ['Owner and responsibility: UNKNOWN.']),
    family('business', [], ['Business domain, purpose and description: UNKNOWN.']),
    family('technology', technology, [...versionGap, ...(['buildReference','runtimeFrameworkReference','entrypointReference','configurationReference'] as const)
      .filter(field => !technology.some(f => f.field === field)).map(field => `${field}: UNKNOWN.`)]),
    family('model', model, [...versionGap, 'Inference configuration and model coverage: UNKNOWN.']),
    family('behavior', [...profileFacts.filter(f => f.field === 'behaviorFingerprint'), ...relationships.filter(r => r.versionId === selected)],
      [...versionGap, 'Behavior coverage, orchestration and guardrails: UNKNOWN.']),
    family('tools', tools, [...versionGap, 'Tool / MCP / API coverage: UNKNOWN.']),
    family('data', [...access, ...dataFields], [...versionGap, ...(['READS_FROM','WRITES_TO'] as const)
      .filter(type => !access.some(a => a.relationshipType === type)).map(type => `${type}: UNKNOWN. Absence does not establish no access.`), 'Data field coverage: UNKNOWN beyond displayed governed state.']),
    family('privacy', [], ['Privacy and sensitive-data classification: UNKNOWN.']),
    family('relationships', relationships, ['Relationship coverage: UNKNOWN. Column lineage does not establish Agent access.']),
    family('controls', [canonicalAgent], ['Canonical identity decision is available; control compliance and coverage: UNKNOWN.']),
    family('runtime', [], ['Executions and runtime observations: UNKNOWN.']),
    family('provenance', allFacts, allFacts.every(f => f.provenance.sources.length && f.provenance.evidence.length) ? [] : ['Source trust / evidence: UNKNOWN where no support is available.']),
    family('authorization', [], ['Permissions and authorization: UNKNOWN. Tool capability does not establish authorization.']),
    family('connectivity', [], ['Connectivity and network state: UNKNOWN.']),
  ];
  return { canonicalAgent, displayName: null, versionContexts, selectedVersionId: selected, currentVersionId: null,
    families, provenanceSummary: allFacts.map(f => f.provenance) };
}
