import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as c from "../src/index.ts";

describe("M17-S2 RISK_SCENARIO_DEFINITION / RISK_METHODOLOGY registry contracts", () => {
  it("closed registry vocabularies: executable sources, rank-3 support tags, owner artifacts, intents", () => {
    assert.deepEqual([...c.L15_REGISTRY_SOURCE_CLASSES], ["LOCAL_HUMAN", "SYSTEM_SEED"]);
    assert.ok(!c.L15_REGISTRY_SOURCE_CLASSES.includes("SOURCE_CONNECTION"));
    assert.deepEqual([...c.L15_REGISTRY_SUPPORT_TAGS], [...c.L15_SUPPORT_ADMISSIBILITY.RISK_SCENARIO_DEFINITION]);
    assert.deepEqual([...c.L15_REGISTRY_SUPPORT_TAGS], [...c.L15_SUPPORT_ADMISSIBILITY.RISK_METHODOLOGY]);
    assert.deepEqual([...c.L15_REGISTRY_SUPPORT_OWNER_ARTIFACTS], ["PROPOSAL", "DECISION", "STATE"]);
    assert.deepEqual([...c.L15_REGISTRY_PROPOSAL_INTENTS], ["VALIDATE", "REVOKE"]);
  });

  it("scenario subject tokens: 8 legal objects + 12 REL:<type>; PROMPT / KNOWLEDGE_BASE / SKILL are not direct subjects", () => {
    assert.equal(c.L15_SCENARIO_SUBJECT_TOKENS.length, 20);
    assert.deepEqual(c.L15_SCENARIO_SUBJECT_TOKENS.slice(0, 8), [...c.L15_OBJECT_SUBJECT_KINDS]);
    for (const k of ["PROMPT", "KNOWLEDGE_BASE", "SKILL"]) assert.ok(!c.L15_SCENARIO_SUBJECT_TOKENS.includes(k));
    let legal = 0;
    for (const d of c.L15_RISK_DOMAINS) for (const s of c.L15_SCENARIO_SUBJECT_TOKENS) if (c.isLegalL15ScenarioSubject(d, s)) legal++;
    assert.equal(legal, Object.values(c.L15_DOMAIN_SUBJECT_MATRIX).reduce((n, e) => n + e.objects.length + e.relationships.length, 0));
    assert.equal(c.isLegalL15ScenarioSubject("OPERATIONAL", "AGENT"), true);
    for (const d of c.L15_RISK_DOMAINS.filter(d => d !== "OPERATIONAL")) assert.equal(c.isLegalL15ScenarioSubject(d, "AGENT"), false, d);
    for (const d of ["COMPLIANCE", "REGULATORY", "LEGAL", "FINANCIAL", "STRATEGIC", "REPUTATIONAL", "TECHNOLOGY", "THIRD_PARTY", "ARCHITECTURAL"]) {
      assert.equal(c.isLegalL15ScenarioSubject(d, "AGENT_VERSION"), false, d);
    }
    assert.equal(c.isLegalL15ScenarioSubject("PRIVACY", "REL:UNKNOWN"), false);
  });

  it("typed reference codes: closed namespaces with bounded syntax; never free text", () => {
    assert.deepEqual([...c.L15_SCENARIO_REFERENCE_NAMESPACES].sort(), ["CG_AG_CONTROL_ID", "ORGANISATION_SCENARIO_CODE", "SCANNER_RULE_ID"]);
    assert.ok(c.isValidL15ScenarioReference("SCANNER_RULE_ID", "RISK-NO-README"));
    assert.ok(c.isValidL15ScenarioReference("CG_AG_CONTROL_ID", "CG-AG-001"));
    assert.ok(c.isValidL15ScenarioReference("ORGANISATION_SCENARIO_CODE", "PRV.DATA-01"));
    for (const [ns, code] of [["SCANNER_RULE_ID", "risk-no-readme"], ["CG_AG_CONTROL_ID", "CG-AG-1"], ["ORGANISATION_SCENARIO_CODE", "Sensitive data read"],
      ["ORGANISATION_SCENARIO_CODE", "A".repeat(65)], ["URL", "https://x"]]) {
      assert.equal(c.isValidL15ScenarioReference(ns, code), false, `${ns}:${code}`);
    }
  });

  it("methodology bounds: 2..7 levels, four closed bands, ordinal the only numeric field", () => {
    assert.deepEqual(c.L15_METHODOLOGY_SCALE_BOUNDS, { min: 2, max: 7 });
    assert.deepEqual([...c.L15_METHODOLOGY_RATING_BANDS], ["LOW", "MODERATE", "HIGH", "CRITICAL"]);
    assert.deepEqual([...c.L15_METHODOLOGY_DEFINITION_NAMESPACES], ["ORGANISATION_DEFINITION_CODE"]);
    assert.ok(c.L15_METHODOLOGY_LEVEL_CODE.test("L1") && !c.L15_METHODOLOGY_LEVEL_CODE.test("l1"));
  });
});
