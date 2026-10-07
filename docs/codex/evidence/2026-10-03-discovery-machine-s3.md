# Discovery Machine S3 — reconciled v2 implementation evidence

Date: 2026-10-05. Implemented locally; ready for independent adversarial review. No commit is authorized.

Authority: the reconciled v2 implementation specification and the two resume instructions, including “RESUME AFTER THIRD CODEX USAGE-LIMIT INTERRUPTION”. This document supersedes the intermediate progress report; scratch logs remain available and are not reviewed source files.

## Baseline, reconciliation and file scope

- Worktree: `D:/govia-worktrees/discovery-machine-s3`.
- Branch: `feat/discovery-machine-s3`.
- HEAD/baseline: `335898964c9768798ce6e29cab4dd6a12925fee1`.
- No reset of the worktree; intentional partial work retained. No commit, push, PR, hosted mutation or activation.
- KEEP: the canonical JSON implementation and initial parity evidence; minimal contract changes for optional FAILED failure codes, intake STATE_CONFLICT, and READ separated from mutation outcomes.
- ADAPT: hash-only migration skeleton into the authorized bridge and intake implementation; existing producer corpus into persistence and adversarial gates.
- REMOVE/REPLACE: obsolete producer-family incompatibility STOP conclusions. No producer algorithm was changed.
- Only one additive migration, one fixture, seven dedicated PG test files, one evidence document and three minimal governance-review contract/test files: **13 files**. No historical migration, S2 test, scanner producer, dashboard runtime, package dependency, route, worker or scheduler changed.

Reviewed paths:

- `apps/dashboard/tests/helpers/discovery-machine-s3-fixtures.ts`
- `apps/dashboard/tests/postgres-m16/discovery-machine-intake-admission.test.ts`
- `apps/dashboard/tests/postgres-m16/discovery-machine-intake-authority.test.ts`
- `apps/dashboard/tests/postgres-m16/discovery-machine-intake-closure.test.ts`
- `apps/dashboard/tests/postgres-m16/discovery-machine-intake-compromised-worker.test.ts`
- `apps/dashboard/tests/postgres-m16/discovery-machine-intake-finding.test.ts`
- `apps/dashboard/tests/postgres-m16/discovery-machine-intake-identity-parity.test.ts`
- `apps/dashboard/tests/postgres-m16/discovery-machine-intake-run.test.ts`
- `docs/codex/evidence/2026-10-03-discovery-machine-s3.md`
- `packages/governance-review/src/discovery-machine/contracts.ts`
- `packages/governance-review/src/discovery-machine/ports.ts`
- `packages/governance-review/test/discovery-machine-s3-contracts.test.ts`
- `supabase/migrations/20261003011750_discovery_machine_s3_restricted_intake_v1.sql`

All `out/` artifacts are scratch only. No tracked `out/` files were added. The sole tracked cache changed by typechecking (`apps/dashboard/tsconfig.tsbuildinfo`) was restored to its original bytes; source changes were preserved. Final verification checks all 13 reviewed paths against the staged source bytes, confirms 2 tracked modifications + 11 untracked additions, and runs both normal `git diff --check` and individual `git diff --no-index --check` for new files. Both whitespace checks pass. The scratch inventory is retained under ignored `out/s3-v2/scratch-inventory.txt`.

## Persistence and role model

Exactly two new tables, both owned by `govia_discovery_control_owner`, with RLS and explicit ACL closure:

| Table | Authority and invariants |
|---|---|
| `discovery_run_bindings` | DB-authored run/provenance, exact binding/revision, principal and admission generation, organisation/source/ref/adapter, pin observations and source version. Provenance immutable; conclusion is write-once. DELETE/TRUNCATE blocked. |
| `discovery_machine_admissions` | Append-only `(run_id, record_kind, record_id)` with organisation, binding/revision, invocation generation and semantic SHA-256. UPDATE/DELETE/TRUNCATE blocked. Same-identity semantic conflicts across runs fail closed. |

`acquisition_runs` remains a compatibility projection. Changing that projection to SUCCEEDED cannot undo authoritative FAILED.

| Role | Effective capability |
|---|---|
| Real machine LOGIN | Ordinary constrained role, member of `govia_discovery_machine_caller`; authenticated by `session_user`, not GUC or `current_user`. Exactly 10 gov_repo commands. No direct table or column privileges. |
| `govia_discovery_machine_caller` | Existing S2 NOLOGIN capability group. Exactly the same 10 commands; zero direct table/column access. |
| `govia_discovery_intake_owner` | New NOLOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS command owner. No CREATE or usable role memberships. Minimum pre-canonical DML and exact mapping-column SELECT. No direct S2 control-table SELECT or direct S2 eligibility EXECUTE. |
| `govia_discovery_control_owner` | Existing S2 NOLOGIN owner; owns the two authority tables, authorize bridge and immutable trigger. No new caller-facing provisioning command. |
| `govia_runtime_executor` | Existing owner of the frozen `record_execution_snapshot`; grants only that primitive to intake owner. No caller grant. |
| `service_role` / anon / authenticated / provisioner / other executors | No new S3 command, helper or authority-table privileges. Existing legacy paths remain a residual. |

Intake owner has SELECT/INSERT on authority tables, column-specific UPDATE for the five conclusion fields, SELECT/INSERT/UPDATE on the compatibility acquisition run, and SELECT/INSERT on the existing pre-canonical evidence/support/finding/candidate/lineage/subject/profile proposal tables. It has SELECT only on execution snapshot/head tables and six mapping columns. It has no canonical, review-transition-audit, L11 or L14 write grant. Execution snapshot/fact/head writes are reached only through the frozen inner primitive.

Migration-time owner memberships and CREATE are removed before COMMIT. The runtime-owner grant temporarily uses a self-granted postgres membership edge and then revokes that edge, preserving the pre-existing ADMIN-only, INHERIT=false, SET=false edge. No deployment-specific OID is hard-coded in source.

## Exact command and internal census

All signatures below are in `gov_repo`. All S3 routines have `search_path=pg_catalog, pg_temp`. Public commands and authorize have `lock_timeout=5s`. “Public command” means certified machine API, never the SQL PUBLIC grantee.

### Caller-visible commands: exactly 10

| Signature | Mode / owner |
|---|---|
| `discovery_machine_admit_finding_v1(text, jsonb, jsonb)` | SECURITY DEFINER / intake owner |
| `discovery_machine_admit_lineage_v1(text, jsonb, jsonb)` | SECURITY DEFINER / intake owner |
| `discovery_machine_admit_observation_v1(text, jsonb, jsonb)` | SECURITY DEFINER / intake owner |
| `discovery_machine_complete_run_v1(text, text, jsonb, timestamp with time zone, text)` | SECURITY DEFINER / intake owner |
| `discovery_machine_create_subject_v1(text, text)` | SECURITY DEFINER / intake owner |
| `discovery_machine_get_candidate_v1(text, text)` | SECURITY DEFINER / intake owner |
| `discovery_machine_is_governed_v1(text, text, text, text, text)` | SECURITY DEFINER / intake owner |
| `discovery_machine_open_run_v1(uuid, text, text, text, text, text, text, timestamp with time zone)` | SECURITY DEFINER / intake owner |
| `discovery_machine_record_execution_snapshot_v1(text, jsonb)` | SECURITY DEFINER / intake owner |
| `discovery_machine_record_technical_profile_v1(text, jsonb)` | SECURITY DEFINER / intake owner |

### Internal routines: exactly 9

| Signature | Mode / owner |
|---|---|
| `discovery_machine_authorize_v1(uuid, bigint)` | DEFINER / control owner |
| `discovery_machine_canonical_json_v1(jsonb)` | INVOKER / intake owner |
| `discovery_machine_execution_identity_v1(uuid, jsonb)` | INVOKER / intake owner |
| `discovery_machine_lock_run_v1(text, boolean)` | INVOKER / intake owner |
| `discovery_machine_record_admission_v1(text, text, text, character, boolean, uuid)` | INVOKER / intake owner |
| `discovery_machine_run_binding_guard_v1()` | INVOKER / control owner |
| `discovery_machine_semantic_digest_v1(text, jsonb)` | INVOKER / intake owner |
| `discovery_machine_write_candidate_v1(gov_repo.discovery_run_bindings, jsonb)` | INVOKER / intake owner |
| `discovery_machine_write_finding_v1(gov_repo.discovery_run_bindings, jsonb, boolean)` | INVOKER / intake owner |

Total S3 census: **19**, including **11 definers** (10 commands + private authorize) and 8 invokers. No machine-visible helper. Existing HUMAN application definer inventory remains **22**; raw governance RPC inventory remains **7**, closed to unauthorized callers.

## Authorization, run lifecycle and current authority

The sole control-plane path is command → `discovery_machine_authorize_v1` → existing S2 `machine_lock_eligibility_v1`. The control-owner bridge preserves `session_user` through nested definers and returns only eligible scope. Intake owner cannot read S2 tables. The bridge privately resolves current revision only for opening a new run; subsequent calls use the exact captured binding/revision. It does not silently upgrade old provenance.

Open-run verifies configured locator, exact authorized ref, adapter name/version and provider pin, then derives run identity and all authoritative tenant/source/principal data. Missing/mismatched required pins and foreign/unassigned bindings deny. Provider states remain explicit: PINNED_MATCH, UNPINNED_OBSERVED, UNPINNED_UNAVAILABLE.

Completion allows SUCCEEDED/PARTIAL/FAILED, exact eight nonnegative integer counts, `proposalsCreated=0`, and optional supported failure codes only for FAILED. The conclusion cannot change; identical replay is REPLAYED and changed content is CONTENT_CONFLICT. Further intake on concluded runs returns STATE_CONFLICT; exact reads deny concluded runs.

Every accepted mutation, read and replay checks current eligibility, including a final check after record-lock waits/writes. Tests prove principal disablement, inactive organisation, binding revision/disablement/revocation, equivalent replacement, old-session credential rotation and generation expiry fail closed. A new current generation of the same principal can replay a still-eligible historical run, without rewriting its original admission generation. Expiry while blocked on an actual advisory lock causes DENIED and rollback of tentative evidence/assertion/admission writes.

Lock order preserves S2 principal → organisation → binding, followed by run → sorted record advisory locks → subject as needed. The lineage and execution legacy advisory namespaces are retained. Concurrent identical observation admission yields one APPLIED and one REPLAYED with no duplicate rows. Concurrent snapshot replay remains REPLAYED.

## Producer compatibility, identity families and hashes

The fixture executes the existing scanner pipeline, production specifications, agent-version correlation, object normalization, relationship correlation, lineage identity function and execution snapshot producer. It scans **32 files**, producing **64 legitimate observations**: 56 general evidence assemblies, 2 technical signals, 1 SQL lineage declaration and **all 5 execution facts**. Every one persists and replays. No scanner algorithm or namespace was changed.

Accepted pairs are closed and lowercase:

- `evidence:<32 hex>` ↔ `source-assertion:<32 hex>`.
- `execution-evidence:<64 hex>` ↔ `execution-assertion:<64 hex>`.

Unsupported namespaces, wrong lengths/case and cross-family pairing reject. General source evidence and assertions must agree with current source scope/version. Execution assertions carry the run's `snapshot.sourceVersion`; execution evidence is allowed to omit a location commit because the existing producer does so. A supplied commit cannot contradict the run. No fabricated source commit is injected into producer output.

Canonical JSON is DB-authored, using ASCII object-key ordering, preserved array order, production-compatible escaping/Unicode and reviewed number rendering. Unsupported domains fail closed: oversized/deep JSON, non-ASCII keys, non-roundtrippable numbers, unsupported scales or redundant numeric scale. Limits are 64 KiB JSON text, depth 8 and the reviewed JS number domain. Caller hashes do not establish authority.

The canonical parity suite contains 3 test-runner tests with multiple vectors inside subtests; earlier “17 parity cases” was not a runner test count. Production envelope parity checks **128 stored hashes** (64 evidence + 64 assertion envelopes) against TypeScript `canonicalStringify`. Subject, lineage, profile and execution identities are checked against production derivation. Raw envelope hashes preserve full content; semantic digests exclude only approved volatile observation timestamps/run attachment, with profile support normalized as sets.

## Closed persistence semantics

**Observation/assertion:** one atomic command validates evidence arrays and assertions, exact run/source/version/pairing/trust state, writes support links and authoritative admissions, and compares semantic content on ID replay. A conflicting member rolls back the entire command. VERIFIED/VALIDATED authority is not accepted.

**Finding/candidate:** finding envelope permits only UNREVIEWED, requiresReview=true and createsCanonicalObject=false; storage columns use DB constants. Actor/decision/governance fields reject. Candidate/finding IDs must agree. Support and nested candidate references must be durable and admitted under the current run. Different semantic content under an existing identity returns CONTENT_CONFLICT.

**Lineage:** preserves the existing normalized endpoint and lineage-observation identity rules and legacy per-candidate lock. Endpoints and support must already be admitted. SQL DERIVED_FROM requires the direct SQL lineage assertion and the dedicated command; generic finding admission cannot bypass this path. The new port fixes only a SQL JSON-operator precedence issue in its own copied validation, leaving the legacy routine unchanged.

**ReviewSubject:** inputs are only run + finding. DB derives subject identity and copies admitted support. New subject is DETECTED/revision 0/last_transition_id NULL. Replay verifies source/support, preserves a HUMAN-advanced CONFIRMED row byte-for-byte and creates no transition audit/outbox event. No transition to PROPOSED exists in S3.

**Technical profile:** only an admitted AGENT_VERSION and current-run support can create the deterministic proposal. Support set order does not confer different meaning; durable scalar/support content is compared on replay. Same identity with changed content conflicts. No canonical profile or L5 Authorized Profiling write occurs.

**Execution snapshot:** requires an admitted current-run AGENT_VERSION, matching technical-profile proposal, source snapshot and admitted fact assertion/evidence/tool support. Authorization is exactly UNKNOWN. Caller cannot supply organisationId, sourceScope, sourceSystemId, providerCode or expected_previous; DB derives them and reads the head under the established advisory lock. Snapshot identity matches production. Closed direct fact types exclude authority fields. The inner `record_execution_snapshot` is inaccessible to the machine. Exact/concurrent replay and persisted same-ID content conflicts are tested. The latter uses a trusted disposable fixture to model conflicting legacy persisted content, then restores it; machine has no ability to perform that fixture mutation.

**Exact reads:** get_candidate returns only a candidate admitted under the exact authorized run. Missing, foreign-tenant and unadmitted candidate identities give the same `{outcome:READ,candidate:null}` result within an eligible run. Foreign/invalid runs deny. is_governed derives organisation and connection and uses exact C-collation equality for the complete normalized mapping key; literal `%`/`_` are not wildcards. It returns only `{outcome:READ,isGoverned:boolean}`, never mapping/canonical IDs, lists or canonical content. READ is separate from MachineCommandOutcome.

## ACL, default privileges and role-safety

The migration runs under the existing hostile historical table/sequence creator defaults plus fixture-injected postgres function defaults. Every new object explicitly closes PUBLIC, application, service, provisioner and executor access; RLS is defense in depth. Actual effective table/column/function privileges are queried for real LOGIN and caller group. Postflight rejects injected ACL, RLS and CREATE drift.

`machine_role_safe_v1` is amended only for the certified command surface. Migration-time attestation captures actual pg_proc identity, namespace, name, argument type vector, owner and function-definition digest. Runtime membership/CREATE/table checks remain. The catalog allowlist does not depend on regprocedure display text and does not hard-code deployment OIDs in source. Tests reject extra helper/definer/overload grants, rename, owner change, same-signature recreation, table access, CREATE and privileged membership.

Seven pre-existing invoker triggers had effective PUBLIC EXECUTE: `set_updated_at`, `compute_retention_until`, `update_agent_compliance_flags`, `set_propagation_criticality`, `compute_dora_reporting_deadlines`, `update_ai_system_compliance_flags`, `sync_ai_system_incident_count`. The additive migration revokes only their PUBLIC EXECUTE and explicitly preserves anon/authenticated/service_role access. It grants `set_updated_at` to intake owner. Their bodies and ownership are unchanged. No explicit grants are added to the frozen executor roles: their trigger firing remains valid, while extra routine grants would violate R1. Existing function inventory checks and regression tests preserve the legitimate legacy boundary.

The fixture restores its **extra artificial function-default grants** before rerunning historical R1. This does not alter already-created S3 object ACLs; hostile historical table defaults remain. This is not evidence that future postgres-created objects are globally fixed.

## Transitive SECURITY DEFINER closure and historical postflights

The final closure audit resolves **27 routines** from command bodies, written-table triggers, CHECK helpers and RLS expressions. It records owner/mode/path and denies direct machine execution of every non-command. No runtime dynamic SQL or caller-selected authority path is introduced; migration DO blocks use dynamic DDL only at installation.

All reachable definers have NOLOGIN owners. S3 and frozen definer paths end in pg_temp. The existing `normalized_object_identity` invoker has `gov_repo, pg_catalog, pg_temp`; gov_repo is not writable by machine/intake. `set_updated_at` has no local path and inherits the enclosing fixed command path; its body only timestamps NEW and returns it. Other legacy invokers remain owned by postgres and do not switch authority. Qualified application references and the compromised temp/GUC probes guard against shadowing. Broader cross-schema reach analysis remains S7 scope.

Closure inventory:

| Routine | Owner | Mode | search_path |
|---|---|---|---|
| `discovery_machine_admit_finding_v1` | `govia_discovery_intake_owner` | DEFINER | `pg_catalog, pg_temp` |
| `discovery_machine_admit_lineage_v1` | `govia_discovery_intake_owner` | DEFINER | `pg_catalog, pg_temp` |
| `discovery_machine_admit_observation_v1` | `govia_discovery_intake_owner` | DEFINER | `pg_catalog, pg_temp` |
| `discovery_machine_authorize_v1` | `govia_discovery_control_owner` | DEFINER | `pg_catalog, pg_temp` |
| `discovery_machine_canonical_json_v1` | `govia_discovery_intake_owner` | INVOKER | `pg_catalog, pg_temp` |
| `discovery_machine_complete_run_v1` | `govia_discovery_intake_owner` | DEFINER | `pg_catalog, pg_temp` |
| `discovery_machine_create_subject_v1` | `govia_discovery_intake_owner` | DEFINER | `pg_catalog, pg_temp` |
| `discovery_machine_execution_identity_v1` | `govia_discovery_intake_owner` | INVOKER | `pg_catalog, pg_temp` |
| `discovery_machine_get_candidate_v1` | `govia_discovery_intake_owner` | DEFINER | `pg_catalog, pg_temp` |
| `discovery_machine_is_governed_v1` | `govia_discovery_intake_owner` | DEFINER | `pg_catalog, pg_temp` |
| `discovery_machine_lock_run_v1` | `govia_discovery_intake_owner` | INVOKER | `pg_catalog, pg_temp` |
| `discovery_machine_open_run_v1` | `govia_discovery_intake_owner` | DEFINER | `pg_catalog, pg_temp` |
| `discovery_machine_record_admission_v1` | `govia_discovery_intake_owner` | INVOKER | `pg_catalog, pg_temp` |
| `discovery_machine_record_execution_snapshot_v1` | `govia_discovery_intake_owner` | DEFINER | `pg_catalog, pg_temp` |
| `discovery_machine_record_technical_profile_v1` | `govia_discovery_intake_owner` | DEFINER | `pg_catalog, pg_temp` |
| `discovery_machine_run_binding_guard_v1` | `govia_discovery_control_owner` | INVOKER | `pg_catalog, pg_temp` |
| `discovery_machine_semantic_digest_v1` | `govia_discovery_intake_owner` | INVOKER | `pg_catalog, pg_temp` |
| `discovery_machine_write_candidate_v1` | `govia_discovery_intake_owner` | INVOKER | `pg_catalog, pg_temp` |
| `discovery_machine_write_finding_v1` | `govia_discovery_intake_owner` | INVOKER | `pg_catalog, pg_temp` |
| `execution_field_valid` | `postgres` | INVOKER | `pg_catalog, pg_temp` |
| `execution_immutable` | `postgres` | INVOKER | `pg_catalog, pg_temp` |
| `frame_identity` | `postgres` | INVOKER | `pg_catalog, pg_temp` |
| `machine_lock_eligibility_v1` | `govia_discovery_control_owner` | DEFINER | `pg_catalog, pg_temp` |
| `machine_role_safe_v1` | `govia_discovery_control_owner` | INVOKER | `pg_catalog, pg_temp` |
| `normalized_object_identity` | `postgres` | INVOKER | `gov_repo, pg_catalog, pg_temp` |
| `record_execution_snapshot` | `govia_runtime_executor` | DEFINER | `pg_catalog, pg_temp` |
| `set_updated_at` | `postgres` | INVOKER | `inherited` |

The historical S1B.2, R1-after-R2, R2, R3 and S2 postflights pass on their original horizons. On the S3 horizon, S1B.2/R1/R2/S2 checks also pass. **R3 selector accommodation:** its original suffix selector `%\_governed\_v1` also matches the required S3 `discovery_machine_is_governed_v1`. Only the new S3 fixture replaces the three selector occurrences with the exact six original HUMAN wrapper names; every R3 check is retained. The original R3 migration/test is unchanged and still runs verbatim before S3. Do not interpret the post-S3 run as a verbatim invocation of that overbroad original selector.

## Compromised-worker hard gate

`gate-l.log`: **4 passed, 0 failed, 0 skipped**. Preserved after the third-resume instruction; no security implementation changed after this result.

- **149** noncertified internal/legacy/HUMAN/raw/control-plane routines deny real direct invocation.
- **131** gov_repo tables × SELECT/INSERT/UPDATE/DELETE/TRUNCATE probes; effective table/column privileges remain zero.
- **116** protected stores have identical canonical JSON SHA-256 checksums before/after the entire attack sequence, including canonical/HUMAN/L11/L14/S2 and audit/outbox stores. Fifteen explicitly permitted pre-canonical stores are excluded from this protected-store checksum. Foreign run provenance remains byte-identical.
- Valid own-scope intake can create DETECTED; foreign binding/run, governance injection, direct legacy/inner/helper/HUMAN/raw/provisioning access, privileged SET ROLE/session authorization, and non-temp CREATE fail.
- Hostile temp tables/search_path and request.jwt.claims do not change session_user authority. Existing own-scope observation still only replays.

Probe corrections are explicit: SQL STRICT calls with NULL can be optimized away, so strict routines are invoked with non-null typed values. Existing immutable `DO INSTEAD NOTHING` rules can erase DML before ACL evaluation; those known unconditional rule paths perform no operation and are accepted only with catalog-confirmed zero privileges and unchanged checksums. Frozen rules were not changed to force an artificial 42501.

## Test environment and exact commands

- Binary: `D:/code-guard-governance/out/m16-tools/pgsql/bin/postgres.exe`; **PostgreSQL 17.11**, confirmed by `postgres.exe --version` and each owned server's version query.
- Node: **v24.19.0**.
- Disposable localhost TCP trust clusters, actual machine `psql -U <role>` LOGIN, migrations as postgres NOSUPERUSER. Harness bootstrap-only setup uses m16_bootstrap superuser. Clusters stop and are removed by the existing fixture.
- Full primary history uses the existing harness pgvector stand-in where the native extension is unavailable; the one expected missing-HNSW-index statement is diagnosed by the unchanged harness. This does not certify pgvector/HNSW or hosted extension behavior.
- Logs: ignored local `D:/code-guard-governance/out/s3-v2/`; old parity logs also under `out/s3-stage/`. Command stdout/stderr are retained. No remote/hosted opt-in was set.

For PG commands below, cwd is `D:/govia-worktrees/discovery-machine-s3/apps/dashboard` and the environment assignment is:

```powershell
$env:M16_PG17_BIN='D:\code-guard-governance\out\m16-tools\pgsql\bin'
```

| Gate / logfile | Exact test command (after environment assignment) | Result |
|---|---|---|
| Run / gate-d.log | `node --conditions=react-server --import tsx --test tests/postgres-m16/discovery-machine-intake-run.test.ts` | 6 passed / 0 failed / 0 skipped / 0 cancelled |
| Producer + SQL admission / gate-f.log | `node --conditions=react-server --import tsx --test tests/postgres-m16/discovery-machine-intake-admission.test.ts` | 13 passed / 0 failed / 0 skipped / 0 cancelled |
| Authority + findings/profile/snapshot/read / authority-snapshot.log | `node --conditions=react-server --import tsx --test tests/postgres-m16/discovery-machine-intake-authority.test.ts tests/postgres-m16/discovery-machine-intake-finding.test.ts` | 12 passed / 0 failed / 0 skipped / 0 cancelled |
| Final security closure / gate-k.log | `node --conditions=react-server --import tsx --test tests/postgres-m16/discovery-machine-intake-closure.test.ts` | 6 passed / 0 failed / 0 skipped / 0 cancelled |
| Compromised worker / gate-l.log | `node --conditions=react-server --import tsx --test tests/postgres-m16/discovery-machine-intake-compromised-worker.test.ts` | 4 passed / 0 failed / 0 skipped / 0 cancelled |

Earlier canonical parity: `node --conditions=react-server --import tsx --test tests/postgres-m16/discovery-machine-intake-identity-parity.test.ts`, 3/0/0 (`out/s3-stage/v2-gate-b.log`); the final full regression also includes this file.

Complete postgres-m16 coverage uses the following final command plus the preserved worker gate above, as expressly requested to avoid repeating that completed gate:

```powershell
$testFiles=@(Get-ChildItem tests/postgres-m16 -Filter '*.test.ts' |
  Where-Object Name -ne 'discovery-machine-intake-compromised-worker.test.ts' |
  ForEach-Object FullName)
node --conditions=react-server --import tsx --test --test-concurrency=2 @testFiles
```

Final command (`regression-postgres-m16.log`): **754 passed / 0 failed / 0 skipped / 0 cancelled**. No file is silently omitted: the sole excluded file is represented by the preserved 4/0/0 result.

Complete 41-file postgres-m16 coverage: **758 passed / 0 failed / 0 skipped**, comprising the final 40-file run plus the preserved worker gate. Dedicated S3 coverage across its seven files is **44 passed / 0 failed / 0 skipped** (a subset of that PG coverage, not an additional aggregate).

The final command runs 40 test files; combined with the one preserved worker file, all 41 postgres-m16 files are represented. It covers S2 control-plane/horizon, historical M16 eligibility, HUMAN/raw closure, S1B.2/R1/R2/R3 postflights, authority/registry/party tests and the six remaining S3 files. S1 machine contracts and source identities are also covered by governance-review/scanner and the S2 golden-identity test.

Workspace regression commands (cwd = worktree root):

| Command | Result | Log |
|---|---|---|
| `npm test --workspace=packages/governance-review` | 412 passed / 0 failed / 0 skipped / 0 cancelled | `regression-governance.log` |
| `npm run test:discovery-engine --workspace=packages/scanner` | 404 passed / 0 failed / 0 skipped / 0 cancelled | `regression-scanner.log` |
| `npm test --workspace=apps/dashboard` | 1185 passed / 0 failed / 5 skipped / 0 cancelled | `regression-dashboard.log` |

Dashboard breakdown: main tests 1162 passed / 0 failed / 5 skipped; passport UI 15/0/0; pre-demo UI 8/0/0. The five skips are existing explicit external opt-ins: one controlled real OpenAI → hosted-lab acceptance, one external runtime database acceptance and three hosted-only fixture/precision/isolation checks in `runtime-database.test.ts`. No S3 test is skipped. These are not claimed as hosted acceptance.

| Typecheck | Result |
|---|---|
| `npm run typecheck --workspace=packages/governance-review` | exit 0 |
| `npm run typecheck:scanner` | exit 0 |
| `npm run typecheck:dashboard -- --incremental false` | exit 0; includes final S3 tests |
| `npm run typecheck:graphos-pkg` | exit 0 |

Typechecks have no test-runner pass/fail/skip counts; their exit codes are the evidence. The dashboard check was repeated only after the final closure-test edit; the last run disables incremental output. Original typecheck logs are retained.

## Installed routine definition fingerprints

SHA-256 of `pg_get_functiondef` from the final successful focused closure cluster. These are evidence fingerprints, not hard-coded deployment IDs. Runtime attestation is generated inside the migration from the actual installed catalog.

| S3 routine | SHA-256 |
|---|---|
| `discovery_machine_admit_finding_v1` | `60d3d9ffe3f40e9b4d2c2d2228100b6835593c567eb3c915bdfb6fc0556e35b5` |
| `discovery_machine_admit_lineage_v1` | `c435719d1558ceadbc8829eb8fe7fb4501d7619b32b5b6f8e2f82d7e87b14909` |
| `discovery_machine_admit_observation_v1` | `cc974f5dceaa5f66f3f7c73fef5ec986d70a3c7f629b1e6d4f1b802788118365` |
| `discovery_machine_authorize_v1` | `67eb95c02f7a1cbc53814a02a84822500559e47392da48f359b4c738e4ffe383` |
| `discovery_machine_canonical_json_v1` | `7b2c3d597961010928ed5b8e81b3e29cf4317e562158db4980af65a327cdd100` |
| `discovery_machine_complete_run_v1` | `51ee1870f531c6a0d660779dffa247b535dace895fb73a9990e5d8046a464700` |
| `discovery_machine_create_subject_v1` | `b278fe87ba0ce7920e188aed84291090d11bb7a8e16a8957103b5c7d7e0b45ce` |
| `discovery_machine_execution_identity_v1` | `de6db60db151a693e044ef13c5256a92bf5ad81bf88988afdc6833e6190560e0` |
| `discovery_machine_get_candidate_v1` | `a15f4bea44454f9b5064210df4ed79098681589e48c12405cff24f0dff93d263` |
| `discovery_machine_is_governed_v1` | `de5a73b83c35318cbf4b1436d9354b4eb8d891af98141d3d162381e49260c413` |
| `discovery_machine_lock_run_v1` | `10bc229cdc8f258c4827e10d61f5a2108c6aac405be6f66bd680457aa1f8cdcf` |
| `discovery_machine_open_run_v1` | `9c16e718837946b8578b4e8d1227deef12cee092e2a885efa5c90fb446464945` |
| `discovery_machine_record_admission_v1` | `fd8a49241d5ccb7ce6cbe0828f6ee2e9f8af43ce74418702d16c340b927f7fb8` |
| `discovery_machine_record_execution_snapshot_v1` | `afb555df680ec4f49b9ce3326f237427a124362598a0dfc28f9effe924af823d` |
| `discovery_machine_record_technical_profile_v1` | `d4aeb3d666532bbb363590617de6d3574f6cc760283c3d227e04b65fd4e47d2b` |
| `discovery_machine_run_binding_guard_v1` | `ba82062f260d7f158fa5c512880be1e5885dab384ef28a1b4d4f82b6bf1123b1` |
| `discovery_machine_semantic_digest_v1` | `1075be9a19abc59430404da2b4e1902c88a802ab6524cbdf624f3d878d4f846a` |
| `discovery_machine_write_candidate_v1` | `744fbec273d1fa4fbc89f95eda7e475004144344e260eb3b84c5182b1e6b3b04` |
| `discovery_machine_write_finding_v1` | `4c11b747336f9edb356ab5a7edfbb1a2f28c323bbbd533cfc5ee991472c9da85` |

## Known residuals and frozen status

- Local trust transport only; TLS, pooler and hosted acceptance are unproven. Hosted was not run.
- Same-tenant ID preclaim fails closed; this can deny useful intake and is not automatic conflict recovery.
- Orphan RUNNING runs remain possible; no worker or recovery orchestration is introduced.
- Unpinned provider observations remain explicitly distinguishable from pinned matches.
- Machine observations are not independent verification or governance authority.
- Invocation denials and reads are not yet fully durably audited; the admissions ledger records admitted artifacts, not a complete invocation journal.
- Existing legacy service_role paths remain; S3 does not certify or remove every older integration.
- Future postgres-created-object default ACL risk remains. Broader cross-schema analysis remains S7.
- The local vector stand-in and R3 exact-six fixture accommodation are described above, not hidden as unconditional historical/hosted proof.

Maximum machine governance authority: **DETECTED**. No PROPOSE, reconciliation, canonical materialization, L11/L14 authority or HUMAN transition.

Discovery = **DORMANT / NOT ACTIVATABLE**. S4 = **NOT STARTED**. S1B.3 = **NOT STARTED**. Hosted = **PENDING / NOT RUN**.

Independent adversarial review is mandatory before any commit. Next gate: **DISCOVERY MACHINE S3 — INDEPENDENT ADVERSARIAL REVIEW**.
