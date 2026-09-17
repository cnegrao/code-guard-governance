# M14.2 runtime persistence validation

Execution dates: 2026-09-16–17 America/Sao_Paulo. The existing evidence filename
is retained to avoid competing records.

- M14.1: **COMPLETE / ACCEPTED / MERGED**.
- M14.2: **M14_2_READY_FOR_REVIEW**; authoritative hosted acceptance and final regressions passed.
- Current authoritative target: **HOSTED SUPABASE ov-ia-g2-test / POSTGRESQL 17**.
- The later user authorization supersedes the earlier local-only/remote-write prohibition.
- PostgreSQL 16.1 results below: **AUXILIARY / NON-AUTHORITATIVE — PASS**.
- M14 overall: **IN PROGRESS**.
- M14.3, M14.4, M14.5 and M15: **NOT STARTED**.
- OTel: **NOT INSTALLED**. Producer: **NOT MODIFIED**.

## Base and delivery

Repository: `cnegrao/code-guard-governance`.
`git fetch origin`, `git checkout main`, `git pull --ff-only origin main`,
`git rev-parse HEAD` and `git rev-parse origin/main` confirmed both at
`201e26e35de22a3767441add6d4a66c2fd0a074c` before implementation.
Branch: `feat/m14-runtime-persistence-v1`, created from that main.
Validation ran against the implementation working tree on this base HEAD.
The initial local-only continuation left it uncommitted. The later authorized
hosted acceptance and final regressions satisfy the commit/PR gate. Delivery is
the M14.2 branch/PR against main; merge remains prohibited.

## Earlier continuation state and correction

The continuation began on the expected branch with HEAD and origin/main still
`201e26e35de22a3767441add6d4a66c2fd0a074c`. No checkout, pull, reset, stash or
Undo Review was performed. The two tracked changes and ten permanent untracked
M14.2 files were preserved, along with nine scratch files and the temporary
database directory until cleanup. The supplied recovery file was untouched.

**The earlier classification of standalone PostgreSQL 16.1 as final acceptance
was incorrect and is superseded by this correction.** The executed results are
retained exactly as auxiliary SQL/transaction evidence. They do not prove
Supabase compatibility, its actual roles/auth/RLS, PostgreSQL 17 migration
compatibility or final M14.2 acceptance.

## Earlier Supabase local / PostgreSQL 17 attempt — BLOCKED (historical)

Repository `supabase/config.toml` specifies `project_id="code-guard-governance"`,
`[db] major_version=17`, local DB port 54322 and API port 54321. It references
`supabase/seed.sql`, which is absent. The lockfile supplies Supabase CLI 2.107.0
through the existing workspace dependency; no dependency or global tool was installed.

Discovery executed:

```powershell
supabase --version
docker --version
psql --version
npx --no-install supabase --version
& .\node_modules\.bin\supabase.cmd status --help
& .\node_modules\.bin\supabase.cmd status --output json
& .\node_modules\.bin\supabase.cmd db reset --help
wsl --list --quiet
```

Bare supabase/docker/psql were absent from PATH. Repository-local/npx Supabase
reported **2.107.0**. Installed psql remains **16.1** by its absolute path.
Docker executable/service/install directory was not found; the Docker engine
pipe was absent. WSL enumeration outside the sandbox returned no distributions.
`supabase status`, also run outside the sandbox, failed while inspecting
`supabase_db_code-guard-governance`: `open //./pipe/docker_engine: The system
cannot find the file specified.` No running local Supabase connection was obtained.

**Missing prerequisite:** an available local Docker engine capable of running this
repository's Supabase stack with PostgreSQL 17. No global installation was attempted.
No `supabase start`/reset was attempted without that prerequisite. Existing linked
metadata in `supabase/.temp` was observed only by filename; its hosted connection
details were not used. No link, remote reset, push, hosted SQL or remote DB connection.

Selected authoritative environment: **Supabase local/PostgreSQL 17, unavailable**.
Configured target: 127.0.0.1:54322; this is not a verified live connection.
Authoritative migration/RLS/grant/replay/concurrency/quota/tenant gates: **NOT RUN**.

The existing bootstrap now defaults to `-Mode Supabase`, obtains credentials only
from local CLI status and rejects a non-loopback URL. `-ResetLocal` uses only
`supabase db reset --local --yes`, applying the complete repository chain rather
than the auxiliary dependency subset. The Node preflight requires PostgreSQL 17,
existing Supabase roles/auth schema and the permanent migration's history entry.
It does not create Supabase roles. Hostaddr is pinned to loopback and connection
string overrides are rejected. The PG16 bootstrap requires `-Mode AuxiliaryPG16`.

When the local stack exists, the prepared authoritative sequence is:

```powershell
& ./apps/dashboard/tests/helpers/runtime-bootstrap.ps1 -Mode Supabase -ResetLocal
node --import tsx --test apps/dashboard/tests/runtime-database.test.ts
```

This sequence is **prepared, not executed successfully**. Full-chain issues,
including the missing configured seed, must be observed and resolved without
editing historical migrations once the actual target is available.

The pre-existing untracked `codex-recovery-6101-6240.txt` was preserved, SHA-256
`FD0999D5EE1CD1C8CE01FE1EDD3F4677B0E8614767076AD127AC1FF605FFB154`.
Frozen architecture, ADR, roadmap, M13 code/history contracts, scanner,
Graph, Vector, Passport, Talk, LLM and producer files are unchanged.

## Schema and boundaries

CLI-generated migration:
`supabase/migrations/20260917021203_runtime_observability_v1.sql`.
The UTC timestamp was produced by installed Supabase CLI **2.107.0**, using
`supabase migration new runtime_observability_v1` after inspecting `--help`.
Historical migrations were not edited. Migration is one ordered transaction,
with no rerun masking, backfill or canonical writes.

| Table in gov_repo | Stored responsibility |
| --- | --- |
| runtime_source_heads | UUID tenant, globally single-tenant connection, immutable system/provider/producer identity, controlled active configuration pointer and administrator provenance |
| runtime_source_configurations | Immutable version, RUNTIME family, required instrumentation, closed enum arrays of kinds/facts, pinned adapter/schema/mapping/binding versions, bounded payload/batch/quota/window and exact approved coordinate lists |
| runtime_deployment_bindings | Immutable verified release association, producer/deployment/digest/entrypoint, existing AGENT_VERSION, normalized mapping, candidate/source snapshot and verifier |
| runtime_observations | 214 explicit contract columns plus DB-owned recorded_at; five closed variants, complete availability reasons, independent tokens/cost bases, context/evidence, provenance and coverage |

There are no JSON/JSONB, EAV, raw span, payload, arbitrary attributes or generic
metadata columns. JSON is used only to transport typed RPC results and test
arguments; `runtime-row.ts` is a closed leaf-to-column codec. Required conditional
fields and absent variant fields are enforced by a shared SQL predicate used
both before admission/replay and by the table CHECK constraint.

Nanoseconds use nonnegative signed BIGINT. Counts use BIGINT constrained to
`0..9007199254740991`. Money/rates use exact `NUMERIC(27,9)`; sampling uses exact
NUMERIC. Nanoseconds/money/rates return as strings before JavaScript parsing.
Timestamp transport preserves ISO year 0000 as PostgreSQL 1 BC; valid four-digit
years and millisecond precision are enforced. UNKNOWN has explicit state/reason,
and never substitutes NULL, zero or false for the contract state.

`validatePersistedRuntimeObservation` and the unchanged pre-persistence API share
all semantic checks. The pre path requires UNKNOWN(NOT_SUPPLIED); readback requires
a valid KNOWN timestamp. Neither function authenticates or queries the database.
The RPC rejects caller-supplied non-null recorded_at and assigns a millisecond
timestamp with `clock_timestamp()` only for a new durable observation.

## Privileges, administration and reference enforcement

All four tables have RLS enabled and no application SELECT or DML grants.
PUBLIC, anon, authenticated and service_role have all table privileges revoked,
including TRUNCATE. BYPASSRLS does not restore revoked SQL privileges.
No public read/query surface is added.

All five SECURITY DEFINER functions have `search_path=pg_catalog`, qualified
repository references, typed arguments, explicit PUBLIC/client revokes and
value-free exception messages. Existing migration ownership is retained.

| RPC | Execution boundary |
| --- | --- |
| register_runtime_source | Database administrator/migration owner only |
| configure_runtime_source | Database administrator/migration owner only; adds immutable version |
| activate_runtime_source | Database administrator/migration owner only; controls pointer and activation |
| register_runtime_binding | Database administrator/migration owner only; verifies governed reference support |
| admit_runtime_observation | Explicit EXECUTE grant to existing service_role only |

Telemetry credentials cannot register their own source, configuration or binding.
The permanent migration creates no roles; the auxiliary bootstrap uses the
existing repository role names as standalone fixtures only. The server adapter passes tenant/connection from its
trusted orchestration context, repeats pre-validation, calls only admission and
validates typed readback. This is not HTTP authentication or an ingestion route.

Foreign keys are tenant scoped for source/configuration/binding/canonical identity.
The existing normalized mapping table has a globally unique mapping_id; its FK is
combined with tenant, kind, source coordinates, exact candidate and human decision
checks inside the restricted functions. No existing canonical schema is altered
to manufacture a compound key. Deployment binding additionally requires an actual
candidate assertion matching the acquisition run and source snapshot.

Canonical targets require MODEL/TOOL/MCP_SERVER/API matching the observation kind,
the persisted normalized mapping and the governed decision. EXACT requires the
existing immutable binding with matching source/producer/deployment/digest/version;
forged EXACT is rejected, never downgraded. Runtime evidence references must name
the same tenant, connection and observation. A parent span is implicitly scoped
to this tenant/connection/trace; missing parents are permitted without inventing
cross-source joins or a complete trace.

## Atomic replay and quota

Every source registration/configuration/activation/binding/admission RPC uses:

```sql
pg_advisory_xact_lock(hashtextextended(
  organisation_id::text || ':runtime-source-v1:' || connection_id, 0
))
```

This transaction-scoped namespace orders all source admission changes. Hash
collisions can only over-serialize. Identity is separately enforced by UNIQUE
`(organisation_id,connection_id,trace_id,span_id)`. The source head update trigger
also takes this lock and rejects identity changes.

Admission validates its typed input and trusted scope, locks, then checks for an
existing event **before** checking current activation/configuration/window/quota.
Identical historical replay therefore survives later deactivation/reconfiguration.
Typed semantic comparison includes bindings, targets, event times, outcomes,
measurements, context, instrumentation, coverage and versions. It excludes only
receipt/recording times and the incoming assigned observation ID plus self-evidence
IDs already validated against it. Limitations are a closed duplicate-free set;
ordering changes are equivalent. No digest is used as a substitute for equality.
Replay returns the original entire row, including ID, binding and recorded_at.
Conflict returns `RUNTIME_REPLAY_CONFLICT`, without a second write or overwrite.

Quota is configured per immutable version but counts all historical observations
of the connection, so configuration rotation cannot reset usage. Exact replay has
no quota effect. Tests use 10,000 observations and a finite 30-day admission window,
plus smaller quotas for boundary tests. No TTL, delete, purge or compaction exists.
`max_batch_size` is persisted for the future ingestion boundary; this RPC admits
exactly one sanitized observation per call and enforces its configured byte bound.

## PostgreSQL 16.1 auxiliary validation — PASS / NOT FINAL SUPABASE ACCEPTANCE

- PostgreSQL **16.1**, native Windows binaries already installed at
  `C:\Program Files\PostgreSQL\16\bin` (not initially on PATH).
- No global tooling installed. `docker --version` unavailable; Docker not used.
- Disposable cluster created for this task at `D:\code-guard-governance\.tmp-m14-db`.
- Listener restricted to **127.0.0.1:55442**; database **m14_acceptance**.
- Actual PostgreSQL sessions, not mocks or in-memory concurrency.
- Existing repository role names anon/authenticated/service_role were represented
  by auxiliary fixture roles in this standalone cluster. These are not evidence
  of actual Supabase platform role behavior. No application credentials loaded.
- **Remote SQL / remote database touched: NO. Production touched: NO.**

Initialization/start commands (repository root):

```powershell
& 'C:\Program Files\PostgreSQL\16\bin\initdb.exe' -D 'D:\code-guard-governance\.tmp-m14-db' -U postgres -A trust --encoding=UTF8 --locale=C
& 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe' -D 'D:\code-guard-governance\.tmp-m14-db' -l 'D:\code-guard-governance\.tmp-m14-db\server.log' -o '-h 127.0.0.1 -p 55442' -w start
& ./apps/dashboard/tests/helpers/runtime-bootstrap.ps1
$env:M14_LOCAL_DB_TEST='1'
$env:M14_PSQL_PATH='C:\Program Files\PostgreSQL\16\bin\psql.exe'
node --import tsx --test apps/dashboard/tests/runtime-database.test.ts
```

The above historical bootstrap invocation predates the explicit mode distinction;
reproducing its auxiliary path now requires `-Mode AuxiliaryPG16`.
The auxiliary bootstrap applies 13 unmodified dependency/new migration files,
including foundation, canonical/source/mapping support and M13. It fails if the
named acceptance DB already exists. Development reruns recreated only that named
database after verifying the cluster data_directory. No historical SQL was changed.

Recovered auxiliary result: **13 passed / 0 failed / 0 skipped**: one structural
test, eleven database subtests and their parent container. The static case is
reported separately in meaning; it is not represented as database execution.

| Executed PostgreSQL 16.1 auxiliary checks — not Supabase acceptance | Result |
| --- | --- |
| Four tables, RLS flags, no JSON columns, function grants, PUBLIC execution revoked | PASS |
| Source registration, immutable version, controlled pointer, inactive source | PASS |
| service_role/anon/authenticated direct INSERT/UPDATE/DELETE rejection and no DML/TRUNCATE grants | PASS |
| Valid UNRESOLVED and EXACT, five kinds, DB timestamp and override rejection | PASS |
| Independent tokens, exact decimal costs, nanoseconds, ISO year 0000, invalid bounds and combinations | PASS |
| Tenant/source/config/evidence spoof; foreign subject/target/mapping/snapshot | PASS |
| Valid governed deployment/target, wrong kind, forged proof, immutable binding | PASS |
| Identical sequential replay, changed semantics/version conflict, original ID/time/binding | PASS |
| Eight overlapping transactions, identical event | **1 insert + 7 successful equivalent replays; 1 row** |
| Two overlapping transactions, conflicting event | **1 winner + 1 conflict; 1 row** |
| Three concurrent distinct events with one quota slot | **1 success + 2 quota rejections** |
| Historical replay after deactivation/rotation, new quota/fact/window rejection | PASS |
| Same trace/span on another valid source/tenant remains independent | PASS |
| No canonical object/relationship mutation; existing M13 snapshot/state/decision content unchanged | PASS |

## Replay, concurrency and quota — auxiliary evidence

The concurrency tests spawn independent psql processes and use overlapping
transactions with controlled sleeps before/after admission. They do not simulate
locks in application memory. All eight results must contain exactly the same
durable row; the tests query the actual final row count.

## Deployment binding, tenancy, canonical and M13 non-mutation — auxiliary evidence

Governed objects, candidates, decisions, mappings and a historical M13 snapshot
are explicitly seeded by the **test administrator before** runtime admission.
These are fixtures, not real discovery or runtime canonical materialization.
The test compares canonical/M13 contents before and after the runtime operations.

## Earlier local-only package, adapter, migration and type validation

| Command | Result |
| --- | --- |
| `npm test --workspace @council/canonical-contracts` | 220 passed |
| `npm test --workspace @council/governance-review` | 318 passed |
| dashboard command below (local-only continuation run) | 200 passed / 0 failed / 1 DB test skipped |
| `npm run typecheck --workspace @council/canonical-contracts` | PASS |
| `npm run typecheck --workspace @council/governance-review` | PASS |
| `npm run typecheck:dashboard -- --incremental false` | PASS |
| `npm run typecheck:scanner` | PASS |
| `npm run typecheck:graphos-pkg` | PASS |
| `git diff --check` | PASS |

Dashboard command, from `apps/dashboard`:

```powershell
node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/*migration.test.ts tests/runtime-database.test.ts tests/runtime-persistence.test.ts tests/execution-context-service.test.ts tests/execution-context-route.test.ts
```

This includes the repository's existing structural migration conventions and
new adapter/codec/local-target guard tests; it does not replace the actual DB test above.
The final command did not enable DB execution: its database test was explicitly skipped.
The recovered 198-pass migration/regression run and earlier 19-test focused run
are subsets, not added to this final total. Sandbox EPERM failures
for git/CLI/Node subprocesses were rerun with execution approval. Initial SQL
identifier-regex generation and a self-parent fixture defect were corrected;
the final fresh-database run passed. A test regex flag incompatible with dashboard's
ES2017 target was corrected, and its typecheck rerun successfully.

During continuation, `runtime-bootstrap.ps1 -Mode Supabase` was executed without
reset and failed safely with `M14_SUPABASE_LOCAL_UNAVAILABLE` before any database
write. The revised Node helper's read-only `verifyDatabaseEnvironment()` and
expanded `authorityState()` query passed against the existing PG16 auxiliary
database. This verifies helper query compatibility only; the earlier 13-pass
database run remains the recovered auxiliary suite result. It is not a new
Supabase run. The PowerShell auxiliary bootstrap was not rerun after adding
explicit modes and libpq environment isolation.

## Earlier continuation inventory and cleanup

The continuation first inspected status, branch, HEAD, origin/main and diffs.
Branch and base matched the expected values above. No checkout, pull, reset,
stash or Undo Review occurred during continuation. All 21 implementation/test/
evidence/scratch files were read and classified before continuation edits.
The final migration already existed; no competing migration was created.

| Temporary artifact | Classification / purpose | Final disposition |
| --- | --- | --- |
| `.tmp-m14-build.cjs` | TEMPORARY_BUILD_ARTIFACT; compose permanent SQL | Removed after permanent output and validation |
| `.tmp-m14-generate.cjs` | TEMPORARY_BUILD_ARTIFACT; generate typed field/codec definitions | Removed; final typed codec retained |
| `.tmp-m14-header.sql` | TEMPORARY_BUILD_ARTIFACT; schema/admin SQL template | Removed; permanent migration retained |
| `.tmp-m14-footer.sql` | TEMPORARY_BUILD_ARTIFACT; admission/grant SQL template | Removed; permanent migration retained |
| `.tmp-m14-fields.json` | TEMPORARY_BUILD_ARTIFACT; intermediate closed field definitions | Removed; typed SQL/TypeScript retained |
| `.tmp-m14-semantics.txt` | TEMPORARY_BUILD_ARTIFACT; SQL semantic predicate fragment | Removed; permanent SQL checks retained |
| `.tmp-m14-testgen.cjs` | TEMPORARY_BUILD_ARTIFACT; fixture/codec generator | Removed; permanent fixtures retained |
| `.tmp-m14-db-bootstrap.sql` | TEMPORARY_TEST_ARTIFACT; auxiliary role/extension setup | Removed; explicit auxiliary bootstrap retained |
| `.tmp-m14-debug.sql` | TEMPORARY_TEST_ARTIFACT; constraint diagnosis | Removed after passing auxiliary validation |
| `.tmp-m14-db/` | TEMPORARY_TEST_ARTIFACT; disposable PG16 cluster | Task server stopped; cluster removed after evidence preservation |

Final permanent files (12):

- PERMANENT_IMPLEMENTATION: `supabase/migrations/20260917021203_runtime_observability_v1.sql`;
  `apps/dashboard/lib/governance/runtime-persistence.ts`;
  `apps/dashboard/lib/governance/runtime-row.ts`;
  `packages/governance-review/src/runtime-observation.ts`.
- PERMANENT_TEST: `apps/dashboard/tests/runtime-database.test.ts`;
  `apps/dashboard/tests/runtime-persistence.test.ts`;
  `apps/dashboard/tests/helpers/runtime-bootstrap.ps1`;
  `apps/dashboard/tests/helpers/runtime-database.ts`;
  `apps/dashboard/tests/helpers/runtime-fixtures.ts`;
  `apps/dashboard/tests/helpers/runtime-governed-fixtures.ts`;
  `packages/governance-review/test/runtime-observation.test.ts`.
- PERMANENT_EVIDENCE: this evidence document.

The user-owned recovery file is outside M14.2 delivery and remains byte-for-byte
unchanged. No temporary artifact is included in delivery. At this earlier checkpoint,
permanent work remained uncommitted because the local acceptance gate was blocked.
Checkpoint verification: 2 tracked modifications, 10 new permanent M14.2 files, the
unchanged user recovery file, and zero `.tmp-m14-*` artifacts. HEAD and origin/main
remain the base above. `git diff --check` and the PowerShell bootstrap syntax parse
passed. Only the task's disposable cluster was stopped; the installed PostgreSQL
Windows service was not changed.

## DoD and limitations

Architecture A–O: frozen CIA compatible; L12 persistence with L0 provenance;
future Passport families 13/14 only; no canonical/lineage authority creation;
immutable evidence and OBSERVED ceiling; no Vector/Graph/LLM change; tenant/RLS
enforcement; additive migration; M15 handoff remains immutable evidence only;
UNKNOWN/non-fabrication preserved; auxiliary SQL checks and the later authoritative
hosted Supabase/PostgreSQL 17 quality gate passed.

M14 DoD items 7–15 gain implementation and authoritative persistence evidence.
The M14.2 database gate now passes against the expressly authorized hosted test
project. Overall M14 producer-to-readback acceptance is still outside this wave. Items 16–19
remain enforced as non-mutation/non-authority boundaries. This does not satisfy
OTel adapter, real producer or producer-to-readback acceptance: those later waves
are not started. M14 overall is not complete.

The earlier auxiliary validation used native PostgreSQL 16.1 and a dependency
subset. The authoritative run below used hosted Supabase/PostgreSQL 17 with the
complete pending repository migration chain. Local Docker remains unavailable.
PostgREST HTTP transport was not exercised; the server adapter's RPC interaction
uses a mock, while SQL RPCs/constraints/grants/concurrency execute in hosted PostgreSQL.
Administrator fixture registration is not deployment automation or a public API.
Administrative verification of a release association remains an external trusted
step; the database validates/preserves its exact governed support, never discovers
an AgentVersion from a digest, name or fingerprint.

The disposable server is stopped during cleanup. Its temporary data/build
files are removed after preserving this evidence. No OTel/producer/runtime-provider validation,
full application deployment, M14 completion or M15 work is claimed.

## Earlier local-only verdict (superseded target)

**M14_2_DB_ACCEPTANCE_BLOCKED** — implementation preserved; Docker/Supabase
local PostgreSQL 17 unavailable. No commit or PR under the continuation gate.

## M14.2 — AUTHORITATIVE HOSTED SUPABASE ACCEPTANCE

The next continuation explicitly authorized forward migrations and isolated
acceptance fixtures only on hosted **ov-ia-g2-test**. The earlier PostgreSQL 16.1
evidence is preserved as auxiliary and was not rerun.

### Independently verified target and protection

Authenticated Supabase project listing and a fresh project-detail lookup returned:

| Role | Project name | Project ref | Health / hosted build |
| --- | --- | --- | --- |
| Authorized TEST/LAB | ov-ia-g2-test | zkqfvqwqdypgpzauzinw | ACTIVE_HEALTHY / 17.6.1.166 |
| Protected; identity lookup only | gov-ia-dev | bbisimozudihadfozyfz | ACTIVE_HEALTHY / 17.6.1.155 |

Actual TEST SQL server: **17.6**, `server_version_num=170006`, execution owner
`postgres`. The existing ignored CLI link already pointed to the verified test
project; no relinking occurred. Before migration execution the project identity
was refreshed through the authenticated API and the CLI link was checked against
the exact test ref, explicitly excluding the protected ref.

The hosted test helper checks the requested ref, ignored `project-ref`, and
`linked-project.json` name/ref before **every** query. Hosted execution requires
explicit opt-in; changing modes cannot silently redirect it to an auxiliary DB.
Pure wrong-target tests reject dev, unknown refs, mismatched names and missing
opt-in refs. Live read-only preflight also requires server major 17, existing
anon/authenticated/service_role roles, auth schema and the M14.2 migration entry.
No roles, credentials, service keys or connection strings are created by this helper.

### Migration planning and application

CLI version: **2.107.0**. Help confirmed supported flags. CLI project-list calls
failed with a transport error; authenticated connector project metadata established
identity instead. CLI database dry-run, push and query commands succeeded.

The current test schema had gov_repo, 15 canonical objects and 1 relationship;
M13 tables, normalized mappings and M14.2 were absent. Required foundation/source/
canonical tables and roles existed. Pending names had no table/type collisions.
Existing pgcrypto and vector extensions were present. The dry-run reported exactly:

```text
20260908120000_agent_version_technical_profile_persistence_v1.sql
20260909120000_semantic_representation_persistence_v1.sql
20260909210640_relationship_decision_to_truth_v1.sql
20260911120904_lineage_support_observations_v1.sql
20260911184613_technical_field_governance_v1.sql
20260915230551_execution_context_v1.sql
20260917021203_runtime_observability_v1.sql
```

Executed from the repository root, each following the exact link-ref guard:

```powershell
& ./node_modules/.bin/supabase.cmd db push --linked --dry-run
& ./node_modules/.bin/supabase.cmd db push --linked --yes
```

Both exited **0**. All seven files applied through normal forward migrations;
none was edited or reordered. No reset, schema drop, truncation or history repair.
Remote migration history advanced from `20260907130000` to `20260917021203`,
preserving original repository versions/names. A non-fatal CLI warning reported
that the local pg-delta catalog cache could not inspect a Docker image; subsequent
remote history and schema queries confirmed successful application.

Canonical state before/after migrations remained identical:

- Objects: 15; MD5 ordered-state fingerprint `de9bba0a6e126b78b9e6cfcbb93e9d8d`.
- Relationships: 1; fingerprint `633ffcf229a109f8a62a831c2d97ce9f`.
- Newly installed M13 snapshots: 0 before fixture setup.

### Authoritative schema inspection

All four runtime tables exist with RLS enabled. Observations have 215 typed
columns including recorded_at; zero JSON/JSONB persistence columns. Runtime tables
have 4 primary keys, 12 foreign keys, 3 unique constraints, 27 CHECK constraints
and 15 indexes. All five SECURITY DEFINER RPCs are owned by postgres and have
`search_path=pg_catalog`; references are qualified and errors are value-free.

### Isolated test execution

The existing suite is reused through `supabase db query --linked --output json`,
using separate CLI processes/database operations for actual concurrency. No
in-memory substitute, new dependencies, service keys or exported passwords.
Per-query temporary SQL files contain only test statements and are removed in
`finally`; no connection-string files are produced. DB errors are reduced to safe
codes before entering test logs. Canonical/M13 state comparisons return only hashes,
never existing record contents.

Fixture organisations:
`14200000-0917-4142-8142-000000000001` / `m142-20260917-a` and
`14200000-0917-4142-8142-000000000002` / `m142-20260917-b`.
Runtime connections use `m142-20260917-*`; governed fixture IDs use `m142-*`.
Preflight rejects occupied fixture identities. Five governed objects and one M13
snapshot are administrator fixtures established before runtime tests, never runtime
materialization. Negative UPDATE/DELETE attempts are tenant-scoped and enclosed
in rollback. Immutable fixture rows are retained in the authorized test project;
no cleanup backdoor, added DELETE grant or disabled trigger is used.

Acceptance command:

```powershell
& ./apps/dashboard/tests/helpers/runtime-bootstrap.ps1 -Mode HostedSupabase
node --import tsx --test apps/dashboard/tests/runtime-database.test.ts
```

The initial execution used the equivalent explicit environment settings:
`M14_HOSTED_DB_TEST=1`, `M14_DATABASE_MODE=supabase-hosted`,
`M14_HOSTED_PROJECT_REF=zkqfvqwqdypgpzauzinw`.

Main suite result: **15 passed / 0 failed / 0 skipped**, 619,426 ms total.
This comprises three structural/target-guard checks, eleven database subtests and
their parent container. The server migration and runtime implementation required
no correction after hosted execution.

The rate-limit continuation recovered this completed result instead of rerunning
the main suite. Read-only inspection confirmed the migration already registered,
four RLS tables, 14 existing runtime observations, five isolated governed fixtures
and one M13 fixture snapshot. Both project names/refs were independently refreshed.
HEAD still matched the original base; no commit existed and `gh pr list --head
feat/m14-runtime-persistence-v1 --state all` returned an empty list. Existing
implementation and recovery file were preserved.

Only the previously unexecuted four-reason UNKNOWN check remained. Its four
reserved span IDs were confirmed absent before writing. Executed separately:

```powershell
& ./apps/dashboard/tests/helpers/runtime-bootstrap.ps1 -Mode HostedSupabase
node --import tsx --test --test-name-pattern='existing hosted fixture preserves all four UNKNOWN reasons' apps/dashboard/tests/runtime-database.test.ts
```

Supplemental result: **1 passed / 0 failed / 0 skipped**, 47,590 ms total.
Both commands together establish **16 passing checks**, with no duplicate main
suite execution and no fixture deletion. Future full runs require unused fixture
identities; the existing scope deliberately fails closed instead of erasing history.

| Authoritative hosted gate | Result |
| --- | --- |
| Schema, typed columns, constraints, indexes, RLS | PASS |
| Registration/admin, immutable configuration, activation and inactive new-event rejection | PASS |
| Telemetry cannot self-register; PUBLIC/client function access restricted | PASS |
| Five kinds: EXECUTION, MODEL_CALL, TOOL_CALL, MCP_CALL, API_CALL | PASS |
| All UNKNOWN reasons round-trip with explicit state/reason | PASS |
| Nanosecond/count/decimal precision, year 0000 and invalid bounds | PASS |
| recordedAt assigned by DB, override rejected, readback validated | PASS |
| Sequential identical replay preserves original row/ID/time/binding/provenance | PASS |
| Sequential changed payload/version rejects without overwrite | PASS |
| Eight parallel identical admissions | 1 insert + 7 equivalent replays; 8 distinct backend PIDs; 1 row |
| Two parallel conflicting admissions | 1 winner + 1 RUNTIME_REPLAY_CONFLICT; 1 row |
| Sequential quota, historical replay after rotation/deactivation | PASS |
| Three parallel distinct events competing for one slot | 1 accepted + 2 quota rejections; replay retains 1 row |
| Tenant/source/configuration/binding/AgentVersion/target/mapping/evidence isolation | PASS |
| Same trace/span across a valid other connection/tenant remains separate | PASS |
| Actual anon/authenticated/service_role direct DML and admin RPC rejection | PASS |
| Observation/configuration/binding immutability | PASS |
| Legitimate governed EXACT binding accepted; wrong-kind/foreign/forged proof rejected | PASS |
| Canonical/M13/AgentVersion-profile ordered-state hashes unchanged during runtime operations | PASS |

Final read-only totals: **4 sources, 8 immutable configurations, 1 binding,
18 observations**. Concurrent identical/conflict identities each have one row;
quota connection has one row. Canonical objects total 20 = 15 pre-existing + 5
explicit admin fixtures. Relationships remain 1; M13 snapshots total 1, the admin
fixture. Original non-fixture object and relationship hashes remain respectively
`de9bba0a6e126b78b9e6cfcbb93e9d8d` and `633ffcf229a109f8a62a831c2d97ce9f`.
Runtime admission created **zero canonical objects and zero relationships**;
the suite's before/after hash covers M13 snapshots/states/decisions/heads and
AgentVersion technical profiles/proposals as well.

Security advisors were inspected. M14.2 has only the expected informational
[RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
notices on its four tables: direct access is intentionally revoked and admitted
through restricted RPCs. No M14.2 mutable-search-path/public-execution warning.
Unrelated existing legacy function/extension/Auth notices were not changed in this
M14.2 task; this is not a clean bill of health for the entire project.

### Final local regressions after authoritative acceptance

| Command | Result |
| --- | --- |
| `npm test --workspace @council/canonical-contracts` | 220 passed |
| `npm test --workspace @council/governance-review` | 318 passed |
| Dashboard command below | 201 passed / 0 failed / 2 remote tests intentionally skipped |
| `npm run typecheck --workspace @council/canonical-contracts` | PASS |
| `npm run typecheck --workspace @council/governance-review` | PASS |
| `npm run typecheck:dashboard -- --incremental false` | PASS |
| `npm run typecheck:scanner` | PASS |
| `npm run typecheck:graphos-pkg` | PASS |
| `git diff --check` and PowerShell bootstrap syntax parse | PASS |

Dashboard command, from `apps/dashboard`, without DB opt-in:

```powershell
node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/*migration.test.ts tests/runtime-database.test.ts tests/runtime-persistence.test.ts tests/execution-context-service.test.ts tests/execution-context-route.test.ts
```

An initial focused test command omitted `--experimental-test-module-mocks` and
failed at the existing test hook; rerunning with the required flag passed. A
TypeScript redundant-literal comparison in the new target guard was corrected
before hosted fixture execution. These were harness issues, not DB acceptance
failures. No package or lockfile changes were required.

### Final verdict and delivery boundary

**M14_2_READY_FOR_REVIEW**. Authoritative hosted acceptance and all requested
local regressions/typechecks passed. The 12 permanent M14.2 files are the delivery
candidate; no temporary artifacts, credentials or ignored project-link metadata
belong in the commit. The protected user recovery file remains outside delivery.
No M14.3/OTel/producer integration, end-to-end HTTP/PostgREST acceptance, full M14
completion or M15 behavior is claimed. Commit/push/PR are authorized; merge is not.

Remote writes: **ov-ia-g2-test = YES, AUTHORIZED; gov-ia-dev = NO**.
No database operation of any kind was sent to gov-ia-dev; only project identity
metadata was inspected. No secrets exposed. ADR/roadmap/producer unchanged;
OTel not installed; M14.3 and M15 not started.
