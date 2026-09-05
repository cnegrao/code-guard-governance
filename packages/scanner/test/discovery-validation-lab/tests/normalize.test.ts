import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agentComparisonKey,
  normalizeDetectedScenario,
  normalizeDiscoverablePath,
  normalizeSourcePath,
} from "../harness/normalize.ts";
import { validDetectedScenario } from "./test-helpers.ts";

describe("Detected result normalization", () => {
  it("normalizes paths, confidence, ordering, and removes volatile fields", () => {
    const detected = validDetectedScenario();
    const normalized = normalizeDetectedScenario({
      ...detected,
      runId: "different-run",
      scannedAt: "2099-01-01T00:00:00.000Z",
      agents: [{ ...detected.agents[0], sourcePath: ".\\src\\agent.ts" }],
      dataAssets: [{
        ...detected.dataAssets[0],
        sourcePath: ".\\db\\schema.sql",
      }],
      dataElements: [{
        ...detected.dataElements[0],
        sourcePath: "foo/./bar.ts",
      }],
      evidence: [{
        ...detected.evidence[0],
        sourceLocator: "src\\.\\agent.ts",
      }],
    });

    assert.equal(normalized.agents[0].sourcePath, "src/agent.ts");
    assert.equal(normalized.dataAssets[0].sourcePath, "db/schema.sql");
    assert.equal(normalized.dataElements[0].sourcePath, "foo/bar.ts");
    assert.equal(normalized.agents[0].confidence, 0.85);
    assert.equal(normalized.evidence[0].sourceLocator, "src/agent.ts");
    assert.equal(Object.hasOwn(normalized, "runId"), false);
    assert.equal(Object.hasOwn(normalized, "scannedAt"), false);
  });

  it("keeps duplicate discoveries observable", () => {
    const detected = validDetectedScenario();
    const duplicate = {
      ...detected.agents[0],
      detectedKey: "detected:agent:duplicate",
    };
    const normalized = normalizeDetectedScenario({
      ...detected,
      agents: [duplicate, detected.agents[0]],
    });

    assert.equal(normalized.agents.length, 2);
    assert.equal(
      normalized.agents[0].comparisonKey,
      normalized.agents[1].comparisonKey,
    );
  });

  it("does not use display name as identity or fuzzy-match paths", () => {
    assert.equal(
      agentComparisonKey("src/agent.ts", "careAgent"),
      agentComparisonKey("src\\agent.ts", "careAgent"),
    );
    assert.notEqual(
      agentComparisonKey("src/agent.ts", "careAgent"),
      agentComparisonKey("src/agent.ts", "CareAgent"),
    );
    assert.equal(normalizeSourcePath("./src\\agent.ts"), "src/agent.ts");
  });

  it("rejects OBSERVED and reserved-oracle paths in design-time results", () => {
    const detected = validDetectedScenario();
    assert.throws(
      () => normalizeDetectedScenario({
        ...detected,
        agents: [{ ...detected.agents[0], trustState: "OBSERVED" }],
      }),
      /cannot use the OBSERVED trust state/,
    );
    assert.throws(
      () => normalizeDetectedScenario({
        ...detected,
        agents: [{
          ...detected.agents[0],
          sourcePath: ".govia-lab/leak.ts",
        }],
      }),
      /reserved .govia-lab namespace/,
    );
  });

  it("rejects absolute and traversing repository locators on every platform", () => {
    const detected = validDetectedScenario();
    for (const sourcePath of [
      "../outside/agent.ts",
      "foo/../../outside.ts",
      "C:\\repository\\src\\agent.ts",
      "C:/repository/src/agent.ts",
      "/repository/src/agent.ts",
      "foo/.govia-lab/expected.json",
    ]) {
      assert.throws(
        () => normalizeDetectedScenario({
          ...detected,
          agents: [{ ...detected.agents[0], sourcePath }],
        }),
        /repository-relative|path traversal|reserved .govia-lab namespace/,
        sourcePath,
      );
    }

    assert.throws(
      () => normalizeDetectedScenario({
        ...detected,
        dataAssets: [{
          ...detected.dataAssets[0],
          sourcePath: "C:\\repository\\schema.sql",
        }],
      }),
      /repository-relative/,
    );
    assert.throws(
      () => normalizeDetectedScenario({
        ...detected,
        dataElements: [{
          ...detected.dataElements[0],
          sourcePath: "../schema.sql",
        }],
      }),
      /path traversal/,
    );
    assert.throws(
      () => normalizeDetectedScenario({
        ...detected,
        evidence: [{
          ...detected.evidence[0],
          sourceLocator: "/repository/src/agent.ts",
        }],
      }),
      /repository-relative/,
    );
  });

  it("normalizes repository-relative locators without treating elementPath as a file", () => {
    assert.equal(normalizeDiscoverablePath("", "Locator"), "/");
    assert.equal(
      normalizeDiscoverablePath(".govia-lab-other/file.ts", "Locator"),
      ".govia-lab-other/file.ts",
    );
    assert.equal(
      normalizeDiscoverablePath("foo/my.govia-lab/file.ts", "Locator"),
      "foo/my.govia-lab/file.ts",
    );

    const detected = validDetectedScenario();
    const normalized = normalizeDetectedScenario({
      ...detected,
      dataElements: [{
        ...detected.dataElements[0],
        elementPath: "schema/../email",
      }],
    });
    assert.equal(normalized.dataElements[0].elementPath, "schema/../email");
  });
});
