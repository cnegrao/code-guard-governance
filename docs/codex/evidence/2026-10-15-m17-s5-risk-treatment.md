# M17-S5 RISK_TREATMENT — implementation evidence

Branch: `feat/m17-s5-risk-treatment`. Base: `4e2d0efc257c271b1359f22af031b23b771222cd`.
Additive migration: `20261015122639_m17_s5_risk_treatment_v1.sql`.
This records execution of the accepted S5 contract; it changes no frozen architecture semantics.

## Delivered behavior

- Five stores: proposals, states, heads, normalized proposal control pins, normalized state control pins.
- Typed contracts, fingerprint/review mirrors, server-only persistence, submit/decide/read RPCs, valid/current/resolution helpers,
  command-result projection, support writer, treatment-key and dependency guards.
- Existing `L15_RISK_TREATMENT_VALIDATE` authority; exact governed-risk-state and responsible GovernanceParty validated-state dependencies.
  MITIGATE may pin zero or more validated control-definition versions. S5 installs on the S3-only horizon without S4.
- The key is `(governed_risk_state_id, treatment_option, treatment_ordinal_key)`. Options are MITIGATE, AVOID, TRANSFER;
  implementation statuses are PLANNED, IMPLEMENTED. The target implementation date is planning metadata.
- IMPLEMENTED is a new VALIDATED state with its own decision and required evidence. Prior state, support and pins remain unchanged.
- Dependency invalidation produces a non-current read naming the failing dependency kind and exact state ID. It never repins,
  mutates history or transfers treatment to a successor governed-risk state. REVOKE remains available after invalidation.
- Revocation reasons are exactly TREATMENT_FAILED, TREATMENT_WITHDRAWN, RECORDED_IN_ERROR.
- Shared changes are confined to the treatment branches of `l15_support_links`, its existing insert guard, `l14_command_results`
  constraints and its existing state guard. The existing Authority Policy root body/config/ACL/owner/security mode is preserved.
- Three service-role RPCs; stores and internal helpers remain inaccessible to application roles. Four new SECURITY DEFINER routines
  are covered by the body/config/ACL inventory (three RPCs plus the owner-only deferred integrity guard).

No S6, residual assessment, acceptance, Passport, M16 fact-family, canonical kind/type, canonical relationship/F2, historical migration,
hosted database or deployment change. Naming controls creates no M16 applicability, assessment or state.

## Contract acceptance and verification coverage

| Acceptance | Result and executable evidence |
|---|---|
| O46 | PASS. Three accepted options, two statuses, rejected ACCEPT/WAIVED/VERIFIED/FAILED vocabulary, planning date without expiry. |
| O47 | PASS. Separate IMPLEMENTED successor/decision, evidence required, predecessor/support/pins byte-identical, no M16/canonical writes. |
| O48 | PASS. Exact risk, party and control dependencies; 0..n pins; invalidation and revalidation do not repin; reads name the failed pin; historical as-of and post-invalidation REVOKE. |

The main PostgreSQL file is `apps/dashboard/tests/postgres-m16/m17-s5-risk-treatment.test.ts` (28 tests, including its parent).
The temporal/concurrency file covers independent effective/recorded coordinates, future successor/revoke, microsecond half-open expiry,
authorized backdating, stale-key races, successor fork prevention, identical-command replay, independent ordinal keys, and real blocking
between each dependency's revocation and treatment validation. Blocking is observed through PostgreSQL backend/lock views.

Security covers the complete L15 definer inventory and ACL profile, owner UPDATE/DELETE/TRUNCATE rejection, late pin/support insertion,
verified credentials/session/tenant enforcement, temporary-type shadowing, preserved pre-existing S4 rows and a working S4 REVOKE after S5.
The S4 support comparison freezes all pre-S5 columns before adding the nullable treatment-owner columns and separately verifies that
those new columns are NULL for S4 history. This avoids mistaking a changed composite-row shape for changed historical values.

## Local verification

Node 24.19.0; disposable PostgreSQL 17.11 for S5/M16; existing disposable PostgreSQL 16 harness for M15.
Counts below use Node's reported test totals, including parent tests. Reused evidence is not added twice as unique coverage.

| Phase/check | Passing tests | Measured command duration |
|---|---:|---:|
| Focused S5 migration | 1/1 | 18.845 s |
| Focused S5 main flow | 28/28 | 54.442 s |
| Focused S5 temporal/concurrency | 12/12 | 81.473 s |
| Focused S5 security/S4 preservation | 13/13 | 52.271 s |
| Focused S5 static | 3/3 | Shared 0.396 s command with the initial adapter loader failure |
| Focused S5 persistence adapter | 5/5 | 0.721 s |
| Focused S5 governance review | 12/12 | 0.349 s |
| Focused S5 canonical contracts | 3/3 | 0.097 s |
| Candidate-ready integration, one invocation | 47/47 + dashboard typecheck | 83.423 s |

Focused coverage totals **77 unique passing tests**. Canonical-contracts, governance-review and dashboard typechecks passed.
Integration rechecked migration (1), main flow (28), S0 authority contract (4), S2/S3/S4 exact migration-tail/static acceptance (14).
The main flow and S3-only installation were rechecked because the SQL temporal cutoff and final pin-integrity guards had changed.
Already-passing security and temporal/concurrency selections were reused without another run.

The single final invocation passed **918/918 tests**, with zero failures or skips:

| Final selection | Passing tests | Measured command duration |
|---|---:|---:|
| canonical-contracts package | 263/263 | 1.004 s |
| governance-review package | 442/442 | 1.565 s |
| M15 PostgreSQL regression | 8/8 | 9.322 s |
| M16 Authority Policy ACL | 22/22 | 36.176 s |
| M16 GovernanceParty functional | 21/21 | 81.824 s |
| M16 GovernanceParty ACL | 21/21 | 31.753 s |
| M16 ControlDefinition functional | 20/20 | 76.904 s |
| M16 ControlDefinition ACL | 9/9 | 37.888 s |
| M16 party dependency guard | 8/8 | 39.609 s |
| S3 four PostgreSQL files | 53/53 | 140.826 s |
| S4 five PostgreSQL files | 51/51 | 133.444 s |

The six M16 files total **101/101**, measured **304.153 s**. The integration invocation was
`7dc8fc0c-4baf-4ab6-be15-3cf7d32bb66c`; the final invocation was `7fe8edc6-bf88-4fe6-af82-81ae6a212ca6`.
Framework-measured verification command totals (including focused failures and typechecks):
**focused 468,391.7633 ms; integration 83,423.1944 ms; final 590,313.676 ms; total 1,142,128.6337 ms (19m 02.129s)**.
These are measured subprocess durations, not Codex UI working time. No full-suite retry loop was run.
Only execution evidence/status documentation changed after the final verification began; the tested implementation and tests did not.

## Attempt history and limits

The preserved framework session is `9b5813d6-1176-4c7d-af9f-ce9e27e5d898` (90-minute informative active-work target).
Focused verification command time, including failed attempts and typechecks, is **468,391.7633 ms**.
Each retry followed new evidence and a concrete fix:

1. The default PG17 path did not exist; used the already-present `out/m16-tools/pgsql/bin` binaries.
2. Scenario and governed-risk fixtures reused a command identifier; separated those identifiers.
3. A default recorded cutoff incorrectly followed the effective instant; made the default an independent database-now cutoff.
4. Interactive fixture PID queries lacked statement terminators; corrected them and asserted backend IDs/monitor errors.
5. A fixture reused JSON timestamp formatting where canonical six-digit UTC was required; canonicalized through the existing DB helper.
6. S4 support digest included newly added nullable columns, and FK checks preempted TRUNCATE triggers; froze the old-column projection
   and used transactional TRUNCATE CASCADE to exercise immutability.
7. Dashboard's CJS transform rejected top-level await in the adapter test; used the established async `before` hook pattern.

The existing Windows PG17 harness has no pgvector extension and uses its documented disposable vector-type stand-in; the unrelated HNSW
index statement is the expected exception. No application governance routine/table is stubbed. The final M16 selection is scoped,
not a claim that the entire historical M16 suite ran. Historical suites retain their original migration horizons; S5-specific tests
exercise the complete post-S5 catalog and its live party/control/S4 writers.

Codex UI working time is unavailable. Framework wall-clock telemetry includes approval/user idle periods and is not active working time.
The local logs, helper scripts and generated reports under `.artifacts/agent/` remain ignored working artifacts, excluded from the commit.
CI is not claimed: no PR is opened, and the heavy M15/M16 workflows do not run on feature-branch pushes.

## Substantive file set

- `supabase/migrations/20261015122639_m17_s5_risk_treatment_v1.sql`.
- `packages/canonical-contracts/src/l15-risk-treatment.ts`, `src/index.ts`, `test/l15-risk-treatment.test.mjs`, `package.json`.
- `packages/governance-review/src/l15-risk-treatment.ts`, `src/index.ts`, `test/l15-risk-treatment.test.ts`.
- `apps/dashboard/lib/governance/l15-risk-treatment-persistence.ts`.
- `apps/dashboard/tests/helpers/{disposable-m16-postgres,m16-l14-fixtures,m17-l15-definer-inventory,m17-s5-fixtures}.ts`.
- `apps/dashboard/tests/m17-s5-{persistence,static-acceptance}.test.ts`.
- `apps/dashboard/tests/postgres-m16/m17-s5-{migration,risk-treatment,security,temporal-concurrency}.test.ts`.
- `apps/dashboard/tests/m17-s0-authority-contract.test.ts` and `m17-s{2,3,4}-static-acceptance.test.ts` (explicit migration tails).
- This evidence file and only the S5 execution-status entry in `docs/architecture/GOVIA-L0L16-CIA-v1.0-roadmap.md`.

## Handoff

Implementation, focused coverage, candidate-ready integration and the one final selection are complete. O46/O47/O48 PASS.
No architecture or implementation blocker remains. The next action after the authorized commit/push is review of the S5 branch;
opening a PR is outside this request. Historical migrations remain unchanged, and the generated dashboard typecheck cache was restored.

## ACP O47 correction — planned before implemented

ACP found that the initial delivery at `9100cb691de2aca9d8a5b505cec3a89448c14ec3` allowed a root IMPLEMENTED state.
The original passing counts above did not cover that invalid transition. This corrective delta enforces frozen §15.1 / O47:

- The state-table CHECK `l15_risk_treatment_implementation_predecessor_check` requires a non-null predecessor for IMPLEMENTED.
  Together with the existing closed status/state shape checks, the first VALIDATED state must be PLANNED.
- The existing state insert guard requires the referenced predecessor, in the same organisation and treatment key, to be
  `state_kind = 'VALIDATED' AND implementation_status = 'PLANNED'`; otherwise it raises `IMPLEMENTATION_PREDECESSOR_NOT_PLANNED`.
- The submit RPC and TypeScript proposal/VALIDATE-decision mirrors reject missing predecessor expectations with
  `IMPLEMENTATION_PREDECESSOR_REQUIRED`. PostgreSQL resolves the predecessor's persisted status; no new client-trusted status operand.
- The submit definer inventory hash is updated. No new status, RPC parameter, permission, dependency, store or shared-surface rule.
  This amends the branch's unmerged S5 migration; no migration from the accepted main base is edited.

Targeted correction verification: **52/52 tests, zero failures/skips** — canonical-contracts 3, governance-review 14,
S5 static acceptance 3, S5 main PostgreSQL flow 32 (including its parent). The main flow explicitly covers root PLANNED success,
root IMPLEMENTED rejection, PLANNED → IMPLEMENTED success, direct state insertion rejection, the actual CHECK copied to a
temporary table independently of triggers, and rejection after either IMPLEMENTED or REVOKED predecessors with no partial result/history change.
Canonical-contracts, governance-review and dashboard typechecks all pass; `git diff --check` passes.

Focused run: `2578f701-7cb9-4c99-80b6-28b4456645a7`, **13,759.0443 ms** including typechecks.
Targeted PostgreSQL integration: `7c995395-16fc-4fdd-a566-392395358f68`, **68,041.9462 ms**.
Total correction verification: **81,800.9905 ms**. No failed attempt or retry. The previous 918-test selection was not rerun;
PR CI remains the independent M15/M16 repository gate. No blocker remains; the same branch is pushed with a separate corrective commit, without a PR.
