import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import type { ExpectedScenario } from "../contracts/expected.ts";
import { loadExpectedScenario } from "../harness/oracle-loader.ts";
import { createRepositorySnapshot } from "../harness/repository-snapshot.ts";

const GOLDEN_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "golden-repositories",
);

const SCENARIOS = [
  "01-simple-agent",
  "02-multi-agent",
  "03-monorepo",
  "04-mcp-not-agent",
  "05-false-positives",
  "06-care-coordination",
] as const;

type ScenarioName = (typeof SCENARIOS)[number];

interface ExpectedCounts {
  readonly agents: number;
  readonly dataAssets: number;
  readonly dataElements: number;
  readonly models: number;
  readonly tools: number;
  readonly mcpServers: number;
  readonly apis: number;
  readonly prompts: number;
  readonly knowledgeBases: number;
  readonly relationships: number;
}

const EXPECTED_COUNTS: Readonly<Record<ScenarioName, ExpectedCounts>> = {
  "01-simple-agent": {
    agents: 1,
    dataAssets: 1,
    dataElements: 4,
    models: 1,
    tools: 1,
    mcpServers: 0,
    apis: 0,
    prompts: 1,
    knowledgeBases: 0,
    relationships: 6,
  },
  "02-multi-agent": {
    agents: 3,
    dataAssets: 2,
    dataElements: 6,
    models: 3,
    tools: 3,
    mcpServers: 0,
    apis: 0,
    prompts: 3,
    knowledgeBases: 0,
    relationships: 14,
  },
  "03-monorepo": {
    agents: 2,
    dataAssets: 2,
    dataElements: 6,
    models: 2,
    tools: 0,
    mcpServers: 0,
    apis: 0,
    prompts: 0,
    knowledgeBases: 0,
    relationships: 11,
  },
  "04-mcp-not-agent": {
    agents: 0,
    dataAssets: 0,
    dataElements: 0,
    models: 0,
    tools: 2,
    mcpServers: 1,
    apis: 0,
    prompts: 0,
    knowledgeBases: 0,
    relationships: 2,
  },
  "05-false-positives": {
    agents: 0,
    dataAssets: 0,
    dataElements: 0,
    models: 0,
    tools: 0,
    mcpServers: 0,
    apis: 0,
    prompts: 0,
    knowledgeBases: 0,
    relationships: 0,
  },
  "06-care-coordination": {
    agents: 1,
    dataAssets: 1,
    dataElements: 4,
    models: 1,
    tools: 3,
    mcpServers: 0,
    apis: 1,
    prompts: 1,
    knowledgeBases: 1,
    relationships: 10,
  },
};

function scenarioPath(name: ScenarioName): string {
  return resolve(GOLDEN_ROOT, name);
}

async function loadScenario(name: ScenarioName): Promise<ExpectedScenario> {
  return loadExpectedScenario(scenarioPath(name));
}

function actualCounts(expected: ExpectedScenario): ExpectedCounts {
  return {
    agents: expected.agents.length,
    dataAssets: expected.dataAssets.length,
    dataElements: expected.dataElements.length,
    models: expected.models?.length ?? 0,
    tools: expected.tools?.length ?? 0,
    mcpServers: expected.mcpServers?.length ?? 0,
    apis: expected.apis?.length ?? 0,
    prompts: expected.prompts?.length ?? 0,
    knowledgeBases: expected.knowledgeBases?.length ?? 0,
    relationships: expected.relationships.length,
  };
}

describe("Golden Repository scenarios", () => {
  it("contains exactly the six approved scenario directories", async () => {
    const entries = await readdir(GOLDEN_ROOT, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    assert.deepEqual(directories, [...SCENARIOS]);
  });

  it("loads every schema 1.0 oracle with the exact category counts", async () => {
    for (const name of SCENARIOS) {
      const expected = await loadScenario(name);
      assert.equal(expected.schemaVersion, "1.0", name);
      assert.equal(expected.scenarioId, name, name);
      assert.deepEqual(actualCounts(expected), EXPECTED_COUNTS[name], name);
    }
  });

  it("creates isolated snapshots with only real repository-relative locators", async () => {
    for (const name of SCENARIOS) {
      const expected = await loadScenario(name);
      const snapshot = await createRepositorySnapshot(scenarioPath(name));
      const visiblePaths = new Set(snapshot.files.map((file) => file.path));

      assert.equal(
        snapshot.files.some((file) =>
          file.path
            .split("/")
            .some((segment) => segment.toLowerCase() === ".govia-lab"),
        ),
        false,
        name,
      );
      await assert.rejects(
        snapshot.readText(".govia-lab/expected.json"),
        /reserved .govia-lab namespace/,
      );

      const sourceBackedEntities = [
        ...expected.agents,
        ...expected.dataAssets,
        ...expected.dataElements,
        ...(expected.models ?? []),
        ...(expected.tools ?? []),
        ...(expected.mcpServers ?? []),
        ...(expected.apis ?? []),
        ...(expected.prompts ?? []),
        ...(expected.knowledgeBases ?? []),
      ];
      for (const entity of sourceBackedEntities) {
        if (!("sourcePath" in entity) || entity.sourcePath === undefined) {
          continue;
        }
        assert.equal(visiblePaths.has(entity.sourcePath), true, entity.key);
      }
      for (const requirement of expected.evidenceRequirements) {
        assert.equal(
          visiblePaths.has(requirement.sourceLocator),
          true,
          requirement.key,
        );
      }
    }
  });

  it("keeps the high-confidence Agent canary outside scanner-facing input", async () => {
    const snapshot = await createRepositorySnapshot(
      scenarioPath("01-simple-agent"),
    );
    const expected = await loadScenario("01-simple-agent");

    assert.equal(
      snapshot.files.some((file) => file.path.endsWith("leak-agent.py")),
      false,
    );
    await assert.rejects(
      snapshot.readText(".govia-lab/leak-agent.py"),
      /reserved .govia-lab namespace/,
    );
    assert.equal(
      expected.evidenceRequirements.some((requirement) =>
        requirement.sourceLocator.includes("leak-agent.py"),
      ),
      false,
    );
    assert.equal(expected.agents.length, 1);
  });

  it("preserves the required positive, negative, and lineage semantics", async () => {
    const mcpOnly = await loadScenario("04-mcp-not-agent");
    assert.equal(mcpOnly.agents.length, 0);
    assert.equal(mcpOnly.mcpServers?.length, 1);

    const negatives = await loadScenario("05-false-positives");
    assert.equal(negatives.agents.length, 0);
    assert.ok(
      negatives.prohibited.some((item) => item.category === "AGENT"),
    );

    const monorepo = await loadScenario("03-monorepo");
    assert.ok(
      monorepo.relationships.some(
        (relationship) =>
          relationship.relationshipType === "DERIVED_FROM" &&
          relationship.sourceKey === "element:crm-contact.mail" &&
          relationship.targetKey === "element:core-customer.email",
      ),
    );

    const care = await loadScenario("06-care-coordination");
    assert.equal(care.models?.length, 1);
    assert.ok((care.tools?.length ?? 0) > 1);
    assert.equal(care.apis?.length, 1);
    assert.equal(care.prompts?.length, 1);
    assert.equal(care.knowledgeBases?.length, 1);
  });

  it("keeps semantic concept membership within declared DataElements", async () => {
    for (const name of SCENARIOS) {
      const expected = await loadScenario(name);
      const elementKeys = new Set(
        expected.dataElements.map((element) => element.key),
      );
      for (const concept of expected.semanticConcepts) {
        for (const memberKey of concept.memberDataElementKeys) {
          assert.equal(elementKeys.has(memberKey), true, `${name}:${memberKey}`);
        }
      }
    }
  });
});
