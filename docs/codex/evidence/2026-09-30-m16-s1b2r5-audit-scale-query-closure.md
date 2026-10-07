# M16-S1B.2R5 — Audit Scale & Query Closure

Starting HEAD: `0c149ffc9ec20c71ce5046d3d79e6c14792393bd`, verified exactly on
`feat/m16-s1b-governed-registries`. Scope: the three audit repository defects only; no S1B.3,
schema/routine/migration change, deployment, hosted database access, PR or merge.

## Independent BEFORE evidence

Before editing `repositories/audit.ts`, the new R5 functional suite ran on the unchanged R4 implementation.
Local log: `out/r5-before.log`. PostgreSQL 17.11, disposable full primary chain + R1/R2/R3, real canonical
ledger appends, real service_role reads and real database permission failures. The shared test transport
simulates PostgREST's configured 1,000-row cap using SQL `LIMIT min(requested limit, 1000)`, even when no
limit was requested. Counts are separate, uncapped exact filtered counts. A control proves both implicit
and oversized requests return 1,000 rows while reporting count=1,250. No hosted transport is used.

Fixture for one tenant: HEAD_0..HEAD_9 have counts 145,135,125,115,105,95,85,75,65,55 (1,000 total),
followed by TAIL=250. Ten foreign rows are interleaved between the HEAD groups to exercise tenant binding
and gaps in the global sequence. The intended aggregate processes all 1,250 tenant rows before top-ten selection.

Observed R4 `events_by_type` (the old query had no order, so it did not necessarily return insertion order):

```json
[
  {"event_type":"TAIL","count":250},
  {"event_type":"HEAD_2","count":125},
  {"event_type":"HEAD_3","count":115},
  {"event_type":"HEAD_4","count":105},
  {"event_type":"HEAD_5","count":95},
  {"event_type":"HEAD_6","count":85},
  {"event_type":"HEAD_7","count":75},
  {"event_type":"HEAD_8","count":65},
  {"event_type":"HEAD_9","count":55},
  {"event_type":"HEAD_1","count":30}
]
```

These counts sum to 1,000, omit HEAD_0 entirely and undercount HEAD_1 (30 instead of 135).
The exact top ten differs in both membership and counts from the complete result.

R4 `getEvents` with `limit=1100`: page 1 returned 1,000 rows; page 2 returned 150; both reported total=1,250.
The union contained 1,150 unique IDs, omitting the 100 IDs between logical offsets 1,000 and 1,099.

R4 search construction was `event_description.ilike.%INPUT%,event_type.ilike.%INPUT%` with no value quoting.
The test transport's narrow OR/ILIKE parser follows PostgREST v14.1 `pLogicSingleVal` and `pQuotedValue`:

| Search | BEFORE observed result | Expected |
|---|---|---|
| `alpha,beta` | Invalid filter after comma split | 2 tenant rows |
| `(policy)` | Premature closing parenthesis; 0 rows | 2 tenant rows |
| `risk)` | Premature closing parenthesis; 0 rows | 2 tenant rows |
| `(risk` | 2 rows; opening parenthesis alone is accepted in an unquoted value | 2 tenant rows |
| `alpha,beta(policy)` | Invalid filter after comma split | 2 tenant rows |

Mixed-case ordinary substring and embedded quote controls also ran. BEFORE totals: **17 tests, 6 passed,
11 failed** (including the parent). No implementation file was changed until this run completed.
This is an explicit simulation over PostgreSQL, not a claim of running an HTTP PostgREST server.

Sources checked: [PostgREST URL grammar](https://postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters)
and [v14.1 parser](https://github.com/PostgREST/postgrest/blob/v14.1/src/PostgREST/ApiRequest/QueryParams.hs).

## Corrections and exact contracts

- Aggregation reads fixed chunks of 1,000 rows ordered by `entry_sequence ASC`, filters `organisation_id`
  on every `db.write` request, counts into a map, and stops at a short or empty chunk. It sorts descending
  by count and takes ten only after exhaustion. An intermediate query error rejects the whole integrity call.
  An exact 1,000-row fixture proves the empty terminal request. Ties follow first encounter in canonical order;
  the legacy R3 assertion now compares equal-count entries without relying on unspecified query-plan order.
- `getEvents` defaults remain page=1, limit=50. Positive safe-integer page and integer limit 1..1000 are valid.
  Oversized/zero/negative/fractional/nonfinite/unsafe values and unsafe computed ranges throw `RangeError`
  before any database request. The route's existing parsing and 500 exception mapping are unchanged.
  It already maps zero/NaN URL values to defaults before invoking the repository. Valid pagination and exact
  totals are unchanged; this is rejection, not clamping.
- Search wraps the complete `%search%` pattern in PostgREST double quotes, escaping backslashes and quotes.
  Supabase handles URL encoding. Case-insensitive containment over description OR type and existing ILIKE
  wildcard semantics remain. User commas/parentheses/quotes cannot add predicates or close the OR group.
- All six tenant read sites retain `db.write` and organisation binding. No-match lookup remains null.
  R4 query failures still reject. All five integrity components and global `ledger_verify(1, null)` are preserved.
  Public `LedgerEntry`, `LedgerFilters`, `LedgerIntegrity`, function signatures and successful response shapes
  are unchanged. The only externally visible contract tightening is the documented pagination rejection.

AFTER exact top ten for 1,250 rows:

| event_type | count |
|---|---:|
| TAIL | 250 |
| HEAD_0 | 145 |
| HEAD_1 | 135 |
| HEAD_2 | 125 |
| HEAD_3 | 115 |
| HEAD_4 | 105 |
| HEAD_5 | 95 |
| HEAD_6 | 85 |
| HEAD_7 | 75 |
| HEAD_8 | 65 |

HEAD_9=55 is correctly outside the top ten. Top-ten counts sum to 1,195; tenant total remains 1,250.
Both 50-row and 1,000-row pagination recover exactly the expected 1,250 ordered IDs, with zero omissions,
zero duplicates, full total on every page and an empty final page. Above-maximum limits 1,001/1,100/2,000
are rejected for both first and second pages. All five required punctuation inputs return exactly two matching
tenant rows (one description match and one type match), excluding a deliberately matching foreign row.
Mixed-case ordinary substring, quotes and filter-like input also pass. A denied second chunk yields an exception,
never a partial aggregate.

## Validation

Focused R5/R4/R3/R2: **74/74**, no failures, skips or cancellations (`out/r5-focused.log`):
R5=17, R4=29, R3 audit=5, R3 S0 closure=12, R2=11. Node totals include parent tests.

Other completed local checks:

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| M15 PostgreSQL | 8 | 0 | 0 |
| Dashboard | 1,151 | 5 | 0 |
| Passport UI | 15 | 0 | 0 |
| canonical-contracts | 230 | 0 | 0 |
| governance-review | 379 | 0 | 0 |

Dashboard discovered 1,156 tests; the five existing opt-in integration/hosted/auxiliary cases remain skipped.
Dashboard, canonical-contracts and governance-review typechecks passed. Dashboard typecheck uses
`--incremental false` to preserve the pre-existing build-info file. Logs are `out/r5-dashboard.log`,
`out/r5-m15.log`, `out/r5-contracts.log`, `out/r5-review.log` and `out/r5-typecheck-*.log`.

Full M16 PostgreSQL 17: **663/663 passed**, zero failures/cancellations/skips, 812,284.2631 ms
(`out/r5-m16-full.log`, all 30 files with `--test-concurrency=2`). Breakdown: S0=285, S1A=111,
S1B.0=53, S1B.1/R1=74, S1B.2 policy store=30, S1B.2R1 surface=36, R2=11, R3=17, R4=29,
R5=17. These sum to 663. `git diff --check` passed. Exact-commit CI is verified after the single
corrective commit is pushed; final SHA, CI run URLs and final working-tree state belong in the final session report.

Local PG17 uses the existing harness's explicitly labelled pgvector stand-in (only the HNSW index statement
is allowed to fail). Ledger, roles, functions and permissions are real PostgreSQL. CI installs real pgvector.
No max_rows/configuration, schema, routine body/signature/configuration/owner, R1/R2/R3 migration or
canonical_relationships change is made. The catalog assertion keeps the application routine surface at **22**.
F2: **NOT TRIGGERED**.

## Holds and scope boundaries

I1–I5 remain tracked and unresolved with their exact existing descriptions in the architecture manifest.
I6 remains corrected by R3. **I7 — DASHBOARD_LEDGER_CANONICAL_READ_PATH remains unresolved:**
`apps/dashboard/repositories/dashboard.ts` functions `countAuditEvents30Days` and `getGovernanceQuestions`
still use `db.read` for ledger reads. The architecture manifest and M16 test README carry this hold for later
M16 closure/demo-readiness. R5 does not fix, remove or resolve it.

Hosted DB untouched; no gov-ia-dev or production deployment, no PR, no merge. Pre-existing
`apps/dashboard/tsconfig.tsbuildinfo` is excluded from R5 and retains SHA-256
`EA5BD83CAC8E41B63E205994B80EA6004765C0AE9E078B6DAC122514F6ACEC11`.
