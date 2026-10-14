import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as c from "../src/index.ts";

describe("M17-S4 RISK_ASSESSMENT contracts", () => {
  it("closed vocabularies: architectural basis INHERENT | RESIDUAL, executable INHERENT only; RATED | INSUFFICIENT_EVIDENCE; four bands", () => {
    assert.deepEqual([...c.L15_RISK_ASSESSMENT_BASES], ["INHERENT", "RESIDUAL"]);
    assert.deepEqual([...c.L15_RISK_ASSESSMENT_EXECUTABLE_BASES], ["INHERENT"]);
    assert.ok(!c.L15_RISK_ASSESSMENT_EXECUTABLE_BASES.includes("RESIDUAL"));
    assert.deepEqual([...c.L15_RISK_ASSESSMENT_OUTCOMES], ["RATED", "INSUFFICIENT_EVIDENCE"]);
    assert.deepEqual([...c.L15_RISK_RATING_BANDS], ["LOW", "MODERATE", "HIGH", "CRITICAL"]);
    assert.deepEqual([...c.L15_RISK_ASSESSMENT_STATE_KINDS], ["VALIDATED", "REVOKED"]);
    assert.deepEqual([...c.L15_RISK_ASSESSMENT_COMMAND_OUTCOMES], ["SUBMITTED", "VALIDATED", "REJECTED", "DEFERRED", "REVOKED", "DENIED"]);
    assert.deepEqual([...c.L15_RISK_ASSESSMENT_RESOLUTIONS], ["CURRENT", "NO_STATE", "REVOKED", "NOT_YET_EFFECTIVE", "EXPIRED",
      "GOVERNED_RISK_DEPENDENCY_INVALID", "METHODOLOGY_DEPENDENCY_INVALID"]);
    // UNKNOWN is a READ status only: never a stored outcome, never a band.
    assert.deepEqual([...c.L15_RISK_ASSESSMENT_READ_STATUSES], ["UNKNOWN", "RATED", "INSUFFICIENT_EVIDENCE"]);
    assert.ok(!c.L15_RISK_ASSESSMENT_OUTCOMES.includes("UNKNOWN"));
    assert.ok(!c.L15_RISK_RATING_BANDS.includes("UNKNOWN"));
  });

  it("human-proposal only: LOCAL_HUMAN executable; SYSTEM_SEED / SOURCE_CONNECTION / machine never", () => {
    assert.deepEqual([...c.L15_RISK_ASSESSMENT_EXECUTABLE_SOURCE_CLASSES], ["LOCAL_HUMAN"]);
    for (const s of ["SOURCE_CONNECTION", "SYSTEM_SEED", "SYSTEM_DETECTOR", "RUNTIME_SOURCE"]) {
      assert.ok(!c.L15_RISK_ASSESSMENT_EXECUTABLE_SOURCE_CLASSES.includes(s), s);
    }
  });

  it("support: rank-3 owner artifacts PROPOSAL / DECISION / STATE; the ten tags of the D-03 matrix; never a governed L15 artifact", () => {
    assert.deepEqual([...c.L15_RISK_ASSESSMENT_SUPPORT_OWNER_ARTIFACTS], ["PROPOSAL", "DECISION", "STATE"]);
    assert.deepEqual([...c.L15_RISK_ASSESSMENT_SUPPORT_TAGS], [...c.L15_SUPPORT_ADMISSIBILITY.RISK_ASSESSMENT]);
    assert.deepEqual([...c.L15_RISK_ASSESSMENT_SUPPORT_TAGS].sort(), [...c.L15_SUPPORT_TARGET_TAGS].sort());
    for (const t of ["GOVERNED_RISK", "RISK_ASSESSMENT", "RISK_TREATMENT", "RISK_ACCEPTANCE", "RISK_METHODOLOGY", "RISK_SCENARIO_DEFINITION"]) {
      assert.ok(!c.isAdmissibleL15SupportLink("RISK_ASSESSMENT", t), t);
    }
    assert.equal(c.L15_RISK_ASSESSMENT_SUPPORT_MAX_ENTRIES, 64);
  });

  it("no numeric score type exists anywhere in the S4 contract surface (O31)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/l15-risk-assessment.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // No field / value is typed as a number (the `(typeof X)[number]` tuple-element idiom is not a field type).
    assert.doesNotMatch(src, /:\s*(readonly\s+)?number\b|number\[\]|score|weight|percent|product/i);
  });
});
