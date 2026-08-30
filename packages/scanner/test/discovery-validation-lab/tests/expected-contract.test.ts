import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { DISCOVERY_RELATIONSHIP_TYPE } from "../contracts/detected.ts";
import {
  loadExpectedScenario,
  validateExpectedScenario,
} from "../harness/oracle-loader.ts";
import { validExpectedScenario } from "./test-helpers.ts";

describe("Expected scenario contract", () => {
  it("loads and validates the reserved expected.json oracle", async () => {
    const root = await mkdtemp(join(tmpdir(), "govia-oracle-"));
    try {
      const oracleDirectory = join(root, ".govia-lab");
      await mkdir(oracleDirectory);
      await writeFile(
        join(oracleDirectory, "expected.json"),
        JSON.stringify(validExpectedScenario()),
        "utf8",
      );

      const loaded = await loadExpectedScenario(root);
      assert.equal(loaded.scenarioId, "unit-scenario");
      assert.equal(loaded.semanticConcepts[0].code, "CONTACT_EMAIL");
      assert.equal(loaded.agents[0].requiredFromRound, 1);
      assert.equal(loaded.evidenceRequirements[0].requiredFromRound, 1);
      assert.equal(loaded.semanticConcepts[0].requiredFromRound, 3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed JSON and unsupported schema versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "govia-oracle-invalid-"));
    try {
      const oracleDirectory = join(root, ".govia-lab");
      await mkdir(oracleDirectory);
      const oraclePath = join(oracleDirectory, "expected.json");
      await writeFile(oraclePath, "{not-json", "utf8");
      await assert.rejects(
        loadExpectedScenario(root),
        /not valid JSON/,
      );

      await writeFile(
        oraclePath,
        JSON.stringify({ ...validExpectedScenario(), schemaVersion: "2.0" }),
        "utf8",
      );
      await assert.rejects(
        loadExpectedScenario(root),
        /Unsupported expected scenario schemaVersion/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects tenant authority and other fields outside the allowlist", () => {
    assert.throws(
      () => validateExpectedScenario({
        ...validExpectedScenario(),
        organisationId: "not-authoritative",
      }),
      /unsupported field: organisationId/,
    );
  });

  it("normalizes and validates repository-relative oracle locators", () => {
    const expected = validExpectedScenario();
    const loaded = validateExpectedScenario({
      ...expected,
      agents: [{ ...expected.agents[0], sourcePath: ".\\src\\agent.ts" }],
      dataAssets: [{
        ...expected.dataAssets[0],
        sourcePath: "./db/schema.sql",
      }],
      dataElements: [{
        ...expected.dataElements[0],
        sourcePath: "db/./schema.sql",
      }],
      evidenceRequirements: [{
        ...expected.evidenceRequirements[0],
        sourceLocator: "src\\agent.ts",
      }],
    });

    assert.equal(loaded.agents[0].sourcePath, "src/agent.ts");
    assert.equal(loaded.dataAssets[0].sourcePath, "db/schema.sql");
    assert.equal(loaded.dataElements[0].sourcePath, "db/schema.sql");
    assert.equal(loaded.evidenceRequirements[0].sourceLocator, "src/agent.ts");

    assert.throws(
      () => validateExpectedScenario({
        ...expected,
        agents: [{
          ...expected.agents[0],
          sourcePath: "../outside/agent.ts",
        }],
      }),
      /path traversal/,
    );
    assert.throws(
      () => validateExpectedScenario({
        ...expected,
        evidenceRequirements: [{
          ...expected.evidenceRequirements[0],
          sourceLocator: "C:\\repository\\src\\agent.ts",
        }],
      }),
      /repository-relative/,
    );
  });

  it("rejects invalid parent and semantic references", () => {
    const expected = validExpectedScenario();
    assert.throws(
      () => validateExpectedScenario({
        ...expected,
        dataElements: [{
          ...expected.dataElements[0],
          parentDataAssetKey: "asset:missing",
        }],
      }),
      /references unknown DataAsset/,
    );
    assert.throws(
      () => validateExpectedScenario({
        ...expected,
        semanticConcepts: [{
          ...expected.semanticConcepts[0],
          code: "CONTACT_EMAIL",
          memberDataElementKeys: ["element:missing"],
        }],
      }),
      /references unknown DataElement/,
    );
  });

  it("preserves cumulative round requirements and validates their range", () => {
    const expected = validExpectedScenario();
    const loaded = validateExpectedScenario(expected);

    assert.equal(loaded.targetRound, 1);
    assert.equal(loaded.semanticConcepts[0].requiredFromRound, 3);

    assert.throws(
      () => validateExpectedScenario({
        ...expected,
        agents: [{
          ...expected.agents[0],
          requiredFromRound: 0,
        }],
      }),
      /agents\[0\]\.requiredFromRound must be an integer from 1 through 5/,
    );

    assert.throws(
      () => validateExpectedScenario({
        ...expected,
        evidenceRequirements: [{
          ...expected.evidenceRequirements[0],
          requiredFromRound: 6,
        }],
      }),
      /evidenceRequirements\[0\]\.requiredFromRound must be an integer from 1 through 5/,
    );
  });

  it("limits benchmark relationships to domain and architecture semantics", () => {
    assert.deepEqual(Object.values(DISCOVERY_RELATIONSHIP_TYPE), [
      "USES_MODEL",
      "INVOKES",
      "READS_FROM",
      "WRITES_TO",
      "CONTAINS",
      "DERIVED_FROM",
      "HANDOFF_TO",
    ]);

    const expected = validExpectedScenario();
    assert.throws(
      () => validateExpectedScenario({
        ...expected,
        relationships: [{
          ...expected.relationships[0],
          relationshipType: "EVIDENCED_BY",
        }],
      }),
      /Unsupported relationship type/,
    );
  });
});
