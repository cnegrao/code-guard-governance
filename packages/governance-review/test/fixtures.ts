import {
  CANONICAL_OBJECT_KIND,
  FINDING_REVIEW_STATUS,
  RECONCILIATION_AUTHORITY_KIND,
  asDiscoveryFindingId,
  asEvidenceId,
  asExternalId,
  asIsoTimestamp,
  asNormalizedCandidateId,
  asOrganisationId,
  asSourceAssertionId,
  asSourceConnectionId,
  type DiscoveryFinding,
  type NormalizedRelationshipCandidate,
  type OrganisationId,
  type ReconciliationAuthority,
  type RelationshipDiscoveryFinding,
  type SourceObjectIdentity,
} from "@council/canonical-contracts";

export const ORG_A: OrganisationId = asOrganisationId("org:acme");
export const ORG_B: OrganisationId = asOrganisationId("org:other-tenant");

export const OBSERVED_AT = asIsoTimestamp("2026-01-01T00:00:00.000Z");
export const LATER_AT = asIsoTimestamp("2026-01-01T01:00:00.000Z");

export const HUMAN_ALICE: ReconciliationAuthority = {
  authorityKind: RECONCILIATION_AUTHORITY_KIND.HUMAN,
  actorReference: "user:alice",
};

export const HUMAN_BOB: ReconciliationAuthority = {
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
  options: { readonly targetConnectionId?: string } = {},
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
    relationshipTypeCode: "USES_MODEL",
    sourceEndpoint: {
      referenceKind: "SOURCE_OBJECT" as const,
      sourceObject: finding.sourceObject,
      candidateKind: CANONICAL_OBJECT_KIND.AGENT,
    },
    targetEndpoint: {
      referenceKind: "SOURCE_OBJECT" as const,
      sourceObject: targetSourceObject,
      candidateKind: CANONICAL_OBJECT_KIND.MODEL,
    },
  });
}
