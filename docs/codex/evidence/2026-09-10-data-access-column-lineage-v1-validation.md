# Milestone 9 — Data Access & Column Lineage V1

Current external gate status: **PR30_M9_HARDENING_READY_FOR_REVIEW**. The
2026-09-11 support-evolution gate below supersedes the original immutable-candidate
conflict limitation; original implementation/validation history is preserved.

## Base and pre-implementation gate

Base main = origin/main = `c806782fff8bdb8b81fdf01ace8eeffef4ab1c06` after fetch.
Branch: `feat/data-access-column-lineage-v1`. Only the permitted protected recovery
entry was untracked. It was not inspected or operated on. No `.claude/**` inspection.
No subagents. Architecture `GOVIA-L0L16-CIA-v1.0` remains FROZEN.

## A–O mapping recorded before implementation

| Item | Impact |
| --- | --- |
| A CIA baseline | Frozen taxonomy and invariants unchanged |
| B L0–L16 | L3 strict SQL structure; L9 column relationships/provenance; reuse L0 acquisition and L14 review. No L12 observation; other layers unchanged |
| C Passport | Future inputs for families 9, 11, 14; no Passport UI |
| D Canonical | Existing DATA_ELEMENT/DERIVED_FROM only; candidates, no truth writes |
| E Lineage | Target element DERIVED_FROM source element, explicit positional projection |
| F Evidence/provenance | Existing Evidence/SourceAssertion, artifact snapshot, parsed statement fingerprint, detector method/version |
| G Trust/authority | DECLARED, UNREVIEWED, requires reconciliation; machine ceiling PROPOSED |
| H Vector | No embeddings, similarity, identity or merge authority |
| I Graph | Future downstream consumer only; no projection |
| J LLM | No parsing, inference or canonical authority |
| K Tenancy/security | Trusted intake organisation/connection; no raw defaults or comment secrets |
| L Migration | None planned; existing candidate/support persistence |
| M Downstream continuity | Existing relationship normalization, intake/review and M7 exact object mapping |
| N Non-fabrication | Missing/ambiguous endpoints, binding or transformation evidence fail closed |
| O Acceptance | Requested focused positive/negative/identity/evidence/intake tests, one adversarial pass, affected typechecks and diff check |

## Contract-first reuse map

| Component | Classification | Decision |
| --- | --- | --- |
| Closed endpoint rules, normalized relationship envelope | REUSE_AS_IS | DATA_ELEMENT → DATA_ELEMENT already allowed |
| Relationship correlation/normalization | ADAPT | Extend existing strategy; share envelope assembly; preserve behavior branch |
| Evidence assembly | ADAPT | Retain snapshot-specific transformation support using existing structures |
| M8 lexer, statement boundaries, effective identifiers | ADAPT | Reuse grammar primitives for strict INSERT SELECT |
| M8 data object/parent normalization | REUSE_AS_IS | Exact normalized current-scan inventory |
| M7 exact normalized object mapping/review | REUSE_AS_IS | Exact CANDIDATE endpoints; governance remains downstream |
| Intake orchestration | ADAPT | Register transformation specification; persist support before relationship review |
| AgentVersion correlation/direct behavior binding | REUSE_AS_IS | Direct property binding exists only for MODEL/TOOL; no SQL access binding |
| Explicit AgentVersion-to-SQL/access binding | NOT_PRESENT | No new heuristic allowed |
| Legacy query/name/proximity heuristics | LEGACY_DO_NOT_EXTEND | Not evidence of access ownership or lineage |

## Readiness before implementation

| Family | Source evidence | Target discovery/resolution | AgentVersion binding | Transformation | Normalization | Intake/review | M7 | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A DATA_ASSET READS_FROM | SQL references possible; ownership absent | M8 exact assets available | Absent | Not ownership proof | Existing contract | Existing foundation | Compatible | BLOCKED_AGENT_BINDING |
| B DATA_ELEMENT READS_FROM | SQL references possible; ownership absent | M8 exact elements/parents available | Absent | Not ownership proof | Existing contract | Existing foundation | Compatible | BLOCKED_AGENT_BINDING |
| C DATA_ASSET WRITES_TO | SQL target possible; ownership absent | M8 exact assets available | Absent | Not ownership proof | Existing contract | Existing foundation | Compatible | BLOCKED_AGENT_BINDING |
| D DATA_ELEMENT WRITES_TO | SQL targets possible; ownership absent | M8 exact elements/parents available | Absent | Not ownership proof | Existing contract | Existing foundation | Compatible | BLOCKED_AGENT_BINDING |
| E DATA_ELEMENT DERIVED_FROM | Explicit INSERT SELECT source family | Exact scan inventory; fail on 0 or multiple matches | Not required | Narrow parser extension authorized | Existing envelope can be reused | Adapt support intake | Exact endpoints compatible | IMPLEMENTABLE |

## Final readiness and supported transformation family

| Family | Final status | Scope |
| --- | --- | --- |
| A DATA_ASSET READS_FROM | BLOCKED_AGENT_BINDING | Zero access relationships |
| B DATA_ELEMENT READS_FROM | BLOCKED_AGENT_BINDING | Zero access relationships |
| C DATA_ASSET WRITES_TO | BLOCKED_AGENT_BINDING | Zero access relationships |
| D DATA_ELEMENT WRITES_TO | BLOCKED_AGENT_BINDING | Zero access relationships |
| E DATA_ELEMENT DERIVED_FROM | IMPLEMENTED | Strict static SQL direct projection, exact normalized endpoints, durable statement support, existing normalization/review/M7 compatibility |

Only `INSERT INTO target (a,b) SELECT source.x,source.y FROM source;` and its
bounded equivalents are supported. Source columns may be unqualified, qualified
by the exact table's final name component, or by one explicit source alias
(`FROM source s` / `FROM source AS s`). An alias hides the original qualifier.
Tables support one or two identifier components. M8 PostgreSQL effective
identifiers are reused unchanged: unquoted folding, quoted lowercase equivalence,
quoted case preservation, embedded dots and doubled quotes.

Target columns must be explicit, unique and match the SELECT count exactly.
Every projection is a direct column reference; the entire statement must parse
and resolve before any of its pairs can emit. Semicolon termination, balanced
statements, bounded lexing and lowercase `.sql` extension follow M8. No default
schema/catalog/search path is supplied; unqualified and qualified names are not
interchanged. Three-component SELECT column references remain unsupported.

Wildcards, missing target list, JOIN, multiple source tables, CTE, set operations,
subqueries, lateral, grouping, HAVING, windows, aggregates, functions, arithmetic,
CASE, casts, WHERE and trailing clauses fail closed. UPDATE/DELETE/MERGE/upsert,
VALUES, CTAS, views, stored routines and dynamic SQL are not lineage sources.
Artifacts containing CREATE [OR REPLACE] FUNCTION/PROCEDURE or DO are rejected
for transformation discovery, including otherwise supported adjacent statements:
the V1 parser does not model SQL-standard unquoted routine body scope.
Lexical errors/unbalanced or unterminated statements fail the artifact.

## AgentVersion access binding

The current producer in `evidence-assembly.ts` attaches direct behavior binding
only for MODEL and TOOL specifications. `relationship-correlation.ts` validates
those direct properties against the specific evidenced AgentVersion; its closed
behavior dispatch remains USES_MODEL/USES_TOOL. Neither SQL data declarations
nor transformation matches carry AgentVersion ownership evidence.

SQL and an AgentVersion in the same repository/directory therefore produce no
READS_FROM or WRITES_TO. No logical AGENT access source, filename/neighbor
heuristic, new ownership convention or repository-wide fan-out was introduced.
Absence is **BLOCKED_AGENT_BINDING**, not a false assertion that access never occurs.

## Exact endpoint resolution and direction

Correlation uses only the current scan and its trusted connection. For each
SQL effective table reference, it requires exactly one asset declaration and
one valid normalized DATA_ASSET. The column must have exactly one declaration
under that source-scoped asset and one valid normalized DATA_ELEMENT with the
same exact candidate parent. Counts precede evidence filtering, so an invalid
duplicate cannot disappear and authorize first-match selection.

M8 object normalization still proves the element's declaration statement,
snapshot and exact parent; it is unchanged. Assets may be declared in another
SQL file. Multiple pre-canonical owners across files fail closed instead of
being merged. Missing either asset or any column suppresses the whole mapping
statement, including otherwise resolvable sibling pairs.

The existing normalized relationship envelope contains exact `CANDIDATE`
references to both DATA_ELEMENT rows. Its source endpoint is the **target**
column and its target endpoint is the **source** column:
`target.a --DERIVED_FROM--> source.x`. No asset-grain DERIVED_FROM or new type.

## Transformation provenance, evidence and trust

The SQL specification produces scanner-only typed transformation bindings.
They are not a new canonical object, generic JSON truth or separate lineage
storage. Existing Evidence/SourceAssertion carry the durable proof:

- Source artifact path and real statement line span.
- Source snapshot identity and SHA-256 artifact hash.
- Full accepted statement token projection in `redactedExcerpt`, including both
  assets and explicit positional column lists; comments/default values excluded.
- Statement fingerprint: SHA-256 of `JSON.stringify(tokens.map(t => [t.kind,
  t.raw]))`, retained as an additional existing Evidence hash. The snapshot hash
  is separately identified by SourceAssertion.snapshot.contentHash. Fingerprint
  can also be reproduced from the safe excerpt under the recorded parser version.
- Method `sql-insert-select-column-lineage`, version `1.0.0`.
- Relationship support union: transformation assertion/evidence plus both exact
  element and parent-asset supports. Correlation reparses the excerpt and requires
  matching fingerprint and all pairs; endpoint existence alone is insufficient.

Evidence/assertion row identities include snapshot hash and statement fingerprint;
changes create new support rather than overwriting historical content. Static
assertions are **DECLARED**, never OBSERVED or VALIDATED. The inherited field
name `observedAt` timestamps capture, not runtime trust. Findings are UNREVIEWED,
require review, and create no canonical object. Normalized candidates require
reconciliation; integration tests reach **PROPOSED** through existing policy only.

## Relationship identity, replay, duplicates and temporal limits

The existing relationship normalization envelope is factored into a shared helper
used by behavior and lineage correlation. Behavior identity inputs are unchanged.
Lineage suffix is SHA-256 (first 32 hex characters) over the explicit version tag,
trusted organisation, DERIVED_FROM, transformation source scope, and directed
endpoint semantic tuples. Each tuple contains exact parent source scope,
M8 effective asset sourceReference and effective elementPath. These are the M7
element identity components; no endpoint row ID, line, timestamp, assertion ID,
evidence ID, ordinal, random value or similarity defines the semantic edge.
The normalized endpoint references still point to the exact current rows.

Identical replay retains candidate identity and creates no duplicate review.
Whitespace/comment/line movement in declarations or transformations does not
change semantic edge identity. Alias/text changes with the same endpoints retain
identity while producing traceable new statement/snapshot support. Endpoint or
source-scope changes alter identity. Repeated same-scope mappings deduplicate with
sorted union of every supporting assertion/evidence; different directed mappings
remain separate, without confidence-based conflict collapse.

**Existing lifecycle limitation, exercised in intake:** a changed support envelope
for the same semantic candidate ID is rejected with the existing immutable
candidate conflict. New Evidence/SourceAssertion remain durable and traceable;
the old relationship candidate/review is not silently modified. The intake run
reports failure (FAILED in the tested rescan with no newly created successful
outcomes; otherwise its existing partial-success policy applies). This milestone
does not invent candidate revision replacement, automatic supersession or temporal
closure. Scanner discovery of the changed snapshot remains deterministic.

## Tenancy, M7 and M8 continuity

Trusted intake organisation scopes acquisition, evidence, assertions, candidates,
review and exact durable endpoint lookups. Missing context or a foreign connection
fails correlation; a foreign tenant's durable element cannot back review. Scanner
metadata is not authentication. These are local fake-port proofs, not live RLS tests.

Intake registers the SQL transformation specification and durably records its
support before relationship review. Raw statement matches do not become object
candidates or independent review subjects. Existing object ordering preserves
asset-before-element durability. Existing relationship intake requires both exact
endpoint candidates; support persistence failure cannot create a review.

Normalized candidate rehydration and reconciliation input recovery return the
existing RELATIONSHIP_INPUT_AVAILABLE result. M7 endpoint kinds, exact normalized
object mapping and directed canonical relationship lookup are compatible without
contract, domain, migration or resolver changes. Endpoints must be governed first;
later human-governed Decision-to-Truth is outside discovery. No reconciliation,
CREATE_NEW/MATCH_EXISTING action, certification or materialization is invoked.

M8 effective identity, declaration evidence, parent semantics, normalized object
IDs and existing data review/mapping tests remain unchanged. L9 USES_MODEL and
USES_TOOL keep their behavior and identity. USES_MCP/INVOKES/USES_PROMPT/
USES_KNOWLEDGE_BASE/USES_SKILL remain blocked by their previous binding gaps.

## Graph, Vector, LLM and downstream boundaries

No Graph implementation or writes; GraphOS remains a future downstream consumer.
PostgreSQL/Supabase remains the canonical SoR. No Vector/embedding/similarity,
LLM inference, external model call or runtime observation. Passport UI, exchange,
outbox consumers and milestone 10 are not implemented here. Frozen architecture
documents, existing migrations, dependencies and lockfiles are unchanged.

## Final affected validation

| Check | Result |
| --- | --- |
| Scanner sql-column-lineage.test.ts | 64 passed |
| Scanner sql-data-discovery.test.ts | 77 passed |
| Scanner relationship-correlation.test.ts | 42 passed |
| Scanner object-candidate-normalization.test.ts | 25 passed |
| Scanner agent-version-correlation.test.ts | 22 passed |
| Dashboard discovery-intake-service.test.ts | 51 passed (5 new M9 + 46 existing) |
| Root npm run typecheck:scanner | Passed |
| Scanner npm run typecheck:discovery-engine | Passed, including tests |
| Root npm run typecheck:dashboard -- --incremental false | Passed |
| git diff --check | Passed; delivery repeats whitespace check |

Total **281 distinct passing tests**, three affected typechecks. Scanner tests
ran with `node --import tsx --test` and the five named discovery-engine files;
the final run used `--test-reporter=dot`. Dashboard ran with `node
--conditions=react-server --experimental-test-module-mocks --import tsx --test
tests/discovery-intake-service.test.ts`, using fake persistence and throwing
canonical/authorization/reconciliation ports. Initial sandbox spawn EPERM was
resolved through approved local test execution outside the sandbox.

Intermediate fixes: updated the historical static test that explicitly prohibited
DERIVED_FROM before M9; exported the new specification through the scanner's root
barrel; corrected the immutable-conflict test to the existing FAILED run outcome.
No unresolved test failure. No Validation Lab/golden changes or execution,
canonical/governance suite rerun, migration execution, live Supabase, production
or external application API calls. Git/GitHub operations serve requested delivery.

Acceptance accounting: cases 1–20 use the SQL positive/strict-negative/endpoint
matrix; 21–27 use statement/snapshot/method/trust/support mutation tests and real
intake support ordering; 28–32 use deterministic replay/movement/alias/changed
endpoint/support tests; 33–37 use real AgentVersion plus same-directory SQL with
zero access output. Cases 38–40 are not applicable (no direct access binding).
Cases 41–44 use shared normalization, rehydration, proposed review, M7 identity
and input recovery plus forbidden write ports. Cases 45–50 use existing L9
regressions, the focused diff review and unchanged authority/scope boundaries.

## One focused adversarial pass

Exactly one manual pass, no subagents and no second broad audit. Checked requested
A–O: direction; wildcard/count handling; alias/table identity; cross-asset columns;
missing/ambiguous endpoints; AgentVersion co-presence and AGENT prohibition;
static trust; line-independent identity; durable transformation support;
canonical/Graph boundary; unsupported SQL.

Concrete corrections from this pass:

1. Count same-parent element declarations before validity filtering, so a duplicate
   with stripped evidence cannot leave one apparently unique normalized endpoint.
2. Reject routine-containing transformation artifacts because unquoted BEGIN ATOMIC
   bodies can contain semicolons and otherwise expose an inner INSERT as top-level.
3. Require an explicit snapshot ID, SHA-256 snapshot algorithm and file source type
   for transformation correlation. Negative regressions cover missing snapshot ID.

All affected regressions passed after these corrections. No taxonomy/authority
architecture decision was required. The immutable-candidate lifecycle limitation
above is retained explicitly rather than adding unapproved temporal policy.

## Files, delivery and production

Eleven milestone files: scanner SQL parser/specification, detection match type,
evidence assembly, relationship correlation, both export barrels; new SQL lineage
tests and existing relationship regression; dashboard intake and its tests; this
evidence. No production configuration, dependency, migration or frozen baseline edit.

Delivery: one feature commit `feat(lineage): add data access and column lineage v1`,
normal push to `feat/data-access-column-lineage-v1`, one PR against main. The final
handoff records actual commit/PR identifiers. **NOT MERGED**. Production **UNTOUCHED**.
Next milestone **10 — MULTIVENDOR EXCHANGE MVP V1 — NOT STARTED**.

Verdict: **DATA_ACCESS_COLUMN_LINEAGE_V1_READY_FOR_REVIEW**.

## PR30 support-evolution gate — pre-edit persistence inspection

Gate base: `e926584577b794e3873d1badc2facd44e77e892a`, expected branch;
only the protected untracked recovery entry. No parser change or milestone restart.
The external finding is accepted: the original immutable-candidate conflict
limitation above does not satisfy observation/provenance continuity.

REUSE_AS_IS: immutable Evidence, SourceAssertion, DiscoveryFinding and their
tenant-scoped support junctions; original candidate envelope and M7 review input.
ADAPT: intake persistence with a narrow additive candidate-to-observation-finding
junction for DERIVED_FROM. NOT_PRESENT: an existing many-observation attachment
RPC/read path for one immutable semantic relationship candidate.

Existing candidate_assertions/candidate_evidence are normalized membership of the
original candidate envelope, not independent observation history. They will not
be reinterpreted or overwritten. ReviewSubject and M7 recover the original
finding/candidate/support, so appended observations can remain separately visible
without acquiring certification or replacing approved support. The additive
representation reuses observation findings and their existing support tables;
it does not add a generic candidate lifecycle/revision model.

## PR30 support-evolution gate — implemented correction (2026-09-11)

Root cause: correlation correctly reuses the semantic candidate ID, but the
original intake resubmitted changing evidence/assertion IDs and current endpoint
row references as a replacement immutable candidate envelope. The existing
`record_discovery_candidate` conflict was correct for replacement, but there was
no independent observation attachment path. Persisting unattached new support
and failing the rescan was insufficient; that earlier accepted limitation is fixed.

The original scanner semantic candidate ID, relationship direction, source scope,
M8 normalized endpoint identities and closed parser are unchanged. The new narrow
`recordLineageObservation` persistence capability is used only for DERIVED_FROM.
Adapters without it fail explicitly instead of silently dropping observations.

### Observation identity and append-only storage

One additive migration, generated using the local Supabase CLI:
`20260911120904_lineage_support_observations_v1.sql`.

`lineage_candidate_observations` links `(organisation_id, candidate_id)` to
independent immutable observation findings and their exact current source/target
DATA_ELEMENT candidate rows. The existing finding assertion/evidence junctions
provide each observation's support. Existing Evidence/SourceAssertion storage
deduplicates content by tenant and ID; common evidence can support multiple
observations without copying or replacing its envelope.

Observation finding identity hashes the semantic candidate ID, explicit endpoint
row-reference components and sorted distinct assertion/evidence IDs. It excludes
capture time and endpoint property enumeration order. Snapshot/location changes
are carried through new support IDs; they never enter semantic candidate identity.
The normalized candidate envelope and its original finding remain immutable.
New observation findings do not acquire separate normalized candidates or reviews.

The SECURITY INVOKER RPC serializes each tenant/candidate using a transaction
advisory lock, validates the acquisition source and durable current endpoints,
and compares each directed endpoint's exact source scope plus the existing M7
`normalized_object_identity` against the origin. Different endpoint rows with
the same M8 semantic identity are allowed; changed physical identities or reversed
endpoints under a reused candidate ID fail closed. Current endpoint support and
a DECLARED transformation assertion/evidence in the SQL source scope are required.

On first observation the RPC reuses existing finding/candidate persistence.
On later observations it preserves and returns the origin envelopes, records
the separate observation finding/support and appends the junction. The transaction
checks existing immutable finding content (excluding capture time on replay) and
exact attachment identity; failures roll back the attachment and any transaction
writes. The client verifies returned origin hashes/kinds/IDs before using them
for existing review processing. No historical migration, candidate envelope,
support membership or evidence/assertion content is updated or deleted.

### Replay and temporal provenance

Exact snapshot/support replay is idempotent: same observation finding, same
candidate, no duplicated support or review, successful intake. Comment-only,
line-only, whitespace-only and other harmless snapshot changes produce a new
observation with traceable assertion/evidence while retaining the same candidate.
Moving M8 declarations also succeeds despite changed exact endpoint row IDs.
Relationship source change, target change and reversal produce distinct semantic
candidates. No confidence-based collapse or inferred temporal closure.

Existing pre-gate candidates retain their original finding/candidate support.
There is no guessed historical observation backfill. Subsequent scans attach new
observations; the origin support remains accessible through the existing review
evidence and candidate linkage even when it predates the new junction.

### Review continuity, tenancy and M7 boundary

The RPC returns the immutable origin finding/candidate to the unchanged review
workflow. The same ReviewSubject is reused; PROPOSED/REJECTED/CERTIFIED states
are not reopened or automatically advanced. Supplemental observations are visible
in the existing review detail as a separate lineage history, using tenant-scoped,
hash-verified finding/evidence reads and the existing evidence sensitivity policy.
HASH_ONLY excerpts remain withheld. Observation history is paged rather than
silently limited to the Data API's default page size.

The ReviewSubject's original assertion/evidence arrays and M7 reconciliation
input are unchanged. Supplemental support is discovery context, not automatically
approved support: existing transition/decision support gates cannot use it as if
it had been reviewed. No new post-decision recertification or enrichment authority
is defined. A later governance feature would need an explicit rule to approve
such new support; raw discovery no longer fails while that rule is absent.
REJECT/DEFER decision regressions and terminal-review tests preserve authority.

All four junction foreign keys include organisation_id. RLS is enabled, public/
anon/authenticated access is revoked, service_role has SELECT/INSERT, update/delete
are blocked, and function execution is service_role-only with a fixed search_path.
Trusted tenant filters scope both persistence and review-history queries. Foreign
tenant support and endpoints cannot enrich the current candidate. No canonical
identity change, rematerialization, certification, VALIDATED/OBSERVED trust,
Graph/Vector/LLM work, SQL expansion or new access binding.

### Final focused validation and review

| Check | Result |
| --- | --- |
| Dashboard discovery-intake-service.test.ts | 61 passed |
| Dashboard lineage-support-persistence.test.ts | 4 passed |
| Dashboard lineage-support-migration.test.ts | 5 passed, structural SQL only |
| Dashboard discovery-intake-persistence-domain.test.ts | 4 passed |
| Dashboard discovery-governance-input-persistence-domain.test.ts | 15 passed |
| Dashboard workspace-query.test.ts | 10 passed |
| Dashboard decision-commands.test.ts | 18 passed, including REJECT and DEFER |
| Scanner sql-column-lineage.test.ts | 64 passed |
| Dashboard typecheck, incremental disabled | Passed |
| Governance-review typecheck | Passed |
| git diff --check | Passed; repeated at delivery |

Total **181 distinct passing tests** (117 dashboard + 64 scanner). Dashboard
commands used `node --conditions=react-server --experimental-test-module-mocks
--import tsx --test` with the seven named files; scanner used `node --import tsx
--test test/discovery-engine/sql-column-lineage.test.ts`. Final focused reruns
covered observation identity, migration structure and decision authority after
the review correction; typecheck fixture branding was corrected explicitly.
No full scanner/relationship suite rerun was needed: scanner code is unchanged.

One focused manual adversarial check completed for support loss, historical
overwrite, duplicate candidate/review, identity pollution, cross-tenant support,
endpoint-change collapse, canonical authority and harmless replay failure.
It corrected observation hashing to use explicit endpoint components rather than
object property order. The tests exercise reordered/deduplicated support, preserved
history, moved endpoint rows, terminal review states and hash/identity substitution.
No second broad audit or subagents. No unresolved test failure.

SQL constraints, transaction structure and RLS permissions were inspected and
structurally tested only. No migration execution, live Supabase/RLS/concurrency
test, production action, Validation Lab, external model or application API call.
The review-history UI is typechecked and its server data/sensitivity path tested;
no browser/runtime deployment verification is claimed. The migration must be
deployed through the normal later release process before the new RPC can run.

### Gate delivery

Twelve files: optional governance persistence capability; narrow observation-ID
helper; dashboard persistence, intake, review query and review UI; intake,
observation persistence, migration and decision tests; one new migration; this
evidence. No scanner, canonical-contract, frozen architecture, historical
migration, dependency or lockfile change.

One follow-up commit: `fix(lineage): preserve evolving relationship support`.
Normal push to existing PR #30; no amend, force push or new PR. Commit ID is
reported in the final handoff. **NOT MERGED**. Production **UNTOUCHED**.
READS_FROM and WRITES_TO remain **BLOCKED_AGENT_BINDING**.
Milestone **10 — NOT STARTED**.

Verdict: **PR30_M9_HARDENING_READY_FOR_REVIEW**.
