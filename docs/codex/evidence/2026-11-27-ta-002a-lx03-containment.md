# TA-002a — LX03 B1/B2 application containment

Date: 2026-11-27, America/Sao_Paulo. Branch: `ta-002a-lx03-containment`.
Pinned main/base: `09cf209333a39647919271b2c2e4fc9da47fd196` (fresh fetch).
Preflight: clean new worktree; 134 historical migrations; operational target 90 active minutes (informative). Active time unavailable.

## Inventory frozen before correction

Complete symbol/caller search over tracked application/package sources at the pinned base; findings B1/B2 are inherited, not reinvestigated.

| RPC / file and function | Caller chain and surface | User-visible value at baseline |
| --- | --- | --- |
| `agent_semantic_search`; `apps/dashboard/repositories/talk.ts:semanticSearch` | `services/talk.ts:ask` → `app/api/talk-to-governance/route.ts:POST` → `app/(dashboard)/governance/page.tsx:send` (`/governance`) | Conditional low-confidence LLM enrichment from legacy agent embeddings, including RPC snippets/similarity; partial agent reread already exists. |
| `coding_memory_search`; `apps/dashboard/repositories/coding-memory.ts:searchSimilar` | `services/coding-memory.ts:semanticSearch` → `services/talk.ts:ask` → same Talk route/screen | Repository/code chunk text appended to LLM context; errors/no provider/no results all collapse to empty string. |
| Same coding RPC / repository and service | `app/api/discovery/memory/route.ts:GET`, default `action=search&query=…` | API returns text and `empty`; no tracked UI calls this endpoint. |
| Adjacent possible bypass: `repositories/coding-memory.ts:getRepositoryMemory` | `services/coding-memory.ts:getRepositoryMemory` → same GET `action=repo&repository_id=…` | Raw legacy chunk list with heuristic-risk sanitation, without SR2 source admission. Must not become the search fallback. |

There are exactly two application RPC call sites and three transitive RPC paths. Search (`/search` → `/api/search` → search service/repository), graph/estate and dashboard have no callers of these RPCs. No additional package callers were found. Tests, frozen catalog fixtures, historical migrations and noncanonical `apps/dashboard/supabase-setup-8.2.sql` reference the identities but are not application callers. Setup SQL will not run or change. Index/store/delete coding-memory paths are separate and unchanged; no new provider/population work is authorized.

## Decision and ceiling

Carlos explicitly authorized DEC-TA-002-ROUTE: TA-002a is containment, not SR2 cutover or parity. This supersedes only the no-disconnection sequencing restriction in SR2 §§12–14 for these unsafe application paths. SR2 remains the semantic parity route. TA-002b (multilingual model + hybrid search) is separate and not started. A4 remains BLOCKED; Talk parity not achieved. LX03/S1B/TA-002/M17.5 remain open, M18/readiness HOLD. No hosted access, database execution, migrations, grants, Voyage or deployment.

## Before/after and validation

The original eight adversarial cases ran before the correction (expected red). Log: `.artifacts/agent/8ec40caa-895e-4ace-8ce6-7cbf9d8f6bb9-0.log`. Forged principal PASS (401 before all data/provider calls); revoked principal PASS (unchanged persisted V2 gate denies before enrichment, 503). Cross-tenant source FAIL (foreign sentinel in the snippet context); unadmitted-source FAIL (legacy text in prompt); lexical-source failure/fallback FAIL (legacy calls still active); empty versus unavailable FAIL (no acquisition states); memory API FAIL (legacy result instead of unavailable); static regression guard FAIL (legacy call sites found). These expected failures are baseline evidence, not unresolved final failures or a hosted exploit claim.

After the correction the same eight cases passed (`.artifacts/agent/ef0352ca-a1e7-4f95-baa0-9aba7a3c677a-0.log`). The final integration selection additionally verifies the useful positive lexical result/citation, two-tenant same-name fixtures, query grammar metacharacters/limit/projection, all runtime source roots guarded against either RPC, and four UI acquisition states. Individual results follow; no score or averaged acceptance is used.

| # | Case | Result |
| --- | --- | --- |
| 1 | agent_graph_traverse: a root agent outside the verified organisation fails closed BEFORE the elevated traversal | PASS |
| 2 | agent_graph_traverse: same-organisation root runs through the service client only | PASS |
| 3 | quarantined ledger_verify uses service client; Agent detail no longer reads aggregate gap RPC | PASS |
| 4 | audit integrity reads hash_chain_valid from the ledger_verify row set and event types from the tenant ledger | PASS |
| 5 | audit integrity: an empty tenant yields no event types and a valid chain; a failed read rejects | PASS |
| 6 | static: no tracked consumer calls a service_role-only definer through the anon client | PASS |
| 7 | static: every route reaching these RPCs binds the organisation from the verified governance principal | PASS |
| 8 | Knowledge Graph / estate API projects every historical label, manual flag and nested payload without mutating storage | PASS |
| 9 | Knowledge Graph contains historical supervision relationships and failed manual control metadata | PASS |
| 10 | F1 recorded control states take precedence consistently in agent/system nodes, derived edges and Talk payloads | PASS |
| 11 | derived graph evidence text and Talk evidence responses cannot repeat a historical oversight claim as proof | PASS |
| 12 | Talk high-risk and autonomous answers, citations and supporting data never promote L1-L4 or governed flags | PASS |
| 13 | Talk routes supervision questions deterministically including mixed high-risk questions and Portuguese | PASS |
| 14 | Talk indirect Discovery payloads and compliance-gap flags do not expose nested historical supervision | PASS |
| 15 | Talk fallback context and supporting data preserve the exact recorded level and verified organisation | PASS |
| 16 | Talk semantic and coding-memory context cannot upgrade supervision; model claims are contained on output | PASS |
| 17 | model paraphrases and Portuguese supervision claims are bounded while unrelated model answers remain compatible | PASS |
| 18 | empty, denied and unauthenticated reads never manufacture positive supervision or query another tenant | PASS |
| 19 | new chunks carry no riskLevel / suggestedRiskLevel and no "Risk: ..." text | PASS |
| 20 | legacy chunks indexed before S1 never reach the LLM retrieval context as risk truth | PASS |
| 21 | the memory API route reads through the sanitizing service, never the raw repository | PASS |
| 22 | product reads use server credentials and tenant predicates, including findings parent join | PASS |
| 23 | empty dashboard inventory omits removed aggregates; quarantined report remains unknown | PASS |
| 24 | Discovery promotion and regulatory exports are blocked at API ingress without a database write | PASS |
| 25 | permission failures never become empty product populations or favourable reports | PASS |
| 26 | supporting memory reads reject unavailable legacy storage and Talk never infers universal compliance | PASS |
| 27 | all product consumers have left the anonymous database boundary; service client is server-only | PASS |
| 28 | all production dashboard sources prohibit caller identity headers and removed session helpers | PASS |
| 29 | identity header guard catches all prohibited names but preserves client/signature metadata | PASS |
| 30 | every existing privileged route authenticates via a verified principal; only GET/read paths may additionally resolve a role, and never a write handler | PASS |
| 31 | forged principal: invalid signature denies before reads, RPC or embedding | PASS |
| 32 | revoked principal: persisted gate denies before enrichment, RPC fallback or embedding | PASS |
| 33 | cross tenant: request principal overrides and foreign embedding/source cannot enter context | PASS |
| 34 | unadmitted source: legacy snippets/code never enter prompt; unavailable is explicit | PASS |
| 35 | failure: denied lexical source is unavailable, without legacy/provider fallback or false no-match | PASS |
| 36 | valid empty lexical selection differs from unavailable coding memory | PASS |
| 37 | lexical filter metacharacters never become caller-supplied PostgREST expressions | PASS |
| 38 | memory API search and adjacent repo path cannot bypass admission or disguise unavailability as empty | PASS |
| 39 | static: application code cannot name either legacy RPC or fetch vectors as fallback | PASS |
| 40 | Talk uses lexical context without embeddings; existing trimming, confidence and citations remain | PASS |
| 41 | Talk empty OpenAI answer uses the existing fallback without exposing the empty provider result | PASS |
| 42 | confident intent-router answer makes no OpenAI call or runtime observation | PASS |
| 43 | Talk provider transport failure keeps the existing fallback and safe error observations | PASS |
| 44 | Talk never swallows a failed retained response capture on router, fallback or LLM paths | PASS |
| 45 | concurrent Talk invocations keep tenant, source, producer and trace mapping isolated under overlapping persistence | PASS |
| 46 | Talk renders the returned acquisition notice separately from model text on every response path | PASS |

The existing LX07 test titles containing “semantic” now exercise the lexical replacement and denial of the legacy coding context. The retained memory-sanitation test continues to cover the dormant direct repository reader; the API now returns the fixed unavailable state, tested separately. The static prohibition covers dashboard runtime directories, discovery-worker and all four package source roots; frozen SQL/catalog test fixtures are outside runtime code.

## Implemented boundaries

- Talk ingress still verifies the actual session cookie; request tenant/actor hints cannot set principal identity. Its existing awaited `ledger_append_v2` query event validates the persisted five-field session basis before any Talk source or LLM operation; a failed guard aborts the request. The immutable V2 writer/SQL is unchanged. The local revoked-principal test simulates the existing persisted-eligibility transport, not database execution or concurrent revocation proof.
- The old agent RPC and coding RPC adapters and service enrichment are removed. No query embedding is generated by Talk. Useful enrichment is bounded lexical matching over `gov_repo.agents`, with an explicit tenant predicate on the agent itself, excluding decommissioned rows. Up to eight alphanumeric tokens over 512 query characters, five rows, deterministic agent-ID order, and only ID/code/name/type/status are selected. No embedding, agent→owner or agent→system join remains in this replacement, so there is no unbound joined alias. No legacy snippet, arbitrary description, owner PII or raw code is hydrated.
- These are admitted direct operational records (ADR §6, DIRECT_OPERATIONAL_CONTEXT), labelled LEGACY_NON_AUTHORITATIVE and a current direct observation, never SR2 representations, historical source identity or governance truth. New lexical context is JSON-quoted untrusted data. This slice does not implement A5's complete malicious-model/authority composer gate.
- Coding-memory retrieval has no admitted replacement. Talk exposes `retrieval.codingMemory={status:unavailable,knowledge:UNKNOWN,reason:SOURCE_NOT_ADMITTED}` on router/LLM/fallback answers. Both search and repo modes of `/api/discovery/memory` return that fixed state, never an empty list/string that implies no match. The old repo-mode chunk path is disabled at public ingress; its dormant sanitation helper and unrelated indexing/storage routines remain unchanged.
- Lexical acquisition distinguishes available, no_matches, unavailable and not_requested. Read failure is unavailable with no exception payload, legacy RPC, vector store or other provider/space retry. The Talk page renders a product-owned notice outside model prose, explicitly saying code context was not searched and semantic parity is unavailable.

## Commands, environment and attempts

Preflight recovered once from sandbox `spawnSync git EPERM` by an approved escalated local invocation; no session reset or dependency installation. Existing dependencies resolve from the shared workspace. Verification sequence: baseline expected-red focused attempt; corrected focused attempt; candidate-ready integration (typecheck, UI, affected tests); one production build. No full regression or review-of-review loop.

- `node scripts/agent/verify.mjs --profile integration --script .:typecheck:dashboard --test "apps/dashboard/tests/{ta-002a-lx03-containment,lx07-remaining-consumers,m17-s1-coding-memory,pre-demo-reads,legacy-read-tenant-binding,talk-runtime-producer,session-authority-boundary}.test.ts" --script apps/dashboard:test:ta-002a-ui`: PASS. Typecheck log `.artifacts/agent/a0253895-daa2-4a99-a4f4-52967a829c19-0.log`; UI log `.artifacts/agent/a0253895-daa2-4a99-a4f4-52967a829c19-1.log`; per-case integration log `.artifacts/agent/a0253895-daa2-4a99-a4f4-52967a829c19-2.log`.
- Production build via `node .artifacts/agent/ta-002a-build.cjs` (same Next CLI as `npm run build --workspace apps/dashboard`): PASS, 56,716 ms, 45 generated pages. Log `.artifacts/agent/ta-002a-build.log`; result JSON adjacent. Supabase URL points only to loopback with synthetic keys, JWT fixture secret, LLM_PROVIDER=none, telemetry disabled. No database/provider request was executed. Existing multiple-lockfile/workspace-root warning remains; build succeeded without configuration changes.
- Browser verification: NOT_EVIDENCED. CUA inventory returned `The browser access host is unavailable`, with no enabled browsers. No local server, browser session, screenshot or UI E2E success is claimed. Automated real-page rendering above passes all four acquisition states. Visual verification remains a review limitation, not hosted verification or an expanded closure claim.
- No PG17/SQL, Supabase CLI/MCP, database write, grant, hosted, Voyage, population, deployment, M18 or Hub test ran. Existing ledger behavior was exercised only against controlled in-memory HTTP responses.
- Recorded runner command time: focused 4,542 ms (includes expected red), integration 26,472 ms; external build 56,716 ms. Active working time is unavailable; these are command durations, not an active-time estimate. Logs and checkpoints remain ignored local artifacts. Generated tracked TypeScript cache is restored to the clean-worktree baseline before publication.

Final scope/document checks and publication identifiers are recorded in the final local handoff and PR; passing code/build checks are reused because only documentary evidence changes afterwards. No merge authorized.
