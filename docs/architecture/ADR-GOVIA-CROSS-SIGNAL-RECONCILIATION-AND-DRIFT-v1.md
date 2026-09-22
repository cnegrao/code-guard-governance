# Cross-Signal Reconciliation & Drift V1

Status: **ACCEPTED / FROZEN**. Explicit architecture-owner approval was
given on 2026-09-22 for this document exactly as written. This freeze
authorizes the M15 architecture for implementation; it does not itself
constitute or claim M15 implementation completion.

Baseline: **GOVIA-L0L16-CIA-v1.0**, frozen and unchanged. This is an
additive ADR under the frozen roadmap milestone **M15 — CROSS-SIGNAL
RECONCILIATION & DRIFT V1** (L13 + L16).

## 1. Purpose, authority and current evidence

**L13 does not start from zero.** `GOVIA-L0L16-CIA-v1.0-implementation-conformance.md`
already classifies L13 Cross-Signal Reconciliation as `CURRENT_MAIN_FOUNDATIONAL`:
"Full source-to-source reconciliation (ReviewSubject, Authorization,
Reconciliation) — real, transactional, human-authority-enforced twice (TS +
DB CHECK)," with an explicit disposition of "reuse as-is; extend, don't
rebuild." That classification is correct and this ADR does not relitigate
it. What L13 lacked — per that same document, at a time before L12/M14
existed — was specifically the *design-time-vs-runtime* correlation half,
because no runtime observation existed yet to correlate against. M14 has
since closed that gap (§1's evidence table below). **M15 is not "the first
L13 milestone"; it is the milestone that adds the one piece L13's existing
foundation was structurally missing: cross-signal design-time-vs-runtime
comparison, closed comparison outcomes, and temporal drift/change
intelligence — on top of, not instead of, the already-implemented L13
reconciliation foundation.** Runtime-vs-runtime (source-to-source) signal
correlation is a related but separate capability this ADR explicitly
defers — see §7.3. This document freezes that additive architecture before
any implementation.

Authoritative references, unchanged by this proposal:

- [Frozen CIA baseline](./GOVIA-L0L16-CIA-v1.0.md) — L13, L16, the closed
  eleven `CanonicalObjectKind` and twelve `GovernedRelationshipType`
  taxonomies, the trust vocabulary, and the mandatory A–O mapping.
- [Frozen roadmap](./GOVIA-L0L16-CIA-v1.0-roadmap.md) — M15 owns L13 + L16;
  M13 owns L10/L11 design-time/temporal execution state; M14 owns L12
  runtime observation.
- [M13 execution-context ADR](./ADR-GOVIA-EXECUTION-CONTEXT-IDENTITY-CONNECTIVITY-AUTHZ-v1.md).
- [M14 runtime observation ADR](./ADR-GOVIA-RUNTIME-OBSERVATION-AND-OTEL-INGESTION-v1.md),
  especially §13 ("M15 handoff and downstream exposure") and §4's explicit
  statement that cross-source overlap reconciliation is M15 scope.
- [Field/fact authority ADR](./ADR-GOVIA-FIELD-FACT-AUTHORITY-AND-MULTIVENDOR-RECONCILIATION-v1.md)
  — the existing canonical reconciliation this ADR must not rebuild.

Current repository evidence (this branch, base `6cee16b`) supersedes the
"M14 NOT STARTED" language inside the M14 ADR's own body: M14 is
implemented. Frozen architecture wins for architectural authority; current
code wins for implementation-status claims.

| Foundation | Current evidence and reuse boundary |
| --- | --- |
| Runtime observation (L12) | [`RuntimeObservation` contract](../../packages/canonical-contracts/src/runtime-observation.ts), [domain validation](../../packages/governance-review/src/runtime-observation.ts), [persistence](../../apps/dashboard/lib/governance/runtime-persistence.ts) and [row mapping](../../apps/dashboard/lib/governance/runtime-row.ts) are implemented, migrated (`20260917021203_runtime_observability_v1.sql`, `20260917192615_runtime_observability_v1_review_fixes.sql`) and closed to `EXECUTION`/`MODEL_CALL`/`TOOL_CALL`/`MCP_CALL`/`API_CALL`. Admission is a trusted-ingestion/validation/replay boundary (M14 ADR §§4-11), **not** a governance decision boundary — see §3. |
| Execution context (L10/L11) | [`execution-context.ts` contract](../../packages/canonical-contracts/src/execution-context.ts), [domain gate](../../packages/governance-review/src/execution-context.ts) and [dashboard read path](../../apps/dashboard/lib/governance/execution-context-read.ts) are implemented and migrated (`20260915230551_execution_context_v1.sql`). `DIRECT_EXECUTION_FIELDS` is closed to `CAPABILITY`, `PRINCIPAL`, `DECLARED_CONNECTIVITY`, `REQUESTED_SCOPE` — the only execution facts with a real source producer today. `GRANTED_SCOPE`, `PERMISSION`, `ENVIRONMENT`, `NETWORK_CONTEXT`, `EGRESS`, `DEPLOYMENT_CONNECTIVITY`, `ROLE_REFERENCE` exist as typed shapes with **no current producer**. `execution_field_states` rows carry `decidedAt` (governance decision time) only, never a fact-level `effectiveFrom`/`effectiveTo`. |
| Canonical relationship materialization (L9) | [`relationship-resolution.ts`](../../apps/dashboard/lib/governance/relationship-resolution.ts) persists governed `canonical_relationships` rows for the seven `BehaviorBindingRelationshipType` edges (`USES_MODEL`, `USES_TOOL`, `USES_MCP`, `INVOKES`, `USES_PROMPT`, `USES_KNOWLEDGE_BASE`, `USES_SKILL`). Each row carries an exact `relationshipId`/`relationshipStateId` (already read by `relationship-resolution.ts` for `MATCH_EXISTING`, `contracts.ts:1783`), exact `CanonicalObjectIdentity` source/target, its own `validFrom`/optional `validTo` (`contracts.ts:1789-1791`, independent of the backing decision's `decidedAt`), and no assumed cardinality — the same `AGENT_VERSION` may have multiple simultaneous governed edges of the same type. |
| **L13 foundational reconciliation (existing — reuse as-is)** | [`reconciliation-invocation.ts`](../../packages/governance-review/src/reconciliation-invocation.ts), [`reconciliation-authorization.ts`](../../packages/governance-review/src/reconciliation-authorization.ts), [`reconciliation-input-recovery.ts`](../../packages/governance-review/src/reconciliation-input-recovery.ts), [`review-subject.ts`](../../packages/governance-review/src/review-subject.ts)/[`review-state.ts`](../../packages/governance-review/src/review-state.ts) and the M10/M13 field-authority mechanism ([`execution-context.ts`](../../packages/canonical-contracts/src/execution-context.ts)'s `reconcileExecutionField`, [`technical-fact-persistence.ts`](../../apps/dashboard/lib/governance/technical-fact-persistence.ts)) together **are** L13's existing `CURRENT_MAIN_FOUNDATIONAL` reconciliation base: object/relationship identity reconciliation (`CREATE_NEW`/`MATCH_EXISTING`/`MERGE_CANDIDATES`/`REJECT`/`DEFER`) and source-to-source field-authority reconciliation (`ACCEPT_PROPOSED`/`KEEP_CURRENT`/`DEFER`/`REJECT_PROPOSED`), both real, transactional, and human-authority-enforced. M15 reuses this foundation's *outputs* as comparison inputs (§3) and reuses its *patterns* (closed states, HUMAN-gated `ReconciliationAuthorizationPort`, append-only audit) for its own future disposition surface (§16). M15 does not rebuild, replace, or duplicate any of it. |
| Discovery/GitHub provenance | [`discovery-intake.ts`](../../apps/dashboard/lib/governance/discovery-intake.ts) and the governed GitHub source intake (PR #46, `4388282`) supply the evidence/provenance chain upstream of M13/M7 governed state. M15 consumes already-governed canonical state produced through that chain; it adds no GitHub-specific behavior. |
| Review lifecycle type fit (existing, narrow caveat) | `ReviewSubject` (part of the L13 foundation above) is structurally a `DiscoveryFinding` wrapper — `findingId`, `sourceObject` and `assertionIds` are all derived from a Finding. A `CrossSignalComparisonResult` (§14) has no backing `DiscoveryFinding` and cannot be represented as a `ReviewSubject` without fabricating one. So while M15 reuses L13's reconciliation *foundation* wholesale, it reuses `ReviewSubject`'s *pattern* only (closed states, HUMAN-gated authorization, append-only audit), not the concrete type — see §16. |

## 2. Core decision and invariants

**M15 computes CROSS-SIGNAL COMPARISONS: deterministic, evidence-bound
comparisons between two already-evidenced signals for the same governed
subject.** The single durable output is one `CrossSignalComparisonResult`
record (§14). When its outcome is `DRIFT_CANDIDATE` or `CONFLICT_CANDIDATE`,
that same record — not a second, separate entity — **is** the inert
machine hypothesis available for a future human disposition path (§16). A
comparison result is not itself a canonical fact, a canonical relationship,
an authorization decision, or a trust-state promotion.

```text
CROSS-SIGNAL COMPARISON != CANONICAL RECONCILIATION
DESIGN-TIME DECLARATION != RUNTIME OBSERVATION
SOURCE ASSERTION != CANONICAL FACT
OBSERVATION != GOVERNANCE AUTHORITY
RUNTIME ADMISSION != GOVERNANCE AUTHORITY
DRIFT CANDIDATE != CONFIRMED CHANGE
CONFLICT CANDIDATE != FALSEHOOD
HIGH CONFIDENCE != VALIDATED
UNKNOWN != FALSE
MISSING EVIDENCE MUST NEVER BE FABRICATED
GRAPH != SYSTEM OF RECORD
LLM OUTPUT != CANONICAL TRUTH
```

The closed eleven `CanonicalObjectKind` and twelve `GovernedRelationshipType`
taxonomies are unchanged (§14). `AGENT` remains logical identity;
`AGENT_VERSION` remains technical state. Scanner machine authority remains
`PROPOSED`. Cross-signal comparison authority is separate again: it is never
`PROPOSED`, `VALIDATED`, `CERTIFIED`, or any existing vocabulary term — see
§4.

## 3. Cross-Signal Reconciliation vs canonical reconciliation

L13's existing `CURRENT_MAIN_FOUNDATIONAL` reconciliation base (§1) already
covers two of the three reconciliation concerns below — M15 does not
create, duplicate, or re-architect either of them. Three distinct,
non-overlapping reconciliation concerns exist in this repository after
M15. None subsumes another:

| Concern | Owner | Input | Output | Milestone |
| --- | --- | --- | --- | --- |
| **Object/relationship identity reconciliation** | `reconciliation-invocation.ts` | `DiscoveryFinding` + `NormalizedCandidate` | `CREATE_NEW` / `MATCH_EXISTING` / `MERGE_CANDIDATES` / `REJECT` / `DEFER` — creates or matches canonical identity | M7 (existing) |
| **Field/fact authority reconciliation** | `execution-context.ts` (`reconcileExecutionField`), the M10 `DataAsset`/`DataElement` field mechanism | Two or more **source-to-source** typed field proposals for the same canonical object/field | `ACCEPT_PROPOSED` / `KEEP_CURRENT` / `DEFER` / `REJECT_PROPOSED` — materializes or preserves one field's governed value | M10/M13 (existing) |
| **Cross-signal comparison** | This ADR | Two **already-governed-or-evidenced** signals for the *same resolved canonical subject*, one side design-time (governed) and the other runtime (evidenced) — V1's only supported pairing; source-to-source (runtime vs runtime) is deferred (§7.3) | `CONSISTENT` / `DRIFT_CANDIDATE` / `CONFLICT_CANDIDATE` / `INSUFFICIENT_EVIDENCE` — one read-only `CrossSignalComparisonResult` record, which for `DRIFT_CANDIDATE`/`CONFLICT_CANDIDATE` outcomes doubles as the inert machine hypothesis; no separate hypothesis entity | **M15 (this ADR)** |

M15 never receives a `DiscoveryFinding`, `NormalizedCandidate`, or raw
`SourceAssertion` as a comparison input. Its inputs cross two **different**
kinds of boundary, and this ADR does not blur them:

- **Governance authority boundary** (design-time side): the exact
  materialized `execution_field_states` row backed by an
  `ExecutionFieldDecision` (`outcome: 'ACCEPT_PROPOSED'`), or the exact
  materialized `canonical_relationships`/`relationship_state` row backed by
  a `RelationshipReconciliationDecision` (`CREATE_NEW`/`MATCH_EXISTING`).
  Both have passed an existing **human-gated governance decision** — L13's
  existing foundation (§1).
- **Admission/evidence boundary** (runtime side): a persisted,
  replay-validated `RuntimeObservation`. It has passed trusted admission,
  structural validation, replay/idempotency checks, and tenant/source/
  binding checks (M14 ADR §§4-11) — **not** a governance decision.
  `RUNTIME ADMISSION != GOVERNANCE AUTHORITY`; `OBSERVATION != GOVERNANCE
  AUTHORITY` (§2). A `RuntimeObservation` is trustworthy *evidence*, not a
  governed fact, and this ADR never describes it as having "cleared an
  authority boundary" in the sense the design-time side has.

M15 does not re-review, re-decide, or re-litigate the design-time side's
governance decision, and cannot apply governance authority to the runtime
side, because runtime observation was never subject to one. It only
compares an authority-boundary output against an admission-boundary output
— V1's sole supported pairing (§7.2). Comparing two admission-boundary
outputs against each other (runtime vs runtime) is a distinct, deferred
capability, not implemented in V1 — see §7.3. This is what makes M15
additive rather than a rebuild: it sits strictly downstream of
M7/M10/M13/M14, never beside or inside them.

## 4. Closed comparison outcome vocabulary

```text
CONSISTENT           — both sides resolve to the same normalized value.
DRIFT_CANDIDATE       — both sides resolve to a different value, and a
                        legitimate earlier-to-later temporal ordering
                        supports one superseding the other.
CONFLICT_CANDIDATE     — both sides resolve to a different value, and no
                        legitimate temporal ordering can be established
                        between them.
INSUFFICIENT_EVIDENCE — the dimension is supported and the subject is
                        resolved, but one or both sides lack the evidence
                        this comparison method requires.
```

This is the complete, closed machine result vocabulary for M15 V1. No
competing synonym (`VALIDATED`, `CONFIRMED`, `ANOMALY`, `MISMATCH`,
`CHANGED`) is introduced. `VALIDATED` is never a machine comparison result —
only a human governance decision made through an existing authority
boundary may ever move a fact to `VALIDATED`, and this ADR grants no such
path.

A fifth condition — the requested dimension is not one of the closed V1
dimensions (§7) — is **not** a comparison outcome. It is a pre-comparison
rejection (`CROSS_SIGNAL_DIMENSION_UNSUPPORTED`), following the same
reject-before-attempt pattern `createRuntimeObservation` and
`validateExecutionSnapshot` already use elsewhere in this codebase. An
unsupported dimension never produces a persisted `INSUFFICIENT_EVIDENCE`
record, because no comparison was ever legitimately attempted.

**`DRIFT_CANDIDATE` is defined here as closed vocabulary for the general
architecture and for future comparison methods. As of V1, no closed
comparison method actually reaches it — see §7.1a.** This ADR does not
remove the outcome from the vocabulary merely because V1 evidence cannot
yet support it; it freezes the definition now so a future method can be
added without renegotiating the vocabulary, while being explicit that V1
itself never emits it.

## 5. Drift, precisely

A comparison MAY be classified `DRIFT_CANDIDATE` only when **all** of the
following hold:

1. **Comparable semantic dimension.** Both sides are typed values of the
   same closed V1 comparison dimension (§7) — never a raw string diff.
2. **Same governed subject / exact binding.** Both sides resolve, via
   independently proven exact binding, to the identical
   `CanonicalObjectIdentity<'AGENT_VERSION'>` (organisationId + objectId).
   A design-time side bound by the exact materialized state's own subject
   reference (`execution_field_states.canonical_object_id` or the governed
   relationship state's source endpoint), and a runtime side bound by
   `RuntimeObservation.binding.state === 'EXACT'`. `UNRESOLVED` runtime
   bindings never participate (§8).
3. **Valid temporal ordering, using only the clocks §12 permits, and never
   from mere event-order alone.** One side's *fact valid/effective time*
   is provably, unambiguously earlier than the compared runtime event time
   (never a governance-decision or acquisition/recording time — §12). A
   possible future `RUNTIME_VS_RUNTIME` method — **not implemented in V1**;
   see §7.3 — would additionally need an *independently proven
   state-transition/change-point model* establishing that the earlier
   observation's configuration was actually superseded, not merely that it
   happened first. **Two differing values at two different event times are
   not, by themselves, evidence of supersession**: the same `AGENT_VERSION`
   may legitimately execute under different principals, or invoke different
   models/tools/MCP servers/APIs, across different executions, without any
   governed change having occurred. A governance decision's `decidedAt` is
   never used as a stand-in for a fact's effective time. See §12 and §7.1a
   for which V1 comparisons this rules out of `DRIFT_CANDIDATE` (both of
   them).
4. **Sufficient evidence on both sides.** Both the earlier and later value
   are backed by a resolvable evidence reference (§11) — the exact
   materialized state id (`executionFieldStateId` or
   `relationshipId`/`relationshipStateId`) and its supporting decision, or
   a `RuntimeObservation`'s `observationId` and its `provenance.evidence`.
5. **Method/version provenance.** The comparison was performed by one
   explicit, versioned comparison method (§7); an unversioned or
   best-effort comparison never produces a persisted result.

Different values alone are never sufficient. A single differing value with
an unresolved, ambiguous, or absent binding on either side is not drift —
it fails closed to `INSUFFICIENT_EVIDENCE` (if the binding is simply
missing/unresolved) or is never attempted at all (if the subject cannot be
resolved). **Missing or ambiguous binding is never drift, and neither is
mere event ordering.**

## 6. Drift vs conflict

- **Conflict** (`CONFLICT_CANDIDATE`): comparable, exactly-bound,
  sufficiently evidenced signals disagree, but temporal progression cannot
  legitimately establish that one superseded the other — same-instant
  values, unordered/overlapping effective windows, differing values at
  different event times with no proven supersession model, or explicit
  clock uncertainty on the ordering. Conflict does not mean either side is
  false; `UNKNOWN != FALSE` applies to both.
- **Drift** (`DRIFT_CANDIDATE`): comparable, exactly-bound, sufficiently
  evidenced signals disagree, and evidence supports a legitimate earlier
  baseline/state being superseded by a later state/observation, per §5.

A comparison is never both. When temporal ordering (or a state-transition
model) cannot be established with confidence, the result MUST fall to
`CONFLICT_CANDIDATE`, never `DRIFT_CANDIDATE` — ambiguity about ordering is
treated the same way ambiguity about binding is treated: it removes drift
eligibility, it does not manufacture it. **As of V1 (§7.1a), no closed
comparison method can prove rule 3's ordering/supersession requirement, so
every V1 disagreement resolves to `CONFLICT_CANDIDATE`.** This is a
statement about current evidence, not a redefinition of drift.

## 7. V1 comparable signal classes

M15 V1 defines exactly **two comparison dimensions**, each usable under
its one supported V1 signal-pairing mode, `DESIGN_TIME_VS_RUNTIME`.
`RUNTIME_VS_RUNTIME` is a real architectural concept but is **not
supported in V1** — see §7.3. No other dimension is claimed supported.

### 7.1 Comparison dimensions

| Dimension code | Compares | Design-time / governed source | Runtime source |
| --- | --- | --- | --- |
| `PRINCIPAL_IDENTITY` | The `ExecutionPrincipalReference` (kind, providerCode, authorityReference, principalReference) associated with an `AGENT_VERSION`'s execution | The **exact materialized governed state**: one `execution_field_states` row, identified by its own `executionFieldStateId` together with its backing `ExecutionFieldDecision.decisionId` and `ExecutionSourceSnapshot.snapshotId` — never the decision alone, and never a candidate/proposal id. No fact valid/effective time exists for this state today (§12.A); only its existence/value participates. | `RuntimeObservation.context.principal` (`RuntimeAvailability<{ value: ExecutionPrincipalReference; support }>`), state `'KNOWN'` only |
| `DEPENDENCY_TARGET_IDENTITY` | Whether an `AGENT_VERSION`'s proven runtime target (`MODEL`/`TOOL`/`MCP_SERVER`/`API`) is a member of the governed dependency **set** that was effective, for the matching relationship type, at the runtime event's own time (§7.1a) | The **exact effective set** of governed `canonical_relationships`/`relationship_state` rows: every state for this `AGENT_VERSION`, this relationship type (`USES_MODEL`/`USES_TOOL`/`USES_MCP`/`INVOKES`), whose `[validFrom, validTo)` interval contains the runtime event time. Relationship-type cardinality is **not** assumed to be one — an `AGENT_VERSION` may legitimately have multiple simultaneous governed edges of the same type. Each set member is identified by its exact `relationshipId`/`relationshipStateId` (never `relationshipCandidateId`, which identifies a pre-canonical candidate, not a durable governed state; `relationship-resolution.ts` already reads `relationship_state_id` for `MATCH_EXISTING`). | `RuntimeObservation.target.canonical` for the matching `RuntimeTargetKind`, state `'KNOWN'` only (independently proven, never the bare `target.observed` source reference) |

Both dimensions share the same underlying discipline: the design-time side
is always the *exact materialized governed state* (never a decision alone,
never a pre-canonical candidate id), compared against an independently
proven runtime value, after normalization (organisationId + objectId for
`DEPENDENCY_TARGET_IDENTITY`; kind + providerCode + authorityReference +
principalReference for `PRINCIPAL_IDENTITY`). Neither dimension ever
compares raw strings, free text, prompts, or unproven `target.observed`
source references. The two dimensions are **not** symmetric in what
temporal evidence is available for `DESIGN_TIME_VS_RUNTIME` — see §7.1a.

### 7.1a Reachable outcomes per dimension × pairing (V1)

This table is normative: an implementation MUST NOT produce a result in a
column marked "no."

| Dimension | Pairing | `CONSISTENT` | `DRIFT_CANDIDATE` | `CONFLICT_CANDIDATE` | `INSUFFICIENT_EVIDENCE` |
| --- | --- | --- | --- | --- | --- |
| `PRINCIPAL_IDENTITY` | `DESIGN_TIME_VS_RUNTIME` | yes | **no** | yes, whenever both sides resolve and disagree | yes (missing decision, unresolved binding, `UNKNOWN` principal) |
| `DEPENDENCY_TARGET_IDENTITY` | `DESIGN_TIME_VS_RUNTIME` | yes — runtime target is a member of the effective set at the event time | **no** | yes — effective set is non-empty but the runtime target is not a member | yes — effective set is empty at the event time (`DESIGN_TIME_BASELINE_NOT_EFFECTIVE`), or binding/target proof missing |

These are the **only two rows** for V1: `RUNTIME_VS_RUNTIME` is not a
supported V1 pairing for either dimension (§7.2, §7.3), so it has no row
here at all — not "all no," simply absent, because no V1 method ever
attempts it.

**V1 has no closed comparison method that reaches `DRIFT_CANDIDATE`. This
is not an oversight:**

- `PRINCIPAL_IDENTITY` has no fact-valid-time source (§12.A): a
  materialized `execution_field_states` row carries only `decidedAt`
  (governance decision time), never a fact-level effective time, so rule
  3's ordering test (§5) can never be satisfied.
- `DEPENDENCY_TARGET_IDENTITY` has a real fact-valid-time source
  (`validFrom`/`validTo`), but a **closed** (`validTo`-set) relationship
  state is an **expired** baseline at any runtime event time after
  `validTo` — it is not an active baseline at that event, and comparing a
  later runtime observation against an already-expired design-time state
  proves nothing about supersession. Only the set of states *effective at
  the runtime event's own time* participates (§7.1); an expired state
  outside that set is simply irrelevant to the comparison, not evidence of
  drift.

`DRIFT_CANDIDATE` therefore remains closed, defined vocabulary (§4-§6) for
a future comparison method version. For `PRINCIPAL_IDENTITY`, that would
require a future execution-context producer supplying a real fact
valid/effective time — none exists today. For `DEPENDENCY_TARGET_IDENTITY`,
that would require an independently proven state-transition/change-point
model (e.g. resolving `supersedesRelationshipStateId` chains) that V1 does
not implement. **This ADR does not fabricate reachability to make M15
appear to already detect drift.** Every V1 disagreement that clears
binding/evidence resolves to `CONFLICT_CANDIDATE`.

### 7.2 Signal-pairing mode

M15 V1 supports exactly **one** signal-pairing mode:

- **DESIGN_TIME_VS_RUNTIME** — one side is the governed design-time value
  (§7.1, left column), the other is one `RuntimeObservation`'s proven value
  for the same exactly-bound `AGENT_VERSION`. This is the canonical L13
  "design-time vs runtime" case, and the only pairing V1 implements.

`RUNTIME_VS_RUNTIME` — comparing two `RuntimeObservation`s' proven values
against each other, the L13 "source-to-source correlation" case the M14
ADR §4 flagged as future M15 scope — is **explicitly deferred and not
supported in V1**. Same `AGENT_VERSION` identity does not, by itself,
establish that two observations describe the same or even a comparable
execution/event/context; see §7.3 for the complete reasoning and the
forbidden-fallback list. A caller requesting `RUNTIME_VS_RUNTIME` in V1
receives a pre-comparison rejection, `CROSS_SIGNAL_PAIRING_UNSUPPORTED`
(mirroring §4's `CROSS_SIGNAL_DIMENSION_UNSUPPORTED` pattern) — never
persisted as `INSUFFICIENT_EVIDENCE`, never any comparison result at all.

`DESIGN_TIME_VS_RUNTIME × {PRINCIPAL_IDENTITY, DEPENDENCY_TARGET_IDENTITY}`
are the **two** closed comparison method codes for V1:
`CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1`,
`CROSS_SIGNAL_DEPENDENCY_TARGET_DESIGN_RUNTIME_V1`. A third method, a
future `RUNTIME_VS_RUNTIME` method, or a version bump aiming to reach
`DRIFT_CANDIDATE`, requires an explicit future ADR revision establishing
the missing evidence model — not silent extension and not a change to
§7.1a/§7.3 by implementation convenience.

### 7.3 Explicitly unsupported for V1 (future work)

Each of these is unsupported because at least one comparison side has **no
real current producer**, not because the concept is uninteresting:

| Claimed-sounding dimension | Why unsupported now |
| --- | --- |
| Prompt drift | M14 explicitly excludes prompts/completions/tool arguments from any observation (§10 of the M14 ADR: "default exclusion covers prompts, completions..."). No runtime side exists. |
| Permission / authorization drift | `GRANTED_SCOPE` and `PERMISSION` are typed `TemporalExecutionFact` shapes with **no current producer** (`DIRECT_EXECUTION_FIELDS` excludes both). M14 also never observes grants (`GRANT != OBSERVED SUCCESS`). Neither side exists. |
| Topology / network drift | `NETWORK_CONTEXT`, `EGRESS`, `DEPLOYMENT_CONNECTIVITY` have no current design-time producer (not in `DIRECT_EXECUTION_FIELDS`), even though `RuntimeObservation.context.network` exists on the runtime side. One-sided evidence is not a comparable dimension. |
| Environment drift | `ENVIRONMENT` has no current design-time producer for the same reason; `RuntimeObservation.context.environment` alone is one-sided. |
| Declared-connectivity vs observed-call endpoint drift | `DECLARED_CONNECTIVITY`/`DEPLOYMENT_CONNECTIVITY` use `SanitizedTechnicalLocator` (URI); `RuntimeObservedTarget.sourceReference` is an opaque source-specific reference. No governed normalization/equivalence function between the two shapes exists in this repository. Comparing them today would require guessing an equivalence, which this ADR forbids. |
| Schema / data-element drift | M9/M10 field-fact reconciliation is design-time source-to-source only (§3); M14 has no `DATA_ASSET`/`DATA_ELEMENT` runtime observation kind. No runtime side exists. |
| Risk drift | L15 (M17) is not started; risk consumes M15 output later (§16), it does not supply a comparison side. |
| Behavior-fingerprint / capability drift across `AgentVersion` revisions | Already handled by M13's versioning model: a behavior-significant change produces a *new* `AGENT_VERSION` (§ "Prospective fingerprint evolution" in the M13 ADR), not a drift record against the same subject. Modeling this as M15 drift would duplicate M13's own identity mechanism and violate "same governed subject" (§5.2) since the subject would differ. |
| Handoff / multi-agent transfer drift | M14 ADR §3 places handoff spans explicitly `OUT OF SCOPE`. No runtime observation kind exists to compare. |
| `RUNTIME_VS_RUNTIME` as a pairing mode (either dimension) | Same `AGENT_VERSION` identity does not establish that two `RuntimeObservation`s describe the same, or even a comparable, execution/event/context — different principals, models, tools, MCP servers, or APIs across different executions may be fully legitimate, not evidence of anything (§5, §12). V1 has no independently proven, tenant-scoped cross-source event/correlation identity establishing comparability between two observations. Matching `traceId`/`spanId` across source connections is explicitly not accepted as such proof (M14 ADR §4). No fallback is accepted either: not trace/span matching, not timestamp proximity, not a `sourceEventKey` guess, not "same `AGENT_VERSION`" alone, and not value similarity. A future method requires its own ADR establishing a real correlation identity; this ADR reserves the concept (§7.2) without implementing it. |

## 8. Runtime binding

A `RuntimeObservation` participates in any M15 comparison only when
`binding.state === 'EXACT'` **and** every referenced identity/tenant
constraint is independently satisfied: `binding.agentVersion.organisationId`
equals the comparison's trusted `organisationId`, and the `AGENT_VERSION`
object is confirmed to exist for that tenant before the comparison is
attempted (never assumed from the observation's own claim).

```text
NO FINGERPRINT SIMILARITY FALLBACK
NO CANDIDATE-ID FALLBACK
NO SOURCE-NAME GUESS
NO CROSS-TENANT MATCH
```

`UNRESOLVED` observations remain retained runtime evidence (M14's job) but
are never silently bound to a canonical `AGENT_VERSION` for the purpose of
a comparison. A comparison request whose runtime side is `UNRESOLVED`
resolves to `INSUFFICIENT_EVIDENCE` with a closed reason
(`RUNTIME_BINDING_UNRESOLVED`), never a guessed subject. The same rule
applies to `RuntimeTarget.canonical` — when its state is `'UNKNOWN'` for a
`DEPENDENCY_TARGET_IDENTITY` comparison, that side is absent evidence, not
an inferred non-dependency.

## 9. Authority ceiling

```text
DESIGN-TIME DECLARATION != RUNTIME OBSERVATION
SOURCE ASSERTION != CANONICAL FACT
OBSERVATION != GOVERNANCE AUTHORITY
RUNTIME ADMISSION != GOVERNANCE AUTHORITY
HIGH CONFIDENCE != VALIDATED
```

A cross-signal comparison result has no authority to:

- `CONFIRM` or `CERTIFY` anything.
- Materialize, mutate, or supersede a canonical object or canonical
  relationship.
- Mutate an M13 `ExecutionFieldDecision`, snapshot, or `BehaviorFingerprint`.
- Rewrite, correct, or annotate an M14 `RuntimeObservation` (immutable per
  the M14 ADR).
- Grant, deny, or imply authorization, a capability, or a scope.
- Promote any input's `TrustState`.
- Treat a `RuntimeObservation`'s successful admission as if it were a
  governance decision — admission proves the evidence was safely and
  idempotently accepted, never that anyone authorized it as fact.

The only durable effect a comparison may have is the creation of its own
append-only `CrossSignalComparisonResult` record (§14). No second,
separate hypothesis or disposition entity is created alongside it — for
`DRIFT_CANDIDATE`/`CONFLICT_CANDIDATE` outcomes, that same record is the
inert machine hypothesis, available for a human to review through an
existing or future authority boundary (§16). Nothing about creating that
record requires, or implies, that boundary having acted yet.

## 10. Trust-state participation

| Input trust state | Participates as | Never becomes, via comparison |
| --- | --- | --- |
| `DECLARED` (M13 `ExecutionFieldDecision`, `AcceptProposed`) | Governed design-time comparison side, passed a governance authority boundary | `VALIDATED` |
| `IMPORTED` (enterprise-sourced facts) | Governed design-time comparison side, where a materialized decision exists | `VALIDATED` |
| `OBSERVED` (M14 `RuntimeObservation`) | Runtime comparison side, passed only an admission/evidence boundary (§3, §9) | `VALIDATED`, `DECLARED` |
| `INFERRED` (scanner/Discovery) | **Never a direct comparison input.** M15 consumes materialized decisions and observations, never raw `INFERRED` findings. | n/a |

A `CONSISTENT` result never upgrades either input's trust state. Two
independently `OBSERVED` signals that agree remain `OBSERVED`; a `DECLARED`
fact and an `OBSERVED` fact that agree remain `DECLARED` and `OBSERVED`
respectively. Confidence, agreement count, or repetition across multiple
`CONSISTENT` results never accumulates into `VALIDATED`. Only an explicit
future human decision through an explicit future authority boundary (not
created by this ADR) may ever assign `VALIDATED`.

## 11. Evidence and provenance

Every `CrossSignalComparisonResult` carries, without fabrication:

- `organisationId`.
- `subject`: the exact `CanonicalObjectIdentity<'AGENT_VERSION'>` both
  sides resolved to.
- `dimension`: one closed §7.1 code.
- `pairingMode`: `DESIGN_TIME_VS_RUNTIME` — the only V1-supported value
  (§7.2). `RUNTIME_VS_RUNTIME` is a reserved future value with no V1
  producer; a request for it is rejected pre-comparison
  (`CROSS_SIGNAL_PAIRING_UNSUPPORTED`, §7.2) and never reaches this field.
- `left` and `right`: each a closed discriminated reference to the **exact
  materialized state** compared — never a decision alone, never a
  pre-canonical candidate id:
  - `{ kind: 'EXECUTION_FIELD_STATE'; executionFieldStateId; decisionId;
    snapshotId }` — `PRINCIPAL_IDENTITY` design-time side.
  - `{ kind: 'RELATIONSHIP_STATE_SET'; states: readonly { relationshipId;
    relationshipStateId; decisionId?; validFrom: IsoTimestamp; validTo?:
    IsoTimestamp }[] }` — `DEPENDENCY_TARGET_IDENTITY` design-time side:
    the resolved set of governed relationship states effective at the
    runtime event time (§7.1, §7.1a); may be empty (→
    `INSUFFICIENT_EVIDENCE` / `DESIGN_TIME_BASELINE_NOT_EFFECTIVE`).
    `decisionId` is present only when the originating decision is
    independently resolvable for that exact state.
  - `{ kind: 'RUNTIME_OBSERVATION'; observationId; connectionId }` — the
    runtime side of `DESIGN_TIME_VS_RUNTIME`, V1's only pairing (§7.2).

  Never a copied value — only a reference a reader can resolve back to the
  original governed state or observation.
- `method`: `{ code; version }` from the closed §7.2 list.
- `leftTemporalBasis` / `rightTemporalBasis`: each a closed discriminated
  value proving **which clock and which boundary** supplied it — never an
  ambiguous generic tag a reader would have to infer the meaning of:
  - `{ basis: 'RELATIONSHIP_VALID_FROM'; value: IsoTimestamp }` — one
    `RELATIONSHIP_STATE_SET` member's `validFrom`.
  - `{ basis: 'RELATIONSHIP_VALID_TO'; value: IsoTimestamp }` — one
    member's `validTo`, when present.
  - `{ basis: 'RUNTIME_EVENT_TIME'; value: IsoTimestamp }` —
    `startedAtUnixNano` converted to `IsoTimestamp` (§12.B).
  - `{ basis: 'NOT_AVAILABLE' }` — `PRINCIPAL_IDENTITY`'s design-time
    side (no producer today).

  Because `RELATIONSHIP_STATE_SET` may contain several members, each with
  its own `validFrom`/optional `validTo`, those per-member bases are
  carried directly on each entry of the `states` array (above), not
  flattened into one ambiguous top-level value; the top-level
  `leftTemporalBasis` for that case is
  `{ basis: 'RELATIONSHIP_VALID_FROM_TO_SET' }`, a marker that the true
  bases live per-member. **No reader may have to infer whether a stored
  time meant `validFrom` or `validTo`, or a decision time versus a fact
  time.**
- `evaluatedAt`: server-assigned, distinct from every temporal basis
  (§12.E).
- `outcome`: one closed §4 code, plus (for `INSUFFICIENT_EVIDENCE`) a
  closed reason code (`RUNTIME_BINDING_UNRESOLVED`,
  `DESIGN_TIME_BASELINE_MISSING`, `DESIGN_TIME_BASELINE_NOT_EFFECTIVE`,
  `RUNTIME_TARGET_NOT_PROVEN`, `SUBJECT_AMBIGUOUS`, `CLOCK_UNCERTAIN`, ...).

If any required reference cannot be resolved, the comparison is never
persisted with an invented value in its place — it either is not attempted
(subject unresolved) or is persisted as `INSUFFICIENT_EVIDENCE` with an
explicit closed reason (evidence present enough to explain the gap, absent
enough to explain why no stronger result was possible).

## 12. Temporal semantics

**A governance decision's `decidedAt` is decision chronology, not fact
chronology.** `decidedAt` records when a human/rule *decided* to
materialize a value; it does not, by itself, establish when the underlying
*fact* became valid/effective. Likewise a snapshot's or observation's
`recordedAt` is acquisition/recording provenance, not effective time, and
**two event timestamps alone never prove that one configuration superseded
another** (§5, §7.1a). Five clocks are frozen, and none may substitute for
another:

- **A. FACT VALID/EFFECTIVE TIME.** When the compared fact itself was
  true/authoritative, per an explicit domain contract field for that fact
  — **never fabricated or derived from governance decision time.** The
  only V1 source of this clock is a governed relationship state's own
  `validFrom` (required) and `validTo` (optional, half-open interval
  `[validFrom, validTo)`; `contracts.ts:1789-1791`), used for
  `DEPENDENCY_TARGET_IDENTITY`'s effective-set resolution (§7.1). A
  relationship state is an **active baseline only at an event time inside
  its own `[validFrom, validTo)`**; a state whose `validTo` is before the
  runtime event is expired at that event and is excluded from the
  effective set — it is not compared against as if it were still current,
  and no drift is inferred from a runtime observation disagreeing with an
  already-expired state (§7.1a). No V1 source of this clock exists for
  `PRINCIPAL_IDENTITY`'s design-time side.
- **B. RUNTIME EVENT TIME.** `RuntimeObservation.startedAtUnixNano`
  (source-reported start of the observed operation) — never `receivedAt`
  or `recordedAt`. In V1, used only as the evaluation instant that resolves
  `DEPENDENCY_TARGET_IDENTITY`'s effective set (clock A) in
  `DESIGN_TIME_VS_RUNTIME` (§7.1), and as the "later" point in that
  pairing's ordering test (§5 rule 3). A possible future
  `RUNTIME_VS_RUNTIME` method would also rely on this clock, but only after
  an independently proven cross-source correlation identity established
  comparability — never on ordering alone (§7.3). V1 implements no such
  method.
- **C. GOVERNANCE DECISION TIME.** `ExecutionFieldDecision.decidedAt` /
  `RelationshipReconciliationDecision.decidedAt`. Audit/governance
  chronology only — when a human or rule authorized a value. **Never**
  used as a stand-in for clock A, and **never** used to order a comparison,
  directly or indirectly. It remains available on a
  `CrossSignalComparisonResult`'s `left` reference purely as an evidence
  pointer (§11), not as a temporal input to the outcome.
- **D. ACQUISITION / RECORDING TIME.** Each side's own `recordedAt`
  (`ExecutionSourceSnapshot.recordedAt`, `RuntimeObservation.recordedAt`)
  or `receivedAt`. Provenance chronology only — when the fact was durably
  captured. **Never** used to decide temporal ordering between two
  comparison sides.
- **E. COMPARISON TIME.** `evaluatedAt` — server/database-assigned when
  M15 evaluated the evidence. Distinct from A–D and **never** used to
  infer source-side ordering; it only timestamps the comparison act
  itself.

**Receipt/recording time (D) must not masquerade as event/effective time
(A/B), and governance decision time (C) must not masquerade as fact valid
time (A).** Ordering for §5's "valid temporal ordering" test uses only
clock A vs. clock B, for V1's sole pairing `DESIGN_TIME_VS_RUNTIME` — never
clocks C, D, or E. `RUNTIME_VS_RUNTIME` is not a V1 pairing (§7.2, §7.3),
and this ADR defines no ordering behavior for it. Out-of-order delivery of
a `RuntimeObservation` (a late-arriving observation with an earlier
`startedAtUnixNano` than one already compared) does not rewrite an existing
`CrossSignalComparisonResult` (append-only, §13); it produces its own new,
additional comparison against the same design-time baseline.

## 13. Idempotency

**Same tenant + same subject + same exact `left`/`right` input references +
same `method` code/version reproduces the identical, deterministic
comparison identity and result.** The comparison identity is a deterministic
function of `(organisationId, subject, dimension, pairingMode, left
reference, right reference, method code+version)` — never of `evaluatedAt`,
a database row id, or receipt order, following the same pattern
`admit_runtime_observation`'s replay identity and
`reconcileExecutionField`'s decision replay already use in this codebase.
For `RELATIONSHIP_STATE_SET`, "the reference" is the resolved set's own
content (its members' `relationshipStateId`s, sorted), not a caller-chosen
input — see below. V1 has exactly one pairing mode
(`DESIGN_TIME_VS_RUNTIME`, §7.2), so `left` is always the design-time
reference and `right` is always the runtime reference — there is no
caller-argument-order ambiguity to canonicalize in V1. A future
`RUNTIME_VS_RUNTIME` method would need its own canonical `left`/`right`
ordering rule (e.g. a fixed total order over observation identity) so that
comparing the same unordered pair of observations in either argument order
resolves to one logical comparison, never two; this is a documented future
design consideration (§7.3), not part of V1's `CrossSignalComparisonResult`
behavior or Definition of Done.

Replaying the identical comparison request returns the original durable
result unchanged (including its original `evaluatedAt`), never
recomputed, never overwritten. Changed evidence on either side — a new
`execution_field_states` row, a new or superseding governed relationship
state, or a later/different `RuntimeObservation` — has a *different* input
reference, and therefore produces a **new**, additional
`CrossSignalComparisonResult`, never an update to the prior one. For
`DEPENDENCY_TARGET_IDENTITY` × `DESIGN_TIME_VS_RUNTIME` specifically: a
later governance decision that changes which relationship states are
effective at the *same* historical runtime event time (e.g. retroactively
closing a previously-open state) resolves to a different effective set, and
therefore a different `left` reference, and therefore a new, additional
comparison — never a silent recomputation of the earlier one. History is
never overwritten, backfilled, or reinterpreted under a later method
version; a method-version change requires new comparisons under the new
version, computed alongside (not replacing) results already recorded under
the prior version.

## 14. Canonical impact

**No new `CanonicalObjectKind` and no new `GovernedRelationshipType`.**
`CrossSignalComparisonResult` is a separate, additive, typed
governance/intelligence record — analogous in status to
`execution_field_states` or `RuntimeObservation`, not to
`AGENT`/`AGENT_VERSION`/etc. It is never returned from, matched against, or
accepted by `invokeObjectReconciliation`/`invokeRelationshipReconciliation`,
and it never appears as a node or edge kind in the closed relationship
taxonomy.

The current contracts do not require any change to the frozen canonical
taxonomy to express M15: both comparison dimensions (§7.1) resolve to
existing `CanonicalObjectIdentity<K>` references (individually or, for
`DEPENDENCY_TARGET_IDENTITY`, as a set of them) already produced by M7/M13,
and the comparison record itself only needs to *reference* those existing
identities, never mint new ones. There is no STOP condition here — the
architecture is expressible without touching `CANONICAL_OBJECT_KIND` or
`GOVERNED_RELATIONSHIP_TYPE`.

## 15. Persistence direction (minimum additive shape, not a migration)

This ADR proposes the shape a future migration must satisfy; it does not
create one. **The only proposed additive persistence entities are
`cross_signal_comparison_results` and, because
`DEPENDENCY_TARGET_IDENTITY`'s design-time side is a set rather than a
single value (§7.1), a normalized child table
`cross_signal_comparison_left_relationship_states`** (one row per effective
set member: `comparison_id`, `relationship_id`, `relationship_state_id`,
nullable `decision_id`) — never an arbitrary JSON/array escape hatch for a
variable-cardinality reference. For `DRIFT_CANDIDATE`/`CONFLICT_CANDIDATE`
outcomes, the parent row is itself the inert machine hypothesis (§2, §9);
this ADR does not define or imply a second `DriftHypothesis`/
`ConflictHypothesis` table or entity. A future disposition workflow (§16)
may read and reference these rows, but recording its own disposition state
is out of scope here and would be a separate, future addition, not part of
the V1 persistence shape below.

- **Immutable / history-preserving.** `cross_signal_comparison_results` rows
  and their child `cross_signal_comparison_left_relationship_states` rows
  are insert-only, inserted together atomically. No `UPDATE` path exists
  for `outcome`, `left`, `right`, or any temporal-basis field once
  recorded.
- **Tenant-scoped.** Every row (parent and child) carries
  `organisation_id`; every read is scoped by it; no cross-tenant join is
  possible even by identical `left`/`right` reference values (mirrors M14
  ADR §10's tenant discipline).
- **Evidence references, not copies.** `left`/`right` (and the child rows'
  `relationship_state_id` entries) store only the discriminated reference
  shape from §11 (ids + kind), resolved back to
  `execution_field_states`/`canonical_relationships`/the runtime table at
  read time — never a duplicated value that could drift from its source.
- **Replay/conflict semantics.** A unique constraint on the deterministic
  comparison identity (§13) — including, for `RELATIONSHIP_STATE_SET`, the
  sorted content of the child rows — enforces idempotent replay at the
  database layer, exactly as `admit_runtime_observation` already enforces
  replay on `(organisation_id, connection_id, trace_id, span_id)`.
- **Read model.** A typed read path (analogous to `runtime-row.ts`'s
  explicit column allowlist) projects parent+child rows back into typed
  `CrossSignalComparisonResult` values; no `SELECT *`, no arbitrary
  JSON/EAV escape hatch.
- **No destructive backfill.** Enabling M15 does not retroactively compare
  or rewrite pre-existing `RuntimeObservation`/`execution_field_states`/
  `canonical_relationships` rows; comparisons are computed going forward
  from explicit invocation, consistent with M14's "no historical rewrite"
  and M13's "no historical migration changes" precedents.

No migration, table, or SQL is created by this ADR task.

## 16. Downstream

M15 output is deliberately inert until a human or a later, separately
authorized milestone acts on it:

- **Governance Review.** `DRIFT_CANDIDATE`/`CONFLICT_CANDIDATE` results are
  natural candidates for a future human disposition surface (in V1
  practice, this means `CONFLICT_CANDIDATE` results only, per §7.1a), but —
  per the evidence table in §1 — the existing `ReviewSubject`/
  `review-state.ts` machine is structurally bound to `DiscoveryFinding`s
  and cannot represent a comparison result without fabricating a finding
  that does not exist. M15 therefore does not wire results into that exact
  machine. A future ADR must define an analogous but distinct closed
  disposition-state vocabulary and a
  `CrossSignalDispositionAuthorizationPort` following the same HUMAN-only
  `ReconciliationAuthorizationPort` pattern (`authorize()`, fail-closed, no
  default-permissive implementation) — this ADR authorizes only the
  read-only comparison record, not that future disposition workflow.
- **M16 controls.** May later define policies keyed on `(dimension,
  outcome)` — e.g. "alert on any `DEPENDENCY_TARGET_IDENTITY`
  `CONFLICT_CANDIDATE`" — but M15 grants M16 no authority to act
  automatically; M16 remains a consumer of the read model.
- **M17 Risk Intelligence.** May consume `CONFLICT_CANDIDATE` (and, once a
  future method reaches it, `DRIFT_CANDIDATE`) results as one evidenced
  risk-hypothesis input among others. A comparison result is not itself a
  risk, residual risk, or risk score.
- **M18 Workspace.** May render comparison results for CISO/Compliance/
  Owner personas as explainable evidence, with the same `UNKNOWN`/coverage
  honesty already required of Passport (no fabricated completeness).

No downstream layer gains canonical write, authorization, trust-promotion,
Graph-edge-creation, or LLM-authority capability from this ADR. Each
consumer listed above requires its own explicit architecture decision
before acting on M15 output beyond reading it.

## 17. Architecture impact A–O

| Dimension | Impact |
| --- | --- |
| A — CIA baseline | Additive L13+L16 decision under unchanged frozen `GOVIA-L0L16-CIA-v1.0`; no baseline/roadmap edits. |
| B — L0–L16 | L13/L16 primary — extends L13's existing `CURRENT_MAIN_FOUNDATIONAL` reconciliation base (§1) with the design-time-vs-runtime comparison it structurally lacked before L12 existed; does not rebuild it. Runtime-vs-runtime (source-to-source) correlation remains deferred (§7.3), not claimed. Reads already-governed L9 (relationships), L10/L11 (execution context), L12 (runtime) state; writes nothing back into any of those layers. No new layer. |
| C — Passport | No Passport UI change in this ADR. A future typed read adaptation could surface comparison results under existing families (13 Operation & Runtime, 14 Provenance & Trust) with explicit UNKNOWN/coverage; sixteen families remain unchanged. |
| D — Canonical | No new `CanonicalObjectKind`, no new `GovernedRelationshipType`, no canonical object/relationship writes. Comparison results reference existing canonical identities only, including a possibly-empty effective relationship-state set (§7.1, §14). |
| E — Lineage | No new lineage edge. A comparison result may later be surfaced as lineage-adjacent evidence, never as a synthetic `DERIVED_FROM`/`READS_FROM`/etc. edge. |
| F — Evidence/provenance | Every result is fully explainable to its exact `left`/`right` state references (never a decision or candidate id alone), method code/version, and explicit, boundary-tagged temporal bases (§11–§12) — never a governance decision's `decidedAt` fabricated as fact time, and never mere event ordering fabricated as supersession. No invented evidence. |
| G — Trust/authority | `OBSERVED`/`DECLARED`/`IMPORTED` inputs participate without promotion; comparison confers no `VALIDATED`, `CERTIFIED`, or authorization state (§9, §10). `RUNTIME ADMISSION != GOVERNANCE AUTHORITY`: a persisted `RuntimeObservation` is treated as evidence, never as having cleared a governance decision boundary (§3, §9). |
| H — Vector | Not involved. No embedding, similarity score, or vector authority in this comparison. |
| I — Graph | Not involved. No automatic Graph edge; Graph remains a read projection, never this ADR's system of record. |
| J — LLM | Not involved. No LLM call, parsing, or interpretation authority in computing a comparison result. |
| K — Tenancy/security | Every read/write tenant-scoped (§15); exact-binding-only subject resolution (§8) prevents cross-tenant comparison even under identical reference values. |
| L — Migration | Minimum additive typed persistence direction only (§15), including a normalized child table for the set-valued `DEPENDENCY_TARGET_IDENTITY` design-time reference; no migration created by this task. |
| M — Downstream continuity | M13/M14 remain unmutated (§9); M15 is a pure downstream reader that in turn becomes a pure upstream evidence source for Governance Review/M16/M17/M18, none of which gain automatic authority (§16). |
| N — Non-fabrication | No guessed binding, subject, dimension, ordering, correlation, or evidence reference; no fabricated `DRIFT_CANDIDATE` reachability (§7.1a) and no fabricated `RUNTIME_VS_RUNTIME` comparability (§7.3 — no trace/span, timestamp-proximity, `sourceEventKey`, same-`AGENT_VERSION`, or value-similarity fallback); unsupported dimensions/pairings and unresolved bindings fail closed (§6–§8, §11). |
| O — Acceptance/quality | Focused adversarial test set in §18 covering consistency, conflict, set-membership, expired-baseline, missing baseline, unresolved binding, ambiguous subject, replay, cross-tenant, unsupported-dimension and unsupported-pairing cases before any implementation is reported complete. |

## 18. Acceptance cases

Each case names its expected §4 outcome or rejection code. These are
architecture-level acceptance criteria for the future implementation, not
claims of current behavior.

| Case | Expected result |
| --- | --- |
| Design == runtime (runtime principal matches the exact materialized `execution_field_states` value; or runtime target is a member of the effective governed set) | `CONSISTENT` |
| A. Multiple active governed tools; runtime invokes one of them (two or more `USES_TOOL` relationship states effective at the event time; the proven runtime `TOOL` target matches one member) | `CONSISTENT` — set membership, not single-target equality (§7.1) |
| B. Multiple active governed targets; runtime invokes an ungoverned target (one or more relationship states effective at the event time; the proven runtime target matches none of them) | `CONFLICT_CANDIDATE` — never `DRIFT_CANDIDATE` |
| C. Only governed relationship expired before the runtime event (`validTo` strictly before the runtime event time; no other state of that type is effective at that time) | `INSUFFICIENT_EVIDENCE` / `DESIGN_TIME_BASELINE_NOT_EFFECTIVE` — an expired state is not an active baseline (§12.A) |
| D. Caller requests `RUNTIME_VS_RUNTIME` comparison in V1 | Pre-comparison rejection: `CROSS_SIGNAL_PAIRING_UNSUPPORTED` (§7.2, §7.3); no comparison result persisted, not even `INSUFFICIENT_EVIDENCE` |
| Governance decision recorded after a runtime event, but underlying design-time effective time is unknown (`PRINCIPAL_IDENTITY`, `DESIGN_TIME_VS_RUNTIME`: `ExecutionFieldDecision.decidedAt` is later than the peer `RuntimeObservation.startedAtUnixNano`, values disagree) | **MUST NOT** infer `DRIFT_CANDIDATE` from `decidedAt` ordering (§12.C); `CONFLICT_CANDIDATE` if otherwise comparable and evidenced, else `INSUFFICIENT_EVIDENCE` |
| Baseline missing (no `ACCEPT_PROPOSED` `execution_field_states` row exists yet for `PRINCIPAL`) | `INSUFFICIENT_EVIDENCE` / `DESIGN_TIME_BASELINE_MISSING` |
| Runtime binding unresolved (`RuntimeObservation.binding.state === 'UNRESOLVED'`) | `INSUFFICIENT_EVIDENCE` / `RUNTIME_BINDING_UNRESOLVED`; never a guessed subject |
| Ambiguous canonical subject (more than one exact mapping could apply) | Comparison not attempted; closed rejection, never a best-guess subject |
| Changed GitHub commit (a new `AcquisitionRun`/source snapshot feeds a new governed relationship state for the same `AGENT_VERSION`) | New `left` reference (new `relationshipStateId` enters the effective set) → a new comparison, never an update to a prior one (§13) |
| Repeated same commit/observation (identical `RuntimeObservation` redelivered) | Identical comparison identity → original result returned unchanged (§13) |
| Late/out-of-order runtime observation (earlier `startedAtUnixNano` arrives after a later one was already compared against the same design-time baseline) | Its own new comparison against that design-time baseline (§12, §13); no rewrite of the earlier comparison |
| Duplicate delivery (same admission retried) | Same as "repeated observation" — idempotent replay, no second effect |
| Conflicting replay (same comparison identity, different recomputed outcome due to an implementation bug) | Must fail closed as a replay conflict, mirroring `EXECUTION_REPLAY_CONFLICT`/M14 replay-conflict handling — never silently overwritten |
| Cross-tenant references (`left`/`right` resolve to different `organisationId`s, or a `RuntimeObservation` claims an out-of-tenant `AGENT_VERSION`) | Rejected before comparison; never compared, never persisted |
| A relationship state used in an earlier comparison's effective set is later closed (`validTo` set) by a new decision | The earlier comparison's `left` reference (the historical resolved set) remains valid/immutable (history preserved, §13); a *new* comparison at a new/different runtime event time resolves its own effective set independently — never a silent update to the earlier row |
| UNKNOWN vs false/zero/absent (`RuntimeObservation.context.principal.state === 'UNKNOWN'`) | `INSUFFICIENT_EVIDENCE`; never treated as "no principal" / a value to compare against |
| Unsupported dimension (e.g. a caller requests `TOPOLOGY_DRIFT`) | Rejected pre-comparison with `CROSS_SIGNAL_DIMENSION_UNSUPPORTED`; never a persisted `INSUFFICIENT_EVIDENCE` row (§4) |
| Evidence missing (a referenced `assertionId`/`evidenceId` cannot be resolved) | `INSUFFICIENT_EVIDENCE`, never fabricated evidence |
| Source version missing where required (`RuntimeObservation.sourceConfigurationVersion` or method version absent) | Comparison not attempted; version provenance is mandatory per §5 rule 5 |
| RuntimeObservation admission mistaken for governance authority (an implementation treats a persisted `RuntimeObservation` as if it had cleared a governance decision) | Verified never to occur: only `execution_field_states`/governed relationship states (materialized decisions) are treated as design-time authority-bearing input (§3, §9) |
| No automatic canonical write | Verified: comparison computation touches no `canonical_objects`/`canonical_relationships`/`execution_field_states` write path |
| No automatic trust promotion | Verified: comparison computation never sets `trustState` on any input, and never writes `VALIDATED` anywhere |
| No Graph/Vector/LLM authority path | Verified: comparison computation calls no Graph write, no embedding/similarity call, no LLM call |

## 19. Definition of Done for implementation

Architecture freeze is not implementation completion. A future
implementation-readiness pass must separately establish:

1. This ADR is accepted through the architecture freeze gate with explicit
   owner approval recorded in §21.
2. Closed `CrossSignalComparisonResult` typed contract and the **two**
   closed §7.2 method codes implemented in `@council/canonical-contracts`
   (`CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1`,
   `CROSS_SIGNAL_DEPENDENCY_TARGET_DESIGN_RUNTIME_V1`), including the
   `RELATIONSHIP_STATE_SET` and boundary-tagged temporal-basis shapes
   (§11). No `RUNTIME_VS_RUNTIME` method code is implemented.
3. Pure domain comparison functions (one per dimension, both for V1's sole
   pairing mode `DESIGN_TIME_VS_RUNTIME`, §7.2) in `governance-review`,
   structurally mirroring `runtime-observation.ts`'s reject-before-attempt
   validation style, including effective-set resolution at the runtime
   event time for `DEPENDENCY_TARGET_IDENTITY` (§7.1, §12.A), and a
   pre-comparison `CROSS_SIGNAL_PAIRING_UNSUPPORTED` rejection for any
   requested `RUNTIME_VS_RUNTIME` pairing (§7.2, §18 case D).
4. Read adapters in the dashboard layer that resolve `left`/`right`
   references to exact materialized states —
   `execution_field_states.executionFieldStateId`, governed
   `relationship_state_id`s, or `RuntimeObservation.observationId` — never
   a decision or candidate id alone, with the same tenant-scoped,
   explicit-column-allowlist discipline as `runtime-row.ts`/
   `execution-context-read.ts`.
5. Additive migration for `cross_signal_comparison_results` and its
   `cross_signal_comparison_left_relationship_states` child table
   satisfying §15, with a unique constraint enforcing the §13
   deterministic identity (including sorted child-row content).
6. Concurrent-replay and conflicting-replay behavior demonstrated against a
   real controlled database (not structural/in-memory checks alone).
7. All §18 acceptance cases demonstrated, including cases A–D, and every
   cell of the §7.1a reachability table verified — in particular that
   **no V1 method ever produces `DRIFT_CANDIDATE`**, regardless of
   `decidedAt` ordering, `startedAtUnixNano` ordering, or an expired
   relationship state's `validTo`.
8. No regression in M13/M14/M7/M10 read or write behavior (existing test
   suites for `execution-context`, `runtime-observation`,
   `reconciliation-invocation`, `technical-fact-persistence` continue to
   pass unmodified).
9. Explicit, separate follow-up ADR before any Governance Review
   disposition workflow, M16 control, M17 risk consumption, or M18
   Workspace surface is implemented against this output (§16).
10. Any future attempt to make `DRIFT_CANDIDATE` reachable requires its
    own explicit ADR revision establishing either a future execution-context
    fact-valid-time producer or an independently proven state-transition/
    change-point model (e.g. resolving `supersedesRelationshipStateId`
    chains) — never a reinterpretation of §7.1a by implementation
    convenience.
11. Any future attempt to support `RUNTIME_VS_RUNTIME` requires its own
    explicit ADR revision establishing an independently proven,
    tenant-scoped cross-source event/correlation identity — never
    trace/span matching, timestamp proximity, a `sourceEventKey` guess,
    "same `AGENT_VERSION`" alone, or value similarity (§7.3) — plus its own
    canonical `left`/`right` ordering rule (§13). Verify pre-comparison
    rejection (`CROSS_SIGNAL_PAIRING_UNSUPPORTED`) remains in place until
    that ADR is accepted.

## 20. Non-goals and current-state honesty

This ADR does not implement TypeScript, does not add a migration, does not
mutate Supabase, does not change the canonical object/relationship
taxonomies, does not add Graph/Vector/LLM behavior, and does not start
M16/M17. Its architecture freeze (§21) does not itself implement any of
these either — freeze authorizes M15 implementation, it does not perform
it.

Where the 2026-09-08 conformance report or any older document might suggest
M14/M13 were unimplemented, unmigrated, or stub-only, current repository
evidence (§1's table; `20260917021203_runtime_observability_v1.sql`,
`20260915230551_execution_context_v1.sql`, and their corresponding
TypeScript) wins for implementation-status claims, while the frozen
`GOVIA-L0L16-CIA-v1.0` baseline continues to win for architectural
authority. This ADR does not silently modify that baseline to match
implementation convenience, and defines no new invariant that contradicts
it. It also does not fabricate `DRIFT_CANDIDATE` reachability merely to
make M15 appear more capable than the current evidence supports (§7.1a).

## 21. Review and freeze gate

This document is **ACCEPTED / FROZEN**. Explicit architecture-owner
approval was given on **2026-09-22** for this document exactly as written,
following the same freeze-gate discipline the M13 and M14 ADRs recorded in
their own §19/§Freeze-record sections.

- `GOVIA-L0L16-CIA-v1.0` remains **FROZEN AND UNCHANGED** by this approval.
- This freeze **authorizes M15 architecture for implementation**.
- Architecture freeze does **NOT** mean M15 implementation is complete —
  see §19's Definition of Done, which remains entirely outstanding.
- This approval makes **no roadmap change**: milestone numbering,
  sequencing, and scope under `GOVIA-L0L16-CIA-v1.0-roadmap.md` are
  unchanged.
- This approval makes **no canonical taxonomy change**: the closed eleven
  `CanonicalObjectKind` and twelve `GovernedRelationshipType` remain
  exactly as frozen (§14).
- This approval grants **no authority expansion** beyond what §9's
  authority ceiling already permits: a `CrossSignalComparisonResult`
  still confers no canonical write, trust promotion, authorization, or
  Graph/Vector/LLM authority.

Final document verdict:
**CONFORMANT_WITH_GOVIA_L0L16_CIA_V1_0 — ACCEPTED_FROZEN**
