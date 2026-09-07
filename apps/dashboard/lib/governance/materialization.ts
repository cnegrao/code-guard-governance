import "server-only";

import type {
  MaterializationPersistencePort,
  ObjectMaterializationInput,
  ObjectMaterializationResult,
  RelationshipMaterializationInput,
  RelationshipMaterializationResult,
} from "@council/governance-review";

import { privilegedDb } from "./persistence";

/**
 * Canonical Materialization V1 — server-only Supabase adapter.
 *
 * Mirrors governanceReviewPersistence (persistence.ts) exactly: this file is
 * the sole caller of the privileged gov_repo.materialize_object_reconciliation
 * / gov_repo.materialize_relationship_reconciliation RPCs, both SECURITY
 * INVOKER and service_role-only, and reuses the same privileged client so no
 * second service-role connection pool is opened.
 */

interface ObjectMaterializationRow {
  replay: boolean;
  status: "PENDING" | "APPLIED" | "FAILED";
  canonical_object_id: string;
  mapping_id: string;
}

interface RelationshipMaterializationRow {
  replay: boolean;
  status: "PENDING" | "APPLIED" | "FAILED";
  relationship_id: string;
}

export const materializationPersistence: MaterializationPersistencePort = {
  async materializeObjectReconciliation(
    input: ObjectMaterializationInput,
  ): Promise<ObjectMaterializationResult> {
    const { data, error } = await privilegedDb.rpc("materialize_object_reconciliation", {
      p_organisation_id: input.organisationId,
      p_reconciliation_decision_id: input.reconciliationDecisionId,
      p_invocation_id: input.invocationId,
      p_outcome: input.outcome,
      p_canonical_object_id: input.canonicalObjectId,
      p_canonical_object_kind: input.canonicalObjectKind,
      p_source_connection_id: input.sourceConnectionId,
      p_source_external_type: input.sourceExternalType,
      p_source_external_id: input.sourceExternalId,
      p_match_method: input.matchMethod,
      p_idempotency_fingerprint: input.idempotencyFingerprint,
      p_occurred_at: input.occurredAt,
    });
    if (error) throw new Error(`materialize_object_reconciliation failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as ObjectMaterializationRow;

    return {
      replay: row.replay,
      status: row.status,
      canonicalObjectId: row.canonical_object_id,
      mappingId: row.mapping_id,
    };
  },

  async materializeRelationshipReconciliation(
    input: RelationshipMaterializationInput,
  ): Promise<RelationshipMaterializationResult> {
    const { data, error } = await privilegedDb.rpc("materialize_relationship_reconciliation", {
      p_organisation_id: input.organisationId,
      p_reconciliation_decision_id: input.reconciliationDecisionId,
      p_invocation_id: input.invocationId,
      p_outcome: input.outcome,
      p_relationship_id: input.relationshipId,
      p_relationship_state_id: input.relationshipStateId,
      p_relationship_type: input.relationshipType,
      p_source_canonical_object_id: input.sourceCanonicalObjectId,
      p_source_kind: input.sourceKind,
      p_target_canonical_object_id: input.targetCanonicalObjectId,
      p_target_kind: input.targetKind,
      p_valid_from: input.validFrom,
      p_recorded_at: input.recordedAt,
      p_idempotency_fingerprint: input.idempotencyFingerprint,
    });
    if (error) throw new Error(`materialize_relationship_reconciliation failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as RelationshipMaterializationRow;

    return {
      replay: row.replay,
      status: row.status,
      relationshipId: row.relationship_id,
    };
  },
};
