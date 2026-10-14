# Shared operating model

Codex and Claude follow the same process. Git supplies current state: inspect origin, branch, HEAD, base, diff and merged implementation patterns before resuming. Conversation history is not a state ledger. One session has one objective; do not start a second independent objective.

## Phases and checkpoints

Preflight → implement → focused verification → candidate-ready integration verification → final verification once → handoff.

1. **Preflight:** confirm the authorized objective, base and branch; locate architecture through [the index](ARCHITECTURE_INDEX.md). Run the preflight below on a clean worktree before editing.
2. **Implement:** inspect merged patterns, make the scoped change, and use focused checks while coding.
3. **Focused verification:** cover the affected behavior; never run the whole suite after every edit.
4. **Candidate-ready integration verification:** select relevant cross-component checks only after implementation is ready. Record why a phase has no applicable checks.
5. **Final verification once:** run the selected remaining checks. Heavy/full regression normally runs once; earlier passing evidence can be reused when its inputs are unchanged. CI remains the independent final repository gate.
6. **Handoff:** report Git state, evidence, attempts, blockers and the exact next action. Opening or merging a PR requires an explicit request.

After every phase, checkpoint objective, branch, HEAD, files changed, tests/results and next action using `handoff.mjs --phase <phase>`. Generated files live in ignored `.artifacts/agent/`; they are local evidence, not authoritative project history. The latest checkpoint overwrites `handoff.json` and `handoff.md`; verification events and logs are append-only.

## Cycle controls

- Same failure twice without a materially new hypothesis: STOP.
- Never repeat the same command without new evidence or a changed hypothesis. A changed Git candidate alone is insufficient if unrelated to the failure.
- Stop on architecture conflict, missing dependency, a need to edit historical migrations, a hosted mutation requirement, or scope ambiguity.
- No review-of-review loops. Perform ACP delta review once when applicable.
- Declare an active-work operational target at preflight. Assess it together with measured command durations, attempt count and new evidence/commit/hypothesis; wall-clock delay alone never triggers STOP.
- Record the STOP reason and next action in handoff. Do not silently reset evidence to bypass a stop.
- Hosted mutation requires explicit Carlos authorization and is never performed by `govia-slice`. Deployment/production changes require explicit authorization outside this local workflow.

## Local tools (Node 24, no added dependencies)

Run from the repository root. The tools require canonical `origin` and an available ancestor base, defaulting to local `origin/main`. They never fetch: check remote freshness separately when needed. Pin `--base <sha>` on later commands if `origin/main` moves during a session.

```sh
node scripts/agent/preflight.mjs --expected-base <full-main-sha> --branch <implementation-branch> --budget-minutes 30
node scripts/agent/verify.mjs --discover
node scripts/agent/verify.mjs --profile focused --syntax scripts/agent/preflight.mjs --plan
node scripts/agent/verify.mjs --profile focused --syntax scripts/agent/preflight.mjs
node scripts/agent/handoff.mjs --objective "One objective" --phase focused --next-action "Review candidate"
```

Preflight checks Node 24, canonical origin, clean index/worktree, a non-main implementation branch, requested branch, base ancestry and exact expected SHA when supplied. It compares historical migration paths to the base and stores a baseline count/tree digest. It rejects changed known deployment/configuration paths and any `--scope` other than `local`. These checks detect file scope, not intent: inspect the requested operation for hosted effects even if no protected file changes. No tool grants hosted authorization.

Every implementation preflight requires `--budget-minutes <positive integer>`; the existing flag and stored `budgetMinutes` now declare an informative active-work target. `--objective <text>` optionally labels the session. A successful explicit preflight creates a fresh identity in ignored `.artifacts/agent/session.json`, including branch, base, starting HEAD and preflight start. The existing `deadlineAt` field is only a diagnostic target timestamp. Failed preflight never replaces that session. This file is timing evidence, not project truth: Git remains authoritative. Verification and handoff fail closed on a missing/invalid session or branch/base mismatch. A later commit on the same branch does not restart the clock.

Verification checks session identity before starting and before each command. Each subprocess retains its independent 30-minute safe command timeout, regardless of session wall-clock elapsed time. Individual command timeout (`timed-out`) or failure stops verification. Session wall-clock elapsed time never rejects a subprocess, blocks verification, or fails handoff.

Handoff separates wall-clock telemetry, measured execution and the operational target. Wall-clock telemetry includes preflight start, elapsed time and the first verification timestamp/interval; it may include user/approval idle time and cannot measure active reasoning or exploration. Exact command/test durations use a monotonic clock, with focused, integration, final and total verification command milliseconds recorded. Interrupted attempts have unknown duration, so totals omitting them are explicitly lower-bound approximations. External validation is not included in recorded totals. Operational target status is always `INFORMATIVE`, never automatically `EXHAUSTED` from elapsed wall clock. Earlier event statuses remain historical evidence and do not turn wall-clock telemetry into a STOP.

Verification and handoff repeat the shared candidate safety check without requiring a clean worktree. Historical migration changes and protected paths in either the index or working candidate fail closed before validation or handoff output; new additive migrations remain legal.

Verification profiles are deliberately explicit, with **no default test suite**:

| Profile | Selection policy |
| --- | --- |
| `focused` | Only checks needed for the current edit |
| `integration` | Relevant integration checks once candidate-ready |
| `final` | Remaining final checks, at most one invocation per candidate |

All profiles accept repeated `--script <directory>:<script-name>`, `--test <file-or-glob>` and `--syntax <file.mjs>`. `--discover` lists existing package scripts, test files and workflow paths. `--plan` prints the exact commands without executing or consuming an attempt. A missing selection, nonexistent command/file or unsupported profile fails. Package script names must begin with `test`, `typecheck`, `lint` or `validate`; inspect their displayed bodies and local prerequisites before execution. This is a runner, not a sandbox for arbitrary package scripts.

`--test` uses Node's test runner with the existing dashboard and contract/governance flags, and `tsx` for TypeScript. Use package scripts for tests requiring a different harness. Globs expand inside Node on every platform. Commands run without a shell; package scripts use the installed `npm-cli.js` adjacent to Node, or `npm_execpath` pointing to that CLI. A missing runtime/dependency is a blocker; the tools do not install it.

Within each `--test` pattern, files with the same package and runner flags share one Node invocation. Different packages or runner configurations remain separate; overlapping test selections are rejected.

Verification records an attempt before execution and stops on the first failed command. Logs and JSONL results include candidate, command, hypothesis and status. An identical command on the same candidate/hypothesis is blocked; provide `--hypothesis "materially new evidence and proposed cause"` only when justified. Final attempts are reserved before execution and cannot be retried on the same candidate, even after interruption. Candidate identity includes HEAD, working diff and untracked file content; ignored artifacts are excluded. Agents remain responsible for detecting repeated failures across candidates and for the broader cycle controls above.

For M17/PostgreSQL work, choose checks based on the affected scope. Existing sources at framework introduction include:

| Concern | Discoverable selection/source |
| --- | --- |
| Affected M17 tests | `--test 'apps/dashboard/tests/m17-sN-*.test.ts'` and applicable `tests/postgres-m16/m17-sN-*.test.ts`; replace N with an implemented slice |
| Dashboard | `--script apps/dashboard:test` when relevant |
| Canonical contracts / governance review | `--script packages/canonical-contracts:test`, `--script packages/governance-review:test` |
| M15 PostgreSQL regression | `--script apps/dashboard:test:postgres`; `.github/workflows/m15-postgres-regression.yml` |
| M16 PostgreSQL 17 security | `--test 'apps/dashboard/tests/postgres-m16/*.test.ts'`; `.github/workflows/m16-postgres17-security.yml` and the local harness README |
| Relevant typechecks | `--script .:typecheck:dashboard`, `--script packages/canonical-contracts:typecheck`, `--script packages/governance-review:typecheck` |

These are choices, not an always-run suite. Re-discover before use. PostgreSQL checks require the existing disposable local harness and its documented binary prerequisites. Docs/tooling changes do not justify heavy M15/M16 database regression by themselves.

M15/M16 CI runs for pull requests targeting `main`, pushes/merges to `main`, and manual dispatch. Feature-branch pushes do not trigger these heavy workflows; pull request events provide their validation without duplicate push runs.

Handoff derives branch, HEAD, base, changed files and worktree state from Git. It includes recorded validation/results, attempt count and interrupted commands. Earlier candidate evidence is labeled; it is never presented as proof of the current candidate. Use repeated `--validation "command: result"` for external checks, `--attempt "description"` for attempts outside the runner, `--blocker "description"`, `--stop-reason "reason"`, and required `--objective` / `--next-action`. No recorded tests means no recorded tests, not success.

When available, record platform-reported working time manually with `handoff.mjs --reported-working-time "7m 42s"` alongside the required arguments. This is explicit input, not inferred from timestamps, scraped from the Codex UI, or automatically measured by repository tooling. If unavailable, leave it unspecified.

## Active-work operational targets

- Small correction/tooling task: normally 30 minutes.
- Normal implementation slice: normally 90 minutes.
- A larger target requires explicit justification in the task prompt.

These are operational active-work targets declared at preflight, not automatic wall-clock kill switches. Wall-clock time is not active-agent time: approval/user waiting must not trigger a STOP. Repository tooling cannot automatically measure Codex reasoning time, time waiting for permission, or time waiting for the user, and cannot reliably separate them.

The executor uses platform-reported working time when available, together with exact command durations, attempt count and new evidence/commit/hypothesis, to assess whether the active-work target is being exceeded and decide the next checkpoint or STOP. These signals are not assumed to be disjoint; do not add command durations to a platform total that already includes them. If working time is unavailable, report that limitation instead of substituting elapsed wall clock. No automatic extension/reset behavior is needed because there is no wall-clock kill switch. Preserve session and validation evidence; a new session does not erase attempt controls.

Deterministic STOP controls remain mandatory: same failure twice without a materially new hypothesis; repeated command without new evidence/hypothesis; architecture conflict; historical migration requirement; hosted mutation requirement; scope ambiguity; final verification already attempted for the same candidate; individual command timeout or failure. Tooling enforces its existing candidate, command and final-attempt guards; the executor remains responsible for semantic stop conditions and repeated failures across candidates.

## Operational targets

Feature prompt <1500 tokens; corrective prompt <700 tokens; context >150k is exceptional; ACP delta review once; architecture blockers introduced = 0. These are targets, not guarantees; deterministic STOP controls remain mandatory.
