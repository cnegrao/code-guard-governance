# M16-S0.3.3 governed write boundary — expand/contract closure

Status: **CLOSED (expand/contract complete)**. Architecture: **GOVIA-L0L16-CIA-v1.0**
— unchanged. Milestone: **M16-S0 security prerequisite** (slices S0.3.3A inventory,
S0.3.3B governed wrapper foundation, S0.3.3B0 object-materialization corrective,
S0.3.3C application cutover, S0.3.3C-R1/R2 authority corrections, S0.3.3D
contract/revoke/hardening, S0.3.3R3 technical/execution replay authority closure).
Authority: sequential architecture-owner instruction, each slice independently
audited before the next was authorized — including an independent S0.3.3E
adversarial review after D, which found one confirmed HIGH finding (H-1, closed by
R3) and produced the wording corrections recorded throughout this document. This
is evidence of what these slices actually built and verified; it does not rewrite
the M16 functional architecture, does not implement M16 L14, and does not
implement F2.

## Unchanged

- M16 functional scope is unchanged.
- L14 Authority Policy is unchanged; **no L14 permission or policy authority is
  introduced anywhere in S0.3.3.** Where a domain contract required an
  `AuthorizationDecision` at all (the closed reconciliation gate), the bridge that
  produces it binds only to the already-verified session identity and sets no
  `policyReference` — it does not claim any policy authority that does not exist.
- F2 (`canonical_relationships` temporal mutation — `UPDATE`, `DELETE`, `valid_to`,
  supersession, relationship closure) is unchanged and remains deferred; S0.3.3
  touches none of it.
- The credential-epoch exact-string binding (`ADR-GOVIA-M16-S0-CREDENTIAL-EPOCH-BINDING-v1.md`)
  is unchanged: no `+5`-second tolerance, no fallback epoch, no nullable command
  eligibility, no JS `Date` round-trip anywhere in the write path.
- The JWT/session contract (secret ≥32 bytes with no example/fallback, pinned
  algorithm/issuer/audience, required `sub`/`org`/`credential_epoch`, informational-only
  role/email, 8-hour governance session ceiling, `iat > floor(password_changed_at)`,
  exact `credential_epoch` equality) is unchanged.

## What S0.3.3 closed

1. **Five active AUTHORITATIVE HUMAN governance HTTP write surfaces**, all cut
   over from app-level role-authority checks to a transactionally-authoritative
   DB boundary. This is the canonical governance system-of-record surface, not
   an inventory of every mutable endpoint in the product — see "Legacy
   registry routes" below for the ones deliberately excluded:
   - `PUT /api/governance/workspace/reviews/[id]` (review state transitions)
   - `POST /api/governance/workspace/reviews/[id]/decision` (reconciliation decisions)
   - `POST /api/governance/workspace/reviews/[id]/materialize` (materialization)
   - `POST /api/governance/workspace/technical-facts` (technical field decisions)
   - `POST /api/governance/workspace/execution-context` (execution field decisions)
2. **Six governed wrapper functions** (`*_governed_v1`, added S0.3.3B) are the SOLE
   transactional write authority for all five surfaces:
   `apply_review_transition_governed_v1`, `record_authorized_reconciliation_governed_v1`,
   `materialize_object_reconciliation_governed_v1`,
   `materialize_relationship_reconciliation_governed_v1`,
   `record_technical_field_decision_governed_v1`, `record_execution_field_decision_governed_v1`.
   Each runs, in one transaction: eligibility+admin guard → the real underlying
   authoritative write → eligibility+admin guard again. No exception handling, no
   dynamic SQL, no caller-controlled role, no JWT role/email input, no request-header
   authority.
3. **Verified principal five-field transport** (`GovernanceWritePrincipal`:
   `organisationId`, `actorUserId`, `issuedAtSeconds`, `expiresAtSeconds`,
   `credentialEpoch`) is the only identity/session input into every governed wrapper
   call, derived exclusively from the JWT-verified session — never from request
   body/header/query, and never from JWT `role`/`email` (informational only).
4. **Transactional CURRENT authority**: every successful write — including a
   *replay* of an already-persisted decision — re-checks the actor's current
   `GOVERNANCE_ADMIN` standing via `gov_repo.require_governed_write_eligibility_v1`
   → `gov_repo.lock_and_resolve_governance_session_eligibility_v1`,
   transactionally, at write time. No app-level role read (`currentRole`,
   `hasGovernanceReviewAuthority`, `resolveCurrentGovernanceRole`) may deny or
   allow a write ahead of this DB check; GET/read-model paths may still resolve a
   role for their own UI purposes only. **This guarantee was completed in two
   steps, not one**: S0.3.3C-R2 closed the reconciliation-decision replay
   short-circuit in `decision-commands.ts`; a subsequent independent adversarial
   review (S0.3.3E) found that the SAME class of bypass still existed, unfixed,
   in `packages/governance-review/src/technical-facts.ts`'s
   `reconcileTechnicalFact` and `execution-context.ts`'s `reconcileExecutionField`
   — both returned `{replay: true}` directly on an exact match, before ever
   calling the supplied (governed) persistence port. **Do not read C-R2 as having
   already protected every replay path; it protected only the reconciliation-decision
   one.** S0.3.3R3 closed the technical/execution replay bypass by making both
   functions call `port.recordDecision` on an exact replay too, proven at the
   real-database layer by `tests/postgres-m16/field-decision-replay-authority.test.ts`.
5. **Error classification is narrow and DB-verified, not a blanket catch-all**: only
   the exact, known business SQLSTATEs (`40001` stale review state, `23514` with the
   `IDEMPOTENCY_CONFLICT` sentinel — note `23514` is reused by
   `apply_review_transition` for other, unrelated contract failures too, so it is
   never broadened to a blanket `23514 → 409`) become a structured business outcome.
   Every other `GovernedWriteError` code and every non-DB transport/infrastructure
   failure propagates unchanged to the route's generic classification
   (GV001/GV002→401, GV003/GV006→403, GV004/GV005→500, `55P03`→503+`Retry-After:1`,
   unrecognized→500). No raw DB message/DETAIL ever reaches an HTTP response body.
6. **Seven raw functions are no longer executable by application roles**
   (`PUBLIC`/`anon`/`authenticated`/`service_role` — S0.3.3D contract migration
   `20260928190000_m16_s0_contract_raw_write_rpc_revocation_v1.sql`), closing the
   transitional direct-RPC bypass S0.3.3B deliberately left open:
   `gov_repo.apply_review_transition`, `gov_repo.record_authorized_reconciliation`,
   `gov_repo.materialize_object_reconciliation`,
   `gov_repo.materialize_relationship_reconciliation`,
   `gov_repo.record_technical_field_decision`, `gov_repo.record_execution_field_decision`,
   and `gov_repo.record_authorization_decision` (S0.3.3A: confirmed, and reconfirmed
   at S0.3.3D, to have no active production caller). **The owner role `postgres`
   retains its implicit owner EXECUTE on all seven** — `REVOKE` cannot and does not
   remove that; only application-facing roles lost access. PUBLIC/anon/authenticated
   never had and still do not have EXECUTE on any of the seven. The six governed
   wrappers and the owner-only guard keep their already-frozen ACLs, unchanged by
   this revocation and re-verified by its own postflight and by a dedicated PG17
   test (`tests/postgres-m16/contract-raw-rpc-revocation.test.ts`).
7. **`signToken` hardening**: no longer re-exported from the broad `@/lib/auth`
   barrel that most of the application imports for unrelated reasons
   (`requireVerifiedGovernancePrincipal`, `SessionAuthenticationError`, etc.).
   Production token issuance (`lib/auth/session-issuance.ts`) already imported it
   narrowly from `@/lib/auth/session-token`; that narrow import path is now the only
   legitimate one. `lib/auth/session-token.ts` itself is untouched and remains
   Edge-compatible (no `server-only`; `middleware.ts` still imports it directly for
   the Edge runtime).
8. **Technical/execution field-decision replay authority (S0.3.3R3, Finding H-1)**:
   `reconcileTechnicalFact` and `reconcileExecutionField` (both in
   `packages/governance-review/src/`) now call `port.recordDecision` on an exact
   replay too, exactly like a first-time decision, instead of returning
   `{replay: true}` directly. The package itself stays persistence-port neutral —
   it names no `GOVERNANCE_ADMIN` concept and imports nothing from the dashboard's
   auth layer; the invariant is purely "a successful replay must still traverse
   the supplied persistence port." For the HUMAN dashboard callers
   (`submitTechnicalFieldDecision`, `submitExecutionDecision`), that supplied port
   is `createGovernedTechnicalFactPersistence`/`createGovernedExecutionContextPersistence`,
   so a replay now re-checks current write authority transactionally exactly like
   S0.3.3C-R2 already required for reconciliation decisions. Verified against the
   real `gov_repo.record_technical_field_decision` / `record_execution_field_decision`
   SQL first (both detect an existing `decision_id` row and return `replay=true`
   BEFORE any staleness/policy re-validation, so a genuine replay is unaffected by
   later drift) and at the real-database layer by
   `tests/postgres-m16/field-decision-replay-authority.test.ts`.

## Machine producer boundary — explicitly deferred, not solved here

Two `DETERMINISTIC_RULE` (machine) producer entry points still exist in the
codebase and still bind to the plain, ungoverned default persistence port:
`runGovernanceDiscoveryScan` (`lib/governance/discovery-intake.ts`) and
`importAzureSqlCatalog` (`lib/governance/multivendor-exchange.ts`, via
`packages/governance-review/src/inbound-exchange.ts`). Both have **zero active
production callers** — no route, handler, or scheduled job invokes either one —
confirmed by static inventory at S0.3.3A and reconfirmed at S0.3.3D
(`tests/governed-write-cutover.test.ts`).

**Precise scope of what the S0.3.3D revocation actually closed**: the
governance DETECTED→PROPOSED review-transition write
(`gov_repo.apply_review_transition`, which both producers' `review` port
ultimately calls) is now non-executable through the current `service_role`
boundary — that specific write path is closed. This does **not** mean every
RPC either producer touches is closed. The upstream intake RPCs each producer
calls before it ever reaches `persistReviewTransition` (e.g. discovery
finding/candidate/evidence recording, technical fact proposal recording) were
never in the seven-function S0.3.3D revocation list and **may still execute**
if either dormant producer is incorrectly wired to a route. The producer
remains **DORMANT and MUST NOT be wired** until an explicit, owner-controlled
machine write boundary exists — its current inertness comes from having zero
callers, not from every RPC in its call graph being unreachable.

This is a deliberate, explicit deferral, not an oversight:
- S0.3.3D did **not** create a machine wrapper.
- S0.3.3D did **not** activate either producer.
- S0.3.3D did **not** silently redirect either producer through a HUMAN
  `createGoverned*` factory (both still bind `review: governanceReviewPersistence`,
  the plain default port — verified by a dedicated static test).
- A future, explicit, owner-controlled machine write boundary — a distinct
  `DETERMINISTIC_RULE` authority model, not a reuse of the HUMAN one — is a
  separate, not-yet-designed slice.

### Legacy registry routes — explicitly outside this scope (M-1)

`app/api/discovery/scan/route.ts` and `app/api/discovery/review/route.ts`
perform direct table DML (`INSERT`/`UPDATE`) against a plain `agents` registry
table, entirely outside the `gov_repo` governance schema this document
covers. These routes are **`LEGACY_NOT_AUTHORITATIVE`**: they do not define or
mutate canonical governance system-of-record state, so they are architecturally
outside S0.3.3's authoritative-governance scope by definition, not by
oversight. They are also **`PRODUCTION_SECURITY_GATE_RESIDUAL`** — tracked for
resolution at the Production Security Gate, not migrated or rewritten by
S0.3.3D or S0.3.3R3.

### `materialize_agent_version_technical_profile` — latent canonical writer (M-2)

`gov_repo.materialize_agent_version_technical_profile` (wrapped by
`lib/governance/agent-version-technical-profile-persistence.ts`, called only
from `runGovernanceDiscoveryScan`, the same dormant producer above) is a
canonical writer with **zero active production callers**, and it is **still
service_role executable** — it was never one of the seven functions the
S0.3.3D revocation targeted. Classification: **`PRODUCTION_SECURITY_GATE_RESIDUAL`**.
It must be contracted or governed before production, but doing so was
explicitly out of scope for both S0.3.3D and S0.3.3R3 to avoid scope creep.

## Residual — explicitly not remediated here

The historical broad `service_role` grant
(`20260818013113_grant_service_role_gov_repo_access.sql`) still leaves table-level
privileges (`SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`) on the
legacy `gov_repo` tables directly reachable by `service_role`, independent of the
RPC-level EXECUTE boundary S0.3.3B/D contracted. This remains classified
**`PRODUCTION_SECURITY_GATE_RESIDUAL`** and is re-measured (not remediated) by
`tests/postgres-m16/governed-write-wrappers.test.ts`'s own table-DML residual test
after every S0.3.3 change. `service_role` is **not** fully least-privilege after
S0.3.3D — only its RPC-level EXECUTE surface for the seven raw write functions is
contracted. The Production Security Gate is the point at which this broad
table-DML grant is intended to be resolved, before any hosted deployment.

## PG17 is the canonical S0.3.3 CI gate

`.github/workflows/m16-postgres17-security.yml` installs PostgreSQL 17 from the
official PGDG apt repository on every push/PR and runs the full
`tests/postgres-m16/*.test.ts` suite (credential epoch, transactional eligibility,
governed write wrappers expand phase, object-materialization compatibility, the
S0.3.3D contract-phase ACL suite, and the S0.3.3R3 technical/execution
replay-authority suite) against a real disposable PostgreSQL 17 cluster — never a
mock/fake DB, never a silent fallback to PostgreSQL 16. The disposable cluster
helper itself asserts `server_version_num` is `17.x` at connect time and fails the
whole suite otherwise. The workflow's `tests/postgres-m16/*.test.ts` wildcard
picks up any new file in that directory automatically, with no per-file wiring.

## Out of scope

M16 L14 Authority Policy/Proposal, F2 relationship temporal mutation, GraphOS, the
machine write boundary (see above), the legacy registry routes (M-1, see above),
`materialize_agent_version_technical_profile` (M-2, see above), the broad
`service_role` table-DML residual (see above), and M17+.
