# M17-S7C corrective closure evidence

Date: 2026-10-19 (America/Sao_Paulo)

Status: **CORRECTIVE CANDIDATE / CLOSED LOCALLY / NOT MERGED**

> **2026-10-20 superseding status:** the status and PASS claims below describe
> the historical S7C scope. M17 is now **OPEN / CORRECTIVE**: the supplied
> adversarial review reports 88 PASS / 1 FAIL / 2 UNPROVEN, including the O56
> runtime defect and O71 proof gap. O91 requires current-tree CI; historical
> runs are insufficient. Supplemental C-M17-01 is required and blocked on
> disposition overlap semantics. See [S7D evidence](2026-10-20-m17-s7d-adversarial-corrective.md).
> M17.5 remains **NOT STARTED / HOLD**.

## Audit provenance

PR #80 originally merged the formal M17 closure into canonical `main` at
`1914e7e2e18591000588ffab4325e61911fc2189`. A post-merge ACP adversarial
review challenged that closure and reopened it for two corrective findings:

- **F-M17-C1:** the final O61 SECURITY DEFINER inventory stopped at S6. It
  omitted the two S7A/S7B SECURITY DEFINER read routines, so the claimed final
  34-routine inventory was not the final M17 catalog.
- **F-M17-C2:** O31's literal sentence that methodology ordinals were the only
  numeric L15 columns contradicted legitimate non-authoritative analytical/source
  metadata and a structural completeness counter already present in the catalog.

The ACP review result for the technical S7C O31/O61 corrective is **PASS**.
This evidence records the correction transparently; it does not erase the
historical PR #80 closure.

## Git candidate and scope

- Branch: `fix/m17-s7c-final-security-closure`.
- Base: `1914e7e2e18591000588ffab4325e61911fc2189` (merge of PR #80).
- Technical corrective HEAD: `8908ca7fd7188515692325d53e2de8e1d216db31`.
- Change class at the technical HEAD: additive assertion-only migration,
  regression proof, final inventory completion and additive architecture
  clarification. Runtime semantics are unchanged.
- This audit-trail commit changes documentation only and follows the technical
  corrective HEAD above.

No historical migration was edited. Hosted Supabase, Vercel, deployment and
production were not touched.

## F-M17-C1 — final O61 definer closure

The disposable PostgreSQL 17.11 catalog at the complete M17S7B horizon contains
exactly **36** `gov_repo.l15_%` SECURITY DEFINER routines. The final inventory
includes all S1-S6 routines plus these two S7A/S7B routines:

| Routine | Owner | Body SHA-256 | Configuration | Explicit ACL |
|---|---|---|---|---|
| `gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)` | `postgres` | `2e9de73461b30f67b98019658cd6fba77ccc05dda8c7c8ba3ba898c2c726bc26` | `search_path=pg_catalog, pg_temp;lock_timeout=5s` | `postgres: EXECUTE`, `service_role: EXECUTE`; non-grantable |
| `gov_repo.l15_read_passport_risk_overlay_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone)` | `postgres` | `d5933d65d5fce751cb98d85dbb7a98da15c6f21fdf166775da472f952941bb20` | `search_path=pg_catalog, pg_temp;lock_timeout=5s` | `postgres: EXECUTE`, `service_role: EXECUTE`; non-grantable |

`PUBLIC`, `anon`, `authenticated` and
`govia_l15_machine_intake_caller` have no EXECUTE capability on either routine.
Both routine bodies are read-only and contain no L15 admit/submit/decide call.
The final proof also reasserts the exact ACL for all 36 definers and retains the
machine-intake capability at exactly its approved two RPCs.

## F-M17-C2 — complete O31 numeric catalog

The final PostgreSQL 17.11 catalog enumeration covers every `smallint`,
`integer`, `bigint`, `numeric`/`decimal`, `real` and `double precision` column in
all ordinary or partitioned `gov_repo.l15_%` tables:

| Final catalog column | Type | Classification |
|---|---|---|
| `l15_risk_methodology_impact_levels.ordinal` | `smallint` | 1. STRUCTURAL SCALE COORDINATE |
| `l15_risk_methodology_likelihood_levels.ordinal` | `smallint` | 1. STRUCTURAL SCALE COORDINATE |
| `l15_risk_hypotheses.hint_confidence` | `numeric` | 2. NON-AUTHORITATIVE ANALYTICAL / SOURCE HINT |
| `l15_risk_signals.hint_confidence` | `numeric` | 2. NON-AUTHORITATIVE ANALYTICAL / SOURCE HINT |
| `l15_risk_treatment_proposals.control_pin_count` | `integer` | 3. STRUCTURAL INTEGRITY / COMPLETENESS COUNTER |

**Category 4 — PROHIBITED GOVERNED RISK NUMERIC: empty.** There is no numeric
risk score, weight, percentage, arithmetic product or numeric authority/rating/
lifecycle/treatment/acceptance mechanism.

The additive
[O31 numeric catalog clarification](../../architecture/ADR-GOVIA-RISK-INTELLIGENCE-O31-CLARIFICATION-v1.md)
records the frozen normative intent without silently editing the frozen M17 ADR:
methodology ordinals are structural coordinates, `hint_confidence` is
non-authoritative analytical/source metadata, and `control_pin_count` is used
only for completeness/integrity checking.

The regression proof pins every catalog consumer of `hint_confidence` and
`control_pin_count` across routines, constraints, views, policies, triggers,
indexes and column expressions. An unclassified numeric column, a score/weight/
percent/product-like column, or an unreviewed consumer fails the proof.

## Assertion-only S7C migration

`20261019140000_m17_s7c_final_security_closure_v1.sql` is additive and
assertion-only. It creates no durable object or capability, changes no ACL or
routine, performs no production DML, and fails closed unless the final definer,
machine-intake and O31 numeric catalogs remain exact. The regression compares
all L15 table-state hashes before and after the migration and proves zero state
mutation.

## Focused verification

Command:

```text
M16_PG17_BIN=out/m16-tools/pgsql/bin node --conditions=react-server --import tsx --test apps/dashboard/tests/postgres-m16/m17-final-security-closure.test.ts
```

Result on disposable PostgreSQL **17.11**: **2 / 2 PASS**, **0 FAIL**. The proof
covered the exact 36-definer inventory, S7A/S7B owner/body/config/ACL closure,
the complete five-column numeric catalog, Category 4 emptiness, reviewed numeric
consumers, assertion-only migration shape and zero L15 state mutation.

PR #79 remains the historical broad O91 evidence: its M15 PostgreSQL regression
and full M16 PostgreSQL 17 security workflow passed on the pre-closure S7B tree.
The S7C result above is the focused corrective verification; it is not presented
as a replacement run of those historical broad workflows.

## Corrective verdict and canonical status

- Final corrective candidate result: **O01-O91 = 91 / 91 PASS**.
- Runtime semantic changes: **zero**.
- Hosted/deployment changes: **none**.
- M17 canonical status: **HOLD FOR S7C MERGE**. M17 remains **NOT RE-CLOSED IN
  CANONICAL MAIN** until the S7C corrective PR is merged.
- M17.5: **HOLD / NOT STARTED**. No M17.5 work is authorized by this candidate.
