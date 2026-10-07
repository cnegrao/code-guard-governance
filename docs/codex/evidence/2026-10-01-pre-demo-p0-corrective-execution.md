# GOV IA / MZC pre-demo P0 corrective execution

Date: 2026-10-01. Repository implementation evidence, not hosted acceptance.

## A. BASELINE

- Repository: `cnegrao/code-guard-governance`; origin `https://github.com/cnegrao/code-guard-governance.git`.
- Branch: `feat/m16-s1b-governed-registries`.
- Starting and final HEAD: `7170131a73293e8b3b89ec4f8765ac7c9ca65b66`.
- The interrupted execution was continued from its existing working tree. Status, diff statistics and source changes were inspected before further edits. No reset, checkout, revert, discard, commit or overwrite of unrelated work occurred.
- `apps/dashboard/tsconfig.tsbuildinfo` was already modified before corrective work. It remains a generated artifact, not implementation evidence or a proposed source change. Builds can update it; exclude it from the proposed commit.
- Changes remain local and uncommitted. No push, PR, merge, deployment, hosted SQL or hosted configuration change was performed. Test output is under ignored `out/`.

## B. P0 EXECUTION MATRIX

`CLOSED` below means the bounded repository corrective is implemented and locally tested. It does not mean the deployed application was accepted. P0-01 and P0-06 retain explicit external gates.

| P0 | Original defect and evidence | Implementation / principal files under apps/dashboard | Evidence | External dependency | Status |
| --- | --- | --- | --- | --- | --- |
| 01 | Anonymous `db.read` consumers discarded PostgREST errors; checked-in grants deny anonymous SELECT. Reports/legacy Graph findings lacked a valid tenant predicate. Several legacy selected columns do not exist in the canonical migration chain. | `lib/db.ts` server-only; existing server credential boundary plus verified-session organisation predicates in repositories and services. Reads throw on errors. Findings filter through their assessment. Removed unused unbound user lookup. Corrected schema aliases/incident fields. Local `supabase/config.toml` exposes gov_repo. | `pre-demo-reads`, `legacy-read-tenant-binding`, full-chain `pre-demo-read-schema`; dashboard tests/build. | Actual hosted schema exposure, row cap, deployed credentials, migration state, HTTP reads and tenant-negative controls. | READY_FOR_HOSTED_ACCEPTANCE |
| 02 | Empty agents/systems or no assessed controls could yield 100%; UI treated nonempty control-state strings as PASS; failed reads resembled empty data. | `repositories/{dashboard,reports,talk}.ts`, `services/{agents,systems,reports}.ts`, dashboard/search/detail pages and `CompliancePanel.tsx`: null scores, NO_DATA/NOT_ASSESSED, explicit control states, errors distinct from empty, indicative legacy labels, no universal compliance claims. | Empty/error/populated-score regressions, control panel SSR, Discovery HTTP-error presentation checks, dashboard suite. | Deployed visual smoke is still pending; no new implementation dependency. | CLOSED |
| 03 | Visible Graph read parallel legacy estate rather than governed canonical objects/relationships. | `/graph` now calls `getGovernedGraph` in existing `lib/governance/intelligence-query.ts`; existing tenant-bound reader and `projectCanonicalGraph` reused. New `components/graph/CanonicalGraph.tsx` and graph error boundary. Legacy API results explicitly OPERATIONAL_LEGACY/noncanonical. | `intelligence-query` 18 tests; GraphOS governed projection 50 tests; UI wiring check; build. | Hosted populated/empty/error visual smoke. | CLOSED |
| 04 | Discovery approval controls, registered count and event language implied governance authority. | Discovery page/API review/scan: operational inventory wording, NOT_ACTIVE governed ingestion, no approval UI, authenticated PUT returns 409 DISABLED without writes; discovered/stored/error counts distinguish outcomes; ledger payload identifies operational authority. HTTP failures hide stale inventory counts. | Actual scan handler with mocked provider/storage success and failure; no-write review test; UI assertions. | Live source-provider credentials if a repository scan is included in the later demo. This is not governed ingestion acceptance. | CLOSED |
| 05 | `/dashboard`, `/compliance`, `/settings` and incident links had no matching destinations. | `Sidebar.tsx`: root Dashboard, reachable canonical Passports, Governed Graph, inventory labels, longest matching active entry. Removed unsupported dashboard and search incident links. | SSR sidebar destinations checked against route files; Passport UI 15 tests; dashboard/build. | Browser walkthrough against the candidate deployment. | CLOSED |
| 06 | H1 lacked real hosted evidence; PG17 C locale failed literal case-insensitive É/é matching. | `repositories/audit.ts` escapes every literal character and explicitly alternates one-codepoint non-ASCII case pairs. Extended PG17 literals. New read-only `scripts/accept-hosted-pre-demo.ts` and simulated runner tests. | Full M16 PG17 suite 697 pass; final literal PG17 suite 34 pass, including queries É and é against lowercase é in event_description and uppercase É in event_type, plus foreign-tenant/negative controls; runner 3 simulated tests. | Real HTTP/PostgREST acceptance using independently known fixtures and authenticated tenant sessions; no such run performed here. | READY_FOR_HOSTED_ACCEPTANCE |
| 07 | Reports presented legacy heuristics as board/regulatory assurance; findings read lacked tenant isolation. | Reports page explicitly NOT_ASSESSED and links to Governance. Executive/AI Act/DORA export endpoints authenticate then return 409 NOT_ASSESSED. Findings join is tenant-bound. No compliance engine added. | Disabled-export/no-write tests, Reports SSR, read/schema tests, dashboard/build. | None to enforce the repository claim restriction; verify deployed direct URLs in hosted smoke. | CLOSED |

### P0-01 read inventory, grants and RLS

The following **12 actual direct-read tables** were checked against the disposable PG17 canonical migration chain: `agent_edges`, `agent_resource_links`, `agent_risk_propagation`, `agents`, `ai_systems`, `control_assessments`, `control_findings`, `governance_ledger`, `governance_users`, `ict_incidents`, `organisations`, `third_party_providers`. For every table the test proved: table exists, selected columns compile, `relrowsecurity = true`, service_role has SELECT, anon does not have SELECT.

| Consumers | Read sources / tenant binding |
| --- | --- |
| Agent/System repositories and owner validation | agents, ai_systems, governance_users; organisation plus entity ID; user owner also constrained to organisation |
| Dashboard | agents, ai_systems, control_assessments, control_findings, ict_incidents, agent_resource_links, agent_edges, agent_risk_propagation; organisation predicates, findings restricted to tenant assessment IDs |
| Reports and legacy unified Graph | agents, ai_systems, edges, incidents, providers, organisations, findings; findings inner join to control_assessments with organisation filter |
| Search/Talk | tenant agents, systems and incidents; tenant-bound agent semantic-search RPC where used |
| Discovery review / legacy graph node | tenant agents and edges; authenticated organisation, never caller-selected organisation |
| Audit | governance_ledger plus existing ledger_verify RPC; tenant-filtered reads, bounded pages/chunks |
| Governed Graph | canonical_objects + canonical_relationships through the existing privileged canonical reader and verified Passport session |

The base grant migration is `20260818013113_grant_service_role_gov_repo_access.sql`; subsequent canonical hardening remains intact. Existing RLS policies grant service-role access and authenticated organisation-scoped SELECT on the operational tables. `organisations` has its service-role policy; `governance_users` also has own-record and organisation policies; `control_findings` uses assessment ownership. Definitions are in `20260818003539`, `20260818003710`, `20260818003923`, `20260818004032`, `20260818004053`, `20260818004236` and `20260818004318`. No policy, grant or migration was changed by this corrective.

The application uses its existing verified-session/server boundary. Service credentials bypass RLS, so the explicit server-derived organisation predicates remain essential; this change does not claim RLS alone binds service requests. `server-only` prevents importing this client into browser bundles. There are no remaining product `db.read` consumers; the existing compatibility client definition remains.

Audit counters, event rows and event-type aggregates are tenant-filtered. The existing `ledger_verify(p_from_sequence, p_to_sequence)` checks the shared ledger chain; its boolean is not a new tenant-specific cryptographic proof. Its contract was preserved, and the hosted runner expects the shared chain to be valid.

Read RPCs remain existing functions: agent_compliance_gaps and agent_semantic_search (the latter also reads agent_embeddings). Their errors now propagate. Canonical readers and ledger routines retain the hardened existing architecture. The 12-table check is not presented as a complete catalog/RPC privilege audit; the broader M16 suites exercise the existing hardened boundary.

`coding_memory` and its optional legacy search RPC are **not supplied by the canonical migration chain**. Reads now fail explicitly rather than implying no matches; no legacy setup SQL was installed. Optional legacy RAG/indexing is excluded from the controlled demo and is not claimed ready. Graph and core product reads no longer rely on nonexistent `organisations.industry`, `ai_systems.owner_id`, provider `is_active`/`provider_name`, or incident `dora_criticality`. SQL aliases retain consumer shapes where valid. Incident reporting metrics now describe recorded reporting activity, not a fabricated major-incident classification. The Reports Promise result ordering bug was also corrected.

### Revalidation of interrupted work

The existing server-read migration, null semantics, Reports restrictions, canonical Graph wiring, navigation and Unicode fix were preserved. On resumption, two incomplete Discovery changes were found and completed: the storage catch now increments `inventoryErrors`, and non-2xx inventory reads produce ERROR and hide stale counts/lists. Regression coverage executes a storage failure. Both query literals (É and é) are tested against lowercase é in event_description and uppercase É in event_type. The fixture does not separately swap the stored case between those fields.

## C. ARCHITECTURE CONFORMANCE

Frozen authority: `GOVIA-L0L16-CIA-v1.0`, unchanged.

| Invariant | Conformance |
| --- | --- |
| SOURCE ASSERTION != CANONICAL FACT | Preserved; repository discovery remains explicitly operational. |
| SEMANTIC SIMILARITY != PHYSICAL IDENTITY | Preserved; no identity merge changes. |
| CAPABILITY != AUTHORIZATION | Preserved; existing verified principals and governed wrappers retained. |
| DESIGN-TIME DECLARATION != RUNTIME OBSERVATION | Preserved; no runtime promotion added. |
| DISCOVERY != GOVERNANCE AUTHORITY | Preserved; promotion UI/API disabled, automated governed ingestion NOT_ACTIVE. |
| SCANNER MACHINE AUTHORITY CEILING = PROPOSED | Preserved; no canonical machine-write path introduced. |
| HIGH CONFIDENCE != VALIDATED | Preserved; scanner confidence is inventory information only. |
| VECTOR SIMILARITY != CANONICAL MERGE | Preserved; no vector authority changes. |
| GRAPH PROJECTION != SYSTEM OF RECORD | Preserved; existing canonical projection reads PostgreSQL; UI states this explicitly. |
| LLM OUTPUT != CANONICAL TRUTH | Preserved; no new LLM authority or functionality. |
| UNKNOWN != FALSE | Preserved; no-data, not-assessed and error states do not yield PASS. |
| MISSING EVIDENCE MUST NEVER BE FABRICATED | Preserved; no fabricated product facts or hosted acceptance. Disposable test fixtures remain explicitly test evidence. |

PostgreSQL/Supabase remains canonical SoR; Graph and Vector remain derived/read state. No graph/vector database, canonical contract, governance workflow, SQL migration or frozen architecture was rewritten. Raw revoked governance RPC EXECUTE was not restored. Human Governance Review/Decision/Materialization remains the legitimate canonical route. The existing graph reader paginates with count/budget/tenant checks and rejects incomplete or foreign rows; the UI explicitly does not promise a transaction-wide snapshot.

## D. TEST EVIDENCE

Commands below are the execution entry points; output redirection to `out/pre-demo-*.log` was used. Dashboard commands run from `apps/dashboard` unless marked root. Counts overlap across focused and broad runs and must not be summed as unique coverage.

| Layer | Exact command | Result / local log |
| --- | --- | --- |
| Focused repository, unit and simulated HTTP | `node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/pre-demo-discovery.test.ts tests/pre-demo-reads.test.ts tests/pre-demo-hosted-runner.test.ts tests/intelligence-query.test.ts` | 28 pass, 0 fail. `out/pre-demo-resumed-focused.log` |
| UI SSR/source routing | `npm run test:pre-demo-ui` | 4 pass. `out/pre-demo-resumed-ui.log` |
| Dashboard unit/repository/simulated HTTP + UI | `npm test` | Server: 1,162 pass, 5 skipped, 0 fail (1,167 total). Passport SSR: 15 pass. Pre-demo UI: 4 pass. `out/pre-demo-dashboard-resumed-final.log` |
| Canonical contracts unit | Root: `npm test --workspace=packages/canonical-contracts` | 230 pass. `out/pre-demo-contracts.log` |
| Governance review unit | Root: `npm test --workspace=packages/governance-review` | 379 pass. `out/pre-demo-governance-review.log` |
| Governed Graph projection unit | Root: `npm run test:governed --workspace=packages/graphos` | 50 pass. `out/pre-demo-graphos.log` |
| M15 PG integration | `node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/postgres/cross-signal-persistence.test.ts` | 8 pass; disposable PostgreSQL 16.1, auxiliary evidence. `out/pre-demo-m15-pg.log` |
| M16 migration / real PG integration | Set `$env:M16_PG17_BIN='D:\code-guard-governance\out\m16-tools\pgsql\bin'`, then `node --conditions=react-server --experimental-test-module-mocks --import tsx --test --test-concurrency=2 tests/postgres-m16/*.test.ts` | 697 pass, 0 fail/skip; real disposable PG17.11. `out/pre-demo-m16-pg17.log` |
| New read/schema/ACL regression + focused mocks | With the same PG17 env: `node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/postgres-m16/pre-demo-read-schema.test.ts tests/pre-demo-reads.test.ts tests/pre-demo-hosted-runner.test.ts` | 10 pass (1 PG schema, 6 repository, 3 simulated runner). `out/pre-demo-final-focused.log` |
| Final Unicode/literal PG regression | With the same PG17 env: `node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/postgres-m16/audit-literal-search.test.ts` | 34 pass, 0 fail/skip. `out/pre-demo-unicode-final.log` |
| Dashboard typecheck | Root: `npm run typecheck:dashboard -- --incremental false` | PASS. `out/pre-demo-typecheck-resumed-corrected.log` |
| Package typechecks | Root: `npm run typecheck --workspace=packages/canonical-contracts`; `npm run typecheck --workspace=packages/governance-review`; `npm run typecheck --workspace=packages/graphos` | PASS. `out/pre-demo-typecheck-{contracts,review,graphos}.log` |
| Dashboard production build | Root: `npm run build --workspace=apps/dashboard` | PASS. `out/pre-demo-build-resumed-final.log` |
| Whitespace/scope | Root: `git diff --check`; final diff/status review | PASS; only bounded dashboard/read/config/test/documentation changes plus the pre-existing generated artifact. |
| Real PostgREST HTTP | Not executed | No real HTTP/PostgREST evidence. |
| Hosted H1 acceptance | Not executed | READY_FOR_HOSTED_ACCEPTANCE, not PASS. |
| Browser E2E | Not executed | SSR, route existence and build are not browser E2E. |

The full M16 run preceded addition of the schema test and the final strengthened Unicode fixture. Both additions were executed separately afterward. The final resumed dashboard run includes the Discovery fixes. No production PG code changed after the full M16 run.

Migration evidence has an explicit limitation: this Windows PG17 installation lacks pgvector. Existing full-chain fixtures use a disposable vector stand-in and permit the expected HNSW index statement failure. This validates the exercised SQL/schema/ACL/ledger/governance behavior, **not native pgvector or HNSW functionality**. No hosted parity claim follows from it. M15 PG16 is additional regression evidence, not a substitute for M16 PG17.

The five dashboard skips belong to opt-in auxiliary/hosted runtime coverage (including the parent hosted test group); they are not passes. Simulated PostgREST uses the installed client and captured HTTP, or the existing decoder plus real PG for literals. Neither is a running hosted PostgREST service.

The initial Unicode failure was real: PG17 under locale C did not case-fold é to É with `~*`, returning one match where two literal case matches were expected. The fix emits escaped `(É|é)` alternatives independently of that locale, while escaping punctuation and PostgREST grammar. Tests include literal metacharacters, negative controls and a foreign tenant. No regex input is enabled. No claim is made for Unicode normalization or multi-codepoint case folding; those remain outside this narrow fix. Hosted collation/transport behavior must still be exercised.

Other resolved execution issues: sandbox subprocess EPERM was rerun with approved escalation; the default PG17 location was absent and the existing portable PG17 path was used; schema tests exposed the nonexistent incident field and it was corrected. A `validate:repo` invocation without its required scanner arguments printed usage and is not validation evidence. An attempted dashboard `npm run typecheck` failed because that workspace has no such script; the correct root `typecheck:dashboard` command subsequently passed. Build emits the existing multiple-lockfile/workspace-root warning. These are not hidden as successful runs.

## E. HOSTED ACCEPTANCE CHECKLIST

This section is a subsequent operator procedure, **not authorization or evidence of execution in this session**. Keep H1 open until its real output is retained and independently reviewed.

1. Identify the candidate application URL and Supabase project; record code SHA and uncommitted candidate diff identifier if applicable. Confirm the deployed candidate contains these correctives. No deployment was performed here.
2. Through the approved operator process, verify the project migration history corresponds to the canonical chain through `20260930180000`; verify `gov_repo` is an exposed Data API schema and `max_rows >= 1000`. `supabase/config.toml` is only local configuration, not proof of hosted settings. Resolve differences in a separately authorized operation; do not grant anon SELECT or run ad hoc legacy SQL.
3. Verify server-only SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY configuration. Check that the service credential is absent from browser bundles and logs. Verify current hosted RLS/grants match the migration evidence. No secrets belong in fixtures or this report.
4. Prepare independently known, stable audit expectations for at least two real tenants, one with more than 1,000 events. Use existing legitimate data/workflows; do not direct-INSERT canonical demo facts. Obtain valid application session cookies for both tenants and inject them through named environment variables such as H1_COOKIE_A/H1_COOKIE_B. Pause fixture-changing activity during measurement.
5. Create a private JSON fixture with this shape (types below are explanatory, not a runnable fixture): `baseUrl: https application URL`, `tenants: [{ organisationId, cookieEnv, total, latestSequence, eventsByType: [{ event_type, count }], searches: [{ literal, sequences: descending expected entry_sequence array }] }]`. `eventsByType` is the independently expected top-ten aggregate returned by getIntegrity. Supply nonempty expected searches for `É`, `é`, `x*y`, `a.b`, `50%`, `a_b`, `C:\temp`, `alpha,beta(policy)` and `quote"value`. É and é must have identical expected sequences, with both uppercase and lowercase witnesses in the returned descriptions/types. Each literal fixture must fit a 1,000-row page. Include similar nonliteral and foreign-tenant witnesses so expectations detect broad matches/leaks.
6. From `apps/dashboard`, with environment variables securely injected, run:

   ```powershell
   node --conditions=react-server --import tsx scripts/accept-hosted-pre-demo.ts C:\private\h1-fixture.json
   ```

   If using an already configured private environment file, Node also accepts `--env-file=.env.local` before `--conditions`. The script performs read-only repository HTTP calls and application GETs; it does not seed or change configuration. Retain exit code and a sanitized output record. Only a successful actual run may produce `REAL_HTTP_H1_PASS` as hosted evidence.

7. The runner verifies exact audit totals, 1,000-row pages, ordering/uniqueness, tenant rows, integrity/hash result, latest sequence, event-type aggregates and literal expectations. It sends hostile foreign organisation input to application routes. Audit events/integrity responses are compared to the session tenant fixture. For dashboard, agents, systems and Discovery review it checks HTTP success only: **independently compare their returned data/counts/IDs against each tenant fixture as a separate acceptance step**. Also exercise Search and the canonical Graph/Passport pages with tenant-specific records. A 200 alone is not tenant-isolation proof.
8. Check unauthenticated requests return 401 and do not disclose data. Check Reports export and Discovery review PUT reject with 409 for authenticated sessions, do not mutate data, and do not present regulatory certification. Keep credentials and raw payloads out of public logs.
9. Browser walkthrough: Dashboard; Agents/Systems inventory; Repository Discovery; human Governance; canonical Passports; Governed Graph; Audit; Reports limitations. Verify normal populated state, empty NO_DATA, not-assessed controls and an induced read failure in an approved test environment. Check failed reads show ERROR, never reassuring zeros/PASS. Confirm sidebar destinations and canonical agent graph links.
10. Perform subsequent independent read-only review of code, migration alignment, tenant-negative evidence, Unicode results and commercial claims. Record reviewer/date/evidence. Full demo readiness requires both hosted acceptance and this review.

## F. DEMO STORY AFTER CORRECTIVES

After the external gates, the controlled journey can show operational inventory with explicitly indicative legacy metrics; repository source intelligence as inventory discovery; the separate existing human Governance Review/Decision/Materialization workflow; canonical Agent Passports; and a governed Graph projected from canonical objects/relationships. Audit demonstrates tenant-bound event reads and integrity with the qualified acceptance evidence. Reports explains the current regulatory claim limitation instead of offering unsupported assurance PDFs.

An empty governed Graph is honestly NO_DATA, even when legacy discovered agents exist. Source discovery does not automatically populate it. Show canonical data only when it already exists through the legitimate governed workflow. Do not use optional coding-memory readiness, native vector execution, live cloud connectors or automated governed ingestion as part of the controlled promise.

## G. COMMERCIAL CLAIM BOUNDARY

Allowed: existing human governed canonical lifecycle; PostgreSQL canonical persistence; canonical Graph read projection; repository discovery/source intelligence into operational inventory; explicit unknown/error states; audit capabilities within their evidenced layers. Internal lifecycle CERTIFIED is a governance state, not regulatory certification.

M15 wording: **Cross-Signal Reconciliation implemented, with temporal foundations for future Drift Intelligence.**

Forbidden: operational Drift Detection; automatic GitHub-to-governed-canonical ingestion; scanner confidence as validation; compliance inferred from empty data; AI Act/DORA compliance certification or board-ready regulatory assurance from current Reports; LLM canonical authority; native pgvector/hosted acceptance inferred from local fixtures; L5 completion inferred from AgentVersionTechnicalProfile. That profile is L4. **L5 AUTHORIZED PROFILING = NOT_IMPLEMENTED.** No M17/M18/M19 or connector completion claims.

## H. REMAINING P1 / P2 / P3

These are follow-up candidates, not work implemented or a reclassification of the remaining P0 gates.

- P0 external gates: hosted read/H1 acceptance and independent read-only review remain required before full demo readiness.
- P1: broaden legacy inventory pagination/completeness and performance work; evaluate optional coding-memory schema/availability through an approved migration strategy; improve browser automation beyond SSR; fuller operational read-failure UX where outside this controlled journey. Current legacy rollups remain indicative, not authoritative estate certification.
- P2: redesign/reintroduce regulatory reporting only with an explicit evidence/assessment contract; source-provider production validation and optional indexing lifecycle; future governed Discovery machine boundary only under its separately authorized milestone. Do not restore raw RPC privileges.
- P3: later registries, F2 temporal relationship evolution, Drift Intelligence, L5, expanded connectors and M17/M18/M19 remain roadmap work requiring separate authorization. They were not started here.

Recommended commit structure, **not executed**: one atomic commit `fix(demo): correct tenant reads, authority semantics and canonical graph` containing the bounded dashboard source, local Supabase config, tests, hosted runner and this evidence report. Keeping nullable contracts and consumers/tests together avoids intermediate broken revisions. Exclude `apps/dashboard/tsconfig.tsbuildinfo`, ignored `out/`, credentials and private hosted fixtures. Review the final explicit file list before staging; no commit has been made.

## I. S1B.3 STATUS

**NOT STARTED**

## J. FINAL VERDICT

**PRE-DEMO P0 IMPLEMENTATION: CLOSED_PENDING_HOSTED_ACCEPTANCE**

Repository corrections are implemented and locally validated. P0-01 and H1 are READY_FOR_HOSTED_ACCEPTANCE. Full demo readiness is not declared; actual hosted HTTP acceptance and subsequent independent read-only review remain outstanding.
