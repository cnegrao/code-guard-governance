# M17.5 / V1-S1B / LX07 — live discovery oversight containment

Date: 2026-11-16, America/Sao_Paulo. Local candidate for Claude Code adversarial
review. **LX07, V1-S1B and M17.5 remain OPEN.** No readiness release.

## Git baseline and preservation

- Canonical origin: `https://github.com/cnegrao/code-guard-governance.git`.
- Reviewed producer branch: `feat/m175-s1b-lx07-20261116`, worktree
  `.worktrees/m175-s1b-lx07-20261116`, HEAD/base
  `fad55c937667f036cc7af5b21d45efd8db1ed049`. Its producer changes were uncommitted.
  The owner reports Claude Code `PASS_WITH_FINDINGS`; this slice does not reopen
  that producer or represent that review as approval of the live route.
- Correction branch: `fix/m175-lx07-discovery-oversight-20261116`, worktree
  `.worktrees/m175-lx07-discovery-oversight-20261116`, same HEAD/base. Clean
  preflight passed before copying the 12 approved producer files byte for byte.
  Informative active-work target: 90 minutes. No remote freshness claim.
- Original root branch `feat/m17.5-c3-sr2-semantic-replacement`, HEAD
  `96f30b0e02d71189083ed1cd6478a12fd011dd09`, and its unrelated uncommitted
  changes were preserved. Neither original worktree was switched, staged,
  stashed, reset or committed.
- Preservation manifests: `.artifacts/agent/approved-producer-files.json` and
  `.artifacts/agent/preserved-root-files.json`. The local artifact script
  `discovery-delivery.cjs` checks file sets, branch/HEAD and SHA-256 bytes against
  those snapshots, and checks the copied producer in the correction worktree.
  Its results and correction-file hashes are in `discovery-delivery.json`.

## Actual route before and after

The dashboard TypeScript alias `@council/scanner/*` resolves to
`packages/scanner/src/*`. Thus `/api/discovery/scan` uses **codeguard/classifier**,
not the approved **core/classifier** producer.

```text
POST /api/discovery/scan
  -> verified governance principal -> bound write principal
  -> started ledger event -> provider files/readFile
  -> codeguard/detectAgents -> systems + repo intelligence
  -> technical knowledge graph + coding-memory indexing + cross-file lineage
  -> enrichAgent -> codeguard/classifyAgent
       catch/read or enrichment failure -> same classifier without enrichment
  -> result.agentsDiscovered + classified JSON
  -> agent.detected ledger classification (heuristic risk keys removed)
  -> completed ledger event -> JSON response
```

| Boundary | Before | After |
|---|---|---|
| Default classification | Effective `oversightLevel: l2_human_review` without evidence | Effective `UNKNOWN`; envelope `NOT_EVIDENCED / NON_AUTHORITATIVE`; separate L2 `CLASSIFIER_DEFAULT` recommendation |
| Autonomy or critical priority | Effective L3; autonomy reasoning said “requires L3+ oversight” | Effective `UNKNOWN`; separate L3 with `AUTONOMY_HEURISTIC` or `CRITICAL_PRIORITY_HEURISTIC`, explicitly `NON_AUTHORITATIVE` |
| Detector defaults | Raw `suggestedOversightLevel` in both JSON projections | Existing suggestion retained with `suggestedOversightAuthority: NON_AUTHORITATIVE`; closed-vocabulary normalization, invalid/absent values become `UNKNOWN` |
| Result projection | No effective oversight/evidence envelope | Includes effective `oversightLevel` and full `oversight` envelope |
| Classified projection and new ledger payload | Classification could assert L2/L3 | Both carry the same unknown effective state, evidence state, recommendation authority, derivation and source-file locator |

There is **no admitted authoritative oversight-evidence input** in this flow.
Recognized L1–L4 strings, source claims of approval, confidence, autonomy and
enrichment cannot establish oversight, applicability or sufficiency. A positive
authorized-evidence path was not invented. Positive tests prove real detection,
locators and valid recommendations; they do not claim authoritative supervision.

Direct consumers inspected:

- `app/(dashboard)/discovery/page.tsx` uses the response `message` and separately
  reloads `/api/discovery/review`; it does not render the classification fields.
  Historical inventory reads are unchanged and not cleared by this slice.
- The new `inventory.discovery.agent.detected` payload retains the bounded
  classifier envelope. Existing `withoutHeuristicRisk` filtering and V2 ledger
  principal/session binding are unchanged. Historical events are not rewritten.
- `repo-intelligence/index.ts` projects name, filePath, framework, agentType and
  legacy risk before classification. `repo-knowledge-graph.ts` consumes that
  projection. `coding-memory.ts` chunks technical fields/source code, not the
  classifier oversight. These consumers receive no new effective L2/L3 value.
- System grouping and cross-file lineage do not consume oversight. No GraphOS
  or L04 implementation was changed.

## Exact correction delta

Only these eight files belong to this correction; the other dirty files in the
worktree are the preserved producer baseline:

1. `apps/dashboard/app/api/discovery/scan/route.ts`
2. `packages/scanner/src/codeguard/classifier.ts`
3. `packages/scanner/src/codeguard/types.ts`
4. `packages/scanner/src/codeguard/oversight.ts` (new)
5. `apps/dashboard/tests/lx07-discovery-oversight.test.ts` (new)
6. `packages/scanner/test/discovery-oversight/codeguard-oversight.test.ts` (new)
7. `packages/scanner/tsconfig.discovery-oversight.json` (new)
8. This evidence document (new).

Exact patch, including new files and excluding the approved producer:
`.artifacts/agent/discovery-oversight-only.patch`. Regeneration and manifest:
`node .artifacts/agent/discovery-delivery.cjs`. The script also verifies that the
patch reverses cleanly against the delivered candidate without applying it.

The technical `ClassificationResult.oversightLevel` type now admits only
`UNKNOWN`; `DiscoveryResult.agentsDiscovered` requires the oversight envelope and
suggestion authority. Canonical contracts, identities, ID derivation, names,
repository IDs, branch handling, file locators and principal authorization are
unchanged. No identity is joined by name or promoted to a canonical object.

## Local checks and evidence

All executable checks passed; no test/typecheck failure or full regression loop.

| Check | Result | Local log |
|---|---|---|
| New codeguard tests: default, autonomy/critical, recognized/unverified levels, absent/invalid/runtime values, actual config/framework detection | 5/5 PASS | `279759b9-3234-4372-9bf4-aae913258f4b-0.log` |
| New route tests: real detector/classifier/enrichment; critical override; enrichment failure fallback; invalid suggestion; both JSON projections and new ledger payloads; identity/locators; spoofed body principal ignored; auth and ledger denial | 2/2 PASS (four route modes in first test) | `279759b9-3234-4372-9bf4-aae913258f4b-1.log` |
| Existing discovery inventory/principal/ledger-failure regression | 2/2 PASS | `b2341da3-2dc8-4897-a7ed-afe6b5790c5a-0.log` |
| Preserved approved producer regression | 19/19 PASS | `b2341da3-2dc8-4897-a7ed-afe6b5790c5a-1.log` |
| Scoped scanner + new test typecheck | PASS, exit 0 | External command recorded in handoff (3712 ms tool duration) |
| Final dashboard typecheck, including active route and new route tests | PASS | `ebf72a3a-9045-4c6a-b4f4-0839e6aa7f64-0.log` |

Commands, from the correction worktree:

```text
node scripts/agent/verify.mjs --profile focused --test packages/scanner/test/discovery-oversight/codeguard-oversight.test.ts --test apps/dashboard/tests/lx07-discovery-oversight.test.ts
node scripts/agent/verify.mjs --profile integration --test apps/dashboard/tests/pre-demo-discovery.test.ts --test packages/scanner/test/lx07/oversight-containment.test.ts
node ../../node_modules/typescript/bin/tsc --noEmit -p packages/scanner/tsconfig.discovery-oversight.json
node scripts/agent/verify.mjs --profile final --script .:typecheck:dashboard
git diff --check
```

Logs/session/checkpoints are under `.artifacts/agent/`. The evidence document and
ignored delivery artifacts were added after executable verification; source and
test bytes are unchanged. Prior-candidate runner fingerprints remain intact.
Packaging attempt 1 could not spawn Git inside the sandbox; the approved local
rerun reached the candidate-file guard and identified a tracked
`apps/dashboard/tsconfig.tsbuildinfo` regenerated by the successful dashboard
typecheck. Its generated bytes were saved as
`.artifacts/agent/dashboard-typecheck.tsbuildinfo`. The first restore was blocked
by sandbox access to Git's `index.lock`; a prematurely repeated packaging guard
therefore reported the same generated file again. The explicit escalated restore
then succeeded, restoring only that generated file to HEAD (clean at preflight).
No source/test correction or repeated regression was needed. Packaging is rerun
only after the successful restore; these operational attempts remain in handoff.
The test route uses synthetic provider files and mocked database, repo-intelligence,
graph, lineage and memory boundaries. It invokes the real detector, classifier and
enrichment functions, with controlled enrichment failure/priority overrides.
This is not a browser, hosted API, persistence replay or real-provider test.

## Limits, pending LX07 work and stop

- Historical oversight columns/defaults, old ledger payloads, dashboard/Talk/report
  consumption and alternate entry points outside this live route remain pending.
  Existing codeguard detector exports still produce framework suggestions; this
  route labels/normalizes them. No broader detector-consumer clearance is claimed.
- The historical ID collision remains untouched. No persisted data or migration
  changed; no new canonical fact, authorization path or oversight evidence was added.
- Existing legacy risk, AI Act, governance/compliance confidence and enrichment
  heuristics remain outside this oversight correction and gain no new authority.
- The approved core producer is unchanged. GraphOS/L04, BYOM, MiniLM, MPNet,
  Voyage and SR2-A4 were not reopened. No hosted access/mutation, credentials,
  push, merge, PR, deploy or production action occurred.
- Complete LX07 exposure acceptance remains pending. V1-S1B and M17.5 stay OPEN;
  readiness holds and M18 HOLD remain. This delivery does not conclude LX07.

**STOP after this delivery. Next action: Claude Code adversarial review of the
correction-only patch with the preserved producer as baseline.** No automatic
follow-up implementation is authorized by this handoff.
