import { DATA_ASSET_STRUCTURAL_KIND, type DataAssetStructuralKind, type SourceSystem, type SourceConnectionReference, type SourceObjectIdentity, type TechnicalMetadataSupport, type SourceAttributeLocator, type ReconciliationAuthority, type CanonicalObjectIdentity } from './contracts.ts';
import type { OrganisationId, IsoTimestamp } from './identifiers.ts';

/** Closed projection of existing technical profiles; never an arbitrary path/value bag. */
export type TechnicalFact =
  | { readonly objectKind: 'DATA_ASSET'; readonly field: 'structuralKind'; readonly value: DataAssetStructuralKind }
  | { readonly objectKind: 'DATA_ASSET'; readonly field: 'technicalName' | 'technicalDescription' | 'qualifiedTechnicalLocator'; readonly value: string }
  | { readonly objectKind: 'DATA_ELEMENT'; readonly field: 'technicalName' | 'dataType.nativeType'; readonly value: string };
export type TechnicalField = TechnicalFact['field'];
export type DataObjectKind = TechnicalFact['objectKind'];
export type FieldAuthorityDisposition = 'AUTHORITATIVE' | 'CONTRIBUTING' | 'NON_AUTHORITATIVE';
export type FieldDecisionOutcome = 'ACCEPT_PROPOSED' | 'KEEP_CURRENT' | 'DEFER' | 'REJECT_PROPOSED';

/** Transport has no tenant, policy, canonical identity, decision or trust override. */
export interface TechnicalFactTransport {
  readonly candidateId: string;
  readonly fact: TechnicalFact;
  readonly support: TechnicalMetadataSupport;
  readonly sourceAttribute: SourceAttributeLocator;
}
export interface TechnicalFactProposal extends TechnicalFactTransport {
  readonly proposalId: string;
  readonly organisationId: OrganisationId;
  readonly sourceSystem: SourceSystem;
  readonly sourceObject: SourceObjectIdentity;
  readonly normalizedObjectIdentity: string;
  readonly trustState: 'IMPORTED' | 'DECLARED';
}
export interface TechnicalFactObservation {
  readonly observationId: string;
  readonly organisationId: OrganisationId;
  readonly proposalId: string;
  readonly candidateId: string;
  readonly support: TechnicalMetadataSupport;
  readonly observedAt: IsoTimestamp;
  /** Hydrated from durable SourceAssertion support by persistence, never guessed. */
  readonly snapshotId?: string;
}
/** Only trusted governance may configure this policy, never an adapter. */
export interface FieldAuthorityPolicy {
  readonly policyId: string;
  readonly version: string;
  readonly organisationId: OrganisationId;
  readonly objectKind: DataObjectKind;
  readonly field: TechnicalField;
  readonly sourceSystemId: string;
  readonly providerCode: string;
  readonly connectionId?: string;
  readonly disposition: FieldAuthorityDisposition;
  readonly deterministicRule?: { readonly code: string; readonly version: string };
}
/** Explicit trusted configuration; version strings have no implicit ordering. */
export interface FieldAuthorityPolicyHead {
  readonly organisationId: OrganisationId;
  readonly policyId: string;
  readonly version: string;
}
export interface GovernedTechnicalFieldState {
  readonly stateId: string;
  readonly organisationId: OrganisationId;
  readonly canonicalObject: CanonicalObjectIdentity<DataObjectKind>;
  readonly fact: TechnicalFact;
  readonly proposalId: string;
  readonly decisionId: string;
  readonly previousStateId?: string;
  readonly recordedAt: IsoTimestamp;
}
export interface FieldReconciliationDecision {
  readonly decisionId: string;
  readonly organisationId: OrganisationId;
  readonly canonicalObject: CanonicalObjectIdentity<DataObjectKind>;
  readonly field: TechnicalField;
  readonly proposalId: string;
  readonly observationIds: readonly string[];
  readonly expectedSourceObservationId: string;
  readonly expectedSourceSnapshotId: string;
  readonly expectedCurrentStateId?: string;
  readonly policyId?: string;
  readonly policyVersion?: string;
  readonly outcome: FieldDecisionOutcome;
  readonly actor: ReconciliationAuthority;
  readonly decidedAt: IsoTimestamp;
}
export interface TrustedInboundConnection {
  readonly organisationId: OrganisationId;
  readonly sourceSystem: SourceSystem;
  readonly connection: SourceConnectionReference;
}

export function isTechnicalField(kind: string, field: string): boolean {
  return kind === 'DATA_ASSET'
    ? ['structuralKind', 'technicalName', 'qualifiedTechnicalLocator', 'technicalDescription'].includes(field)
    : kind === 'DATA_ELEMENT' && ['technicalName', 'dataType.nativeType'].includes(field);
}
export function validateTechnicalFact(fact: TechnicalFact): void {
  if (!fact || Object.keys(fact).some(k => !['objectKind', 'field', 'value'].includes(k)) ||
      !isTechnicalField(fact.objectKind, fact.field) || typeof fact.value !== 'string' ||
      !fact.value.trim() || fact.value.length > 2048 || /[\u0000-\u001f]/u.test(fact.value)) {
    throw new TypeError('INVALID_TECHNICAL_FACT');
  }
  if (fact.field === 'structuralKind' && !Object.values(DATA_ASSET_STRUCTURAL_KIND).includes(fact.value)) {
    throw new TypeError('INVALID_STRUCTURAL_KIND');
  }
}
