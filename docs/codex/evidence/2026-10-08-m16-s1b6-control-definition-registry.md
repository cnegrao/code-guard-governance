# M16-S1B.6 — CONTROL_DEFINITION Registry + Immutable Versions

Starting point: `origin/main` = `5ac5d8072353001ee533a1019fbbdd43485a8d62` (the merge of PR #55,
`feat/m16-s1b5-semantic-domain-registries`). Branch `feat/m16-s1b6-control-definition-registry` was created from exactly
that commit with a clean worktree. Architecture authority:
`docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md` §§4, 6-9, 14, 16-18, 20-21, 23, the frozen
S1B decisions (D-1..D-14), the S1B.1R1 interval ruling, and the Architecture Control Plane S1B.6 identity decision
(S1B.6 is an execution label, not an ADR slice number).

## Recorded state

| Item | State |
|---|---|
| PR #55 (`feat/m16-s1b5-semantic-domain-registries`) | MERGED (`5ac5d80`) |
| S1B.5 | MERGED |
| `main` baseline at S1B.6 start | `5ac5d8072353001ee533a1019fbbdd43485a8d62` |
| S1B.6 | IMPLEMENTED ON BRANCH `feat/m16-s1b6-control-definition-registry`; NOT MERGED |
| M17+ | NOT STARTED |
| H1 | CLOSED ON EQUIVALENT HOSTED EVIDENCE |
| `B0_HTTP_MANUAL_ACCEPTANCE` | PASS |
| `REAL_HTTP_H1_PASS` | NOT EMITTED |

## Environments — LOCAL / CI / HOSTED

- **LOCAL**: disposable PostgreSQL **17.10** clusters (upstream server binaries from the npm package
  `@embedded-postgres/linux-x64@17.10.0-beta.17`, because the PGDG apt host is blocked by the session network policy;
  `psql` is the local PostgreSQL 16 client), passed as `M16_PG17_BIN`, run as an unprivileged OS user. The harness
  asserts `server_version_num` is 17.x. pgvector is not installed locally (the harness's labelled stand-in type is used).
  M15 regression ran on local PostgreSQL 16, as its CI job uses the runner default.
- **CI**: GitHub Actions `M16 PostgreSQL 17 security suite` (PGDG PostgreSQL 17 + real pgvector) and
  `M15 PostgreSQL regression` on the pushed branch (see "CI").
- **HOSTED**: **NOT TOUCHED.** No Supabase hosted project (TEST / DEV / production), no Vercel, no deployment, no hosted
  migration. No hosted S1B.6 claim is made.

## Implementation

One additive migration: `supabase/migrations/20261008200000_m16_s1b6_control_definition_registry_v1.sql`. No historical
migration edited; `CREATE OR REPLACE` / `DROP` count 0; no pre-existing table altered; every pre-S1B.6 `gov_repo` routine
body / config / ACL and every pre-S1B.6 table definition proven byte-identical by the ACL suite.

- **Preflight** aborts atomically unless the exact merged S1B.5 catalog is present (27-table l14 set, the S1B.0 keys and
  reserved `ADMIT_CONTROL_DEFINITION_VERSION` / `CONTROL_DEFINITION_*` reason codes / D-14 permissions, the 30 approved
  definers with exact owner / body hash / config, the closed 30 surface, no pre-existing CONTROL_DEFINITION history).
- **Tables** (RLS on, zero application privilege, no RLS policy, no JSON, every text column a closed vocabulary or bounded
  CHECK, `ENABLE ALWAYS` raising UPDATE/DELETE/TRUNCATE on history):
  - `l14_control_definitions` — stable identity `(organisation_id, control_definition_id)`, created right after the root
    version by the same ALLOW / CONTROL_DEFINITION / ADMIT authorization (EXPECTED_NONE). No content.
  - `l14_control_definition_versions` — `control_definition_version_id` (one identity per version id per organisation),
    `control_code` (1..128), `title` (1..512), `description` (1..8192, LF / TAB inside only), DB `content_hash`,
    `predecessor_version_id` (linear lineage: one root, one successor each), its own ADMIT authorization, source, support.
    The version → identity FK is `DEFERRABLE INITIALLY DEFERRED` (root version first, identity right after, both checked
    immediately by their guards); it is the only deferrable FK (postflight-pinned).
  - `l14_control_definition_proposals` / `l14_control_definition_states` — typed immutable detail over the S1B.0 envelopes,
    pinned to the exact `(identity, version, content hash)` tuple; linear alternating VALIDATED → REVOKED → VALIDATED.
  - `l14_control_definition_heads` — technical validation CAS pointer per exact tuple; created by the first
    state-appending decision; never authority. No per-identity "current version" pointer exists.
- **Content hash**: `l14_control_definition_content_hash_v1` = SHA-256 over the length-framed exact UTF-8 bytes of
  (`L14_CONTROL_DEFINITION_CONTENT_V1`, control_code, title, description); no normalization. The RPC recomputes it (a caller
  hash is an assertion: `GV010 CONTENT_HASH_MISMATCH`), the version guard recomputes it again on insert.
- **RPCs** (SECURITY DEFINER, owner `postgres`, `search_path=pg_catalog, pg_temp`, `lock_timeout=5s`, EXECUTE = service_role):
  - `l14_admit_control_definition_version_v1` — `L14_CONTROL_DEFINITION_ADMIT` / `ADMIT`; explicit `p_expectation_kind`
    (`EXPECTED_NONE` + NULL for a first version; `EXPECTED_CURRENT` + the exact latest admitted version id for a
    successor); identity guard + version-id guard; `LOCAL_HUMAN` only (`SYSTEM_SEED` / `SOURCE_CONNECTION` →
    `SOURCE_CLASS_NOT_EXECUTABLE`); durable DENY admits nothing; no decision / state / head.
  - `l14_submit_control_definition_proposal_v1` — any verified active member; pins the exact admitted tuple; no authority.
  - `l14_decide_control_definition_proposal_v1` — `L14_CONTROL_DEFINITION_VALIDATE`, requested action = exact outcome,
    `CONTROL_DEFINITION_*` reason code, current locked roles, current effective Authority Policy, self / future / back
    dating only per the matched rule, S1B.1R1 interval rules, final eligibility recheck.
- **Resolver** `l14_control_definition_valid_state_v1(org, control_definition_id, version_id, content_hash, effective_at,
  recorded_cutoff)` (owner-only): the exact VALIDATED state valid at both coordinates, else no row; ambiguity fails closed;
  never latest / another version / same control code / CG-AG match. **Dependency contract for a future applicability
  slice**: `(organisation_id, control_definition_id, control_definition_version_id, content_hash, validated state_id)`,
  FK-pinnable via `l14_control_definition_states_kind_unique (… , state_kind = 'VALIDATED')`.
- **TypeScript**: `packages/canonical-contracts/src/l14-control-definition.ts` (identity, version content + bounds, exact
  version subject, explicit admit expectation, proposal, durable result, validated dependency),
  `packages/governance-review/src/l14-control-definition.ts` (byte-for-byte hash + fingerprint mirror, content shape
  checks), server-only `apps/dashboard/lib/governance/l14-control-definition-persistence.ts` (five verified principal values
  only). No HTTP route, no UI.

## Security definer surface (effective catalog)

| | Before (merged S1B.5) | After (S1B.6) |
|---|---|---|
| Approved application SECURITY DEFINER routines | 30 | 33 |
| Canonical-owner (policy-store-capable `postgres`) class | 20 | 23 |

New: `l14_admit_control_definition_version_v1` (`0486d46f…`), `l14_submit_control_definition_proposal_v1` (`8acea9a2…`),
`l14_decide_control_definition_proposal_v1` (`2a71aa16…`); full body hashes pinned in the postflight and asserted against
the live catalog. The 23 count is owner capability only: the three bodies never reference `governance_policies`,
`policy_versions` or the policy admission lineage (no text match, no catalog dependency; postflight I5 / I7 + ACL suite),
and reach the Authority Policy only through the unchanged approved helpers.

## Tests (LOCAL)

| Suite | Pass | Fail | Skip |
|---|---|---|---|
| New S1B.6 PG17 functional, `tests/postgres-m16/l14-control-definition-registry.test.ts` | 16 (+1 parent) | 0 | 0 |
| New S1B.6 PG17 concurrency, `tests/postgres-m16/l14-control-definition-registry-concurrency.test.ts` | 20 (+1) | 0 | 0 |
| New S1B.6 PG17 ACL / preflight / postflight controls, `tests/postgres-m16/l14-control-definition-registry-acl.test.ts` | 8 (+1) | 0 | 0 |
| Complete M16 PG17 suite, `node --conditions=react-server --import tsx --test tests/postgres-m16/*.test.ts` (55 files) | 930 | 0 | 0 |
| M15 PostgreSQL regression, `npm run test:postgres --workspace codeguard-os` (local PG16) | 8 | 0 | 0 |
| Dashboard TS suite, `npm test` (apps/dashboard; incl. the new S1B.6 contract test, 8 tests) | 1190 + 15 + 8 | 0 | 5 (pre-existing) |
| `@council/governance-review` tests (`tsx --test test/*.test.ts`) | 412 | 0 | 0 |
| `@council/canonical-contracts` tests (`node --test test/*.mjs`) | 230 | 0 | 0 |
| Typecheck: dashboard, canonical-contracts, governance-review (`tsc --noEmit`) | clean | | |
| `git diff --check origin/main...HEAD`; secret-pattern scan of the branch diff | clean | | |

The two package `test` scripts pass `--test-isolation=none`, which the container's Node 22.22 rejects; the same files were
run without that flag. Historical horizons: every S1B.5-and-older suite keeps its own horizon (a new `S1B6` horizon was
added; `S1B5` is exactly the merged S1B.5 catalog); historical postflights untouched. One database-free assertion was
updated to the new exact set (still exact equality): the L14 TypeScript file list in `l14-policy-store-contract.test.ts`.

Acceptance mapping (selection): first admission with caller ids verbatim and DB hash (1-4); wrong / malformed caller hash
GV010 with nothing consumed and owner-level forged content rejected by the guard (5); successor under the same identity,
stale / blind / incoherent / NONE-over-existing expectations, linear lineage, concurrent first / successor / version-id
races (6-9); admission writes no proposal / decision / state / head (10); proposals pin the exact tuple; unadmitted, hash- /
version- / identity-mismatched and foreign tuples GV010; SYSTEM_SEED / SOURCE_CONNECTION not executable; owner-level
source laundering rejected (11-15); permission snapshot, current roles, successor AP, D-14 (16-18); exact state pin,
REJECT / DEFER / terminality / correction, exact REVOKE with byte-identical target, full immutability incl. versions /
identity / head (19-24); bitemporal resolution, recorded cutoff, future and back dating, R1 interval rule, stale
expected-current, concurrent VALIDATE / terminal / REVOKE (25-31); replay of every command kind incl. DENY after authority
changes, GV007, GV008, self-validation (32-36); a second version neither validates itself nor revokes / replaces the first,
both versions validatable independently, no current-version column (37-38); no applicability / assessment / score
structure (39, 42); cg_* flags and `agent_compliance_gaps` create nothing governed, CG-AG content admitted as LOCAL_HUMAN is
not validated, same control code under another identity never resolves (40-41); security 43-62 via the ACL suite (direct
DML denied, PUBLIC / anon / authenticated / service_role EXECUTE, 50 postflight negative controls covering column, sequence,
view, default ACL, inheritance, unexpected definers, extension members, body / owner / search_path drift, RLS, JSON,
scores, policy-store reach, enumerations, F2).

## CG-AG boundary

`packages/scanner/src/core/cg-ag-controls.ts` is unchanged and remains proposal-input material only. No S1B.6 SQL or
TypeScript reads `CG_AG_CONTROLS`, `dbFlag`, any `cg_*` column, `getCGAGScore()`, `isCGAGImplemented()`,
`agent_compliance_gaps` or the legacy agent registry (contract test + postflight I5). A CG-AG id can never be a
`control_definition_id` (not a UUID). CG-AG 001..012 are NOT admitted or validated by this slice.

## Invariants

- F2: NOT TOUCHED (no canonical_relationships DDL / DML / FK / trigger; structural digest identical).
- CanonicalObjectKind = 11; GovernedRelationshipType = 12; CONTROL_DEFINITION is not a canonical kind; no control
  relationship type.
- Out of scope and not implemented: RESPONSIBILITY_ASSIGNMENT, BUSINESS_CONTEXT_ASSIGNMENT, POLICY_APPLICABILITY,
  CONTROL_APPLICABILITY, CONTROL_ASSESSMENT, risk / waiver / coverage / maturity / compliance scores, UI, routes.

## CI

| Workflow | Run | HEAD | Result |
|---|---|---|---|
| M16 PostgreSQL 17 security suite | [37830043905](https://github.com/cnegrao/code-guard-governance/actions/runs/37830043905) | `24eeb30` | success (PGDG PostgreSQL 17, real pgvector) |
| M15 PostgreSQL regression | [37830043993](https://github.com/cnegrao/code-guard-governance/actions/runs/37830043993) | `24eeb30` | success |

`24eeb30` is the last implementation / test commit; this docs-only commit re-runs both workflows on the branch head.
