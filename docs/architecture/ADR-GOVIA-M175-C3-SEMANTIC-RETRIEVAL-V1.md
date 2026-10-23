# ADR — M17.5 C3 Semantic Retrieval V1

Date: 2026-10-22, America/Sao_Paulo. Repository: `cnegrao/code-guard-governance`.
Baseline: `e9293be4488112e703ab746c2f5f0fed301f3b7c`, branch `feat/m17.5-trust-assurance-v0`.
Status: **ACCEPTED ARCHITECTURE ONLY — C3-SR0 CLOSED / ARCHITECTURE PASS**.
Implementation, migration execution, deployment and hosted mutation are not authorized by this ADR.

## 1. Decision and product obligation

Preserve semantic enrichment as a first-class Talk-to-Governance capability. Replace the unsafe implementations. The target is: question → compatible query embedding → principal-bound retrieval → typed, source-labelled context → bounded LLM explanation → Talk answer. Regex intents remain one operational route, not a gate that prevents semantic discovery of relevant context.

Select `gov_repo.semantic_representations` and its two provenance tables as the **governance-subject semantic base**. Add a narrowly admitted principal-bound exact search in a separately authorized SR1. Design a **parallel technical repository semantic domain** for SR2; do not widen the existing two-family subject union into an untyped vector bucket. Legacy-only operational subjects need an explicitly typed operational retrieval adapter/store in SR2 as described below, not migration into canonical identities.

SR1 is deliberately a reference/provenance retrieval backend. It cannot recover the original embedding document, arbitrary code chunks or all legacy operational agents. Those product gaps are explicitly **TEMPORARILY DEGRADED — REQUIRES SR2**, not accepted permanent removals. Architecture PASS means the replacement path and bounded next step are defined; it is not feature parity, runtime security verification or LX03 containment.

`agent_embeddings`, `agent_semantic_search`, `coding_memory` and `coding_memory_search` are `LEGACY_DO_NOT_EXTEND`. No new retrieval path falls back to them. `coding_memory_search` remains noncanonical and must not be recreated. SR0 leaves existing runtime unchanged, including the known unsafe path; it makes no claim that the present Talk runtime is safe. Unrelated legacy callers may only remain under their existing authorization/containment limits pending their own disposition; this ADR grants no new use or safety exception.

## 2. Verified foundation fit — A through J

| Question | Current committed implementation and implication |
| --- | --- |
| A. Subjects | `SemanticRepresentationSubjectReference` has exactly CANONICAL_OBJECT and NORMALIZED_CANDIDATE. Canonical objects have the frozen 11 kinds: AGENT, AGENT_VERSION, MODEL, TOOL, MCP_SERVER, API, PROMPT, KNOWLEDGE_BASE, DATA_ASSET, DATA_ELEMENT, SKILL. Candidate kinds additionally include RELATIONSHIP; a relationship candidate is not a governed relationship. Persistence accepts the two families and checks the actual referenced kind. |
| B. Tenant identity | Composite PK `(organisation_id, representation_id)` and composite subject FKs. Both support tables use tenant-inclusive representation and assertion/evidence FKs. Recording verifies subject existence and kind in the same organisation. This fixes the structural defect of the legacy embedding-agent join, but does not itself authenticate a reader. |
| C. Space metadata | Provider ID, model ID, model version and dimension are explicit non-null columns. Projection schema and the full fingerprint tuple are also present. Stored `embedding` is unconstrained `vector`; a CHECK verifies actual and declared dimensions. Type construction rejects non-finite components and dimension mismatch, without padding/truncation. Existing metadata validation is not a provider registry or compatibility proof. |
| D. Provenance | Representation-level assertion IDs and discovery evidence IDs; source assertion rows contain source identity/method/trust/timestamps, evidence rows contain handling/hash/timestamps. Both also carry envelopes. An envelope is not safe public content and will not be returned. Support existence is required by the writer, not a cross-table CHECK guaranteeing every privileged insert has support; retrieval rechecks it. |
| E. Immutable versions | Append-only rules; content-addressed representation ID includes tenant/subject, projection schema, full fingerprint tuple and provider/model/version/dimension. Changed inputs coexist. Replay checks content rather than replacing an old row. Provenance/time do not contribute to the content fingerprint or representation ID. No mutable current pointer. |
| F. Reads | The persistence port/dashboard adapter exposes recording only. There is also a current M12 reader: `intelligence-read-store.ts` loads canonical representations and provenance through `privilegedDb`, with application organisation filters/validation and a 10,000-row bound; `intelligence-query.ts` exposes authenticated canonical graph/anchor-based analytical context. This is a real read path, not the principal-bound DB search proposed here, and it is not called by Talk. It has no free-question query embedding search or candidate retrieval. Do not silently replace or certify it in SR0/SR1. |
| G. Missing retrieval pieces | No principal-bound nearest-neighbor RPC, query embedding identity port, production foundation embedding provider/population path, explicit latest-version search selection or persisted embedding document. No ANN index. Existing L8 computes pairwise cosine/possible matches and clusters in memory; it is not a Talk retrieval service. |
| H. RLS/transport | Tables deny PUBLIC/anon/authenticated and have service-role policies. Service transport can read broadly; the policies do not bind a product session. Composite keys protect joins, not principal eligibility. Existing table privileges/RLS alone are insufficient for the new read contract. |
| I. New RPC | YES. Revalidate the verified session against persisted eligibility in the DB, derive the organisation from the stored actor, then read only that tenant in one data statement snapshot. Do not extend the frozen legacy RPC. |
| J. New index | NO required index for bounded exact V1. Existing organisation/subject B-trees suffice for an initially bounded scan. Add a composite tenant/space B-tree only after local plan measurements justify it. No ANN in SR1. |

Source locators and historical tests are in the accompanying SR0 evidence. No deployed population, provider configuration or target catalog was inspected.

## 3. Coverage and honest limits

`SUPPORTED NOW` below means the committed representation contract can express that domain when valid rows/support exist. It does not mean production embeddings exist or Talk currently uses them.

| Retrieval domain | Classification | V1 decision / limit |
| --- | --- | --- |
| A. Canonical governance objects | SUPPORTED NOW | Existing 11 object kinds; retrieve identity/provenance, without inferring governance assertions about the object. Object identity alone is not compliance, risk or applicability. |
| B. Normalized discovery candidates | SUPPORTED NOW | Object and RELATIONSHIP candidates retain candidate identity/kind. No implicit canonical conversion or relationship endpoint authority. |
| C. Source assertions / evidence | SUPPORTED THROUGH PROVENANCE | Resolve typed support references in the same tenant. No standalone assertion/evidence embedding family in SR1; no raw envelopes/excerpts. |
| D. Repository/code technical context | REQUIRES NEW REPRESENTATION FAMILY | Parallel technical domain in SR2. Existing subjects can represent a discovered AGENT/TOOL/etc., not an arbitrary repository snapshot, symbol or code chunk. |
| E. Legacy operational agents/systems | MUST NOT BE PROMOTED; REQUIRES NEW REPRESENTATION FAMILY | No ID bridge from `agents`/`ai_systems` into canonical IDs. Canonical/candidate AGENT retrieval is not a replacement for semantic retrieval over every legacy agent. Preserve exact reads; design a separate typed operational domain in SR2. |
| F. Incidents | OUT OF V1; MUST NOT BE PROMOTED | Incident is not one of the 11 canonical object kinds. Direct operational incident context remains bounded in C3. A future operational semantic family may index it without creating governed incident truth or closing LX06. |
| G. Policy/control/risk context | OUT OF V1 as direct semantic subjects | Their governed facts/registries are not those 11 object kinds. Provenance may reference related technical sources, but does not establish policy applicability, control effectiveness or governed risk. Do not invent a subject alias; future typed fact-family readers require separate design. |
| H. Arbitrary code symbols / repository memory | REQUIRES NEW REPRESENTATION FAMILY | SR2 technical domain preserves this product capability with durable repository/revision/chunk identities. Full raw code and Prompt text are outside its safe content contract. |

The old agent RPC searched legacy agents; Coding Memory indexed repository summaries, domains, services, modules, dependencies, entrypoints, agents and short code-snippet chunks. The existing semantic foundation alone does **not** replace that coverage. Removing that path without the SR2 replacement would degrade repository intelligence, symbol/source explanation and developer workflows. That degradation must remain visible until parity is verified.

## 4. Principal and tenant read boundary

Proposed server port: `retrieveSemanticContext(VerifiedGovernancePrincipal, QueryEmbeddingIdentity, RetrievalOptions)`. The browser supplies question text only. It supplies neither tenant identity nor provider/model/vector authority. Verify the existing signed governance session at ingress, retain the exact credential-epoch string, and forward the established five session-basis fields from trusted server code. JWT display role/email are not permissions.

Proposed sole application RPC: `gov_repo.semantic_context_search_v1`, with verified organisation/actor UUIDs, session iat/exp bigint, credential epoch timestamptz, unconstrained query vector, explicit provider/model/model-version strings, declared dimension integer, projection-schema string, limit integer and cosine threshold double precision. No overloads, dynamic table identifiers, arbitrary filters or second target-organisation parameter. These are design signatures, not executable SQL or existing contracts.

The function derives `v_org` from the persisted actor row; a mismatch with the verified organisation is authorization failure. It calls the unchanged `l14_session_basis_v1` using that persisted organisation and verified actor/times/epoch. That helper revalidates persisted organisation/user/roles through `lock_and_resolve_governance_session_eligibility_v1`, preserving ORG → USER → ROLES lock order. Recheck after locking; do not authorize from an unlocked preliminary lookup. Inactive actor/org, expired/stale session, epoch mismatch, missing eligibility or lock failure must not yield hits. No role asserted in a request replaces these persisted checks. A missing actor uses a generic denial without tenant-existence disclosure.

This follows the current L14/L15/V2 pattern: DB revalidation of a server-verified session basis, not DB cryptographic JWT verification. `service_role` is a trusted transport, not the authority decision. Compromise of that credential plus the trusted session-forwarding server is outside this read boundary's assurance; do not claim it can authenticate fabricated signatures. Browser callers/anon/authenticated cannot invoke the RPC, and a caller-selected foreign tenant must fail even through a test service-role session with a valid different principal.

Every relation alias is restricted to `v_org`. Every join uses `(organisation_id, identity)` even when identity is globally unique today. Explicitly join representation to its actual canonical object or candidate and compare the stored kind with the actual kind. Do not join both families and coalesce identities. Provenance joins include representation organisation and assertion/evidence organisation. Any orphan/mismatched subject, missing support or inconsistent kind makes acquisition unavailable; do not fall back to a legacy table or accept a UUID-only join. Composite FKs plus explicit predicates protect both legal writes and adversarial inconsistent fixtures. No cross-tenant row is returned even if a constraint was bypassed to seed corrupt data.

One statement snapshot covers selected representations, subjects and provenance after eligibility. Session locks remain held through the operation. No session eligibility failure is caught and relabelled NO_MATCHES. No write to governed facts, reconciliation, ledger or Authority Policy occurs inside retrieval; eligibility locks are allowed, data mutation is not.

## 5. Exact space and query embedding contract

Compatibility key is **exact equality**, case-sensitive and without aliases/default substitution, of `(projectionSchemaVersion, embedding_provider_id, embedding_model_id, embedding_model_version, embedding_dimension)`. The first field is needed in addition to the four provider fields because document preprocessing is part of the semantic space. Nonempty explicit IDs are mandatory. An unknown version, `latest` alias or unverifiable provider revision is not silently treated as compatible. A stable local adapter version is acceptable only if it pins and detects the actual embedding behavior; backend drift invalidates that configured space until representations are regenerated.

Introduce a query-specific provider port; do not use `LLMProvider.generateEmbedding(): number[]` as proof of space. That existing method loses provider/model/version/dimension identity and is independent of the foundation's `EmbeddingProviderPort.embed(projection, fingerprint)`. A server-owned, versioned configuration selects one supported document/query encoding recipe and one explicit space. Query output returns that complete identity plus finite components. Both server adapter and DB validate identity, actual vector dimension, finite values and nonzero norm. Never pad/truncate, use zeros as a synthetic embedding, or compare incompatible providers because their dimensions happen to match. The query recipe is paired with the document projection schema; same provider/model alone does not prove compatible formatting.

Configured provider choice cannot be overridden by question text, chat-model choice or browser fields. Query text remains untrusted data, is bounded, and is not persisted in the semantic store. A cache, if later added, must key tenant, exact space, query recipe and query fingerprint; SR1 needs no cache. Production credentials/model activation and foundation population are separate operational authorizations; tests use a deterministic fixture implementing the same identity contract. No production provider/population is inferred from the existing legacy OpenAI/Ollama methods.

No configured compatible space, unverified version, provider failure or empty embedding → `SEMANTIC_CONTEXT_UNAVAILABLE`, with a closed reason. No legacy or cross-space fallback. A valid query with no compatible stored representations is `SEMANTIC_CONTEXT_UNAVAILABLE / NO_COMPATIBLE_REPRESENTATIONS`, distinct from a completed nonempty-space search that finds no hits above threshold. A fully validated searched subset with no threshold matches → `NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE`; the world beyond that subset remains UNKNOWN.

## 6. Version selection, deduplication and freshness

V1 selection policy: `LATEST_RECORDED_IN_EXACT_SPACE_V1`. Filter tenant and complete space first. Group by `(subjectKind, actual subjectKindCode, subjectId)` within that tenant, **not** by display name or source similarity. Select one representation by `generated_at DESC, created_at DESC, representation_id ASC` using a defined bytewise/text collation for the final tie. Never let several old snapshots of the same subject consume top-k. Require finite, nonfuture generation timestamps at the read snapshot; malformed/future data is unavailable, not a newly authoritative version.

Choose the latest representative **before** ranking by similarity, and before optional content hydration. Do not select an older, more similar representation or silently replace a newest row whose support cannot be validated. Keep candidate and canonical subjects distinct even if a later reconciliation relates them; do not invent an entity-resolution dedup key. The same subject/fingerprint/provider replay is already idempotent; defensive grouping still prevents duplicate snapshots dominating results. Provenance for a selected row is its actual stored support, not a union over older snapshots.

This is the latest stored snapshot within the requested space. It is **not proof of current source content**, current governance status, or full ingestion. `generated_at` is producer-supplied and `created_at` is record time; neither proves source freshness. Return both times, selection policy, exact fingerprint tuple and `source_freshness: UNKNOWN`. A requested current-state determination that cannot be independently established remains UNKNOWN. No mutable current flag is introduced; exact historical-fingerprint lookup is outside V1. Later content hydration cannot be presented as the original embedding document unless its fingerprint has been verified.

## 7. Retrieval algorithm, limits and index decision

Use exact cosine over the validated tenant/space subset, then stable ordering by distance and subject key/representation ID. Cosine threshold is inclusive in `[-1,1]`. Validate limit `1..20` (default 5); the threshold and versioned retrieval policy must be explicitly supplied by trusted server configuration. These are resource/product policy choices, **not benchmark capacities**. Do not claim a magic threshold means correctness or comparable relevance across domains.

Existing organisation B-tree narrows reads; an exact compatible-space selection is materialized before vector arithmetic to avoid evaluating cosine against a wrong-dimension row. Distinct-subject selection precedes cosine. Count at most 10,001 compatible stored rows, including versions; more than 10,000 means `SEMANTIC_CONTEXT_UNAVAILABLE / SCAN_BOUND` rather than scoring an arbitrary prefix. SQL execution must enforce the bound; PostgREST pagination must not silently truncate candidates. Bound each returned hit's complete support to 100 references in total and fail acquisition on an excess, never silently truncate provenance. Limit metadata/content fields and response bytes; SR1 must encode/test those fixed bounds (IDs ≤512 UTF-8 bytes, total RPC response ≤256 KiB). The operation returns no cursor in V1: bounded context top-k, not an estate enumeration API. A subsequent request recomputes against its own snapshot.

Complexity is linear in compatible rows times vector dimension for cosine, plus version grouping/top-k/provenance joins. It can also read other spaces within a large tenant through the organisation index. Apply a 5-second database execution budget and existing session lock timeout; timeout/bound failures are unavailable, not empty success. Enforce execution timeout at the DB transaction/request layer (a function-level setting alone is not a demonstrated mid-statement deadline). No performance or capacity claim is made without an actual local execution plan and measurements. Exact scan is acceptable as the initial bounded algorithm; tenant populations beyond the bound need a separately verified index/paging design.

pgvector 0.8.7 supports exact search without ANN. Variable-dimension columns require dimension-specific expression/partial indexes for ANN; `vector` HNSW/IVFFlat indexing supports up to 2,000 dimensions. Approximate filtering can reduce recall after index scanning. Therefore choose no HNSW or IVFFlat in SR1; future ANN must isolate compatible spaces/dimensions and evaluate tenant-filtered recall, not reuse a mixed index blindly. See [pgvector 0.8.7 indexing, filtering and variable dimensions](https://github.com/pgvector/pgvector/blob/v0.8.7/README.md). These upstream facts support the choice; the numerical bounds above are this ADR's policy.

## 8. Closed output, provenance and content projection

Server-internal raw cosine may sort/filter hits. **Keep raw similarity internal**; do not return a score, percentage, probability or certainty bucket to Talk's public answer. Return only ordinal retrieval rank and retrieval policy version. Ranks are not comparable across different domains/spaces; future multi-domain composition uses per-domain quotas and labelled ranks, not averaging unrelated cosines.

Proposed `SemanticRetrievalResult` is a closed union: `CONTEXT_AVAILABLE` with hits, `NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE` with an empty hit list, or `SEMANTIC_CONTEXT_UNAVAILABLE` with a closed acquisition reason and no hits. Authorization failure is an error outside this acquisition union. Include algorithm/selection policy, exact searched space and explicit coverage `BOUNDED_RECORDED_REPRESENTATIONS_ONLY`. Do not return population-wide completeness or tenant assurance.

Each `SemanticRetrievalHit` contains only:

- `representation_id`, exact canonical/candidate subject union (with tenant checked internally), and `embedding_space` as defined above;
- full fingerprint `{algorithm, schemaVersion, value}`, representation `generated_at` and `created_at`, `selection_policy`, `source_freshness: UNKNOWN`;
- `retrieval_relevance: {kind: RETRIEVAL_RANK_ONLY, rank, policy_version}`;
- `provenance.assertions`: assertion ID, method code/version, stored trust state, observed/recorded timestamps; `provenance.evidence`: discovery evidence ID, handling, content hash and captured timestamp. Arrays are complete, deterministically ordered and tenant-revalidated. Numeric source confidence and raw source external IDs are excluded;
- `source: SEMANTIC_GOVERNANCE_CONTEXT`, `authority: DERIVED_ANALYTICAL_NON_AUTHORITATIVE`, `derivation: SEMANTIC_MATCH`, `canonical_decision: false`, `governed_relationships: false`, `assurance: false`;
- `content_projection: {kind: SUBJECT_REFERENCE_ONLY_V1, subject_kind, subject_kind_code, subject_id, original_embedding_content: NOT_STORED}` and a closed limitation list including `NO_GOVERNANCE_CONCLUSION`, `SOURCE_FRESHNESS_UNKNOWN`, `ORIGINAL_EMBEDDING_DOCUMENT_UNAVAILABLE`.

The subject may be CANONICAL_OBJECT, but the hit/explanation is not an authoritative fact. The candidate remains NORMALIZED_CANDIDATE, even for kind RELATIONSHIP. The output reports no canonical truth, match identity decision or applicable-regulation conclusion. Validate every nested field at the adapter boundary; discard unknown keys. No vectors, query text, raw Prompt content, raw code, arbitrary source envelopes, external_refs, nested metadata or legacy control flags are serialized.

**Content gap is explicit:** the table contains no original projection text. A fingerprint cannot be reversed into text; source assertion/evidence membership is not a complete reconstruction recipe. Do not forward assertion/evidence envelopes as a workaround. SR1 returns the safe identity/provenance descriptor above, which supports contextual discovery and citations but not rich code explanations. Rich factual content belongs to typed, separately versioned hydration or SR2's protected technical projection. A later hydrated current field must state its own source/time and cannot silently claim it is the old embedding input. SR1 requires **no new content table**, no guessed content backfill and no generic JSON store. This is the smallest useful, honest read capability.

## 9. Talk integration and failure semantics

The future composer has separate records for DIRECT_OPERATIONAL_CONTEXT, SEMANTIC_GOVERNANCE_CONTEXT, REPOSITORY_TECHNICAL_CONTEXT and LLM_EXPLANATION. Each has SOURCE, AUTHORITY, DERIVATION, SUBJECT and LIMITATION. Retrieval is available for questions outside exact intent patterns and can enrich direct questions where useful; it must not use an intent's numeric confidence to decide epistemic authority. A routing match is descriptive metadata only.

Use direct operational allowlists from C3; semantic hits use §8; the future repository domain has its own source label. The LLM sees boundaries and acquisition state before data. Treat all strings as quoted untrusted source values, never as system instructions. The answer's product-owned envelope remains derived/non-authoritative and says canonical/governed/legal/assurance state is UNKNOWN when these sources cannot establish it. Similarity, stored trust labels and canonical identity are not permission to conclude compliance, control effectiveness, verified oversight or governed risk.

SR1 creates a backend retrieval port/adapter only; **does not wire or change Talk**. C3 must later implement the full answer/source/sanitization/LLM containment, ledger routing metadata, sensitive-intent fail-closed behavior and tests from the original checkpoint. Model instructions alone are insufficient: unsupported affirmative authority must be blocked by a deterministic/structured product mechanism. Do not cite prior generated answers as source facts. New ledger events may record retrieval policy, source family, acquisition state and counts, never calibrated confidence or cosine-as-truth. The existing secure V2 Talk ledger writer remains unchanged in SR0/SR1.

Provider/query/source failure keeps safe exact/direct capability available to the future composer, with semantic acquisition explicitly unavailable. No failure fabricates a match or means no risk/incidents/compliance issues. C3 must distinguish no matches from failed acquisition and from a representation population that has never been generated. No silent fallback to legacy agent or coding-memory RPCs. A temporary transition gap is visible in product capability/operational status until SR2 is verified.

## 10. Repository/code preservation — choose a parallel typed store

Choose **B: a parallel technical-semantic store**, not an extension of `SemanticRepresentationSubjectReference`. Extending the current union would require new DB shape/FKs, core contracts and consumer validation, and invites a false implication that code chunks are governed canonical subjects. A separate analytical domain preserves meaning at the cost of explicit multi-domain query orchestration and independent population/ACL tests. Reuse provider-space, fingerprint, validation and principal-basis patterns, not canonical object kinds or authority permissions.

SR2's technical subject contract must be a closed union of REPOSITORY_SNAPSHOT, CODE_SYMBOL and REPOSITORY_CHUNK. Identity includes tenant, existing durable source connection/repository identity, immutable revision/content hash, sanitized path, and, where applicable, stable symbol key or bounded chunk/line-span identity. No name/path alone is durable identity; no ANYTHING family. Composite FKs reference a tenant-bound repository snapshot and its source/provenance. If there is no suitable durable repository snapshot in the target schema, SR2 adds a minimal typed technical snapshot root rather than inventing canonical objects or trusting a caller path. Define that schema before implementation.

Store separate immutable representations/provenance for that domain with complete space identity. A protected projection holds only vetted technical summaries, symbol signatures/dependency/entrypoint descriptors and sanitized locators/line spans, with explicit schema and content hash. No arbitrary metadata or raw code/Prompt blob as semantic content. Symbol/source explanations can refer to provenance locators; raw source access is a separate authorized operation. A conservative secret regex is defense in depth, not proof that arbitrary code is safe. Typed extraction, content handling, redaction and a no-raw-content allowlist are required before embedding or returning text. Reingest from verified immutable sources; legacy coding-memory rows are not trusted input to a bulk copy. SR2 must verify no secrets, Prompt text or tenant crossover in tests.

For semantic discovery over legacy agents/systems not represented as candidates/canonical subjects, SR2 also needs a **separate closed operational projection** with a discriminator LEGACY_AGENT_RECORD or LEGACY_SYSTEM_RECORD, composite tenant/record FKs (adding suitable unique keys only in a separately authorized migration if absent), immutable observation/version and protected descriptor. Do not put them in the repository chunk union or overload the governance subject union. Future incident support, if desired, is a separately admitted LEGACY_OPERATIONAL_INCIDENT_RECORD family; incidents are OUT OF SR1 and no LX06 closure follows. Legacy operational descriptors carry legacy risk/control limitations; they never create canonical identity or facts. SR2 must restore legacy semantic agent-discovery coverage, not claim AGENT candidates cover all legacy agents.

A future technical/operational principal-bound read applies the same tenant/space/provenance rules and needs its own precisely enumerated security admission. Multiple domains may share a compatible provider, but their ranks/threshold policies remain domain-labelled. No automatic source promotion, entity-resolution link, canonical bridge or relationship write occurs. Full feature-parity acceptance for repository/code memory and legacy-only agent discovery is an SR2 gate, and cannot be reported PASS from this design or SR1.

## 11. Primary capability preservation matrix

| Capability | Current legacy implementation | Security / architecture problem | Target safe implementation | Function preserved? | Deferred gap / rollout status |
| --- | --- | --- | --- | --- | --- |
| Semantic agent discovery | agent_embeddings + agent_semantic_search | Joined-agent tenant not independently bound; frozen body | Governance AGENT/candidate retrieval plus separate typed legacy operational adapter | YES in target | Canonical/candidate portion in SR1; legacy-only agent parity TEMPORARILY DEGRADED — REQUIRES SR2 |
| Semantic governance-object retrieval | Legacy agent context used as generic governance context | Source promotion and incomplete subject coverage | Exact search over existing canonical/candidate base with per-hit boundaries | YES in target | SR1 reference/provenance only; real population/provider must be verified; rich content hydration deferred |
| Repository/code retrieval | coding_memory + noncanonical coding_memory_search | M16 catalog rejection; untyped chunks and weak authority labelling | Parallel typed technical-semantic store, query and protected projections | YES in target | TEMPORARILY DEGRADED — REQUIRES SR2; not replaced by canonical IDs |
| Semantic candidate retrieval | Not served by old Talk semantic RPC | No durable candidate semantic read in Talk | Existing NORMALIZED_CANDIDATE family via principal-bound RPC | YES in target | SR1 backend; Talk integration separately in C3 |
| Provenance-aware context | Embedding rows/raw fields and textual coding memory | Source flattening; arbitrary supporting data | Tenant-checked complete support and typed context record | YES in target | SR1 semantic contract; composer and operational sanitization in C3 |
| Talk natural-language enrichment | LLM over direct, agent semantic and code context | Numeric confidence, raw model assertions, incompatible embedding risk | Independent query provider plus bounded multi-domain composer and answer envelope | YES in target | Rich source/code explanations TEMPORARILY DEGRADED — REQUIRES SR2; SR1 alone does not claim parity or alter Talk |
| Multi-source context | Direct DB + agent semantic + coding-memory text | Families/authority merged implicitly | Source-labelled direct/governance-semantic/repository-technical/operational-semantic records | YES in target | Governance backend SR1, Talk containment C3, technical/operational domains SR2 |
| Tenant isolation | Principal at ingress, legacy RPC tenant arguments | Join and service-role authority gaps | Persisted session revalidation, composite FKs, tenant-inclusive joins for each domain | YES in target | Requires SR1/SR2 adversarial DB tests; no runtime assurance from SR0 |

No row means “already restored in production.” Unverified/unpopulated sources are unavailable, not invented coverage. Permanent removal of any primary capability is not an accepted option.

## 12. SECURITY DEFINER decision and M16 successor

**M16 successor required: YES.** Historical R1 pinned exactly 22 application-callable definers, their identities/body hashes/config/owner classes and the frozen policy-owner subset. Current branch contains subsequent principal-bound L14/L15/V2 capabilities, including three V2 read definers and a private invoker projection. “22” describes the historical admission baseline, not the present catalog count. Do not edit that migration or pretend a new application definer fits the old allowlist unchanged.

Select a new narrowly admitted SECURITY DEFINER read, following the current V2 principal-read convention, rather than a service-role invoker wrapper. An invoker RPC could perform checks, but with broad service DML it would add no distinct least-capability read boundary; anon/authenticated lack the verified custom session basis and table policies needed for a safe invoker endpoint. Changing that entire RLS topology is wider than SR1. A definer must be an explicit, reviewed successor capability, not an automatic fix for permission errors.

Minimal successor rule: one exact new `semantic_context_search_v1` identity, read/lock-only static body, service-role EXECUTE only, zero PUBLIC/anon/authenticated EXECUTE, no overload or generic execution facility. Match current V2 ownership (`postgres`) **as an explicitly recorded narrow read exception to historical policy-owner closure**, with exact identity/body/config/ACL postflight. This owner has broad power; code, dependencies and EXECUTE ACLs must be frozen and inspected, not called “read-only” merely because the name is a search. No new role memberships, write rights, schema CREATE grants, session minting or mutation of existing routines. A dedicated technical role could later reduce owner capability, but would require enumerating transitive session-helper locking privileges; it is not silently assumed by this minimal design.

Use VOLATILE/PARALLEL UNSAFE for persisted eligibility locks, fixed `search_path` excluding untrusted schemas, fully qualified table/helper references and schema-qualified pgvector operators/functions resolved from the installed extension namespace. Keep `pg_temp` last if present; verify extension schema is not writable by application roles. Create/revoke/grant in one migration transaction to avoid PUBLIC-default execution exposure. PostgreSQL describes these definer/ACL requirements in [CREATE FUNCTION security guidance](https://www.postgresql.org/docs/17/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY). [PostgreSQL RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) also makes clear that owners/BYPASSRLS are not constrained like normal readers; explicit tenant predicates remain required.

The additive successor migration must inspect the actual approved **current** chain's function identities, ownership, settings and dependencies; preserve all prior hashes/ACLs, admit only this new body, and fail on unapproved application definers/overloads/grants. Scope catalog assertions to approved chain deltas rather than rewriting historical manifests to a guessed total. Tests must exercise the new exception against the latest M16/M17/V2 capability model. No new Authority Policy permission/action or governed fact family is required for derived retrieval; persisted session eligibility is the product read gate. This design decision resolves the successor question; SR1 remains separately unauthorized until requested.

## 13. SR1 change budget and exact implementation checkpoint

Proposed checkpoint: **M17.5-V1-S1B C3-SR1 — principal-bound governance semantic reference retrieval V1 + explicit M16 read-capability successor**. NOT AUTHORIZED / NOT STARTED.

| Item | Expected SR1 delta |
| --- | --- |
| Migration | One additive migration created through the repository's migration workflow; no historical edit or hosted application |
| Application-callable function | One new principal-bound search RPC with the exact §4 argument identity; static closed output |
| Helper function | None required beyond existing persisted session eligibility; prefer inline static validation/projection, no new definer helper |
| Index | None required for bounded exact V1; no ANN |
| Tables / columns | None; especially no generic semantic-content bucket |
| Subject family / canonical taxonomy | None; reuse two existing families and frozen kinds |
| ACL / security admission | Explicit service-role-only EXECUTE; successor identity/body/config/owner/ACL assertions; no table grants or role-membership changes |
| Authority Policy | Zero delta; retrieval does not grant governance decisions |
| Server contracts | Query embedding identity/provider port, retrieval policy, closed hit/result union, source boundary and adapter validation |
| Query embedding implementation | Explicit configured space/recipe adapter and deterministic test fixture; no live provider call/credential provisioning in validation; incompatible/unconfigured deployment remains unavailable |
| Population | Zero backfill, no generated canonical subjects, no automatic writes; validate with synthetic local existing-subject representations. Real population/production provider activation remains unverified and separately authorized |
| Talk / Graph / Search / existing M12 reader | Zero behavior change; no automatic resume of C3; future integration consumes the new port only after authorization |

SR1 acceptance must cover two tenants and hostile inconsistent joins, stale/revoked/inactive sessions, exact epoch precision, persisted role changes, schema/kind mismatch, empty support, space-field changes one at a time, invalid/nonfinite/zero/wrong-dimension vectors, selection/dedup ties, no-compatible-space vs no-matches, whole-scan/support/response bounds, source errors, timeouts and closed output. Prove no vector/raw JSON/Prompt/cosine-confidence leak; verify no governed writes, no legacy RPC call and no changed historical function body/ACL. Use actual disposable PostgreSQL 17 + pgvector 0.8.7; a text-vector stand-in cannot establish cosine or dimension behavior. Run only targeted migration/security/retrieval tests and affected typechecks, not repeated full-product regression. None is executed by SR0.

SR2 is the named follow-on for protected technical/operational domains and richer safe content, as defined in §10, requiring its own implementation authorization and exact schema/security contract. C3 remains STOPPED — READY FOR SR1 BEFORE RESUME; successful SR1 will not automatically authorize C3, SR2, a product-parity claim or closing LX03. Any temporary semantic degradation must be explicit during that later transition.

## 14. Relationship to L8 and roadmap

Recommend an **M17.5-local principal-bound retrieval capability reusing L7 and existing L8 compatibility principles**, not activation/reimplementation of milestone 5 or milestone 12. The September 9 evidence says “L8 deferred” at foundation time, but current committed source has the later L8 exact pairwise analytical engine and M12 anchor-based canonical intelligence reads. Git code supersedes a historical “not started” statement. Neither supplies the question-to-context RPC required here.

This ADR adds an index-free query-to-context read design only. Do not invoke `createPossibleMatchCandidate`, clustering, candidate reconciliation, automatic merge, relationship creation, graph expansion, materialization or possible-match queues from retrieval. Do not mark L8 durable retrieval/history complete, M12 complete or any new roadmap milestone started. Record this additive capability in the architecture index; preserve frozen roadmap/history files.

## 15. Threat model

| Threat | Prevent | Detect | Failure behavior |
| --- | --- | --- | --- |
| A. Caller-selected foreign tenant | No browser tenant; derive stored actor organisation and revalidate session | Two-tenant principal/parameter forgery tests | Authorization denial, no hits or foreign existence detail |
| B. Foreign subject join | Composite FKs plus tenant-inclusive joins and actual-kind checks | Corrupt fixture bypassing FK + join assertions | No foreign row; acquisition unavailable on detected inconsistency |
| C. Cross-model comparison | Exact five-field space equality before cosine | Mutate provider/model/version/dimension/schema independently | Incompatible space unavailable; no fallback |
| D. Stale representation | Latest per subject in exact space; snapshot freshness explicitly UNKNOWN | Multiple versions, old more-similar vector, future timestamp tests | No stale duplicate dominance; cannot answer current-state certainty |
| E. Duplicate representations | Content ID/idempotency plus deterministic subject grouping | Duplicate/tie/permuted-order fixtures | One hit per exact subject family/kind/ID |
| F. No compatible space | Explicit server configuration and compatible population check | Unconfigured/missing-space fixtures | SEMANTIC_CONTEXT_UNAVAILABLE |
| G. Malformed dimension | Adapter + DB vector dimension/finite/nonzero validation | Wrong-length/zero/NaN/Inf/invalid parameter tests | Reject invalid query; no fabricated match |
| H. Similarity interpreted as truth | Rank-only external projection and explicit derived authority | Nested allowlist/source contract tests | No confidence/probability output |
| I. Hit promoted to identity | Read-only hit references pre-existing subject | No reconciliation/materialization dependency tests | No canonical identity action |
| J. Candidate promoted to canonical | Discriminated subject union throughout | Same textual ID across families and relationship-candidate fixtures | Candidate remains candidate |
| K. Provenance omitted | Required complete tenant-bound support; bounded totals | Missing/orphan/foreign/oversize support tests | Unavailable; no generic evidence fallback |
| L. Sensitive content leakage | SR1 reference-only descriptors; SR2 typed protected projections | Hostile extra keys/envelopes/Prompt/secret fixtures | Drop unsupported fields; reject unsafe projection; no raw return |
| M. Service transport confused with authority | DB persisted eligibility + closed definer admission | service_role with invalid principal, direct anon/auth calls, ACL/catalog checks | Denial; privilege alone gives no product answer |
| N. Provider/query/source failure | No synthetic vectors; timeout/bound/error states | Provider failure and SQL cancellation/error fixtures | Semantic context unavailable; safe direct context remains distinguishable |
| O. Repository-memory tenant leak | Separate typed snapshot/chunk tenant FKs and principal read | SR2 hostile repository/revision/connection/chunk fixture | No technical context; never legacy fallback |
| P. Semantic hit used as assurance | Fixed NON_AUTHORITATIVE/assurance:false; C3 product envelope | Adversarial generated compliance/risk/effectiveness claims | Relevant governed state UNKNOWN; no assurance conclusion |

## 16. Non-goals and status

SR0 changes documentation only. No runtime, schema, migration, RPC, RLS, ACL, provider configuration, Talk/Graph/Search behavior, canonical kinds/relationships, M16/M17 facts or Authority Policy change. No legacy migration to canonical identity, legal conclusion, governance confidence, compliance/readiness/risk/assurance score, Hub implementation, external framework mapping, S1C, L04/LX09 or M18 work. No production benchmark, hosted inspection, deployment or PR.

C3-SR0: CLOSED / ARCHITECTURE PASS. Semantic enrichment: PRESERVED AS REQUIRED PRODUCT CAPABILITY in the target, with explicit SR1/SR2 transition gaps. Semantic foundation selected for governance retrieval. Repository/code retrieval designed as a second domain. M16 successor: YES, explicit and bounded. C3 remains STOPPED — READY FOR SR1 BEFORE RESUME. LX03 remains NEEDS_CONTAINMENT. LX01/LX04/LX05/LX06/LX07 remain OPEN. Previous L01/L02/L03/LX02/LX08 classifications are unchanged, not reverified. V1-S1B/M17.5 OPEN; CONTROLLED_DEMO_READINESS, EXTERNAL_PUBLICATION_READINESS, TENANT_ASSURANCE_READINESS, CERTIFICATION_READINESS and M18 HOLD.

## 17. Architecture GO criteria

| # | Design gate | Verdict / location |
| --- | --- | --- |
| 1 | Semantic enrichment first-class | PASS — §§1,9,11; explicit capability obligation |
| 2 | No unsafe legacy RPC required | PASS — §§1,5,9,10; no fallback in target |
| 3 | Principal-bound isolation | PASS BY DESIGN — §4; persisted session basis, runtime tests pending |
| 4 | Tenant-safe subject/provenance joins | PASS BY DESIGN — §§2,4; composite keys + explicit predicates even for corrupt fixtures |
| 5 | No incompatible space mixing | PASS BY DESIGN — §§5,7; exact compatibility and validation |
| 6 | Similarity non-authoritative | PASS — §§8,9; internal cosine, external ranks only |
| 7 | Provenance preserved | PASS — §8; complete support with fail-closed bounds |
| 8 | No identity promotion | PASS — §§3,4,8,14; candidate/canonical distinction remains |
| 9 | Repository/code capability not silently lost | PASS — §§3,10,11; parallel typed target, explicit SR2 gap |
| 10 | M16 security impact explicit | PASS — §12; formal successor YES, old routines unchanged |
| 11 | Bounded implementable SR1 | PASS — §13; one new read, no new table/subject/index, targeted validation |

All are architecture decisions/obligations; none is a claim that security or product gates have passed executable verification. There is no unresolved architecture alternative required to define SR1. Implementation authorization and empirical validation remain future work.
