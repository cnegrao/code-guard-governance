# Graph Intelligence / Neo4j Strategy

## MVP
GraphOS continues using the existing PostgreSQL/Supabase relationship model and visualization stack.

## Target graph
`Business Process → AI System → Agent → Model → Tool/MCP/API → Data Asset → Sensitive Data`

Additional edges include agent-to-agent calls, system dependencies, authorization relationships and provider dependencies.

## Neo4j role
Neo4j is a future Graph Intelligence Engine/read model for:
- multi-hop lineage
- blast radius
- critical dependency paths
- affected agents/processes/data
- access paths to sensitive data
- privilege/authorization path analysis
- graph-based risk propagation

## Architecture rule
Introduce a graph repository/service abstraction so graph-domain logic is not bound directly to Neo4j or PostgreSQL.
