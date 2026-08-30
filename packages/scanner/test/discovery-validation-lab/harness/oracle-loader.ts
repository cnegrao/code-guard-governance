import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DETECTION_CATEGORY,
  DISCOVERY_RELATIONSHIP_TYPE,
} from "../contracts/detected.ts";
import {
  DISCOVERY_LAYER,
  EXPECTED_SCENARIO_SCHEMA_VERSION,
  type DiscoveryLayer,
  type ExpectedAgent,
  type ExpectedDataAsset,
  type ExpectedDataElement,
  type ExpectedEvidenceRequirement,
  type ExpectedRelationship,
  type ExpectedScenario,
  type ExpectedSemanticConcept,
  type ImplementationRound,
  type ProhibitedExpectation,
} from "../contracts/expected.ts";
import { normalizeDiscoverablePath } from "./normalize.ts";

type UnknownRecord = Record<string, unknown>;

const DISCOVERY_LAYERS = new Set<string>(Object.values(DISCOVERY_LAYER));
const RELATIONSHIP_TYPES = new Set<string>(
  Object.values(DISCOVERY_RELATIONSHIP_TYPE),
);
const DETECTION_CATEGORIES = new Set<string>(
  Object.values(DETECTION_CATEGORY),
);

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function onlyKeys(
  value: UnknownRecord,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} contains unsupported field: ${key}`);
    }
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return text(value, label);
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value, label).map((item, index) =>
    text(item, `${label}[${index}]`),
  );
}

function layers(value: unknown, label: string): DiscoveryLayer[] {
  return stringArray(value, label).map((layer) => {
    if (!DISCOVERY_LAYERS.has(layer)) {
      throw new TypeError(`${label} contains unsupported layer: ${layer}`);
    }
    return layer as DiscoveryLayer;
  });
}

function sourcePath(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  return normalizeDiscoverablePath(value, label);
}

function implementationRound(value: unknown, label: string): ImplementationRound {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 5
  ) {
    throw new TypeError(`${label} must be an integer from 1 through 5`);
  }
  return value as ImplementationRound;
}

function baseExpectedItem(value: UnknownRecord, label: string) {
  return {
    key: text(value.key, `${label}.key`),
    requiredFromRound: implementationRound(
      value.requiredFromRound,
      `${label}.requiredFromRound`,
    ),
    discoveryLayers: layers(
      value.discoveryLayers,
      `${label}.discoveryLayers`,
    ),
    comparisonAliases:
      value.comparisonAliases === undefined
        ? undefined
        : stringArray(value.comparisonAliases, `${label}.comparisonAliases`),
  };
}

function expectedAgent(value: unknown, index: number): ExpectedAgent {
  const label = `agents[${index}]`;
  const item = record(value, label);
  onlyKeys(
    item,
    [
      "key",
      "requiredFromRound",
      "discoveryLayers",
      "comparisonAliases",
      "sourcePath",
      "declarationKey",
      "displayName",
    ],
    label,
  );
  return {
    ...baseExpectedItem(item, label),
    sourcePath: sourcePath(item.sourcePath, `${label}.sourcePath`),
    declarationKey: optionalText(item.declarationKey, `${label}.declarationKey`),
    displayName: optionalText(item.displayName, `${label}.displayName`),
  };
}

function expectedDataAsset(value: unknown, index: number): ExpectedDataAsset {
  const label = `dataAssets[${index}]`;
  const item = record(value, label);
  onlyKeys(
    item,
    [
      "key",
      "requiredFromRound",
      "discoveryLayers",
      "comparisonAliases",
      "sourceIdentity",
      "sourcePath",
      "displayName",
    ],
    label,
  );
  return {
    ...baseExpectedItem(item, label),
    sourceIdentity: text(item.sourceIdentity, `${label}.sourceIdentity`),
    sourcePath:
      item.sourcePath === undefined
        ? undefined
        : sourcePath(item.sourcePath, `${label}.sourcePath`),
    displayName: optionalText(item.displayName, `${label}.displayName`),
  };
}

function expectedDataElement(value: unknown, index: number): ExpectedDataElement {
  const label = `dataElements[${index}]`;
  const item = record(value, label);
  onlyKeys(
    item,
    [
      "key",
      "requiredFromRound",
      "discoveryLayers",
      "comparisonAliases",
      "parentDataAssetKey",
      "elementPath",
      "sourcePath",
      "displayName",
    ],
    label,
  );
  return {
    ...baseExpectedItem(item, label),
    parentDataAssetKey: text(
      item.parentDataAssetKey,
      `${label}.parentDataAssetKey`,
    ),
    elementPath: text(item.elementPath, `${label}.elementPath`),
    sourcePath:
      item.sourcePath === undefined
        ? undefined
        : sourcePath(item.sourcePath, `${label}.sourcePath`),
    displayName: optionalText(item.displayName, `${label}.displayName`),
  };
}

function expectedRelationship(
  value: unknown,
  index: number,
): ExpectedRelationship {
  const label = `relationships[${index}]`;
  const item = record(value, label);
  onlyKeys(
    item,
    [
      "key",
      "requiredFromRound",
      "discoveryLayers",
      "comparisonAliases",
      "relationshipType",
      "sourceKey",
      "targetKey",
    ],
    label,
  );
  const relationshipType = text(
    item.relationshipType,
    `${label}.relationshipType`,
  );
  if (!RELATIONSHIP_TYPES.has(relationshipType)) {
    throw new TypeError(`Unsupported relationship type: ${relationshipType}`);
  }
  return {
    ...baseExpectedItem(item, label),
    relationshipType: relationshipType as ExpectedRelationship["relationshipType"],
    sourceKey: text(item.sourceKey, `${label}.sourceKey`),
    targetKey: text(item.targetKey, `${label}.targetKey`),
  };
}

function evidenceRequirement(
  value: unknown,
  index: number,
): ExpectedEvidenceRequirement {
  const label = `evidenceRequirements[${index}]`;
  const item = record(value, label);
  onlyKeys(
    item,
    [
      "key",
      "requiredFromRound",
      "subjectKey",
      "sourceLocator",
      "methodCode",
      "discoveryLayers",
    ],
    label,
  );
  return {
    key: text(item.key, `${label}.key`),
    requiredFromRound: implementationRound(
      item.requiredFromRound,
      `${label}.requiredFromRound`,
    ),
    subjectKey: text(item.subjectKey, `${label}.subjectKey`),
    sourceLocator: sourcePath(item.sourceLocator, `${label}.sourceLocator`),
    methodCode: optionalText(item.methodCode, `${label}.methodCode`),
    discoveryLayers: layers(
      item.discoveryLayers,
      `${label}.discoveryLayers`,
    ),
  };
}

function prohibitedExpectation(
  value: unknown,
  index: number,
): ProhibitedExpectation {
  const label = `prohibited[${index}]`;
  const item = record(value, label);
  onlyKeys(
    item,
    [
      "key",
      "requiredFromRound",
      "category",
      "comparisonKey",
      "description",
      "discoveryLayers",
    ],
    label,
  );
  const category = text(item.category, `${label}.category`);
  if (!DETECTION_CATEGORIES.has(category)) {
    throw new TypeError(`Unsupported detection category: ${category}`);
  }
  return {
    key: text(item.key, `${label}.key`),
    requiredFromRound: implementationRound(
      item.requiredFromRound,
      `${label}.requiredFromRound`,
    ),
    category: category as ProhibitedExpectation["category"],
    comparisonKey: text(item.comparisonKey, `${label}.comparisonKey`),
    description: text(item.description, `${label}.description`),
    discoveryLayers: layers(
      item.discoveryLayers,
      `${label}.discoveryLayers`,
    ),
  };
}

function semanticConcept(
  value: unknown,
  index: number,
): ExpectedSemanticConcept {
  const label = `semanticConcepts[${index}]`;
  const item = record(value, label);
  onlyKeys(
    item,
    ["code", "requiredFromRound", "description", "memberDataElementKeys"],
    label,
  );
  return {
    code: text(item.code, `${label}.code`),
    requiredFromRound: implementationRound(
      item.requiredFromRound,
      `${label}.requiredFromRound`,
    ),
    description: optionalText(item.description, `${label}.description`),
    memberDataElementKeys: stringArray(
      item.memberDataElementKeys,
      `${label}.memberDataElementKeys`,
    ),
  };
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new TypeError(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

export function validateExpectedScenario(value: unknown): ExpectedScenario {
  const root = record(value, "Expected scenario");
  onlyKeys(
    root,
    [
      "schemaVersion",
      "scenarioId",
      "description",
      "targetRound",
      "discoveryLayers",
      "agents",
      "dataAssets",
      "dataElements",
      "relationships",
      "evidenceRequirements",
      "prohibited",
      "semanticConcepts",
    ],
    "Expected scenario",
  );

  if (root.schemaVersion !== EXPECTED_SCENARIO_SCHEMA_VERSION) {
    throw new TypeError(
      `Unsupported expected scenario schemaVersion: ${String(root.schemaVersion)}`,
    );
  }
  const targetRound = implementationRound(root.targetRound, "targetRound");

  const agents = array(root.agents, "agents").map(expectedAgent);
  const dataAssets = array(root.dataAssets, "dataAssets").map(expectedDataAsset);
  const dataElements = array(root.dataElements, "dataElements").map(
    expectedDataElement,
  );
  const relationships = array(root.relationships, "relationships").map(
    expectedRelationship,
  );
  const evidenceRequirements = array(
    root.evidenceRequirements,
    "evidenceRequirements",
  ).map(evidenceRequirement);
  const prohibited = array(root.prohibited, "prohibited").map(
    prohibitedExpectation,
  );
  const semanticConcepts = array(
    root.semanticConcepts,
    "semanticConcepts",
  ).map(semanticConcept);

  const entityKeys = [
    ...agents.map((item) => item.key),
    ...dataAssets.map((item) => item.key),
    ...dataElements.map((item) => item.key),
  ];
  assertUnique(entityKeys, "entity key");
  assertUnique(relationships.map((item) => item.key), "relationship key");
  assertUnique(
    evidenceRequirements.map((item) => item.key),
    "evidence requirement key",
  );
  assertUnique(prohibited.map((item) => item.key), "prohibited key");
  assertUnique(semanticConcepts.map((item) => item.code), "semantic concept code");

  const assetKeys = new Set(dataAssets.map((item) => item.key));
  for (const element of dataElements) {
    if (!assetKeys.has(element.parentDataAssetKey)) {
      throw new TypeError(
        `DataElement ${element.key} references unknown DataAsset ${element.parentDataAssetKey}`,
      );
    }
  }

  const entityKeySet = new Set(entityKeys);
  for (const relationship of relationships) {
    if (
      !entityKeySet.has(relationship.sourceKey) ||
      !entityKeySet.has(relationship.targetKey)
    ) {
      throw new TypeError(
        `Relationship ${relationship.key} references an unknown endpoint`,
      );
    }
  }

  const subjectKeys = new Set([
    ...entityKeys,
    ...relationships.map((item) => item.key),
  ]);
  for (const requirement of evidenceRequirements) {
    if (!subjectKeys.has(requirement.subjectKey)) {
      throw new TypeError(
        `Evidence requirement ${requirement.key} references an unknown subject`,
      );
    }
  }

  const dataElementKeys = new Set(dataElements.map((item) => item.key));
  for (const concept of semanticConcepts) {
    for (const memberKey of concept.memberDataElementKeys) {
      if (!dataElementKeys.has(memberKey)) {
        throw new TypeError(
          `Semantic concept ${concept.code} references unknown DataElement ${memberKey}`,
        );
      }
    }
  }

  return {
    schemaVersion: EXPECTED_SCENARIO_SCHEMA_VERSION,
    scenarioId: text(root.scenarioId, "scenarioId"),
    description: text(root.description, "description"),
    targetRound,
    discoveryLayers: layers(root.discoveryLayers, "discoveryLayers"),
    agents,
    dataAssets,
    dataElements,
    relationships,
    evidenceRequirements,
    prohibited,
    semanticConcepts,
  };
}

/** The sole Lab entry point authorized to read .govia-lab/expected.json. */
export async function loadExpectedScenario(
  scenarioDirectory: string,
): Promise<ExpectedScenario> {
  const oraclePath = join(scenarioDirectory, ".govia-lab", "expected.json");
  const raw = await readFile(oraclePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new TypeError("Expected scenario oracle is not valid JSON");
  }
  return validateExpectedScenario(parsed);
}
