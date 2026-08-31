# ADR-P09 — Reconciliation, Confirmed Mappings and Atomic Transactions

Status: Accepted

Date: 2026-08-31

## Context

Discovery findings and normalized candidates are evidence-bearing proposals, not canonical truth. Canonical creation, matching, candidate merge, relationship creation and semantic assignment require explicit governed decisions and atomic persistence. Partial commits could otherwise create roots without subtypes, decisions without mappings or bindings with inconsistent fingerprints.

Concurrent reconciliation must not create duplicate canonical truth. External scans and provider calls must not extend database lock duration.

## Decision

Object reconciliation supports exactly:

- `CREATE_NEW`
- `MATCH_EXISTING`
- `MERGE_CANDIDATES`
- `REJECT`
- `DEFER`

Decision authority is exactly `HUMAN` or `DETERMINISTIC_RULE`. AI/LLM output may inform a candidate but is never reconciliation authority.

Decisions are immutable and outcome-specific. Physical persistence uses a decision root plus constrained outcome-specific relations where necessary rather than a nullable mega-table that permits invalid combinations.

A candidate remains separate from canonical identity. Candidate merge preserves flattened leaf membership and complete provenance; it neither creates canonical identity nor merges existing canonical objects.

ObjectSourceMapping uses a logical mapping plus immutable mapping states. States may be `PROPOSED`, `CONFIRMED`, `REJECTED` or `SUPERSEDED`, but canonical truth consumes only a confirmed, reconciled, decision-backed projection. `PROPOSED` never means canonical equality. `CONFIRMED` requires a successful `CREATE_NEW` or `MATCH_EXISTING` decision that resolves the same source/candidate provenance to the same canonical object.

The following are atomic transaction boundaries:

### Object CREATE_NEW

```text
lock candidate or merge leaves
-> persist decision
-> create canonical root
-> create exactly one subtype
-> create confirmed source mappings
-> persist support/provenance
-> deferred validation
-> commit
```

### Candidate merge

```text
persist merge decision
-> create merge artifact
-> flatten and persist every leaf candidate membership
-> validate same kind and tenant
-> commit
```

### Profile state

```text
create or reuse exact object-owned TechnicalFingerprint when applicable
-> create profile state
-> associate fingerprint
-> create typed profile-state subtype
-> persist field support
-> deferred validation
-> commit
```

### Relationship CREATE_NEW

```text
lock and validate relationship candidate
-> persist decision
-> create logical relationship when new
-> create behavior binding when applicable
-> create relationship state
-> persist lineage/configuration/support
-> deferred endpoint and fingerprint validation
-> commit
```

### Semantic CREATE_NEW

```text
lock and validate semantic candidate
-> persist decision
-> create assignment when new
-> create assignment state
-> persist support
-> validate effective overlap
-> commit
```

All external scanning, network/provider calls and expensive non-database inference complete before opening these transactions. Locks are acquired in deterministic tenant/type/ID order and held only for the persistence-critical section. Conflicting concurrent reconciliation must resolve to one canonical result or fail/retry; it cannot independently create two truths.

## Invariants

- Candidate/finding/confidence never equals authority or canonical truth.
- Every canonical creation/match is backed by an immutable successful decision.
- AI/LLM is not decision authority.
- Merge preserves all leaf candidates and provenance.
- Only confirmed, decision-backed mappings feed canonical projections.
- Proposed mappings are excluded from canonical truth.
- Each aggregate transaction is all-or-nothing.
- External calls occur outside database transactions.
- Lock ordering is deterministic and tenant-scoped.
- Concurrent reconciliation cannot double-create truth.

## Relational consequences

- Decisions have a root grain and outcome-specific details with tenant-safe FKs.
- Mapping logical identity and mapping-state history are separate.
- Confirmed mapping projections join successful decisions rather than infer truth from row existence.
- Candidate merge membership is N:N/associative and stores leaf candidate IDs, not a nested array.
- TechnicalFingerprint reuse occurs by the exact ADR-P06 candidate key before profile state association.
- Relationship and semantic transactions invoke deferred integrity from ADR-P04/P07.

## Security / tenant consequences

- Decisions, candidates, mappings and resulting canonical identities must share trusted tenant context.
- Decision authority is authenticated/authorized by the service layer; a serialized decision object is not self-authenticating.
- Normal clients cannot call low-level tables to bypass reconciliation.
- Private transactional functions, if used, follow ADR-P08 and expose no broad privileged execution.
- Cross-tenant merge, mapping, decision and target substitution are rejected by composite FKs and validation.

## Alternatives considered

1. Promote a candidate by directly inserting a canonical row.
2. Treat any mapping row as canonical equality.
3. Persist each aggregate step in separate transactions with cleanup on failure.
4. Use explicit outcome-specific decisions and atomic aggregate transactions.
5. Let AI confidence automatically confirm reconciliation.

## Rejected alternatives

- Direct promotion is rejected because it bypasses governance authority and provenance.
- Row-existence mapping semantics are rejected because proposed and confirmed meanings differ.
- Multi-transaction cleanup is rejected because failures expose partial canonical truth.
- AI/confidence authority is rejected because probabilistic output is not an accountable governance decision.

## Consequences

Repositories become command-oriented and transaction-aware rather than generic CRUD. Contention requires retry/error semantics and deterministic locking, but partial truth and ambiguous mappings are prevented. Read projections can remain simple because confirmation semantics are explicit.

## Implementation gates

- Define trusted command contracts and decision authorization checks.
- Define candidate/merge and semantic lock keys and deterministic ordering.
- Specify exact outcome-specific decision cardinalities.
- Define confirmed-mapping projection and prohibit direct normal DML.
- Add rollback and concurrency integration tests before exposing reconciliation APIs.
- Keep all provider/network work outside transaction scopes.

## Required tests

- A candidate cannot become canonical truth without a successful decision.
- Decision rows and outcome-specific details are immutable and valid as a unit.
- AI/LLM cannot be stored as reconciliation authority.
- Merge preserves every flattened contributing candidate exactly once.
- Cross-kind or cross-tenant merge is rejected.
- `CONFIRMED` mapping requires a successful decision resolving the same canonical object.
- `PROPOSED` mapping is absent from canonical truth projection.
- Object creation rollback leaves no root, subtype, mapping or partial support.
- Profile rollback leaves no partial profile/fingerprint association.
- Relationship rollback leaves no partial relationship/binding/state.
- Semantic rollback leaves no partial assignment/state.
- Concurrent reconciliation cannot double-create canonical truth.
- Deterministic lock ordering avoids known inverse-order deadlocks.
- External calls are not made while database locks are held.

## Out of scope

- Reconciliation UI and approval workflow.
- AI matching implementation.
- Runtime scanner/provider integration.
- Generic CRUD repositories.
- Migration SQL and remote database execution.
