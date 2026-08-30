import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchScenario } from "../harness/match.ts";
import { normalizeDetectedScenario } from "../harness/normalize.ts";
import {
  buildValidationReport,
  serializeValidationReport,
} from "../harness/report.ts";
import {
  validDetectedScenario,
  validExpectedScenario,
} from "./test-helpers.ts";

describe("Validation report determinism", () => {
  it("serializes equivalent results identically despite order and volatile IDs", () => {
    const expected = validExpectedScenario();
    const detected = validDetectedScenario();
    const duplicate = {
      ...detected.agents[0],
      detectedKey: "detected:agent:duplicate",
      evidenceKeys: [],
    };
    const firstDetected = normalizeDetectedScenario({
      ...detected,
      runId: "run-one",
      scannedAt: "2026-01-01T00:00:00.000Z",
      agents: [detected.agents[0], duplicate],
    });
    const secondDetected = normalizeDetectedScenario({
      ...detected,
      runId: "run-two",
      scannedAt: "2099-12-31T23:59:59.999Z",
      agents: [duplicate, detected.agents[0]],
    });

    const first = serializeValidationReport(
      buildValidationReport(
        expected,
        firstDetected,
        matchScenario(expected, firstDetected),
      ),
    );
    const second = serializeValidationReport(
      buildValidationReport(
        expected,
        secondDetected,
        matchScenario(expected, secondDetected),
      ),
    );

    assert.equal(first, second);
    assert.equal(JSON.parse(first).scenarioId, "unit-scenario");
  });

  it("reports missing evidence structurally", () => {
    const expected = validExpectedScenario();
    const detected = validDetectedScenario();
    const normalized = normalizeDetectedScenario({
      ...detected,
      agents: [{ ...detected.agents[0], evidenceKeys: [] }],
      evidence: [],
    });
    const report = buildValidationReport(
      expected,
      normalized,
      matchScenario(expected, normalized),
    );

    assert.deepEqual(report.missingEvidence, [{
      requirementKey: "evidence:agent-declaration",
      subjectKey: "agent:care",
      sourceLocator: "src/agent.ts",
      reason: "EVIDENCE_NOT_FOUND",
      discoveryLayers: ["L4"],
    }]);
  });
});
