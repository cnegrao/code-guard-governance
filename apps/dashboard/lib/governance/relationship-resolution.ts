import "server-only";
import { asCanonicalObjectId, asRelationshipId, asRelationshipStateId, type CanonicalObjectKind, type GovernedRelationshipType, type IsoTimestamp, type NormalizedObjectCandidate, type NormalizedRelationshipCandidate, type OrganisationId, type PreCanonicalObjectReference } from "@council/canonical-contracts";
import { canonicalRelationshipId, normalizedObjectIdentity, EndpointResolutionError, requireExactCanonicalMapping, type CanonicalEndpointResolutionPort, type RelationshipReconciliationRequestedDecision } from "@council/governance-review";
import { privilegedDb } from "./persistence";
import { normalizedCandidateEnvelopeHash, rehydrateNormalizedCandidate } from "./discovery-intake-persistence";

async function endpointMapping(org: OrganisationId, reference: PreCanonicalObjectReference) {
  const { data, error } = await privilegedDb.rpc("resolve_canonical_endpoint", { p_organisation_id: org, p_reference: reference });
  if (error) {
    if (error.message.includes("ENDPOINT_MAPPING_AMBIGUOUS")) throw new EndpointResolutionError("ENDPOINT_MAPPING_AMBIGUOUS");
    if (error.message.includes("ENDPOINT_IDENTITY_MISSING")) throw new EndpointResolutionError("ENDPOINT_IDENTITY_MISSING");
    if (error.message.includes("ENDPOINT_NOT_CANONICAL")) throw new EndpointResolutionError("ENDPOINT_NOT_CANONICAL");
    throw new Error(`Canonical endpoint lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as { canonical_object_id: string; canonical_object_kind: CanonicalObjectKind; mapping_id: string }[];
  const canonicalObject = requireExactCanonicalMapping(org, reference.candidateKind, rows.map(row => ({
    organisationId: org, objectId: asCanonicalObjectId(row.canonical_object_id), kind: row.canonical_object_kind,
  })));
  return { canonicalObject, mappingId: rows[0].mapping_id };
}

export const canonicalEndpointResolution: CanonicalEndpointResolutionPort = {
  async resolveEndpoint(org, reference) { return (await endpointMapping(org, reference)).canonicalObject; },
  async getRelationshipCandidate(org, candidateId) {
    const { data, error } = await privilegedDb.from("discovery_candidates").select("envelope,envelope_hash")
      .eq("organisation_id", org).eq("candidate_id", candidateId).eq("candidate_kind", "RELATIONSHIP").maybeSingle();
    if (error) throw new Error(`Relationship candidate lookup failed: ${error.message}`);
    if (!data) return undefined;
    const candidate = rehydrateNormalizedCandidate(data.envelope);
    if (candidate.candidateKind !== "RELATIONSHIP" || candidate.candidateId !== candidateId ||
        normalizedCandidateEnvelopeHash(candidate) !== data.envelope_hash) {
      throw new EndpointResolutionError("ENDPOINT_CONTEXT_MISMATCH");
    }
    return candidate;
  },
};

export interface RelationshipMatchCandidate { relationshipId: string; relationshipType: string; sourceId: string; targetId: string; }

export async function resolveRelationshipBinding(org: OrganisationId, candidate: NormalizedRelationshipCandidate) {
  const source = await endpointMapping(org, candidate.sourceEndpoint);
  const target = await endpointMapping(org, candidate.targetEndpoint);
  return { source, target };
}

export async function listExactRelationshipMatches(org: OrganisationId, candidate: NormalizedRelationshipCandidate): Promise<RelationshipMatchCandidate[]> {
  const { source, target } = await resolveRelationshipBinding(org, candidate);
  const { data, error } = await privilegedDb.from("canonical_relationships")
    .select("relationship_id,relationship_type,source_canonical_object_id,target_canonical_object_id")
    .eq("organisation_id", org).eq("relationship_type", candidate.relationshipTypeCode)
    .eq("source_canonical_object_id", source.canonicalObject.objectId).eq("source_kind", source.canonicalObject.kind)
    .eq("target_canonical_object_id", target.canonicalObject.objectId).eq("target_kind", target.canonicalObject.kind)
    .is("valid_to", null).limit(2);
  if (error) throw new Error(`Relationship lookup failed: ${error.message}`);
  if ((data ?? []).length > 1) throw new EndpointResolutionError("ENDPOINT_MAPPING_AMBIGUOUS");
  return (data ?? []).map(row => ({ relationshipId: row.relationship_id, relationshipType: row.relationship_type,
    sourceId: row.source_canonical_object_id, targetId: row.target_canonical_object_id }));
}

export async function relationshipRequestedDecision(org: OrganisationId, candidate: NormalizedRelationshipCandidate,
  outcome: "CREATE_NEW" | "MATCH_EXISTING", at: IsoTimestamp, matchId?: string): Promise<RelationshipReconciliationRequestedDecision> {
  const { source, target } = await resolveRelationshipBinding(org, candidate);
  const relationshipType = candidate.relationshipTypeCode as GovernedRelationshipType;
  const support = { assertionIds: candidate.assertionIds, evidenceIds: candidate.evidenceIds };
  if (outcome === "MATCH_EXISTING") {
    if (!matchId) throw new EndpointResolutionError("ENDPOINT_NOT_CANONICAL");
    const matches = await listExactRelationshipMatches(org, candidate);
    if (matches.length !== 1 || matches[0].relationshipId !== matchId) throw new EndpointResolutionError("ENDPOINT_CONTEXT_MISMATCH");
    const { data, error } = await privilegedDb.from("canonical_relationships").select("relationship_state_id")
      .eq("organisation_id", org).eq("relationship_id", matchId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new EndpointResolutionError("ENDPOINT_NOT_CANONICAL");
    return { outcome, matchedState: { organisationId: org, relationshipId: asRelationshipId(matchId),
      relationshipStateId: asRelationshipStateId(data.relationship_state_id), relationshipType,
      source: { canonicalObject: source.canonicalObject }, target: { canonicalObject: target.canonicalObject } } as never };
  }
  const id = canonicalRelationshipId(org, relationshipType, source.canonicalObject.objectId, target.canonicalObject.objectId);
  const base = { organisationId: org, relationshipId: asRelationshipId(id), relationshipStateId: asRelationshipStateId(`${id}:initial`),
    relationshipType, source: { canonicalObject: source.canonicalObject }, target: { canonicalObject: target.canonicalObject },
    validFrom: at, recordedAt: at, support };
  const behavior = ["USES_MODEL", "USES_TOOL", "USES_MCP", "INVOKES", "USES_PROMPT", "USES_KNOWLEDGE_BASE", "USES_SKILL"].includes(relationshipType);
  if (!behavior) return { outcome, authorizedState: base as never };
  // Fingerprint is supported metadata approved by this relationship decision, never endpoint identity/authority.
  const { data: mapping, error: mappingError } = await privilegedDb.from("canonical_normalized_object_mappings")
    .select("candidate_id").eq("organisation_id", org).eq("mapping_id", source.mappingId).maybeSingle();
  if (mappingError) throw new Error(mappingError.message);
  if (!mapping) throw new EndpointResolutionError("ENDPOINT_NOT_CANONICAL");
  const { data: profiles, error } = await privilegedDb.from("agent_version_technical_profile_proposals")
    .select("behavior_fingerprint_algorithm,behavior_fingerprint_schema_version,behavior_fingerprint_value")
    .eq("organisation_id", org).eq("agent_version_candidate_id", mapping.candidate_id);
  if (error) throw new Error(error.message);
  const fingerprints = new Map((profiles ?? []).map(p => [JSON.stringify([p.behavior_fingerprint_algorithm,p.behavior_fingerprint_schema_version,p.behavior_fingerprint_value]), p]));
  if (fingerprints.size !== 1) throw new EndpointResolutionError(fingerprints.size ? "ENDPOINT_MAPPING_AMBIGUOUS" : "ENDPOINT_IDENTITY_MISSING");
  const profile = [...fingerprints.values()][0];
  const empty = { assertionIds: [], evidenceIds: [] };
  return { outcome, authorizedState: { ...base, boundTechnicalFingerprint: { algorithm: profile.behavior_fingerprint_algorithm,
    schemaVersion: profile.behavior_fingerprint_schema_version, value: profile.behavior_fingerprint_value },
    support: { relationship: support, boundTechnicalFingerprint: support, bindingConfiguration: { configurationHash: empty, configurationLocator: empty } } } as never };
}

/** DATA_ELEMENT identity uses its exact durable parent's existing normalized source reference. */
export async function objectMappingIdentity(org: OrganisationId, candidate: NormalizedObjectCandidate): Promise<string> {
  if (candidate.candidateKind !== "DATA_ELEMENT") return normalizedObjectIdentity(candidate);
  const { data, error } = await privilegedDb.rpc("normalized_object_identity", { p_organisation_id: org, p_candidate: candidate });
  if (error || typeof data !== "string" || !data) throw new EndpointResolutionError("ENDPOINT_IDENTITY_MISSING");
  return data;
}
