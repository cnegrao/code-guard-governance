import "server-only";

import type {
  AcquisitionRun,
  Evidence,
  EvidenceId,
  OrganisationId,
  SourceAssertion,
  SourceAssertionId,
} from "@council/canonical-contracts";
import type {
  AcquisitionRunCounts,
  AcquisitionRunPersistenceResult,
  DiscoveryIntakePersistencePort,
  EvidencePersistenceResult,
  SourceAssertionPersistenceResult,
} from "@council/governance-review";

import { canonicalStringify, privilegedDb, sha256Hex } from "./persistence";

/**
 * Discovery Intake V1 — server-only Supabase adapter.
 *
 * Mirrors governanceReviewPersistence / materializationPersistence exactly:
 * this file is the sole caller of the privileged gov_repo.start_acquisition_run
 * / gov_repo.complete_acquisition_run / gov_repo.record_discovery_evidence /
 * gov_repo.record_discovery_source_assertion RPCs, all SECURITY INVOKER and
 * service_role-only, and reuses the same privileged client so no second
 * service-role connection pool is opened.
 *
 * Deterministic canonical-envelope hashing reuses persistence.ts's own
 * canonicalStringify/sha256Hex (the sole authors/re-verifiers of every
 * envelope_hash in this schema) rather than duplicating that logic.
 */

const CONTRACT_VERSION = "1.0";

function evidenceEnvelopeHash(evidence: Evidence): string {
  return sha256Hex(canonicalStringify(evidence));
}

function sourceAssertionEnvelopeHash(assertion: SourceAssertion): string {
  return sha256Hex(canonicalStringify(assertion));
}

interface AcquisitionRunRow {
  replay: boolean;
  run_id: string;
  status: AcquisitionRun["status"];
}

interface EvidenceRow {
  replay: boolean;
  evidence_id: string;
}

interface SourceAssertionRow {
  replay: boolean;
  assertion_id: string;
}

export const discoveryIntakePersistence: DiscoveryIntakePersistencePort = {
  async startAcquisitionRun(
    organisationId: OrganisationId,
    run: AcquisitionRun,
  ): Promise<AcquisitionRunPersistenceResult> {
    const { data, error } = await privilegedDb.rpc("start_acquisition_run", {
      p_run_id: run.runId,
      p_organisation_id: organisationId,
      p_source_connection_id: run.connection.connectionId,
      p_source_system_id: run.connection.sourceSystemId,
      p_adapter_name: run.adapterName,
      p_adapter_version: run.adapterVersion,
      p_mode: run.mode,
      p_source_version: run.sourceVersion ?? null,
      p_checkpoint: run.checkpoint ?? null,
      p_started_at: run.startedAt,
    });
    if (error) throw new Error(`start_acquisition_run failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as AcquisitionRunRow;
    return { replay: row.replay, runId: row.run_id as AcquisitionRun["runId"], status: row.status };
  },

  async completeAcquisitionRun(
    organisationId: OrganisationId,
    run: AcquisitionRun,
    counts: AcquisitionRunCounts,
  ): Promise<AcquisitionRunPersistenceResult> {
    if (run.status === "PENDING" || run.status === "RUNNING") {
      throw new TypeError(`completeAcquisitionRun requires a terminal status, received ${run.status}`);
    }
    if (!run.completedAt) {
      throw new TypeError("completeAcquisitionRun requires run.completedAt");
    }

    const { data, error } = await privilegedDb.rpc("complete_acquisition_run", {
      p_run_id: run.runId,
      p_organisation_id: organisationId,
      p_status: run.status,
      p_completed_at: run.completedAt,
      p_artifacts_scanned: counts.artifactsScanned,
      p_findings_detected: counts.findingsDetected,
      p_object_candidates: counts.objectCandidates,
      p_relationship_candidates: counts.relationshipCandidates,
      p_review_subjects_created: counts.reviewSubjectsCreated,
      p_proposals_created: counts.proposalsCreated,
      p_already_governed: counts.alreadyGoverned,
      p_item_failures: counts.itemFailures,
    });
    if (error) throw new Error(`complete_acquisition_run failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as AcquisitionRunRow;
    return { replay: row.replay, runId: row.run_id as AcquisitionRun["runId"], status: row.status };
  },

  async recordEvidence(
    organisationId: OrganisationId,
    evidence: Evidence,
  ): Promise<EvidencePersistenceResult> {
    const envelopeHash = evidenceEnvelopeHash(evidence);
    const primaryContentHash = evidence.hashes[0]?.value ?? envelopeHash;

    const { data, error } = await privilegedDb.rpc("record_discovery_evidence", {
      p_evidence_id: evidence.evidenceId,
      p_organisation_id: organisationId,
      p_handling: evidence.handling,
      p_captured_at: evidence.capturedAt,
      p_content_hash: primaryContentHash,
      p_contract_version: CONTRACT_VERSION,
      p_envelope: evidence,
      p_envelope_hash: envelopeHash,
    });
    if (error) throw new Error(`record_discovery_evidence failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as EvidenceRow;
    return { replay: row.replay, evidenceId: row.evidence_id as EvidenceId };
  },

  async recordSourceAssertion(
    organisationId: OrganisationId,
    assertion: SourceAssertion,
  ): Promise<SourceAssertionPersistenceResult> {
    const envelopeHash = sourceAssertionEnvelopeHash(assertion);
    const snapshot = assertion.snapshot;

    const { data, error } = await privilegedDb.rpc("record_discovery_source_assertion", {
      p_assertion_id: assertion.assertionId,
      p_organisation_id: organisationId,
      p_run_id: assertion.runId,
      p_source_connection_id: assertion.sourceObject.connectionId,
      p_source_external_type: assertion.sourceObject.externalType,
      p_source_external_id: assertion.sourceObject.externalId,
      p_snapshot_id: snapshot?.snapshotId ?? null,
      p_snapshot_content_hash: snapshot?.contentHash.value ?? null,
      p_snapshot_observed_at: snapshot?.observedAt ?? null,
      p_snapshot_source_version: snapshot?.sourceVersion ?? null,
      p_method_code: assertion.method.code,
      p_method_version: assertion.method.version ?? null,
      p_trust_state: assertion.trustState,
      p_confidence: assertion.confidence ?? null,
      p_observed_at: assertion.observedAt,
      p_synced_at: assertion.syncedAt ?? null,
      p_recorded_at: assertion.recordedAt,
      p_evidence_ids: [...assertion.evidenceIds],
      p_contract_version: CONTRACT_VERSION,
      p_envelope: assertion,
      p_envelope_hash: envelopeHash,
    });
    if (error) throw new Error(`record_discovery_source_assertion failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as SourceAssertionRow;
    return { replay: row.replay, assertionId: row.assertion_id as SourceAssertionId };
  },
};

// Exported for direct unit testing of otherwise-pure, security-critical
// hashing logic without needing to mock the Supabase client — actual
// RPC/query behavior is proven separately by the controlled Supabase runtime
// gate (see docs/codex/evidence/), matching this repo's existing test-layering
// convention (see lib/governance/persistence.ts's own exports).
export { evidenceEnvelopeHash, sourceAssertionEnvelopeHash };
