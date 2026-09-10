> Final external legacy gate (2026-09-10): **PR28_M7_HARDENING_READY_FOR_REVIEW**.
> Sections 43-46 supersede the earlier delivery verdict for this follow-up.

> Current status (2026-09-10): **RELATIONSHIP_DECISION_TO_TRUTH_V1_READY_FOR_REVIEW**.
> Sections 1-32 below preserve the original preimplementation STOP history.
> Sections 33-42 record the accepted architecture resolution and completed continuation;
> historical statements such as ?not implemented? and ?no migration? are not current status.

# Relationship Decision-to-Truth Completion V1: architecture stop

Verdict: **STOP_REQUIRES_ARCHITECTURE_DECISION**.

This is preimplementation evidence, not milestone completion. No production code,
contract, migration, discovery heuristic, or frozen architecture document changed.
The requested branch exists; this evidence remains uncommitted. The instruction
to create a feature commit and PR applies only if ready, which this gate is not.

## 1. Base main SHA

`b202cdb5744bbbbf22e92f1a27945dea88822b94`. The initial fetch/base gate passed:
local main and origin/main agreed, previous approved feature commit
`bc37ffe12787e874049d4b51a8220f6721d13346` was an ancestor (exit 0), and the
only untracked entry was the protected recovery file. Its contents were never
accessed. No `.claude/**` inspection occurred.

## 2. Branch

`feat/relationship-decision-to-truth-v1`; HEAD remains the base SHA. No commit,
push, or PR created for this milestone. NOT MERGED.

## 3. Architecture ID

`GOVIA-L0L16-CIA-v1.0`, FROZEN. Relevant architecture, roadmap, conformance,
reuse register, and milestone 2 through 6 evidence informed the narrow reuse
inspection. All frozen invariants remain unchanged.

## 4. Milestone

7: Relationship Decision-to-Truth Completion V1. BLOCKED before implementation.
Milestone 8, Data Asset & Data Element Discovery V1, NOT STARTED.

Two existing representation boundaries require an architecture decision:

1. **Canonical endpoint identity cannot be hydrated from current governed
   object truth.** `CanonicalObjectIdentity` stores organisation, object ID and
   kind. `AgentVersionIdentity` additionally requires a governed parent Agent,
   `agentVersionId`, and nonempty `versionCode`; the parent requires `agentId`
   and `agentCode`. Relationship CREATE_NEW and MATCH_EXISTING validate these
   rich identities. Object decisions/materialization currently persist the
   minimal canonical identity, with no governed endpoint-identity payload.
   L9 AgentVersions intentionally have no declared versionCode. The approved
   milestone 2 evidence explicitly prohibits using a technical fingerprint as
   versionCode. A cast, manufactured version string, or copied proposal cannot
   supply the missing canonical authority.
2. **The active source mapping has file granularity and one canonical target.**
   L9 Agent and AgentVersion findings share `agent.finding.sourceObject`;
   successive versions also retain this provenance anchor. The existing unique
   active mapping key is `(organisation_id, source_connection_id,
   source_external_type, source_external_id)`, with no kind or candidate/version
   discriminator. Object materialization always writes this mapping. It therefore
   cannot materialize these distinct canonical objects through the current
   object workflow for the same source identity. Adding only kind would still
   conflate V1 and V2. Bypassing mapping insertion or changing source identities
   would change the existing object Decision-to-Truth semantics.

Required decision: establish the governed representation and authority for rich
endpoint identities (including versions without a declared versionCode), and
the canonical mapping semantics for multiple objects/versions supported by one
source artifact. Possible architecture directions are a minimal canonical
relationship endpoint contract with separately governed identity attributes, or
a governed rich-identity acquisition/persistence flow. Neither is implemented
or selected here. Source-mapping scope must also be specified in either case.

Concrete source anchors:

- `packages/canonical-contracts/src/contracts.ts`: CanonicalObjectIdentity,
  AgentIdentity, AgentVersionIdentity; NormalizedAgentVersionCandidate;
  copyRelationshipEndpoint; copyGovernedRelationshipDraft; copyMatchReference.
- `packages/scanner/src/discovery/agent-version-correlation.ts`: sourceObject
  inherited from the Agent finding; `proposedIdentity: { agent: agentReference }`.
- `apps/dashboard/lib/governance/decision-commands.ts`: object CREATE_NEW creates
  only CanonicalObjectIdentity; relationship materializing outcomes remain blocked.
- `supabase/migrations/20260906120000_canonical_materialization_v1.sql`:
  canonical_objects deliberately has no kind-specific payload; active source
  mapping unique index; object RPC always inserts a source mapping.
- `docs/codex/evidence/2026-09-08-agent-identity-version-discovery-v1-validation.md`,
  sections 9-10: versionCode absent; a derived hash is not an explicit version.
- The L4 technical-profile port stores behavior fingerprint/support, not the
  required parent Agent identity or declared versionCode.

## 5. Reuse map

| Component | Classification | Reason |
| --- | --- | --- |
| Closed candidate taxonomy and pre-canonical endpoint references | REUSE_AS_IS | Preserve twelve relationship types and AGENT_VERSION behavior sources |
| L9 candidate creation/intake | REUSE_AS_IS | Two evidenced populations, durable candidate references, proposal ceiling |
| ReviewSubject, certification and human authorization | REUSE_AS_IS | Existing governed workflow and authority vocabulary |
| Relationship reconciliation invocation | ADAPT | Must prove exact candidate-to-canonical endpoint bindings before approval |
| Canonical relationship factories | ADAPT | Endpoint representation decision required; do not weaken silently |
| Object decisions and materialization | ADAPT | Source mapping cannot represent same-file Agent/versions; scope decision required |
| Dashboard decision command/query | ADAPT | Materializing relationship outcomes currently blocked |
| Candidate-specific canonical endpoint resolver | NOT_PRESENT | No complete resolver/hydrator in inspected workflow |
| Canonical relationship semantic ID derivation in dashboard | NOT_PRESENT | Need organisation/type/directed canonical endpoint identity |
| Relationship tables, transactional RPC, ledger/outbox | REUSE_AS_IS | Existing atomic writes, tenant FKs and semantic edge uniqueness |
| Durable discovery inputs and decision envelope/audit | REUSE_AS_IS | Existing provenance and audit chain |
| Legacy discovery relationship copresence path | LEGACY_DO_NOT_EXTEND | Already removed/fail-closed by L9 |

The persistence classification concerns storage capability, not certification
that every existing RPC trust-boundary check closes the new milestone matrix.

## 6. Readiness matrix

These statuses were established before implementation and remain open.

| Gate | Status | Finding |
| --- | --- | --- |
| A. Candidate creation | IMPLEMENTED | USES_MODEL/USES_TOOL; other populations intentionally limited |
| B. Review subject creation | IMPLEMENTED | Relationship itself is reviewed with durable finding/candidate support |
| C. Reviewer decision | ADAPT_REQUIRED | REJECT/DEFER available; CREATE_NEW/MATCH_EXISTING blocked in dashboard |
| D. Decision validation | ADAPT_REQUIRED | Existing human/contract checks; exact canonical binding proof missing |
| E. Source canonical endpoint resolution | BLOCKED | Rich identity and source-mapping decisions above |
| F. Target canonical endpoint resolution | BLOCKED | Generic rich identity resolution and same-artifact mapping not closed |
| G. Canonical relationship identity | MISSING | No complete dashboard semantic identity derivation |
| H. Relationship persistence | IMPLEMENTED | Existing transactional RPC and edge uniqueness; no new path enabled |
| I. Provenance preservation | ADAPT_REQUIRED | Existing links reusable; new successful path not connected |
| J. Evidence preservation | IMPLEMENTED | Durable discovery and decision support retained |
| K. Decision auditability | IMPLEMENTED | Persisted authorization, invocation and decision chain |
| L. Idempotent replay | ADAPT_REQUIRED | Existing decision/operation protections; full new path unproven |
| M. Conflict handling | ADAPT_REQUIRED | Existing typed/DB conflicts; endpoint substitution checks still needed |
| N. Tenancy | ADAPT_REQUIRED | Existing scoping/FKs; complete resolver does not exist |
| O. Downstream continuity | BLOCKED | Successful L9 candidate-to-canonical path not completed |

## 7. Candidate-to-review flow

Existing intake persists evidence/assertions, findings, normalized object/version
candidates and relationship candidates before proposal. Relationships have their
own ReviewSubject. Input recovery verifies finding, candidate kind, source anchor
and support consistency. This is not canonical endpoint resolution.

## 8. Decision vocabulary reused

Relationship outcomes remain CREATE_NEW, MATCH_EXISTING, REJECT, DEFER.
MERGE_CANDIDATES belongs to object reconciliation and is not added to relationships.

## 9. Authorization semantics

Existing reconciliation requires CERTIFIED review and a HUMAN actor with scoped
ALLOW authorization. PROPOSED state, confidence, discovery and similarity confer
no materialization authority. The dashboard materializing relationship gate
remains closed. Its obsolete explanation about absent production normalizers
is not treated as evidence; the blockers above are independently established.

## 10. Endpoint resolution

BLOCKED. Existing canonical lookup verifies org/kind/object ID only. Candidate
reconciliation/materialization provenance can support a future exact resolver,
but cannot manufacture missing rich identities or bypass mapping conflicts.
No Graph lookup, arbitrary endpoint selection or placeholder object was added.

## 11. AGENT_VERSION preservation

The seven behavior families continue to require AGENT_VERSION. No substitution
with AGENT and no synthetic versionCode was implemented. Runtime probes below
confirm both materializing outcomes enforce the rich endpoint requirement.

## 12. Canonical relationship identity

MISSING in the complete production workflow. The required deterministic key
must depend on organisation, type, canonical source and canonical target.
Existing active-edge uniqueness already protects the semantic tuple in storage.
Candidate/review/evidence IDs must not be substituted as canonical edge identity.

## 13. CREATE_NEW path

BLOCKED at dashboard command. The existing domain factory and materializer are
reusable with valid rich identities; no newly completed successful path claimed.

## 14. MATCH_EXISTING path

BLOCKED at dashboard command. Existing RPC compares tenant, type, source and
target IDs and kinds. A future resolver must prove these are the reviewed
candidate's exact canonical endpoints before allowing the selection.

## 15. Reject/no-materialization path

Existing REJECT/DEFER decisions carry audit/support and return not-applicable
from materialization. The passing dashboard decision and governance domain tests
cover existing rejection and authorization behavior. No evidence deletion added.

## 16. Idempotency

Existing invocation fingerprints and materialization decision locks remain.
The relationship RPC serializes same-decision attempts; an active-edge unique
index rejects duplicate semantic edges from distinct decisions. No live
concurrency execution occurred; no end-to-end milestone replay claim is made.

## 17. Conflict handling

Existing domain errors, immutable decision persistence and DB conflicts are
reusable. Missing endpoint authority is an explicit blocker. No conflicting
mapping or endpoint is silently overwritten. New finalized-candidate substitution
and canonical-resolution conflict coverage has not been implemented.

## 18. Provenance

Existing canonical relationship created_by_decision_id and materialization
operation link to the persisted decision, invocation, authorization and review
subject. The decision identifies the relationship candidate. This storage chain
does not itself prove candidate endpoint equivalence; that remains work.

## 19. Evidence

Source assertions/evidence and decision support remain intact. No fabricated
support, copied raw Prompt payload or new unrestricted metadata. Passing L9/intake
regressions exercise protected Prompt behavior and the discovery authority ceiling.

## 20. Temporal semantics

L9 V1/V2 candidate identities remain distinct, including a shared Tool target.
Canonical V1/V2 continuity is BLOCKED by source mapping and rich identity gaps.
Existing relationship valid_from/valid_to/state fields are retained unchanged;
no historical rewrite or invented supersession policy.

## 21. Tenancy

Existing persistence queries are organisation scoped and canonical endpoint FKs
include organisation. Discovery contracts rely on trusted tenant intake rather
than carrying organisation on every candidate. Complete canonical endpoint and
cross-tenant match/evidence validation for the new path remains unproven.

## 22. Transaction boundary

Atomicity infrastructure is available: the relationship RPC writes the canonical
edge, APPLIED materialization operation and outbox event in one PostgreSQL
transaction. A separately persisted authorized decision is not an APPLIED
materialization claim. This stop is **not** a finding that atomicity is impossible.
No split-write implementation or distributed transaction was introduced.

## 23. Persistence

No migration created. Existing relationship storage supports tenant, type,
endpoints, decision linkage, temporal fields, idempotency and semantic uniqueness.
Adding duplicate relationship tables would not solve the object-identity/mapping
architecture gaps. Historical migrations unchanged; no migration executed.

## 24. RLS

Existing gov_repo service boundary remains: RLS enabled; relationship RPC is
SECURITY INVOKER with restricted search_path; execution revoked from public,
anon and authenticated, granted to service_role. Source inspection only, no
live policy claim. The Supabase skill and public official function/RLS docs were
consulted; no database connection or advisor was invoked. The changelog.md
fetch was unsupported; no implementation relies on unverified recent changes.

## 25. L8 boundary

No similarity changes or automatic L8 authorization. VECTOR SIMILARITY !=
CANONICAL MERGE. Existing boundary tests pass.

## 26. LLM boundary

No model calls or LLM authority. Machine actors remain rejected by existing
human reconciliation gates. LLM OUTPUT != CANONICAL TRUTH.

## 27. Graph boundary

No GraphOS changes, lookup, write-back or projection feature. PostgreSQL/Supabase
remains SoR; Graph remains downstream projection only.

## 28. Blocked L9 families

USES_MODEL and USES_TOOL remain IMPLEMENTED at discovery. USES_MCP, INVOKES,
USES_PROMPT, USES_KNOWLEDGE_BASE and USES_SKILL remain BLOCKED_CORRELATION.
The twelve-type canonical contract is unchanged. CAPABILITY != POPULATION.

## 29. Tests

Existing baseline validation on the unchanged implementation:

| Command / working directory | Result |
| --- | --- |
| `npm test` / packages/canonical-contracts | PASS, 99 tests |
| `npm test` / packages/governance-review | PASS, 117 tests |
| `node --import tsx --test --test-isolation=none test/discovery-engine/relationship-correlation.test.ts` / packages/scanner | PASS, 42 tests |
| Dashboard command below, decision-commands.test.ts | PASS, 17 tests |
| Dashboard command below, reconciliation-readiness.test.ts | PASS, 8 tests |
| Dashboard command below, object-candidate-reconciliation-continuity.test.ts | PASS, 2 tests |
| Dashboard command below, discovery-intake-service.test.ts | PASS, 34 tests |
| `npm run typecheck` / each of canonical-contracts, governance-review, scanner | PASS, all three |
| `npm run typecheck:dashboard -- --incremental false` / root | PASS |

Dashboard command, run separately per file from apps/dashboard:
`node --conditions=react-server --experimental-test-module-mocks --import tsx --test --test-isolation=none tests/<file>`.

Total: **319 existing tests passed**. These are baseline regressions, not the
52-case new milestone acceptance matrix. No new acceptance tests were added.

Initial governance/dashboard attempts hit sandbox esbuild spawn EPERM and were
rerun with approval outside the sandbox. A combined dashboard invocation then
failed with module-resolution errors in the shared mock process. Each requested
dashboard file passed independently; no application change was needed.

Additional in-memory native Node probe: constructing USES_TOOL decisions with
each of CREATE_NEW/authorizedState and MATCH_EXISTING/matchedState, then invoking
rehydrateRelationshipReconciliationDecision, yielded four expected rejections:

- Full synthetic AgentVersion identity except versionCode: both outcomes throw
  `AgentVersion endpoint versionCode` validation errors.
- Source containing only canonicalObject: both outcomes throw `AGENT endpoint`
  validation errors for the missing rich parent identity.

The fixture supplied a tenant, canonical source/target IDs and correct kinds,
human decision metadata, support and a synthetic technical fingerprint; the
probe asserted the specific errors, made no writes and exited 0. Synthetic
fixture values are diagnostic only, never proposed canonical truth.

Acceptance matrix accounting:

- 1-5, 24-26, 45-49: existing authority/rejection/intake/object baseline coverage
  passes; no claim of completed new relationship production integration.
- 6-23, 27-39: new endpoint/create/match/provenance/temporal/replay/tenant workflow
  remains BLOCKED or NOT IMPLEMENTED. Existing domain tests and SQL protections
  are reusable evidence only. Database concurrency not executed.
- 40-44, 51: L9 focused regression passes, including all five blocked families.
- 50, 52: canonical-contract suite passes; no taxonomy/contract change.

No Validation Lab, live Supabase, production, external model API, or new
migration test run. No golden contracts changed.

## 30. One focused adversarial review

One preimplementation pass; no second broad audit. Defects requiring changes
remain recorded rather than hidden behind a readiness claim.

| Check | Finding |
| --- | --- |
| A. Candidate directly creates truth | Existing gates preserved; baseline tests pass |
| B. Decision applied to wrong candidate | Existing recovery binds finding/source/support; complete exact endpoint proof still needed |
| C. Wrong canonical endpoint resolution | BLOCKED: no authoritative rich resolver; source mapping cannot distinguish same-file versions |
| D. AGENT replaces AGENT_VERSION | Contract still rejects; no conversion added |
| E. Cross-tenant endpoint | Existing scoping/FKs retained; new resolver unproven |
| F. Duplicate canonical relationship | Existing active semantic-edge unique index; no live race test |
| G. Nonidentical MATCH_EXISTING | RPC exact binding predicate retained; candidate-to-canonical proof unfinished |
| H. Directed edge reversed | Existing source/target ordering retained; no symmetric assumption |
| I. Replay duplication | Existing fingerprint/lock baseline passes; new path unfinished |
| J. Missing provenance | Existing ledger/support reusable; new complete trace not claimed |
| K. Prompt plaintext | No added payload; L9 regression passes |
| L. Graph authority | No added path |
| M. Similarity authority | No added path; existing negative regression passes |
| N. Blocked family fabricated | No discovery changes; five blocked cases pass |
| O. Non-atomic materialization | Existing single-transaction RPC reusable; no split-write path |

## 31. Known limitations

Milestone is not complete. Architecture must resolve the two Section 4 gaps
before safely implementing the generic endpoint workflow and full acceptance
matrix. In particular, a passing synthetic rich-identity domain fixture cannot
prove that the live governed object representation contains those attributes.
No new feature commit, push or PR is appropriate under the conditional ready gate.

Final scope: only this evidence document was added. Tracked implementation diff
is empty. git diff --check is clean; the new document is checked separately
because ordinary git diff omits untracked files. The protected recovery file
remains the original untracked entry and was not read, hashed, staged or changed.

## 32. Production status

UNTOUCHED. No live Supabase or migration execution, production configuration,
Graph operation, external model API, merge, force push, amend, or milestone 8
work. Verdict remains **STOP_REQUIRES_ARCHITECTURE_DECISION**.


## 33. Exact-state continuation and accepted architecture resolution

Resumed existing `feat/relationship-decision-to-truth-v1` at
`b202cdb5744bbbbf22e92f1a27945dea88822b94` with all milestone edits uncommitted.
The required status, branch, HEAD, diff-stat and diff-check commands confirmed
only legitimate milestone changes. No reset, stash, discard or new architecture
audit. The protected recovery entry was visible in status only; its contents
were never inspected, hashed, staged, modified or deleted. No `.claude/**` access.

The original STOP had two concrete causes: rich canonical endpoint contracts
required unavailable AgentVersion metadata, and the coarse file-level mapping
could not distinguish an Agent from same-file versions. The explicitly accepted
[ADR](../../architecture/ADR-GOVIA-CANONICAL-ENDPOINT-IDENTITY-AND-SOURCE-MAPPING-GRANULARITY-v1.md)
resolves those causes without changing the frozen CIA baseline, taxonomy or
relationship vocabulary. Its A-O table records the architectural impact.

Source provenance, typed normalized semantic identity and canonical object
identity are separate layers. Canonical endpoints now copy only
`canonicalObject: { organisationId, objectId, kind }`. Existing richer typed
inputs remain source-compatible, but endpoint equality uses canonical identity.
Discovery candidates still require pre-canonical references. A new contract
test rejects both replacement and augmentation of either candidate endpoint
with a canonicalObject reference.

## 34. Actual normalized AgentVersion discriminator and stability proof

The existing production code in
`packages/scanner/src/discovery/agent-version-correlation.ts` already defines:

- `stableSuffix(parts)`: the existing SHA-256 digest truncated to 32 hex digits.
- `sourceScope = stableSuffix([connectionId, externalType, externalId])`.
- `technicalRevisionFingerprint = stableSuffix(projection)`, where projection
  sorts/deduplicates supported normalized Agent code and technical facts. It
  includes protected Prompt fingerprints and supported framework/orchestration
  facts; line positions, scan times and database row IDs are absent.
- `suffix = stableSuffix([sourceScope, technicalRevisionFingerprint])`.
- `candidateId = candidate:agent-version:<suffix>`; finding ID has the same
  suffix with the existing discovery-finding prefix.

This exact repository-produced typed candidate ID is the AgentVersion normalized
mapping discriminator. It is not a UUID, review ID, proposal ID or version label.
The scanner regression proves identical scans, traversal reorder, duplicate
signals and unrelated line/comment insertions preserve identity; changed Model,
Tool and supported technical facts produce a different revision. Same target
Tool with V1/V2 keeps separate relationship candidates and canonical source IDs.
The ordinary MODEL/TOOL detector IDs contain locations, so their mapping keys
instead use existing modelReference/declarationKey values. Other object kinds
use their existing typed proposed identity values. DATA_ELEMENT uses its exact
normalized DATA_ASSET parent source identity plus elementPath, never a parent
row ID. Missing or ambiguous parent identity fails closed.

The scanner ID itself does not confer tenant authority: durable candidate reads,
review/decision linkage, exact mappings and canonical objects all include the
trusted organisation. Regex shape validation alone is not the provenance proof;
the durable normalized candidate and existing deterministic producer supply it.
The existing 128-bit truncated discriminator is retained; no new hash algorithm
or absolute collision-impossibility claim is introduced.

No versionCode is fabricated or reconstructed. Absence remains undeclared.
Parent Agent is validated as an already canonical AGENT during object
materialization and recorded as mapping provenance. It is not a behavior source
and no VERSION_OF relationship is added.

## 35. Typed mapping and exact endpoint resolution

One new migration, created with the local Supabase CLI:
`supabase/migrations/20260909210640_relationship_decision_to_truth_v1.sql`.
No historical migration was changed or executed.

`canonical_normalized_object_mappings` uses explicit typed columns and unique
`(organisation, connection, external type, external ID, object kind, normalized
object identity)`. Compound foreign keys bind the canonical object's tenant,
ID and kind, candidate tenant, parent tenant and governing decision tenant.
Source scope alone never chooses an object. New object materialization writes
this mapping atomically with object/operation/outbox; exact identical mappings
can be reused, conflicting canonical targets or parents roll back.

Historical coarse rows and constraints remain untouched. New relationship
resolution never reads them, and no guessed backfill exists. Historical APPLIED
object operations retain their replay path. A legacy-only endpoint remains
ENDPOINT_NOT_CANONICAL until an explicit governed object MATCH_EXISTING/CREATE_NEW
establishes its exact normalized mapping. Older pending decisions may therefore
fail closed; this continuation does not silently reinterpret them.

The read-only resolver first counts distinct normalized semantic identities
within the tenant and requested kind/source or candidate reference. It then
requires exactly one exact mapping joined to an existing canonical object.
Zero fails ENDPOINT_NOT_CANONICAL; multiple identities/mappings fail
ENDPOINT_MAPPING_AMBIGUOUS; missing normalized identity fails
ENDPOINT_IDENTITY_MISSING. Kind and organisation are checked again in the domain.
There is no newest/latest/current/first fallback or Agent-for-AgentVersion cast.
The two endpoints resolve independently before the dashboard constructs the
requested positive decision, and the authoritative materialization RPC repeats
both resolutions before its write. Relationship materialization contains no
canonical object insertion.

Mapping acceptance coverage (original architecture cases 1-11 and latest A-G):

| Requirement | Proof |
| --- | --- |
| Same-file AGENT / AGENT_VERSION separation | Typed key test, governed three-object workflow test, database unique tuple |
| Same parent V1 / V2 separation | Distinct revision discriminator and canonical objects in governed workflow; scanner change/replay tests |
| Missing versionCode accepted without fabrication | Canonical minimal-endpoint tests for all twelve types; scanner absent-versionCode test; SQL normalized identity helper |
| Sufficient actual deterministic identity | Existing scanner producer and 107 focused regression tests; durable candidate lookup |
| Missing discriminator rejected | Five invalid discriminator cases; SQL regex has no fallback |
| Exact normalized replay | Governed object workflow replays three operations into three mappings; SQL unique tuple/replay path |
| Legacy coarse ambiguity rejected | Resolver structural test excludes coarse table entirely; legacy-only zero-mapping rejection |
| Wrong canonical kind rejected | Domain source/target matrix, dashboard resolver tests, compound kind FK |
| Wrong tenant rejected | Domain and dashboard tests, tenant-scoped SQL and compound FKs |
| Zero mappings rejected | Both source/target and both positive outcomes |
| Multiple exact mappings rejected | Both source/target and both positive outcomes; SQL semantic count and uniqueness |

The governed object and relationship workflows use in-memory persistence ports.
The real database properties above are supported by migration structural tests
and inspection, not by claiming these fakes execute PostgreSQL.

## 36. Governed decisions, directed truth, support and history

The existing dashboard route, command service, domain gate, audit persistence
and materialization adapter are reused. No parallel governance framework.
Client input is the requested outcome, reason and optional existing relationship
ID; organisation, actor and role come from the server session. Positive commands
require certified review, scoped human authorization, the exact durable candidate
and independently canonical endpoints. Full durable candidate content is compared
with the reviewed candidate; envelope hash is checked on recovery. Candidate
substitution and missing candidate support fail closed.

CREATE_NEW derives `canonical-relationship:` plus SHA-256 of UTF-8 byte-length
framed `[organisation, relationshipType, canonicalSourceId, canonicalTargetId]`.
The SQL transaction independently reproduces this ID. The initial state ID is
`<relationshipId>:initial`. Review/candidate IDs, reason, time and evidence are
provenance, never part of semantic edge identity. V2 changes the canonical source
and therefore the relationship identity, preserving V1.

MATCH_EXISTING requires exact organisation/type/source/target, allowed endpoint
kinds, existing state ID and active state. A reversed edge, different source,
target, type, tenant, kind, state or client-selected ID fails closed. No fuzzy
matching or L8 lookup. All twelve canonical types accept minimal endpoints;
EXPOSES also exercises the real generic server decision constructor. Generic
capability does not populate unsupported discovery families.

For behavior CREATE_NEW, the supported fingerprint comes from the technical
profile proposal tied to the exact governed source mapping's AgentVersion
candidate. Exactly one distinct supported fingerprint is required by the server;
missing/ambiguous values fail closed. This is metadata explicitly approved in the
human relationship decision, not authority granted to the proposal. SQL verifies
that fingerprint against the same mapping/candidate proposal. The complete
relationship support remains linked through the persisted decision/candidate.
No raw Prompt plaintext, synthetic version or reconstructed parent is emitted.

REJECT and DEFER persist auditable decisions with candidate/support linkage and
never call materialization or delete candidate/evidence. Retrying identical
finalized relationship commands replays; changing the outcome, reason, actor or
matched relationship conflicts. Database serialization per review prevents
concurrent different final decisions, and the trigger binds each new object or
relationship decision to that certified review's durable candidate.

## 37. Atomicity, idempotency, tenant safety and RLS

The existing `record_authorized_reconciliation` transaction persists the
human authorization, decision, invocation and audit/outbox linkage. A persisted
CREATE_NEW decision is authorization; it does not itself assert materialization
success. Only the separate materialization operation's APPLIED status does so.
This preserves the repository's decision-then-materialization workflow.

Inside `materialize_relationship_reconciliation`, the existing per-decision
lock/fingerprint check precedes canonical writes. Before a new write, the RPC
revalidates the persisted certified candidate, state/parameters, support subset,
both exact endpoint mappings, endpoint kinds and directed semantic identity.
The canonical edge with `created_by_decision_id`, APPLIED operation and outbox
are written in that one transaction. Any error rolls back its lock and writes.
No application check-then-insert replaces these authoritative checks.

The historical active-edge unique index covers organisation/type/source/target.
Different decisions racing for one semantic tuple cannot commit duplicate truth;
the loser receives a controlled conflict. Same-decision replay waits on the
existing lock and returns the committed operation, with conflicting fingerprints
rejected. The operation has a foreign key to its resulting canonical edge, and
the edge has a tenant-scoped FK to its governing decision. Thus no workflow
APPLIED operation can lack the edge, and no workflow-created edge can commit
without its decision and operation/outbox linkage. The analogous object RPC
keeps object + exact mapping + operation + outbox atomic.

New mappings are append-only and service-role scoped with RLS enabled. Public,
anon and authenticated table/function privileges are revoked; service_role gets
the required access. Functions use SECURITY INVOKER and fixed search paths.
Trusted org filters and compound FKs protect reads and writes; no client-supplied
tenant or cross-tenant candidate/evidence becomes authority.

These are inspected SQL transaction/constraint properties with passing structural
tests. No PostgreSQL migration execution, runtime RLS test or concurrent database
experiment was performed, as explicitly required by the migration-tests-only
scope. This is review readiness, not deployment/runtime certification.

## 38. Validation results for the completed continuation

All final affected checks passed. Counts below exclude failed intermediate runs
and avoid double-counting reruns. Baseline history in section 29 remains intact.

| Suite / command | Final result |
| --- | --- |
| `npm test`, packages/canonical-contracts | 112 passed |
| `npm test`, packages/governance-review | 161 passed |
| Scanner targeted command below | 107 passed |
| Dashboard relationship-resolution.test.ts | 25 passed |
| Dashboard relationship-decision-to-truth-migration.test.ts | 9 passed, structural only |
| Dashboard decision-commands.test.ts | 17 passed |
| Dashboard discovery-intake-service.test.ts | 34 passed |
| Dashboard decision-query-boundary.test.ts | 6 passed |
| Dashboard routes-governance-decision.test.ts | 11 passed |
| Dashboard object-candidate-reconciliation-continuity.test.ts | 2 passed |
| Dashboard reconciliation-readiness.test.ts | 8 passed |
| Canonical and governance `npm run typecheck` | Both passed |
| Root `npm run typecheck:scanner` | Passed |
| Root `npm run typecheck:dashboard -- --incremental false` | Passed |
| `git diff --check` | Passed; all 27 exact milestone files also checked before commit |

Total: **492 passing tests**, including **9 SQL structural tests**; four passing
affected typechecks. No unrelated expensive suites or Validation Lab run.

Scanner command, packages/scanner:
`node --import tsx --test test/discovery-engine/relationship-correlation.test.ts test/discovery-engine/agent-version-correlation.test.ts test/discovery-engine/object-candidate-normalization.test.ts test/discovery-engine/agent-version-technical-signals.test.ts`.

Dashboard tests run as independent processes from apps/dashboard:
`node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/<file>`.
The initial relationship resolution and continuity/readiness runs also used
`--test-isolation=none`. Route mocks require normal test isolation; rerunning with
the repository's normal isolation passed all 11 without a production route fix.
Sandbox esbuild spawn restrictions required approved local test execution outside
the sandbox; all persistence was mocked and no service connection was used.

Concrete intermediate failures fixed: the old intake fake keyed only file scope,
the old suppression assertion treated AGENT/MODEL/TOOL as one mapping, server-only
import was not first, and new fixtures lacked hashing/review-subject mock methods.
The new same-file governed fixture needed an explicitly typed AgentVersion finding.
These corrections preserve production detector behavior and strengthen the intended
new mapping semantics. No failures are left unresolved.

## 39. Original 52-case acceptance accounting

The following maps all requested cases to actual test paths. ?SQL? means structural
validation and inspection, not a live database execution claim.

| Cases | Final evidence |
| --- | --- |
| 1-5 | Governance authority/negative materialization tests; dashboard REJECT/DEFER; PROPOSED/machine/missing-chain failures |
| 6-11 | New governance CREATE/MATCH x source/target x missing/ambiguous/wrong-kind/wrong-tenant/wrong-object matrix; dashboard resolver negatives |
| 12-14 | USES_MODEL/USES_TOOL governed decisions retain minimal canonical AGENT_VERSION; wrong-kind negatives |
| 15-17 | Governed persisted CREATE workflow, dashboard real command, stable semantic ID/replay, SQL active-edge unique index |
| 18-23 | Dashboard exact match/state ID and eight wrong-tuple/kind/direction/active-state tests; domain directed failures |
| 24-26 | Persisted rejection audit retains candidate/support; no writes; dashboard replay |
| 27-30 | Candidate-content/hash checks, evidence/assertion preservation, missing candidate support failure; SQL decision/candidate/state/support linkage |
| 31-32 | V1/V2 canonical workflow preserves V1 and creates two distinct edges; scanner same-Tool test |
| 33-36 | Domain and dashboard replay/conflict/substitution tests; SQL final-review lock and edge/operation uniqueness; concurrency not executed |
| 37-39 | Domain tenant/evidence gates, dashboard session route and scoped reads, SQL compound tenant FKs |
| 40-44 | All five blocked-family scanner tests, including same-file co-presence; production scanner diff empty |
| 45-48 | Missing governed-chain materialization rejects L8/LLM/Graph/scanner labels; real intake forbidden-port tests; no added authority path |
| 49 | Existing object command, materialization and MODEL/TOOL continuity tests; object source mapping intentionally adapted by accepted ADR |
| 50 | Twelve minimal canonical relationship type cases; non-behavior EXPOSES server constructor; closed taxonomy unchanged |
| 51-52 | 107 scanner and 112 canonical tests passed |

## 40. One focused continuation adversarial pass completed

This is the single requested continuation pass, following the historical STOP;
no new broad architecture audit or delegation was started.

| Attack / defect | Outcome |
| --- | --- |
| File provenance mistaken for object identity; AGENT/version collision | Exact typed normalized unique tuple and independent three-object workflow |
| V1/V2 collision | Existing revision-aware discriminator and distinct canonical source IDs |
| Fabricated versionCode; UUID semantic key | No fallback; malformed discriminator rejects; ordinary detector row IDs excluded |
| Latest/first/current version guess | Resolver counts semantic identities, then requires the exact unique tuple |
| Ambiguous legacy mapping accepted | No legacy resolver fallback or backfill |
| Wrong endpoint kind; AGENT substituted | Contract, resolver and SQL type matrix fail closed |
| Cross-tenant mapping/candidate | Tenant filters, compound FKs and negative domain/server tests |
| Implicit endpoint object creation | No object write in relationship RPC; throwing object port in relationship workflow |
| Duplicate truth; reversed MATCH_EXISTING | Directed deterministic identity, exact active match, database unique index |
| Candidate or finalized decision substitution | Full durable candidate comparison; fixed SQL review/candidate trigger; controlled final-decision conflict |
| Missing candidate support borrowed from finding | Fixed domain support gate and explicit regression; SQL support subset recheck |
| Transaction split / partial successful state | Canonical edge + governed linkage + APPLIED operation + outbox in existing RPC transaction |
| L8 / LLM / Graph authority leak | No new path; governed-chain and machine/intake negatives pass |
| Blocked L9 families populated | No detector changes; five blocked cases pass |

No unresolved defect requiring a new architecture decision was found. The review
retains the explicit no-live-database validation limitation rather than presenting
in-memory fixtures as concurrency/RLS runtime proof.

## 41. Scope and remaining operational limitations

The final change is limited to the accepted ADR, canonical endpoint contract and
its tests, governance exact-identity/gates/tests, dashboard decision/readiness/UI/
intake/materialization adapters and tests, this evidence, and one new migration.
Historical migrations, frozen baseline documents, L8, LLM, Graph and scanner
production code are unchanged. The complete 27-file manifest is the PR diff.

Object endpoints must be governed first. Legacy-only or ambiguous source inputs
need explicit governance; no automatic remediation or inferred current version.
The relationship UI can report positive endpoint readiness before supported
behavior fingerprint availability; the command still rejects missing/ambiguous
fingerprint metadata. There is no live migration, browser/runtime deployment
certification, external model request or production verification in this scope.

## 42. Delivery gate

All milestone implementation and scoped validation gates pass under the expressly
authorized structural migration validation. Verdict:
**RELATIONSHIP_DECISION_TO_TRUTH_V1_READY_FOR_REVIEW**.

Delivery uses at most two logical commits: (1) accepted ADR plus contract/persistence
adaptation; (2) decision-to-truth integration, tests and evidence. Push normally to
`feat/relationship-decision-to-truth-v1` and open the requested PR against main.
Commit SHAs and PR URL are reported in the final handoff; this evidence is included
in that delivery rather than requiring a third metadata-only commit.

Merge status: **NOT MERGED**. Production status: **UNTOUCHED**.
Milestone 8: **NOT STARTED**. No amend, force push or protected-file operation.


## 43. PR #28 external legacy compatibility gate

Starting branch: `feat/relationship-decision-to-truth-v1`.
Starting HEAD: `fb46fcc5e1cb5b4bd4943d7312959e29947c6bd0`.
Required base checks passed; only the protected recovery entry was untracked.
This was the requested surgical external-review gate, not a milestone restart
or broad audit. Earlier STOP and continuation evidence remain above unchanged.

The external compatibility finding was valid. Exact-only intake no longer
suppressed a legacy-only semantic object, while the new CREATE_NEW object ID
could differ from the historical ID. The new exact mapping constraint alone
could therefore allow a second canonical object when no exact mapping existed.
The earlier evidence did not prove this compatibility case; this follow-up fixes it.

The new server preflight follows the active legacy mapping's original governed
OBJECT decision to its durable normalized candidate, within the same organisation,
source scope and object kind. It checks the historical canonical object/kind,
candidate envelope/hash and exact normalized identity. It never recovers identity
from a latest review, first candidate, filename alone or arbitrary version label.
The materialization transaction repeats the historical decision/candidate proof
using `legacy_canonical_object_for_candidate` before any canonical object write.

| External case | Final behavior and focused proof |
| --- | --- |
| A. Legacy-only same kind and normalized semantic object | CREATE_NEW returns a controlled conflict before authorization persistence, including a rescan with different candidate/finding row IDs. RPC independently rejects LEGACY_OBJECT_ALREADY_CANONICAL. |
| B. Legacy AGENT versus same-source AGENT_VERSION | Kind-scoped compatibility lookup leaves the version independent. Existing canonical-parent requirements still apply to actual materialization. |
| C. Legacy AgentVersion V1 versus V2 | Existing normalized revision discriminators compare exactly: identical V1 is blocked from CREATE_NEW; proven V2 is independent. No versionCode fabricated. |
| D. Ambiguous same-kind history | Missing decision/candidate/discriminator, multiple mappings, mismatched tenant/kind/source, or substituted envelope fail closed. No first/newest/current guessing. |
| E. Deterministic reconstruction | Repeated preflight is read-only and stable; all reads are tenant-scoped. Exact MATCH_EXISTING must select the historical canonical object. Foreign-tenant legacy rows cannot affect this tenant. |

The item may remain in the review queue. The server rejects duplicate CREATE_NEW
with an explicit instruction to use governed MATCH_EXISTING. No coarse
ALREADY_GOVERNED suppression was restored. When history proves the same semantic
identity, only an explicitly governed MATCH_EXISTING to that historical object
can establish the new exact mapping; no automatic backfill or legacy row mutation
occurs. If history cannot prove identity, positive reconciliation fails closed.
Different typed semantic identities continue through normal independent governance.

## 44. Identity, contract and transaction re-confirmation

Inspected the actual AgentVersion producer once for this gate. Its discriminator
is `SHA256(JSON.stringify([sourceScope, technicalRevisionFingerprint]))[:32]`.
Source scope hashes only connection/type/external ID. The technical projection
contains normalized Agent code and labeled normalized technical values, sorted
and deduplicated in fixed family order, plus protected Prompt content fingerprints.
Technical profile signal families and values are also sorted. The hash inputs
exclude timestamps, UUIDs, database row IDs, ReviewSubject IDs, Evidence IDs,
SourceAssertion IDs and line numbers. Evidence/assertion union and observed time
are assembled after the discriminator. Real Model changes alter the projection;
input enumeration and irrelevant location changes do not. The existing 22-test
AgentVersion correlation suite passed again. No scanner code changed.

The governed canonical-only endpoint adaptation remains separate from discovery.
The existing explicit candidate-injection test rejects both replacement and
augmentation of either discovery endpoint with canonicalObject. That test and
all twelve minimal governed endpoint cases passed (13 selected contract tests).
No canonical-contract change was needed.

The object RPC retains its original per-decision lock/replay path. Its new legacy
proof runs after durable decision/candidate and parent checks, before inserting
canonical object, exact mapping, APPLIED operation or outbox. A same-object CREATE
or wrong-target MATCH raises and rolls back the transaction; old APPLIED operations
still replay before any new compatibility interpretation. Exact mapping uniqueness
and operation fingerprint replay remain authoritative. The legacy rows are
immutable, and this PR's object writer creates only exact mappings, so application
preflight is not the duplicate-prevention boundary.

The relationship RPC is unchanged by this gate. Its directed semantic tuple
remains protected by the existing database unique index. Object/mapping/operation/
outbox and relationship/operation/outbox transaction structure and tenant/linkage
foreign keys passed the structural checks again. These are structural SQL proofs,
not live SQL, RLS or concurrency execution claims.

The already-unmerged PR migration
`20260909210640_relationship_decision_to_truth_v1.sql` was extended in this new
follow-up commit. There remains one new migration in PR #28. No historical/main
migration was edited, no prior Git commit was amended, and no migration was run.
The compatibility helper is SECURITY INVOKER with fixed search_path, service-role
execute access and public/anon/authenticated access revoked.

## 45. Focused gate validation

| Command / suite | Final result |
| --- | --- |
| Dashboard legacy-object-mapping.test.ts | 14 passed |
| Dashboard decision-commands.test.ts | 17 passed; includes sanitized legacy RPC conflicts |
| Dashboard relationship-resolution.test.ts | 25 passed |
| Dashboard relationship-decision-to-truth-migration.test.ts | 12 passed; SQL structural only |
| Governance materialization-invocation.test.ts + relationship-decision-to-truth.test.ts | 61 passed |
| Canonical selected minimal endpoint and discovery-injection boundary tests | 13 passed |
| Scanner existing agent-version-correlation.test.ts | 22 passed |
| `npm run typecheck:dashboard -- --incremental false` | Passed |
| `git diff --check` and exact changed-file whitespace check | Passed |

Total **164 focused tests passed**, without double-counting reruns. Dashboard
files ran with `node --conditions=react-server --experimental-test-module-mocks
--import tsx --test tests/<file>`, using normal test isolation. Governance/scanner
used `node --import tsx --test` with the named files. Canonical selection used
`node --test --test-isolation=none --test-name-pattern='canonical endpoint acceptance
never permits|Accepted canonical endpoint ADR' test/contracts.test.mjs`.

One initial new MATCH_EXISTING test failed because its database query mock lacked
`.in()` used by the existing source-summary lookup; completing that mock fixed it.
No unresolved test failure. Dashboard is the only changed TypeScript package;
canonical, governance domain and scanner production contracts are unchanged.
No Validation Lab, live Supabase, production or external model calls.

## 46. External gate delivery

Seven changed files: new legacy preflight module and its focused tests; existing
object command service and command tests; the PR's new migration and structural
tests; this evidence. No intake detector, canonical contract, L8, LLM or Graph change.

One authorized follow-up commit:
`fix(governance): harden legacy canonical mapping compatibility`.
Push normally to the existing PR #28; the final handoff records the resulting SHA.
No amend, force push, merge or milestone 8 work. Protected recovery file untouched;
no `.claude/**` inspection. Production remains **UNTOUCHED**.

Verdict: **PR28_M7_HARDENING_READY_FOR_REVIEW**.
Merge status: **NOT MERGED**. Milestone 8: **NOT STARTED**.
