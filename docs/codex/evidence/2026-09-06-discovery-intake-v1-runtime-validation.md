# Discovery Intake V1 — Validation Evidence

Date: 2026-09-06
Status: STATIC_AND_UNIT_VALIDATED — CONTROLLED RUNTIME NOT EXECUTED (environment lacked Supabase access)

## Purpose

Record what was actually done to connect the existing Discovery Engine
(`packages/scanner`) to the existing Governance Review persistence boundary
(`packages/governance-review`, Governance Persistence V1, Canonical
Materialization V1) without letting machine discovery bypass human authority.

## Authoritative Starting State

- Authoritative starting `main` SHA: `56cd1b7f41f3afd6c1a5dd8d6b528b48fe312166`
- Feature branch: `feat/discovery-intake-v1`
- Local `main` == `origin/main` == the SHA above at branch creation; working
  tree had no tracked changes (only the explicitly-excluded `.claude/` and
  `codex-recovery-6101-6240.txt`, neither touched or staged).

## Environment Constraint (read this before the rest)

This session's environment has **no Supabase CLI installed** and **no
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`** configured. Unlike the prior
Governance Persistence V1 / Canonical Materialization V1 milestones (see the
sibling evidence docs in this directory, produced from a different
environment that did have live access to the disposable project
`zkqfvqwqdypgpzauzinw`), this session could not:

- apply `20260906180000_discovery_intake_v1.sql` to any real Postgres
  instance,
- run the RPCs (`start_acquisition_run`, `complete_acquisition_run`,
  `record_discovery_evidence`, `record_discovery_source_assertion`) against
  real Postgres semantics (rule-level immutability, RLS, concurrency, ON
  CONFLICT behavior),
- perform the "one lightweight PostgREST/Data API health check," or
- execute the controlled end-to-end runtime matrix (Section 21 of the
  originating instructions).

No runtime evidence for this milestone is fabricated here. Everything below
is exactly what was executed: static SQL structure checks, and unit/
integration tests using the real scanner discovery engine wired to
in-memory fakes of the persistence ports (no live database).

**Production deployment is not authorized. Applying this migration to any
Supabase project is a decision for a session/operator with the required
credentials, still gated by the same controlled-project-only rule
(`zkqfvqwqdypgpzauzinw` only, never `bbisimozudihadfozyfz`).**

## Architecture Summary

```
Trusted GovernanceExecutionContext (organisationId: OrganisationId)
        |
LocalRepositoryAdapter (packages/scanner, unmodified detection logic)
        |
DiscoveryPipeline.run() -> { run: AcquisitionRun, candidates: DiscoveryCandidate[] }
        |
RelationshipCorrelationStrategy.correlate(candidates, observedAt)
        |
apps/dashboard/lib/governance/discovery-intake.ts (NEW composition service)
        |  - per object candidate: recordEvidence -> recordSourceAssertion
        |    -> findActiveObjectSourceMapping (read-only) -> [ALREADY_GOVERNED | ensureReviewSubjectAndPropose]
        |  - per relationship candidate: ensureReviewSubjectAndPropose (no already-governed check)
        |
GovernanceReviewPersistencePort / MaterializationPersistencePort / DiscoveryIntakePersistencePort
  (packages/governance-review — interfaces only, zero Supabase/scanner dependency)
        |
apps/dashboard/lib/governance/{persistence,materialization,discovery-intake-persistence}.ts
  (server-only Supabase adapters, existing two + one new)
        |
gov_repo.* (Postgres, service_role only)
```

`packages/scanner` gained **zero** new dependencies (still depends only on
`@council/canonical-contracts`); it does not know `governance-review` or
Supabase exist. `packages/governance-review` gained **zero** new
dependencies either (still depends only on `@council/canonical-contracts`).
The only new cross-cutting file is `apps/dashboard/lib/governance/
discovery-intake.ts`, which is where scanner types and governance-review
types are allowed to meet — exactly where `persistence.ts` and
`materialization.ts` already meet Supabase.

## Durable Evidence Home

**DURABLE EVIDENCE HOME: MISSING — MINIMAL EXTENSION REQUIRED** (confirmed
during inspection; Governance Persistence V1 persisted only EvidenceId /
SourceAssertionId membership, never the Evidence/SourceAssertion content
itself, and no AcquisitionRun table existed at all).

Filled by new migration `supabase/migrations/20260906180000_discovery_intake_v1.sql`:

- `gov_repo.acquisition_runs` — durable AcquisitionRun + executive scan counts (the one mutable table added, mirroring `review_subjects`' own role)
- `gov_repo.evidence` — durable, immutable Evidence content
- `gov_repo.source_assertions` — durable, immutable SourceAssertion content
- `gov_repo.source_assertion_evidence` — normalized evidence membership per assertion

**Hard gate**: the migration adds composite FKs from the existing (untouched)
`gov_repo.review_subject_assertions.assertion_id` and
`gov_repo.review_subject_evidence.evidence_id` into the new
`gov_repo.source_assertions` / `gov_repo.evidence` tables. `gov_repo.
create_review_subject` (Governance Persistence V1, never redesigned) can
therefore never durably succeed for an assertionId/evidenceId that is not
itself already a durable row.

## Tenant Scoping Correction (found during implementation, fixed before any test was written against it)

`evidenceId` / `assertionId` are scanner-generated content hashes
(`packages/scanner/src/discovery/evidence-assembly.ts`) that include no
organisation concept at all — the scanner package is intentionally
tenant-agnostic. A first draft of the migration gave `gov_repo.evidence` /
`gov_repo.source_assertions` a bare `evidence_id` / `assertion_id` primary
key, which would have let two different tenants scanning structurally
identical content collide on the identical id and silently share a row.
Fixed before merge by making the primary keys composite —
`(organisation_id, evidence_id)`, `(organisation_id, assertion_id)`, and
`(organisation_id, assertion_id, evidence_id)` for the membership table —
so two tenants reusing the same tenant-agnostic id get independent rows.

## Local Defect Found and Fixed (via the unit/integration test suite, not live runtime)

**Wall-clock idempotency conflict on every rescan.** `Evidence.capturedAt`,
`SourceAssertion.observedAt/recordedAt`, and `DiscoveryFinding.detectedAt`
are all real wall-clock timestamps, while `evidenceId`/`assertionId`/
`findingId` are content-addressed hashes that deliberately exclude them. A
first draft of `discovery-intake.ts` always attempted `createReviewSubject`
and `recordEvidence`/`recordSourceAssertion` with the current scan's fresh
timestamps; because the closed `gov_repo.create_review_subject` RPC treats
`detected_at` as identity-bearing content (a mismatch is `23505`, not a
replay), re-scanning byte-identical content on a real database would have
raised a conflict on every single rescan instead of a clean idempotent
no-op — directly violating the idempotent-re-scan requirement. This was
caught by the `discovery-intake-service.test.ts` suite (not live runtime):

1. **ReviewSubject** — fixed by reading (`getReviewSubject`) before ever
   attempting `createReviewSubject`; a genuine first sighting still creates
   normally, but an existing subject is never re-submitted with a new
   timestamp.
2. **Evidence / SourceAssertion** — these two RPCs are new and owned by this
   migration (unlike `create_review_subject`), so the correct fix was in the
   RPCs themselves: `record_discovery_evidence` / `record_discovery_source_
   assertion` now treat any id reused within the same tenant as a pure,
   unconditional replay (first insert wins; no content comparison), since
   the id itself already proves the semantically meaningful content is
   identical.

Both fixes are reflected directly in the committed migration file and
`discovery-intake.ts`; no historical migration was touched.

## Real Discovery Used

`packages/scanner`'s actual `LocalRepositoryAdapter` + `DiscoveryPipeline` +
`AgentKindDeclarationSpecification` + `ModelReferenceDeclarationSpecification`
+ `ToolListDeclarationSpecification` + `RelationshipCorrelationStrategy` ran
against a real temporary directory on disk (created with `mkdtemp`, one file
declaring `kind = "agent"` / `modelReference = "gpt-x"` / `tools = [alpha]`),
producing real, evidence-backed `DiscoveryCandidate`s and
`RelationshipCorrelationResult`s — no scanner behavior was mocked or
stubbed. Only the final persistence layer (Supabase) was replaced with
in-memory fakes, since no live database was reachable in this environment.

## Test Results (all executed, none fabricated)

| Suite | Result |
|---|---|
| `packages/canonical-contracts` tests | 83/83 pass |
| `packages/canonical-contracts` typecheck | clean |
| `packages/governance-review` tests | 102/102 pass |
| `packages/governance-review` typecheck | clean |
| `packages/scanner` discovery-engine tests | 73/73 pass |
| `packages/scanner` discovery-validation-lab tests | 51/51 pass |
| `packages/scanner` typecheck (full package + discovery-engine tsconfig) | clean |
| `apps/dashboard` tests (all suites, including 3 new Discovery Intake files) | 162/162 pass |
| `apps/dashboard` typecheck | clean |
| `git diff --check` | clean |

**Total: 471/471 tests passing across all four affected packages.**

New Discovery Intake tests specifically:

- `discovery-intake-migration.test.ts` — static SQL structure (preflight,
  table/FK/RLS/grant shape, RPC SECURITY INVOKER + search_path, ON CONFLICT
  pragma placement, no destructive statements, identifier length limits,
  tenant-scoped composite PKs).
- `discovery-intake-persistence-domain.test.ts` — pure envelope-hash
  determinism for Evidence/SourceAssertion.
- `discovery-intake-service.test.ts` — real scanner + in-memory fakes:
  REAL DISCOVERY end-to-end (3 object + 2 relationship candidates all reach
  PROPOSED), non-eligible/already-advanced subjects left untouched,
  idempotent re-scan (no duplicate subjects/proposals/evidence/assertions),
  ALREADY_GOVERNED recognition and relationship non-suppression, tenant
  isolation of the source-mapping lookup, failure isolation (with correct
  cascade to dependent relationships), adversarial proof that
  authorization/reconciliation/materialization ports are never invoked
  (they throw unconditionally and no failure surfaced), a static source-text
  check that `discovery-intake.ts` never references
  `confirm(`/`certify(`/`reject(` or any authorization/reconciliation/
  materialization write RPC, forged-organisationId cross-tenant read
  denial, and findingId-reuse-with-different-content fail-closed behavior.

## Adversarial Review (one pass, per the 25-item checklist)

Covered by the new test suite directly: forged organisationId (type-level —
`OrganisationId` is a branded opaque type, no HTTP surface exists in this
milestone to forge it through), evidence/assertion from another tenant
(tenant-scoped composite keys), findingId reuse with changed semantics
(explicit adversarial test, fails closed), same scan replay and reordered
traversal (idempotent re-scan test; scanner-level ordering already
deterministic and tested), source mapped to another tenant (tenant
isolation test), machine CONFIRM/CERTIFY attempts and scanner->canonical
object/relationship/reconciliation bypass (adversarial test with
unconditionally-throwing fakes for every forbidden port method, plus a
static source-text check), partial persistence failure and duplicate
proposal audit (failure isolation / idempotent re-scan tests).

Covered by existing, unmodified, already-passing scanner tests (not
re-audited, per the instructions not to re-audit closed Discovery Engine
architecture): `.git`/`node_modules`/`.govia-lab` traversal, path escape,
Windows path semantics (this session ran on Windows throughout, including
every new test).

Not applicable at this milestone's trust boundary: hash/fingerprint
substitution (envelope_hash is always server-computed from the actual
envelope being written, never accepted as an independent caller-supplied
parameter, so there is no substitution surface); malformed evidence
envelope from an untrusted source (no HTTP route exists in this milestone;
the only caller of `runGovernanceDiscoveryScan` is trusted server code).
UNC path behavior was not exercised — it is not part of the existing,
documented `LocalRepositoryAdapter` contract.

No structural (architecture-breaking) issue was found. Both defects above
were local and were fixed once, in place, without a second adversarial
cycle.

## Regression

All four packages' existing test suites (governance-review, canonical-
contracts, scanner discovery-engine + discovery-validation-lab, dashboard's
full existing suite including auth/signup/login/governance-persistence/
canonical-materialization tests) were re-run after every change and remain
green — see the table above.

## Controlled End-to-End Runtime

**NOT EXECUTED.** See "Environment Constraint" above. No claim is made that
the migration has been proven against real PostgreSQL/PostgREST, real RLS
enforcement, or real concurrency. The migration was authored to mirror the
exact patterns (SECURITY INVOKER, explicit `search_path`, `#variable_conflict
use_column` before `ON CONFLICT`, RLS + revoke/grant, immutability rules)
that Governance Persistence V1 and Canonical Materialization V1 already
proved live in `zkqfvqwqdypgpzauzinw`, and its own static SQL tests
(`discovery-intake-migration.test.ts`) check for the same structural
invariants those two migrations' own static tests check for — but this is
not a substitute for actually applying it.

## Production Deployment Status

Not deployed. Not authorized. `bbisimozudihadfozyfz` was never referenced or
touched by any command in this session.

## Outstanding Before Merge

A session or operator with `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (or
the Supabase CLI linked) for the disposable project `zkqfvqwqdypgpzauzinw`
must:

1. Apply `20260906180000_discovery_intake_v1.sql`.
2. Run (at minimum) the functional matrix items this milestone's
   originating instructions specify in Section 21 — real
   `LocalRepositoryAdapter` scan, durable evidence/assertions/review
   subjects, PROPOSED transitions, idempotent re-scan, ALREADY_GOVERNED
   recognition, tenant isolation, and confirmation that no CONFIRMED/
   CERTIFIED/canonical-object/canonical-relationship row is ever created by
   this flow — against the real database.
3. Record the result in a follow-up evidence document (or an update to this
   one) before the PR is merged.
