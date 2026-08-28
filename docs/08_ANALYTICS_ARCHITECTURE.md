# Analytics Architecture

## MVP
Use PostgreSQL/Supabase for operational queries and native dashboards. Optimize through proper relational design, indexes, views/materialized views only where justified, and a central Metrics Service.

## Future analytical path
`PostgreSQL/Supabase → CDC/Events → ClickHouse → Metrics/Semantic Layer → Native Analytics / Power BI / Fabric / Tableau / Databricks`

## Why ClickHouse later
- columnar analytical workload
- high-volume immutable events
- telemetry/runtime/FinOps
- time-series aggregation
- high dashboard concurrency

## Why not replace PostgreSQL now
Governance core requires transactional consistency, constraints, referential integrity, workflows, approvals, policies, evidence and normalized operational state. PostgreSQL is well suited to that role.

## Neo4j is not the analytical warehouse
Neo4j serves Graph Intelligence: lineage, dependency traversal, paths, impact analysis and blast radius. It complements both PostgreSQL and ClickHouse.
