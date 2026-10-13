import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as c from "../src/index.ts";

const ORG = "00000000-0000-4000-8000-000000000017";
const subject = { mode: "CANONICAL_OBJECT", kind: "AGENT_VERSION", canonicalObjectId: "canonical-object:av" };
const base = { organisationId: ORG, intakeKey: "k-1", subject, methodId: "ADAPTER", methodVersion: "1.0.0" };
const allKeys = (value, out = new Set()) => {
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { out.add(k); allKeys(v, out); }
  return out;
};

describe("M17-S1 signal / hypothesis contracts", () => {
  it("closed vocabularies: 10 kinds with one source each, 4 unresolved reasons, trust never VALIDATED", () => {
    assert.equal(c.L15_SIGNAL_KINDS.length, 10);
    assert.deepEqual([...c.L15_UNRESOLVED_REASONS].sort(),
      ["AMBIGUOUS_MAPPING", "MISSING_REVISION_EVIDENCE", "NO_EXACT_MAPPING", "UNSUPPORTED_BINDING_PROOF"]);
    for (const trust of Object.values(c.L15_SIGNAL_SOURCE_TRUST)) assert.ok(!trust.includes("VALIDATED"));
    assert.deepEqual(c.L15_SIGNAL_SOURCE_TRUST.GOVERNED_FACT_REFERENCE, []);
    assert.deepEqual(c.L15_SIGNAL_SOURCE_TRUST.LOCAL_HUMAN, []);
    // Every kind's admissible targets are rank-0 tags only (§9.2: a signal never cites a signal or a hypothesis).
    for (const kind of c.L15_SIGNAL_KINDS) {
      assert.ok(c.L15_SIGNAL_KIND_TARGETS[kind].length > 0, kind);
      for (const tag of c.L15_SIGNAL_KIND_TARGETS[kind]) assert.ok(c.L15_UPSTREAM_EVIDENCE_TAGS.includes(tag), `${kind} ${tag}`);
    }
    assert.ok(!c.L15_ADMISSIBLE_CROSS_SIGNAL_OUTCOMES.includes("CONSISTENT"));
    assert.ok(!c.L15_ADMISSIBLE_CONTROL_ASSESSMENT_OUTCOMES.includes("SATISFIED"));
  });

  it("M15 adapter: CONFLICT_CANDIDATE / INSUFFICIENT_EVIDENCE accepted as an exact reference; CONSISTENT rejected", () => {
    for (const outcome of ["CONFLICT_CANDIDATE", "INSUFFICIENT_EVIDENCE"]) {
      const cmd = c.crossSignalResultSignal(base, { comparisonId: "cross-signal-comparison:x", outcome });
      assert.equal(cmd.signalKind, "CROSS_SIGNAL_RESULT_REF");
      assert.equal(cmd.sourceClass, "GOVERNED_FACT_REFERENCE");
      assert.equal(cmd.trustState, null, "GOVERNED_FACT_REFERENCE owns no trust");
      assert.deepEqual(cmd.support, [{ tag: "CROSS_SIGNAL_RESULT", targetId: "cross-signal-comparison:x" }]);
      assert.ok(!JSON.stringify(cmd).includes(outcome), "the M15 outcome is not copied into L15");
    }
    assert.throws(() => c.crossSignalResultSignal(base, { comparisonId: "x", outcome: "CONSISTENT" }), /CROSS_SIGNAL_RESULT_NOT_ADMISSIBLE/);
  });

  it("L12 / L11 / lineage adapters emit exact references only (no copied value)", () => {
    const runtime = c.runtimeObservationSignal(base, ["11111111-1111-4111-8111-111111111111"]);
    assert.equal(runtime.trustState, "OBSERVED");
    assert.equal(runtime.sourceClass, "RUNTIME_SOURCE");
    const exec = c.executionContextSignal(base, ["state-1"]);
    assert.equal(exec.trustState, null);
    const lineage = c.lineageSignal(base, ["finding-1"]);
    assert.equal(lineage.support[0].tag, "LINEAGE_OBSERVATION");
    for (const cmd of [runtime, exec, lineage]) {
      const keys = allKeys(cmd);
      for (const k of ["latency", "duration", "error", "tokens", "cost", "amount", "principal", "grant", "environment", "egress", "domain", "rating"]) {
        assert.ok(![...keys].some(x => x.toLowerCase().includes(k)), `${cmd.signalKind}: ${k}`);
      }
    }
  });

  it("M16 adapters: CONTROL_ASSESSMENT SATISFIED rejected; governance gap requires support and a closed query", () => {
    for (const outcome of c.L15_ADMISSIBLE_CONTROL_ASSESSMENT_OUTCOMES) {
      assert.equal(c.controlAssessmentSignal(base, { factStateId: "22222222-2222-4222-8222-222222222222", outcome }).signalKind,
        "CONTROL_ASSESSMENT_REF");
    }
    assert.throws(() => c.controlAssessmentSignal(base, { factStateId: "x", outcome: "SATISFIED" }), /CONTROL_ASSESSMENT_NOT_ADMISSIBLE/);
    const gap = c.governanceGapSignal(base, { family: "RESPONSIBILITY_ASSIGNMENT", responsibilityRole: "DATA_OWNER" },
      [{ tag: "DISCOVERY_EVIDENCE", targetId: "e" }]);
    assert.equal(gap.signalKind, "GOVERNANCE_GAP_REF");
    assert.equal(c.l15SignalObservationPresentation("GOVERNANCE_GAP_REF"), "unknown", "UNKNOWN != FALSE");
    assert.throws(() => c.governanceGapSignal(base, { family: "CONTROL_ASSESSMENT", controlDefinitionId: "x" }, []),
      /MACHINE_SIGNAL_REQUIRES_EVIDENCE/, "never fabricated");
  });

  it("machine signal validation: unknown kind, wrong source, VALIDATED trust, missing method, zero evidence, wrong tag", () => {
    const ok = c.runtimeObservationSignal(base, ["11111111-1111-4111-8111-111111111111"]);
    const bad = (patch, code) => assert.throws(() => c.validateL15MachineSignalCommand({ ...ok, ...patch }), new RegExp(code));
    bad({ signalKind: "RISK_SCORE" }, "SIGNAL_KIND_UNKNOWN");
    bad({ signalKind: "HUMAN_OBSERVATION" }, "SIGNAL_KIND_UNKNOWN");
    bad({ sourceClass: "SYSTEM_DETECTOR" }, "SIGNAL_SOURCE_MISMATCH");
    bad({ trustState: "VALIDATED" }, "TRUST_VALIDATED_FORBIDDEN");
    bad({ trustState: "INFERRED" }, "TRUST_SOURCE_MISMATCH");
    bad({ methodVersion: "" }, "METHOD_VERSION_REQUIRED");
    bad({ support: [] }, "MACHINE_SIGNAL_REQUIRES_EVIDENCE");
    bad({ support: [{ tag: "RISK_SIGNAL", targetId: "x" }] }, "SUPPORT_TAG_NOT_ADMISSIBLE");
    bad({ hintSeverity: "critical" }, "HINT_NOT_ADMISSIBLE");
  });

  it("machine hypothesis validation: method / LLM tuple / traversal / representation / >= 1 signal / no UNRESOLVED", () => {
    const h = { organisationId: ORG, intakeKey: "h", generatorKind: "DETERMINISTIC_RULE", subject, methodId: "R", methodVersion: "1",
      llm: null, traversalPolicyVersion: null, representationVersion: null, hintConfidence: 1, citedSignalIds: ["s"] };
    assert.equal(c.validateL15MachineHypothesisCommand(h), h);
    const bad = (patch, code) => assert.throws(() => c.validateL15MachineHypothesisCommand({ ...h, ...patch }), new RegExp(code));
    bad({ methodId: "" }, "METHOD_VERSION_REQUIRED");
    bad({ generatorKind: "LLM_ASSISTED" }, "LLM_PROVENANCE_REQUIRED");
    bad({ generatorKind: "LLM_ASSISTED", llm: { modelProvider: "p", modelId: "m", promptTemplateVersion: "" } }, "LLM_PROVENANCE_REQUIRED");
    bad({ generatorKind: "GRAPH_ANALYSIS" }, "TRAVERSAL_POLICY_VERSION_REQUIRED");
    bad({ generatorKind: "VECTOR_RETRIEVAL" }, "REPRESENTATION_VERSION_REQUIRED");
    bad({ citedSignalIds: [] }, "HYPOTHESIS_REQUIRES_SIGNAL");
    bad({ subject: { mode: "UNRESOLVED", reason: "NO_EXACT_MAPPING" } }, "SUBJECT_SHAPE_INVALID");
  });
});
