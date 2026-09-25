# M16 credential + eligibility security — disposable PostgreSQL 17

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
7. `20260925160000_m16_s0_transactional_eligibility_v1.sql` (S0.3.2; applied by `transactional-eligibility.test.ts` after step 6)

The credential migration (step 6) is first attempted with a future legacy epoch to verify
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

## S0.3.2 — transactional eligibility helper

`transactional-eligibility.test.ts` proves `gov_repo.lock_and_resolve_governance_session_eligibility_v1`
on the same real PG17 cluster topology. Concurrency tests use the harness `session(role)`
(long-lived interactive psql, serial statements, stdout/stderr sentinels) so distinct
backends hold and contend for real row locks. Blocking is observed through
`pg_stat_activity.wait_event_type='Lock'` and `pg_blocking_pids()` from a separate
bootstrap monitor session, never by sleeping alone. Lock order is proven with
`FOR UPDATE NOWAIT` probes while the helper is blocked on a role row.

Helper posture: PL/pgSQL, VOLATILE, SECURITY DEFINER, `search_path=pg_catalog`,
function-local `lock_timeout=5s`, READ COMMITTED only, owner-only EXECUTE (all of
PUBLIC/anon/authenticated/service_role revoked). Lock hierarchy
ORGANISATION -> GOVERNANCE_USER -> GOVERNANCE_ROLE (ascending role_id), all `FOR SHARE`.
Failure SQLSTATEs: GV001 session temporal, GV002 credential stale, GV003 actor/org
ineligible, GV004 role set invalid, GV005 unsupported isolation; lock timeout stays 55P03.

Fixture note: real users get a 12h-old credential epoch via a bootstrap-only,
single-transaction disable/enable-ALWAYS of the S0.3.1 trigger (same technique as the
S0.3.1 monotonicity fixture). Exact-second boundary cases derive `t.s` from the DB clock
in the same statement and first wait past a near-rollover second.

The eligibility helper is not wired to any route or write wrapper (S0.3.3). GraphOS is
unchanged and not certified here (`PRODUCTION_SECURITY_GATE_RESIDUAL`). O07/O52 remain
**PARTIAL**; O08/O09/O10 have tested infrastructure but no production integration; O11
is not complete. No hosted DB or real OpenAI is needed.
