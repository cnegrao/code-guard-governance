import { createHash } from 'node:crypto';

import {
  CANONICAL_OBJECT_KIND,
  asNormalizedCandidateId,
  type CanonicalObjectKind,
  type DiscoveryCandidateKind,
  type NormalizedAgentCandidate,
  type NormalizedApiCandidate,
  type NormalizedDataAssetCandidate,
  type NormalizedKnowledgeBaseCandidate,
  type NormalizedMcpServerCandidate,
  type NormalizedModelCandidate,
  type NormalizedObjectCandidate,
  type NormalizedPromptCandidate,
  type NormalizedSkillCandidate,
  type NormalizedToolCandidate,
} from '@council/canonical-contracts';

import { AGENT_KIND_DECLARATION_GENERIC_VALUE } from './strategies/agent-kind-declaration';
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
 * apps/dashboard/lib/governance/discovery-intake.ts have a
 * registered strategy or an intentional AGENT_VERSION-only fail-closed
 * dispatch (AGENT_VERSION candidates never normalize through this map — see
 * agent-version-correlation.ts, the sole producer of a normalized
 * AGENT_VERSION candidate). Framework/Memory/Orchestration technical-profile
 * facts never reach this module at all: they are represented as a
 * structurally separate, non-canonical `TechnicalProfileSignal`
 * (technical-profile-signal.ts), never a `DiscoveryCandidate` of any kind —
 * see agent-version-correlation.ts for how those signals are folded into
 * the AGENT_VERSION technical revision without ever being normalized here.
 * DATA_ASSET/DATA_ELEMENT accept only supported SQL declaration evidence.
 * Elements require an unambiguous parent from the same parsed statement and
 * snapshot; a file or display label alone cannot supply that parent.
 */

export const OBJECT_NORMALIZATION_REASON_CODE = {
  /** No enclosing declaration name was found for the `kind = "agent"` shape (or the detector's own generic fallback literal was all that was observed); no name/code/version can be derived without guessing. */
  AGENT_IDENTITY_NOT_DERIVABLE: 'AGENT_IDENTITY_NOT_DERIVABLE',
  /** The detector's own displayValue was empty/whitespace-only after trimming — never promoted to identity. */
  EMPTY_IDENTITY_VALUE: 'EMPTY_IDENTITY_VALUE',
  /** No normalization strategy exists for this candidateKind (dormant/future kind, or RELATIONSHIP routed here by mistake). */
  UNSUPPORTED_CANDIDATE_KIND: 'UNSUPPORTED_CANDIDATE_KIND',
  DATA_DECLARATION_NOT_SUPPORTED: 'DATA_DECLARATION_NOT_SUPPORTED',
  DATA_PARENT_NOT_RESOLVABLE: 'DATA_PARENT_NOT_RESOLVABLE',
} as const;

export type ObjectNormalizationReasonCode =
  (typeof OBJECT_NORMALIZATION_REASON_CODE)[keyof typeof OBJECT_NORMALIZATION_REASON_CODE];

export type ObjectCandidateNormalizationResult =
  | {
      readonly status: 'NORMALIZED';
      readonly candidate: NormalizedObjectCandidate;
      /** Exact parent resolved by scanner normalization, for intake durability/mapping checks. */
      readonly parentDataAsset?: NormalizedDataAssetCandidate;
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
  normalize(candidate: DiscoveryCandidate, context?: ObjectNormalizationContext): ObjectCandidateNormalizationResult;
}

export interface ObjectNormalizationContext {
  readonly candidates: readonly DiscoveryCandidate[];
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
 * AGENT: AgentKindDeclarationSpecification's displayValue is the name of the
 * Python `class Name:` or TypeScript/JavaScript `const name = {...}`
 * declaration that structurally encloses a `kind = "agent"` marker (see
 * strategies/agent-kind-declaration.ts) — an explicit, already-in-source
 * identifier, exactly the same kind of evidence MODEL/TOOL promote for their
 * own kinds. When no such enclosing declaration was found, the detector
 * falls back to the fixed literal `"agent"`
 * (AGENT_KIND_DECLARATION_GENERIC_VALUE), which proves only the structural
 * shape and is never promoted to identity: every current detector run that
 * only observes the bare structural marker still fails closed here, exactly
 * as before this strategy could derive a real declaration name.
 */
export class AgentCandidateNormalizationStrategy implements ObjectCandidateNormalizationStrategy {
  readonly candidateKind: CanonicalObjectKind = CANONICAL_OBJECT_KIND.AGENT;

  normalize(candidate: DiscoveryCandidate): ObjectCandidateNormalizationResult {
    const agentCode = candidate.displayValue.trim();

    if (!isNonBlank(agentCode) || agentCode.toLowerCase() === AGENT_KIND_DECLARATION_GENERIC_VALUE) {
      return {
        status: 'NOT_SAFELY_NORMALIZABLE',
        candidateKind: candidate.finding.candidateKind,
        reasonCode: OBJECT_NORMALIZATION_REASON_CODE.AGENT_IDENTITY_NOT_DERIVABLE,
      };
    }

    const normalized: NormalizedAgentCandidate = {
      candidateId: buildObjectCandidateId(this.candidateKind, candidate.finding.findingId),
      candidateKind: 'AGENT',
      sourceObject: candidate.finding.sourceObject,
      findingId: candidate.finding.findingId,
      assertionIds: candidate.finding.assertionIds,
      evidenceIds: candidate.finding.evidenceIds,
      confidence: candidate.finding.confidence,
      requiresReconciliation: true,
      proposedIdentity: { agentCode },
    };
    return { status: 'NORMALIZED', candidate: normalized };
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

/**
 * PROMPT: PromptDeclarationSpecification's displayValue IS the captured
 * `<NAME>_PROMPT` constant identifier (see strategies/prompt-declaration.ts,
 * a real convention already used by the frozen Golden Repository fixtures,
 * not invented by this PR) — safe to promote directly to
 * proposedIdentity.declarationKey. Raw prompt content (the constant's own
 * string value) is never captured by this detector and therefore never
 * enters identity.
 */
export class PromptCandidateNormalizationStrategy implements ObjectCandidateNormalizationStrategy {
  readonly candidateKind: CanonicalObjectKind = CANONICAL_OBJECT_KIND.PROMPT;

  normalize(candidate: DiscoveryCandidate): ObjectCandidateNormalizationResult {
    const declarationKey = candidate.displayValue.trim();
    if (!isNonBlank(declarationKey)) {
      return {
        status: 'NOT_SAFELY_NORMALIZABLE',
        candidateKind: candidate.finding.candidateKind,
        reasonCode: OBJECT_NORMALIZATION_REASON_CODE.EMPTY_IDENTITY_VALUE,
      };
    }

    const normalized: NormalizedPromptCandidate = {
      candidateId: buildObjectCandidateId(this.candidateKind, candidate.finding.findingId),
      candidateKind: 'PROMPT',
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

/**
 * MCP_SERVER: McpServerDeclarationSpecification's displayValue IS the real
 * `serverIdentity` field of a structured `mcp.json`-shaped config file, or a
 * named key of a real `mcpServers`/`servers` dictionary (see
 * strategies/mcp-server-declaration.ts — both shapes are real, pre-existing
 * conventions, one from the frozen Golden Repository oracle, one from
 * codeguard/agent-detector.ts's own legacy config parsing; neither is
 * invented by this PR) — safe to promote directly to
 * proposedIdentity.serverReference.
 */
export class McpServerCandidateNormalizationStrategy implements ObjectCandidateNormalizationStrategy {
  readonly candidateKind: CanonicalObjectKind = CANONICAL_OBJECT_KIND.MCP_SERVER;

  normalize(candidate: DiscoveryCandidate): ObjectCandidateNormalizationResult {
    const serverReference = candidate.displayValue.trim();
    if (!isNonBlank(serverReference)) {
      return {
        status: 'NOT_SAFELY_NORMALIZABLE',
        candidateKind: candidate.finding.candidateKind,
        reasonCode: OBJECT_NORMALIZATION_REASON_CODE.EMPTY_IDENTITY_VALUE,
      };
    }

    const normalized: NormalizedMcpServerCandidate = {
      candidateId: buildObjectCandidateId(this.candidateKind, candidate.finding.findingId),
      candidateKind: 'MCP_SERVER',
      sourceObject: candidate.finding.sourceObject,
      findingId: candidate.finding.findingId,
      assertionIds: candidate.finding.assertionIds,
      evidenceIds: candidate.finding.evidenceIds,
      confidence: candidate.finding.confidence,
      requiresReconciliation: true,
      proposedIdentity: { serverReference },
    };
    return { status: 'NORMALIZED', candidate: normalized };
  }
}

/**
 * API: ApiDeclarationSpecification's displayValue IS the explicit `id`
 * field of a `<NAME>_API = { "id": "...", ... }` object literal — the same
 * real convention the frozen Golden Repository fixture `06-care-coordination`
 * already uses (see strategies/api-declaration.ts), not invented by this
 * PR — safe to promote directly to proposedIdentity.apiReference. A bare
 * URL is never this detector's own evidence (see the detector's own doc
 * comment), so no arbitrary-URL false positive can reach this
 * normalization strategy.
 */
export class ApiCandidateNormalizationStrategy implements ObjectCandidateNormalizationStrategy {
  readonly candidateKind: CanonicalObjectKind = CANONICAL_OBJECT_KIND.API;

  normalize(candidate: DiscoveryCandidate): ObjectCandidateNormalizationResult {
    const apiReference = candidate.displayValue.trim();
    if (!isNonBlank(apiReference)) {
      return {
        status: 'NOT_SAFELY_NORMALIZABLE',
        candidateKind: candidate.finding.candidateKind,
        reasonCode: OBJECT_NORMALIZATION_REASON_CODE.EMPTY_IDENTITY_VALUE,
      };
    }

    const normalized: NormalizedApiCandidate = {
      candidateId: buildObjectCandidateId(this.candidateKind, candidate.finding.findingId),
      candidateKind: 'API',
      sourceObject: candidate.finding.sourceObject,
      findingId: candidate.finding.findingId,
      assertionIds: candidate.finding.assertionIds,
      evidenceIds: candidate.finding.evidenceIds,
      confidence: candidate.finding.confidence,
      requiresReconciliation: true,
      proposedIdentity: { apiReference },
    };
    return { status: 'NORMALIZED', candidate: normalized };
  }
}

/**
 * KNOWLEDGE_BASE: KnowledgeBaseDeclarationSpecification's displayValue IS
 * the nested `identity` field of a top-level `knowledge_base:` YAML block —
 * the same real convention the frozen Golden Repository fixture
 * `06-care-coordination` already uses (see
 * strategies/knowledge-base-declaration.ts), not invented by this PR — safe
 * to promote directly to proposedIdentity.sourceReference.
 */
export class KnowledgeBaseCandidateNormalizationStrategy implements ObjectCandidateNormalizationStrategy {
  readonly candidateKind: CanonicalObjectKind = CANONICAL_OBJECT_KIND.KNOWLEDGE_BASE;

  normalize(candidate: DiscoveryCandidate): ObjectCandidateNormalizationResult {
    const sourceReference = candidate.displayValue.trim();
    if (!isNonBlank(sourceReference)) {
      return {
        status: 'NOT_SAFELY_NORMALIZABLE',
        candidateKind: candidate.finding.candidateKind,
        reasonCode: OBJECT_NORMALIZATION_REASON_CODE.EMPTY_IDENTITY_VALUE,
      };
    }

    const normalized: NormalizedKnowledgeBaseCandidate = {
      candidateId: buildObjectCandidateId(this.candidateKind, candidate.finding.findingId),
      candidateKind: 'KNOWLEDGE_BASE',
      sourceObject: candidate.finding.sourceObject,
      findingId: candidate.finding.findingId,
      assertionIds: candidate.finding.assertionIds,
      evidenceIds: candidate.finding.evidenceIds,
      confidence: candidate.finding.confidence,
      requiresReconciliation: true,
      proposedIdentity: { sourceReference },
    };
    return { status: 'NORMALIZED', candidate: normalized };
  }
}

/**
 * SKILL: SkillListDeclarationSpecification's displayValue IS the directory
 * name from a real `.claude/skills/<name>/SKILL.md` path — the same
 * already-shipped convention codeguard/agent-detector.ts's own
 * CONFIG_DETECTORS already recognizes as definitive (see
 * strategies/skill-list-declaration.ts), not invented by this PR — safe to
 * promote directly to proposedIdentity.declarationReference (the field name
 * SkillIdentity's own contract uses).
 */
export class SkillCandidateNormalizationStrategy implements ObjectCandidateNormalizationStrategy {
  readonly candidateKind: CanonicalObjectKind = CANONICAL_OBJECT_KIND.SKILL;

  normalize(candidate: DiscoveryCandidate): ObjectCandidateNormalizationResult {
    const declarationReference = candidate.displayValue.trim();
    if (!isNonBlank(declarationReference)) {
      return {
        status: 'NOT_SAFELY_NORMALIZABLE',
        candidateKind: candidate.finding.candidateKind,
        reasonCode: OBJECT_NORMALIZATION_REASON_CODE.EMPTY_IDENTITY_VALUE,
      };
    }

    const normalized: NormalizedSkillCandidate = {
      candidateId: buildObjectCandidateId(this.candidateKind, candidate.finding.findingId),
      candidateKind: 'SKILL',
      sourceObject: candidate.finding.sourceObject,
      findingId: candidate.finding.findingId,
      assertionIds: candidate.finding.assertionIds,
      evidenceIds: candidate.finding.evidenceIds,
      confidence: candidate.finding.confidence,
      requiresReconciliation: true,
      proposedIdentity: { declarationReference },
    };
    return { status: 'NORMALIZED', candidate: normalized };
  }
}

function sourceScope(candidate: DiscoveryCandidate): string {
  const source = candidate.finding.sourceObject;
  return JSON.stringify([source.connectionId, source.externalType, source.externalId]);
}

/** Internal consistency boundary for trusted scanner output, not authentication. */
function hasSqlDeclarationEvidence(candidate: DiscoveryCandidate): boolean {
  const { finding, assertion, evidence, dataDeclaration: declaration } = candidate;
  const method = finding.candidateKind === 'DATA_ASSET' ? 'sql-create-table-asset' : 'sql-create-table-element';
  return !!declaration?.sourceReference.trim() && /^[a-f0-9]{64}$/.test(declaration.statementFingerprint) &&
    !!finding.sourceObject.connectionId && finding.sourceObject.externalType === 'file' &&
    finding.sourceObject.externalId.endsWith('.sql') && assertion.method?.code === method &&
    assertion.method.version === '1.0.0' && assertion.trustState === 'DECLARED' &&
    assertion.snapshot?.contentHash?.algorithm === 'sha256' && !!assertion.snapshot.contentHash.value &&
    JSON.stringify(assertion.sourceObject) === JSON.stringify(finding.sourceObject) &&
    JSON.stringify(assertion.snapshot.sourceObject) === JSON.stringify(finding.sourceObject) &&
    finding.assertionIds.includes(assertion.assertionId) && finding.evidenceIds.includes(evidence.evidenceId) &&
    assertion.evidenceIds.includes(evidence.evidenceId) && !!evidence.redactedExcerpt?.trim() &&
    evidence.hashes.some(hash => hash.algorithm === 'sha256' && hash.value === assertion.snapshot!.contentHash!.value) &&
    evidence.locations.some(location => location.kind === 'REPOSITORY' &&
      location.path === finding.sourceObject.externalId && typeof location.lineStart === 'number' && location.lineStart > 0);
}

class SqlDataCandidateNormalizationStrategy implements ObjectCandidateNormalizationStrategy {
  constructor(readonly candidateKind: 'DATA_ASSET' | 'DATA_ELEMENT') {}
  normalize(candidate: DiscoveryCandidate, context?: ObjectNormalizationContext): ObjectCandidateNormalizationResult {
    const fail = (reasonCode: ObjectNormalizationReasonCode): ObjectCandidateNormalizationResult => ({
      status: 'NOT_SAFELY_NORMALIZABLE', candidateKind: candidate.finding.candidateKind, reasonCode,
    });
    if (!hasSqlDeclarationEvidence(candidate)) return fail(OBJECT_NORMALIZATION_REASON_CODE.DATA_DECLARATION_NOT_SUPPORTED);
    const declaration = candidate.dataDeclaration!;
    const base = {
      candidateId: buildObjectCandidateId(this.candidateKind, candidate.finding.findingId),
      sourceObject: candidate.finding.sourceObject, findingId: candidate.finding.findingId,
      assertionIds: candidate.finding.assertionIds, evidenceIds: candidate.finding.evidenceIds,
      confidence: candidate.finding.confidence, requiresReconciliation: true as const,
    };
    if (this.candidateKind === 'DATA_ASSET') {
      if (declaration.elementPath !== undefined || candidate.displayValue !== declaration.sourceReference) {
        return fail(OBJECT_NORMALIZATION_REASON_CODE.DATA_DECLARATION_NOT_SUPPORTED);
      }
      return { status: 'NORMALIZED', candidate: { ...base, candidateKind: 'DATA_ASSET',
        proposedIdentity: { sourceReference: declaration.sourceReference } } };
    }
    if (!declaration.elementPath?.trim() || candidate.displayValue !== declaration.elementPath) {
      return fail(OBJECT_NORMALIZATION_REASON_CODE.DATA_DECLARATION_NOT_SUPPORTED);
    }
    const parents = (context?.candidates ?? []).filter(parent => parent.finding.candidateKind === 'DATA_ASSET' &&
      sourceScope(parent) === sourceScope(candidate) &&
      parent.dataDeclaration?.sourceReference === declaration.sourceReference);
    // Count before filtering for validity: a second conflicting parent must not
    // disappear merely because its evidence/statement/snapshot is different.
    if (parents.length !== 1) return fail(OBJECT_NORMALIZATION_REASON_CODE.DATA_PARENT_NOT_RESOLVABLE);
    const parent = parents[0];
    if (parent.dataDeclaration?.statementFingerprint !== declaration.statementFingerprint ||
      parent.assertion.snapshot?.snapshotId !== candidate.assertion.snapshot?.snapshotId ||
      parent.assertion.snapshot?.contentHash?.value !== candidate.assertion.snapshot?.contentHash?.value) {
      return fail(OBJECT_NORMALIZATION_REASON_CODE.DATA_PARENT_NOT_RESOLVABLE);
    }
    const result = normalizeObjectCandidate(parent);
    if (result.status !== 'NORMALIZED' || result.candidate.candidateKind !== 'DATA_ASSET') {
      return fail(OBJECT_NORMALIZATION_REASON_CODE.DATA_PARENT_NOT_RESOLVABLE);
    }
    return { status: 'NORMALIZED', parentDataAsset: result.candidate, candidate: {
      ...base, candidateKind: 'DATA_ELEMENT', proposedIdentity: {
        parentDataAsset: { referenceKind: 'CANDIDATE', candidateKind: 'DATA_ASSET', candidateId: result.candidate.candidateId },
        elementPath: declaration.elementPath,
      },
    } };
  }
}

const OBJECT_NORMALIZATION_STRATEGIES: ReadonlyMap<CanonicalObjectKind, ObjectCandidateNormalizationStrategy> =
  new Map([
    [CANONICAL_OBJECT_KIND.AGENT, new AgentCandidateNormalizationStrategy()],
    [CANONICAL_OBJECT_KIND.MODEL, new ModelCandidateNormalizationStrategy()],
    [CANONICAL_OBJECT_KIND.TOOL, new ToolCandidateNormalizationStrategy()],
    [CANONICAL_OBJECT_KIND.PROMPT, new PromptCandidateNormalizationStrategy()],
    [CANONICAL_OBJECT_KIND.MCP_SERVER, new McpServerCandidateNormalizationStrategy()],
    [CANONICAL_OBJECT_KIND.API, new ApiCandidateNormalizationStrategy()],
    [CANONICAL_OBJECT_KIND.KNOWLEDGE_BASE, new KnowledgeBaseCandidateNormalizationStrategy()],
    [CANONICAL_OBJECT_KIND.SKILL, new SkillCandidateNormalizationStrategy()],
    [CANONICAL_OBJECT_KIND.DATA_ASSET, new SqlDataCandidateNormalizationStrategy('DATA_ASSET')],
    [CANONICAL_OBJECT_KIND.DATA_ELEMENT, new SqlDataCandidateNormalizationStrategy('DATA_ELEMENT')],
  ]);

/**
 * Object Candidate Normalization V1 dispatch boundary — the single entry
 * point callers (apps/dashboard's Discovery Intake) should use. Routes a
 * DiscoveryCandidate to the strategy registered for its candidateKind; a
 * kind with no registered strategy (AGENT_VERSION uses its existing dedicated
 * correlation producer; RELATIONSHIP is not an object) fails closed.
 */
export function normalizeObjectCandidate(
  candidate: DiscoveryCandidate,
  context?: ObjectNormalizationContext,
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

  return strategy.normalize(candidate, context);
}
