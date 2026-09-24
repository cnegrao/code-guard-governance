# ADR — M16 Ownership / Business / Policy / Control Enrichment V1

**Status:** PROPOSED / ARCHITECTURE FREEZE CANDIDATE

**Architecture:** `GOVIA-L0L16-CIA-v1.0` — FROZEN

**Milestone:** M16 — OWNERSHIP / BUSINESS / POLICY / CONTROL ENRICHMENT V1

**Base SHA:** `f431fa6901bfdb58cb1729553ea0193568fcc160`

**Date:** 2026-09-24

**Architecture owner / control plane:** ChatGPT; owner approval pending

**Prior gates (reported inputs):** M16 ARCHITECTURE INVENTORY =
`READY_FOR_ADR_DESIGN`; M16 CONTRACT v0.2 DELTA REVIEW = `PASS`;
independent adversarial review completed by Claude.

This ADR specifies the normative V1 contract proposed for owner approval.
MUST, MUST NOT, and REQUIRED express acceptance requirements for subsequent
implementation; they do not assert that implementation exists. This ADR is
not ACCEPTED. Its publication neither approves implementation nor changes
the frozen baseline, coverage claims, or historical conformance findings.

## 1. Decision, scope, and architecture authority

M16 MUST establish governed ownership, business context, policy applicability,
control applicability, and control assessments in **L14 — Governance &
Controls**, referencing existing canonical identities. It MUST depend on L0
provenance/source identity, L6 business/information semantic identity, L11
authenticated principals/current authorization eligibility, and the existing
canonical identity and governance infrastructure.

The governing references are:

- [Frozen CIA baseline](./GOVIA-L0L16-CIA-v1.0.md), especially §§2–9.
- [Official roadmap](./GOVIA-L0L16-CIA-v1.0-roadmap.md), with M15 CLOSED /
  MERGED and M16 ARCHITECTURE FREEZE CANDIDATE at this base.
- [Implementation conformance audit](./GOVIA-L0L16-CIA-v1.0-implementation-conformance.md),
  especially G-06 and its reuse/unification requirement. This is a historical
  audit of its stated SHA, not a current M16 implementation certificate.

M16 MUST NOT implement L15/M17 governed risk or residual-risk reasoning,
M18 Business Workspace/persona-specific truth, M19 connectors, a generic QES
platform, a generic approval workflow, or a full exception/waiver lifecycle.
L14's wider baseline scope does not require those deferred capabilities in V1.

## 2. Closed canonical boundary and target identity

The existing `CANONICAL_OBJECT_KIND` remains exactly these 11 values:

`AGENT`, `AGENT_VERSION`, `MODEL`, `TOOL`, `MCP_SERVER`, `API`, `PROMPT`,
`KNOWLEDGE_BASE`, `DATA_ASSET`, `DATA_ELEMENT`, `SKILL`.

The existing `GOVERNED_RELATIONSHIP_TYPE` remains exactly these 12 values:

`USES_MODEL`, `USES_TOOL`, `USES_MCP`, `INVOKES`, `USES_PROMPT`,
`USES_KNOWLEDGE_BASE`, `USES_SKILL`, `EXPOSES`, `HANDOFF_TO`, `READS_FROM`,
`WRITES_TO`, `DERIVED_FROM`.

Existing endpoint legality remains unchanged. `POLICY`, `CONTROL`, `PARTY`,
and `DOMAIN` MUST NOT become CanonicalObjectKind values. `OWNS`,
`APPLIES_POLICY`, `CONTROLLED_BY`, and any other new canonical relationship
type are prohibited. L14 bindings are governed fact/state records referencing
canonical identities; generic JSON/EAV MUST NOT replace modeled semantics.

An object target MUST resolve within its organisation by canonical object
identity and declared canonical kind. A relationship-state target MUST resolve
by the exact `(organisation_id, relationship_id, relationship_state_id)`
tuple (§16). Policy/control applicability may reference an existing canonical
object or an exact relationship state, subject to Authority Policy scope.
Responsibility and business context have the narrower matrices in §§11–12.
No label, source-local name, or inferred successor substitutes for identity.
All logical keys below are organisation-scoped even where organisation is
omitted for readability.

## 3. Exactly five authoritative fact families

| Family | Authoritative meaning | Logical identity / supersession key | V1 cardinality |
|---|---|---|---|
| `RESPONSIBILITY_ASSIGNMENT` | A governed party holds a legal responsibility role on a target | target identity + role + governancePartyId | One active state per key; additional role cardinality in §11 |
| `BUSINESS_CONTEXT_ASSIGNMENT` | An exact target has a validated domain binding | target identity + semantic kind | One active assignment per target + semantic kind |
| `POLICY_APPLICABILITY` | An exact policy version applies or does not apply to a target | target identity + policy_id | One current state per key, with exact version/hash pin |
| `CONTROL_APPLICABILITY` | An exact control-definition version applies or does not apply to a target | target identity + stable control_definition_id | One current state per key, with exact control-version pin |
| `CONTROL_ASSESSMENT` | An assessment of an exact governed applicability state | control_applicability_state_id | One current assessment state per applicability state; expiry still gates validity |

`CONTROL_FINDING` MAY exist only as normalized assessment detail, attached to
one assessment state. It MUST NOT be a sixth top-level family, an independent
authority surface, or a risk/waiver record. A sixth family requires a future ADR.

## 4. Closed supporting artifacts

The following support artifacts are REQUIRED by V1. They are not canonical
object kinds or additional top-level enrichment fact families.

| Artifact | Required responsibility |
|---|---|
| `L14Proposal` | Immutable submitted proposal: organisation, submitter, closed subject kind and VALIDATE / REVOKE intent, typed subject content subject to §10 PII restrictions, exact target/version references where applicable, source reference, support associations, and DB-authored submission time. A correction is a new proposal linked to the prior proposal. |
| `L14AuthorizationDecision` | Immutable action-specific current-eligibility evaluation and snapshot (§7), never a reusable bearer grant. |
| `L14GovernanceDecision` | Immutable explicit VALIDATE / REJECT / DEFER / REVOKE disposition, actor, proposal, authorization decision, closed reason_code, normalized support/evidence references, target subject, and decision time; no arbitrary free-text rationale. |
| `L14AuthorityPolicy` + immutable versions | Exactly one stable organisation-local policy identity per organisation, typed source/scope/permission rules, immutable versions, and governed validation/revocation state preserving effective-version continuity (§5). |
| `GovernanceParty` registry + mutable identity mapping/profile | Opaque stable party identity and immutable governed states; separately correctable/erasable directory identity and PII (§10). |
| `BusinessDomain` registry | Existing L6 BusinessDomainIdentity as the stable semantic identity, with tenant-scoped governed admission/validation/state lifecycle; no parallel ID namespace. |
| `InformationDomain` registry | Existing L6 InformationDomainIdentity as the stable semantic identity, with tenant-scoped governed admission/validation/state lifecycle; distinct from BusinessDomain, with no parallel ID namespace. |
| `ControlDefinition` registry + versions | Stable tenant-scoped definition identity, immutable definition versions, and explicit governed validation state. |
| Existing `gov_repo.governance_policies` | Reused stable policy store and bounded admission path; no third policy store. |
| Hardened `gov_repo.policy_versions` | Reused immutable exact policy content/version identity with DB-verified content hash and tenant consistency. |
| Policy-version M16 validation state | Separate immutable validation/revocation history pinned to organisation + policy + version + hash; legacy status is not authority. |
| Normalized evidence/support associations | Tenant-scoped typed links from proposal, decision, and state to exact existing evidence/provenance references. No free-form evidence array as the authoritative association model. |
| Source/provenance reference | Closed source union in §8; reuse of L0 identity, never a duplicate source registry. |
| Technical current-head structures where needed | RPC-maintained pointers to immutable states; neither independent truth nor a substitute for temporal history. |

Registry state keys MUST include organisation and stable registry identity;
immutable version subjects additionally pin the exact version identity.
Validation of a registry entry/version MUST NOT silently validate assignments
or applicability that reference it. Registry and fact commands MUST preserve
the same applicable authorization/decision lineage, replay, concurrency, and
immutability invariants. ADMIT retains its authorization and durable admission
result without manufacturing a VALIDATE governance decision (§7).

An optional human comment MAY live only in a separate mutable/redactable
annotation surface. Such an annotation is non-authoritative, is not part of
command/fact identity, and is never required to reconstruct decision semantics.
It is not an additional authoritative support or fact family (§10).

Normalized support links MUST preserve their exact source/evidence identity,
tenant, linked proposal/decision/state, and provenance. Evidence content stays
in the existing evidence system; links MUST NOT fabricate content, duplicate
L0 truth, or resolve by a mutable label. Cross-tenant or unresolved references
MUST be rejected. A lack of supporting evidence MUST remain explicit; a human
decision or source label alone MUST NOT be represented as a substitute for
that missing evidence.
Typed proposal payloads MAY be serialized for transport, but each closed
subject kind MUST have modeled fields and validation, never an arbitrary
JSON/EAV authority store.

## 5. Root of authority and first-policy bootstrap

`SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1` is immutable and system-defined. It applies
only for the **FIRST** organisation-local Authority Policy version, before
an effective local policy exists. It may authorize ONLY ADMIT of that first
version and VALIDATE of that exact admitted first version. The actor MUST be
ACTIVE, currently belong to an active organisation, and resolve from current
persistence to the seeded system role satisfying BOTH
`role_code = 'GOVERNANCE_ADMIN'` AND `is_system_role = true`. JWT role is not
evidence of this role, and a same-named non-system role does not qualify.

Bootstrap MUST NOT authorize normal responsibility, business, policy, control,
party, or domain facts. ADMIT MUST record its dedicated authorization and
non-validated admission result; VALIDATE MUST use the proposal → authorization
→ governance decision → state chain. Both MUST record the bootstrap authority
identity and pin the same first version. The bounded bootstrap self-validation
exception applies only to this first-policy operation. Competing first-policy
commands MUST serialize on the organisation's policy bootstrap guard so only
one first identity/version can be established; retries obey §17.

V1 MUST have exactly ONE stable organisation-local `L14AuthorityPolicy`
identity per organisation, with immutable versions beneath it and at most
one effective version at any effective instant. First admission establishes
that stable identity; first validation establishes its effective authority.
Authority Policy V1 has no autonomous expiry that can silently leave the
organisation ungoverned. A successor MAY have a future `effective_from`.

Once a local Authority Policy has been established, every subsequent change,
including its replacement or revocation, MUST be authorized by the effective
local policy. A proposed successor MUST NOT authorize its own ADMIT or
VALIDATE decision. After the first local policy exists,
an operation that would leave no effective local Authority Policy at an
instant MUST be rejected. Revocation/replacement therefore requires an
already validated successor whose effective interval preserves continuity at
cutover, with no overlap or gap. History MUST NOT be edited to achieve this.

Bootstrap NEVER reopens. Corruption or manual loss outside this governed path
fails closed and requires an operational break-glass/recovery mechanism
outside M16 V1; this ADR does not define one. There is no generic fallback
to JWT `role = org_admin` or to a persisted administrator role alone.

## 6. Authority Policy mechanics and closed scopes

Authority MUST be evaluated over the conjunction of:

`fact/subject family + source class/source connection + target scope + Authority Policy version`.

The closed source disposition vocabulary is `AUTHORITATIVE`, `CONTRIBUTING`,
`NON_AUTHORITATIVE`. AUTHORITATIVE identifies an eligible authority basis;
it MUST NOT bypass the explicit governance decision required for V1
organisation-local governed-state validation. CONTRIBUTING may support a
proposal but cannot settle truth. NON_AUTHORITATIVE cannot authorize a fact.
Absent, ambiguous, or conflicting effective authority rules MUST fail closed;
unresolved assertions remain available as proposals/conflicts.

The closed V1 permission vocabulary is:

| Permission | Subject kind(s) |
|---|---|
| `L14_AUTHORITY_POLICY_ADMIT` | `AUTHORITY_POLICY_VERSION` admission only |
| `L14_PARTY_ADMIT` | `GOVERNANCE_PARTY` admission only |
| `L14_DOMAIN_ADMIT` | `BUSINESS_DOMAIN`, `INFORMATION_DOMAIN` admission only |
| `L14_CONTROL_DEFINITION_ADMIT` | `CONTROL_DEFINITION` admission only |
| `L14_POLICY_CONTENT_ADMIT` | Reused policy identity/content and `POLICY_VERSION` admission only |
| `L14_AUTHORITY_POLICY_ADMIN` | `AUTHORITY_POLICY_VERSION` |
| `L14_PARTY_VALIDATE` | `GOVERNANCE_PARTY` |
| `L14_DOMAIN_VALIDATE` | `BUSINESS_DOMAIN`, `INFORMATION_DOMAIN` |
| `L14_CONTROL_DEFINITION_VALIDATE` | `CONTROL_DEFINITION` |
| `L14_POLICY_VERSION_VALIDATE` | `POLICY_VERSION` |
| `L14_RESPONSIBILITY_VALIDATE` | `RESPONSIBILITY_ASSIGNMENT` |
| `L14_BUSINESS_CONTEXT_VALIDATE` | `BUSINESS_CONTEXT_ASSIGNMENT` |
| `L14_POLICY_APPLICABILITY_VALIDATE` | `POLICY_APPLICABILITY` |
| `L14_CONTROL_APPLICABILITY_VALIDATE` | `CONTROL_APPLICABILITY` |
| `L14_CONTROL_ASSESSMENT_VALIDATE` | `CONTROL_ASSESSMENT` |

The effective Authority Policy MUST map CURRENT persisted roles/eligibility
to these permissions, permitted governance actions, source constraints, and
typed scopes. A permission name alone MUST NOT imply REVOKE, self-validation,
backdating, future-dating, or any action not explicitly allowed by that policy.
The closed requested-action vocabulary is `ADMIT`, `VALIDATE`, `REJECT`,
`DEFER`, `REVOKE`. ADMIT MUST NOT imply VALIDATE, create validated facts,
or promote trust. Existing *_VALIDATE permissions continue to govern creation
of VALIDATED state for their respective subjects; Authority Policy validation
uses `L14_AUTHORITY_POLICY_ADMIN` under the existing effective policy or the
bounded first-policy bootstrap. Unknown permission/action/scope tags MUST be
rejected. Legacy wildcard role permissions MUST NOT expand either the closed
vocabulary or the typed target scope.

Self-validation means an actor validates a proposal they submitted. It MUST
fail closed unless the effective Authority Policy explicitly permits it for
the relevant subject/action/source/scope. The immutable first-policy bootstrap
is the only implicit bootstrap exception. Authority Policy administration
MUST obey the same rule under the previously effective local policy.

The closed target-scope grammar is a tagged union with typed operands:

| Tag | Required operands and matching semantics |
|---|---|
| `ALL_ALLOWED_TARGETS` | No operand; all otherwise legal targets in this organisation and subject family, never a bypass of a family matrix. For registry/policy administration with no canonical target, this is the organisation-local scope. |
| `CANONICAL_KIND` | One of the 11 canonical kinds; exact resolved object kind match. |
| `CANONICAL_OBJECT` | Exact organisation + canonical object identity; resolved kind must be legal for the subject. |
| `RELATIONSHIP_TYPE` | One of the 12 relationship types; exact resolved relationship-state type match. |
| `RELATIONSHIP_STATE` | Exact organisation + relationship_id + relationship_state_id tuple. |

No free-form scope JSON, wildcard text expressions, implicit descendant
expansion, or cross-tenant scope is permitted. Multiple rules are explicit
typed rules, not an open scope language. For an assessment the scope is
evaluated against the target of its pinned applicability state, without
changing that exact-state pin. Source-connection operands MUST resolve within
the same tenant. A source class rule MUST NOT erase a more specific conflict
unless the effective policy explicitly establishes that authority.

## 7. Proposal → authorization → decision → state

### 7.1. Proposal submission, admission, and validation

These are three distinct operations:

| Operation | Eligibility and effect |
|---|---|
| PROPOSAL SUBMISSION | A verified ACTIVE same-tenant user MAY submit a typed LOCAL_HUMAN proposal. This grants no authority, creates no admitted identity/content or validated registry/fact state, performs no trust promotion, and cannot mutate authoritative current heads. Submission is not VALIDATE authority. |
| ADMISSION | ADMIT, authorized by the matching closed admission permission in §6, creates non-validated identity/content in the bounded registry or reused content store. It preserves source/support and a durable authorization/admission result; it is not a governance VALIDATE outcome and cannot create a validated head or promote trust. |
| VALIDATION | The matching existing validation permission and an explicit authorized VALIDATE governance decision create VALIDATED state only after all subject and dependency checks pass. |

SYSTEM_SEED and SOURCE_CONNECTION proposals may be submitted only through
their bounded trusted technical intake, preserving source/provenance; they
cannot masquerade as LOCAL_HUMAN submissions or gain authority from intake.
Proposal submission itself is separate from the closed requested governance
actions. A typed proposal may precede admission, but submission MUST NOT
implicitly perform ADMIT. Validation MUST resolve any required admitted
identity/content and its exact version before creating governed state.

The mandatory governed-state chain is:

```text
PROPOSAL
→ AUTHORIZATION DECISION
→ GOVERNANCE DECISION
→ IMMUTABLE GOVERNED STATE
→ READ MODEL
```

The closed proposal subject kinds are `AUTHORITY_POLICY_VERSION`,
`GOVERNANCE_PARTY`, `BUSINESS_DOMAIN`, `INFORMATION_DOMAIN`,
`CONTROL_DEFINITION`, `POLICY_VERSION`, `RESPONSIBILITY_ASSIGNMENT`,
`BUSINESS_CONTEXT_ASSIGNMENT`, `POLICY_APPLICABILITY`, `CONTROL_APPLICABILITY`,
and `CONTROL_ASSESSMENT`. No generic subject discriminator is allowed.

Every proposal MUST carry a closed intent: `VALIDATE` or `REVOKE`. A REVOKE
proposal MUST pin exact `target_state_id`; it cannot carry implicit replacement
semantics. Replacement requires its own new VALIDATE proposal/state.

### 7.2. Authorization and decision lifecycle

`L14AuthorizationDecision` answers: **may this actor perform this requested
governance action NOW?** It MUST snapshot actor id, organisation, effective
role codes, effective permissions, Authority Policy version (or the immutable
bootstrap identity), requested action, typed target scope, `evaluated_at`,
and result `ALLOW` or `DENY`. It MUST bind the exact proposal and command
semantics. The authoritative ALLOW evaluation MUST occur in the same
transaction as the decision/state write (§9); a prior preview is insufficient.

`L14GovernanceDecision` outcomes are exactly `VALIDATE`, `REJECT`, `DEFER`,
`REVOKE`. VALIDATE creates a validated immutable state only when all subject
requirements and current authority checks pass. REJECT and DEFER preserve
their decisions/proposals without creating a validated fact. REVOKE MUST
identify the governed subject/current state and create an explicit immutable
revocation/tombstone state, subject to continuity/dependency rules.

DENY is a durable `L14AuthorizationDecision`. It consumes the
`(organisation_id, command_id)` attempt identity and MUST be replayable with
the original result. It creates NO `L14GovernanceDecision` and NO governed
state. A caller whose eligibility later changes MUST use a new command_id;
an identical retry of the denied attempt does not become ALLOW.

For VALIDATE intent, DEFER is non-terminal: a proposal MAY receive DEFER and
later exactly one terminal VALIDATE or REJECT. VALIDATE and REJECT terminate
that proposal for validation purposes. Corrected content after either outcome
requires a NEW proposal linked to the previous proposal. Immutable proposal
content is never edited, including while deferred. Concurrent terminal
decisions MUST NOT both succeed.

For REVOKE intent, the only permitted governance outcomes are REVOKE, REJECT,
DEFER. DEFER is non-terminal; REVOKE or REJECT terminates that intent. A
REVOKE proposal cannot VALIDATE a replacement. These lifecycle constraints
are enforced with the command/proposal transactional guards in §17.

The proposal, authorization, governance decision, resulting state (if any),
source, evidence/support, authority version, and read projection MUST remain
traceable by durable identifiers. M16 MUST NOT reuse
`gov_repo.authorization_decisions` or the `Date.now()`-based reconciliation
authorization adapter. The L14 decision model is a bounded governance
contract, not a generic approval workflow or QES platform.

## 8. Source, provenance, support, and trust

M16 source reference is the closed union:

| Source class | Required reference / authority ceiling |
|---|---|
| `SYSTEM_SEED` | Identified immutable seed origin/version and provenance; a seed proposes content and does not validate ordinary L14 facts. |
| `LOCAL_HUMAN` | Verified submitting actor and organisation; input is a proposal, not automatic authority or trust promotion. |
| `SOURCE_CONNECTION` | Existing tenant-scoped L0 source identity when available, with acquisition/snapshot/source provenance where available. If identity cannot resolve, retain the deficiency and block dependent authoritative promotion; do not invent a connection. |

There MUST NOT be a duplicate L0 source truth. M19 may later populate
enterprise source connections without changing this authority model. Missing
acquisition metadata or evidence MUST remain missing rather than be filled
with defaults presented as observations.

Trust remains exactly `INFERRED`, `DECLARED`, `IMPORTED`, `OBSERVED`,
`VALIDATED`:

| Origin / event | Trust rule |
|---|---|
| Scanner-derived proposal | `INFERRED` |
| Explicit code/config/source metadata | `DECLARED` |
| External/enterprise assertion | `IMPORTED` |
| Runtime fact | `OBSERVED` |
| Local human input | Proposal with no automatic trust promotion; absence of an evidenced trust classification stays absent, not a sixth trust value. |
| Effective governed VALIDATE decision | `VALIDATED`, retaining the proposal's original provenance/trust context. |

Confidence MUST NOT promote trust. Discovery/scanner machine authority ends
at PROPOSED. A source's AUTHORITATIVE disposition, a human input, a seed,
recency, or an LLM statement is not itself a VALIDATE decision. A validity
expiry/revocation changes whether a state is currently usable; it MUST NOT
erase the historical validation or rewrite its original trust record.

## 9. M16-S0: verified governance principal and transactional eligibility

M16-S0 is a STRUCTURAL PREREQUISITE before any authoritative M16 write.
A shared verified-principal resolver MUST replace request-header identity for
tenant/governance access. `x-codeguard-*` request headers MUST NOT be
authoritative. All relevant consumers of `apps/dashboard/lib/session.ts`
that read or mutate tenant/governance data MUST migrate to that resolver;
`session.ts` MUST no longer be an authority path. `/api/auth/me` MUST stop
reading identity from request `x-codeguard-*` headers.

Middleware MAY redirect or navigation-gate. It is not the authority boundary
and MUST NOT manufacture authoritative request/response identity headers.
The trusted backend MUST derive actor and organisation only from verified
claims; a body, URL, header, or caller-supplied actor/tenant MUST NOT override
them. Requested resource identifiers still require same-tenant resolution.

Verified-session acceptance MUST enforce all of the following:

- `JWT_SECRET` is required; reject the known fallback, known example or
  placeholder secrets, and secrets shorter than **32 bytes**.
- The accepted signature algorithm MUST be explicitly pinned, never selected
  from untrusted token input. A fixed issuer and audience MUST be validated.
- Required claims MUST be structurally validated, including nonempty valid
  `sub` and organisation identifiers and valid temporal claims (`iat`, `exp`;
  `nbf` when present). Invalid, expired, or not-yet-valid sessions are rejected.
- `sub` and organisation come only from verified claims. JWT role and email
  are informational and never sufficient authorization.
- Issuer/audience cutover MUST intentionally invalidate existing sessions.
- Authoritative governance session age MUST be **<= 8 hours**, measured from
  verified `iat`; refreshing request metadata MUST NOT extend that age.
- For authoritative command eligibility, `governance_users.password_changed_at`
  MUST be non-null and verified `iat` MUST satisfy the strict second-precision
  rule below. Missing required eligibility information fails closed.

Before authoritative M16 commands are enabled, the future M16-S0 cutover
migration MUST normalize legacy NULL `governance_users.password_changed_at`
values using a DB-authored cutover timestamp for those rows. After that
normalization, this field is REQUIRED/non-null for governance command
eligibility. NULL MUST NOT mean unrestricted eligibility. Credential/password
mutation MUST update `password_changed_at` atomically with the credential
mutation. These are future migration requirements, not work performed here.

JWT NumericDate `iat` has second precision. Fail-closed command eligibility
MUST enforce:

```text
iat_seconds > floor(epoch(password_changed_at))
```

A token minted in the same wall-clock second as the password change is
rejected and the user MUST authenticate again. Older tokens are also rejected;
a later fresh session remains subject to all other eligibility checks. This
rule does not weaken the issuer/audience cutover that intentionally invalidates
existing sessions, or the 8-hour maximum age.

Inside the SAME transaction that commits an authoritative state, the write
RPC MUST revalidate actor existence/active status, organisation
existence/active status, membership, CURRENT persisted roles, current
effective L14 permissions, and the effective Authority Policy version.
Session-age/password-change eligibility MUST remain true at commitment.
The resulting authorization snapshot MUST capture the basis actually used.

Locking MUST prevent eligibility/authority changes between check and write,
including role-grant insertion/deletion and policy-head changes. Locking only
existing role rows is insufficient for absent/new grants: eligibility writers
and governance commands MUST share an actor/organisation authority guard or
equivalent transactional serialization. Acquire shared guards in a consistent
order and serialize the fact/cardinality head as well. Stale permissions or
policy versions MUST NOT authorize a new state.

The database does not authenticate the original HTTP request. It revalidates
the actor/organisation and verified session context attested by the trusted
backend. The `service_role`/backend credential is part of V1's trusted
computing base. This ADR makes no claim of resistance to complete
`service_role` credential theft. Direct-table privilege denial and RPC checks
remain mandatory within that trust ceiling.

## 10. GovernanceParty and semantic registries

`GovernanceParty` MUST use a random opaque tenant-scoped identifier, never an
identifier derived from email or `governance_user_id`. Party kinds are exactly
`PERSON`, `GROUP`, `ORGANISATIONAL_UNIT`.

Immutable responsibility facts/history MUST store only `governancePartyId`
as the party reference, not copied names, emails, or mutable identity mappings.
Governance actor ids in decision audit records serve a separate authorization
purpose. Mutable directory/profile/mapping data MAY contain PII and MUST be
correctable, pseudonymizable, or erasable without changing historical party
identity or fact history. A mapping MAY link to a current governance user or
future enterprise identity. GovernanceParty is NEVER the authorization basis.

Immutable `L14Proposal` content for GOVERNANCE_PARTY may contain ONLY the
random opaque `governancePartyId`, closed party kind, and non-PII typed
governance metadata explicitly required by this contract. It MUST NOT contain
name, email, phone, or free-text contact/profile data. Those values live ONLY
in the separately mutable/erasable directory/profile/mapping, including during
proposal intake; they MUST NOT be copied into immutable proposal history.

General immutable L14 proposal/authorization/decision/state records MUST NOT
contain arbitrary free-text rationale that could retain PII. Authoritative
decision semantics MUST use a closed `reason_code` and normalized
support/evidence references; unknown reason codes or arbitrary text in place
of a code MUST be rejected. An optional human comment belongs only in the
separate mutable/redactable annotation surface (§4). It is not authority,
is not part of command/fact identity, and is not required to reconstruct the
decision semantics. Profile erasure/pseudonymization and annotation redaction
MUST NOT alter fact history.

BusinessDomain registry stable identity IS the existing L6
`BusinessDomainIdentity` semantic identity. InformationDomain registry stable
identity IS the existing L6 `InformationDomainIdentity` semantic identity.
M16/L14 adds governed admission/validation/state lifecycle around those
existing L6 identities and MUST NOT create a parallel semantic ID namespace.
Tenant isolation remains mandatory. Labels/descriptions are metadata and
NEVER define identity. A legal assignment MUST reference a validated registry
identity of its exact semantic kind. Identity MUST survive descriptive
corrections; authoritative changes require new governed states, with no
rewriting of old assignments or decision support.

## 11. Responsibility roles and target/cardinality matrix

The closed initial V1 roles and complete target legality matrix are:

| Target kind | Allowed role | Maximum active assignments at an effective instant |
|---|---|---|
| `AGENT` | `BUSINESS_OWNER` | 1 |
| `AGENT` | `TECHNICAL_OWNER` | 1 |
| `DATA_ASSET` | `DATA_OWNER` | 1 |
| `DATA_ASSET` | `DATA_STEWARD` | Multiple, one per party |
| `DATA_ELEMENT` | `DATA_OWNER` | 1 |
| `DATA_ELEMENT` | `DATA_STEWARD` | Multiple, one per party |

Every other role/target pairing is prohibited. `AGENT_VERSION` is deliberately
excluded; changing responsibility MUST NOT create an AgentVersion.

The logical identity/supersession key is target identity + role +
`governancePartyId`. Owner reassignment to another party therefore changes
logical fact key: it MUST explicitly end/revoke the prior assignment and
validate the replacement without overlapping the single-owner constraint.
This cannot be achieved by silently overwriting the old party id. All affected
keys and target/role cardinality MUST be protected transactionally. Multiple
stewards MUST NOT allow duplicate active states for the same party/key.

Single-owner non-overlap MUST be enforced by the authoritative RPC under the
SAME fact/head transactional guard as expected-current/concurrency checks,
never by updating predecessor history. The database guard MUST prevent two
concurrent commands with different command_id values from creating overlapping
BUSINESS_OWNER, TECHNICAL_OWNER, or DATA_OWNER states for the same target/role,
even when they name different parties. DATA_STEWARD remains multi-party, but
concurrent duplicate active assignment for the same
`target + DATA_STEWARD + governancePartyId` MUST be rejected.

## 12. Business context legality and no inheritance

V1 semantic kinds are only `BUSINESS_DOMAIN` and `INFORMATION_DOMAIN`.

| Target kind | Legal semantic kind(s) |
|---|---|
| `AGENT` | `BUSINESS_DOMAIN` |
| `DATA_ASSET` | `BUSINESS_DOMAIN`, `INFORMATION_DOMAIN` |
| `DATA_ELEMENT` | `INFORMATION_DOMAIN` |

The supersession key is target identity + semantic kind. V1 permits exactly
one active assignment per such key, referencing a governed registry identity.
All other pairings are prohibited. BusinessTerm, purpose, and capability
bindings are deferred.

Semantic-assignment non-overlap MUST be enforced under the same fact/head
transactional guard used for expected-current/concurrency, including commands
with different command_id values. Predecessor history MUST NOT be updated
to satisfy one-active-assignment cardinality. Both domain kinds use the
existing L6 semantic identities specified in §10.

Assignments are exact-only. There MUST NOT be implicit inheritance from
AGENT to AGENT_VERSION, DATA_ASSET to DATA_ELEMENT, parent to child, or object
to relationship. Free text, defaults, scanner values, and legacy domain strings
MUST NOT become governed assignments without the explicit proposal/decision
chain. No governed assignment means `UNKNOWN`, not an empty/default domain
or a negative assertion.

## 13. Policy reuse, bounded admission, and version hardening

M16 MUST reuse `gov_repo.governance_policies` and `gov_repo.policy_versions`.
It MUST NOT create a third policy store. Historical rows and legacy policy or
version approval/status fields MUST NOT become authoritative automatically.

V1 MUST expose bounded application commands for policy identity and immutable
policy-version creation. These commands MUST derive the tenant/actor from the
verified principal, check current `L14_POLICY_CONTENT_ADMIT` permission and
scope for requested action ADMIT, validate typed content, and run through
constrained RPC admission. Direct SQL is not
the V1 application admission model. Creating content MUST NOT validate it.
A `POLICY_VERSION` proposal referencing exact admitted content MUST receive
an M16-specific authorized VALIDATE decision before governed applicability
can use it. Existing rows require the same explicit admission/validation
checks, with recorded source/support and no implicit status conversion.

Required hardening for the reused policy-version store is:

- Tenant consistency between version and parent policy; exact
  `policy_id + version_id` identity, never an unqualified version lookup.
- Pinned `content_hash`, independently computed/verified by PostgreSQL from
  the admitted immutable content; a client-provided hash alone is insufficient.
- Raising immutability once inserted. Corrections create new versions;
  M16 validation/revocation lives in immutable M16 state, not edits to content.
- No `ON DELETE CASCADE` path that loses version history, including deletion
  of a parent policy; protect retained historical references.
- Direct `service_role` writes revoked. Hardened admission and M16 decision
  RPCs are the only permitted application write paths.
- Legacy policy/version status is not M16 authority. A specific
  `POLICY_VERSION` validation decision is REQUIRED.

`POLICY_APPLICABILITY` MUST pin an exact validated tuple:
`organisation + policy_id + version_id + content_hash`. Its supersession key
is target identity + `policy_id`, not version id. Applicability is exactly
`APPLIES` or `DOES_NOT_APPLY`; absence is `UNKNOWN`. A later version or legacy
`current_version_id` pointer MUST NOT silently repin applicability. The
referenced version's validation must be effective for current governed use;
revocation does not erase historical readback or select a replacement.

## 14. Control definition and applicability

M16 MUST provide a tenant-scoped stable `ControlDefinition` and immutable
version states, with explicit governed validation. Existing CG-AG 001..012
MAY be seeded only as proposals with provenance. No `cg_*` boolean is authority.

Validated `CONTROL_APPLICABILITY` MUST pin an exact validated
control-definition version in the same organisation. Its supersession key
is target identity + stable `control_definition_id`; changing a version
creates a new applicability state. Applicability is exactly `APPLIES` or
`DOES_NOT_APPLY`; absence is `UNKNOWN`. Neither definition updates nor
canonical identity alone imply applicability, coverage, or satisfaction.

## 15. Assessment lifecycle and expiry

`CONTROL_ASSESSMENT` MUST target an exact governed
`CONTROL_APPLICABILITY` state, not just a target/control pair. Its closed
outcomes are `SATISFIED`, `PARTIALLY_SATISFIED`, `NOT_SATISFIED`,
`NOT_ASSESSED`, `INSUFFICIENT_EVIDENCE`. `WAIVED` is unsupported in M16 V1;
exception/waiver lifecycle is deferred. There MUST NOT be an authoritative
governance score, control-coverage score, maturity aggregate, or residual-risk
computation.

Assessment creation/validation requires the pinned applicability state to be
APPLIES, valid, and non-revoked at assessment `effective_from`, with dependencies
valid under the same effective/business time and recorded/system cutoff (§18).
An assessment MUST NOT target DOES_NOT_APPLY, revoked applicability, or
dependency-invalid applicability. A successor applicability is never selected
automatically to make assessment admission succeed.

Every validated assessment MUST have `effective_from` and `valid_until`, with
`valid_until > effective_from`. Its validity interval is
`[effective_from, valid_until)`; at expiry it ceases to be a current valid
assessment without a historical row update. A current head alone MUST NOT
override expiry. An explicit NOT_ASSESSED outcome is distinct from absence
of a current valid assessment; absence is UNKNOWN in consuming projections.
`valid_until` IS the assessment's `effective_to`, not a second independent
end date. The immediate/explicit effective_from rules in §17 apply.

The supersession key is `control_applicability_state_id`; only one current
assessment state is permitted per applicability state. Corrections and
renewals append assessment states with predecessor and decision lineage.
Normalized CONTROL_FINDING detail MUST remain attached to its exact
assessment state and cannot outlive it as an independent authority surface.

An assessment MUST NEVER transfer to a successor applicability state, even
if target, control identity, and content are otherwise unchanged. If
applicability is superseded/revoked, the old assessment remains historical;
the new/current applicability starts without a current assessment. Reads
MUST jointly check applicability identity, governed validity/revocation, and
assessment validity/expiry and all pinned dependency validity. A
DOES_NOT_APPLY state cannot be an assessment target and MUST NOT be reported
as positive control coverage or satisfaction by aggregation.

## 16. Exact relationship-state references and F2

**F2 remains globally deferred. Current M16 verdict: F2 = NOT TRIGGERED.**

M16 MUST NOT modify `gov_repo.canonical_relationships` or add a unique
constraint for `relationship_state_id`. Current exact resolution MUST
validate by lookup using all three operands:
`organisation_id + relationship_id + relationship_state_id`. No bare-state-id
lookup or new uniqueness/FK dependency on that identifier is permitted.
Unresolved or ambiguous exact resolution fails closed.

A relationship-state target is reference-only. M16 MUST NOT infer a current
or latest successor. If F2 later introduces successor relationship states,
applicability pinned to an old state MUST NOT carry forward. Any need to
UPDATE, DELETE, close `valid_to`, or supersede canonical_relationships means
**STOP — F2 becomes blocker**, requiring resolution outside this M16 contract.
M16 immutability/privilege changes MUST be scoped to its authority objects
and approved reused policy surfaces, not smuggled into this deferred table.

## 17. Immutable history, replay, concurrency, and time

Every authoritative registry/fact family MUST retain immutable state/history
with logical fact key, state id, predecessor state id (or explicit first state),
`effective_from`, `effective_to` where applicable, DB-authored `recorded_at`,
decision id, Authority Policy version, support/provenance, and trust.
Supersession appends a new state. Revocation appends an explicit
tombstone/revocation state. Historical UPDATE/DELETE is prohibited.
The party directory and optional annotation surface are bounded,
non-authoritative mutable/redactable surfaces (§10), not governed history.

For an immediate-effective command, omitting `effective_from` instructs
PostgreSQL to assign the transaction effective instant consistently with
DB-authored command/state timing. For an explicitly supplied client value:

- `effective_from < DB transaction time` is BACKDATED and requires explicit
  effective Authority Policy permission.
- `effective_from > DB transaction time` is FUTURE_DATED and requires explicit
  effective Authority Policy permission.
- Exact equality is immediate. There is NO implicit clock-skew tolerance;
  callers wanting ordinary immediate effect MUST omit effective_from.

For RESPONSIBILITY_ASSIGNMENT, BUSINESS_CONTEXT_ASSIGNMENT,
POLICY_APPLICABILITY, and CONTROL_APPLICABILITY, an immutable explicit
`effective_to` MAY be supplied only at creation when authorized and MUST
satisfy `effective_to > effective_from`. Otherwise the interval is open-ended
and eventual closure is derived from successor/revocation history without
editing the predecessor. For CONTROL_ASSESSMENT, mandatory `valid_until`
IS its effective_to (§15). Authority Policy continuity follows §5 and MUST
NOT be bypassed by applying ordinary fact-expiry semantics to policy versions.

Effective closure derived from a successor/revocation MUST NOT be implemented
by editing the predecessor's stored interval. Any explicit end known at
insertion remains immutable. Technical current/head structures are pointers
only and MUST be reconstructible from history; their mutation is RPC-only.
Future-effective states MUST NOT prematurely hide a still-effective state.

Command identity is `organisation_id + command_id`. A deterministic semantic
fingerprint MUST bind action, actor, proposal intent, typed subject, target,
exact pinned versions/content, closed reason_code where applicable,
source/support references, temporal intent, and concurrency
expectations. Serialization rules MUST distinguish meaningful absence/value
differences and normalize only representation differences; transport noise
and DB-authored result timestamps are not command semantics. Optional human
comments are excluded from command/fact identity. An omitted effective_from
MUST fingerprint as the same immediate-effect intent on retry; it MUST NOT
be replaced in the retry fingerprint by a newly sampled time. PostgreSQL MUST
independently recompute/verify command/fact identity and fingerprint; a
deliberately WRONG caller/TypeScript fingerprint MUST be rejected.

- Same command + same semantic payload MUST return the original durable
  result, including the original `recorded_at`, decision ids, and state ids.
- Same command + changed semantic payload MUST return `REPLAY_CONFLICT`,
  with no new authoritative state.
- Retries still require a verified same-tenant principal and authorized
  access to the durable result. Returning it is not a new validation and
  MUST NOT replay the state transition under a new timestamp or policy.
- A durable DENY also consumes the command attempt identity and replays its
  original authorization result without a governance decision/state. Changed
  eligibility requires a new command_id, not reevaluation of that attempt.

Each mutation MUST supply `expected_current_state_id` or explicit
expected-none; omission MUST NOT mean blind overwrite. Enforce unique-successor
protection, first-state uniqueness, and family/cardinality guards in the
database, including concurrent distinct command ids. A stale expectation
MUST fail rather than choose a winner by timing. Proposal terminality and
dependency validity MUST be protected by the same applicable transactional
guards. Durable command result, authorization, and any permitted governance
decision/state/head update MUST commit atomically. DENY commits only its
authorization and durable result, never a governance decision/state; ADMIT
commits its non-validated admission result without a VALIDATE decision/state.

As-of reads MUST distinguish effective/business time from recorded/system
time: ask what was effective at a business instant, as known at a specified
recorded instant. Later-recorded corrections MUST NOT appear in earlier
knowledge cutoffs. Backdating and future-dating MUST be explicitly authorized
by the effective Authority Policy, preserve non-overlap/cardinality, and
never rewrite recorded history. An immutable command's replay MUST preserve
its original effective and recorded times.

## 18. Conflict and read model

### 18.1. Dependency validity at both temporal coordinates

A governed fact is current/usable ONLY if its own state AND EVERY governed
registry/version/state dependency it pins are valid at the SAME requested
effective/business time and recorded/system cutoff. This includes at minimum
GovernanceParty, BusinessDomain, InformationDomain, PolicyVersion validation
state, ControlDefinition version validation state, and ControlApplicability
state, including their pinned dependencies.

Revocation/supersession of a pinned dependency MUST NOT rewrite the dependent
historical fact. It makes the dependent fact ineligible for current truth from
the relevant effective instant, evaluated at the requested recorded cutoff.
Historical as-of readback MUST remain available and reflect what was known
at that cutoff. Passport and current governed reads MUST return UNKNOWN /
no-current-fact instead of continuing to present the dependency-invalid fact
as VALIDATED. They MUST NOT auto-select a replacement party/domain/version/
state. A replacement binding requires its own governed decision/state.

### 18.2. Conflict projection

Competing proposals MUST remain explicit. Confidence, recency, a local source,
or LLM output MUST NOT automatically select a winner. Source precedence is
usable only where an effective Authority Policy explicitly establishes
authority, and still requires an explicit governed decision for V1 state.

Conflict read outcomes are exactly `RESOLVED`, `CONFLICT`,
`INSUFFICIENT_EVIDENCE`. Conflict is a projection/read outcome, not a second
truth store. These outcome values do not extend trust or applicability
vocabularies. Missing current governed facts are still UNKNOWN in Passport;
a conflict or insufficient support MUST NOT be rendered as a validated winner.

## 19. G-06 legacy disposition and reuse

M16 MUST unify governed authority without creating a third authority surface.

| Disposition | Existing surfaces | Required treatment |
|---|---|---|
| REUSE + HARDEN | `governance_policies`, `policy_versions`, hardened mandate mapping where relevant | Preserve stable identity/reuse; apply explicit M16 version validation, tenant, history, and privilege rules. Mapping is not automatic applicability. |
| COMPATIBILITY / PROPOSAL INPUT ONLY | Legacy owner fields, `business_domain` strings, descriptive context | May produce supported proposals; cannot populate governed fact heads directly. |
| QUARANTINED AS AUTHORITY | `cg_*` flags, generic approval workflow, legacy exception/waiver authority, legacy risk authority, governance/control scores | MUST NOT authorize or settle M16 facts or M18 conclusions. |
| QUARANTINED AS AUTHORITY unless explicitly migrated | Legacy control assessments | Re-admit through proposal + current authorization + governance decision with support; no status-copy promotion. |

Legacy UI/report consumers still displaying those legacy values MUST label
them non-authoritative and MUST NOT feed M16 or M18 governed conclusions.
Historical G-06 evidence and static CG-AG mappings are reuse inputs, not
current governed-control proof. No approval of this ADR retroactively
certifies legacy rows or changes implementation-conformance classifications.

## 20. Privilege model and future migration obligations

For every M16 authoritative object, the implementation MUST first REVOKE ALL
from `PUBLIC`, `anon`, `authenticated`, and `service_role`, then grant only
the exact required privileges. Audit effective and inherited privileges,
ownership, default grants, and exposed routines, not merely written REVOKE
statements. Do not grant a technical writer direct authority-table mutation.

The privilege audit MUST include SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
REFERENCES, TRIGGER, MAINTAIN where supported, sequence privileges, and
routine/function EXECUTE. Harden reused policy admission/history objects as
well as new L14 objects. Default grants MUST NOT silently restore access.

Authoritative views MUST be `security_invoker` and read-only, with explicit
tenant-scoped read access. Exposed tables require appropriate tenant security;
RLS alone MUST NOT be treated as protection against privileged backend writes.
History MUST have raising immutability triggers, never silent
DO-INSTEAD-NOTHING semantics for new M16 state. No cascade or maintenance
privilege may become an application history-erasure path.

Write RPCs MAY use SECURITY DEFINER only with a documented need. They MUST
pin `search_path`, fully qualify objects, revoke PUBLIC/anon/authenticated
EXECUTE, and grant EXECUTE only to the explicit technical writer. A narrowly
granted backend RPC execution privilege MUST NOT imply direct table writes.
In-RPC current eligibility, authority, tenant/reference resolution,
fingerprint, and concurrency checks remain mandatory. Heads/current pointers
MUST be mutated only by those RPCs.

Future migrations MUST perform ACL postflight assertions after all grants,
including existing broad defaults. They MUST protect immutable history and
policy-version admission without F2 DDL. This documentation change creates
or runs no migration and makes no database change.

## 21. Acceptance harness requirements

M16 MUST use a distinct security-capable disposable PostgreSQL profile,
reusing the real `initdb` / `pg_ctl` / `psql` pattern. Its fixture chain MUST
include relevant canonical migrations, identity/user/role prerequisites,
the `20260818013113` broad service_role/default grant migration, and the
future M16 migrations. Omitting broad grants would conceal the privilege
regression being tested.

**PostgreSQL 17 is the canonical acceptance target.** PG16 MAY provide a
compatibility smoke only, not substitute for PG17 acceptance. Tests MUST
inspect `pg_catalog` ACLs and exercise actual denied/allowed operations with
the intended roles. Include a deliberately unsafe/un-revoked negative-control
object; the ACL checker MUST detect it. Negative controls MUST cover each
applicable privilege surface/class, not only one generic unsafe table:
table direct DML; TRUNCATE; REFERENCES/TRIGGER/MAINTAIN where applicable;
sequence privileges; routine EXECUTE; writable/updatable view exposure; and
inherited/default-grant reintroduction. A checker that misses any applicable
negative control is invalid, even if intended M16 objects appear secure.

Concurrency tests MUST exercise role/eligibility changes against state
commitment, not just sequential prechecks. Temporal tests MUST exercise
expiry, supersession, revocation, and both as-of axes. M15 regression semantics
MUST NOT be weakened or replaced by this distinct profile. The existing M15
PostgreSQL regression MUST remain unchanged and green alongside the new M16
security profile. No tests or security/database harness are executed or
claimed passing by this documentation-only ADR.

## 22. Passport, lineage, graph, vector, LLM, and downstream boundaries

Passport MUST consume M16 governed states only for enrichment affecting
family 3 Ownership & Responsibility, family 4 Business Context, family 12
Governance Controls, and family 14 Provenance & Trust where applicable.
Without a current valid fact, including when a pinned dependency fails §18.1
at either requested temporal coordinate, it MUST return UNKNOWN. The controls
family MUST no longer imply coverage from canonical identity alone. Existing
non-M16 Passport families retain their established contracts.

L14 MUST expose evidence, policy/control, governance-decision, and temporal
lineage through exact references. This does not add canonical edge kinds,
complete missing data lineage, or claim finer grain than existing evidence.
Graph/GraphOS is projection only; vector is derived retrieval only. Neither
may become a store of owner/domain/policy/control authority. No new vector
identity or embeddings capability is required by this ADR.

LLMs MAY explain, propose, or recommend. They MUST NOT validate, approve,
assign ownership, perform authoritative assessments, or write truth. No real
OpenAI calls are part of this documentation task or required to establish
these deterministic acceptance properties.

M16 MUST NOT implement the L15/M17 chain
`signal → hypothesis → governed risk → residual risk` or any residual-risk
authority. M17 may later consume the governed facts without treating scores
or assessments as risk decisions. M18 MUST later project the SAME M16 facts;
M18-local owner/domain/policy/control truth is prohibited. M19 integration
must preserve source, tenant, evidence, and authority boundaries.

## 23. A–O Definition of Done

This explicit A–O mapping is the proposed candidate contract, not a report of
implemented coverage. All O acceptance obligations below are REQUIRED before
future M16 acceptance.

| ID | Dimension | Normative M16 obligation |
|---|---|---|
| A | CIA baseline compatibility | Preserve `GOVIA-L0L16-CIA-v1.0`, its invariants, closed vocabularies, and AGENT/AGENT_VERSION distinction; no baseline amendment (§§1–2). |
| B | L0–L16 impact | Primary L14; depend on L0 provenance, L6 semantic identities, L11 verified principal/eligibility, and L9 exact identity references. Consume L13/L16 evidence without new authority there. L1–L5, L7–L8, L10, and L12 gain no new discovery/runtime capability; L15 risk remains M17 (§§1, 22). |
| C | Passport impact | Families 3, 4, 12, and 14 consume governed facts; UNKNOWN without current valid facts, no coverage inferred from identity (§22). |
| D | Canonical impact | Exactly 11 kinds and 12 relationship types unchanged; five L14 fact families reference existing identities; support registries are not canonical kinds; F2 untouched (§§2–4, 16). |
| E | Lineage impact | Preserve exact proposal/authz/decision/state, source/evidence, policy/control, and temporal lineage; no new canonical edges or inferred successor lineage (§§7, 16–17, 22). |
| F | Evidence / provenance | Normalized tenant-scoped support links and closed source union; reuse L0 identity; missing evidence stays missing (§§4, 8). |
| G | Trust / authority | Frozen five trust states; explicit current-policy authorization and governance decision, restricted bootstrap, self-validation fail-closed; confidence cannot validate (§§5–9). |
| H | Vector impact | Derived retrieval only, never identity or governance authority; no new vector capability required (§22). |
| I | Graph impact | Projection only from eligible governed states; no graph truth store or new canonical relationship types (§§2, 22). |
| J | LLM boundary | Explain/propose/recommend only; no validation, approval, assignment, authoritative assessment, or truth write (§22). |
| K | Tenancy / security | M16-S0 verified principal, same-transaction eligibility, cross-tenant reference rejection, scoped RPCs/ACLs, explicit backend trust ceiling (§§9, 20). |
| L | Migration impact | Future bounded L14 persistence and reused policy hardening with raising immutability, replay, ACL postflight; no F2 DDL; this ADR performs no migration (§§13, 16–17, 20–21). |
| M | Downstream continuity | Preserve M15 regressions; M17 consumes facts without M16 risk authority; M18 projects the same facts; M19 reuses source/authority model (§§8, 21–22). |
| N | Non-fabrication | No default owner/domain/control success, legacy automatic promotion, inherited assignment, confidence promotion, invented evidence, or risk/coverage score presented as truth (§§8, 11–15, 18–19). |
| O | Acceptance / quality metrics | All criteria O01–O55 below MUST pass on the specified application and PG17 security harness where applicable; no untested security/coverage claim (§21). |

### O — Mandatory measurable acceptance criteria

| ID | Required result |
|---|---|
| O01 | Zero `x-codeguard-*` identity authority across relevant session consumers, middleware, APIs, server reads, and writes. |
| O02 | Zero tenant/actor substitution via headers, request bodies, paths, or unverified claims. |
| O03 | `/api/auth/me` migrated to the shared verified-principal resolver. |
| O04 | Missing/default/example/placeholder/weak secrets rejected, including every secret shorter than 32 bytes. |
| O05 | Pinned algorithm, fixed issuer/audience, and required structural/temporal claims enforced; old sessions rejected after cutover. |
| O06 | Authoritative governance session age <= 8h; over-age sessions rejected. |
| O07 | `iat` versus `password_changed_at` enforced at authoritative command eligibility; predating tokens rejected. |
| O08 | Inactive or missing user/organisation rejected, including a change concurrent with commitment. |
| O09 | Tenant mismatch and invalid membership rejected within the write transaction. |
| O10 | Stale JWT role cannot authorize; persisted roles/permissions and authority changes govern commitment. |
| O11 | Current role/permission basis, policy version, action, scope, actor, organisation, time, and ALLOW/DENY captured. |
| O12 | Cross-tenant target/party/evidence rejected; source/domain/policy/control references also resolve within the tenant. |
| O13 | Authority Policy bootstrap works only for first local policy with ACTIVE current GOVERNANCE_ADMIN; no ordinary facts or rebootstrap after revocation. |
| O14 | Self-validation follows the effective policy, fails closed without permission, and uses only the bounded bootstrap exception. |
| O15 | Complete proposal → authz → decision → state lineage; REJECT/DEFER/DENY cannot create validated facts. |
| O16 | Direct service_role privileges denied on M16 authority state; no direct history/head writes, including reused hardened policy-version writes. |
| O17 | ACL postflight passes with the broad-grant prerequisite and checks all applicable privileges, sequences, routines, views, defaults, and inherited grants. |
| O18 | Deliberately unsafe/un-revoked ACL negative control detected by the checker. |
| O19 | Authorized RPC succeeds with exact technical-writer privileges and current authority; unauthorized RPC use fails. |
| O20 | Replay with identical semantic payload returns exact original durable result, including original recorded_at, ids, and times. |
| O21 | Changed-payload replay produces REPLAY_CONFLICT and no additional governed state. |
| O22 | Stale concurrency rejected; expected-none, unique-successor, concurrent first-policy, and owner/domain cardinality protected. |
| O23 | Immutable historical readback preserved; forbidden historical UPDATE/DELETE raises and no cascade loses versions. |
| O24 | Explicit revocation/tombstone state created with decision lineage; prior state retained. |
| O25 | Effective versus recorded as-of readback correct; authorized back/future dating does not rewrite history or violate cardinality. |
| O26 | No implicit inheritance across AGENT/AGENT_VERSION, asset/element, parent/child, or object/relationship; illegal role/domain pairings rejected. |
| O27 | No legacy automatic promotion; legacy UI/report values labeled non-authoritative and excluded from governed conclusions. |
| O28 | Missing support stays missing; confidence, local source, seed, and LLM cannot create validation or fabricated evidence. |
| O29 | Policy applicability pins validated organisation/policy/version/hash, with DB-side hash verification and bounded policy/version admission. |
| O30 | Control applicability pins exact validated control-definition version; cg_* flags cannot authorize. |
| O31 | Assessment enforces valid_until > effective_from, expires at valid_until, and does not carry across applicability states; revoked/superseded applicability makes old assessments historical. |
| O32 | Passport UNKNOWN without current valid facts; canonical identity alone implies no control coverage. |
| O33 | Exactly 11 CanonicalObjectKinds, with existing endpoint legality and no PARTY/DOMAIN/POLICY/CONTROL addition. |
| O34 | Exactly 12 GovernedRelationshipTypes, with no OWNS/APPLIES_POLICY/CONTROLLED_BY addition. |
| O35 | F2 untouched: no canonical_relationships DDL/mutation or relationship_state_id unique constraint; exact tenant/relationship/state lookup required. |
| O36 | No M17 risk authority, residual-risk calculation, waiver outcome, or authoritative governance/coverage/maturity aggregate. |
| O37 | No M18 parallel authority; downstream projections consume the same governed M16 facts. |
| O38 | Exactly five top-level M16 fact families exist; CONTROL_FINDING cannot create an independent authority head/family. |
| O39 | GovernanceParty ids are opaque/random; immutable proposal/authorization/decision/state records contain no party profile PII or arbitrary free-text rationale; closed reason_code and normalized support carry decision semantics, and profile erasure/pseudonymization or annotation redaction does not alter fact history. |
| O40 | Assessment outcomes are exactly SATISFIED, PARTIALLY_SATISFIED, NOT_SATISFIED, NOT_ASSESSED, INSUFFICIENT_EVIDENCE; WAIVED rejected; CONTROL_FINDING remains assessment-bound and cannot outlive or become authority independently of its assessment. |
| O41 | Conflict read outcomes are exactly RESOLVED, CONFLICT, INSUFFICIENT_EVIDENCE and cannot create a second truth store. |
| O42 | Graph and Vector acceptance proves derived/projection-only behavior with no write-back or governance authority. |
| O43 | Authority Policy successor cannot authorize its own ADMIT/VALIDATE; bootstrap resolves exactly persisted seeded role_code = GOVERNANCE_ADMIN AND is_system_role = true, and admits/validates only the same first version. |
| O44 | Unknown L14 permission/action/scope tags rejected; legacy wildcard permissions cannot expand the closed vocabulary or typed target scope. |
| O45 | Concurrent duplicate DATA_STEWARD for the same target + role + party rejected while different valid steward parties may coexist; guards do not edit predecessor history. |
| O46 | Existing M15 PostgreSQL regression remains unchanged and green alongside the new M16 security profile. |
| O47 | A deliberately caller/TypeScript-computed WRONG command/fact fingerprint is rejected because PostgreSQL independently recomputes/verifies it. |
| O48 | ACL checker negative controls detect every applicable privilege class: table direct DML; TRUNCATE; REFERENCES/TRIGGER/MAINTAIN where applicable; sequences; routine EXECUTE; writable/updatable views; inherited/default-grant reintroduction. A single generic unsafe-table control is insufficient. |
| O49 | Revoked/superseded Party/Domain/PolicyVersion/ControlVersion dependencies make dependent facts unavailable as current truth without historical-row mutation; own state and all pinned dependencies use the same effective time and recorded cutoff, with correct historical as-of readback and no auto-selected replacement. |
| O50 | Proposal submission, ADMIT, and VALIDATE are distinct: verified active same-tenant member submission cannot create admitted or VALIDATED state or mutate authoritative heads; bounded technical intake preserves source/provenance; ADMIT cannot promote trust or imply VALIDATE. |
| O51 | Authority Policy has exactly one stable identity per organisation, no effective-version overlap/gap after bootstrap, and no autonomous expiry; revocation/replacement requires a validated successor preserving continuity and cannot reopen bootstrap. |
| O52 | password_changed_at cutover/backfill is non-null before commands are enabled; credential changes update it atomically; same-second and older JWT iat values fail the strict iat_seconds > floor(epoch(password_changed_at)) check; a later fresh session may authorize normally. |
| O53 | BusinessDomain/InformationDomain registry states use existing L6 BusinessDomainIdentity/InformationDomainIdentity semantic identities; no parallel domain-id namespace or label-defined identity exists. |
| O54 | DENY is durable/replayable, consumes the command attempt, and creates no governance decision/state; changed eligibility requires a new command_id. DEFER may later terminate in VALIDATE/REJECT; terminal proposal correction requires a new linked proposal; REVOKE intent pins exact target_state_id, permits only REVOKE/REJECT/DEFER, and cannot silently replace state. |
| O55 | Assessment rejects DOES_NOT_APPLY, revoked, or dependency-invalid applicability at effective_from; valid_until IS its effective_to and exceeds effective_from. Omitted effective_from uses the DB transaction instant; explicit past/future values require policy permission without skew tolerance, and authorized explicit fact effective_to is immutable and strictly later than effective_from. |

## 24. Delta-review residual closure and approval boundary

All seven remaining delta-review defect areas are explicitly closed in this
candidate contract. Closure here means a normative decision and acceptance
obligation, not implemented behavior or a new independent review verdict.

| Residual area | Contract closure | Acceptance linkage |
|---|---|---|
| 1. Authority mechanics | First-local-policy-only bootstrap; current role-to-permission/action/source mapping; typed scope grammar; explicit decisions; self-validation fail-closed; transactional eligibility (§§5–9). | O01–O15, O19, O22 |
| 2. Proposal/source/evidence artifacts | Closed support inventory and subject list, typed immutable proposals, dedicated authorization/governance decisions, normalized evidence links, closed source union reusing L0 (§§4, 7–8). | O12, O15, O28 |
| 3. Policy admission | Bounded identity/version commands reuse two existing stores; immutable DB-hashed content; separate POLICY_VERSION validation; exact applicability pin; no direct SQL admission (§13). | O16–O19, O23, O29 |
| 4. Relationship-state/F2 DDL | Reference-only exact triple lookup; no new relationship_state_id uniqueness, no canonical_relationships changes, explicit STOP if F2 mutation is needed (§16). | O35 |
| 5. Per-family keys/cardinality | Five explicit logical keys, single-owner constraints distinct from party-key identity, one domain per semantic kind, exact applicability/assessment heads, database concurrency guards (§§3, 11–17). | O20–O26, O29–O31 |
| 6. Business-context legality/inheritance | Closed two-kind matrix, exact governed domain identity, no implicit inheritance or free-text promotion, UNKNOWN on absence (§12). | O26–O28, O32 |
| 7. Assessment lifecycle/expiry | Exact applicability-state target, five outcomes, mandatory half-open validity interval, immutable renewal/revocation, no transfer to successors, no WAIVED or score authority (§15). | O23–O25, O30–O32, O36 |

### Final materialized-ADR review clarifications

Reported independent review result: **M16 MATERIALIZED ADR REVIEW: PASS**.
**BLOCKER/HIGH: none.** The final clarification delta incorporates the review's
MEDIUM items **M-1, M-2, M-3, M-4, M-5, M-6** before owner approval, together
with the measurable LOW acceptance clarifications **L-1 / L-4**. This records
the supplied review result and the incorporated contract changes; it is not
a new independent review, implementation validation, or owner approval.

The following table traces the supplied clarification topics to normative
sections and acceptance criteria.

| Final clarification topic | Incorporated normative sections | Acceptance linkage |
|---|---|---|
| 1. Proposal / admission / validation separation | Closed admission permissions and ADMIT action; member proposal eligibility, bounded technical intake, non-validated content admission, separate validation (§§4, 6–7, 13). | O43–O44, O50 |
| 2. Bootstrap role / first version | Persisted seeded system GOVERNANCE_ADMIN, same first version ADMIT + VALIDATE only, bounded self-validation exception (§5). | O13–O14, O43 |
| 3. Authority Policy cardinality / continuity | One stable identity, immutable versions, no overlap/autonomous expiry/gap, validated successor at cutover, no successor self-authorization or reopened bootstrap (§§5–6, 17). | O43, O51 |
| 4. Dependency validity | Own state and every pinned governed dependency checked at identical effective/recorded coordinates; invalidation without historical mutation or automatic replacement (§§15, 18.1, 22). | O31–O32, O49, O55 |
| 5. password_changed_at semantics | Future cutover backfill, non-null eligibility, atomic credential timestamp update, strict second-precision iat comparison (§9). | O07, O52 |
| 6. L6 domain identity reuse | Existing BusinessDomainIdentity and InformationDomainIdentity are registry stable identities; no parallel namespace or label identity (§§4, 10, 12). | O53 |
| 7. Party / immutable PII | Restricted immutable party proposal, no arbitrary free-text rationale, closed reason_code + support, mutable/redactable non-authoritative comments outside identity (§§4, 10, 17). | O39 |
| 8. Decision lifecycle | Durable DENY consumes attempt; DEFER non-terminal; terminal corrections require new proposals; exact REVOKE intent without replacement (§§7, 17). | O54 |
| 9. Temporal rules | DB immediate instant on omission; explicit back/future date authorization without skew tolerance; immutable fact ends; assessment end and APPLIES-only validity (§§15, 17). | O25, O31, O55 |
| 10. Cardinality guards | Same fact/head transactional guard for owner/domain non-overlap and duplicate steward exclusion across distinct commands; no predecessor edits (§§11–12, 17). | O22, O26, O45 |
| L-1 / L-4 measurable acceptance gaps | Explicit family/outcome vocabularies, PII/identity boundaries, graph/vector authority ceiling, permission/role checks, unchanged M15 regression, wrong-fingerprint rejection, and per-class ACL negative controls; O01–O37 retain their numbering (§§21, 23). | O38–O55; 55 total criteria |

The frozen CIA baseline and historical coverage/conformance documents remain
unchanged. The roadmap's earlier execution-position update remains unchanged
by this final clarification delta. M16 ADR status remains **PROPOSED /
ARCHITECTURE FREEZE CANDIDATE**. Acceptance, owner approval, and final M16
freeze remain pending. This delta changes
only this ADR: no source, tests, migrations, baseline, database operations,
or real OpenAI calls are part of this documentation delivery.
