# AgentVersion behavior relationships — L9 V1 validation

## Base and pre-implementation architecture mapping

Base main: `738b9aa48a70845a88c42b0ca4fc0f57f6a00a7b`; fetched origin/main equals local main. Required L8 HEAD `190073ecd8bd0326cb617e83358d61f4eda65c07` is an ancestor (exit 0). Branch: `feat/agentversion-behavior-relationships-l9-v1`. Architecture: `GOVIA-L0L16-CIA-v1.0`, frozen and unchanged. Milestone: 6, AGENTVERSION BEHAVIOR RELATIONSHIPS — L9.

Before implementation: A, baseline compatibility requires AGENT_VERSION behavior sources. B, L9 consumes existing L0–L4 evidence; L6–L8 and L10–L16 unchanged. C, Passport families 6, 8, 11 and 14 gain proposed binding evidence only. D/E, exact version candidate references preserve temporal lineage; no canonical writes. F, declaration containment must establish binding, retaining endpoint assertion/evidence IDs and snapshots. G, UNREVIEWED/requiresReview/requiresReconciliation; machine ceiling PROPOSED. H/J, no Vector/LLM consumer. I, Graph unchanged. K, trusted server organisation and connection scope gate correlation and organisation participates in identity. L, no migration. M, existing normalized candidate intake/review remains downstream; milestone 7 stays separate. N, absent/ambiguous binding fails closed. O, focused positive/negative source, endpoint, evidence, temporal, tenant, authority and discovery regression tests.

## Contract-first reuse map

| Surface | Decision | Reason |
|---|---|---|
| canonical-contracts closed taxonomy, endpoint constraints, PreCanonicalObjectReference, NormalizedRelationshipCandidate | REUSE_AS_IS | Seven exact behavior pairs already modeled; CANDIDATE references distinguish versions |
| Object candidate normalization and all seven target detectors | REUSE_AS_IS | Existing declared identities; no rediscovery or new canonical kind |
| AGENT and AGENT_VERSION generation | REUSE_AS_IS | Existing source-scoped technical revision, including controlled Prompt content fingerprint |
| evidence-assembly | ADAPT | Attach restricted declaration-containment proof to existing MODEL/TOOL evidence; object identity and detection unchanged |
| relationship-correlation | ADAPT | Replace AGENT/file copresence with exact version and direct declaration proof; reuse finding/normalized candidate pipeline |
| Dashboard discovery-intake composition | ADAPT | Supply existing version results and trusted organisation/connection to correlation |
| Candidate persistence, relationship reconciliation and materialization | REUSE_AS_IS | Existing Decision-to-Truth infrastructure; no new persistence/domain workflow |
| unified.ts logical-Agent USES_MODEL emission | LEGACY_DO_NOT_EXTEND | No version evidence; disable generation, preserve unrelated legacy relationships |
| MCP/API/Prompt/KB/Skill direct version binding signal | NOT_PRESENT | Object discovery is not binding evidence |

## Seven-type readiness matrix (before implementation)

All rows: A, AGENT_VERSION discovery exists, with exactly one normalizable Agent per artifact and technical evidence. C, source assertion/evidence union and source-scoped technical revision exist. F, source/target normalized contracts exist. None of the seven is authoritatively IMPLEMENTED at base.

| Type / target | B/D: target discovery and evidence | E: deterministic binding signal | G: normalized relationship feasibility | H: base production status / readiness |
|---|---|---|---|---|
| USES_MODEL / MODEL | model-reference-declaration literal + evidence | Direct property inside same named Agent declaration; containment must be added | IMPLEMENTABLE using existing version and normalized MODEL | Legacy AGENT copresence; IMPLEMENTABLE for restricted direct declarations |
| USES_TOOL / TOOL | tool-list-declaration bare identifiers + evidence | Direct tools property inside same named Agent declaration; containment must be added | IMPLEMENTABLE using existing version and normalized TOOL | Legacy AGENT copresence; IMPLEMENTABLE for restricted direct declarations |
| USES_MCP / MCP_SERVER | Named server in MCP configuration, not import | No AgentVersion-to-server binding signal | FOUNDATION_ONLY | BLOCKED_CORRELATION |
| INVOKES / API | Explicit API declaration/config identity | No governed API invocation binding signal | FOUNDATION_ONLY | BLOCKED_CORRELATION |
| USES_PROMPT / PROMPT | Protected named *_PROMPT declarationKey | No instructions-reference binding detector | FOUNDATION_ONLY | BLOCKED_CORRELATION |
| USES_KNOWLEDGE_BASE / KNOWLEDGE_BASE | Explicit KB configuration sourceReference | No cross-artifact AgentVersion-to-KB binding signal | FOUNDATION_ONLY | BLOCKED_CORRELATION |
| USES_SKILL / SKILL | Existing convention-based declarationReference detector | No explicit AgentVersion skill usage signal | FOUNDATION_ONLY | BLOCKED_CORRELATION |

The Skill detector source was inspected; no `.claude/**` directory or file was inspected. Historical evidence and migrations are not rewritten. Prior evidence documents are historical context, not authority to preserve AGENT-sourced behavior.

## Implementation record

1. **Base/branch/architecture/milestone:** recorded above. Initial status contained only the permitted recovery file. No frozen architecture document changed.
2. **Reuse map:** above; existing relationship finding/NormalizedRelationshipCandidate envelope and object normalization remain the sole candidate path. No parallel candidate model, new canonical kind, endpoint contract or persistence layer.
3. **Final readiness:** the source/target discovery and evidence columns above remain unchanged. USES_MODEL and USES_TOOL are **IMPLEMENTED** in production code for the restricted direct-declaration subset (overall coverage **PARTIAL**). USES_MCP, INVOKES, USES_PROMPT, USES_KNOWLEDGE_BASE and USES_SKILL remain **BLOCKED_CORRELATION**, with normalized contract **FOUNDATION_ONLY**. No family is BLOCKED_TARGET_DISCOVERY: all seven target detectors already exist. No 7/7 implementation claim.
4. **Legacy audit:** `relationship-correlation.ts` contained two public strategies (correlateAgentUsesModelRelationships and correlateAgentUsesToolRelationships), one shared AGENT builder, and the composed RelationshipCorrelationStrategy. They emitted AGENT-source behavior from same-file copresence. Both strategies now consume exact version context and direct declaration proof; compatibility export names remain, but missing context returns no results. `unified.ts` additionally emitted logical-Agent USES_MODEL using provider substring matching, with no version evidence. That generation was removed (**FAIL_CLOSED**, **LEGACY_DO_NOT_EXTEND**); model objects, unrelated relationships and historical records remain. Production searches in scanner and dashboard intake/API code found no other active generator of these seven types from AGENT.
5. **Source rule:** only CANDIDATE references with explicit AGENT_VERSION kind. Caller supplies already-produced AgentVersion results; the same existing correlateAgentVersions implementation validates the exact candidate ID against current evidence and technical signals. Wrong kind, absent version, stale version or missing source support yields no relationship. No mutable current-Agent lookup.
6. **Closed endpoint rules:** USES_MODEL → MODEL; USES_TOOL → TOOL; USES_MCP → MCP_SERVER; INVOKES → API; USES_PROMPT → PROMPT; USES_KNOWLEDGE_BASE → KNOWLEDGE_BASE; USES_SKILL → SKILL. The first two are the only emitted subset. Normalization and detector-method checks must agree on target kind. Unsupported targets never reach the relationship builder. EXPOSES/HANDOFF_TO/READS_FROM/WRITES_TO/DERIVED_FROM are not implemented or altered.
7. **Binding evidence:** `behavior-declaration-binding.ts` proves that an existing Model/Tool detector match is a direct property within a flat, top-level named Python class or JS/TS const object containing one Agent marker. It attaches scanner-only declaration key and marker location to the existing target candidate. Correlation requires the actual Agent marker location, matching normalized Agent declaration key, same source object, same snapshot ID/content hash, nonempty assertion/evidence support and repository location. Target declaration evidence supplies the binding; Agent evidence supplies ownership. Both endpoint provenance sets remain in the relationship finding/candidate. The metadata contains no content and is not a new normalized candidate or canonical assertion. Missing location, snapshot, support or containment fails closed. Copresence, imports, unrelated declarations, nested scopes and ambiguous declarations do not prove binding.
8. **Temporal semantics:** version identity reuses the existing source-scoped technical revision, including protected Prompt content changes. Same target across V1/V2 gives separate version endpoints and relationship IDs. Replaying V1 does not mutate V2 or vice versa. A stale version cannot borrow target evidence IDs that replay across snapshots. No historical reconciliation/state update is performed.
9. **USES_MODEL:** **IMPLEMENTED**, restricted direct MODEL_REFERENCE/modelReference property with the existing model-reference-declaration detector and Model normalization. Generic SDK import, dependency, documentation and module-level copresence are insufficient.
10. **USES_TOOL:** **IMPLEMENTED**, restricted direct tools bare-identifier list with the existing tool-list-declaration detector and Tool normalization. Multiple explicit tools are supported. Unrelated function/tool declarations and ambiguous arrays do not bind.
11. **USES_MCP:** **BLOCKED_CORRELATION**. Existing named MCP config targets normalize; no direct AgentVersion-to-server binding detector is added. Imports never fabricate servers or edges.
12. **INVOKES:** **BLOCKED_CORRELATION**. Explicit API object IDs already normalize; generic library/HTTP client calls are not API identities or invocation evidence.
13. **USES_PROMPT:** **BLOCKED_CORRELATION**. Existing protected *_PROMPT declarationKey remains object identity. No new instructions-reference detector is added. Tests prove identical Prompt normalized identity under changed plaintext, changed AgentVersion technical revision, and no plaintext in relationship identity/output or Prompt evidence excerpts. Relationship identity never directly hashes Prompt plaintext.
14. **USES_KNOWLEDGE_BASE:** **BLOCKED_CORRELATION**. Existing dedicated YAML identity normalizes; cross-artifact KB usage correlation is absent. Vector/Redis/Postgres/SQLite imports are not KB bindings.
15. **USES_SKILL:** **BLOCKED_CORRELATION**. Existing convention-based Skill discovery and normalization are preserved; no function/tool/prompt/module is promoted to Skill. The negative relationship test uses an in-memory synthetic locator, not a filesystem read under `.claude`.
16. **Relationship identity:** `sha256(JSON.stringify(['agent-version-behavior-v1', organisationId, relationshipTypeCode, sourceVersionCandidateId, targetKind, targetCandidateId]))[0:32]`, prefixed separately for finding/candidate IDs. No time, random UUID, evidence ID, display name, raw source text or Prompt plaintext input. Exact normalized pre-canonical endpoint identities carry source scope. Replay is deterministic and output is sorted/deduplicated. This preserves existing target candidate identity granularity; it does not introduce cross-source canonical equality.
17. **Normalization:** source is the existing normalized version candidate; target comes from normalizeObjectCandidate; relationship uses the existing RelationshipCorrelationResult and NormalizedRelationshipCandidate contract, then the unchanged candidate persistence adapter. CANDIDATE references disambiguate multiple versions/targets sharing one source artifact. The intake checks both endpoint candidates through the existing tenant-scoped getNormalizedCandidateForFinding port before relationship persistence. A missing durable endpoint produces `L9_ENDPOINT_CANDIDATE_NOT_DURABLE`, never a replacement identity.
18. **Tenancy:** trusted executionContext.organisationId and acquisition connection enter correlation; a mixed-connection batch is rejected and organisation participates in relationship identity. Base canonical discovery contracts have no per-object organisation field; these are trusted single-tenant scan inputs, not an authentication interface for arbitrary client candidates. Durable endpoint reads and all writes are organisation-scoped. Integration tests prove a foreign organisation cannot read the endpoints/relationship records and the same repository scanned for another organisation receives distinct relationship identities.
19. **Trust/authority:** UNREVIEWED, requiresReview=true, createsCanonicalObject=false, requiresReconciliation=true. Existing intake advances only to PROPOSED. Source assertions retain their detector trust/confidence. No automatic confirmation, certification, authorization, reconciliation or canonical relationship materialization; tests use throwing forbidden ports.
20. **L8 boundary:** no semantic/similarity/PossibleMatch imports, score use or creation integration. Analytical similarity never supplies binding evidence. L8 files unchanged.
21. **Decision-to-Truth:** existing persistence/review/reconciliation/materialization is reused, not rebuilt. The new check is only for durable pre-canonical candidate availability. Full governed endpoint resolution, CREATE_NEW/MATCH_EXISTING completion and canonical temporal workflow remain milestone 7, **NOT_IMPLEMENTED by this milestone**. No new decision or materialization API is invoked.
22. **Graph:** GraphOS packages, graph routes and authority model unchanged. No graph feature/write added. The scanner's legacy unified output stops fabricating AGENT-source model edges as required by the legacy audit; this is suppression of non-authoritative generation, not a graph feature.

## Validation

- `npm run test:discovery-engine` in packages/scanner: **169/169 passed**, including **38 L9 cases** and 131 existing Agent/AgentVersion/Model/Tool/L4/discovery regressions. Intermediate result before the review correction: 167/167.
- `npm run typecheck:discovery-engine` and `npm run typecheck` in packages/scanner: **PASS** after the review correction.
- `node --conditions=react-server --experimental-test-module-mocks --import tsx --test --test-isolation=none tests/discovery-intake-service.test.ts` in apps/dashboard: **32/32 passed**, including four new L9 integration cases and migrated negative expectations for the old unidentified-Agent fixture. All external ports are fakes.
- `npm run typecheck:dashboard`: **PASS**. Its generated tracked tsbuildinfo was restored to the original bytes; no build cache is included.
- Initial test attempts hit Windows esbuild `spawn EPERM`; authorized execution outside the sandbox passed. These were local tests only.
- No canonical-contracts or governance-review source contract changed; those suites were not run. No Validation Lab contracts/oracles/golden files changed; Validation Lab was not run. No live Supabase, runtime/provider API, production, migration or deployment operation.
- Final whitespace and file-scope gate: `git diff --check` **PASS**; changed-file inventory matches the eight listed files. Final diff inspection precedes the one feature commit.

### Requested test-matrix coverage

| Cases | Evidence |
|---|---|
| 1–8 | MODEL/TOOL exact version endpoints; five blocked-family negative cases; compatibility entry points fail closed without context; production generator search |
| 9–12 | Wrong source/target kinds, absent source/target/version, unnormalizable target; three intake cases reject missing durable version/model/tool |
| 13–16 | Direct class/object binding positive; module/other-declaration/nested/import negatives; preserved IDs, missing support/location/snapshot negatives |
| 17–19 | V1/V2 same-model distinct identities; changed model; immutable replay; time/order/duplicate-version replay; stale-version rejection |
| 20–23 | Direct model property and tools list positives; SDK import, unrelated function and other-declaration negatives |
| 24–26 | Protected Prompt declaration identity unchanged by plaintext edit; version changes; no plaintext in relationship/evidence output; USES_PROMPT remains blocked |
| 27–30 | MCP/API/KB/Skill real existing target discovery plus explicit no-relationship assertions |
| 31–32 | Mixed connection refusal; organisation-specific identity; tenant-scoped durable lookup/read denial in intake integration |
| 33–36 | Exact review/reconciliation flags; PROPOSED integration assertions and throwing forbidden governance/materialization ports |
| 37–38 | No semantic/L8/Graph imports or write calls; production search and final scope gate |
| 39–43 | Existing Discovery Engine regression suite; unrelated legacy relationship literals retained; no change to nonbehavior canonical taxonomy/history |

## One focused adversarial review

One manual pass, no subagents and no second broad loop. A–L checked: AGENT source generation; copresence; weak imports; version collapse/stale versions; Prompt plaintext; tenant mixing; L8 authority leak; fabricated unsupported families; normalization bypass; automatic governance; milestone 7 scope; Graph authority.

Concrete provenance defect corrected: the supplied AgentVersion could retain a valid ID while its own support arrays were stripped, because validation rebuilt expected support from the scan. Correlation now requires the supplied source finding/candidate to retain every expected assertion/evidence ID. Also closed the equivalent target evidence gap where IDs/hashes remained but repository locations were absent. Added two focused cases (one parameterized for source support); final Discovery and intake reruns passed. Existing source-method checks were tightened to the supported Agent detector. No architecture expansion or second audit was performed.

## Limitations and production status

- **PARTIAL:** only two relationship families are implemented, for flat top-level Python classes and JS/TS const objects. Methods, inheritance shapes, nested/unknown syntax, multiline lexical constructs, quoted/dynamic tool arrays and ambiguous declarations fail closed. Valid richer programs can therefore have objects/versions but no behavior relationships. These are design-time declarations, never claims about runtime effects of decorators or later mutation.
- Existing AgentVersion discovery remains same-artifact technical-profile correlation and requires exactly one identifiable Agent per artifact. Its evidence/revision may conservatively include unrelated technical declarations; L9 independently requires direct binding. This milestone does not redesign L4 version semantics or cross-artifact resolution.
- Target NormalizedCandidate IDs retain existing detector/line-position granularity. An unchanged exact binding replay is stable, but relocating an object declaration can produce a new target candidate/relationship record even when proposed object identity is unchanged. Canonical deduplication remains governed, outside this milestone.
- Supplied discovery inputs are trusted server-produced artifacts. The scanner consistency checks are not authentication or independent proof of arbitrary external records. Durable tenant lookup is exercised with fakes, not a live database/RLS deployment.
- Existing file-level already-governed source mappings may skip object candidate persistence. If an exact endpoint candidate is consequently absent, relationship intake fails closed; no canonical fallback is invented. Full governed endpoint handling belongs to milestone 7.
- Historical AGENT-source findings/evidence/migrations are retained as legacy, non-authoritative correlation. No database rewrite or automatic relationship deletion is attempted.
- **Production code:** implemented and wired to the existing intake for the two supported families. **Deployment:** NOT DEPLOYED; production untouched. **Merge:** NOT MERGED. **Next:** milestone 7 — RELATIONSHIP DECISION-TO-TRUTH COMPLETION V1, not started.

## Final file inventory

- packages/scanner/src/discovery/behavior-declaration-binding.ts
- packages/scanner/src/discovery/evidence-assembly.ts
- packages/scanner/src/discovery/relationship-correlation.ts
- packages/scanner/src/unified.ts
- packages/scanner/test/discovery-engine/relationship-correlation.test.ts
- apps/dashboard/lib/governance/discovery-intake.ts
- apps/dashboard/tests/discovery-intake-service.test.ts
- docs/codex/evidence/2026-09-09-agentversion-behavior-relationships-l9-v1-validation.md

The permitted recovery file remains untracked and was never read, hashed, staged, modified, deleted, copied or renamed. Repository `.claude/**` was not inspected. Frozen architecture, L8, GraphOS, production configuration and historical migrations remain outside the change list. One feature commit and one PR to main; no merge.

**Verdict:** `AGENTVERSION_BEHAVIOR_RELATIONSHIPS_L9_V1_READY_FOR_REVIEW` for the documented restricted implementation and explicit five-family correlation blockers.
