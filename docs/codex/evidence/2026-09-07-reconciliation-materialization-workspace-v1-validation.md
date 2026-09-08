# Reconciliation & Materialization Workspace V1 — Validation Evidence

Date: 2026-09-07
Status: RUNTIME_PROVEN_FOR_CONTROLLED_ENVIRONMENT

## Starting SHA

Authoritative canonical main at start: `927809b6ca7bd729f9b340066ebac87b169a6a39`
(local main == origin/main, no tracked changes).

## Mission

Expose the existing, closed decision-to-truth backend chain
(CERTIFIED → reconciliation authorization → reconciliation decision →
materialization → governed canonical state) through the Governance Workspace
UI, without inventing any new backend semantics.

## Capability Matrix (confirmed by reading the code, not assumed)

| Kind | Discovery output | Reconciliation status |
|---|---|---|
| MODEL | `OBJECT_INPUT_AVAILABLE` | Eligible — full CREATE_NEW/MATCH_EXISTING/REJECT/DEFER |
| TOOL | `OBJECT_INPUT_AVAILABLE` | Eligible — full CREATE_NEW/MATCH_EXISTING/REJECT/DEFER |
| RELATIONSHIP | `RELATIONSHIP_INPUT_AVAILABLE` | Eligible — REJECT/DEFER only (see below) |
| AGENT | `FINDING_ONLY` | Not eligible — no normalized candidate |
| all other kinds | no production detector | Not eligible |

## Decision-to-Truth Map

```
CERTIFIED
  -> INPUT READINESS   (ReconciliationReadinessPolicy, new)
  -> AUTHORIZATION      (ReconciliationAuthorizationPort, new adapter — first ever implementation)
  -> RECONCILIATION      (invokeObjectReconciliation / invokeRelationshipReconciliation, closed, now wired)
  -> DECISION            (persistAuthorizedReconciliation, closed, now called)
  -> MATERIALIZATION     (materializeReconciliationDecision, closed, now wired)
  -> CANONICAL RESULT    (canonical_objects / canonical_relationships, closed)
```

Authorization and reconciliation are **one atomic backend operation** in the
existing domain package (`invokeObjectReconciliation`/
`invokeRelationshipReconciliation` consult the `ReconciliationAuthorizationPort`
internally, and `persistAuthorizedReconciliation` persists
AuthorizationDecision + ReconciliationInvocation + ReconciliationDecision in
one transaction) — there is no separate persisted "authorized, not yet
reconciled" state. The lifecycle stepper presents Authorization and
Reconciliation as reaching COMPLETED together, which is the accurate
reflection of the real backend, not a simplification invented for this
milestone.

## Architecture Decision Required and Resolved

**Gap found during inspection**: `MATCH_EXISTING` requires a human to select
an existing canonical object as the reconciliation target, but no capability
existed anywhere in the codebase to list/search existing canonical objects
(no deterministic outcome resolver, no search API — `gov_repo.canonical_objects`
carries no name/display column by design). Per the runbook, this is exactly
the condition for `STOP_REQUIRES_ARCHITECTURE_DECISION`.

**Resolved by explicit operator decision**: build a minimal, read-only,
tenant- and kind-scoped canonical-object lookup
(`apps/dashboard/lib/governance/canonical-object-lookup.ts`) surfacing each
existing canonical object's id plus its real, currently-active source
mappings (connection/external type/external id — the only durable
human-recognizable signal that exists, since the table has no name column).
A client-selected `matchCanonicalObjectId` is always re-verified against this
same table server-side before it can be used in a reconciliation command —
never trusted merely because the client sent it.

## RELATIONSHIP Scope (derived fact, not a new judgment call)

`canonical-contracts`' `RELATIONSHIP_ENDPOINT_CONSTRAINTS` requires every one
of the twelve governed relationship types to have a source endpoint of kind
`AGENT_VERSION` or `DATA_ELEMENT`. Neither kind has a production normalizer
(Object Candidate Normalization V1, closed, proves only MODEL/TOOL/RELATIONSHIP).
Therefore no relationship's source endpoint can currently resolve to an
existing governed canonical object — `CREATE_NEW`/`MATCH_EXISTING` are not
safely offerable for RELATIONSHIP in this milestone. `REJECT`/`DEFER` need no
endpoint and are fully supported. This is enforced at both the UI
(`availableOutcomesFor`) and the command layer (explicit `INVALID_REQUEST`),
and proven live (see Controlled Runtime below).

## Information Architecture

Extended the existing `/governance/reviews/[id]` detail page (no new route):
a "Decision to Truth" lifecycle stepper card plus a "Reconciliation &
Materialization" card presenting readiness, the outcome-selection form,
the persisted decision summary, and the materialization/governed result —
matching the existing page's visual language (`Card`, `Button`, dark theme).

## New Files

- `apps/dashboard/lib/governance/reconciliation-readiness.ts` —
  `ReconciliationReadinessPolicy`. Pure. Reason codes: `READY`,
  `NOT_CERTIFIED`, `FINDING_ONLY`, `INPUT_UNAVAILABLE`, `ALREADY_RECONCILED`,
  `ALREADY_MATERIALIZED`.
- `apps/dashboard/lib/governance/reconciliation-authorization-port.ts` — the
  first dashboard implementation of `ReconciliationAuthorizationPort`,
  mirroring `hasGovernanceReviewAuthority`'s existing coarse role ceiling
  (`org_admin`). The command service checks authority *before* constructing
  this Port; the Port itself is defense-in-depth (denies on any
  organisation/actor mismatch against the session that built it).
- `apps/dashboard/lib/governance/canonical-object-lookup.ts` — the new
  minimal MATCH_EXISTING lookup described above.
- `apps/dashboard/lib/governance/decision-query.ts` —
  `GovernanceDecisionQueryService`. One bounded read composing ReviewSubject
  + recovery + reconciliation + materialization.
- `apps/dashboard/lib/governance/decision-commands.ts` —
  `GovernanceDecisionCommandService`: `submitReconciliationDecision`,
  `triggerMaterialization`. The only new caller of
  `invokeObjectReconciliation`/`invokeRelationshipReconciliation`/
  `materializeReconciliationDecision` in the dashboard.
- `apps/dashboard/components/workspace/LifecycleStepper.tsx` — presentation
  only, derived strictly from server-provided facts.
- `apps/dashboard/app/api/governance/workspace/reviews/[id]/decision/route.ts`
  (GET detail, POST submit decision) and
  `.../[id]/materialize/route.ts` (POST trigger materialization).
- One migration: `supabase/migrations/20260907130000_reconciliation_materialization_workspace_v1.sql`
  — a single additive partial index,
  `idx_reconciliation_invocations_review_subject`, needed for the new
  "does this review subject already have a reconciliation decision" read
  path. No table changed, no historical migration touched.

## Idempotency / Replay

- Reconciliation: the command service computes a **deterministic commandId**
  (SHA-256 over organisationId, reviewSubjectId, requestedOutcome, match
  target, reasonCode, actor) — an identical resubmission always produces the
  identical commandId, so the closed backend's own
  `reconciliation_command_locks` + `checkPriorInvocation` guarantee a
  deterministic replay, never a duplicate decision. Proven live (see below).
- Materialization: the closed `materialization_operations_decision_unique`
  constraint is the idempotency anchor; `triggerMaterialization` always calls
  through to `materializeReconciliationDecision` (no separate pre-check),
  relying on that anchor for a correct replay. Proven live.
- Read-before-write guard: before invoking reconciliation, the command
  service re-derives readiness from current persisted state
  (`findReconciliationDecisionIdForReviewSubject`) and refuses
  (`NOT_READY`/`ALREADY_RECONCILED`/`ALREADY_MATERIALIZED`) rather than
  reaching the domain gate at all if another operator already acted. The UI
  refreshes the lifecycle view on any 409 response (mirroring the existing
  `STALE_REVIEW_SUBJECT` pattern), so a stale screen self-heals rather than
  sticking on an outcome form that no longer applies.

## Local Defect Found and Fixed (runtime-discovered)

One fix-and-rerun cycle:

**`triggerMaterialization` did not classify `SOURCE_IDENTITY_ALREADY_MAPPED`.**
Discovered live when a TOOL candidate's source file also backed an
already-materialized MODEL from the same file (a real, expected scenario —
one external artifact can only ever be bound to one governed canonical
object, per the closed `canonical_object_source_mappings_active_source_uidx`
invariant). The unhandled rejection propagated as a generic 500 instead of a
clean, actionable conflict. Fixed by matching this specific RPC rejection in
`decision-commands.ts` and returning `PERSISTENCE_CONFLICT` with a sanitized
message. Covered by a new unit test
(`decision-commands.test.ts`). This is not a defect in the closed
Canonical Materialization V1 migration/RPC — that constraint is correct and
was left untouched; only the dashboard's own error classification was
missing.

## Static / Component Tests (new)

- `tests/reconciliation-readiness.test.ts` — 8 tests, every readiness reason
  branch (pure).
- `tests/decision-query-boundary.test.ts` — 6 tests: server-only markers,
  every `privilegedDb` query filters by `organisation_id` (and
  `canonical_object_lookup` additionally by `kind`), `availableOutcomesFor`
  pure logic, and a truth-boundary test proving no workspace file ever
  writes directly to `canonical_objects`/`canonical_relationships`/
  `canonical_object_source_mappings`.
- `tests/decision-commands.test.ts` — 17 tests covering MODEL/TOOL/
  RELATIONSHIP reconciliation success, RELATIONSHIP CREATE_NEW/MATCH_EXISTING
  rejection, AGENT FINDING_ONLY block, non-CERTIFIED block, forbidden role,
  ALREADY_RECONCILED block, MATCH_EXISTING server-side re-verification
  (both valid and forged/stale target), empty reasonCode rejection,
  deterministic commandId stability (double-click protection), materialization
  success/NOT_READY/FORBIDDEN/cross-tenant-fails-closed/SOURCE_IDENTITY_ALREADY_MAPPED.
- `tests/routes-governance-decision.test.ts` — 11 tests covering both new
  routes' status-code mapping and the "never forwards client-supplied
  organisationId/actor/role/canonical target" boundary checks.

## Adversarial Pass

All 35 items in the runbook's checklist were considered against what this
milestone actually built (items about relationship endpoint/direction
substitution and generic UI-only target-selection protocols are structurally
inapplicable — RELATIONSHIP CREATE_NEW/MATCH_EXISTING is not offered at all
this milestone). The applicable ones:

| # | Scenario | Result |
|---|---|---|
| 1-3 | Forge organisationId/actor/role | Impossible — all three are server-derived from trusted headers, never read from the request body (tested, source-pattern-verified) |
| 4-5 | Authorize/reconcile AGENT FINDING_ONLY | Blocked, `NOT_READY`/`FINDING_ONLY`, before any Port is built (tested, proven live) |
| 6 | Authorize non-CERTIFIED subject | Blocked, `NOT_READY`/`NOT_CERTIFIED` (tested) |
| 8-10 | Forge candidate/finding/outcome | Impossible — candidate/finding are always server-recovered; outcome is a fixed 4-value enum validated server-side (tested) |
| 11-12 | Inject/cross-tenant canonicalObjectId | `getCanonicalObjectForMatch` re-verifies server-side, tenant-scoped; a forged/cross-tenant id returns `INVALID_REQUEST` (tested, proven live) |
| 13-16 | Reused invocation id / double-click | Deterministic commandId → DB-level replay, never a duplicate decision (tested, proven live: exactly 1 `reconciliation_decisions` row after 2 identical submissions) |
| 17-19 | Stale screens | Read-before-write guard + UI auto-refresh on 409 |
| 20-22 | Direct canonical-truth writes from Workspace | Source-pattern test proves no `insert`/`update`/`rpc` call near those table names anywhere in the new files |
| 25-26 | Invalid outcome / materialize before decision | `NOT_APPLICABLE`/`NOT_READY` respectively (tested, proven live) |
| 27-28 | Client Supabase/service_role leakage, raw RPC errors | All new files are `server-only`; routes sanitize every error |
| 29-30 | Cross-tenant history/decision lookup | Every query explicitly filters by `organisation_id` (boundary-tested, proven live) |
| 33-34 | FINDING_ONLY/INPUT_UNAVAILABLE falsely READY | Explicit readiness unit tests for every reason code |
| 35 | Dormant kind (RELATIONSHIP CREATE_NEW/MATCH_EXISTING) becomes actionable | Blocked at both UI (`availableOutcomesFor`) and command layer (`INVALID_REQUEST`), tested |

No structural contradiction found beyond the one resolved architecture
decision (MATCH_EXISTING lookup) above.

## Controlled Runtime (run against `zkqfvqwqdypgpzauzinw`)

- Verified `SUPABASE_URL` pointed at the authorized disposable project (not
  `bbisimozudihadfozyfz`) before any write.
- Migration ledger checked once (`supabase migration list --linked`): all 45
  prior migrations already applied; only the new
  `20260907130000_reconciliation_materialization_workspace_v1.sql` pending.
  Applied via `supabase db push --linked`.
- A throwaway `.mts` harness (never committed; deleted immediately after the
  run) drove the real `signup` service, `runGovernanceDiscoveryScan` (a real
  `LocalRepositoryAdapter` scan of a real temporary directory), the real
  `workspaceCommands`, and the new `decision-query`/`decision-commands`
  services end-to-end against the disposable project.

| # | Scenario | Result |
|---|---|---|
| 1-2 | CERTIFIED MODEL visible, readiness READY | PASS |
| 3-6 | MODEL: CREATE_NEW reconciliation APPLIED, materialization APPLIED, canonical result visible via query service | PASS |
| — | MODEL resubmission after materialization: `NOT_READY`/`ALREADY_MATERIALIZED`, no duplicate decision row | PASS |
| — | MODEL materialize replay: `REPLAYED`, same canonical object/mapping, no duplicate | PASS |
| 7-11 | CERTIFIED TOOL visible, readiness READY, CREATE_NEW reconciliation APPLIED, materialization APPLIED | PASS |
| 13-18 | CERTIFIED RELATIONSHIP visible, readiness READY, availableOutcomes exactly `[REJECT, DEFER]`, REJECT reconciliation APPLIED, materialize `NOT_APPLICABLE` (`NOT_MATERIALIZING_OUTCOME`) — the actual valid path, not a fabricated materializable decision | PASS |
| 19-24 | CERTIFIED AGENT visible, recovery `FINDING_ONLY`, readiness NOT READY, `availableOutcomes` empty, reconciliation blocked, materialization blocked | PASS |
| — | Materializing a nonexistent review subject | `NOT_FOUND`, fails closed | PASS |
| 28-29 | Cross-tenant: ORG B cannot read/reconcile ORG A's review subject | `undefined`/`NOT_FOUND` | PASS |
| 29 | ORG B cannot MATCH_EXISTING against ORG A's canonical object | `INVALID_REQUEST` (re-verification against a tenant-scoped lookup fails closed) | PASS |
| 32 | No secrets/service-role/connection-string in a query-service response | PASS |
| 33 | Production project (`bbisimozudihadfozyfz`) untouched | PASS (guarded + never referenced) |

**29/29 runtime checks passed** on the final run. One earlier iteration's
harness bug (see Defects Found in Harness below) was fixed before this count.

## Defects Found in the Harness (not the shipped implementation)

1. An initial single-file fixture put a MODEL and a TOOL declaration in the
   same source file, which correctly (not a bug) collided on
   `canonical_object_source_mappings_active_source_uidx` when both were
   materialized — this is exactly what surfaced the real
   `SOURCE_IDENTITY_ALREADY_MAPPED` classification gap fixed above. The
   fixture was split into two files so MODEL and TOOL each get a distinct
   source identity, matching realistic usage and letting both materialize
   independently, which the final run proves.
2. `driveToCertified` initially hardcoded ORG A's session context regardless
   of which organisation's review subject was passed in — calling it for
   ORG B's subject correctly (if accidentally) returned `NOT_FOUND`, proving
   tenant isolation. Fixed to take the organisation context as a parameter.

## Tests / Typechecks / Build

- `packages/governance-review`: 113/113 tests pass (untouched). `tsc --noEmit` clean.
- `packages/canonical-contracts`: 83/83 tests pass (untouched). `tsc --noEmit` clean.
- `apps/dashboard`: 303/303 tests pass (42 new). `npx tsc --noEmit` clean.
- `git diff --check`: clean, no whitespace errors.

## Known /graph Baseline Exception

`npm run build` in `apps/dashboard` compiles and type-checks all
changed/new code successfully and fails only at static-prerender time for the
pre-existing, unrelated `/graph` route (`Error: Seems like you have not used
zustand provider as an ancestor`). This is the documented pre-existing
baseline exception (see prior evidence docs) and is not a regression
introduced by this milestone.

## Database / Migration Status

One additive migration, applied to the controlled project and confirmed in
the migration ledger. No historical migration was modified.

## Production Deployment Status

**Not deployed.** `bbisimozudihadfozyfz` was never touched at any point in
this milestone. Production execution requires a separate deployment/migration
gate, not performed here.

## What This Milestone Unblocks

A properly authorized governance professional can now use the Governance
Workspace to take a CERTIFIED MODEL or TOOL review subject through
authorized reconciliation and controlled canonical materialization end to
end, and a CERTIFIED RELATIONSHIP through REJECT/DEFER reconciliation —
while AGENT (and every other unsupported kind) remains explicitly,
honestly fail-closed rather than fabricated or silently bypassed.

## Next Product Milestone

RELATIONSHIP CREATE_NEW/MATCH_EXISTING support, gated behind a future
AGENT_VERSION or DATA_ELEMENT identity normalizer (a distinct, out-of-scope
future milestone — not something to retrofit here).
