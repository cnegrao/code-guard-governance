# ARCHIVED — not buildable, not deployable

`graphos-complete/` is the historical "council" prototype. It is kept in the
repository as history only.

- It is **not** part of the workspace, the build, CI or any deployment.
- Its `vercel.json` (deploy configuration and daily cron) was removed by
  ARCH-001.
- Its code paths are incompatible with the governed contracts: they write
  risks, scores, certifications and governance records outside the canonical
  review flow, and read tenants chosen by request headers.
- The active product is `apps/dashboard` plus `packages/*`.
- `graphos-complete/supabase/migrations/**` stays in place: dashboard tests
  and manifests reference those paths as security evidence.

Do not redeploy, re-export or import anything from this folder. Any reuse
(for example the React Flow visuals) must be re-implemented on governed
reads in `apps/dashboard`.

Decision: [ADR-GOVIA-ARCHIVE-GRAPHOS-COMPLETE-v1](../docs/architecture/ADR-GOVIA-ARCHIVE-GRAPHOS-COMPLETE-v1.md).
