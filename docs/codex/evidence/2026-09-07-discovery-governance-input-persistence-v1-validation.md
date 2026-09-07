# Discovery Governance Input Persistence V1 — Validation Evidence

Date: 2026-09-07
Status: RUNTIME_PROVEN_FOR_CONTROLLED_ENVIRONMENT

## Starting SHA

Authoritative canonical main at start: `87d9ccae5798d919b65b78311371190efc834e0a`.
The prior branch `feat/reconciliation-materialization-workspace-v1` was confirmed
empty (HEAD == main, zero commits ahead, zero tracked changes) and safely
deleted (local only; no remote copy existed) before this branch was created.

## Architectural Gap Being Solved

`invokeObjectReconciliation` / `invokeRelationshipReconciliation`
(`packages/governance-review/src/reconciliation-invocation.ts`) require the
exact original `DiscoveryFinding` and `NormalizedCandidate` that produced a
CERTIFIED `ReviewSubject`. `gov_repo.review_subjects` (Governance Persistence
V1) intentionally stores only governance references (`finding_id`,
`candidate_kind`, `source_*`, assertion/evidence membership) — never the
finding's or candidate's own governed content (confidence, reviewStatus,
proposedIdentity, relationship endpoints). Before this milestone, that content
existed only in the TypeScript memory of the original Discovery Intake call
and was permanently unrecoverable once that call returned.

## Real Cardinality (research finding, not assumed)

A background contract-mapping pass over `packages/canonical-contracts`,
`packages/governance-review`, `packages/scanner`, and
`apps/dashboard/lib/governance` established that Finding ↔ Candidate is
**1 ↔ (0 or 1)**, not uniformly 1:1:

- **RELATIONSHIP kind**: exactly 1:1, co-generated in one function call
  (`packages/scanner/src/discovery/relationship-correlation.ts`), sharing the
  same content-hash suffix for `candidateId`/`findingId`.
- **OBJECT kinds** (AGENT/MODEL/TOOL/...): 1:0 today — no
  `NormalizedObjectCandidate` producer exists anywhere in this repository.
  `apps/dashboard/lib/governance/discovery-intake.ts` always passes
  `candidate: undefined` for object findings. `invokeObjectReconciliation` /
  `invokeRelationshipReconciliation` are not wired to any live application
  path yet (confirmed by repo-wide grep across `workspace-actions.ts` /
  `workspace-commands.ts`).

This is not a structural contradiction requiring a stop: no currently-working
capability is broken by persisting Candidate as optional, and object
candidate normalization remains explicitly out of scope (a distinct future
milestone). The durable model reflects this real cardinality rather than
fabricating a 1:1 assumption.

## Durable Model

New migration:
`supabase/migrations/20260907120000_discovery_governance_input_persistence_v1.sql`

Tables (all `gov_repo` schema, tenant-scoped by composite `(organisation_id, id)` keys):

- `discovery_findings` — exact `DiscoveryFinding<DiscoveryCandidateKind>` envelope, PK `(organisation_id, finding_id)`.
- `discovery_finding_assertions` / `discovery_finding_evidence` — normalized membership, FK'd into the already-durable `source_assertions` / `discovery_evidence` tables (Discovery Intake V1).
- `discovery_candidates` — exact `NormalizedCandidate` envelope, PK `(organisation_id, candidate_id)`, `UNIQUE (organisation_id, finding_id)` encoding the real current 0-or-1-candidate-per-finding cardinality.
- `discovery_candidate_assertions` / `discovery_candidate_evidence` — normalized membership, same FK discipline.

Both `discovery_findings` and `discovery_candidates` are immutable
(`DO INSTEAD NOTHING` rewrite rules on UPDATE/DELETE), RLS-enabled,
`service_role`-only (no `anon`/`authenticated` policy), matching every prior
migration's established convention exactly.

## Exact Finding/Candidate Contracts Preserved

`envelope jsonb` is the authoritative full domain object on both tables —
`proposedIdentity`, `confidence`, `reviewStatus`, relationship
`sourceEndpoint`/`targetEndpoint`, `assertionIds`, `evidenceIds` are all
persisted unmodified. Relational columns (`candidate_kind`,
`source_connection_id`, `relationship_type_code`, etc.) exist only for
query/integrity-check convenience and are never trusted over the envelope on
read.

`packages/canonical-contracts` has no rehydrator for `DiscoveryFinding` /
`NormalizedCandidate` (unlike the reconciliation-decision family). Following
the exact precedent already established in `apps/dashboard/lib/governance/persistence.ts`
(`rehydrateMergeCandidatesDecision`, written for the same reason), two new
allowlist-validating rehydrators (`rehydrateDiscoveryFinding`,
`rehydrateNormalizedCandidate`) were added to
`apps/dashboard/lib/governance/discovery-intake-persistence.ts` — reject
unknown fields, validate every value, brand every ID, never trust stored JSON
merely because this application wrote it.

## Tenant Strategy

Composite `(organisation_id, finding_id)` / `(organisation_id, candidate_id)`
primary keys throughout, matching Discovery Intake V1's own established
rationale: `findingId`/`candidateId` are scanner-generated content hashes with
no tenant concept, so a bare global PK would risk cross-tenant collision.
Proven live (see Controlled Runtime below): two tenants scanning the
identical fixture produced identical `findingId`s that coexisted as two
distinct, independently-readable rows.

## Envelope / Hash Strategy

Reuses `canonicalStringify` / `sha256Hex` from `persistence.ts` (the sole
existing hashing authority in this codebase) — no second hashing algorithm
introduced. Every read recomputes the hash from the fetched envelope and
rejects a mismatch (`discoveryFindingEnvelopeHash` /
`normalizedCandidateEnvelopeHash`, mirroring `verifyEnvelopeIntegrity`'s
existing discipline).

## ReviewSubject Link

`gov_repo.review_subjects` gains `review_subjects_finding_fkey`, a composite
FK into `discovery_findings`, added `NOT VALID` (enforced for every row
inserted/updated from this migration forward; never requiring this
controlled project's pre-existing historical rows from prior milestones'
runtime validations to retroactively satisfy it). `apps/dashboard/lib/governance/discovery-intake.ts`'s
`ensureReviewSubjectAndPropose` now records the Finding (and Candidate, when
one exists) unconditionally before ever creating or reading a ReviewSubject —
a new ReviewSubject can never durably exist without its backing Finding.

## Legacy Subject Behavior

No backfill was performed or attempted. `packages/governance-review/src/reconciliation-input-recovery.ts`
(`recoverReconciliationInput`) returns a typed `INPUT_UNAVAILABLE` result for
any ReviewSubject with no durable Finding — proven both in the governance-review
unit test suite and live against a synthetic legacy-shaped subject in the
controlled runtime run.

## Idempotency

- **Candidates**: a reused `candidate_id` with an identical `envelope_hash`
  replays; a different hash fails closed (`23514`,
  `DISCOVERY_CANDIDATE_CONFLICT`). A second, distinct `candidate_id` for a
  finding that already has one durable candidate also fails closed
  (`DISCOVERY_CANDIDATE_FINDING_ALREADY_HAS_CANDIDATE`), via the
  `UNIQUE (organisation_id, finding_id)` constraint.
- **Findings**: a reused `finding_id` for the same tenant always replays,
  with **no content comparison** — matching `record_discovery_evidence` /
  `record_discovery_source_assertion`'s own established precedent exactly.
  `findingId` deliberately excludes `detectedAt` from its own identity (it
  hashes only source connection, locator, detection method/version, match
  position/content, and candidateKind), so a legitimate rescan of unchanged
  content reproduces the identical `finding_id` with a different (real,
  later) `detectedAt`. **This exact defect was caught by the existing test
  suite** (see "Defects Found and Fixed" below) before it ever reached
  controlled runtime.

## Relationship Behavior

`NormalizedRelationshipCandidate`'s `relationshipTypeCode`, `sourceEndpoint`,
and `targetEndpoint` (including `referenceKind` discrimination) are persisted
and rehydrated exactly, verified by dedicated round-trip tests and live in
the controlled runtime run (2 relationship candidates, USES_MODEL +
USES_TOOL, both durable with their endpoints intact).

## Controlled Runtime

- Disposable project: `zkqfvqwqdypgpzauzinw` ("ov-ia-g2-test") — confirmed
  `"linked": true` via `supabase projects list` before any write.
  `bbisimozudihadfozyfz` ("gov-ia-dev") confirmed `"linked": false` and never
  touched.
- Migration ledger checked once (`supabase migration list --linked`): only
  `20260907120000_discovery_governance_input_persistence_v1.sql` was pending;
  applied via `supabase db push --linked`.
- Lightweight health check: all 6 new tables confirmed present with
  `relrowsecurity = true`; `has_function_privilege` confirmed
  `anon = false`, `authenticated = false`, `service_role = true` for both new
  RPCs.
- A throwaway `tsx` harness (never committed, matching Discovery Intake V1's
  own precedent) drove the real `runGovernanceDiscoveryScan` application
  service against two fresh, disposable-project-only organisations, using a
  real `LocalRepositoryAdapter` scan of a real temporary directory
  (`kind = "agent"` / `modelReference = "gpt-x"` / `tools = [alpha]`).

| # | Scenario | Result |
|---|----------|--------|
| 1 | Real scan completes SUCCEEDED | PASS |
| 2 | 3 object findings (AGENT/MODEL/TOOL) + 2 relationship findings (USES_MODEL/USES_TOOL) | PASS |
| 3 | 5 durable ReviewSubjects | PASS |
| 4 | 5 durable Findings | PASS |
| 5 | 2 durable Candidates (relationship only — no object candidate producer exists) | PASS |
| 6 | Recovery status matches real cardinality: 2 RELATIONSHIP_INPUT_AVAILABLE, 3 FINDING_ONLY | PASS |
| 9 | Exact replay creates no duplicate Finding/Candidate rows | PASS |
| 10 | Second tenant scanning identical content succeeds with its own 5 findings, no collision | PASS |
| 11 | A never-scanned organisationId cannot read another tenant's Finding | PASS |
| 11b | Two real tenants sharing an identical content-addressed `finding_id` coexist as two distinct rows | PASS |
| 12 | Relationship Finding/Candidate persistence + hash integrity (recompute-on-read) | PASS |
| 13 | Synthetic legacy subject (no durable Finding) recovers `INPUT_UNAVAILABLE`, not fabricated | PASS |
| 14 | Zero machine-created state beyond DETECTED/PROPOSED | PASS |

**13/13 runtime checks passed** on a single clean run (fresh organisations,
zero accumulated state from earlier debugging invocations of the same
harness during development).

No reconciliation, authorization, or materialization RPC was invoked at any
point (this milestone's scope is durability only); no production project was
touched; no credential was printed, echoed, staged, or committed.

## Reconciliation-Continuity Proof (hard success proof)

`packages/governance-review/test/reconciliation-input-recovery.test.ts`
proves, in-process, that `recoverReconciliationInput`'s output typechecks
and is accepted **unchanged** by:

- `invokeRelationshipReconciliation` (RELATIONSHIP_INPUT_AVAILABLE →
  `finding`/`candidate` fields, `CREATE_NEW` HANDOFF_TO decision, `APPLIED`).
- `invokeObjectReconciliation` (OBJECT_INPUT_AVAILABLE → `finding`/`candidate`
  fields, `CREATE_NEW` AGENT decision, `APPLIED`).

Neither gate was weakened; no candidateId was fabricated, no proposedIdentity
reconstructed, no relationship endpoint guessed.

## Defects Found and Fixed (adversarial + test-suite discovered)

One local defect, found by the pre-existing `discovery-intake-service.test.ts`
suite (not the controlled runtime — caught earlier, before reaching it):

1. **Finding replay falsely rejected as a conflict.** The first draft of
   `record_discovery_finding` compared the full `envelope_hash` on a reused
   `finding_id` and rejected any mismatch. `DiscoveryFinding.findingId`
   deliberately excludes `detectedAt` (a real wall-clock field that
   legitimately differs between a rescan and the finding's first
   observation) — exactly like `evidenceId`/`assertionId` already exclude
   their own wall-clock fields. The existing
   `"REVIEW: a non-eligible finding (already reviewed) is left DETECTED"`
   test caught this immediately (`status: "FAILED"` where `"SUCCEEDED"` was
   expected). Fixed by removing the content comparison for findings entirely
   (pure replay on any reused `finding_id`, matching
   `record_discovery_evidence` / `record_discovery_source_assertion`'s own
   already-audited precedent for this exact class of risk) — never applied to
   candidates, which have no wall-clock field and retain strict conflict
   detection.

No structural (architecture-breaking) issue was found. No second adversarial
or architecture-review cycle was run.

## Tests / Typechecks

- `packages/governance-review`: 113/113 tests pass (10 new, covering
  `INPUT_UNAVAILABLE`/`FINDING_ONLY`/`OBJECT_INPUT_AVAILABLE`/`RELATIONSHIP_INPUT_AVAILABLE`,
  every fail-closed substitution/mismatch case, and the reconciliation
  continuity proof). `tsc --noEmit` clean.
- `packages/canonical-contracts`: 83/83 tests pass (untouched; sanity check
  only).
- `apps/dashboard`: 259/259 tests pass (41 new — hash/rehydration round-trip
  and tamper-detection tests, migration static-SQL tests, and end-to-end
  Discovery Intake integration tests proving durable persistence, idempotent
  replay, tenant isolation, and legacy-unavailable behavior against the real
  orchestration code path). `tsc --noEmit` clean.
- `git diff --check`: clean (no whitespace errors).

## Migration Hash

- File: `supabase/migrations/20260907120000_discovery_governance_input_persistence_v1.sql`
- SHA-256 of file content: `fbb810980403b1983768fc994e4f16990c6bfe0cb68c818ad481307c1c909612`
- Git blob hash (`git hash-object`): `78d0f880ae9b4cec62381d2a0f93f91ef51b5668`

## Build Baseline Exception

`npm run build` in `apps/dashboard` compiles successfully (all changed/new
code, including this milestone's, type-checks and bundles cleanly) and fails
only at static-prerender time for the pre-existing, known, unrelated
`/graph` route:

```
Error: Seems like you have not used zustand provider as an ancestor.
```

This is the documented pre-existing baseline exception (see
`docs/codex/evidence/2026-09-07-governance-workspace-v1-validation.md` and
prior evidence docs) and is not a regression introduced by this milestone.

## Production Deployment Status

**Not deployed.** No production migration was applied. `bbisimozudihadfozyfz`
was never touched at any point in this milestone.

## Next Product Milestone

Reconciliation & Materialization Workspace V1 is now unblocked: a CERTIFIED
ReviewSubject's original Finding/Candidate can be durably recovered and fed
unchanged into the existing `invokeObjectReconciliation` /
`invokeRelationshipReconciliation` gates. Object-candidate normalization
(giving `invokeObjectReconciliation` a real, discovery-produced
`NormalizedObjectCandidate` for AGENT/MODEL/TOOL/etc.) remains a distinct,
unstarted future milestone.
