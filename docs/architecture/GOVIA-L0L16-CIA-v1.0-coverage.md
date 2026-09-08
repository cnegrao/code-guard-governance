# Gov IA — Current Implementation Coverage & Architectural Drift Register

**Baseline:** [`GOVIA-L0L16-CIA-v1.0.md`](./GOVIA-L0L16-CIA-v1.0.md)
**Status:** FROZEN BASELINE
**Date:** 2026-09-08
**Source SHA:** `b663db462d0bdfeabcdb0402148c8459de914d94`

This matrix is derived from current merged code and prior validation
evidence only (`docs/codex/evidence/*.md`, `packages/canonical-contracts`,
`supabase/migrations`, `apps/dashboard`). It does not infer completion from
architecture or planning documents. Closed implementation milestones (see
baseline authority rule, and the exclusion list below) are not re-audited;
they are used only to classify current coverage against the new baseline.

Closed milestones referenced as evidence, not reopened: Canonical
Contracts; Discovery Validation Lab; Discovery Engine V1; Discovery
Relationships V1.1; Discovery Tools V1.2; HITL V1; Authorized Reconciliation
Gate; Canonical Reconciliation Factory; Governance Persistence V1; Canonical
Materialization V1; Discovery Intake V1; Governance Workspace V1; Discovery
Governance Input Persistence V1; Object Candidate Normalization V1;
Reconciliation & Materialization Workspace V1; Graph Route Release Fix V1.

---

## 1. L0–L16 implementation coverage matrix

| Layer | Coverage | Notes |
|---|---|---|
| L0 — Source & Acquisition | PARTIAL | Repository/source connectors exist in `packages/scanner` (Discovery Engine V1); acquisition run/snapshot concepts exist but are not yet a fully governed, evidence-linked acquisition context object. |
| L1 — Lexical & Documentation Intelligence | PARTIAL | Discovery Engine parses source text/docs/manifests for golden repositories (`apps/dashboard/reports/validation/*`); coverage is scoped to validated golden repos, not general-purpose yet. |
| L2 — Deterministic Pattern Intelligence | PARTIAL | Deterministic detectors exist (`packages/scanner/src/core/risk-detector.ts` and related), but detector breadth has not been re-baselined against this architecture (see roadmap milestone 1). |
| L3 — Structure / Schema / Data Intelligence | FOUNDATIONAL_ONLY | `DATA_ASSET` / `DATA_ELEMENT` are closed canonical object kinds with structural-kind enums (`packages/canonical-contracts/src/contracts.ts`), but structural discovery (AST/schema/DDL/dbt) into these kinds is not yet a completed discovery pipeline. |
| L4 — Agentic Architecture Intelligence | PARTIAL | MODEL and TOOL have normalized object continuity through discovery → reconciliation → materialization. AGENT is discovery-only (`FINDING_ONLY`) with no evidence-backed AGENT_VERSION yet. Prompt/MCP/KB/Skill/memory/guardrail/orchestration discovery is not yet implemented at the same maturity as Model/Tool. |
| L5 — Authorized Profiling | NOT_IMPLEMENTED | No authorized deeper-profiling capability exists yet. |
| L6 — Business & Information Semantics | NOT_IMPLEMENTED | No Business Domain / Information Domain / Business Term modeling found in canonical contracts or persistence. |
| L7 — Embeddings & Semantic Representations | NOT_IMPLEMENTED | No embedding columns, pgvector usage, or representation-versioning contract exist in `supabase/migrations` or `packages/canonical-contracts`. Architecturally approved (baseline §1, §7C); not yet built. |
| L8 — Similarity & Entity Resolution Candidates | NOT_IMPLEMENTED | No similarity/clustering candidate model exists yet; depends on L7. |
| L9 — Relationships & Lineage | PARTIAL | `GOVERNED_RELATIONSHIP_TYPE` and `RELATIONSHIP_ENDPOINT_RULES` (closed taxonomy, AGENT_VERSION-sourced behavior bindings) are fully modeled in canonical contracts and have a Decision-to-Truth reconciliation path (Object Candidate Normalization V1, Reconciliation & Materialization Workspace V1). Actual discovered relationship volume in production is limited; column-level DataElement lineage discovery is incomplete. |
| L10 — Connectivity & Execution Topology | NOT_IMPLEMENTED | No endpoint/network/topology modeling found. |
| L11 — Identity, Capability & Authorization | NOT_IMPLEMENTED | No execution-principal/IAM/OAuth/capability-vs-authorization modeling found beyond the app's own auth (`apps/dashboard/lib/auth`, `components/auth`), which is product infrastructure, not governed L11 subject matter. |
| L12 — Runtime & Observability | NOT_IMPLEMENTED | No OTel/trace/runtime-call capture pipeline found. |
| L13 — Cross-Signal Reconciliation | FOUNDATIONAL_ONLY | Source-to-source reconciliation exists for canonical objects/relationships (Authorized Reconciliation Gate, Canonical Reconciliation Factory) with field-level authority and trust-state transitions. Design-time-vs-runtime correlation is not possible yet because L12 (runtime observation) does not exist. |
| L14 — Governance & Controls | PARTIAL | Governance Persistence V1, Governance Workspace V1, ReviewSubject lifecycle, and ownership/approval flows exist. `TRACEABILITY_MATRIX.md` maps governance controls (CG-AG-001…012) to EU AI Act / DORA / ISO 42001 / NIST AI RMF / ISO 27001, but this is a compliance-mapping artifact, not yet a governed-controls persistence layer wired to L0–L16 evidence. |
| L15 — Risk & Exposure Intelligence | NOT_IMPLEMENTED | No signal → hypothesis → governed risk → residual risk pipeline exists yet. |
| L16 — Drift & Change Intelligence | NOT_IMPLEMENTED | No temporal-comparison/drift-detection capability exists yet; depends on L12/L13. |

## 2. Agent Passport 360 family coverage

| Family | Coverage | Notes |
|---|---|---|
| 1. Identity | PARTIAL | AGENT canonical object kind exists; AGENT remains FINDING_ONLY (no materialized, evidence-backed identity record yet). |
| 2. Discovery Metadata | PARTIAL | Evidence/provenance persistence exists (`OBJECT_SOURCE_MAPPING_STATUS`, `OBJECT_SOURCE_MATCH_METHOD`, evidence location kinds) in canonical contracts. |
| 3. Ownership & Responsibility | PARTIAL | Governance Workspace / Governance Persistence V1 cover ownership assignment at the governance layer; not yet tied end-to-end to AgentVersion evidence. |
| 4. Business Context | NOT_IMPLEMENTED | Depends on L6, not implemented. |
| 5. Technology & Build | FOUNDATIONAL_ONLY | Framework/SDK/build fields are modeled in scanner types but not yet a governed, reconciled Passport field. |
| 6. AI Model & Inference | PARTIAL | MODEL is a normalized canonical object with reconciliation/materialization; most mature Passport family after Identity. |
| 7. Agent Architecture & Behavior | FOUNDATIONAL_ONLY | Behavior-binding relationship taxonomy exists (USES_MODEL/USES_TOOL/etc.); actual discovered/governed behavior bindings are limited pending AGENT_VERSION identity (roadmap milestone 2). |
| 8. Tools / MCP / APIs | PARTIAL | TOOL has normalized object continuity comparable to MODEL; MCP_SERVER/API canonical kinds exist but with less discovery maturity. |
| 9. Data Assets + Data Elements | FOUNDATIONAL_ONLY | Canonical kinds and structural-kind enums exist; discovery pipeline into these kinds is incomplete (see L3). |
| 10. Privacy & Sensitive Data | PARTIAL | Deterministic PII/secrets pattern detection exists at L2; not yet reconciled into a governed Passport field with trust state. |
| 11. Relationships & Lineage | PARTIAL | See L9 above. |
| 12. Governance Controls | PARTIAL | See L14 above. |
| 13. Operation & Runtime | NOT_IMPLEMENTED | Depends on L12, not implemented. |
| 14. Provenance & Trust | PARTIAL | Trust vocabulary primitives (mapping status, match method, evidence handling/location) exist in canonical contracts; full INFERRED/DECLARED/IMPORTED/OBSERVED/VALIDATED lifecycle is not yet uniformly wired through every family. |
| 15. Capabilities / Permissions / Authorization | NOT_IMPLEMENTED | Depends on L11, not implemented. |
| 16. Connectivity & Network | NOT_IMPLEMENTED | Depends on L10, not implemented. |

## 3. Known facts preserved from prior milestones

- Current canonical/governance foundation is strong.
- Evidence/provenance persistence exists.
- ReviewSubject lifecycle exists.
- Machine authority ceiling `PROPOSED` exists (`OBJECT_SOURCE_MAPPING_STATUS.PROPOSED`, `packages/canonical-contracts/src/contracts.ts:130`).
- Reconciliation/materialization exist (Authorized Reconciliation Gate, Canonical Reconciliation Factory, Canonical Materialization V1).
- Governance Workspace exists.
- Decision-to-Truth object flow exists (Object Candidate Normalization V1, Reconciliation & Materialization Workspace V1).
- MODEL and TOOL have normalized object continuity; AGENT remains FINDING_ONLY.
- Current production relationships are limited.
- Current scanner does not yet provide trustworthy AgentVersion evidence.
- Current data relationship discovery is incomplete.
- The `/graph` route build blocker has been fixed (Graph Route Release Fix V1).
- Full dashboard production build is green.

No future-architecture item above is marked as implemented beyond what current code/evidence supports.

---

## 4. Architectural drift register

**A. Historical `Agent → Model` shorthand diagrams.**
Superseded. Current canonical meaning: `AGENT_VERSION --USES_MODEL--> MODEL`
(baseline §5). Behavior bindings source from AGENT_VERSION, never AGENT.

**B. Historical "Discovery as source of truth" phrasing.**
Superseded. Current meaning: Discovery produces assertions, findings, and
candidates. Canonical governed truth emerges only after reconciliation and
governance review (`DISCOVERY != GOVERNANCE AUTHORITY`, baseline §2).

**C. Historical Graph taxonomy using open/free relationship vocabulary.**
Superseded. The canonical relationship taxonomy is closed —
`GOVERNED_RELATIONSHIP_TYPE` in `packages/canonical-contracts/src/contracts.ts`
enumerates exactly 12 types with fixed source/target endpoint rules. No
free-form relationship types are canonical.

**D. `CONTAINS` as discovery/projection vocabulary.**
`CONTAINS`-style containment used in discovery/UI projection is not promoted
automatically to the canonical relationship taxonomy. It remains
projection-only unless explicitly added via ADR.

**E. Speculative persistence technologies (Neo4j / ClickHouse / OpenSearch).**
These remain architectural options, not approved mandatory dependencies.
Current canonical system of record is PostgreSQL/Supabase.

**F. Vector technology direction.**
Vector Intelligence is architecturally approved as L7 (baseline §1, §7C).
Technology choice remains implementation-dependent; initial preferred
direction is pgvector/Postgres-first unless scale proves otherwise. Not yet
implemented (see coverage matrix, L7 = NOT_IMPLEMENTED).

**G. `graphos-complete/` prototype application.**
`graphos-complete/src/graphos/ROADMAP.md` (Portuguese-language "Roadmap de
Excelência," phased by persona view — CEO/CFO/CISO/DPO) describes a distinct,
earlier prototype Next.js application with its own `package.json` and build
output, separate from the active GraphOS surface at
`apps/dashboard/components/graph`. Classified **HISTORICAL**. It is not
deleted, but it does not describe the current or target GraphOS
architecture; the active projection layer is governed by baseline §7B.

**H. `TRACEABILITY_MATRIX.md` regulatory control mapping.**
Classified **CURRENT / IMPLEMENTATION-SPECIFIC**. It maps governance
controls (CG-AG-001…012) to external regulatory frameworks (EU AI Act, DORA,
ISO/IEC 42001, NIST AI RMF, ISO/IEC 27001). It is compatible with and
complementary to L14/L15 of this baseline but is not itself an architecture
document and is not superseded by it.

No historical document referenced above has been deleted.
