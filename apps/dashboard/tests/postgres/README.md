# M15 PostgreSQL behavioural regression

From the repository root:

```sh
npm run test:postgres --workspace codeguard-os
```

Requires Node 24, installed workspace dependencies, and native PostgreSQL server
and client binaries (`initdb`, `pg_ctl`, `psql`, including pgcrypto). Set `PG_BIN`
to their directory, or put them on PATH. Windows defaults to the existing M14
installation at `C:/Program Files/PostgreSQL/16/bin`. Run as a non-root OS user.

This is a separate local integration command, consistent with M14's opt-in DB
policy. It is **not skipped** when PostgreSQL is unavailable: missing binaries,
startup failures, migration failures and SQL errors fail the command. The
`M15 PostgreSQL regression` workflow runs it on every push and pull request,
without an opt-in flag. It is separate from the dashboard's fast unit command.

The helper reuses the repository's M14 native PostgreSQL/psql approach, dependency
selection and fixtures. Docker, Testcontainers and additional npm packages are
unnecessary. Unlike M14's general-purpose connection helper, this helper always
starts a new cluster and offers no existing-database or hosted mode. It ignores
libpq connection overrides, binds only to 127.0.0.1 on a dynamically selected
port, and checks the server's data_directory before executing schema or fixture
SQL. Normal success and failure cleanup stop the owned server and remove its
unique temporary directory. A forcibly killed process may require manual
cleanup of its `govia-m15-postgres-*` directory and server.

The 13 canonical dependency migrations from `runtime-bootstrap.ps1`'s
`AuxiliaryPG16` path run verbatim, followed by the M14 review-fix migration and
`20260923060000_cross_signal_persistence_v1.sql`. Unrelated legacy/UI/vector
migrations are omitted. Only standalone platform roles and the extensions
schema/pgcrypto are bootstrapped; no governance table, constraint, identity
function, trigger, or M15 function is stubbed or rewritten. This is PostgreSQL
behavioural regression coverage, not hosted Supabase acceptance.

Admin fixtures reuse `seedGovernedSupport` with an injected disposable SQL
executor. They seed constrained canonical/M13 evidence and register a source
and verified deployment binding. Runtime admission uses the actual M14 RPC.
Actual domain comparison functions construct the M15 inputs from admitted
runtime evidence. `psql` then invokes the migration-created M15 RPC with
`SET ROLE service_role`; all replay and persistence behaviour is PostgreSQL's.

Seven behavioural subtests cover PRINCIPAL write/replay, DEPENDENCY write/replay
with two members supplied in reverse order, changed outcome/reason conflicts,
and two deliberately ambiguous disposable-only functions. Checks include DB/TS
identity agreement, original evaluation time, exact child content, row counts,
and unchanged source evidence after conflicts. Negative controls require exact
SQLSTATE 42702 for `comparison_id` and `r.organisation_id`; other errors fail.
The server uses `plpgsql.variable_conflict=error`. Test output reports server
version, every applied migration, SQL invocation paths and negative-control
SQLSTATEs; unexpected errors retain PostgreSQL's verbose diagnostics.

No production source, frozen ADR or relationship UPDATE/immutability behaviour
changes. F2 remains deferred: before future relationship closure, supersession,
or UPDATE-based temporal evolution, revisit canonical relationship history and
readback immutability.
