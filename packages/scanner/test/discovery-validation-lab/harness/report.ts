import type { DetectionCategory } from "../contracts/detected.ts";
import type {
  DiscoveryLayer,
  ExpectedScenario,
  ImplementationRound,
} from "../contracts/expected.ts";
import type {
  CategoryMatchResult,
  ProhibitedFinding,
  ScenarioMatchResult,
} from "./match.ts";
import {
  calculateNegativeScenarioPass,
  calculateValidationMetrics,
  type ValidationMetrics,
} from "./metrics.ts";
import {
  compareStableText,
  normalizeSourcePath,
  type NormalizedDetectedScenario,
} from "./normalize.ts";

export interface ValidationCategoryReport {
  readonly category: DetectionCategory;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: ValidationMetrics["precision"];
  readonly recall: ValidationMetrics["recall"];
  readonly f1: ValidationMetrics["f1"];
  readonly discoveryLayers: readonly DiscoveryLayer[];
  readonly recommendedImplementationRound: ImplementationRound;
  readonly diagnostics: readonly string[];
}

export interface MissingEvidence {
  readonly requirementKey: string;
  readonly subjectKey: string;
  readonly sourceLocator: string;
  readonly reason: "SUBJECT_NOT_DETECTED" | "EVIDENCE_NOT_FOUND";
  readonly discoveryLayers: readonly DiscoveryLayer[];
}

export interface ValidationReport {
  readonly schemaVersion: "1.0";
  readonly scenarioId: string;
  readonly categories: readonly ValidationCategoryReport[];
  readonly prohibitedFindings: readonly ProhibitedFinding[];
  readonly missingEvidence: readonly MissingEvidence[];
  readonly negativeScenarioPass: boolean | null;
  readonly discoveryLayers: readonly DiscoveryLayer[];
  readonly recommendedImplementationRound: ImplementationRound;
  readonly diagnostics: readonly string[];
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareStableText) as T[];
}

function categoryReport(
  category: DetectionCategory,
  match: CategoryMatchResult<{
    readonly detectedKey: string;
    readonly comparisonKey: string;
  }>,
  discoveryLayers: readonly DiscoveryLayer[],
  targetRound: ImplementationRound,
): ValidationCategoryReport {
  const metrics = calculateValidationMetrics({
    truePositives: match.matched.length,
    falsePositives: match.falsePositives.length,
    falseNegatives: match.falseNegatives.length,
  });
  return {
    category,
    truePositives: metrics.truePositives,
    falsePositives: metrics.falsePositives,
    falseNegatives: metrics.falseNegatives,
    precision: metrics.precision,
    recall: metrics.recall,
    f1: metrics.f1,
    discoveryLayers: uniqueSorted(discoveryLayers),
    recommendedImplementationRound: targetRound,
    diagnostics: [
      ...match.falsePositives.map(
        (item) => `Unexpected detection: ${item.detectedKey}`,
      ),
      ...match.falseNegatives.map(
        (item) => `Missing expectation: ${item.expectedKey}`,
      ),
    ].sort(compareStableText),
  };
}

function subjectMatchMap(matches: ScenarioMatchResult): Map<string, string> {
  return new Map(
    [
      ...matches.agents.matched,
      ...matches.dataAssets.matched,
      ...matches.dataElements.matched,
      ...matches.models.matched,
      ...matches.tools.matched,
      ...matches.mcpServers.matched,
      ...matches.apis.matched,
      ...matches.prompts.matched,
      ...matches.knowledgeBases.matched,
      ...matches.relationships.matched,
    ].map((pair) => [pair.expectedKey, pair.detectedKey] as const),
  );
}

function missingEvidence(
  expected: ExpectedScenario,
  detected: NormalizedDetectedScenario,
  matches: ScenarioMatchResult,
): MissingEvidence[] {
  const subjectMatches = subjectMatchMap(matches);
  const detectedSubjects = new Map(
    [
      ...detected.agents,
      ...detected.dataAssets,
      ...detected.dataElements,
      ...detected.models,
      ...detected.tools,
      ...detected.mcpServers,
      ...detected.apis,
      ...detected.prompts,
      ...detected.knowledgeBases,
      ...detected.relationships,
    ].map((item) => [item.detectedKey, item] as const),
  );
  const evidenceByKey = new Map(
    detected.evidence.map((item) => [item.evidenceKey, item] as const),
  );

  const missing: MissingEvidence[] = [];
  for (const requirement of expected.evidenceRequirements) {
    const detectedSubjectKey = subjectMatches.get(requirement.subjectKey);
    if (!detectedSubjectKey) {
      missing.push({
        requirementKey: requirement.key,
        subjectKey: requirement.subjectKey,
        sourceLocator: normalizeSourcePath(requirement.sourceLocator),
        reason: "SUBJECT_NOT_DETECTED",
        discoveryLayers: uniqueSorted(requirement.discoveryLayers),
      });
      continue;
    }

    const subject = detectedSubjects.get(detectedSubjectKey);
    const expectedLocator = normalizeSourcePath(requirement.sourceLocator);
    const evidenceFound = (subject?.evidenceKeys ?? []).some((evidenceKey) => {
      const evidence = evidenceByKey.get(evidenceKey);
      return Boolean(
        evidence &&
          evidence.subjectKey === detectedSubjectKey &&
          evidence.sourceLocator === expectedLocator &&
          (requirement.methodCode === undefined ||
            evidence.method.code === requirement.methodCode),
      );
    });
    if (!evidenceFound) {
      missing.push({
        requirementKey: requirement.key,
        subjectKey: requirement.subjectKey,
        sourceLocator: expectedLocator,
        reason: "EVIDENCE_NOT_FOUND",
        discoveryLayers: uniqueSorted(requirement.discoveryLayers),
      });
    }
  }
  return missing.sort((left, right) =>
    compareStableText(left.requirementKey, right.requirementKey),
  );
}

export function buildValidationReport(
  expected: ExpectedScenario,
  detected: NormalizedDetectedScenario,
  matches: ScenarioMatchResult,
): ValidationReport {
  const reports = [
    categoryReport(
      "AGENT",
      matches.agents,
      expected.agents.flatMap((item) => item.discoveryLayers),
      expected.targetRound,
    ),
    categoryReport(
      "DATA_ASSET",
      matches.dataAssets,
      expected.dataAssets.flatMap((item) => item.discoveryLayers),
      expected.targetRound,
    ),
    categoryReport(
      "DATA_ELEMENT",
      matches.dataElements,
      expected.dataElements.flatMap((item) => item.discoveryLayers),
      expected.targetRound,
    ),
    categoryReport(
      "MODEL",
      matches.models,
      (expected.models ?? []).flatMap((item) => item.discoveryLayers),
      expected.targetRound,
    ),
    categoryReport(
      "TOOL",
      matches.tools,
      (expected.tools ?? []).flatMap((item) => item.discoveryLayers),
      expected.targetRound,
    ),
    categoryReport(
      "MCP_SERVER",
      matches.mcpServers,
      (expected.mcpServers ?? []).flatMap((item) => item.discoveryLayers),
      expected.targetRound,
    ),
    categoryReport(
      "API",
      matches.apis,
      (expected.apis ?? []).flatMap((item) => item.discoveryLayers),
      expected.targetRound,
    ),
    categoryReport(
      "PROMPT",
      matches.prompts,
      (expected.prompts ?? []).flatMap((item) => item.discoveryLayers),
      expected.targetRound,
    ),
    categoryReport(
      "KNOWLEDGE_BASE",
      matches.knowledgeBases,
      (expected.knowledgeBases ?? []).flatMap((item) => item.discoveryLayers),
      expected.targetRound,
    ),
    categoryReport(
      "RELATIONSHIP",
      matches.relationships,
      expected.relationships.flatMap((item) => item.discoveryLayers),
      expected.targetRound,
    ),
  ].sort((left, right) => compareStableText(left.category, right.category));
  const missing = missingEvidence(expected, detected, matches);
  const prohibitedFindings = [...matches.prohibitedFindings];

  return {
    schemaVersion: "1.0",
    scenarioId: expected.scenarioId,
    categories: reports,
    prohibitedFindings,
    missingEvidence: missing,
    negativeScenarioPass: calculateNegativeScenarioPass(matches),
    discoveryLayers: uniqueSorted(expected.discoveryLayers),
    recommendedImplementationRound: expected.targetRound,
    diagnostics: [
      ...reports.flatMap((report) => report.diagnostics),
      ...prohibitedFindings.map(
        (finding) => `Prohibited detection: ${finding.prohibitionKey}`,
      ),
      ...missing.map(
        (item) => `Missing evidence: ${item.requirementKey} (${item.reason})`,
      ),
    ].sort(compareStableText),
  };
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareStableText(left, right))
      .map(([key, nested]) => [key, stableJsonValue(nested)]),
  );
}

export function serializeValidationReport(report: ValidationReport): string {
  return `${JSON.stringify(stableJsonValue(report), null, 2)}\n`;
}
