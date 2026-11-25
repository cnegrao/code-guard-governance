# ADR — Archive `graphos-complete` instead of per-route containment

Date: 2026-11-25, America/Sao_Paulo. Task: **ARCH-001**.
Status: **ACCEPTED** — decided by Carlos Negrão on 2026-11-25.
Base: `main@2873adea90fc92ea4b7f541c5431087a542db340`.

## Context

`graphos-complete/` is the historical "council" prototype: a separate Next.js
app with about 55 API routes, its own Supabase migrations and its own
`vercel.json` (three long-running functions and a daily cron on
`/api/v1/cron/rescan`).

TA-002 / S1C-L04 tried to contain it route by route. Three local candidates
were produced (five historical entrypoints, then the `/api/v1` write paths).
The independent review of the last candidate
(`S1C_L04_V1_API_CLAUDE_ADVERSARIAL_HANDOFF`, PASS_WITH_FINDINGS) confirmed the
writes were blocked but found residual reads:

- `GET /api/v1/graph` and `GET /api/v1/agents` select the tenant from the
  `x-tenant-id` / `x-org-id` header and read with the service role, so any
  caller can read any tenant;
- `GET /api/v1/report` returns, unauthenticated, a "board report" with
  compliance score, readiness and certification.

Each round of containment found another surface. The prototype was also
published on the public domain `code-guard.eu` without login.

Verified on the base commit: no file in `apps/`, `packages/` or `services/`
imports `graphos-complete`; CI workflows do not run it; it is not an npm
workspace. Only dashboard tests and manifests reference the paths of its SQL
migrations, as security evidence.

## Decision

1. Archive `graphos-complete/`: it is not built, tested, typechecked or
   deployed. Its code stays in the repository as history.
2. Remove `graphos-complete/vercel.json` (deploy configuration and cron).
3. Remove the root scripts `typecheck:graphos` and `test:graphos`.
4. Keep `graphos-complete/supabase/migrations/**` unchanged.
5. Add `graphos-complete/ARCHIVED.md`.
6. The S1C-L04 containment candidates (five entrypoints and `/api/v1`) are
   **superseded** and will not be integrated. Their patches and the review
   remain local evidence.
7. Any Vercel project serving this folder is to be removed or put behind
   protection by the owner (hosted action, outside this repository).

## Consequences

- The public attack surface of the prototype disappears once the hosted
  project is removed, rather than being reduced route by route.
- Residual reads (MÉDIO-1) no longer need code containment; they cease to
  exist with the deployment.
- Rows that historical scans may have written to a hosted database are
  unaffected by this ADR; their status stays UNKNOWN until inspected.
- The governed graph remains `apps/dashboard` `/graph`
  (`components/graph/CanonicalGraph.tsx`, read projection of canonical
  objects). Visual ideas from the legacy React Flow graph may be
  re-implemented there on governed reads only.
- Not affected: M17.5 status, M18 HOLD, LX04 (to be integrated separately),
  database, migrations.

## Not done here

No hosted mutation, no deployment change on Vercel, no database change.
