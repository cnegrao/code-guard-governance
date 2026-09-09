# Semantic Intelligence Foundation — L6/L7 V1 — Validation Evidence

**Architecture ID:** `GOVIA-L0L16-CIA-v1.0` (FROZEN BASELINE — unchanged by this milestone)
**Roadmap milestone:** 4 — SEMANTIC INTELLIGENCE FOUNDATION — L6/L7
**Base main SHA:** `582d62f2ed040a7d92c8137c602c912dd7bd51a1` (PR #24 merge — `fix(governance): enforce agent version profile immutability`)
**Branch:** `feat/semantic-intelligence-foundation-l6-l7-v1`
**Date:** 2026-09-09

---

## 1. Base SHA / Branch / Architecture

Verified before branching: `main` HEAD = `origin/main` = `582d62f2ed040a7d92c8137c602c912dd7bd51a1`; `d7e76ed79df0b135f85c957416937ef87ae30113` (approved milestone-3 feature commit) is an ancestor of HEAD; `582d62f` is a genuine two-parent merge commit preserving PR #24 (`git show --no-patch` confirmed two parents, subject "Merge pull request #24..."). Working tree contained only the untouched `codex-recovery-6101-6240.txt` (never read, staged, hashed, modified, or deleted by this session). `GOVIA-L0L16-CIA-v1.0` remains frozen and byte-identical to base; this milestone does not modify it, the roadmap, the coverage matrix, the implementation-conformance/reuse-register audits, or `ADR-GOVIA-TECHNICAL-PROFILE-PERSISTENCE-v1.md`.

## 2. Future-milestone architecture map (baseline §9, A–O)

**A. CIA baseline** — `GOVIA-L0L16-CIA-v1.0` compatible; no divergence, no new ADR required for the choices made (all resolved by direct application of the frozen baseline and reuse of the milestone-3 persistence pattern).

**B. L0–L16 impact** — PRIMARY: L6 (Business & Information Semantics, FOUNDATION_ONLY — see §8) and L7 (Embeddings & Semantic Representations, IMPLEMENTED as foundation). DEPENDENCIES: L0–L4 canonical objects and normalized candidates are the only subject sources this round. NOT IMPLEMENTED: L8 similarity/resolution, L9 relationships, L10/L11 connectivity/authz, L12 runtime, L13 reconciliation beyond existing state, L14 controls, L15 risk, L16 drift.

**C. Passport impact** — none claimed. No Passport family is marked implemented, populated, or presented by this milestone. Business Context (family 4) remains exactly as documented in the coverage matrix (`NOT_IMPLEMENTED`, depends on L6 discovery) — this milestone adds a semantic *representation* foundation, not Business Context discovery.

**D. Canonical impact** — none. `SemanticRepresentation` is DERIVED ANALYTICAL STATE, never a `CanonicalObjectKind`. No new `CanonicalObjectKind` was added for EMBEDDING, SEMANTIC_REPRESENTATION, BUSINESS_DOMAIN, INFORMATION_DOMAIN, or BUSINESS_TERM (the last three semantic-identity kinds already exist as a separate, frozen, non-canonical `SemanticIdentityKind` family in `packages/canonical-contracts/src/contracts.ts:648-685`, predating this milestone — reused as read-only context, not extended).

**E. Lineage impact** — none. No new governed lineage relationship. Representation provenance (assertion/evidence support) is not L9 relationship materialization.

**F. Evidence / provenance** — every representation identifies subject, content fingerprint, representation schema/projection version, embedding model/provider/version/dimension, and assertion/evidence support. See §10/§16.

**G. Trust / authority** — `SemanticRepresentation` and embedding-derived semantics have ZERO canonical authority. The persistence function never creates, mutates, certifies, or reconciles a canonical object or relationship (statically proven, §16/§20).

**H. Vector impact** — YES. This milestone establishes the L7 semantic/vector foundation (contract + scanner-side generation + persistence).

**I. Graph impact** — NONE. GraphOS untouched.

**J. LLM authority boundary** — no production LLM is required or used. The only embedding implementation shipped is a test-only deterministic hash-derived provider (§13), never presented as production.

**K. Tenancy / security** — every persisted representation is organisation-scoped (`organisation_id` on every new table, composite PKs/FKs throughout, explicit `p_organisation_id` verification in the persistence function). See §17.

**L. Migration impact** — one new, purely additive migration (§19).

**M. Downstream continuity** — subject model (CANONICAL_OBJECT | NORMALIZED_CANDIDATE), representation versioning, and provider-independent embedding boundary are designed to be directly reusable by milestone 5 (L8 similarity) and milestone 12 (Governed Graph + Vector Intelligence V1) without implementing either now.

**N. Non-fabrication** — no fake L6 semantic classification, no fake Business Domain, no fake embedding presented as production, no placeholder vector passed off as a real semantic output (the test-only provider is explicitly and pervasively labeled as such in its own type name, docstrings, and identifiers).

**O. Acceptance quality** — determinism, versioning, fingerprint correctness, provenance, tenant isolation, authority boundary, provider independence, and reproducibility are all covered by the test matrix in §21 and the migration's own structural tests.

## 3. Reuse map

| Capability | Decision | Notes |
|---|---|---|
| pgvector extension | `REUSE_AS_IS` | Already enabled by `20260818004009_agent_registry_graph_part_1.sql` (`create extension if not exists "vector"`); re-declared idempotently in the new migration for self-sufficiency, not as a new dependency. |
| `gov_repo.agent_embeddings` | `LEGACY_DO_NOT_EXTEND` | Fixed `vector(1536)`, keyed to the legacy pre-canonical `agents` table by `agent_id`, has no writer anywhere in the repo (confirmed by the prior conformance audit). Not canonical-object-scoped; not reused. |
| `gov_repo.coding_memory` (`apps/dashboard/supabase-setup-8.2.sql`) | `LEGACY_DO_NOT_EXTEND` | A different feature (Talk-to-Governance RAG chat context), fixed `vector(1536)`, lives in a manually-run SQL script outside the ordered migration pipeline, actively used for its own purpose. Not a canonical-object/candidate embedding store; not reused as persistence, though its existence confirms pgvector is a working, proven direction in this codebase. |
| `AgentVersionTechnicalProfile` persistence pattern (`20260908120000_...sql`, `agent-version-technical-profile-port.ts`, its dashboard adapter) | `ADAPT` | Structural template reused for: preflight guards, idempotency-conflict detection (first-insert-wins, reused content check, race-condition re-check under `unique_violation`), RLS/permissions shape, immutability rules, and the port/adapter split. Not reused verbatim — a `SemanticRepresentation` has no proposal/materialize governance gate (§7/§18) because it carries zero canonical authority, unlike a technical profile. |
| `SemanticIdentityKind` (`SEMANTIC_CONCEPT`/`BUSINESS_TERM`/`BUSINESS_DOMAIN`/`INFORMATION_DOMAIN`, `contracts.ts:648-685`) | `REUSE_AS_IS` (read-only context) | Confirms L6 identity kinds are already frozen contract, but no detector/persistence populates real instances of them; not extended by this milestone (see §8). |
| `PreCanonicalObjectReference` discriminated union (`contracts.ts:1870-1882`) | `REUSE_AS_IS` (pattern) | Directly informed the `SemanticRepresentationSubjectReference` shape (CANDIDATE vs. canonical object, never conflated). |
| `createBehaviorFingerprint`/`createTechnicalFingerprint` opaque-fingerprint idiom (`contracts.ts:365-447`) | `REUSE_AS_IS` (pattern) | `SemanticContentFingerprint` mirrors this exactly: `{algorithm, schemaVersion, value}`, deliberately no hashing algorithm baked into the contract itself. |
| `sha256(canonicalize(...))[0:32]` hash idiom (`object-candidate-normalization.ts:89`, `agent-version-correlation.ts`) | `REUSE_AS_IS` (pattern) | Reused verbatim in `packages/scanner/src/semantic/content-projection.ts` and `semantic-representation-builder.ts`. |
| Governance-review port/adapter split (`agent-version-technical-profile-port.ts` + its dashboard adapter) | `REUSE_AS_IS` (pattern) | `SemanticRepresentationPersistencePort` + `apps/dashboard/lib/governance/semantic-representation-persistence.ts` follow the identical shape. |

No legacy vector table was extended or repurposed as canonical-compatible foundation.

## 4. Semantic subject model

`SemanticRepresentationSubjectReference` (`packages/canonical-contracts/src/semantic-representation.ts`) is a closed discriminated union:

- `CANONICAL_OBJECT`: `{ organisationId, canonicalObjectId, canonicalObjectKind }`
- `NORMALIZED_CANDIDATE`: `{ organisationId, candidateId, candidateKind }`

Both durable contracts (`gov_repo.canonical_objects`, `gov_repo.discovery_candidates`) already exist and support safe, tenant-scoped subject references — no `STOP_REQUIRES_ARCHITECTURE_DECISION` was needed. A candidate subject and a canonical-object subject are never silently converted into one another (enforced by a CHECK constraint at the database layer and by the discriminated-union type at the TypeScript layer); a fresh representation may always be generated for the canonical object once reconciliation succeeds, coexisting with (not replacing) the pre-reconciliation candidate representation.

## 5. L6 business/information semantics status

**FOUNDATION_ONLY.** No detector, discovery pipeline, or persistence for Business Domain, Information Domain, Business Term, purpose, or capability instances was added or claimed. The frozen `SemanticIdentityKind` family (`SEMANTIC_CONCEPT`/`BUSINESS_TERM`/`BUSINESS_DOMAIN`/`INFORMATION_DOMAIN`) already exists in canonical-contracts, predating this milestone, but nothing populates real instances of it (confirmed unchanged by the prior conformance audit, §12, L6 row). The scanner-side `SemanticContentProjectionInput.knownTechnicalFacts` field is deliberately generic and evidence-backed-only — it carries whatever already-governed technical facts a caller supplies (e.g., an AgentVersion's own `behaviorFingerprint.value`), never a fabricated business classification. No keyword-based Business Term/Domain inference was implemented. This honestly matches roadmap milestone 4's own scope note ("no authority") and the coverage matrix's L6 = `NOT_IMPLEMENTED` baseline; this milestone does not change that classification for actual L6 population, only lays the L7 representation foundation that could, in a future round, carry evidence-backed L6 facts once such a source exists.

## 6. Semantic content projection contract

`packages/scanner/src/semantic/content-projection.ts`: `SemanticContentProjectionInput { subjectKind, objectKind, knownTechnicalFacts: [key, value][] }`. `buildSemanticContentProjection` validates fact keys/values before sorting, normalizes to canonical key+value order, deduplicates exact `[key,value]` pairs while preserving distinct values under the same key, and rejects an empty `objectKind`/fact key, and refuses (throws) any fact value that looks like a secret/credential (conservative regex allowlist-refusal, not a full secret detector — callers remain responsible for only ever supplying evidence-backed, already-vetted facts). No raw file content, no secrets, no full Prompt string content is ever accepted as a fact value by design (callers are expected to pass only already-governed technical facts, e.g. a fingerprint value or a declaration key — never a source excerpt).

`CONTENT_CANONICALIZATION`: `FACT_ORDER = canonical key+value order`; `DUPLICATE_FACTS = exact-pair deduplicated`. Reversing same-key distinct values or repeating exact facts leaves both projection and fingerprint unchanged; a genuinely changed value set changes the fingerprint.

## 7. Projection schema/version

`SEMANTIC_CONTENT_PROJECTION_SCHEMA_VERSION = "GOVIA_SEMANTIC_CONTENT_V1"`. Participates in both the content fingerprint's `schemaVersion` field and the representation's own `projectionSchemaVersion` field, so a future schema change is distinguishable and does not corrupt or silently reinterpret prior representations.

## 8. Content fingerprint algorithm/input

`sha256(canonicalize(projection))`, truncated to 32 hex characters, where `canonicalize` recursively sorts object keys and preserves array order (arrays are already normalized upstream by `buildSemanticContentProjection`'s key+value fact sort and exact-pair deduplication). Inputs: `subjectKind`, `objectKind`, the sorted `knownTechnicalFacts` pairs, and the schema version. No timestamp, no random value, no database row id, no Evidence/Assertion id, no line-number or traversal-order sensitivity (proven by `packages/scanner/test/semantic/content-projection.test.ts`).

`CONTENT_FINGERPRINT` is the full `SemanticContentFingerprint` tuple `{ algorithm, schemaVersion, value }`; provenance remains outside semantic content identity.

## 9. SemanticRepresentation contract

`packages/canonical-contracts/src/semantic-representation.ts`: `SemanticRepresentation { representationId, organisationId, subject, projectionSchemaVersion, contentFingerprint, embeddingProvider, vector, support, generatedAt }`. `createSemanticRepresentation` validates and freezes: at least one assertion/evidence support id is required (`SEMANTIC_REPRESENTATION_SUPPORT_REQUIRED` otherwise); organisationId must match the subject's own organisationId; `projectionSchemaVersion` non-empty; `embeddingProvider.dimension` a positive integer; `vector.length` must equal the declared dimension (fails closed via `SemanticRepresentationDimensionMismatchError`, never truncates/pads); every vector component must be finite. `representationId` itself is never computed by this package — it is expected to be content-addressed by the caller, matching the existing `NormalizedCandidateId`/`proposalId` idiom elsewhere in this codebase.

## 10. EmbeddingProviderPort

`packages/scanner/src/semantic/embedding-provider.ts`: `EmbeddingProviderPort { providerId, modelId, modelVersion, dimension, embed(projection, contentFingerprint) }`. No vendor (OpenAI/Anthropic/Google/Cohere/Voyage/Azure/Bedrock/Ollama) is referenced anywhere in the interface or its only implementation.

## 11. Production embedding-provider status

**PRODUCTION_EMBEDDING_PROVIDER = NOT_IMPLEMENTED.** `PRODUCTION_EMBEDDING_PROVIDER_STATUS = NOT_IMPLEMENTED`. The only implementation is the fixture `packages/scanner/test/semantic/test-only-deterministic-embedding-provider.ts` (`TestOnlyDeterministicEmbeddingProvider`), explicitly and pervasively labeled non-production (`providerId = "TEST_ONLY_DETERMINISTIC"`, `modelId` contains `"test-only"`, docstring states it is not a real semantic embedding model and must never be presented as one). Its vector is derived purely from the content fingerprint's own SHA-256 bytes and carries zero real semantic meaning. No live external embedding API call exists anywhere in this milestone's code.

`TEST_PROVIDER = test-only fixture, absent from production export surface`. `TEST_ONLY_PROVIDER is not production-exported`. Production `src/semantic/embedding-provider.ts` retains only `EmbeddingProviderPort` and `EmbeddingResult`; the scanner barrel exports those types and no fake provider.

## 12. Representation identity inputs

`representationId = sha256(canonicalize([subjectKey, projectionSchemaVersion, contentFingerprint.algorithm, contentFingerprint.schemaVersion, contentFingerprint.value, providerId, modelId, modelVersion, dimension]))[0:32]`, where `subjectKey = semanticRepresentationSubjectKey(subject)` (a stable JSON-encoded tuple distinguishing `CANONICAL_OBJECT` from `NORMALIZED_CANDIDATE` and including `organisationId`). Proven deterministic and input-sensitive by `packages/scanner/test/semantic/semantic-representation-builder.test.ts`: identical inputs reproduce the identical id; a changed content fingerprint, model version, declared dimension, subject family, or organisationId each independently changes the id.

`REPRESENTATION_IDENTITY_INPUTS`: subject (including tenant and subject family), projectionSchemaVersion, contentFingerprint.algorithm, contentFingerprint.schemaVersion, contentFingerprint.value, providerId, modelId, modelVersion, dimension. `REPRESENTATION_ID includes full SemanticContentFingerprint tuple`. Provenance ids, generatedAt, vector values, row ids and timestamps are excluded. Tests independently vary algorithm/schemaVersion with the fingerprint value held constant, and verify provenance/time independence.

## 13. Representation versioning rule

Multiple representations may coexist for the same subject (different provider/model/version/dimension/content-fingerprint each produce a distinct `representationId`); none is destructively overwritten. There is deliberately no mutable "current"/supersession pointer in this V1 foundation — every representation row is a permanent, independently auditable fact. A future milestone (L8) may add a current-pointer concept if similarity/comparison work requires one; this milestone does not fabricate that need.

## 14. Embedding model/provider/version rule

`embeddingProvider = { providerId, modelId, modelVersion, dimension }` is part of both the representation's own identity computation (§12) and its persisted row. Two representations that differ only in `modelVersion` are distinct rows with distinct ids — proven by test (§9 in `semantic-representation-builder.test.ts`).

## 15. Dimension rule

`embeddingProvider.dimension` must be a positive integer; `vector.length` must equal it exactly at the TypeScript contract boundary (`createSemanticRepresentation`, fails closed via `SemanticRepresentationDimensionMismatchError`) and again at the database boundary (`vector_dims(embedding) = embedding_dimension` CHECK constraint, plus an explicit pre-write verification inside `record_semantic_representation`). No truncation or padding occurs anywhere in this pipeline.

## 16. pgvector decision

**REUSE, no new architectural direction needed.** pgvector is already enabled (`create extension if not exists "vector"`, already applied by `20260818004009_agent_registry_graph_part_1.sql`; re-declared idempotently in the new migration). The `embedding` column is declared as an **unconstrained `vector`** (no fixed dimension typmod) rather than `vector(N)`, because this table must support multiple coexisting representation spaces (different providers/models/dimensions) for the same or different subjects simultaneously (§12/§13) — a single fixed-width column would force premature truncation/padding or forbid that coexistence. Dimension safety is instead enforced by the explicit `embedding_dimension` column plus the `vector_dims(embedding) = embedding_dimension` CHECK. No ANN index (HNSW/IVFFlat) was created — nearest-neighbor search and similarity are explicitly out of scope for this milestone (L8). This resolves what would otherwise have been a `STOP_REQUIRES_ARCHITECTURE_DECISION` under §14 of the milestone instructions without actually requiring an architecture-owner decision, because the smallest-safe-option analysis was conclusive: an application-and-database-dual-enforced explicit dimension column is strictly safer than either premature truncation/padding or a single fixed-width column that would forbid multi-space coexistence.

Exact replay comparison is supported by pgvector: upstream [v0.8.0 SQL operator declarations](https://github.com/pgvector/pgvector/blob/v0.8.0/sql/vector.sql#L207-L216) map equality to `vector_eq`, whose [implementation](https://github.com/pgvector/pgvector/blob/v0.8.0/src/vector.c#L945-L1007) compares each stored numeric component and dimension exactly. The existing repository migration enables `vector` without a version pin; no installed/live extension version was queried. The correction uses `v_existing.embedding IS DISTINCT FROM p_embedding` (null-safe exact equality over pgvector values, at pgvector numeric precision), following the RPC's existing SQL search-path/type conventions. No distance, tolerance, cosine comparison, or similarity is involved.

## 17. Persistence schema

`supabase/migrations/20260909120000_semantic_representation_persistence_v1.sql` (additive, single transaction, preflight-guarded): `gov_repo.semantic_representations` (one immutable row per representation; CHECK-enforced mutually-exclusive subject shape; FKs to `canonical_objects`/`discovery_candidates` by `(organisation_id, id)`), `gov_repo.semantic_representation_assertions` and `gov_repo.semantic_representation_evidence` (representation-level, not per-field, provenance junction tables — a `SemanticRepresentation` is one atomic projection, unlike `AgentVersionTechnicalProfile`'s five independently-enrichable fields). All three tables are append-only (`do instead nothing` rules forbid UPDATE/DELETE). The single write path, `gov_repo.record_semantic_representation`, verifies subject existence/kind-match, non-empty assertion/evidence support, and dimension consistency before replay or any write, and is idempotent on `(organisation_id, representation_id)` (checked and returned before any write; a reused id with different scalar identity fields or an exactly different vector fails closed with `SEMANTIC_REPRESENTATION_IDEMPOTENCY_CONFLICT`, including under the `unique_violation` race-condition path). No new `outbox_events` event type was added — a deliberate scope decision: a `SemanticRepresentation` carries zero canonical authority and is not a governance decision or materialization event, so wiring it into the outbox would blur the same "DISCOVERY != GOVERNANCE AUTHORITY" boundary this milestone otherwise protects; roadmap milestone 20 explicitly defers outbox consumer-building until real consumers exist, and there are none for this event type yet.

`IDEMPOTENCY_RULE`: same organisation_id + representation_id with all scalar identity fields and exact vector equal returns replay; a vector difference raises `SEMANTIC_REPRESENTATION_IDEMPOTENCY_CONFLICT` without overwriting or inserting a second row. Both ordinary replay and `unique_violation` recovery compare the identical full scalar/vector tuple; recovery also fails closed if no winner row is found. Support and generatedAt remain first-insert-wins and are not identity inputs. Null vectors are rejected before replay.

## 18. Provenance model

`PROVENANCE_MODEL`: `assertionIds.length > 0 OR evidenceIds.length > 0`; `EMPTY_PROVENANCE = REJECTED`. Assertion-only, evidence-only, and both-family support are accepted. The TypeScript constructor and the database RPC independently reject both-empty support; the RPC treats null arrays as empty and checks before replay or insert. No third provenance family, invented durable provenance, or arbitrary metadata is added. Unit-test identifiers remain isolated test fixtures. Every representation's `support: { assertionIds, evidenceIds }` is persisted via the two junction tables (§17), each FK-constrained to the already-durable `gov_repo.source_assertions`/`gov_repo.discovery_evidence` tables. Provenance ids never participate in the content fingerprint computation (§8) — provenance identity and semantic content identity are kept structurally separate, exactly as required.

## 19. Tenant/RLS model

Every new table carries `organisation_id uuid not null`, composite `(organisation_id, ...)` primary keys and foreign keys throughout, RLS enabled on all three tables, and exactly one `service_role`-only policy per table (`using (true) with check (true)`) — no `authenticated`-role policy exists anywhere in this table family, matching every adjacent Decision-to-Truth table in this codebase. `record_semantic_representation` additionally verifies the subject's existence *within the caller-supplied organisation_id* before any write, so a cross-tenant subject reference fails closed (`SUBJECT_CANONICAL_OBJECT_NOT_FOUND` / `SUBJECT_CANDIDATE_NOT_FOUND`) rather than silently succeeding against a different tenant's row.

## 20. Authority boundary

Statically proven (migration structural test, §21) that `record_semantic_representation` never inserts into or updates `canonical_objects`, `canonical_relationships`, `review_subjects`, or `reconciliation_decisions`. No `possible_match` or decision-engine logic exists. Recording a representation never invokes reconciliation, materialization, or certification of any kind.

## 21. Security/redaction boundary

`buildSemanticContentProjection` refuses (throws) any fact value matching a conservative secret/credential-looking pattern (PEM private key headers, `api_key:`/`secret:` assignment forms, `Bearer <long-token>`). Prompt raw text remains protected per milestone 3's policy — no code path in this milestone accepts, stores, or projects full Prompt string content; only already-governed, evidence-backed technical facts are accepted as projection input, by contract (`SemanticContentProjectionInput.knownTechnicalFacts`), never raw source text.

## 22. L8 status

**NOT STARTED.** No similarity/nearest-neighbor computation, no clustering, no possible-match candidate model, no ANN index. Confirmed by the migration's own structural test (`does not create an HNSW/IVFFlat index`) and by inspection (no new file references cosine/L2/inner-product distance operators for ranking purposes).

## 23. Graph status

**NOT CHANGED.** No file under GraphOS, `apps/dashboard/services/knowledge-graph.ts`, or `apps/dashboard/app/(dashboard)/graph/**` was touched.

## 24. Relationship semantics

**NOT CHANGED.** Zero diff on `relationship-correlation.ts` or any `GOVERNED_RELATIONSHIP_TYPE`/`RELATIONSHIP_ENDPOINT_CONSTRAINTS` code.

## 25. Migration status

One new, purely additive migration (`20260909120000_semantic_representation_persistence_v1.sql`), verified by full re-read and by 25 static structural tests (`apps/dashboard/tests/semantic-representation-persistence-migration.test.ts`) — not by execution against a live database (none authorized or available in this environment). No historical migration file was modified.

## 26. Test results

| Suite | Command | Result |
|---|---|---|
| `packages/canonical-contracts` | `npm test` | **99/99 passing** (includes four support-presence cases) |
| `packages/canonical-contracts` typecheck | `npm run typecheck` | clean |
| `packages/governance-review` | `npm test` | **117/117 passing at original head**; unchanged package, not rerun for this correction |
| `packages/governance-review` typecheck | `npm run typecheck` | clean at original head; not rerun (no files changed) |
| `packages/scanner` new semantic module | `npm run test:semantic` (new script) | **32/32 passing** |
| `packages/scanner` typecheck (src) | `npm run typecheck` | clean |
| `packages/scanner` discovery-engine (regression check — index.ts export surface changed) | `npm run typecheck:discovery-engine` + `npm run test:discovery-engine` | **164/164 passing**, typecheck clean, no regression |
| `apps/dashboard` new migration structural test | `node --conditions=react-server --experimental-test-module-mocks --import tsx --test --test-isolation=none tests/semantic-representation-persistence-migration.test.ts` | **25/25 passing** |
| `apps/dashboard` full workspace typecheck | `npx tsc --noEmit` | clean |
| `git diff --check` | repo root | clean |

Semantic and migration test runners initially hit sandbox `spawn EPERM`; authorized reruns passed. SQL verification remains static: the migration suite checks the empty/null support guard and the full ordinary/race conflict predicates and replay branches; it does not claim database execution.

Discovery Validation Lab (51/51, unrelated to this milestone's changes) was not re-run — no scanner detection/discovery-strategy file was touched, only a new, independent `src/semantic/**` module and its own export surface addition to `src/index.ts`, confirmed non-regressing by the discovery-engine suite above.

## 27. Adversarial review

One pass performed against the checklist in the milestone instructions:

- **A. Vector treated as identity** — not found. `representationId` is a caller-supplied, content-addressed string computed from scalar inputs (subject, schema version, fingerprint, provider/model/version, dimension); the vector array itself is never hashed into or used as identity.
- **B. Cross-tenant vector leakage** — not found. Every table/function is organisation-scoped; RLS has no `authenticated`-role policy; the record function verifies subject existence within the caller's own `organisation_id`.
- **C. Representation overwritten instead of versioned** — not found. All three new tables are append-only (`do instead nothing` UPDATE/DELETE rules); a changed input always produces a new `representation_id`/row.
- **D. Content fingerprint contaminated by provenance/timestamps** — not found. `computeSemanticContentFingerprint` only ever hashes the projection object (`subjectKind`, `objectKind`, sorted facts, schema version); `generatedAt`, `assertionIds`, and `evidenceIds` are never inputs to it.
- **E. Full Prompt/secret leakage into semantic projection** — mitigated by construction (§21); no code path accepts raw Prompt content, and a conservative secret-looking-value refusal exists.
- **F. Fake L6 semantic classification** — not found; none was implemented (§5).
- **G. Test vector mislabeled as real embedding** — not found; the only provider is exhaustively self-labeled test-only at the type, constant, and docstring level.
- **H. Incompatible embedding spaces treated as comparable** — not applicable this round (no comparison/similarity logic exists at all — see §22); the dimension/provider/model/version fields are fully preserved per-representation so a future L8 milestone can enforce space-compatibility before any comparison.
- **I. Semantic state invoking reconciliation** — not found (statically proven, §20).
- **J. L8 similarity accidentally implemented early** — not found (§22).
- **K. Legacy vector tables improperly reused as canonical foundation** — not found; `agent_embeddings`/`coding_memory` were inspected and explicitly classified `LEGACY_DO_NOT_EXTEND` (§3), never touched.
- **L. Arbitrary metadata JSON replacing typed contract** — not found; every new table column is explicitly typed (no `jsonb` column anywhere in the new migration, verified by the migration's own structural test).

PR #25 surgical correction of `ab724c1`: closed empty support acceptance, same-key fact ordering/duplicate sensitivity, incomplete fingerprint identity binding, missing vector replay integrity, and production exposure of the test provider. The race recovery now checks the same full scalar/vector tuple as ordinary replay. No broad architecture re-audit was performed.

## 28. Known limitations

- L6 (Business Domain/Term/Information Domain/purpose/capability) remains entirely `NOT_POPULATED` — this milestone is a representation foundation only, not an L6 discovery pipeline.
- No production embedding provider exists; the deterministic provider is a test-only fixture outside production exports.
- No "current"/supersession pointer exists for coexisting representations of the same subject (§13) — deliberately deferred, not fabricated.
- No live Discovery-triggered or UI-triggered call path invokes `record_semantic_representation` — the port/adapter/migration exist and are tested directly, but nothing under `apps/dashboard/app/**` calls them yet (consistent with this milestone's "foundation only" scope and the same honesty already established for the broader Discovery Engine in milestone 3's evidence).
- The migration's internal consistency was verified by full re-read and its own structural test suite, not by execution against a live Supabase/Postgres instance (none authorized).

## 29. Production status

Not deployed. No live Supabase access was used or is authorized by this milestone. No live external embedding API call exists anywhere in this milestone's code.

## 30. Final scope gate

`git status --short` after this milestone's work shows only the files listed in §31 as modified/added, plus the untouched, still-untracked `codex-recovery-6101-6240.txt` snapshot file (never read, staged, or modified). No file under `docs/architecture/GOVIA-L0L16-CIA-v1.0*.md`, `ADR-GOVIA-L0L16-CIA-v1.0.md`, `ADR-GOVIA-TECHNICAL-PROFILE-PERSISTENCE-v1.md`, or `.claude/**` was changed. No Golden Repository/Validation Lab change. No `relationship-correlation.ts` change. No Graph change. No production config/deployment change. `git diff --check` is clean.

## 31. Files changed

Modified (additive exports/scripts only):
- `packages/canonical-contracts/package.json` — added new test file to the `test` script
- `packages/canonical-contracts/src/identifiers.ts` — added `SemanticRepresentationId`/`asSemanticRepresentationId`
- `packages/canonical-contracts/src/index.ts` — export new `semantic-representation.ts`
- `packages/governance-review/src/index.ts` — export new `semantic-representation-port.ts`
- `packages/scanner/package.json` — added `test:semantic` script
- `packages/scanner/src/index.ts` — export new `src/semantic/**` module

Added:
- `packages/canonical-contracts/src/semantic-representation.ts`
- `packages/canonical-contracts/test/semantic-representation.test.mjs`
- `packages/governance-review/src/semantic-representation-port.ts`
- `packages/governance-review/test/semantic-representation-port.test.ts`
- `packages/scanner/src/semantic/content-projection.ts`
- `packages/scanner/src/semantic/embedding-provider.ts`
- `packages/scanner/src/semantic/semantic-representation-builder.ts`
- `packages/scanner/test/semantic/content-projection.test.ts`
- `packages/scanner/test/semantic/embedding-provider.test.ts`
- `packages/scanner/test/semantic/semantic-representation-builder.test.ts`
- `supabase/migrations/20260909120000_semantic_representation_persistence_v1.sql`
- `apps/dashboard/lib/governance/semantic-representation-persistence.ts`
- `apps/dashboard/tests/semantic-representation-persistence-migration.test.ts`
- `docs/codex/evidence/2026-09-09-semantic-intelligence-foundation-l6-l7-v1-validation.md` (this document)

No file under `docs/architecture/**` (other than reading them), `.claude/**`, `codex-recovery-6101-6240.txt`, `packages/scanner/test/discovery-validation-lab/**`, or any historical migration was modified.

Correction-only file scope: contract constructor + contract test; scanner semantic projection/provider/builder + scanner barrel and three semantic tests; new test-only provider helper; the existing unmerged milestone migration + its dashboard structural test; this evidence document. No second migration.

## 32. Verdict

**PR25_SEMANTIC_FOUNDATION_HARDENING_READY_FOR_REVIEW**

PR #25 remains open for review. MERGE STATUS: NOT MERGED. Production: not deployed; no live Supabase or embedding API access. Milestone 5: NOT STARTED.
