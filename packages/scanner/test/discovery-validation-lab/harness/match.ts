import type { DetectionCategory } from "../contracts/detected.ts";
import type {
  DiscoveryLayer,
  ExpectedAgent,
  ExpectedDataAsset,
  ExpectedDataElement,
  ExpectedRelationship,
  ExpectedScenario,
} from "../contracts/expected.ts";
import {
  agentComparisonKey,
  compareStableText,
  dataAssetComparisonKey,
  dataElementComparisonKey,
  relationshipComparisonKey,
  type NormalizedDetectedAgent,
  type NormalizedDetectedDataAsset,
  type NormalizedDetectedDataElement,
  type NormalizedDetectedRelationship,
  type NormalizedDetectedScenario,
} from "./normalize.ts";

interface ComparableExpected<T> {
  readonly item: T;
  readonly comparisonKey: string;
  readonly acceptedComparisonKeys: readonly string[];
}

export interface MatchedPair {
  readonly expectedKey: string;
  readonly expectedComparisonKey: string;
  readonly detectedKey: string;
  readonly detectedComparisonKey: string;
}

export interface FalseNegative {
  readonly expectedKey: string;
  readonly expectedComparisonKey: string;
}

export interface CategoryMatchResult<
  Detected extends { readonly detectedKey: string; readonly comparisonKey: string },
> {
  readonly matched: readonly MatchedPair[];
  readonly falsePositives: readonly Detected[];
  readonly falseNegatives: readonly FalseNegative[];
}

export interface ProhibitedFinding {
  readonly prohibitionKey: string;
  readonly category: DetectionCategory;
  readonly detectedKey: string;
  readonly comparisonKey: string;
  readonly description: string;
  readonly discoveryLayers: readonly DiscoveryLayer[];
}

export interface ScenarioMatchResult {
  readonly agents: CategoryMatchResult<NormalizedDetectedAgent>;
  readonly dataAssets: CategoryMatchResult<NormalizedDetectedDataAsset>;
  readonly dataElements: CategoryMatchResult<NormalizedDetectedDataElement>;
  readonly relationships: CategoryMatchResult<NormalizedDetectedRelationship>;
  readonly prohibitedFindings: readonly ProhibitedFinding[];
}

function comparable<T extends { readonly comparisonAliases?: readonly string[] }>(
  item: T,
  comparisonKey: string,
): ComparableExpected<T> {
  return {
    item,
    comparisonKey,
    acceptedComparisonKeys: [comparisonKey, ...(item.comparisonAliases ?? [])],
  };
}

function exactMatch<
  Expected extends { readonly key: string },
  Detected extends { readonly detectedKey: string; readonly comparisonKey: string },
>(
  expected: readonly ComparableExpected<Expected>[],
  detected: readonly Detected[],
): CategoryMatchResult<Detected> {
  const consumed = new Set<number>();
  const matched: MatchedPair[] = [];
  const falseNegatives: FalseNegative[] = [];

  for (const expectedItem of [...expected].sort((left, right) =>
    compareStableText(left.item.key, right.item.key),
  )) {
    const detectedIndex = detected.findIndex(
      (candidate, index) =>
        !consumed.has(index) &&
        expectedItem.acceptedComparisonKeys.includes(candidate.comparisonKey),
    );
    if (detectedIndex === -1) {
      falseNegatives.push({
        expectedKey: expectedItem.item.key,
        expectedComparisonKey: expectedItem.comparisonKey,
      });
      continue;
    }

    consumed.add(detectedIndex);
    const detectedItem = detected[detectedIndex];
    matched.push({
      expectedKey: expectedItem.item.key,
      expectedComparisonKey: expectedItem.comparisonKey,
      detectedKey: detectedItem.detectedKey,
      detectedComparisonKey: detectedItem.comparisonKey,
    });
  }

  return {
    matched,
    falsePositives: detected.filter((_, index) => !consumed.has(index)),
    falseNegatives,
  };
}

function matchedEntityKeyMap(
  ...results: readonly CategoryMatchResult<{
    readonly detectedKey: string;
    readonly comparisonKey: string;
  }>[]
): ReadonlyMap<string, string> {
  return new Map(
    results.flatMap((result) =>
      result.matched.map(
        (pair) => [pair.detectedKey, pair.expectedKey] as const,
      ),
    ),
  );
}

function matchRelationships(
  expected: readonly ExpectedRelationship[],
  detected: readonly NormalizedDetectedRelationship[],
  detectedEntityToExpectedKey: ReadonlyMap<string, string>,
): CategoryMatchResult<NormalizedDetectedRelationship> {
  const consumed = new Set<number>();
  const matched: MatchedPair[] = [];
  const falseNegatives: FalseNegative[] = [];
  const candidates = detected.map((item) => {
    const sourceKey = detectedEntityToExpectedKey.get(item.sourceKey);
    const targetKey = detectedEntityToExpectedKey.get(item.targetKey);
    return {
      item,
      comparisonKey:
        sourceKey === undefined || targetKey === undefined
          ? null
          : relationshipComparisonKey(
              item.relationshipType,
              sourceKey,
              targetKey,
            ),
    };
  });

  for (const expectedItem of [...expected].sort((left, right) =>
    compareStableText(left.key, right.key),
  )) {
    const expectedComparisonKey = relationshipComparisonKey(
      expectedItem.relationshipType,
      expectedItem.sourceKey,
      expectedItem.targetKey,
    );
    const detectedIndex = candidates.findIndex(
      (candidate, index) =>
        !consumed.has(index) &&
        candidate.comparisonKey === expectedComparisonKey,
    );
    if (detectedIndex === -1) {
      falseNegatives.push({
        expectedKey: expectedItem.key,
        expectedComparisonKey,
      });
      continue;
    }

    consumed.add(detectedIndex);
    const candidate = candidates[detectedIndex];
    matched.push({
      expectedKey: expectedItem.key,
      expectedComparisonKey,
      detectedKey: candidate.item.detectedKey,
      detectedComparisonKey: candidate.comparisonKey!,
    });
  }

  return {
    matched,
    falsePositives: detected.filter((_, index) => !consumed.has(index)),
    falseNegatives,
  };
}

function detectedByCategory(
  result: NormalizedDetectedScenario,
  category: DetectionCategory,
): readonly { readonly detectedKey: string; readonly comparisonKey: string }[] {
  switch (category) {
    case "AGENT":
      return result.agents;
    case "DATA_ASSET":
      return result.dataAssets;
    case "DATA_ELEMENT":
      return result.dataElements;
    case "RELATIONSHIP":
      return result.relationships;
  }
}

export function matchScenario(
  expected: ExpectedScenario,
  detected: NormalizedDetectedScenario,
): ScenarioMatchResult {
  if (expected.scenarioId !== detected.scenarioId) {
    throw new TypeError("Expected and detected scenario IDs must match");
  }

  const expectedAgents = expected.agents.map((item: ExpectedAgent) =>
    comparable(
      item,
      agentComparisonKey(item.sourcePath, item.declarationKey),
    ),
  );
  const expectedAssets = expected.dataAssets.map((item: ExpectedDataAsset) =>
    comparable(item, dataAssetComparisonKey(item.sourceIdentity)),
  );
  const expectedAssetByKey = new Map(
    expectedAssets.map((item) => [item.item.key, item] as const),
  );
  const expectedElements = expected.dataElements.map(
    (item: ExpectedDataElement) => {
      const parent = expectedAssetByKey.get(item.parentDataAssetKey);
      if (!parent) {
        throw new TypeError(
          `Expected DataElement ${item.key} has an unknown parent`,
        );
      }
      return comparable(
        item,
        dataElementComparisonKey(parent.comparisonKey, item.elementPath),
      );
    },
  );

  const expectedEntityKeys = new Set([
    ...expectedAgents.map((item) => item.item.key),
    ...expectedAssets.map((item) => item.item.key),
    ...expectedElements.map((item) => item.item.key),
  ]);
  for (const relationship of expected.relationships) {
    if (
      !expectedEntityKeys.has(relationship.sourceKey) ||
      !expectedEntityKeys.has(relationship.targetKey)
    ) {
      throw new TypeError(
        `Expected relationship ${relationship.key} has an unknown endpoint`,
      );
    }
  }

  const agentMatches = exactMatch(expectedAgents, detected.agents);
  const assetMatches = exactMatch(expectedAssets, detected.dataAssets);
  const elementMatches = exactMatch(expectedElements, detected.dataElements);
  const detectedEntityToExpectedKey = matchedEntityKeyMap(
    agentMatches,
    assetMatches,
    elementMatches,
  );
  const relationshipMatches = matchRelationships(
    expected.relationships,
    detected.relationships,
    detectedEntityToExpectedKey,
  );

  const prohibitedFindings = expected.prohibited.flatMap((prohibition) =>
    detectedByCategory(detected, prohibition.category)
      .filter((item) => item.comparisonKey === prohibition.comparisonKey)
      .map((item) => ({
        prohibitionKey: prohibition.key,
        category: prohibition.category,
        detectedKey: item.detectedKey,
        comparisonKey: item.comparisonKey,
        description: prohibition.description,
        discoveryLayers: [...prohibition.discoveryLayers].sort(compareStableText),
      })),
  );

  return {
    agents: agentMatches,
    dataAssets: assetMatches,
    dataElements: elementMatches,
    relationships: relationshipMatches,
    prohibitedFindings: prohibitedFindings.sort((left, right) =>
      compareStableText(left.prohibitionKey, right.prohibitionKey) ||
      compareStableText(left.detectedKey, right.detectedKey),
    ),
  };
}
