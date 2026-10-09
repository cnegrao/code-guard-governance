# M16-S1C.2 — BUSINESS_CONTEXT_ASSIGNMENT (second authoritative M16 fact family)

Starting point: `origin/main` = `6fe5c57bd1ea7f92e2804292de3ab6de931ec4a1` (the merge of PR #57,
`feat/m16-s1c1-responsibility-assignment`). Branch `feat/m16-s1c2-business-context-assignment` was created from exactly that
commit with a clean worktree. Architecture authority: `docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md`
§§2-4, 6-10, 12, 16-18, 20, 22-23. Implementation patterns reused: S1B.5 domain registries, S1C.1 fact framework.

## Recorded state

| Item | State |
|---|---|
| PR #57 (`feat/m16-s1c1-responsibility-assignment`) | MERGED (`6fe5c57`) |
| S1C.1 | MERGED |
| `main` baseline at S1C.2 start | `6fe5c57bd1ea7f92e2804292de3ab6de931ec4a1` |
| S1C.2 | IMPLEMENTED ON BRANCH `feat/m16-s1c2-business-context-assignment`; NOT MERGED |
| Remaining fact families | POLICY_APPLICABILITY, CONTROL_APPLICABILITY, CONTROL_ASSESSMENT — NOT IMPLEMENTED |
| M17+ | NOT STARTED |
| H1 | CLOSED ON EQUIVALENT HOSTED EVIDENCE |
| `B0_HTTP_MANUAL_ACCEPTANCE` | PASS |
| `REAL_HTTP_H1_PASS` | NOT EMITTED |

## Environments — LOCAL / CI / HOSTED

- **LOCAL**: disposable PostgreSQL **17.6** clusters (server binaries from the npm package
  `@embedded-postgres/linux-x64@17.6.0-beta.15` because the PGDG apt host is blocked by the session network policy; `psql`
  is the local PostgreSQL 16 client), passed as `M16_PG17_BIN`, run as an unprivileged OS user; the harness asserts
  `server_version_num` 17.x. pgvector is not installed locally (the harness's labelled stand-in type is used). M15 ran on
  local PostgreSQL 16 (its CI job also uses the runner default). TypeScript suites ran on Node **24.21.0**.
- **CI**: GitHub Actions `M16 PostgreSQL 17 security suite` (PGDG PostgreSQL 17 + real pgvector) and `M15 PostgreSQL
  regression`, on the pushed branch (see "CI").
- **HOSTED**: **NOT TOUCHED.** No Supabase hosted project, no Vercel, no deployment, no hosted migration.

## Model

- **Meaning**: an exact governed canonical target has ONE governed domain assignment for ONE semantic kind at a business
  instant. An L14 fact — never a canonical relationship / object, label, free-text category, scanner classification,
  AgentVersion attribute, inherited domain or BusinessTerm assignment.
- **Target**: exact `organisation_id + target_kind + target_canonical_object_id`, FK-resolved against `canonical_objects`.
- **Semantic kinds**: exactly the existing L6 kinds `BUSINESS_DOMAIN | INFORMATION_DOMAIN` (the S1B.5 subject kinds).
- **Closed matrix**: AGENT → BUSINESS_DOMAIN; DATA_ASSET → BUSINESS_DOMAIN | INFORMATION_DOMAIN; DATA_ELEMENT →
  INFORMATION_DOMAIN. Everything else (AGENT + INFORMATION, DATA_ELEMENT + BUSINESS, AGENT_VERSION, MODEL, TOOL, MCP_SERVER,
  API, PROMPT, KNOWLEDGE_BASE, SKILL, unknown kinds) is rejected (CHECK on proposals and states, RPC, TS mirror).
- **Domain identity**: the S1B.5 / L6 `domain_id` of an admitted domain. `domain_validated_state_id` is dependency lineage
  only; composite FK to the exact VALIDATED `l14_domain_states` row of the same organisation, kind and domain.
- **Logical key / head**: `organisation + target_kind + target_canonical_object_id + semantic_kind` — the domain id is NOT
  part of the key (`l14_business_context_assignment_heads` primary key; postflight-pinned).

## Fact framework delta (shared, no parallel framework)

- `l14_fact_states.subject_kind` CHECK: exactly `RESPONSIBILITY_ASSIGNMENT`, `BUSINESS_CONTEXT_ASSIGNMENT`.
- `l14_command_results`: the S1C.1 fact branch now covers both families (other branches verbatim); no new column.
- `l14_governance_decisions`: subject + four `BUSINESS_CONTEXT_ASSIGNMENT_*` reason codes (S1B.0 subject × outcome rule).
- `l14_authorization_decisions`: new CHECK — a BUSINESS_CONTEXT_ASSIGNMENT request is one exact CANONICAL_OBJECT of a legal
  kind. `l14_proposals` already admitted the subject (S1A); unchanged.
- `l14_support_links`: unchanged — the S1C.1 `FACT_STATE` owner is reused.
- `l14_lock_fact_subject_guard_v1`: the only `CREATE OR REPLACE` — closed subject vocabulary gains the second family; same
  signature, owner, owner-only ACL, config and key derivation (the RESPONSIBILITY key space is unchanged).
- `l14_evaluate_target_authority_rules_v1`: reused unchanged.
- No historical row rewritten (ACL suite row / constraint / routine digests).

## Supersession and temporal semantics

- A VALIDATE on a key whose head is VALIDATED appends a lineage **successor** (another domain, or a new dependency state of
  the same domain), with `EXPECTED_CURRENT = predecessor`. The predecessor row is never touched (envelope + detail
  byte-identical incl. `xmin` / `ctid`; no UPDATE / DELETE counters). Same domain + same dependency on an open-ended key:
  `GV010 BUSINESS_CONTEXT_ASSIGNMENT_ALREADY_VALIDATED`.
- Closure is **derived**: the resolver drops a VALIDATED state once a lineage successor (supersession or exact REVOKED
  tombstone) recorded ≤ cutoff has `effective_from` ≤ the instant. A later-recorded successor never leaks into an earlier
  cutoff; a future successor never hides the current predecessor.
- Successor start: ≥ predecessor start (`GV011 SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE`) and ≥ explicit predecessor end
  (`GV011 SUCCESSOR_BEFORE_PREDECESSOR_END`); exactly at the end passes; after it leaves an UNKNOWN gap.
- Omitted start = DB transaction instant; explicit past = BACKDATED permission; explicit future = FUTURE_DATED; no skew.
  `effective_to` optional, immutable, fingerprinted, `> effective_from`; expiry → UNKNOWN without UPDATE. REVOKE carries no
  end and must fall in `[target.from, target.to)`.

## Domain dependency, concurrency and O49

- At decision time the pinned state must equal `l14_domain_valid_state_v1(org, kind, domain, effective_from, now)`
  (`GV010 DOMAIN_DEPENDENCY_NOT_VALID`); the state guard re-checks at the state's own coordinates.
- **Lock order of DECIDE**: Authority Policy guard SHARED → exact domain registry subject guard **SHARED**
  (`l14_lock_domain_dependency_guard_shared_v1`, byte-identical key to the S1B.5 exclusive guard) → exact business-context
  fact KEY guard → command guard. S1B.5 domain decisions take AP SHARED → the same key EXCLUSIVE → command, so no cycle
  exists; assignments pinning one domain never serialize on each other; a domain revocation and an assignment serialize.
- Proven with real two-backend races in both orders: revocation first → the waiting assignment fails `DOMAIN_DEPENDENCY_NOT_VALID`
  and consumes nothing; assignment first → the revocation waits, commits later, and the resolver then returns UNKNOWN.
- O49 end to end: domain revocation leaves business-context history byte-identical; UNKNOWN at ≥ T with a cutoff seeing it;
  earlier cutoffs keep the fact; re-validation mints DS2; the old fact stays pinned to DS1 (no repin); restoration is a new
  governed successor pinning DS2.

## Security definer surface (effective catalog)

| | Before (merged S1C.1) | After (S1C.2) |
|---|---|---|
| Approved application SECURITY DEFINER routines | 35 | 37 |
| Canonical-owner (policy-store-capable `postgres`) class | 25 | 27 |

New: `l14_submit_business_context_assignment_proposal_v1` (`394b272b…`), `l14_decide_business_context_assignment_proposal_v1`
(`e6370ee8…`); full hashes pinned in the postflight and asserted against the live catalog. Neither body references a policy
store, the control-definition registry, Party PII, the responsibility family or `canonical_relationships`; domain registry
access is READ-only (admission, exact state, resolver, guard key).

## Legacy / discovery boundary

Legacy free-text domain sources exist: `gov_repo.agents.business_domain`, `gov_repo.ai_systems.business_domain`
(+ `v_ai_systems_inventory`), the dashboard agent / system forms, and the scanner's `DOMAIN_PATTERNS` classifier. None is read,
mapped or promoted by S1C.2 SQL or TypeScript (postflight H5, ACL source scan, contract test); a legacy string or label used
as a domain id fails `DOMAIN_UNRESOLVED`. They may only become future proposal inputs through the governed lifecycle.

## Tests (LOCAL)

| Suite | Pass | Fail | Skip |
|---|---|---|---|
| New S1C.2 PG17 functional, `l14-business-context-assignment.test.ts` | 16 (+1 parent) | 0 | 0 |
| New S1C.2 PG17 concurrency, `l14-business-context-assignment-concurrency.test.ts` | 10 (+1) | 0 | 0 |
| New S1C.2 PG17 ACL / preflight / postflight controls, `l14-business-context-assignment-acl.test.ts` | 8 (+1) | 0 | 0 |
| New S1C.1-on-S1C.2 regression, `l14-business-context-s1c1-regression.test.ts` | 4 (+1) | 0 | 0 |
| Complete M16 PG17 suite (`tests/postgres-m16/*.test.ts`, 62 files) | 1013 | 0 | 0 |
| M15 PostgreSQL regression (`tests/postgres/*.test.ts`, local PG16) | 8 | 0 | 0 |
| Dashboard TS suite `npm test` (incl. the new S1C.2 contract test, 7 tests) | 1205 + 15 + 8 | 0 | 5 (pre-existing) |
| `@council/governance-review` | 412 | 0 | 0 |
| `@council/canonical-contracts` | 230 | 0 | 0 |
| Typecheck: dashboard, canonical-contracts, governance-review | clean | | |
| `git diff --check`; secret-pattern scan of the branch diff | clean | | |

Coverage: legal ×4 end to end; illegal 2 matrix + AGENT_VERSION ×2 + 9 kinds × 2 + 9 unknown semantic kinds + owner-level
CHECK; target (wrong tenant, wrong kind ×2, missing, label, malformed ×2); domain (missing, legacy free text, label,
unvalidated, cross-tenant domain, cross-tenant state substitution, other-domain state, other-kind domain, same id wrong-kind
state, malformed id, revoked, future-dated); source laundering (RPC + owner guard); authority (no rule, domain steward /
registrar, responsibility steward, AP admin, contributor, kind / object / relationship scope, self-validation, backdated,
future-dated, typed scopes, role loss + durable DENY replay); terminality / DEFER / REJECT / correction / REVOKE pins;
replay / GV007 / GV008 / GV009; supersession matrix 1-10 + re-supersession + future successor; temporal / effective_to /
gap / revoke bounds / revalidation; O49; O26 no inheritance; legacy boundary; induced failure at the typed-state INSERT and
at the head CAS (nothing consumed; the same command then succeeds). Concurrency A-F + shared domain guard + dependency
races ×2 + eligibility change. ACL: 6 preflight breaks + pre-existing history; historical rows / constraints / routines
unchanged and replayable; 35 → 37 / 25 → 27; ~70 postflight sabotage controls (incl. head-key widening with domain_id,
semantic-kind / matrix / fact-subject / fact-guard widening, domain-dependency FK drop / narrowing / NOT VALID, shared guard
key drift, canonical kind / relationship type additions, F2 attachment).

Historical horizons: every S1C.1-and-older suite keeps its own horizon (new `S1C2` horizon added). Database-free exact-list
assertions updated (still exact equality): the L14 TS file list (`l14-policy-store-contract.test.ts`) and
`L14_EXECUTABLE_FACT_SUBJECT_KINDS` (`l14-responsibility-assignment-contract.test.ts`). `successorKit` now reuses one AP-ops
role per cluster so two fixture kits can share a cluster.

## Invariants

- F2: NOT TOUCHED (structural digest identical; no BELONGS_TO_DOMAIN / IN_DOMAIN / HAS_*_DOMAIN).
- CanonicalObjectKind = 11; GovernedRelationshipType = 12.
- Not implemented: POLICY_APPLICABILITY, CONTROL_APPLICABILITY, CONTROL_ASSESSMENT, machine intake, routes, UI, M17.

## S1C.1R1 — Party dependency commit-boundary closure

- **Discovered**: during S1C.2 implementation / the single S1C.2 delta review (reported as P2).
- **Exact cause**: the merged S1C.1 `l14_decide_responsibility_assignment_proposal_v1` validated the pinned Party state
  through `l14_governance_party_valid_state_v1` but never took the GovernanceParty registry subject guard, which the
  S1B.1 / S1B.1R1 Party RPCs take EXCLUSIVELY (`l14_lock_registry_subject_guard_v1(org, 'GOVERNANCE_PARTY', party::text)`).
  A Party REVOKE could therefore commit between the dependency check and the responsibility fact's commit. The resolver
  failed closed afterwards (UNKNOWN), but §17 commit-boundary dependency validity was not guaranteed.
- **Fix (one additive migration after S1C.2)**: `supabase/migrations/20261009121000_m16_s1c1r1_party_dependency_guard_v1.sql`.
  The merged S1C.1 migration is untouched.
  - `gov_repo.l14_lock_party_dependency_guard_shared_v1(org, party)`: owner-only SECURITY INVOKER, pinned search_path, no
    application EXECUTE; `pg_advisory_xact_lock_shared` on the EXACT S1B.1 key
    `frame_identity([org, 'l14-registry-subject-guard-v1', 'GOVERNANCE_PARTY', party])` (no new namespace); transaction-scoped,
    held to commit.
  - `CREATE OR REPLACE` of the RESPONSIBILITY decide RPC only (same signature, SECURITY DEFINER, owner `postgres`, ACL,
    search_path, lock_timeout). The body is the merged S1C.1 body plus, for VALIDATE only, the shared guard (proven
    textually by the targeted test). REVOKE / REJECT / DEFER unchanged: a dependency-invalid assignment can still be ended.
  - Lock order (VALIDATE): AP SHARED → Party dependency SHARED → CARDINALITY (single-owner roles) → fact KEY → command.
    Party RPCs: AP SHARED → Party registry subject EXCLUSIVE → command. Shared vs exclusive on the same key: Party decisions
    and assignments pinning that Party serialize; assignments pinning the same Party do not. No cycle.
  - Preflight (exact S1C.2 catalog, 37 approved definers incl. the merged S1C.1 decide body) and an effective-catalog
    postflight (the S1C.2 postflight with the new decide hash `5c506338…` pinned, plus the guard key / shared mode / lock
    order contract). Surface stays **37**; canonical-owner class stays **27**; one approved definer changed in place.
- **Race order 1** (Party REVOKE holds the exclusive guard; VALIDATE observed blocked on the shared guard): VALIDATE fails
  `GV010 PARTY_DEPENDENCY_NOT_VALID`; no authorization, governance decision, fact envelope, responsibility state, head,
  support link or command result for it.
- **Race order 2** (VALIDATE holds the shared guard; Party REVOKE observed blocked): the fact commits VALIDATED, then the
  revocation commits; the current resolver returns UNKNOWN, the row is byte-identical, its own coordinates stay
  resolvable, and the assignment can still be explicitly revoked.
- **Parallelism**: two VALIDATEs pinning the same Party on different keys complete concurrently (shared, not exclusive).
- **Negative controls**: restored S1C.1 body (no guard), guard made SECURITY DEFINER / service_role-executable / search_path
  drift / EXCLUSIVE / another namespace — each fails `M16_S1C1R1_POSTFLIGHT`.
- **S1C.1 ACL source-scan repair**: `l14-responsibility-assignment-acl.test.ts` used `string_agg(prosrc, newline)` through the
  `lastLine` helper, so only the tail of the corpus was scanned. It now fetches one single-line `json_object_agg` value,
  asserts every targeted routine was collected, asserts known content of six distinct routines and > 300 lines, and runs the
  UNCHANGED forbidden-pattern list over the full corpus (it passes). The new targeted test scans the helper + new decide
  body; it permits only the shared lock key and the existing Party resolver and forbids Party registry mutation and direct
  Party table / profile reads.
- **Regressions**: the complete S1C.1 functional (17) and concurrency (10) suites also pass unmodified on the corrected
  catalog (run locally with only the horizon switched to `S1C1R1`); every historical horizon and postflight is unchanged; the
  S1C.1-on-S1C.2 regression file now runs on the final `S1C1R1` horizon.

| S1C.1R1 suite (LOCAL) | Pass | Fail |
|---|---|---|
| New targeted `l14-party-dependency-guard.test.ts` (preflight, in-place apply, controls, race ×2, parallelism, regression) | 7 (+1) | 0 |
| S1C.1 functional suite on the corrected catalog (horizon `S1C1R1`, local run) | 17 (+1) | 0 |
| S1C.1 concurrency suite on the corrected catalog (horizon `S1C1R1`, local run) | 10 (+1) | 0 |
| S1C.1 ACL suite with the repaired full-corpus source scan (its own `S1C1` horizon) | 8 (+1) | 0 |
| Complete M16 PG17 suite (63 files) | 1021 | 0 |
| M15 regression (local PG16) | 8 | 0 |
| Dashboard TS / governance-review / canonical-contracts | 1205 + 15 + 8 / 412 / 230 (5 pre-existing skips) | 0 |
| Typecheck (3 projects), `git diff --check`, secret scan | clean | |

CI evidence for this closure is the final branch HEAD that carries it (both required workflows).

## CI

| Workflow | Run | HEAD | Result |
|---|---|---|---|
| M16 PostgreSQL 17 security suite | [37871065693](https://github.com/cnegrao/code-guard-governance/actions/runs/37871065693) | `69832ef` | success |
| M15 PostgreSQL regression | [37871065717](https://github.com/cnegrao/code-guard-governance/actions/runs/37871065717) | `69832ef` | success |

`69832ef` is the last implementation / test commit; this docs-only commit re-runs both workflows on the branch head, which
is the only CI evidence that counts.
