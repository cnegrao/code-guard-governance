# SEC-01 — local transactional acquisition

Date: 2026-11-11, America/Sao_Paulo.

Result: **SEC-01 local implementation and validation PASS** under the recovered technical reference below. **M17.5 OPEN; M18 HOLD.** This is neither formal architecture approval nor M18 acceptance, deployment, or hosted verification.

## Reference and baseline

Carlos supplied the recovered specification in this implementation session and explicitly instructed implementation, tests and a local commit. He also stated that earlier formal owner approval was not evidenced. The technical reference is recorded here without inventing that approval:

1. Authorization and protected acquisition use one PostgreSQL READ COMMITTED transaction.
2. Canonical persisted M16 eligibility precedes privileged acquisition; organisation, user and ascending role locks last until transaction end.
3. Identities, counts, page membership and protected projections are acquired inside that transaction, including estates with no Agents.
4. Withhold the complete result until transaction success. Authorization and transaction failures discard it; no denial becomes business UNKNOWN.
5. Revocation committed before admission denies the read. A conflicting concurrent revocation after lock acquisition waits for transaction end.
6. Consistency ends at commit. Later revocation cannot necessarily prevent delivery of an HTTP response already in transit.

Verified baseline: `origin/main = d0cc3c2752dc413e2cf2e834165eb523291b1ad0`, also confirmed by remote `git ls-remote origin refs/heads/main`. Branch: `fix/sec01-transactional-20261111`; isolated worktree: `.worktrees/sec01-transactional-20261111`. Clean preflight passed with 133 protected historical migration paths; operational target 90 active-work minutes, informative. Platform working time is unavailable; elapsed wall time is not substituted for it.

Recovered R2: `.worktrees/m18-s1-sec01-r2`, branch `fix/m18-s1-sec01-r2`, HEAD `a5f85bf099fdbf0a24f1a369e4428730a042a162` plus its existing dirty candidate. Its report is `.artifacts/agent/GOVIA_M18_S1_SEC01_R2_CORRECTION_REPORT.md`, status `SEC01_R2_BLOCKED`; residual observation is `r2-boundary-limit-observation.json` in the same directory. The original worktree and R2 remain preserved, including their uncommitted files and TACI.

Four R2 files were copied byte-for-byte: Executive presentation, presentation model, model tests and presentation fixtures. Their paths/hashes are recorded in the isolated `.artifacts/agent/recovered-r2.json`. The R2 multi-request query and final recheck route were replaced; its unrelated shared-auth edits and navigation changes were not transplanted over current main.

## Implementation

One additive migration, `20261111123119_sec01_transactional_workspace_acquisition_v1.sql`, creates `gov_repo.read_executive_workspace_v1(uuid,uuid,bigint,bigint,timestamptz,integer)`:

- VOLATILE PL/pgSQL SECURITY DEFINER, owner `postgres`, `search_path=pg_catalog,pg_temp`, `lock_timeout=5s`; per-function PostgREST default isolation READ COMMITTED. The canonical helper rejects a directly supplied incompatible transaction with GV005.
- Calls `lock_and_resolve_governance_session_eligibility_v1` before protected reads and derives the tenant from its result. It retains the canonical ORG → USER → ascending ROLES FOR SHARE protocol unchanged.
- Materializes the tenant's scalar canonical identities once. Counts and 12-Agent page membership use that population in explicit C byte order. A scalar JSON result avoids Data API set-returning row caps and cross-request identity pagination.
- Calls the existing L14 Passport and L15 risk-overlay projections on the same backend/transaction. No projection routine is replaced. It buffers the complete acquisition and contains no exception handler, partial fallback or authorization conversion.
- Explicitly revokes PUBLIC/anon/authenticated/service_role defaults and grants only service_role EXECUTE. No new table, policy, role membership or direct authority-table grant.

The server-only Executive query uses one default POST RPC with all five verified principal fields. It validates the tenant, unique identities, closed kinds, exact page membership, and existing projection contracts before constructing the model. Shared projection decoding was extracted into pure functions; the preexisting Passport RPCs and their failure behavior are preserved. GV codes, privilege/authentication refusals and HTTP 401/403 abort through the sanitized authorization path. Other transaction/transport failures reject the whole page. Successful empty projections retain their established business UNKNOWN semantics.

The dynamic route derives the principal from the existing verified-cookie boundary. It constructs the view only after successful acquisition. There are no application eligibility recheck loops or independent privileged reads on that path.

## Real PostgreSQL concurrency evidence

`apps/dashboard/tests/postgres-m16/sec01-transactional-workspace.test.ts`: **12/12 PASS, zero skips**, PostgreSQL **17.11**, real pgvector, separate login sessions and owned disposable clusters. Full primary chain + M17S7B and 14 later canonical files replayed before the additive migration. Prior routine bodies/owners/config/ACL and table/default/member privileges compare exactly before/after the addition.

Evidence: isolated `.artifacts/agent/a1aa6b21-d0bd-43db-a7cf-a97bf269df16-0.log`; runner command duration 52.248 s.

| Probe | Observed result |
| --- | --- |
| Vulnerable R2 protocol, reproduced using real persisted SQL reads | Initial admission and identity read succeed; final USER snapshot is eligible; credential rotation commits before the independent final ORG response; one Agent remains disclosed. The no-premature-revocation criterion fails, as expected for the negative control. This reproduces the protocol, not the complete old React route. |
| Corrected acquisition, zero and one Agent | A test-only relation lock pauses identity acquisition after M16 admission. Independent NOWAIT probes for ORG/USER/ROLE each return 55P03. |
| Three conflicting independent writers | Monitor observes `wait_event_type=Lock` and `pg_blocking_pids()` naming the reader. All writers remain blocked after the function returns inside the open transaction and finish only after its commit. |
| Revocation already underway | Reader waits on the writer, then returns GV002 after the writer commits, with no acquisition JSON. |
| Prior revocations / invalid admission | Credential rotation, inactive org/user, wrong tenant, invalid temporal claims, unresolved role and incompatible isolation explicitly refuse. No model or UNKNOWN fallback. Empty estates also require M16 admission. |
| Pagination / tenant isolation | 205 identities across 18 pages appear exactly once; every page retains the exact tenant population; foreign identities are absent; requested pages clamp inside the transaction. |
| Transaction failure | Actual statement cancellation rejects the RPC. A test-only deferred foreign-key violation fails at COMMIT after SELECT; the production query bound to the real SQL transport discards its buffered acquisition. |
| Protected projections | Governed risk and L14 responsibility are created through existing real governed RPCs, then acquired with exact subject/state/proposal lineage; authority history remains unchanged. |
| Post-commit revocation | Previously committed model remains valid at its acquisition boundary; the next acquisition rejects the stale epoch. No HTTP delivery cancellation is claimed. |

## Regression and build results

All selected checks passed, without skipped tests:

| Selection | Result |
| --- | --- |
| Executive RPC transport, error handling, tenant/page contracts | 39/39 |
| Recovered Executive model | 14/14 |
| Executive presentation and route | 14/14 |
| Existing Passport query and UI | 105/105 |
| L14 projection/consumer contract | 4/4 |
| M17-S7B static acceptance | 4/4 |
| Existing PG17 canonical transactional eligibility | 33/33 |
| Existing PG17 L14 projection ACL | 4/4 |
| Existing PG17 risk-overlay projection | 1/1 |
| New PG17 SEC-01 suite above | 12/12 |
| Dashboard typecheck | PASS |
| Dashboard production build | PASS, dynamic `/workspace` included |

Total: **230 selected product/security tests PASS**, plus the final integrity check. Focused successes are reused where their production inputs remained unchanged; no full regression loop was run. Commands, candidate identities and durations are in the isolated `.artifacts/agent/verification.jsonl`. Build evidence is `sec01-build.json` / `sec01-build.log` there: 89.307 s, synthetic keys, URL `http://127.0.0.1:9`, telemetry disabled. The preexisting multiple-lockfile warning remains; no dependency or configuration change was made to silence it.

Attempts remain recorded: the first PG setup hit the historical migration loader allowlist; later tests use the established owner/readFile replay pattern. Two subsequent PG attempts exposed missing interactive psql statement delimiters, first in PID reads and then dynamic writers. The final test centralizes framing and failure cleanup. One affected attempt was explicitly interrupted; its disposable server was stopped. Static consumer verification first needed the authorized decoder consumer and then a narrower assertion distinguishing `privilegedDb.from` from `Buffer.from`. None of these unsuccessful attempts is counted as acceptance evidence; passing checks were not repeatedly rerun.

## Integrity, boundary and handoff

Final integrity verification compares original and R2 HEAD/status plus every preexisting dirty/untracked file hash, including TACI; protects all 133 historical migration paths; checks the exact 15-path candidate scope, byte-identical recovered files and `git diff --check`. Local output: `.artifacts/agent/sec01-integrity.json`; checkpoint: `.artifacts/agent/handoff.md`.

No hosted DB, production, deployment, push, merge, PR, A4/A5 modification, or disposition of F10/F11/R-05–R-08 is included. M17.5 remains OPEN and M18 HOLD. PostgreSQL and SQL transport tests are real; the installed Supabase POST encoder is tested with intercepted HTTP. A running local PostgREST server and a hosted HTTP integration were not exercised. The transaction-completion HTTP contract follows [PostgREST transaction semantics](https://docs.postgrest.org/en/stable/references/transactions.html); RPC/security conventions were checked against [Supabase database functions](https://supabase.com/docs/guides/database/functions).

Implementation security checklist and the React checklist were applied once: verified backend principal, tenant derivation, least privilege on the new routine, pinned search path, no table grants, no new cache, server-only acquisition, model retention before render, existing stable subject/state keys and accessible section/navigation labels. Existing broad service-role capabilities and owner DDL power are unchanged; no broader security closure is claimed.

Stop after validation and the specifically authorized local commit. No next implementation round is started.
