import { createHash } from 'node:crypto';

import {
  CANONICAL_OBJECT_KIND,
  asNormalizedCandidateId,
  type CanonicalObjectKind,
  type DiscoveryCandidateKind,
  type NormalizedModelCandidate,
  type NormalizedObjectCandidate,
  type NormalizedToolCandidate,
} from '@council/canonical-contracts';

import type { DiscoveryCandidate } from './evidence-assembly';

/**
 * Object Candidate Normalization V1.
 *
 * Deterministic Discovery-semantic boundary that converts an already
 * evidence-backed {@link DiscoveryCandidate} (produced by the pipeline in
 * evidence-assembly.ts) into a real canonical-contracts
 * {@link NormalizedObjectCandidate} — or an explicit, typed
 * NOT_SAFELY_NORMALIZABLE outcome when the current detector evidence does not
 * prove a trustworthy identity. This module never fabricates identity: it
 * only ever promotes a detector's own displayValue to proposedIdentity when
 * that detector's contract explicitly defines the matched value AS the
 * identifier (see each strategy's doc comment for the specific detector it
 * mirrors). No LLM, no fuzzy matching, no filename guessing.
 *
 * Only the CURRENT production object kinds actually wired into
 * apps/dashboard/lib/governance/discovery-intake.ts (AGENT, MODEL, TOOL) have
 * a registered strategy. Every other CanonicalObjectKind — dormant today,
 * with no detector emitting it — fails closed via the same
 * NOT_SAFELY_NORMALIZABLE outcome rather than being silently normalized the
 * moment a future detector starts producing it.
 */

export const OBJECT_NORMALIZATION_REASON_CODE = {
  /** AgentKindDeclarationSpecification only proves the `kind = "agent"` shape; it never captures a name/code/version. */
  AGENT_IDENTITY_NOT_DERIVABLE: 'AGENT_IDENTITY_NOT_DERIVABLE',
  /** The detector's own displayValue was empty/whitespace-only after trimming — never promoted to identity. */
  EMPTY_IDENTITY_VALUE: 'EMPTY_IDENTITY_VALUE',
  /** No normalization strategy exists for this candidateKind (dormant/future kind, or RELATIONSHIP routed here by mistake). */
  UNSUPPORTED_CANDIDATE_KIND: 'UNSUPPORTED_CANDIDATE_KIND',
} as const;

export type ObjectNormalizationReasonCode =
  (typeof OBJECT_NORMALIZATION_REASON_CODE)[keyof typeof OBJECT_NORMALIZATION_REASON_CODE];

export type ObjectCandidateNormalizationResult =
  | {
      readonly status: 'NORMALIZED';
      readonly candidate: NormalizedObjectCandidate;
    }
  | {
      readonly status: 'NOT_SAFELY_NORMALIZABLE';
      readonly candidateKind: DiscoveryCandidateKind;
      readonly reasonCode: ObjectNormalizationReasonCode;
    };

/**
 * One named normalization rule (Strategy pattern), scoped to exactly one
 * CanonicalObjectKind — mirroring DetectionSpecification's one-rule-per-class
 * shape. Deterministic: the same input DiscoveryCandidate always yields the
 * same result.
 */
export interface ObjectCandidateNormalizationStrategy {
  readonly candidateKind: CanonicalObjectKind;
  normalize(candidate: DiscoveryCandidate): ObjectCandidateNormalizationResult;
}

function stableSuffix(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

/**
 * Shared OBJECT candidate id helper (see runbook: "Prefer one shared helper
 * for OBJECT candidate IDs rather than ad-hoc per-detector hash
 * implementations"). Derived only from the already-deterministic
 * DiscoveryFinding.findingId (itself a stable hash of source connection,
 * locator, detection method/version, match span, and displayValue — see
 * evidence-assembly.ts) plus the candidate kind: no wall-clock input, no
 * random UUID, and — because findingId already folds in the detector's
 * candidateKind — no collision risk across different kinds or different
 * findings sharing the same identity fragment.
 */
function buildObjectCandidateId(kind: CanonicalObjectKind, findingId: string) {
  return asNormalizedCandidateId(`candidate:${kind.toLowerCase()}:${stableSuffix([findingId, kind])}`);
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * AGENT: AgentKindDeclarationSpecification's displayValue is always the
 * fixed literal `"agent"` (see strategies/agent-kind-declaration.ts) — it
 * proves only that the structural `kind = "agent"` shape is present, never a
 * captured agent name, code, or version. None of
 * NormalizedAgentCandidate.proposedIdentity's fields (agentCode, displayName,
 * versionCode) can be derived from this evidence without guessing, so every
 * current AGENT finding fails closed rather than producing an empty,
 * unverifiable candidate merely to make reconciliation callable.
 */
export class AgentCandidateNormalizationStrategy implements ObjectCandidateNormalizationStrategy {
  readonly candidateKind: CanonicalObjectKind = CANONICAL_OBJECT_KIND.AGENT;

  normalize(candidate: DiscoveryCandidate): ObjectCandidateNormalizationResult {
    return {
      status: 'NOT_SAFELY_NORMALIZABLE',
      candidateKind: candidate.finding.candidateKind,
      reasonCode: OBJECT_NORMALIZATION_REASON_CODE.AGENT_IDENTITY_NOT_DERIVABLE,
    };
  }
}

/**
 * MODEL: ModelReferenceDeclarationSpecification's displayValue IS the
 * declared model reference literal captured from `MODEL_REFERENCE = "..."` /
 * `modelReference: "..."` (see strategies/model-reference-declaration.ts) —
 * the detector's entire purpose is to capture that literal, so it is safe
 * (per the detector's own contract) to promote it directly to
 * proposedIdentity.modelReference. No displayName is available from this
 * evidence and is left absent rather than invented.
 */
export class ModelCandidateNormalizationStrategy implements ObjectCandidateNormalizationStrategy {
  readonly candidateKind: CanonicalObjectKind = CANONICAL_OBJECT_KIND.MODEL;

  normalize(candidate: DiscoveryCandidate): ObjectCandidateNormalizationResult {
    const modelReference = candidate.displayValue.trim();
    if (!isNonBlank(modelReference)) {
      return {
        status: 'NOT_SAFELY_NORMALIZABLE',
        candidateKind: candidate.finding.candidateKind,
        reasonCode: OBJECT_NORMALIZATION_REASON_CODE.EMPTY_IDENTITY_VALUE,
      };
    }

    const normalized: NormalizedModelCandidate = {
      candidateId: buildObjectCandidateId(this.candidateKind, candidate.finding.findingId),
      candidateKind: 'MODEL',
      sourceObject: candidate.finding.sourceObject,
      findingId: candidate.finding.findingId,
      assertionIds: candidate.finding.assertionIds,
      evidenceIds: candidate.finding.evidenceIds,
      confidence: candidate.finding.confidence,
      requiresReconciliation: true,
      proposedIdentity: { modelReference },
    };
    return { status: 'NORMALIZED', candidate: normalized };
  }
}

/**
 * TOOL: ToolListDeclarationSpecification's displayValue is a single bare
 * identifier item explicitly bound inside a `tools = [...]` / `tools: [...]`
 * declaration (see strategies/tool-list-declaration.ts) — the detector is
 * deliberately narrow (bare identifiers only, never quoted strings/prose), so
 * that identifier is exactly the tool's declaration key and is safe to
 * promote to proposedIdentity.declarationKey. No displayName is available
 * from this evidence and is left absent rather than invented.
 */
export class ToolCandidateNormalizationStrategy implements ObjectCandidateNormalizationStrategy {
  readonly candidateKind: CanonicalObjectKind = CANONICAL_OBJECT_KIND.TOOL;

  normalize(candidate: DiscoveryCandidate): ObjectCandidateNormalizationResult {
    const declarationKey = candidate.displayValue.trim();
    if (!isNonBlank(declarationKey)) {
      return {
        status: 'NOT_SAFELY_NORMALIZABLE',
        candidateKind: candidate.finding.candidateKind,
        reasonCode: OBJECT_NORMALIZATION_REASON_CODE.EMPTY_IDENTITY_VALUE,
      };
    }

    const normalized: NormalizedToolCandidate = {
      candidateId: buildObjectCandidateId(this.candidateKind, candidate.finding.findingId),
      candidateKind: 'TOOL',
      sourceObject: candidate.finding.sourceObject,
      findingId: candidate.finding.findingId,
      assertionIds: candidate.finding.assertionIds,
      evidenceIds: candidate.finding.evidenceIds,
      confidence: candidate.finding.confidence,
      requiresReconciliation: true,
      proposedIdentity: { declarationKey },
    };
    return { status: 'NORMALIZED', candidate: normalized };
  }
}

const OBJECT_NORMALIZATION_STRATEGIES: ReadonlyMap<CanonicalObjectKind, ObjectCandidateNormalizationStrategy> =
  new Map([
    [CANONICAL_OBJECT_KIND.AGENT, new AgentCandidateNormalizationStrategy()],
    [CANONICAL_OBJECT_KIND.MODEL, new ModelCandidateNormalizationStrategy()],
    [CANONICAL_OBJECT_KIND.TOOL, new ToolCandidateNormalizationStrategy()],
  ]);

/**
 * Object Candidate Normalization V1 dispatch boundary — the single entry
 * point callers (apps/dashboard's Discovery Intake) should use. Routes a
 * DiscoveryCandidate to the strategy registered for its candidateKind; a
 * kind with no registered strategy (every CanonicalObjectKind besides AGENT/
 * MODEL/TOOL today, and defensively RELATIONSHIP, since this function's input
 * type does not statically exclude it) fails closed rather than fabricating
 * a candidate for a kind no current detector actually produces.
 */
export function normalizeObjectCandidate(
  candidate: DiscoveryCandidate,
): ObjectCandidateNormalizationResult {
  const { candidateKind } = candidate.finding;

  if (candidateKind === 'RELATIONSHIP') {
    return {
      status: 'NOT_SAFELY_NORMALIZABLE',
      candidateKind,
      reasonCode: OBJECT_NORMALIZATION_REASON_CODE.UNSUPPORTED_CANDIDATE_KIND,
    };
  }

  const strategy = OBJECT_NORMALIZATION_STRATEGIES.get(candidateKind);
  if (!strategy) {
    return {
      status: 'NOT_SAFELY_NORMALIZABLE',
      candidateKind,
      reasonCode: OBJECT_NORMALIZATION_REASON_CODE.UNSUPPORTED_CANDIDATE_KIND,
    };
  }

  return strategy.normalize(candidate);
}
