import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import * as contracts from "../src/index.ts";
import {
  databricksLikeObjectFixture,
  dbtArtifactObjectFixture,
  githubRepositoryDiscoveryFixture,
  informaticaLikeCatalogFixture,
  v1aInboundAdapterFixtures,
} from "../src/fixtures.ts";

describe("Canonical Contract V1A", () => {
  it("preserves provider-specific identifiers as opaque external strings", () => {
    assert.equal(
      githubRepositoryDiscoveryFixture.objects[0].identity.externalId,
      "R_kgDOOpaque-Provider-Id",
    );
    assert.equal(
      informaticaLikeCatalogFixture.objects[0].identity.externalId,
      "idmc/object/opaque:4711",
    );
    assert.equal(
      databricksLikeObjectFixture.objects[0].identity.externalId,
      "main.finance.customer_transactions",
    );
    assert.equal(
      dbtArtifactObjectFixture.objects[0].identity.externalId,
      "model.analytics.customer_orders",
    );
  });

  it("does not accept tenant authority in inbound adapter envelopes", () => {
    for (const envelope of v1aInboundAdapterFixtures) {
      assert.equal(Object.hasOwn(envelope, "tenantId"), false);
      assert.equal(Object.hasOwn(envelope, "organisationId"), false);
      assert.equal(Object.hasOwn(envelope, "organisation_id"), false);
    }
  });

  it("builds a stable source-object identity from connection, type, and external id", () => {
    const identity = {
      connectionId: contracts.asSourceConnectionId("connection:with:delimiters"),
      externalType: "provider/object:type",
      externalId: contracts.asExternalId("opaque:id/with:any-format"),
    };

    const first = contracts.sourceObjectIdentityKey(identity);
    const second = contracts.sourceObjectIdentityKey({ ...identity });

    assert.equal(first, second);
    assert.deepEqual(JSON.parse(first), [
      "connection:with:delimiters",
      "provider/object:type",
      "opaque:id/with:any-format",
    ]);
  });

  it("keeps discovery findings and normalized objects as reconciliation candidates", () => {
    const finding = githubRepositoryDiscoveryFixture.findings[0];
    const candidate = githubRepositoryDiscoveryFixture.candidates[0];

    assert.equal(finding.findingNature, "CANDIDATE");
    assert.equal(finding.requiresReview, true);
    assert.equal(finding.createsCanonicalObject, false);
    assert.equal(candidate.requiresReconciliation, true);
    assert.equal(Object.hasOwn(candidate, "canonicalObject"), false);
  });

  it("keeps SourceAssertion as a provenance envelope without generic fact values", () => {
    const forbiddenFields = [
      "predicate",
      "factName",
      "fact_name",
      "value",
      "valueJson",
      "value_json",
    ];

    for (const fixture of v1aInboundAdapterFixtures) {
      for (const assertion of fixture.assertions) {
        for (const field of forbiddenFields) {
          assert.equal(Object.hasOwn(assertion, field), false);
        }
      }
    }
  });

  it("exposes exactly the ten approved canonical object kinds in V1A.1", () => {
    assert.deepEqual(Object.values(contracts.CANONICAL_OBJECT_KIND).sort(), [
      "AGENT",
      "AGENT_VERSION",
      "API",
      "DATA_ASSET",
      "DATA_ELEMENT",
      "KNOWLEDGE_BASE",
      "MCP_SERVER",
      "MODEL",
      "PROMPT",
      "TOOL",
    ]);
    assert.equal(contracts.CANONICAL_OBJECT_KIND.AGENT, "AGENT");
    assert.equal(contracts.CANONICAL_OBJECT_KIND.AGENT_VERSION, "AGENT_VERSION");
  });

  it("constructs the eight new identities without source or business metadata", () => {
    const organisationId = contracts.asOrganisationId("organisation:test");
    const canonicalObject = (kind, suffix) => ({
      organisationId,
      objectId: contracts.asCanonicalObjectId(`canonical:${suffix}`),
      kind,
    });
    const dataAssetId = contracts.asDataAssetId("data-asset:test");
    const identities = [
      {
        canonicalObject: canonicalObject("MODEL", "model"),
        modelId: contracts.asModelId("model:test"),
      },
      {
        canonicalObject: canonicalObject("TOOL", "tool"),
        toolId: contracts.asToolId("tool:test"),
      },
      {
        canonicalObject: canonicalObject("MCP_SERVER", "mcp-server"),
        mcpServerId: contracts.asMcpServerId("mcp-server:test"),
      },
      {
        canonicalObject: canonicalObject("API", "api"),
        apiId: contracts.asApiId("api:test"),
      },
      {
        canonicalObject: canonicalObject("PROMPT", "prompt"),
        promptId: contracts.asPromptId("prompt:test"),
      },
      {
        canonicalObject: canonicalObject("KNOWLEDGE_BASE", "knowledge-base"),
        knowledgeBaseId: contracts.asKnowledgeBaseId("knowledge-base:test"),
      },
      {
        canonicalObject: canonicalObject("DATA_ASSET", "data-asset"),
        dataAssetId,
      },
      {
        canonicalObject: canonicalObject("DATA_ELEMENT", "data-element"),
        dataElementId: contracts.asDataElementId("data-element:test"),
        dataAssetId,
        elementPath: "contact_email",
      },
    ];

    assert.equal(identities.length, 8);
    const forbiddenFields = [
      "provider",
      "path",
      "url",
      "businessName",
      "businessMetadata",
      "owner",
      "privacy",
      "risk",
    ];
    for (const identity of identities) {
      for (const field of forbiddenFields) {
        assert.equal(Object.hasOwn(identity, field), false, field);
      }
    }

    const promptIdentity = identities[4];
    assert.equal(Object.hasOwn(promptIdentity, "content"), false);
    const dataAssetIdentity = identities[6];
    const dataElementIdentity = identities[7];
    assert.equal(dataElementIdentity.dataAssetId, dataAssetIdentity.dataAssetId);
    assert.equal(Object.hasOwn(dataElementIdentity, "dataAsset"), false);
  });

  it("uses contract version 1.1 while continuing to support 1.0", () => {
    assert.equal(contracts.CANONICAL_CONTRACT_VERSION, "1.1");
    assert.deepEqual(contracts.SUPPORTED_CANONICAL_CONTRACT_VERSIONS, [
      "1.0",
      "1.1",
    ]);

    const legacyEnvelope = {
      ...githubRepositoryDiscoveryFixture,
      contractVersion: "1.0",
    };
    assert.equal(
      contracts.SUPPORTED_CANONICAL_CONTRACT_VERSIONS.includes(
        legacyEnvelope.contractVersion,
      ),
      true,
    );
  });

  it("includes RUNTIME without removing any existing source family", () => {
    assert.deepEqual(Object.values(contracts.SOURCE_FAMILY).sort(), [
      "BUILD_METADATA",
      "CATALOG",
      "CLOUD",
      "IDENTITY",
      "OTHER",
      "REPOSITORY",
      "RUNTIME",
    ]);
  });

  it("keeps fixtures outside public exports and has no runtime dependencies", async () => {
    for (const fixtureExport of [
      "githubRepositoryDiscoveryFixture",
      "informaticaLikeCatalogFixture",
      "databricksLikeObjectFixture",
      "dbtArtifactObjectFixture",
      "v1aInboundAdapterFixtures",
    ]) {
      assert.equal(Object.hasOwn(contracts, fixtureExport), false);
    }

    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    assert.deepEqual(packageJson.exports, { ".": "./src/index.ts" });
    assert.deepEqual(packageJson.dependencies ?? {}, {});
  });

  it("does not expose non-object governance concepts as canonical kinds", () => {
    const objectKinds = new Set(Object.values(contracts.CANONICAL_OBJECT_KIND));
    for (const excluded of [
      "RELATIONSHIP",
      "RISK",
      "CONTROL",
      "OWNER",
      "DOMAIN",
      "CLASSIFICATION",
      "EVIDENCE",
      "FINDING",
      "EXECUTION_IDENTITY",
    ]) {
      assert.equal(objectKinds.has(excluded), false, excluded);
    }
  });

  it("sanitizes evidence location metadata and drops non-contract fields", () => {
    const locator = contracts.sanitizeEvidenceLocator(
      "https://user:secret@example.invalid/file.ts?token=secret#fragment",
    );
    assert.equal(locator, "https://example.invalid/file.ts");

    const unsafeDraft = {
      evidenceId: contracts.asEvidenceId("evidence:allowlist-test"),
      handling: contracts.EVIDENCE_HANDLING.REDACTED,
      locations: [
        {
          kind: contracts.EVIDENCE_LOCATION_KIND.URI,
          locator,
        },
      ],
      hashes: [{ algorithm: "SHA-256", value: "safe-hash" }],
      redactedExcerpt: "token=[REDACTED]",
      capturedAt: contracts.asIsoTimestamp("2026-08-28T12:00:00.000Z"),
      rawSensitiveValue: "must-be-dropped",
      secret: "must-be-dropped",
    };

    const evidence = contracts.createEvidence(unsafeDraft);
    assert.equal(Object.hasOwn(evidence, "rawSensitiveValue"), false);
    assert.equal(Object.hasOwn(evidence, "secret"), false);
    assert.equal(evidence.redactedExcerpt, "token=[REDACTED]");
  });

  it("represents an unknown provider explicitly without defaulting to GitHub", () => {
    assert.deepEqual(contracts.providerReference(undefined), {
      providerCode: null,
      resolution: "UNKNOWN",
    });
    assert.notEqual(contracts.providerReference(undefined).providerCode, "github");
  });

  it("keeps provider-specific vocabulary in fixture data, not core contract exports", () => {
    const coreExportNames = Object.keys(contracts).join(" ").toLowerCase();
    for (const vendor of [
      "github",
      "informatica",
      "databricks",
      "dbt",
      "microsoft",
      "aws",
      "duckdb",
    ]) {
      assert.equal(coreExportNames.includes(vendor), false);
    }

    for (const fixture of v1aInboundAdapterFixtures) {
      assert.equal(fixture.contractVersion, contracts.CANONICAL_CONTRACT_VERSION);
      assert.ok(fixture.sourceSystem.provider.providerCode);
      assert.ok(fixture.objects.every((object) => object.identity.externalType.length > 0));
    }
  });
});
