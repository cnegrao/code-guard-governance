# Agent Technical Profile — L4 Round 1 — Validation Evidence

**Architecture ID:** `GOVIA-L0L16-CIA-v1.0` (FROZEN BASELINE — unchanged by this milestone)
**Base main SHA:** `9386ca3c878a94257112bfead71d206e4adb9977` (PR #23 merge — `fix(discovery): separate agent version revision from provenance`)
**Branch:** `feat/agent-technical-profile-l4-round1`
**PR:** #24
**Date:** 2026-09-08 (three passes: original, first correction, final correction below)

---

## 0. Correction notice (final pass)

This document has been rewritten in place a second time to describe only the **final corrected** state, after a second external review found three further concrete defects in the first correction (commit `2769f1e`). Nothing below should be read as cumulative with either prior version — this is the current, authoritative state.

1. **Trust semantics still too strong (Defect #1).** The first correction marked Framework and Orchestration technical-profile signals `DECLARED`, reasoning that an import statement is an explicit declaration. That conflates "the source declares an import" with "the source declares this AgentVersion's profile fact" — a real but different claim. **Corrected**: Framework and Orchestration signals are now `INFERRED`. Memory was more seriously wrong: a generic `import redis`/`import chromadb`/etc. does not prove "this Agent uses this technology as its memory mechanism" (Redis may be cache/session infrastructure, Postgres may be unrelated application persistence, Chroma/Pinecone/FAISS may be Knowledge-Base/RAG retrieval, not memory). **Corrected**: the Memory signal kind and its detector (`memory-import-signal.ts`) are removed entirely; Memory is now `NOT_IMPLEMENTED`.
2. **Prompt content excluded from technical revision (Defect #2).** The first correction asserted "same declaration key + changed content = same technical revision" as a deliberate design choice. That is wrong for AGENT_VERSION, which represents technical/behavioral state — a Prompt's own effective content changing is version-relevant even when its declaration name does not change. **Corrected**: canonical PROMPT identity remains declaration-key-only (unchanged, still never raw content), but a new controlled `contentFingerprint` (sha256 of the prompt's own parsed string value, never the surrounding line/file) now participates in the AGENT_VERSION technical-revision projection alongside the declaration key. The prior test asserting the opposite has been reversed. Evidence excerpts for Prompt no longer include the raw prompt text at all (redacted to `NAME = <redacted>`).
3. **Persistence gate resolved to a non-answer (mandatory check).** The first correction said `AgentVersionTechnicalProfile` materialization was "NOT_IMPLEMENTED, not ready" without forcing the required binary decision. Re-inspecting the actual canonical materialization migration surfaced a decisive fact: the frozen architecture's own invariant — *"Generic JSON/EAV never replaces modeled enterprise semantics"* (`GOVIA-L0L16-CIA-v1.0.md` §4) — forecloses the only "minimal" implementation shape (one shared JSONB-per-field profile table across all eight `*TechnicalProfile` kinds), and no existing per-kind normalized-table precedent exists anywhere in the 46-migration history (confirmed by grep: the only prior mention of "TechnicalProfile" in any migration is the one doc comment that explicitly deferred it). Choosing among a per-kind normalized table (real, correct, but a new persistence architecture with no precedent to derive it from), a shared JSONB table (forbidden by the frozen invariant), or a single-kind exception (arbitrary, unjustified) is a genuine architectural decision this correction is not authorized to make unilaterally. **Verdict: `STOP_REQUIRES_ARCHITECTURE_DECISION`** — see §8.

Sections below describe only the final corrected state. Everything not called out as changed here is unchanged from the first correction pass.

---

## 1. Base SHA / Branch / Architecture

Unchanged: base `9386ca3c878a94257112bfead71d206e4adb9977`, branch `feat/agent-technical-profile-l4-round1`, `GOVIA-L0L16-CIA-v1.0` frozen and unmodified.

## 2. FRAMEWORK_TRUST_DECISION

An import statement (`from langgraph import StateGraph`) DECLARES a source dependency — that much is unambiguous and real. But concluding `AgentVersion.runtimeFramework = LangGraph` from same-file correlation is a scanner *interpretation* of that import, not something the source explicitly declared about the AgentVersion itself — no source anywhere writes `framework = "langgraph"` or an equivalent Agent-bound configuration key, and no such convention was found within this correction's inspection scope (`core/framework-detector.ts`, `core/memory-detector.ts`, `codeguard/agent-detector.ts`, the Golden Repository fixtures those files predate). **Decision: every Framework signal is `INFERRED`, never `DECLARED`.** If a future round finds a real, explicit Agent-bound framework declaration convention, that specific evidence may justify `DECLARED` for that convention only — never for a bare import.

## 3. ORCHESTRATION_TRUST_DECISION

Orchestration is derived from the identical Framework import evidence, filtered to the subset of frameworks `codeguard/agent-detector.ts`'s own pre-existing `agentType: "orchestrator"` classification already applies to (LangGraph, CrewAI, Semantic Kernel). This adds a second inference layer on top of an already-inferred Framework signal — a legacy classification table saying "this kind of framework tends to orchestrate," never something the source itself declared (`orchestration = ...` appears nowhere). **Decision: Orchestration is always `INFERRED`, and must never mechanically inherit a stronger trust tier than the Framework evidence it is derived from** — verified by a dedicated regression test (`agent-version-technical-signals.test.ts`).

## 4. MEMORY_TRUST_AND_FALSE_POSITIVE_DECISION

The first correction's Memory signal treated any import of Redis, PostgreSQL, SQLite, ChromaDB, Pinecone, FAISS, Weaviate, Qdrant, or Milvus as Memory evidence. This is too broad: an imported storage/vector technology does not prove *why* it is used. Redis is commonly cache, session store, or event/pubsub infrastructure completely unrelated to Agent memory; PostgreSQL is overwhelmingly likely to be general application persistence; SQLite likewise; ChromaDB/Pinecone/FAISS/Weaviate/Qdrant/Milvus are all equally plausible as Knowledge-Base/RAG retrieval infrastructure as they are as "Agent memory." No defensible memory-*specific* evidence (an explicit memory constructor, a memory configuration key, a framework-native memory binding such as `ConversationBufferMemory(...)` used as a constructor call rather than a bare keyword) was implemented within this correction's scope — adding that narrower, constructor-call-level detector would itself be new scope beyond a "fix the trust level" correction, and was not attempted.

**Decision: Memory is `NOT_IMPLEMENTED` in this round.** `packages/scanner/src/discovery/strategies/memory-import-signal.ts` is deleted; `TECHNICAL_PROFILE_SIGNAL_KIND` no longer has a `MEMORY` entry at all (`{ FRAMEWORK, ORCHESTRATION }` only). A generic Redis/PostgreSQL/SQLite/vector-store import produces zero technical-profile signals of any kind — regression-tested. Neo4j remains additionally excluded even from a *hypothetical* future Memory detector, for the same Memory-vs-Knowledge-Base conflation reason as before.

## 5. PROMPT_IDENTITY_INPUTS

Unchanged from the first correction and still correct: `NormalizedPromptCandidate.proposedIdentity.declarationKey` is the captured `<NAME>_PROMPT` constant identifier only — never the prompt's own string value, never a value derived only from that string value. Two different prompt bodies under the identical declaration key produce the identical canonical `candidateId` (regression-tested: `l4-round1-object-detection.test.ts`). This is deliberate and stays as-is: canonical object identity answers "which declared thing is this," not "has its content changed" — that is technical revision's job (§6).

## 6. PROMPT_CONTENT_FINGERPRINT_INPUTS

New in this pass. `PromptDeclarationSpecification` (`prompt-declaration.ts`) computes `contentFingerprint = sha256(promptStringValue).hex().slice(0, 32)` — the exact parsed literal value captured by the regex, never the surrounding line, never the whole file, never `artifact.contentHash` (which would make an unrelated file edit elsewhere incorrectly shift the fingerprint). This travels via a new optional `DetectionMatch.contentFingerprint` field (`detection-specification.ts`) through `evidence-assembly.ts` into a new optional `DiscoveryCandidate.contentFingerprint` field — deliberately scanner-internal plumbing, never part of `NormalizedObjectCandidate.proposedIdentity` or any canonical-contracts type.

`agent-version-correlation.ts`'s new `extractPromptTechnicalRevisionValues` combines them into one technical-revision input per Prompt: `prompt:<declarationKey>:<contentFingerprint>`. Proven by regression tests:

- same declaration key + same content, rescanned → identical `candidateId` (idempotent)
- same declaration key + **changed** content → **different** `candidateId` (the corrected behavior; the first correction's pass had this backwards)
- raw prompt content never appears as a substring of the `candidateId`
- an unrelated comment/blank-line insertion elsewhere in the file, with the Prompt unchanged → identical `candidateId`

## 7. PROMPT_CONTENT_STORAGE_POLICY

`Evidence.redactedExcerpt` for a Prompt finding is now fixed to `"<NAME> = <redacted>"` — never the matched line's full text (which previously included the raw prompt string verbatim). Regression-tested: a Prompt containing an identifiable sentence produces an excerpt that does not contain that sentence, and equals exactly the redacted shape. The full raw prompt value is never persisted anywhere by this correction — not in canonical identity, not in the technical-revision projection (only its hash), not in the evidence excerpt.

## 8. AGENT_VERSION_TECHNICAL_PROFILE_PERSISTENCE_DECISION

**Re-evaluated to a binary decision, per the correction's own "forbidden third option" rule.**

Inspected (only what was necessary, no broad Supabase audit, no production access): `supabase/migrations/20260906120000_canonical_materialization_v1.sql` (`gov_repo.canonical_objects`, `canonical_object_source_mappings`, `canonical_relationships`, `materialization_operations`, `materialization_locks`, `materialize_object_reconciliation`, `materialize_relationship_reconciliation`), and a targeted grep across all 46 migrations for any prior "TechnicalProfile"/"technical_profile"/"behavior_fingerprint" precedent.

**Finding A — no existing table/RPC can carry the frozen `AgentVersionTechnicalProfile` contract today.** The migration's own comment (lines 64–70) states this explicitly and by design: *"kind-specific attributes such as `DataAssetTechnicalProfile` are explicitly separate, mutable, and out of scope for this milestone"* — `gov_repo.canonical_objects` intentionally carries identity only, for every one of the 11 kinds, not just AgentVersion. `materialize_object_reconciliation` writes only that identity row. Confirmed: zero mentions of "TechnicalProfile" exist anywhere else in the migration history — this is a repo-wide gap across all eight `*TechnicalProfile` contracts (Model/Tool/MCP/API/Prompt/KB/Skill/AgentVersion), not one specific to AgentVersion.

**Finding B — the "minimal" fix is foreclosed by a frozen invariant, and the alternative is a genuine new architecture decision.** Persisting a typed, per-field, per-kind profile (with each field's own `assertionIds`/`evidenceIds` support, matching `AgentVersionTechnicalProfileSupport`'s exact shape) requires choosing one of:

- **(a) One shared table with a JSONB payload per kind.** Directly forbidden: `GOVIA-L0L16-CIA-v1.0.md` §4 states *"Generic JSON/EAV never replaces modeled enterprise semantics."* A JSONB blob keyed by field name is exactly the EAV-shaped pattern this sentence rules out.
- **(b) One normalized table per canonical-object kind** (e.g. a real `agent_version_technical_profiles` table with explicit typed columns `behavior_fingerprint_algorithm`/`schema_version`/`value`, `build_reference`, `runtime_framework_reference`, `entrypoint_reference`, `configuration_reference`, plus either five per-field support junction tables or five paired `*_assertion_ids`/`*_evidence_ids` array columns) — architecturally correct and consistent with the frozen "no EAV" invariant, but this is a **new persistence pattern** with zero precedent anywhere in 46 migrations, requiring its own answer for support-array normalization (junction table vs. array column, itself a real schema decision), and — to be consistent rather than arbitrary — would need to be repeated seven more times for Model/Tool/MCP/API/Prompt/KB/Skill's own differently-shaped profiles, none of which exist either.
- **(c) Implement AgentVersion's profile alone, leave the other seven kinds' identical gap untouched.** An arbitrary, unjustified scope boundary with no principled reason one kind gets a writer and the others do not.

None of (a)/(b)/(c) can be derived from an established repository pattern — (a) is architecturally forbidden outright, (b) is a genuine new schema/lifecycle decision (table design, support-array representation, and whether it generalizes to seven other kinds), and (c) is not a real option, just an inconsistency dressed as a minimal fix.

**VERDICT: `STOP_REQUIRES_ARCHITECTURE_DECISION`.**

- **PERSISTENCE_CONTRACT_GAP**: no materialization-stage row exists for `AgentVersionTechnicalProfile`, or any of the other seven `*TechnicalProfile` kinds — `canonical_objects` persists identity only, by explicit prior design.
- **CURRENT_MATERIALIZATION_LIMIT**: `materialize_object_reconciliation` has no parameter, column, or side-table write for a profile payload of any kind.
- **EXACT_DECISION_REQUIRED**: how to persist a typed, per-field-attributed technical profile for canonical objects, consistent with the frozen "no generic JSON/EAV" invariant, decided once for all eight `*TechnicalProfile` kinds (not just AgentVersion) so future kinds don't each re-litigate it.
- **OPTIONS_CONSIDERED**: (a) shared JSONB/EAV table — forbidden by frozen invariant; (b) one normalized table per kind (± a shared per-field support junction table) — architecturally sound, no precedent, real schema-design decision; (c) AgentVersion-only writer — arbitrary, rejected.
- **RECOMMENDED_OPTION**: (b), specifically a **shared, generic `support` junction table** (`canonical_object_id`, `field_name`, `assertion_id`/`evidence_id` rows — itself typed and FK-constrained, not JSON, so it does not violate the EAV prohibition the way a value-carrying EAV table would) paired with **one normalized, typed table per canonical-object kind** for the field *values* themselves. This is a recommendation for the next milestone to decide and design properly, not an implementation performed here.
- **IMPACT_ON_EXISTING_CANONICAL_MATERIALIZATION**: additive only — `canonical_objects`/`canonical_object_source_mappings`/`canonical_relationships` and their existing RPCs are untouched; a new profile write would be a new RPC invoked strictly after `materialize_object_reconciliation` succeeds for that object.
- **MIGRATION_IMPACT**: none in this correction. A future migration implementing the recommended option must be additive, preserve tenant/RLS conventions already established for `gov_repo.*` tables, and gate writes behind the same governed reconciliation/materialization authority — no direct write from Discovery.
- **RLS/TENANCY_IMPACT**: none assessed beyond the existing `organisation_id` FK convention every `gov_repo` table already uses; a future implementation must follow that same convention, not invent a new one.

Framework/Orchestration (no dedicated profile field exists — only a generic `configurationReference`, deliberately not overloaded with multiple distinct facts) and Memory/Technology-Build/Guardrail/HITL (no real-source detection at all this round) are unaffected by this decision either way — they remain Discovery-stage evidence only, independent of whatever the future architecture decision resolves.

## 9. Per-dimension classification (final)

| Dimension | Classification | Trust | Attribution | Governed representation | Technical-revision impact |
|---|---|---|---|---|---|
| Framework/SDK | REAL_SOURCE_IMPLEMENTED (evidence-only) | **INFERRED** (corrected from DECLARED) | same-file | `TechnicalProfileSignal`, no profile writer (§8: STOP) | YES |
| Technology/Build | NOT_IMPLEMENTED | — | — | — | NO |
| MODEL | IMPLEMENTED (reused as-is) | INFERRED (unchanged) | same-file | NormalizedObjectCandidate → PROPOSED | YES |
| PROMPT | REAL_SOURCE_IMPLEMENTED | DECLARED (identity) | same-file | NormalizedObjectCandidate → PROPOSED | YES (declaration key **+ content fingerprint**, corrected) |
| TOOL | IMPLEMENTED (reused as-is) | INFERRED (unchanged) | same-file | NormalizedObjectCandidate → PROPOSED | YES |
| MCP_SERVER | REAL_SOURCE_IMPLEMENTED | DECLARED | path-scoped | NormalizedObjectCandidate → PROPOSED | YES |
| API | REAL_SOURCE_IMPLEMENTED | DECLARED | same-file | NormalizedObjectCandidate → PROPOSED | YES |
| KNOWLEDGE_BASE/RAG | REAL_SOURCE_IMPLEMENTED (KB only) | DECLARED | own config file | NormalizedObjectCandidate → PROPOSED | YES |
| Memory | **NOT_IMPLEMENTED** (corrected from REAL_SOURCE_IMPLEMENTED — see §4) | — | — | — | NO |
| SKILL | REAL_SOURCE_IMPLEMENTED | DECLARED | path-scoped | NormalizedObjectCandidate → PROPOSED | YES |
| Orchestration | REAL_SOURCE_IMPLEMENTED (evidence-only) | **INFERRED** (corrected from DECLARED) | same-file | `TechnicalProfileSignal` | YES |
| Guardrails/HITL | NOT_IMPLEMENTED | — | — | — | NO |

## 10. TECHNICAL_REVISION_INPUTS (final)

```
TECHNICAL_REVISION_INPUTS = [
  "agent-code:<agentCode>",
  "model:<value>",                                  // sorted+deduplicated, 0..n
  "tool:<value>",                                    // sorted+deduplicated, 0..n
  "prompt:<declarationKey>:<contentFingerprint>",    // CORRECTED — content now participates, sorted+deduplicated, 0..n
  "mcp:<value>", "api:<value>", "kb:<value>", "skill:<value>",  // sorted+deduplicated, 0..n each
  "framework:<value>",       // INFERRED, sorted+deduplicated, 0..n
  "orchestration:<value>",   // INFERRED, sorted+deduplicated, 0..n
  // "memory:<value>" REMOVED — Memory is NOT_IMPLEMENTED (see §4)
]
technicalRevisionFingerprint = sha256(canonicalize(TECHNICAL_REVISION_INPUTS))[0:32]

SOURCE_SCOPE_INPUTS = [connectionId, externalType, externalId]   // parent AGENT's own SourceObjectIdentity only
sourceScope = sha256(canonicalize(SOURCE_SCOPE_INPUTS))[0:32]

candidateId suffix = sha256(canonicalize([sourceScope, technicalRevisionFingerprint]))[0:32]
```

## 11. CHANGES_THAT_CREATE_NEW_AGENT_VERSION (final)

```
- a different Model/Tool/MCP/API/Knowledge-Base/Skill value
- a Prompt's own declaration key changing
- a Prompt's own effective STRING CONTENT changing, even under the same declaration key (CORRECTED — previously excluded)
- a Framework import changing (still version-relevant even though INFERRED — trust and version-relevance are independent axes)
- an Orchestration classification changing (as a consequence of a Framework change)
- the parent AGENT's own declaration name changing
- the parent AGENT's source artifact moving to a different SourceConnection (changes sourceScope, not technicalRevisionFingerprint, but still changes the final candidateId)
```

## 12. CHANGES_THAT_DO_NOT_CREATE_NEW_AGENT_VERSION (final)

```
- an unrelated comment/blank-line insertion in the same file (shifts findingId, never technicalRevisionFingerprint) — regression-tested with a real Framework signal AND a real Prompt present
- traversal/detection order
- duplicate identical evidence
- the wall-clock scan time
- a repeated identical scan of the same unchanged repository
- an unrelated file's own technical-profile signal (no cross-file attribution) — regression-tested
```

## 13. Files changed (this final correction, on top of `2769f1e`)

Deleted:
- `packages/scanner/src/discovery/strategies/memory-import-signal.ts`

Modified:
- `technical-profile-signal.ts` — `TECHNICAL_PROFILE_SIGNAL_KIND` drops `MEMORY` (now `{ FRAMEWORK, ORCHESTRATION }` only); doc comments updated
- `strategies/framework-import-signal.ts` — both Framework and Orchestration signals now emit `TRUST_STATE.INFERRED` (was `DECLARED`); doc comments corrected
- `strategies/prompt-declaration.ts` — computes and emits `contentFingerprint` (sha256 of the parsed prompt value); evidence excerpt redacted to `"<NAME> = <redacted>"`
- `detection-specification.ts` — `DetectionMatch` gains optional `contentFingerprint`
- `evidence-assembly.ts` — threads `match.contentFingerprint` into `DiscoveryCandidate.contentFingerprint`
- `agent-version-correlation.ts` — new `extractPromptTechnicalRevisionValues` (declarationKey + contentFingerprint); `TECHNICAL_PROFILE_SIGNAL_LABEL`/`technicalProfileSignalValues` drop `MEMORY`
- `discovery/index.ts`, `src/index.ts` — remove `MemoryImportSignalSpecification`/`MEMORY_IMPORT_PATTERNS` exports
- `apps/dashboard/lib/governance/discovery-intake.ts` — remove `MemoryImportSignalSpecification` from `signalSpecifications`
- `apps/dashboard/tests/discovery-intake-service.test.ts` — L4 Round 1 fixture drops `import redis`; trust/assertion-count expectations corrected; new test proves changed Prompt content changes the AGENT_VERSION identity
- `packages/scanner/test/discovery-engine/agent-version-technical-signals.test.ts` — Memory tests removed; new tests for Framework/Orchestration INFERRED trust, generic-import false-completion, and Prompt content-fingerprint technical-revision sensitivity
- `packages/scanner/test/discovery-engine/l4-round1-object-detection.test.ts` — new tests for content-independent canonical Prompt identity and redacted evidence excerpt

No file under `docs/architecture/**`, `.claude/**`, `supabase/migrations/**`, `codex-recovery-6101-6240.txt`, or `packages/scanner/test/discovery-validation-lab/**` was modified. No dependency, lockfile, or migration change.

## 14. Governance continuity

Unchanged: every canonical object kind (Prompt/MCP_SERVER/API/KNOWLEDGE_BASE/SKILL) reuses the same DETECTED→PROPOSED boundary. Technical-profile signals (now Framework/Orchestration only) remain structurally incapable of reaching `ensureReviewSubjectAndPropose` — no `candidateKind` exists to construct a `DiscoveryFinding` from.

## 15. Relationship semantics

Unchanged. Zero diff on `relationship-correlation.ts`.

## 16. Test results (final)

| Suite | Command | Result |
|---|---|---|
| Scanner discovery-engine (unit) | `npm run test:discovery-engine` (packages/scanner) | **164/164 passing** |
| Scanner discovery-engine typecheck | `npm run typecheck:discovery-engine` | clean |
| Scanner full package typecheck | `npm run typecheck` (packages/scanner) | clean |
| Discovery Validation Lab | `npm run test:validation-lab` (packages/scanner) | **51/51 passing**, unchanged, confirmed green once (not re-run repeatedly) |
| Dashboard targeted governance tests | `discovery-intake-service.test.ts` + `reconciliation-readiness.test.ts` (apps/dashboard) | **29/29 passing** |
| Dashboard workspace typecheck | `npx tsc --noEmit -p tsconfig.json` (apps/dashboard) | clean |
| `git diff --check` | repo root | clean |

`canonical-contracts` and migrations were not touched, so their own suites were not re-run.

## 17. Known limitations (final)

- **Memory, Technology/Build, Guardrails/HITL are NOT_IMPLEMENTED** — Memory specifically was implemented then removed in this pass once its generic-import basis was shown to be a false-positive risk (see §4); the other two had no real-source precedent from the start.
- **Framework/Orchestration are real, evidence-backed, INFERRED signals with no governed profile-field writer** — see §8's `STOP_REQUIRES_ARCHITECTURE_DECISION`.
- **AgentVersionTechnicalProfile (and all seven other `*TechnicalProfile` kinds) materialization requires an architecture decision this correction does not make** — §8.
- **MCP_SERVER/KNOWLEDGE_BASE/SKILL remain path/config-scoped to their own file** and do not fold into any AgentVersion's technical revision (unchanged from the first correction).
- **Framework/Orchestration import detection is line-based regex**, not a real AST/import-resolution parse (unchanged limitation, shared with the legacy detectors this was adapted from).
- **The governance-connected Discovery Engine still has no live production application trigger.**

## 18. Live Discovery trigger status

Unchanged: still absent.
