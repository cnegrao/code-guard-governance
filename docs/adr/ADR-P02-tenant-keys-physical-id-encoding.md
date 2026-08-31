# ADR-P02 — Tenant Keys, Composite FK Strategy and Physical ID Encoding

Status: Accepted

Date: 2026-08-31

## Context

Canonical V1A.1 identifiers are opaque branded strings. That domain property does not select a PostgreSQL type. Persistence needs a deliberate physical encoding and must make cross-tenant references structurally impossible rather than relying on repository filters.

The new canonical model is tenant-local, while external providers control identifiers that are not necessarily UUIDs and may be case-sensitive.

## Decision

Every tenant-local relational identity is addressed by:

```text
(organisation_id, domain_id)
```

Every tenant-local FK carries `organisation_id`, and no repository lookup may address a tenant-local object by `domain_id` alone.

New internal domain IDs use the PostgreSQL `uuid` physical type. UUID is a persistence encoding decision only; the frozen TypeScript contracts remain opaque branded strings. UUIDv4 is the foundation generation strategy unless an equivalent existing non-semantic UUID convention is demonstrated before migration.

Canonical/domain UUIDs are created only inside a trusted persistence boundary. Allowed generation mechanisms are a trusted server-side service/repository, a private controlled PostgreSQL transactional function, or a controlled PostgreSQL column `DEFAULT`.

A PostgreSQL-side UUID `DEFAULT` is allowed only when the table/grain is governed by the trusted persistence design, untrusted callers cannot choose or replace canonical identity, tenant context is independently validated, and normal application paths cannot override canonical identity authority. The generation mechanism may vary by internal ID grain; the authority boundary may not.

Browser clients, adapters, client/body payloads and other untrusted external inputs cannot select canonical identity. External/provider identifiers are never reused or transformed into canonical UUIDs.

External provider identifiers remain opaque, exact, case-sensitive `TEXT`. SourceObject contract identity remains:

```text
connection + externalType + externalId
```

A private UUID surrogate for a source-object row is permitted as an FK locator, but it neither replaces nor changes that contract identity.

Historical and authoritative FKs default to `RESTRICT`/`NO ACTION`. Every referencing composite FK receives an index whose leading columns match expected tenant-scoped access.

## Invariants

- `organisation_id` is part of every tenant-local PK/FK path.
- A tenant-local ID alone is never sufficient repository authority.
- Adapter or client `organisation_id` is never authoritative.
- Internal UUID generation is non-semantic and occurs only at a trusted boundary.
- External IDs are not coerced, lowercased, parsed as UUIDs or regenerated.
- Provider code, path and display name do not replace SourceObject identity.
- Deletes cannot silently remove historical dependents.

## Relational consequences

- `gov_repo.organisations.organisation_id` is the existing UUID primary key and is reused as-is as the initial tenant root; no migration or replacement of `gov_repo.organisations` is required.
- Tenant-local roots use composite PKs such as `(organisation_id, canonical_object_id)`.
- Child tables repeat `organisation_id` as a key component, not as denormalized descriptive data.
- Composite FKs prevent a valid ID from tenant A being attached to tenant B.
- Referencing-side indexes are mandatory because PostgreSQL does not create them automatically for FKs.
- Source objects retain an exact unique candidate key over tenant, connection and opaque external identity even when a private row UUID is used.

## Security / tenant consequences

- Tenant isolation has a physical referential layer in addition to RLS.
- Repositories require a trusted tenant context and reject client-selected tenant authority.
- RLS policies may filter by `organisation_id`, but cannot compensate for an ID-only FK or lookup.
- UUID unpredictability is not treated as authorization.

## Alternatives considered

1. UUID physical IDs generated at trusted boundaries.
2. `TEXT` for all internal IDs to preserve physical format agnosticism.
3. Global UUID PKs with tenant checked only in application code.
4. Provider-derived or client-generated canonical IDs.

## Rejected alternatives

- All-`TEXT` internal IDs are rejected for this foundation because they enlarge composite indexes/FKs and introduce unnecessary collation and validation ambiguity for identities Gov IA controls.
- Global ID-only FKs are rejected because they do not physically prevent cross-tenant attachment.
- Provider-derived and client-generated canonical authority is rejected because it crosses the reconciliation trust boundary.

## Consequences

The persistence adapter validates and serializes UUIDs while the domain remains format-agnostic. A future change of internal encoding would require an ADR and migration, but external identity remains unaffected. Random UUIDv4 insertion locality must be monitored; this is accepted for the foundation because correctness and dependency-free trusted generation take priority over premature optimization.

## Implementation gates

- Inventory every new internal ID and classify it as tenant-local or global catalog identity.
- Confirm references use the existing `gov_repo.organisations.organisation_id` UUID primary key as the tenant root without migrating or replacing that table.
- Define a documented trusted UUID generation policy per internal ID grain. The policy may select trusted repository/service generation, private controlled PostgreSQL function generation, or a controlled PostgreSQL column `DEFAULT`; it must prohibit browser, client/body, adapter and other untrusted identity-authority paths.
- Review every FK for tenant columns, delete behavior and referencing index.
- Preserve exact external-ID collation/equality semantics in migration design.

## Required tests

- A composite FK rejects a child referencing another tenant's parent.
- Every tenant-local repository lookup requires trusted `organisation_id`.
- A non-UUID internal domain ID is rejected at the persistence boundary.
- A trusted boundary generates valid non-semantic UUIDs.
- An adapter-supplied canonical ID is ignored or rejected.
- An adapter-supplied organisation ID cannot select the write tenant.
- External IDs with provider-specific, non-UUID and case-distinct values round-trip unchanged.
- The SourceObject natural identity is stable with or without the private surrogate.
- Referencing composite FKs have suitable indexes.

## Out of scope

- Changing Canonical V1A.1 identifier types.
- Global custom metadata and taxonomy identity design.
- Public client ID allocation.
- Sequential IDs, UUIDv7 extensions or external ID normalization.
