# Execution context, identity, connectivity and authorization V1

Status: **ACCEPTED**. Authority: explicit M13 architecture-resolution and
continuation instruction, 2026-09-15. Baseline: **GOVIA-L0L16-CIA-v1.0**, frozen
and unchanged. This additive ADR resolves the original M13 readiness STOP.

## Decision

### Two semantic layers

The declared execution contract describes behavior-significant design-time
configuration of an exact AGENT_VERSION. The execution context describes temporal
deployment/authorization state associated with that exact version. Neither creates
a canonical object kind or relationship type. The 11-kind/12-type taxonomies stay
closed. Logical AGENT is never a substitute for the technical subject.

| Fact | Classification |
| --- | --- |
| Explicit declared capability | BEHAVIOR_VERSIONED |
| Requested scope | BEHAVIOR_VERSIONED |
| Explicit behavior-significant declared target/endpoint/protocol | BEHAVIOR_VERSIONED |
| Principal/service-account/OAuth/managed/workload/delegated-user assignment | EXECUTION_CONTEXT_TEMPORAL |
| Granted scope, explicit permission/grant | EXECUTION_CONTEXT_TEMPORAL |
| Environment, network/VPC, egress, internal/external deployment classification | EXECUTION_CONTEXT_TEMPORAL |
| Deployment-specific endpoint/protocol | EXECUTION_CONTEXT_TEMPORAL |

Endpoint roles must be explicit; implementation must not guess whether a locator
is a behavior contract or a deployment assignment. Unsupported evidence leaves the
fact unavailable. No arbitrary metadata JSON/EAV, field paths or permission blobs.

### Exact binding and principals

Every source assertion requires explicit proof connecting the declaration/import
to one normalized/canonical AGENT_VERSION, with tenant, source connection, source
object and evidence support. Co-presence, directory proximity, name similarity,
latest/current version selection and logical AGENT identity are insufficient.
Ambiguous/missing/foreign binding fails closed. Binding coordinates and evidence
IDs are provenance, not behavior-fingerprint inputs.

A principal is a closed typed non-secret reference, not a canonical object.
Supported semantic kinds may be SERVICE_ACCOUNT, OAUTH_CLIENT, MANAGED_IDENTITY,
WORKLOAD_IDENTITY and USER_DELEGATED. Kind, provider, provider authority/directory
reference and principal reference disambiguate identity; tenant remains trusted
server context. No OTHER catch-all is required. A source adapter must prove its
supported kind rather than interpreting arbitrary strings. Delegation requires
explicit evidence, never the identity of a governance reviewer.

Entra/Okta/Keycloak human directory connectors are **LEGACY_DO_NOT_EXTEND** for
M13. Their governance-user heuristic and connector authentication credentials do
not identify an AgentVersion execution principal. No live identity-provider access.

### Capability, scopes and grants

Capability states what a version is explicitly configured to attempt; it does not
prove authorization and is not inferred from permission or a Tool/API/MCP edge.
Requested scope is declared configuration. Granted scope is a separate temporal
authorization fact requiring a defensible source and field authority. No copying
requested to granted. Role/group names never resolve into permissions implicitly.

A grant preserves principal, action, resource/reference, explicit effect/state,
source, effective context and support. UNKNOWN is explicit; missing permission or
scope never means DENIED/FALSE/NOT_AUTHORIZED. DENIED is representable only when
explicitly supplied by a supported authoritative source. Governance authorization
to review/select a fact is not the governed principal's execution authorization.

### Prospective fingerprint evolution

Preserve BehaviorFingerprint algorithm/schemaVersion/value. Only explicit DECLARED,
exactly bound, behavior-significant design-time facts participate in equivalence.
Capability/requested-scope/declared-contract changes produce a different revision
when equivalence cannot be proven. Evolve schema versions prospectively for newly
discovered versions; never rehash, rewrite or migrate historical fingerprints.

Exclude principal/account assignment, granted scopes, permissions, environment,
network/VPC/egress, deployment state, decisions, authority policies, provenance IDs,
timestamps, runtime metrics and secrets. Their changes preserve history without
creating another AgentVersion. A future producer must wire supported declaration
semantics into upstream version discovery before any governed materialization;
a standalone contract or hash helper alone does not implement version discovery.

### Connectivity and temporal context

Reuse existing sanitized technical locators and semantically compatible
ApiProtocolFamily/McpTransport vocabularies. API/MCP object identity stays separate
from AgentVersion execution connectivity. Connectivity does not create INVOKES or
USES_MCP, and those edges do not prove a deployed path or successful access.

Environment/network/VPC/egress are temporal assignments, populated only from direct
bounded evidence. No guessing from repository paths, hostnames, IPs, ports, SDKs or
region strings. No scanning, probes or cloud-control-plane calls. Preserve unknown
environment/network state explicitly when evidence is absent.

### Closed field authority extension and history

Extend authority through a closed M13 fact family rather than widening M10's
DataAsset/DataElement union implicitly. Policies must name exactly the implemented
M13 fact, AGENT_VERSION kind, trusted tenant, source system/provider and optional
connection. Reuse M10 dispositions, immutable policy versions, explicit active
heads, no implicit precedence, ambiguous/missing-policy rejection and human review
where required. A source's authority over desired scope does not confer authority
over granted scope. Only supported implemented facts may acquire acceptance paths.

Decisions bind exact applicable policy/version, source observation/snapshot,
expected current state, subject/context, actor and support. Recheck scope, binding,
policy and stale source/state atomically with append-only decision/state writes.
Preserve predecessors, effective context, losing proposals and original support.
No last-write-wins, destructive replacement or reinterpreting historical decisions
after policy changes. Exact completed replay returns the original decision.
Reuse typed per-kind storage/support and M10 history patterns when needed; do not
create a parallel generic governance framework. No historical migration changes,
destructive backfill or live SQL execution.

### Trust, secrets and downstream boundaries

Static explicit configuration retains DECLARED; enterprise imports retain IMPORTED.
Source trust is distinct from governed selection. No automatic VALIDATED or OBSERVED
promotion; scanner machine authority ceiling remains PROPOSED. Evidence/provenance,
source/method, effective and recorded time and tenant must remain auditable.

Credential material must not enter DTOs, persisted values, evidence excerpts or
fingerprints: passwords, client secrets, API keys, tokens, private keys, cookies,
Authorization headers and credential-bearing URIs. Retain only explicitly declared
safe opaque references; a reference never proves credential possession. Validation
must fail closed with value-free errors and source-specific secret exclusion.

Passport retains 16 families. Governed M13 facts belong in families 15/16 and
appropriate provenance/design-time context; absent facts stay UNKNOWN. Typed read
adaptation is required before population; no UI expansion or fabricated completeness.
Graph remains a read projection without new edges or authority. Vector/LLM have no
identity or authorization authority; no embeddings or LLM calls are required.
PostgreSQL/Supabase remains canonical SoR.

M13 is design-time/imported state. M14 owns runtime identity/network observations,
OTel, actual calls, latency/errors/tokens/cost. **M14 NOT STARTED**.

## Architecture impact A–O

| Item | Accepted impact |
| --- | --- |
| A | Additive resolution under frozen CIA v1.0; no baseline edits |
| B | L10/L11; L0–L4 source/evidence/binding support; no L12 |
| C | Families 15/16, 14 provenance and appropriate 7/8/13 design-time context; still 16 families |
| D | Exact AGENT_VERSION plus typed execution context; no kind/type additions |
| E | No synthetic principal/network/authorization lineage edges |
| F | Per-fact source/assertion/evidence/method/temporal support |
| G | Closed field/source authority; trust and decision authority remain distinct |
| H | Vector unchanged and non-authoritative |
| I | Graph remains canonical read projection |
| J | No LLM fact creation or inference |
| K | Server-trusted tenant/connection; exact binding and secret exclusion |
| L | Smallest additive typed adaptation only when supported producers require persistence |
| M | Reuse M10 principles; preserve M11/M12 consumers and historical contracts |
| N | No unsupported source syntax, invented bindings/grants or guessed network context |
| O | Focused source/binding/fingerprint/authority/history/security tests; distinguish foundations from implemented producers |

## Implementation prerequisite

The accepted decision resolves architectural scope; it does not assert that any
source supports the required facts. Readiness must separately record
IMPLEMENTED/IMPLEMENTABLE/FOUNDATION_ONLY/BLOCKED_EVIDENCE/BLOCKED_BINDING/
BLOCKED_AUTHORITY. Contract fixtures do not certify a source adapter. Unsupported
facts stay unpopulated, and source-dependent implementation must wait for evidence.
