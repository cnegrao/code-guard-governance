# M16-S1C.1 — RESPONSIBILITY_ASSIGNMENT (first authoritative M16 fact family)

Starting point: `origin/main` = `4f877b6aa2c1fdfac967f1bf6ce003da06c164a7` (the merge of PR #56,
`feat/m16-s1b6-control-definition-registry`). Branch `feat/m16-s1c1-responsibility-assignment` was created from exactly
that commit with a clean worktree. Architecture authority:
`docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md` §§2-4, 6-11, 16-18, 20-23 (O20-O26, O35,
O39, O45, O47, O49, O54, O55), the frozen S1B decisions (D-1..D-14) and the S1B.1R1 interval ruling. S1C.1 is an
Architecture Control Plane execution label, not an ADR slice number.

## Recorded state

| Item | State |
|---|---|
| PR #56 (`feat/m16-s1b6-control-definition-registry`) | MERGED (`4f877b6`) |
| S1B.6 | MERGED |
| `main` baseline at S1C.1 start | `4f877b6aa2c1fdfac967f1bf6ce003da06c164a7` |
| S1C.1 | IMPLEMENTED ON BRANCH `feat/m16-s1c1-responsibility-assignment`; NOT MERGED |
| M17+ | NOT STARTED |
| H1 | CLOSED ON EQUIVALENT HOSTED EVIDENCE |
| `B0_HTTP_MANUAL_ACCEPTANCE` | PASS |
| `REAL_HTTP_H1_PASS` | NOT EMITTED |

## Environments — LOCAL / CI / HOSTED

- **LOCAL**: disposable PostgreSQL **17.6** clusters (upstream server binaries from the npm package
  `@embedded-postgres/linux-x64@17.6.0-beta.15`, because the PGDG apt host is blocked by the session network policy;
  `psql` is the local PostgreSQL 16 client), passed as `M16_PG17_BIN`, run as an unprivileged OS user. The harness asserts
  `server_version_num` is 17.x. pgvector is not installed locally (the harness's labelled stand-in type is used). M15
  regression ran on local PostgreSQL 16, as its CI job uses the runner default. The package and dashboard TypeScript suites
  ran on Node **24.11.0** (the repository engine; the package `test` scripts need `--test-isolation`).
- **CI**: GitHub Actions `M16 PostgreSQL 17 security suite` (PGDG PostgreSQL 17 + real pgvector) and
  `M15 PostgreSQL regression` on the pushed branch (see "CI").
- **HOSTED**: **NOT TOUCHED.** No Supabase hosted project, no Vercel, no deployment, no hosted migration. No hosted S1C.1
  claim is made.

## Responsibility model

- **Meaning**: a VALIDATED GovernanceParty holds ONE closed responsibility role on ONE exact governed canonical target. It
  is an L14 fact — never a canonical relationship / object, an AgentVersion attribute, a free-text owner, a governance-user
  or directory-profile assignment, or an inferred ownership relation.
- **Target identity**: exact `organisation_id + target_kind + target_canonical_object_id`, FK-resolved against
  `gov_repo.canonical_objects (organisation_id, canonical_object_id, kind)`. Legal kinds: `AGENT`, `DATA_ASSET`,
  `DATA_ELEMENT`; `AGENT_VERSION` and every other kind are rejected (`RESPONSIBILITY_TARGET_KIND_ILLEGAL`). Wrong tenant,
  wrong kind for a real id, a missing id or a label are indistinguishable (`TARGET_OBJECT_UNRESOLVED`).
- **Closed role matrix** (CHECK on proposals and states, re-checked in the RPC and the TS mirror): AGENT → BUSINESS_OWNER |
  TECHNICAL_OWNER; DATA_ASSET / DATA_ELEMENT → DATA_OWNER | DATA_STEWARD. No custom role, hierarchy or inference.
- **Logical fact key**: `organisation_id + target_kind + target_canonical_object_id + responsibility_role +
  governance_party_id`. Another Party is another key; a Party id is never rewritten.
- **Party dependency**: the proposal and the state pin `governance_party_id` (semantic identity) AND
  `party_validated_state_id` (dependency lineage only), composite-FK'd to an exact VALIDATED
  `l14_governance_party_states` row of the same Party and organisation. At decision time the pinned state must be exactly
  the state `l14_governance_party_valid_state_v1` returns for that Party at the requested effective instant as known now
  (`PARTY_DEPENDENCY_NOT_VALID` otherwise). `party_kind` is copied from the immutable Party identity only to complete that
  FK; it is not PII. No name, email, phone, profile text or directory id is ever read or stored.

## Implementation

One additive migration: `supabase/migrations/20261008220000_m16_s1c1_responsibility_assignment_v1.sql`. No historical
migration edited; `CREATE OR REPLACE` count 0 (the audited S1A.2 organisation-local evaluator is unchanged).

- **Preflight** aborts atomically unless the exact merged S1B.6 catalog is present (32-table l14 set, the S1B.0 keys, the
  33 approved definers with exact owner / body hash / config, the closed 33 surface, no pre-existing
  RESPONSIBILITY_ASSIGNMENT history, framework not yet widened).
- **Closed framework widening** (the four S1A / S1B framework tables; every historical branch kept verbatim, each only
  gains "the new fact column is absent"; no row rewritten — catalog-only nullable columns, no default, no UPDATE):
  - `l14_governance_decisions`: subject `RESPONSIBILITY_ASSIGNMENT` + reason codes `RESPONSIBILITY_ASSIGNMENT_{VALIDATED,
    REJECTED,DEFERRED,REVOKED}` (the S1B.0 subject × outcome reason rule is reused unchanged).
  - `l14_authorization_decisions`: new CHECK — a RESPONSIBILITY_ASSIGNMENT request target is always one exact
    `CANONICAL_OBJECT` of a legal kind (the S1B.0 FK pins organisation + id + kind).
  - `l14_command_results`: nullable `fact_state_id` + subject-exact FK to `l14_fact_states`; fact branch of the shape CHECK
    (no ADMIT, never a registry state / AP pin).
  - `l14_support_links`: closed `FACT_STATE` owner + nullable `fact_state_id` + FK + unique (fact, evidence) index.
- **Tables** (RLS on, zero application privilege, no RLS policy, no JSON, every text column a closed vocabulary or bounded
  CHECK, `ENABLE ALWAYS` raising UPDATE / DELETE / TRUNCATE on history):
  - `l14_fact_states` — the common immutable fact-state envelope (NOT `l14_registry_states`): subject (only
    RESPONSIBILITY_ASSIGNMENT executable), VALIDATED / REVOKED, predecessor, exact revocation target, `effective_from`,
    immutable explicit `effective_to` (VALIDATED only, `> effective_from`), DB `recorded_at`, governance decision,
    authorization, Authority Policy id / version / hash, trust `VALIDATED`, source, support status. Linear lineage, one
    revocation per state.
  - `l14_responsibility_assignment_proposals` / `l14_responsibility_assignment_states` — typed immutable detail: exact key,
    pinned Party dependency, requested `effective_from` / `effective_to`, exact REVOKE target (same key + same
    dependency). Linear per-key lineage: VALIDATED → REVOKED → VALIDATED, or VALIDATED → VALIDATED only after an explicit end.
  - `l14_responsibility_assignment_heads` — RPC-maintained CAS pointer per fact key; created by the first state-appending
    decision; advanced only to the direct lineage successor; never authority.
- **Structural guards**: proposal source must be LOCAL_HUMAN (no laundering, even for the owner); state mirrors its
  envelope, its deciding proposal (key, dependency, intent, target, explicit end) and its authorization target; per-key
  interval lineage (GV011); single-owner non-overlap (GV009) — defence in depth behind the RPC.
- **RPCs** (SECURITY DEFINER, owner `postgres`, `search_path=pg_catalog, pg_temp`, `lock_timeout=5s`, EXECUTE = service_role):
  - `l14_submit_responsibility_assignment_proposal_v1` — any verified ACTIVE same-tenant member; LOCAL_HUMAN only
    (`SOURCE_CLASS_NOT_EXECUTABLE` for SYSTEM_SEED / SOURCE_CONNECTION; no trusted machine intake exists, none invented);
    writes the proposal envelope + typed detail + support + durable result only.
  - `l14_decide_responsibility_assignment_proposal_v1` — `L14_RESPONSIBILITY_VALIDATE`, requested action = exact outcome,
    closed reason code, CURRENT locked roles, CURRENT effective Authority Policy (exact hash), typed target scope
    (`ALL_ALLOWED_TARGETS` | `CANONICAL_KIND` = resolved kind | `CANONICAL_OBJECT` = exact org + id + kind; relationship
    scopes never match), self-validation / BACKDATED / FUTURE_DATED only per the matched rule, no skew tolerance, final
    eligibility recheck. VALIDATE intent: VALIDATE / REJECT / DEFER; REVOKE intent: REVOKE / REJECT / DEFER; DEFER
    non-terminal.
  - Guard order: AP guard SHARED → target + single-owner-role CARDINALITY guard (BUSINESS_OWNER / TECHNICAL_OWNER /
    DATA_OWNER only) → exact fact KEY guard → command guard → replay arbitration → resolution → authority → mutation.
- **Owner-only helpers**: `l14_lock_fact_subject_guard_v1` (frame_identity-keyed advisory guard),
  `l14_evaluate_target_authority_rules_v1` (the S1A.2 evaluator with the typed target-scope step),
  `l14_responsibility_single_owner_conflict_v1` (derived-interval overlap; closure from explicit end / exact revocation,
  never stored), `l14_responsibility_assignment_command_result_v1` (durable projection),
  `l14_responsibility_assignment_valid_state_v1` (exact resolver), `l14_responsibility_assignments_current_v1` (bounded
  current read of one target).
- **Resolver**: the exact VALIDATED fact of the exact key is returned only when its own state (recorded ≤ cutoff, effective
  ≤ instant < explicit end, no visible exact revocation ≤ instant, one candidate), its exact target, and its pinned Party
  state (exactly the Party resolver's answer) all hold at the SAME `effective_at` + `recorded_cutoff`. No row = UNKNOWN; no
  substitute Party, profile lookup or owner inference.
- **TypeScript**: `packages/canonical-contracts/src/l14-responsibility-assignment.ts`,
  `packages/governance-review/src/l14-responsibility-assignment.ts` (byte-for-byte fingerprint mirror + shape checks),
  server-only `apps/dashboard/lib/governance/l14-responsibility-assignment-persistence.ts` (exactly the five verified
  principal values first). No HTTP route, no UI.

## Cardinality, temporal and dependency semantics

- **Single owner** (AGENT BUSINESS_OWNER / TECHNICAL_OWNER, DATA_ASSET / DATA_ELEMENT DATA_OWNER): under the cardinality
  guard, any other VALIDATED assignment of the same target + role (any Party) whose derived interval overlaps the new one
  rejects the decision with `GV009 RESPONSIBILITY_SINGLE_OWNER_CONFLICT`; the whole command rolls back (nothing consumed).
- **DATA_STEWARD**: different Parties never serialize on each other and coexist; the same Party is the same key (KEY guard
  + head expectation: `GV009 …STATE_EXISTS` for a concurrent duplicate, `GV010 …ALREADY_VALIDATED` for a sequential one).
- **Owner replacement**: P1 explicitly revoked (REVOKE `effective_from` = closure instant), then P2 validated at a
  non-overlapping instant; a replacement may start exactly at a prior explicit end. P1 rows are byte-identical afterwards.
- **effective_to**: optional, immutable, fingerprinted, strictly after `effective_from` (submission check for explicit
  pairs, decision check for an IMMEDIATE start); expiry is derived (no UPDATE); a REVOKE has no end of its own and must fall
  in `[target.effective_from, target.effective_to)`.
- **O49**: a Party revocation at T leaves every responsibility row byte-identical; at effective ≥ T with a cutoff that sees
  the revocation the resolver returns nothing; earlier cutoffs keep the historical fact; Party re-validation mints a new
  Party state and the old assignment is NOT repinned; restoring the same key needs an explicit revoke + a new governed
  VALIDATE pinning the new Party state.

## Security definer surface (effective catalog)

| | Before (merged S1B.6) | After (S1C.1) |
|---|---|---|
| Approved application SECURITY DEFINER routines | 33 | 35 |
| Canonical-owner (policy-store-capable `postgres`) class | 23 | 25 |

New: `l14_submit_responsibility_assignment_proposal_v1` (`6cef279e…`), `l14_decide_responsibility_assignment_proposal_v1`
(`78fd7cf5…`); full body hashes pinned in the postflight and asserted against the live catalog. The 25 count is owner
capability only: neither body references a policy content store, the policy / control-definition / domain registries, the
Party directory / profile or `canonical_relationships` (no text match, no catalog dependency; postflight I5 / I7 + ACL suite).

## Legacy owner boundary

Legacy owner columns exist (e.g. `gov_repo.agents.owner_user_id`, `ai_systems.owner_user_id` / `owner_email`,
`governance_policies.owner_user_id`, `apps/dashboard/lib/validation.ts`). They remain non-authoritative display /
proposal-input values only. No S1C.1 SQL or TypeScript reads, maps, promotes or migrates them (contract test + postflight
I5); the migration created zero facts / heads / proposals (functional test 1).

## Tests (LOCAL)

| Suite | Pass | Fail | Skip |
|---|---|---|---|
| New S1C.1 PG17 functional, `tests/postgres-m16/l14-responsibility-assignment.test.ts` | 17 (+1 parent) | 0 | 0 |
| New S1C.1 PG17 concurrency, `tests/postgres-m16/l14-responsibility-assignment-concurrency.test.ts` | 10 (+1) | 0 | 0 |
| New S1C.1 PG17 ACL / preflight / postflight controls, `tests/postgres-m16/l14-responsibility-assignment-acl.test.ts` | 8 (+1) | 0 | 0 |
| Complete M16 PG17 suite, `node --conditions=react-server --import tsx --test tests/postgres-m16/*.test.ts` (58 files) | 971 | 0 | 0 |
| M15 PostgreSQL regression, `npm run test:postgres --workspace codeguard-os` (local PG16) | 8 | 0 | 0 |
| Dashboard TS suite, `npm test` (apps/dashboard; incl. the new S1C.1 contract test, 7 tests) | 1198 + 15 + 8 | 0 | 5 (pre-existing) |
| `@council/governance-review` tests | 412 | 0 | 0 |
| `@council/canonical-contracts` tests | 230 | 0 | 0 |
| Typecheck: dashboard, canonical-contracts, governance-review (`tsc --noEmit`) | clean | | |
| `git diff --check origin/main...HEAD`; secret-pattern scan of the branch diff | clean | | |

S1B.6 regression (unchanged, green in the complete suite): identical content / distinct control versions, NFC vs NFD
byte-exact hash, first ControlDefinition admission atomicity. Historical horizons: every S1B.6-and-older suite keeps its own
horizon (a new `S1C1` horizon was added); historical postflights untouched. One database-free assertion was updated to the
new exact set (still exact equality): the L14 TypeScript file list in `l14-policy-store-contract.test.ts`.

Coverage map: legal matrix ×6 end to end; illegal pairings ×6 + AGENT_VERSION ×4 roles + 9 other / unknown kinds + 3
unknown roles; target resolution (wrong tenant, wrong kind ×2, missing, label, malformed ×2); Party dependency (missing,
unvalidated, foreign Party, cross-tenant state substitution, other-Party state, revoked); PII boundary incl. profile
erasure; source laundering (RPC + owner-level guard); authority (no rule, other registries' stewards, contributor,
kind / object / relationship scope mismatch, self-validation, backdated, future-dated, typed scope success, role loss with
durable DENY replay and a new command id); terminality / DEFER / REJECT / linked correction / REVOKE intent; replay, GV007,
GV008 (wrong caller fingerprint), GV009 stale; sequential single-owner ×4 classes; DATA_STEWARD multi-party ×2 targets +
duplicate; owner replacement with both as-of axes; explicit `effective_to` (==, <, immediate-in-past, valid, expiry,
half-open end, exact-boundary replacement, overlap, same-key supersession, REVOKE end / bounds); temporal (DB instant,
future fact never hides the current one, recorded cutoff); O49 end to end; induced failure at the fact INSERT and at the
head CAS (no decision / authorization / fact / head / support / command consumed; the same command then succeeds).
Concurrency: real two-backend races for all four single-owner classes (exactly one wins, the loser GV009, nothing
consumed), revoke vs replacement, O45 same Party (one active) and different Parties (both, no serialization), same command
id, terminal race, role revocation vs commitment. ACL: 5 preflight breaks + history seed; historical rows / constraints /
routines unchanged and replayable; 33 → 35 / 23 → 25; direct DML denied for every application role; ~75 postflight
negative controls (table DML / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN, column grants incl. the new command-result
column, sequences, readable / writable / nested / PUBLIC views, default ACLs, membership / intermediate-role inheritance,
table inheritance, permissive RLS, RLS disabled, unexpected / extension-masked definers, overloads, body / search_path /
owner drift, PUBLIC / anon / authenticated EXECUTE, helper exposure, immutability-trigger removal / non-ALWAYS, guard
disabling, FK drop / NOT VALID / deferrable / cascade / extra FK, lineage index drops, kind / role / matrix / interval /
subject CHECK relaxation, authorization target CHECK drop, PII / rationale / JSON columns, canonical kind / relationship
type additions, F2 trigger and FK attachment).

## Invariants

- F2: NOT TOUCHED (no canonical_relationships DDL / DML / FK / trigger; structural digest identical; no OWNS /
  STEWARD_OF / RESPONSIBLE_FOR / HAS_OWNER type).
- CanonicalObjectKind = 11; GovernedRelationshipType = 12; GovernanceParty and RESPONSIBILITY_ASSIGNMENT are not canonical.
- Out of scope and not implemented: BUSINESS_CONTEXT_ASSIGNMENT, POLICY_APPLICABILITY, CONTROL_APPLICABILITY,
  CONTROL_ASSESSMENT, machine / source intake, Passport / Business Workspace UI, routes, M17.

## CI

| Workflow | Run | HEAD | Result |
|---|---|---|---|
| M16 PostgreSQL 17 security suite | [37848490213](https://github.com/cnegrao/code-guard-governance/actions/runs/37848490213) | `a4bcf35` | success (PGDG PostgreSQL 17, real pgvector) |
| M15 PostgreSQL regression | [37848490127](https://github.com/cnegrao/code-guard-governance/actions/runs/37848490127) | `a4bcf35` | success |

`a4bcf35` is the last implementation / test commit; this docs-only commit re-runs both workflows on the branch head.
