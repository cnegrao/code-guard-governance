# ADR-P08 — RLS, Auth, Membership Trust Boundary and Service Identities

Status: Accepted

Date: 2026-08-31

## Context

The current dashboard has a contained legacy JWT boundary and still uses `service_role` broadly for database access. Existing email-based tenant resolution, role claims and role arrays are not a safe final tenant/RBAC foundation. Canonical data cannot enter a normal user data plane until authenticated identity, membership and RLS agree on tenant authority.

Supabase grants determine whether an object is reachable; RLS determines which reachable rows a role may access. `service_role` bypasses RLS. Views and privileged functions require explicit review because they can also bypass intended row policies.

## Decision

The future trust chain is:

```text
Supabase Auth user
  -> active organisation membership
  -> trusted organisation_id
  -> RLS and repository authorization
```

Create one future shared membership model for tenant access and RBAC, with at least:

```text
organisation_id
membership_id
auth_user_id
status
valid_from
valid_to
```

There is no second canonical membership model. Future role assignments attach to this membership grain in 3NF.

Email, user-editable metadata, client/adaptor organisation IDs and unvalidated JWT role claims are never tenant authority. A client may request/select an organisation only after the authenticated user has an effective membership for it.

Base SOR schemas are private/default-deny. `anon` has no canonical SOR access. Grants and RLS policies are explicit. Mutations require both visibility (`USING`) and resulting-row (`WITH CHECK`) protection where applicable.

The normal user data plane never uses `service_role`. Scanner/system ingestion uses a restricted server identity or a narrow private transactional function with only the required capabilities.

`SECURITY DEFINER` is exceptional. If required, it is placed in an unexposed schema, validates the caller and trusted membership, sets a fixed safe `search_path`, receives minimum ownership privileges and has `PUBLIC` execute revoked. Invoker-security views/functions are preferred. Exposed views must obey underlying RLS or remain inaccessible to public API roles.

The current broad dashboard `service_role` path remains a production/pilot-data blocker. This ADR specifies the target boundary but does not implement Supabase Auth, membership or RLS.

## Invariants

- Authenticated identity determines membership; membership determines tenant.
- No header/body/query/path/adapter field is authoritative tenant context.
- `user_metadata` and email are not authorization sources.
- Membership is shared with future RBAC; no parallel model exists.
- `anon` cannot access canonical SOR.
- Normal user requests do not use `service_role` or another RLS-bypass role.
- Grants and RLS are both explicit and tested.
- Security-definer routines are private, minimal and non-public by default.
- Cross-tenant access is denied even when an object ID is known.

## Relational consequences

- Membership has tenant-safe identity and effective validity/status.
- RLS membership lookup is indexed by authenticated user and organisation.
- Canonical repositories receive a trusted server context or operate under the authenticated database role; they do not accept an arbitrary tenant parameter as authority.
- Future role and permission assignments reference membership rather than legacy `role_ids[]`.
- API projections expose only approved columns/operations and are not SOR.

## Security / tenant consequences

- RLS is defense against BOLA/IDOR, while composite FKs from ADR-P02 prevent cross-tenant relational attachment.
- JWT membership/role claims may become stale; authoritative sensitive decisions query effective membership/assignments rather than trusting user-editable or stale claims.
- Revocation/expiration semantics must be defined before real tenant data exposure.
- Base tables are not made safe merely by moving them outside `public`; grants, exposed-schema settings and functions remain part of review.

## Alternatives considered

1. Continue legacy JWT/email tenant resolution and broad `service_role` access.
2. Encode tenant solely in JWT/user metadata.
3. Use one database membership grain shared with future 3NF RBAC and enforce it through RLS.
4. Create separate membership concepts for canonical data and dashboard RBAC.
5. Expose base tables directly and rely only on application filtering.

## Rejected alternatives

- Legacy email/role-array authority is rejected because it is stale, weakly normalized and not a durable tenant boundary.
- User metadata/JWT-only tenant authority is rejected because claims can be user-controlled or stale.
- Parallel membership models are rejected because they can disagree about tenant access.
- Broad service-role and application-only filtering are rejected because they bypass database tenant isolation.

## Consequences

Canonical persistence can be built privately before auth migration, but no real customer data or public production path is approved until membership, grants, RLS and normal service identities are implemented and tested. The shared membership grain becomes a dependency for future RBAC integration.

## Implementation gates

- Complete Supabase Auth and membership architecture review.
- Define membership status/validity and revocation semantics.
- Replace broad normal-request `service_role` usage with an RLS-respecting path.
- Inventory exposed schemas, default privileges, views and callable functions in each environment.
- Design per-operation policies, grants and performance indexes.
- Add database-level RLS tests before any customer data exposure.

## Required tests

- Default-deny: no policy/grant means no access.
- `anon` cannot read or mutate canonical SOR.
- Tenant A cannot read, insert, update or attach Tenant B data.
- Client-supplied organisation ID cannot override membership.
- Inactive, expired or absent membership is denied.
- A valid member can access only explicitly granted tenant operations.
- Mutations validate both existing-row and resulting-row tenant ownership.
- Normal application paths do not use `service_role`.
- Restricted scanner identity cannot perform unrelated reads/writes.
- Exposed views do not bypass underlying tenant isolation.
- Privileged functions have safe search paths, explicit caller checks and no `PUBLIC` execute.
- Legacy email and `role_ids[]` cannot authorize canonical access.

## Out of scope

- Implementing Supabase Auth, membership, RBAC or RLS.
- Changing legacy JWT/token behavior.
- Migrating governance roles or `role_ids[]`.
- Environment/secrets changes.
- Remote Supabase configuration.
