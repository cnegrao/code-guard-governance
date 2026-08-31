# ADR-P04 — Temporal State, Supersession and Current/As-Of Projections

Status: Accepted

Date: 2026-08-31

## Context

Governance must reconstruct what was effective and what was known at a past time. Canonical contracts therefore distinguish effective validity from record time and use supersession for corrections. Treating the newest timestamp as truth would erase that distinction and produce irreproducible projections.

Semantic assignments add a separate identity issue: one DataElement/SemanticConcept pair can have distinct governed assignment lifecycles. The pair is not a permanent logical ID.

## Decision

Temporal state uses the half-open effective interval:

```text
[valid_from, valid_to)
```

`valid_to` is null for an open interval or strictly greater than `valid_from`. `recorded_at` is separate from effective validity.

State rows are immutable. Supersession is the correction or replacement of one exact recorded state; it is not ordinary temporal succession. A superseding state must:

- use the same tenant and logical identity;
- have a different state ID;
- reference the exact prior state;
- have a later `recorded_at`;
- preserve immutable identity fields;
- leave the prior row unchanged.

These semantics apply to profile, mapping, relationship and semantic-assignment state where present. Cross-row validation uses repository locking and deferred constraint validation where ordinary constraints are insufficient.

For semantic assignment, `assignment_id` is authoritative. DataElement and SemanticConcept are immutable within one assignment, but the endpoint pair is not globally unique. Distinct historical assignments may reuse it.

Adopt this effective-state invariant:

> For one tenant and DataElement/SemanticConcept pair, no more than one logical assignment lifecycle may be effective at the same instant.

It is enforced as temporal overlap validation over authoritative, non-superseded states—not as permanent `UNIQUE(pair)`. Validation must serialize concurrent writes for the endpoint pair and must not treat a superseded historical state as a competing effective state.

Current and as-of models are derived projections. There is no inferred “current AgentVersion” based on maximum version code or timestamp.

## Invariants

- Effective and recorded time remain distinct.
- Intervals are half-open and valid.
- State history is append-only.
- Supersession targets one exact earlier state and never mutates it.
- Ordinary succession is not encoded as correction.
- `assignment_id` is not derived from DataElement/SemanticConcept.
- Historical assignment lifecycles may reuse the endpoint pair.
- Simultaneously effective assignment lifecycles for the same pair are rejected.
- Superseded history remains queryable and does not cause false overlap failures.

## Relational consequences

- Logical identity tables are separate from immutable state tables.
- State PKs and supersession FKs include tenant and logical identity where required to prove ownership.
- No ordinary `CHECK` is claimed to validate other rows.
- Deferred validation may inspect the effective non-superseded state set after all rows in a transaction are present.
- Current projections select authoritative effective state; as-of projections evaluate both validity and record-time requirements explicitly.
- The semantic assignment logical table has no permanent unique constraint on its endpoint pair.

## Security / tenant consequences

- Supersession FKs and overlap checks are tenant-scoped.
- Normal roles cannot update a prior state to hide or shorten history.
- Transaction functions/repositories derive tenant from trusted context under ADR-P08.
- Lock keys and queries always include tenant so one tenant cannot control another tenant's lifecycle.

## Alternatives considered

1. Mutable current rows with audit logs.
2. Append-only immutable states with explicit validity and supersession.
3. Treat latest `recorded_at` as current.
4. Permanent uniqueness of semantic endpoint pair.
5. Temporal uniqueness only over simultaneously effective semantic assignments.

## Rejected alternatives

- Mutable state is rejected because it weakens historical reproducibility.
- Latest-timestamp inference is rejected because recorded and effective time differ.
- Permanent endpoint uniqueness is rejected because a later independent governed lifecycle requires a new `assignment_id`.
- A naive exclusion across all state history is rejected because corrected/superseded records may legitimately overlap their replacements.

## Consequences

Temporal queries and writes are more explicit and require deterministic locking. In return, corrections remain auditable, later classifications can be independently re-established and current projections remain reproducible. Simultaneous semantic duplicates are prevented without erasing history or converting endpoint pairs into identity.

## Implementation gates

- Define authoritative/non-superseded state selection for each state family.
- Specify deterministic tenant/logical-ID lock ordering.
- Design deferred semantic-overlap validation and its concurrency test before migration.
- Define current and as-of views without relying on ambiguous maximum timestamps.
- Confirm every state family preserves its immutable identity fields on supersession.

## Required tests

- Null `valid_to` and a valid bounded interval are accepted.
- `valid_to <= valid_from` is rejected.
- A supersession with wrong tenant, logical identity or prior state is rejected.
- A supersession with the same state ID or non-later `recorded_at` is rejected.
- Prior state remains unchanged after correction.
- Current and as-of projections return the expected state.
- Two historical semantic assignments reuse the same endpoint pair in non-overlapping lifecycles.
- Simultaneously effective assignments for that pair are rejected.
- A superseded historical assignment state does not cause false overlap rejection.
- Concurrent attempts cannot create two effective assignments for the same pair.
- No projection infers current AgentVersion from `MAX` or creation time.

## Out of scope

- Event sourcing for all application data.
- Retention and archival policy.
- Deployment/activation semantics for AgentVersion.
- Bi-temporal optimization or partitioning.
