import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateAssessedAverage,
  calculateComplianceMetric,
} from "./compliance";

describe("calculateComplianceMetric", () => {
  it("returns NOT_ASSESSED for an empty universe", () => {
    const result = calculateComplianceMetric([]);

    assert.equal(result.status, "NOT_ASSESSED");
    assert.equal(result.value, null);
    assert.equal(result.applicableCount, 0);
    assert.equal(result.assessedCount, 0);
    assert.equal(result.reason, "NO_APPLICABLE_ITEMS");
  });

  it("returns NOT_ASSESSED when there are no applicable items", () => {
    const result = calculateComplianceMetric(["not_applicable", "not_applicable"]);

    assert.deepEqual(result, {
      status: "NOT_ASSESSED",
      value: null,
      numerator: 0,
      denominator: 0,
      assessedCount: 0,
      applicableCount: 0,
      reason: "NO_APPLICABLE_ITEMS",
    });
  });

  it("returns NOT_ASSESSED when applicable items have not been assessed", () => {
    const result = calculateComplianceMetric(Array(10).fill("not_assessed"));

    assert.equal(result.status, "NOT_ASSESSED");
    assert.equal(result.value, null);
    assert.equal(result.assessedCount, 0);
    assert.equal(result.applicableCount, 10);
    assert.equal(result.reason, "NO_ASSESSED_ITEMS");
  });

  it("calculates passed and failed items", () => {
    const result = calculateComplianceMetric([
      "passed",
      "passed",
      "passed",
      "failed",
    ]);

    assert.equal(result.value, 75);
    assert.equal(result.numerator, 3);
    assert.equal(result.denominator, 4);
    assert.equal(result.assessedCount, 4);
    assert.equal(result.applicableCount, 4);
    assert.equal(result.status, "ASSESSED");
    assert.equal(result.reason, "CALCULATED");
  });

  it("preserves partial coverage without changing the assessed score", () => {
    const result = calculateComplianceMetric([
      "passed",
      "passed",
      "passed",
      "failed",
      ...Array(96).fill("not_assessed"),
    ]);

    assert.equal(result.value, 75);
    assert.equal(result.assessedCount, 4);
    assert.equal(result.applicableCount, 100);
    assert.equal(result.status, "PARTIALLY_ASSESSED");
    assert.equal(result.reason, "PARTIAL_COVERAGE");
  });

  it("keeps waived distinct from not applicable and outside the score", () => {
    const result = calculateComplianceMetric(["waived", "not_applicable"]);

    assert.equal(result.value, null);
    assert.equal(result.assessedCount, 0);
    assert.equal(result.applicableCount, 1);
    assert.equal(result.reason, "NO_ASSESSED_ITEMS");
  });

  it("returns zero rather than null when all assessed items failed", () => {
    const result = calculateComplianceMetric(Array(4).fill("failed"));

    assert.equal(result.value, 0);
    assert.equal(result.numerator, 0);
    assert.equal(result.denominator, 4);
    assert.equal(result.assessedCount, 4);
    assert.equal(result.applicableCount, 4);
    assert.equal(result.status, "ASSESSED");
  });
});

describe("calculateAssessedAverage", () => {
  it("excludes unassessed systems from the average", () => {
    assert.equal(calculateAssessedAverage([80, null, undefined, 100]), 90);
  });

  it("returns null when no system has been assessed", () => {
    assert.equal(calculateAssessedAverage([null, undefined]), null);
  });

  it("preserves an assessed zero instead of treating it as missing", () => {
    assert.equal(calculateAssessedAverage([0, null]), 0);
  });
});
