import {
  CANONICAL_OBJECT_KIND,
  type ApiIdentity,
  type CanonicalObjectIdentity,
  type CanonicalObjectKind,
  type DataAssetIdentity,
  type DataElementIdentity,
  type Evidence,
  type InboundAdapterEnvelope,
  type KnowledgeBaseIdentity,
  type McpServerIdentity,
  type ModelIdentity,
  type PromptIdentity,
  type SourceAssertion,
  type ToolIdentity,
} from "./contracts.ts";
import { githubRepositoryDiscoveryFixture } from "./fixtures.ts";
import {
  asApiId,
  asCanonicalObjectId,
  asDataAssetId,
  asDataElementId,
  asKnowledgeBaseId,
  asMcpServerId,
  asModelId,
  asOrganisationId,
  asPromptId,
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
