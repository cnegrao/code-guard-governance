import type { CanonicalObjectKind, GovernedRelationshipType, TechnicalFact, TrustState } from '@council/canonical-contracts';

/** Presentation coverage only. These values are not canonical TrustState. */
export type PassportCoverage = 'KNOWN' | 'PARTIAL' | 'UNKNOWN';
export const PASSPORT_FAMILIES = [
  ['identity', 'Identity'], ['discovery', 'Discovery Metadata'],
  ['ownership', 'Ownership & Responsibility'], ['business', 'Business Context'],
  ['technology', 'Technology & Build'], ['model', 'AI Model & Inference'],
  ['behavior', 'Agent Architecture & Behavior'], ['tools', 'Tools / MCP / APIs'],
  ['data', 'Data Assets + Data Elements'], ['privacy', 'Privacy & Sensitive Data'],
  ['relationships', 'Relationships & Lineage'], ['controls', 'Governance Controls'],
  ['runtime', 'Operation & Runtime'], ['provenance', 'Provenance & Trust'],
  ['authorization', 'Capabilities / Permissions / Authorization'], ['connectivity', 'Connectivity & Network'],
] as const;
export type PassportFamilyId = typeof PASSPORT_FAMILIES[number][0];

export interface PassportSource {
  assertionId: string;
  connectionId: string;
  externalType: string;
  externalId: string;
  trust: TrustState;
  method: string;
  observedAt: string;
  recordedAt: string;
  runId: string;
  sourceSystemId?: string;
}
export interface PassportProvenance {
  storage: 'canonical_objects' | 'canonical_normalized_object_mappings' | 'canonical_object_source_mappings'
    | 'agent_version_technical_profiles' | 'canonical_relationships' | 'technical_field_states' | 'execution_field_states';
  authority: 'GOVERNED_IDENTITY' | 'GOVERNED_MAPPING' | 'GOVERNED_PROFILE' | 'GOVERNED_RELATIONSHIP' | 'GOVERNED_FIELD_STATE';
  sources: readonly PassportSource[];
  evidence: readonly { evidenceId: string; handling: string; capturedAt: string }[];
  decisionId?: string;
  reviewSubjectId?: string;
  decidedAt?: string;
  recordedAt?: string;
  validFrom?: string;
  validTo?: string;
  revision?: number;
  profileOriginProposalId?: string;
  policy?: { policyId: string; acceptedVersion: string; activeVersion?: string };
  snapshotId?: string;
  observedAt?: string;
}
interface FactBase { id: string; provenance: PassportProvenance }
export interface IdentityFact extends FactBase {
  type: 'identity'; objectId: string; objectKind: CanonicalObjectKind; organisationId: string;
}
export interface MappingFact extends FactBase {
  type: 'mapping'; objectId: string; connectionId: string; externalType: string; externalId: string;
}
export type ProfileField = 'behaviorFingerprint' | 'buildReference' | 'runtimeFrameworkReference' | 'entrypointReference' | 'configurationReference';
export interface ProfileFact extends FactBase {
  type: 'profile'; versionId: string; field: ProfileField; value: string;
}
export interface RelationshipFact extends FactBase {
  type: 'relationship'; relationshipType: GovernedRelationshipType;
  sourceId: string; sourceKind: CanonicalObjectKind; targetId: string; targetKind: CanonicalObjectKind;
  stateId: string; versionId?: string;
}
export interface DataFieldFact extends FactBase {
  type: 'data-field'; objectId: string; versionId: string; accessRelationshipId: string;
  fact: TechnicalFact; stateId: string;
  source: { systemId: string; connectionId: string; externalId: string; externalType: string; trust: 'DECLARED' | 'IMPORTED' };
  /** Competing proposals are context only; their values never replace this accepted state. */
  competingProposalIds: readonly string[];
}
export interface ExecutionPassportFact extends FactBase {
  type: 'execution'; versionId: string; fact: import('@council/canonical-contracts').DirectExecutionFact;
  sourceSnapshotId: string; authorizationState: 'UNKNOWN';
}
export type PassportFact = IdentityFact | MappingFact | ProfileFact | RelationshipFact | DataFieldFact | ExecutionPassportFact;
interface FamilyItems {
  identity: IdentityFact; discovery: MappingFact; ownership: never; business: never;
  technology: ProfileFact; model: RelationshipFact; behavior: ProfileFact | RelationshipFact;
  tools: RelationshipFact; data: RelationshipFact | DataFieldFact; privacy: never;
  relationships: RelationshipFact; controls: IdentityFact; runtime: never;
  provenance: PassportFact; authorization: ExecutionPassportFact; connectivity: ExecutionPassportFact;
}
export type PassportFamily = { [K in PassportFamilyId]: {
  id: K; label: string; status: PassportCoverage; facts: readonly FamilyItems[K][]; unknowns: readonly string[];
} }[PassportFamilyId];
export interface PassportVersionContext {
  objectId: string;
  /** No governed display/versionCode projection exists in this V1. */
  versionCode: null;
  associationMappingIds: readonly string[];
}
export interface AgentPassport360 {
  canonicalAgent: IdentityFact;
  displayName: null;
  versionContexts: readonly PassportVersionContext[];
  selectedVersionId: string | null;
  currentVersionId: null;
  families: readonly PassportFamily[];
  provenanceSummary: readonly PassportProvenance[];
}

export function family<K extends PassportFamilyId>(id: K, facts: readonly FamilyItems[K][], unknowns: readonly string[]):
  Extract<PassportFamily, { id: K }> {
  return { id, label: PASSPORT_FAMILIES.find(f => f[0] === id)![1], facts, unknowns,
    status: facts.length === 0 ? 'UNKNOWN' : unknowns.length ? 'PARTIAL' : 'KNOWN' } as Extract<PassportFamily, { id: K }>;
}

/** Exact linear predecessor chain, never max(timestamp). Reject forks, cycles and disconnected history. */
export function currentFieldState<T extends { state_id: string; previous_state_id: string | null }>(history: readonly T[]): T | undefined {
  if (!history.length) return undefined;
  const roots = history.filter(s => !s.previous_state_id);
  if (roots.length !== 1 || new Set(history.map(s => s.state_id)).size !== history.length) throw new Error('PASSPORT_FIELD_HISTORY_AMBIGUOUS');
  const seen = new Set<string>();
  let head = roots[0];
  while (!seen.has(head.state_id)) {
    seen.add(head.state_id);
    const next = history.filter(s => s.previous_state_id === head.state_id);
    if (next.length > 1) throw new Error('PASSPORT_FIELD_HISTORY_AMBIGUOUS');
    if (!next.length) {
      if (seen.size !== history.length) throw new Error('PASSPORT_FIELD_HISTORY_AMBIGUOUS');
      return head;
    }
    head = next[0];
  }
  throw new Error('PASSPORT_FIELD_HISTORY_AMBIGUOUS');
}
