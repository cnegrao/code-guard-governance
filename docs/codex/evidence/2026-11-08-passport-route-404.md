# Passport route 404 — local correction and hosted dependency STOP

Date: 2026-11-08, America/Sao_Paulo. No browser automation was used.

## Runtime and preserved state

Runtime worktree: `D:/code-guard-governance/.worktrees/e1-operator-unblock`,
branch `fix/e1-operator-unblock`, HEAD `a5f85bf099fdbf0a24f1a369e4428730a042a162`.
PowerShell associated port 3101 connections with Next server PID 34688, child of
launcher PID 35848 (`next dev --hostname 127.0.0.1 --port 3101`). The TCP entry
for the listener appeared as Closed, although direct HTTP requests were served.
Launcher metadata and source set the working directory to this worktree's
`apps/dashboard`; its log received the diagnostic requests and its compiled
dynamic route contains the applied decoder. The server was already running;
no restart, new signing secret or replacement session was needed.

Implementation preflight ran in a separate clean worktree,
`D:/code-guard-governance/.worktrees/passport-404`, branch
`fix/passport-route-404`, at the same HEAD/base, with a 30-minute active-work
target. Only the Passport page and its regression test were copied to the E1
worktree after checking that those two targets had no prior changes. Other
pending E1 and main-checkout changes were preserved.

## Proven 404 cause

Exact reported URL:
`http://localhost:3101/agents/canonical/canonical-object%3A06b5f654e2b57694e6fd973d42275309a1149313792569ee2e9ed2cfe2eb1d81`.

The dynamic route exists and compiled in the actual runtime. Existing request
logs show both middleware and Node JWT verification for this URL. The installed
Next 15.5.19 `getDynamicParam()` URI-encodes the value passed to page code.
The page previously forwarded that transport value unchanged.

The list reads `canonical_objects` for the verified session organisation and
kind AGENT. Detail adds an exact organisation/kind/object-ID lookup through
`getCanonicalObjectForMatch()`, followed by another bounded canonical read.
Read-only queries against test project `zkqfvqwqdypgpzauzinw` confirmed that
the literal `canonical-object:06b5...` ID exists in GOVIA_DEMO
(`082ef694-e016-4893-908c-1eef373f53af`), while its `%3A`-escaped representation
returns null. Thus the initial identity gate returned undefined and the page
called `notFound()`. This was a transport-parameter mismatch, not an absent
route or a reason to relax authentication or tenant checks.

The page now decodes exactly one URI layer before the query. Malformed escapes
still fail closed. The query string's version value is not decoded again.
No database query, policy, principal construction or canonical record changed.

## Existing identities and next blocker

Read-only test DB checks confirmed both canonical objects and their persisted
parent association:

- AGENT: `canonical-object:06b5f654e2b57694e6fd973d42275309a1149313792569ee2e9ed2cfe2eb1d81`;
  decision `reconciliation-decision:98a5c01e1e0a91e7b4e5ee3db2e76c63`.
- AGENT_VERSION: `canonical-object:1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1`;
  decision `reconciliation-decision:f9e291117ae6ddbd4eb2193a9307297d`.
- Parent mapping: `1f4a37e5-0dd6-4809-813e-cec0ab8e2c38`.

After the local patch, actual authenticated requests recorded by the existing
server advanced past identity recovery and failed at
`PASSPORT_GOVERNANCE_READ_FAILED: l14_read_passport_governance_v1`.
These were observed server requests, not automated browser navigation.

A transaction explicitly declared `begin read only` queried `pg_proc` and
`pg_namespace` in the linked test project. One consolidated JSON result showed
the two identities above and `passport_functions: []` for these exact names:

- `gov_repo.l14_read_passport_governance_v1`;
- `gov_repo.l15_read_passport_risk_overlay_v1`.

Their repository definitions belong to existing migrations
`20261012120000_m16_read_projection_closure_v1.sql` and
`20261019130000_m17_s7b_passport_risk_overlay_v1.sql`. This identifies missing
hosted dependencies; it is not approval to apply those files independently or
assume their transitive prerequisites are satisfied. No hosted migration,
permission change, fallback that suppresses governed reads, historical
migration edit, data creation, canonical mutation or access to gov-ia-dev was
performed. Implementation STOP: missing dependency / hosted mutation required.

## Verification and HTTP limits

- Passport page suite: 21 passing tests, including the installed Next parameter
  transform, literal percent preservation, malformed input, strict session
  handling and selected-version rendering.
- Passport query suite: 68 passing tests. Its production inputs were unchanged
  by the later type-only correction to the new test call.
- E1 runtime page suite: 21 passed with its pending authentication changes.
- E1 dashboard typecheck with `--incremental false`: passed. Two initial
  typecheck failures in the new test invocation were corrected by inspecting
  the installed signature and supplying its required null fallback argument.
- Final page verification on the corrected test candidate: 21 passed.
- `git diff --check`: passed. No full regression loop was run.

Direct unauthenticated HTTP GETs to both requested paths returned 307 to
`http://localhost:3101/login`, before and after the patch. An existing real
login cookie was requested as a private local file; none was supplied during
this investigation. No substitute JWT/session was minted. Authenticated direct
HTTP before/after verification therefore remains pending.

The operator-reported pre-patch 404 must not be conflated with the transport
status: the old server logs recorded 200 for streamed responses, and post-patch
logs likewise recorded 200 alongside the RPC rendering exception. Neither
status proves a successful Passport body. Full Passport recovery is blocked
by the missing hosted read functions, despite recovery of canonical identity.

Next action: obtain owner authorization for a separate test-project dependency
inventory and approved hosted alignment plan, including prerequisites and
preservation checks. Then validate both authenticated HTTP response bodies and
explicit AGENT_VERSION selection using the operator's existing login session.
No commit, push, PR, merge or deployment was performed.
