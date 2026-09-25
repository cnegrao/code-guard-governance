# M16 credential security — disposable PostgreSQL 17

From `apps/dashboard` with Node 24+ and workspace dependencies installed:

```sh
node --conditions=react-server --import tsx --test tests/postgres-m16/*.test.ts
```

Set `M16_PG17_BIN` to a directory containing PostgreSQL 17 `initdb`, `pg_ctl`,
`psql` and their extension dependencies. Windows defaults to
`C:/Program Files/PostgreSQL/17/bin`; other platforms use PATH. The server must
report `170000 <= server_version_num < 180000`. Missing/wrong binaries fail the
profile; an environment limitation is not canonical acceptance. Run as a
non-root OS user. The M15 helper, command and migration semantics are unchanged.

The helper creates its own temporary cluster, strips inherited libpq settings,
binds to `127.0.0.1` on a newly allocated port, and verifies `data_directory`
before executing fixtures. It accepts no existing/hosted database connection.
Success and ordinary failure stop the server and remove only the verified
temporary directory. A forcibly terminated runner can require manual cleanup.

Role topology:

| Role | Superuser | BYPASSRLS | Purpose |
|---|---|---|---|
| m16_bootstrap | yes | yes | initdb/bootstrap and explicit superuser tests |
| postgres | no | yes | object owner and all canonical migrations |
| service_role | no | yes | actual separate application DML/RPC sessions |
| anon / authenticated | no | no | unprivileged ACL checks |

An inert `auth.email()` returning NULL permits canonical RLS creation. It is
never used as application authentication. No application table or production
trigger/function is replaced by a stub.

Canonical chain, executed in this order as `postgres`:

1. `20260818003539_gov_repo_types_and_organisations.sql`
2. `20260818003710_gov_repo_identity_and_ledger.sql`
3. `20260818013113_grant_service_role_gov_repo_access.sql`
4. `20260903200000_canonical_email_identity.sql`
5. `20260903200100_atomic_signup_legacy_rpc.sql`
6. `20260925150000_m16_s0_credential_epoch_v1.sql`

The last migration is first attempted with a future legacy epoch to verify
atomic rollback, then executed successfully while waiting on a real concurrent
writer. The writer authors a valid epoch after the migration starts waiting;
this detects a cutover timestamp captured before lock acquisition. Tests cover
all 22 requested credential behaviors, explicit NULL insert, exact microsecond
preservation, and role topology. Diagnostics print version, migration chain,
actual routine ACLs and cleanup status.

The monotonicity fixture temporarily disables the trigger using bootstrap DDL
to seed an OLD epoch ahead of the actual DB clock, then immediately restores
`ENABLE ALWAYS` in that same fixture transaction. Two updates use the unchanged
production trigger and must advance by one microsecond each. This fixture
simulates a backward/equal effective clock without altering the OS clock.

The updatable invoker view and dynamic-DML fixtures prove only that their DML
reaches the base-table trigger. They do not certify GraphOS deployment security.
`external_id` changes (including IdP changes) always advance the credential
epoch. Its bcrypt/IdP overloading and injection concern remain
`PRODUCTION_SECURITY_GATE_RESIDUAL`; no new identifier architecture is accepted.
Owner DDL disabling/dropping the trigger remains Production Security Gate scope.

O07/O52 remain **PARTIAL**: this slice implements cutover/base-table integrity
and eligible session issuance. Transactional command eligibility, locking and
human RPC wrappers are later slices. No hosted DB or real OpenAI is needed.
