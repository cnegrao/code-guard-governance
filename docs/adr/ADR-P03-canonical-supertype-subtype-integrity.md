# ADR-P03 — Canonical Supertype/Subtype Integrity

Status: Accepted

Date: 2026-08-31

## Context

Canonical V1A.1 defines eleven closed canonical object kinds with shared object identity and kind-specific identity. A wide nullable table, generic document or EAV structure would weaken type integrity and conflict with the frozen contracts and 3NF rules.

PostgreSQL FKs can ensure subtype rows reference roots, but ordinary FKs alone cannot prove that a root has exactly one compatible subtype at transaction commit.

## Decision

Use class-table inheritance:

```text
canonical_object
  -> exactly one compatible typed identity subtype
```

The closed V1A.1 kinds are exactly:

- `AGENT`
- `AGENT_VERSION`
- `MODEL`
- `TOOL`
- `MCP_SERVER`
- `API`
- `PROMPT`
- `KNOWLEDGE_BASE`
- `DATA_ASSET`
- `DATA_ELEMENT`
- `SKILL`

`canonical_object` stores only root identity, tenant, kind and minimal creation/audit facts. Typed identity and profile metadata remain outside the root.

Tenant-safe subtype FKs, subtype-specific checks and a deferrable constraint trigger guarantee at commit that every root has exactly one subtype and that its subtype matches `object_kind`. Root kind and typed identity are immutable. Only the reconciliation transaction boundary may create the root and subtype.

AgentVersion has a tenant-safe immutable parent FK to Agent. DataElement has a tenant-safe immutable parent FK to DataAsset.

## Invariants

- The kind catalog contains exactly the eleven frozen values.
- One root has exactly one compatible subtype at commit.
- Zero, multiple or incompatible subtypes are invalid.
- Root kind cannot change.
- Typed identity cannot move to another root or tenant.
- AgentVersion belongs to exactly one Agent in the same tenant.
- DataElement belongs to exactly one DataAsset in the same tenant.
- A finding or candidate cannot insert canonical identity directly.

## Relational consequences

- `canonical_object` has composite tenant identity under ADR-P02.
- Each subtype has a one-to-one PK/FK to the root and stores only fields belonging to that kind's identity grain.
- Agent-to-AgentVersion is one-to-many; DataAsset-to-DataElement is one-to-many.
- Technical profiles are separate temporal relations under ADR-P06 and are not subtype identity columns.
- The exact-one rule is checked at commit so a single transaction can insert root then subtype without a transient false failure.

## Security / tenant consequences

- Composite FKs prevent a subtype, AgentVersion parent or DataElement parent from crossing tenant boundaries.
- Creation is restricted to the private reconciliation repository/function; direct normal-role root/subtype DML is denied.
- Kind validation occurs in the database even when application input has already been typed.

## Alternatives considered

1. One wide canonical object table with nullable columns.
2. One root plus typed subtype tables with deferred integrity enforcement.
3. JSONB subtype documents.
4. Generic object attributes/EAV.
5. Independent typed tables with no common root.

## Rejected alternatives

- A wide nullable table is rejected because it permits invalid combinations and duplicates subtype semantics.
- JSONB and EAV are rejected because core typed identity must be relationally constrained and queryable.
- Independent roots are rejected because relationships, mappings and governance need one stable canonical identity spine.

## Consequences

Writes require one atomic root/subtype transaction and deferred validation. Reads that need kind-specific fields join the relevant subtype; projections can hide that mechanical detail. Adding a future object kind requires an explicitly versioned canonical-contract decision and corresponding additive subtype work.

## Implementation gates

- Freeze the relational columns and candidate keys for all eleven identity subtypes.
- Specify the deferrable trigger behavior and transaction ordering.
- Restrict DML on kind catalogs and root/subtype tables.
- Verify every parent relationship and subtype FK carries `organisation_id`.

## Required tests

- Each of the eleven kinds accepts its compatible subtype.
- Root/object-kind and subtype mismatch is rejected.
- A root with zero subtype is rejected at commit.
- Multiple subtypes for one root are rejected.
- Root kind and typed identity updates are rejected.
- AgentVersion without a same-tenant Agent is rejected.
- DataElement without a same-tenant DataAsset is rejected.
- Cross-tenant parent references are rejected.
- Transaction rollback leaves no partial canonical root.
- A candidate cannot create root/subtype outside an approved reconciliation transaction.

## Out of scope

- New canonical kinds.
- Profile, relationship and semantic state details covered by later ADRs.
- Generic custom metadata and classification persistence.
- Legacy `gov_repo.agents` conversion.
