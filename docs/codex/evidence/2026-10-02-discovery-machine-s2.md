# Discovery Machine S2 - machine control plane persistence

## Status and resumed state

**READY_FOR_INDEPENDENT_REVIEW. Local, UNCOMMITTED; independent review not yet performed.**

- Baseline/current HEAD: `c4cd6949c1068b76349abf32fcf9a4ff864d533b` (closed S1).
- Branch: `feat/discovery-machine-s2`.
- Worktree: `D:/govia-worktrees/discovery-machine-s2`.
- Authority: [frozen machine-boundary ADR](../../architecture/ADR-GOVIA-GOVERNED-DISCOVERY-MACHINE-EXECUTION-BOUNDARY-v1.md) and [CIA baseline](../../architecture/GOVIA-L0L16-CIA-v1.0.md).
- Resumed the existing uncommitted implementation. No reset, replacement worktree, second migration, commit, push or PR.
- User explicitly authorized the historical PG17 harness correction. No historical migration or production runtime file changed.

## Files changed

1. `supabase/migrations/20261002190148_discovery_machine_s2_control_plane_v1.sql` - additive migration, generated with Supabase CLI 2.107.0 `migration new discovery_machine_s2_control_plane_v1`.
2. `apps/dashboard/tests/helpers/disposable-m16-postgres.ts` - explicit historical R3 horizon; original exact R1/R2/R3 assertion retained, ordering/duplicate assertions added.
3. `apps/dashboard/tests/helpers/discovery-machine-s2-fixtures.ts` - exact historical baseline through R3, then only the named S2 migration; no future migration auto-application.
4. `apps/dashboard/tests/postgres-m16/discovery-machine-horizon.test.ts` - chain equivalence and incorrect identity/order rejection.
5. `apps/dashboard/tests/postgres-m16/discovery-machine-control-plane.test.ts` - functional, ACL, default, membership, source-identity and concurrency tests.
6. This evidence record.

## Schema and persistence model

Five tables, all in `gov_repo`:

| Table | Contract |
|---|---|
| `machine_principals` | DB-generated immutable UUID, stable unique code, fixed GOVERNED_DISCOVERY, explicit immutable environment, ENABLED/DISABLED/RETIRED. RETIRED terminal. No tenant, HUMAN, L11 or L14 identity. |
| `machine_credential_generations` | DB-generated UUID, immutable principal/OID/exact name/validity, monotonic generation number; PENDING/CURRENT/RETIRED; one CURRENT partial unique index; retained OID/name uniqueness. |
| `machine_execution_bindings` | DB-generated immutable UUID and scope; tenant, connection, provider, configured/normalized locator, optional provider pin, exact ref/adapter/version; independent intake/propose flags; fixed PASS_THROUGH_V1 / 1.0; revision; ENABLED/DISABLED/REVOKED. |
| `machine_binding_revisions` | Full row snapshot per binding UUID/revision, including administrative provenance. Append-only. |
| `machine_invocation_audit` | Append-only transactional foundation: principal/generation/role, binding/revision, tenant/source/adapter, original and attempt context, run/finding/subject/command/event/source version, outcome and timestamp. Missing denied-attempt references may remain absent. |

All control tables reject DELETE and TRUNCATE. Database triggers replace supplied control UUIDs; identity/scope cannot be retargeted. Every binding update advances revision and inserts a snapshot in the same transaction. Revisions cannot reset or exceed the S1 positive safe-integer limit; overflow fails instead of wrapping. Revocation is terminal; equivalent replacement gets a new UUID. Retained records prevent delete/recreate resurrection.

The two exact partial unique indexes cover all non-REVOKED rows, including DISABLED:

- `(principal_id, organisation_id, source_connection_id, authorized_ref, adapter_name, adapter_version)`.
- `(principal_id, organisation_id, provider, normalized_locator, authorized_ref, adapter_name, adapter_version)`.

Capabilities/rules do not partition these keys. `main` and `Main` remain distinct refs. Concurrent case-alias provisioning is rejected atomically.

Provenance includes database-authored `session_user`, timestamps and mandatory reason/reference; binding history preserves each revision's provenance. Six closed provisioning routines create/change principals, register/switch/retire generations, and create/change bindings with an expected revision. Only trusted out-of-band DBA/provisioning is supported. No dashboard/service_role/worker admin API or HUMAN-wrapper reuse exists.

## Roles, RLS and default privileges

| Role | S2 authority |
|---|---|
| `govia_discovery_control_owner` | NOLOGIN owner of four control/history tables and all 14 routines. |
| `govia_discovery_audit_owner` | NOLOGIN owner of invocation audit; EXECUTE only on the shared mutation-blocking trigger helper. |
| `govia_discovery_provisioner` | NOLOGIN grouping with EXECUTE on six provisioning routines, no direct table access. Trusted LOGIN assignment is out of band. |
| `govia_discovery_machine_caller` | NOLOGIN future closed-command grouping; schema USAGE, zero S2 command/helper EXECUTE. |

All are NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS/NOINHERIT. PostgreSQL's creator ADMIN membership for postgres remains with SET=false and INHERIT=false, matching R1. Temporary transfer/default-privilege rights are removed before commit. No machine credential LOGIN is created by migration.

For organisation locking, the control owner receives only SELECT(organisation_id,is_active), UPDATE(is_active), SELECT USING(true), and UPDATE USING(true) WITH CHECK(false), following R1's ledger-lock pattern. The test proves locking works and UPDATE cannot create a changed organisation row. No S2 routine updates an organisation.

Every S2 table explicitly REVOKEs ALL from PUBLIC, anon, authenticated, service_role, provisioner and caller; RLS is enabled in addition. No sequences are created because identities are UUIDs. Technical-owner defaults close PUBLIC routine execution and application table/sequence privileges. Unrelated historical postgres table defaults are preserved; explicit S2 object revokes neutralize their inherited rights.

The fixture applies hostile postgres defaults granting PUBLIC/anon/authenticated/service_role ALL on new tables/sequences before S2. Effective checks cover SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN and column grants. Catalog ACL expansion covers PUBLIC; a LOGIN without memberships tests effective PUBLIC access. Prospective table/identity-sequence/function creation under both owners proves default closure. `pg_default_acl` is inspected for postgres and both owners. Postflight rejects injected grants, PUBLIC EXECUTE/TRUNCATE, CREATE leakage and disabled RLS.

## Credential identity and transitive membership

Eligibility reconstructs `session_user -> exact pg_roles lookup -> OID -> retained generation -> enabled principal`. Expected role name is independently compared using C collation. No caller-supplied principal/generation/tenant/capability, GUC, temp table or cached session state establishes authority; there is no ambiguous text-to-regrole identity parsing.

`machine_role_safe_v1` checks LOGIN/validity/privileged attributes, direct ADMIN options, the entire membership graph, schema/database CREATE, effective governance table/column access and forbidden routine execution. PostgreSQL `pg_has_role(..., 'MEMBER')` follows transitive edges independently of INHERIT/SET options. All reachable roles except self and the single closed caller role are rejected, including dormant edges. Registration, activation and each eligibility check repeat this test, rejecting subsequent membership drift.

Negative PG17 probes inspect `pg_auth_members.admin_option`, `inherit_option` and `set_option`. They prove actual two-hop SET paths before testing rejection for control owner, audit owner, provisioner, service_role, authenticated, anon, runtime executor and ledger executor. INHERIT-only, ADMIN-only and dormant memberships also fail; ADMIN on the permitted caller role, direct privileged memberships/attributes and broad SELECT/CREATE grants fail. SET SESSION AUTHORIZATION is denied. This is a closed machine boundary, not a generic IAM framework.

Rename is forbidden operationally and fails closed; no global role-DDL event trigger is installed. Drop/recreate with the same name changes OID and cannot recover authority or register a retained name again. Rotation atomically retires the old CURRENT and denies already-open sessions. DB-clock checks also reject expired generations inside a persistent transaction. Password distribution, role creation and session draining remain out-of-band operations. No passwords/tokens are stored.

The eligibility routine is internal, with no machine EXECUTE grant. It accepts binding UUID/revision selectors only and returns current DB fields; future closed commands must select their capability internally and verify admitted run/support context. No intake or PROPOSE command is implemented.

## Locks, execution closure and source identity

READ COMMITTED is required. Eligibility locks principal FOR SHARE, active organisation FOR SHARE, then exact binding FOR SHARE and checks fresh DB time after locks. Provisioning takes principal FOR UPDATE before generation/binding mutation and uses the same order. Locks remain until transaction end. Concurrency tests prove unique provisioning and revocation waiting behind an eligible transaction; later attempts fail. Future commands must extend the order to run and subject and perform final eligibility checks.

All 14 routines pin `search_path=pg_catalog, pg_temp`; seven are SECURITY DEFINER with `lock_timeout=5s`. The seven invokers cover source identity, role/provisioner checks and triggers. Runtime bodies contain no dynamic SQL. Migration-time dynamic DDL uses a fixed census. The closure includes binding CHECK helpers, control-row guard, revision append trigger and mutation-blocking trigger. No HUMAN/raw transition routine is reused. Temporary domain/table/function shadows never execute under the definer owner in the negative tests.

SQL matches every S1 source golden vector, including historical non-GitHub descriptors: `source-connection:` + first32hex(SHA256(UTF8(provider + ':' + configured locator))). Configured casing remains the hash input. GitHub's ASCII grammar and lowercased comparison metadata are verified separately; exact refs are preserved. Provider repository ID remains authenticity metadata, never canonical identity. Actual observed-pin checks are a future S3 gate.

## Audit guarantees

History and invocation audit block UPDATE/DELETE with row triggers and TRUNCATE with a statement trigger, including ordinary owner DML in tests. Application/machine/service roles have no direct access or mutation routine. Superuser/owner DDL maintenance remains a trusted operational boundary.

Audit INSERT rolls back with its transaction, proven by a test. S2 does not claim survival of every crash, rollback, authentication failure or aborted attempt. There is no audit ingestion API in this slice. Actual invocation recording, operational-attempt ingestion and atomicity with transition/outbox belong to future commands.

## Final test matrix

Local PostgreSQL **17.11**, real disposable clusters; unchanged isolation checks validate the owned data directory and version. Actual psql `-U` connections and persistent sessions are used. Local trust authentication is not password/TLS/pooler/hosted acceptance. The historical harness's labelled pgvector stand-in is used; its single expected HNSW index omission is unchanged and is not vector acceptance.

| Command | Result |
|---|---|
| `node --conditions=react-server --import tsx --test apps/dashboard/tests/postgres-m16/discovery-machine-*.test.ts` (root) | **16 pass, 0 fail, 0 skip**, 57.703 s |
| `node --conditions=react-server --import tsx --test --test-concurrency=4 tests/postgres-m16/*.test.ts` (apps/dashboard) | **714 pass, 0 fail, 0 skip**, 556.435 s |
| `npm test --workspace=packages/governance-review` | **410 pass, 0 fail, 0 skip** |
| `npm run test:discovery-engine --workspace=packages/scanner` | **404 pass, 0 fail, 0 skip** |
| `npm test --workspace=apps/dashboard` | **1185 pass, 0 fail, 5 skip**: 1162 server + 15 Passport UI + 8 pre-demo UI |
| `npm run typecheck --workspace=packages/governance-review` | PASS |
| `npm run typecheck --workspace=packages/scanner` | PASS |
| `npm run typecheck:dashboard -- --incremental false` | PASS |
| `git diff --check` | PASS |

Final logs are in ignored `out/s2-validation/` in this worktree: `dedicated.log`, `postgres-full.log`, `governance-review.log`, `scanner.log`, `dashboard.log`, and the three `typecheck-*.log` files. Set `M16_PG17_BIN=D:/code-guard-governance/out/m16-tools/pgsql/bin` on this host. Existing installed dependencies are reused through an ignored node_modules junction; no manifest/lockfile changed.

The dedicated suite covers principal identity/state/environment; exact OID/name and one CURRENT; rename/drop/recreate and old open sessions; expiry; UUID non-reuse; scope immutability; monotonic revision/history; terminal revocation/stale revision; case aliases/distinct refs/concurrent creation; audit mutation; ACL/default/sequence/CREATE/EXECUTE denial; transitive memberships; pg_temp attacks; S1 parity; HUMAN/raw baseline.

Historical helper compatibility: pre-S2 suites execute exactly the same chain. Missing/renamed/duplicated/reordered R1/R2/R3 fail; later S2/future migrations do not enter that chain. S2 fixture applies exactly one named migration after R3 and reruns the original postflights before/after. Historical SECURITY DEFINER inventory equality includes signatures, owners, body hashes, configs and application ACLs. HUMAN application census remains **22**; the **7** contracted raw functions remain unavailable. No historical expected count was altered.

## Failure classification and development corrections

The first full PG17 run completed with 710 pass / 2 fail / 0 skip (839.369 s). The only failing leaf was the new S2 fixture statement `CREATE ROLE ... LOGIN NOLOGIN`; the parent accounts for the second reported failure. This is **C: harness-related**, corrected by emitting only NOLOGIN for that case. Every historical suite passed. The final complete run above is green.

Recovered `D:/code-guard-governance/out/s2-stage/dashboard.log` and final `out/s2-validation/dashboard.log` both record **1185 pass / 0 fail / 5 skip**. The separately reported dashboard failure was not present in either recovered execution; its test/log identity was requested but was not available when this record was written. Therefore an A/B/C/D cause cannot honestly be assigned to that unidentified event. It is **not reproduced or corroborated**, and must not be silently described as pre-existing/environmental. The identifiable C-category failure above is in PG17 test setup, not dashboard product behavior. No unrelated product code was changed.

The dashboard skips are existing opt-in auxiliary/hosted tests, not passes. PG17 security has zero skips and no hosted execution. During development, ownership/default-privilege setup and organisation lock RLS were corrected; persistent-session statements were terminated explicitly so expiry/rotation/concurrency tests execute real transactions. The final transitive membership correction was applied before all final validation commands.

## Scope, residuals and next gate

Only the six listed files changed. HUMAN wrappers, credential epoch, S0.3.3/R1-R6 baseline, L14, S1B.3, P0, S1 implementation and all historical migrations remain unchanged. No discovery_run_bindings/discovery_machine_admissions, intake/proposal owners, worker, runtime pg dependency, route/job or hosted setting is added.

| Item | State |
|---|---|
| Discovery | **DORMANT / NOT ACTIVATABLE** |
| S3 | **NOT STARTED** |
| S4 | **NOT STARTED** |
| Worker | **NOT IMPLEMENTED** |
| Hosted acceptance | **PENDING / NOT RUN** |
| S1B.3 | **NOT STARTED** |
| Commit / push / PR | **NONE** |

S1 carry-forward: S3 must independently derive/force/verify reviewStatus=UNREVIEWED, requiresReview=true, createsCanonicalObject=false, and harden nested canonical payloads at the DB boundary. No finding admission is implemented here.

No known failing S2 security gate remains. Independent review is still required; this record is not independent approval. Explicit limits: local trust transport, labelled vector stand-in, transactional-only audit, trusted DBA maintenance/provisioning, and future command/run/capability/pin checks. There are no hosted acceptance claims.

Technical references: [PG17 function security](https://www.postgresql.org/docs/17/sql-createfunction.html), [PG17 grants](https://www.postgresql.org/docs/17/sql-grant.html), [PG17 policies](https://www.postgresql.org/docs/17/sql-createpolicy.html), [Supabase roles](https://supabase.com/docs/guides/database/postgres/roles). Changelog consulted; no SDK or hosted upgrade performed.

## Exact machine routine census

All routines are in gov_repo, owned by govia_discovery_control_owner and pin pg_catalog, pg_temp. Hashes are SHA256 of PG17 pg_get_functiondef, including SQL-standard RETURN definitions. Tests additionally compare dollar-quoted bodies against migration source.

| Signature | Mode | Definition SHA256 |
|---|---|---|
| `gov_repo.machine_change_binding_v1(uuid,bigint,text,boolean,boolean,text,text)` | DEFINER | `18fc285512c210acbe136b6fad7f3ea09d0ad72e6892e59c9b335bc6cd083c93` |
| `gov_repo.machine_control_guard_v1()` | INVOKER | `eedf8a4ca6924a566fe41c51579e1cb226cb2443de3aaa24eb33e2fde072a0d1` |
| `gov_repo.machine_lock_eligibility_v1(uuid,bigint)` | DEFINER | `b6b77792d95421a153f6ef8c814c0b294575f870f66541e123025de482fe9e4f` |
| `gov_repo.machine_no_mutation_v1()` | INVOKER | `255fcee3e867f18a7dc4ae975e2542a86595111b8ebd5d183799671a543bb582` |
| `gov_repo.machine_normalized_locator_v1(text)` | INVOKER | `bcf4963e14fca005657cb3142eec9cbcaf2844eb701a3c1320cb1152be3a3a77` |
| `gov_repo.machine_provision_binding_v1(uuid,uuid,text,text,text,text,text,text,text,text,boolean,boolean,text,text)` | DEFINER | `a19c565426b558bc1298368b18314ac78e493fe58e79b45848ae7183f5720ec7` |
| `gov_repo.machine_provision_principal_v1(text,text,text,text)` | DEFINER | `38d5d1997297b2fd9ef14d7bb0b37317ee8e6f34710f17238bad57f6d9d4eae3` |
| `gov_repo.machine_record_revision_v1()` | INVOKER | `fa850e4f2f1ea8e4c862088db2c3cb6482cd3146d5dd56948efb236d50e89830` |
| `gov_repo.machine_register_generation_v1(uuid,text,timestamp with time zone,timestamp with time zone,text,text)` | DEFINER | `219dd2bc6c1cbb157ce70b851af7c1d01ca837ea47737e41bbb822a3eba9d17a` |
| `gov_repo.machine_require_provisioner_v1()` | INVOKER | `3f5ee51d81513d2ceecedd184957b89c3b79cb630701c507e5b8e684c9cb6ddb` |
| `gov_repo.machine_role_safe_v1(oid,text)` | INVOKER | `d86e14b16f090849761ea911296a9a1f8dda64e2cbe68ad6d7e0f0b6ad33a4aa` |
| `gov_repo.machine_set_generation_state_v1(uuid,text,text,text)` | DEFINER | `50857e88163da1b4257736b21b952b1fdcf22959da64bd735b675549b72e4c0c` |
| `gov_repo.machine_set_principal_state_v1(uuid,text,text,text)` | DEFINER | `3f8725291c5def1bcfcf2bd786b4575121df1632cd1a63984aabda20eedb2cd9` |
| `gov_repo.machine_source_connection_id_v1(text,text)` | INVOKER | `f75c16a61e92d1426e76066f7a3b2f6396f0278f1795f82a624e5dbe75d8c874` |

Only the six provisioning definers grant EXECUTE to provisioner/postgres. Eligibility remains internal. Audit owner can execute only the mutation-blocking trigger helper. Application/machine EXECUTE is absent. The fixture's closed eligibility probe exists only in disposable tests.

Next gate: **DISCOVERY MACHINE S2 — INDEPENDENT ADVERSARIAL REVIEW**.
