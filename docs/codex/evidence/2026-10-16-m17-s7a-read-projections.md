# M17-S7A deterministic read projections candidate evidence

Date: 2026-10-19 (America/Sao_Paulo)

Status: **IMPLEMENTED / CANDIDATE READY**

## Git candidate

- Branch: `feat/m17-s7a-read-projections`
- Starting checkpoint: `23f992057f685cffa00cf1983f4f45e06f913a10`
- O45 correction starting HEAD: `c7caa17aca9063cf0d004644195f3c3581439bdd`
- Final candidate HEAD: the commit containing this evidence (the pushed branch tip reported by `git rev-parse HEAD`).
- Base: `a1ce7419b8db3da0cbe0f4fee25ed8c679af8c9b`
- Additive migration: `20261017020733_m17_s7a_read_projections_v1.sql`
- Historical migrations, hosted databases and deployments were not mutated.

## PostgreSQL 17 proofs

`M16_PG17_BIN=D:/code-guard-governance/out/m16-tools/pgsql/bin` supplied the disposable PostgreSQL 17.11 harness.

- O68: all seven lifecycle values and projection zero-write digest — **PASS**.
- O67: `INSUFFICIENT_EVIDENCE`, `CONFLICT`, `RESOLVED`, exact-key isolation, no heuristic winner, and zero writes — **PASS**.
- O45 correction: exact-subject current M16 `BUSINESS_OWNER`, `TECHNICAL_OWNER`, and `DATA_OWNER` assignments are returned without precedence; a coexisting `DATA_STEWARD` assignment is not returned; unsupported kinds remain `UNKNOWN`; and a real canonical `AGENT_VERSION` fixture does not inherit its `AGENT` owner's accountability — **PASS**.
- Control coverage: categorical applicability/current assessment; `DOES_NOT_APPLY`, `NOT_ASSESSED`, unassessed applicability, and absent applicability never infer coverage — **PASS**.

Focused logs/evidence:

- `.artifacts/agent/154d067a-9a0c-4869-8e1e-058d10a801a6-0.log` — O68 PASS.
- `.artifacts/agent/2fc35947-6a21-4bb9-a28d-a4ea409a348a-0.log` — O67 and control coverage PASS; the superseded O45 fixture attempt identified an out-of-domain negative kind and was corrected.
- O45-only corrected PostgreSQL 17.11 command — 1 PASS / 0 FAIL, 24.707 s.
- `.artifacts/agent/d2e42b35-56c6-4384-b7a9-97eebb8ee3fe-0.log` — affected S7A static acceptance PASS.

O67, O68, control coverage, and typechecks were not rerun because the correction only filters O45 responsibility roles and strengthens its focused fixture. Their previously passing evidence remains unchanged.

## Boundaries preserved

No S7B/S7C, O69–O72, exposure, Vector/LLM, Passport, architecture redesign, broad M15/M16 regression, hosted mutation, or deployment is included.
