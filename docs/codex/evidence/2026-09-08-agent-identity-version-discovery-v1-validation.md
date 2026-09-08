# Agent Identity & Version Discovery V1 — Validation Evidence

**Architecture ID:** `GOVIA-L0L16-CIA-v1.0` (FROZEN BASELINE — unchanged by this milestone)
**Base main SHA:** `4cfe1a4ff2378c61a88f99973e66293072e35503`
**Branch:** `feat/agent-identity-version-discovery-v1`
**Date:** 2026-09-08

---

## 1. Base main SHA

`4cfe1a4ff2378c61a88f99973e66293072e35503` (PR #22 merge — `docs(architecture): audit CIA implementation conformance` — includes the corrected conformance audit, commit `56ed531`, as an ancestor).

## 2. Branch

`feat/agent-identity-version-discovery-v1`, branched from `main` at the SHA above.

## 3. Frozen architecture ID

`GOVIA-L0L16-CIA-v1.0`. Not modified. `docs/architecture/GOVIA-L0L16-CIA-v1.0.md`, `ADR-GOVIA-L0L16-CIA-v1.0.md`, `-roadmap.md`, `-coverage.md`, `-implementation-conformance.md`, and `-reuse-register.md` are all byte-identical to the base SHA (`git diff --name-only` confirms none of them appear in this branch's diff).

## 4. Scope

Roadmap milestone 2, **AGENT IDENTITY & VERSION DISCOVERY V1**, per `GOVIA-L0L16-CIA-v1.0-roadmap.md` and Gap G-02 of the prior conformance audit (`GOVIA-L0L16-CIA-v1.0-implementation-conformance.md` §9, §20). Implements:

1. Evidence-backed, deterministic **AGENT** logical identity (previously failed closed unconditionally).
2. Evidence-backed, deterministic **AGENT_VERSION** technical-revision identity as a distinct, correlation-derived discovery object kind (previously had zero implementation anywhere in `packages/scanner/src`).

No other roadmap milestone, layer, or subsystem was touched.

## 5. Files changed

Modified:
- `packages/scanner/src/discovery/strategies/agent-kind-declaration.ts` — AGENT detection now captures the enclosing Python `class Name:` / TS-JS `const name = {...}` declaration name as evidence, falling back to the generic literal `"agent"` when none is found.
- `packages/scanner/src/discovery/object-candidate-normalization.ts` — `AgentCandidateNormalizationStrategy` now normalizes when real declaration-name evidence exists, still fails closed on the generic literal or blank value.
- `packages/scanner/src/discovery/index.ts`, `packages/scanner/src/index.ts` — export the new `agent-version-correlation` module.
- `apps/dashboard/lib/governance/discovery-intake.ts` — wires `AgentVersionCorrelationStrategy` into `runGovernanceDiscoveryScan`, processing correlated AGENT_VERSION candidates through the existing `ensureReviewSubjectAndPropose` boundary (same DETECTED→PROPOSED machine ceiling as every other candidate kind).
- `packages/scanner/test/discovery-engine/object-candidate-normalization.test.ts` — updated/added AGENT normalization tests.
- `apps/dashboard/tests/discovery-intake-service.test.ts` — added AGENT/AGENT_VERSION governance-continuity tests.

Added:
- `packages/scanner/src/discovery/agent-version-correlation.ts` — new `AgentVersionCorrelationStrategy` / `correlateAgentVersions`.
- `packages/scanner/test/discovery-engine/agent-version-correlation.test.ts` — new focused test suite.
- This evidence document.

No file under `docs/architecture/**`, `.claude/**`, `supabase/migrations/**`, or `codex-recovery-6101-6240.txt` was read, staged, modified, or inspected.

## 6. AGENT identity rule

**AGENT = the name of the source declaration that structurally encloses a `kind = "agent"` marker**, when one exists:

- Python: the nearest enclosing `class Name:` (or `class Name(Base):`) whose indentation is strictly less than the `kind = "agent"` line's indentation, found by walking backward from that line and narrowing the search to progressively shallower indentation (a standard nearest-enclosing-indentation-block algorithm — deterministic, single-artifact, no AST).
- TypeScript/JavaScript: the nearest enclosing `(export )?(const|let|var) name = {` object-literal opening, found the same way.
- The captured name is promoted **verbatim** (no humanization, no casing changes) to `NormalizedAgentCandidate.proposedIdentity.agentCode`.
- `displayName` and `versionCode` are left absent — no evidence for either currently exists.

This mirrors exactly how MODEL (`MODEL_REFERENCE = "..."` literal) and TOOL (`tools = [...]` bare identifier) already promote their own detector's captured literal directly to identity — no new evidence category was invented, only the same "detector's own contract explicitly defines the matched value as the identifier" pattern already documented in `object-candidate-normalization.ts`'s module doc comment.

## 7. AGENT identity evidence hierarchy actually implemented

1. Enclosing Python `class Name:` declaration name (evidence: `agent-kind-declaration` detector, confidence 0.6, `INFERRED` trust).
2. Enclosing TypeScript/JavaScript `const/let/var name = {...}` object-literal declaration name (same detector/confidence/trust).
3. No other evidence tier exists today. No framework-specific parser, no explicit `agentId`/`name` field, no config-file identity was added — those would be new detectors, out of scope (Section 18 no-scope-creep).

## 8. AGENT fail-closed conditions

- No enclosing declaration found (bare `kind = "agent"` at file scope, or inside an unrecognized construct) → `displayValue` stays the generic literal `"agent"` → `AGENT_IDENTITY_NOT_DERIVABLE`.
- The enclosing declaration's own name, case-insensitively, equals the literal `"agent"` (e.g. `class Agent:`) → still treated as unresolved generic value → `AGENT_IDENTITY_NOT_DERIVABLE` (guards the one edge case where a real declaration name coincides with the fallback sentinel).
- Blank/whitespace-only displayValue → `AGENT_IDENTITY_NOT_DERIVABLE`.

## 9. AGENT_VERSION identity rule

AGENT_VERSION is **not** produced by any single `DetectionSpecification` (no detector observes "a version" directly). It is a **correlation product**, exactly like a governed relationship: `AgentVersionCorrelationStrategy` / `correlateAgentVersions` (new module `agent-version-correlation.ts`) groups already-produced `DiscoveryCandidate`s by source artifact (same file-grouping rule `relationship-correlation.ts` already uses) and, per file:

1. Requires exactly one AGENT candidate in that file, and that candidate must itself normalize (`normalizeObjectCandidate` → `NORMALIZED`). Zero, more-than-one, or an unidentifiable AGENT yields no AGENT_VERSION for that file.
2. Requires at least one correlated MODEL or TOOL candidate in the same file that itself normalizes (Minimum evidence rule, §13 below). An AGENT with no correlated technical signal yields no AGENT_VERSION even though its own AGENT candidate may normalize independently.
3. Derives a deterministic `findingId`/`candidateId` from **two deliberately separate inputs, combined only at the last step**:
   - a purely semantic **technical revision fingerprint** — a canonical, sorted, deduplicated projection of the parent AGENT's normalized `agentCode` + every correlated MODEL `modelReference` + every correlated TOOL `declarationKey` (§10);
   - a **source scope** identity — the parent AGENT's own `SourceObjectIdentity` (`connectionId` + `externalType` + `externalId`) only, never a line number, never a `findingId` (§10).
4. Sets `proposedIdentity: { agent: { referenceKind: "SOURCE_OBJECT", sourceObject: <agent's source object>, candidateKind: "AGENT" } }` — `versionCode` is always absent.

**Correction (post-review, this document's current revision):** an earlier revision of this milestone folded the parent AGENT's own `DiscoveryFinding.findingId` directly into the technical-revision fingerprint to prevent cross-file/cross-tenant collisions. External review correctly identified this as conflating **provenance/record identity** (which `evidence-assembly.ts` already makes sensitive to the *matched declaration's line position*, not just its content) with **technical revision** (which must be a statement about *what the Agent is technically bound to*, never *where/when that binding was observed*). Concretely: inserting an unrelated comment or blank line above a `kind = "agent"` declaration shifts that line's own `findingId` without changing anything agent-relevant, which would have incorrectly produced a new AGENT_VERSION. This has been corrected — see §10 below for the fixed design, and §22/§23 for the regression tests and re-verification.

## 10. AGENT_VERSION_FINGERPRINT_INPUTS

```
TECHNICAL_REVISION_INPUTS = [
  "agent-code:<parent AGENT's normalized proposedIdentity.agentCode>",
  "model:<normalized MODEL proposedIdentity.modelReference>"   // one per correlated MODEL, sorted + deduplicated
  "tool:<normalized TOOL proposedIdentity.declarationKey>"     // one per correlated TOOL, sorted + deduplicated
]
technicalRevisionFingerprint = sha256(canonicalize(TECHNICAL_REVISION_INPUTS))[0:32]

SOURCE_SCOPE_INPUTS = [
  "<parent AGENT's own SourceObjectIdentity.connectionId>",
  "<parent AGENT's own SourceObjectIdentity.externalType>",
  "<parent AGENT's own SourceObjectIdentity.externalId>"
]
sourceScope = sha256(canonicalize(SOURCE_SCOPE_INPUTS))[0:32]

AGENT_VERSION_FINGERPRINT_INPUTS = [sourceScope, technicalRevisionFingerprint]
findingId/candidateId suffix = sha256(canonicalize(AGENT_VERSION_FINGERPRINT_INPUTS))[0:32]
```

**`TECHNICAL_REVISION_INPUTS` is deliberately semantic-only** — it contains no `findingId`, no `sourceObject`/locator, no line number, no timestamp, and no candidate-traversal-order dependency. Cross-file/cross-tenant collision protection is instead the exclusive responsibility of `sourceScope`, which is derived only from the AGENT's own `SourceObjectIdentity` (file/connection identity), **never** a line number or `findingId` — two occurrences of the exact same enclosing declaration in the exact same file remain the same source scope even if an unrelated edit elsewhere in that file shifts where the matched `kind = "agent"` line sits. `sourceScope` and `technicalRevisionFingerprint` are combined only in the final `findingId`/`candidateId` suffix — never merged earlier or elsewhere. Everything is sorted and deduplicated before hashing (`sha256`, first 32 hex chars), so traversal order and duplicate declarations never change either input.

### Contract-precision check

`NormalizedAgentVersionCandidate.proposedIdentity` (`packages/canonical-contracts/src/contracts.ts:1908-1914`) has exactly two fields: `agent: PreCanonicalObjectReference<"AGENT">` (required) and `versionCode?: string` (optional). There is **no field for a derived technical-revision value**. `versionCode` is confirmed to be reserved for an **explicit, declared** version string — it is the identical field name and shape on `NormalizedAgentCandidate.proposedIdentity` (`contracts.ts:1899-1906`), confirming it is a generic "explicit declared version, if one was observed" slot, not a derived-hash slot; overloading it with a fabricated/derived hash would violate "no fabricated version" and was correctly avoided. The frozen contract's own doc comment (`contracts.ts:1090-1094`) states that true `TechnicalFingerprint`-pinned binding/revision tracking is intentionally deferred to a **future**, post-canonicalization stage — `AgentVersionTechnicalProfile.behaviorFingerprint` (`contracts.ts:1104-1112`) already models this, but it is populated after canonicalization (roadmap milestone 3, "Agent Technical Profile — L4 Round 1"), not by this Discovery-stage candidate. Given no explicit field exists and none may be invented (`canonical-contracts` was not modified), this module expresses the technical-revision distinction the same way every other Discovery-stage candidate kind (AGENT, MODEL, TOOL) already expresses its own deterministic identity: through the candidate's own `findingId`/`candidateId`, never inside `proposedIdentity`. This is **not** a violation of "RECORD ID != SEMANTIC VERSION IDENTITY" in the sense of hiding a *semantically expressible* value in an opaque id — no such semantic field exists to hide it in; it is the same pattern MODEL's `candidateId` (deterministic from its own detected content) and TOOL's `candidateId` already use. **Verdict: no architecture decision required** — this is a confirmed, intentional V1A.1d contract boundary, not a gap this milestone can or should close by modifying `canonical-contracts`.

## 11. CHANGES_THAT_CREATE_NEW_AGENT_VERSION

```
CHANGES_THAT_CREATE_NEW_AGENT_VERSION = [
  "the correlated MODEL's declared modelReference literal changes",
  "a correlated TOOL declaration is added or removed",
  "a correlated TOOL's declarationKey identifier changes",
  "the parent AGENT's own enclosing declaration name (agentCode) changes",
  "the parent AGENT's source artifact is renamed/moved, or scanned under a different SourceConnection (changes sourceScope)"
]
```

## 12. CHANGES_THAT_DO_NOT_CREATE_NEW_AGENT_VERSION

```
CHANGES_THAT_DO_NOT_CREATE_NEW_AGENT_VERSION = [
  "an edit to an unrelated file elsewhere in the scan (README, docs, other agents)",
  "an unrelated candidate detected in a different source artifact during the same scan",
  "an unrelated comment, blank-line insertion, or other formatting change within the SAME source artifact that shifts the matched declaration's own line position (and therefore the parent AGENT's own DiscoveryFinding.findingId) without changing agentCode or any correlated Model/Tool evidence — corrected in this revision, see §9",
  "the declared order of Model/Tool identifiers within the same file",
  "a duplicate declaration of the exact same Tool identifier (deduplicated via Set before hashing)",
  "a repeated identical scan of the same, unchanged repository",
  "the wall-clock time of the scan"
]
```

## 13. AGENT_VERSION fail-closed conditions

- Zero, or more than one, AGENT candidate in the same file (ambiguous parent).
- The AGENT candidate does not itself normalize (generic/blank identity).
- Zero correlated MODEL or TOOL candidates in the same file (no version-relevant technical evidence beyond the AGENT's own logical identity).
- Endpoint candidates observed under inconsistent source connections (defensive check, mirrors relationship correlation's own).

In every fail-closed case, no AGENT_VERSION candidate, finding, or ReviewSubject is produced — never a placeholder or fabricated default.

## 14. Evidence / provenance behavior

- AGENT: retains the finding's own `assertionIds`/`evidenceIds` (the single `agent-kind-declaration` detection's assertion/evidence), unchanged shape from before this milestone.
- AGENT_VERSION: its `DiscoveryFinding.assertionIds`/`evidenceIds` are the deduplicated union of the parent AGENT's and every correlated MODEL/TOOL's own assertion/evidence ids — no new Evidence/SourceAssertion rows are created for AGENT_VERSION itself; it reuses what was already made durable for its constituent candidates, exactly as relationship correlation already does for `USES_MODEL`/`USES_TOOL`. Confirmed by `apps/dashboard/lib/governance/discovery-intake.ts`'s `processAgentVersionCandidate`, which never calls `recordEvidence`/`recordSourceAssertion`.
- `confidence` for AGENT_VERSION is the minimum confidence across the AGENT and every correlated MODEL/TOOL (same pattern as relationship correlation).

## 15. Trust-state behavior

Unchanged. Every AGENT and AGENT_VERSION `SourceAssertion` remains `TRUST_STATE.INFERRED` (`evidence-assembly.ts`, untouched by this milestone). Neither this milestone's detector change nor the new correlation module writes or reads trust state at all — trust state is fixed once, at assertion-assembly time, before either module runs.

## 16. SourceConnection/tenant boundary behavior

- AGENT candidateId/findingId already embed `connectionId` + artifact locator (existing `evidence-assembly.ts` behavior, unchanged) — two identical declarations in different files, or under different SourceConnections, never share an identity (proven by test: "two declarations with an identical class name in two different files never collapse into the same candidate").
- AGENT_VERSION derives its own `sourceScope` fingerprint component from the parent AGENT's `SourceObjectIdentity` (`connectionId` + `externalType` + `externalId` — never a line number or `findingId`, see §10), and defensively rejects any file bucket whose correlated candidates span more than one `connectionId` (mirrors `relationship-correlation.ts`'s own defensive check).
- Tenant (`organisationId`) isolation is enforced entirely at the persistence layer (`apps/dashboard/lib/governance/discovery-intake.ts`, `discovery-intake-persistence.ts`), identical to how MODEL/TOOL/RELATIONSHIP already isolate tenants — this milestone introduced no new tenant-scoping logic and did not touch that layer's tenant checks. The existing "TENANT ISOLATION" tests in `discovery-intake-service.test.ts` (unmodified) still pass.

## 17. Governance continuity proven

`apps/dashboard/tests/discovery-intake-service.test.ts`'s new describe block, "Agent Identity & Version Discovery V1: AGENT and AGENT_VERSION governance continuity", proves end-to-end, using a real `LocalRepositoryAdapter` scan and in-memory fakes of the governance persistence ports (no Supabase):

```
Discovery evidence (kind="agent" inside a real class, + a correlated Model/Tool)
  -> DiscoveryFinding<AGENT>            (durable)
  -> NormalizedObjectCandidate<AGENT>   (durable, NORMALIZED)
  -> ReviewSubject (DETECTED -> PROPOSED, via the existing PassThroughSemanticProposalStrategy)
  -> recoverReconciliationInput -> OBJECT_INPUT_AVAILABLE
  -> deriveReconciliationReadiness(CERTIFIED, ...) -> ready: true

  -> DiscoveryFinding<AGENT_VERSION>            (durable, correlation-derived)
  -> NormalizedObjectCandidate<AGENT_VERSION>   (durable, NORMALIZED)
  -> ReviewSubject (DETECTED -> PROPOSED)
  -> recoverReconciliationInput -> OBJECT_INPUT_AVAILABLE
  -> deriveReconciliationReadiness(CERTIFIED, ...) -> ready: true
```

No change was required to `packages/governance-review` or to `apps/dashboard/lib/governance/discovery-intake-persistence.ts` — both already handled every `CanonicalObjectKind` including `AGENT`/`AGENT_VERSION` generically (the persistence layer even already had an explicit `proposedIdentity.agent` required-field check for `AGENT_VERSION`, laid down as dormant groundwork before this milestone). The only change to `discovery-intake.ts` was wiring `AgentVersionCorrelationStrategy` into the existing per-object processing loop via the exact same `ensureReviewSubjectAndPropose` boundary every other candidate kind already uses.

## 18. Confirmation: Discovery Engine still has no live production trigger

`grep -rn "runGovernanceDiscoveryScan" apps/dashboard/app/` returns zero matches on this branch. `runGovernanceDiscoveryScan`'s only callers remain its own test files (`apps/dashboard/tests/discovery-intake-service.test.ts`). No route, cron, worker, or script was added or modified to invoke it.

## 19. Confirmation: relationship semantics unchanged

`packages/scanner/src/discovery/relationship-correlation.ts` has **zero diff** on this branch (`git diff --name-only` does not list it). `USES_MODEL`/`USES_TOOL` correlation remains `AGENT`-sourced (not `AGENT_VERSION`-sourced) exactly as before — that migration is explicitly frozen out of scope for this milestone (roadmap milestone 6, "AgentVersion Behavior Relationships — L9"). All 33 existing relationship-correlation tests pass unmodified.

## 20. Confirmation: Golden Repositories / Validation Lab unchanged

Zero diff under `packages/scanner/test/discovery-validation-lab/**` (harness, contracts, golden-repositories). 51/51 Validation Lab tests still pass (see §22). Golden Repository fixture source files (`.py`/`.ts` content) were read only, to confirm the new declaration-key extraction produces the exact `declarationKey` values the Lab's own `expected.json` oracles already document for `01-simple-agent` (`CustomerSupportAgent`) and `02-multi-agent` (`billingAgent`, `triageAgent`, `retentionAgent`) — never modified.

## 21. Confirmation: no migration/Supabase/production access occurred

`git status --short supabase/` is empty. No `supabase` CLI, RPC, or database connection was invoked at any point in this milestone. All governance-continuity testing used in-memory fake ports (`FakeIntakePersistence`, `FakeReviewPersistence`, `FakeMaterializationPersistence`), the same pattern the pre-existing `discovery-intake-service.test.ts` already established.

## 22. Tests executed + results

| Suite | Command | Result |
|---|---|---|
| Scanner discovery-engine (unit) | `npm run test:discovery-engine` (packages/scanner) | **120/120 passing** (was 92 pre-milestone; +26 in the original milestone pass, +2 more in the post-PR-#23 provenance/technical-revision correction: TEST A line-shift regression, TEST B real-technical-change regression) |
| Scanner discovery-engine typecheck | `npm run typecheck:discovery-engine` | clean, no errors |
| Scanner full package typecheck | `npm run typecheck` (packages/scanner) | clean, no errors |
| Discovery Validation Lab | `npm run test:validation-lab` (packages/scanner) | **51/51 passing**, unchanged — not rerun after the correction (unaffected suite, per the correction's narrow validation scope) |
| governance-review (unit) | `npm run test` (packages/governance-review) | **113/113 passing**, unchanged — not rerun after the correction (unaffected package) |
| governance-review typecheck | `npm run typecheck` (packages/governance-review) | clean, no errors — not rerun after the correction |
| Dashboard targeted governance tests | `node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/discovery-intake-service.test.ts tests/reconciliation-readiness.test.ts` (apps/dashboard) | **25/25 passing** after the original milestone pass; **17/17 re-confirmed** for `discovery-intake-service.test.ts` alone after the correction (its AGENT_VERSION governance-continuity test exercises the real, now-corrected `AgentVersionCorrelationStrategy`) |
| Dashboard workspace typecheck | `npx tsc --noEmit -p tsconfig.json` (apps/dashboard) | clean, no errors |
| `git diff --check` | repo root | clean, no whitespace errors (re-verified after the correction) |

No Golden Repository / Validation Lab suite was modified; no full historical audit, Supabase runtime, production DB test, deployment, or load test was run, per the milestone's controlled-validation scope.

## 23. Adversarial review result

**Original milestone pass** (one review pass performed over the full diff before finalizing tests, per the milestone's required adversarial checklist):

- **A/B (identity collision / instability):** No accidental collision or instability found for AGENT (findingId already source/locator-scoped). **Confirmed a real defect for AGENT_VERSION**: the initial fingerprint design used only `agentCode + model/tool identities`, which meant two unrelated Agents in different files sharing the same declaration name and technical evidence would have collapsed into the same AGENT_VERSION identity. **Fixed at the time** by folding the parent AGENT's own `findingId` into the fingerprint projection before any candidate was normalized/persisted, verified by a dedicated regression test.
- **C/D (unrelated change / relevant change):** Verified both directions with dedicated tests; no defect found at the time.
- **E (traversal order):** Verified; no defect found.
- **F (tenant/connection collision):** Verified; no defect found.
- **G (generic label as identity):** Verified; the case-insensitive generic-value guard was added specifically to close this.
- **H (fabricated version):** Verified; `versionCode` is structurally never set anywhere in this milestone's code.
- **I (authority ceiling):** Verified.
- **J (relationship semantics):** Verified unchanged.
- **K (production trigger):** Verified absent.
- **L (governance bypass):** Verified absent.

**Post-PR-#23 external review (this document's current revision):** external review of PR #23 correctly identified that the A/B fix above — folding `findingId` (a *provenance/record* identity, already sensitive to matched-line position per `evidence-assembly.ts`) directly into the *technical-revision* fingerprint — reintroduced a different defect: an unrelated comment/blank-line insertion above a `kind = "agent"` declaration, in the same file, would shift that declaration's own `findingId` and therefore incorrectly produce a **new** AGENT_VERSION even though nothing agent-relevant changed. This violates the explicit milestone invariant "unrelated/non-agent-relevant change must not create a new AGENT_VERSION." **Fixed** by separating the two concerns cleanly (§9/§10): a purely semantic `technicalRevisionFingerprint` (never touches findingId/locator/line-number/timestamp) combined, only in the final id, with a `sourceScope` derived from the AGENT's own stable `SourceObjectIdentity` (file/connection identity, not line-sensitive) — which still fully preserves the original A/B collision protection (proven by the existing cross-file collision test, re-verified unchanged) while additionally proving the new correction with two dedicated regression tests (TEST A: line-shift produces the same AGENT_VERSION identity; TEST B: a real Model-reference change produces a different one). A companion contract-precision check (§10) confirmed no existing canonical-contracts field was available to hold the technical-revision value explicitly, and that `canonical-contracts` correctly was not modified to invent one.

No further review cycle was needed after this correction: the diff was re-inspected once and no new blocker was found.

## 24. Exact final diff scope

**Original milestone commit (`f52c1f1`):**

```
 apps/dashboard/lib/governance/discovery-intake.ts                    | 45 +++++++-
 apps/dashboard/tests/discovery-intake-service.test.ts                | 106 ++++++++++++++++++
 packages/scanner/src/discovery/agent-version-correlation.ts          | new file
 packages/scanner/src/discovery/index.ts                              | 3 +
 packages/scanner/src/discovery/object-candidate-normalization.ts     | 48 +++++---
 packages/scanner/src/discovery/strategies/agent-kind-declaration.ts  | 79 ++++++++++++-
 packages/scanner/src/index.ts                                        | 2 +
 packages/scanner/test/discovery-engine/agent-version-correlation.test.ts | new file
 packages/scanner/test/discovery-engine/object-candidate-normalization.test.ts | 124 +++++++++++++++++++--
```

**Follow-up correction commit (surgical, PR #23 review response):**

```
 docs/codex/evidence/2026-09-08-agent-identity-version-discovery-v1-validation.md | 70 ++++++++++-----
 packages/scanner/src/discovery/agent-version-correlation.ts                     | 100 +++++++++++++++------
 packages/scanner/test/discovery-engine/agent-version-correlation.test.ts        | 75 ++++++++++++++++
```

Only `agent-version-correlation.ts` (source), its own test file, and this evidence document changed in the correction — no other milestone file was touched. No dependency, lockfile, or migration change in either commit. No file under `docs/architecture/**`, `.claude/**`, or `codex-recovery-6101-6240.txt` was touched.

## 25. Known limitations honestly stated

- **AgentVersion V1 reflects the technical signals discoverable by the current design-time scanner and must not be represented as full runtime behavior identity.** It is derived only from the parent AGENT's own declaration name plus correlated `MODEL_REFERENCE`/`modelReference` and `tools = [...]` declarations in the same source artifact — not from Prompt, MCP, API, Knowledge Base, Memory, Guardrail, or any other L4 signal (those remain out of scope for roadmap milestone 3, "Agent Technical Profile — L4 Round 1").
- No explicit, trustworthy source-level version declaration is currently detected anywhere in the Discovery Engine; `versionCode` is therefore always absent in this V1. If a future detector adds one, it should be layered in as `DECLARED` evidence per Section 9 of the milestone brief, not retrofitted into this correlation module's technical-fingerprint path.
- AGENT's own `findingId` (and therefore its own Discovery-candidate record identity) remains sensitive to the *matched `kind = "agent"` declaration line's own position* within its file, exactly as MODEL/TOOL's own findingId already is — an edit that shifts that line's position (even without changing its content) produces a different AGENT `findingId`/`candidateId`. This is a pre-existing characteristic of `evidence-assembly.ts`'s finding-identity scheme (unchanged, out of scope to redesign here), not a new regression. **This no longer propagates to AGENT_VERSION**: AGENT_VERSION's own identity is deliberately decoupled from the parent AGENT's `findingId` (§9/§10, post-PR-#23 correction) and depends only on the AGENT's stable `SourceObjectIdentity` plus semantic technical evidence — proven by the TEST A line-shift regression test.
- AGENT identity derivation is purely indentation-based, not a real AST parse. It correctly handles the formatting style used throughout the Discovery Validation Lab's Golden Repositories (verified against `01-simple-agent` and `02-multi-agent`'s real fixture source), but a differently-indented or single-line class/object-literal declaration would not be recognized and would fail closed to the generic value — a conservative, not a silent, failure mode.
- `AgentVersionTechnicalProfile.behaviorFingerprint` (the canonical, post-materialization technical-fingerprint record already modeled in `canonical-contracts`) is not populated by this milestone. This Discovery-stage AGENT_VERSION candidate expresses its technical-revision distinction only through its own deterministic `findingId`/`candidateId`, not through any canonical semantic field — populating `AgentVersionTechnicalProfile` is a later, explicitly out-of-scope concern (roadmap milestone 3).
- AGENT_VERSION correlation currently requires the AGENT and its Model/Tool evidence to be detected in the exact same single source artifact, mirroring `relationship-correlation.ts`'s own existing "same file" correlation rule exactly. An Agent whose Model/Tool bindings are declared in a different file (e.g. a separate config file) will not yet produce an AGENT_VERSION — this is a direct, intentional consequence of reusing the existing, already-audited correlation pattern rather than inventing a new one, not a new limitation this milestone introduced.
