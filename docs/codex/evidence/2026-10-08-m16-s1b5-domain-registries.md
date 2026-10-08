# M16-S1B.5 — BUSINESS_DOMAIN / INFORMATION_DOMAIN Governed Registries

Starting point: `origin/main` = `3200b02042a6ed91e792cbc6da89e40fbf793d51` (the merge of PR #54,
`feat/m16-s1b4-policy-version-validation`). Branch `feat/m16-s1b-governed-registries` (whose earlier history was already
fully merged through PR #52) was restarted from exactly that commit with a clean worktree. Architecture authority:
`docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md` §§4, 6-7, 10, 17, 20-21, 23, the frozen
S1B decisions (D-1..D-14) and the S1B.1R1 interval ruling.

## Recorded state

| Item | State |
|---|---|
| PR #54 (`feat/m16-s1b4-policy-version-validation`) | MERGED (`3200b02`) |
| S1B.4 | MERGED |
| `main` baseline at S1B.5 start | `3200b02042a6ed91e792cbc6da89e40fbf793d51` |
| S1B.5 | IMPLEMENTED ON BRANCH `feat/m16-s1b-governed-registries`; NOT MERGED |
| M17+ | NOT STARTED |
| H1 | CLOSED ON EQUIVALENT HOSTED EVIDENCE |
| `B0_HTTP_MANUAL_ACCEPTANCE` | PASS |
| `REAL_HTTP_H1_PASS` | NOT EMITTED |

## Scope decision (recorded for the delta review)

No S1B.5 definition existed in the repository (the roadmap stopped at S1B.4 and the ADR has no slice numbering). The
owner selected the **domain registries** (BUSINESS_DOMAIN + INFORMATION_DOMAIN, ADR §10) as S1B.5; CONTROL_DEFINITION
(ADR §14) remains the last unimplemented registry subject. The design decisions below were taken in this slice by
analogy with the frozen S1B.1 (Party) and S1B.4 (POLICY_VERSION) patterns and are the items to confirm in review:

1. **Identity = the existing L6 identity, verbatim.** The registry key is `organisation_id + subject_kind + domain_id`,
   where `domain_id` is the L6 `BusinessDomainId` / `InformationDomainId` value (`l14DomainSubjectOf` maps an L6
   identity to it). PostgreSQL mints nothing (no parallel namespace). No L6 domain table exists in the repository, so
   ADMIT records the asserted L6 identity; it does not (and cannot yet) check a persisted L6 catalogue.
2. **The two kinds are distinct namespaces** sharing one typed table family whose `subject_kind` is the existing S1B.0
   envelope discriminator (closed to exactly the two kinds by a CHECK on every new structure, proven by the postflight).
3. **No label / description / hierarchy** is stored: ADR §10 makes them non-identity metadata; none is needed for the
   governed lifecycle, so none is part of any L14 command or table.
4. **ADMIT is EXPECTED_NONE only**: a second ADMIT of the same identity is `GV009 DOMAIN_ALREADY_ADMITTED` (nothing
   consumed). ADMIT is executable for `LOCAL_HUMAN` only (as Party); SYSTEM_SEED / SOURCE_CONNECTION need the trusted
   intake (ADR §7.1) and fail `SOURCE_CLASS_NOT_EXECUTABLE`. Proposals and states must carry the admission source class.
5. **No read RPC**: the dependency contract for S1C (BUSINESS_CONTEXT_ASSIGNMENT legality) is the owner-only bitemporal
   resolver `l14_domain_valid_state_v1`, as Party did in S1B.1. A controlled read can be added when a consumer exists.

## Environments — LOCAL / CI versus HOSTED

- **LOCAL**: disposable PostgreSQL **17.10** clusters (upstream PostgreSQL 17.10 server binaries from the npm registry
  package `@embedded-postgres/linux-x64@17.10.0-beta.17`, because the PGDG apt host is blocked by the cloud session's
  network policy; `psql` is the local PostgreSQL 16 client), passed to the existing harness as `M16_PG17_BIN` and run as
  an unprivileged OS user. The harness asserts `server_version_num` is 17.x. pgvector is not installed locally, so the
  harness's labelled stand-in type is used (only the HNSW index statement may fail). M15 regression ran on the local
  PostgreSQL 16 install, as its CI job uses the runner default.
- **CI**: GitHub Actions `M16 PostgreSQL 17 security suite` (PGDG PostgreSQL 17 + real pgvector) and
  `M15 PostgreSQL regression` on the pushed branch head (see "CI").
- **HOSTED**: NOT TOUCHED. No Supabase hosted project (TEST / DEV / production), no Vercel, no deployment, no hosted
  fixture or environment change. **No hosted S1B.5 claim is made.**

## Implementation

One additive migration, `supabase/migrations/20261008180000_m16_s1b5_domain_registries_v1.sql`; no historical migration
edited, no routine replaced (`CREATE OR REPLACE` / `DROP` count 0; every pre-S1B.5 `gov_repo` routine body, config and
ACL is proven byte-identical by the ACL suite).

- **Preflight** aborts atomically unless the exact merged S1B.4 catalog is present: the S1B.4 l14 relation set, the
  S1B.0 framework keys reused here, the 27 approved definers with exact owner / body hash / config, the closed 27
  surface, and no pre-existing BUSINESS_DOMAIN / INFORMATION_DOMAIN history in any framework table.
- **Admission** `l14_domain_admissions`: immutable; key `(organisation_id, subject_kind, domain_id)`; pinned by FK to
  its exact `ALLOW / same subject kind / ADMIT` authorization (one admission per authorization); support links on the
  existing `ADMISSION` owner; the technical head is created empty by ADMIT. Admission creates no decision, state or trust.
- **Typed immutable detail** over the S1B.0 envelopes (RLS on, zero application privilege, no RLS policy, `ENABLE ALWAYS`
  raising UPDATE/DELETE/TRUNCATE triggers, no JSON, no free text, every text column a closed vocabulary or pinned
  identity CHECK): `l14_domain_proposals` (intent, kind, id, requested_effective_from, target_state_id = exact VALIDATED
  state of the same domain for REVOKE) and `l14_domain_states` (linear, same-domain, alternating VALIDATED → REVOKED →
  VALIDATED; lineage copies, admission source class and deciding proposal verified against the envelope).
- **Technical head** `l14_domain_heads`: compare-and-set pointer only, created empty by ADMIT, advanced only to the
  direct lineage successor, never deleted, reconstructible as the lineage tail.
- **Resolver** `l14_domain_valid_state_v1(org, kind, id, effective_at, recorded_cutoff)` (owner-only): the exact
  VALIDATED state valid at both coordinates; no row otherwise; ambiguity fails closed; never another kind / domain.
- **RPCs** (SECURITY DEFINER, owner `postgres`, `search_path=pg_catalog, pg_temp`, `lock_timeout=5s`, EXECUTE =
  `service_role` only), replay-first like every S1B command:
  - `l14_admit_domain_v1` — `L14_DOMAIN_ADMIT` / `ADMIT` under the current effective Authority Policy; DENY is durable
    and admits nothing; F-4 attempted-content hash = frame(`L14_DOMAIN_CONTENT_V1`, kind, id).
  - `l14_submit_domain_proposal_v1` — any verified active member; no authority, decision, state or head change.
  - `l14_decide_domain_proposal_v1` — `L14_DOMAIN_VALIDATE`, requested action = exact outcome, the reason code must be
    the proposal kind's (`BUSINESS_DOMAIN_*` / `INFORMATION_DOMAIN_*`), current locked roles, current effective
    Authority Policy, self / future / back dating only per the matched rule, same-transaction final eligibility
    recheck. VALIDATE intent: VALIDATE / REJECT / DEFER; REVOKE intent: REVOKE / REJECT / DEFER; DEFER non-terminal;
    correction = new proposal + `prior_proposal_id` of the same domain.
- **Interval rules** (S1B.1R1): REVOKE `effective_from >= target.effective_from`; re-validation
  `effective_from >= tombstone.effective_from`; a second VALIDATED over a VALIDATED head is `DOMAIN_ALREADY_VALIDATED`.
- **TypeScript**: `packages/canonical-contracts/src/l14-domain-registry.ts` (closed kinds, L6 → subject mapping, typed
  proposal / result), `packages/governance-review/src/l14-domain-registry.ts` (byte-for-byte fingerprint / content-hash
  mirror + the domain-id shape mirror), server-only `apps/dashboard/lib/governance/l14-domain-registry-persistence.ts`.
  No HTTP route, no UI.

## Security definer surface (effective catalog)

| | Before (merged S1B.4) | After (S1B.5) |
|---|---|---|
| Approved application SECURITY DEFINER routines | 27 | 30 |
| Canonical-owner (policy-store-capable `postgres`) definers | 17 | 20 |

New: `l14_admit_domain_v1`, `l14_submit_domain_proposal_v1`, `l14_decide_domain_proposal_v1` (body hashes pinned in the
postflight and asserted against the live catalog). None reaches a policy store (postflight I5 + ACL suite).

## Tests (LOCAL)

| Suite (command) | Pass | Fail | Skip |
|---|---|---|---|
| New S1B.5 PG17 functional, `tests/postgres-m16/l14-domain-registry.test.ts` | 13 | 0 | 0 |
| New S1B.5 PG17 concurrency, `tests/postgres-m16/l14-domain-registry-concurrency.test.ts` | 16 | 0 | 0 |
| New S1B.5 PG17 ACL / preflight / postflight controls, `tests/postgres-m16/l14-domain-registry-acl.test.ts` | 9 | 0 | 0 |
| Complete M16 PG17 suite, `node --conditions=react-server --import tsx --test tests/postgres-m16/*.test.ts` (52 files) | 883 | 0 | 0 |
| M15 PostgreSQL regression, `npm run test:postgres --workspace codeguard-os` (local PG16) | 8 | 0 | 0 |
| Dashboard TS suite, `npm test` (apps/dashboard; incl. the new S1B.5 contract test) | 1182 + 15 + 8 | 0 | 5 (pre-existing) |
| `@council/governance-review` tests (`tsx --test test/*.test.ts`) | 412 | 0 | 0 |
| `@council/canonical-contracts` tests (`node --test test/*.mjs`) | 230 | 0 | 0 |
| Typecheck: dashboard, canonical-contracts, governance-review (`tsc --noEmit`) | clean | | |
| `git diff --check origin/main...HEAD`; secret-pattern scan of the branch diff | clean | | |

The two package `test` scripts pass `--test-isolation=none`, which the container's Node 22.22 rejects; the same files
were run without that flag (environment limitation only, not CI-gated). `next build` was not run: no route, page or
component imports the new TypeScript (proven by the contract test), and `tsc` is clean.

Historical tests: every S1B.4-and-older PG17 suite keeps its own horizon (a new `S1B5` horizon was added; the `S1B4`
horizon is exactly the merged S1B.4 catalog). One database-free assertion was updated to the new exact set (still exact
equality): the L14 TypeScript file list in `l14-policy-store-contract.test.ts`, as S1B.3 / S1B.4 did for their files.

What the PG17 suites prove (selection): the admitted identity is the L6 id verbatim and the two kinds are separate
namespaces (same id admitted under both; other tenants unaffected); second ADMIT GV009 with nothing consumed; ADMIT shape
and source-class closure; durable ADMIT DENY for every non-registrar (incl. Party administrators, the system admin and a
CONTRIBUTING rule) and `NO_EFFECTIVE_AUTHORITY` without a policy; proposals are not authority; never-admitted /
other-kind / foreign ids indistinguishable (GV010); owner-level forgeries rejected by the guards; reason codes bound to
the proposal kind; VALIDATE / REJECT / DEFER / REVOKE / correction / terminality; exact REVOKE target and byte-identical
target state; full immutability incl. admissions and head identity; future / back dating (authorized vs durable DENY),
pending cancellation and bitemporal readback; re-validation and overlap rejection; replay of ADMIT / SUBMIT / DECIDE
(incl. a replayed DENY) after authority changes; GV007 / GV008; self-validation; current roles; successor Authority
Policy; D-14 on domain rules; concurrent same-command, same-identity and expected-none races; role / credential /
suspension / organisation races; AP guard shared-vs-exclusive; 55P03 on held guards; 27 → 30 / 17 → 20 surface;
privilege closure; and 36 postflight negative controls (each must fail the S1B.5 postflight).

## Invariants

- F2: NOT TOUCHED (no canonical_relationships DDL/DML/FK/trigger; structural digest identical).
- CanonicalObjectKind = 11; GovernedRelationshipType = 12; no DOMAIN kind.
- No BUSINESS_CONTEXT_ASSIGNMENT, no applicability, no canonical object / L6 representation write, no policy store or
  policy lineage access; validating a domain validates nothing that references it (ADR §4). VALIDATED trust for a
  domain exists only in governed state.

## CI

{{CI}}
