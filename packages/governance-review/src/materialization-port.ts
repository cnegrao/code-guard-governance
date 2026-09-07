import type {
  CanonicalObjectKind,
  GovernedRelationshipType,
  ObjectSourceMatchMethod,
  OrganisationId,
} from "@council/canonical-contracts";

/**
 * Canonical Materialization V1.
 *
 * Narrow persistence boundary (Port/Repository pattern), the same shape as
 * GovernanceReviewPersistencePort: this package never implements durable
 * storage itself, never talks to Supabase/Postgres, and never invents a
 * generic privileged db.read/db.write escape hatch. A trusted server-only
 * adapter (see apps/dashboard) implements this interface.
 *
 * Materialization only ever accepts identity already proven by an
 * already-persisted, valid canonical reconciliation decision (reached
 * through GovernanceReviewPersistencePort.getReconciliationAuditChain). This
 * Port never accepts a discovery candidate, a bare ReviewSubject, or an
 * authorization result as its own authority.
 */

export type MaterializationOutcome = "CREATE_NEW" | "MATCH_EXISTING";
export type MaterializationStatus = "PENDING" | "APPLIED" | "FAILED";

export interface ObjectMaterializationInput {
  readonly organisationId: OrganisationId;
  readonly reconciliationDecisionId: string;
  readonly invocationId: string;
  readonly outcome: MaterializationOutcome;
  readonly canonicalObjectId: string;
  readonly canonicalObjectKind: CanonicalObjectKind;
  readonly sourceConnectionId: string;
  readonly sourceExternalType: string;
  readonly sourceExternalId: string;
  readonly matchMethod: ObjectSourceMatchMethod;
  /** sha256 hex digest over every semantically relevant field above; a replay with a changed fingerprint fails closed. */
  readonly idempotencyFingerprint: string;
  readonly occurredAt: string;
}

export interface ObjectMaterializationResult {
  readonly replay: boolean;
  readonly status: MaterializationStatus;
  readonly canonicalObjectId: string;
  readonly mappingId: string;
}

export interface RelationshipMaterializationInput {
  readonly organisationId: OrganisationId;
  readonly reconciliationDecisionId: string;
  readonly invocationId: string;
  readonly outcome: MaterializationOutcome;
  readonly relationshipId: string;
  readonly relationshipStateId: string;
  readonly relationshipType: GovernedRelationshipType;
  readonly sourceCanonicalObjectId: string;
  readonly sourceKind: CanonicalObjectKind;
  readonly targetCanonicalObjectId: string;
  readonly targetKind: CanonicalObjectKind;
  readonly validFrom: string;
  readonly recordedAt: string;
  /** sha256 hex digest over every semantically relevant field above; a replay with a changed fingerprint fails closed. */
  readonly idempotencyFingerprint: string;
}

export interface RelationshipMaterializationResult {
  readonly replay: boolean;
  readonly status: MaterializationStatus;
  readonly relationshipId: string;
}

export interface ObjectSourceMappingLookupInput {
  readonly organisationId: OrganisationId;
  readonly sourceConnectionId: string;
  readonly sourceExternalType: string;
  readonly sourceExternalId: string;
}

export interface ActiveObjectSourceMapping {
  readonly mappingId: string;
  readonly canonicalObjectId: string;
  readonly canonicalObjectKind: CanonicalObjectKind;
}

export interface MaterializationPersistencePort {
  /**
   * Materializes a governed canonical object (CREATE_NEW) or binds a new
   * source to an existing one (MATCH_EXISTING), plus its ObjectSourceMapping
   * and outbox event, atomically. Idempotent on reconciliationDecisionId.
   */
  materializeObjectReconciliation(
    input: ObjectMaterializationInput,
  ): Promise<ObjectMaterializationResult>;

  /**
   * Materializes a governed relationship edge (CREATE_NEW) or acknowledges a
   * bind to an existing one (MATCH_EXISTING), plus its outbox event,
   * atomically. Idempotent on reconciliationDecisionId.
   */
  materializeRelationshipReconciliation(
    input: RelationshipMaterializationInput,
  ): Promise<RelationshipMaterializationResult>;

  /**
   * Read-only lookup of the currently active (never superseded) source
   * mapping for one tenant-scoped SourceObjectIdentity, if any. Discovery
   * Intake uses this to recognize "this discovered thing is already a
   * governed canonical object" (ALREADY_GOVERNED) and avoid proposing a
   * duplicate object ReviewSubject for it. Always scoped by organisationId:
   * a mapping recorded for a different tenant is never returned, and never
   * suppresses this tenant's own finding. This lookup is read-only — it
   * never creates, mutates, or supersedes a mapping.
   */
  findActiveObjectSourceMapping(
    input: ObjectSourceMappingLookupInput,
  ): Promise<ActiveObjectSourceMapping | undefined>;
}
