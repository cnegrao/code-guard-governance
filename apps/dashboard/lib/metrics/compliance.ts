export type MetricStatus =
  | "ASSESSED"
  | "PARTIALLY_ASSESSED"
  | "NOT_ASSESSED";

export type MetricReason =
  | "CALCULATED"
  | "PARTIAL_COVERAGE"
  | "NO_ASSESSED_ITEMS"
  | "NO_APPLICABLE_ITEMS";

export interface MetricResult {
  status: MetricStatus;
  value: number | null;
  numerator: number;
  denominator: number;
  assessedCount: number;
  applicableCount: number;
  reason: MetricReason;
}

export type AssessableState =
  | "passed"
  | "failed"
  | "not_assessed"
  | "not_applicable"
  | "waived";

const ASSESSABLE_STATES = new Set<AssessableState>([
  "passed",
  "failed",
  "not_assessed",
  "not_applicable",
  "waived",
]);

export function isAssessableState(value: unknown): value is AssessableState {
  return typeof value === "string" && ASSESSABLE_STATES.has(value as AssessableState);
}

export const NO_APPLICABLE_METRIC: MetricResult = {
  status: "NOT_ASSESSED",
  value: null,
  numerator: 0,
  denominator: 0,
  assessedCount: 0,
  applicableCount: 0,
  reason: "NO_APPLICABLE_ITEMS",
};

export function calculateComplianceMetric(
  states: Iterable<AssessableState>
): MetricResult {
  let numerator = 0;
  let assessedCount = 0;
  let applicableCount = 0;

  for (const state of states) {
    switch (state) {
      case "passed":
        numerator += 1;
        assessedCount += 1;
        applicableCount += 1;
        break;
      case "failed":
        assessedCount += 1;
        applicableCount += 1;
        break;
      case "not_assessed":
        applicableCount += 1;
        break;
      case "waived":
        // A waiver applies to an otherwise applicable item. It is excluded from
        // this score version, but remains visible in coverage for future policy.
        applicableCount += 1;
        break;
      case "not_applicable":
        break;
    }
  }

  const denominator = assessedCount;

  if (applicableCount === 0) {
    return { ...NO_APPLICABLE_METRIC };
  }

  if (assessedCount === 0) {
    return {
      status: "NOT_ASSESSED",
      value: null,
      numerator,
      denominator,
      assessedCount,
      applicableCount,
      reason: "NO_ASSESSED_ITEMS",
    };
  }

  const hasPartialCoverage = assessedCount < applicableCount;

  return {
    status: hasPartialCoverage ? "PARTIALLY_ASSESSED" : "ASSESSED",
    value: Math.round((numerator / denominator) * 100),
    numerator,
    denominator,
    assessedCount,
    applicableCount,
    reason: hasPartialCoverage ? "PARTIAL_COVERAGE" : "CALCULATED",
  };
}

export function calculateAssessedAverage(
  values: Iterable<number | null | undefined>
): number | null {
  let total = 0;
  let assessedCount = 0;

  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    total += value;
    assessedCount += 1;
  }

  return assessedCount === 0 ? null : Math.round(total / assessedCount);
}
