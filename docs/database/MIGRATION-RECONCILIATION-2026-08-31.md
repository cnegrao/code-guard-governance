# Migration Reconciliation — 2026-08-31

## Context

Reconciliation was required because Git contained nine legacy monolithic migrations while production contained 36 applied migrations. Their timestamps and migration histories did not align.

## Resolution

- The nine original SQL files were archived byte-for-byte under `supabase/legacy-migrations/20260618-monolithic/`.
- SHA-256 integrity was preserved before and after archival.
- Production history was fetched through the official Supabase migration fetch workflow.
- Active `supabase/migrations/` now contains exactly the 36 production-history files.
- The migration list showed exact 36/36 timestamp alignment between the repository and production history.

## Authority

The applied production migration history is the authoritative active baseline. The archived monoliths are forensic and historical artifacts only.

Do not use migration repair to make the old timestamps appear applied. Do not rename the archived monoliths to production timestamps.

## Offline equivalence audit — R5

The R5 audit inspected 45 SQL files across nine migration families and found no `UNKNOWN` differences. Relational structure, constraints, indexes, functions, views, triggers, and effective RLS/policies are preserved except for the explicit production corrections and deltas recorded below.

### Production corrections

- `agent_compliance_gaps`: corrected `ORDER BY` resolution.
- `ai_system_compliance_gaps`: corrected `ORDER BY` resolution.
- `ai_system_evidence_report`: corrected `ORDER BY` resolution.

### Material differences

- 12 AI-system mandate `requirement_text` values were condensed.
- 10 ICT-incident mandate `requirement_text` values were condensed.
- 68 `COMMENT ON` declarations were removed or shortened across families 7, 8, and 9.
- Eight redundant standalone guards were omitted from family 8; the cumulative chronological database state remains unchanged.

## Security caveat

Production migration `20260818013113_grant_service_role_gov_repo_access.sql` grants broad `service_role` privileges over `gov_repo` tables, sequences, routines, and default privileges.

This is historical production behavior, not an approved future design. New `canonical`, `discovery`, `semantic`, and `app_api` schemas MUST NOT inherit this broad `service_role` pattern. ADR-P08 governs the future authentication, trust, RLS, membership, and service-identity boundary.

## Verdict

The reconciliation is faithful to production history. It is not a claim that the 36 production migrations are semantically identical to the nine archived monoliths.

The reconciliation may be committed. P1.0.4a may begin only after the reconciliation commit and its review.
