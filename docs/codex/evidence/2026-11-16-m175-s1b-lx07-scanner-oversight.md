# M17.5 / V1-S1B / LX07 — scanner oversight producer containment

Date: 2026-11-16, America/Sao_Paulo. Local implementation only; no commit,
push, merge, deployment, hosted access or credential provisioning.

## Git and roadmap position

Canonical repository: `cnegrao/code-guard-governance`. Original worktree:
`feat/m17.5-c3-sr2-semantic-replacement`, HEAD
`96f30b0e02d71189083ed1cd6478a12fd011dd09`, existing M18 candidate untouched.
Local `main` and `origin/main`: `fad55c937667f036cc7af5b21d45efd8db1ed049`;
no remote freshness claim is made.

Implementation worktree: `.worktrees/m175-s1b-lx07-20261116`, branch
`feat/m175-s1b-lx07-20261116`, HEAD/base `fad55c937667f036cc7af5b21d45efd8db1ed049`.
Preflight was clean, with a 90-minute informative operational target.

The [frozen read contract §14](../../trust-assurance/v1-hub-read-contract.md#14-implementation-classification-and-proposed-slices)
places live legacy containment in **V1-S1B**, after S1A and before S1C/S2.
Its LX07 row (§12) excludes the `l1_automated` default from proof of governance,
applicability or sufficiency; ledger presence cannot upgrade it. The
[C2B-2 inventory](2026-10-21-m17.5-v1-s1b-c2b2-l03-llm-deep-containment.md)
records LX07 as independently open. S1A, C1, C2A, C2B-1 and C2B-2 are preserved,
not reopened. C3/LX03 still depends on SR2 and is not resumed.

**Completed component:** core scanner oversight production and its Unified
Scanner technical graph projection. **V1-S1B and the complete LX07 exposure gate
remain OPEN.** This is additive status, not a revision of frozen contracts.

## Demonstrated defect and change

At the starting HEAD, `core/classifier.ts` initialized effective `oversightLevel`
to `l1_automated`, accepted any nonempty input through a type assertion, and
promoted risk/autonomy heuristics to human oversight levels. Framework detection
also placed its default in that observed-level field. The summary derived a
boolean human-oversight requirement from those values.

The producer now emits `oversightLevel: UNKNOWN`, with `NOT_EVIDENCED` and
`NON_AUTHORITATIVE` metadata. Recognized supplied legacy levels are unverified.
Framework defaults and prior risk/autonomy suggestions remain in a separate,
closed-vocabulary recommendation with its derivation. No recommendation proves
that oversight exists, is applicable or sufficient. Invalid input is not cast or
reflected into an accepted level.

Agent names and derived legacy IDs are preserved; the existing source-file
locator is retained on each detected agent and recommendation source. No
canonical identity is created or joined by name. The technical graph receives
the same bounded metadata. `requiresHumanOversight` is `UNKNOWN`, even when empty.

Compatibility is explicit: core classifications no longer supply a positive
effective oversight level, and the oversight-summary field is no longer boolean.
Consumers must handle `UNKNOWN` rather than test its truthiness. Existing risk,
AI Act heuristics and confidence calculations are unchanged, remain outside this
slice, and acquire no governance authority from this change.

## Functional evidence and verification

The actual local `Scanner.scan` ran against one synthetic Python source with
network fetch prohibited. No LLM or embedding model was loaded or invoked.
Output: `.artifacts/agent/lx07-functional.json`.

| Input | Effective oversight | Evidence | Separate recommendation |
|---|---|---|---|
| Neutral agent, no oversight input | UNKNOWN | NOT_EVIDENCED | null |
| `workflow.py`, LangGraph pattern | UNKNOWN | NOT_EVIDENCED | `l2_human_review`, FRAMEWORK_DEFAULT |

The graph retains ID `langgraph-workflow`, label `LangGraph_workflow` and locator
`workflow.py`. Egress count: **0**. This is synthetic scanner evidence, not tenant
evidence or a hosted UI claim.

Initial focused verification: **18 tests PASS**, strict scanner typecheck PASS.
Cases cover absent/valid/invalid inputs, unverified legacy values, heuristic
recommendations, identities, locators, isolated instances, closed public types,
unknown summaries and actual scanner/graph execution. Final verification also
covers explicit UNKNOWN from the public detector and runtime non-string inputs;
the selected final suite contains 19 tests. Results and candidate fingerprints
are stored by the local runner in `.artifacts/agent/` and its final handoff.

Relevant integration: existing **L02 14/14 PASS**, including local execution,
public exports, technical graph and preservation of removed certification fields.
No full-regression or semantic-provider suite was repeated.

```text
node scripts/agent/verify.mjs --base fad55c937667f036cc7af5b21d45efd8db1ed049 --profile focused --script packages/scanner:test:lx07 --script packages/scanner:typecheck:lx07
node scripts/agent/verify.mjs --base fad55c937667f036cc7af5b21d45efd8db1ed049 --profile integration --script packages/scanner:test:l02
node scripts/agent/verify.mjs --base fad55c937667f036cc7af5b21d45efd8db1ed049 --profile final --script packages/scanner:test:lx07 --script packages/scanner:typecheck:lx07
node --import tsx .artifacts/agent/lx07-functional.cjs
```

This is a pure local projection: no tenant selection, authentication, database
reader, permission or canonical authority was added. Tests reject propagation
of arbitrary tenant/canonical/secret input fields, without claiming a new
end-to-end multitenant authorization validation. Existing boundaries are
untouched. No browser UI was changed.

## BYOM decision and preserved work

Per the owner, the **real synthetic OpenAI connection test is a future pending
item, blocked by CREDENTIAL_MISSING**. No credentials are requested or provisioned.
Existing egress/tenant controls remain mandatory if separately resumed. Model
identity/admission remains a separate SR2 qualification gate.

BYOM remains in `.worktrees/m175-byom-vertical-20261114`, branch
`feat/m175-byom-vertical-20261114`, base `fad55c9`. Its implementation, prior 72
passing tests, local audit and operator-assisted login evidence are preserved,
not rerun or promoted to real provider inference PASS. Prior evidence records
`POST /api/auth/login 200` and `GET /settings/models 200`, confirmed by the operator
on 2026-11-14. Existing root/BYOM changes and BYOM audit were fingerprinted in
`.artifacts/agent/preserved-inputs.json`. Secret configuration was not read.

**BYOM is not concluded; SR2-A4 remains BLOCKED.** No model comparison, reranker,
population, A5 or A6 work was started.

## Remaining boundaries and stop

LX07 historical values, ledger payloads, legacy dashboard/Talk/report consumption
and alternate codeguard-classifier output are not cleared by this core producer
change. Historical records were not rewritten. Complete exposure acceptance
remains a separate gate; this component releases no readiness HOLD.

LX01, LX03, LX04, LX05 and LX06 remain open under existing records. C3/LX03 still
awaits SR2 qualification/integration. M17.5 **OPEN**, M18 **HOLD**; S1C/S2, M19 and
A5/A6 were not started. No further component is selected or started automatically.
