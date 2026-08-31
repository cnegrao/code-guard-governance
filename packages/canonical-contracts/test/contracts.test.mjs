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

function technicalSupport(assertionIds = [], evidenceIds = []) {
  return {
    assertionIds: assertionIds.map(contracts.asSourceAssertionId),
    evidenceIds: evidenceIds.map(contracts.asEvidenceId),
  };
}

function dataTypeSupport(overrides = {}) {
  const empty = technicalSupport();
  return {
    normalizedFamily: empty,
    nativeType: empty,
    length: empty,
    precision: empty,
    scale: empty,
    timeZoneSemantics: empty,
    ...overrides,
  };
}

function dataElementSupport(overrides = {}) {
  const empty = technicalSupport();
  return {
    technicalName: empty,
    ordinalPosition: empty,
    dataType: dataTypeSupport(),
    nullability: empty,
    defaultState: empty,
    generationState: empty,
    ...overrides,
  };
}

function profileSupport(...fields) {
  return Object.fromEntries(fields.map((field) => [field, technicalSupport()]));
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

  it("exposes only the approved Data Grain vocabularies and explicit states", () => {
    assert.deepEqual(Object.values(contracts.DATA_ASSET_STRUCTURAL_KIND), [
      "TABLE",
      "VIEW",
      "MATERIALIZED_VIEW",
      "DATASET",
      "FILE",
      "STREAM",
      "COLLECTION",
      "OTHER",
    ]);
    assert.deepEqual(Object.values(contracts.NORMALIZED_DATA_TYPE_FAMILY), [
      "UNKNOWN",
      "BOOLEAN",
      "INTEGER",
      "DECIMAL",
      "FLOAT",
      "STRING",
      "BINARY",
      "DATE",
      "TIME",
      "TIMESTAMP",
      "INTERVAL",
      "IDENTIFIER",
      "SEMI_STRUCTURED",
      "ARRAY",
      "MAP",
      "STRUCT",
      "VECTOR",
      "OTHER",
    ]);
    assert.deepEqual(Object.values(contracts.NULLABILITY_STATE), [
      "UNKNOWN",
      "NULLABLE",
      "NOT_NULLABLE",
    ]);
    assert.deepEqual(Object.values(contracts.DEFAULT_VALUE_STATE), [
      "UNKNOWN",
      "ABSENT",
      "PRESENT",
    ]);
    assert.deepEqual(Object.values(contracts.VALUE_GENERATION_STATE), [
      "UNKNOWN",
      "NOT_GENERATED",
      "GENERATED",
    ]);
    assert.deepEqual(Object.values(contracts.DATA_KEY_TYPE), [
      "PRIMARY_KEY",
      "UNIQUE_KEY",
    ]);
  });

  it("constructs an allowlisted immutable DataAsset technical profile", () => {
    const structuralKindSupport = technicalSupport(
      ["assertion:asset:kind"],
      ["evidence:asset:kind"],
    );
    const technicalNameSupport = technicalSupport(
      ["assertion:asset:name"],
      ["evidence:asset:name"],
    );
    const technicalNamespaceSupport = technicalSupport();
    const locatorSupport = technicalSupport(
      ["assertion:asset:locator"],
      ["evidence:asset:locator"],
    );
    const descriptionSupport = technicalSupport(
      ["assertion:asset:description"],
    );
    const widenedDraft = {
      dataAssetId: contracts.asDataAssetId("asset:factory:customer"),
      structuralKind: "TABLE",
      technicalName: "customer",
      technicalNamespace: undefined,
      qualifiedTechnicalLocator: "catalog.schema.customer",
      technicalDescription: "Canonical customer table",
      support: {
        structuralKind: structuralKindSupport,
        technicalName: technicalNameSupport,
        technicalNamespace: technicalNamespaceSupport,
        qualifiedTechnicalLocator: locatorSupport,
        technicalDescription: descriptionSupport,
        arbitraryField: technicalSupport(["assertion:must-not-copy"]),
      },
      canonicalObject: { kind: "DATA_ASSET" },
      sourceObject: { externalId: "must-not-copy" },
      organisationId: "must-not-copy",
      arbitraryMetadata: { vendor: "must-not-copy" },
    };

    const profile = contracts.createDataAssetTechnicalProfile(widenedDraft);

    assert.deepEqual(profile, {
      dataAssetId: "asset:factory:customer",
      structuralKind: "TABLE",
      technicalName: "customer",
      qualifiedTechnicalLocator: "catalog.schema.customer",
      technicalDescription: "Canonical customer table",
      support: {
        structuralKind: {
          assertionIds: ["assertion:asset:kind"],
          evidenceIds: ["evidence:asset:kind"],
        },
        technicalName: {
          assertionIds: ["assertion:asset:name"],
          evidenceIds: ["evidence:asset:name"],
        },
        technicalNamespace: { assertionIds: [], evidenceIds: [] },
        qualifiedTechnicalLocator: {
          assertionIds: ["assertion:asset:locator"],
          evidenceIds: ["evidence:asset:locator"],
        },
        technicalDescription: {
          assertionIds: ["assertion:asset:description"],
          evidenceIds: [],
        },
      },
    });
    assert.equal(Object.hasOwn(profile, "technicalNamespace"), false);
    for (const forbidden of [
      "canonicalObject",
      "sourceObject",
      "organisationId",
      "arbitraryMetadata",
    ]) {
      assert.equal(Object.hasOwn(profile, forbidden), false, forbidden);
    }
    assert.equal(Object.hasOwn(profile.support, "arbitraryField"), false);

    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.support), true);
    for (const fieldSupport of Object.values(profile.support)) {
      assert.equal(Object.isFrozen(fieldSupport), true);
      assert.equal(Object.isFrozen(fieldSupport.assertionIds), true);
      assert.equal(Object.isFrozen(fieldSupport.evidenceIds), true);
    }

    assert.notEqual(profile.support.structuralKind, structuralKindSupport);
    assert.notEqual(
      profile.support.structuralKind,
      profile.support.technicalName,
    );
    assert.notEqual(
      profile.support.technicalName,
      profile.support.qualifiedTechnicalLocator,
    );

    structuralKindSupport.assertionIds.push("assertion:input:mutated");
    structuralKindSupport.evidenceIds.push("evidence:input:mutated");
    assert.deepEqual(profile.support.structuralKind.assertionIds, [
      "assertion:asset:kind",
    ]);
    assert.deepEqual(profile.support.structuralKind.evidenceIds, [
      "evidence:asset:kind",
    ]);
    assert.equal(Object.isFrozen(structuralKindSupport.assertionIds), false);
  });

  it("keeps technical identity separate and preserves field-level provenance", () => {
    const repositoryName = technicalSupport(
      ["assertion:repository:name"],
      ["evidence:repository:name"],
    );
    const catalogType = technicalSupport(
      ["assertion:catalog:type:one", "assertion:catalog:type:conflict"],
      ["evidence:catalog:type"],
    );
    const runtimeNullability = technicalSupport(
      ["assertion:runtime:nullability"],
      ["evidence:runtime:nullability"],
    );
    const enterpriseOrdinal = technicalSupport([
      "assertion:enterprise:ordinal",
    ]);
    const empty = technicalSupport();
    const dataAssetProfile = {
      dataAssetId: contracts.asDataAssetId("asset:customer"),
      structuralKind: "TABLE",
      technicalName: "customer",
      support: {
        structuralKind: catalogType,
        technicalName: repositoryName,
        technicalNamespace: empty,
        qualifiedTechnicalLocator: empty,
        technicalDescription: empty,
      },
    };

    assert.equal(Object.hasOwn(dataAssetProfile, "canonicalObject"), false);
    assert.equal(dataAssetProfile.technicalNamespace, undefined);
    assert.deepEqual(
      dataAssetProfile.support.technicalNamespace.assertionIds,
      [],
    );
    assert.notDeepEqual(
      dataAssetProfile.support.structuralKind,
      dataAssetProfile.support.technicalName,
    );

    const dataElementProfile = contracts.createDataElementTechnicalProfile({
      dataElementId: contracts.asDataElementId("element:customer:id"),
      technicalName: "customer_id",
      ordinalPosition: 1,
      dataType: {
        normalizedFamily: "DECIMAL",
        nativeType: "NUMBER(18,4)",
        precision: 18,
        scale: 4,
        timeZoneSemantics: "NOT_APPLICABLE",
      },
      nullability: "NOT_NULLABLE",
      defaultState: "ABSENT",
      generationState: "NOT_GENERATED",
      support: dataElementSupport({
        technicalName: repositoryName,
        ordinalPosition: enterpriseOrdinal,
        dataType: dataTypeSupport({
          normalizedFamily: catalogType,
          nativeType: catalogType,
          precision: catalogType,
          scale: catalogType,
        }),
        nullability: runtimeNullability,
      }),
    });

    assert.equal(Object.hasOwn(dataElementProfile, "dataAssetId"), false);
    assert.equal(Object.hasOwn(dataElementProfile, "elementPath"), false);
    assert.equal(Object.hasOwn(dataElementProfile, "isPrimaryKey"), false);
    assert.equal(Object.hasOwn(dataElementProfile, "isForeignKey"), false);
    assert.equal(Object.hasOwn(dataElementProfile, "defaultExpression"), false);
    assert.equal(dataElementProfile.ordinalPosition, 1);
    assert.deepEqual(
      dataElementProfile.support.dataType.normalizedFamily.assertionIds,
      ["assertion:catalog:type:one", "assertion:catalog:type:conflict"],
    );
    assert.deepEqual(
      dataElementProfile.support.nullability.assertionIds,
      ["assertion:runtime:nullability"],
    );
    assert.notEqual(
      dataElementProfile.support.technicalName,
      dataElementProfile.support.nullability,
    );
    assert.equal(
      Object.hasOwn(dataElementProfile.support.technicalName, "trustState"),
      false,
    );
    assert.equal(Object.isFrozen(dataElementProfile), true);
    assert.equal(Object.isFrozen(dataElementProfile.support.dataType), true);
  });

  it("validates datatype and ordinal invariants without a recursive type AST", () => {
    const decimal = contracts.createDataTypeDescriptor({
      normalizedFamily: "DECIMAL",
      nativeType: "NUMBER(38,10)",
      precision: 38,
      scale: 10,
      timeZoneSemantics: "NOT_APPLICABLE",
    });
    assert.equal(decimal.normalizedFamily, "DECIMAL");
    assert.equal(decimal.nativeType, "NUMBER(38,10)");
    assert.equal(Object.isFrozen(decimal), true);
    assert.equal(Object.hasOwn(decimal, "elementType"), false);

    assert.doesNotThrow(() =>
      contracts.createDataTypeDescriptor({
        normalizedFamily: "TIMESTAMP",
        nativeType: "TIMESTAMP WITH TIME ZONE",
        timeZoneSemantics: "WITH_TIME_ZONE",
      }),
    );
    assert.throws(
      () =>
        contracts.createDataTypeDescriptor({
          normalizedFamily: "STRING",
          length: -1,
          timeZoneSemantics: "NOT_APPLICABLE",
        }),
      /length must be a non-negative integer/,
    );
    assert.throws(
      () =>
        contracts.createDataTypeDescriptor({
          normalizedFamily: "DECIMAL",
          precision: 4.5,
          timeZoneSemantics: "NOT_APPLICABLE",
        }),
      /precision must be a non-negative integer/,
    );
    assert.throws(
      () =>
        contracts.createDataTypeDescriptor({
          normalizedFamily: "DECIMAL",
          precision: 4,
          scale: 5,
          timeZoneSemantics: "NOT_APPLICABLE",
        }),
      /scale cannot exceed precision/,
    );
    assert.throws(
      () =>
        contracts.createDataTypeDescriptor({
          normalizedFamily: "STRING",
          timeZoneSemantics: "WITH_TIME_ZONE",
        }),
      /require a TIME or TIMESTAMP/,
    );

    const elementDraft = {
      dataElementId: contracts.asDataElementId("element:ordinal"),
      technicalName: "ordinal_test",
      dataType: {
        normalizedFamily: "INTEGER",
        timeZoneSemantics: "NOT_APPLICABLE",
      },
      nullability: "UNKNOWN",
      defaultState: "UNKNOWN",
      generationState: "UNKNOWN",
      support: dataElementSupport(),
    };
    assert.throws(
      () =>
        contracts.createDataElementTechnicalProfile({
          ...elementDraft,
          ordinalPosition: 0,
        }),
      /ordinal position must be a positive integer/,
    );
    assert.throws(
      () =>
        contracts.createDataElementTechnicalProfile({
          ...elementDraft,
          ordinalPosition: 1.5,
        }),
      /ordinal position must be a positive integer/,
    );
  });

  it("creates ordered composite primary and unique keys fail-closed", () => {
    const dataAssetId = contracts.asDataAssetId("asset:customer");
    const first = contracts.asDataElementId("element:customer:id");
    const second = contracts.asDataElementId("element:customer:region");
    const draft = {
      keyDefinitionId: contracts.asDataKeyDefinitionId("key:customer:primary"),
      dataAssetId,
      keyType: "PRIMARY_KEY",
      technicalName: "customer_pk",
      members: [
        { position: 2, dataElementId: second },
        { position: 1, dataElementId: first },
      ],
      support: technicalSupport(["assertion:catalog:primary-key"]),
    };
    const primary = contracts.createDataKeyDefinition(draft);
    const unique = contracts.createDataKeyDefinition({
      ...draft,
      keyDefinitionId: contracts.asDataKeyDefinitionId("key:customer:unique"),
      keyType: "UNIQUE_KEY",
    });

    assert.deepEqual(primary.members, [
      { position: 1, dataElementId: first },
      { position: 2, dataElementId: second },
    ]);
    assert.equal(primary.keyType, "PRIMARY_KEY");
    assert.equal(unique.keyType, "UNIQUE_KEY");
    assert.equal(Object.isFrozen(primary), true);
    assert.equal(Object.isFrozen(primary.members), true);
    assert.equal(primary.members.every(Object.isFrozen), true);

    assert.throws(
      () => contracts.createDataKeyDefinition({ ...draft, members: [] }),
      /requires at least one member/,
    );
    assert.throws(
      () =>
        contracts.createDataKeyDefinition({
          ...draft,
          members: [
            { position: 1, dataElementId: first },
            { position: 1, dataElementId: second },
          ],
        }),
      /positions must be unique/,
    );
    assert.throws(
      () =>
        contracts.createDataKeyDefinition({
          ...draft,
          members: [
            { position: 1, dataElementId: first },
            { position: 3, dataElementId: second },
          ],
        }),
      /positions must be contiguous/,
    );
    assert.throws(
      () =>
        contracts.createDataKeyDefinition({
          ...draft,
          members: [
            { position: 1, dataElementId: first },
            { position: 2, dataElementId: first },
          ],
        }),
      /DataElementIds must be unique/,
    );
    assert.throws(
      () =>
        contracts.createDataKeyDefinition({
          ...draft,
          members: [{ position: 0, dataElementId: first }],
        }),
      /one-based integers/,
    );
  });

  it("creates ordered directional composite foreign keys and permits self references", () => {
    const orderAsset = contracts.asDataAssetId("asset:order");
    const customerAsset = contracts.asDataAssetId("asset:customer");
    const sourceId = contracts.asDataElementId("element:order:customer_id");
    const sourceRegion = contracts.asDataElementId(
      "element:order:customer_region",
    );
    const targetId = contracts.asDataElementId("element:customer:id");
    const targetRegion = contracts.asDataElementId("element:customer:region");
    const draft = {
      foreignKeyDefinitionId: contracts.asForeignKeyDefinitionId(
        "foreign-key:order:customer",
      ),
      sourceDataAssetId: orderAsset,
      targetDataAssetId: customerAsset,
      technicalName: "order_customer_fk",
      mappings: [
        {
          position: 2,
          sourceDataElementId: sourceRegion,
          targetDataElementId: targetRegion,
        },
        {
          position: 1,
          sourceDataElementId: sourceId,
          targetDataElementId: targetId,
        },
      ],
      support: technicalSupport(["assertion:catalog:foreign-key"]),
    };
    const foreignKey = contracts.createForeignKeyDefinition(draft);

    assert.deepEqual(foreignKey.mappings, [
      {
        position: 1,
        sourceDataElementId: sourceId,
        targetDataElementId: targetId,
      },
      {
        position: 2,
        sourceDataElementId: sourceRegion,
        targetDataElementId: targetRegion,
      },
    ]);
    assert.equal(foreignKey.sourceDataAssetId, orderAsset);
    assert.equal(foreignKey.targetDataAssetId, customerAsset);
    assert.equal(Object.isFrozen(foreignKey.mappings), true);

    const selfReference = contracts.createForeignKeyDefinition({
      ...draft,
      foreignKeyDefinitionId: contracts.asForeignKeyDefinitionId(
        "foreign-key:customer:parent",
      ),
      sourceDataAssetId: customerAsset,
      targetDataAssetId: customerAsset,
    });
    assert.equal(selfReference.sourceDataAssetId, selfReference.targetDataAssetId);

    assert.throws(
      () => contracts.createForeignKeyDefinition({ ...draft, mappings: [] }),
      /requires at least one member/,
    );
    assert.throws(
      () =>
        contracts.createForeignKeyDefinition({
          ...draft,
          mappings: [
            {
              position: 1,
              sourceDataElementId: sourceId,
              targetDataElementId: targetId,
            },
            {
              position: 2,
              sourceDataElementId: sourceId,
              targetDataElementId: targetRegion,
            },
          ],
        }),
      /source DataElementIds must be unique/,
    );
    assert.throws(
      () =>
        contracts.createForeignKeyDefinition({
          ...draft,
          mappings: [
            {
              position: 1,
              sourceDataElementId: sourceId,
              targetDataElementId: targetId,
            },
            {
              position: 2,
              sourceDataElementId: sourceRegion,
              targetDataElementId: targetId,
            },
          ],
        }),
      /target DataElementIds must be unique/,
    );
    assert.throws(
      () =>
        contracts.createForeignKeyDefinition({
          ...draft,
          mappings: [
            {
              position: 1,
              sourceDataElementId: sourceId,
              targetDataElementId: targetId,
            },
            {
              position: 3,
              sourceDataElementId: sourceRegion,
              targetDataElementId: targetRegion,
            },
          ],
        }),
      /positions must be contiguous/,
    );
  });

  it("keeps structural ownership, lineage, and candidate boundaries unchanged", () => {
    const identity = {
      canonicalObject: {
        organisationId: contracts.asOrganisationId("organisation:data-grain"),
        objectId: contracts.asCanonicalObjectId("object:data-element"),
        kind: "DATA_ELEMENT",
      },
      dataElementId: contracts.asDataElementId("element:data-grain"),
      dataAssetId: contracts.asDataAssetId("asset:data-grain"),
      elementPath: "payload.customer_id",
    };
    assert.deepEqual(Object.keys(identity).sort(), [
      "canonicalObject",
      "dataAssetId",
      "dataElementId",
      "elementPath",
    ]);
    assert.equal(
      Object.values(contracts.CANONICAL_OBJECT_KIND).includes("CONTAINS"),
      false,
    );
    assert.equal(Object.hasOwn(contracts, "DERIVED_FROM"), false);

    const legacyAssetCandidate = githubRepositoryDiscoveryFixture.candidates.find(
      (candidate) => candidate.candidateKind === "AGENT",
    );
    assert.equal(Object.hasOwn(legacyAssetCandidate, "technicalProfile"), false);
    assert.equal(contracts.CANONICAL_CONTRACT_VERSION, "1.1");
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

  it("exposes only the approved AI technical vocabularies", () => {
    assert.deepEqual(Object.values(contracts.MCP_TRANSPORT), [
      "UNKNOWN",
      "STDIO",
      "STREAMABLE_HTTP",
      "SERVER_SENT_EVENTS",
      "OTHER",
    ]);
    assert.deepEqual(Object.values(contracts.API_PROTOCOL_FAMILY), [
      "UNKNOWN",
      "HTTP",
      "GRPC",
      "GRAPHQL",
      "WEBSOCKET",
      "EVENT",
      "OTHER",
    ]);
    assert.deepEqual(Object.values(contracts.KNOWLEDGE_BASE_RESOURCE_KIND), [
      "UNKNOWN",
      "DOCUMENT_COLLECTION",
      "SEARCH_INDEX",
      "VECTOR_INDEX",
      "KNOWLEDGE_GRAPH",
      "OTHER",
    ]);
  });

  it("creates allowlisted nominal fingerprints with the same minimal serialized shape", () => {
    const behaviorDraft = {
      algorithm: "SHA-256",
      schemaVersion: "agent-behavior/v1",
      value: "behavior-digest",
      canonicalObjectId: "must-not-copy",
      provenance: "must-not-copy",
      timestamp: "must-not-copy",
      secret: "must-not-copy",
    };
    const technicalDraft = {
      algorithm: "SHA-256",
      schemaVersion: "technical-profile/v1",
      value: "technical-digest",
      runtimeMetrics: { requests: 42 },
    };

    const behavior = contracts.createBehaviorFingerprint(behaviorDraft);
    const technical = contracts.createTechnicalFingerprint(technicalDraft);

    assert.deepEqual(Object.keys(behavior), [
      "algorithm",
      "schemaVersion",
      "value",
    ]);
    assert.deepEqual(Object.keys(technical), [
      "algorithm",
      "schemaVersion",
      "value",
    ]);
    assert.equal(Object.isFrozen(behavior), true);
    assert.equal(Object.isFrozen(technical), true);
    assert.equal(Object.hasOwn(behavior, "canonicalObjectId"), false);
    assert.equal(Object.hasOwn(behavior, "provenance"), false);
    assert.equal(Object.hasOwn(behavior, "timestamp"), false);
    assert.equal(Object.hasOwn(behavior, "secret"), false);
    assert.equal(Object.hasOwn(technical, "runtimeMetrics"), false);
    assert.equal(Object.isFrozen(behaviorDraft), false);
    assert.equal(Object.isFrozen(technicalDraft), false);

    for (const factory of [
      contracts.createBehaviorFingerprint,
      contracts.createTechnicalFingerprint,
    ]) {
      for (const field of ["algorithm", "schemaVersion", "value"]) {
        assert.throws(
          () =>
            factory({
              algorithm: "SHA-256",
              schemaVersion: "v1",
              value: "digest",
              [field]: "   ",
            }),
          /must be a non-empty string/,
        );
      }
    }
  });

  it("preserves Windows drive paths before URL parsing", () => {
    const backslashPath = String.raw`C:\repo\agent.ts`;
    const forwardSlashPath = "D:/code/project/file.ts";
    const lowerCaseDrivePath = String.raw`c:\repo\lower-case-drive.ts`;

    assert.equal(
      contracts.sanitizeTechnicalLocator(backslashPath),
      backslashPath,
    );
    assert.equal(
      contracts.sanitizeTechnicalLocator(forwardSlashPath),
      forwardSlashPath,
    );
    assert.equal(
      contracts.sanitizeTechnicalLocator(lowerCaseDrivePath),
      lowerCaseDrivePath,
    );
    assert.equal(
      contracts.sanitizeTechnicalLocator(
        String.raw`D:\code-guard-governance\packages\x.ts?draft=true#section`,
      ),
      String.raw`D:\code-guard-governance\packages\x.ts`,
    );
  });

  it("preserves UNC and POSIX locator representation", () => {
    const uncPath = String.raw`\\server\share\folder\file.ts`;
    const rootRelativeWindowsPath = String.raw`\server\share\folder\file.ts`;
    const posixPath = "/repository/src/agent.ts";

    assert.equal(contracts.sanitizeTechnicalLocator(uncPath), uncPath);
    assert.equal(
      contracts.sanitizeTechnicalLocator(rootRelativeWindowsPath),
      rootRelativeWindowsPath,
    );
    assert.equal(contracts.sanitizeTechnicalLocator(posixPath), posixPath);
    assert.equal(
      contracts.sanitizeTechnicalLocator(
        String.raw`\\server\share\folder\file.ts?draft=true#section`,
      ),
      uncPath,
    );
  });

  it("sanitizes actual HTTP URLs without treating them as filesystem paths", () => {
    assert.equal(
      contracts.sanitizeTechnicalLocator(
        "https://user:pass@example.com/api?token=123#frag",
      ),
      "https://example.com/api",
    );
    assert.equal(
      contracts.sanitizeTechnicalLocator(
        "https://user:pass@example.com/api",
      ),
      "https://example.com/api",
    );
    assert.equal(
      contracts.sanitizeTechnicalLocator("https://example.com/api?token=123"),
      "https://example.com/api",
    );
    assert.equal(
      contracts.sanitizeTechnicalLocator("https://example.com/api#frag"),
      "https://example.com/api",
    );
  });

  it("rejects empty sanitized locators without mutating the input", () => {
    const input = String.raw`C:\repo\agent.ts?draft=true#section`;
    const original = input;

    assert.equal(
      contracts.sanitizeTechnicalLocator(input),
      String.raw`C:\repo\agent.ts`,
    );
    assert.equal(input, original);
    assert.throws(
      () => contracts.sanitizeTechnicalLocator("  "),
      /must be a non-empty string/,
    );
    assert.throws(
      () => contracts.sanitizeTechnicalLocator("?token=secret"),
      /must remain non-empty after sanitization/,
    );
  });

  it("constructs an immutable allowlisted AgentVersion behavior snapshot", () => {
    const behaviorFingerprint = contracts.createBehaviorFingerprint({
      algorithm: "SHA-256",
      schemaVersion: "agent-behavior/v1",
      value: "agent-version-behavior",
    });
    const behaviorSupport = technicalSupport(
      ["assertion:agent-version:behavior"],
      ["evidence:agent-version:behavior"],
    );
    const draft = {
      agentVersionId: contracts.asAgentVersionId("agent-version:one"),
      behaviorFingerprint,
      buildReference: "build:2026.08.30",
      runtimeFrameworkReference: undefined,
      entrypointReference: "src/agent.ts#run",
      configurationReference: "config/agent.yaml",
      support: {
        behaviorFingerprint: behaviorSupport,
        buildReference: technicalSupport(),
        runtimeFrameworkReference: technicalSupport(),
        entrypointReference: technicalSupport(),
        configurationReference: technicalSupport(),
        arbitraryMetadata: technicalSupport(["assertion:must-not-copy"]),
      },
      bindings: [{ target: "model:current" }],
      owner: "must-not-copy",
      runtimeMetrics: { requests: 42 },
      secret: "must-not-copy",
    };

    const profile = contracts.createAgentVersionTechnicalProfile(draft);

    assert.deepEqual(Object.keys(profile), [
      "agentVersionId",
      "behaviorFingerprint",
      "buildReference",
      "entrypointReference",
      "configurationReference",
      "support",
    ]);
    assert.equal(Object.hasOwn(profile, "runtimeFrameworkReference"), false);
    for (const forbidden of [
      "bindings",
      "owner",
      "runtimeMetrics",
      "secret",
    ]) {
      assert.equal(Object.hasOwn(profile, forbidden), false, forbidden);
    }
    assert.equal(Object.hasOwn(profile.support, "arbitraryMetadata"), false);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.behaviorFingerprint), true);
    assert.notEqual(profile.behaviorFingerprint, behaviorFingerprint);
    assert.equal(Object.isFrozen(profile.support), true);
    for (const support of Object.values(profile.support)) {
      assert.equal(Object.isFrozen(support), true);
      assert.equal(Object.isFrozen(support.assertionIds), true);
      assert.equal(Object.isFrozen(support.evidenceIds), true);
    }

    behaviorSupport.assertionIds.push("assertion:input:mutated");
    behaviorSupport.evidenceIds.push("evidence:input:mutated");
    assert.deepEqual(profile.support.behaviorFingerprint.assertionIds, [
      "assertion:agent-version:behavior",
    ]);
    assert.deepEqual(profile.support.behaviorFingerprint.evidenceIds, [
      "evidence:agent-version:behavior",
    ]);
  });

  it("constructs all six current technical target profiles with pinned fingerprints", () => {
    const fingerprint = contracts.createTechnicalFingerprint({
      algorithm: "SHA-256",
      schemaVersion: "technical-profile/v1",
      value: "target-configuration",
    });
    const hash = { algorithm: "SHA-256", value: "content-integrity" };
    const mcpLocator = contracts.sanitizeTechnicalLocator(
      "https://mcp.invalid/rpc",
    );
    const apiLocator = contracts.sanitizeTechnicalLocator(
      "https://api.invalid/v1",
    );
    const promptLocator = contracts.sanitizeTechnicalLocator(
      "prompts/system.md",
    );

    const model = contracts.createModelTechnicalProfile({
      modelId: contracts.asModelId("model:one"),
      technicalFingerprint: fingerprint,
      providerReference: "provider:one",
      providerModelReference: "provider-model:one",
      modelFamily: "model-family",
      modelRevision: "revision:one",
      support: profileSupport(
        "technicalFingerprint",
        "providerReference",
        "providerModelReference",
        "modelFamily",
        "modelRevision",
      ),
      deployment: "must-not-copy",
      endpoint: "must-not-copy",
      credentials: "must-not-copy",
    });
    const tool = contracts.createToolTechnicalProfile({
      toolId: contracts.asToolId("tool:one"),
      technicalFingerprint: fingerprint,
      declarationReference: "tool:declaration",
      contractReference: "tool:contract",
      contractHash: hash,
      technicalDescription: "Typed tool contract",
      support: profileSupport(
        "technicalFingerprint",
        "declarationReference",
        "contractReference",
        "contractHash",
        "technicalDescription",
      ),
      secret: "must-not-copy",
    });
    const mcp = contracts.createMcpServerTechnicalProfile({
      mcpServerId: contracts.asMcpServerId("mcp:one"),
      technicalFingerprint: fingerprint,
      declaredServerReference: "mcp:declaration",
      protocolVersion: "2025-06-18",
      transport: "STREAMABLE_HTTP",
      endpointLocator: mcpLocator,
      support: profileSupport(
        "technicalFingerprint",
        "declaredServerReference",
        "protocolVersion",
        "transport",
        "endpointLocator",
      ),
      tools: ["must-not-copy"],
      credentials: "must-not-copy",
    });
    const api = contracts.createApiTechnicalProfile({
      apiId: contracts.asApiId("api:one"),
      technicalFingerprint: fingerprint,
      protocolFamily: "HTTP",
      serviceReference: "service:one",
      baseLocator: apiLocator,
      specificationReference: "openapi:one",
      specificationHash: hash,
      support: profileSupport(
        "technicalFingerprint",
        "protocolFamily",
        "serviceReference",
        "baseLocator",
        "specificationReference",
        "specificationHash",
      ),
      operations: ["must-not-copy"],
      credentials: "must-not-copy",
    });
    const prompt = contracts.createPromptTechnicalProfile({
      promptId: contracts.asPromptId("prompt:one"),
      technicalFingerprint: fingerprint,
      declarationReference: "prompt:declaration",
      revision: "revision:one",
      contentHash: hash,
      sourceLocator: promptLocator,
      support: profileSupport(
        "technicalFingerprint",
        "declarationReference",
        "revision",
        "contentHash",
        "sourceLocator",
      ),
      content: "must-not-copy",
      secret: "must-not-copy",
    });
    const knowledgeBase = contracts.createKnowledgeBaseTechnicalProfile({
      knowledgeBaseId: contracts.asKnowledgeBaseId("knowledge-base:one"),
      technicalFingerprint: fingerprint,
      sourceReference: "knowledge-source:one",
      resourceKind: "VECTOR_INDEX",
      contentHash: hash,
      retrievalConfigurationReference: "retrieval:one",
      support: profileSupport(
        "technicalFingerprint",
        "sourceReference",
        "resourceKind",
        "contentHash",
        "retrievalConfigurationReference",
      ),
      documents: ["must-not-copy"],
      chunks: ["must-not-copy"],
      embeddings: [[0.1, 0.2]],
      credentials: "must-not-copy",
    });

    const profiles = [model, tool, mcp, api, prompt, knowledgeBase];
    for (const profile of profiles) {
      assert.equal(Object.isFrozen(profile), true);
      assert.equal(Object.isFrozen(profile.technicalFingerprint), true);
      assert.notEqual(profile.technicalFingerprint, fingerprint);
      assert.equal(Object.isFrozen(profile.support), true);
      for (const support of Object.values(profile.support)) {
        assert.equal(Object.isFrozen(support), true);
        assert.equal(Object.isFrozen(support.assertionIds), true);
        assert.equal(Object.isFrozen(support.evidenceIds), true);
      }
      for (const forbidden of [
        "canonicalObject",
        "organisationId",
        "owner",
        "runtimeMetrics",
        "secret",
        "credentials",
      ]) {
        assert.equal(Object.hasOwn(profile, forbidden), false, forbidden);
      }
    }

    assert.equal(Object.hasOwn(model, "deployment"), false);
    assert.equal(Object.hasOwn(model, "endpoint"), false);
    assert.equal(Object.hasOwn(mcp, "tools"), false);
    assert.equal(Object.hasOwn(api, "operations"), false);
    assert.equal(Object.hasOwn(prompt, "content"), false);
    assert.equal(Object.hasOwn(knowledgeBase, "documents"), false);
    assert.equal(Object.hasOwn(knowledgeBase, "chunks"), false);
    assert.equal(Object.hasOwn(knowledgeBase, "embeddings"), false);
    assert.notEqual(tool.contractHash, hash);
    assert.notEqual(api.specificationHash, hash);
    assert.notEqual(prompt.contentHash, hash);
    assert.notEqual(knowledgeBase.contentHash, hash);
    assert.equal(Object.isFrozen(tool.contractHash), true);
    assert.equal(Object.isFrozen(api.specificationHash), true);
    assert.equal(Object.isFrozen(prompt.contentHash), true);
    assert.equal(Object.isFrozen(knowledgeBase.contentHash), true);
  });

  it("keeps optional target fields omitted and field support independent", () => {
    const technicalFingerprint = contracts.createTechnicalFingerprint({
      algorithm: "SHA-256",
      schemaVersion: "technical-profile/v1",
      value: "minimal-model",
    });
    const fingerprintSupport = technicalSupport(
      ["assertion:model:fingerprint"],
      ["evidence:model:fingerprint"],
    );
    const familySupport = technicalSupport(["assertion:model:family"]);
    const profile = contracts.createModelTechnicalProfile({
      modelId: contracts.asModelId("model:minimal"),
      technicalFingerprint,
      providerReference: undefined,
      providerModelReference: undefined,
      modelFamily: undefined,
      modelRevision: undefined,
      support: {
        technicalFingerprint: fingerprintSupport,
        providerReference: technicalSupport(),
        providerModelReference: technicalSupport(),
        modelFamily: familySupport,
        modelRevision: technicalSupport(),
      },
    });

    assert.deepEqual(Object.keys(profile), [
      "modelId",
      "technicalFingerprint",
      "support",
    ]);
    assert.notEqual(
      profile.support.technicalFingerprint,
      profile.support.modelFamily,
    );
    assert.deepEqual(profile.support.technicalFingerprint.assertionIds, [
      "assertion:model:fingerprint",
    ]);
    assert.deepEqual(profile.support.modelFamily.assertionIds, [
      "assertion:model:family",
    ]);

    fingerprintSupport.assertionIds.push("assertion:input:mutated");
    familySupport.assertionIds.push("assertion:input:mutated");
    assert.deepEqual(profile.support.technicalFingerprint.assertionIds, [
      "assertion:model:fingerprint",
    ]);
    assert.deepEqual(profile.support.modelFamily.assertionIds, [
      "assertion:model:family",
    ]);
  });
});
