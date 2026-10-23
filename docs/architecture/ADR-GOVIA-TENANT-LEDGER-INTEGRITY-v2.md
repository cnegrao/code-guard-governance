# ADR — Tenant ledger integrity V2

Date: 2026-10-20, America/Sao_Paulo. Slice: **M17.5-V1-S1A0**.
Status: **ACCEPTED ARCHITECTURE ONLY — IMPLEMENTATION NOT AUTHORIZED BY THIS ADR**.
Repository: `cnegrao/code-guard-governance`.
Source baseline: `c377b48f3cf4d7976538c63d1b80878ff485719f`.

This additive decision resolves the chain-model blocker in the
[S1A STOP report](../codex/evidence/2026-10-20-m17.5-v1-s1a-lx08-audit-containment.md).
The [V1-S0 ADR](ADR-GOVIA-TRUST-ASSURANCE-HUB-v1.md),
[read contract](../trust-assurance/v1-hub-read-contract.md) and its
[JSON](../trust-assurance/v1-hub-read-contract.json), and V0/E1 history are unchanged.
R-AUDIT remains UNSAFE_FOR_V1; LX08 remains NEEDS_CONTAINMENT.
S1A is STOPPED / ARCHITECTURE RESOLVED / IMPLEMENTATION NOT RESUMED.
All readiness HOLDs and M18 HOLD remain. No Hub implementation is granted.

## 1. Re-derived current model and exact source locators

Locators below pin source, not a hosted catalog or production population.
The prefix is
`https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/`.

| Source relative to that prefix | Evidence |
|---|---|
| [identity/ledger migration, L94](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/supabase/migrations/20260818003710_gov_repo_identity_and_ledger.sql#L94) | `gov_repo.governance_ledger`; `entry_sequence` bigserial global primary key; `entry_id` UUID default; organisation UUID NOT NULL without an organisation FK on this table |
| [same migration, L118](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/supabase/migrations/20260818003710_gov_repo_identity_and_ledger.sql#L118) | indexes on subject, organisation/time, actor, event type and entry UUID; the UUID index is not UNIQUE; immutable-core/no-delete rules, RLS and service-role full-access policy |
| [same migration, L128](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/supabase/migrations/20260818003710_gov_repo_identity_and_ledger.sql#L128) | `ledger_append(varchar,text,varchar,uuid,uuid,inet,uuid,jsonb) RETURNS bigint`, SECURITY DEFINER; global tail selected at L132 |
| [same migration, L142](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/supabase/migrations/20260818003710_gov_repo_identity_and_ledger.sql#L142) | `ledger_verify(bigint,bigint)` SECURITY DEFINER; global sequence range; no tenant or principal argument/check |
| [R1 privilege migration, L194](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/supabase/migrations/20260930160000_m16_s1b2r1_definer_capability_surface_v1.sql#L194) | ledger executor exact column SELECT/INSERT, sequence USAGE, column UPDATE for row lock; global executor policies |
| [same R1 migration, L287](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/supabase/migrations/20260930160000_m16_s1b2r1_definer_capability_surface_v1.sql#L287) | PUBLIC/anon/authenticated/service_role EXECUTE revoked then service_role granted; L321 crypto-schema search path pin; L335 owner `govia_ledger_executor` |
| [service-role access migration, L1](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/supabase/migrations/20260818013113_grant_service_role_gov_repo_access.sql#L1) | historical broad service-role table/sequence access; new tables must explicitly revoke inherited/default application privileges |
| [audit repository, L149](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/apps/dashboard/repositories/audit.ts#L149) | `getIntegrity`: tenant metrics plus global `ledger_verify(1,NULL)`; missing row → false; `getEvents`/`getEventById` direct service reads |
| [database clients, L1](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/apps/dashboard/lib/db.ts#L1) | service-role `db.write`, anonymous compatibility `db.read`, gov_repo schema |
| [discovery writer, L24](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/apps/dashboard/app/api/discovery/scan/route.ts#L24) | `logToLedger` calls legacy append; errors are not made a reliable audit-completeness signal |
| [talk writer, L14](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/apps/dashboard/services/talk.ts#L14) | second active dashboard append caller, `logToLedger` |
| [sidebar, L17](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/apps/dashboard/components/layout/Sidebar.tsx#L17) | `/audit` → `app/(dashboard)/audit/page.tsx` → `/api/audit/integrity` and `/api/audit/events`; detail `/audit/[id]` → `/api/audit/events/[id]` |
| [principal basis, L871](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/supabase/migrations/20260929120000_m16_s1a_l14_authority_policy_v1.sql#L871) | `l14_session_basis_v1` revalidates actor/org/session freshness through stored eligibility; mismatch → GV003 |
| [M16 principal read, L240](https://github.com/cnegrao/code-guard-governance/blob/c377b48f3cf4d7976538c63d1b80878ff485719f/supabase/migrations/20261012120000_m16_read_projection_closure_v1.sql#L240) | existing principal-bound read convention, five verified session fields, pinned search_path, no JWT role/email authority |

Historical extension SQL under `apps/extension/supabase/migrations/` is a separate,
noncanonical legacy root. M008E wraps append through `log_agent_event`; canonical
R1 quarantines that callable surface. Do not activate or edit it. Canonical
migration searches find one append/verify body, followed by owner/configuration
changes and digest assertions. No existing tenant chain is present.

Chain classification: **GLOBAL_INTERLEAVED**, not tenant-local.

**Legacy hash input:** SHA-256 of unframed concatenation
`previous_hash || event_type || subject_id::text || actor_user_id::text || recorded_at::text || payload::text`.
`organisation_id` is stored on the row but not hashed; neither sequence nor
entry UUID is hashed. Description, subject type, event timestamp, IP/session and
QES metadata are also outside this expression. The schema comment says GENESIS,
but the executable genesis is SHA-256(`CODEGUARD-GENESIS-2026`). Text casts do not
define a portable, versioned serialization. No stronger historical claim follows.

**Legacy concurrency:** global descending tail row lock with `FOR UPDATE SKIP
LOCKED`, no stable head row or empty-table lock. The comment asks callers for
SERIALIZABLE transactions; the function does not establish that isolation.
Concurrent calls can skip a locked tip or see an empty ledger simultaneously;
a global bigserial orders allocated IDs, not commit order. The current body is
not proof of concurrency-safe linear append. This is a source-derived risk,
not a claim that deployed history contains a fork.

| Global sequence | Org | Stored predecessor |
|---|---|---|
| 1 | ORG_A / A1 | global genesis G |
| 2 | ORG_B / B1 | hash(A1) |
| 3 | ORG_A / A2 | hash(B1) |

A filtered ORG_A walk compares A2.previous_hash = hash(B1) to hash(A1), incorrectly
calling an intact global history broken. Reading B1 to bridge the link crosses
the tenant boundary. Ignoring the link tests row digests, not a tenant chain.

## 2. Options and selection

| Option | Security / history | Operations / concurrency / usability | Decision |
|---|---|---|---|
| A — global only, internal verification | Preserves history; no tenant result if global status and global identities stay internal. Tenant result would couple organisations and expose a side channel. | Smallest interim quarantine; tenant cannot inspect a tenant chain. Global writes remain serialized if linearity is required. | Safe interim behavior only; insufficient long-term tenant integrity. |
| B — replace global chain | Rehashing original rows fabricates history and loses forensic references. Starting a replacement without rewriting avoids that loss but ends global continuity. | Breaks legacy callers/anchors or needs complex compatibility; still needs per-tenant locking. | Reject replacement of existing history; no rewrite/backfill. |
| C — dual-chain V2, synchronous | Original global bytes preserved; new tenant hashes independent of global hashes. Old evidence never acquires tenant proof. | Extra hashes, heads and capture checks; atomic dual write prevents partial success. A synchronous global chain retains a global write bottleneck. | **SELECTED**, with normalized tenant sidecar tables. |
| D — independent tenant ledger/anchor | Clean separate storage/history; can use per-tenant locks without global coupling if global ledger freezes or is asynchronous. Async links require explicit delivery/reconciliation semantics. | Better independent write throughput; adds reconciliation/failure windows or abandons continued synchronous global history. | Do not select independent/asynchronous writes for this minimum path. Use its separate-storage form to realize C atomically. |

Choice: **DUAL-CHAIN V2 IN SEPARATE INTEGRITY TABLES**. Keep the original table's
historical rows and global hash algorithm; add normalized tenant entries,
tenant heads, a version/cutover record and a global append-head guard.
Do not add nullable V2 columns to historical rows: the existing immutable rule
does not cover those columns or organisation changes, and nullable columns
would blur original versus post-cutover evidence. Separate tables make that
boundary explicit and allow exact new privileges and uniqueness rules.

The owner preference is accepted with a material cost: global append order
must be serialized. Per-tenant locks isolate tenant state but cannot remove
that cost while a synchronous, single global chain is retained. Future async
global anchoring/retirement is a new decision, not a hidden optimization here.

## 3. Historical semantics and cutover

Use **one global atomic cutover**, identified by an immutable activation UUID,
schema/migration version, hash/serialization version, recorded UTC activation
instant, and internal last legacy global sequence/hash. A migration ID alone
is not the activation instant. Hosted activation needs separate authorization.
Drain writers and install all append/capture/privilege changes in one guarded
transaction. The global append guard prevents old in-flight appends straddling
the boundary; new appends start only after activation commits. Abort activation
if an unclosed writer or direct DML route exists. No partial tenant rollout.

Global sequence > the captured legacy high-watermark identifies new source rows
internally. Seed the guard from the existing global tip without altering it or
asserting it is valid. Pre-existing global failures remain platform findings;
successful tenant verification must not require a valid legacy global tip.

Each tenant gets an independently random `chain_id` and immutable genesis record,
created lazily on first post-cutover append under the tenant uniqueness lock.
The activation is global even though tenant first-entry instants differ.
Genesis binds tenant UUID, chain UUID, activation UUID, activated_at and versions.
**Do not bind genesis to a global hash or global sequence.** Those remain private
platform provenance, never tenant cryptographic dependencies or output fields.
The first tenant entry is sequence 1 with previous hash equal to its genesis.
Auditor answer: activation instant/version, that tenant's first entry recorded
instant and current verified-through sequence. Empty tenants have activation
metadata but no claimed first-entry instant.

Pre-cutover rows are **LEGACY_GLOBAL_ONLY** forever under this design. Even an
internally passing global verification cannot make them tenant VALID.
No historical reconstruction is authorized. If separately considered later,
reconstruction must be DERIVED/RECONSTRUCTED with its own creation time,
provenance and limitations; it cannot replace original tenant-chain evidence.

## 4. Proposed technical model — no DDL in this slice

Names are reserved design identities; signatures are described below, not SQL.

| Structure | Identity, state and constraints |
|---|---|
| `ledger_integrity_epochs_v2` | Immutable activation UUID PK, algorithm SHA-256, serialization version, migration identifier, activated_at and private legacy high-watermark/hash; one active initial epoch. No rewriting activation or algorithms in place. |
| `ledger_global_append_head_v2` | Singleton internal row: last global sequence/hash; transaction lock target; initialized under the cutover guard. Mutable technical cache checked against committed inserts, never a tenant input. |
| `ledger_tenant_genesis_v2` | PK `(organisation_id, chain_id)`; UNIQUE organisation for this initial epoch; FK organisation/epoch; genesis hash, immutable activation/version fields and first-entry recorded_at. New tenants use the same activation. |
| `ledger_tenant_heads_v2` | PK `(organisation_id, chain_id)`; FK genesis; tenant last sequence/hash, committed count; mutable cache updated only by the capture path. Persisted independently of a verifier's scan to detect lost suffixes. |
| `ledger_tenant_entries_v2` | PK `(organisation_id, chain_id, tenant_sequence)`; positive bigint order from locked tenant head, no bigserial; tenant-local entry UUID UNIQUE within org, source global sequence UNIQUE internal reference, source entry UUID, version, previous/current tenant hash, immutable captured event fields or their canonical digest and recorded timestamp. Composite org/source FK with additive UNIQUE `(organisation_id, entry_sequence)` on the source; no cross-org link. |
| `ledger_tenant_legacy_refs_v2` | Opaque random UUID PK with org/source composite reference and UNIQUE source sequence; identity mapping for retained legacy rows only, not hashes or reconstructed evidence. Initialized under activation to support tenant-safe legacy detail without exposing global order. |

The source UUID is not assumed unique because legacy schema does not enforce it;
the internal source-sequence FK is authoritative for locating the row, and the
source UUID is included in the tenant hash. Do not impose a global historical
UUID uniqueness constraint that could reject existing data. The tenant-local
UUID is a separate generated identity for API/detail addressing.

Indexes: tenant PKs serve chain walks/head lookups; UNIQUE source reference closes
double capture; composite source identity closes org reassignment; tenant-local
UUID index serves exact detail; `(organisation_id, recorded_at, tenant_sequence)`
serves tenant browsing. No cross-tenant search or generic aggregate endpoint.
Legacy ref indexes serve only own-org opaque detail and source lookup; source
order may be used internally for legacy paging but only opaque random handles
leave the DB. Do not return encoded global sequences as cursors.
All new technical tables have RLS, explicit application privilege revokes and
no generic table access. The scoped RPC is the only tenant access boundary.

Post-cutover source fields cryptographically covered: organisation, tenant entry
UUID, source entry UUID, event type/description, subject type/ID, actor user/IP/
session (nullable distinguished), event_timestamp, recorded_at and full payload.
The chain also covers tenant sequence, chain/epoch identity and versions.
Exclude source global sequence/hash/predecessor and mutable QES anchor metadata.
QES evidence is independently labeled, not silently incorporated into V2 claims.
All covered source/tenant/genesis inputs become immutable through additive
guards, including organisation and fields omitted by the legacy immutable rule.
Only the technical head caches advance; corrections are new events. No delete,
rehash, restatement in place, chain restart or "repair to VALID". Revocation of
access is independent of integrity. Future key/algorithm change requires an
explicit new version/epoch contract and retained prior results.

## 5. Hash domain and canonical bytes

Legacy global remains its existing unprefixed V1 algorithm. Do not relabel or
recompute it as `GOVIA_LEDGER_GLOBAL_V1`. Domain-separated tenant genesis uses
`GOVIA_LEDGER_TENANT_GENESIS_V2`; tenant entries use
`GOVIA_LEDGER_TENANT_V2`. Both domains and version numbers are part of the hash
preimage. Hashes are SHA-256 of framed UTF-8/binary inputs, represented in storage
as fixed 32 bytes (hex only at authorized presentation boundaries).

Freeze serialization version 1 as a length-framed, typed encoding: field order
fixed by this ADR's tenant identity/order/versions, predecessor and event fields;
each value has a distinct type tag and unsigned 64-bit big-endian byte length.
UUIDs are 16-byte values; integers use signed decimal ASCII with no leading
zeros; timestamps are integer UTC microseconds since Unix epoch; null has a
distinct tag from empty values. Strings are UTF-8 without Unicode normalization.
JSON objects sort keys by unsigned UTF-8 bytes; arrays retain order; booleans and
null have distinct tags. JSON numbers use exact finite decimal normalization
(no exponent, no insignificant fractional zeros, negative zero becomes zero),
not binary floating conversion. Objects/arrays recursively frame member counts
and key/value elements; no delimiter-concatenation ambiguity. Previous hashes
are raw 32 bytes. No locale, timezone, `jsonb::text`, server-version text casts,
or ambiguous null concatenation in new hashes.

Implementation must freeze a numbered field-order specification and golden
vectors for every scalar, nesting, Unicode, large/negative/fractional number,
null and timestamp case before enabling writes; it cannot change serialization
under version 1. Unsupported encodings reject the append atomically. This is a
design requirement, not an implemented serializer or a cryptographic attestation.

Entry preimage field order is: domain, algorithm version, serialization version,
organisation UUID, chain UUID, activation UUID, tenant sequence, tenant entry UUID,
previous tenant hash, source entry UUID, event type, description, subject type,
subject UUID, actor UUID, actor IP, actor session UUID, event_timestamp,
recorded_at, payload. Genesis order is: genesis domain, algorithm version,
serialization version, organisation UUID, chain UUID, activation UUID, activated_at.
IP encoding uses the address-family tag, network-address bytes and prefix length;
JSON container elements include their count before framed members. These orders
are frozen; golden vectors operationalize them without selecting a new format.
Event time may be supplied event metadata; recorded_at is DB-authored at append.
Neither timestamp defines chain order or proves external occurrence time.

## 6. Atomic append, locking and completeness

One DB transaction owns each append. Lock order is eligibility basis → global
head → that tenant's head. Multi-entry transactions acquire tenant locks in
sorted organisation order after the global guard. Acquire no tenant write lock
from verification. Use blocking row locks with bounded timeout; no SKIP LOCKED.
The uniquely constrained genesis/head creation arbitrates first-append races;
losers wait/re-read the committed head rather than choosing genesis again.

The future principal-bound append wrapper fixes org and actor to the verified
principal, invokes the internal append with the stable global guard, and creates
the original global row. An AFTER INSERT capture trigger, SECURITY INVOKER in
the internal writer's context, writes exactly one tenant entry and advances
that tenant head. Both global and tenant heads advance in the same transaction.
Trigger/serializer/head failure rolls back all rows and head updates. A deferred
coverage constraint/check plus role restrictions must reject missing/double
capture; disabling the trigger is not an application capability.

The legacy append body may be replaced **only through a new additive migration**
to use the stable global head and remove SKIP LOCKED, preserving its historical
hash format/signature/global return identity. Revoke application EXECUTE on
that internal primitive and direct ledger INSERT/UPDATE/DELETE/TRUNCATE; adapt
the two active dashboard writers to the new principal-bound wrapper. Old direct
service-role writes are not an accepted compatibility fallback. Existing source
rows and foreign references retain identity. Catalog body/privilege fingerprints
must be versioned in new tests/migration assertions, never patched retroactively.

Same-tenant append: one predecessor/head at a time; successful committed tenant
sequences are contiguous. A rollback consumes no tenant sequence. Global serial
allocation may have gaps; no tenant result relies on global gaplessness.
Different tenants: tenant head locks are disjoint, but the global writer still
serializes all commits using this append path. This unavoidable shared resource
can affect latency/availability; it must not affect the value of a tenant
verification result. An ORG_B corrupt row never enters ORG_A's verifier.
Retry serialization/deadlock/lock-timeout failures at the transaction boundary
with bounded policy; never skip predecessors or downgrade to global-only writes.

See PostgreSQL 17 [row locking](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS)
and [transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html):
locks last to transaction end; sequence allocation is not a transactional counter.
Those mechanics motivate the design, not proof that it has been implemented.

Verification acquires epoch/genesis/head/entries and own source rows in **one
SQL statement snapshot**, after the established session-basis check. A VOLATILE
principal boundary may perform eligibility locking first; all integrity data
and aggregate counts must then use one statement, not separate RPCs or separate
PL/pgSQL reads with assumed matching snapshots. No client-supplied time/range
in the initial API: full current V2 chain from genesis through captured tenant
head only. Bound scan work explicitly; if not fully scanned, return UNKNOWN.
Any future pagination must bind a single snapshot, never yield a green prefix.

Check every own post-cutover source row has exactly one matching tenant entry,
every tenant reference resolves to an own source row, canonical captured inputs
match source, sequence/predecessor/digest match, and final count/hash match the
captured head. Missing source after a known committed capture or an observed
sequence/coverage/head mismatch is a specific integrity inconsistency, BROKEN.
A query/dependency failure or uncertain acquisition is UNKNOWN, not evidence of
tampering. Head/genesis metadata unexpectedly absent is UNKNOWN unless a complete
snapshot establishes a concrete contradictory committed state.

Scope is **retained committed ledger records**, not all real-world events or
all governance activity. Existing logging wrappers can omit events; they must
check RPC errors, but a valid chain cannot prove that producers logged every
action. Unkeyed hashes cannot defeat an administrator rewriting the entire chain
and its trusted head/genesis together. External timestamp/checkpoint attestation
is outside this minimum slice; never call the result tamper-proof or certified.

## 7. Principal-bound tenant read and privilege contract

Use `requireVerifiedGovernancePrincipal` → existing principal transport fields
(org, actor, issued-at, expiry, credential epoch) → `l14_session_basis_v1` at DB.
The helper checks persisted membership/eligibility/freshness; org is derived from
that basis. Reject any separate requested org differing from it **before**
reading tenant existence. Reject absent/expired/stale/disabled principals even
with service_role transport. Do not invent a JWT role/email or org-only model.
The existing trusted backend verifies the signed session; DB revalidation of
forwarded fields is not independent token-signature verification. A compromised
trusted backend/DB owner remains outside that existing trust boundary.

Future public RPC identities: `ledger_append_v2`, `ledger_tenant_verify_v2`,
`ledger_tenant_events_v2`, `ledger_tenant_event_v2`. Each receives the five
verified session fields. Append also receives event content but never an
authoritative actor/org override; verify has no arbitrary range; events has
bounded literal filters and tenant-local cursor; detail uses an opaque own
entry identity. Public tenant RPCs do not return global sequence/hash/predecessor,
other-org existence, global totals, global break reasons or platform job state.
Legacy detail uses an opaque org-bound handle, not guessable global sequence.
Unauthorized and nonexistent foreign identities have indistinguishable denial/
not-found envelopes. Error messages/logs delivered to tenants are sanitized.
No guarantee of eliminating shared-infrastructure timing channels is implied;
no business identifier, entry-count or integrity-status oracle is exposed.

Follow existing M16 principal SECURITY DEFINER ownership convention (`postgres`
for these thin checked boundaries), search_path `pg_catalog, pg_temp`, exact
qualified names and explicit EXECUTE revoke from PUBLIC/anon/authenticated.
Grant service_role EXECUTE on those four only as backend transport; principal
check is unconditional. Internal append remains owned by
`govia_ledger_executor` with only exact ledger/sidecar/head capabilities and
no policy-store authority. Legacy global verify remains its existing owner,
but service_role loses its generic EXECUTE; platform operators use the existing
administrative boundary, never a tenant-callable replacement.

Planned SECURITY DEFINER count delta **+4**: the four named principal RPCs.
Existing append/verify keep their definer identities; serializer/capture/guards
are invoker helpers, no additional public capability. Implementation inventory
must reconcile exact signatures, owner, helper access, search_path, default ACLs,
RLS policies and column privileges on PostgreSQL 17. If more definers are needed,
explain the delta before closure. No broad new grants, generic SELECT, new
Authority Policy permission or internal resolver EXECUTE for application roles.

## 8. Verification result and Audit transition

Closed V2 status: **VALID | BROKEN | EMPTY | UNKNOWN**.
Separate history axis: **LEGACY_GLOBAL_ONLY | NO_LEGACY_ENTRIES | UNKNOWN**.
Separate acquisition/request errors are not coerced into either vocabulary.

| Status | Exact meaning |
|---|---|
| VALID | Complete authorized tenant V2 population, source correspondence, genesis, sequence/digests and captured head verified in one snapshot. Strictly post-cutover retained-record integrity only. |
| BROKEN | Verification executed and identified a specific V2 cryptographic, identity, coverage or chain/head inconsistency. Include only tenant-local failure category/sequence. |
| EMPTY | Authorization succeeded, activation/dependency completeness established, and no V2 entries exist for this tenant. No positive assurance. No tenant head before first append is expected only when own V2 source population is proven empty. |
| UNKNOWN | Missing/malformed RPC row; unavailable dependency; unsupported version; absent activation; incomplete scan/snapshot; unverifiable head; acquisition failure. Neither VALID nor BROKEN is established. |

Envelope binds principal org, chain/version/activation, current snapshot scope,
V2 status, checked entries (absent when unknown), verified-through tenant sequence
only on complete verification, history axis and fixed limitations. No percentages
or compliance score. No last-verified timestamp merely because a request ran.
Authorization failure is HTTP 401/403 or equivalent sanitized DB error, without
an integrity status; inaccessible dependencies are request failure/UNKNOWN.
Infrastructure errors may become 503 with a typed unavailable projection, never
BROKEN. Missing result must not be read as zero rows/EMPTY or boolean false.

| Tenant scenario | Future S1A1 presentation |
|---|---|
| V2 entries valid, legacy present or absent | “V2 ledger integrity verified”, explicit activation/verified-through scope; legacy rows remain labeled separately |
| No V2 or legacy entries | “No V2 entries to verify” / EMPTY, no green badge |
| Legacy-only history | EMPTY V2 + LEGACY_GLOBAL_ONLY: “Historical records use a global chain; tenant-chain verification began at [activation]” |
| V2 broken | “V2 ledger integrity issue” / BROKEN with own bounded diagnostic |
| Verification unavailable/missing | UNKNOWN/unavailable, no positive or broken fallback |
| Unauthorized organisation | Denied request, no tenant metadata or integrity state |

S1A1 must replace `/audit` integrity, event-list and detail query paths together
with principal-bound RPC consumption. Remove boolean and global verifier
fallbacks, global sequences and global hashes from tenant-facing rows/links.
Preserve opaque access to own legacy records with LEGACY_GLOBAL_ONLY and
LEGACY_NON_AUTHORITATIVE payload limitations. Raw payloads cannot generate claims.
Use “ledger integrity”, never governance correctness, compliance, control
effectiveness, verified human oversight or certification. Until implementation
passes, current UI remains unsafe; this ADR changes no navigation/exposure.

## 9. Global future and authority boundary

Global history remains supported **internal platform forensic evidence**,
dual-written synchronously after cutover with improved append serialization;
not frozen, not retired, not silently rehashed. Historical failures and V1
serialization limits remain visible internally. Tenant status never consumes
global verification, even if the global chain fails while tenant V2 passes.
Global integrity administration has no ordinary tenant API, UI, export, shared
cache or fallback path. No new platform verification audience/permission is
created; use established administrative controls, and do not expose a new
operator endpoint as part of S1A1.

Technical integrity metadata is not canonical governance truth, an L14/L15 fact
family, CanonicalObjectKind, relationship, Passport family, business
accountability, compliance, control-effectiveness evidence, human oversight
truth or certification. Frozen 11 kinds, 12 edges, 16 Passport families and all
authoritative fact families stay unchanged. Legacy oversight/default payloads
remain **LEGACY_NON_AUTHORITATIVE**, including inside a VALID V2 chain.

## 10. Migration phases, failure boundaries and resumed scope

These are a plan for **separately authorized S1A1**, not executable instructions
for this documentation slice. Historical migrations are immutable.

1. **Local compatibility inventory and additive preparation.** Re-prove all
   writers/consumers, active ACLs and body fingerprints on disposable PostgreSQL
   17. Add new technical schema/version metadata and new inactive RPCs through
   CLI-generated additive migration(s); explicit revoke/RLS before exposure.
   No runtime path uses inactive V2. No hash backfill or historical reconstruction;
   only the technical legacy identity map is populated for retained old rows.
2. **Atomic activation package.** Drain writers; guard legacy ledger; create the
   epoch/high-watermark, stable global head, tenant capture and full immutability
   coverage, and replace only the append body through additive migration.
   Revoke legacy application EXECUTE and direct application ledger DML. New
   principal append/list/detail/verify boundaries must be ready as one candidate.
   Activation failure rolls back the complete DB transaction. No dual-write gap.
3. **Writer switch and proof.** Adapt `app/api/discovery/scan/route.ts` and
   `services/talk.ts` plus its `app/api/talk-to-governance/route.ts` principal
   plumbing to the new append wrapper; inspect returned RPC errors. Preserve
   product semantics and payload authority labels; no Talk/discovery redesign.
   An old app release fails append rather than falling back. Deploying the
   atomic app/DB cutover would require separate explicit hosted authorization.
4. **Tenant read verification and UI switch.** Implement one-snapshot verifier,
   principal RPC projections and typed application contracts; switch all active
   `/audit` APIs/pages and opaque detail addressing. No direct-table/global
   fallback; no exposed global row IDs/hash links. Cache by org/principal/scope
   or avoid caching. Current-only proof; do not add as-of claims or Hub APIs.
5. **Quarantine and closure.** Prove legacy global verifier is internal; audit
   privileges, known consumers and all acceptance rows below. Adjust new
   catalog assertions without editing historical tests/migrations. LX08 changes
   status only if all S1A1 security gates pass. Other gates remain unchanged.

After the first V2 append commits, rollback is **forward-only**: preserve all
epoch/entries/heads, deny new writes or keep atomic dual writes, and fail-close
the Audit UI. Never drop V2 tables, roll back to global-only append, reset genesis
or claim post-cutover gaps as EMPTY. Partial app rollout yields denied/unavailable
responses, not legacy fallback. If any untracked external writer or unavoidable
dependency is discovered during implementation, STOP before activation and
report it. Repository source proves the proposed path, not hosted rollout safety.

Resumed S1A1 includes only additive migrations and helper/RPC/append changes above,
the two writer adapters needed for complete capture, Audit store/query/API/UI
transformation, focused PostgreSQL 17/security/application tests and privilege
inventory. No new Hub, tenant assurance projection, S1B, M18, Normative
Intelligence, historical reconstruction or unrelated legacy correction.

## 11. Future acceptance test matrix

These are required future tests, not executed S1A0 evidence. Use real PostgreSQL
17 for security, concurrency, snapshot and hash behavior; focused app tests for
principal plumbing, query use and UI mapping. Run selected checks once per
relevant candidate; no unrelated full-regression loop.

| ID | Fixture / action | Required result |
|---|---|---|
| A | ORG_A principal, interleaved new A/B source appends | A V2 VALID with only A entries/head/source affecting result |
| B | ORG_B principal on same fixture | B V2 VALID with its own genesis/head/order |
| C | Owner-only fixture tampers A payload/tenant hash/tenant link/org binding, deletes middle/tail or breaks coverage | A BROKEN with specific evidence; B unchanged; ordinary roles cannot perform tamper |
| D | Same tamper set on B | A result and tenant response byte content unchanged apart from request-local timing; B affected |
| E | A principal requests B, guesses B opaque ID, changes actor/session claims | Denied before lookup or indistinguishable own-not-found; no B existence/count/details |
| F | Authorized active epoch, no V2 source or tenant entries | EMPTY, no positive badge, expected absent lazy head/genesis |
| G | Legacy-only A, global chain passes/fails | LEGACY_GLOBAL_ONLY + V2 EMPTY; never tenant VALID from history |
| H | Missing/null/malformed/extra contradictory verifier result | App UNKNOWN/request failure, never BROKEN/VALID/EMPTY by default |
| I | Source/head access unavailable, timeout, unsupported version or scan limit | UNKNOWN/failure; no partial success or fabricated zero |
| J | Multiple connections, same tenant, simultaneous first and later append; one aborts | Single genesis, no duplicate predecessor, committed contiguous tenant order; all-or-nothing capture |
| K | Two tenants concurrently append, lock waits/timeouts and global rollback | Separate tenant heads; expected global serialization without forks; no skipped predecessor; bounded failure/retry |
| L | Corrupt global B hash only while tenant V2 inputs stay intact; fail one side of capture | A/B V2 results independent of global status; failed dual append rolls back both chains/heads |
| M | Cryptographically intact payload with semantically false oversight/default values | Integrity can be VALID while payload stays LEGACY_NON_AUTHORITATIVE; no governance claim |
| N | service_role with no principal; expired/stale/ineligible principal; anon/authenticated/PUBLIC | Denied, no assurance result; internal append/global verifier not application-callable |
| O | Tenant list/detail/verify/errors/caches/cursors/exported fields | No global sequence/hash/predecessor/count/status, cross-org identity or reusable foreign cursor; per-org cache isolation |
| P | Serializer golden vectors and schema/index/trigger/owner/grant inventory | Exact versioned bytes; no default ACL leakage; planned definer delta explained; guarded immutable source fields |
| Q | Atomic cutover with in-flight old writer; old app attempts append after activation; rollback after first V2 commit | No straddling/capture gap; old call denied; forward-only fail-closed recovery; original historical bytes unchanged |
| R | Concurrent append during one verification snapshot; missing final head/capture and query boundary failure | Coherent captured-through result or UNKNOWN; no mixed snapshot/prefix VALID; last_verified set only on real complete verification |
| S | Tenant route/store/UI coverage | All Audit reads use principal RPCs, no direct-table/global fallback, exact vocabulary and historical limitations |

Architecture closure grants no PASS to these future security tests. S1A0 is
documentary CLOSED / PASS only after its own documentation checks pass.
Exact next slice: **M17.5-V1-S1A1 — LX08 TENANT LEDGER INTEGRITY V2 IMPLEMENTATION**.
Do not start S1A1 without separate authorization.
