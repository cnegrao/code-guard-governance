# Governance Workspace V1 — Validation Evidence

**Date:** 2026-09-07
**Starting main SHA:** `f5bd813f265fe12f379944d517d031b7a893e445`
**Branch:** `feat/governance-workspace-v1`

## 1. Mission

Deliver the first Enterprise Governance Workspace: a review queue and review-subject
detail UI on top of the already-closed backend governance chain (Discovery →
Discovery Intake → Governance Review persistence). This milestone adds no new
domain semantics — it exposes the existing, closed `packages/governance-review`
state machine (`propose`/`confirm`/`certify`/`reject`) to a human operator through
a server-owned CQRS read/write boundary.

## 2. Architecture

**Read side (CQRS query):**
`apps/dashboard/lib/governance/workspace-query.ts` — server-only. Queries
`gov_repo.review_subject_queue` (new view), `gov_repo.discovery_evidence`,
`gov_repo.source_assertions`, `gov_repo.acquisition_runs` directly via the
existing privileged Supabase client exported from `lib/governance/persistence.ts`,
and reuses `governanceReviewPersistence.getReviewAuditChain` for the audit
history. Every query explicitly filters by `organisation_id` — the service-role
client bypasses RLS by role (not by tenant), so this explicit filter is the
actual tenant boundary, matching the existing `persistence.ts` adapter's own
established pattern.

**Command side (CQRS write):**
`apps/dashboard/lib/governance/workspace-commands.ts` — server-only. Loads the
current `ReviewSubject` via the existing `GovernanceReviewPersistencePort`,
checks optimistic concurrency (client-supplied `expectedState` vs. the freshly
loaded state), checks authority
(`apps/dashboard/lib/governance/workspace-actions.ts`), invokes exactly one of
the closed domain functions `propose`/`confirm`/`certify`/`reject`
(`packages/governance-review/src/transitions.ts`), and persists via the
existing `persistReviewTransition` RPC wrapper. No new domain transition was
added; no domain file under `packages/governance-review` or
`packages/canonical-contracts` was modified.

**Authority:** the dashboard's session JWT carries a single verified role
(`org_admin` | `user`), resolved fail-closed at login from a persisted
`GOVERNANCE_ADMIN` system role
(`apps/dashboard/lib/auth/legacy-authorization.ts`, unmodified). All four human
governance actions are gated on `sessionRole === "org_admin"`. A per-transition
permission model does not exist in this codebase today and building one is out
of this milestone's scope (broad RBAC redesign); this is documented as the
current authority ceiling, not silently assumed away.

## 3. Routes / Information Architecture

The dashboard already has a route at `/governance` (an existing "Talk-to-Governance"
chat page, out of scope, untouched). To avoid a collision, the Workspace was added
as a nested route:

- `/governance/reviews` — Review Queue (client page)
- `/governance/reviews/[id]` — Review Subject detail (client page)
- `/api/governance/workspace/summary` — `GET`, executive summary counts
- `/api/governance/workspace/reviews` — `GET`, server-side filtered/paginated queue
- `/api/governance/workspace/reviews/[id]` — `GET` detail (+ `allowedActions`), `PUT` to execute one semantic action

A new sidebar nav entry "Review Queue" → `/governance/reviews` was added
(`components/layout/Sidebar.tsx`); the existing "Governance" chat entry was left
untouched.

## 4. Query Model

`GovernanceReviewPersistencePort` (closed, `packages/governance-review`) exposes
only single-record lookups by primary key — no pagination, filtering, or search.
A minimal, additive extension was required:

- **New migration** `supabase/migrations/20260906190000_governance_workspace_queue_v1.sql`
  adds exactly one read-only view, `gov_repo.review_subject_queue`
  (`security_invoker = true`, `service_role`-only grant), composing
  `review_subjects` with grouped evidence/assertion counts and a `triage_rank`
  column (0 = needs review: DETECTED/PROPOSED/CONFIRMED, 1 = terminal) so the
  queue can order "needs attention first, then newest" in one bounded query
  with no N+1 access. No historical migration file was modified. No new
  table, function, or write path was introduced.
- Evidence/assertion **content** hydration (for the detail view) queries
  `discovery_evidence` / `source_assertions` directly, since
  `GovernanceReviewPersistencePort` only ever returns evidence/assertion
  **IDs**, never hydrated content.

## 5. Command Model

Fully existing — no new migration needed. `workspace-commands.ts` is a thin,
server-only application service on top of the closed `propose`/`confirm`/
`certify`/`reject` functions and the existing `apply_review_transition` RPC
(optimistic concurrency via `SELECT ... FOR UPDATE` + previous-state
precondition, idempotency via `commandId`). No `setState`-style generic
transition endpoint exists; the PUT route accepts only a fixed `action` enum
(`PROPOSE`/`CONFIRM`/`CERTIFY`/`REJECT`) mapped in code to one specific domain
function each.

## 6. Tenant Isolation

`organisationId` is always derived server-side from the verified JWT session
(`getOrgId()`), never from the request body/query. Every workspace query
explicitly filters by it. Confirmed at runtime (§9) that a cross-tenant detail
lookup returns `undefined` (404, indistinguishable from "not found") and that a
queue search never returns another tenant's rows.

## 7. Evidence Handling

`presentEvidence()` in `workspace-query.ts` is the sole place that decides what
an `Evidence` record may render as:
- `HASH_ONLY` → identity, hashes, locations, capturedAt only — `redactedExcerpt`
  is never included, even defensively (stripped regardless of what the
  persisted envelope contains).
- `REDACTED` / `NON_SENSITIVE` → the same safe fields plus the already-redacted
  `redactedExcerpt` when present.
- No raw envelope JSON is ever exposed to the client.

## 8. Concurrency / Stale State

The client submits the `expectedState` it observed when the screen loaded. The
command service compares it to the freshly-loaded actual state **before**
invoking any domain transition; a mismatch returns `STALE_REVIEW_SUBJECT`
without ever calling the persistence layer. The existing
`apply_review_transition` RPC's own `SELECT ... FOR UPDATE` + previous-state
check is reused as a second, DB-level backstop for a genuine concurrent race;
its stale-state error is caught and mapped to the same typed outcome. No
last-write-wins path exists.

## 9. Controlled Runtime Validation

**Authorized project:** `zkqfvqwqdypgpzauzinw` ("ov-ia-g2-test"). Confirmed via
`supabase projects list` that this project is `linked: true` and the forbidden
project `bbisimozudihadfozyfz` ("gov-ia-dev") is `linked: false`; it was never
touched. Migration ledger was verified in sync before push (`supabase migration
list`), the new migration was applied via `supabase db push`, and reconfirmed
applied afterward.

All scenarios below were run against the live disposable project using the
real query/command modules (no mocks) and real seeded data (a new acquisition
run, two evidence records — one `HASH_ONLY`, one `REDACTED` — one source
assertion, and one review subject), created through the existing, closed
Discovery Intake / Governance Review write paths:

| # | Scenario | Result |
|---|----------|--------|
| 1 | Queue seed data created (ReviewSubject at DETECTED) | PASS |
| 2a | Queue returns the real persisted subject for its owning tenant | PASS |
| 2b | Queue is tenant scoped — same search returns nothing for another tenant | PASS |
| 3a–3d | Detail returns subject, evidence, assertions, acquisition-run provenance | PASS |
| 4a | HASH_ONLY evidence never carries `redactedExcerpt` | PASS |
| 4b | REDACTED evidence exposes only the pre-redacted excerpt | PASS |
| 5a | Propose applies (DETECTED → PROPOSED) | PASS |
| 5b | Confirm applies atomically (PROPOSED → CONFIRMED) | PASS |
| 6 | Governance history reflects both transitions | PASS |
| 7 | Forged/incorrect `expectedState` fails closed as `STALE_REVIEW_SUBJECT` | PASS |
| 7b | Certify/reject without a reason fails closed as `INVALID_TRANSITION` | PASS |
| 8 | Stale transition fails closed, never overwrites | PASS |
| 9 | Cross-tenant detail lookup returns `undefined` (fails closed) | PASS |
| 10 | Legitimate certify applies (CONFIRMED → CERTIFIED) | PASS |
| 11 | No canonical object / source mapping materialized as a side effect | PASS |
| 12 | No governance action available on a CERTIFIED (terminal) subject | PASS |
| 13 | Workspace summary query executes, returns numeric counts | PASS |
| 14 | No service_role key or Supabase URL leaks into any response payload | PASS |

20/20 scenarios passed on the first run. No runtime defects found; no
fix-and-rerun cycle was required. The two throwaway validation scripts used to
drive this run were deleted after use and are not part of the deliverable —
the seeded test data itself was left in place (most of the tables involved are
immutable by design, matching the same posture prior milestones' controlled
runtime validations already left behind in this project).

## 10. Adversarial Pass (once)

One real defect was found and fixed: the queue's `search` filter interpolated
the user-supplied term into a PostgREST `.or(...)` filter string. A term
containing `,`/`(`/`)` could inject an additional filter clause into that
string (confined to the same table and the same explicitly-enforced tenant —
`organisation_id` is a separate, non-string-built filter — so no cross-tenant
or arbitrary-SQL exposure existed, but it was not the intended, contained
two-condition search). Fixed by stripping those structural characters in
`escapeIlikeTerm()` in addition to escaping ILIKE wildcards; covered by a new
unit test. All other adversarial items (forged organisationId/actor/role,
arbitrary target state, illegal/replayed/concurrent transitions, evidence
envelope leakage, audit cross-tenant leakage, client-side Supabase access,
service_role exposure, direct canonical mutation) were verified by construction
and/or the runtime scenarios above; no further defects found.

## 11. Static / Component Tests

218 tests pass (`node --test tests/*.test.ts`), including 91 new tests added by
this milestone across:
- `tests/workspace-actions.test.ts` — allowed-action derivation per state/authority
- `tests/workspace-commands.test.ts` — command-side outcomes (not-found, stale,
  forbidden, invalid-transition, applied, replayed, persistence-conflict,
  machine-authority-invariant)
- `tests/workspace-query.test.ts` — tenant-scoping, ordering, pagination bounds,
  evidence presentation policy, search-term sanitization
- `tests/routes-governance-workspace.test.ts` — route-handler behavior via
  `mock.module` (404/403/409/400 mapping, sanitized errors, no client-forged
  organisationId/actor/role reaching the command layer)
- `tests/governance-workspace-queue-migration.test.ts` — static SQL assertions
  on the new migration (additive-only, `security_invoker`, service-role-only
  grants, no new write path, historical migrations untouched)

`npx tsc --noEmit` — zero errors.

## 12. Production Build

`next build` fails prerendering the **pre-existing** `/graph` page
(`Error: Seems like you have not used zustand provider as an ancestor`,
`@xyflow/react`/zustand). This was confirmed present on a clean checkout of
`main` (`f5bd813`) as well — unrelated to this milestone and out of scope to
fix (GraphOS is not part of the Governance Workspace milestone). Verified
separately, with `/graph` temporarily excluded from the route tree for the
purpose of this check only (restored immediately after, no working-tree change
committed), that the build otherwise completes cleanly (36/36 static pages,
all new routes present and correctly typed: `○ /governance/reviews`,
`ƒ /governance/reviews/[id]`, `ƒ /api/governance/workspace/summary`,
`ƒ /api/governance/workspace/reviews`, `ƒ /api/governance/workspace/reviews/[id]`).
Documented and proceeding per explicit user direction.

## 13. Files Changed

New:
- `supabase/migrations/20260906190000_governance_workspace_queue_v1.sql`
- `apps/dashboard/lib/governance/workspace-query.ts`
- `apps/dashboard/lib/governance/workspace-commands.ts`
- `apps/dashboard/lib/governance/workspace-actions.ts`
- `apps/dashboard/app/(dashboard)/governance/reviews/page.tsx`
- `apps/dashboard/app/(dashboard)/governance/reviews/[id]/page.tsx`
- `apps/dashboard/app/api/governance/workspace/summary/route.ts`
- `apps/dashboard/app/api/governance/workspace/reviews/route.ts`
- `apps/dashboard/app/api/governance/workspace/reviews/[id]/route.ts`
- `apps/dashboard/components/workspace/StateBadge.tsx`
- `apps/dashboard/tests/workspace-actions.test.ts`
- `apps/dashboard/tests/workspace-commands.test.ts`
- `apps/dashboard/tests/workspace-query.test.ts`
- `apps/dashboard/tests/routes-governance-workspace.test.ts`
- `apps/dashboard/tests/governance-workspace-queue-migration.test.ts`
- `docs/codex/evidence/2026-09-07-governance-workspace-v1-validation.md`

Modified:
- `apps/dashboard/components/layout/Sidebar.tsx` (added "Review Queue" nav entry)
- `apps/dashboard/components/ui/Badge.tsx` (added review-state badge variants)

No historical migration, no `packages/governance-review` or
`packages/canonical-contracts` file, was modified.

## 14. PR / Merge / Production Status

See PR description for link and merge SHA. No production deployment was
performed or authorized by this milestone.
