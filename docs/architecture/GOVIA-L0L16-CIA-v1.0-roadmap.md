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

## Current execution position (2026-09-24)

- **M15 — CROSS-SIGNAL RECONCILIATION & DRIFT V1: CLOSED / MERGED**, at
  canonical base `f431fa6901bfdb58cb1729553ea0193568fcc160`.
- **M16 — OWNERSHIP / BUSINESS / POLICY / CONTROL ENRICHMENT V1:
  ARCHITECTURE FREEZE CANDIDATE**. The
  [M16 ADR](./ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md)
  is **PROPOSED / ARCHITECTURE FREEZE CANDIDATE**, with owner approval pending.
  This is a documentation gate, not a claim that M16 is implemented; frozen
  architecture and implementation coverage claims remain unchanged.
