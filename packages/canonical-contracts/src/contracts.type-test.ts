import {
  CANONICAL_OBJECT_KIND,
  createBehaviorFingerprint,
  createGovernedRelationship,
  createRelationshipReconciliationDecision,
  createTechnicalFingerprint,
  GOVERNED_RELATIONSHIP_TYPE,
  type BehaviorBindingConfigurationReference,
  type BehaviorBindingSupport,
  type AgentIdentity,
  type AgentVersionIdentity,
  type AgentVersionTechnicalProfile,
  type AgentVersionTechnicalProfileSupport,
  type ApiIdentity,
  type ApiTechnicalProfile,
  type ApiTechnicalProfileSupport,
  type BehaviorFingerprint,
  type CandidateMergeRecord,
  type CanonicalObjectIdentity,
  type CanonicalObjectKind,
  type CreateNewReconciliationDecision,
  type CreateNewRelationshipReconciliationDecision,
  type CreateNewRelationshipReconciliationDecisionDraft,
  type DataAssetIdentity,
  type DataAssetTechnicalProfile,
  type DataAssetTechnicalProfileSupport,
  type DataElementIdentity,
  type DataElementTechnicalProfile,
  type DataKeyDefinition,
  type DataTypeDescriptor,
  type DeferReconciliationDecision,
  type DeferRelationshipReconciliationDecisionDraft,
  type DiscoveryFinding,
  type Evidence,
  type EvidenceHash,
  type ForeignKeyDefinition,
  type GovernedRelationship,
  type GovernedRelationshipDraft,
  type GovernedRelationshipType,
  type HandoffToRelationship,
  type InboundAdapterEnvelope,
  type KnowledgeBaseIdentity,
  type KnowledgeBaseTechnicalProfile,
  type KnowledgeBaseTechnicalProfileSupport,
  type MatchExistingReconciliationDecision,
  type MatchExistingRelationshipReconciliationDecision,
  type MatchExistingRelationshipReconciliationDecisionDraft,
  type McpServerIdentity,
  type McpServerTechnicalProfile,
  type McpServerTechnicalProfileSupport,
  type MergeCandidatesReconciliationDecision,
  type ModelIdentity,
  type ModelTechnicalProfile,
  type ModelTechnicalProfileSupport,
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
  type NormalizedSkillCandidate,
  type NormalizedToolCandidate,
  type PromptIdentity,
  type PromptTechnicalProfile,
  type PromptTechnicalProfileSupport,
  type ReconciledObjectSourceMapping,
  type ReconciliationAuthority,
  type ReconciliationSubjectReference,
  type RejectReconciliationDecision,
  type RejectRelationshipReconciliationDecisionDraft,
  type RelationshipMatchReference,
  type RelationshipReconciliationOutcome,
  type RelationshipSupport,
  type SourceAssertion,
  type SkillIdentity,
  type SkillTechnicalProfile,
  type SkillTechnicalProfileSupport,
  type TechnicalMetadataSupport,
  type TechnicalFingerprint,
  type TrustedSingleSourceCandidateContributor,
  type ToolIdentity,
  type ToolTechnicalProfile,
  type ToolTechnicalProfileSupport,
  type UsesSkillRelationship,
} from "./contracts.ts";
import { githubRepositoryDiscoveryFixture } from "./fixtures.ts";
import {
  asAgentId,
  asApiId,
  asAgentVersionId,
  asCandidateMergeId,
  asCanonicalObjectId,
  asDataAssetId,
  asDataElementId,
  asDataKeyDefinitionId,
  asKnowledgeBaseId,
  asMcpServerId,
  asModelId,
  asNormalizedCandidateId,
  asObjectSourceMappingId,
  asOrganisationId,
  asPromptId,
  asReconciliationDecisionId,
  asRelationshipId,
  asRelationshipStateId,
  asSkillId,
  asDiscoveryFindingId,
  asEvidenceId,
  asForeignKeyDefinitionId,
  asIsoTimestamp,
  asSourceAssertionId,
  asToolId,
  sanitizeTechnicalLocator,
  type RelationshipId,
  type RelationshipStateId,
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
  CANONICAL_OBJECT_KIND.SKILL,
];
void validKinds;

// @ts-expect-error Relationships remain governed associations, not object kinds.
const unsupportedKind: CanonicalObjectKind = "RELATIONSHIP";
void unsupportedKind;

// @ts-expect-error Skill has no separately governed version kind in V1A.1.
const skillVersionCannotBeCanonical: CanonicalObjectKind = "SKILL_VERSION";
void skillVersionCannotBeCanonical;

function canonicalObject<Kind extends CanonicalObjectKind>(
  kind: Kind,
): CanonicalObjectIdentity<Kind> {
  return {
    organisationId: asOrganisationId("organisation:identity-type-test"),
    objectId: asCanonicalObjectId(`canonical:${kind.toLowerCase()}`),
    kind,
  };
}

const agentIdentity: AgentIdentity = {
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.AGENT),
  agentId: asAgentId("agent:canonical"),
  agentCode: "AGENT_CANONICAL",
};
const agentVersionIdentity: AgentVersionIdentity = {
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.AGENT_VERSION),
  agent: agentIdentity,
  agentVersionId: asAgentVersionId("agent-version:canonical"),
  versionCode: "version:one",
};
const agentVersionCannotUseAgentId: AgentVersionIdentity = {
  ...agentVersionIdentity,
  // @ts-expect-error Agent and AgentVersion retain distinct branded identities.
  agentVersionId: agentIdentity.agentId,
};
void [agentIdentity, agentVersionIdentity, agentVersionCannotUseAgentId];

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
const skillIdentity: SkillIdentity = {
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.SKILL),
  skillId: asSkillId("skill:canonical"),
};
const skillIdentityCannotUsePromptId: SkillIdentity = {
  ...skillIdentity,
  // @ts-expect-error Skill and Prompt retain distinct branded identities.
  skillId: promptIdentity.promptId,
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
  skillIdentity,
  skillIdentityCannotUsePromptId,
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
const skillCandidate: NormalizedSkillCandidate = {
  ...candidateBase,
  candidateId: asNormalizedCandidateId("candidate:skill"),
  candidateKind: "SKILL",
  proposedIdentity: {
    declarationReference: "skills/review/SKILL.md",
    displayName: "Review procedure",
  },
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
  skillCandidate,
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

const usesSkillRelationshipCandidate: NormalizedRelationshipCandidate = {
  ...relationshipCandidate,
  candidateId: asNormalizedCandidateId("candidate:relationship:uses-skill"),
  relationshipTypeCode: "USES_SKILL",
  sourceEndpoint: {
    referenceKind: "CANDIDATE",
    candidateId: asNormalizedCandidateId("candidate:agent-version"),
    candidateKind: "AGENT_VERSION",
  },
  targetEndpoint: {
    referenceKind: "CANDIDATE",
    candidateId: asNormalizedCandidateId("candidate:skill"),
    candidateKind: "SKILL",
  },
};
const sourceRelationshipTypeCodeRemainsString: string =
  usesSkillRelationshipCandidate.relationshipTypeCode;
void sourceRelationshipTypeCodeRemainsString;

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

const skillMergeRecord: CandidateMergeRecord = {
  candidateMergeId: asCandidateMergeId("candidate-merge:skill:type-test"),
  organisationId: asOrganisationId("organisation:type-test"),
  candidateKind: "SKILL",
  contributingCandidateIds: [
    skillCandidate.candidateId,
    asNormalizedCandidateId("candidate:skill:second-source"),
  ],
  createdByDecisionId: asReconciliationDecisionId(
    "decision:merge:skill:type-test",
  ),
  createdAt: asIsoTimestamp("2026-08-30T12:00:00.000Z"),
  requiresReconciliation: true,
  createsCanonicalObject: false,
};
void skillMergeRecord;

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
const skillCreateDecision: CreateNewReconciliationDecision = {
  ...decisionBase,
  outcome: "CREATE_NEW",
  candidateKind: "SKILL",
  subject: {
    subjectKind: "CANDIDATE_MERGE",
    candidateMergeId: skillMergeRecord.candidateMergeId,
    candidateKind: "SKILL",
  },
  canonicalObject: canonicalObject(CANONICAL_OBJECT_KIND.SKILL),
};
const skillMergeDecision: MergeCandidatesReconciliationDecision = {
  ...decisionBase,
  outcome: "MERGE_CANDIDATES",
  candidateKind: "SKILL",
  contributingCandidateIds: skillMergeRecord.contributingCandidateIds,
  candidateMergeId: skillMergeRecord.candidateMergeId,
};
void [
  createDecision,
  matchDecision,
  rejectDecision,
  deferDecision,
  mergeDecision,
  skillCreateDecision,
  skillMergeDecision,
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

const emptyTechnicalSupport: TechnicalMetadataSupport = {
  assertionIds: [],
  evidenceIds: [],
};
const repositoryNameSupport: TechnicalMetadataSupport = {
  assertionIds: [asSourceAssertionId("assertion:repository:technical-name")],
  evidenceIds: [asEvidenceId("evidence:repository:technical-name")],
};
const catalogTypeSupport: TechnicalMetadataSupport = {
  assertionIds: [
    asSourceAssertionId("assertion:catalog:data-type:one"),
    asSourceAssertionId("assertion:catalog:data-type:conflicting"),
  ],
  evidenceIds: [asEvidenceId("evidence:catalog:data-type")],
};

const dataAssetProfileSupport: DataAssetTechnicalProfileSupport = {
  structuralKind: emptyTechnicalSupport,
  technicalName: repositoryNameSupport,
  technicalNamespace: emptyTechnicalSupport,
  qualifiedTechnicalLocator: emptyTechnicalSupport,
  technicalDescription: emptyTechnicalSupport,
};
const dataAssetProfile: DataAssetTechnicalProfile = {
  dataAssetId: dataAssetIdentity.dataAssetId,
  structuralKind: "TABLE",
  technicalName: "customer",
  support: dataAssetProfileSupport,
};
void dataAssetProfile;

const dataAssetProfileCannotContainIdentity: DataAssetTechnicalProfile = {
  ...dataAssetProfile,
  // @ts-expect-error Canonical identity remains separate from its profile.
  canonicalObject: dataAssetIdentity.canonicalObject,
};
void dataAssetProfileCannotContainIdentity;

const dataAssetSupportCannotUseArbitraryKeys: DataAssetTechnicalProfileSupport = {
  ...dataAssetProfileSupport,
  // @ts-expect-error Profile support keys are explicit, never metadata/EAV keys.
  arbitraryField: emptyTechnicalSupport,
};
void dataAssetSupportCannotUseArbitraryKeys;

const supportCannotClaimTrust: TechnicalMetadataSupport = {
  ...emptyTechnicalSupport,
  // @ts-expect-error Trust belongs to SourceAssertion.
  trustState: "VALIDATED",
};
void supportCannotClaimTrust;

const supportCannotStorePredicate: TechnicalMetadataSupport = {
  ...emptyTechnicalSupport,
  // @ts-expect-error Support references provenance; it is not EAV.
  predicate: "technicalName",
};
void supportCannotStorePredicate;

const supportCannotStoreValue: TechnicalMetadataSupport = {
  ...emptyTechnicalSupport,
  // @ts-expect-error The typed profile field owns the canonical value.
  value: "customer",
};
void supportCannotStoreValue;

const supportCannotStoreFactName: TechnicalMetadataSupport = {
  ...emptyTechnicalSupport,
  // @ts-expect-error Support is not a generic fact bag.
  factName: "technical_name",
};
void supportCannotStoreFactName;

const decimalDataType: DataTypeDescriptor = {
  normalizedFamily: "DECIMAL",
  nativeType: "NUMBER(18,4)",
  precision: 18,
  scale: 4,
  timeZoneSemantics: "NOT_APPLICABLE",
};
const dataElementProfile: DataElementTechnicalProfile = {
  dataElementId: dataElementIdentity.dataElementId,
  technicalName: "customer_id",
  ordinalPosition: 1,
  dataType: decimalDataType,
  nullability: "NOT_NULLABLE",
  defaultState: "ABSENT",
  generationState: "NOT_GENERATED",
  support: {
    technicalName: repositoryNameSupport,
    ordinalPosition: {
      assertionIds: [asSourceAssertionId("assertion:enterprise:ordinal")],
      evidenceIds: [],
    },
    dataType: {
      normalizedFamily: catalogTypeSupport,
      nativeType: catalogTypeSupport,
      length: emptyTechnicalSupport,
      precision: catalogTypeSupport,
      scale: catalogTypeSupport,
      timeZoneSemantics: emptyTechnicalSupport,
    },
    nullability: {
      assertionIds: [asSourceAssertionId("assertion:runtime:nullability")],
      evidenceIds: [asEvidenceId("evidence:runtime:nullability")],
    },
    defaultState: emptyTechnicalSupport,
    generationState: emptyTechnicalSupport,
  },
};
void dataElementProfile;

const dataElementProfileCannotRepeatParent: DataElementTechnicalProfile = {
  ...dataElementProfile,
  // @ts-expect-error Structural ownership remains on DataElementIdentity.
  dataAssetId: dataElementIdentity.dataAssetId,
};
void dataElementProfileCannotRepeatParent;

const dataElementProfileCannotRepeatPath: DataElementTechnicalProfile = {
  ...dataElementProfile,
  // @ts-expect-error elementPath remains identity, not profile metadata.
  elementPath: dataElementIdentity.elementPath,
};
void dataElementProfileCannotRepeatPath;

const dataElementCannotUsePrimaryKeyBoolean: DataElementTechnicalProfile = {
  ...dataElementProfile,
  // @ts-expect-error Keys are separate composite-capable definitions.
  isPrimaryKey: true,
};
void dataElementCannotUsePrimaryKeyBoolean;

const dataElementCannotUseForeignKeyBoolean: DataElementTechnicalProfile = {
  ...dataElementProfile,
  // @ts-expect-error Foreign keys are directional structural definitions.
  isForeignKey: true,
};
void dataElementCannotUseForeignKeyBoolean;

const dataElementCannotStoreRawDefault: DataElementTechnicalProfile = {
  ...dataElementProfile,
  // @ts-expect-error Raw default expressions are evidence/source concerns.
  defaultExpression: "current_user_secret()",
};
void dataElementCannotStoreRawDefault;

const invalidNormalizedFamily: DataTypeDescriptor = {
  ...decimalDataType,
  // @ts-expect-error Datatype normalization uses the controlled V1A.1c vocabulary.
  normalizedFamily: "VARCHAR2",
};
void invalidNormalizedFamily;

const compositePrimaryKey: DataKeyDefinition = {
  keyDefinitionId: asDataKeyDefinitionId("key:customer:primary"),
  dataAssetId: dataAssetIdentity.dataAssetId,
  keyType: "PRIMARY_KEY",
  technicalName: "customer_pk",
  members: [
    { position: 1, dataElementId: asDataElementId("element:customer:id") },
    { position: 2, dataElementId: asDataElementId("element:customer:region") },
  ],
  support: catalogTypeSupport,
};
const compositeUniqueKey: DataKeyDefinition = {
  ...compositePrimaryKey,
  keyDefinitionId: asDataKeyDefinitionId("key:customer:unique"),
  keyType: "UNIQUE_KEY",
};
void [compositePrimaryKey, compositeUniqueKey];

const finalKeyCannotBeEmpty: DataKeyDefinition = {
  ...compositePrimaryKey,
  // @ts-expect-error A persisted domain key definition has at least one member.
  members: [],
};
void finalKeyCannotBeEmpty;

const keyCannotUseForeignKeyId: DataKeyDefinition = {
  ...compositePrimaryKey,
  // @ts-expect-error Definition IDs are separately branded.
  keyDefinitionId: asForeignKeyDefinitionId("foreign-key:wrong-brand"),
};
void keyCannotUseForeignKeyId;

const compositeForeignKey: ForeignKeyDefinition = {
  foreignKeyDefinitionId: asForeignKeyDefinitionId("foreign-key:order:customer"),
  sourceDataAssetId: asDataAssetId("asset:order"),
  targetDataAssetId: asDataAssetId("asset:customer"),
  referencedKeyDefinitionId: compositePrimaryKey.keyDefinitionId,
  technicalName: "order_customer_fk",
  mappings: [
    {
      position: 1,
      sourceDataElementId: asDataElementId("element:order:customer_id"),
      targetDataElementId: asDataElementId("element:customer:id"),
    },
    {
      position: 2,
      sourceDataElementId: asDataElementId("element:order:customer_region"),
      targetDataElementId: asDataElementId("element:customer:region"),
    },
  ],
  support: catalogTypeSupport,
};
void compositeForeignKey;

const finalForeignKeyCannotBeEmpty: ForeignKeyDefinition = {
  ...compositeForeignKey,
  // @ts-expect-error A foreign key definition has at least one mapping.
  mappings: [],
};
void finalForeignKeyCannotBeEmpty;

const dataAssetCandidateCannotContainProfile: NormalizedDataAssetCandidate = {
  ...dataAssetCandidate,
  proposedIdentity: {
    ...dataAssetCandidate.proposedIdentity,
    // @ts-expect-error Candidates remain minimum identity proposals.
    technicalProfile: dataAssetProfile,
  },
};
void dataAssetCandidateCannotContainProfile;

// @ts-expect-error CONTAINS is a reconstructable projection, not an object kind.
const containsCannotBeCanonicalIdentity: CanonicalObjectKind = "CONTAINS";
void containsCannotBeCanonicalIdentity;

const behaviorFingerprint: BehaviorFingerprint = createBehaviorFingerprint({
  algorithm: "SHA-256",
  schemaVersion: "agent-behavior/v1",
  value: "behavior-fingerprint",
});
const technicalFingerprint: TechnicalFingerprint = createTechnicalFingerprint({
  algorithm: "SHA-256",
  schemaVersion: "technical-profile/v1",
  value: "technical-fingerprint",
});

// @ts-expect-error Behavior and technical fingerprints are nominally distinct.
const behaviorCannotBeTechnical: TechnicalFingerprint = behaviorFingerprint;
// @ts-expect-error Technical and behavior fingerprints are nominally distinct.
const technicalCannotBeBehavior: BehaviorFingerprint = technicalFingerprint;
const evidenceHash: EvidenceHash = {
  algorithm: "SHA-256",
  value: "content-hash",
};
// @ts-expect-error A content-integrity hash is not a technical fingerprint.
const evidenceHashCannotBeTechnical: TechnicalFingerprint = evidenceHash;
void [
  behaviorCannotBeTechnical,
  technicalCannotBeBehavior,
  evidenceHashCannotBeTechnical,
];

const agentVersionProfileSupport: AgentVersionTechnicalProfileSupport = {
  behaviorFingerprint: emptyTechnicalSupport,
  buildReference: emptyTechnicalSupport,
  runtimeFrameworkReference: emptyTechnicalSupport,
  entrypointReference: emptyTechnicalSupport,
  configurationReference: emptyTechnicalSupport,
};
const agentVersionProfile: AgentVersionTechnicalProfile = {
  agentVersionId: asAgentVersionId("agent-version:canonical"),
  behaviorFingerprint,
  support: agentVersionProfileSupport,
};
// @ts-expect-error Every AgentVersion technical profile requires behavior identity.
const agentVersionProfileWithoutFingerprint: AgentVersionTechnicalProfile = {
  agentVersionId: asAgentVersionId("agent-version:missing-fingerprint"),
  support: agentVersionProfileSupport,
};
const agentVersionProfileCannotContainBindings: AgentVersionTechnicalProfile = {
  ...agentVersionProfile,
  // @ts-expect-error Bindings are separate future immutable relationships.
  modelBindings: [],
};
const agentVersionProfileCannotContainGovernance: AgentVersionTechnicalProfile = {
  ...agentVersionProfile,
  // @ts-expect-error Governance state does not define immutable behavior.
  risk: "HIGH",
};
void [
  agentVersionProfile,
  agentVersionProfileWithoutFingerprint,
  agentVersionProfileCannotContainBindings,
  agentVersionProfileCannotContainGovernance,
];

const modelProfileSupport: ModelTechnicalProfileSupport = {
  technicalFingerprint: emptyTechnicalSupport,
  providerReference: emptyTechnicalSupport,
  providerModelReference: emptyTechnicalSupport,
  modelFamily: emptyTechnicalSupport,
  modelRevision: emptyTechnicalSupport,
};
const modelProfile: ModelTechnicalProfile = {
  modelId: modelIdentity.modelId,
  technicalFingerprint,
  support: modelProfileSupport,
};
// @ts-expect-error A Model profile requires a technical fingerprint.
const modelProfileWithoutFingerprint: ModelTechnicalProfile = {
  modelId: modelIdentity.modelId,
  support: modelProfileSupport,
};
const modelProfileCannotContainDeployment: ModelTechnicalProfile = {
  ...modelProfile,
  // @ts-expect-error Deployment and endpoint state is a later grain.
  deployment: "production",
};
const modelProfileCannotContainIdentity: ModelTechnicalProfile = {
  ...modelProfile,
  // @ts-expect-error Canonical identity remains separate from its profile.
  canonicalObject: modelIdentity.canonicalObject,
};
void [
  modelProfile,
  modelProfileWithoutFingerprint,
  modelProfileCannotContainDeployment,
  modelProfileCannotContainIdentity,
];

const toolProfileSupport: ToolTechnicalProfileSupport = {
  technicalFingerprint: emptyTechnicalSupport,
  declarationReference: emptyTechnicalSupport,
  contractReference: emptyTechnicalSupport,
  contractHash: emptyTechnicalSupport,
  technicalDescription: emptyTechnicalSupport,
};
const toolProfile: ToolTechnicalProfile = {
  toolId: toolIdentity.toolId,
  technicalFingerprint,
  contractHash: evidenceHash,
  support: toolProfileSupport,
};
// @ts-expect-error A Tool profile requires a technical fingerprint.
const toolProfileWithoutFingerprint: ToolTechnicalProfile = {
  toolId: toolIdentity.toolId,
  support: toolProfileSupport,
};
void [toolProfile, toolProfileWithoutFingerprint];

const mcpProfileSupport: McpServerTechnicalProfileSupport = {
  technicalFingerprint: emptyTechnicalSupport,
  declaredServerReference: emptyTechnicalSupport,
  protocolVersion: emptyTechnicalSupport,
  transport: emptyTechnicalSupport,
  endpointLocator: emptyTechnicalSupport,
};
const mcpProfile: McpServerTechnicalProfile = {
  mcpServerId: mcpServerIdentity.mcpServerId,
  technicalFingerprint,
  transport: "STREAMABLE_HTTP",
  endpointLocator: sanitizeTechnicalLocator("https://mcp.invalid/rpc"),
  support: mcpProfileSupport,
};
// @ts-expect-error An MCP server profile requires a technical fingerprint.
const mcpProfileWithoutFingerprint: McpServerTechnicalProfile = {
  mcpServerId: mcpServerIdentity.mcpServerId,
  transport: "STDIO",
  support: mcpProfileSupport,
};
const mcpProfileCannotUseRawLocator: McpServerTechnicalProfile = {
  ...mcpProfile,
  // @ts-expect-error Technical locators must cross the sanitizer boundary.
  endpointLocator: "https://user:secret@mcp.invalid/rpc?token=secret",
};
void [mcpProfile, mcpProfileWithoutFingerprint, mcpProfileCannotUseRawLocator];

const apiProfileSupport: ApiTechnicalProfileSupport = {
  technicalFingerprint: emptyTechnicalSupport,
  protocolFamily: emptyTechnicalSupport,
  serviceReference: emptyTechnicalSupport,
  baseLocator: emptyTechnicalSupport,
  specificationReference: emptyTechnicalSupport,
  specificationHash: emptyTechnicalSupport,
};
const apiProfile: ApiTechnicalProfile = {
  apiId: apiIdentity.apiId,
  technicalFingerprint,
  protocolFamily: "HTTP",
  baseLocator: sanitizeTechnicalLocator("https://api.invalid/v1"),
  support: apiProfileSupport,
};
// @ts-expect-error An API profile requires a technical fingerprint.
const apiProfileWithoutFingerprint: ApiTechnicalProfile = {
  apiId: apiIdentity.apiId,
  protocolFamily: "GRPC",
  support: apiProfileSupport,
};
const apiProfileCannotContainCredentials: ApiTechnicalProfile = {
  ...apiProfile,
  // @ts-expect-error Credentials and secrets have no profile field.
  credentials: "secret",
};
void [
  apiProfile,
  apiProfileWithoutFingerprint,
  apiProfileCannotContainCredentials,
];

const promptProfileSupport: PromptTechnicalProfileSupport = {
  technicalFingerprint: emptyTechnicalSupport,
  declarationReference: emptyTechnicalSupport,
  revision: emptyTechnicalSupport,
  contentHash: emptyTechnicalSupport,
  sourceLocator: emptyTechnicalSupport,
};
const promptProfile: PromptTechnicalProfile = {
  promptId: promptIdentity.promptId,
  technicalFingerprint,
  contentHash: evidenceHash,
  sourceLocator: sanitizeTechnicalLocator("prompts/system.md"),
  support: promptProfileSupport,
};
// @ts-expect-error A Prompt profile requires a technical fingerprint.
const promptProfileWithoutFingerprint: PromptTechnicalProfile = {
  promptId: promptIdentity.promptId,
  support: promptProfileSupport,
};
const promptProfileCannotContainContent: PromptTechnicalProfile = {
  ...promptProfile,
  // @ts-expect-error Raw prompt content is not part of the canonical profile.
  content: "system prompt",
};
void [
  promptProfile,
  promptProfileWithoutFingerprint,
  promptProfileCannotContainContent,
];

const knowledgeBaseProfileSupport: KnowledgeBaseTechnicalProfileSupport = {
  technicalFingerprint: emptyTechnicalSupport,
  sourceReference: emptyTechnicalSupport,
  resourceKind: emptyTechnicalSupport,
  contentHash: emptyTechnicalSupport,
  retrievalConfigurationReference: emptyTechnicalSupport,
};
const knowledgeBaseProfile: KnowledgeBaseTechnicalProfile = {
  knowledgeBaseId: knowledgeBaseIdentity.knowledgeBaseId,
  technicalFingerprint,
  resourceKind: "VECTOR_INDEX",
  support: knowledgeBaseProfileSupport,
};
// @ts-expect-error A KnowledgeBase profile requires a technical fingerprint.
const knowledgeBaseProfileWithoutFingerprint: KnowledgeBaseTechnicalProfile = {
  knowledgeBaseId: knowledgeBaseIdentity.knowledgeBaseId,
  resourceKind: "SEARCH_INDEX",
  support: knowledgeBaseProfileSupport,
};
const knowledgeBaseProfileCannotContainEmbeddings: KnowledgeBaseTechnicalProfile = {
  ...knowledgeBaseProfile,
  // @ts-expect-error Embedding/vector contents are outside this profile.
  embeddings: [[0.1, 0.2]],
};
void [
  knowledgeBaseProfile,
  knowledgeBaseProfileWithoutFingerprint,
  knowledgeBaseProfileCannotContainEmbeddings,
];

const skillProfileSupport: SkillTechnicalProfileSupport = {
  technicalFingerprint: emptyTechnicalSupport,
  declarationReference: repositoryNameSupport,
  revisionReference: emptyTechnicalSupport,
  artifactHash: catalogTypeSupport,
  manifestReference: emptyTechnicalSupport,
  sourceLocator: emptyTechnicalSupport,
};
const skillProfile: SkillTechnicalProfile = {
  skillId: skillIdentity.skillId,
  technicalFingerprint,
  declarationReference: "skills/review/SKILL.md",
  revisionReference: "revision:one",
  artifactHash: evidenceHash,
  manifestReference: "skills/review/package.json",
  sourceLocator: sanitizeTechnicalLocator("skills/review/SKILL.md"),
  support: skillProfileSupport,
};
const minimalSkillProfile: SkillTechnicalProfile = {
  skillId: skillIdentity.skillId,
  technicalFingerprint,
  support: {
    technicalFingerprint: emptyTechnicalSupport,
    declarationReference: emptyTechnicalSupport,
    revisionReference: emptyTechnicalSupport,
    artifactHash: emptyTechnicalSupport,
    manifestReference: emptyTechnicalSupport,
    sourceLocator: emptyTechnicalSupport,
  },
};
// @ts-expect-error A Skill profile requires technical-state identity.
const skillProfileWithoutFingerprint: SkillTechnicalProfile = {
  skillId: skillIdentity.skillId,
  support: skillProfileSupport,
};
const skillProfileCannotUseRawLocator: SkillTechnicalProfile = {
  ...skillProfile,
  // @ts-expect-error Skill locators must cross the sanitizer boundary.
  sourceLocator: "skills/review/SKILL.md?token=secret",
};
const skillProfileCannotContainRawContent: SkillTechnicalProfile = {
  ...skillProfile,
  // @ts-expect-error Raw Skill content is not part of the technical profile.
  content: "procedure body",
};
const skillProfileCannotContainAuthorization: SkillTechnicalProfile = {
  ...skillProfile,
  // @ts-expect-error Binding a Skill never grants authorization.
  authorization: "GRANTED",
};
const skillSupportCannotUseArbitraryKeys: SkillTechnicalProfileSupport = {
  ...skillProfileSupport,
  // @ts-expect-error Skill field provenance is explicit, never metadata/EAV.
  arbitraryField: emptyTechnicalSupport,
};
void [
  skillProfile,
  minimalSkillProfile,
  skillProfileWithoutFingerprint,
  skillProfileCannotUseRawLocator,
  skillProfileCannotContainRawContent,
  skillProfileCannotContainAuthorization,
  skillSupportCannotUseArbitraryKeys,
];

const modelSupportCannotUseArbitraryKeys: ModelTechnicalProfileSupport = {
  ...modelProfileSupport,
  // @ts-expect-error Field support is explicit and cannot become metadata/EAV.
  arbitraryField: emptyTechnicalSupport,
};
void modelSupportCannotUseArbitraryKeys;

// @ts-expect-error Fingerprint provenance is an explicit required support key.
const modelSupportWithoutFingerprint: ModelTechnicalProfileSupport = {
  providerReference: emptyTechnicalSupport,
  providerModelReference: emptyTechnicalSupport,
  modelFamily: emptyTechnicalSupport,
  modelRevision: emptyTechnicalSupport,
};
void modelSupportWithoutFingerprint;

const agentVersionCandidateCannotContainProfile: NormalizedAgentVersionCandidate = {
  ...agentVersionCandidate,
  proposedIdentity: {
    ...agentVersionCandidate.proposedIdentity,
    // @ts-expect-error Candidates remain identity proposals, not canonical profiles.
    technicalProfile: agentVersionProfile,
  },
};
const modelCandidateCannotContainFingerprint: NormalizedModelCandidate = {
  ...modelCandidate,
  proposedIdentity: {
    ...modelCandidate.proposedIdentity,
    // @ts-expect-error Reconciliation has not accepted a technical fingerprint.
    technicalFingerprint,
  },
};
const toolCandidateCannotContainFingerprint: NormalizedToolCandidate = {
  ...toolCandidate,
  proposedIdentity: {
    ...toolCandidate.proposedIdentity,
    // @ts-expect-error Tool candidates remain minimum identity proposals.
    technicalFingerprint,
  },
};
const mcpCandidateCannotContainFingerprint: NormalizedMcpServerCandidate = {
  ...mcpCandidate,
  proposedIdentity: {
    ...mcpCandidate.proposedIdentity,
    // @ts-expect-error MCP candidates remain minimum identity proposals.
    technicalFingerprint,
  },
};
const apiCandidateCannotContainFingerprint: NormalizedApiCandidate = {
  ...apiCandidate,
  proposedIdentity: {
    ...apiCandidate.proposedIdentity,
    // @ts-expect-error API candidates remain minimum identity proposals.
    technicalFingerprint,
  },
};
const promptCandidateCannotContainFingerprint: NormalizedPromptCandidate = {
  ...promptCandidate,
  proposedIdentity: {
    ...promptCandidate.proposedIdentity,
    // @ts-expect-error Prompt candidates remain minimum identity proposals.
    technicalFingerprint,
  },
};
const knowledgeBaseCandidateCannotContainFingerprint: NormalizedKnowledgeBaseCandidate = {
  ...knowledgeBaseCandidate,
  proposedIdentity: {
    ...knowledgeBaseCandidate.proposedIdentity,
    // @ts-expect-error Knowledge Base candidates remain minimum identity proposals.
    technicalFingerprint,
  },
};
const skillCandidateCannotContainCanonicalId: NormalizedSkillCandidate = {
  ...skillCandidate,
  proposedIdentity: {
    ...skillCandidate.proposedIdentity,
    // @ts-expect-error Reconciliation has not assigned a canonical Skill ID.
    skillId: skillIdentity.skillId,
  },
};
const skillCandidateCannotContainFingerprint: NormalizedSkillCandidate = {
  ...skillCandidate,
  proposedIdentity: {
    ...skillCandidate.proposedIdentity,
    // @ts-expect-error Skill candidates carry signals, not accepted state.
    technicalFingerprint,
  },
};
const skillCandidateCannotContainProfile: NormalizedSkillCandidate = {
  ...skillCandidate,
  proposedIdentity: {
    ...skillCandidate.proposedIdentity,
    // @ts-expect-error Technical profiles exist only after reconciliation.
    technicalProfile: skillProfile,
  },
};
const skillCandidateCannotContainRevision: NormalizedSkillCandidate = {
  ...skillCandidate,
  proposedIdentity: {
    ...skillCandidate.proposedIdentity,
    // @ts-expect-error Revision is a reconciliation signal, not proposed identity.
    revisionReference: "revision:one",
  },
};
void [
  agentVersionCandidateCannotContainProfile,
  modelCandidateCannotContainFingerprint,
  toolCandidateCannotContainFingerprint,
  mcpCandidateCannotContainFingerprint,
  apiCandidateCannotContainFingerprint,
  promptCandidateCannotContainFingerprint,
  knowledgeBaseCandidateCannotContainFingerprint,
  skillCandidateCannotContainCanonicalId,
  skillCandidateCannotContainFingerprint,
  skillCandidateCannotContainProfile,
  skillCandidateCannotContainRevision,
];

// @ts-expect-error PromptRevision is not a canonical object kind in V1A.1d.
const promptRevisionCannotBeCanonical: CanonicalObjectKind = "PROMPT_REVISION";
void promptRevisionCannotBeCanonical;

const relationshipTypes: readonly GovernedRelationshipType[] = [
  GOVERNED_RELATIONSHIP_TYPE.USES_MODEL,
  GOVERNED_RELATIONSHIP_TYPE.USES_TOOL,
  GOVERNED_RELATIONSHIP_TYPE.USES_MCP,
  GOVERNED_RELATIONSHIP_TYPE.INVOKES,
  GOVERNED_RELATIONSHIP_TYPE.USES_PROMPT,
  GOVERNED_RELATIONSHIP_TYPE.USES_KNOWLEDGE_BASE,
  GOVERNED_RELATIONSHIP_TYPE.USES_SKILL,
  GOVERNED_RELATIONSHIP_TYPE.EXPOSES,
  GOVERNED_RELATIONSHIP_TYPE.HANDOFF_TO,
  GOVERNED_RELATIONSHIP_TYPE.READS_FROM,
  GOVERNED_RELATIONSHIP_TYPE.WRITES_TO,
  GOVERNED_RELATIONSHIP_TYPE.DERIVED_FROM,
];
void relationshipTypes;

// @ts-expect-error Governed relationships remain associations, not objects.
const relationshipTypeCannotBeObjectKind: CanonicalObjectKind = "USES_MODEL";
// @ts-expect-error CONTAINS is not a governed relationship type.
const containsCannotBeGoverned: GovernedRelationshipType = "CONTAINS";
// @ts-expect-error Version-specific handoff is not in V1A.1e.
const handoffVersionCannotBeGoverned: GovernedRelationshipType =
  "HANDOFF_TO_VERSION";
// @ts-expect-error Relationship candidates are never merged canonically.
const relationshipMergeCannotBeOutcome: RelationshipReconciliationOutcome =
  "MERGE_CANDIDATES";
void [
  relationshipTypeCannotBeObjectKind,
  containsCannotBeGoverned,
  handoffVersionCannotBeGoverned,
  relationshipMergeCannotBeOutcome,
];

const relationshipId: RelationshipId = asRelationshipId("relationship:one");
const relationshipStateId: RelationshipStateId = asRelationshipStateId(
  "relationship-state:one",
);
// @ts-expect-error Logical relationship and temporal-state IDs are distinct.
const relationshipCannotUseStateId: RelationshipId = relationshipStateId;
// @ts-expect-error Temporal-state ID cannot use a logical relationship ID.
const stateCannotUseRelationshipId: RelationshipStateId = relationshipId;
void [relationshipCannotUseStateId, stateCannotUseRelationshipId];

const relationshipOrganisationId = asOrganisationId(
  "organisation:identity-type-test",
);
const emptyRelationshipSupport: RelationshipSupport = {
  assertionIds: [],
  evidenceIds: [],
};
const behaviorBindingSupport: BehaviorBindingSupport = {
  relationship: {
    assertionIds: [asSourceAssertionId("assertion:relationship")],
    evidenceIds: [],
  },
  boundTechnicalFingerprint: {
    assertionIds: [asSourceAssertionId("assertion:binding:fingerprint")],
    evidenceIds: [asEvidenceId("evidence:binding:fingerprint")],
  },
  bindingConfiguration: {
    configurationHash: emptyRelationshipSupport,
    configurationLocator: emptyRelationshipSupport,
  },
};
const bindingConfiguration: BehaviorBindingConfigurationReference = {
  configurationHash: evidenceHash,
  configurationLocator: sanitizeTechnicalLocator("bindings/config.yaml"),
};
const relationshipStateBase = {
  relationshipId,
  relationshipStateId,
  organisationId: relationshipOrganisationId,
  validFrom: asIsoTimestamp("2026-08-31T12:00:00.000Z"),
  recordedAt: asIsoTimestamp("2026-08-31T12:00:00.000Z"),
} as const;

const usesModelDraft: GovernedRelationshipDraft<"USES_MODEL"> = {
  ...relationshipStateBase,
  relationshipType: "USES_MODEL",
  source: agentVersionIdentity,
  target: modelIdentity,
  boundTechnicalFingerprint: technicalFingerprint,
  bindingConfiguration,
  support: behaviorBindingSupport,
};
const usesToolDraft: GovernedRelationshipDraft<"USES_TOOL"> = {
  ...relationshipStateBase,
  relationshipType: "USES_TOOL",
  source: agentVersionIdentity,
  target: toolIdentity,
  boundTechnicalFingerprint: technicalFingerprint,
  support: behaviorBindingSupport,
};
const usesMcpDraft: GovernedRelationshipDraft<"USES_MCP"> = {
  ...relationshipStateBase,
  relationshipType: "USES_MCP",
  source: agentVersionIdentity,
  target: mcpServerIdentity,
  boundTechnicalFingerprint: technicalFingerprint,
  support: behaviorBindingSupport,
};
const invokesDraft: GovernedRelationshipDraft<"INVOKES"> = {
  ...relationshipStateBase,
  relationshipType: "INVOKES",
  source: agentVersionIdentity,
  target: apiIdentity,
  boundTechnicalFingerprint: technicalFingerprint,
  support: behaviorBindingSupport,
};
const usesPromptDraft: GovernedRelationshipDraft<"USES_PROMPT"> = {
  ...relationshipStateBase,
  relationshipType: "USES_PROMPT",
  source: agentVersionIdentity,
  target: promptIdentity,
  boundTechnicalFingerprint: technicalFingerprint,
  support: behaviorBindingSupport,
};
const usesKnowledgeBaseDraft: GovernedRelationshipDraft<"USES_KNOWLEDGE_BASE"> = {
  ...relationshipStateBase,
  relationshipType: "USES_KNOWLEDGE_BASE",
  source: agentVersionIdentity,
  target: knowledgeBaseIdentity,
  boundTechnicalFingerprint: technicalFingerprint,
  support: behaviorBindingSupport,
};
const usesSkillDraft: GovernedRelationshipDraft<"USES_SKILL"> = {
  ...relationshipStateBase,
  relationshipType: "USES_SKILL",
  source: agentVersionIdentity,
  target: skillIdentity,
  boundTechnicalFingerprint: technicalFingerprint,
  support: behaviorBindingSupport,
};
const exposesDraft: GovernedRelationshipDraft<"EXPOSES"> = {
  ...relationshipStateBase,
  relationshipType: "EXPOSES",
  source: mcpServerIdentity,
  target: toolIdentity,
  support: emptyRelationshipSupport,
};
const handoffDraft: GovernedRelationshipDraft<"HANDOFF_TO"> = {
  ...relationshipStateBase,
  relationshipType: "HANDOFF_TO",
  source: agentVersionIdentity,
  target: agentIdentity,
  support: emptyRelationshipSupport,
};
const readsAssetDraft: GovernedRelationshipDraft<"READS_FROM"> = {
  ...relationshipStateBase,
  relationshipType: "READS_FROM",
  source: agentVersionIdentity,
  target: dataAssetIdentity,
  support: emptyRelationshipSupport,
};
const readsElementDraft: GovernedRelationshipDraft<"READS_FROM"> = {
  ...readsAssetDraft,
  target: dataElementIdentity,
};
const writesAssetDraft: GovernedRelationshipDraft<"WRITES_TO"> = {
  ...relationshipStateBase,
  relationshipType: "WRITES_TO",
  source: agentVersionIdentity,
  target: dataAssetIdentity,
  support: emptyRelationshipSupport,
};
const writesElementDraft: GovernedRelationshipDraft<"WRITES_TO"> = {
  ...writesAssetDraft,
  target: dataElementIdentity,
};
const derivedFromDraft: GovernedRelationshipDraft<"DERIVED_FROM"> = {
  ...relationshipStateBase,
  relationshipType: "DERIVED_FROM",
  source: dataElementIdentity,
  target: {
    ...dataElementIdentity,
    canonicalObject: {
      ...dataElementIdentity.canonicalObject,
      objectId: asCanonicalObjectId("canonical:data-element:origin"),
    },
    dataElementId: asDataElementId("data-element:origin"),
  },
  transformation: {
    reference: sanitizeTechnicalLocator("transformations/customer.sql"),
    hash: evidenceHash,
    support: {
      reference: emptyRelationshipSupport,
      hash: emptyRelationshipSupport,
    },
  },
  support: emptyRelationshipSupport,
};
void [
  usesModelDraft,
  usesToolDraft,
  usesMcpDraft,
  invokesDraft,
  usesPromptDraft,
  usesKnowledgeBaseDraft,
  usesSkillDraft,
  exposesDraft,
  handoffDraft,
  readsAssetDraft,
  readsElementDraft,
  writesAssetDraft,
  writesElementDraft,
  derivedFromDraft,
];

const {
  relationshipId: omittedRelationshipId,
  ...stateWithoutRelationshipIdValue
} = usesSkillDraft;
// @ts-expect-error CREATE_NEW state requires allocated RelationshipId.
const stateWithoutRelationshipId: GovernedRelationshipDraft<"USES_SKILL"> =
  stateWithoutRelationshipIdValue;
const {
  relationshipStateId: omittedRelationshipStateId,
  ...stateWithoutRelationshipStateIdValue
} = usesSkillDraft;
// @ts-expect-error CREATE_NEW state requires allocated RelationshipStateId.
const stateWithoutRelationshipStateId: GovernedRelationshipDraft<"USES_SKILL"> =
  stateWithoutRelationshipStateIdValue;
void [
  omittedRelationshipId,
  stateWithoutRelationshipId,
  omittedRelationshipStateId,
  stateWithoutRelationshipStateId,
];

const invalidUsesModelTarget: GovernedRelationshipDraft<"USES_MODEL"> = {
  ...usesModelDraft,
  // @ts-expect-error USES_MODEL accepts only a Model target.
  target: toolIdentity,
};
// @ts-expect-error Every behavior binding requires a pinned fingerprint.
const bindingWithoutFingerprint: GovernedRelationshipDraft<"USES_SKILL"> = {
  ...relationshipStateBase,
  relationshipType: "USES_SKILL",
  source: agentVersionIdentity,
  target: skillIdentity,
  support: behaviorBindingSupport,
};
const bindingCannotUseEvidenceHash: GovernedRelationshipDraft<"USES_SKILL"> = {
  ...usesSkillDraft,
  // @ts-expect-error EvidenceHash is artifact integrity, not technical identity.
  boundTechnicalFingerprint: evidenceHash,
};
const handoffCannotTargetVersion: GovernedRelationshipDraft<"HANDOFF_TO"> = {
  ...handoffDraft,
  // @ts-expect-error HANDOFF_TO targets the logical Agent.
  target: agentVersionIdentity,
};
const exposesCannotTargetAgent: GovernedRelationshipDraft<"EXPOSES"> = {
  ...exposesDraft,
  // @ts-expect-error EXPOSES is MCP_SERVER to TOOL only.
  target: agentIdentity,
};
const lineageCannotUseAsset: GovernedRelationshipDraft<"DERIVED_FROM"> = {
  ...derivedFromDraft,
  // @ts-expect-error Canonical lineage is DataElement to DataElement.
  source: dataAssetIdentity,
};
const lineageCannotUseEmptyTransformation: GovernedRelationshipDraft<"DERIVED_FROM"> = {
  ...derivedFromDraft,
  // @ts-expect-error Transformation requires a sanitized reference or hash.
  transformation: {
    support: {
      reference: emptyRelationshipSupport,
      hash: emptyRelationshipSupport,
    },
  },
};
const lineageCannotContainRawSql: GovernedRelationshipDraft<"DERIVED_FROM"> = {
  ...derivedFromDraft,
  transformation: {
    reference: sanitizeTechnicalLocator("transformations/customer.sql"),
    support: {
      reference: emptyRelationshipSupport,
      hash: emptyRelationshipSupport,
    },
    // @ts-expect-error Raw transformation content is evidence, not relationship state.
    rawSql: "select * from customer",
  },
};
const relationshipCannotUseCandidateEndpoint: GovernedRelationshipDraft<"USES_MODEL"> = {
  ...usesModelDraft,
  // @ts-expect-error Pre-canonical candidate references are not endpoints.
  source: agentVersionCandidate.proposedIdentity.agent,
};
void [
  invalidUsesModelTarget,
  bindingWithoutFingerprint,
  bindingCannotUseEvidenceHash,
  handoffCannotTargetVersion,
  exposesCannotTargetAgent,
  lineageCannotUseAsset,
  lineageCannotUseEmptyTransformation,
  lineageCannotContainRawSql,
  relationshipCannotUseCandidateEndpoint,
];

// @ts-expect-error All explicit binding-configuration support keys are required.
const incompleteBindingSupport: BehaviorBindingSupport = {
  relationship: emptyRelationshipSupport,
  boundTechnicalFingerprint: emptyRelationshipSupport,
};
// @ts-expect-error Configuration reference always requires its integrity hash.
const configurationWithoutHash: BehaviorBindingConfigurationReference = {
  configurationLocator: sanitizeTechnicalLocator("bindings/config.yaml"),
};
const configurationCannotUseRawLocator: BehaviorBindingConfigurationReference = {
  configurationHash: evidenceHash,
  // @ts-expect-error Locator must cross the sanitizer boundary.
  configurationLocator: "https://user:secret@example.invalid/config?token=x",
};
const configurationCannotContainParameters: BehaviorBindingConfigurationReference = {
  ...bindingConfiguration,
  // @ts-expect-error Generic configuration/parameter bags are forbidden.
  parameters: { temperature: 0.7 },
};
void [
  incompleteBindingSupport,
  configurationWithoutHash,
  configurationCannotUseRawLocator,
  configurationCannotContainParameters,
];

const relationshipCannotClaimTrust: GovernedRelationshipDraft<"EXPOSES"> = {
  ...exposesDraft,
  // @ts-expect-error Trust remains on SourceAssertion.
  trustState: "VALIDATED",
};
const relationshipCannotAggregateConfidence: GovernedRelationshipDraft<"EXPOSES"> = {
  ...exposesDraft,
  // @ts-expect-error Confidence remains on discovery/provenance artifacts.
  confidence: 1,
};
const relationshipCannotContainMetadata: GovernedRelationshipDraft<"EXPOSES"> = {
  ...exposesDraft,
  // @ts-expect-error Generic metadata bags are outside the contract.
  metadata: { arbitrary: true },
};
void [
  relationshipCannotClaimTrust,
  relationshipCannotAggregateConfidence,
  relationshipCannotContainMetadata,
];

const relationshipDecisionBase = {
  decisionId: asReconciliationDecisionId("relationship-decision:one"),
  organisationId: relationshipOrganisationId,
  relationshipCandidateId: usesSkillRelationshipCandidate.candidateId,
  relationshipCandidate: usesSkillRelationshipCandidate,
  authority: humanAuthority,
  reasonCode: "HUMAN_REVIEW",
  assertionIds: [candidateAssertionId],
  evidenceIds: [candidateEvidenceId],
  decidedAt: asIsoTimestamp("2026-08-31T13:00:00.000Z"),
} as const;
const createRelationshipDecision = createRelationshipReconciliationDecision({
  ...relationshipDecisionBase,
  outcome: "CREATE_NEW",
  authorizedState: usesSkillDraft,
});
const finalSourceRelationshipTypeCode: string =
  createRelationshipDecision.relationshipTypeCode;
const successfulCanonicalRelationshipType: GovernedRelationshipType =
  createRelationshipDecision.authorizedState.relationshipType;
const canonicalUsesSkill: UsesSkillRelationship = createGovernedRelationship(
  createRelationshipDecision,
  usesSkillDraft,
);
const brandedRelationship: GovernedRelationship = canonicalUsesSkill;
// @ts-expect-error A draft is not yet an authorized governed relationship.
const draftCannotBeCanonicalRelationship: GovernedRelationship = usesSkillDraft;
void [
  createRelationshipDecision,
  canonicalUsesSkill,
  brandedRelationship,
  draftCannotBeCanonicalRelationship,
  finalSourceRelationshipTypeCode,
  successfulCanonicalRelationshipType,
];

const {
  relationshipCandidate: omittedRelationshipCandidateContext,
  ...relationshipDecisionWithoutCandidateContext
} = relationshipDecisionBase;
// @ts-expect-error Relationship decisions require the actual candidate context.
const decisionWithoutCandidateContext: CreateNewRelationshipReconciliationDecisionDraft<"USES_SKILL"> = {
  ...relationshipDecisionWithoutCandidateContext,
  outcome: "CREATE_NEW",
  authorizedState: usesSkillDraft,
};
void [omittedRelationshipCandidateContext, decisionWithoutCandidateContext];

// @ts-expect-error CREATE_NEW requires an authorized state with IDs/endpoints.
const createDecisionWithoutState: CreateNewRelationshipReconciliationDecisionDraft = {
  ...relationshipDecisionBase,
  outcome: "CREATE_NEW",
};
const matchedState: RelationshipMatchReference<"USES_SKILL"> = {
  relationshipId,
  relationshipStateId,
  organisationId: relationshipOrganisationId,
  relationshipType: "USES_SKILL",
  source: agentVersionIdentity,
  target: skillIdentity,
};
const {
  relationshipStateId: omittedMatchedStateId,
  ...matchWithoutStateIdValue
} = matchedState;
// @ts-expect-error MATCH_EXISTING must reference the exact temporal state.
const matchReferenceWithoutStateId: RelationshipMatchReference<"USES_SKILL"> =
  matchWithoutStateIdValue;
const matchRelationshipDecision: MatchExistingRelationshipReconciliationDecision<"USES_SKILL"> =
  createRelationshipReconciliationDecision({
    ...relationshipDecisionBase,
    outcome: "MATCH_EXISTING",
    matchedState,
  });
// @ts-expect-error MATCH_EXISTING requires the exact state reference.
const matchWithoutState: MatchExistingRelationshipReconciliationDecisionDraft = {
  ...relationshipDecisionBase,
  outcome: "MATCH_EXISTING",
};
const rejectDraft: RejectRelationshipReconciliationDecisionDraft = {
  ...relationshipDecisionBase,
  outcome: "REJECT",
};
const deferDraft: DeferRelationshipReconciliationDecisionDraft = {
  ...relationshipDecisionBase,
  outcome: "DEFER",
};
const rejectCannotReferenceRelationship: RejectRelationshipReconciliationDecisionDraft = {
  ...rejectDraft,
  // @ts-expect-error REJECT cannot reference a canonical relationship ID.
  relationshipId,
};
const deferCannotReferenceState: DeferRelationshipReconciliationDecisionDraft = {
  ...deferDraft,
  // @ts-expect-error DEFER cannot reference a canonical relationship state.
  relationshipStateId,
};
void [
  createDecisionWithoutState,
  omittedMatchedStateId,
  matchReferenceWithoutStateId,
  matchRelationshipDecision,
  matchWithoutState,
  rejectDraft,
  deferDraft,
  rejectCannotReferenceRelationship,
  deferCannotReferenceState,
];

const candidateCannotCreateRelationship: HandoffToRelationship =
  createGovernedRelationship(
    // @ts-expect-error Discovery candidates cannot bypass relationship decisions.
    relationshipCandidate,
    handoffDraft,
  );
void candidateCannotCreateRelationship;
