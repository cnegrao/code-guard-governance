import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DetectedScenarioResult } from "../contracts/detected.ts";
import type { ExpectedScenario } from "../contracts/expected.ts";
import { matchScenario } from "../harness/match.ts";
import {
  modelComparisonKey,
  normalizeDetectedScenario,
} from "../harness/normalize.ts";
import { validateExpectedScenario } from "../harness/oracle-loader.ts";
import { buildValidationReport } from "../harness/report.ts";
import {
  validDetectedScenario,
  validExpectedScenario,
} from "./test-helpers.ts";

const TECHNICAL_CATEGORIES = [
  "MODEL",
  "TOOL",
  "MCP_SERVER",
  "API",
  "PROMPT",
  "KNOWLEDGE_BASE",
] as const;

function technicalExpectedScenario(): ExpectedScenario {
  const base = validExpectedScenario();
  return {
    ...base,
    models: [{
      key: "model:care",
      requiredFromRound: 1,
      provider: "vendor-a",
      modelReference: "model-v1",
      sourcePath: "src/model.ts",
      declarationKey: "careModel",
      discoveryLayers: ["L4"],
    }],
    tools: [{
      key: "tool:customer-lookup",
      requiredFromRound: 1,
      sourcePath: "src/tools.ts",
      declarationKey: "lookupCustomer",
      discoveryLayers: ["L4"],
    }],
    mcpServers: [{
      key: "mcp:customer",
      requiredFromRound: 1,
      serverIdentity: "customer-mcp",
      sourcePath: "mcp/server.json",
      discoveryLayers: ["L4"],
    }],
    apis: [{
      key: "api:customer",
      requiredFromRound: 1,
      apiIdentity: "customer-api",
      sourcePath: "src/api-client.ts",
      discoveryLayers: ["L4"],
    }],
    prompts: [{
      key: "prompt:care-system",
      requiredFromRound: 1,
      sourcePath: "prompts/system.md",
      declarationKey: "care-system",
      discoveryLayers: ["L4"],
    }],
    knowledgeBases: [{
      key: "knowledge-base:handbook",
      requiredFromRound: 1,
      sourceIdentity: "customer-handbook",
      sourcePath: "config/rag.yml",
      discoveryLayers: ["L4"],
    }],
    relationships: [
      ...base.relationships,
      {
        key: "relationship:agent-uses-model",
        requiredFromRound: 1,
        relationshipType: "USES_MODEL",
        sourceKey: "agent:care",
        targetKey: "model:care",
        discoveryLayers: ["L9"],
      },
      {
        key: "relationship:agent-uses-tool",
        requiredFromRound: 1,
        relationshipType: "USES_TOOL",
        sourceKey: "agent:care",
        targetKey: "tool:customer-lookup",
        discoveryLayers: ["L9"],
      },
      {
        key: "relationship:agent-uses-mcp",
        requiredFromRound: 1,
        relationshipType: "USES_MCP",
        sourceKey: "agent:care",
        targetKey: "mcp:customer",
        discoveryLayers: ["L9"],
      },
      {
        key: "relationship:agent-invokes-api",
        requiredFromRound: 1,
        relationshipType: "INVOKES",
        sourceKey: "agent:care",
        targetKey: "api:customer",
        discoveryLayers: ["L9"],
      },
      {
        key: "relationship:agent-uses-knowledge-base",
        requiredFromRound: 1,
        relationshipType: "USES_KNOWLEDGE_BASE",
        sourceKey: "agent:care",
        targetKey: "knowledge-base:handbook",
        discoveryLayers: ["L9"],
      },
    ],
    evidenceRequirements: [
      ...base.evidenceRequirements,
      {
        key: "evidence:model-declaration",
        requiredFromRound: 1,
        subjectKey: "model:care",
        sourceLocator: "src/model.ts",
        methodCode: "MODEL_DECLARATION",
        discoveryLayers: ["L4"],
      },
    ],
  };
}

function technicalDetectedScenario(): DetectedScenarioResult {
  const base = validDetectedScenario();
  return {
    ...base,
    models: [{
      kind: "MODEL",
      detectedKey: "detected:model:care",
      provider: "vendor-a",
      modelReference: "model-v1",
      sourcePath: "src/model.ts",
      declarationKey: "careModel",
      method: { code: "MODEL_DECLARATION", version: "1" },
      trustState: "INFERRED",
      evidenceKeys: ["detected:evidence:model"],
    }],
    tools: [{
      kind: "TOOL",
      detectedKey: "detected:tool:customer-lookup",
      sourcePath: "src/tools.ts",
      declarationKey: "lookupCustomer",
      method: { code: "TOOL_DECLARATION", version: "1" },
      trustState: "DECLARED",
    }],
    mcpServers: [{
      kind: "MCP_SERVER",
      detectedKey: "detected:mcp:customer",
      serverIdentity: "customer-mcp",
      sourcePath: "mcp/server.json",
      method: { code: "MCP_CONFIG", version: "1" },
      trustState: "DECLARED",
    }],
    apis: [{
      kind: "API",
      detectedKey: "detected:api:customer",
      apiIdentity: "customer-api",
      sourcePath: "src/api-client.ts",
      method: { code: "API_REFERENCE", version: "1" },
      trustState: "INFERRED",
    }],
    prompts: [{
      kind: "PROMPT",
      detectedKey: "detected:prompt:care-system",
      sourcePath: "prompts/system.md",
      declarationKey: "care-system",
      method: { code: "PROMPT_DECLARATION", version: "1" },
      trustState: "DECLARED",
    }],
    knowledgeBases: [{
      kind: "KNOWLEDGE_BASE",
      detectedKey: "detected:knowledge-base:handbook",
      sourceIdentity: "customer-handbook",
      sourcePath: "config/rag.yml",
      method: { code: "RAG_CONFIG", version: "1" },
      trustState: "DECLARED",
    }],
    relationships: [
      ...base.relationships,
      {
        kind: "RELATIONSHIP",
        detectedKey: "detected:relationship:agent-uses-model",
        relationshipType: "USES_MODEL",
        sourceKey: "detected:agent:care",
        targetKey: "detected:model:care",
        method: { code: "STATIC_AI_USAGE", version: "1" },
        trustState: "INFERRED",
      },
      {
        kind: "RELATIONSHIP",
        detectedKey: "detected:relationship:agent-uses-tool",
        relationshipType: "USES_TOOL",
        sourceKey: "detected:agent:care",
        targetKey: "detected:tool:customer-lookup",
        method: { code: "STATIC_AI_USAGE", version: "1" },
        trustState: "INFERRED",
      },
      {
        kind: "RELATIONSHIP",
        detectedKey: "detected:relationship:agent-uses-mcp",
        relationshipType: "USES_MCP",
        sourceKey: "detected:agent:care",
        targetKey: "detected:mcp:customer",
        method: { code: "STATIC_AI_USAGE", version: "1" },
        trustState: "INFERRED",
      },
      {
        kind: "RELATIONSHIP",
        detectedKey: "detected:relationship:agent-invokes-api",
        relationshipType: "INVOKES",
        sourceKey: "detected:agent:care",
        targetKey: "detected:api:customer",
        method: { code: "STATIC_AI_USAGE", version: "1" },
        trustState: "INFERRED",
      },
      {
        kind: "RELATIONSHIP",
        detectedKey: "detected:relationship:agent-uses-knowledge-base",
        relationshipType: "USES_KNOWLEDGE_BASE",
        sourceKey: "detected:agent:care",
        targetKey: "detected:knowledge-base:handbook",
        method: { code: "STATIC_AI_USAGE", version: "1" },
        trustState: "INFERRED",
      },
    ],
    evidence: [
      ...base.evidence,
      {
        evidenceKey: "detected:evidence:model",
        subjectKey: "detected:model:care",
        sourceLocator: "src/model.ts",
        method: { code: "MODEL_DECLARATION", version: "1" },
      },
    ],
  };
}

describe("AI technical benchmark vocabulary", () => {
  it("validates all expected categories while preserving schema 1.0 compatibility", () => {
    const loaded = validateExpectedScenario(technicalExpectedScenario());
    for (const collection of [
      loaded.models!,
      loaded.tools!,
      loaded.mcpServers!,
      loaded.apis!,
      loaded.prompts!,
      loaded.knowledgeBases!,
    ]) {
      assert.equal(collection.length, 1);
      assert.equal(collection[0].requiredFromRound, 1);
    }

    const legacy = structuredClone(validExpectedScenario()) as unknown as Record<
      string,
      unknown
    >;
    for (const key of [
      "models",
      "tools",
      "mcpServers",
      "apis",
      "prompts",
      "knowledgeBases",
    ]) {
      delete legacy[key];
    }
    const compatible = validateExpectedScenario(legacy);
    assert.equal(compatible.schemaVersion, "1.0");
    assert.deepEqual(compatible.models, []);
    assert.deepEqual(compatible.knowledgeBases, []);
  });

  it("normalizes and exactly matches each technical category independently", () => {
    const expected = technicalExpectedScenario();
    const detected = normalizeDetectedScenario(technicalDetectedScenario());
    const matches = matchScenario(expected, detected);
    const report = buildValidationReport(expected, detected, matches);

    for (const category of TECHNICAL_CATEGORIES) {
      const categoryReport = report.categories.find(
        (candidate) => candidate.category === category,
      );
      assert.ok(categoryReport, category);
      assert.equal(categoryReport.truePositives, 1, category);
      assert.equal(categoryReport.falsePositives, 0, category);
      assert.equal(categoryReport.falseNegatives, 0, category);
      assert.equal(categoryReport.precision.value, 1, category);
      assert.equal(categoryReport.recall.value, 1, category);
    }
    assert.equal(matches.relationships.matched.length, 6);
  });

  it("counts a duplicate technical detection as an additional false positive", () => {
    const expected = technicalExpectedScenario();
    const detected = technicalDetectedScenario();
    const duplicate = {
      ...detected.models![0],
      detectedKey: "detected:model:duplicate",
      evidenceKeys: [],
    };
    const matches = matchScenario(
      expected,
      normalizeDetectedScenario({
        ...detected,
        models: [detected.models![0], duplicate],
      }),
    );

    assert.equal(matches.models.matched.length, 1);
    assert.equal(matches.models.falsePositives.length, 1);
    assert.equal(matches.models.falseNegatives.length, 0);
  });

  it("uses only an explicit alias and preserves entity-first relationships", () => {
    const expected = technicalExpectedScenario();
    const detected = technicalDetectedScenario();
    const alternateReference = "alternate-model";
    const alternateDetected = normalizeDetectedScenario({
      ...detected,
      models: [{
        ...detected.models![0],
        modelReference: alternateReference,
      }],
    });

    const withoutAlias = matchScenario(expected, alternateDetected);
    assert.equal(withoutAlias.models.matched.length, 0);
    assert.equal(
      withoutAlias.relationships.matched.some(
        (pair) => pair.expectedKey === "relationship:agent-uses-model",
      ),
      false,
    );

    const alias = modelComparisonKey(
      "vendor-a",
      alternateReference,
      "src/model.ts",
      "careModel",
    );
    const withAlias = matchScenario(
      {
        ...expected,
        models: [{ ...expected.models![0], comparisonAliases: [alias] }],
      },
      alternateDetected,
    );
    assert.equal(withAlias.models.matched.length, 1);
    assert.equal(
      withAlias.relationships.matched.some(
        (pair) => pair.expectedKey === "relationship:agent-uses-model",
      ),
      true,
    );
  });

  it("rejects an unknown technical relationship endpoint", () => {
    const expected = technicalExpectedScenario();
    assert.throws(
      () => validateExpectedScenario({
        ...expected,
        relationships: [{
          ...expected.relationships[0],
          targetKey: "model:missing",
        }],
      }),
      /unknown endpoint/,
    );
  });

  it("allows evidence to target a matched technical entity", () => {
    const expected = technicalExpectedScenario();
    const detected = normalizeDetectedScenario(technicalDetectedScenario());
    const report = buildValidationReport(
      expected,
      detected,
      matchScenario(expected, detected),
    );

    assert.equal(
      report.missingEvidence.some(
        (item) => item.requirementKey === "evidence:model-declaration",
      ),
      false,
    );
  });

  it("rejects unsafe technical locators", () => {
    const detected = technicalDetectedScenario();
    const cases: DetectedScenarioResult[] = [
      { ...detected, models: [{ ...detected.models![0], sourcePath: "../model.ts" }] },
      { ...detected, tools: [{ ...detected.tools![0], sourcePath: "C:\\repo\\tool.ts" }] },
      { ...detected, mcpServers: [{ ...detected.mcpServers![0], sourcePath: "/repo/mcp.json" }] },
      { ...detected, apis: [{ ...detected.apis![0], sourcePath: "foo/../../api.ts" }] },
      { ...detected, prompts: [{ ...detected.prompts![0], sourcePath: ".govia-lab/prompt.md" }] },
      { ...detected, knowledgeBases: [{ ...detected.knowledgeBases![0], sourcePath: "C:/repo/rag.yml" }] },
    ];

    for (const unsafe of cases) {
      assert.throws(
        () => normalizeDetectedScenario(unsafe),
        /repository-relative|path traversal|reserved .govia-lab namespace/,
      );
    }
  });

  it("rejects OBSERVED for technical entities in the design-time Lab", () => {
    const detected = technicalDetectedScenario();
    assert.throws(
      () => normalizeDetectedScenario({
        ...detected,
        models: [{ ...detected.models![0], trustState: "OBSERVED" }],
      }),
      /cannot use the OBSERVED trust state/,
    );
  });
});
