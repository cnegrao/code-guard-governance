# M17.5 V1 Hub read contract and exposure boundary

Date: 2026-10-20; timezone: America/Sao_Paulo. Status: **ARCHITECTURE_CONTRACT_ONLY**.

Starting HEAD: `a85f97225777e1dd1fd67109a349c3be6e45d0ad`; branch: `feat/m17.5-trust-assurance-v0`.
The [Hub ADR](../architecture/ADR-GOVIA-TRUST-ASSURANCE-HUB-v1.md) records the rationale.
The [JSON contract](v1-hub-read-contract.json) supplies exact source hashes, member IDs and complete metadata.
This is a documentation contract, not a runtime schema, API, projection execution or exposure approval.
Historical [V0 closure](v0-closure-review.md), [E1](v0-closure-errata-v1.md),
[parent ADR](../architecture/ADR-GOVIA-TRUST-ASSURANCE-v1.md) and [KPI framework](kpi-framework-v0.md) remain unchanged.

## 1. Scope and frozen state

| Boundary | Contract |
| --- | --- |
| canonical_object_kinds | 11 |
| governed_relationship_types | 12 |
| passport_families | 16 |
| new_canonical_authority | false |
| new_authority_permissions | 0 |
| authoritative_families | M16 and M17 unchanged; L14/L15 authority and shared Authority Policy unchanged |
| trust_vocabulary | UNCHANGED |
| historical_decisions | IMMUTABLE |

| Mode | Source | Organisation / boundary |
| --- | --- | --- |
| PRODUCT_ASSURANCE | Pinned repository/product V0/E1 metadata and evidence; not tenant operating effectiveness | null; product proof is not tenant assurance |
| TENANT_ASSURANCE | Customer estate within immutable scope manifest, only after all authorized typed read hops exist | Exactly one verified-principal organisation; never caller-selected authority; no tenant execution available |

All metadata identifiers are projection identifiers, not canonical kinds, relationships, authoritative fact families or permissions. No mixed product/tenant result, cache, export or drill-down. All HOLDs listed in section 16 remain.

## 2. Decisions

| ID | Decision | Contract |
| --- | --- | --- |
| D-V1-01 | Hub source-of-truth boundary | The Hub reads canonical governance truth -> existing evidence -> capability -> source-pinned framework/reference -> assurance projection -> gap/claim/certification state -> controlled presentation. It owns only disposable projection/execution metadata, never governance truth, a compliance engine, scoring or certification authority. Keep original authority on every hop. |
| D-V1-02 | Product vs Tenant Assurance | Require an explicit mode on every request, projection, filter, cache key, export and drill-down. PRODUCT has organisation_id=null; TENANT has one verified-principal organisation and a scope manifest. No combined totals, evidence promotion or silent mode fallback. Product proof does not prove tenant assurance; tenant evidence cannot alter product claims. |
| D-V1-03 | Tenant scope manifest | Adopt the S4 SCOPE_V1 concept as immutable projection/execution metadata, not a canonical object. Fix requirements and governed subject populations before evidence evaluation. Preserve reviewed NOT_APPLICABLE members. Unknown membership or unenumerable full-framework sources block complete execution. |
| D-V1-04 | Read security classes | Classify source, wrapper and internal dependency separately. Positive tenant use requires verified-principal DB authorization, exact same-tenant identities and explicit cutoff support. Repository metadata and public bibliographic sources have their own non-tenant classes. No unlisted read hop is allowed. |
| D-V1-05 | service_role / privileged transport boundary | service_role is technical transport only. Existing M16/M17 SECURITY DEFINER RPCs revalidate the verified session and enforce organisation/target binding in PostgreSQL; the privilege itself grants no governance authority. Application-only organisation filters are ineligible for tenant assurance. Internal owner-only resolvers remain internal; no new grants or permissions are designed here. |
| D-V1-06 | Atomic cutoff semantics | A shared timestamp is necessary but insufficient. Require an attested one-snapshot read transaction (REPEATABLE READ or equivalent proven snapshot) for all mutable DB dependencies, plus immutable external/source version vector. Existing independent RPC calls and Passport null/null defaults do not prove atomicity. Fail closed as NON_ATOMIC/UNKNOWN until additive composition proves it. |
| D-V1-07 | UNKNOWN/error rendering | Separate acquisition, authorization, dependency, axis and assessment state. UNKNOWN is first-class. Denial never means absence, missing row never means BROKEN, complete empty population never means compliant. Invalid/unrecognized states fail closed without green defaults or unauthorized existence/count disclosures. |
| D-V1-08 | KPI denominator hazard | Recommend a typed non-composable COUNT/PARTITIONED_COUNT projection (option B), with separately authorized audit population identity metadata (option A safeguard). Do not transport historical known_population or equivalent denominator in generic Hub data. Conservation uses exact member/partition audit proof. No ratio/percentage/score operator or renderer; definitions remain definitions. |
| D-V1-09 | Claim ceiling precedence | S2_COMMERCIAL_CLAIMS_REGISTER capability_ceilings.current_claim_ceiling controls, with E1 access/affirmative-use overlay. S1 EVIDENCE_BACKED_ALIGNMENT_CANDIDATE is historical mapping metadata only. Missing/inconsistent S2 fails closed. 42 INELIGIBLE/INTERNAL_ONLY/PROHIBITED records remain so. No publication approval is granted. |
| D-V1-10 | Gap vs exposure-gate populations | ASSURANCE_GAPS is the historical S2 set of 61 OPEN members. PRESENTATION_EXPOSURE_GATES is the separate E1 open-universe population of 14 known members (L04 package compatibility expands one member). Neither is exhaustive global gap truth. No mixed total or label 61 total gaps. |
| D-V1-11 | Certification external-artifact contract | Keep NOT_ASSERTED. A positive state requires an independently issued, authenticated artifact matching exact issuer, subject, scope, framework/version, validity and current verification/revocation basis. No artifact currently exists in the pack. Readiness, mappings, ledger integrity and internal reviews cannot infer it. |
| D-V1-12 | European Assurance Profile | Projection only: preserve source/version, applicability, mapping, availability, sufficiency, internal readiness and external artifact axes. The original OJ base-text reference is not an operative-law conclusion. Qualified current-law/applicability review is a separate prerequisite; unresolved source/scope yields UNKNOWN. No generic EU AI Act compliant state. |
| D-V1-13 | LLM explanation boundary | Governed truth stays upstream; graph traversal remains ANALYTICAL and vector similarity non-authoritative. An LLM may explain a deterministic, authorized projection with exact citations and limitations. It cannot create mappings, applicability, sufficiency, certification, eligibility or publication approval. Strip numerical confidence/score as assurance proof. |
| D-V1-14 | Legacy containment dependency | Consume all L01-L05 and LX01-LX09 E1 exposure inputs. Exclusion in a design document does not prove containment in runtime/navigation/packages/exports. Affected demo/publication/tenant paths remain blocked until separately authorized containment and independent exposure acceptance. LX08 also requires a security review. |
| D-V1-15 | Future consumer interface / M18 neutrality | Define consumer-neutral projection metadata only. M18 Pillar 8 is forward-looking planning terminology, not canonical architecture. No M18 API, formalization, implementation, persona truth or Normative Intelligence is introduced. |

## 3. Exact identity and traversal

Product path:

- Capability exact ID + inventory version
- CapabilityEvidenceLink exact capability/evidence versions
- EvidenceReference tagged locator preserving original authority
- FrameworkVersion exact edition/catalog record
- FrameworkRequirement or bounded public reference exact ID + record version
- Mapping exact ID/version and reviewed limitation

Tenant path:

- FrameworkRequirement/reference version + manifest membership
- Tenant mapping version + requirement/evidence/subject tuple
- Admissible evidence reference typed identity/version
- Exact governed subject identity/state
- Original governed decision and typed support/dependency references
- Original authority/policy/version and effective_at/recorded_cutoff

| Subject tag | Required identity tuple |
| --- | --- |
| CANONICAL_OBJECT | organisation_id; one of 11 frozen kinds; canonical_object_id; exact selected state/version and creating decision |
| RELATIONSHIP_STATE | organisation_id; relationship_id; relationship_state_id; one of 12 frozen relationship types; typed exact source and target canonical identities |

Parent ADR section 4 locator union only: REPOSITORY_ARTIFACT, VERIFICATION_ARTIFACT, GOVERNED_REFERENCE, UPSTREAM_EVIDENCE_REFERENCE, EXTERNAL_ARTIFACT_REFERENCE. These are metadata tags, not new canonical kinds/support targets.

Required evidence envelope: reference_id/version; locator_kind; original_authority_class; original_trust_state; mode/org/scope; exact typed source target/version; decision/state/support identities where relevant; source connection/run/snapshot identity where relevant; permitted digest/version; effective_at; recorded_cutoff; access; currency; dependency_validity; limitations.

Resolve by exact tagged identities through allowlisted authorized reads. Every tenant-bearing endpoint and junction must match principal organisation and manifest; reject multiple/conflicting versions, unresolved type/ID or unauthorized hop. Never guess, match by name or substitute a legacy agents/ai_systems registry ID. M16/M17 owner-target support matrices and acyclicity stay frozen.

Any unresolved, denied, non-atomic or invalid hop makes the dependent projection UNKNOWN/ACCESS_DENIED/DEPENDENCY_INVALID as appropriate; no guessed join or evidence-free green.

## 4. Tenant SCOPE_V1 manifest

SCOPE_V1 / immutable V1 projection execution metadata. No canonical object or manifest store is created.

| Field | Semantics |
| --- | --- |
| scope_ref | Opaque metadata identity + exact version + content digest; supersedes ref if restated |
| mode | TENANT_ASSURANCE |
| organisation_id | Derived only from verified principal, revalidated at every mutable source hop |
| intended_assurance_use | Exact purpose, audience and requested exposure level; never permission grant |
| selected_framework_versions | Exact catalog/framework version IDs and lawful access/source pins |
| requirement_population_mode | EXPLICIT_REFERENCE_SET / FULL_FRAMEWORK |
| requirement_population | Explicit exact (framework_version_id, requirement_id/reference_id, record_version) tuples, or proven complete authoritative enumerable full-edition population |
| governed_subject_population | Exact org+kind+canonical ID set, relationship ID+state+typed endpoints, or immutable enumerable membership rule at cutoff; all 11 kinds remain possible, no evidence-based membership filter |
| allowed_source_connections | Exact tenant connection identities and allowed versioned scope; no automatic all-connections acquisition |
| evidence_source_versions | Exact typed target/version, run/snapshot/assertion/evidence IDs, handling and permitted digest |
| effective_at | Explicit upstream-precision instant |
| recorded_cutoff | Explicit upstream-precision instant and snapshot attestation |
| access_permission_context | Verified org/actor/session claim pins, credential epoch and existing authorization/policy context; no credentials persisted in projection; access checked now even for historical as-of |
| acquisition_completeness_state | COMPLETE_FOR_MANIFEST / PARTIAL_ACQUISITION / UNKNOWN |
| excluded_sources | Exact exclusions with rationale, review and limitation; never hidden from completeness statement |
| population_limitations | Bounded estate/reference population, source/licensing and paging constraints |
| UNKNOWN_conditions | Unavailable source/license, denied access, unknown membership/cardinality, partial paging, unproved snapshot, unresolved validity/version or unsupported as-of |

Freeze membership before axis evaluation; retain NOT_APPLICABLE. Complete means complete for manifest only. No unknown source silently excluded. Fail closed on conflicting duplicate tuple versions.

## 5. Temporal / dependency contract

| Field | Semantics |
| --- | --- |
| effective_at | Required, explicit; preserve PostgreSQL precision and source interval semantics |
| recorded_cutoff | Required, explicit; same cutoff for every selected dependency; never replace with generated_at |
| generated_at | Separate projection production timestamp; not evidence currency or effective time |
| source_versions | Immutable framework, mapping, evidence, state, decision, policy/authorization, resolver and projection algorithm vector |
| latest_rule | PROHIBITED unless a future versioned, explicit deterministic selection rule is approved; none supplied here |
| dependency_validity | Preserve expiry, revocation, support degradation, supersession, conflict and original validity basis; invalid pin -> DEPENDENCY_INVALID |
| restatement | Append new immutable projection with supersedes/restatement-reason and new source vector; retain old as-of result as historical and explicitly invalidated for present use where needed. Never rewrite upstream decisions. |
| cache | Disposable, recomputable; key includes mode, org, scope/version, subject/version, both time coordinates, source vector, access/entitlement context and projection version; revalidate access on reads/drill-down; no cross-tenant or cross-mode cache reuse |

| Atomic requirement | Semantics |
| --- | --- |
| required | ATOMIC |
| database | One proven consistent transaction snapshot across all mutable dependency reads (REPEATABLE READ or equivalent); explicit effective/cutoff pair passed to every resolver; current session eligibility revalidated before release |
| external_sources | Exact immutable versions/digests acquired and authorized for the same manifest; no mutable external latest |
| proof | Opaque snapshot/transaction attestation, exact dependency-version vector, completeness proof and resolver versions; token alone without proven binding insufficient |
| existing_support | Individual principal-bound RPCs support selected exact reads; independent requests and matching timestamp strings do not establish atomicity |
| failure | NON_ATOMIC -> UNKNOWN / INCOMPLETE_TEMPORAL_CUTOFF; internal diagnostic source panels may disclose NON_ATOMIC but may not produce a combined tenant assurance result |

## 6. V1-A2: closed read-security inventory

**RESOLVED_ARCHITECTURALLY_ONLY** by D-V1-04/D-V1-05/D-V1-06. No resolver is changed or executed.
This inventory covers 40 read categories. Every future read hop must resolve through an explicit listed category and exact source/target tuple; unlisted reads fail closed.
SQL authorization, application adapter behavior and cross-source atomicity are distinct checks. service_role is never authorization.

| Class | Meaning |
| --- | --- |
| PINNED_PRODUCT_METADATA | Immutable repository artifact with original provenance and repository access; no tenant assurance authorization. |
| PINNED_EXTERNAL_REFERENCE | Exact publisher/issuer metadata and lawful source entitlement; not tenant truth or legal applicability. |
| PRINCIPAL_BOUND_AUTHORIZED | DB revalidates principal and same-tenant exact key; original governed resolver semantics retained. |
| PRINCIPAL_BOUND_PROJECTION | DB-authorized composition of exact reads; no new authority; needs proven snapshot/completeness for assurance. |
| PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ | Observed technical transport facet of principal-bound DB reads; never an independent authorization class or bypass. |
| PRIVILEGED_APP_FILTERED | Server privilege plus application org/subject filtering; disallowed for tenant assurance despite verified ingress. |
| UNSAFE_FOR_V1 | Known unsafe assurance semantics, absent org/principal binding, legacy inference or unproved boundary. |
| NO_READ_SURFACE | Required tenant projection/artifact/resolver not established at the starting HEAD; fail closed. |

### 6.1 Source, data, principal and transport

The boolean fields describe the inspected path, not a grant of authority. Mixed legacy paths are marked privileged/direct at category level; per-path access remains unapproved. NO_READ_SURFACE describes an absent public Hub binding, not the nonexistence of internal canonical truth.

| Read ID | Source / projection | Data class | Tenant-bound / subject scope | Principal-bound / enforcement | SECURITY DEFINER / direct table / service_role | Security class |
| --- | --- | --- | --- | --- | --- | --- |
| R-PRODUCT | S0 inventory, S1 crosswalk/evidence/credibility and S2-S5/E1 documentary pack | PRODUCT_REPOSITORY_METADATA | false; PRODUCT | false; Existing repository read permission; no tenant data | false / false / false | PINNED_PRODUCT_METADATA |
| R-FRAMEWORK | FrameworkVersion / bounded requirement-reference catalog | EXTERNAL_PUBLIC_OR_LICENSED_REFERENCE | false; EXTERNAL | false; Repository access for existing bibliographic metadata; any licensed content requires separately verified entitlement | false / false / false | PINNED_EXTERNAL_REFERENCE |
| R-SESSION | passportPrincipal -> verified session -> GovernanceWritePrincipal | AUTHENTICATION_CONTEXT | true; ONE_ORGANISATION | true; Verified cookie at ingress; each DB hop must independently revalidate org/actor/iat/exp/exact credentialEpoch | false / false / false | PRINCIPAL_BOUND_AUTHORIZED |
| R-IDENTITY | Canonical subject identity and typed source mappings | TENANT_GOVERNED_OR_SUPPORTING_METADATA | true; EXACT_TYPED_SUBJECT_OR_ID | false; Verified ingress then application .eq organisation + ID filters and row tenant check; no DB principal revalidation in this read surface | false / true / true | PRIVILEGED_APP_FILTERED |
| R-RELATIONSHIP | Exact relationship identity/state/endpoints | TENANT_GOVERNED_OR_SUPPORTING_METADATA | true; EXACT_TYPED_SUBJECT_OR_ID | false; Verified ingress then application .eq organisation + ID filters and row tenant check; no DB principal revalidation in this read surface | false / true / true | PRIVILEGED_APP_FILTERED |
| R-PROFILE | Profile and assertion/evidence junctions | TENANT_GOVERNED_OR_SUPPORTING_METADATA | true; EXACT_TYPED_SUBJECT_OR_ID | false; Verified ingress then application .eq organisation + ID filters and row tenant check; no DB principal revalidation in this read surface | false / true / true | PRIVILEGED_APP_FILTERED |
| R-RECONCILIATION | Decision and reconciliation support lineage | TENANT_GOVERNED_OR_SUPPORTING_METADATA | true; EXACT_TYPED_SUBJECT_OR_ID | false; Verified ingress then application .eq organisation + ID filters and row tenant check; no DB principal revalidation in this read surface | false / true / true | PRIVILEGED_APP_FILTERED |
| R-EVIDENCE | Evidence, assertions and acquisition-run metadata | TENANT_GOVERNED_OR_SUPPORTING_METADATA | true; EXACT_TYPED_SUBJECT_OR_ID | false; Verified ingress then application .eq organisation + ID filters and row tenant check; no DB principal revalidation in this read surface | false / true / true | PRIVILEGED_APP_FILTERED |
| R-TECHNICAL | Technical governed fields and policy/observation lineage | TENANT_GOVERNED_OR_SUPPORTING_METADATA | true; EXACT_TYPED_SUBJECT_OR_ID | false; Verified ingress then application .eq organisation + ID filters and row tenant check; no DB principal revalidation in this read surface | false / true / true | PRIVILEGED_APP_FILTERED |
| R-LOOKUP | getCanonicalObjectForMatch canonical lookup | TENANT_CANONICAL_IDENTITY | true; EXACT_ORG_KIND_ID | false; Application organisation/kind/ID filter; not DB principal-bound | false / true / true | PRIVILEGED_APP_FILTERED |
| R-EXECUTION | executionRows / readExecutionReview / readExecutionDecision | TENANT_EXECUTION_FIELD_SUPPORT | true; EXACT_AGENT_VERSION_SNAPSHOT_FIELD | false; Application org filter and tenant row checks, snapshot/policy/decision consistency checks; no DB verified-principal read authorization | false / true / true | PRIVILEGED_APP_FILTERED |
| R-M16-PASSPORT | l14_read_passport_governance_v1 | TENANT_GOVERNED_READ | true; EXACT_AGENT_AND_OPTIONAL_AGENT_VERSION | true; PostgreSQL session/member basis revalidation and same-organisation exact subject/key selection; internal resolvers remain owner-only | true / false / true | PRINCIPAL_BOUND_PROJECTION; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-M16-CONFLICT | l14_read_fact_conflict_v1 | TENANT_GOVERNED_READ | true; EXACT_LOGICAL_FACT_KEY | true; PostgreSQL session/member basis revalidation and same-organisation exact subject/key selection; internal resolvers remain owner-only | true / false / true | PRINCIPAL_BOUND_PROJECTION; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-M16-POLICY | l14_read_policy_descriptors_v1 | TENANT_GOVERNED_READ | true; ORG_SCOPED_OR_EXACT_POLICY | true; PostgreSQL session/member basis revalidation and same-organisation exact subject/key selection; internal resolvers remain owner-only | true / false / true | PRINCIPAL_BOUND_PROJECTION; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-M17-RISK | l15_read_governed_risk_v1 | TENANT_GOVERNED_READ | true; EXACT_CANONICAL_OR_RELATIONSHIP_STATE_AND_SCENARIO | true; PostgreSQL session/member basis revalidation and same-organisation exact subject/key selection; internal resolvers remain owner-only | true / false / true | PRINCIPAL_BOUND_AUTHORIZED; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-M17-ASSESSMENT-V1 | l15_read_risk_assessment_v1 | TENANT_GOVERNED_READ | true; EXACT_RISK_STATE_INHERENT | true; PostgreSQL session/member basis revalidation and same-organisation exact subject/key selection; internal resolvers remain owner-only | true / false / true | PRINCIPAL_BOUND_AUTHORIZED; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-M17-ASSESSMENT-V2 | l15_read_risk_assessment_v2 | TENANT_GOVERNED_READ | true; EXACT_RISK_STATE_AND_INHERENT_OR_RESIDUAL | true; PostgreSQL session/member basis revalidation and same-organisation exact subject/key selection; internal resolvers remain owner-only | true / false / true | PRINCIPAL_BOUND_AUTHORIZED; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-M17-TREATMENT | l15_read_risk_treatment_v1 | TENANT_GOVERNED_READ | true; EXACT_RISK_STATE_OPTION_ORDINAL | true; PostgreSQL session/member basis revalidation and same-organisation exact subject/key selection; internal resolvers remain owner-only | true / false / true | PRINCIPAL_BOUND_AUTHORIZED; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-M17-ACCEPTANCE | l15_read_risk_acceptance_v1 | TENANT_GOVERNED_READ | true; EXACT_RESIDUAL_STATE | true; PostgreSQL session/member basis revalidation and same-organisation exact subject/key selection; internal resolvers remain owner-only | true / false / true | PRINCIPAL_BOUND_AUTHORIZED; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-M17-LIFECYCLE | l15_read_risk_projections_v1 | TENANT_GOVERNED_READ | true; EXACT_SUBJECT_AND_SCENARIO | true; PostgreSQL session/member basis revalidation and same-organisation exact subject/key selection; internal resolvers remain owner-only | true / false / true | PRINCIPAL_BOUND_PROJECTION; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-M17-OVERLAY | l15_read_passport_risk_overlay_v1 | TENANT_GOVERNED_READ | true; EXACT_AGENT_OR_AGENT_VERSION | true; PostgreSQL session/member basis revalidation and same-organisation exact subject/key selection; internal resolvers remain owner-only | true / false / true | PRINCIPAL_BOUND_PROJECTION; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-M17-SIGNALS | l15_read_signals_v1 | TENANT_NON_AUTHORITATIVE_ANALYSIS | true; EXACT_L15_SUBJECT | true; PostgreSQL session/member basis revalidation and same-organisation exact subject/key selection; internal resolvers remain owner-only | true / false / true | PRINCIPAL_BOUND_PROJECTION; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-M17-HYPOTHESES | l15_read_hypothesis_dispositions_v1 | TENANT_NON_AUTHORITATIVE_ANALYSIS | true; EXACT_L15_SUBJECT | true; PostgreSQL session/member basis revalidation and same-organisation exact subject/key selection; internal resolvers remain owner-only | true / false / true | PRINCIPAL_BOUND_PROJECTION; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-PASSPORT-ADAPTERS | readPassportGovernedFacts / readFactConflict / readPassportRiskOverlay | TENANT_GOVERNED_PRESENTATION | true; EXACT_AGENT_OR_FACT_KEY | true; DB principal-bound RPCs + app exact target/closed vocabulary checks | false / false / true | PRINCIPAL_BOUND_PROJECTION; transport PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ |
| R-PASSPORT-COMPOSITE | getAgentPassport | MIXED_TENANT_READ_COMPOSITION | true; EXACT_AGENT_AND_SELECTED_VERSION | false; Mixed app-filtered identity/fields/execution/support and principal-bound M16/M17 RPCs; verified ingress does not upgrade all children | false / true / true | PRIVILEGED_APP_FILTERED |
| R-INTERNAL-RESOLVERS | M16/M17 owner-only current/valid-state/dependency/support resolvers | INTERNAL_GOVERNED_DEPENDENCIES | true; EXACT_TYPED_FACT_STATE_AND_ORG | false; Owner-only internal components behind authorized RPC; not an application read entry point; SQL current/valid-state/support helpers use invoker context where defined, not their own verified-principal entry point. Retain each helper security mode; the outer RPC supplies the authorized owner context. | ROUTINE_SPECIFIC_OWNER_ONLY / false / false | NO_READ_SURFACE |
| R-AUDIT | audit.getIntegrity -> ledger_verify | LEGACY_TENANT_AUDIT_TRANSPORT | true; MIXED_ORG_FILTERED_COUNTS_AND_UNSCOPED_CHAIN | false; App org filters on counts; ledger_verify sequence walk lacks organisation filter and verified-principal binding | true / true / true | UNSAFE_FOR_V1 |
| R-LEGACY | Legacy agents/ai_systems, home, graph/search/Talk, incident/cost/oversight, reports, extension, graphos-complete/package compatibility | LEGACY_NON_AUTHORITATIVE | true; LEGACY_OR_UNPROVEN_SCOPE | false; Mixed path-specific app/server access; no admissible Hub assurance boundary | false / true / true | UNSAFE_FOR_V1 |
| R-TENANT-SCOPE | Scope manifest / complete governed subject and acquisition population | TENANT_EXECUTION_METADATA | true; ONE_ORG_ENUMERATED_SUBJECT_SET | false; No tenant authorization established | false / false / false | NO_READ_SURFACE |
| R-TENANT-MAPPING | Requirement -> mapping -> evidence -> subject normalized tenant links | TENANT_ASSURANCE_PROJECTION | true; EXACT_REQUIREMENT_SCOPE_AND_SUBJECT | false; No tenant authorization established | false / false / false | NO_READ_SURFACE |
| R-TENANT-LINEAGE | Full exact evidence/support target and decision/state/policy/authority lineage not exposed by bounded existing RPCs | TENANT_SUPPORTING_LINEAGE | true; EXACT_TYPED_TARGET_AND_ORG | false; No tenant authorization established | false / false / false | NO_READ_SURFACE |
| R-TENANT-REGISTRY | M16 party/domain/control and M17 scenario/methodology exact admitted validated version descriptors beyond existing returned pins | TENANT_GOVERNED_REFERENCE_METADATA | true; EXACT_REGISTRY_VERSION_AND_VALIDATED_STATE | false; No tenant authorization established | false / false / false | NO_READ_SURFACE |
| R-TENANT-GAPS | Normalized scoped tenant assurance gaps and applicability/sufficiency review metadata | TENANT_ASSURANCE_PROJECTION | true; EXACT_MANIFEST_AND_REQUIREMENT | false; No tenant authorization established | false / false / false | NO_READ_SURFACE |
| R-TENANT-KPI | Operational count evaluator / population audit projection | TENANT_EXECUTION_METADATA | true; EXACT_DEFINITION_VERSION_AND_MANIFEST | false; No tenant authorization established | false / false / false | NO_READ_SURFACE |
| R-REVIEW | Claim wording/exposure, applicability/sufficiency, freshness and publication review workflow | REVIEW_METADATA | true; EXACT_VERSIONED_SCOPE_AND_AUDIENCE | false; No tenant authorization established | false / false / false | NO_READ_SURFACE |
| R-EXTERNAL-ARTIFACT | Authenticated certification/attestation or nomination/finalist/winner artifact resolution | EXTERNAL_ARTIFACT_REFERENCE | true; EXACT_ISSUER_SUBJECT_FRAMEWORK_SCOPE | false; No tenant authorization established | false / false / false | NO_READ_SURFACE |
| R-ATOMIC | Cross-source read transaction and completeness/snapshot attestation | TENANT_EXECUTION_METADATA | true; ONE_ORGANISATION_ONE_SNAPSHOT | false; No tenant authorization established | false / false / false | NO_READ_SURFACE |
| R-AWARDS | Award edition records and calendar events | PRODUCT_AWARD_REFERENCE_METADATA | false; PRODUCT | false; Repository access to pinned public organizer metadata; no applicant dossier authorization supplied | false / false / false | PINNED_PRODUCT_METADATA |
| R-RUNTIME-EXACT | readPersistedRuntimeObservation -> read_runtime_observation_exact | TENANT_RUNTIME_SUPPORTING_OBSERVATION | true; EXACT_ORG_CONNECTION_OBSERVATION | false; SQL exact org/connection/observation filtering and app identity validation, but no verified session/principal parameters or DB session authorization; scoped lookup is not principal authorization | true / false / true | UNSAFE_FOR_V1 |
| R-CROSS-SIGNAL | readCrossSignalComparisonResult and trusted design-time adapters | TENANT_ANALYTICAL_COMPARISON_SUPPORT | true; EXACT_ORG_COMPARISON_AND_RELATIONSHIP_STATE | false; Application org and exact typed key/lineage checks; runtime child uses R-RUNTIME-EXACT and canonical/execution children use app-filtered executionRows | false / true / true | PRIVILEGED_APP_FILTERED |

### 6.2 Time, failure and V1 disposition

CONDITIONAL_COMPONENT_ONLY means an existing authorized read can be composed later; it does not assert Hub availability, acquisition completeness, applicable source population or a shared snapshot.

| Read ID | effective_at | recorded_cutoff | Atomic support | Failure | V1 use / additive projection |
| --- | --- | --- | --- | --- | --- |
| R-PRODUCT | PRODUCT_GIT_SNAPSHOT with original date precision | Exact Git artifact/version vector | IMMUTABLE_PINNED_VECTOR | UNKNOWN; no substitute read or positive assertion | PRODUCT_METADATA_ONLY; additive=false |
| R-FRAMEWORK | Exact original edition, not operative applicability | Pinned catalog record/version | IMMUTABLE_PINNED_VECTOR | UNKNOWN; no substitute read or positive assertion | BOUNDED_REFERENCE_METADATA_ONLY; additive=false |
| R-SESSION | NONE | NONE | NOT_ESTABLISHED | ACCESS_DENIED; no user-supplied organisation/actor or rounded credential epoch | IDENTITY_INPUT_ONLY; additive=false |
| R-IDENTITY | Mixed application Date.now/valid_from checks; no general explicit effective_at | No shared recorded_cutoff API or snapshot | NOT_ESTABLISHED | Current query errors/tenant mismatch throw; missing support may be omitted. V1 rejects this route, never treats omitted support as absence. | NO; additive=true |
| R-RELATIONSHIP | Mixed application Date.now/valid_from checks; no general explicit effective_at | No shared recorded_cutoff API or snapshot | NOT_ESTABLISHED | Current query errors/tenant mismatch throw; missing support may be omitted. V1 rejects this route, never treats omitted support as absence. | NO; additive=true |
| R-PROFILE | Mixed application Date.now/valid_from checks; no general explicit effective_at | No shared recorded_cutoff API or snapshot | NOT_ESTABLISHED | Current query errors/tenant mismatch throw; missing support may be omitted. V1 rejects this route, never treats omitted support as absence. | NO; additive=true |
| R-RECONCILIATION | Mixed application Date.now/valid_from checks; no general explicit effective_at | No shared recorded_cutoff API or snapshot | NOT_ESTABLISHED | Current query errors/tenant mismatch throw; missing support may be omitted. V1 rejects this route, never treats omitted support as absence. | NO; additive=true |
| R-EVIDENCE | Mixed application Date.now/valid_from checks; no general explicit effective_at | No shared recorded_cutoff API or snapshot | NOT_ESTABLISHED | Current query errors/tenant mismatch throw; missing support may be omitted. V1 rejects this route, never treats omitted support as absence. Runtime/cross-signal typed support has separately classified R-RUNTIME-EXACT/R-CROSS-SIGNAL paths, also ineligible as-is. | NO; additive=true |
| R-TECHNICAL | Mixed application Date.now/valid_from checks; no general explicit effective_at | No shared recorded_cutoff API or snapshot | NOT_ESTABLISHED | Current query errors/tenant mismatch throw; missing support may be omitted. V1 rejects this route, never treats omitted support as absence. | NO; additive=true |
| R-LOOKUP | NONE | NONE | NOT_ESTABLISHED | UNKNOWN; no substitute read or positive assertion | NO; additive=true |
| R-EXECUTION | Application readAt filtering; mutable heads also read | No complete historical snapshot API | NOT_ESTABLISHED | Query/limit/shape failures throw; Hub must not reuse application-only access as tenant assurance | NO; additive=true |
| R-M16-PASSPORT | Explicit SQL parameter; V1 requires non-null pinned value | Explicit SQL parameter; V1 requires non-null pinned value | NOT_ESTABLISHED | DB invalid-session/key error -> ACCESS_DENIED or DEPENDENCY_INVALID; resolver UNKNOWN/absent stays explicit; never infer readiness/certification | CONDITIONAL_COMPONENT_ONLY; additive=true |
| R-M16-CONFLICT | Explicit SQL parameter; V1 requires non-null pinned value | Explicit SQL parameter; V1 requires non-null pinned value | NOT_ESTABLISHED | DB invalid-session/key error -> ACCESS_DENIED or DEPENDENCY_INVALID; resolver UNKNOWN/absent stays explicit; never infer readiness/certification | CONDITIONAL_COMPONENT_ONLY; additive=true |
| R-M16-POLICY | NO_EXPLICIT_AS_OF_PARAMETER | NO_EXPLICIT_CUTOFF_PARAMETER | NOT_ESTABLISHED | DB invalid-session/key error -> ACCESS_DENIED or DEPENDENCY_INVALID; resolver UNKNOWN/absent stays explicit; never infer readiness/certification | NO_TENANT_AS_OF_USE; additive=true |
| R-M17-RISK | Explicit SQL parameter; V1 requires non-null pinned value | Explicit SQL parameter; V1 requires non-null pinned value | NOT_ESTABLISHED | DB invalid-session/key error -> ACCESS_DENIED or DEPENDENCY_INVALID; resolver UNKNOWN/absent stays explicit; never infer readiness/certification | CONDITIONAL_COMPONENT_ONLY; additive=true |
| R-M17-ASSESSMENT-V1 | Explicit SQL parameter; V1 requires non-null pinned value | Explicit SQL parameter; V1 requires non-null pinned value | NOT_ESTABLISHED | DB invalid-session/key error -> ACCESS_DENIED or DEPENDENCY_INVALID; resolver UNKNOWN/absent stays explicit; never infer readiness/certification | CONDITIONAL_COMPONENT_ONLY; additive=true |
| R-M17-ASSESSMENT-V2 | Explicit SQL parameter; V1 requires non-null pinned value | Explicit SQL parameter; V1 requires non-null pinned value | NOT_ESTABLISHED | DB invalid-session/key error -> ACCESS_DENIED or DEPENDENCY_INVALID; resolver UNKNOWN/absent stays explicit; never infer readiness/certification | CONDITIONAL_COMPONENT_ONLY; additive=true |
| R-M17-TREATMENT | Explicit SQL parameter; V1 requires non-null pinned value | Explicit SQL parameter; V1 requires non-null pinned value | NOT_ESTABLISHED | DB invalid-session/key error -> ACCESS_DENIED or DEPENDENCY_INVALID; resolver UNKNOWN/absent stays explicit; never infer readiness/certification | CONDITIONAL_COMPONENT_ONLY; additive=true |
| R-M17-ACCEPTANCE | Explicit SQL parameter; V1 requires non-null pinned value | Explicit SQL parameter; V1 requires non-null pinned value | NOT_ESTABLISHED | DB invalid-session/key error -> ACCESS_DENIED or DEPENDENCY_INVALID; resolver UNKNOWN/absent stays explicit; never infer readiness/certification | CONDITIONAL_COMPONENT_ONLY; additive=true |
| R-M17-LIFECYCLE | Explicit SQL parameter; V1 requires non-null pinned value | Explicit SQL parameter; V1 requires non-null pinned value | NOT_ESTABLISHED | DB invalid-session/key error -> ACCESS_DENIED or DEPENDENCY_INVALID; resolver UNKNOWN/absent stays explicit; never infer readiness/certification | CONDITIONAL_COMPONENT_ONLY; additive=true |
| R-M17-OVERLAY | Explicit SQL parameter; V1 requires non-null pinned value | Explicit SQL parameter; V1 requires non-null pinned value | NOT_ESTABLISHED | DB invalid-session/key error -> ACCESS_DENIED or DEPENDENCY_INVALID; resolver UNKNOWN/absent stays explicit; never infer readiness/certification | CONDITIONAL_COMPONENT_ONLY; additive=true |
| R-M17-SIGNALS | NO_EXPLICIT_AS_OF_PARAMETER | NO_EXPLICIT_CUTOFF_PARAMETER | NOT_ESTABLISHED | DB invalid-session/key error -> ACCESS_DENIED or DEPENDENCY_INVALID; resolver UNKNOWN/absent stays explicit; never infer readiness/certification; LIMIT 1000 is not a complete population or pagination proof; strip hint_confidence from Hub assurance measures | NO_TENANT_AS_OF_USE; additive=true |
| R-M17-HYPOTHESES | NO_EXPLICIT_AS_OF_PARAMETER | NO_EXPLICIT_CUTOFF_PARAMETER | NOT_ESTABLISHED | DB invalid-session/key error -> ACCESS_DENIED or DEPENDENCY_INVALID; resolver UNKNOWN/absent stays explicit; never infer readiness/certification; LIMIT 1000 is not a complete population or pagination proof; strip hint_confidence from Hub assurance measures | NO_TENANT_AS_OF_USE; additive=true |
| R-PASSPORT-ADAPTERS | Adapters hard-code null; SQL supports pins | Adapters hard-code null; overlay adapter does not retain output cutoff in returned object | NOT_ESTABLISHED | Exceptions on malformed rows; V1 needs additive pinned adapter preserving time/provenance | NO_CROSS_SOURCE_ASSURANCE_AS_IS; additive=true |
| R-PASSPORT-COMPOSITE | Date.now plus independent RPC null/null instants | No cross-source snapshot proof | NOT_ESTABLISHED | Hub cannot treat existing 16-family Passport composition as authorized atomic assurance or completeness proof | NO; additive=true |
| R-INTERNAL-RESOLVERS | Internal exact arguments where defined | Internal exact arguments where defined | NOT_ESTABLISHED | No direct service-role invocation/grant expansion; additive authorized projection must expose only admissible exact lineage | INTERNAL_ONLY_BEHIND_AUTHORIZED_COMPOSITION; additive=true |
| R-AUDIT | NONE | NONE | NOT_ESTABLISHED | Reject Hub consumption: empty returns true and missing row defaults false/BROKEN; future scoped authorized projection must preserve UNKNOWN and explicit EMPTY independently of legacy payload truth | NO; additive=true |
| R-LEGACY | NONE | NONE | NOT_ESTABLISHED | No legacy bridge, name matching, flags/scores/defaults or payload-based assurance truth; affected exposure remains blocked | NO; additive=true |
| R-TENANT-SCOPE | NONE | NONE | NOT_ESTABLISHED | SOURCE_PENDING / NOT_ASSESSED / UNKNOWN as appropriate; no runtime surface or positive result invented in S0 | NO; additive=true |
| R-TENANT-MAPPING | NONE | NONE | NOT_ESTABLISHED | SOURCE_PENDING / NOT_ASSESSED / UNKNOWN as appropriate; no runtime surface or positive result invented in S0 | NO; additive=true |
| R-TENANT-LINEAGE | NONE | NONE | NOT_ESTABLISHED | SOURCE_PENDING / NOT_ASSESSED / UNKNOWN as appropriate; no runtime surface or positive result invented in S0 | NO; additive=true |
| R-TENANT-REGISTRY | NONE | NONE | NOT_ESTABLISHED | SOURCE_PENDING / NOT_ASSESSED / UNKNOWN as appropriate; no runtime surface or positive result invented in S0 | NO; additive=true |
| R-TENANT-GAPS | NONE | NONE | NOT_ESTABLISHED | SOURCE_PENDING / NOT_ASSESSED / UNKNOWN as appropriate; no runtime surface or positive result invented in S0 | NO; additive=true |
| R-TENANT-KPI | NONE | NONE | NOT_ESTABLISHED | SOURCE_PENDING / NOT_ASSESSED / UNKNOWN as appropriate; no runtime surface or positive result invented in S0 | NO; additive=true |
| R-REVIEW | NONE | NONE | NOT_ESTABLISHED | SOURCE_PENDING / NOT_ASSESSED / UNKNOWN as appropriate; no runtime surface or positive result invented in S0 | NO; additive=true |
| R-EXTERNAL-ARTIFACT | NONE | NONE | NOT_ESTABLISHED | SOURCE_PENDING / NOT_ASSESSED / UNKNOWN as appropriate; no runtime surface or positive result invented in S0 | NO; additive=true |
| R-ATOMIC | NONE | NONE | NOT_ESTABLISHED | SOURCE_PENDING / NOT_ASSESSED / UNKNOWN as appropriate; no runtime surface or positive result invented in S0 | NO; additive=true |
| R-AWARDS | Original edition/date precision/timezone retained | Pinned award/calendar versions | IMMUTABLE_PINNED_VECTOR | Eligibility UNKNOWN, source conflicts/pending stay explicit; no probability, award-ready or outcome without external artifact | PRODUCT_METADATA_ONLY; additive=false |
| R-RUNTIME-EXACT | Immutable observation identity, no generic explicit as-of read contract | No explicit shared cutoff/snapshot API | NOT_ESTABLISHED | Not eligible for Hub tenant assurance as-is; add principal-bound exact supporting-evidence projection; runtime admission never governance authority | NO; additive=true |
| R-CROSS-SIGNAL | Exact historical dependency identities but no complete explicit bitemporal projection | No shared cross-source snapshot | NOT_ESTABLISHED | No upgrade of ANALYTICAL comparison into requirement satisfaction or governed truth; missing/mismatched support fails closed; additive principal-bound projection required | NO; additive=true |

### 6.3 Explicit table subhops, adapter limits and source pins

The exact Git blob and LF UTF-8 digest for every locator are in JSON. No deployed schema, hosted reachability or tenant rows were inspected.

- **R-PRODUCT**: [docs/codex/evidence/2026-10-20-m17.5-s0-trust-assurance-inventory.json:62](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/codex/evidence/2026-10-20-m17.5-s0-trust-assurance-inventory.json#L62); [docs/trust-assurance/v0-closure-errata-v1.json:889](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/v0-closure-errata-v1.json#L889).
- **R-FRAMEWORK**: [docs/trust-assurance/framework-source-catalog-v0.json:33](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/framework-source-catalog-v0.json#L33).
- **R-SESSION**: [apps/dashboard/lib/governance/passport-session.ts:19](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-session.ts#L19); [apps/dashboard/lib/auth/governance-write-principal.ts:12](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/auth/governance-write-principal.ts#L12).
- **R-IDENTITY**: tables `canonical_objects`, `canonical_normalized_object_mappings`, `canonical_object_source_mappings`. [apps/dashboard/lib/governance/passport-read-store.ts:105](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-read-store.ts#L105); [apps/dashboard/lib/governance/passport-query.ts:20](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-query.ts#L20).
- **R-RELATIONSHIP**: tables `canonical_relationships`. [apps/dashboard/lib/governance/passport-read-store.ts:105](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-read-store.ts#L105); [apps/dashboard/lib/governance/passport-query.ts:20](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-query.ts#L20).
- **R-PROFILE**: tables `agent_version_technical_profiles`, `agent_version_technical_profile_field_assertions`, `agent_version_technical_profile_field_evidence`. [apps/dashboard/lib/governance/passport-read-store.ts:105](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-read-store.ts#L105); [apps/dashboard/lib/governance/passport-query.ts:20](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-query.ts#L20).
- **R-RECONCILIATION**: tables `reconciliation_decisions`, `reconciliation_decision_assertions`, `reconciliation_decision_evidence`, `reconciliation_invocations`, `review_subjects`. [apps/dashboard/lib/governance/passport-read-store.ts:105](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-read-store.ts#L105); [apps/dashboard/lib/governance/passport-query.ts:20](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-query.ts#L20).
- **R-EVIDENCE**: tables `source_assertions`, `discovery_evidence`, `acquisition_runs`. [apps/dashboard/lib/governance/passport-read-store.ts:105](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-read-store.ts#L105); [apps/dashboard/lib/governance/passport-query.ts:20](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-query.ts#L20).
- **R-TECHNICAL**: tables `technical_field_states`, `technical_fact_proposals`, `technical_field_decisions`, `technical_field_policy_heads`, `technical_fact_observations`, `technical_fact_observation_assertions`, `technical_fact_observation_evidence`. [apps/dashboard/lib/governance/passport-read-store.ts:105](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-read-store.ts#L105); [apps/dashboard/lib/governance/passport-query.ts:20](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-query.ts#L20).
- **R-LOOKUP**: tables `canonical_objects`, `canonical_object_source_mappings`. [apps/dashboard/lib/governance/canonical-object-lookup.ts:123](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/canonical-object-lookup.ts#L123).
- **R-EXECUTION**: tables `execution_source_snapshots`, `execution_source_heads`, `execution_source_facts`, `execution_field_policies`, `execution_field_policy_heads`, `execution_field_decisions`, `execution_field_states`, `canonical_normalized_object_mappings`, `canonical_objects`. [apps/dashboard/lib/governance/execution-context-read.ts:22](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/execution-context-read.ts#L22); [apps/dashboard/lib/governance/passport-execution-query.ts:6](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-execution-query.ts#L6).
- **R-M16-PASSPORT**: [supabase/migrations/20261012120000_m16_read_projection_closure_v1.sql:202](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261012120000_m16_read_projection_closure_v1.sql#L202).
- **R-M16-CONFLICT**: [supabase/migrations/20261012120000_m16_read_projection_closure_v1.sql:349](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261012120000_m16_read_projection_closure_v1.sql#L349).
- **R-M16-POLICY**: [supabase/migrations/20261008120000_m16_s1b4_policy_version_validation_v1.sql:969](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261008120000_m16_s1b4_policy_version_validation_v1.sql#L969).
- **R-M17-RISK**: Existing adapter forwards request effectiveAt/recordedCutoff and verified principal; V1 must reject nullable/default selection, validate exact closed returned shape/lineage and preserve original precision. Independent calls still not atomic. [supabase/migrations/20261013140000_m17_s3_governed_risk_v1.sql:1937](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261013140000_m17_s3_governed_risk_v1.sql#L1937); [apps/dashboard/lib/governance/l15-governed-risk-persistence.ts:169](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/l15-governed-risk-persistence.ts#L169).
- **R-M17-ASSESSMENT-V1**: Existing adapter forwards request effectiveAt/recordedCutoff and verified principal; V1 must reject nullable/default selection, validate exact closed returned shape/lineage and preserve original precision. Independent calls still not atomic. [supabase/migrations/20261013160000_m17_s4_inherent_risk_assessment_v1.sql:1888](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261013160000_m17_s4_inherent_risk_assessment_v1.sql#L1888); [apps/dashboard/lib/governance/l15-risk-assessment-persistence.ts:156](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/l15-risk-assessment-persistence.ts#L156).
- **R-M17-ASSESSMENT-V2**: Existing adapter forwards request effectiveAt/recordedCutoff and verified principal; V1 must reject nullable/default selection, validate exact closed returned shape/lineage and preserve original precision. Independent calls still not atomic. [supabase/migrations/20261016021012_m17_s6_residual_risk_acceptance_v1.sql:1102](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261016021012_m17_s6_residual_risk_acceptance_v1.sql#L1102); [apps/dashboard/lib/governance/l15-residual-risk-assessment-persistence.ts:144](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/l15-residual-risk-assessment-persistence.ts#L144).
- **R-M17-TREATMENT**: Existing adapter forwards request effectiveAt/recordedCutoff and verified principal; V1 must reject nullable/default selection, validate exact closed returned shape/lineage and preserve original precision. Independent calls still not atomic. [supabase/migrations/20261015122639_m17_s5_risk_treatment_v1.sql:993](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261015122639_m17_s5_risk_treatment_v1.sql#L993); [apps/dashboard/lib/governance/l15-risk-treatment-persistence.ts:56](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/l15-risk-treatment-persistence.ts#L56).
- **R-M17-ACCEPTANCE**: Existing adapter forwards request effectiveAt/recordedCutoff and verified principal; V1 must reject nullable/default selection, validate exact closed returned shape/lineage and preserve original precision. Independent calls still not atomic. [supabase/migrations/20261016021012_m17_s6_residual_risk_acceptance_v1.sql:1891](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261016021012_m17_s6_residual_risk_acceptance_v1.sql#L1891); [apps/dashboard/lib/governance/l15-risk-acceptance-persistence.ts:53](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/l15-risk-acceptance-persistence.ts#L53).
- **R-M17-LIFECYCLE**: Existing adapter forwards request effectiveAt/recordedCutoff and verified principal; V1 must reject nullable/default selection, validate exact closed returned shape/lineage and preserve original precision. Independent calls still not atomic. [supabase/migrations/20261017020733_m17_s7a_read_projections_v1.sql:33](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261017020733_m17_s7a_read_projections_v1.sql#L33); [apps/dashboard/lib/governance/l15-read-projections-persistence.ts:8](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/l15-read-projections-persistence.ts#L8).
- **R-M17-OVERLAY**: [supabase/migrations/20261019130000_m17_s7b_passport_risk_overlay_v1.sql:27](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261019130000_m17_s7b_passport_risk_overlay_v1.sql#L27).
- **R-M17-SIGNALS**: [supabase/migrations/20261012210000_m17_s1_signals_hypotheses_support_v1.sql:1055](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261012210000_m17_s1_signals_hypotheses_support_v1.sql#L1055).
- **R-M17-HYPOTHESES**: [supabase/migrations/20261020031523_m17_s7d_adversarial_corrective_v1.sql:99](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261020031523_m17_s7d_adversarial_corrective_v1.sql#L99).
- **R-PASSPORT-ADAPTERS**: [apps/dashboard/lib/governance/passport-governance-read.ts:92](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-governance-read.ts#L92); [apps/dashboard/lib/governance/passport-risk-overlay-read.ts:23](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-risk-overlay-read.ts#L23).
- **R-PASSPORT-COMPOSITE**: [apps/dashboard/lib/governance/passport-query.ts:17](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/passport-query.ts#L17).
- **R-INTERNAL-RESOLVERS**: [supabase/migrations/20261012120000_m16_read_projection_closure_v1.sql:749](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261012120000_m16_read_projection_closure_v1.sql#L749); [supabase/migrations/20261017020733_m17_s7a_read_projections_v1.sql:19](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20261017020733_m17_s7a_read_projections_v1.sql#L19).
- **R-AUDIT**: [apps/dashboard/repositories/audit.ts:180](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/repositories/audit.ts#L180); [supabase/migrations/20260818003710_gov_repo_identity_and_ledger.sql:147](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20260818003710_gov_repo_identity_and_ledger.sql#L147).
- **R-LEGACY**: [docs/trust-assurance/v0-closure-review.json:4217](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/v0-closure-review.json#L4217); [docs/trust-assurance/v0-closure-errata-v1.json:1473](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/v0-closure-errata-v1.json#L1473).
- **R-TENANT-SCOPE**: [docs/trust-assurance/kpi-framework-v0.json:276](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/kpi-framework-v0.json#L276); [docs/trust-assurance/v0-closure-review.json:4634](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/v0-closure-review.json#L4634).
- **R-TENANT-MAPPING**: [docs/trust-assurance/kpi-framework-v0.json:276](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/kpi-framework-v0.json#L276); [docs/trust-assurance/v0-closure-review.json:4634](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/v0-closure-review.json#L4634).
- **R-TENANT-LINEAGE**: [docs/trust-assurance/kpi-framework-v0.json:276](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/kpi-framework-v0.json#L276); [docs/trust-assurance/v0-closure-review.json:4634](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/v0-closure-review.json#L4634).
- **R-TENANT-REGISTRY**: [docs/trust-assurance/kpi-framework-v0.json:276](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/kpi-framework-v0.json#L276); [docs/trust-assurance/v0-closure-review.json:4634](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/v0-closure-review.json#L4634).
- **R-TENANT-GAPS**: [docs/trust-assurance/kpi-framework-v0.json:276](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/kpi-framework-v0.json#L276); [docs/trust-assurance/v0-closure-review.json:4634](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/v0-closure-review.json#L4634).
- **R-TENANT-KPI**: [docs/trust-assurance/kpi-framework-v0.json:276](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/kpi-framework-v0.json#L276); [docs/trust-assurance/v0-closure-review.json:4634](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/v0-closure-review.json#L4634).
- **R-REVIEW**: [docs/trust-assurance/kpi-framework-v0.json:276](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/kpi-framework-v0.json#L276); [docs/trust-assurance/v0-closure-review.json:4634](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/v0-closure-review.json#L4634).
- **R-EXTERNAL-ARTIFACT**: [docs/trust-assurance/kpi-framework-v0.json:276](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/kpi-framework-v0.json#L276); [docs/trust-assurance/v0-closure-review.json:4634](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/v0-closure-review.json#L4634).
- **R-ATOMIC**: [docs/trust-assurance/kpi-framework-v0.json:276](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/kpi-framework-v0.json#L276); [docs/trust-assurance/v0-closure-review.json:4634](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/v0-closure-review.json#L4634).
- **R-AWARDS**: [docs/trust-assurance/award-readiness-matrix-v0.json:447](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/award-readiness-matrix-v0.json#L447); [docs/trust-assurance/award-calendar-v0.json:30](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/docs/trust-assurance/award-calendar-v0.json#L30).
- **R-RUNTIME-EXACT**: [apps/dashboard/lib/governance/cross-signal-read.ts:170](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/cross-signal-read.ts#L170); [supabase/migrations/20260923060000_cross_signal_persistence_v1.sql:68](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/supabase/migrations/20260923060000_cross_signal_persistence_v1.sql#L68).
- **R-CROSS-SIGNAL**: tables `cross_signal_comparison_results`, `cross_signal_comparison_left_relationship_states`, `canonical_relationships`. [apps/dashboard/lib/governance/cross-signal-persistence.ts:110](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/cross-signal-persistence.ts#L110); [apps/dashboard/lib/governance/cross-signal-read.ts:38](https://github.com/cnegrao/code-guard-governance/blob/a85f97225777e1dd1fd67109a349c3be6e45d0ad/apps/dashboard/lib/governance/cross-signal-read.ts#L38).

## 7. UNKNOWN and failure rendering

Do not merge acquisition, authorization, dependency validity, assessment and assurance axes. Preserve upstream reason codes and categorical states. No empty result automatically becomes safe/compliant/green; no access failure becomes absence.

| State | Rendering |
| --- | --- |
| UNKNOWN | Unestablished axis/population/dependency; show reason and authorized limitations; null measure, never zero or green. |
| NOT_MAPPED | Known missing mapping within a verified evaluated reference set; not a failed requirement or compliance verdict. |
| NOT_APPLICABLE | Reviewed rationale for exact scoped requirement/version; preserve membership and review; no automatic READY. |
| NOT_ASSESSED | Workflow/sufficiency assessment not performed; no inferred favorable or unfavorable outcome; not a new authority axis. |
| INSUFFICIENT_EVIDENCE | Known evaluated dependency or resolver lacks sufficient support; display exact limitation, never equate availability with sufficiency. |
| SOURCE_PENDING | Missing authoritative source/license or source population; unknown cardinality stays unknown, no empty full-framework count. |
| ACCESS_DENIED | Authorization failed; disclose no unauthorized target existence/content/count. Never convert to not found or absence in assurance semantics. |
| PARTIAL_ACQUISITION | Any page/source/connection incomplete; combined result UNKNOWN. Authorized diagnostic rows labelled partial cannot be presented as a complete count. |
| DEPENDENCY_INVALID | Conflicting identities, invalid policy/state pins, revocation/expiry or unsupported shapes; no current affirmative result. Preserve exact historical record. |
| NOT_ASSERTED | No certification/attestation assertion in this scope; neither proof of absence nor an invitation to infer certification. |

## 8. V1-A1: denominator decision

**RESOLVED_ARCHITECTURALLY_ONLY** by D-V1-08. Selected: B_TYPED_NON_COMPOSABLE_COUNTS_WITH_AUDIT_IDENTITY_SEPARATION.

KPI_DEFINITION catalogue only; 11 definitions, five PRODUCT and six TENANT, COUNT/PARTITIONED_COUNT only. No execution or results introduced.

| Alternative | Evaluation |
| --- | --- |
| A | Audit-only population metadata reduces accidental reuse but lacks a typed client/operator prohibition by itself. |
| B | Chosen: closed measure and renderer semantics plus separate audit membership proof bind conservation and prevent ratio composition in conforming Hub clients. |
| C | Partitions retain UNKNOWN but a generic sum of all buckets still becomes a denominator. Partitioning alone does not resolve the hazard. |

| Generic future projection field | Contract |
| --- | --- |
| type | COUNT_OBSERVATION_V1 (future design, no runtime schema) |
| fields | definition_ref/version; predicate_version; mode; scope_ref/version; measure_semantics; evaluation_state; display_count OR closed named display partitions when KNOWN, otherwise null; population_audit_ref; source_version_refs; effective_at; recorded_cutoff; generated_at; limitations; reason_codes |
| absent_fields | known_population; denominator; total_population; coverage; percentage; ratio; score; numeric_completeness |
| allowed_operations | DISPLAY_INTEGER; DISPLAY_CLOSED_PARTITIONS; FILTER_DECLARED_DIMENSION; DRILL_DOWN_AUTHORIZED |
| prohibited_operations | DIVIDE; RATIO; PERCENT; WEIGHT; NORMALIZE; RANK_ASSURANCE; SUM_ACROSS_AXES; SUM_ACROSS_KPIS; SUM_PARTITIONS_AS_DENOMINATOR |
| renderers | COUNT; PARTITIONED_COUNT; STATE; DEFINITION |
| unknown | Unenumerated/unavailable source or predicate dependency => whole result UNKNOWN and all displayed measures null; known UNKNOWN-category members may have an integer only within a complete evaluated partition. |

| Audit boundary | Contract |
| --- | --- |
| access | Separately authorized auditor drill-down using existing permissions; no new permission. Generic clients receive only an opaque audit reference, no arithmetic endpoint or denominator scalar. |
| content | Explicit manifest population selection rule/version; authorized exact evaluated member identities and member/partition digests; excluded/unknown conditions, deduplication keys, input versions, completeness and predicate decision per member; no inaccessible member count. |
| conservation | Prove exact selected member set equals disjoint union of all named state partitions, including known UNKNOWN-state members. Unknown/unacquired membership invalidates completeness; null is never zero. Proof is a reproducible set-membership check, not a numeric percentage denominator. |
| no_hidden_denominator | No denominator maintained or transmitted under a renamed field; the audit population proof is openly documented here and cannot be composed into generic assurance arithmetic. |

Future API serialization allowlist rejects forbidden arithmetic fields/operators; client view schema and export/LLM tools accept only closed renderers. Reject on both server and presentation boundaries, including malicious query/visualization templates. Never rely only on explanatory labels.

Authorized people can count accessible records outside the Hub. This design prevents prohibited composition in conforming Hub clients; it does not claim to prevent arbitrary off-system arithmetic. No raw historical KPI result envelope may be forwarded.

No historical KPI framework edit, denominator alias, hidden denominator, generic arithmetic endpoint or aggregate score. Complete set proof includes known UNKNOWN members, never unknown/unacquired cardinality. No KPI execution or executed result is supplied.

## 9. Claims, gap populations, certification and awards

| Claim field | Contract |
| --- | --- |
| controlling_source | S2_COMMERCIAL_CLAIMS_REGISTER |
| controlling_field | capability_ceilings.current_claim_ceiling |
| s1_alignment_candidate_role | HISTORICAL_MAPPING_METADATA_ONLY |
| s1_effective_publication_ceiling | false |
| required_projection_fields | claim_id/version; exact_wording; claim_class; eligibility; controlling_ceiling_and_source_version; record_access_state; affirmative_use_state; required_reviewers; unresolved_gap_refs; validity; invalidation_triggers; scope; evidence_and_mapping_refs; exposure_state |
| current_counts | {"INELIGIBLE":42,"INTERNAL_ONLY":42,"PROHIBITED":42} |
| failure | Missing/inconsistent S2 or E1 -> no affirmative claim; do not fall back to S1 |
| reviews | Named independent scope-qualified reviewer of exact wording, source vector, freshness, sufficiency where required, publication and actual exposed surfaces. Review cannot override a ceiling or prerequisite. |
| invalidation_triggers | Input/version change; Source correction/supersession; Evidence expiry/revocation/degraded support; Mapping/applicability/wording/presentation change; Access or review validity loss |
| e1_correction | CL-CERTIFICATION-01 scoped mapping UNKNOWN for ISO-IEC-42001-2023-ED1; historical S2 record remains unchanged; no external artifact. |

| Population | Membership / state | Display boundary |
| --- | --- | --- |
| ASSURANCE_GAPS | 61 historical S2 members; all OPEN | Historical S2 assurance gaps: 61 OPEN |
| PRESENTATION_EXPOSURE_GATES | 14 known E1 members; open universe, not exhaustive | L04_PACKAGE_COMPATIBILITY expands L04; not a fifteenth member |

No sum across populations; never label the first population “61 total gaps”. All 38 controlling ceilings and 42 exact claim IDs are retained in JSON and resolve to pinned S2/E1.

| Certification field | Contract |
| --- | --- |
| current_state | NOT_ASSERTED |
| external_artifacts_in_pack | 0 |
| positive_requires | independent_issuer; authenticated_issuer_source; exact_subject_identity_and_legal_entity; framework_version; bounded_scope; valid_from; valid_until_or_explicit_issuer_validity_semantics; artifact_identity_and_version; verification_state_and_basis_at_cutoff; revocation_and_expiry_status_basis |
| states | Preserve parent NOT_ASSERTED/CERTIFIED/ATTESTED/UNKNOWN vocabulary and independent artifact verification states; expired/revoked stays historical, never current positive. |
| cannot_infer_from | mapping; evidence_availability; internal_readiness; tests; ledger_chain_status; claim_review; award_status |
| read_requirement | R-EXTERNAL-ARTIFACT plus reviewed exact scope and exposure; no self-issued artifact |

Awards consume R-AWARDS: six edition records and 25 calendar events. Preserve source status, edition, eligibility, readiness, precision/timezone, conflicts and UNKNOWN. No award likelihood/probability/award-ready. Nomination/finalist/winner needs an independently authenticated external artifact; public organizer metadata is not an applicant outcome.

## 10. European Assurance Profile

| Field | Contract |
| --- | --- |
| mode | Projection only, explicitly PRODUCT or TENANT |
| base_reference | EU-AI-ACT-2024-1689-OJ-20240712 |
| reference_ids | EU-OJ-20240712-ART-11; EU-OJ-20240712-ART-12; EU-OJ-20240712-ANNEX-IV |
| axes | source_version_status; applicability; mapping; evidence_availability; evidence_sufficiency; internal_readiness; external_certification_attestation |
| operative_law_state | UNKNOWN |
| applicability_state | UNKNOWN |
| sufficiency_state | NOT_ASSESSED |
| external_certification_attestation | NOT_ASSERTED |
| qualified_review | Qualified legal/current-law source and applicability reviewer must establish operative version, amendments/corrigenda/consolidation/transitional applicability, jurisdiction, role, intended use and scope at the effective/cutoff pair. Source metadata alone cannot supply this conclusion. |
| unknown_rule | If operative source or applicability is unestablished, corresponding axes remain UNKNOWN; preserve bounded OJ reference separately; no inferred legal satisfaction, readiness or certification. |
| aggregate_legal_compliance_state | false |
| prohibited_output | EU AI Act compliant |
| no_legal_research_in_s0 | true |

The seven axes stay independent. Original OJ base-text reference != operative law. A missing lawful source population is SOURCE_PENDING/UNKNOWN, not a satisfied empty framework. No legal conclusion is researched or issued in S0.

## 11. Exposure levels

Truth, record access, affirmative claim use and view exposure are separate dimensions. **No exposure level is granted in S0**, including a new document walkthrough. The audience below is the proposed maximum after all stated prerequisites, not current authorization.

| Level | Permitted audience after approval | Allowed data class | Publication requirement | Independent review |
| --- | --- | --- | --- | --- |
| INTERNAL_REVIEW | Owner and scope-authorized architecture/assurance reviewers | Repository metadata; tenant diagnostics only after verified read contracts | No affirmative publication; claim records INTERNAL_ONLY | Scope-qualified internal review; no exposure permission granted |
| CONTROLLED_DOCUMENT_WALKTHROUGH | Named invited reviewers under separately approved document scope | Approved redacted pinned documents only; no live tenant data or claim affirmation | Exact artifact/wording/audience and limitations approval outside S0 | Independent wording/source/exposure reviewer |
| CONTROLLED_PRODUCT_DEMO | Separately approved controlled demonstration audience | Approved bounded product fixture/read projection only | CONTROLLED_DEMO_READINESS HOLD; complete surface inventory and containment acceptance | Independent demo/exposure and security review |
| EXTERNAL_PUBLICATION | Approved public/external audience | Only expressly approved exact redacted data and eligible wording | EXTERNAL_PUBLICATION_READINESS HOLD; S2 ceiling and exact wording approval mandatory | Independent publication/scope/freshness/exposure review |
| TENANT_ASSURANCE | Verified authorized members of exactly one tenant | Only scope-authorized same-tenant evidence and governed projections | TENANT_ASSURANCE_READINESS HOLD; all typed/atomic/principal reads and applicable reviews required | Independent tenant read-security, population and sufficiency review |
| EXTERNAL_CERTIFICATION_ASSERTION | Approved audience for authenticated exact issuer artifact | Only artifact/subject/scope approved for that audience | CERTIFICATION_READINESS HOLD; verified current artifact plus claim/publication/exposure approval | Independent artifact authenticity/scope/validity and publication review |

## 12. Legacy consumption and exposure dependencies

These dependencies block affected Hub consumption/drill-down and actual surrounding navigation/demo/export exposure. A Hub panel exclusion does not establish runtime containment. All source gates remain historical; no remediation or hosted reachability audit occurred.

| Surface | Affected view IDs | Blocking boundary | Proposed containment |
| --- | --- | --- | --- |
| L01 | A, B, C, E, G, H, K | CompliancePanel and API flag percentages cannot support assurance; contain naming/manual flag exposure. | V1-S1B |
| L02 | A, B, G, H, K | Scanner certification tiers are heuristic; isolate labels/exports from certification and readiness. | V1-S1B |
| L03 | A, C, G, H, K | Extension compliance reports are local heuristics; review wording and incomplete/empty scan semantics. | V1-S1B |
| L04 | A, B, C, G, H, K | graphos-complete plus package compatibility ISO 42001 Readiness / AI Act Technical File / SOC2 Control Pack / Certification Readiness surfaces; no assurance authority, hosted reachability UNKNOWN. | V1-S1C |
| L05 | G, H, K | SAFE only for inspected export rejection guard; no inherited SAFE for any report generator, dashboard or deployment. | V1-S1B |
| LX01 | A, B, C, E, K | Legacy agents/ai_systems are not canonical subjects. No name join or legacy registry bridge. | V1-S1B |
| LX02 | A, J, K | Legacy home percentage cannot become overview state or KPI result. | V1-S1B |
| LX03 | A, B, C, D, E, K | Legacy graph/search/Talk traversal cannot resolve authoritative tenant joins; LLM/graph output stays non-authoritative. | V1-S1B |
| LX04 | A, B, J | Heuristic cost estimates cannot become authoritative evidence, financial measures or assurance KPIs. | V1-S1B |
| LX05 | B, C, J | Extension budget defaults cannot substitute for observed/validated values or evidence. | V1-S1B |
| LX06 | A, C, E, K | ict_incidents remains legacy; no silent canonical incident/evidence bridge. | V1-S1B |
| LX07 | A, B, C, E, K | Legacy oversight l1_automated default cannot establish governance, applicability or sufficiency; ledger payload presence does not upgrade it. | V1-S1B |
| LX08_AUDIT_TRAIL | A, C, E, G, H, K | Unscoped ledger_verify and VALID/BROKEN defaults require separate security review; no audit-chain consumption until exact org scope, principal authorization, explicit empty population/UNKNOWN/missing-row semantics. Payload contents never create assurance truth. | V1-S1A |
| LX09_DORMANT_PDF_GENERATORS | A, G, H, K | Dormant Compliance Rate %, AI Act Exposure and DORA Status generators remain an exposure risk; do not re-enable or inherit L05 SAFE. | V1-S1C |

LX08 Audit Trail is not admissible until organisation scope, principal-bound authorization, UNKNOWN, explicit empty semantics and missing-result handling are established; missing result != BROKEN. Ledger payload content, including historical default oversight, cannot create assurance truth. No audit remediation in S0. L05 SAFE applies only to the inspected rejection guard; it never clears LX09, an entire deployment or the dashboard.

## 13. Hub views A–K

Common read contract: explicit mode and immutable scope, typed exact identities/versions, original authority/trust, principal and same-tenant authorization on every tenant hop, explicit time/source pins, ATOMIC acquisition, closed failure rendering and exposure gating. No percentages or scores.

### A. Assurance Overview

| Property | Contract |
| --- | --- |
| Purpose | Bounded product state and, later, a separately selected tenant manifest |
| Authoritative/projection inputs | R-PRODUCT; R-FRAMEWORK; R-TENANT-SCOPE; R-ATOMIC |
| Filters | mode, scope/version, capability, framework edition, named axis |
| Allowed aggregations | Distinct capability/record counts partitioned within one declared population only |
| UNKNOWN behavior | UNKNOWN per axis; no aggregate compliance state |
| Drill-down | B,C,D,E,F,G,H,I,J,K |
| Audience | Scope-authorized internal reviewers of documentary contract only; no Hub execution granted |
| Allowed data class | Mode-explicit pinned product metadata; tenant data only after principal/scope/atomic contracts |
| Publication / independent review | No exposure granted; all six level-specific requirements apply; exact wording/source/redaction/exposure approval required before external use; independent review required |
| Exposure levels | INTERNAL_REVIEW; CONTROLLED_DOCUMENT_WALKTHROUGH; CONTROLLED_PRODUCT_DEMO; EXTERNAL_PUBLICATION; TENANT_ASSURANCE; EXTERNAL_CERTIFICATION_ASSERTION; none granted |
| Required read contract | Closed read allowlist + typed mode/scope/identity/source pins + same-tenant principal authorization for every tenant hop + ATOMIC as-of + failure contract; rejected existing routes require additive projection first |
| Legacy blockers | L01; L02; L03; L04; LX01; LX02; LX03; LX04; LX06; LX07; LX08_AUDIT_TRAIL; LX09_DORMANT_PDF_GENERATORS |
| Implementation classification | PROJECTION_ONLY_METADATA; ADDITIVE_READ_PROJECTION_REQUIRED; API_REQUIRED; UI_REQUIRED; LEGACY_CONTAINMENT_REQUIRED |

### B. Capabilities

| Property | Contract |
| --- | --- |
| Purpose | Display 38 bounded implementation claims, proof status and evidence availability |
| Authoritative/projection inputs | R-PRODUCT |
| Filters | capability ID, layer, authority class, proof status, immutable commit |
| Allowed aggregations | Counts by closed proof status only |
| UNKNOWN behavior | NOT_PROVEN/UNKNOWN remain distinct; product proof cannot establish tenant assurance |
| Drill-down | C,D,E,F,G |
| Audience | Scope-authorized internal reviewers of documentary contract only; no Hub execution granted |
| Allowed data class | Mode-explicit pinned product metadata; tenant data only after principal/scope/atomic contracts |
| Publication / independent review | No exposure granted; all six level-specific requirements apply; exact wording/source/redaction/exposure approval required before external use; independent review required |
| Exposure levels | INTERNAL_REVIEW; CONTROLLED_DOCUMENT_WALKTHROUGH; CONTROLLED_PRODUCT_DEMO; EXTERNAL_PUBLICATION; TENANT_ASSURANCE; EXTERNAL_CERTIFICATION_ASSERTION; none granted |
| Required read contract | Closed read allowlist + typed mode/scope/identity/source pins + same-tenant principal authorization for every tenant hop + ATOMIC as-of + failure contract; rejected existing routes require additive projection first |
| Legacy blockers | L01; L02; L04; LX01; LX03; LX04; LX05; LX07 |
| Implementation classification | PROJECTION_ONLY_METADATA; API_REQUIRED; UI_REQUIRED; LEGACY_CONTAINMENT_REQUIRED |

### C. Evidence

| Property | Contract |
| --- | --- |
| Purpose | Resolve typed immutable references without copying source payloads or upgrading authority |
| Authoritative/projection inputs | R-PRODUCT; R-EVIDENCE; R-TENANT-LINEAGE; R-EXTERNAL-ARTIFACT; R-ATOMIC |
| Filters | mode, exact typed target/version, source class, access, currency |
| Allowed aggregations | Distinct admissible reference versions within one scope only |
| UNKNOWN behavior | Denied/unavailable reference UNKNOWN; no inaccessible count; availability != sufficiency |
| Drill-down | Exact source/subject/state/decision/policy/support versions |
| Audience | Scope-authorized internal reviewers of documentary contract only; no Hub execution granted |
| Allowed data class | Mode-explicit pinned product metadata; tenant data only after principal/scope/atomic contracts |
| Publication / independent review | No exposure granted; all six level-specific requirements apply; exact wording/source/redaction/exposure approval required before external use; independent review required |
| Exposure levels | INTERNAL_REVIEW; CONTROLLED_DOCUMENT_WALKTHROUGH; CONTROLLED_PRODUCT_DEMO; EXTERNAL_PUBLICATION; TENANT_ASSURANCE; EXTERNAL_CERTIFICATION_ASSERTION; none granted |
| Required read contract | Closed read allowlist + typed mode/scope/identity/source pins + same-tenant principal authorization for every tenant hop + ATOMIC as-of + failure contract; rejected existing routes require additive projection first |
| Legacy blockers | L01; L03; L04; LX01; LX03; LX05; LX06; LX07; LX08_AUDIT_TRAIL |
| Implementation classification | PROJECTION_ONLY_METADATA; ADDITIVE_READ_PROJECTION_REQUIRED; API_REQUIRED; UI_REQUIRED; LEGACY_CONTAINMENT_REQUIRED; SOURCE_OR_LICENSE_REQUIRED |

### D. Frameworks

| Property | Contract |
| --- | --- |
| Purpose | Seven pinned editions and lawful source/population access state |
| Authoritative/projection inputs | R-FRAMEWORK |
| Filters | framework version, publisher, access/license, population status |
| Allowed aggregations | Bibliographic edition counts; bounded public references separately |
| UNKNOWN behavior | Pending licensed/full populations not an empty satisfied set |
| Drill-down | E,C |
| Audience | Scope-authorized internal reviewers of documentary contract only; no Hub execution granted |
| Allowed data class | PINNED_FRAMEWORK_REFERENCE_METADATA |
| Publication / independent review | No exposure granted; all six level-specific requirements apply; exact wording/source/redaction/exposure approval required before external use; independent review required |
| Exposure levels | INTERNAL_REVIEW; CONTROLLED_DOCUMENT_WALKTHROUGH; CONTROLLED_PRODUCT_DEMO; EXTERNAL_PUBLICATION; TENANT_ASSURANCE; EXTERNAL_CERTIFICATION_ASSERTION; none granted |
| Required read contract | Closed read allowlist + typed mode/scope/identity/source pins + same-tenant principal authorization for every tenant hop + ATOMIC as-of + failure contract; rejected existing routes require additive projection first |
| Legacy blockers | LX03 |
| Implementation classification | PROJECTION_ONLY_METADATA; API_REQUIRED; UI_REQUIRED; SOURCE_OR_LICENSE_REQUIRED |

### E. Requirements / References

| Property | Contract |
| --- | --- |
| Purpose | Capability -> evidence -> framework/reference mapping and future exact tenant subject/decision traversal |
| Authoritative/projection inputs | R-FRAMEWORK; R-PRODUCT; R-TENANT-MAPPING; R-TENANT-LINEAGE; R-M16-PASSPORT; R-M16-CONFLICT; R-M17-RISK; R-M17-ASSESSMENT-V2; R-M17-TREATMENT; R-M17-ACCEPTANCE; R-M17-LIFECYCLE; R-M17-OVERLAY; R-TENANT-REGISTRY; R-ATOMIC |
| Filters | exact framework/version/reference, mode/manifest, mapping, separate applicability/availability/sufficiency axes |
| Allowed aggregations | Named state partitions within a declared reference set; no full-framework coverage arithmetic |
| UNKNOWN behavior | MAPPED != satisfied; pending populations UNKNOWN, reviewed NOT_APPLICABLE retained |
| Drill-down | Exact mapping -> evidence -> subject -> governed decision/support with authority/version/as-of |
| Audience | Scope-authorized internal reviewers of documentary contract only; no Hub execution granted |
| Allowed data class | Mode-explicit pinned product metadata; tenant data only after principal/scope/atomic contracts |
| Publication / independent review | No exposure granted; all six level-specific requirements apply; exact wording/source/redaction/exposure approval required before external use; independent review required |
| Exposure levels | INTERNAL_REVIEW; CONTROLLED_DOCUMENT_WALKTHROUGH; CONTROLLED_PRODUCT_DEMO; EXTERNAL_PUBLICATION; TENANT_ASSURANCE; EXTERNAL_CERTIFICATION_ASSERTION; none granted |
| Required read contract | Closed read allowlist + typed mode/scope/identity/source pins + same-tenant principal authorization for every tenant hop + ATOMIC as-of + failure contract; rejected existing routes require additive projection first |
| Legacy blockers | L01; LX01; LX03; LX06; LX07; LX08_AUDIT_TRAIL |
| Implementation classification | PROJECTION_ONLY_METADATA; ADDITIVE_READ_PROJECTION_REQUIRED; API_REQUIRED; UI_REQUIRED; REVIEW_WORKFLOW_REQUIRED; LEGACY_CONTAINMENT_REQUIRED; SOURCE_OR_LICENSE_REQUIRED |

### F. Gaps

| Property | Contract |
| --- | --- |
| Purpose | Keep historical assurance gaps and presentation/exposure gates as separate tabs/populations |
| Authoritative/projection inputs | R-PRODUCT; R-TENANT-GAPS; R-ATOMIC |
| Filters | population ID/version, gap ID/kind, mode/manifest, named state |
| Allowed aggregations | Distinct count per declared compatible population only; never cross-population sum |
| UNKNOWN behavior | Historical 61 OPEN; known exposure membership is not exhaustive; inaccessible tenant gap set UNKNOWN |
| Drill-down | Source gap and controlling claim/exposure gate |
| Audience | Scope-authorized internal reviewers of documentary contract only; no Hub execution granted |
| Allowed data class | Mode-explicit pinned product metadata; tenant data only after principal/scope/atomic contracts |
| Publication / independent review | No exposure granted; all six level-specific requirements apply; exact wording/source/redaction/exposure approval required before external use; independent review required |
| Exposure levels | INTERNAL_REVIEW; CONTROLLED_DOCUMENT_WALKTHROUGH; CONTROLLED_PRODUCT_DEMO; EXTERNAL_PUBLICATION; TENANT_ASSURANCE; EXTERNAL_CERTIFICATION_ASSERTION; none granted |
| Required read contract | Closed read allowlist + typed mode/scope/identity/source pins + same-tenant principal authorization for every tenant hop + ATOMIC as-of + failure contract; rejected existing routes require additive projection first |
| Legacy blockers | No direct source dependency identified; ambient navigation/demo/export inventory still required |
| Implementation classification | PROJECTION_ONLY_METADATA; ADDITIVE_READ_PROJECTION_REQUIRED; API_REQUIRED; UI_REQUIRED; REVIEW_WORKFLOW_REQUIRED |

### G. Claims

| Property | Contract |
| --- | --- |
| Purpose | Show class, eligibility, S2 ceiling, E1 record access/affirmative use, reviewers and invalidation |
| Authoritative/projection inputs | R-PRODUCT; R-REVIEW |
| Filters | claim ID/class, capability, eligibility, access/use, ceiling |
| Allowed aggregations | 42 INELIGIBLE records; separate categorical record counts only |
| UNKNOWN behavior | Missing S2/E1 fails closed to no affirmation; no S1 ceiling fallback |
| Drill-down | Exact wording -> S2 ceiling -> evidence/mapping -> gaps -> reviewer/exposure |
| Audience | Scope-authorized internal reviewers of documentary contract only; no Hub execution granted |
| Allowed data class | Mode-explicit pinned product metadata; tenant data only after principal/scope/atomic contracts |
| Publication / independent review | No exposure granted; all six level-specific requirements apply; exact wording/source/redaction/exposure approval required before external use; independent review required |
| Exposure levels | INTERNAL_REVIEW; CONTROLLED_DOCUMENT_WALKTHROUGH; CONTROLLED_PRODUCT_DEMO; EXTERNAL_PUBLICATION; TENANT_ASSURANCE; EXTERNAL_CERTIFICATION_ASSERTION; none granted |
| Required read contract | Closed read allowlist + typed mode/scope/identity/source pins + same-tenant principal authorization for every tenant hop + ATOMIC as-of + failure contract; rejected existing routes require additive projection first |
| Legacy blockers | L01; L02; L03; L04; L05; LX08_AUDIT_TRAIL; LX09_DORMANT_PDF_GENERATORS |
| Implementation classification | PROJECTION_ONLY_METADATA; API_REQUIRED; UI_REQUIRED; REVIEW_WORKFLOW_REQUIRED; LEGACY_CONTAINMENT_REQUIRED |

### H. Certification & Attestation

| Property | Contract |
| --- | --- |
| Purpose | Display NOT_ASSERTED and later independently authenticated artifacts |
| Authoritative/projection inputs | R-PRODUCT; R-EXTERNAL-ARTIFACT; R-REVIEW |
| Filters | artifact kind/issuer, exact subject/framework/scope/version and validity |
| Allowed aggregations | Distinct artifact identities by kind/state only when population known |
| UNKNOWN behavior | NOT_ASSERTED now; unverified UNKNOWN, expired/revoked never current positive |
| Drill-down | Issuer-authenticated artifact and exact validity/revocation basis |
| Audience | Scope-authorized internal reviewers of documentary contract only; no Hub execution granted |
| Allowed data class | Mode-explicit pinned product metadata; tenant data only after principal/scope/atomic contracts |
| Publication / independent review | No exposure granted; all six level-specific requirements apply; exact wording/source/redaction/exposure approval required before external use; independent review required |
| Exposure levels | INTERNAL_REVIEW; CONTROLLED_DOCUMENT_WALKTHROUGH; CONTROLLED_PRODUCT_DEMO; EXTERNAL_PUBLICATION; TENANT_ASSURANCE; EXTERNAL_CERTIFICATION_ASSERTION; none granted |
| Required read contract | Closed read allowlist + typed mode/scope/identity/source pins + same-tenant principal authorization for every tenant hop + ATOMIC as-of + failure contract; rejected existing routes require additive projection first |
| Legacy blockers | L01; L02; L03; L04; L05; LX08_AUDIT_TRAIL; LX09_DORMANT_PDF_GENERATORS |
| Implementation classification | PROJECTION_ONLY_METADATA; ADDITIVE_READ_PROJECTION_REQUIRED; API_REQUIRED; UI_REQUIRED; REVIEW_WORKFLOW_REQUIRED; EXTERNAL_ARTIFACT_REQUIRED; LEGACY_CONTAINMENT_REQUIRED |

### I. Awards

| Property | Contract |
| --- | --- |
| Purpose | Display six edition records and 25 source-pinned events with conflicts |
| Authoritative/projection inputs | R-AWARDS; R-EXTERNAL-ARTIFACT; R-REVIEW |
| Filters | organizer/edition, source status, eligibility/readiness, calendar precision/timezone/conflict |
| Allowed aggregations | Edition/event counts within one source-pinned population only |
| UNKNOWN behavior | Eligibility UNKNOWN, source pending/conflicts explicit; no likelihood/probability/award-ready |
| Drill-down | Organizer edition/source/event; outcome requires external artifact |
| Audience | Scope-authorized internal reviewers of documentary contract only; no Hub execution granted |
| Allowed data class | PINNED_PRODUCT_AWARD_METADATA |
| Publication / independent review | No exposure granted; all six level-specific requirements apply; exact wording/source/redaction/exposure approval required before external use; independent review required |
| Exposure levels | INTERNAL_REVIEW; CONTROLLED_DOCUMENT_WALKTHROUGH; CONTROLLED_PRODUCT_DEMO; EXTERNAL_PUBLICATION; TENANT_ASSURANCE; EXTERNAL_CERTIFICATION_ASSERTION; none granted |
| Required read contract | Closed read allowlist + typed mode/scope/identity/source pins + same-tenant principal authorization for every tenant hop + ATOMIC as-of + failure contract; rejected existing routes require additive projection first |
| Legacy blockers | No direct source dependency identified; ambient navigation/demo/export inventory still required |
| Implementation classification | PROJECTION_ONLY_METADATA; API_REQUIRED; UI_REQUIRED; REVIEW_WORKFLOW_REQUIRED; EXTERNAL_ARTIFACT_REQUIRED; SOURCE_OR_LICENSE_REQUIRED |

### J. KPI Definitions

| Property | Contract |
| --- | --- |
| Purpose | Catalogue 11 definitions; never turn definitions into results |
| Authoritative/projection inputs | R-PRODUCT; R-TENANT-KPI; R-ATOMIC |
| Filters | definition/version, PRODUCT/TENANT, COUNT/PARTITIONED_COUNT, execution status |
| Allowed aggregations | Definition catalogue counts only now; future count results obey D-V1-08 |
| UNKNOWN behavior | DEFINITION_ONLY/offline documentary predicates do not imply executed tenant results |
| Drill-down | Definition predicate/source/population/permission/audit preconditions |
| Audience | Scope-authorized internal reviewers of documentary contract only; no Hub execution granted |
| Allowed data class | Mode-explicit pinned product metadata; tenant data only after principal/scope/atomic contracts |
| Publication / independent review | No exposure granted; all six level-specific requirements apply; exact wording/source/redaction/exposure approval required before external use; independent review required |
| Exposure levels | INTERNAL_REVIEW; CONTROLLED_DOCUMENT_WALKTHROUGH; CONTROLLED_PRODUCT_DEMO; EXTERNAL_PUBLICATION; TENANT_ASSURANCE; EXTERNAL_CERTIFICATION_ASSERTION; none granted |
| Required read contract | Closed read allowlist + typed mode/scope/identity/source pins + same-tenant principal authorization for every tenant hop + ATOMIC as-of + failure contract; rejected existing routes require additive projection first |
| Legacy blockers | LX02; LX04; LX05 |
| Implementation classification | PROJECTION_ONLY_METADATA; ADDITIVE_READ_PROJECTION_REQUIRED; API_REQUIRED; UI_REQUIRED; REVIEW_WORKFLOW_REQUIRED; LEGACY_CONTAINMENT_REQUIRED |

### K. European Assurance Profile

| Property | Contract |
| --- | --- |
| Purpose | Project bounded OJ references and seven independent axes, never legal truth |
| Authoritative/projection inputs | R-FRAMEWORK; R-PRODUCT; R-TENANT-MAPPING; R-TENANT-LINEAGE; R-REVIEW; R-EXTERNAL-ARTIFACT; R-ATOMIC |
| Filters | mode/manifest, exact original edition, operative-review status and each named axis |
| Allowed aggregations | Bounded reference counts only; no legal-compliance/coverage aggregate |
| UNKNOWN behavior | Operative source/applicability UNKNOWN; sufficiency NOT_ASSESSED; external NOT_ASSERTED |
| Drill-down | Original OJ source and qualified review basis separately; exact evidence/subject lineage |
| Audience | Scope-authorized internal reviewers of documentary contract only; no Hub execution granted |
| Allowed data class | Mode-explicit pinned product metadata; tenant data only after principal/scope/atomic contracts |
| Publication / independent review | No exposure granted; all six level-specific requirements apply; exact wording/source/redaction/exposure approval required before external use; independent review required |
| Exposure levels | INTERNAL_REVIEW; CONTROLLED_DOCUMENT_WALKTHROUGH; CONTROLLED_PRODUCT_DEMO; EXTERNAL_PUBLICATION; TENANT_ASSURANCE; EXTERNAL_CERTIFICATION_ASSERTION; none granted |
| Required read contract | Closed read allowlist + typed mode/scope/identity/source pins + same-tenant principal authorization for every tenant hop + ATOMIC as-of + failure contract; rejected existing routes require additive projection first |
| Legacy blockers | L01; L02; L03; L04; L05; LX01; LX02; LX03; LX06; LX07; LX08_AUDIT_TRAIL; LX09_DORMANT_PDF_GENERATORS |
| Implementation classification | PROJECTION_ONLY_METADATA; ADDITIVE_READ_PROJECTION_REQUIRED; API_REQUIRED; UI_REQUIRED; REVIEW_WORKFLOW_REQUIRED; EXTERNAL_ARTIFACT_REQUIRED; LEGACY_CONTAINMENT_REQUIRED; SOURCE_OR_LICENSE_REQUIRED |

## 14. Implementation classification and proposed slices

Classification vocabulary:

- PROJECTION_ONLY_METADATA
- ADDITIVE_READ_PROJECTION_REQUIRED
- API_REQUIRED
- UI_REQUIRED
- REVIEW_WORKFLOW_REQUIRED
- EXTERNAL_ARTIFACT_REQUIRED
- LEGACY_CONTAINMENT_REQUIRED
- SOURCE_OR_LICENSE_REQUIRED

Each view above has all applicable classes. Additional cross-view capabilities:

| Capability | Read IDs | Classification | Boundary |
| --- | --- | --- | --- |
| AUDIT_CHAIN_INPUT | R-AUDIT | ADDITIVE_READ_PROJECTION_REQUIRED; REVIEW_WORKFLOW_REQUIRED; LEGACY_CONTAINMENT_REQUIRED | Optional supporting input only after LX08 security/empty/missing/org/principal semantics; never proof of payload truth. |
| POPULATION_AUDIT_DRILLDOWN | R-TENANT-SCOPE; R-TENANT-KPI; R-ATOMIC | ADDITIVE_READ_PROJECTION_REQUIRED; API_REQUIRED; UI_REQUIRED; REVIEW_WORKFLOW_REQUIRED | Exact set conservation, separate authorized identities; no generic denominator endpoint. |
| ATOMIC_AUTHORIZED_COMPOSITION | R-SESSION; R-ATOMIC; R-TENANT-LINEAGE | ADDITIVE_READ_PROJECTION_REQUIRED | Reuse existing authorization rules, no new permission/authority; snapshot attestation mandatory. |
| EXPOSURE_REVIEW | R-REVIEW; R-LEGACY | PROJECTION_ONLY_METADATA; ADDITIVE_READ_PROJECTION_REQUIRED; API_REQUIRED; UI_REQUIRED; REVIEW_WORKFLOW_REQUIRED; LEGACY_CONTAINMENT_REQUIRED | Exact surface/wording/version/audience review; S0 grants no exposure. |
| FUTURE_CONSUMER_INTERFACE_REQUIREMENTS | R-PRODUCT; R-TENANT-MAPPING | PROJECTION_ONLY_METADATA; ADDITIVE_READ_PROJECTION_REQUIRED; API_REQUIRED | Consumer-neutral only; M18 remains noncanonical/unimplemented. |
| OPTIONAL_LLM_EXPLANATION | R-PRODUCT; R-TENANT-MAPPING | ADDITIVE_READ_PROJECTION_REQUIRED; API_REQUIRED; UI_REQUIRED; REVIEW_WORKFLOW_REQUIRED; LEGACY_CONTAINMENT_REQUIRED | Future separately authorized explanation consumes deterministic projection and cites exact authorized refs; no vector/graph/LLM-created authority. |

PROJECTION_ONLY_METADATA means existing bounded documentary content can be projected; it does not imply an API/UI exists. An additive tenant projection is mandatory where marked. Source/license, qualified review, external artifact and actual exposure containment are independent gates.

| Proposed slice | Dependencies | Scope | Gate |
| --- | --- | --- | --- |
| V1-S1A — LX08 audit security containment prerequisite | S0 documentary closure | Separate owner-authorized org/principal-bound read security and explicit EMPTY/UNKNOWN/missing-result semantics review; prevent legacy payload assurance truth. | R-AUDIT; no audit fixes in S0 |
| V1-S1B — Live legacy assurance exposure containment | V1-S1A | L01-L03, LX01-LX07: contain percentages/tiers/defaults, prevent legacy bridges, inventory navigation and extension paths; scoped independent acceptance. | All affected live demo paths |
| V1-S1C — Package, dormant export and compatibility containment | V1-S1B | L04 graphos-complete + package compatibility, LX09 dormant generators; preserve narrow L05 guard; verify real exposure without asserting hosted reachability. | No deployment authorized |
| V1-S2 — Shared projection/read metadata contracts | V1-S1C | Typed identities/mode/scope/errors, immutable version vector, D-V1-08 serialization/operator/renderer contract and no-denominator audit proof. | No new governance authority or permission |
| V1-S3 — Tenant principal-bound additive reads | V1-S2 | Bind exact subject inventory, evidence/lineage/registry links and missing M16/M17 wrappers through existing authorization; preserve explicit times and prove cross-source snapshot/completeness. | No app-filter fallback or internal resolver grant expansion |
| V1-S4 — Product Hub projections | V1-S2 | Project immutable V0/E1 metadata with claim precedence and separate gap populations; no tenant evidence, claims or runtime exposure approval. | Can be built independently of S3 after common contracts |
| V1-S5 — Tenant assurance projections | V1-S3, V1-S4 | Execute only under separate authorization after complete scoped lawful sources, applicability/sufficiency reviews, exact pins and atomic reads; add missing metadata-only projection links. | Incomplete sources/read contracts keep tenant HOLD |
| V1-S6 — European Assurance Profile | V1-S4, V1-S5 | Qualified source/current-law/applicability review and independent axes; product reference panel may precede tenant execution. | No legal-compliance aggregate or certification inference |
| V1-S7 — Hub API/UI | V1-S1C, V1-S4, V1-S5, V1-S6 | Server/client/export allowlists, authorized drill-down and accessible fail-closed views, exposure gates on actual navigation and presentation. | Internal candidate only; demo/publication remain separately gated |
| V1-S8 — Adversarial closure | V1-S7 | Cross-tenant/forged-principal/paging/as-of/empty/unknown/denominator/claim precedence/legacy exposure and artifact invalidation adversarial acceptance. | Independent review once; closure does not automatically release HOLDs |

Every slice is PROPOSED_NOT_STARTED and requires separate owner authorization. S4 product projection can follow S2 independently of S3 tenant reads. Exact proposed next slice: **V1-S1A — LX08 audit security containment**. Do not start it in S0.

## 15. Future consumer interface and deterministic acceptance

FUTURE_CONSUMER_INTERFACE_REQUIREMENTS:

- projection identity/version
- authority/source class
- mode PRODUCT_ASSURANCE or TENANT_ASSURANCE
- exact typed subject/scope/organisation binding
- exact known state or UNKNOWN with reasons
- effective_at and recorded_cutoff
- generated_at separately
- source/dependency validity pins
- limitations and acquisition/snapshot status
- authorized drill-down refs
- exposure state
- controlling ceiling/access/affirmative-use state where relevant

M18 is not canonical here, not started and has no specific API. Governed truth stays upstream; graph traversal is ANALYTICAL; vector similarity is non-authoritative. An LLM may only explain/cite deterministic authorized projections and may not create authority or prohibited arithmetic.

| Gate | Title | Deterministic acceptance predicate |
| --- | --- | --- |
| W-V1-01 | No canonical authority | Frozen 11/12/16 catalogs, M16/M17 families, shared Authority Policy, trust vocabulary and decisions unchanged; new kinds/edges/families/facts/permissions = 0. |
| W-V1-02 | Mode isolation | PRODUCT organisation=null; TENANT exactly one verified org+manifest; reject mixed cache/request/result/drill-down/export and tenant changes to product claims. |
| W-V1-03 | Complete read inventory | Each admitted hop has one read ID, pinned code or explicit absent-surface basis, data class, org/subject binding, DB principal/authorization, definer/table/transport, both time coordinates, failure and additive decision. Reject unlisted hops. |
| W-V1-04 | No app-filter-only tenant route | R-IDENTITY/R-RELATIONSHIP/R-PROFILE/R-RECONCILIATION/R-EVIDENCE/R-TECHNICAL/R-LOOKUP/R-EXECUTION and mixed Passport cannot establish tenant assurance until additive DB-authorized reads replace these hops. |
| W-V1-05 | Transport is not authority | Forged/revoked/expired principal denied even with service_role; owner-only resolvers never exposed or granted as generic tenant read authority. |
| W-V1-06 | Exact same-tenant traversal | Every mapping/evidence/subject/relationship-state/decision/support hop checks exact typed ID and organisation; no name joins, implicit parent inheritance or legacy bridge. |
| W-V1-07 | Atomic as-of | Both explicit time coordinates and immutable source vector required; separate successful RPCs at same timestamps without consistent snapshot proof produce NON_ATOMIC/UNKNOWN. |
| W-V1-08 | UNKNOWN and failure | Denied access cannot reveal existence/count or become absence; source/page failure yields UNKNOWN, not zero; invalid state fails closed; complete empty population cannot become green. |
| W-V1-09 | No percentage/ratio/score | API/client/export/LLM contracts contain no arithmetic division/ratio/percentage/score renderer or denominator scalar; reject hidden denominator aliases and cross-axis/KPI totals. |
| W-V1-10 | V1-A1 architecture resolution | D-V1-08 chooses B + audit identity separation, documents A/C rejection reasons, set-conservation/UNKNOWN and enforcement; historical KPI framework unchanged; no execution. |
| W-V1-11 | V1-A2 architecture resolution | All read categories classified; principal-bound SQL and null-default/mixed app wrappers distinguished; missing additive projections explicit; no app filtering equivalence. |
| W-V1-12 | Claim ceilings | All 38 S2 ceilings preserved; 42 claims remain INELIGIBLE/INTERNAL_ONLY/PROHIBITED; S1 candidate never controls; missing/inconsistent S2 fails closed. |
| W-V1-13 | Separate populations | 61 OPEN S2 assurance gaps separate from 14 known open-universe E1 exposure members; L04 scope expansion not a member; no 61 total gaps label or incompatible sum. |
| W-V1-14 | External artifact | NOT_ASSERTED until independently authenticated scope-matched artifact with issuer/subject/framework/version/validity/identity/verification/revocation basis; expiry/revocation invalidate positive present use. |
| W-V1-15 | European profile | Original OJ edition != operative law; qualified review missing => UNKNOWN applicability/operative axis; no generic EU AI Act compliant or aggregate legal state. |
| W-V1-16 | Exposure and legacy | All L01-L05/LX01-LX09 inputs map to blocked view paths; LX08 scoped principal-bound/empty/missing/UNKNOWN/payload conditions explicit; L05 SAFE narrow. No exposure granted; all HOLDs preserved. |
| W-V1-17 | Neutral future consumer | M18 remains HOLD, noncanonical/unimplemented; no M18 API or Normative Intelligence; consumer contract exposes authority/scope/known/UNKNOWN/as-of/limitations/drill-down/exposure. |
| W-V1-18 | LLM/graph/vector | LLM explanation cites deterministic projection only; cannot create mapping/applicability/sufficiency/claim/certification/publication authority; graph ANALYTICAL, vector non-authoritative. |
| W-V1-19 | Definitions and awards | 11 KPI definitions stay definitions (COUNT/PARTITIONED_COUNT); award source/edition/calendar conflicts and UNKNOWN stay explicit; no probability/award-ready/outcome without external artifact. |
| W-V1-20 | Documentary delta | Required starting branch/HEAD exact; all parent V0/E1 bytes unchanged; every referenced source/member ID resolves; no runtime/DB/migration/API/UI delta; git diff --check; commit/push only after S0 gates PASS, no PR or next-slice implementation. |

These are design/documentary predicates. Future runtime acceptance must test forged/revoked principals, cross-tenant IDs, partial pages, conflicting keys, mutable-head/cutoff races, denial/empty/UNKNOWN semantics, malicious denominator/renderer requests, S1 ceiling fallback, artifact expiry/revocation and legacy presentation reachability. S0 executes none of those runtime flows.

## 16. Source inventory, delta and retained status

All 45 input pins preserve original nested source versions. The selection below locates exact current V0/E1 artifacts, not a new implementation proof date. Full Git blobs and normalized byte hashes are in JSON.

| Historical artifact | Selection commit |
| --- | --- |
| docs/architecture/ADR-GOVIA-TRUST-ASSURANCE-v1.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/architecture/GOVIA-L0L16-CIA-v1.0-roadmap.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/codex/evidence/2026-10-20-m17.5-s0-trust-assurance-inventory.json | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/codex/evidence/2026-10-20-m17.5-s0-trust-assurance-inventory.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/codex/evidence/2026-10-20-m17.5-s1-source-crosswalk.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/codex/evidence/2026-10-20-m17.5-s2-gaps-claims.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/codex/evidence/2026-10-20-m17.5-s3-award-readiness.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/codex/evidence/2026-10-20-m17.5-s4-kpi-framework.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/award-calendar-v0.json | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/award-calendar-v0.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/award-readiness-matrix-v0.json | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/award-readiness-matrix-v0.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/award-render-v0.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/closure-render-v0.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/commercial-claims-register-v0.json | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/commercial-claims-register-v0.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/errata-render-v1.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/evidence-index-v0.json | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/evidence-index-v0.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/external-credibility-matrix-v0.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/framework-crosswalk-v0.json | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/framework-crosswalk-v0.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/framework-source-catalog-v0.json | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/gap-register-v0.json | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/gap-register-v0.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/kpi-framework-v0.json | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/kpi-framework-v0.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/kpi-render-v0.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/legacy-containment-register-v0.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/v0-closure-errata-v1.json | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/v0-closure-errata-v1.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/v0-closure-review.json | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/v0-closure-review.md | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/verify-e1-final.test.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/verify-e1.test.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/verify-s2-final.test.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/verify-s2.test.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/verify-s3-final.test.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/verify-s3.test.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/verify-s4-final.test.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/verify-s4.test.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/verify-s5-final.test.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/verify-s5.test.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| docs/trust-assurance/verify-v0.test.mjs | a85f97225777e1dd1fd67109a349c3be6e45d0ad |
| packages/canonical-contracts/src/contracts.ts | a85f97225777e1dd1fd67109a349c3be6e45d0ad |

| Delta | Count |
| --- | --- |
| runtime | 0 |
| database | 0 |
| migrations | 0 |
| API | 0 |
| UI | 0 |
| hosted_mutations | 0 |
| deployments | 0 |
| PRs | 0 |
| tenant_assurance_executions | 0 |
| KPI_executions | 0 |
| publications | 0 |
| M18_implementation | 0 |
| Normative_Intelligence | 0 |

| State | Disposition |
| --- | --- |
| V0_READINESS_PACK | CLOSED / PASS |
| V0_E1 | CLOSED / PASS |
| V1_S0 | CLOSED / PASS |
| M17_5_OVERALL | OPEN |
| CONTROLLED_DEMO_READINESS | HOLD |
| EXTERNAL_PUBLICATION_READINESS | HOLD |
| TENANT_ASSURANCE_READINESS | HOLD |
| CERTIFICATION_READINESS | HOLD |
| M18 | HOLD |

M17.5 V0 READINESS PACK: **CLOSED / PASS**; M17.5-V0-E1: **CLOSED / PASS**; M17.5-V1-S0: **CLOSED / PASS** for documentary architecture only. M17.5 overall remains OPEN. All four readiness HOLDs and M18 HOLD remain. No PR, deployment, publication or next-slice implementation.
