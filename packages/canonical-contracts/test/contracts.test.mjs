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

function relationshipIdentities(
  organisationId = contracts.asOrganisationId("organisation:relationships"),
) {
  const canonicalObject = (kind, id) => ({
    organisationId,
    objectId: contracts.asCanonicalObjectId(`canonical:${id}`),
    kind,
  });
  const agent = {
    canonicalObject: canonicalObject("AGENT", "agent"),
    agentId: contracts.asAgentId("agent:relationship"),
    agentCode: "RELATIONSHIP_AGENT",
  };
  return {
    organisationId,
    agent,
    agentVersion: {
      canonicalObject: canonicalObject("AGENT_VERSION", "agent-version"),
      agent,
      agentVersionId: contracts.asAgentVersionId("agent-version:relationship"),
      versionCode: "version:one",
    },
    model: {
      canonicalObject: canonicalObject("MODEL", "model"),
      modelId: contracts.asModelId("model:relationship"),
    },
    tool: {
      canonicalObject: canonicalObject("TOOL", "tool"),
      toolId: contracts.asToolId("tool:relationship"),
    },
    mcpServer: {
      canonicalObject: canonicalObject("MCP_SERVER", "mcp-server"),
      mcpServerId: contracts.asMcpServerId("mcp-server:relationship"),
    },
    api: {
      canonicalObject: canonicalObject("API", "api"),
      apiId: contracts.asApiId("api:relationship"),
    },
    prompt: {
      canonicalObject: canonicalObject("PROMPT", "prompt"),
      promptId: contracts.asPromptId("prompt:relationship"),
    },
    knowledgeBase: {
      canonicalObject: canonicalObject("KNOWLEDGE_BASE", "knowledge-base"),
      knowledgeBaseId: contracts.asKnowledgeBaseId(
        "knowledge-base:relationship",
      ),
    },
    skill: {
      canonicalObject: canonicalObject("SKILL", "skill"),
      skillId: contracts.asSkillId("skill:relationship"),
    },
    dataAsset: {
      canonicalObject: canonicalObject("DATA_ASSET", "data-asset"),
      dataAssetId: contracts.asDataAssetId("data-asset:relationship"),
    },
    dataElement: {
      canonicalObject: canonicalObject("DATA_ELEMENT", "data-element"),
      dataElementId: contracts.asDataElementId("data-element:derived"),
      dataAssetId: contracts.asDataAssetId("data-asset:derived"),
      elementPath: "mail",
    },
    originDataElement: {
      canonicalObject: canonicalObject(
        "DATA_ELEMENT",
        "data-element:origin",
      ),
      dataElementId: contracts.asDataElementId("data-element:origin"),
      dataAssetId: contracts.asDataAssetId("data-asset:origin"),
      elementPath: "email",
    },
  };
}

function relationshipSupport(assertions = [], evidence = []) {
  return {
    assertionIds: assertions.map(contracts.asSourceAssertionId),
    evidenceIds: evidence.map(contracts.asEvidenceId),
  };
}

function behaviorBindingSupport() {
  return {
    relationship: relationshipSupport(["assertion:relationship"]),
    boundTechnicalFingerprint: relationshipSupport(
      ["assertion:fingerprint"],
      ["evidence:fingerprint"],
    ),
    bindingConfiguration: {
      configurationHash: relationshipSupport(["assertion:configuration:hash"]),
      configurationLocator: relationshipSupport(
        [],
        ["evidence:configuration:locator"],
      ),
    },
  };
}

function relationshipStateDraft({
  type,
  source,
  target,
  id = `relationship:${type}`,
  stateId = `relationship-state:${type}:one`,
  support = relationshipSupport(),
  ...specific
}) {
  return {
    relationshipId: contracts.asRelationshipId(id),
    relationshipStateId: contracts.asRelationshipStateId(stateId),
    organisationId: source.canonicalObject.organisationId,
    relationshipType: type,
    source,
    target,
    support,
    validFrom: contracts.asIsoTimestamp("2026-08-31T12:00:00.000Z"),
    recordedAt: contracts.asIsoTimestamp("2026-08-31T12:01:00.000Z"),
    ...specific,
  };
}

function relationshipCandidateFor(
  state,
  {
    candidateId = `candidate:${state.relationshipStateId}`,
    relationshipTypeCode = state.relationshipType,
    candidateKind = "RELATIONSHIP",
  } = {},
) {
  return {
    ...objectCandidate(
      candidateKind,
      candidateId,
      sourceObjectIdentity(
        "connection:relationship",
        `external:${candidateId}`,
      ),
    ),
    relationshipTypeCode,
    sourceEndpoint: {
      referenceKind: "CANDIDATE",
      candidateId: contracts.asNormalizedCandidateId(
        `${candidateId}:source`,
      ),
      candidateKind: state.source.canonicalObject.kind,
    },
    targetEndpoint: {
      referenceKind: "CANDIDATE",
      candidateId: contracts.asNormalizedCandidateId(
        `${candidateId}:target`,
      ),
      candidateKind: state.target.canonicalObject.kind,
    },
  };
}

function approveRelationship(
  authorizedState,
  {
    supersededState,
    candidate,
    relationshipCandidateId,
    decisionAssertionIds = ["assertion:decision"],
    decisionEvidenceIds = ["evidence:decision"],
  } = {},
) {
  const relationshipCandidate =
    candidate ?? relationshipCandidateFor(authorizedState);
  const decision = contracts.createRelationshipReconciliationDecision({
    decisionId: contracts.asReconciliationDecisionId(
      `decision:${authorizedState.relationshipStateId}`,
    ),
    organisationId: authorizedState.organisationId,
    relationshipCandidateId:
      relationshipCandidateId ?? relationshipCandidate.candidateId,
    relationshipCandidate,
    outcome: "CREATE_NEW",
    authority: { authorityKind: "HUMAN", actorReference: "reviewer:one" },
    reasonCode: "HUMAN_REVIEW",
    assertionIds: decisionAssertionIds.map(contracts.asSourceAssertionId),
    evidenceIds: decisionEvidenceIds.map(contracts.asEvidenceId),
    decidedAt: contracts.asIsoTimestamp("2026-08-31T13:00:00.000Z"),
    authorizedState,
    ...(supersededState === undefined ? {} : { supersededState }),
  });
  return {
    decision,
    relationship: contracts.createGovernedRelationship(
      decision,
      authorizedState,
    ),
  };
}

function semanticDataElement(
  organisationId,
  suffix,
  elementPath = `field_${suffix}`,
) {
  return {
    canonicalObject: {
      organisationId,
      objectId: contracts.asCanonicalObjectId(`canonical:data-element:${suffix}`),
      kind: "DATA_ELEMENT",
    },
    dataElementId: contracts.asDataElementId(`data-element:${suffix}`),
    dataAssetId: contracts.asDataAssetId(`data-asset:${suffix}`),
    elementPath,
  };
}

function semanticConcept(organisationId, suffix = "contact-email") {
  return {
    semanticIdentityKind: "SEMANTIC_CONCEPT",
    organisationId,
    semanticConceptId: contracts.asSemanticConceptId(
      `semantic-concept:${suffix}`,
    ),
  };
}

function semanticAssignmentCandidate(
  dataElement,
  {
    candidateId = `semantic-candidate:${dataElement.dataElementId}`,
    sourceCode = "correo_electronico",
    sourceLabel,
    confidence = 0.95,
    assertionIds = ["assertion:semantic:candidate"],
    evidenceIds = ["evidence:semantic:candidate"],
    ...extra
  } = {},
) {
  return contracts.createDataElementSemanticConceptAssignmentCandidate({
    candidateId:
      contracts.asDataElementSemanticConceptAssignmentCandidateId(candidateId),
    candidateKind: "DATA_ELEMENT_SEMANTIC_CONCEPT_ASSIGNMENT",
    dataElement,
    sourceObject: sourceObjectIdentity(
      "connection:semantic-catalog",
      `external:${candidateId}`,
    ),
    sourceSignal: {
      ...(sourceCode === undefined ? {} : { sourceCode }),
      ...(sourceLabel === undefined ? {} : { sourceLabel }),
    },
    assertionIds: assertionIds.map(contracts.asSourceAssertionId),
    evidenceIds: evidenceIds.map(contracts.asEvidenceId),
    confidence,
    inferredAt: contracts.asIsoTimestamp("2026-08-31T15:00:00.000Z"),
    requiresDecision: true,
    createsAssignment: false,
    ...extra,
  });
}

function semanticAssignmentState({
  dataElement,
  semanticConcept: target,
  id = `semantic-assignment:${dataElement.dataElementId}`,
  stateId = `semantic-assignment-state:${dataElement.dataElementId}:one`,
  support = relationshipSupport(),
  validFrom = contracts.asIsoTimestamp("2026-08-31T16:00:00.000Z"),
  recordedAt = contracts.asIsoTimestamp("2026-08-31T16:01:00.000Z"),
  ...extra
}) {
  return {
    assignmentId: contracts.asDataElementSemanticConceptAssignmentId(id),
    assignmentStateId:
      contracts.asDataElementSemanticConceptAssignmentStateId(stateId),
    organisationId: dataElement.canonicalObject.organisationId,
    dataElement,
    semanticConcept: target,
    support,
    validFrom,
    recordedAt,
    ...extra,
  };
}

function approveSemanticAssignment(
  authorizedState,
  {
    candidate,
    assignmentCandidateId,
    supersededState,
    decisionAssertionIds = ["assertion:semantic:decision"],
    decisionEvidenceIds = ["evidence:semantic:decision"],
  } = {},
) {
  const assignmentCandidate =
    candidate ?? semanticAssignmentCandidate(authorizedState.dataElement);
  const decision = contracts.createSemanticAssignmentReconciliationDecision({
    decisionId: contracts.asReconciliationDecisionId(
      `semantic-decision:${authorizedState.assignmentStateId}`,
    ),
    organisationId: authorizedState.organisationId,
    assignmentCandidateId:
      assignmentCandidateId ?? assignmentCandidate.candidateId,
    assignmentCandidate,
    outcome: "CREATE_NEW",
    authority: { authorityKind: "HUMAN", actorReference: "reviewer:semantic" },
    reasonCode: "HUMAN_REVIEW",
    assertionIds: decisionAssertionIds.map(contracts.asSourceAssertionId),
    evidenceIds: decisionEvidenceIds.map(contracts.asEvidenceId),
    decidedAt: contracts.asIsoTimestamp("2026-08-31T17:00:00.000Z"),
    authorizedState,
    ...(supersededState === undefined ? {} : { supersededState }),
  });
  return {
    decision,
    assignment: contracts.createDataElementSemanticConceptAssignment(
      decision,
      authorizedState,
    ),
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

  it("supports findings and single-source candidates for all eleven object kinds", () => {
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

    assert.equal(findings.length, 11);
    assert.equal(candidates.length, 11);
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

  it("keeps Skill findings and candidates unresolved across reconciliation signals", () => {
    const organisationId = contracts.asOrganisationId("organisation:skill");
    const firstSource = sourceObjectIdentity(
      "connection:skill:repository",
      "external:skill:one",
    );
    const secondSource = sourceObjectIdentity(
      "connection:skill:catalog",
      "external:skill:two",
    );
    const finding = {
      findingId: contracts.asDiscoveryFindingId("finding:skill:one"),
      findingNature: "CANDIDATE",
      candidateKind: "SKILL",
      sourceObject: firstSource,
      assertionIds: [],
      evidenceIds: [],
      confidence: 0.98,
      reviewStatus: contracts.FINDING_REVIEW_STATUS.UNREVIEWED,
      requiresReview: true,
      createsCanonicalObject: false,
      detectedAt: reconciliationTimestamp,
    };
    const firstCandidate = {
      ...objectCandidate("SKILL", "candidate:skill:one", firstSource),
      findingId: finding.findingId,
      proposedIdentity: {
        declarationReference: "skills/review/SKILL.md",
        displayName: "Review procedure",
      },
    };
    const secondCandidate = {
      ...objectCandidate("SKILL", "candidate:skill:two", secondSource),
      proposedIdentity: {
        declarationReference: "skills/review/SKILL.md",
        displayName: "Review procedure",
      },
    };

    assert.equal(finding.createsCanonicalObject, false);
    assert.equal(firstCandidate.requiresReconciliation, true);
    assert.equal(secondCandidate.requiresReconciliation, true);
    assert.notEqual(firstCandidate.candidateId, secondCandidate.candidateId);
    assert.notDeepEqual(firstCandidate.sourceObject, secondCandidate.sourceObject);
    for (const candidate of [firstCandidate, secondCandidate]) {
      for (const forbidden of [
        "canonicalObject",
        "skillId",
        "technicalFingerprint",
        "technicalProfile",
        "revisionReference",
        "artifactHash",
        "manifestReference",
        "sourceLocator",
        "content",
      ]) {
        assert.equal(Object.hasOwn(candidate, forbidden), false, forbidden);
        assert.equal(
          Object.hasOwn(candidate.proposedIdentity, forbidden),
          false,
          forbidden,
        );
      }
    }

    const merge = contracts.createCandidateMergeRecord(
      mergeDraft({
        id: "candidate-merge:skill",
        organisationId,
        kind: "SKILL",
        contributors: [
          trustedContributor(organisationId, firstCandidate),
          trustedContributor(organisationId, secondCandidate),
        ],
        decisionId: "decision:skill:merge",
      }),
    );
    const decision = {
      decisionId: contracts.asReconciliationDecisionId("decision:skill:create"),
      organisationId,
      outcome: "CREATE_NEW",
      candidateKind: "SKILL",
      subject: {
        subjectKind: "CANDIDATE_MERGE",
        candidateMergeId: merge.candidateMergeId,
        candidateKind: "SKILL",
      },
      canonicalObject: {
        organisationId,
        objectId: contracts.asCanonicalObjectId("canonical:skill:one"),
        kind: "SKILL",
      },
      authority: { authorityKind: "HUMAN", actorReference: "reviewer:one" },
      reasonCode: "HUMAN_REVIEW",
      assertionIds: [],
      evidenceIds: [],
      decidedAt: reconciliationTimestamp,
    };

    assert.equal(merge.candidateKind, "SKILL");
    assert.equal(merge.createsCanonicalObject, false);
    assert.equal(merge.requiresReconciliation, true);
    assert.deepEqual(new Set(merge.contributingCandidateIds), new Set([
      firstCandidate.candidateId,
      secondCandidate.candidateId,
    ]));
    assert.equal(decision.canonicalObject.kind, "SKILL");
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
    assert.deepEqual(
      Object.values(contracts.RELATIONSHIP_RECONCILIATION_OUTCOME),
      ["CREATE_NEW", "MATCH_EXISTING", "REJECT", "DEFER"],
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

  it("exposes exactly the eleven approved canonical object kinds in V1A.1", () => {
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
      "SKILL",
      "TOOL",
    ]);
    assert.equal(contracts.CANONICAL_OBJECT_KIND.AGENT, "AGENT");
    assert.equal(contracts.CANONICAL_OBJECT_KIND.AGENT_VERSION, "AGENT_VERSION");
    assert.equal(Object.values(contracts.CANONICAL_OBJECT_KIND).length, 11);
    assert.equal(Object.values(contracts.CANONICAL_OBJECT_KIND)[10], "SKILL");
    assert.equal(Object.hasOwn(contracts.CANONICAL_OBJECT_KIND, "SKILL_VERSION"), false);
    assert.equal(Object.hasOwn(contracts, "USES_SKILL"), false);
  });

  it("constructs the nine new identities without source or business metadata", () => {
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
        canonicalObject: canonicalObject("SKILL", "skill"),
        skillId: contracts.asSkillId("skill:test"),
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

    assert.equal(identities.length, 9);
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
    const skillIdentity = identities[6];
    assert.deepEqual(Object.keys(skillIdentity), ["canonicalObject", "skillId"]);
    const dataAssetIdentity = identities[7];
    const dataElementIdentity = identities[8];
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
      "CAPABILITY",
      "AUTHORIZATION",
      "SKILL_VERSION",
      "SIGNATURE",
      "EVALUATION",
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
      "nvidia",
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

  it("constructs an allowlisted Skill profile with field-level provenance", () => {
    const fingerprint = contracts.createTechnicalFingerprint({
      algorithm: "SHA-256",
      schemaVersion: "skill-technical/v1",
      value: "resolved-skill-technical-state",
    });
    const artifactHash = {
      algorithm: "SHA-256",
      value: "skill-package-integrity",
    };
    const declarationSupport = technicalSupport(
      ["assertion:skill:declaration"],
      ["evidence:skill:declaration"],
    );
    const artifactSupport = technicalSupport(
      ["assertion:skill:artifact"],
      ["evidence:skill:artifact"],
    );
    const support = {
      technicalFingerprint: technicalSupport(
        ["assertion:skill:fingerprint"],
        ["evidence:skill:fingerprint"],
      ),
      declarationReference: declarationSupport,
      revisionReference: technicalSupport(["assertion:skill:revision"]),
      artifactHash: artifactSupport,
      manifestReference: technicalSupport(["assertion:skill:manifest"]),
      sourceLocator: technicalSupport([], ["evidence:skill:locator"]),
      arbitraryField: technicalSupport(["assertion:must-not-copy"]),
    };
    const sourceLocator = contracts.sanitizeTechnicalLocator(
      "skills/review/SKILL.md?draft=true#section",
    );
    const draft = {
      skillId: contracts.asSkillId("skill:review"),
      technicalFingerprint: fingerprint,
      declarationReference: "skills/review/SKILL.md",
      revisionReference: "revision:one",
      artifactHash,
      manifestReference: "skills/review/package.json",
      sourceLocator,
      support,
      content: "must-not-copy",
      skillMd: "must-not-copy",
      rawManifest: { secret: "must-not-copy" },
      scripts: ["must-not-copy"],
      assets: ["must-not-copy"],
      credentials: "must-not-copy",
      token: "must-not-copy",
      password: "must-not-copy",
      apiKey: "must-not-copy",
      privateKey: "must-not-copy",
      signatureBlob: "must-not-copy",
      evaluationDataset: ["must-not-copy"],
      benchmarkResult: { score: 1 },
      risk: "must-not-copy",
      limitations: ["must-not-copy"],
      owner: "must-not-copy",
      authorization: "must-not-copy",
      runtimeEvent: "must-not-copy",
      nvidiaSkillId: "must-not-copy",
      canonicalObject: "must-not-copy",
      organisationId: "must-not-copy",
    };

    const profile = contracts.createSkillTechnicalProfile(draft);

    assert.deepEqual(Object.keys(profile), [
      "skillId",
      "technicalFingerprint",
      "declarationReference",
      "revisionReference",
      "artifactHash",
      "manifestReference",
      "sourceLocator",
      "support",
    ]);
    assert.equal(profile.sourceLocator, "skills/review/SKILL.md");
    assert.deepEqual(profile.technicalFingerprint, {
      algorithm: "SHA-256",
      schemaVersion: "skill-technical/v1",
      value: "resolved-skill-technical-state",
    });
    assert.deepEqual(profile.artifactHash, {
      algorithm: "SHA-256",
      value: "skill-package-integrity",
    });
    assert.equal(Object.hasOwn(profile.artifactHash, "schemaVersion"), false);
    assert.notEqual(profile.technicalFingerprint, fingerprint);
    assert.notEqual(profile.artifactHash, artifactHash);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.technicalFingerprint), true);
    assert.equal(Object.isFrozen(profile.artifactHash), true);
    assert.equal(Object.isFrozen(profile.support), true);
    assert.deepEqual(Object.keys(profile.support), [
      "technicalFingerprint",
      "declarationReference",
      "revisionReference",
      "artifactHash",
      "manifestReference",
      "sourceLocator",
    ]);
    for (const fieldSupport of Object.values(profile.support)) {
      assert.equal(Object.isFrozen(fieldSupport), true);
      assert.equal(Object.isFrozen(fieldSupport.assertionIds), true);
      assert.equal(Object.isFrozen(fieldSupport.evidenceIds), true);
    }
    assert.notEqual(
      profile.support.declarationReference,
      profile.support.artifactHash,
    );
    assert.deepEqual(profile.support.declarationReference.assertionIds, [
      "assertion:skill:declaration",
    ]);
    assert.deepEqual(profile.support.artifactHash.assertionIds, [
      "assertion:skill:artifact",
    ]);

    declarationSupport.assertionIds.push("assertion:input:mutated");
    artifactSupport.evidenceIds.push("evidence:input:mutated");
    assert.deepEqual(profile.support.declarationReference.assertionIds, [
      "assertion:skill:declaration",
    ]);
    assert.deepEqual(profile.support.artifactHash.evidenceIds, [
      "evidence:skill:artifact",
    ]);
    assert.equal(Object.isFrozen(draft), false);
    assert.equal(Object.isFrozen(support), false);

    for (const forbidden of [
      "content",
      "skillMd",
      "rawManifest",
      "scripts",
      "assets",
      "credentials",
      "token",
      "password",
      "apiKey",
      "privateKey",
      "signatureBlob",
      "evaluationDataset",
      "benchmarkResult",
      "risk",
      "limitations",
      "owner",
      "authorization",
      "runtimeEvent",
      "nvidiaSkillId",
      "canonicalObject",
      "organisationId",
    ]) {
      assert.equal(Object.hasOwn(profile, forbidden), false, forbidden);
    }
    assert.equal(Object.hasOwn(profile.support, "arbitraryField"), false);
  });

  it("omits absent optional Skill fields while retaining explicit empty support", () => {
    const profile = contracts.createSkillTechnicalProfile({
      skillId: contracts.asSkillId("skill:minimal"),
      technicalFingerprint: contracts.createTechnicalFingerprint({
        algorithm: "SHA-256",
        schemaVersion: "skill-technical/v1",
        value: "minimal-skill-state",
      }),
      declarationReference: undefined,
      revisionReference: undefined,
      artifactHash: undefined,
      manifestReference: undefined,
      sourceLocator: undefined,
      support: profileSupport(
        "technicalFingerprint",
        "declarationReference",
        "revisionReference",
        "artifactHash",
        "manifestReference",
        "sourceLocator",
      ),
    });

    assert.deepEqual(Object.keys(profile), [
      "skillId",
      "technicalFingerprint",
      "support",
    ]);
    assert.deepEqual(Object.keys(profile.support), [
      "technicalFingerprint",
      "declarationReference",
      "revisionReference",
      "artifactHash",
      "manifestReference",
      "sourceLocator",
    ]);
    for (const fieldSupport of Object.values(profile.support)) {
      assert.deepEqual(fieldSupport.assertionIds, []);
      assert.deepEqual(fieldSupport.evidenceIds, []);
    }
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

  it("exposes exactly the twelve governed relationship types", () => {
    assert.deepEqual(Object.values(contracts.GOVERNED_RELATIONSHIP_TYPE), [
      "USES_MODEL",
      "USES_TOOL",
      "USES_MCP",
      "INVOKES",
      "USES_PROMPT",
      "USES_KNOWLEDGE_BASE",
      "USES_SKILL",
      "EXPOSES",
      "HANDOFF_TO",
      "READS_FROM",
      "WRITES_TO",
      "DERIVED_FROM",
    ]);
    for (const forbidden of [
      "CONTAINS",
      "HAS_SKILL",
      "EXECUTES_SKILL",
      "HANDOFF_TO_VERSION",
      "USES_DATA",
      "CALLS",
      "DEPENDS_ON",
    ]) {
      assert.equal(
        Object.values(contracts.GOVERNED_RELATIONSHIP_TYPE).includes(forbidden),
        false,
        forbidden,
      );
    }
    assert.equal(Object.values(contracts.CANONICAL_OBJECT_KIND).length, 11);
    assert.equal(
      Object.values(contracts.CANONICAL_OBJECT_KIND).includes("RELATIONSHIP"),
      false,
    );
  });

  it("creates all twelve valid endpoint combinations through explicit decisions", () => {
    const ids = relationshipIdentities();
    const fingerprint = contracts.createTechnicalFingerprint({
      algorithm: "SHA-256",
      schemaVersion: "technical-profile/v1",
      value: "pinned-target-state",
    });
    const behavior = (type, target) =>
      relationshipStateDraft({
        type,
        source: ids.agentVersion,
        target,
        support: behaviorBindingSupport(),
        boundTechnicalFingerprint: fingerprint,
      });
    const drafts = [
      behavior("USES_MODEL", ids.model),
      behavior("USES_TOOL", ids.tool),
      behavior("USES_MCP", ids.mcpServer),
      behavior("INVOKES", ids.api),
      behavior("USES_PROMPT", ids.prompt),
      behavior("USES_KNOWLEDGE_BASE", ids.knowledgeBase),
      behavior("USES_SKILL", ids.skill),
      relationshipStateDraft({
        type: "EXPOSES",
        source: ids.mcpServer,
        target: ids.tool,
      }),
      relationshipStateDraft({
        type: "HANDOFF_TO",
        source: ids.agentVersion,
        target: ids.agent,
      }),
      relationshipStateDraft({
        type: "READS_FROM",
        source: ids.agentVersion,
        target: ids.dataAsset,
      }),
      relationshipStateDraft({
        type: "WRITES_TO",
        source: ids.agentVersion,
        target: ids.dataElement,
      }),
      relationshipStateDraft({
        type: "DERIVED_FROM",
        source: ids.dataElement,
        target: ids.originDataElement,
      }),
    ];

    const relationships = drafts.map(
      (draft) => approveRelationship(draft).relationship,
    );
    assert.deepEqual(
      relationships.map(({ relationshipType }) => relationshipType),
      Object.values(contracts.GOVERNED_RELATIONSHIP_TYPE),
    );
    for (const relationship of relationships) {
      assert.equal(Object.isFrozen(relationship), true);
      assert.equal(Object.isFrozen(relationship.source), true);
      assert.equal(Object.isFrozen(relationship.target), true);
      assert.equal(Object.isFrozen(relationship.support), true);
      assert.equal(
        relationship.source.canonicalObject.organisationId,
        relationship.organisationId,
      );
      assert.equal(
        relationship.target.canonicalObject.organisationId,
        relationship.organisationId,
      );
    }
    for (const binding of relationships.slice(0, 7)) {
      assert.deepEqual(binding.boundTechnicalFingerprint, fingerprint);
      assert.notEqual(binding.boundTechnicalFingerprint, fingerprint);
      assert.equal(Object.isFrozen(binding.boundTechnicalFingerprint), true);
    }
    const usesSkill = relationships[6];
    assert.equal(usesSkill.relationshipType, "USES_SKILL");
    assert.equal(usesSkill.target.canonicalObject.kind, "SKILL");
    assert.equal(usesSkill.target.skillId, ids.skill.skillId);
  });

  it("accepts both DataAsset and DataElement access without adding fingerprints", () => {
    const ids = relationshipIdentities();
    for (const relationshipType of ["READS_FROM", "WRITES_TO"]) {
      for (const target of [ids.dataAsset, ids.dataElement]) {
        const { relationship } = approveRelationship(
          relationshipStateDraft({
            type: relationshipType,
            source: ids.agentVersion,
            target,
            id: `relationship:${relationshipType}:${target.canonicalObject.kind}`,
            stateId: `state:${relationshipType}:${target.canonicalObject.kind}`,
          }),
        );
        assert.equal(relationship.target.canonicalObject.kind, target.canonicalObject.kind);
        assert.equal(
          Object.hasOwn(relationship, "boundTechnicalFingerprint"),
          false,
        );
      }
    }

    const handoff = approveRelationship(
      relationshipStateDraft({
        type: "HANDOFF_TO",
        source: ids.agentVersion,
        target: ids.agent,
      }),
    ).relationship;
    const exposes = approveRelationship(
      relationshipStateDraft({
        type: "EXPOSES",
        source: ids.mcpServer,
        target: ids.tool,
      }),
    ).relationship;
    assert.equal(handoff.target.canonicalObject.kind, "AGENT");
    assert.equal(exposes.source.canonicalObject.kind, "MCP_SERVER");
    assert.equal(exposes.target.canonicalObject.kind, "TOOL");
  });

  it("rejects invalid endpoint combinations fail closed", () => {
    const ids = relationshipIdentities();
    const fingerprint = contracts.createTechnicalFingerprint({
      algorithm: "SHA-256",
      schemaVersion: "technical-profile/v1",
      value: "target-state",
    });
    const invalidDrafts = [
      relationshipStateDraft({
        type: "USES_MODEL",
        source: ids.agentVersion,
        target: ids.tool,
        support: behaviorBindingSupport(),
        boundTechnicalFingerprint: fingerprint,
      }),
      relationshipStateDraft({
        type: "HANDOFF_TO",
        source: ids.agentVersion,
        target: ids.agentVersion,
      }),
      relationshipStateDraft({
        type: "EXPOSES",
        source: ids.agent,
        target: ids.tool,
      }),
      relationshipStateDraft({
        type: "EXPOSES",
        source: ids.mcpServer,
        target: ids.dataAsset,
      }),
      relationshipStateDraft({
        type: "DERIVED_FROM",
        source: ids.dataAsset,
        target: ids.dataElement,
      }),
    ];

    for (const draft of invalidDrafts) {
      assert.throws(
        () => approveRelationship(draft),
        /source must be|target must be/,
      );
    }
  });

  it("requires a pinned TechnicalFingerprint for every behavior binding", () => {
    const ids = relationshipIdentities();
    const behaviorTargets = [
      ["USES_MODEL", ids.model],
      ["USES_TOOL", ids.tool],
      ["USES_MCP", ids.mcpServer],
      ["INVOKES", ids.api],
      ["USES_PROMPT", ids.prompt],
      ["USES_KNOWLEDGE_BASE", ids.knowledgeBase],
      ["USES_SKILL", ids.skill],
    ];
    for (const [type, target] of behaviorTargets) {
      const draft = relationshipStateDraft({
        type,
        source: ids.agentVersion,
        target,
        support: behaviorBindingSupport(),
      });
      assert.throws(
        () => approveRelationship(draft),
        /Bound technical fingerprint must be an object/,
        type,
      );
    }
  });

  it("keeps parallel logical relationships distinct despite duplicate signals", () => {
    const ids = relationshipIdentities();
    const first = approveRelationship(
      relationshipStateDraft({
        type: "HANDOFF_TO",
        source: ids.agentVersion,
        target: ids.agent,
        id: "relationship:parallel:one",
        stateId: "state:parallel:one",
      }),
    ).relationship;
    const second = approveRelationship(
      relationshipStateDraft({
        type: "HANDOFF_TO",
        source: ids.agentVersion,
        target: ids.agent,
        id: "relationship:parallel:two",
        stateId: "state:parallel:two",
      }),
    ).relationship;

    assert.notEqual(first.relationshipId, second.relationshipId);
    assert.equal(first.relationshipType, second.relationshipType);
    assert.deepEqual(first.source, second.source);
    assert.deepEqual(first.target, second.target);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(second), true);
  });

  it("keeps relationship reconciliation outcomes explicit and auditable", () => {
    const ids = relationshipIdentities();
    const draft = relationshipStateDraft({
      type: "HANDOFF_TO",
      source: ids.agentVersion,
      target: ids.agent,
    });
    const { decision, relationship } = approveRelationship(draft);
    assert.equal(decision.outcome, "CREATE_NEW");
    assert.equal(decision.authorizedState.relationshipId, draft.relationshipId);
    assert.equal(
      decision.authorizedState.relationshipStateId,
      draft.relationshipStateId,
    );
    assert.equal(Object.isFrozen(decision), true);
    assert.equal(Object.isFrozen(decision.assertionIds), true);
    assert.equal(Object.isFrozen(decision.evidenceIds), true);

    const changedState = {
      ...draft,
      relationshipStateId: contracts.asRelationshipStateId("state:changed"),
    };
    assert.throws(
      () => contracts.createGovernedRelationship(decision, changedState),
      /does not match CREATE_NEW authorization/,
    );

    const matchCandidate = relationshipCandidateFor(draft, {
      candidateId: "candidate:relationship:match",
    });
    const match = contracts.createRelationshipReconciliationDecision({
      decisionId: contracts.asReconciliationDecisionId("decision:match"),
      organisationId: ids.organisationId,
      relationshipCandidateId: matchCandidate.candidateId,
      relationshipCandidate: matchCandidate,
      outcome: "MATCH_EXISTING",
      authority: {
        authorityKind: "DETERMINISTIC_RULE",
        ruleCode: "CONFIRMED_MAPPING",
        ruleVersion: "1",
      },
      reasonCode: "CONFIRMED_MAPPING",
      assertionIds: [],
      evidenceIds: [],
      decidedAt: reconciliationTimestamp,
      matchedState: {
        relationshipId: relationship.relationshipId,
        relationshipStateId: relationship.relationshipStateId,
        organisationId: relationship.organisationId,
        relationshipType: relationship.relationshipType,
        source: relationship.source,
        target: relationship.target,
      },
    });
    assert.equal(match.outcome, "MATCH_EXISTING");
    assert.equal(match.matchedState.relationshipId, relationship.relationshipId);
    assert.equal(
      match.matchedState.relationshipStateId,
      relationship.relationshipStateId,
    );
    assert.equal(Object.hasOwn(match, "authorizedState"), false);

    for (const outcome of ["REJECT", "DEFER"]) {
      const candidateId = `candidate:${outcome.toLowerCase()}`;
      const relationshipCandidate = relationshipCandidateFor(draft, {
        candidateId,
        relationshipTypeCode: "SOURCE_USES_TARGET",
      });
      const negativeDecision = contracts.createRelationshipReconciliationDecision({
        decisionId: contracts.asReconciliationDecisionId(
          `decision:${outcome.toLowerCase()}`,
        ),
        organisationId: ids.organisationId,
        relationshipCandidateId: relationshipCandidate.candidateId,
        relationshipCandidate,
        outcome,
        authority: { authorityKind: "HUMAN", actorReference: "reviewer:one" },
        reasonCode: outcome,
        assertionIds: [],
        evidenceIds: [],
        decidedAt: reconciliationTimestamp,
      });
      assert.equal(negativeDecision.outcome, outcome);
      assert.equal(
        negativeDecision.relationshipTypeCode,
        "SOURCE_USES_TARGET",
      );
      assert.equal(Object.hasOwn(negativeDecision, "relationshipId"), false);
      assert.equal(
        Object.hasOwn(negativeDecision, "relationshipStateId"),
        false,
      );
      assert.equal(Object.hasOwn(negativeDecision, "authorizedState"), false);
      assert.equal(Object.hasOwn(negativeDecision, "matchedState"), false);
      assert.throws(
        () =>
          contracts.createGovernedRelationship(negativeDecision, draft),
        /requires an approved CREATE_NEW decision/,
      );
    }
  });

  it("binds successful decisions to the exact relationship candidate type", () => {
    const ids = relationshipIdentities();
    const draft = relationshipStateDraft({
      type: "USES_MODEL",
      source: ids.agentVersion,
      target: ids.model,
      support: behaviorBindingSupport(),
      boundTechnicalFingerprint: contracts.createTechnicalFingerprint({
        algorithm: "SHA-256",
        schemaVersion: "technical-profile/v1",
        value: "model-state",
      }),
    });
    const candidate = relationshipCandidateFor(draft, {
      candidateId: "candidate:type-binding:exact",
    });
    const decisionBase = (relationshipCandidate, suffix) => ({
      decisionId: contracts.asReconciliationDecisionId(
        `decision:type-binding:${suffix}`,
      ),
      organisationId: ids.organisationId,
      relationshipCandidateId: relationshipCandidate.candidateId,
      relationshipCandidate,
      authority: { authorityKind: "HUMAN", actorReference: "reviewer:one" },
      reasonCode: "TYPE_NORMALIZED",
      assertionIds: [],
      evidenceIds: [],
      decidedAt: reconciliationTimestamp,
    });

    const createDecision = contracts.createRelationshipReconciliationDecision({
      ...decisionBase(candidate, "create"),
      outcome: "CREATE_NEW",
      authorizedState: draft,
    });
    assert.equal(createDecision.relationshipTypeCode, "USES_MODEL");
    assert.equal(createDecision.authorizedState.relationshipType, "USES_MODEL");
    assert.equal(Object.hasOwn(createDecision, "relationshipCandidate"), false);
    assert.equal(
      contracts.createGovernedRelationship(createDecision, draft)
        .relationshipType,
      "USES_MODEL",
    );

    const matchedState = {
      relationshipId: draft.relationshipId,
      relationshipStateId: draft.relationshipStateId,
      organisationId: draft.organisationId,
      relationshipType: draft.relationshipType,
      source: draft.source,
      target: draft.target,
    };
    const matchDecision = contracts.createRelationshipReconciliationDecision({
      ...decisionBase(candidate, "match"),
      outcome: "MATCH_EXISTING",
      matchedState,
    });
    assert.equal(matchDecision.relationshipTypeCode, "USES_MODEL");
    assert.equal(matchDecision.matchedState.relationshipType, "USES_MODEL");

    for (const relationshipTypeCode of [
      "SOURCE_USES_TARGET",
      "USES_TOOL",
    ]) {
      const nonCanonicalCandidate = relationshipCandidateFor(draft, {
        candidateId: `candidate:type-binding:${relationshipTypeCode}`,
        relationshipTypeCode,
      });
      assert.throws(
        () =>
          contracts.createRelationshipReconciliationDecision({
            ...decisionBase(nonCanonicalCandidate, `create:${relationshipTypeCode}`),
            outcome: "CREATE_NEW",
            authorizedState: draft,
          }),
        /exact canonical relationship type code/,
      );
      assert.throws(
        () =>
          contracts.createRelationshipReconciliationDecision({
            ...decisionBase(nonCanonicalCandidate, `match:${relationshipTypeCode}`),
            outcome: "MATCH_EXISTING",
            matchedState,
          }),
        /exact canonical relationship type code/,
      );
    }

    const unknownCandidate = relationshipCandidateFor(draft, {
      candidateId: "candidate:type-binding:unknown",
      relationshipTypeCode: "SOURCE_USES_TARGET",
    });
    for (const outcome of ["REJECT", "DEFER"]) {
      const negativeDecision =
        contracts.createRelationshipReconciliationDecision({
          ...decisionBase(unknownCandidate, outcome.toLowerCase()),
          outcome,
        });
      assert.equal(negativeDecision.relationshipTypeCode, "SOURCE_USES_TARGET");
      assert.equal(Object.hasOwn(negativeDecision, "authorizedState"), false);
      assert.equal(Object.hasOwn(negativeDecision, "matchedState"), false);
    }

    assert.throws(
      () =>
        contracts.createRelationshipReconciliationDecision({
          ...decisionBase(candidate, "candidate-id-mismatch"),
          relationshipCandidateId: contracts.asNormalizedCandidateId(
            "candidate:type-binding:different",
          ),
          outcome: "REJECT",
        }),
      /candidate ID must match validation context/,
    );
    const wrongKindCandidate = relationshipCandidateFor(draft, {
      candidateId: "candidate:type-binding:wrong-kind",
      candidateKind: "MODEL",
    });
    assert.throws(
      () =>
        contracts.createRelationshipReconciliationDecision({
          ...decisionBase(wrongKindCandidate, "wrong-kind"),
          outcome: "REJECT",
        }),
      /must have kind RELATIONSHIP/,
    );
  });

  it("rehydrates the complete decision envelope across runtime boundaries", () => {
    const ids = relationshipIdentities();
    const draft = relationshipStateDraft({
      type: "HANDOFF_TO",
      source: ids.agentVersion,
      target: ids.agent,
      support: relationshipSupport(
        ["assertion:state:b", "assertion:state:a"],
        ["evidence:state:b", "evidence:state:a"],
      ),
    });
    const { decision } = approveRelationship(draft);
    const serialized = JSON.parse(JSON.stringify(decision));
    const rehydrated =
      contracts.rehydrateRelationshipReconciliationDecision(serialized);

    assert.equal(Object.isFrozen(rehydrated), true);
    assert.equal(Object.isFrozen(rehydrated.authority), true);
    assert.equal(Object.isFrozen(rehydrated.assertionIds), true);
    assert.equal(Object.isFrozen(rehydrated.evidenceIds), true);
    assert.equal(Object.isFrozen(rehydrated.authorizedState), true);
    assert.equal(
      contracts.createGovernedRelationship(decision, draft).relationshipId,
      draft.relationshipId,
    );
    assert.equal(
      contracts.createGovernedRelationship(serialized, draft).relationshipId,
      draft.relationshipId,
    );

    for (const field of [
      "decisionId",
      "relationshipCandidateId",
      "relationshipTypeCode",
      "outcome",
      "authority",
      "reasonCode",
      "decidedAt",
      "authorizedState",
    ]) {
      const forged = { ...serialized };
      delete forged[field];
      assert.throws(
        () => contracts.createGovernedRelationship(forged, draft),
        TypeError,
        `missing ${field}`,
      );
    }

    assert.throws(
      () =>
        contracts.createGovernedRelationship(
          {
            ...serialized,
            authority: { authorityKind: "AI", actorReference: "model:one" },
          },
          draft,
        ),
      /Unknown reconciliation authority/,
    );
    for (const malformedProvenance of [
      { assertionIds: "assertion:not-an-array" },
      { evidenceIds: "evidence:not-an-array" },
      { assertionIds: [""] },
      { evidenceIds: [""] },
    ]) {
      assert.throws(
        () =>
          contracts.createGovernedRelationship(
            { ...serialized, ...malformedProvenance },
            draft,
          ),
        TypeError,
      );
    }
    for (const relationshipTypeCode of [
      "SOURCE_USES_TARGET",
      "USES_MODEL",
    ]) {
      assert.throws(
        () =>
          contracts.createGovernedRelationship(
            { ...serialized, relationshipTypeCode },
            draft,
          ),
        /exact canonical relationship type code/,
      );
    }

    const candidate = relationshipCandidateFor(draft, {
      candidateId: "candidate:rehydration:other-outcomes",
    });
    const base = {
      decisionId: contracts.asReconciliationDecisionId(
        "decision:rehydration:other-outcomes",
      ),
      organisationId: ids.organisationId,
      relationshipCandidateId: candidate.candidateId,
      relationshipCandidate: candidate,
      authority: { authorityKind: "HUMAN", actorReference: "reviewer:one" },
      reasonCode: "REVIEWED",
      assertionIds: [],
      evidenceIds: [],
      decidedAt: reconciliationTimestamp,
    };
    const matchedState = {
      relationshipId: draft.relationshipId,
      relationshipStateId: draft.relationshipStateId,
      organisationId: draft.organisationId,
      relationshipType: draft.relationshipType,
      source: draft.source,
      target: draft.target,
    };
    const nonCreateDecisions = [
      contracts.createRelationshipReconciliationDecision({
        ...base,
        outcome: "MATCH_EXISTING",
        matchedState,
      }),
      contracts.createRelationshipReconciliationDecision({
        ...base,
        outcome: "REJECT",
      }),
      contracts.createRelationshipReconciliationDecision({
        ...base,
        outcome: "DEFER",
      }),
    ];
    for (const nonCreateDecision of nonCreateDecisions) {
      assert.throws(
        () => contracts.createGovernedRelationship(nonCreateDecision, draft),
        /requires an approved CREATE_NEW decision/,
      );
    }
    assert.throws(
      () =>
        contracts.rehydrateRelationshipReconciliationDecision({
          ...JSON.parse(JSON.stringify(nonCreateDecisions[1])),
          authorizedState: draft,
        }),
      /cannot reference relationship state/,
    );
  });

  it("rejects candidate bypasses, unknown taxonomy, IDs on negative outcomes, and AI authority", () => {
    const ids = relationshipIdentities();
    const validDraft = relationshipStateDraft({
      type: "HANDOFF_TO",
      source: ids.agentVersion,
      target: ids.agent,
    });
    const candidate = {
      ...objectCandidate(
        "RELATIONSHIP",
        "candidate:relationship:bypass",
        sourceObjectIdentity("connection:relationship", "external:relationship"),
      ),
      relationshipTypeCode: "HANDOFF_TO",
      sourceEndpoint: {
        referenceKind: "CANDIDATE",
        candidateId: contracts.asNormalizedCandidateId("candidate:source"),
        candidateKind: "AGENT_VERSION",
      },
      targetEndpoint: {
        referenceKind: "CANDIDATE",
        candidateId: contracts.asNormalizedCandidateId("candidate:target"),
        candidateKind: "AGENT",
      },
    };
    assert.throws(
      () => contracts.createGovernedRelationship(candidate, validDraft),
      /Unknown relationship reconciliation outcome/,
    );

    const decisionBase = {
      decisionId: contracts.asReconciliationDecisionId("decision:invalid"),
      organisationId: ids.organisationId,
      relationshipCandidateId: candidate.candidateId,
      relationshipCandidate: candidate,
      authority: { authorityKind: "HUMAN", actorReference: "reviewer:one" },
      reasonCode: "REVIEW",
      assertionIds: [],
      evidenceIds: [],
      decidedAt: reconciliationTimestamp,
    };
    assert.throws(
      () =>
        contracts.createRelationshipReconciliationDecision({
          ...decisionBase,
          outcome: "CREATE_NEW",
          authorizedState: {
            ...validDraft,
            relationshipType: "CALLS",
          },
        }),
      /Unknown governed relationship type/,
    );
    assert.throws(
      () =>
        contracts.createRelationshipReconciliationDecision({
          ...decisionBase,
          outcome: "MATCH_EXISTING",
          matchedState: {
            relationshipId: validDraft.relationshipId,
            relationshipStateId: validDraft.relationshipStateId,
            organisationId: ids.organisationId,
            relationshipType: "CALLS",
            source: ids.agentVersion,
            target: ids.agent,
          },
        }),
      /Unknown governed relationship type/,
    );
    for (const outcome of ["REJECT", "DEFER"]) {
      assert.throws(
        () =>
          contracts.createRelationshipReconciliationDecision({
            ...decisionBase,
            outcome,
            relationshipId: validDraft.relationshipId,
          }),
        /cannot reference relationship state/,
      );
    }
    assert.throws(
      () =>
        contracts.createRelationshipReconciliationDecision({
          ...decisionBase,
          outcome: "REJECT",
          authority: { authorityKind: "AI", actorReference: "model:one" },
        }),
      /Unknown reconciliation authority/,
    );
  });

  it("fails closed when relationship, source, target, or decision tenants differ", () => {
    const ids = relationshipIdentities();
    const other = relationshipIdentities(
      contracts.asOrganisationId("organisation:other"),
    );
    const sourceMismatch = relationshipStateDraft({
      type: "HANDOFF_TO",
      source: other.agentVersion,
      target: ids.agent,
    });
    const targetMismatch = {
      ...relationshipStateDraft({
        type: "HANDOFF_TO",
        source: ids.agentVersion,
        target: other.agent,
      }),
      organisationId: ids.organisationId,
    };
    assert.throws(
      () => approveRelationship(sourceMismatch),
      /tenant must match both canonical endpoints/,
    );
    assert.throws(
      () => approveRelationship(targetMismatch),
      /tenant must match both canonical endpoints/,
    );

    const valid = relationshipStateDraft({
      type: "HANDOFF_TO",
      source: ids.agentVersion,
      target: ids.agent,
    });
    const relationshipCandidate = relationshipCandidateFor(valid, {
      candidateId: "candidate:tenant:mismatch",
    });
    assert.throws(
      () =>
        contracts.createRelationshipReconciliationDecision({
          decisionId: contracts.asReconciliationDecisionId(
            "decision:tenant:mismatch",
          ),
          organisationId: other.organisationId,
          relationshipCandidateId: relationshipCandidate.candidateId,
          relationshipCandidate,
          outcome: "CREATE_NEW",
          authority: { authorityKind: "HUMAN", actorReference: "reviewer:one" },
          reasonCode: "REVIEW",
          assertionIds: [],
          evidenceIds: [],
          decidedAt: reconciliationTimestamp,
          authorizedState: valid,
        }),
      /decision tenant must match authorized state/,
    );
  });

  it("deep-freezes independent binding support and sanitized configuration", () => {
    const ids = relationshipIdentities();
    const fingerprint = contracts.createTechnicalFingerprint({
      algorithm: "SHA-256",
      schemaVersion: "technical-profile/v1",
      value: "skill-pinned-state",
    });
    const relationshipExistence = relationshipSupport(
      ["assertion:existence"],
      ["evidence:existence"],
    );
    const fingerprintSupport = relationshipSupport(
      ["assertion:fingerprint"],
      ["evidence:fingerprint"],
    );
    const configHashSupport = relationshipSupport(["assertion:config:hash"]);
    const configLocatorSupport = relationshipSupport(
      [],
      ["evidence:config:locator"],
    );
    const configurationHash = {
      algorithm: "SHA-256",
      value: "binding-config-integrity",
    };
    const draft = relationshipStateDraft({
      type: "USES_SKILL",
      source: ids.agentVersion,
      target: ids.skill,
      support: {
        relationship: relationshipExistence,
        boundTechnicalFingerprint: fingerprintSupport,
        bindingConfiguration: {
          configurationHash: configHashSupport,
          configurationLocator: configLocatorSupport,
          arbitrarySupport: relationshipSupport(["assertion:must-not-copy"]),
        },
        arbitrarySupport: relationshipSupport(["assertion:must-not-copy"]),
      },
      boundTechnicalFingerprint: fingerprint,
      bindingConfiguration: {
        configurationHash,
        configurationLocator: contracts.sanitizeTechnicalLocator(
          "bindings/skill.yaml",
        ),
        parameters: { arbitrary: true },
        rawConfiguration: "must-not-copy",
      },
      trustState: "VALIDATED",
      confidence: 1,
      credentials: "must-not-copy",
    });
    const relationship = approveRelationship(draft).relationship;

    assert.equal(Object.isFrozen(relationship.support), true);
    assert.equal(Object.isFrozen(relationship.support.relationship), true);
    assert.equal(
      Object.isFrozen(relationship.support.relationship.assertionIds),
      true,
    );
    assert.equal(
      Object.isFrozen(relationship.support.bindingConfiguration),
      true,
    );
    assert.notEqual(
      relationship.support.relationship,
      relationship.support.boundTechnicalFingerprint,
    );
    assert.notEqual(
      relationship.support.bindingConfiguration.configurationHash,
      relationship.support.bindingConfiguration.configurationLocator,
    );
    assert.deepEqual(relationship.support.relationship.assertionIds, [
      "assertion:existence",
    ]);
    assert.deepEqual(
      relationship.support.boundTechnicalFingerprint.assertionIds,
      ["assertion:fingerprint"],
    );
    assert.equal(Object.isFrozen(relationship.bindingConfiguration), true);
    assert.equal(
      Object.isFrozen(relationship.bindingConfiguration.configurationHash),
      true,
    );
    assert.notEqual(
      relationship.bindingConfiguration.configurationHash,
      configurationHash,
    );
    assert.equal(
      relationship.bindingConfiguration.configurationLocator,
      "bindings/skill.yaml",
    );
    for (const forbidden of [
      "parameters",
      "rawConfiguration",
    ]) {
      assert.equal(
        Object.hasOwn(relationship.bindingConfiguration, forbidden),
        false,
      );
    }
    for (const forbidden of [
      "trustState",
      "confidence",
      "credentials",
    ]) {
      assert.equal(Object.hasOwn(relationship, forbidden), false, forbidden);
    }
    assert.equal(Object.hasOwn(relationship.support, "arbitrarySupport"), false);
    assert.equal(
      Object.hasOwn(
        relationship.support.bindingConfiguration,
        "arbitrarySupport",
      ),
      false,
    );

    relationshipExistence.assertionIds.push("assertion:mutated");
    fingerprintSupport.evidenceIds.push("evidence:mutated");
    assert.deepEqual(relationship.support.relationship.assertionIds, [
      "assertion:existence",
    ]);
    assert.deepEqual(
      relationship.support.boundTechnicalFingerprint.evidenceIds,
      ["evidence:fingerprint"],
    );

    const absentConfiguration = approveRelationship(
      relationshipStateDraft({
        type: "USES_SKILL",
        source: ids.agentVersion,
        target: ids.skill,
        id: "relationship:skill:no-config",
        stateId: "state:skill:no-config",
        support: behaviorBindingSupport(),
        boundTechnicalFingerprint: fingerprint,
      }),
    ).relationship;
    assert.equal(Object.hasOwn(absentConfiguration, "bindingConfiguration"), false);
    assert.deepEqual(
      absentConfiguration.support.bindingConfiguration.configurationHash
        .assertionIds,
      ["assertion:configuration:hash"],
    );
  });

  it("normalizes relationship support as immutable deterministic ID sets", () => {
    const ids = relationshipIdentities();
    const assertionIds = [
      contracts.asSourceAssertionId("assertion:b"),
      contracts.asSourceAssertionId("assertion:a"),
      contracts.asSourceAssertionId("assertion:b"),
    ];
    const evidenceIds = [
      contracts.asEvidenceId("evidence:b"),
      contracts.asEvidenceId("evidence:a"),
      contracts.asEvidenceId("evidence:b"),
    ];
    const support = { assertionIds, evidenceIds };
    const originalAssertions = [...assertionIds];
    const originalEvidence = [...evidenceIds];
    const draft = relationshipStateDraft({
      type: "HANDOFF_TO",
      source: ids.agentVersion,
      target: ids.agent,
      support,
    });
    const { decision, relationship } = approveRelationship(draft, {
      decisionAssertionIds: ["assertion:decision:b", "assertion:decision:a", "assertion:decision:b"],
      decisionEvidenceIds: ["evidence:decision:b", "evidence:decision:a", "evidence:decision:b"],
    });

    assert.deepEqual(relationship.support.assertionIds, [
      "assertion:a",
      "assertion:b",
    ]);
    assert.deepEqual(relationship.support.evidenceIds, [
      "evidence:a",
      "evidence:b",
    ]);
    assert.deepEqual(decision.assertionIds, [
      "assertion:decision:a",
      "assertion:decision:b",
    ]);
    assert.deepEqual(decision.evidenceIds, [
      "evidence:decision:a",
      "evidence:decision:b",
    ]);
    assert.deepEqual(assertionIds, originalAssertions);
    assert.deepEqual(evidenceIds, originalEvidence);
    assert.equal(Object.isFrozen(relationship.support), true);
    assert.equal(Object.isFrozen(relationship.support.assertionIds), true);
    assert.equal(Object.isFrozen(relationship.support.evidenceIds), true);

    assertionIds.push(contracts.asSourceAssertionId("assertion:later"));
    evidenceIds.push(contracts.asEvidenceId("evidence:later"));
    assert.deepEqual(relationship.support.assertionIds, [
      "assertion:a",
      "assertion:b",
    ]);
    assert.deepEqual(relationship.support.evidenceIds, [
      "evidence:a",
      "evidence:b",
    ]);

    const behaviorSupport = {
      relationship: relationshipSupport(
        ["assertion:relationship:b", "assertion:relationship:a", "assertion:relationship:b"],
        ["evidence:relationship:b", "evidence:relationship:a"],
      ),
      boundTechnicalFingerprint: relationshipSupport(
        ["assertion:fingerprint:b", "assertion:fingerprint:a"],
        ["evidence:fingerprint:b", "evidence:fingerprint:a", "evidence:fingerprint:b"],
      ),
      bindingConfiguration: {
        configurationHash: relationshipSupport(
          ["assertion:config:b", "assertion:config:a", "assertion:config:b"],
        ),
        configurationLocator: relationshipSupport(
          [],
          ["evidence:locator:b", "evidence:locator:a", "evidence:locator:b"],
        ),
      },
    };
    const behavior = approveRelationship(
      relationshipStateDraft({
        type: "USES_SKILL",
        source: ids.agentVersion,
        target: ids.skill,
        id: "relationship:support:behavior",
        stateId: "state:support:behavior",
        support: behaviorSupport,
        boundTechnicalFingerprint: contracts.createTechnicalFingerprint({
          algorithm: "SHA-256",
          schemaVersion: "technical-profile/v1",
          value: "skill-state",
        }),
      }),
    ).relationship;
    assert.deepEqual(behavior.support.relationship.assertionIds, [
      "assertion:relationship:a",
      "assertion:relationship:b",
    ]);
    assert.deepEqual(
      behavior.support.boundTechnicalFingerprint.evidenceIds,
      ["evidence:fingerprint:a", "evidence:fingerprint:b"],
    );
    assert.deepEqual(
      behavior.support.bindingConfiguration.configurationHash.assertionIds,
      ["assertion:config:a", "assertion:config:b"],
    );
    assert.deepEqual(
      behavior.support.bindingConfiguration.configurationLocator.evidenceIds,
      ["evidence:locator:a", "evidence:locator:b"],
    );

    const lineageSupport = {
      reference: relationshipSupport(
        ["assertion:lineage:b", "assertion:lineage:a", "assertion:lineage:b"],
      ),
      hash: relationshipSupport(
        [],
        ["evidence:lineage:b", "evidence:lineage:a", "evidence:lineage:b"],
      ),
    };
    const lineage = approveRelationship(
      relationshipStateDraft({
        type: "DERIVED_FROM",
        source: ids.dataElement,
        target: ids.originDataElement,
        id: "relationship:support:lineage",
        stateId: "state:support:lineage",
        transformation: {
          reference: contracts.sanitizeTechnicalLocator("transform.sql"),
          support: lineageSupport,
        },
      }),
    ).relationship;
    assert.deepEqual(lineage.transformation.support.reference.assertionIds, [
      "assertion:lineage:a",
      "assertion:lineage:b",
    ]);
    assert.deepEqual(lineage.transformation.support.hash.evidenceIds, [
      "evidence:lineage:a",
      "evidence:lineage:b",
    ]);
    assert.equal(Object.isFrozen(lineage.transformation.support), true);
  });

  it("compares normalized relationship states by explicit semantic fields", () => {
    const ids = relationshipIdentities();
    const authorizedDraft = relationshipStateDraft({
      type: "HANDOFF_TO",
      source: ids.agentVersion,
      target: ids.agent,
      id: "relationship:semantic",
      stateId: "state:semantic",
      support: relationshipSupport(
        ["assertion:b", "assertion:a"],
        ["evidence:b", "evidence:a"],
      ),
    });
    const { decision } = approveRelationship(authorizedDraft);
    const reorderedAndWidened = {
      ...authorizedDraft,
      support: relationshipSupport(
        ["assertion:a", "assertion:b", "assertion:a"],
        ["evidence:a", "evidence:b", "evidence:a"],
      ),
      arbitraryMetadata: { ignored: true },
      secret: "must-not-copy",
    };
    const equivalent = contracts.createGovernedRelationship(
      decision,
      reorderedAndWidened,
    );
    assert.deepEqual(equivalent.support.assertionIds, [
      "assertion:a",
      "assertion:b",
    ]);
    assert.deepEqual(equivalent.support.evidenceIds, [
      "evidence:a",
      "evidence:b",
    ]);
    assert.equal(Object.hasOwn(equivalent, "arbitraryMetadata"), false);
    assert.equal(Object.hasOwn(equivalent, "secret"), false);

    assert.throws(
      () =>
        contracts.createGovernedRelationship(decision, {
          ...authorizedDraft,
          support: relationshipSupport(
            ["assertion:a", "assertion:different"],
            ["evidence:a", "evidence:b"],
          ),
        }),
      /does not match CREATE_NEW authorization/,
    );
    const differentTarget = {
      ...ids.agent,
      canonicalObject: {
        ...ids.agent.canonicalObject,
        objectId: contracts.asCanonicalObjectId("canonical:agent:different"),
      },
      agentId: contracts.asAgentId("agent:different"),
      agentCode: "DIFFERENT_AGENT",
    };
    assert.throws(
      () =>
        contracts.createGovernedRelationship(decision, {
          ...authorizedDraft,
          target: differentTarget,
        }),
      /does not match CREATE_NEW authorization/,
    );
    assert.throws(
      () =>
        contracts.createGovernedRelationship(decision, {
          ...authorizedDraft,
          validTo: contracts.asIsoTimestamp("2026-09-01T00:00:00.000Z"),
        }),
      /does not match CREATE_NEW authorization/,
    );
    assert.throws(
      () =>
        contracts.createGovernedRelationship(decision, {
          ...authorizedDraft,
          relationshipStateId: contracts.asRelationshipStateId(
            "state:semantic:different",
          ),
        }),
      /does not match CREATE_NEW authorization/,
    );
  });

  it("compares behavior bindings and lineage with nested semantic support", () => {
    const ids = relationshipIdentities();
    const fingerprint = contracts.createTechnicalFingerprint({
      algorithm: "SHA-256",
      schemaVersion: "technical-profile/v1",
      value: "behavior:one",
    });
    const behaviorSupport = {
      relationship: relationshipSupport(
        ["assertion:relationship:b", "assertion:relationship:a"],
      ),
      boundTechnicalFingerprint: relationshipSupport(
        [],
        ["evidence:fingerprint:b", "evidence:fingerprint:a"],
      ),
      bindingConfiguration: {
        configurationHash: relationshipSupport(
          ["assertion:config:b", "assertion:config:a"],
        ),
        configurationLocator: relationshipSupport(
          [],
          ["evidence:locator:b", "evidence:locator:a"],
        ),
      },
    };
    const behaviorDraft = relationshipStateDraft({
      type: "USES_SKILL",
      source: ids.agentVersion,
      target: ids.skill,
      id: "relationship:semantic:behavior",
      stateId: "state:semantic:behavior",
      support: behaviorSupport,
      boundTechnicalFingerprint: fingerprint,
      bindingConfiguration: {
        configurationHash: {
          algorithm: "SHA-256",
          value: "configuration:one",
        },
        configurationLocator:
          contracts.sanitizeTechnicalLocator("bindings/skill.yaml"),
      },
    });
    const { decision: behaviorDecision } = approveRelationship(behaviorDraft);
    const reorderedBehavior = {
      ...behaviorDraft,
      support: {
        relationship: relationshipSupport(
          ["assertion:relationship:a", "assertion:relationship:b", "assertion:relationship:a"],
        ),
        boundTechnicalFingerprint: relationshipSupport(
          [],
          ["evidence:fingerprint:a", "evidence:fingerprint:b", "evidence:fingerprint:a"],
        ),
        bindingConfiguration: {
          configurationHash: relationshipSupport(
            ["assertion:config:a", "assertion:config:b"],
          ),
          configurationLocator: relationshipSupport(
            [],
            ["evidence:locator:a", "evidence:locator:b"],
          ),
        },
      },
    };
    assert.equal(
      contracts.createGovernedRelationship(
        behaviorDecision,
        reorderedBehavior,
      ).relationshipId,
      behaviorDraft.relationshipId,
    );
    assert.throws(
      () =>
        contracts.createGovernedRelationship(behaviorDecision, {
          ...reorderedBehavior,
          boundTechnicalFingerprint: contracts.createTechnicalFingerprint({
            algorithm: "SHA-256",
            schemaVersion: "technical-profile/v1",
            value: "behavior:changed",
          }),
        }),
      /does not match CREATE_NEW authorization/,
    );
    assert.throws(
      () =>
        contracts.createGovernedRelationship(behaviorDecision, {
          ...reorderedBehavior,
          bindingConfiguration: {
            ...behaviorDraft.bindingConfiguration,
            configurationHash: {
              algorithm: "SHA-256",
              value: "configuration:changed",
            },
          },
        }),
      /does not match CREATE_NEW authorization/,
    );

    const lineageDraft = relationshipStateDraft({
      type: "DERIVED_FROM",
      source: ids.dataElement,
      target: ids.originDataElement,
      id: "relationship:semantic:lineage",
      stateId: "state:semantic:lineage",
      transformation: {
        reference: contracts.sanitizeTechnicalLocator("lineage/derive.sql"),
        hash: { algorithm: "SHA-256", value: "lineage:one" },
        support: {
          reference: relationshipSupport(
            ["assertion:lineage:b", "assertion:lineage:a"],
          ),
          hash: relationshipSupport(
            [],
            ["evidence:lineage:b", "evidence:lineage:a"],
          ),
        },
      },
    });
    const { decision: lineageDecision } = approveRelationship(lineageDraft);
    const reorderedLineage = {
      ...lineageDraft,
      transformation: {
        ...lineageDraft.transformation,
        support: {
          reference: relationshipSupport(
            ["assertion:lineage:a", "assertion:lineage:b", "assertion:lineage:a"],
          ),
          hash: relationshipSupport(
            [],
            ["evidence:lineage:a", "evidence:lineage:b", "evidence:lineage:a"],
          ),
        },
      },
    };
    assert.equal(
      contracts.createGovernedRelationship(
        lineageDecision,
        reorderedLineage,
      ).relationshipId,
      lineageDraft.relationshipId,
    );
    assert.throws(
      () =>
        contracts.createGovernedRelationship(lineageDecision, {
          ...reorderedLineage,
          transformation: {
            ...reorderedLineage.transformation,
            reference:
              contracts.sanitizeTechnicalLocator("lineage/changed.sql"),
          },
        }),
      /does not match CREATE_NEW authorization/,
    );
  });

  it("rejects unsanitized binding locators and incomplete support", () => {
    const ids = relationshipIdentities();
    const fingerprint = contracts.createTechnicalFingerprint({
      algorithm: "SHA-256",
      schemaVersion: "technical-profile/v1",
      value: "skill-state",
    });
    const base = relationshipStateDraft({
      type: "USES_SKILL",
      source: ids.agentVersion,
      target: ids.skill,
      support: behaviorBindingSupport(),
      boundTechnicalFingerprint: fingerprint,
    });
    assert.throws(
      () =>
        approveRelationship({
          ...base,
          bindingConfiguration: {
            configurationHash: { algorithm: "SHA-256", value: "hash" },
            configurationLocator:
              "https://user:secret@example.invalid/config?token=secret",
          },
        }),
      /must already be sanitized/,
    );
    assert.throws(
      () =>
        approveRelationship({
          ...base,
          support: {
            relationship: relationshipSupport(),
            boundTechnicalFingerprint: relationshipSupport(),
          },
        }),
      /Behavior binding configuration support must be an object/,
    );
  });

  it("enforces half-open valid-time intervals", () => {
    const ids = relationshipIdentities();
    const base = relationshipStateDraft({
      type: "HANDOFF_TO",
      source: ids.agentVersion,
      target: ids.agent,
      validFrom: contracts.asIsoTimestamp("2026-08-31T12:00:00.000Z"),
    });
    assert.throws(
      () =>
        approveRelationship({
          ...base,
          validTo: base.validFrom,
        }),
      /validTo must be greater than validFrom/,
    );
    assert.throws(
      () =>
        approveRelationship({
          ...base,
          validTo: contracts.asIsoTimestamp("2026-08-31T11:59:59.000Z"),
        }),
      /validTo must be greater than validFrom/,
    );
    const valid = approveRelationship({
      ...base,
      validTo: contracts.asIsoTimestamp("2026-09-01T12:00:00.000Z"),
    }).relationship;
    assert.equal(valid.validFrom, "2026-08-31T12:00:00.000Z");
    assert.equal(valid.validTo, "2026-09-01T12:00:00.000Z");
  });

  it("creates immutable superseding states without rewriting history", () => {
    const ids = relationshipIdentities();
    const initialDraft = relationshipStateDraft({
      type: "HANDOFF_TO",
      source: ids.agentVersion,
      target: ids.agent,
      id: "relationship:temporal",
      stateId: "state:temporal:one",
    });
    const initial = approveRelationship(initialDraft).relationship;
    const priorSnapshot = JSON.stringify(initial);
    const correctionDraft = {
      ...initialDraft,
      relationshipStateId: contracts.asRelationshipStateId(
        "state:temporal:two",
      ),
      supersedesRelationshipStateId: initial.relationshipStateId,
      recordedAt: contracts.asIsoTimestamp("2026-08-31T14:00:00.000Z"),
    };
    const correction = approveRelationship(correctionDraft, {
      supersededState: initial,
    }).relationship;

    assert.equal(correction.relationshipId, initial.relationshipId);
    assert.notEqual(correction.relationshipStateId, initial.relationshipStateId);
    assert.equal(
      correction.supersedesRelationshipStateId,
      initial.relationshipStateId,
    );
    assert.equal(JSON.stringify(initial), priorSnapshot);
    assert.equal(Object.isFrozen(initial), true);

    assert.throws(
      () =>
        approveRelationship(
          {
            ...correctionDraft,
            relationshipId: contracts.asRelationshipId("relationship:other"),
          },
          { supersededState: initial },
        ),
      /must preserve relationship identity/,
    );
    assert.throws(
      () => approveRelationship(correctionDraft),
      /requires the exact prior relationship state/,
    );

    const ordinaryNextPeriod = approveRelationship({
      ...initialDraft,
      relationshipStateId: contracts.asRelationshipStateId(
        "state:temporal:next-period",
      ),
      validFrom: contracts.asIsoTimestamp("2026-09-01T00:00:00.000Z"),
      recordedAt: contracts.asIsoTimestamp("2026-09-01T00:00:01.000Z"),
    }).relationship;
    assert.equal(
      Object.hasOwn(ordinaryNextPeriod, "supersedesRelationshipStateId"),
      false,
    );
  });

  it("prevents behavior changes under the same superseded AgentVersion binding", () => {
    const ids = relationshipIdentities();
    const fingerprint = contracts.createTechnicalFingerprint({
      algorithm: "SHA-256",
      schemaVersion: "technical-profile/v1",
      value: "skill-state:one",
    });
    const initialDraft = relationshipStateDraft({
      type: "USES_SKILL",
      source: ids.agentVersion,
      target: ids.skill,
      id: "relationship:skill:immutable",
      stateId: "state:skill:immutable:one",
      support: behaviorBindingSupport(),
      boundTechnicalFingerprint: fingerprint,
      bindingConfiguration: {
        configurationHash: { algorithm: "SHA-256", value: "config:one" },
      },
    });
    const initial = approveRelationship(initialDraft).relationship;
    const correctionBase = {
      ...initialDraft,
      relationshipStateId: contracts.asRelationshipStateId(
        "state:skill:immutable:two",
      ),
      supersedesRelationshipStateId: initial.relationshipStateId,
      recordedAt: contracts.asIsoTimestamp("2026-08-31T14:00:00.000Z"),
    };

    assert.throws(
      () =>
        approveRelationship(
          {
            ...correctionBase,
            boundTechnicalFingerprint: contracts.createTechnicalFingerprint({
              algorithm: "SHA-256",
              schemaVersion: "technical-profile/v1",
              value: "skill-state:changed",
            }),
          },
          { supersededState: initial },
        ),
      /fingerprint and configuration are immutable/,
    );
    assert.throws(
      () =>
        approveRelationship(
          {
            ...correctionBase,
            bindingConfiguration: {
              configurationHash: {
                algorithm: "SHA-256",
                value: "config:changed",
              },
            },
          },
          { supersededState: initial },
        ),
      /fingerprint and configuration are immutable/,
    );
  });

  it("preserves directional cross-asset lineage and typed transformation evidence", () => {
    const ids = relationshipIdentities();
    const sourceWithSystemSignal = {
      ...ids.dataElement,
      sourceSystemId: "source-system:derived",
    };
    const targetWithSystemSignal = {
      ...ids.originDataElement,
      sourceSystemId: "source-system:origin",
    };
    const transformationHash = {
      algorithm: "SHA-256",
      value: "transformation-integrity",
    };
    const draft = relationshipStateDraft({
      type: "DERIVED_FROM",
      source: sourceWithSystemSignal,
      target: targetWithSystemSignal,
      transformation: {
        reference: contracts.sanitizeTechnicalLocator(
          "transformations/customer-email.sql",
        ),
        hash: transformationHash,
        support: {
          reference: relationshipSupport(["assertion:transformation:reference"]),
          hash: relationshipSupport([], ["evidence:transformation:hash"]),
        },
        rawSql: "select email from customer",
        rawPython: "must-not-copy",
      },
    });
    const relationship = approveRelationship(draft).relationship;

    assert.equal(relationship.source.elementPath, "mail");
    assert.equal(relationship.target.elementPath, "email");
    assert.notEqual(relationship.source.dataAssetId, relationship.target.dataAssetId);
    assert.equal(Object.hasOwn(relationship.source, "sourceSystemId"), false);
    assert.equal(Object.hasOwn(relationship.target, "sourceSystemId"), false);
    assert.equal(Object.isFrozen(relationship.transformation), true);
    assert.equal(Object.isFrozen(relationship.transformation.hash), true);
    assert.notEqual(relationship.transformation.hash, transformationHash);
    assert.equal(Object.isFrozen(relationship.transformation.support), true);
    assert.equal(Object.hasOwn(relationship.transformation, "rawSql"), false);
    assert.equal(Object.hasOwn(relationship.transformation, "rawPython"), false);

    const reversed = approveRelationship(
      relationshipStateDraft({
        type: "DERIVED_FROM",
        source: ids.originDataElement,
        target: ids.dataElement,
        id: "relationship:lineage:reversed",
        stateId: "state:lineage:reversed",
      }),
    ).relationship;
    assert.notDeepEqual(relationship.source, reversed.source);
    assert.notDeepEqual(relationship.target, reversed.target);

    assert.throws(
      () =>
        approveRelationship(
          relationshipStateDraft({
            type: "DERIVED_FROM",
            source: ids.dataElement,
            target: ids.originDataElement,
            id: "relationship:lineage:empty-transformation",
            stateId: "state:lineage:empty-transformation",
            transformation: {
              support: {
                reference: relationshipSupport(),
                hash: relationshipSupport(),
              },
            },
          }),
        ),
      /requires a reference or hash/,
    );
    assert.throws(
      () =>
        approveRelationship(
          relationshipStateDraft({
            type: "DERIVED_FROM",
            source: ids.dataElement,
            target: ids.originDataElement,
            id: "relationship:lineage:unsafe-reference",
            stateId: "state:lineage:unsafe-reference",
            transformation: {
              reference:
                "https://user:secret@example.invalid/sql?token=secret",
              support: {
                reference: relationshipSupport(),
                hash: relationshipSupport(),
              },
            },
          }),
        ),
      /must already be sanitized/,
    );
  });

  it("discards widened secrets and never promotes detection confidence to trust", () => {
    const ids = relationshipIdentities();
    const draft = relationshipStateDraft({
      type: "HANDOFF_TO",
      source: {
        ...ids.agentVersion,
        password: "must-not-copy",
      },
      target: {
        ...ids.agent,
        token: "must-not-copy",
      },
      metadata: { arbitrary: true },
      trustState: "VALIDATED",
      confidence: 1,
      password: "must-not-copy",
      token: "must-not-copy",
      bearerToken: "must-not-copy",
      apiKey: "must-not-copy",
      privateKey: "must-not-copy",
      connectionCredentials: "must-not-copy",
      secretHeaders: { authorization: "must-not-copy" },
      runtimeEvent: "must-not-copy",
    });
    const relationship = approveRelationship(draft).relationship;
    for (const forbidden of [
      "metadata",
      "trustState",
      "confidence",
      "password",
      "token",
      "bearerToken",
      "apiKey",
      "privateKey",
      "connectionCredentials",
      "secretHeaders",
      "runtimeEvent",
    ]) {
      assert.equal(Object.hasOwn(relationship, forbidden), false, forbidden);
    }
    assert.equal(Object.hasOwn(relationship.source, "password"), false);
    assert.equal(Object.hasOwn(relationship.target, "token"), false);

    const relationshipCandidate = relationshipCandidateFor(draft, {
      candidateId: "candidate:sanitized",
      relationshipTypeCode: "SOURCE_REJECTED_RELATIONSHIP",
    });
    const decision = contracts.createRelationshipReconciliationDecision({
      decisionId: contracts.asReconciliationDecisionId("decision:sanitized"),
      organisationId: ids.organisationId,
      relationshipCandidateId: relationshipCandidate.candidateId,
      relationshipCandidate,
      outcome: "REJECT",
      authority: { authorityKind: "HUMAN", actorReference: "reviewer:one" },
      reasonCode: "REJECTED",
      assertionIds: [],
      evidenceIds: [],
      decidedAt: reconciliationTimestamp,
      token: "must-not-copy",
      confidence: 1,
      trustState: "VALIDATED",
    });
    assert.equal(Object.hasOwn(decision, "token"), false);
    assert.equal(Object.hasOwn(decision, "confidence"), false);
    assert.equal(Object.hasOwn(decision, "trustState"), false);
  });

  it("keeps semantic identities distinct from physical identity and technical taxonomies", () => {
    const organisationId = contracts.asOrganisationId(
      "organisation:semantic:one",
    );
    const target = semanticConcept(organisationId);
    const elements = [
      semanticDataElement(organisationId, "crm", "mail"),
      semanticDataElement(organisationId, "billing", "email"),
      semanticDataElement(organisationId, "support", "primary_email"),
    ];
    const assignments = elements.map((dataElement, index) =>
      approveSemanticAssignment(
        semanticAssignmentState({
          dataElement,
          semanticConcept: target,
          id: `semantic-assignment:shared:${index}`,
          stateId: `semantic-assignment-state:shared:${index}`,
        }),
      ).assignment,
    );

    assert.equal(new Set(assignments.map((item) => item.dataElement.dataElementId)).size, 3);
    assert.equal(
      new Set(assignments.map((item) => item.semanticConcept.semanticConceptId))
        .size,
      1,
    );
    assert.equal(Object.keys(contracts.CANONICAL_OBJECT_KIND).length, 11);
    assert.equal(Object.keys(contracts.GOVERNED_RELATIONSHIP_TYPE).length, 12);
    assert.equal(
      Object.values(contracts.CANONICAL_OBJECT_KIND).includes(
        "SEMANTIC_CONCEPT",
      ),
      false,
    );
    assert.equal(
      Object.values(contracts.GOVERNED_RELATIONSHIP_TYPE).includes(
        "SEMANTICALLY_CLASSIFIED_AS",
      ),
      false,
    );

    const identities = [
      target,
      {
        semanticIdentityKind: "BUSINESS_TERM",
        organisationId,
        businessTermId: contracts.asBusinessTermId("business-term:email"),
      },
      {
        semanticIdentityKind: "BUSINESS_DOMAIN",
        organisationId,
        businessDomainId: contracts.asBusinessDomainId(
          "business-domain:customer",
        ),
      },
      {
        semanticIdentityKind: "INFORMATION_DOMAIN",
        organisationId,
        informationDomainId: contracts.asInformationDomainId(
          "information-domain:contact",
        ),
      },
    ];
    assert.deepEqual(
      identities.map((identity) => identity.semanticIdentityKind),
      [
        "SEMANTIC_CONCEPT",
        "BUSINESS_TERM",
        "BUSINESS_DOMAIN",
        "INFORMATION_DOMAIN",
      ],
    );
    assert.deepEqual(Object.keys(target).sort(), [
      "organisationId",
      "semanticConceptId",
      "semanticIdentityKind",
    ]);
  });

  it("keeps source signals inferential and validates candidate confidence fail closed", () => {
    const organisationOne = contracts.asOrganisationId(
      "organisation:semantic:signal:one",
    );
    const organisationTwo = contracts.asOrganisationId(
      "organisation:semantic:signal:two",
    );
    const assertionIds = [
      "assertion:semantic:b",
      "assertion:semantic:a",
      "assertion:semantic:b",
    ];
    const evidenceIds = [
      "evidence:semantic:b",
      "evidence:semantic:a",
      "evidence:semantic:b",
    ];
    const candidateOne = semanticAssignmentCandidate(
      semanticDataElement(organisationOne, "signal-one"),
      {
        sourceCode: "correo_electronico",
        sourceLabel: "Correo electrónico",
        confidence: 1,
        assertionIds,
        evidenceIds,
        trustState: "VALIDATED",
        semanticConcept: semanticConcept(organisationOne),
        vendorMetadata: { provider: "must-not-copy" },
        privacy: "PII",
        capability: "READ",
        authorization: "ALLOW",
        metadata: { arbitrary: true },
      },
    );
    const candidateTwo = semanticAssignmentCandidate(
      semanticDataElement(organisationTwo, "signal-two"),
      {
        sourceCode: "correo_electronico",
        sourceLabel: "Correo electrónico",
        confidence: 1,
      },
    );

    assert.deepEqual(candidateOne.sourceSignal, candidateTwo.sourceSignal);
    assert.notEqual(
      candidateOne.dataElement.canonicalObject.organisationId,
      candidateTwo.dataElement.canonicalObject.organisationId,
    );
    assert.equal(Object.hasOwn(candidateOne, "semanticConcept"), false);
    assert.equal(Object.hasOwn(candidateOne, "trustState"), false);
    assert.equal(Object.hasOwn(candidateOne, "vendorMetadata"), false);
    assert.equal(Object.hasOwn(candidateOne, "privacy"), false);
    assert.equal(Object.hasOwn(candidateOne, "capability"), false);
    assert.equal(Object.hasOwn(candidateOne, "authorization"), false);
    assert.equal(Object.hasOwn(candidateOne, "metadata"), false);
    assert.equal(candidateOne.confidence, 1);
    assert.equal(candidateOne.createsAssignment, false);
    assert.deepEqual(candidateOne.assertionIds, [
      "assertion:semantic:a",
      "assertion:semantic:b",
    ]);
    assert.deepEqual(candidateOne.evidenceIds, [
      "evidence:semantic:a",
      "evidence:semantic:b",
    ]);
    assert.deepEqual(assertionIds, [
      "assertion:semantic:b",
      "assertion:semantic:a",
      "assertion:semantic:b",
    ]);
    assert.deepEqual(evidenceIds, [
      "evidence:semantic:b",
      "evidence:semantic:a",
      "evidence:semantic:b",
    ]);
    assert.equal(Object.isFrozen(candidateOne), true);
    assert.equal(Object.isFrozen(candidateOne.sourceSignal), true);
    assert.equal(Object.isFrozen(candidateOne.assertionIds), true);

    for (const confidence of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () =>
          semanticAssignmentCandidate(
            semanticDataElement(organisationOne, `confidence:${confidence}`),
            { confidence },
          ),
        /confidence must be between 0 and 1/,
      );
    }
    assert.throws(
      () =>
        contracts.createDataElementSemanticConceptAssignmentCandidate({
          ...candidateOne,
          candidateId:
            contracts.asDataElementSemanticConceptAssignmentCandidateId(
              "semantic-candidate:empty-signal",
            ),
          sourceSignal: {},
        }),
      /requires sourceCode or sourceLabel/,
    );
    assert.throws(
      () =>
        semanticAssignmentCandidate(
          semanticDataElement(organisationOne, "invalid-kind"),
          { candidateKind: "SEMANTIC_ENGINE" },
        ),
      /must have kind DATA_ELEMENT_SEMANTIC_CONCEPT_ASSIGNMENT/,
    );
    assert.throws(
      () => contracts.createDataElementSemanticConceptAssignment(candidateOne, {}),
      /Unknown semantic assignment reconciliation outcome/,
    );
  });

  it("binds CREATE_NEW to the exact candidate DataElement and tenant", () => {
    const organisationId = contracts.asOrganisationId(
      "organisation:semantic:binding",
    );
    const otherOrganisationId = contracts.asOrganisationId(
      "organisation:semantic:binding:other",
    );
    const dataElementA = semanticDataElement(organisationId, "binding-a");
    const dataElementB = semanticDataElement(organisationId, "binding-b");
    const target = semanticConcept(organisationId, "governed-contact-email");
    const candidate = semanticAssignmentCandidate(dataElementA, {
      candidateId: "semantic-candidate:binding",
      sourceCode: "correo_electronico",
    });
    const stateA = semanticAssignmentState({
      dataElement: dataElementA,
      semanticConcept: {
        ...target,
        conceptCode: "CONTACT_EMAIL",
        label: "Contact email",
        description: "must-not-copy",
      },
      id: "semantic-assignment:binding",
      stateId: "semantic-assignment-state:binding",
    });
    const { decision, assignment } = approveSemanticAssignment(stateA, {
      candidate,
      decisionAssertionIds: [
        "assertion:decision:b",
        "assertion:decision:a",
        "assertion:decision:b",
      ],
      decisionEvidenceIds: [
        "evidence:decision:b",
        "evidence:decision:a",
        "evidence:decision:b",
      ],
    });

    assert.equal(assignment.dataElement.dataElementId, dataElementA.dataElementId);
    assert.equal(
      assignment.semanticConcept.semanticConceptId,
      target.semanticConceptId,
    );
    assert.deepEqual(Object.keys(assignment.semanticConcept).sort(), [
      "organisationId",
      "semanticConceptId",
      "semanticIdentityKind",
    ]);
    assert.equal(
      decision.candidateDataElement.dataElementId,
      dataElementA.dataElementId,
    );
    assert.equal(Object.hasOwn(decision, "assignmentCandidate"), false);
    assert.deepEqual(decision.assertionIds, [
      "assertion:decision:a",
      "assertion:decision:b",
    ]);
    assert.deepEqual(decision.evidenceIds, [
      "evidence:decision:a",
      "evidence:decision:b",
    ]);
    assert.equal(Object.isFrozen(decision.candidateDataElement), true);
    assert.equal(Object.isFrozen(decision.authority), true);

    const stateB = semanticAssignmentState({
      dataElement: dataElementB,
      semanticConcept: target,
      id: "semantic-assignment:binding:b",
      stateId: "semantic-assignment-state:binding:b",
    });
    assert.throws(
      () => approveSemanticAssignment(stateB, { candidate }),
      /must match candidate DataElement and tenant/,
    );
    assert.throws(
      () =>
        approveSemanticAssignment(stateA, {
          candidate,
          assignmentCandidateId:
            contracts.asDataElementSemanticConceptAssignmentCandidateId(
              "semantic-candidate:different",
            ),
        }),
      /candidate ID must match validation context/,
    );
    assert.throws(
      () =>
        approveSemanticAssignment(stateA, {
          candidate: { ...candidate, candidateKind: "SEMANTIC_ENGINE" },
        }),
      /must have kind DATA_ELEMENT_SEMANTIC_CONCEPT_ASSIGNMENT/,
    );
    assert.throws(
      () =>
        approveSemanticAssignment(
          semanticAssignmentState({
            dataElement: dataElementA,
            semanticConcept: semanticConcept(
              otherOrganisationId,
              "cross-tenant",
            ),
          }),
          { candidate },
        ),
      /tenant must match DataElement and SemanticConcept/,
    );

    const crossTenantDecisionDraft = {
      decisionId: contracts.asReconciliationDecisionId(
        "semantic-decision:cross-tenant",
      ),
      organisationId: otherOrganisationId,
      assignmentCandidateId: candidate.candidateId,
      assignmentCandidate: candidate,
      outcome: "CREATE_NEW",
      authority: { authorityKind: "HUMAN", actorReference: "reviewer:one" },
      reasonCode: "REVIEW",
      assertionIds: [],
      evidenceIds: [],
      decidedAt: reconciliationTimestamp,
      authorizedState: stateA,
    };
    assert.throws(
      () =>
        contracts.createSemanticAssignmentReconciliationDecision(
          crossTenantDecisionDraft,
        ),
      /decision tenant must match candidate DataElement/,
    );
    assert.throws(
      () =>
        contracts.createSemanticAssignmentReconciliationDecision({
          ...crossTenantDecisionDraft,
          organisationId,
          outcome: "REJECT",
          authority: { authorityKind: "LLM", actorReference: "model:one" },
        }),
      /Unknown reconciliation authority/,
    );
  });

  it("binds MATCH_EXISTING and prevents non-create outcomes from materializing", () => {
    const organisationId = contracts.asOrganisationId(
      "organisation:semantic:match",
    );
    const dataElementA = semanticDataElement(organisationId, "match-a");
    const dataElementB = semanticDataElement(organisationId, "match-b");
    const target = semanticConcept(organisationId);
    const state = semanticAssignmentState({
      dataElement: dataElementA,
      semanticConcept: target,
      id: "semantic-assignment:match",
      stateId: "semantic-assignment-state:match",
    });
    const candidate = semanticAssignmentCandidate(dataElementA, {
      candidateId: "semantic-candidate:match",
    });
    const base = {
      decisionId: contracts.asReconciliationDecisionId(
        "semantic-decision:match",
      ),
      organisationId,
      assignmentCandidateId: candidate.candidateId,
      assignmentCandidate: candidate,
      authority: {
        authorityKind: "DETERMINISTIC_RULE",
        ruleCode: "EXPLICIT_SEMANTIC_MAPPING",
        ruleVersion: "1",
      },
      reasonCode: "CONFIRMED_MAPPING",
      assertionIds: [],
      evidenceIds: [],
      decidedAt: reconciliationTimestamp,
    };
    const matchedState = {
      organisationId,
      assignmentId: state.assignmentId,
      assignmentStateId: state.assignmentStateId,
      dataElement: state.dataElement,
      semanticConcept: state.semanticConcept,
    };
    const matchDecision =
      contracts.createSemanticAssignmentReconciliationDecision({
        ...base,
        outcome: "MATCH_EXISTING",
        matchedState,
      });
    assert.equal(matchDecision.outcome, "MATCH_EXISTING");
    assert.equal(
      matchDecision.matchedState.assignmentStateId,
      state.assignmentStateId,
    );

    assert.throws(
      () =>
        contracts.createSemanticAssignmentReconciliationDecision({
          ...base,
          outcome: "MATCH_EXISTING",
          matchedState: {
            ...matchedState,
            dataElement: dataElementB,
          },
        }),
      /must match candidate DataElement and tenant/,
    );

    const negativeDecisions = ["REJECT", "DEFER"].map((outcome) =>
      contracts.createSemanticAssignmentReconciliationDecision({
        ...base,
        decisionId: contracts.asReconciliationDecisionId(
          `semantic-decision:${outcome.toLowerCase()}`,
        ),
        outcome,
      }),
    );
    for (const decision of [matchDecision, ...negativeDecisions]) {
      assert.throws(
        () => contracts.createDataElementSemanticConceptAssignment(decision, state),
        /requires an approved CREATE_NEW decision/,
      );
    }
    for (const decision of negativeDecisions) {
      assert.equal(Object.hasOwn(decision, "assignmentId"), false);
      assert.equal(Object.hasOwn(decision, "assignmentStateId"), false);
      assert.equal(Object.hasOwn(decision, "authorizedState"), false);
      assert.equal(Object.hasOwn(decision, "matchedState"), false);
      assert.equal(
        decision.candidateDataElement.dataElementId,
        dataElementA.dataElementId,
      );
    }
  });

  it("rehydrates complete semantic decisions and rejects forged envelopes", () => {
    const organisationId = contracts.asOrganisationId(
      "organisation:semantic:rehydration",
    );
    const dataElement = semanticDataElement(organisationId, "rehydration");
    const state = semanticAssignmentState({
      dataElement,
      semanticConcept: semanticConcept(organisationId),
      id: "semantic-assignment:rehydration",
      stateId: "semantic-assignment-state:rehydration",
    });
    const { decision } = approveSemanticAssignment(state);
    const serialized = JSON.parse(JSON.stringify(decision));
    const rehydrated =
      contracts.rehydrateSemanticAssignmentReconciliationDecision(serialized);
    const materialized =
      contracts.createDataElementSemanticConceptAssignment(serialized, state);

    assert.equal(Object.isFrozen(rehydrated), true);
    assert.equal(Object.isFrozen(rehydrated.authorizedState), true);
    assert.equal(materialized.assignmentId, state.assignmentId);

    for (const field of [
      "decisionId",
      "organisationId",
      "assignmentCandidateId",
      "candidateDataElement",
      "outcome",
      "authority",
      "reasonCode",
      "assertionIds",
      "evidenceIds",
      "decidedAt",
      "authorizedState",
    ]) {
      const forged = { ...serialized };
      delete forged[field];
      assert.throws(
        () =>
          contracts.createDataElementSemanticConceptAssignment(forged, state),
        TypeError,
        `missing ${field}`,
      );
    }
    for (const forged of [
      { ...serialized, assertionIds: "not-an-array" },
      { ...serialized, evidenceIds: [""] },
      {
        ...serialized,
        authority: { authorityKind: "SEMANTIC_ENGINE", actorReference: "one" },
      },
    ]) {
      assert.throws(
        () =>
          contracts.createDataElementSemanticConceptAssignment(forged, state),
        TypeError,
      );
    }
    const widened = contracts.rehydrateSemanticAssignmentReconciliationDecision({
      ...serialized,
      metadata: { arbitrary: true },
      privacy: "PII",
      capability: "READ",
      authorization: "ALLOW",
      vendorPayload: { token: "must-not-copy" },
    });
    for (const forbidden of [
      "metadata",
      "privacy",
      "capability",
      "authorization",
      "vendorPayload",
    ]) {
      assert.equal(Object.hasOwn(widened, forbidden), false, forbidden);
    }
  });

  it("normalizes semantic support and compares assignment state semantically", () => {
    const organisationId = contracts.asOrganisationId(
      "organisation:semantic:support",
    );
    const dataElement = semanticDataElement(organisationId, "support");
    const assertions = [
      contracts.asSourceAssertionId("assertion:support:b"),
      contracts.asSourceAssertionId("assertion:support:a"),
      contracts.asSourceAssertionId("assertion:support:b"),
    ];
    const evidence = [
      contracts.asEvidenceId("evidence:support:b"),
      contracts.asEvidenceId("evidence:support:a"),
      contracts.asEvidenceId("evidence:support:b"),
    ];
    const state = semanticAssignmentState({
      dataElement,
      semanticConcept: semanticConcept(organisationId),
      id: "semantic-assignment:support",
      stateId: "semantic-assignment-state:support",
      support: { assertionIds: assertions, evidenceIds: evidence },
    });
    const originalAssertions = [...assertions];
    const originalEvidence = [...evidence];
    const { decision, assignment } = approveSemanticAssignment(state);
    assert.deepEqual(assignment.support.assertionIds, [
      "assertion:support:a",
      "assertion:support:b",
    ]);
    assert.deepEqual(assignment.support.evidenceIds, [
      "evidence:support:a",
      "evidence:support:b",
    ]);
    assert.deepEqual(assertions, originalAssertions);
    assert.deepEqual(evidence, originalEvidence);
    assert.equal(Object.isFrozen(assignment.support), true);
    assert.equal(Object.isFrozen(assignment.support.assertionIds), true);
    assert.equal(Object.isFrozen(assignment.semanticConcept), true);

    assertions.push(contracts.asSourceAssertionId("assertion:support:later"));
    evidence.push(contracts.asEvidenceId("evidence:support:later"));
    assert.deepEqual(assignment.support.assertionIds, [
      "assertion:support:a",
      "assertion:support:b",
    ]);

    const reorderedAndWidened = {
      ...state,
      support: relationshipSupport(
        ["assertion:support:a", "assertion:support:b", "assertion:support:a"],
        ["evidence:support:a", "evidence:support:b", "evidence:support:a"],
      ),
      metadata: { arbitrary: true },
      privacy: "PII",
      capability: "READ",
      authorization: "ALLOW",
      vendorField: "must-not-copy",
    };
    const equivalent = contracts.createDataElementSemanticConceptAssignment(
      decision,
      reorderedAndWidened,
    );
    for (const forbidden of [
      "metadata",
      "privacy",
      "capability",
      "authorization",
      "vendorField",
    ]) {
      assert.equal(Object.hasOwn(equivalent, forbidden), false, forbidden);
    }
    assert.throws(
      () =>
        contracts.createDataElementSemanticConceptAssignment(decision, {
          ...state,
          support: relationshipSupport(
            ["assertion:support:a", "assertion:support:different"],
            ["evidence:support:a", "evidence:support:b"],
          ),
        }),
      /does not match CREATE_NEW authorization/,
    );
    assert.throws(
      () =>
        contracts.createDataElementSemanticConceptAssignment(decision, {
          ...state,
          semanticConcept: semanticConcept(
            organisationId,
            "different-concept",
          ),
        }),
      /does not match CREATE_NEW authorization/,
    );
  });

  it("enforces semantic assignment valid time and immutable supersession identity", () => {
    const organisationId = contracts.asOrganisationId(
      "organisation:semantic:temporal",
    );
    const dataElement = semanticDataElement(organisationId, "temporal");
    const target = semanticConcept(organisationId);
    const initialDraft = semanticAssignmentState({
      dataElement,
      semanticConcept: target,
      id: "semantic-assignment:temporal",
      stateId: "semantic-assignment-state:temporal:one",
    });
    assert.throws(
      () =>
        approveSemanticAssignment({
          ...initialDraft,
          validTo: initialDraft.validFrom,
        }),
      /validTo must be greater than validFrom/,
    );

    const initial = approveSemanticAssignment(initialDraft).assignment;
    const priorSnapshot = JSON.stringify(initial);
    const correctionDraft = {
      ...initialDraft,
      assignmentStateId:
        contracts.asDataElementSemanticConceptAssignmentStateId(
          "semantic-assignment-state:temporal:two",
        ),
      supersedesAssignmentStateId: initial.assignmentStateId,
      recordedAt: contracts.asIsoTimestamp("2026-08-31T18:00:00.000Z"),
    };
    const correctionResult = approveSemanticAssignment(correctionDraft, {
      supersededState: initial,
    });
    const correction = correctionResult.assignment;
    assert.equal(correction.assignmentId, initial.assignmentId);
    assert.notEqual(correction.assignmentStateId, initial.assignmentStateId);
    assert.equal(
      correction.supersedesAssignmentStateId,
      initial.assignmentStateId,
    );
    assert.equal(JSON.stringify(initial), priorSnapshot);
    assert.equal(
      correctionResult.decision.supersededState.assignmentStateId,
      initial.assignmentStateId,
    );
    const serializedCorrection = JSON.parse(
      JSON.stringify(correctionResult.decision),
    );
    assert.equal(
      contracts.createDataElementSemanticConceptAssignment(
        serializedCorrection,
        correctionDraft,
      ).assignmentStateId,
      correction.assignmentStateId,
    );
    delete serializedCorrection.supersededState;
    assert.throws(
      () =>
        contracts.createDataElementSemanticConceptAssignment(
          serializedCorrection,
          correctionDraft,
        ),
      /requires the exact prior state/,
    );

    assert.throws(
      () => approveSemanticAssignment(correctionDraft),
      /requires the exact prior state/,
    );
    assert.throws(
      () =>
        approveSemanticAssignment(
          {
            ...correctionDraft,
            dataElement: semanticDataElement(organisationId, "temporal-other"),
          },
          { supersededState: initial },
        ),
      /must preserve identity, tenant, DataElement, and SemanticConcept/,
    );
    assert.throws(
      () =>
        approveSemanticAssignment(
          {
            ...correctionDraft,
            semanticConcept: semanticConcept(
              organisationId,
              "different-target",
            ),
          },
          { supersededState: initial },
        ),
      /must preserve identity, tenant, DataElement, and SemanticConcept/,
    );
    assert.throws(
      () =>
        approveSemanticAssignment(
          {
            ...correctionDraft,
            assignmentId:
              contracts.asDataElementSemanticConceptAssignmentId(
                "semantic-assignment:temporal:other",
              ),
          },
          { supersededState: initial },
        ),
      /must preserve identity, tenant, DataElement, and SemanticConcept/,
    );
    assert.throws(
      () =>
        approveSemanticAssignment(
          {
            ...correctionDraft,
            assignmentStateId: initial.assignmentStateId,
          },
          { supersededState: initial },
        ),
      /requires a new assignmentStateId/,
    );
    for (const recordedAt of [
      initial.recordedAt,
      contracts.asIsoTimestamp("2026-08-31T16:00:00.000Z"),
    ]) {
      assert.throws(
        () =>
          approveSemanticAssignment(
            { ...correctionDraft, recordedAt },
            { supersededState: initial },
          ),
        /must be recorded later/,
      );
    }
  });
});
