import type {
  AcquisitionRunId,
  AgentId,
  AgentVersionId,
  ApiId,
  CandidateMergeId,
  CanonicalObjectId,
  DataAssetId,
  DataElementId,
  DataKeyDefinitionId,
  DiscoveryFindingId,
  EvidenceId,
  ExternalId,
  ForeignKeyDefinitionId,
  IsoTimestamp,
  KnowledgeBaseId,
  McpServerId,
  ModelId,
  NormalizedCandidateId,
  ObjectSourceMappingId,
  OrganisationId,
  PromptId,
  ReconciliationDecisionId,
  SanitizedEvidenceLocator,
  SourceAssertionId,
  SourceConnectionId,
  SourceSnapshotId,
  SourceSystemId,
  ToolId,
} from "./identifiers.ts";

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

/** V1A.1 is deliberately closed to these ten governed technical kinds. */
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
  readonly algorithm: string;
  readonly value: string;
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
