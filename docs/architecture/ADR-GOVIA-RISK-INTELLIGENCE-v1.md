# ADR — M17 Risk Intelligence V1

**Status:** DRAFT — pending ACP / owner review. NOT ACCEPTED. NOT FROZEN.

**Architecture:** `GOVIA-L0L16-CIA-v1.0` — FROZEN (unchanged by this ADR)

**Milestone:** M17 — RISK INTELLIGENCE V1 (L15; `signal → hypothesis → governed risk → residual risk`)

**Base SHA:** `5aec0b500cb16b0e3ce67376629ffa68cf2e6186` (canonical main after PR #63, M16 formal closure)

**Date:** 2026-10-12

**Upstream contracts consumed (not modified):**
[M16 ADR](./ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md) (ACCEPTED / FROZEN; M16 CLOSED),
[M15 ADR](./ADR-GOVIA-CROSS-SIGNAL-RECONCILIATION-AND-DRIFT-v1.md),
[Runtime observation ADR](./ADR-GOVIA-RUNTIME-OBSERVATION-AND-OTEL-INGESTION-v1.md),
[Execution context ADR](./ADR-GOVIA-EXECUTION-CONTEXT-IDENTITY-CONNECTIVITY-AUTHZ-v1.md).

**Current-state inventory:** [`2026-10-12-m17-current-state-inventory.md`](../codex/evidence/2026-10-12-m17-current-state-inventory.md)

This document makes M17 implementation-ready under baseline §9 **once accepted**. While it is DRAFT, MUST / MUST NOT
/ REQUIRED express the proposed contract; they bind implementation only after ACP / owner approval. No M17
implementation, migration, runtime change, hosted operation or M18/M19 work is part of this documentation slice.
Decisions that require owner approval are listed in §27 and are never resolved by silently changing the baseline or
M16 history.

---

## 1. Decision, scope, and architecture authority

M17 MUST establish **L15 — Risk & Exposure Intelligence** as a governed chain:

```text
RISK SIGNAL  →  RISK HYPOTHESIS  →  GOVERNED RISK  →  RESIDUAL RISK
(evidence)      (analysis)          (authority)       (governed assessment,
                                                       deterministically re-checked)
```

L15 is **transversal**: it consumes evidence and governed facts from L0–L14 and L16 and adds governed risk
statements, risk assessments, treatments and residual-risk acceptance. It MUST NOT redefine any upstream fact.

M17 MUST:

- consume, not redefine, the five M16 governed fact families and M16 registries (§13);
- keep every machine output (scanner, M15, graph, vector, LLM) at or below **PROPOSED** — realized as signals and
  hypotheses, never governed risk (§§4–5, 21);
- reuse the M16 verified-principal, Authority Policy, proposal → authorization → decision → state, replay,
  concurrency, temporal and privilege patterns (§§10–12, 17–18);
- keep Graph and Vector projection-only and LLM non-authoritative (§21).

M17 MUST NOT implement: M18 Business Workspace / persona-specific truth; M19 connectors; a generic approval or QES
workflow; a control waiver / exception lifecycle (§15.6); a numeric organisation risk score; any change to the 11
CanonicalObjectKinds, 12 GovernedRelationshipTypes, Passport's 16 families, or F2.

## 2. Frozen invariants preserved

All baseline §2 invariants hold verbatim. Their L15 reading:

| Invariant | L15 consequence |
|---|---|
| SOURCE ASSERTION != CANONICAL FACT | An imported risk-register row is an IMPORTED signal or SOURCE_CONNECTION proposal, never a governed risk. |
| SEMANTIC SIMILARITY != PHYSICAL IDENTITY | Two similar hypotheses/risks are never merged or deduplicated automatically. |
| CAPABILITY != AUTHORIZATION | An AUTHORIZATION-domain signal over a declared capability does not assert a granted permission. |
| DESIGN-TIME DECLARATION != RUNTIME OBSERVATION | Signals keep their trust class; a DECLARED signal never stands in for OBSERVED exposure. |
| DISCOVERY != GOVERNANCE AUTHORITY | Discovery produces signals/hypotheses only. |
| SCANNER MACHINE AUTHORITY CEILING = PROPOSED | Scanner output tops out at RISK_HYPOTHESIS (§5); it cannot submit a GOVERNED_RISK proposal. |
| HIGH CONFIDENCE != VALIDATED | Confidence, severity hint, rating band or graph exposure never validates, closes, or accepts a risk. |
| VECTOR SIMILARITY != CANONICAL MERGE | Vector retrieval may suggest related risks; it never merges, supersedes or links them authoritatively. |
| GRAPH PROJECTION != SYSTEM OF RECORD | Exposure / blast radius is an ANALYTICAL projection; no risk is stored in or derived authoritatively from the graph. |
| LLM OUTPUT != CANONICAL TRUTH | LLM text is never evidence, never a decision, never a state. |
| UNKNOWN != FALSE | Absence of a governed risk is UNKNOWN, never "no risk" or "low risk". Absence of a detected artifact is not absence of the control. |
| MISSING EVIDENCE MUST NEVER BE FABRICATED | No default likelihood/impact, no estimated cost presented as cost, no assumed residual reduction. |

## 3. Current-state disposition summary

The [inventory](../codex/evidence/2026-10-12-m17-current-state-inventory.md) classifies 60 surfaces. Summary:

- **No legacy risk surface is authoritative.** `risk_entries`, `risk_treatments`, score columns, array relations,
  legacy owner identities, `evidence.risk_refs`, `agents.risk_level`, `ai_systems.residual_risk_level`,
  `agent_risk_propagation`, legacy exceptions/approvals, `compute_governance_score` are QUARANTINED AS AUTHORITY.
- Scanner `DetectedRisk`, FinOps pattern flags, M15 comparison results, L11/L12/L3 facts are INPUT / SIGNAL ONLY.
- M12 governed traversal and hybrid retrieval are PROJECTION ONLY.
- M16 facts, registries, read projections, verified principal and evidence anchors are REUSE; the Authority Policy
  machinery is REUSE + HARDEN subject to decision D-01; Passport is REUSE + HARDEN for a risk overlay.

Full legacy disposition is in §23.

---

## 4. RISK SIGNAL

### 4.1. Semantics

A **RISK_SIGNAL** is an immutable, tenant-scoped, evidence-backed *reference record* stating that a specific detector,
source, or human observed something potentially risk-relevant about an exact subject. It is **not** governed risk, has
no lifecycle, and has no authority.

A signal MUST be a typed reference to existing evidence-bearing records; it MUST NOT copy upstream values (no second
copy of a runtime observation, M15 result, or M16 fact). It adds only: the detector/method classification and the
exact references.

### 4.2. Required content

| Field | Rule |
|---|---|
| `organisation_id`, `signal_id` | Tenant-scoped; random opaque id. |
| `signal_kind` | Closed V1 vocabulary (§4.3). |
| `subject` | Exact canonical object (`organisation + canonical_object_id + kind`), exact relationship state (`organisation + relationship_id + relationship_state_id`, §8.3), or `UNRESOLVED` with a closed `unresolved_reason`. UNRESOLVED signals are retained but cannot seed a GOVERNED_RISK proposal target. |
| `source_class` | `SYSTEM_DETECTOR`, `SOURCE_CONNECTION`, `RUNTIME_SOURCE`, `GOVERNED_FACT_REFERENCE`, `LOCAL_HUMAN`. |
| `trust_state` | Exactly one of `INFERRED`, `DECLARED`, `IMPORTED`, `OBSERVED` per the M16 §8 origin rules; **never `VALIDATED`**. A `GOVERNED_FACT_REFERENCE` signal carries no trust of its own: it points at the referenced state's own trust. LOCAL_HUMAN signals carry no trust classification (absent, not a sixth value). |
| `method_id`, `method_version` | REQUIRED for every non-human signal. An unversioned detector cannot emit a persisted signal. |
| `evidence_refs` | ≥ 1 entry of the closed evidence-reference union (§9) for every non-human signal; LOCAL_HUMAN signals MAY carry zero, and then `support_status = NONE` is explicit. |
| `source_hint` | Optional, typed, explicitly non-authoritative source labels (e.g. scanner `severity`, `confidence`). Stored under the `hint_` prefix; never read by any authority, rating, or lifecycle logic. |
| `observed_at` / `recorded_at` | Source observation time when evidenced (else absent, never defaulted); DB-authored recording time. |

### 4.3. Closed V1 signal kinds

| `signal_kind` | Admissible source | Notes |
|---|---|---|
| `DETECTED_PATTERN` | SYSTEM_DETECTOR | A detector matched a pattern in evidenced source (e.g. secret indicator, N+1, missing timeout). |
| `DETECTED_ABSENCE` | SYSTEM_DETECTOR | A detector did **not** find an expected artifact (e.g. no README, no tests). MUST render as "not detected", never "absent control" (`UNKNOWN != FALSE`). |
| `RUNTIME_OBSERVATION_REF` | RUNTIME_SOURCE | Reference to exact L12 `runtime_observations` rows (errors, latency, tokens, cost, unexpected target). |
| `CROSS_SIGNAL_RESULT_REF` | GOVERNED_FACT_REFERENCE | Reference to an exact M15 comparison result with outcome `CONFLICT_CANDIDATE` or `INSUFFICIENT_EVIDENCE` (`DRIFT_CANDIDATE` admissible when a future M15 method emits it). `CONSISTENT` is not admissible as a risk signal. |
| `EXECUTION_CONTEXT_REF` | GOVERNED_FACT_REFERENCE | Reference to exact L11 `execution_field_states` (principal, grant, environment, egress). |
| `CONTROL_ASSESSMENT_REF` | GOVERNED_FACT_REFERENCE | Reference to an exact M16 CONTROL_ASSESSMENT state with outcome `NOT_SATISFIED`, `PARTIALLY_SATISFIED`, `NOT_ASSESSED` or `INSUFFICIENT_EVIDENCE`. |
| `GOVERNANCE_GAP_REF` | GOVERNED_FACT_REFERENCE | A deterministic read finding that a required M16 fact is UNKNOWN for the exact subject (e.g. no current DATA_OWNER). The signal records the query coordinates, never a fabricated negative fact. |
| `LINEAGE_REF` | GOVERNED_FACT_REFERENCE | Reference to exact L3/L9 lineage states / observations (e.g. sensitive DataElement reached). |
| `IMPORTED_ASSERTION` | SOURCE_CONNECTION | Enterprise risk-register / security-tool assertion with L0 source identity (M19 populates later). |
| `HUMAN_OBSERVATION` | LOCAL_HUMAN | Verified same-tenant member's observation; no trust promotion. |

No other kind exists. Unknown kinds MUST be rejected.

### 4.4. Signal admission

Signals are admitted only through bounded technical intake RPCs (machine sources) or a verified-principal command
(LOCAL_HUMAN). Admission is a **technical capability, not governance authority**: it requires no L15 permission, creates
no governance decision, and cannot create, modify, validate, or close governed risk. Admission MUST reject cross-tenant
subjects/evidence, unknown kinds, missing method/version, and (for non-human sources) missing evidence. Replay
follows §17: identical `(organisation_id, intake_key)` returns the original signal; changed content returns
`REPLAY_CONFLICT`.

---

## 5. RISK HYPOTHESIS

### 5.1. Semantics

A **RISK_HYPOTHESIS** is an immutable analytical interpretation that one or more signals *may* constitute a risk of a
stated scenario on a stated exact subject. It is **not** authoritative risk and has no lifecycle state of its own.

| Field | Rule |
|---|---|
| `hypothesis_id` | Random opaque, tenant-scoped. |
| `cited_signal_ids` | ≥ 1 exact same-tenant signal ids. A hypothesis with zero signals is rejected (non-fabrication). |
| `proposed_subject` | Exact subject as in §4.2 (UNRESOLVED not allowed). |
| `proposed_scenario_definition_id` | OPTIONAL reference to a validated RISK_SCENARIO_DEFINITION (§7.2); absent = "unclassified". |
| `generator_kind` | Closed: `DETERMINISTIC_RULE`, `GRAPH_ANALYSIS`, `VECTOR_RETRIEVAL`, `LLM_ASSISTED`, `HUMAN`. |
| `method_id`, `method_version` | REQUIRED for non-HUMAN generators; for `LLM_ASSISTED` additionally `model_provider`, `model_id`, `prompt_template_version`; for `GRAPH_ANALYSIS` the traversal policy version (e.g. `GOVIA_BLAST_RADIUS_V1`); for `VECTOR_RETRIEVAL` the representation/embedding version. |
| `trust_state` | `INFERRED` for every machine generator; absent for HUMAN. Never `VALIDATED`. |
| `hint_confidence` | Optional, non-authoritative. |

### 5.2. Rules

- A hypothesis MUST NOT be promoted by confidence, count, recency, generator kind, or agreement among generators.
- **Scanner / machine ceiling:** machine sources MAY create signals and hypotheses; they MUST NOT submit a
  GOVERNED_RISK proposal. The baseline "PROPOSED" ceiling is realized as RISK_HYPOTHESIS.
- Contradictory hypotheses coexist; none is selected (§19).
- A hypothesis's disposition is a **read projection** (`UNREVIEWED`, `CITED_BY_LIVE_PROPOSAL`, `CITED_BY_GOVERNED_RISK`,
  `CITED_BY_REJECTED_PROPOSAL`) computed from proposals/decisions that cite it; no mutable status column.
- `LLM_ASSISTED` hypotheses MUST cite signals whose evidence exists; LLM text MUST NOT be stored as evidence.

---

## 6. GOVERNED RISK

### 6.1. Semantics

A **GOVERNED_RISK** state is the authoritative, organisation-local statement that a validated risk scenario applies to
an exact subject, established by an explicit authorized governance decision. It is an L15 fact, not a canonical
object or relationship.

| Property | Rule |
|---|---|
| Logical fact key | `organisation_id + subject identity + risk_scenario_definition_id` (stable definition id). One current state per key. |
| Pinned dependency | Exact validated `risk_scenario_definition_version_id` (+ DB content hash). A newer scenario version never silently repins (same rule as M16 §13–14). |
| States | `state_kind ∈ {VALIDATED, REVOKED}`; append-only with predecessor and decision lineage (M16 §17 pattern). |
| Domain | Derived from the pinned scenario definition version (exactly one, §7.1); never supplied by the caller. |
| Lineage | Proposal id, cited hypothesis ids (0..n), cited signal ids (0..n), normalized evidence refs (§9), authorization decision, governance decision, Authority Policy version + hash. |
| Free text | No free-text title/description/rationale in immutable records (M16 §10). Narrative lives only in a separate mutable, redactable, non-authoritative annotation surface. |
| Score | A GOVERNED_RISK state contains **no** likelihood, impact, rating or score. Assessment is a separate family (§10). "Score-only truth" is impossible by construction. |

### 6.2. Creation

`GOVERNED_RISK` VALIDATE requires: verified ACTIVE same-tenant decider; current `L15_GOVERNED_RISK_VALIDATE` under the
effective Authority Policy with matching action/source/scope; exact subject resolution; validated, non-revoked scenario
version effective at `effective_from`; scenario-domain × subject-kind legality (§8.2); expected-current concurrency
guard; self-validation fail-closed unless the policy permits it. Proposals MAY be submitted only by a verified member
(`LOCAL_HUMAN`) or a bounded `SOURCE_CONNECTION` intake (`IMPORTED`); `SYSTEM_SEED` cannot propose a governed risk.

### 6.3. Closure

A governed risk is closed **only** by an explicit `REVOKE` decision on its exact current state with a closed
`reason_code` ∈ {`RISK_NO_LONGER_APPLICABLE`, `SUBJECT_RETIRED`, `DUPLICATE_OF_GOVERNED_RISK`, `RISK_ELIMINATED_BY_AVOIDANCE`,
`RECORDED_IN_ERROR`}. No rating, treatment status, acceptance, expiry, or graph/LLM output closes a risk. A closed risk
remains in historical as-of readback.

---

## 7. Supporting registries

Both registries reuse the M16 ControlDefinition pattern (§4, §14 of M16): stable tenant-scoped identity, immutable DB-
hashed versions, ADMIT ≠ VALIDATE, governed validation/revocation, no free-form JSON/EAV.

### 7.1. Closed V1 risk domains

Exactly nine, matching baseline L15:

`PRIVACY`, `CYBERSECURITY`, `AUTHORIZATION`, `AUTONOMY`, `MODEL`, `DATA`, `CONNECTIVITY`, `OPERATIONAL`, `FINOPS`.

**Regulatory / compliance is NOT a risk domain.** Regulatory exposure is metadata over a governed risk, expressed only
by exact reference to M16 `POLICY_APPLICABILITY` states (and through them to hardened mandate mappings). A regulatory
rule match, mandate mapping, policy applicability, or legacy `compliance`/`legal` category MUST NOT create a signal of
risk by itself, a hypothesis, or a governed risk. "Control coverage" and "residual risk" are L15 analytical dimensions
(§§10–14), not domains. Legacy `legal`, `reputational`, `strategic`, `financial`, `technology`, `third_party`,
`architectural` categories have no V1 domain and are never auto-mapped (D-06).

### 7.2. RISK_SCENARIO_DEFINITION

A stable, tenant-scoped catalog entry naming a kind of risk (e.g. "sensitive DataElement read by an AgentVersion with
external egress"). Each immutable version pins: exactly one domain (§7.1); closed legal subject kinds (subset of §8.2);
typed reference codes; content hash computed by PostgreSQL. Seeds (e.g. from scanner rule ids or the CG-AG
traceability matrix) MAY be submitted only as `SYSTEM_SEED` proposals with provenance; they are never validated by
seeding.

### 7.3. RISK_METHODOLOGY

A stable, tenant-scoped assessment methodology. Each immutable, DB-hashed version pins:

- an ordered closed **likelihood scale** (2–7 levels, each `level_code`, `ordinal`, typed definition reference);
- an ordered closed **impact scale** (2–7 levels);
- a total **rating matrix**: every `(likelihood_level, impact_level)` cell → exactly one rating band from the closed
  vocabulary `LOW`, `MODERATE`, `HIGH`, `CRITICAL`;
- the methodology's **assessment validity maximum** (an interval bounding `valid_until − effective_from`).

The matrix is a lookup table, not arithmetic. A methodology version MUST be validated before any assessment may pin it.
Gov IA MAY ship one default methodology only as a `SYSTEM_SEED` proposal (D-11).

---

## 8. Subject / target model

### 8.1. Identity placement

Governed risk identity belongs to an **L15 authoritative fact store outside the canonical object taxonomy**, keyed by
`subject identity + risk_scenario_definition_id`. Rationale:

- Baseline §5 freezes the canonical taxonomy; risk is a governance statement *about* identities, not an identity
  (M16 §2 reached the same conclusion for POLICY/CONTROL/PARTY/DOMAIN).
- Canonical identity changes require ADR + version increment; risk statements change constantly.
- AgentVersion rules already forbid risk from creating versions (`contracts.ts`, AgentVersion technical profile note).

Therefore: **no `RISK` CanonicalObjectKind, no `HAS_RISK` / `MITIGATES` / `IMPACTS_RISK` GovernedRelationshipType.**
Exactly 11 kinds and 12 types remain. F2 stays untouched.

### 8.2. Legal subjects and domain × subject matrix

Legal V1 subjects: `AGENT`, `AGENT_VERSION`, `MODEL`, `TOOL`, `MCP_SERVER`, `API`, `DATA_ASSET`, `DATA_ELEMENT`, and an exact
relationship state (`REL:<type>`). `PROMPT`, `KNOWLEDGE_BASE`, `SKILL` are **not** direct V1 subjects; their risk is
expressed on the consuming AGENT_VERSION or on the exact `USES_PROMPT` / `USES_KNOWLEDGE_BASE` / `USES_SKILL`
relationship state, where behavior binding lives (baseline §5).

| Domain | Legal subject kinds |
|---|---|
| PRIVACY | AGENT_VERSION, DATA_ASSET, DATA_ELEMENT, REL:READS_FROM, REL:WRITES_TO, REL:DERIVED_FROM |
| CYBERSECURITY | AGENT_VERSION, MODEL, TOOL, MCP_SERVER, API, REL:USES_TOOL, REL:USES_MCP, REL:INVOKES, REL:EXPOSES, REL:USES_PROMPT |
| AUTHORIZATION | AGENT_VERSION, TOOL, MCP_SERVER, API, REL:USES_TOOL, REL:USES_MCP, REL:INVOKES, REL:READS_FROM, REL:WRITES_TO |
| AUTONOMY | AGENT_VERSION, REL:HANDOFF_TO, REL:USES_TOOL, REL:USES_MCP, REL:INVOKES, REL:WRITES_TO |
| MODEL | MODEL, AGENT_VERSION, REL:USES_MODEL |
| DATA | DATA_ASSET, DATA_ELEMENT, REL:READS_FROM, REL:WRITES_TO, REL:DERIVED_FROM, REL:USES_KNOWLEDGE_BASE |
| CONNECTIVITY | AGENT_VERSION, TOOL, MCP_SERVER, API, REL:INVOKES, REL:USES_MCP, REL:USES_TOOL |
| OPERATIONAL | AGENT, AGENT_VERSION, MODEL, TOOL, MCP_SERVER, API, REL:any of the 12 types |
| FINOPS | AGENT_VERSION, MODEL, API, REL:USES_MODEL, REL:INVOKES |

Logical `AGENT` is legal only for OPERATIONAL (service continuity / accountability of the stable identity). Behavior-
dependent risk targets AGENT_VERSION. The matrix is proposed for owner approval (D-07); once accepted it is closed and
every other pairing MUST be rejected.

### 8.3. Exact resolution and no inheritance

- Object subjects resolve by `organisation_id + canonical_object_id + declared kind`.
- Relationship-state subjects resolve by the exact triple `organisation_id + relationship_id + relationship_state_id`
  (M16 §16). No bare-state lookup, no new uniqueness constraint, no successor inference.
- **No inheritance**: a risk on AGENT does not apply to its AGENT_VERSIONs or vice versa; a risk on DATA_ASSET does not
  apply to its DATA_ELEMENTs; a risk on an object does not apply to its relationships; a risk on an old AGENT_VERSION
  never carries to a new one. Propagation is an exposure *projection* (§21.1), never a governed risk.

---

## 9. Evidence and provenance

### 9.1. Closed evidence-reference union

M16 `l14_support_links` references only `discovery_evidence` (inventory F-05). L15 MUST use its own normalized,
tenant-scoped support link table whose target is a **closed tagged union with a composite same-tenant foreign key per
tag** (decision D-03):

| Tag | Target (exact) |
|---|---|
| `DISCOVERY_EVIDENCE` | `discovery_evidence (organisation_id, evidence_id)` |
| `SOURCE_ASSERTION` | `source_assertions (organisation_id, assertion_id)` |
| `RUNTIME_OBSERVATION` | `runtime_observations (organisation_id, observation_id)` |
| `CROSS_SIGNAL_RESULT` | `cross_signal_comparison_results` exact id |
| `EXECUTION_FIELD_STATE` | `execution_field_states (organisation_id, state_id)` |
| `TECHNICAL_FIELD_STATE` | `technical_field_states` exact id |
| `LINEAGE_OBSERVATION` | `lineage_candidate_observations` exact id |
| `L14_FACT_STATE` | `l14_fact_states (organisation_id, fact_state_id)` with its subject kind |
| `RISK_SIGNAL` | L15 signal id |
| `RISK_HYPOTHESIS` | L15 hypothesis id |

Links MUST NOT copy content, resolve by mutable label, or cross tenants. Legacy `gov_repo.evidence` and LLM text are not
admissible targets. Missing evidence stays explicit (`support_status = NONE`); a human decision is never a substitute.

### 9.2. Provenance

Source class, method/version, trust, observed/recorded times and L0 source identity are preserved on signals,
hypotheses, proposals and states. There is no duplicate L0 source registry. M19 later populates `SOURCE_CONNECTION`
sources without changing this model.

---

## 10. Assessment, likelihood / impact, severity

### 10.1. RISK_ASSESSMENT family

| Property | Rule |
|---|---|
| Target | Exact current VALIDATED `GOVERNED_RISK` state id (never just target + scenario). |
| Basis | Closed `assessment_basis ∈ {INHERENT, RESIDUAL}`. |
| Logical key | `governed_risk_state_id + assessment_basis`; one current state per key. |
| Pin | Exact validated `risk_methodology_version_id` + content hash. |
| Outcome | Closed `assessment_outcome ∈ {RATED, INSUFFICIENT_EVIDENCE}`. |
| Levels | If RATED: `likelihood_level_code` and `impact_level_code`, each a member of the pinned methodology scale. If INSUFFICIENT_EVIDENCE: both absent. No default level. |
| Rating band | If RATED: DB-derived from the pinned methodology matrix (never caller-supplied). Absent otherwise. |
| Validity | Mandatory `effective_from` and `valid_until`, `valid_until > effective_from`, `valid_until − effective_from ≤` methodology maximum. Half-open `[effective_from, valid_until)`. `valid_until` IS `effective_to`. |
| Transfer | An assessment MUST NEVER transfer to a successor GOVERNED_RISK state; a new risk state starts with no current assessment. |

### 10.2. Architectural decisions on scoring

1. **Likelihood and impact are governed assessments**, not derived analytical values. Machine/graph/LLM outputs may
   be cited as support; they never become the level.
2. **No inherent risk score exists in V1.** The INHERENT assessment carries ordinal levels and a matrix-derived band;
   there is no numeric product. Multiplying ordinal levels (legacy `likelihood × impact`) is prohibited.
3. **Residual risk uses no arithmetic.** No subtraction of control effectiveness, no percentage reduction, no weighting.
   Residual risk is its own governed RESIDUAL assessment (§14).
4. **UNKNOWN** is the absence of a current valid assessment at the requested coordinates; an explicit
   `INSUFFICIENT_EVIDENCE` outcome is distinct from absence. Neither is rendered as LOW.
5. **Method/evidence pinning:** every assessment pins methodology version + hash and carries normalized evidence refs;
   reproducing the band from the pinned matrix MUST yield the stored band.
6. **Methodology versioning:** methodology changes create new immutable versions; existing assessments are not
   repinned; a revoked methodology version makes dependent assessments ineligible as current (§18).
7. **No score is authority.** A band, level, hint, confidence, exposure or count MUST NOT authorize a decision, close a
   risk, accept a risk, select a treatment, or satisfy a control. There is no aggregate organisation/agent risk score
   in V1 governed state; any numeric analytical display MUST be labeled ANALYTICAL and excluded from governed
   conclusions.

---

## 11. Closed vocabularies (separated)

| Vocabulary | Values | Nature |
|---|---|---|
| Risk domain | PRIVACY, CYBERSECURITY, AUTHORIZATION, AUTONOMY, MODEL, DATA, CONNECTIVITY, OPERATIONAL, FINOPS | Classification |
| Signal kind | §4.3 (10 values) | Evidence classification |
| Hypothesis generator kind | DETERMINISTIC_RULE, GRAPH_ANALYSIS, VECTOR_RETRIEVAL, LLM_ASSISTED, HUMAN | Provenance |
| Governed state kind | VALIDATED, REVOKED | Authoritative state |
| Governance outcome | VALIDATE, REJECT, DEFER, REVOKE (+ ADMIT for registries) | Decision |
| Assessment basis | INHERENT, RESIDUAL | Assessment |
| Assessment outcome | RATED, INSUFFICIENT_EVIDENCE | Assessment |
| Rating band | LOW, MODERATE, HIGH, CRITICAL | Severity (assessment-derived only) |
| Treatment option | MITIGATE, AVOID, TRANSFER | Treatment |
| Treatment implementation status | PLANNED, IMPLEMENTED | Treatment state attribute |
| Risk lifecycle (projection) | IDENTIFIED, ASSESSED, TREATMENT_APPROVED, TREATMENT_IMPLEMENTED, RESIDUAL_ASSESSED, RESIDUAL_ACCEPTED, CLOSED | Read projection only (§20.2) |
| Residual eligibility (projection) | CURRENT, DEPENDENCY_INVALID, EXPIRED, ABSENT | Read projection only |
| Conflict outcome (projection) | RESOLVED, CONFLICT, INSUFFICIENT_EVIDENCE | Read projection (M16 reuse) |
| Support currency (projection) | SUPPORT_CURRENT, SUPPORT_DEGRADED, SUPPORT_NONE | Read projection only |

Lifecycle is never a stored, manually edited status (contrast legacy `risk_status`). Severity never appears in a
lifecycle or governed-state vocabulary. No vocabulary extends the five trust states or M16 vocabularies.

---

## 12. Authority model

### 12.1. Who may do what

| Operation | Who | Authority basis |
|---|---|---|
| Admit signal (machine) | Bounded technical intake (detector / runtime / M15 / M16-reference adapters) | Technical capability only; no permission; no decision; cannot touch governed state. |
| Admit signal (human) | Verified ACTIVE same-tenant member | Membership only; no trust promotion. |
| Admit hypothesis | Bounded technical intake (deterministic/graph/vector/LLM generators) or verified member | Technical capability / membership only. |
| Submit GOVERNED_RISK / assessment / treatment / acceptance proposal | Verified ACTIVE same-tenant member (`LOCAL_HUMAN`), or bounded `SOURCE_CONNECTION` intake for GOVERNED_RISK only | Submission grants nothing (M16 §7.1). Machine generators MUST NOT submit proposals. |
| ADMIT / VALIDATE / REVOKE scenario definition | Decider with `L15_RISK_SCENARIO_ADMIT` / `L15_RISK_SCENARIO_VALIDATE` | Effective Authority Policy |
| ADMIT / VALIDATE / REVOKE methodology | `L15_RISK_METHODOLOGY_ADMIT` / `L15_RISK_METHODOLOGY_VALIDATE` | Effective Authority Policy |
| VALIDATE / REJECT / DEFER / REVOKE governed risk | `L15_GOVERNED_RISK_VALIDATE` | Effective Authority Policy |
| Assess (INHERENT or RESIDUAL) | `L15_RISK_ASSESSMENT_VALIDATE` | Effective Authority Policy |
| Approve / revoke treatment, record implementation | `L15_RISK_TREATMENT_VALIDATE` | Effective Authority Policy |
| Accept residual risk | `L15_RISK_ACCEPTANCE_VALIDATE` | Effective Authority Policy |
| Close risk | `L15_GOVERNED_RISK_VALIDATE` with action REVOKE | Effective Authority Policy |

### 12.2. Reuse of the M16 root of authority (decision D-01)

**Recommended (A):** extend the **single** organisation-local `L14AuthorityPolicy` with an additive, closed `L15_*`
permission namespace (the eight tags above) evaluated over the same `source class + typed target scope + Authority
Policy version` conjunction and the same closed actions. L15 permissions enter an organisation only through a normal
Authority Policy successor version validated under the currently effective policy (`L14_AUTHORITY_POLICY_ADMIN`).
There is **no L15 bootstrap** and bootstrap never reopens. The M16 `L14_*` tags, their semantics and every M16 fact
are unchanged.

This requires an explicit additive amendment of M16 ADR §6's closed permission list (and the corresponding DB CHECKs
on the rules/snapshot tables), recorded by an approved ADR amendment before M17-S0. It is not a baseline change.

Rejected alternatives: **(B)** a separate L15 Authority Policy root with its own bootstrap — creates a second root of
authority and a second bootstrap; **(C)** deriving L15 authority from existing `L14_*` permissions — prohibited by M16 §6
("a permission name alone MUST NOT imply …").

### 12.3. Typed scope

L15 permissions reuse the closed scope grammar (`ALL_ALLOWED_TARGETS`, `CANONICAL_KIND`, `CANONICAL_OBJECT`,
`RELATIONSHIP_TYPE`, `RELATIONSHIP_STATE`), evaluated against the governed risk's **subject**; for assessment,
treatment and acceptance, against the subject of the pinned governed risk state, without changing the exact pin.
V1 has **no** domain- or rating-conditioned scope (e.g. "CRITICAL acceptance needs a higher role"); that is D-09.

### 12.4. Non-authority

- `service_role` / backend technical capability ≠ business authorization (M16 §9 trust ceiling applies unchanged).
- JWT role/email is never authority; current persisted roles + effective policy govern, revalidated in the write
  transaction.
- A machine principal, detector, generator or LLM can never be the actor of an L15 governance decision. Every decision
  actor resolves to a verified ACTIVE human governance user via M16-S0.
- Self-validation (deciding one's own proposal) fails closed unless the effective policy explicitly allows it for that
  permission/action/source/scope.
- Durable DENY, DEFER non-terminal, terminal correction by new linked proposal, exact-target REVOKE intent: M16 §7.2
  verbatim.

---

## 13. M16 integration (consume, never redefine)

### 13.1. How each M16 family is consumed

| M16 fact | M17 use | Dependency behavior |
|---|---|---|
| `RESPONSIBILITY_ASSIGNMENT` | **Accountable-party projection** for a governed risk = current M16 owner of the *exact* risk subject (no inheritance). AGENT_VERSION / MODEL / TOOL / MCP_SERVER / API / relationship subjects have no M16 owner role → UNKNOWN. Treatment responsible party is a GovernanceParty reference (U06) whose validity is a pinned dependency. | Read-time only; never copied. A dedicated risk-owner role is D-04. |
| `BUSINESS_CONTEXT_ASSIGNMENT` | Impact context in read projections (domain of the exact subject). | Read-time only; never pinned; never inherited. |
| `POLICY_APPLICABILITY` | Regulatory/mandate metadata over a risk (§7.1). | Read-time only; DOES_NOT_APPLY and UNKNOWN are shown as such; never creates or closes risk. |
| `CONTROL_APPLICABILITY` | Control-coverage projection for the risk subject; treatment may name stable `control_definition_id`s. | Read-time; named control definition **version validity** is a treatment dependency. |
| `CONTROL_ASSESSMENT` | Signals (`CONTROL_ASSESSMENT_REF`) and **pinned dependencies of RESIDUAL assessments** (§14). | Pinned by exact state id; validity checked at both temporal coordinates. |

### 13.2. Rules

- M17 MUST read M16 facts only through the existing owner-only exact resolvers / bounded current reads (or an M16-
  pattern read projection composing them). M17 MUST NOT write, copy into another authority store, update, or annotate
  any M16 table or history.
- A revoked, expired, superseded, or dependency-invalid M16 state MUST NOT remain current M17 evidence silently:
  - when **pinned** (RESIDUAL assessment, treatment control-definition/party dependencies, acceptance), the dependent
    L15 state becomes ineligible as current (§18);
  - when only **cited as support** (signals, proposal support), the governed risk remains as decided, but every read
    exposes `support_currency = SUPPORT_DEGRADED` naming the exact invalid support link.
- `DOES_NOT_APPLY` control applicability MUST NOT be reported as coverage or mitigation. `NOT_ASSESSED` and absence are
  distinct and neither is SATISFIED.
- M17 adds no M16 fact family, no `CONTROL_FINDING` authority, no `WAIVED` outcome, no coverage/maturity score.

---

## 14. RESIDUAL RISK

### 14.1. Decision (D-02)

Residual risk is **(a) a governed assessment** — a `RISK_ASSESSMENT` with `assessment_basis = RESIDUAL` — whose
**current eligibility is (b) a deterministic projection** over the exact governed inputs it pins.

Pure deterministic residual computation (option b alone) is rejected for V1: no governed fact establishes how much a
SATISFIED control or IMPLEMENTED treatment reduces likelihood or impact, so any formula would manufacture risk reduction
(non-fabrication). A free numeric residual field (legacy `residual_risk_score`) is prohibited.

### 14.2. Required pins

A RESIDUAL assessment MUST pin, by exact id:

1. the GOVERNED_RISK state it assesses (current, VALIDATED);
2. the current INHERENT assessment state of that risk (VALIDATED, RATED or INSUFFICIENT_EVIDENCE, unexpired at
   `effective_from`);
3. every RISK_TREATMENT state it relies on (0..n; each VALIDATED for that risk);
4. every M16 CONTROL_ASSESSMENT state it relies on (0..n; each current valid at `effective_from`, with its
   CONTROL_APPLICABILITY APPLIES and dependency-valid);
5. the methodology version (same rules as §10.1).

Zero treatments and zero control assessments is legal: a residual assessment may record that nothing has changed.

### 14.3. Eligibility projection

At requested `(effective_at, recorded_cutoff)`, a residual assessment is `CURRENT` only if its own state is valid and
unexpired AND every pin in §14.2 is valid at the same coordinates (M16 §18.1 rule). Otherwise the projection returns
`DEPENDENCY_INVALID` (naming the first failing pin), `EXPIRED`, or `ABSENT`. Changing / revoking / expiring a control
assessment, treatment, inherent assessment or the risk state therefore changes current eligibility **without rewriting
any history** and without selecting a replacement.

---

## 15. Risk treatment

### 15.1. Roles in V1

| Concept | V1 representation |
|---|---|
| Proposed treatment | `RISK_TREATMENT` proposal (LOCAL_HUMAN). No authority. |
| Approved treatment | VALIDATED `RISK_TREATMENT` state with `implementation_status = PLANNED`. |
| Treatment implementation | Successor VALIDATED state of the same key with `implementation_status = IMPLEMENTED`, created by its own decision and supported by evidence refs. |
| Treatment evidence | Normalized evidence refs (§9) on proposal/decision/state. |
| Treatment effectiveness | **Not a field.** Expressed only through a governed RESIDUAL assessment pinning the treatment and control assessments (§14). |
| Mitigation | `treatment_option = MITIGATE`; MAY name 0..n validated control definition versions intended to mitigate. Naming a control asserts nothing about its applicability or satisfaction. |
| Transfer | `treatment_option = TRANSFER`; counterparty identity registry deferred (D-10); contract evidence via refs. |
| Avoidance | `treatment_option = AVOID`; on completion the risk is closed by an explicit REVOKE with `RISK_ELIMINATED_BY_AVOIDANCE` — never automatically. |
| Risk acceptance | Separate `RISK_ACCEPTANCE` family (§15.3), not a treatment option. |

### 15.2. RISK_TREATMENT family

Logical key: `governed_risk_state_id + treatment_option + treatment_ordinal_key` (caller-chosen stable key so several
mitigations can coexist). Pins: exact governed risk state; named control definition versions; responsible
GovernanceParty id (opaque, M16 registry). Optional `target_implementation_date` is a planning attribute, not an
effective end; "overdue" is a projection. A treatment never transfers to a successor risk state. A failed treatment is
REVOKEd with a closed reason code; there is no `verified` / `failed` status.

### 15.3. RISK_ACCEPTANCE family (D-08)

A governed decision that the organisation accepts the exact **current RESIDUAL assessment** of a governed risk for a
bounded period.

- Target: exact RESIDUAL assessment state id; logical key = that id; one current state per key.
- Mandatory `valid_until > effective_from`, bounded by the residual assessment's own `valid_until`.
- Current only while the pinned residual assessment is `CURRENT` (§14.3); residual supersession, expiry or dependency
  invalidity makes the acceptance ineligible, never transferred.
- Acceptance does not close the risk, does not alter any control assessment, does not mark coverage, and does not
  change any M16 state.

### 15.4. Legacy treatments

Legacy `risk_treatments` rows are never trusted, migrated by status copy, or used as evidence of implementation. They
MAY be re-proposed by a human with fresh support through §15.2.

### 15.5. Automated treatment

No treatment is approved, implemented or recommended into governed state by scanner, graph, vector or LLM. LLM
recommendations are hypotheses-adjacent, non-authoritative text (§21.3).

### 15.6. Waiver / exception

**Waiver / exception lifecycle remains DEFERRED.** M17 V1 MUST NOT introduce `WAIVED`, a control waiver, a policy
deviation, or any state that makes a NOT_SATISFIED control count as satisfied or a DOES_NOT_APPLY count as coverage.
RISK_ACCEPTANCE accepts a residual *risk*; it is not a control waiver, and reads MUST NOT present it as one. Legacy
`exceptions` (`risk_acceptance`, `control_waiver`) stay QUARANTINED AS AUTHORITY.

---

## 16. Supersession, cardinality, and dependency summary

| Family | Logical key | Pins (exact) | Expiry | Transfer to successor |
|---|---|---|---|---|
| GOVERNED_RISK | subject + scenario definition id | scenario version + hash | none (open-ended; optional authorized immutable `effective_to`) | n/a |
| RISK_ASSESSMENT | risk state + basis | risk state, methodology version; RESIDUAL also §14.2 | mandatory `valid_until` | never |
| RISK_TREATMENT | risk state + option + ordinal key | risk state, control definition versions, party | optional authorized immutable `effective_to` | never |
| RISK_ACCEPTANCE | residual assessment state | residual assessment state | mandatory `valid_until` | never |

Exactly **four** L15 authoritative fact families. RISK_SIGNAL and RISK_HYPOTHESIS are non-authoritative stores;
scenario and methodology are supporting registries. A fifth L15 family requires a future ADR.

---

## 17. Temporal, replay, and concurrency model

M16 §17 applies verbatim to every L15 registry and family:

- **Effective/business time** (`effective_from`, `effective_to` / `valid_until`) vs **recorded/system time**
  (DB-authored `recorded_at`). As-of reads take both coordinates; later-recorded corrections never appear in earlier
  cutoffs.
- Omitted `effective_from` = DB transaction instant. Explicit past/future values are BACKDATED / FUTURE_DATED and
  require explicit Authority Policy permission; no skew tolerance.
- Immutable history: append-only states with predecessor/revocation lineage; historical UPDATE/DELETE/TRUNCATE raises;
  no cascade; heads are RPC-maintained pointers reconstructible from history.
- Successor/revocation never edits the predecessor's stored interval; future-effective successors never prematurely
  hide the current state.
- Command identity `organisation_id + command_id`; PostgreSQL recomputes the semantic fingerprint; same payload replays
  the original durable result; changed payload → `REPLAY_CONFLICT`; durable DENY consumes the attempt.
- `expected_current_state_id` or explicit expected-none on every mutation; unique-successor and first-state guards;
  concurrent distinct commands cannot both succeed.
- Signals and hypotheses are insert-only with `recorded_at`; they have no effective interval and no successor.

## 18. Dependency invalidation

An L15 state is current/usable only if its own state AND every pinned dependency are valid at the **same** requested
effective time and recorded cutoff:

| L15 state | Pinned dependencies |
|---|---|
| GOVERNED_RISK | scenario definition version validation; subject resolution (object exists / exact relationship-state triple resolves) |
| RISK_ASSESSMENT | its risk state; methodology version validation; RESIDUAL: inherent assessment, treatments, M16 control assessments (+ their applicability and M16 dependencies) |
| RISK_TREATMENT | its risk state; named control definition versions; responsible GovernanceParty |
| RISK_ACCEPTANCE | residual assessment (and transitively its dependencies) |

Invalidation never rewrites the dependent row, never auto-selects a replacement, and keeps historical as-of readback
exact. Reads return UNKNOWN / not-current with the failing dependency named.

## 19. Conflict model

- Competing GOVERNED_RISK, assessment, treatment or acceptance proposals for the same logical key remain explicit.
- Confidence, rating, recency, source class, scanner origin, generator kind, graph exposure or LLM output MUST NOT
  select an authoritative winner. Source precedence counts only where the effective Authority Policy explicitly
  establishes it, and still requires an explicit governance decision.
- Conflict is a **read/projection outcome, not a second truth store**, reusing M16 §18.2 exactly: `RESOLVED` (the exact
  resolver returns a current governed state), `CONFLICT` (no current state and ≥ 2 distinct typed asserted contents among
  live VALIDATE-intent proposals), `INSUFFICIENT_EVIDENCE` (otherwise).
- Contradictory hypotheses are listed side by side; no hypothesis-level conflict outcome is persisted.
- Two governed risks with different scenarios on the same subject are not a conflict; "duplicate" is only a human
  REVOKE reason.

## 20. Read projections

### 20.1. Required projections (read-only, tenant-scoped, verified principal)

1. Governed risk current/as-of read with full lineage (proposal, hypotheses, signals, evidence, authz, decision, policy).
2. Assessment read (INHERENT / RESIDUAL) with methodology pin and reproduced band.
3. Residual eligibility projection (§14.3).
4. Lifecycle projection (§20.2).
5. Conflict projection (§19).
6. Support-currency projection (§13.2).
7. Control-coverage projection for a risk subject: per control definition, M16 applicability / current assessment
   outcome / UNKNOWN — categorical, no percentage or score.
8. Exposure projection (§21.1).
9. Passport risk overlay (§22).

All projections: no write, no new truth store, SECURITY DEFINER only with documented need, `search_path` pinned,
EXECUTE only for the technical reader, tenant from the verified principal.

### 20.2. Lifecycle projection

Deterministic from governed states at the requested coordinates, first match wins:

| Lifecycle | Condition |
|---|---|
| CLOSED | Latest state of the key is REVOKED |
| RESIDUAL_ACCEPTED | Current acceptance on a CURRENT residual |
| RESIDUAL_ASSESSED | CURRENT residual assessment |
| TREATMENT_IMPLEMENTED | ≥ 1 current treatment with IMPLEMENTED |
| TREATMENT_APPROVED | ≥ 1 current treatment with PLANNED |
| ASSESSED | Current INHERENT assessment |
| IDENTIFIED | VALIDATED risk, none of the above |

No stored status; no manual transition.

---

## 21. Graph / Vector / LLM boundaries

### 21.1. Graph

- Graph is projection only. M17 exposure analysis MUST use the versioned M12 governed traversal
  (`GOVIA_BLAST_RADIUS_V1`, `GOVIA_LINEAGE_*`) over canonical relationships, returning contributions labeled
  `authority: 'ANALYTICAL'` with policy version, hop count and witness path.
- Exposure output may annotate a governed risk read ("subjects reachable from this risk subject") or feed a
  `GRAPH_ANALYSIS` hypothesis. It MUST NOT create a governed risk, propagate a governed risk to another subject, change
  a rating, or be stored as authority.
- Legacy `agent_risk_propagation`, `recompute_risk_propagation`, GraphOS `propagateRisk` and the
  `/api/graph/risk/[agentId]` route are COMPATIBILITY ONLY / QUARANTINED (§23) and MUST NOT feed M17.
- No risk node or edge is added to the canonical graph; no new relationship type.

### 21.2. Vector

- Vector is derived retrieval only: finding similar signals, hypotheses, scenarios or historical risks for a human.
- Similarity MUST NOT merge, deduplicate, supersede, link, or classify governed risks, and MUST NOT select a scenario
  definition automatically. Embeddings carry model/version/fingerprint/tenant per baseline §7.

### 21.3. LLM

- MAY: explain risks and lineage; correlate signals; draft `LLM_ASSISTED` hypotheses citing existing signals;
  recommend treatments as non-authoritative text; summarize.
- MUST NOT: create, validate, reject, defer, revoke, assess, approve treatment, accept, or close any L15 state; submit
  proposals; be the actor of any decision; be stored as evidence; fill a missing level, owner, or evidence.
- No real LLM call is required to establish any M17 acceptance property; LLM boundary tests use deterministic stubs.

---

## 22. Passport impact

Risk is transversal; **there is no Passport family 17**. The 16-family taxonomy and each family's coverage status
(`KNOWN` / `PARTIAL` / `UNKNOWN`) are unchanged by M17.

M17 adds a read-only **risk overlay** attached to existing families of the exact Passport subject, never inherited:

| Risk domain | Overlay family |
|---|---|
| PRIVACY | 10 Privacy & Sensitive Data |
| DATA | 9 Data Assets + Data Elements |
| CYBERSECURITY | 8 Tools / MCP / APIs (tool/MCP/API subjects) or 7 Agent Architecture & Behavior (AGENT_VERSION) |
| AUTHORIZATION | 15 Capabilities / Permissions / Authorization |
| AUTONOMY | 7 Agent Architecture & Behavior |
| MODEL | 6 AI Model & Inference |
| CONNECTIVITY | 16 Connectivity & Network |
| OPERATIONAL | 13 Operation & Runtime |
| FINOPS | 13 Operation & Runtime |

Family 12 shows the control dependencies pinned by residual assessments (from the same M16 facts, never a copy);
family 14 shows L15 lineage. Overlay items carry: governed risk lineage, lifecycle, current INHERENT/RESIDUAL band or
UNKNOWN, acceptance validity, support currency. Hypotheses MAY be shown only in a separately labeled
"non-authoritative analysis" section. **Absence of a governed risk renders as UNKNOWN, never "no risk".** The overlay
MUST NOT create ownership or control truth; accountable party comes only from the M16 projection (§13.1).

---

## 23. Legacy disposition

No historical surface is deleted by M17. "Write-freeze" means revoking application write privileges without altering
or deleting rows (D-05).

| Surface | Disposition | Required treatment |
|---|---|---|
| `gov_repo.risk_entries` | QUARANTINED AS AUTHORITY | No M17 read as input; no promotion; recommended S0 write-freeze; consumers labeled non-authoritative. A human MAY re-propose a risk with fresh support through §6. |
| `gov_repo.risk_treatments` | QUARANTINED AS AUTHORITY | Same; the `ON DELETE CASCADE` path is neutralized by the write-freeze, not by DDL on history. |
| Enums `risk_status`, `risk_category`, `risk_treatment_type` | COMPATIBILITY ONLY | Never mapped to L15 vocabularies; no automatic conversion. |
| Score columns (`likelihood`, `impact`, `inherent_risk_score`, `residual_risk_score`, `risk_appetite`) | QUARANTINED AS AUTHORITY | Never converted to methodology levels or bands; `v_risk_heatmap` labeled legacy. |
| `related_agent_ids[]`, `related_control_ids[]` | QUARANTINED AS AUTHORITY | Never resolved to canonical subjects or control definitions automatically. |
| `owner_user_id`, `reviewer_user_id`, `responsible_id`, `approved_by`, `qes_signature_id` | QUARANTINED AS AUTHORITY | Never mapped to GovernanceParty, accountable party, or decision actor. |
| `gov_repo.evidence.risk_refs` | QUARANTINED AS AUTHORITY | Not an L15 evidence target (§9.1). |
| Scanner `DetectedRisk` | INPUT / SIGNAL ONLY | Versioned adapter → `DETECTED_PATTERN` / `DETECTED_ABSENCE` signals with snapshot, evidence and detector version; `severity` → `hint_severity`; `category` never → domain automatically; `cgagControl` informational. |
| FinOps flags / cost estimate | Flags INPUT / SIGNAL ONLY; estimate QUARANTINED | Estimated amounts never stored as cost; observed cost only from L12. |
| `agents.risk_level`, `ai_act_risk_class`, `ai_systems.*risk*` | QUARANTINED AS AUTHORITY | Never an input (no method/evidence provenance); displays labeled legacy. |
| `/api/graph/risk/[agentId]` + `agent_risk_propagation` | COMPATIBILITY ONLY (route) / QUARANTINED AS AUTHORITY (table) | Labeled legacy; replaced for M17 purposes by §21.1 exposure projection; not deleted. |
| GraphOS `propagateRisk`, `RiskNode`, `compat.ts` seeds | COMPATIBILITY ONLY | Never M17 input; demo seeds never shown as governed. |
| `exceptions`, `approval_requests` risk subjects | QUARANTINED AS AUTHORITY | Not acceptance, not treatment approval. |
| `compute_governance_score`, `getCGAGScore`, `certifySystem` | QUARANTINED AS AUTHORITY | No score feeds L15. |
| CG-AG / TRACEABILITY_MATRIX | COMPATIBILITY ONLY | May seed scenario/control-definition proposals with provenance only. |

---

## 24. Privilege and migration obligations (future, not performed here)

- Every L15 object: REVOKE ALL from `PUBLIC`, `anon`, `authenticated`, `service_role`, then grant only what is needed;
  service_role has **no** direct L15 table privilege (read or write); access only via RPCs/projections.
- Write RPCs: SECURITY DEFINER with documented need, owner-pinned, `search_path = pg_catalog, pg_temp`, fully
  qualified, EXECUTE only to the technical writer; in-RPC eligibility, authority, tenant, fingerprint, concurrency
  checks. Every new definer routine is registered in the M16 definer-capability surface inventory and postflight.
- Raising immutability triggers on all L15 history; no cascade; no maintenance-privilege erasure path.
- ACL postflight after all grants including the broad `20260818013113` defaults; per-class negative controls (table DML,
  TRUNCATE, REFERENCES/TRIGGER/MAINTAIN, sequences, routine EXECUTE, writable views, inherited/default grants).
- Additive only: no change to canonical tables, no F2 DDL, no M16 history change. The only M16-object change permitted
  is the D-01 additive permission-vocabulary widening, if approved.
- Acceptance on the PG17 security profile; M15 regression and the full M16 PG17 suite remain unchanged and green
  (except vocabulary-assertion lines explicitly amended by D-01).

---

## 25. A–O Definition of Done

| ID | Dimension | M17 obligation |
|---|---|---|
| A | CIA baseline compatibility | `GOVIA-L0L16-CIA-v1.0` unchanged; all §2 invariants preserved (§2); L15 transversal, no L17, no Passport family 17; trust vocabulary unchanged. |
| B | L0–L16 impact | **Primary:** L15. **Consumed (read-only):** L0 evidence/provenance; L3/L9 lineage; L9 canonical identity; L11 execution context; L12 runtime; L13/L16 M15 results; L14 M16 facts, registries, Authority Policy (D-01 additive). **Analytical use, no new capability:** L7/L8 vector, M12 graph. **Unaffected:** L1, L2, L4, L5, L6, L10 discovery/acquisition behavior. No upstream layer gains or loses authority. |
| C | Passport impact | No 17th family; read-only overlay on families 6–10, 12–16 per §22; family coverage status unchanged; absence = UNKNOWN. |
| D | Canonical impact | 11 kinds, 12 types unchanged; four L15 families keyed on existing identities; registries and signals/hypotheses are not canonical; F2 untouched (§§8, 16). |
| E | Lineage impact | Risk propagation lineage = exact signal → hypothesis → proposal → authz → decision → state → assessment → treatment → acceptance chain plus §9 evidence links; exposure lineage is an ANALYTICAL witness path; no new canonical edges, no inferred successors. |
| F | Evidence / provenance | Closed evidence-reference union with composite same-tenant FKs (§9); method/version on every machine output; missing evidence explicit. |
| G | Trust / authority | Five trust states unchanged; signals/hypotheses never VALIDATED; governed states only by authorized human decisions under the single Authority Policy (§12); machine ceiling PROPOSED = hypothesis. |
| H | Vector impact | Retrieval/similarity only; no merge, dedupe, classification or authority (§21.2). |
| I | Graph impact | Versioned governed traversal projection only; legacy propagation quarantined (§21.1). |
| J | LLM authority boundary | Explain / correlate / hypothesize / recommend only (§21.3). |
| K | Tenancy / security | M16-S0 verified principal; same-transaction eligibility; cross-tenant rejection for subjects, evidence, dependencies; §24 ACLs. |
| L | Migration impact | Future additive L15 migrations; optional legacy write-freeze; D-01 additive vocabulary widening; no deletion, no F2, no canonical/M16 history change (§24). |
| M | Downstream continuity | M15/M16 regressions green; M18 projects the same L15 facts (no M18-local risk truth); M19 imports enter as IMPORTED signals / SOURCE_CONNECTION proposals; M20 only real consumers. |
| N | Non-fabrication | No default levels, owners, evidence, cost amounts, residual reductions, inherited risks, legacy promotion, or "no risk" for absence (§§2, 10, 14, 23). |
| O | Acceptance / quality | O01–O72 below pass on application tests and the PG17 security harness where applicable. |

## 26. Measurable acceptance criteria (O01–O72)

Each criterion names an observable test outcome. "Rejected" means the RPC raises a stable error code and no row is
written in any L15 or M16 table.

### Boundary and vocabulary

| ID | Required result |
|---|---|
| O01 | `CANONICAL_OBJECT_KIND` has exactly 11 values and `GOVERNED_RELATIONSHIP_TYPE` exactly 12, byte-identical to `5aec0b5`; no `RISK*` value in either. |
| O02 | Zero DDL / DML on `canonical_relationships` and no unique constraint on `relationship_state_id` in any M17 migration (static migration scan + catalog check). |
| O03 | Passport family list is exactly the 16 baseline families; no family id contains `risk`; each family's `status` computed for a fixture is identical with and without L15 data. |
| O04 | The L15 domain CHECK equals exactly the nine §7.1 values; `COMPLIANCE`, `REGULATORY`, `LEGAL`, `FINANCIAL` are rejected. |
| O05 | Exactly four L15 authoritative fact families exist (catalog check over L15 state tables); a fifth subject kind is rejected. |
| O06 | Every closed vocabulary in §11 is enforced by a DB CHECK; one out-of-vocabulary value per vocabulary is rejected (14 negative cases). |
| O07 | M16 has exactly five fact families, `WAIVED` is still rejected for CONTROL_ASSESSMENT, and no M16 history row changes across the full M17 test run (row-hash comparison before/after). |

### Signals and hypotheses

| ID | Required result |
|---|---|
| O08 | A machine signal without `method_id`/`method_version`, or with zero evidence refs, is rejected. |
| O09 | A signal or hypothesis with `trust_state = VALIDATED` is rejected; a `GOVERNED_FACT_REFERENCE` signal stores no trust value. |
| O10 | A `CROSS_SIGNAL_RESULT_REF` signal referencing a `CONSISTENT` M15 result is rejected; `CONFLICT_CANDIDATE` and `INSUFFICIENT_EVIDENCE` are accepted. |
| O11 | A signal/hypothesis referencing a cross-tenant subject, evidence row, signal, or M15/M16 row is rejected (one case per evidence tag). |
| O12 | A hypothesis citing zero signals is rejected; an `LLM_ASSISTED` hypothesis without model provider/id/prompt-template version is rejected. |
| O13 | Admitting any number of signals/hypotheses (including `hint_confidence = 1.0` and `hint_severity = critical`) creates zero governance decisions, zero governed states, and zero head changes. |
| O14 | The technical intake identity cannot call any L15 propose/decide RPC (EXECUTE denied or stable rejection). |
| O15 | Signal/hypothesis tables reject UPDATE/DELETE/TRUNCATE even for the owner; identical intake replay returns the original id and `recorded_at`; changed content returns `REPLAY_CONFLICT`. |
| O16 | The scanner `DetectedRisk` adapter emits `DETECTED_PATTERN`/`DETECTED_ABSENCE` only, maps `severity` to `hint_severity` only, and produces no domain for categories `legal`, `compliance`, `financial`, `architectural` (fixture covering all 30 rule ids). |
| O17 | The FinOps adapter emits pattern-flag signals only; no L15 row contains an estimated monthly cost amount (column scan + fixture). |
| O18 | `DETECTED_ABSENCE` signals render with the literal "not detected" presentation and never set any control assessment, coverage or Passport value to negative. |

### Registries

| ID | Required result |
|---|---|
| O19 | Scenario definition and methodology versions: ADMIT creates no VALIDATED state; VALIDATE requires the matching `L15_*_VALIDATE`; content hash is recomputed by PostgreSQL and a wrong caller hash is rejected. |
| O20 | A methodology version whose rating matrix is not total over likelihood × impact levels, or whose scales have < 2 or > 7 levels, is rejected. |
| O21 | A `SYSTEM_SEED` scenario/methodology proposal cannot be validated by seeding; it needs an authorized human decision. |

### Governed risk

| ID | Required result |
|---|---|
| O22 | GOVERNED_RISK VALIDATE succeeds only via proposal → authorization (ALLOW, current `L15_GOVERNED_RISK_VALIDATE`) → decision → state → head, with every id traceable in one read. |
| O23 | REJECT, DEFER and DENY create no GOVERNED_RISK state; DENY is durable, replayable and consumes the command id. |
| O24 | A GOVERNED_RISK proposal submitted by the technical intake identity, by `SYSTEM_SEED`, or citing only machine provenance without a human submitter is rejected. |
| O25 | Each illegal domain × subject pairing of §8.2 is rejected (exhaustive matrix test over 9 domains × 8 object kinds × 12 relationship types). |
| O26 | A relationship-state subject resolves only by the exact org + relationship_id + relationship_state_id triple; a wrong-tenant or mismatched triple is rejected. |
| O27 | A risk on AGENT is not returned for its AGENT_VERSION, a risk on DATA_ASSET not for its DATA_ELEMENT, a risk on an object not for its relationships, and a risk on AGENT_VERSION v1 not for v2. |
| O28 | GOVERNED_RISK immutable records contain no free-text title/description/rationale columns (catalog check); unknown `reason_code` is rejected. |
| O29 | A risk is closed only by REVOKE on its exact current state; no other RPC, expiry, band, treatment, acceptance or projection changes a risk's latest state kind. |
| O30 | Superseding the pinned scenario version does not repin existing risks; revoking it makes the risk not current at both coordinates without row mutation. |

### Assessment and scoring

| ID | Required result |
|---|---|
| O31 | No L15 table contains a numeric score, product, percentage or weight column (catalog check: no column named `*score*`, `*weight*`, `*percent*`, `*product*`; the only numeric columns are methodology scale `ordinal` values). |
| O32 | The stored rating band equals the pinned methodology matrix lookup for every assessment in the suite; a caller-supplied band is rejected. |
| O33 | A RATED assessment with a level not in the pinned scale, or an INSUFFICIENT_EVIDENCE assessment with levels, is rejected. |
| O34 | Assessment requires `valid_until > effective_from` and `≤` methodology maximum; at `valid_until` it is no longer current without any row UPDATE. |
| O35 | An assessment never transfers to a successor GOVERNED_RISK state; after supersession the new state has no current assessment. |
| O36 | With no current assessment the read returns UNKNOWN (not LOW, not null-as-zero); INSUFFICIENT_EVIDENCE is returned distinctly. |
| O37 | No combination of band, hint, confidence, exposure or count changes authorization result, risk state, acceptance or treatment state (property test over generated inputs: zero governed-state deltas). |

### M16 integration and residual risk

| ID | Required result |
|---|---|
| O38 | L15 code reads M16 only through the existing owner-only resolvers/current reads; static scan finds no L15 INSERT/UPDATE/DELETE on any `l14_*` table other than D-01 authorization-ledger use, and service_role still has no L14 table privilege. |
| O39 | A RESIDUAL assessment missing the INHERENT pin, or pinning a non-current inherent assessment, a treatment of another risk, or a CONTROL_ASSESSMENT not current at `effective_from`, is rejected. |
| O40 | Revoking, expiring, or superseding each pinned dependency type (risk state, inherent assessment, treatment, control assessment, control applicability, methodology version) flips residual eligibility to `DEPENDENCY_INVALID`/`EXPIRED` at both coordinates, names the failing pin, and mutates no row. |
| O41 | Historical as-of readback at a recorded cutoff before the invalidation still returns `CURRENT` for the same residual assessment. |
| O42 | No replacement control assessment, treatment or inherent assessment is auto-selected after invalidation. |
| O43 | A `DOES_NOT_APPLY` control applicability or a `NOT_ASSESSED` assessment never appears as coverage or mitigation in the control-coverage projection. |
| O44 | A governed risk whose cited M16 support becomes invalid stays VALIDATED but every read returns `support_currency = SUPPORT_DEGRADED` naming the link; never silently current. |
| O45 | Accountable party for an AGENT/DATA_ASSET/DATA_ELEMENT subject equals the current M16 owner of the exact subject; for every other subject kind it is UNKNOWN; no inheritance from AGENT to AGENT_VERSION. |

### Treatment and acceptance

| ID | Required result |
|---|---|
| O46 | Treatment option outside MITIGATE / AVOID / TRANSFER, or status outside PLANNED / IMPLEMENTED, is rejected; `WAIVED`, `ACCEPT`, `verified`, `failed` are rejected. |
| O47 | PLANNED → IMPLEMENTED is a new VALIDATED state with its own decision and evidence refs; the predecessor is byte-identical. |
| O48 | A treatment naming a revoked control-definition version or invalid GovernanceParty is not current; MITIGATE naming a control creates no M16 applicability or assessment. |
| O49 | RISK_ACCEPTANCE targets only a CURRENT RESIDUAL assessment; INHERENT targets, expired, or dependency-invalid residuals are rejected. |
| O50 | Acceptance requires `valid_until > effective_from` and `≤` residual `valid_until`; it becomes not current on residual supersession/expiry/invalidity without row mutation. |
| O51 | Acceptance does not change the risk state, any treatment, any M16 state, or the control-coverage projection (before/after equality). |
| O52 | No L15 or legacy-facing read presents an acceptance as a waiver; no `WAIVED` / waiver / exception value exists in any L15 vocabulary. |

### Authority, tenancy, security

| ID | Required result |
|---|---|
| O53 | Each `L15_*` permission authorizes only its own subject kind/actions; a `L14_*` permission alone never authorizes an L15 action, and an `L15_*` permission never authorizes an L14 action. |
| O54 | Unknown L15 permission/action/scope tags are rejected; legacy wildcard role permissions do not expand L15 permissions. |
| O55 | No L15 bootstrap exists: in an organisation whose effective Authority Policy has no `L15_*` rule, every L15 decision is a durable DENY. |
| O56 | Self-validation of an L15 proposal fails closed unless the effective policy explicitly allows it for that permission/action/source/scope. |
| O57 | Role revocation, membership change, user/org deactivation, or Authority Policy succession concurrent with an L15 commit makes the commit fail (concurrency harness). |
| O58 | Header/body/path-supplied tenant or actor is ignored; all L15 RPCs derive tenant/actor from the verified principal (`l14_session_basis_v1`). |
| O59 | service_role has zero direct privileges on every L15 table (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN), sequences, and non-granted routines after the broad-grant prerequisite. |
| O60 | ACL checker detects one rolled-back negative control per privilege class over L15 objects. |
| O61 | Every new L15 SECURITY DEFINER routine is recorded in the definer-surface inventory with owner, hash and `search_path`; the postflight fails if one is missing. |
| O62 | L15 history tables raise on UPDATE/DELETE/TRUNCATE for the owner; no FK cascade reaches L15 history. |

### Temporal and replay

| ID | Required result |
|---|---|
| O63 | Omitted `effective_from` = DB transaction instant; explicit past/future without permission is rejected; with permission it does not rewrite history. |
| O64 | Bitemporal as-of matrix: for each family, (effective, recorded) reads before/after supersession, revocation and expiry return the expected state. |
| O65 | Identical replay returns the original durable result including `recorded_at` and ids; changed payload → `REPLAY_CONFLICT`; wrong caller fingerprint rejected. |
| O66 | Stale `expected_current_state_id` is rejected; concurrent distinct commands on one key cannot both succeed. |

### Projections, Graph, Vector, LLM

| ID | Required result |
|---|---|
| O67 | Conflict projection returns exactly RESOLVED / CONFLICT / INSUFFICIENT_EVIDENCE on fixtures, persists nothing, and is unaffected by confidence, recency, source class or generator kind of competing proposals. |
| O68 | Lifecycle projection returns the §20.2 value for each of the seven fixture states; no lifecycle column exists. |
| O69 | Exposure projection uses only versioned governed traversal policies; every contribution carries `authority = ANALYTICAL`; running it writes zero rows anywhere; legacy `agent_risk_propagation` is never read by L15 code (static scan). |
| O70 | Vector retrieval over risks/hypotheses writes zero L15 rows and never changes subject, scenario, state or link. |
| O71 | An LLM stub returning "validated"/"accepted"/"closed" text causes zero L15 state changes; LLM output cannot be stored as an evidence target. |
| O72 | Passport overlay for a subject without a governed risk renders UNKNOWN; hypotheses appear only in the labeled non-authoritative section; legacy `risk_level`/`risk_entries` values never appear in the overlay. M15 PostgreSQL regression and the full M16 PG17 suite pass unchanged (except D-01-amended vocabulary assertions). |

---

## 27. Open decisions (owner / ACP)

| ID | Decision | Recommendation | Blocks |
|---|---|---|---|
| D-01 | Authority root for L15 | Additive `L15_*` permission namespace on the single L14 Authority Policy + reuse of authorization/decision/command ledgers; explicit amendment of M16 ADR §6 closed list (§12.2). | S0 |
| D-02 | Residual risk semantics | Governed RESIDUAL assessment + deterministic eligibility projection (§14). | S6 |
| D-03 | Evidence reference model | L15-owned closed tagged union with composite same-tenant FKs (§9.1); M16 `l14_support_links` unchanged. | S1 |
| D-04 | Risk owner | V1: accountable-party projection from exact M16 responsibility; no new role (would amend M16 §11 matrix). Revisit post-V1. | S7 |
| D-05 | Legacy risk tables | S0 write-freeze (revoke application DML; keep rows, no DDL on history); label legacy consumers. | S0 |
| D-06 | Domain cardinality / regulatory | Exactly one domain per scenario; regulatory as M16 policy-applicability metadata only; no auto-mapping of legacy categories. | S2 |
| D-07 | Domain × subject matrix | Approve §8.2 as the closed V1 matrix. | S3 |
| D-08 | RISK_ACCEPTANCE in V1 | Include, bounded and time-boxed, not a waiver (§15.3). Alternative: defer with waiver/exception. | S6 |
| D-09 | Rating-conditioned authority | Deferred; V1 scope grammar unchanged. | — |
| D-10 | TRANSFER counterparty identity | Deferred; evidence refs only in V1. | — |
| D-11 | Default methodology | Optional `SYSTEM_SEED` 5 × 5 ordinal proposal requiring human validation. | S2 |
| D-12 | Legacy scan-route `risk_level` writer (inventory F-02) | Out of M17 implementation scope unless ACP assigns it; M17 requires only labeling + non-consumption (O72). | — |

No decision above contradicts the frozen baseline. D-01 amends a frozen M16 closed vocabulary additively and therefore
requires explicit owner approval before S0; it does not change any M16 fact, history, or semantics.

## 28. Implementation slicing (proposal; not implemented)

| Slice | Content | Depends on | Closes |
|---|---|---|---|
| **S0 — Authority / security / root contracts** | D-01 ADR amendment + additive `L15_*` permission vocabulary; L15 subject kinds in authorization/decision ledgers; closed L15 vocabularies in `canonical-contracts` (types only); L15 privilege/ACL harness profile + negative controls; legacy risk write-freeze and non-authoritative labeling (D-05). | ADR acceptance, D-01, D-05 | O01–O07, O53–O62 (framework) |
| **S1 — Signals + hypotheses** | Closed evidence-reference union (D-03); signal and hypothesis stores + intake RPCs; adapters: scanner DetectedRisk, FinOps flags, M15 result, L12 runtime, L11 execution, M16 control-assessment / governance-gap references; disposition projection. | S0 | O08–O18 |
| **S2 — Scenario + methodology registries** | RISK_SCENARIO_DEFINITION and RISK_METHODOLOGY with immutable DB-hashed versions, ADMIT/VALIDATE/REVOKE; optional seeds (D-11). | S0 | O19–O21 |
| **S3 — GOVERNED_RISK** | Proposal → authz → decision → state → head; domain × subject matrix; exact subject resolution; REVOKE closure; support-currency projection. | S1, S2 | O22–O30, O44 |
| **S4 — INHERENT assessment** | RISK_ASSESSMENT family with basis INHERENT; methodology pin; DB-derived band; expiry. | S3 | O31–O37 |
| **S5 — Treatment** | RISK_TREATMENT family (MITIGATE/AVOID/TRANSFER, PLANNED/IMPLEMENTED), control-definition and party dependencies. | S3 | O46–O48 |
| **S6 — Residual + acceptance** | RESIDUAL basis with §14.2 pins and eligibility projection; RISK_ACCEPTANCE (D-08). | S4, S5 | O38–O43, O49–O52 |
| **S7 — Read projections** | Lifecycle, conflict, control-coverage, accountable party, exposure (M12 traversal), vector retrieval boundary, LLM boundary stubs, Passport overlay. | S3–S6 | O45, O63–O72 |
| **Closure** | Formal O01–O72 verification on merged main. | S0–S7 | All |

S4 and S5 are independent after S3 and may proceed in either order. No slice introduces a canonical kind, relationship
type, Passport family, M16 fact change, or F2 change. M18 and M19 are not started by any slice.

## 29. Approval boundary

This ADR is **DRAFT**. It does not authorize implementation, does not amend the frozen baseline, does not amend the M16
ADR (D-01 only *proposes* an amendment), and creates or runs no migration. Implementation MUST NOT start before ACP /
owner acceptance of this ADR and of the decisions it blocks on. Hosted environments are not touched.
