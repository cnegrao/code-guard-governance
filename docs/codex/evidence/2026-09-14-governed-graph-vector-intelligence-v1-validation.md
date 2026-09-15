# M12 — Governed Graph + Vector Intelligence V1

## Base gate and scope

Base main and fetched origin/main: `f44a39777bf0463b435ae7c88d9fbdc22384be72`.
Branch: `feat/governed-graph-vector-intelligence-v1`.
Architecture: `GOVIA-L0L16-CIA-v1.0`, FROZEN and unchanged.
Initial tree: only the permitted protected recovery file; never accessed or staged.
No subagents. M13 not started. Production untouched. No live Supabase, embedding or LLM API.

## Architecture A–O (recorded before implementation)

| Item | M12 boundary |
|---|---|
| A | Frozen CIA v1.0; no taxonomy or authority change |
| B | L7/L8 retrieval and L9 graph analysis; L10–L16 not implemented |
| C | Passport families unchanged; no Passport integration |
| D | Exact canonical IDs and persisted relationship intervals projected read-only |
| E | DERIVED_FROM stored target-to-source; explicit downstream reverse traversal |
| F | Decision/state and representation support identifiers; no evidence bodies |
| G | ANALYTICAL output; zero governance authority |
| H | M4 representation + M5 exact cosine/space reused |
| I | Separate governed GraphOS module; disposable in-memory read projection |
| J | Typed Copilot input; no LLM invocation or write capability |
| K | Verified session organisation; scoped reads and runtime tenant guards |
| L | No migration planned; existing L7 tables read with explicit filters |
| M | Typed analytical context for future consumers; M10/M11 unmodified |
| N | Missing relationships/population remain unknown; no inferred canonical edges |
| O | Required 50-case matrix, affected tests/typechecks, one adversarial pass |

## Reuse and legacy classification (before implementation)

| Component | Classification | Decision |
|---|---|---|
| Canonical 11-kind/12-type contracts and endpoint constraints | REUSE_AS_IS | Reuse one existing taxonomy and validator |
| canonical_objects / canonical_relationships | REUSE_AS_IS | Sole canonical read source |
| M4 SemanticRepresentation and support tables | REUSE_AS_IS | Immutable snapshots, no new vector identity |
| M5 SemanticSpaceIdentity / compareSemanticRepresentations | REUSE_AS_IS | Same-family exact cosine for AGENT, AGENT_VERSION, DATA_ELEMENT, PROMPT |
| M11 scalar select / tenant paging pattern | ADAPT | Independent intelligence reader; Passport unchanged |
| M11 verified session organisation helper | REUSE_AS_IS | Trusted server entry boundary |
| graphos types.ts, types/entities.ts, types/relationships.ts | LEGACY_COMPAT_ONLY | Open vocabulary stays outside governed projection |
| graphos engine.ts mutation, risk/confidence, topology | LEGACY_DO_NOT_EXTEND | No reuse as governed truth or traversal policy |
| graphos compat.ts, views/index.ts, existing index exports | LEGACY_COMPAT_ONLY | Existing consumers remain operational |
| Existing dashboard graph view | LEGACY_COMPAT_ONLY | No authority blending into legacy view |

## Readiness before implementation

| Item | Capability | Status |
|---|---|---|
| A | Canonical object projection | IMPLEMENTABLE |
| B | Canonical relationship projection | IMPLEMENTABLE |
| C | Temporal filtering | ADAPT_REQUIRED |
| D | Graph traversal | LEGACY_ONLY |
| E | Lineage traversal | IMPLEMENTABLE |
| F | Blast radius | LEGACY_ONLY |
| G | Canonical representation read | FOUNDATION_ONLY |
| H | Compatible-space retrieval | ADAPT_REQUIRED |
| I | Hybrid combination | IMPLEMENTABLE |
| J | Explainability | ADAPT_REQUIRED |
| K | Analytical Copilot context | FOUNDATION_ONLY |
| L | Legacy GraphOS compatibility | IMPLEMENTED |
| M | Tenant isolation | ADAPT_REQUIRED |

Production representation population: NOT_POPULATED / not verified live.
No production embedding provider exists in the M4/M5 foundation.

## Resume state (2026-09-15)

Continued the existing branch and edits after the usage-limit interruption. HEAD
remained the base SHA above. Status, branch, HEAD, ancestry, diff stat and whitespace
gate matched the expected M12 state. No reset, historical amendment, broad repository
exploration, or subagent was used. The existing evidence and implementation were
preserved. The single focused review was completed with the resume A–Q checklist.

## Final readiness

| Item | Capability | Final status / practical boundary |
|---|---|---|
| A | Canonical object projection | IMPLEMENTED; exact persisted identity |
| B | Canonical relationship projection | IMPLEMENTED; all 12 closed types, endpoint validation |
| C | Temporal filtering | IMPLEMENTED; microsecond effective intervals |
| D | Governed traversal | IMPLEMENTED; bounded, deterministic BFS witnesses |
| E | Lineage traversal | IMPLEMENTED; DERIVED_FROM upstream/downstream |
| F | Blast radius | IMPLEMENTED; narrow versioned dependency policy |
| G | Canonical representation read | IMPLEMENTED capability; production population NOT_POPULATED / unverified |
| H | Compatible-space vector retrieval | IMPLEMENTED exact scan; four existing M5 families |
| I | Hybrid combination | IMPLEMENTED; independent nullable signals |
| J | Explainability | IMPLEMENTED; canonical paths and representation metadata |
| K | Analytical Copilot | FOUNDATION_ONLY; typed context implemented, no LLM/UI consumer |
| L | Legacy GraphOS | LEGACY_ONLY; compatibility preserved and tested |
| M | Tenant isolation | IMPLEMENTED; verified-session adapter and runtime domain checks |

## Governed nodes, edges and canonical authority

`packages/graphos/governed.ts` is the opt-in public boundary. The existing package
root and legacy GraphEngine/compatibility modules remain unchanged. Governed code
does not import their open relationship vocabulary, node identity, confidence or
risk formulas. No legacy contribution enters the governed output.

`projectCanonicalGraph` consumes scalar rows sourced from `canonical_objects` and
`canonical_relationships` only. The adapter never reads Discovery candidates,
PossibleMatch, legacy graph tables, imported proposals or source envelopes.
The domain expects trusted canonical persistence input; its source tag and runtime
validation are consistency checks, not an authentication mechanism or proof that
an arbitrary caller-supplied row came from a database.

Nodes preserve organisationId, canonicalObjectId, canonicalObjectKind, creating
decision ID, creation time and revision. Projection IDs are deterministic JSON
tuples of versioned namespace + organisation + canonicalObjectId. Display names,
paths, candidate IDs, evidence IDs and embeddings do not select canonical identity.

Edges preserve canonical relationship ID, state ID, organisation, exact endpoints,
closed type, validFrom/validTo, recordedAt, revision and creating decision ID.
`hasCanonicalRelationshipEndpoints` is a new read-only predicate over the existing
private canonical endpoint constraints; no taxonomy or factory behavior changed.
Unknown kinds/types, invalid endpoints, missing endpoints, duplicate identities
and foreign rows fail closed. No source-kind relaxation for AGENT behavior bindings.

The graph is frozen and disposable. Traversal/retrieval accept only a graph produced
by the projector in the current process (WeakSet identity check), and verify its
tenant. Deserialized or forged graph objects must be rebuilt from canonical reads.
No graph store, cache, canonical write port or new system of record was added.

## Temporal filtering and stored direction

An edge is eligible exactly when `valid_from <= asOf < valid_to`, with a null end
unbounded. Future starts and expired ends are excluded; scheduled future ends remain
visible. Malformed/empty/reversed intervals fail closed. Objects created after asOf
are excluded, along with edges touching them. PostgreSQL microsecond timestamp
precision is preserved with internal integer arithmetic; supported input timestamps
use explicit time zones and at most six fractional digits. Internal BigInt values
never enter the serialized output. Calendar rollover dates are rejected.

This is effective-time filtering of rows currently persisted, not a transaction-wide
historical knowledge snapshot. recordedAt is retained and does not become a guessed
effective time. There is no newest-row, implicit closure, supersession or AgentVersion
selection rule. Existing M7 persistence/materialization remains authoritative.

Stored edges stay directed: AGENT_VERSION → resource; derived TARGET → SOURCE.
Analytical traversal records its own direction separately and never changes or
persists the stored edge direction.

## Traversal, lineage and blast-radius policy

| Policy | Eligible types | Analytical traversal |
|---|---|---|
| GOVIA_NEIGHBORHOOD_V1 | All validated canonical types | Both directions for topology context only |
| GOVIA_LINEAGE_UPSTREAM_V1 | DERIVED_FROM | Stored forward: derived target toward source |
| GOVIA_LINEAGE_DOWNSTREAM_V1 | DERIVED_FROM | Stored reverse: source toward derived target |
| GOVIA_BLAST_RADIUS_V1 | DERIVED_FROM | Stored reverse: changed source toward derived consumers |
| GOVIA_BLAST_RADIUS_V1 | READS_FROM | Stored reverse: changed data toward reading AgentVersion |
| GOVIA_BLAST_RADIUS_V1 | USES_MODEL, USES_TOOL, USES_MCP, INVOKES, USES_PROMPT, USES_KNOWLEDGE_BASE, USES_SKILL | Stored reverse: changed resource toward declared consuming AgentVersion |

WRITES_TO, EXPOSES and HANDOFF_TO do not propagate blast radius in V1. A canonical
connection alone is not sufficient evidence of impact. Future policies require
explicit semantic justification. No legacy types participate.

BFS sorts by canonical relationship ID, tracks visited canonical objects, excludes
the seed from impacted results and accepts an integer depth from 0 to 16. Each
reached object returns one deterministic shortest witness path. Cycles and diamonds
terminate without duplicate impacted nodes. Each step retains the entire safe
projected edge, actual stored source/target, traversal direction and hop; each result
retains hop count and policy version. This is not exhaustive path enumeration or a
prediction that an Agent actually fails at runtime.

M9 DERIVED_FROM enters only after canonicalization. READS_FROM/WRITES_TO discovery
remains BLOCKED_AGENT_BINDING where no real AgentVersion binding exists. Tests using
canonical access fixtures prove the read contract, not production population. No
missing data-access edges or implicit AGENT-to-AGENT_VERSION edges are fabricated.

## Vector foundation, exact anchor and representation preservation

M4 SemanticRepresentation, provider metadata, fingerprints and provenance tables
are reused unchanged. M5 `SemanticSpaceIdentity`, `semanticSpaceIdentity`,
`semanticSpaceKey`, `snapshotEndpoint`, and `compareSemanticRepresentations` supply
the existing space and cosine semantics. Only the pure similarity module is imported,
not the scanner pipeline/barrel or any embedding provider.

Supported comparison families remain AGENT, AGENT_VERSION, DATA_ELEMENT and PROMPT;
comparisons are same-family. Graph projection supports all eleven canonical kinds.
Embedding is never a canonical kind, object identifier, current-version selector or
governance fact. No live embedding provider or API is added or invoked.

The caller explicitly supplies the canonical seed, exact anchor representation ID,
asOf, maxDepth and minimumCosine, or explicitly requests graph-only context. An absent,
ambiguous, foreign, candidate-backed or wrong-seed anchor fails closed. Duplicate
representation IDs fail; no first/newest/current representation is selected. All
compatible neighbor snapshots remain representation-level results, even when several
refer to the same canonical object. Same-seed representations are excluded as self
matches using the M5 subject semantics.

Each anchor/neighbor explanation preserves exact representation ID, subject class,
canonical subject, full fingerprint tuple (algorithm/schemaVersion/value), generatedAt,
assertion/evidence identifiers and full semantic space. Vector results add raw cosine,
COSINE metric and `GOVIA_L8_SCALED_COSINE_V1` algorithm version. Fingerprints and
generatedAt describe immutable snapshots, not current or as-of embeddings.

## Semantic compatibility and tenant-before-cosine proof

Compatibility requires all five fields: projectionSchemaVersion, providerId, modelId,
modelVersion and dimension. Equal dimensions alone are insufficient. Other spaces
and families are filtered out, and direct M5 comparison still rejects incompatible
spaces. Eligible vectors are revalidated for dimension, finite components, nonzero
norm and support. Even an isolated zero-vector anchor fails closed.

The server entry obtains organisation from the existing verified-session helper
`passportOrganisation`. Request parameters cannot select the tenant. The reader
applies organisation equality to every database select, including support junctions,
and rejects any returned foreign row. Its neighbor query includes organisation,
CANONICAL_OBJECT subject class, supported same-family kind and all five space filters
before retrieving the candidate vectors for calculation. The domain checks the
tenant of every representation and nested subject before any comparison, then
filters authority class/family/space before invoking cosine.

Domain tests reject foreign representations even when otherwise ineligible.
Adapter tests inspect every filter, exercise each incompatible space independently,
exclude candidates, reject foreign rows on every table, and show spoofed organisation
parameters cannot override the session. Existing session tests verify forged/expired
cookies, missing org/secret and the development fallback secret fail closed.

NORMALIZED_CANDIDATE is permitted only by the unchanged M4/M5 analytical foundation;
it is excluded from primary M12 canonical retrieval. Candidate anchors fail. No
canonical/candidate authority blending or new candidate workflow was introduced.

## Exact retrieval, hybrid signals, ordering and Copilot context

`GOVIA_CANONICAL_EXACT_REPRESENTATIONS_V1` scans all returned eligible snapshots;
minimumCosine is an explicit inclusive threshold in [-1, 1]. No ANN or vector-read
RPC is required. Zero qualifying results means unknown/no qualifying analytical
signal, never proof of nonidentity or absence of dependency.

Vector presentation order is raw cosine descending, then representation ID ascending.
Hybrid presentation order is this vector order followed by remaining graph-only
nodes in deterministic BFS/edge-ID order. Both order policies are explicit output
fields. They only order presentation; neither reorders canonical topology nor
assigns trust/confidence. There is no weighted or blended governance score.

Each `HybridResult` declares CANONICAL_OBJECT and ANALYTICAL, plus GRAPH_ONLY,
VECTOR_ONLY or GRAPH_AND_VECTOR. Graph and vector contributions remain separate,
nullable and independently explainable. Multiple representations produce separate
hybrid rows; graph-only nodes appear once. Similarity is a typed analytical result,
never a SIMILAR_TO canonical edge or a persisted overlay.

`AnalyticalCopilotContext` contains the canonical seed, neighborhood, exact vector
anchor/neighbors, upstream/downstream lineage, blast radius, explanations, authority
labels, provenance identifiers and explicit limitations. Its schema is
`GOVIA_ANALYTICAL_COPILOT_CONTEXT_V1`. No LLM is invoked. Graph, Vector, Hybrid and
LLM all have zero canonical write/identity/reconciliation authority. No output
certifies a ReviewSubject, promotes trust to VALIDATED or executes CREATE_NEW/MATCH_EXISTING.

## Read-only integration, M10/M11 and persistence

Authenticated server entry: `apps/dashboard/lib/governance/intelligence-query.ts`,
`getGovernedIntelligence({ seedCanonicalObjectId, asOf, maxDepth, vectorQuery })`.
`vectorQuery` is null or `{ anchorRepresentationId, minimumCosine }`.
It is an implemented server query capability; no public route, UI or automatic
Copilot consumer is claimed. Existing legacy graph UI remains compatibility-only.

The server-only adapter uses scalar select/eq/order/range queries with exact counts.
Stable pages contain at most 200 rows, with a 10,000-row limit per table query that
fails closed rather than truncating. Missing/inconsistent counts, count changes
during paging and server-imposed short pages fail. Exact count checking catches
population-size changes, but is not a transaction-wide snapshot guarantee.

Only canonical_objects, canonical_relationships, semantic_representations,
semantic_representation_assertions and semantic_representation_evidence are read.
The adapter has no insert/update/delete/upsert/RPC path. Tests supply a mock store
without usable write methods. No unrestricted evidence bodies, raw Prompt plaintext,
source/vendor payloads or credentials are selected or included in explanations.
Identifier fields remain trusted persisted references; this does not claim a generic
secret scanner over arbitrary caller-crafted identifiers.

M10 field-level authority and M11 Passport values/UNKNOWN/version selection are
unchanged. No imported proposal, field state, Passport fact or authority policy is
rewritten or recomputed. M5 math and M7/M9 materialization contracts are unchanged.
The only canonical-contract addition is the pure endpoint-validation predicate.

No new migration, index, graph table, vector table, outbox/event consumer, durable
analytical history or external API was added. PostgreSQL/Supabase remains the sole
canonical system of record. The Supabase skill was used for the read adapter;
public changelog and [select documentation](https://supabase.com/docs/reference/javascript/select)
were consulted. Database tests were local mocks only; no live execution is claimed.

## Focused validation results

| Command / suite | Result |
|---|---|
| `npm run test:governed --workspace=@council/graphos` | 50 passed |
| Dashboard `node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/intelligence-query.test.ts` | 17 passed |
| `npm run test:semantic --workspace=@council/scanner` | 114 passed, unchanged M4/M5 regression |
| `npm test --workspace=@council/canonical-contracts` | 112 passed |
| Dashboard `tests/passport-query.test.ts` with the same Node flags | 47 passed, includes M9 access and M10 authority regressions |
| `npm run test:passport-ui --workspace=codeguard-os` | 14 passed, includes reused verified-session boundary |
| `npm run test:graphos -- --runInBand --runTestsByPath tests/graphos-engine.test.ts` | 19 passed, legacy compatibility |
| `npm run typecheck --workspace=@council/graphos` | PASS, includes new public entry and tests |
| `npm run typecheck --workspace=@council/canonical-contracts` | PASS |
| `npm run typecheck:dashboard -- --incremental false` | PASS |
| `git diff --check` | PASS |

Total: **373 passing tests** across the affected suites. Sandbox Node/esbuild spawn
EPERM attempts were retried with approved escalation and passed; they were environment
restrictions, not product test failures. The typecheck-generated tracked cache was
restored before the resume; subsequent checks disabled incremental output. No current
implementation edits were discarded on resume. No Validation Lab, unrelated scanner,
production, live Supabase, LLM or external embedding suite ran.

### Required initial 50-item acceptance matrix

| Requested items | Verification |
|---|---|
| 1–10 canonical projection/identity/tenancy | Numbered domain cases 01–10, all 11 kinds/12 types, adapter tenant cases |
| 11–13 temporal boundaries | Numbered 11–13 plus microsecond/timezone/calendar regression and adapter intervals |
| 14–23 vector/authority | Numbered 14–23, M5 regression, adapter full-space and authority filters |
| 24–29 hybrid | Numbered 24–29, explicit ordering and shuffled-input replay |
| 30–36 lineage/blast radius | Numbered 30–36: stored vs traversal direction, cycle, depth, exact witness, unsupported types |
| 37–42 explanations/security | Numbered 37–42 plus adapter metadata and serialization assertions |
| 43–48 authority/continuity | Domain dependency/immutability cases and adapter no-write store; M10/M11 regressions |
| 49–50 legacy | Numbered 49–50 and 19 existing GraphEngine tests; original legacy source unchanged |

## Single focused adversarial review — completed

One focused pass, continued across the interruption; no second broad audit.
Concrete corrections: Date.parse would have lost PostgreSQL microseconds and could
normalize invalid dates; incomplete server pages could have looked like a complete
exact population; representation explanations omitted the fingerprint/generatedAt
context. These were corrected and covered by regression assertions. Presentation
ordering was also made explicit in the typed context. Only affected tests were rerun.

| Resume check | Outcome |
|---|---|
| A foreign vectors scored before filtering | Tenant guard and database filters precede comparison; rejected in tests |
| B incompatible spaces | All five fields filtered; M5 comparison independently rejects mismatches |
| C zero vectors | Reject anchor/neighbor; finite and dimension checks preserved |
| D ambiguous anchor | Exact ID required; duplicates/missing/wrong-seed fail |
| E future/expired edge | Half-open microsecond intervals; no newest guessing |
| F pre-canonical edge | Canonical tables only; candidate/PossibleMatch rejected |
| G directed edges as symmetric truth | Stored direction retained; analytical direction explicit |
| H cycles/unbounded traversal | Visited set, shortest deterministic witnesses, depth 0–16 |
| I unsupported propagation | Explicit narrow policy; WRITES_TO/EXPOSES/HANDOFF_TO excluded |
| J legacy authority | Separate opt-in module; no legacy engine dependency |
| K opaque authority score | No combined score; independent signals and presentation ordering |
| L vector as identity | Representation-level analytical output; no merge/reconciliation |
| M adapter writes | Select-only adapter, no write/RPC invocation |
| N lost metadata | Fingerprint/generatedAt corrected; exact ID/space/support retained |
| O unexplained inclusion | Every graph result has witness path; every vector result exact representation |
| P Passport UNKNOWN filled | No Passport mutation/integration; existing regressions pass |
| Q canonical tenant leakage | Every table and domain node/edge scoped; foreign rows rejected |

## Known limitations and production status

- Capability is implemented, but production embeddings are NOT_POPULATED / not
  verified. No production provider, automatic population, deployment or live test.
- Vector scope is the four M5 same-kind families. Canonical-only M12 retrieval does
  not offer a candidate workflow, cross-kind similarity, current embedding selection
  or as-of embedding reconstruction.
- Graph reads reflect currently persisted effective state, not historical knowledge.
  Separate reads are not an atomic database snapshot. Concurrent same-count changes
  are not detected by count checking; callers must not treat results as audit truth.
- Exact reads are limited to 10,000 rows per table query; large/short/inconsistent
  reads fail. Support hydration is per representation. Traversal scans in-memory
  edges per reached node. No production-scale performance or ANN claim is made.
- One shortest witness per node, not all paths. Blast radius is declared dependency
  analysis, not risk materialization or actual runtime-failure prediction.
- Missing binding/evidence/topology remains unknown. No implicit Agent-version edge,
  data access, human approval, trust promotion or governance fact is fabricated.
- Existing graph UI is legacy. New typed authenticated query/public governed package
  entry are ready for future read consumers; UI/LLM consumption and durable analytical
  audit retention remain outside this milestone.

**MERGE STATUS = NOT MERGED. PRODUCTION STATUS = UNTOUCHED.**
**NEXT MILESTONE = 13 NOT STARTED.**

## Files and delivery scope

- `packages/graphos/governed.ts` — opt-in public entry.
- `packages/graphos/src/governed/{index,graph,traversal,retrieval}.ts` — canonical
  projection, traversal, exact vectors and typed analytical context.
- `packages/graphos/test/governed.test.ts` — domain/security/compatibility acceptance.
- `packages/graphos/package.json`, `packages/graphos/tsconfig.json`, `package-lock.json`
  — existing workspace dependencies, test script and typecheck scope; no new external dependency.
- `packages/canonical-contracts/src/contracts.ts` — read-only closed-endpoint predicate.
- `apps/dashboard/lib/governance/intelligence-{read-store,query}.ts` — authenticated
  select-only canonical/semantic adapter and query.
- `apps/dashboard/tests/intelligence-query.test.ts` — local integration mocks.
- This evidence document.

One feature commit is intended: `feat(intelligence): add governed graph vector retrieval`.
PR targets main on the existing M12 branch. No merge or M13 execution is authorized.

## PR #33 external package-boundary gate (2026-09-15)

Reviewed HEAD before this surgical gate:
`b4e499b8abb6de1df224df0a57c522d8a232c058`. Branch and working tree matched the
expected state; only the protected recovery file was untracked and remained untouched.

The external finding was confirmed: GraphOS production and governed tests imported
M5 through relative sibling-package `scanner/src` paths. The dashboard's preferred
`@council/scanner/semantic/similarity` spelling worked through a TypeScript path
alias, but the scanner package did not actually export that subpath; plain Node
resolution returned MODULE_NOT_FOUND before the correction.

The scanner package now explicitly exports `./semantic/similarity` to its existing
M5 implementation and preserves its root export at `./src/index.ts`. GraphOS
production and tests both import `@council/scanner/semantic/similarity`. No GraphOS
path alias was added: package resolution supplies compareSemanticRepresentations,
semanticSpaceIdentity, semanticSpaceKey, snapshotEndpoint, SemanticComparisonFamily,
SemanticSpaceIdentity, SimilarityEndpoint and COSINE_ALGORITHM_VERSION. Node
`require.resolve` verifies both the package root and semantic subpath resolve.

Dependency direction: **GraphOS → declared @council/scanner package export → M5
semantic capability**. M5 remains the sole owner of comparison validation, semantic
space, similarity endpoints and cosine. No algorithm moved, changed or was duplicated.
The test change is import-only; test semantics remain unchanged.

Focused validation after correction:

- GraphOS governed tests: **50 passed**.
- Scanner semantic tests (export surface changed): **114 passed**.
- Dashboard intelligence tests: **17 passed**.
- GraphOS typecheck: **PASS**.
- Dashboard typecheck with incremental output disabled: **PASS**.
- `git diff --check`: **PASS**.

These **181 affected tests** preserve exact anchors, five-component spaces,
tenant-before-cosine, zero-vector rejection, raw [-1,1] cosine, canonical-only
results, immutable representation metadata, independent hybrid signals and
ANALYTICAL authority. The earlier 373-test milestone validation remains recorded
above; it was not rerun in full for this gate.

Only scanner package exports, the two GraphOS import statements and this evidence
changed. Temporal behavior, blast-radius/direction policies, M5/M7/M9/M10/M11
semantics, canonical contracts/persistence, migrations and production configuration
remain unchanged. One follow-up commit; no amendment or force push.

**MERGE STATUS = NOT MERGED. PRODUCTION STATUS = UNTOUCHED. M13 NOT STARTED.**
