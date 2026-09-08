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

19. **ENTERPRISE CONNECTORS EXPANSION**

20. **OUTBOX / EVENT CONSUMERS**
    Only with real consumers.

21. **PRODUCTION SECURITY & RELEASE GATE**

22. **PRODUCTION DEPLOYMENT**

---

## Next development milestone

Per the current implementation coverage
([`GOVIA-L0L16-CIA-v1.0-coverage.md`](./GOVIA-L0L16-CIA-v1.0-coverage.md)),
the canonical/governance/reconciliation foundation (milestones that predate
this roadmap freeze) is strong, but AGENT remains FINDING_ONLY and no
AgentVersion evidence pipeline exists yet. The next milestone in dependency
order is:

**1. GOLDEN REPOSITORIES & DISCOVERY BASELINE V2**

followed by **2. AGENT IDENTITY & VERSION DISCOVERY V1**, since milestones 3
onward (technical profile, semantic foundation, behavior relationships) all
depend on a trustworthy, evidence-backed AGENT_VERSION identity existing
first.
