# Evidence: Gov IA CIA Implementation Conformance & Reuse Audit V1

**Date:** 2026-09-08
**Architecture ID:** `GOVIA-L0L16-CIA-v1.0` (unchanged)
**Audited main SHA:** `732a3379a53482ee7cb9f483e5ad8f35bab26f9c`
**Type:** Read-only engineering conformance & reuse audit. No feature development.

## Base gate

- `git fetch origin` — clean.
- Local `main` == `origin/main` == `732a3379a53482ee7cb9f483e5ad8f35bab26f9c`.
- Current branch: `main` (audit performed before branching).
- Working tree: clean except the explicitly-allowed untracked `codex-recovery-6101-6240.txt`,
  which was not read or touched.
- `.claude/` was never read, staged, modified, or deleted.
- `8d72e46` was never inspected, referenced, or promoted — remains QUARANTINED.

## Method

1. Read all four architecture documents in full (`GOVIA-L0L16-CIA-v1.0.md`, `-roadmap.md`,
   `-coverage.md`, `ADR-GOVIA-L0L16-CIA-v1.0.md`).
2. Inventoried top-level repository structure (`packages/`, `apps/`, `supabase/`, `docs/`,
   `graphos-complete/`).
3. Confirmed via `git log --all --oneline --decorate`, `git branch --merged/--no-merged main`,
   and `git merge-base --is-ancestor` that `promote/discovery-validation-lab` (PR #6) and
   `promote/canonical-contracts-v1a1` (PR #5) are already ancestors of `main` — corroborating the
   audit's starting premise that Golden Repositories and canonical contracts are already merged,
   not future work.
4. Dispatched five parallel, independent read-only research passes (each with explicit
   file:line evidence requirements and the audit's classification vocabulary):
   - Discovery Validation Lab + Golden Repositories deep audit
   - Discovery Engine current state + object-kind/relationship capability matrix
   - Canonical contracts + governance persistence/materialization + Governance Workspace UI
   - GraphOS/Graph + Vector + LLM audit
   - L10–L16 audit (connectivity, authorization, runtime, cross-signal reconciliation,
     governance controls, risk, drift)
5. Performed the git-history reuse audit directly (branch diffs, ancestor checks) rather than via
   subagent, since the answers were fully derivable from local git metadata.
6. Synthesized all findings into the True Gap Register, Reuse Register, Do-Not-Rebuild Register,
   and Roadmap Reconciliation.
7. Conformance review against the audit's own 20-point checklist (§30 of the audit prompt) before
   writing final documents.

## Targeted test execution (read-only, each run at most once, per audit's cost-control directive)

- `npm run test:validation-lab` (scoped to `packages/scanner`) — **9 suites / 51 tests, 0
  failures.**
- `npm run test:discovery-engine` (scoped to `packages/scanner`) — **13 suites / 92 tests, 0
  failures.**

No other test suites were rerun; prior evidence in `docs/codex/evidence/*` was cited instead
where applicable. No Supabase runtime was accessed. No dashboard build was run (not required to
resolve any ambiguity encountered).

## Key findings (see the two companion documents for full detail)

1. **Golden Repositories and the Discovery Validation Lab are real, complete, and tested** —
   confirmed live, not from memory or documentation. They must not be rebuilt. The only gap is a
   missing adapter connecting the Lab's oracle/metrics pipeline to real `DiscoveryPipeline`
   output, plus the absence of a saved baseline snapshot file.
2. **Canonical contracts match the frozen architecture's closed taxonomies exactly** — 11 object
   kinds, 12 relationship types, endpoint constraints — with zero deviation found. (One naming
   note: the endpoint matrix is `RELATIONSHIP_ENDPOINT_CONSTRAINTS`, module-private, not the
   `RELATIONSHIP_ENDPOINT_RULES` name informally used in prior planning references — content is
   identical.)
3. **Only MODEL and TOOL reach full canonical materialization today.** AGENT detection exists but
   its candidate-normalization strategy unconditionally fails closed by explicit design. **Zero
   of the twelve governed relationship types reach materialization** — not because the
   persistence/materialization RPCs are incomplete (they are fully built for all twelve), but
   because every relationship type requires an `AGENT_VERSION` or `DATA_ELEMENT` source endpoint,
   and neither kind has a production identity normalizer. The dashboard UI already knows this and
   fails closed honestly (explicit REJECT/DEFER-only UX with in-context explanation), rather than
   offering a silent dead end.
4. **`AGENT_VERSION` has zero implementation anywhere in `packages/scanner/src`** — this is the
   confirmed root gap, independently corroborated by three separate research passes.
5. **New finding not previously documented**: the authoritative Graph route
   (`apps/dashboard`'s `/graph`) projects only a separate, pre-canonical table set
   (`gov_repo.agents`, `agent_edges`, `ai_systems`, …) and never reads
   `gov_repo.canonical_objects` / `canonical_relationships` at all. Even the MODEL/TOOL objects
   that already reach full materialization are invisible everywhere outside the Governance
   Workspace review-detail page.
6. **Correction to `GOVIA-L0L16-CIA-v1.0-coverage.md`'s L7 verdict**: pgvector infrastructure is
   not `NOT_IMPLEMENTED` — it is real, enabled, and actively used for a Talk-to-Governance RAG
   chat feature (`coding_memory` table, populated and queried). It is not, however, the
   architecturally-required canonical-object embedding capability L7 describes — a separate
   `agent_embeddings` table exists for that shape but has no writer anywhere in the repository.
   This nuance did not exist in the prior coverage pass and is material to correctly scoping
   roadmap milestone 4.
7. **Data Intelligence (DataAsset/DataElement) is golden-fixture-only.** Real production
   detector code has zero SQL/DDL/dbt/schema parser; the one existing legacy heuristic is dead
   code (never reaches persisted output).
8. **Historical git branches contain no unique reusable work.** `feat/p1.0.2-*`,
   `feat/p1.0.3-*`, and `audit/baseline-gov-ia` are all superseded duplicates of work already
   merged into `main` via the corresponding `promote/*` branches. No cherry-pick is recommended.
9. **LLM output never writes to a canonical table** — explicitly verified end-to-end; the "LLM
   OUTPUT != CANONICAL TRUTH" invariant is respected everywhere checked.
10. **Governance Workspace, ReviewSubject lifecycle, reconciliation, and materialization are all
    real, transactional, idempotent, and optimistic-concurrency-protected** at the database
    layer — confirmed by direct migration reads, not documentation claims.

## Recommended next development milestone

Roadmap milestone 2, **AGENT IDENTITY & VERSION DISCOVERY V1** — the smallest root capability
that unlocks the largest amount of already-built, currently-idle downstream architecture
(relationship correlation, persistence, materialization, Governance Workspace, Passport families
1 and 7) without duplicating any existing work. Roadmap milestone 1 (Golden Repositories &
Discovery Baseline V2) is rescoped to a small, independent recertification task (adapter +
one-time baseline snapshot) rather than a standalone development milestone, since the Lab and
Goldens themselves require no rebuilding. Full reasoning in
`GOVIA-L0L16-CIA-v1.0-implementation-conformance.md` §22–23.

## Conformance self-review (against the audit's own 20-point checklist)

All 20 items in the audit prompt's §30 were satisfied: all L0–L16 audited; all 16 Passport
families audited; Canonical/Graph/Vector/LLM kept separate; AGENT != AGENT_VERSION preserved
throughout; behavior bindings confirmed AGENT_VERSION-sourced in contracts (and confirmed
AGENT-sourced, incorrectly relative to the target, in current production code — flagged as a
gap, not silently accepted); lineage audited as its own first-class section; DataElement grain
preserved (column/field/nested-path distinction maintained, not collapsed into asset-level
claims); Evidence/Provenance audited; trust states not conflated; Scanner ceiling confirmed to
remain `PROPOSED` in contracts (and narrower than that in the DB, which was flagged); current
implementation was never inferred from architecture docs alone — every claim traces to a file,
line, migration, or passing test; historical code was never counted as current implementation;
test-only capability (the Lab) was not counted as production until its production-wiring gap was
explicitly separated out; legacy GraphOS (`packages/graphos`, `graphos-complete`) was not counted
as current canonical implementation; app auth was not counted as Agent AuthZ; design-time was not
counted as runtime anywhere (L12 correctly `NOT_IMPLEMENTED`); Vector documentation references
were not counted as Vector implementation (only actual pgvector schema/RPC code was cited);
reusable work was identified and registered; duplicate future work was identified and removed
from the reconciled roadmap (milestones 1 and 12 rescoped).

## Files changed

- `docs/architecture/GOVIA-L0L16-CIA-v1.0-implementation-conformance.md` (new)
- `docs/architecture/GOVIA-L0L16-CIA-v1.0-reuse-register.md` (new)
- `docs/codex/evidence/2026-09-08-govia-cia-implementation-conformance-audit-v1.md` (new, this file)

No source code, migrations, dependencies, or lockfiles were changed. `GOVIA-L0L16-CIA-v1.0.md`
and `ADR-GOVIA-L0L16-CIA-v1.0.md` were not modified.

## Verdict

`GOVIA_CIA_IMPLEMENTATION_CONFORMANCE_AUDITED_AND_READY`
