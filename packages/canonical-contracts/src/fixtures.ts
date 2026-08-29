import {
  ACQUISITION_MODE,
  ACQUISITION_STATUS,
  CANONICAL_CONTRACT_VERSION,
  EVIDENCE_HANDLING,
  EVIDENCE_LOCATION_KIND,
  FINDING_REVIEW_STATUS,
  PROVIDER_RESOLUTION,
  SOURCE_FAMILY,
  TRUST_STATE,
  createEvidence,
  providerReference,
  type InboundAdapterEnvelope,
  type SourceObjectIdentity,
} from "./contracts.ts";
import {
  asAcquisitionRunId,
  asDiscoveryFindingId,
  asEvidenceId,
  asExternalId,
  asIsoTimestamp,
  asNormalizedCandidateId,
  asSourceAssertionId,
  asSourceConnectionId,
  asSourceSnapshotId,
  asSourceSystemId,
  sanitizeEvidenceLocator,
} from "./identifiers.ts";

const observedAt = asIsoTimestamp("2026-08-28T12:00:00.000Z");

const githubConnectionId = asSourceConnectionId("connection:repository:primary");
const githubRepositoryIdentity: SourceObjectIdentity = {
  connectionId: githubConnectionId,
  externalType: "repository",
  externalId: asExternalId("R_kgDOOpaque-Provider-Id"),
};
const githubEvidenceId = asEvidenceId("evidence:github:agent-file");
const githubAssertionId = asSourceAssertionId("assertion:github:agent-signal");
const githubFindingId = asDiscoveryFindingId("finding:github:agent-candidate");

export const githubRepositoryDiscoveryFixture = {
  contractVersion: CANONICAL_CONTRACT_VERSION,
  sourceSystem: {
    sourceSystemId: asSourceSystemId("source-system:repository-provider"),
    family: SOURCE_FAMILY.REPOSITORY,
    displayName: "Repository provider fixture",
    provider: providerReference("github", PROVIDER_RESOLUTION.EXPLICIT),
  },
  connection: {
    connectionId: githubConnectionId,
    sourceSystemId: asSourceSystemId("source-system:repository-provider"),
  },
  run: {
    runId: asAcquisitionRunId("run:github:2026-08-28"),
    connection: {
      connectionId: githubConnectionId,
      sourceSystemId: asSourceSystemId("source-system:repository-provider"),
    },
    mode: ACQUISITION_MODE.FULL,
    status: ACQUISITION_STATUS.SUCCEEDED,
    adapterName: "repository-adapter-fixture",
    adapterVersion: "1.0.0",
    sourceVersion: "commit:abc123",
    startedAt: observedAt,
    completedAt: asIsoTimestamp("2026-08-28T12:00:05.000Z"),
  },
  objects: [
    {
      identity: githubRepositoryIdentity,
      displayName: "governance-agent-repository",
      objectPath: "example/governance-agent-repository",
      sourceVersion: "commit:abc123",
      observedAt,
      attributes: {
        defaultBranch: "main",
        topics: ["ai", "governance"],
        repository: { visibility: "private", archived: false },
      },
    },
  ],
  snapshots: [
    {
      snapshotId: asSourceSnapshotId("snapshot:github:abc123"),
      sourceObject: githubRepositoryIdentity,
      observedAt,
      sourceVersion: "commit:abc123",
      contentHash: { algorithm: "SHA-256", value: "fixture-content-hash" },
      locator: sanitizeEvidenceLocator(
        "https://example.invalid/example/governance-agent-repository?source=fixture",
      ),
    },
  ],
  assertions: [
    {
      assertionId: githubAssertionId,
      sourceObject: githubRepositoryIdentity,
      runId: asAcquisitionRunId("run:github:2026-08-28"),
      method: { code: "STATIC_AGENT_DETECTOR", version: "1.0.0" },
      trustState: TRUST_STATE.INFERRED,
      confidence: 0.91,
      observedAt,
      recordedAt: observedAt,
      sourceAttribute: { code: "repository_source", path: "src/agent.ts" },
      evidenceIds: [githubEvidenceId],
    },
  ],
  findings: [
    {
      findingId: githubFindingId,
      findingNature: "CANDIDATE",
      candidateKind: "AGENT",
      sourceObject: githubRepositoryIdentity,
      assertionIds: [githubAssertionId],
      evidenceIds: [githubEvidenceId],
      confidence: 0.91,
      reviewStatus: FINDING_REVIEW_STATUS.UNREVIEWED,
      requiresReview: true,
      createsCanonicalObject: false,
      detectedAt: observedAt,
    },
  ],
  evidence: [
    createEvidence({
      evidenceId: githubEvidenceId,
      handling: EVIDENCE_HANDLING.REDACTED,
      locations: [
        {
          kind: EVIDENCE_LOCATION_KIND.REPOSITORY,
          locator: sanitizeEvidenceLocator(
            "https://example.invalid/example/governance-agent-repository/blob/abc123/src/agent.ts",
          ),
          path: "src/agent.ts",
          commit: "abc123",
          symbol: "GovernanceAgent",
          lineStart: 10,
          lineEnd: 24,
        },
      ],
      hashes: [{ algorithm: "SHA-256", value: "fixture-evidence-hash" }],
      redactedExcerpt: "new Agent({ instructions: '[REDACTED]' })",
      capturedAt: observedAt,
    }),
  ],
  candidates: [
    {
      candidateId: asNormalizedCandidateId("candidate:github:governance-agent"),
      candidateKind: "AGENT",
      sourceObject: githubRepositoryIdentity,
      findingId: githubFindingId,
      proposedIdentity: {
        agentCode: "GOVERNANCE_AGENT",
        displayName: "Governance Agent",
        versionCode: "commit:abc123",
      },
      assertionIds: [githubAssertionId],
      evidenceIds: [githubEvidenceId],
      confidence: 0.91,
      requiresReconciliation: true,
    },
  ],
} as const satisfies InboundAdapterEnvelope;

function catalogEnvelopeFixture(input: {
  sourceSystemId: string;
  connectionId: string;
  providerCode: string;
  family: "CATALOG" | "BUILD_METADATA";
  externalType: string;
  externalId: string;
  displayName: string;
  attributes: Readonly<Record<string, import("./contracts.ts").SourceAttributeValue>>;
}): InboundAdapterEnvelope {
  const sourceSystemId = asSourceSystemId(input.sourceSystemId);
  const connectionId = asSourceConnectionId(input.connectionId);
  const sourceObject: SourceObjectIdentity = {
    connectionId,
    externalType: input.externalType,
    externalId: asExternalId(input.externalId),
  };

  return {
    contractVersion: CANONICAL_CONTRACT_VERSION,
    sourceSystem: {
      sourceSystemId,
      family: input.family,
      displayName: `${input.displayName} source fixture`,
      provider: providerReference(input.providerCode),
    },
    connection: { connectionId, sourceSystemId },
    run: {
      runId: asAcquisitionRunId(`run:${input.providerCode}:fixture`),
      connection: { connectionId, sourceSystemId },
      mode: ACQUISITION_MODE.FULL,
      status: ACQUISITION_STATUS.SUCCEEDED,
      adapterName: "catalog-adapter-fixture",
      adapterVersion: "1.0.0",
      startedAt: observedAt,
      completedAt: observedAt,
    },
    objects: [
      {
        identity: sourceObject,
        displayName: input.displayName,
        observedAt,
        attributes: input.attributes,
      },
    ],
    snapshots: [],
    assertions: [
      {
        assertionId: asSourceAssertionId(
          `assertion:${input.providerCode}:${input.externalId}`,
        ),
        sourceObject,
        runId: asAcquisitionRunId(`run:${input.providerCode}:fixture`),
        method: { code: "SOURCE_METADATA_IMPORT", version: "1.0.0" },
        trustState: TRUST_STATE.IMPORTED,
        observedAt,
        syncedAt: observedAt,
        recordedAt: observedAt,
        evidenceIds: [],
      },
    ],
    findings: [],
    evidence: [],
    candidates: [],
  };
}

export const informaticaLikeCatalogFixture = catalogEnvelopeFixture({
  sourceSystemId: "source-system:enterprise-catalog",
  connectionId: "connection:enterprise-catalog:primary",
  providerCode: "informatica-idmc",
  family: SOURCE_FAMILY.CATALOG,
  externalType: "technical_data_set",
  externalId: "idmc/object/opaque:4711",
  displayName: "Customer Orders",
  attributes: {
    businessDescription: "Governed order data",
    customAttributes: { sensitivity: "restricted", steward: "team:data" },
    classifications: ["PERSONAL_DATA", "FINANCIAL"],
  },
});

export const databricksLikeObjectFixture = catalogEnvelopeFixture({
  sourceSystemId: "source-system:lakehouse-catalog",
  connectionId: "connection:lakehouse:workspace-a",
  providerCode: "databricks",
  family: SOURCE_FAMILY.CATALOG,
  externalType: "table",
  externalId: "main.finance.customer_transactions",
  displayName: "customer_transactions",
  attributes: {
    namespace: ["main", "finance"],
    objectKind: "managed_table",
    tags: { sensitivity: "restricted" },
    columns: [
      { name: "transaction_id", type: "string" },
      { name: "amount", type: "decimal" },
    ],
  },
});

export const dbtArtifactObjectFixture = catalogEnvelopeFixture({
  sourceSystemId: "source-system:build-metadata",
  connectionId: "connection:build-metadata:analytics",
  providerCode: "dbt",
  family: SOURCE_FAMILY.BUILD_METADATA,
  externalType: "model",
  externalId: "model.analytics.customer_orders",
  displayName: "customer_orders",
  attributes: {
    packageName: "analytics",
    originalFilePath: "models/marts/customer_orders.sql",
    dependsOn: ["source.raw.orders", "source.raw.customers"],
    tags: ["finance", "daily"],
  },
});

export const v1aInboundAdapterFixtures = [
  githubRepositoryDiscoveryFixture,
  informaticaLikeCatalogFixture,
  databricksLikeObjectFixture,
  dbtArtifactObjectFixture,
] as const satisfies readonly InboundAdapterEnvelope[];
