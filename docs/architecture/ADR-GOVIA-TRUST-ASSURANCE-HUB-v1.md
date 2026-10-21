# ADR — Trust & Assurance Hub V1: read contract and exposure boundary

Date: 2026-10-20, America/Sao_Paulo. Slice: **M17.5-V1-S0**.
Status: **architecture contract frozen for subsequent separately authorized slices**.
This closes documentary S0 only; no Hub implementation or exposure is approved.
Repository: `cnegrao/code-guard-governance`.
Branch: `feat/m17.5-trust-assurance-v0`.
Required and verified starting HEAD: `a85f97225777e1dd1fd67109a349c3be6e45d0ad`.

The [parent Trust & Assurance ADR](ADR-GOVIA-TRUST-ASSURANCE-v1.md) remains
unchanged. The [read contract](../trust-assurance/v1-hub-read-contract.md) and its
[machine-readable companion](../trust-assurance/v1-hub-read-contract.json)
specify the closed read inventory, view model, source pins and W-V1 gates.
They form one additive design contract with this ADR. An inconsistency between
them fails closed and requires a documentary correction; clients must not choose
the more permissive interpretation. This ADR creates no new upstream authority.

## 1. Context and immutable evidence

V0 and V0-E1 are CLOSED / PASS as documentary packs. V0 describes product
implementation evidence, not customer operating effectiveness. E1 preserves
all historical records while correcting interpretation, introducing a separate
exposure population and recording unresolved mandatory inputs V1-A1/V1-A2.
This ADR resolves those two inputs **at architecture level only**. It neither
edits their historical UNRESOLVED records nor claims operational remediation.

The contract pins 45 historical inputs by selection commit, Git blob and
SHA-256 of LF-normalized UTF-8 bytes. Original nested source versions remain
unchanged: selecting the current V0/E1 artifacts at the starting HEAD does not
repin their implementation proof to a newer commit. Inputs include the parent
ADR, S0 capability inventory, S1 catalog/crosswalk/evidence/credibility/legacy
records, S2 gaps/claims/38 ceilings, S3 awards/calendar, S4 KPI definitions,
S5 closure and E1 errata. No standards, legal source or award source was
researched anew; the bounded source conclusions are those of the pinned pack.

The frozen 11 CanonicalObjectKinds, 12 GovernedRelationshipTypes and 16 Passport
families remain unchanged, as do M16/M17 authoritative fact families, L14/L15
authority rules, trust vocabulary, immutable historical decisions, tenant
isolation and the shared Authority Policy. No kind, edge, family, authoritative
fact or permission is added. A future need for any such change requires a
separately approved ADR; it cannot be smuggled into Hub metadata.

## 2. Decisions

| Decision | Frozen design |
|---|---|
| D-V1-01 — source of truth | Canonical governance truth → evidence → capability → framework/reference → assurance projection → gap/claim/certification state → controlled presentation. The Hub is a read/projection layer, with disposable derived metadata. No parallel governance store, compliance engine, score, certification authority or legacy dashboard wrapper. |
| D-V1-02 — modes | Every request, projection, cache, export and drill-down declares PRODUCT_ASSURANCE or TENANT_ASSURANCE. PRODUCT has no tenant. TENANT has one verified-principal organisation and manifest. Product evidence cannot prove tenant assurance; tenant evidence cannot modify product claims. No silent combination. |
| D-V1-03 — scope | Use an immutable SCOPE_V1-derived tenant manifest as execution/projection metadata. Fix subject/reference membership before evaluation, retaining reviewed NOT_APPLICABLE members. Unknown membership blocks completeness. |
| D-V1-04 — security classes | Classify every source, adapter and dependency. DB principal authorization, tenant scope, exact subject, cutoff support and completeness are independent obligations. Repository/public metadata has separate non-tenant classes. Reject unlisted reads. |
| D-V1-05 — privileged transport | service_role is technical transport, never governance authorization. Reuse existing verified-principal DB boundaries. App-only org filters and org-filtered SQL without principal authorization are insufficient. Internal owner-only resolvers stay internal. |
| D-V1-06 — time | Require explicit effective_at, recorded_cutoff and source vector, plus proven same-snapshot acquisition for mutable dependencies. Matching timestamps across independent RPCs do not establish atomicity. Otherwise NON_ATOMIC/UNKNOWN, never a combined tenant result. |
| D-V1-07 — unknown/failure | Preserve distinct authorization, acquisition, dependency, assessment and axis states. Denial is not absence; missing chain result is not BROKEN; empty is not compliant; UNKNOWN is not zero or green. |
| D-V1-08 — denominator | Choose typed non-composable COUNT/PARTITIONED_COUNT projections, with separately authorized audit identity proof. No generic denominator field, ratio operator, percentage or score renderer. Never forward the historical KPI result envelope. |
| D-V1-09 — claims | S2_COMMERCIAL_CLAIMS_REGISTER controls capability_ceilings.current_claim_ceiling. E1 separates access and affirmative use. S1 EVIDENCE_BACKED_ALIGNMENT_CANDIDATE stays mapping metadata. All 42 claims remain INELIGIBLE / INTERNAL_ONLY / PROHIBITED. |
| D-V1-10 — populations | Preserve 61 OPEN historical S2 ASSURANCE_GAPS separately from the 14 known E1 PRESENTATION_EXPOSURE_GATES, an open universe. L04 package compatibility is a scope expansion, not an extra member. No incompatible sum or “61 total gaps” label. |
| D-V1-11 — external artifacts | Certification/attestation remains NOT_ASSERTED. Positive state requires an independently issued, authenticated exact artifact and current issuer/subject/framework/version/scope/validity/verification/revocation basis. No artifact exists in the pack. |
| D-V1-12 — Europe | European Assurance Profile is a projection with independent source/version, applicability, mapping, evidence availability, sufficiency, internal readiness and external artifact axes. Original OJ base text is not operative-law truth. Qualified review required; no generic legal-compliance state. |
| D-V1-13 — explanations | Graph is ANALYTICAL; vector similarity is non-authoritative. An LLM may explain and cite deterministic authorized Hub projections. It cannot create mappings, applicability, sufficiency, eligibility, certification or publication approval. |
| D-V1-14 — containment | All E1 legacy inputs remain dependencies of affected consumption, navigation, demonstrations and exports. Design exclusion is not implemented containment. LX08 requires a separate security review. L05 SAFE is narrow. |
| D-V1-15 — future consumer | Freeze consumer-neutral authority/scope/known/UNKNOWN/as-of/limitations/drill-down/exposure requirements. “M18 Pillar 8” is forward-looking planning terminology. M18 remains noncanonical here, unimplemented and HOLD. No M18 API or Normative Intelligence. |

## 3. V1-A1: count conservation without a Hub denominator

The S4 result envelope contains `known_population`. Putting that numeric scalar
beside a requirements-with-evidence count supplies a ready-made assurance
denominator. Labels alone cannot resolve the hazard. S4 remains immutable;
future V1 must use a different projection contract.

Option A (population only in drill-down/audit metadata) reduces accidental
reuse but does not itself constrain client operators. Option C (state partitions
including UNKNOWN) preserves categorical unknowns but their generic sum can
still be reused as a denominator. **Choose B**, a closed typed count envelope,
with the separately authorized identity audit boundary from A. These are
metadata/API/presentation constraints to implement later, not a change to the
historical KPI definition or a claim that an evaluator exists.

Generic Hub output may carry a definition/version, mode, manifest reference,
measure semantics, KNOWN/UNKNOWN evaluation state, display count or closed named
partitions, opaque population-audit reference, source/time pins, limitations
and reasons. It must not carry `known_population`, `denominator`, renamed
total-population scalars, coverage, ratio, percentage, maturity or score fields.
The approved operations are integer display, closed partition display, declared
dimension filters and authorized drill-down. Division, percentage, weighting,
normalization, assurance ranking, cross-axis/KPI totals and summing partitions
as a denominator are rejected in API serialization, UI configuration, exports
and explanation-tool schemas. No percentage renderer exists in the contract.

Audit drill-down openly declares the population selection rule/version, exact
authorized evaluated member identities, partition membership, exclusions,
unknown conditions, deduplication keys, dependency pins and reproducible set
digests. Conservation proves the selected set equals the **disjoint union** of
all declared partitions, including known UNKNOWN-state members. This is a set
proof, not a denominator scalar. Unknown/unacquired membership makes the whole
result UNKNOWN with null measures. No inaccessible identities/counts are
disclosed. A known UNKNOWN category is countable only in a completely acquired
evaluated population. Zero requires all S4 ZERO_V1 preconditions.

There is no hidden denominator or generic population arithmetic endpoint.
Separately authorized auditors use existing permissions; no new permission is
created. Authorized people can count accessible records outside the Hub; S0
does not promise to prevent arbitrary off-system arithmetic. The enforceable
boundary is that conforming Hub clients cannot request, compose or present
prohibited assurance arithmetic. V1-A1 is RESOLVED_ARCHITECTURALLY_ONLY;
implementation and adversarial checks remain future work. KPI_DEFINITION
remains distinct from KPI_EXECUTION, PRODUCT from TENANT. Only COUNT and
PARTITIONED_COUNT are eligible for current V0 definitions.

## 4. V1-A2: read authorization and missing projections

The companion inventory classifies 40 read categories. It explicitly lists all
tables read through Passport and execution allowlists, principal-bound M16/M17
RPCs, their adapters, owner-only helpers, runtime/cross-signal reads, legacy
audit transport, product/external metadata and missing tenant projections.
Every row records source/projection, data class, tenant and exact/organisation
scope, principal binding, authorization location, SECURITY DEFINER/direct-table/
service_role facets, both time supports, atomic support, failure, V1 usability
and additive projection requirement, with immutable source anchors.

`PRINCIPAL_BOUND_AUTHORIZED` and `PRINCIPAL_BOUND_PROJECTION` describe DB
authorization. `PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ` is a transport facet, not
an alternative authority route. `PRIVILEGED_APP_FILTERED`, `UNSAFE_FOR_V1` and
`NO_READ_SURFACE` cannot establish tenant assurance. `PINNED_PRODUCT_METADATA`
and `PINNED_EXTERNAL_REFERENCE` admit only their bounded non-tenant metadata.
These names classify reads; they do not expand the frozen trust vocabulary.

The M16 Passport/conflict and M17 governed-risk, assessment, treatment,
acceptance, lifecycle and overlay SQL reads have verified-principal DB
boundaries and explicit time parameters. They are **conditional components**,
not complete Hub reads. The existing Passport adapters pass null/null; its
overlay adapter also drops returned cutoff coordinates. The composite combines
those reads with app-filtered canonical identity, relationships, evidence,
technical and execution fields. Verified ingress does not authorize every
child hop. Existing M17 adapters that forward time pins still need the Hub's
closed returned-shape, scope and snapshot checks.

Policy descriptors, signals and hypothesis dispositions lack explicit shared
as-of parameters. The signal/disposition reads cap at 1000; success is not proof
of full population acquisition. Hypothesis confidence remains non-authoritative
and is not an assurance score. `read_runtime_observation_exact` is an exact
org/connection/observation SQL lookup but has no verified-principal session
authorization. Cross-signal comparison/support reads also depend on privileged
application filters. They are ineligible as-is. Scope manifests, normalized
tenant requirement/evidence/subject links, complete evidence/decision/registry
lineage, gap/review projections, operational count/audit projections, external
artifact verification and atomic cross-source composition need additive work.

No new DB grant, Authority Policy permission or generic internal resolver API
is approved. Owner-only helpers may be composed only behind an authorized
boundary in a separately authorized additive implementation slice. V1-A2 is
RESOLVED_ARCHITECTURALLY_ONLY; hosted/deployed behavior was not inspected.

## 5. Typed traversal, scope and time

Product traversal uses exact capability/evidence/framework/reference/mapping
IDs and versions. Tenant traversal additionally pins manifest membership,
organisation, exact canonical subject or relationship-state identity, governed
state/decision, support targets, original trust/authority and policy/version.
Relationship subjects include relationship ID, state ID, frozen type and typed
exact endpoints. Evidence uses the parent ADR section 4 locator union only.
Metadata tags add no canonical kinds or support tags. Preserve M16/M17 support
owner/target and acyclicity rules. Reject guessed joins, name matching, missing
or conflicting typed identity and legacy registry bridges. MAPPED is never
satisfied; evidence availability is never sufficiency.

The manifest requires organisation, intended use/audience, exact framework
versions, explicit-reference-set versus full-framework population, exact subject
set or immutable enumerable rule, allowed source connections, evidence source
versions, both time coordinates, access context, acquisition completeness,
excluded sources, limitations and UNKNOWN conditions. Full framework requires
an authoritative enumerable complete source; a bounded public set never becomes
FULL_FRAMEWORK. Completeness is for this manifest, never the whole estate.

Mutable dependencies require one proven consistent snapshot and explicit
effective/cutoff pair. Immutable external inputs form an exact version vector.
Do not round PostgreSQL timestamps through JavaScript Date or reconstruct exact
credential epoch claims. `generated_at` is separate. Historical as-of is not a
bypass for current access revocation. Revalidate the session before release.
Non-atomic source diagnostics may be labelled internally; they cannot yield
combined tenant assurance. Dependency expiry/revocation/support degradation or
changed source/mapping creates a new projection with supersedes/reason, retaining
history. Cache keys include tenant/mode/scope, source vector, both times,
projection version and access context; access is rechecked on read/drill-down.

## 6. Failure, claims, artifacts and European profile

The read contract defines UNKNOWN, NOT_MAPPED, NOT_APPLICABLE, NOT_ASSESSED,
INSUFFICIENT_EVIDENCE, SOURCE_PENDING, ACCESS_DENIED, PARTIAL_ACQUISITION,
DEPENDENCY_INVALID and NOT_ASSERTED as separate rendering conditions. Acquisition
or access failure cannot become empty data, false predicates, a favorable
denominator adjustment, zero or green. Unsupported values fail closed. Empty
is known only after complete authorized evaluation of an enumerable manifest.

All 38 S2 controlling ceilings and 42 INELIGIBLE claims remain unchanged.
E1 record access is INTERNAL_ONLY and affirmative use PROHIBITED for all 42.
Required reviewers, unresolved gap references, exact wording, validity and
invalidation triggers remain visible. Missing S2 or an inconsistent ceiling
blocks affirmation; S1 alignment candidates cannot supply a fallback. E1's
CL-CERTIFICATION-01 scoped mapping correction to UNKNOWN is an overlay, never
a rewrite of S2 or a new artifact. Commercial wording needs independently
reviewed scope, source currency and actual presentation; approval cannot
override a failed prerequisite or grant governance authority.

Certification/attestation stays NOT_ASSERTED. A future artifact must identify
independent issuer/authenticated source, exact subject/legal entity, framework
edition, scope, artifact identity/version, validity dates or explicit issuer
validity semantics, verification state and expiry/revocation basis. Unverified
is UNKNOWN; expired/revoked stays historical, never current positive. The Hub
does not infer certification from evidence, internal readiness, awards or an
intact ledger. Awards preserve edition/source/eligibility/readiness/calendar/
conflict/UNKNOWN; no likelihood, probability, award-ready or issuer-free outcome.

The European profile separates the seven named axes. The pinned original
OJ reference `EU-AI-ACT-2024-1689-OJ-20240712` and bounded Article 11/12/Annex IV
references retain their original source/access limitations. They do not prove
current operative law or applicability. Those require qualified source/version,
amendment/corrigendum, transition, jurisdiction, role, intended-use and scope
review at the declared time coordinates. Until established, operative-law and
applicability remain UNKNOWN, sufficiency NOT_ASSESSED and external state
NOT_ASSERTED. No “EU AI Act compliant” state or legal-compliance aggregate exists.

## 7. Exposure and legacy dependencies

Exposure is independent of truth, claim eligibility and record access. S0
evaluates INTERNAL_REVIEW, CONTROLLED_DOCUMENT_WALKTHROUGH,
CONTROLLED_PRODUCT_DEMO, EXTERNAL_PUBLICATION, TENANT_ASSURANCE and
EXTERNAL_CERTIFICATION_ASSERTION. It grants none. Even a document walkthrough
needs a separately approved bounded artifact/audience/wording context. The
contract defines permitted audience/data class, publication and independent
review requirements for each level and each view. All readiness HOLDs remain.

Every L01-L05 and LX01-LX09 input maps to blocked view paths in the companion.
Affected navigation, adjacent demo surfaces, drill-down, package compatibility,
extension/report/export paths must be reviewed, not merely omitted from a Hub
panel. LX08 cannot supply chain status until organisation scope is enforced,
principal authorization exists, UNKNOWN and explicit empty semantics are
preserved, and missing result is not automatically BROKEN. A chain's integrity
does not validate legacy oversight payload contents. No audit remediation is
performed. L05 remains SAFE only for the inspected export rejection guard;
LX09 dormant generators and L04 package compatibility inherit no SAFE state.
Exposure population is open-ended, not proof every reachable surface was found.

## 8. Information architecture, slicing and acceptance

Views A–K are Assurance Overview, Capabilities, Evidence, Frameworks,
Requirements / References, Gaps, Claims, Certification & Attestation, Awards,
KPI Definitions and European Assurance Profile. The companion defines each
purpose, inputs, filters, allowed categorical counts, UNKNOWN behavior,
drill-down, audience/data/publication/review boundary, read requirements,
legacy blockers and implementation classifications. No scores or percentages.

The proposed sequence is V1-S1A audit security containment; S1B live legacy
exposure; S1C package/dormant-export containment; S2 shared projection contracts;
S3 principal-bound atomic tenant reads; S4 pinned product projections; S5 tenant
projections; S6 European profile; S7 Hub API/UI; S8 adversarial closure. Product
S4 depends on common S2 and may proceed independently of tenant S3 once separately
authorized. Artifact/license/qualified-review prerequisites may keep tenant and
external paths HOLD. Each slice needs separate owner authorization. None starts
here. Exact proposed next slice: **V1-S1A — LX08 audit security containment**.

W-V1-01 through W-V1-20 are deterministic documentary gates in the read contract.
They distinguish an architecture decision from future runtime acceptance. S0
verification checks immutable inputs, resolving IDs/source anchors, decisions,
read-class/tenant/temporal boundaries, population conservation design, claims,
artifacts, exposure, source scope, zero non-documentary delta and whitespace.
No runtime/PostgreSQL/full-regression or review-of-review loop is appropriate.

M17.5 V0 READINESS PACK: **CLOSED / PASS**. M17.5-V0-E1: **CLOSED / PASS**.
M17.5-V1-S0: **CLOSED / PASS** for documentary architecture only.
M17.5 overall: **OPEN**. CONTROLLED_DEMO_READINESS,
EXTERNAL_PUBLICATION_READINESS, TENANT_ASSURANCE_READINESS and
CERTIFICATION_READINESS: **HOLD**. M18: **HOLD**.
No runtime/database/migration/API/UI delta, PR, deployment, tenant execution,
publication, containment, M18 or Normative Intelligence implementation.
