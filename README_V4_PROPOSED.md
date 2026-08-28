# Gov IA / CG-AG OS — V4 Proposed README

> **Do not overwrite the current README automatically.** This file is a proposed merge target because the public repo currently contains CG-AG taxonomy/documentation drift that must be reconciled deliberately.

Gov IA is a vendor-neutral **Agent Governance Control Plane** for discovering, registering, qualifying, governing, tracing, auditing and measuring AI agents across heterogeneous ecosystems.

## Core operating chain
`Repository → Discovery → Candidate Agent → Canonical Metadata → Agent Passport → Policy/Control/Risk → Decision/HITL → Evidence/Ledger → Derived Metrics → Governance Lenses`

## MVP architecture
- PostgreSQL/Supabase: operational System of Record, 3NF for new persistent models.
- Existing Governance Center/CISO Lens: preserved and connected to real facts/metrics.
- Repository Discovery: GitHub, GitLab, Azure DevOps, Bitbucket, Gitea and Forgejo are confirmed in the current scanner code.
- Privacy/Sensitive Data Discovery: evolves from existing lexical rules to name + value regex + checksum + schema + context + semantic correlation.
- Capabilities/Permissions/Authorization: first-class target model with execution identity and evidence.
- ClickHouse: planned analytical/event store when scale/concurrency/telemetry justify it.
- Neo4j: planned Graph Intelligence read model for lineage and blast radius.

## Enterprise positioning
Gov IA complements enterprise platforms such as Informatica IDMC, Microsoft Purview/Entra, Databricks, AWS, Google Cloud and ServiceNow through enrichment adapters and a canonical metadata model. Those platforms do not need to be primary repository Discovery sources.
