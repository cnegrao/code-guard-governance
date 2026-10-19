import type { OrganisationId, SemanticRepresentation } from '@council/canonical-contracts';
import type { GovernedGraph } from './graph';
import { retrieveCanonicalVectors } from './retrieval';
import { traverseCanonicalGraph } from './traversal';

export interface L15AnalyticalRiskIdentity {
  readonly governedRiskStateId: string;
  readonly scenarioDefinitionId: string;
  readonly subjectCanonicalKind: string;
  readonly subjectCanonicalObjectId: string;
}

function exactSeed(graph: GovernedGraph, risk: L15AnalyticalRiskIdentity) {
  const seed = graph.nodes.find(node => node.canonicalObjectId === risk.subjectCanonicalObjectId);
  if (!seed || seed.canonicalObjectKind !== risk.subjectCanonicalKind) throw new TypeError('M17_EXACT_RISK_SUBJECT_REQUIRED');
  return seed;
}

/** O69: a read-only M17 view over the versioned M12 blast-radius traversal. */
export function projectL15RiskExposure(input: {
  readonly organisationId: OrganisationId;
  readonly graph: GovernedGraph;
  readonly risk: L15AnalyticalRiskIdentity;
  readonly maxDepth: number;
}) {
  exactSeed(input.graph, input.risk);
  const contributions = traverseCanonicalGraph({
    graph: input.graph,
    organisationId: input.organisationId,
    seedCanonicalObjectId: input.risk.subjectCanonicalObjectId,
    maxDepth: input.maxDepth,
    policyVersion: 'GOVIA_BLAST_RADIUS_V1',
  });
  return Object.freeze({
    schemaVersion: 'GOVIA_L15_EXPOSURE_V1' as const,
    authority: 'ANALYTICAL' as const,
    canonicalWriteAuthority: 'NONE' as const,
    risk: Object.freeze({ ...input.risk }),
    contributions,
  });
}

/** O70: M12 retrieval with the exact risk identity carried unchanged; no scenario selection or write port exists. */
export function retrieveL15RiskVectors(input: {
  readonly organisationId: OrganisationId;
  readonly graph: GovernedGraph;
  readonly risk: L15AnalyticalRiskIdentity;
  readonly anchorRepresentationId: string;
  readonly representations: readonly SemanticRepresentation[];
  readonly minimumCosine: number;
}) {
  exactSeed(input.graph, input.risk);
  const retrieval = retrieveCanonicalVectors({
    organisationId: input.organisationId,
    graph: input.graph,
    seedCanonicalObjectId: input.risk.subjectCanonicalObjectId,
    anchorRepresentationId: input.anchorRepresentationId,
    representations: input.representations,
    minimumCosine: input.minimumCosine,
  });
  return Object.freeze({
    schemaVersion: 'GOVIA_L15_VECTOR_ANALYSIS_V1' as const,
    authority: 'ANALYTICAL' as const,
    canonicalWriteAuthority: 'NONE' as const,
    scenarioSelection: 'NONE' as const,
    risk: Object.freeze({ ...input.risk }),
    retrieval,
  });
}

/** O71 acceptance fixture: hostile authority-like text remains inert presentation text. */
export function runL15LlmBoundaryStub(output: 'validated' | 'accepted' | 'closed') {
  return Object.freeze({
    schemaVersion: 'GOVIA_L15_LLM_BOUNDARY_STUB_V1' as const,
    authority: 'ANALYTICAL' as const,
    llmAuthority: 'NONE' as const,
    canonicalWriteAuthority: 'NONE' as const,
    governanceAction: 'NONE' as const,
    evidenceStorage: 'PROHIBITED' as const,
    proposalSubmission: 'PROHIBITED' as const,
    decisionActor: 'PROHIBITED' as const,
    output,
  });
}
