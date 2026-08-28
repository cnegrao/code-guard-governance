# Data Model Principles

## 1. 3NF by Design
All new relational persistence must be in Third Normal Form unless an ADR explicitly documents an exception.

## 2. Avoid table explosion
3NF does not mean one table per field. Create a table when the entity has independent identity, lifecycle, constraints or many-to-many cardinality that justifies it.

## 3. Agent Passport is a projection
Do not create a giant `agent_passport` table duplicating canonical facts.

## 4. Facts vs metadata vs relationships vs metrics
- **Metadata/master:** what the agent/resource is.
- **Relationships:** what it connects to/depends on.
- **Facts/events:** what happened at a time.
- **Metrics:** calculations over facts and dimensions.

## 5. Temporal governance
Historical reproducibility is mandatory for governance facts. Prefer explicit validity/effective/assessment timestamps and version references.

## 6. Custom metadata
Use normalized metadata definitions/values and classification schemes/values. No per-customer schema alteration for custom attributes.

## 7. Provenance
Every discovered/imported assertion should preserve source, external ID/location, collection time and trust/validation state.

## 8. Analytical performance
Do not denormalize the OLTP schema prematurely for dashboards. Put metric/query logic behind a Metrics/Analytics service. Introduce materializations or ClickHouse only when measured workload justifies them.
