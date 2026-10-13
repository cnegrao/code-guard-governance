# Gov IA — Official Roadmap under `GOVIA-L0L16-CIA-v1.0`

**Baseline:** [`GOVIA-L0L16-CIA-v1.0.md`](./GOVIA-L0L16-CIA-v1.0.md)
**Status:** FROZEN BASELINE
**Date:** 2026-09-08

This roadmap is derived from architectural dependencies in the frozen
baseline, not from convenience or current implementation shortcuts. Order is
authoritative unless a genuine dependency contradiction is found and
recorded via ADR.

Every milestone below must satisfy the **Future milestone Definition of
Done** (baseline §9) before implementation begins.

## Execution-scope amendment — COMMERCIAL V0 (2026-09-18)

This explicitly owner-approved amendment records the Commercial V0 execution
scope. The architecture baseline remains frozen: architectural invariants,
L0–L16 layer definitions, and milestone numbering 0–22 are unchanged. This
amendment changes execution scope only; it does not revise the baseline or
waive the milestone Definition of Done.

M14 remains **RUNTIME & OBSERVABILITY V1**. After M14 closure and before
material M15 execution, Commercial V0 requires the following structural gate:

```text
GitHub
→ GitHubSourceAdapter
→ SourceAdapter
→ evidence-backed snapshot/provenance
→ Discovery
→ PROPOSED
→ Governance Review
→ Canonical Truth
```

GitHub is a **CORE L0 Source & Acquisition capability** and is **NOT part of
M19**. This GitHub canonical source foundation is an execution gate between
M14 and M15, not an additional numbered milestone. Canonical promotion must
pass through Governance Review, preserving evidence, provenance, tenant
isolation, and source authority.

The existing authority and evidence invariants remain mandatory:

- `DISCOVERY != GOVERNANCE AUTHORITY`
- `SCANNER MACHINE AUTHORITY CEILING = PROPOSED`
- `SOURCE ASSERTION != CANONICAL FACT`
- `MISSING EVIDENCE MUST NEVER BE FABRICATED`

## Milestones (0–22)

0. **GOV IA REQUIREMENTS BASELINE & ROADMAP FREEZE V1** — this milestone.

1. **GOLDEN REPOSITORIES & DISCOVERY BASELINE V2**
   TP/FP/FN; precision/recall/F1; evidence validity; L0–L16 coverage map;
   negative scenarios; baseline before detector expansion.

2. **AGENT IDENTITY & VERSION DISCOVERY V1**
   Stable AGENT identity; evidence-backed AGENT_VERSION; temporal identity;
   no default/fabricated version.

3. **AGENT TECHNICAL PROFILE — L4 ROUND 1**
   Framework/SDK; technology/build; Model; Prompt; Tool; MCP; API; KB/RAG;
   memory; skill; orchestration; guardrails/HITL; evidence per fact.

4. **SEMANTIC INTELLIGENCE FOUNDATION — L6/L7**
   Semantic representation contract; embeddings; pgvector direction;
   representation versioning; content fingerprint; tenant isolation;
   provenance; no authority.

5. **SIMILARITY & ENTITY RESOLUTION CANDIDATES — L8**
   Similarity; clustering; possible-match; Agent similarity; DataElement
   similarity; prompt/config similarity; no automatic canonical merge.

6. **AGENTVERSION BEHAVIOR RELATIONSHIPS — L9**
   USES_MODEL; USES_TOOL; USES_MCP; INVOKES; USES_PROMPT;
   USES_KNOWLEDGE_BASE; USES_SKILL — with correct AGENT_VERSION source.

7. **RELATIONSHIP DECISION-TO-TRUTH COMPLETION V1**
   Governed endpoints; CREATE_NEW / MATCH_EXISTING; canonical relationship
   temporal state.

8. **DATA ASSET & DATA ELEMENT DISCOVERY V1**
   SQL/schema/dbt; table/view/file/dataset; column/field/path; structural
   evidence.

9. **DATA ACCESS & COLUMN LINEAGE V1**
   READS_FROM; WRITES_TO; DERIVED_FROM; transformation provenance; column
   lineage.

10. **MULTIVENDOR EXCHANGE MVP V1**
    One real priority ecosystem; DTO; source mapping; field-level authority;
    conflicts/reconciliation.

11. **AGENT PASSPORT 360 GOVERNED VIEW V1**
    All 16 families represented; UNKNOWN explicit; source/evidence/trust/
    temporal context.

12. **GOVERNED GRAPH + VECTOR INTELLIGENCE V1**
    Canonical GraphOS projection; hybrid Graph + Vector retrieval; lineage +
    similarity; blast radius; analytical Copilot foundation; explainable
    retrieval.

13. **CONNECTIVITY & EXECUTION IDENTITY/AUTHZ V1**
    L10/L11.

14. **RUNTIME & OBSERVABILITY V1**
    L12; OTel; model/tool/API calls; latency/errors/tokens/cost.

15. **CROSS-SIGNAL RECONCILIATION & DRIFT V1**
    L13 + L16; design-time vs runtime; change intelligence.

16. **OWNERSHIP / BUSINESS / POLICY / CONTROL ENRICHMENT V1**
    L14.

17. **RISK INTELLIGENCE V1**
    L15; signal → hypothesis → governed risk → residual risk.

18. **BUSINESS WORKSPACE V1**
    Commercial V0 focus:

    - Executive / Board
    - CISO / Security
    - Compliance / Auditor
    - AI / Data Owner

19. **ENTERPRISE CONNECTORS EXPANSION — COMMERCIAL V0**
    Initial V0 scope ONLY:

    - Informatica IDMC
    - Microsoft Purview
    - Databricks
    - AWS
    - Google Cloud
    - dbt

    dbt scope includes dbt Core/project artifacts relevant to discovery and
    lineage, and governed dbt Cloud metadata integration where applicable.
    Evidence, provenance, tenant isolation, and source authority must be
    preserved; dbt provides no alternative canonical truth path. GitHub is
    the CORE L0 gate described above and is not included in M19.

20. **OUTBOX / EVENT CONSUMERS**
    Only with real consumers.

21. **PRODUCTION SECURITY & RELEASE GATE**

22. **PRODUCTION DEPLOYMENT**

---

## Post-V0 scope

The following are deferred until post-V0 unless required by an actual
customer:

- GitLab canonical promotion
- Azure DevOps canonical promotion
- Bitbucket canonical promotion
- Gitea
- Forgejo
- Confluence
- Notion
- SharePoint
- Entra ID
- Okta
- Keycloak

## Practical Commercial V0 sequence

```text
M14 close
→ GitHub canonical source foundation
→ M15
→ M16
→ M17
→ focused M18
→ M19: IDMC/Purview/Databricks/AWS/Google Cloud/dbt
→ M20 only real consumers
→ M21
→ M22
```

## Current execution position (2026-10-12)

- **M15 — CROSS-SIGNAL RECONCILIATION & DRIFT V1: CLOSED / MERGED**, at
  canonical base `f431fa6901bfdb58cb1729553ea0193568fcc160`.
- **M16 — OWNERSHIP / BUSINESS / POLICY / CONTROL ENRICHMENT V1: CLOSED / READY FOR DOWNSTREAM**
  ([closure evidence](../codex/evidence/2026-10-12-m16-closure.md)).
  The [M16 ADR](./ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md)
  remains **ACCEPTED / FROZEN** (owner approval granted on **2026-09-24**).
- Implemented / merged: S0, S1A, S1A.2, S1A.2R1, S1B.0, S1B.1, S1B.1R1, S1B.2,
  S1B.2R1, S1B.2R2, S1B.2R3, S1B.3, S1B.4, S1B.5, S1B.6, S1C.1, S1C.1R1, S1C.2, S1C.3, S1C.4, S1C.5 and the O32 / O41 read-projection closure. The governed discovery machine boundary was
  merged through PR #52.
- **PR #52: MERGED** into main at `9875208d0fd60105a7508572d5058235ca0751de`.
- **PR #53: MERGED** — **S1B.3 — Policy Content Admission: MERGED**. Canonical main
  baseline at the start of S1B.4: `e145046ef0ff20d8846bc6e3bce80f84aa50b611`.
- **PR #54: MERGED** — **S1B.4 — POLICY_VERSION Governance Validation: MERGED**
  ([evidence](../codex/evidence/2026-10-08-m16-s1b4-policy-version-validation.md)). Canonical
  main baseline at the start of S1B.5: `3200b02042a6ed91e792cbc6da89e40fbf793d51`.
- **PR #55: MERGED** — **S1B.5 — BUSINESS_DOMAIN / INFORMATION_DOMAIN Governed Registries: MERGED**
  ([evidence](../codex/evidence/2026-10-08-m16-s1b5-domain-registries.md)). Canonical main
  baseline at the start of S1B.6: `5ac5d8072353001ee533a1019fbbdd43485a8d62`.
- **PR #56: MERGED** — **S1B.6 — CONTROL_DEFINITION Registry + Immutable Versions: MERGED**
  ([evidence](../codex/evidence/2026-10-08-m16-s1b6-control-definition-registry.md)). Canonical
  main baseline at the start of S1C.1: `4f877b6aa2c1fdfac967f1bf6ce003da06c164a7`.
  No CONTROL_APPLICABILITY / assessment; CG-AG 001..012 are not admitted or validated.
- **PR #57: MERGED** — **S1C.1 — RESPONSIBILITY_ASSIGNMENT (first authoritative M16 fact family): MERGED**
  ([evidence](../codex/evidence/2026-10-08-m16-s1c1-responsibility-assignment.md)). Canonical
  main baseline at the start of S1C.2: `6fe5c57bd1ea7f92e2804292de3ab6de931ec4a1`.
- **PR #58: MERGED** — **S1C.2 — BUSINESS_CONTEXT_ASSIGNMENT (second authoritative M16 fact family): MERGED**
  ([evidence](../codex/evidence/2026-10-09-m16-s1c2-business-context-assignment.md)), together with
  **S1C.1R1 — S1C.1 Party dependency commit-boundary closure: MERGED** (additive migration
  `20261009121000_m16_s1c1r1_party_dependency_guard_v1.sql`; recorded in the S1C.2 evidence). Canonical main
  baseline at the start of S1C.3: `10bd95426241229bb423a0bf2c06c126118bea72`.
- **PR #59: MERGED** — **S1C.3 — POLICY_APPLICABILITY (third authoritative M16 fact family): MERGED**
  ([evidence](../codex/evidence/2026-10-09-m16-s1c3-policy-applicability.md)). Canonical main
  baseline at the start of S1C.4: `a29bec2fd38e2f15670379f5af7588a9aba44151`.
- **PR #60: MERGED** — **S1C.4 — CONTROL_APPLICABILITY (fourth authoritative M16 fact family): MERGED**
  ([evidence](../codex/evidence/2026-10-09-m16-s1c4-control-applicability.md)). Canonical main
  baseline at the start of S1C.5: `d6c21254395b2df79594c35eafc631fa2ae27d20`.
- **PR #61: MERGED** — **S1C.5 — CONTROL_ASSESSMENT (fifth and final authoritative M16 fact family): MERGED**
  ([evidence](../codex/evidence/2026-10-10-m16-s1c5-control-assessment.md)). Canonical main
  baseline at the start of the read-projection corrective slice: `18e57b299a9fd7e317f4ba5fe35d1dd26db6dcc9`.
  All five M16 authoritative fact families are merged; CONTROL_FINDING is not a family; F2 untouched.
- **First M16 formal closure attempt: NOT PASSED** — two conformance blockers found: **O32** (ADR §22 Passport
  governed projection) and **O41** (ADR §18.2 conflict read projection).
- **PR #62: MERGED** — **O32 / O41 read-projection corrective slice: MERGED**
  ([evidence](../codex/evidence/2026-10-12-m16-read-projection-closure.md)). Additive migration
  `20261012120000_m16_read_projection_closure_v1.sql` (two read-only, tenant-scoped SECURITY DEFINER projections; no
  table, no write, no new fact family or truth store). Canonical main at the start of the formal closure rerun:
  `e5ae7a5a11791cef4d9af345430adf39260d16e9`.
- **M16 formal closure (rerun): PASSED — O01–O55: 55 / 55 PASS**
  ([closure evidence](../codex/evidence/2026-10-12-m16-closure.md)). Exactly five authoritative fact families;
  CONTROL_FINDING is not a family; 11 CanonicalObjectKinds; 12 GovernedRelationshipTypes; F2 untouched; application
  SECURITY DEFINER surface 45 (35 canonical-owner / policy-store-capable); service_role has no direct L14 table read.
  Documentation-only closure on branch `chore/m16-final-closure`; hosted **NOT TOUCHED**.
- **M16: CLOSED / READY FOR DOWNSTREAM.**
- **PR #63: MERGED** — **M16 formal closure: CLOSED / MERGED.** Canonical main after PR #63:
  `5aec0b500cb16b0e3ce67376629ffa68cf2e6186`.
- **PR #64: MERGED** — **M17 — RISK INTELLIGENCE V1 ARCHITECTURE: ACCEPTED / FROZEN** (canonical main after PR #64:
  `931d2d523992b98921b01f071f49997fe4bce678`): [M17 ADR](./ADR-GOVIA-RISK-INTELLIGENCE-v1.md); ACP architecture review
  completed; D-01 explicit owner approval on 2026-10-12, recorded in the additive
  [M16 Authority Policy M17 extension](./ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md) (ACCEPTED / FROZEN; the
  historical M16 ADR text is unchanged); D-01 … D-12 resolved; acceptance criteria O01–O91;
  [current-state inventory](../codex/evidence/2026-10-12-m17-current-state-inventory.md).
- **M17-S0 — Authority / Security / Root Contracts + Legacy Compatibility Hardening: IMPLEMENTED ON BRANCH
  `feat/m17-s0-authority-security-root-contracts`, NOT MERGED** (base main `931d2d5`;
  [evidence](../codex/evidence/2026-10-12-m17-s0-authority-security-root-contracts.md)). Additive migration
  `20261012200000_m17_s0_authority_policy_l15_extension_v1.sql`: D-01 single Authority Policy extension (23 permissions,
  17 shared-envelope subjects, +24 reason codes, +2 ADMIT command kinds; `l14_fact_states` not widened; no L15 bootstrap),
  L14 ↔ L15 isolation guards, D-05 `risk_entries` / `risk_treatments` application write-freeze; D-12 scan-route legacy risk
  writer stopped; legacy consumers labelled `LEGACY / NON-AUTHORITATIVE`; L15 root contracts in `canonical-contracts`.
  Application SECURITY DEFINER surface unchanged (45). Criteria needing L15 stores are dependency-deferred to S1–S7.
- **PR #65: MERGED** — M17-S0 (canonical main after PR #65: `59bb7e323af90da74133d51054674f405c81c786`).
- **M17-S1 — Signals + Hypotheses + Support / Evidence Model and Adapters: IMPLEMENTED ON BRANCH
  `feat/m17-s1-signals-hypotheses-support`, NOT MERGED** (base main `59bb7e3`;
  [evidence](../codex/evidence/2026-10-12-m17-s1-signals-hypotheses-support.md)). Additive migration
  `20261012210000_m17_s1_signals_hypotheses_support_v1.sql`: non-authoritative `l15_risk_signals` / `l15_risk_hypotheses`
  (insert-only, never VALIDATED, no status / head) and the D-03 `l15_support_links` closed tagged union with the acyclic §9.2
  matrix (S1 owners); bounded technical-capability machine intake (`govia_l15_machine_intake_caller`) and verified-member intake
  with DB-computed replay fingerprints; signal / hypothesis-disposition read projections; adapters for scanner `DetectedRisk`
  (30 rules), FinOps flags, M15, L12, L11, M16 control assessment / governance gap and lineage; Coding Memory F-S0-4 resolved.
  Application SECURITY DEFINER surface 45 → 49 (+2 technical intake RPCs); service_role holds no L15 table privilege.
  O08–O18, O80, O84 PASS; O79 / O81 / O82 PASS for S1 owners (rank-3 parts dependency-deferred to S2–S6).
  ACP delta: F-S1-1 approved (closed `unresolved_reason` = the L12 runtime-binding vocabulary); F-S1-4 platform-wide technical
  intake approved with S1R1 hardening — additive `20261012220000_m17_s1r1_machine_intake_login_closure_v1.sql` closes the privilege
  surface of the actual machine LOGIN (`l15_machine_role_safe_v1`); platform technical capability != tenant / business authority.
- **PR #66: MERGED** — M17-S1 + S1R1 (canonical main after PR #66: `0ad683c985d1d9b3458365f542b0b59af5df5cd2`).
- **M17-S2 — RISK_SCENARIO_DEFINITION + RISK_METHODOLOGY governed registries: IMPLEMENTED ON BRANCH
  `feat/m17-s2-scenario-methodology-registries`, NOT MERGED** (base main `0ad683c`;
  [evidence](../codex/evidence/2026-10-13-m17-s2-scenario-methodology-registries.md)). Additive migration
  `20261013120000_m17_s2_scenario_methodology_registries_v1.sql`: 15 L15-specific registry tables (stable tenant-scoped identity,
  immutable versions with normalized content — domain + legal subject-kind set + typed reference codes; ordered 2..7-level
  likelihood / impact scales + total rating lookup matrix + positive validity-maximum interval — DB content hashes, typed
  proposals, typed VALIDATED / REVOKED states pinning decision / authorization / Authority Policy version + hash, CAS heads, exact
  bitemporal resolvers for S3 / S4); ADMIT / SUBMIT / DECIDE RPCs under the single Authority Policy (`L15_RISK_SCENARIO_*` /
  `L15_RISK_METHODOLOGY_*`, organisation-wide); SYSTEM_SEED provenance only (no seed rows, human decision required); rank-3
  registry owners in `l15_support_links` (DISCOVERY_EVIDENCE / SOURCE_ASSERTION only); the S0-deferred `l14_command_results`
  L15 decision-result branch (`l15_state_id`). `l14_fact_states` / `l14_registry_states` / `l14_support_links` / M16 typed tables
  not widened. Application SECURITY DEFINER surface 49 → 55; L15 definers 7 → 14; machine intake surface unchanged (2).
  O19, O20, O21 PASS; O79 / O81 / O82 PASS for the S2 owners. Optional hypothesis → scenario pin APPROVED / DEFERRED (F-S2-2).
  **M17-S2R1 corrective (same branch, NOT MERGED)** — `20261013130000_m17_s2r1_l15_allow_guard_execution_context_v1.sql`: F-S2-1
  RESOLVED: the S0 root guard `l15_authorization_allow_guard_v1` is now an owner-only SECURITY DEFINER (byte-identical body, pinned
  search_path, EXECUTE revoked from every application role and the machine capability); a natural deferred commit from service_role
  is proven; L15 definers 14 → 15, application definer surface 55 (unchanged), machine surface 2. S3+ must not rely on SET CONSTRAINTS.
- **M17-S3 … S7: NOT STARTED.** M18+: NOT STARTED.
- Hosted (Supabase / Vercel / deployment): **NOT TOUCHED** by M17.
- **H1: CLOSED ON EQUIVALENT HOSTED EVIDENCE.** `B0_HTTP_MANUAL_ACCEPTANCE = PASS`;
  `REAL_HTTP_H1_PASS = NOT EMITTED` because the frozen canonical runner was not
  literally executed.
- Frozen CIA baseline semantics, milestone definitions, and implementation
  coverage claims remain unchanged.
