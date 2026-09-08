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

## 0-BIS. ARCHITECTURE_DECISION: TECHNICAL PROFILE PERSISTENCE V1 — ACCEPTED

The `STOP_REQUIRES_ARCHITECTURE_DECISION` raised in §8 (previous revision) has been resolved by the architecture owner. **`ADR-GOVIA-TECHNICAL-PROFILE-PERSISTENCE-v1.md`** (new, additive; `docs/architecture/GOVIA-L0L16-CIA-v1.0.md` and every other frozen baseline document remain byte-identical to base) records the accepted decision in full. Summary:

- **Typed per-kind persistence**, never generic JSONB/EAV. Canonical identity (`canonical_objects`) stays separate from canonical technical profile.
- **Global pattern, incremental implementation**: this milestone implements `AgentVersionTechnicalProfile` only, as the first instance. The other seven `*TechnicalProfile` contracts (Model/Tool/MCP/API/Prompt/KnowledgeBase/Skill) are **not implemented** — they inherit this same pattern only when their own roadmap milestones require it.
- **Pre-canonical proposal required**: Discovery never writes canonical profile directly; a durable, typed `agent_version_technical_profile_proposals` row exists first.
- **Typed proposal + typed canonical profile**: both tables carry explicit, unrenamed columns derived from the frozen contract.
- **Field-level support**: two strongly relational junction tables (`*_field_assertions`/`*_field_evidence`), `field_name`-constrained to the five frozen `AgentVersionTechnicalProfileSupport` keys.
- **Profile lifecycle**: the canonical profile row may be updated (enrichment) without ever implying a new AgentVersion; the technical-revision fingerprint remains the sole responsibility of `agent-version-correlation.ts`, computed upstream of any profile write.
- **Materialization authority**: `gov_repo.materialize_agent_version_technical_profile` gates on the canonical `AGENT_VERSION` object already existing, the proposal existing, and the proposal's own source candidate being actively mapped to that exact canonical target. Discovery Intake has zero access to this function.

Implementation:

- **Migration**: `supabase/migrations/20260908120000_agent_version_technical_profile_persistence_v1.sql` (additive; does not modify `canonical_objects`/`canonical_relationships`/`materialization_operations`/any historical migration). Tables: `agent_version_technical_profile_proposals`, `agent_version_technical_profile_proposal_field_assertions`, `agent_version_technical_profile_proposal_field_evidence`, `agent_version_technical_profiles`, `agent_version_technical_profile_field_assertions`, `agent_version_technical_profile_field_evidence`, `agent_version_technical_profile_materializations`. Functions: `record_agent_version_technical_profile_proposal` (idempotent durable proposal write), `materialize_agent_version_technical_profile` (the governed gate). One new outbox event type: `GOVERNANCE_AGENT_VERSION_TECHNICAL_PROFILE_MATERIALIZED`.
- **TypeScript port**: `packages/governance-review/src/agent-version-technical-profile-port.ts` (`AgentVersionTechnicalProfilePersistencePort`), exported from the package index.
- **Adapter**: `apps/dashboard/lib/governance/agent-version-technical-profile-persistence.ts` (server-only Supabase RPC caller, mirrors `materialization.ts` exactly).
- **Discovery Intake wiring**: `apps/dashboard/lib/governance/discovery-intake.ts`'s `processAgentVersionTechnicalProfileProposal`, called immediately after `processAgentVersionCandidate` for every correlated `AgentVersionCorrelationResult` — durably records the proposal, never the canonical profile.
- **Scanner exposure**: `packages/scanner/src/discovery/agent-version-correlation.ts`'s `AgentVersionCorrelationResult` gained `technicalRevisionFingerprint` (the exact value already folded into `candidate.candidateId`, now also mapped into `behaviorFingerprint.value` — no second, competing fingerprint) and an optional `runtimeFrameworkReference`/`runtimeFrameworkReferenceSupport` (present only when exactly one same-file `FRAMEWORK` signal was correlated — ambiguous/absent cases fail closed).

### AGENT_VERSION_PROFILE_FIELDS (exact, from the frozen contract)

Inspected only: `AgentVersionTechnicalProfile`/`AgentVersionTechnicalProfileSupport` (`contracts.ts:1096-1112`), `BehaviorFingerprint` (`contracts.ts:376-382`), `TechnicalMetadataSupport` (`contracts.ts:691-694`), `AgentVersionId` (`identifiers.ts:10`), the existing `discovery_candidates`/`canonical_objects`/`canonical_object_source_mappings`/`source_assertions`/`discovery_evidence` schemas, and `gov_repo` RLS/tenant conventions across the migration history. No broad audit performed.

```
AGENT_VERSION_PROFILE_FIELDS = [
  "behaviorFingerprint" -> { algorithm, schemaVersion, value }  // REQUIRED, flattened to 3 columns
  "buildReference"             -> string | UNKNOWN               // NOT_IMPLEMENTED this round (no detector)
  "runtimeFrameworkReference"  -> string | UNKNOWN               // populated only when unambiguous
  "entrypointReference"        -> string | UNKNOWN               // NOT_IMPLEMENTED this round (no detector)
  "configurationReference"     -> string | UNKNOWN               // NOT_IMPLEMENTED this round (no detector; Orchestration never overloads this field)
]

AGENT_VERSION_PROFILE_SUPPORT_FIELDS = [
  behaviorFingerprint:       { assertionIds, evidenceIds }  // the whole correlated AGENT_VERSION union
  buildReference:            { assertionIds: [], evidenceIds: [] }
  runtimeFrameworkReference: { assertionIds, evidenceIds }  // exactly the one Framework signal's own ids, or empty
  entrypointReference:       { assertionIds: [], evidenceIds: [] }
  configurationReference:    { assertionIds: [], evidenceIds: [] }
]
```

No field was renamed for database convenience; no speculative field was added. `buildReference`/`entrypointReference`/`configurationReference` are always `NULL`/empty-support this round — `UNKNOWN`, never coerced to `FALSE` or a fabricated value.

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

## 8. AGENT_VERSION_TECHNICAL_PROFILE_PERSISTENCE_DECISION — IMPLEMENTED

**Resolved by the architecture owner as Technical Profile Persistence V1** (`ADR-GOVIA-TECHNICAL-PROFILE-PERSISTENCE-v1.md`, ACCEPTED) — see §0-BIS for the full decision and implementation summary. This section previously ended in `STOP_REQUIRES_ARCHITECTURE_DECISION`; that stop is now resolved and the migration/port/adapter/wiring described in §0-BIS is implemented and tested (§16).

- **PERSISTENCE_CONTRACT_GAP** (as originally found): no materialization-stage row existed for any `*TechnicalProfile` kind. **Closed for `AgentVersionTechnicalProfile` only** by `20260908120000_agent_version_technical_profile_persistence_v1.sql`. The identical gap remains open for the other seven `*TechnicalProfile` kinds — not implemented, not claimed implemented.
- **CURRENT_MATERIALIZATION_LIMIT**: `materialize_object_reconciliation` still writes only canonical identity — unchanged, untouched by this migration. The new `materialize_agent_version_technical_profile` function is a separate, narrowly-scoped operation, never an overload of the existing one.
- **IMPACT_ON_EXISTING_CANONICAL_MATERIALIZATION**: none — additive only, zero diff on `canonical_objects`/`canonical_object_source_mappings`/`canonical_relationships`/`materialization_operations`/`materialization_locks` or their functions.
- **RLS/TENANCY**: every new table enables RLS and follows the exact established convention for this table family (`gov_repo.canonical_objects`, `discovery_findings`, `review_subjects`, etc.) — `service_role`-only policy, `using (true) with check (true)`, no `authenticated`-role policy; tenant isolation enforced by `(organisation_id, ...)` composite primary keys/FKs throughout plus explicit `p_organisation_id` verification inside every `SECURITY INVOKER` function. This is the same pattern the entire Decision-to-Truth pipeline already uses (confirmed by inspection across `governance_persistence_v1.sql`, `canonical_materialization_v1.sql`, `discovery_governance_input_persistence_v1.sql`) — not a weaker, novel one.

Framework/Orchestration (no dedicated profile field — `runtimeFrameworkReference` is the one exception, now implemented; `configurationReference` is deliberately never overloaded with Orchestration) and Memory/Technology-Build/Guardrail/HITL (no real-source detection at all this round) remain Discovery-stage evidence only where no field exists — correctly unaffected by this decision.

### GOVERNANCE_GATE_PROOF

`gov_repo.materialize_agent_version_technical_profile` gates on: (a) a `canonical_objects` row existing for `p_canonical_object_id` with `kind = 'AGENT_VERSION'`, and (b) an active (`valid_to is null`) `canonical_object_source_mappings` row binding that exact canonical object to the proposal's own source candidate's `SourceObjectIdentity`. Traced (not assumed) against the existing migration history: `canonical_objects` and `canonical_object_source_mappings` each have **exactly one** INSERT statement anywhere in the repository (`grep -rn "insert into gov_repo\.canonical_objects\|insert into gov_repo\.canonical_object_source_mappings" supabase/` returns exactly two matches, both inside `gov_repo.materialize_object_reconciliation`), and that function itself only ever executes after verifying an already-persisted `reconciliation_decisions` row (family `OBJECT`) with a matching `reconciliation_invocations` row — both of which, per `governance_persistence_v1.sql`, can only be created by `record_authorized_reconciliation`, itself gated on an ALLOW authorization decision for a `CERTIFIED` `ReviewSubject` (human-only transitions, per `transitions.ts`: `confirm`/`certify` both "require an explicit human actor," enforced independently at the TypeScript and CHECK-constraint layers). **Conclusion: the existence of a `canonical_objects` row with `kind = AGENT_VERSION` is formally sufficient proof that the full governed lifecycle (CERTIFIED → authorized → reconciled → materialized) already completed for that exact object — not an assumption, a closed, single-path invariant.** No duplicate governance lifecycle was created; no additional ReviewSubject-state check was added because none is needed on top of this proof.

This SQL-level gate cannot itself be exercised by an automated test in this environment (`no live Supabase, no production` — Section 12/the milestone's own instruction), so it is verified here by tracing the single-INSERT invariant above, not by execution. The TypeScript-level tests (§16) instead prove the surrounding, testable claims: Discovery Intake never calls `materializeAgentVersionTechnicalProfile` at all (so the gate is never even reachable from the untrusted Discovery path), and the proposal-recording side behaves correctly in isolation.

### PROPOSAL_IDEMPOTENCY_RULE (corrected)

The originally-implemented `record_agent_version_technical_profile_proposal` caught `unique_violation` and returned `replay: true` unconditionally — meaning a reused `proposal_id` with **materially different** stored content would have silently replayed instead of failing closed. **Fixed**: the function now selects any existing row for `(organisation_id, proposal_id)` first (and again inside the `unique_violation` handler, for the concurrent-race case) and compares every semantic column; an exact match returns `replay: true` as before, but a mismatch raises `PROPOSAL_IDEMPOTENCY_CONFLICT` instead of silently discarding either value. `proposal_id` is still expected to be content-addressed by the TypeScript caller (making a real-world collision cryptographically improbable), but the persistence layer no longer relies on that assumption alone.

### MATERIALIZATION_IDEMPOTENCY_RULE (corrected)

The originally-implemented `materialize_agent_version_technical_profile` checked `agent_version_technical_profile_materializations` for an existing row but performed the `ON CONFLICT DO UPDATE` upsert (which unconditionally increments `revision`) **before** consulting that check — meaning a pure replay of an already-applied `(canonical_object_id, proposal_id)` pair would have incorrectly bumped `revision`, implying enrichment that never happened. **Fixed**: the existing-materialization check now runs first and returns immediately (`replay: true`, no writes at all) before the upsert, field-support rewrite, audit-row insert, or outbox-event insert are ever reached. Only a genuinely new `(canonical_object_id, proposal_id)` pair — the first materialization for that AgentVersion, or a real enrichment via a different `proposal_id` — ever increments `revision`, writes a new audit row, or emits a new outbox event.

### RLS_TENANCY_RULE

Verified (not redesigned): every new table enables RLS; `public`/`anon`/`authenticated` are revoked; a single `service_role` policy (`using (true) with check (true)`) is granted, identical in shape to every adjacent Decision-to-Truth table (`canonical_objects`, `review_subjects`, `discovery_findings`, `reconciliation_decisions`, …). No new `authenticated`-role policy was added — this table family has never had one anywhere in the migration history (confirmed by grep), so this is not a departure from an established stronger pattern, it is the established pattern. Cross-tenant protection is enforced by: `(organisation_id, id)` composite primary keys and foreign keys throughout (a proposal's `agent_version_candidate_id` FK is itself `(organisation_id, candidate_id)`-scoped, so tenant A's proposal can never reference tenant B's candidate); every `SECURITY INVOKER` function takes `p_organisation_id` as an explicit parameter and uses it in every `where` clause, never inferring tenant from session state; the materialization gate's `canonical_object_source_mappings` lookup is itself `organisation_id`-scoped, so a proposal cannot be materialized against a different tenant's canonical AgentVersion even if the caller supplied a foreign `canonical_object_id` (the object lookup itself would simply not find a matching row for that `organisation_id`).

### OUTBOX_RULE

One new event type added (`GOVERNANCE_AGENT_VERSION_TECHNICAL_PROFILE_MATERIALIZED`) via `drop constraint` + `add constraint` against the existing `outbox_events_event_type_check`, preserving all five prior allowed values verbatim. The payload contains only identifiers (`organisationId`, `canonicalObjectId`, `proposalId`, `materializationId`) — no raw Prompt content, no profile field values, no secrets. `payload_hash` uses the identical `encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex')` convention every other outbox insert in this history already uses. A replay never emits a duplicate event, as a direct consequence of the `MATERIALIZATION_IDEMPOTENCY_RULE` fix above (the outbox insert lives after the early replay return).

### MIGRATION

One new, purely additive migration: `supabase/migrations/20260908120000_agent_version_technical_profile_persistence_v1.sql` (725 lines). A `do $preflight$` block fails closed (raises, does not silently skip) if `gov_repo` or any of its prerequisite tables (`canonical_objects`, `canonical_object_source_mappings`, `discovery_candidates`, `discovery_evidence`, `source_assertions`, `outbox_events`) are missing, and again if any target table already exists (naming-collision guard). No historical migration file was edited; `canonical_objects`, `canonical_relationships`, `materialization_operations`, `materialization_locks`, `discovery_findings`, `discovery_candidates` are untouched by this migration. Not applied to any live/production Supabase instance — no live database access was used or is authorized by this pass; internal consistency was verified by full re-read of the corrected file plus the TypeScript-level port/adapter tests (§16), not by execution against a running database.

### PROMPT_REGRESSION

Explicit confirmation that Defect #2's correction (Prompt content participating in `technicalRevisionFingerprint` via `contentFingerprint`, §6/§7) is preserved unmodified by this session's persistence work: `prompt-declaration.ts`, `agent-version-correlation.ts`'s `extractPromptTechnicalRevisionValues`, and `TECHNICAL_REVISION_INPUTS`'s `"prompt:<declarationKey>:<contentFingerprint>"` entry (§10) all have zero diff in this recovery session (confirmed by `git diff --name-only` against `88b0c60`, §13). The dashboard regression test "DEFECT #2 CORRECTION: changing only the Prompt's own string content (same declaration key) DOES change the AGENT_VERSION technical revision" was re-run in this session (not merely assumed green) and still passes. Prompt's raw content is still never written to `agent_version_technical_profile_proposals`/`agent_version_technical_profiles` — those tables carry only `behaviorFingerprint`/`buildReference`/`runtimeFrameworkReference`/`entrypointReference`/`configurationReference`, none of which is Prompt-shaped; the Prompt content fingerprint's only persisted destination remains the `technicalRevisionFingerprint` folded into `behaviorFingerprint`, never a standalone raw-content column.

### UNSUPPORTED_DIMENSIONS

Explicit, closed list of dimensions with **no** proposal/persistence path in this migration (absence is `UNKNOWN`, never fabricated as a value): Memory (removed entirely, §4), Technology/Build (no detector — `buildReference` proposal input is always `NULL`), Guardrails/HITL (no detector at all), Orchestration (real `TechnicalProfileSignal`, `INFERRED`, but no dedicated profile field — never written into `configurationReference` or any other field), and all seven sibling `*TechnicalProfile` canonical-object kinds (Model/Tool/MCP/API/Prompt/KnowledgeBase/Skill technical profiles — only `AgentVersionTechnicalProfile` is implemented this round, per ADR Decision B). `entrypointReference` additionally has no detector in this round despite having a dedicated field, so it is always persisted as `NULL`/absent alongside `buildReference`.

## 9. Per-dimension classification (final)

| Dimension | Classification | Trust | Attribution | Governed representation | Technical-revision impact |
|---|---|---|---|---|---|
| Framework/SDK | REAL_SOURCE_IMPLEMENTED | **INFERRED** (corrected from DECLARED) | same-file | `TechnicalProfileSignal` → typed pre-canonical proposal (`runtimeFrameworkReference`, only when unambiguous) → governed canonical profile (§0-BIS/§8) | YES |
| Technology/Build | NOT_IMPLEMENTED | — | — | — | NO |
| MODEL | IMPLEMENTED (reused as-is) | INFERRED (unchanged) | same-file | NormalizedObjectCandidate → PROPOSED | YES |
| PROMPT | REAL_SOURCE_IMPLEMENTED | DECLARED (identity) | same-file | NormalizedObjectCandidate → PROPOSED | YES (declaration key **+ content fingerprint**, corrected) |
| TOOL | IMPLEMENTED (reused as-is) | INFERRED (unchanged) | same-file | NormalizedObjectCandidate → PROPOSED | YES |
| MCP_SERVER | REAL_SOURCE_IMPLEMENTED | DECLARED | path-scoped | NormalizedObjectCandidate → PROPOSED | YES |
| API | REAL_SOURCE_IMPLEMENTED | DECLARED | same-file | NormalizedObjectCandidate → PROPOSED | YES |
| KNOWLEDGE_BASE/RAG | REAL_SOURCE_IMPLEMENTED (KB only) | DECLARED | own config file | NormalizedObjectCandidate → PROPOSED | YES |
| Memory | **NOT_IMPLEMENTED** (corrected from REAL_SOURCE_IMPLEMENTED — see §4) | — | — | — | NO |
| SKILL | REAL_SOURCE_IMPLEMENTED | DECLARED | path-scoped | NormalizedObjectCandidate → PROPOSED | YES |
| Orchestration | REAL_SOURCE_IMPLEMENTED (evidence-only) | **INFERRED** (corrected from DECLARED) | same-file | `TechnicalProfileSignal` only — never mapped into any profile field (no dedicated field exists; `configurationReference` is deliberately never overloaded) | YES |
| Guardrails/HITL | NOT_IMPLEMENTED | — | — | — | NO |
| AgentVersion `behaviorFingerprint` | IMPLEMENTED | n/a (derived, not independently asserted) | same-file (whole correlated union) | Typed pre-canonical proposal → governed canonical profile (§0-BIS/§8) | n/a — this field IS the technical revision, mapped from it, never a second competing fingerprint |

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
| governance-review package | `npm run test` + `npm run typecheck` (packages/governance-review) | **113/113 passing**, typecheck clean (new `AgentVersionTechnicalProfilePersistencePort` is purely additive) |
| Dashboard: `discovery-intake-service.test.ts` (includes 7 new Technical Profile Persistence V1 tests) | `node --test tests/discovery-intake-service.test.ts` (apps/dashboard) | **28/28 passing** |
| Dashboard: files importing `discovery-intake.ts` (`object-candidate-reconciliation-continuity`, `discovery-governance-input-persistence-domain`, `discovery-intake-persistence-domain`) | `node --test` per file | **21/21 passing** (2 + 15 + 4) |
| Dashboard: `reconciliation-readiness.test.ts` | `node --test tests/reconciliation-readiness.test.ts` | **8/8 passing** |
| Dashboard workspace typecheck | `npx tsc --noEmit` (apps/dashboard) | clean |
| Migration SQL | full re-read of the corrected 725-line file end-to-end | internally consistent; no live-database execution (none authorized) |
| `git diff --check` | repo root | clean |

`canonical-contracts` and all historical migrations were not touched, so their own suites were not re-run. This recovery session's only source changes were the two SQL-function corrections (§8); no TypeScript file changed, so the scanner/governance-review/dashboard results above were re-confirmed rather than newly required — run once, not repeatedly.

## 17. Known limitations (final)

- **Memory, Technology/Build, Guardrails/HITL are NOT_IMPLEMENTED** — Memory specifically was implemented then removed in this pass once its generic-import basis was shown to be a false-positive risk (see §4); the other two had no real-source precedent from the start. None of the three has a profile field or a proposal path.
- **Orchestration remains evidence-only** — a real, INFERRED `TechnicalProfileSignal`, but there is no dedicated `AgentVersionTechnicalProfile` field for it, and `configurationReference` is deliberately never overloaded to hold it (see §0-BIS/§4). This is a contract-shape limitation, not a persistence gap — implementing Orchestration's own profile field would itself be a frozen-contract change, out of scope here.
- **`AgentVersionTechnicalProfile` persistence is now implemented (Technical Profile Persistence V1, §0-BIS/§8)** — this replaces the prior pass's open `STOP_REQUIRES_ARCHITECTURE_DECISION`. The identical persistence gap remains for all seven sibling `*TechnicalProfile` kinds (Model/Tool/MCP/API/Prompt/KnowledgeBase/Skill) — not implemented, not claimed implemented; they follow this same pattern only when their own roadmap milestones require it.
- **`buildReference`/`entrypointReference` have no detector in this round** — always persisted as absent/`NULL` (`UNKNOWN`), never a fabricated value.
- **No live Discovery-triggered or UI-triggered call path invokes `materialize_agent_version_technical_profile`** — the RPC/port/adapter exist and are tested directly, but no route/button was wired in this pass (matching the same "implemented, not yet live-triggered" honesty already established for the broader Discovery Engine, §18).
- **MCP_SERVER/KNOWLEDGE_BASE/SKILL remain path/config-scoped to their own file** and do not fold into any AgentVersion's technical revision (unchanged from the first correction).
- **Framework/Orchestration import detection is line-based regex**, not a real AST/import-resolution parse (unchanged limitation, shared with the legacy detectors this was adapted from).
- **The governance-connected Discovery Engine still has no live production application trigger.**

## 18. Live Discovery trigger status

Unchanged: still absent.
