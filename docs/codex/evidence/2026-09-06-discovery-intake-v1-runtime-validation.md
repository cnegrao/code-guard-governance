# Discovery Intake V1 — Runtime Validation Evidence

Date: 2026-09-06
Status: RUNTIME_PROVEN_FOR_CONTROLLED_ENVIRONMENT

## Purpose

Record controlled runtime validation evidence for Discovery Intake V1:
connecting the existing Discovery Engine (`packages/scanner`) to the
existing Governance Review persistence boundary (`packages/governance-review`,
Governance Persistence V1, Canonical Materialization V1) so a real
`LocalRepositoryAdapter` scan durably reaches a governed review queue
without machine discovery ever bypassing human authority.

## Authorized Environment

- Disposable controlled Supabase project: `ov-ia-g2-test`
- Project ref: `zkqfvqwqdypgpzauzinw`
- `gov-ia-dev` (`bbisimozudihadfozyfz`) was explicitly prohibited and untouched
- No production data was accessed
- Credentials (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) were supplied via a
  local, out-of-repository environment file; never printed, echoed, staged,
  or committed at any point in this session

## Migration Integrity

- Target migration: `supabase/migrations/20260906180000_discovery_intake_v1.sql`
- Final canonical SHA-256 of the file content: `e79df90dea65616adc122be6a669f5aad1a37acf739f7d028a7b17c1412f515b`
- Applied via `supabase db push --linked`, with two subsequent in-place
  `CREATE OR REPLACE FUNCTION` corrections applied directly against the
  linked project once the runtime defects below were found and fixed in the
  committed migration file (see "Runtime Defects Found and Fixed")

## Local Defects Found and Fixed (runtime-discovered)

Two fix-and-rerun cycles, per the originating instructions' anti-loop discipline
(fix once, rerun only affected checks):

1. **Table name collision with a pre-existing, unrelated schema concept.**
   `gov_repo.evidence` already existed on this controlled project as part of
   its foundational (2026-08-18) schema — a compliance/audit evidence-locker
   table (verification workflow, chain of custody, retention/classification,
   referenced by `conformity_assessments`, `ict_incidents`, `ai_systems`,
   `evidence_files`) with no relation to discovery provenance. This was
   outside this milestone's inspection scope (foundational/historical
   migrations were deliberately not re-audited) and could only be discovered
   by actually attempting to apply the migration — the migration's own
   fail-closed preflight check caught it immediately and refused to apply,
   causing no damage. Fixed by renaming the new table to
   `gov_repo.discovery_evidence` throughout the migration and its static
   tests; no pre-existing table, row, or unrelated schema was touched.

2. **`INSERT ... ON CONFLICT` is not legal on a table with a rewrite RULE.**
   `gov_repo.discovery_evidence` and `gov_repo.source_assertions` are
   immutable via `DO INSTEAD NOTHING` rules, and PostgreSQL disallows
   `INSERT ... ON CONFLICT` on any table protected by a rewrite rule — the
   exact same constraint Governance Persistence V1 already documented and
   solved for `gov_repo.authorization_decisions` via a
   check-then-insert-with-exception-handler pattern. The first runtime
   attempt surfaced this directly: `INSERT with ON CONFLICT clause cannot be
   used with table that has INSERT or UPDATE rules`. Fixed by rewriting
   `gov_repo.record_discovery_evidence` and
   `gov_repo.record_discovery_source_assertion` to use that same established
   pattern (`begin ... exception when unique_violation then ... end`)
   instead of `ON CONFLICT`, matching `gov_repo.record_authorization_decision`'s
   own precedent exactly. `gov_repo.start_acquisition_run` keeps its
   `ON CONFLICT` (that table, `acquisition_runs`, carries only a trigger, not
   a rule, so `ON CONFLICT` remains legal there).

3. **Pre-existing test data from prior milestones' own runtime validation
   predates the new hard-gate FKs.** The controlled project already carried
   real `review_subject_assertions` rows (from the Governance Persistence V1
   / Canonical Materialization V1 controlled runtime validations) referencing
   synthetic test assertion ids that were never meant to be durable
   Evidence/SourceAssertion content. Adding the hard-gate composite FKs as
   ordinary (validating) constraints failed against this historical data.
   Rather than deleting another milestone's test/audit trail, the FKs were
   added `NOT VALID` — fully enforced for every row inserted or updated from
   this migration forward (the actual guarantee this milestone needs), while
   never requiring unrelated historical data to retroactively satisfy an
   invariant introduced after it was written.

All three fixes are reflected directly in the committed migration file and
its static tests; neither historical migration
(`20260905060000_governance_persistence_v1.sql`,
`20260906120000_canonical_materialization_v1.sql`) was touched, and no
pre-existing row was deleted or modified.

## Functional Matrix Results

Executed via a Node/`tsx` harness driving the actual `runGovernanceDiscoveryScan`
application service and its real `governanceReviewPersistence` +
`materializationPersistence` + `discoveryIntakePersistence` adapters
end-to-end against the controlled project (service_role for the application
flow), using a real `LocalRepositoryAdapter` scan of a real temporary
directory on disk (one file: `kind = "agent"` / `modelReference = "gpt-x"` /
`tools = [alpha]`), plus direct `pg_catalog`/`pg_policies` inspection via
`supabase db query --linked` for the grants/RLS proof. The harness script
itself was a throwaway (never committed); all assertions below were
independently re-derived from live query results, not assumed.

| # | Scenario | Result |
|---|----------|--------|
| 1 | Real `LocalRepositoryAdapter` scan completes with status `SUCCEEDED` | PASS |
| 2 | `DiscoveryPipeline` + relationship correlation emit the expected findings (3 object: AGENT/MODEL/TOOL, 2 relationship: USES_MODEL/USES_TOOL) | PASS |
| 3 | Evidence durable in PostgreSQL (`gov_repo.discovery_evidence`, 3 rows) | PASS |
| 4 | SourceAssertions durable (`gov_repo.source_assertions`, 3 rows) | PASS |
| 5 | ReviewSubjects durable (`gov_repo.review_subjects`, 5 rows) | PASS |
| 6 | Eligible subjects reach PROPOSED (5/5 proposals created) | PASS |
| — | Relationship findings entered review (2 RELATIONSHIP review subjects) | PASS |
| 9 | Identical re-scan is idempotent: 0 new review subjects, 0 new proposals, 0 new evidence rows, 0 new assertion rows | PASS |
| 10 | ALREADY_GOVERNED recognized once a canonical mapping is seeded (all 3 object candidates share this fixture's one file-level source identity, matching the real `canonical_object_source_mappings` granularity) | PASS |
| — | Relationship findings still enter review despite fully-governed endpoints | PASS |
| 11 | Another tenant's mapping does not suppress the current tenant's identical finding | PASS |
| 12 | Cross-tenant `getReviewSubject` read fails closed (returns `undefined`) | PASS |
| 13 | Zero machine-created CONFIRMED states across all review subjects | PASS |
| 14 | Zero machine-created CERTIFIED states across all review subjects | PASS |
| 15 | Zero canonical objects created directly by the scan (0 rows for the unseeded tenant) | PASS |
| 16 | Zero canonical relationships created directly by the scan | PASS |
| 17 | No reconciliation bypass (0 `reconciliation_decisions` rows for the unseeded tenant) | PASS |
| 17b | No materialization bypass (0 `materialization_operations` rows for the unseeded tenant) | PASS |
| 18 | One controlled item failure (simulated evidence-recording failure for the AGENT candidate) leaves independent siblings (MODEL, TOOL) valid; both relationships, which depend on AGENT's evidence, correctly cascade-fail closed rather than being silently created incomplete | PASS |

**20/20 runtime checks passed** (0 failures on the final run, after the three
fixes above).

## Tenancy / RLS / Grants Proof (live catalog inspection)

Queried directly against the controlled project via `supabase db query --linked`:

- `has_function_privilege('anon', ..., 'EXECUTE')` = `false` and
  `has_function_privilege('authenticated', ..., 'EXECUTE')` = `false` for all
  four new RPCs (`start_acquisition_run`, `complete_acquisition_run`,
  `record_discovery_evidence`, `record_discovery_source_assertion`);
  `has_function_privilege('service_role', ..., 'EXECUTE')` = `true` for all
  four.
- `pg_class.relrowsecurity` = `true` for all four new tables
  (`acquisition_runs`, `discovery_evidence`, `source_assertions`,
  `source_assertion_evidence`).
- `pg_policies` shows exactly one policy per new table, scoped to
  `{service_role}` only, `cmd = ALL` — no `anon`/`authenticated` policy of
  any kind exists on any of the four tables.

No anon/authenticated Supabase API key was available in this environment, so
a literal PostgREST-level anon/authenticated request was not made; the live
catalog proof above is the direct, authoritative source the PostgREST
authorization decision itself is derived from.

## Idempotency

- `gov_repo.record_discovery_evidence` / `gov_repo.record_discovery_source_assertion`:
  a reused id within the same tenant always replays (verified by the
  identical re-scan producing zero new rows), regardless of the wall-clock
  `captured_at`/`observed_at` differing between the two scans.
- `create_review_subject` (Governance Persistence V1, unmodified): the
  Discovery Intake service reads before ever attempting a create, so an
  already-durable subject is never re-submitted with a new `detected_at` —
  confirmed by the identical re-scan reporting zero new review subjects and
  zero new proposals.

## Rollback / Atomicity

- The one controlled item failure (scenario 18) left the database in a fully
  consistent state: the two other object candidates (MODEL, TOOL) and their
  own evidence/assertions/review subjects/proposals were durably committed
  independently; no partial or half-created row existed for the failed AGENT
  candidate or its two dependent relationships.

## Findings Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 1 (found and fixed — `ON CONFLICT` illegal on a rewrite-rule-protected table) |
| MEDIUM | 1 (found and fixed — table name collision with pre-existing foundational schema) |
| LOW | 1 (found and fixed — hard-gate FK validation against historical test data; resolved via `NOT VALID`, not deletion) |

No structural (architecture-breaking) issue was found; all three were local
and fixed once, in place, without a second adversarial or architecture
review cycle.

## Explicitly Remaining Risks (NOT CLOSED)

1. **No literal anon/authenticated PostgREST request was made** — no anon API
   key was available in this environment. The live `pg_catalog`/`pg_policies`
   proof above is authoritative for what PostgREST itself would enforce, but
   a literal end-to-end HTTP-level denial was not observed in this session.
2. **`gov_repo.review_subject_assertions_assertion_fkey` /
   `review_subject_evidence_evidence_fkey` are `NOT VALID`** — enforced for
   every row from this migration forward, but never validated against the
   controlled project's pre-existing historical rows. A future milestone
   that wants those historical rows to conform (or wants to formally
   `VALIDATE CONSTRAINT`) would first need to either backfill matching
   `source_assertions`/`discovery_evidence` rows for them or explicitly
   accept/document their exclusion.
3. **Outbox delivery worker** — unaffected by this milestone; still out of
   scope, matching Governance Persistence V1's own status.

## Production Non-Authorization

This controlled runtime validation **DOES NOT** authorize production
deployment.

- Production execution requires a separate deployment/migration gate against
  `bbisimozudihadfozyfz`, not performed here
- `bbisimozudihadfozyfz` was untouched throughout this validation
- No production data was accessed
- No credentials were ever printed, logged, staged, or committed
