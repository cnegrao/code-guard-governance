# As-Is vs Target — V4 FINAL

## Operational database as-is
- PostgreSQL/Supabase `gov_repo` exists with broad governance coverage.
- Current dev database has 38 known `gov_repo` tables with RLS enabled.
- Existing structures cover organisations, users/roles, mandates, policies/versions, risks/treatments, evidence, approvals/decisions, conformity/control assessments, agents, graph relationships, AI systems, incidents, regulatory changes, governance ledger and constitutional/RFC core.
- Schema presence does NOT equal finished UI/API/runtime capability.

## Dênio repository/scanner as-is — confirmed by read-only inspection
### Strong/reusable
- repository connector abstraction exists;
- GitHub, GitLab, Azure DevOps, Bitbucket, Gitea and Forgejo are explicit providers;
- connector contract normalizes repository metadata and supports tree/file/language retrieval;
- agent/framework detector recognizes many agent frameworks;
- scanner has initial PII/LGPD, lineage, trust-zone, notebooks, prompts, memory, CI/CD/IaC and shadow-AI concepts;
- GraphOS has substantial UI work in `graphos-complete`.

### Partial / target evolution
1. Agent detector mainly identifies framework signals and creates candidate agents; it is not yet a full canonical Agent Passport detector.
2. Current framework confidence is heuristic; do not market it as calibrated probability.
3. Framework default risk is a hint, not final agent risk; target risk uses actual autonomy, data, capability, environment, HITL, identity and business criticality.
4. MCP server/tool/resource must not automatically become an Agent; canonical typing/relationships must distinguish entities.
5. Current privacy scanner is primarily lexical/name regex. Value-pattern, checksum, schema/context/semantic correlation are target work.
6. Current PII finding model is too coarse for target privacy taxonomy and provenance.
7. Capability/permission/identity/authorization target is defined, but detailed implementation shown in Dênio's email has not yet been located in fetched `upstream/main`.
8. No normalized custom metadata/classification model exists yet.
9. No dedicated normalized Discovery run/finding persistence model exists yet.
10. Graph output currently includes weakly typed structures (`any[]`) in scanner DTOs; target graph contract should be canonical/typed.
11. Metrics/objectives semantic layer needs explicit implementation; scores remain derived.
12. Runtime/OTel and FinOps event models are future work.
13. Documentation has CG-AG taxonomy drift and stale traceability claims.
14. Unknown repository URL currently falls back to GitHub in registry code; target production behavior is explicit/controlled.

## Do not rewrite everything
Reuse existing connector/scanner/GraphOS assets deliberately. Build normalization, provenance, 3NF persistence and governance semantics around them.
