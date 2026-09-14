> Current status (2026-09-14): **MULTIVENDOR_EXCHANGE_MVP_V1_READY_FOR_REVIEW**.
> Sections 1-31 preserve the original accepted STOP and readiness history.
> Sections 32 onward record the authorized continuation and implementation.

# Milestone 10: Microsoft Purview inbound MVP readiness gate

Verdict: **STOP_REQUIRES_ARCHITECTURE_DECISION**.

Preimplementation evidence only. The adapter and milestone acceptance matrix
are **NOT IMPLEMENTED**. This record does not certify an exchange MVP. The
blocking issue is the meaning and durable representation of a governed field
decision, not the availability of a vendor-neutral transport or typed fields.

## 1. Base main SHA

`a50c196cfad8eeef73a5a36f34f2492724e1e85b`. After `git fetch origin`, local
main, HEAD and origin/main agreed exactly. Initial branch was main. The only
working-tree entry was the allowed protected recovery file. Its contents were
never read, hashed, staged, changed, deleted or copied. No `.claude/**` inspection.
Fetch required sandbox escalation because `.git/FETCH_HEAD` was not writable;
the approved retry succeeded.

## 2. Branch and delivery

Created `feat/multivendor-exchange-purview-mvp-v1` after the base passed.
HEAD remains the base SHA. No feature commit, push or PR: the request makes
those conditional on readiness, and the authority gate did not pass.
**NOT MERGED**. This evidence is the only new milestone file.

## 3. Architecture A-O, recorded before implementation

Baseline: **GOVIA-L0L16-CIA-v1.0, FROZEN**, unchanged. The supplied baseline,
roadmap, conformance/reuse records, accepted M7 endpoint/mapping ADR and relevant
M7/M8/M9 evidence informed the focused inspection. Historical conformance claims
about source-to-source reconciliation are interpreted against current contracts;
they do not prove field-value reconciliation.

| Dimension | Intended impact / gate result |
| --- | --- |
| A. CIA baseline | Compatible inbound purpose; no frozen-document edits |
| B. L0-L16 | Intended L0 acquisition, L3 assets, L13 source/fact conflicts; no implementation or L12 observation claim |
| C. Passport | Discovery Metadata, Data Assets + Data Elements, Provenance & Trust; no Passport UI |
| D. Canonical | Preserve eleven kinds and M7 identity separation; governed technical-field decision is unresolved |
| E. Lineage | No new lineage; M9 DERIVED_FROM unchanged |
| F. Evidence/provenance | Reuse immutable run/assertion/evidence/finding/candidate support; no fabricated support |
| G. Trust/authority | Purview assertions must be IMPORTED; source authority per fact cannot be inferred from object certification |
| H. Vector | No similarity or merge authority, no changes |
| I. Graph | No implementation; projection remains downstream of the SoR |
| J. LLM | No parsing, reconciliation or truth authority |
| K. Tenancy/security | Trusted server connection/organisation only; vendor payload must not supply either authority |
| L. Migration | None created; a possible future additive schema requires the field-decision semantics first |
| M. Downstream continuity | Reuse review/authorization/reconciliation; do not broaden existing approvals implicitly |
| N. Non-fabrication | No guessed canonical profile ID/value, vendor type, parent or default |
| O. Acceptance quality | Readiness probes only; 50-case MVP matrix remains unexecuted |

## 4. Chosen ecosystem

Microsoft Purview Data Map, **INBOUND ONLY**. No live connector, credentials,
OAuth, schedule, bidirectional exchange or enterprise connector expansion.

## 5. Provider semantic baseline

The public Microsoft [Entity - Get API documentation](https://learn.microsoft.com/en-us/rest/api/purview/datamapdataplane/entity/get?view=rest-purview-datamapdataplane-2023-09-01)
identifies the 2023-09-01 Data Map / Atlas v2 baseline and documents entity GUID,
typeName, attributes, version, lastModifiedTS and ACTIVE/DELETED status. Its
example includes attributes.name and attributes.qualifiedName. This establishes
the generic DTO vocabulary, not a proven closed mapping for a particular asset
type. No Purview account/API endpoint was called. Public documentation lookup
was the only provider research; fixture/type selection stopped at the core gate.

## 6. Contract-first reuse map

| Capability | Classification | Concrete evidence / boundary |
| --- | --- | --- |
| InboundAdapterEnvelope | REUSE_AS_IS | canonical-contracts/src/contracts.ts:4484; vendor-neutral, no organisation or ObjectSourceMapping field |
| Complete inbound runtime validation | NOT_PRESENT | No validator for the complete envelope/reference graph in inspected canonical/governance/intake code; type/interface fixtures alone are insufficient |
| SourceSystem / SourceConnectionReference | REUSE_AS_IS | contracts.ts:304/315; stable provider reference, server-issued connection |
| AcquisitionRun / SourceObjectIdentity / snapshots | REUSE_AS_IS | contracts.ts:320 onward; source identity is connection + external type + external ID |
| SourceAssertion / Evidence | REUSE_AS_IS | contracts.ts:482/514; provenance and bounded evidence, no arbitrary fact values |
| CATALOG / IMPORTED vocabularies | REUSE_AS_IS | Existing source/trust constants; no new trust synonym needed |
| NormalizedDataAssetCandidate | REUSE_AS_IS | contracts.ts:1982; sourceReference and displayName proposals, not governed technical-profile values |
| DATA_ASSET semantic normalization | REUSE_AS_IS | governance-review/src/canonical-endpoint-resolution.ts:19; exact nonblank sourceReference, no display-name identity |
| Discovery orchestration | ADAPT | dashboard/lib/governance/discovery-intake.ts:103; configured source union currently LOCAL_REPOSITORY; common persistence/review helpers are reusable |
| Generic run/support/finding/candidate persistence | REUSE_AS_IS | governance-review/src/discovery-intake-port.ts and dashboard discovery-intake-persistence.ts; no vendor table needed for these artifacts |
| ReviewSubject / proposal / human gates | REUSE_AS_IS | governance-review/src/review-subject.ts and reconciliation-invocation.ts; object/relationship review, machine ceiling PROPOSED |
| Reconciliation input recovery | REUSE_AS_IS | reconciliation-input-recovery.ts:34; object, relationship, finding-only or unavailable; no field-decision input |
| CREATE_NEW / MATCH_EXISTING / REJECT / DEFER | REUSE_AS_IS | contracts.ts:4171 onward; preserve object-decision meaning and human authority |
| Candidate merge | REUSE_AS_IS | contracts.ts:2023; immutable leaf candidate linkage, explicitly no flattened facts/identity or canonical object |
| ObjectSourceMapping / exact normalized mappings | REUSE_AS_IS | contracts.ts:4463 and 20260909210640_relationship_decision_to_truth_v1.sql; governed, tenant-scoped identity binding |
| DataAssetTechnicalProfile + leaf support | REUSE_AS_IS | contracts.ts:696/705; modeled technical fields, provenance per leaf, no authority configuration or field decision |
| AgentVersion technical-profile proposal pattern | ADAPT | agent-version-technical-profile-port.ts; useful typed persistence pattern but scoped to AGENT_VERSION, not generic data-field reconciliation |
| Typed source-specific fact authority | NOT_PRESENT | Inspected canonical/governance contracts do not define authority policy for a particular data-profile field/source |
| Typed field conflict / field reconciliation | NOT_PRESENT | Existing idempotency/mapping conflicts and object decisions do not represent competing technical-field values and a chosen field result |
| Source-to-source object reconciliation | REUSE_AS_IS | Existing merge and exact governed source binding; does not imply source-to-source field reconciliation |
| Legacy discovery write path | LEGACY_DO_NOT_EXTEND | Authoritative reuse register; no legacy extension or implementation inspection needed |

Paths in this table are repository-relative, with package/app prefixes indicated.
Classifications describe existing capabilities, not completed Purview integration.

## 7. Field-authority readiness and required decision

**Typed technical fields exist; a typed field-authority/reconciliation mechanism
does not exist in the inspected active path.** This is not a claim that an EAV
system or a new canonical object kind is necessary.

Concrete boundaries:

1. `DataAssetTechnicalProfile` contains structuralKind, technicalName,
   technicalNamespace, qualifiedTechnicalLocator and technicalDescription,
   with leaf assertion/evidence references. It requires a governed dataAssetId.
   Current data discovery has no corresponding proposal/materialization port.
   M8 evidence explicitly retains structural metadata as declaration evidence.
2. `SourceAssertion` intentionally has no predicate, field value or valueJson.
   The existing profile support lists identify evidence; they do not specify
   who is authoritative for a leaf or which of two values governance selected.
3. `canonical_objects` persists organisation/object ID/kind and decision
   provenance. It has no technical field values or DataAsset profile binding.
   The M7 mapping stores normalized source identity, not a selected profile.
   See `20260906120000_canonical_materialization_v1.sql:63` and
   `20260909210640_relationship_decision_to_truth_v1.sql:9`.
4. Object decisions contain a subject and canonical identity for CREATE_NEW /
   MATCH_EXISTING. Their strict allowlist has no field, selected value,
   selected assertion, authority-policy version or superseded field decision.
   Recovery supplies the immutable object finding/candidate, not a field-value
   proposal. MATCH_EXISTING binds a source; it does not approve a field update.
5. Intake suppresses object review after an exact governed mapping is found
   (`discovery-intake.ts:331`). Reusing that branch unchanged would leave a new
   conflicting imported field without field review. Reopening or interpreting
   a terminal identity review as approval of later fields is not defined.
   M9 supplemental observation history likewise does not automatically approve
   newly appended support.

### Small additive alternative assessed

A closed, vendor-neutral DataAsset proposal with the already modeled fields,
explicit per-source authority configuration and a read-only comparison would be
possible without arbitrary JSON/EAV. The AgentVersion profile port supplies a
persistence pattern. These additions alone would still leave the requested
**governed field reconciliation** undefined. A comparison report is not a
decision selecting or retaining canonical field truth.

Completing that alternative requires selecting new authority semantics: the
reviewed subject/value/support, the effect of the human decision and the binding
to a governed profile, including subsequent observations of an already governed
object. Treating ordinary object certification/MATCH_EXISTING as that field
decision would silently expand existing authority. Treating a retained source
candidate or its displayName as a governed technicalName would invent truth.

Therefore the applicable requested STOP is **canonical source/fact authority
semantics cannot be represented safely** through the existing governed decision
contract without an explicit decision about this extension. This is a semantic
gate, not a migration-count, effort or general architectural-impossibility claim.

Required architecture resolution, before continuation:

- Define a closed data-field proposal/decision representation for the existing
  DataAssetTechnicalProfile fields, with tenant, exact subject, selected source
  assertion/evidence and versioned source/fact authority context.
- Define how existing human review authorizes that decision separately from
  object identity matching, including retain/reject/defer and new support after
  a terminal object review. No implicit field approval from MATCH_EXISTING.
- Define the canonical-object/profile binding and append-only selected-field
  history, with a stale-value/decision guard; preserve old source assertions.

No alternative is adopted or implemented by this evidence. No new enum, field
path language, EAV store, object kind or implicit precedence was introduced.

## 8. Adapter DTO

NOT IMPLEMENTED. Minimum documented vocabulary identified in section 5 only.
No vendor DTO leaked into canonical contracts or governance.

## 9. Inbound envelope

Existing interface reused conceptually; no producer or complete validation added.
Connection/run/source/support referential-integrity acceptance remains untested
for Purview. Type-level tenant exclusion is not claimed as runtime validation.

## 10. SourceSystem

Required CATALOG family and explicit stable providerCode; no configured Purview
system or provider code was created. Display name is not provider identity.

## 11. Connection and tenancy

Existing server-issued connection contract and trusted organisation execution
context are available. Exact trusted connection/source-system binding and
cross-tenant Purview negative tests are NOT IMPLEMENTED. No vendor organisation,
credentials, canonical IDs or mappings were accepted.

## 12. Supported Purview types

None implemented. No closed mapping table or fixture-backed asset type has
been certified; unknown type guessing was not used.

## 13. DATA_ASSET mapping

FOUNDATION_ONLY. Existing sourceReference identity is suitable for assessing
an exact documented qualifiedName in a future supported type. No Purview GUID,
name or qualifiedName has been converted to a canonical ID.

## 14. DATA_ELEMENT mapping

FOUNDATION_ONLY / NOT_IMPLEMENTED. Exact documented parent and element semantics
have not been proven. No parent inference, asset/element fabrication or scope claim.

## 15. Source identity

Existing deterministic connection + externalType + externalId contract remains.
Purview GUID use as a provider source ID is intended only; adapter replay is not
implemented or tested. A GUID alone conveys no tenant or canonical authority.

## 16. Trust

Existing vocabulary remains INFERRED, DECLARED, IMPORTED, OBSERVED, VALIDATED.
Purview must enter as IMPORTED. No Purview assertion was emitted or promoted.

## 17. Evidence and provenance

Generic immutable persistence/support is reusable. No vendor payload, token or
secret was persisted. Provider GUID/version/run/method/hash evidence remains
an unimplemented adapter requirement; prefer HASH_ONLY or REDACTED.

## 18. Source mapping

M7 exact normalized mappings remain governed outputs. No adapter-created mapping,
confirmation or automatic EXTERNAL_ID match. The inspected new-mapping table
currently constrains persisted match_method to MANUAL; the broader contract's
EXTERNAL_ID literal is not proof of a ready automatic matching path.

## 19. Field/fact authority

NOT_PRESENT as an executable typed policy/decision mechanism; section 7 is the
blocking gate. name could supply a technicalName proposal only after explicit
typed transport/support is defined; it is not already a governed value.
qualifiedName can support sourceReference without approving a canonical
qualifiedTechnicalLocator. Unmodeled vendor metadata remains unmapped.

## 20. Conflict semantics

Existing immutable-content and mapping conflicts fail closed. They are not
field-value conflicts. AGREEMENT, SOURCE_ONLY, CANONICAL_ONLY, CONFLICT and
UNKNOWN/UNMAPPED were not introduced as enums or claimed as implemented.
No missing value was treated as false/conflict, and no source precedence was set.

## 21. Reconciliation

Object review, human authorization, four object outcomes and candidate merge
remain available and unchanged. They do not select technical-field truth.
Required field-decision integration is blocked as explained in section 7.

## 22. Replay

No Purview replay claim. Existing source identity and immutable support patterns
were inspected; adapter/candidate/review idempotency still requires fixtures and
intake integration after the gate is resolved.

## 23. Temporal support

No old evidence/assertion/candidate was changed. M9's DERIVED_FROM-only observation
attachment is not generalized to catalog objects, nor treated as field approval.
Changed vendor version/value and provider deletion behavior remain unimplemented.

## 24. Security

No payload processing, credentials, Azure authentication, external application API
call or database execution. No prototype-pollution/runtime envelope security
claim: those tests require an implementation. Protected workspace file preserved.
The Supabase skill was read for local persistence inspection only; no feature or
schema implementation required database verification. The user's no-live-DB
constraint remained in force throughout.

## 25. M7/M8/M9 continuity

Implementation and historical migrations unchanged. M7 exact source/normalized/
canonical identity separation, M8 asset/element identities and M9 support history
are preserved. READS_FROM / WRITES_TO remain BLOCKED_AGENT_BINDING; DERIVED_FROM
unchanged. No SQL scanner behavior, goldens or Validation Lab changes.

## 26. Graph / Vector / LLM boundaries

No changes, calls, authority or projection implementation. No milestone 11 work.

## 27. Migration

None. No vendor table, canonical JSON metadata or historical migration edit.
No live Supabase, SQL execution, advisor or production schema action.

## 28. Validation

Eight selected existing canonical-contract tests passed, zero failures:

- Immutable source-neutral candidate merge.
- Connection-scoped source identity.
- Allowlisted immutable DataAsset technical profile.
- SourceAssertion excludes generic fact values.
- All four valid object reconciliation outcomes.
- Machine authority rejected for object decisions.
- Wrong organisation rejected for canonical target.
- CREATE_NEW rejects fields outside its decision allowlist.

Executed from `packages/canonical-contracts`:

```text
node --test --test-isolation=none --test-name-pattern='constructs an allowlisted immutable DataAsset technical profile|keeps SourceAssertion as a provenance envelope without generic fact values|creates all four valid object reconciliation outcomes|rejects machine authority for object reconciliation decisions|rejects CREATE_NEW carrying forbidden fields outside its allowlisted shape|keeps source identity connection-scoped for fail-closed matching|creates an immutable source-neutral merge with deterministic leaf IDs|rejects wrong organisation context on the canonical target identity' test/contracts.test.mjs
```

These are readiness probes of unchanged contracts, **not Purview acceptance tests**.
No full suites, dashboard/governance/scanner tests, typechecks, migration tests or
Validation Lab run: implementation is unchanged. The required 50-case milestone
matrix is not executed; none is counted as a newly passing Purview case.

Whitespace validation: `git diff --check` plus an explicit
`git diff --no-index --check -- /dev/null <this evidence path>` for the untracked
new file produced no whitespace diagnostics. The tracked check exited 0;
the no-index check exited 1 for the added-file difference. Final status contained
only this evidence and the permitted protected recovery entry; tracked
implementation diff was empty.

## 29. One focused adversarial pass

One manual review of the readiness conclusion and proposed shortcuts, no agents
and no second broad audit. Checked that typed profiles were not overlooked, that
the AgentVersion proposal pattern was considered, and that identity decisions,
candidate merge and M9 supplemental evidence were not misrepresented as field
reconciliation. These checks support the narrower semantic blocker in section 7.

Requested adapter attack cases A-O are **NOT EXERCISED** because no adapter was
built: GUID/canonical confusion; injected tenancy; field overwrite; trust
promotion; global precedence; name identity; guessed types; dangling references;
cross-tenant mapping; ungoverned confirmation; silent conflict resolution;
history overwrite; raw payload leakage; DTO leakage; LLM/Graph authority.
No implementation defect was patched and no security acceptance is claimed.

## 30. Known limitations and files

Only this evidence file was added, uncommitted. No functioning Purview adapter,
fixture set, source/fact policy, field conflict UI, field decision, durable data
profile or exchange test matrix is delivered. Absence of those features is
explicit; existing object reconciliation is not substituted for them.

The required next action is the field-decision architecture resolution in
section 7, followed by continuation on this branch. No feature PR is ready.

## 31. Production and next milestone

**PRODUCTION STATUS = UNTOUCHED**.

**MERGE STATUS = NOT MERGED**.

**NEXT MILESTONE = 11 NOT STARTED**.

**VERDICT = STOP_REQUIRES_ARCHITECTURE_DECISION**.

## 32. Exact-state continuation and accepted ADR

Resumed on the original branch and base HEAD, first with the explicit architecture
resolution and then with the 2026-09-14 interrupted-work continuation. Both gates
ran status, branch, HEAD, diff-stat and diff-check; only legitimate milestone edits
and the protected recovery entry were present. No reset, stash, branch change,
history reconstruction or subagents. Original sections above remain unaltered.

The accepted [field/fact ADR](../../architecture/ADR-GOVIA-FIELD-FACT-AUTHORITY-AND-MULTIVENDOR-RECONCILIATION-v1.md)
resolves the original distinction between identity matching and approval of a
technical value. Its A-O mapping precedes implementation. No frozen baseline,
canonical kind, relationship taxonomy or existing object outcome changed.

Priority source scope is **Azure SQL tables/columns received through Microsoft
Purview Data Map**. This continues the already selected Purview transport; it is
not a direct SQL connector or a second ecosystem. No credentials or live source.

## 33. DTO, supported types and mapping

The isolated scanner `src/exchange/purview.ts` parses the documented Atlas bulk
entity projection, pinned semantically to API **2023-09-01**. It accepts entities
and optional referredEntities, verifies GUID keys and flattens them before strict
identity/parent checks. The vendor DTO is not exported into canonical contracts.

Microsoft's [type-definition documentation](https://learn.microsoft.com/en-us/purview/data-gov-api-custom-types)
documents azure_sql_table, azure_sql_column, their composition relationship and
the column's data_type string. The [entity API](https://learn.microsoft.com/en-us/rest/api/purview/datamapdataplane/entity/get?view=rest-purview-datamapdataplane-2023-09-01)
documents GUID, version, lastModifiedTS, status and attributes. Synthetic fixtures
use this documented subset; they are not captured customer payloads.

| Purview type / attribute | Gov IA target | Coverage |
| --- | --- | --- |
| azure_sql_table | DATA_ASSET candidate | SUPPORTED |
| table attributes.qualifiedName | proposedIdentity.sourceReference | SUPPORTED; opaque exact reference, never canonical ID |
| table typeName | structuralKind = TABLE | SUPPORTED by closed mapping |
| table attributes.name | technicalName proposal, display label | SUPPORTED; name does not define asset identity |
| table attributes.qualifiedName | qualifiedTechnicalLocator proposal | SUPPORTED; no URL credentials/query permitted |
| table attributes.description | technicalDescription proposal | SUPPORTED only when supplied and bounded |
| table technicalNamespace | no proposal | NOT_EXPOSED by selected DTO; no string splitting/inference |
| azure_sql_column + explicit relationshipAttributes.table GUID | DATA_ELEMENT with exact parent candidate | SUPPORTED; parent must be in same batch/connection |
| column attributes.name | exact elementPath under parent + technicalName proposal | SUPPORTED |
| column attributes.data_type | dataType.nativeType proposal | SUPPORTED only when supplied |
| normalized datatype family, length, precision, scale, time zone, ordinal, nullability, defaults, generation | no proposal | UNSUPPORTED in this narrow DTO; no inference from nativeType |
| classifications, labels, meanings, contacts and other vendor metadata | none | UNMAPPED_VENDOR_METADATA; omitted |
| all other entity types | none | UNSUPPORTED / fail closed |

Bounds: 1 MiB JSON, 500 entities, bounded strings and nesting. Active complete
entities only. Missing/invalid GUID, qualifiedName, parent, unsupported type,
duplicate GUID, duplicate exact element identifier under one parent and dangling
relationships reject the batch. Equal column identifiers under different exact
parents remain separate. No parent is inferred from qualifiedName proximity.

## 34. Generic inbound, source boundary and review continuity

InboundAdapterEnvelope gains only an optional vendor-neutral typed technicalFacts
collection. It still has no organisation, policy, decision or canonical mapping.
`validateInboundExchange` validates the closed data-object population, source/run
consistency, unique references, complete snapshot/assertion/evidence support,
candidate/finding association and exact parent connection. It rejects unexpected
governance properties and unsafe evidence metadata before persistence. Intake
copies the envelope before asynchronous work so the original cannot be swapped.

The server resolves registered connection ownership before parsing/intake; the
generic connection registry makes connection IDs exclusive to one organisation.
Purview source family is CATALOG, providerCode **microsoft-purview**, EXPLICIT.
No source content can register its own connection, tenant or authority policy.

Generic acquisition, Evidence, SourceAssertion, Finding, NormalizedCandidate,
ReviewSubject and PROPOSED transition persistence are reused. Object mapping uses
the M7 exact normal form and existing read-only mapping port. Already governed
objects suppress redundant object review but never suppress fact observations.
No adapter certification, object reconciliation or canonical materialization.

Object candidates are snapshot-specific, following existing M8 intake semantics.
Semantic field proposals are separately stable across those candidate rows.
Same-snapshot replay creates no duplicate support, candidate, proposal or review.

## 35. Typed facts, identity and provenance

TechnicalFact is a closed kind/field/value discriminated union of existing profile
leaves. structuralKind uses DataAssetStructuralKind; all other selected leaves
are bounded strings. Compile-time negative cases and runtime validation reject
arbitrary fields and invalid field/value combinations. SourceAssertion remains
provenance only; technical values do not enter a generic predicate/value envelope.

Proposal identity is SHA-256 over explicit organisation, source system, exact
source tuple, M7 normalized identity, object kind, field, typed value and source
trust. It excludes timestamps, evidence/assertion IDs, row/order IDs and version.
Observation identity separately hashes proposal ID, current candidate reference
and sorted unique supporting assertion/evidence IDs. Changed source version or
relevant payload produces new immutable support, while equal values reuse the
semantic proposal. The original proposal/candidate association is retained.

Purview assertions are IMPORTED throughout. Field governance does not rewrite
them to VALIDATED. Evidence is HASH_ONLY over the bounded documented projection,
with source GUID locator, snapshot/version or ETag, acquisition and adapter
method/version. Arbitrary vendor metadata and raw payload are omitted. Modeled
strings reject credential assignments, bearer/JWT patterns and unsafe locators;
no unrestricted source excerpt is stored.

## 36. Per-field authority and governed decisions

Trusted immutable policies bind organisation, kind, closed field, source system,
provider and optional connection, with explicit version. Overlapping policies
fail ambiguous; there is no implicit connection-over-provider precedence.
No policy prevents acceptance; NON_AUTHORITATIVE prevents acceptance;
CONTRIBUTING requires explicit human approval. AUTHORITATIVE is eligibility,
not a write grant. Versioned deterministic rules are accepted only when explicitly
configured and the current value is absent or equal. Different values require
human governance. No default machine acceptance is wired into intake.

Distinct field decisions use ACCEPT_PROPOSED, KEEP_CURRENT, DEFER and
REJECT_PROPOSED. The dashboard uses its existing trusted org_admin authority
check, obtains tenant/user from the server session and permits only HUMAN
submission. The domain also requires an explicit authorization port. SQL repeats
exact mapping, policy, observation, source and expected-current-state validation.
Object CREATE_NEW/MATCH_EXISTING are not overloaded.

The field review page `/governance/technical-facts`, linked from the existing
object review queue, displays source and governed values, field policy,
comparison, historical observation support and decision history. Pending mapping
and stale source proposals remain visible without an eligible acceptance action.
All decision outcomes are auditable, including rejected/deferred losing proposals.

## 37. Conflict and temporal governed state

Conflict compares exact typed values on the same tenant, governed object and
field. No fuzzy datatype/name equivalence is introduced. UNMAPPED, SOURCE_ONLY,
AGREEMENT and CONFLICT are explicit comparison results. Missing optional fields
produce no fact, never FALSE or an invented conflict. The deterministic conflict
ID includes tenant, object, kind/field and ordered competing values, excluding
support IDs, timestamps and row UUIDs. Conflicts are reproducible read models
over durable proposals and state history, not a separate competing fact store.

ACCEPT_PROPOSED appends a governed field state linked to the exact proposal,
decision and predecessor. Equal-value acceptance can append a governed support
confirmation; it does not create a second semantic proposal. Other outcomes
append only the decision/audit support. Prior state and losing source support
remain immutable. The current state is the unique state with no successor;
initial-state and predecessor uniqueness protect the chain.

DataAssetTechnicalProfile/DataElementTechnicalProfile remain unchanged. No full
profile projection is manufactured from the partial six-leaf MVP. Typed governed
leaf history is the additive canonical technical-state surface; it never creates
or redefines a canonical object or a vendor-specific SoR.

## 38. Current-source and stale-decision protection

A decision binds **expectedSourceObservationId**, **expectedSourceSnapshotId**
and **expectedCurrentStateId**, in addition to its exact proposal and support.
New received snapshots are recorded separately from semantic proposals. Source
snapshot and per-field observation heads are mutable pointers only; historical
membership, values and support are immutable. They do not choose canonical truth.

Recording source facts and applying decisions acquire the same tenant/source
object transaction lock; field decisions additionally lock the governed
object/field. The SQL transaction compares both source heads and proves that the
reviewed field observation is supported by the expected snapshot. It then checks
the predecessor state and appends decision/state atomically. A source change
between application review and the transaction therefore fails closed with
FIELD_STALE_SOURCE; a governed-state change yields FIELD_STALE_STATE.

A new snapshot that omits data_type still has the required evidenced name and
advances source snapshot membership. It invalidates the pending old datatype
review without deleting the prior value or asserting a replacement. Supplying
the new snapshot ID with the old field observation also fails. Previously seen
snapshot/observation replay never moves either pointer backwards. Support resumed
from an older partial import cannot replace a newer source pointer.

Completed decision replay returns its original result before stale checks and
performs no new effect. Reusing its ID with different reviewed input fails.

## 39. Persistence and migration

One CLI-generated additive migration:
`20260911184613_technical_field_governance_v1.sql`. It defines trusted generic
connection registration, field policies, typed proposals, immutable observations
with assertion/evidence junctions, source snapshot membership/heads, field
decisions with reviewed-observation junctions and temporal states. Typed proposal
values use explicit structural_kind/technical_name/qualified_technical_locator/
technical_description/native_type columns with closed kind/field/value checks.
No persisted arbitrary JSON facts, vendor raw state or historical migration edit.

The replay-specific acquisition wrapper delegates to existing start_acquisition_run
while retaining its first capture timestamp; the generic RPC is unchanged.
Immutable fact observation replay preserves origin support. All new tables enable
RLS and revoke public/anon/authenticated access. RPCs are SECURITY INVOKER with
fixed search_path and service_role-only execution. Compound FKs and explicit
tenant filters protect mappings, support, proposals, decisions and state.

The Supabase CLI initially required approved escalation for its local telemetry
file. Migration generation did not execute SQL. Official function documentation
was consulted; changelog.md returned unsupported content type. No new Supabase
library/API-version assumption, dependency installation, database connection,
advisor, live RLS/concurrency test or production action occurred.

## 40. Focused validation (final implementation)

| Check | Result |
| --- | --- |
| canonical-contracts npm test | 112 passed |
| governance-review node --import tsx --test test/*.test.ts | 215 passed, including 54 new fact/intake cases |
| scanner node --import tsx --test test/exchange/purview.test.ts | 36 passed |
| dashboard technical-fact-persistence.test.ts | 8 passed |
| dashboard technical-field-migration.test.ts | 8 passed; structural SQL only |
| canonical-contracts typecheck including negative field typing | Passed |
| governance-review typecheck | Passed |
| scanner typecheck | Passed |
| dashboard typecheck, incremental disabled | Passed |

**379 distinct passing tests**, without double-counting focused reruns or the
earlier readiness probes. Dashboard tests use react-server conditions, experimental
module mocks and fake database responses. Initial Node spawn EPERM was resolved
with approved local test execution. No full unrelated dashboard/scanner suite,
Validation Lab or golden changes. Browser/deployed UI verification is not claimed.

Latest 30-case acceptance accounting: adapter cases 1-8 use table/column/optional
metadata and evidence tests; 9-12 use real intake plus proposal/observation replay
tests; 13-17 use per-field policy and conflict tests; 18-21 include current review,
same-value/new-value/missing-field stale source, concurrent-state race and completed
decision replay tests; 22-24 cover connection ownership, proposal/decision scope
and fake-persistence tenant filters; 25-30 use forbidden materialization ports,
unchanged trust/taxonomy regression tests and unchanged downstream code.

The accepted 50-case matrix is additionally covered by strict DTO/inbound mutation
tests, field authority dispositions/rule gating, all four field outcomes, typing
negative cases and structural persistence checks. Source-to-source DECLARED vs
IMPORTED comparison is tested using an existing governed repository-value context;
this milestone does not add scanner datatype proposal backfill or a second vendor.

## 41. One focused implementation adversarial pass

One focused manual implementation pass under the accepted continuation, separate
from the original preimplementation gate review preserved in section 29. No
subagents or second broad audit. Checked parent collisions/GUID scope, DTO/domain
isolation, per-field authority, mapping != authority, no automatic trust promotion,
no direct canonical writes, source/governed stale decisions, immutable losing
support, cross-tenant inputs, exact replay, typed storage and no second vendor.

Concrete corrections: versioned-rule SQL checks explicitly reject NULL versions;
both current-source snapshot and field observation are checked; absent fields
invalidate old reviews; old partial replay cannot move source heads backwards;
acquisition replay retains the first timestamp through the existing RPC; envelope
nested evidence metadata is allowlisted and input is copied before awaits; review
history includes nonmaterializing decisions. Parent collision and separate-parent
same-name cases pass. Only affected tests were repeated after these corrections.

## 42. Continuity, limitations and delivery

M7 exact mapping/normalization, M8 identities and M9 SQL/lineage/support history
remain unchanged. READS_FROM/WRITES_TO remain BLOCKED_AGENT_BINDING. No Graph,
Vector, LLM or runtime OBSERVED work. No production configuration or dependency
changes. The frozen architecture baseline remains intact.

Limitations: fixture-fed transport only; ACTIVE complete Azure SQL table/column
subset; omitted fields remain unknown; nativeType is not parsed into family/size;
no provider deletion, live sync, complete materialized profile, policy-management
UI or automatic repository profile backfill. Trusted connections/policies must
be provisioned through governance-controlled server configuration after normal
migration deployment. Policies are immutable in this MVP; ambiguous overlaps fail
closed. Source current state follows newly accepted snapshot observations, not a
guessed ordering of opaque provider ETags. No full drift intelligence. Failed
partial intake leaves immutable support available for retry; it cannot authorize
truth. SQL runtime/RLS/concurrency and browser deployment remain release checks.

Delivery: one logical feature commit preferred, normal push of the existing branch
and one PR against main. Actual commit/PR identifiers are reported at handoff.
No amend, force push or merge. **PRODUCTION UNTOUCHED; NOT MERGED; milestone 11
NOT STARTED.** Final verdict: **MULTIVENDOR_EXCHANGE_MVP_V1_READY_FOR_REVIEW**.
