# Object Candidate Normalization V1 — Validation Evidence

Date: 2026-09-07
Status: RUNTIME_PROVEN_FOR_CONTROLLED_ENVIRONMENT

## Starting SHA

Authoritative canonical main at start: `e3a73bb00c221bb5b97a64e9a063d1b583d21f8c`
(local main == origin/main, no tracked changes).

## Mission Recap

Discovery Governance Input Persistence V1's own evidence document
(`docs/codex/evidence/2026-09-07-discovery-governance-input-persistence-v1-validation.md`)
identified this milestone's exact gap: `apps/dashboard/lib/governance/discovery-intake.ts`
always passed `candidate: undefined` for OBJECT-kind findings because no
`NormalizedObjectCandidate` producer existed anywhere in the repository. This
milestone closes that gap **at the Discovery semantic boundary only** —
scanner produces the candidate, nothing downstream is redesigned.

## Current Production Object Kinds (research finding, not assumed)

`apps/dashboard/lib/governance/discovery-intake.ts`'s `runGovernanceDiscoveryScan`
wires exactly three `DetectionSpecification`s into the live `DiscoveryPipeline`:

```
AgentKindDeclarationSpecification   -> candidateKind AGENT
ModelReferenceDeclarationSpecification -> candidateKind MODEL
ToolListDeclarationSpecification    -> candidateKind TOOL
```

No other `CanonicalObjectKind` (AGENT_VERSION, MCP_SERVER, API, PROMPT,
KNOWLEDGE_BASE, SKILL, DATA_ASSET, DATA_ELEMENT) has a detector anywhere in
`packages/scanner/src/discovery/`. Only AGENT/MODEL/TOOL were in scope for a
real normalization strategy; every other kind fails closed by construction
(no registered strategy — see Fail-Closed Design below).

## Object Normalization Map

### AGENT — NOT_SAFELY_NORMALIZABLE

- Finding evidence: `AgentKindDeclarationSpecification` (`packages/scanner/src/discovery/strategies/agent-kind-declaration.ts`)
  matches the structural line `kind = "agent"` / `kind: "agent"`. Its
  `DetectionMatch.displayValue` is **always the fixed literal `"agent"`**
  (`() => 'agent'`), never a captured name, code, or version — proven by the
  detector's own doc comment ("purely syntactic... proves nothing about
  runtime behavior") and by a dedicated test that scans a file with a nearby
  class name (`class SupportAgent:`) and asserts `displayValue` is still
  exactly `"agent"`.
- Normalized subtype: `NormalizedAgentCandidate` — `proposedIdentity: { agentCode?, displayName?, versionCode? }`.
- Deterministic proposedIdentity available today: **none**.
- Candidate status: **NOT_SAFELY_NORMALIZABLE** (`reasonCode: AGENT_IDENTITY_NOT_DERIVABLE`).
  Producing a candidate with every `proposedIdentity` field absent would be
  semantically meaningless per the runbook's own rule ("do not create a
  candidate merely to make reconciliation callable") — so AGENT fails closed
  rather than fabricating an empty identity.

### MODEL — NORMALIZABLE

- Finding evidence: `ModelReferenceDeclarationSpecification` (`.../strategies/model-reference-declaration.ts`)
  captures the literal inside `MODEL_REFERENCE = "..."` / `modelReference: "..."`
  directly into `displayValue` via its own capture group — the detector's
  entire purpose, per its doc comment, is "to capture the declared literal."
- Normalized subtype: `NormalizedModelCandidate` — `proposedIdentity: { modelReference?, displayName? }`.
- Deterministic proposedIdentity: `modelReference = displayValue.trim()` (non-empty required).
  `displayName` has no source and is left absent.
- Candidate status: **NORMALIZABLE**.

### TOOL — NORMALIZABLE

- Finding evidence: `ToolListDeclarationSpecification` (`.../strategies/tool-list-declaration.ts`)
  emits one `displayValue` per bare identifier inside an explicit
  `tools = [...]` / `tools: [...]` array-literal binding — deliberately
  narrow (quoted strings, prose mentions, and non-identifier items never
  match at all).
- Normalized subtype: `NormalizedToolCandidate` — `proposedIdentity: { declarationKey?, displayName? }`.
- Deterministic proposedIdentity: `declarationKey = displayValue.trim()` (non-empty required).
  `displayName` has no source and is left absent.
- Candidate status: **NORMALIZABLE**.

## Architecture

New module: `packages/scanner/src/discovery/object-candidate-normalization.ts`
(exported from both `packages/scanner/src/discovery/index.ts` and
`packages/scanner/src/index.ts`, matching every other Discovery Engine export).

```
DiscoveryCandidate (finding + assertion + evidence + displayValue)
  -> normalizeObjectCandidate()
  -> { status: "NORMALIZED", candidate: NormalizedObjectCandidate }
     | { status: "NOT_SAFELY_NORMALIZABLE", candidateKind, reasonCode }
```

Strategy pattern, one class per currently-produced kind
(`AgentCandidateNormalizationStrategy`, `ModelCandidateNormalizationStrategy`,
`ToolCandidateNormalizationStrategy`), dispatched by a `Map<CanonicalObjectKind, Strategy>`.
No speculative strategy exists for a kind no detector produces; `RELATIONSHIP`
is defensively rejected by the dispatcher even though the type system already
routes relationship candidates through the separate, unmodified
`RelationshipCorrelationStrategy`.

Only one call site changed: `apps/dashboard/lib/governance/discovery-intake.ts`'s
`processObjectCandidate` now calls `normalizeObjectCandidate(candidate)` and
passes the result's `candidate` (or `undefined` for `NOT_SAFELY_NORMALIZABLE`)
into the existing `ensureReviewSubjectAndPropose` — previously always
`undefined`. No other file in `packages/governance-review`,
`apps/dashboard/lib/governance/discovery-intake-persistence.ts`, or
`apps/dashboard/lib/governance/reconciliation-input.ts` required a code
change: all three were already fully generic over object-vs-relationship
candidates (confirmed by reading each before writing any code). Only their
stale doc comments ("no NormalizedObjectCandidate producer exists yet") were
updated for accuracy.

## Candidate ID Strategy

Single shared helper, `buildObjectCandidateId(kind, findingId)`, used by both
the MODEL and TOOL strategies:

```
candidate:<kind-lowercased>:<sha256(JSON.stringify([findingId, kind])).slice(0,32)>
```

- Deterministic and wall-clock-free (no `detectedAt`/`observedAt` input).
- No random UUID.
- Derived from `DiscoveryFinding.findingId`, which is itself already a stable
  hash of source connection, locator, detection method/version, match
  span, and `candidateKind` (`evidence-assembly.ts`) — so a candidateId can
  never collide across different findings, different kinds (findingId's own
  hash already folds in `candidateKind`), or two files that happen to share
  an identical `displayValue` (findingId also folds in the locator).
- No `organisationId`/tenant input — candidateId remains scanner/domain
  generated; tenancy is applied externally via the `organisation_id` column,
  exactly like the existing relationship candidate ID convention.
- Relationship candidate ID code (`relationship-correlation.ts`) was not
  touched; its own `stableSuffix` helper was not extracted or shared, since
  doing so was not required to implement this milestone and the runbook
  requires exact backward compatibility proof for any such refactor. All
  existing relationship tests remain green unmodified (see Relationship
  Non-Regression below).

## Confidence

No second confidence system was introduced. Every normalized candidate reuses
`candidate.finding.confidence` (the specification's own detection confidence)
verbatim — proven by a dedicated FINDING <-> CANDIDATE INTEGRITY test.

## Finding <-> Candidate Integrity

For every `NORMALIZED` result: `candidate.findingId === finding.findingId`,
`candidate.candidateKind === finding.candidateKind`,
`candidate.sourceObject === finding.sourceObject` (same reference),
`candidate.assertionIds`/`evidenceIds` are exactly `finding.assertionIds`/`evidenceIds`
(same content, no new IDs invented), and `candidate.requiresReconciliation === true`
always. Proven by unit test and by the controlled-runtime run (recovered
candidate's `assertionIds`/`evidenceIds` accepted unchanged by
`recoverReconciliationInput`'s own subset-of-finding invariant check).

## Unsupported Normalization

`{ status: "NOT_SAFELY_NORMALIZABLE", candidateKind, reasonCode }` is a typed,
non-error, non-persisted outcome. `apps/dashboard/lib/governance/discovery-intake.ts`
passes no candidate downstream for it; the Finding still proceeds through
`ensureReviewSubjectAndPropose` unchanged (ReviewSubject created, proposed to
`PROPOSED` under `PASS_THROUGH_V1`, exactly as before this milestone). No
database persistence was added for the unsupported outcome itself — only the
already-existing Finding-only path is exercised. Recovery for such a subject
remains `FINDING_ONLY`, proven both in unit tests and live in the controlled
runtime run (the AGENT subject).

## Discovery Pipeline / Discovery Intake Integration

`packages/scanner`'s `DiscoveryPipeline`, `evidence-assembly.ts`, and
`relationship-correlation.ts` were **not modified** — `normalizeObjectCandidate`
is a separate, additive function consumed directly by the composition layer
(`discovery-intake.ts`), the same pattern `RelationshipCorrelationStrategy`
already established. `DiscoveryCandidate`'s shape is unchanged.

`apps/dashboard/lib/governance/discovery-intake.ts`'s only functional change:

```diff
- await ensureReviewSubjectAndPropose(finding, undefined, acquisitionRunId, ctx, ports, tally, "object");
+ const normalization = normalizeObjectCandidate(candidate);
+ const normalizedCandidate = normalization.status === "NORMALIZED" ? normalization.candidate : undefined;
+ await ensureReviewSubjectAndPropose(finding, normalizedCandidate, acquisitionRunId, ctx, ports, tally, "object");
```

## Persistence Reuse

Confirmed by reading (not assuming) `apps/dashboard/lib/governance/discovery-intake-persistence.ts`
and the previous milestone's migration
(`supabase/migrations/20260907120000_discovery_governance_input_persistence_v1.sql`):
`recordNormalizedCandidate`/`getNormalizedCandidateForFinding`,
`rehydrateNormalizedCandidate`'s `proposedIdentity` allowlist (already
includes `modelReference` and `declarationKey`), and the
`discovery_candidates` table's `candidate_family = 'OBJECT'` check constraint
(which does **not** require `proposed_identity is not null`, unlike the
`RELATIONSHIP` branch) all already fully support MODEL/TOOL object candidates
with zero schema or adapter changes. **No new migration was created or
required.**

## Object Input Recovery

`packages/governance-review/src/reconciliation-input-recovery.ts`'s
`recoverReconciliationInput` required no changes — it was already fully
generic over any `NormalizedObjectCandidate`. Recovery outcomes now proven
live for real production data:

- MODEL / TOOL (normalized): `OBJECT_INPUT_AVAILABLE`, recovered
  finding/candidate pair identical to the authoritative persisted rows.
- AGENT (not safely normalizable): `FINDING_ONLY`.
- Pre-milestone/legacy subject: `INPUT_UNAVAILABLE` (unchanged, existing test
  coverage untouched).

## Reconciliation Continuity Proof (hard success proof)

`apps/dashboard/tests/object-candidate-reconciliation-continuity.test.ts`
(new) drives, in-process, a **real** `LocalRepositoryAdapter` +
`DiscoveryPipeline` scan for MODEL and for TOOL through
`normalizeObjectCandidate` → `createReviewSubject` → `propose` → `confirm` →
`certify` → `recoverReconciliationInput` (`OBJECT_INPUT_AVAILABLE`) →
`invokeObjectReconciliation`, asserting `kind: "APPLIED"` for a `CREATE_NEW`
decision in both cases. `invokeObjectReconciliation` itself
(`packages/governance-review/src/reconciliation-invocation.ts`) was not
modified in any way — no optional candidate was added, no `requestedDecision`
was fabricated, no authorization was bypassed (a real
`ReconciliationAuthorizationPort` implementation is still required and
consulted).

## Relationship Non-Regression

`packages/scanner/src/discovery/relationship-correlation.ts` was not
modified. All 31 existing relationship correlation tests
(`USES_MODEL` + `USES_TOOL` suites in
`packages/scanner/test/discovery-engine/relationship-correlation.test.ts`)
remain green unmodified, plus the full pre-existing Discovery Intake /
Discovery Governance Input Persistence dashboard test suite's relationship
assertions (`RELATIONSHIP_INPUT_AVAILABLE`, stable relationship candidateId,
unchanged endpoints) — all still pass. Live in the controlled runtime run:
both `USES_MODEL`/`USES_TOOL` relationship candidates persisted and recovered
exactly as before this milestone.

## Authority Ceiling

`normalizeObjectCandidate` and its strategies are pure functions: they never
call `confirm`, `certify`, `authorize`, `invokeObjectReconciliation`, or any
materialization function (proven by a static source-text test asserting none
of those tokens appear in the module). The dashboard's own pre-existing
static adversarial test (`discovery-intake-service.test.ts`) continues to
pass, confirming `discovery-intake.ts` itself still never references
confirm/certify/reject or any authorization/reconciliation/materialization
RPC. Machine authority ceiling remains `PROPOSED`, proven live (every
controlled-runtime `ReviewSubject.state` was `DETECTED` or `PROPOSED`, never
higher) and via the unchanged unit test suite.

## Static / Domain Tests (new)

- `packages/scanner/test/discovery-engine/object-candidate-normalization.test.ts`
  (26 tests): NORMALIZATION MAP (real detector output for AGENT/MODEL/TOOL),
  DETERMINISM (same candidateId/proposedIdentity across independent scans,
  pure-function repeatability, wall-clock independence), SEMANTIC CHANGE
  (changed model reference / different Tool declarations / candidateId never
  collides across kinds / identical display label in two files never
  collapses), FAIL CLOSED (AGENT never fabricates identity even with a nearby
  class name; unsupported/dormant kind — MCP_SERVER — fails closed;
  RELATIONSHIP misrouted to the object dispatcher fails closed; whitespace-only
  displayValue fails closed for both MODEL and TOOL), FINDING<->CANDIDATE
  INTEGRITY, AUTHORITY CEILING (static source-text check), and strategy-class
  parity with the dispatcher.
- `apps/dashboard/tests/object-candidate-reconciliation-continuity.test.ts`
  (2 tests): the hard continuity proof described above, for MODEL and TOOL.
- `apps/dashboard/tests/discovery-intake-service.test.ts` updated (not
  reopened as a milestone): its Discovery Governance Input Persistence V1
  describe block now asserts the real post-milestone behavior — 4 durable
  candidates (MODEL + TOOL + USES_MODEL + USES_TOOL; AGENT has none, still
  correctly `FINDING_ONLY`) instead of the pre-milestone 2 (relationships
  only).

## Adversarial Pass (run exactly once)

All 26 items from the runbook's adversarial checklist were considered; the
ones with real applicability to this deterministic, single-field-promotion
design were directly tested:

| # | Scenario | Outcome |
|---|----------|---------|
| 1 | Same display label, two different files | Distinct candidateId (findingId folds in locator) — tested |
| 2 | Same source, changed semantic identifier | New finding+candidate (findingId folds in displayValue) — inherited from existing architecture, not a new risk |
| 3 | candidateId collision across kinds | Tested — never collides |
| 4 | candidateId collision across findings | Prevented by findingId's own existing uniqueness (pre-existing, unmodified) |
| 7 | Injected displayValue | By design for MODEL/TOOL (detector's own contract); AGENT never promotes it |
| 8/9 | Empty / whitespace-only identity | Tested — NOT_SAFELY_NORMALIZABLE for both MODEL and TOOL |
| 12 | Windows slash/backslash instability | Unaffected — inherited from unmodified `LocalRepositoryAdapter`/`evidence-assembly.ts` |
| 13-15 | Locator/evidence/assertion substitution | Unaffected — candidate reuses the finding's own arrays by reference, no new ID invented |
| 16-18 | candidateKind substitution / object-with-relationship-fields / relationship-routed-to-object | Tested — dispatcher rejects RELATIONSHIP; static typing prevents cross-shape fields |
| 19-20 | Unsupported/dormant kind silently normalized | Tested — MCP_SERVER (dormant) fails closed |
| 21-24 | Candidate directly causes CONFIRMED/CERTIFIED/reconciliation/materialization | Tested — static source-text check; pure-function design makes this structurally impossible |
| 25 | Changed payload reuses same candidateId | Tested — changed `MODEL_REFERENCE` literal changes both proposedIdentity and candidateId |
| 26 | Tenant info embedded in scanner identity | Verified by design — `buildObjectCandidateId` takes no organisationId parameter at all |

No structural contradiction was found. No second adversarial cycle was run.

## Controlled Runtime (run exactly once)

- **Authorized disposable project only**: `zkqfvqwqdypgpzauzinw` ("ov-ia-g2-test"),
  confirmed `"linked": true` via `supabase projects list` before any write.
  `bbisimozudihadfozyfz` ("gov-ia-dev") confirmed `"linked": false` and never
  touched (also defensively guarded in the harness itself: it refuses to run
  if `SUPABASE_URL` contains the forbidden project ref, and requires it
  contain the authorized one).
- Migration ledger checked once (`supabase migration list --linked`): all 44
  local migrations already applied remotely, including
  `20260907120000_discovery_governance_input_persistence_v1.sql` (the
  prerequisite candidate-persistence migration). **No new migration was
  pushed** (none was created).
- Lightweight health check: `supabase projects list` confirmed both the
  authorized and forbidden projects' exact linked status before any write.
- A throwaway `.mts` harness (never committed — deleted immediately after the
  run; confirmed absent from `git status` afterward) drove the real
  `runGovernanceDiscoveryScan` application service against the disposable
  project, using a real `LocalRepositoryAdapter` scan of a real temporary
  directory (`kind = "agent"` / `modelReference = "gpt-x"` / `tools = [alpha]`),
  across three fresh, disposable-project-only organisations.

| # | Scenario | Result |
|---|----------|--------|
| 1-4 | Real scan SUCCEEDED; real Finding emitted; normalization invoked; real candidate emitted | PASS |
| 5 | MODEL/TOOL candidateId is deterministic-shaped (`candidate:<kind>:<digest>`) | PASS |
| 6 | proposedIdentity is evidence-backed (`modelReference: "gpt-x"`, `declarationKey: "alpha"`) | PASS |
| 7 | 5 durable Findings (AGENT/MODEL/TOOL + USES_MODEL/USES_TOOL) | PASS |
| 8 | 4 durable Candidates (MODEL, TOOL, USES_MODEL, USES_TOOL — AGENT has none) | PASS |
| 9 | 5 durable ReviewSubjects | PASS |
| 10 | Exactly 2 `OBJECT_INPUT_AVAILABLE` (MODEL, TOOL) | PASS |
| 11-12 | Recovered Finding/Candidate for MODEL and TOOL match authoritative rows exactly | PASS |
| 13 | Unchanged re-scan creates no duplicate Finding/Candidate/ReviewSubject rows | PASS |
| 14 | AGENT (unsupported) recovers `FINDING_ONLY`, not fabricated | PASS |
| 15 | Cross-tenant isolation: a never-scanned org cannot read another tenant's Finding; an independently-scanning second tenant gets its own 5 rows with no collision | PASS |
| 16 | Relationship path remains `RELATIONSHIP_INPUT_AVAILABLE` (2 of 2) | PASS |
| 17 | Every ReviewSubject state is `DETECTED` or `PROPOSED`, never higher | PASS |
| 18 | Zero `reconciliation_decisions` rows for these orgs (no reconciliation auto-invoked) | PASS |
| 19 | Zero `authorization_decisions` rows for these orgs (no authorization auto-invoked) | PASS |
| 20 | Production project (`bbisimozudihadfozyfz`) never touched | PASS (guarded + never referenced) |

**23/23 runtime checks passed** on the final run (one earlier iteration's
harness-level assertion bug — see Defects Found below — was fixed before this
count).

## Defects Found and Fixed

One defect, found in the harness itself (not in the shipped implementation)
during the controlled runtime run:

1. **Harness test-bug, not a product defect.** The first draft of the
   tenant-isolation check re-scanned the identical fixture under a *second*
   tenant (ORG B) and then asserted ORG B could not read ORG A's finding by
   id — but ORG B had legitimately produced its own row under the same
   content-addressed `finding_id` (correct, expected behavior, matching the
   prior milestone's own documented finding that two tenants sharing an
   identical `finding_id` correctly coexist as two distinct rows). Fixed by
   introducing a third organisation that never scans anything, and asserting
   *it* cannot read ORG A's finding — the correct tenant-isolation proof.
   Re-ran the full harness once after the fix (23/23 PASS). No second
   controlled-runtime cycle was run; this was a fix-and-rerun within the same
   single pass.

No structural or shipped-code defect was found.

## Tests / Typechecks / Build

- `packages/scanner`: 92/92 discovery-engine tests pass (26 new), 51/51
  validation-lab tests pass (untouched, sanity check). `tsc --noEmit` clean
  for both `tsconfig.discovery-engine.json` and `tsconfig.validation-lab.json`.
- `packages/governance-review`: 113/113 tests pass (untouched — sanity
  check only, since no source file in this package changed behavior, only
  doc comments). `tsc --noEmit` clean.
- `packages/canonical-contracts`: 83/83 tests pass (untouched). `tsc --noEmit` clean.
- `apps/dashboard`: 261/261 tests pass (2 new continuity tests; 1 existing
  describe block updated to assert the new real behavior). `npx tsc --noEmit`
  clean.
- `git diff --check` (staged milestone changes only): clean, no whitespace errors.

## Database / Migration Status

**No new migration was created.** The previous milestone's
`discovery_candidates` table and `record_discovery_candidate` /
`recordNormalizedCandidate` / `getNormalizedCandidateForFinding` machinery
already fully support OBJECT-family candidates (including MODEL/TOOL's
`proposedIdentity` shapes) with zero schema change, confirmed both by reading
the migration and by the controlled runtime run persisting real MODEL/TOOL
candidates against it successfully.

## Known /graph Baseline Exception

`npm run build` in `apps/dashboard` compiles and type-checks all
changed/new code successfully and fails only at static-prerender time for the
pre-existing, unrelated `/graph` route:

```
Error: Seems like you have not used zustand provider as an ancestor.
```

This is the documented pre-existing baseline exception (see
`docs/codex/evidence/2026-09-07-discovery-governance-input-persistence-v1-validation.md`
and earlier evidence docs) and is not a regression introduced by this
milestone.

## Production Deployment Status

**Not deployed.** No production migration was applied or required.
`bbisimozudihadfozyfz` was never touched at any point in this milestone.

## What This Milestone Unblocks

- A CERTIFIED MODEL or TOOL ReviewSubject's original Finding and real,
  evidence-backed NormalizedObjectCandidate can now be durably recovered and
  fed **unchanged** into the existing `invokeObjectReconciliation` gate —
  proven both in-process and live against the disposable project. This path
  is now technically unblocked for MODEL and TOOL.
- A CERTIFIED AGENT ReviewSubject still recovers as `FINDING_ONLY` — its
  Finding is durable, but no trustworthy `NormalizedAgentCandidate` identity
  exists in current evidence to normalize. This is a deliberate, correct
  fail-closed outcome, not a gap left by oversight.
- Reconciliation & Materialization Workspace V1 (explicitly out of scope for
  this milestone) can now be built on top of a real object-candidate
  continuity chain for MODEL/TOOL; AGENT (and every other CanonicalObjectKind)
  remains gated behind a future detector that can prove a real, deterministic
  identity — never invented here.

## Next Product Milestone

**Reconciliation & Materialization Workspace V1** — now unblocked for
RELATIONSHIP, MODEL, and TOOL kinds (AGENT remains `FINDING_ONLY` until a
future detector proves a real AGENT identity signal, e.g. an explicit agent
code/name declaration — a distinct, out-of-scope future milestone, not
something to retrofit here).
