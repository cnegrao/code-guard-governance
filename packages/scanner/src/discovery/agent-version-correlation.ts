import { createHash } from 'node:crypto';

import {
  CANONICAL_OBJECT_KIND,
  FINDING_REVIEW_STATUS,
  asDiscoveryFindingId,
  asIsoTimestamp,
  asNormalizedCandidateId,
  type EvidenceId,
  type NormalizedAgentVersionCandidate,
  type ObjectDiscoveryFinding,
  type PreCanonicalObjectReference,
  type SourceAssertionId,
  type SourceObjectIdentity,
} from '@council/canonical-contracts';

import type { DiscoveryCandidate } from './evidence-assembly';
import { normalizeObjectCandidate } from './object-candidate-normalization';
import { TECHNICAL_PROFILE_SIGNAL_KIND, type TechnicalProfileSignal } from './technical-profile-signal';

/**
 * One evidence-backed AGENT_VERSION candidate: the canonical
 * {@link ObjectDiscoveryFinding}<"AGENT_VERSION"> envelope plus the canonical
 * pre-reconciliation candidate it backs. Mirrors
 * RelationshipCorrelationResult's shape (relationship-correlation.ts) — an
 * AGENT_VERSION is, like a relationship, a correlation product across
 * multiple already-produced {@link DiscoveryCandidate}s, never a single
 * detector's own match: no detector observes "a version" directly.
 */
export interface AgentVersionCorrelationResult {
  readonly finding: ObjectDiscoveryFinding<'AGENT_VERSION'>;
  readonly candidate: NormalizedAgentVersionCandidate;
}

function stableSuffix(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function dedupeIds<Id extends string>(ids: readonly Id[]): readonly Id[] {
  return Object.freeze(Array.from(new Set(ids)).sort());
}

/**
 * Extracts the one proposed-identity value each of the L4 Round 1 correlated
 * object kinds contributes to the technical revision projection — a full
 * discriminated-union switch (no `as` casts) so every new kind added to
 * NormalizedObjectCandidate must be handled explicitly here or it is simply
 * never counted as evidence, never silently miscounted as another kind's.
 */
function extractNormalizedIdentityValue(candidate: DiscoveryCandidate): string | undefined {
  const normalized = normalizeObjectCandidate(candidate);
  if (normalized.status !== 'NORMALIZED') return undefined;
  const { candidate: normalizedCandidate } = normalized;
  switch (normalizedCandidate.candidateKind) {
    case 'MODEL':
      return normalizedCandidate.proposedIdentity.modelReference;
    case 'TOOL':
      return normalizedCandidate.proposedIdentity.declarationKey;
    case 'PROMPT':
      return normalizedCandidate.proposedIdentity.declarationKey;
    case 'MCP_SERVER':
      return normalizedCandidate.proposedIdentity.serverReference;
    case 'API':
      return normalizedCandidate.proposedIdentity.apiReference;
    case 'KNOWLEDGE_BASE':
      return normalizedCandidate.proposedIdentity.sourceReference;
    case 'SKILL':
      return normalizedCandidate.proposedIdentity.declarationReference;
    default:
      return undefined;
  }
}

function extractNormalizedValues(list: readonly DiscoveryCandidate[]): readonly string[] {
  const values: string[] = [];
  for (const item of list) {
    const value = extractNormalizedIdentityValue(item);
    if (value) values.push(value);
  }
  return values;
}

function fileGroupKey(identity: SourceObjectIdentity): string {
  return JSON.stringify([identity.connectionId, identity.externalType, identity.externalId]);
}

const TECHNICAL_PROFILE_SIGNAL_LABEL: Record<TechnicalProfileSignal['signalKind'], string> = {
  [TECHNICAL_PROFILE_SIGNAL_KIND.FRAMEWORK]: 'framework',
  [TECHNICAL_PROFILE_SIGNAL_KIND.MEMORY]: 'memory',
  [TECHNICAL_PROFILE_SIGNAL_KIND.ORCHESTRATION]: 'orchestration',
};

/**
 * Canonical projection of the agent-relevant discovery *technical* evidence
 * this milestone's Discovery Engine actually possesses, used to derive a
 * deterministic AGENT_VERSION technical-revision fingerprint (see the
 * milestone evidence document's AGENT_VERSION_FINGERPRINT_INPUTS for the
 * exact, documented input list).
 *
 * Deliberately semantic-only. It must never include anything from
 * provenance/record identity — no findingId, no sourceObject/locator, no
 * line number, no timestamp, no candidate traversal order — because a
 * technical revision is a statement about *what the Agent is technically
 * bound to*, not *where or when that binding was observed*. Provenance and
 * cross-source collision protection are handled entirely separately by
 * {@link buildSourceScope}; mixing the two here would make an unrelated
 * formatting/comment/blank-line change elsewhere in the same file (which
 * can shift the parent AGENT's own findingId — see evidence-assembly.ts)
 * incorrectly produce a new AGENT_VERSION even though nothing agent-relevant
 * changed.
 *
 * Every input is sorted and deduplicated so input order never changes the
 * projection.
 *
 * L4 Round 1 extension: every newly-supported correlated canonical-object
 * kind (Prompt/MCP_SERVER/API/KNOWLEDGE_BASE/SKILL) and every accepted
 * AgentVersion technical-profile signal (Framework/Memory/Orchestration —
 * see technical-profile-signal.ts; Technology/Build and Guardrail/HITL are
 * not implemented in this round, see the evidence document) is folded in
 * here, using the exact same sorted+deduplicated `<label>:<value>`
 * projection shape MODEL/TOOL already established. Technical-profile
 * signals contribute only their own semantic `value` — never their
 * assertion/evidence id, sourceObject, or line position — for the same
 * provenance-vs-technical-revision separation reason as every other input.
 */
function buildTechnicalRevisionProjection(params: {
  readonly agentCode: string;
  readonly modelReferences: readonly string[];
  readonly toolDeclarationKeys: readonly string[];
  readonly promptDeclarationKeys: readonly string[];
  readonly mcpServerReferences: readonly string[];
  readonly apiReferences: readonly string[];
  readonly knowledgeBaseSourceReferences: readonly string[];
  readonly skillDeclarationReferences: readonly string[];
  readonly technicalProfileSignalValues: Readonly<Record<TechnicalProfileSignal['signalKind'], readonly string[]>>;
}): readonly string[] {
  const sortedLabeled = (label: string, values: readonly string[]) =>
    Array.from(new Set(values)).sort().map((value) => `${label}:${value}`);

  return [
    `agent-code:${params.agentCode}`,
    ...sortedLabeled('model', params.modelReferences),
    ...sortedLabeled('tool', params.toolDeclarationKeys),
    ...sortedLabeled('prompt', params.promptDeclarationKeys),
    ...sortedLabeled('mcp', params.mcpServerReferences),
    ...sortedLabeled('api', params.apiReferences),
    ...sortedLabeled('kb', params.knowledgeBaseSourceReferences),
    ...sortedLabeled('skill', params.skillDeclarationReferences),
    // Iterated in a fixed order (never insertion/traversal order) so the
    // projection stays stable regardless of signal-detection order.
    ...(Object.keys(TECHNICAL_PROFILE_SIGNAL_LABEL) as Array<TechnicalProfileSignal['signalKind']>)
      .sort()
      .flatMap((kind) => sortedLabeled(TECHNICAL_PROFILE_SIGNAL_LABEL[kind], params.technicalProfileSignalValues[kind] ?? [])),
  ];
}

/**
 * Deterministic source-scope identity: which discovered source declaration
 * this AGENT_VERSION candidate belongs to, derived only from the parent
 * AGENT's own {@link SourceObjectIdentity} (connectionId + externalType +
 * externalId — the existing, already-canonical file/connection identity
 * every DiscoveryCandidate carries, see evidence-assembly.ts). Deliberately
 * excludes match line numbers: two occurrences of the exact same enclosing
 * declaration in the exact same file remain the same source scope even if
 * an unrelated edit elsewhere in that file shifts where the matched
 * `kind = "agent"` line sits. Two different files, or the same file under a
 * different SourceConnection, always produce a different source scope —
 * this is what keeps two unrelated Agents that happen to share the same
 * agentCode and the same correlated Model/Tool identities from colliding
 * into one AGENT_VERSION identity, without borrowing that protection from
 * technical-revision content.
 */
function buildSourceScope(sourceObject: SourceObjectIdentity): string {
  return stableSuffix([sourceObject.connectionId, sourceObject.externalType, sourceObject.externalId]);
}

/**
 * Correlates one already-normalizable AGENT candidate with the MODEL/TOOL/
 * PROMPT/MCP_SERVER/API/KNOWLEDGE_BASE/SKILL candidates and AgentVersion
 * technical-profile signals correlated alongside it in the same source
 * artifact (same "exactly one Agent per file" rule relationship-correlation.ts
 * already uses for USES_MODEL/USES_TOOL) into one evidence-backed
 * AGENT_VERSION candidate.
 *
 * Correlation and fail-closed rules (deterministic, source-scoped):
 *
 *   - Exactly one AGENT candidate per file, and that AGENT candidate must
 *     itself be safely normalizable
 *     (`normalizeObjectCandidate` returns `NORMALIZED`) — an AGENT with no
 *     real logical identity can never own a version. Zero or more than one
 *     AGENT candidate in the same file is ambiguous and yields no
 *     AGENT_VERSION, matching relationship correlation's own posture.
 *   - At least one MODEL, TOOL, PROMPT, MCP_SERVER, API, KNOWLEDGE_BASE, or
 *     SKILL candidate correlated in the same file (itself normalizable), OR
 *     at least one AgentVersion technical-profile signal (Framework/Memory/
 *     Orchestration), is required as version-relevant technical evidence
 *     beyond the AGENT's own logical identity ("Minimum evidence for
 *     AGENT_VERSION"). An AGENT with no correlated technical evidence fails
 *     closed here rather than emitting a placeholder version, even though
 *     its own AGENT candidate may still normalize independently.
 *   - The AGENT_VERSION's findingId/candidateId are derived from two
 *     deliberately separate deterministic inputs, combined only at the very
 *     last step (see {@link buildTechnicalRevisionProjection} and
 *     {@link buildSourceScope}):
 *       (1) a purely semantic TECHNICAL REVISION fingerprint — a canonical,
 *           sorted, deduplicated projection of the AGENT's own normalized
 *           agentCode plus every correlated technical fact's own value,
 *           never a findingId, sourceObject, line number, wall-clock value,
 *           random UUID, or candidate traversal order;
 *       (2) a SOURCE SCOPE identity — the parent AGENT's own
 *           SourceObjectIdentity (connectionId + externalType + externalId)
 *           only, never a line number.
 *     Identical technical inputs under the identical source scope always
 *     reproduce the identical AGENT_VERSION identity; a materially
 *     different technical input set, or a different source scope, always
 *     produces a different one. Critically, an unrelated formatting/
 *     comment/blank-line change elsewhere in the same file — which can
 *     shift the parent AGENT's own findingId without changing its
 *     declaration name, sourceObject, or any correlated technical evidence
 *     — changes neither input and therefore never creates a new
 *     AGENT_VERSION: RECORD ID (findingId) != SEMANTIC VERSION IDENTITY.
 *   - No versionCode is ever fabricated: this V1 correlation observes no
 *     trustworthy explicit version declaration anywhere in the current
 *     Discovery Engine, so `proposedIdentity.versionCode` is always left
 *     absent rather than invented (no "1.0.0"/"v1"/"latest"/UUID/timestamp).
 *     `NormalizedAgentVersionCandidate.proposedIdentity` has no field for a
 *     derived technical-revision value (only `agent` and `versionCode`) —
 *     the frozen V1A.1d canonical contract explicitly defers true
 *     TechnicalFingerprint/BehaviorFingerprint-based AgentVersion tracking
 *     to a later, post-canonicalization `AgentVersionTechnicalProfile`
 *     (contracts.ts:1104-1112), not this Discovery-stage candidate. This
 *     module therefore expresses the technical-revision distinction the
 *     same way every other Discovery-stage candidate kind (AGENT, MODEL,
 *     TOOL) already expresses its own deterministic identity: through the
 *     candidate's own findingId/candidateId, never inside proposedIdentity.
 */
export function correlateAgentVersions(
  candidates: readonly DiscoveryCandidate[],
  technicalProfileSignals: readonly TechnicalProfileSignal[],
  options: { readonly observedAt: string },
): readonly AgentVersionCorrelationResult[] {
  const byFile = new Map<string, DiscoveryCandidate[]>();
  for (const candidate of candidates) {
    const key = fileGroupKey(candidate.finding.sourceObject);
    const bucket = byFile.get(key);
    if (bucket) {
      bucket.push(candidate);
    } else {
      byFile.set(key, [candidate]);
    }
  }

  const signalsByFile = new Map<string, TechnicalProfileSignal[]>();
  for (const signal of technicalProfileSignals) {
    const key = fileGroupKey(signal.sourceObject);
    const bucket = signalsByFile.get(key);
    if (bucket) {
      bucket.push(signal);
    } else {
      signalsByFile.set(key, [signal]);
    }
  }

  const results: AgentVersionCorrelationResult[] = [];

  for (const key of Array.from(byFile.keys()).sort()) {
    const bucket = byFile.get(key) ?? [];
    const agents = bucket.filter((candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.AGENT);
    if (agents.length !== 1) continue;
    const [agent] = agents;

    const normalizedAgent = normalizeObjectCandidate(agent);
    if (normalizedAgent.status !== 'NORMALIZED' || normalizedAgent.candidate.candidateKind !== 'AGENT') continue;
    const { agentCode } = normalizedAgent.candidate.proposedIdentity;
    if (!agentCode) continue;

    const models = bucket.filter((candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.MODEL);
    const tools = bucket.filter((candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.TOOL);
    const prompts = bucket.filter((candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.PROMPT);
    const mcpServers = bucket.filter(
      (candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.MCP_SERVER,
    );
    const apis = bucket.filter((candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.API);
    const knowledgeBases = bucket.filter(
      (candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.KNOWLEDGE_BASE,
    );
    const skills = bucket.filter((candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.SKILL);
    const technicalProfileSignalsInFile = signalsByFile.get(key) ?? [];

    const correlatedObjectCandidates = [...models, ...tools, ...prompts, ...mcpServers, ...apis, ...knowledgeBases, ...skills];

    // Defensive fail-closed check, mirroring relationship correlation's own:
    // never correlate candidates/signals observed under different source connections.
    if (
      correlatedObjectCandidates.some(
        (candidate) => candidate.finding.sourceObject.connectionId !== agent.finding.sourceObject.connectionId,
      ) ||
      technicalProfileSignalsInFile.some(
        (signal) => signal.sourceObject.connectionId !== agent.finding.sourceObject.connectionId,
      )
    ) {
      continue;
    }

    const normalizedModelReferences = extractNormalizedValues(models);
    const normalizedToolKeys = extractNormalizedValues(tools);
    const normalizedPromptKeys = extractNormalizedValues(prompts);
    const normalizedMcpServerReferences = extractNormalizedValues(mcpServers);
    const normalizedApiReferences = extractNormalizedValues(apis);
    const normalizedKnowledgeBaseReferences = extractNormalizedValues(knowledgeBases);
    const normalizedSkillReferences = extractNormalizedValues(skills);

    const technicalProfileSignalValues: Record<TechnicalProfileSignal['signalKind'], string[]> = {
      [TECHNICAL_PROFILE_SIGNAL_KIND.FRAMEWORK]: [],
      [TECHNICAL_PROFILE_SIGNAL_KIND.MEMORY]: [],
      [TECHNICAL_PROFILE_SIGNAL_KIND.ORCHESTRATION]: [],
    };
    for (const signal of technicalProfileSignalsInFile) {
      technicalProfileSignalValues[signal.signalKind].push(signal.value);
    }
    const hasTechnicalProfileSignalEvidence = Object.values(technicalProfileSignalValues).some(
      (values) => values.length > 0,
    );

    // Minimum evidence for AGENT_VERSION: the AGENT's own logical identity
    // is never sufficient on its own. Any correlated technical evidence —
    // Model/Tool (V1) or a Round-1 addition (Prompt/MCP/API/Knowledge Base/
    // Skill/technical-profile signal) — satisfies this rule.
    if (
      normalizedModelReferences.length === 0 &&
      normalizedToolKeys.length === 0 &&
      normalizedPromptKeys.length === 0 &&
      normalizedMcpServerReferences.length === 0 &&
      normalizedApiReferences.length === 0 &&
      normalizedKnowledgeBaseReferences.length === 0 &&
      normalizedSkillReferences.length === 0 &&
      !hasTechnicalProfileSignalEvidence
    ) {
      continue;
    }

    const projection = buildTechnicalRevisionProjection({
      agentCode,
      modelReferences: normalizedModelReferences,
      toolDeclarationKeys: normalizedToolKeys,
      promptDeclarationKeys: normalizedPromptKeys,
      mcpServerReferences: normalizedMcpServerReferences,
      apiReferences: normalizedApiReferences,
      knowledgeBaseSourceReferences: normalizedKnowledgeBaseReferences,
      skillDeclarationReferences: normalizedSkillReferences,
      technicalProfileSignalValues,
    });
    const technicalRevisionFingerprint = stableSuffix(projection);
    const sourceScope = buildSourceScope(agent.finding.sourceObject);
    // sourceScopedAgentVersionCandidateId = HASH(sourceScope + technicalRevisionFingerprint):
    // provenance/source-scope and technical revision are combined only here,
    // at the very last step, never earlier — see buildTechnicalRevisionProjection
    // and buildSourceScope's own doc comments for why they must stay separate
    // inputs rather than one merged projection.
    const suffix = stableSuffix([sourceScope, technicalRevisionFingerprint]);

    const correlatedCandidates = [agent, ...correlatedObjectCandidates];
    const assertionIds: readonly SourceAssertionId[] = dedupeIds([
      ...correlatedCandidates.flatMap((candidate) => candidate.finding.assertionIds),
      ...technicalProfileSignalsInFile.map((signal) => signal.assertion.assertionId),
    ]);
    const evidenceIds: readonly EvidenceId[] = dedupeIds([
      ...correlatedCandidates.flatMap((candidate) => candidate.finding.evidenceIds),
      ...technicalProfileSignalsInFile.map((signal) => signal.evidence.evidenceId),
    ]);
    const confidence = Math.min(
      ...correlatedCandidates.map((candidate) => candidate.finding.confidence),
      ...technicalProfileSignalsInFile.map((signal) => signal.confidence),
    );
    const detectedAt = asIsoTimestamp(options.observedAt);

    const finding: ObjectDiscoveryFinding<'AGENT_VERSION'> = {
      findingId: asDiscoveryFindingId(`discovery-finding:agent-version:${suffix}`),
      findingNature: 'CANDIDATE',
      candidateKind: 'AGENT_VERSION',
      // Provenance anchor only (the artifact the correlated evidence came
      // from), not a claim that this one artifact alone proves the version.
      sourceObject: agent.finding.sourceObject,
      assertionIds,
      evidenceIds,
      confidence,
      reviewStatus: FINDING_REVIEW_STATUS.UNREVIEWED,
      requiresReview: true,
      createsCanonicalObject: false,
      detectedAt,
    };

    const agentReference: PreCanonicalObjectReference<'AGENT'> = {
      referenceKind: 'SOURCE_OBJECT',
      sourceObject: agent.finding.sourceObject,
      candidateKind: CANONICAL_OBJECT_KIND.AGENT,
    };

    const candidate: NormalizedAgentVersionCandidate = {
      candidateId: asNormalizedCandidateId(`candidate:agent-version:${suffix}`),
      candidateKind: 'AGENT_VERSION',
      sourceObject: finding.sourceObject,
      findingId: finding.findingId,
      assertionIds,
      evidenceIds,
      confidence: finding.confidence,
      requiresReconciliation: true,
      proposedIdentity: { agent: agentReference },
    };

    results.push({ finding, candidate });
  }

  return Object.freeze(results);
}

/**
 * Named strategy boundary wrapping {@link correlateAgentVersions}, mirroring
 * RelationshipCorrelationStrategy's own class-based shape so the consumption
 * pattern in apps/dashboard/lib/governance/discovery-intake.ts stays
 * consistent across every correlation-derived (non-single-detector)
 * candidate kind.
 */
export class AgentVersionCorrelationStrategy {
  correlate(
    candidates: readonly DiscoveryCandidate[],
    technicalProfileSignals: readonly TechnicalProfileSignal[],
    observedAt: string,
  ): readonly AgentVersionCorrelationResult[] {
    return correlateAgentVersions(candidates, technicalProfileSignals, { observedAt });
  }
}
