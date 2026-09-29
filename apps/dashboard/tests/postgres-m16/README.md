# M16 credential + eligibility security — disposable PostgreSQL 17

From `apps/dashboard` with Node 24+ and workspace dependencies installed:

```sh
node --conditions=react-server --import tsx --test tests/postgres-m16/*.test.ts
```

Set `M16_PG17_BIN` to a directory containing PostgreSQL 17 `initdb`, `pg_ctl`,
`psql` and their extension dependencies. Windows defaults to
`C:/Program Files/PostgreSQL/17/bin`; other platforms use PATH. The server must
report `170000 <= server_version_num < 180000`. Missing/wrong binaries fail the
profile; an environment limitation is not canonical acceptance. Run as a
non-root OS user. The M15 helper, command and migration semantics are unchanged.

The helper creates its own temporary cluster, strips inherited libpq settings,
binds to `127.0.0.1` on a newly allocated port, and verifies `data_directory`
before executing fixtures. It accepts no existing/hosted database connection.
Success and ordinary failure stop the server and remove only the verified
temporary directory. A forcibly terminated runner can require manual cleanup.

Role topology:

| Role | Superuser | BYPASSRLS | Purpose |
|---|---|---|---|
| m16_bootstrap | yes | yes | initdb/bootstrap and explicit superuser tests |
| postgres | no | yes | object owner and all canonical migrations |
| service_role | no | yes | actual separate application DML/RPC sessions |
| anon / authenticated | no | no | unprivileged ACL checks |

An inert `auth.email()` returning NULL permits canonical RLS creation. It is
never used as application authentication. No application table or production
trigger/function is replaced by a stub.

Canonical chain, executed in this order as `postgres`:

1. `20260818003539_gov_repo_types_and_organisations.sql`
2. `20260818003710_gov_repo_identity_and_ledger.sql`
3. `20260818013113_grant_service_role_gov_repo_access.sql`
4. `20260903200000_canonical_email_identity.sql`
5. `20260903200100_atomic_signup_legacy_rpc.sql`
6. `20260925150000_m16_s0_credential_epoch_v1.sql`
7. `20260925160000_m16_s0_transactional_eligibility_v1.sql` (S0.3.2; applied by `transactional-eligibility.test.ts` after step 6)
8. `20260925170000_m16_s0_credential_epoch_binding_v1.sql` (S0.3.2R; applied by `transactional-eligibility.test.ts` after step 7; drops the four-argument helper)

The credential migration (step 6) is first attempted with a future legacy epoch to verify
atomic rollback, then executed successfully while waiting on a real concurrent
writer. The writer authors a valid epoch after the migration starts waiting;
this detects a cutover timestamp captured before lock acquisition. Tests cover
all 22 requested credential behaviors, explicit NULL insert, exact microsecond
preservation, and role topology. Diagnostics print version, migration chain,
actual routine ACLs and cleanup status.

The monotonicity fixture temporarily disables the trigger using bootstrap DDL
to seed an OLD epoch ahead of the actual DB clock, then immediately restores
`ENABLE ALWAYS` in that same fixture transaction. Two updates use the unchanged
production trigger and must advance by one microsecond each. This fixture
simulates a backward/equal effective clock without altering the OS clock.

The updatable invoker view and dynamic-DML fixtures prove only that their DML
reaches the base-table trigger. They do not certify GraphOS deployment security.
`external_id` changes (including IdP changes) always advance the credential
epoch. Its bcrypt/IdP overloading and injection concern remain
`PRODUCTION_SECURITY_GATE_RESIDUAL`; no new identifier architecture is accepted.
Owner DDL disabling/dropping the trigger remains Production Security Gate scope.

## S0.3.2 — transactional eligibility helper

`transactional-eligibility.test.ts` proves `gov_repo.lock_and_resolve_governance_session_eligibility_v1`
on the same real PG17 cluster topology. Concurrency tests use the harness `session(role)`
(long-lived interactive psql, serial statements, stdout/stderr sentinels) so distinct
backends hold and contend for real row locks. Blocking is observed through
`pg_stat_activity.wait_event_type='Lock'` and `pg_blocking_pids()` from a separate
bootstrap monitor session, never by sleeping alone. Lock order is proven with
`FOR UPDATE NOWAIT` probes while the helper is blocked on a role row.

Helper posture (see S0.3.2R below for the current signature and search_path): PL/pgSQL, VOLATILE, SECURITY DEFINER, `search_path=pg_catalog`,
function-local `lock_timeout=5s`, READ COMMITTED only, owner-only EXECUTE (all of
PUBLIC/anon/authenticated/service_role revoked). Lock hierarchy
ORGANISATION -> GOVERNANCE_USER -> GOVERNANCE_ROLE (ascending role_id), all `FOR SHARE`.
Failure SQLSTATEs: GV001 session temporal, GV002 credential stale, GV003 actor/org
ineligible, GV004 role set invalid, GV005 unsupported isolation; lock timeout stays 55P03.

Fixture note: real users get a 12h-old credential epoch via a bootstrap-only,
single-transaction disable/enable-ALWAYS of the S0.3.1 trigger (same technique as the
S0.3.1 monotonicity fixture). Exact-second boundary cases derive `t.s` from the DB clock
in the same statement and first wait past a near-rollover second.

The eligibility helper is not wired to any route or write wrapper (S0.3.3). GraphOS is
unchanged and not certified here (`PRODUCTION_SECURITY_GATE_RESIDUAL`). O07/O52 remain
**PARTIAL**; O08/O09/O10 have tested infrastructure but no production integration; O11
is not complete. No hosted DB or real OpenAI is needed.

## S0.3.3D — contract phase: raw write RPC revocation

`contract-raw-rpc-revocation.test.ts` applies
`20260928190000_m16_s0_contract_raw_write_rpc_revocation_v1.sql` on top of the full S0.3.3B
chain (credential + eligibility + epoch-binding + object-materialization-compat + governed
write wrappers) and proves, against real catalog state (never migration text alone):
service_role/PUBLIC/anon/authenticated can no longer execute any of the seven now-unused raw
functions (`apply_review_transition`, `record_authorized_reconciliation`,
`materialize_object_reconciliation`, `materialize_relationship_reconciliation`,
`record_technical_field_decision`, `record_execution_field_decision`,
`record_authorization_decision`); the six `*_governed_v1` wrappers and the owner-only guard
keep their already-frozen ACLs unchanged; a governed wrapper still successfully executes a
valid HUMAN write for a current `GOVERNANCE_ADMIN` actor and still returns GV006 for a
current non-admin actor. This is the CONTRACT half of S0.3.3's expand/contract; S0.3.3B left
the raw functions deliberately callable, and this migration closes that transitional bypass.
No table/sequence privilege changes (the broad service_role table-DML grant remains
`PRODUCTION_SECURITY_GATE_RESIDUAL`, unchanged and out of scope here).

## CI

`.github/workflows/m16-postgres17-security.yml` runs `tests/postgres-m16/*.test.ts` (all
four files above) against a real PostgreSQL 17 installed from the official PGDG apt
repository on every push/PR, with `M16_PG17_BIN` pinned explicitly to the installed 17
binaries. The harness's own `server_version_num` assertion (this file, `disposableM16Postgres`)
means the suite fails outright rather than silently running against a different PostgreSQL
major version.

## S0.3.2R — exact credential epoch binding

Architecture: `docs/architecture/ADR-GOVIA-M16-S0-CREDENTIAL-EPOCH-BINDING-v1.md`.
The corrective migration drops the four-argument helper and creates the single canonical
`gov_repo.lock_and_resolve_governance_session_eligibility_v1(uuid, uuid, bigint, bigint, timestamptz)`
(`p_verified_credential_epoch`). The verified epoch must EQUAL (`timestamptz`, microsecond)
the locked `governance_users.password_changed_at`, otherwise `GV002` /
`M16_ELIGIBILITY_CREDENTIAL_STALE` with DETAIL `CREDENTIAL_EPOCH_MISMATCH`; the existing
`iat > floor(epoch)` rule (DETAIL `SESSION_NOT_AFTER_CREDENTIAL_EPOCH`) must ALSO pass, and
+5/+6 future-iat behavior is unchanged. `search_path` is `pg_catalog, pg_temp`. Tests R1-R7
in `transactional-eligibility.test.ts` cover exact/NULL/microsecond epochs, the reproduced
backend-+5s stale-token scenario, both-conditions-required, concurrent rotation, and temp
object shadowing. The other lock/ACL/isolation tests run unchanged against the new signature.

## S1A.1 — L14 Authority Policy foundation + first-policy bootstrap

Architecture: `docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md`
(§§4-7, 9, 16-17, 20-21) plus the S1A architecture-owner decisions U1-U9. Migration:
`20260929120000_m16_s1a_l14_authority_policy_v1.sql`, applied by `helpers/m16-l14-fixtures.ts`
after the full governance chain (including the broad `20260818013113` defaults) and every S0
migration. Three files:

- `l14-authority-policy-bootstrap.test.ts`: first ADMIT / proposal / first VALIDATE, durable
  DENY + exact DENY replay (also after a later role grant), GV007/GV008/GV009/GV010 paths,
  DB content hash and fingerprint parity with the TypeScript mirror, typed scope operands
  (CANONICAL_OBJECT FK, read-only RELATIONSHIP_STATE triple lookup), support NONE/PRESENT,
  authorization snapshot, lineage, self-validation, bootstrap-never-reopens, bitemporal
  resolver coordinates, raising immutability (UPDATE/DELETE/TRUNCATE, even as owner).
  The RELATIONSHIP_STATE fixture inserts one canonical_relationships row as the owner; the
  S1A.1 migration and RPCs never write that table (F2 untouched).
- `l14-authority-policy-concurrency.test.ts`: concurrent first ADMITs / same-command ADMITs /
  first VALIDATEs, role/is_system_role/organisation/actor changes racing commitment in both
  orders (observed via `pg_blocking_pids`), guard lock timeout `55P03`, no partial writes.
- `l14-authority-policy-acl.test.ts`: real-catalog ACL checker over the whole L14 surface with
  per-class negative controls (table DML, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN, column
  grants, PUBLIC, sequences, routine EXECUTE, non-invoker and out-of-prefix writable views,
  inherited role grant, default-privilege reintroduction); each control is also rejected by
  a re-execution of the migration's own postflight. Direct app-role table access and the RPC
  EXECUTE boundary are exercised; the S0 six-wrapper count is unchanged.

## S1A.2 — L14 Authority Policy successor lifecycle

Additive migration `20260929130000_m16_s1a2_l14_authority_policy_successor_v1.sql` (the audited
S1A.1 migration is not edited), applied by `helpers/m16-l14-fixtures.ts` after S1A.1, so every
S1A.1 suite now also runs as regression on the S1A.2 schema. `helpers/m16-l14-successor-fixtures.ts`
bootstraps each organisation through the real RPCs.

- `l14-authority-policy-successor.test.ts`: action-sensitive self-basis and NULL-basis constraint
  probes, state uniqueness, successor ADMIT ALLOW and every DENY reason (NO_EFFECTIVE_AUTHORITY
  with explicit NULL basis, NO_MATCHING, SOURCE including contradictory keys, SCOPE via the
  evaluator), successor self-authorization, ALLOW and DENY replay after authority change, REVOKE
  proposals, immediate / future / backdated VALIDATE with flags, strictly increasing instants,
  self-validation, REJECT/DEFER/correction, pending-successor cancellation, GV011 continuity,
  current-policy self-revocation at a successor cutover, no resurrection, bitemporal matrix,
  authorization snapshots, and re-execution of the S1A.2 postflight.
- `l14-authority-policy-successor-concurrency.test.ts`: concurrent successor ADMITs, terminal
  decisions, VALIDATEs, future-successor vs revocation, role/credential/actor/organisation races,
  policy-head change, guard lock timeout.

The S1A.1 bootstrap suite's "bootstrap never reopens" test and one proposal assertion encoded the
S1A.1-only "successor lifecycle not available" placeholder; they now assert the S1A.2 behaviour
(local-policy basis, never bootstrap) instead.

## S1A.2R1 — no-resurrection corrective (F-1 BLOCKER, F-2 LOW)

Additive migration `20260929140000_m16_s1a2r1_l14_no_resurrection_v1.sql` (S1A.1 and S1A.2
migrations untouched) replaces the S1A.2 continuity helper with the recorded-time-aware
`l14_authority_policy_schedule_continuous_v2` (only a target still PENDING when the tombstone is
recorded can be cancelled), rejects a backdated REVOKE at/before an already-effective target's
start (GV011 `BACKDATED_REVOKE_WOULD_RESURRECT`), returns GV011 `EFFECTIVE_INSTANT_ALREADY_USED`
instead of raw 23505, and drops the obsolete helper. `l14-authority-policy-no-resurrection.test.ts`
proves cases A-F, F-2, zero residue, command reuse, recorded-cutoff knowledge, and a concurrent
cancellation/cut-over race. The S1A.2 successor suite's helper-EXECUTE probe now targets `_v2`.

## S1B.0 — governed-registry framework + typed target-scope evidence

Additive migration `20260930120000_m16_s1b0_l14_registry_framework_v1.sql` (no S0/S1A migration
edited; the three public Authority Policy RPC bodies, the rule parser and the evaluator are
byte-identical). FRAMEWORK ONLY: no registry subject is executable and no public RPC is added.

**Migration horizons.** `l14Cluster(diagnostic, { horizon })` in `helpers/m16-l14-fixtures.ts`:
`'S1A'` (default) ends at S1A.2R1 exactly, so every S1A suite keeps asserting the exact S1A catalog
(13 relations, its own postflight) unchanged; `'S1B0'` additionally applies S1B.0. A suite may also
start at `'S1A'` and apply S1B.0 itself (`l14-registry-framework.test.ts` does, to prove
compatibility on real S1A history).

- `l14-registry-framework.test.ts`: real S1A history (bootstrap, successor, durable DENY, DEFER/REJECT,
  PRESENT support) written through the RPCs, THEN the migration: historical rows unchanged, every new
  constraint VALID (except the deliberately NOT VALID D-14 CHECK), historical DENY replays its original
  result, AP RPC/parser/evaluator bodies unchanged, successor lifecycle still works; D-14 (32 rejected
  registry x non-ALL combinations, authorized = GV010 + nothing written, unauthorized = durable DENY +
  no rule, owner stopped by the insertion guard and the CHECK backstop, fact permissions keep all five
  scopes); typed request-target shapes (CANONICAL_KIND / RELATIONSHIP_TYPE rejected, cross-tenant
  object rejected, no relationship-state FK/uniqueness); F-4 audit shapes; exact operand snapshot;
  registry governance-decision matrix; the registry-state envelope (generic kind / lineage /
  revocation / decision / basis shapes, generated derived columns, no JSON); immutability; command
  result and support-link widening; replay-first syntactic support canonicalization; F2 untouched.
- `l14-registry-framework-guards.test.ts`: SHARED Authority Policy guard on the SAME advisory key as the
  S1A exclusive guard (both directions, including the REAL unchanged ADMIT RPC), registry subject
  guard serialization and framing, fail-closed keys, owner-only EXECUTE.
- `l14-registry-framework-acl.test.ts`: S1B-horizon real-catalog checker (14 relations, exactly the
  three S1A service_role RPCs), per-class negative controls on S1B objects, each also rejected by a
  re-execution of the S1B.0 postflight; disabled guards / JSON column also fail the postflight.

D-14 is enforced at rule INSERTION (BEFORE INSERT guard + NOT VALID CHECK), not in the parser: the
unchanged AP ADMIT RPC parses before replay arbitration, so a parser-level check would make a
historical ADMIT (legal under S1A) fail GV010 on replay instead of returning its original result.

## S1B.1 — GOVERNANCE_PARTY registry + PII boundary

Additive migration `20260930130000_m16_s1b1_l14_governance_party_v1.sql` (no S0 / S1A / S1B.0 migration
edited; no Authority Policy RPC, parser, evaluator or S1B.0 helper replaced). Horizons: `'S1A'` and
`'S1B0'` are unchanged (their suites keep their exact historical catalog assertions); `'S1B1'` adds the
Party migration. `helpers/m16-l14-party-fixtures.ts` bootstraps each organisation's Authority Policy
through the real AP RPCs (registrar = `L14_PARTY_ADMIT`, steward = `L14_PARTY_VALIDATE` without flags,
flex steward = self-validation + future/back dating, contributor = a CONTRIBUTING ADMIT rule) and drives
every Party command through the three real Party RPCs as service_role.

Identity: `organisation_id + governance_party_id`, the id minted by PostgreSQL (`DEFAULT gen_random_uuid()`),
never an RPC input, never derived from user / email / name / external identity / profile. ADMIT pins the
exact ALLOW / GOVERNANCE_PARTY / ADMIT authorization and creates the identity, ADMISSION support links and a
technical head with no state — never a governance decision or a VALIDATED state. A durable DENY mints nothing.
State detail over `l14_registry_states` is linear, same-Party and alternating (VALIDATED → REVOKED →
VALIDATED …), so an overlapping second VALIDATED state is structurally impossible; a REVOKE falls strictly
inside the target's validity and a re-validation begins at or after the tombstone (GV011 otherwise).
`gov_repo.governance_party_directory_profiles` is the mutable, NON-authoritative, deliberately non-`l14`
profile table — the only place Party PII can live — with no application privilege and no RPC.

All three Party RPCs are replay-first: base session → syntactic shape → syntactic support → DB fingerprint →
AP guard SHARED → registry subject guard (existing Party) → per-command guard → replay arbitration →
tenant/reference/support resolution → current effective Authority Policy (exact hash) → rule evaluation →
mutation → base-eligibility recheck. The per-command guard makes a concurrent duplicate command replay its
original result instead of racing the unique command identity.

- `l14-governance-party.test.ts`: ADMIT ALLOW (DB-minted v4 id, admission/authorization/snapshot evidence,
  head without state), no caller id (catalog default + 42883), durable DENY variants incl. NO_EFFECTIVE_AUTHORITY
  for a system admin, ALLOW/DENY replay after role and AP change, GV007/GV008, shape/eligibility failures
  unconsumed, replay-first support ordering (vanished and foreign-tenant evidence), D-14 ordering, proposals,
  VALIDATE lineage, no overlapping VALIDATED, decision DENY variants, REJECT/DEFER/correction, self-validation,
  temporal dating, REVOKE + target immutability + double revoke, re-validation (exact instant, overlap GV011),
  REVOKE interval rules, head CAS + head guard, bitemporal resolver matrix (recorded cutoff, backdated
  revocation, no fallback, ambiguity fails closed), structural detail guard.
- `l14-governance-party-pii.test.ts`: catalog proof that no L14 structure can represent PII (column names,
  exact Party column sets, closed-vocabulary text only, no profile FK, only actor user FKs), no PII RPC
  argument (42883) or result field, profile correction/pseudonymisation/erasure leave every L14 row
  byte-identical, profile values never appear in L14 rows/fingerprints/replays, user deletion nulls only the
  mapping, PERSON-only unique same-tenant mapping, erasure shapes, fixed binding, no app access / no profile RPC.
- `l14-governance-party-concurrency.test.ts`: same-command ADMIT (one id), different commands in parallel,
  different Parties in parallel, terminal-decision race, expected-none VALIDATE race, REVOKE vs VALIDATE /
  re-VALIDATE / REVOKE races, role / credential / actor / organisation races, in-flight VALIDATE holding
  roles, AP change races in both directions (shared vs exclusive guard), subject / command / AP guard 55P03.
- `l14-governance-party-acl.test.ts`: S1B1-horizon real-catalog checker (18 l14 tables + the profile table,
  exactly six service_role RPCs), per-class negative controls (incl. profile grants, profile view, profile
  RPC), each also rejected by a re-execution of the S1B.1 postflight; disabled guards, PII/JSON columns,
  profile references and a weakened mapping FK also fail the postflight.
