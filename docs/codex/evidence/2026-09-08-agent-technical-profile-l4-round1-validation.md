# Agent Technical Profile — L4 Round 1 — Validation Evidence

**Architecture ID:** `GOVIA-L0L16-CIA-v1.0` (FROZEN BASELINE — unchanged by this milestone)
**Base main SHA:** `9386ca3c878a94257112bfead71d206e4adb9977` (PR #23 merge — `fix(discovery): separate agent version revision from provenance`)
**Branch:** `feat/agent-technical-profile-l4-round1`
**PR:** #24
**Date:** 2026-09-08 (original pass), corrected same day after external architecture review

---

## 0. Correction notice

External review of the original PR #24 diff (commit `deef88a`) found three architecture blockers and one mandatory persistence/governance clarification. This document has been rewritten in place (not appended-to) to describe the **corrected** state only. The corrected state supersedes every claim in the original pass. A summary of what was wrong and what changed:

1. **Synthetic Discovery DSL (Blocker #1).** The original pass invented ten never-before-seen declaration keys (`PROMPT_REFERENCE`, `MCP_SERVER_REFERENCE`, `API_REFERENCE`, `KNOWLEDGE_BASE_REFERENCE`, `FRAMEWORK_REFERENCE`, `BUILD_REFERENCE`, `MEMORY_REFERENCE`, `ORCHESTRATION_REFERENCE`, `GUARDRAIL_REFERENCE`, `HITL_REFERENCE`) and then wrote synthetic tests proving those same invented keys could be detected — passing tests against syntax the milestone itself made up, never evidence that the Discovery Engine discovers real technical architecture. **Corrected**: every detector now targets a real, already-existing convention — either the frozen Golden Repository oracle's own fixtures (read, never modified) or the pre-existing legacy `core/framework-detector.ts` / `core/memory-detector.ts` / `codeguard/agent-detector.ts` detection patterns. Two dimensions (Guardrail, HITL) and one (Technology/Build) had no defensible real-source precedent within this correction's inspection scope and are honestly downgraded to `NOT_IMPLEMENTED` — their synthetic detectors were deleted, not relabeled.
2. **Profile fact masquerading as AGENT_VERSION object candidate (Blocker #2).** The original pass gave Framework/Build/Memory/Orchestration/Guardrail/HITL detectors `candidateKind: CANONICAL_OBJECT_KIND.AGENT_VERSION` and then filtered them back out before normalization — a semantic overload where a raw technical signal carried a canonical object kind it was never allowed to become. **Corrected**: a new, structurally separate, non-canonical `TechnicalProfileSignal` type (`technical-profile-signal.ts`) replaces this entirely. It has no `candidateKind` field at all, is never a `DiscoveryCandidate<CanonicalObjectKind>`, and is produced by a parallel `TechnicalProfileSignalSpecification` interface, run by `DiscoveryPipeline` in the same artifact pass but collected into its own `technicalProfileSignals` result array.
3. **All-INFERRED trust (Blocker #3).** The original pass argued every fact was safely `INFERRED` because `evidence-assembly.ts` hardcoded that trust state. **Corrected**: `DetectionMatch` (and the new `TechnicalProfileSignalMatch`) now carry an explicit, per-match `trustState`. Every real-source detector added or corrected in this pass sets `DECLARED` (an import statement, a named JSON config key, a path convention, or a named constant/object-literal declaration is a semantically authoritative position, not a scanner inference) while AGENT/MODEL/TOOL (whose own evidence model was not touched) remain `INFERRED` exactly as before — proven by a mixed-trust regression test on one AgentVersion.
4. **AgentVersionTechnicalProfile persistence (mandatory check).** Re-evaluated in §22 below: the canonical contract's `runtimeFrameworkReference`/`buildReference` fields exist, but no materialization writer exists anywhere in the repository for any of the seven `*TechnicalProfile` kinds — confirmed still true, and building one is judged (with reasons, §22) to be a genuine, disproportionate architectural addition for this round, not an excuse. The determination is unchanged from the original pass but is now justified against the actual persistence/materialization contract shape, not asserted.

Sections below describe only the corrected state.

---

## 1. Base SHA / Branch / Architecture

Unchanged from the original pass: base `9386ca3c878a94257112bfead71d206e4adb9977`, branch `feat/agent-technical-profile-l4-round1`, `GOVIA-L0L16-CIA-v1.0` frozen and unmodified (`git diff --name-only` against base confirms no `docs/architecture/**` file appears in this branch's diff, in either the original or corrected commit).

## 2. Roadmap milestone

Roadmap milestone 3, **AGENT TECHNICAL PROFILE — L4 ROUND 1**. This correction is surgical, not a new milestone: no relationship taxonomy change, no Graph/Vector/Runtime/DataAsset work, no live Discovery trigger, no production/Supabase access.

## 3. PROFILE_SIGNAL_MODEL

`packages/scanner/src/discovery/technical-profile-signal.ts` defines the corrected, structurally separate representation for AgentVersion technical-profile facts that are not canonical objects:

```ts
TECHNICAL_PROFILE_SIGNAL_KIND = { FRAMEWORK, MEMORY, ORCHESTRATION }  // closed, scanner-internal only

TechnicalProfileSignal {
  signalKind: TechnicalProfileSignalKind;
  sourceObject: SourceObjectIdentity;   // reused canonical-contracts type
  value: string;                          // e.g. "LangGraph", "Redis"
  detector: { code: string; version: string };
  assertion: SourceAssertion;             // reused canonical-contracts type, own trustState
  evidence: Evidence;                     // reused canonical-contracts type
  confidence: number;
}
```

It has **no `candidateKind` field of any kind** — it cannot be mistaken for, filtered as, or accidentally routed through anything that expects a `DiscoveryCandidate<CanonicalObjectKind>`. `DiscoveryPipeline` (extended, not replaced — see `pipeline.ts`) runs an optional `signalSpecifications: readonly TechnicalProfileSignalSpecification[]` list in the same single artifact-read pass as the existing `specifications: readonly DetectionSpecification[]`, and returns both `candidates` and `technicalProfileSignals` as separate arrays in `DiscoveryRunResult`. `correlateAgentVersions` now takes `technicalProfileSignals` as an explicit second parameter (alongside `candidates`) and folds each signal's `value` into the technical revision projection by `signalKind`, using only its own `assertion.assertionId`/`evidence.evidenceId` for the AGENT_VERSION's evidence union — never its own `candidateKind`, because it has none.

`apps/dashboard/lib/governance/discovery-intake.ts`'s `processTechnicalProfileSignal` durably persists each signal's `Evidence`/`SourceAssertion` (the same "durable before referenced" invariant every other fact honors) but never calls `ensureReviewSubjectAndPropose` — there is no `DiscoveryFinding`/`candidateKind` to construct one from, so no phantom ReviewSubject can ever exist for a raw technical signal (verified by a dedicated regression test).

Technology/Build, Guardrail, and HITL have **no signal kind** in this closed set — no defensible real-source pattern was found for them within this correction's inspection scope (see §7 below), and none is fabricated to fill the slot.

## 4. TRUST_STATE_DECISION

`DetectionMatch` (detection-specification.ts) and `TechnicalProfileSignalMatch` (technical-profile-signal.ts) both carry `trustState` — optional on `DetectionMatch` (defaults to `INFERRED` in `evidence-assembly.ts` when absent, so AGENT/MODEL/TOOL are completely unaffected by this extension and remain `INFERRED` unchanged), required on `TechnicalProfileSignalMatch` (every specification in that lane is new in this correction and must justify its own trust tier explicitly).

| Detector | Trust | Why |
|---|---|---|
| AGENT (`kind = "agent"`), MODEL (`MODEL_REFERENCE`/`modelReference`), TOOL (`tools = [...]`) | INFERRED (unchanged) | Pre-existing detectors, not touched by this correction; a scanner conclusion from a structural marker, not itself an authoritative declaration position by the frozen contract's own prior classification. |
| PROMPT (`<NAME>_PROMPT = "..."`), API (`<NAME>_API = {"id": "..."}`), KNOWLEDGE_BASE (`knowledge_base:`/`identity:` YAML), MCP_SERVER (`mcp.json`-shaped config), SKILL (`.claude/skills/<name>/SKILL.md` path) | DECLARED | Each sits in a semantically authoritative position the source/config convention itself defines as an explicit identity — a named constant, an object literal's own `id` field, a YAML config key, a JSON config field, or a directory-naming convention — not a scanner inference from prose or a loose keyword. |
| Framework (import statement), Memory (import statement), Orchestration (derived from the same import statement) | DECLARED | An import/require statement is an explicit, unambiguous dependency declaration the language/module system itself defines — never a confidence-based promotion. |

No detector ever produces `OBSERVED` (every one is design-time source only) or `VALIDATED` (that requires governed reconciliation, entirely out of Discovery-stage scope). Mixed trust on one AgentVersion is proven by a dedicated test: AGENT/MODEL stay INFERRED while a same-file Framework/Memory signal is DECLARED, on the same correlated `AGENT_VERSION`.

## 5. REAL_SOURCE_EVIDENCE

Inspected before any implementation (per the correction's own inspection-scope limit): `packages/scanner/src/core/framework-detector.ts`, `packages/scanner/src/core/memory-detector.ts`, `packages/scanner/src/codeguard/agent-detector.ts`, and — because the correction requires "real evidence," not merely "legacy code" — the frozen Golden Repository fixtures those legacy files predate (`packages/scanner/test/discovery-validation-lab/golden-repositories/**`, read only, never modified, never wired to the Lab/oracle harness). The Golden Repository's own `.govia-lab/expected.json` files already model Prompt/API/Knowledge Base/MCP Server with real fixture source, predating this milestone:

| Kind | Real source found | File (read only) |
|---|---|---|
| PROMPT | `<NAME>_PROMPT = "..."` module constant (Python: `SUPPORT_PROMPT`, `CARE_PROMPT`; TS: `export const TRIAGE_PROMPT = "..."`) | `01-simple-agent/src/customer_support_agent.py`, `02-multi-agent/src/triage_agent.ts`, `06-care-coordination/src/care_agent.py` |
| API | `<NAME>_API = { "id": "...", "base_url": "..." }` object literal | `06-care-coordination/src/care_agent.py` |
| KNOWLEDGE_BASE | `knowledge_base:` / nested `identity:` YAML block | `06-care-coordination/config/knowledge-base.yaml` |
| MCP_SERVER | `{ "serverIdentity": "...", "entrypoint": "...", "tools": [...] }` | `04-mcp-not-agent/mcp.json` |
| SKILL | none found in any Golden Repository fixture (confirmed by exhaustive grep) | — |

For SKILL, the correction instead reuses `codeguard/agent-detector.ts`'s own pre-existing, already-shipped `.claude/skills/<name>/SKILL.md` path convention (its `CONFIG_DETECTORS` array already treats this as "definitive").

For Framework/Memory/Orchestration, the correction adapts `core/framework-detector.ts`'s `FRAMEWORK_PATTERNS.imports` and `core/memory-detector.ts`'s `MEMORY_PATTERNS` import lists — **with one necessary fix**: both legacy files' own `imports` regexes only ever match a JS/TS-shaped `import X from "pkg"` / `require("pkg")` statement (verified: `/from\s+['"]@?langgraph\b/i` never matches real Python `from langgraph import StateGraph`, since no quote follows `from` in that form). Every Golden Repository Agent fixture is Python or TS, and a real Python agent is at least as likely to use the unquoted `from module import X` form, so a matching Python-shaped regex was added per technology — a correction to a latent gap in the legacy patterns' actual matching behavior, not a new detection surface (same technology list, same intent, now functionally real in both languages). This was caught by this correction's own regression tests initially failing against a realistic `from langgraph import StateGraph` fixture.

Orchestration is derived from the identical Framework import evidence, not a separate detection surface: only frameworks `codeguard/agent-detector.ts`'s own pre-existing `agentType: "orchestrator"` classification already applies to (LangGraph, CrewAI, Semantic Kernel) also emit an ORCHESTRATION signal.

Neo4j (listed in `core/memory-detector.ts` under its own distinct `type: "knowledge"`, not `"vector_store"`/`"long_term"`) is deliberately excluded from the Memory signal — even the legacy code treats it as conceptually closer to Knowledge Base than Memory, and folding it in would risk exactly the Memory/Knowledge-Base conflation the milestone brief prohibits. It is not detected as either a Memory signal or a KNOWLEDGE_BASE candidate in this round.

No repository-global manifest (`package.json`, `pyproject.toml`, a lockfile) is parsed anywhere in this correction, deliberately: Section 9's attribution-ambiguity warning (a repo-global fact must not blindly attach to one Agent in a monorepo) is sidestepped structurally by only ever detecting single-file, single-declaration, explicit evidence.

## 6. Per-dimension classification (corrected)

| Dimension | Classification | Real-source pattern | Synthetic pattern removed | Trust | Attribution | Governed representation | Technical-revision impact |
|---|---|---|---|---|---|---|---|
| Framework/SDK | REAL_SOURCE_IMPLEMENTED (evidence-only; no canonical profile writer — see §22) | Python/JS import statement (adapted + corrected from `core/framework-detector.ts`) | `FRAMEWORK_REFERENCE = "..."` deleted | DECLARED | same-file only | `TechnicalProfileSignal`, not a governed profile field | YES |
| Technology/Build | NOT_IMPLEMENTED | none found within inspection scope | `BUILD_REFERENCE = "..."` deleted | — | — | — | NO |
| MODEL | IMPLEMENTED (reused as-is) | pre-existing `MODEL_REFERENCE`/`modelReference` | n/a | INFERRED (unchanged) | same-file | NormalizedObjectCandidate → PROPOSED | YES (pre-existing) |
| PROMPT | REAL_SOURCE_IMPLEMENTED | `<NAME>_PROMPT = "..."` (Golden Repository precedent) | `PROMPT_REFERENCE = "..."` deleted | DECLARED | same-file | NormalizedObjectCandidate → PROPOSED | YES |
| TOOL | IMPLEMENTED (reused as-is) | pre-existing `tools = [...]` | n/a | INFERRED (unchanged) | same-file | NormalizedObjectCandidate → PROPOSED | YES (pre-existing) |
| MCP_SERVER | REAL_SOURCE_IMPLEMENTED | `mcp.json`-shaped config, both Golden-Repository flat shape and legacy named-dict shape | `MCP_SERVER_REFERENCE = "..."` deleted | DECLARED | path-scoped (own config file) | NormalizedObjectCandidate → PROPOSED | YES |
| API | REAL_SOURCE_IMPLEMENTED | `<NAME>_API = {"id": "..."}` (Golden Repository precedent) | `API_REFERENCE = "..."` deleted | DECLARED | same-file | NormalizedObjectCandidate → PROPOSED | YES |
| KNOWLEDGE_BASE/RAG | REAL_SOURCE_IMPLEMENTED (Knowledge Base only; RAG/Vector infra out of scope) | `knowledge_base:`/`identity:` YAML (Golden Repository precedent) | `KNOWLEDGE_BASE_REFERENCE = "..."` deleted | DECLARED | own config file | NormalizedObjectCandidate → PROPOSED | YES |
| Memory | REAL_SOURCE_IMPLEMENTED (evidence-only; no canonical profile field exists) | Python/JS import statement (adapted + corrected from `core/memory-detector.ts`, Neo4j excluded) | `MEMORY_REFERENCE = "..."` deleted | DECLARED | same-file | `TechnicalProfileSignal` | YES |
| SKILL | REAL_SOURCE_IMPLEMENTED | `.claude/skills/<name>/SKILL.md` path (reused from `codeguard/agent-detector.ts`) | `skills = [...]` synthetic array deleted (zero Golden Repository precedent found) | DECLARED | path-scoped (own file) | NormalizedObjectCandidate → PROPOSED | YES |
| Orchestration | REAL_SOURCE_IMPLEMENTED (evidence-only; no canonical profile field exists) | derived from the same Framework import evidence, filtered to `agentType: "orchestrator"` frameworks | `ORCHESTRATION_REFERENCE = "..."` deleted | DECLARED | same-file | `TechnicalProfileSignal` | YES |
| Guardrails/HITL | NOT_IMPLEMENTED | none found within inspection scope (the one real precedent found — `06-care-coordination`'s `require_human_approval` tool tagged `methodCode: "HUMAN_APPROVAL_GATE"` in the Golden Repository oracle — models HITL as a Tool sub-classification requiring cross-reference from a bare identifier back to its own function definition elsewhere in the file, a capability no current detector has; implementing it is out of proportion for this correction) | `GUARDRAIL_REFERENCE = "..."` / `HITL_REFERENCE = "..."` deleted | — | — | — | NO |

## 7. Files changed (this correction)

Deleted:
- `packages/scanner/src/discovery/strategies/agent-version-technical-signal-declaration.ts` (the synthetic 6-detector module)

Added:
- `packages/scanner/src/discovery/technical-profile-signal.ts` — the new non-canonical signal type + assembler
- `packages/scanner/src/discovery/strategies/framework-import-signal.ts` — real Framework/Orchestration import detectors
- `packages/scanner/src/discovery/strategies/memory-import-signal.ts` — real Memory import detector

Rewritten (real-source detection, same public class name, same file):
- `strategies/prompt-declaration.ts`, `strategies/mcp-server-declaration.ts`, `strategies/api-declaration.ts`, `strategies/knowledge-base-declaration.ts`, `strategies/skill-list-declaration.ts`

Modified:
- `detection-specification.ts` — `DetectionMatch` gains optional `trustState`
- `evidence-assembly.ts` — `assembleDiscoveryCandidate` uses `match.trustState ?? TRUST_STATE.INFERRED`
- `pipeline.ts` — `DiscoveryPipeline` runs an optional `signalSpecifications` list in the same artifact pass; `DiscoveryRunResult` gains `technicalProfileSignals`
- `agent-version-correlation.ts` — `correlateAgentVersions`/`AgentVersionCorrelationStrategy.correlate` take a new `technicalProfileSignals` parameter; the AGENT_VERSION-kind technical-signal candidate hack is fully removed; `object-candidate-normalization.ts`'s doc comments updated to match
- `object-candidate-normalization.ts` — doc comments only (the 5 normalization strategies needed zero logic changes — they only ever promoted `displayValue`, which the new real-source detectors still supply in the same shape)
- `discovery/index.ts`, `src/index.ts` — export surface updated
- `apps/dashboard/lib/governance/discovery-intake.ts` — new pipeline wiring, `processTechnicalProfileSignal` replaces `isTechnicalSignalCandidate`/`processTechnicalSignalCandidate`
- `apps/dashboard/tests/discovery-intake-service.test.ts` — L4 Round 1 describe block rewritten for real-source multi-file fixtures
- `packages/scanner/test/discovery-engine/agent-version-correlation.test.ts` — `correlate()` call sites updated for the new 3-argument signature
- `packages/scanner/test/discovery-engine/agent-version-technical-signals.test.ts` — fully rewritten for the new `TechnicalProfileSignal` architecture and real import fixtures
- `packages/scanner/test/discovery-engine/l4-round1-object-detection.test.ts` — fully rewritten against real-source fixtures

No file under `docs/architecture/**`, `.claude/**`, `supabase/migrations/**`, `codex-recovery-6101-6240.txt`, or `packages/scanner/test/discovery-validation-lab/**` was modified. No dependency, lockfile, or migration change.

## 8. AGENT_VERSION_TECHNICAL_PROFILE_PERSISTENCE_DECISION

Re-evaluated per the correction's mandatory check, against the actual contract/persistence shape (not merely asserted):

**A. Can the current canonical materialization machinery already carry an `AgentVersionTechnicalProfile` without a schema change?** Inspected: `AgentVersionTechnicalProfile`/`Support` (`contracts.ts:1096-1112`), the object materialization RPC input shape (`ObjectMaterializationInput`, `materializationPersistence`), and every other canonical-object `*TechnicalProfile` (Model/Tool/MCP/API/Prompt/KB/Skill). **Finding: no.** `ObjectMaterializationInput`/`materialize_object_reconciliation` carries a canonical object's *identity* fields (from `proposedIdentity`) through reconciliation into `gov_repo.canonical_objects`; it has no parameter or persisted column anywhere for a *profile* record layered on top of an already-materialized object, for any of the seven `*TechnicalProfile` kinds. This is not specific to `AgentVersionTechnicalProfile` — confirmed by exhaustive grep, zero production code anywhere constructs a `ModelTechnicalProfile`/`ToolTechnicalProfile`/etc. either.

**B. Is the limitation merely an implementation writer gap that can be solved without changing frozen semantics?** Yes, in principle — the contract shape (`agentVersionId` + typed fields + `support: {field: {assertionIds, evidenceIds}}`) is fully specified and requires no new type. But implementing it requires: (1) a materialization-stage trigger point that does not exist today (materialization currently only ever writes a `canonical_objects` identity row, never a companion profile row, for any kind), (2) a decision about where a profile row lives (a new table, or a JSONB column on `canonical_objects` — either is a genuine, non-trivial persistence decision this correction was explicitly told not to make casually — "no unnecessary migration," "any migration must be additive... contain no speculative future fields"), and (3) doing it for `AgentVersionTechnicalProfile` alone, while leaving the other six kinds' identical gap untouched, would be an arbitrary, inconsistent scope boundary with no principled justification. Building a *correct*, consistent writer for all seven kinds is a materially larger unit of work than "Round 1 of L4 detection" and risks exactly the kind of casual, unreviewed persistence decision the correction brief warns against making merely to avoid saying "not yet."

**Decision: NOT_IMPLEMENTED, not a STOP_REQUIRES_ARCHITECTURE_DECISION.** No frozen semantic needs to change — the contract already supports this correctly — but no minimal, safe writer was implemented in this correction, because doing so responsibly would require a persistence-layer design decision (a new table vs. an extension to the existing materialization RPCs) that is out of proportion for a "Round 1" detection milestone and was not requested with enough scope to make that call correctly. This is recorded honestly as a limitation, not disguised as done. **PERSISTENCE_CONTRACT_GAP**: no materialization-stage row exists for any `*TechnicalProfile` kind. **CURRENT_MATERIALIZATION_LIMIT**: `materialize_object_reconciliation` writes only canonical identity, never a profile. **SMALLEST_REQUIRED_ARCHITECTURAL_CHANGE** (if ever undertaken): one additive table (e.g. `gov_repo.canonical_object_technical_profiles`, keyed by `canonical_object_id` + typed JSONB per field with its own `assertion_ids`/`evidence_ids` arrays) plus one new RPC invoked after `materialize_object_reconciliation` succeeds — deliberately not implemented here.

Memory/Orchestration/Guardrail/HITL correctly have **no** dedicated profile field to target in the first place (only a generic `configurationReference` exists, and overloading it with multiple distinct facts was rejected — see §3/§6) — for these, "no writer" is not merely a persistence gap, it is a missing *governed slot*, an even stronger reason they remain evidence-only.

## 9. TECHNICAL_REVISION_FINGERPRINT_CHANGE vs SOURCE_SCOPED_CANDIDATE_CHANGE

Preserved exactly from the prior milestone's own separation (commit `ab12dfb`), extended with new inputs:

```
TECHNICAL_REVISION_INPUTS = [
  "agent-code:<agentCode>",
  "model:<value>", "tool:<value>", "prompt:<value>", "mcp:<value>",
  "api:<value>", "kb:<value>", "skill:<value>",       // sorted+deduplicated, 0..n each
  "framework:<value>", "memory:<value>", "orchestration:<value>",  // NEW, sorted+deduplicated, 0..n each
]
technicalRevisionFingerprint = sha256(canonicalize(TECHNICAL_REVISION_INPUTS))[0:32]

SOURCE_SCOPE_INPUTS = [connectionId, externalType, externalId]   // parent AGENT's own SourceObjectIdentity only
sourceScope = sha256(canonicalize(SOURCE_SCOPE_INPUTS))[0:32]

candidateId suffix = sha256(canonicalize([sourceScope, technicalRevisionFingerprint]))[0:32]
```

**TECHNICAL_REVISION_FINGERPRINT_CHANGE** (a genuinely different AgentVersion): a correlated fact's own semantic *value* changes — a different Model/Tool/Prompt/API/Framework/Memory value, a Prompt's constant identifier changing (not its string content), an API's `id` field changing (not its `base_url`), a Skill added/removed. Regression-tested: changing a Framework import (`langgraph` → `crewai`), changing a correlated Skill set, changing an API's `id` field each produce a different `candidateId`.

**SOURCE_SCOPED_DISCOVERY_CANDIDATE_CHANGE** (never itself a technical-revision change): an unrelated comment/blank-line insertion in the same file (shifts the parent AGENT's own `findingId`, never `technicalRevisionFingerprint`); a Prompt's own string *content* changing while its constant name stays the same (identity is the name, never the content — regression-tested); traversal/detection order; duplicate identical evidence; the wall-clock scan time. **Moving a source file to a different location or SourceConnection changes `sourceScope` (a different `candidateId`), but this is a provenance-scope change, never a claim that the technical-revision content itself changed** — the two are combined only in the final id, at the very last step, exactly as before. A cross-file technical signal (e.g. a Framework import in a different, unrelated file) never attributes into another file's AgentVersion at all — regression-tested by asserting the correlated AGENT_VERSION's own `assertionIds` never include an unrelated file's signal's assertion id.

## 10. Governance continuity

Unchanged authority ceiling: every new/corrected canonical object kind (Prompt/MCP_SERVER/API/KNOWLEDGE_BASE/SKILL) reuses the exact same `ensureReviewSubjectAndPropose` DETECTED→PROPOSED boundary every existing kind already uses. Technical-profile signals (Framework/Memory/Orchestration) are durably evidenced (`recordEvidence`/`recordSourceAssertion`) but structurally cannot reach `ensureReviewSubjectAndPropose` at all — that function requires a `DiscoveryFinding<DiscoveryCandidateKind>`, which a `TechnicalProfileSignal` simply does not have. This is now enforced by the type system, not by a runtime filter that could regress silently (the original Blocker #2 defect was exactly such a filter).

## 11. Relationship semantics

Unchanged. Zero diff on `relationship-correlation.ts` in either the original or corrected pass (confirmed by `git diff --name-only`). `USES_MODEL`/`USES_TOOL` correlation remains AGENT-sourced. No new `GOVERNED_RELATIONSHIP_TYPE`. No relationship materialized for any new object kind.

## 12. Test results (corrected)

| Suite | Command | Result |
|---|---|---|
| Scanner discovery-engine (unit) | `npm run test:discovery-engine` (packages/scanner) | **157/157 passing** |
| Scanner discovery-engine typecheck | `npm run typecheck:discovery-engine` | clean |
| Scanner full package typecheck | `npm run typecheck` (packages/scanner) | clean |
| Discovery Validation Lab | `npm run test:validation-lab` (packages/scanner) | **51/51 passing**, unchanged — not re-run repeatedly per the correction's own validation-scope instruction, confirmed green once |
| Dashboard targeted governance tests | `discovery-intake-service.test.ts` + `reconciliation-readiness.test.ts` (apps/dashboard) | **28/28 passing** |
| Dashboard workspace typecheck | `npx tsc --noEmit -p tsconfig.json` (apps/dashboard) | clean |
| `git diff --check` | repo root | clean |

`canonical-contracts` was not modified in this correction (only type-only imports of already-exported, unmodified contracts changed), so its own suites were not re-run.

## 13. Adversarial review (corrected pass)

Re-run against the corrected diff:

- **A (wrong AgentVersion attribution):** unchanged same-file correlation rule; new regression test proves an unrelated file's Framework signal is never cited by another file's AGENT_VERSION.
- **B (repository-global metadata duplication):** no manifest parsing added; structurally impossible.
- **C (profile field vs canonical object confusion):** now enforced by the type system (`TechnicalProfileSignal` has no `candidateKind`), not by a runtime filter — the exact class of defect Blocker #2 was.
- **D (Memory vs Knowledge Base confusion):** Neo4j explicitly excluded from Memory with a documented reason; verified by a dedicated test that a Neo4j import produces zero signals.
- **E (Tool vs Skill confusion):** Skill is now path-based (`.claude/skills/...`), structurally unrelated to Tool's `tools = [...]` array; verified.
- **F (API vs arbitrary URL false positives):** verified — a bare URL/`endpoint = "..."` assignment never matches; an `_API` object literal with zero or multiple `id` fields fails closed (new test).
- **G (Prompt vs arbitrary string false positives):** verified — a variable not ending in `_PROMPT`, and a bare reference to an existing `_PROMPT` constant, never produce a second/false candidate.
- **H (MCP Server vs Tool confusion):** verified — path-scoped to recognized MCP config filenames only.
- **I (HITL design vs runtime observation):** N/A this pass — HITL is NOT_IMPLEMENTED, so no evidence of any trust level is produced for it at all (the safest possible outcome for this invariant).
- **J (missing evidence → FALSE):** unchanged, still structurally impossible.
- **K (trust inflated to VALIDATED/OBSERVED):** verified — every new DECLARED assertion is exactly DECLARED, never higher; proven by explicit assertions in tests, not merely absence of a bug.
- **L (technical revision contaminated by provenance):** re-verified with real-source fixtures (unrelated comment insertion with a real Framework import present still preserves `candidateId`).
- **M/N (relevant/irrelevant change vs revision):** re-verified with real fixtures (Framework/API/Skill changes as the "relevant" cases; Prompt content-only change, comment insertion as the "irrelevant" cases).
- **O (relationship milestone implemented early):** unchanged, verified.
- **P (governance bypass):** strengthened — a technical-profile signal cannot even structurally reach the ReviewSubject path now, versus the original's runtime-filter-only protection.
- **Q (tenant/source attribution leakage):** unchanged, verified.

One additional defect found and fixed during this corrected pass: the adapted Framework/Memory import regexes (copied conceptually from the legacy files) initially failed to match real Python `from module import X` syntax at all — caught by this pass's own regression tests, not by manual inspection, and fixed by adding a matching Python-shaped regex per technology (see §5).

## 14. Known limitations (corrected)

- **Technology/Build, Guardrail, and HITL are NOT_IMPLEMENTED** — no defensible real-source pattern was found for any of them within this correction's inspection scope (`core/framework-detector.ts`, `core/memory-detector.ts`, `codeguard/agent-detector.ts`, and the Golden Repository fixtures those files predate). This is an honest, deliberate downgrade from the original pass's fabricated `IMPLEMENTED` claim for these three.
- **Canonical `AgentVersionTechnicalProfile` (and every other `*TechnicalProfile` kind) materialization remains unimplemented** — see §8's full reasoning. The contract needs no change; a materialization-stage writer does not exist for any of the seven kinds and was not built in this correction.
- **MCP_SERVER, KNOWLEDGE_BASE, and SKILL are necessarily path/config-scoped to their own file** (a real `mcp.json`, a real `knowledge-base.yaml`, a real `SKILL.md`), so unlike Prompt/API (declared inline in the same file as the Agent), they do not fold into any AgentVersion's technical revision unless a future correlation rule is added to bridge same-directory or manifest-referenced files — a conservative, honest consequence of using genuinely real, externally-recognized conventions instead of an inline synthetic declaration.
- **Framework/Memory import detection is line-based regex, not a real AST/import-resolution parse** — a dynamically constructed import (`importlib.import_module(name)`) or a heavily aliased import is not detected. This mirrors the same limitation the legacy `core/framework-detector.ts`/`core/memory-detector.ts` already had.
- **The governance-connected Discovery Engine still has no live production application trigger** — unchanged from every prior milestone.

## 15. Live Discovery trigger status

Unchanged: still absent. No route, cron, worker, scheduled scan, GitHub webhook, or deployment integration was added.
