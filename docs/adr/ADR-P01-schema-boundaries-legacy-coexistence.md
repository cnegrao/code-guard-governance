# ADR-P01 — Schema Boundaries, Data API Exposure and Legacy Coexistence

Status: Accepted

Date: 2026-08-31

## Context

Gov IA already has a broad operational model in `gov_repo`. That model is legacy: it contains useful operational data but does not implement the frozen Canonical V1A.1 grains and includes structures that must not dictate the new 3NF System of Record. PostgreSQL/Supabase remains the operational System of Record; GraphOS and any future graph engine consume projections from it.

Supabase Data API exposure depends on both exposed-schema configuration and PostgreSQL privileges. Platform defaults can differ by project and change over time, so schema placement alone cannot be treated as an access-control guarantee.

## Decision

Create four new bounded schemas when persistence implementation begins:

- `canonical`: canonical object spine, typed identities, immutable technical profile history, DataAsset/DataElement structure, governed relationships and lineage;
- `discovery`: source systems/connections, acquisition, source observations, assertions, evidence, findings, candidates, merges, reconciliation decisions and object mapping history;
- `semantic`: semantic identities, semantic inference candidates, semantic reconciliation decisions and governed semantic assignments;
- `app_api`: future controlled views and functions only; it contains no System-of-Record tables.

The existing `gov_repo` schema remains intact during P1.0.4. Initially, only `gov_repo.organisations` is reused as the tenant root. Legacy `agents`, `agent_edges`, `agent_resource_links`, `evidence`, embeddings and role arrays are not canonical grains.

Legacy content may later enter the canonical pipeline through an explicitly controlled legacy `SourceSystem`. There is no legacy/canonical dual-write. Compatibility views may be added later as projections after their security and semantics are reviewed.

## Invariants

- PostgreSQL/Supabase is authoritative for operational canonical truth.
- New core SOR relations follow 3NF.
- `gov_repo` is preserved; this decision does not destructively reinterpret legacy rows.
- `app_api` is an API/projection boundary, never a second source of truth.
- GraphOS is downstream and may be rebuilt from PostgreSQL facts.
- Base SOR schemas are private and default-deny.
- Data API exposure is explicit; no implementation relies on platform defaults.
- There is no dual-write between legacy and canonical structures.

## Relational consequences

- New tenant-local tables reference `gov_repo.organisations` through tenant-safe keys described in ADR-P02.
- Cross-schema dependencies flow from discovery/semantic processes toward canonical identity without copying canonical facts into API projections.
- `app_api` objects expose the minimum shape required by a use case and remain reproducible from base relations.
- Legacy ingestion, if introduced, preserves the legacy row/source identity as provenance rather than copying rows directly into canonical tables.

## Security / tenant consequences

- `canonical`, `discovery` and `semantic` are not placed in the exposed `public` schema.
- No `anon` access is granted to base SOR objects.
- Grants and RLS are separate controls and must both be reviewed before exposure.
- Any future exposed view must use caller/invoker security semantics where supported, or otherwise remain in an unexposed schema with explicit revocations.
- Privileged functions follow ADR-P08 and never become public merely because they exist.

## Alternatives considered

1. Reuse the existing legacy tables as canonical persistence.
2. Destructively migrate `gov_repo` into a new physical model.
3. Put canonical tables in `public` and rely only on RLS.
4. Dual-write every mutation to legacy and canonical tables.
5. Build clean bounded schemas beside the legacy model and reconcile deliberately.

## Rejected alternatives

- Direct legacy reuse is rejected because legacy grains and cardinalities do not represent the frozen canonical contracts.
- Destructive rewrite is rejected because it creates unnecessary operational and rollback risk.
- `public` placement is rejected because it unnecessarily broadens the Data API attack surface.
- Dual-write is rejected because it creates two competing truths and failure modes that are difficult to reconcile.

## Consequences

The model can evolve without silently rewriting the existing application. This temporarily leaves two models in the database, so ownership must remain explicit: legacy screens continue to use legacy data until a reviewed projection or migration path replaces them. Compatibility work becomes a deliberate later slice rather than an implicit feature of persistence.

## Implementation gates

- Confirm the actual local and remote schema/exposed-schema configuration before migrations.
- Approve ADR-P02 through ADR-P09.
- Inventory every proposed cross-schema FK and grant.
- Define the first private repository boundary before exposing any projection.
- Do not expose real tenant data while the P0.5 authentication/RLS blockers remain.

## Required tests

- Base SOR schemas are absent from the configured Data API exposure unless explicitly approved.
- `anon` cannot access base SOR objects.
- `app_api` contains no SOR tables.
- A compatibility projection cannot mutate canonical or legacy truth.
- GraphOS projections can be rebuilt without becoming write authority.
- No canonical transaction writes a legacy canonical-equivalent row.

## Out of scope

- Migration SQL and remote Supabase configuration.
- Legacy data backfill or deletion.
- Compatibility views and GraphOS integration.
- ClickHouse, Neo4j and vector persistence.
