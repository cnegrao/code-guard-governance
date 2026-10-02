# GOV IA local demo bootstrap evidence

Date: 2026-10-01. LOCAL PRODUCT ACCEPTANCE PREPARATION only.

## A. Local environment baseline

- Branch: `feat/m16-s1b-governed-registries`.
- HEAD: `7170131a73293e8b3b89ec4f8765ac7c9ca65b66`.
- Initial status: 40 modified tracked files and 9 untracked P0 files. Initial diff: 384 insertions, 559 deletions. All 49 files were hashed before validation and remain byte-for-byte unchanged. No reset, checkout, revert, commit, push, merge, PR or deployment.
- `apps/dashboard/tsconfig.tsbuildinfo` was already modified. It remains unchanged by this bootstrap and must be excluded from any future commit.
- Node `v24.19.0`; npm `11.17.0`; installed Next.js `15.5.19`.
- Dashboard: `apps/dashboard`, workspace name `codeguard-os`.
- Normal scripts: `npm run dev --workspace=apps/dashboard`; `npm run build --workspace=apps/dashboard`; `npm run start --workspace=apps/dashboard` (requires build).
- Supabase CLI: `2.107.0`, via root `node_modules/.bin/supabase.cmd`; not found as a global command.
- Docker command absent from PATH; standard Docker Desktop binary/data paths absent; no Docker/Podman service, process or named pipe found. WSL executable exists, but this is not evidence of a container runtime.
- Dashboard HTTP smoke server started at `http://127.0.0.1:3000`, bound to loopback. Login page is available at `/login`; this is a frontend-only diagnostic process, not a usable authenticated demo.
- Configured, **not running**, Supabase endpoints: API `http://127.0.0.1:54321`, PostgreSQL `127.0.0.1:54322`, Studio `http://127.0.0.1:54323`, mail UI `http://127.0.0.1:54324`. Shadow DB 54320; analytics 54327; pooler disabled.

## B. Supabase local status

**BLOCKED.** `supabase start` failed before database startup:

```text
failed to inspect service: error during connect:
Get "http://%2F%2F.%2Fpipe%2Fdocker_engine/v1.51/containers/supabase_db_code-guard-governance/json":
open //./pipe/docker_engine: The system cannot find the file specified.
Docker Desktop is a prerequisite for local development.
```

The command was repeated outside the sandbox only for the earlier CLI telemetry permission problem; the above is the actual runtime dependency failure. No local migrations or DB fixtures were executed. **No hosted DB/Auth was touched or queried.**

Repository inspection found 71 primary migrations, from `20260818003539_gov_repo_types_and_organisations.sql` through `20260930180000_m16_s1b2r3_s0_execution_context_closure_v1.sql`. Normal fresh `supabase start` uses this chain; existing local stacks can apply pending files with `supabase migration up --local`, after local target verification. Do not use `--linked`, legacy migration roots, or `db reset` on an existing populated local stack merely to resume this task.

Expected database: PostgreSQL 17; application schema `gov_repo`; Data API exposed schemas `public`, `graphql_public`, `gov_repo`; `max_rows=1000`. Migration dependencies include `uuid-ossp`, `pgcrypto`, `pg_trgm`, and native `vector`, including HNSW support. None was verified on an actual local Supabase instance in this run. Prior disposable PG tests used a vector stand-in and cannot prove this stack starts correctly.

`db.seed` references `supabase/seed.sql`, which does not exist. The dashboard `seed` script references `seed.ts`, also absent. Neither is a usable existing demo bootstrap. No replacement seed mechanism was introduced before the runtime prerequisite was met.

Official reference: [Supabase local development](https://supabase.com/docs/guides/local-development) requires a Docker-compatible container runtime. The current changelog and CLI help were consulted; no dependency or CLI upgrade was performed.

## C. Auth status and local configuration

The dashboard uses **application-owned email/password auth**, not Supabase Auth sessions: `services/auth.ts` reads `gov_repo.governance_users`, compares bcrypt credentials, checks active user/organisation and persisted role membership, and signs its own HS256 session. Middleware and API ingress verify issuer, audience, expiry, identity and exact DB credential epoch in the `codeguard-token` HttpOnly cookie. Governed writes separately recheck current eligibility through existing boundaries.

Minimum legitimate Layer A bootstrap is the existing `POST /api/auth/signup` -> `signup_legacy` RPC, followed by a fresh `POST /api/auth/login`. Signup atomically creates the organisation and governance user with the existing system `GOVERNANCE_ADMIN` role assignment; the database authors organisation identifiers and the credential epoch. Inputs: email, password (8+ chars), fullName, orgName, industry (`other` is valid). No direct auth-table INSERT and no Supabase Auth admin user creation is needed.

Organisation identity comes from persisted membership at issuance, then the verified session at request ingress. Request-supplied tenant values must not replace it. Real authenticated tenant-negative comparisons remain pending; passing mocked boundary tests does not satisfy that gate.

Required environment: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a fresh non-placeholder `JWT_SECRET` of at least 32 bytes. `NEXT_PUBLIC_APP_URL` should be local; `LLM_PROVIDER=none` avoids an external LLM dependency. Service credentials stay server-side.

The existing ignored `apps/dashboard/.env.local` points to hosted Supabase. It was inspected with secret values redacted and **left unchanged**. The diagnostic Next process explicitly overrides the URL to `http://127.0.0.1:54321`, both keys to inert noncredentials, and JWT_SECRET to a newly generated ephemeral value. These inert keys only permit frontend boot; they cannot authenticate to a database and are not demo credentials. Next's log still lists `.env.local`, but explicit process variables take precedence for these settings.

Local user creation: **not executed**. Login and DB-backed verified-principal result: **BLOCKED**. No signed test cookie was forged to enter the product.

Observed HTTP: `/login` and `/signup` 200; protected pages and `/api/dashboard` 307 to `/login`; `/api/auth/me` 401. Invalid cookie plus hostile tenant query/header also 307. This proves unauthenticated rejection only.

Browser attempt: in-app browser unavailable; browser inventory returned `apps: [], browsers: []`. HTTP output is not browser visual acceptance.

## D. Minimum demo data strategy

| Layer | Current status | Smallest next fixture |
| --- | --- | --- |
| A — Auth/tenant | NOT_AVAILABLE | One signup through the real local application. Add a second tenant only for tenant-negative acceptance. |
| B — Operational Discovery | PARTIAL | Existing synthetic `packages/scanner/test/discovery-validation-lab/golden-repositories/01-simple-agent` supplies one agent, model, tool, prompt and customer table. Source exists; no operational rows were persisted. |
| C — Governed canonical state | NOT_AVAILABLE | Keep Passport/Graph honestly empty until legitimate review inputs and governed decisions exist. No canonical INSERTs or grants. |

Layer B: existing browser Discovery providers fetch hosted source repositories and have no filesystem provider. A small local-only operator fixture could run the existing scanner over the existing synthetic repository and persist only its operational `agents` inventory representation, bound to Layer A's tenant and clearly labelled synthetic/source intelligence. It must not write `canonical_objects`, relationships, decisions or promotion state. This is a proposed bounded follow-up, not an implemented adapter or verified dataset. Optional `coding_memory` is absent from the canonical chain and remains excluded.

Layer C: review, decision and materialization endpoints exist under `/api/governance/workspace/reviews/[id]`, `/decision`, and `/materialize`, with governed write principals/wrappers. They require legitimate pre-canonical evidence, candidates and review subjects. The current Discovery scan is operational and does not create that governed review intake. The old intake adapter's raw RPC calls must not be treated as usable authority simply because code exists; current ACL hardening and the S1B.3 hold remain controlling.

Smallest architecture-safe design if a populated canonical demo is later needed: a local-only, deterministic fixture command with a verified local target, source hashes and explicit synthetic provenance, limited to pre-canonical inputs under a separately checked existing permitted ingestion boundary; then a real authenticated human review/decision/materialization journey using the existing governed endpoints. Do not seed approved decisions or canonical outputs, restore revoked RPCs, or build a machine authority. If no currently permitted intake boundary can support the precursor records, keep Layer C empty and report that missing fixture/intake path. This design is not implemented or claimed ready.

## E. Product route matrix

Statuses describe actual authenticated local product acceptance, not source-code assertions.

| Surface | Route | Status | Evidence / pending |
| --- | --- | --- | --- |
| Dashboard | `/` | BLOCKED | 307 unauthenticated; NO_DATA/NOT_ASSESSED covered in focused tests, not DB-backed UI. |
| Canonical Passport | `/agents/canonical` | BLOCKED | 307; no authenticated list/detail or empty-state acceptance. |
| Governed Graph | `/graph` | BLOCKED | 307; source uses canonical reader/projection, no legacy fallback; focused tests pass. |
| Discovery | `/discovery` | BLOCKED | 307; operational semantics and disabled promotion pass focused tests; no persisted fixture. |
| Search | `/search` | BLOCKED | 307; rendered success-empty versus HTTP/network ERROR regressions pass. |
| Audit | `/audit` | BLOCKED | 307; no live local persistence/read acceptance. |
| Reports | `/reports` | BLOCKED | 307; NOT_ASSESSED and disabled export regressions pass; no authenticated HTTP acceptance. |
| Navigation | Sidebar controlled journey | BLOCKED | Destination/source UI checks pass; authenticated browser walkthrough unavailable. |

No route is labelled EMPTY_BUT_HONEST based solely on absent infrastructure.

## F. New changes and validation

No application source, migration, package, lockfile or persisted environment changes beyond the existing P0. Added this evidence document. Ignored diagnostic artifacts are under `out/local-demo/`: baseline hashes, preservation result, HTTP script/result and logs. No `LOCAL_ENVIRONMENT_BOOTSTRAP_CORRECTIVE` was necessary or applied; missing Docker is a host prerequisite.

Exact execution entry points (root unless noted):

```powershell
git status --short
git diff --stat
git branch --show-current
git rev-parse HEAD
node --version
npm --version
docker version --format '{{.Client.Version}} {{.Server.Version}}'
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'
& .\node_modules\.bin\supabase.cmd --version
& .\node_modules\.bin\supabase.cmd --help
& .\node_modules\.bin\supabase.cmd start --help
& .\node_modules\.bin\supabase.cmd migration up --help
& .\node_modules\.bin\supabase.cmd status --help
& .\node_modules\.bin\supabase.cmd start 2>&1 | Tee-Object -FilePath out/local-demo/supabase-start.log
```

Dashboard startup command, from `apps/dashboard` (diagnostic only):

```powershell
$env:SUPABASE_URL='http://127.0.0.1:54321'
$env:SUPABASE_ANON_KEY='local-unavailable-anon-key'
$env:SUPABASE_SERVICE_ROLE_KEY='local-unavailable-service-key'
$env:JWT_SECRET=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
$env:NEXT_PUBLIC_APP_URL='http://127.0.0.1:3000'
$env:LLM_PROVIDER='none'
$env:OPENAI_API_KEY=''
$env:DEEPSEEK_API_KEY=''
npm run dev -- --hostname 127.0.0.1 --port 3000 2>&1 | Tee-Object -FilePath ../../out/local-demo/next-dev.log
```

| Validation | Exact command | Result / output |
| --- | --- | --- |
| Focused auth/tenant/P0, from dashboard | `node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/verified-governance-principal.test.ts tests/session-authority-boundary.test.ts tests/legacy-read-tenant-binding.test.ts tests/pre-demo-reads.test.ts tests/pre-demo-discovery.test.ts tests/intelligence-query.test.ts` | 137 pass, 0 fail/skip; `out/local-demo/focused-tests.log`. Mock/unit evidence only. |
| P0 UI, from dashboard | `npm run test:pre-demo-ui` | 8 pass, 0 fail/skip; `out/local-demo/ui-tests.log`. |
| Real unauthenticated HTTP | `node out/local-demo/http-smoke.mjs` | PASS, 12 checks; `out/local-demo/http-smoke.log`, `http-results.json`. |
| Preservation | SHA256 comparison of the initial 49 files | Unchanged; `baseline-hashes.json`, `preservation.json`. |
| Whitespace | `git diff --check` | Exit 0. Existing CRLF normalization warnings only. |

Initial sandbox runs of CLI (telemetry write), Next and tests (spawn EPERM) failed; the same necessary commands succeeded with escalation, except `supabase start`, which exposed the missing Docker daemon. Next emitted the pre-existing multiple-lockfile warning. No new typecheck/build was needed because application source was not changed. No historical full suite was rerun.

## G–J. Blockers, next action and verdict

Primary blocker: missing available Docker-compatible runtime/daemon (`docker_engine` named pipe absent). Browser visual acceptance also needs an available browser automation surface. Auth and DB-backed route checks depend on the local stack and genuine local keys; they cannot be substituted by mocks or hosted credentials.

Smallest next action: install/start Docker Desktop (or an approved Docker-compatible local runtime), then resume `supabase start`. Before any fixture mutation verify the local Docker context/container, mapped loopback ports, project identity and CLI local status. Apply/verify all 71 migrations and native extensions, inject actual local keys into a dedicated local process, use the existing signup/login flow, and complete authenticated tenant-negative/product/browser acceptance. Do not run ordinary `npm run dev` with the existing hosted `.env.local` for this local-only task.

S1B.3: **NOT STARTED**.

**LOCAL GOV IA DEMO ENVIRONMENT: BLOCKED**
