# Canonical Materialization V1 — Controlled Runtime Validation Evidence

Date: 2026-09-06
Status: RUNTIME_PROVEN_FOR_CONTROLLED_ENVIRONMENT

## Purpose

Record controlled runtime validation evidence for Canonical Materialization
V1: turning an already-persisted, valid canonical ReconciliationDecision
(Governance Persistence V1) into governed canonical truth — canonical
objects, governed relationships, and object/source identity mappings.

## Authorized Environment

- Disposable controlled Supabase project: `ov-ia-g2-test`
- Project ref: `zkqfvqwqdypgpzauzinw`
- `gov-ia-dev` (`bbisimozudihadfozyfz`) was explicitly prohibited and untouched
- No production data was accessed

## Migration Integrity

- Target migration: `supabase/migrations/20260906120000_canonical_materialization_v1.sql`
- Canonical SHA-256 of the file content: `6d9e1bcf0880141dc93d93b35b2cde14e9d9514838c15e06d8766bc4db71f3f0`
- Applied via `supabase db push --linked`.

## Local Defect Found and Fixed (runtime-discovered)

One fix-and-rerun cycle, per Phase 14's instructions:

1. **Composite FK targeted a non-existent unique constraint** —
   `materialization_operations_invocation_fkey` originally referenced
   `gov_repo.reconciliation_invocations (organisation_id, invocation_id)`,
   but that table carries only a global PK on `invocation_id` plus a
   separate `unique (organisation_id, command_id)` — no composite
   `(organisation_id, invocation_id)` unique constraint exists. Fixed by
   targeting `invocation_id` alone; tenant match is independently enforced
   in both `gov_repo.materialize_object_reconciliation` and
   `gov_repo.materialize_relationship_reconciliation` via an explicit
   `ri.organisation_id = p_organisation_id` check before use.
2. **Cosmetic**: one RLS policy identifier
   (`"Service role has full access to canonical_object_source_mappings"`)
   exceeded PostgreSQL's 63-byte identifier limit and was silently
   truncated. Renamed to `"Service role access to
   canonical_object_source_mappings"`, matching the shorter-name convention
   Governance Persistence V1 already established for its own
   longer-named tables, and patched in place on the controlled project.

Both fixes are reflected directly in the committed migration file (the
historical `20260905060000_governance_persistence_v1.sql` was never
touched).

## Environmental Note: PostgREST Outage (not a code/migration defect)

Mid-session, the controlled project's PostgREST/Data-API layer returned
`PGRST002` / HTTP 503 ("Could not query the database for the schema
cache") for **every** request — including reads of pre-existing, untouched
tables (`organisations`) and the OpenAPI root — while the direct Postgres
connection used by `supabase db query`/`db push` remained fully healthy
throughout. This confirmed the outage was isolated to the project's
PostgREST layer, not caused by this migration. It resolved after the
project was restarted; a follow-up health check (`GET
/rest/v1/organisations` with the `gov_repo` schema profile) returned `200`
before runtime testing resumed. This matches the exact "PostgREST
connection-pool sizing on small/free-tier projects" risk flagged as
explicitly remaining in Governance Persistence V1's own evidence doc.

## Functional Matrix Results

Executed via a Node/`@supabase/supabase-js` harness driving the actual
`governanceReviewPersistence` + `materializationPersistence` adapters and
`materializeReconciliationDecision` application service end-to-end against
the controlled project (service_role for the application flow; anon and a
real GoTrue-issued JWT for the denial checks) plus one direct-SQL
(`supabase db query --linked`) block for immutability, mirroring exactly
the method Governance Persistence V1 used for the same assertion (PostgREST
cannot express `UPDATE ... RETURNING` against a `DO INSTEAD NOTHING` rule at
all — confirmed identically against V1's own pre-existing
`review_audit_events` table, independent of this migration).

| # | Scenario | Result |
|---|----------|--------|
| 1-2 | Valid CREATE_NEW decision materializes a canonical object (kind/identity/tenant preserved) | PASS |
| 3 | ObjectSourceMapping created for the materialized object | PASS |
| 4-5 | Replaying the same decision returns exactly one logical result (object, mapping, outbox row each still exactly 1) | PASS |
| 6 | Concurrent same-decision materialization (`Promise.all`, two overlapping calls) yields exactly one winner and one canonical object row | PASS |
| 7 | MATCH_EXISTING binds to the existing object without creating a second one | PASS |
| 8 | MATCH_EXISTING across tenants fails closed (`MATCH_EXISTING_TARGET_NOT_FOUND`) | PASS |
| 9 | REJECT creates no canonical object | PASS |
| 10 | DEFER creates no canonical object | PASS |
| 11 | Valid CREATE_NEW relationship (HANDOFF_TO, AGENT_VERSION → AGENT) materializes a governed edge | PASS |
| 12 | Relationship materialization fails closed when an endpoint (AGENT_VERSION) was never materialized | PASS |
| 13 | Immutable UPDATE/DELETE blocked at the PostgreSQL rule level for `canonical_objects` (direct SQL, service-role-equivalent privilege) | PASS |
| 13b | Immutable UPDATE blocked for `reconciliation_decisions` (re-confirmed on this branch's data) | PASS |
| 15 | Canonical-identity-mismatched materialization call rolls back with zero partial rows (`materialization_operations`, `canonical_objects` both 0) | PASS |
| 16 | anon RPC execution denied | PASS |
| 16b | anon direct table read denied | PASS |
| 17 | authenticated (real GoTrue-issued JWT via live signup) RPC execution denied | PASS |
| 18 | service_role RPC execution allowed (re-confirmed via direct read) | PASS |

Cross-tenant relationship materialization (endpoint belonging to a
different organisation) and duplicate-edge rejection are additionally
covered by the static test suite
(`packages/governance-review/test/materialization-invocation.test.ts`),
which exercises the full authority chain and idempotency contract via
fakes; the live matrix above focuses on what only a real PostgreSQL server
can prove (RLS/grants, rule-level immutability, real concurrency, and the
actual RPC SQL executing without error).

## Idempotency / Concurrency

- `gov_repo.materialization_locks` (`INSERT ... ON CONFLICT DO NOTHING`,
  mirroring `reconciliation_command_locks`) correctly serialized two
  concurrent `materialize_object_reconciliation` calls for the same
  decision: exactly one canonical object row, one mapping row, and one
  outbox event resulted, with the loser resolving to `replay: true` against
  the winner's committed result.
- A replay with a changed idempotency fingerprint (simulated via a mutated
  ReviewSubject source identity) failed closed with
  `MATERIALIZATION_IDEMPOTENCY_CONFLICT`.

## Rollback / Atomicity

- An intentional canonical-object-kind mismatch against the RPC (decision
  authorized `AGENT`, call claimed `TOOL`) aborted the entire transaction:
  zero rows in `materialization_operations` and zero in `canonical_objects`
  for that decision afterward — full rollback, including the
  `materialization_locks` row taken earlier in the same transaction.

## Findings Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 1 (found and fixed — missing composite unique constraint assumption) |
| LOW | 1 (found and fixed — identifier length) |

## Explicitly Remaining Risks (NOT CLOSED)

1. **PostgREST connection-pool/gateway stability on this disposable
   project** — recurred during this session (see above), required a
   project restart; a property of this specific test project's tier, not
   of the migration.
2. **Outbox delivery worker** — intentionally out of scope for this
   milestone; `GOVERNANCE_CANONICAL_OBJECT_MATERIALIZED` /
   `GOVERNANCE_CANONICAL_RELATIONSHIP_MATERIALIZED` events are written but
   nothing yet consumes/delivers them (same status as Governance
   Persistence V1's own outbox events).
3. **MERGE_CANDIDATES has no materialization target in this milestone** —
   by design (see the migration's own comments and
   `materializeReconciliationDecision`'s `CANDIDATE_MERGE_HAS_NO_OBJECT_TARGET`
   result); a future milestone would need to define what, if anything,
   follows a candidate merge.

## Production Non-Authorization

This controlled runtime validation **DOES NOT** authorize production
deployment.

- Production execution requires a separate deployment/migration gate
  against `bbisimozudihadfozyfz`, not performed here
- `bbisimozudihadfozyfz` was untouched throughout this validation
- No production data was accessed
