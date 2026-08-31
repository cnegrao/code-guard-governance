# ADR-P07 — Relationship Endpoint Matrix, Behavior Binding and Lineage

Status: Accepted

Date: 2026-08-31

## Context

Canonical V1A.1 freezes a closed governed-relationship vocabulary, direction and endpoint-kind matrix. Relationship identity is opaque and cannot be reconstructed from type/source/target. Some relationships are behavior bindings whose immutable semantics include a pinned target TechnicalFingerprint and binding configuration.

Lineage direction must remain unambiguous, tenant-safe and free of raw executable content.

## Decision

Persist exactly these twelve relationship types and endpoint rules:

| Relationship | Source | Target |
|---|---|---|
| `USES_MODEL` | AgentVersion | Model |
| `USES_TOOL` | AgentVersion | Tool |
| `USES_MCP` | AgentVersion | MCPServer |
| `INVOKES` | AgentVersion | API |
| `USES_PROMPT` | AgentVersion | Prompt |
| `USES_KNOWLEDGE_BASE` | AgentVersion | KnowledgeBase |
| `USES_SKILL` | AgentVersion | Skill |
| `EXPOSES` | MCPServer | Tool |
| `HANDOFF_TO` | AgentVersion | Agent |
| `READS_FROM` | AgentVersion | DataAsset or DataElement |
| `WRITES_TO` | AgentVersion | DataAsset or DataElement |
| `DERIVED_FROM` | DataElement | DataElement |

`relationship_id` is authoritative logical identity. `relationship_state_id` identifies an immutable temporal state. Type, source and target are immutable for one relationship ID, but their combination is only a duplicate-detection signal and has no permanent unique constraint.

A frozen relationship-type catalog and frozen endpoint-rule catalog encode the matrix. Tenant-safe endpoint FKs prove the endpoints exist; a constraint trigger validates their actual object kinds against the rule. Normal application roles receive no catalog DML.

The seven behavior-binding types are `USES_MODEL`, `USES_TOOL`, `USES_MCP`, `INVOKES`, `USES_PROMPT`, `USES_KNOWLEDGE_BASE` and `USES_SKILL`.

A behavior binding is a one-to-one extension of its logical relationship and contains only:

```text
organisation_id
relationship_id
technical_fingerprint_id
```

It contains no `profile_state_id` and no duplicated fingerprint algorithm/schema/value. Optional binding configuration is a one-to-one immutable child containing its configuration integrity hash and sanitized locator.

A deferrable constraint validates that the pinned TechnicalFingerprint belongs to the relationship target and that the relationship is one of the seven behavior-binding types. Support for the relationship, pinned fingerprint and configuration fields remains temporal relationship-state provenance.

Changing the pinned fingerprint or binding configuration is prohibited for an existing relationship. Adoption of a changed target fingerprint/configuration requires a new AgentVersion and corresponding new binding.

`DERIVED_FROM` direction is:

```text
derived/output DataElement -> origin/input DataElement
```

Cross-asset lineage is allowed. Cross-tenant lineage is forbidden. Optional transformation metadata stores only a sanitized reference and/or integrity hash, never raw SQL, Python or other executable source as canonical SOR.

## Invariants

- The relationship taxonomy and endpoint matrix exactly match frozen V1A.1.
- Relationship logical identity is opaque and not derived from endpoints.
- No permanent uniqueness exists on type/source/target.
- Type/source/target are immutable within one relationship ID.
- Behavior binding pins TechnicalFingerprint, not profile state.
- The pinned fingerprint belongs to the canonical target.
- Binding configuration is immutable within the relationship.
- Relationship-state support may evolve without changing binding identity.
- Relationship direction is significant.
- Lineage cannot cross tenants or store raw transformation code.

## Relational consequences

- Logical relationships and immutable relationship states are separate relations.
- Relationship-type and endpoint-rule catalogs are controlled reference data.
- Endpoint FKs point to the canonical object spine; database validation joins actual kinds to the frozen rule.
- Behavior binding is a one-to-one logical relationship extension with an N-to-one FK to object-owned TechnicalFingerprint.
- The same pinned fingerprint remains valid regardless of which compatible technical profile state is current.
- Relationship-state support uses normalized role-specific assertion/evidence junctions.
- The twelve type rules produce fourteen concrete valid source/target-kind pairs because `READS_FROM` and `WRITES_TO` each accept two target kinds.

## Security / tenant consequences

- Every endpoint, state, binding, fingerprint and support FK carries `organisation_id`.
- Constraint validation rejects cross-tenant and target/fingerprint substitution.
- Catalog mutation is denied to normal application/scanner roles.
- Sanitized locators and hashes are metadata, not authorization to retain secrets or source bodies.

## Alternatives considered

1. Free-form relationship type strings.
2. Unique relationship identity derived from type/source/target.
3. Frozen catalogs plus opaque IDs and database endpoint validation.
4. Behavior binding pinned to current or exact profile-state ID.
5. Behavior binding pinned independently to object-owned TechnicalFingerprint.
6. Raw transformation code stored with lineage.

## Rejected alternatives

- Free-form relationship strings are rejected because they permit taxonomy drift and invalid endpoint semantics.
- Triple-derived identity is rejected because duplicates remain observable and relationship identity is opaque.
- Profile/current-state pinning is rejected because provenance-only profile changes must not alter past behavior.
- Raw transformation content is rejected for privacy, security, size and canonical-grain reasons.

## Consequences

Relationship writes require catalog, endpoint and deferred binding validation. The model preserves duplicate observations without conflating them with identity. An old AgentVersion remains reproducible even when the target's current profile changes.

## Implementation gates

- Seed and lock the exact relationship-type and endpoint-rule catalogs.
- Define deferred kind and binding-target validators.
- Define separate immutable binding-configuration and temporal support grains.
- Specify relationship duplicate-detection reporting without adding uniqueness.
- Validate transformation locator sanitization before persistence.

## Required tests

- All twelve relationship rules are accepted, including both DataAsset and DataElement variants for `READS_FROM`/`WRITES_TO` (fourteen concrete pairs).
- Every invalid endpoint-kind combination is rejected.
- Reversed direction is rejected unless separately permitted by the matrix.
- Two logical relationships may share type/source/target while retaining different IDs.
- Type/source/target changes under one relationship ID are rejected.
- Binding remains pinned when the target's current profile state changes.
- Two target profile states may share the pinned fingerprint.
- Binding to another object's or tenant's fingerprint is rejected.
- Changing only profile provenance with the same fingerprint leaves binding unchanged.
- Changing fingerprint/configuration under the same relationship is rejected.
- A different fingerprint requires a new AgentVersion and binding.
- Cross-asset lineage is accepted; cross-tenant lineage is rejected.
- Raw transformation content and unsanitized secret-bearing locators are rejected.

## Out of scope

- New relationship types or taxonomy aliases.
- GraphOS/Neo4j projection implementation.
- Runtime call/event lineage.
- Capability and authorization relationships from V1B.
- Raw transformation source retention.
