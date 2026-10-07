# Governed Discovery Machine Execution Boundary V1

## 1. Status

**ACCEPTED / FROZEN**

Architecture owner approval: 2026-10-01. Architecture: `GOVIA-L0L16-CIA-v1.0`.

ACCEPTED / FROZEN means this architecture contract is approved for implementation
planning. It does NOT mean implemented, tested, deployed, hosted-ready, Discovery
active or Commercial V0 completed. The new boundary does not exist today. Governed
Discovery remains **DORMANT / NOT ACTIVATABLE** through its current persistence
composition. **S1B.3: NOT STARTED** by this work.

Review sequence: the independent adversarial review returned **PASS_WITH_CORRECTIVES**
(material findings H-1, H-2, M-1, M-2, M-3, M-4). The corrective revision was
independently re-reviewed with **PASS** and **READY_TO_FREEZE**; remaining
BLOCKER/HIGH/MEDIUM findings: NONE. The three LOW re-review clarifications D-L1,
D-L2 and D-L3 are incorporated in sections 13, 7/9 and 15 respectively. Freeze
evidence: [architecture-freeze record](../codex/evidence/2026-10-01-governed-discovery-machine-adr-freeze.md).

## 2. Decision metadata

| Item | Value |
|---|---|
| ADR ID | `ADR-GOVIA-GOVERNED-DISCOVERY-MACHINE-EXECUTION-BOUNDARY-v1` |
| Date | 2026-10-01 |
| Repository | `cnegrao/code-guard-governance` |
| Reviewed branch | `feat/m16-s1b-governed-registries` |
| Reviewed baseline HEAD | `7170131a73293e8b3b89ec4f8765ac7c9ca65b66` |
| Architectural baseline | `GOVIA-L0L16-CIA-v1.0`, unchanged |
| Prior architecture conclusions | `GOVERNED DISCOVERY MACHINE BOUNDARY: READY_FOR_ADR`; `MACHINE EXECUTION PRINCIPAL: READY_FOR_ADR` |
| Independent review | `PASS_WITH_CORRECTIVES`, then corrective re-review `PASS` / `READY_TO_FREEZE` |
| Status | `ACCEPTED / FROZEN`; architecture owner approval 2026-10-01 |
| First consumer | GitHub Commercial V0, CORE L0, not M19 |
| Selected transport | Direct PostgreSQL wire protocol with verified TLS as V1 baseline; pooler subject to section 8 acceptance |
| Authority ceiling | `DETECTED -> PROPOSED` only |
| Scope of this artifact | Architecture documentation only |

MUST, MUST NOT and REQUIRED express obligations of the **DECIDED FUTURE
ARCHITECTURE** as accepted and frozen. They are not claims about current implementation.
Concrete function names below are conceptual contracts unless explicitly
identified as existing functions; physical signatures and DDL remain future work.

Primary repository references:

- [CIA baseline](./GOVIA-L0L16-CIA-v1.0.md) and [Commercial V0 roadmap](./GOVIA-L0L16-CIA-v1.0-roadmap.md).
- [M16 L14 ADR](./ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md).
- [HUMAN governed-write ADR](./ADR-GOVIA-M16-S0.3.3-GOVERNED-WRITE-BOUNDARY-v1.md) and [credential-epoch ADR](./ADR-GOVIA-M16-S0-CREDENTIAL-EPOCH-BINDING-v1.md).
- [Discovery intake](../../apps/dashboard/lib/governance/discovery-intake.ts), [intake persistence](../../apps/dashboard/lib/governance/discovery-intake-persistence.ts), [review persistence](../../apps/dashboard/lib/governance/persistence.ts) and [materialization persistence](../../apps/dashboard/lib/governance/materialization.ts).
- [SourceAdapter](../../packages/scanner/src/discovery/source-adapter.ts), [GitHubSourceAdapter](../../packages/scanner/src/discovery/adapters/github-source-adapter.ts), [provenance](../../packages/scanner/src/discovery/provenance.ts) and [evidence assembly](../../packages/scanner/src/discovery/evidence-assembly.ts).
- [Proposal strategy](../../packages/governance-review/src/semantic-proposal-strategy.ts) and [review transitions](../../packages/governance-review/src/transitions.ts).
- [Raw RPC revocation](../../supabase/migrations/20260928190000_m16_s0_contract_raw_write_rpc_revocation_v1.sql), [technical owner hardening](../../supabase/migrations/20260930160000_m16_s1b2r1_definer_capability_surface_v1.sql), [runtime execution closure](../../supabase/migrations/20260930170000_m16_s1b2r2_runtime_execution_closure_v1.sql) and [S0 execution closure](../../supabase/migrations/20260930180000_m16_s1b2r3_s0_execution_context_closure_v1.sql).

The reviewed working tree also contains PRE-DEMO P0 corrections and evidence.
Those existing changes are preserved and are not part of this ADR's implementation.
Repository evidence does not attest the configuration of a hosted database.

## 3. Context / problem

Commercial V0 requires the following governed chain:

```text
GitHub
-> GitHubSourceAdapter
-> SourceAdapter
-> evidence-backed acquisition/provenance
-> Discovery
-> PROPOSED
-> HUMAN Governance Review
-> reconciliation/materialization
-> Canonical Truth
-> Passport / Graph projections
```

The scanner, deterministic provenance, findings, normalization, review subjects
and machine proposal logic already exist. M16-S0.3.3D correctly revoked direct
application EXECUTE on raw governance functions, including
`gov_repo.apply_review_transition`. The dormant Discovery composition still
uses that raw function for proposal persistence.

The missing boundary is an explicit owner-controlled machine execution model
covering both upstream intake admission and the final proposal. Reopening the
raw function, supplying a HUMAN principal, or placing `service_role` in a worker
would not supply that boundary.

## 4. Existing state

**CURRENT IMPLEMENTATION — repository evidence, not the future boundary.**

The governed Discovery machine producer remains dormant. The new isolated worker,
its production `pg` dependency, machine-principal/credential control tables,
execution-binding tables and closed machine RPCs do not exist. Hosted connectivity
for this boundary is not proven. All corrected requirements below describe future
work; this document creates none of those capabilities.

`runGovernanceDiscoveryScan` has no active production route/job caller in the
reviewed code. It composes scanner discovery with the following default ports:
`governanceReviewPersistence`, `discoveryIntakePersistence`,
`materializationPersistence`, `agentVersionTechnicalProfilePersistence` and
`executionContextPersistence`.

The exact proposal breakpoint is:

```text
runGovernanceDiscoveryScan
-> processObjectCandidate / processRelationshipCandidate / processAgentVersionCandidate
-> ensureReviewSubjectAndPropose
-> ports.review.persistReviewTransition(proposal)
-> governanceReviewPersistence.persistReviewTransition
-> privilegedDb.rpc("apply_review_transition", ...)
-> application-role EXECUTE denied by S0.3.3D
```

Upstream intake functions were not all revoked. Incorrect activation can persist
pre-canonical rows and a `DETECTED` subject before proposal fails. Item errors
are collected; the scan is not one atomic transaction. Scanner acquisition
success and governed-intake success are different outcomes.

| Current operation | Classification | Required future treatment |
|---|---|---|
| `start_acquisition_run`, `complete_acquisition_run` | Non-authoritative intake write | Run-scoped admission/conclusion commands |
| `record_discovery_evidence`, `record_discovery_source_assertion` | Non-authoritative intake write | Typed, source-bound admission |
| `record_discovery_finding`, `record_discovery_candidate` | Non-authoritative intake write | Typed admission with content-conflict checks |
| `record_lineage_observation` | Auxiliary pre-canonical intake | Restricted lineage-observation command |
| `create_review_subject` | Intake creating `DETECTED` | Restricted creation from durable finding |
| `getReviewSubject`, `getNormalizedCandidateForFinding` | Read | Exact binding-scoped reads |
| `findActiveObjectSourceMapping` | Read of canonical mappings | Exact tenant/source lookup, never general canonical access |
| `record_agent_version_technical_profile_proposal` | Auxiliary pre-canonical intake | Proposal-only technical-profile command |
| Execution-head read and `record_execution_snapshot` | Read and auxiliary pre-canonical intake | Restricted snapshot command with internal head resolution |
| `persistReviewTransition` | Governance proposal write | Closed machine PROPOSE command |

Broad ports also expose reconciliation, authorization decisions, materialization
and execution-field decisions. The intake does not call those methods today;
their presence on a port is not permission to expose them to the future worker.
In particular, the technical-profile materializer exists but is not called by
the current Discovery intake.

The dashboard's [DB client](../../apps/dashboard/lib/db.ts) and review persistence
use `supabase-js` over HTTP/PostgREST with `SUPABASE_SERVICE_ROLE_KEY` for privileged
operations. No production direct-PostgreSQL client/pool is demonstrated for this
Governance Core. `pg` in `graphos-complete` is a development dependency, not that
production capability. QStash/cron paths there are separate flows, not an active
governed Discovery worker. The PG17 harness uses `psql`; its `trust` authentication
setup is not evidence of password authentication.

The current HUMAN wrappers use verified HUMAN session metadata, exact credential
epoch binding and transactional current role eligibility. They MUST remain a
separate authority model. Their owner/lock/replay/security patterns are reusable;
their HUMAN identity and administrator authority are not machine credentials.

## 5. Architectural forces

The following frozen invariants MUST be preserved:

```text
SOURCE ASSERTION != CANONICAL FACT
DISCOVERY != GOVERNANCE AUTHORITY
SCANNER MACHINE AUTHORITY CEILING = PROPOSED
HIGH CONFIDENCE != VALIDATED
CAPABILITY != AUTHORIZATION
SEMANTIC SIMILARITY != PHYSICAL IDENTITY
VECTOR SIMILARITY != CANONICAL MERGE
GRAPH PROJECTION != SYSTEM OF RECORD
LLM OUTPUT != CANONICAL TRUTH
UNKNOWN != FALSE
MISSING EVIDENCE MUST NEVER BE FABRICATED
```

Additional boundary distinctions are REQUIRED:

```text
SOURCE IDENTITY != SOURCE AUTHORIZATION
AUTHENTICATED EXECUTOR IDENTITY != AUTHORIZED TENANT/SOURCE SCOPE
OBSERVATION / ADMISSION != GOVERNANCE PROPOSAL
LOGICAL MACHINE PRINCIPAL != CREDENTIAL GENERATION
```

Least privilege, current DB-enforced authority, tenant isolation and safe replay
take precedence over minimizing code changes. Infrastructure additions MUST have
a demonstrated purpose; this decision requires neither a generic rule registry
nor an asynchronous command broker.

## 6. Decision

**DECIDED FUTURE ARCHITECTURE — not implemented.**

| Dimension | Selected contract |
|---|---|
| Machine principal | Stable logical Discovery workload principal per environment |
| Authentication | Restricted PostgreSQL LOGIN for the current credential generation |
| Transport | Direct PostgreSQL/TLS baseline; authenticated LOGIN identity preserved on every command |
| Runtime | Dedicated isolated Node process with a limited `pg.Pool` |
| Authorization root | Owner-controlled principal/current generation/execution bindings and closed capabilities, checked transactionally by DB |
| Administration | OUT-OF-BAND TRUSTED PROVISIONING only; no application-facing administration in V1 |
| Intake capability | Typed pre-canonical admission and narrowly required reads |
| Proposal capability | Dedicated `DETECTED -> PROPOSED` command |
| Proposal actor | `DETERMINISTIC_RULE`, `PASS_THROUGH_V1 / 1.0` |
| Worker service-role / HUMAN / provisioning credentials | NONE |
| Worker canonical write access | NONE |

The DB MUST reconstruct or verify all authority-sensitive values. The machine
MUST NOT select a more powerful action through a parameter or an alternative port.

## 7. Machine principal

One stable logical principal per Discovery workload/environment is the V1 default.
It MUST be independent of credential generation, tenant, source connection and
worker instance. A credential generation MUST map to exactly one logical principal.

V1 MUST NOT require a PostgreSQL user per tenant, connection or ephemeral worker
instance. Replicas of a workload may share its principal; instance identifiers
are operational correlation, not authorization. Future workload partitioning
into disjoint binding sets MAY be introduced for stronger customer isolation;
it is not a V1 requirement.

A compromised principal can exercise only its explicitly assigned bindings and
capabilities. There MUST NOT be implicit wildcard access to every organisation
in an environment. This is a workload boundary, not a claim of isolation among
all bindings deliberately assigned to the same workload.

A fully compromised worker's effective authority is the UNION of the capabilities
of every binding currently assigned to its machine principal. Tenant/source
assignment still structurally limits the worker; section 9 defines how bindings
differ and what that separation does and does not provide.

## 8. Transport

Direct PostgreSQL is the baseline V1 transport. The machine transport MUST preserve
the authenticated PostgreSQL LOGIN identity such that `session_user` resolves to
the machine credential role for every command. It MUST use verified TLS and the
generation-specific restricted LOGIN. Certificate-chain and server identity
verification MUST NOT be disabled. A bounded `pg.Pool` MUST be dedicated to the
worker and credential generation, not created per tenant or request.

The existing Supabase HTTP/PostgREST client MUST NOT be used as the machine
identity transport in V1. Through PostgREST, `session_user` identifies its DB
connection identity, not an individual worker; `current_user` can be the role
assumed for the request. Under the selected direct transport, `session_user`
identifies the authenticated machine LOGIN. Inside `SECURITY DEFINER`,
`current_user` may instead be the technical owner.

Eligibility MUST therefore resolve:

```text
session_user / authenticated login
-> known current credential generation
-> enabled logical machine principal
-> current execution binding and capability
```

Caller-supplied `machine_principal_id`, headers, GUCs, repository metadata or role
names MUST NOT establish authentication. Technical owners MUST NOT provide an
escape path for changing session identity or executing arbitrary SQL.

A pooler, including Supavisor, MAY be used only when implementation acceptance
proves preservation of the authenticated machine role and correct `session_user`
on every command, verified TLS/security on the connection path, no privilege
expansion, and unchanged transaction/replay semantics. A pooler is neither required
nor categorically prohibited. Acceptance MUST cover the exact deployed pooler
mode/configuration; product name alone is not evidence. This conditional path
does not authorize silent fallback or claim that a pooler has passed acceptance.

**NO AUTHORIZATION-RELEVANT SESSION-LOCAL STATE.** Authorization MUST NOT depend on
GUCs, temp tables, session variables, prepared-statement state, mutable per-session
role context or any other session-local artifact. Every command MUST be
self-contained and re-establish current authority from durable DB state using
the authenticated LOGIN anchor. Prepared statements may carry queries, never
cached authorization. Pool reuse MUST NOT transfer authority between commands.

This transport is a new runtime requirement, not a deployed capability claim.
If neither the direct baseline nor an explicitly accepted identity-preserving
pooler provides compliant connectivity, activation is **BLOCKED**. Any departure
from this identity/security contract requires an explicit ADR revision. There
MUST NOT be silent fallback to PostgREST identity, `service_role`, gateway
delegation, unaccepted pooling or HUMAN JWTs. Existing dashboard transport is
unaffected.

## 9. Execution binding

Owner-controlled persistence MUST distinguish principal/credential state from
execution scope. Principal persistence MUST identify the stable principal, known
login generations, the current valid generation, enabled/revoked state, validity
and administrative provenance. Passwords MUST NOT be stored in application tables.
Role mappings MUST use the provisioned PostgreSQL role OID and expected role name
as specified in section 13; a familiar name alone MUST NOT qualify a login.

V1 administration is **OUT-OF-BAND TRUSTED PROVISIONING**: DBA, migration or
controlled provisioning paths only, with explicit operational authorization and
administrative provenance. There MUST be no dashboard route, worker-callable
administration, `service_role` administration, HUMAN governance wrapper reuse or
application-facing admin API. A future application-admin surface for principals,
credential generations or bindings requires a separate explicit architecture
decision. The worker MUST NOT administer principals, credential generations,
bindings, capabilities, binding revisions or credential mappings. Internal
capability owners do not acquire provisioning authority by owning a command.

Each execution binding MUST express:

| Required semantic field | Purpose |
|---|---|
| `binding_id` | Immutable DB-generated execution-binding identity; never reused |
| `machine_principal_id` | Workload assigned to the scope |
| `organisation_id`, `source_connection_id` | Explicit tenant and existing source identity |
| Provider/source system | Verify the acquisition's origin |
| Configured source locator and normalized locator | Original identity descriptor plus deterministic scope comparison; section 12 |
| Provider-immutable repository ID, where available | Pinned source authenticity metadata; not a new GOV IA identity namespace |
| Authorized ref | Exact configured ref in V1 |
| Adapter name/version | Exact allowed adapter/version in V1 |
| Intake capability state | Independent permission to admit observations |
| PROPOSE capability state | Independent permission to propose |
| Proposal rule code/version | Exactly `PASS_THROUGH_V1 / 1.0` in V1 |
| `binding_revision` | Monotonic per `binding_id`, never reset; invalidate stale context |
| Enabled/disabled/revoked state | Current eligibility; revocation is terminal |
| Administrative provenance | Who established/changed the binding and when |

The DB MUST generate `binding_id`; it MUST remain stable and never be reused.
Every authority-relevant change, including capability changes, disabling,
re-enabling a non-revoked binding and revocation, MUST advance `binding_revision`
under the binding lock. Revision MUST never reset or wrap to a reusable value.
Revocation MUST be terminal: a revoked binding MUST NOT be re-enabled.
Re-establishing equivalent scope MUST create a new `binding_id`. Retained history
or tombstones MUST prevent delete-and-recreate from resurrecting an old identity;
deleting authority records MUST NOT erase the non-reuse obligation.

V1 has a closed uniqueness model. At most one non-revoked binding, including a
temporarily disabled binding, may exist for the exact tuple:

```text
(machine_principal_id, organisation_id, source_connection_id,
 authorized_ref, adapter_name, adapter_version)
```

Provider and locator MUST be consistent with that connection as defined in
section 12. To prevent casing aliases with different legacy connection hashes,
the DB MUST also enforce uniqueness among non-revoked bindings on:

```text
(machine_principal_id, organisation_id, provider, normalized_locator,
 authorized_ref, adapter_name, adapter_version)
```

Intake and PROPOSE capability states belong to this one binding; capability/rule
MUST NOT partition these keys into competing grants. The V1 scope tuple is
immutable for a binding: changing it requires revoke-and-create, not retargeting
existing runs. Atomic DB uniqueness enforcement MUST serialize concurrent
provisioning, including case variants, and reject overlapping authority. This
does not prohibit distinct principals or tenants from independent assignments.

Multiple legitimate bindings MAY exist over the same organisation/source
connection with different refs, adapter versions or capability states. Binding
separation remains REQUIRED for authorization, audit, revocation, configuration
and run provenance. It is NOT a security boundary against a fully compromised
worker legitimately assigned to all of those bindings: ref resolution and adapter
version are worker-reported (section 12), so that worker holds the union of their
capabilities. Capability differences between bindings assigned to one principal
MUST NOT be described as isolation from that principal. Where stronger isolation
between binding groups is required, distinct principals/workloads MAY be used
later; V1 does NOT require one principal per binding and keeps the
principal-per-workload/environment default.

AcquisitionRun MUST durably preserve both `binding_id` and `binding_revision` at
admission. Commands MUST resolve that exact pair; they MUST NOT search for an
equivalent newly active scope to authorize an old run. An unknown, deleted,
revoked or revision-mismatched binding MUST fail closed, including on replay.
Invocation audit MUST preserve the same pair, retaining original and current
attempt context where they differ. Binding identity identifies the authorization
row, the lock target, revocation target and audit provenance; revision alone is
not an identity.

The binding references existing deterministic source identity; it MUST NOT create
a duplicate general source registry. `technical_source_connections` MUST NOT be
silently repurposed: its technical-fact purpose, global connection key, immutability
and lack of execution lifecycle do not meet this contract.

The binding's enabled state controls the source's availability to that executor.
This MUST NOT be described as proof of an already-existing global connection
lifecycle. There is no extensible rule registry, adapter-version range or generic
ref-policy language in V1. Future broader grammars require explicit review.

Selection by `binding_id` is permitted only after the DB checks that it belongs
to the authenticated principal; selecting an ID is not a grant.

Every successful command, including a replay and restricted read, MUST verify
current credential validity, enabled principal, active organisation, enabled
binding, matching `binding_id`/`binding_revision` and run context,
tenant/source/configuration, adapter/version and requested closed capability.
PROPOSE additionally MUST verify the fixed rule/version. New runs MUST bind to
the current identity/revision; subsequent commands MUST verify their admitted
run rather than reconstruct scope from input.

Eligibility and its protected mutation MUST execute in one transaction. The
implementation MUST use a consistent lock order covering principal, organisation,
binding row keyed by immutable `binding_id`, run and affected subject, compatible
with existing HUMAN subject locks. Provisioning, revision changes and revocation
use the same guards and uniqueness constraints; changing a scope lookup MUST NOT
evade locking the original binding. `READ COMMITTED`, fresh DB-clock validity checks
and final eligibility verification before successful return are REQUIRED;
unsupported isolation MUST fail closed. The concrete lock graph requires PG17
concurrency proof. Locks remain held until transaction completion.

## 10. Intake capability

Intake admission MUST be restricted to typed pre-canonical state required by the
existing pipeline: AcquisitionRun, Evidence, SourceAssertion, DiscoveryFinding,
NormalizedCandidate when valid, and ReviewSubject in `DETECTED` only.

The existing typed auxiliaries are also within this capability: lineage
observation, AgentVersion technical-profile proposal, and non-authoritative
execution snapshot. Execution snapshots MUST NOT become permission decisions;
unknown authorization stays `UNKNOWN`. A technical-profile proposal MUST NOT
materialize or validate a canonical profile.

Execution snapshots MUST use a restricted machine intake command. `source_scope`
MUST be derived internally or validated against the admitted run's `binding_id`,
`binding_revision`, organisation and source connection; worker-supplied scope
MUST NOT be accepted as authoritative. Recording a snapshot MUST NOT give the
executor the broader capability surface of the existing runtime technical owner.

Closed commands MUST cover run admission/conclusion, evidence/assertion admission,
finding/candidate admission, subject creation and these auxiliary types. Their
exact grouping is an implementation choice subject to transactional consistency;
it MUST NOT create a generic table-write API. Evidence/support MUST be durable
before subjects reference it. Subject creation MUST use the durable finding,
derive its identity, and fix its initial state to `DETECTED`.

Narrow reads for the existing flow are permitted: exact subject/candidate lookup,
parent/endpoint checks, and exact canonical source mapping lookup. They MUST be
tenant/source scoped and MUST NOT expose broad table SELECT. Execution-head
resolution SHOULD occur inside the restricted snapshot command.

Canonical mapping lookup MUST be READ ONLY, tenant-scoped, source-scoped and
exact-key only. List, prefix, LIKE, pattern, enumeration and broad tenant scans
MUST NOT be exposed. Out-of-scope and nonexistent mapping references SHOULD
return a uniform result, without distinguishing foreign existence, so this
lookup cannot become a broader cross-scope existence oracle.

Intake MUST NOT issue governance decisions, validate, reconcile, materialize or
write canonical state. Intake authorization MUST NOT imply PROPOSE authorization.
An intake-only binding can legitimately leave a subject at `DETECTED`.

Run opening, consistent admission units and run completion may use multiple
transactions. Partial durable intake MUST remain observable and retryable;
it MUST NOT be presented as completed governance. External GitHub acquisition
MUST NOT hold a DB transaction open.

## 11. Proposal capability

A dedicated closed command is conceptually:

```text
propose_discovery_finding_v1(acquisition_run_id, finding_id)
```

Its sole governance effect MUST be `DETECTED -> PROPOSED` under
`DETERMINISTIC_RULE / PASS_THROUGH_V1 / 1.0`. The rule identifies proposal semantics;
detector codes/versions on assertions identify detection methods and MUST NOT be
confused with proposal authority.

The caller MUST NOT provide transition action, destination state, authority kind,
HUMAN actor, role, permission, arbitrary transition payload or arbitrary SQL.

The existing raw `apply_review_transition` can support more than PROPOSE. If reused
internally, the dedicated machine command MUST fix, independently of caller input,
authority kind `DETERMINISTIC_RULE`, rule `PASS_THROUGH_V1 / 1.0`, previous state
`DETECTED`, new state `PROPOSED`, and the deterministic command semantics. No
dynamic SQL or caller-controlled transition payload is permitted. The proposal
technical owner MUST receive only the minimum internal capability necessary.
Acceptance MUST prove that varying caller inputs cannot reach any other
transition. A safely narrower internal primitive MAY be used, but is not required.

| Value | Authoritative handling |
|---|---|
| Run/finding IDs | Caller-supplied selectors, verified in the authenticated scope |
| Organisation/source authority | Loaded from the current execution binding |
| Adapter/configuration/source version | Loaded from admitted run and verified against binding/provenance |
| Subject | Loaded and checked against the expected deterministic identity and durable finding |
| Command/event IDs | Derived or independently verified from the closed contract |
| Support | Loaded from same-tenant durable evidence/assertions/candidate memberships |
| Actor, rule, transition | Fixed internally |
| Current state | Loaded under subject lock |
| Invocation/application time | DB-authored; distinct from source observation time |

The command MUST reject an absent subject rather than implicitly admit it. It
MUST verify supports and existing command history before deciding first application
versus replay. New application requires `DETECTED`; successful historical replay
MUST NOT move the subject back from a HUMAN-advanced state.

Intake and PROPOSE MUST be separate explicit commands with separate capability
checks and EXECUTE grants. They may share a principal, but MUST use separate
technical owners for their distinct write powers and separate transactions.
Intake MUST NOT automatically invoke PROPOSE. The orchestrator MUST request the
second command explicitly after durable admission.

## 12. Tenant/source authority

Repository metadata MUST NOT establish tenant identity. `organisation_id` comes
from the trusted persisted execution binding. Every run and durable support MUST
remain organisation/source scoped. All lookups and relationships MUST verify
tenant membership, including candidate parents and relationship endpoints;
existence of a globally recognizable identifier is insufficient.

The same GitHub repository MAY be acquired by multiple tenants. Their bindings,
permissions and durable records remain independent. No tenant may borrow another
tenant's execution binding or evidence row, even when scanner-generated IDs match.

Existing `source_connection_id` is deterministic source identity, not authority
by itself. For GitHub V1, provider MUST be fixed to `github` and verified. The
normalized locator MUST be `owner/repo` with locale-independent ASCII lowercase
applied to both validated name components. Empty components, ambiguous URL/path
forms and leading/trailing whitespace MUST be rejected rather than silently
interpreted. Ref comparison remains exact and case-sensitive; owner/repo case
normalization MUST NOT be applied to refs or artifact paths.

The current descriptor preserves the configured owner/repo spelling; its existing
connection identity is:

```text
"source-connection:" + first32hex(SHA256(UTF8(providerCode + ":" + displayName)))
```

For GitHub, `displayName` is the original configured `owner/repo`. The binding MUST
retain that exact identity descriptor along with its normalized locator. The DB
MUST verify fixed provider, normalized locator derived from that descriptor, and
the existing connection-ID derivation as one consistent tuple. Caller-supplied
connection ID and locator MUST NOT be trusted independently. Casing variants may
compare equal for scope, but MUST resolve to the binding's persisted connection
identity; they MUST NOT substitute a second, independently supplied connection ID.
This preserves existing GOV IA identities without redefining the hash on lowercase
text or silently merging legacy records. Cross-language and casing vectors are
REQUIRED implementation gates. The binding is authoritative for allowed scope.

Where the provider exposes an immutable repository identifier, the binding SHOULD
pin it as provider-scoped source authenticity metadata. GitHub V1 acceptance MUST
exercise this pin and reject missing/mismatched observed IDs when pinned. The ID
MUST NOT replace `source_connection_id` or become a new canonical GOV IA source
namespace. Repository rename/transfer MUST NOT silently follow redirects or
retarget a binding: a locator change requires trusted provisioning to revoke the
old binding and create a new binding for the new locator/connection identity.
Old runs remain tied to the revoked identity and MUST fail. Reuse of an old locator
by a different repository MUST fail its immutable-ID pin; preserving the same
provider ID does not authorize a new locator automatically.

If an adapter cannot obtain provider-immutable identity, rename/transfer or name
reuse may be indistinguishable from the originally authorized repository. This
residual MUST be explicit and activation requires adapter-specific acceptance of
it. Any omission of an available pin also requires an explicitly justified
acceptance finding. A reported pin is subject to the compromised-worker residual
below; it is not independent proof of origin.

The admitted run MUST preserve the original configured and normalized locator,
exact ref, source connection/system, adapter/version, `binding_id`,
`binding_revision`, applicable provider repository pin and resolved immutable
source version.
GitHub evidence commit, snapshot version and run version MUST agree where the
evidence claims a commit. Hashes and evidence memberships MUST be checked, not
accepted as authoritative solely because they were caller supplied.

The DB checks admitted provenance consistency; it does not independently prove
that bytes originated from GitHub. A compromised Discovery worker holding its
valid machine DB credential and source-provider credential CAN fabricate claimed
source versions, paths, source assertions, evidence content, findings and other
permitted pre-canonical payloads inside its authorized organisation/source bindings,
unless another trusted mechanism independently reverifies them. Adapter, ref,
version, SHA and binding checks are CONSISTENCY / SCOPE controls, not independent
anti-forgery proof against a fully compromised worker.

This residual is accepted in V1 because SOURCE ASSERTION != CANONICAL FACT,
DISCOVERY != GOVERNANCE AUTHORITY and SCANNER MACHINE AUTHORITY CEILING = PROPOSED;
HUMAN governance remains the authority. HUMAN reviewers MUST NOT interpret
machine-admitted provenance as cryptographically or independently verified merely
because it was stored. Independent provider-side re-verification MAY be future
hardening; it is NOT a V1 requirement. Neither a source credential nor a content
hash grants canonical authority.

## 13. Credential lifecycle

A generation authenticates the workload, maps to exactly one logical principal,
and may be rotated/retired. It MUST NOT define tenant authority by itself.

Each credential generation MUST be keyed to the PostgreSQL role OID captured
during out-of-band trusted provisioning. On every command, credential eligibility
MUST resolve the authenticated session role to its PostgreSQL catalog OID using an
exact-name-safe mechanism and MUST compare that OID with the provisioned
credential-generation OID, AND verify the expected role name. Role OID is the
identity anchor; name is a consistency and human operability check, not the sole
identity. The implementation MUST NOT depend on an ambiguous text-to-`regrole`
cast (identifier parsing and case-folding) for security; exact catalog identity
resolution is preferred. Trusted provisioning MAY additionally constrain generated
machine role names to lowercase simple PostgreSQL identifiers. Failure to resolve
the expected catalog identity, unknown generation, OID mismatch or name mismatch
MUST FAIL CLOSED before any success, including replay. `current_user` inside a
definer MUST NOT replace this check.

Role names MUST NOT be reused across credential generations. Credential-generation
roles MUST NOT be renamed while active or retained for audit/draining. Dropping
and recreating the same role name MUST NOT restore authority. Provisioning MUST
retain retired generation/OID/name history and enforce non-reuse; it MUST NOT
remap a retired generation to a new catalog role. Historical audit records MUST
survive retirement and later role removal without resolving history by name alone.

Rotation MUST use a new restricted authenticated LOGIN for the next generation:

1. Out-of-band trusted provisioning creates the next uniquely named generation,
   captures its role OID and grants only the exact required capabilities.
2. The next credential is securely distributed; it is not eligible merely because
   a login exists.
3. Administration switches the current generation transactionally.
4. Every command from the old generation, including through already-open sessions,
   fails current DB eligibility after that switch is ordered before it.
5. Old sessions are drained/terminated operationally; old login/grants are retired
   and the role removed when safe. Audit history is retained.

Password replacement alone MUST NOT be considered sufficient revocation of
already-authenticated sessions. Login disabling and pool draining are operational
controls, not substitutes for the current-generation DB check. Credential validity
MUST be checked using DB time, including for persistent connections.

Binding/principal revocation MUST invalidate replay success. A command transaction
serialized before committed revocation may complete; one ordered after committed
revocation MUST fail. No retroactive cancellation of committed transactions is
claimed. Pool reuse MUST NOT preserve retired authority.

A run retains its admission credential generation as provenance. A new valid
generation for the same principal may retry an existing command only if that
run's exact `binding_id` and `binding_revision` remain eligible; the current
invocation's generation MUST be audited.
The historic generation is not permission to keep using an old credential.

## 14. ACL / capability security

The machine LOGIN MUST be `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
`NOREPLICATION`, `NOBYPASSRLS`, without privileged memberships. It MUST have no
SET ROLE path to technical owners, `service_role`, `authenticator` or HUMAN roles.
It MUST NOT have CREATE in trusted schemas or administer bindings/role mappings.

Only necessary schema access and explicit EXECUTE on the closed machine command
surface are permitted. Application table DML, broad table SELECT, HUMAN wrapper
EXECUTE, raw governance EXECUTE, reconciliation, materialization and canonical
write capability MUST NOT be available to the LOGIN.

**Control-table default-privilege risk.** The repository's
[legacy gov_repo grants](../../supabase/migrations/20260818013113_grant_service_role_gov_repo_access.sql)
include broad default table privileges for `service_role`; routine hardening
does not remove that table risk. Every future machine-control or invocation-audit
table MUST explicitly REVOKE ALL privileges from PUBLIC, `anon`, `authenticated`
and `service_role` at creation, before any separately documented narrow grant.
V1 defines no application-role direct table grant: in particular, `service_role`
MUST have no DML on machine-principal state, credential-generation state, execution
bindings or machine invocation audit. RLS alone is not a substitute for this ACL
closure. Machine LOGINs access these stores only through their closed commands.

Future migrations MUST postflight effective privileges, accounting for explicit
grants, PUBLIC, default privileges for each creating role, role inheritance,
ownership and effective ACLs. Intended grants alone are insufficient. Negative
checks MUST prove that application/service roles cannot mutate control state,
append forged invocation audit directly or bypass append-only restrictions.

Technical owners MUST be `NOLOGIN`, non-superuser, non-bypass roles with precise
table/column/function grants and appropriate RLS treatment. Application roles
MUST NOT assume those owners. The intake owner MUST NOT receive governance
transition or materialization powers. The proposal owner MUST NOT receive
reconciliation or canonical materialization powers. Internal raw transition
execution is allowed only through the inaccessible owner required by the closed
proposal command; this is not a grant to its caller.

The seven contracted functions MUST remain unavailable to `PUBLIC`, `anon`,
`authenticated`, `service_role`, machine logins and other application-facing roles:

- `apply_review_transition`;
- `record_authorized_reconciliation`;
- `materialize_object_reconciliation`;
- `materialize_relationship_reconciliation`;
- `record_technical_field_decision`;
- `record_execution_field_decision`;
- `record_authorization_decision`.

Direct EXECUTE on legacy intake RPCs MUST NOT be granted to the machine login as
a shortcut around new binding checks. Existing internal persistence logic may
be reused only behind the restricted admission surface.

Acceptance MUST inspect the entire reachable capability chain: functions,
helpers, triggers, CHECKs, schemas, PUBLIC grants, default privileges, SECURITY
DEFINER ownership, search_path, pg_temp resolution, memberships, SET ROLE and
CREATE capabilities. Protecting only the outer wrapper is insufficient. Reuse
the M16 hardened execution-closure patterns; routines with their own search_path
MUST preserve safe resolution, including pg_temp explicitly last as applicable.
Tests MUST account for privileges inherited from PUBLIC, including temporary
schema capabilities; a missing explicit grant is not proof of denial.

Machine-only routines MUST have their own exact capability census: routine
identity/signature, owner, SECURITY DEFINER/INVOKER status, effective EXECUTE
privileges, body hash or equivalent integrity evidence, search_path, reachable
helper graph and schema privileges. The existing frozen HUMAN/security-definer
census and its historical expected counts MUST remain unchanged. New machine
routines MUST NOT be silently added to or compensated for by changing unrelated
HUMAN census expectations; shared helper dependencies must be identified explicitly.

## 15. Replay/idempotency

Existing deterministic finding, subject and command identities MUST be preserved
where valid. Current subject/command derivations are:

```text
reviewSubjectId = "review-subject:discovery:" +
  SHA256(JSON.stringify([organisationId, findingId]))
commandId = "cmd:discovery-intake:propose:" +
  SHA256(JSON.stringify([reviewSubjectId, "PASS_THROUGH_V1"]))
```

Scanner evidence/finding identity includes source version when present. Random
AcquisitionRun identity MUST NOT become the sole replay guard. Identical semantic
findings within their defined source-version identity MUST not produce duplicate
proposals. A changed immutable commit can yield new observation identities even
for identical bytes; this MUST NOT become automatic canonical duplication/merge.

Retry after timeout MUST safely distinguish an applied command from an unapplied
one. Rescans may create new runs without duplicating the original proposal.
Original evidence run and current attempt run may differ; equivalent source,
version and semantic content MUST be verified instead of demanding equal run IDs.

Current authorization MUST precede successful replay responses. The command MUST
find its original event across the subject's audit history, even after HUMAN
advancement, and distinguish original event outcome from current subject state.
It MUST NOT regress that state. Reused identity with materially different content
MUST produce conflict, never silent replay.

Run eligibility MUST use its original `binding_id`/`binding_revision`. Revoking a
binding and creating an equivalent new one MUST NOT make the stale run replayable.
A newly admitted run under the new binding may independently satisfy current
scope/support checks and discover an existing semantic proposal; it MUST NOT
duplicate that proposal or rewrite old admission provenance. Audit MUST distinguish
the newly authorized attempt from the historical event. Matching a semantic
command ID is never permission to substitute binding identity.

Support admitted under a revoked binding MUST NOT, by itself, authorize a new
machine PROPOSE under another or replacement binding. A new binding MUST NOT
inherit proposal authority merely because equivalent evidence/finding identity
already exists from an old binding. Before PROPOSE relies on it, the relevant
source observation/support MUST be re-admitted, or explicitly re-associated under
architecture-approved semantics, through the current authorized binding and run.
Semantic idempotency is preserved: identical evidence/finding content MAY remain
deduplicated in persistence and need not be physically duplicated. AUTHORIZATION
provenance MUST remain current and attributable to the active binding; the
requirement is proof of current authority, not duplicated content.

**CURRENT IMPLEMENTATION GAPS — REQUIRED future gates, not solved by this ADR:**

- Evidence/assertion/finding admission uses first-insert-wins behavior without
  full semantic content comparison on every reused identity.
- Raw transition replay examines the last transition rather than the entire
  command history.
- Intake returns early for an already-advanced subject, without a new persisted
  machine eligibility check.
- First subject creation compares `detected_at`; concurrent first sightings with
  different observation times can conflict despite deterministic subject identity.
- Envelope hashing is currently application-authored/reverified; SQL cannot assume
  a supplied hash proves its content or authority.

Implementation MUST serialize first admission/creation, use durable inputs,
compare defined immutable semantic content while excluding legitimately varying
observation metadata, and independently verify relevant identities/fingerprints.
Cross-language test vectors are REQUIRED: PostgreSQL JSON rendering MUST NOT be
assumed byte-equivalent to the existing TypeScript identity serialization.

## 16. Audit

The actual transition MUST reuse existing review audit with:

```text
actor_kind = DETERMINISTIC_RULE
actor_reference = NULL
actor_rule_code = PASS_THROUGH_V1
actor_rule_version = 1.0
previous_state = DETECTED
new_state = PROPOSED
```

Append-only machine invocation audit MUST additionally retain principal,
credential generation, `binding_id`, `binding_revision`, organisation, source connection,
adapter/version, acquisition/attempt run, finding, subject, command/event identity,
source version, outcome (including replay/conflict/denial) and DB timestamp as
applicable. Missing references on a denied attempt MUST remain absent rather
than be fabricated. Original observation and current attempt MUST be distinguishable.

Invocation audit MUST be append-only. Application, machine and `service_role`
roles MUST have no UPDATE, DELETE or TRUNCATE authority, directly or through
reachable routines. Precise privileges plus defensive DB enforcement such as
mutation-blocking triggers MUST protect it; TRUNCATE requires explicit coverage.
Technical-owner/DBA maintenance is permitted only as an explicitly controlled,
traceable operational action, not a callable application capability. Ordinary
command owners receive only the insertion/read powers their closed paths require,
not routine audit rewrite/delete authority.

Successful transition, review audit, required invocation audit and existing
transition outbox effects MUST commit atomically. Replay MUST NOT insert another
semantic transition. Audit MUST distinguish admission, machine proposal and HUMAN
governance. It MUST NOT represent proposal as validation or create a synthetic
HUMAN actor. The existing HUMAN-shaped ledger is not a reason to invent user IDs.

Transactional transition audit and operational invocation-attempt audit MUST be
distinguished. Expected denied outcomes may be recorded in a committed transaction
before returning a non-success result without a governance mutation. An exception
or caller rollback also rolls back audit written in that transaction. Authentication/
ACL failures and aborted attempts therefore require a separate durable operational
audit path, outside the failed transaction; its ingestion MUST NOT create an admin
API or direct application/service_role DML on machine audit tables. Operational
attempt records MUST NOT claim a transition committed without matching committed
DB evidence. An INSERT followed by transaction-aborting RAISE/rollback does NOT
survive. Credentials and source tokens MUST NOT be logged.

## 17. Failure semantics

| Failure | REQUIRED behavior |
|---|---|
| Unknown/retired/expired credential, disabled principal | Deny including replay |
| Missing/mismatched role OID or name; renamed/recreated role | Fail closed, including replay |
| Disabled/revoked/deleted binding or stale identity/revision | Deny; equivalent new binding cannot authorize old run |
| Overlapping active authority/case-alias binding | Reject provisioning atomically |
| Wrong tenant, connection, source configuration, adapter/version | Fail closed without cross-tenant disclosure |
| Intake or PROPOSE capability disabled | Deny that capability independently |
| Unknown rule or wrong proposal version | Deny before governance mutation |
| Missing/inconsistent evidence, finding or candidate linkage | Deny dependent admission/proposal; fabricate nothing |
| Missing ReviewSubject | Deny PROPOSE; do not implicitly create it |
| Wrong current state | Return verified historical replay or state conflict; never regress |
| Reused identity with different semantic content | Conflict, not replay |
| Malformed command/extra authority fields | Reject |
| Attempted action beyond PROPOSE | Reject; no general transition entry |
| DB/transport failure | Classified failure; deterministic retry without fallback |
| Neither direct baseline nor accepted pooler meets identity/TLS contract | Activation BLOCKED; changing the contract requires an explicit ADR revision |

Authority failures MUST stop dependent governed work. Item-level acquisition
deficiencies may produce explicit partial intake. Already-durable observations
MUST NOT be represented as successful proposals after a failed proposal call.
No fallback to raw RPCs, HUMAN credentials, broad service role, invented evidence
or an unaccepted transport path is permitted.

## 18. GitHub Commercial V0 flow

GitHub is the first certified consumer of the future boundary, not a claim of
current certification through this new boundary. It remains CORE L0, not M19.

| Transition | REQUIRED proof |
|---|---|
| Binding -> acquisition | Trusted organisation, connection, configured owner/repo, exact authorized ref and adapter/version |
| Ref -> immutable commit | Valid resolved SHA; enumeration and file reads use that same commit |
| Content -> evidence | Content hashes, paths/locations and commit provenance agree |
| Evidence -> finding/candidate | Durable support, deterministic identity and no canonical authority |
| Finding -> ReviewSubject | Same-tenant admitted inputs; initial `DETECTED` only |
| Subject -> machine PROPOSE | Current binding/generation/capability; `PASS_THROUGH_V1 / 1.0`; atomic audit |
| Proposal -> HUMAN review | Existing verified HUMAN principal and governed wrappers |
| HUMAN review -> reconciliation decision | Existing confirmation/certification and separately authorized decision gates |
| Decision -> materialization | Valid persisted decision, exact identities/endpoints and current HUMAN write eligibility |
| Canonical state -> Passport/Graph | Existing canonical readers/projections; source claims remain distinguishable from truth |

The run MUST retain `binding_id`, `binding_revision`, connection, original and
normalized source locator, applicable provider repository pin, exact adapter/version,
authorized ref and immutable commit SHA. Section 12 defines case, rename/transfer
and source-authenticity residuals. GitHub credentials
are acquisition credentials only: separate from DB credentials, absent from
execution-binding authority material, and never governance authority.

Current ReviewSubject states include `CONFIRMED` and `CERTIFIED`; `VALIDATED` is
not a ReviewSubject state. Certification alone is not materialization authority:
the existing authorized reconciliation decision remains required.

## 19. Vendor neutrality

The governance boundary MUST be SourceAdapter-vendor-neutral. Adapters own source
authentication, enumeration, reads and immutable-version provenance. The machine
boundary owns principal, scope, eligibility, closed commands and audit.

Future Azure DevOps, GitLab or Bitbucket adapters may reuse this authority model
only after their own acquisition/provenance certification. This ADR activates
or implements none of them. Unavailable evidence or immutable version MUST remain
missing; a future adapter MUST NOT fabricate GitHub-style commit provenance.

## 20. M16/S1B.3 relationship

This architecture MUST NOT change frozen M16 L14 Authority Policy, introduce an
L14 permission, use a policy-bootstrap exception, or reuse HUMAN M16 authority
for a machine. The machine principal/binding is PLATFORM CONTROL-PLANE
authorization supporting L0 Discovery execution. It is NOT a governed customer
L11 authorization fact, an `authorization_decision`, an execution-field governance
fact or an L14 Authority Policy fact. It MUST NOT create a second customer-facing
authorization truth model.

This boundary does not require S1B.3. S1B.3 does not require this boundary for its
own policy-admission implementation. This Discovery slice can be implemented and
closed independently. **S1B.3: NOT STARTED** by this ADR or its materialization.

## 21. Database/schema impact

**PLANNED IMPACT — no migrations or database changes are made by this ADR.**

| Planned addition/change | Reason |
|---|---|
| Stable principal/current credential-generation persistence | Authenticate known current workload credentials and revoke open-session authority |
| Execution-binding persistence | Immutable binding IDs, monotonic revisions, terminal revocation and closed uniqueness around existing source identity |
| Run binding/configuration provenance | Preserve exact admitted binding ID/revision, source/ref, adapter and original credential context |
| Append-only machine invocation audit | Trace actual machine calls, including replay, without synthetic HUMAN attribution |
| Closed intake and exact read functions | Replace worker reliance on raw intake RPCs and broad table access |
| Closed PROPOSE function/internal eligibility | Enforce the only permitted governance transition |
| OID-anchored LOGIN generations, NOLOGIN owners, exact ACL/RLS treatment | Structural capability separation; explicit control/audit table revokes and postflight |
| Execution-closure hardening and admission/replay verification | Close known gaps before activation |

Existing evidence, assertions, findings, candidates, review subjects, review audit,
outbox and canonical stores MUST be reused where their contracts fit. No duplicate
general source registry, extensible rule registry, HUMAN machine-user table, L14
permission or new canonical store is required. New control/audit persistence is
required; this is not a zero-schema-change decision. Physical table grouping and
function signatures remain implementation review work.

Future migrations MUST be additive and preserve historical migrations and frozen
HUMAN contracts. Existing records lacking machine admission authority MUST NOT
be silently backfilled with fabricated eligibility. They require verifiable
admission under the approved boundary before machine use.

## 22. Runtime impact

The future implementation requires a dedicated isolated Node worker/composition,
production dependency on `pg`, bounded pool and the section 8 PostgreSQL/TLS
identity contract: direct baseline or explicitly accepted identity-preserving pooler.
No current worker, production pool, route, job or hosted configuration is created
or claimed by this document.

The worker MUST NOT import composition that initializes `privilegedDb` or requires
`SUPABASE_SERVICE_ROLE_KEY`, even when alternative ports are subsequently injected.
Core discovery contracts must remain persistence-neutral. New machine adapters
MUST expose only the allowed methods; unused HUMAN/canonical methods MUST NOT be
carried into runtime as broad default ports.

Worker access is fixed to:

```text
SERVICE_ROLE credentials: NONE
HUMAN credentials: NONE
HUMAN JWT signing secrets: NONE
Provisioning credentials: NONE
Canonical write capability: NONE
```

The process MUST NOT inherit the dashboard's broad environment or have access
to retrieve its secrets. A TypeScript interface alone is not an authority boundary.
The selected design adds no machine JWT issuer, gateway delegation or queue broker.

## 23. Security invariants

The machine MUST NOT VALIDATE, CONFIRM, CERTIFY, REJECT, DEFER, REVOKE, RECONCILE,
MATERIALIZE or MERGE; create canonical objects or relationships; validate canonical
technical profiles; issue HUMAN governance decisions; impersonate HUMAN principals;
administer machine bindings; or grant itself capabilities. Confidence MUST NOT
change this ceiling.

Machine proposal authority MUST NOT be transferable into another action or another
binding. Source acquisition credentials, admission success, existing command IDs
and observed similarity MUST NOT substitute for current authorization.

The security claim covers the restricted machine principal and its reachable
capabilities. It does not claim remediation of all existing dashboard/service-role
residuals or protection against compromise of DBA/provisioning authority. Giving
the worker access to those credentials invalidates the claim.

## 24. Acceptance gates

All gates below are **REQUIRED FUTURE IMPLEMENTATION EVIDENCE**, not tests run or
passed by this document. Existing fixture/unit coverage does not certify the new
boundary.

| Gate | Required evidence |
|---|---|
| Contracts/unit/domain | Typed admission; separate capabilities; fixed PROPOSE actor/rule; no confidence escalation |
| Deterministic identity | Existing TS identities preserved; DB/client serialization vectors; no random-only guard |
| Real PG17 authentication | Actual restricted LOGIN authentication; unknown credential rejection; correct `session_user` under definer |
| Real `pg` client/TLS | Production client path, verified server identity, pool behavior and invalid-credential/certificate rejection |
| Credential lifecycle | Generation switch rejects old credential and already-open old sessions; valid successor can safely retry |
| ACL negatives | No table DML/broad SELECT, privileged memberships, owner SET ROLE, CREATE or binding administration |
| PUBLIC/default grants | Effective capabilities across all reachable schemas/routines, not merely explicit grant inventory |
| Raw RPC contract | Seven raw functions remain unavailable to application roles and machine LOGIN |
| HUMAN/canonical isolation | HUMAN wrappers, reconciliation/materialization and direct canonical stores inaccessible; exact mapping read only |
| Tenant negative | Foreign run/evidence/candidate/subject/binding cannot satisfy a request |
| Source/config negative | Wrong connection, locator/ref, source version or content provenance rejected |
| Adapter/rule negative | Wrong adapter/version, unknown rule and wrong proposal version rejected |
| Capability negative | Intake-only cannot PROPOSE; disabled intake cannot admit; neither enables canonical writes |
| Principal/binding negative | Disabled/revoked principal or binding and stale binding revision rejected |
| Replay negative | Replay after revocation/stale generation denied; reused identity/content mismatch conflicts |
| Concurrent/retry behavior | First-sighting races, lost responses, HUMAN-advanced subjects and revocation ordering serialize correctly |
| Execution closure | Temp-schema/search_path attacks against all helpers/triggers/CHECKs and ownership paths fail |
| Audit atomicity | No success without required audit; no duplicate transition on replay; denial rollback limitations demonstrated |
| GitHub fixture | Actual adapter with deterministic HTTP fixture and real DB persistence preserves configured ref/resolved SHA/support |
| HUMAN after proposal | Machine proposes; only eligible HUMAN can confirm/certify and issue authorized reconciliation decision |
| Canonical E2E | No object/relationship/profile materialization before required HUMAN governance; Passport/Graph consume resulting truth |
| Regression | Existing credential epoch, HUMAN wrappers and M16 execution-closure protections remain valid |

Administrator `SET ROLE` alone is insufficient authentication evidence. The local
PG17/Supabase acceptance profile MUST represent actual login authentication,
credential generations, bindings, revocation and replay. The existing harness's
`trust` setup requires a dedicated authentication test profile. Later hosted
acceptance MUST verify the selected network/TLS/identity path without substituting
an unaccepted transport; no hosted testing is authorized by this ADR or its freeze.

The following corrective gates are additionally REQUIRED. They are future
implementation evidence, not results of this document correction:

| Gate ID | REQUIRED acceptance evidence |
|---|---|
| C01 — Binding resurrection (H-1) | Revoke binding, create equivalent new binding, and prove stale run/replay still denied; no ID reuse, revision reset or resurrection through deletion. |
| C02 — Binding ambiguity (H-1) | Concurrent provisioning rejects overlapping non-revoked tuples and normalized-locator aliases; no ambiguous run authority. |
| C03 — Control/audit ACLs (H-2) | PUBLIC, anon, authenticated and service_role have no direct control/audit table access in V1; postflight explicit/default/PUBLIC/inherited/ownership/effective privileges; no application-facing administration. |
| C04 — Append-only audit | UPDATE, DELETE and TRUNCATE fail for application/machine/service roles; defensive enforcement and controlled maintenance verified; rolled-back attempts use separate operational audit. |
| C05 — Role OID (M-1, D-L1) | Missing catalog role and stored OID mismatch fail closed, including replay; session role resolves to its catalog OID by an exact-name-safe mechanism, with no reliance on text-to-`regrole` case-folding (mixed-case/quoted name vectors). |
| C06 — Role rename (M-1) | Rename of active/audit/draining role is prohibited by provisioning; unexpected name mismatch denies eligibility despite matching OID. |
| C07 — Role recreation (M-1) | Drop/recreate under the same name never restores authority; provisioning rejects generation-name reuse and preserves retired identity history. |
| C08 — Pooled rotation (M-1) | An already-open pooled session from the old generation fails after the current-generation switch serializes before its command. |
| C09 — Transport identity (M-2) | Actual direct client authentication verifies session_user/OID/name; any proposed pooler mode independently proves the same identity on every command, verified TLS, no privilege expansion and transaction/replay preservation before use. |
| C10 — Session independence (M-2) | Commands re-establish authority from durable state despite pooled reuse or manipulated GUCs, temp tables, session variables, prepared-statement state and role context. |
| C11 — Connection consistency (M-3) | DB verifies fixed provider, normalized locator, retained identity descriptor and existing deterministic connection ID as one tuple; mismatched independent inputs rejected. |
| C12 — GitHub casing (M-3) | Owner/repo case variants compare consistently and cannot create ambiguous grants or substitute a different connection hash; ref/path case semantics unchanged. |
| C13 — Provider repository pin (M-3) | Where supported, pin immutable provider repository ID as metadata; mismatched/missing pinned ID rejected without redefining GOV IA identity. |
| C14 — Rename/transfer (M-3) | No automatic redirect/rebind; new locator requires revoke/create and stale runs fail; repository-name reuse fails pin; unavailable pin has explicit adapter-specific residual acceptance before activation. |
| C15 — Worker secrets (H-2) | Process environment/imports/secret retrieval expose no service_role, HUMAN credentials/signing secrets or provisioning secrets; worker cannot administer control state. |
| C16 — Snapshot scope (L-4) | Foreign source_scope cannot be injected; scope derives from or is validated against binding ID/revision, organisation and source connection; runtime-owner privileges not inherited. |
| C17 — Machine census (L-2) | Exact signatures, owners, definer/invoker modes, effective EXECUTE, integrity hashes, search_path, helpers and schema privileges verified separately; frozen HUMAN census/counts unchanged. |
| C18 — Fixed PROPOSE (L-3) | Input mutation cannot alter fixed authority/rule/states/command semantics, inject a transition payload or reach dynamic SQL; minimum internal owner grants; only DETECTED -> PROPOSED reachable. |
| C19 — Mapping lookup (O-3) | Exact-key, read-only tenant/source lookup rejects list/prefix/LIKE/pattern/enumeration/scans; nonexistent and out-of-scope results are uniform. |
| C20 — Compromised worker (M-4/L-1) | Valid DB/source credentials can admit fabricated but scope-consistent pre-canonical observations and PROPOSE only; no customer L11/L14 fact or canonical/HUMAN decision can be written; reviewer provenance semantics retain the explicit trust residual; effective authority is bounded by the union of bindings assigned to the principal (D-L2). |
| C21 — Revoked-binding support (D-L3) | Old binding admits support; binding revoked; new equivalent binding/run attempts PROPOSE using only old-binding authorization provenance and FAILS; after current-binding admission/association, PROPOSE is eligible under normal rules without duplicating deduplicated content. |

## 25. Rejected alternatives

| Alternative | Assessment / reason not selected |
|---|---|
| Dedicated machine JWT/role through PostgREST | Technically viable, but requires new trusted issuance, token lifecycle and Supabase signing trust. Current HUMAN JWT is not that capability. Not the selected V1 transport. |
| Owner-controlled HTTP gateway with service_role backend | Removes the key from the worker but leaves broad authority behind the gateway; passing a principal ID does not independently prove it to DB. A restricted backend adds another layer without demonstrated need here. |
| service_role in worker | Rejected: remaining table/RPC capabilities exceed the machine ceiling; a promise not to use them is not isolation. |
| Extend HUMAN transition wrapper with machine branch | Unnecessarily couples frozen HUMAN and machine authority. Dedicated command is selected. |
| Durable proposal inbox and consumer | Possible, but adds a queue/consumer lifecycle without a demonstrated asynchronous requirement. |
| Reopen raw transition after TypeScript validation | Rejected: caller bypass and arbitrary transition payload remain possible. |
| LOGIN per tenant/source/instance | Not required: executor authentication and execution scopes are separate. |
| Password replacement as sole revocation | Does not establish rejection of already-authenticated sessions. |
| Implicit intake-plus-PROPOSE operation | Violates capability separation. |

External transport semantics supporting the analysis are documented by
[PostgREST authentication](https://docs.postgrest.org/en/stable/references/auth.html),
[PostgreSQL identity functions](https://www.postgresql.org/docs/17/functions-info.html)
and [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres).
These references explain transport behavior; they do not attest hosted deployment
state or replace repository authority.

## 26. Operational questions

Only deployment questions remain, not competing architecture options:

- Which runtime platform will host the isolated Node worker?
- How will its restricted secrets be stored, distributed and rotated without
  access to dashboard/HUMAN/provisioning secrets?
- What connection/concurrency budget will bound the worker's pool and replicas?
- What hosted network/TLS configuration will provide the direct baseline or a
  pooler accepted under the exact section 8 identity/security gates?

These questions MUST NOT weaken the selected transport or capability model.
Unmet connectivity or isolation requirements block activation until resolved;
departing from the transport identity/security contract requires an explicit ADR
revision. A pooler satisfying section 8 requires explicit implementation acceptance,
not a silent fallback or a new architecture choice.

## 27. Consequences

The design restores a path to non-authoritative Discovery proposals without
reopening raw application governance writes or borrowing HUMAN authority.
Tenant/source assignment, credential rotation and governance capability are
independent and auditable. Existing deterministic domain contracts and persistence
can be reused behind narrower functions.

Costs include a separate process/secret boundary, PostgreSQL driver/pool lifecycle,
generation-specific LOGIN provisioning, control/audit persistence, more exact
admission checks and real authentication/security tests. Compliant PostgreSQL/TLS
connectivity with preserved LOGIN identity is a deployment prerequisite. The
original broad composition cannot be activated unchanged.

CIA impact is L0 acquisition and the existing governance-review boundary, supported
by PLATFORM CONTROL-PLANE authorization. Machine principals/bindings are not
governed customer L11 facts, authorization_decisions, execution-field governance
facts or L14 Authority Policy facts. L11/L14 customer truth semantics do not change.
Passport Discovery Metadata and Provenance/Trust benefit downstream; this slice
does not add Passport families, canonical object kinds, relationships, vector
identity or LLM authority. Lineage remains evidence-backed pre-canonical input
until the existing HUMAN decision-to-truth path completes. Graph remains a
projection; no new vector, profiling, runtime-observation or drift capability is
introduced. This preserves the CIA milestone mapping obligations.

## 28. Non-goals

This ADR materialization does not implement code/tests/migrations, create worker
jobs/routes, activate Discovery, modify databases or hosted settings, commit,
push, open a PR or deploy. It does not begin S1B.3.

M17/M18/M19, L5 profiling, Drift, UI/demo environments, Purview/dbt/IDMC/Databricks/
AWS/GCP activation, Azure DevOps/GitLab/Bitbucket promotion, generic source/rule
registries, L14 permission expansion and global remediation of existing
service-role residuals are outside this slice.

## 29. Implementation slices

These are future Discovery-local labels, **not changes to official M16 numbering**.
No slice is implemented by this document.

| Discovery slice | Expected scope / exit condition |
|---|---|
| `DISCOVERY-MACHINE-S0` | Independent ADR review, explicit approval and freeze — COMPLETED 2026-10-01 (architecture only) |
| `DISCOVERY-MACHINE-S1` | Contracts and deterministic identity compatibility |
| `DISCOVERY-MACHINE-S2` | Principal, credential-generation and execution-binding persistence |
| `DISCOVERY-MACHINE-S3` | Restricted intake/read capability surface, including existing typed auxiliaries |
| `DISCOVERY-MACHINE-S4` | Restricted PROPOSE boundary, current eligibility and invocation audit |
| `DISCOVERY-MACHINE-S5` | Isolated Node executor and production `pg` composition |
| `DISCOVERY-MACHINE-S6` | Cutover of governed Discovery composition; remains controlled/dormant until gates pass |
| `DISCOVERY-MACHINE-S7` | PG17, ACL, authentication and adversarial execution-closure acceptance |
| `DISCOVERY-MACHINE-S8` | GitHub Commercial V0 E2E through machine proposal and HUMAN decision-to-truth |

Implementation MUST NOT interpret this sequence as permission to bypass a gate
or activate the producer merely because its PROPOSE RPC has been added.

## 30. Freeze checklist

This checklist records the architecture freeze gate. Checked items record
architecture-document acceptance on 2026-10-01; they are not implementation,
test or deployment evidence. The document is **ACCEPTED / FROZEN**.

- [x] Independent corrective re-review confirms the PASS_WITH_CORRECTIVES findings resolved.
- [x] Architecture owner explicitly approves/finalizes the decision; status change authorized.
- [x] Principal versus credential generation versus tenant/source binding is unambiguous.
- [x] Direct PostgreSQL/TLS baseline, conditional pooler gates and no-silent-fallback rule are confirmed.
- [x] Immutable binding ID/revision, terminal revocation and closed uniqueness prevent resurrection/ambiguity.
- [x] Out-of-band provisioning, OID/name checks and explicit control/audit ACL closure are confirmed.
- [x] Intake and PROPOSE effects, grants, owners and eligibility remain separate.
- [x] Every current intake/auxiliary/read call is covered without hidden service-role use.
- [x] Current-generation and binding checks apply to replay; rotation/revocation ordering is explicit.
- [x] Raw RPC, HUMAN and canonical authority remain inaccessible to machine logins.
- [x] Full execution-closure/PUBLIC/default-grant and authentication gates are retained.
- [x] Separate exact machine census preserves frozen HUMAN/security-definer counts.
- [x] Fixed PROPOSE arguments, restricted snapshot scope and exact mapping lookup are covered.
- [x] Existing replay/admission weaknesses remain explicit implementation work.
- [x] Audit distinguishes machine proposal from HUMAN decisions and handles rollback limitations.
- [x] Append-only enforcement and operational invocation-attempt audit remain distinct from transition audit.
- [x] GitHub is first consumer; future adapters require certification; source identity is reused.
- [x] Locator normalization, repository pin/rename semantics and compromised-worker residual are explicit.
- [x] Machine authority is platform control-plane only; no customer L11/L14 truth model is introduced.
- [x] M16 L14 is unchanged; S1B.3 remains NOT STARTED by this work.
- [x] Operational questions are deployment conditions, never implicit transport alternatives.
- [x] Current dormancy, future architecture and later implementation/activation are clearly distinguished.
- [x] LOW clarifications D-L1 (exact-name-safe OID resolution), D-L2 (binding union under one principal) and D-L3 (no PROPOSE authority from revoked-binding support) are incorporated.

Current implementation status: **new machine boundary NOT IMPLEMENTED**;
governed Discovery **DORMANT / NOT ACTIVATABLE** through its existing composition.
Next gate: **GOVERNED DISCOVERY MACHINE BOUNDARY — IMPLEMENTATION PLAN / SLICE S1**
(not started by this freeze).
