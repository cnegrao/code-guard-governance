# E1 dashboard authentication correction — localhost:3101

Date: 2026-11-07, America/Sao_Paulo.

Status (updated 2026-11-08): **REAL_BROWSER_LOGIN_QUEUE_AND_BOTH_DETAILS_VERIFIED**.

Final acceptance: the operator confirmed both corrected detail pages; actual
page/detail APIs returned HTTP 200 with evidence/assertion telemetry 1/1 and 3/3.
The final read-only DB check confirmed both subjects remain PROPOSED. See
[the complete E1 access acceptance](2026-11-08-e1-governance-review-access-verified.md).
Pending observations below describe earlier checkpoints and are superseded by
that final evidence.

## Observed problem and bounded correction

The original E1 server log contains repeated `POST /api/auth/login 200` followed
by `GET /dashboard 404`. `LoginForm.tsx` navigated to `/dashboard`, although the
actual dashboard route is `/` and E1 reviews are `/governance/reviews`.
These 404 responses also establish that middleware allowed those authenticated
navigations; they do not establish that every browser attempt lost its cookie.
No cookie/JWT/password value was read from the browser or printed.

The original local origin was `http://127.0.0.1:3101`. The cookie is intentionally
host-only: `HttpOnly; Path=/; Max-Age=28800; SameSite=Lax`, with `Secure` retained
for production. It is not shared with `localhost`. Next dev's internal request
URL normalisation to localhost was already observed during invitation work.
The initial launcher also generated a new signing secret on every restart.
There was no evidence justifying weaker JWT verification or a wider cookie Domain.

Changes:

- LoginForm explicitly sends same-origin credentials and performs a full
  same-origin navigation to the existing `/governance/reviews` after login.
- Development E1 navigation from 127.0.0.1 is redirected to
  `http://localhost:3101` before rendering the login form. Non-GET/HEAD requests
  to the old alias are refused with 409, avoiding a credential POST silently
  crossing hosts. This is restricted to the configured local development origin.
- Middleware continues to require the same cookie and strict shared JWT verifier.
  Missing cookies and invalid signatures still redirect to `/login`.
- Explicitly enabled local diagnostics report only safe stages and review counts:
  cookie issued/missing, middleware JWT verified/invalid, Node JWT verified and
  review-detail counts. They accept no cookie/JWT/password/signing-key values,
  are restricted to development E1 localhost configuration, and change no auth decision.
- The new isolated launcher reuses a strong signing key from a private runtime
  file restricted to the current OS user and SYSTEM. Both signing and validation
  receive the same process configuration and shared verifier implementation.
  No key is printed, passed in command arguments, or made NEXT_PUBLIC.
- Current operator/invitation documentation and future invitation receipts use
  localhost. Prior reports retain their historical 127.0.0.1 observations.

Only the verified prior E1 process (PID 3884 and its Next children) was stopped.
The corrected E1 process was started as PID 35848, with logical origin
`http://localhost:3101`, IPv4 loopback bind, and test backend
`zkqfvqwqdypgpzauzinw`. It is deliberately not bound to an external interface.
Private runtime values are not included in this report.

## Completed validation

Focused checks all PASS:

- `e1-auth-flow.test.ts`: isolated real cryptographic JWT fixtures verify
  Set-Cookie attributes, absence of Domain/local Secure, no token in JSON,
  follow-up cookie parsing by actual NextRequest/middleware, the same token's
  Node verification, alias redirect/refusal, missing-cookie rejection,
  signing-key mismatch rejection, and secret-free diagnostic output.
- Existing `routes-login`, `verified-governance-principal`,
  `session-consumer-security` and `session-authority-boundary` tests.
- Final dashboard typecheck and administrative CLI syntax.
- `git diff --check`.

Those cryptographic fixtures run only in local test processes. They were not
used as a substitute session for the hosted operator.

Real HTTP checks with no fabricated cookie:

| Request | Result |
| --- | --- |
| GET http://127.0.0.1:3101/login | 307 to http://localhost:3101/login |
| GET http://localhost:3101/login | 200 |
| GET http://localhost:3101/governance/reviews without session | 307 to localhost login |
| GET http://localhost:3101/api/auth/me without session | 401 |

The live test DB confirmed invitation `5cc91a9b-ca21-41ef-b173-de43e3f20f4a`
was redeemed by the operator at `2026-11-08T00:54:52.326514Z`. The real user
`e2bfd522-481e-461d-881b-465aa24a4953`, email `negrao@ia4all.eu`, is active,
has a DB credential epoch, belongs to GOVIA_DEMO
`082ef694-e016-4893-908c-1eef373f53af`, and holds the persisted system
`GOVERNANCE_ADMIN` role. No account was recreated or password reset.

## Real-browser evidence — follow-up 2026-11-08

The operator explicitly confirmed that the queue opened after ordinary login
at localhost:3101. The real server log establishes the full authentication path:
`cookie-issued`, `POST /api/auth/login 200`, `middleware-jwt-verified` on
`/governance/reviews`, `GET /governance/reviews 200`, `node-jwt-verified`,
`GET /api/auth/me 200`, `GET /api/governance/workspace/summary 200` and
`GET /api/governance/workspace/reviews?page=1 200`. The browser sent the cookie
on subsequent requests and both middleware and Node verified the session. These
are actual operator requests, not the isolated signed test fixtures.

The redacted machine-readable receipt is
`.artifacts/agent/e1-real-browser-acceptance.json`, with
`authenticationVerified=true`. No cookie, JWT, password, or signing-key value
was collected in that receipt. The same running process uses the stable private
configuration introduced by this correction.

Individual-detail rendering remains pending: there were no detail API requests
or corresponding evidence/assertion receipts at this inspection. The operator
has received both detail links and was asked to confirm their contents. The UI
tool now reports both the native pipe and browser host unavailable, so independent
visual inspection is not available in this session. Queue access does not by
itself prove that both individual details render.

### Detail-link correction — 2026-11-08

The operator subsequently reported that both details showed data, but actual
server evidence did not support closing that gate: shared links containing
`review-subject%3Adiscovery%3A...` reached a client route whose parameter retained
those escapes. The component encoded the parameter again, producing
`review-subject%253Adiscovery%253A...` at the API and HTTP 404. The successful
page-shell response was not evidence of a successful detail API response.

The component now unwraps exactly one URI transport layer from its route parameter
before its existing API encoding. Authentication, tenant scoping, review actions
and persistence are unchanged. Malformed escaping remains opaque and cannot crash
the component. The regression tests exercise both exact E1 IDs through raw and
shared encoded links, and bounded/malformed decoding. Both tests and the final
dashboard typecheck passed. No historical migration or hosted data was changed.

The corrected raw-colon links were delivered to the operator for a fresh check.
Prior detail confirmation is not treated as proof of the corrected requests;
detail API 200 and 1/1, 3/3 receipts remain required. The updated native Computer
Use runtime was also tried and reported the same missing native pipe; no UI input
or authentication automation was performed.

After login, the exact operator paths are:

- http://localhost:3101/governance/reviews
- http://localhost:3101/governance/reviews/review-subject%3Adiscovery%3A6d82d4eeab00b7cfaed4d8c2b5ddb57b455f2819137a98bbf2e803ab2fdd919b
- http://localhost:3101/governance/reviews/review-subject%3Adiscovery%3A94ab3bbabbd6398d3bd25c83ebf875a551854842bcf09437a59cd9ee7718af4f

Read-only DB evidence still shows AGENT and AGENT_VERSION in PROPOSED with
evidence/assertion counts 1/1 and 3/3. Their source run remains
`acquisition-run:c839196c-77a6-48c5-9063-d2025bada1b7`.

## Scope and handoff

Branch `fix/e1-operator-unblock`, HEAD/base
`a5f85bf099fdbf0a24f1a369e4428730a042a162`, isolated worktree. The preexisting
invitation implementation and applied migration are preserved. No historical
migration, hosted row, role, account or password was changed by this correction.
The original dirty worktree, acme account and gov-ia-dev were not changed. No
approval, certification, reconciliation, materialization, Discovery run, commit,
push, merge or deployment occurred. No architecture audit or full regression was
reopened. Runtime metadata and redacted logs are under `.artifacts/agent/`.
