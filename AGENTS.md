# AGENTS.md — Gov IA / CG-AG OS — Baseline V4 FINAL

## Purpose
This repository implements Gov IA / CG-AG OS, a vendor-neutral Agent Governance Control Plane focused on discovery, registration, qualification, policy governance, risk, controls, evidence, approvals, auditability, privacy, lineage, metrics and enterprise enrichment.

## Mandatory architectural rules

### DATA-001 — 3NF by Design
All NEW persistent relational models MUST follow Third Normal Form (3NF). Do not add duplicated semantics, repeated groups, convenience denormalization, per-customer columns, or arrays/JSON blobs when a stable relational concept has its own identity/cardinality. Exceptions require an ADR with technical justification, scope, lifecycle and migration/rollback plan.

Existing legacy structures are AS-IS. Do not silently rewrite them. Evolve through reviewed migrations.

### DATA-002 — DTO Convenience != Persistence Model
Scanner/API DTOs may use arrays or nested objects for transport and in-memory processing. They MUST NOT dictate the System-of-Record schema. Normalize persistent business facts before writing to PostgreSQL.

### META-001 — Extensible Canonical Metadata
The canonical metadata model MUST support N custom attributes and classifications from external platforms without schema changes per attribute. Never create `custom_1`, `custom_2`, `custom_3`, etc. as physical columns on `agents`.

### META-002 — Source Fidelity
For imported or discovered metadata, preserve provenance: source system, external object ID, original attribute/code/name/value where relevant, capture time, validity and confidence/validation state.

### META-003 — Agent Passport is a Projection
Agent Passport is a 360° projection composed from normalized entities, facts and relationships. Do not implement it as one giant wide table.

### METRIC-001 — Derived Metrics Principle
Governance metrics and scores are derived from historical facts. Do not persist values such as `CG_AG_SCORE = 84%` as primary truth when they can be reproduced from facts. Materialized snapshots are allowed only as performance optimizations and MUST remain reproducible/auditable.

### TIME-001 — Historical Reproducibility
Policies, controls, assessments, evidence, risks, approvals and other governance facts MUST preserve enough temporal/version information to reconstruct the state at a past date.

### PRIV-001 — Privacy by Design
Privacy and sensitive-data discovery is first-class. Do not copy detected personal/sensitive values into Gov IA unless explicitly required. Prefer type/category, source location, detector evidence, hashes/fingerprints, provenance, detection method, confidence and validation state.

### PRIV-002 — Multi-Detector Privacy Discovery
Privacy discovery is NOT only field-name search. The target engine combines lexical/name dictionaries, value-pattern regex, checksums/domain validation, schema/structural analysis, code/data-flow context and semantic inference. Findings must distinguish evidence from conclusion.

### DISC-001 — Discovery Scope
MVP Discovery scans repositories where agents live: source code, IaC, CI/CD, manifests, MCP, prompts/config, dependencies and related engineering artifacts. Enterprise catalog/IAM/cloud platforms are enrichment sources, not primary agent-discovery sources.

### DISC-002 — Confirmed Repository Providers
The current Dênio scanner code confirms GitHub, GitLab, Azure DevOps, Bitbucket, Gitea and Forgejo connectors. Generic/self-hosted providers require explicit provider/base URL when URL inference is insufficient.

### DISC-003 — Unknown Provider Must Not Silently Become GitHub
The current scanner falls back to GitHub for unknown URLs. Target behavior must be explicit provider selection or controlled UNKNOWN_PROVIDER; do not silently misclassify a repository provider in production.

### AUTHZ-001 — Capability vs Authorization
Separate what an agent can do from whether it is authorized to do it. Preserve declared/observed capability, resource, action/permission, execution identity, role/binding, authorization status and authorization evidence.

### AUTHZ-002 — Unknown is not Unauthorized
Absence of proof of authorization MUST be represented as `UNKNOWN`, not automatically as `UNAUTHORIZED`.

### TRUST-001 — Metadata Trust State
Metadata assertions SHOULD distinguish at least: DISCOVERED/INFERRED, DECLARED, IMPORTED, OBSERVED, VALIDATED. Each assertion should be traceable to source, detector/method, time and evidence.

### CGAG-001 — Freeze CG-AG v1 IDs
Do NOT silently renumber or repurpose CG-AG v1 control identifiers. Existing v1 IDs/semantics remain frozen. New capabilities require additive controls or an explicitly versioned successor specification.

### ANALYTICS-001 — PostgreSQL Now, ClickHouse Later
PostgreSQL/Supabase is the MVP operational System of Record. ClickHouse is the preferred future analytical/event store for high-volume analytics, telemetry and FinOps. Do not make ClickHouse a blocker for MVP.

### GRAPH-001 — Graph Abstraction
GraphOS may use PostgreSQL now. Neo4j is a planned Graph Intelligence Engine/read model for complex lineage, path analysis, dependency analysis and blast radius. Core domain logic MUST not hard-code Neo4j as an MVP dependency.

### INTEGRATION-001 — Separate Connector Families
Repository Discovery connectors, Enterprise Enrichment connectors, Regulatory Source connectors and Runtime connectors are different contracts. Do not force IDMC/Purview/Entra/regulatory sources into the repository `SourceConnector` interface.

### UI-001 — Preserve Existing Governance Center
The existing Dênio Governance Center/CISO Lens is an asset. Do not replace it. Connect it to real facts and metric services progressively.

### SEC-001 — No Public Production on DEV Bypass
Do not expose real customer data or public production while critical auth/tenant-isolation issues remain unresolved. Do not weaken RLS/authentication to make a demo pass.

## Development workflow
1. Read this file and all files under `docs/` before changing code.
2. Start in PLAN mode. Do not modify files until the plan is approved.
3. Compare local branch with the read-only Dênio upstream before copying/reconciling code.
4. Propose changes by file, migration, risk and test.
5. One backlog item at a time.
6. For database changes, show normalized entities, candidate keys, FKs and cardinality before writing migrations.
7. Run relevant tests/typecheck/build after each change.
8. Inspect diff before commit.
9. Use small, reversible commits.
10. Never commit `.env`, secrets, service-role keys, JWT secrets or credentials.
11. If repository state differs from these docs, report the drift before silently reconciling it.
12. Do not merge Dênio upstream wholesale. Reuse deliberately after review.
