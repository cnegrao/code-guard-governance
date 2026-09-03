# Current State

As of 2026-09-01 (post-G2-E3/E4):

- Current branch: `feat/p1.0.4-canonical-persistence`.
- Milestone `M1A-R1 — Wave A Ambiguity Resolution` is complete at READY 93/93 and was committed locally as `6cd7a8f6ce59f1bb961c4ac467567faa56c3dc28`.
- The Wave A metadata migration `supabase/migrations/20260901021520_wave_a_metadata_comments.sql` and the canonical `docs/codex/` continuity package are versioned in that commit.
- The branch is one commit ahead of `origin/feat/p1.0.4-canonical-persistence`; no push has occurred.
- Milestone `M1A-R2 — policy_mandate_mappings tenant isolation` is the current local remediation step.
- The new forward migration is `supabase/migrations/20260901134812_policy_mandate_mapping_tenant_isolation.sql`.

## M1A-R2 Chronology (Historical)

- The M1A-R2-G1 adversarial review returned `BLOCKED` after identifying one CRITICAL runtime race between mapping writes and mandate tenant changes, plus fail-closed preflight gaps for drifted parent and uniqueness state.
- M1A-R2-G1-FIX attempted to serialize both write paths through a mapping-side `FOR SHARE` lock on the mandate row. M1A-R2-G1-R2 returned `BLOCKED` because that locking read does not create the MVCC conflict required to close the Repeatable Read mapping-first race, and row-trigger parent locking retained realistic opposite-order bulk deadlocks.
- M1A-R2-G1-R3 approved one private technical guard/version row per mandate, real guard writes from both invariant-relevant paths, statement-level transition-table triggers, ascending `mandate_id` acquisition with `NOWAIT`, policy-derived mapping ownership, and no mapping-side business-mandate lock.
- M1A-R2-G1-R4 implemented that approved protocol in the local pending migration. M1A-R2-G1-R4A returned `CHANGES_REQUIRED`, not `BLOCKED`: it found no remaining tenant-integrity, concurrency, RLS, rollback, or PostgreSQL 17 syntax blocker, but identified two MEDIUM contract gaps.
- M1A-R2-G1-R4B has added target-list-aware validation for caller-explicit mapping `organisation_id` assignments. Explicit values conflicting with the new policy tenant are rejected with `23514`, while policy-only reassignment continues to derive the new policy tenant automatically.
- The canonical concurrency contract now requires full Unit-of-Work rollback and restart after `55P03`, `40001`, or `40P01`; statement-only or savepoint-only retry is not canonical. Future application retry must be bounded and use backoff/jitter, but no runtime retry code is part of R4B.

## Current Validated Status (Post-G2)

**RUNTIME_PROVEN_FOR_CONTROLLED_ENVIRONMENT**

- R4B static design completed.
- R4C static gate cleared.
- **G2-E3 PASSED**: Structural and functional validation in controlled disposable Supabase environment.
- **G2-E4 PASSED**: Concurrency validation (RC, RR, Serializable; mixed isolation; bulk contention; hot guard; all isolation levels).
- Universal cross-tenant invariant: 0 violations observed throughout all tests.
- Design Patterns proven in controlled environment:
  - Serialization Guard / Concurrency Guard
  - Ordered Locking
  - Fail-Fast / NOWAIT (real 55P03 observed)
  - Unit of Work (full rollback/replay proven)
  - Retry Pattern (coherent for 55P03 / 40001)
  - Invariant Validation (max violations = 0)
- No CRITICAL, HIGH, MEDIUM, or LOW findings from G2-E3 or G2-E4. Only INFO-level observations.
- 40P01 (deadlock_detected) was NOT deterministically reproduced. This is NOT a failure; the architecture was NOT weakened to force it.

## Migration Execution Status (Distinction Required)

- **Local repository**: Migration remains untracked, uncommitted, and unexecuted locally.
- **Controlled G2 environment**: The exact migration bytes (SHA-256: `b060e13939666dd303f6a09cc38a75ab1078a99b2d93a90b1c1e5cfeba8563da`) were successfully executed and validated in the disposable `ov-ia-g2-test` project (ref: `zkqfvqwqdypgpzauzinw`).
- **Production**: Migration is NOT authorized for production. Production execution requires a separate online migration/deployment strategy gate.

## Remaining Open Risks (NOT CLOSED)

The following remain explicitly open and unaddressed:

1. **Application full-Unit-of-Work retry implementation**: Canonical contract defined, but no application code implements it yet.
2. **Production online migration / locking strategy**: Single-transaction migration validated for controlled environment only; production requires separate online strategy.
3. **ADR-P08 service-role redesign**: Service_role historical behavior preserved for this gate; normal-request service_role usage requires separate redesign.
4. **Deployed-environment grant / exposure drift**: Controlled G2 grants validated; deployed environment effective grants remain unverified.

## Additional Context

- `codex-recovery-6101-6240.txt` remains untracked and non-authoritative.
- `gov-ia-dev` was explicitly prohibited and untouched during G2.
- No production data was accessed during controlled validation.
- Nothing from M1A-R2 through R4B/E3/E4/E5 is staged, committed, or pushed.
