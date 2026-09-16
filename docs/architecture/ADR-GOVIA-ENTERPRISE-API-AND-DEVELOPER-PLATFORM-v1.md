# Gov IA Enterprise API & Developer Platform V1

Status: PROPOSED FOR ARCHITECTURE REVIEW

Date: 2026-09-16. Verified repository baseline:
`bc3bbdf4dc10688f7e4cfa38ec7a6543c2337cb5` (`main`, repository
`cnegrao/code-guard-governance`).

**GOVIA-L0L16-CIA-v1.0 remains FROZEN AND UNCHANGED.** This additive ADR
proposes the Enterprise API architecture for freeze; it is not ACCEPTED/FROZEN.
Implementation is intentionally deferred to M19, with the M19C placement
recommended below. This task creates architecture documentation only.

## 1. Context, authority and current evidence

Gov IA will expose governed information professionally to enterprise consumers.
Consumers need a stable semantic contract, understandable governance context and
a professional developer experience independent of internal product routes and
storage choices. The Enterprise API is an **EXPOSURE PLANE**, not a new L17
architecture layer and not a new System of Record.

This decision conforms to these existing references, which remain unchanged:

- [Frozen CIA baseline](./GOVIA-L0L16-CIA-v1.0.md).
- [Frozen roadmap](./GOVIA-L0L16-CIA-v1.0-roadmap.md).
- [Baseline adoption ADR](./ADR-GOVIA-L0L16-CIA-v1.0.md).
- [Field/fact authority and multivendor reconciliation ADR](./ADR-GOVIA-FIELD-FACT-AUTHORITY-AND-MULTIVENDOR-RECONCILIATION-v1.md).
- [Execution context, identity, connectivity and authorization ADR](./ADR-GOVIA-EXECUTION-CONTEXT-IDENTITY-CONNECTIVITY-AUTHZ-v1.md).

The frozen architecture determines authority. For implementation readiness,
current main and the latest continuation sections of milestone evidence supersede
stale 2026-09-08 coverage/conformance snapshots and earlier STOP sections:

| Current foundation | Evidence and limit relevant to this ADR |
| --- | --- |
| M10 governed field authority | Accepted field/fact ADR: source trust, exact mappings, versioned field policies, immutable decisions/history and stale-source/state guards remain distinct. |
| M11 Passport | [Validation, continuation section 13](../codex/evidence/2026-09-14-agent-passport-360-governed-view-v1-validation.md) and [current typed presentation](../../apps/dashboard/lib/governance/agent-passport.ts): 16 families, exact version context and explicit UNKNOWN; an internal presentation contract is not an approved external DTO. |
| M12 Graph and Vector | [Final readiness evidence](../codex/evidence/2026-09-14-governed-graph-vector-intelligence-v1-validation.md) and [governed traversal](../../packages/graphos/src/governed/traversal.ts): canonical read projection and bounded analytical traversal/retrieval, not canonical write authority or proof of production population. |
| M13 execution context | [Latest implementation and limits, sections 28–31](../codex/evidence/2026-09-15-connectivity-execution-identity-authz-v1-validation.md) and [typed governed read](../../apps/dashboard/lib/governance/execution-context-read.ts): narrow direct-source capability, principal, requested scope and declared connectivity; authorization remains UNKNOWN. This does not establish live IAM grants or runtime observation. |

These are repository capabilities, not claims about live tenant data, deployment,
Enterprise API availability or complete coverage. M14 is not started by this ADR.

## 2. Decision: three separate interface surfaces

| Surface | Purpose | Contract boundary |
| --- | --- | --- |
| INTERNAL API | Dashboard and product internal operations | Internal implementation interface; not the public developer contract. |
| INTEGRATION API | Connectors, inbound exchange, governed publication orchestration and trusted integration workflows | Integration-specific trust, source binding and orchestration contracts; external assertions still require governance. |
| ENTERPRISE API | Stable external API for enterprise customers and systems | Public developer contract with explicit authentication, authorization, tenancy, compatibility and lifecycle rules. Public contract does not mean anonymous data access. |

Never collapse these three surfaces into one generic API. They may reuse governed
domain services behind explicit adapters; sharing infrastructure does not make
their audience, authority, DTOs or lifecycle interchangeable. Existing internal
routes do not become Enterprise API merely by being documented or renamed.

## 3. Contract-first Developer Platform and versioning

**OpenAPI 3.1 is the authoritative Enterprise API contract.** Swagger is NOT the
contract. Swagger UI, Scalar and Redoc are renderers of the approved OpenAPI
contract. OpenAPI describes exposure semantics under the frozen domain authority;
it cannot grant a source, projection or consumer new canonical authority.

The planned professional Developer Platform includes Developer Portal, API
Overview, Quickstart, Authentication, API Reference, Try It, examples, errors,
pagination, rate limits, changelog, OpenAPI download, Postman and generated SDKs
where justified. Swagger UI is a possible technical reference; Scalar and/or
Redoc are possible polished renderers. No commercial documentation vendor is
selected or frozen here. Try It must use authenticated, tenant-authorized access
and obey the same command and secret boundaries as every other client.

The Enterprise API version baseline is `/v1`. The machine-readable contract is
conceptually available through `GET /openapi.json`. These are planned contract
directions, not routes created by this ADR. The exact hostname is not frozen.

Breaking semantic changes require a new major API version. This includes changes
to the meaning of identity, authority, trust, UNKNOWN or temporal state even when
JSON structure remains syntactically compatible. Compatible additive evolution
may remain in V1 under an explicit compatibility policy to be defined during M19
implementation. M19 must define supported evolution, deprecation and contract
publication rules and verify compatibility; additive does not automatically mean
safe for every consumer.

## 4. Public semantic resources, not persistence schema

**PUBLIC API CONTRACT != PERSISTENCE SCHEMA.** No Supabase table names, RPC names
or storage implementation become the public API. Persistence migrations must not
implicitly redefine the public contract. Semantic adapters must select supported
facts and safe provenance rather than serialize database rows or internal DTOs.
For example, internal Passport provenance storage discriminators are not public
resource names and must not leak as the external storage contract.

Forbidden public style: `GET /api/gov_repo/canonical_objects`.

Correct semantic style includes:

```text
GET /v1/agents/{id}
GET /v1/agent-versions/{id}
GET /v1/agent-versions/{id}/passport
GET /v1/data-elements/{id}/impact
```

The following **planned V1 resource families** are proposed for architectural
freeze. They do not freeze every operation or final JSON property and do not
claim that the supporting milestone or an endpoint is implemented today.

| Family | Planned namespaces |
| --- | --- |
| Agent identity and governed presentation | `/v1/agents`, `/v1/agent-versions`, `/v1/passports` |
| Technical dependencies | `/v1/models`, `/v1/tools`, `/v1/mcp-servers`, `/v1/apis` |
| Governed data | `/v1/data-assets`, `/v1/data-elements` |
| Relationships and analytical navigation | `/v1/relationships`, `/v1/lineage`, `/v1/graph`, `/v1/impact` |
| Governance | `/v1/governance`, `/v1/policies`, `/v1/controls` |
| Risk | `/v1/risks` |
| Publication | `/v1/publications` |
| Events and subscription contracts | `/v1/events`, `/v1/webhooks` |

Resource namespaces are exposure concepts, not additions to the closed canonical
object taxonomy. Risk stays transversal under L15; Passport still has 16 families.
Events and webhooks do not imply M19 durable delivery infrastructure.

The anchor endpoint is:

```text
GET /v1/agent-versions/{agentVersionId}/passport
```

It requires the exact tenant-local canonical AGENT_VERSION and its governed
context. AGENT is logical identity; behavior and execution facts remain bound
to AGENT_VERSION. No guessed legacy-registry translation, display-name match or
implicit latest/current version substitutes for that binding. Passport is a
governed presentation view, not a new canonical object or independent authority.

Planned analytical navigation examples:

```text
GET /v1/data-elements/{dataElementId}/impact
GET /v1/graph/objects/{objectId}/upstream
GET /v1/graph/objects/{objectId}/downstream
```

M19 defines supported operations from governed source readiness. Unsupported
fields, relationships and capabilities must not be invented to fill the surface.

## 5. Read planes and analytical authority

| Exposed information | Authoritative source or read plane | Required interpretation |
| --- | --- | --- |
| Canonical identities, governed facts and direct governed relationship reads | Canonical SoR / governed read models | Preserve exact identity, decision support, trust and temporal state. |
| AgentVersion Passport | Governed presentation view | Compose supported facts within the existing 16 families; coverage does not create facts. |
| Graph, lineage traversal, impact and blast radius | Analytical Graph projection | Label analytical results explicitly; retain source relationship support, direction, traversal policy, temporal context and limits. |
| Vector-derived similarity or retrieval, where exposed | Analytical representation/retrieval | Analytical only; no identity, merge, governance or authorization authority. |
| LLM-derived explanations, where exposed | Analytical/advisory output | Zero canonical authority; retain supporting references and uncertainty. |

Mandatory invariants:

```text
GRAPH != SYSTEM OF RECORD
GRAPH PROJECTION != SYSTEM OF RECORD
VECTOR != CANONICAL TRUTH
LLM OUTPUT != CANONICAL TRUTH
```

The Enterprise API must never make an analytical result appear canonical merely
because it is exposed via REST. A path computed over governed relationships is
still an analytical result; it does not materialize another canonical edge.
Direct persisted relationship facts and computed lineage/impact must remain
distinguishable. Empty or bounded traversal is not proof of no dependency,
no impact or complete lineage. Preserve supported DataElement grain and lineage
direction; coarse asset evidence cannot imply full column lineage. Projection
freshness and query bounds must be explicit rather than presented as current
canonical completeness.

## 6. Governed fact response semantics

Where relevant and authorized, expose governance state, source trust,
authority/disposition, source system, a safe source connection reference,
effective time, recorded time and evidence/provenance references. Authority is
field/fact/source specific; an authoritative source for one fact is not globally
authoritative for the object, a requested scope or a granted scope.

Illustrative semantic direction only; this is neither an approved schema nor a
claim about any existing fact:

```json
{
  "value": "...",
  "governance": {
    "state": "GOVERNED",
    "trust": "IMPORTED",
    "authority": "AUTHORITATIVE",
    "sourceSystem": "..."
  }
}
```

M19 defines final OpenAPI schemas, field names, enums and representation of
unavailable values. The example does not introduce a new canonical trust state:
governed selection and source trust are separate dimensions. Retain the existing
INFERRED / DECLARED / IMPORTED / OBSERVED / VALIDATED trust vocabulary without
automatic promotion. Policy acceptance or API exposure alone does not change
IMPORTED to VALIDATED or design-time DECLARED to runtime OBSERVED.

```text
SOURCE ASSERTION != CANONICAL FACT
IMPORTED != VALIDATED
HIGH CONFIDENCE != GOVERNED
HIGH CONFIDENCE != VALIDATED
MISSING != FALSE
UNKNOWN != FALSE
```

Missing evidence must never be fabricated. UNKNOWN must remain explicit unless
authoritative evidence establishes another state. In particular, transforming
`authorizationState = UNKNOWN` into `authorized = false` is forbidden. Missing
grants are not evidence of DENIED. Refusing an API operation because permission
cannot be established is an access-control decision, not proof that the governed
AgentVersion has a DENIED execution authorization state.

## 7. Commands and governed materialization

**Every externally reachable state-changing interface defined by this ADR —
ENTERPRISE API and INTEGRATION API alike — must obey the applicable governed
decision/materialization boundary.** Neither surface may directly create or
overwrite canonical truth merely because the caller is authenticated, the
connection is trusted, or the source is a bound integration. The following
shortcut is forbidden on both surfaces:

```text
PUT /v1/agents/{id} -> direct canonical table UPDATE
```

```text
AUTHENTICATED/TRUSTED COMMAND OR ASSERTION
  != GOVERNANCE AUTHORITY
```

Any future side-effecting operation must follow the applicable governed flow.
For Enterprise API commands:

```text
AUTHENTICATED COMMAND
  -> AUTHORIZATION
  -> PROPOSAL / REVIEW / POLICY GATE
  -> GOVERNED DECISION
  -> MATERIALIZATION when authorized
```

For Integration API inbound assertions, the same boundary applies through the
existing M10 field/fact authority model rather than a human-command shape; an
inbound connector assertion must not be forced into an inappropriate
human-review flow:

```text
TRUSTED SOURCE ASSERTION
  -> AUTHORIZATION / SOURCE BINDING
  -> PROPOSAL / REVIEW / POLICY GATE as applicable
  -> GOVERNED DECISION
  -> MATERIALIZATION when authorized
```

Potential future semantic commands, not implementation authorization:

```text
POST /v1/governance/proposals
POST /v1/reviews/{id}/decisions
POST /v1/publications/requests
```

Authentication, trusted connections, platform scopes and request acceptance
never substitute for field authority or a governed decision, on either
surface. Preserve exact tenant/subject binding, applicable immutable policy
version, reviewed source observation/snapshot, expected current state, actor
and evidence. Recheck stale source, policy and state at the governed decision
boundary. Preserve atomic decision/materialization semantics, append-only
history and original completed replay outcomes; no last-write-wins or
reinterpretation of history under a newer policy.

## 8. Consumer security, tenancy and secrets

**API CONSUMER IDENTITY != AGENT EXECUTION PRINCIPAL.** Architecture must support
enterprise OAuth2/OIDC and service-principal access. No concrete identity provider
is selected. A platform consumer's authenticated principal, a governance reviewer
and an AgentVersion execution principal have distinct roles; no implicit
delegation or shared identity is inferred.

Tenant/organisation context comes from trusted authenticated context. Never trust
body/header `organisationId` as sufficient tenant authority. Validate tenant and
resource authorization across, at minimum, object lookup, provenance, analytical
traversal, commands, publication requests and subscriptions. Client-provided
identifiers or scopes cannot establish cross-tenant authority. Tenant isolation
is mandatory throughout the read/write path, including caches, continuations
and evidence references.

```text
CAPABILITY != AUTHORIZATION
REQUESTED_SCOPE != GRANT
GRANT != AUTHORIZATION
```

Platform API scopes govern consumer access to Gov IA; they must not be confused
with M13 AgentVersion requested scopes or execution grants. Possible platform
scopes include `agents:read`, `passport:read`, `lineage:read`, `governance:read`,
`risk:read`, `governance:write`, `publication:request` and `webhooks:manage`.
The exact scope list is not frozen. Even a valid platform scope does not itself
authorize every tenant resource or bypass a governance policy gate.

Never expose passwords, API keys, client secrets, access tokens, refresh tokens,
private keys, cookies, Authorization headers, credential-bearing URIs or connector
credentials. This applies to response bodies, errors, provenance, examples,
generated clients and event payloads. Consumer authentication may present a
credential; the API must not echo it as governed data or diagnostic output.
Evidence exposure may use authorized safe IDs, hashes, source references and
bounded metadata. References do not authorize unrestricted evidence retrieval;
do not serialize raw connector envelopes or credential-bearing source content.

## 9. API quality contract

M19 must define and validate the following contract requirements; this ADR does
not freeze arbitrary parameter names, limits or generic query languages.

| Requirement | Architectural obligation |
| --- | --- |
| Typed errors | Stable typed envelope, safe machine-readable error code and correlation/request ID; no secrets, raw persistence errors or fabricated governance claims. |
| Pagination | Bounded page sizes and deterministic continuation semantics, scoped to the authorized tenant/query; no silent completeness claim for truncated results. |
| Filtering and sorting | Explicit allowlists per resource, supported typed fields and bounded work; no arbitrary database, field-path or graph query language. |
| Temporal semantics | Distinguish effective time, recorded time and analytical projection/query time; define supported historical/as-of behavior without inferring currentness from newest timestamps. |
| Idempotency | Side-effecting operations require scoped replay semantics; completed replay returns the original outcome and conflicting reuse cannot create a second effect. |
| Concurrency | Guard stale source observations, policy versions and expected governed state at the appropriate atomic decision boundary. |
| Rate limits | Tenant/client-aware enforcement and documented limits/errors; scopes do not bypass resource or workload bounds. |
| Compatibility | Contract and semantic versioning tests, including UNKNOWN, trust, authority and error behavior; breaking semantic changes require a new major version. |

## 10. SDKs, events and webhook boundary

SDKs should be generated from the approved OpenAPI contract where justified.
TypeScript and Python are possible first languages, not frozen commitments.
**SDK != semantic authority.** Generated types, examples, Postman material and
documentation must remain consistent with the contract, including explicit
UNKNOWN and analytical labels.

The Developer Platform may expose webhook subscription contracts. The boundary is:

- **M19:** API contract and developer surface, including subscription semantics
  if needed; no implied durable delivery implementation.
- **M20:** Durable outbox, event consumers and webhook delivery infrastructure,
  with real consumers as required by the existing roadmap.

Future webhooks require signed payloads, replay protection, idempotent delivery
and consumer handling, retries and delivery history. Their payloads retain tenant,
secret, provenance and authority boundaries. Delivery status is not a canonical
business decision, and duplicate delivery must not repeat governed effects.
**Webhook != System of Record.** This ADR implements neither subscriptions nor
outbox workers and makes no durability, ordering or delivery guarantee today.

## 11. Governed outbound publication is a different, not-yet-decided flow

**Governed Outbound Publication is a FUTURE architecture. It does not exist
today as an accepted ADR.** It requires its own separate architecture decision
record before implementation. This ADR does not define Publication Policy
semantics, vendor write-back authorization, publication evidence requirements
or connector execution; the Enterprise API must not invent any of that
semantics in the absence of that future ADR.

Keep these flows conceptually explicit and separate regardless of which is
decided first:

```text
CONSUMER -> GOV IA ENTERPRISE API

GOV IA -> GOVERNED OUTBOUND PUBLICATION -> VENDOR CONNECTOR -> EXTERNAL PLATFORM
```

The Enterprise API may read publication status once such governed publication
state actually exists. Any Enterprise API publication WRITE capability
(including `POST /v1/publications/requests`) is contingent on the future
Governed Outbound Publication ADR being ACCEPTED first, and such operations
must conform to that ADR once it exists; this Enterprise API ADR grants no
independent authority to define or bypass it. A request, once that future
architecture exists, enters its governed orchestration boundary; it is not
permission for arbitrary vendor write-back. Publication policy and vendor
connector execution remain separate from the public developer contract. A
publication response cannot claim external completion without supporting evidence.

## 12. Architecture conformance and impact A–O

PostgreSQL/Supabase remains the Canonical SoR. Graph remains projection; Vector
remains analytical; LLM has zero canonical authority. Passport remains a
presentation/governed view. Tenant isolation is mandatory. No discovery or external
input directly creates canonical truth, and the scanner machine authority ceiling
remains PROPOSED. Canonical identity is unchanged, including exact AGENT_VERSION
behavior binding. The closed 11-kind canonical object taxonomy and closed 12-type
relationship taxonomy remain unchanged. L0–L16 is unchanged; no L17 is introduced.

| Dimension | Proposed impact |
| --- | --- |
| A — CIA baseline | Additive exposure-plane decision under frozen GOVIA-L0L16-CIA-v1.0; no baseline or frozen-document edits. |
| B — L0–L16 | Exposes supported outputs across existing layers; L9 analytical navigation and L13/L14 governed decisions retain their roles. L10/L11 execution facts stay separate from consumer security. No new layer or producer; no early L12/M14 implementation. |
| C — Passport | Existing 16 families presented for an exact AgentVersion with governed Agent context; no family 17, fabricated completeness or new canonical Passport object. |
| D — Canonical | Exact canonical identities, closed 11-kind/12-type taxonomies and temporal state preserved; namespaces do not create object kinds or relationships. |
| E — Lineage | Direct governed relationship reads separated from analytical Graph lineage/impact; preserve direction, grain, witness support and bounded coverage. No synthetic canonical edges. |
| F — Evidence/provenance | Safe source, connection, evidence, decision and temporal references where relevant and authorized; no invented support or raw secret content. |
| G — Trust/authority | Source assertion, source trust, field authority and governed selection remain distinct; UNKNOWN explicit; external commands cannot bypass decisions. |
| H — Vector | Analytical retrieval only if supported; no identity, truth, merge or authorization authority. |
| I — Graph | Disposable analytical projection; never SoR, direct canonical writer or complete dependency proof. |
| J — LLM | Advisory/analytical only; zero canonical authority and no automatic fact creation. |
| K — Tenancy/security | Trusted authenticated tenant context, per-resource authorization, separate consumer/execution principals, safe evidence and secret exclusion. |
| L — Migration | None in this task; no routes, schemas, migrations or remote application. Future implementation requires its own readiness analysis. |
| M — Downstream continuity | Reuse governed foundations through semantic adapters; preserve internal/integration consumers, M10–M13 semantics and M14–M18 order. M19 surface and M20 delivery remain separate. |
| N — Non-fabrication | No invented JSON completeness, unsupported facts, execution grants, current version, governance claims, runtime observations or vendor delivery success. |
| O — Acceptance/quality | Independent adversarial architecture review and explicit owner approval before freeze; M19C DoD below before implementation acceptance. Documentation checks do not certify a deployed API. |

## 13. Recommended future roadmap placement

Record this recommendation only inside this ADR; the frozen roadmap file is not
modified or implicitly superseded by this proposal:

| Milestone | Recommended placement |
| --- | --- |
| M19A | Enterprise Inbound Connector Expansion |
| M19B | Governed Outbound Publication |
| M19C | Enterprise API & Developer Platform |
| M20 | Outbox / Event Consumers / Webhooks |
| M21 | Production Security & Release Gate |
| M22 | Production Deployment |

M14–M18 remain in their current order. This ADR adds **NO blocker to M14** and
does not start it. API implementation is intentionally deferred to M19; freezing
the architecture after review does not authorize starting M19 early.

## 14. M19C minimum Definition of Done

1. OpenAPI 3.1 contract approved under the frozen architecture.
2. `/v1` semantic resource surface implemented for approved, supported operations.
3. Internal, Integration and Enterprise interfaces explicitly separated.
4. Authentication, resource authorization and trusted tenant isolation verified.
5. Public contract decoupled from persistence schema and internal DTOs.
6. Exact AgentVersion Passport endpoint delivered.
7. Required governed data and relationship reads delivered with supported source coverage.
8. Graph/impact results explicitly analytical, with temporal context and bounds.
9. Stable typed error envelope, safe codes and correlation/request IDs.
10. Bounded pagination and allowlisted filtering/sorting rules documented and tested.
11. Idempotency and stale-state/concurrency guards verified for side-effecting operations.
12. UNKNOWN, source trust, authority and provenance preservation tests pass.
13. Secret-leak tests pass across responses, errors, evidence and examples.
14. Professional Developer Portal delivers the contents listed in section 3.
15. Swagger UI and/or equivalent OpenAPI renderer available from the approved contract.
16. Compatibility and semantic versioning tests pass.
17. Examples contain no fabricated governance claims or unsupported source coverage.
18. Webhook boundary defined if needed; durable outbox/event delivery remains M20.
19. If `/v1/publications` exposes any state-changing/write operation, the
    Governed Outbound Publication ADR MUST already be ACCEPTED and those
    operations MUST conform to it. Read-only publication status exposure may
    exist only when such governed publication state actually exists; no
    publication write capability may ship ahead of that ADR.

## 15. Consequences, non-goals and approval gate

The stable exposure contract requires semantic adapters, explicit authority
metadata and compatibility discipline. Consumers gain a professional interface
without acquiring direct access to storage or canonical write authority. The
cost of adapters and contract maintenance is accepted as necessary to preserve
domain semantics through storage and internal product evolution. Contract-first
tooling enables consistent reference documentation and justified generated SDKs.

This ADR does NOT implement API endpoints, SDKs, webhook subscriptions/delivery or
M19; start M14; change M14–M18; choose a hostname, API gateway, IdP or commercial
documentation vendor; define every JSON property; change canonical identity or
Graph authority; authorize direct canonical writes or vendor write-back; modify
the frozen architecture/roadmap; create migrations; or apply anything remotely.
All endpoint and payload examples are architectural direction for later design.

The decision proposed for freeze is the exposure-plane boundary, three-surface
separation, contract/versioning direction, semantic resource families, authority,
tenancy, governance and quality invariants. Final schemas, compatibility policy
details, infrastructure choices, supported operations and implementation readiness
belong to M19. No OpenAPI artifact or application code is created in this task.

This ADR becomes **ACCEPTED/FROZEN only after independent adversarial architecture
review and explicit architecture-owner approval**. Neither author self-review nor
opening a PR satisfies that gate. Until both occur, its status remains
PROPOSED FOR ARCHITECTURE REVIEW; no freeze or implementation approval is implied.

Final verdict:
**CONFORMANT_WITH_GOVIA_L0L16_CIA_V1_0 — PROPOSED_FOR_FREEZE**
