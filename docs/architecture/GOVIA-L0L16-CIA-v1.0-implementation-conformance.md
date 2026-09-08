# Gov IA CIA Implementation Conformance & Reuse Audit — v1

**Architecture ID:** `GOVIA-L0L16-CIA-v1.0` (FROZEN BASELINE — unchanged by this audit)
**Audited main SHA:** `732a3379a53482ee7cb9f483e5ad8f35bab26f9c`
**Audit date:** 2026-09-08
**Audit type:** Read-only engineering conformance & reuse audit. No feature code, migrations, dependency, or lockfile changes.

This document reconciles the frozen architecture (`GOVIA-L0L16-CIA-v1.0.md`) against the
**actual** state of current `main`, current test infrastructure, and read-only Git history —
not against the roadmap, and not against `GOVIA-L0L16-CIA-v1.0-coverage.md` alone (SHA
`b663db4`, two commits behind this audit's base). Every classification below is evidence-based
(file path + line, or a passing test run), per the classification vocabulary in the audit
prompt: `CURRENT_MAIN_IMPLEMENTED`, `CURRENT_MAIN_PARTIAL`, `CURRENT_MAIN_FOUNDATIONAL`,
`TEST_ONLY_COMPLETE`, `EXISTS_NOT_WIRED`, `LEGACY_NOT_AUTHORITATIVE`, `HISTORICAL_REUSABLE`,
`SUPERSEDED`, `NOT_IMPLEMENTED`, `QUARANTINED`.

`docs/architecture/GOVIA-L0L16-CIA-v1.0.md` and `ADR-GOVIA-L0L16-CIA-v1.0.md` were **not**
modified by this audit. `GOVIA-L0L16-CIA-v1.0-coverage.md` is corroborated in most respects and
corrected in a small number of specific places (noted inline as **[CORRECTION]**) where deeper
file-level inspection than the prior pass found either more capability than recorded (e.g. L7
vector infrastructure) or a more precise root cause than recorded (e.g. AGENT normalization
failing closed unconditionally, and the Graph route not projecting canonical-materialized
objects at all).

---

## 1. Executive repository state

The premise behind this audit is confirmed: **substantial capability scheduled as "future
work" in earlier planning material already exists, merged, and tested on `main`.** Specifically:

- The Discovery Validation Lab (deterministic normalize/match/metrics/report harness) and all
  **six** Golden Repositories with independent `expected.json` oracles are fully built and
  passing (51/51 Lab tests, 92/92 Discovery Engine tests, executed read-only during this audit).
  TP/FP/FN, precision/recall/F1 (with explicit zero-denominator handling), negative scenarios,
  and evidence validation all exist and are exercised by real tests — this must **not** be
  rebuilt.
- Canonical contracts (`packages/canonical-contracts`) fully model the 11-kind closed object
  taxonomy, the AGENT/AGENT_VERSION distinction, and the exact 12-relationship-type closed
  taxonomy with endpoint constraints specified in the frozen architecture — with **zero
  deviation** found.
- A complete Decision-to-Truth persistence pipeline (Finding → Candidate → ReviewSubject →
  Authorization → Reconciliation → Materialization → Canonical Object/Relationship) is real,
  transactional, idempotent, and optimistic-concurrency-protected at the database layer.

At the same time, the audit found the *production reach* of this infrastructure is narrower
than the contracts/persistence layer suggests, and identified one structural disconnect not
previously documented: **the current authoritative Graph route reads exclusively from a
separate, pre-canonical table set (`gov_repo.agents`, `agent_edges`, `ai_systems`,
`ict_incidents`, …) and never projects `gov_repo.canonical_objects` /
`gov_repo.canonical_relationships` at all** — meaning even the two object kinds (MODEL, TOOL)
that *can* reach full materialization today are invisible everywhere outside the Governance
Workspace review-detail page. See §19 (True Gaps), Gap G-01.

The true root gap, confirmed independently by three separate lines of evidence (canonical
contracts, discovery engine, governance persistence), is that **AGENT identity normalization
fails closed unconditionally today** (`AgentCandidateNormalizationStrategy` always returns
`NOT_SAFELY_NORMALIZABLE`) and **AGENT_VERSION has zero implementation anywhere in
`packages/scanner/src`**. This single gap blocks: Passport family 1 (Identity) end-to-end
governance, Passport family 7 (Agent Architecture & Behavior), and all 12 governed relationship
types (every one requires an `AGENT_VERSION` or `DATA_ELEMENT` source endpoint, and neither kind
has a production identity normalizer).

---

## 2. Architecture authority

`GOVIA-L0L16-CIA-v1.0` remains the sole architectural authority. This audit does not modify it,
does not infer implementation from it, and treats any conflict between architecture and code as
a gap to record, not a reason to reinterpret the architecture.

---

## 3. Current-main subsystem inventory

| Path | Purpose | Production use | Test use | Maturity |
|---|---|---|---|---|
| `packages/canonical-contracts` | Pure TypeScript contracts: object kinds, identities, relationship taxonomy, reconciliation/materialization input shapes | Consumed by `packages/governance-review`, `apps/dashboard/lib/governance/*`, `packages/scanner/src/discovery/object-candidate-normalization.ts` | `contracts.test.mjs` (5202 lines), `contracts.type-test.ts` (compile-time) | CURRENT_MAIN_FOUNDATIONAL (rich, but types only — no persistence/runtime of its own) |
| `packages/governance-review` | ReviewSubject lifecycle, authorized reconciliation gate, reconciliation invocation | Wired into `apps/dashboard` governance workspace API routes | Package-level unit tests | CURRENT_MAIN_IMPLEMENTED |
| `packages/scanner` | Discovery detectors (legacy `codeguard/*` + newer `discovery/*`), risk detection, Discovery Validation Lab + Golden Repositories | Legacy `codeguard/*` path wired to `/api/discovery/scan`; newer `discovery/*` `DiscoveryPipeline` built but **unreachable from any route** | 92/92 discovery-engine tests, 51/51 validation-lab tests (run during this audit) | Mixed — see §8/§9 |
| `packages/graphos` | Standalone in-memory `GraphEngine` library | **Not imported by `apps/dashboard`** — only reachable via `graphos-complete/scripts/pipeline.ts` | Package-level tests only | LEGACY_NOT_AUTHORITATIVE |
| `apps/dashboard` | Next.js product: governance workspace, graph route, discovery scan API, Talk-to-Governance assistant | Production application | Extensive `tests/` directory | Mixed — see per-subsystem sections |
| `apps/extension` | Separate VS Code extension product ("codeguard-ai"), own multi-LLM router/cost analytics | Independent product, not part of the audited L0–L16 chain | Own test suite | Out of scope for this architecture (distinct product) |
| `supabase/migrations` | 41 migration files; canonical/governance persistence + pre-existing agent-registry/graph/vector schema | Production schema | Migration-level `do $$` preflight guards; evidence docs in `docs/codex/evidence/*` | CURRENT_MAIN_IMPLEMENTED for what exists; see §15 for scope |
| `supabase/legacy-migrations` | Pre-canonical schema history | Superseded by `supabase/migrations` where overlapping | — | LEGACY_NOT_AUTHORITATIVE (not audited further; out of scope) |
| `graphos-complete/` | Separate, non-workspace Next.js prototype ("council") — own `graphos_entities`/`graphos_relationships` tables, own roadmap (Portuguese, mostly unchecked) | None — excluded from `package.json` workspaces, zero imports from `apps/dashboard` | Isolated `test:graphos` CI script only | HISTORICAL — confirmed by `GOVIA-L0L16-CIA-v1.0-coverage.md` drift register item G; corroborated here with import-graph evidence |
| `docs/architecture` | Frozen architecture baseline + roadmap + coverage + ADR | Governs all future milestone decisions | N/A | Authoritative |
| `docs/codex/evidence` | Per-milestone runtime validation evidence | Historical evidence trail | N/A | Reference |
| `TRACEABILITY_MATRIX.md` | Static compliance-control mapping (CG-AG-001…012 → EU AI Act/DORA/ISO 42001/NIST AI RMF/ISO 27001) | Documentation artifact, not a persistence layer | N/A | CURRENT / IMPLEMENTATION-SPECIFIC (per coverage.md drift item H) — confirmed static, not code |

---

## 4. Current production Discovery paths — two non-interoperating pipelines

**Path A (legacy, live at `/api/discovery/scan`):**
`apps/dashboard/app/api/discovery/scan/route.ts` → `packages/scanner/src/codeguard/agent-detector.ts`
(`detectAgents`) + `codeguard/classifier.ts` + `codeguard/enrichment/*` → writes directly to the
Supabase `agents` table with `status: "pending_registration"`; everything else (models, tools,
lineage) is squashed into a JSON blob at `agents.external_refs.discovery`. Reviewed through a
hand-rolled 3-state lifecycle in `/api/discovery/review` that **bypasses
`packages/governance-review` entirely.**

**Path B (architecturally correct "Discovery Engine V1", built but unreachable):**
`packages/scanner/src/discovery/*` (`DiscoveryPipeline`, 3 `DetectionSpecification`s: Agent-kind,
Model-reference, Tool-list declarations) → `object-candidate-normalization.ts` →
`apps/dashboard/lib/governance/discovery-intake.ts` (`runGovernanceDiscoveryScan`) →
`ReviewSubject` (`DETECTED → PROPOSED`). `runGovernanceDiscoveryScan` is exported but has **zero
callers under `apps/dashboard/app/**`** — its only caller in the whole repository is its own
test file. It is fully built, fully tested, and has no production trigger (no route, no cron,
no script).

**Path C (Discovery Validation Lab):** a self-contained oracle/measurement harness
(`packages/scanner/test/discovery-validation-lab/**`) that never invokes either Path A or Path B
in its own test suite — see §9.

Object kinds detected in production Path B (the only path with a governance-connected
normalization/materialization story): **AGENT, MODEL, TOOL only** — 3 of 11 canonical object
kinds. Everything downstream of this report (§10–§13) traces from this fact.

---

## 5. Golden Repositories status

**Complete and usable today.** All six approved scenarios exist under
`packages/scanner/test/discovery-validation-lab/golden-repositories/`:
`01-simple-agent`, `02-multi-agent`, `03-monorepo`, `04-mcp-not-agent`, `05-false-positives`,
`06-care-coordination` — each with `README.md` + independently-authored `.govia-lab/expected.json`
covering positive expectations, `05-false-positives`'s explicit `prohibited` negative
expectations, evidence requirements, relationship expectations (including directional
`DERIVED_FROM` column lineage in `03-monorepo`), and DataAsset/DataElement expectations.
Confirmed by a passing `golden-repositories.test.ts` hard assertion of "exactly the six approved
scenario directories" plus per-scenario category counts.

`expected.json` is a genuine independent ground-truth oracle: `oracle-loader.ts` is documented
as "the sole Lab entry point authorized to read `.govia-lab/expected.json`" and imports nothing
from any scanner detection module — only the shared, generic `path-policy.ts` safety check.

**Classification: `CURRENT_MAIN_IMPLEMENTED`.**

---

## 6. Discovery Validation Lab status

| Capability | Status | Evidence |
|---|---|---|
| Path exclusion policy | YES | `packages/scanner/src/discovery/path-policy.ts` — production code, reused (not reimplemented) by the Lab |
| `contracts/detected.ts` / `contracts/expected.ts` | YES | Both files fully specified, versioned (`schemaVersion: "1.0"`) |
| oracle-loader | YES — independent | `harness/oracle-loader.ts`; reads `.govia-lab/expected.json` off disk directly |
| repository-snapshot | YES | `harness/repository-snapshot.ts` — deterministic, traversal-safe |
| deterministic normalize | YES | `harness/normalize.ts` — strips volatile fields, rejects `OBSERVED` trust state for design-time results, stable sort |
| exact match (directional relationships, explicit aliases, no fuzzy matching) | YES | `harness/match.ts` |
| TP/FP/FN, precision/recall/F1, zero-denominator handling | YES | `harness/metrics.ts` — `NOT_ASSESSED`/`null`/`ZERO_DENOMINATOR` guard, not `NaN`/`0` |
| Report generator | YES | `harness/report.ts` — canonically key-sorted JSON |
| Determinism / expected-contract / matching / metrics / path-policy / technical-vocabulary tests | YES, all present | `tests/*.test.ts` — 51/51 passing (run during this audit) |
| **Lab wired to real production scanner output** | **NO — `EXISTS_NOT_WIRED`** | No file in `harness/` or `tests/` imports `DiscoveryPipeline` or any `src/discovery` detection strategy. Every Lab test feeds hand-crafted fixtures. No `DiscoveryCandidate → DetectedScenarioResult` adapter exists anywhere in the repo. |
| Baseline snapshot (e.g. `baselines/p1.0.2-initial.json`) | **Absent** | Exhaustive `Glob "**/baselines/**"` returns zero results anywhere on `main` |

A **separate, narrower** suite (`packages/scanner/test/discovery-engine/golden-repository.test.ts`)
does run the real `DiscoveryPipeline` against 3 of the 6 golden repos, but asserts raw candidate
counts by hand — it bypasses the Lab's oracle/match/metrics/report pipeline entirely.

**Classification: harness + fixtures = `CURRENT_MAIN_IMPLEMENTED`. End-to-end measurement of the
real scanner = `EXISTS_NOT_WIRED`. Baseline snapshot = `NOT_IMPLEMENTED`.**

---

## 7. Baseline snapshot status

Confirmed absent (§6). No `baselines/` directory exists on `main` in any form.

---

## 8. AGENT status

- Detection: real, in three separate places (`codeguard/agent-detector.ts`, `core/agent-detector.ts`,
  `discovery/strategies/agent-kind-declaration.ts`).
- Logical identity: PARTIAL — Path A derives a name/framework heuristically; Path B's
  `AgentKindDeclarationSpecification` proves only a structural literal, never a name.
- **Normalized candidate: NO — fails closed unconditionally.**
  `packages/scanner/src/discovery/object-candidate-normalization.ts:104-114`
  (`AgentCandidateNormalizationStrategy`) **always** returns `NOT_SAFELY_NORMALIZABLE` /
  `AGENT_IDENTITY_NOT_DERIVABLE`, by explicit in-code design comment — not a bug, a deliberate
  fail-closed placeholder.
- Canonical readiness: NO. `recoverReconciliationInput` returns `FINDING_ONLY` for every AGENT
  candidate today; `deriveReconciliationReadiness` never returns `ready: true` for AGENT.
- **Governed continuity: NO end-to-end.** AGENT can reach `CERTIFIED` in the ReviewSubject
  lifecycle, but can never reach `CREATE_NEW`/`MATCH_EXISTING` reconciliation, and therefore
  never reaches `gov_repo.canonical_objects`.

**Classification: `CURRENT_MAIN_PARTIAL`** (detection real; canonicalization fails closed by
design, unconditionally, today).

---

## 9. AGENT_VERSION status

- Presence detection: **NOT_IMPLEMENTED.** Exhaustive grep for `AGENT_VERSION|AgentVersion` across
  `packages/scanner/src` returns **zero hits.**
- Explicit version evidence / technical fingerprint / normalized candidate / governance
  continuity / canonical continuity: all **NOT_IMPLEMENTED** — there is nothing to evidence,
  since no detector or strategy of any kind produces this kind.
- Modeled contract only: `AgentVersionIdentity`, `AgentVersionTechnicalProfile`,
  `BehaviorFingerprint` exist in `packages/canonical-contracts/src/contracts.ts:582-593,1096-1112`
  and are fully specified as the required source endpoint for all 7 behavior-binding relationship
  types plus `HANDOFF_TO`/`READS_FROM`/`WRITES_TO`.

**Classification: `CURRENT_MAIN_FOUNDATIONAL`** (contract only; zero runtime instantiation).

---

## 10. Object-kind capability matrix

Legend: D = Detector exists, P = Real production path, I = Identity sufficient, N = Normalized
candidate, S = Persistable, G = Governable (reaches ReviewSubject), C = Canonicalizable (reaches
`gov_repo.canonical_objects`).

| Kind | D | P | I | N | S | G | C |
|---|---|---|---|---|---|---|---|
| AGENT | YES | YES (Path A only; Path B unreachable) | PARTIAL | **NO (fails closed)** | Path A: legacy `agents` table only | NO (Path A bypasses governance-review) | **NO** |
| AGENT_VERSION | NO | NO | NO | NO | NO | NO | NO |
| MODEL | YES | YES (Path B) | PARTIAL/YES | YES | YES | YES | **YES — reaches materialization** |
| TOOL | YES | YES (Path B) | YES | YES | YES | YES | **YES — reaches materialization** |
| MCP_SERVER | NO (folded into AGENT rows) | NO | N/A | NO | NO | NO | NO |
| API | NO | NO | NO | NO | NO | NO | NO |
| PROMPT | PARTIAL (notebook extraction, unwired) | NO | NO | NO | NO | NO | NO |
| KNOWLEDGE_BASE | NO (classified as "MemorySystem" signal, not object) | NO | NO | NO | NO | NO | NO |
| SKILL | NO (folded into AGENT rows) | NO | NO | NO | NO | NO | NO |
| DATA_ASSET | Legacy heuristic only, hardcoded customer keywords, dead output | NO (never mapped into `UnifiedScanResult` or persisted) | PARTIAL (table-name string only) | NO | NO | NO | NO |
| DATA_ELEMENT | NOT_IMPLEMENTED (zero column-level detection code) | NO | NO | NO | NO | NO | NO |

**Only MODEL and TOOL traverse the full pipeline today.** This is a materially narrower result
than `GOVIA-L0L16-CIA-v1.0-coverage.md`'s L4 note ("MODEL and TOOL have normalized object
continuity through discovery → reconciliation → materialization") suggested at a glance — this
audit confirms that statement precisely and adds that **AGENT does not**, by an unconditional,
documented design choice in `object-candidate-normalization.ts`, not an oversight.

---

## 11. Relationship capability matrix

| Relationship | Produced in code today? | Evidence basis | Reaches materialization? |
|---|---|---|---|
| `AGENT_VERSION--USES_MODEL-->MODEL` | Produced as `AGENT--USES_MODEL-->MODEL` (wrong source kind — AGENT_VERSION doesn't exist) via `relationship-correlation.ts` | Real, evidence-backed (shared assertion/evidence IDs, min-confidence) | NO |
| `AGENT_VERSION--USES_TOOL-->TOOL` | Same pattern, AGENT-sourced | Real, evidence-backed | NO |
| `AGENT_VERSION--USES_MCP-->MCP_SERVER` | NO (no MCP_SERVER candidate exists) | Contract-only | NOT_IMPLEMENTED |
| `AGENT_VERSION--INVOKES-->API` | NO | Contract-only | NOT_IMPLEMENTED |
| `AGENT_VERSION--USES_PROMPT-->PROMPT` | NO | Contract-only | NOT_IMPLEMENTED |
| `AGENT_VERSION--USES_KNOWLEDGE_BASE-->KNOWLEDGE_BASE` | NO | Contract-only | NOT_IMPLEMENTED |
| `AGENT_VERSION--USES_SKILL-->SKILL` | NO | Contract-only | NOT_IMPLEMENTED |
| `AGENT_VERSION--HANDOFF_TO-->AGENT` | NO (vocabulary constant only, no producer) | Contract-only | NOT_IMPLEMENTED |
| `AGENT_VERSION--READS_FROM-->DATA_ASSET\|DATA_ELEMENT` | NO | Contract-only | NOT_IMPLEMENTED |
| `AGENT_VERSION--WRITES_TO-->DATA_ASSET\|DATA_ELEMENT` | NO | Contract-only | NOT_IMPLEMENTED |
| `DATA_ELEMENT--DERIVED_FROM-->DATA_ELEMENT` | NO in production (fixture-only, in `03-monorepo` golden expectations) | Fixture-only | NOT_IMPLEMENTED |
| `MCP_SERVER--EXPOSES-->TOOL` | NO | Contract-only | NOT_IMPLEMENTED |

**Zero of the twelve governed relationship types reach `gov_repo.canonical_relationships` today.**
The persistence/materialization RPCs (`materialize_relationship_reconciliation`) are fully built
and correct — the blocker is entirely upstream: every relationship's source endpoint kind
(`AGENT_VERSION`, `DATA_ELEMENT`) has no production identity normalizer. The dashboard UI
already knows this and fails closed honestly: relationship candidates are offered
`REJECT`/`DEFER` only, with explicit in-UI copy explaining why, both client- and
server-enforced (`decision-query.ts`, `decision-commands.ts`).

---

## 12. L0–L16 conformance matrix

| Layer | Classification | What exists | What's missing | Authoritative files | Dependency blocker | Reuse possibility |
|---|---|---|---|---|---|---|
| **L0** Source & Acquisition | `CURRENT_MAIN_PARTIAL` | `gov_repo.acquisition_runs`, `LocalRepositoryAdapter`, discovery-input persistence | General-purpose remote source adapters; fully governed evidence-linked acquisition context | `discovery_intake_v1.sql`, `discovery_governance_input_persistence_v1.sql` | none | reuse as-is |
| **L1** Lexical & Documentation | `CURRENT_MAIN_PARTIAL` | 3 declaration-pattern detectors; notebook prompt extraction (unwired) | General-purpose doc/comment/manifest intelligence | `discovery/strategies/*`, `core/notebook-parser.ts` | detector breadth | reuse as-is |
| **L2** Deterministic Pattern | `CURRENT_MAIN_PARTIAL` | `core/risk-detector.ts`, model-id regex parser | Breadth re-baseline vs. architecture (roadmap milestone 1) | `core/risk-detector.ts`, `core/model-parser.ts` | none | reuse as-is |
| **L3** Structure/Schema/Data | `CURRENT_MAIN_FOUNDATIONAL` | DATA_ASSET/DATA_ELEMENT contracts, structural-kind enums | Any SQL/DDL/dbt/schema parser (zero exists); legacy heuristic is dead code (never persisted) | `canonical-contracts/src/contracts.ts` | detector build | must build (contracts reusable) |
| **L4** Agentic Architecture | `CURRENT_MAIN_PARTIAL` | MODEL/TOOL full continuity to materialization; AGENT detection+fails-closed normalization; USES_MODEL/USES_TOOL correlation (AGENT-sourced) | AGENT_VERSION entirely; Prompt/MCP/KB/Skill as distinct object kinds; AGENT normalization | `discovery/strategies/*`, `object-candidate-normalization.ts` | **AGENT_VERSION identity** | reuse detector pattern for new kinds |
| **L5** Authorized Profiling | `NOT_IMPLEMENTED` | — | Everything | — | L4 maturity | must build |
| **L6** Business & Info Semantics | `CURRENT_MAIN_FOUNDATIONAL` | Semantic identity kinds + full reconciliation lifecycle modeled in contracts | Discovery/persistence of Business Domain/Term/Information Domain instances | `contracts.ts:648-685,3463-4193` | L4/L9 maturity | reuse contracts as-is |
| **L7** Embeddings & Semantic Repr. | `CURRENT_MAIN_PARTIAL` **[CORRECTION vs coverage.md, which read NOT_IMPLEMENTED]** | pgvector extension enabled; `agent_embeddings` + `coding_memory` tables (model/version, content-hash, tenant-scoped); real similarity RPCs; `coding_memory` **actively populated and queried** for RAG | This is a **separate RAG feature for Talk-to-Governance**, not embeddings of canonical objects (Agent/Model/DataElement). `agent_embeddings` has **no writer anywhere in the repo** — dead read path. No canonical-object embedding contract exists in `canonical-contracts` | `..._part_3.sql`, `apps/dashboard/supabase-setup-8.2.sql`, `services/coding-memory.ts`, `services/talk.ts` | L4/L9 object maturity (nothing to embed yet) | **infra fully reusable** (pgvector, RPC pattern, tenant-scoping); needs a canonical-object embedding contract + writer |
| **L8** Similarity & Entity Resolution | `NOT_IMPLEMENTED` | Rule-based (deterministic) entity correlation exists (§L4), but no vector-similarity/clustering candidate model | Vector-based similarity, clustering | — | L7 (real, canonical-object-scoped) | depends on L7 correction above |
| **L9** Relationships & Lineage | `CURRENT_MAIN_PARTIAL` | Full closed taxonomy modeled + persisted/materializable at DB layer for all 12 types; USES_MODEL/USES_TOOL evidence-backed correlation | AGENT_VERSION-sourced correlation (currently AGENT-sourced); 10 of 12 types have zero producer; **zero relationships reach materialization today** | `contracts.ts:1623-1636,2296-2324`, `relationship-correlation.ts`, `canonical_materialization_v1.sql` | AGENT_VERSION + DATA_ELEMENT identity | reuse taxonomy/persistence as-is |
| **L10** Connectivity & Topology | `NOT_IMPLEMENTED` | Free-text `model_endpoint`/`resource_endpoint` metadata fields only | Endpoint/network/topology object kind, egress modeling | — | none (independent) | must build |
| **L11** Identity, Capability, AuthZ | `NOT_IMPLEMENTED` | App's own user RBAC (not L11); human-identity-provider sync (Keycloak/Entra) for populating owner records (not L11) | Execution-principal object kind for **discovered agents**; IAM/OAuth/service-account/capability-vs-authorization modeling | `apps/dashboard/lib/auth/*` (explicitly NOT L11), `packages/scanner/src/connectors/identity/*` (explicitly NOT L11) | none (independent) | must build |
| **L12** Runtime & Observability | `NOT_IMPLEMENTED` | Nothing (zero OTel dependency in any `package.json`); `apps/extension` has its own unrelated cost/routing telemetry for a separate product | OTel/trace/span/model-call/tool-call capture pipeline | — | none (independent) | must build |
| **L13** Cross-Signal Reconciliation | `CURRENT_MAIN_FOUNDATIONAL` | Full source-to-source reconciliation (ReviewSubject, Authorization, Reconciliation) — real, transactional, human-authority-enforced twice (TS + DB CHECK) | Design-time-vs-runtime correlation (structurally blocked — needs L12 to exist first) | `governance_persistence_v1.sql`, `packages/governance-review/*` | **L12** | reuse as-is; extend, don't rebuild |
| **L14** Governance & Controls | `CURRENT_MAIN_PARTIAL` | **Two disconnected real persistence surfaces**: (1) `gov_repo.agents` CG-AG trigger/flag/view system (manually-registered agent inventory), (2) discovery-connected `review_subjects`/`reconciliation_decisions` (no CG-AG codes) | Unification of the two surfaces; CG-AG traceability wired into the discovery-connected pipeline | `agent_registry_graph_part_1..4.sql`, `governance_persistence_v1.sql`, `TRACEABILITY_MATRIX.md` (static doc, confirmed not itself a persistence layer) | none (independent) | reuse both surfaces; unify, don't rebuild |
| **L15** Risk & Exposure Intelligence | `NOT_IMPLEMENTED` | `core/risk-detector.ts` is pure L2 deterministic pattern detection (hardcoded rule catalog); `risk_level`/`ai_act_risk_class` are manually-entered governance fields, not computed | Signal → hypothesis → governed risk → residual risk pipeline | `core/risk-detector.ts` (misclassified as L15 in casual reading — it is L2) | L9/L13/L14 evidence maturity | must build (L2 detector reusable as an input signal) |
| **L16** Drift & Change Intelligence | `NOT_IMPLEMENTED` | One code comment noting evidence is retained "for future drift analysis" — nothing else | Temporal-comparison engine, change-event object kind | `apps/dashboard/tests/discovery-intake-service.test.ts:541` (comment only) | **L12 + L13** | must build |

---

## 13. Agent Passport 360 conformance matrix

Dimensions: MODELED / DETECTED / EVIDENCED / PERSISTED / GOVERNED / PRESENTED / RUNTIME_OBSERVED.
A family is not marked implemented merely because a TypeScript type exists.

| # | Family | M | D | E | P | G | Pres. | RtObs | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Identity | Y | Y (AGENT/MODEL/TOOL) | Y | Y (MODEL/TOOL only) | Y (MODEL/TOOL only) | Governance Workspace only — **not the Graph route** (see Gap G-01) | N | AGENT identity fails closed; AGENT_VERSION absent |
| 2 | Discovery Metadata | Y | Y | Y | Y | Y | Workspace evidence panel | N | Real — `OBJECT_SOURCE_MAPPING_STATUS`, evidence/assertion persistence |
| 3 | Ownership & Responsibility | Y | N (governance data-entry, not discovered) | Partial | Y | Y (coarse single-role authority) | Workspace | N | Not tied end-to-end to AgentVersion evidence |
| 4 | Business Context | Y (semantic identity kinds) | N | N | N | N | N | N | Depends on L6 discovery, not implemented |
| 5 | Technology & Build | Y (scanner field types) | Partial | Partial | N (not a governed Passport field) | N | N | N | Modeled in scanner types only |
| 6 | AI Model & Inference | Y | Y | Y | Y | Y | Workspace only | N | **Most mature family** — full path to materialization |
| 7 | Agent Architecture & Behavior | Y (relationship taxonomy) | Partial (USES_MODEL/USES_TOOL, wrong source kind) | Y | N (never materializes) | N | N | N | Blocked by AGENT_VERSION gap |
| 8 | Tools / MCP / APIs | Y | TOOL: Y; MCP/API: N | TOOL: Y | TOOL: Y | TOOL: Y | Workspace only (TOOL) | N | MCP_SERVER/API have zero detection |
| 9 | Data Assets + Data Elements | Y (contracts) | N (dead legacy heuristic only) | N | N | N | N | N | Golden-fixture expectations only, not real detection |
| 10 | Privacy & Sensitive Data | Partial (L2 PII/secrets patterns) | Y (deterministic) | Partial | N | N | N | N | Not reconciled into a governed Passport field |
| 11 | Relationships & Lineage | Y | Partial (2 of 12 types) | Partial | Y (DB-ready) | N (0 materialize) | N | N | See §11 |
| 12 | Governance Controls | Y | N/A | Partial | Y (two disconnected surfaces) | Y | Workspace + `gov_repo.agents` views | N | See L14 |
| 13 | Operation & Runtime | N | N | N | N | N | N | N | Depends on L12, not implemented |
| 14 | Provenance & Trust | Y (5-state vocabulary) | Y | Y | Y | Partial | Workspace | N | Full lifecycle not uniformly wired through every family |
| 15 | Capabilities / Permissions / AuthZ | N | N | N | N | N | N | N | Depends on L11, not implemented |
| 16 | Connectivity & Network | N | N | N | N | N | N | N | Depends on L10, not implemented |

---

## 14. Canonical-contract status

`packages/canonical-contracts/src/contracts.ts` (4548 lines) matches the frozen architecture's
closed taxonomies **exactly**, with one naming/export-surface note: the endpoint-constraint
matrix is implemented as `RELATIONSHIP_ENDPOINT_CONSTRAINTS` (module-private, not exported from
`src/index.ts`), not `RELATIONSHIP_ENDPOINT_RULES` as informally referenced in planning
material — content is identical, enforced redundantly at runtime (`createGovernedRelationship`,
`copyGovernedRelationshipDraft`) and at compile time
(`GovernedRelationshipEndpointKinds` `as const satisfies`). `OBJECT_SOURCE_MAPPING_STATUS`
includes `PROPOSED` as the machine ceiling (matches invariant "SCANNER MACHINE AUTHORITY CEILING
= PROPOSED"), though the database layer further narrows `canonical_object_source_mappings.status`
to a `CHECK` of literally `'CONFIRMED'` — i.e. `PROPOSED` mappings are typed but never persisted
as durable rows today (they exist only transiently pre-reconciliation).

`src/index.ts` explicitly states this package contains "no persistence, Supabase, auth,
authorization, GraphOS, vector/embedding store, scanner runtime, or partner SDK integration" —
this is the correct, intentional MODELED-CONTRACT/RUNTIME-IMPLEMENTATION separation the frozen
architecture requires, and it is respected consistently by every consumer inspected in this
audit.

**Classification: `CURRENT_MAIN_FOUNDATIONAL`** — richest, most architecture-conformant layer in
the whole repository; the gap is entirely in what discovers/normalizes/materializes against it,
not in the contract itself.

---

## 15. Lineage status

| Dimension | Classification | Evidence |
|---|---|---|
| Agent lineage | NOT_IMPLEMENTED | No AGENT relationship reaches materialization |
| AgentVersion lineage | NOT_IMPLEMENTED | AGENT_VERSION doesn't exist |
| Model lineage | MODELED_ONLY→DISCOVERED (not PERSISTED) | USES_MODEL correlated with evidence, never materialized |
| Prompt/config lineage | NOT_IMPLEMENTED | No PROMPT object kind produced |
| Tool/MCP/API dependency | Tool: DISCOVERED (not persisted); MCP/API: NOT_IMPLEMENTED | `relationship-correlation.ts` |
| Knowledge/RAG lineage | NOT_IMPLEMENTED | No KNOWLEDGE_BASE object kind produced |
| Multi-agent/handoff lineage | NOT_IMPLEMENTED | `HANDOFF_TO` is a vocabulary constant with no producer |
| DataAsset lineage | NOT_IMPLEMENTED | No DATA_ASSET production detection |
| DataElement/column lineage | MODELED_ONLY | `DERIVED_FROM` exists only as a golden-fixture expectation |
| Transformation lineage | NOT_IMPLEMENTED | — |
| Execution lineage | NOT_IMPLEMENTED | Depends on L12 |
| Evidence lineage | PERSISTED | `gov_repo.discovery_evidence`/`source_assertions`, immutable |
| Governance-decision lineage | PERSISTED, CANONICAL | Full append-only audit trail (`review_audit_events`, `reconciliation_decisions`, `materialization_operations`) |
| Temporal lineage | MODELED_ONLY (contracts) | `GovernedRelationshipBase` half-open `[validFrom, validTo)` interval + supersession validation exist in contracts; nothing to apply it to yet (0 materialized relationships) |
| Control/policy lineage | MODELED_ONLY (two disconnected surfaces, see L14) | — |
| Risk propagation lineage | GRAPH_PROJECTED (derived cache, not a pipeline) | `gov_repo.agent_risk_propagation`, recomputed by `recompute_risk_propagation()` — real, but manually-seeded financial-impact data, not a computed risk pipeline (see L15) |

**No dimension reaches "full column/field-level lineage with governed materialization" today.**
The architecture's explicit warning — "Never claim full lineage when only coarse asset
relationships exist" — is directly relevant: even the most mature lineage dimension (Model/Tool
usage) stops at evidence-backed discovery, short of canonical materialization.

---

## 16. Data intelligence status

Golden Repository *expectations* describe a fully-formed DataAsset/DataElement capability
(table + column-level, with `DERIVED_FROM` lineage) — these are hand-authored fixtures, not
scanner output. **Real production detector code has zero SQL/DDL/dbt/schema parser.** The only
DATA_ASSET logic that exists (`core/analyzer.ts:411-438`) is a regex over ORM `.from('table')`
calls plus three hardcoded, apparently customer-specific keyword branches
(`voice_recordings`, `copsoq_responses`, `phq9_responses`) — and even this weak heuristic's
output is never mapped into `UnifiedScanResult` or persisted anywhere. DATA_ELEMENT has no
production implementation at all, not even a heuristic one.

**Classification: golden-fixture expectations = `CURRENT_MAIN_IMPLEMENTED` (as test oracle
content); real production detection = `NOT_IMPLEMENTED`.** This distinction must not be
collapsed in future planning.

---

## 17. Canonical / Graph / Vector / LLM state

- **Canonical Truth**: PostgreSQL/Supabase, as required. `gov_repo.canonical_objects` /
  `canonical_relationships` exist and are correctly the terminal write target of the
  reconciliation pipeline. **`CURRENT_MAIN_IMPLEMENTED`** for the persistence layer;
  **`CURRENT_MAIN_PARTIAL`** for what actually reaches it (MODEL/TOOL only, §10).
- **Graph/GraphOS**: the *authoritative* graph path (`apps/dashboard` `/graph` route →
  `getUnifiedGraph` → canonical Supabase tables) is a correct read-model with no
  GraphOS-owned tables of its own — architecturally conformant ("Graph = projection, not system
  of record"). **However it reads a separate, pre-canonical table set
  (`agents`/`agent_edges`/`ai_systems`/…) and never projects `gov_repo.canonical_objects` /
  `canonical_relationships` at all** — see Gap G-01. `packages/graphos` (standalone
  `GraphEngine` library) is dead in the production path, reachable only from the legacy
  `graphos-complete` prototype app, which itself owns its own `graphos_entities`/
  `graphos_relationships` tables (a genuine System-of-Record violation, but confined to a
  non-workspace, non-imported legacy app — `LEGACY_NOT_AUTHORITATIVE`, not a live violation).
- **Vector**: pgvector is enabled and two tables exist (`agent_embeddings`,
  `coding_memory`) — `coding_memory` is genuinely populated and queried for a Talk-to-Governance
  RAG feature; `agent_embeddings` has no writer anywhere and is dead. **Neither is an embedding
  of a canonical object** (Agent/Model/DataElement) as L7 requires — this is real, reusable
  infrastructure for a different (chat-assistant) purpose, not yet the architecturally-required
  L7 capability. **`CURRENT_MAIN_PARTIAL` infra, `NOT_IMPLEMENTED` for canonical-object L7.**
- **LLM**: OpenAI (`gpt-4o-mini` + `text-embedding-3-small`), DeepSeek, or Ollama via
  `LLM_PROVIDER` env var — no Anthropic/Claude SDK in product code. Used for product
  assistant/chat (Talk-to-Governance) and RAG context assembly. **Verified: no LLM output path
  writes to any canonical table.** Agent discovery/classification is rule-based, not
  LLM-based. **`CURRENT_MAIN_IMPLEMENTED`, and correctly non-authoritative** — "LLM OUTPUT !=
  CANONICAL TRUTH" is respected everywhere checked.

---

## 18. Governance / persistence state

Full Decision-to-Truth pipeline (Finding → Candidate → ReviewSubject → PROPOSED → CONFIRMED →
CERTIFIED → Authorization → Reconciliation → Materialization → Canonical Object/Relationship) is
**implemented as transactional, idempotent, optimistic-concurrency-protected Postgres RPCs**
with human-authority CHECK constraints enforced independently of the TypeScript domain layer.
Every stage after Candidate production is `CURRENT_MAIN_IMPLEMENTED` at the persistence layer.
The blocker is entirely at the Candidate-production stage (§10/§11): only MODEL/TOOL produce a
usable `NormalizedObjectCandidate`; RELATIONSHIP candidates are deliberately, honestly restricted
to REJECT/DEFER in the UI (with explicit user-facing explanatory copy, not a silent dead end).

---

## 19. Workspace, L10/L11/L12, L13/L14/L15/L16 state

See §12 for the per-layer verdicts (L10–L16) and §6 evidence panel for the Governance Workspace.
Additional workspace-specific notes: single coarse `org_admin`-only authority gate (not
per-transition RBAC); stale-write protection via `expectedState` optimistic concurrency (HTTP
409 on conflict) is real and independently re-verified at reconciliation/materialization submit
time.

---

## 20. True gap register

Root gaps only — downstream symptoms are traced to their root, per the audit's own stated
principle.

| Gap ID | CIA Layer | Passport Family | Current state | Required state | Why it matters | Dependency | Reuse potential | Milestone candidate |
|---|---|---|---|---|---|---|---|---|
| **G-01** | L9, L4 | 1, 6, 7, 11 | Authoritative Graph route reads only pre-canonical `gov_repo.agents`/`agent_edges`/… tables; never projects `gov_repo.canonical_objects`/`canonical_relationships` | Graph route must project the canonical/materialized system of record | Even the MODEL/TOOL objects that already reach full materialization are invisible everywhere except the Governance Workspace review-detail page — the "governed" system of record has no read-model at all today | none (independent of AGENT_VERSION work) | High — `getUnifiedGraph` pattern and ReactFlow component are reusable; only the data source needs extending | Not previously named in the roadmap; candidate for milestone 12 (Governed Graph + Vector Intelligence V1) to explicitly include, or a small standalone fix |
| **G-02** | L4 (root) | 1, 7 | `AgentCandidateNormalizationStrategy` unconditionally returns `NOT_SAFELY_NORMALIZABLE`; `AGENT_VERSION` has zero implementation | Evidence-backed AGENT identity + AGENT_VERSION temporal identity | **This is the single gap blocking all 12 governed relationship types** (every one requires an AGENT_VERSION or DATA_ELEMENT source endpoint) and Passport families 1 & 7 end-to-end | none (root gap) | Detector/normalization *pattern* from MODEL/TOOL is directly reusable | **Roadmap milestone 2 — recommended next milestone, see §22** |
| **G-03** | L3 | 9 | Zero production SQL/DDL/dbt/schema parser; legacy DataAsset heuristic is dead code | Structural discovery into DATA_ASSET/DATA_ELEMENT | Column-grain lineage (`DERIVED_FROM`) and Passport family 9 are entirely fixture-only today | Contracts already exist (§14) | Contracts + golden fixtures (`03-monorepo` expected.json) fully reusable as the target spec | Roadmap milestone 8 (Data Asset & Data Element Discovery V1) — correctly sequenced after AGENT_VERSION |
| **G-04** | Lab↔Engine wiring | 2 | No `DiscoveryCandidate → DetectedScenarioResult` adapter exists; Lab's match/metrics/report pipeline has never scored real scanner output | A working adapter + one recorded baseline snapshot | Cannot measure detector-expansion progress against a real precision/recall/F1 baseline without this | none | Both sides (Lab harness, production pipeline) are fully built and reusable — this is integration work only, not a rebuild | Roadmap milestone 1, **rescoped to a small recertification task** — see §22 |
| **G-05** | L7 | — | `agent_embeddings` table exists with no writer; no canonical-object embedding contract in `canonical-contracts` | Canonical-object-scoped embedding contract + writer, once objects exist to embed | Premature before G-02/G-03 produce canonicalized objects worth embedding | G-02, G-03 | pgvector infra, RPC pattern, and `coding_memory`'s writer pattern are directly reusable | Roadmap milestone 4 (Semantic Intelligence Foundation) |
| **G-06** | L14 | 3, 12 | Two disconnected real persistence surfaces (`gov_repo.agents` CG-AG triggers vs. discovery-connected `review_subjects`) | Single unified governance-controls model wired to L0–L16 evidence | Compliance control status (CG-AG-00x) is currently computed only from manually-registered agent data, never from discovery evidence | G-02 (so discovered agents have something to attach controls to) | Both surfaces + `TRACEABILITY_MATRIX.md` mapping fully reusable as unification input | Roadmap milestone 16 |
| **G-07** | L10, L11, L12 | 15, 16, 13 | Zero implementation of any kind (confirmed not conflated with app-auth or a different product's telemetry) | Full new layers | Independent of the AGENT_VERSION critical path; can be sequenced later | none blocking; but L13 cross-signal correlation and L16 drift both depend on L12 existing first | None — must build | Roadmap milestones 13/14 |
| **G-08** | L15 | — | `core/risk-detector.ts` is L2 pattern detection, not L15 risk intelligence; risk fields are manual data entry | Signal → hypothesis → governed risk → residual risk pipeline | Must not be mistaken for already-implemented risk intelligence in future planning | L9/L13/L14 evidence maturity | L2 detector reusable as one input signal | Roadmap milestone 17 |
| **G-09** | L16 | — | Nothing beyond one code comment | Drift/change detection engine | Structurally requires L12 (runtime) + L13 (cross-signal) first | G-07 | None yet | Roadmap milestone 15 |

---

## 21. Dependency graph (informal)

```
G-02 (AGENT_VERSION identity)  ─┬─► all 12 relationship types (§11)
                                 ├─► Passport families 1, 7 governance
                                 ├─► G-01 (graph projection becomes worth building broadly)
                                 └─► roadmap milestones 3, 6, 7, 9, 11 (all explicitly say so)

G-03 (Data Asset/Element discovery) ─► READS_FROM/WRITES_TO/DERIVED_FROM relationships
                                       ─► Passport family 9
                                       ─► roadmap milestone 9 (column lineage)

G-04 (Lab↔Engine adapter) ─► measurable baseline for any future detector-expansion work
                              (does NOT block G-02 — independent, small, parallelizable)

G-05 (canonical-object embeddings) ─► depends on G-02 + G-03 producing objects worth embedding
                                       ─► L8 similarity/entity-resolution

G-06 (governance-controls unification) ─► depends on G-02 (discovered agents need to exist
                                            before their controls can be evidence-linked)

G-07 (L10/L11/L12) ─► independent; G-07's L12 piece is a prerequisite for G-09 (L16) and the
                       runtime half of L13
G-08 (L15 risk) ─► depends on L9/L13/L14 evidence maturity generally, not on any single gap above
```

---

## 22. Roadmap reconciliation

| # | Milestone | Classification | Basis |
|---|---|---|---|
| 1 | Golden Repositories & Discovery Baseline V2 | **NEEDS_RESCOPING** | Goldens + Lab already exist and are fully tested (§5, §6). The only remaining work is a small, well-scoped adapter (`DiscoveryCandidate → DetectedScenarioResult`) plus one baseline-snapshot run against the 3 categories production already implements (AGENT/MODEL/TOOL). **This is a recertification task, not a rebuild.** |
| 2 | Agent Identity & Version Discovery V1 | **STILL_REQUIRED — root gap, recommended next milestone (§23)** | AGENT normalization fails closed unconditionally; AGENT_VERSION has zero implementation (§8, §9, Gap G-02) |
| 3 | Agent Technical Profile — L4 Round 1 | BLOCKED_BY_PREDECESSOR | Depends on milestone 2 |
| 4 | Semantic Intelligence Foundation — L6/L7 | **PARTIALLY_SATISFIED** for infra, BLOCKED_BY_PREDECESSOR for canonical-object scope | pgvector/embedding infra already exists and works (§17); needs a canonical-object embedding contract once G-02/G-03 exist |
| 5 | Similarity & Entity Resolution — L8 | BLOCKED_BY_PREDECESSOR | Depends on milestone 4 |
| 6 | AgentVersion Behavior Relationships — L9 | BLOCKED_BY_PREDECESSOR | Depends on milestone 2; correlation *pattern* (`relationship-correlation.ts`) already reusable |
| 7 | Relationship Decision-to-Truth Completion V1 | **PARTIALLY_SATISFIED** | Persistence/materialization RPCs already complete for all 12 types (§18); blocked purely by upstream endpoint-kind normalizers (milestone 2) |
| 8 | Data Asset & Data Element Discovery V1 | STILL_REQUIRED | Contracts exist (§14); zero production detection (§16, Gap G-03) |
| 9 | Data Access & Column Lineage V1 | BLOCKED_BY_PREDECESSOR | Depends on milestone 8 |
| 10 | Multivendor Exchange MVP V1 | STILL_REQUIRED | `InboundAdapterEnvelope` contract exists (§14); no real adapter integration found |
| 11 | Agent Passport 360 Governed View V1 | BLOCKED_BY_PREDECESSOR | Depends on milestones 2, 3, 8 for family completeness (§13) |
| 12 | Governed Graph + Vector Intelligence V1 | **NEEDS_RESCOPING** | Should explicitly include Gap G-01 (project `canonical_objects`/`canonical_relationships`, not just `agents`/`agent_edges`) as part of scope, not a net-new graph build |
| 13 | Connectivity & Execution Identity/AuthZ V1 | STILL_REQUIRED | L10/L11 confirmed `NOT_IMPLEMENTED` (§12) |
| 14 | Runtime & Observability V1 | STILL_REQUIRED | L12 confirmed `NOT_IMPLEMENTED` (§12) |
| 15 | Cross-Signal Reconciliation & Drift V1 | BLOCKED_BY_PREDECESSOR | Depends on milestone 14 (L13's runtime half + L16 both need L12) |
| 16 | Ownership/Business/Policy/Control Enrichment V1 | **NEEDS_RESCOPING** | Should explicitly unify the two already-real L14 persistence surfaces (Gap G-06) rather than building a third |
| 17 | Risk Intelligence V1 | STILL_REQUIRED | L15 confirmed `NOT_IMPLEMENTED`, existing risk-detector is L2 not L15 (§12) |
| 18–22 | Business Workspace / Enterprise Connectors / Outbox / Security Gate / Deployment | STILL_REQUIRED (not audited in depth — out of current dependency-critical path) | — |

### Milestones already satisfied (fully, contrary to what a stale roadmap read might suggest)

None of the numbered future milestones are **fully** satisfied end-to-end — but the audit
confirms the roadmap's own framing was already correct at freeze time: "the canonical/governance/
reconciliation foundation... is strong." What this audit adds is the precise boundary of that
strength (MODEL/TOOL only, zero relationships) and identifies two milestones (1 and 12) whose
scope should shrink because most of the work already exists.

---

## 23. Next development milestone recommendation

**Recommended: Roadmap milestone 2 — AGENT IDENTITY & VERSION DISCOVERY V1.**

Evidence basis: the Discovery Validation Lab and Golden Repositories (roadmap milestone 1) do
**not** need rebuilding — they are fully implemented, fully tested (51/51, 92/92, run live during
this audit), and the only remaining milestone-1 work is a small, independent adapter +
one-time baseline snapshot (Gap G-04) that does not block anything else and can be done as a
lightweight parallel task rather than a standalone multi-week milestone.

The true root gap — confirmed independently across three separate audit passes (canonical
contracts, discovery engine, governance persistence) — is Gap G-02: `AGENT` candidate
normalization fails closed unconditionally by explicit design
(`object-candidate-normalization.ts:104-114`), and `AGENT_VERSION` has zero implementation
anywhere in `packages/scanner/src`. This single gap is the reason:

- Zero of the twelve governed relationship types can reach materialization today, even though
  the persistence/materialization RPCs for all twelve are already fully built and correct (§11,
  §18).
- Passport families 1 (Identity) and 7 (Agent Architecture & Behavior) cannot be governed
  end-to-end even though AGENT is already detected and enters CERTIFIED review (§13).
- Roadmap milestones 3, 6, 7, 9, and 11 are all explicitly blocked on this gap by the roadmap's
  own stated dependency ordering, which this audit independently confirms is correct.

This is the smallest root capability that unlocks the largest amount of already-built,
currently-idle downstream architecture (relationship correlation, persistence, materialization,
governance workspace) without duplicating any existing work. The detector/normalization
*pattern* already proven for MODEL and TOOL (`object-candidate-normalization.ts:125-188`) is
directly reusable as the implementation template for AGENT_VERSION.

---

## 24. Files changed by this audit

- `docs/architecture/GOVIA-L0L16-CIA-v1.0-implementation-conformance.md` (new)
- `docs/architecture/GOVIA-L0L16-CIA-v1.0-reuse-register.md` (new)
- `docs/codex/evidence/2026-09-08-govia-cia-implementation-conformance-audit-v1.md` (new)

No other files were created, modified, or deleted. `GOVIA-L0L16-CIA-v1.0.md` and
`ADR-GOVIA-L0L16-CIA-v1.0.md` are unchanged.
