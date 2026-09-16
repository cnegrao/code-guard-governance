# Gov IA Runtime Observation & OTel Ingestion V1

Status: **PROPOSED FOR ARCHITECTURE REVIEW**

Date: 2026-09-16. Verified repository baseline: `cnegrao/code-guard-governance`,
local `main` and `origin/main` at
`21830fe127d423038a041fb07f2011c778ed86d9` after fetch and fast-forward-only pull.

**GOVIA-L0L16-CIA-v1.0 remains FROZEN AND UNCHANGED.** M13 is merged and frozen;
the Enterprise API ADR is accepted, frozen and merged. **M14 IMPLEMENTATION
NOT STARTED.** This document proposes the minimum architecture to freeze before
implementation; its normative decisions become accepted only through section 19.

## 1. Purpose, authority and current evidence

Resolve the M14 readiness verdict **STOP_REQUIRES_ARCHITECTURE_DECISION** by
defining direct runtime observation without conflating it with M13 design-time
state, M15 reconciliation, canonical truth or a general observability platform.

Authoritative references, unchanged by this proposal:

- [Frozen CIA baseline](./GOVIA-L0L16-CIA-v1.0.md), including L12, trust,
  exact AgentVersion semantics and the mandatory A–O mapping.
- [Frozen roadmap](./GOVIA-L0L16-CIA-v1.0-roadmap.md): M14 owns L12; M15 owns
  cross-signal reconciliation and drift; public Enterprise API remains M19C
  under the accepted Enterprise ADR's recommended placement.
- [Baseline adoption ADR](./ADR-GOVIA-L0L16-CIA-v1.0.md).
- [Exact canonical endpoint/source mapping ADR](./ADR-GOVIA-CANONICAL-ENDPOINT-IDENTITY-AND-SOURCE-MAPPING-GRANULARITY-v1.md).
- [Field/fact authority ADR](./ADR-GOVIA-FIELD-FACT-AUTHORITY-AND-MULTIVENDOR-RECONCILIATION-v1.md).
- [M13 execution-context ADR](./ADR-GOVIA-EXECUTION-CONTEXT-IDENTITY-CONNECTIVITY-AUTHZ-v1.md).
- [Enterprise API ADR](./ADR-GOVIA-ENTERPRISE-API-AND-DEVELOPER-PLATFORM-v1.md),
  especially separate INTERNAL, INTEGRATION and ENTERPRISE surfaces and the
  prohibition on direct canonical writes through trusted integrations.

Current code and later merged milestones supersede stale 2026-09-08 conformance
conclusions. M13 merged through PR #34 (`bc3bbdf`); the Enterprise ADR merged
through PR #35 (`21830fe`). Earlier evidence banners saying NOT MERGED describe
their original delivery stage, not current Git state. They do not certify live
production deployment or database behavior.

| Foundation | Current evidence and reuse boundary |
| --- | --- |
| Source/provenance vocabulary | [Canonical contracts](../../packages/canonical-contracts/src/contracts.ts) already include source family RUNTIME, OBSERVED trust, source connections, assertions, evidence and temporal support. Vocabulary is not an implemented telemetry producer. |
| Exact identity | Existing tenant-scoped normalized mappings and canonical AGENT_VERSION references are reusable after runtime association is proven; candidate IDs or fingerprints alone are insufficient. |
| M13 | [Latest implementation evidence, sections 28–31](../codex/evidence/2026-09-15-connectivity-execution-identity-authz-v1-validation.md), [typed contracts](../../packages/canonical-contracts/src/execution-context.ts) and [persistence](../../supabase/migrations/20260915230551_execution_context_v1.sql) support narrow declarations of capability, principal, requested scope and connectivity. They are not runtime observations or proof of live grants/environment/network state. |
| Passport | [Typed families](../../apps/dashboard/lib/governance/agent-passport.ts) currently have `runtime: never`; [query](../../apps/dashboard/lib/governance/passport-query.ts) explicitly returns runtime UNKNOWN. |
| Discovery | [Intake service](../../apps/dashboard/lib/governance/discovery-intake.ts) exists; current callers of `runGovernanceDiscoveryScan` are tests, not a live production trigger. |
| Runtime gap | No core RuntimeObservation contract, supported OTel adapter, accepted runtime producer or runtime persistence exists at the verified base. Next's optional OTel peer dependency does not supply these capabilities. |
| Legacy boundary | Extension cost/router/dispatcher code and graphos-complete billing/usage prototypes are LEGACY_DO_NOT_EXTEND for M14. Static FinOps estimates, zero defaults and heuristic costs cannot become observed facts. |

## 2. Core decision and invariants

**M14 records DIRECT RUNTIME OBSERVATIONS:** evidence of actual runtime behavior.
An observation does not automatically establish canonical identity, a canonical
relationship, authorization, a grant, policy compliance, intended configuration,
declared capability or validated governance truth.

```text
SOURCE ASSERTION != CANONICAL FACT
DESIGN-TIME DECLARATION != RUNTIME OBSERVATION
OBSERVATION != GOVERNANCE AUTHORITY
UNKNOWN != FALSE
MISSING EVIDENCE MUST NEVER BE FABRICATED
CAPABILITY != AUTHORIZATION
GRANT != AUTHORIZATION
GRAPH != SYSTEM OF RECORD
LLM OUTPUT != CANONICAL TRUTH
```

Scanner machine authority remains PROPOSED. Runtime observation admission is
separate from scanner proposal governance and does not promote scanner output.
High confidence, successful calls and authenticated delivery confer no governance
authority. The closed eleven canonical object kinds and twelve relationship types
remain unchanged; AGENT remains logical identity and AGENT_VERSION technical state.

## 3. Closed typed observation contract

Use one common observation envelope and a closed discriminated union:

| Kind | Meaning and typed target |
| --- | --- |
| EXECUTION | Root/runtime execution observation for the observed execution scope. It is not proof that the complete distributed trace was collected. |
| MODEL_CALL | Actual model invocation; supported model/provider references and optional usage/cost evidence. |
| TOOL_CALL | Actual tool invocation; supported tool reference. |
| MCP_CALL | Actual MCP call; supported MCP_SERVER reference and operation/tool reference when directly evidenced. |
| API_CALL | Actual API call; supported safe API/endpoint reference and protocol result. |

These are observation kinds, **not canonical object kinds**. A call may arrive
without its execution observation or parent span. Do not manufacture a root,
parent, target or completed trace. Kind selection requires supported source
semantics, not a guessed span name. One supported span yields one observation
kind; nested spans may represent distinct operations, without duplicating one
span into several counted calls.

The envelope and each kind have explicitly typed, bounded fields. Their minimum
semantic coverage is:

- Observation identity, trusted tenant and accepted source scope.
- Source event identity, traceId/spanId and parentSpanId where supported;
  execution/correlation reference only when directly supplied and safe.
- Exact/unresolved subject binding and immutable support.
- Typed target references, with independent canonical proof if attached.
- Distinct temporal fields, source status and evidenced outcome.
- Duration/latency, error category, optional usage and cost with their basis.
- Optional directly observed principal, environment or network facts.
- Source/method, instrumentation, adapter/schema versions and provenance.
- Explicit uncertainty, sampling and coverage limitations.

No arbitrary attributes, field paths, OTHER payload escape hatch or generic
JSON/EAV may replace domain semantics. Unsupported kinds are rejected with safe
codes. Optional unsupported facts remain unavailable. Closed JSON may be used
as transport, but is not permission for untyped semantic persistence.

## 4. Event identity, scope and replay

Semantic event/replay identity includes **trusted tenant + accepted runtime
source/connection scope + stable source event identity**. For supported OTel spans:

```text
tenant + accepted source scope (including connection) + traceId + spanId
```

Trace ID alone is not globally authoritative. Span/parent lookups, read filters,
caches, uniqueness and joins preserve tenant and source scope. Cross-source
correlation requires explicit, supported scope; equal trace IDs do not authorize
joining tenants or treating independent exporters as one accepted source.

Receipt time, persistence time, delivery-attempt IDs and database row IDs are not
semantic replay identity. A durable observation ID identifies that scoped event;
the exact ID encoding is an implementation choice, not a new canonical identity.

Identical replay returns the original durable result, including original binding,
provenance and receipt/recorded times. Conflicting reuse of the same event identity
fails closed, without overwrite, last-write-wins or a second observation. Enforce
this atomically under concurrent delivery using database uniqueness and semantic
content comparison. Digest inputs are validated, sanitized metadata, never raw
telemetry/content. Delivery bookkeeping, if needed, is separate from the immutable
observation. Retention must not silently defeat replay guarantees; the implementation
must define a bounded retention/replay policy and retained deduplication support.

V1 has no mutable span-upsert protocol. An accepted span snapshot is immutable;
later changed content under its identity is conflicting reuse, even if it supplies
an end time. The selected source contract must define which snapshot it exports.
Partial evidence may retain missing fields as UNKNOWN, without inventing closure.
Streaming span revisions or observation corrections require separate explicit
semantics and are outside this V1 decision.

Replay still requires authorized tenant/source access. It does not re-evaluate
the original result under a new binding, adapter or source-admission version.
An adapter upgrade must not silently rewrite historical observations.

## 5. Exact AgentVersion binding

There are exactly two subject binding states:

| State | Contract |
| --- | --- |
| EXACT | Runtime evidence proves association with exactly one existing tenant-local canonical AGENT_VERSION. Immutable/auditable support records the source coordinates, proof method/version and exact mapping or deployment association used. |
| UNRESOLVED | Retain the observation with safe source coordinates and a closed typed reason; assign no canonical AGENT_VERSION. Initial reasons cover missing revision evidence, no exact mapping, ambiguous mapping and unsupported binding proof. |

An EXACT resolver must verify tenant, object existence/kind and the association
between the observed running artifact/deployment and that exact technical version.
Existence of a supplied canonical ID is not proof that it executed. Reuse existing
exact governed mappings only when this runtime association is independently
supported. A new deployment binding protocol must be explicit in implementation
readiness; this ADR does not pretend one is already implemented.

Forbidden substitutes: payload agentVersionId alone; AGENT fallback; latest/current
version; display name; service name alone; arbitrary version label; directory
proximity; repository commit alone; behavior fingerprint alone; parent trace
context alone. Fingerprints and commits can support proof but cannot replace it.

Foreign-tenant binding fails closed. Ambiguity becomes UNRESOLVED or rejection
according to the accepted source contract, never a guessed match. Each call's
subject requires support; a parent's subject is not inherited automatically.
Invalid/foreign references must not be laundered through an unresolved record.

Future resolution must preserve the original observation, original UNRESOLVED
state and support. Any later binding record must be explicit, auditable and
separate; no silent historical rebinding or runtime-driven canonical creation.
V1 does not implement a general resolution/reconciliation workflow.

## 6. Target references and relationship boundary

```text
OBSERVED TARGET REFERENCE != CANONICAL TARGET IDENTITY
```

MODEL, TOOL, MCP_SERVER and API target references retain supported provider/source
scope and safe technical coordinates. Missing references remain unknown; a call
need not fabricate a canonical target to be retained. Attach an existing canonical
target only with independent exact tenant-local identity proof and correct kind.
Canonical target binding does not imply a governed relationship to the subject.

A successful observed call must not create INVOKES, USES_TOOL, USES_MODEL or
USES_MCP. The same prohibition applies to inferred READS_FROM/WRITES_TO edges.
Observed execution parentage is telemetry structure, not canonical lineage.
M15 may later reconcile these observations against governed design-time facts.

## 7. Accepted runtime source and trust

Reuse SourceSystem, SourceConnectionReference, source identity, evidence,
source/method and the existing trust vocabulary where semantically correct.
SourceAssertion remains a provenance envelope, not an arbitrary fact store.

A narrow **ACCEPTED RUNTIME SOURCE** configuration is scoped by trusted tenant,
source system/provider, source connection, producer/instrumentation identity
where required, supported kinds/facts, adapter/schema versions and the supported
binding proof contract. Trusted administration controls this configuration;
the telemetry payload cannot declare itself accepted. Record the immutable
configuration version used at admission. Missing, conflicting, unsupported or
inactive admission configuration fails closed for new observations.

Authentication establishes ingestion access. Source acceptance establishes which
facts this source is allowed to assert as direct observations. Neither establishes
canonical fact authority. Successful source authentication is also not evidence
of the governed AgentVersion's execution principal.

OBSERVED applies only to facts directly evidenced by supported runtime telemetry.
Copied configuration/resource attributes do not automatically prove an observed
principal, environment, network path, reachability or authorization. Source-specific
evidence must distinguish measured/reported runtime facts from declarations. Where
that distinction cannot be supported, omit the optional runtime fact as UNKNOWN.
No hostname/IP/region naming inference may fill it.

No automatic VALIDATED, AUTHORIZED, COMPLIANT or GOVERNED promotion is permitted.
Deterministic derivations retain their own basis and method; an OBSERVED envelope
must not label a derived cost as a directly observed charge. Exact binding does not
upgrade the trust of unrelated fields. Do not introduce a parallel generic
governance framework or extend M10/M13 closed field policies to arbitrary telemetry.

## 8. OTel boundary and real producer

M14 SHALL support a versioned adapter from supported OpenTelemetry span semantics
to the closed Gov IA RuntimeObservation model:

```text
supported runtime producer
  -> bounded internal/integration ingestion boundary
  -> versioned OTel adapter
  -> closed RuntimeObservation contract
  -> validation/sanitization
  -> typed persistence
  -> typed readback
```

The boundary validates authentication, source scope, payload size and bounded
work. The adapter extracts only allowlisted fields; sensitive raw input must not
reach logs, hashes or diagnostics before the explicit validation stage. All
persistence/readback receives only validated safe metadata.

Pin supported OTel semantic-convention versions and adapter versions, including
GenAI/MCP mappings where used. Preserve trace/span/parent context, instrumentation
identity/version, timestamps and source status. Unknown conventions do not unlock
unrestricted attribute persistence. Validate identifier formats without claiming
that valid syntax proves identity or trace completeness.

OTLP/HTTP transport is optional unless required by the selected controlled producer.
A custom Gov IA ingestion DTO must never be advertised as OTLP-compatible unless
it actually conforms to OTLP, including supported encoding/response behavior.
Internal/integration ingestion does not implement the Enterprise public `/v1` API.
Trusted inbound telemetry may record evidence, never bypass canonical governance.

No full Collector deployment, telemetry backend, generic logs/metrics ingestion
or replacement for Datadog, Grafana, Azure Monitor, CloudWatch or Splunk is required.

**At least one REAL CONTROLLED runtime producer is mandatory for M14 acceptance.**
Fixtures alone cannot prove runtime observation. Repository evidence does not
establish an appropriate existing core producer, so this ADR selects no vendor
or final producer. Implementation readiness must choose the smallest controllable
producer, document its actual instrumentation and binding support, and demonstrate
real execution through ingestion, persistence and typed readback. Synthetic test
payloads remain fixtures; tests against a controlled stub must not be reported as
real external-provider model inference or billing.

Reference specifications: [OTel tracing API](https://opentelemetry.io/docs/specs/otel/trace/api/),
[OTLP](https://opentelemetry.io/docs/specs/otlp/) and
[GenAI/MCP conventions](https://github.com/open-telemetry/semantic-conventions-genai).
These external specifications inform versioned adapters, not Gov IA governance
authority. Exact supported revisions must be recorded before implementation acceptance.

## 9. Time, status, measurements and availability

| Dimension | Required semantics |
| --- | --- |
| Event/start time | Source-reported occurrence/start of the supported operation. Missing required event time rejects the input; never replace it with receipt time. |
| End time | Optional, only when supplied/supported. Missing end does not imply still running, failure or completion. |
| Source-observed time | Separate optional source observation timestamp where supplied; do not fabricate it from another clock. |
| Server received time | Server-owned arrival time at ingestion, independent of source timestamps. |
| Persisted/recorded time | Server/database-owned durable recording time, separate from arrival and event time. |
| Latency/duration | Nonnegative measurement or deterministic derivation with units and basis. A start/end calculation records those inputs/method; invalid intervals are not clamped to zero. Receipt minus start is not operation latency. |
| Source status | Preserve the supported source status faithfully; for OTel, UNSET/OK/ERROR remain distinguishable. |
| Outcome | UNKNOWN, evidenced SUCCESS or evidenced ERROR/FAILURE; absence of error and OTel UNSET do not imply success. Protocol-specific outcomes require a supported mapping and direct result evidence. |
| Errors | Bounded typed category/code supported by the adapter; unsupported category stays UNKNOWN. No raw exception message/stack or status description persistence. |
| Availability | Observed successes/failures are evidence for the covered operations/time window only. No finite sample, empty result or successful call proves global service availability. |

Out-of-order delivery must not rewrite event chronology. Preserve clock/basis
limitations; do not impose invented cross-machine timestamp ordering. Missing
parents and sampling gaps are explicit coverage limits, not absence of execution.
Any bounded aggregation must retain its sample/window, unknown outcomes and
collection limitations. No SLO/SLA architecture is introduced.

Token counts are optional directly supplied facts. Preserve supported count type
and units, including input/output distinctions where supplied. Validate supported
nonnegative counts; absent tokens remain UNKNOWN, never zero. Do not infer tokens
from text length, requested limits, another call or a parent span.

Cost has two allowed categories:

- **SUPPLIED:** directly supplied by an accepted runtime source with currency
  and its supported charge/usage scope. It is not automatically a certified bill.
- **DERIVED:** deterministic calculation only with complete usage inputs and an
  exact versioned/auditable pricing basis. Retain currency, pricing source,
  pricing version/effective basis, applicable model/rate, usage inputs and
  calculation method/version, including rounding rules.

Missing usage, pricing or applicability inputs leave cost UNKNOWN. Preserve
supplied and derived bases distinctly if both are present; do not overwrite one
or count both as separate spend. Do not double-count retries/duplicate deliveries
or aggregate parent and child costs without explicit non-overlapping scope.
No generalized pricing feed, heuristic multiplier or estimated savings is a
runtime fact. Deterministic derived cost is labeled DERIVED, not direct OBSERVED
billing and not a new trust-vocabulary synonym.

## 10. Tenancy, privacy and fail-closed sanitization

Tenant comes from trusted ingestion/auth context and configured connection
ownership, never payload tenant authority, a raw header, trace ID or source label.
Verify tenant-local membership of every source, subject, target, evidence and
binding reference. Scope reads, cache keys, parent lookups and replay queries.
Privileged database credentials do not replace these checks or resource access
authorization. Enforce database tenant constraints and appropriate RLS/grants.

M14 is metadata-first. Default exclusion covers prompts, completions, request and
response bodies, tool arguments/results, headers, cookies, Authorization headers,
API keys, authentication tokens, client secrets, private keys, credential-bearing
URLs, arbitrary baggage, raw exception messages and stack traces. This exclusion
also covers arbitrary span names, resource attributes or descriptions that could
embed content. Token *counts* are distinct from secret authentication tokens.

Only explicitly allowlisted safe metadata may persist. Apply source-specific
extraction and validation before persistence, hashing, logging or error reporting.
Do not retain excluded content in raw archives, dead-letter payloads, debug logs,
error echoes or raw-content hashes. Use value-free typed rejection codes.

Reject an observation if a required identity field is unsafe. Optional excluded
content is discarded; never use it for binding or a semantic digest. If safe
identity cannot survive source-specific extraction, rejection is preferable to
guessing or lossy identity substitution. URL query/fragment/userinfo exclusion
does not certify arbitrary paths or opaque strings as non-secret. Existing
sanitizers are reusable building blocks, not a universal secret/PII detector.
Minimize principal/user identifiers; retain only the safe reference grain the
accepted source contract can defend.

## 11. Typed persistence and readback

Use additive typed PostgreSQL persistence, separate from M13 execution-context
tables and canonical object/relationship tables. PostgreSQL/Supabase remains the
canonical SoR; storing observations there does not make them canonical facts.
No generic runtime JSON/EAV or arbitrary OTLP blob storage is permitted.

Persistence must support tenant isolation, immutable event identity and factual
content, atomic replay/conflict handling, closed kinds, exact/unresolved binding,
distinct times, typed results/usage/cost, source/method/adapter versions, immutable
evidence and coverage limits. Use tenant-scoped keys/FKs and kind/binding constraints;
service-only admission writes and authorized bounded typed reads preserve the
same domain checks. Exact table names and indexes belong to implementation design.

Reuse compatible provenance/evidence primitives and history patterns without
forcing runtime events into Discovery candidates, canonical objects or M13 facts.
Source admission, observation persistence and canonical materialization remain
different operations. No observation ingestion path can write canonical truth.

The implementation must validate database replay concurrency, RLS and tenant
constraints in an actual controlled database. Structural SQL checks or in-memory
stores alone cannot certify these behaviors. M13's recorded database validation
limitations are not proof of M14 readiness or production deployment.
**No migration or runtime table is created by this ADR task.**

## 12. M13 continuity

```text
DECLARED ENDPOINT != OBSERVED CALL
DECLARED PRINCIPAL != OBSERVED RUNTIME PRINCIPAL
REQUESTED SCOPE != OBSERVED ACCESS
GRANT != OBSERVED SUCCESS
```

Runtime observations do not mutate M13 snapshots, decisions, history or
AgentVersion fingerprints. Principal/environment/network observations do not
create a new behavior version. An observed success cannot change M13 authorization
UNKNOWN into ALLOWED or reinterpret requested scope as grant.

M14 may reference immutable M13 IDs only with exact semantic justification and
tenant/version support. Never attach latest execution context automatically or
choose design-time state by newest timestamp. Temporal design-state comparison
belongs to M15, not observation ingestion.

## 13. M15 handoff and downstream exposure

M14 supplies immutable typed evidence: observation ID, binding state/proof,
observed targets and any independently proven canonical targets, times,
source/method/adapter versions, outcome, measurements and coverage/uncertainty.

M14 does not implement design-time/runtime comparison, drift, conflict
interpretation, reconciliation or automatic governance decisions. An unmatched
observation is not automatically drift; missing telemetry is not proof of no call.
M15 owns these comparisons and their temporal/authority decisions.

Passport may later gain a typed Family 13 Operation & Runtime read adaptation,
with Family 14 provenance, exact version scope and explicit UNKNOWN/coverage.
Unresolved observations must not populate an arbitrarily selected AgentVersion's
Passport. There are still sixteen families, no fabricated completeness and no
new Passport canonical object. No UI expansion is required by this ADR.

Graph remains projection, never SoR. Observations create no automatic canonical
Graph edges. Vector has no authority role and needs no M14 work. LLM has no runtime
fact creation, binding, reconciliation or acceptance authority. No embeddings,
LLM calls or Graph expansion are required for this milestone.

## 14. Live Discovery trigger

Live Discovery trigger remediation is **UNRELATED** to the minimum M14
architecture and potentially **USEFUL_FOR_DEMO**, not an M14 dependency.
The current intake service is callable but has no live production trigger in
the inspected application path. M14 can retain UNRESOLVED observations and can
demonstrate EXACT binding against already-governed AgentVersion state through
supported runtime binding proof. It need not create a new Discovery trigger.
This ADR neither resolves nor conceals that separate production gap.

## 15. Architecture impact A–O

| Dimension | Proposed impact |
| --- | --- |
| A — CIA baseline | Additive L12 decision under unchanged frozen GOVIA-L0L16-CIA-v1.0; no baseline/roadmap edits. |
| B — L0–L16 | L12 primary; L0 provenance, L4 version references and L10/L11 directly observed context. L13/L16 comparisons remain M15; no new layer. |
| C — Passport | Future Family 13 typed read adaptation and Family 14 provenance; sixteen families, UNKNOWN and bounded coverage retained. |
| D — Canonical | Existing exact AGENT_VERSION/target references only; no object kinds, relationship types, canonical writes or fingerprint changes. |
| E — Lineage | Observed execution ancestry and support remain evidence; no synthetic canonical lineage edges or completeness claims. |
| F — Evidence/provenance | Immutable source scope, admission version, event identity, methods, binding proof and temporal support; no raw content archive. |
| G — Trust/authority | OBSERVED only for directly supported facts; authentication/admission/binding do not confer governance or authorization authority. |
| H — Vector | No required change and no identity/truth/acceptance authority. |
| I — Graph | Existing analytical projection preserved; no automatic runtime edges or SoR role. |
| J — LLM | No runtime fact creation, binding, reconciliation or acceptance authority. |
| K — Tenancy/security | Trusted tenant/connection, scoped replay and joins, exact reference checks, database isolation and fail-closed metadata minimization. |
| L — Migration | Future additive typed persistence only; no historical rewrite/backfill and no migration or SQL execution in this task. |
| M — Downstream continuity | M13 remains design-time/imported history; M15 receives evidence; internal/integration ingestion remains separate from M19C and M20. |
| N — Non-fabrication | No guessed version, target, time, principal, network, grant, success, tokens, cost or global availability. |
| O — Acceptance/quality | Accepted ADR, real controlled producer, end-to-end typed readback and focused domain/database/adversarial tests; no fixture-only runtime claim. |

## 16. M14 V1 Definition of Done

This is acceptance direction for later implementation, not a claim of completion:

1. Runtime Observation ADR accepted through the architecture freeze gate.
2. Closed typed RuntimeObservation envelope and discriminated kinds implemented.
3. Versioned supported OTel mapping with pinned semantic conventions.
4. At least one REAL controlled runtime producer with documented source support.
5. Real producer -> ingestion -> sanitization -> persistence -> typed readback demonstrated.
6. EXECUTION / MODEL_CALL / TOOL_CALL / MCP_CALL / API_CALL typed coverage, with only honestly evidenced facts populated; fixture coverage distinguished from actual producer coverage.
7. EXACT and UNRESOLVED AgentVersion binding, including immutable proof and safe unresolved reasons.
8. Trusted tenant/runtime-source admission and source configuration version support.
9. OBSERVED applied only to direct runtime evidence; derivation basis explicit.
10. Replay/idempotency under concurrent duplicate delivery demonstrated.
11. Conflicting event identity rejected without overwrite or a second effect.
12. Event/start, optional end/source-observed, receipt and recorded times distinguished.
13. UNKNOWN never collapsed to zero, false, denial or success; OTel UNSET preserved.
14. Secret/content exclusion verified before storage, hashing, logs and errors.
15. Tokens/cost populated only when supported; derived cost has complete versioned pricing/input/method support.
16. No automatic canonical object or relationship creation from observations.
17. No authorization, grant or compliance inference from observed calls.
18. No M13 snapshot/decision/history mutation or AgentVersion fingerprint change.
19. No M15 reconciliation/drift or automatic governance decision logic.
20. Tenant/RLS/database acceptance tests, including concurrent replay and cross-tenant references, executed in a controlled database.
21. No Graph/Vector/LLM authority regression; no fabricated Passport completeness.

## 17. Focused acceptance cases

Test tenant spoofing and foreign source/subject/target/evidence/parent references;
same trace/span IDs in different tenants/connections; identical and conflicting
concurrent delivery; changed source configuration/adapter and preserved historical
results; missing/ambiguous/forged version association and all prohibited fallbacks.

Test real execution versus hand-authored fixtures, declared resource metadata
versus observed facts, every kind's supported targets, missing/out-of-order parents,
partial traces and distinct clocks. Test UNKNOWN/UNSET, explicit success/failure,
invalid intervals/counts, missing versus zero tokens, supplied versus derived cost,
missing pricing inputs, rounding/version provenance and duplicate accounting.

Inject sensitive content into attributes, span names, URLs, headers, baggage,
principal references and exceptions. Verify value-free rejection and absence from
persisted values, digests, diagnostics and readback. Verify no canonical write,
authorization inference, M13 mutation, fingerprint change, M15 logic or
Graph/Vector/LLM authority path. Report actual controlled producer coverage and
database results separately from fixture/unit/structural checks.

## 18. Non-goals and consequences

Explicitly defer full OTel Collector/backend infrastructure; generic logs and
metrics; broad vendor adapters; generalized pricing feeds; SLO/SLA and alerting
platforms; content capture; Discovery trigger remediation; M15 reconciliation/drift;
Graph/Vector expansion; Enterprise `/v1` API; M20 events/webhooks/durable delivery.

The typed adapter and accepted-source boundary add deliberate validation work.
Incomplete telemetry can still be retained safely as unresolved/partial evidence;
Gov IA does not need to replace an observability backend to govern that evidence.
No exact identity, authorization or coverage is invented to improve presentation.

After acceptance, implementation readiness must identify the real producer,
supported convention revisions, runtime binding protocol, safe source positions,
transport choice and bounded retention/replay policy. This ADR does not claim
these implementation inputs already exist and does not authorize starting M14.

## 19. Review and freeze gate

This document remains **PROPOSED FOR ARCHITECTURE REVIEW**. It is not
ACCEPTED/FROZEN. Freeze requires independent adversarial review, resolution of
all CRITICAL/HIGH findings, and explicit architecture-owner approval. Author
self-review, documentation checks, a commit or opening a PR do not satisfy that
gate. Outstanding findings and their disposition must remain visible to approval.

This task creates only this ADR. It creates no migrations, runtime tables,
ingestion routes, OTel dependencies or implementation changes; it does not modify
the roadmap, start M14/M15, implement Enterprise API or apply remote SQL.
The documentation PR must not be merged by this task.

Final document verdict:
**CONFORMANT_WITH_GOVIA_L0L16_CIA_V1_0 — PROPOSED_FOR_FREEZE**
