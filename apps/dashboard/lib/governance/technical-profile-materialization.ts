import "server-only";
import type { OrganisationId } from "@council/canonical-contracts";
import { RECONCILIATION_INPUT_STATUS, type ReviewSubjectId } from "@council/governance-review";
import { governanceReviewPersistence, privilegedDb } from "./persistence";
import { getGovernanceDecisionDetail } from "./decision-query";
import { getReconciliationInputForReviewSubject } from "./reconciliation-input";
import { createGovernedAgentVersionTechnicalProfilePersistence } from "./agent-version-technical-profile-persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";

export interface ReviewTechnicalProfile {
  status: "READY" | "APPLIED" | "UNAVAILABLE";
  reason?: string;
  proposalId?: string;
  canonicalVersionId?: string;
  values?: { runtimeFrameworkReference: string | null; buildReference: string | null; entrypointReference: string | null; configurationReference: string | null };
}

/** Read only. No latest-proposal selection and no materialization on a GET. */
export async function getReviewTechnicalProfile(org: OrganisationId, reviewId: ReviewSubjectId): Promise<ReviewTechnicalProfile> {
  const unavailable = (reason: string): ReviewTechnicalProfile => ({ status: "UNAVAILABLE", reason });
  const subject = await governanceReviewPersistence.getReviewSubject(org, reviewId);
  if (!subject || subject.candidateKind !== "AGENT_VERSION" || subject.state !== "CERTIFIED") return unavailable("A certified AGENT_VERSION review is required.");
  const decision = await getGovernanceDecisionDetail(org, reviewId);
  const canonicalVersionId = decision?.materialization?.canonicalObjectId;
  if (!canonicalVersionId || decision.materialization?.status !== "APPLIED" || decision.reconciliation?.family !== "OBJECT"
    || !decision.reconciliation.actorReference || !["CREATE_NEW", "MATCH_EXISTING"].includes(decision.reconciliation.outcome)) return unavailable("An applied human reconciliation of this version is required.");
  const recovery = await getReconciliationInputForReviewSubject(org, subject);
  if (recovery.status !== RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE || recovery.candidate.candidateKind !== "AGENT_VERSION") return unavailable("The exact source candidate is unavailable.");
  const { data: proposals, error } = await privilegedDb.from("agent_version_technical_profile_proposals")
    .select("proposal_id,runtime_framework_reference,build_reference,entrypoint_reference,configuration_reference")
    .eq("organisation_id", org).eq("agent_version_candidate_id", recovery.candidate.candidateId);
  if (error) throw new Error("Unable to read technical profile proposals");
  if (proposals?.length !== 1) return unavailable(proposals?.length ? "Multiple proposals require explicit governance; no proposal was selected automatically." : "No technical profile proposal exists for this candidate.");
  const p = proposals[0];
  const { data: materialized, error: materializedError } = await privilegedDb.from("agent_version_technical_profile_materializations")
    .select("materialization_id").eq("organisation_id", org).eq("canonical_object_id", canonicalVersionId).eq("proposal_id", p.proposal_id).maybeSingle();
  if (materializedError) throw new Error("Unable to read profile materialization");
  return { status: materialized ? "APPLIED" : "READY", proposalId: p.proposal_id, canonicalVersionId,
    values: { runtimeFrameworkReference: p.runtime_framework_reference, buildReference: p.build_reference,
      entrypointReference: p.entrypoint_reference, configurationReference: p.configuration_reference } };
}

/** Coordinates only the existing profile port; database revalidates authority and every binding. */
export async function materializeReviewTechnicalProfile(org: OrganisationId, reviewId: ReviewSubjectId, principal: GovernanceWritePrincipal) {
  if (org !== principal.organisationId) throw new Error("Profile principal organisation mismatch");
  const context = await getReviewTechnicalProfile(org, reviewId);
  if (context.status === "UNAVAILABLE" || !context.proposalId || !context.canonicalVersionId) return { status: "UNAVAILABLE" as const, reason: context.reason };
  const result = await createGovernedAgentVersionTechnicalProfilePersistence(principal).materializeAgentVersionTechnicalProfile({
    organisationId: org, canonicalObjectId: context.canonicalVersionId, proposalId: context.proposalId, occurredAt: new Date().toISOString(),
  });
  return { status: "APPLIED" as const, replay: result.replay, canonicalVersionId: result.canonicalObjectId };
}
