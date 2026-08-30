import { isDiscoveryPathExcluded } from "../../../src/discovery/path-policy.ts";
import type {
  DetectedAgent,
  DetectedDataAsset,
  DetectedDataElement,
  DetectedEvidence,
  DetectedRelationship,
  DetectedScenarioResult,
  DetectionConfidence,
  DetectionMethod,
  DiscoveryRelationshipType,
  DiscoveryTrustState,
} from "../contracts/detected.ts";

export interface NormalizedDetectionMethod {
  readonly code: string;
  readonly version: string | null;
}

interface NormalizedDetectedItemBase {
  readonly detectedKey: string;
  readonly comparisonKey: string;
  readonly method: NormalizedDetectionMethod;
  readonly confidence: number | null;
  readonly trustState: DiscoveryTrustState | null;
  readonly evidenceKeys: readonly string[];
}

export interface NormalizedDetectedAgent extends NormalizedDetectedItemBase {
  readonly kind: "AGENT";
  readonly sourcePath: string;
  readonly declarationKey: string | null;
  readonly displayName: string | null;
}

export interface NormalizedDetectedDataAsset extends NormalizedDetectedItemBase {
  readonly kind: "DATA_ASSET";
  readonly sourceIdentity: string;
  readonly sourcePath: string | null;
  readonly displayName: string | null;
}

export interface NormalizedDetectedDataElement extends NormalizedDetectedItemBase {
  readonly kind: "DATA_ELEMENT";
  readonly parentDataAssetKey: string;
  readonly parentComparisonKey: string;
  readonly elementPath: string;
  readonly sourcePath: string | null;
  readonly displayName: string | null;
}

export interface NormalizedDetectedRelationship extends NormalizedDetectedItemBase {
  readonly kind: "RELATIONSHIP";
  readonly relationshipType: DiscoveryRelationshipType;
  readonly sourceKey: string;
  readonly targetKey: string;
  readonly sourceComparisonKey: string;
  readonly targetComparisonKey: string;
}

export interface NormalizedDetectedEvidence {
  readonly evidenceKey: string;
  readonly comparisonKey: string;
  readonly subjectKey: string;
  readonly subjectComparisonKey: string;
  readonly sourceLocator: string;
  readonly method: NormalizedDetectionMethod;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
}

export interface NormalizedDetectedScenario {
  readonly scenarioId: string;
  readonly agents: readonly NormalizedDetectedAgent[];
  readonly dataAssets: readonly NormalizedDetectedDataAsset[];
  readonly dataElements: readonly NormalizedDetectedDataElement[];
  readonly relationships: readonly NormalizedDetectedRelationship[];
  readonly evidence: readonly NormalizedDetectedEvidence[];
}

function stableKey(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

export function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function normalizeSourcePath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

export function normalizeDiscoverablePath(
  value: string,
  label: string,
): string {
  const path = value.trim().replaceAll("\\", "/");
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new TypeError(`${label} must be repository-relative`);
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new TypeError(`${label} cannot contain path traversal`);
  }
  if (isDiscoveryPathExcluded(path)) {
    throw new TypeError(`${label} enters the reserved .govia-lab namespace`);
  }

  const normalized = normalizeSourcePath(path);
  return normalized.length === 0 ? "/" : normalized;
}

function normalizeMethod(method: DetectionMethod): NormalizedDetectionMethod {
  return {
    code: normalizeRequiredText(method.code, "Detection method code"),
    version: normalizeOptionalText(method.version),
  };
}

function normalizeConfidence(
  confidence: DetectionConfidence | undefined,
): number | null {
  if (confidence === undefined) return null;
  if (!Number.isFinite(confidence.value)) {
    throw new TypeError("Detection confidence must be finite");
  }

  const normalized =
    confidence.scale === "PERCENT"
      ? confidence.value / 100
      : confidence.value;
  if (normalized < 0 || normalized > 1) {
    throw new RangeError("Detection confidence must be between 0 and 1");
  }
  return normalized;
}

function normalizeTrustState(
  trustState: DiscoveryTrustState | undefined,
): DiscoveryTrustState | null {
  if (trustState === "OBSERVED") {
    throw new TypeError(
      "Design-time Discovery results cannot use the OBSERVED trust state",
    );
  }
  return trustState ?? null;
}

function normalizedBase(item: {
  readonly detectedKey: string;
  readonly method: DetectionMethod;
  readonly confidence?: DetectionConfidence;
  readonly trustState?: DiscoveryTrustState;
  readonly evidenceKeys?: readonly string[];
}): Omit<NormalizedDetectedItemBase, "comparisonKey"> {
  return {
    detectedKey: normalizeRequiredText(item.detectedKey, "Detected key"),
    method: normalizeMethod(item.method),
    confidence: normalizeConfidence(item.confidence),
    trustState: normalizeTrustState(item.trustState),
    evidenceKeys: [...(item.evidenceKeys ?? [])].sort(),
  };
}

export function agentComparisonKey(
  sourcePath: string,
  declarationKey?: string | null,
): string {
  return stableKey([
    "AGENT",
    normalizeSourcePath(sourcePath),
    declarationKey?.trim() ?? "",
  ]);
}

export function dataAssetComparisonKey(sourceIdentity: string): string {
  return stableKey(["DATA_ASSET", sourceIdentity.trim()]);
}

export function dataElementComparisonKey(
  parentAssetComparisonKey: string,
  elementPath: string,
): string {
  return stableKey([
    "DATA_ELEMENT",
    parentAssetComparisonKey,
    normalizeSourcePath(elementPath),
  ]);
}

export function relationshipComparisonKey(
  relationshipType: DiscoveryRelationshipType,
  sourceComparisonKey: string,
  targetComparisonKey: string,
): string {
  return stableKey([
    "RELATIONSHIP",
    relationshipType,
    sourceComparisonKey,
    targetComparisonKey,
  ]);
}

export function evidenceComparisonKey(
  subjectComparisonKey: string,
  sourceLocator: string,
  method: NormalizedDetectionMethod,
): string {
  return stableKey([
    "EVIDENCE",
    subjectComparisonKey,
    normalizeSourcePath(sourceLocator),
    method.code,
    method.version ?? "",
  ]);
}

function sortByComparisonKey<T extends { readonly comparisonKey: string }>(
  items: T[],
): T[] {
  return items.sort((left, right) =>
    compareStableText(left.comparisonKey, right.comparisonKey) ||
    ("detectedKey" in left && "detectedKey" in right
      ? compareStableText(String(left.detectedKey), String(right.detectedKey))
      : 0),
  );
}

function normalizeAgent(agent: DetectedAgent): NormalizedDetectedAgent {
  const sourcePath = normalizeDiscoverablePath(agent.sourcePath, "Agent sourcePath");
  const declarationKey = normalizeOptionalText(agent.declarationKey);
  return {
    ...normalizedBase(agent),
    kind: "AGENT",
    comparisonKey: agentComparisonKey(sourcePath, declarationKey),
    sourcePath,
    declarationKey,
    displayName: normalizeOptionalText(agent.displayName),
  };
}

function normalizeDataAsset(
  asset: DetectedDataAsset,
): NormalizedDetectedDataAsset {
  const sourceIdentity = normalizeRequiredText(
    asset.sourceIdentity,
    "DataAsset sourceIdentity",
  );
  return {
    ...normalizedBase(asset),
    kind: "DATA_ASSET",
    comparisonKey: dataAssetComparisonKey(sourceIdentity),
    sourceIdentity,
    sourcePath:
      asset.sourcePath === undefined
        ? null
        : normalizeDiscoverablePath(asset.sourcePath, "DataAsset sourcePath"),
    displayName: normalizeOptionalText(asset.displayName),
  };
}

function assertUniqueKey(
  key: string,
  seen: Set<string>,
  label: string,
): void {
  if (seen.has(key)) throw new TypeError(`Duplicate ${label}: ${key}`);
  seen.add(key);
}

export function normalizeDetectedScenario(
  result: DetectedScenarioResult,
): NormalizedDetectedScenario {
  const detectedKeys = new Set<string>();
  const agents = result.agents.map(normalizeAgent);
  const dataAssets = result.dataAssets.map(normalizeDataAsset);

  for (const item of [...agents, ...dataAssets]) {
    assertUniqueKey(item.detectedKey, detectedKeys, "detectedKey");
  }

  const assetByKey = new Map(
    dataAssets.map((asset) => [asset.detectedKey, asset] as const),
  );
  const dataElements: NormalizedDetectedDataElement[] = result.dataElements.map(
    (element: DetectedDataElement) => {
      const base = normalizedBase(element);
      const parent = assetByKey.get(element.parentDataAssetKey);
      if (!parent) {
        throw new TypeError(
          `Unknown parent DataAsset detectedKey: ${element.parentDataAssetKey}`,
        );
      }
      const elementPath = normalizeRequiredText(
        normalizeSourcePath(element.elementPath),
        "DataElement elementPath",
      );
      const normalized: NormalizedDetectedDataElement = {
        ...base,
        kind: "DATA_ELEMENT",
        comparisonKey: dataElementComparisonKey(
          parent.comparisonKey,
          elementPath,
        ),
        parentDataAssetKey: parent.detectedKey,
        parentComparisonKey: parent.comparisonKey,
        elementPath,
        sourcePath:
          element.sourcePath === undefined
            ? null
            : normalizeDiscoverablePath(
                element.sourcePath,
                "DataElement sourcePath",
              ),
        displayName: normalizeOptionalText(element.displayName),
      };
      assertUniqueKey(normalized.detectedKey, detectedKeys, "detectedKey");
      return normalized;
    },
  );

  const entityByKey = new Map(
    [...agents, ...dataAssets, ...dataElements].map(
      (entity) => [entity.detectedKey, entity] as const,
    ),
  );
  const relationships: NormalizedDetectedRelationship[] =
    result.relationships.map((relationship: DetectedRelationship) => {
      const source = entityByKey.get(relationship.sourceKey);
      const target = entityByKey.get(relationship.targetKey);
      if (!source || !target) {
        throw new TypeError(
          `Relationship ${relationship.detectedKey} references an unknown endpoint`,
        );
      }
      const normalized: NormalizedDetectedRelationship = {
        ...normalizedBase(relationship),
        kind: "RELATIONSHIP",
        comparisonKey: relationshipComparisonKey(
          relationship.relationshipType,
          source.comparisonKey,
          target.comparisonKey,
        ),
        relationshipType: relationship.relationshipType,
        sourceKey: source.detectedKey,
        targetKey: target.detectedKey,
        sourceComparisonKey: source.comparisonKey,
        targetComparisonKey: target.comparisonKey,
      };
      assertUniqueKey(normalized.detectedKey, detectedKeys, "detectedKey");
      return normalized;
    });

  const subjectByKey = new Map(
    [...entityByKey.values(), ...relationships].map(
      (subject) => [subject.detectedKey, subject] as const,
    ),
  );
  const evidenceKeys = new Set<string>();
  const evidence: NormalizedDetectedEvidence[] = result.evidence.map(
    (item: DetectedEvidence) => {
      const evidenceKey = normalizeRequiredText(
        item.evidenceKey,
        "Evidence key",
      );
      assertUniqueKey(evidenceKey, evidenceKeys, "evidenceKey");
      const subject = subjectByKey.get(item.subjectKey);
      if (!subject) {
        throw new TypeError(
          `Evidence ${evidenceKey} references unknown subject ${item.subjectKey}`,
        );
      }
      const sourceLocator = normalizeDiscoverablePath(
        item.sourceLocator,
        "Evidence sourceLocator",
      );
      const method = normalizeMethod(item.method);
      return {
        evidenceKey,
        comparisonKey: evidenceComparisonKey(
          subject.comparisonKey,
          sourceLocator,
          method,
        ),
        subjectKey: subject.detectedKey,
        subjectComparisonKey: subject.comparisonKey,
        sourceLocator,
        method,
        lineStart: item.lineStart ?? null,
        lineEnd: item.lineEnd ?? null,
      };
    },
  );

  return {
    scenarioId: normalizeRequiredText(result.scenarioId, "Scenario ID"),
    agents: sortByComparisonKey(agents),
    dataAssets: sortByComparisonKey(dataAssets),
    dataElements: sortByComparisonKey(dataElements),
    relationships: sortByComparisonKey(relationships),
    evidence: sortByComparisonKey(evidence),
  };
}
