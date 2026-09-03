# Architecture Decisions

This file records Product Owner decisions and approved local architecture contracts carried through the current persistence-hardening work. It remains subordinate to executable/versioned repository artifacts and approved ADRs and architecture documents.

## Wave A semantic decisions

### `gov_repo.governance_users.preferred_mfa`

Classification: **LEGACY / UNUSED / NON-AUTHORITATIVE**.

The field is not MFA enrollment state, MFA verification state, authentication enforcement, authorization authority, or identity-provider synchronization authority.

### `gov_repo.governance_roles.can_approve_up_to`

Classification: **LEGACY / UNUSED / NON-AUTHORITATIVE**.

The field does not define authorization, approval authority, workflow authorization, role hierarchy, or approval limits. Structured permissions and workflows are authoritative.

### `gov_repo.governance_ledger.actor_session_id`

Classification: **LEGACY / DEPRECATED / NON-AUTHORITATIVE**.

The field is not authentication-session identity, authorization authority, JWT or session authority, actor identity authority, or ledger-integrity evidence. No new producer or consumer is to be created for it.

### `gov_repo.mandates.mapped_policies`

Classification: **LEGACY / DENORMALIZED / NON-AUTHORITATIVE**.

The field is not the source of truth for policy-to-mandate relationships. It has no approved synchronization, dual-write, trigger, consumer, or backfill behavior.

### `gov_repo.policy_mandate_mappings`

Classification: **CANONICAL POLICY-TO-MANDATE RELATIONSHIP REPRESENTATION**.

This relation is the authoritative normalized representation of policy-to-mandate relationships in the current `gov_repo` model.

The relation is tenant-local. Tenant ownership derives from `gov_repo.governance_policies.organisation_id` through `policy_id`; the mapping's `organisation_id` is a physical tenant key derived from that policy and is not an independent tenant-authority claim.

A mapping may reference a global mandate whose `organisation_id` is NULL or a tenant-local mandate owned by the same organisation. A tenant policy must not reference a mandate owned by another tenant.

M1A-R2-G1 did not change this ownership model. G1-FIX attempted to coordinate mapping writes and mandate tenant changes through a mapping-side `FOR SHARE` lock on the mandate business row. M1A-R2-G1-R2 rejected that attempt because a locking read does not create the real MVCC conflict required under Repeatable Read and because row-trigger parent acquisition retained opposite-order bulk deadlock paths.

M1A-R2-G1-R3 approved a private `gov_repo.mandate_mapping_guards` relation with one tenant-neutral technical counter per mandate. Mapping relationship writes and mandate ownership changes must acquire affected guard rows by ascending `mandate_id` with `NOWAIT`, perform a real counter increment, and then validate the relationship. Mapping ownership continues to derive exclusively from the protected governance-policy key; the guard is neither tenant authority nor a business or governance version.

M1A-R2-G1-R4 implements this protocol in the local pending migration with PostgreSQL 17 statement-level transition-table triggers. M1A-R2-G1-R4A returned `CHANGES_REQUIRED`, not `BLOCKED`: it found no remaining tenant-integrity, concurrency, RLS, rollback, or PostgreSQL 17 syntax blocker, but required target-list-aware validation of explicitly assigned mapping tenant values and a canonical full-transaction retry contract.

M1A-R2-G1-R4B adds a fail-fast `BEFORE UPDATE OF organisation_id` validator that runs before the general derivation trigger. A caller-explicit `organisation_id` that differs from the tenant of the new referenced policy is rejected with `23514`; omitting `organisation_id` during policy reassignment continues to derive the new policy tenant automatically. The validator does not create a second ownership authority: `governance_policies.organisation_id` remains authoritative.

### Concurrency recovery contract

`55P03` (`lock_not_available`), `40001` (`serialization_failure`), and `40P01` (`deadlock_detected`) mean the current Unit of Work has failed. The caller must roll back the entire transaction, discard every transaction-local result from that attempt, and retry the complete Unit of Work from its beginning. Retrying only the failed statement, or treating rollback-to-savepoint plus statement retry as the canonical recovery path, is prohibited.

Future application handling uses bounded retry with backoff and jitter. Exhausting that budget surfaces an operational concurrency failure; these SQLSTATEs must not be converted into tenant or business-invariant errors. A future savepoint-specific recovery workflow requires separate evidence and design review.

The intentional design patterns are Serialization Guard / Concurrency Guard as the primary pattern, complemented by Guard Clause / Fail-Fast, Ordered Locking, Unit of Work, Retry Pattern, and Invariant Validation.

### Runtime Validation Outcome (G2-E3/E4)

**Status: RUNTIME_PROVEN_FOR_CONTROLLED_ENVIRONMENT**

The M1A-R2 architecture has been validated through controlled runtime testing:

- **G2-E3 PASSED**: Structural and functional validation in disposable controlled Supabase environment (`ov-ia-g2-test`, ref: `zkqfvqwqdypgpzauzinw`).
- **G2-E4 PASSED**: Concurrency validation across READ COMMITTED, REPEATABLE READ, and SERIALIZABLE isolation levels; mixed isolation matrices; bulk contention; hot guard scenarios.

#### Design Patterns Proven in Controlled Environment

| Pattern | Evidence |
|---------|----------|
| Serialization Guard / Concurrency Guard | Real MVCC guard-row increments observed; mapping-first RR stale snapshot anomaly closed; 40001 reproduced and recovered |
| Ordered Locking | Opposite bulk input order failed fast with 55P03; no custom deadlock; deterministic `mandate_id` ascending acquisition |
| Fail-Fast / NOWAIT | Real 55P03 repeatedly reproduced; no hangs; immediate failure on lock contention |
| Unit of Work | Full transaction rollback before replay proven; no statement-only or savepoint-only retry |
| Retry Pattern | Coherent recovery: 55P03/40001 -> full replay -> 23514 or 00000 |
| Invariant Validation | Universal cross-tenant invariant: min=0, max=0, expected=0 across all tests |

#### SQLSTATE Evidence Observed

- `00000` (successful operations)
- `23503` (missing parent / FK violation)
- `23514` (business invariant violation)
- `40001` (serialization_failure — reproduced under RR and Serializable)
- `42501` (privilege fault)
- `55P03` (lock_not_available — repeatedly reproduced)

#### 40P01 Status

`40P01` (deadlock_detected) was **NOT_DETERMINISTICALLY_REPRODUCED**. This is NOT a failure. The architecture was NOT weakened or manipulated merely to force a 40P01. Ordered locking with NOWAIT eliminates realistic deadlock paths in this protocol.

#### Findings Severity

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0
- LOW: 0

Only INFO-level observations were recorded.

#### Production Status

This controlled validation **DOES NOT** authorize production deployment. Production execution requires a separate online migration/deployment strategy gate. The following remain open risks:

1. Application full-Unit-of-Work retry implementation
2. Production online migration / locking strategy
3. ADR-P08 service-role redesign
4. Deployed-environment grant / exposure drift

See `docs/codex/evidence/2026-09-01-m1a-r2-g2-runtime-validation.md` for full evidence record.
