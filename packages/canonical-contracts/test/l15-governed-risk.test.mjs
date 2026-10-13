import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as c from "../src/index.ts";

describe("M17-S3 GOVERNED_RISK contracts", () => {
  it("closed vocabularies: LOCAL_HUMAN only (SOURCE_CONNECTION dependency-deferred to M19), all 10 rank-3 support tags, closure reasons", () => {
    assert.deepEqual([...c.L15_GOVERNED_RISK_EXECUTABLE_SOURCE_CLASSES], ["LOCAL_HUMAN"]);
    for (const s of ["SOURCE_CONNECTION", "SYSTEM_SEED", "SYSTEM_DETECTOR"]) assert.ok(!c.L15_GOVERNED_RISK_EXECUTABLE_SOURCE_CLASSES.includes(s));
    assert.deepEqual([...c.L15_GOVERNED_RISK_SUPPORT_TAGS], [...c.L15_SUPPORT_ADMISSIBILITY.GOVERNED_RISK]);
    assert.equal(c.L15_GOVERNED_RISK_SUPPORT_TAGS.length, 10);
    assert.deepEqual([...c.L15_GOVERNED_RISK_SUPPORT_TAGS].sort(), [...c.L15_SUPPORT_TARGET_TAGS].sort());
    assert.equal(c.L15_GOVERNED_RISK_SUPPORT_MAX_ENTRIES, 64);
    assert.deepEqual([...c.L15_GOVERNED_RISK_CLOSURE_REASONS], ["RISK_NO_LONGER_APPLICABLE", "SUBJECT_RETIRED", "DUPLICATE_OF_GOVERNED_RISK",
      "RISK_ELIMINATED_BY_AVOIDANCE", "RECORDED_IN_ERROR"]);
    assert.deepEqual([...c.L15_GOVERNED_RISK_STATE_KINDS], ["VALIDATED", "REVOKED"]);
    assert.deepEqual([...c.L15_GOVERNED_RISK_COMMAND_OUTCOMES], ["SUBMITTED", "VALIDATED", "REJECTED", "DEFERRED", "REVOKED", "DENIED"]);
    assert.deepEqual([...c.L15_GOVERNED_RISK_RESOLUTIONS], ["CURRENT", "NO_STATE", "REVOKED", "NOT_YET_EFFECTIVE", "EXPIRED",
      "SUBJECT_UNRESOLVED", "SCENARIO_DEPENDENCY_INVALID"]);
    assert.deepEqual([...c.L15_SUPPORT_FAILURE_REASONS], ["L14_FACT_STATE_NOT_CURRENT", "FIELD_STATE_SUPERSEDED", "SIGNAL_SUPPORT_NOT_CURRENT",
      "HYPOTHESIS_SUPPORT_NOT_CURRENT"]);
    assert.deepEqual([...c.L15_RISK_SUBJECT_TYPES], ["CANONICAL_OBJECT", "RELATIONSHIP_STATE"]);
  });

  it("subject key: injective, length-prefixed in code points, branch-tagged; illegal shapes have no key", () => {
    assert.equal(c.l15RiskSubjectKey({ subjectType: "CANONICAL_OBJECT", canonicalKind: "TOOL", canonicalObjectId: "a|1:b" }), "CANONICAL_OBJECT|4:TOOL|5:a|1:b");
    assert.equal(c.l15RiskSubjectKey({ subjectType: "RELATIONSHIP_STATE", relationshipId: "r", relationshipStateId: "s😀" }), "RELATIONSHIP_STATE|1:r|2:s😀");
    assert.notEqual(c.l15RiskSubjectKey({ subjectType: "RELATIONSHIP_STATE", relationshipId: "a|1:b", relationshipStateId: "c" }),
      c.l15RiskSubjectKey({ subjectType: "RELATIONSHIP_STATE", relationshipId: "a", relationshipStateId: "b|1:c" }));
    for (const kind of ["PROMPT", "KNOWLEDGE_BASE", "SKILL"]) {
      assert.equal(c.l15RiskSubjectKey({ subjectType: "CANONICAL_OBJECT", canonicalKind: kind, canonicalObjectId: "x" }), null, kind);
    }
    assert.equal(c.l15RiskSubjectKey({ subjectType: "RELATIONSHIP_TYPE", relationshipType: "USES_MODEL" }), null);
  });

  it("legality: the closed §8.2 matrix; a relationship-state subject needs its DB-resolved type; 70 legal pairs over 180", () => {
    const rels = ["USES_MODEL", "USES_TOOL", "USES_MCP", "INVOKES", "USES_PROMPT", "USES_KNOWLEDGE_BASE", "USES_SKILL", "EXPOSES", "HANDOFF_TO",
      "READS_FROM", "WRITES_TO", "DERIVED_FROM"];
    const tokens = [...c.L15_OBJECT_SUBJECT_KINDS, ...rels.map(t => `REL:${t}`)];
    let legal = 0;
    for (const d of c.L15_RISK_DOMAINS) for (const t of tokens) {
      const subject = t.startsWith("REL:") ? { subjectType: "RELATIONSHIP_STATE", relationshipId: "r", relationshipStateId: "s" }
        : { subjectType: "CANONICAL_OBJECT", canonicalKind: t, canonicalObjectId: "o" };
      const ok = c.isLegalGovernedRiskSubject(d, subject, t.startsWith("REL:") ? t.slice(4) : undefined);
      assert.equal(ok, c.isLegalL15ScenarioSubject(d, t), `${d} x ${t}`);
      if (ok) legal++;
    }
    assert.equal(c.L15_RISK_DOMAINS.length * tokens.length, 180);
    assert.equal(legal, 70);
    assert.equal(c.isLegalGovernedRiskSubject("DATA", { subjectType: "RELATIONSHIP_STATE", relationshipId: "r", relationshipStateId: "s" }), false,
      "an unresolved relationship state is never legal");
    assert.equal(c.l15RiskSubjectToken({ subjectType: "RELATIONSHIP_STATE", relationshipId: "r", relationshipStateId: "s" }), null);
    assert.equal(c.l15RiskSubjectToken({ subjectType: "RELATIONSHIP_STATE", relationshipId: "r", relationshipStateId: "s" }, "READS_FROM"), "REL:READS_FROM");
  });
});
