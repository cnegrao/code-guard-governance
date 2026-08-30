import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchScenario } from "../harness/match.ts";
import {
  agentComparisonKey,
  dataAssetComparisonKey,
  dataElementComparisonKey,
  normalizeDetectedScenario,
} from "../harness/normalize.ts";
import {
  validDetectedScenario,
  validExpectedScenario,
} from "./test-helpers.ts";

describe("Exact deterministic matching", () => {
  it("matches Agents, DataAssets, DataElements, and directional relationships", () => {
    const matches = matchScenario(
      validExpectedScenario(),
      normalizeDetectedScenario(validDetectedScenario()),
    );

    for (const category of [
      matches.agents,
      matches.dataAssets,
      matches.dataElements,
      matches.relationships,
    ]) {
      assert.equal(category.matched.length, 1);
      assert.equal(category.falsePositives.length, 0);
      assert.equal(category.falseNegatives.length, 0);
    }
  });

  it("does not fuzzy-match declaration keys", () => {
    const detected = validDetectedScenario();
    const matches = matchScenario(
      validExpectedScenario(),
      normalizeDetectedScenario({
        ...detected,
        agents: [{ ...detected.agents[0], declarationKey: "Care_Agent" }],
      }),
    );

    assert.equal(matches.agents.matched.length, 0);
    assert.equal(matches.agents.falsePositives.length, 1);
    assert.equal(matches.agents.falseNegatives.length, 1);
  });

  it("matches a relationship after its Agent endpoint matches by explicit alias", () => {
    const expected = validExpectedScenario();
    const detected = validDetectedScenario();
    const alias = agentComparisonKey("src/agent.ts", "alternateAgent");
    const matches = matchScenario(
      {
        ...expected,
        agents: [{ ...expected.agents[0], comparisonAliases: [alias] }],
      },
      normalizeDetectedScenario({
        ...detected,
        agents: [{
          ...detected.agents[0],
          declarationKey: "alternateAgent",
        }],
      }),
    );

    assert.equal(matches.agents.matched.length, 1);
    assert.equal(matches.relationships.matched.length, 1);
    assert.equal(matches.relationships.falsePositives.length, 0);
    assert.equal(matches.relationships.falseNegatives.length, 0);
  });

  it("matches a relationship after DataAsset and DataElement endpoints match by aliases", () => {
    const expected = validExpectedScenario();
    const detected = validDetectedScenario();
    const assetAlias = dataAssetComparisonKey("warehouse.public.customers");
    const elementAlias = dataElementComparisonKey(assetAlias, "contact_email");
    const matches = matchScenario(
      {
        ...expected,
        dataAssets: [{
          ...expected.dataAssets[0],
          comparisonAliases: [assetAlias],
        }],
        dataElements: [{
          ...expected.dataElements[0],
          comparisonAliases: [elementAlias],
        }],
        relationships: [{
          ...expected.relationships[0],
          targetKey: expected.dataElements[0].key,
        }],
      },
      normalizeDetectedScenario({
        ...detected,
        dataAssets: [{
          ...detected.dataAssets[0],
          sourceIdentity: "warehouse.public.customers",
        }],
        dataElements: [{
          ...detected.dataElements[0],
          elementPath: "contact_email",
        }],
        relationships: [{
          ...detected.relationships[0],
          targetKey: detected.dataElements[0].detectedKey,
        }],
      }),
    );

    assert.equal(matches.dataAssets.matched.length, 1);
    assert.equal(matches.dataElements.matched.length, 1);
    assert.equal(matches.relationships.matched.length, 1);
    assert.equal(matches.relationships.falsePositives.length, 0);
    assert.equal(matches.relationships.falseNegatives.length, 0);
  });

  it("counts duplicate detections as false positives", () => {
    const detected = validDetectedScenario();
    const matches = matchScenario(
      validExpectedScenario(),
      normalizeDetectedScenario({
        ...detected,
        agents: [
          detected.agents[0],
          { ...detected.agents[0], detectedKey: "detected:agent:duplicate" },
        ],
      }),
    );

    assert.equal(matches.agents.matched.length, 1);
    assert.equal(matches.agents.falsePositives.length, 1);
  });

  it("treats relationship direction as part of identity", () => {
    const detected = validDetectedScenario();
    const relationship = detected.relationships[0];
    const matches = matchScenario(
      validExpectedScenario(),
      normalizeDetectedScenario({
        ...detected,
        relationships: [{
          ...relationship,
          sourceKey: relationship.targetKey,
          targetKey: relationship.sourceKey,
        }],
      }),
    );

    assert.equal(matches.relationships.matched.length, 0);
    assert.equal(matches.relationships.falsePositives.length, 1);
    assert.equal(matches.relationships.falseNegatives.length, 1);
  });

  it("does not match a relationship with an unmatched entity endpoint", () => {
    const detected = validDetectedScenario();
    const matches = matchScenario(
      validExpectedScenario(),
      normalizeDetectedScenario({
        ...detected,
        dataAssets: [{
          ...detected.dataAssets[0],
          sourceIdentity: "database.public.unmatched",
        }],
      }),
    );

    assert.equal(matches.dataAssets.matched.length, 0);
    assert.equal(matches.relationships.matched.length, 0);
    assert.equal(matches.relationships.falsePositives.length, 1);
    assert.equal(matches.relationships.falseNegatives.length, 1);
  });

  it("counts duplicate relationships as one match and one false positive", () => {
    const detected = validDetectedScenario();
    const matches = matchScenario(
      validExpectedScenario(),
      normalizeDetectedScenario({
        ...detected,
        relationships: [
          detected.relationships[0],
          {
            ...detected.relationships[0],
            detectedKey: "detected:relationship:duplicate",
          },
        ],
      }),
    );

    assert.equal(matches.relationships.matched.length, 1);
    assert.equal(matches.relationships.falsePositives.length, 1);
    assert.equal(matches.relationships.falseNegatives.length, 0);
  });

  it("reports explicitly prohibited exact findings", () => {
    const expected = validExpectedScenario();
    const prohibitedKey = agentComparisonKey("src/agent.ts", "careAgent");
    const matches = matchScenario(
      {
        ...expected,
        prohibited: [{
          key: "prohibited:care-agent",
          requiredFromRound: 1,
          category: "AGENT",
          comparisonKey: prohibitedKey,
          description: "Synthetic prohibited finding",
          discoveryLayers: ["L4"],
        }],
      },
      normalizeDetectedScenario(validDetectedScenario()),
    );

    assert.equal(matches.prohibitedFindings.length, 1);
    assert.equal(
      matches.prohibitedFindings[0].prohibitionKey,
      "prohibited:care-agent",
    );
  });
});
