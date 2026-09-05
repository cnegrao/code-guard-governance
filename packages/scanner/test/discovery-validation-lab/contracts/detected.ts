export const DETECTION_CATEGORY = {
  AGENT: "AGENT",
  DATA_ASSET: "DATA_ASSET",
  DATA_ELEMENT: "DATA_ELEMENT",
  MODEL: "MODEL",
  TOOL: "TOOL",
  MCP_SERVER: "MCP_SERVER",
  API: "API",
  PROMPT: "PROMPT",
  KNOWLEDGE_BASE: "KNOWLEDGE_BASE",
  RELATIONSHIP: "RELATIONSHIP",
} as const;

export type DetectionCategory =
  (typeof DETECTION_CATEGORY)[keyof typeof DETECTION_CATEGORY];

export const DISCOVERY_RELATIONSHIP_TYPE = {
  USES_MODEL: "USES_MODEL",
  INVOKES: "INVOKES",
  READS_FROM: "READS_FROM",
  WRITES_TO: "WRITES_TO",
  CONTAINS: "CONTAINS",
  DERIVED_FROM: "DERIVED_FROM",
  HANDOFF_TO: "HANDOFF_TO",
  USES_TOOL: "USES_TOOL",
  USES_MCP: "USES_MCP",
  USES_KNOWLEDGE_BASE: "USES_KNOWLEDGE_BASE",
} as const;

export type DiscoveryRelationshipType =
  (typeof DISCOVERY_RELATIONSHIP_TYPE)[keyof typeof DISCOVERY_RELATIONSHIP_TYPE];

export const DISCOVERY_TRUST_STATE = {
  INFERRED: "INFERRED",
  DECLARED: "DECLARED",
  IMPORTED: "IMPORTED",
  OBSERVED: "OBSERVED",
  VALIDATED: "VALIDATED",
} as const;

export type DiscoveryTrustState =
  (typeof DISCOVERY_TRUST_STATE)[keyof typeof DISCOVERY_TRUST_STATE];

export interface DetectionMethod {
  readonly code: string;
  readonly version?: string;
}

export interface DetectionConfidence {
  readonly value: number;
  readonly scale: "ZERO_TO_ONE" | "PERCENT";
}

interface DetectedItemBase {
  /** Stable only inside one detected result; this is not a canonical ID. */
  readonly detectedKey: string;
  readonly method: DetectionMethod;
  readonly confidence?: DetectionConfidence;
  readonly trustState?: DiscoveryTrustState;
  readonly evidenceKeys?: readonly string[];
}

export interface DetectedAgent extends DetectedItemBase {
  readonly kind: "AGENT";
  readonly sourcePath: string;
  readonly declarationKey?: string;
  readonly displayName?: string;
}

export interface DetectedDataAsset extends DetectedItemBase {
  readonly kind: "DATA_ASSET";
  /** Qualified source identity, opaque to the Lab. */
  readonly sourceIdentity: string;
  readonly sourcePath?: string;
  readonly displayName?: string;
}

export interface DetectedDataElement extends DetectedItemBase {
  readonly kind: "DATA_ELEMENT";
  /** References DetectedDataAsset.detectedKey. */
  readonly parentDataAssetKey: string;
  readonly elementPath: string;
  readonly sourcePath?: string;
  readonly displayName?: string;
}

export interface DetectedModel extends DetectedItemBase {
  readonly kind: "MODEL";
  readonly provider?: string;
  readonly modelReference: string;
  readonly sourcePath?: string;
  readonly declarationKey?: string;
}

export interface DetectedTool extends DetectedItemBase {
  readonly kind: "TOOL";
  readonly sourcePath: string;
  readonly declarationKey: string;
}

export interface DetectedMcpServer extends DetectedItemBase {
  readonly kind: "MCP_SERVER";
  readonly serverIdentity: string;
  readonly sourcePath?: string;
}

export interface DetectedApi extends DetectedItemBase {
  readonly kind: "API";
  readonly apiIdentity: string;
  readonly sourcePath?: string;
}

export interface DetectedPrompt extends DetectedItemBase {
  readonly kind: "PROMPT";
  readonly sourcePath: string;
  readonly declarationKey: string;
}

export interface DetectedKnowledgeBase extends DetectedItemBase {
  readonly kind: "KNOWLEDGE_BASE";
  readonly sourceIdentity: string;
  readonly sourcePath?: string;
}

export interface DetectedRelationship extends DetectedItemBase {
  readonly kind: "RELATIONSHIP";
  readonly relationshipType: DiscoveryRelationshipType;
  /** References the detectedKey of the directional endpoints. */
  readonly sourceKey: string;
  readonly targetKey: string;
}

export interface DetectedEvidence {
  readonly evidenceKey: string;
  /** References a detected entity or relationship key. */
  readonly subjectKey: string;
  readonly sourceLocator: string;
  readonly method: DetectionMethod;
  readonly lineStart?: number;
  readonly lineEnd?: number;
}

/** Scanner-neutral exchange shape for the test harness, never persistence. */
export interface DetectedScenarioResult {
  readonly scenarioId: string;
  readonly runId?: string;
  readonly scannedAt?: string;
  readonly agents: readonly DetectedAgent[];
  readonly dataAssets: readonly DetectedDataAsset[];
  readonly dataElements: readonly DetectedDataElement[];
  /** Optional only for compatibility with pre-Slice-3A test inputs. */
  readonly models?: readonly DetectedModel[];
  readonly tools?: readonly DetectedTool[];
  readonly mcpServers?: readonly DetectedMcpServer[];
  readonly apis?: readonly DetectedApi[];
  readonly prompts?: readonly DetectedPrompt[];
  readonly knowledgeBases?: readonly DetectedKnowledgeBase[];
  readonly relationships: readonly DetectedRelationship[];
  readonly evidence: readonly DetectedEvidence[];
}
