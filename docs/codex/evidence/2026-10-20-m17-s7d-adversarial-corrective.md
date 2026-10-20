# M17-S7D adversarial corrective

Date: 2026-10-20 (America/Sao_Paulo).

Status: **LOCALLY VERIFIED CORRECTIVE / AWAITING FINAL CI**.
M17: **OPEN / CORRECTIVE**. M17.5: **NOT STARTED / HOLD**.
No PR is authorized or opened. This document supersedes its prior architecture
STOP as the current S7D checkpoint; the prior STOP was correct at that time.

## Authorization and Git provenance

- Repository: `cnegrao/code-guard-governance`.
- Branch: `fix/m17-s7d-adversarial-corrective`.
- Required and verified clean starting HEAD: `fb47ef98bc1fdfbe786c315d24eed56f46114ea4`.
- Framework base, pinned throughout: `d2f575a29b590b1623b64ba8b4aaf0836fe3d504`.
- Historical local origin/main: `1914e7e2e18591000588ffab4325e61911fc2189`.
- The earlier independent adversarial report of **88 PASS / 1 FAIL / 2
  UNPROVEN** is user-supplied review provenance, not a newly executed review.

The architecture owner explicitly authorized C-M17-01's scalar precedence and
scope on 2026-10-20, instructed resumption of D1–D5, and authorized commit/push
without a PR. The decision is recorded additively in the
[owner-approved clarification](../../architecture/ADR-GOVIA-RISK-INTELLIGENCE-C-M17-01-CLARIFICATION-v1.md)
and linked from the architecture index. The frozen ADR and all historical
migrations remain unchanged. O01–O91 are not renumbered.

**Final closure requires O01–O91 PASS AND C-M17-01 PASS**, current-tree green
GitHub CI for O91, and the previously requested final independent adversarial
review. Historical S7C PASS prose does not establish these current-tree gates.

## F-M17-D1 / O56: all decision outcomes

The additive migration
`20261020031523_m17_s7d_adversarial_corrective_v1.sql` pins the six effective
decision bodies, then replaces only the evaluator operand
`p_outcome = 'VALIDATE' AND v_self` with the actual `v_self`. Both typed target
branches are corrected where applicable. Fingerprints, ordering, replay, CAS,
locks, temporal evaluation, dependencies and state writes remain intact.

The deferred owner-only `l15_authorization_allow_guard_v1` now also requires
an explicitly self-permitting rule on the actual matched permission, action,
source, source disposition, typed scope and Authority Policy basis snapshot.
An unrelated self grant cannot supply permission. The existing immediate
isolation guard already rejects mismatched permission/action snapshots; it is
preserved. M16 evaluators and M16 decision routines are unchanged.

ADMIT remains distinct: there is no proposal author to compare, no proposal ID
and no `is_self_validation` flag. This correction does not broaden ADMIT.

The DB matrix uses real verified-human service_role RPCs and normal validated
Authority Policy successors. Every cell covers self=false-permission DENY,
explicit matched allow=true success, and non-self success. DENY/ALLOW replay
returns the original durable IDs/timestamps with `replay=true`, adding no row.
DENY creates no governance decision and changes no L15 table (including
states, heads, proposals, support, signals and hypotheses).

| Family | VALIDATE | REJECT | DEFER | REVOKE | Replay / actual concurrent backends |
|---|---|---|---|---|---|
| RISK_SCENARIO_DEFINITION | PASS | PASS | PASS | PASS | PASS |
| RISK_METHODOLOGY | PASS | PASS | PASS | PASS | PASS |
| GOVERNED_RISK | PASS | PASS | PASS | PASS | PASS |
| RISK_ASSESSMENT | PASS | PASS | PASS | PASS | PASS |
| RISK_TREATMENT | PASS | PASS | PASS | PASS | PASS |
| RISK_ACCEPTANCE | PASS | PASS | PASS | PASS | PASS |

Each concurrency case observes `pg_stat_activity` and `pg_blocking_pids` from
an independent monitor while a non-self REJECT waits on the self-DENY
transaction; natural COMMIT releases it and exactly the permitted decision
succeeds. No trigger is disabled and no production routine is stubbed.
Adversarial shared-envelope fixtures additionally exercise false self grants,
wrong action, permission, source disposition and exact scope, with complete
rollback and no durable rows.

## F-M17-D2 / O71: real DB-backed hostile LLM boundary

`m17-s7d-boundaries-dispositions.test.ts` executes the production
`runL15LlmBoundaryStub` for `validated`, `accepted` and `closed` against a real
final PG17 fixture with evidence, a signal, a legitimate LLM_ASSISTED
hypothesis and a live GOVERNED_RISK proposal. Before/after content digests
cover **every L15 table, every shared L14 envelope/fact/registry table and
legacy evidence**, including heads, command results and support links.

All three outputs are inert. Raw DB calls bypassing the TypeScript mirror
reject the invented LLM_OUTPUT support tag, LLM text masquerading as a
DISCOVERY_EVIDENCE target and lowercase text masquerading as a decision
outcome. The actual machine login cannot execute a governance decision RPC.
All attempted injections leave those digests identical. No real LLM call or
provider credential is used.

## F-M17-D3 / C-M17-01 — Hypothesis disposition projection

The final `l15_read_hypothesis_dispositions_v1` retains its scalar return
contract, member/subject verification, metadata, stable listing order and
1000-row bound. Exact-tenant/exact-subject filtering selects hypotheses first.
Each result derives only from same-tenant, typed GOVERNED_RISK PROPOSAL links
to that **exact hypothesis ID**, then exact proposal/decision/state lineage.
A direct citation is governance use even if the citing risk has another
subject; this does not inherit dispositions between hypotheses or subjects.

Precedence is **GOVERNED_RISK > LIVE > REJECTED > UNREVIEWED**, exclusively as
the owner approved. Durable validated lineage survives later REVOKE. Only
VALIDATE-intent proposals participate. DEFER and a denied REJECT attempt stay
live; only terminal governance REJECT produces rejected disposition.

Executed cases cover unreviewed, rejected-only, rejected+live,
rejected+validated, DEFER, denied decision attempts, post-REVOKE provenance,
typed relationship subjects, exact tenant isolation and no AGENT/version or
relationship inheritance. RISK_ASSESSMENT, RISK_TREATMENT, RESIDUAL and
RISK_ACCEPTANCE citations are proven provenance-only through real validated
artifacts. A citing REVOKE-intent proposal does not promote its hypothesis.
Another subject's citation cannot poison the requested subject's read.

The projection is read-only and NON_AUTHORITATIVE. Tests compare content
digests around reads and preserve hypothesis row digests through all
governance uses. No disposition store/column, hypothesis mutation, ranking,
evidence creation, authorization or rating/treatment/acceptance change exists.

## F-M17-D4: five historical ordering checks and CI

The five stale exact-order checks are in S0 authority-contract and S2/S3/S4/S5
static acceptance. Their explicit expected migration tails now include S7A,
S7B, S7C and S7D. Deep equality and historical ordering remain mandatory;
there is no prefix-only check, filter, whitelist removal or weakened wildcard.
The eight static acceptance files plus S0 authority contract pass **37/37**.

The M16 PG17 workflow now runs that static selection after npm ci. Its
existing PostgreSQL tests glob already includes the new S7D DB proofs and the
final S7D security proof. Event triggers and deployment behavior are unchanged.

## O31 / O61: measured final SECURITY DEFINER inventory

The final disposable **PostgreSQL 17.11** catalog was remeasured after S7C and
the complete S7D corrective: **36 SECURITY DEFINER routines → 36**; eight body
changes, zero added/removed signatures, zero owner/config/ACL/capability delta.
The migration postflight independently checks the exact eight-body change set
and preserves all gov_repo routine metadata, including every M16 routine.
The test inventory records exact signatures, owners, body SHA-256 and config;
the full final proof checks explicit/effective ACLs and all L15 privilege rules.

| Changed routine | Measured final prosrc SHA-256 |
|---|---|
| `gov_repo.l15_authorization_allow_guard_v1` | `4771d840b4ee8a5fbaff1611a6993deabb962cd1d230d4cbb276a6ae1927b7af` |
| `gov_repo.l15_decide_governed_risk_proposal_v1` | `08e122bd32f3cb7eac8f65a08b0cc86da0dd6ee00323147182b73537d4997ca4` |
| `gov_repo.l15_decide_methodology_proposal_v1` | `e002ba81f82cd438004dd323dbf08c7e86719f53f32da1ec1a4fb07b4b6c97ca` |
| `gov_repo.l15_decide_risk_acceptance_proposal_v1` | `f11ef0c6f7e82f9692699834dc61f6777948f89795d69bdb6c2be295be57803f` |
| `gov_repo.l15_decide_risk_assessment_proposal_v1` | `c4f0a7801b5069e62b27251f9b4f791022aba6be276f9abe6cad89e5aed5f48f` |
| `gov_repo.l15_decide_risk_treatment_proposal_v1` | `06add2fbc7931571d6b25ee7ea58d49a18d255711e50f7bc4e418bf65dbbbc14` |
| `gov_repo.l15_decide_scenario_proposal_v1` | `b276fbe6c975c761733700d57826d4e778a66af88d9a02f16bcb8e4706911494` |
| `gov_repo.l15_read_hypothesis_dispositions_v1` | `51af8834a5e75e9b804721403d602656afea153c0d819af0bb39a06c1f9f4699` |

All eight remain owned by postgres with their prior configurations and ACLs.
The root guard remains owner-only; the decision/read RPCs retain service_role
EXECUTE; anon/authenticated gain nothing. The machine capability remains
exactly the two original intake RPCs, with zero direct L15 table privileges.

O31 retains exactly the five classified numeric columns and empty prohibited
Category 4. Only the already-reviewed disposition metadata consumer changes
body hash; it still returns hint_confidence as metadata without scoring or
selection. The new owner-approved semantics and measured hash are pinned in
the final proof. The S7A/S7B projection bodies are byte-identical. Historical
S7B security coverage is retained alongside the new final S7D horizon.

## Verification and attempt record

All PG17 checks use `M16_PG17_BIN=out/m16-tools/pgsql/bin`, independent
disposable clusters, actual PostgreSQL roles and automatic verified cleanup.
No hosted database is read or changed.

- Preflight PASS at the exact authorized branch/HEAD and pinned parent base;
  informative active-work target: 90 minutes. The sandbox initially blocked
  child Git creation; the approved escalated invocation succeeded.
- Static focused reproduction exposed stale tails. The corrected static
  selection passed 37/37; duration 803.0196 ms.
- Initial new DB proofs exposed fixture issues: expected replay=false on a
  retry, missing interactive SQL semicolons, one relative import path, expected
  unknown-tag vs unresolved-target error, and command-ID collisions between
  scenario/proposal or submit/decide fixtures. These were corrected without
  weakening runtime assertions or modifying a production invariant.
- Initial typecheck identified a four-argument call to the three-argument
  residual fixture. Explicit real submit/decide calls corrected it; subsequent
  `npm run typecheck:dashboard` PASS.
- The central forgery proof initially expected the deferred guard even for
  action/permission mismatches; those are correctly rejected earlier by the
  existing isolation guard. Expectations now identify each exact guard.
- Measurement script initially used top-level await under a CommonJS root;
  its async entrypoint fixed that tooling issue. PG17's default Program Files
  location was absent; locating the existing documented out/m16-tools binaries
  resolved the path without downloading or installing a dependency.
- The final security proof passed **3/3**, 41,134.9025 ms, across both horizons.
- Focused O71 and disposition behavior passed before final verification.
- Final selected candidate verification: **83/83 PASS, 0 FAIL, 0 SKIP**,
  **192,942.6485 ms**. This includes all six four-outcome self-decision matrices,
  replay, six real concurrency cases, the ADMIT boundary, central forgery
  attacks, O71, C-M17-01, both security horizons and all 37 static checks.
- Candidate-ready S7A/S7B integration: **5/5 PASS**, **92,332.3895 ms**.
  These existing tests retain their historical S7A/S7B migration horizons;
  the final S7D catalog proof separately pins their unchanged projection bodies.
  This is focused regression evidence, not a claim of current-tree global O91.
- Final dashboard typecheck: **PASS**. No canonical-contract, governance-review,
  GraphOS runtime or dashboard product code changed.
- One delta inspection confirmed the narrow eight-routine corrective, retained
  historical order comparisons, unchanged workflow triggers and no historical
  migration diff. `git diff --check` PASS. No full regression was repeated.

Reproducible final selection (from repository root, Node 24):

```powershell
$env:M16_PG17_BIN='D:\code-guard-governance\out\m16-tools\pgsql\bin'
node --conditions=react-server --import tsx --test apps/dashboard/tests/postgres-m16/m17-s7d-self-decision.test.ts apps/dashboard/tests/postgres-m16/m17-s7d-boundaries-dispositions.test.ts apps/dashboard/tests/postgres-m16/m17-final-security-closure.test.ts apps/dashboard/tests/m17-s0-authority-contract.test.ts 'apps/dashboard/tests/m17-s*-static-acceptance.test.ts'
npm run typecheck:dashboard
```

Integration selection: the same Node conditions/import with
`m17-s7a-lifecycle.test.ts`, `m17-s7a-projections.test.ts` and
`m17-s7b-passport-overlay.test.ts` under `apps/dashboard/tests/postgres-m16/`.
Ignored raw logs are in `.artifacts/agent/s7d-final.log`,
`s7d-integration.log`, `s7d-typecheck-final.log`, and `s7d-definers.json`.

| Corrective closure item | Local result | Remaining gate |
|---|---|---|
| F-M17-D1 / O56 | PASS | Independent CI/review |
| F-M17-D2 / O71 | PASS | Independent CI/review |
| F-M17-D3 / C-M17-01 | PASS under explicit owner-approved clarification | Independent CI/review |
| F-M17-D4 / five static files | PASS; exact ordering retained; CI coverage added | Independent CI |
| O31 / O61 preservation | PASS; exact final catalog and ACLs measured | Independent CI |
| F-M17-D5 / O91 | **AWAITING FINAL CI** | Green GitHub runs for this committed tree |

Framework limitation: `verify.mjs`/`handoff.mjs` classify every workflow edit
as hosted/deployment scope. The narrow CI coverage edit is explicitly
authorized by D4, so direct existing Node test commands supply the validation;
the guard itself is not edited or bypassed inside the tool. External runs are
recorded as external validation, not invented framework events. The earlier
verify invocation without the pinned --base was rejected before execution and
corrected; no session/base or attempt history was reset.
The official integration handoff invocation was also attempted and rejected
for that same workflow path. Supplemental external-results checkpoints are
recorded in ignored `.artifacts/agent/s7d-handoff.md`.

Platform-reported active working time is unavailable. Test durations above
are measured runner durations; wall-clock time is not substituted for active
work. This is one corrective objective, with no full-regression loop and no
review-of-review loop.

## Other adversarial findings and remaining gates

| Finding | S7D treatment |
|---|---|
| F7 final M16 catalog regression breadth | Migration postflight preserves every unrelated gov_repo routine's body/signature/owner/config/ACL. Final security and selected S7A M16 projections supply focused evidence; broad PG17 remains the CI gate. |
| F8 Passport distinction/presentation | No overlay mapping or design is changed. Lifecycle/projection/overlay integration is selected; UNKNOWN is not treated as proof of a collapsed distinction. |
| F9 vacuous/overstated tests | New proofs use DB content digests, real typed artifacts, precise failure reasons, natural COMMIT and observed lock contention. Historical PASS prose is not reused as current-tree O91 proof. |
| F10–F13 | Individual details are absent from the supplied finding record; no unrelated hardening/runtime redesign is invented or claimed complete. |

F-M17-D5 / **O91: AWAITING FINAL CI**. A read-only GitHub query found no runs
for this branch before push; the remote start still matched `fb47ef9`.
Historical PR #79/#80 CI is not proof
of this candidate. Feature-branch pushes do not trigger these heavy workflows;
no manual dispatch or PR is performed under this instruction. Final
independent adversarial review is not claimed or replaced by a self-review.

Candidate completion is commit/push only. No hosted Supabase/Vercel mutation,
deployment, production change, PR or merge occurs. M17 remains OPEN /
CORRECTIVE, and M17.5 remains NOT STARTED / HOLD.
