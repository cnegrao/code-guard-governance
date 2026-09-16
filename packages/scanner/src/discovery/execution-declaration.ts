import { createHash } from 'node:crypto';
import { asEvidenceId, asSourceAssertionId, createEvidence, createExecutionFact, sanitizeEvidenceLocator,
  type Evidence, type SourceAssertion, type ExecutionFact } from '@council/canonical-contracts';
import type { DiscoveryCandidate } from './evidence-assembly';
import type { SourceArtifactContent } from './source-adapter';
import { directExecutionSources } from './direct-execution-source';
import { findBehaviorDeclarationBinding } from './behavior-declaration-binding';
import { normalizeObjectCandidate } from './object-candidate-normalization';

export interface ExecutionDeclarationFact {
  readonly fact: ExecutionFact;
  readonly assertion: SourceAssertion;
  readonly evidence: Evidence;
  /** Exact existing normalized Tool key and source-scoped candidate, not a new identity. */
  readonly toolCandidateId?: string;
}
export interface ExecutionDeclaration {
  readonly declarationKey: string;
  readonly markerLine: number;
  readonly facts: readonly ExecutionDeclarationFact[];
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Runs on the artifact already acquired by DiscoveryPipeline. No source/provider calls. */
export function attachExecutionDeclarations(artifact: SourceArtifactContent, candidates: readonly DiscoveryCandidate[]): DiscoveryCandidate[] {
  const agents = candidates.filter(c => c.finding.candidateKind === 'AGENT');
  if (agents.length !== 1) return [...candidates];
  const agent = agents[0];
  const normalized = normalizeObjectCandidate(agent);
  if (normalized.status !== 'NORMALIZED' || normalized.candidate.candidateKind !== 'AGENT') return [...candidates];
  const declarationKey = normalized.candidate.proposedIdentity.agentCode;
  if (!declarationKey) return [...candidates];
  const source = directExecutionSources(artifact).filter(s => s.declarationKey === declarationKey);
  // Python retains tools-only support through the existing direct binder; nested
  // execution properties are V1 TS/JS literals, never a newly invented Python syntax.
  if (/\.(ts|js)$/.test(artifact.locator) && source.length !== 1) return [...candidates];
  const facts: ExecutionDeclarationFact[] = [];
  const marker = agent.evidence.locations.find(l => 'lineStart' in l);
  if (!marker || !('lineStart' in marker) || !agent.assertion.snapshot) return [...candidates];
  const markerLine = marker.lineStart;
  if (!markerLine) return [...candidates];
  const add = (fact: ExecutionFact, lineStart: number, lineEnd: number, toolCandidateId?: string) => {
    const safe = createExecutionFact(fact);
    const suffix = digest(['direct-execution-v1', agent.finding.sourceObject, declarationKey,
      agent.assertion.snapshot!.snapshotId, safe, lineStart, lineEnd]);
    // HASH_ONLY proves the bounded semantic projection; never copy the source
    // object or secret-bearing neighbor into an excerpt. Source snapshot is retained.
    const evidence = createEvidence({ evidenceId: asEvidenceId(`execution-evidence:${suffix}`), handling: 'HASH_ONLY',
      locations: [{ kind: 'REPOSITORY', locator: sanitizeEvidenceLocator(artifact.locator), path: artifact.locator, lineStart, lineEnd }],
      hashes: [{ algorithm: 'sha256', value: digest(safe) }], capturedAt: agent.assertion.recordedAt });
    const assertion: SourceAssertion = { ...agent.assertion, assertionId: asSourceAssertionId(`execution-assertion:${suffix}`),
      method: { code: 'DIRECT_AGENT_EXECUTION_V1', version: '1.0' }, trustState: 'DECLARED', evidenceIds: [evidence.evidenceId] };
    facts.push(Object.freeze({ fact: safe, assertion, evidence, ...(toolCandidateId ? { toolCandidateId } : {}) }));
  };
  for (const property of source[0]?.properties ?? []) {
    const binding = findBehaviorDeclarationBinding({ ...artifact, text: source[0].maskedText }, markerLine);
    // A property follows the marker in usual declarations, but source order is
    // immaterial: use any direct body line to prove its enclosing declaration.
    if (!binding || binding.agentDeclarationKey !== declarationKey || binding.agentMarkerLine !== markerLine) return [...candidates];
    add(property.fact, property.lineStart, property.lineEnd);
  }
  for (const tool of candidates.filter(c => c.finding.candidateKind === 'TOOL')) {
    if (!tool.behaviorBinding || tool.behaviorBinding.agentDeclarationKey !== declarationKey || tool.behaviorBinding.agentMarkerLine !== markerLine ||
        tool.assertion.snapshot?.snapshotId !== agent.assertion.snapshot.snapshotId) continue;
    const target = normalizeObjectCandidate(tool);
    if (target.status !== 'NORMALIZED' || target.candidate.candidateKind !== 'TOOL') continue;
    const location = tool.evidence.locations.find(l => 'lineStart' in l);
    if (!location || !('lineStart' in location) || !location.lineStart || !target.candidate.proposedIdentity.declarationKey) continue;
    add({ field: 'CAPABILITY', capabilityReference: target.candidate.proposedIdentity.declarationKey },
      location.lineStart, location.lineEnd ?? location.lineStart, target.candidate.candidateId);
  }
  if (!facts.length) return [...candidates];
  return candidates.map(c => c === agent ? { ...c, executionDeclaration: { declarationKey, markerLine, facts: Object.freeze(facts) } } : c);
}
