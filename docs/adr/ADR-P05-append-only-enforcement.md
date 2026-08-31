# ADR-P05 — Append-Only Enforcement and Privileged Maintenance

Status: Accepted

Date: 2026-08-31

## Context

Historical reproducibility cannot depend on application developer discipline. RLS is essential for tenant isolation but is not sufficient append-only enforcement, especially for table owners, `service_role` and other privileged roles that can bypass policies.

The persistence foundation needs explicit normal-write boundaries and a controlled path for exceptional operational maintenance without turning correction into history deletion.

## Decision

The following grains are logically append-only at minimum:

- acquisition/source observations and snapshots;
- source assertions and evidence;
- discovery findings and review history where modeled;
- normalized candidates and candidate merges/membership;
- reconciliation decisions;
- technical profile states and their support;
- object mapping states;
- governed relationship states and their support;
- semantic assignment candidates, states and decisions.

Append-only enforcement uses defense in depth:

- no normal `UPDATE` or `DELETE` grants;
- default-deny RLS with no normal mutation policy for forbidden operations;
- immutable-row triggers on authoritative historical tables where privileged accidental mutation remains material;
- narrow transactional repositories/private functions for valid inserts and state transitions;
- a separate restricted maintenance role;
- audited privileged maintenance with explicit reason and operator identity.

Corrections are represented by a new state or decision under ADR-P04, never by overwriting prior truth. Retention/archive is a future operational process and cannot silently mutate canonical history.

## Invariants

- Normal application roles cannot update or delete append-only facts.
- A correction appends; it does not rewrite.
- RLS is not the sole immutable-history control.
- Privileged maintenance is exceptional, attributable and auditable.
- Deleting a parent cannot cascade-delete historical governance truth.
- Projection rebuilds cannot alter their source facts.

## Relational consequences

- Append-only tables expose insert/select paths only where required.
- `RESTRICT`/`NO ACTION` is the default historical FK delete behavior.
- Support junctions attached to immutable states are immutable as part of that state aggregate.
- Mutable current pointers or caches, if introduced, are explicitly derived and reproducible; they are not historical SOR.
- Maintenance audit records are distinct from the canonical fact being repaired.

## Security / tenant consequences

- `service_role` is not a normal data-plane identity and is not accepted as the append-only architecture.
- Table owners and privileged maintenance roles are separately controlled and monitored.
- `SECURITY DEFINER` is not added merely to bypass a permission problem; any exceptional use follows ADR-P08.
- Tenant RLS and append-only triggers solve different threats and both remain required where applicable.

## Alternatives considered

1. Rely on repository conventions and code review.
2. Rely only on RLS.
3. Combine grants, RLS, immutable triggers and narrow transaction boundaries.
4. Periodically copy mutable rows into an audit table.

## Rejected alternatives

- Developer discipline alone is rejected because one broad repository or SQL path can erase history.
- RLS-only enforcement is rejected because privileged roles can bypass it.
- After-the-fact audit copies are rejected because they do not prevent or atomically explain mutation of authoritative facts.

## Consequences

Corrections and reversals require explicit append operations, increasing write-path rigor but preserving auditability. Exceptional data repair becomes operationally heavier by design. Future archival must distinguish cold storage from deletion of canonical truth.

## Implementation gates

- Classify every table as immutable SOR, mutable derived projection, catalog or operational configuration.
- Define normal roles and exact grants before adding policies.
- Specify immutable-trigger coverage and maintenance bypass controls.
- Establish maintenance audit fields, approver requirements and runbook before any bypass is granted.
- Verify historical FKs cannot cascade-delete facts.

## Required tests

- Normal roles can perform approved inserts and cannot update/delete append-only rows.
- Immutable triggers reject privileged accidental mutation where configured.
- Corrections append a new state while preserving the prior row.
- Deleting a referenced parent is restricted.
- Support N:N rows cannot be silently replaced after their state is committed.
- Maintenance access is unavailable to normal application/scanner identities.
- Every approved maintenance action is attributable in audit output.
- RLS bypass alone does not allow ordinary historical mutation.

## Out of scope

- Physical archive tiers, partition pruning and retention schedules.
- Legal erasure policy and cryptographic erasure design.
- Backup administration.
- Implementation of maintenance roles or triggers in this ADR-only slice.
