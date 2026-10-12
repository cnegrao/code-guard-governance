import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as c from "../src/index.ts";

const sorted = (values) => [...values].sort();

describe("M17-S0 D-01 authority vocabulary", () => {
  it("the single Authority Policy permission vocabulary is exactly 23 tags (15 L14_* unchanged + 8 L15_*)", () => {
    assert.equal(c.L14_PERMISSIONS.length, 15);
    assert.deepEqual(sorted(c.L15_PERMISSIONS), [
      "L15_GOVERNED_RISK_VALIDATE", "L15_RISK_ACCEPTANCE_VALIDATE", "L15_RISK_ASSESSMENT_VALIDATE",
      "L15_RISK_METHODOLOGY_ADMIT", "L15_RISK_METHODOLOGY_VALIDATE", "L15_RISK_SCENARIO_ADMIT",
      "L15_RISK_SCENARIO_VALIDATE", "L15_RISK_TREATMENT_VALIDATE",
    ]);
    assert.equal(c.AUTHORITY_POLICY_PERMISSIONS.length, 23);
    assert.equal(new Set(c.AUTHORITY_POLICY_PERMISSIONS).size, 23);
    assert.ok(c.L14_PERMISSIONS.every((p) => p.startsWith("L14_")));
    assert.ok(c.L15_PERMISSIONS.every((p) => p.startsWith("L15_")));
  });

  it("the shared governance envelope has exactly 17 subjects; RISK_SIGNAL / RISK_HYPOTHESIS are never governance subjects", () => {
    assert.equal(c.L14_PROPOSAL_SUBJECT_KINDS.length, 11);
    assert.deepEqual(sorted(c.L15_GOVERNANCE_SUBJECT_KINDS), [
      "GOVERNED_RISK", "RISK_ACCEPTANCE", "RISK_ASSESSMENT", "RISK_METHODOLOGY", "RISK_SCENARIO_DEFINITION", "RISK_TREATMENT",
    ]);
    assert.equal(c.GOVERNANCE_ENVELOPE_SUBJECT_KINDS.length, 17);
    assert.equal(new Set(c.GOVERNANCE_ENVELOPE_SUBJECT_KINDS).size, 17);
    for (const kind of c.L15_NON_AUTHORITATIVE_STORE_KINDS) {
      assert.ok(!c.GOVERNANCE_ENVELOPE_SUBJECT_KINDS.includes(kind), kind);
      assert.equal(c.l15PermissionFor(kind, "VALIDATE"), null);
    }
    assert.deepEqual(sorted(c.L15_FACT_FAMILIES), ["GOVERNED_RISK", "RISK_ACCEPTANCE", "RISK_ASSESSMENT", "RISK_TREATMENT"]);
  });

  it("subject x action -> permission is closed; L14 subjects, unknown values and non-registry ADMIT fail closed", () => {
    const actions = ["ADMIT", "VALIDATE", "REJECT", "DEFER", "REVOKE"];
    for (const subject of c.L15_GOVERNANCE_SUBJECT_KINDS) {
      for (const action of actions) {
        const permission = c.l15PermissionFor(subject, action);
        if (action === "ADMIT") {
          assert.equal(permission === null, !c.L15_REGISTRY_SUBJECT_KINDS.includes(subject), `${subject} ${action}`);
          if (permission) assert.ok(permission.endsWith("_ADMIT"));
        } else {
          assert.ok(permission && permission.endsWith("_VALIDATE") && permission.startsWith("L15_"), `${subject} ${action}`);
        }
      }
    }
    for (const subject of c.L14_PROPOSAL_SUBJECT_KINDS) {
      for (const action of actions) assert.equal(c.l15PermissionFor(subject, action), null);
    }
    assert.equal(c.l15PermissionFor("GOVERNED_RISK", "APPROVE"), null);
    assert.equal(c.l15PermissionFor("RISK", "VALIDATE"), null);
    // Each L15 permission authorizes exactly one subject.
    const owners = new Map();
    for (const subject of c.L15_GOVERNANCE_SUBJECT_KINDS) {
      for (const action of actions) {
        const permission = c.l15PermissionFor(subject, action);
        if (permission) owners.set(permission, new Set([...(owners.get(permission) ?? []), subject]));
      }
    }
    assert.equal(owners.size, 8);
    for (const subjects of owners.values()) assert.equal(subjects.size, 1);
  });

  it("exactly 24 L15 reason codes follow the unchanged <SUBJECT>_{VALIDATED,REJECTED,DEFERRED,REVOKED} rule", () => {
    const codes = Object.values(c.L15_GOVERNANCE_REASON_CODES).flatMap((byOutcome) => Object.values(byOutcome));
    assert.equal(codes.length, 24);
    assert.equal(new Set(codes).size, 24);
    const past = { VALIDATE: "VALIDATED", REJECT: "REJECTED", DEFER: "DEFERRED", REVOKE: "REVOKED" };
    for (const [subject, byOutcome] of Object.entries(c.L15_GOVERNANCE_REASON_CODES)) {
      for (const [outcome, code] of Object.entries(byOutcome)) assert.equal(code, `${subject}_${past[outcome]}`);
    }
  });

  it("exactly two new ADMIT command kinds, each bound to one L15 registry subject", () => {
    assert.deepEqual(c.L15_ADMIT_COMMAND_SUBJECTS, {
      ADMIT_RISK_SCENARIO_DEFINITION_VERSION: "RISK_SCENARIO_DEFINITION",
      ADMIT_RISK_METHODOLOGY_VERSION: "RISK_METHODOLOGY",
    });
  });
});

describe("M17-S0 L15 closed V1 vocabularies (ADR §11)", () => {
  it("exactly nine risk domains; regulatory / compliance / legal / financial are not domains", () => {
    assert.deepEqual(sorted(c.L15_RISK_DOMAINS), [
      "AUTHORIZATION", "AUTONOMY", "CONNECTIVITY", "CYBERSECURITY", "DATA", "FINOPS", "MODEL", "OPERATIONAL", "PRIVACY",
    ]);
    for (const value of ["COMPLIANCE", "REGULATORY", "LEGAL", "FINANCIAL", "REPUTATIONAL", "STRATEGIC"]) {
      assert.ok(!c.L15_RISK_DOMAINS.includes(value), value);
    }
  });

  it("exact vocabularies and cardinalities", () => {
    assert.equal(c.L15_SIGNAL_KINDS.length, 10);
    assert.deepEqual(sorted(c.L15_SIGNAL_SOURCE_CLASSES),
      ["GOVERNED_FACT_REFERENCE", "LOCAL_HUMAN", "RUNTIME_SOURCE", "SOURCE_CONNECTION", "SYSTEM_DETECTOR"]);
    for (const [kind, source] of Object.entries(c.L15_SIGNAL_KIND_SOURCES)) assert.ok(c.L15_SIGNAL_SOURCE_CLASSES.includes(source), kind);
    assert.deepEqual(sorted(c.L15_SIGNAL_TRUST_STATES), ["DECLARED", "IMPORTED", "INFERRED", "OBSERVED"]);
    assert.ok(!c.L15_SIGNAL_TRUST_STATES.includes("VALIDATED"));
    assert.equal(Object.values(c.TRUST_STATE).length, 5, "baseline trust vocabulary unchanged");
    assert.equal(c.L15_HYPOTHESIS_GENERATOR_KINDS.length, 5);
    assert.deepEqual([...c.L15_GOVERNED_STATE_KINDS], ["VALIDATED", "REVOKED"]);
    assert.deepEqual([...c.L15_ASSESSMENT_BASES], ["INHERENT", "RESIDUAL"]);
    assert.deepEqual([...c.L15_ASSESSMENT_OUTCOMES], ["RATED", "INSUFFICIENT_EVIDENCE"]);
    assert.deepEqual([...c.L15_RATING_BANDS], ["LOW", "MODERATE", "HIGH", "CRITICAL"]);
    assert.deepEqual([...c.L15_TREATMENT_OPTIONS], ["MITIGATE", "AVOID", "TRANSFER"]);
    assert.deepEqual([...c.L15_TREATMENT_IMPLEMENTATION_STATUSES], ["PLANNED", "IMPLEMENTED"]);
    assert.equal(c.L15_RISK_LIFECYCLE_PROJECTION.length, 7);
    assert.deepEqual([...c.L15_RESIDUAL_ELIGIBILITY_PROJECTION], ["CURRENT", "DEPENDENCY_INVALID", "EXPIRED", "ABSENT"]);
    assert.deepEqual([...c.L15_CONFLICT_PROJECTION], ["RESOLVED", "CONFLICT", "INSUFFICIENT_EVIDENCE"]);
    assert.deepEqual([...c.L15_SUPPORT_CURRENCY_PROJECTION], ["SUPPORT_CURRENT", "SUPPORT_DEGRADED", "SUPPORT_NONE"]);
    assert.equal(c.L15_CLOSURE_REASONS.length, 5);
    assert.deepEqual([...c.L15_TREATMENT_REVOCATION_REASONS], ["TREATMENT_FAILED", "TREATMENT_WITHDRAWN", "RECORDED_IN_ERROR"]);
    assert.deepEqual(c.L15_METHODOLOGY_SCALE_LEVELS, { min: 2, max: 7 });
  });

  it("no waiver / exception / acceptance-as-treatment / legacy status value exists in any L15 vocabulary", () => {
    const all = [
      ...c.L15_TREATMENT_OPTIONS, ...c.L15_TREATMENT_IMPLEMENTATION_STATUSES, ...c.L15_GOVERNED_STATE_KINDS,
      ...c.L15_RISK_LIFECYCLE_PROJECTION, ...c.L15_ASSESSMENT_OUTCOMES, ...c.L15_CLOSURE_REASONS,
      ...c.L15_TREATMENT_REVOCATION_REASONS,
    ];
    for (const forbidden of ["WAIVED", "WAIVER", "EXCEPTION", "ACCEPT", "verified", "failed", "VERIFIED"]) {
      assert.ok(!all.includes(forbidden), forbidden);
    }
  });

  it("legal subjects exclude PROMPT / KNOWLEDGE_BASE / SKILL; the canonical taxonomy is unchanged (11 kinds, 12 types)", () => {
    assert.equal(Object.values(c.CANONICAL_OBJECT_KIND).length, 11);
    assert.equal(Object.values(c.GOVERNED_RELATIONSHIP_TYPE).length, 12);
    assert.ok(!Object.values(c.CANONICAL_OBJECT_KIND).some((kind) => kind.includes("RISK")));
    assert.ok(!Object.values(c.GOVERNED_RELATIONSHIP_TYPE).some((type) => type.includes("RISK") || type === "MITIGATES"));
    assert.deepEqual(sorted(c.L15_OBJECT_SUBJECT_KINDS),
      ["AGENT", "AGENT_VERSION", "API", "DATA_ASSET", "DATA_ELEMENT", "MCP_SERVER", "MODEL", "TOOL"]);
  });

  it("the domain x subject matrix is the closed §8.2 matrix (AGENT only for OPERATIONAL; every other pairing rejected)", () => {
    let legal = 0;
    for (const domain of c.L15_RISK_DOMAINS) {
      for (const kind of Object.values(c.CANONICAL_OBJECT_KIND)) {
        const ok = c.isLegalL15DomainSubject(domain, { tag: "OBJECT", kind });
        if (["PROMPT", "KNOWLEDGE_BASE", "SKILL"].includes(kind)) assert.equal(ok, false);
        if (kind === "AGENT") assert.equal(ok, domain === "OPERATIONAL");
        if (ok) legal++;
      }
      for (const relationshipType of Object.values(c.GOVERNED_RELATIONSHIP_TYPE)) {
        if (c.isLegalL15DomainSubject(domain, { tag: "RELATIONSHIP_STATE", relationshipType })) legal++;
      }
    }
    // Objects: 3+5+4+1+2+2+4+6+3 = 30; relationships: 3+5+5+5+1+4+3+12+2 = 40.
    assert.equal(legal, 70);
    assert.equal(c.isLegalL15DomainSubject("COMPLIANCE", { tag: "OBJECT", kind: "AGENT_VERSION" }), false);
  });

  it("support admissibility is the closed acyclic §9.2 matrix", () => {
    const rank = (tag) => (tag === "RISK_SIGNAL" ? 1 : tag === "RISK_HYPOTHESIS" ? 2 : c.L15_UPSTREAM_EVIDENCE_TAGS.includes(tag) ? 0 : 3);
    assert.equal(c.L15_SUPPORT_TARGET_TAGS.length, 10);
    for (const owner of c.L15_SUPPORT_OWNER_KINDS) {
      for (const target of [...c.L15_SUPPORT_TARGET_TAGS, ...c.L15_GOVERNANCE_SUBJECT_KINDS]) {
        if (c.isAdmissibleL15SupportLink(owner, target)) assert.ok(rank(owner) > rank(target), `${owner} -> ${target}`);
      }
    }
    assert.equal(c.isAdmissibleL15SupportLink("RISK_SIGNAL", "RISK_SIGNAL"), false);
    assert.equal(c.isAdmissibleL15SupportLink("RISK_HYPOTHESIS", "RISK_HYPOTHESIS"), false);
    assert.equal(c.isAdmissibleL15SupportLink("RISK_HYPOTHESIS", "DISCOVERY_EVIDENCE"), false);
    assert.equal(c.isAdmissibleL15SupportLink("RISK_SIGNAL", "RISK_HYPOTHESIS"), false);
    assert.equal(c.isAdmissibleL15SupportLink("RISK_SCENARIO_DEFINITION", "RISK_SIGNAL"), false);
    assert.equal(c.isAdmissibleL15SupportLink("GOVERNED_RISK", "GOVERNED_RISK"), false);
    assert.equal(c.isAdmissibleL15SupportLink("LLM_OUTPUT", "RISK_SIGNAL"), false);
  });
});
