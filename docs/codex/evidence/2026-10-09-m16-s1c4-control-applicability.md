# M16-S1C.4 — CONTROL_APPLICABILITY (fourth authoritative M16 fact family)

Starting point: `origin/main` = `a29bec2fd38e2f15670379f5af7588a9aba44151` (the merge of PR #59,
`feat/m16-s1c3-policy-applicability`). Repository verified as `cnegrao/code-guard-governance`; open PRs = 0 at ACP verification.
Branch `feat/m16-s1c4-control-applicability` was created from exactly that commit with a clean worktree. Architecture authority:
`docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md` §§2-4, 6-9, 14, 16-18, 20, 22-23 (O30, O49).
Implementation patterns reused: S1B.6 CONTROL_DEFINITION registry (dependency contract), S1C.1 fact framework, S1C.1R1 dependency
commit guard, S1C.3 POLICY_APPLICABILITY (target union, relationship-state resolver / evaluator, lifecycle).

## Recorded state

| Item | State |
|---|---|
| PR #59 | MERGED (`a29bec2`) |
| S1C.1 / S1C.1R1 / S1C.2 / S1C.3 | MERGED |
| `main` baseline at S1C.4 start | `a29bec2fd38e2f15670379f5af7588a9aba44151` |
| S1C.4 | IMPLEMENTED ON BRANCH `feat/m16-s1c4-control-applicability`; NOT MERGED |
| Remaining M16 authoritative fact family | CONTROL_ASSESSMENT — NOT IMPLEMENTED |
| M17+ | NOT STARTED |
| Hosted | NOT TOUCHED |

## Environments — LOCAL / CI / HOSTED

- **LOCAL**: disposable PostgreSQL **17.10** clusters (server binaries from the npm package
  `@embedded-postgres/linux-x64@17.10.0-beta.17`, because the PGDG apt host / `www.postgresql.org` are blocked (HTTP 403) by the
  session network policy; `psql` is the local PostgreSQL 16 client), passed as `M16_PG17_BIN`, run as an unprivileged OS user
  (`initdb` refuses root); the harness asserts `server_version_num` 17.x. pgvector is not installed locally (the harness's
  labelled stand-in type is used; the one HNSW statement is the only statement allowed to fail, asserted exactly). M15 ran on
  local PostgreSQL 16 (as its CI job uses the ubuntu-24.04 runner default). All TypeScript / PG suites ran on **Node 24.21.0**
  (npm package `node-linux-x64@24.21.0`), matching CI's Node 24.
- **CI**: GitHub Actions `M16 PostgreSQL 17 security suite` (PGDG PostgreSQL 17 + real pgvector) and `M15 PostgreSQL regression`
  on the pushed branch — see the CI section.
- **HOSTED**: **NOT TOUCHED.** No Supabase hosted project (DEV / TEST), no Vercel, no deployment, no hosted migration, no
  Vercel protection change.

## Model

- **Meaning**: one exact VALIDATED ControlDefinition version either `APPLIES` or `DOES_NOT_APPLY` to one exact governed target.
  Absence of a current valid governed fact is `UNKNOWN` (no resolver row) — never stored, never `DOES_NOT_APPLY`. A validated
  `DOES_NOT_APPLY` is a positive governed row. Stored vocabulary is exactly `APPLIES | DOES_NOT_APPLY` (CHECK on proposals and
  states; postflight-pinned; `PARTIAL` / `SATISFIED` / `UNKNOWN` / `WAIVED` / … refused).
- **Target**: the SAME closed typed union as S1C.3 (`CANONICAL_OBJECT` kind + id over all 11 kinds, FK onto
  `canonical_objects (organisation, id, kind)`; `RELATIONSHIP_STATE` relationship id + relationship state id resolved by the
  **reused, unchanged** S1C.3 `l14_resolve_relationship_state_target_v1`, exact triple, 0 = unresolved / >1 = ambiguous, fail
  closed). A family-owned injective IMMUTABLE encoder `l14_control_applicability_target_key_v1` (byte-identical encoding)
  generates the NOT NULL `target_key` on all three tables. Relationship type is DB-resolved for Authority Policy scope only.
- **Control identity**: S1B.6 `control_definition_id`. **Exact version**: `control_definition_id + control_definition_version_id +
  content_hash` (DB-computed). **Dependency**: `control_definition_validated_state_id`, the exact S1B.6 VALIDATED state.
- **Logical key / head**: `organisation + target_key + control_definition_id` (heads PK; postflight-pinned; no version / hash /
  dependency / outcome column on the head). Version or outcome changes are lineage successors of the same key.

## Fact framework delta (shared, no parallel framework)

- `l14_fact_states.subject_kind` CHECK: exactly `RESPONSIBILITY_ASSIGNMENT`, `BUSINESS_CONTEXT_ASSIGNMENT`, `POLICY_APPLICABILITY`,
  `CONTROL_APPLICABILITY` (CONTROL_ASSESSMENT absent — postflight + ACL negative control).
- `l14_command_results`: the fact branch now covers the four families (other branches verbatim); no new column.
- `l14_governance_decisions`: subject + `CONTROL_APPLICABILITY_{VALIDATED,REJECTED,DEFERRED,REVOKED}`.
- `l14_authorization_decisions`: new CHECK — a CONTROL_APPLICABILITY request is one exact `CANONICAL_OBJECT` or one exact
  `RELATIONSHIP_STATE` (existing S1B.0 request-target shape; no FK onto the F2 table).
- `l14_proposals`, `l14_support_links`: unchanged (`CONTROL_APPLICABILITY` was already in the S1A proposal vocabulary; the
  `FACT_STATE` support owner is reused).
- `l14_lock_fact_subject_guard_v1`: the only `CREATE OR REPLACE` — closed vocabulary gains `CONTROL_APPLICABILITY`; same
  signature / owner / owner-only ACL / config / key derivation.
- Reused unchanged: `l14_evaluate_target_authority_rules_v1` (objects), `l14_evaluate_relationship_state_authority_rules_v1`
  and `l14_resolve_relationship_state_target_v1` (S1C.3). The ACL suite's routine digest proves every pre-S1C.4 routine
  (incl. all S1C.3 routines) is byte-identical except the widened fact guard; row / constraint / table digests over seeded
  S1B.4 / S1B.6 / S1C.1 / S1C.2 / S1C.3 history prove no rewrite; historical commands replay their original results.

## Control dependency / O30

- Proposals and states carry a composite FK `(organisation, control_definition_validated_state_id, control_definition_id,
  control_definition_version_id, content_hash, 'VALIDATED')` → `l14_control_definition_states_kind_unique` (the key S1B.6
  published for this slice), which itself FK-pins the admitted version tuple including the DB hash. The head FK-pins the S1B.6
  identity `l14_control_definitions (organisation, control_definition_id)`.
- SUBMIT resolves: identity (`CONTROL_DEFINITION_UNRESOLVED`), admitted version of THAT identity with THAT hash
  (`CONTROL_DEFINITION_VERSION_UNRESOLVED`), a VALIDATED S1B.6 state of the exact tuple (`CONTROL_DEFINITION_DEPENDENCY_UNRESOLVED`).
- DECIDE VALIDATE requires `l14_control_definition_valid_state_v1(org, control, version, hash, effective_from, now)` to return
  exactly the pinned state (`GV010 CONTROL_DEFINITION_DEPENDENCY_NOT_VALID`), under the shared dependency guard; the state guard
  re-checks at the state's own coordinates; the resolver re-checks at the read coordinates.
- Proven (functional suite): unadmitted control, foreign tenant, wrong control / version id, foreign version, admitted-never-
  validated version, another version's / another control's / foreign state, a REVOKED tombstone state, a revoked version, a stale
  (revoked) validation state, a future-not-effective validation, one-nibble hash change, another version's hash, another
  control's hash, a valid-looking SHA-256 of forged CG-AG content, a random digest, uppercase hex, **same content on another
  version** (identical DB hash, version resolves, V1's state refused), **another control with the same code / content**
  (identical hash; its state never authorizes this control and vice versa) — every case GV010 with nothing written. The RPC
  signatures contain no code / title / description / cg_* / score / flag parameter; no S1C.4 routine reads control content,
  `cg_*`, CG-AG, scores, scanner or LLM surfaces (postflight H5 + ACL body scan). A later admitted / validated version never
  changes what a V1 applicability pins (no "latest" pointer).

## Dependency commit boundary

- `l14_lock_control_definition_dependency_guard_shared_v1(org, control, version, hash)`: owner-only SECURITY INVOKER;
  `pg_advisory_xact_lock_shared(hashtextextended(frame_identity([org, 'l14-registry-subject-guard-v1', 'CONTROL_DEFINITION',
  'CONTROL_DEFINITION_VALIDATION:' || control || ':' || version || ':' || hash]), 0))` — byte-identical to the key the S1B.6
  SUBMIT / DECIDE RPCs pass to `l14_lock_registry_subject_guard_v1` (EXCLUSIVE). No new namespace; the pinned state id is NOT in
  the key (as in S1B.6). Held to commit.
- DECIDE order (VALIDATE): AP guard SHARED → CONTROL_DEFINITION dependency SHARED → fact KEY (`target_key + control_definition_id`)
  EXCLUSIVE → command. S1B.6 order: AP SHARED → registry subject EXCLUSIVE → command. No cycle. REVOKE / REJECT / DEFER do not
  take the dependency guard and never check dependency validity.
- Real PG17 backends (`l14-control-applicability-concurrency.test.ts`, blocking observed via `pg_stat_activity` +
  `pg_blocking_pids`): race order 1 (CD REVOKE holds the exclusive guard; VALIDATE waits, then GV010
  `CONTROL_DEFINITION_DEPENDENCY_NOT_VALID`; no authorization / decision / fact / typed state / head / support / result consumed),
  race order 2 (VALIDATE holds the shared guard; CD REVOKE waits and commits after; current → UNKNOWN; history byte-identical;
  earlier coordinates resolve), shared parallelism (two VALIDATEs on the same version, different keys, hold the guard at once —
  `pg_locks` shows 2 × ShareLock on the exact key), REVOKE never waits on an in-flight CD decision, and REVOKE of an
  applicability whose dependency is already revoked succeeds while a CD re-validation holds the exclusive guard.

## Authority

- Permission `L14_CONTROL_APPLICABILITY_VALIDATE` (pre-existing in the S1A closed permission vocabulary). Requested action = the
  exact governance outcome (`VALIDATE | REJECT | DEFER | REVOKE`): the ADR §7 closed requested-action vocabulary and the
  `l14_authority_policy_rules.requested_action` CHECK admit only `ADMIT | VALIDATE | REJECT | DEFER | REVOKE`, so the
  `APPLIES | DOES_NOT_APPLY` outcome is carried by the proposal and bound by the fingerprint, exactly as in S1C.3.
- Object targets: S1C.1 evaluator; relationship-state targets: S1C.3 evaluator (both reused unchanged). CANONICAL_* scopes never
  authorize a relationship state; RELATIONSHIP_* never authorize an object (both directions tested); relationship-type scope
  confers no fact on other states.
- Self-validation fails closed unless explicitly allowed for the exact action + scope; BACKDATED / FUTURE_DATED need explicit
  permission; DENY is durable and replayable; authority change requires a new command id.
- Source: LOCAL_HUMAN only (RPC + proposal guard trigger); SYSTEM_SEED / SOURCE_CONNECTION / scanner / LLM / mapping refused.

## Supersession / temporal / O49

- C/V1/APPLIES → C/V2/APPLIES, APPLIES → DOES_NOT_APPLY (same version), DOES_NOT_APPLY → APPLIES (new version) are same-key lineage
  successors; the head advances; the predecessor is byte-identical (xmin / ctid); closure derived; earlier cutoffs never see a
  later successor; a future successor never hides its predecessor early. A no-op successor is
  `CONTROL_APPLICABILITY_ALREADY_VALIDATED` (GV010).
- ADR §17 temporal rules (IMMEDIATE = DB instant; explicit past / future need permission; immutable `effective_to > effective_from`;
  REVOKE has no end of its own; GV011 continuity errors); a backdated / future applicability needs its dependency valid then.
- O49 (object APPLIES + relationship-state DOES_NOT_APPLY): CS1 revoked → history byte-identical, current UNKNOWN, earlier cutoff /
  instant retains; **a newly VALIDATED V2 does not auto-repin**; **a re-validation CS2 of V1 does not auto-repin**; a stale CS1
  pin is refused (nothing consumed); restoration is a NEW governed successor (pinning V2, or pinning CS2); an applicability whose
  dependency became invalid can still be REVOKED, DEFERRED or REJECTED.

## Surface / security

- Application SECURITY DEFINER surface **39 → 41** (`l14_submit_control_applicability_proposal_v1`,
  `l14_decide_control_applicability_proposal_v1`; postgres-owned; ACL exactly `{postgres=X/postgres,service_role=X/postgres}`;
  config `search_path=pg_catalog, pg_temp;lock_timeout=5s`; body hashes pinned in the postflight); canonical-owner
  (policy-store-capable) class **29 → 31** — measured on the live disposable PG17 catalog (inventory + `SURFACE_SPLIT_SQL` =
  `41|0`), matching the expectation; neither new body reaches a policy store (text + `pg_depend`).
- Owner-only SECURITY INVOKER (no application EXECUTE): target-key encoder, proposal / state / head guards, dependency guard,
  result projection, bitemporal resolver, bounded current read; the widened fact guard keeps its owner-only ACL.
- New tables: RLS on, no policy, REVOKE ALL from PUBLIC / anon / authenticated / service_role; history raises on
  UPDATE / DELETE / TRUNCATE; the head is RPC-only (guarded CAS).
- ACL suite: 9 preflight break classes + pre-existing history abort atomically; 100 rolled-back postflight negative controls
  (service_role SELECT / INSERT / UPDATE / DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN, column grants, sequence leak, readable
  and writable nested views, table / routine default-ACL reintroduction, role inheritance, permissive RLS, RLS disabled, PUBLIC /
  anon / authenticated EXECUTE, unexpected definers, overload, body / owner / search_path / lock_timeout drift, RPC made INVOKER,
  helpers made executable / DEFINER, dependency guard EXCLUSIVE / other namespace / POLICY_VERSION subject / key without hash,
  guard removed from DECIDE, lock order inverted, S1B.6 key-producer drift, fact / dependency FK dropped / narrowed / NOT VALID /
  deferrable, cascading FK, head key widened / narrowed, union / type / applicability CHECK relaxation, fact subject / governance
  subject / fact guard widened with CONTROL_ASSESSMENT, non-injective encoder, rationale / control_code / cg_* / relationship_type
  / JSON columns, canonical kind / relationship type added (CONTROL / CONTROLLED_BY), F2 trigger / FK / unique / CHECK, a new
  routine reading `canonical_relationships` or control content). F2 structural digest byte-identical.

## F2 / vocabularies / families

- **F2: NOT TOUCHED.** S1C.4 SQL never names `canonical_relationships` (the reused S1C.3 resolver reads it); no DDL / DML / FK /
  uniqueness / trigger; postflight H11 + ACL F2 digest.
- 11 canonical object kinds / 12 governed relationship types unchanged; no CONTROLLED_BY / APPLIES_CONTROL / SUBJECT_TO_CONTROL.
- Fact families: 4 implemented (`RESPONSIBILITY_ASSIGNMENT`, `BUSINESS_CONTEXT_ASSIGNMENT`, `POLICY_APPLICABILITY`,
  `CONTROL_APPLICABILITY`); **CONTROL_ASSESSMENT NOT IMPLEMENTED** (no table / routine; refused by the envelope CHECK, the fact
  guard and the generic proposal RPC).

## Tests (LOCAL)

Code commits under test: `a7d16fd` (migration), `d29db9f` (contracts / adapter), `3458fe1` (tests); this evidence / roadmap commit
changes documentation only.

| Suite | Result |
|---|---|
| `postgres-m16/l14-control-applicability.test.ts` (functional: no auto-promotion / CONTROL_ASSESSMENT absent, 11-kind object matrix, object identity negatives, relationship-state matrix + read boundary + ambiguity, control dependency negatives, O30 A–H, source, authority, terminality, replay, supersession, outcome supersession, DOES_NOT_APPLY vs UNKNOWN, future successor, temporal, O49, atomicity) | 20 / 20 |
| `postgres-m16/l14-control-applicability-concurrency.test.ts` (A–E, shared parallelism in `pg_locks`, dependency race orders 1 / 2, REVOKE not blocked by an in-flight CD decision, REVOKE with an already-revoked dependency, same command id, terminal race) | 13 / 13 |
| `postgres-m16/l14-control-applicability-acl.test.ts` (preflight 9 classes + history, apply-once + byte-identical digests + replays, surface 39 → 41 / 29 → 31, privilege closure, history immutability, structural, 100 postflight negative controls, source scan) | 9 / 9 |
| `postgres-m16/l14-control-applicability-regression.test.ts` (S1C.1 cardinality / O45 / O49, S1C.1R1 Party races 1 / 2, S1C.2 supersession / O49 / Domain races, S1C.3 supersession / O49 / POLICY_VERSION races, S1B.6 lifecycle, S1C.3 ↔ S1C.4 isolation, four-family isolation) | 9 / 9 |
| Full M16 PostgreSQL 17 suite (`tests/postgres-m16/*.test.ts`, 74 files, Node 24.21.0, wall 10m01s) | 1119 / 1119 (baseline 1068 + 51) |
| M15 PostgreSQL regression (`npm run test:postgres`, PostgreSQL 16) | 8 / 8 |
| Dashboard `npm test` (incl. `l14-control-applicability-contract.test.ts` and the updated exact-list contract tests) | 1222 tests: 1217 pass / 0 fail / 5 skipped (pre-existing); passport-ui 15 / 15; pre-demo-ui 8 / 8 |
| `@council/canonical-contracts` tests | 230 / 230 |
| `@council/governance-review` tests | 412 / 412 |
| `tsc --noEmit` dashboard / canonical-contracts / governance-review | clean |
| `git diff --check` | clean |
| Secret pattern scan over the diff (API keys, tokens, private keys, JWTs, credentialed DSNs, passwords) | no match |

## CI

Branch CI is triggered by every push (`M16 PostgreSQL 17 security suite`, `M15 PostgreSQL regression`). The arbiter is the run on
the exact final branch HEAD; its result is reported in the S1C.4 delivery report to ACP and is not pre-recorded here (a green
run on an earlier commit is not final evidence).

## Findings

- P0 / P1 / P2: none.
- P3 (interpretation, recorded for ACP): the slice brief's "requested action for validation is the exact applicability outcome"
  is implemented exactly as S1C.3 does it — the Authority Policy requested action is the exact governance outcome, because the
  frozen ADR §7 closed requested-action vocabulary (`ADMIT | VALIDATE | REJECT | DEFER | REVOKE`) and the S1A rule CHECK do not
  admit `APPLIES` / `DOES_NOT_APPLY`; the applicability outcome is bound by the proposal and both fingerprints.
- P3 (carried from S1C.3): self-validation is evaluated for VALIDATE; an ambiguous exact relationship-state triple is only
  reachable by disposable sabotage (`relationship_id` is the F2 primary key), yet the fail-closed path is implemented and tested.
