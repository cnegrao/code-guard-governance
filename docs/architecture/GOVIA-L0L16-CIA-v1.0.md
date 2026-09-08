# Gov IA L0–L16 Canonical Intelligence Architecture — v1.0

**Architecture ID:** `GOVIA-L0L16-CIA-v1.0`
**Short name:** GOV IA CIA L0–L16 v1.0
**Status:** FROZEN BASELINE
**Baseline date:** 2026-09-08

---

## 0. Purpose and authority

This document is the **primary architectural reference** for Gov IA. It governs
roadmap sequencing, Discovery, the scanner, canonical contracts, Agent Passport
360, GraphOS, lineage, Vector Intelligence, LLM intelligence, reconciliation,
runtime, risk, integrations, Workspace, and all future infrastructure
decisions.

If any older diagram, prompt, milestone note, prototype, code behavior, or
historical architecture document contradicts this baseline, **the baseline
wins**. Implementation must converge toward this architecture — this document
is never silently modified to accommodate current implementation gaps.

Any intentional architectural divergence from this baseline requires:

1. an explicit Architecture Decision Record,
2. documented rationale,
3. impact analysis, and
4. an approved architecture version increment.

No local milestone may redefine this architecture implicitly. See
[`GOVIA-L0L16-CIA-v1.0-roadmap.md`](./GOVIA-L0L16-CIA-v1.0-roadmap.md) §"Future
milestone Definition of Done."

---

## 1. L0–L16 canonical model

**L0 — Source & Acquisition**
Source connection; repository/source identity; branch/commit; acquisition
run; snapshot; acquisition context.

**L1 — Lexical & Documentation Intelligence**
Source text; code; documentation; manifests; declarations; comments;
technical documentation signals.

**L2 — Deterministic Pattern Intelligence**
Deterministic rules; regex/patterns; URLs/endpoints; PII indicators; secrets
indicators; explicit deterministic signals.

**L3 — Structure / Schema / Data Intelligence**
AST; schema; DDL; dbt; structured metadata; DataAsset; DataElement;
column/field/nested path; structural lineage inputs.

**L4 — Agentic Architecture Intelligence**
Agent; AgentVersion; Subagent; Supervisor; framework/SDK; language/runtime/
build context; Model; Prompt/instructions; Tools; MCP server/MCP tool; APIs;
A2A; Skills; Knowledge Bases; RAG; Memory/session; guardrails; HITL;
orchestration; routing; handoff; graph workflows; tool-calling behavior.

**L5 — Authorized Profiling**
Deeper profiling only when explicitly authorized; technical characteristics
requiring additional inspection; runtime/configuration profiling where
applicable; never uncontrolled content capture.

**L6 — Business & Information Semantics**
Business Domain; Information Domain; Business Terms; purpose; capability;
semantic classification; business context.

**L7 — Embeddings & Semantic Representations**
Embeddings; semantic signatures; vector representations; representation
versioning; embedding model/version; provenance; content fingerprint.

> Embedding/vector representation is **derived analytical state**. It is
> **not** canonical identity.

**L8 — Similarity & Entity Resolution Candidates**
Semantic similarity; clustering; cross-source matching candidates; possible
duplicate candidates; Agent similarity; DataElement similarity;
prompt/config similarity; entity-resolution hypotheses.

> Semantic similarity != physical identity. Vector score != canonical merge
> authority.

**L9 — Relationships & Lineage**
Agentic relationships; Model lineage; Tool/MCP/API dependency; Agent/Data
relationships; DataAsset lineage; DataElement/column-level lineage;
transformation provenance; upstream/downstream; lineage direction;
relationship temporal state.

**L10 — Connectivity & Execution Topology**
Endpoints; network paths; egress; environments; VPC/network context;
protocols; service topology; external/internal connectivity; execution
topology.

**L11 — Identity, Capability & Authorization**
Execution principals; service accounts; IAM roles; OAuth identities; user
delegation; capabilities; actions; resources; scopes; grants; permissions;
authorization state; unknown authorization state.

> Capability != authorization.

**L12 — Runtime & Observability**
Executions; OTel; traces; model calls; tool calls; MCP calls; latency;
errors; availability; token usage; cost; actual runtime behavior.

> Design-time declaration != runtime observation.

**L13 — Cross-Signal Reconciliation**
Design-time vs runtime correlation; source-to-source correlation; enterprise
partner correlation; conflict detection; identity resolution candidates;
field-level authority; trust-state transition; governed reconciliation.

**L14 — Governance & Controls**
Ownership; stewardship; business responsibility; policies; controls;
assessments; approvals; exceptions; governance decisions.

**L15 — Risk & Exposure Intelligence**
Privacy/LGPD/GDPR; cybersecurity; authorization; autonomy; model risk; data
risk; connectivity risk; operational risk; FinOps risk; control coverage;
residual risk.

> Risk consumes evidence and governed facts. Risk Intelligence is **not**
> L17 and **not** Passport family 17 — see §3, "Risk is transversal."

**L16 — Drift & Change Intelligence**
Prompt drift; model drift; tool/MCP drift; permission drift; topology drift;
behavior drift; configuration drift; data/schema drift; runtime drift;
risk-impacting change; temporal comparison.

---

## 2. Cross-cutting invariants — non-negotiable

Every L0–L16 layer must preserve, where applicable: Evidence, Provenance,
Confidence, Trust State, Source Boundary, Temporal Versioning, Human Review,
Auditability, Tenant Identity, Method/detector provenance, Authority context.

Frozen invariants:

- SOURCE ASSERTION != CANONICAL FACT
- SEMANTIC SIMILARITY != PHYSICAL IDENTITY
- CAPABILITY != AUTHORIZATION
- DESIGN-TIME DECLARATION != RUNTIME OBSERVATION
- DISCOVERY != GOVERNANCE AUTHORITY
- SCANNER MACHINE AUTHORITY CEILING = PROPOSED
- HIGH CONFIDENCE != VALIDATED
- VECTOR SIMILARITY != CANONICAL MERGE
- GRAPH PROJECTION != SYSTEM OF RECORD
- LLM OUTPUT != CANONICAL TRUTH
- UNKNOWN != FALSE
- MISSING EVIDENCE MUST NEVER BE FABRICATED

---

## 3. Trust vocabulary — freeze

- **INFERRED** — technical inference from evidence.
- **DECLARED** — explicit declaration from code/config/source metadata.
- **IMPORTED** — assertion received from an enterprise/external source.
- **OBSERVED** — actual runtime observation.
- **VALIDATED** — reconciled/governed assertion with sufficient
  authority/review.

No competing synonyms. Confidence never automatically promotes trust state.

---

## 4. Agent Passport 360 — freeze

Agent Passport 360 is **not** L0–L16. L0–L16 describes **how** knowledge is
discovered, enriched, and reconciled. Agent Passport 360 describes **how**
governed knowledge about the Agent is organized and presented.

The 16 governed metadata families:

1. Identity
2. Discovery Metadata
3. Ownership & Responsibility
4. Business Context
5. Technology & Build
6. AI Model & Inference
7. Agent Architecture & Behavior
8. Tools / MCP / APIs
9. Data Assets + Data Elements
10. Privacy & Sensitive Data
11. Relationships & Lineage
12. Governance Controls
13. Operation & Runtime
14. Provenance & Trust
15. Capabilities / Permissions / Authorization
16. Connectivity & Network

**Risk Intelligence consumes these families transversally.** There is no
17th "Risk family."

Custom Metadata Extensions are permitted only with a governed namespace,
typed value, owner, source, validation rule, effective date, provenance, and
reconciliation policy where relevant. Generic JSON/EAV never replaces
modeled enterprise semantics.

---

## 5. AGENT / AGENT_VERSION canonical rule

- **AGENT** = stable logical identity.
- **AGENT_VERSION** = temporally/versioned technical state of that logical
  Agent.

Behavior bindings belong to **AGENT_VERSION**, never to AGENT, regardless of
implementation convenience.

Canonical relationship taxonomy (source constraints are closed):

```
AGENT_VERSION --USES_MODEL-->          MODEL
AGENT_VERSION --USES_TOOL-->           TOOL
AGENT_VERSION --USES_MCP-->            MCP_SERVER
AGENT_VERSION --INVOKES-->             API
AGENT_VERSION --USES_PROMPT-->         PROMPT
AGENT_VERSION --USES_KNOWLEDGE_BASE--> KNOWLEDGE_BASE
AGENT_VERSION --USES_SKILL-->          SKILL
AGENT_VERSION --HANDOFF_TO-->          AGENT
AGENT_VERSION --READS_FROM-->          DATA_ASSET | DATA_ELEMENT
AGENT_VERSION --WRITES_TO-->           DATA_ASSET | DATA_ELEMENT
DATA_ELEMENT  --DERIVED_FROM-->        DATA_ELEMENT
MCP_SERVER    --EXPOSES-->             TOOL
```

This taxonomy is closed and matches `GOVERNED_RELATIONSHIP_TYPE` and
`RELATIONSHIP_ENDPOINT_RULES` in
[`packages/canonical-contracts/src/contracts.ts`](../../packages/canonical-contracts/src/contracts.ts)
as of this baseline. Do not redefine it without an ADR.

---

## 6. Lineage — central architectural axis

Lineage is a first-class architectural axis, not a secondary feature.
Required governed lineage dimensions:

- Agent lineage
- AgentVersion lineage
- model lineage
- prompt/config lineage
- Tool/MCP/API dependency
- execution lineage
- handoff / multi-agent lineage
- Knowledge Base / RAG lineage
- DataAsset lineage
- DataElement / column lineage
- transformation lineage
- control/policy lineage
- risk propagation lineage
- evidence lineage
- governance-decision lineage
- temporal lineage

The architecture must ultimately answer: which AgentVersions access this
DataElement; which model/tool/API chain reaches sensitive data; which change
introduced this dependency; what breaks if this DataElement changes; what is
the upstream/downstream blast radius; which policy/control applies to this
path; which AgentVersions changed behavior between releases; what evidence
proves this relationship; what runtime observation contradicts the
design-time declaration.

**DataElement grain** is column / field / nested path when the source
technically supports that grain. Never claim full lineage when only coarse
asset relationships exist.

---

## 7. Canonical + Graph + Vector + LLM

Four complementary capabilities:

**A. Canonical Truth** — primary system of record (PostgreSQL / current
canonical persistence). Owns governed identity, governed facts, temporal
state, authority, reconciliation results, audit trail.

**B. Graph / GraphOS** — projection of governed and eligible pre-governed
relationships. Owns topology, relationships, lineage navigation, path
analysis, blast radius, impact analysis. **GraphOS is not System of Record.**

**C. Vector / Semantic Space** — derived semantic representation. Initial
implementation direction may use pgvector/PostgreSQL unless future scale
requirements justify another technology. Owns semantic representations,
similarity, clustering, retrieval, possible-match signals, semantic
neighborhood, semantic drift signals. Embeddings must be versioned,
reproducible where possible, associated with embedding model/version, tied
to content fingerprint, provenance-aware, and tenant-scoped. **Embedding is
never canonical object identity.**

**D. LLM Intelligence** — may consume canonical facts, graph paths, vector
retrieval, evidence, and runtime facts. May produce explanations, analysis,
hypotheses, proposals, summaries, recommendations. **LLM must not directly
create canonical truth.**

Target analytical architecture:

```
CANONICAL TRUTH
     |
     +------ GRAPH
     |
     +------ VECTOR
              |
           HYBRID
          RETRIEVAL
              |
             LLM
              |
      EXPLAINABLE INTELLIGENCE
```

---

## 8. Multivendor authority model

Gov IA does **not** replace enterprise catalogs/governance platforms. Gov IA
specializes in: Agentic discovery; AI technical metadata; Agent
architecture; AgentVersion behavior; AI/data dependency; Agentic lineage; AI
risk/control intelligence.

Enterprise systems may be authoritative for: enterprise asset identity;
glossary; business term; domain; owner/steward; certified data lineage;
classification; IAM; cloud/runtime metadata; CMDB; policies.

**Authority is field / fact / source specific, not global.** Partner data
must not blindly overwrite Gov IA findings. Conflicts remain visible and
reconcileable.

---

## 9. Future milestone Definition of Done

Every future product milestone must declare, **before** implementation:

A. **CIA baseline** — `GOVIA-L0L16-CIA-v1.0` compatibility
B. **L0–L16 impact** — affected layers, unaffected layers, dependencies
C. **Passport impact** — affected metadata families
D. **Canonical impact** — identities, relationships, temporal state
E. **Lineage impact**
F. **Evidence / provenance**
G. **Trust / authority**
H. **Vector impact** — if semantic representation/similarity is involved
I. **Graph impact** — if relationships/lineage are involved
J. **LLM authority boundary** — if an LLM is involved
K. **Tenancy / security**
L. **Migration impact**
M. **Downstream continuity**
N. **Non-fabrication rule**
O. **Acceptance / quality metric**

A milestone missing this architecture mapping is not implementation-ready.

---

## 10. Related documents

- [`GOVIA-L0L16-CIA-v1.0-roadmap.md`](./GOVIA-L0L16-CIA-v1.0-roadmap.md) — official roadmap derived from architectural dependencies.
- [`GOVIA-L0L16-CIA-v1.0-coverage.md`](./GOVIA-L0L16-CIA-v1.0-coverage.md) — current implementation coverage matrix and architectural drift register.
- [`ADR-GOVIA-L0L16-CIA-v1.0.md`](./ADR-GOVIA-L0L16-CIA-v1.0.md) — decision record adopting this baseline.
