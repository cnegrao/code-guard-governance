# M16-S1B.2R6 — Literal Search Semantics Closure

Starting HEAD: `7159bcfe683d3354e7101bc06e799a5c4453d948`, verified exactly on
`feat/m16-s1b-governed-registries`. The starting tree contained only the pre-existing modified
`apps/dashboard/tsconfig.tsbuildinfo`; its SHA-256 is
`EA5BD83CAC8E41B63E205994B80EA6004765C0AE9E078B6DAC122514F6ACEC11`.
Scope: audit literal search, its regression proof, and formal H1 registration. No S1B.3, redesign,
migration, RPC, hosted database/configuration change, deployment, PR or merge.

## BEFORE: reproduced on unchanged R5

`out/r6-before.log` records the new literal fixtures against the original repository implementation and
original audit test transport, before either was changed. Real disposable PostgreSQL 17.11 ran the full
canonical primary chain + R1/R2/R3. Each isolated tenant had two intended matches (description with exact
literal input, event type with uppercase input), a control in both fields, and a foreign tenant with the
same literal in both fields. Expected count: two; exact returned sequence IDs were also checked.

| Search | R5 count | Observed defect |
|---|---:|---|
| `C:\temp` | 1 | Literal rows missed; `C:temp` control matched |
| `a\b` | 1 | Literal rows missed; `ab` control matched |
| `trail\` | 0 | Literal rows missed |
| `\` | 0 | Literal rows missed |
| `path\%x` | 1 | Literal rows missed; `path%x` control matched |
| `50%` | 3 | Incorrectly included `500` |
| `a_b` | 3 | Incorrectly included `acb` |
| `x*y` | 3 | Incorrectly included `xZZy` |
| `quote"\value` | 1 | Literal rows missed; `quote"value` control matched |

The other 21 cases already returned the intended two rows under R5. The initial suite reported 31 failures
(30 cases plus parent): nine cases failed result assertions, and the other 21 failed the forward-looking
assertion that the decoded SQL uses the selected literal-regex operator. This is not a claim that all 30
R5 searches had incorrect row results. The first two launch attempts failed before database execution
(sandbox process restriction, then default PG17 binary path); the recorded reproduction used the existing
portable PG17 binaries at `out/m16-tools/pgsql/bin`.

R5 quoted `%input%` for PostgREST but did not encode input for PostgreSQL pattern semantics. After grammar
decoding, PostgreSQL still received patterns such as `%C:\temp%`, `%trail\%`, `%50%%`, and `%a_b%`.
ILIKE consumes backslashes as escapes, treats `%` and `_` as wildcards, and PostgREST maps `*` to `%` for
LIKE/ILIKE. Grammar quoting alone cannot implement literal search.

## Selected mechanism and complete escaping chain

Use existing Data API `imatch`, which maps to PostgreSQL `~*`. It supplies case-insensitive, unanchored
substring matching. An explicit `.*` wrapper is unnecessary: PostgreSQL regex already searches within
the value. There is no RPC, database object, dependency or configuration change.

1. Operator encoding prefixes every regex metacharacter (`\ . * + ? ^ $ [ ] { } | ( )`) with a backslash.
   `%`, `_`, comma, colon and double quote remain ordinary pattern characters. Escaping user backslashes
   also prevents regex escapes, backreferences or embedded options from becoming instructions.
2. Grammar encoding doubles all pattern backslashes, escapes double quotes, and encloses the whole pattern
   in double quotes before constructing the two OR predicates.
3. The installed Supabase client URL-encodes that OR expression. The R6 test intercepts fetch locally and
   decodes the actual URL parameters; no network/server HTTP request is made.
4. The independent audit transport decodes PostgREST quoted values. It retains its existing ILIKE behavior
   and adds IMATCH dispatch with no star substitution or regex encoding.
5. Real PostgreSQL 17 interprets the resulting pattern via `~*`; JavaScript never simulates its matching.

Exact values below are raw characters, not JSON/JavaScript string notation. The grammar column includes
the enclosing quotes; the database column is the value after PostgREST decoding.

```text
user input          PostgREST quoted value       decoded database pattern
C:\temp             "C:\\\\temp"                  C:\\temp
a\b                 "a\\\\b"                     a\\b
trail\              "trail\\\\"                  trail\\
\                   "\\\\"                       \\
path\%x             "path\\\\%x"                 path\\%x
50%                 "50%"                        50%
a_b                 "a_b"                        a_b
x*y                 "x\\*y"                      x\*y
a.b                 "a\\.b"                      a\.b
a+b                 "a\\+b"                      a\+b
(policy)            "\\(policy\\)"               \(policy\)
quote"value         "quote\"value"               quote"value
quote"\value        "quote\"\\\\value"            quote"\\value
```

Source anchors: the [PostgREST operator table](https://docs.postgrest.org/en/stable/references/api/tables_views.html#operators)
defines `imatch`; the [URL grammar](https://docs.postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters)
defines quoted-value escapes. The helper's narrow parser follows
[v14.1 QueryParams.hs](https://github.com/PostgREST/postgrest/blob/v14.1/src/PostgREST/ApiRequest/QueryParams.hs)
(`pLogicSingleVal`, `pQuotedValue`) and operator dispatch follows
[v14.1 SqlFragment.hs](https://github.com/PostgREST/postgrest/blob/v14.1/src/PostgREST/Query/SqlFragment.hs)
(`quantOperator`, `pgFmtFilter`: star substitution only for LIKE/ILIKE).
[PostgreSQL 17 pattern matching](https://www.postgresql.org/docs/17/functions-matching.html)
defines the final unanchored regex interpretation. The Supabase changelog was checked, including the
[17.11 minor-release notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes);
no relevant operator change was identified.

## AFTER coverage and transport boundaries

Every one of the 30 literal cases returns exactly the two expected tenant sequence IDs, count=2,
zero control rows and zero foreign rows. Every case also compares the decoded database patterns against
hand-written expected strings, independent of the production encoder.

- Backslashes: `C:\temp`, `a\b`, `trail\`, `\`, `path\%x` all match literally.
- Wildcards: `50%` excludes `500`; `a_b` excludes `acb`; `x*y` excludes `xZZy`.
- Regex: `a.b` excludes `acb`; `a+b` excludes `aaab`; `a?b`, `a^b`, `a$b`, `a[b]`, `a{b}`, `a|b`
  match their literal rows and exclude their controls. Numeric repetition `a{2}` excludes `aa` and
  embedded-option-looking `(?i)a` excludes `a`.
- Punctuation: `(policy)`, `risk)`, `(risk`, `alpha,beta`, `alpha,beta(policy)`, `quote"value`, `key:value`
  and combined `quote"\value` all match literally and exclude controls.
- Mixed-case `nEeDlE`, ordinary substring and a literal newline pass.
- Filter-like `x",event_type.ilike.%,event_description.ilike."y` remains data and cannot add predicates.

The independent transport control proves raw `imatch."a.b"` matches `acb`, escaped dot does not,
ILIKE `*a*b*` aliases stars, and escaped IMATCH star is literal. It also verifies PostgreSQL
`standard_conforming_strings=on`, as required by the helper's SQL string-literal rendering.
Final R6 suite: 32 tests including parent and transport control.

The test fetch adapter validates `gov_repo` profile, tenant query parameter, ordering and range before
forwarding to the capped SQL transport. This proves the installed SDK encoding, modeled PostgREST decoding
and real PostgreSQL matching, **not** deployed PostgREST compatibility or schema exposure. Local full-chain
tests retain the existing explicitly labeled pgvector stand-in; only its HNSW index statement may fail.
CI installs real pgvector. Hosted real HTTP acceptance remains H1.

## Regression and scope

Completed local validation (Node totals include parents):

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Focused R6/R5/R4/R3/R2 | 106 | 0 | 0 |
| Full M16 PostgreSQL 17 | 695 | 0 | 0 |
| M15 PostgreSQL | 8 | 0 | 0 |
| Dashboard | 1,151 | 5 | 0 |
| Passport UI | 15 | 0 | 0 |
| canonical-contracts | 230 | 0 | 0 |
| governance-review | 379 | 0 | 0 |

Focused breakdown: R6=32, R5=17, R4=29, R3=17 (audit 5 + S0 closure 12), R2=11.
Full M16 breakdown: S0=285, S1A=111, S1B.0=53, S1B.1/R1=74, S1B.2 policy store=30,
S1B.2R1 surface=36, R2=11, R3=17, R4=29, R5=17, R6=32; sum=695. All 31 test files ran.
Elapsed: full M16 849,661.3608 ms; focused 121,707.7501 ms. Dashboard discovered 1,156 tests;
the five pre-existing optional integration/hosted/auxiliary cases stayed skipped.

Dashboard, canonical-contracts and governance-review typechecks passed. Dashboard used
`--incremental false`; the build-info hash remains exactly the starting hash. `git diff --check` passed.
Logs: `out/r6-before.log`, `out/r6-after.log` (initial 31/31 before the SDK/transport addition),
`out/r6-focused.log`, `out/r6-m16-full.log`, `out/r6-m15.log`, `out/r6-dashboard.log`,
`out/r6-contracts.log`, `out/r6-review.log`, and `out/r6-typecheck-{dashboard,contracts,review}.log`.

Full M16 command from apps/dashboard, with M16_PG17_BIN set to the existing portable binary directory:
`node --conditions=react-server --import tsx --test --test-concurrency=2 tests/postgres-m16/*.test.ts`.
The focused command uses the same flags and the six audit/R2/R3 files. M15 uses
`node --conditions=react-server --import tsx --test tests/postgres/*.test.ts`; the other suites use their
package `npm test` scripts. No hosted test mode was enabled. Final commit SHA, push and exact-SHA M16/M15
CI verification are recorded in the final session report after the single corrective commit is published.

R5 aggregation still reads all rows in ordered 1,000-row chunks with tenant binding and rejects on an
intermediate error. Pagination retains positive safe-integer pages, limit 1..1000, rejection above the cap,
and no skipped/duplicated rows. R4 service-client reads, database-error rejection and null no-match lookup
are unchanged. `LedgerEntry`, `LedgerFilters`, `LedgerIntegrity`, all three function signatures and
successful response shapes are unchanged. Only search semantics are clarified to literal substring.

Application routine surface remains 22. No schema, routine body/signature/owner/configuration,
canonical_relationships or lifecycle change. Migration added: NO. Public contracts changed: NO.
F2: NOT TRIGGERED. Hosted databases (gov-ia-dev and production) untouched.

## Holds

The existing architecture manifest now registers **S1B2-H1 — DATA_API_GOV_REPO_EXPOSURE_AND_MAX_ROWS_ACCEPTANCE**,
classification `DEPLOYMENT_INTEGRATION_HOLD`, unresolved. Before the first hosted dashboard deployment/demo,
and no later than M16 closure, the target must prove `gov_repo` exposure, compatibility with canonical
1,000-row audit chunks, real HTTP/PostgREST acceptance of getEvents/getIntegrity/literal search, and tenant
binding. R6 registers H1 only. I1–I5 are unchanged/unresolved; I6 remains corrected by R3;
I7 — DASHBOARD_LEDGER_CANONICAL_READ_PATH remains unresolved and outside R6.
