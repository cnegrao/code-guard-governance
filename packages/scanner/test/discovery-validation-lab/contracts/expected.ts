import type {
  DetectionCategory,
  DiscoveryRelationshipType,
} from "./detected.ts";

export const EXPECTED_SCENARIO_SCHEMA_VERSION = "1.0" as const;

export const DISCOVERY_LAYER = {
  L0: "L0",
  L1: "L1",
  L2: "L2",
  L3: "L3",
  L4: "L4",
  L5: "L5",
  L6: "L6",
  L7: "L7",
  L8: "L8",
  L9: "L9",
  L10: "L10",
  L11: "L11",
  L12: "L12",
  L13: "L13",
  L14: "L14",
  L15: "L15",
  L16: "L16",
} as const;

export type DiscoveryLayer =
  (typeof DISCOVERY_LAYER)[keyof typeof DISCOVERY_LAYER];

export type ImplementationRound = 1 | 2 | 3 | 4 | 5;

interface ExpectedItemBase {
  /** Stable test-only key used by relationships and evidence requirements. */
  readonly key: string;
  /** First cumulative implementation round in which this expectation is scored. */
  readonly requiredFromRound: ImplementationRound;
  readonly discoveryLayers: readonly DiscoveryLayer[];
  /** Exact alternative comparison keys. Fuzzy aliases are not supported. */
  readonly comparisonAliases?: readonly string[];
}

export interface ExpectedAgent extends ExpectedItemBase {
  readonly sourcePath: string;
  readonly declarationKey?: string;
  readonly displayName?: string;
}

export interface ExpectedDataAsset extends ExpectedItemBase {
  /** Qualified source identity, not a production canonical ID. */
  readonly sourceIdentity: string;
  readonly sourcePath?: string;
  readonly displayName?: string;
}

export interface ExpectedDataElement extends ExpectedItemBase {
  readonly parentDataAssetKey: string;
  readonly elementPath: string;
  readonly sourcePath?: string;
  readonly displayName?: string;
}

export interface ExpectedRelationship extends ExpectedItemBase {
  readonly relationshipType: DiscoveryRelationshipType;
  readonly sourceKey: string;
  readonly targetKey: string;
}

export interface ExpectedEvidenceRequirement {
  readonly key: string;
  /** First cumulative implementation round in which this expectation is scored. */
  readonly requiredFromRound: ImplementationRound;
  readonly subjectKey: string;
  readonly sourceLocator: string;
  readonly methodCode?: string;
  readonly discoveryLayers: readonly DiscoveryLayer[];
}

export interface ProhibitedExpectation {
  readonly key: string;
  /** First cumulative implementation round in which this expectation is scored. */
  readonly requiredFromRound: ImplementationRound;
  readonly category: DetectionCategory;
  readonly comparisonKey: string;
  readonly description: string;
  readonly discoveryLayers: readonly DiscoveryLayer[];
}

export interface ExpectedSemanticConcept {
  readonly code: string;
  /** First cumulative implementation round in which this expectation is scored. */
  readonly requiredFromRound: ImplementationRound;
  readonly description?: string;
  /** Related DataElement test keys; this never asserts physical identity. */
  readonly memberDataElementKeys: readonly string[];
}

/** Test oracle only. It is not a canonical or persistence contract. */
export interface ExpectedScenario {
  readonly schemaVersion: typeof EXPECTED_SCENARIO_SCHEMA_VERSION;
  readonly scenarioId: string;
  readonly description: string;
  readonly targetRound: ImplementationRound;
  readonly discoveryLayers: readonly DiscoveryLayer[];
  readonly agents: readonly ExpectedAgent[];
  readonly dataAssets: readonly ExpectedDataAsset[];
  readonly dataElements: readonly ExpectedDataElement[];
  readonly relationships: readonly ExpectedRelationship[];
  readonly evidenceRequirements: readonly ExpectedEvidenceRequirement[];
  readonly prohibited: readonly ProhibitedExpectation[];
  readonly semanticConcepts: readonly ExpectedSemanticConcept[];
}
