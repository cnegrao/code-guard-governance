# Field/fact authority and multivendor reconciliation V1

Status: **ACCEPTED**. Authority: explicit milestone 10 continuation decision,
2026-09-11. Baseline: **GOVIA-L0L16-CIA-v1.0**, frozen and unchanged.

## Decision

Source object identity, canonical identity, typed source fact proposals,
source-specific field authority and governed field state are separate concerns.
SourceAssertion remains provenance only. Object CREATE_NEW/MATCH_EXISTING remain
identity decisions; field decisions do not create or remap canonical objects.

Use closed discriminated technical-field contracts, with values from existing
DataAssetTechnicalProfile/DataElementTechnicalProfile only. Initial coverage:
DATA_ASSET structuralKind, technicalName, qualifiedTechnicalLocator,
technicalDescription; DATA_ELEMENT technicalName and dataType.nativeType.
Other fields remain unsupported/unknown. No arbitrary field paths or JSON/EAV
facts. Source values enter as IMPORTED (repository comparison support may be
DECLARED); neither policy nor a confirmed mapping upgrades their source trust.

Trusted tenant-scoped, versioned policy binds object kind, exact field, source
system/provider and optional connection. Dispositions are AUTHORITATIVE,
CONTRIBUTING and NON_AUTHORITATIVE, without transitivity. Missing/ambiguous
policy fails closed for acceptance. Non-authoritative facts cannot materialize;
contributing facts require explicit human approval. Deterministic acceptance is
limited to an explicitly configured versioned rule, authoritative disposition,
complete support and no different current value. Conflicts require human review.

The PR #31 final policy-version gate makes applicability explicit: immutable
versions have identity (organisationId, policyId, version). A separate tenant-local
head selects exactly one version of each logical policy. This reuses the repository
pattern of governance_policies.current_version_id and immutable policy_versions;
those documentary policy tables do not encode technical field/source scope and
are not repurposed. Version strings have no ordering or automatic activation.
Trusted server configuration first inserts an immutable version and then explicitly
inserts/updates technical_field_policy_heads; removing a head deactivates that
logical policy without deleting history. No adapter or review client can configure
these heads. Head identity cannot be changed to another tenant or logical policy.

Only pointed versions participate in authority evaluation. Historical versions
cannot create ambiguity; two distinct applicable current policies still fail
closed, including overlapping general and connection-specific policies. There is
no specificity precedence. No rule or authority is inherited from an older version.
New decisions bind the exact current policyId/version (or explicit absence for
nonmaterializing outcomes). A changed/missing applicable policy produces
FIELD_STALE_POLICY before recording any decision or state; acceptance without
current authority remains forbidden. KEEP_CURRENT, DEFER and REJECT_PROPOSED
preserve their nonmaterializing semantics and reviewed policy context.
Head insert/update/delete and new decisions share a tenant-scoped transaction
lock, including activation of a previously absent or overlapping policy. Completed
decision replay returns the original durable outcome before current-policy lookup;
its exact version FK remains valid without reinterpreting history under today's
policy. Policy activation does not mutate previous versions, decisions or states.

Typed proposals are pre-canonical and retain exact candidate/source/support.
Only existing M7 exact mappings can resolve a governed subject. Zero mapping
leaves a pending proposal; ambiguity fails closed. Append-only observations
preserve changed snapshots without replacing the semantic proposal or its origin
review. Imported fact decisions are distinct from the origin object's review.

Field outcomes: ACCEPT_PROPOSED, KEEP_CURRENT, DEFER, REJECT_PROPOSED. Each binds
tenant, exact canonical object/kind/field, proposal, reviewed observations,
policy version, expected current state, actor/rule and time. Acceptance creates
an immutable field state linked to its predecessor and decision. Other outcomes
preserve history and materialize nothing. An atomic transaction validates scope,
mapping, policy, support and stale-state guards and records decision/state.
No last-write-wins, confidence precedence or latest-snapshot precedence.

The 2026-09-14 continuation additionally requires an exact current-source guard.
Decisions bind the reviewed source observation and snapshot as well as the current
governed state. Append-only source snapshot membership plus a current received
snapshot pointer invalidates pending reviews even when a previously asserted
field disappears. Missing fields do not acquire a fabricated value. An exact
old replay cannot move source pointers backwards. Source/field writes and
decisions share a transaction lock; canonical state has an additional scoped
lock and predecessor guard. Replaying a completed decision returns its original
result without reapplying it, even if source state subsequently changed.

Conflicts are read models over durable competing typed values for the same
governed subject/field. Their semantic identity excludes observation IDs and
timestamps; their support stays separately traceable. Missing values are UNKNOWN.
No complete materialized DataAsset/DataElement profile is fabricated from partial
field state; a later projection can compose existing typed profiles only when
their required identity/fields are available.

## Architecture impact A-O

| Dimension | Accepted impact |
| --- | --- |
| A | Frozen CIA baseline preserved, additive resolution of the recorded STOP |
| B | L0 source acquisition, L3 typed data facts, L13 reconciliation, L14 human decisions; no L12 runtime claim |
| C | Discovery Metadata, Data Assets + Data Elements, Provenance & Trust; no Passport UI |
| D | No new canonical kind or identity definition; separate typed temporal field state |
| E | M9 lineage unchanged; no new lineage edge |
| F | Immutable source assertions/evidence and proposal observations, explicit decision support |
| G | IMPORTED != VALIDATED; authority per field/source; mapping != field authority |
| H | Vector unchanged and non-authoritative |
| I | Graph unchanged; PostgreSQL/Supabase remains SoR |
| J | No LLM parsing, field decisions or authority |
| K | Trusted connection ownership, tenant-scoped policies/proposals/decisions/states, service-only persistence |
| L | Prefer one additive migration; no historical changes or live database execution |
| M | Existing intake, review, M7 mapping and object outcomes reused without overloading |
| N | No guessed parent, type, field, default, deletion or complete profile |
| O | Fixture-backed table/column import, field decision/history/tenancy tests, structural SQL checks, one focused adversarial pass |

## Provider boundary

Microsoft Purview Data Map / Atlas v2, API 2023-09-01; inbound fixture transport
only. Supported azure_sql_table and azure_sql_column; a column needs an explicit
table GUID relationship and that exact table in the same trusted batch. GUID is
source identity, qualifiedName is the asset source reference, column name is the
exact element identifier under its parent. No identity uses a display label.
No credentials, live Azure calls, outbound transport or scheduled synchronization.

References: [Entity API](https://learn.microsoft.com/en-us/rest/api/purview/datamapdataplane/entity/get?view=rest-purview-datamapdataplane-2023-09-01),
[Microsoft table/column type definitions](https://learn.microsoft.com/en-us/purview/data-gov-api-custom-types).

Stop if safe implementation requires untyped facts, identity redefinition,
inseparable mapping/authority, non-atomic unauditable decisions or guessed
provider fields/identity. Milestone 11 remains NOT STARTED.
