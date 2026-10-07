# Governed Discovery worker

Run one scan per process in a dedicated workload/secret scope, separate from the
dashboard. The runtime uses a PostgreSQL LOGIN credential generation belonging to
one governed machine principal. It does not use Supabase service credentials,
PostgREST, HUMAN sessions, or the provisioning identity.

Trusted provisioning must first create the principal, register its dedicated
LOGIN generation as CURRENT, and provision an enabled execution binding. Use the
control-plane functions from `20261002190148_discovery_machine_s2_control_plane_v1.sql`
outside the worker. The LOGIN has only `govia_discovery_machine_caller` membership;
the worker never receives a provisioner/owner credential. Configure password
authentication as SCRAM, require TLS, and give the worker the trusted server CA.

The GitHub binding must match the configured owner/repository spelling, exact
authorized ref, immutable repository ID, and adapter `github-source-adapter`
version `1.0.0`, with intake and proposal capabilities enabled. Redirects and
provider identity mismatches fail closed. Observed provider metadata is a
consistency check, not independent attestation of hostile worker content.

Supply only these workload variables, plus the ordinary process environment
needed to start Node:

| Variable | Value |
| --- | --- |
| `DISCOVERY_DB_HOST`, `DISCOVERY_DB_PORT`, `DISCOVERY_DB_NAME` | Direct PostgreSQL endpoint; certificate must match the host |
| `DISCOVERY_DB_USER`, `DISCOVERY_DB_PASSWORD` | Dedicated registered LOGIN generation |
| `DISCOVERY_DB_CA_FILE` | Readable PEM CA file; certificate verification is mandatory |
| `DISCOVERY_BINDING_ID` | Governed execution binding UUID |
| `DISCOVERY_OWNER`, `DISCOVERY_REPO`, `DISCOVERY_REF` | GitHub source matching the binding |
| `DISCOVERY_SOURCE_TOKEN` | Optional repository read credential |
| `DISCOVERY_AUDIT_FILE` | Writable append-only-by-operation journal path on durable, access-controlled storage |

Start with `npm start --workspace=apps/discovery-worker` from the repository root.
The CLI rejects known inherited service/HUMAN/provisioning/database override
variables. This guard complements deployment isolation; it does not establish
that isolation. Do not launch it by copying the dashboard's environment.

The executor uses a bounded pool (default 2, maximum 4), fixed parameterized SQL,
verified TLS, and an fsync'd operational journal. Each database command is its own
transaction. Authority errors abort dependent work. Earlier committed intake may
remain after a later failure; replay uses deterministic identities and current
eligibility. Journal `FAILED_OR_COMMIT_UNKNOWN` entries require comparison with
the database audit before deciding whether an operation committed.

Only the fixed `DETECTED -> PROPOSED` rule is available. The database derives the
tenant, verifies current principal/generation/binding and current-run support,
and atomically records invocation provenance. A rescan can replay an old proposal
after HUMAN advancement without changing the advanced state. Run proposal counts
must equal committed machine proposal events for that exact run.

Local validation (no hosted database or real GitHub requests):

```powershell
$env:M16_PG17_BIN='D:\code-guard-governance\out\m16-tools\pgsql\bin'
npm test --workspace=apps/discovery-worker
npm run typecheck --workspace=apps/discovery-worker
```

The integration fixture uses PostgreSQL 17, the real `pg` client and GitHub
adapter, SCRAM, verified TLS, and deterministic simulated HTTP responses. It needs
OpenSSL (`M16_OPENSSL` can override the executable path). Its migration harness
uses the existing pgvector stand-in; it does not test vector behavior.
