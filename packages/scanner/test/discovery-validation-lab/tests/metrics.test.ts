import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchScenario } from "../harness/match.ts";
import {
  calculateNegativeScenarioPass,
  calculateValidationMetrics,
} from "../harness/metrics.ts";
import { normalizeDetectedScenario } from "../harness/normalize.ts";
import type { ExpectedScenario } from "../contracts/expected.ts";
import type { DetectedScenarioResult } from "../contracts/detected.ts";

describe("Validation metrics", () => {
  it("calculates precision, recall, and F1 from TP/FP/FN", () => {
    const metrics = calculateValidationMetrics({
      truePositives: 3,
      falsePositives: 1,
      falseNegatives: 1,
    });

    assert.equal(metrics.precision.value, 0.75);
    assert.equal(metrics.recall.value, 0.75);
    assert.equal(metrics.f1.value, 0.75);
  });

  it("uses NOT_ASSESSED and null for every zero denominator", () => {
    const metrics = calculateValidationMetrics({
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
    });

    for (const metric of [metrics.precision, metrics.recall, metrics.f1]) {
      assert.equal(metric.status, "NOT_ASSESSED");
      assert.equal(metric.value, null);
      assert.equal(metric.denominator, 0);
      assert.equal(metric.reason, "ZERO_DENOMINATOR");
    }
  });

  it("does not turn missing detections into invented precision", () => {
    const metrics = calculateValidationMetrics({
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 1,
    });

    assert.equal(metrics.precision.value, null);
    assert.equal(metrics.recall.value, 0);
    assert.equal(metrics.f1.value, 0);
  });

  it("supports a separate negative-only scenario result", () => {
    const expected: ExpectedScenario = {
      schemaVersion: "1.0",
      scenarioId: "negative-only",
      description: "No supported detections expected",
      targetRound: 1,
      discoveryLayers: ["L4"],
      agents: [],
      dataAssets: [],
      dataElements: [],
      models: [],
      tools: [],
      mcpServers: [],
      apis: [],
      prompts: [],
      knowledgeBases: [],
      relationships: [],
      evidenceRequirements: [],
      prohibited: [],
      semanticConcepts: [],
    };
    const emptyDetected: DetectedScenarioResult = {
      scenarioId: "negative-only",
      agents: [],
      dataAssets: [],
      dataElements: [],
      relationships: [],
      evidence: [],
    };
    const passingMatches = matchScenario(
      expected,
      normalizeDetectedScenario(emptyDetected),
    );
    assert.equal(calculateNegativeScenarioPass(passingMatches), true);

    const failingMatches = matchScenario(
      expected,
      normalizeDetectedScenario({
        ...emptyDetected,
        agents: [{
          kind: "AGENT",
          detectedKey: "unexpected-agent",
          sourcePath: "src/unexpected.ts",
          declarationKey: "unexpected",
          method: { code: "TEST" },
        }],
      }),
    );
    assert.equal(calculateNegativeScenarioPass(failingMatches), false);
  });
});
