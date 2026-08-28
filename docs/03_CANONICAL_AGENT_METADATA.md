# Canonical Agent Metadata Model — V4 FINAL

## Principle
The Agent Passport is a 360° projection assembled from normalized metadata, governance facts and relationships. It is NOT one wide `agents` table.

## Metadata domains
1. **Identity & lifecycle** — internal ID/code, name, description, version, agent type, lifecycle/status.
2. **Discovery & provenance** — repository/provider, external repo ID, branch/tag/commit, file/module/path/symbol, detector/method, discovered/observed time, evidence, confidence, trust/validation state.
3. **Ownership** — business owner, technical owner, accountable owner, sponsor, custodian/steward where applicable.
4. **Business context** — domain, business process, capability, department/unit, use case, criticality.
5. **Technology** — language, framework, runtime, SDK, deployment type, environment, region/location.
6. **AI model relationships** — model, version, provider, deployment/endpoint and configuration reference as first-class relationships.
7. **Tools / MCP / APIs / resources** — resource identity/type, relationship, access mode and provenance.
8. **Data assets** — data system/dataset/table/file/bucket/API and, where available, data-element relationships.
9. **Privacy & sensitive data** — categories/subtypes, evidence, detector methods, confidence and validation. See `04_PRIVACY_DISCOVERY.md`.
10. **Classifications** — classification scheme/value, source fidelity, mappings and validity.
11. **Capabilities / permissions / identity / authorization** — see `05_CAPABILITIES_AUTHORIZATION.md`.
12. **Relationships / lineage** — agent-agent, AI-system-agent, agent-model, agent-tool/MCP/API, agent-data asset, process-AI system.
13. **Governance context** — policies, controls, assessments/findings, risks/treatments, approvals/decisions, exceptions and evidence are linked governance facts, not static agent columns.
14. **Custom metadata — N attributes** — normalized definition/value model; no physical `custom_1/custom_2/...` columns.

## Canonical extensibility
Core concepts include:
- `MetadataAttributeDefinition`
- `MetadataAttributeValue`
- `ClassificationScheme`
- `ClassificationValue`

Example source-preserving IDMC enrichment:
- `CUSTOM_1 / Criticidade Operacional = CRITICAL`
- `CUSTOM_2 / Sigilo Bancário = RESTRICTED`
- `CUSTOM_3 / Domínio Regulatório = BCB`

## Important distinction
- **Metadata** = what the agent is / context / relationships.
- **Facts & events** = what happened and when.
- **Metrics** = calculations over facts.
- **Objectives/targets** = desired thresholds.

## Trust states
At minimum: DISCOVERED/INFERRED, DECLARED, IMPORTED, OBSERVED, VALIDATED. These describe how an assertion is known; they are not necessarily a linear workflow.
