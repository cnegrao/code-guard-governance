import { createHash } from "node:crypto";

import type { OrganisationId } from "@council/canonical-contracts";

import { asReviewSubjectId, asReviewTransitionId, type ReviewSubjectId, type ReviewTransitionId } from "../identifiers.ts";
import { REVIEW_STATE } from "../review-state.ts";
import { MACHINE_PROPOSAL_RULE } from "./contracts.ts";

/**
 * Deterministic Discovery review identities, extracted without semantic
 * change from apps/dashboard/lib/governance/discovery-intake.ts. Inputs are
 * content-addressed upstream identities, so an unchanged rescan re-derives
 * the same subject/command and no random run identity is ever the sole
 * replay guard. Later SQL implementations must reproduce these exactly
 * (see test/fixtures/discovery-machine-identity-vectors.json).
 */

function sha256Hex(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** "review-subject:discovery:" + SHA256(JSON.stringify([organisationId, findingId])) */
export function deriveReviewSubjectId(organisationId: OrganisationId, findingId: string): ReviewSubjectId {
  return asReviewSubjectId(`review-subject:discovery:${sha256Hex([organisationId, findingId])}`);
}

/** "cmd:discovery-intake:propose:" + SHA256(JSON.stringify([reviewSubjectId, "PASS_THROUGH_V1"])) */
export function deriveProposeCommandId(reviewSubjectId: ReviewSubjectId): string {
  return `cmd:discovery-intake:propose:${sha256Hex([reviewSubjectId, MACHINE_PROPOSAL_RULE.code])}`;
}

/**
 * The existing Governance Review transition event identity for the single
 * machine transition DETECTED -> PROPOSED: the same derivation transitions.ts
 * applies ("review-transition:" + first32hex(SHA256(JSON.stringify([
 * reviewSubjectId, commandId, previousState, newState])))). This is not a
 * second event namespace; parity with propose() is a test gate.
 */
export function deriveProposeEventId(reviewSubjectId: ReviewSubjectId, commandId: string): ReviewTransitionId {
  const suffix = sha256Hex([reviewSubjectId, commandId, REVIEW_STATE.DETECTED, REVIEW_STATE.PROPOSED]).slice(0, 32);
  return asReviewTransitionId(`review-transition:${suffix}`);
}

/**
 * Supported identifier shapes for the machine command surface. Strict shapes
 * let a later SQL implementation reject anything else instead of emulating
 * JSON.stringify escaping for arbitrary text.
 */
export const DISCOVERY_FINDING_ID_PATTERN =
  /^discovery-finding:(?:(?:agent-version|relationship|lineage-observation):)?(?:[0-9a-f]{32}|[0-9a-f]{64})$/;
export const ACQUISITION_RUN_ID_PATTERN =
  /^acquisition-run:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ORGANISATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
