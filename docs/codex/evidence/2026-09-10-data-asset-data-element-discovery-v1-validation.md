# Milestone 8 - Data Asset & Data Element Discovery V1

Current status: **DATA_ASSET_DATA_ELEMENT_DISCOVERY_V1_READY_FOR_REVIEW**.
The original pre-implementation STOP and readiness record are preserved in
sections 1-27. The architect-authorized continuation and final validation are
recorded in sections 28-36; those sections supersede the earlier pending status.

## 1. Base gate

- Base main and origin/main: `52ee32c470fd8cdd28ca3177838e2b68eb0cb142`.
- `git fetch origin` succeeded with sandbox escalation; local main matched origin/main.
- Initial branch: `main`; initial working tree contained only the permitted protected recovery entry.
- The protected file was not read, hashed, staged, modified, deleted, or copied. No `.claude/**` inspection.

## 2. Branch

`feat/data-asset-data-element-discovery-v1`, created after the base gate.
HEAD remains the base SHA. No feature commit, push, PR, or merge.

## 3. Architecture

`GOVIA-L0L16-CIA-v1.0`, FROZEN, unchanged. Closed taxonomy and accepted
canonical endpoint/source mapping ADR remain authoritative.

Pre-implementation A-O mapping: A baseline unchanged; B intended L3 discovery,
reusing L0 acquisition and L14 proposed review; C intended Passport family 9
inputs only; D existing object identities only; E no access/lineage relationships;
F existing assertion/evidence assembly; G DECLARED only for direct declarations,
machine ceiling PROPOSED; H vector unchanged; I graph unchanged; J no LLM;
K trusted organisation-scoped persistence; L no demonstrated migration need;
M reuse candidate/review/exact mapping continuity; N no invented source identity,
parent, attributes or evidence; O required 40-case matrix remains unexecuted.

## 4. Milestone and blocking scope instruction

Milestone 8: object discovery only. Milestone 9 is NOT STARTED.

The execution request section 21 says:

> Implement only source forms for which this repository already has sufficient
> parsing infrastructure and evidence semantics.

Current scanner inspection confirms the conformance document section 16:
there is no SQL/DDL/dbt/schema parser. SQL declaration fixtures exist, but
fixtures and a generic text adapter do not constitute a structural parser.
The existing JSON parser is scoped to MCP configuration, not data schemas.
The existing YAML declaration detector is scoped to Knowledge Base identity.
Neither establishes a data schema/manifest convention.

A clarification was requested about allowing a new strict CREATE TABLE parser
for the already-present SQL declaration fixtures. Pending that answer, no
parser, detector, normalization implementation or intake modification is made.
This is a source-support scope conflict, not a demonstrated insufficiency in
the existing canonical identity architecture.

## 5. Reuse map

| Component | Classification | Evidence / necessary work |
| --- | --- | --- |
| DATA_ASSET / DATA_ELEMENT contracts | REUSE_AS_IS | `packages/canonical-contracts/src/contracts.ts`: DataAssetIdentity, DataElementIdentity, NormalizedDataAssetCandidate, NormalizedDataElementCandidate |
| Semantic identity | REUSE_AS_IS | `packages/governance-review/src/canonical-endpoint-resolution.ts`: normalizedObjectIdentity |
| Acquisition and finding/evidence assembly | REUSE_AS_IS | scanner `source-adapter.ts`, `pipeline.ts`, `evidence-assembly.ts` |
| Object normalization dispatch | ADAPT | Existing dispatch has no strategy for either data kind |
| Data declaration detector / parser | NOT_PRESENT | No data declaration strategy or SQL/schema/dbt parser in scanner source |
| Legacy data heuristics | LEGACY_DO_NOT_EXTEND | `packages/scanner/src/core/analyzer.ts`: `.from(...)` and keyword heuristics do not prove declarations |
| Candidate persistence / rehydration | REUSE_AS_IS | dashboard `discovery-intake-persistence.ts` accepts both kinds and requires parent/path for elements |
| Intake orchestration | ADAPT | Register supported detectors; resolve exact parent before element identity/mapping lookup |
| Review-subject creation | REUSE_AS_IS | Existing ensureReviewSubjectAndPropose workflow; machine proposal only |
| Exact canonical mapping foundation | REUSE_AS_IS | Accepted ADR; existing organisation/source/kind/normalized identity mapping |

## 6. Readiness matrix before implementation

These statuses describe inspected local implementation, not live population.

| Dimension | DATA_ASSET | DATA_ELEMENT |
| --- | --- | --- |
| A. Canonical contract | IMPLEMENTED | IMPLEMENTED |
| B. Normalized candidate contract | IMPLEMENTED | IMPLEMENTED |
| C. Candidate semantic identity function | IMPLEMENTED | IMPLEMENTED (requires parent) |
| D. Source evidence infrastructure | FOUNDATION_ONLY | FOUNDATION_ONLY |
| E. Detector availability | NOT_IMPLEMENTED | NOT_IMPLEMENTED |
| F. Normalizer availability | NOT_IMPLEMENTED | NOT_IMPLEMENTED |
| G. Intake persistence | IMPLEMENTABLE | PARTIAL (exact parent plumbing needed) |
| H. Review continuity | FOUNDATION_ONLY | FOUNDATION_ONLY |
| I. Canonicalization compatibility | FOUNDATION_ONLY | FOUNDATION_ONLY |
| J. Current scanner population | NOT_IMPLEMENTED | NOT_IMPLEMENTED |

## 7. Static source families

| Inspected family | Status | Reason |
| --- | --- | --- |
| Explicit SQL CREATE TABLE | FOUNDATION_ONLY | Real SQL fixtures and generic evidence framework; structural parser absent |
| SQL views / other DDL | NOT_IMPLEMENTED | No declaration parser |
| Schema/catalog manifests and dbt | NOT_IMPLEMENTED | No data-specific parser/detector found |
| ORM/model declarations | NOT_IMPLEMENTED | Legacy query-call heuristics are not declarations |
| Structured JSON/YAML data configuration | FOUNDATION_ONLY | MCP JSON/KB YAML parsing patterns exist; no supported data schema convention |
| Filename, import, query-client or prose inference | BLOCKED_EVIDENCE | Does not prove a data asset/element declaration |

No family is claimed SUPPORTED for data discovery.

## 8. DATA_ASSET semantics

Reuse the existing governable asset kind. Physical table/view concepts must not
become new canonical kinds. No asset candidates emitted in this session.

## 9. DATA_ASSET normalized identity

Existing proposedIdentity contains optional sourceReference and displayName.
normalizedObjectIdentity requires a nonblank sourceReference and returns its
exact value. Mapping separately scopes it by organisation, source connection,
external type/ID and object kind. Display name or filename alone is insufficient.
No new source-reference encoding was invented.

## 10. DATA_ELEMENT semantics

Existing canonical identity includes dataAssetId and elementPath. Existing
normalized candidate requires parentDataAsset plus elementPath.
No standalone or parentless element candidates emitted.

## 11. DATA_ELEMENT normalized identity

Existing normalizedObjectIdentity frames the exact parent connection ID,
external type, external ID, parent normalized semantic identity and elementPath
using UTF-8 byte lengths. Datatype, nullable, line/time and row IDs are not inputs.
Missing parent or empty path throws ENDPOINT_IDENTITY_MISSING.

## 12. Parent resolution

Existing contract permits typed pre-canonical references. Implementation should
use an exact typed candidate parent and reject missing/ambiguous parents.
Current intake calls normalizedObjectIdentity(normalizedCandidate) without a
parent. Once element normalization is enabled, that call must be adapted;
simply registering a detector would not complete intake. The governed dashboard
objectMappingIdentity already delegates element identity to the existing
normalised-object identity RPC for durable parent resolution.

## 13. Attributes

Normalized identities allow sourceReference/displayName for assets and
parentDataAsset/elementPath/displayName for elements. No datatype or nullable
fields were added to identity. No defaults or metadata fabricated.

## 14. Trust

Existing assembly supports DECLARED for direct source declarations and defaults
to INFERRED otherwise. Existing findings remain UNREVIEWED, requiresReview=true,
createsCanonicalObject=false. No new OBSERVED/VALIDATED claim or authority path.

## 15. Evidence / provenance

Existing assembler retains source object, assertion, snapshot hash, detector
code/version, evidence locations/excerpt and confidence. Generic evidence row
IDs include source spans; these must not be confused with semantic identity.
No schema evidence or data candidate was manufactured.

## 16. Normalization

normalizeObjectCandidate currently fails closed for both unregistered data kinds.
Existing strategy boundary is the adaptation point; no dashboard-built normalized
candidate or parallel normalization framework was introduced.

## 17. Persistence / intake

Generic persistence accepts both closed kinds. Historical
`20260907120000_discovery_governance_input_persistence_v1.sql` includes them in
finding/candidate kind checks. Rehydration already requires element parent/path.
No migration is objectively required by these representational contracts.
End-to-end data discovery persistence remains unimplemented and untested.

## 18. Canonical mapping compatibility

The accepted ADR and existing normalizedObjectIdentity support both proposed
identity shapes. Exact mapping is organisation/source/kind/semantic-identity
scoped. This is inspected foundation compatibility, not a newly tested data
discovery-to-governance flow. Scanner discovery does not materialize objects.

## 19. Duplicate / replay semantics

Semantic identity functions exclude line/time/row IDs. New detector replay,
declaration deduplication and traversal-order behavior remain unimplemented;
no passing replay claim is made for a nonexistent producer.

## 20. Tenancy

Existing intake passes trusted ctx.organisationId into evidence, assertion,
candidate and exact mapping persistence. No live tenant/RLS test or database
population query was run. Candidate identity alone is not tenant authority.

## 21. L9 preservation

No L9 file changed. USES_MODEL and USES_TOOL remain IMPLEMENTED.
USES_MCP, INVOKES, USES_PROMPT, USES_KNOWLEDGE_BASE and USES_SKILL remain
BLOCKED_CORRELATION per current authoritative evidence.

## 22. No-lineage boundary

No READS_FROM, WRITES_TO or DERIVED_FROM implementation or emission was added.
No access, query, runtime, transformation or column lineage work.

## 23. Graph / Vector / LLM boundaries

No Graph writes or projection changes, no Vector identity/merge authority and
no LLM authority or external model call. Canonical SoR remains PostgreSQL/Supabase.

## 24. Validation

Base Git gate passed. No executable file changed, so no test suite/typecheck
was run. The requested 40-case feature matrix is NOT EXECUTED and cannot be
reported passing. No Validation Lab or live service operation.
Final `git diff --check` result is recorded in the session handoff.

## 25. Adversarial review

Implementation adversarial pass NOT PERFORMED: implementation is pending the
source-parser scope clarification. No broad audit or subagent was dispatched.
The single focused implementation review remains available if work resumes.

## 26. Known limitations / delivery

No supported data discovery source, data normalizer or parent-aware intake
integration has been implemented. Generic JSON parsing does not justify claiming
schema/manifest support. SQL fixtures do not justify claiming SQL parser support.
Live population is UNKNOWN. Definition of Done is not met; no feature commit,
push or PR is appropriate under the request's "If ready" delivery condition.

Verdict: **STOP_REQUIRES_REVIEW**, pending explicit resolution of section 21's
existing-parser restriction. Frozen architecture is not being changed.

## 27. Production status

**UNTOUCHED**. Merge: **NOT MERGED**.
Next milestone: **9 - DATA ACCESS & COLUMN LINEAGE V1 - NOT STARTED**.

## 28. Authorized continuation / resume gate

The architect explicitly authorized **STRICT SQL CREATE TABLE DISCOVERY V1**,
resolving the section 21 scope conflict. This introduces one source parser,
not a new canonical kind or identity model. No restart or broad audit.

Resume state: existing branch `feat/data-asset-data-element-discovery-v1`, HEAD
`52ee32c470fd8cdd28ca3177838e2b68eb0cb142`, only this uncommitted evidence and
the protected recovery entry untracked. Resume `git diff --check` passed.
The original evidence was preserved. No protected-file content operation,
`.claude/**` inspection, subagent, live Supabase, production or external model call.

The architecture A-O mapping in section 3 remains the implementation boundary.
Frozen architecture, canonical contracts, governance domain, historical
migrations and L9 behavior discovery are unchanged. No dependency was added.

## 29. Final reuse and readiness

Section 5's reuse decisions were followed: reuse contracts, semantic identity,
acquisition, evidence, persistence, rehydration and review workflow; adapt the
normalization dispatch and intake; implement only the authorized missing parser;
leave legacy heuristics untouched. No migration or parallel storage/framework.

| Dimension | DATA_ASSET | DATA_ELEMENT |
| --- | --- | --- |
| A. Canonical contract | IMPLEMENTED, reused | IMPLEMENTED, reused |
| B. Normalized contract | IMPLEMENTED, reused | IMPLEMENTED, reused |
| C. Semantic identity | IMPLEMENTED, existing sourceReference | IMPLEMENTED, existing parent/path framing |
| D. Declaration evidence | IMPLEMENTED, SQL header | IMPLEMENTED, column/type and exact declaration parent |
| E. Detector | IMPLEMENTED, strict CREATE TABLE only | IMPLEMENTED, columns of accepted tables only |
| F. Normalizer | IMPLEMENTED | IMPLEMENTED, exact-parent context mandatory |
| G. Intake persistence | IMPLEMENTED, fake-port integration verified | IMPLEMENTED, parent durable before child |
| H. Review continuity | IMPLEMENTED, PROPOSED and input recovery verified | IMPLEMENTED, PROPOSED and input recovery verified |
| I. M7 exact mapping compatibility | IMPLEMENTED, existing identity and lookup exercised | IMPLEMENTED, existing parent/path identity and lookup exercised |
| J. Scanner population | IMPLEMENTED for supported local SQL fixtures | IMPLEMENTED for supported local SQL fixtures |

Live database population remains **UNKNOWN**; no production or live DB query.
These IMPLEMENTED statuses apply to the bounded source family and local tests,
not all data technologies or deployment/runtime certification.

## 30. Supported source family and parser scope

**SUPPORTED:** semicolon-terminated `CREATE TABLE name (...)` and
`CREATE TABLE IF NOT EXISTS name (...)` in lowercase-extension `.sql` files.
One- or two-component table identifiers, double-quoted identifiers with doubled
quote escaping, and ordinary columns using the explicit built-in type allowlist.
SourceReference preserves the declared token spelling, quotation and case;
whitespace/comments between qualified-name components are excluded.

The small lexer handles line/block comments (including nested block comments),
LF/CRLF/CR line locations, single-quoted strings, double-quoted identifiers,
dollar-quoted bodies, punctuation and numeric tokens. Strings/comments cannot
introduce statement or column boundaries. Balanced parentheses control splitting.
Limits: 100,000 tokens and nesting depth 64, plus the existing pipeline's 2 MB
artifact limit. Identifiers are conservatively limited to 63 raw UTF-8 bytes.

Types: integer/serial aliases, TEXT, BOOLEAN/BOOL, DATE, UUID, JSON/JSONB, BYTEA,
REAL/FLOAT4/FLOAT8, DOUBLE PRECISION, VARCHAR/CHAR/CHARACTER [VARYING],
NUMERIC/DECIMAL, TIME/TIMESTAMP with optional WITH/WITHOUT TIME ZONE.
Supported type modifiers are bounded: character length 1-4096, numeric precision
1-1000 with nonnegative scale no greater than precision, time precision 0-6.
These are V1 subset limits, not a claim to implement every legal PostgreSQL type.

Column clauses: explicit NULL/NOT NULL, PRIMARY KEY, UNIQUE, CHECK and DEFAULT
within the bounded expression grammar. Expressions support literals, selected
current date/time keywords, nested function calls/parentheses, basic operators
and supported type casts. Bare column references are accepted only in CHECK,
not DEFAULT. No evaluation, catalog/function lookup or SQL execution occurs.

Table-level CONSTRAINT, PRIMARY KEY, UNIQUE, FOREIGN KEY/REFERENCES and CHECK
forms are consumed by their own bounded grammar and never emitted as elements.
They do not create primary-key/foreign-key/lineage facts.

**NOT_IMPLEMENTED:** views/materialized views, CTAS, data discovery from SELECT,
INSERT/UPDATE/DELETE/MERGE, ALTER/DROP, dbt, ORM declarations and runtime
introspection. Unsupported statements yield no candidates; unsupported clauses
invalidate the entire CREATE TABLE, including its columns. Lexical errors,
unbalanced statements or unterminated final statements fail the entire artifact.
Other well-formed unsupported statements are ignored rather than inspected for
access/lineage. JSON/YAML data-schema parsing remains FOUNDATION_ONLY;
filename/import/prose heuristics remain BLOCKED_EVIDENCE.

## 31. Identity, parent, metadata and provenance

DATA_ASSET uses existing proposedIdentity.sourceReference from the explicit SQL
table identifier. A filename only locates the source evidence. DATA_ELEMENT
uses the exact normalized parent CANDIDATE reference and the explicit column
identifier as elementPath. Quoted spelling/case is retained; identifiers are
never lowercased in proposed semantic identity.

The existing M7 normalizedObjectIdentity implementation is unchanged:
asset = sourceReference; element = UTF-8-length-framed parent connection,
external type, external ID, parent normalized identity and elementPath.
Organisation/source/kind scoping remains in the exact mapping lookup.
No row/time/line/ordinal/datatype/default input defines semantic identity.

Scanner-only dataDeclaration carries sourceReference, a deterministic statement
token fingerprint and optional elementPath. Both detector specifications parse
the same source and carry the same statement fingerprint. Element normalization
requires exactly one same-source asset, the matching statement and snapshot,
and valid parent evidence. Missing, duplicate, wrong-table, stale-snapshot or
unsupported parents fail closed. No nearest/first/latest parent selection.

Intake processes assets before elements independently of traversal order. It
reads the exact parent finding's candidate under the trusted organisation and
compares the complete normalized envelope using the existing envelope hash
helper before persisting/reviewing a child. A substituted support envelope is
rejected even when its semantic identity matches.

Existing finding/assertion/evidence assembly is reused. Data rows additionally
include the snapshot content hash and declaration binding in their provenance
ID seed, preventing same-line datatype/default changes or same-line columns
under different tables from reusing stale/colliding evidence. This intentionally
separates snapshot-specific candidate rows from semantic object identity.

Evidence excerpts are minimal SQL-token projections: asset declaration header;
column name plus native type. Comments and default literals are omitted, and
the actual source path/line/hash remains attached. These are redacted projections,
not byte-for-byte complete statements. No default secret is copied into the
candidate/evidence envelope. Both kinds retain SourceAssertion, Evidence,
detector code/version and source snapshot through existing persistence.

DataAssetTechnicalProfile/DataElementTechnicalProfile require governed asset/
element IDs, and this intake has no data-profile proposal persistence. Therefore
TABLE structural kind and native datatype remain declaration evidence, not
invented canonical profile rows. No default public schema, catalog, nullability,
default-state, description, key or datatype-family value is fabricated.

## 32. Trust, replay, mapping and authority

Assertions for directly parsed declarations are **DECLARED**. Confidence never
changes authority. Findings remain UNREVIEWED, requiresReview=true,
createsCanonicalObject=false; normalized candidates require reconciliation;
machine review stops at **PROPOSED**. Tests reject missing evidence and attempted
OBSERVED/VALIDATED declaration normalization.

Identical rescans reuse candidate/finding/evidence IDs and do not duplicate
review. Reordering artifacts/specifications, moving lines/comments/whitespace,
or changing datatype/default leaves semantic identities stable. Table/column
identifier changes change the relevant identities. Same column path under
different parents produces different identities and distinct provenance rows.
Location/content changes may create new candidate rows; they do not change the
M7 exact semantic mapping or imply automatic canonical merging.

Repeated physical table declarations in one artifact, including identical ones,
fail closed as a group. Repeated physical column names fail the whole table.
Conservative alias checks recognize unquoted case folding and quoted-equivalent
duplicates only for rejection; they do not silently rewrite semantic identities.
Distinct source objects remain distinct source scopes, with no cross-file merge.

Existing exact mappings suppress new review only for the mapped typed semantic
object; the current candidate remains durable. Integration tests cover already
governed asset and element after line/type/order changes while another same-file
table/column remains independently reviewable. Generic rehydration roundtrips
both real normalized envelopes, and review input recovery returns
OBJECT_INPUT_AVAILABLE. No governed object materialization is performed.

Trusted tenant scope is passed to all reads/writes. Tests show foreign-tenant
parents cannot satisfy durability and foreign mappings cannot suppress review.
Same scanner row IDs can safely coexist under different organisations in the
existing compound-key model. These are fake-port tests, not live RLS proof.

No READS_FROM, WRITES_TO or DERIVED_FROM implementation/emission. No Graph write,
Vector authority, LLM authority or canonical write from discovery. L9 code is
unchanged: USES_MODEL/USES_TOOL IMPLEMENTED; USES_MCP, INVOKES, USES_PROMPT,
USES_KNOWLEDGE_BASE and USES_SKILL BLOCKED_CORRELATION. Milestone 9 NOT STARTED.

## 33. One focused adversarial pass

Exactly one manual implementation pass, no subagents or second broad review.
Checked comma nesting, comments/strings, constraints, filename/line identity,
cross-asset column collisions, datatype identity, missing/ambiguous parents,
unsupported syntax, trust escalation, lineage and canonical authority.

Concrete corrections: reject reserved unquoted identifiers; reject bare column
references/keywords in defaults; bound type modifiers; retain correct CR-only
evidence positions; require the full durable parent envelope rather than just
its semantic identity. Focused regressions cover these corrections.

Reserved identifier classification was checked against the primary
[PostgreSQL 18 keyword reference](https://www.postgresql.org/docs/18/sql-keywords-appendix.html)
and its `REL_18_STABLE/src/include/parser/kwlist.h` source. This was documentation
verification only; the parser never calls an external service.

No unresolved defect requiring a taxonomy/identity architecture decision was
identified. Parser/catalog/runtime limitations below remain explicit.

## 34. Final affected validation

| Check | Final result |
| --- | --- |
| Scanner sql-data-discovery.test.ts | 62 passed |
| Scanner object-candidate-normalization.test.ts | 25 passed |
| Scanner affected regression files listed below | 131 passed |
| Dashboard discovery-intake-service.test.ts | 41 passed (7 SQL integration cases + 34 existing) |
| Root npm run typecheck:scanner | Passed |
| Scanner npm run typecheck:discovery-engine | Passed, including new tests and review corrections |
| Root npm run typecheck:dashboard -- --incremental false | Passed after review corrections |
| git diff --check | Passed; final staging gate repeats the same whitespace check |

**259 distinct passing tests**, without double-counting reruns: 218 scanner +
41 dashboard. The initial combined scanner run passed 207 tests before the
review additions. The final SQL/normalization rerun passed 87; unchanged affected
regressions account for 131. The final intake rerun passed 41.

Commands from packages/scanner use `node --import tsx --test` with:
`test/discovery-engine/sql-data-discovery.test.ts`,
`test/discovery-engine/object-candidate-normalization.test.ts`,
`test/discovery-engine/agent-version-correlation.test.ts`,
`test/discovery-engine/agent-version-technical-signals.test.ts`,
`test/discovery-engine/relationship-correlation.test.ts`,
`test/discovery-engine/pipeline.test.ts`,
`test/discovery-engine/l4-round1-object-detection.test.ts`,
`test/discovery-engine/tool-detection.test.ts`.

Dashboard command from apps/dashboard:
`node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/discovery-intake-service.test.ts`.

An initial sandbox attempt failed with Node spawn EPERM; approved local
execution passed. One initial replay test compared acquisition run UUIDs;
correcting it to compare normalized candidates fixed the assertion without
altering acquisition semantics. No unresolved test failure.

Acceptance accounting: continuation cases 1-20 are covered by the 62 SQL tests;
21 by seven real intake integrations with fake persistence plus rehydration and
review-input recovery; 22-24 by SQL no-relationship output, intake zero lineage
and throwing canonical/authorization ports; 25 by existing scanner and intake
L9 regressions. Original 40-case matrix is likewise covered by SQL positives/
negatives/identity/support tests, intake/review/mapping tests and unchanged
AGENT/AGENT_VERSION/MODEL/TOOL/L9 regressions. Graph/Vector/LLM boundaries were
also checked in the focused diff review. Canonical contracts were not touched,
so their suite was not rerun. No migration or Validation Lab contract changed;
no migration suite or Validation Lab run.

## 35. Final limitations and file inventory

This is a static declaration recognizer, not a SQL compiler, database catalog
validator or proof that a declaration executed successfully. It does not resolve
function existence, type compatibility of default values, external constraints,
search_path or actual physical database identity. Quoted/raw spelling changes
can require explicit governed matching; no automatic case/alias canonical merge.

Unsupported valid SQL is deliberately rejected: user-defined/domain/array types,
inheritance/partitioning, temporary/unlogged table forms, generated/identity
columns, collations, escape-string modes, advanced constraint/default syntax,
and forms outside the explicit limits. An unrelated lexical error or incomplete
statement can suppress all data discovery in that file. Parser rejection currently
returns no data matches, without a dedicated diagnostic UI. Cross-file physical
deduplication, data technical-profile persistence, live DB/RLS/concurrency
validation and deployment are outside this delivery.

Changed files (11):

- `packages/scanner/src/discovery/strategies/sql-create-table.ts`
- `packages/scanner/src/discovery/detection-specification.ts`
- `packages/scanner/src/discovery/evidence-assembly.ts`
- `packages/scanner/src/discovery/object-candidate-normalization.ts`
- `packages/scanner/src/discovery/index.ts`
- `packages/scanner/src/index.ts`
- `packages/scanner/test/discovery-engine/sql-data-discovery.test.ts`
- `packages/scanner/test/discovery-engine/object-candidate-normalization.test.ts`
- `apps/dashboard/lib/governance/discovery-intake.ts`
- `apps/dashboard/tests/discovery-intake-service.test.ts`
- This evidence document.

## 36. Delivery gate

All bounded-source implementation and affected validation gates pass. One feature
commit: `feat(discovery): add strict sql data asset discovery`. Push the existing
branch and open one PR against main. Commit/PR identifiers are reported in the
session handoff; no metadata-only follow-up commit is needed.

Verdict: **DATA_ASSET_DATA_ELEMENT_DISCOVERY_V1_READY_FOR_REVIEW**.
Merge status: **NOT MERGED**. Production status: **UNTOUCHED**.
Next milestone: **9 - DATA ACCESS & COLUMN LINEAGE V1 - NOT STARTED**.
