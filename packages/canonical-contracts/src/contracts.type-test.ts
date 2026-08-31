import {
  CANONICAL_OBJECT_KIND,
  type ApiIdentity,
  type CandidateMergeRecord,
  type CanonicalObjectIdentity,
  type CanonicalObjectKind,
  type CreateNewReconciliationDecision,
  type DataAssetIdentity,
  type DataElementIdentity,
  type DeferReconciliationDecision,
  type DiscoveryFinding,
  type Evidence,
  type InboundAdapterEnvelope,
  type KnowledgeBaseIdentity,
  type MatchExistingReconciliationDecision,
  type McpServerIdentity,
  type MergeCandidatesReconciliationDecision,
  type ModelIdentity,
  type NormalizedAgentCandidate,
  type NormalizedAgentVersionCandidate,
  type NormalizedApiCandidate,
  type NormalizedDataAssetCandidate,
  type NormalizedDataElementCandidate,
  type NormalizedKnowledgeBaseCandidate,
  type NormalizedMcpServerCandidate,
  type NormalizedModelCandidate,
  type NormalizedPromptCandidate,
  type NormalizedRelationshipCandidate,
  type NormalizedToolCandidate,
  type PromptIdentity,
  type ReconciledObjectSourceMapping,
  type ReconciliationAuthority,
  type ReconciliationSubjectReference,
  type RejectReconciliationDecision,
  type SourceAssertion,
  type TrustedSingleSourceCandidateContributor,
  type ToolIdentity,
} from "./contracts.ts";
import { githubRepositoryDiscoveryFixture } from "./fixtures.ts";
import {
  asApiId,
  asCandidateMergeId,
  asCanonicalObjectId,
  asDataAssetId,
  asDataElementId,
  asKnowledgeBaseId,
  asMcpServerId,
  asModelId,
  asNormalizedCandidateId,
  asObjectSourceMappingId,
  asOrganisationId,
  asPromptId,
  asReconciliationDecisionId,
  asDiscoveryFindingId,
  asEvidenceId,
  asIsoTimestamp,
  asSourceAssertionId,
  asToolId,
} from "./identifiers.ts";

const validKinds: readonly CanonicalObjectKind[] = [
  CANONICAL_OBJECT_KIND.AGENT,
  CANONICAL_OBJECT_KIND.AGENT_VERSION,
  CANONICAL_OBJECT_KIND.MODEL,
  CANONICAL_OBJECT_KIND.TOOL,
  CANONICAL_OBJECT_KIND.MCP_SERVER,
  CANONICAL_OBJECT_KIND.API,
  CANONICAL_OBJECT_KIND.PROMPT,
  CANONICAL_OBJECT_KIND.KNOWLEDGE_BASE,
  CANONICAL_OBJECT_KIND.DATA_ASSET,
  CANONICAL_OBJECT_KIND.DATA_ELEMENT,
];
void validKinds;

// @ts-expect-error Relationships remain governed associations, not object kinds.
const unsupportedKind: CanonicalObjectKind = "RELATIONSHIP";
void unsupportedKind;

function canonicalObject<Kind extends CanonicalObjectKind>(
  kind: Kind,
): CanonicalObjectIdentity<Kind> {
  return {
    organisationId: asOrganisationId("organisation:identity-type-test"),
    objectId: asCanonicalObjectId(`canonical:${kind.toLowerCase()}`),
    kind,
  };
}

const modelIdentity: ModelIdentity = {
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.MODEL),
  modelId: asModelId("model:canonical"),
};
const toolIdentity: ToolIdentity = {
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.TOOL),
  toolId: asToolId("tool:canonical"),
};
const mcpServerIdentity: McpServerIdentity = {
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.MCP_SERVER),
  mcpServerId: asMcpServerId("mcp-server:canonical"),
};
const apiIdentity: ApiIdentity = {
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.API),
  apiId: asApiId("api:canonical"),
};
const promptIdentity: PromptIdentity = {
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.PROMPT),
  promptId: asPromptId("prompt:canonical"),
};
const knowledgeBaseIdentity: KnowledgeBaseIdentity = {
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.KNOWLEDGE_BASE),
  knowledgeBaseId: asKnowledgeBaseId("knowledge-base:canonical"),
};
const dataAssetIdentity: DataAssetIdentity = {
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.DATA_ASSET),
  dataAssetId: asDataAssetId("data-asset:canonical"),
};
const dataElementIdentity: DataElementIdentity = {
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.DATA_ELEMENT),
  dataElementId: asDataElementId("data-element:canonical"),
  dataAssetId: dataAssetIdentity.dataAssetId,
  elementPath: "contact_email",
};
void [
  modelIdentity,
  toolIdentity,
  mcpServerIdentity,
  apiIdentity,
  promptIdentity,
  knowledgeBaseIdentity,
  dataAssetIdentity,
  dataElementIdentity,
];

const dataElementCannotEmbedDataAsset: DataElementIdentity = {
  ...dataElementIdentity,
  // @ts-expect-error DataElement identity references only the parent DataAsset ID.
  dataAsset: dataAssetIdentity,
};
void dataElementCannotEmbedDataAsset;

const modelIdentityCannotContainProvider: ModelIdentity = {
  ...modelIdentity,
  // @ts-expect-error Provider metadata is not canonical identity.
  provider: "provider-a",
};
void modelIdentityCannotContainProvider;

const promptIdentityCannotContainContent: PromptIdentity = {
  ...promptIdentity,
  // @ts-expect-error Prompt content is not canonical identity.
  content: "system prompt",
};
void promptIdentityCannotContainContent;

const legacyEnvelope: InboundAdapterEnvelope = {
  ...githubRepositoryDiscoveryFixture,
  contractVersion: "1.0",
};
void legacyEnvelope;

const candidateSourceObject = githubRepositoryDiscoveryFixture.objects[0].identity;
const candidateFindingId = asDiscoveryFindingId("finding:type-test");
const candidateAssertionId = asSourceAssertionId("assertion:type-test");
const candidateEvidenceId = asEvidenceId("evidence:type-test");

function findingFor<Kind extends CanonicalObjectKind>(
  candidateKind: Kind,
): DiscoveryFinding<Kind> {
  return {
    findingId: candidateFindingId,
    findingNature: "CANDIDATE",
    candidateKind,
    sourceObject: candidateSourceObject,
    assertionIds: [candidateAssertionId],
    evidenceIds: [candidateEvidenceId],
    confidence: 0.8,
    reviewStatus: "UNREVIEWED",
    requiresReview: true,
    createsCanonicalObject: false,
    detectedAt: asIsoTimestamp("2026-08-30T12:00:00.000Z"),
  };
}

const findingsForEveryObjectKind = validKinds.map((kind) => findingFor(kind));
const relationshipFinding: DiscoveryFinding<"RELATIONSHIP"> = {
  ...findingFor(CANONICAL_OBJECT_KIND.AGENT),
  candidateKind: "RELATIONSHIP",
};
void [findingsForEveryObjectKind, relationshipFinding];

const candidateBase = {
  sourceObject: candidateSourceObject,
  findingId: candidateFindingId,
  assertionIds: [candidateAssertionId],
  evidenceIds: [candidateEvidenceId],
  confidence: 0.8,
  requiresReconciliation: true,
} as const;

const legacyAgentCandidate: NormalizedAgentCandidate =
  githubRepositoryDiscoveryFixture.candidates[0];
const agentVersionCandidate: NormalizedAgentVersionCandidate = {
  ...candidateBase,
  candidateId: asNormalizedCandidateId("candidate:agent-version"),
  candidateKind: "AGENT_VERSION",
  proposedIdentity: {
    agent: {
      referenceKind: "CANDIDATE",
      candidateId: legacyAgentCandidate.candidateId,
      candidateKind: "AGENT",
    },
    versionCode: "version:1",
  },
};
const modelCandidate: NormalizedModelCandidate = {
  ...candidateBase,
  candidateId: asNormalizedCandidateId("candidate:model"),
  candidateKind: "MODEL",
  proposedIdentity: { modelReference: "source-model-reference" },
};
const toolCandidate: NormalizedToolCandidate = {
  ...candidateBase,
  candidateId: asNormalizedCandidateId("candidate:tool"),
  candidateKind: "TOOL",
  proposedIdentity: { declarationKey: "sourceTool" },
};
const mcpCandidate: NormalizedMcpServerCandidate = {
  ...candidateBase,
  candidateId: asNormalizedCandidateId("candidate:mcp"),
  candidateKind: "MCP_SERVER",
  proposedIdentity: { serverReference: "source-mcp" },
};
const apiCandidate: NormalizedApiCandidate = {
  ...candidateBase,
  candidateId: asNormalizedCandidateId("candidate:api"),
  candidateKind: "API",
  proposedIdentity: { apiReference: "source-api" },
};
const promptCandidate: NormalizedPromptCandidate = {
  ...candidateBase,
  candidateId: asNormalizedCandidateId("candidate:prompt"),
  candidateKind: "PROMPT",
  proposedIdentity: { declarationKey: "SOURCE_PROMPT" },
};
const knowledgeBaseCandidate: NormalizedKnowledgeBaseCandidate = {
  ...candidateBase,
  candidateId: asNormalizedCandidateId("candidate:knowledge-base"),
  candidateKind: "KNOWLEDGE_BASE",
  proposedIdentity: { sourceReference: "source-knowledge-base" },
};
const dataAssetCandidate: NormalizedDataAssetCandidate = {
  ...candidateBase,
  candidateId: asNormalizedCandidateId("candidate:data-asset"),
  candidateKind: "DATA_ASSET",
  proposedIdentity: { sourceReference: "source-data-asset" },
};
const dataElementFromCandidate: NormalizedDataElementCandidate = {
  ...candidateBase,
  candidateId: asNormalizedCandidateId("candidate:data-element:candidate-parent"),
  candidateKind: "DATA_ELEMENT",
  proposedIdentity: {
    parentDataAsset: {
      referenceKind: "CANDIDATE",
      candidateId: dataAssetCandidate.candidateId,
      candidateKind: "DATA_ASSET",
    },
    elementPath: "contact_email",
  },
};
const dataElementFromSource: NormalizedDataElementCandidate = {
  ...candidateBase,
  candidateId: asNormalizedCandidateId("candidate:data-element:source-parent"),
  candidateKind: "DATA_ELEMENT",
  proposedIdentity: {
    parentDataAsset: {
      referenceKind: "SOURCE_OBJECT",
      sourceObject: candidateSourceObject,
      candidateKind: "DATA_ASSET",
    },
    elementPath: "contact_email",
  },
};
void [
  legacyAgentCandidate,
  agentVersionCandidate,
  modelCandidate,
  toolCandidate,
  mcpCandidate,
  apiCandidate,
  promptCandidate,
  knowledgeBaseCandidate,
  dataAssetCandidate,
  dataElementFromCandidate,
  dataElementFromSource,
];

const candidateCannotContainCanonicalObject: NormalizedAgentCandidate = {
  ...legacyAgentCandidate,
  // @ts-expect-error Canonical identity exists only after reconciliation.
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.AGENT),
};
void candidateCannotContainCanonicalObject;

const candidateCannotContainOrganisation: NormalizedAgentCandidate = {
  ...legacyAgentCandidate,
  // @ts-expect-error Tenant authority is not part of an adapter candidate.
  organisationId: asOrganisationId("organisation:forged"),
};
void candidateCannotContainOrganisation;

const highConfidenceCannotPromoteTrust: NormalizedAgentCandidate = {
  ...legacyAgentCandidate,
  confidence: 1,
  // @ts-expect-error Candidates cannot claim a canonical trust state.
  trustState: "VALIDATED",
};
void highConfidenceCannotPromoteTrust;

const dataElementCannotInventDataAssetId: NormalizedDataElementCandidate = {
  ...dataElementFromCandidate,
  proposedIdentity: {
    ...dataElementFromCandidate.proposedIdentity,
    // @ts-expect-error Parent canonical ID cannot exist before reconciliation.
    dataAssetId: asDataAssetId("data-asset:invented"),
  },
};
void dataElementCannotInventDataAssetId;

const relationshipCandidate: NormalizedRelationshipCandidate = {
  ...candidateBase,
  candidateId: asNormalizedCandidateId("candidate:relationship"),
  candidateKind: "RELATIONSHIP",
  relationshipTypeCode: "SOURCE_USES_TARGET",
  sourceEndpoint: {
    referenceKind: "CANDIDATE",
    candidateId: legacyAgentCandidate.candidateId,
    candidateKind: "AGENT",
  },
  targetEndpoint: {
    referenceKind: "SOURCE_OBJECT",
    sourceObject: candidateSourceObject,
    candidateKind: "MODEL",
  },
};
void relationshipCandidate;

const relationshipCannotBeReconciliationSubject: ReconciliationSubjectReference = {
  subjectKind: "CANDIDATE",
  candidateId: relationshipCandidate.candidateId,
  // @ts-expect-error Relationships remain discovery-only in V1A.1b.
  candidateKind: "RELATIONSHIP",
};
void relationshipCannotBeReconciliationSubject;

const relationshipCannotBeMergeContributor: TrustedSingleSourceCandidateContributor = {
  contributorKind: "CANDIDATE",
  organisationId: asOrganisationId("organisation:type-test"),
  // @ts-expect-error Relationship candidates are not canonical object candidates.
  candidate: relationshipCandidate,
};
void relationshipCannotBeMergeContributor;

const mergeRecord: CandidateMergeRecord = {
  candidateMergeId: asCandidateMergeId("candidate-merge:type-test"),
  organisationId: asOrganisationId("organisation:type-test"),
  candidateKind: "MODEL",
  contributingCandidateIds: [
    asNormalizedCandidateId("candidate:model:one"),
    asNormalizedCandidateId("candidate:model:two"),
  ],
  createdByDecisionId: asReconciliationDecisionId("decision:merge:type-test"),
  createdAt: asIsoTimestamp("2026-08-30T12:00:00.000Z"),
  requiresReconciliation: true,
  createsCanonicalObject: false,
};
void mergeRecord;

const mergeRecordCannotHaveSource: CandidateMergeRecord = {
  ...mergeRecord,
  // @ts-expect-error A merge preserves leaf candidates instead of choosing a source.
  sourceObject: candidateSourceObject,
};
void mergeRecordCannotHaveSource;

const mergeRecordCannotHaveCanonicalObject: CandidateMergeRecord = {
  ...mergeRecord,
  // @ts-expect-error A merge remains unresolved.
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.MODEL),
};
void mergeRecordCannotHaveCanonicalObject;

const mergeRecordRequiresTwoLeaves: CandidateMergeRecord = {
  ...mergeRecord,
  // @ts-expect-error Candidate merges require at least two leaf candidate IDs.
  contributingCandidateIds: [asNormalizedCandidateId("candidate:model:one")],
};
void mergeRecordRequiresTwoLeaves;

const humanAuthority: ReconciliationAuthority = {
  authorityKind: "HUMAN",
  actorReference: "actor:type-test",
};
const deterministicAuthority: ReconciliationAuthority = {
  authorityKind: "DETERMINISTIC_RULE",
  ruleCode: "SAME_CONFIRMED_SOURCE_MAPPING",
  ruleVersion: "1",
};
void [humanAuthority, deterministicAuthority];

// @ts-expect-error Deterministic rules must be versioned.
const unversionedRuleAuthority: ReconciliationAuthority = {
  authorityKind: "DETERMINISTIC_RULE",
  ruleCode: "UNVERSIONED",
};
void unversionedRuleAuthority;

const aiCannotBeAuthority: ReconciliationAuthority = {
  // @ts-expect-error AI may provide evidence, never reconciliation authority.
  authorityKind: "AI",
};
void aiCannotBeAuthority;

const decisionBase = {
  decisionId: asReconciliationDecisionId("decision:type-test"),
  organisationId: asOrganisationId("organisation:type-test"),
  candidateKind: "AGENT" as const,
  authority: humanAuthority,
  reasonCode: "HUMAN_REVIEW",
  assertionIds: [candidateAssertionId],
  evidenceIds: [candidateEvidenceId],
  decidedAt: asIsoTimestamp("2026-08-30T12:00:00.000Z"),
};
const candidateSubject = {
  subjectKind: "CANDIDATE" as const,
  candidateId: legacyAgentCandidate.candidateId,
  candidateKind: "AGENT" as const,
};

const createDecision: CreateNewReconciliationDecision = {
  ...decisionBase,
  outcome: "CREATE_NEW",
  subject: candidateSubject,
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.AGENT),
};
// @ts-expect-error CREATE_NEW requires the resulting canonical identity.
const createDecisionNeedsCanonicalObject: CreateNewReconciliationDecision = {
  ...decisionBase,
  outcome: "CREATE_NEW",
  subject: candidateSubject,
};
void createDecisionNeedsCanonicalObject;
const matchDecision: MatchExistingReconciliationDecision = {
  ...decisionBase,
  outcome: "MATCH_EXISTING",
  candidateKind: "MODEL",
  subject: {
    subjectKind: "CANDIDATE_MERGE",
    candidateMergeId: mergeRecord.candidateMergeId,
    candidateKind: "MODEL",
  },
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.MODEL),
};
// @ts-expect-error MATCH_EXISTING requires the matched canonical identity.
const matchDecisionNeedsCanonicalObject: MatchExistingReconciliationDecision = {
  ...decisionBase,
  outcome: "MATCH_EXISTING",
  subject: candidateSubject,
};
void matchDecisionNeedsCanonicalObject;
const rejectDecision: RejectReconciliationDecision = {
  ...decisionBase,
  outcome: "REJECT",
  subject: candidateSubject,
};
const deferDecision: DeferReconciliationDecision = {
  ...decisionBase,
  outcome: "DEFER",
  subject: candidateSubject,
};
const mergeDecision: MergeCandidatesReconciliationDecision = {
  ...decisionBase,
  outcome: "MERGE_CANDIDATES",
  candidateKind: "MODEL",
  contributingCandidateIds: mergeRecord.contributingCandidateIds,
  candidateMergeId: mergeRecord.candidateMergeId,
};
void [
  createDecision,
  matchDecision,
  rejectDecision,
  deferDecision,
  mergeDecision,
];

// @ts-expect-error A MODEL subject cannot reconcile to an AGENT identity.
const mismatchedSubjectKind: MatchExistingReconciliationDecision = {
  ...decisionBase,
  outcome: "MATCH_EXISTING",
  subject: {
    subjectKind: "CANDIDATE_MERGE",
    candidateMergeId: mergeRecord.candidateMergeId,
    candidateKind: "MODEL",
  },
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.AGENT),
};
void mismatchedSubjectKind;

const rejectCannotCreateCanonicalObject: RejectReconciliationDecision = {
  ...rejectDecision,
  // @ts-expect-error REJECT creates no canonical identity.
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.AGENT),
};
void rejectCannotCreateCanonicalObject;

const deferCannotCreateCanonicalObject: DeferReconciliationDecision = {
  ...deferDecision,
  // @ts-expect-error DEFER creates no canonical identity.
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.AGENT),
};
void deferCannotCreateCanonicalObject;

const mergeCannotCreateCanonicalObject: MergeCandidatesReconciliationDecision = {
  ...mergeDecision,
  // @ts-expect-error MERGE_CANDIDATES creates only a CandidateMergeRecord.
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.MODEL),
};
void mergeCannotCreateCanonicalObject;

const mergeDecisionNeedsTwoCandidates: MergeCandidatesReconciliationDecision = {
  ...mergeDecision,
  // @ts-expect-error Merge decisions require at least two leaf candidates.
  contributingCandidateIds: [asNormalizedCandidateId("candidate:model:one")],
};
void mergeDecisionNeedsTwoCandidates;

const reconciledMapping: ReconciledObjectSourceMapping = {
  mappingId: asObjectSourceMappingId("mapping:type-test"),
  canonicalObject: createDecision.canonicalObject,
  sourceObject: candidateSourceObject,
  status: "CONFIRMED",
  matchMethod: "MANUAL",
  validFrom: asIsoTimestamp("2026-08-30T12:00:00.000Z"),
  reconciliationDecisionId: createDecision.decisionId,
};
void reconciledMapping;

const envelopeCannotClaimTenant: InboundAdapterEnvelope = {
  ...githubRepositoryDiscoveryFixture,
  // @ts-expect-error Tenant authority is supplied by trusted orchestration, not an adapter.
  organisationId: "organisation-from-payload",
};
void envelopeCannotClaimTenant;

const assertionCannotStoreFacts: SourceAssertion = {
  ...githubRepositoryDiscoveryFixture.assertions[0],
  // @ts-expect-error SourceAssertion is a provenance envelope, not generic EAV.
  valueJson: { arbitrary: "fact" },
};
void assertionCannotStoreFacts;

const evidenceCannotStoreRawSecrets: Evidence = {
  ...githubRepositoryDiscoveryFixture.evidence[0],
  // @ts-expect-error Evidence has no raw secret or sensitive-value field.
  rawSensitiveValue: "must-not-exist",
};
void evidenceCannotStoreRawSecrets;
