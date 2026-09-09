import { createHash } from 'node:crypto';
import {
  createSemanticRepresentation,
  semanticRepresentationSubjectKey,
  type OrganisationId,
  type SemanticRepresentation,
  type SemanticRepresentationId,
  type SemanticRepresentationSubjectReference,
  type SemanticRepresentationSupport,
} from '@council/canonical-contracts';

/** Local analytical vocabulary: no canonical kinds or trust states are added. */
export type SemanticComparisonFamily = 'AGENT' | 'AGENT_VERSION' | 'DATA_ELEMENT' | 'PROMPT';
export const COSINE_ALGORITHM_VERSION = 'GOVIA_L8_SCALED_COSINE_V1';

export interface SemanticSpaceIdentity {
  readonly projectionSchemaVersion: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly dimension: number;
}

export interface SimilarityPolicy {
  readonly policyVersion: string;
  readonly comparisonFamily: SemanticComparisonFamily;
  readonly metric: 'COSINE';
  /** Inclusive cosine threshold in [-1, 1], with zero governance authority. */
  readonly threshold: number;
}

export interface SimilarityEndpoint {
  readonly subject: SemanticRepresentationSubjectReference;
  readonly representationId: SemanticRepresentationId;
  readonly support: SemanticRepresentationSupport;
}

export interface SimilarityResult {
  readonly organisationId: OrganisationId;
  readonly comparisonFamily: SemanticComparisonFamily;
  readonly left: SimilarityEndpoint;
  readonly right: SimilarityEndpoint;
  readonly semanticSpace: SemanticSpaceIdentity;
  readonly metric: 'COSINE';
  /** Raw cosine, not confidence: -1 opposite, 0 orthogonal, 1 aligned. */
  readonly score: number;
  readonly algorithmVersion: typeof COSINE_ALGORITHM_VERSION;
  readonly policy: SimilarityPolicy;
  readonly computedAt: string;
}

export interface PossibleMatchCandidate extends SimilarityResult {
  readonly candidateId: string;
  readonly status: 'ANALYTICAL';
  readonly eligibility: 'SAME_TENANT_SPACE_AND_ENTITY_FAMILY';
}

export function requireText(value: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('L8_NONEMPTY_IDENTIFIER_REQUIRED');
}

export function validateComputedAt(value: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw new TypeError('L8_INVALID_COMPUTED_AT');
}

export function analyticalHash(domain: string, parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify([domain, ...parts])).digest('hex');
}

export function semanticSpaceIdentity(
  representation: Pick<SemanticRepresentation, 'projectionSchemaVersion' | 'embeddingProvider'>,
): SemanticSpaceIdentity {
  const { projectionSchemaVersion, embeddingProvider: p } = representation;
  [projectionSchemaVersion, p.providerId, p.modelId, p.modelVersion].forEach(requireText);
  if (!Number.isSafeInteger(p.dimension) || p.dimension <= 0) throw new TypeError('L8_INVALID_DIMENSION');
  return Object.freeze({ projectionSchemaVersion, providerId: p.providerId,
    modelId: p.modelId, modelVersion: p.modelVersion, dimension: p.dimension });
}

export function semanticSpaceKey(space: SemanticSpaceIdentity): string {
  const checked = semanticSpaceIdentity({ projectionSchemaVersion: space.projectionSchemaVersion,
    embeddingProvider: space });
  return JSON.stringify([checked.projectionSchemaVersion, checked.providerId,
    checked.modelId, checked.modelVersion, checked.dimension]);
}

export function snapshotPolicy(policy: SimilarityPolicy): SimilarityPolicy {
  requireText(policy.policyVersion);
  if (!['AGENT', 'AGENT_VERSION', 'DATA_ELEMENT', 'PROMPT'].includes(policy.comparisonFamily)) {
    throw new TypeError('L8_UNSUPPORTED_FAMILY');
  }
  if (policy.metric !== 'COSINE' || !Number.isFinite(policy.threshold)
    || policy.threshold < -1 || policy.threshold > 1) throw new TypeError('L8_INVALID_POLICY');
  return Object.freeze({ policyVersion: policy.policyVersion, comparisonFamily: policy.comparisonFamily,
    metric: 'COSINE', threshold: policy.threshold });
}

export function policyKey(policy: SimilarityPolicy): string {
  const p = snapshotPolicy(policy);
  return JSON.stringify([p.policyVersion, p.comparisonFamily, p.metric, p.threshold, COSINE_ALGORITHM_VERSION]);
}

/** Copy only safe reference fields, including when called with structurally wider runtime objects. */
export function snapshotEndpoint(endpoint: SimilarityEndpoint, organisationId: OrganisationId,
  family: SemanticComparisonFamily): SimilarityEndpoint {
  requireText(organisationId);
  requireText(endpoint.representationId);
  const s = endpoint.subject;
  if (s.organisationId !== organisationId) throw new TypeError('L8_TENANT_MISMATCH');
  let subject: SemanticRepresentationSubjectReference;
  if (s.subjectKind === 'CANONICAL_OBJECT') {
    requireText(s.canonicalObjectId);
    if (s.canonicalObjectKind !== family) throw new TypeError('L8_FAMILY_MISMATCH');
    subject = Object.freeze({ subjectKind: s.subjectKind, organisationId,
      canonicalObjectId: s.canonicalObjectId, canonicalObjectKind: s.canonicalObjectKind });
  } else if (s.subjectKind === 'NORMALIZED_CANDIDATE') {
    requireText(s.candidateId);
    if (s.candidateKind !== family) throw new TypeError('L8_FAMILY_MISMATCH');
    subject = Object.freeze({ subjectKind: s.subjectKind, organisationId,
      candidateId: s.candidateId, candidateKind: s.candidateKind });
  } else throw new TypeError('L8_UNSUPPORTED_SUBJECT');
  const { assertionIds, evidenceIds } = endpoint.support;
  if (!assertionIds.length && !evidenceIds.length) throw new TypeError('L8_SUPPORT_REQUIRED');
  [...assertionIds, ...evidenceIds].forEach(requireText);
  return Object.freeze({ subject, representationId: endpoint.representationId,
    support: Object.freeze({ assertionIds: Object.freeze([...new Set(assertionIds)].sort()),
      evidenceIds: Object.freeze([...new Set(evidenceIds)].sort()) }) });
}

export function endpointKey(endpoint: SimilarityEndpoint): string {
  return JSON.stringify([semanticRepresentationSubjectKey(endpoint.subject), endpoint.representationId]);
}

export function candidateIdentity(result: SimilarityResult): string {
  return analyticalHash('GOVIA_L8_POSSIBLE_MATCH_V1', [result.organisationId, result.comparisonFamily,
    ...[endpointKey(result.left), endpointKey(result.right)].sort(),
    semanticSpaceKey(result.semanticSpace), policyKey(result.policy)]);
}

/** Scaling avoids overflow/underflow without altering dimension or direction. */
function cosine(left: readonly number[], right: readonly number[]): number {
  const scale = (vector: readonly number[]) => {
    let max = 0;
    for (const value of vector) max = Math.max(max, Math.abs(value));
    if (max === 0) throw new TypeError('L8_ZERO_VECTOR');
    return vector.map(value => value / max);
  };
  const a = scale(left), b = scale(right);
  // Preserve exact aligned/opposite directions at the inclusive +/-1 boundary.
  // No epsilon: nearby but unequal directions still use the raw computation.
  if (a.every((value, i) => value === b[i])) return 1;
  if (a.every((value, i) => value === -b[i])) return -1;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i];
  }
  const score = dot / (Math.sqrt(aa) * Math.sqrt(bb));
  if (!Number.isFinite(score)) throw new TypeError('L8_INVALID_COSINE');
  // Bound floating-point roundoff only; no rounding or governance rescaling.
  return Math.max(-1, Math.min(1, score));
}

export interface CompareSemanticRepresentationsInput {
  readonly organisationId: OrganisationId;
  readonly source: SemanticRepresentation;
  readonly target: SemanticRepresentation;
  readonly policy: SimilarityPolicy;
  readonly computedAt: string;
}

/** Pure L8 computation over trusted L7 inputs. No repository, provider or authority port. */
export function compareSemanticRepresentations(input: CompareSemanticRepresentationsInput): SimilarityResult {
  const policy = snapshotPolicy(input.policy);
  validateComputedAt(input.computedAt);
  requireText(input.organisationId);
  if (input.source.organisationId !== input.organisationId || input.target.organisationId !== input.organisationId) {
    throw new TypeError('L8_TENANT_MISMATCH');
  }
  // Revalidate at the runtime boundary: TypeScript interfaces do not validate deserialized inputs.
  const source = createSemanticRepresentation(input.source), target = createSemanticRepresentation(input.target);
  const space = semanticSpaceIdentity(source);
  if (semanticSpaceKey(space) !== semanticSpaceKey(semanticSpaceIdentity(target))) {
    throw new TypeError('L8_INCOMPATIBLE_SEMANTIC_SPACE');
  }
  const endpoints = [snapshotEndpoint(source, input.organisationId, policy.comparisonFamily),
    snapshotEndpoint(target, input.organisationId, policy.comparisonFamily)];
  if (source.representationId === target.representationId
    || semanticRepresentationSubjectKey(endpoints[0].subject) === semanticRepresentationSubjectKey(endpoints[1].subject)) {
    throw new TypeError('L8_SELF_MATCH_EXCLUDED');
  }
  endpoints.sort((a, b) => endpointKey(a) < endpointKey(b) ? -1 : 1);
  return Object.freeze({ organisationId: input.organisationId, comparisonFamily: policy.comparisonFamily,
    left: endpoints[0], right: endpoints[1], semanticSpace: space, metric: 'COSINE',
    score: cosine(source.vector, target.vector), algorithmVersion: COSINE_ALGORITHM_VERSION,
    policy, computedAt: input.computedAt });
}

/** Threshold controls emission only. Null means below threshold, never a negative identity decision. */
export function createPossibleMatchCandidate(input: CompareSemanticRepresentationsInput): PossibleMatchCandidate | null {
  const result = compareSemanticRepresentations(input);
  if (result.score < result.policy.threshold) return null;
  return Object.freeze({ ...result, candidateId: candidateIdentity(result), status: 'ANALYTICAL',
    eligibility: 'SAME_TENANT_SPACE_AND_ENTITY_FAMILY' });
}
