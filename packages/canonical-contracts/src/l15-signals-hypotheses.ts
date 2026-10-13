import type { CanonicalObjectKind } from './contracts.ts';
import type { CrossSignalOutcome } from './cross-signal-comparison.ts';
import type { L14ControlAssessmentOutcome } from './l14-control-assessment.ts';
import {
  L15_SIGNAL_KIND_SOURCES, L15_UPSTREAM_EVIDENCE_TAGS, type L15HypothesisGeneratorKind, type L15SignalKind,
  type L15SignalSourceClass, type L15SignalTrustState, type L15SupportTargetTag,
} from './l15-risk-intelligence.ts';

/**
 * M17-S1 — RISK_SIGNAL / RISK_HYPOTHESIS intake contracts and reference adapters (ADR-GOVIA-RISK-INTELLIGENCE-v1 §§4-5, 9;
 * DB: 20261012210000_m17_s1_signals_hypotheses_support_v1.sql). Pure types and mappings; PostgreSQL is the arbiter of every
 * rule (closed vocabularies, exact same-tenant targets, replay fingerprint, recorded_at). Nothing here is authority:
 * a signal / hypothesis is never governed risk, never VALIDATED, never a decision, state, head or rating.
 */

/** Closed UNRESOLVED subject reasons — reused verbatim from the L12 runtime binding contract (no new value invented). */
export const L15_UNRESOLVED_REASONS = [
  'MISSING_REVISION_EVIDENCE', 'NO_EXACT_MAPPING', 'AMBIGUOUS_MAPPING', 'UNSUPPORTED_BINDING_PROOF',
] as const;
export type L15UnresolvedReason = (typeof L15_UNRESOLVED_REASONS)[number];

/** Trust a signal may carry per source class (M16 §8 origin rules). GOVERNED_FACT_REFERENCE / LOCAL_HUMAN own none. */
export const L15_SIGNAL_SOURCE_TRUST: Record<L15SignalSourceClass, readonly L15SignalTrustState[]> = {
  SYSTEM_DETECTOR: ['INFERRED', 'DECLARED'],
  SOURCE_CONNECTION: ['IMPORTED'],
  RUNTIME_SOURCE: ['OBSERVED'],
  GOVERNED_FACT_REFERENCE: [],
  LOCAL_HUMAN: [],
};

/** Non-authoritative source severity labels (stored as hint_severity only; never a rating band, domain or lifecycle). */
export const L15_HINT_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type L15HintSeverity = (typeof L15_HINT_SEVERITIES)[number];

/** Rank-0 target tags each signal kind may cite (the DB `l15_support_links_signal_kind_target_check`). */
export const L15_SIGNAL_KIND_TARGETS: Record<L15SignalKind, readonly L15SupportTargetTag[]> = {
  DETECTED_PATTERN: ['DISCOVERY_EVIDENCE', 'SOURCE_ASSERTION', 'TECHNICAL_FIELD_STATE'],
  DETECTED_ABSENCE: ['DISCOVERY_EVIDENCE', 'SOURCE_ASSERTION', 'TECHNICAL_FIELD_STATE'],
  RUNTIME_OBSERVATION_REF: ['RUNTIME_OBSERVATION'],
  CROSS_SIGNAL_RESULT_REF: ['CROSS_SIGNAL_RESULT'],
  EXECUTION_CONTEXT_REF: ['EXECUTION_FIELD_STATE'],
  CONTROL_ASSESSMENT_REF: ['L14_FACT_STATE'],
  GOVERNANCE_GAP_REF: L15_UPSTREAM_EVIDENCE_TAGS,
  LINEAGE_REF: ['LINEAGE_OBSERVATION'],
  IMPORTED_ASSERTION: ['SOURCE_ASSERTION'],
  HUMAN_OBSERVATION: L15_UPSTREAM_EVIDENCE_TAGS,
};

/** §4.3: only these M15 outcomes may become a CROSS_SIGNAL_RESULT_REF. CONSISTENT never does. */
export const L15_ADMISSIBLE_CROSS_SIGNAL_OUTCOMES = ['CONFLICT_CANDIDATE', 'INSUFFICIENT_EVIDENCE', 'DRIFT_CANDIDATE'] as const satisfies readonly CrossSignalOutcome[];
/** §4.3: only these M16 CONTROL_ASSESSMENT outcomes may become a CONTROL_ASSESSMENT_REF. SATISFIED never does. */
export const L15_ADMISSIBLE_CONTROL_ASSESSMENT_OUTCOMES = [
  'NOT_SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_ASSESSED', 'INSUFFICIENT_EVIDENCE',
] as const satisfies readonly L14ControlAssessmentOutcome[];

/** GOVERNANCE_GAP_REF closed gap queries over the existing M16 bounded current reads. */
export const L15_GOVERNANCE_GAP_FAMILIES = ['RESPONSIBILITY_ASSIGNMENT', 'BUSINESS_CONTEXT_ASSIGNMENT', 'CONTROL_ASSESSMENT'] as const;
export type L15GovernanceGapFamily = (typeof L15_GOVERNANCE_GAP_FAMILIES)[number];

export interface L15SupportRef { readonly tag: L15SupportTargetTag; readonly targetId: string }

export type L15Subject =
  | { readonly mode: 'CANONICAL_OBJECT'; readonly kind: CanonicalObjectKind; readonly canonicalObjectId: string }
  | { readonly mode: 'RELATIONSHIP_STATE'; readonly relationshipId: string; readonly relationshipStateId: string }
  | { readonly mode: 'UNRESOLVED'; readonly reason: L15UnresolvedReason };

export type L15GovernanceGapQuery =
  | { readonly family: 'RESPONSIBILITY_ASSIGNMENT'; readonly responsibilityRole: 'BUSINESS_OWNER' | 'TECHNICAL_OWNER' | 'DATA_OWNER' | 'DATA_STEWARD' }
  | { readonly family: 'BUSINESS_CONTEXT_ASSIGNMENT'; readonly semanticKind: 'BUSINESS_DOMAIN' | 'INFORMATION_DOMAIN' }
  | { readonly family: 'CONTROL_ASSESSMENT'; readonly controlDefinitionId: string };

/**
 * A machine signal intake command (gov_repo.l15_admit_machine_signal_v1). Deliberately has NO domain, rating, score,
 * lifecycle, status, owner, title, description or amount field: a signal carries none of them.
 */
export interface L15MachineSignalCommand {
  readonly organisationId: string;
  readonly intakeKey: string;
  readonly signalKind: Exclude<L15SignalKind, 'HUMAN_OBSERVATION'>;
  readonly sourceClass: Exclude<L15SignalSourceClass, 'LOCAL_HUMAN'>;
  readonly subject: L15Subject;
  readonly trustState: L15SignalTrustState | null;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly hintSeverity: L15HintSeverity | null;
  readonly hintConfidence: number | null;
  readonly observedAt: string | null;
  readonly gap: L15GovernanceGapQuery | null;
  readonly support: readonly L15SupportRef[];
}

export interface L15MachineHypothesisCommand {
  readonly organisationId: string;
  readonly intakeKey: string;
  readonly generatorKind: Exclude<L15HypothesisGeneratorKind, 'HUMAN'>;
  readonly subject: Exclude<L15Subject, { mode: 'UNRESOLVED' }>;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly llm: { readonly modelProvider: string; readonly modelId: string; readonly promptTemplateVersion: string } | null;
  readonly traversalPolicyVersion: string | null;
  readonly representationVersion: string | null;
  readonly hintConfidence: number | null;
  readonly citedSignalIds: readonly string[];
}

export class L15ContractError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = 'L15ContractError'; }
}

/** TS mirror of the DB rules a well-formed machine signal command must satisfy (the DB re-checks every one). */
export function validateL15MachineSignalCommand(c: L15MachineSignalCommand): L15MachineSignalCommand {
  const kind = c.signalKind as string;
  if (!Object.hasOwn(L15_SIGNAL_KIND_SOURCES, kind) || kind === 'HUMAN_OBSERVATION') throw new L15ContractError('SIGNAL_KIND_UNKNOWN');
  if (L15_SIGNAL_KIND_SOURCES[c.signalKind] !== c.sourceClass) throw new L15ContractError('SIGNAL_SOURCE_MISMATCH');
  if ((c.trustState as string) === 'VALIDATED') throw new L15ContractError('TRUST_VALIDATED_FORBIDDEN');
  const allowed = L15_SIGNAL_SOURCE_TRUST[c.sourceClass];
  if (allowed.length === 0 ? c.trustState !== null : !allowed.includes(c.trustState as L15SignalTrustState)) {
    throw new L15ContractError('TRUST_SOURCE_MISMATCH');
  }
  if (!c.methodId || !c.methodVersion) throw new L15ContractError('METHOD_VERSION_REQUIRED');
  if (c.support.length < 1) throw new L15ContractError('MACHINE_SIGNAL_REQUIRES_EVIDENCE');
  for (const ref of c.support) {
    if (!L15_SIGNAL_KIND_TARGETS[c.signalKind].includes(ref.tag)) throw new L15ContractError('SUPPORT_TAG_NOT_ADMISSIBLE');
  }
  if ((c.hintSeverity !== null || c.hintConfidence !== null) && c.sourceClass !== 'SYSTEM_DETECTOR' && c.sourceClass !== 'SOURCE_CONNECTION') {
    throw new L15ContractError('HINT_NOT_ADMISSIBLE');
  }
  if (c.hintConfidence !== null && !(c.hintConfidence >= 0 && c.hintConfidence <= 1)) throw new L15ContractError('HINT_CONFIDENCE_RANGE');
  if ((c.signalKind === 'GOVERNANCE_GAP_REF') !== (c.gap !== null)) throw new L15ContractError('GOVERNANCE_GAP_SHAPE');
  return c;
}

export function validateL15MachineHypothesisCommand(c: L15MachineHypothesisCommand): L15MachineHypothesisCommand {
  if (!c.methodId || !c.methodVersion) throw new L15ContractError('METHOD_VERSION_REQUIRED');
  if ((c.generatorKind === 'LLM_ASSISTED') !== (c.llm !== null)
      || (c.llm && (!c.llm.modelProvider || !c.llm.modelId || !c.llm.promptTemplateVersion))) {
    throw new L15ContractError('LLM_PROVENANCE_REQUIRED');
  }
  if ((c.generatorKind === 'GRAPH_ANALYSIS') !== (c.traversalPolicyVersion !== null)) throw new L15ContractError('TRAVERSAL_POLICY_VERSION_REQUIRED');
  if ((c.generatorKind === 'VECTOR_RETRIEVAL') !== (c.representationVersion !== null)) throw new L15ContractError('REPRESENTATION_VERSION_REQUIRED');
  if (c.citedSignalIds.length < 1) throw new L15ContractError('HYPOTHESIS_REQUIRES_SIGNAL');
  if ((c.subject as { mode: string }).mode === 'UNRESOLVED') throw new L15ContractError('SUBJECT_SHAPE_INVALID');
  return c;
}

/**
 * Presentation of a signal's observation (O18). DETECTED_ABSENCE is literally "not detected" — never "absent", "missing
 * control", "failed", "NOT_SATISFIED", "false" or "non-compliant" (UNKNOWN != FALSE). A governance gap reads "unknown".
 */
export function l15SignalObservationPresentation(kind: L15SignalKind): 'not detected' | 'detected' | 'unknown' | 'referenced' {
  switch (kind) {
    case 'DETECTED_ABSENCE': return 'not detected';
    case 'DETECTED_PATTERN': return 'detected';
    case 'GOVERNANCE_GAP_REF': return 'unknown';
    default: return 'referenced';
  }
}
/** Every signal / hypothesis read is labelled non-authoritative. */
export const L15_SIGNAL_AUTHORITY = 'NON_AUTHORITATIVE' as const;

// ---------------------------------------------------------------------------------------------------------------------
// Exact-reference adapters (M15 / L12 / L11 / M16 / lineage). Each emits ONLY a typed reference to the existing record:
// no outcome, latency, error, token, cost, principal, grant, environment, egress, M16 fact content or lineage value is
// copied. Admissibility the DB enforces is pre-checked here to fail fast.
// ---------------------------------------------------------------------------------------------------------------------
interface ReferenceBase { readonly organisationId: string; readonly intakeKey: string; readonly subject: L15Subject;
  readonly methodId: string; readonly methodVersion: string }

const reference = (base: ReferenceBase, signalKind: L15MachineSignalCommand['signalKind'],
  sourceClass: L15MachineSignalCommand['sourceClass'], trustState: L15SignalTrustState | null,
  support: readonly L15SupportRef[], gap: L15GovernanceGapQuery | null = null): L15MachineSignalCommand =>
  validateL15MachineSignalCommand({ organisationId: base.organisationId, intakeKey: base.intakeKey, signalKind, sourceClass,
    subject: base.subject, trustState, methodId: base.methodId, methodVersion: base.methodVersion, hintSeverity: null,
    hintConfidence: null, observedAt: null, gap, support });

/** M15 adapter: exact reference to one CrossSignalComparisonResult. CONSISTENT is rejected. */
export function crossSignalResultSignal(base: ReferenceBase, result: { readonly comparisonId: string; readonly outcome: CrossSignalOutcome }) {
  if (!(L15_ADMISSIBLE_CROSS_SIGNAL_OUTCOMES as readonly string[]).includes(result.outcome)) {
    throw new L15ContractError('CROSS_SIGNAL_RESULT_NOT_ADMISSIBLE');
  }
  return reference(base, 'CROSS_SIGNAL_RESULT_REF', 'GOVERNED_FACT_REFERENCE', null, [{ tag: 'CROSS_SIGNAL_RESULT', targetId: result.comparisonId }]);
}
/** L12 adapter: exact reference to existing runtime observation rows (OBSERVED; no metric copied). */
export function runtimeObservationSignal(base: ReferenceBase, observationIds: readonly string[]) {
  return reference(base, 'RUNTIME_OBSERVATION_REF', 'RUNTIME_SOURCE', 'OBSERVED',
    observationIds.map(targetId => ({ tag: 'RUNTIME_OBSERVATION' as const, targetId })));
}
/** L11 adapter: exact reference to execution-field states (no inferred authorization). */
export function executionContextSignal(base: ReferenceBase, executionFieldStateIds: readonly string[]) {
  return reference(base, 'EXECUTION_CONTEXT_REF', 'GOVERNED_FACT_REFERENCE', null,
    executionFieldStateIds.map(targetId => ({ tag: 'EXECUTION_FIELD_STATE' as const, targetId })));
}
/** M16 adapter: exact reference to a CONTROL_ASSESSMENT state whose outcome is admissible (SATISFIED is rejected). */
export function controlAssessmentSignal(base: ReferenceBase, state: { readonly factStateId: string; readonly outcome: L14ControlAssessmentOutcome }) {
  if (!(L15_ADMISSIBLE_CONTROL_ASSESSMENT_OUTCOMES as readonly string[]).includes(state.outcome)) {
    throw new L15ContractError('CONTROL_ASSESSMENT_NOT_ADMISSIBLE');
  }
  return reference(base, 'CONTROL_ASSESSMENT_REF', 'GOVERNED_FACT_REFERENCE', null, [{ tag: 'L14_FACT_STATE', targetId: state.factStateId }]);
}
/**
 * M16 governance-gap adapter: the DB performs the deterministic read at DB-authored coordinates and refuses when a current
 * fact exists. The cited support establishes the subject / requirement; it is never fabricated (no support -> rejected).
 */
export function governanceGapSignal(base: ReferenceBase, gap: L15GovernanceGapQuery, support: readonly L15SupportRef[]) {
  return reference(base, 'GOVERNANCE_GAP_REF', 'GOVERNED_FACT_REFERENCE', null, support, gap);
}
/** Lineage adapter: exact reference to existing lineage candidate observations. */
export function lineageSignal(base: ReferenceBase, observationFindingIds: readonly string[]) {
  return reference(base, 'LINEAGE_REF', 'GOVERNED_FACT_REFERENCE', null,
    observationFindingIds.map(targetId => ({ tag: 'LINEAGE_OBSERVATION' as const, targetId })));
}
