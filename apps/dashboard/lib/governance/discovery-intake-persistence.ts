import "server-only";

import {
  FINDING_REVIEW_STATUS,
  asDiscoveryFindingId,
  asEvidenceId,
  asExternalId,
  asIsoTimestamp,
  asNormalizedCandidateId,
  asSourceAssertionId,
  asSourceConnectionId,
  type AcquisitionRun,
  type CanonicalObjectKind,
  type DiscoveryCandidateKind,
  type DiscoveryFinding,
  type DiscoveryFindingId,
  type Evidence,
  type EvidenceId,
  type NormalizedCandidate,
  type NormalizedObjectCandidate,
  type NormalizedRelationshipCandidate,
  type OrganisationId,
  type PreCanonicalObjectReference,
  type SourceAssertion,
  type SourceAssertionId,
  type SourceObjectIdentity,
} from "@council/canonical-contracts";
import type {
  AcquisitionRunCounts,
  AcquisitionRunPersistenceResult,
  DiscoveryFindingPersistenceResult,
  DiscoveryIntakePersistencePort,
  EvidencePersistenceResult,
  NormalizedCandidatePersistenceResult,
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

function discoveryFindingEnvelopeHash(finding: DiscoveryFinding<DiscoveryCandidateKind>): string {
  return sha256Hex(canonicalStringify(finding));
}

function normalizedCandidateEnvelopeHash(candidate: NormalizedCandidate): string {
  return sha256Hex(canonicalStringify(candidate));
}

// ---------------------------------------------------------------------------
// DiscoveryFinding / NormalizedCandidate rehydration. Neither type has a
// canonical rehydrator in @council/canonical-contracts (unlike the
// reconciliation-decision family) — this fills that gap with the same
// allowlist discipline persistence.ts already established for
// rehydrateMergeCandidatesDecision: reject unknown fields, validate every
// value, never trust stored JSON merely because this application wrote it.
// ---------------------------------------------------------------------------

const DISCOVERY_CANDIDATE_KIND_VALUES = new Set<string>([
  "AGENT",
  "AGENT_VERSION",
  "MODEL",
  "TOOL",
  "MCP_SERVER",
  "API",
  "PROMPT",
  "KNOWLEDGE_BASE",
  "DATA_ASSET",
  "DATA_ELEMENT",
  "SKILL",
  "RELATIONSHIP",
]);

function isDiscoveryCandidateKindValue(value: unknown): value is DiscoveryCandidateKind {
  return typeof value === "string" && DISCOVERY_CANDIDATE_KIND_VALUES.has(value);
}

function requiredNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new TypeError(`${label} must be an array of strings`);
  }
  return value as string[];
}

const SOURCE_OBJECT_ALLOWED_FIELDS = ["connectionId", "externalType", "externalId"] as const;

function sourceObjectFromEnvelope(value: unknown, label: string): SourceObjectIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(SOURCE_OBJECT_ALLOWED_FIELDS as readonly string[]).includes(key)) {
      throw new TypeError(`${label} cannot include field "${key}"`);
    }
  }
  return {
    connectionId: asSourceConnectionId(requiredNonEmptyString(input.connectionId, `${label}.connectionId`)),
    externalType: requiredNonEmptyString(input.externalType, `${label}.externalType`),
    externalId: asExternalId(requiredNonEmptyString(input.externalId, `${label}.externalId`)),
  };
}

const PRE_CANONICAL_OBJECT_REFERENCE_CANDIDATE_FIELDS = ["referenceKind", "candidateId", "candidateKind"] as const;
const PRE_CANONICAL_OBJECT_REFERENCE_SOURCE_OBJECT_FIELDS = ["referenceKind", "sourceObject", "candidateKind"] as const;

function objectCandidateKindFromEnvelope(value: unknown, label: string): CanonicalObjectKind {
  if (!isDiscoveryCandidateKindValue(value) || value === "RELATIONSHIP") {
    throw new TypeError(`${label} must be a CanonicalObjectKind`);
  }
  return value;
}

function preCanonicalObjectReferenceFromEnvelope(value: unknown, label: string): PreCanonicalObjectReference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const input = value as Record<string, unknown>;

  if (input.referenceKind === "CANDIDATE") {
    for (const key of Object.keys(input)) {
      if (!(PRE_CANONICAL_OBJECT_REFERENCE_CANDIDATE_FIELDS as readonly string[]).includes(key)) {
        throw new TypeError(`${label} cannot include field "${key}"`);
      }
    }
    return {
      referenceKind: "CANDIDATE",
      candidateId: asNormalizedCandidateId(requiredNonEmptyString(input.candidateId, `${label}.candidateId`)),
      candidateKind: objectCandidateKindFromEnvelope(input.candidateKind, `${label}.candidateKind`),
    };
  }
  if (input.referenceKind === "SOURCE_OBJECT") {
    for (const key of Object.keys(input)) {
      if (!(PRE_CANONICAL_OBJECT_REFERENCE_SOURCE_OBJECT_FIELDS as readonly string[]).includes(key)) {
        throw new TypeError(`${label} cannot include field "${key}"`);
      }
    }
    return {
      referenceKind: "SOURCE_OBJECT",
      sourceObject: sourceObjectFromEnvelope(input.sourceObject, `${label}.sourceObject`),
      candidateKind: objectCandidateKindFromEnvelope(input.candidateKind, `${label}.candidateKind`),
    };
  }
  throw new TypeError(`${label}.referenceKind must be "CANDIDATE" or "SOURCE_OBJECT"`);
}

const DISCOVERY_FINDING_ALLOWED_FIELDS = [
  "findingId",
  "findingNature",
  "candidateKind",
  "sourceObject",
  "assertionIds",
  "evidenceIds",
  "confidence",
  "reviewStatus",
  "requiresReview",
  "createsCanonicalObject",
  "detectedAt",
] as const;

const FINDING_REVIEW_STATUS_VALUES: readonly string[] = Object.values(FINDING_REVIEW_STATUS);

function rehydrateDiscoveryFinding(value: unknown): DiscoveryFinding<DiscoveryCandidateKind> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("DiscoveryFinding envelope must be an object");
  }
  const input = value as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (!(DISCOVERY_FINDING_ALLOWED_FIELDS as readonly string[]).includes(key)) {
      throw new TypeError(`DiscoveryFinding envelope cannot include field "${key}"`);
    }
  }
  if (input.findingNature !== "CANDIDATE") {
    throw new TypeError('DiscoveryFinding envelope findingNature must be "CANDIDATE"');
  }
  if (!isDiscoveryCandidateKindValue(input.candidateKind)) {
    throw new TypeError("DiscoveryFinding envelope candidateKind must be a known DiscoveryCandidateKind");
  }
  if (typeof input.confidence !== "number" || input.confidence < 0 || input.confidence > 1) {
    throw new TypeError("DiscoveryFinding envelope confidence must be a number between 0 and 1");
  }
  if (typeof input.reviewStatus !== "string" || !FINDING_REVIEW_STATUS_VALUES.includes(input.reviewStatus)) {
    throw new TypeError("DiscoveryFinding envelope reviewStatus must be a known FindingReviewStatus");
  }
  if (input.requiresReview !== true) {
    throw new TypeError("DiscoveryFinding envelope requiresReview must be true");
  }
  if (input.createsCanonicalObject !== false) {
    throw new TypeError("DiscoveryFinding envelope createsCanonicalObject must be false");
  }

  return Object.freeze({
    findingId: asDiscoveryFindingId(requiredNonEmptyString(input.findingId, "findingId")),
    findingNature: "CANDIDATE",
    candidateKind: input.candidateKind,
    sourceObject: sourceObjectFromEnvelope(input.sourceObject, "sourceObject"),
    assertionIds: Object.freeze(requiredStringArray(input.assertionIds, "assertionIds").map(asSourceAssertionId)),
    evidenceIds: Object.freeze(requiredStringArray(input.evidenceIds, "evidenceIds").map(asEvidenceId)),
    confidence: input.confidence,
    reviewStatus: input.reviewStatus,
    requiresReview: true,
    createsCanonicalObject: false,
    detectedAt: asIsoTimestamp(requiredNonEmptyString(input.detectedAt, "detectedAt")),
  }) as DiscoveryFinding<DiscoveryCandidateKind>;
}

const NORMALIZED_CANDIDATE_BASE_FIELDS = [
  "candidateId",
  "candidateKind",
  "sourceObject",
  "findingId",
  "assertionIds",
  "evidenceIds",
  "confidence",
  "requiresReconciliation",
] as const;
const RELATIONSHIP_CANDIDATE_EXTRA_FIELDS = ["relationshipTypeCode", "sourceEndpoint", "targetEndpoint"] as const;
const OBJECT_CANDIDATE_EXTRA_FIELDS = ["proposedIdentity"] as const;

/**
 * proposedIdentity varies per CanonicalObjectKind (11 distinct shapes in
 * canonical-contracts), but every field across every kind is either an
 * optional display/reference string or a nested PreCanonicalObjectReference
 * (AGENT_VERSION's `agent`, DATA_ELEMENT's `parentDataAsset`). Object
 * Candidate Normalization V1 (packages/scanner/src/discovery/
 * object-candidate-normalization.ts) is the real production producer for
 * MODEL and TOOL today (see discovery-intake-port.ts's own doc comment); this
 * validator accepts every kind's allowed field shape so the persistence layer
 * needs no schema/rehydration redesign as further kinds gain a real
 * normalization strategy, and remains exercised for the not-yet-produced
 * kinds only by tests using the same fixture shapes as
 * packages/governance-review/test/fixtures.ts.
 */
const PROPOSED_IDENTITY_OPTIONAL_STRING_FIELDS = [
  "agentCode",
  "displayName",
  "versionCode",
  "modelReference",
  "declarationKey",
  "serverReference",
  "apiReference",
  "sourceReference",
  "declarationReference",
  "elementPath",
] as const;
const PROPOSED_IDENTITY_REFERENCE_FIELDS = ["agent", "parentDataAsset"] as const;

function proposedIdentityFromEnvelope(
  value: unknown,
  candidateKind: CanonicalObjectKind,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(input)) {
    if ((PROPOSED_IDENTITY_REFERENCE_FIELDS as readonly string[]).includes(key)) {
      result[key] = preCanonicalObjectReferenceFromEnvelope(raw, `${label}.${key}`);
      continue;
    }
    if ((PROPOSED_IDENTITY_OPTIONAL_STRING_FIELDS as readonly string[]).includes(key)) {
      result[key] = requiredNonEmptyString(raw, `${label}.${key}`);
      continue;
    }
    throw new TypeError(`${label} cannot include field "${key}"`);
  }

  if (candidateKind === "AGENT_VERSION" && result.agent === undefined) {
    throw new TypeError(`${label}.agent is required for AGENT_VERSION`);
  }
  if (candidateKind === "DATA_ELEMENT") {
    if (result.parentDataAsset === undefined) {
      throw new TypeError(`${label}.parentDataAsset is required for DATA_ELEMENT`);
    }
    if (typeof result.elementPath !== "string" || result.elementPath.length === 0) {
      throw new TypeError(`${label}.elementPath is required for DATA_ELEMENT`);
    }
  }

  return result;
}

function rehydrateNormalizedCandidate(value: unknown): NormalizedCandidate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("NormalizedCandidate envelope must be an object");
  }
  const input = value as Record<string, unknown>;

  if (!isDiscoveryCandidateKindValue(input.candidateKind)) {
    throw new TypeError("NormalizedCandidate envelope candidateKind must be a known DiscoveryCandidateKind");
  }
  const isRelationship = input.candidateKind === "RELATIONSHIP";
  const allowedFields = [
    ...NORMALIZED_CANDIDATE_BASE_FIELDS,
    ...(isRelationship ? RELATIONSHIP_CANDIDATE_EXTRA_FIELDS : OBJECT_CANDIDATE_EXTRA_FIELDS),
  ];
  for (const key of Object.keys(input)) {
    if (!(allowedFields as readonly string[]).includes(key)) {
      throw new TypeError(`NormalizedCandidate envelope cannot include field "${key}"`);
    }
  }
  if (typeof input.confidence !== "number" || input.confidence < 0 || input.confidence > 1) {
    throw new TypeError("NormalizedCandidate envelope confidence must be a number between 0 and 1");
  }
  if (input.requiresReconciliation !== true) {
    throw new TypeError("NormalizedCandidate envelope requiresReconciliation must be true");
  }

  const base = {
    candidateId: asNormalizedCandidateId(requiredNonEmptyString(input.candidateId, "candidateId")),
    sourceObject: sourceObjectFromEnvelope(input.sourceObject, "sourceObject"),
    findingId: asDiscoveryFindingId(requiredNonEmptyString(input.findingId, "findingId")),
    assertionIds: Object.freeze(requiredStringArray(input.assertionIds, "assertionIds").map(asSourceAssertionId)),
    evidenceIds: Object.freeze(requiredStringArray(input.evidenceIds, "evidenceIds").map(asEvidenceId)),
    confidence: input.confidence,
    requiresReconciliation: true as const,
  };

  if (isRelationship) {
    return Object.freeze({
      ...base,
      candidateKind: "RELATIONSHIP",
      relationshipTypeCode: requiredNonEmptyString(input.relationshipTypeCode, "relationshipTypeCode"),
      sourceEndpoint: preCanonicalObjectReferenceFromEnvelope(input.sourceEndpoint, "sourceEndpoint"),
      targetEndpoint: preCanonicalObjectReferenceFromEnvelope(input.targetEndpoint, "targetEndpoint"),
    }) as NormalizedRelationshipCandidate;
  }

  const objectCandidateKind = input.candidateKind as CanonicalObjectKind;
  return Object.freeze({
    ...base,
    candidateKind: objectCandidateKind,
    proposedIdentity: proposedIdentityFromEnvelope(input.proposedIdentity, objectCandidateKind, "proposedIdentity"),
  }) as NormalizedObjectCandidate;
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

  async recordDiscoveryFinding(
    organisationId: OrganisationId,
    finding: DiscoveryFinding<DiscoveryCandidateKind>,
    acquisitionRunId: AcquisitionRun["runId"],
  ): Promise<DiscoveryFindingPersistenceResult> {
    const envelopeHash = discoveryFindingEnvelopeHash(finding);

    const { data, error } = await privilegedDb.rpc("record_discovery_finding", {
      p_finding_id: finding.findingId,
      p_organisation_id: organisationId,
      p_finding_nature: finding.findingNature,
      p_candidate_kind: finding.candidateKind,
      p_source_connection_id: finding.sourceObject.connectionId,
      p_source_external_type: finding.sourceObject.externalType,
      p_source_external_id: finding.sourceObject.externalId,
      p_confidence: finding.confidence,
      p_review_status: finding.reviewStatus,
      p_requires_review: finding.requiresReview,
      p_creates_canonical_object: finding.createsCanonicalObject,
      p_detected_at: finding.detectedAt,
      p_acquisition_run_id: acquisitionRunId,
      p_assertion_ids: [...finding.assertionIds],
      p_evidence_ids: [...finding.evidenceIds],
      p_contract_version: CONTRACT_VERSION,
      p_envelope: finding,
      p_envelope_hash: envelopeHash,
    });
    if (error) throw new Error(`record_discovery_finding failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { replay: boolean; finding_id: string };
    return { replay: row.replay, findingId: asDiscoveryFindingId(row.finding_id) };
  },

  async getDiscoveryFinding(
    organisationId: OrganisationId,
    findingId: DiscoveryFindingId,
  ): Promise<DiscoveryFinding<DiscoveryCandidateKind> | undefined> {
    const { data } = await privilegedDb
      .from("discovery_findings")
      .select("envelope, envelope_hash")
      .eq("organisation_id", organisationId)
      .eq("finding_id", findingId)
      .maybeSingle();
    if (!data) return undefined;

    const recomputed = sha256Hex(canonicalStringify(data.envelope));
    if (recomputed !== data.envelope_hash) {
      throw new Error(`DiscoveryFinding ${findingId} failed content-hash verification on read`);
    }
    return rehydrateDiscoveryFinding(data.envelope);
  },

  async recordNormalizedCandidate(
    organisationId: OrganisationId,
    candidate: NormalizedCandidate,
    acquisitionRunId: AcquisitionRun["runId"],
  ): Promise<NormalizedCandidatePersistenceResult> {
    const envelopeHash = normalizedCandidateEnvelopeHash(candidate);
    const isRelationship = candidate.candidateKind === "RELATIONSHIP";
    const relationshipCandidate = isRelationship ? (candidate as NormalizedRelationshipCandidate) : undefined;
    const objectCandidate = isRelationship ? undefined : (candidate as NormalizedObjectCandidate);

    const { data, error } = await privilegedDb.rpc("record_discovery_candidate", {
      p_candidate_id: candidate.candidateId,
      p_organisation_id: organisationId,
      p_candidate_kind: candidate.candidateKind,
      p_candidate_family: isRelationship ? "RELATIONSHIP" : "OBJECT",
      p_finding_id: candidate.findingId,
      p_source_connection_id: candidate.sourceObject.connectionId,
      p_source_external_type: candidate.sourceObject.externalType,
      p_source_external_id: candidate.sourceObject.externalId,
      p_confidence: candidate.confidence,
      p_requires_reconciliation: candidate.requiresReconciliation,
      p_proposed_identity: objectCandidate ? objectCandidate.proposedIdentity : null,
      p_relationship_type_code: relationshipCandidate ? relationshipCandidate.relationshipTypeCode : null,
      p_source_endpoint: relationshipCandidate ? relationshipCandidate.sourceEndpoint : null,
      p_target_endpoint: relationshipCandidate ? relationshipCandidate.targetEndpoint : null,
      p_acquisition_run_id: acquisitionRunId,
      p_assertion_ids: [...candidate.assertionIds],
      p_evidence_ids: [...candidate.evidenceIds],
      p_contract_version: CONTRACT_VERSION,
      p_envelope: candidate,
      p_envelope_hash: envelopeHash,
    });
    if (error) throw new Error(`record_discovery_candidate failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { replay: boolean; candidate_id: string };
    return { replay: row.replay, candidateId: asNormalizedCandidateId(row.candidate_id) };
  },

  async getNormalizedCandidateForFinding(
    organisationId: OrganisationId,
    findingId: DiscoveryFindingId,
  ): Promise<NormalizedCandidate | undefined> {
    const { data } = await privilegedDb
      .from("discovery_candidates")
      .select("envelope, envelope_hash")
      .eq("organisation_id", organisationId)
      .eq("finding_id", findingId)
      .maybeSingle();
    if (!data) return undefined;

    const recomputed = sha256Hex(canonicalStringify(data.envelope));
    if (recomputed !== data.envelope_hash) {
      throw new Error(`NormalizedCandidate for finding ${findingId} failed content-hash verification on read`);
    }
    return rehydrateNormalizedCandidate(data.envelope);
  },
};

// Exported for direct unit testing of otherwise-pure, security-critical
// hashing logic without needing to mock the Supabase client — actual
// RPC/query behavior is proven separately by the controlled Supabase runtime
// gate (see docs/codex/evidence/), matching this repo's existing test-layering
// convention (see lib/governance/persistence.ts's own exports).
export {
  discoveryFindingEnvelopeHash,
  evidenceEnvelopeHash,
  normalizedCandidateEnvelopeHash,
  rehydrateDiscoveryFinding,
  rehydrateNormalizedCandidate,
  sourceAssertionEnvelopeHash,
};
