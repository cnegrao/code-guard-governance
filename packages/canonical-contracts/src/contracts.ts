import type {
  AcquisitionRunId,
  AgentId,
  AgentVersionId,
  ApiId,
  BusinessDomainId,
  BusinessTermId,
  CandidateMergeId,
  CanonicalObjectId,
  DataAssetId,
  DataElementId,
  DataElementSemanticConceptAssignmentCandidateId,
  DataElementSemanticConceptAssignmentId,
  DataElementSemanticConceptAssignmentStateId,
  DataKeyDefinitionId,
  DiscoveryFindingId,
  EvidenceId,
  ExternalId,
  ForeignKeyDefinitionId,
  IsoTimestamp,
  InformationDomainId,
  KnowledgeBaseId,
  McpServerId,
  ModelId,
  NormalizedCandidateId,
  ObjectSourceMappingId,
  OrganisationId,
  PromptId,
  ReconciliationDecisionId,
  RelationshipId,
  RelationshipStateId,
  SanitizedEvidenceLocator,
  SanitizedTechnicalLocator,
  SemanticConceptId,
  SkillId,
  SourceAssertionId,
  SourceConnectionId,
  SourceSnapshotId,
  SourceSystemId,
  ToolId,
} from "./identifiers.ts";
import { sanitizeTechnicalLocator } from "./identifiers.ts";

export const SUPPORTED_CANONICAL_CONTRACT_VERSIONS = ["1.0", "1.1"] as const;
export type CanonicalContractVersion =
  (typeof SUPPORTED_CANONICAL_CONTRACT_VERSIONS)[number];
export const CANONICAL_CONTRACT_VERSION =
  "1.1" as const satisfies CanonicalContractVersion;

export const SOURCE_FAMILY = {
  REPOSITORY: "REPOSITORY",
  CATALOG: "CATALOG",
  BUILD_METADATA: "BUILD_METADATA",
  IDENTITY: "IDENTITY",
  CLOUD: "CLOUD",
  RUNTIME: "RUNTIME",
  OTHER: "OTHER",
} as const;
export type SourceFamily = (typeof SOURCE_FAMILY)[keyof typeof SOURCE_FAMILY];

export const PROVIDER_RESOLUTION = {
  EXPLICIT: "EXPLICIT",
  INFERRED: "INFERRED",
  UNKNOWN: "UNKNOWN",
} as const;
export type ProviderResolution =
  (typeof PROVIDER_RESOLUTION)[keyof typeof PROVIDER_RESOLUTION];

export const ACQUISITION_MODE = {
  FULL: "FULL",
  INCREMENTAL: "INCREMENTAL",
} as const;
export type AcquisitionMode =
  (typeof ACQUISITION_MODE)[keyof typeof ACQUISITION_MODE];

export const ACQUISITION_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type AcquisitionStatus =
  (typeof ACQUISITION_STATUS)[keyof typeof ACQUISITION_STATUS];

/**
 * INFERRED is the single canonical trust state for scanner/discovery
 * conclusions. "Discovered" describes the process/finding lifecycle, not a
 * second trust level with the same meaning.
 */
export const TRUST_STATE = {
  INFERRED: "INFERRED",
  DECLARED: "DECLARED",
  IMPORTED: "IMPORTED",
  OBSERVED: "OBSERVED",
  VALIDATED: "VALIDATED",
} as const;
export type TrustState = (typeof TRUST_STATE)[keyof typeof TRUST_STATE];

export const FINDING_REVIEW_STATUS = {
  UNREVIEWED: "UNREVIEWED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  DUPLICATE: "DUPLICATE",
  SUPERSEDED: "SUPERSEDED",
} as const;
export type FindingReviewStatus =
  (typeof FINDING_REVIEW_STATUS)[keyof typeof FINDING_REVIEW_STATUS];

export const EVIDENCE_HANDLING = {
  HASH_ONLY: "HASH_ONLY",
  REDACTED: "REDACTED",
  NON_SENSITIVE: "NON_SENSITIVE",
} as const;
export type EvidenceHandling =
  (typeof EVIDENCE_HANDLING)[keyof typeof EVIDENCE_HANDLING];

export const EVIDENCE_LOCATION_KIND = {
  REPOSITORY: "REPOSITORY",
  SOURCE_OBJECT: "SOURCE_OBJECT",
  URI: "URI",
  SYMBOL: "SYMBOL",
  OTHER: "OTHER",
} as const;
export type EvidenceLocationKind =
  (typeof EVIDENCE_LOCATION_KIND)[keyof typeof EVIDENCE_LOCATION_KIND];

export const OBJECT_SOURCE_MAPPING_STATUS = {
  PROPOSED: "PROPOSED",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  SUPERSEDED: "SUPERSEDED",
} as const;
export type ObjectSourceMappingStatus =
  (typeof OBJECT_SOURCE_MAPPING_STATUS)[keyof typeof OBJECT_SOURCE_MAPPING_STATUS];

export const OBJECT_SOURCE_MATCH_METHOD = {
  MANUAL: "MANUAL",
  EXTERNAL_ID: "EXTERNAL_ID",
  DETERMINISTIC: "DETERMINISTIC",
  HEURISTIC: "HEURISTIC",
} as const;
export type ObjectSourceMatchMethod =
  (typeof OBJECT_SOURCE_MATCH_METHOD)[keyof typeof OBJECT_SOURCE_MATCH_METHOD];

/** V1A.1 is deliberately closed to these eleven governed technical kinds. */
export const CANONICAL_OBJECT_KIND = {
  AGENT: "AGENT",
  AGENT_VERSION: "AGENT_VERSION",
  MODEL: "MODEL",
  TOOL: "TOOL",
  MCP_SERVER: "MCP_SERVER",
  API: "API",
  PROMPT: "PROMPT",
  KNOWLEDGE_BASE: "KNOWLEDGE_BASE",
  DATA_ASSET: "DATA_ASSET",
  DATA_ELEMENT: "DATA_ELEMENT",
  SKILL: "SKILL",
} as const;
export type CanonicalObjectKind =
  (typeof CANONICAL_OBJECT_KIND)[keyof typeof CANONICAL_OBJECT_KIND];

/** RELATIONSHIP is discovery-only and is never a canonical object kind. */
export type DiscoveryCandidateKind = CanonicalObjectKind | "RELATIONSHIP";

export const DATA_ASSET_STRUCTURAL_KIND = {
  TABLE: "TABLE",
  VIEW: "VIEW",
  MATERIALIZED_VIEW: "MATERIALIZED_VIEW",
  DATASET: "DATASET",
  FILE: "FILE",
  STREAM: "STREAM",
  COLLECTION: "COLLECTION",
  OTHER: "OTHER",
} as const;
export type DataAssetStructuralKind =
  (typeof DATA_ASSET_STRUCTURAL_KIND)[keyof typeof DATA_ASSET_STRUCTURAL_KIND];

export const NORMALIZED_DATA_TYPE_FAMILY = {
  UNKNOWN: "UNKNOWN",
  BOOLEAN: "BOOLEAN",
  INTEGER: "INTEGER",
  DECIMAL: "DECIMAL",
  FLOAT: "FLOAT",
  STRING: "STRING",
  BINARY: "BINARY",
  DATE: "DATE",
  TIME: "TIME",
  TIMESTAMP: "TIMESTAMP",
  INTERVAL: "INTERVAL",
  IDENTIFIER: "IDENTIFIER",
  SEMI_STRUCTURED: "SEMI_STRUCTURED",
  ARRAY: "ARRAY",
  MAP: "MAP",
  STRUCT: "STRUCT",
  VECTOR: "VECTOR",
  OTHER: "OTHER",
} as const;
export type NormalizedDataTypeFamily =
  (typeof NORMALIZED_DATA_TYPE_FAMILY)[keyof typeof NORMALIZED_DATA_TYPE_FAMILY];

export const TIME_ZONE_SEMANTICS = {
  NOT_APPLICABLE: "NOT_APPLICABLE",
  UNKNOWN: "UNKNOWN",
  WITHOUT_TIME_ZONE: "WITHOUT_TIME_ZONE",
  WITH_TIME_ZONE: "WITH_TIME_ZONE",
} as const;
export type TimeZoneSemantics =
  (typeof TIME_ZONE_SEMANTICS)[keyof typeof TIME_ZONE_SEMANTICS];

export const NULLABILITY_STATE = {
  UNKNOWN: "UNKNOWN",
  NULLABLE: "NULLABLE",
  NOT_NULLABLE: "NOT_NULLABLE",
} as const;
export type NullabilityState =
  (typeof NULLABILITY_STATE)[keyof typeof NULLABILITY_STATE];

export const DEFAULT_VALUE_STATE = {
  UNKNOWN: "UNKNOWN",
  ABSENT: "ABSENT",
  PRESENT: "PRESENT",
} as const;
export type DefaultValueState =
  (typeof DEFAULT_VALUE_STATE)[keyof typeof DEFAULT_VALUE_STATE];

export const VALUE_GENERATION_STATE = {
  UNKNOWN: "UNKNOWN",
  NOT_GENERATED: "NOT_GENERATED",
  GENERATED: "GENERATED",
} as const;
export type ValueGenerationState =
  (typeof VALUE_GENERATION_STATE)[keyof typeof VALUE_GENERATION_STATE];

export const DATA_KEY_TYPE = {
  PRIMARY_KEY: "PRIMARY_KEY",
  UNIQUE_KEY: "UNIQUE_KEY",
} as const;
export type DataKeyType = (typeof DATA_KEY_TYPE)[keyof typeof DATA_KEY_TYPE];

export const MCP_TRANSPORT = {
  UNKNOWN: "UNKNOWN",
  STDIO: "STDIO",
  STREAMABLE_HTTP: "STREAMABLE_HTTP",
  SERVER_SENT_EVENTS: "SERVER_SENT_EVENTS",
  OTHER: "OTHER",
} as const;
export type McpTransport =
  (typeof MCP_TRANSPORT)[keyof typeof MCP_TRANSPORT];

export const API_PROTOCOL_FAMILY = {
  UNKNOWN: "UNKNOWN",
  HTTP: "HTTP",
  GRPC: "GRPC",
  GRAPHQL: "GRAPHQL",
  WEBSOCKET: "WEBSOCKET",
  EVENT: "EVENT",
  OTHER: "OTHER",
} as const;
export type ApiProtocolFamily =
  (typeof API_PROTOCOL_FAMILY)[keyof typeof API_PROTOCOL_FAMILY];

export const KNOWLEDGE_BASE_RESOURCE_KIND = {
  UNKNOWN: "UNKNOWN",
  DOCUMENT_COLLECTION: "DOCUMENT_COLLECTION",
  SEARCH_INDEX: "SEARCH_INDEX",
  VECTOR_INDEX: "VECTOR_INDEX",
  KNOWLEDGE_GRAPH: "KNOWLEDGE_GRAPH",
  OTHER: "OTHER",
} as const;
export type KnowledgeBaseResourceKind =
  (typeof KNOWLEDGE_BASE_RESOURCE_KIND)[keyof typeof KNOWLEDGE_BASE_RESOURCE_KIND];

export type SourceAttributeValue =
  | string
  | number
  | boolean
  | null
  | readonly SourceAttributeValue[]
  | { readonly [key: string]: SourceAttributeValue };

export interface ProviderReference {
  /** Opaque metadata from the source boundary, never a canonical object kind. */
  readonly providerCode: string | null;
  readonly resolution: ProviderResolution;
}

export function providerReference(
  providerCode: string | null | undefined,
  resolution?: Exclude<ProviderResolution, "UNKNOWN">,
): ProviderReference {
  const normalized = providerCode?.trim();
  if (!normalized) {
    return { providerCode: null, resolution: PROVIDER_RESOLUTION.UNKNOWN };
  }

  return {
    providerCode: normalized,
    resolution: resolution ?? PROVIDER_RESOLUTION.EXPLICIT,
  };
}

export interface SourceSystem {
  readonly sourceSystemId: SourceSystemId;
  readonly family: SourceFamily;
  readonly displayName: string;
  readonly provider: ProviderReference;
}

/**
 * A server-issued reference to a configured connection. Tenant binding and
 * credentials live outside the adapter payload and outside this contract.
 */
export interface SourceConnectionReference {
  readonly connectionId: SourceConnectionId;
  readonly sourceSystemId: SourceSystemId;
}

export interface AcquisitionRun {
  readonly runId: AcquisitionRunId;
  readonly connection: SourceConnectionReference;
  readonly mode: AcquisitionMode;
  readonly status: AcquisitionStatus;
  readonly adapterName: string;
  readonly adapterVersion: string;
  readonly sourceVersion?: string;
  readonly checkpoint?: string;
  readonly startedAt: IsoTimestamp;
  readonly completedAt?: IsoTimestamp;
}

/** The only V1A source-object identity: connection + externalType + externalId. */
export interface SourceObjectIdentity {
  readonly connectionId: SourceConnectionId;
  readonly externalType: string;
  readonly externalId: ExternalId;
}

export function sourceObjectIdentityKey(identity: SourceObjectIdentity): string {
  return JSON.stringify([
    identity.connectionId,
    identity.externalType,
    identity.externalId,
  ]);
}

export interface SourceObject {
  readonly identity: SourceObjectIdentity;
  readonly displayName?: string;
  readonly objectPath?: string;
  readonly parent?: SourceObjectIdentity;
  readonly sourceVersion?: string;
  readonly observedAt: IsoTimestamp;
  /** Transport convenience only; this does not define future persistence. */
  readonly attributes?: Readonly<Record<string, SourceAttributeValue>>;
}

export interface EvidenceHash {
  /** Content-integrity digest; it does not identify a technical configuration. */
  readonly algorithm: string;
  readonly value: string;
}

declare const behaviorFingerprintBrand: unique symbol;
declare const technicalFingerprintBrand: unique symbol;

/**
 * Immutable equivalence marker for resolved AgentVersion behavior. Its input
 * includes behavior-affecting code/configuration and, for a bound technical
 * target, the target kind, canonical identity, pinned TechnicalFingerprint,
 * and binding configuration. The contract deliberately provides no universal
 * serializer or hashing algorithm. It is opaque: neither canonical/runtime
 * identity, credential, EvidenceHash, nor raw content.
 */
export type BehaviorFingerprint = Readonly<{
  readonly algorithm: string;
  readonly schemaVersion: string;
  readonly value: string;
}> & {
  readonly [behaviorFingerprintBrand]: "BehaviorFingerprint";
};

/**
 * Immutable equivalence marker for one target's behavior-relevant technical
 * configuration. Canonical IDs, support/provenance, timestamps, governance,
 * secrets, and runtime metrics are excluded from its composition. It is
 * opaque: neither canonical/runtime identity, credential, EvidenceHash, nor
 * raw content. Direct fingerprint equality is meaningful only when algorithm
 * and schemaVersion are compatible.
 */
export type TechnicalFingerprint = Readonly<{
  readonly algorithm: string;
  readonly schemaVersion: string;
  readonly value: string;
}> & {
  readonly [technicalFingerprintBrand]: "TechnicalFingerprint";
};

function createFingerprint(
  draft: Readonly<{
    readonly algorithm: string;
    readonly schemaVersion: string;
    readonly value: string;
  }>,
  label: string,
): Readonly<{
  readonly algorithm: string;
  readonly schemaVersion: string;
  readonly value: string;
}> {
  for (const [field, value] of [
    ["algorithm", draft.algorithm],
    ["schemaVersion", draft.schemaVersion],
    ["value", draft.value],
  ] as const) {
    if (value.trim().length === 0) {
      throw new TypeError(`${label} ${field} must be a non-empty string`);
    }
  }

  return Object.freeze({
    algorithm: draft.algorithm,
    schemaVersion: draft.schemaVersion,
    value: draft.value,
  });
}

export function createBehaviorFingerprint(
  draft: Readonly<{
    readonly algorithm: string;
    readonly schemaVersion: string;
    readonly value: string;
  }>,
): BehaviorFingerprint {
  return createFingerprint(draft, "Behavior fingerprint") as BehaviorFingerprint;
}

export function createTechnicalFingerprint(
  draft: Readonly<{
    readonly algorithm: string;
    readonly schemaVersion: string;
    readonly value: string;
  }>,
): TechnicalFingerprint {
  return createFingerprint(draft, "Technical fingerprint") as TechnicalFingerprint;
}

export interface SourceSnapshotReference {
  readonly snapshotId: SourceSnapshotId;
  readonly sourceObject: SourceObjectIdentity;
  readonly observedAt: IsoTimestamp;
  readonly sourceVersion?: string;
  readonly contentHash: EvidenceHash;
  readonly locator?: SanitizedEvidenceLocator;
}

export interface AssertionMethod {
  readonly code: string;
  readonly version?: string;
}

export interface SourceAttributeLocator {
  readonly code: string;
  readonly path?: string;
}

export interface EffectivePeriod {
  readonly validFrom?: IsoTimestamp;
  readonly validTo?: IsoTimestamp;
}

export interface AssertionValidation {
  readonly validatedAt: IsoTimestamp;
  readonly validatorReference: string;
}

/**
 * Provenance envelope only. Canonical values belong in typed domain facts.
 * This contract intentionally has no predicate, factName, value, or valueJson.
 */
export interface SourceAssertion {
  readonly assertionId: SourceAssertionId;
  readonly sourceObject: SourceObjectIdentity;
  readonly runId: AcquisitionRunId;
  readonly snapshot?: SourceSnapshotReference;
  readonly method: AssertionMethod;
  readonly trustState: TrustState;
  readonly confidence?: number;
  readonly observedAt: IsoTimestamp;
  readonly syncedAt?: IsoTimestamp;
  readonly recordedAt: IsoTimestamp;
  readonly effectivePeriod?: EffectivePeriod;
  readonly sourceAttribute?: SourceAttributeLocator;
  readonly validation?: AssertionValidation;
  readonly evidenceIds: readonly EvidenceId[];
}

export interface EvidenceLocation {
  readonly kind: EvidenceLocationKind;
  readonly locator: SanitizedEvidenceLocator;
  readonly path?: string;
  readonly commit?: string;
  readonly symbol?: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
}

/**
 * Evidence exposes only locators, hashes, and an explicitly redacted excerpt.
 * Raw sensitive values and secrets have no field in this contract.
 */
export interface Evidence {
  readonly evidenceId: EvidenceId;
  readonly handling: EvidenceHandling;
  readonly locations: readonly EvidenceLocation[];
  readonly hashes: readonly EvidenceHash[];
  readonly redactedExcerpt?: string;
  readonly capturedAt: IsoTimestamp;
}

export interface EvidenceDraft {
  readonly evidenceId: EvidenceId;
  readonly handling: EvidenceHandling;
  readonly locations?: readonly EvidenceLocation[];
  readonly hashes?: readonly EvidenceHash[];
  readonly redactedExcerpt?: string;
  readonly capturedAt: IsoTimestamp;
}

/** Copies only the evidence allowlist, dropping any accidental extra fields. */
export function createEvidence(draft: EvidenceDraft): Evidence {
  const evidence: Evidence = {
    evidenceId: draft.evidenceId,
    handling: draft.handling,
    locations: Object.freeze([...(draft.locations ?? [])]),
    hashes: Object.freeze([...(draft.hashes ?? [])]),
    capturedAt: draft.capturedAt,
    ...(draft.redactedExcerpt === undefined
      ? {}
      : { redactedExcerpt: draft.redactedExcerpt }),
  };

  return Object.freeze(evidence);
}

export interface DiscoveryFinding<
  CandidateKind extends DiscoveryCandidateKind = DiscoveryCandidateKind,
> {
  readonly findingId: DiscoveryFindingId;
  readonly findingNature: "CANDIDATE";
  readonly candidateKind: CandidateKind;
  readonly sourceObject: SourceObjectIdentity;
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly confidence: number;
  readonly reviewStatus: FindingReviewStatus;
  /**
   * Review/reconciliation is mandatory. ACCEPTED means accepted for that
   * process; it never means validated canonical truth.
   */
  readonly requiresReview: true;
  readonly createsCanonicalObject: false;
  readonly detectedAt: IsoTimestamp;
}

export type ObjectDiscoveryFinding<
  Kind extends CanonicalObjectKind = CanonicalObjectKind,
> = DiscoveryFinding<Kind>;

export type RelationshipDiscoveryFinding = DiscoveryFinding<"RELATIONSHIP">;

export interface CanonicalObjectIdentity<
  Kind extends CanonicalObjectKind = CanonicalObjectKind,
> {
  /** Trusted reconciliation context, never supplied by an adapter envelope. */
  readonly organisationId: OrganisationId;
  readonly objectId: CanonicalObjectId;
  readonly kind: Kind;
}

export interface AgentIdentity {
  readonly canonicalObject: CanonicalObjectIdentity<"AGENT">;
  readonly agentId: AgentId;
  readonly agentCode: string;
}

export interface AgentVersionIdentity {
  readonly canonicalObject: CanonicalObjectIdentity<"AGENT_VERSION">;
  readonly agent: AgentIdentity;
  readonly agentVersionId: AgentVersionId;
  readonly versionCode: string;
}

export interface ModelIdentity {
  readonly canonicalObject: CanonicalObjectIdentity<"MODEL">;
  readonly modelId: ModelId;
}

export interface ToolIdentity {
  readonly canonicalObject: CanonicalObjectIdentity<"TOOL">;
  readonly toolId: ToolId;
}

export interface McpServerIdentity {
  readonly canonicalObject: CanonicalObjectIdentity<"MCP_SERVER">;
  readonly mcpServerId: McpServerId;
}

export interface ApiIdentity {
  readonly canonicalObject: CanonicalObjectIdentity<"API">;
  readonly apiId: ApiId;
}

export interface PromptIdentity {
  readonly canonicalObject: CanonicalObjectIdentity<"PROMPT">;
  readonly promptId: PromptId;
}

export interface KnowledgeBaseIdentity {
  readonly canonicalObject: CanonicalObjectIdentity<"KNOWLEDGE_BASE">;
  readonly knowledgeBaseId: KnowledgeBaseId;
}

/**
 * Stable opaque Skill identity. It is assigned by reconciliation and is never
 * derived from a name, path, declaration artifact, artifact hash, or external
 * provider identifier.
 */
export interface SkillIdentity {
  readonly canonicalObject: CanonicalObjectIdentity<"SKILL">;
  readonly skillId: SkillId;
}

export interface DataAssetIdentity {
  readonly canonicalObject: CanonicalObjectIdentity<"DATA_ASSET">;
  readonly dataAssetId: DataAssetId;
}

export interface DataElementIdentity {
  readonly canonicalObject: CanonicalObjectIdentity<"DATA_ELEMENT">;
  readonly dataElementId: DataElementId;
  readonly dataAssetId: DataAssetId;
  readonly elementPath: string;
}

/** Closed tenant-local semantic identity family, separate from technical objects. */
export const SEMANTIC_IDENTITY_KIND = {
  SEMANTIC_CONCEPT: "SEMANTIC_CONCEPT",
  BUSINESS_TERM: "BUSINESS_TERM",
  BUSINESS_DOMAIN: "BUSINESS_DOMAIN",
  INFORMATION_DOMAIN: "INFORMATION_DOMAIN",
} as const;
export type SemanticIdentityKind =
  (typeof SEMANTIC_IDENTITY_KIND)[keyof typeof SEMANTIC_IDENTITY_KIND];

export interface SemanticConceptIdentity {
  readonly semanticIdentityKind: "SEMANTIC_CONCEPT";
  readonly organisationId: OrganisationId;
  readonly semanticConceptId: SemanticConceptId;
}

export interface BusinessTermIdentity {
  readonly semanticIdentityKind: "BUSINESS_TERM";
  readonly organisationId: OrganisationId;
  readonly businessTermId: BusinessTermId;
}

export interface BusinessDomainIdentity {
  readonly semanticIdentityKind: "BUSINESS_DOMAIN";
  readonly organisationId: OrganisationId;
  readonly businessDomainId: BusinessDomainId;
}

export interface InformationDomainIdentity {
  readonly semanticIdentityKind: "INFORMATION_DOMAIN";
  readonly organisationId: OrganisationId;
  readonly informationDomainId: InformationDomainId;
}

export type GovernedSemanticIdentity =
  | SemanticConceptIdentity
  | BusinessTermIdentity
  | BusinessDomainIdentity
  | InformationDomainIdentity;

/**
 * Leaf-level provenance references for one explicitly typed technical field.
 * Arrays are domain transport convenience; future persistence remains 3NF.
 */
export interface TechnicalMetadataSupport {
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
}

export interface DataAssetTechnicalProfileSupport {
  readonly structuralKind: TechnicalMetadataSupport;
  readonly technicalName: TechnicalMetadataSupport;
  readonly technicalNamespace: TechnicalMetadataSupport;
  readonly qualifiedTechnicalLocator: TechnicalMetadataSupport;
  readonly technicalDescription: TechnicalMetadataSupport;
}

/** Mutable technical metadata, deliberately separate from canonical identity. */
export interface DataAssetTechnicalProfile {
  readonly dataAssetId: DataAssetId;
  readonly structuralKind: DataAssetStructuralKind;
  readonly technicalName: string;
  readonly technicalNamespace?: string;
  readonly qualifiedTechnicalLocator?: string;
  readonly technicalDescription?: string;
  readonly support: DataAssetTechnicalProfileSupport;
}

/** Copies, allowlists, and freezes an explicitly typed DataAsset profile. */
export function createDataAssetTechnicalProfile(
  draft: DataAssetTechnicalProfile,
): DataAssetTechnicalProfile {
  const support = Object.freeze({
    structuralKind: freezeTechnicalMetadataSupport(
      draft.support.structuralKind,
    ),
    technicalName: freezeTechnicalMetadataSupport(draft.support.technicalName),
    technicalNamespace: freezeTechnicalMetadataSupport(
      draft.support.technicalNamespace,
    ),
    qualifiedTechnicalLocator: freezeTechnicalMetadataSupport(
      draft.support.qualifiedTechnicalLocator,
    ),
    technicalDescription: freezeTechnicalMetadataSupport(
      draft.support.technicalDescription,
    ),
  });

  return Object.freeze({
    dataAssetId: draft.dataAssetId,
    structuralKind: draft.structuralKind,
    technicalName: draft.technicalName,
    ...(draft.technicalNamespace === undefined
      ? {}
      : { technicalNamespace: draft.technicalNamespace }),
    ...(draft.qualifiedTechnicalLocator === undefined
      ? {}
      : { qualifiedTechnicalLocator: draft.qualifiedTechnicalLocator }),
    ...(draft.technicalDescription === undefined
      ? {}
      : { technicalDescription: draft.technicalDescription }),
    support,
  });
}

export interface DataTypeDescriptor {
  readonly normalizedFamily: NormalizedDataTypeFamily;
  /** Opaque source-native syntax; it is technical metadata, not identity. */
  readonly nativeType?: string;
  readonly length?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly timeZoneSemantics: TimeZoneSemantics;
}

export interface DataTypeDescriptorSupport {
  readonly normalizedFamily: TechnicalMetadataSupport;
  readonly nativeType: TechnicalMetadataSupport;
  readonly length: TechnicalMetadataSupport;
  readonly precision: TechnicalMetadataSupport;
  readonly scale: TechnicalMetadataSupport;
  readonly timeZoneSemantics: TechnicalMetadataSupport;
}

export interface DataElementTechnicalProfileSupport {
  readonly technicalName: TechnicalMetadataSupport;
  readonly ordinalPosition: TechnicalMetadataSupport;
  readonly dataType: DataTypeDescriptorSupport;
  readonly nullability: TechnicalMetadataSupport;
  readonly defaultState: TechnicalMetadataSupport;
  readonly generationState: TechnicalMetadataSupport;
}

/** Technical field state only; ownership remains on DataElementIdentity. */
export interface DataElementTechnicalProfile {
  readonly dataElementId: DataElementId;
  readonly technicalName: string;
  readonly ordinalPosition?: number;
  readonly dataType: DataTypeDescriptor;
  readonly nullability: NullabilityState;
  readonly defaultState: DefaultValueState;
  readonly generationState: ValueGenerationState;
  readonly support: DataElementTechnicalProfileSupport;
}

function freezeTechnicalMetadataSupport(
  support: TechnicalMetadataSupport,
): TechnicalMetadataSupport {
  return Object.freeze({
    assertionIds: Object.freeze([...support.assertionIds]),
    evidenceIds: Object.freeze([...support.evidenceIds]),
  });
}

function freezeDataTypeDescriptorSupport(
  support: DataTypeDescriptorSupport,
): DataTypeDescriptorSupport {
  return Object.freeze({
    normalizedFamily: freezeTechnicalMetadataSupport(support.normalizedFamily),
    nativeType: freezeTechnicalMetadataSupport(support.nativeType),
    length: freezeTechnicalMetadataSupport(support.length),
    precision: freezeTechnicalMetadataSupport(support.precision),
    scale: freezeTechnicalMetadataSupport(support.scale),
    timeZoneSemantics: freezeTechnicalMetadataSupport(
      support.timeZoneSemantics,
    ),
  });
}

function assertNonNegativeInteger(
  value: number | undefined,
  field: string,
): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
}

/** Validates only portable, locally provable datatype invariants. */
export function createDataTypeDescriptor(
  draft: DataTypeDescriptor,
): DataTypeDescriptor {
  assertNonNegativeInteger(draft.length, "Data type length");
  assertNonNegativeInteger(draft.precision, "Data type precision");
  assertNonNegativeInteger(draft.scale, "Data type scale");

  if (
    draft.precision !== undefined &&
    draft.scale !== undefined &&
    draft.scale > draft.precision
  ) {
    throw new TypeError("Data type scale cannot exceed precision");
  }

  const hasTimeZoneSemantics =
    draft.timeZoneSemantics === TIME_ZONE_SEMANTICS.WITH_TIME_ZONE ||
    draft.timeZoneSemantics === TIME_ZONE_SEMANTICS.WITHOUT_TIME_ZONE;
  const isTimeZoneCompatible =
    draft.normalizedFamily === NORMALIZED_DATA_TYPE_FAMILY.TIME ||
    draft.normalizedFamily === NORMALIZED_DATA_TYPE_FAMILY.TIMESTAMP;

  if (hasTimeZoneSemantics && !isTimeZoneCompatible) {
    throw new TypeError(
      "Time zone semantics require a TIME or TIMESTAMP normalized family",
    );
  }

  return Object.freeze({
    normalizedFamily: draft.normalizedFamily,
    ...(draft.nativeType === undefined ? {} : { nativeType: draft.nativeType }),
    ...(draft.length === undefined ? {} : { length: draft.length }),
    ...(draft.precision === undefined ? {} : { precision: draft.precision }),
    ...(draft.scale === undefined ? {} : { scale: draft.scale }),
    timeZoneSemantics: draft.timeZoneSemantics,
  });
}

/** Copies and freezes an explicitly typed DataElement technical profile. */
export function createDataElementTechnicalProfile(
  draft: DataElementTechnicalProfile,
): DataElementTechnicalProfile {
  if (
    draft.ordinalPosition !== undefined &&
    (!Number.isInteger(draft.ordinalPosition) || draft.ordinalPosition < 1)
  ) {
    throw new TypeError("Data element ordinal position must be a positive integer");
  }

  const support = Object.freeze({
    technicalName: freezeTechnicalMetadataSupport(draft.support.technicalName),
    ordinalPosition: freezeTechnicalMetadataSupport(
      draft.support.ordinalPosition,
    ),
    dataType: freezeDataTypeDescriptorSupport(draft.support.dataType),
    nullability: freezeTechnicalMetadataSupport(draft.support.nullability),
    defaultState: freezeTechnicalMetadataSupport(draft.support.defaultState),
    generationState: freezeTechnicalMetadataSupport(
      draft.support.generationState,
    ),
  });

  return Object.freeze({
    dataElementId: draft.dataElementId,
    technicalName: draft.technicalName,
    ...(draft.ordinalPosition === undefined
      ? {}
      : { ordinalPosition: draft.ordinalPosition }),
    dataType: createDataTypeDescriptor(draft.dataType),
    nullability: draft.nullability,
    defaultState: draft.defaultState,
    generationState: draft.generationState,
    support,
  });
}

export interface DataKeyMember {
  /** One-based order inside the key definition. */
  readonly position: number;
  readonly dataElementId: DataElementId;
}

export type NonEmptyDataKeyMembers = readonly [
  DataKeyMember,
  ...DataKeyMember[],
];

export interface DataKeyDefinition {
  readonly keyDefinitionId: DataKeyDefinitionId;
  readonly dataAssetId: DataAssetId;
  readonly keyType: DataKeyType;
  readonly technicalName?: string;
  readonly members: NonEmptyDataKeyMembers;
  /** Definition-level support; member-level provenance is out of V1A.1c. */
  readonly support: TechnicalMetadataSupport;
}

export interface DataKeyDefinitionDraft {
  readonly keyDefinitionId: DataKeyDefinitionId;
  readonly dataAssetId: DataAssetId;
  readonly keyType: DataKeyType;
  readonly technicalName?: string;
  readonly members: readonly DataKeyMember[];
  readonly support: TechnicalMetadataSupport;
}

export interface ForeignKeyElementMapping {
  /** One-based order; the directional pair must remain intact. */
  readonly position: number;
  readonly sourceDataElementId: DataElementId;
  readonly targetDataElementId: DataElementId;
}

export type NonEmptyForeignKeyMappings = readonly [
  ForeignKeyElementMapping,
  ...ForeignKeyElementMapping[],
];

export interface ForeignKeyDefinition {
  readonly foreignKeyDefinitionId: ForeignKeyDefinitionId;
  readonly sourceDataAssetId: DataAssetId;
  readonly targetDataAssetId: DataAssetId;
  readonly referencedKeyDefinitionId?: DataKeyDefinitionId;
  readonly technicalName?: string;
  readonly mappings: NonEmptyForeignKeyMappings;
  /** Definition-level support; member-level provenance is out of V1A.1c. */
  readonly support: TechnicalMetadataSupport;
}

export interface ForeignKeyDefinitionDraft {
  readonly foreignKeyDefinitionId: ForeignKeyDefinitionId;
  readonly sourceDataAssetId: DataAssetId;
  readonly targetDataAssetId: DataAssetId;
  readonly referencedKeyDefinitionId?: DataKeyDefinitionId;
  readonly technicalName?: string;
  readonly mappings: readonly ForeignKeyElementMapping[];
  readonly support: TechnicalMetadataSupport;
}

function sortAndValidatePositions<T extends { readonly position: number }>(
  items: readonly T[],
  subject: string,
): T[] {
  if (items.length === 0) {
    throw new TypeError(`${subject} requires at least one member`);
  }

  const positions = new Set<number>();
  for (const item of items) {
    if (!Number.isInteger(item.position) || item.position < 1) {
      throw new TypeError(`${subject} positions must be one-based integers`);
    }
    if (positions.has(item.position)) {
      throw new TypeError(`${subject} positions must be unique`);
    }
    positions.add(item.position);
  }

  const ordered = [...items].sort((left, right) => left.position - right.position);
  if (ordered.some((item, index) => item.position !== index + 1)) {
    throw new TypeError(`${subject} positions must be contiguous`);
  }

  return ordered;
}

/** Enforces local key structure without claiming tenant or FK validation. */
export function createDataKeyDefinition(
  draft: DataKeyDefinitionDraft,
): DataKeyDefinition {
  const ordered = sortAndValidatePositions(draft.members, "Data key member");
  const elementIds = new Set<DataElementId>();

  for (const member of ordered) {
    if (elementIds.has(member.dataElementId)) {
      throw new TypeError("Data key member DataElementIds must be unique");
    }
    elementIds.add(member.dataElementId);
  }

  const members = Object.freeze(
    ordered.map((member) =>
      Object.freeze({
        position: member.position,
        dataElementId: member.dataElementId,
      }),
    ),
  ) as unknown as NonEmptyDataKeyMembers;

  return Object.freeze({
    keyDefinitionId: draft.keyDefinitionId,
    dataAssetId: draft.dataAssetId,
    keyType: draft.keyType,
    ...(draft.technicalName === undefined
      ? {}
      : { technicalName: draft.technicalName }),
    members,
    support: freezeTechnicalMetadataSupport(draft.support),
  });
}

/** Enforces ordered directional pairs without resolving external identities. */
export function createForeignKeyDefinition(
  draft: ForeignKeyDefinitionDraft,
): ForeignKeyDefinition {
  const ordered = sortAndValidatePositions(
    draft.mappings,
    "Foreign key mapping",
  );
  const sourceIds = new Set<DataElementId>();
  const targetIds = new Set<DataElementId>();

  for (const mapping of ordered) {
    if (sourceIds.has(mapping.sourceDataElementId)) {
      throw new TypeError(
        "Foreign key source DataElementIds must be unique",
      );
    }
    if (targetIds.has(mapping.targetDataElementId)) {
      throw new TypeError(
        "Foreign key target DataElementIds must be unique",
      );
    }
    sourceIds.add(mapping.sourceDataElementId);
    targetIds.add(mapping.targetDataElementId);
  }

  const mappings = Object.freeze(
    ordered.map((mapping) =>
      Object.freeze({
        position: mapping.position,
        sourceDataElementId: mapping.sourceDataElementId,
        targetDataElementId: mapping.targetDataElementId,
      }),
    ),
  ) as unknown as NonEmptyForeignKeyMappings;

  return Object.freeze({
    foreignKeyDefinitionId: draft.foreignKeyDefinitionId,
    sourceDataAssetId: draft.sourceDataAssetId,
    targetDataAssetId: draft.targetDataAssetId,
    ...(draft.referencedKeyDefinitionId === undefined
      ? {}
      : { referencedKeyDefinitionId: draft.referencedKeyDefinitionId }),
    ...(draft.technicalName === undefined
      ? {}
      : { technicalName: draft.technicalName }),
    mappings,
    support: freezeTechnicalMetadataSupport(draft.support),
  });
}

/**
 * Agent is the stable logical identity. AgentVersion is immutable resolved
 * behavior configuration: behavior-affecting code/config, prompts, model
 * state, inference settings, bindings, capabilities, guardrails, HITL, I/O,
 * memory, material data access/purpose, and affecting build dependencies MUST
 * produce a new version when changed or when equivalence is not proven.
 * Governance/operational facts such as owner, status, risk, controls, waivers,
 * evidence, incidents, runtime metrics, classification, display-only naming,
 * locator-only moves of an identical artifact, or fingerprint rehashing MUST
 * NOT create a version. Implementations MAY version other deliberately chosen
 * behavior-significant changes, but cannot weaken those boundaries.
 *
 * Binding relationships are intentionally not modeled in V1A.1d. A future
 * immutable binding records target canonical identity, the pinned
 * TechnicalFingerprint, and binding configuration. An old AgentVersion never
 * resolves through a target's current profile; adopting a changed target
 * fingerprint creates a new AgentVersion.
 */
export interface AgentVersionTechnicalProfileSupport {
  readonly behaviorFingerprint: TechnicalMetadataSupport;
  readonly buildReference: TechnicalMetadataSupport;
  readonly runtimeFrameworkReference: TechnicalMetadataSupport;
  readonly entrypointReference: TechnicalMetadataSupport;
  readonly configurationReference: TechnicalMetadataSupport;
}

export interface AgentVersionTechnicalProfile {
  readonly agentVersionId: AgentVersionId;
  readonly behaviorFingerprint: BehaviorFingerprint;
  readonly buildReference?: string;
  readonly runtimeFrameworkReference?: string;
  readonly entrypointReference?: string;
  readonly configurationReference?: string;
  readonly support: AgentVersionTechnicalProfileSupport;
}

/**
 * Every *Reference field in the V1A.1d profiles is opaque non-secret metadata.
 * It must never carry a credential, token, key, or credential-bearing
 * connection string. These nested domain contracts do not imply JSONB
 * persistence; future storage remains tenant-safe and normalized by default.
 */

export interface ModelTechnicalProfileSupport {
  readonly technicalFingerprint: TechnicalMetadataSupport;
  readonly providerReference: TechnicalMetadataSupport;
  readonly providerModelReference: TechnicalMetadataSupport;
  readonly modelFamily: TechnicalMetadataSupport;
  readonly modelRevision: TechnicalMetadataSupport;
}

export interface ModelTechnicalProfile {
  readonly modelId: ModelId;
  readonly technicalFingerprint: TechnicalFingerprint;
  readonly providerReference?: string;
  readonly providerModelReference?: string;
  readonly modelFamily?: string;
  readonly modelRevision?: string;
  readonly support: ModelTechnicalProfileSupport;
}

export interface ToolTechnicalProfileSupport {
  readonly technicalFingerprint: TechnicalMetadataSupport;
  readonly declarationReference: TechnicalMetadataSupport;
  readonly contractReference: TechnicalMetadataSupport;
  readonly contractHash: TechnicalMetadataSupport;
  readonly technicalDescription: TechnicalMetadataSupport;
}

export interface ToolTechnicalProfile {
  readonly toolId: ToolId;
  readonly technicalFingerprint: TechnicalFingerprint;
  readonly declarationReference?: string;
  readonly contractReference?: string;
  /** Integrity of the contract/schema artifact, not technical-state identity. */
  readonly contractHash?: EvidenceHash;
  readonly technicalDescription?: string;
  readonly support: ToolTechnicalProfileSupport;
}

export interface McpServerTechnicalProfileSupport {
  readonly technicalFingerprint: TechnicalMetadataSupport;
  readonly declaredServerReference: TechnicalMetadataSupport;
  readonly protocolVersion: TechnicalMetadataSupport;
  readonly transport: TechnicalMetadataSupport;
  readonly endpointLocator: TechnicalMetadataSupport;
}

export interface McpServerTechnicalProfile {
  readonly mcpServerId: McpServerId;
  readonly technicalFingerprint: TechnicalFingerprint;
  readonly declaredServerReference?: string;
  readonly protocolVersion?: string;
  readonly transport: McpTransport;
  readonly endpointLocator?: SanitizedTechnicalLocator;
  readonly support: McpServerTechnicalProfileSupport;
}

export interface ApiTechnicalProfileSupport {
  readonly technicalFingerprint: TechnicalMetadataSupport;
  readonly protocolFamily: TechnicalMetadataSupport;
  readonly serviceReference: TechnicalMetadataSupport;
  readonly baseLocator: TechnicalMetadataSupport;
  readonly specificationReference: TechnicalMetadataSupport;
  readonly specificationHash: TechnicalMetadataSupport;
}

export interface ApiTechnicalProfile {
  readonly apiId: ApiId;
  readonly technicalFingerprint: TechnicalFingerprint;
  readonly protocolFamily: ApiProtocolFamily;
  readonly serviceReference?: string;
  readonly baseLocator?: SanitizedTechnicalLocator;
  readonly specificationReference?: string;
  /** Integrity of the API specification artifact, not a fingerprint. */
  readonly specificationHash?: EvidenceHash;
  readonly support: ApiTechnicalProfileSupport;
}

export interface PromptTechnicalProfileSupport {
  readonly technicalFingerprint: TechnicalMetadataSupport;
  readonly declarationReference: TechnicalMetadataSupport;
  readonly revision: TechnicalMetadataSupport;
  readonly contentHash: TechnicalMetadataSupport;
  readonly sourceLocator: TechnicalMetadataSupport;
}

export interface PromptTechnicalProfile {
  readonly promptId: PromptId;
  readonly technicalFingerprint: TechnicalFingerprint;
  readonly declarationReference?: string;
  readonly revision?: string;
  /** Integrity of prompt content bytes; full prompt content is not stored. */
  readonly contentHash?: EvidenceHash;
  readonly sourceLocator?: SanitizedTechnicalLocator;
  readonly support: PromptTechnicalProfileSupport;
}

export interface KnowledgeBaseTechnicalProfileSupport {
  readonly technicalFingerprint: TechnicalMetadataSupport;
  readonly sourceReference: TechnicalMetadataSupport;
  readonly resourceKind: TechnicalMetadataSupport;
  readonly contentHash: TechnicalMetadataSupport;
  readonly retrievalConfigurationReference: TechnicalMetadataSupport;
}

export interface KnowledgeBaseTechnicalProfile {
  readonly knowledgeBaseId: KnowledgeBaseId;
  readonly technicalFingerprint: TechnicalFingerprint;
  readonly sourceReference?: string;
  readonly resourceKind: KnowledgeBaseResourceKind;
  /** Integrity of a content artifact, not a technical-state fingerprint. */
  readonly contentHash?: EvidenceHash;
  readonly retrievalConfigurationReference?: string;
  readonly support: KnowledgeBaseTechnicalProfileSupport;
}

/**
 * A Skill is a portable, governable capability/procedure artifact. It may
 * contain or reference instructions, operational guidance, supporting scripts
 * and assets, dependency information, and behavioral boundaries. It is not a
 * Prompt, Tool, Agent, Knowledge Base, capability grant, authorization, or
 * runtime execution. A Skill may contribute to multiple capabilities; binding
 * it never grants authorization, and bundled scripts are not automatically
 * Tools.
 *
 * External declaration artifacts remain source observations. Package
 * directories and dependency manifests may contribute source references,
 * artifact integrity, and fingerprint inputs. Descriptive cards map to
 * assertions/evidence and later governance, signatures to evidence and future
 * verification, and evaluations/benchmarks to a future evaluation grain. None
 * is copied wholesale into this profile.
 */
export interface SkillTechnicalProfileSupport {
  readonly technicalFingerprint: TechnicalMetadataSupport;
  readonly declarationReference: TechnicalMetadataSupport;
  readonly revisionReference: TechnicalMetadataSupport;
  readonly artifactHash: TechnicalMetadataSupport;
  readonly manifestReference: TechnicalMetadataSupport;
  readonly sourceLocator: TechnicalMetadataSupport;
}

export interface SkillTechnicalProfile {
  readonly skillId: SkillId;
  readonly technicalFingerprint: TechnicalFingerprint;
  readonly declarationReference?: string;
  readonly revisionReference?: string;
  /** Artifact integrity only; it is not technical-state identity. */
  readonly artifactHash?: EvidenceHash;
  readonly manifestReference?: string;
  readonly sourceLocator?: SanitizedTechnicalLocator;
  readonly support: SkillTechnicalProfileSupport;
}

function freezeEvidenceHash(hash: EvidenceHash): EvidenceHash {
  return Object.freeze({ algorithm: hash.algorithm, value: hash.value });
}

function freezeAgentVersionTechnicalProfileSupport(
  support: AgentVersionTechnicalProfileSupport,
): AgentVersionTechnicalProfileSupport {
  return Object.freeze({
    behaviorFingerprint: freezeTechnicalMetadataSupport(
      support.behaviorFingerprint,
    ),
    buildReference: freezeTechnicalMetadataSupport(support.buildReference),
    runtimeFrameworkReference: freezeTechnicalMetadataSupport(
      support.runtimeFrameworkReference,
    ),
    entrypointReference: freezeTechnicalMetadataSupport(
      support.entrypointReference,
    ),
    configurationReference: freezeTechnicalMetadataSupport(
      support.configurationReference,
    ),
  });
}

function freezeModelTechnicalProfileSupport(
  support: ModelTechnicalProfileSupport,
): ModelTechnicalProfileSupport {
  return Object.freeze({
    technicalFingerprint: freezeTechnicalMetadataSupport(
      support.technicalFingerprint,
    ),
    providerReference: freezeTechnicalMetadataSupport(support.providerReference),
    providerModelReference: freezeTechnicalMetadataSupport(
      support.providerModelReference,
    ),
    modelFamily: freezeTechnicalMetadataSupport(support.modelFamily),
    modelRevision: freezeTechnicalMetadataSupport(support.modelRevision),
  });
}

function freezeToolTechnicalProfileSupport(
  support: ToolTechnicalProfileSupport,
): ToolTechnicalProfileSupport {
  return Object.freeze({
    technicalFingerprint: freezeTechnicalMetadataSupport(
      support.technicalFingerprint,
    ),
    declarationReference: freezeTechnicalMetadataSupport(
      support.declarationReference,
    ),
    contractReference: freezeTechnicalMetadataSupport(support.contractReference),
    contractHash: freezeTechnicalMetadataSupport(support.contractHash),
    technicalDescription: freezeTechnicalMetadataSupport(
      support.technicalDescription,
    ),
  });
}

function freezeMcpServerTechnicalProfileSupport(
  support: McpServerTechnicalProfileSupport,
): McpServerTechnicalProfileSupport {
  return Object.freeze({
    technicalFingerprint: freezeTechnicalMetadataSupport(
      support.technicalFingerprint,
    ),
    declaredServerReference: freezeTechnicalMetadataSupport(
      support.declaredServerReference,
    ),
    protocolVersion: freezeTechnicalMetadataSupport(support.protocolVersion),
    transport: freezeTechnicalMetadataSupport(support.transport),
    endpointLocator: freezeTechnicalMetadataSupport(support.endpointLocator),
  });
}

function freezeApiTechnicalProfileSupport(
  support: ApiTechnicalProfileSupport,
): ApiTechnicalProfileSupport {
  return Object.freeze({
    technicalFingerprint: freezeTechnicalMetadataSupport(
      support.technicalFingerprint,
    ),
    protocolFamily: freezeTechnicalMetadataSupport(support.protocolFamily),
    serviceReference: freezeTechnicalMetadataSupport(support.serviceReference),
    baseLocator: freezeTechnicalMetadataSupport(support.baseLocator),
    specificationReference: freezeTechnicalMetadataSupport(
      support.specificationReference,
    ),
    specificationHash: freezeTechnicalMetadataSupport(
      support.specificationHash,
    ),
  });
}

function freezePromptTechnicalProfileSupport(
  support: PromptTechnicalProfileSupport,
): PromptTechnicalProfileSupport {
  return Object.freeze({
    technicalFingerprint: freezeTechnicalMetadataSupport(
      support.technicalFingerprint,
    ),
    declarationReference: freezeTechnicalMetadataSupport(
      support.declarationReference,
    ),
    revision: freezeTechnicalMetadataSupport(support.revision),
    contentHash: freezeTechnicalMetadataSupport(support.contentHash),
    sourceLocator: freezeTechnicalMetadataSupport(support.sourceLocator),
  });
}

function freezeKnowledgeBaseTechnicalProfileSupport(
  support: KnowledgeBaseTechnicalProfileSupport,
): KnowledgeBaseTechnicalProfileSupport {
  return Object.freeze({
    technicalFingerprint: freezeTechnicalMetadataSupport(
      support.technicalFingerprint,
    ),
    sourceReference: freezeTechnicalMetadataSupport(support.sourceReference),
    resourceKind: freezeTechnicalMetadataSupport(support.resourceKind),
    contentHash: freezeTechnicalMetadataSupport(support.contentHash),
    retrievalConfigurationReference: freezeTechnicalMetadataSupport(
      support.retrievalConfigurationReference,
    ),
  });
}

function freezeSkillTechnicalProfileSupport(
  support: SkillTechnicalProfileSupport,
): SkillTechnicalProfileSupport {
  return Object.freeze({
    technicalFingerprint: freezeTechnicalMetadataSupport(
      support.technicalFingerprint,
    ),
    declarationReference: freezeTechnicalMetadataSupport(
      support.declarationReference,
    ),
    revisionReference: freezeTechnicalMetadataSupport(
      support.revisionReference,
    ),
    artifactHash: freezeTechnicalMetadataSupport(support.artifactHash),
    manifestReference: freezeTechnicalMetadataSupport(
      support.manifestReference,
    ),
    sourceLocator: freezeTechnicalMetadataSupport(support.sourceLocator),
  });
}

/** Copies and freezes an immutable AgentVersion technical snapshot. */
export function createAgentVersionTechnicalProfile(
  draft: AgentVersionTechnicalProfile,
): AgentVersionTechnicalProfile {
  return Object.freeze({
    agentVersionId: draft.agentVersionId,
    behaviorFingerprint: createBehaviorFingerprint(draft.behaviorFingerprint),
    ...(draft.buildReference === undefined
      ? {}
      : { buildReference: draft.buildReference }),
    ...(draft.runtimeFrameworkReference === undefined
      ? {}
      : { runtimeFrameworkReference: draft.runtimeFrameworkReference }),
    ...(draft.entrypointReference === undefined
      ? {}
      : { entrypointReference: draft.entrypointReference }),
    ...(draft.configurationReference === undefined
      ? {}
      : { configurationReference: draft.configurationReference }),
    support: freezeAgentVersionTechnicalProfileSupport(draft.support),
  });
}

/**
 * Target profiles below are current reconciled views. Each factory freezes one
 * value snapshot, but evolution replaces that view. Future persistence must
 * retain historical snapshots so immutable AgentVersion bindings can keep
 * resolving their pinned state; a current profile is not a temporal lookup.
 */
export function createModelTechnicalProfile(
  draft: ModelTechnicalProfile,
): ModelTechnicalProfile {
  return Object.freeze({
    modelId: draft.modelId,
    technicalFingerprint: createTechnicalFingerprint(
      draft.technicalFingerprint,
    ),
    ...(draft.providerReference === undefined
      ? {}
      : { providerReference: draft.providerReference }),
    ...(draft.providerModelReference === undefined
      ? {}
      : { providerModelReference: draft.providerModelReference }),
    ...(draft.modelFamily === undefined
      ? {}
      : { modelFamily: draft.modelFamily }),
    ...(draft.modelRevision === undefined
      ? {}
      : { modelRevision: draft.modelRevision }),
    support: freezeModelTechnicalProfileSupport(draft.support),
  });
}

export function createToolTechnicalProfile(
  draft: ToolTechnicalProfile,
): ToolTechnicalProfile {
  return Object.freeze({
    toolId: draft.toolId,
    technicalFingerprint: createTechnicalFingerprint(
      draft.technicalFingerprint,
    ),
    ...(draft.declarationReference === undefined
      ? {}
      : { declarationReference: draft.declarationReference }),
    ...(draft.contractReference === undefined
      ? {}
      : { contractReference: draft.contractReference }),
    ...(draft.contractHash === undefined
      ? {}
      : { contractHash: freezeEvidenceHash(draft.contractHash) }),
    ...(draft.technicalDescription === undefined
      ? {}
      : { technicalDescription: draft.technicalDescription }),
    support: freezeToolTechnicalProfileSupport(draft.support),
  });
}

export function createMcpServerTechnicalProfile(
  draft: McpServerTechnicalProfile,
): McpServerTechnicalProfile {
  return Object.freeze({
    mcpServerId: draft.mcpServerId,
    technicalFingerprint: createTechnicalFingerprint(
      draft.technicalFingerprint,
    ),
    ...(draft.declaredServerReference === undefined
      ? {}
      : { declaredServerReference: draft.declaredServerReference }),
    ...(draft.protocolVersion === undefined
      ? {}
      : { protocolVersion: draft.protocolVersion }),
    transport: draft.transport,
    ...(draft.endpointLocator === undefined
      ? {}
      : { endpointLocator: draft.endpointLocator }),
    support: freezeMcpServerTechnicalProfileSupport(draft.support),
  });
}

export function createApiTechnicalProfile(
  draft: ApiTechnicalProfile,
): ApiTechnicalProfile {
  return Object.freeze({
    apiId: draft.apiId,
    technicalFingerprint: createTechnicalFingerprint(
      draft.technicalFingerprint,
    ),
    protocolFamily: draft.protocolFamily,
    ...(draft.serviceReference === undefined
      ? {}
      : { serviceReference: draft.serviceReference }),
    ...(draft.baseLocator === undefined
      ? {}
      : { baseLocator: draft.baseLocator }),
    ...(draft.specificationReference === undefined
      ? {}
      : { specificationReference: draft.specificationReference }),
    ...(draft.specificationHash === undefined
      ? {}
      : { specificationHash: freezeEvidenceHash(draft.specificationHash) }),
    support: freezeApiTechnicalProfileSupport(draft.support),
  });
}

export function createPromptTechnicalProfile(
  draft: PromptTechnicalProfile,
): PromptTechnicalProfile {
  return Object.freeze({
    promptId: draft.promptId,
    technicalFingerprint: createTechnicalFingerprint(
      draft.technicalFingerprint,
    ),
    ...(draft.declarationReference === undefined
      ? {}
      : { declarationReference: draft.declarationReference }),
    ...(draft.revision === undefined ? {} : { revision: draft.revision }),
    ...(draft.contentHash === undefined
      ? {}
      : { contentHash: freezeEvidenceHash(draft.contentHash) }),
    ...(draft.sourceLocator === undefined
      ? {}
      : { sourceLocator: draft.sourceLocator }),
    support: freezePromptTechnicalProfileSupport(draft.support),
  });
}

export function createKnowledgeBaseTechnicalProfile(
  draft: KnowledgeBaseTechnicalProfile,
): KnowledgeBaseTechnicalProfile {
  return Object.freeze({
    knowledgeBaseId: draft.knowledgeBaseId,
    technicalFingerprint: createTechnicalFingerprint(
      draft.technicalFingerprint,
    ),
    ...(draft.sourceReference === undefined
      ? {}
      : { sourceReference: draft.sourceReference }),
    resourceKind: draft.resourceKind,
    ...(draft.contentHash === undefined
      ? {}
      : { contentHash: freezeEvidenceHash(draft.contentHash) }),
    ...(draft.retrievalConfigurationReference === undefined
      ? {}
      : {
          retrievalConfigurationReference:
            draft.retrievalConfigurationReference,
        }),
    support: freezeKnowledgeBaseTechnicalProfileSupport(draft.support),
  });
}

/**
 * Copies the explicit Skill technical allowlist into a frozen current view.
 * A future AgentVersion USES_SKILL binding must pin this exact
 * TechnicalFingerprint. Adopting a changed fingerprint requires a new
 * AgentVersion; this contract does not implement that relationship.
 */
export function createSkillTechnicalProfile(
  draft: SkillTechnicalProfile,
): SkillTechnicalProfile {
  return Object.freeze({
    skillId: draft.skillId,
    technicalFingerprint: createTechnicalFingerprint(
      draft.technicalFingerprint,
    ),
    ...(draft.declarationReference === undefined
      ? {}
      : { declarationReference: draft.declarationReference }),
    ...(draft.revisionReference === undefined
      ? {}
      : { revisionReference: draft.revisionReference }),
    ...(draft.artifactHash === undefined
      ? {}
      : { artifactHash: freezeEvidenceHash(draft.artifactHash) }),
    ...(draft.manifestReference === undefined
      ? {}
      : { manifestReference: draft.manifestReference }),
    ...(draft.sourceLocator === undefined
      ? {}
      : { sourceLocator: draft.sourceLocator }),
    support: freezeSkillTechnicalProfileSupport(draft.support),
  });
}

/** The closed V1A.1e taxonomy of canonical governed relationships. */
export const GOVERNED_RELATIONSHIP_TYPE = {
  USES_MODEL: "USES_MODEL",
  USES_TOOL: "USES_TOOL",
  USES_MCP: "USES_MCP",
  INVOKES: "INVOKES",
  USES_PROMPT: "USES_PROMPT",
  USES_KNOWLEDGE_BASE: "USES_KNOWLEDGE_BASE",
  USES_SKILL: "USES_SKILL",
  EXPOSES: "EXPOSES",
  HANDOFF_TO: "HANDOFF_TO",
  READS_FROM: "READS_FROM",
  WRITES_TO: "WRITES_TO",
  DERIVED_FROM: "DERIVED_FROM",
} as const;
export type GovernedRelationshipType =
  (typeof GOVERNED_RELATIONSHIP_TYPE)[keyof typeof GOVERNED_RELATIONSHIP_TYPE];

export type BehaviorBindingRelationshipType =
  | "USES_MODEL"
  | "USES_TOOL"
  | "USES_MCP"
  | "INVOKES"
  | "USES_PROMPT"
  | "USES_KNOWLEDGE_BASE"
  | "USES_SKILL";

export interface RelationshipEndpointIdentityByKind {
  readonly AGENT: AgentIdentity;
  readonly AGENT_VERSION: AgentVersionIdentity;
  readonly MODEL: ModelIdentity;
  readonly TOOL: ToolIdentity;
  readonly MCP_SERVER: McpServerIdentity;
  readonly API: ApiIdentity;
  readonly PROMPT: PromptIdentity;
  readonly KNOWLEDGE_BASE: KnowledgeBaseIdentity;
  readonly DATA_ASSET: DataAssetIdentity;
  readonly DATA_ELEMENT: DataElementIdentity;
  readonly SKILL: SkillIdentity;
}

export type RelationshipEndpointIdentity<
  Kind extends CanonicalObjectKind,
> = RelationshipEndpointIdentityByKind[Kind];

/** Compile-time endpoint-kind matrix; runtime factories enforce the same map. */
export interface GovernedRelationshipEndpointKinds {
  readonly USES_MODEL: {
    readonly source: "AGENT_VERSION";
    readonly target: "MODEL";
  };
  readonly USES_TOOL: {
    readonly source: "AGENT_VERSION";
    readonly target: "TOOL";
  };
  readonly USES_MCP: {
    readonly source: "AGENT_VERSION";
    readonly target: "MCP_SERVER";
  };
  readonly INVOKES: {
    readonly source: "AGENT_VERSION";
    readonly target: "API";
  };
  readonly USES_PROMPT: {
    readonly source: "AGENT_VERSION";
    readonly target: "PROMPT";
  };
  readonly USES_KNOWLEDGE_BASE: {
    readonly source: "AGENT_VERSION";
    readonly target: "KNOWLEDGE_BASE";
  };
  readonly USES_SKILL: {
    readonly source: "AGENT_VERSION";
    readonly target: "SKILL";
  };
  readonly EXPOSES: {
    readonly source: "MCP_SERVER";
    readonly target: "TOOL";
  };
  readonly HANDOFF_TO: {
    readonly source: "AGENT_VERSION";
    readonly target: "AGENT";
  };
  readonly READS_FROM: {
    readonly source: "AGENT_VERSION";
    readonly target: "DATA_ASSET" | "DATA_ELEMENT";
  };
  readonly WRITES_TO: {
    readonly source: "AGENT_VERSION";
    readonly target: "DATA_ASSET" | "DATA_ELEMENT";
  };
  readonly DERIVED_FROM: {
    readonly source: "DATA_ELEMENT";
    readonly target: "DATA_ELEMENT";
  };
}

type GovernedRelationshipSourceKind<
  Type extends GovernedRelationshipType,
> = GovernedRelationshipEndpointKinds[Type]["source"];
type GovernedRelationshipTargetKind<
  Type extends GovernedRelationshipType,
> = GovernedRelationshipEndpointKinds[Type]["target"];

/** Relationship provenance is intentionally separate from technical metadata. */
export interface RelationshipSupport {
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
}

export interface BehaviorBindingConfigurationReference {
  readonly configurationHash: EvidenceHash;
  readonly configurationLocator?: SanitizedTechnicalLocator;
}

export interface BehaviorBindingConfigurationSupport {
  readonly configurationHash: RelationshipSupport;
  readonly configurationLocator: RelationshipSupport;
}

export interface BehaviorBindingSupport {
  readonly relationship: RelationshipSupport;
  readonly boundTechnicalFingerprint: RelationshipSupport;
  readonly bindingConfiguration: BehaviorBindingConfigurationSupport;
}

export interface LineageTransformationSupport {
  readonly reference: RelationshipSupport;
  readonly hash: RelationshipSupport;
}

interface LineageTransformationBase {
  readonly support: LineageTransformationSupport;
}

export type LineageTransformation =
  | (LineageTransformationBase & {
      readonly reference: SanitizedTechnicalLocator;
      readonly hash?: EvidenceHash;
    })
  | (LineageTransformationBase & {
      readonly reference?: SanitizedTechnicalLocator;
      readonly hash: EvidenceHash;
    });

/**
 * One immutable valid-time state of an assigned logical relationship. IDs are
 * opaque allocations: type + source + target is only a duplicate-detection
 * signal and never relationship identity or a uniqueness promise.
 *
 * Future persistence must normalize logical identity, temporal state, support,
 * behavior binding, and lineage transformation grains with tenant-safe FKs.
 * This in-memory contract does not claim repository-wide history/uniqueness.
 */
export interface GovernedRelationshipBase<
  Type extends GovernedRelationshipType,
  SourceKind extends CanonicalObjectKind,
  TargetKind extends CanonicalObjectKind,
  Support extends RelationshipSupport | BehaviorBindingSupport,
> {
  readonly relationshipId: RelationshipId;
  readonly relationshipStateId: RelationshipStateId;
  readonly organisationId: OrganisationId;
  readonly relationshipType: Type;
  readonly source: RelationshipEndpointIdentity<SourceKind>;
  readonly target: RelationshipEndpointIdentity<TargetKind>;
  readonly support: Support;
  /** Effective valid time is the half-open interval [validFrom, validTo). */
  readonly validFrom: IsoTimestamp;
  readonly validTo?: IsoTimestamp;
  readonly recordedAt: IsoTimestamp;
  /** Correction/replacement of a recorded state, not ordinary succession. */
  readonly supersedesRelationshipStateId?: RelationshipStateId;
}

interface BehaviorBindingState {
  readonly boundTechnicalFingerprint: TechnicalFingerprint;
  readonly bindingConfiguration?: BehaviorBindingConfigurationReference;
}

interface DerivedFromState {
  readonly transformation?: LineageTransformation;
}

type RelationshipSupportFor<Type extends GovernedRelationshipType> =
  Type extends BehaviorBindingRelationshipType
    ? BehaviorBindingSupport
    : RelationshipSupport;

type RelationshipSpecificState<Type extends GovernedRelationshipType> =
  Type extends BehaviorBindingRelationshipType
    ? BehaviorBindingState
    : Type extends "DERIVED_FROM"
      ? DerivedFromState
      : object;

export type GovernedRelationshipDraft<
  Type extends GovernedRelationshipType = GovernedRelationshipType,
> = Type extends GovernedRelationshipType
  ? GovernedRelationshipBase<
      Type,
      GovernedRelationshipSourceKind<Type>,
      GovernedRelationshipTargetKind<Type>,
      RelationshipSupportFor<Type>
    > &
      RelationshipSpecificState<Type>
  : never;

declare const governedRelationshipBrand: unique symbol;

/** Created only from an approved CREATE_NEW relationship decision. */
export type GovernedRelationship<
  Type extends GovernedRelationshipType = GovernedRelationshipType,
> = GovernedRelationshipDraft<Type> & {
  readonly [governedRelationshipBrand]: "GovernedRelationship";
};

export type UsesModelRelationship = GovernedRelationship<"USES_MODEL">;
export type UsesToolRelationship = GovernedRelationship<"USES_TOOL">;
export type UsesMcpRelationship = GovernedRelationship<"USES_MCP">;
export type InvokesRelationship = GovernedRelationship<"INVOKES">;
export type UsesPromptRelationship = GovernedRelationship<"USES_PROMPT">;
export type UsesKnowledgeBaseRelationship =
  GovernedRelationship<"USES_KNOWLEDGE_BASE">;
export type UsesSkillRelationship = GovernedRelationship<"USES_SKILL">;
export type ExposesRelationship = GovernedRelationship<"EXPOSES">;
export type HandoffToRelationship = GovernedRelationship<"HANDOFF_TO">;
export type ReadsFromRelationship = GovernedRelationship<"READS_FROM">;
export type WritesToRelationship = GovernedRelationship<"WRITES_TO">;
export type DerivedFromRelationship = GovernedRelationship<"DERIVED_FROM">;

export type RelationshipMatchReference<
  Type extends GovernedRelationshipType = GovernedRelationshipType,
> = Type extends GovernedRelationshipType
  ? Readonly<{
      relationshipId: RelationshipId;
      relationshipStateId: RelationshipStateId;
      organisationId: OrganisationId;
      relationshipType: Type;
      source: RelationshipEndpointIdentity<
        GovernedRelationshipSourceKind<Type>
      >;
      target: RelationshipEndpointIdentity<
        GovernedRelationshipTargetKind<Type>
      >;
    }>
  : never;

export type PreCanonicalObjectReference<
  Kind extends CanonicalObjectKind = CanonicalObjectKind,
> =
  | {
      readonly referenceKind: "CANDIDATE";
      readonly candidateId: NormalizedCandidateId;
      readonly candidateKind: Kind;
    }
  | {
      readonly referenceKind: "SOURCE_OBJECT";
      readonly sourceObject: SourceObjectIdentity;
      readonly candidateKind: Kind;
    };

/** A normalized candidate is always a single-source discovery artifact. */
export interface NormalizedCandidateBase<
  Kind extends DiscoveryCandidateKind,
> {
  readonly candidateId: NormalizedCandidateId;
  readonly candidateKind: Kind;
  readonly sourceObject: SourceObjectIdentity;
  readonly findingId: DiscoveryFindingId;
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly confidence: number;
  readonly requiresReconciliation: true;
}

/** Preserves the V1A Agent candidate shape exactly. */
export interface NormalizedAgentCandidate
  extends NormalizedCandidateBase<"AGENT"> {
  readonly proposedIdentity: {
    readonly agentCode?: string;
    readonly displayName?: string;
    readonly versionCode?: string;
  };
}

export interface NormalizedAgentVersionCandidate
  extends NormalizedCandidateBase<"AGENT_VERSION"> {
  readonly proposedIdentity: {
    readonly agent: PreCanonicalObjectReference<"AGENT">;
    readonly versionCode?: string;
  };
}

export interface NormalizedModelCandidate
  extends NormalizedCandidateBase<"MODEL"> {
  readonly proposedIdentity: {
    readonly modelReference?: string;
    readonly displayName?: string;
  };
}

export interface NormalizedToolCandidate
  extends NormalizedCandidateBase<"TOOL"> {
  readonly proposedIdentity: {
    readonly declarationKey?: string;
    readonly displayName?: string;
  };
}

export interface NormalizedMcpServerCandidate
  extends NormalizedCandidateBase<"MCP_SERVER"> {
  readonly proposedIdentity: {
    readonly serverReference?: string;
    readonly displayName?: string;
  };
}

export interface NormalizedApiCandidate
  extends NormalizedCandidateBase<"API"> {
  readonly proposedIdentity: {
    readonly apiReference?: string;
    readonly displayName?: string;
  };
}

export interface NormalizedPromptCandidate
  extends NormalizedCandidateBase<"PROMPT"> {
  readonly proposedIdentity: {
    readonly declarationKey?: string;
    readonly displayName?: string;
  };
}

export interface NormalizedKnowledgeBaseCandidate
  extends NormalizedCandidateBase<"KNOWLEDGE_BASE"> {
  readonly proposedIdentity: {
    readonly sourceReference?: string;
    readonly displayName?: string;
  };
}

/**
 * A Skill finding remains a reconciliation candidate. Declaration reference,
 * display name, revision, locator, or hashes are only reconciliation signals;
 * no one signal proves canonical equality across sources.
 */
export interface NormalizedSkillCandidate
  extends NormalizedCandidateBase<"SKILL"> {
  readonly proposedIdentity: {
    readonly declarationReference?: string;
    readonly displayName?: string;
  };
}

export interface NormalizedDataAssetCandidate
  extends NormalizedCandidateBase<"DATA_ASSET"> {
  readonly proposedIdentity: {
    readonly sourceReference?: string;
    readonly displayName?: string;
  };
}

export interface NormalizedDataElementCandidate
  extends NormalizedCandidateBase<"DATA_ELEMENT"> {
  readonly proposedIdentity: {
    readonly parentDataAsset: PreCanonicalObjectReference<"DATA_ASSET">;
    readonly elementPath: string;
    readonly displayName?: string;
  };
}

export interface NormalizedRelationshipCandidate
  extends NormalizedCandidateBase<"RELATIONSHIP"> {
  /** Discovery vocabulary only; V1A.1e will define canonical relationships. */
  readonly relationshipTypeCode: string;
  readonly sourceEndpoint: PreCanonicalObjectReference;
  readonly targetEndpoint: PreCanonicalObjectReference;
}

export type NormalizedObjectCandidate =
  | NormalizedAgentCandidate
  | NormalizedAgentVersionCandidate
  | NormalizedModelCandidate
  | NormalizedToolCandidate
  | NormalizedMcpServerCandidate
  | NormalizedApiCandidate
  | NormalizedPromptCandidate
  | NormalizedKnowledgeBaseCandidate
  | NormalizedSkillCandidate
  | NormalizedDataAssetCandidate
  | NormalizedDataElementCandidate;

export type NormalizedCandidate =
  | NormalizedObjectCandidate
  | NormalizedRelationshipCandidate;

export type MultipleCandidateIds = readonly [
  NormalizedCandidateId,
  NormalizedCandidateId,
  ...NormalizedCandidateId[],
];

/**
 * Immutable multi-source reconciliation artifact. It deliberately contains no
 * sourceObject, canonicalObject, flattened facts, or proposed identity.
 */
export interface CandidateMergeRecord {
  readonly candidateMergeId: CandidateMergeId;
  readonly organisationId: OrganisationId;
  readonly candidateKind: CanonicalObjectKind;
  readonly contributingCandidateIds: MultipleCandidateIds;
  readonly createdByDecisionId: ReconciliationDecisionId;
  readonly createdAt: IsoTimestamp;
  readonly requiresReconciliation: true;
  readonly createsCanonicalObject: false;
}

export interface TrustedSingleSourceCandidateContributor {
  readonly contributorKind: "CANDIDATE";
  /** Supplied only by tenant-scoped, trusted server-side processing. */
  readonly organisationId: OrganisationId;
  readonly candidate: NormalizedObjectCandidate;
}

export interface ExistingCandidateMergeContributor {
  readonly contributorKind: "CANDIDATE_MERGE";
  readonly candidateMerge: CandidateMergeRecord;
}

export type CandidateMergeContributor =
  | TrustedSingleSourceCandidateContributor
  | ExistingCandidateMergeContributor;

export interface CandidateMergeDraft {
  readonly candidateMergeId: CandidateMergeId;
  readonly organisationId: OrganisationId;
  readonly candidateKind: CanonicalObjectKind;
  readonly contributors: readonly CandidateMergeContributor[];
  readonly createdByDecisionId: ReconciliationDecisionId;
  readonly createdAt: IsoTimestamp;
}

function compareOpaqueIds(
  left: NormalizedCandidateId,
  right: NormalizedCandidateId,
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isCanonicalObjectKind(value: string): value is CanonicalObjectKind {
  return (Object.values(CANONICAL_OBJECT_KIND) as readonly string[]).includes(
    value,
  );
}

/**
 * Flattens successive merges into immutable leaf candidate IDs. Candidate
 * tenant membership must come from the trusted contributor wrapper, never an
 * adapter payload.
 */
export function createCandidateMergeRecord(
  draft: CandidateMergeDraft,
): CandidateMergeRecord {
  const leafIds: NormalizedCandidateId[] = [];

  if (!isCanonicalObjectKind(draft.candidateKind)) {
    throw new TypeError("Relationship candidates cannot be merged in V1A.1b");
  }

  for (const contributor of draft.contributors) {
    if (contributor.contributorKind === "CANDIDATE") {
      if (contributor.organisationId !== draft.organisationId) {
        throw new TypeError("Candidate contributor belongs to another organisation");
      }
      if (!isCanonicalObjectKind(contributor.candidate.candidateKind)) {
        throw new TypeError("Relationship candidates cannot be merged in V1A.1b");
      }
      if (contributor.candidate.candidateKind !== draft.candidateKind) {
        throw new TypeError("Candidate merge cannot mix candidate kinds");
      }
      leafIds.push(contributor.candidate.candidateId);
      continue;
    }

    if (contributor.candidateMerge.organisationId !== draft.organisationId) {
      throw new TypeError("Candidate merge contributor belongs to another organisation");
    }
    if (contributor.candidateMerge.candidateKind !== draft.candidateKind) {
      throw new TypeError("Candidate merge cannot mix candidate kinds");
    }
    leafIds.push(...contributor.candidateMerge.contributingCandidateIds);
  }

  if (leafIds.length < 2) {
    throw new TypeError("Candidate merge requires at least two leaf candidates");
  }
  if (new Set(leafIds).size !== leafIds.length) {
    throw new TypeError("Candidate merge contributors must be unique");
  }

  const contributingCandidateIds = Object.freeze(
    [...leafIds].sort(compareOpaqueIds),
  ) as unknown as MultipleCandidateIds;

  return Object.freeze({
    candidateMergeId: draft.candidateMergeId,
    organisationId: draft.organisationId,
    candidateKind: draft.candidateKind,
    contributingCandidateIds,
    createdByDecisionId: draft.createdByDecisionId,
    createdAt: draft.createdAt,
    requiresReconciliation: true,
    createsCanonicalObject: false,
  });
}

export const RECONCILIATION_OUTCOME = {
  CREATE_NEW: "CREATE_NEW",
  MATCH_EXISTING: "MATCH_EXISTING",
  MERGE_CANDIDATES: "MERGE_CANDIDATES",
  REJECT: "REJECT",
  DEFER: "DEFER",
} as const;
export type ReconciliationOutcome =
  (typeof RECONCILIATION_OUTCOME)[keyof typeof RECONCILIATION_OUTCOME];

export const RECONCILIATION_AUTHORITY_KIND = {
  HUMAN: "HUMAN",
  DETERMINISTIC_RULE: "DETERMINISTIC_RULE",
} as const;

export type ReconciliationAuthority =
  | {
      readonly authorityKind: "HUMAN";
      readonly actorReference: string;
    }
  | {
      readonly authorityKind: "DETERMINISTIC_RULE";
      readonly ruleCode: string;
      readonly ruleVersion: string;
    };

export const RELATIONSHIP_RECONCILIATION_OUTCOME = {
  CREATE_NEW: "CREATE_NEW",
  MATCH_EXISTING: "MATCH_EXISTING",
  REJECT: "REJECT",
  DEFER: "DEFER",
} as const;
export type RelationshipReconciliationOutcome =
  (typeof RELATIONSHIP_RECONCILIATION_OUTCOME)[keyof typeof RELATIONSHIP_RECONCILIATION_OUTCOME];

export interface RelationshipReconciliationDecisionBase<
  Outcome extends RelationshipReconciliationOutcome,
> {
  readonly decisionId: ReconciliationDecisionId;
  /** Trusted orchestration context; never copied from the relationship candidate. */
  readonly organisationId: OrganisationId;
  readonly relationshipCandidateId: NormalizedCandidateId;
  /** Exact source/discovery vocabulary code preserved for auditability. */
  readonly relationshipTypeCode: string;
  readonly outcome: Outcome;
  readonly authority: ReconciliationAuthority;
  readonly reasonCode: string;
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly decidedAt: IsoTimestamp;
}

declare const relationshipReconciliationDecisionBrand: unique symbol;

type RelationshipReconciliationDecisionBrand = {
  readonly [relationshipReconciliationDecisionBrand]:
    "RelationshipReconciliationDecision";
};

export type CreateNewRelationshipReconciliationDecision<
  Type extends GovernedRelationshipType = GovernedRelationshipType,
> = Type extends GovernedRelationshipType
  ? RelationshipReconciliationDecisionBase<"CREATE_NEW"> & {
      readonly authorizedState: GovernedRelationshipDraft<Type>;
    } & RelationshipReconciliationDecisionBrand
  : never;

export type MatchExistingRelationshipReconciliationDecision<
  Type extends GovernedRelationshipType = GovernedRelationshipType,
> = Type extends GovernedRelationshipType
  ? RelationshipReconciliationDecisionBase<"MATCH_EXISTING"> & {
      readonly matchedState: RelationshipMatchReference<Type>;
    } & RelationshipReconciliationDecisionBrand
  : never;

export type RejectRelationshipReconciliationDecision =
  RelationshipReconciliationDecisionBase<"REJECT"> & {
    readonly relationshipId?: never;
    readonly relationshipStateId?: never;
    readonly authorizedState?: never;
    readonly matchedState?: never;
  } & RelationshipReconciliationDecisionBrand;

export type DeferRelationshipReconciliationDecision =
  RelationshipReconciliationDecisionBase<"DEFER"> & {
    readonly relationshipId?: never;
    readonly relationshipStateId?: never;
    readonly authorizedState?: never;
    readonly matchedState?: never;
  } & RelationshipReconciliationDecisionBrand;

export type RelationshipReconciliationDecision =
  | CreateNewRelationshipReconciliationDecision
  | MatchExistingRelationshipReconciliationDecision
  | RejectRelationshipReconciliationDecision
  | DeferRelationshipReconciliationDecision;

interface RelationshipReconciliationDecisionDraftBase<
  Outcome extends RelationshipReconciliationOutcome,
> {
  readonly decisionId: ReconciliationDecisionId;
  readonly organisationId: OrganisationId;
  readonly relationshipCandidateId: NormalizedCandidateId;
  /**
   * Validation context only; never copied wholesale into the decision. This
   * package validates its pre-canonical shape, but a trusted orchestrator or
   * repository must prove its endpoint reconciliation links before approval.
   */
  readonly relationshipCandidate: NormalizedRelationshipCandidate;
  readonly outcome: Outcome;
  readonly authority: ReconciliationAuthority;
  readonly reasonCode: string;
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly decidedAt: IsoTimestamp;
}

export type CreateNewRelationshipReconciliationDecisionDraft<
  Type extends GovernedRelationshipType = GovernedRelationshipType,
> = Type extends GovernedRelationshipType
  ? RelationshipReconciliationDecisionDraftBase<"CREATE_NEW"> & {
      readonly authorizedState: GovernedRelationshipDraft<Type>;
      /** Validation context only; never copied into the decision. */
      readonly supersededState?: GovernedRelationship;
    }
  : never;

export type MatchExistingRelationshipReconciliationDecisionDraft<
  Type extends GovernedRelationshipType = GovernedRelationshipType,
> = Type extends GovernedRelationshipType
  ? RelationshipReconciliationDecisionDraftBase<"MATCH_EXISTING"> & {
      readonly matchedState: RelationshipMatchReference<Type>;
    }
  : never;

export type RejectRelationshipReconciliationDecisionDraft =
  RelationshipReconciliationDecisionDraftBase<"REJECT"> & {
    readonly relationshipId?: never;
    readonly relationshipStateId?: never;
    readonly authorizedState?: never;
    readonly matchedState?: never;
  };

export type DeferRelationshipReconciliationDecisionDraft =
  RelationshipReconciliationDecisionDraftBase<"DEFER"> & {
    readonly relationshipId?: never;
    readonly relationshipStateId?: never;
    readonly authorizedState?: never;
    readonly matchedState?: never;
  };

export type RelationshipReconciliationDecisionDraft =
  | CreateNewRelationshipReconciliationDecisionDraft
  | MatchExistingRelationshipReconciliationDecisionDraft
  | RejectRelationshipReconciliationDecisionDraft
  | DeferRelationshipReconciliationDecisionDraft;

const RELATIONSHIP_ENDPOINT_CONSTRAINTS = {
  USES_MODEL: { source: "AGENT_VERSION", targets: ["MODEL"] },
  USES_TOOL: { source: "AGENT_VERSION", targets: ["TOOL"] },
  USES_MCP: { source: "AGENT_VERSION", targets: ["MCP_SERVER"] },
  INVOKES: { source: "AGENT_VERSION", targets: ["API"] },
  USES_PROMPT: { source: "AGENT_VERSION", targets: ["PROMPT"] },
  USES_KNOWLEDGE_BASE: {
    source: "AGENT_VERSION",
    targets: ["KNOWLEDGE_BASE"],
  },
  USES_SKILL: { source: "AGENT_VERSION", targets: ["SKILL"] },
  EXPOSES: { source: "MCP_SERVER", targets: ["TOOL"] },
  HANDOFF_TO: { source: "AGENT_VERSION", targets: ["AGENT"] },
  READS_FROM: {
    source: "AGENT_VERSION",
    targets: ["DATA_ASSET", "DATA_ELEMENT"],
  },
  WRITES_TO: {
    source: "AGENT_VERSION",
    targets: ["DATA_ASSET", "DATA_ELEMENT"],
  },
  DERIVED_FROM: { source: "DATA_ELEMENT", targets: ["DATA_ELEMENT"] },
} as const satisfies Record<
  GovernedRelationshipType,
  {
    readonly source: CanonicalObjectKind;
    readonly targets: readonly CanonicalObjectKind[];
  }
>;

const BEHAVIOR_BINDING_RELATIONSHIP_TYPES = new Set<string>([
  "USES_MODEL",
  "USES_TOOL",
  "USES_MCP",
  "INVOKES",
  "USES_PROMPT",
  "USES_KNOWLEDGE_BASE",
  "USES_SKILL",
]);

function isGovernedRelationshipType(
  value: unknown,
): value is GovernedRelationshipType {
  return (
    typeof value === "string" &&
    (Object.values(GOVERNED_RELATIONSHIP_TYPE) as readonly string[]).includes(
      value,
    )
  );
}

function isBehaviorBindingRelationshipType(
  value: GovernedRelationshipType,
): value is BehaviorBindingRelationshipType {
  return BEHAVIOR_BINDING_RELATIONSHIP_TYPES.has(value);
}

function asObjectRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requiredTimestamp(value: unknown, label: string): IsoTimestamp {
  const timestamp = requiredString(value, label);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError(`${label} must be a valid date-time string`);
  }
  return timestamp as IsoTimestamp;
}

function copyRelationshipSupport(
  value: unknown,
  label = "Relationship support",
): RelationshipSupport {
  const support = asObjectRecord(value, label);
  if (!Array.isArray(support.assertionIds)) {
    throw new TypeError(`${label} assertionIds must be an array`);
  }
  if (!Array.isArray(support.evidenceIds)) {
    throw new TypeError(`${label} evidenceIds must be an array`);
  }
  const assertionIds = [...new Set(
    support.assertionIds.map((id) =>
      requiredString(id, `${label} assertion ID`),
    ),
  )].sort() as SourceAssertionId[];
  const evidenceIds = [...new Set(
    support.evidenceIds.map((id) =>
      requiredString(id, `${label} evidence ID`),
    ),
  )].sort() as EvidenceId[];
  return Object.freeze({
    assertionIds: Object.freeze(assertionIds),
    evidenceIds: Object.freeze(evidenceIds),
  });
}

function copyEvidenceHash(value: unknown, label: string): EvidenceHash {
  const hash = asObjectRecord(value, label);
  return Object.freeze({
    algorithm: requiredString(hash.algorithm, `${label} algorithm`),
    value: requiredString(hash.value, `${label} value`),
  });
}

function copyTechnicalFingerprint(value: unknown): TechnicalFingerprint {
  const fingerprint = asObjectRecord(value, "Bound technical fingerprint");
  return createTechnicalFingerprint({
    algorithm: requiredString(
      fingerprint.algorithm,
      "Bound technical fingerprint algorithm",
    ),
    schemaVersion: requiredString(
      fingerprint.schemaVersion,
      "Bound technical fingerprint schemaVersion",
    ),
    value: requiredString(
      fingerprint.value,
      "Bound technical fingerprint value",
    ),
  });
}

function requireSanitizedTechnicalLocator(
  value: unknown,
  label: string,
): SanitizedTechnicalLocator {
  const locator = requiredString(value, label);
  if (sanitizeTechnicalLocator(locator) !== locator) {
    throw new TypeError(`${label} must already be sanitized`);
  }
  return locator as SanitizedTechnicalLocator;
}

function copyCanonicalObjectIdentity(
  value: unknown,
  expectedKind: CanonicalObjectKind,
): CanonicalObjectIdentity {
  const canonicalObject = asObjectRecord(value, "Canonical endpoint identity");
  if (canonicalObject.kind !== expectedKind) {
    throw new TypeError(`Relationship endpoint must be ${expectedKind}`);
  }
  return Object.freeze({
    organisationId: requiredString(
      canonicalObject.organisationId,
      "Canonical endpoint organisationId",
    ) as OrganisationId,
    objectId: requiredString(
      canonicalObject.objectId,
      "Canonical endpoint objectId",
    ) as CanonicalObjectId,
    kind: expectedKind,
  });
}

function copyRelationshipEndpoint(
  value: unknown,
  expectedKind: CanonicalObjectKind,
): RelationshipEndpointIdentity<CanonicalObjectKind> {
  const endpoint = asObjectRecord(value, `${expectedKind} endpoint`);
  const canonicalObject = copyCanonicalObjectIdentity(
    endpoint.canonicalObject,
    expectedKind,
  );
  let copied: Readonly<Record<string, unknown>>;

  switch (expectedKind) {
    case "AGENT":
      copied = {
        canonicalObject,
        agentId: requiredString(endpoint.agentId, "Agent endpoint agentId"),
        agentCode: requiredString(endpoint.agentCode, "Agent endpoint agentCode"),
      };
      break;
    case "AGENT_VERSION": {
      const agent = copyRelationshipEndpoint(endpoint.agent, "AGENT") as AgentIdentity;
      if (
        agent.canonicalObject.organisationId !== canonicalObject.organisationId
      ) {
        throw new TypeError("AgentVersion and parent Agent must share a tenant");
      }
      copied = {
        canonicalObject,
        agent,
        agentVersionId: requiredString(
          endpoint.agentVersionId,
          "AgentVersion endpoint agentVersionId",
        ),
        versionCode: requiredString(
          endpoint.versionCode,
          "AgentVersion endpoint versionCode",
        ),
      };
      break;
    }
    case "MODEL":
      copied = {
        canonicalObject,
        modelId: requiredString(endpoint.modelId, "Model endpoint modelId"),
      };
      break;
    case "TOOL":
      copied = {
        canonicalObject,
        toolId: requiredString(endpoint.toolId, "Tool endpoint toolId"),
      };
      break;
    case "MCP_SERVER":
      copied = {
        canonicalObject,
        mcpServerId: requiredString(
          endpoint.mcpServerId,
          "MCP endpoint mcpServerId",
        ),
      };
      break;
    case "API":
      copied = {
        canonicalObject,
        apiId: requiredString(endpoint.apiId, "API endpoint apiId"),
      };
      break;
    case "PROMPT":
      copied = {
        canonicalObject,
        promptId: requiredString(endpoint.promptId, "Prompt endpoint promptId"),
      };
      break;
    case "KNOWLEDGE_BASE":
      copied = {
        canonicalObject,
        knowledgeBaseId: requiredString(
          endpoint.knowledgeBaseId,
          "Knowledge Base endpoint knowledgeBaseId",
        ),
      };
      break;
    case "SKILL":
      copied = {
        canonicalObject,
        skillId: requiredString(endpoint.skillId, "Skill endpoint skillId"),
      };
      break;
    case "DATA_ASSET":
      copied = {
        canonicalObject,
        dataAssetId: requiredString(
          endpoint.dataAssetId,
          "DataAsset endpoint dataAssetId",
        ),
      };
      break;
    case "DATA_ELEMENT":
      copied = {
        canonicalObject,
        dataElementId: requiredString(
          endpoint.dataElementId,
          "DataElement endpoint dataElementId",
        ),
        dataAssetId: requiredString(
          endpoint.dataAssetId,
          "DataElement endpoint dataAssetId",
        ),
        elementPath: requiredString(
          endpoint.elementPath,
          "DataElement endpoint elementPath",
        ),
      };
      break;
  }

  return Object.freeze(copied) as unknown as RelationshipEndpointIdentity<CanonicalObjectKind>;
}

function canonicalObjectIdentitiesEqual(
  left: CanonicalObjectIdentity,
  right: CanonicalObjectIdentity,
): boolean {
  return (
    left.organisationId === right.organisationId &&
    left.objectId === right.objectId &&
    left.kind === right.kind
  );
}

function relationshipEndpointsEqual(
  left: RelationshipEndpointIdentity<CanonicalObjectKind>,
  right: RelationshipEndpointIdentity<CanonicalObjectKind>,
): boolean {
  if (!canonicalObjectIdentitiesEqual(left.canonicalObject, right.canonicalObject)) {
    return false;
  }
  switch (left.canonicalObject.kind) {
    case "AGENT": {
      const leftAgent = left as AgentIdentity;
      const rightAgent = right as AgentIdentity;
      return (
        leftAgent.agentId === rightAgent.agentId &&
        leftAgent.agentCode === rightAgent.agentCode
      );
    }
    case "AGENT_VERSION": {
      const leftVersion = left as AgentVersionIdentity;
      const rightVersion = right as AgentVersionIdentity;
      return (
        leftVersion.agentVersionId === rightVersion.agentVersionId &&
        leftVersion.versionCode === rightVersion.versionCode &&
        relationshipEndpointsEqual(leftVersion.agent, rightVersion.agent)
      );
    }
    case "MODEL":
      return (left as ModelIdentity).modelId === (right as ModelIdentity).modelId;
    case "TOOL":
      return (left as ToolIdentity).toolId === (right as ToolIdentity).toolId;
    case "MCP_SERVER":
      return (
        (left as McpServerIdentity).mcpServerId ===
        (right as McpServerIdentity).mcpServerId
      );
    case "API":
      return (left as ApiIdentity).apiId === (right as ApiIdentity).apiId;
    case "PROMPT":
      return (
        (left as PromptIdentity).promptId ===
        (right as PromptIdentity).promptId
      );
    case "KNOWLEDGE_BASE":
      return (
        (left as KnowledgeBaseIdentity).knowledgeBaseId ===
        (right as KnowledgeBaseIdentity).knowledgeBaseId
      );
    case "SKILL":
      return (left as SkillIdentity).skillId === (right as SkillIdentity).skillId;
    case "DATA_ASSET":
      return (
        (left as DataAssetIdentity).dataAssetId ===
        (right as DataAssetIdentity).dataAssetId
      );
    case "DATA_ELEMENT": {
      const leftElement = left as DataElementIdentity;
      const rightElement = right as DataElementIdentity;
      return (
        leftElement.dataElementId === rightElement.dataElementId &&
        leftElement.dataAssetId === rightElement.dataAssetId &&
        leftElement.elementPath === rightElement.elementPath
      );
    }
  }
}

function copyBehaviorBindingConfiguration(
  value: unknown,
): BehaviorBindingConfigurationReference {
  const configuration = asObjectRecord(
    value,
    "Behavior binding configuration",
  );
  return Object.freeze({
    configurationHash: copyEvidenceHash(
      configuration.configurationHash,
      "Behavior binding configuration hash",
    ),
    ...(configuration.configurationLocator === undefined
      ? {}
      : {
          configurationLocator: requireSanitizedTechnicalLocator(
            configuration.configurationLocator,
            "Behavior binding configuration locator",
          ),
        }),
  });
}

function copyBehaviorBindingSupport(value: unknown): BehaviorBindingSupport {
  const support = asObjectRecord(value, "Behavior binding support");
  const bindingConfiguration = asObjectRecord(
    support.bindingConfiguration,
    "Behavior binding configuration support",
  );
  return Object.freeze({
    relationship: copyRelationshipSupport(
      support.relationship,
      "Behavior relationship support",
    ),
    boundTechnicalFingerprint: copyRelationshipSupport(
      support.boundTechnicalFingerprint,
      "Behavior fingerprint support",
    ),
    bindingConfiguration: Object.freeze({
      configurationHash: copyRelationshipSupport(
        bindingConfiguration.configurationHash,
        "Binding configuration hash support",
      ),
      configurationLocator: copyRelationshipSupport(
        bindingConfiguration.configurationLocator,
        "Binding configuration locator support",
      ),
    }),
  });
}

function copyLineageTransformation(value: unknown): LineageTransformation {
  const transformation = asObjectRecord(value, "Lineage transformation");
  if (
    transformation.reference === undefined &&
    transformation.hash === undefined
  ) {
    throw new TypeError(
      "Lineage transformation requires a reference or hash",
    );
  }
  const support = asObjectRecord(
    transformation.support,
    "Lineage transformation support",
  );
  return Object.freeze({
    ...(transformation.reference === undefined
      ? {}
      : {
          reference: requireSanitizedTechnicalLocator(
            transformation.reference,
            "Lineage transformation reference",
          ),
        }),
    ...(transformation.hash === undefined
      ? {}
      : {
          hash: copyEvidenceHash(
            transformation.hash,
            "Lineage transformation hash",
          ),
        }),
    support: Object.freeze({
      reference: copyRelationshipSupport(
        support.reference,
        "Lineage transformation reference support",
      ),
      hash: copyRelationshipSupport(
        support.hash,
        "Lineage transformation hash support",
      ),
    }),
  }) as LineageTransformation;
}

function copyGovernedRelationshipDraft(
  value: unknown,
): GovernedRelationshipDraft {
  const draft = asObjectRecord(value, "Governed relationship state");
  if (!isGovernedRelationshipType(draft.relationshipType)) {
    throw new TypeError("Unknown governed relationship type");
  }
  const relationshipType = draft.relationshipType;
  const constraint = RELATIONSHIP_ENDPOINT_CONSTRAINTS[relationshipType];
  const sourceRecord = asObjectRecord(draft.source, "Relationship source");
  const targetRecord = asObjectRecord(draft.target, "Relationship target");
  const sourceCanonical = asObjectRecord(
    sourceRecord.canonicalObject,
    "Relationship source canonical identity",
  );
  const targetCanonical = asObjectRecord(
    targetRecord.canonicalObject,
    "Relationship target canonical identity",
  );
  if (sourceCanonical.kind !== constraint.source) {
    throw new TypeError(
      `${relationshipType} source must be ${constraint.source}`,
    );
  }
  if (
    typeof targetCanonical.kind !== "string" ||
    !(constraint.targets as readonly string[]).includes(targetCanonical.kind)
  ) {
    throw new TypeError(
      `${relationshipType} target must be ${constraint.targets.join(" or ")}`,
    );
  }

  const organisationId = requiredString(
    draft.organisationId,
    "Relationship organisationId",
  ) as OrganisationId;
  const source = copyRelationshipEndpoint(
    draft.source,
    constraint.source,
  );
  const target = copyRelationshipEndpoint(
    draft.target,
    targetCanonical.kind as CanonicalObjectKind,
  );
  if (
    source.canonicalObject.organisationId !== organisationId ||
    target.canonicalObject.organisationId !== organisationId
  ) {
    throw new TypeError(
      "Relationship tenant must match both canonical endpoints",
    );
  }

  const validFrom = requiredTimestamp(draft.validFrom, "Relationship validFrom");
  const validTo =
    draft.validTo === undefined
      ? undefined
      : requiredTimestamp(draft.validTo, "Relationship validTo");
  if (
    validTo !== undefined &&
    Date.parse(validTo) <= Date.parse(validFrom)
  ) {
    throw new TypeError("Relationship validTo must be greater than validFrom");
  }
  const recordedAt = requiredTimestamp(
    draft.recordedAt,
    "Relationship recordedAt",
  );
  const supersedesRelationshipStateId =
    draft.supersedesRelationshipStateId === undefined
      ? undefined
      : (requiredString(
          draft.supersedesRelationshipStateId,
          "Superseded relationship state ID",
        ) as RelationshipStateId);

  const base = {
    relationshipId: requiredString(
      draft.relationshipId,
      "Relationship ID",
    ) as RelationshipId,
    relationshipStateId: requiredString(
      draft.relationshipStateId,
      "Relationship state ID",
    ) as RelationshipStateId,
    organisationId,
    relationshipType,
    source,
    target,
    validFrom,
    ...(validTo === undefined ? {} : { validTo }),
    recordedAt,
    ...(supersedesRelationshipStateId === undefined
      ? {}
      : { supersedesRelationshipStateId }),
  };

  if (isBehaviorBindingRelationshipType(relationshipType)) {
    return Object.freeze({
      ...base,
      boundTechnicalFingerprint: copyTechnicalFingerprint(
        draft.boundTechnicalFingerprint,
      ),
      ...(draft.bindingConfiguration === undefined
        ? {}
        : {
            bindingConfiguration: copyBehaviorBindingConfiguration(
              draft.bindingConfiguration,
            ),
          }),
      support: copyBehaviorBindingSupport(draft.support),
    }) as GovernedRelationshipDraft;
  }

  return Object.freeze({
    ...base,
    ...(relationshipType === "DERIVED_FROM" && draft.transformation !== undefined
      ? { transformation: copyLineageTransformation(draft.transformation) }
      : {}),
    support: copyRelationshipSupport(draft.support),
  }) as GovernedRelationshipDraft;
}

function technicalFingerprintsEqual(
  left: TechnicalFingerprint,
  right: TechnicalFingerprint,
): boolean {
  return (
    left.algorithm === right.algorithm &&
    left.schemaVersion === right.schemaVersion &&
    left.value === right.value
  );
}

function evidenceHashesEqual(
  left: EvidenceHash | undefined,
  right: EvidenceHash | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined &&
        left.algorithm === right.algorithm &&
        left.value === right.value;
}

function behaviorConfigurationsEqual(
  left: BehaviorBindingConfigurationReference | undefined,
  right: BehaviorBindingConfigurationReference | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return (
    evidenceHashesEqual(left.configurationHash, right.configurationHash) &&
    left.configurationLocator === right.configurationLocator
  );
}

function validateRelationshipSupersession(
  current: GovernedRelationshipDraft,
  supersededState: unknown,
): void {
  if (current.supersedesRelationshipStateId === undefined) {
    if (supersededState !== undefined) {
      throw new TypeError(
        "Superseded state context requires supersedesRelationshipStateId",
      );
    }
    return;
  }
  if (supersededState === undefined) {
    throw new TypeError("Supersession requires the exact prior relationship state");
  }
  const prior = copyGovernedRelationshipDraft(supersededState);
  if (
    prior.relationshipStateId !== current.supersedesRelationshipStateId ||
    prior.relationshipId !== current.relationshipId ||
    prior.relationshipType !== current.relationshipType ||
    !relationshipEndpointsEqual(prior.source, current.source) ||
    !relationshipEndpointsEqual(prior.target, current.target)
  ) {
    throw new TypeError(
      "Supersession must preserve relationship identity, type, and endpoints",
    );
  }
  if (prior.relationshipStateId === current.relationshipStateId) {
    throw new TypeError("Supersession requires a new RelationshipStateId");
  }
  if (Date.parse(current.recordedAt) <= Date.parse(prior.recordedAt)) {
    throw new TypeError("Superseding state must be recorded after the prior state");
  }
  if (
    isBehaviorBindingRelationshipType(current.relationshipType) &&
    isBehaviorBindingRelationshipType(prior.relationshipType)
  ) {
    const currentBinding = current as GovernedRelationshipDraft<BehaviorBindingRelationshipType>;
    const priorBinding = prior as GovernedRelationshipDraft<BehaviorBindingRelationshipType>;
    if (
      !technicalFingerprintsEqual(
        currentBinding.boundTechnicalFingerprint,
        priorBinding.boundTechnicalFingerprint,
      ) ||
      !behaviorConfigurationsEqual(
        currentBinding.bindingConfiguration,
        priorBinding.bindingConfiguration,
      )
    ) {
      throw new TypeError(
        "Behavior binding fingerprint and configuration are immutable for an AgentVersion relationship",
      );
    }
  }
}

function copyMatchReference(value: unknown): RelationshipMatchReference {
  const reference = asObjectRecord(value, "Matched relationship state");
  if (!isGovernedRelationshipType(reference.relationshipType)) {
    throw new TypeError("Unknown governed relationship type");
  }
  const relationshipType = reference.relationshipType;
  const constraint = RELATIONSHIP_ENDPOINT_CONSTRAINTS[relationshipType];
  const sourceRecord = asObjectRecord(reference.source, "Matched source");
  const targetRecord = asObjectRecord(reference.target, "Matched target");
  const sourceCanonical = asObjectRecord(
    sourceRecord.canonicalObject,
    "Matched source canonical identity",
  );
  const targetCanonical = asObjectRecord(
    targetRecord.canonicalObject,
    "Matched target canonical identity",
  );
  if (sourceCanonical.kind !== constraint.source) {
    throw new TypeError(
      `${relationshipType} source must be ${constraint.source}`,
    );
  }
  if (
    typeof targetCanonical.kind !== "string" ||
    !(constraint.targets as readonly string[]).includes(targetCanonical.kind)
  ) {
    throw new TypeError(
      `${relationshipType} target must be ${constraint.targets.join(" or ")}`,
    );
  }
  const organisationId = requiredString(
    reference.organisationId,
    "Matched relationship organisationId",
  ) as OrganisationId;
  const source = copyRelationshipEndpoint(reference.source, constraint.source);
  const target = copyRelationshipEndpoint(
    reference.target,
    targetCanonical.kind as CanonicalObjectKind,
  );
  if (
    source.canonicalObject.organisationId !== organisationId ||
    target.canonicalObject.organisationId !== organisationId
  ) {
    throw new TypeError(
      "Matched relationship tenant must match both canonical endpoints",
    );
  }
  return Object.freeze({
    relationshipId: requiredString(
      reference.relationshipId,
      "Matched relationship ID",
    ) as RelationshipId,
    relationshipStateId: requiredString(
      reference.relationshipStateId,
      "Matched relationship state ID",
    ) as RelationshipStateId,
    organisationId,
    relationshipType,
    source,
    target,
  }) as RelationshipMatchReference;
}

function copyReconciliationAuthority(
  value: unknown,
): ReconciliationAuthority {
  const authority = asObjectRecord(value, "Reconciliation authority");
  if (authority.authorityKind === "HUMAN") {
    return Object.freeze({
      authorityKind: "HUMAN",
      actorReference: requiredString(
        authority.actorReference,
        "Human authority actorReference",
      ),
    });
  }
  if (authority.authorityKind === "DETERMINISTIC_RULE") {
    return Object.freeze({
      authorityKind: "DETERMINISTIC_RULE",
      ruleCode: requiredString(
        authority.ruleCode,
        "Deterministic authority ruleCode",
      ),
      ruleVersion: requiredString(
        authority.ruleVersion,
        "Deterministic authority ruleVersion",
      ),
    });
  }
  throw new TypeError("Unknown reconciliation authority");
}

function validatePreCanonicalRelationshipEndpoint(
  value: unknown,
  label: string,
): void {
  const endpoint = asObjectRecord(value, label);
  if (Object.prototype.hasOwnProperty.call(endpoint, "canonicalObject")) {
    throw new TypeError(`${label} must remain pre-canonical`);
  }
  if (
    typeof endpoint.candidateKind !== "string" ||
    !isCanonicalObjectKind(endpoint.candidateKind)
  ) {
    throw new TypeError(`${label} candidateKind must be canonical`);
  }
  if (endpoint.referenceKind === "CANDIDATE") {
    requiredString(endpoint.candidateId, `${label} candidateId`);
    return;
  }
  if (endpoint.referenceKind === "SOURCE_OBJECT") {
    const sourceObject = asObjectRecord(
      endpoint.sourceObject,
      `${label} sourceObject`,
    );
    requiredString(sourceObject.connectionId, `${label} connectionId`);
    requiredString(sourceObject.externalType, `${label} externalType`);
    requiredString(sourceObject.externalId, `${label} externalId`);
    return;
  }
  throw new TypeError(`${label} must be a pre-canonical reference`);
}

function validateRelationshipCandidateContext(value: unknown): Readonly<{
  candidateId: NormalizedCandidateId;
  relationshipTypeCode: string;
}> {
  const candidate = asObjectRecord(
    value,
    "Relationship candidate validation context",
  );
  if (candidate.candidateKind !== "RELATIONSHIP") {
    throw new TypeError("Relationship candidate must have kind RELATIONSHIP");
  }
  const candidateId = requiredString(
    candidate.candidateId,
    "Relationship candidate ID",
  ) as NormalizedCandidateId;
  const relationshipTypeCode = requiredString(
    candidate.relationshipTypeCode,
    "Source relationship type code",
  );
  validatePreCanonicalRelationshipEndpoint(
    candidate.sourceEndpoint,
    "Relationship candidate source endpoint",
  );
  validatePreCanonicalRelationshipEndpoint(
    candidate.targetEndpoint,
    "Relationship candidate target endpoint",
  );
  return Object.freeze({ candidateId, relationshipTypeCode });
}

function validateSuccessfulRelationshipTypeNormalization(
  relationshipTypeCode: string,
  relationshipType: GovernedRelationshipType,
): void {
  if (
    !isGovernedRelationshipType(relationshipTypeCode) ||
    relationshipTypeCode !== relationshipType
  ) {
    throw new TypeError(
      "Successful relationship decision requires an exact canonical relationship type code",
    );
  }
}

function copyRelationshipDecisionBase(
  draft: Readonly<Record<string, unknown>>,
  outcome: RelationshipReconciliationOutcome,
  relationshipTypeCode: string,
): RelationshipReconciliationDecisionBase<RelationshipReconciliationOutcome> {
  const provenance = copyRelationshipSupport(
    {
      assertionIds: draft.assertionIds,
      evidenceIds: draft.evidenceIds,
    },
    "Relationship decision provenance",
  );
  return {
    decisionId: requiredString(
      draft.decisionId,
      "Relationship decision ID",
    ) as ReconciliationDecisionId,
    organisationId: requiredString(
      draft.organisationId,
      "Relationship decision organisationId",
    ) as OrganisationId,
    relationshipCandidateId: requiredString(
      draft.relationshipCandidateId,
      "Relationship candidate ID",
    ) as NormalizedCandidateId,
    relationshipTypeCode,
    outcome,
    authority: copyReconciliationAuthority(draft.authority),
    reasonCode: requiredString(
      draft.reasonCode,
      "Relationship decision reasonCode",
    ),
    assertionIds: provenance.assertionIds,
    evidenceIds: provenance.evidenceIds,
    decidedAt: requiredTimestamp(
      draft.decidedAt,
      "Relationship decision decidedAt",
    ),
  };
}

export function createRelationshipReconciliationDecision<
  Type extends GovernedRelationshipType,
>(
  draft: CreateNewRelationshipReconciliationDecisionDraft<Type>,
): CreateNewRelationshipReconciliationDecision<Type>;
export function createRelationshipReconciliationDecision<
  Type extends GovernedRelationshipType,
>(
  draft: MatchExistingRelationshipReconciliationDecisionDraft<Type>,
): MatchExistingRelationshipReconciliationDecision<Type>;
export function createRelationshipReconciliationDecision(
  draft: RejectRelationshipReconciliationDecisionDraft,
): RejectRelationshipReconciliationDecision;
export function createRelationshipReconciliationDecision(
  draft: DeferRelationshipReconciliationDecisionDraft,
): DeferRelationshipReconciliationDecision;
export function createRelationshipReconciliationDecision(
  draft: RelationshipReconciliationDecisionDraft,
): RelationshipReconciliationDecision;
export function createRelationshipReconciliationDecision(
  draft: unknown,
): unknown {
  const input = asObjectRecord(
    draft,
    "Relationship reconciliation decision draft",
  );
  const candidate = validateRelationshipCandidateContext(
    input.relationshipCandidate,
  );
  const relationshipCandidateId = requiredString(
    input.relationshipCandidateId,
    "Relationship candidate ID",
  );
  if (candidate.candidateId !== relationshipCandidateId) {
    throw new TypeError(
      "Relationship decision candidate ID must match validation context",
    );
  }
  if (input.outcome === "CREATE_NEW") {
    const authorizedState = copyGovernedRelationshipDraft(
      input.authorizedState,
    );
    validateRelationshipSupersession(
      authorizedState,
      input.supersededState,
    );
  }
  return rehydrateRelationshipReconciliationDecision({
    ...input,
    relationshipTypeCode: candidate.relationshipTypeCode,
  });
}

/**
 * Rebuilds a serialized or untrusted runtime decision through the complete
 * canonical allowlist. No process-local token or object identity is required.
 */
export function rehydrateRelationshipReconciliationDecision(
  value: unknown,
): RelationshipReconciliationDecision {
  const input = asObjectRecord(
    value,
    "Relationship reconciliation decision",
  );
  if (
    typeof input.outcome !== "string" ||
    !(Object.values(RELATIONSHIP_RECONCILIATION_OUTCOME) as readonly string[]).includes(
      input.outcome,
    )
  ) {
    throw new TypeError("Unknown relationship reconciliation outcome");
  }
  const outcome = input.outcome as RelationshipReconciliationOutcome;
  const relationshipTypeCode = requiredString(
    input.relationshipTypeCode,
    "Source relationship type code",
  );
  const base = copyRelationshipDecisionBase(
    input,
    outcome,
    relationshipTypeCode,
  );

  if (outcome === "CREATE_NEW") {
    const authorizedState = copyGovernedRelationshipDraft(
      input.authorizedState,
    );
    if (authorizedState.organisationId !== base.organisationId) {
      throw new TypeError(
        "Relationship decision tenant must match authorized state",
      );
    }
    validateSuccessfulRelationshipTypeNormalization(
      relationshipTypeCode,
      authorizedState.relationshipType,
    );
    return Object.freeze({
      ...base,
      outcome,
      authorizedState,
    }) as CreateNewRelationshipReconciliationDecision;
  }

  if (outcome === "MATCH_EXISTING") {
    const matchedState = copyMatchReference(input.matchedState);
    if (matchedState.organisationId !== base.organisationId) {
      throw new TypeError(
        "Relationship decision tenant must match the existing state",
      );
    }
    validateSuccessfulRelationshipTypeNormalization(
      relationshipTypeCode,
      matchedState.relationshipType,
    );
    return Object.freeze({
      ...base,
      outcome,
      matchedState,
    }) as MatchExistingRelationshipReconciliationDecision;
  }

  for (const prohibited of [
    "relationshipId",
    "relationshipStateId",
    "authorizedState",
    "matchedState",
  ]) {
    if (Object.prototype.hasOwnProperty.call(input, prohibited)) {
      throw new TypeError(`${outcome} cannot reference relationship state`);
    }
  }
  return Object.freeze({ ...base, outcome }) as
    | RejectRelationshipReconciliationDecision
    | DeferRelationshipReconciliationDecision;
}

function identifierArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function relationshipSupportsEqual(
  left: RelationshipSupport,
  right: RelationshipSupport,
): boolean {
  return (
    identifierArraysEqual(left.assertionIds, right.assertionIds) &&
    identifierArraysEqual(left.evidenceIds, right.evidenceIds)
  );
}

function behaviorBindingSupportsEqual(
  left: BehaviorBindingSupport,
  right: BehaviorBindingSupport,
): boolean {
  return (
    relationshipSupportsEqual(left.relationship, right.relationship) &&
    relationshipSupportsEqual(
      left.boundTechnicalFingerprint,
      right.boundTechnicalFingerprint,
    ) &&
    relationshipSupportsEqual(
      left.bindingConfiguration.configurationHash,
      right.bindingConfiguration.configurationHash,
    ) &&
    relationshipSupportsEqual(
      left.bindingConfiguration.configurationLocator,
      right.bindingConfiguration.configurationLocator,
    )
  );
}

function lineageTransformationsEqual(
  left: LineageTransformation | undefined,
  right: LineageTransformation | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return (
    left.reference === right.reference &&
    evidenceHashesEqual(left.hash, right.hash) &&
    relationshipSupportsEqual(left.support.reference, right.support.reference) &&
    relationshipSupportsEqual(left.support.hash, right.support.hash)
  );
}

function governedRelationshipStatesEqual(
  left: GovernedRelationshipDraft,
  right: GovernedRelationshipDraft,
): boolean {
  if (
    left.relationshipId !== right.relationshipId ||
    left.relationshipStateId !== right.relationshipStateId ||
    left.organisationId !== right.organisationId ||
    left.relationshipType !== right.relationshipType ||
    !relationshipEndpointsEqual(left.source, right.source) ||
    !relationshipEndpointsEqual(left.target, right.target) ||
    left.validFrom !== right.validFrom ||
    left.validTo !== right.validTo ||
    left.recordedAt !== right.recordedAt ||
    left.supersedesRelationshipStateId !==
      right.supersedesRelationshipStateId
  ) {
    return false;
  }

  if (
    isBehaviorBindingRelationshipType(left.relationshipType) &&
    isBehaviorBindingRelationshipType(right.relationshipType)
  ) {
    const leftBinding =
      left as GovernedRelationshipDraft<BehaviorBindingRelationshipType>;
    const rightBinding =
      right as GovernedRelationshipDraft<BehaviorBindingRelationshipType>;
    return (
      technicalFingerprintsEqual(
        leftBinding.boundTechnicalFingerprint,
        rightBinding.boundTechnicalFingerprint,
      ) &&
      behaviorConfigurationsEqual(
        leftBinding.bindingConfiguration,
        rightBinding.bindingConfiguration,
      ) &&
      behaviorBindingSupportsEqual(leftBinding.support, rightBinding.support)
    );
  }

  if (
    !relationshipSupportsEqual(
      left.support as RelationshipSupport,
      right.support as RelationshipSupport,
    )
  ) {
    return false;
  }
  if (left.relationshipType === "DERIVED_FROM") {
    const leftLineage = left as GovernedRelationshipDraft<"DERIVED_FROM">;
    const rightLineage = right as GovernedRelationshipDraft<"DERIVED_FROM">;
    return lineageTransformationsEqual(
      leftLineage.transformation,
      rightLineage.transformation,
    );
  }
  return true;
}

/**
 * Materializes exactly the state authorized by an auditable CREATE_NEW
 * decision. It cannot accept a discovery candidate or a MATCH/REJECT/DEFER
 * decision. Historical uniqueness and overlap constraints remain repository
 * responsibilities in future tenant-safe 3NF persistence.
 */
export function createGovernedRelationship<
  Type extends GovernedRelationshipType,
>(
  decision: CreateNewRelationshipReconciliationDecision<Type>,
  draft: GovernedRelationshipDraft<Type>,
): GovernedRelationship<Type> {
  const validatedDecision = rehydrateRelationshipReconciliationDecision(
    decision,
  );
  if (validatedDecision.outcome !== "CREATE_NEW") {
    throw new TypeError(
      "Governed relationship requires an approved CREATE_NEW decision",
    );
  }
  const authorizedState = copyGovernedRelationshipDraft(
    validatedDecision.authorizedState,
  );
  const state = copyGovernedRelationshipDraft(draft);
  if (
    validatedDecision.organisationId !== state.organisationId ||
    !governedRelationshipStatesEqual(authorizedState, state)
  ) {
    throw new TypeError(
      "Governed relationship state does not match CREATE_NEW authorization",
    );
  }
  return state as GovernedRelationship<Type>;
}

export type SemanticConceptSourceSignal =
  | {
      readonly sourceCode: string;
      readonly sourceLabel?: string;
    }
  | {
      readonly sourceCode?: never;
      readonly sourceLabel: string;
    };

/**
 * A semantic inference about an already-canonical DataElement. It remains a
 * candidate even at confidence 1 and never creates a SemanticConcept or an
 * assignment. SourceObject ownership is not tenant authority in this pure
 * contract; trusted orchestration must establish that association.
 */
export interface DataElementSemanticConceptAssignmentCandidate {
  readonly candidateId: DataElementSemanticConceptAssignmentCandidateId;
  readonly candidateKind: "DATA_ELEMENT_SEMANTIC_CONCEPT_ASSIGNMENT";
  readonly dataElement: DataElementIdentity;
  readonly sourceObject: SourceObjectIdentity;
  readonly sourceSignal: SemanticConceptSourceSignal;
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly confidence: number;
  readonly inferredAt: IsoTimestamp;
  readonly requiresDecision: true;
  readonly createsAssignment: false;
}

export interface SemanticAssignmentSupport {
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
}

/** One immutable temporal state of a logical DataElement semantic assignment. */
export interface DataElementSemanticConceptAssignmentState {
  readonly assignmentId: DataElementSemanticConceptAssignmentId;
  readonly assignmentStateId: DataElementSemanticConceptAssignmentStateId;
  readonly organisationId: OrganisationId;
  readonly dataElement: DataElementIdentity;
  readonly semanticConcept: SemanticConceptIdentity;
  readonly support: SemanticAssignmentSupport;
  /** Effective valid time is the half-open interval [validFrom, validTo). */
  readonly validFrom: IsoTimestamp;
  readonly validTo?: IsoTimestamp;
  readonly recordedAt: IsoTimestamp;
  /** Correction/replacement of a recorded state, not ordinary succession. */
  readonly supersedesAssignmentStateId?:
    DataElementSemanticConceptAssignmentStateId;
}

export type DataElementSemanticConceptAssignmentDraft =
  DataElementSemanticConceptAssignmentState;

declare const dataElementSemanticConceptAssignmentBrand: unique symbol;

/** Created only from an approved CREATE_NEW semantic assignment decision. */
export type DataElementSemanticConceptAssignment =
  DataElementSemanticConceptAssignmentState & {
    readonly [dataElementSemanticConceptAssignmentBrand]:
      "DataElementSemanticConceptAssignment";
  };

export interface DataElementSemanticConceptAssignmentMatchReference {
  readonly organisationId: OrganisationId;
  readonly assignmentId: DataElementSemanticConceptAssignmentId;
  readonly assignmentStateId: DataElementSemanticConceptAssignmentStateId;
  readonly dataElement: DataElementIdentity;
  readonly semanticConcept: SemanticConceptIdentity;
}

export const SEMANTIC_ASSIGNMENT_RECONCILIATION_OUTCOME = {
  CREATE_NEW: "CREATE_NEW",
  MATCH_EXISTING: "MATCH_EXISTING",
  REJECT: "REJECT",
  DEFER: "DEFER",
} as const;
export type SemanticAssignmentReconciliationOutcome =
  (typeof SEMANTIC_ASSIGNMENT_RECONCILIATION_OUTCOME)[keyof typeof SEMANTIC_ASSIGNMENT_RECONCILIATION_OUTCOME];

export interface SemanticAssignmentReconciliationDecisionBase<
  Outcome extends SemanticAssignmentReconciliationOutcome,
> {
  readonly decisionId: ReconciliationDecisionId;
  /** Trusted orchestration context, never supplied by a source adapter. */
  readonly organisationId: OrganisationId;
  readonly assignmentCandidateId:
    DataElementSemanticConceptAssignmentCandidateId;
  /** Minimal subject binding copied from the validated candidate. */
  readonly candidateDataElement: DataElementIdentity;
  readonly outcome: Outcome;
  readonly authority: ReconciliationAuthority;
  readonly reasonCode: string;
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly decidedAt: IsoTimestamp;
}

declare const semanticAssignmentDecisionBrand: unique symbol;

type SemanticAssignmentDecisionBrand = {
  readonly [semanticAssignmentDecisionBrand]:
    "DataElementSemanticConceptAssignmentReconciliationDecision";
};

export type CreateNewSemanticAssignmentReconciliationDecision =
  SemanticAssignmentReconciliationDecisionBase<"CREATE_NEW"> & {
    readonly authorizedState: DataElementSemanticConceptAssignmentState;
    readonly supersededState?: DataElementSemanticConceptAssignmentState;
  } & SemanticAssignmentDecisionBrand;

export type MatchExistingSemanticAssignmentReconciliationDecision =
  SemanticAssignmentReconciliationDecisionBase<"MATCH_EXISTING"> & {
    readonly matchedState: DataElementSemanticConceptAssignmentMatchReference;
  } & SemanticAssignmentDecisionBrand;

export type RejectSemanticAssignmentReconciliationDecision =
  SemanticAssignmentReconciliationDecisionBase<"REJECT"> & {
    readonly assignmentId?: never;
    readonly assignmentStateId?: never;
    readonly authorizedState?: never;
    readonly matchedState?: never;
  } & SemanticAssignmentDecisionBrand;

export type DeferSemanticAssignmentReconciliationDecision =
  SemanticAssignmentReconciliationDecisionBase<"DEFER"> & {
    readonly assignmentId?: never;
    readonly assignmentStateId?: never;
    readonly authorizedState?: never;
    readonly matchedState?: never;
  } & SemanticAssignmentDecisionBrand;

export type SemanticAssignmentReconciliationDecision =
  | CreateNewSemanticAssignmentReconciliationDecision
  | MatchExistingSemanticAssignmentReconciliationDecision
  | RejectSemanticAssignmentReconciliationDecision
  | DeferSemanticAssignmentReconciliationDecision;

interface SemanticAssignmentReconciliationDecisionDraftBase<
  Outcome extends SemanticAssignmentReconciliationOutcome,
> {
  readonly decisionId: ReconciliationDecisionId;
  readonly organisationId: OrganisationId;
  readonly assignmentCandidateId:
    DataElementSemanticConceptAssignmentCandidateId;
  /** Validation context only; never copied wholesale into the final decision. */
  readonly assignmentCandidate: DataElementSemanticConceptAssignmentCandidate;
  readonly outcome: Outcome;
  readonly authority: ReconciliationAuthority;
  readonly reasonCode: string;
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly decidedAt: IsoTimestamp;
}

export type CreateNewSemanticAssignmentReconciliationDecisionDraft =
  SemanticAssignmentReconciliationDecisionDraftBase<"CREATE_NEW"> & {
    readonly authorizedState: DataElementSemanticConceptAssignmentDraft;
    /** Validation context only; never copied into the final decision. */
    readonly supersededState?: DataElementSemanticConceptAssignmentState;
  };

export type MatchExistingSemanticAssignmentReconciliationDecisionDraft =
  SemanticAssignmentReconciliationDecisionDraftBase<"MATCH_EXISTING"> & {
    readonly matchedState: DataElementSemanticConceptAssignmentMatchReference;
  };

export type RejectSemanticAssignmentReconciliationDecisionDraft =
  SemanticAssignmentReconciliationDecisionDraftBase<"REJECT"> & {
    readonly assignmentId?: never;
    readonly assignmentStateId?: never;
    readonly authorizedState?: never;
    readonly matchedState?: never;
  };

export type DeferSemanticAssignmentReconciliationDecisionDraft =
  SemanticAssignmentReconciliationDecisionDraftBase<"DEFER"> & {
    readonly assignmentId?: never;
    readonly assignmentStateId?: never;
    readonly authorizedState?: never;
    readonly matchedState?: never;
  };

export type SemanticAssignmentReconciliationDecisionDraft =
  | CreateNewSemanticAssignmentReconciliationDecisionDraft
  | MatchExistingSemanticAssignmentReconciliationDecisionDraft
  | RejectSemanticAssignmentReconciliationDecisionDraft
  | DeferSemanticAssignmentReconciliationDecisionDraft;

function copySemanticAssignmentSupport(
  value: unknown,
  label = "Semantic assignment support",
): SemanticAssignmentSupport {
  return copyRelationshipSupport(value, label);
}

function copySemanticAssignmentDataElement(value: unknown): DataElementIdentity {
  return copyRelationshipEndpoint(value, "DATA_ELEMENT") as DataElementIdentity;
}

function semanticAssignmentDataElementsEqual(
  left: DataElementIdentity,
  right: DataElementIdentity,
): boolean {
  return (
    canonicalObjectIdentitiesEqual(left.canonicalObject, right.canonicalObject) &&
    left.dataElementId === right.dataElementId &&
    left.dataAssetId === right.dataAssetId &&
    left.elementPath === right.elementPath
  );
}

function copySemanticConceptIdentity(value: unknown): SemanticConceptIdentity {
  const identity = asObjectRecord(value, "Semantic concept identity");
  if (identity.semanticIdentityKind !== "SEMANTIC_CONCEPT") {
    throw new TypeError(
      "Semantic assignment target must be a SEMANTIC_CONCEPT identity",
    );
  }
  return Object.freeze({
    semanticIdentityKind: "SEMANTIC_CONCEPT",
    organisationId: requiredString(
      identity.organisationId,
      "Semantic concept organisationId",
    ) as OrganisationId,
    semanticConceptId: requiredString(
      identity.semanticConceptId,
      "Semantic concept ID",
    ) as SemanticConceptId,
  });
}

function semanticConceptIdentitiesEqual(
  left: SemanticConceptIdentity,
  right: SemanticConceptIdentity,
): boolean {
  return (
    left.semanticIdentityKind === right.semanticIdentityKind &&
    left.organisationId === right.organisationId &&
    left.semanticConceptId === right.semanticConceptId
  );
}

function copySemanticSourceObject(value: unknown): SourceObjectIdentity {
  const identity = asObjectRecord(value, "Semantic candidate source object");
  return Object.freeze({
    connectionId: requiredString(
      identity.connectionId,
      "Semantic candidate source connectionId",
    ) as SourceConnectionId,
    externalType: requiredString(
      identity.externalType,
      "Semantic candidate source externalType",
    ),
    externalId: requiredString(
      identity.externalId,
      "Semantic candidate source externalId",
    ) as ExternalId,
  });
}

function copySemanticConceptSourceSignal(
  value: unknown,
): SemanticConceptSourceSignal {
  const signal = asObjectRecord(value, "Semantic concept source signal");
  const sourceCode =
    signal.sourceCode === undefined
      ? undefined
      : requiredString(signal.sourceCode, "Semantic sourceCode");
  const sourceLabel =
    signal.sourceLabel === undefined
      ? undefined
      : requiredString(signal.sourceLabel, "Semantic sourceLabel");
  if (sourceCode === undefined && sourceLabel === undefined) {
    throw new TypeError(
      "Semantic concept source signal requires sourceCode or sourceLabel",
    );
  }
  if (sourceCode !== undefined) {
    return Object.freeze({
      sourceCode,
      ...(sourceLabel === undefined ? {} : { sourceLabel }),
    });
  }
  return Object.freeze({ sourceLabel: sourceLabel as string });
}

function copyDataElementSemanticConceptAssignmentCandidate(
  draft: unknown,
): DataElementSemanticConceptAssignmentCandidate {
  const candidate = asObjectRecord(
    draft,
    "DataElement semantic concept assignment candidate",
  );
  if (
    candidate.candidateKind !==
    "DATA_ELEMENT_SEMANTIC_CONCEPT_ASSIGNMENT"
  ) {
    throw new TypeError(
      "Semantic assignment candidate must have kind DATA_ELEMENT_SEMANTIC_CONCEPT_ASSIGNMENT",
    );
  }
  if (candidate.requiresDecision !== true) {
    throw new TypeError("Semantic assignment candidate requires a decision");
  }
  if (candidate.createsAssignment !== false) {
    throw new TypeError("Semantic assignment candidate cannot create an assignment");
  }
  if (
    typeof candidate.confidence !== "number" ||
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    throw new TypeError("Semantic assignment confidence must be between 0 and 1");
  }
  const provenance = copySemanticAssignmentSupport(
    {
      assertionIds: candidate.assertionIds,
      evidenceIds: candidate.evidenceIds,
    },
    "Semantic assignment candidate provenance",
  );
  return Object.freeze({
    candidateId: requiredString(
      candidate.candidateId,
      "Semantic assignment candidate ID",
    ) as DataElementSemanticConceptAssignmentCandidateId,
    candidateKind: "DATA_ELEMENT_SEMANTIC_CONCEPT_ASSIGNMENT",
    dataElement: copySemanticAssignmentDataElement(candidate.dataElement),
    sourceObject: copySemanticSourceObject(candidate.sourceObject),
    sourceSignal: copySemanticConceptSourceSignal(candidate.sourceSignal),
    assertionIds: provenance.assertionIds,
    evidenceIds: provenance.evidenceIds,
    confidence: candidate.confidence,
    inferredAt: requiredTimestamp(
      candidate.inferredAt,
      "Semantic assignment inferredAt",
    ),
    requiresDecision: true,
    createsAssignment: false,
  });
}

export function createDataElementSemanticConceptAssignmentCandidate(
  draft: DataElementSemanticConceptAssignmentCandidate,
): DataElementSemanticConceptAssignmentCandidate {
  return copyDataElementSemanticConceptAssignmentCandidate(draft);
}

function copyDataElementSemanticConceptAssignmentState(
  value: unknown,
): DataElementSemanticConceptAssignmentState {
  const state = asObjectRecord(value, "DataElement semantic assignment state");
  const organisationId = requiredString(
    state.organisationId,
    "Semantic assignment organisationId",
  ) as OrganisationId;
  const dataElement = copySemanticAssignmentDataElement(state.dataElement);
  const semanticConcept = copySemanticConceptIdentity(state.semanticConcept);
  if (
    dataElement.canonicalObject.organisationId !== organisationId ||
    semanticConcept.organisationId !== organisationId
  ) {
    throw new TypeError(
      "Semantic assignment tenant must match DataElement and SemanticConcept",
    );
  }
  const validFrom = requiredTimestamp(
    state.validFrom,
    "Semantic assignment validFrom",
  );
  const validTo =
    state.validTo === undefined
      ? undefined
      : requiredTimestamp(state.validTo, "Semantic assignment validTo");
  if (validTo !== undefined && Date.parse(validTo) <= Date.parse(validFrom)) {
    throw new TypeError(
      "Semantic assignment validTo must be greater than validFrom",
    );
  }
  const supersedesAssignmentStateId =
    state.supersedesAssignmentStateId === undefined
      ? undefined
      : (requiredString(
          state.supersedesAssignmentStateId,
          "Superseded semantic assignment state ID",
        ) as DataElementSemanticConceptAssignmentStateId);
  return Object.freeze({
    assignmentId: requiredString(
      state.assignmentId,
      "Semantic assignment ID",
    ) as DataElementSemanticConceptAssignmentId,
    assignmentStateId: requiredString(
      state.assignmentStateId,
      "Semantic assignment state ID",
    ) as DataElementSemanticConceptAssignmentStateId,
    organisationId,
    dataElement,
    semanticConcept,
    support: copySemanticAssignmentSupport(state.support),
    validFrom,
    ...(validTo === undefined ? {} : { validTo }),
    recordedAt: requiredTimestamp(
      state.recordedAt,
      "Semantic assignment recordedAt",
    ),
    ...(supersedesAssignmentStateId === undefined
      ? {}
      : { supersedesAssignmentStateId }),
  });
}

function semanticAssignmentStatesEqual(
  left: DataElementSemanticConceptAssignmentState,
  right: DataElementSemanticConceptAssignmentState,
): boolean {
  return (
    left.assignmentId === right.assignmentId &&
    left.assignmentStateId === right.assignmentStateId &&
    left.organisationId === right.organisationId &&
    semanticAssignmentDataElementsEqual(left.dataElement, right.dataElement) &&
    semanticConceptIdentitiesEqual(
      left.semanticConcept,
      right.semanticConcept,
    ) &&
    relationshipSupportsEqual(left.support, right.support) &&
    left.validFrom === right.validFrom &&
    left.validTo === right.validTo &&
    left.recordedAt === right.recordedAt &&
    left.supersedesAssignmentStateId === right.supersedesAssignmentStateId
  );
}

function validateSemanticAssignmentSupersession(
  current: DataElementSemanticConceptAssignmentState,
  supersededState: unknown,
): DataElementSemanticConceptAssignmentState | undefined {
  if (current.supersedesAssignmentStateId === undefined) {
    if (supersededState !== undefined) {
      throw new TypeError(
        "Superseded semantic assignment context requires supersedesAssignmentStateId",
      );
    }
    return undefined;
  }
  if (supersededState === undefined) {
    throw new TypeError(
      "Semantic assignment supersession requires the exact prior state",
    );
  }
  const prior = copyDataElementSemanticConceptAssignmentState(supersededState);
  if (
    prior.assignmentStateId !== current.supersedesAssignmentStateId ||
    prior.assignmentId !== current.assignmentId ||
    prior.organisationId !== current.organisationId ||
    !semanticAssignmentDataElementsEqual(
      prior.dataElement,
      current.dataElement,
    ) ||
    !semanticConceptIdentitiesEqual(
      prior.semanticConcept,
      current.semanticConcept,
    )
  ) {
    throw new TypeError(
      "Semantic assignment supersession must preserve identity, tenant, DataElement, and SemanticConcept",
    );
  }
  if (prior.assignmentStateId === current.assignmentStateId) {
    throw new TypeError(
      "Semantic assignment supersession requires a new assignmentStateId",
    );
  }
  if (Date.parse(current.recordedAt) <= Date.parse(prior.recordedAt)) {
    throw new TypeError(
      "Superseding semantic assignment state must be recorded later",
    );
  }
  return prior;
}

function copySemanticAssignmentMatchReference(
  value: unknown,
): DataElementSemanticConceptAssignmentMatchReference {
  const reference = asObjectRecord(
    value,
    "Matched DataElement semantic assignment state",
  );
  const organisationId = requiredString(
    reference.organisationId,
    "Matched semantic assignment organisationId",
  ) as OrganisationId;
  const dataElement = copySemanticAssignmentDataElement(reference.dataElement);
  const semanticConcept = copySemanticConceptIdentity(
    reference.semanticConcept,
  );
  if (
    dataElement.canonicalObject.organisationId !== organisationId ||
    semanticConcept.organisationId !== organisationId
  ) {
    throw new TypeError(
      "Matched semantic assignment tenant must match DataElement and SemanticConcept",
    );
  }
  return Object.freeze({
    organisationId,
    assignmentId: requiredString(
      reference.assignmentId,
      "Matched semantic assignment ID",
    ) as DataElementSemanticConceptAssignmentId,
    assignmentStateId: requiredString(
      reference.assignmentStateId,
      "Matched semantic assignment state ID",
    ) as DataElementSemanticConceptAssignmentStateId,
    dataElement,
    semanticConcept,
  });
}

function copySemanticAssignmentDecisionBase(
  value: Readonly<Record<string, unknown>>,
  outcome: SemanticAssignmentReconciliationOutcome,
): SemanticAssignmentReconciliationDecisionBase<SemanticAssignmentReconciliationOutcome> {
  const provenance = copySemanticAssignmentSupport(
    {
      assertionIds: value.assertionIds,
      evidenceIds: value.evidenceIds,
    },
    "Semantic assignment decision provenance",
  );
  const organisationId = requiredString(
    value.organisationId,
    "Semantic assignment decision organisationId",
  ) as OrganisationId;
  const candidateDataElement = copySemanticAssignmentDataElement(
    value.candidateDataElement,
  );
  if (candidateDataElement.canonicalObject.organisationId !== organisationId) {
    throw new TypeError(
      "Semantic assignment decision tenant must match candidate DataElement",
    );
  }
  return {
    decisionId: requiredString(
      value.decisionId,
      "Semantic assignment decision ID",
    ) as ReconciliationDecisionId,
    organisationId,
    assignmentCandidateId: requiredString(
      value.assignmentCandidateId,
      "Semantic assignment candidate ID",
    ) as DataElementSemanticConceptAssignmentCandidateId,
    candidateDataElement,
    outcome,
    authority: copyReconciliationAuthority(value.authority),
    reasonCode: requiredString(
      value.reasonCode,
      "Semantic assignment decision reasonCode",
    ),
    assertionIds: provenance.assertionIds,
    evidenceIds: provenance.evidenceIds,
    decidedAt: requiredTimestamp(
      value.decidedAt,
      "Semantic assignment decision decidedAt",
    ),
  };
}

export function createSemanticAssignmentReconciliationDecision(
  draft: CreateNewSemanticAssignmentReconciliationDecisionDraft,
): CreateNewSemanticAssignmentReconciliationDecision;
export function createSemanticAssignmentReconciliationDecision(
  draft: MatchExistingSemanticAssignmentReconciliationDecisionDraft,
): MatchExistingSemanticAssignmentReconciliationDecision;
export function createSemanticAssignmentReconciliationDecision(
  draft: RejectSemanticAssignmentReconciliationDecisionDraft,
): RejectSemanticAssignmentReconciliationDecision;
export function createSemanticAssignmentReconciliationDecision(
  draft: DeferSemanticAssignmentReconciliationDecisionDraft,
): DeferSemanticAssignmentReconciliationDecision;
export function createSemanticAssignmentReconciliationDecision(
  draft: SemanticAssignmentReconciliationDecisionDraft,
): SemanticAssignmentReconciliationDecision;
export function createSemanticAssignmentReconciliationDecision(
  draft: unknown,
): unknown {
  const input = asObjectRecord(
    draft,
    "Semantic assignment reconciliation decision draft",
  );
  const candidate = copyDataElementSemanticConceptAssignmentCandidate(
    input.assignmentCandidate,
  );
  const assignmentCandidateId = requiredString(
    input.assignmentCandidateId,
    "Semantic assignment candidate ID",
  );
  if (candidate.candidateId !== assignmentCandidateId) {
    throw new TypeError(
      "Semantic assignment decision candidate ID must match validation context",
    );
  }
  return rehydrateSemanticAssignmentReconciliationDecision({
    ...input,
    candidateDataElement: candidate.dataElement,
  });
}

/**
 * Rebuilds an untrusted or serialized decision through a complete structural
 * allowlist. Authentication and persistence authenticity remain future
 * service/repository responsibilities.
 */
export function rehydrateSemanticAssignmentReconciliationDecision(
  value: unknown,
): SemanticAssignmentReconciliationDecision {
  const input = asObjectRecord(
    value,
    "Semantic assignment reconciliation decision",
  );
  if (
    typeof input.outcome !== "string" ||
    !(
      Object.values(
        SEMANTIC_ASSIGNMENT_RECONCILIATION_OUTCOME,
      ) as readonly string[]
    ).includes(input.outcome)
  ) {
    throw new TypeError("Unknown semantic assignment reconciliation outcome");
  }
  const outcome = input.outcome as SemanticAssignmentReconciliationOutcome;
  const base = copySemanticAssignmentDecisionBase(input, outcome);

  if (outcome === "CREATE_NEW") {
    const authorizedState = copyDataElementSemanticConceptAssignmentState(
      input.authorizedState,
    );
    const supersededState = validateSemanticAssignmentSupersession(
      authorizedState,
      input.supersededState,
    );
    if (
      authorizedState.organisationId !== base.organisationId ||
      !semanticAssignmentDataElementsEqual(
        authorizedState.dataElement,
        base.candidateDataElement,
      )
    ) {
      throw new TypeError(
        "CREATE_NEW semantic assignment must match candidate DataElement and tenant",
      );
    }
    return Object.freeze({
      ...base,
      outcome,
      authorizedState,
      ...(supersededState === undefined ? {} : { supersededState }),
    }) as CreateNewSemanticAssignmentReconciliationDecision;
  }

  if (outcome === "MATCH_EXISTING") {
    const matchedState = copySemanticAssignmentMatchReference(
      input.matchedState,
    );
    if (
      matchedState.organisationId !== base.organisationId ||
      !semanticAssignmentDataElementsEqual(
        matchedState.dataElement,
        base.candidateDataElement,
      )
    ) {
      throw new TypeError(
        "MATCH_EXISTING semantic assignment must match candidate DataElement and tenant",
      );
    }
    return Object.freeze({
      ...base,
      outcome,
      matchedState,
    }) as MatchExistingSemanticAssignmentReconciliationDecision;
  }

  for (const prohibited of [
    "assignmentId",
    "assignmentStateId",
    "authorizedState",
    "matchedState",
    "supersededState",
  ]) {
    if (Object.prototype.hasOwnProperty.call(input, prohibited)) {
      throw new TypeError(`${outcome} cannot reference semantic assignment state`);
    }
  }
  return Object.freeze({ ...base, outcome }) as
    | RejectSemanticAssignmentReconciliationDecision
    | DeferSemanticAssignmentReconciliationDecision;
}

/**
 * Materializes only the exact normalized state approved by a complete
 * CREATE_NEW decision. Repository-wide uniqueness and interval overlap remain
 * future tenant-safe persistence responsibilities.
 */
export function createDataElementSemanticConceptAssignment(
  decision: CreateNewSemanticAssignmentReconciliationDecision,
  draft: DataElementSemanticConceptAssignmentDraft,
): DataElementSemanticConceptAssignment {
  const validatedDecision =
    rehydrateSemanticAssignmentReconciliationDecision(decision);
  if (validatedDecision.outcome !== "CREATE_NEW") {
    throw new TypeError(
      "Governed semantic assignment requires an approved CREATE_NEW decision",
    );
  }
  const authorizedState = copyDataElementSemanticConceptAssignmentState(
    validatedDecision.authorizedState,
  );
  const state = copyDataElementSemanticConceptAssignmentState(draft);
  if (
    validatedDecision.organisationId !== state.organisationId ||
    !semanticAssignmentStatesEqual(authorizedState, state)
  ) {
    throw new TypeError(
      "Semantic assignment state does not match CREATE_NEW authorization",
    );
  }
  return state as DataElementSemanticConceptAssignment;
}

export type ReconciliationSubjectReference<
  Kind extends CanonicalObjectKind = CanonicalObjectKind,
> =
  | {
      readonly subjectKind: "CANDIDATE";
      readonly candidateId: NormalizedCandidateId;
      readonly candidateKind: Kind;
    }
  | {
      readonly subjectKind: "CANDIDATE_MERGE";
      readonly candidateMergeId: CandidateMergeId;
      readonly candidateKind: Kind;
    };

export interface ReconciliationDecisionBase<
  Outcome extends ReconciliationOutcome,
  Kind extends CanonicalObjectKind = CanonicalObjectKind,
> {
  readonly decisionId: ReconciliationDecisionId;
  /** Trusted server-side context, never adapter authority. */
  readonly organisationId: OrganisationId;
  readonly outcome: Outcome;
  readonly candidateKind: Kind;
  readonly authority: ReconciliationAuthority;
  readonly reasonCode: string;
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly decidedAt: IsoTimestamp;
}

export type CreateNewReconciliationDecision = {
  [Kind in CanonicalObjectKind]: ReconciliationDecisionBase<
    "CREATE_NEW",
    Kind
  > & {
    readonly subject: ReconciliationSubjectReference<Kind>;
    readonly canonicalObject: CanonicalObjectIdentity<Kind>;
  };
}[CanonicalObjectKind];

export type MatchExistingReconciliationDecision = {
  [Kind in CanonicalObjectKind]: ReconciliationDecisionBase<
    "MATCH_EXISTING",
    Kind
  > & {
    readonly subject: ReconciliationSubjectReference<Kind>;
    readonly canonicalObject: CanonicalObjectIdentity<Kind>;
  };
}[CanonicalObjectKind];

export type MergeCandidatesReconciliationDecision =
  ReconciliationDecisionBase<"MERGE_CANDIDATES"> & {
    readonly contributingCandidateIds: MultipleCandidateIds;
    readonly candidateMergeId: CandidateMergeId;
    readonly canonicalObject?: never;
  };

export type RejectReconciliationDecision = {
  [Kind in CanonicalObjectKind]: ReconciliationDecisionBase<"REJECT", Kind> & {
    readonly subject: ReconciliationSubjectReference<Kind>;
    readonly canonicalObject?: never;
  };
}[CanonicalObjectKind];

export type DeferReconciliationDecision = {
  [Kind in CanonicalObjectKind]: ReconciliationDecisionBase<"DEFER", Kind> & {
    readonly subject: ReconciliationSubjectReference<Kind>;
    readonly canonicalObject?: never;
  };
}[CanonicalObjectKind];

export type ReconciliationDecision =
  | CreateNewReconciliationDecision
  | MatchExistingReconciliationDecision
  | MergeCandidatesReconciliationDecision
  | RejectReconciliationDecision
  | DeferReconciliationDecision;

/**
 * MERGE_CANDIDATES is deliberately out of scope here: it is only ever produced
 * from createCandidateMergeRecord, never through this factory.
 */
export type ObjectReconciliationDecisionDraft =
  | CreateNewReconciliationDecision
  | MatchExistingReconciliationDecision
  | RejectReconciliationDecision
  | DeferReconciliationDecision;

const OBJECT_RECONCILIATION_OUTCOMES = [
  RECONCILIATION_OUTCOME.CREATE_NEW,
  RECONCILIATION_OUTCOME.MATCH_EXISTING,
  RECONCILIATION_OUTCOME.REJECT,
  RECONCILIATION_OUTCOME.DEFER,
] as const;
type ObjectReconciliationOutcome = (typeof OBJECT_RECONCILIATION_OUTCOMES)[number];

const OBJECT_RECONCILIATION_BASE_FIELDS = [
  "decisionId",
  "organisationId",
  "outcome",
  "candidateKind",
  "authority",
  "reasonCode",
  "assertionIds",
  "evidenceIds",
  "decidedAt",
  "subject",
] as const;

function assertOnlyAllowedReconciliationFields(
  input: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  outcome: string,
): void {
  const allowedFields = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!allowedFields.has(key)) {
      throw new TypeError(
        `${outcome} object reconciliation decision cannot include field "${key}"`,
      );
    }
  }
}

function copyReconciliationSubjectReference(
  value: unknown,
  candidateKind: CanonicalObjectKind,
  label = "Object reconciliation decision subject",
): ReconciliationSubjectReference {
  const subject = asObjectRecord(value, label);
  const subjectCandidateKind = requiredString(
    subject.candidateKind,
    `${label} candidateKind`,
  );
  if (
    !isCanonicalObjectKind(subjectCandidateKind) ||
    subjectCandidateKind !== candidateKind
  ) {
    throw new TypeError(
      `${label} candidateKind must match the decision candidateKind`,
    );
  }

  if (subject.subjectKind === "CANDIDATE") {
    return Object.freeze({
      subjectKind: "CANDIDATE",
      candidateId: requiredString(
        subject.candidateId,
        `${label} candidateId`,
      ) as NormalizedCandidateId,
      candidateKind: subjectCandidateKind,
    });
  }
  if (subject.subjectKind === "CANDIDATE_MERGE") {
    return Object.freeze({
      subjectKind: "CANDIDATE_MERGE",
      candidateMergeId: requiredString(
        subject.candidateMergeId,
        `${label} candidateMergeId`,
      ) as CandidateMergeId,
      candidateKind: subjectCandidateKind,
    });
  }
  throw new TypeError(`${label} must be a CANDIDATE or CANDIDATE_MERGE reference`);
}

function copyReconciliationCanonicalObjectIdentity(
  value: unknown,
  organisationId: OrganisationId,
  candidateKind: CanonicalObjectKind,
  label = "Object reconciliation decision canonicalObject",
): CanonicalObjectIdentity {
  const identity = asObjectRecord(value, label);
  const kind = requiredString(identity.kind, `${label} kind`);
  if (!isCanonicalObjectKind(kind) || kind !== candidateKind) {
    throw new TypeError(
      `${label} kind must match the decision candidateKind`,
    );
  }
  const identityOrganisationId = requiredString(
    identity.organisationId,
    `${label} organisationId`,
  );
  if (identityOrganisationId !== organisationId) {
    throw new TypeError(
      `${label} organisationId must match the reconciliation decision organisationId`,
    );
  }
  return Object.freeze({
    organisationId: identityOrganisationId as OrganisationId,
    objectId: requiredString(identity.objectId, `${label} objectId`) as CanonicalObjectId,
    kind,
  });
}

function copyObjectReconciliationDecisionBase(
  input: Readonly<Record<string, unknown>>,
  outcome: ObjectReconciliationOutcome,
): ReconciliationDecisionBase<ObjectReconciliationOutcome> {
  const authority = copyReconciliationAuthority(input.authority);
  if (authority.authorityKind !== "HUMAN") {
    throw new TypeError(
      "Object reconciliation decision requires HUMAN authority",
    );
  }
  const candidateKind = requiredString(
    input.candidateKind,
    "Object reconciliation decision candidateKind",
  );
  if (!isCanonicalObjectKind(candidateKind)) {
    throw new TypeError(
      "Object reconciliation decision candidateKind must be a canonical object kind",
    );
  }
  const provenance = copyRelationshipSupport(
    { assertionIds: input.assertionIds, evidenceIds: input.evidenceIds },
    "Object reconciliation decision provenance",
  );
  return {
    decisionId: requiredString(
      input.decisionId,
      "Object reconciliation decision ID",
    ) as ReconciliationDecisionId,
    organisationId: requiredString(
      input.organisationId,
      "Object reconciliation decision organisationId",
    ) as OrganisationId,
    outcome,
    candidateKind,
    authority,
    reasonCode: requiredString(
      input.reasonCode,
      "Object reconciliation decision reasonCode",
    ),
    assertionIds: provenance.assertionIds,
    evidenceIds: provenance.evidenceIds,
    decidedAt: requiredTimestamp(
      input.decidedAt,
      "Object reconciliation decision decidedAt",
    ),
  };
}

/**
 * Rebuilds a serialized or untrusted runtime object-reconciliation decision
 * through a complete structural allowlist, mirroring the relationship and
 * semantic-assignment rehydration pattern. It never accepts MERGE_CANDIDATES
 * (that outcome is only ever produced by createCandidateMergeRecord) and
 * fails closed on any field not defined by the exact outcome's shape.
 */
export function rehydrateObjectReconciliationDecision(
  value: unknown,
): ReconciliationDecision {
  const input = asObjectRecord(value, "Object reconciliation decision");

  if (
    typeof input.outcome !== "string" ||
    !(OBJECT_RECONCILIATION_OUTCOMES as readonly string[]).includes(
      input.outcome,
    )
  ) {
    throw new TypeError("Unknown object reconciliation outcome");
  }
  const outcome = input.outcome as ObjectReconciliationOutcome;

  const materializes = outcome === "CREATE_NEW" || outcome === "MATCH_EXISTING";
  assertOnlyAllowedReconciliationFields(
    input,
    materializes
      ? [...OBJECT_RECONCILIATION_BASE_FIELDS, "canonicalObject"]
      : OBJECT_RECONCILIATION_BASE_FIELDS,
    outcome,
  );

  const base = copyObjectReconciliationDecisionBase(input, outcome);
  const subject = copyReconciliationSubjectReference(
    input.subject,
    base.candidateKind,
  );

  if (materializes) {
    if (!Object.prototype.hasOwnProperty.call(input, "canonicalObject")) {
      throw new TypeError(
        `${outcome} object reconciliation decision requires a canonicalObject identity`,
      );
    }
    const canonicalObject = copyReconciliationCanonicalObjectIdentity(
      input.canonicalObject,
      base.organisationId,
      base.candidateKind,
    );
    return Object.freeze({ ...base, outcome, subject, canonicalObject }) as
      | CreateNewReconciliationDecision
      | MatchExistingReconciliationDecision;
  }

  return Object.freeze({ ...base, outcome, subject }) as
    | RejectReconciliationDecision
    | DeferReconciliationDecision;
}

export function createObjectReconciliationDecision(
  draft: CreateNewReconciliationDecision,
): CreateNewReconciliationDecision;
export function createObjectReconciliationDecision(
  draft: MatchExistingReconciliationDecision,
): MatchExistingReconciliationDecision;
export function createObjectReconciliationDecision(
  draft: RejectReconciliationDecision,
): RejectReconciliationDecision;
export function createObjectReconciliationDecision(
  draft: DeferReconciliationDecision,
): DeferReconciliationDecision;
export function createObjectReconciliationDecision(
  draft: ObjectReconciliationDecisionDraft,
): ReconciliationDecision;
export function createObjectReconciliationDecision(draft: unknown): unknown {
  return rehydrateObjectReconciliationDecision(draft);
}

/** Created by trusted reconciliation, never accepted from an adapter payload. */
export interface ObjectSourceMapping {
  readonly mappingId: ObjectSourceMappingId;
  readonly canonicalObject: CanonicalObjectIdentity;
  readonly sourceObject: SourceObjectIdentity;
  readonly status: ObjectSourceMappingStatus;
  readonly matchMethod: ObjectSourceMatchMethod;
  readonly confidence?: number;
  readonly validFrom: IsoTimestamp;
  readonly validTo?: IsoTimestamp;
}

/** Auditable mapping output of a successful final reconciliation decision. */
export interface ReconciledObjectSourceMapping extends ObjectSourceMapping {
  readonly status: "CONFIRMED";
  readonly reconciliationDecisionId: ReconciliationDecisionId;
}

/**
 * Vendor-neutral inbound transport. It intentionally contains no tenant or
 * organisation field and cannot submit canonical mappings.
 */
export interface InboundAdapterEnvelope {
  readonly contractVersion: CanonicalContractVersion;
  readonly sourceSystem: SourceSystem;
  readonly connection: SourceConnectionReference;
  readonly run: AcquisitionRun;
  readonly objects: readonly SourceObject[];
  readonly snapshots: readonly SourceSnapshotReference[];
  readonly assertions: readonly SourceAssertion[];
  readonly findings: readonly DiscoveryFinding[];
  readonly evidence: readonly Evidence[];
  readonly candidates: readonly NormalizedCandidate[];
}
