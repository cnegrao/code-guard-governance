# Agent Technical Profile — L4 Round 1 — Validation Evidence

**Architecture ID:** `GOVIA-L0L16-CIA-v1.0` (FROZEN BASELINE — unchanged by this milestone)
**Base main SHA:** `9386ca3c878a94257112bfead71d206e4adb9977` (PR #23 merge — `fix(discovery): separate agent version revision from provenance`)
**Branch:** `feat/agent-technical-profile-l4-round1`
**Date:** 2026-09-08

---

## 1. Base SHA

`9386ca3c878a94257112bfead71d206e4adb9977`. `git merge-base --is-ancestor ab12dfb468ff6749792f44768f907d92edb65a79 HEAD` confirmed before branching. Local `main` matched `origin/main` exactly; no unexpected tracked changes were present (`codex-recovery-6101-6240.txt` remained the only untracked, untouched file).

## 2. Branch

`feat/agent-technical-profile-l4-round1`, branched from `main` at the SHA above. One branch, one milestone, no worktrees, no secondary branches.

## 3. Frozen architecture ID

`GOVIA-L0L16-CIA-v1.0`. Not modified. `git diff --name-only` against base confirms none of `GOVIA-L0L16-CIA-v1.0.md`, `ADR-GOVIA-L0L16-CIA-v1.0.md`, `-roadmap.md`, `-coverage.md`, `-implementation-conformance.md`, `-reuse-register.md` appear in this branch's diff.

## 4. Roadmap milestone

Roadmap milestone 3, **AGENT TECHNICAL PROFILE — L4 ROUND 1**, per `GOVIA-L0L16-CIA-v1.0-roadmap.md` and the immediately preceding milestone's own stated deferral (`docs/codex/evidence/2026-09-08-agent-identity-version-discovery-v1-validation.md` §25: "populating `AgentVersionTechnicalProfile`... is a later, explicitly out-of-scope concern (roadmap milestone 3)").

## 5. Contract-first capability map

Inspected before any implementation: `packages/canonical-contracts/src/contracts.ts` (`AgentVersionTechnicalProfile`/`Support` at lines 1096–1112; `ModelTechnicalProfile`/`ToolTechnicalProfile`/`McpServerTechnicalProfile`/`ApiTechnicalProfile`/`PromptTechnicalProfile`/`KnowledgeBaseTechnicalProfile`/`SkillTechnicalProfile` at 1121–1270; `NormalizedObjectCandidate` union including `NormalizedMcpServerCandidate`/`NormalizedApiCandidate`/`NormalizedPromptCandidate`/`NormalizedKnowledgeBaseCandidate`/`NormalizedSkillCandidate` at 1908–2013 — all already fully specified, zero production instantiation anywhere in the repo before this milestone, confirmed by an exhaustive grep). Also inspected `object-candidate-normalization.ts`, `agent-version-correlation.ts`, `relationship-correlation.ts`, `evidence-assembly.ts`, `pipeline.ts`, and the legacy `core/framework-detector.ts`/`core/memory-detector.ts` (broad import/pattern-keyword style, confirmed unsuitable for reuse as a *canonical-object* detector per Section 11's no-broad-keyword-matching rule, though their *existence* confirms Framework/Memory signals were already anticipated as scanner-level concepts).

| Roadmap item | Classification | Contract/type | Detector | Trust | Evidence source | Governable this round? | Affects AgentVersion technical revision? |
|---|---|---|---|---|---|---|---|
| Framework/SDK | EXISTING_AGENT_VERSION_PROFILE_FIELD (field exists; zero materialization writer repo-wide) | `AgentVersionTechnicalProfileSupport.runtimeFrameworkReference` | NEW: `FrameworkReferenceDeclarationSpecification` | INFERRED | `FRAMEWORK_REFERENCE = "..."` declaration | NO (profile field never materialized — see §22) | YES |
| Technology/Build | EXISTING_AGENT_VERSION_PROFILE_FIELD (field exists; zero materialization writer repo-wide) | `AgentVersionTechnicalProfileSupport.buildReference` | NEW: `BuildReferenceDeclarationSpecification` | INFERRED | `BUILD_REFERENCE = "..."` declaration | NO (same reason) | YES |
| Model | EXISTING_CANONICAL_OBJECT | `ModelIdentity`/`ModelTechnicalProfile` | REUSE_AS_IS: `ModelReferenceDeclarationSpecification` | INFERRED | pre-existing | YES (unchanged) | YES (pre-existing) |
| Prompt | EXISTING_CANONICAL_OBJECT | `PromptIdentity`/`NormalizedPromptCandidate` | NEW: `PromptDeclarationSpecification` | INFERRED | `PROMPT_REFERENCE = "..."` declaration | YES (new) | YES (new) |
| Tool | EXISTING_CANONICAL_OBJECT | `ToolIdentity`/`ToolTechnicalProfile` | REUSE_AS_IS: `ToolListDeclarationSpecification` | INFERRED | pre-existing | YES (unchanged) | YES (pre-existing) |
| MCP | EXISTING_CANONICAL_OBJECT | `McpServerIdentity`/`NormalizedMcpServerCandidate` | NEW: `McpServerDeclarationSpecification` | INFERRED | `MCP_SERVER_REFERENCE = "..."` declaration | YES (new) | YES (new) |
| API | EXISTING_CANONICAL_OBJECT | `ApiIdentity`/`NormalizedApiCandidate` | NEW: `ApiDeclarationSpecification` | INFERRED | `API_REFERENCE = "..."` declaration | YES (new) | YES (new) |
| KB/RAG | EXISTING_CANONICAL_OBJECT (Knowledge Base only; RAG/Vector infra out of scope) | `KnowledgeBaseIdentity`/`NormalizedKnowledgeBaseCandidate` | NEW: `KnowledgeBaseDeclarationSpecification` | INFERRED | `KNOWLEDGE_BASE_REFERENCE = "..."` declaration | YES (new) | YES (new) |
| Memory | EXISTING_DISCOVERY_SIGNAL_ONLY (no canonical kind, no dedicated profile field) | none | NEW: `MemoryReferenceDeclarationSpecification` | INFERRED | `MEMORY_REFERENCE = "..."` declaration | NO (evidence-only) | YES (folds into technical revision) |
| Skill | EXISTING_CANONICAL_OBJECT | `SkillIdentity`/`NormalizedSkillCandidate` | NEW: `SkillListDeclarationSpecification` | INFERRED | `skills = [...]` bare-identifier array | YES (new) | YES (new) |
| Orchestration | EXISTING_DISCOVERY_SIGNAL_ONLY (no canonical kind, no dedicated profile field) | none | NEW: `OrchestrationReferenceDeclarationSpecification` | INFERRED | `ORCHESTRATION_REFERENCE = "..."` declaration | NO (evidence-only) | YES |
| Guardrails/HITL | EXISTING_DISCOVERY_SIGNAL_ONLY (no canonical kind, no dedicated profile field) | none | NEW: `GuardrailReferenceDeclarationSpecification` / `HitlReferenceDeclarationSpecification` | INFERRED | `GUARDRAIL_REFERENCE = "..."` / `HITL_REFERENCE = "..."` | NO (evidence-only) | YES |

No `NOT_MODELED` row required a `STOP_REQUIRES_ARCHITECTURE_DECISION`: every dimension either had an existing canonical object kind, an existing (if unwritten) profile field, or was implementable purely as Discovery-stage evidence contributing to the already-existing `AGENT_VERSION` technical-revision fingerprint, without inventing a new `CanonicalObjectKind` or a new frozen-vocabulary term.

## 6. Files changed

Added:
- `packages/scanner/src/discovery/strategies/prompt-declaration.ts`
- `packages/scanner/src/discovery/strategies/mcp-server-declaration.ts`
- `packages/scanner/src/discovery/strategies/api-declaration.ts`
- `packages/scanner/src/discovery/strategies/knowledge-base-declaration.ts`
- `packages/scanner/src/discovery/strategies/skill-list-declaration.ts`
- `packages/scanner/src/discovery/strategies/agent-version-technical-signal-declaration.ts`
- `packages/scanner/test/discovery-engine/l4-round1-object-detection.test.ts`
- `packages/scanner/test/discovery-engine/agent-version-technical-signals.test.ts`
- this evidence document

Modified:
- `packages/scanner/src/discovery/object-candidate-normalization.ts` — 5 new normalization strategies (Prompt/MCP_SERVER/API/KNOWLEDGE_BASE/SKILL) registered; module doc comment updated.
- `packages/scanner/src/discovery/agent-version-correlation.ts` — technical revision projection extended to fold in the 5 new correlated object kinds and the 6 AgentVersion technical signals; minimum-evidence rule extended accordingly.
- `packages/scanner/src/discovery/index.ts`, `packages/scanner/src/index.ts` — export the new specifications/strategies.
- `apps/dashboard/lib/governance/discovery-intake.ts` — new specifications wired into the scan pipeline; technical-signal candidates are durably evidenced but routed away from `processObjectCandidate` (never their own ReviewSubject — see §9/§22).
- `apps/dashboard/tests/discovery-intake-service.test.ts` — new `describe` block for L4 Round 1 governance continuity.
- `packages/scanner/test/discovery-engine/object-candidate-normalization.test.ts` — the pre-existing "unsupported/dormant candidateKind" test used `MCP_SERVER` as its example of a still-dormant kind; since MCP_SERVER is now genuinely supported, the test was updated to use `DATA_ASSET` (still correctly dormant) instead. No assertion semantics changed.

No file under `docs/architecture/**`, `.claude/**`, `supabase/migrations/**`, or `codex-recovery-6101-6240.txt` was read, staged, modified, or inspected. No dependency, lockfile, or migration change.

## 7. Framework/SDK — PARTIAL

Detector: `FrameworkReferenceDeclarationSpecification` (`FRAMEWORK_REFERENCE = "..."` / `frameworkReference: "..."`). Evidence-backed, INFERRED, folds into the AgentVersion technical revision as `framework:<value>`. **The canonical `AgentVersionTechnicalProfile.support.runtimeFrameworkReference` field is NOT materialized** — see §22 (Persistence). Classification: `PARTIAL` (Discovery evidence + technical-revision impact: yes; governed canonical profile field: no).

## 8. Technology/Build — PARTIAL

Detector: `BuildReferenceDeclarationSpecification` (`BUILD_REFERENCE = "..."` / `buildReference: "..."`). Same status as Framework/SDK: evidence-backed and version-relevant, canonical `buildReference` profile field not materialized. Classification: `PARTIAL`.

## 9. MODEL — IMPLEMENTED (reused as-is)

Zero changes to `model-reference-declaration.ts` or `ModelCandidateNormalizationStrategy`. Regression-verified green (147/147 discovery-engine tests, including all pre-existing MODEL tests). Now additionally folds into the extended technical-revision projection exactly as before (no behavior change to MODEL's own contribution).

## 10. PROMPT — IMPLEMENTED

New `PromptDeclarationSpecification` + `PromptCandidateNormalizationStrategy`, wired through governance intake to the same DETECTED→PROPOSED ceiling as every other kind. Explicit-declaration-only (`PROMPT_REFERENCE = "..."` / `promptReference: "..."`); a docstring, template literal, or prose mention of "prompt" produces zero candidates (tested). Raw prompt content is never captured — only the declared reference literal is promoted to `proposedIdentity.declarationKey`.

## 11. TOOL — IMPLEMENTED (reused as-is)

Zero changes to `tool-list-declaration.ts` or `ToolCandidateNormalizationStrategy`. Regression-verified green.

## 12. MCP_SERVER — IMPLEMENTED

New `McpServerDeclarationSpecification` + `McpServerCandidateNormalizationStrategy`. Explicit-declaration-only (`MCP_SERVER_REFERENCE = "..."`); an `mcp`-related import or a bare Tool declaration never implies an MCP_SERVER candidate on its own (tested).

## 13. API — IMPLEMENTED

New `ApiDeclarationSpecification` + `ApiCandidateNormalizationStrategy`. Explicit-declaration-only (`API_REFERENCE = "..."`); a bare URL literal anywhere in source never becomes an API candidate on its own (tested). L10 connectivity/network topology remains untouched and out of scope.

## 14. KNOWLEDGE_BASE/RAG — IMPLEMENTED (Knowledge Base only; RAG/Vector out of scope)

New `KnowledgeBaseDeclarationSpecification` + `KnowledgeBaseCandidateNormalizationStrategy`. Explicit-declaration-only (`KNOWLEDGE_BASE_REFERENCE = "..."`); the bare word "memory" or a generic vector-store import never implies a KNOWLEDGE_BASE candidate (tested — kept structurally distinct from the separate Memory technical signal, §17). No embeddings created, no pgvector access, no Vector Store implementation — RAG configuration remains representable only as this same explicit Knowledge Base evidence; no separate RAG object was invented.

## 15. Memory — EVIDENCE_ONLY

New `MemoryReferenceDeclarationSpecification` (`MEMORY_REFERENCE = "..."`). Not a canonical object kind (correctly not invented); no dedicated `AgentVersionTechnicalProfile` field exists for it (only a generic `configurationReference`, deliberately not overloaded — see §19/§23). Captured as evidence-backed Discovery signal, folds into AgentVersion's technical revision as `memory:<value>`, durably persisted (Evidence + SourceAssertion) but never independently governable (no ReviewSubject of its own — see §22). Absence of a `MEMORY_REFERENCE` line is `UNKNOWN`, never `FALSE`.

## 16. SKILL — IMPLEMENTED

New `SkillListDeclarationSpecification` (`skills = [...]` bare-identifier array, mirrors `ToolListDeclarationSpecification` exactly) + `SkillCandidateNormalizationStrategy`. A generic function definition, a Tool declaration, or a quoted-string skills array never implies a Skill (tested).

## 17. Orchestration — EVIDENCE_ONLY

New `OrchestrationReferenceDeclarationSpecification` (`ORCHESTRATION_REFERENCE = "..."`). Same status class as Memory: no canonical object kind, no dedicated profile field, Discovery-evidence-only, folds into technical revision as `orchestration:<value>`. Never conflated with TOOL (tested implicitly by the detector's own narrow pattern; a generic control-flow construct never matches).

## 18. Guardrails/HITL — EVIDENCE_ONLY

New `GuardrailReferenceDeclarationSpecification` (`GUARDRAIL_REFERENCE = "..."`) and `HitlReferenceDeclarationSpecification` (`HITL_REFERENCE = "..."`) — two independent detectors, two independent evidence trails (never merged into one fact). A bare comment/docstring mentioning "guardrail" never matches (tested). HITL evidence is structurally design-time-only: every detector here only observes already-checked-in source text, so its `SourceAssertion.trustState` is fixed to `INFERRED` by the pre-existing, unmodified `evidence-assembly.ts` — proven by a dedicated test asserting `trustState === 'INFERRED'` for the HITL signal. **Design-time HITL declaration never becomes OBSERVED.**

## 19. Per-fact evidence model

Every one of the 11 profile dimensions above (Model/Tool reused; Prompt/MCP/API/KB/Skill new canonical objects; Framework/Build/Memory/Orchestration/Guardrail/HITL new AgentVersion technical signals) is captured by its own dedicated `DetectionSpecification` with its own `code`, own `Evidence` row, own `SourceAssertion` row, and own confidence — never a single opaque `technicalProfile = {...}` blob. `AgentVersionCorrelationResult.finding.assertionIds`/`evidenceIds` is the deduplicated union of every correlated fact's own ids (extended in this milestone from Model/Tool-only to all 11), so each fact's provenance remains independently recoverable via `getDiscoveryFinding`/evidence lookup — proven by the dashboard test asserting `finding.assertionIds.length >= 6` when all 11 signals are present in one fixture.

## 20. Per-fact trust model

Unchanged mechanism, extended scope: `evidence-assembly.ts`'s `assembleDiscoveryCandidate` (zero diff this milestone) fixes every Discovery-stage `SourceAssertion.trustState` to `INFERRED` regardless of which of the 11 detectors produced it. No fact in this milestone is ever `DECLARED`, `IMPORTED`, `OBSERVED`, or `VALIDATED`. Mixed trust across facts was never introduced as a risk here because every current detector shares the identical INFERRED/design-time trust tier — the vocabulary itself (`INFERRED`/`DECLARED`/`IMPORTED`/`OBSERVED`/`VALIDATED`) was not modified or extended.

## 21. UNKNOWN handling

No detector in this milestone ever emits a negative/false fact. Absence of a `MEMORY_REFERENCE`/`GUARDRAIL_REFERENCE`/etc. line simply means no `DiscoveryCandidate` of that signal exists for that AgentVersion — the correct representation is "no evidence observed" (`UNKNOWN`), never a persisted `false`/`absent` value. This is a structural property of the additive, evidence-only detection model (there is no code path that writes a negative assertion).

## 22. AgentVersion attribution rules

Every one of the 11 new/extended facts is attributed to an AgentVersion under **UNAMBIGUOUS_SOURCE_SCOPE**: `correlateAgentVersions` requires exactly one normalizable AGENT candidate per source artifact (file) before any Model/Tool/Prompt/MCP/API/KB/Skill/technical-signal candidate in that same file is folded in — the identical file-scoping rule already governing Model/Tool. A file with two AGENT declarations remains ambiguous and yields **no** AGENT_VERSION even when Prompt/MCP/Skill evidence is present (regression-tested). No detector in this milestone parses a repository-global manifest (package.json, pyproject.toml, lockfiles) specifically to avoid the DIRECT/EXPLICIT_REFERENCE/UNAMBIGUOUS_SOURCE_SCOPE attribution problem in monorepos with multiple Agents (Section 9's explicit warning) — every new declaration pattern is a single-file, single-line, explicit literal, so attribution is never ambiguous by construction.

## 23. AGENT_VERSION_TECHNICAL_REVISION_INPUTS

```
TECHNICAL_REVISION_INPUTS = [
  "agent-code:<parent AGENT's normalized agentCode>",
  "model:<normalized MODEL modelReference>"              // sorted+deduplicated, 0..n
  "tool:<normalized TOOL declarationKey>"                 // sorted+deduplicated, 0..n
  "prompt:<normalized PROMPT declarationKey>"              // NEW, sorted+deduplicated, 0..n
  "mcp:<normalized MCP_SERVER serverReference>"            // NEW, sorted+deduplicated, 0..n
  "api:<normalized API apiReference>"                      // NEW, sorted+deduplicated, 0..n
  "kb:<normalized KNOWLEDGE_BASE sourceReference>"          // NEW, sorted+deduplicated, 0..n
  "skill:<normalized SKILL declarationReference>"          // NEW, sorted+deduplicated, 0..n
  "framework:<FRAMEWORK_REFERENCE displayValue>"           // NEW, sorted+deduplicated, 0..n
  "build:<BUILD_REFERENCE displayValue>"                   // NEW, sorted+deduplicated, 0..n
  "memory:<MEMORY_REFERENCE displayValue>"                 // NEW, sorted+deduplicated, 0..n
  "orchestration:<ORCHESTRATION_REFERENCE displayValue>"   // NEW, sorted+deduplicated, 0..n
  "guardrail:<GUARDRAIL_REFERENCE displayValue>"           // NEW, sorted+deduplicated, 0..n
  "hitl:<HITL_REFERENCE displayValue>"                     // NEW, sorted+deduplicated, 0..n
]
technicalRevisionFingerprint = sha256(canonicalize(TECHNICAL_REVISION_INPUTS))[0:32]

AGENT_VERSION_FINGERPRINT_INPUTS = [sourceScope, technicalRevisionFingerprint]   // unchanged from the prior milestone
```

Minimum evidence rule extended: at least one of {Model, Tool, Prompt, MCP_SERVER, API, Knowledge Base, Skill, Framework, Build, Memory, Orchestration, Guardrail, HITL} must be present alongside a normalizable AGENT, or no AGENT_VERSION is produced (the AGENT's own logical identity is still never sufficient alone). `versionCode` remains always absent — still no fabricated version, unchanged from the prior milestone.

## 24. CHANGES_THAT_CREATE_NEW_AGENT_VERSION

```
CHANGES_THAT_CREATE_NEW_AGENT_VERSION = [
  "the correlated MODEL's declared modelReference literal changes",         // pre-existing
  "a correlated TOOL declaration is added or removed",                       // pre-existing
  "a correlated TOOL's declarationKey identifier changes",                   // pre-existing
  "the parent AGENT's own enclosing declaration name (agentCode) changes",   // pre-existing
  "the parent AGENT's source artifact is renamed/moved, or scanned under a different SourceConnection (changes sourceScope)", // pre-existing
  "a correlated PROMPT_REFERENCE/promptReference value changes",             // NEW — regression-tested
  "a correlated MCP_SERVER_REFERENCE value changes",                        // NEW
  "a correlated API_REFERENCE value changes",                                // NEW
  "a correlated KNOWLEDGE_BASE_REFERENCE value changes",                     // NEW
  "the correlated skills = [...] set changes",                              // NEW — regression-tested
  "a correlated FRAMEWORK_REFERENCE value changes",                         // NEW — regression-tested
  "a correlated BUILD_REFERENCE value changes",                              // NEW
  "a correlated MEMORY_REFERENCE value changes",                            // NEW
  "a correlated ORCHESTRATION_REFERENCE value changes",                     // NEW
  "a correlated GUARDRAIL_REFERENCE value changes",                        // NEW
  "a correlated HITL_REFERENCE value changes",                              // NEW
]
```

## 25. CHANGES_THAT_DO_NOT_CREATE_NEW_AGENT_VERSION

```
CHANGES_THAT_DO_NOT_CREATE_NEW_AGENT_VERSION = [
  "an edit to an unrelated file elsewhere in the scan",                                          // pre-existing
  "an unrelated candidate detected in a different source artifact during the same scan",         // pre-existing
  "an unrelated comment/blank-line insertion in the SAME file that shifts the matched declaration's own line position without changing any correlated fact — regression-tested for both a pre-existing fact (Model) and a new one (Framework)",
  "the declared order of Model/Tool/Prompt/MCP/API/KB/Skill identifiers or technical signals within the same file",
  "a duplicate declaration of the exact same identifier/reference (deduplicated via Set before hashing)",
  "a repeated identical scan of the same, unchanged repository",
  "the wall-clock time of the scan",
]
```

## 26. Relationship semantics status

Zero diff on `packages/scanner/src/discovery/relationship-correlation.ts` (confirmed by `git diff --name-only`). `USES_MODEL`/`USES_TOOL` correlation remains AGENT-sourced exactly as before — unaffected by the new AGENT_VERSION-kind technical-signal candidates now present in the shared `candidates` array, because `relationship-correlation.ts` filters strictly by `candidateKind === MODEL`/`TOOL`/`AGENT` (verified by inspection: `grep -n "candidateKind ==="` shows only these three exact-equality filters). No new `GOVERNED_RELATIONSHIP_TYPE`, no relaxed endpoint constraint, no relationship materialization for Prompt/MCP/API/KB/Skill — those remain roadmap milestone 6 (AgentVersion Behavior Relationships — L9), untouched here.

## 27. Governance continuity

Every new canonical object kind (Prompt/MCP_SERVER/API/KNOWLEDGE_BASE/SKILL) flows through the exact same `ensureReviewSubjectAndPropose` DETECTED→PROPOSED boundary every existing kind already uses — no new authority ceiling, no new bypass path. AgentVersion technical signals (Framework/Build/Memory/Orchestration/Guardrail/HITL) are the one deliberate exception: their `Evidence`/`SourceAssertion` are made durable (via a new `processTechnicalSignalCandidate`, calling only `recordEvidence`/`recordSourceAssertion`), but they are filtered out of `processObjectCandidate`'s loop (`isTechnicalSignalCandidate`) and never receive their own `ReviewSubject` — only the real, correlation-produced `AGENT_VERSION` `ReviewSubject` cites their assertion/evidence ids in its own union. This avoids polluting the governance review queue with phantom "AGENT_VERSION" entries that are really just fragments of raw technical evidence, while still making that evidence durably auditable end-to-end.

## 28. Persistence strategy

**No new migration.** `PERSISTENCE_GAP` assessment: canonical `AgentVersionTechnicalProfile.support.{runtimeFrameworkReference, buildReference}` fields exist in `canonical-contracts` but have **zero materialization-writer infrastructure anywhere in the repository**, for any of the seven `*TechnicalProfile` kinds (Model/Tool/MCP/API/Prompt/KB/Skill/AgentVersion) — confirmed by an exhaustive grep before this milestone began (only contracts.ts, its own tests, and the prior milestone's evidence doc reference these types; zero production instantiation). `WHY_EXISTING_GENERIC_PERSISTENCE_IS_INSUFFICIENT`: it is not insufficient — the existing Evidence/SourceAssertion/DiscoveryFinding/ReviewSubject persistence (`gov_repo.discovery_findings`, `discovery_candidates`, `review_subjects`) already fully supports every fact this milestone produces at the Discovery/Candidate stage; the only thing genuinely missing is a *materialization-stage* writer that would populate `AgentVersionTechnicalProfile` after canonicalization — the same missing capability that already existed, unaddressed, before this milestone, for Model/Tool/MCP/API/Prompt/KB/Skill's own `*TechnicalProfile` records too. `ARCHITECTURAL_CONTRACT_ALREADY_SUPPORTS_IT`: yes, fully — the contract needs no change; only a future writer needs to be built, which is a **materialization-stage concern**, not a Discovery-stage one, and is explicitly out of this milestone's scope (this milestone's mandate is Discovery-stage evidence per fact, per Section 8 of the brief, not canonical-object materialization, which remains gated behind the existing human-governed Decision-to-Truth pipeline this milestone does not extend). Building that writer now would be a disproportionate, unscoped architectural addition; the correct, honest classification is `PARTIAL`/`EVIDENCE_ONLY` for the two dimensions with a dedicated (but unwritten) profile field, and `EVIDENCE_ONLY` for the three with no profile field at all — never fabricated as `IMPLEMENTED`.

## 29. Migration status

None. No `supabase/migrations/**` file was created, modified, or inspected in a way that would suggest one is needed beyond what's documented in §28.

## 30. Supabase/production status

No Supabase CLI, RPC, or database connection was invoked at any point. All governance-continuity testing used in-memory fake ports (`FakeIntakePersistence`, `FakeReviewPersistence`, `FakeMaterializationPersistence`), the same pattern the pre-existing test suite already established. `git status --short supabase/` is empty.

## 31. Test results

| Suite | Command | Result |
|---|---|---|
| Scanner discovery-engine (unit) | `npm run test:discovery-engine` (packages/scanner) | **147/147 passing** (was 120 pre-milestone; +27 new: 18 in `l4-round1-object-detection.test.ts`, 9 in `agent-version-technical-signals.test.ts`; 1 pre-existing test updated to use a still-genuinely-dormant kind, `DATA_ASSET`, instead of the now-supported `MCP_SERVER`) |
| Scanner discovery-engine typecheck | `npm run typecheck:discovery-engine` | clean, no errors |
| Scanner full package typecheck | `npm run typecheck` (packages/scanner) | clean, no errors |
| Discovery Validation Lab | `npm run test:validation-lab` (packages/scanner) | **51/51 passing**, unchanged — zero diff under `packages/scanner/test/discovery-validation-lab/**` |
| Dashboard targeted governance tests | `node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/discovery-intake-service.test.ts tests/reconciliation-readiness.test.ts` (apps/dashboard) | **28/28 passing** (was 25 pre-milestone; +3 new in the "Agent Technical Profile L4 Round 1" describe block) |
| Dashboard workspace typecheck | `npx tsc --noEmit -p tsconfig.json` (apps/dashboard) | clean, no errors |
| `git diff --check` | repo root | clean, no whitespace errors |

No Golden Repository / Validation Lab suite was modified; no Supabase runtime, production DB test, deployment, or load test was run, per the milestone's controlled-validation scope. `canonical-contracts` was not modified, so its own test/typecheck suites were not re-run (only type-only imports of already-exported, unmodified contracts were added).

## 32. Adversarial review result

One review pass performed over the full diff, per the milestone's checklist (A–Q):

- **A (wrong AgentVersion attribution):** Every new fact is folded in only via the pre-existing same-file correlation rule (`correlateAgentVersions`'s `byFile` grouping, unmodified); no cross-file or cross-agent leakage possible. Verified by a dedicated regression test: two Agents declared in the same file remain ambiguous and produce zero AGENT_VERSION even with Prompt/MCP/Skill evidence present.
- **B (repository-global metadata duplicated across Agents):** No new detector parses a repository-global manifest (package.json, pyproject.toml, lockfile) — every new pattern is a single-file, single-line, explicit declaration, so this class of defect cannot arise structurally.
- **C (profile field vs canonical object confusion):** Memory/Orchestration/Guardrail/HITL were deliberately kept as Discovery-evidence-only, never promoted to a canonical object or forced into an ill-fitting profile field (`configurationReference` was considered and rejected — see §19/§23 — because overloading it would lose per-fact provenance).
- **D (Memory vs Knowledge Base confusion):** Verified by a dedicated false-positive test: a generic vector-store import/`memory_store` variable never produces a KNOWLEDGE_BASE candidate.
- **E (Tool vs Skill confusion):** Verified by a dedicated test: a generic function or a `tools = [...]` binding never produces a SKILL candidate; `skills = [...]` is a structurally distinct array key.
- **F (API vs arbitrary URL false positives):** Verified — a bare URL literal in a comment or a generic `endpoint = "..."` assignment never matches `API_REFERENCE`.
- **G (Prompt vs arbitrary string false positives):** Verified — a docstring and a `SYSTEM_PROMPT = "..."` assignment (deliberately using a non-matching key name) never produce a PROMPT candidate; only the exact `PROMPT_REFERENCE`/`promptReference` key does.
- **H (MCP Server vs Tool confusion):** Verified — an `mcp`-related import plus a `tools = [...]` declaration in the same file never produces an MCP_SERVER candidate.
- **I (HITL design vs runtime observation confusion):** Verified by a dedicated test asserting the HITL signal's own `SourceAssertion.trustState === 'INFERRED'`, never `OBSERVED`.
- **J (missing evidence converted to FALSE):** No code path in any new detector ever emits a negative/false fact; absence is structurally `UNKNOWN` by omission.
- **K (trust inflated to VALIDATED/OBSERVED):** `evidence-assembly.ts` (zero diff) unconditionally fixes every Discovery-stage assertion to `INFERRED`; no new detector bypasses this.
- **L (technical revision contaminated by provenance/line/timestamp):** Verified by two regression tests (one for a pre-existing fact, Model; one for a new one, Framework): an unrelated comment/blank-line insertion in the same file does not change the AGENT_VERSION identity.
- **M (relevant change not producing a new revision):** Verified by three regression tests: changing a Prompt reference, changing the correlated Skill set, and changing a Framework reference each produce a different `candidateId`/`findingId`.
- **N (irrelevant change producing a new revision):** Covered by the same L-series tests above (the negative case is asserted in the same test).
- **O (relationship milestone accidentally implemented early):** Verified — zero diff on `relationship-correlation.ts`; no new `GOVERNED_RELATIONSHIP_TYPE` added anywhere in `canonical-contracts` (untouched); no relationship materialized for any new object kind.
- **P (direct canonical writes / governance bypass):** Verified — every new object kind reuses the exact same `ensureReviewSubjectAndPropose` function (not a copy); a static grep for `confirm|certify|authorize|reconcile|materialize` RPC names in the new/modified source turns up none.
- **Q (tenant/source attribution leakage):** Verified — no new tenant-scoping logic was added; every new code path reuses the existing `ctx.organisationId`-scoped port calls unchanged.

One defect was found and fixed during this pass: the pre-existing "unsupported/dormant candidateKind" regression test in `object-candidate-normalization.test.ts` used `MCP_SERVER` as its example of a kind with no registered strategy — since this milestone gives MCP_SERVER a real strategy, the test would have started asserting the wrong thing (silently validating that MCP_SERVER fails closed, which is no longer true and would mask a real regression if normalization ever broke). Fixed by switching the test's fabricated example to `DATA_ASSET`, which correctly remains dormant. No other defect was found; the diff was re-inspected once and no further blocker was identified.

## 33. Known limitations

- **Canonical `AgentVersionTechnicalProfile` materialization is not implemented.** Framework/SDK and Technology/Build have dedicated contract fields (`runtimeFrameworkReference`, `buildReference`) but no writer anywhere populates them from this (or any prior) milestone's evidence — this is a pre-existing, repo-wide gap for all seven `*TechnicalProfile` kinds, not something this milestone introduces or is expected to close (see §28).
- **Memory, Orchestration, and Guardrail/HITL have no canonical profile field at all**, by design (inventing one, or overloading the generic `configurationReference`, was considered and rejected — see §19/§23). Their evidence is real, durable, and folds into the AgentVersion technical revision, but is not yet a governed Passport field.
- **Every new detector is an explicit single-line/single-declaration literal pattern**, deliberately conservative to avoid false positives (Section 11's prohibition on broad keyword matching). A framework/build/memory/orchestration/guardrail/HITL signal expressed through a different mechanism (e.g. a real `package.json` dependency, a YAML config block, a decorator) is not detected by this milestone — conservative under-detection, never a fabricated positive.
- **AgentVersion correlation remains "same file" only**, exactly as the prior milestone established for Model/Tool — an Agent whose Prompt/MCP/API/KB/Skill/technical-signal bindings are declared in a separate config file will not yet correlate into that Agent's AGENT_VERSION. This is an intentional continuation of the existing correlation rule, not a new limitation.
- **DATA_ASSET and DATA_ELEMENT remain entirely dormant** (no detector, no strategy) — unaffected by and out of scope for this milestone (roadmap milestone 8).
- **The governance-connected Discovery Engine still has no live production application trigger.** `grep -rn "runGovernanceDiscoveryScan" apps/dashboard/app/` returns zero matches on this branch — unchanged from every prior milestone. No route, cron, worker, or script was added.

## 34. Live Discovery trigger status

Unchanged: still absent. No route, cron, worker, scheduled scan, GitHub webhook, or deployment integration was added in this milestone.
