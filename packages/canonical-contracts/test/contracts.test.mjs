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

const reconciliationTimestamp = contracts.asIsoTimestamp(
  "2026-08-30T12:00:00.000Z",
);

function sourceObjectIdentity(connection, externalId) {
  return {
    connectionId: contracts.asSourceConnectionId(connection),
    externalType: "test-object",
    externalId: contracts.asExternalId(externalId),
  };
}

function objectCandidate(kind, id, sourceObject) {
  return {
    candidateId: contracts.asNormalizedCandidateId(id),
    candidateKind: kind,
    sourceObject,
    findingId: contracts.asDiscoveryFindingId(`finding:${id}`),
    proposedIdentity: {},
    assertionIds: [contracts.asSourceAssertionId(`assertion:${id}`)],
    evidenceIds: [contracts.asEvidenceId(`evidence:${id}`)],
    confidence: 0.99,
    requiresReconciliation: true,
  };
}

function trustedContributor(organisationId, candidate) {
  return {
    contributorKind: "CANDIDATE",
    organisationId,
    candidate,
  };
}

function mergeDraft({ id, organisationId, kind, contributors, decisionId }) {
  return {
    candidateMergeId: contracts.asCandidateMergeId(id),
    organisationId,
    candidateKind: kind,
    contributors,
    createdByDecisionId: contracts.asReconciliationDecisionId(decisionId),
    createdAt: reconciliationTimestamp,
  };
}

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

  it("supports findings and single-source candidates for all ten object kinds", () => {
    const sourceObject = sourceObjectIdentity(
      "connection:all-kinds",
      "external:all-kinds",
    );
    const objectKinds = Object.values(contracts.CANONICAL_OBJECT_KIND);
    const findings = objectKinds.map((candidateKind) => ({
      findingId: contracts.asDiscoveryFindingId(`finding:${candidateKind}`),
      findingNature: "CANDIDATE",
      candidateKind,
      sourceObject,
      assertionIds: [],
      evidenceIds: [],
      confidence: 0.9,
      reviewStatus: contracts.FINDING_REVIEW_STATUS.UNREVIEWED,
      requiresReview: true,
      createsCanonicalObject: false,
      detectedAt: reconciliationTimestamp,
    }));
    const candidates = objectKinds.map((kind) =>
      objectCandidate(kind, `candidate:${kind}`, sourceObject),
    );

    assert.equal(findings.length, 10);
    assert.equal(candidates.length, 10);
    assert.deepEqual(
      findings.map((finding) => finding.candidateKind).sort(),
      [...objectKinds].sort(),
    );
    for (const item of [...findings, ...candidates]) {
      assert.equal(Object.hasOwn(item, "canonicalObject"), false);
      assert.equal(Object.hasOwn(item, "organisationId"), false);
    }
    assert.equal(Object.hasOwn(candidates[0], "trustState"), false);

    const legacyAgent = githubRepositoryDiscoveryFixture.candidates[0];
    assert.equal(legacyAgent.candidateKind, "AGENT");
    assert.equal(legacyAgent.requiresReconciliation, true);
  });

  it("uses pre-canonical parents and preserves relationship direction", () => {
    const sourceObject = sourceObjectIdentity(
      "connection:references",
      "external:references",
    );
    const assetCandidate = objectCandidate(
      "DATA_ASSET",
      "candidate:asset",
      sourceObject,
    );
    const parentByCandidate = {
      referenceKind: "CANDIDATE",
      candidateId: assetCandidate.candidateId,
      candidateKind: "DATA_ASSET",
    };
    const parentBySource = {
      referenceKind: "SOURCE_OBJECT",
      sourceObject,
      candidateKind: "DATA_ASSET",
    };
    const elementByCandidate = {
      ...objectCandidate("DATA_ELEMENT", "candidate:element:one", sourceObject),
      proposedIdentity: {
        parentDataAsset: parentByCandidate,
        elementPath: "contact_email",
      },
    };
    const elementBySource = {
      ...objectCandidate("DATA_ELEMENT", "candidate:element:two", sourceObject),
      proposedIdentity: {
        parentDataAsset: parentBySource,
        elementPath: "contact_email",
      },
    };

    assert.equal(Object.hasOwn(elementByCandidate, "dataAssetId"), false);
    assert.equal(Object.hasOwn(elementBySource, "dataAssetId"), false);

    const sourceEndpoint = {
      referenceKind: "CANDIDATE",
      candidateId: contracts.asNormalizedCandidateId("candidate:source"),
      candidateKind: "AGENT",
    };
    const targetEndpoint = {
      referenceKind: "SOURCE_OBJECT",
      sourceObject,
      candidateKind: "MODEL",
    };
    const relationship = {
      ...objectCandidate("RELATIONSHIP", "candidate:relationship", sourceObject),
      relationshipTypeCode: "SOURCE_USES_TARGET",
      sourceEndpoint,
      targetEndpoint,
    };
    const reversed = {
      ...relationship,
      sourceEndpoint: targetEndpoint,
      targetEndpoint: sourceEndpoint,
    };

    assert.notDeepEqual(relationship, reversed);
    assert.equal(
      Object.values(contracts.CANONICAL_OBJECT_KIND).includes("RELATIONSHIP"),
      false,
    );
  });

  it("defines exactly five outcomes and two authoritative actor kinds", () => {
    assert.deepEqual(Object.values(contracts.RECONCILIATION_OUTCOME).sort(), [
      "CREATE_NEW",
      "DEFER",
      "MATCH_EXISTING",
      "MERGE_CANDIDATES",
      "REJECT",
    ]);
    assert.deepEqual(
      Object.values(contracts.RECONCILIATION_AUTHORITY_KIND).sort(),
      ["DETERMINISTIC_RULE", "HUMAN"],
    );
    for (const forbidden of ["AI", "LLM", "SEMANTIC_ENGINE"]) {
      assert.equal(
        Object.values(contracts.RECONCILIATION_AUTHORITY_KIND).includes(
          forbidden,
        ),
        false,
      );
    }
  });

  it("creates an immutable source-neutral merge with deterministic leaf IDs", () => {
    const organisationId = contracts.asOrganisationId("organisation:merge");
    const sourceA = sourceObjectIdentity("connection:a", "external:model:a");
    const sourceB = sourceObjectIdentity("connection:b", "external:model:b");
    const candidateB = objectCandidate(
      "MODEL",
      "candidate:model:b",
      sourceB,
    );
    const candidateA = objectCandidate(
      "MODEL",
      "candidate:model:a",
      sourceA,
    );
    const merge = contracts.createCandidateMergeRecord(
      mergeDraft({
        id: "merge:models",
        organisationId,
        kind: "MODEL",
        contributors: [
          trustedContributor(organisationId, candidateB),
          trustedContributor(organisationId, candidateA),
        ],
        decisionId: "decision:merge:models",
      }),
    );

    assert.deepEqual(merge.contributingCandidateIds, [
      "candidate:model:a",
      "candidate:model:b",
    ]);
    assert.equal(Object.isFrozen(merge), true);
    assert.equal(Object.isFrozen(merge.contributingCandidateIds), true);
    for (const forbidden of [
      "sourceObject",
      "canonicalObject",
      "primarySource",
      "assertionIds",
      "evidenceIds",
      "proposedIdentity",
      "trustState",
    ]) {
      assert.equal(Object.hasOwn(merge, forbidden), false, forbidden);
    }
    assert.equal(merge.requiresReconciliation, true);
    assert.equal(merge.createsCanonicalObject, false);

    assert.deepEqual(candidateA.assertionIds, ["assertion:candidate:model:a"]);
    assert.deepEqual(candidateB.evidenceIds, ["evidence:candidate:model:b"]);
    assert.equal(candidateA.sourceObject, sourceA);
    assert.equal(candidateB.sourceObject, sourceB);
  });

  it("rejects unsafe candidate merges fail-closed", () => {
    const organisationId = contracts.asOrganisationId("organisation:merge-safe");
    const otherOrganisationId = contracts.asOrganisationId(
      "organisation:other",
    );
    const sourceObject = sourceObjectIdentity(
      "connection:merge-safe",
      "external:merge-safe",
    );
    const modelOne = objectCandidate(
      "MODEL",
      "candidate:model:one",
      sourceObject,
    );
    const modelTwo = objectCandidate(
      "MODEL",
      "candidate:model:two",
      sourceObject,
    );
    const tool = objectCandidate("TOOL", "candidate:tool", sourceObject);
    const relationship = objectCandidate(
      "RELATIONSHIP",
      "candidate:relationship",
      sourceObject,
    );
    const draft = (contributors, kind = "MODEL") =>
      mergeDraft({
        id: `merge:unsafe:${kind}`,
        organisationId,
        kind,
        contributors,
        decisionId: `decision:unsafe:${kind}`,
      });

    assert.throws(
      () =>
        contracts.createCandidateMergeRecord(
          draft([trustedContributor(organisationId, modelOne)]),
        ),
      /at least two leaf candidates/,
    );
    assert.throws(
      () =>
        contracts.createCandidateMergeRecord(
          draft([
            trustedContributor(organisationId, modelOne),
            trustedContributor(organisationId, modelOne),
          ]),
        ),
      /must be unique/,
    );
    assert.throws(
      () =>
        contracts.createCandidateMergeRecord(
          draft([
            trustedContributor(organisationId, modelOne),
            trustedContributor(organisationId, tool),
          ]),
        ),
      /cannot mix candidate kinds/,
    );
    assert.throws(
      () =>
        contracts.createCandidateMergeRecord(
          draft([
            trustedContributor(organisationId, modelOne),
            trustedContributor(otherOrganisationId, modelTwo),
          ]),
        ),
      /another organisation/,
    );
    assert.throws(
      () =>
        contracts.createCandidateMergeRecord(
          draft(
            [
              trustedContributor(organisationId, relationship),
              trustedContributor(organisationId, relationship),
            ],
            "RELATIONSHIP",
          ),
        ),
      /Relationship candidates cannot be merged/,
    );
  });

  it("flattens successive merges to unique original leaf candidates", () => {
    const organisationId = contracts.asOrganisationId("organisation:flatten");
    const sourceObject = sourceObjectIdentity(
      "connection:flatten",
      "external:flatten",
    );
    const candidates = ["one", "two", "three"].map((suffix) =>
      objectCandidate("MODEL", `candidate:${suffix}`, sourceObject),
    );
    const mergeA = contracts.createCandidateMergeRecord(
      mergeDraft({
        id: "merge:a",
        organisationId,
        kind: "MODEL",
        contributors: [
          trustedContributor(organisationId, candidates[1]),
          trustedContributor(organisationId, candidates[0]),
        ],
        decisionId: "decision:merge:a",
      }),
    );
    const mergeB = contracts.createCandidateMergeRecord(
      mergeDraft({
        id: "merge:b",
        organisationId,
        kind: "MODEL",
        contributors: [
          { contributorKind: "CANDIDATE_MERGE", candidateMerge: mergeA },
          trustedContributor(organisationId, candidates[2]),
        ],
        decisionId: "decision:merge:b",
      }),
    );

    assert.deepEqual(mergeB.contributingCandidateIds, [
      "candidate:one",
      "candidate:three",
      "candidate:two",
    ]);
    assert.equal(mergeB.contributingCandidateIds.includes(mergeA.candidateMergeId), false);
    assert.throws(
      () =>
        contracts.createCandidateMergeRecord(
          mergeDraft({
            id: "merge:duplicate-flatten",
            organisationId,
            kind: "MODEL",
            contributors: [
              { contributorKind: "CANDIDATE_MERGE", candidateMerge: mergeA },
              trustedContributor(organisationId, candidates[0]),
            ],
            decisionId: "decision:merge:duplicate-flatten",
          }),
        ),
      /must be unique/,
    );
  });

  it("keeps merge rejection non-destructive and final source mappings distinct", () => {
    const organisationId = contracts.asOrganisationId("organisation:resolution");
    const sharedSource = sourceObjectIdentity(
      "connection:resolution",
      "external:shared",
    );
    const secondSource = sourceObjectIdentity(
      "connection:resolution",
      "external:second",
    );
    const candidates = [
      objectCandidate("MODEL", "candidate:first", sharedSource),
      objectCandidate("MODEL", "candidate:duplicate-source", sharedSource),
      objectCandidate("MODEL", "candidate:second", secondSource),
    ];
    const merge = contracts.createCandidateMergeRecord(
      mergeDraft({
        id: "merge:resolution",
        organisationId,
        kind: "MODEL",
        contributors: candidates.map((candidate) =>
          trustedContributor(organisationId, candidate),
        ),
        decisionId: "decision:merge:resolution",
      }),
    );
    const rejection = {
      decisionId: contracts.asReconciliationDecisionId("decision:reject:merge"),
      organisationId,
      outcome: "REJECT",
      candidateKind: "MODEL",
      subject: {
        subjectKind: "CANDIDATE_MERGE",
        candidateMergeId: merge.candidateMergeId,
        candidateKind: "MODEL",
      },
      authority: { authorityKind: "HUMAN", actorReference: "actor:reviewer" },
      reasonCode: "COMBINED_IDENTITY_REJECTED",
      assertionIds: [],
      evidenceIds: [],
      decidedAt: reconciliationTimestamp,
    };

    assert.equal(Object.hasOwn(rejection, "canonicalObject"), false);
    assert.equal(merge.contributingCandidateIds.length, 3);
    assert.equal(candidates.every((candidate) => candidate.requiresReconciliation), true);

    const finalDecisionId = contracts.asReconciliationDecisionId(
      "decision:final:merge",
    );
    const canonicalObject = {
      organisationId,
      objectId: contracts.asCanonicalObjectId("canonical:model:resolution"),
      kind: "MODEL",
    };
    const uniqueSources = new Map(
      candidates.map((candidate) => [
        contracts.sourceObjectIdentityKey(candidate.sourceObject),
        candidate.sourceObject,
      ]),
    );
    const mappings = [...uniqueSources.values()].map((sourceObject, index) => ({
      mappingId: contracts.asObjectSourceMappingId(`mapping:resolution:${index}`),
      canonicalObject,
      sourceObject,
      status: "CONFIRMED",
      matchMethod: "MANUAL",
      validFrom: reconciliationTimestamp,
      reconciliationDecisionId: finalDecisionId,
    }));

    assert.equal(mappings.length, 2);
    assert.equal(
      mappings.every(
        (mapping) =>
          mapping.canonicalObject === canonicalObject &&
          mapping.reconciliationDecisionId === finalDecisionId,
      ),
      true,
    );
    assert.equal(
      new Set(
        mappings.map((mapping) =>
          contracts.sourceObjectIdentityKey(mapping.sourceObject),
        ),
      ).size,
      mappings.length,
    );
  });

  it("keeps source identity connection-scoped for fail-closed matching", () => {
    const first = sourceObjectIdentity("connection:first", "external:same");
    const second = sourceObjectIdentity("connection:second", "external:same");
    assert.notEqual(
      contracts.sourceObjectIdentityKey(first),
      contracts.sourceObjectIdentityKey(second),
    );
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
