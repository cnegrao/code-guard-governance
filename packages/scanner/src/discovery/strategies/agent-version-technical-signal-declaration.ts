import { CANONICAL_OBJECT_KIND } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';
import { scanLines } from './scan-lines';

/**
 * Framework/SDK, Technology/Build, Memory, Orchestration, Guardrail, and
 * HITL are roadmap-required AgentVersion *technical-profile* dimensions
 * (GOVIA-L0L16-CIA-v1.0 §1, L4), never new canonical object kinds (the
 * closed CANONICAL_OBJECT_KIND taxonomy is not extended here) and never a
 * Tool/Skill/KnowledgeBase in disguise. Each of the six detectors below
 * captures its own explicit, single-purpose declaration literal —
 * deliberately narrow, mirroring the same explicit-literal-declaration
 * contract MODEL_REFERENCE already uses — and is distinguished from every
 * other one only by its own `code` and confidence, so each fact keeps its
 * own independent evidence/provenance trail (never a single opaque
 * "technicalProfile" blob).
 *
 * These six candidates deliberately share `candidateKind: AGENT_VERSION`:
 * they are evidence *about* an AgentVersion's technical configuration, not
 * an independently governable object in their own right, and Object
 * Candidate Normalization V1 has no registered strategy for them (see
 * object-candidate-normalization.ts) — they fail closed to
 * NOT_SAFELY_NORMALIZABLE / UNSUPPORTED_CANDIDATE_KIND exactly like any
 * other unsupported kind, and are never promoted to a standalone
 * ReviewSubject (apps/dashboard/lib/governance/discovery-intake.ts routes
 * them only into AgentVersion correlation's own evidence union — see
 * agent-version-correlation.ts). No canonical `AgentVersionTechnicalProfile`
 * record is materialized from this evidence in this milestone: the
 * canonical contract's `runtimeFrameworkReference` / `buildReference` fields
 * exist (contracts.ts:1096-1112) but have zero materialization-writer
 * infrastructure anywhere in this repository today, for any of the seven
 * *TechnicalProfile kinds — a pre-existing gap this milestone does not
 * close (see the milestone evidence document's Persistence/Migration
 * status). Memory, Orchestration, and Guardrail/HITL have no dedicated
 * AgentVersionTechnicalProfile field at all (only a generic
 * `configurationReference`, which this milestone does not overload with
 * multiple distinct facts — that would lose per-fact provenance). All six
 * remain honestly Discovery-evidence-only / not-yet-governed.
 *
 * Design-time-only by construction: every detector here only ever observes
 * already-checked-in source text, so any HITL evidence captured is
 * necessarily a design-time declaration (TRUST_STATE.INFERRED, fixed in
 * evidence-assembly.ts), never a runtime observation of actual human
 * intervention — "DESIGN-TIME DECLARATION != RUNTIME OBSERVATION" is
 * preserved by construction, not by a special case here.
 */

function singleLiteralPattern(keyNames: readonly string[]): RegExp {
  return new RegExp(`^\\s*(?:${keyNames.join('|')})\\s*[:=]\\s*["']([^"']+)["']\\s*,?\\s*$`);
}

const FRAMEWORK_REFERENCE_PATTERN = singleLiteralPattern(['FRAMEWORK_REFERENCE', 'frameworkReference']);
const BUILD_REFERENCE_PATTERN = singleLiteralPattern(['BUILD_REFERENCE', 'buildReference']);
const MEMORY_REFERENCE_PATTERN = singleLiteralPattern(['MEMORY_REFERENCE', 'memoryReference']);
const ORCHESTRATION_REFERENCE_PATTERN = singleLiteralPattern(['ORCHESTRATION_REFERENCE', 'orchestrationReference']);
const GUARDRAIL_REFERENCE_PATTERN = singleLiteralPattern(['GUARDRAIL_REFERENCE', 'guardrailReference']);
const HITL_REFERENCE_PATTERN = singleLiteralPattern(['HITL_REFERENCE', 'hitlReference']);

/** Framework/SDK technical-profile signal (e.g. `FRAMEWORK_REFERENCE = "langgraph"`). */
export class FrameworkReferenceDeclarationSpecification implements DetectionSpecification {
  readonly code = 'framework-reference-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.AGENT_VERSION;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    return scanLines(artifact.text, FRAMEWORK_REFERENCE_PATTERN, 0.6, (match) => match[1]);
  }
}

/** Technology/Build technical-profile signal (e.g. `BUILD_REFERENCE = "py3.11-slim"`). */
export class BuildReferenceDeclarationSpecification implements DetectionSpecification {
  readonly code = 'build-reference-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.AGENT_VERSION;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    return scanLines(artifact.text, BUILD_REFERENCE_PATTERN, 0.6, (match) => match[1]);
  }
}

/** Memory/session technical-profile signal. Never conflated with KNOWLEDGE_BASE. */
export class MemoryReferenceDeclarationSpecification implements DetectionSpecification {
  readonly code = 'memory-reference-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.AGENT_VERSION;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    return scanLines(artifact.text, MEMORY_REFERENCE_PATTERN, 0.6, (match) => match[1]);
  }
}

/** Orchestration/control-flow technical-profile signal. Never conflated with TOOL. */
export class OrchestrationReferenceDeclarationSpecification implements DetectionSpecification {
  readonly code = 'orchestration-reference-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.AGENT_VERSION;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    return scanLines(artifact.text, ORCHESTRATION_REFERENCE_PATTERN, 0.6, (match) => match[1]);
  }
}

/** Technical guardrail/safety-restriction technical-profile signal. */
export class GuardrailReferenceDeclarationSpecification implements DetectionSpecification {
  readonly code = 'guardrail-reference-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.AGENT_VERSION;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    return scanLines(artifact.text, GUARDRAIL_REFERENCE_PATTERN, 0.6, (match) => match[1]);
  }
}

/**
 * HITL design/configuration technical-profile signal. Proves only a
 * design-time declaration of a human-intervention point, never that the
 * intervention actually occurred at runtime (see this module's own doc
 * comment).
 */
export class HitlReferenceDeclarationSpecification implements DetectionSpecification {
  readonly code = 'hitl-reference-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.AGENT_VERSION;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    return scanLines(artifact.text, HITL_REFERENCE_PATTERN, 0.6, (match) => match[1]);
  }
}

/** Stable set of every technical-signal detector's own `code`, used to
 * distinguish a technical-signal AGENT_VERSION-kind candidate from a real
 * correlation-produced AGENT_VERSION candidate (see agent-version-correlation.ts). */
export const AGENT_VERSION_TECHNICAL_SIGNAL_CODES = Object.freeze([
  'framework-reference-declaration',
  'build-reference-declaration',
  'memory-reference-declaration',
  'orchestration-reference-declaration',
  'guardrail-reference-declaration',
  'hitl-reference-declaration',
] as const);

export type AgentVersionTechnicalSignalCode =
  (typeof AGENT_VERSION_TECHNICAL_SIGNAL_CODES)[number];
