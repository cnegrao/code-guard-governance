# Security Findings

## MEDIUM — Latent policy-to-mandate tenant-isolation exposure

Conditional impact: **HIGH if the table becomes reachable by authenticated clients**

Status: **REMEDIATED IN CONTROLLED ENVIRONMENT / NOT YET DEPLOYED TO PRODUCTION**

Affected relation: `gov_repo.policy_mandate_mappings`.

### Historical Vulnerability (Pre-Remediation)

The historical relation had:
- An authenticated read policy with `USING (true)`
- No physical tenant key
- No structural enforcement that mapping tenant matches policy tenant

Repository-defined grants and exposed-schema configuration did not demonstrate an authenticated path to the table at repository baseline, so baseline exploitability was MEDIUM rather than confirmed HIGH. If deployment configuration grants and exposes the table, the unrestricted policy would allow cross-tenant mapping reads with HIGH impact.

### Adversarial Review History

- **M1A-R2-G1**: Returned `BLOCKED`. Found one CRITICAL runtime race: mapping write + concurrent mandate tenant update could both validate against compatible prior state and commit a cross-tenant relationship. Also found incomplete preflight (could omit missing mandates, did not explicitly fail on duplicate pairs).
- **G1-FIX**: Corrected preflight, attempted mandate-row `FOR SHARE` serialization.
- **G1-R2**: Returned `BLOCKED`. `FOR SHARE` read did not create MVCC write conflict required to close Repeatable Read mapping-first anomaly; row-trigger locking retained realistic opposite-order bulk deadlocks.
- **R3**: Approved private `gov_repo.mandate_mapping_guards` protocol: one guard row per mandate, real guard writes from both invariant-relevant paths, transition-table batching, ascending `mandate_id` + `NOWAIT`, policy-before-guard ordering, no mapping-side business-mandate lock.
- **R4**: Implemented approved protocol in local migration.
- **R4A**: Returned `CHANGES_REQUIRED`, not `BLOCKED`. No remaining tenant-integrity/concurrency-design blocker. Required: (1) target-list-aware rejection of caller-explicit conflicting mapping tenant values; (2) canonical full-transaction retry contract.
- **R4B**: Added `BEFORE UPDATE OF organisation_id` validator and recorded full Unit-of-Work rollback/retry for `55P03`, `40001`, `40P01`.

### Remediation Architecture (R4B)

The forward migration `supabase/migrations/20260901134812_policy_mandate_mapping_tenant_isolation.sql` implements:

- Mapping `organisation_id` derived exclusively from owning governance policy
- Fail-closed preflight (count-only, no row exposure) before structural DDL
- Composite candidate key `(organisation_id, policy_id)` on `governance_policies`
- Composite foreign key `(organisation_id, policy_id)` from mapping to policy
- Private tenant-neutral `gov_repo.mandate_mapping_guards` (mandate_id PK/FK, guard_version counter only)
- Real MVCC guard increment from both mapping relationship writes and mandate ownership changes
- Statement-level transition-table triggers (PostgreSQL 17)
- Ascending `mandate_id` acquisition with `NOWAIT`
- `FOR KEY SHARE NOWAIT` protection of policy ownership derivation
- Target-list-aware explicit `organisation_id` conflict validator (rejects 23514)
- Dropping of authenticated `SELECT USING(true)` policy
- Revocation of mapping table privileges from `PUBLIC`, `anon`, `authenticated`

### Controlled Runtime Validation (G2-E3/E4)

**Result: RUNTIME_PROVEN_FOR_CONTROLLED_ENVIRONMENT**

- **G2-E3 PASSED**: Structural and functional validation in disposable controlled Supabase environment (`ov-ia-g2-test`, ref: `zkqfvqwqdypgpzauzinw`).
- **G2-E4 PASSED**: Concurrency validation across all isolation levels (RC, RR, Serializable), mixed isolation matrices, bulk contention, hot guard scenarios.

#### G2 Findings Severity

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |

Only INFO-level observations were recorded:
- Expected transient `55P03`
- Expected/reproduced `40001`
- Natural `40P01` not deterministically reproduced (NOT a failure)

#### Design Patterns Proven in Controlled Environment

- Serialization Guard / Concurrency Guard
- Ordered Locking
- Fail-Fast / NOWAIT (real `55P03` observed)
- Unit of Work (full rollback/replay proven)
- Retry Pattern (coherent for `55P03` / `40001`)
- Invariant Validation (max violations = 0)

#### Universal Cross-Tenant Invariant

- Minimum: 0
- Maximum: 0
- Expected: 0

#### SQLSTATE Evidence Observed

- `00000`
- `23503`
- `23514`
- `40001` (reproduced)
- `42501`
- `55P03` (repeatedly reproduced)

### Remaining Open Risks (NOT CLOSED)

The following remain explicitly open and unaddressed:

1. **Application full-Unit-of-Work retry implementation**: Canonical contract defined, but no application code implements it yet.

2. **Production online migration / locking strategy**: Single-transaction migration validated for controlled environment only. Production deployment requires separate online migration strategy.

3. **ADR-P08 service-role redesign**: Service_role historical behavior preserved for this gate. Normal-request service_role usage requires separate redesign.

4. **Deployed-environment grant / exposure drift**: Controlled G2 grants validated. Deployed environment effective grants remain unverified.

### Production Status

**NOT AUTHORIZED FOR PRODUCTION**

- The exact migration bytes were executed and validated only in the disposable controlled G2 environment.
- `gov-ia-dev` was explicitly prohibited and untouched.
- No production data was accessed.
- Production execution requires a separate online migration/deployment strategy gate.

See `docs/codex/evidence/2026-09-01-m1a-r2-g2-runtime-validation.md` for full evidence record.
