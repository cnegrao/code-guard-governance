# M16-S1C.3 — POLICY_APPLICABILITY (third authoritative M16 fact family)

Starting point: `origin/main` = `10bd95426241229bb423a0bf2c06c126118bea72` (the merge of PR #58,
`feat/m16-s1c2-business-context-assignment`, which also carried S1C.1R1). Branch `feat/m16-s1c3-policy-applicability` was created
from exactly that commit with a clean worktree. Architecture authority:
`docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md` §§2-4, 6-9, 13, 16-18, 20, 22-23. Implementation
patterns reused: S1B.3 policy admission, S1B.4 POLICY_VERSION validation, S1C.1 fact framework, S1C.1R1 dependency commit guard,
S1C.2 business context assignment.

## Recorded state

| Item | State |
|---|---|
| PR #58 | MERGED (`10bd954`) |
| S1C.1 / S1C.1R1 / S1C.2 | MERGED |
| `main` baseline at S1C.3 start | `10bd95426241229bb423a0bf2c06c126118bea72` |
| S1C.3 | IMPLEMENTED ON BRANCH `feat/m16-s1c3-policy-applicability`; NOT MERGED |
| Remaining M16 fact families | CONTROL_APPLICABILITY, CONTROL_ASSESSMENT — NOT IMPLEMENTED |
| M17+ | NOT STARTED |
| H1 | CLOSED ON EQUIVALENT HOSTED EVIDENCE |
| `B0_HTTP_MANUAL_ACCEPTANCE` | PASS |
| `REAL_HTTP_H1_PASS` | NOT EMITTED |

## Environments — LOCAL / CI / HOSTED

- **LOCAL**: disposable PostgreSQL **17.9** clusters (server binaries from the npm package
  `@embedded-postgres/linux-x64@17.9.0-beta.16`, because the PGDG apt host is blocked by the session network policy; `psql` is
  the local PostgreSQL 16 client), passed as `M16_PG17_BIN`, run as an unprivileged OS user; the harness asserts
  `server_version_num` 17.x. pgvector is not installed locally (the harness's labelled stand-in type is used). M15 ran on local
  PostgreSQL 16 (as its CI job uses the runner default). TypeScript suites ran on Node 22.22 (the package scripts'
  `--test-isolation=none` was passed as the Node 22 spelling `--experimental-test-isolation=none`); CI uses Node 24.
- **CI**: GitHub Actions `M16 PostgreSQL 17 security suite` (PGDG PostgreSQL 17 + real pgvector) and `M15 PostgreSQL regression`
  on the pushed branch (see the CI section).
- **HOSTED**: **NOT TOUCHED.** No Supabase hosted project, no Vercel, no deployment, no hosted migration.

## Model

- **Meaning**: an exact VALIDATED policy version either `APPLIES` or `DOES_NOT_APPLY` to one exact governed target. Absence of a
  current valid governed fact is `UNKNOWN` (no resolver row) — never `DOES_NOT_APPLY`. A validated `DOES_NOT_APPLY` is a positive
  governed row.
- **Target (closed typed union, no JSON)**:
  - `CANONICAL_OBJECT` = organisation + `target_canonical_kind` (any of the 11 kinds) + `target_canonical_object_id`, FK-resolved
    against `canonical_objects (organisation, id, kind)`.
  - `RELATIONSHIP_STATE` = organisation + `target_relationship_id` + `target_relationship_state_id`, resolved by the owner-only
    read-only `l14_resolve_relationship_state_target_v1` (exact triple; 0 rows = `TARGET_RELATIONSHIP_STATE_UNRESOLVED`,
    >1 = `TARGET_RELATIONSHIP_STATE_AMBIGUOUS`, fail closed). No bare state id, no relationship-id-only target, no latest /
    current / successor inference. The relationship type is DB-resolved and recorded on the authorization for scope matching
    only; the caller never supplies it.
  - Hybrid / partial shapes are impossible: union CHECK on proposals, states and heads; RPC refusals; TS mirror; and the
    injective IMMUTABLE encoder `l14_policy_applicability_target_key_v1` (length-prefixed, branch-tagged, NULL for any hybrid)
    generates the NOT NULL `target_key` column on all three tables.
- **Policy identity**: the S1B.3-admitted `policy_id`. **Exact version identity**: `policy_id + version_id + content_hash`.
  `policy_version_validated_state_id` pins the exact S1B.4 VALIDATED state (dependency lineage only).
- **Logical key / head**: `organisation + target_key + policy_id` (heads primary key; postflight-pinned; no version / hash /
  dependency / outcome column on the head).
- **Outcome vocabulary**: exactly `APPLIES | DOES_NOT_APPLY` (CHECK on proposals and states; UNKNOWN never stored).

## Fact framework delta (shared, no parallel framework)

- `l14_fact_states.subject_kind` CHECK: exactly `RESPONSIBILITY_ASSIGNMENT`, `BUSINESS_CONTEXT_ASSIGNMENT`, `POLICY_APPLICABILITY`.
- `l14_command_results`: the fact branch now covers the three families (other branches verbatim); no new column.
- `l14_governance_decisions`: subject + `POLICY_APPLICABILITY_{VALIDATED,REJECTED,DEFERRED,REVOKED}`.
- `l14_authorization_decisions`: new CHECK — a POLICY_APPLICABILITY request is one exact `CANONICAL_OBJECT` or one exact
  `RELATIONSHIP_STATE` (existing S1B.0 request-target shape; no FK onto the F2 table).
- `l14_support_links`: unchanged — the `FACT_STATE` owner is reused.
- `l14_lock_fact_subject_guard_v1`: the only `CREATE OR REPLACE` — closed vocabulary gains `POLICY_APPLICABILITY`; same
  signature / owner / owner-only ACL / config / key derivation.
- `l14_evaluate_target_authority_rules_v1` (object targets): reused unchanged.
- No historical row, constraint or routine rewritten (ACL-suite row / constraint / routine / table digests over seeded
  S1B.4 / S1C.1 / S1C.2 history); historical commands still replay their original results.

## Policy dependency / O29

- Proposals and states carry a composite FK `(organisation, policy_version_validated_state_id, policy_id, version_id,
  content_hash, 'VALIDATED')` → `l14_policy_version_states` (kind-unique key). That S1B.4 row itself FK-pins the S1B.3
  admission lineage and the hardened store key **including the DB-verified hash**, so a swapped hash, another version's hash,
  another policy's hash, a foreign tuple or a legacy-only version has no possible row.
- SUBMIT resolves: admitted policy (`POLICY_UNRESOLVED`), admitted version of THAT policy with THAT hash
  (`POLICY_VERSION_UNRESOLVED`), VALIDATED S1B.4 state of the exact tuple (`POLICY_VERSION_DEPENDENCY_UNRESOLVED`).
- DECIDE VALIDATE requires `l14_policy_version_valid_state_v1(org, policy, version, hash, effective_from, now)` to return
  exactly the pinned state (`GV010 POLICY_VERSION_DEPENDENCY_NOT_VALID`); the state guard re-checks at the state's own
  coordinates; the resolver re-checks at the read coordinates.
- O29 A–G proven in `l14-policy-applicability.test.ts` (exact tuple passes; one-nibble change, other version's hash, other
  policy's hash, foreign tuple, valid-looking SHA-256 of other content / random digest / uppercase all fail with nothing
  written; the stored tuple equals the store row's, admission lineage's and S1B.4 state's hash; even the owner cannot insert a
  swapped hash — the composite FK rejects it).
- The new routines never name `governance_policies`, `policy_versions`, `content_markdown`, `current_version_id` or
  `policy_mandate_mappings` (postflight H5 + ACL body scan); they read only the S1B.3 / S1B.4 lineage and resolver.

## Dependency commit boundary

- `l14_lock_policy_version_dependency_guard_shared_v1(org, policy, version, hash)`: owner-only SECURITY INVOKER;
  `pg_advisory_xact_lock_shared` on `frame_identity([org, 'l14-registry-subject-guard-v1', 'POLICY_VERSION',
  'POLICY_VERSION_VALIDATION:' || policy || ':' || version || ':' || hash])` — byte-identical to the key the S1B.4 RPCs pass to
  `l14_lock_registry_subject_guard_v1` (exclusive). No new namespace. Held to commit.
- DECIDE order (VALIDATE): AP guard SHARED → POLICY_VERSION dependency SHARED → fact KEY (`target_key + policy_id`) →
  command. S1B.4 order: AP → registry subject EXCLUSIVE → command. No cycle. REVOKE / REJECT / DEFER do not take the
  dependency guard and never check dependency validity (cleanup of an invalidated applicability proven).
- Race order 1 (PV REVOKE holds the exclusive guard; VALIDATE waits, then GV010 `POLICY_VERSION_DEPENDENCY_NOT_VALID`; no
  authorization / decision / fact / typed state / head / support / result consumed), race order 2 (VALIDATE holds the shared
  guard; PV REVOKE waits and commits after; current → UNKNOWN; history byte-identical; earlier coordinates resolve), and
  shared parallelism (two VALIDATEs on the same tuple hold the guard concurrently — observed in `pg_locks` as 2 × ShareLock)
  are proven in `l14-policy-applicability-concurrency.test.ts` with real PG17 backends.

## Authority

- Permission `L14_POLICY_APPLICABILITY_VALIDATE`; requested action = exact outcome; closed reason codes.
- Object targets: the S1C.1 evaluator unchanged (`ALL_ALLOWED_TARGETS | CANONICAL_KIND | CANONICAL_OBJECT`).
- Relationship-state targets: owner-only `l14_evaluate_relationship_state_authority_rules_v1` — identical steps, scope step
  `ALL_ALLOWED_TARGETS | RELATIONSHIP_TYPE (DB-resolved type) | RELATIONSHIP_STATE (exact id + state id)`.
  CANONICAL_* never authorize a relationship state; RELATIONSHIP_* never authorize an object (both directions tested).
- Self-validation (decider = submitter) on VALIDATE fails closed unless an authorizing rule of the exact action and target scope
  has `allow_self_validation` (tested on both a canonical scope and an exact relationship-state scope).
- Source: LOCAL_HUMAN only (RPC + proposal guard trigger); SYSTEM_SEED / SOURCE_CONNECTION / scanner / LLM / mapping refused.

## Supersession / temporal / O49

- Same-key successors (V1→V2, APPLIES→DOES_NOT_APPLY same version, DOES_NOT_APPLY→APPLIES new version) append a lineage
  successor; the head advances; the predecessor is byte-identical (xmin / ctid); closure derived from the visible successor;
  earlier recorded cutoffs never see a later successor; a future successor never hides its predecessor. A no-op successor
  (same version / hash / dependency / outcome, open-ended) is `POLICY_APPLICABILITY_ALREADY_VALIDATED`.
- ADR §17 temporal rules as S1C.2 (IMMEDIATE = DB instant; BACKDATED / FUTURE_DATED need explicit permission; immutable
  `effective_to > effective_from`; REVOKE has no end of its own; GV011 continuity errors). A backdated / future applicability
  needs its dependency valid at that instant.
- O49 steps 1–10 proven for an object target (APPLIES) and a relationship-state target (DOES_NOT_APPLY): PS1 revoked → history
  byte-identical, current UNKNOWN, earlier cutoff retains; PS2 revalidation never auto-repins; a new governed successor pins PS2.

## Surface / security

- Application SECURITY DEFINER surface **37 → 39** (`l14_submit_policy_applicability_proposal_v1`,
  `l14_decide_policy_applicability_proposal_v1`, postgres-owned, service_role-only, body hashes pinned in the postflight);
  canonical-owner class **27 → 29**. Every helper / guard / encoder / evaluator / resolver / read is owner-only SECURITY INVOKER.
- New tables: RLS on, no policy, REVOKE ALL from PUBLIC / anon / authenticated / service_role; history raises on
  UPDATE / DELETE / TRUNCATE; the head is RPC-only (guarded CAS).
- ACL suite: preflight breaks (7 classes + pre-existing history) abort atomically; ~80 rolled-back postflight negative controls
  covering every class listed in the slice brief (service_role DML, TRUNCATE, MAINTAIN, column grants, sequence leak, PUBLIC /
  anon / authenticated EXECUTE, default ACL, role inheritance, writable views, permissive RLS, unexpected definers, owner /
  search_path drift, fact and policy-dependency FK weakening, head key widened with version_id / content_hash, union CHECK
  weakening, applicability CHECK widening, fact subject widened, dependency guard EXCLUSIVE / other namespace / executable /
  definer, guard removed from DECIDE, non-injective key encoder, canonical kind / relationship type added, F2 trigger / FK /
  unique / CHECK on `canonical_relationships`).

## F2

**NOT TOUCHED.** `canonical_relationships` is only READ by `l14_resolve_relationship_state_target_v1` (plus the pre-existing S1A
rule-scope validator). No DDL / DML / FK / uniqueness / trigger; postflight H11 + the ACL F2 digest (columns, constraints,
indexes, triggers, rules, policies, ACL, rows) prove it. The ambiguity test drops the PK only inside a rolled-back disposable
transaction. 11 canonical kinds / 12 relationship types unchanged.

## Tests (LOCAL)

| Suite | Result |
|---|---|
| `postgres-m16/l14-policy-applicability.test.ts` (functional: 11-kind object matrix, relationship-state matrix + read boundary + ambiguity, dependency negatives, O29, source, authority, terminality, replay, supersession, DOES_NOT_APPLY vs UNKNOWN, temporal, O49, atomicity) | 20 / 20 |
| `postgres-m16/l14-policy-applicability-concurrency.test.ts` (A–E, shared parallelism, dependency race orders 1 / 2, REVOKE not blocked, same command id, terminal race) | 12 / 12 |
| `postgres-m16/l14-policy-applicability-acl.test.ts` | 9 / 9 |
| `postgres-m16/l14-policy-applicability-regression.test.ts` (S1C.1 cardinality / O45 / O49, S1C.1R1 Party races, S1C.2 supersession / O49 / Domain races, family isolation) | 6 / 6 |
| Full M16 PostgreSQL 17 suite (`tests/postgres-m16/*.test.ts`, 70 files) | 1068 / 1068 |
| M15 PostgreSQL regression (`npm run test:postgres`) | 8 / 8 |
| Dashboard `npm test` (incl. `l14-policy-applicability-contract.test.ts` and the updated exact-list contract tests) | 1211 pass / 0 fail (5 skipped) |
| `@council/canonical-contracts` tests | 230 / 230 |
| `@council/governance-review` tests | 412 / 412 |
| `tsc --noEmit` dashboard / canonical-contracts / governance-review | clean |
| `git diff --check`; secret pattern scan | clean |

## Findings

- P0 / P1: none.
- P2: none.
- P3: (a) self-validation is evaluated for VALIDATE (as in S1C.1 / S1C.2); REJECT / DEFER / REVOKE by the submitter are governed by
  the ordinary rule match only. (b) In the production schema `relationship_id` is the primary key of `canonical_relationships`, so
  an ambiguous exact triple is only reachable by disposable sabotage; the fail-closed path is nonetheless implemented and tested.
