# M16-S1B.3 — Policy Content Admission

Starting point: `origin/main` = `9875208d0fd60105a7508572d5058235ca0751de` (the merge of PR #52,
`feat/m16-s1b-governed-registries`). Branch `feat/m16-s1b3-policy-admission` was created from exactly that
commit; the only pre-existing local residue (`apps/dashboard/tsconfig.tsbuildinfo`, generated) was restored
before branching. Architecture authority: `docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md`
plus the frozen S1B.3 ACP rulings (D-4, change_summary, definer surface 22 → 25 / 12 → 15).

## Recorded state

| Item | State |
|---|---|
| PR #52 (`feat/m16-s1b-governed-registries`) | MERGED (`9875208`) |
| `main` baseline for S1B.3 | `9875208d0fd60105a7508572d5058235ca0751de` |
| S1B2-H1 (Data API / max_rows / real HTTP acceptance) | CLOSED ON EQUIVALENT HOSTED EVIDENCE (ACP ruling, on the real hosted manual HTTP acceptance) |
| Hosted HTTP acceptance | Real hosted manual HTTP acceptance was performed: `B0_HTTP_MANUAL_ACCEPTANCE = PASS` |
| `REAL_HTTP_H1_PASS` | NOT EMITTED — the frozen canonical runner was not literally executed |
| S1B.3 | IMPLEMENTED ON BRANCH `feat/m16-s1b3-policy-admission`; NOT MERGED |
| S1B2-I1 (controlled policy descriptor read) | Implemented on the branch as `gov_repo.l14_read_policy_descriptors_v1`; not merged |

## Environments — LOCAL / CI versus HOSTED

- **LOCAL**: disposable PostgreSQL 17.8 clusters (official EDB Windows binaries, run as `M16_PG17_BIN`) created
  and destroyed by the existing harness; pgvector not installed locally, so the harness's labelled stand-in
  type is used and the single HNSW index statement is the only statement allowed to fail. M15 regression ran
  on the local PostgreSQL 16 install, exactly as its CI job uses the runner default.
- **CI**: GitHub Actions `M16 PostgreSQL 17 security suite` (PGDG PostgreSQL 17 + real pgvector) and
  `M15 PostgreSQL regression` on the pushed branch head (see "CI" below).
- **HOSTED**: NOT TOUCHED. No Supabase hosted project (TEST / DEV / production), no Vercel, no deployment, no
  hosted fixture or environment change. **No hosted S1B.3 claim is made.** The S1B.3 migration has been
  executed only against disposable local / CI clusters.

## Implementation

One additive migration, `supabase/migrations/20261007120000_m16_s1b3_policy_admission_v1.sql`; no historical
migration edited, no existing routine replaced.

- **Preflight** aborts atomically unless the exact S1B.2 / R1 / R2 / R3 baseline is present: S1B.2 tenancy
  keys and exact guard set, D-13 closure (no application privilege, no RLS policy on either store),
  `owner_user_id` still NOT NULL, the S1B.1 l14 relation set, S1B.0 reserved command kinds and the D-14 guard,
  the 22 approved definers with their post-R3 owner/body/config, the closed 22 surface, and the R3 marker.
- **D-4**: `ALTER TABLE gov_repo.governance_policies ALTER COLUMN owner_user_id DROP NOT NULL`. No legacy row
  rewritten (proven byte-identical). Column comment: LEGACY / NON-AUTHORITATIVE for M16. M16-admitted
  policies always carry `owner_user_id = NULL`; `created_by` = the verified actor.
- **Lineage** (immutable, RLS on, zero application privilege, `ENABLE ALWAYS` raising UPDATE/DELETE/TRUNCATE
  triggers, no JSON, no free text, no PII):
  `gov_repo.l14_policy_admissions` (organisation, policy, ALLOW `POLICY_VERSION` `ADMIT` authorization,
  source class, support status, actor, recorded_at) and `gov_repo.l14_policy_version_admissions` (adds
  version, content hash, linear predecessor; requires an M16-admitted parent). Structural guards make each
  lineage row mirror its exact authorization and store row; once admitted, the policy descriptor and its
  D-4 / no-hierarchy nullity are frozen. A legacy row without lineage is never M16-admitted.
- **RPCs** (SECURITY DEFINER, owner `postgres` — the canonical L14 owner class, `search_path=pg_catalog,
  pg_temp`, `lock_timeout=5s`, fully qualified SQL, EXECUTE = `service_role` only):
  `l14_admit_governance_policy_v1`, `l14_admit_policy_version_v1`, `l14_read_policy_descriptors_v1`.
- **change_summary**: still `text NOT NULL`, never a parameter; PostgreSQL writes
  `M16_POLICY_VERSION_ADMISSION` (compatibility filler only — not authority, rationale, PII, evidence,
  validation or trust).
- **TypeScript**: `packages/canonical-contracts/src/l14-policy-admission.ts`,
  `packages/governance-review/src/l14-policy-admission.ts` (byte-for-byte mirror), server-only
  `apps/dashboard/lib/governance/l14-policy-admission-persistence.ts`. No HTTP route, no UI.

## Authority path

`base session eligibility (verified organisation, actor, iat, exp, credential epoch; ORG -> USER -> ROLES FOR SHARE)
-> closed syntactic shape -> DB content hash (D-3) -> syntactic support -> DB fingerprint (GV008)
-> Authority Policy guard SHARED -> registry subject guard (POLICY_CODE:<code> / POLICY:<policy_id>) -> command guard
-> replay arbitration (exact replay / GV007) -> support + tenant/parent + expected-latest resolution (GV010 / GV009)
-> effective Authority Policy (exact recomputed hash) -> evaluator(L14_POLICY_CONTENT_ADMIT, ADMIT, IMMEDIATE,
   AUTHORITATIVE LOCAL_HUMAN, ALL_ALLOWED_TARGETS) -> durable authorization (+ role / rule snapshots)
-> ALLOW: store row + lineage + support links + result | DENY: result only -> final base-eligibility recheck`.

Never authority: JWT role/email, `service_role` capability, GovernanceParty, scanner, LLM, caller organisation,
legacy status / approval / QES / `current_version_id`. ADMIT creates no proposal, governance decision, registry
state or trust promotion; the descriptor read reports `NOT_VALIDATED` until S1B.4.

## Definer surface

Application SECURITY DEFINER surface (non-extension-member, any schema): **22 → 25**. Policy-store-capable
application definers: **12 → 15**. The S1B.3 postflight proves exact identity, owner, SECURITY DEFINER, config,
EXECUTE ACL (`{postgres=X/postgres,service_role=X/postgres}`) and body hash for all 25, excludes extension members
via `pg_depend deptype='e'` and fails on any unexpected non-extension application definer. Historical postflights
and suites keep their own (22 / 12) horizon and are not modified.

## Tests

Implementation commits: `bb579bd` (migration), `666a82c` (contracts + adapter), `4289ac2` (PG17 suites).

| Run | Where | Result |
|---|---|---|
| `l14-policy-admission.test.ts` (16 subtests incl. parent) | LOCAL PG17.8 | 16 pass / 0 fail |
| `l14-policy-admission-concurrency.test.ts` (10) | LOCAL PG17.8 | 10 pass / 0 fail |
| `l14-policy-admission-acl.test.ts` (8 + R3-missing preflight test) | LOCAL PG17.8 | 9 pass / 0 fail |
| `l14-policy-admission-contract.test.ts` + related L14 / quarantine contract tests | LOCAL Node 24 | 7 + 32 pass / 0 fail |
| Dashboard unit suite (`npm test`) | LOCAL | 1169 pass / 0 fail / 5 skipped (pre-existing hosted / real-acceptance opt-ins) + 15 + 8 pass |
| `@council/canonical-contracts` / `@council/governance-review` tests | LOCAL | 230 / 412 pass, 0 fail |
| Typecheck: dashboard, canonical-contracts, governance-review | LOCAL | clean |
| M15 regression (`npm run test:postgres`) | LOCAL PG16 | 8 pass / 0 fail |
| Full `tests/postgres-m16/*.test.ts`, all files in parallel | LOCAL Windows | 772 pass / 10 fail / 2 cancelled — every failure is a disposable-cluster `psql` connection timeout (5 s) or a 240 s test timeout from ~45 concurrent clusters on one workstation, including historical suites; the same tree is green in CI. Not claimed as a pass. |
| `M16 PostgreSQL 17 security suite` run `37711268449` @ `4289ac2` | CI (PGDG PG17 + real pgvector) | success — 810 tests, 810 pass, 0 fail, 0 skipped |
| `M15 PostgreSQL regression` run `37711268452` @ `4289ac2` | CI | success — 8 pass, 0 fail |

The PG17 suites cover the S1B.3 obligations 1–61: positive admission (identity, first version expected-none,
exact expected-latest successor, DB hash = Node SHA-256 over exact UTF-8 bytes incl. CRLF/NFD, exact and DENY
replay, admitted-only / tenant-only / NOT_VALIDATED read, legacy exclusion); session failures (cross-tenant
principal, non-member, inactive actor / organisation, stale epoch, expired / over-age / future-issued);
authority (no AP, missing / wrong permission, wrong subject family, CONTRIBUTING source, non-executable and
unknown source classes, D-14 scope at persistence and SCOPE_NOT_AUTHORIZED for a legacy-shaped scoped rule,
unknown vocabulary); integrity (GV008, GV007, hash mismatch, no caller-chosen policy / version / owner /
change_summary parameter); concurrency (stale expected-latest GV009, concurrent successors, same-code race,
role and Authority Policy change races, lock timeouts); non-fabrication (legacy parent rejected, no decision /
registry state / trust, `current_version_id` untouched, owner NULL, created_by = actor, constant
change_summary); privilege closure and negative controls (service_role / anon / authenticated direct access,
PUBLIC EXECUTE, unsafe default privileges, unexpected definers in any schema, view / sequence / column /
inherited leaks, extension-member exclusion and non-masking, RLS / policy / trigger / ACL / body / config
drift, D-4 revert, 11 / 12 enumeration changes, F2); structural (no JSON / PII / free text in lineage,
canonical_relationships structure, ACL and rows byte-identical across the migration).

## Holds

S1B2-H1 was closed by the ACP on EQUIVALENT HOSTED EVIDENCE: real hosted manual HTTP acceptance was performed
(`B0_HTTP_MANUAL_ACCEPTANCE = PASS`); the frozen canonical runner was not literally executed, so `REAL_HTTP_H1_PASS`
is NOT EMITTED.
S1B2-I1 is implemented on this branch (not merged). S1B2-I2 (policy_mandate_mappings write disposition,
including its legacy CASCADE into `governance_policies`), I3, I4, I5 and I7 are unchanged.
Out of scope and not started: S1B.4 (POLICY_VERSION proposal / validation), applicability, responsibility,
domains, controls, legacy promotion, M17, UI, hosted execution.
