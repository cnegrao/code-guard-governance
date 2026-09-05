import {
  CANONICAL_OBJECT_KIND,
  FINDING_REVIEW_STATUS,
  RECONCILIATION_AUTHORITY_KIND,
  asCanonicalObjectId,
  asDiscoveryFindingId,
  asEvidenceId,
  asExternalId,
  asIsoTimestamp,
  asNormalizedCandidateId,
  asOrganisationId,
  asSourceAssertionId,
  asSourceConnectionId,
  type CanonicalObjectIdentity,
  type CanonicalObjectKind,
  type DiscoveryFinding,
  type NormalizedObjectCandidate,
  type NormalizedRelationshipCandidate,
  type OrganisationId,
  type ReconciliationAuthority,
  type RelationshipDiscoveryFinding,
  type SourceObjectIdentity,
} from "@council/canonical-contracts";

import type {
  HumanReconciliationAuthority,
  ReconciliationAuthorizationPort,
  ReconciliationAuthorizationRequest,
  ReconciliationAuthorizationResult,
} from "../src/reconciliation-authorization";

export const ORG_A: OrganisationId = asOrganisationId("org:acme");
export const ORG_B: OrganisationId = asOrganisationId("org:other-tenant");

export const OBSERVED_AT = asIsoTimestamp("2026-01-01T00:00:00.000Z");
export const LATER_AT = asIsoTimestamp("2026-01-01T01:00:00.000Z");

export const HUMAN_ALICE: HumanReconciliationAuthority = {
  authorityKind: RECONCILIATION_AUTHORITY_KIND.HUMAN,
  actorReference: "user:alice",
};

export const HUMAN_BOB: HumanReconciliationAuthority = {
  authorityKind: RECONCILIATION_AUTHORITY_KIND.HUMAN,
  actorReference: "user:bob",
};

export const MACHINE_RULE: ReconciliationAuthority = {
  authorityKind: RECONCILIATION_AUTHORITY_KIND.DETERMINISTIC_RULE,
  ruleCode: "TEST_RULE",
  ruleVersion: "1.0",
};

function sourceObject(externalId: string): SourceObjectIdentity {
  return {
    connectionId: asSourceConnectionId("connection:repository:primary"),
    externalType: "file",
    externalId: asExternalId(externalId),
  };
}

export function makeAgentFinding(
  seed: string,
): DiscoveryFinding<"AGENT"> {
  return Object.freeze({
    findingId: asDiscoveryFindingId(`discovery-finding:agent:${seed}`),
    findingNature: "CANDIDATE",
    candidateKind: CANONICAL_OBJECT_KIND.AGENT,
    sourceObject: sourceObject(`repo/agent-${seed}.ts`),
    assertionIds: [asSourceAssertionId(`assertion:agent:${seed}`)],
    evidenceIds: [asEvidenceId(`evidence:agent:${seed}`)],
    confidence: 0.9,
    reviewStatus: FINDING_REVIEW_STATUS.UNREVIEWED,
    requiresReview: true,
    createsCanonicalObject: false,
    detectedAt: OBSERVED_AT,
  });
}

export function makeObjectFinding(
  kind: "AGENT" | "MODEL" | "TOOL",
  seed: string,
): DiscoveryFinding<"AGENT" | "MODEL" | "TOOL"> {
  return Object.freeze({
    findingId: asDiscoveryFindingId(`discovery-finding:${kind.toLowerCase()}:${seed}`),
    findingNature: "CANDIDATE",
    candidateKind: kind,
    sourceObject: sourceObject(`repo/${kind.toLowerCase()}-${seed}.ts`),
    assertionIds: [asSourceAssertionId(`assertion:${kind.toLowerCase()}:${seed}`)],
    evidenceIds: [asEvidenceId(`evidence:${kind.toLowerCase()}:${seed}`)],
    confidence: 0.9,
    reviewStatus: FINDING_REVIEW_STATUS.UNREVIEWED,
    requiresReview: true,
    createsCanonicalObject: false,
    detectedAt: OBSERVED_AT,
  });
}

/** Same shape as {@link makeAgentFinding} but with no evidence - used to exercise the MissingEvidenceError path. */
export function makeEvidencelessAgentFinding(seed: string): DiscoveryFinding<"AGENT"> {
  return Object.freeze({
    findingId: asDiscoveryFindingId(`discovery-finding:agent:${seed}`),
    findingNature: "CANDIDATE",
    candidateKind: CANONICAL_OBJECT_KIND.AGENT,
    sourceObject: sourceObject(`repo/agent-${seed}.ts`),
    assertionIds: [],
    evidenceIds: [],
    confidence: 0.9,
    reviewStatus: FINDING_REVIEW_STATUS.UNREVIEWED,
    requiresReview: true,
    createsCanonicalObject: false,
    detectedAt: OBSERVED_AT,
  });
}

export function makeRelationshipFinding(
  seed: string,
): RelationshipDiscoveryFinding {
  return Object.freeze({
    findingId: asDiscoveryFindingId(`discovery-finding:relationship:${seed}`),
    findingNature: "CANDIDATE",
    candidateKind: "RELATIONSHIP",
    sourceObject: sourceObject(`repo/agent-${seed}.ts`),
    assertionIds: [asSourceAssertionId(`assertion:relationship:${seed}`)],
    evidenceIds: [asEvidenceId(`evidence:relationship:${seed}`)],
    confidence: 0.9,
    reviewStatus: FINDING_REVIEW_STATUS.UNREVIEWED,
    requiresReview: true,
    createsCanonicalObject: false,
    detectedAt: OBSERVED_AT,
  });
}

export function makeRelationshipCandidate(
  finding: RelationshipDiscoveryFinding,
  seed: string,
  options: {
    readonly targetConnectionId?: string;
    readonly relationshipTypeCode?: string;
    readonly sourceCandidateKind?: CanonicalObjectKind;
    readonly targetCandidateKind?: CanonicalObjectKind;
  } = {},
): NormalizedRelationshipCandidate {
  const targetSourceObject: SourceObjectIdentity = options.targetConnectionId
    ? {
        connectionId: asSourceConnectionId(options.targetConnectionId),
        externalType: "file",
        externalId: asExternalId(`repo/model-${seed}.ts`),
      }
    : sourceObject(`repo/model-${seed}.ts`);

  return Object.freeze({
    candidateId: asNormalizedCandidateId(`candidate:relationship:${seed}`),
    candidateKind: "RELATIONSHIP",
    sourceObject: finding.sourceObject,
    findingId: finding.findingId,
    assertionIds: finding.assertionIds,
    evidenceIds: finding.evidenceIds,
    confidence: finding.confidence,
    requiresReconciliation: true,
    relationshipTypeCode: options.relationshipTypeCode ?? "USES_MODEL",
    sourceEndpoint: {
      referenceKind: "SOURCE_OBJECT" as const,
      sourceObject: finding.sourceObject,
      candidateKind: options.sourceCandidateKind ?? CANONICAL_OBJECT_KIND.AGENT,
    },
    targetEndpoint: {
      referenceKind: "SOURCE_OBJECT" as const,
      sourceObject: targetSourceObject,
      candidateKind: options.targetCandidateKind ?? CANONICAL_OBJECT_KIND.MODEL,
    },
  });
}

export function makeObjectCandidate<Kind extends "AGENT" | "MODEL" | "TOOL">(
  finding: DiscoveryFinding<Kind>,
  seed: string,
): NormalizedObjectCandidate & { readonly candidateKind: Kind } {
  return Object.freeze({
    candidateId: asNormalizedCandidateId(`candidate:${finding.candidateKind.toLowerCase()}:${seed}`),
    candidateKind: finding.candidateKind,
    sourceObject: finding.sourceObject,
    findingId: finding.findingId,
    proposedIdentity: { displayName: `Fixture ${finding.candidateKind} ${seed}` },
    assertionIds: finding.assertionIds,
    evidenceIds: finding.evidenceIds,
    confidence: finding.confidence,
    requiresReconciliation: true,
  }) as NormalizedObjectCandidate & { readonly candidateKind: Kind };
}

export function makeCanonicalObjectIdentity<Kind extends CanonicalObjectKind>(
  organisationId: OrganisationId,
  kind: Kind,
  seed: string,
): CanonicalObjectIdentity<Kind> {
  return Object.freeze({
    organisationId,
    objectId: asCanonicalObjectId(`canonical-object:${kind.toLowerCase()}:${seed}`),
    kind,
  });
}

/**
 * A deterministic, in-memory ReconciliationAuthorizationPort double for
 * tests. It never contains real authorization logic - it is preconfigured by
 * each test with the exact scope it will ALLOW, and DENIES (or throws, via
 * FAILING_AUTHORIZATION_PORT below) everything else. This is what proves the
 * gate cannot be talked into an ALLOW merely by input fields.
 */
export function makeAllowingAuthorizationPort(
  allow: Pick<ReconciliationAuthorizationRequest, "organisationId" | "subject" | "requestedAction" | "actor">,
  overrides: Partial<ReconciliationAuthorizationResult> = {},
): ReconciliationAuthorizationPort {
  return {
    authorize(request: ReconciliationAuthorizationRequest): ReconciliationAuthorizationResult {
      const subjectMatches =
        allow.subject.subjectKind === request.subject.subjectKind &&
        JSON.stringify(allow.subject) === JSON.stringify(request.subject);
      const matches =
        allow.organisationId === request.organisationId &&
        subjectMatches &&
        allow.requestedAction === request.requestedAction &&
        allow.actor.actorReference === request.actor.actorReference;

      return Object.freeze({
        authorizationDecisionId: `authz:${request.reviewSubjectId}:${request.requestedAction}`,
        result: matches ? "ALLOW" : "DENY",
        organisationId: request.organisationId,
        actorReference: request.actor.actorReference,
        subject: request.subject,
        requestedAction: request.requestedAction,
        evaluatedAt: OBSERVED_AT,
        ...overrides,
      });
    },
  };
}

/**
 * A Port double that always returns exactly the given ALLOW result,
 * regardless of what was actually requested - simulating a misconfigured or
 * compromised authorization adapter that grants the wrong scope. Used to
 * prove the gate itself (not the Port) is what enforces exact-scope matching
 * (checks I/J): an ALLOW for the wrong actor/organisation/subject/action must
 * still fail closed.
 */
export function makeFixedResultAuthorizationPort(
  result: ReconciliationAuthorizationResult,
): ReconciliationAuthorizationPort {
  return { authorize: () => result };
}

export const DENY_ALL_AUTHORIZATION_PORT: ReconciliationAuthorizationPort = {
  authorize(request: ReconciliationAuthorizationRequest): ReconciliationAuthorizationResult {
    return Object.freeze({
      authorizationDecisionId: "authz:deny-all",
      result: "DENY",
      organisationId: request.organisationId,
      actorReference: request.actor.actorReference,
      subject: request.subject,
      requestedAction: request.requestedAction,
      evaluatedAt: OBSERVED_AT,
    });
  },
};
