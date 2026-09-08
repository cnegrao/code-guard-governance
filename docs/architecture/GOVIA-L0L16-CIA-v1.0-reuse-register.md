# Gov IA CIA Reuse Register — v1

**Architecture ID:** `GOVIA-L0L16-CIA-v1.0` (FROZEN BASELINE — unchanged by this audit)
**Audited main SHA:** `732a3379a53482ee7cb9f483e5ad8f35bab26f9c`
**Audit date:** 2026-09-08

Companion to
[`GOVIA-L0L16-CIA-v1.0-implementation-conformance.md`](./GOVIA-L0L16-CIA-v1.0-implementation-conformance.md).
This register exists specifically to prevent duplicate future work. Reuse decisions are
file/capability-specific; **no whole-branch merge is ever recommended.** Historical branches are
read-only references, not deployable units.

Reuse decision vocabulary: `REUSE_AS_IS`, `REUSE_WITH_ADAPTER`, `PARTIAL_REUSE`, `SUPERSEDED`,
`MUST_BUILD`.

---

## 1. Do-not-rebuild register

| Capability | Reuse decision | Notes |
|---|---|---|
| Six Golden Repositories | `REUSE_AS_IS` | `packages/scanner/test/discovery-validation-lab/golden-repositories/{01..06}` — complete, independently-authored `expected.json` oracles, passing tests |
| `expected.json` oracle contract | `REUSE_AS_IS` | `contracts/expected.ts` — versioned schema, structurally validated independent of scanner |
| Path isolation | `REUSE_AS_IS` | `packages/scanner/src/discovery/path-policy.ts` (production code, shared by Lab and production pipeline alike) |
| Repository snapshot | `REUSE_AS_IS` | `harness/repository-snapshot.ts` — deterministic, traversal-safe |
| Deterministic normalization | `REUSE_AS_IS` | `harness/normalize.ts` |
| Exact matching (directional relationships, explicit aliases) | `REUSE_AS_IS` | `harness/match.ts` |
| TP/FP/FN, precision/recall/F1 | `REUSE_AS_IS` | `harness/metrics.ts` — explicit zero-denominator guard already correct |
| Negative-scenario handling | `REUSE_AS_IS` | `05-false-positives` golden repo + `ProhibitedExpectation` contract |
| Evidence validation infrastructure | `REUSE_AS_IS` | `contracts/detected.ts` `EvidenceRequirement`/location kinds |
| Report generator | `REUSE_AS_IS` | `harness/report.ts` — canonically key-sorted JSON |
| Discovery SourceAdapter / `LocalRepositoryAdapter` | `REUSE_AS_IS` | `packages/scanner/src/discovery/*` |
| Discovery pipeline (`DiscoveryPipeline`) | `REUSE_AS_IS` — needs a production trigger, not a rebuild | Fully built; zero callers under `apps/dashboard/app/**` today (dead code from a running-system perspective, not a code-quality problem) |
| Model detector | `REUSE_AS_IS` | `discovery/strategies/model-reference-declaration.ts` — full continuity to materialization |
| Tool detector | `REUSE_AS_IS` | `discovery/strategies/tool-list-declaration.ts` — full continuity to materialization |
| Relationship correlation | `REUSE_WITH_ADAPTER` | `relationship-correlation.ts` — correct evidence-backed correlation logic; needs its source-endpoint kind changed from AGENT to AGENT_VERSION once that identity exists (Gap G-02) |
| Object candidate normalization | `REUSE_WITH_ADAPTER` | `object-candidate-normalization.ts` — MODEL/TOOL strategies reusable as-is; the *pattern* is the template for AGENT_VERSION; AGENT strategy needs real logic in place of its current unconditional fail-closed stub |
| Finding persistence | `REUSE_AS_IS` | `gov_repo.discovery_findings` (`discovery_governance_input_persistence_v1.sql`) |
| Candidate persistence | `REUSE_AS_IS` | `gov_repo.discovery_candidates`, same migration |
| Review lifecycle | `REUSE_AS_IS` | `packages/governance-review` + `gov_repo.review_subjects`/`review_audit_events`, transactional RPCs |
| Reconciliation | `REUSE_AS_IS` | `gov_repo.reconciliation_decisions` + `record_authorized_reconciliation` RPC — complete for all object/relationship kinds already |
| Materialization | `REUSE_AS_IS` | `gov_repo.canonical_objects`/`canonical_relationships` + `materialize_object_reconciliation`/`materialize_relationship_reconciliation` RPCs |
| Canonical lookup | `REUSE_AS_IS` | `canonical-object-lookup.ts` |
| Governance Workspace | `REUSE_AS_IS` | queue, review detail, evidence presentation, stale-write protection all real and tested |
| Graph route/provider | `REUSE_WITH_ADAPTER` | `ReactFlowGraph.tsx` + `getUnifiedGraph` pattern is sound and reusable; needs its data source extended to also project `gov_repo.canonical_objects`/`canonical_relationships` (Gap G-01), not rebuilt |
| Canonical Graph contracts | `REUSE_AS_IS` | `packages/canonical-contracts` closed 11-kind / 12-relationship taxonomy — exact match to frozen architecture |
| Outbox foundation | `REUSE_AS_IS` | Outbox event rows written atomically alongside every review-transition/reconciliation/materialization RPC (`governance_persistence_v1.sql`, `canonical_materialization_v1.sql`) — foundation exists; roadmap milestone 20 correctly notes it should wait for real consumers |
| pgvector infrastructure | `REUSE_AS_IS` (infra) / `MUST_BUILD` (canonical-object scope) | Extension, tenant-scoped table pattern, similarity RPC pattern all reusable; needs a canonical-object embedding contract layered on top (Gap G-05) |
| `coding_memory` writer pattern | `REUSE_AS_IS` (as a template) | `services/coding-memory.ts` embedding-generation + storage pattern is the concrete template for a future canonical-object embedding writer |

---

## 2. Full reuse register

| Capability | Current location | Current classification | Historical location if any | Reuse decision | Architectural compatibility | Notes |
|---|---|---|---|---|---|---|
| Canonical contracts (11 object kinds, 12 relationships, endpoint constraints) | `packages/canonical-contracts/src/contracts.ts` | `CURRENT_MAIN_FOUNDATIONAL` | Evolved through `feat/p1.0.3-canonical-v1a1` (superseded) and `audit/baseline-gov-ia` (superseded) → merged via `promote/canonical-contracts-v1a1` (PR #5) | `REUSE_AS_IS` | Exact match to frozen architecture §5 | See §3 for historical-branch detail |
| Discovery Validation Lab harness | `packages/scanner/test/discovery-validation-lab/harness/*` | `CURRENT_MAIN_IMPLEMENTED` | `feat/p1.0.2-discovery-validation-lab` (superseded, stale base) → merged via `promote/discovery-validation-lab` (PR #6) | `REUSE_AS_IS` | Fully compatible | 51/51 tests passing, verified live |
| Golden Repositories (6) | `packages/scanner/test/discovery-validation-lab/golden-repositories/**` | `CURRENT_MAIN_IMPLEMENTED` | Same as above | `REUSE_AS_IS` | Fully compatible | — |
| Discovery Engine V1 (`DiscoveryPipeline` + 3 strategies) | `packages/scanner/src/discovery/**` | `CURRENT_MAIN_PARTIAL` | `feat/discovery-engine-v1-runtime`, `feat/discovery-engine-v1-1-relationships` (both merged, ancestors of main) | `REUSE_AS_IS` / `REUSE_WITH_ADAPTER` for new kinds | Fully compatible; needs a production route trigger + more strategies | — |
| Legacy discovery path (`codeguard/agent-detector.ts` + `/api/discovery/scan`) | `packages/scanner/src/codeguard/**`, `apps/dashboard/app/api/discovery/scan/route.ts` | `LEGACY_NOT_AUTHORITATIVE` relative to the frozen architecture's governed pipeline | — | `PARTIAL_REUSE` | Bypasses `packages/governance-review` entirely; detection heuristics (framework/config parsing) are reusable as input signal, but the write path (`agents` table, `status: pending_registration`) should not be extended further | Currently the *only* live production discovery path — decommissioning it is out of scope for this audit, flagged for a future ADR-level decision |
| `packages/graphos` (`GraphEngine`) | `packages/graphos/src/**` | `LEGACY_NOT_AUTHORITATIVE` | — | `SUPERSEDED` (by `apps/dashboard`'s direct-Supabase-projection graph route) | Not wired into `apps/dashboard`; only reachable from the legacy `graphos-complete` prototype | Do not extend; the authoritative graph pattern is `apps/dashboard/services/knowledge-graph.ts` |
| `graphos-complete/` prototype app | `graphos-complete/**` | `HISTORICAL` (per `coverage.md` drift register item G, corroborated here) | — | `SUPERSEDED` | Not a workspace member; own `graphos_entities`/`graphos_relationships` tables would violate "Graph = projection" if it were live, but it is not imported anywhere | No action needed; do not resurrect its data model |
| Governance persistence (Review/Authorization/Reconciliation) | `supabase/migrations/20260905060000_governance_persistence_v1.sql`, `packages/governance-review/**` | `CURRENT_MAIN_IMPLEMENTED` | Closed milestones per `coverage.md` (Authorized Reconciliation Gate, Canonical Reconciliation Factory, Governance Persistence V1, HITL V1) | `REUSE_AS_IS` | Fully compatible | — |
| Canonical materialization | `supabase/migrations/20260906120000_canonical_materialization_v1.sql` | `CURRENT_MAIN_IMPLEMENTED` | Canonical Materialization V1 (closed milestone) | `REUSE_AS_IS` | Fully compatible | — |
| Discovery intake / governance input persistence | `supabase/migrations/20260906180000_discovery_intake_v1.sql`, `20260907120000_discovery_governance_input_persistence_v1.sql` | `CURRENT_MAIN_IMPLEMENTED` | Discovery Intake V1 (closed milestone) | `REUSE_AS_IS` | Fully compatible | — |
| Governance Workspace UI | `apps/dashboard/app/(dashboard)/governance/**`, `apps/dashboard/lib/governance/**` | `CURRENT_MAIN_IMPLEMENTED` | Governance Workspace V1, Reconciliation & Materialization Workspace V1 (closed milestones) | `REUSE_AS_IS` | Fully compatible | Coarse single-role authority noted as a gap, not a reuse blocker |
| Graph route (`/graph`, `getUnifiedGraph`) | `apps/dashboard/app/(dashboard)/graph/**`, `apps/dashboard/services/knowledge-graph.ts` | `CURRENT_MAIN_IMPLEMENTED` (as a read-model pattern); `CURRENT_MAIN_PARTIAL` (data-source scope, see Gap G-01) | Graph Route Release Fix V1 (`ebe371b`, closed milestone) | `REUSE_WITH_ADAPTER` | Conformant projection pattern; needs to also read `canonical_objects`/`canonical_relationships` | — |
| Agent-registry graph/vector/risk schema (`gov_repo.agents`, `agent_edges`, `agent_embeddings`, `agent_risk_propagation`) | `supabase/migrations/20260818004009..004146_agent_registry_graph_part_*.sql` | `CURRENT_MAIN_PARTIAL` | Pre-dates this architecture's canonical/governance pipeline | `PARTIAL_REUSE` | Compatible as a source of manually-registered governance data; not itself the canonical system of record | Feeds the Graph route today (Gap G-01 candidate consumer for canonical tables too) |
| pgvector / `coding_memory` RAG | `apps/dashboard/supabase-setup-8.2.sql`, `apps/dashboard/services/coding-memory.ts`, `services/talk.ts` | `CURRENT_MAIN_IMPLEMENTED` (as a chat-assistant feature) | — | `REUSE_WITH_ADAPTER` | Infra pattern reusable for L7; not itself L7 (different purpose — RAG chat context, not canonical-object embeddings) | `coding_memory` schema lives in a manually-run SQL script, not the ordered migrations pipeline — a process gap worth closing before extending |
| `TRACEABILITY_MATRIX.md` | repo root | `CURRENT / IMPLEMENTATION-SPECIFIC` (documentation) | — | `REUSE_AS_IS` (as unification input for Gap G-06) | Compatible with and complementary to L14/L15; not itself a persistence layer | — |
| Outbox event rows | `governance_persistence_v1.sql`, `canonical_materialization_v1.sql` (outbox tables) | `CURRENT_MAIN_FOUNDATIONAL` | Outbox foundation (referenced in coverage.md known facts) | `REUSE_AS_IS` | Compatible; roadmap milestone 20 correctly defers consumer-building until real consumers exist | — |

---

## 3. Historical Git reuse audit (read-only)

Method: `git branch -a`, `git branch --merged/--no-merged main`, `git log --all --oneline
--decorate`, `git diff <branch> <branch> --stat`, `git merge-base --is-ancestor`. No branch
content was checked out or modified. `8d72e46` was not inspected, referenced, or promoted, per
instruction — it remains **QUARANTINED**.

| Ref | Merge status | Classification | Notes |
|---|---|---|---|
| `promote/discovery-validation-lab` | Ancestor of `main` (confirmed via `git merge-base --is-ancestor`) | `ALREADY_IN_CURRENT_MAIN` | Merged via PR #6 (`8c9dd4d`) |
| `promote/canonical-contracts-v1a1` | Ancestor of `main` | `ALREADY_IN_CURRENT_MAIN` | Merged via PR #5 (`73177d0`'s predecessor merge) |
| `feat/p1.0.2-discovery-validation-lab` | NOT merged (`git branch --no-merged main`) | `SUPERSEDED` | Same work as `promote/discovery-validation-lab`, built on an older base (152-file/16,660-line diff vs. the promoted branch, entirely attributable to base drift — later migrations like `canonical_email_identity`, `atomic_signup_legacy_rpc` are simply missing from this older base, not additional unique content) |
| `feat/p1.0.3-canonical-v1a1` | NOT merged | `SUPERSEDED` | Same relationship to `promote/canonical-contracts-v1a1` as above |
| `audit/baseline-gov-ia` | NOT merged | `SUPERSEDED` | Earliest prototype of canonical contracts ("V1A canonical contracts", commit `6b621e1`); superseded by the fuller V1A.1 evolution (`ae8ae44`→`efb3f98`) now in `main` via `promote/canonical-contracts-v1a1` |
| `feat/authz-canonical-legacy-auth-boundary` | Merged (ancestor of main) | `ALREADY_IN_CURRENT_MAIN` | — |
| `feat/discovery-engine-v1-runtime` | Merged | `ALREADY_IN_CURRENT_MAIN` | PR #7 |
| `feat/discovery-engine-v1-1-relationships` | Merged | `ALREADY_IN_CURRENT_MAIN` | PR #8 |
| `feat/hitl-review-lifecycle-v1` | Merged | `ALREADY_IN_CURRENT_MAIN` | PR #10 |
| `fix/repository-line-ending-policy` | Merged | `ALREADY_IN_CURRENT_MAIN` | PR #4 |
| `8d72e46` (any ref/commit) | — | `QUARANTINED` | Not inspected, per instruction |
| `worktree-agent-a149f1ff03f2656d6`, `worktree-agent-a4d2aba3fa892be8c` | Both merged (ancestors of main); currently **active, locked worktrees** under `.claude/worktrees/` | `ALREADY_IN_CURRENT_MAIN` (their historical content); **not touched** — these are live sessions, not archaeology targets | Left entirely alone per the audit's own read-only/no-interference posture |
| `archive/p1.0.4-canonical-persistence-2026-09-03` (tag) | Ancestor of main (points at `91b3dae`, itself merged pre-`main` history) | `ALREADY_IN_CURRENT_MAIN` | Historical tag marker only |

**Conclusion: no unmerged branch contains any capability not already superseded by what is on
`main` today.** No cherry-pick or branch merge is recommended by this audit. The three unmerged
branches (`audit/baseline-gov-ia`, `feat/p1.0.2-*`, `feat/p1.0.3-*`) are safe to leave as
historical references or archive; none contains unique reusable work beyond what `promote/*`
already carried into `main`.

---

## 4. Explicitly do-not-rebuild summary

Per the audit's Do-Not-Rebuild directive (§24 of the audit prompt), the following are confirmed
sufficient as-is and must **not** be scheduled as new development work in any future milestone:

1. Six Golden Repositories + `expected.json` oracle contract
2. Discovery Validation Lab harness (path isolation, snapshot, normalize, match, metrics,
   report, and all associated test suites)
3. Discovery SourceAdapter / `LocalRepositoryAdapter` / `DiscoveryPipeline`
4. Model and Tool detection, normalization, and full materialization continuity
5. Relationship correlation logic (pending only a source-endpoint-kind change, not a rewrite)
6. Finding / Candidate / Review / Authorization / Reconciliation / Materialization persistence
   and RPCs, for all 11 object kinds and all 12 relationship types
7. Governance Workspace UI (queue, review detail, evidence presentation, stale-write protection)
8. Graph route projection pattern (`getUnifiedGraph`) and ReactFlow component
9. Canonical contracts package in its entirety
10. pgvector extension, tenant-scoped vector table pattern, and similarity-RPC pattern
11. Outbox foundation

The only genuinely new development work identified by this audit is enumerated in the True Gap
Register (`GOVIA-L0L16-CIA-v1.0-implementation-conformance.md` §20).
