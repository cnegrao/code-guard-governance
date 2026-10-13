# M17-S1 — Signals + Hypotheses + Support / Evidence Model and Adapters

Starting point: `origin/main` = `59bb7e323af90da74133d51054674f405c81c786` (merge of PR #65, M17-S0), verified equal to the
expected SHA before branching, clean worktree. Repository `cnegrao/code-guard-governance`. Branch
`feat/m17-s1-signals-hypotheses-support` created from exactly that commit.

Architecture authority (not modified): [M17 ADR](../../architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md) (ACCEPTED / FROZEN)
§§4, 5, 8.3, 9, 12, 17, 23, 24, 26; [M16 Authority Policy M17 extension](../../architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md)
(D-01, unchanged by S1); [S0 evidence](./2026-10-12-m17-s0-authority-security-root-contracts.md);
[baseline](../../architecture/GOVIA-L0L16-CIA-v1.0.md) unchanged.

## Recorded state

| Item | State |
|---|---|
| PR #65 (M17-S0) | **MERGED** (`59bb7e3`) |
| `main` baseline at slice start | `59bb7e323af90da74133d51054674f405c81c786` |
| M16 | CLOSED (five fact families, unchanged) |
| M17 architecture | ACCEPTED / FROZEN (unchanged) |
| M17-S1 | IMPLEMENTED ON BRANCH `feat/m17-s1-signals-hypotheses-support`; **NOT MERGED**; PR NOT OPENED |
| M17-S2 … S7 | **NOT STARTED** |
| Hosted (Supabase / Vercel / deployment) | **NOT TOUCHED** |

## Environments

- **LOCAL**: disposable PostgreSQL **17.10** clusters (server binaries from `@embedded-postgres/linux-x64@17.10.0-beta.17`,
  `psql` = local 16 client), run as an unprivileged OS user, harness asserts `server_version_num` 17.x; pgvector stand-in
  (only the HNSW statement fails, asserted). Node **24.11.0**. M15 regression on local PostgreSQL 16 (CI runner default).
- **CI**: `M16 PostgreSQL 17 security suite` (PGDG PG17 + real pgvector; runs every `tests/postgres-m16/*.test.ts`, so both new
  S1 suites) and `M15 PostgreSQL regression`, on the pushed branch. **CI on the exact final HEAD is the arbiter.**
- **HOSTED**: NOT TOUCHED. No hosted migration, no direct hosted DB access, no Vercel change, no deployment.

## Pre-flight (verified)

- Canonical repo, `main` = `59bb7e3`, PR #65 merged, worktree clean; M17 ADR ACCEPTED / FROZEN; S0 migration present; the S0
  PG17 suite and the full M16 suite were green at the S0 horizon.
- The actual post-S0 PostgreSQL 17 catalog was materialized and every target key was read from `pg_constraint`, not ADR prose:
  `discovery_evidence (organisation_id, evidence_id)`, `source_assertions (organisation_id, assertion_id)`,
  `runtime_observations (organisation_id, observation_id)`, `cross_signal_comparison_results (organisation_id, comparison_id)`,
  `execution_field_states (organisation_id, state_id)`, `technical_field_states (organisation_id, state_id)`,
  `lineage_candidate_observations UNIQUE (organisation_id, observation_finding_id)`,
  `l14_fact_states UNIQUE (organisation_id, fact_state_id, subject_kind)`, `canonical_objects UNIQUE (organisation_id,
  canonical_object_id, kind)`, `governance_users UNIQUE (organisation_id, user_id)`. Relationship states: `canonical_relationships`
  has no usable uniqueness on the triple and F2 forbids adding one, so the **existing** M16 exact-triple resolver
  `l14_resolve_relationship_state_target_v1` is reused (exactly one row, else fail closed). M16 bounded current reads reused for
  the governance-gap adapter: `l14_responsibility_assignments_current_v1`, `l14_business_context_assignments_current_v1`,
  `l14_control_applicabilities_current_v1`, `l14_control_assessments_current_v1`. Verified-member gate reused:
  `lock_and_resolve_governance_session_eligibility_v1` (M16-S0).
- **Machine-intake reuse decision.** The governed-discovery machine control plane (`machine_principals` / credential generations /
  bindings, `govia_discovery_machine_caller`) could not be reused: its `machine_role_safe_v1` certifies an OID-pinned closed list of
  callable definers, so granting the discovery caller any L15 RPC would fail every discovery LOGIN — reopening the frozen
  discovery boundary. S1 therefore adds one NOLOGIN **capability** role (no identity registry, no authority mechanism), following
  the same NOLOGIN-capability + DBA-granted-LOGIN pattern. No second governance authority mechanism is created.
- No requirement needed S2+ → no STOP; the S2-dependent parts are recorded below as dependency-deferred.

## Migration

Exactly one additive migration: **`supabase/migrations/20261012210000_m17_s1_signals_hypotheses_support_v1.sql`**. No historical
migration edited. Preflight: PG17 / postgres / READ COMMITTED, the exact post-S0 L15 routine set, no `l15_*` relation, no
capability role, definer surface exactly 45, the upstream target keys / M15 outcome / M16 assessment-outcome vocabularies exactly
as inspected. Snapshots every pre-existing `gov_repo` constraint and non-internal trigger; the postflight proves none changed.

### RISK_SIGNAL store — `gov_repo.l15_risk_signals` (non-authoritative)

| Rule | Enforcement |
|---|---|
| Random opaque tenant-scoped id; DB-authored `recorded_at` | `BEFORE INSERT` guard sets `signal_id := gen_random_uuid()`, `recorded_at := now()`; no column default anywhere |
| 10 closed kinds, 5 closed source classes, one source per kind (§4.3) | CHECKs + `kind_source_check`; RPC pre-checks (`SIGNAL_KIND_UNKNOWN`, `SOURCE_CLASS_UNKNOWN`, `SIGNAL_SOURCE_MISMATCH`) |
| Subject = exact object (org + id + kind, composite FK onto `canonical_objects`) / exact relationship-state triple (existing resolver) / UNRESOLVED + closed reason | `subject_shape_check`, FK, guard trigger, `l15_require_subject_v1`. Never a bare state id; no inheritance (exact match only) |
| Trust: SYSTEM_DETECTOR INFERRED/DECLARED, SOURCE_CONNECTION IMPORTED, RUNTIME_SOURCE OBSERVED; GOVERNED_FACT_REFERENCE / LOCAL_HUMAN **NULL**; never VALIDATED | `trust_source_check` (VALIDATED not in the column CHECK) + `TRUST_VALIDATED_FORBIDDEN` |
| method_id + method_version mandatory for every non-human signal | `method_check` + `METHOD_VERSION_REQUIRED` |
| ≥ 1 rank-0 support for non-human; LOCAL_HUMAN may have zero with explicit `support_status = NONE` | `support_check`; deferred commit-time `l15_support_completeness_guard_v1` (status must equal the actual link set) |
| `hint_*` only (`hint_severity` closed source labels critical/high/medium/low/info, `hint_confidence` 0..1), only for SYSTEM_DETECTOR / SOURCE_CONNECTION | `hint_check`, `HINT_NOT_ADMISSIBLE`; no L15 code reads them for authority / rating / lifecycle |
| `observed_at` only when evidenced, never after `recorded_at`, never defaulted | `observed_at_check` + `OBSERVED_AT_UNEVIDENCED` |
| GOVERNANCE_GAP_REF read coordinates | `gap_*` columns, `gap_shape_check` (closed families × role / semantic matrices), coordinates = `recorded_at` |
| No lifecycle / state / head / status; no copied upstream value | catalog: no status/outcome/metric/cost/domain/rating/text column (test) |
| Provenance: `submitted_by_user_id` (composite FK onto the member) or `admitted_by_technical_identity` (`session_user`) | `provenance_check` |

**UNRESOLVED reason vocabulary.** The ADR names a closed `unresolved_reason` without enumerating it; S1 reuses verbatim the
existing L12 runtime-binding closed vocabulary (`MISSING_REVISION_EVIDENCE`, `NO_EXACT_MAPPING`, `AMBIGUOUS_MAPPING`,
`UNSUPPORTED_BINDING_PROOF`). No value invented (finding F-S1-1).

### RISK_HYPOTHESIS store — `gov_repo.l15_risk_hypotheses` (non-authoritative)

Random opaque id, DB `recorded_at`; exact subject (object or relationship-state triple; **UNRESOLVED illegal**); closed
`generator_kind`; `provenance_check`: method + version for every machine generator, the full LLM tuple (`model_provider`,
`model_id`, `prompt_template_version`) iff LLM_ASSISTED, `traversal_policy_version` iff GRAPH_ANALYSIS,
`representation_version` iff VECTOR_RETRIEVAL, none for HUMAN; `trust_state` INFERRED for machine / NULL for HUMAN (VALIDATED
impossible); optional `hint_confidence`; ≥ 1 exact same-tenant cited signal (RPC + deferred guard). No status column; nothing
ranks, merges or promotes hypotheses (confidence / count / recency / generator / agreement are never read).

**Scenario reference (S2 boundary).** No RISK_SCENARIO_DEFINITION registry exists and none is created. The optional §5.1
`proposed_scenario_definition_id` is **deferred**: no column, no fake table / label registry / free-text reference; a hypothesis is
valid without it ("unclassified"). S2 adds it additively as a nullable column with the exact validated-version FK (and a v2
fingerprint frame).

### Support / evidence model — `gov_repo.l15_support_links` (D-03)

- L15-specific; `gov_repo.l14_support_links` neither reused nor widened (proven: no reference / constraint / column change).
- Closed tagged union of the 10 frozen tags; exactly one typed target column non-null and matching its tag
  (`target_shape_check`, `num_nonnulls = 1`); **12 composite same-tenant FKs** (10 targets + 2 owners) on `organisation_id`; L14
  targets carry the fact's subject kind via the `(organisation_id, fact_state_id, subject_kind)` key; columns are only
  `uuid` / `text` id / `timestamptz` (no JSON / JSONB / arrays / free-text reference / mutable label).
- §9.2 acyclic matrix (`owner_target_matrix_check`): RISK_SIGNAL → the 8 rank-0 tags; RISK_HYPOTHESIS → RISK_SIGNAL only.
  Same-rank, upward and skip links are illegal → no self link, no cycle, no recursive checker.
- Kind → target hardening (`signal_kind_target_check`): each `*_REF` kind cites exactly its upstream record class;
  CONTROL_ASSESSMENT_REF only an L14 fact of subject kind CONTROL_ASSESSMENT; detectors cite source evidence
  (discovery evidence / source assertion / technical field state); gap / human signals any rank-0.
- Outcome admissibility (guard trigger): M15 result outcome ∈ {CONFLICT_CANDIDATE, INSUFFICIENT_EVIDENCE, DRIFT_CANDIDATE —
  admissible per §4.3 but not storable by the current M15 CHECK}; CONTROL_ASSESSMENT state VALIDATED with outcome ∈ {NOT_SATISFIED,
  PARTIALLY_SATISFIED, NOT_ASSESSED, INSUFFICIENT_EVIDENCE}.
- Links are written only in the owner's transaction (`SUPPORT_OWNER_NOT_IN_TRANSACTION`); no later evidence top-up.
- Missing support stays explicit (`NONE`); legacy `gov_repo.evidence` and LLM text are not targets (no FK / tag exists).
- **Rank-3 owners (S2–S6)**: not created. The contract extends additively (new owner columns + widened `owner_kind` /
  matrix CHECK + their own composite FKs) without touching the S1 rows or rules. **O79 for rank-3 owners is
  dependency-deferred** to the slices that create those stores.

### Intake / replay

| RPC | Caller | Notes |
|---|---|---|
| `l15_admit_machine_signal_v1` | `govia_l15_machine_intake_caller` (NOLOGIN capability, granted to a technical LOGIN out of band) | technical identity re-derived in-RPC (`l15_require_machine_intake_identity_v1`: LOGIN, not super / bypassrls / createrole, member of the capability, **not** postgres / service_role / anon / authenticated nor a member of them); organisation must be active (FOR SHARE); LOCAL_HUMAN refused |
| `l15_admit_machine_hypothesis_v1` | same | HUMAN generator refused |
| `l15_admit_human_signal_v1` | `service_role` + verified principal | M16-S0 eligibility (ACTIVE member of the ACTIVE organisation, credential epoch); kind HUMAN_OBSERVATION / LOCAL_HUMAN fixed; no trust, no method |
| `l15_admit_human_hypothesis_v1` | `service_role` + verified principal | generator HUMAN fixed |

Replay identity `organisation_id + intake_key`; PostgreSQL computes the semantic fingerprint (length-prefixed frame, SHA-256;
support set sorted so order is irrelevant; timezone-independent epoch framing for `observed_at`; actor / technical identity
included). Lock order: organisation FOR SHARE → `pg_advisory_xact_lock(intake key)` → replay lookup. Exact retry returns the
original id, `recorded_at` and fingerprint (`replayed = true`); changed content → `L15_REPLAY_CONFLICT` (GV008). Admission
creates **no** L14 authorization decision, proposal, governance decision, command result, fact / registry state or head and never
requires or synthesizes an L15 permission.

### Read projections

- `l15_read_signals_v1` (service_role + verified member, exact subject, no inheritance): rows with
  `observation_presentation` = `'not detected'` (DETECTED_ABSENCE), `'detected'`, `'unknown'` (governance gap), `'referenced'`,
  and `authority = 'NON_AUTHORITATIVE'`.
- `l15_read_hypothesis_dispositions_v1`: disposition read projection, no status column. A hypothesis that no governed artifact
  cites is `UNREVIEWED`; at S1 no owner kind may cite a hypothesis (rank-3 owners arrive in S3–S6), so `CITED_BY_*` have no
  instances; should a citing link of an unclassified owner kind ever exist, the projection fails closed
  (`L15_PROJECTION_UNAVAILABLE`) instead of inventing a disposition. Contradictory hypotheses are listed side by side.

## Adapters

| Adapter | Location | Behaviour |
|---|---|---|
| Scanner `DetectedRisk` | `packages/scanner/src/l15/detected-risk-signal-adapter.ts` | closed table of **all 30** current rule ids → DETECTED_PATTERN (9) / DETECTED_ABSENCE (21); `method_id = SCANNER_DETECTED_RISK:<rule>` + mandatory detector version; exact source evidence required; `severity` → `hint_severity` only; DetectedRisk has no confidence → `hint_confidence` null; `category`, `cgagControl`, title / description / recommendation dropped (no domain, no control, no proposal, no rating, no lifecycle) |
| FinOps | `packages/scanner/src/l15/finops-signal-adapter.ts` | the five boolean flags only (N+1, full scan → PATTERN; missing timeout / rate limit / circuit breaker → ABSENCE); `monthlyCostEstimate`, breakdown amounts / confidence, `costRisk`, hotspots never read; no L15 amount column exists |
| M15 | `crossSignalResultSignal` (`canonical-contracts`) | exact `CROSS_SIGNAL_RESULT` reference; CONSISTENT rejected (TS + DB) |
| L12 runtime | `runtimeObservationSignal` | exact `RUNTIME_OBSERVATION` reference, OBSERVED; no latency / error / token / cost / target copied |
| L11 execution | `executionContextSignal` | exact `EXECUTION_FIELD_STATE` reference (actual L11 store); no copied truth, no inferred authorization |
| M16 control assessment | `controlAssessmentSignal` | exact L14 CONTROL_ASSESSMENT state with admissible outcome; SATISFIED / REVOKED rejected; legacy control fields never read |
| M16 governance gap | `governanceGapSignal` | closed gap queries (RESPONSIBILITY_ASSIGNMENT role, BUSINESS_CONTEXT_ASSIGNMENT semantic kind, CONTROL_ASSESSMENT of a control that currently APPLIES); the DB performs the deterministic read at DB-authored coordinates (effective = recorded cutoff = `recorded_at`) through the existing M16 reads and refuses `GOVERNANCE_GAP_NOT_UNKNOWN` / `GOVERNANCE_GAP_NOT_REQUIRED`; presentation `unknown`; no M16 negative fact, no M16 write |
| Lineage | `lineageSignal` | exact `lineage_candidate_observations` finding reference; no parallel lineage store |

## DETECTED_ABSENCE

Presentation is literally `not detected` (DB read projection and `l15SignalObservationPresentation` /
`presentDetectedRiskRule`); never absent / failed / NOT_SATISFIED / false / non-compliant (tested). No L15 path writes M16 control
assessment, control applicability or anything Passport reads; M16 history digests are unchanged across every admission (tested).

## Coding Memory hardening (F-S0-4 — RESOLVED)

`apps/dashboard/services/coding-memory.ts`: `riskLevel` / `suggestedRiskLevel` and the `risk: …` / `Risk: …` text are removed
from new chunk summaries and metadata; legacy chunks indexed before S1 are sanitized on both read paths (`semanticSearch` →
Talk to Governance LLM context, and the repository memory API via the new `getRepositoryMemory` service wrapper). Regression
tests: `apps/dashboard/tests/m17-s1-coding-memory.test.ts` (3). The detector severity's only M17 path is scanner → RISK_SIGNAL →
`hint_severity`.

## Security / ACL / definer surface

| Surface | Before S1 | After S1 |
|---|---|---|
| Application SECURITY DEFINER surface (EXECUTE by service_role / anon / authenticated / PUBLIC) | 45 | **49** (+4 member RPCs, service_role only) |
| Technical intake surface (`govia_l15_machine_intake_caller`) | — | **2** (machine signal / hypothesis RPCs; nothing else, no table) |
| L15 SECURITY DEFINER routines (inventory) | 0 | **7** (4 member RPCs, 2 machine RPCs, 1 owner-only deferred completeness trigger fn) |
| L15 routines (all, owner postgres, `search_path = pg_catalog, pg_temp`, no PUBLIC EXECUTE) | 4 (S0) | 24 |
| L15 tables | 0 | 3 |
| service_role direct L15 table privileges | 0 | **0** |

Every new definer: documented necessity (header of F / G and the completeness trigger), owner `postgres`, `search_path =
pg_catalog, pg_temp` (+ `lock_timeout 5s` on RPCs), fully qualified references, EXECUTE only to the intended writer, tenant /
principal re-derived in-RPC, registered in the S1 inventory (`tests/postgres-m16/m17-s1-security.test.ts`,
`L15_S1_DEFINER_INVENTORY`: owner + body SHA-256 + config) and in the migration postflight. REVOKE ALL from PUBLIC / anon /
authenticated / service_role on every L15 table and routine (the broad `20260818013113` table defaults are revoked). RLS enabled
on all L15 tables (no policies). No M16 store privilege widened. Why the completeness trigger is a definer: a deferred trigger
fires at COMMIT as the committing role, which by design has no L15 table privilege; it is not callable by any application role.

## Immutability / replay

All three L15 tables: ENABLE ALWAYS raising `BEFORE UPDATE OR DELETE` row trigger and `BEFORE TRUNCATE` statement trigger
(`L15_HISTORY_IMMUTABLE`) — refused for the owner, for a superuser in `session_replication_role = replica`, and (permission
denied) for every application role; FK actions are NO ACTION / RESTRICT only (no cascade can erase history).

## Tests

| Suite | Result (local) |
|---|---|
| Focused **M17-S1 PG17** `tests/postgres-m16/m17-s1-signals-hypotheses.test.ts` | **16 / 16 PASS** |
| **M17-S1 PG17 security / ACL** `tests/postgres-m16/m17-s1-security.test.ts` (now applies S1 + S1R1) | **5 / 5 PASS** |
| **M17-S1R1 PG17 actual machine LOGIN** `tests/postgres-m16/m17-s1r1-machine-login.test.ts` | **6 / 6 PASS** |
| Full **M16 PG17** suite `tests/postgres-m16/*.test.ts` (incl. M17-S0, the S1 suites and S1R1) | **1226 / 1226 PASS** (1199 pre-existing + 21 S1 + 6 S1R1) |
| **M15** PostgreSQL regression `tests/postgres/*.test.ts` | **8 / 8 PASS** |
| `@council/canonical-contracts` (`npm test`, incl. new `l15-signals-hypotheses.test.mjs`, 6) + `tsc --noEmit` | **249 / 249 PASS**; typecheck clean |
| `@council/governance-review` (`npm test`) + `tsc --noEmit` | **412 / 412 PASS**; typecheck clean |
| `@council/scanner` new `npm run test:l15-adapters` + `tsc --noEmit` | **7 / 7 PASS**; typecheck clean |
| Dashboard `npm test` (main + passport-ui + pre-demo-ui + m17-s0-legacy) incl. new `m17-s1-coding-memory` (3) and `m17-s1-static-acceptance` (4) | **1246 PASS / 0 FAIL / 5 skipped (pre-existing)** (after S1R1; incl. the S1R1 static boundary test) + 17 / 17 + 8 / 8 + 12 / 12 |
| Dashboard `tsc --noEmit -p apps/dashboard/tsconfig.json` | clean |

Harness changes are additive: `m17S1SignalsHypothesesMigration` constant and the `M17S1` horizon (= `M17S0` + the S1 migration);
`tests/helpers/m17-s1-fixtures.ts`. One existing assertion was advanced, not weakened:
`tests/m17-s0-authority-contract.test.ts` pinned "S0 is the newest canonical migration"; it now pins the exact post-S0 list
`[S0, S1]` (the same horizon discipline every M16 slice applies). No other existing test line was edited.

### Adversarial matrix (all PASS, `m17-s1-signals-hypotheses.test.ts`)

| # | Attack | Result |
|---|---|---|
| 1 | cross-tenant canonical subject | `SUBJECT_OBJECT_UNRESOLVED` |
| 2 | cross-tenant / mismatched / bare relationship-state subject; wrong declared kind; unknown reason | `SUBJECT_RELATIONSHIP_STATE_UNRESOLVED` / `SUBJECT_SHAPE_INVALID` / `SUBJECT_OBJECT_UNRESOLVED` |
| 3 | cross-tenant evidence, one case per implemented rank-0 tag (8), machine and human paths; RISK_SIGNAL via hypothesis | `SUPPORT_TARGET_UNRESOLVED`; direct insert → composite FK `23503` |
| 4 | wrong tag with a correct-looking id; unknown tag; free text as id | `SUPPORT_TARGET_UNRESOLVED` / `SUPPORT_TAG_UNKNOWN` |
| 5 | unsupported owner → target (kind → tag; signal → signal) | `signal_kind_target_check` / `owner_target_matrix_check` |
| 6 | self link (signal → itself, hypothesis → itself) | `owner_target_matrix_check` |
| 7 | cycle attempt (signal → hypothesis, hypothesis → rank-0, hypothesis → hypothesis) | `owner_target_matrix_check` (exhaustive 2 × 10 matrix: 9 accepted / 11 refused) |
| 8 | forged trust VALIDATED (RPC + direct insert); trust on a GOVERNED_FACT_REFERENCE; hint on a reference | `TRUST_VALIDATED_FORBIDDEN` / CHECK / `TRUST_SOURCE_MISMATCH` / `HINT_NOT_ADMISSIBLE` |
| 9 | missing method / version (signal, hypothesis) | `METHOD_VERSION_REQUIRED` |
| 10 | missing machine evidence (empty, NULL, mismatched arrays); direct insert without link | `MACHINE_SIGNAL_REQUIRES_EVIDENCE` / `SUPPORT_SHAPE_INVALID` / deferred `SIGNAL_SUPPORT_INCOMPLETE` |
| 11 | changed replay payload (6 variants), other actor same key | `L15_REPLAY_CONFLICT` |
| 12 | duplicate intake race (identical / conflicting) with a real lock wait observed in `pg_stat_activity` | one row; replay / `L15_REPLAY_CONFLICT` |
| 13 | technical intake attempting governance decision / reads / tables | EXECUTE denied (`42501`); reachable set = exactly the 2 intake RPCs |
| 14 | service_role / authenticated / anon direct table access; service_role calling the machine path; LOGIN that also inherits service_role | `permission denied` / `L15_INTAKE_IDENTITY_INELIGIBLE` |
| 15 | legacy risk values (agents.risk_level = critical) | zero L15 rows; no L15 routine / FK reads a legacy surface |
| 16 | scanner severity → domain | adapter emits no domain / category; no domain column in L15 |
| 17 | M15 CONSISTENT as signal | `CROSS_SIGNAL_RESULT_NOT_ADMISSIBLE` (TS + DB) |
| 18 | LLM hypothesis without each element of the tuple; stray tuple on a non-LLM generator | `LLM_PROVENANCE_REQUIRED` / `provenance_check` |
| 19 | fabricated / defaulted observed_at (future; without evidence); defaulted recorded_at | `OBSERVED_AT_UNEVIDENCED`; zero column defaults; supplied recorded_at overwritten by DB |
| 20 | DELETE / TRUNCATE / UPDATE by owner, superuser-replica and application roles | `L15_HISTORY_IMMUTABLE` / `permission denied`; row digests unchanged |
| + | SATISFIED / REVOKED / non-assessment L14 fact as CONTROL_ASSESSMENT_REF; gap that is not UNKNOWN / not required; inactive organisation; suspended / cross-tenant member; unknown kind / source / generator | all refused, nothing written |

## Acceptance criteria

| Criterion | S1 status | Proof / dependency |
|---|---|---|
| O08 | **PASS** | machine signal without method / version or with zero evidence rejected (RPC + table + deferred guard) |
| O09 | **PASS** | VALIDATED rejected for signals and hypotheses; GOVERNED_FACT_REFERENCE / LOCAL_HUMAN store no trust |
| O10 | **PASS** | CONSISTENT rejected; CONFLICT_CANDIDATE and INSUFFICIENT_EVIDENCE accepted |
| O11 | **PASS (S1 portion)** | cross-tenant subject (object + relationship state), evidence (each implemented tag), signal, M15 and M16 rows rejected. Hypothesis → L15 governed artifact targets do not exist until S3 |
| O12 | **PASS** | zero-signal hypothesis rejected; LLM tuple required element by element |
| O13 | **PASS** | repeated admissions incl. `hint_confidence = 1.0` / `hint_severity = critical`: governance envelope, fact / registry states and every `*_heads` table unchanged; M16 history digest unchanged |
| O14 | **PASS (S1 surface)** | the technical intake identity can EXECUTE exactly the 2 intake RPCs; every L14 / L15 propose / decide / read is denied. No L15 propose / decide RPC exists yet (S2+); re-prove when they land |
| O15 | **PASS** | UPDATE / DELETE / TRUNCATE refused for the owner; replay returns original id + `recorded_at`; changed content → `REPLAY_CONFLICT` |
| O16 | **PASS** | 30-rule fixture (real detector run), PATTERN / ABSENCE only, `severity` → `hint_severity` only, no domain for legal / compliance / financial / architectural |
| O17 | **PASS** | FinOps flags only; no L15 amount / estimate column (catalog + static + fixture) |
| O18 | **PASS** | DETECTED_ABSENCE renders "not detected"; no control assessment / applicability / Passport-read state changes |
| O79 | **PASS for S1 owners; rank-3 dependency-deferred** | exhaustive 2 owners × 10 tags; rank-3 owner rows (S2–S6 stores) cannot exist yet and none were fabricated |
| O80 | **PASS** | signal → itself / another signal; hypothesis → itself / another hypothesis rejected |
| O81 | **PASS (S1 portion)** | signal → hypothesis and hypothesis → rank-0 rejected; "any L15 governed artifact as a target" has no S1 instance (no such store / tag) → structurally impossible, re-proven by S2–S6 |
| O82 | **PASS for 9 executable tags; RISK_HYPOTHESIS tag catalog-only** | executable cross-tenant rejection for the 8 rank-0 tags + RISK_SIGNAL; the RISK_HYPOTHESIS target carries its composite FK (catalog-proven) but no S1 owner may target it → executable case dependency-deferred to S3 |
| O84 | **PASS** | no JSON / JSONB / array / free-text reference column; zero / two targets and tag mismatch rejected |
| O01, O02, O07 | **PASS (re-proven)** | 11 kinds / 12 types; no FK / trigger / index / uniqueness on `canonical_relationships`; five M16 families; M16 history digest unchanged |
| O59 | **PASS** | zero service_role L15 table privilege; L15 profile clean with the inventory; negative controls detected |
| O73, O74, O76 | **PASS (re-proven)** | 23 permissions; 17 envelope subjects without RISK_SIGNAL / RISK_HYPOTHESIS; `l14_fact_states` five families; every pre-existing constraint / trigger byte-identical (migration postflight); no L15 bootstrap |
| O85–O91 | **PASS / unaffected** | S0 legacy suite green; O88 now also proven at runtime for signals / hypotheses (zero L15 rows from legacy values) |

Not owned by S1 and not claimed: O03 (overlay), O04–O06 DB parts, O19–O78 except the re-proven ones, O83 (S2–S7).

## Invariants

M16 exactly five fact families; F2 untouched; 11 CanonicalObjectKinds; 12 GovernedRelationshipTypes; Passport 16 families (no
family 17); trust vocabulary unchanged; no L15 bootstrap; no governance subject added; service_role has no direct L14 / L15 table
privilege.

## Findings / dependency-deferred

- **F-S1-1 — APPROVED by ACP (delta review of `0347879`).** The exact M17 V1 closed `unresolved_reason` vocabulary is
  `MISSING_REVISION_EVIDENCE`, `NO_EXACT_MAPPING`, `AMBIGUOUS_MAPPING`, `UNSUPPORTED_BINDING_PROOF` — intentionally the existing
  L12 runtime-binding vocabulary, reused verbatim. Recorded here as an ACP clarification; the frozen M17 ADR is not modified.
- **F-S1-2 (S2)**: `proposed_scenario_definition_id` deferred (no column) until the S2 registry exists.
- **F-S1-3 (S3–S6)**: rank-3 support owners, O79 / O81 / O82 for governed-artifact owners and the RISK_HYPOTHESIS target, and the
  `CITED_BY_*` dispositions land with their stores; the hypothesis-disposition projection fails closed until then.
- **F-S1-4 — DIRECTION APPROVED by ACP, with the security hardening of S1R1 (below; BLOCKER RESOLVED).** The L15 machine caller
  is a **platform technical capability, not a tenant principal: platform-wide technical capability != tenant / business
  authority.** No tenant binding registry, no Discovery Machine change, no per-tenant LOGIN. Tenancy stays mandatory per call:
  caller-supplied organisation must be active; canonical subject in that organisation; relationship state by the exact
  organisation + relationship_id + relationship_state_id triple; every support target and cited signal same-tenant by exact
  composite identity; no cross-tenant reference; no governance authority created. Hosted activation / provisioning of an actual
  machine LOGIN is outside this branch and remains subject to the production security gates.
- **F-S1-5**: DRIFT_CANDIDATE is admissible per §4.3 and accepted by the guard, but the current M15 store CHECK cannot hold it.
- **F-S1-6 (environment)**: PGDG apt unreachable here; PG17 server from `@embedded-postgres`, `psql` 16 client, pgvector stand-in.
  CI (real PGDG PG17 + pgvector) is the arbiter.

## S1R1 — ACP delta: closed surface of the actual machine LOGIN

ACP blocker (review of `03478796`): a LOGIN holding `govia_l15_machine_intake_caller` could also hold unrelated memberships /
grants and still pass `l15_require_machine_intake_identity_v1()`. Fix, additive corrective migration
**`supabase/migrations/20261012220000_m17_s1r1_machine_intake_login_closure_v1.sql`** (the S1 migration is not edited):

- new owner-only SECURITY INVOKER predicate `gov_repo.l15_machine_role_safe_v1(oid, text)` (pinned `search_path`, EXECUTE revoked
  from every application role and the capability), modelled on — but not touching or reusing — the frozen Discovery Machine
  `machine_role_safe_v1`. On the actual `session_user` it requires: LOGIN; not postgres / service_role / authenticated / anon; no
  SUPERUSER / BYPASSRLS / CREATEDB / CREATEROLE / REPLICATION; not expired (`rolvaliduntil`); exactly one membership edge, to the
  capability, without ADMIN; no other role reachable through ANY edge (INHERIT / SET / dormant, direct or transitive, predefined
  roles included) and no membership held by the capability itself; no CREATE on the database or any non-temporary schema; no
  table / column / sequence privilege outside `pg_catalog` / `information_schema`; no EXECUTE on any SECURITY DEFINER routine
  outside the system catalogs nor on any `gov_repo` routine, except exactly `l15_admit_machine_signal_v1` and
  `l15_admit_machine_hypothesis_v1`.
- `l15_require_machine_intake_identity_v1()` is replaced (same signature, owner, ACL, volatility, path) to enforce it; it runs
  before any write, so a refused identity writes nothing. The intake RPC bodies, their inventory hashes, the definer surface
  (49 application + 2 technical, 7 L15 definers), every store, matrix, FK, adapter and replay rule are unchanged.
- Postflight: helpers owner-only INVOKER; surface unchanged; the capability holds no membership; every existing LOGIN member of the
  capability (except the owner's automatic PG16+ ADMIN creator grant on `postgres`, which the helper itself refuses) must be safe.
- Effective application surface of the machine LOGIN: USAGE on `gov_repo` + EXECUTE on the two intake RPCs (+ inherent catalog
  access).

Real PG17 adversarial suite `apps/dashboard/tests/postgres-m16/m17-s1r1-machine-login.test.ts` (each case = a real LOGIN with the
capability plus exactly one enlargement; signal AND hypothesis intake both refused with `L15_INTAKE_IDENTITY_INELIGIBLE`):

| # | Case | Result |
|---|---|---|
| 1 | clean dedicated LOGIN, capability only | signal + hypothesis admitted; predicate true |
| 2 | + service_role / + authenticated membership | refused |
| 3 | + unrelated role; dormant `INHERIT FALSE, SET FALSE` edge; capability `WITH ADMIN OPTION`; transitive nested role; predefined `pg_read_all_data` | refused |
| 4 | + role granting SELECT / INSERT on a gov_repo table; direct table SELECT; column privilege; direct L15 table privilege | refused |
| 5 | + EXECUTE on an L15 read RPC (definer); on an L14 governance RPC; on an owner-only gov_repo helper | refused |
| 6 | + CREATE on the database | refused |
| 7 | + CREATE on `gov_repo`; + CREATE on `public` | refused |
| 8 | expired LOGIN (`VALID UNTIL '2000-01-01'`) | refused |
| 9 | CREATEDB / CREATEROLE / REPLICATION / BYPASSRLS LOGIN | refused |
| 10 | after all refusals | zero new signals / hypotheses / support links; governance envelope (authorizations, proposals, decisions, results, fact / registry states, heads) unchanged |
| + | clean LOGIN vs L14 governance / L15 read RPCs | `42501`; reachable set = exactly the 2 intake RPCs |
| + | rolled-back enlargements of the clean LOGIN (table grant, service_role, read RPC, schema CREATE, CREATEDB, expiry, enlarging the capability itself) | each detected (predicate false), boundary restored after rollback |
| + | application roles / the machine LOGIN calling the predicate | `permission denied` |

## Next gate

ACP review of the S1R1 delta on the pushed branch (CI on the exact final HEAD), then PR / merge. **S2 NOT STARTED.**
