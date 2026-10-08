# M16-S1B.4 — POLICY_VERSION Governance Validation

Starting point: `origin/main` = `e145046ef0ff20d8846bc6e3bce80f84aa50b611` (the merge of PR #53,
`feat/m16-s1b3-policy-admission`). Branch `feat/m16-s1b4-policy-version-validation` was created from exactly that
commit with a clean worktree. Architecture authority: `docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md`
§§4, 6-7, 9, 13, 16-18, 20-21, 23, the frozen S1B decisions (D-1..D-14) and the S1B.1R1 interval ruling.

## Recorded state

| Item | State |
|---|---|
| PR #53 (`feat/m16-s1b3-policy-admission`) | MERGED (`e145046`) |
| S1B.3 | MERGED |
| `main` baseline at S1B.4 start | `e145046ef0ff20d8846bc6e3bce80f84aa50b611` |
| S1B.4 | IMPLEMENTED ON BRANCH `feat/m16-s1b4-policy-version-validation`; NOT MERGED |
| M17+ | NOT STARTED |
| H1 | CLOSED ON EQUIVALENT HOSTED EVIDENCE |
| `B0_HTTP_MANUAL_ACCEPTANCE` | PASS |
| `REAL_HTTP_H1_PASS` | NOT EMITTED |

## Environments — LOCAL / CI versus HOSTED

- **LOCAL**: disposable PostgreSQL **17.10** clusters (upstream PostgreSQL 17.10 server binaries from the npm
  registry package `@embedded-postgres/linux-x64@17.10.0-beta.17`, because the PGDG apt host is blocked by the cloud
  session's network policy; `psql` is the local PostgreSQL 16 client), passed to the existing harness as
  `M16_PG17_BIN` and run as an unprivileged OS user. The harness asserts `server_version_num` is 17.x. pgvector is
  not installed locally, so the harness's labelled stand-in type is used (only the HNSW index statement may
  fail). M15 regression ran on the local PostgreSQL 16 install, as its CI job uses the runner default.
- **CI**: GitHub Actions `M16 PostgreSQL 17 security suite` (PGDG PostgreSQL 17 + real pgvector) and
  `M15 PostgreSQL regression` on the pushed branch head (see "CI").
- **HOSTED**: NOT TOUCHED. No Supabase hosted project (TEST / DEV / production), no Vercel, no deployment, no
  hosted fixture or environment change. **No hosted S1B.4 claim is made.**

## Implementation

One additive migration, `supabase/migrations/20261008120000_m16_s1b4_policy_version_validation_v1.sql`; no
historical migration edited.

- **Governed subject**: the exact S1B.3-admitted tuple `organisation_id + policy_id + version_id + content_hash`.
  Every S1B.4 structure carries two non-cascading FKs: to `l14_policy_version_admissions (organisation, policy,
  version)` and to the store key `policy_versions (organisation, policy, version, content_hash)`. A legacy-only,
  foreign or mismatched tuple is rejected with `GV010 POLICY_VERSION_NOT_ADMITTED`.
- **Preflight** aborts atomically unless the exact merged S1B.3 catalog is present: the S1B.3 l14 relation set,
  admission lineage keys / guard, the 25 approved definers with exact owner / body hash / config (including the
  S1B.3 descriptor read), the closed 25 surface, and no pre-existing POLICY_VERSION governance history.
- **New immutable structures** (RLS on, zero application privilege, no RLS policy, `ENABLE ALWAYS` raising
  UPDATE/DELETE/TRUNCATE triggers, no JSON, no free text, every text column a closed vocabulary):
  `l14_policy_version_proposals` (typed proposal detail: intent, tuple, requested_effective_from,
  target_state_id = exact VALIDATED state of the same tuple for REVOKE) and `l14_policy_version_states` (typed
  state detail over `l14_registry_states`: linear, same-tuple, alternating VALIDATED → REVOKED → VALIDATED).
- **Technical head** `l14_policy_version_heads`: compare-and-set pointer only, created empty by the first
  state-appending decision (never by a proposal), advanced only to the direct lineage successor, never
  deleted, reconstructible as the lineage tail.
- **Source class**: the proposal envelope and state envelope source class must equal the S1B.3 admission
  lineage source class (RPC check `SOURCE_CLASS_LINEAGE_MISMATCH` + structural guards).
- **Resolver** `l14_policy_version_valid_state_v1(org, policy, version, hash, effective_at, recorded_cutoff)`
  (owner-only): the exact VALIDATED state valid at both coordinates; no row otherwise; ambiguity fails closed;
  never another / latest version or a legacy pointer. `l14_policy_version_validation_condition_v1` (owner-only)
  projects NOT_VALIDATED | VALIDATED | REVOKED at one instant.
- **RPCs** (SECURITY DEFINER, owner `postgres`, `search_path=pg_catalog, pg_temp`, `lock_timeout=5s`, EXECUTE =
  `service_role` only): `l14_submit_policy_version_proposal_v1` (any verified active member; no decision /
  state / head / content change) and `l14_decide_policy_version_proposal_v1` (`L14_POLICY_VERSION_VALIDATE`,
  requested action = exact outcome, current locked roles, current effective Authority Policy, self / future /
  back dating only per the matched rule, same-transaction final eligibility recheck). VALIDATE intent:
  VALIDATE / REJECT / DEFER; REVOKE intent: REVOKE / REJECT / DEFER; DEFER non-terminal; correction = new
  proposal + `prior_proposal_id` of the same tuple.
- **Interval rules** (S1B.1R1): REVOKE `effective_from >= target.effective_from` (equality = cancellation from
  the start); re-validation `effective_from >= tombstone.effective_from`; a second VALIDATED over a VALIDATED
  head is `POLICY_VERSION_ALREADY_VALIDATED`.
- **Descriptor read** `l14_read_policy_descriptors_v1`: replaced in place (same identity and arguments; DROP +
  CREATE in the same transaction because the return shape gains `validation_state_id`,
  `validation_effective_from`, `latest_validation_state_id`). It now projects the CURRENT governed condition;
  a future-dated VALIDATED state is NOT_VALIDATED until effective. Still never a content body or legacy field.
- **TypeScript**: `packages/canonical-contracts/src/l14-policy-version-validation.ts`,
  `packages/governance-review/src/l14-policy-version-validation.ts` (byte-for-byte fingerprint mirror),
  server-only `apps/dashboard/lib/governance/l14-policy-version-validation-persistence.ts`; the S1B.3
  descriptor contract / mapping gains the three traceability fields. No HTTP route, no UI.

## Security definer surface (effective catalog)

| | Before (merged S1B.3) | After (S1B.4) |
|---|---|---|
| Approved application SECURITY DEFINER routines | 25 | 27 |
| Policy-store-capable (canonical `postgres` owner) | 15 | 17 |

New: `l14_submit_policy_version_proposal_v1`, `l14_decide_policy_version_proposal_v1`. Replaced in place (same
identity, new body hash pinned): `l14_read_policy_descriptors_v1`. The 17 count was confirmed from the live
catalog (the postflight derives the capable-owner set from role membership / privileges, not from a constant).

## Tests (LOCAL)

| Suite (command) | Pass | Fail | Skip |
|---|---|---|---|
| New S1B.4 PG17 functional, `tests/postgres-m16/l14-policy-version-validation.test.ts` | 12 | 0 | 0 |
| New S1B.4 PG17 concurrency, `tests/postgres-m16/l14-policy-version-validation-concurrency.test.ts` | 14 | 0 | 0 |
| New S1B.4 PG17 ACL / preflight / postflight controls, `tests/postgres-m16/l14-policy-version-validation-acl.test.ts` | 9 | 0 | 0 |
| Complete M16 PG17 suite, `node --conditions=react-server --import tsx --test tests/postgres-m16/*.test.ts` (49 files, incl. every S1B.3 / S1B.1 suite) | 845 | 0 | 0 |
| M15 PostgreSQL regression, `npm run test:postgres --workspace codeguard-os` (local PG16) | 8 | 0 | 0 |
| Dashboard TS suite, `npm test` (apps/dashboard; incl. the new S1B.4 contract test) | 1175 + 15 + 8 | 0 | 5 (pre-existing) |
| `@council/governance-review` tests (`tsx --test test/*.test.ts`) | 412 | 0 | 0 |
| `@council/canonical-contracts` tests (`node --test test/*.mjs`) | 230 | 0 | 0 |
| Typecheck: dashboard, canonical-contracts, governance-review (`tsc --noEmit`) | clean | | |
| `git diff --check origin/main...HEAD`; secret-pattern scan of the branch diff | clean | | |

The two package `test` scripts pass `--test-isolation=none`, which the container's Node 22.22 rejects; the same
files were run without that flag (environment limitation only, not CI-gated). `next build` was not run: no
route, page or component imports the changed TypeScript (proven by the contract tests), and `tsc` is clean.

Historical tests: S1B.3 PG17 suites keep their `S1B3` horizon (exact merged S1B.3 catalog, unchanged
expectations). Two database-free TS assertions superseded by the frozen S1B.4 contract were updated to the new
exact sets (still exact equality): the shared descriptor validation vocabulary / descriptor key set in
`l14-policy-admission-contract.test.ts`, and the L14 TypeScript file list in `l14-policy-store-contract.test.ts`
(as S1B.3 did for its own files).

## Invariants

- F2: NOT TOUCHED (no canonical_relationships DDL/DML/FK/trigger; structural digest identical).
- CanonicalObjectKind = 11; GovernedRelationshipType = 12; no POLICY kind, no APPLIES_POLICY.
- No POLICY_APPLICABILITY, no store / admission-lineage write, no legacy status / approval / QES /
  `current_version_id` read or write; VALIDATED trust exists only in governed state.

## CI

| Workflow | Run | HEAD | Result |
|---|---|---|---|
| M16 PostgreSQL 17 security suite | [37780210549](https://github.com/cnegrao/code-guard-governance/actions/runs/37780210549) | `237b00d` | success — 845 pass / 0 fail / 0 skip (PGDG PostgreSQL 17, real pgvector) |
| M15 PostgreSQL regression | [37780210544](https://github.com/cnegrao/code-guard-governance/actions/runs/37780210544) | `237b00d` | success |

`237b00d` is the last implementation commit; this docs-only commit re-runs both workflows on the branch head.
