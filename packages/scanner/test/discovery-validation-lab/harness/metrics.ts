import type { ScenarioMatchResult } from "./match.ts";

export const VALIDATION_METRIC_STATUS = {
  ASSESSED: "ASSESSED",
  NOT_ASSESSED: "NOT_ASSESSED",
} as const;

export type ValidationMetricStatus =
  (typeof VALIDATION_METRIC_STATUS)[keyof typeof VALIDATION_METRIC_STATUS];

export const VALIDATION_METRIC_REASON = {
  CALCULATED: "CALCULATED",
  ZERO_DENOMINATOR: "ZERO_DENOMINATOR",
} as const;

export type ValidationMetricReason =
  (typeof VALIDATION_METRIC_REASON)[keyof typeof VALIDATION_METRIC_REASON];

export interface ValidationRatioMetric {
  readonly status: ValidationMetricStatus;
  /** Ratio from 0 through 1; null means not assessed. */
  readonly value: number | null;
  readonly numerator: number;
  readonly denominator: number;
  readonly reason: ValidationMetricReason;
}

export interface ValidationMetrics {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: ValidationRatioMetric;
  readonly recall: ValidationRatioMetric;
  readonly f1: ValidationRatioMetric;
}

function ratio(numerator: number, denominator: number): ValidationRatioMetric {
  if (denominator === 0) {
    return {
      status: VALIDATION_METRIC_STATUS.NOT_ASSESSED,
      value: null,
      numerator,
      denominator,
      reason: VALIDATION_METRIC_REASON.ZERO_DENOMINATOR,
    };
  }
  return {
    status: VALIDATION_METRIC_STATUS.ASSESSED,
    value: numerator / denominator,
    numerator,
    denominator,
    reason: VALIDATION_METRIC_REASON.CALCULATED,
  };
}

export function calculateValidationMetrics(counts: {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
}): ValidationMetrics {
  const { truePositives, falsePositives, falseNegatives } = counts;
  if (
    [truePositives, falsePositives, falseNegatives].some(
      (value) => !Number.isInteger(value) || value < 0,
    )
  ) {
    throw new TypeError("TP, FP, and FN must be non-negative integers");
  }

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, truePositives + falseNegatives),
    f1: ratio(
      2 * truePositives,
      2 * truePositives + falsePositives + falseNegatives,
    ),
  };
}

export function calculateNegativeScenarioPass(
  matches: ScenarioMatchResult,
): boolean | null {
  const categories = [
    matches.agents,
    matches.dataAssets,
    matches.dataElements,
    matches.models,
    matches.tools,
    matches.mcpServers,
    matches.apis,
    matches.prompts,
    matches.knowledgeBases,
    matches.relationships,
  ];
  const expectedCount = categories.reduce(
    (total, category) =>
      total + category.matched.length + category.falseNegatives.length,
    0,
  );
  if (expectedCount > 0) return null;

  const detectedCount = categories.reduce(
    (total, category) => total + category.falsePositives.length,
    0,
  );
  return detectedCount === 0 && matches.prohibitedFindings.length === 0;
}
