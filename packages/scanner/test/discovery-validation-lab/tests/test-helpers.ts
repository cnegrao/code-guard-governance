import type { DetectedScenarioResult } from "../contracts/detected.ts";
import type { ExpectedScenario } from "../contracts/expected.ts";

export function validExpectedScenario(): ExpectedScenario {
  return {
    schemaVersion: "1.0",
    scenarioId: "unit-scenario",
    description: "Synthetic contract-only scenario",
    targetRound: 1,
    discoveryLayers: ["L0", "L3", "L4", "L9"],
    agents: [{
      key: "agent:care",
      requiredFromRound: 1,
      sourcePath: "src/agent.ts",
      declarationKey: "careAgent",
      displayName: "Care Agent",
      discoveryLayers: ["L4"],
    }],
    dataAssets: [{
      key: "asset:customers",
      requiredFromRound: 1,
      sourceIdentity: "database.public.customers",
      sourcePath: "db/schema.sql",
      displayName: "customers",
      discoveryLayers: ["L3"],
    }],
    dataElements: [{
      key: "element:customers.email",
      requiredFromRound: 1,
      parentDataAssetKey: "asset:customers",
      elementPath: "email",
      sourcePath: "db/schema.sql",
      displayName: "email",
      discoveryLayers: ["L3"],
    }],
    relationships: [{
      key: "relationship:agent-reads-customers",
      requiredFromRound: 1,
      relationshipType: "READS_FROM",
      sourceKey: "agent:care",
      targetKey: "asset:customers",
      discoveryLayers: ["L9"],
    }],
    evidenceRequirements: [{
      key: "evidence:agent-declaration",
      requiredFromRound: 1,
      subjectKey: "agent:care",
      sourceLocator: "src/agent.ts",
      methodCode: "AST_AGENT_DECLARATION",
      discoveryLayers: ["L4"],
    }],
    prohibited: [],
    semanticConcepts: [{
      code: "CONTACT_EMAIL",
      requiredFromRound: 3,
      description: "Semantic relation only, not physical identity",
      memberDataElementKeys: ["element:customers.email"],
    }],
  };
}

export function validDetectedScenario(): DetectedScenarioResult {
  return {
    scenarioId: "unit-scenario",
    runId: "volatile-run-id",
    scannedAt: "2026-08-30T12:00:00.000Z",
    agents: [{
      kind: "AGENT",
      detectedKey: "detected:agent:care",
      sourcePath: "src/agent.ts",
      declarationKey: "careAgent",
      displayName: "Care Agent",
      method: { code: "AST_AGENT_DECLARATION", version: "1" },
      confidence: { value: 85, scale: "PERCENT" },
      trustState: "INFERRED",
      evidenceKeys: ["detected:evidence:agent"],
    }],
    dataAssets: [{
      kind: "DATA_ASSET",
      detectedKey: "detected:asset:customers",
      sourceIdentity: "database.public.customers",
      sourcePath: "db/schema.sql",
      method: { code: "SQL_DDL", version: "1" },
      trustState: "DECLARED",
    }],
    dataElements: [{
      kind: "DATA_ELEMENT",
      detectedKey: "detected:element:customers.email",
      parentDataAssetKey: "detected:asset:customers",
      elementPath: "email",
      sourcePath: "db/schema.sql",
      method: { code: "SQL_DDL", version: "1" },
      trustState: "DECLARED",
    }],
    relationships: [{
      kind: "RELATIONSHIP",
      detectedKey: "detected:relationship:agent-reads-customers",
      relationshipType: "READS_FROM",
      sourceKey: "detected:agent:care",
      targetKey: "detected:asset:customers",
      method: { code: "STATIC_DATA_ACCESS", version: "1" },
      trustState: "INFERRED",
    }],
    evidence: [{
      evidenceKey: "detected:evidence:agent",
      subjectKey: "detected:agent:care",
      sourceLocator: "src/agent.ts",
      method: { code: "AST_AGENT_DECLARATION", version: "1" },
      lineStart: 4,
      lineEnd: 8,
    }],
  };
}
