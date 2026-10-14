# M17-S3 — GOVERNED_RISK (the first L15 authoritative fact family)

Starting point: `origin/main` = `fb700690e361bfc136ee68c92cfa82a37917458e` (merge of PR #67, M17-S2 + S2R1), verified equal to the
expected SHA before branching, clean worktree. Repository `cnegrao/code-guard-governance`. Branch `feat/m17-s3-governed-risk`
created from exactly that commit.

Architecture authority (not modified): [M17 ADR](../../architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md) (ACCEPTED / FROZEN)
§§6, 8, 9.2, 11–13, 16–19, 24, 26; [M16 Authority Policy M17 extension](../../architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md)
(D-01, D-03, §4 command-result L15 branch); [S2 evidence](./2026-10-13-m17-s2-scenario-methodology-registries.md) (incl. S2R1);
[baseline](../../architecture/GOVIA-L0L16-CIA-v1.0.md) unchanged. Reference pattern: the M16 fact families (proposal → authorization
→ decision → immutable state → CAS head → durable result) — governance pattern reused, persistence L15-specific.

## Recorded state

| Item | State |
|---|---|
| PR #67 (M17-S2 + S2R1) | **MERGED** (`fb70069`) |
| `main` baseline at slice start | `fb700690e361bfc136ee68c92cfa82a37917458e` |
| M16 | CLOSED (five fact families, unchanged) |
| M17 architecture | ACCEPTED / FROZEN (unchanged) |
| M17-S0, S1, S1R1, S2, S2R1 | MERGED |
| M17-S3 | IMPLEMENTED ON BRANCH `feat/m17-s3-governed-risk`; ACP delta review: implementation / O22–O30 / authority / subject / pins / concurrency / security PASS; one blocker F-S3-1 (O44 lineage); **NOT MERGED**; PR NOT OPENED |
| M17-S3R1 (F-S3-1 corrective) | IMPLEMENTED ON THE SAME BRANCH (`20261013150000_m17_s3r1_governed_risk_support_currency_lineage_v1.sql`); **NOT MERGED** |
| M17-S4 … S7 | **NOT STARTED** |
| Hosted (Supabase / Vercel / deployment) | **NOT TOUCHED** |

## Environments

- **LOCAL**: disposable PostgreSQL **17.10** clusters (server binaries from `@embedded-postgres` 17.10; `psql` = local 16 client),
  run as an unprivileged OS user; the harness asserts `server_version_num` 17.x; pgvector stand-in (only the HNSW statement fails,
  asserted). M15 regression on the same local binaries. Node 22.22.
- **CI**: `M16 PostgreSQL 17 security suite` (PGDG PG17 + real pgvector; runs every `tests/postgres-m16/*.test.ts`, so the four new
  S3 suites) and `M15 PostgreSQL regression`, on the pushed branch. **CI on the exact final HEAD is the arbiter.**
- **HOSTED**: NOT TOUCHED. No hosted migration, no direct hosted DB access, no Vercel change, no deployment.

## Pre-flight (verified)

- `main` = `fb70069`; PR #67 merged; worktree clean; S0 / S1 / S1R1 / S2 / S2R1 migrations present; the S2R1 root ALLOW guard is
  the owner-only SECURITY DEFINER with the byte-identical S0 body (body hash `ee7885…`, asserted again by the S3 preflight).
- Post-S2R1 PostgreSQL 17 catalog materialized; every key S3 binds to was read from `pg_constraint`: the D-01 envelope keys
  (`l14_proposals_subject_unique`, `l14_governance_decisions_state_link_unique`, `l14_authorization_decisions_basis_unique`), the
  S2 scenario keys (`(organisation_id, scenario_definition_version_id, risk_domain)`, the version subject-kind table, the VALIDATED
  scenario state tuple), the S2 `l14_command_results` L15 branch (`l15_state_id`), the `l15_support_links` constraint set, and the
  existing exact M16 resolvers + `l14_resolve_relationship_state_target_v1` + `l14_evaluate_*_authority_rules_v1`.
- Surface before S3: application SECURITY DEFINER 55, L15 definers 15, service_role L15 RPCs 10, machine intake RPCs 2, L15 tables
  18, service_role L15 table privileges 0.

## Migration

Exactly one additive migration: **`supabase/migrations/20261013140000_m17_s3_governed_risk_v1.sql`** (after
`20261013130000_m17_s2r1_l15_allow_guard_execution_context_v1.sql`). No historical migration edited. Preflight: PG17 / postgres /
READ COMMITTED; post-S2R1 catalog; S2R1 guard hash; 55 / 15 / 2 surface; envelope keys; no GOVERNED_RISK history. It snapshots
every `gov_repo` constraint / non-internal trigger / routine and row-hashes the `l14_*` / `l15_*` tables; the postflight (P1–P8)
proves nothing changed except the enumerated additive widenings, the effective ACL surface, and the definer inventory (owner, body
SHA-256, pinned `search_path`, exact EXECUTE grantees).

Only routines replaced: `l15_support_link_insert_guard_v1` and `l15_command_result_state_guard_v1` (owner-only triggers; S1 / S2
branches restated verbatim, the GOVERNED_RISK branch added). Only constraints dropped + re-added under the same name (widening):
`l15_support_links_owner_kind_check` / `_owner_shape_check` / `_owner_target_matrix_check`, `l14_command_results_shape_check`,
`l14_command_results_l15_state_check`. No SET CONSTRAINTS anywhere. No seed row.

## Stores and logical key

| Table | Role |
|---|---|
| `l15_governed_risk_proposals` | immutable typed proposal over `l14_proposals` (FK `(org, proposal_id, subject_kind, intent)`) |
| `l15_governed_risk_states` | immutable VALIDATED / REVOKED states; append-only lineage per logical key |
| `l15_governed_risk_heads` | technical CAS pointer per logical key; RPC-maintained; reconstructible; never authority |

- **Logical key**: `organisation_id + subject_key + scenario_definition_id` (heads PK; root unique index
  `l15_governed_risk_states_root_uidx`; successor / revocation unique indexes make the lineage linear — never a fork).
- `subject_key` is a generated, injective, branch-tagged, length-prefixed key
  (`l15_risk_subject_key_v1`: `CANONICAL_OBJECT|<n>:<kind>|<n>:<object_id>` / `RELATIONSHIP_STATE|<n>:<relationship_id>|<n>:<state_id>`,
  `n` = code points; the TypeScript mirror counts code points too).
- The S4 / S5 dependency key: `l15_governed_risk_states_kind_unique (organisation_id, state_id, subject_key, scenario_definition_id,
  scenario_definition_version_id, scenario_content_hash, scenario_validated_state_id, state_kind)`.
- `l14_fact_states` / `l14_registry_states` / `l14_support_links` / M16 typed tables are NOT used or widened (asserted: zero L15 rows).

## Subject model and resolution

Closed union (`subject_type`): **CANONICAL_OBJECT** — one of the eight legal V1 kinds (`AGENT, AGENT_VERSION, MODEL, TOOL,
MCP_SERVER, API, DATA_ASSET, DATA_ELEMENT`; PROMPT / KNOWLEDGE_BASE / SKILL are never direct subjects), composite FK
`(org, object_id, kind)` onto `canonical_objects`; or **RELATIONSHIP_STATE** — the exact triple `organisation + relationship_id +
relationship_state_id`, resolved by `l14_resolve_relationship_state_target_v1` (match_count must be exactly 1); the relationship type
is DB-resolved at submission (`subject_relationship_type`), re-resolved by the proposal guard, the state guard and the resolver.
F2 `canonical_relationships` is immutable (DO INSTEAD NOTHING rules) and `relationship_id` is its PK, so a triple resolves to 0 or 1
row. Never inherited: AGENT → AGENT_VERSION, DATA_ASSET → DATA_ELEMENT, object → relationships, AGENT_VERSION v1 → v2 (O27).
Wrong tenant / swapped ids / mismatched triple / bare state id / hybrid shape / kind mismatch all fail closed (O26).

## Scenario dependency pin and domain

A proposal names `scenario_definition_id` (key) + exact `scenario_definition_version_id` + `scenario_content_hash`. VALIDATE requires
the S2 exact scenario resolver (`l15_risk_scenario_definition_valid_state_v1`) to return a VALIDATED scenario state at the state's own
`(effective_from, recorded_at)`; the state pins that exact `scenario_validated_state_id` (composite FK onto the VALIDATED scenario state
tuple). **Domain is DB-derived**: `risk_domain` has no RPC parameter; FK `(org, version_id, risk_domain)` onto the scenario version
forces it to equal the version's domain; CHECK `l15_risk_domain_subject_legal_v1(risk_domain, subject_token)` enforces the frozen §8.2
matrix; FK `(org, version_id, subject_token)` onto the version's subject-kind table enforces the scenario's own declared subjects.
Exhaustive matrix proven: 9 domains × 20 tokens = 180 pairs, exactly 70 legal (O25). A scenario successor never repins a risk; the
only repin is an authorized successor VALIDATE naming another version (same open-ended pin again → `GOVERNED_RISK_ALREADY_VALIDATED`).
Scenario revocation makes the risk `SCENARIO_DEPENDENCY_INVALID` at both coordinates without any risk row mutation (O30). The VALIDATE
path takes the scenario dependency guard SHARED on the same key the S2 scenario decision takes EXCLUSIVE, so a scenario REVOKE in flight
serializes with a risk VALIDATE pinning it (proven both directions).

## Proposal / authority / decision / state / head

- **Submit** (`l15_submit_governed_risk_proposal_v1`): verified ACTIVE same-tenant human member, `source_class = LOCAL_HUMAN` only
  (`SYSTEM_SEED` → `SYSTEM_SEED_NOT_ADMISSIBLE`; `SOURCE_CONNECTION` → `SOURCE_CLASS_NOT_EXECUTABLE`, dependency-deferred to M19).
  Writes `l14_proposals` + typed proposal + optional PROPOSAL support links + durable `SUBMITTED` result. No authorization, decision,
  state or head. No domain / score / likelihood / impact / rating / lifecycle / owner / title / description / rationale parameter.
- **Decide** (`l15_decide_governed_risk_proposal_v1`): VALIDATE / REJECT / DEFER / REVOKE. Authority = the CURRENT effective Authority
  Policy, exact permission `L15_GOVERNED_RISK_VALIDATE` (`l15_governance_permission_v1('GOVERNED_RISK', outcome)`), evaluated over the
  exact typed subject by the existing M16 evaluators (`l14_evaluate_target_authority_rules_v1` for objects,
  `l14_evaluate_relationship_state_authority_rules_v1` for relationship states): CANONICAL_KIND / CANONICAL_OBJECT /
  RELATIONSHIP_TYPE / RELATIONSHIP_STATE scopes, CONTRIBUTING never authorizes, self-validation only with `allowSelfValidation`,
  BACKDATED / FUTURE_DATED only with the rule's flag. No L15 rule → durable, replayable DENY (`NO_MATCHING_AUTHORITY_RULE`); no
  bootstrap; the legacy GOVERNANCE_ADMIN wildcard does not apply. ALLOW → `l14_governance_decisions` → (VALIDATE / REVOKE) state →
  head CAS → durable result with `l15_state_id`. REJECT / DEFER write no state and move no head (DEFER non-terminal).
- Lock order: AP guard SHARED → (VALIDATE) scenario dependency guard SHARED → logical-key guard
  (`frame_identity([org,'l15-governed-risk-key-guard-v1',subject_key,scenario_id])`) → command guard → replay arbitration → resolution
  → mutation → final base-eligibility recheck. No SET CONSTRAINTS: the S2R1 root ALLOW guard fires naturally at COMMIT.
- **closure_reason**: closed field on REVOKE proposals and REVOKED states (`RISK_NO_LONGER_APPLICABLE, SUBJECT_RETIRED,
  DUPLICATE_OF_GOVERNED_RISK, RISK_ELIMINATED_BY_AVOIDANCE, RECORDED_IN_ERROR`). The decide RPC takes `p_closure_reason`: REVOKE
  requires exactly the proposal's value; VALIDATE / REJECT / DEFER require NULL. The shared reason code stays
  `GOVERNED_RISK_REVOKED`. Only an exact-current REVOKE closes a risk (O29); closure is derived (a visible successor effective at the
  instant), never written into the predecessor.
- Guards: proposal guard (LOCAL_HUMAN only, envelope mirror, relationship type re-resolved); state guard (mirrors envelope, proposal and
  authorization target; interval / successor rules; scenario resolver at `(effective_from, recorded_at)` must return the pinned state);
  owner-only deferred SECURITY DEFINER `l15_governed_risk_commit_guard_v1` (support integrity at COMMIT); head guard (only the direct
  lineage successor); ENABLE ALWAYS UPDATE / DELETE / TRUNCATE rejection on proposals and states (even the owner, even replica role).

## Temporal and replay

M16 §17 semantics: `recorded_at` = DB transaction instant; IMMEDIATE (`effective_from = recorded_at`), BACKDATED / FUTURE_DATED (rule
flags required); optional explicit immutable `effective_to` (VALIDATE only) — at `effective_to` the state is `EXPIRED` with no UPDATE;
a future-effective REVOKE never hides the state early. Successor rules (GV011): `SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE`,
`SUCCESSOR_BEFORE_PREDECESSOR_END`, `REVOKE_BEFORE_TARGET_EFFECTIVE`, `REVOKE_AFTER_TARGET_EXPIRY`,
`REVALIDATION_OVERLAPS_PRIOR_INTERVAL`. Replay: exact retry returns the ORIGINAL durable result (never recomputed); changed payload
GV007; wrong caller fingerprint GV008 (frame `L15_COMMAND_FINGERPRINT_V1` via `l14_sha256_frame_v1`, mirrored byte-for-byte in
`governance-review`; golden vectors pinned on both sides); stale expected-current / expected-none GV009; invalid GV010.

## Support (D-03 extension)

`l15_support_links` gains `owner_kind = GOVERNED_RISK` with `owner_governed_risk_artifact ∈ {PROPOSAL, DECISION, STATE}` and typed
owner columns `owner_governed_risk_proposal_id` / `owner_governed_risk_state_id` (DECISION reuses the S2 `owner_governance_decision_id`
column; the guard pins the decision's subject kind). Targets: `RISK_HYPOTHESIS`, `RISK_SIGNAL` and every rank-0 tag (all 10 tags;
rank 3 → 2 / 1 / 0). No L15 governed artifact is a target tag, so no cycle. Same tenant (composite FKs), owner written by the same
transaction (xmin check), at most 64 entries, no duplicates, no JSON / array / free text. Support is provenance only: a critical
signal, a 1.0-confidence hypothesis or 100 hypotheses grant zero authority.

## Support currency (O44)

`l15_governed_risk_support_currency_v1(org, state_id, at, cutoff)` (read only; persists nothing) projects the **exact GOVERNED_RISK
lineage support union PROPOSAL + DECISION + STATE** of the state (as corrected by S3R1, see below). Per-link target rules:

| Target | Current iff |
|---|---|
| `L14_FACT_STATE` | the family's existing exact M16 resolver (`l14_{responsibility_assignment,business_context_assignment,policy_applicability,control_applicability,control_assessment}_valid_state_v1`), called with the cited state's own key at the same coordinates, returns exactly that `fact_state_id` (no replacement is ever selected) → else `L14_FACT_STATE_NOT_CURRENT` |
| `TECHNICAL_FIELD_STATE` / `EXECUTION_FIELD_STATE` | no successor (`previous_state_id`) visible at the cutoff → else `FIELD_STATE_SUPERSEDED` |
| `DISCOVERY_EVIDENCE`, `SOURCE_ASSERTION`, `RUNTIME_OBSERVATION`, `CROSS_SIGNAL_RESULT`, `LINEAGE_OBSERVATION` | immutable evidence: existence + same-tenant typed identity |
| `RISK_SIGNAL` / `RISK_HYPOTHESIS` | transitively: the signal's own rank-0 links (hypothesis → its cited signals) → `SIGNAL_SUPPORT_NOT_CURRENT` / `HYPOTHESIS_SUPPORT_NOT_CURRENT`, naming the upstream failing link |

`l15_governed_risk_support_summary_v1` → `SUPPORT_NONE` / `SUPPORT_CURRENT` / `SUPPORT_DEGRADED` (+ lineage link counts, first failing
link PROPOSAL → DECISION → STATE then `link_id`, reason, upstream link); surfaced by the read RPC. M16 is read only through the exact resolvers and never written. A degraded support
never changes, revokes, expires or re-decides the risk (history / heads / results byte-identical); historical as-of before the
upstream change still projects `SUPPORT_CURRENT`; closing a degraded risk needs a normal authorized REVOKE.

### F-S3-1 and the S3R1 correction (O44 lineage)

**Finding (ACP delta review).** The original S3 projection evaluated only the links whose owner was the STATE
(`owner_governed_risk_artifact = 'STATE'`). The frozen ADR §13.2 requires support invalidation to be visible on every governed-risk
read even when the dependency was only cited — explicitly including proposal support — and D-03 makes PROPOSAL / DECISION / STATE
first-class support owners. A VALIDATED state has one authoritative lineage (its proposal + its governance decision + itself), so
support cited only on the proposal (or only on the decision) was invisible: a risk validated with proposal-only support read
`SUPPORT_NONE`, and an invalidated proposal-cited M16 fact never surfaced. The S3 writer happens to mirror decision support into the
state, which hid the DECISION half of the gap; the semantics must not depend on that coincidence.

**Correction.** Additive **`supabase/migrations/20261013150000_m17_s3r1_governed_risk_support_currency_lineage_v1.sql`** (no historical
migration edited) replaces in place only the two owner-only SECURITY INVOKER projections, with the same signatures and result
columns (owner postgres, ACL, `search_path = pg_catalog, pg_temp` preserved):

- `l15_governed_risk_support_currency_v1` — lineage membership for state `S` (same organisation, `owner_kind = 'GOVERNED_RISK'`,
  link `recorded_at <= cutoff`):
  - PROPOSAL: `owner_governed_risk_artifact = 'PROPOSAL' AND owner_governed_risk_proposal_id = S.proposal_id`
  - DECISION: `owner_governed_risk_artifact = 'DECISION' AND owner_governance_decision_id = S.governance_decision_id`
  - STATE: `owner_governed_risk_artifact = 'STATE' AND owner_governed_risk_state_id = S.state_id`

  Never the support of another proposal / decision / state, never scenario-registry support, never other support of the same
  logical key. Rows ordered PROPOSAL → DECISION → STATE, then `link_id`.
- `l15_governed_risk_support_summary_v1` — **SUPPORT_NONE** iff zero lineage links; **SUPPORT_DEGRADED** iff ≥ 1 lineage link fails
  its target rule; **SUPPORT_CURRENT** otherwise (≥ 1 link, all current at `(effective_at, recorded_cutoff)`). Returns the total
  lineage `support_link_count`, `degraded_link_count`, the deterministic first `failing_link_id` (PROPOSAL → DECISION → STATE, then
  `link_id`), `failing_reason` and `failing_upstream_link_id` for a transitive failure.

The per-link target rules are unchanged (`l15_support_link_target_failure_v1` reused verbatim, not replaced); no replacement is ever
selected; no support link is mutated. `l15_read_governed_risk_v1` already reads the summary function, so its body and inventory hash
are unchanged. The S3R1 preflight requires the uncorrected S3 projection and the reviewed S3 definer inventory; its postflight proves
only the two projection bodies changed (signature / result / invoker / owner / config / ACL preserved, routine count unchanged), no
table / constraint / trigger / table ACL changed, no support / GOVERNED_RISK / head / `l14_fact_states` row changed, and the surface is
unchanged.

**Proof** (`m17-s3-support-currency.test.ts`, horizon `M17S3R1` stopping before S3R1):

- *F-S3-1 reproduced*: on the S3 catalog a risk validated with proposal-only L14 support reads `SUPPORT_NONE` (0 links); S3R1 is
  applied (no GOVERNED_RISK / support row written); the same risk reads `SUPPORT_CURRENT` (1 link, the PROPOSAL link).
- *Proposal-only degradation*: proposal support PRESENT (exact `L14_FACT_STATE`), decision / state support NONE (asserted 0 links) →
  read `SUPPORT_CURRENT` (1 / 0); the exact M16 fact is revoked through the real M16 RPC → the unchanged risk reads
  `SUPPORT_DEGRADED`, `failing_link_id` = the exact PROPOSAL-owned link, `L14_FACT_STATE_NOT_CURRENT`, 1 / 1. The state row is
  byte-identical and VALIDATED, the head is unchanged, no governance decision / command result / proposal / support link is written; a
  re-validation of the M16 key selects no replacement (still degraded, same link); the historical read before the invalidation is
  `SUPPORT_CURRENT`.
- *Lineage aggregation*: PROPOSAL support A + DECISION / STATE support B → exactly 3 links (A, B, B) in PROPOSAL → DECISION → STATE
  order; an unrelated rejected REVOKE proposal of the same key citing B + evidence is excluded; A fails while B is current →
  `SUPPORT_DEGRADED` 3 / 1 naming the PROPOSAL link (never hidden by current B); both fail → 3 / 3, still the PROPOSAL link first.
- *Deterministic ordering*: proposal support current, decision / state support failing → the DECISION link is named before the STATE
  link; repeated reads identical.
- Existing O44 cases re-proven over the lineage union (exact M16 resolver: 5 lineage links, 3 degraded, PROPOSAL link first; expiry /
  supersession; transitive signal / hypothesis naming the PROPOSAL link + the upstream signal link; field-state supersession naming
  the DECISION link; a REVOKED state's own lineage (all explicit NONE) never inherits the predecessor's support).
- Security suite: after S3R1 the surface is unchanged (application definers 58, service_role L15 RPCs 13, intake 2, L15 definers 19,
  L15 tables 21, service_role L15 table privileges 0); only the two projection bodies changed; S3R1 and S3 both refuse to re-run.

## Exact risk resolver

`l15_governed_risk_valid_state_v1(org, subject…, scenario_id, at, cutoff)`: states of the exact logical key visible at the cutoff;
VALIDATED, effective at `at`, before any explicit `effective_to`, with no visible successor effective at `at`; exactly one candidate;
the subject still resolves (object row / exact relationship triple with the pinned type); the S2 scenario resolver returns the pinned
`scenario_validated_state_id` at the same coordinates. No row = not current. Never latest-by-scenario, never repinned.
`l15_governed_risk_state_current_v1(org, state_id, at, cutoff)` is the S4 / S5 exact-state form.
`l15_governed_risk_resolution_v1` classifies: `CURRENT, NO_STATE, REVOKED, NOT_YET_EFFECTIVE, EXPIRED, SUBJECT_UNRESOLVED,
SCENARIO_DEPENDENCY_INVALID`. `l15_read_governed_risk_v1` (service_role, verified member) returns the resolution, lineage pins,
Authority Policy basis and the O44 summary.

## Source / machine / LLM / graph / vector boundaries

Executable source = LOCAL_HUMAN only. SYSTEM_SEED is never admissible. SOURCE_CONNECTION is **dependency-deferred to M19** (no safe
bounded intake identity exists; the store CHECK reserves it, the guard refuses it). The machine intake capability
(`govia_l15_machine_intake_caller`) holds no S3 privilege: it cannot submit, decide or read (attacks 7 / 8); the machine LOGIN surface
remains exactly the 2 S1 intake RPCs (attack 56). No LLM, scanner, graph or vector path exists in any S3 source (static).

## S2R1 natural deferred-guard proof (attack 57)

In an explicit service_role transaction, the S3 writer commits with a plain `COMMIT`; the S2R1 root guard
`l15_authorization_allow_guard_v1` (deferred, owner-only SECURITY DEFINER) fires at COMMIT. A forged ALLOW (with a matching DENIED
command result so the deferred FKs pass) is refused at COMMIT with `L15_ALLOW_WITHOUT_L15_AUTHORITY`. No S3 routine contains
`SET CONSTRAINTS` (static + postflight P6).

## ACL / definer surface

| Surface | Before | After |
|---|---|---|
| Application SECURITY DEFINER | 55 | **58** |
| L15 definers | 15 | **19** |
| service_role-executable L15 RPCs | 10 | **13** |
| Machine intake RPCs | 2 | **2** |
| L15 tables | 18 | **21** |
| service_role L15 table privileges | 0 | **0** |

New SECURITY DEFINERs (owner postgres, explicit `ALTER FUNCTION … OWNER TO postgres`, `search_path = pg_catalog, pg_temp`,
`lock_timeout 5s` on RPCs), inventoried in `apps/dashboard/tests/helpers/m17-l15-definer-inventory.ts` and asserted by postflight P8:

| Routine | EXECUTE | Body SHA-256 |
|---|---|---|
| `l15_submit_governed_risk_proposal_v1` | service_role | `e6d8587dacea996a38c7f15bb50db3c3937cdc32a574f61e67a20a5e035531f5` |
| `l15_decide_governed_risk_proposal_v1` | service_role | `73e0d2401cf073e67d27cc6510d05b7ce0f556dbe397ff6baa8ae07128f60038` |
| `l15_read_governed_risk_v1` | service_role | `9425fa2272293d5148d3aa6433407afc85cc09825432844cd4a440d489326862` |
| `l15_governed_risk_commit_guard_v1` | none (deferred trigger) | `b9b88cf166ad7294fc47264893fc4e8051ce381009e4fcc32111c3bedf26ad5c` |

Necessity: the L15 stores and the shared envelope carry no application privilege, so a bounded definer is the only write / read path;
the commit guard fires at COMMIT as the committing role, which holds no L15 privilege. Every helper / resolver / projection is
SECURITY INVOKER and owner-only (no application EXECUTE).

## Files

- Migration: `supabase/migrations/20261013140000_m17_s3_governed_risk_v1.sql`.
- Corrective migration (F-S3-1): `supabase/migrations/20261013150000_m17_s3r1_governed_risk_support_currency_lineage_v1.sql`;
  test horizon `M17S3R1` (the `M17S3` horizon keeps the exact S3 chain).
- Contracts: `packages/canonical-contracts/src/l15-governed-risk.ts` (subject union + key / token, scenario pins, proposal, closure
  reasons, state, command result, resolutions, support failure reasons, resolver request / result, support summary).
- Mirrors: `packages/governance-review/src/l15-governed-risk.ts` (subject / proposal checks, support parts, reason codes, submit /
  decide fingerprints). Preflight UX only; PostgreSQL is the arbiter.
- Server-only adapter: `apps/dashboard/lib/governance/l15-governed-risk-persistence.ts` (no route / UI consumes it).
- PG17 suites: `apps/dashboard/tests/postgres-m16/m17-s3-governed-risk.test.ts` (19 subtests),
  `m17-s3-governed-risk-concurrency.test.ts` (12), `m17-s3-security.test.ts` (7), `m17-s3-support-currency.test.ts` (6, O44);
  fixtures `tests/helpers/m17-s3-fixtures.ts`; horizon `M17S3` in `m16-l14-fixtures.ts` / `disposable-m16-postgres.ts`.
- Static: `apps/dashboard/tests/m17-s3-static-acceptance.test.ts`; S0 / S2 static horizon lists extended with the S3 migration.
- Unit: `packages/canonical-contracts/test/l15-governed-risk.test.mjs`, `packages/governance-review/test/l15-governed-risk.test.ts`
  (golden fingerprints also asserted against `l14_sha256_frame_v1` in the PG17 functional suite).

## Acceptance criteria

| Criterion | Status | Proof |
|---|---|---|
| O22 VALIDATE only via proposal → ALLOW → decision → state → head | **PASS** | functional O22 (ids traceable end to end) |
| O23 REJECT / DEFER / DENY create no state; DENY durable + replayable | **PASS** | functional O23, no-GR-rule DENY |
| O24 submission boundary (SYSTEM_SEED, SOURCE_CONNECTION, non-member, machine) | **PASS** | functional O24, security O14 |
| O25 domain × subject matrix (180 pairs, 70 legal) | **PASS** | functional O25 (exhaustive, real RPCs + owner-forged CHECK / FK) |
| O26 exact relationship triple | **PASS** | functional O26 |
| O27 no inheritance | **PASS** | functional O27 |
| O28 no free text; closed reasons / closure_reason | **PASS** | functional O28 + closure placement; static |
| O29 only an exact-current REVOKE closes | **PASS** | functional O29; concurrency attack 33 |
| O30 scenario successor never repins; revocation invalidates without mutation | **PASS** | functional O30 + scenario dependency; concurrency guard |
| O44 support currency | **PASS** (after S3R1; F-S3-1 resolved) | `m17-s3-support-currency.test.ts` (10 subtests, real M16 / S1 upstream; exact PROPOSAL + DECISION + STATE lineage) |

Inherited criteria re-proven for the S3 surface: O01 / O02 (additive, static), O04–O07 (no L14 widening, single AP, M16 history
byte-identical), O13 / O14 (machine boundary), O19 / O21 (scenario pin), O53–O58 (authority evaluation), O59–O62 (ACL / definer
profile, immutability), O63–O66 (temporal), O73–O78 (envelope constraints byte-identical except the enumerated L15 result branch),
O79–O82 / O84 (support), O90 (verified principal).

## Adversarial attacks (57 / 57 covered)

| # | Attack | Suite |
|---|---|---|
| 1 | VALIDATE without proposal | functional O22 |
| 2–5 | no / L14 / scenario / treatment permission | functional authority |
| 6 | no L15 rule → durable DENY | functional no-GR-rule |
| 7, 8 | machine submits / decides | security O14 |
| 9 | SYSTEM_SEED proposal | functional O24 |
| 10 | service_role without verified human | security O90, functional authority |
| 11–13 | inactive user / org, revoked role | concurrency attack 14 (committed changes) |
| 14 | membership change during commit | concurrency attack 14 (4 variants) |
| 15 | AP succession during commit | concurrency attack 15 |
| 16 | self-validation without policy | functional authority |
| 17–19 | wrong scenario identity / version / hash | functional O30 |
| 20–22 | scenario REVOKED / not effective / historical cutoff | functional scenario dependency, O30 |
| 23, 24 | illegal domain × object / relationship | functional O25 |
| 25–29 | kind mismatch, wrong-tenant object / triple, swapped ids, bare state id | functional O26 |
| 30 | stale expected-current | functional replay |
| 31–33 | concurrent first / successor VALIDATE, VALIDATE vs REVOKE | concurrency |
| 34–37 | REVOKE wrong / closed state, no / unknown closure_reason | functional O29, closure placement |
| 38–40 | VALIDATE / REJECT / DEFER carrying closure_reason | functional closure placement |
| 41, 42 | caller-supplied domain; score / likelihood / impact / rating | functional O25 / O28; static |
| 43, 44 | cross-tenant support per class; governed artifact as support | functional support (D-03) |
| 45–47 | UPDATE / DELETE / TRUNCATE state | security O62 |
| 48–50 | changed-payload replay, wrong fingerprint, exact replay | functional replay; concurrency same command |
| 51–53 | scenario supersession without repin; revocation without mutation; historical as-of | functional O30 |
| 54, 55 | invalid M16 support degrades currency; degradation never revokes | O44 suite |
| 56 | machine surface exactly 2 | security O14 |
| 57 | natural deferred ALLOW guard, no SET CONSTRAINTS | concurrency attack 57; static |

## Tests (local)

| Suite | Result |
|---|---|
| S3 functional PG17 | 19 / 19 |
| S3 concurrency PG17 (real concurrent sessions) | 12 / 12 |
| S3 security / ACL PG17 (incl. S3R1 surface proof) | 8 / 8 |
| S3 O44 support currency PG17 (incl. F-S3-1 reproduction + S3R1 proofs) | 10 / 10 |
| Full M16 PG17 (`tests/postgres-m16/*.test.ts`, incl. S0 / S1 / S1R1 / S2 / S2R1 / S3 / S3R1) | PENDING (post-S3R1 run in progress; updated on completion) |
| M15 PostgreSQL regression | 8 / 8 |
| canonical-contracts | 256 / 256 |
| governance-review | 425 / 425 |
| dashboard (`npm test` set, incl. S3 / S3R1 static) | 1256 pass, 0 fail, 5 pre-existing opt-in skips; passport-ui 17 / 17, pre-demo-ui 8 / 8, m17-s0-legacy 12 / 12 |
| typecheck (canonical-contracts, governance-review, scanner, graphos, dashboard) | clean |
| `git diff --check` | clean |

CI (push runs on this branch): `M16 PostgreSQL 17 security suite` **success** and `M15 PostgreSQL regression` **success** on
`1bcc511` (implementation; runs 38459640352 / 38459640357), `9e2977f` (runs 38459724022 / 38459723990) and `9b2d4ba` (runs
38460600496 / 38460600462), and `1e96875` (pre-S3R1 reviewed HEAD; runs 38462596572 / 38462596503). S3R1: PENDING (updated on completion).

## Invariants

Exactly four L15 authoritative fact families possible structurally (GOVERNED_RISK, RISK_ASSESSMENT, RISK_TREATMENT,
RISK_ACCEPTANCE — only GOVERNED_RISK has a store; S4–S6 create the other three); exactly five M16 fact families; 11 canonical kinds; 12 relationship types; Passport 16 families; no L15 bootstrap;
single Authority Policy root; machine surface exactly 2; no L15 row in `l14_fact_states` / `l14_registry_states`; F2 untouched; M16
history byte-identical across every S3 suite; S2R1 natural deferred commit.

## Findings / dependency-deferred

- **SOURCE_CONNECTION** GOVERNED_RISK proposals: dependency-deferred to **M19** (no safe bounded source-connection intake identity
  exists). The store CHECK admits the value; the proposal guard refuses it (`SOURCE_CLASS_NOT_EXECUTABLE`); the TypeScript executable
  set is `['LOCAL_HUMAN']`.
- **F-S3-1 — RESOLVED BY S3R1.** O44 originally projected only STATE-owned links; it now projects the exact lineage support union
  PROPOSAL + DECISION + STATE (see "F-S3-1 and the S3R1 correction"). No authority impact: support degradation remains a read
  projection that never revokes, supersedes, moves a head, writes a decision, changes authorization, repins, mutates M16 or selects
  replacement evidence.
- The TypeScript subject key counts code points to match PostgreSQL `length()` (non-BMP identifiers frame identically on both sides).
- No other finding. S4 (assessment) NOT STARTED.

## Hosted

NOT TOUCHED. No hosted Supabase mutation, no Vercel change, no deployment.

## Next gate

ACP review of M17-S3 + S3R1 on branch `feat/m17-s3-governed-risk` (no PR opened); F-S3-1 re-review. S4 (RISK_ASSESSMENT pinning
`l15_governed_risk_states_kind_unique` and the methodology) only after S3 is accepted and merged.
