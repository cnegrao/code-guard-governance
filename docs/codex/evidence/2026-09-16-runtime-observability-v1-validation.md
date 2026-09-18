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

## Independent adversarial review remediation (2026-09-17)

An independent Claude adversarial review of PR #38 against this baseline returned
**FIXES_REQUIRED_M14_2**. Correction to the statement above: the original
acceptance run's "Nanosecond/count/decimal precision" row passed only for the
paths it actually exercised — `started_nano`, `duration_value` (never set to
`KNOWN` in any fixture), token/usage/dropped counts and cost amounts/rates. It
did **not** exercise a `KNOWN` `endedAtUnixNano` or `sourceObservedAtUnixNano`
value anywhere, hosted or local, so it did not prove complete `RuntimeUnixNano`
readback coverage. That gap, and a second tenant-isolation defect, are corrected
below. `20260917021203_runtime_observability_v1.sql` itself is **not edited** —
migration history remains truthful — and both defects are fixed by an additive
migration, `20260917192615_runtime_observability_v1_review_fixes.sql`.

### F01 — CRITICAL — lossless `ended_nano_value`/`source_observed_nano_value` readback

**Root cause:** `gov_repo.runtime_readback` cast `started_nano`, `duration_value`
and the cost amounts/rates to `text` before JSON serialization, but omitted
`ended_nano_value` and `source_observed_nano_value` — both full-range `bigint`
(unix nanoseconds, unbounded up to `9223372036854775807`, unlike token/usage/
dropped-count columns which are deliberately bounded to
`Number.MAX_SAFE_INTEGER`). `to_jsonb` therefore emitted them as bare JSON
numbers, silently losing precision above `Number.MAX_SAFE_INTEGER` once the
value crossed the JSON boundary, and the TypeScript row codec accepted whatever
type arrived instead of requiring a string.

**Fix:** `CREATE OR REPLACE FUNCTION gov_repo.runtime_readback` in the new
additive migration adds `'ended_nano_value', o.ended_nano_value::text` and
`'source_observed_nano_value', o.source_observed_nano_value::text` to the
existing `jsonb_build_object` overlay, matching the existing `started_nano`
treatment exactly. `CREATE OR REPLACE` preserves the function's OID, owner and
ACL; confirmed on `ov-ia-g2-test` after the migration that
`gov_repo.runtime_readback` still carries no EXECUTE grant beyond the owner
(`postgres=X/postgres`), identical to before. Companion TypeScript fix in
`apps/dashboard/lib/governance/runtime-row.ts`: `ended_nano_value` and
`source_observed_nano_value` moved from the `'native'` to the `'decimal'`
column encoding, so `runtimeFromRow` now requires both to arrive as strings
and rejects a numeric readback instead of silently accepting one.

**New exact values tested (authoritative, `ov-ia-g2-test`):** a fresh
observation with `startedAtUnixNano = "1000000000000000000"`,
`endedAtUnixNano = KNOWN("9223372036854775807")` (the signed BIGINT upper
bound, ~1024x past `Number.MAX_SAFE_INTEGER`), `sourceObservedAtUnixNano =
KNOWN("9223372036854775807")` (independently, same bound), and
`duration = KNOWN(basis: START_END_DIFFERENCE, value: "8223372036854775807")`
exactly equal to `ended - started`. Test: `apps/dashboard/tests/runtime-
database.test.ts`, `'F01 regression: ended/source-observed unix-nano and
duration survive the real JSON boundary at BIGINT scale'`.

**Authoritative Supabase result:** PASS. All three values round-tripped
through the real `admit_runtime_observation` → PostgreSQL → `runtime_readback`
→ Supabase CLI JSON boundary → `runtimeFromRow` → `validatePersistedRuntimeObservation`
path as exact strings (`typeof === 'string'` asserted, `BigInt(...) >
BigInt(Number.MAX_SAFE_INTEGER)` asserted), with byte-for-byte string equality
to the input. A same-row replay afterward returned `replay: true` with a
`deepEqual` match against the original durable JSON, confirming the fix does
not disturb replay identity/equality. Canonical/M13 ordered-state hash was
asserted unchanged before/after (`authorityState()`).

### Numeric transport audit (section 5 of the review)

Every `bigint`/`numeric` column reachable through `runtime_readback` was
inspected against its CHECK-constraint range and the M14.1 contract's declared
type:

| Field | SQL type | Contract range | JSON representation | JS representation | Status |
| --- | --- | --- | --- | --- | --- |
| `started_nano` | `bigint`, unbounded | `RuntimeUnixNano` string, up to `9223372036854775807` | text (cast) | exact string | OK (already correct) |
| `ended_nano_value` | `bigint`, unbounded | `RuntimeUnixNano` string | **was bare number** → text (cast) | **was lossy number** → exact string | **FIXED (F01)** |
| `source_observed_nano_value` | `bigint`, unbounded | `RuntimeUnixNano` string | **was bare number** → text (cast) | **was lossy number** → exact string | **FIXED (F01)** |
| `duration_value` | `bigint`, unbounded | `RuntimeDurationNano` string | text (cast) | exact string | OK (already correct, now exercised at BIGINT scale for the first time) |
| `tokens_input_value` / `tokens_output_value` / `tokens_total_value` | `bigint`, CHECK-bounded `0..9007199254740991` | plain `number` (`Number.isSafeInteger`) | bare number | exact number | OK by design — bounded to the safe-integer domain |
| `usage_input` / `usage_output` | `bigint`, CHECK-bounded `0..9007199254740991` | plain `number` | bare number | exact number | OK by design |
| `dropped_attributes_value` / `dropped_events_value` / `dropped_links_value` | `bigint`, CHECK-bounded `0..9007199254740991` | plain `number` | bare number | exact number | OK by design |
| `supplied_amount` / `derived_amount` | `numeric(27,9)` | `RuntimeDecimal` string | text (cast) | exact string | OK (already correct) |
| `input_rate` / `output_rate` | `numeric(27,9)` | `RuntimeDecimal` string | text (cast) | exact string | OK (already correct) |

No further deterministic lossless-readback defect was found. No field required
a semantic-type change; no `STOP_REQUIRES_IMPLEMENTATION_DECISION` condition
was reached.

### F02 — HIGH — tenant-scoped connection identity

**Root cause:** `gov_repo.runtime_source_heads.connection_id` carried a bare,
table-wide `unique` constraint (`runtime_source_heads_connection_id_key`) in
addition to the compound `PRIMARY KEY(organisation_id, connection_id)`. This
forced every tenant's runtime connection label into one global namespace,
contradicting the "organisation + connection" tenant-scoped identity the ADR
and the rest of this schema use elsewhere. Because `runtime_source_heads` rows
can never be deleted (`runtime_source_no_delete` trigger), the collision was
also permanent and irreversible once any tenant claimed a given label.

**Verification before dropping:** read-only inspection of `ov-ia-g2-test`
(`pg_constraint`) confirmed `runtime_source_heads_connection_id_key` was the
only constraint referencing `connection_id` alone, and that both dependent
foreign keys (`runtime_deployment_bindings`, `runtime_source_configurations`)
already reference the compound `(organisation_id, connection_id)`, which the
retained primary key continues to satisfy. No FK depended on the bare unique
constraint.

**Fix:** the additive migration drops
`runtime_source_heads_connection_id_key` via `ALTER TABLE ... DROP CONSTRAINT`.
`PRIMARY KEY(organisation_id, connection_id)` is retained unchanged; no
compound FK was touched.

**Same connection label across two tenants (authoritative, `ov-ia-g2-test`):**
a new, previously unused connection label (`m142-20260917-shared-connection`)
was registered independently under both the existing fixture organisations
(`14200000-...-001` and `...-002`). Both registrations succeeded (previously
the second would have failed on the dropped constraint). Both tenants'
`runtime_source_heads`/`runtime_source_configurations` rows were confirmed
distinct and correctly org-scoped; admitting the identical `traceId`/`spanId`
under each tenant on the shared label produced two independent, non-replayed
rows (`replay: false` for both, two distinct `organisation_id` values on the
same `connection_id, span_id`); a same-tenant replay of the first row still
returned `replay: true` with an exact match; and admitting the first tenant's
row under the second tenant's id was rejected
(`RUNTIME_OBSERVATION_INVALID`) — the shared label creates no cross-tenant
bypass. Test: `apps/dashboard/tests/runtime-database.test.ts`, `'F02
regression: identical connection_id label across two tenants stays isolated,
not merged'`. Canonical/M13 ordered-state hash was asserted unchanged
before/after.

### F03 — coverage expansion

`apps/dashboard/tests/helpers/runtime-fixtures.ts` gains `precisionBoundary()`,
an `EXECUTION` fixture with `KNOWN` `endedAtUnixNano`, `sourceObservedAtUnixNano`
and a `KNOWN` `duration` (`START_END_DIFFERENCE` basis, exactly `ended -
started`) at BIGINT scale. It is exercised both in the mocked/unit-level
`'closed row codec'` test in `runtime-persistence.test.ts` (no database) and,
authoritatively, in the F01 database test above. `duration.state = 'KNOWN'`
had no prior coverage anywhere in the suite; it now does.

### No regression in existing replay/quota/tenancy/canonical paths

The one-time authoritative fixtures created during the original acceptance run
(organisations, connections, the 18 pre-existing observations, the 4 sources,
8 configurations and 1 binding) are immutable and were **not** re-created or
re-consumed; the main suite's own preflight guard correctly refuses to repeat
completed writes, by design, and was not bypassed. Instead, no-regression was
established by:

- Read-only, byte-for-byte comparison (`pg_get_functiondef`, whitespace-normalized)
  confirming `gov_repo.admit_runtime_observation` (all replay/conflict/quota/
  binding/canonical-target logic) and `gov_repo.runtime_same_observation`
  (replay equality) on `ov-ia-g2-test` are **identical** to the original,
  unedited `20260917021203_runtime_observability_v1.sql` source — the
  additive migration touches neither function.
- The new F01 and F02 tests above each independently re-exercise a fresh
  insert-then-replay cycle end-to-end against the live database and both
  passed, including exact-match replay comparison.
- `authorityState()` (canonical objects/relationships, M13 snapshots/states/
  decisions/heads, AgentVersion technical profiles/proposals) was asserted
  unchanged before/after both new tests.
- Full local regression: `@council/canonical-contracts` 220 passed,
  `@council/governance-review` 318 passed, dashboard runtime/migration/M13
  tests 201 passed with 2 DB-gated tests intentionally skipped — identical
  counts to the original acceptance run. All five required typechecks and
  `git diff --check` passed.

### Remote writes and scope

Remote writes: **ov-ia-g2-test = YES, AUTHORIZED** (one additive migration
applied; migration history before: `...20260917021203`; after:
`...20260917021203, 20260917192615`). **gov-ia-dev = NO** — not queried, not
written, not linked. No secrets appear in the diff, this document or test
output. ADR/roadmap unchanged; OTel not installed; producer not modified;
M14.3 and M15 not started; no architecture decision was required for either
fix.

**Verdict: M14_2_REVIEW_FIXES_READY.** Both accepted findings (F01 CRITICAL,
F02 HIGH) are fixed and authoritatively re-validated; F03 coverage gaps are
closed; L01/L02 were left unchanged per the review's own non-blocking
classification. Commit/push are authorized; merge is not.

## M14.3A — OTel Adapter Mapping and Sanitization

This section is additive M14.3A evidence. All preceding M14.2 history is retained
unchanged. M14.2 is COMPLETE / ACCEPTED / MERGED / FROZEN (PR #38).
The prior hosted-write authorization recorded above does **not** apply to this
substage: database writes and remote Supabase operations here are NONE.

### Base, scope and architecture inputs

`git fetch origin`, `git checkout main`, `git pull --ff-only origin main` completed;
both `HEAD` and `origin/main` were verified as
`3f36621beecd0a4979333c20720e2cde71219289` before implementation.
Fresh branch: `feat/m14-otel-adapter-v1`. The pre-existing untracked
`codex-recovery-6101-6240.txt` is preserved and excluded from delivery.

Read in full before implementation:

- `docs/architecture/GOVIA-L0L16-CIA-v1.0.md`.
- `docs/architecture/ADR-GOVIA-RUNTIME-OBSERVATION-AND-OTEL-INGESTION-v1.md`.
- This existing M14.2 evidence record.
- `packages/canonical-contracts/src/runtime-observation.ts`.
- `packages/governance-review/src/runtime-observation.ts`.
- `apps/dashboard/lib/governance/runtime-persistence.ts` and `runtime-row.ts`.
- `supabase/migrations/20260917021203_runtime_observability_v1.sql`.
- `supabase/migrations/20260917192615_runtime_observability_v1_review_fixes.sql`.

`supabase/config.toml` was inspected read-only: configured PostgreSQL major 17.
No database connection, migration, CLI database invocation or project mutation.

Architecture A–O: unchanged frozen CIA (A); L12 mapping and L0 provenance (B);
no Passport implementation, future families 13/14 only (C); no canonical identity
or relationship creation (D); parentage remains scoped telemetry evidence (E);
immutable method/source/configuration/versions and exact times (F); OBSERVED has
zero governance authority (G); no Vector/Graph/LLM changes (H–J); trusted tenant
and source with safe metadata extraction (K); no migrations (L); existing M14.2
persistence compatibility and future M15 evidence boundary (M); UNKNOWN and
non-fabrication retained (N); focused fixture/adversarial/compatibility tests plus
the requested regressions, without claiming producer/database acceptance (O).

### Placement and files

| File under apps/dashboard | Responsibility |
| --- | --- |
| `lib/runtime/otel-contract.ts` | Narrow internal input, trusted context, closed result/error codes, version constants and per-kind attribute allowlists |
| `lib/runtime/otel-span-adapter.ts` | Pure source-specific extraction, sanitization, mapping and existing domain validation |
| `lib/runtime/README.md` | Exhaustive input/attribute/value mappings, trust boundaries and limitations |
| `tests/helpers/otel-fixtures.ts` | Explicit synthetic fixtures, no producer execution |
| `tests/otel-span-adapter.test.ts` | Domain, sanitization, identity, precision and hostile-input coverage |
| `tests/otel-persistence-contract.test.ts` | All five outputs through unchanged persistRuntimeObservation with mock RPC/readback |

This evidence appendix is the only modification to an existing tracked file.
The application already owns runtime integration; a separate pure `lib/runtime`
directory is the narrowest placement without adding a workspace or dependency.
It depends on canonical-contracts and governance-review, never the reverse, and
does not import persistence. Canonical contracts retain no SDK types.

### Dependencies and revisions

Inspected root, domain and dashboard manifests, package-lock, repository manifest
OTel references and existing Next optional peer. Before and after: **no installed
OTel packages, no package.json or package-lock changes, no unrelated upgrades**.
Next is locked to **15.5.19**, optional `@opentelemetry/api` peer **^1.1.0**.
Node used for checks: **24.19.0**.

The planned exact API **1.9.0**, sdk-trace-base **2.0.1**, resources **2.0.1**,
semantic-conventions **1.29.0** remain deferred, not installed. Versioned upstream
[sdk-trace-base manifest](https://github.com/open-telemetry/opentelemetry-js/blob/v2.0.1/packages/opentelemetry-sdk-trace-base/package.json)
and [resources manifest](https://github.com/open-telemetry/opentelemetry-js/blob/v2.0.1/packages/opentelemetry-resources/package.json)
specify API peer `>=1.3.0 <1.10.0`, semconv dependency `^1.29.0`, and Node
`^18.19.0 || >=20.6.0`. These ranges permit the selected versions and current
Next/Node; no compatibility conflict was found. No installation/resolution or live
SDK compatibility is claimed. The adapter needs only the narrow internal DTO.

Core trace target **1.41.0**; HTTP attribute revision **1.29.0**;
adapter **govia-otel-span/1.0.0**; mapping **govia.runtime/1.0.0**;
schema **runtime-observation/1.0.0**. Frozen domain version fields remain `1.0.0`.
Method is `GOVIA_OTEL_SPAN/1.0.0`. GenAI and MCP conventions remain
UNKNOWN/UNSUPPORTED. Exact inputs, attributes and corresponding domain fields are
documented in [the adapter mapping](../../../apps/dashboard/lib/runtime/README.md).

### Supported inputs, sanitization and domain semantics

All five kinds supported: **EXECUTION, MODEL_CALL, TOOL_CALL, MCP_CALL, API_CALL**.
`govia.observation.kind` plus kind-compatible `govia.operation` are mandatory;
unknown/generic/HANDOFF semantics reject, with no EXECUTION fallback or name mapping.

Common span keys: `govia.observation.kind`, `govia.operation`, `govia.error.code`.
Call keys: `govia.target.provider`, `govia.target.reference`. MODEL_CALL additionally
supports `govia.model.reported`, `govia.usage.input_tokens`,
`govia.usage.output_tokens`, `govia.usage.total_tokens`. MCP_CALL additionally
supports `govia.mcp.transport`, `govia.mcp.tool`, `govia.mcp.result`.
API_CALL additionally supports `govia.api.protocol`, `http.request.method`,
`http.response.status_code`. No other span attributes are read.

Resource keys: `govia.producer.id`, `telemetry.sdk.name`, `telemetry.sdk.version`,
optional paired `govia.deployment.reference` and `govia.artifact.sha256`.
Scope name/version and source producer/SDK identity must match trusted metadata.
Parent, optional end/source time, trace sampled flag and three dropped counts are
explicit bounded DTO fields. All mapping/version/enum/allowlist details are in README.

Extraction reads fixed own data descriptors, ignores excluded subtrees without
traversing/copying them, and rejects relevant accessors. Bounded safe reference
syntax is supplemented by exact trusted target/model/tool/release approvals.
No credential-bearing or generic URL is accepted as a target. Required unsafe
identity rejects; raw status/exception text never becomes an error classification.
No raw telemetry is hashed, logged, serialized, snapshotted or returned in diagnostics.
Only safe metadata reaches the unchanged domain validator. Return errors contain
one closed stable code and no payload value/message/cause/path.

Tenant/connection/configuration/producer authorization is supplied by trusted
orchestration only. Semantic event identity is tenant + connection + trace + span;
the assigned UUID is not a replacement. Parent omission stays UNKNOWN; explicit
source no-parent (`null`) alone establishes ROOT. No parent lookup or global merge.
Exact timestamps use strings and BigInt, preserving all three source time fields
up to **9223372036854775807**; no Number conversion or clock substitution.
Received time is trusted; recorded time remains database-owned.

UNSET is preserved and does not imply success. Supported OK/ERROR map by OTel
status; explicit supported HTTP/MCP results provide distinct bases. Contradictory
results reject. Independent token fields retain missing versus explicit zero and
do not require total=input+output. Cost SUPPLIED and DERIVED both remain
UNKNOWN/UNSUPPORTED: this mapping has no safe supplied-cost or complete pricing
contract. Principal/environment/network and sampling rate remain UNKNOWN.

EXACT requires an independently verified trusted binding matching tenant, runtime
connection and the observed approved release coordinates. Foreign/mismatched/unproven
method fails; payload IDs never become proof. Canonical targets require independently
verified trusted exact mappings of the correct tenant/kind/provider/reference;
duplicate approved target matches reject. No canonical relationships are created.

### Validation results

| Command / scope | Result |
| --- | --- |
| `npm test --workspace @council/canonical-contracts` | 220 passed, 0 failed |
| `npm test --workspace @council/governance-review` | 318 passed, 0 failed |
| Dashboard command below (including new adapter/compatibility tests) | 231 passed, 0 failed, 4 database tests intentionally skipped |
| New tests within that dashboard total | 30 passed (29 adapter tests + 1 five-kind mock persistence test) |
| `npm run typecheck --workspace @council/canonical-contracts` | PASS |
| `npm run typecheck --workspace @council/governance-review` | PASS |
| `npm run typecheck:dashboard -- --incremental false` | PASS |
| `npm run typecheck:scanner` | PASS |
| `npm run typecheck:graphos-pkg` | PASS |
| `git diff --check` | PASS |

Dashboard command from `apps/dashboard`; database opt-ins explicitly disabled
in the command process, so even pre-existing shell settings cannot enable writes:

```powershell
$env:M14_LOCAL_DB_TEST='0'
$env:M14_HOSTED_DB_TEST='0'
node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/*migration.test.ts tests/runtime-database.test.ts tests/runtime-persistence.test.ts tests/execution-context-service.test.ts tests/execution-context-route.test.ts tests/otel-span-adapter.test.ts tests/otel-persistence-contract.test.ts
```

The initial focused runner hit sandbox `spawn EPERM`; rerunning with execution
approval passed. No functional test failure. Existing experimental module-mock
warnings are tooling notices, not live SDK or database behavior. The four skipped
cases are the existing gated database acceptance/supplemental checks; structural
migration tests execute read-only and do not count as database acceptance.

Hostile synthetic fixtures cover Authorization/Bearer, key/JWT/password/private-key
shapes, credential URLs, prompts/completions, bodies, tool arguments/results,
headers/cookies, exceptions/stacks, baggage, names, resource spoofing, getters,
prototypes, cyclic excluded trees and reflection errors. They verify unchanged
safe serialization and sanitized-only hashes, zero log calls, value-free rejection,
no raw-content persistence arguments and no canonical authority. Assertion failures
on hostile content use booleans to avoid echoing raw fixtures into test output.
No snapshots or real secrets are introduced.

### Limitations and final scope guards

Real producer coverage: **NONE — NOT YET INSTRUMENTED**. SDK export, live model
inference, billing, OTLP, PostgREST and database admission are not exercised here.
Trusted context is a caller responsibility, not a new authentication/source loader.
Future transport must bound incoming bytes/batches and supply authorized immutable
configuration. Existing M14.2 still verifies actual durable references and admission.
No provider-specific OpenAI usage rule or general pricing service is implemented.
Pure fixture validation cannot certify full M14 acceptance.

DATABASE WRITES: NONE. REMOTE SUPABASE WRITES: NONE. M14.2 CHANGED: NO.
ADR CHANGED: NO. ROADMAP CHANGED: NO. M14.2 MIGRATIONS CHANGED: NO.
PRODUCER MODIFIED: NO. OPENAI/TALK MODIFIED: NO. HTTP/OTLP ROUTE CREATED: NO.
PASSPORT MODIFIED: NO. M15 STARTED: NO. CANONICAL WRITE PATH CREATED: NO.

M14.3A delivery gate: implementation and tests pass; commit/push/new PR are
authorized, **DO NOT MERGE**. M14.2 history and the protected recovery file are
preserved. Verdict: **M14_3A_READY_FOR_REVIEW**.

## M14.3A PR #39 — narrow F1 + F3 review follow-up (2026-09-18)

Continued on `feat/m14-otel-adapter-v1` from reviewed HEAD
`64dde2c12c52585946321d63dcfaec12396f26b9`, with base
`3f36621beecd0a4979333c20720e2cde71219289`. The independent review verdict
supplied for this follow-up was **PASS_M14_3A_REVIEW**, with no CRITICAL or HIGH
findings. Scope is only accepted F1 (MEDIUM) and F3 (LOW); this is not M14.3B.

### F1 — version linkage

`otel-contract.ts` now owns separate `OTEL_ADAPTER_SEMVER`,
`OTEL_MAPPING_SEMVER` and `OTEL_RUNTIME_SCHEMA_SEMVER`, each currently `1.0.0`.
The three public qualified identifiers are derived from those constants, and
the adapter uses the same semantic constants for the corresponding provenance
fields. Qualified names identify named artifacts/contracts; the frozen domain
continues to carry only its closed semantic value, never a qualified string.

The frozen contract models `provenance.method` separately as code/version, and
the existing README identifies the method as `GOVIA_OTEL_SPAN/1.0.0`.
Its independent version is now explicit as `OTEL_METHOD_VERSION = '1.0.0'`.
It is not aliased to adapter, mapping or schema version. The separate duration
calculation method and all binding-proof versions remain unchanged.

The new explicit regression compares each public qualified identifier to the
matching semantic provenance field after `runtimeToRow` -> `runtimeFromRow` ->
`validatePersistedRuntimeObservation`, with a synthetic recorded timestamp. It
also compares each semantic field to its constant and method code/version to
`GOVIA_OTEL_SPAN`/`OTEL_METHOD_VERSION`. No snapshots. Result: **PASS**.

### F3A — END_TIME without DURATION

The new test supplies a source configuration supporting only `END_TIME` and an
exact end value `9223372036854775807`. The adapter accepts it, preserves
`endedAtUnixNano = KNOWN(exact value)` and returns
`duration = UNKNOWN(UNSUPPORTED)`. It neither discards the end time nor derives
an unsupported duration nor substitutes NOT_SUPPLIED. Result: **PASS**.

### F3B — EXACT binding codec round-trip

The new test creates an EXACT adapter observation using trusted `verifiedBinding`
and observed approved deployment/artifact coordinates. It passes the observation
through the existing `runtimeToRow`, `runtimeFromRow` and
`validatePersistedRuntimeObservation`, supplying synthetic database-owned
`recorded_at = 2026-09-18T00:00:00.000Z`. Explicit assertions preserve EXACT state,
agentVersion, coordinates, full proof, deploymentBindingId, organisationId,
connectionId, method and version; the complete observation also round-trips
apart from the expected recordedAt assignment. Result: **PASS**.
No database was called; `runtime-row.ts` and all M14.2 code remain unchanged.

### F2 disposition

**F2 LOW / NON-BLOCKING / ACCEPTED FOR M14.3A — UNCHANGED.** The fixed
`coverage.limitations` set expresses conservative adapter/collection-level
uncertainty, not per-field factual state. Any future per-observation refinement
belongs to a separate architecture/adapter revision if needed.

### Follow-up validation and scope

Focused tests ran first:

```powershell
node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/otel-span-adapter.test.ts tests/otel-persistence-contract.test.ts
```

Affected dashboard/runtime regression, also from `apps/dashboard`:

```powershell
node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/runtime-persistence.test.ts tests/execution-context-service.test.ts tests/execution-context-route.test.ts tests/otel-span-adapter.test.ts tests/otel-persistence-contract.test.ts
```

| Check | Follow-up result |
| --- | --- |
| Focused M14.3A tests | 33 passed, 0 failed, 0 skipped; includes the three new regressions |
| `npm test --workspace @council/canonical-contracts` | 220 passed |
| `npm test --workspace @council/governance-review` | 318 passed |
| Affected dashboard/runtime command above | 52 passed, 0 failed, 0 skipped; includes focused tests |
| `npm run typecheck --workspace @council/canonical-contracts` | PASS |
| `npm run typecheck --workspace @council/governance-review` | PASS |
| `npm run typecheck:dashboard -- --incremental false` | PASS |
| `npm run typecheck:scanner` | PASS |
| `npm run typecheck:graphos-pkg` | PASS |
| `git diff --check` | PASS |

Governance-review's initial sandbox invocation was blocked by esbuild subprocess
`spawn EPERM`; the approved rerun passed all 318 tests. No functional test failure.
Database tests were not run or required. Existing module-mock tooling warnings
do not change the results above.

Files changed: `apps/dashboard/lib/runtime/otel-contract.ts`,
`apps/dashboard/lib/runtime/otel-span-adapter.ts`,
`apps/dashboard/lib/runtime/README.md`,
`apps/dashboard/tests/otel-span-adapter.test.ts`, and this evidence appendix.
Prior evidence remains intact. The pre-existing user recovery file is preserved.

DEPENDENCY CHANGES: NO. DATABASE WRITES: NO. REMOTE SUPABASE WRITES: NO.
MIGRATION CHANGES: NO. M14.2 CHANGES: NO. PRODUCER MODIFIED: NO.
OPENAI/TALK MODIFIED: NO. INGESTION ROUTE CREATED: NO. PASSPORT MODIFIED: NO.
M15 STARTED: NO. ADR CHANGED: NO. ROADMAP CHANGED: NO.

Delivery: commit/push on the same branch updates PR #39; no new PR and no merge.
Verdict: **M14_3A_REVIEW_FOLLOWUP_READY**.

## M14.3B — Internal Runtime Ingestion Boundary

Execution date: 2026-09-18. M14.3A (PR #39) and M14.2 remain COMPLETE / ACCEPTED /
MERGED / FROZEN. All preceding evidence is retained unchanged. Historical hosted
write authorization above does not apply here: **DATABASE WRITES: NONE**.

### Base and architecture inputs

Executed `git fetch origin`, `git checkout main`, `git pull --ff-only origin main`.
Both main HEAD and origin/main matched the required
`48f13b8cf8497d48c77e2cc8ade4d3307237fc7d` before creating the fresh branch
`feat/m14-runtime-ingestion-boundary-v1`. The pre-existing untracked
`codex-recovery-6101-6240.txt` is preserved and excluded from delivery.

Read in full: frozen `GOVIA-L0L16-CIA-v1.0.md`, frozen runtime/OTel ADR,
`lib/runtime/README.md`, `otel-contract.ts`, `otel-span-adapter.ts`,
`lib/governance/runtime-persistence.ts`, `runtime-row.ts`,
`tests/otel-persistence-contract.test.ts`, and this evidence history.
`supabase/config.toml` was inspected read-only (PostgreSQL major 17).
Application source/configuration references and M14.2 administration documentation
were inspected: no safe application runtime source configuration loader exists;
restricted database administration RPCs do not constitute such a loader.

Architecture A–O: frozen CIA preserved (A); L12 composition and L0 provenance (B);
no Passport change, future families 13/14 only (C); no canonical writes/identity
changes (D); observed ancestry remains evidence (E); immutable provenance/times (F);
OBSERVED confers no authority (G); no Vector/Graph/LLM change (H–J); trusted tenant
and connection consistency, sanitized-only persistence (K); no migration (L);
existing M14.2 admission and future M14.4 producer continuity (M); UNKNOWN and
non-fabrication preserved (N); focused composition and regression gates below (O).

### Files and API

| File | Change |
| --- | --- |
| `apps/dashboard/lib/runtime/runtime-ingestion.ts` | New server-only composition and four-code typed error |
| `apps/dashboard/lib/runtime/README.md` | Additive M14.3B API, trust, flow, errors and limitations |
| `apps/dashboard/tests/runtime-ingestion.test.ts` | Ten focused tests using the real adapter and mocked persistence |
| `apps/dashboard/tests/otel-persistence-contract.test.ts` | Route structural compatibility through ingestion; real adapter/persistence/readback with mock RPC only |
| This evidence document | Additive M14.3B record |

API: `ingestSupportedRuntimeSpan(persistenceContext, adapterContext, span)` returns
`Promise<RuntimePersistenceResult>`: typed persisted `observation` and `replay`.
The module uses `import 'server-only'`; dependency direction is application runtime
boundary -> adapter/domain and existing server persistence. No persistence imports
were added to canonical-contracts or the pure adapter. No transport was created.

### Trust, composition and sanitization

The caller must supply both contexts from already-authorized trusted server
orchestration. M14.3B does not authenticate, register sources, load configuration,
resolve identity or verify database existence. Adapter context is the immutable
authorized source projection, including system/provider/configuration version,
producer/instrumentation identity, supported kinds/facts, approved targets/models/
tools/deployments and independently verified binding. Telemetry supplies none of
that authority. The two contexts are checked for exact organisationId and
connectionId equality before adaptation or persistence. These are the only shared
coordinates exposed by RuntimePersistenceContext; no new source-coordinate API
was invented. Adapter and M14.2 checks retain their respective responsibilities.

Flow: context consistency -> `adaptOtelSpan` -> existing allowlist/sanitization and
`validateRuntimeObservation` -> accepted closed observation -> unchanged
`persistRuntimeObservation` -> existing validation/admission/typed durable readback.
REJECTED adapter results cause zero persistence calls. The raw span is passed only
to the adapter, with no boundary traversal, logging, hashing, serialization, raw
diagnostics or archive. Exactly one span is handled per call. Existing extraction
bounds and sanitized admission limits remain; future transport byte/batch limits
are not claimed. No alternate application composition path was added.

`observationId` remains trusted caller assigned. `receivedAt` remains trusted
server arrival time supplied through adapter context, never derived from source
timestamps. No second ID or competing clock is generated. M14.2 owns recordedAt.
Success returns M14.2's original result without reconstruction. Replay preserves
the original durable observation ID, binding, provenance, receivedAt and recordedAt
with `replay: true`. No deduplication, retries, counters or replay reclassification
are implemented in the boundary.

### Closed error model

`RuntimeIngestionError` exposes only a closed code and the same value-free message:

| Code | Boundary meaning |
| --- | --- |
| `RUNTIME_INGESTION_CONTEXT_MISMATCH` | Trusted organisation/connection disagree |
| `RUNTIME_INGESTION_ADAPTER_REJECTED` | Adapter returned REJECTED |
| `RUNTIME_INGESTION_ADMISSION_REJECTED` | Persistence validation/admission or unclassified persistence failure |
| `RUNTIME_INGESTION_READBACK_INVALID` | Existing M14.2 exact safe readback failure |

No raw adapter values or Supabase/Postgres message/details/cause are propagated.
The existing safe `RUNTIME_READBACK_INVALID` sentinel is classified; other
persistence failures are deliberately collapsed. Readback failure does not imply
that no write was admitted. Existing replay/conflict enforcement is unchanged.

### Validation

Focused command from `apps/dashboard`:

```powershell
$env:M14_LOCAL_DB_TEST='0'
$env:M14_HOSTED_DB_TEST='0'
node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/runtime-ingestion.test.ts tests/otel-span-adapter.test.ts tests/otel-persistence-contract.test.ts
```

Affected dashboard regression from the same directory:

```powershell
$env:M14_LOCAL_DB_TEST='0'
$env:M14_HOSTED_DB_TEST='0'
node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/*migration.test.ts tests/runtime-database.test.ts tests/runtime-persistence.test.ts tests/execution-context-service.test.ts tests/execution-context-route.test.ts tests/otel-span-adapter.test.ts tests/otel-persistence-contract.test.ts tests/runtime-ingestion.test.ts
```

| Check | Result |
| --- | --- |
| Focused command | 45 passed, 0 failed, 0 skipped |
| M14.3B unit subset | 10 passed |
| Unchanged M14.3A adapter subset | 32 passed |
| Ingestion -> real persistence/typed readback with mock RPC subset | 3 passed |
| `npm test --workspace @council/canonical-contracts` | 220 passed |
| `npm test --workspace @council/governance-review` | 318 passed |
| Affected dashboard regression | 246 passed, 0 failed, 4 DB tests intentionally skipped |
| `npm run typecheck --workspace @council/canonical-contracts` | PASS |
| `npm run typecheck --workspace @council/governance-review` | PASS |
| `npm run typecheck:dashboard -- --incremental false` | PASS |
| `npm run typecheck:scanner` | PASS |
| `npm run typecheck:graphos-pkg` | PASS |
| `git diff --check` | PASS |

The focused runner initially encountered sandbox `spawn EPERM`; the approved
rerun passed. Experimental module-mock/deprecation warnings are existing tooling
notices. There were no functional test or typecheck failures.

Coverage proves accepted EXECUTION/MODEL_CALL, all five kinds through real M14.2
validation/readback with mock RPC, adapter rejection without persistence, tenant
and connection mismatch before adapter/persistence, safe admission/readback errors,
new observation replay=false and unchanged durable replay=true. It checks full-range
start/end/source-observed nanoseconds and duration, EXACT/UNRESOLVED binding, assigned
identity and distinct receipt/recorded times. Hostile excluded cyclic content,
toJSON accessors, credential-shaped fixtures and authority spoofing remain absent
from persistence arguments/results; logs remain unused. Error assertions verify
closed messages/keys and no original cause. No hostile content is snapshotted.

Unit persistence results and RPC responses are mocks. This is composition evidence,
**not new database acceptance**. M14.2 authoritative DB acceptance is unchanged;
its schema and implementation were not modified or revalidated against hosted DB.

### Final scope and delivery

Dependencies: NONE changed; OTel SDK not installed. Real producer coverage: **NONE**.
M14.4 producer instrumentation and full M14 acceptance remain outstanding.
DATABASE WRITES: NO. REMOTE SUPABASE WRITES: NO. MIGRATIONS CHANGED: NO.
Neither gov-ia-dev nor ov-ia-g2-test was queried or written.
M14.2 CHANGED: NO. M14.3A SEMANTICS CHANGED: NO.
ADR CHANGED: NO. ROADMAP CHANGED: NO. PRODUCER MODIFIED: NO.
OPENAI/TALK MODIFIED: NO. HTTP ROUTE CREATED: NO. OTLP ROUTE CREATED: NO.
PASSPORT MODIFIED: NO. M15 STARTED: NO. CANONICAL WRITE PATH CREATED: NO.

Delivery is a commit, push and NEW PR against main from the M14.3B branch.
**DO NOT MERGE.** No implementation or architecture stop condition was found.
Verdict: **M14_3B_READY_FOR_REVIEW**.
