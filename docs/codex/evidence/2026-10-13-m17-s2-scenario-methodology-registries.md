# M17-S2 — RISK_SCENARIO_DEFINITION + RISK_METHODOLOGY Governed Registries

Starting point: `origin/main` = `0ad683c985d1d9b3458365f542b0b59af5df5cd2` (merge of PR #66, M17-S1 + S1R1), verified equal to the
expected SHA before branching, clean worktree. Repository `cnegrao/code-guard-governance`. Branch
`feat/m17-s2-scenario-methodology-registries` created from exactly that commit.

Architecture authority (not modified): [M17 ADR](../../architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md) (ACCEPTED / FROZEN)
§§7, 8.2, 9.2, 11, 12, 16, 17, 24, 26; [M16 Authority Policy M17 extension](../../architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md)
(D-01, §4 command-result L15 branch); [S1 evidence](./2026-10-12-m17-s1-signals-hypotheses-support.md);
[baseline](../../architecture/GOVIA-L0L16-CIA-v1.0.md) unchanged. Reference pattern: M16 CONTROL_DEFINITION
([migration](../../../supabase/migrations/20261008200000_m16_s1b6_control_definition_registry_v1.sql),
[evidence](./2026-10-08-m16-s1b6-control-definition-registry.md)) — governance pattern reused, persistence L15-specific.

## Recorded state

| Item | State |
|---|---|
| PR #66 (M17-S1 + S1R1) | **MERGED** (`0ad683c`) |
| `main` baseline at slice start | `0ad683c985d1d9b3458365f542b0b59af5df5cd2` |
| M16 | CLOSED (five fact families, unchanged) |
| M17 architecture | ACCEPTED / FROZEN (unchanged) |
| M17-S0, S1, S1R1 | MERGED |
| M17-S2 | IMPLEMENTED ON BRANCH `feat/m17-s2-scenario-methodology-registries`; ACP delta review: semantic / functional PASS, O19–O21 PASS; **NOT MERGED**; PR NOT OPENED |
| M17-S2R1 (F-S2-1 corrective) | IMPLEMENTED ON THE SAME BRANCH (`20261013130000_m17_s2r1_l15_allow_guard_execution_context_v1.sql`); **NOT MERGED** |
| M17-S3 … S7 | **NOT STARTED** |
| Hosted (Supabase / Vercel / deployment) | **NOT TOUCHED** |

## Environments

- **LOCAL**: disposable PostgreSQL **17.10** clusters (server binaries from `@embedded-postgres/linux-x64@17.10.0-beta.17`;
  `psql` = local 16 client), run as an unprivileged OS user; harness asserts `server_version_num` 17.x; pgvector stand-in (only the
  HNSW statement fails, asserted). M15 regression on local PostgreSQL 16 (as its CI job). Node 22.22.
- **CI**: `M16 PostgreSQL 17 security suite` (PGDG PG17 + real pgvector; runs every `tests/postgres-m16/*.test.ts`, so the three
  new S2 suites) and `M15 PostgreSQL regression`, on the pushed branch. **CI on the exact final HEAD is the arbiter.**
- **HOSTED**: NOT TOUCHED. No hosted migration, no direct hosted DB access, no Vercel change, no deployment.

## Pre-flight (verified)

- Canonical repo; `main` = `0ad683c`; PR #66 merged; worktree clean; M17 ADR ACCEPTED / FROZEN; S0, S1, S1R1 migrations present; the
  S1 security suite green on the post-S1R1 catalog before any S2 change.
- The actual post-S1R1 PostgreSQL 17 catalog was materialized and every key S2 binds to was read from `pg_constraint`, not ADR
  prose: `l14_governance_decisions_state_link_unique (organisation_id, governance_decision_id, subject_kind, outcome,
  authorization_decision_id)`, `l14_authorization_decisions_basis_unique (…, result, subject_kind, requested_action,
  basis_authority_policy_id, basis_version_id, basis_content_hash)`, `l14_proposals_subject_unique (organisation_id, proposal_id,
  subject_kind, intent)`, the S0 `l15_registry_target_check` (registry subjects organisation-wide only), the S0 reserved command
  kinds `ADMIT_RISK_SCENARIO_DEFINITION_VERSION` / `ADMIT_RISK_METHODOLOGY_VERSION`, the S0 command-result L15 branch (no
  VALIDATED / REVOKED branch yet — dependency-deferred by S0 to the slice creating L15 state stores), `l14_command_results`
  columns (no L15 state column), `l15_support_links` constraint set, `governance_users UNIQUE (organisation_id, user_id)`.
- The real M16 CONTROL_DEFINITION migration (identity / version / typed proposal / typed state / head / guards / resolver / three
  RPCs / postflight) was read before coding; S2 mirrors its order (base session → shape → DB hash → support → DB fingerprint → AP
  guard SHARED → subject guard(s) → command guard → replay → resolution → effective Authority Policy → mapped permission →
  mutation → final eligibility recheck).

## Migration

Exactly one additive migration: **`supabase/migrations/20261013120000_m17_s2_scenario_methodology_registries_v1.sql`**. No historical
migration edited. Preflight: PG17 / postgres / READ COMMITTED; exactly the three S1 L15 tables; the S1R1 predicate present; no S2
object; definer surface exactly 49 application / 7 L15; the D-01 envelope keys above; no L15 registry history. Snapshots every
`gov_repo` constraint / non-internal trigger and row-hashes every `l14_*` / `l15_*` table; the postflight proves nothing changed
except the enumerated additive widenings.

### Storage boundary

| Shared envelope (L14, vocabulary unchanged) | L15 stores created by S2 |
|---|---|
| `l14_authorization_decisions` (+ role / rule snapshots), `l14_proposals`, `l14_governance_decisions`, `l14_command_results` | 15 tables below |

**Not used and not widened:** `l14_registry_states`, `l14_fact_states`, `l14_support_links`, every M16 typed table (proven:
constraint definitions byte-identical, zero rows / columns referencing L15, P1 postflight). The only envelope change is the
S0-deferred D-01 §4 L15 decision-result branch: nullable `l14_command_results.l15_state_id`, its shape branch (registry
VALIDATED / REVOKED results carry `l15_state_id`, never a registry / fact / AP state), the
`l14_command_results_l15_state_check` (set only on registry VALIDATED / REVOKED results) and an owner-only guard
(`l15_command_results_state_guard`) that it names the exact L15 state of that decision / proposal / authorization / instant.
No FK from an `l14_*` table onto an `l15_*` store.

### Registry tables (15)

| Registry | Identity | Versions | Normalized content | Typed state | Typed proposal | Head |
|---|---|---|---|---|---|---|
| RISK_SCENARIO_DEFINITION | `l15_risk_scenario_definitions` | `l15_risk_scenario_definition_versions` | `…_subject_kinds`, `…_references` | `l15_risk_scenario_definition_states` | `…_proposals` | `…_heads` |
| RISK_METHODOLOGY | `l15_risk_methodologies` | `l15_risk_methodology_versions` | `…_likelihood_levels`, `…_impact_levels`, `…_rating_cells` | `l15_risk_methodology_states` | `…_proposals` | `…_heads` |

All: RLS on (no policy), REVOKE ALL from PUBLIC / anon / authenticated / service_role / `govia_l15_machine_intake_caller`, no column
default, constant discriminators are `GENERATED ALWAYS` columns, every FK `ON UPDATE / DELETE RESTRICT`, history tables `ENABLE
ALWAYS` raising `BEFORE UPDATE OR DELETE` + `BEFORE TRUNCATE` (`L15_HISTORY_IMMUTABLE`).

### Identity / version model (both registries)

- Stable identity = `organisation_id` + opaque caller-supplied UUID (`scenario_definition_id` / `methodology_id`), never derived from
  a code, domain, scanner rule, CG-AG id, title, hash or label; created once, right after its root version, by that version's exact
  ALLOW / ADMIT authorization (identity guard). Carries no content and no mutable semantic field.
- Version = opaque caller-supplied UUID; `UNIQUE (organisation_id, version_id)` (one identity per version id, never reused);
  linear admission lineage (`predecessor_version_id`; one root per identity — partial unique index; one successor per predecessor —
  unique; no self-predecessor); each pinned to its own exact ADMIT authorization (version guard mirrors actor, source, instant, DB
  hash as attempted content and the EXPECTED_NONE / EXPECTED_CURRENT expectation = its predecessor).
- ADMIT ≠ VALIDATE: admission writes no proposal, decision, state or head. There is no per-identity "current / latest version"
  pointer; admitting v2 neither validates, revokes nor replaces v1 (both governed independently — tested).

### Scenario content

- `risk_domain` CHECK = exactly the nine frozen domains; COMPLIANCE / REGULATORY / LEGAL / FINANCIAL / STRATEGIC / REPUTATIONAL /
  TECHNOLOGY / THIRD_PARTY / ARCHITECTURAL / unknown → `RISK_DOMAIN_UNKNOWN`.
- Subject kinds normalized relationally in `l15_risk_scenario_definition_subject_kinds (organisation_id, version_id, risk_domain,
  subject_kind)`: PK per (version, token) → no duplicate; FK onto `(version, risk_domain)` of its version; token CHECK = the 8 legal
  object kinds + the 12 `REL:<type>` tokens (PROMPT / KNOWLEDGE_BASE / SKILL are not direct subjects); legality CHECK =
  `l15_risk_domain_subject_legal_v1(risk_domain, subject_kind)`, the closed §8.2 matrix (AGENT only for OPERATIONAL; no
  inheritance). Non-empty (RPC `SUBJECT_KINDS_EMPTY` + commit guard). Exhaustively compared with the TS matrix (9 domains × 20
  tokens + unknowns).
- **Typed reference model** (no reusable typed-reference convention existed for bounded external codes; smallest normalized
  structure): `l15_risk_scenario_definition_references (organisation_id, version_id, reference_namespace, reference_code)`, PK on
  all four (duplicate → `REFERENCE_DUPLICATE`), closed namespaces `SCANNER_RULE_ID` (`^RISK-[A-Z0-9]+(-[A-Z0-9]+)*$`, the 30
  scanner rule ids), `CG_AG_CONTROL_ID` (`^CG-AG-[0-9]{3}$`), `ORGANISATION_SCENARIO_CODE` (`^[A-Z][A-Z0-9]*([_.-][A-Z0-9]+)*$`), all
  ≤ 64 chars; 1..32 per version. Descriptive provenance only: never identity (the same references under two identities are two
  independent scenarios — tested), never authority, domain, validation or label lookup. No free-text title / description /
  rationale column exists in any S2 table.
- **Content hash frame** (`l15_risk_scenario_content_hash_v1`, SHA-256 over the repository length-prefixed `frame_identity`):
  `L15_RISK_SCENARIO_DEFINITION_CONTENT_V1, RISK_DOMAIN, <domain>, SUBJECT_KINDS, <n>, <tokens in UTF-8 byte order>, REFERENCES,
  <m>, <(namespace, code) pairs in UTF-8 byte order>`. Input order irrelevant (tested in SQL and TS).

### Methodology content

- `l15_risk_methodology_likelihood_levels` / `…_impact_levels (organisation_id, version_id, ordinal smallint 1..7, level_code,
  definition_reference_namespace, definition_reference_code)`: PK (version, ordinal), UNIQUE (version, level_code), code
  `^[A-Z][A-Z0-9_]{0,31}$`, typed definition reference = closed namespace `ORGANISATION_DEFINITION_CODE` + bounded code (no
  free text). RPC: 2..7 levels (`*_SCALE_SIZE_INVALID`), ordinals exactly {1..n} (`*_LEVEL_ORDINAL_INVALID`: duplicate / gap / zero),
  unique codes (`*_LEVEL_CODE_DUPLICATE`). `ordinal` is the **only numeric column** of any S2 table (catalog-tested); no score /
  weight / percentage.
- `l15_risk_methodology_rating_cells (organisation_id, version_id, likelihood_level_code, impact_level_code, rating_band)`: PK per
  level pair (duplicate cell impossible), FKs onto the two scales of the SAME version (unknown / cross-scale level impossible), band
  CHECK = LOW / MODERATE / HIGH / CRITICAL. RPC: `RATING_BAND_UNKNOWN`, `RATING_MATRIX_LEVEL_UNKNOWN`, `RATING_MATRIX_CELL_DUPLICATE`,
  `RATING_MATRIX_INCOMPLETE` (≠ n × m). A lookup, never arithmetic.
- `assessment_validity_maximum interval NOT NULL`, CHECK `l15_assessment_validity_maximum_parts_v1(…) IS NOT NULL`: decomposed into
  months / days / time-microseconds, each ≥ 0 and not all zero (zero, negative and sign-mixed intervals rejected:
  `ASSESSMENT_VALIDITY_MAXIMUM_INVALID`). Future S4 input; S2 creates no assessment.
- **Commit-time completeness** (`l15_registry_commit_guard_v1`, deferred): each scale 2..7 levels with max ordinal = count, exactly
  n × m cells, scenario ≥ 1 subject and ≥ 1 reference, and the stored normalized content re-hashes to the stored `content_hash`
  (`*_VERSION_CONTENT_INCOMPLETE`). Content rows can only be written in their version's own transaction
  (`REGISTRY_CONTENT_NOT_IN_VERSION_TRANSACTION`, xmin = current transaction) — even the owner cannot add a level / cell later or
  commit a non-total matrix (tested).
- **Content hash frame** (`l15_risk_methodology_content_hash_v1`): `L15_RISK_METHODOLOGY_CONTENT_V1, LIKELIHOOD_SCALE, <n>,
  [ordinal, code, definition namespace, definition code] by ordinal, IMPACT_SCALE, <m>, […] by ordinal, RATING_MATRIX, <n×m>,
  [likelihood code, impact code, band] by (likelihood ordinal, impact ordinal), ASSESSMENT_VALIDITY_MAXIMUM, months, days,
  microseconds`. Golden vectors are pinned in both the TS mirror tests and the PG17 suite.
- PostgreSQL computes both hashes in the RPC (caller hash = assertion → `CONTENT_HASH_MISMATCH` before any mutation, nothing
  consumed) and re-verifies the stored content at commit.

### ADMIT / proposal / decision / REVOKE

| RPC (SECURITY DEFINER, owner `postgres`, `search_path=pg_catalog, pg_temp`, `lock_timeout=5s`, EXECUTE = service_role only) | Authority |
|---|---|
| `l15_admit_scenario_version_v1` / `l15_admit_methodology_version_v1` | `L15_RISK_SCENARIO_ADMIT` / `L15_RISK_METHODOLOGY_ADMIT`, action ADMIT, `ALL_ALLOWED_TARGETS`, command kind `ADMIT_RISK_SCENARIO_DEFINITION_VERSION` / `ADMIT_RISK_METHODOLOGY_VERSION` |
| `l15_submit_scenario_proposal_v1` / `l15_submit_methodology_proposal_v1` | any verified ACTIVE same-tenant member (grants nothing) |
| `l15_decide_scenario_proposal_v1` / `l15_decide_methodology_proposal_v1` | `L15_RISK_SCENARIO_VALIDATE` / `L15_RISK_METHODOLOGY_VALIDATE` with requested action = the exact outcome (VALIDATE / REJECT / DEFER / REVOKE) |

- Permission comes only from `gov_repo.l15_governance_permission_v1(subject, action)` (S0 mapping) over the CURRENT effective
  Authority Policy (exact recomputed hash) and the actor's CURRENT locked persisted roles (`l14_session_basis_v1` → M16-S0
  eligibility: verified ACTIVE human of the ACTIVE organisation). Never service_role, machine capability, source class, scanner,
  confidence, CG-AG, LLM or seed origin. No L15 bootstrap; the single Authority Policy root; L15 rules enter only through an
  Authority Policy successor validated under the effective policy (fixtures do exactly that).
- Reason codes exactly `RISK_SCENARIO_DEFINITION_{VALIDATED,REJECTED,DEFERRED,REVOKED}` / `RISK_METHODOLOGY_{…}` (unchanged
  subject × outcome rule). REJECT / DEFER: decision only, no state. DEFER non-terminal; VALIDATE / REJECT / REVOKE terminal;
  correction through a new linked proposal (`prior_proposal_id`).
- REVOKE proposals pin the exact current VALIDATED state of the same tuple (`TARGET_STATE_UNRESOLVED` / `TARGET_STATE_NOT_VALIDATED`
  / `TARGET_ALREADY_REVOKED` / `TARGET_STATE_NOT_CURRENT`); the decision requires the same exact expected-current head.
- States (`…_states`) are append-only: VALIDATED → REVOKED → VALIDATED same-tuple alternation (generated predecessor / revoked kinds
  + self-FKs), one root and one successor per state; each row pins tuple + proposal + governance decision (FK onto
  `state_link_unique` with subject / outcome / authorization) + ALLOW authorization with its Authority Policy version + hash (FK onto
  `basis_unique`) + source class + support status; the state guard re-checks decision / proposal / version / source / support /
  effective-from consistency and the M16 S1B.1R1 interval rules.
- Heads (`…_heads`): compare-and-set pointer per exact tuple, created empty by the first state-appending decision, advanced only to
  the direct lineage successor, never deleted / truncated / rewound; reconstructible as the lineage state without successor (tested);
  never authority.
- **D-01 ALLOW guard evaluation (finding F-S2-1).** The S0 deferred constraint trigger `l15_authorization_decisions_allow_guard`
  (SECURITY INVOKER) fires at COMMIT as the committing role; `service_role` has by design no privilege on the envelope nor on
  `l15_governance_permission_v1`, so a real L15 ALLOW could not commit (S0 only exercised it through owner inserts). Without editing
  S0, each S2 RPC fires that exact guard inside its owner-pinned definer right after the rule snapshot (`SET CONSTRAINTS
  gov_repo.l15_authorization_decisions_allow_guard IMMEDIATE; … DEFERRED;`), keeping its full check (effective-policy L15 rule of the
  exact mapped permission + action, AUTHORITY_POLICY_VERSION basis, ACTIVE human of the ACTIVE organisation). Proven: an owner-forged
  L15 ALLOW without an L15 rule is still refused at commit (`L15_ALLOW_WITHOUT_L15_AUTHORITY`). **F-S2-1 is RESOLVED BY S2R1**
  (see [M17-S2R1](#m17-s2r1--root-allow-guard-execution-context-f-s2-1)): the guard itself now runs in the owner context, so the
  RPCs' `SET CONSTRAINTS` pair is only a redundant early check.

### SYSTEM_SEED (D-11 / O21)

- No seed rows, no default methodology, no machine path: the migration inserts nothing (static + catalog tested); nothing is granted
  to `govia_l15_machine_intake_caller` (its surface stays exactly the two S1 intake RPCs); no new technical principal.
- Executable submission is human-mediated; SYSTEM_SEED is preserved as origin / provenance: a version admitted with
  `source_class = SYSTEM_SEED` still requires the L15 ADMIT permission (unauthorized seeder → durable DENY); its proposals must carry
  the same source class (no laundering: `SOURCE_CLASS_LINEAGE_MISMATCH`) and PRESENT DISCOVERY_EVIDENCE / SOURCE_ASSERTION support
  (`SYSTEM_SEED_SUPPORT_REQUIRED`, re-verified at commit). `SOURCE_CONNECTION` → `SOURCE_CLASS_NOT_EXECUTABLE`.
- A seed proposal creates no validation; the ADMIT-only / L14-only / member / legacy-admin actors are durable DENY; its submitter
  deciding it is `SELF_VALIDATION_NOT_PERMITTED`; the machine LOGIN gets `42501`; service_role with a forged / null / suspended
  principal gets GV00x; only an authorized verified ACTIVE human under the effective Authority Policy validates it — the state keeps
  `source_class = SYSTEM_SEED`, the authorization snapshots only `LOCAL_HUMAN / AUTHORITATIVE / AUTHORITY_POLICY_RULE` rules.

### Support / provenance (D-03 for the S2 owners)

`l15_support_links` widened additively (S1 rows / rules / branches unchanged): `owner_kind` + `RISK_SCENARIO_DEFINITION`,
`RISK_METHODOLOGY`; `owner_registry_artifact` ∈ PROPOSAL / DECISION / STATE; typed owner columns with same-tenant composite FKs
(`owner_scenario_proposal_id` → scenario proposals, `owner_methodology_proposal_id` → methodology proposals,
`owner_governance_decision_id` → `l14_governance_decisions`, `owner_scenario_state_id`, `owner_methodology_state_id`); shape CHECK =
exactly one owner identity matching the artifact; matrix CHECK = rank-3 registry owners → `DISCOVERY_EVIDENCE` / `SOURCE_ASSERTION`
only (RISK_SIGNAL / RISK_HYPOTHESIS / every other tag refused; no L15 governed artifact is a target → acyclic, no recursive check);
unique per owner × target. The S1 link guard is extended (S1 branches verbatim): a registry owner must have been written by the same
transaction (xmin = current transaction) and a DECISION owner must be of that subject kind. Commit guard: proposal / state support
status = actual link set; state links = decision links. No JSON / array / free-text reference column.

### Exact resolvers (S3 / S4 dependency contracts)

`l15_risk_scenario_definition_valid_state_v1(organisation_id, scenario_definition_id, scenario_definition_version_id, content_hash,
effective_at, recorded_cutoff)` and `l15_risk_methodology_valid_state_v1(…)` (owner-only, STABLE, STRICT): the exact VALIDATED state of
the exact admitted tuple with `recorded_at ≤ cutoff`, `effective_from ≤ instant` and no visible REVOKED tombstone targeting it with
`effective_from ≤ instant`; no row otherwise; ambiguity fails closed; never latest / by code / by label / by domain / by similarity.
FK-pinnable key for S3 / S4: `(organisation_id, state_id, identity, version, content_hash, 'VALIDATED')` via `…_states_kind_unique`.

### Temporal / replay / concurrency

M16 §17 verbatim: `recorded_at` DB-authored; omitted `effective_from` = DB transaction instant; explicit past = BACKDATED, explicit
future = FUTURE_DATED, each requiring the matched rule's flag (`TEMPORAL_ACTION_NOT_AUTHORIZED` otherwise); no skew tolerance;
successor / revocation never edits the predecessor (byte-identical, tested); future-effective REVOKE never hides the state early.
Replay identity `organisation_id + command_id`; PostgreSQL recomputes the fingerprint (`L15_COMMAND_FINGERPRINT_V1` frames incl. the
DB content hash, expectation and sorted support); exact retry returns the original result (ids, `recorded_at`, `effective_from`);
changed payload `GV007`; wrong caller fingerprint `GV008`; durable DENY replays. Expected-none / expected-current on every mutation;
identity, version-id and exact-tuple advisory guards + AP guard SHARED serialize first / successor admissions, version-id reuse and
VALIDATE / REVOKE / terminal decisions.

### Optional hypothesis → scenario reference — DEPENDENCY-DEFERRED

Not added. The only executable machine hypothesis path is the frozen S1R1 closed LOGIN surface (exactly two intake RPCs). Adding an
exact validated-scenario pin would require either replacing the S1 intake RPCs (forbidden; also changes their inventory hashes and
fingerprint frames) or adding a new machine-callable RPC (widens the closed LOGIN surface; `l15_machine_role_safe_v1` would refuse such a
LOGIN). A member-only pin would make machine and human hypotheses asymmetric. Deferred to an explicit ACP decision (F-S2-2); no
loose label / reference was introduced. Not required for O19–O21.

## Security / ACL / definer surface

| Surface | Before S2 (post-S1R1) | After S2 |
|---|---|---|
| Application SECURITY DEFINER surface (EXECUTE by service_role / anon / authenticated / PUBLIC) | 49 | **55** (+6 registry RPCs, service_role only) |
| Technical intake surface (`govia_l15_machine_intake_caller`) | 2 | **2** (unchanged; nothing granted) |
| L15 SECURITY DEFINER routines (inventory) | 7 | **14** (+6 RPCs, +1 owner-only deferred commit guard) |
| service_role-executable L15 routines | 4 | **10** |
| L15 tables | 3 | **18** |
| service_role direct L15 table privileges | 0 | **0** |

S2R1 delta (derived from the real post-S2 PG17 catalog, asserted before and after the corrective): application definer surface
**55 → 55** (the guard is owner-only, so it is not application-executable); L15 SECURITY DEFINER inventory **14 → 15** (+ the root guard);
service_role-executable L15 routines 10 → 10; technical intake surface 2 → 2; service_role L15 table privileges 0 → 0. ACP's directional
"55 → 56" counted the guard in the application surface; the metric used since M16 (and in P4 of every postflight) counts only
definers EXECUTE-able by service_role / anon / authenticated / PUBLIC, which the guard is not.

Every new definer: documented necessity (section headers), owner `postgres`, `search_path = pg_catalog, pg_temp` (+ `lock_timeout 5s`
on RPCs), fully qualified, EXECUTE only to service_role (the commit guard: owner-only trigger fn), tenant / actor / roles re-derived
in-RPC, registered with owner + body SHA-256 + config in the migration postflight (P7) and the test inventory
(`L15_S2_DEFINER_INVENTORY`, `tests/postgres-m16/m17-s2-security.test.ts`). No S2 routine body references the M16 policy content
stores or any M16 typed registry / fact / support store (postflight P5 + test). Every new helper / guard / resolver is owner-only.
Replaced routine: only the owner-only SECURITY INVOKER S1 trigger function `l15_support_link_insert_guard_v1` (S1 branches restated
verbatim, registry-owner branch added); no RPC replaced.

S1R1 closed machine-LOGIN surface re-proven AFTER all S2 grants on the post-S2 catalog: the capability reaches exactly the two intake
RPCs; the clean LOGIN still satisfies `l15_machine_role_safe_v1` and admits a signal + hypothesis; every registry RPC / resolver is
`42501` for it; a LOGIN additionally holding EXECUTE on an S2 RPC is refused (`L15_INTAKE_IDENTITY_INELIGIBLE`); postflight P6
re-checks every existing machine LOGIN.

ACL negative controls (rolled back, each detected by the L15 profile): SELECT grant to service_role on each of the 15 tables; column
grant; EXECUTE on an owner-only resolver to anon; definer search_path drift; disabled immutability trigger; replaced commit-guard body.

## Tests

| Suite | Result (local) |
|---|---|
| Focused **M17-S2 PG17 functional** `tests/postgres-m16/m17-s2-registries.test.ts` | **20 / 20 PASS** |
| Focused **M17-S2 PG17 concurrency** `tests/postgres-m16/m17-s2-registries-concurrency.test.ts` | **20 / 20 PASS** |
| Focused **M17-S2 PG17 ACL / security** `tests/postgres-m16/m17-s2-security.test.ts` | **6 / 6 PASS** |
| Focused **M17-S2R1 PG17** `tests/postgres-m16/m17-s2r1-allow-guard.test.ts` | **8 / 8 PASS** |
| Full **M16 PG17** suite `tests/postgres-m16/*.test.ts` (incl. M17-S0, S1, S1R1, S2, S2R1) | **@FULL@** (1226 pre-existing + 46 S2 + 8 S2R1) |
| **M15** PostgreSQL regression `tests/postgres/*.test.ts` | **8 / 8 PASS** |
| `@council/canonical-contracts` (`node --test test/*.mjs`, incl. new `l15-registries.test.mjs`, 4) + `tsc --noEmit` | **253 / 253 PASS**; clean |
| `@council/governance-review` (`tsx --test test/*.test.ts`, incl. new `l15-registries.test.ts`, 6) + `tsc --noEmit` | **418 / 418 PASS**; clean |
| Dashboard `npm test` (main + passport-ui + pre-demo-ui + m17-s0-legacy) incl. `m17-s2-static-acceptance` (4 + 1 S2R1) | **1251 PASS / 0 FAIL / 5 skipped (pre-existing)** + 17 / 17 + 8 / 8 + 12 / 12 |
| Dashboard `tsc --noEmit -p apps/dashboard/tsconfig.json` | clean |

Harness changes are additive: `m17S2ScenarioMethodologyMigration` and the `M17S2` horizon (= `M17S1` + S2); `tests/helpers/m17-s2-fixtures.ts`.
One existing assertion was advanced, not weakened: `tests/m17-s0-authority-contract.test.ts` pinned the exact post-S0 migration
list `[S0, S1, S1R1]`; it now pins `[S0, S1, S1R1, S2]` (the same horizon discipline every slice applies). No other existing test line
was edited. The package `test` scripts pass `--test-isolation=none`, which the container's Node 22.22 rejects; the same files were run
without that flag.

### CI

| Workflow | Run | HEAD | Result |
|---|---|---|---|
| M16 PostgreSQL 17 security suite (PGDG PG17 + real pgvector) | [38408445809](https://github.com/cnegrao/code-guard-governance/actions/runs/38408445809) | `99a0b79` | success |
| M15 PostgreSQL regression | [38408446417](https://github.com/cnegrao/code-guard-governance/actions/runs/38408446417) | `99a0b79` | success |
| M16 PostgreSQL 17 security suite | [38408373093](https://github.com/cnegrao/code-guard-governance/actions/runs/38408373093) | `c6193c8` (last code commit) | success |

This docs-only evidence commit re-runs both workflows on the final branch head.

### Adversarial matrix (all PASS)

| # | Attack | Result |
|---|---|---|
| 1 | wrong scenario content hash (random / other content / malformed) | `GV010 CONTENT_HASH_MISMATCH` / `CONTENT_HASH_MALFORMED`; nothing written or consumed |
| 2 | wrong methodology content hash | `GV010 CONTENT_HASH_MISMATCH` |
| 3 | illegal domain (COMPLIANCE, REGULATORY, LEGAL, FINANCIAL, STRATEGIC, REPUTATIONAL, TECHNOLOGY, THIRD_PARTY, ARCHITECTURAL, lowercase, unknown, empty, NULL) | `RISK_DOMAIN_UNKNOWN` |
| 4 | illegal domain × subject (AGENT for PRIVACY, REL:USES_MODEL for PRIVACY; owner-forged row) | `DOMAIN_SUBJECT_ILLEGAL` / legality CHECK; exhaustive 9 × 20 DB = TS |
| 5 | empty subject set | `SUBJECT_KINDS_EMPTY` |
| 6 | duplicate subject kind; PROMPT / KNOWLEDGE_BASE / SKILL / bare type token | `SUBJECT_KIND_DUPLICATE` / `SUBJECT_KIND_UNKNOWN` |
| 7 | version id reused under another identity (incl. concurrent) | `GV009 …_VERSION_ID_EXISTS` |
| 8 | stale / foreign predecessor; EXPECTED_NONE over existing identity | `GV009 …_VERSION_EXPECTATION_MISMATCH` / `…_EXISTS` |
| 9 | concurrent first admissions (both registries) | one winner; loser `GV009`, consumed nothing |
| 10 | concurrent successor admissions | one successor, never a fork; loser `GV009` |
| 11 | ADMIT / decide with only L14 permissions | durable DENY `NO_MATCHING_AUTHORITY_RULE` |
| 12 | ADMIT with the wrong L15 registry permission (methodology ↔ scenario, VALIDATE as ADMIT) | durable DENY |
| 13 | VALIDATE / REJECT / DEFER with only ADMIT permission | durable DENY |
| 14 | scenario permission deciding a methodology proposal | durable DENY |
| 15 | methodology permission deciding a scenario proposal (+ wrong RPC) | durable DENY / `PROPOSAL_UNRESOLVED` |
| 16 | no L15 rule in the organisation (incl. legacy GOVERNANCE_ADMIN wildcard) | durable, replayable DENY; changed payload `GV007` |
| 17 | SYSTEM_SEED proposal attempting authority | no state; every non-L15-VALIDATE actor DENY |
| 18 | machine intake LOGIN calling admit / submit / decide / resolver | `42501` |
| 19 | service_role with forged / null / ghost / suspended principal | `GV001–GV005`; nothing written |
| 20 | self-validation absent explicit policy | `SELF_VALIDATION_NOT_PERMITTED` |
| 21 | role revocation / credential rotation / user suspension / organisation deactivation committed during VALIDATE and ADMIT | evaluated against the committed state: DENY or GV002 / GV003; no state / version |
| 22 | Authority Policy succession removing the grant during commit | waiting VALIDATE is a durable DENY under the successor basis |
| 23 | wrong-tenant proposal / version / state / principal | `PROPOSAL_UNRESOLVED` / `…_VERSION_NOT_ADMITTED` / `TARGET_STATE_UNRESOLVED` / GV00x |
| 24 | REVOKE of another tuple's / unknown state | `TARGET_STATE_UNRESOLVED` |
| 25 | REVOKE already revoked / stale expected current | `TARGET_ALREADY_REVOKED` / `GV009` / `PROPOSAL_TERMINAL` |
| 26 | likelihood scale with 1 level | `LIKELIHOOD_SCALE_SIZE_INVALID` |
| 27 | likelihood scale with 8 levels | `LIKELIHOOD_SCALE_SIZE_INVALID` |
| 28 | impact scale with 1 / 8 levels | `IMPACT_SCALE_SIZE_INVALID` |
| 29 | duplicate ordinal | `LIKELIHOOD_LEVEL_ORDINAL_INVALID` |
| 30 | ordinal gap / zero | `IMPACT_LEVEL_ORDINAL_INVALID` / `LIKELIHOOD_LEVEL_ORDINAL_INVALID` |
| 31 | duplicate level code; malformed code / definition reference | `*_LEVEL_CODE_DUPLICATE` / `*_LEVEL_CODE_MALFORMED` / `*_DEFINITION_REFERENCE_MALFORMED` |
| 32 | incomplete matrix (RPC; owner-forged extra level in the version transaction) | `RATING_MATRIX_INCOMPLETE` / commit `…_VERSION_CONTENT_INCOMPLETE` |
| 33 | duplicate / extra matrix cell | `RATING_MATRIX_CELL_DUPLICATE` |
| 34 | matrix cell with unknown / cross-scale level | `RATING_MATRIX_LEVEL_UNKNOWN` |
| 35 | unknown rating band (SEVERE, low, NONE, 9) | `RATING_BAND_UNKNOWN` |
| 36 | zero / negative / sign-mixed / NULL validity maximum | `ASSESSMENT_VALIDITY_MAXIMUM_INVALID` |
| 37 | support target RISK_SIGNAL (and every other non-rank-0-registry tag) | `SUPPORT_TARGET_NOT_ADMISSIBLE`; DB matrix CHECK (exhaustive 10 tags) |
| 38 | support target RISK_HYPOTHESIS | `SUPPORT_TARGET_NOT_ADMISSIBLE` / matrix CHECK |
| 39 | cross-tenant DISCOVERY_EVIDENCE support | `SUPPORT_TARGET_UNRESOLVED`; direct insert → composite FK |
| 40 | cross-tenant SOURCE_ASSERTION support | `SUPPORT_TARGET_UNRESOLVED`; direct insert → composite FK |
| 41 | UPDATE / DELETE / TRUNCATE on every registry history table (owner, superuser replica); head rewind / delete; command-result l15_state_id rewrite / forgery | `L15_HISTORY_IMMUTABLE` / `L14_HISTORY_IMMUTABLE` / `COMMAND_RESULT_L15_STATE_MISMATCH` |
| 42 | seed / scanner / CG-AG reference provenance producing authority | none: only the human L15 VALIDATE rule authorizes |
| 43 | new registry RPCs enlarging the S1 machine LOGIN surface | capability surface exactly 2 RPCs; enlarged LOGIN refused |
| + | late support-link top-up, two-owner / mismatched-owner rows, decision owner of the other subject kind | `SUPPORT_OWNER_NOT_IN_TRANSACTION` / shape CHECK |
| + | late content-row insertion by the owner into an admitted version | `REGISTRY_CONTENT_NOT_IN_VERSION_TRANSACTION` |
| + | owner-forged L15 ALLOW without an L15 rule | `L15_ALLOW_WITHOUT_L15_AUTHORITY` at commit |
| + | subject / version-id / AP guard held | `55P03` after `lock_timeout`; nothing written; command reusable |

## Acceptance criteria

| Criterion | S2 status | Proof |
|---|---|---|
| **O19** | **PASS** | both registries: ADMIT writes no proposal / decision / state / head and the resolver returns nothing; VALIDATE only with the matching `L15_*_VALIDATE` (every other permission / role a durable DENY); PostgreSQL recomputes the content hash (golden vectors DB = TS; order-independent); wrong caller hash rejected before mutation |
| **O20** | **PASS** | scales < 2 / > 7 (both scales), duplicate / gapped ordinals, missing / duplicate cells, unknown level, unknown band rejected; complete matrices 2×2, 7×7, 2×7, 5×3 accepted; commit-time completeness holds against the owner |
| **O21** | **PASS** | SYSTEM_SEED-origin version + proposal exist in the fixture; seeding creates no validation; seed origin grants no authority; machine identity cannot decide; service_role alone cannot decide; only an authorized verified human under the effective Authority Policy validates it |
| O01, O02 | PASS (re-proven) | 11 kinds / 12 types; no canonical risk value; no FK / trigger from an L15 table onto `canonical_relationships` |
| O04 | **PASS** | domain CHECK = exactly the nine values; COMPLIANCE / REGULATORY / LEGAL / FINANCIAL rejected |
| O05 | PASS (unchanged) | no L15 fact-family store exists yet (S3+); registries are not fact families |
| O06 (S2 columns) | **PASS** | every S2 closed vocabulary is a DB CHECK with negative cases: domain, subject token, reference namespace, source class, intent, state kind, rating band, support owner artifact / kind |
| O07 | PASS (re-proven) | five M16 families; M16 history of the organisation byte-identical across the whole S2 run; S2 RPCs write no M16 store |
| O53–O58, O62 (S2 portions) | **PASS** | permission isolation; unknown tags; no L15 bootstrap; self-validation fail-closed; deactivation / succession races; tenant from the verified principal only; immutability |
| O59–O61 | **PASS** | zero service_role L15 privilege; profile clean with the 14-definer inventory; negative controls detected; postflight P7 pins bodies |
| O63–O66 (S2 portions) | PASS | temporal, bitemporal resolver, replay, concurrency (formal closure in S7) |
| O73–O76 | **PASS (re-proven)** | 23 permissions / 17 subjects / 24 L15 reason codes unchanged; `l14_fact_states` / `l14_registry_states` / `l14_support_links` / M16 typed constraints byte-identical; the only envelope change is the S0-deferred `l15_state_id` result branch; no L15 bootstrap routine |
| O77, O78 | PASS (re-proven) | pre-existing envelope rows unchanged (postflight P2); one Authority Policy identity; every L15 authorization snapshots that policy |
| O79 | **PASS for the S2 owners** | exhaustive registry owner × 10 tags: exactly DISCOVERY_EVIDENCE / SOURCE_ASSERTION admissible; S3–S6 owners not created |
| O80 | PASS (unchanged, S1) | |
| O81 | **PASS for the S2 owners** | no L15 governed artifact is a support target; registry owners cannot target RISK_SIGNAL / RISK_HYPOTHESIS |
| O82 | **PASS for the S2 targets** | cross-tenant DISCOVERY_EVIDENCE / SOURCE_ASSERTION rejected (RPC + composite FK) |
| O84 | **PASS** | no JSON / array / free-text reference column; exactly one typed owner and one typed target per row |
| O85–O91 | PASS / unaffected | S0 legacy suite green; O90 re-proven for registry RPCs; O91 = the regression runs above |

Not owned by S2 and not claimed: O03, O08–O18 (S1), O22–O52, O67–O72, O83 (S3–S7).

## M17-S2R1 — root ALLOW guard execution context (F-S2-1)

Additive corrective `supabase/migrations/20261013130000_m17_s2r1_l15_allow_guard_execution_context_v1.sql`; no S0 / S1 / S1R1 / S2
migration edited; the six S2 RPCs are not rewritten; no hosted mutation.

- **Original defect.** M17-S0 created `gov_repo.l15_authorization_allow_guard_v1()` as a SECURITY INVOKER trigger function behind the
  `DEFERRABLE INITIALLY DEFERRED` constraint trigger `l15_authorization_decisions_allow_guard`. A deferred trigger fires at COMMIT in
  the committing session, i.e. as `service_role`, outside the RPC definer that inserted the ALLOW. `service_role` has (by design) no
  privilege on `l14_authorization_decisions`, `l14_authorization_decision_rules`, `governance_users`, `organisations` nor EXECUTE on
  `l15_governance_permission_v1`, so the guard raised `42501` and every natural L15 ALLOW commit failed. S0 only exercised the guard
  through owner inserts, so the defect stayed latent until the first L15 writers (S2).
- **Why it was fail-closed.** The failure aborted the COMMIT: no L15 ALLOW (legitimate or forged) could ever be persisted through an
  application role. Availability was lost, never integrity — reproduced on the post-S2 catalog (S2R1 test 1: `42501`, zero rows).
- **Why the S2 workaround worked.** `SET CONSTRAINTS … IMMEDIATE` inside the owner-pinned RPC fires the pending guard event at that
  statement, while `current_user` is still the definer owner, so the full check ran with owner privileges before the RPC returned.
- **Central fix.** The guard is re-declared with the same signature and the **byte-identical S0 body** (prosrc SHA-256
  `ee7885662da87a4946ad06596dbcd9f1af9bbb52de0e86fb7b16fd17731b5236`, asserted in the preflight, postflight P1 and the static test) as
  `SECURITY DEFINER`, owner `postgres`, `SET search_path = pg_catalog, pg_temp`. Unchanged checks: subject → permission mapping,
  `AUTHORITY_POLICY_VERSION` basis, exact basis id / version, exact `AUTHORITY_POLICY_RULE` snapshot of the mapped permission
  and `requested_action`, ACTIVE actor of the same ACTIVE organisation, error `L14_INVALID_COMMAND` / `GV010` /
  `L15_ALLOW_WITHOUT_L15_AUTHORITY`. Read-only, no dynamic SQL, no writes, no store outside the envelope / rules / users / organisations
  / L15 permission map (asserted on the body).
- **ACL closure.** `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller`; no GRANT; resulting
  ACL `{postgres=X/postgres}`. Direct calls are `42501` for service_role, anon, authenticated, the capability and a fresh role (PUBLIC).
  The trigger definition (incl. its WHEN clause), `DEFERRABLE INITIALLY DEFERRED`, `ENABLE ALWAYS` and its target function are
  byte-identical (postflight P2/P3 snapshot every gov_repo constraint, trigger and routine). Definer delta: see the S2R1 row above
  (application 55 → 55, L15 14 → 15); inventory `L15_S2R1_DEFINER_INVENTORY` (owner, body hash, config) in
  `tests/helpers/m17-l15-definer-inventory.ts`; the L15 profile flags `DEFINER_NOT_INVENTORIED` for the guard if it is omitted.
- **Natural-trigger proof.** A test-only probe (SECURITY DEFINER, EXECUTE to service_role only, created and dropped inside the test
  fixture; asserted absent afterwards) writes an L15 ALLOW envelope and returns; the transaction then COMMITs in the plain
  `service_role` session without any `SET CONSTRAINTS`, so the guard fires at commit as the deferred trigger. Legitimate ALLOW
  commits; forged / mis-based ALLOWs are refused with `GV010` at that natural commit: no mapped rule snapshot, wrong L15 permission,
  member without a rule, L14 permission for an L15 subject, bootstrap basis, foreign-tenant actor, suspended actor, deactivated
  organisation, and an owner-forged ALLOW with an invalid basis. Real S2 admit / validate for both registries still succeed.
- **S3+ consequence.** The guard no longer depends on the writer's execution context. **S3+ writers MUST NOT depend on
  `SET CONSTRAINTS … IMMEDIATE`** for the ALLOW guard; the S2 RPCs keep their pair only as a redundant safety measure (left
  unchanged by ACP decision).

Focused coverage `tests/postgres-m16/m17-s2r1-allow-guard.test.ts` (items 1–24 of the ACP delta review) + the S2R1 static test in
`tests/m17-s2-static-acceptance.test.ts`; horizon `M17S2R1` (= `M17S2` + S2R1) added to the harness; the post-S0 migration list in
`tests/m17-s0-authority-contract.test.ts` advanced to `[S0, S1, S1R1, S2, S2R1]`; the S2 static test now pins S2 → S2R1 as the only
successor. The S1 / S2 definer inventories moved, unchanged, to the shared helper.

## Invariants

M16 exactly five fact families; `l14_fact_states` / `l14_registry_states` / `l14_support_links` / M16 typed tables not widened; F2
untouched; 11 CanonicalObjectKinds; 12 GovernedRelationshipTypes; Passport 16 families (no family 17); trust vocabulary unchanged; no L15
bootstrap; single Authority Policy root; no new governance subject, permission, reason code or command kind; S1R1 machine LOGIN surface
unchanged; Discovery Machine roles / control plane untouched; service_role has no direct L14 / L15 table privilege.

## Findings / dependency-deferred

- **F-S2-1 — RESOLVED BY S2R1.** S0 latent defect (SECURITY INVOKER deferred guard executed as `service_role` at COMMIT; fail-closed).
  Fixed centrally by the M17-S2R1 corrective (owner-only SECURITY DEFINER guard, byte-identical body); see
  [M17-S2R1](#m17-s2r1--root-allow-guard-execution-context-f-s2-1). S3+ no longer needs the `SET CONSTRAINTS` workaround and must not
  depend on it.
- **F-S2-2 — APPROVED / DEFERRED (ACP).** Optional hypothesis → validated-scenario pin: see above; not implemented (requires a later
  ACP decision on the closed machine surface).
- **F-S2-3 (environment).** PGDG apt unreachable here; PG17 server from `@embedded-postgres`, `psql` 16 client, pgvector stand-in;
  Node 22.22 (package scripts' `--test-isolation=none` unsupported, files run without it). CI (real PGDG PG17 + pgvector) is the arbiter.

## Next gate

ACP review of the S2R1 corrective delta (CI on the exact final HEAD), then PR / merge of S2 + S2R1. **S3 NOT STARTED.**
