# M17-S4 — INHERENT RISK_ASSESSMENT (the second L15 authoritative fact family)

Starting point: `origin/main` = `83642d4a45978f85a7db60dbdfbd904df36582e5` (merge of PR #68, M17-S3 GOVERNED_RISK + S3R1 O44
full-lineage support currency), verified equal to the expected SHA before branching (fast-forward only), clean worktree.
Repository `cnegrao/code-guard-governance`. Branch `feat/m17-s4-inherent-risk-assessment` created from exactly that commit.
File date follows the repository convention for this workday (the migration timestamp `20261013160000` and the S2 / S3
evidence are dated 2026-10-13).

Architecture authority (not modified): [M17 ADR](../../architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md) (ACCEPTED / FROZEN)
§§9.2, 10, 11, 12, 16-18, 20.1, 24, 26; [M16 Authority Policy M17 extension](../../architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md)
(D-01 §4 command-result L15 branch); [S3 evidence](./2026-10-13-m17-s3-governed-risk.md) (incl. S3R1); [baseline](../../architecture/GOVIA-L0L16-CIA-v1.0.md)
unchanged. Implementation authority: the PostgreSQL 17 catalog produced by the real migration chain (every S2 / S3 key S4 binds to
was read from `pg_constraint` and is re-asserted by the S4 preflight). Reference pattern: S3 GOVERNED_RISK + the M16
CONTROL_ASSESSMENT expiry / renewal rules (the closest analog: pinned-state key, mandatory `valid_until`).

## Recorded state

| Item | State |
|---|---|
| PR #68 (M17-S3 + S3R1) | **MERGED** (`83642d4`) |
| `main` baseline at slice start | `83642d4a45978f85a7db60dbdfbd904df36582e5` |
| M16 | CLOSED (five fact families, unchanged) |
| M17 architecture | ACCEPTED / FROZEN (unchanged) |
| M17-S0, S1, S1R1, S2, S2R1, S3, S3R1 | MERGED |
| M17-S4 | **IMPLEMENTED ON BRANCH `feat/m17-s4-inherent-risk-assessment`; NOT MERGED; PR NOT OPENED** (ACP branch-delta review first) |
| M17-S5 (treatment) | **NOT STARTED** |
| M17-S6 (RESIDUAL + acceptance) | **NOT STARTED** |
| M17-S7, M18+ | NOT STARTED |
| Hosted (Supabase / Vercel / deployment) | **NOT TOUCHED** |

## Environments

- **LOCAL**: disposable PostgreSQL **17.11** clusters (`out/m16-tools/pgsql`, git-ignored; `M16_PG17_BIN`), owned and torn down
  by each suite; the harness asserts `server_version_num` 17.x; pgvector stand-in (only the HNSW statement fails, asserted). Node
  24. No hosted database was contacted.
- **CI**: `M16 PostgreSQL 17 security suite` (PGDG PG17 + real pgvector; runs every `tests/postgres-m16/*.test.ts`, so the five
  new S4 suites) and `M15 PostgreSQL regression`, on the pushed branch. **CI on the exact final HEAD is the arbiter.**
- **HOSTED**: NOT TOUCHED. No `supabase db push`, no hosted `psql`, no Vercel change, no deployment, no env change.

## Migration, preflight, postflight

Exactly one additive migration: **`supabase/migrations/20261013160000_m17_s4_inherent_risk_assessment_v1.sql`** (the next free
timestamp after `20261013150000_m17_s3r1_…`). No historical migration edited; no corrective migration was needed.

**Preflight** (aborts with nothing applied): PG17 / `postgres` / READ COMMITTED; exactly 21 L15 tables and no
`l15_risk_assessment*` relation or S4 routine; the S2 resolver `l15_risk_methodology_valid_state_v1`, the S2 helper
`l15_assessment_validity_maximum_parts_v1`, the S3 contracts `l15_governed_risk_state_current_v1` /
`l15_governed_risk_valid_state_v1`, the S3 / S2 lock helpers, the M16 evaluators; the exact definitions of
`l15_governed_risk_states_kind_unique`, `l15_risk_methodology_states_kind_unique`, the methodology version tuple / level code /
rating-cell keys; S3R1 effective (lineage projection); the S2R1 root ALLOW guard owner-only SECURITY DEFINER with body
`ee7885…`; the reviewed S3 definer inventory hashes; surface 58 / 19 / 13 / intake 2; the D-01 envelope already carries
RISK_ASSESSMENT (permission mapping, `RISK_ASSESSMENT_*` reason codes, request-target shape); no RISK_ASSESSMENT governance history.
It snapshots every `gov_repo` constraint / non-internal trigger / routine (body, definer, config, ACL) / relation ACL and
row-hashes every `l14_*` / `l15_*` / canonical table. A second run fails safely (`M17_S4_PREFLIGHT`, proven).

**Postflight** (P1–P8, over the effective catalog after all grants): only the enumerated constraints changed
(`l14_command_results_shape_check`, `l14_command_results_l15_state_check`, `l15_support_links_owner_kind_check` / `_owner_shape_check` /
`_owner_target_matrix_check`, each dropped + re-added under the same name); new constraints only on the three new tables and the three
new support-link owner constraints; only `l15_support_link_insert_guard_v1` and `l15_command_result_state_guard_v1` bodies replaced
(owner-only invoker, S1 / S2 / S3 branches restated verbatim); no pre-existing relation ACL changed; every pre-existing L14 / L15 /
canonical row byte-identical (M16 history, shared envelope, S1 / S2 / S3 stores, F2); five M16 families, 11 kinds, 12 types, F2
without trigger / L15 FK; exactly four `l15_*_states` stores; ACL / definer surface (below); no S4 routine writes M16 / F2 / S2 / S3,
issues SET CONSTRAINTS or reads a legacy risk / score surface; **O31 catalog scan** (below); machine LOGINs still on the closed S1R1
surface; definer inventory (owner, body SHA-256, config).

## Store model

| Table | Role |
|---|---|
| `l15_risk_assessment_proposals` | immutable typed proposal over `l14_proposals` (FK `(org, proposal_id, subject_kind, intent)`) |
| `l15_risk_assessment_states` | immutable VALIDATED / REVOKED states; append-only lineage per logical key |
| `l15_risk_assessment_heads` | technical CAS pointer per logical key; RPC-maintained; reconstructible; never authority |

`l14_fact_states` / `l14_registry_states` / `l14_support_links` / M16 typed tables are NOT used or widened (asserted: zero L15 rows).
No fifth L15 family; S5 / S6 stores do not exist (asserted).

## Logical key and the GOVERNED_RISK pin

- **Logical key**: `organisation_id + governed_risk_state_id + assessment_basis` (heads PK; root / successor / revocation unique
  indexes keep the lineage linear). Never subject, scenario, domain, band, methodology or "latest risk". A successor GOVERNED_RISK
  state is a different key (O35).
- **Exact dependency pin**: the caller names only `governed_risk_state_id`; PostgreSQL copies the S3 dependency-key material
  (`subject_key`, scenario id / version / hash, scenario validated state) from that exact row and binds it with a composite FK onto
  **`l15_governed_risk_states_kind_unique`** (organisation + state + key + scenario pins + `VALIDATED`). A cross-tenant / tombstone /
  foreign-key-material binding is structurally impossible. No risk truth (subject, domain, closure) is copied; the authorization
  target is read from the pinned risk state.

## Methodology pin

The proposal pins `methodology_id + methodology_version_id + methodology_content_hash` (composite FK onto the admitted version tuple);
the VALIDATE decision resolves the exact VALIDATED methodology state with `l15_risk_methodology_valid_state_v1(org, id, version, hash,
effective_from, now)` and the state pins `methodology_validated_state_id` (composite FK onto
**`l15_risk_methodology_states_kind_unique`**). Never latest / by label / default / another version. A successor version never
repins; a methodology REVOKE makes the assessment not current at both coordinates without mutation; a later re-validation of the same
version (a new methodology state) does not revive it (the pin is the exact state id).

## Assessment outcome, levels, band

- `assessment_basis`: family vocabulary `INHERENT | RESIDUAL` (CHECK), plus a separately named executable CHECK
  `…_basis_executable_check (assessment_basis = 'INHERENT')` on proposals / states / heads — S6 widens exactly that constraint; the
  RPCs refuse RESIDUAL (`ASSESSMENT_BASIS_NOT_EXECUTABLE`). No executable RESIDUAL semantics exist.
- `assessment_outcome ∈ {RATED, INSUFFICIENT_EVIDENCE}` (CHECK). RATED: both level codes REQUIRED; INSUFFICIENT_EVIDENCE: no level, no
  band (CHECKs on proposal and state). No default level, no implicit LOW, no coercion.
- **Levels**: composite FKs `(org, methodology_version_id, likelihood_level_code)` / `(…, impact_level_code)` onto the PINNED version's
  scale tables, and `(org, version, likelihood, impact)` onto the rating-cell PK. No cross-version lookup, no ordinal, no fold, no
  nearest match (`l1`, `1`, `L1 ` all refused).
- **Rating band**: there is no band parameter on any RPC (a named `p_rating_band` argument is `42883`). The decide RPC derives it with
  `l15_risk_assessment_rating_band_v1` (exact cell lookup; 0 cells `RATING_CELL_UNRESOLVED`, > 1 `RATING_CELL_AMBIGUOUS`, both GV010)
  and the state guard re-derives it and refuses any other value (`RATING_BAND_NOT_DERIVED`, proven with owner-forged full chains). The
  fixture matrix is deliberately non-monotone (L1×I1 = CRITICAL, L4×I4 = LOW): no product / sum of ordinals can reproduce it, and all
  16 cells / four bands reproduce exactly (O32).

## Validity / expiry

Mandatory `valid_until` on every VALIDATED state (state CHECK `valid_until > effective_from`); `valid_until ≤
l15_assessment_validity_limit_v1(effective_from, maximum)` = `((effective_from AT TIME ZONE 'UTC') + maximum) AT TIME ZONE 'UTC'`
(the exact months → days → time components of the S2 helper, independent of the session TimeZone — proven across a Lisbon DST change).
Enforced at submit for an explicit start, authoritatively at decision and again by the state guard. Half-open `[effective_from,
valid_until)`; `valid_until` IS the effective end (no second `effective_to`). At `valid_until` the assessment is not current with no
UPDATE, no transition, no cron; an expired assessment cannot be REVOKEd (`REVOKE_AFTER_TARGET_EXPIRY`); renewal / correction is an
explicit successor that may begin before the predecessor's `valid_until` (M16 CONTROL_ASSESSMENT rule) and must change something
(`RISK_ASSESSMENT_ALREADY_VALIDATED`).

## Exact current resolver (the S6 contract) and the read projection

- `l15_risk_assessment_valid_state_v1(org, governed_risk_state_id, basis, effective_at, recorded_cutoff)` (owner-only invoker): a row only
  when ALL hold at the same coordinates — VALIDATED; INHERENT key; `effective_from ≤ at < valid_until`; no visible successor /
  revocation effective at `at`; exactly one candidate; **the pinned GOVERNED_RISK state is current**
  (`l15_governed_risk_state_current_v1`, which itself re-checks subject + scenario); **the pinned methodology state is exactly the one
  the S2 resolver returns**. Never selects a successor risk, a newer methodology or a replacement assessment.
- `l15_risk_assessment_state_current_v1(org, state_id, at, cutoff)` — the exact-state form S6 will pin.
- `l15_risk_assessment_resolution_v1` — closed: `CURRENT, NO_STATE, REVOKED, NOT_YET_EFFECTIVE, EXPIRED,
  GOVERNED_RISK_DEPENDENCY_INVALID, METHODOLOGY_DEPENDENCY_INVALID`.
- **`l15_read_risk_assessment_v1`** (service_role RPC, verified ACTIVE same-tenant member, read-only): `assessment_status ∈ {UNKNOWN, RATED,
  INSUFFICIENT_EVIDENCE}` + the resolution. **UNKNOWN** (no current valid INHERENT assessment of the exact risk state) returns every
  assessment field NULL — never LOW, 0, a default level or band. **INSUFFICIENT_EVIDENCE** returns the current governed state (no levels,
  no band) with its full lineage. **RATED** returns the exact levels + DB-derived band + lineage (state id, basis, methodology id /
  version / hash / validated state, interval, recorded_at, proposal, governance decision, authorization, Authority Policy id / version /
  hash, source class, support status). UNKNOWN is a read result only (never stored). An unknown / foreign risk state is refused
  (`GOVERNED_RISK_STATE_UNRESOLVED`), never answered. No lifecycle projection (S7).

## Authority and typed scope

`L15_RISK_ASSESSMENT_VALIDATE` (requested action = the exact outcome) under the CURRENT effective Authority Policy and CURRENT persisted
roles of the verified ACTIVE human; typed scope evaluated by the existing M16 evaluators against **the subject of the pinned
GOVERNED_RISK state** (CANONICAL_KIND / CANONICAL_OBJECT / RELATIONSHIP_TYPE / RELATIONSHIP_STATE; proven for each), never against the
assessment, methodology, band, domain or levels; CONTRIBUTING never authorizes; self-validation only with `allowSelfValidation`;
BACKDATED / FUTURE_DATED only with the rule flag. L14 / GOVERNED_RISK / methodology / scenario / treatment permissions, the legacy
GOVERNANCE_ADMIN wildcard and service_role never authorize. No RA rule → durable, replayable DENY; no bootstrap. No domain- /
rating-conditioned authority (D-09 deferred).

## Flow, locks, replay

- **Submit** (`l15_submit_risk_assessment_proposal_v1`): LOCAL_HUMAN only (`SYSTEM_SEED_NOT_ADMISSIBLE`,
  `SOURCE_CONNECTION_NOT_ADMISSIBLE` — the ADR admits SOURCE_CONNECTION intake for GOVERNED_RISK only; store CHECK `source_class =
  'LOCAL_HUMAN'`); writes `l14_proposals` + typed proposal + PROPOSAL support + durable `SUBMITTED`. Nothing else.
- **Decide** (`l15_decide_risk_assessment_proposal_v1`): VALIDATE → ALLOW → rule snapshots → governance decision → DECISION support →
  VALIDATED state (DB band) → head CAS → STATE support → durable result with `l15_state_id`; REJECT / DEFER → decision + result only;
  DENY → authorization + result only; REVOKE → exact current VALIDATED assessment only (REVOKED tombstone; shared code
  `RISK_ASSESSMENT_REVOKED`; no free-text / per-band reason).
- **Lock order** (deterministic, consistent with S3 / S2 / M16 CONTROL_ASSESSMENT): AP guard SHARED → (VALIDATE only) the pinned risk's
  scenario key SHARED (S2) → **the pinned GOVERNED_RISK logical key SHARED** (`frame_identity([org,'l15-governed-risk-key-guard-v1',
  subject_key, scenario_id])`, byte-identical to the S3 key taken EXCLUSIVELY by risk decisions) → **the pinned methodology
  VALIDATION key SHARED** (`frame_identity([org,'l15-registry-subject-guard-v1','RISK_METHODOLOGY','VALIDATION:id:version:hash'])`,
  byte-identical to the S2 key taken EXCLUSIVELY by methodology decisions) → the assessment key EXCLUSIVE
  (`l15-risk-assessment-key-guard-v1`) → command → replay arbitration → resolution → authority → mutation → final eligibility recheck. No
  new namespace for dependencies; REVOKE / REJECT / DEFER never wait on a dependency; independent keys never serialize.
- **Replay**: identity `organisation_id + command_id`; PostgreSQL recomputes the fingerprint (frame `L15_COMMAND_FINGERPRINT_V1`: risk
  state pin, basis, methodology tuple, outcome, both levels, effective intent, `valid_until`, expectation, target, prior, support — never
  a band); exact retry returns the ORIGINAL durable result; changed payload GV007; wrong caller fingerprint GV008; stale GV009; invalid
  GV010; continuity GV011; DENY durable and replayable; authority change needs a new command id. Golden vectors pinned in both the
  TypeScript mirror tests and the PG17 suite.
- **S2R1**: no S4 routine contains SET CONSTRAINTS; a plain COMMIT of an explicit service_role transaction fires the root ALLOW guard; a
  forged RISK_ASSESSMENT ALLOW is refused at COMMIT (`L15_ALLOW_WITHOUT_L15_AUTHORITY`).

## Support (D-03 extension) — SUPPORT ≠ DEPENDENCY

`l15_support_links` gains `owner_kind = RISK_ASSESSMENT` with `owner_risk_assessment_artifact ∈ {PROPOSAL, DECISION, STATE}` and typed owner
columns `owner_risk_assessment_proposal_id` / `owner_risk_assessment_state_id` (DECISION reuses `owner_governance_decision_id`; the guard
pins the decision's subject kind); explicit `artifact IS NOT NULL`. Targets: RISK_HYPOTHESIS, RISK_SIGNAL and every rank-0 tag (rank 3 →
2 / 1 / 0); no L15 governed artifact is a tag (acyclic). Same tenant (composite FKs), owner written by the same transaction, ≤ 64, no
duplicates, immutable; commit-time completeness guard. Existing S1 / S2 / S3 branches restated verbatim (each additionally requires the
new columns NULL, the same exclusivity widening S3 applied); pre-existing support rows and the S3 O44 projection are byte-identical after
S4 (proven on live S3 history). The governed-risk state and the methodology are **dependency pins** (NOT NULL typed columns + composite
FKs), never support: missing pins are refused even when the risk's own provenance or methodology evidence is cited, and citing another
risk's provenance never binds an assessment to it. The S3R1 support-currency projection is not redesigned (S7 owns read closure).

## O31 – O37

| Criterion | Status | Proof |
|---|---|---|
| O31 no numeric score | **PASS** | migration P6b + `m17-s4-methodology-matrix` O31: zero L15 columns named `*score*` / `*weight*` / `*percent*` / `*product*`; the only numeric L15 columns are the two S2 scale `ordinal`s and the two pre-existing S1 `hint_confidence` hints (see F-S4-1); the three S4 stores hold only uuid / text / timestamptz / char(64) (no json, array, interval, generated numeric); no S4 routine has a numeric / score argument or result; static scan |
| O32 band = pinned cell; caller band impossible | **PASS** | all 16 cells / 4 bands reproduce exactly (non-monotone matrix, not a function of product or sum); catalog-wide join finds no stored band ≠ cell; no band parameter (`42883`); forged chains with any other band refused by the state guard |
| O33 levels in the pinned scale only; IE carries none | **PASS** | attacks 29-36 (RPC + mirror) and owner-forged FK / CHECK refusals |
| O34 validity bound; expiry without UPDATE | **PASS** | boundaries =, <, max, max + 1 µs; IMMEDIATE re-check at decision; half-open expiry; row byte-identical; REVOKE after expiry GV011 |
| O35 no transfer to a successor risk state | **PASS** | supersession / REVOKE / scenario REVOKE: A1 byte-identical, not current, R2 reads UNKNOWN / NO_STATE until independently assessed; historical as-of resolves A1 |
| O36 UNKNOWN ≠ INSUFFICIENT_EVIDENCE ≠ RATED LOW | **PASS** | side-by-side reads; UNKNOWN exposes no content; revoked / expired / dependency-invalid read UNKNOWN with the closed reason |
| O37 band / level / hint / confidence / count never authorize; zero side effects | **PASS** | property test: 16 iterations, one per cell (all four bands), each citing 0–8 support entries drawn from machine signals of six hint severities (incl. `critical`, confidence 1.0) and hypotheses of six confidences: identical ALLOW + rule snapshot for the authorized actor, identical DENY reasons for unauthorized / out-of-scope actors; GOVERNED_RISK states / heads / proposals, M16, canonical, signals, hypotheses, registry states byte-identical; no treatment / acceptance store |

## ACL / definer surface (derived from PostgreSQL 17)

| Surface | Before (post-S3R1) | After |
|---|---|---|
| Application SECURITY DEFINER | 58 | **61** |
| L15 definers | 19 | **23** |
| service_role-executable L15 RPCs | 13 | **16** |
| Machine intake RPCs | 2 | **2** |
| L15 tables | 21 | **24** |
| service_role L15 table privileges | 0 | **0** |

New SECURITY DEFINERs (owner postgres, explicit `ALTER FUNCTION … OWNER TO postgres`, `search_path = pg_catalog, pg_temp`,
`lock_timeout 5s` on RPCs), inventoried in `apps/dashboard/tests/helpers/m17-l15-definer-inventory.ts` and asserted by postflight P8:

| Routine | EXECUTE | Body SHA-256 |
|---|---|---|
| `l15_submit_risk_assessment_proposal_v1` | service_role | `fb44d9beab311e29d11c5188f3831aa6200068856e9b276d8961f48e5dfb331b` |
| `l15_decide_risk_assessment_proposal_v1` | service_role | `d39a4505473f169f246bf40ff60749a73820cf8ab40e9e03117fd20ec6ceddda` |
| `l15_read_risk_assessment_v1` | service_role | `8ee008ad3911d82887c46d090a91fc3da84a345373dcab80350e34a6c856df66` |
| `l15_risk_assessment_commit_guard_v1` | none (deferred trigger) | `afed637992ab3fdf692e56d9409854283020d0f8214ffae70c4eae5187b87e37` |

Necessity: the L15 stores and the shared envelope carry no application privilege, so a bounded definer is the only write / read path;
the commit guard fires at COMMIT as the committing role, which holds no L15 privilege. Every helper / lock / resolver / projection is
SECURITY INVOKER and owner-only. Every new table: RLS on, `REVOKE ALL` from PUBLIC / anon / authenticated / service_role / the machine
capability; ENABLE ALWAYS raising UPDATE / DELETE / TRUNCATE on proposals and states (owner and replica role included); heads advance
only to the direct lineage successor; no FK cascade reaches L15 history.

## Files

- Migration: `supabase/migrations/20261013160000_m17_s4_inherent_risk_assessment_v1.sql`.
- Contracts: `packages/canonical-contracts/src/l15-risk-assessment.ts` (basis — architectural INHERENT | RESIDUAL, executable INHERENT —,
  outcome, band, pins, proposal, state, command result, resolutions, read status, discriminated read result; no numeric type).
- Mirror: `packages/governance-review/src/l15-risk-assessment.ts` (proposal / outcome / level shape in the RPC order, band-injection
  refusal, support parts, reason codes, submit / decide fingerprints). Preflight UX only; PostgreSQL is the arbiter.
- Server-only adapter: `apps/dashboard/lib/governance/l15-risk-assessment-persistence.ts` (no route / UI consumes it).
- PG17 suites (horizon `M17S4`): `m17-s4-risk-assessment.test.ts` (flow, targets, sources, authority / scope, no-rule DENY, replay,
  support, SUPPORT ≠ DEPENDENCY, band argument, O37 property, golden vectors), `m17-s4-methodology-matrix.test.ts` (O31 / O32 / O33,
  methodology pin attacks, successor / revoke), `m17-s4-temporal.test.ts` (M16 §17, O34, expiry, continuity, O35, O36),
  `m17-s4-risk-assessment-concurrency.test.ts` (real concurrent sessions), `m17-s4-security.test.ts` (surface, ACL, definer inventory,
  machine LOGIN, immutability, envelope, additivity on live S3 history); fixtures `tests/helpers/m17-s4-fixtures.ts`; horizon `M17S4`
  in `m16-l14-fixtures.ts` / `disposable-m16-postgres.ts` (older horizons unchanged).
- Static: `apps/dashboard/tests/m17-s4-static-acceptance.test.ts`; the S0 / S2 / S3 static horizon lists extended with the S4 migration
  (each documents "every later slice extends this exact list").
- Unit: `packages/canonical-contracts/test/l15-risk-assessment.test.mjs`, `packages/governance-review/test/l15-risk-assessment.test.ts`.

## Adversarial matrix (74 / 74 covered)

| # | Attack | Suite |
|---|---|---|
| 1 | VALIDATE without proposal | functional flow |
| 2–4 | nonexistent / REVOKED (tombstone, revoked, superseded) / foreign-tenant risk state | functional targets |
| 5, 6 | RESIDUAL; unknown / missing basis (RPC, read, DB CHECK) | functional targets |
| 7, 8 | SYSTEM_SEED / SOURCE_CONNECTION (+ forged envelopes) | functional sources |
| 9, 10 | machine intake submit / decide / read / resolve | security O14 |
| 11 | service_role without verified human | security O90, functional authority |
| 12 | no `L15_RISK_ASSESSMENT_VALIDATE` rule → durable DENY | functional no-rule |
| 13–16 | L14 / GOVERNED_RISK / methodology / treatment permission | functional authority |
| 17–19 | inactive user / org, revoked role, credential rotation during commit | concurrency |
| 20 | AP succession during commit | concurrency |
| 21 | self-validation without allowance | functional authority |
| 22–28 | wrong id / version / hash, not validated, revoked, foreign, future-effective methodology (+ revoked between submit and decide) | matrix |
| 29–36 | unknown / wrong-version / missing levels; IE with levels | matrix O33 |
| 37 | caller band (no argument `42883`; forged band refused) | functional, matrix |
| 38–42 | validity =, <, > max, = max; expiry at `valid_until` | temporal O34 |
| 43 | stale expected-current | functional replay |
| 44–46 | concurrent first / successor / VALIDATE vs REVOKE (both orders) | concurrency |
| 47 | risk REVOKE / supersession racing assessment VALIDATE (both orders) | concurrency |
| 48 | methodology REVOKE racing assessment VALIDATE (both orders) | concurrency |
| 49–51 | exact replay (+ concurrent), changed payload, wrong fingerprint | functional replay, concurrency |
| 52–54 | UPDATE / DELETE / TRUNCATE (owner, replica role) | security O62 |
| 55, 56 | cross-tenant support per class; governed artifact as support | functional support |
| 57, 58 | support instead of the risk / methodology pin | functional SUPPORT ≠ DEPENDENCY |
| 59, 62, 63 | no inheritance; risk invalidation without mutation; historical read | temporal O35 |
| 60, 61, 63 | methodology successor / revoke; historical read | matrix |
| 64, 65 | UNKNOWN ≠ LOW ≠ INSUFFICIENT_EVIDENCE | temporal O36 |
| 66 | all four bands exactly | matrix O32 |
| 67–71 | band / hint / confidence / count never authorize; risk state / head byte-identical | functional O37 |
| 72 | natural S2R1 commit + forged ALLOW | concurrency |
| 73 | machine surface exactly 2 | security |
| 74 | no legacy score / risk surface read | static, postflight P6 |

## Inherited invariants (re-proven on the post-S4 catalog)

O01 / O02 (11 kinds, 12 types, F2 untouched: static + postflight), O05 (exactly four `l15_*_states` stores possible; a fifth subject kind
refused), O07 / O74 (M16 history and envelope constraints byte-identical except the enumerated L15 result branch), O13 / O14 (machine
boundary), O53–O58 (authority evaluation), O59–O62 (ACL / definer profile, immutability), O63–O66 (temporal, replay, concurrency for this
family), O73–O78 (single AP root; envelope), O79–O82 / O84 (support matrix incl. the new owner), O90 (verified principal). No L15
bootstrap; no Passport family 17; no M16 fact family 6; no new canonical kind / relationship type.

## Tests (local)

| Suite | Result |
|---|---|
| S4 functional PG17 | 14 / 14 |
| S4 methodology / matrix PG17 | 7 / 7 |
| S4 temporal / expiry PG17 | 7 / 7 |
| S4 concurrency PG17 (real concurrent sessions) | 14 / 14 |
| S4 security / ACL PG17 | 9 / 9 |
| Full M16 PG17 (`tests/postgres-m16/*.test.ts`, 94 files incl. S0 / S1 / S1R1 / S2 / S2R1 / S3 / S3R1 / S4) | local Windows host: **1318 / 1324** — see note; CI (Linux): **success** |
| M15 PostgreSQL regression | 8 / 8 |
| canonical-contracts | 260 / 260 |
| governance-review | 430 / 430 |
| dashboard (`npm test` set, incl. S0 / S2 / S3 / S4 static) | 1260 pass, 0 fail, 5 pre-existing opt-in skips; passport-ui 17 / 17, pre-demo-ui 8 / 8, m17-s0-legacy 12 / 12 |
| typecheck (canonical-contracts, governance-review, scanner, graphos package, dashboard) | clean |
| `git diff --check` | clean |

`typecheck:graphos` (`graphos-complete/tsconfig.json`) fails with the same pre-existing errors on the untouched base commit `83642d4`
(e.g. `packages/scanner/src/exchange/purview.ts(29,162) TS1501`); not affected by S4.

**Local full-suite note.** A fully parallel local run (94 disposable clusters at once) produced 42 failures, all but 6 being
`psql` connection timeouts (`PGCONNECT_TIMEOUT=5`) from host saturation; rerunning the 21 affected files at `--test-concurrency=2`
passed 448 / 454. The remaining 6 (3 subtests + parents) are the "postflight negative controls" of `l14-policy-applicability-acl`,
`l14-control-applicability-acl` and `l14-control-assessment-acl`: those suites stop BEFORE their own M16 migrations (horizons S1C3 / S1C4 /
S1C5, far before M17) and their `
`-anchored regex probes do not match the `
` that `psql` returns on a Windows host — a
pre-existing local-host artifact, independent of S4. On Linux CI the whole suite passes.

**CI (exact pushed HEADs):**

| Commit | M16 PostgreSQL 17 security suite | M15 PostgreSQL regression |
|---|---|---|
| `f3eeeb6` (implementation) | **success** (run 38504396409) | **success** (run 38504396408) |
| final docs HEAD | re-verified by the same two workflows (see the final report) | — |

## Findings / dependency-deferred

- **F-S4-1 (pre-existing, non-blocking, for Closure)** — O31's wording "the only numeric columns are methodology scale `ordinal` values"
  vs the two S1 non-authoritative hint columns `l15_risk_signals.hint_confidence` / `l15_risk_hypotheses.hint_confidence` (`numeric`,
  0..1), which the ADR itself defines (§4.2 `source_hint`, §5.1 `hint_confidence`) as never read by authority / rating / lifecycle. S4
  adds no numeric column; the name scan is clean; the S4 postflight allow-lists exactly these four columns and fails on any other. ACP to
  confirm the reading at M17 Closure; no S4 change.
- **Observation (not changed)** — the pre-existing S3 GOVERNED_RISK branch of `l15_support_links_owner_shape_check` does not itself require
  `owner_governed_risk_artifact IS NOT NULL` (the insert guard refuses a NULL artifact). Restated verbatim to preserve S3 semantics; the
  new RISK_ASSESSMENT branch requires its artifact explicitly.
- **SOURCE_CONNECTION** is never admissible for RISK_ASSESSMENT (ADR: SOURCE_CONNECTION proposal intake is GOVERNED_RISK only).
- **RESIDUAL** basis, **treatment**, **acceptance**, lifecycle / Passport projections: **S5 / S6 / S7 — NOT STARTED.**
- No S0–S3 defect blocked S4; no corrective migration.

## Hosted

NOT TOUCHED. No hosted Supabase mutation, no Vercel change, no deployment.

## Next gate

ACP review of the M17-S4 branch delta (no PR opened). S5 is independent of S4; S6 depends on S4 + S5. Neither started.
