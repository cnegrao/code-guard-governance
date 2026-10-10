# M16-S1C.5 — CONTROL_ASSESSMENT (fifth and final authoritative M16 fact family)

Starting point: `origin/main` = `d6c21254395b2df79594c35eafc631fa2ae27d20` (the merge of PR #60,
`feat/m16-s1c4-control-applicability`), verified equal to the expected SHA before branching. Repository
`cnegrao/code-guard-governance`. Branch `feat/m16-s1c5-control-assessment` was created from exactly that commit with a clean
worktree. Architecture authority: `docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md` §§2-4, 6-9,
15-18, 20, 22-23 (O31, O38, O40, O49, O55). Implementation patterns reused: S1C.1 fact framework, S1C.3 POLICY_APPLICABILITY and
S1C.4 CONTROL_APPLICABILITY (lifecycle, guards, resolver, ACL closure).

## Recorded state

| Item | State |
|---|---|
| PR #60 / S1C.4 | MERGED (`d6c2125`) |
| `main` baseline at S1C.5 start | `d6c21254395b2df79594c35eafc631fa2ae27d20` |
| S1C.5 | IMPLEMENTED ON BRANCH `feat/m16-s1c5-control-assessment`; NOT MERGED; PR NOT OPENED |
| M16 authoritative fact families | 5 / 5 implemented on the branch; no sixth family |
| M17+ | NOT STARTED |
| Hosted | NOT TOUCHED |

## Environments — LOCAL / CI / HOSTED

- **LOCAL**: disposable PostgreSQL **17.10** clusters (server binaries from the npm package
  `@embedded-postgres/linux-x64@17.10.0-beta.17`; `psql` is the local PostgreSQL 16 client), passed as `M16_PG17_BIN`, run as an
  unprivileged OS user; the harness asserts `server_version_num` 17.x. pgvector is not installed locally (the harness's labelled
  stand-in type is used; the one HNSW statement is the only statement allowed to fail, asserted exactly). M15 ran on local
  PostgreSQL 16. All TypeScript / PG suites ran on **Node 24.21.0**.
- **CI**: GitHub Actions `M16 PostgreSQL 17 security suite` (PGDG PostgreSQL 17 + real pgvector) and `M15 PostgreSQL regression`
  on the pushed branch — reported to ACP on the exact final HEAD (not pre-recorded here).
- **HOSTED**: **NOT TOUCHED.** No Supabase hosted project, no Vercel, no deployment, no hosted migration.

## Model

- **Meaning**: a governed assessment of ONE exact VALIDATED CONTROL_APPLICABILITY state whose outcome is `APPLIES`. Stored
  outcomes are exactly `SATISFIED | PARTIALLY_SATISFIED | NOT_SATISFIED | NOT_ASSESSED | INSUFFICIENT_EVIDENCE` (CHECK on proposals
  and states; postflight-pinned). `WAIVED` is refused explicitly (`GV010 CONTROL_ASSESSMENT_WAIVED_UNSUPPORTED`; the only place
  the token appears); any other value is `CONTROL_ASSESSMENT_OUTCOME_UNKNOWN`. An explicit `NOT_ASSESSED` is a positive governed
  row; absence of a current valid assessment is `UNKNOWN` (no resolver row, never stored). No score / coverage / maturity /
  residual / waiver surface exists.
- **Pin**: the caller supplies only `control_applicability_state_id`. PostgreSQL resolves the immutable S1C.4 tuple of that state
  (target key, control definition id + version id + DB content hash, pinned VALIDATED CONTROL_DEFINITION state) and mirrors it on
  proposals and states, which carry a composite FK onto the existing S1C.4 pin key `l14_control_applicability_states_kind_unique`
  with constants `APPLIES` / `VALIDATED`: a DOES_NOT_APPLY, REVOKED, foreign or swapped tuple has no such row. SUBMIT refuses an
  unknown / foreign state (`CONTROL_APPLICABILITY_STATE_UNRESOLVED`), a tombstone (`CONTROL_APPLICABILITY_STATE_NOT_VALIDATED`) and
  a DOES_NOT_APPLY state (`CONTROL_APPLICABILITY_DOES_NOT_APPLY`). **No S1C.4 table, index, constraint or routine is altered.**
- **Logical key / head**: `organisation + control_applicability_state_id` (heads PK; postflight-pinned). Renewals and corrections
  (another outcome or valid_until) are append-only lineage successors; a successor may start before its predecessor's
  valid_until (closure derived, never written) but never before its start; a no-op successor (same outcome + valid_until) is
  `CONTROL_ASSESSMENT_ALREADY_VALIDATED`.
- **valid_until**: mandatory on VALIDATE (`VALID_UNTIL_REQUIRED`), refused on REVOKE (`VALID_UNTIL_NOT_PERMITTED`), strictly after
  effective_from (`EFFECTIVE_INTERVAL_INVALID`, also for an IMMEDIATE start at DECIDE). It is stored as the envelope
  `effective_to` — there is no separate valid_until column; the state guard requires `effective_to` on every VALIDATED assessment.
  Validity is `[effective_from, valid_until)`; expiry writes nothing and a head never overrides it.
- **No carry-over**: DECIDE VALIDATE (and the state guard at the state's own coordinates) requires
  `l14_control_applicability_valid_state_v1` (S1C.4, reused unchanged) to return exactly the pinned state with `APPLIES` at the
  assessment's effective_from — so a superseded, revoked, expired, not-yet-effective, target-invalid or CONTROL_DEFINITION-invalid
  applicability refuses (`GV010 CONTROL_APPLICABILITY_DEPENDENCY_NOT_VALID`, nothing consumed). The resolver
  `l14_control_assessment_valid_state_v1` re-checks the same applicability at the read coordinates; the bounded current read
  `l14_control_assessments_current_v1` returns, per control definition whose CURRENT applicability is APPLIES, only the assessment
  of exactly that applicability state. A successor applicability starts without a current assessment; DOES_NOT_APPLY never yields
  a row.
- **CONTROL_FINDING**: not a family — no subject kind, head, table or routine; postflight forbids `l14_%finding%` relations /
  routines and any FINDING token in closed CHECKs. (ADR §3 says finding detail MAY exist; no finding detail is introduced in this
  slice — see Findings.)

## Fact framework delta (shared, no parallel framework)

- `l14_fact_states.subject_kind` CHECK: exactly the five families (adds `CONTROL_ASSESSMENT`).
- `l14_command_results`: fact branch covers the five families (other branches verbatim); no new column.
- `l14_governance_decisions`: subject + `CONTROL_ASSESSMENT_{VALIDATED,REJECTED,DEFERRED,REVOKED}`.
- `l14_authorization_decisions`: new CHECK — a CONTROL_ASSESSMENT request is one exact `CANONICAL_OBJECT` or `RELATIONSHIP_STATE`
  (the pinned applicability's target).
- `l14_lock_fact_subject_guard_v1`: the only `CREATE OR REPLACE` — vocabulary gains `CONTROL_ASSESSMENT`; same signature / owner /
  ACL / config / key derivation.
- Reused unchanged: S1C.1 object evaluator, S1C.3 relationship-state evaluator + exact-triple resolver, S1C.4 resolver / current
  read / CD shared dependency guard. The ACL suite's routine digest proves every pre-S1C.5 routine is byte-identical except the
  fact guard; table / constraint / row digests prove no S1C.4 (or earlier) structure or row changed; historical S1C.1 / S1C.3 /
  S1C.4 commands replay their original results.

## Authority

- Permission `L14_CONTROL_ASSESSMENT_VALIDATE` (pre-existing S1A vocabulary); requested action = exact governance outcome (ADR §7
  closed action vocabulary); the assessment outcome is bound by the proposal and both fingerprints.
- Scope = the exact target of the pinned applicability state (object kind + id, or relationship id + state id + DB-resolved
  type), never changing the pin. Applicability / CD / AP administrators hold no assessment authority. CANONICAL_* scopes never
  authorize a relationship state and vice versa; self-validation, BACKDATED and FUTURE_DATED need explicit permission; DENY is
  durable and replayable.
- Source: LOCAL_HUMAN only (RPC + proposal guard); the generic S1A proposal RPC still refuses every fact family.

## Commit boundary / concurrency

- `l14_lock_control_applicability_dependency_guard_shared_v1(org, target_key, control_definition_id)`: owner-only SECURITY
  INVOKER; `pg_advisory_xact_lock_shared` over `frame_identity([org, 'l14-fact-subject-guard-v1', 'CONTROL_APPLICABILITY', 'KEY',
  target_key, control_definition_id])` — byte-identical to the key the S1C.4 SUBMIT / DECIDE take EXCLUSIVELY. No new namespace.
- DECIDE VALIDATE lock order: AP SHARED → CD registry subject SHARED (S1B.6 key, as S1C.4) → applicability KEY SHARED →
  assessment KEY EXCLUSIVE → command. S1C.4: AP → [CD SHARED] → applicability KEY EXCLUSIVE → command. No cycle. REVOKE / REJECT /
  DEFER take no dependency guard.
- Real PG17 backends: first-state race (GV009, loser consumes nothing), successor race from one expected state, applicability
  REVOKE race order 1 (assessment GV010) and order 2 (assessment commits first, then becomes historical; earlier coordinates
  resolve), applicability SUPERSESSION in flight (GV010, no successor selected), CD REVOKE race (GV010), `pg_locks` shows the
  assessment holding the exact S1C.4 key in ShareLock and the S1C.4 exclusive guard blocking on it, assessment REVOKE never blocked
  by held applicability / CD guards, same command id replay, terminal race.

## Surface / security

- Application SECURITY DEFINER surface **41 → 43** (`l14_submit_control_assessment_proposal_v1`,
  `l14_decide_control_assessment_proposal_v1`; postgres-owned; ACL exactly `{postgres=X/postgres,service_role=X/postgres}`;
  config `search_path=pg_catalog, pg_temp;lock_timeout=5s`; body hashes pinned in the postflight); canonical-owner
  (policy-store-capable) class **31 → 33**; measured on the live catalog (inventory + `SURFACE_SPLIT_SQL` = `43|0`).
- Owner-only SECURITY INVOKER: proposal / state / head guards, applicability dependency guard, result projection, resolver,
  current read; widened fact guard keeps its owner-only ACL.
- New tables: RLS on, no policy, REVOKE ALL from PUBLIC / anon / authenticated / service_role; history raises on
  UPDATE / DELETE / TRUNCATE; head RPC-only (guarded CAS).
- ACL suite: preflight break classes + pre-existing history abort atomically; **94** rolled-back postflight negative controls
  (table / column / sequence / view / default-ACL / inheritance / RLS privilege classes; definer surface, overload, body / owner /
  config drift; dependency guard mode / namespace / key; S1C.4 key-producer drift; reused S1C.4 resolver drift; lock order
  inversion; WAIVED refusal removed; immutability / structural guards; applicability pin FK dropped / narrowed / NOT VALID /
  deferrable; cascading FK; head key replaced by a target / control pair or widened; outcome CHECK widened with WAIVED / UNKNOWN or
  narrowed; DOES_NOT_APPLY pin; valid_until made optional; fact interval relaxed; CONTROL_FINDING as a sixth subject / guard
  vocabulary / table / routine; rationale / score / second valid_until / JSON columns; reading legacy `control_assessments`,
  `canonical_relationships` or the CD registry; mutating applicability history; canonical kind / relationship type added; F2).

## F2 / vocabularies / families

- **F2: NOT TOUCHED.** S1C.5 executable SQL never names `canonical_relationships`; postflight H11 + ACL F2 digest byte-identical.
- 11 canonical object kinds / 12 governed relationship types unchanged.
- Fact families: **5** (`RESPONSIBILITY_ASSIGNMENT`, `BUSINESS_CONTEXT_ASSIGNMENT`, `POLICY_APPLICABILITY`, `CONTROL_APPLICABILITY`,
  `CONTROL_ASSESSMENT`). The legacy `gov_repo.control_assessments` / `control_findings` tables remain quarantined (never read).

## Tests (LOCAL)

Code commits under test: `07f8dec` (migration), `79f43f7` (contracts / adapter), `d9e6ce6` (tests); the evidence / roadmap commit
changes documentation only.

| Suite | Result |
|---|---|
| `postgres-m16/l14-control-assessment.test.ts` (functional: no auto-promotion / five families / no CONTROL_FINDING, 11-kind object applicabilities, relationship-state applicability, exact pin negatives + FK backstop, five outcomes / WAIVED / UNKNOWN, valid_until + expiry, source, authority, terminality, replay, renewal / correction, no carry-over, applicability validity at effective_from, temporal, atomicity) | 16 / 16 |
| `postgres-m16/l14-control-assessment-concurrency.test.ts` (first-state race, successor race, applicability race orders 1 / 1b / 2, shared S1C.4 key in `pg_locks`, CD race, REVOKE not blocked, same command id, terminal race) | 11 / 11 |
| `postgres-m16/l14-control-assessment-acl.test.ts` (preflight break classes + history, apply-once + byte-identical digests + replays, surface 41 → 43 / 31 → 33, privilege closure, history immutability, structural, 94 postflight negative controls, source scan) | 9 / 9 |
| `postgres-m16/l14-control-assessment-regression.test.ts` (S1C.1 / S1C.1R1 / S1C.2 / S1C.3 / S1B.6 / S1C.4 lifecycles + race orders on the S1C.5 catalog, assessments never touch applicability rows, five-family isolation) | 10 / 10 |
| Full M16 PostgreSQL 17 suite (`tests/postgres-m16/*.test.ts`, 76 files, Node 24.21.0, wall 9m01s) | 1165 / 1165 (baseline 1119 + 46) |
| M15 PostgreSQL regression (`npm run test:postgres`, PostgreSQL 16) | 8 / 8 |
| Dashboard `npm test` (incl. `l14-control-assessment-contract.test.ts` and the updated exact-list contract tests) | 1228 tests: 1223 pass / 0 fail / 5 skipped (pre-existing); passport-ui 15 / 15; pre-demo-ui 8 / 8 |
| `@council/canonical-contracts` tests | 230 / 230 |
| `@council/governance-review` tests | 412 / 412 |
| `tsc --noEmit` dashboard / canonical-contracts / governance-review | clean |
| `git diff --check` | clean |
| Secret pattern scan over the diff (API keys, tokens, private keys, JWTs, credentialed DSNs, passwords) | no match |

## CI

Branch CI is triggered by the push (`M16 PostgreSQL 17 security suite`, `M15 PostgreSQL regression`). The arbiter is the run on
the exact final branch HEAD; its result is reported to ACP and not pre-recorded here.

## Findings

- P0 / P1 / P2: none.
- P3 (interpretation): ADR §3 / §15 permit CONTROL_FINDING only as normalized detail of one assessment state ("MAY"). The frozen ADR
  defines no finding vocabulary or columns, so this slice introduces no finding detail (inventing one would exceed the ADR);
  structurally CONTROL_FINDING can never become a family, head or independent authority surface. Supporting evidence attaches to the
  assessment state through the existing normalized `FACT_STATE` support links. A finding detail, if wanted, needs an ADR-defined
  shape in a later slice.
- P3 (interpretation, per-family rule): unlike S1C.4 (where a successor may not start before the predecessor's explicit
  effective_to), an assessment renewal / correction may start before the predecessor's valid_until — every assessment has a
  mandatory end, and ADR §15 requires renewals / corrections as appended successors; the predecessor's closure is derived from the
  visible successor and its stored valid_until is never edited.
- P3 (carried): requested action is the exact governance outcome (ADR §7 closed vocabulary), as in S1C.3 / S1C.4.
