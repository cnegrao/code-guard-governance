# Similarity & Entity Resolution Candidates — L8 V1

## Pre-implementation architecture mapping

- A. CIA baseline: `GOVIA-L0L16-CIA-v1.0`, frozen and unchanged.
- B. Layers: implement L8 over L7 representations; other layers unchanged.
- C. Passport: no population or presentation changes claimed.
- D/E. Canonical identity, temporal state, relationships and lineage: no writes or changes.
- F. Evidence: retain L7 subject, representation and assertion/evidence references.
- G. Trust: local `ANALYTICAL` status only; no confidence, certification or reconciliation authority.
- H. Vector: exact domain cosine with full semantic-space compatibility; no new embedding model.
- I/J. Graph and LLM: no integration.
- K. Security: explicit request organisation must match both representations and subjects; output allowlists exclude vectors and raw content.
- L. Migration: none. Durable analytical persistence is NOT_IMPLEMENTED in V1.
- M. Continuity: typed, deterministic, serializable snapshots can inform a later governed consumer; none is wired now.
- N. Non-fabrication: DataElement capability only; no discovery or production population claimed.
- O. Acceptance: focused semantic tests, typecheck, one adversarial review and final diff gate.

## Contract-first reuse map (recorded before implementation)

| Existing piece | Classification | Application |
|---|---|---|
| SemanticRepresentation and subject union | REUSE_AS_IS | Only comparison input; preserve candidate/canonical distinction |
| EmbeddingProviderMetadata | REUSE_AS_IS | Full provider/model/version/dimension compatibility |
| SemanticContentFingerprint | REUSE_AS_IS | Retained in L7; no second embedding identity |
| L7 projection/builder and subject-key helper | REUSE_AS_IS | Protected technical facts and stable subject references |
| SHA-256 tuple identity pattern | ADAPT | Domain-separated candidate/cluster identities |
| Semantic representation persistence and pgvector migration | REUSE_AS_IS | Existing immutable input storage; no modifications |
| NormalizedCandidate, CanonicalObject, ReviewSubject, reconciliation outcomes | REUSE_AS_IS | Boundary context only; analytical outputs are none of these |
| agent_embeddings / coding_memory | LEGACY_DO_NOT_EXTEND | No L8 reads or writes; previous milestone classification retained |
| L8 engine, possible-match contract, clustering | NOT_PRESENT | Add local analytical domain types and pure functions |

## Persistence decision

V1 is an explicitly invoked domain computation, with no durable review queue, UI, scheduled run or reconciliation consumer. Results include the full policy, computation context and source references for inspection and deterministic replay against immutable L7 inputs. Durable retention would be required before claiming an auditable historical review workflow or future governed consumption; neither is implemented here. No in-memory map is presented as durable persistence. Separate additive analytical tables remain the preferred future direction; canonical tables must never host these outputs. New persistence/RLS/idempotent database history: NOT_IMPLEMENTED. No new architectural authority is assigned.

PossibleMatchCandidate and PossibleMatchCluster are currently **in-memory derived analytical results**. No durable analytical history exists; therefore **durable audit/review retrieval = NOT_IMPLEMENTED**. Ephemeral inspection/recomputation does not grant canonical authority or constitute durable auditability. A future persistence decision must precede any downstream governed consumer that relies on durable L8 history. No persistence is introduced by the final mathematical/determinism gate.

## Validation record

1. **Base main SHA:** `3916736360f7a7fae2391b3afac31006b0995d7a`. After `git fetch origin`, local `main` equalled `origin/main`. Both required ancestry commands returned 0 for `a2a1608f4bd35a5c8c026307f20bba58a81cc81e` and `3916736360f7a7fae2391b3afac31006b0995d7a`. Initial status contained only the permitted recovery file.
2. **Branch:** `feat/similarity-entity-resolution-candidates-l8-v1`.
3. **Architecture:** `GOVIA-L0L16-CIA-v1.0`, unchanged. The pre-implementation A–O mapping above applies. No frozen architecture, roadmap, conformance or reuse-register document was modified.
4. **Milestone:** 5 — SIMILARITY & ENTITY RESOLUTION CANDIDATES — L8. Domain capability IMPLEMENTED; production integration NOT_IMPLEMENTED.
5. **Reuse map:** see the contract-first table above. Previous milestone evidence supersedes historical conformance population claims for L7. Existing scanner correlation utilities are discovery/evidence correlation, not reusable vector comparison or analytical clustering. No parallel embedding model or canonical contract modification.
6. **SemanticSpaceIdentity:** typed tuple of `projectionSchemaVersion`, `providerId`, `modelId`, `modelVersion`, `dimension`, taken directly from persisted L7 fields. Nonempty identifiers and a positive safe integer dimension are required. Tuple encoding is deterministic and independent of object property order.
7. **Compatibility:** request organisation equals each representation organisation and each subject organisation; every space component must equal; both subject entity kinds must equal the explicitly selected family. Unknown subject discriminants and unsupported families fail closed. Dimension mismatch never pads/truncates. Nonfinite and zero vectors fail closed. Empty evidence/assertion support is rejected. These are consistency checks on trusted L7 inputs, not authentication or proof of database existence.
8. **Families:** `AGENT`, `AGENT_VERSION`, `DATA_ELEMENT`, `PROMPT`. Same entity kind can compare canonical-object and normalized-candidate namespaces without converting either reference. Cross-kind comparisons FAIL_CLOSED. No `CONFIGURATION` kind is introduced.
9. **Agent similarity:** IMPLEMENTED for logical `AGENT` and separately temporal `AGENT_VERSION`. The caller explicitly selects the family. Version similarity is never presented as logical Agent identity; the L7 reference has no parent-Agent mapping, and L8 does not invent one.
10. **DataElement:** IMPLEMENTED_CAPABILITY_NOT_POPULATED. Both L7's canonical-object and normalized-candidate subject kinds permit DATA_ELEMENT through existing contracts. No production population was queried or created. Tests exercise isolated fixtures and an empty population; discovery remains outside this milestone.
11. **Prompt/config:** protected Prompt representations participate without raw text. Configuration similarity is IMPLEMENTED through evidence-backed non-secret technical projections of AGENT_VERSION, using the existing L7 builder/provider boundary. It compares the complete supplied projection, not a new independent configuration object or an isolated configuration-field metric. The integration fixture demonstrates a vetted `runtimeFramework` fact and L7 rejection of secret-looking configuration values. L8 accepts representations, never raw facts, Prompt text or configuration blobs. Upstream projection curation remains the trusted L7 responsibility.
12. **Metric:** COSINE only; provider-independent domain computation. No API call, LLM, new embedding provider or pgvector query.
13. **Score:** raw cosine in [-1,1]: opposite=-1, orthogonal=0, aligned=1. Independent maximum-absolute-component scaling avoids numeric overflow/underflow. Exactly aligned/opposite scaled vectors return +/-1 without an epsilon; other vectors use cosine with only range clamping for floating-point roundoff. Algorithm version `GOVIA_L8_SCALED_COSINE_V1`. No percentage, trust score or confidence conversion.
14. **PossibleMatchCandidate:** typed local analytical contract, separate from NormalizedCandidate, CanonicalObject, ReviewSubject and ReconciliationDecision. Includes organisation, family, two typed subjects, representation IDs, assertion/evidence support, semantic space, metric, raw score, algorithm, full policy, computedAt, candidateId, eligibility reason and local `ANALYTICAL` status. Allowlisted copies are frozen and exclude wider runtime metadata.
15. **Pair identity:** full SHA-256 over a domain-separated tuple containing organisation, family, sorted subject/representation endpoints, space and full policy/algorithm context. A/B equals B/A. Time and provenance are excluded. Including threshold as well as policyVersion prevents silent identity reuse when a caller changes threshold under the same version. Same representation ID or same subject key across different representation versions is excluded.
16. **Threshold:** caller-required finite inclusive cosine threshold in [-1,1] and a nonempty policy version; no default or magic threshold. Below threshold returns null, meaning no emitted hypothesis, never proof of nonidentity. At/above threshold emits an analytical hypothesis only. Policy version/threshold changes alter candidate identity.
17. **Clustering:** FOUNDATION_ONLY conservative deterministic connected components of eligible edges in one organisation/family/space/full-policy context. Full-batch validation precedes output. Rejects inconsistent edge identities, score replays and representation-to-subject bindings. Sorted subject members plus context determine cluster identity, excluding time and representation versions; sorted candidate IDs retain the supporting edge references. Duplicate edges do not change output. Empty input yields no clusters. Connected membership does not assert all pairs exceed threshold, transitive physical identity or a merge set. A cluster ID names membership/context, not immutable historical edge content.
18. **Persistence:** NOT_IMPLEMENTED, with rationale above. No migration, adapter, storage port or canonical table overload. Candidate IDs supply deterministic semantic deduplication, not a claim of durable idempotent writes or append-only history.
19. **pgvector direction:** existing L7 storage remains the sole eligible vector foundation. V1 computes exact pairwise cosine in the domain over supplied L7 representations. Database retrieval/operators are NOT_IMPLEMENTED. A future exact query must filter organisation, family and every semantic-space component before computing distance.
20. **ANN/index:** PERFORMANCE_INDEX = NOT_IMPLEMENTED. The heterogeneous, unconstrained L7 vector column remains unchanged. No HNSW/IVFFlat or per-space indexing architecture is introduced.
21. **Provenance/explainability:** candidate endpoints retain sorted/deduplicated safe assertion and evidence IDs. Eligibility, subject kind/id, representation id, full space, metric, score, threshold and algorithm/policy version explain the analytical result without exposing vectors or content. Clusters reference the candidate IDs; callers must retain the candidate snapshots alongside clusters to inspect their edge explanations.
22. **Tenancy/RLS:** comparison and clustering tenant gates IMPLEMENTED. No L8 persistence means new RLS and database reference tests are not applicable. Existing L7 organisation-scoped composite references and service-role RLS are unchanged. Request organisation must come from trusted server orchestration; this library is not an authentication boundary.
23. **Canonical authority:** ZERO. The two production modules import only `node:crypto`, L7 contract validation/types/subject-key helpers, and their local analytical module. Static dependency/invocation tests reject canonical creation, review creation/certification, reconciliation/materialization calls, database RPCs, provider calls and legacy vector reads. Final diff adds no authority integration. Scores and clusters never become VALIDATED or execute MATCH_EXISTING.
24. **L9:** NOT_IMPLEMENTED by this milestone; relationship-correlation semantics untouched. No behavior relationship added.
25. **Graph:** NOT_IMPLEMENTED by this milestone; GraphOS and graph surfaces untouched.
26. **Tests:** `npm run test:semantic` in `packages/scanner`: **108/108 passing**, including **76 new L8 cases** and 32 existing L7 cases. `npm run typecheck` in that package: clean after the final code corrections. The initial sandbox run hit tsx/esbuild `spawn EPERM`; the authorized outside-sandbox run passed. No canonical-contracts/governance-review/dashboard code changed, so those suites were not run. No migration structural tests apply. No Discovery contract changed and no Discovery Validation Lab ran. `git diff --check` and staged diff whitespace checks are clean.
27. **Adversarial review:** ONE focused pass. Three concrete defects corrected: exact multi-component alignment could round below 1 and miss threshold=1; conflicting scores for a duplicated candidate ID were silently accepted; a representation ID could bind different subjects across separate cluster edges. Added regression cases and reran only the affected semantic suite and scanner typecheck. The pass also covered all requested threat categories: tenant/space/family mixing, reversed pairs, self-match, threshold authority, VALIDATED promotion, clusters as merge sets, canonical writes, Prompt leakage, DataElement fabrication, L9 scope and premature ANN. No additional review loop was started.
28. **Limitations:** durable retention/review queue, population retrieval, automatic pair enumeration, UI/production invocation, authentication and current-representation selection are NOT_IMPLEMENTED. Caller supplies trusted L7 records and a deliberate policy. Cluster consistency validation cannot attest an untrusted score without reloading vectors; only trusted engine outputs should be supplied. L8 does not verify referenced assertion/subject existence against a database. Canonical/candidate aliases for the same physical entity are not known to the L7 reference, so only explicit subject identity self-matches can be excluded. No production embedding provider exists. Configuration comparison covers supplied technical projections, not raw config or independent config identity. IEEE-754 arithmetic is deterministic for this version but not promised bit-identical to a future pgvector implementation. Snapshots permit inspection and recomputation; they do not constitute durable audit history.
29. **Production:** NOT DEPLOYED. No live Supabase, external embedding API or production command. Merge status: NOT MERGED. Next milestone 6 (AGENTVERSION BEHAVIOR RELATIONSHIPS — L9) NOT STARTED.

## Required test-matrix coverage

| Requested cases | Verification |
|---|---|
| 1–8 | semantic-space field equality/refusal and request/representation/subject tenant tests |
| 9–12 | exact, orthogonal, opposite, non-unit, large/subnormal, replay, nonfinite/zero, no padding/truncation |
| 13–16 | symmetric output/identity, representation/subject self-match, time independence, policy identity |
| 17–22 | below/inclusive threshold, exact output fields/status and static no-authority dependency/invocation tests |
| 23–26 | separate Agent families, DATA_ELEMENT fixture capability, immutable inputs and empty population |
| 27–29 | protected Prompt fixture, nested output allowlists, L7 configuration builder/secret refusal integration |
| 30–34 | ordered/duplicate/reversed traversal, isolated components, mixed-context refusal, analytical cluster output |
| 35–40 | Not applicable: durable persistence explicitly NOT_IMPLEMENTED |
| 41–45 | static module dependency/invocation tests plus final file-scope gate; no L9, Graph, production or live API work |

## Final file scope

- `packages/scanner/src/index.ts`: additive public analytical exports.
- `packages/scanner/src/semantic/similarity.ts`: local types, compatibility, cosine and possible-match emission.
- `packages/scanner/src/semantic/possible-match-clustering.ts`: deterministic, validated analytical components.
- `packages/scanner/test/semantic/similarity-l8.test.ts`: 82 focused L8 cases after the final gate below (76 at the original feature commit).
- `docs/codex/evidence/2026-09-09-similarity-entity-resolution-candidates-l8-v1-validation.md`: this evidence.

The recovery file remains untracked and was never read, staged, hashed, modified or deleted. `.claude/**` was not inspected. Frozen architecture, Golden Repository/Validation Lab, relationship-correlation, GraphOS and production configuration are outside the changed file list. One feature commit and one PR to main; do not merge.

**Verdict:** `SIMILARITY_ENTITY_RESOLUTION_CANDIDATES_L8_V1_READY_FOR_REVIEW` for the documented domain V1 scope and explicit persistence/retrieval/production limitations.

## PR #26 final mathematical / determinism gate

Reviewed HEAD: `a48912d2e96d8a92642b394c484dc08fb9d2f5c2` on `feat/similarity-entity-resolution-candidates-l8-v1`; initial status contained only the permitted untouched recovery file. Inspection was limited to similarity.ts, possible-match-clustering.ts, similarity-l8.test.ts and this evidence. The original 108/108 result above is historical validation at that HEAD; this gate ran the focused L8 file only.

- **Zero norm — PASS, implementation unchanged:** scaling checks maximum absolute component before division, rejecting either zero vector with domain-consistent `TypeError('L8_ZERO_VECTOR')`. Explicit left-zero, right-zero and both-zero tests now exercise both comparison and candidate emission. No score is returned for zero norm.
- **Numeric bounds — PASS, implementation unchanged:** finite component checks, maximum-component scaling, a finite-result guard and final [-1,1] range clamping already exist. Exact aligned/opposite directions and orthogonal vectors yield 1/-1/0; near-boundary, non-unit, large and subnormal cases stay finite and bounded. No precision rounding rule, epsilon-based alignment, score rescaling or new algorithm version was introduced.
- **Threshold domain — PASS, implementation unchanged:** invalid/nonfinite/out-of-range thresholds are rejected. Existing upper-bound inclusion and new -1/0 equality cases prove inclusive comparison across the cosine domain. Threshold retains zero governance authority.
- **Complete A/B symmetry — PASS, implementation unchanged:** deep equality now also covers a nontrivial non-unit-vector candidate in both directions, including ordered endpoints, score, family, space, metric, policy and identity. Explicit expected endpoint references verify deterministic ordering. Reversing direction and changing only computedAt changes no semantic field or identity.
- **Self-match — PASS, implementation unchanged:** same representation ID and distinct representation IDs sharing the same subject are rejected in both directions. Representation-version comparison does not become entity resolution.
- **Cluster determinism — concrete defect fixed:** the original implementation rejected a semantically identical edge when its endpoint fields were reversed. The regression failed at the reviewed implementation with `L8_INVALID_PAIR_IDENTITY` (81/82 tests passed). Clustering now normalizes validated endpoints with the existing stable endpoint key before building the graph, while continuing to verify the symmetric content-addressed candidate ID. No identity formula changed. Full cluster deep equality proves identical members, member order, cluster identity and candidate IDs under reversed edge order, reversed endpoint orientation, reversed engine execution and duplicated identical edges. Reversed edges with forged IDs or conflicting scores still fail closed. Tenant/family/space/full-policy isolation remains enforced.
- **Persistence wording — explicit:** see the amended decision above. In-memory only; no durable analytical history, audit/review retrieval or downstream governed-history consumer. Persistence decision required before such a consumer.
- **Authority boundary — PASS:** the focused static dependency/invocation tests pass for both production modules. No canonical creation/merge, MATCH_EXISTING, certification, reconciliation/materialization, relationship, Graph or L9 behavior invocation is introduced. No LLM, live Supabase, external embedding API or production action.
- **Validation:** `node --import tsx --test --test-isolation=none test/semantic/similarity-l8.test.ts` in packages/scanner: **82/82 passing** after the correction. `npm run typecheck`: clean. Initial sandbox test attempt hit tsx/esbuild `spawn EPERM`; authorized execution reproduced the single regression before the fix and passed after it. `git diff --check`: clean. No shared Discovery production code changed; Discovery-engine regression and Validation Lab were not run. No broader suite was claimed as rerun.
- **Change scope:** possible-match-clustering.ts, similarity-l8.test.ts and this evidence only. similarity.ts remains byte-unchanged. One normal follow-up commit to PR #26; no amend, force push, merge, migration or milestone 6 work.

Final-gate verdict: **`PR26_L8_HARDENING_READY_FOR_REVIEW`**. MERGE STATUS: **NOT MERGED**.
