# M17-S7B exposure, analytical boundaries and Passport overlay candidate evidence

Date: 2026-10-19 (America/Sao_Paulo)

Status: **IMPLEMENTED / CANDIDATE READY**

## Git candidate

- Branch: `feat/m17-s7b-exposure-passport-overlay`
- Base: `3a35227ad1876764fd3041091b31a494d55f0f33` (canonical main after merged PR #78 / S7A)
- Final candidate: the commit containing this evidence.
- Additive migration: `20261019130000_m17_s7b_passport_risk_overlay_v1.sql`.
- Historical migrations, hosted Supabase/Vercel and deployments were not touched.

## Acceptance evidence

- O69: the exact governed-risk subject is required; exposure delegates to M12 `GOVIA_BLAST_RADIUS_V1`; every contribution
  retains `authority = ANALYTICAL`, traversal policy, hop count and witness path; pure-input equality and static forbidden-
  legacy scans prove no state mutation or legacy propagation input.
- O70: L15 vector analysis delegates to governed M12 exact retrieval, carries the subject/scenario/state identity unchanged,
  declares no scenario selection and has no provider or write/link/merge port.
- O71: deterministic `validated` / `accepted` / `closed` stub outputs remain analytical text with governance action,
  evidence storage, proposal submission and decision-actor capability explicitly disabled.
- O72: one verified-principal read projection composes S7A lifecycle/accountable-party reads and S3-S6 risk,
  assessment, acceptance, support and residual-control pins. Disposable PostgreSQL 17 proves absence = `UNKNOWN`, an exact
  AGENT operational risk maps to existing family 13, no AGENT -> AGENT_VERSION inheritance, and zero history-row changes.
  UI/unit proofs retain exactly 16 families and unchanged coverage statuses; hypotheses are isolated under
  `NON-AUTHORITATIVE ANALYSIS`.

## Focused verification

- `packages/graphos:test:governed` — PASS.
- `packages/graphos:typecheck` — PASS.
- root `typecheck:dashboard` — PASS.
- `apps/dashboard:test:passport` — PASS after correcting a test-only RPC selection assertion.
- `apps/dashboard/tests/m17-s7b-static-acceptance.test.ts` — PASS.
- `apps/dashboard/tests/postgres-m16/m17-s7b-passport-overlay.test.ts` with PostgreSQL 17.11 — PASS after adding the new
  migration to the disposable harness allowlist.
- Broad M15/M16 regression was intentionally not run locally; PR CI remains its gate.
