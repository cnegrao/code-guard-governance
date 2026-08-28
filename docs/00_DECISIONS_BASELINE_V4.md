# Gov IA — Architecture Decisions Baseline V4 FINAL

Status: **FROZEN FOR IMPLEMENTATION PLANNING**

## Decisions frozen now
1. PostgreSQL/Supabase remains the operational System of Record for the sellable MVP.
2. All NEW persistent relational models follow 3NF; existing legacy structures evolve incrementally.
3. Scanner DTOs may be nested/array-based in memory; persistence does not inherit that shape automatically.
4. Canonical Agent Metadata Model is central and supports standard metadata, classifications and N custom attributes with source fidelity.
5. Agent Passport is a projection, not a giant table.
6. Privacy is first-class agent metadata and must identify categories/subtypes and evidence, not just `hasPII`.
7. Sensitive Data Discovery target is multi-detector: lexical/name + value regex + checksum + schema/structure + code/data-flow context + semantic correlation.
8. Capabilities, permissions, execution identity and authorization evidence are first-class. `UNKNOWN` is distinct from `UNAUTHORIZED`.
9. Trust/provenance is first-class: inferred/discovered, declared, imported, observed and validated assertions are distinguishable and traceable.
10. Governance is measurable. Metrics are calculated from historical facts; objectives/targets are stored separately.
11. Existing Dênio Governance Center/CISO Lens is preserved.
12. ClickHouse is planned analytical/event storage, not an MVP prerequisite.
13. Neo4j is planned Graph Intelligence for lineage/blast radius, not an MVP prerequisite.
14. Repository Discovery is separated from enterprise enrichment, regulatory intelligence and runtime telemetry.
15. Current scanner code confirms GitHub, GitLab, Azure DevOps, Bitbucket, Gitea and Forgejo repository connectors.
16. Unknown/self-hosted providers must be explicit when URL inference cannot determine provider; production must not silently default to GitHub.
17. Regulatory communications/norms are a distinct source family feeding mandates/policy governance.
18. Runtime/OTel/log/trace/usage feeds are future sources for observed behavior, FinOps, incidents and containment.
19. CG-AG v1 IDs/semantics are frozen; current documentation drift is a P0 documentation issue.
20. Do not wholesale-merge Dênio upstream. Reuse connectors/scanner/GraphOS components after deliberate review.
