import {
  FINDING_REVIEW_STATUS,
  RECONCILIATION_AUTHORITY_KIND,
  type DiscoveryCandidateKind,
  type DiscoveryFinding,
  type IsoTimestamp,
  type NormalizedCandidate,
  type OrganisationId,
} from "@council/canonical-contracts";

import { IneligibleFindingError } from "./errors";
import type { ReviewSubjectId } from "./identifiers";
import { createReviewSubject } from "./review-subject";
import { REVIEW_STATE } from "./review-state";
import { propose, type ProposeCommand, type TransitionResult } from "./transitions";

export interface SemanticProposalContext {
  readonly organisationId: OrganisationId;
  readonly reviewSubjectId: ReviewSubjectId;
  readonly commandId: string;
  readonly occurredAt: IsoTimestamp;
}

/**
 * Boundary for future semantic intelligence. An implementation receives an
 * existing, evidence-backed discovery finding (and optionally the normalized
 * candidate it backs) and may produce a NON-AUTHORITATIVE PROPOSED review
 * subject. It MUST NOT call an LLM, confirm, certify, or mutate any governed
 * object - those remain exclusively human-gated (see transitions.ts) or
 * owned by canonical-contracts' reconciliation decisions.
 */
export interface SemanticProposalStrategy {
  readonly strategyCode: string;
  propose(
    finding: DiscoveryFinding<DiscoveryCandidateKind>,
    context: SemanticProposalContext,
    candidate?: NormalizedCandidate,
  ): TransitionResult;
}

/**
 * Deterministic pass-through reference implementation. It performs no
 * inference whatsoever: every eligible (UNREVIEWED) DiscoveryFinding becomes
 * a PROPOSED ReviewSubject with its provenance (finding identity, evidence,
 * assertions, source object) preserved unchanged. The point of this class is
 * to prove the authority boundary works end-to-end - its proposals are
 * authored under DETERMINISTIC_RULE authority, never HUMAN - not to
 * demonstrate any semantic intelligence.
 */
export class PassThroughSemanticProposalStrategy implements SemanticProposalStrategy {
  readonly strategyCode = "PASS_THROUGH_V1";

  propose(
    finding: DiscoveryFinding<DiscoveryCandidateKind>,
    context: SemanticProposalContext,
    candidate?: NormalizedCandidate,
  ): TransitionResult {
    if (finding.reviewStatus !== FINDING_REVIEW_STATUS.UNREVIEWED) {
      throw new IneligibleFindingError(
        `Finding ${finding.findingId} is not eligible for a semantic proposal (reviewStatus is ${finding.reviewStatus}, not UNREVIEWED)`,
      );
    }

    const subject = createReviewSubject({
      reviewSubjectId: context.reviewSubjectId,
      organisationId: context.organisationId,
      finding,
      candidate,
    });

    const command: ProposeCommand = {
      commandId: context.commandId,
      organisationId: context.organisationId,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.DETECTED,
      actor: {
        authorityKind: RECONCILIATION_AUTHORITY_KIND.DETERMINISTIC_RULE,
        ruleCode: this.strategyCode,
        ruleVersion: "1.0",
      },
      occurredAt: context.occurredAt,
    };

    return propose(subject, command);
  }
}
