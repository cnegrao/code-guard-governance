# M17-S7D adversarial corrective: architecture STOP

Date: 2026-10-20 (America/Sao_Paulo)

Status: **BLOCKED BEFORE IMPLEMENTATION / NOT CANDIDATE-READY**.
M17: **OPEN / CORRECTIVE**. M17.5: **NOT STARTED / HOLD**.

## Git checkpoint and review provenance

- Canonical repository: `cnegrao/code-guard-governance`.
- Parent branch: `fix/m17-s7c-final-security-closure`.
- Required base and inspected implementation HEAD: `d2f575a29b590b1623b64ba8b4aaf0836fe3d504`.
- Working branch: `fix/m17-s7d-adversarial-corrective`; initially clean at that exact HEAD.
- User-supplied independent Claude Opus 5.5 Extra High review result:
  **88 PASS / 1 FAIL / 2 UNPROVEN**. This is attributed review evidence,
  not a newly executed local review.
- This checkpoint changes documentation only. No migration, runtime, test,
  workflow, hosted Supabase, Vercel, deployment or production change occurred.

## Mandatory STOP: C-M17-01 has overlapping conditions

**C-M17-01 — Hypothesis disposition projection** is a **SUPPLEMENTAL M17
CLOSURE REQUIREMENT** from frozen ADR section 5.2. It was absent from
O01-O91; those identifiers are unchanged. Final closure requires O01-O91 PASS
**and C-M17-01 PASS**, plus the requested final independent adversarial review.

The user's F-M17-D3 instruction requires STOP if multiple disposition
conditions are possible and the ADR defines no precedence. That condition is
present. No precedence or replacement architecture has been invented.

Source evidence at the exact base:

1. [Frozen ADR section 5.2](../../architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md)
   lists `UNREVIEWED`, `CITED_BY_LIVE_PROPOSAL`, `CITED_BY_GOVERNED_RISK`, and
   `CITED_BY_REJECTED_PROPOSAL`, but defines no rule for selecting among
   simultaneous citations. Section 19 explicitly permits competing proposals.
2. `supabase/migrations/20261013140000_m17_s3_governed_risk_v1.sql:571`
   defines `l15_support_links_governed_risk_owner_target_unique` over tenant,
   owner artifact, **owner ID**, tag and target. Different proposals may cite
   the same hypothesis; target-only uniqueness is not imposed.
3. `l15_normalize_support_v1` in
   `20261012210000_m17_s1_signals_hypotheses_support_v1.sql:598` checks tag,
   target existence and tenant, and duplicates within the submitted set.
   It does not consume a hypothesis or forbid its reuse by another owner.
4. `l15_submit_governed_risk_proposal_v1` in the S3 migration checks the exact
   current head and normalizes support before inserting each proposal and
   its links (`:1499`, `:1533`, `:1535`, `:1547`). Two submissions with
   expected-none are legal while there is no state/head. Proposal submission
   creates no state/head; there is no per-hypothesis consumption guard.
5. `l15_decide_governed_risk_proposal_v1` checks terminality per **proposal ID**
   (`:1714`); REJECT creates a decision without changing state/head (`:1918`).
   A later proposal can therefore cite the same hypothesis and still be live.
   VALIDATE creates its own state and lineage (`:1880` onward); it does not
   remove the earlier rejected proposal's citation.
6. The S4-S7C additive migrations do not replace these submission/decision
   routines or impose target-only hypothesis uniqueness. The final disposition
   routine remains the S1 scalar `disposition text` return contract (`:1092`).

Concrete legal counterexample, derived from these source constraints:

- Admit hypothesis H for exact tenant T and subject S.
- Submit P1 citing H with expected-none, then REJECT P1. No head is created.
- Submit P2 citing H with expected-none; leave P2 undecided.
- H now satisfies both rejected-proposal and live-proposal citation conditions.
- VALIDATE P2 with valid dependencies and authorization. H now satisfies both
  rejected-proposal and governed-risk citation conditions, even if governed
  risk is interpreted as current rather than historical.

This argument does not depend on treating stale proposals as live, different
subjects, confidence, recency, or generator ranking. It is source analysis,
**not a claimed executed PostgreSQL fixture**.

An architecture-owner clarification must define the result for these overlaps
before implementation resumes. A priority ordering, multiple returned
dispositions, or another resolution would be a new semantic choice; none has
been selected. The frozen ADR was not edited.

## Corrective status at STOP

| Finding / requirement | Current result |
|---|---|
| F-M17-D1 / O56 | OPEN. Decision-time `p_outcome = 'VALIDATE' AND v_self` defect remains. No fix or central-guard change attempted. |
| F-M17-D2 / O71 | UNPROVEN. DB-backed LLM boundary proof not implemented or run. |
| F-M17-D3 / C-M17-01 | BLOCKED: overlapping legal citation conditions without precedence. Existing S1 UNREVIEWED-only/tenant-wide exception gap remains. |
| F-M17-D4 / five static files | User-reported RED; no correction, CI change or local execution in this checkpoint. |
| F-M17-D5 / O91 | UNPROVEN / AWAITING FINAL CI. Historical PR #79/#80 results do not establish current-tree PASS. |

Requested O56 self-decision matrix (all entries refer to S7D verification):

| Family | VALIDATE | REJECT | DEFER | REVOKE | Explicit allow=true / non-self / replay / concurrency |
|---|---|---|---|---|---|
| RISK_SCENARIO_DEFINITION | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| RISK_METHODOLOGY | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| GOVERNED_RISK | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| RISK_ASSESSMENT | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| RISK_TREATMENT | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| RISK_ACCEPTANCE | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

ADMIT scope was not broadened. Its architecture assessment and the exact
matched-rule central backstop analysis remain pending with implementation.

## F7-F13 triage at the architecture stop

| Finding | Disposition | Reason |
|---|---|---|
| F7: final-catalog M16 non-regression breadth | DEFERRED | No new catalog proof executed before the mandatory architecture stop. |
| F8: Passport overlay distinction/presentation | DEFERRED | Complete lifecycle/overlay comparison not performed. UNKNOWN alone is not treated as evidence of collapse; no blocker asserted or redesign made. |
| F9: vacuous/overstated individual tests | DEFERRED | Individual review findings and affected assertions not investigated before STOP. |
| F10 | DEFERRED | Prompt provides only a grouped low-level-hardening description; no individual finding detail supplied. |
| F11 | DEFERRED | Same detail limitation; no runtime change inferred. |
| F12 | DEFERRED | Same detail limitation; no runtime change inferred. |
| F13 | DEFERRED | Same detail limitation; no runtime change inferred. |

## Verification, inventory and handoff

Preflight PASS with explicit `--base` and `--expected-base` both pinned to
`d2f575a29b590b1623b64ba8b4aaf0836fe3d504`, requested branch, clean tree and
90-minute informative active-work target. The initial preflight invocation
omitted `--base`, so it compared local `origin/main` (`1914e7e...`) with the
requested parent and stopped. Inspecting the CLI established the cause;
pinning the authorized parent fixed the invocation. No base or branch changed.

The initial PowerShell `rg` path containing a wildcard was rejected; the
equivalent directory search with `-g '2026101*.sql'` supplied the source evidence.

No PG17, static suite, typecheck, S7A/S7B, or security test was run: implementation
stopped before any executable change. No PASS is inferred for an unexecuted
check. `git diff --check` is the documentation checkpoint validation, recorded
in the local handoff.

Final definer baseline: **36**, inherited from S7C evidence, **not remeasured in
S7D**. Definer count/body/hash/config/owner/ACL delta introduced here: **zero**
because no SQL was changed. No new hashes are asserted. Service-role and machine
capability surfaces are unchanged by this documentation checkpoint.

Candidate-ready for PR: **NO**. Do not open a PR. The next action is an explicit,
narrow architecture clarification for C-M17-01 overlap semantics, followed by
resuming the authorized S7D implementation and focused checks. M17 stays
**OPEN / CORRECTIVE** until runtime/proof blockers pass, current PR CI proves
O91, and final independent adversarial re-review passes. M17.5 stays
**NOT STARTED / HOLD**.
