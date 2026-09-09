import type { OrganisationId } from "@council/canonical-contracts";

/**
 * Technical Profile Persistence V1 (ADR-GOVIA-TECHNICAL-PROFILE-PERSISTENCE-v1).
 *
 * Narrow persistence boundary (Port/Repository pattern), the same shape as
 * MaterializationPersistencePort: this package never implements durable
 * storage itself, never talks to Supabase/Postgres directly. A trusted
 * server-only adapter (see apps/dashboard) implements this interface.
 *
 * This is the FIRST instance of the global typed, per-canonical-object-kind
 * TechnicalProfile persistence pattern, scoped to AgentVersionTechnicalProfile
 * only (packages/canonical-contracts contracts.ts:1104-1112). The seven
 * sibling *TechnicalProfile contracts (Model/Tool/MCP/API/Prompt/KnowledgeBase/
 * Skill) are not modeled here — see the ADR.
 *
 * Lifecycle this port enforces at the type level:
 *   Discovery evidence -> recordAgentVersionTechnicalProfileProposal (durable,
 *   pre-canonical, never canonical truth) -> [governed AgentVersion review /
 *   reconciliation / canonical materialization, entirely outside this port] ->
 *   materializeAgentVersionTechnicalProfile (the only path to a governed
 *   canonical profile row, gated on the canonical AGENT_VERSION already
 *   existing and the proposal genuinely belonging to it).
 *
 * CANONICAL IDENTITY != CANONICAL TECHNICAL PROFILE: neither method here ever
 * creates, mutates, or supersedes a gov_repo.canonical_objects row.
 */

/**
 * Per-field provenance only — never a semantic value. Mirrors
 * canonical-contracts' own TechnicalMetadataSupport shape exactly
 * (`{ assertionIds, evidenceIds }`).
 */
export interface AgentVersionTechnicalProfileFieldSupportInput {
  readonly assertionIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

/**
 * Mirrors AgentVersionTechnicalProfileSupport exactly: one entry per frozen
 * field name, every one required (an unsupported/undetected field is
 * represented by an empty {assertionIds: [], evidenceIds: []}, never an
 * absent key) so "no evidence for this field" is always explicit, never
 * silently omitted.
 */
export interface AgentVersionTechnicalProfileFieldSupportSetInput {
  readonly behaviorFingerprint: AgentVersionTechnicalProfileFieldSupportInput;
  readonly buildReference: AgentVersionTechnicalProfileFieldSupportInput;
  readonly runtimeFrameworkReference: AgentVersionTechnicalProfileFieldSupportInput;
  readonly entrypointReference: AgentVersionTechnicalProfileFieldSupportInput;
  readonly configurationReference: AgentVersionTechnicalProfileFieldSupportInput;
}

/**
 * Typed, pre-canonical AgentVersionTechnicalProfile proposal input. Every
 * semantic column is a direct, unrenamed mapping of the frozen
 * AgentVersionTechnicalProfile contract — behaviorFingerprint is flattened
 * to its own three BehaviorFingerprint fields (algorithm/schemaVersion/value),
 * matching that branded type's own shape exactly. buildReference/
 * runtimeFrameworkReference/entrypointReference/configurationReference are
 * optional: absence means UNKNOWN (no evidence observed), never FALSE.
 */
export interface AgentVersionTechnicalProfileProposalInput {
  readonly organisationId: OrganisationId;
  /** Content-addressed by the caller: identical semantic input always reproduces the identical id, so a reused id always replays. */
  readonly proposalId: string;
  /** Must reference an already-durable NormalizedAgentVersionCandidate (discovery_candidates, candidate_kind = AGENT_VERSION). */
  readonly agentVersionCandidateId: string;
  readonly behaviorFingerprintAlgorithm: string;
  readonly behaviorFingerprintSchemaVersion: string;
  readonly behaviorFingerprintValue: string;
  readonly buildReference?: string;
  readonly runtimeFrameworkReference?: string;
  readonly entrypointReference?: string;
  readonly configurationReference?: string;
  readonly support: AgentVersionTechnicalProfileFieldSupportSetInput;
  readonly contractVersion: string;
}

export interface AgentVersionTechnicalProfileProposalResult {
  readonly replay: boolean;
  readonly proposalId: string;
}

export interface AgentVersionTechnicalProfileMaterializationInput {
  readonly organisationId: OrganisationId;
  /** Must already exist in gov_repo.canonical_objects with kind = AGENT_VERSION. */
  readonly canonicalObjectId: string;
  /** Must already be durable via recordAgentVersionTechnicalProfileProposal. */
  readonly proposalId: string;
  readonly occurredAt: string;
}

export type AgentVersionTechnicalProfileMaterializationStatus = "APPLIED";

export interface AgentVersionTechnicalProfileMaterializationResult {
  readonly replay: boolean;
  readonly status: AgentVersionTechnicalProfileMaterializationStatus;
  readonly canonicalObjectId: string;
}

export interface AgentVersionTechnicalProfilePersistencePort {
  /**
   * Durably persists one typed AgentVersionTechnicalProfile proposal plus
   * its per-field assertion/evidence support. Never creates a canonical
   * object; never implies certification; idempotent on proposalId.
   */
  recordAgentVersionTechnicalProfileProposal(
    input: AgentVersionTechnicalProfileProposalInput,
  ): Promise<AgentVersionTechnicalProfileProposalResult>;

  /**
   * Materializes a governed canonical AgentVersionTechnicalProfile row from
   * an already-durable proposal, gated on the canonical AGENT_VERSION
   * already existing and the proposal genuinely belonging to it. Idempotent
   * on (canonicalObjectId, proposalId).
   */
  materializeAgentVersionTechnicalProfile(
    input: AgentVersionTechnicalProfileMaterializationInput,
  ): Promise<AgentVersionTechnicalProfileMaterializationResult>;
}
