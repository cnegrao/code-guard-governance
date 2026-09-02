# Blockers

## M1A-R1 Status

No active semantic or implementation blocker is recorded for M1A-R1. The four former Wave A ambiguities remain resolved by Product Owner decisions.

## M1A-R2 — History and Resolved Blockers

### Historical Blockers (RESOLVED / SUPERSEDED)

- **G1**: Returned `BLOCKED`. CRITICAL runtime race + incomplete preflight.
- **G1-FIX**: Corrected preflight but mandate-row `FOR SHARE` rejected by G1-R2 (Repeatable Read anomaly + bulk deadlock paths).
- **R3**: Approved guard/version protocol.
- **R4**: Implemented protocol in local migration.
- **R4A**: Returned `CHANGES_REQUIRED` (not `BLOCKED`). Required: target-list-aware explicit tenant validation + canonical full-transaction retry.
- **R4B**: Authored both corrections.

### Blockers Resolved by G2-E3/E4

The following blockers were specifically waiting for controlled G2 validation and are now **RESOLVED** in the controlled environment context:

- ~~"R4B pending final static/manual review"~~ → RESOLVED (R4C static gate cleared)
- ~~"Controlled G2 unauthorized"~~ → RESOLVED (G2 authorized and executed)
- ~~"Pending E3 structural/functional validation"~~ → RESOLVED (G2-E3 PASSED)
- ~~"Pending E4 concurrency validation"~~ → RESOLVED (G2-E4 PASSED)
- ~~"Tenant-invariant enforcement not execution-proven"~~ → RESOLVED (universal invariant: 0 violations across all tests)

## Current Active Blockers

### Production Deployment — BLOCKED

**Production execution remains blocked pending a separate online migration/deployment strategy.**

- Single-transaction migration validated only for controlled local/staging testing.
- Production deployment requires explicit separate strategy gate.
- No deployed Supabase environment has been validated.

### Persistent Open Risks (Blockers for Production or Real Tenant Data)

These remain **OPEN** and are not resolved by G2:

1. **ADR-P08 service-role redesign**
   - Service_role historical privileged behavior preserved for this gate.
   - Normal-request `service_role` usage requires separate redesign.
   - Blocking for: production, real tenant data, authenticated `app_api` access.

2. **Deployed-environment grant / exposure drift**
   - Controlled G2 grants validated.
   - Deployed environment effective grants and exposed-schema configuration remain unverified.
   - Blocking for: production deployment confidence.

3. **Application full-Unit-of-Work retry implementation**
   - Canonical retry contract defined.
   - No application code implements it yet.
   - Blocking for: production runtime robustness.

## Distinction: Controlled G2 vs Production

| Dimension | Controlled G2 (`ov-ia-g2-test`) | Production |
|-----------|-----------------------------------|------------|
| Status | **PROVEN** | **BLOCKED** |
| Migration executed | Yes | No |
| Online migration strategy | Not required | Required |
| Deployed grants verified | Yes (G2 only) | No |
| ADR-P08 resolved | Not required for G2 | No |
| Application retry implemented | Not required for G2 | No |

## G2-E3/E4 Evidence

Full runtime validation evidence is recorded in:
`docs/codex/evidence/2026-09-01-m1a-r2-g2-runtime-validation.md`

- G2-E3 PASSED (structural/functional)
- G2-E4 PASSED (concurrency)
- Findings: CRITICAL=0, HIGH=0, MEDIUM=0, LOW=0
- Universal cross-tenant invariant: 0 violations
