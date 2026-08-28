# Governance Metrics & Objectives

## Principle
Governance exists to produce measurable outcomes. The product therefore treats objectives, metrics and facts as first-class but distinct concepts.

- **Objective:** desired outcome/target.
- **Metric definition:** how that outcome is measured.
- **Facts:** historical observations from which the metric is calculated.
- **Materialization/snapshot:** optional performance artifact, never the canonical truth.

## Core MVP metric families

### Inventory & Discovery
- agent inventory count
- discovery coverage
- confirmed discovery rate
- shadow/unknown agent rate

### Ownership
- ownership coverage
- orphan agent count
- overdue ownership review count

### Risk
- inherent/residual risk distributions
- high/critical risk agent count
- risk aging
- treatment completion

### Controls
- control applicability coverage
- control assessment coverage
- design effectiveness
- operating effectiveness
- failed control count
- overdue assessment count

### Policy & Compliance
- policy applicability coverage
- policy approval status
- mandate coverage
- exception count/aging

### Evidence
- evidence coverage
- verification rate
- stale/expired evidence

### Decisions & HITL
- pending decisions
- approval SLA compliance
- escalation rate
- decision aging

### Privacy & Authorization
- agents touching personal/sensitive data
- sensitive-data category distribution
- unknown authorization count
- unknown identity count
- destructive capabilities without HITL

### Incidents
- incident count/severity
- MTTD / MTTR where runtime data exists
- recurrence

### Future FinOps / Runtime
- runs/requests
- token consumption
- cost per agent/model/provider
- budget consumption
- latency/error rate

## Derived metrics rule
Example: `CG_AG_SCORE` is calculated from applicable controls and assessment facts according to a versioned formula. It should not be stored as an authoritative agent field.

## Historical calculation
The system must support questions such as:
- “What was the score on 2026-07-31?”
- “Why did it change?”
- “Which policy/control/evidence contributed?”

## Metrics service
Dashboards should consume a Metrics/Analytics service rather than scatter ad-hoc SQL across UI components. PostgreSQL is the first implementation; ClickHouse can become an analytical backend later without rewriting the UI contract.
