# M17-S7A deterministic read projections candidate evidence

Date: 2026-10-16 (America/Sao_Paulo)

Status: **IMPLEMENTED / CANDIDATE READY**

## Git candidate

- Branch: `feat/m17-s7a-read-projections`
- Starting checkpoint: `23f992057f685cffa00cf1983f4f45e06f913a10`
- Base: `a1ce7419b8db3da0cbe0f4fee25ed8c679af8c9b`
- Additive migration: `20261017020733_m17_s7a_read_projections_v1.sql`
- Historical migrations, hosted databases and deployments were not mutated.

## PostgreSQL 17 proofs

`M16_PG17_BIN=D:/code-guard-governance/out/m16-tools/pgsql/bin` supplied the disposable PostgreSQL 17.11 harness.

- O68: all seven lifecycle values and projection zero-write digest — **PASS**.
- O67: `INSUFFICIENT_EVIDENCE`, `CONFLICT`, `RESOLVED`, exact-key isolation, no heuristic winner, and zero writes — **PASS**.
- O45: exact M16 accountable party for `AGENT`, `DATA_ASSET`, and `DATA_ELEMENT`; every other legal risk subject is `UNKNOWN`; no `AGENT` to `AGENT_VERSION` inheritance — **PASS**.
- Control coverage: categorical applicability/current assessment; `DOES_NOT_APPLY`, `NOT_ASSESSED`, unassessed applicability, and absent applicability never infer coverage — **PASS**.

Focused logs/evidence:

- `.artifacts/agent/154d067a-9a0c-4869-8e1e-058d10a801a6-0.log` — O68 PASS.
- `.artifacts/agent/2fc35947-6a21-4bb9-a28d-a4ea409a348a-0.log` — O67 and control coverage PASS; the superseded O45 fixture attempt identified an out-of-domain negative kind and was corrected.
- O45-only corrected command — 1 PASS / 0 FAIL, 25.250 s.

Previously passing S7A static acceptance and dashboard/canonical-contracts typechecks were preserved and not rerun. The database failures fixed here were limited to invalid qualification of SQL `COALESCE` and missing required S5 implementation evidence in the O68 fixture.

## Boundaries preserved

No S7B/S7C, O69–O72, exposure, Vector/LLM, Passport, architecture redesign, broad M15/M16 regression, hosted mutation, or deployment is included.
