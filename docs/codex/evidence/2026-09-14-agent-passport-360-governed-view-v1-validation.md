# Milestone 11 — Agent Passport 360 Governed View V1

Date: 2026-09-14. Verdict: **STOP_REQUIRES_ARCHITECTURE_DECISION**.

This is a pre-implementation gate report, not completed feature validation.
No Passport contract, query, component, migration or application change was made.
The explicit route-identity stop condition in section 25 of the execution request
was reached. Feature acceptance remains unexecuted.

## 1. Base gate and branch

- `git fetch origin`: passed after sandbox escalation (initial failure could not write `.git/FETCH_HEAD`).
- Initial branch: `main`.
- Local HEAD and fetched `origin/main`: `97d68456e8f25e1e388ee0864ae93b7d8025814a`.
- Initial status: only `?? codex-recovery-6101-6240.txt`.
- Created branch: `feat/agent-passport-360-governed-view-v1`, after sandbox escalation for the Git reference write.
- Branch HEAD remains the base SHA; no feature commit, push or PR.
- Protected file was not read, hashed, staged, modified, deleted or copied. `.claude/**` was not inspected.
- No subagents, broad repository audit, live database, provider, LLM or production operation.

## 2. Blocking route identity decision

The current product route means **legacy registry identity**, not canonical AGENT identity:

1. `apps/dashboard/components/agents/AgentTable.tsx:112` links to `/agents/${agent.agent_id}`.
2. `apps/dashboard/app/(dashboard)/agents/[id]/page.tsx:24` fetches `/api/agents/${params.id}`.
3. `apps/dashboard/app/api/agents/[id]/route.ts` calls the legacy agent service using that ID.
4. `apps/dashboard/services/agents.ts` delegates to `getAgentWithOwner`.
5. `apps/dashboard/repositories/agents.ts:29` resolves `agents` using `organisation_id` and `agent_id`.
6. `apps/dashboard/lib/governance/canonical-object-lookup.ts` instead resolves
   `canonical_objects` using organisation, canonical kind and `canonical_object_id`.
7. `supabase/migrations/20260906120000_canonical_materialization_v1.sql:73`
   defines independent canonical identity and its authorizing decision; no legacy agent key.
8. `supabase/migrations/20260909210640_relationship_decision_to_truth_v1.sql:9`
   maps exact source scope, kind and normalized identity to canonical identity.
   These are discovery mappings, not an adapter from `agents.agent_id`.
9. `legacy-object-mapping.ts` addresses historical coarse **discovery source mappings**;
   its name does not imply a bridge from the legacy Agent registry.

Targeted inspection of the Agent route/service/repository/types and canonical mapping
paths did not establish a governed translation from the existing route parameter.
The legacy registration writer also creates only a registry row. Matching name,
agent code, file, UUID equality or newest timestamp would introduce unsupported identity semantics.
No live data was queried; this finding concerns the implemented contract, not a claim
that a particular production row has or lacks a mapping.

Section 25 requires: "If route migration requires ambiguous identity translation:
STOP_REQUIRES_ARCHITECTURE_DECISION rather than guessing."

**Concrete proposed resolution for review:** authorize a canonical entry under
`/agents/canonical/[canonicalObjectId]`, with canonical-only selection inside the
existing Agents product area. Keep existing `/agents/[id]` links explicitly legacy;
perform no automatic cross-identity translation. The Passport root would require
an exact tenant-local canonical AGENT lookup. This route proposal is not implemented
or treated as approved. Alternatively, an approved governed registry-to-canonical
mapping contract is required before a compatibility adapter can be built.

## 3. Architecture A–O mapping (proposed implementation boundary)

Baseline: `GOVIA-L0L16-CIA-v1.0`, frozen and unchanged. Accepted endpoint/mapping
and field/fact-authority ADRs were inspected. No architectural document was edited.

| Dimension | Intended boundary / actual result |
| --- | --- |
| A CIA | Frozen baseline preserved |
| B L0–L16 | Project existing L0/L3/L4/L9/L13/L14 reads; no new knowledge production |
| C Passport | Exactly the frozen 16 families; implementation blocked |
| D Canonical | Read-only identity; route translation requires decision |
| E Lineage | Existing canonical directions only; no inferred Agent access |
| F Evidence | Reuse assertion, evidence and review support; no invented evidence |
| G Authority | Distinguish source trust, mapping and governed decisions |
| H Vector | No retrieval, similarity or authority change |
| I Graph | No GraphOS feature; canonical persistence remains SoR |
| J LLM | No model call or generated fact |
| K Tenancy | Server session organisation, every hydration scoped; not runtime-tested |
| L Migration | None |
| M Continuity | Existing routes and governance implementation unchanged |
| N Non-fabrication | No guessed mapping/version/currentness or populated family |
| O Acceptance | Base gate passed; feature tests and acceptance blocked before implementation |

## 4. Reuse map

| Existing capability | Reuse decision | Scope/qualification |
| --- | --- | --- |
| `canonical-contracts` identity, trust and technical facts | REUSE_AS_IS | Domain vocabulary, not legacy UI types |
| `canonical-object-lookup.ts` | REUSE_WITH_ADAPTER | Exact tenant/kind lookup; existing listing limit is not a complete Passport inventory |
| M7 normalized mappings | REUSE_WITH_ADAPTER | Exact discovery identity and parent context; not legacy registry translation |
| Canonical relationships / `relationship-resolution.ts` | PARTIAL_REUSE | Existing endpoint/temporal rules; Passport read projection still needed |
| AgentVersion technical profile persistence | PARTIAL_REUSE | Typed governed profile and per-field support; dedicated read adapter still needed |
| `technical-fact-persistence.ts` | PARTIAL_REUSE | M10 typed state, decisions, source observations and current policy heads; do not invoke its write methods |
| `workspace-query.ts` | REUSE_WITH_ADAPTER | Tenant-scoped review/evidence/assertion presentation; preserve protected-content policy |
| `getOrgId` server session pattern | REUSE_AS_IS | Reuse trusted server context; no client organisation input |
| Card / Badge / existing dashboard navigation | REUSE_WITH_ADAPTER | Only after route identity is approved |
| Legacy Agent values and compliance rendering | Not Passport authority | Exclude from governed projection |

## 5. Preliminary 16-family readiness matrix

This matrix classifies repository source capability, **not observed tenant data**.
All Passport UI/query delivery is currently blocked by section 2. Feasibility below
is conditional on a canonical entry decision. A supported source does not establish
that any particular Agent has populated facts. Final V1 required-fact sets remain to
be defined in the typed contract before UI implementation.

| # / Family | Available governed source | Grain | Trust source | Temporal source | Evidence/provenance | Readiness / population / feasibility |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Identity | Canonical objects, exact mappings, governed candidate/decision context | AGENT + separately AGENT_VERSION | Object decision vs original assertions | Created/valid-from/decision time | Mapping, candidate and decision IDs | BLOCKED_SOURCE for existing route; canonical projection feasible after decision; no population verified |
| 2 Discovery Metadata | Source assertions, acquisition runs, mappings | Agent/version source scope | Persisted assertion trust | Observed/recorded/run time | Source object, method, evidence | PARTIAL; source metadata does not prove truth authority |
| 3 Ownership & Responsibility | No verified canonical ownership read in inspected paths | AGENT | UNKNOWN | UNKNOWN | Legacy owner is insufficient | FUTURE_MILESTONE (16); UNKNOWN |
| 4 Business Context | No verified canonical business field in inspected paths | AGENT | UNKNOWN | UNKNOWN | Legacy domain is insufficient | FUTURE_MILESTONE (16); UNKNOWN |
| 5 Technology & Build | Governed AgentVersion technical profile | AGENT_VERSION | Per-field assertions, separate materialization authority | Profile revision/materialization time | Profile field assertion/evidence junctions | PARTIAL; framework possible; build/entrypoint detector gaps; null remains UNKNOWN |
| 6 AI Model & Inference | Canonical USES_MODEL + exact MODEL endpoint | AGENT_VERSION | Relationship governance and original source trust | Relationship validity/state | Decision and edge support | PARTIAL; relationship possible; inference configuration not presumed |
| 7 Agent Architecture & Behavior | Version profile fingerprint and governed behavior edges | AGENT_VERSION | Exact supporting assertions/decisions | Version/profile/edge state | Per-field and edge support | PARTIAL; orchestration signals alone are not governed behavior facts |
| 8 Tools / MCP / APIs | Governed USES_TOOL; taxonomy supports other edges | AGENT_VERSION | Edge and source support | Relationship validity/state | Exact endpoints and evidence | PARTIAL; USES_MCP/INVOKES and other blocked correlations remain UNKNOWN |
| 9 Data Assets + Data Elements | Canonical data objects and M10 typed field state, if exactly related | Data object; Agent access is version-scoped | Source DECLARED/IMPORTED separate from field decisions | State predecessor chain, decision/source snapshot | M10 support, policy and decision | PARTIAL source capability; Agent binding blocked, so Agent access UNKNOWN; no tenant-wide data silently attached |
| 10 Privacy & Sensitive Data | No governed privacy field established in inspected sources | Agent/version/data as supported | UNKNOWN | UNKNOWN | Detector hints/legacy flags insufficient | UNKNOWN_BY_DESIGN for this projection |
| 11 Relationships & Lineage | Canonical relationships; M9 DERIVED_FROM when governed and relevant | AGENT_VERSION edges; DATA_ELEMENT lineage | Relationship decision + source assertion | Valid-from/to, recorded state | Edge/lineage observation support | PARTIAL; DERIVED_FROM must not imply READS_FROM/WRITES_TO |
| 12 Governance Controls | Canonical reconciliation and review history | Exact object/relationship subject | Governed review/decision context | Decision and audit time | Existing review/history routes | PARTIAL governance context; policy/control coverage UNKNOWN, enrichment M16 |
| 13 Operation & Runtime | No runtime source established | AGENT_VERSION execution context | UNKNOWN, never static-to-OBSERVED | UNKNOWN | None established | FUTURE_MILESTONE (14); UNKNOWN |
| 14 Provenance & Trust | Assertions, evidence, acquisition and governed review/decision history | Per fact/subject | Canonical five-state vocabulary | Observed/recorded/decision time | Existing safe evidence presentation | IMPLEMENTABLE source capability; actual completeness unverified |
| 15 Capabilities / Permissions / Authorization | No execution authorization source established | Version/principal/action/resource as later modeled | UNKNOWN | UNKNOWN | None established | FUTURE_MILESTONE (13); UNKNOWN; capability is not authorization |
| 16 Connectivity & Network | No governed topology/network source established | Version/execution context | UNKNOWN | UNKNOWN | API declarations alone insufficient | FUTURE_MILESTONE (13); UNKNOWN |

## 6. Passport contract and family status

No executable contract was added after the stop. Required design: stable canonical
Agent root, explicit available/selected AgentVersions, ordered closed 16-section
contract and typed family-specific items. Facts need field identity, value, grain,
original source trust, evidence references, authority and available temporal context.
No arbitrary JSON/EAV or `Record<string, any>` family payloads.

Proposed status semantics: UNKNOWN = no supporting governed fact; PARTIAL = some
support but missing V1 required facts; KNOWN = defined V1 required facts available.
No COMPLETE status. All 16 families must render even with no data. These semantics
are design constraints here, not a tested implementation.

## 7. Agent / AgentVersion semantics

AGENT is logical identity; technical/behavior facts retain AGENT_VERSION grain.
M7 mapping schema contains parent canonical context, with pre-canonical provenance
under the accepted ADR; no VERSION_OF type is introduced. Version enumeration must
verify exact parent identity and fail closed on ambiguity. A version selector may
choose an explicitly requested eligible version. No `max(created_at)`, implicit
latest/current version, fabricated versionCode or candidate ID as business identity.
Parent/version read implementation and tests were not reached.

## 8. Legacy detail-page audit

Classification is relative to Passport authority, not a claim that the legacy
registry has no business value. All displayed domain fields are accounted for below.

| Displayed field | Existing source | Classification / Passport treatment |
| --- | --- | --- |
| Name | `agent.name` | LEGACY_NON_AUTHORITATIVE; no canonical display name assumed |
| Agent code | `agent.agent_code` | LEGACY_NON_AUTHORITATIVE; matching a canonical code is not mapping authority |
| Version | `agent.version` | LEGACY_NON_AUTHORITATIVE; not canonical AgentVersion identity |
| Status badge | `agent.status` | LEGACY_NON_AUTHORITATIVE; not runtime or canonical trust |
| Agent Type | `agent.agent_type` | LEGACY_NON_AUTHORITATIVE |
| Risk Level | `agent.risk_level` | LEGACY_NON_AUTHORITATIVE; governed risk is FUTURE_MILESTONE 17 |
| AI Act Risk Class | `agent.ai_act_risk_class` | LEGACY_NON_AUTHORITATIVE; no canonical assessment established |
| Oversight Level | `agent.oversight_level` | LEGACY_NON_AUTHORITATIVE; no control compliance inferred |
| Model name/provider | `agent.model_name`, `agent.model_provider` | LEGACY_NON_AUTHORITATIVE; canonical USES_MODEL is the reuse source |
| Deployment | `agent.deployment_env` | LEGACY_NON_AUTHORITATIVE; not OBSERVED runtime |
| Owner name | `governance_users` via legacy owner ID | LEGACY_NON_AUTHORITATIVE for canonical Agent ownership |
| Business Domain | `agent.business_domain` | LEGACY_NON_AUTHORITATIVE; enrichment M16 |
| Description | `agent.description` | LEGACY_NON_AUTHORITATIVE |
| Compliance score | Legacy flags/service calculation | LEGACY_NON_AUTHORITATIVE; cannot become Passport compliance |
| Compliance gaps / all-controls-passing message | Legacy service + `CompliancePanel` | LEGACY_NON_AUTHORITATIVE; no gaps is not evidence of compliance |
| CG-AG-001/002/003/007/008/010/012 labels and PASS/FAIL rows | Legacy compliance props / `CONTROL_LABELS` | LEGACY_NON_AUTHORITATIVE; no governed canonical control binding |
| Other compliance entries rendered by dynamic iteration | Legacy compliance object | LEGACY_NON_AUTHORITATIVE; no open-ended Passport promotion |

No existing displayed domain field was demonstrated as GOVERNED_REUSE for the
canonical Agent. Canonical identity, selected version and fact provenance are
NOT_AVAILABLE on the existing page. Design components/navigation are reusable.
Existing page and service behavior were left unchanged after the stop.

## 9. Projection constraints retained for continuation

- Technical profile: read only materialized AgentVersion profile and per-field support;
  optional absent fields stay unknown, and source trust must not be replaced by a blanket label.
- Relationships: exact tenant-local endpoints and directed governed temporal state;
  no candidate promoted just because it appears in review.
- Data/lineage: M9 documents READS_FROM and WRITES_TO as BLOCKED_AGENT_BINDING.
  Only exact relevant governed data context may populate this Agent's Passport.
  DERIVED_FROM between columns is not Agent access evidence.
- M10: `technicalFactPersistence.getReviewContext` selects field state from the
  predecessor chain rather than newest timestamp. Source observations, decisions,
  current policy heads and immutable policy versions are separately readable.
  A dedicated Passport projection remains unimplemented. Never use a competing
  proposal or newer observation as accepted truth; never silently relabel IMPORTED
  or DECLARED as VALIDATED. Historical accepted state remains distinct from current
  source/policy context.
- UNKNOWN is neither false nor none, safe, compliant, low risk or not applicable.
- Trust vocabulary: INFERRED, DECLARED, IMPORTED, OBSERVED, VALIDATED only.
  Confidence is not trust promotion. Persisted decision authority must be shown
  separately where source trust has different semantics.
- Provenance: retain source system/object, method, assertions, safe evidence,
  review/decision references. Do not expose raw protected Prompt contents.
- Temporal context: preserve selected version, effective state, source snapshot,
  observed/recorded times and decision/policy version when available.

## 10. Security and read-only boundaries

Existing governance read examples explicitly constrain organisation. Future Passport
reads must use trusted server/session organisation and scope every object, mapping,
relationship endpoint, assertion, evidence and field-state hydration. No security
claim is made for an unimplemented Passport; tenant tests were not run.

Actual session read-only proof: no application source or migration change; no
database command, reconciliation, review creation, materialization, policy update,
trust transition, runtime capture, provider request or LLM invocation. Git fetched
origin and created the requested local branch. This evidence file is the only
workspace addition from the session. There is no Passport load to exercise yet.

Graph: no projection/query feature; PostgreSQL/Supabase remains canonical SoR.
Vector: no retrieval, embeddings or similarity authority. LLM: no generated facts.
Runtime/authz/network/risk remain at their later milestone boundaries.

## 11. UI, validation and adversarial review

UI result: not implemented; existing Agent navigation and page unchanged.
No claim of 16/16 rendered sections, provenance drill-down or working version selector.

| Check | Result |
| --- | --- |
| Fetch / initial main / exact expected SHA / clean allowed status | PASS |
| Branch creation | PASS |
| Existing-route-to-canonical identity gate | BLOCKED; no implemented exact adapter established |
| Tests 1–48 from execution request | NOT RUN; feature implementation stopped |
| Dashboard typecheck | NOT RUN; no TypeScript change |
| M7/M9/M10 regression suites | NOT RUN; no affected code |
| `git diff --check` | PASS for tracked diff; evidence whitespace also checked directly |
| Frozen architecture / migrations / app changes | None |
| Live database / production validation | Not performed; explicitly out of scope |

The requested A–O implementation adversarial pass was **not performed**, because
there is no Passport implementation to review. The focused identity investigation
above is a prerequisite gate, not a claim that those acceptance cases passed.
Do not treat this preflight as the completed feature review. No second broad audit.

## 12. Delivery and limitations

Only this evidence file was added. It records a preliminary readiness assessment
from targeted repository inspection; it is not a full implementation specification,
a live-data inventory or a substitute for the required tests and adversarial pass.

No feature commit, push or PR was created because the request makes them conditional
on readiness. HEAD is `97d68456e8f25e1e388ee0864ae93b7d8025814a`.
The proposed route decision in section 2 needs explicit resolution before continuation.

MERGE STATUS: **NOT MERGED**.

PRODUCTION STATUS: **UNTOUCHED**.

NEXT MILESTONE: **12 — NOT STARTED**.

VERDICT: **STOP_REQUIRES_ARCHITECTURE_DECISION**.

---

## 13. RECOVERY / CONTINUATION AFTER PREVIOUS STOP

Continuation date: 2026-09-14 (America/Sao_Paulo; validation continued on
2026-09-15 UTC). This section supersedes the earlier checkpoint's delivery
status; sections 1-12 remain intact as the historical report.

### 13.1 Chronology and authorization

The previous checkpoint reported a stop before implementation, with a proposed
canonical route requiring resolution. During recovery, the actual working tree
already contained that route, the Passport contract, read composition, UI and
tests: one tracked M11 edit and eleven untracked M11 files, plus the protected
recovery file. HEAD and origin/main were both
`97d68456e8f25e1e388ee0864ae93b7d8025814a`; no M11 commit existed and the branch
was LOCAL_ONLY. Recovery did not establish when or by whom the intervening
implementation was written. The old checkpoint is therefore a historical
statement, not a description of the recovered working tree.

The user's explicit RECOVERY + CONTINUATION instruction authorized preserving,
validating and completing the recovered `/agents/canonical` and
`/agents/canonical/[canonicalObjectId]` implementation. It resolves the earlier
route-continuation uncertainty for this task. No legacy registry identity is
translated or guessed. No frozen architecture change is required.

Resume gate: expected branch, HEAD and origin/main all matched; tracked diff
initially contained only the Agent inventory navigation change. Initial
`git diff --check` passed. Every recovered M11 file was retained. The additional
package.json change described below fixes the test execution boundary.

M10 is closed: base is PR #31's merge, including feature HEAD
`1745ae342ab2521359243b205990de3556df3477`. No M10 reimplementation.

### 13.2 Contract-first classification

| Component | Classification at continuation | Validated use / adaptation |
| --- | --- | --- |
| Passport typed contract | REUSE_AS_IS | Closed 16 families, discriminated facts, presentation-only coverage |
| Canonical Agent lookup | REUSE_AS_IS | Organisation + AGENT kind + exact canonical ID |
| AgentVersion selection | ADAPT | Existing exact parent mapping; reject empty selector and future-only associations |
| Governed technical profile | REUSE_AS_IS | Selected version's materialized profile, revision, origin and per-field support |
| Governed relationships | ADAPT | Respect effective interval; show scheduled validity end |
| M10 governed field facts | REUSE_AS_IS | Read immutable state predecessor chain, accepted decision, exact mapping and observation |
| Source mappings | ADAPT | Exclude future mappings from effective discovery context |
| Evidence/provenance | REUSE_AS_IS | Metadata-only tenant-local support; absent support shown UNKNOWN |
| Trust | REUSE_AS_IS | Persisted five-state source trust, separate from governance/coverage |
| Temporal UI | ADAPT | Explain historical policy acceptance and consultation-time data state |
| Organisation/session | REUSE_AS_IS | Verified server session, configured secret, no client tenant override |
| Test execution scripts | ADAPT | Separate react-server queries from React DOM SSR fixture tests |
| Prior evidence checkpoint | ADAPT | Append this continuation; preserve previous STOP verbatim |

Direct dependencies examined were the canonical lookup, session verifier,
privileged persistence initialization, M7 mapping contract, governed technical
profile schema, M10 field persistence/schema and accepted endpoint/field ADRs.
No broad repository audit or subagents were used.

### 13.3 Architecture A-O

| Dimension | Final M11 boundary |
| --- | --- |
| A CIA | GOVIA-L0L16-CIA-v1.0 preserved; frozen files unchanged |
| B L0-L16 | Read existing L0/L3/L4/L9/L13/L14 context; no acquisition/enrichment |
| C Passport | Exactly all 16 frozen metadata families; no risk family 17 |
| D Canonical | Existing identity, mapping, profile, relationship and field state; no new store or taxonomy |
| E Lineage | Directed governed relationships; DERIVED_FROM never implies Agent access |
| F Evidence | Tenant-scoped source assertions, evidence metadata, decisions, review references |
| G Authority | Source trust != governed decision != presentation coverage; no trust transition |
| H Vector | No integration or authority |
| I Graph | No integration or write; PostgreSQL/Supabase remains SoR |
| J LLM | No integration, invocation or inferred truth |
| K Tenancy | Session organisation and scoped hydration; no fallback secret |
| L Migration | None; existing schema reused |
| M Continuity | Existing governance workflow links; legacy Agent route unchanged |
| N Non-fabrication | Missing facts, display name, versionCode and current version remain UNKNOWN |
| O Acceptance | 44-case mapping below; 61 focused Passport tests plus 12 M10 regression tests pass |

### 13.4 Passport contract and 16-family matrix

`AgentPassport360` contains a canonical AGENT identity, separate associated
AGENT_VERSION contexts, explicitly selected version, typed families and
provenance. KNOWN/PARTIAL/UNKNOWN are presentation coverage, not TrustState.
Identity KNOWN concerns ID/kind/organisation only, explicitly excluding friendly
name, Agent code and versionCode. No generic JSON/EAV fact bag exists.

This matrix describes conditional read capability, not population in any tenant.

| # | Family | V1 governed source / unavailable context |
| --- | --- | --- |
| 1 | Identity | Canonical AGENT and exactly associated AGENT_VERSION identities; display/code UNKNOWN |
| 2 | Discovery Metadata | Effective exact/coarse source mappings and decision support; missing support UNKNOWN |
| 3 | Ownership & Responsibility | UNKNOWN; no copied legacy ownership |
| 4 | Business Context | UNKNOWN; no copied legacy domain/description |
| 5 | Technology & Build | Selected version profile; absent optional fields UNKNOWN |
| 6 | AI Model & Inference | Selected version USES_MODEL; inference configuration/coverage UNKNOWN |
| 7 | Agent Architecture & Behavior | Selected version fingerprint and governed edges; orchestration/guardrails coverage UNKNOWN |
| 8 | Tools / MCP / APIs | Selected version governed USES_TOOL/USES_MCP/INVOKES; coverage UNKNOWN |
| 9 | Data Assets + Data Elements | Only explicitly accessed governed objects and accepted M10 field states; absent access UNKNOWN |
| 10 | Privacy & Sensitive Data | UNKNOWN; no detector hint promoted |
| 11 | Relationships & Lineage | Governed directed edges and relevant one-hop column lineage; coverage UNKNOWN |
| 12 | Governance Controls | Identity governance decision context only; compliance/control coverage UNKNOWN |
| 13 | Operation & Runtime | UNKNOWN; no runtime facts generated |
| 14 | Provenance & Trust | Per-fact assertions, safe evidence metadata and governance/temporal context |
| 15 | Capabilities / Permissions / Authorization | UNKNOWN; capability never grants permission |
| 16 | Connectivity & Network | UNKNOWN; API declarations never imply connectivity |

All sections render even when empty, with explicit UNKNOWN. Representation
completeness does not mean data population completeness.

### 13.5 Identity, versions and routes

The list reads canonical_objects for kind AGENT under the trusted organisation,
pages through results, and links to canonical detail. Detail reuses the existing
exact canonical lookup; missing, wrong-kind and foreign objects fail closed.
No legacy name/code/UUID matching. The legacy inventory only gains a labeled link.

AgentVersion associations use exact M7 parent context. Conflicting parents are
excluded. A future-only mapping does not expose a version as available. Even one
available version is never selected implicitly; currentVersionId and versionCode
remain unknown. Empty/repeated/unknown/foreign selection fails closed. Switching
versions changes the read view without mutating the fixture store or any truth.

### 13.6 Trust, provenance and temporal context

Source trust is displayed exactly as persisted: INFERRED, DECLARED, IMPORTED,
OBSERVED or VALIDATED. No confidence input selects trust. An identity requires a
governed CREATE_NEW/MATCH_EXISTING decision even if its supporting source claims
VALIDATED. Source OBSERVED remains a source-provenance label; the Passport does
not turn it into an Agent runtime-health assertion. A synthetic runtime-observation
fixture exercises this boundary; no actual runtime source was contacted.

Source connection/object, acquisition method/run, observed/recorded times,
evidence ID/handling/capture time, decision/review context and available revisions
are retained. Evidence envelopes and raw Prompt contents are never selected.
The Passport relies on the existing governed persistence gates for source-trust
validity; it does not implement a new runtime validator or governance engine.

Relationship/mapping effective intervals are checked at consultation time:
future starts do not appear active, ended rows are excluded, scheduled future
ends remain visible with validTo, malformed intervals fail closed. A clock fixed
in the tests makes these checks reproducible. Historical version identity remains
explicit; it is not automatically called the current Agent.

### 13.7 M10 field authority and M9 lineage

M10 accepted field state is selected by the immutable predecessor chain, never
by timestamps. Forks/cycles/disconnected history fail closed. Reads verify the
accepted decision, exact source mapping, source observation/snapshot and durable
support, then display the original DECLARED/IMPORTED source trust. Raw proposals
cannot populate fields without a state. Competing values remain review context
and never replace the accepted value. No authority evaluation/decision command
is invoked from the Passport.

Accepted policy version and active policy head are distinct. Changed or missing
heads display historical acceptance explicitly; old decisions are not asserted
as current authority and do not disappear. This follows the accepted M10 ADR:
policy activation/deactivation does not rewrite accepted field state.

Displayed data fields are governed state at consultation time linked through the
selected version's access, not an as-of-version data snapshot. The UI states this
limitation. A second state-chain read detects concurrent field acceptance but is
not a transaction-wide database snapshot.

M9 scanner READS_FROM/WRITES_TO remain BLOCKED_AGENT_BINDING. Synthetic governed
access fixtures exercise the read contract; they do not claim scanner capability
or tenant population. DERIVED_FROM alone never imports data into an Agent's
Passport. Its direction and governed evidence context remain intact.

### 13.8 Tenancy and read-only boundary

Passport organisation comes from the verified session cookie. Missing secret,
configured development fallback, missing/expired/forged session and missing
organisation fail closed. Query parameters and spoofed organisation headers do
not select the tenant. Every read uses organisation scope; the reader additionally
rejects returned rows from another organisation. Queries are server-only.

No Passport route/query invokes canonical materialization, reconciliation,
review certification, field acceptance, trust updates, source mapping writes,
Graph, Vector or LLM. Existing governance pages are navigational links only.
PostgreSQL/Supabase remains the sole canonical store. No migration was added.

### 13.9 Validation performed in this continuation

Before code changes: recovered query tests 37/37, UI tests 10/10 and dashboard
typecheck passed. Initial Node runs were blocked by sandbox spawn EPERM; approved
reruns passed without code changes. These were environment failures, not product
failures.

One focused adversarial pass found future-effective relations could appear active
and blank version selection was accepted. Both were corrected, with regression
tests. Temporal policy UI was clarified and missing acceptance tests added.

Runner compatibility check exposed a separate harness defect: the dashboard's
react-server condition cannot import react-dom/server. package.json now runs
server suites with that condition and the Passport SSR suite without it. Its
glob includes 36 server test files, excluding exactly passport-ui-route.test.ts;
the complete server suite was not executed. No test was silently removed.

Final focused commands:

```text
# apps/dashboard
npm run test:passport
# 47 query + 14 UI = 61 PASS

node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/passport-query.test.ts tests/technical-fact-persistence.test.ts
# 47 Passport + 12 M10 persistence = 59 PASS (overlaps the command above)

# repository root
npm run typecheck:dashboard -- --incremental false
# PASS
git diff --check
# PASS; staged diff is checked again before commit
```

Total distinct tested cases: **73**, not the sum of repeated executions. Node
prints existing experimental/deprecation warnings for module mocks; no test
failures remain in the focused runs. UI checks render real React components to
static HTML with fixture reads and verify sections, links, selected version,
trust, evidence and temporal labels. No live browser/database validation claimed.

### 13.10 Acceptance matrix coverage

| Required cases | Evidence in focused tests |
| --- | --- |
| 1-5 identity | Exact root; MODEL/TOOL/AGENT_VERSION rejection; missing/legacy/foreign root; separate versions |
| 6-9 versioning | No implicit selection; selected profile; switch/direction/store immutability; missing/ambiguous/empty/foreign version |
| 10-13 families | 16 ordered contract families and rendered sections; UNKNOWN empty slots; no FALSE or risk family 17 |
| 14-18 trust | Five persisted trust labels; unknown trust rejected; unreviewed VALIDATED support fails; runtime fixture stays source context; confidence ignored |
| 19-21 provenance/time | Source/method/evidence/decision times; SSR support presentation; temporal interval and version tests |
| 22-24 M10 | Accepted predecessor-chain head; raw proposals excluded; changed/missing policy head remains historical context |
| 25-28 relationships | Selected version/directed tuple; DERIVED_FROM never grants access; absent bindings remain UNKNOWN |
| 29-36 boundaries | Read-only mock store and dependency checks; no raw proposals, runtime, IAM or legacy ownership/business/compliance promotion |
| 37-40 tenancy | All read filters; signed/forged/expired cookies; no fallback; foreign target/edge/field/decision/mapping/evidence scenarios |
| 41-44 UI | Canonical list link; selected detail render; mixed 16-family render; value/trust/provenance/historical policy separation |

### 13.11 Single adversarial pass A-O

| Case | Result |
| --- | --- |
| A Raw discovery as truth | No path; canonical decisions and accepted field state required |
| B Latest/current version | No implicit selection; blank selector defect fixed |
| C Cross-tenant read | Scoped queries and negative fixtures pass |
| D Wrong root kind | Fail closed |
| E UNKNOWN as false | Explicit empty states; no false/default enrichment |
| F IMPORTED to VALIDATED | Original source trust preserved |
| G Confidence to trust | No confidence-based transition |
| H M10 bypass | Accepted state/decision/mapping/support required; no decision invocation |
| I Lineage as access | DERIVED_FROM-only fixture yields no Agent data access |
| J Runtime fabrication | Runtime family remains UNKNOWN |
| K Ownership/business/control fabrication | UNKNOWN; identity decision is labeled governance context only |
| L Graph/Vector/LLM authority | No integrations |
| M Secret/evidence leakage | Explicit metadata projections; no raw envelopes; session secret stays server-side |
| N Reads causing writes | Read-only fixture store and source boundary checks pass |
| O Stale state as current | Future interval defect fixed; selected version and historical acceptance policy explicit |

Exactly one focused pass was performed; subsequent tests validate its fixes and
the test runner correction, not a second broad audit.

### 13.12 Final implementation status and limitations

The recovered implementation is retained and ready for external review after the
focused corrections. The prior STOP remains above as history. This continuation
authorizes one feature commit and a PR against main; merge is not authorized.

Known limitations: many families intentionally UNKNOWN; no governed display
name/versionCode/current-version semantics; no historical as-of Passport; no
transaction-wide read snapshot; explicit source support may be unavailable and is
then UNKNOWN; metadata-only evidence; sequential hydrated reads may need later
performance work at enterprise scale. Live data, browser layout, full regression
suites and production behavior were not validated. No M12/M13/M14/M16 work.

Protected recovery file was not read, hashed, staged, modified, deleted or copied.
`.claude/**` was not inspected. No live Supabase, production, provider or external
model API was used. Frozen architecture and historical migrations are unchanged.

MERGE STATUS: **NOT MERGED**.

PRODUCTION STATUS: **UNTOUCHED**.

NEXT MILESTONE: **12 - NOT STARTED**.

CONTINUATION VERDICT: **AGENT_PASSPORT_360_GOVERNED_VIEW_V1_READY_FOR_REVIEW**.
