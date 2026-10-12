# M17 — Risk Intelligence V1: current-state inventory

Repository `cnegrao/code-guard-governance`. Canonical `main` inspected:
`5aec0b500cb16b0e3ce67376629ffa68cf2e6186` (merge of PR #63, M16 formal closure), verified equal to the expected SHA.
Branch `docs/m17-risk-intelligence-architecture` created from exactly that commit.

This is a **documentation-only** inventory supporting
[`ADR-GOVIA-RISK-INTELLIGENCE-v1.md`](../../architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md) (status **ACCEPTED / FROZEN**
after the final architecture revision) and the additive
[`ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md`](../../architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md)
(ACCEPTED / FROZEN; owner-approved D-01, 2026-10-12). No runtime,
application, migration, test or hosted change is made. M17 implementation is **NOT STARTED**. Hosted (Supabase / Vercel /
deployment) is **NOT TOUCHED**.

## 1. Method

Every surface below was read on `5aec0b5` (no inference from slice narrative alone):

- `rg -i risk` over `supabase/migrations/`, `apps/dashboard/`, `packages/`, `TRACEABILITY_MATRIX.md`;
- the defining migration of each legacy risk object (tables, enums, indexes, triggers, RLS policies, views, functions);
- every application consumer of `risk_entries`, `risk_treatments`, `risk_refs`, `agent_risk_propagation`,
  `recompute_risk_propagation`, `risk_level`, `DetectedRisk`, `FinOpsResult`;
- the merged M15 and M16 ADRs, their persistence migrations, and the M16 closure evidence
  (`2026-10-12-m16-closure.md`, O01–O55 = 55 / 55 PASS).

## 2. Classification vocabulary

Exactly one classification per surface:

| Classification | Meaning for M17 |
|---|---|
| `REUSE` | Consumed as-is by exact reference; no change required by M17. |
| `REUSE + HARDEN` | Consumed, but M17 requires an explicit, ADR-recorded additive change before use. |
| `INPUT / SIGNAL ONLY` | May feed a non-authoritative `RISK_SIGNAL` through a versioned adapter with evidence/provenance; never governed risk. |
| `PROJECTION ONLY` | Derived analytical read surface; no authority, no write-back. |
| `COMPATIBILITY ONLY` | Retained for existing consumers/history; MUST be labeled non-authoritative; never an M17 input. |
| `QUARANTINED AS AUTHORITY` | MUST NOT authorize, settle, seed or be promoted into any M17 governed state; retained, not deleted. |
| `DEFERRED` | Outside M17 V1; no M17 consumer. |

## 3. Legacy risk persistence (`gov_repo`)

Defining migrations: `20260818003539_gov_repo_types_and_organisations.sql` (enums),
`20260818003822_gov_repo_policies_risks_evidence_part_2.sql` (tables, indexes, triggers, RLS),
`20260818003944_gov_repo_workflows_assessments_views_part_3.sql` (views / score),
`20260818003900_gov_repo_workflows_assessments_views_part_1.sql` (approvals / exceptions).
No M16 migration altered any of these objects. `rg` finds **no application (TypeScript) reader or writer** of
`risk_entries`, `risk_treatments`, `risk_refs`, `v_risk_heatmap` on main.

| # | Surface | Observed on main | Classification |
|---|---|---|---|
| L01 | `gov_repo.risk_entries` | Mutable register row (`updated_at` trigger, no history, no proposal/decision lineage); `UNIQUE(risk_code, organisation_id)`; free-text `title`/`description`; `ledger_entry_seq` optional. | **QUARANTINED AS AUTHORITY** |
| L02 | `gov_repo.risk_treatments` | Mutable treatment row; `risk_id … ON DELETE CASCADE` (history-erasure path); free-text `treatment_plan`; status `planned/in_progress/implemented/verified/failed`; `approved_by`, `approval_date`, `qes_signature_id`. | **QUARANTINED AS AUTHORITY** |
| L03 | Enums `risk_status` (`identified … escalated`), `risk_category` (`operational, compliance, reputational, strategic, financial, legal, technology, third_party`), `risk_treatment_type` (`mitigate, accept, transfer, avoid, share`) | Legacy vocabularies; none matches the baseline L15 domain list. | **COMPATIBILITY ONLY** |
| L04 | Indexes `idx_risk_entries_{org,status,score,agents,controls,owner}`, `idx_risk_treatments_{risk,status}`; triggers `trg_risk_entries_updated_at`, `trg_risk_treatments_updated_at` | Support mutable in-place update; `idx_risk_entries_score` orders by the legacy product score. | **COMPATIBILITY ONLY** |
| L05 | RLS on both tables | `"Service role has full access …" FOR ALL TO service_role USING (true)`; authenticated `SELECT` keyed by `governance_users.email = auth.email()` (not the M16 verified principal). Broad `20260818013113` grants still apply. | **COMPATIBILITY ONLY** (finding F-01) |
| L06 | Score columns `likelihood 1–5`, `impact 1–5`, `inherent_risk_score GENERATED (likelihood × impact)`, `residual_risk_score 1–25`, `risk_appetite` | Manually entered integers; ordinal × ordinal product; residual is a free integer with no lineage to controls/treatments. | **QUARANTINED AS AUTHORITY** |
| L07 | `related_agent_ids uuid[]`, `related_control_ids varchar(12)[]` | Unconstrained arrays of legacy `agents.agent_id` / CG-AG codes; no canonical identity, no FK, no tenant check. | **QUARANTINED AS AUTHORITY** |
| L08 | `owner_user_id`, `reviewer_user_id`, `risk_treatments.responsible_id`, `approved_by`, `qes_signature_id` | Direct `governance_users` references (PII-bearing identity), not GovernanceParty; approval not bound to an authorization decision. | **QUARANTINED AS AUTHORITY** |
| L09 | `ai_act_annex_ref`, `dora_chapter_ref` | Free-text regulatory labels. | **COMPATIBILITY ONLY** |
| L10 | `gov_repo.evidence.risk_refs uuid[]` + `idx_evidence_risks` | Legacy evidence → legacy risk array; no reverse integrity. | **QUARANTINED AS AUTHORITY** |
| L11 | `gov_repo.v_risk_heatmap` | Groups `risk_entries` by likelihood × impact; hard-coded bands (≥20 critical, ≥12 high, ≥6 medium). | **COMPATIBILITY ONLY** |
| L12 | `gov_repo.compute_governance_score()` (`risk_calc`) | Counts `risk_entries.status IN (treated, monitored, accepted, closed)` as a percentage into an A–F grade; already a CLOSED_SURFACE in the M16 definer-capability postflight. | **QUARANTINED AS AUTHORITY** |
| L13 | `gov_repo.exceptions` (`exception_type` incl. `risk_acceptance`, `control_waiver`) | Legacy exception / waiver / risk-acceptance surface; M16 §19 already quarantined it. | **QUARANTINED AS AUTHORITY** |
| L14 | `gov_repo.approval_requests.subject_type` incl. `risk_treatment`, `risk_acceptance` | Generic approval workflow; M16 §19 quarantined. | **QUARANTINED AS AUTHORITY** |
| L15 | `gov_repo.agents.risk_level` (`agent_risk_level` enum), `agents.ai_act_risk_class` | Legacy agent registry columns, written by the discovery scan route from scanner heuristics (finding F-02); aggregated by dashboard/reports. | **QUARANTINED AS AUTHORITY** |
| L16 | `gov_repo.ai_systems.risk_class`, `residual_risk_level`, `cg_sys_003_risk_classified`, `cg_sys_005_risk_mgmt`, `v_ai_system_risk_posture`, `v_ai_act_high_risk_dashboard` | AI-system register (AI_SYSTEM is not a CanonicalObjectKind); free residual level with no lineage. | **QUARANTINED AS AUTHORITY** |
| L17 | `gov_repo.third_party_providers.concentration_risk_score` | Legacy DORA third-party score; no canonical binding. | **DEFERRED** |
| L18 | `gov_repo.agent_risk_propagation` + `set_propagation_criticality` trigger + `recompute_risk_propagation()` + views `v_risk_propagation_chains`, `v_ciso_agent_risk_lens` | Pre-computed `impact_score = source risk × edge-weight product` over legacy `agents`/`agent_edges`; criticality auto-derived by trigger; M16-S1B.2R1 confined the routine to the NOLOGIN `govia_legacy_graph_executor`. | **QUARANTINED AS AUTHORITY** |
| L19 | `gov_repo.mandates` / hardened policy-mandate mapping (CG-AG references) | Regulatory requirement ↔ control-code mapping; M16 reuse+harden for policy. | **REUSE** (metadata reference only; never a risk source) |
| L20 | `governance_policies.policy_type = 'risk'`, `L14_POLICY_TYPES` | Policy category label. | **REUSE** (metadata only) |
| L21 | Legacy `gov_repo.evidence` table (other than `risk_refs`) | Legacy, mutable evidence register; not the M16 support anchor. | **COMPATIBILITY ONLY** |
| L22 | `gov_repo.ict_incidents*` | DORA incident register; no canonical binding to the 11 kinds. | **DEFERRED** |

## 4. Scanner / discovery

| # | Surface | Observed on main | Classification |
|---|---|---|---|
| S01 | `packages/scanner/src/core/risk-detector.ts` `detectRisks()` → `DetectedRisk` | 30 hard-coded heuristics (`RISK-NO-LICENSE` … `RISK-NO-BIAS-TESTING`); `severity` label; `category ∈ {security, compliance, legal, operational, financial, architectural}`; optional `file`/`line`; **no evidence id, no detector version, no source snapshot**; many rules assert **absence** of a detected artifact (no README/tests/DPO/DR plan). | **INPUT / SIGNAL ONLY** |
| S02 | `DetectedRisk.cgagControl` + `getCGAGControlByRisk()` | Static risk → CG-AG code lookup. | **COMPATIBILITY ONLY** |
| S03 | `getCGAGScore()` / `isCGAGImplemented()` (`cg-ag-controls.ts`) | Percentage over `cg_*` flags. | **QUARANTINED AS AUTHORITY** |
| S04 | `certifySystem()` (`core/certification.ts`) | Bronze/silver/gold certification derived from `DetectedRisk` severities and file-name heuristics. | **QUARANTINED AS AUTHORITY** |
| S05 | FinOps enrichment pattern flags (`nPlusOneDetected`, `missingTimeout`, `missingRateLimit`, `missingCircuitBreaker`, `expensiveScans`, `costHotspots`) | Regex detections over source text. | **INPUT / SIGNAL ONLY** |
| S06 | FinOps `monthlyCostEstimate`, `breakdown[].estimatedMonthly`, `costRisk` | Computed from **assumed** `expectedDailyCalls` and fixed unit prices — an estimate, not an observation (finding F-03). | **QUARANTINED AS AUTHORITY** |
| S07 | Codeguard heuristics `suggestedRiskLevel`, `classification.aiActRiskClass`, `crossFileLineage.riskLevel`, enrichment `complianceExposure` | Unversioned heuristic labels. | **INPUT / SIGNAL ONLY** (only through a versioned adapter that supplies method/evidence; the labels themselves are never a risk level) |
| S08 | `apps/dashboard/app/api/discovery/scan/route.ts` insert into legacy `agents.risk_level` / `ai_act_risk_class` (incl. `?? "limited"` fallback) and ledger payload `risk_level` | Persists S07 heuristics directly into a legacy register column read by dashboards (findings F-02, F-10). | **QUARANTINED AS AUTHORITY** (new writes stopped in M17-S0, D-12) |
| S09 | Governed discovery machine (`DiscoveryFinding`, PROPOSE worker, `discovery_evidence`, `source_assertions`, `acquisition_runs`) | Tenant-scoped immutable L0 evidence and provenance; machine ceiling = PROPOSED. | **REUSE** (evidence / provenance anchor) |

## 5. Graph / GraphOS / API / UI

| # | Surface | Observed on main | Classification |
|---|---|---|---|
| G01 | `apps/dashboard/app/api/graph/risk/[agentId]/route.ts` | Verified-principal gated; returns legacy `agent_risk_propagation` rows for a legacy `agent_id`. | **COMPATIBILITY ONLY** |
| G02 | `services/graph.ts`, `repositories/graph.ts` (`getRiskPropagation`, `recomputePropagation`), `repositories/agents.ts` (`getAgentRiskPropagation`) | Read L18; `recomputePropagation` executes the confined legacy routine. | **COMPATIBILITY ONLY** |
| G03 | `packages/graphos/src/engine.ts` `propagateRisk()`, `RiskNode`, `IMPACTS_RISK`, summary `criticalRisks` / `highRiskAgents` | Unversioned BFS with fixed 40 %/hop decay floored at 5, over legacy entity kinds. | **COMPATIBILITY ONLY** |
| G04 | `packages/graphos/src/compat.ts` seeded demo `risk-00x` entities | Demo fixtures. | **COMPATIBILITY ONLY** (MUST never render as governed risk) |
| G05 | `packages/graphos/src/governed/traversal.ts` `GOVIA_BLAST_RADIUS_V1`, `GOVIA_LINEAGE_*` | M12 governed projection over canonical relationships; contributions carry `authority: 'ANALYTICAL'` and the traversal policy version. | **PROJECTION ONLY** |
| G06 | `packages/graphos/src/governed/retrieval.ts` (hybrid graph + vector retrieval) | M12 explainable retrieval. | **PROJECTION ONLY** |
| G07 | `services/knowledge-graph.ts` overlays (`lineageRiskLevel`, `costRisk`, high-risk agent highlighting) | Reads L15/L16 legacy columns and S06/S07 labels. | **COMPATIBILITY ONLY** |
| G08 | Dashboard/report aggregates: `repositories/dashboard.ts` (`highRiskAgents`, `highRiskSystems`, `riskDistribution`), `repositories/reports.ts` (`byRisk`, `highRisk`), agent detail "Risk Level" badge, search `risk_level`, agents API `?risk=` filter | Present legacy L15/L16 values as risk. | **COMPATIBILITY ONLY** (MUST be labeled non-authoritative per M16 §19) |
| G09 | `lib/governance/agent-passport.ts` (16 families; no risk family) + M16 `l14_read_passport_governance_v1` | Passport families 3/4/12/14 consume M16 facts for AGENT (and AGENT_VERSION for 12). | **REUSE + HARDEN** (M17 risk overlay, no 17th family) |
| G10 | `packages/canonical-contracts` AgentVersion rule ("owner, status, **risk**, controls, waivers … MUST NOT create a version") | Confirms governed risk never creates an AgentVersion. | **REUSE** |
| G12 | Human legacy registry writes: `components/agents/AgentForm.tsx` (defaults `risk_level: "medium"`, `ai_act_risk_class: "minimal"`), `repositories/agents.ts` create/update, `lib/validation.ts` enums | Human entry into the legacy register; not a scanner/discovery write. | **COMPATIBILITY ONLY** (labeled `LEGACY / NON-AUTHORITATIVE`; never consumed by M17) |
| G11 | `apps/extension` scanners (`owasp.ts`, `gdpr.ts`, `ai_act_preview.ts`, `intelligence/ril.ts`) | IDE-local analysis; no governed intake path. | **DEFERRED** |

## 6. Controls / traceability

| # | Surface | Observed on main | Classification |
|---|---|---|---|
| C01 | `TRACEABILITY_MATRIX.md` (CG-AG-001 … 012 × EU AI Act / DORA / ISO 42001 / NIST AI RMF / ISO 27001) | Static mapping; evidence anchored on legacy `agents` columns and `cg_*` flags. | **COMPATIBILITY ONLY** (may seed scenario/control-definition *proposals* with provenance) |
| C02 | `cg_ag_*` / `cg_sys_*` boolean flags and their triggers | M16 §14/§19: not authority. | **QUARANTINED AS AUTHORITY** |

## 7. Upstream governed and evidence inputs available to M17

| # | Surface | Observed on main | Classification |
|---|---|---|---|
| U01 | M16 `RESPONSIBILITY_ASSIGNMENT` (`l14_responsibility_assignment_*`, `_valid_state_v1`, `_current_v1`) | Owner-only bitemporal resolvers; dependency validity per M16 §18.1. | **REUSE** |
| U02 | M16 `BUSINESS_CONTEXT_ASSIGNMENT` | Same pattern. | **REUSE** |
| U03 | M16 `POLICY_APPLICABILITY` | Pins org + policy + version + DB hash; APPLIES / DOES_NOT_APPLY; absence = UNKNOWN. | **REUSE** |
| U04 | M16 `CONTROL_APPLICABILITY` | Pins exact validated control-definition version. | **REUSE** |
| U05 | M16 `CONTROL_ASSESSMENT` (`l14_control_assessment_states`, `_valid_state_v1(uuid,uuid,ts,ts)`) | Exactly SATISFIED / PARTIALLY_SATISFIED / NOT_SATISFIED / NOT_ASSESSED / INSUFFICIENT_EVIDENCE; mandatory `valid_until`; never transfers across applicability states; WAIVED rejected. | **REUSE** |
| U06 | M16 registries: GovernanceParty, BusinessDomain, InformationDomain, ControlDefinition + versions, PolicyVersion validation | Governed, immutable, dependency-checked. | **REUSE** |
| U07 | M16 read projections `l14_read_passport_governance_v1`, `l14_read_fact_conflict_v1` | Read-only tenant-scoped SECURITY DEFINER; conflict outcomes RESOLVED / CONFLICT / INSUFFICIENT_EVIDENCE. | **REUSE** (data + pattern) |
| U08 | M16 Authority Policy + shared governance envelope (`l14_authority_policy_rules`, `l14_authorization_decisions` + `l14_authorization_decision_rules`, `l14_proposals`, `l14_governance_decisions`, `l14_command_results`) | Single org-local policy; closed CHECKs: 15 `L14_*` permissions; 11 subject kinds on the four envelope tables; reason code = one per subject × outcome (44 codes); 3 shared + 6 registry command kinds. `l14_fact_states` admits exactly the five M16 families. | **REUSE + HARDEN** (owner-approved D-01 additive amendment; `l14_fact_states` NOT widened) |
| U09 | M16 `l14_support_links` | Evidence FK **only** to `gov_repo.discovery_evidence`. | **REUSE** (pattern only; M17 needs its own closed evidence-reference union — D-03) |
| U10 | M16-S0 verified governance principal + `l14_session_basis_v1` transactional eligibility | Verified claims, 8 h max age, credential epoch, same-transaction revalidation. | **REUSE** |
| U11 | M15 `cross_signal_comparison_results` + `cross_signal_comparison_left_relationship_states` | Immutable; V1 reachable outcomes CONSISTENT / CONFLICT_CANDIDATE / INSUFFICIENT_EVIDENCE; **DRIFT_CANDIDATE is never emitted in V1**; M15 ADR §16 names M17 as a consumer of CONFLICT_CANDIDATE as one risk-hypothesis input. | **INPUT / SIGNAL ONLY** |
| U12 | L12 `runtime_observations` (M14) | OBSERVED runtime facts with exact AGENT_VERSION / target binding states. | **INPUT / SIGNAL ONLY** |
| U13 | L11 `execution_field_states` / execution context (M13) | Governed execution principal / grant / environment / egress facts. | **INPUT / SIGNAL ONLY** |
| U14 | L9 `canonical_objects`, `canonical_relationships` (exact `organisation_id + relationship_id + relationship_state_id`) | Canonical identity; F2 deferred. | **REUSE** (target identity only; F2 untouched) |
| U15 | L3/L9 `lineage_candidate_observations`, `technical_field_states` | Lineage / technical facts with evidence. | **INPUT / SIGNAL ONLY** |
| U16 | L7/L8 `semantic_representations` (+ assertions/evidence) | Derived vectors; no identity. | **PROJECTION ONLY** |

## 8. Findings

| ID | Finding | Consequence for M17 |
|---|---|---|
| F-01 | `risk_entries` / `risk_treatments` keep `service_role FOR ALL USING (true)` plus broad default grants, email-keyed authenticated SELECT, mutable rows, and a cascade delete from risk to treatment. | Cannot be an authority store; ADR §16 recommends a write-freeze (no deletion) in M17-S0 (decision D-05). |
| F-02 | The discovery scan route writes scanner heuristics into legacy `agents.risk_level` / `ai_act_risk_class`; dashboards and reports aggregate them as "risk". | Legacy machine labels are presented as risk without provenance. M17 MUST NOT read them; consumers MUST be labeled non-authoritative (M16 §19). Remediation of the writer is out of this documentation slice. |
| F-03 | FinOps `monthlyCostEstimate` is computed from assumed call volumes. | Presenting it as cost would fabricate evidence. Only pattern flags may become signals; cost amounts come only from L12 OBSERVED runtime facts. |
| F-04 | Two unversioned propagation heuristics exist (`agent_risk_propagation` SQL product, GraphOS `propagateRisk` 40 % decay) alongside the versioned M12 `GOVIA_BLAST_RADIUS_V1`. | Only the versioned governed traversal may serve M17 exposure projection. |
| F-05 | `l14_support_links` can reference only `discovery_evidence`. | Runtime, M15, L11 and M16-fact evidence cannot be linked by it; M17 needs a closed typed evidence-reference union (D-03). |
| F-06 | M15 V1 emits no `DRIFT_CANDIDATE`. | L16 "risk-impacting change" input to M17 V1 is limited to `CONFLICT_CANDIDATE` / `INSUFFICIENT_EVIDENCE` references. |
| F-07 | The M16 Passport projection resolves AGENT (families 3, 4, 12) and AGENT_VERSION (family 12) only. | The M17 Passport risk overlay needs its own read projection; it MUST NOT widen the M16 projection. |
| F-08 | `DetectedRisk` carries no evidence id / detector version and many rules are absence heuristics. | Signal adapter MUST require snapshot + evidence + detector version, and MUST label absence-of-detected-artifact signals as such (`UNKNOWN != FALSE`). |
| F-09 | The Authority Policy permission vocabulary is a closed CHECK of 15 `L14_*` tags (M16 ADR §6, O44), and the shared envelope subject vocabularies are closed to 11 M16 subjects. | Resolved: owner-approved D-01 additive amendment (`ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1`) widens permissions (+8), envelope subject kinds (+6), envelope reason codes (+24 by the unchanged rule) and command kinds (+2); `l14_fact_states` unchanged. Implementation in M17-S0. |
| F-10 | `agents.risk_level` and `agents.ai_act_risk_class` are `NOT NULL` with defaults `'medium'` / `'minimal'`; the scan route also falls back to `"limited"`; `AgentForm` pre-fills `"medium"` / `"minimal"`. | Omitting the fields would still persist a default that reads as a risk value. D-12 (S0) therefore stops the scan route's legacy risk-bearing `agents` insert and heuristic ledger payload, without changing columns, defaults or existing rows. |
| F-11 | The shared governance-decision `reason_code` is constrained to exactly one code per subject × outcome (`<SUBJECT>_<OUTCOME>`); no free reasons. | The initial draft's risk-closure reason codes could not live in the shared envelope. Final ADR: envelope codes follow the unchanged rule; `closure_reason` / `treatment_revocation_reason` are closed typed L15 fields. |

## 9. Contradiction check

No contradiction was found between the frozen baseline (`GOVIA-L0L16-CIA-v1.0`), the merged M16 semantics, and the
M17 decisions in the ADR. D-01 … D-12 are resolved (ADR §27): D-01 by explicit owner approval recorded as a separate
additive M16 amendment (the historical M16 ADR text is not rewritten); D-09 and D-10 deferred; the rest approved. No
decision was resolved by changing the baseline or M16 history. **No STOP condition is raised.**

## 10. Recorded state

| Item | State |
|---|---|
| Canonical main | `5aec0b500cb16b0e3ce67376629ffa68cf2e6186` |
| M16 | CLOSED / MERGED (O01–O55 55 / 55 PASS) |
| M17 architecture | ACCEPTED / FROZEN on branch `docs/m17-risk-intelligence-architecture` (pending architecture PR merge) |
| Next implementation slice | M17-S0 (not started) |
| M17 implementation | NOT STARTED |
| Hosted | NOT TOUCHED |
