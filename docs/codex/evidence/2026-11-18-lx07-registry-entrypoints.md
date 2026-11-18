# LX07 Registry Entry Points — local ACP candidate

**Current candidate:** the owner-registration correction appended below supersedes
the initial owner-input limitation. The original approved evidence is preserved.

2026-11-18, America/Sao_Paulo. **STOP for ACP review.** No commit, push,
PR, merge, migration, hosted/Supabase operation, infrastructure or deployment.

## Git and scope

- Repository: `cnegrao/code-guard-governance`.
- Branch: `fix/lx07-registry-entrypoints-20261118`.
- Worktree: `.worktrees/lx07-registry-entrypoints-20261118`.
- HEAD/base: `321012f0967a1f3aab778b26100e333d8ddb7c77`, the merged PR #85.
- Clean isolated preflight passed; operational target: 90 active-work minutes.
  Original root branch/HEAD and unrelated dirty work were preserved.
- Contracts: `docs/agent/OPERATING_MODEL.md`, the architecture index's LX07
  pointer, `docs/trust-assurance/v1-hub-read-contract.md` §12/§14 and merged
  LX07 producer/Discovery/Reports/detail implementation. No architecture conflict.

## Behavior and exact files

| Changed file | Purpose |
| --- | --- |
| `apps/dashboard/components/agents/AgentForm.tsx` | Empty initial oversight selection; required explicit historical-label choice, submit guard and UNKNOWN/NOT_EVIDENCED explanation. |
| `apps/dashboard/services/agents.ts` | Reuse PR #85's `projectAgentDetail` for list/create as well as existing detail/update; narrow return types. |
| `apps/dashboard/hooks/useAgents.ts` | Collection consumers use the contained public DTO type. |
| `apps/dashboard/types/agents.ts` | Clarify the existing DTO covers registry responses. |
| `apps/dashboard/package.json` | Register the UI test with the existing non-react-server runner convention. |
| `apps/dashboard/tests/lx07-registry.test.ts` | Six real route/service/repository behavior and type-contract tests with in-memory transport. |
| `apps/dashboard/tests/lx07-registry-ui.test.ts` | Two tests of actual form handlers/rendering and actual list hook/table rendering. |
| `docs/codex/evidence/2026-11-18-lx07-registry-entrypoints.md` | This delivery record. |

The existing DTO/allowlist is unchanged: `oversight_level: UNKNOWN`, plus
`oversight.effectiveLevel: UNKNOWN`, `evidenceStatus: NOT_EVIDENCED`,
`authority: NON_AUTHORITATIVE`, exact historical `recordedLevel` and source
organisation/agent identity. No admitted authoritative oversight input exists in
these flows; favourable flags, production approval or injected envelopes cannot
upgrade supervision, applicability or sufficiency.

GET/POST handlers, schemas and repository queries/writes are unchanged. The
existing schema requires one of four historical enum values; omission/empty/
invalid input fails before persistence and cannot invoke a database default.
Explicit accepted L1–L4 choices are stored unchanged. Historical reads also
preserve null/missing/empty/unknown/unrecognized labels under the existing DTO.
Callers needing the stored label now read `oversight.recordedLevel`; treating
the top-level field as an effective positive level is intentionally contained.

Direct consumers examined: `/agents/new` → AgentForm → POST → detail navigation;
`/agents` → AgentTable → useAgents → GET; detail GET/PUT and the shared projection.
AgentTable has no oversight column, so no additional positive presentation was
introduced. Count, pagination, legacy risk filters, status, identities and links
are retained. Authentication and active same-organisation owner admission remain
in their original handlers/services. No new permission or canonical fact exists.

## Verification

| Check | Result |
| --- | --- |
| New API/service/repository tests | 6 PASS |
| Actual form and list UI/hook tests | 2 PASS |
| Existing legacy-control API compatibility | 16 PASS |
| Existing legacy-control source contracts | 4 PASS |
| Dashboard typecheck (`--noEmit --incremental false`) | PASS |

Commands from this worktree:

```text
node scripts/agent/verify.mjs --base 321012f0967a1f3aab778b26100e333d8ddb7c77 --profile focused --test apps/dashboard/tests/lx07-registry.test.ts --script apps/dashboard:test:registry-ui
node scripts/agent/verify.mjs --base 321012f0967a1f3aab778b26100e333d8ddb7c77 --profile integration --test apps/dashboard/tests/legacy-control-api.test.ts --test apps/dashboard/tests/legacy-control-source-contract.test.ts
node ../../node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/dashboard/tsconfig.json
```

Focused logs: `.artifacts/agent/8ef6b1e8-3235-4ee6-9b6e-9b9d030398a2-{0,1}.log`.
Integration logs: `.artifacts/agent/b266e095-6958-4592-aa2e-23b1d5fc387b-{0,1}.log`.
All 28 behavior/compatibility tests passed on their first invocation. The first
typecheck reported TS2339 because `assert.deepEqual(calls, [])` narrowed the
query log to `never[]`. Adding only `as Call[]` corrected that test annotation;
the subsequent typecheck passed. Runtime evidence is reused after this erased
type-only correction and this document; no behavior suite was repeated.
No compiler cache output was generated. Final whitespace/integrity results are
recorded in `.artifacts/agent/handoff.{json,md}`.

Previously approved evidence is reused from [PR #84](https://github.com/cnegrao/code-guard-governance/pull/84)
and [PR #85](https://github.com/cnegrao/code-guard-governance/pull/85), including
PR #85's unchanged detail projection/rendering checks. Existing M15/M16 CI
conclusions were read, not rerun:

- PR #84: [M15 PASS](https://github.com/cnegrao/code-guard-governance/actions/runs/44098320937/job/134091306060),
  [M16 PASS](https://github.com/cnegrao/code-guard-governance/actions/runs/44098320930/job/134091306018).
- PR #85: [M15 PASS](https://github.com/cnegrao/code-guard-governance/actions/runs/44172275080/job/134354256263),
  [M16 PASS](https://github.com/cnegrao/code-guard-governance/actions/runs/44172275096/job/134354255502).

These are baseline evidence, not claims of CI validation for this uncommitted
candidate. No M15/M16 local execution, full regression or unrelated scanner/
Discovery/Reports suite was performed.

## Limitations, attempts and next action

- Existing AgentForm has no `owner_user_id` input, although the server requires
  a valid active same-organisation owner. This predates the slice and remains a
  separate registration usability limitation. The form handler test uses a
  synthetic success response; API success tests supply a valid synthetic owner.
  No complete successful browser registration is claimed.
- Route tests execute real handlers/services/repositories with an in-memory DB
  transport and mocked verified principal. UI tests use server rendering and
  hook/event mocks. No browser, hosted persistence, RLS or production proof.
- Historical storage/defaults/ledger payloads are not rewritten. Talk, GraphOS
  and other independent legacy consumers remain outside this slice. Complete
  LX07, V1-S1B and M17.5 remain OPEN; readiness/M18 HOLDs remain.
- Sandbox initially blocked Git metadata creation and preflight subprocesses;
  authorized local reruns succeeded. GitHub connector startup failed; read-only
  CLI retrieved PR metadata and CI. Its sandbox-blocked CI request succeeded
  after escalation. No missing dependency or unresolved implementation blocker.
- Active working time is not platform-reported; wall-clock telemetry is not
  substituted for it. Runner command durations/attempts remain in ignored logs.

**Next action: independent ACP review of this local eight-file delta against
`321012f0967a1f3aab778b26100e333d8ddb7c77`.** No follow-up implementation or
publication starts automatically.

## Owner-registration correction — same-session continuation

Carlos approved the initial candidate and authorized correcting the missing
`owner_user_id` before publication. Same branch, HEAD/base and original preflight
identity were retained. All eight approved file hashes matched
`.artifacts/agent/registry-delivery.json` before editing; the candidate, manifest
and original handoff were copied to `.artifacts/agent/owner-correction/approved/`
and adjacent JSON files. No session or attempt history was reset.

### Corrected behavior and delta

The existing `repositories/users.ts::getUsersByOrg` already selects active users
by exact `organisation_id`. The server-rendered new-agent page now authenticates
with `requireVerifiedGovernancePrincipal`, uses its organisation for that query,
and passes only `{ user_id, full_name }` to the client. Unauthenticated/invalid
sessions redirect to login before any owner query. Lookup failure throws rather
than manufacturing options. No new endpoint, directory grant, role definition or
owner eligibility policy was introduced.

AgentForm starts with an empty required owner choice and sends the selected real
user ID in `owner_user_id`. Empty or non-option selections cannot submit; an
empty active-owner population displays an explanation and disables creation.
The existing service revalidates the selected ID, active status and exact tenant
at POST time, including an owner suspended or moved since page load. Ownership
can differ from the authenticated creator. This is legacy registration ownership,
not a new L14 assignment or proof of supervision.

Correction-only files (relative to the approved candidate):

1. `apps/dashboard/app/(dashboard)/agents/new/page.tsx` — authenticate and load
   existing active same-organisation owner options.
2. `apps/dashboard/components/agents/AgentForm.tsx` — required owner selection,
   payload and local missing/invalid-option guard.
3. `apps/dashboard/tests/lx07-registry-ui.test.ts` — retain both approved tests;
   supply owner options and select an owner in the form fixture.
4. `apps/dashboard/tests/lx07-agent-registration-ui.test.ts` — six new complete
   registration and denial tests.
5. `apps/dashboard/package.json` — include the new UI integration in the existing
   dedicated runner and exclude it from react-server tests.
6. This evidence document — preserve the initial report and append the correction.

The consolidated candidate contains **ten files**: the original eight plus the
new-agent page and registration integration test. The repository user query,
POST/schema, service/repository writes, DTO and oversight architecture are
unchanged by this correction. The original oversight options, empty default,
explicit-choice guard, unverified label and UNKNOWN/NOT_EVIDENCED explanation
remain intact. Historical storage and response containment remain unchanged.

### Additional validation and reused evidence

```text
node scripts/agent/verify.mjs --base 321012f0967a1f3aab778b26100e333d8ddb7c77 --profile focused --script apps/dashboard:test:registry-ui --hypothesis "Approved form now requires server-provided active same-organisation owner selection; rerun the affected two UI checks and new real page-POST integration only"
node ../../node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/dashboard/tsconfig.json
```

- **8/8 PASS**, no failures/skips: the two affected approved UI tests plus six
  new integration tests. One invocation; no separate duplicate integration run.
  Log: `.artifacts/agent/0fdffa8d-5e63-4041-80e7-e5cbf23699c2-0.log`.
- The successful path obtains page options, fills the actual form, dispatches
  its payload through the real POST, verifies a real signed synthetic cookie,
  runs schema/service/repositories, inserts into the in-memory transport and
  checks response, subsequent list read and navigation to the returned ID.
  Selected owner, creator and tenant identities are checked separately. Raw L2
  is stored historically; effective supervision stays UNKNOWN / NOT_EVIDENCED.
- Negative cases cover no owner, foreign choice, empty owner list, suspension
  or tenant move after loading options, missing/invalid cookie, forged tenant
  headers/body, lookup denial and write failure. No failure navigates to success.
- **Dashboard typecheck PASS.** First attempt found TS2345 in the new test helper:
  `randomUUID` inferred a UUID template-literal parameter and rejected the empty
  string used by missing-owner cases. Only `owner: string` was added. The second
  attempt passed; emitted-JavaScript equivalence permits reusing the passing
  runtime result after this erased annotation. No cache output was generated.
- All **28 approved tests are preserved**: two affected UI tests rechecked and
  the other 26 results reused with unchanged execution inputs (six registry API,
  sixteen legacy API and four source contracts). Coverage evidence totals
  **34 tests**, with 8 executed in this correction and 26 reused. M15/M16 and
  other full suites were not repeated; PR #84/#85 baseline evidence above remains.
- Condensed React checklist: authentication precedes tenant reads, only minimal
  serializable owner props reach the client, no shared request state/cache or
  added fetch waterfall, hooks remain unconditional, owner input has an accessible
  name/help and required/disabled states, and the server independently revalidates.

Final type-erasure/containment/hash checks are recorded in
`.artifacts/agent/owner-correction/final-manifest.json` and the final handoff.
Only documentation and an erased test annotation followed the passing runtime
check. The correction adds no supervisor evaluator or positive authority path.

### Limits and STOP

The missing-owner functional defect is resolved in the local test environment.
The complete application path uses real application modules with Next cookie/
navigation adapters, React hook/render harness and an in-memory DB transport.
This is not a real browser, PostgreSQL persistence, hosted RLS or deployment
validation. No Supabase connection, migration, infrastructure, commit, push, PR,
merge or deployment occurred. No unresolved implementation blocker; LX07 and
the existing readiness/M18 HOLDs remain unchanged.

**STOP after validation. Next action: ACP review of the consolidated ten-file
local delta, using the six-file owner correction against the preserved approved
snapshot where useful.** No publication is authorized.
