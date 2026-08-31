declare const opaqueIdentifierBrand: unique symbol;

type OpaqueIdentifier<Name extends string> = string & {
  readonly [opaqueIdentifierBrand]: Name;
};

export type OrganisationId = OpaqueIdentifier<"OrganisationId">;
export type CanonicalObjectId = OpaqueIdentifier<"CanonicalObjectId">;
export type AgentId = OpaqueIdentifier<"AgentId">;
export type AgentVersionId = OpaqueIdentifier<"AgentVersionId">;
export type ModelId = OpaqueIdentifier<"ModelId">;
export type ToolId = OpaqueIdentifier<"ToolId">;
export type McpServerId = OpaqueIdentifier<"McpServerId">;
export type ApiId = OpaqueIdentifier<"ApiId">;
export type PromptId = OpaqueIdentifier<"PromptId">;
export type KnowledgeBaseId = OpaqueIdentifier<"KnowledgeBaseId">;
export type DataAssetId = OpaqueIdentifier<"DataAssetId">;
export type DataElementId = OpaqueIdentifier<"DataElementId">;
export type SourceSystemId = OpaqueIdentifier<"SourceSystemId">;
export type SourceConnectionId = OpaqueIdentifier<"SourceConnectionId">;
export type AcquisitionRunId = OpaqueIdentifier<"AcquisitionRunId">;
export type SourceSnapshotId = OpaqueIdentifier<"SourceSnapshotId">;
export type SourceAssertionId = OpaqueIdentifier<"SourceAssertionId">;
export type DiscoveryFindingId = OpaqueIdentifier<"DiscoveryFindingId">;
export type EvidenceId = OpaqueIdentifier<"EvidenceId">;
export type ObjectSourceMappingId = OpaqueIdentifier<"ObjectSourceMappingId">;
export type NormalizedCandidateId = OpaqueIdentifier<"NormalizedCandidateId">;
export type ExternalId = OpaqueIdentifier<"ExternalId">;
export type IsoTimestamp = OpaqueIdentifier<"IsoTimestamp">;
export type SanitizedEvidenceLocator = OpaqueIdentifier<"SanitizedEvidenceLocator">;

function asNonEmptyOpaque<Name extends string>(
  value: string,
  label: Name,
): OpaqueIdentifier<Name> {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }

  return value as OpaqueIdentifier<Name>;
}

export const asOrganisationId = (value: string): OrganisationId =>
  asNonEmptyOpaque(value, "OrganisationId");
export const asCanonicalObjectId = (value: string): CanonicalObjectId =>
  asNonEmptyOpaque(value, "CanonicalObjectId");
export const asAgentId = (value: string): AgentId =>
  asNonEmptyOpaque(value, "AgentId");
export const asAgentVersionId = (value: string): AgentVersionId =>
  asNonEmptyOpaque(value, "AgentVersionId");
export const asModelId = (value: string): ModelId =>
  asNonEmptyOpaque(value, "ModelId");
export const asToolId = (value: string): ToolId =>
  asNonEmptyOpaque(value, "ToolId");
export const asMcpServerId = (value: string): McpServerId =>
  asNonEmptyOpaque(value, "McpServerId");
export const asApiId = (value: string): ApiId =>
  asNonEmptyOpaque(value, "ApiId");
export const asPromptId = (value: string): PromptId =>
  asNonEmptyOpaque(value, "PromptId");
export const asKnowledgeBaseId = (value: string): KnowledgeBaseId =>
  asNonEmptyOpaque(value, "KnowledgeBaseId");
export const asDataAssetId = (value: string): DataAssetId =>
  asNonEmptyOpaque(value, "DataAssetId");
export const asDataElementId = (value: string): DataElementId =>
  asNonEmptyOpaque(value, "DataElementId");
export const asSourceSystemId = (value: string): SourceSystemId =>
  asNonEmptyOpaque(value, "SourceSystemId");
export const asSourceConnectionId = (value: string): SourceConnectionId =>
  asNonEmptyOpaque(value, "SourceConnectionId");
export const asAcquisitionRunId = (value: string): AcquisitionRunId =>
  asNonEmptyOpaque(value, "AcquisitionRunId");
export const asSourceSnapshotId = (value: string): SourceSnapshotId =>
  asNonEmptyOpaque(value, "SourceSnapshotId");
export const asSourceAssertionId = (value: string): SourceAssertionId =>
  asNonEmptyOpaque(value, "SourceAssertionId");
export const asDiscoveryFindingId = (value: string): DiscoveryFindingId =>
  asNonEmptyOpaque(value, "DiscoveryFindingId");
export const asEvidenceId = (value: string): EvidenceId =>
  asNonEmptyOpaque(value, "EvidenceId");
export const asObjectSourceMappingId = (value: string): ObjectSourceMappingId =>
  asNonEmptyOpaque(value, "ObjectSourceMappingId");
export const asNormalizedCandidateId = (value: string): NormalizedCandidateId =>
  asNonEmptyOpaque(value, "NormalizedCandidateId");
export const asExternalId = (value: string): ExternalId =>
  asNonEmptyOpaque(value, "ExternalId");

export function asIsoTimestamp(value: string): IsoTimestamp {
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError("IsoTimestamp must be a valid date-time string");
  }

  return value as IsoTimestamp;
}

/**
 * Produces a display-safe locator. URL credentials, query parameters, and
 * fragments are intentionally removed because they may contain secrets.
 * This helper sanitizes location metadata; it never makes raw content safe.
 */
export function sanitizeEvidenceLocator(value: string): SanitizedEvidenceLocator {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError("Evidence locator must be a non-empty string");
  }

  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString() as SanitizedEvidenceLocator;
  } catch {
    return trimmed.split(/[?#]/, 1)[0] as SanitizedEvidenceLocator;
  }
}
