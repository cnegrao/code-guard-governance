# E1 — real operator invitation for GOVIA_DEMO

Date: 2026-11-07, America/Sao_Paulo.

Status (updated 2026-11-08): **OPERATOR_ACTIVE; REAL_LOGIN_QUEUE_AND_BOTH_DETAILS_VERIFIED**.

Final acceptance: both corrected detail pages and their authenticated APIs are
verified, including evidence/assertion counts 1/1 and 3/3. Both subjects remain
PROPOSED. See [final E1 access evidence](2026-11-08-e1-governance-review-access-verified.md).

Follow-up: the operator redeemed the invitation personally. The live database
confirmed user `e2bfd522-481e-461d-881b-465aa24a4953` active in GOVIA_DEMO with
the system GOVERNANCE_ADMIN role and a DB credential epoch. The subsequent
localhost login and queue access are confirmed by the operator and actual server
requests; see `2026-11-07-e1-localhost-auth-correction.md`. Issuance-time pending
observations below are historical and are superseded by this follow-up. Neither
activation nor login performed any review decision.

## Authorisation and preserved identity

Carlos explicitly designated the real operator `negrao@ia4all.eu`, requested
`GOVERNANCE_ADMIN` in the existing `GOVIA_DEMO` organisation and required the
operator to define their own password. The prior choice to preserve
`cnegrao2@gmail.com` in acme remains in effect. No organisation was created and
that existing account was not transferred or changed.

Live read preflight confirmed test project `zkqfvqwqdypgpzauzinw`, active
`GOVIA_DEMO` UUID `082ef694-e016-4893-908c-1eef373f53af`, no governance/Auth user
for the new email, zero users in GOVIA_DEMO, and the old account still in acme
UUID `c6c36e7b-0407-43ab-b3c9-bc1eb3b550df`. The actual administrative DB role
was `postgres`. No test identity or password was substituted for the operator.

## Implementation and test-only application

One additive migration introduces an administrative invitation receipt table,
two ALWAYS guards and four SECURITY INVOKER routines: row guard, administrative
issuance, safe preview and atomic redemption. Administrative identity attributes
are immutable. Issuance is owner-only; public DB roles have no access. The server
can preview/consume a capability but cannot issue invitations. The public API
accepts neither organisation nor role/email selection. A 256-bit random code has
a SHA256 digest at rest, a maximum 24-hour expiry and one terminal redemption or
revocation. Reissue invalidates the previous code for that same organisation.

The operator page accepts the code, displays the prebound account and accepts the
operator's own password. The server uses bcrypt cost 12, including a 72 UTF-8
byte maximum, and the existing credential epoch trigger. Activation returns no
password, hash or session. Login and persisted/current authority checks remain
unchanged. The new public navigation path is exactly `/accept-invitation`.

The CLI's dry-run found 35 other pending historical migrations. None was applied.
Only `20261108002618_governance_operator_invitation_v1.sql` was applied, with its
original version and exact SQL source registered atomically in the standard
Supabase migration ledger. The guarded operation refused any other project,
unexpected account, missing credential guard, or already-applied invitation
migration. Applied source SHA256:
`2aa8821a4e3b01043f907a1b38b8ed2a2d862cc44ce752ef3d85845674173878`.
No historical migration, existing function, role assignment, canonical object or
human review state was changed by the application of this additive migration.

## Issued invitation and operator handoff

- Invitation ID: `5cc91a9b-ca21-41ef-b173-de43e3f20f4a`.
- Real operator: Carlos Negrão, `negrao@ia4all.eu`.
- Target: existing GOVIA_DEMO, role resolved from system `GOVERNANCE_ADMIN`.
- Expiry: `2026-11-08T02:41:57.206408Z` (23:41 on 7 November, São Paulo).
- Activation: http://127.0.0.1:3101/accept-invitation
- Normal login: http://127.0.0.1:3101/login

The code was delivered through a private local file. Actual Windows ACL inspection
confirmed only the current OS user and SYSTEM have access. The code was not
printed, embedded in a URL, emailed or included in this document. No password was
generated. Issuance alone does not create an active governance user: that happens
only when the operator defines their password and consumes the invitation.

The real activation page returned HTTP 200. The real preview endpoint returned
HTTP 200, no-store/no-referrer headers and the exact email, organisation and
GOVERNANCE_ADMIN role. Its response contained no bearer code or password hash.
A live-only origin mismatch was found: Next dev normalises its internal Request
URL from 127.0.0.1 to localhost. The endpoint now checks configured Origin and
the actual incoming Host exactly. The follow-up route test rejects external
Origin and Host values and the live preview succeeds at the operator URL.

Browser inventory still reported `The browser access host is unavailable`.
Native automation was not used to bypass the earlier browser policy stop.
The operator was asked to complete activation/login personally, without sending
the password or invitation code to chat. Actual activation, credential login and
authenticated UI rendering must not be inferred from local fixtures or preview.

## Review subjects retained for E1

Run: `acquisition-run:c839196c-77a6-48c5-9063-d2025bada1b7`.

| Subject | State observed | Evidence | Assertions |
| --- | --- | --- | --- |
| AGENT `review-subject:discovery:6d82d4eeab00b7cfaed4d8c2b5ddb57b455f2819137a98bbf2e803ab2fdd919b` | PROPOSED | 1 | 1 |
| AGENT_VERSION `review-subject:discovery:94ab3bbabbd6398d3bd25c83ebf875a551854842bcf09437a59cd9ee7718af4f` | PROPOSED | 3 | 3 |

Individual operator routes:

- http://127.0.0.1:3101/governance/reviews/review-subject%3Adiscovery%3A6d82d4eeab00b7cfaed4d8c2b5ddb57b455f2819137a98bbf2e803ab2fdd919b
- http://127.0.0.1:3101/governance/reviews/review-subject%3Adiscovery%3A94ab3bbabbd6398d3bd25c83ebf875a551854842bcf09437a59cd9ee7718af4f

No Discovery run, confirmation, certification, rejection, reconciliation or
materialization was performed. These remain human actions through the existing
UI and governed write boundary. The gov-ia-dev endpoint was not accessed.

## Verification and Git

Worktree: `.worktrees/e1-operator-unblock`; branch `fix/e1-operator-unblock`;
HEAD/base `a5f85bf099fdbf0a24f1a369e4428730a042a162`. Original dirty worktree and
all other worktrees preserved. No commit, push, PR, merge or deployment.

Focused route tests: 5 PASS, covering caller identity/authority injection,
Origin/Host, password byte limits, secret-free errors/responses, hashing and no
automatic session. Real disposable PG17.11: parent plus 6 subtests PASS for ACLs,
org pinning, bounded lifetime, existing-email preservation, immutable receipts,
two simultaneous consumers, ordinary bcrypt/credential epoch, one-use, reissue,
current role/organisation validity and expiry. Fixtures existed only in the
verified temporary local cluster, which was stopped and removed.

The first local PG attempt stopped on the helper's frozen historical migration
allowlist before applying the new migration. The successor test now reads only
the explicitly named additive migration verbatim, without altering that helper
or any historical horizon. That corrected PG test passed. Dashboard typecheck
and existing login service/route/verified-principal integration tests passed.
Unchanged SQL/integration evidence is reused; no full regression or architecture
audit was reopened. Detailed logs and receipts are in this worktree's ignored
`.artifacts/agent/` directory.
