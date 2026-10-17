# M17-S6 RESIDUAL / RISK_ACCEPTANCE candidate evidence

Date: 2026-10-16 (America/Sao_Paulo)

Status: **IMPLEMENTED / CANDIDATE READY**

## Git candidate

- Branch: `feat/m17-s6-residual-risk-acceptance`
- Verified implementation HEAD: `f64be0359378092f4418f221641283b8b4dcf69a`
- Base: `6acd896b56b2c73e5d279083d75eb70067b762be`
- Additive migration: `20261016021012_m17_s6_residual_risk_acceptance_v1.sql`
- Historical migrations, hosted databases and deployments were not mutated.

## Scope closed

- RESIDUAL assessment contracts, governance review, persistence, exact dependency pins and eligibility projection.
- RISK_ACCEPTANCE contracts, governance review, persistence, bounded validity and exact RESIDUAL target.
- Static S6 constraints and the S0/S2/S3/S4/S5 migration-tail assertions.
- Post-S6 shared regression for S4 INHERENT, S5 RISK_TREATMENT and M16 control applicability/assessment.
- Final catalog security inventory and dashboard/canonical-contracts/governance-review typechecks.
- Existing focused functional, dependency, temporal, concurrency and security evidence was reused because the implementation candidate was unchanged; full M15/M16 regression remains the PR CI gate.

## Final verification

Runner: `scripts/agent/verify.mjs`, profile `final`, run `b56ad25e-c7cd-49c6-ad96-226044592949`.

- Verification commands: **10 PASS / 0 FAIL**, measured command duration **110.652 s**.
- Test assertions: **55 PASS / 0 FAIL** across the selected contract, review, persistence, static, migration-tail, shared-regression and security checks.
- Typechecks: dashboard **PASS** (11.420 s); canonical-contracts **PASS** (2.029 s); governance-review **PASS** (2.370 s).
- Contract/review/persistence/static/migration-tail commands: **5 PASS / 0 FAIL** (2.614 s measured command duration; 42 assertions).
- PostgreSQL shared regression: **4 PASS / 0 FAIL** (43.584 s).
- PostgreSQL final security inventory: **9 PASS / 0 FAIL** (48.634 s).
- `git diff --check`: **PASS**.

## Final security inventory

- L15 SECURITY DEFINER routines: **34**
- service_role L15 RPCs: **24**
- service_role `gov_repo` RPCs: **107**
- L15 tables: **36**
- machine-intake RPCs: **2**
- direct service_role L15 table privileges: **0**
- direct service_role M16 table privileges: **0**

## Boundaries preserved

No S7 work, architecture redesign, historical migration edit, hosted mutation, deployment, new canonical kind or relationship, F2/Passport change, or M16 truth-model change is included.
