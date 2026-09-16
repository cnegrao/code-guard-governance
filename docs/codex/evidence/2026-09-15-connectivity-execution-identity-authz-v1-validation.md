> Current recovery status (2026-09-16): **READY_FOR_ARCHITECT_REVIEW**.
> Option B is authorized and implemented. Sections 27–31 record the latest
> recovery, validation and limitations. Earlier STOPs are historical.
> Independent adversarial review remains required before the merge gate.
> **NOT MERGED. Migration LOCAL ONLY. Production UNTOUCHED. M14 NOT STARTED.**

# M13 — Connectivity & Execution Identity/AuthZ V1: readiness gate

Original record date: 2026-09-15. Original preimplementation verdict:
**STOP_REQUIRES_ARCHITECTURE_DECISION**, superseded by the approved Option B
implementation and latest recovery below. M13 is awaiting independent review.

## 1. Base, branch and scope

- Fetched origin; local main and origin/main both:
  `9533fb20b85900a845880060ecdc28aa1a69e270`.
- Expected base ancestry and approved M12 head
  `00ec16b4b152fa6ca542cdb70b4f1426806503ba` ancestry: exit 0.
- Initial branch: `main`. Created
  `feat/connectivity-execution-identity-authz-v1`; HEAD remains the base SHA.
- Initial status contained only the permitted untracked recovery file. It was
  never read, hashed, staged, modified, deleted, copied or otherwise accessed.
- No `.claude/**` inspection, quarantined-commit inspection, subagents or broad
  audit. Context was the requested baseline/roadmap/conformance/reuse documents,
  M10/M11/M12 evidence and the narrow contracts/code dependencies cited below.
- Architecture: **GOVIA-L0L16-CIA-v1.0 — FROZEN, unchanged**.

Git fetch and branch creation initially failed on sandbox-protected `.git`
writes; each succeeded with approved escalation. No branch reset or existing
tracked change was encountered.

## 2. First architecture gate: blocked before implementation

The baseline permits typed governed metadata on an existing canonical object;
it does not authorize substituting human identity, untyped facts or object
mapping approval for execution field authority. The following concrete evidence
prevents implementing M13 under the current accepted decisions:

1. **Field/source authority has no AGENT_VERSION L10/L11 domain.**
   `ADR-GOVIA-FIELD-FACT-AUTHORITY-AND-MULTIVENDOR-RECONCILIATION-v1.md`, Decision,
   explicitly restricts values to existing DataAsset/DataElement profile leaves.
   `packages/canonical-contracts/src/technical-facts.ts:5` defines only those two
   kinds and six kind/field combinations. `FieldAuthorityPolicy.objectKind` and
   governed field subjects use that same closed domain. The SQL
   `technical_field_valid` predicate in
   `supabase/migrations/20260911184613_technical_field_governance_v1.sql:4`
   independently enforces it. No principal, capability, scope, grant or
   connectivity field can acquire authority through that contract.
2. **Existing technical profile persistence is a foundation, not an M13 model.**
   `AgentVersionTechnicalProfile` in `contracts.ts:1096` has exactly five supported
   leaves: behaviorFingerprint, buildReference, runtimeFrameworkReference,
   entrypointReference and configurationReference. The accepted technical-profile
   persistence ADR sections D/E scope typed values/support to those fields.
   A configuration reference is not permission to hide a principal/grant/network
   structure inside a string. `TechnicalMetadataSupport` proves support membership,
   not field authority or an execution authorization decision.
3. **M13 behavior inputs are not currently covered upstream.**
   `packages/scanner/src/discovery/agent-version-correlation.ts`,
   `buildTechnicalRevisionProjection`, includes model/tool/prompt/MCP/API/KB/skill
   references and framework/orchestration signals. It has no principal,
   requested/granted scope, permission or network declaration input.
   `technical-profile-signal.ts:38` closes signals to FRAMEWORK/ORCHESTRATION.
   Same-file correlation for existing L4 signals must not be promoted into direct
   M13 execution binding. A newly stored principal could otherwise change while
   that existing fingerprint remains equal.

**Decisions required to unblock, not adopted by this record:** approve the closed
AgentVersion-scoped L10/L11 fact types and leaf support; explicitly extend or
separately define field/source authority for those exact fact families; define
how declared configuration, provider-reported grants and UNKNOWN remain separate;
and specify their version/history treatment under the existing immutable
AgentVersion rule. In particular, distinguish behavior configuration changes
requiring a new version from later evidence about a fixed version, with exact
binding, conflict rejection and historical provenance. Identify supported static
source declarations before assigning fingerprint inputs or building an adapter.

A typed per-kind persistence adaptation could then reuse the accepted pattern,
subject to one additive migration. This record does not choose new fields,
authorization enums, authority dispositions, binding syntax or fingerprint schema.
No new canonical kind/relationship is needed to describe this possible direction.

The user's sections 11, 17, 24 and 34 require this STOP. Merely collecting proposals
would not satisfy the missing M13 field-authority gate; silently widening the M10
union or using identity certification as field authority would bypass it.

## 3. Architecture mapping A–O, before implementation

| Item | M13 assessment and retained boundary |
| --- | --- |
| A CIA | Frozen GOVIA-L0L16-CIA-v1.0 unchanged; no local architecture decision adopted |
| B L0–L16 | Intended L10/L11; L0–L4 only source/evidence/binding support; no layer implemented by this gate; no L12 claim |
| C Passport | Intended families 7, 8, 13 (design-time only), 14, 15, 16; existing 16 families preserved separately |
| D Canonical | Exact AGENT_VERSION technical subject; 11 kinds and 12 relationships unchanged; no new state |
| E Lineage | No fabricated principal/network/permission edges; existing lineage unchanged |
| F Evidence/provenance | Reuse assertion/evidence IDs, acquisition/source/method and temporal support; M13 leaf contract missing |
| G Trust/authority | DECLARED/IMPORTED separate from governed authority; M13 field authority blocked; machine ceiling PROPOSED |
| H Vector | No embeddings, similarity or authority change |
| I Graph | Existing canonical read projection unchanged; never system of record |
| J LLM | No invocation, extraction, inferred binding or canonical authority |
| K Tenancy/security | Trusted server organisation/connection; exact same-tenant binding; no secret values or untrusted tenant input |
| L Migration | None created or executed; future typed adaptation requires the missing decision |
| M Continuity | M10 authority, M11 Passport and M12 analytical projection preserved |
| N Non-fabrication | Missing principal/grant/network evidence remains unknown; naming/co-presence is insufficient |
| O Acceptance | Gate evidence, narrow foundation regressions, one manual adversarial pass; M13 acceptance cannot pass yet |

## 4. Contract-first reuse map A–O

Classification is relative to M13, not a claim that existing L4 or app identity
features are broken. Historical conformance/reuse records predate M2–M12; current
contracts and latest milestone evidence supersede their implementation status.
Their old references to prospective network/principal object kinds do not override
the closed taxonomy.

| Item | Concept | Classification | Evidence / limit |
| --- | --- | --- | --- |
| A | AgentVersion execution principal | NOT_PRESENT | No execution-principal leaf in AgentVersion profile or fact union |
| B | Service account | NOT_PRESENT | No version-bound account contract; provider credentials are connector authentication |
| C | OAuth/client identity | NOT_PRESENT | IdentityConfig clientId identifies the connector, not the governed AgentVersion |
| D | IAM role reference | NOT_PRESENT | IdentityGroup is human directory metadata, without execution binding |
| E | Capability | NOT_PRESENT | Mentioned in version invariants; Skill is a distinct artifact, not a capability grant |
| F | Permission/grant | NOT_PRESENT | Governance review authority is a different domain |
| G | Scope | NOT_PRESENT | No distinct requested/granted execution fields |
| H | Resource/action | NOT_PRESENT | Tool/API dependency does not encode action permission |
| I | Authorization state | NOT_PRESENT | Passport UNKNOWN is presentation coverage, not an execution-state model |
| J | Endpoint | FOUNDATION_ONLY | API baseLocator/MCP endpointLocator are typed sanitized sibling-object fields, not version connectivity |
| K | Protocol | FOUNDATION_ONLY | Closed ApiProtocolFamily/McpTransport exist on sibling profiles |
| L | Environment | NOT_PRESENT | No bounded AgentVersion environment declaration leaf |
| M | Network/VPC | NOT_PRESENT | No typed version-bound network context |
| N | Egress/connectivity | NOT_PRESENT | No supported static execution connectivity source established |
| O | Execution topology | FOUNDATION_ONLY | Governed dependencies exist; dependency graph does not prove deployment/network topology |

| Existing component | Classification | M13 use / limitation |
| --- | --- | --- |
| Canonical identity and relationship taxonomy | REUSE_AS_IS | Preserve exact identities and closed endpoint rules |
| AgentVersionTechnicalProfile | FOUNDATION_ONLY | Five leaves; needs an approved typed M13 adaptation |
| behaviorFingerprint pipeline | FOUNDATION_ONLY | Existing deterministic version semantics; missing M13 inputs and binding |
| TechnicalMetadataSupport, SourceAssertion, Evidence | REUSE_AS_IS | Support/provenance only; no generic semantic value payload |
| SanitizedTechnicalLocator and protocol vocabularies | REUSE_AS_IS | Safe locator/protocol primitives; do not establish reachability |
| M10 technical facts/authority | BLOCKED_ARCHITECTURE | Accepted scope is DataAsset/DataElement only |
| M3 typed profile persistence | FOUNDATION_ONLY | Normalized typed values, relational support and governed materialization pattern |
| M9/M10 immutable observations/history | FOUNDATION_ONLY | Provenance/history pattern; not permission to reinterpret version behavior as mutable field state |
| M11 Passport | ADAPT | Closed family-specific contracts require future typed facts; authorization/connectivity currently `never` |
| M12 analytical projection | REUSE_AS_IS | Preserve read-only canonical projection; no M13 synthetic edges |
| Human identity connectors | LEGACY_DO_NOT_EXTEND | Not execution-identity or execution-authorization sources |

## 5. Readiness matrix (18 items)

Statuses describe the current gate. No item is claimed IMPLEMENTED by M13.
All future AgentVersion fact materialization additionally depends on the field
authority decision in section 2, even where another immediate blocker is shown.

| # | Family | Status | Reason |
| --- | --- | --- | --- |
| 1 | Execution principal reference | BLOCKED_ARCHITECTURE | Closed typed leaf and field authority missing; direct version binding also unestablished |
| 2 | Service account reference | BLOCKED_ARCHITECTURE | No AgentVersion account fact/authority semantics |
| 3 | OAuth/client identity | BLOCKED_ARCHITECTURE | Connector client identity cannot substitute for execution identity |
| 4 | Role reference | BLOCKED_ARCHITECTURE | No typed execution role state; role name never proves permission |
| 5 | Delegated user identity | BLOCKED_EVIDENCE | No explicit version/delegation source established; typed model also absent |
| 6 | Capability declaration | BLOCKED_ARCHITECTURE | Independent capability leaf/support/version inputs missing |
| 7 | Action/resource declaration | BLOCKED_ARCHITECTURE | No closed action/resource declaration contract |
| 8 | Requested scope | BLOCKED_ARCHITECTURE | Declared scope leaf/authority/version treatment missing |
| 9 | Granted scope | BLOCKED_AUTHORITY | No M13 field policy or defensible effective-grant source; no requested-to-granted promotion |
| 10 | Permission/grant | BLOCKED_AUTHORITY | Governance permission does not authorize execution |
| 11 | Explicit authorization state | BLOCKED_ARCHITECTURE | No typed execution state preserving UNKNOWN independently |
| 12 | Endpoint | BLOCKED_BINDING | Sanitized API/MCP locator foundation exists; exact AgentVersion connectivity binding not established |
| 13 | Protocol | FOUNDATION_ONLY | Existing closed API/MCP vocabularies; no version connectivity fact |
| 14 | Environment | BLOCKED_EVIDENCE | No explicit bounded source established; no name-based inference |
| 15 | Network/VPC context | BLOCKED_EVIDENCE | No direct static/imported version-bound source established |
| 16 | Egress declaration | BLOCKED_EVIDENCE | No direct static/imported declaration established |
| 17 | Service topology | FOUNDATION_ONLY | Dependencies available; service/execution topology not established |
| 18 | External/internal classification | BLOCKED_EVIDENCE | No direct bounded declaration; no inference from hostname/IP |

## 6. Identity, capability and authorization semantics

Execution principal, service-account reference, OAuth/client identity, IAM role
and delegated user are **not implemented**. Only explicit source evidence tying
one exact normalized/canonical AGENT_VERSION to the reference could populate
them. Repository owner, Git author, reviewer, email, team, directory co-presence,
group membership and job title cannot supply that binding.

Capability is a separately supported declaration of what the version is designed
to attempt. It neither creates permission nor follows from permission alone.
Requested scopes remain declarations, distinct from granted scopes. Role names,
group names, configured access and credential references do not establish a grant,
successful access or credential possession. Permission/grant requires defensible
source-supported state and the missing exact field authority contract.

Missing evidence remains UNKNOWN; it is never DENIED, FALSE, safe or compliant.
`hasGovernanceReviewAuthority`, reviewer identity and governance roles remain
authority over governance workflow only. No new execution authorization enum
or permission evaluator was introduced.

## 7. Narrow legacy identity classification

| Connector | Classification | Direct evidence |
| --- | --- | --- |
| Entra ID | LEGACY_DO_NOT_EXTEND | entra-id.ts:97–100 syncs users/groups and filters governanceUsers |
| Okta | LEGACY_DO_NOT_EXTEND | okta.ts:82–85 uses the same governance-user filter |
| Keycloak | LEGACY_DO_NOT_EXTEND | keycloak.ts:97–100 uses the same governance-user filter |

`packages/scanner/src/connectors/identity/types.ts:9` defines IdentityUser,
IdentityGroup and IdentitySyncResult, not AgentVersion identity. Lines 60–62
combine jobTitle, department and groups for `isGovernanceRelevant`.
This heuristic has no execution authority. Connector clientId/clientSecret/apiToken
fields configure provider access, not discovered execution facts. Their generic
rawAttributes is not reused as an M13 metadata bag. No connector changed or ran.
Low-level provider access primitives are NOT_APPLICABLE to this no-live-access
gate; a future adapter would need independent trusted typed execution binding.

## 8. Connectivity, protocol, environment and secrets

API `baseLocator` and MCP `endpointLocator` reuse `SanitizedTechnicalLocator`.
`packages/canonical-contracts/src/identifiers.ts:193` contains the existing
technical-locator sanitization boundary. A bound explicit sanitized declaration
could be reused after the gate; sibling object presence alone cannot populate
AgentVersion connectivity. Endpoint configuration is not an observed connection.

Existing vocabularies: ApiProtocolFamily UNKNOWN/HTTP/GRPC/GRAPHQL/WEBSOCKET/EVENT/
OTHER; McpTransport UNKNOWN/STDIO/STREAMABLE_HTTP/SERVER_SENT_EVENTS/OTHER. These
are separate existing vocabularies, not interchangeable synonyms. No protocol
inference from ports. Environment, network/VPC, egress and internal/external
classification stay unsupported without direct bounded declarations. No branch,
folder, hostname or IP-based guesses; no network scanning/probes/control planes.

No M13 values were ingested or persisted. Future leaves must reject/redact unsafe
credential material under existing evidence rules: passwords, client secrets,
API keys, bearer/access/refresh tokens, private keys, session cookies,
Authorization headers and credential-bearing URIs. A safe declared opaque
reference is distinct from the credential itself. No real secrets were used in
tests or printed. Existing locator tests do not establish comprehensive M13
secret rejection for the absent parser.

## 9. Source authority, trust and provenance

Authority remains fact/field/source-specific. Repository desired scope and
provider effective grant cannot share implicit global vendor authority. Existing
M10 policy versions/explicit heads, observations and decisions are useful
foundations, but their accepted closed domain excludes AGENT_VERSION.

Future supported static declarations must retain DECLARED; supported enterprise
imports retain IMPORTED. Neither is OBSERVED or automatically VALIDATED.
Existing L4 framework/orchestration interpretation uses INFERRED, as documented
and tested in M3; it is not relabeled or reused as an M13 declaration source.
Scanner machine authority remains PROPOSED.

SourceAssertion/Evidence and TechnicalMetadataSupport can preserve exact source,
connection, acquisition/run, method/version, evidence/assertion IDs and available
temporal context. They do not independently establish effective grants or field
authority. No new evidence observation or canonical fact was created by this gate.

## 10. AgentVersion immutability, persistence and tenancy

The technical-profile ADR F.1/F.2 preserves immutable behavior fingerprints and
rejects different known optional values; stronger compatible provenance may be
enrichment. Existing SQL rejects AGENT_VERSION_TECHNICAL_REVISION_MISMATCH and
AGENT_VERSION_PROFILE_SEMANTIC_CONFLICT. The current projection has no M13 inputs,
so its passing version tests cannot prove principal/scope/network immutability.

An approved extension must retain V1/V2 separation even for a shared principal,
version behavior-significant differences upstream and fail closed when equivalent
behavior or exact binding cannot be proven. Blindly copying M10 mutable-current
field history onto a fixed version would not satisfy that rule.

Persistence selected for implementation: **none — gate blocked**. No migration
created, historical migration edited or SQL executed. Existing normalized typed
profile/proposal/support and immutable observation/decision patterns were inspected
only. Future use must be tenant-scoped, auditable, RLS-aligned and non-secret.
Trusted server organisation/connection must scope every binding; untrusted payloads
cannot choose tenant or authority. No new tenancy surface was introduced.

## 11. Passport, Graph, Vector, LLM and runtime continuity

`apps/dashboard/lib/governance/agent-passport.ts:70–77` closes facts to identity,
mapping, five profile leaves, relationships and M10 data fields. Runtime,
authorization and connectivity family item types are `never`. All 16 families
remain represented; their missing facts stay UNKNOWN. M13 would require a typed
read-model adaptation after the domain decision, not an arbitrary family payload.
Families 7/8/13-design-time/14/15/16 remain separate; no UI redesign or fabricated
completeness percentage.

M12 consumes canonical objects/eligible canonical relationships as an ANALYTICAL
read projection. No new principal/permission/scope/role/network graph edges, vector
authority, embedding or LLM inference. No runtime identity, observed network path,
successful permission use, OTel, calls, latency, errors, tokens or cost implemented.
Milestone 14 is **NOT STARTED**.

## 12. Focused validation and required matrix accounting

Local foundation regressions executed on the unchanged implementation:

| Command (package working directory) | Result |
| --- | --- |
| canonical-contracts: `node --test --test-isolation=none test/contracts.test.mjs` | 96 passed, 0 failed |
| scanner: `node --import tsx --test --test-isolation=none test/discovery-engine/agent-version-correlation.test.ts test/discovery-engine/agent-version-technical-signals.test.ts` | 40 passed, 0 failed |
| `git diff --check` and evidence-file whitespace check | Passed |

**136 passing existing tests**, not M13 feature tests. They cover existing closed
taxonomy/endpoint contracts, support, locator and version correlation foundations,
including changed model/framework/prompt behavior and fail-closed source ambiguity.
They do not validate absent M13 sources, authority, grant or persistence paths.
No source/type/schema change means no affected typecheck or migration test. No
unrelated full suites, Validation Lab, new golden contract or live database test.

| Requested acceptance cases | Gate accounting |
| --- | --- |
| 1–4 architecture | Closed existing taxonomy regression; subject/legacy separation assessed; no M13 binding implemented |
| 5–9 identity | NOT_IMPLEMENTED; direct binding, principal UNKNOWN and principal-change behavior not feature-tested |
| 10–14 secrets | Existing locator boundary only; M13 parser/leaf rejection and safe reference retention NOT_IMPLEMENTED |
| 15–17 capability | NOT_IMPLEMENTED; no capability-to-authorization conversion introduced |
| 18–25 authorization | BLOCKED_ARCHITECTURE/BLOCKED_AUTHORITY; no grant/scope/state tests claimed |
| 26–31 connectivity | Locator/protocol foundations only; version connectivity NOT_IMPLEMENTED; no probes performed |
| 32–34 versioning | Existing version regressions pass; M13 principal/connectivity/authz inputs remain untested and blocked |
| 35–38 trust | Existing design-time no-OBSERVED/no-auto-VALIDATED regressions pass; no new M13 facts emitted |
| 39–41 tenancy | Existing contract/source-scope regressions only; new M13 cross-tenant persistence NOT_IMPLEMENTED |
| 42–43 legacy | Narrow source review confirms governance heuristic domain; connectors unchanged |
| 44–45 Passport | Existing typed UNKNOWN families inspected; no M13 integration or new Passport tests claimed |
| 46–50 boundaries | No graph/vector/LLM/runtime modifications or calls; M14 not started |

## 13. One focused adversarial pass A–P

One manual readiness review, not an implementation security certification. No
second broad review or subagent. Concrete findings are the architecture/binding
gaps above; the correction is to stop before introducing unsupported semantics.

| Check | Result |
| --- | --- |
| A Governance user as execution principal | Rejected; legacy heuristic is not a source |
| B AGENT instead of AGENT_VERSION | No new records; exact version required |
| C Capability promoted to authorization | No promotion; separate model required |
| D Requested promoted to granted | No promotion; distinct typed leaves still missing |
| E UNKNOWN converted to DENIED | No conversion or enum invented |
| F Role/group name as permission | Explicitly rejected |
| G Secret persisted | No M13 persistence or ingestion |
| H Credential URI persisted | No M13 URI ingestion; existing locator foundation only |
| I Endpoint as observed connectivity | Explicitly rejected; sibling locators are not reachability |
| J Historical behavior mutation | Blocked until M13 inputs/history semantics are defined |
| K Cross-tenant binding | No new binding path; trusted tenant scope required |
| L Legacy heuristic promoted to authority | Connectors unchanged and excluded |
| M Generic JSON/EAV | No new value store; configurationReference/rawAttributes not repurposed |
| N New canonical kind/type | None; frozen taxonomy preserved |
| O Graph/Vector/LLM authority leak | No integration or authority change |
| P Early runtime semantics | No OBSERVED execution facts; M14 not started |

## 14. Limitations, delivery and production

Only this evidence file was added. No feature implementation, dependency,
configuration, frozen architecture, migration, existing evidence or connector
change. Readiness gaps are established within the requested narrow inspection;
no enterprise source availability or production population was verified.

Implementation is not complete. The user's commit/push/PR condition therefore
does not apply: **no commit, no push, no PR**. Branch HEAD remains the base SHA;
this evidence is left as a reviewable uncommitted artifact.

**MERGE STATUS: NOT MERGED. PRODUCTION STATUS: UNTOUCHED.**
**NEXT MILESTONE: 14 — NOT STARTED.**
**VERDICT: STOP_REQUIRES_ARCHITECTURE_DECISION.**

## 15. Authorized architecture resolution and continuation — 2026-09-15

Sections 1–14 above are preserved verbatim as the original STOP history. The
external review accepted that STOP and the user supplied an authoritative additive
decision. Resume status matched the expected feature branch/base HEAD; only this
existing evidence and the protected recovery file were untracked. `git diff --stat`
was empty and `git diff --check` passed. No restart, reset or historical amendment.

The new accepted decision is recorded in
`docs/architecture/ADR-GOVIA-EXECUTION-CONTEXT-IDENTITY-CONNECTIVITY-AUTHZ-v1.md`.
It resolves the original architectural scope, including the eight readiness rows
marked BLOCKED_ARCHITECTURE: principal, service account, OAuth/client identity,
role reference, capability, action/resource declaration, requested scope and
authorization state. The earlier final-response count was awkwardly split; the
original matrix itself contains eight architectural blockers, five evidence
blockers, two authority blockers, one binding blocker and two foundations.

**The accepted decision supersedes the original proposed blanket version treatment
for principal, grants and deployment context.** These are now explicitly temporal
execution assignments and must not cause new AgentVersions. Capability/requested
scope and behavior-significant declared connectivity remain behavior-versioned.
Nothing in the prior STOP is removed or presented as the current architecture.

## 16. Implemented independent foundation

`packages/canonical-contracts/src/execution-context.ts` adds closed, separate
declared and temporal fact unions, principal references, exact AGENT_VERSION
subject/context interfaces, source support and a separately typed M13 field-policy
interface reusing M10 policy attributes/head types. It leaves TechnicalFact,
DataObjectKind, the M10 policy evaluator and SQL domain unchanged.

| New fact field | Classification | Contract status | Source/production status |
| --- | --- | --- | --- |
| CAPABILITY | BEHAVIOR_VERSIONED | FOUNDATION_ONLY | BLOCKED_EVIDENCE |
| REQUESTED_SCOPE | BEHAVIOR_VERSIONED | FOUNDATION_ONLY | BLOCKED_EVIDENCE |
| DECLARED_CONNECTIVITY | BEHAVIOR_VERSIONED | FOUNDATION_ONLY | BLOCKED_BINDING |
| PRINCIPAL | EXECUTION_CONTEXT_TEMPORAL | FOUNDATION_ONLY | BLOCKED_EVIDENCE |
| ROLE_REFERENCE | EXECUTION_CONTEXT_TEMPORAL | FOUNDATION_ONLY | BLOCKED_EVIDENCE |
| GRANTED_SCOPE | EXECUTION_CONTEXT_TEMPORAL | FOUNDATION_ONLY | BLOCKED_EVIDENCE |
| PERMISSION (principal/action/resource/state) | EXECUTION_CONTEXT_TEMPORAL | FOUNDATION_ONLY | BLOCKED_EVIDENCE |
| ENVIRONMENT | EXECUTION_CONTEXT_TEMPORAL | FOUNDATION_ONLY | BLOCKED_EVIDENCE |
| NETWORK_CONTEXT | EXECUTION_CONTEXT_TEMPORAL | FOUNDATION_ONLY | BLOCKED_EVIDENCE |
| EGRESS | EXECUTION_CONTEXT_TEMPORAL | FOUNDATION_ONLY | BLOCKED_EVIDENCE |
| DEPLOYMENT_CONNECTIVITY | EXECUTION_CONTEXT_TEMPORAL | FOUNDATION_ONLY | BLOCKED_BINDING |

The value constructor validates/copies/freezes closed semantic values and rejects
extra fields. Principal kinds are SERVICE_ACCOUNT/OAUTH_CLIENT/MANAGED_IDENTITY/
WORKLOAD_IDENTITY/USER_DELEGATED, with separate provider, authority namespace and
principal reference. A role is a role reference, not a principal kind or a grant.
PERMISSION retains the complete principal/action/resource tuple and explicit
ALLOWED/DENIED/UNKNOWN state; absence cannot default to DENIED. The constructor
does not grant authority to any value, including explicit ALLOWED/DENIED.

Connectivity uses existing SanitizedTechnicalLocator, ApiProtocolFamily and
McpTransport. The foundation accepts safe HTTP(S)/WS(S) URIs and preserves the
explicit protocol value, including UNKNOWN; no protocol inference from ports.
Environment has a bounded vocabulary, while network/VPC/egress use opaque declared
references, not inferred topology. No service-topology parser or reference
resolution is implemented.

`declaredExecutionSemanticValues` is an order-independent, deduplicated closed
semantic projection for prospective use. It rejects temporal facts and unrelated
properties. It is **not a fingerprint or a discovery producer**, and does not
authenticate supplied facts. No new fingerprint schema is activated, no M13
declaration is folded into the live correlation path, and no historical
fingerprint is rewritten. Supported source binding must precede any such wiring.

Every declared/temporal fact envelope has typed support for all leaves, source,
snapshot, method and temporal context; declared source trust is DECLARED and
temporal source trust is DECLARED/IMPORTED. The exact canonical subject is typed
AGENT_VERSION and temporal facts additionally require an explicit context reference.
These interfaces are not runtime proof of binding/tenancy/evidence. There is no
untrusted intake endpoint, proposal factory, evidence writer or materializer for
them. Do not use an arbitrary caller-supplied interface value as verified source.

## 17. Narrow source-readiness findings

No actual M13 source family/adapter was implemented in this continuation.
Additional inspection was limited to the existing API/MCP detectors, their
structural binding/correlation code, relevant tests and the existing care fixture
explicitly cited by the API detector. No golden file was modified and no
Validation Lab suite ran.

| Existing source path | What is actually established | Missing M13 proof |
| --- | --- | --- |
| strategies/api-declaration.ts | Explicit *_API object id, DECLARED; care fixture also contains base_url | Detector emits object identity, not AgentVersion execution connectivity |
| strategies/mcp-server-declaration.ts | Named MCP server identity from supported configuration shapes | No exact AgentVersion binding; naming/co-presence insufficient |
| behavior-declaration-binding.ts | Restricted direct model/tool property proof in flat declarations | Does not prove API/MCP call chains, scopes or execution principals |
| relationship-correlation.ts and its tests | Exact model/tool bindings; API/MCP remain BLOCKED_CORRELATION | No implemented endpoint-to-version execution proof |
| 06-care-coordination/src/care_agent.py | API locator and a method/function call chain in a synthetic benchmark | Current bounded parser deliberately excludes methods/call chains; no approved parser proof may be fabricated from co-presence |
| identity/types.ts + Entra/Okta/Keycloak | Human directory sync/governance heuristic and connector access configuration | Not AgentVersion identity/grant sources; unchanged |

No capability/requested-scope/execution-principal declaration supported by these
current parsers was established. The source search is not a claim that such
configuration exists nowhere; it records the limits of the focused source audit.
Existing L9 dependencies must not be renamed capabilities or authorization facts.

A source clarification was requested while independent ADR/contracts work
continued: identify the concrete declaration/import and exact version-binding
evidence. Without that, this pass does not invent a source schema, use a DTO fixture
as source certification or silently add a Python call-graph inference engine.
Further source-dependent work requires review of that source/binding selection.
This is an evidence/binding readiness issue, **not a renewed rejection of the
accepted architecture decision**.

## 18. Authority, history, secrets and downstream status

The new ExecutionFieldAuthorityPolicy has exact AGENT_VERSION kind and a closed
ExecutionField. It reuses M10 versioned policy/head attributes only. Runtime policy
resolution, explicit activation, acceptance, stale guards, source observations,
decisions and append-only temporal persistence for M13 remain **FOUNDATION_ONLY /
not implemented**. No policy is configured or accepted for an unsupported source.
M10 continues governing only its original data fields. There is no second generic
governance framework or migration populated with unsupported facts.

Principal/grant/environment/network changes are contractually temporal under the
accepted ADR. No durable M13 history exists yet; its required predecessor/effective
state and atomic decision guards remain implementation obligations. Passing tests
of semantic exclusion do not claim production temporal state history.

The foundation rejects credential property names, recognizable credential
assignments/token forms, whitespace/control characters, URL userinfo, query/
fragment/percent-encoded payloads and non-network endpoints, using value-free
errors. It never persists or emits evidence excerpts. This is a conservative
boundary for reference values, **not a universal detector for arbitrary opaque
secrets**. A future supported producer must separately prove safe non-secret
source positions before DTO/evidence/fingerprint handling. No real secrets were
read or used in tests. Provider-specific unrestricted opaque secrets cannot be
made safe merely by passing this value constructor.

Tenancy is represented in the exact subject and reused policy types; no new
runtime trust boundary or cross-tenant persistence path was added. Passport
runtime/authorization/connectivity family item types remain `never`; all 16
families and UNKNOWN presentation remain unchanged. There are no governed M13
facts to project. No Graph edges, Vector authority, LLM inference or runtime facts.
M14 remains NOT STARTED; production remains UNTOUCHED.

## 19. Continuation validation and acceptance accounting

| Check | Final result |
| --- | --- |
| canonical-contracts contracts.test.mjs | 96 passed |
| canonical-contracts execution-context.test.mjs | 17 passed |
| scanner agent-version-correlation, agent-version-technical-signals, relationship-correlation, l4-round1-object-detection tests | 108 passed |
| canonical-contracts typecheck including negative execution-context typing | Passed |
| governance-review typecheck | Passed |
| scanner typecheck | Passed |
| git diff --check and new-file whitespace verification | Passed |

**221 distinct passing tests in this continuation**; the original 136 are not
added again. The first combined contract run had one new failure because safe
URL normalization removed an explicit default port. Corrected the constructor
to permit benign normalization after rejecting credential-bearing input; all
17 new tests then passed. The scanner initially hit sandbox `spawn EPERM` in
esbuild; the identical command passed with approved local execution escalation.
No live provider/network/database/production calls, SQL/RLS claims or browser QA.

| Requested continuation cases | Honest coverage |
| --- | --- |
| 1–4 exact version | Negative type test rejects AGENT; existing L9 binding regressions pass; no M13 runtime binding producer |
| 5–6 changed declared behavior | Semantic projection distinguishes capability/scope/endpoint changes; no new discovery fingerprint schema activated |
| 7–10 temporal exclusion/history | All temporal variants rejected from declared semantic projection; existing version regressions pass; no historical rewrite |
| 11–15 capability/authz | Separate closed values, role separation and explicit UNKNOWN tested; no governed acceptance/source path |
| 16–19 principal | Five typed kinds and forbidden user/group/connector/secret shapes tested; no source-backed proposal producer |
| 20–25 authority | Closed policy interface and wrong-field negative typing only; M13 policy resolution/stale/replay acceptance NOT_IMPLEMENTED |
| 26–30 connectivity | Explicit value/protocol/UNKNOWN validation tested; no edge emission or environment/network inference; binding still blocked |
| 31–33 temporal history | Classification foundation only; durable M13 history NOT_IMPLEMENTED |
| 34–37 trust/runtime | Envelope types forbid OBSERVED; source adapters not implemented; unchanged scanner trust regressions pass; no M14 work |
| 38–39 tenancy | Exact typed subject/policy and rejection of tenant in semantic values; no M13 server-binding or persistence tests claimed |
| 40–48 boundaries | Closed taxonomy regression and unchanged downstream/legacy/runtime code; no production changes or credentials |

## 20. One continuation adversarial pass

One focused manual pass over the new ADR/contracts/tests, distinct from the
original gate's preserved readiness review. No subagents or broad audit.
Checked AGENT substitution; capability/requested-scope promotion; absent-to-denied;
role/group and connector-credential inference; secret handling; temporal input
contamination; declared semantic omissions; historical rewrite; tenant/authority
claims; policy ambiguity; static OBSERVED; network inference; INVOKES reachability;
and M14 leakage.

Concrete corrections completed in this continuation: protocol discriminant getters
are rejected before access; percent-encoded reference payloads are rejected; benign
endpoint normalization is allowed only after unsafe values are rejected. Tests
exercise these boundaries. Review also explicitly rejects treating semantic-value
validation, policy interfaces or fixtures as binding/authority/source certification.
There is no M13 acceptance path on which to claim policy ambiguity/stale-state
enforcement. No new unsupported source parser or synthetic population was added.

## 21. Continuation handoff

Files added: accepted execution-context ADR; execution-context.ts;
execution-context.type-test.ts; execution-context.test.mjs. Files adapted:
canonical-contracts index.ts export and package.json focused test registration.
This existing evidence file was appended only. Frozen baseline/roadmap, historical
ADRs, migrations, scanner implementation, legacy connectors, M10/M11/M12 consumers
and protected recovery file remain unchanged.

The independent ADR and typed foundation are reviewable, but **the milestone is
not complete**: no source-backed M13 proposal, upstream fingerprint integration,
governed temporal persistence/authority acceptance or Passport population exists.
The remaining issue is concrete source/binding selection and its supported parser,
not missing architectural permission. Accordingly no commit/push/PR was performed;
the user's delivery condition requires completion of a defensible feature scope.
Changes remain uncommitted on the same branch at the expected base HEAD.

**MERGE STATUS: NOT MERGED. PRODUCTION STATUS: UNTOUCHED.**
**NEXT MILESTONE: 14 — NOT STARTED.**
**CONTINUATION VERDICT: STOP_REQUIRES_REVIEW (source/binding readiness).**

## 22. Recovery safety gate and WIP classification — 2026-09-15

Recovery continued on `feat/connectivity-execution-identity-authz-v1`.
HEAD and local origin/main both equal
`9533fb20b85900a845880060ecdc28aa1a69e270`. The user independently confirmed remote
main at that SHA. No fetch was required or attempted in this recovery; no Git
administrative files were changed. No checkout, reset, stash or discard occurred.
Initial tracked diff: two files, two insertions, one deletion. Initial
`git diff --check` passed.

| Existing file | Classification | Inspected content / disposition |
| --- | --- | --- |
| packages/canonical-contracts/package.json | EXPECTED_M13_WORK | Registers execution-context tests only; retained |
| packages/canonical-contracts/src/index.ts | EXPECTED_M13_WORK | Adds the execution-context public export only; retained |
| packages/canonical-contracts/src/execution-context.ts | EXPECTED_M13_WORK | Closed semantic values and foundation envelopes; retained, not certified as a source/governance implementation |
| packages/canonical-contracts/src/execution-context.type-test.ts | EXPECTED_M13_WORK | Negative subject, trust, scope, policy and credential typing; retained |
| packages/canonical-contracts/test/execution-context.test.mjs | EXPECTED_M13_WORK | Seventeen synthetic foundation tests; retained |
| docs/architecture/ADR-GOVIA-EXECUTION-CONTEXT-IDENTITY-CONNECTIVITY-AUTHZ-v1.md | EXPECTED_M13_WORK | Additive behavior/temporal and field-authority decision recorded by the prior continuation; retained |
| This evidence document | EXPECTED_M13_WORK | Original gate plus continuation history; current status clarified and recovery appended |

No unrelated or generated edit was found among the seven inspected WIP files.
The separately permitted `codex-recovery-6101-6240.txt` was excluded from content
inspection and all file operations. No `.claude/**` inspection or subagents.

The existing ADR is relevant because it records behavior-versus-temporal identity
and closed field-authority semantics beyond merely adding a TypeScript interface.
Its ACCEPTED status is retained as repository operational memory from section 15;
this recovery does not invent another approval or rewrite the frozen baseline.
The current source/binding blocker does not reopen that architecture decision.

### Architecture A–O at recovery

| Item | Recovery assessment |
| --- | --- |
| A CIA | GOVIA-L0L16-CIA-v1.0 frozen and unchanged |
| B L0–L16 | L10/L11 foundation; future source/binding uses L0–L4; no L12 implementation |
| C Passport | Existing families 15/16 remain UNKNOWN; related 1/5/7/8/11/14 remain unchanged |
| D Canonical | Exact AGENT_VERSION envelope; eleven kinds/twelve relationship types unchanged |
| E Lineage | No principal/network/authz edges or inferred access |
| F Evidence | Source, snapshot, method, assertion/evidence support interfaces; no M13 producer/writer |
| G Trust/authority | DECLARED/IMPORTED envelope vocabulary; no automatic validation; M13 policy evaluation absent |
| H Vector | Unchanged, analytical only |
| I Graph | Unchanged, downstream projection only |
| J LLM | No invocation or permission/identity inference |
| K Tenancy/security | Typed organisation-scoped subject is a foundation; source ownership/binding checks not implemented |
| L Migration | None added or executed |
| M Continuity | M10 closed data fields retained; M11 UNKNOWN retained; M12 unchanged |
| N Non-fabrication | No invented source syntax, exact-version association, grant or runtime reachability |
| O Acceptance | 129 contract tests and three typechecks pass; end-to-end M13 acceptance remains incomplete |

## 23. Reuse, source readiness and remaining implementation

| Component | Reuse classification | Confirmed limit |
| --- | --- | --- |
| Canonical identities, source identities and TechnicalMetadataSupport | REUSE_AS_IS | Identity/support primitives do not authenticate M13 input |
| API/MCP locator and protocol contracts | REUSE_AS_IS | Sibling object facts, not execution connectivity or authorization |
| AgentVersion fingerprint/binding pipeline | ADAPT | No M13 declaration producer or prospective fingerprint integration |
| M10 field policies, review and history patterns | ADAPT / REUSE_WITH_ADAPTER | Existing evaluator accepts data fields only; do not widen implicitly |
| M13 authority evaluator and durable temporal state | NOT_PRESENT | Policy interface alone has no acceptance, replay or stale-state enforcement |
| M11 Passport | ADAPT | Future typed read integration; authorization/connectivity items currently `never` |
| M12 analytical projection | REUSE_AS_IS | Preserve existing read-only boundary; no M13 extension needed |
| identity/types.ts and Entra/Okta/Keycloak connectors | LEGACY_DO_NOT_EXTEND / LEGACY_HUMAN_IDENTITY | Users/groups and isGovernanceRelevant are human-governance integration |
| dashboard/lib/auth/legacy-authorization.ts | LEGACY_DO_NOT_EXTEND / LEGACY_APPLICATION_AUTHZ | Human application permission checks never become Agent execution grants |

Focused inspection reconfirmed the section 17 source gap. API declaration emits
the explicit API object ID. MCP configuration emits server identity. Neither
proves an execution principal or an exact AgentVersion execution binding.
`behavior-declaration-binding.ts` supports restricted flat declarations;
`relationship-correlation.ts` accepts only directly evidenced MODEL/TOOL behavior
bindings. This cannot be relabeled as M13 capability, IAM permission or connectivity.
No execution-context consumer was found in the inspected scanner discovery,
governance-review or dashboard governance source directories.

| Required concept | Foundation readiness | Operational readiness |
| --- | --- | --- |
| Execution principal identity | FOUNDATION_ONLY | BLOCKED_EVIDENCE; provider/authority/principal strings need source-specific identity proof |
| Connectivity endpoint | FOUNDATION_ONLY | BLOCKED_BINDING; no exact version execution proof |
| Protocol/context | FOUNDATION_ONLY | BLOCKED_BINDING; existing API/MCP vocabulary is reusable |
| Capability | FOUNDATION_ONLY | BLOCKED_EVIDENCE; no supported explicit producer |
| Authorization | FOUNDATION_ONLY | BLOCKED_EVIDENCE; no governed source acceptance |
| Scope | FOUNDATION_ONLY | BLOCKED_EVIDENCE; requested and granted remain separate |
| Grant/permission | FOUNDATION_ONLY | BLOCKED_EVIDENCE; principal/action/resource/state needs supported authority |
| AgentVersion binding | FOUNDATION_ONLY | BLOCKED_BINDING; typed subject is not runtime proof |
| Tenant isolation | FOUNDATION_ONLY | NOT_IMPLEMENTED for M13 intake/support ownership checks |
| Passport projection continuity | IMPLEMENTED for existing UNKNOWN presentation | NOT_IMPLEMENTED for M13 fact population |
| Graph downstream compatibility | IMPLEMENTED for unchanged closed taxonomy | No M13 graph feature introduced |

No V1 source family is selected. A clarification requested the concrete source
path/format and fields proving the exact version association. Inventing a manifest
or treating contract DTO fixtures as a supported source would violate the existing
ADR implementation prerequisite and recovery non-fabrication/binding rules.
This is a bounded source-readiness finding, not a claim that no suitable enterprise
configuration exists anywhere. Further source-dependent work remains pending.

Identity references preserve kind/provider/authority/principal components, but no
source-backed deterministic principal resolver or replay identity is implemented.
Capability never yields a permission; role references never yield an effective
grant; endpoint values never imply reachable/authorized/healthy state. Permission
values retain explicit ALLOWED/DENIED/UNKNOWN with action/resource/principal.
Absent permission state is rejected by the constructor, not defaulted to denial.
Missing governed evidence continues to render UNKNOWN in Passport.

Static envelopes allow DECLARED, temporal imported envelopes allow IMPORTED;
no adapter emits OBSERVED or VALIDATED. No evidence or secret material is persisted.
Reference validation rejects tested credential forms but cannot establish that an
arbitrary opaque string is a safe provider identifier. Safe source positions must
be established before ingestion; no production secret-safety certification is made.
Effective dates are optional and never fabricated. Temporal fact exclusion from
behavior input is tested; durable V1/V2 history, completed decision replay and
cross-organisation support rejection still require implementation.

## 24. Fresh validation and one focused recovery adversarial pass

| Command / check | Result in this recovery |
| --- | --- |
| npm test --workspace=@council/canonical-contracts | PASS: 129 tests, zero failures (96 base, 16 semantic, 17 execution foundation) |
| npm run typecheck --workspace=@council/canonical-contracts | PASS, including execution-context negative typing |
| npm run typecheck --workspace=@council/governance-review | PASS |
| npm run typecheck:scanner | PASS |
| Initial git diff --check | PASS |
| Final git diff --check; explicit new-file whitespace checks | PASS; frozen document diff empty |

One initial npm command used the incorrect @gov-ia workspace prefix and did not
execute tests; correcting it to the package's @council name passed. No dependencies,
escalation, external API, database, Validation Lab or unrelated full suite was needed.
Previously recorded test totals are historical and are not added to these 129.
The first new-file check wrapper incorrectly treated the normal no-index exit 1
(new-file differences) as a failure; the corrected check required no diagnostics
and no error exit above 1. All five explicitly listed new files passed.

| Recovery test cases | Coverage and explicit gap |
| --- | --- |
| 1–4 identity | Principal value and stable semantic projection tests; exact source identity, V1/V2 context and proximity rejection at M13 intake NOT_IMPLEMENTED |
| 5–7 capability | Separate capability value, no implicit permission, explicit UNKNOWN; absent governed evidence stays UNKNOWN in unchanged Passport |
| 8–12 authorization | Explicit tuple states and requested/granted/role separation tested as values; evidence-backed grant/denial acceptance NOT_IMPLEMENTED |
| 13–16 connectivity | Endpoint/protocol value and explicit role tests; no reachability/authorization evaluator or static-to-runtime path |
| 17–19 secrets | Synthetic credential properties, recognizable token forms and unsafe URI rejection tested; source-specific credential exclusion NOT_IMPLEMENTED |
| 20–21 tenancy | Typed organisation context only; no M13 cross-tenant intake/support acceptance tests claimed |
| 22–24 trust | Static OBSERVED rejected by typing; value constructor rejects unrelated trust fields; no producer or automatic VALIDATED path |
| 25–29 boundaries | Focused source review and unchanged consumers; no Graph/Vector/LLM authority, runtime work or production access |
| 30 continuity | Canonical regressions and direct consumer typechecks pass; dashboard/M10/M12 behavior not changed or separately retested |

Exactly one focused recovery pass assessed the current WIP against the requested
capability/grant, absence/denial, role/grant, endpoint/reachability, static/runtime,
secret, AGENT/AGENT_VERSION, tenant-support, temporal, Graph and M14 boundaries.
No new concrete code defect was established within the documented value-only
foundation scope. The material acceptance gaps are missing producer/binding,
source authority, runtime tenant/support validation and durable history. These
must remain explicit limitations; passing shape tests cannot certify them.
The concrete documentation correction is the current-status banner and recovery
matrix, preventing historical STOP/validation claims from being mistaken for the
latest result. No second broad review was performed.

## 25. Recovery disposition

Only this evidence document was edited during recovery; all six other M13 WIP
files were preserved. Frozen architecture, historical evidence, scanner,
governance-review, Passport, Graph/Vector and legacy human identity/authz source
remain unchanged. The source/binding question is required before dependent work;
elapsed time is not evidence or source-selection approval.

The milestone is incomplete, so the conditional commit/push/PR step does not apply.
No commit, push or PR was created. HEAD remains the base SHA. The remaining work
requires a concrete supported source and exact version-binding proof, followed by
its proposal/authority/history implementation and honest Passport integration.

**MERGE STATUS: NOT MERGED. PRODUCTION STATUS: UNTOUCHED.**
**NEXT MILESTONE: 14 — RUNTIME & OBSERVABILITY V1 — NOT STARTED.**
**RECOVERY VERDICT: STOP_REQUIRES_REVIEW (source/binding readiness).**

## 26. Approved strict direct source V1 — implementation in progress

The architect explicitly approved Option B in this session: extend
DIRECT_AGENT_PROPERTY_V1 with executionPrincipal, connectivity and requestedScopes;
direct tools supply capability. No new ADR, identity algorithm or canonical kind.
The resume gate passed on the existing feature branch at the expected base SHA.
All prior WIP is retained. The current implementation status supersedes the
source-selection STOP above; completion and validation will be recorded below.

Before implementation, the A–O mapping in section 22 is retained with these
approved changes: L10/L11 declarations gain per-fact DECLARED evidence; connectivity
and requested scope extend the existing revision projection prospectively;
principal assignment is temporal and excluded. Closed tenant-scoped proposals,
explicit field governance and append-only selection history will support read-only
Passport families 15/16. One additive migration maximum. M10 data-field contracts
remain separate. No grant/role/permission producer, no runtime fact, no Graph,
Vector or LLM authority. No live database or production operations.

## 27. Recovery on 2026-09-16 and interrupted test

- Branch: `feat/connectivity-execution-identity-authz-v1`.
- Recovery HEAD: `9533fb20b85900a845880060ecdc28aa1a69e270`, exactly the
  authoritative main/M12 baseline. `git merge-base --is-ancestor` returned 0.
- Inspected status, branch, HEAD, last ten commits, tracked diff/stat and cached
  diff. The index was empty. All existing M13 WIP was preserved and continued.
- No destructive Git operation, subagent, architecture restart, broad audit,
  protected recovery-file access or `.claude/**` inspection occurred.
- Re-ran the exact interrupted command in `apps/dashboard`:

```text
node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/passport-query.test.ts tests/discovery-intake-service.test.ts tests/execution-context-migration.test.ts
```

The sandbox initially blocked Node child processes (`spawn EPERM`); the same
command ran with approved escalation: **112 tests, 107 passed, 5 failed**.
All five failures reported `EXECUTION_SOURCE_PERSISTENCE_FAILED`: existing intake
test ports omitted the new execution snapshot persistence dependency. The fixture
now validates exact durable version/Tool candidates, typed profile proposal and
tenant-local DECLARED/HASH_ONLY support. Governance methods throw if discovery
calls them. The exact command then passed **112/112**. No production check was
disabled to satisfy these tests.

## 28. Implemented source, identity, governance and Passport

The approved extension is a bounded TS/JS direct object literal. Example:

```ts
export const triageAgent = {
  kind: "agent",
  tools: [classifyRequest],
  executionPrincipal: {
    kind: "SERVICE_ACCOUNT", provider: "fixture",
    authority: "realm", principal: "account"
  },
  connectivity: [{
    endpoint: "https://catalog.invalid/v1",
    protocol: { kind: "API", family: "HTTP" }
  }],
  requestedScopes: [{ scope: "catalog.read", resource: "catalog" }],
};
```

`protocol` reuses the existing closed API-family / MCP-transport object; it is
not a new string taxonomy. Only network URI endpoints are supported. Protocol
UNKNOWN is explicit, never inferred from a port. Incompatible scheme/protocol
combinations and STDIO network declarations are rejected. Python retains its
existing direct tools-only binding; the new nested properties are TS/JS only.
Expressions, calls, environment lookups, spreads, computed properties, template
strings, indirect configuration and self-declared grants/permissions fail closed.

Exactly one normalized Agent declaration, its marker, source tuple and acquired
snapshot must agree. The existing direct Tool candidate supplies capability;
there is no second Tool identity or API/MCP edge inferred from connectivity.
The existing AgentVersion correlation/hash receives sorted canonical connectivity
and requested-scope values prospectively (schema 1.1). Principal and provenance
do not contribute. Legacy declarations keep their existing revision projection.
New per-fact assertions are DECLARED with `DIRECT_AGENT_EXECUTION_V1`; historical
INFERRED assertions are preserved. Evidence has HASH_ONLY handling and no excerpt.

The typed proposal is a source-configuration snapshot, not a runtime observation.
Principal changes retain the exact AgentVersion and append independent support.
Immutable snapshots/decisions/field selections retain history. Explicit source
heads, field policy versions and predecessor IDs govern acceptance; timestamps
never resolve policy precedence. Completed exact replay returns the existing
result before stale-head checks and cannot move a source head backwards.

Human `org_admin` decisions use the verified session cookie, exact canonical
AGENT_VERSION mapping and explicit applicable field policy. Discovery has no
decision/materialization call path. Graph, Vector and LLM have no write authority.
The review API is `/api/governance/workspace/execution-context`; tenant/actor cannot
be supplied in its body. No grant/role/permission producer is installed. Every
source snapshot and Passport execution fact retains authorization UNKNOWN.

Passport remains 16 families. Families 15/16 show accepted typed fields only,
with source snapshot, exact selected version, decision, policy and evidence.
Proposals alone cannot populate governed facts. Runtime identity, reachability,
network permission and authorization remain UNKNOWN. Historical policy head
changes do not rewrite an accepted fact. No new review UI or deployment view is
claimed; review is available through the authenticated API.

## 29. Concrete defects fixed and focused boundary validation

Besides the missing test port, focused implementation validation found and fixed:

1. The new route initially used legacy identity headers. It now uses a verified
   signed cookie and rejects missing configuration, fallback keys, invalid sessions
   and non-admin writes. Spoofed headers cannot choose a tenant or reviewer.
2. Initial SQL grants allowed service-role direct table inserts outside the
   policy/source/predecessor checks. Those DML privileges are revoked on snapshot,
   source-head, fact, decision and state tables. Only two narrowly granted
   SECURITY DEFINER RPCs own those writes, with fixed `search_path=pg_catalog`
   and schema-qualified relation references. PUBLIC/anon/authenticated cannot
   execute them. Policy configuration remains a trusted service operation.
3. Passport validation now checks the decision's exact version, predecessor and
   time, historical policy source/provider/connection/disposition, and evidence
   method/source in addition to accepted outcome. Conflicting rows fail closed.
4. Snapshot envelopes reject unknown fields (including credential extensions),
   and require canonical fact values. Snapshot and decision inputs are copied
   before asynchronous operations to prevent caller mutation changing the target.

The focused tests cover cross-tenant snapshots, decisions, evidence and states;
forged body identifiers; missing/ambiguous/stale/non-authoritative policies;
stale source and prior state; conflicting replay; UNKNOWN semantics; no proposal
to governed-state bypass; preserved M10/M11 behavior and no Graph/Vector/LLM writes.
This implementation validation is **not** the independent adversarial review.
The independent review required by the latest instruction remains pending before
the merge gate; passing these checks does not authorize merge.

## 30. Executed validation and local migration limits

| Gate | Result |
| --- | --- |
| Exact interrupted dashboard command, first actual execution | 107 passed / 5 failed; fixture defect described above |
| Same command after fixture fix | 112 passed / 0 failed |
| Final dashboard scope: same three files plus execution-context-route.test.ts and execution-context-service.test.ts | 142 passed / 0 failed |
| governance-review/test/execution-context.test.ts | 21 passed / 0 failed |
| canonical-contracts contracts, semantic-representation and execution-context tests | 129 passed / 0 failed |
| Passport UI/route SSR tests | 15 passed / 0 failed |
| canonical-contracts, scanner, governance-review, dashboard typechecks | PASS; dashboard incremental output disabled |
| Prior approved implementation scanner evidence | 131 affected tests passed, including 23 focused execution/source tests; not rerun in this recovery because scanner code did not change |

The final dashboard command is the exact recovered command with
`tests/execution-context-route.test.ts tests/execution-context-service.test.ts`
appended. Governance command:
`node --import tsx --test --test-isolation=none packages/governance-review/test/execution-context.test.ts`.
UI command in dashboard:
`node --experimental-test-module-mocks --import tsx --test tests/passport-ui-route.test.ts`.
Canonical tests used the three existing test files with `--test-isolation=none`.
Typechecks used local TypeScript with `--noEmit -p <package>/tsconfig.json`.
Test-run totals overlap during development and are not added together as unique
coverage. No expensive unrelated suite or broad re-audit was performed.
During test development, two Passport fixture tests initially used an unnormalized
endpoint without its canonical trailing slash; the fixture was corrected. The
final dashboard typecheck also caught unbranded identifiers in the new service
fixture; it now uses the existing typed constructors, and the typecheck passed.

Exactly one additive migration:
`supabase/migrations/20260915230551_execution_context_v1.sql` (CLI-generated in the
approved implementation). It creates seven tenant-scoped typed tables, compound
tenant FKs, closed shape/UNKNOWN constraints, one-principal and linear-state
uniqueness, immutable-history triggers, RLS and restricted RPC grants. Source
RPC checks exact durable candidate, fingerprint, acquisition snapshot, Tool and
HASH_ONLY assertion/evidence support. Decision RPC serializes source, policy,
decision replay and state predecessor checks before append-only writes.

**Validation limit:** migration checks are structural tests and focused SQL
inspection. No PostgreSQL/Docker executable was available on PATH; the migration
and RPC concurrency/RLS behavior were not executed against a database. Application
tests use tenant-scoped in-memory stores; they are not database integration tests.
No live/remote Supabase, production migration, provider, runtime probe or cloud
operation was performed. This limitation must remain visible to independent review.

## 31. Review disposition and remaining limits

- **READY_FOR_ARCHITECT_REVIEW**, not a declaration that M13 is merged or complete.
- **Independent adversarial review required before merge. DO NOT MERGE.**
- M10/M11/M12 frozen semantics and the 11-kind/12-type taxonomies remain unchanged.
- No authoritative grant source; no effective permissions, runtime identity,
  network observations or environment/deployment assignments are claimed.
- No live schema application and no seed policy that silently authorizes a source.
  A trusted administrator must configure explicit versioned field policy before
  human acceptance can succeed. Missing authority fails closed.
- Secret defenses reject supported unsafe forms/positions and never persist
  evidence excerpts. They cannot certify that an arbitrary opaque identifier is
  non-secret; this is not a universal secret detector.
- Scan/source heads use optimistic predecessor checks. Conflicting writes require
  retry/review; old completed replay never replaces newer source state. Accepted
  facts remain labeled with the source snapshot and do not claim live currency.
- Feature-branch commit/PR are the delivery artifacts for review. The exact commit
  and PR URL are reported in the final response; no merge operation is authorized.
- Protected recovery file and `.claude/**`: untouched. Production: untouched.
  **M14 NOT STARTED.**
