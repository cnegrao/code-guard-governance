# E1 — Governance Review access verified

Date: 2026-11-08, America/Sao_Paulo.

**E1_ACCESS_VERIFIED — READY_FOR_HUMAN_REVIEW.** This closes the access,
authentication and detail-presentation verification. It is not a human review,
certification, canonical reconciliation or materialization decision.

## Environment and real operator

- Test project only: `ov-ia-g2-test`, `zkqfvqwqdypgpzauzinw`.
- Existing organisation: GOVIA_DEMO, `082ef694-e016-4893-908c-1eef373f53af`.
- Operator: Carlos Negrão, `negrao@ia4all.eu`.
- Governance user: `e2bfd522-481e-461d-881b-465aa24a4953`, active, persisted
  system `GOVERNANCE_ADMIN`, with a DB-authored credential epoch.
- The operator personally redeemed the administrative invitation and defined
  their own password. No default password or substitute session was generated.
- Current origin: http://localhost:3101; backend remains the test project.

## Evidence of the actual authenticated browser flow

The operator explicitly confirmed that login opened the queue and, after the
URI-encoding correction, that both detail pages opened with Evidence and Source
Assertions and no not-found error.

The actual server requests independently corroborate the flow:

1. Login HTTP 200 and `cookie-issued`.
2. `middleware-jwt-verified` for queue and each detail navigation.
3. Queue page, account API, summary API and queue API HTTP 200.
4. `node-jwt-verified` for server API ingress.
5. Both individual detail pages and their exact detail APIs HTTP 200.
6. AGENT detail telemetry: evidenceCount=1, assertionCount=1.
7. AGENT_VERSION detail telemetry: evidenceCount=3, assertionCount=3.
8. Both reconciliation-readiness GET endpoints HTTP 200. No decision command was
   executed as part of those reads.

Receipt `.artifacts/agent/e1-real-browser-acceptance.json`, captured
`2026-11-08T22:17:02.027Z`, records `authenticationVerified=true` and
`bothDetailsVerified=true`. It contains no cookie, JWT, password or signing key.
Visual confirmation comes from the operator; direct automated screenshots were
unavailable because both browser/native UI transports were disconnected.

The final read-only test DB check at `2026-11-08T22:18:27.682Z` independently
confirmed that both subjects remain PROPOSED with the same linked counts, the
operator remains active/admin in GOVIA_DEMO, and Carlos's separate acme account
remains in `c6c36e7b-0407-43ab-b3c9-bc1eb3b550df`.

## Exact subjects and navigable operator paths

Source run: `acquisition-run:c839196c-77a6-48c5-9063-d2025bada1b7`.

| Kind | State | Evidence | Assertions |
| --- | --- | --- | --- |
| AGENT | PROPOSED | 1 | 1 |
| AGENT_VERSION | PROPOSED | 3 | 3 |

- Queue: http://localhost:3101/governance/reviews
- AGENT: http://localhost:3101/governance/reviews/review-subject:discovery:6d82d4eeab00b7cfaed4d8c2b5ddb57b455f2819137a98bbf2e803ab2fdd919b
- AGENT_VERSION: http://localhost:3101/governance/reviews/review-subject:discovery:94ab3bbabbd6398d3bd25c83ebf875a551854842bcf09437a59cd9ee7718af4f

## Official human decision and canonical path

The existing subject detail UI remains the operator entry point. For a PROPOSED
subject, the human inspects evidence/assertions and decides whether to confirm
or reject. Certification is a later human transition from CONFIRMED, with its
required reason. No state transition was issued during this verification.

Authentication is the existing bcrypt credential login and application-owned
HttpOnly, host-only session. Issuance and both verifiers use consistent private
configuration and the existing strict issuer/audience/algorithm/expiry/credential
epoch contract. Request ingress derives the principal and organisation from the
verified session. Current role/read-model and governed DB eligibility checks
remain in place; client role or tenant values do not become authority.

Only a CERTIFIED subject with ready normalized input proceeds to reconciliation.
The operator uses the existing `/decision` command through its verified-principal
authorization bridge and governed DB wrapper. A suitable CREATE_NEW or
MATCH_EXISTING decision may subsequently be materialized through the separate
`/materialize` command. Those existing boundaries check current eligibility and
record the governed decisions; canonical tables must not be edited directly.
This report grants no future decision and does not claim that certification alone
creates canonical state.

## Corrections, verification and preservation

The local correction replaces the nonexistent `/dashboard` login destination,
canonicalises the loopback alias to localhost, stabilises the private local
signing configuration, and adds explicit secret-free development diagnostics.
A subsequent live check found a detail link encoded twice as `%253A`; the client
now unwraps one URI transport layer before its existing API encoding.

Previously passing evidence remains applicable: focused invitation route and
real disposable PG17 tests; official login service/route, verified-principal,
session-consumer and session-authority tests; the new cookie/JWT/middleware
flow tests; two exact detail-route regression tests; final dashboard typechecks
for the respective corrective candidates; syntax and whitespace checks. No
repeated full regression or architectural audit was run for acceptance.

Branch `fix/e1-operator-unblock`, HEAD/base
`a5f85bf099fdbf0a24f1a369e4428730a042a162`, isolated worktree. The only hosted
implementation change in the overall unblock was the separately authorised
additive invitation migration and invitation issuance. This final acceptance
performed only reads and local evidence updates. Historical migrations were not
edited. No approval, rejection, certification, reconciliation, materialization,
Discovery rerun, access to gov-ia-dev, change to the acme identity, commit, push,
PR, merge or deployment was performed. Existing uncommitted work is preserved.

No access blocker remains. Next action belongs to the human operator: inspect
the actual evidence and make any review decision explicitly through the UI.
