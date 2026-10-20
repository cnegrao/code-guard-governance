# ADR — Trust & Assurance Foundation V1

Status: S0 architecture contract / candidate for review; no external certification asserted.
Date: 2026-10-20. Milestone: M17.5-S0, V0 Readiness Pack.
Implementation evidence base: `acb95f84036b9bd5759c8afa04460bf1a004595f` (PR #81 merge).
Baseline: [GOVIA-L0L16-CIA-v1.0](GOVIA-L0L16-CIA-v1.0.md), unchanged.
Scope authority: the owner's S0 instruction, following the [roadmap](GOVIA-L0L16-CIA-v1.0-roadmap.md).

## 1. Purpose and decision

Trust & Assurance translates existing governed truth and evidence into auditable,
externally understandable references and explicitly bounded claims:

```text
Architecture → Capability → Evidence → Framework → Assurance
             → Certification / Award Readiness → Commercial Claim
```

It is a read/projection capability. Framework-specific interpretation belongs in
versioned mappings and applicability metadata, never in canonical governance
truth. A mapping does not satisfy a requirement. Evidence availability does not
prove sufficiency. Readiness does not establish legal compliance or certification.

S0 delivers this contract and a repository-scoped, machine-readable capability
inventory. It creates no assurance runtime, database, API, UI, scheduled job or
external framework requirement content. The inventory describes implementation
properties, not a customer's control effectiveness or a deployed environment.

## 2. Authority and non-goals

Upstream contracts consumed unchanged: the [M16 ADR](ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md)
§19 legacy disposition and its governed evidence/read contracts; the
[M17 ADR](ADR-GOVIA-RISK-INTELLIGENCE-v1.md) §9 evidence/support matrix,
§20 read projections and §21 Graph/Vector/LLM boundaries, with the indexed
additive O31 and C-M17-01 clarifications.

The 11 CanonicalObjectKinds, 12 GovernedRelationshipTypes, 16 Passport families,
five M16 authoritative fact families, four L15 authoritative fact families, F2,
and the single Authority Policy remain frozen. Projection identifiers and links
below are metadata identifiers, not canonical objects, canonical edges, L14/L15
facts, governance permissions or decisions. Editing a mapping or a claim cannot
validate, revoke, authorize, accept or overwrite an upstream fact.

No parallel risk, policy, control, evidence or governance truth store is allowed.
References retain the original authority classification and trust vocabulary.
No automatic compliance truth, compliance percentage, weighted score, maturity
index, certification probability or Bronze/Silver/Gold/Platinum authority is
allowed. An LLM may neither manufacture evidence nor issue certification claims.

Normative Intelligence / Policy Engineering is explicitly excluded: no normative
document ingestion, semantic decomposition, generated obligations, autonomous
interpretation or policy onboarding. Framework metadata and human-authored,
source-pinned references suffice without pulling that future capability forward.

## 3. Neutral model and minimum contract

Every versioned record has a metadata ID, schema version, recorded time, author
or source, superseded-version reference and provenance. Tenant-bearing records
also have `organisation_id`; external public bibliographic metadata may be
shared, but tenant mappings, evidence, attestations, KPIs and claims may not.
References below pin exact versions, never a mutable display name or latest row.

| Concept | Classification | Minimum specific content / relationship |
|---|---|---|
| Framework | External reference metadata | Stable ID, display name, publisher; no inferred obligations. |
| FrameworkVersion | External reference metadata | Framework ID, exact edition/version, publication/effective dates when verified, source and licensing metadata. Unknown edition is explicit. |
| FrameworkRequirement | External reference metadata | Version ID, publisher requirement identifier/title, precise source locator, verification state; no invented clauses. |
| Capability | Projection metadata | Stable ID, bounded implementation claim, layer/milestone, repository commit, proof status and limitations. |
| EvidenceReference | Projection metadata | Typed immutable locator to an existing artifact, original authority/trust, tenant/scope, version/digest, time coordinates, access and currency states. It does not copy evidence content. |
| CapabilityEvidenceLink | Projection metadata | Capability version + evidence reference version, supported assertion and limitations; existence of a link is not sufficiency. |
| RequirementCapabilityMapping | Projection metadata | Exact requirement version + capability version, mapping axis, rationale, author, reviewed date and limitations. |
| RequirementEvidenceMapping | Projection metadata | Exact requirement version + existing evidence reference, supported assertion, adequacy rationale/reviewer and unresolved gaps. |
| Applicability | Projection metadata | Exact requirement, tenant, subject and intended-use/jurisdiction scope, rationale, reviewer, validity interval and applicability axis. It is not M16 POLICY_APPLICABILITY or a legal determination. |
| AssuranceProjection | Derived projection | Exact inputs, subject/scope, effective time, recorded cutoff, projection version, six independent axes, gaps and limitations. Recomputable; cannot override inputs. |
| Gap | Derived projection | Requirement/scope, gap kind, missing or contradictory references, observation time; remediation assignment may be annotation metadata, never a new governed risk/control. |
| ExternalAttestation | External attestation | Reference to externally issued artifact, issuer, certificate/attestation ID, subject/legal entity, framework/edition, scope, dates, verification and revocation basis. No self-issued certificate. |
| CommercialClaim | Commercial metadata | Exact text, claim class, audience/scope, complete trace, basis, reviewer, validity and eligibility. Approval is publication metadata, not governance authority. |
| KPIDefinition | Projection metadata | Count name, precise unit/predicate, input sources, deduplication key, scope/time coordinates, exclusions and missing-data rule. |

These concepts own references and interpretation metadata only. Existing
upstream stores continue to own evidence, decisions, states, policies, controls
and risk. No metadata link is added to the canonical relationship catalog.

## 4. Evidence lineage and proof

The trace is `claim → capability → evidence reference → requirement mapping →
assurance projection`, with version pins on every hop. A factual claim with no
verified framework association still records mapping `NOT_MAPPED` or `UNKNOWN`;
it must not imply alignment. A projection retains the exact source decision,
authorization/policy version and governed state IDs wherever its claim depends
on them. Evidence support never substitutes for an authoritative dependency pin.

Admissible reference families for this projection contract are closed:

- `REPOSITORY_ARTIFACT`: repository, full commit, path, line/symbol locator,
  byte digest and evidence role (implementation, test, architecture or presentation).
- `VERIFICATION_ARTIFACT`: command, input commit/candidate, environment, execution
  time, result and durable run/artifact locator. A workflow file proves a check
  is configured; only a verified run proves it passed for that input.
- `GOVERNED_REFERENCE`: exact tenant + existing canonical object/relationship
  state, decision or governed L14/L15 state/registry version. Read through the
  existing authorized read boundary; no new generic cross-store query authority.
- `UPSTREAM_EVIDENCE_REFERENCE`: tenant + an existing typed evidence target,
  preserving its original type and identity. Reuse `discovery_evidence`, source
  assertions, runtime observations and the existing M16/M17 lineage contracts.
  M16 support targets remain restricted to discovery evidence; M17's closed
  tagged union and acyclic owner/target matrix remain unchanged.
- `EXTERNAL_ARTIFACT_REFERENCE`: publisher/issuer source, exact edition or
  artifact identity, locator, retrieval/verification date, access/licensing
  metadata and permitted fingerprint. Framework sources and attestations have
  different roles and cannot substitute for each other.

This is a projection locator union, not an expansion of L15 support tags or a
new evidence admission system. Legacy `gov_repo.evidence`, `cg_*` flags, heuristic
certification tiers, Graph scores and LLM prose are not admissible certification
or requirement-satisfaction proof. Analytical evidence may explain a result,
but its classification cannot become authoritative through a mapping.

Inventory proof statuses are closed: `PROVEN`, `PARTIALLY_PROVEN`, `NOT_PROVEN`,
`UNKNOWN`. `PROVEN` requires exact implementation and executable verification
for the bounded claim and declared input. ADR prose alone cannot prove it.
`PARTIALLY_PROVEN` identifies both the verified portion and missing proof.
`NOT_PROVEN` records searched-for proof that was not established, without
claiming universal nonexistence. `UNKNOWN` records an unverified context.
Neither status is a framework satisfaction status. Evidence modes are
`RUNTIME_EXECUTABLE`, `DATABASE_ENFORCED`, `CI_PROVEN`,
`ARCHITECTURE_DOCUMENTED`, `PRESENTATION_ONLY`; each must have its own basis.
An unexecuted DB test or historical PASS is not a current deployment proof.

## 5. Independent categorical axes

| Axis | Closed vocabulary | Rule |
|---|---|---|
| Applicability | APPLICABLE, NOT_APPLICABLE, UNKNOWN | NOT_APPLICABLE needs scoped rationale and reviewed source; absence stays UNKNOWN. |
| Mapping | MAPPED, NOT_MAPPED, UNKNOWN | MAPPED requires a source-verified requirement and version-pinned mapping, not a standard name in a README. |
| Evidence availability | EVIDENCE_AVAILABLE, NOT_EVIDENCED, UNKNOWN | Available means identified and accessible at the cutoff, not sufficient. A known empty support set is NOT_EVIDENCED; inaccessible or unverified lookup is UNKNOWN. |
| Internal readiness | READY, GAP, UNKNOWN | READY requires scoped applicable requirements, reviewed sufficiency, current evidence and no unresolved gaps; capability existence alone is insufficient. |
| External certification/attestation | NOT_ASSERTED, CERTIFIED, ATTESTED, UNKNOWN | CERTIFIED/ATTESTED require independently verified external artifacts of the exact kind and scope. |
| Commercial claim eligibility | ELIGIBLE, INELIGIBLE, UNKNOWN | Determined per claim class and exact wording; not a general compliance verdict. |

Auxiliary closed states:

- Source provenance: `AUTHORITATIVE_SOURCE_VERIFIED`,
  `EXTERNAL_REQUIREMENT_SOURCE_PENDING`, `NON_AUTHORITATIVE_SOURCE`.
- Reference currency: `CURRENT`, `STALE`, `UNKNOWN`.
- Reference access: `AVAILABLE`, `UNAVAILABLE`, `UNKNOWN`.
- External artifact verification: `VERIFIED_CURRENT`, `EXPIRED`, `REVOKED`,
  `UNVERIFIED`, `UNKNOWN`.
- Gap kind: `SOURCE_PENDING`, `MAPPING_MISSING`, `APPLICABILITY_UNKNOWN`,
  `EVIDENCE_MISSING`, `EVIDENCE_STALE`, `EVIDENCE_INSUFFICIENT`, `CONFLICT`,
  `EXTERNAL_BASIS_MISSING`.

Example: `MAPPED / EVIDENCE_AVAILABLE / APPLICABLE / GAP / NOT_ASSERTED /
INELIGIBLE` is valid and must never render as compliant or certified. There is
no aggregate compliance status. NOT_APPLICABLE must not automatically become
READY. Conflicts produce GAP when verified; otherwise UNKNOWN. Access denial
does not disclose another tenant's evidence or count as evidence of absence.

## 6. External framework provenance

Each eventual requirement carries framework ID/version, publisher, source URI
or licensed source reference, exact source edition/date, requirement ID/title,
section/page locator, authoritative-source state, verified/retrieved time,
reviewer and legally/technically permitted content fingerprint (algorithm,
scope and value). A bibliographic title is not a normative requirement.

The initial catalog contains only scope labels: DAMA-DMBOK, EDM Council / DCAM,
ISO/IEC 42001, ISO/IEC 38505-1:2026, ISO/IEC 23894, NIST AI RMF and EU AI Act.
These are owner-requested labels, not verified editions or assertions about
current legal requirements. S0 does not supply authoritative clause-level
source material: all seven entries are `EXTERNAL_REQUIREMENT_SOURCE_PENDING`
and have empty requirement sets. Existing static traceability matrices and
regex scanners do not discharge this gate.

Later mapping may use publisher-controlled public NIST and official legislation
sources, pinned to exact versions. ISO and other licensed sources support
metadata/locators without embedding protected text or presuming access rights.
No standard text is reconstructed from memory. A missing license/source is a
source gap; no mapping or compliance conclusion may be fabricated around it.

## 7. Certification and commercial claims

An external certification artifact must identify the issuing body, authenticated
source, certificate ID, certified legal entity/product/service, framework and
edition, certified scope and validity period. Verify authenticity, current
status and revocation/expiry at the projection cutoff. An attestation needs an
externally issued attestation artifact with corresponding scope and issuer
basis. A customer, product and organization are not interchangeable subjects.

`NOT_ASSERTED` means no claim was made, not proof of absence of certification.
An unverified artifact yields UNKNOWN; known expired/revoked artifacts remain
visible as historical references but cannot yield current CERTIFIED/ATTESTED.
When both artifact kinds exist, retain separate scoped artifact records and
axis instances; never silently replace attestation with certification.
Internal tests, human reviews, READINESS=READY and complete evidence sets can
never create CERTIFIED or ATTESTED.

Claim classes are closed:

| Class | Eligibility basis |
|---|---|
| FACTUAL_CAPABILITY | Bounded reproducible capability with current, scope-matched proof; wording cannot imply regulatory satisfaction. Mapping may explicitly be NOT_MAPPED/UNKNOWN. |
| EVIDENCE_BACKED_ALIGNMENT | Verified requirement source, MAPPED links, applicable scope, accessible/current evidence and reviewed alignment rationale. It makes no compliance or certification assertion. |
| READINESS_STATEMENT | Explicit scope and cutoff, READY with reviewed sufficiency and no unresolved scope gaps; identify as internal readiness. External state remains independent. |
| EXTERNAL_CERTIFICATION | Verified current externally issued certification artifact matching the precise claim; an attestation may be described only as an attestation, never certification. |
| EXTERNAL_ATTESTATION | Verified current externally issued attestation artifact matching the precise claim; its scope and wording cannot imply certification. |

Each claim carries exact text and all trace IDs, scope, validity, provenance and
reviewer. Missing evidence or unavailable checks produce INELIGIBLE when the
missing prerequisite is known, otherwise UNKNOWN. Stale/revoked inputs
invalidate current eligibility and require recomputation; a publication review
cannot override a failed prerequisite. No LLM can approve an external claim.

Alignment means a supported correspondence; readiness is an internal scoped
evaluation; compliance evidence is material for an authorized assessment;
external certification is an issuer-granted artifact. None implies the next.
"ISO 42001 certified", "EU AI Act compliant", "100% compliant" and "fully
governed" are rejected without their exact external/legal and scope basis.
S0 provides no such basis. Broad legal compliance claims have no eligibility
route in this V0 contract; a later authorized legal basis is required.

## 8. KPI framework

KPIs are operational counts with unit, population/predicate, tenant, subject,
deduplication key, time coordinates, input versions and query limitations.
They do not grant authority. This contract defines the following count units:

| KPI | Unit and deduplication key | Inclusion predicate |
|---|---|---|
| Governed objects with evidence | Distinct canonical object ID per tenant | Current governed object and at least one resolved admissible evidence reference. |
| Unresolved gaps | Distinct projection gap key | Gap unresolved at the scoped cutoff; same cause/reference counted once. |
| Requirements with evidence | Exact framework version + requirement ID + scope | At least one resolved current mapping/evidence reference; no satisfaction implication. |
| UNKNOWN requirements | Exact requirement + scope + axis | Explicit UNKNOWN for the named axis; axes reported separately to prevent ambiguous totals. |
| Stale evidence references | Distinct reference version + tenant/scope | Currency STALE under a declared freshness rule, including expired dependencies. |
| Governed supporting decisions | Distinct existing decision ID + tenant | A resolved decision trace supports an exact scoped requirement. |

Empty verified populations may yield zero. Partial queries, access failures,
unresolved sources and unknown population sizes yield UNKNOWN with limitations,
never a fabricated zero. No ratios, denominators for a compliance percentage,
weights, grades, maturity bands or award-winning/certification probability.
Counts remain observability even when every counted reference is authoritative.

## 9. Tenant isolation and temporal/versioning expectations

Tenant comes from the existing verified principal. Subject, evidence and state
resolution must match that tenant at every hop. Technical service capability
does not grant governance or external-publication authority. Repository-wide
implementation evidence is explicitly product-scoped; it cannot prove a
tenant's deployment, operating effectiveness or certification. Public framework
metadata has no tenant content; licensed access remains entitlement-controlled.

Use exact effective time and recorded cutoff of existing bitemporal resolvers;
preserve their timestamp precision. Pin repository commits, framework editions,
mapping/rationale versions and projection algorithm version. Record generated
time separately from observed/effective/recorded time. Revocation, supersession,
expiry, source correction, mapping change or degraded support causes a new
projection; it cannot rewrite historical truth. Reference currency is distinct
from availability. Any future cache is disposable, input-pinned, tenant-isolated
and recomputable. Cross-query results must disclose non-atomic snapshot limits.
Missing permission or an unavailable resolver stays UNKNOWN; no direct-table
privilege expansion or generic hosted evidence fetch is authorized by this ADR.

## 10. M17, M18, V0 and V1

M17 is CLOSED / MERGED at the supplied canonical base. Its immutable risk and
support contracts are consumed unchanged. Historical closure documents contain
pre-merge HOLD language; they are time-scoped records, not instructions to reopen
M17. This S0 inventory does not claim a new O01–O91 audit or current CI result.

V0 ultimately comprises the External Credibility Matrix, Standards/Framework
Crosswalk, Evidence Index, Certification Gap Register, Award Readiness Matrix
and Calendar, Commercial Claims Register and Product/Customer KPI Framework.
S0 establishes only their shared contract and current capability inventory.
Award eligibility, criteria, organizer sources, deadlines/time zones and status
need independently verified reference metadata in a later authorized slice;
engineering capability is not an award, nomination or eligibility proof.

V1 adds a Trust & Assurance Hub and read-only drill-down using this contract.
M18 consumes these projections for business personas without persona-specific
truth or alternative statuses. Neither V0 nor V1 imports Normative Intelligence,
creates a score or changes M17. Each later runtime slice needs its own scoped
authorization and verification; no tables, API or dashboard are selected here.

## 11. Baseline §9 declaration and acceptance

| DoD | S0 declaration |
|---|---|
| A/B | Frozen CIA baseline; projections consume L0–L16, especially M11–M17; no layer redefinition. |
| C/D | No Passport family, canonical kind, edge or temporal-state change. |
| E/F | Exact immutable evidence references and lineage; no copied evidence store. |
| G | Original authority retained; metadata cannot issue governance decisions. |
| H/I/J | Graph/Vector analytical, LLM non-authoritative; no new runtime calls. |
| K | Verified tenant-bound reads, scoped artifact access and no cross-tenant counts. |
| L | No migration, schema, RLS, hosted or production change. |
| M | M17 preserved; M18 consumes versioned assurance; Normative Intelligence excluded. |
| N | UNKNOWN/NOT_EVIDENCED and source-pending explicit; no invented requirement/certificate. |
| O | Exact evidence for each PROVEN claim, closed categorical axes, machine-auditable inventory, scope and lineage checks. No compliance quality score. |

S0 acceptance: every inventory evidence locator resolves at the pinned commit;
all PROVEN assertions cite implementation plus executed focused verification;
DB-only/unverified contexts retain limitations; seven framework sources stay
pending; legacy hazards have dispositions; diff contains only additive docs and
the architecture index. No historical ADR/migration or runtime is edited.

STOP if neutral projections require canonical authority, trustworthy references
cannot be resolved, legacy output actively governs canonical truth contrary to
this boundary, framework metadata requires Normative Intelligence, or a frozen
invariant conflict is found. S0 found no such blocker. The legacy percentages
and heuristic labels remain explicit containment work before external assurance
presentation; this ADR does not claim those surfaces were fixed.
