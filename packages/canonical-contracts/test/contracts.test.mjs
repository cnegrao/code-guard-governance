import assert from "node:assert/strict";
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

  it("exposes only AGENT and AGENT_VERSION canonical kinds in V1A", () => {
    assert.deepEqual(Object.values(contracts.CANONICAL_OBJECT_KIND).sort(), [
      "AGENT",
      "AGENT_VERSION",
    ]);
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
