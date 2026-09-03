# G2 Runtime Validation Evidence — M1A-R2

Date: 2026-09-01
Status: RUNTIME_PROVEN_FOR_CONTROLLED_ENVIRONMENT

## Purpose

Record canonical controlled runtime validation evidence for the M1A-R2 policy_mandate_mappings tenant-isolation remediation.

## Authorized Environment

- Disposable controlled Supabase project: `ov-ia-g2-test`
- Project ref: `zkqfvqwqdypgpzauzinw`
- PostgreSQL: 17.6
- `gov-ia-dev` was explicitly prohibited and untouched
- No production data was accessed

## Migration Integrity

- Target migration: `supabase/migrations/20260901134812_policy_mandate_mapping_tenant_isolation.sql`
- SHA-256 during controlled execution: `b060e13939666dd303f6a09cc38a75ab1078a99b2d93a90b1c1e5cfeba8563da`

## G2-E3 — Structural and Functional Proof

### Baseline

- Exactly 37 historical migrations before target
- First migration: `20260818003539_gov_repo_types_and_organisations.sql`
- Last historical migration: `20260901021520_wave_a_metadata_comments.sql`
- 38 tables, 23 views, 223 indexes, 1 sequence, 19 routines
- RLS enabled on all 38 tables
- 69 policies
- Seed: governance_roles=13, mandates=39, workflow_templates=6

### Pre-Target Vulnerable State Confirmed

- Authenticated `SELECT USING(true)` existed on `policy_mandate_mappings`
- No guard table/functions/triggers present

### E3 Result

**G2_E3_PASSED**

### Structural Assertions Passed (A-W)

- Migration applied successfully
- Remote migration history: exactly 38, target migration last
- Guard table: `mandate_id` + `guard_version` only
- Initial guard coverage: 39/39
- No orphan/missing guard rows
- 7 approved functions
- 6 triggers
- 3 transition triggers
- SECURITY DEFINER count: 0
- All helpers: SECURITY INVOKER
- Unsafe authenticated `SELECT USING(true)` removed
- No replacement authenticated mapping policy
- PUBLIC/anon/authenticated mapping table privileges absent
- Service_role historical privileged behavior preserved
- Guard table: RLS enabled
- Guard privileges: SELECT/INSERT/UPDATE only (no DELETE/TRUNCATE)
- Helper EXECUTE revoked from clients

### Functional Matrix Passed

- INSERT I1-I8: expected outcomes 00000, 23514, 23503, 23505
- UPDATE D/E/F/G passed
- Explicit organisation conflict rejected before normalization
- U1-U6 passed
- T1-T7 passed
- G1-G8 passed

### Guard Version Evidence

- Relationship insert: 28 -> 29
- Notes-only update: 29 -> 29 (no increment)
- Mandate ownership update: 29 -> 30
- Two mappings same mandate in one INSERT: 31 -> 32

### Composite FK / Policy Ownership Race Local Semantics

Passed.

### Universal Cross-Tenant Invariant

0 violations after every matrix.

### E3 Cleanup State

- roles = 13
- mandates = 39
- workflows = 6
- mappings = 0
- guards = 39/39
- cross-tenant invariant violations = 0

### E3 Final Gate

**READY_FOR_G2_E4_CONCURRENCY: YES**

---

## G2-E4 — Concurrency Proof

### Final Result

**G2_E4_PASSED**

### Concurrency Harness Evidence

- Maximum simultaneous independent sessions: 3
- Distinct PostgreSQL backend PIDs: 9
- Lingering transactions after tests: 0
- Genuine separate psql processes used

### Isolation Level Coverage

#### READ COMMITTED

- mapping-first: 55P03 -> full transaction replay -> 23514, invariant = 0
- mandate-first: 55P03 -> replay -> 23514, invariant = 0

#### REPEATABLE READ

- mapping-first stale snapshot: 40001 -> replay -> 23514, invariant = 0
- mandate-first: 40001 -> replay -> 23514, invariant = 0

#### SERIALIZABLE

- both directions: 40001 -> replay -> 23514, invariant = 0

### Historical RR Race Outcome

Failed closed through real guard-row MVCC conflict.

### Mixed Isolation Matrix (A-F)

All: 40001 -> 23514, invariant = 0. No incompatible commit occurred.

### Compatible Concurrency

- RC/RR/SERIALIZABLE
- Initial contention: 55P03
- Full replay: 00000
- Final state: mapping tenant A, mandate tenant A, invariant = 0

### Bulk Contention

- Two guards forward/reverse
- Three guards
- Opposite input order

Observed: 55P03 -> replay -> 23514.

- No deadlock
- No hang
- No custom lock cycle
- NOWAIT failed immediately as designed

### Hot Guard / 3 Sessions

- One winner
- Two contenders received 55P03 / 55P03
- Replays produced 23514 / 00000
- No hang
- guard_version: 30 -> 32 (exactly two successful operations incremented)
- Rolled-back contenders incremented: 0

### Reassignment / Policy Races

All failed closed.

### Mapping INSERT vs Policy Ownership Replay

23503 through composite FK.

### Delete Races

Valid. No orphan state.

### Universal Invariant

- minimum = 0
- maximum = 0
- expected = 0

### Observed SQLSTATEs

- 00000
- 23503
- 23514
- 40001
- 42501
- 55P03

### 40P01 (deadlock_detected) Status

**NOT_DETERMINISTICALLY_REPRODUCED**

This is NOT a failure. The architecture was NOT weakened or manipulated merely to force a 40P01.

### Canonical Retry Contract Proven

- Full transaction rollback occurred before replay
- No statement-only retry
- No savepoint-only retry

---

## Design Pattern Runtime Validation

| Pattern | Status |
|---------|--------|
| Serialization Guard / Concurrency Guard | PROVEN IN CONTROLLED ENVIRONMENT |
| Ordered Locking | Opposite bulk input failed fast without custom deadlock |
| Fail-Fast / NOWAIT | Real 55P03 observed |
| Unit of Work | Full rollback / replay proven |
| Retry Pattern | Coherent for 55P03 / 40001 |
| Invariant Validation | Maximum violations = 0 |

## Guard Semantics

- Business-neutral (proven)
- Stale RR / mixed isolation: fail closed (proven)
- Overserialization: not observed for compatible cases

## Findings Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |

### INFO Only

- Expected transient 55P03
- Expected/reproduced 40001
- Natural 40P01 not deterministically reproduced

### Static / E3 / E4 Discrepancy

NONE.

---

## Final Cleanup State

- mandates = 39
- mappings = 0
- guards = 39
- missing guards = 0
- orphan guards = 0
- cross-tenant invariant violations = 0
- migration history = 38
- target migration = last

---

## Final Milestone Status

**RUNTIME_PROVEN_FOR_CONTROLLED_ENVIRONMENT**

---

## Explicitly Remaining Risks (NOT CLOSED)

1. **Application full-Unit-of-Work retry implementation**
   - Canonical contract defined, but no application code implements it yet

2. **Production online migration / locking strategy**
   - Single-transaction migration validated for controlled environment only
   - Production deployment requires separate online migration strategy

3. **ADR-P08 service-role redesign**
   - Service_role historical behavior preserved for this gate
   - Normal-request service_role usage requires separate redesign

4. **Deployed-environment grant / exposure drift**
   - Controlled G2 grants validated
   - Deployed environment effective grants remain unverified

---

## Production Non-Authorization

This controlled runtime validation **DOES NOT** authorize production deployment.

- Production execution requires a separate online migration/deployment strategy gate
- No deployed Supabase environment has been validated
- `gov-ia-dev` was untouched
- Production data was not accessed
