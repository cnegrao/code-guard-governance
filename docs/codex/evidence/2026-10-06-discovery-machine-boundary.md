# Governed Discovery machine boundary — integrated local proof

Date: 2026-10-06. Branch: `feat/m16-s1b-governed-registries`.
Initial and final HEAD: `df6d1ea0b9cc63798c2c9e22cc4122317fa8b384`.
Result: **DISCOVERY GOVERNED PATH — PASS**, for the implemented local boundary.
No commit, push, merge, PR, deploy, hosted mutation, or S1B.3 work was performed.
The pre-existing dirty `apps/dashboard/tsconfig.tsbuildinfo` was preserved.

The existing S1/S2/S3 implementation was reused. The 32 unchanged reused files
were compared byte-for-byte with `D:/govia-worktrees/discovery-machine-s3`.
The older evidence documents describe their original slice/worktree horizons;
this record describes the assembled implementation and final local checks.

## Implementation and flow

The persistence-neutral `runGovernanceDiscoveryScan` orchestration was extracted
to `apps/discovery-worker`; the dashboard retains compatibility exports with no
privileged default adapters. Its production CLI composes only the restricted
machine executor. Explicit domain-test ports remain injectable. The existing
HUMAN adapter and governance semantics were not changed.

GitHub fixture -> existing `GitHubSourceAdapter` -> existing Discovery pipeline
-> machine run admission -> DB-derived organisation/principal/generation/binding
-> atomic evidence/assertion and finding/candidate admissions -> DETECTED subject
-> `propose_discovery_finding_v1` -> fixed DETECTED-to-PROPOSED event -> audited
run completion. Technical-profile, execution-source and lineage intake use the
same closed commands. Current eligibility is rechecked for reads and replay.

The real executor has a bounded `pg` pool, SCRAM-capable LOGIN authentication,
verified TLS, fixed parameterized SQL, and an fsync'd operational journal.
Authority failures stop dependent work. Database outcomes and invocation audit
commit atomically; transport/aborted/unknown-commit attempts remain in the local
journal. No SQL, password, source token or raw database error is logged.

The final integration corrections were atomic finding/candidate admission and
run-completion proposal counts checked against committed audit events for that
exact attempt. The count extension lives in the new migration; S3 was not edited.
A negative test was corrected to attempt canonical INSERT: historical canonical
DELETE is rewritten to a no-op by an existing rule, so expecting SQLSTATE 42501
for that no-op was incorrect. No production protection changed for that test.

## Migration boundary

- S2: five control/audit tables, principal and credential-generation lifecycle,
  immutable binding identities/revisions, role safety and locked eligibility.
- S3: `discovery_run_bindings`, `discovery_machine_admissions`, ten restricted
  intake/read commands, semantic identity checks and append-only provenance.
- `20261006134858_discovery_machine_propose_worker_v1.sql`: created with Supabase
  CLI `migration new discovery_machine_propose_worker_v1`; adds the fixed PROPOSE
  function, private audit helper and NOLOGIN propose owner. Adds invocation audit
  to the ten intake commands, verified proposal counts, and recertifies the
  machine-only callable surface. Historical migrations are unchanged.
- Machine LOGINs receive only the 11 closed commands, with no direct table or
  provisioning authority. Internal owners use RLS and narrowly scoped grants.
  The propose owner can update only subject state/transition/revision, with
  `WITH CHECK(state='PROPOSED')`. Its run UPDATE grant permits locking only
  (`WITH CHECK(false)`).
- `apply_review_transition` remains unavailable to machine LOGINs, `service_role`
  and application callers. Only the private NOLOGIN propose owner receives its
  internal EXECUTE grant, used with fixed state and actor arguments. There is no
  application raw fallback. The HUMAN callable census remains 22.

## Final test commands and results

All final executed suites below passed with zero failures and zero skips.
Node's reported test counts include parent tests where applicable.

Unit contracts/source identity — **69 tests**, from repository root:

```powershell
node --import tsx --test packages/governance-review/test/discovery-machine-contracts.test.ts packages/governance-review/test/discovery-machine-identity.test.ts packages/governance-review/test/discovery-machine-s3-contracts.test.ts packages/scanner/test/discovery-engine/github-source-identity.test.ts packages/scanner/test/discovery-engine/source-identity.test.ts
```

Repository/service and HUMAN governed-write regression — **138 tests**,
from `apps/dashboard`:

```powershell
node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/discovery-intake-service.test.ts tests/governed-write-cutover.test.ts
```

Short SQL/migration regression — **27 tests** (including the pure historical
horizon check), from `apps/dashboard`, on disposable PostgreSQL 17 via psql:

```powershell
$env:M16_PG17_BIN='D:\code-guard-governance\out\m16-tools\pgsql\bin'
node --conditions=react-server --import tsx --test tests/postgres-m16/discovery-machine-control-plane.test.ts tests/postgres-m16/discovery-machine-intake-authority.test.ts tests/postgres-m16/discovery-machine-intake-closure.test.ts tests/postgres-m16/discovery-machine-horizon.test.ts
```

True integrated local flow — **6 tests** (parent plus five cases), from root:

```powershell
$env:M16_PG17_BIN='D:\code-guard-governance\out\m16-tools\pgsql\bin'
npm test --workspace=apps/discovery-worker
```

This uses the real `pg` client, a dedicated authenticated LOGIN, SCRAM, verified
TLS and PostgreSQL 17. The existing GitHub adapter receives deterministic
simulated HTTP responses; the database and machine executor are not mocked.
The fixture proves the complete producer corpus reaches PROPOSED, database tenant
derivation despite a forged input tenant, zero canonical materialization,
correct machine audit/event actor, denied bindings/raw/direct writes, invalid
password/CA/plaintext denial, HUMAN confirmation followed by a machine replay,
and loss of authority on an already-open generation after retirement.

The **five SQL PROPOSE tests already closed before the resume were not rerun**:

```powershell
# Previously passed, from apps/dashboard with M16_PG17_BIN configured:
node --conditions=react-server --import tsx --test tests/postgres-m16/discovery-machine-propose.test.ts
```

Those cover single application/replay, fixed actor/IDs, forbidden authority,
cross-tenant/missing run/intake-only binding, and replacement-binding re-admission.
The final migration version is additionally applied and exercised by the real
integration suite above. Total final-run tests: 240; plus 5 closed SQL tests.

Typechecks — both PASS, from root:

```powershell
npm run typecheck --workspace=apps/discovery-worker
npm run typecheck:dashboard -- --incremental false
```

Local logs (ignored scratch, not deliverable source):
`out/discovery-machine-unit.log`, `out/discovery-cutover-tests.log`,
`out/discovery-machine-sql-regression.log`, `out/discovery-machine-worker.log`,
and the retained `out/discovery-machine-propose.log`.

## Security gates

| Gate | Result and evidence |
| --- | --- |
| G1 principal | PASS: session LOGIN OID/name and current generation; control-plane tests and actual SCRAM login |
| G2 binding | PASS: absent/revoked/foreign binding denies an integrated scan before admission |
| G3 command | PASS: fixed proposal, deterministic identity and replay; SQL plus real scan |
| G4 ceiling | PASS: no alternate command state; direct subject update/canonical insert denied; all machine-created states PROPOSED |
| G5 cutover | PASS: real scan uses the isolated executor; compatibility export has no privileged defaults |
| G6 raw | PASS: authenticated machine raw invocation denied; no fallback; migration postflight also checks service_role |
| G7 HUMAN | PASS: 138 service/cutover checks and real governed HUMAN confirmation preserved on machine rescan |
| G8 tenant | PASS: DB derives tenant; foreign binding/foreign run denied; current-run admission required |
| G9 audit | PASS: DETERMINISTIC_RULE / PASS_THROUGH_V1 / 1.0; LOGIN/generation/tenant provenance and transactional invocation audit |
| G10 integration | PASS: real PostgreSQL 17 + pg + SCRAM/TLS + existing adapter + simulated GitHub HTTP + complete local scan |

## Final review and limits

Reviewed the new worker, SQL, tests and dependency diff, including the moved
orchestration compared with its baseline body. Reused files were verified against
the existing S3 worktree without restarting architecture review. No permissions
were added to the HUMAN/app callable surface. Existing lockfile dependency
versions were not changed; three existing dev-only flags became runtime flags
because the worker uses tsx. No generated build artifact was added.

This is local evidence, not deployment evidence. No real GitHub API or hosted
database was contacted by the integration test. The existing migration fixture
uses a pgvector stand-in, with vector behavior outside scope. The README records
the required separate runtime secret scope and trusted out-of-band provisioning.
There are no remaining blockers for the requested local implementation/proof.

`git diff --check` and individual whitespace checks for every new file pass.
The final inventory below includes new files, which ordinary `git diff --stat`
does not include, and distinguishes the pre-existing tsbuildinfo modification.

## Exact final file inventory

| File | Purpose |
| --- | --- |
| `apps/dashboard/lib/governance/discovery-intake.ts` | Compatibility export without privileged defaults |
| `apps/dashboard/lib/governance/execution-context-intake.ts` | Compatibility export of reused execution-source assembly |
| `apps/dashboard/tests/discovery-intake-service.test.ts` | Point safety assertion at extracted orchestration |
| `apps/dashboard/tests/governed-write-cutover.test.ts` | Assert isolated Discovery cutover; preserve HUMAN regression |
| `apps/dashboard/tests/helpers/discovery-machine-s2-fixtures.ts` | Control-plane fixture on historical R3 |
| `apps/dashboard/tests/helpers/discovery-machine-s3-fixtures.ts` | Restricted intake fixture and existing producer corpus |
| `apps/dashboard/tests/helpers/disposable-m16-postgres.ts` | Keep exact historical migration horizon |
| `apps/dashboard/tests/postgres-m16/discovery-machine-control-plane.test.ts` | Control-plane lifecycle, ACL, identity and concurrency tests |
| `apps/dashboard/tests/postgres-m16/discovery-machine-horizon.test.ts` | Historical migration horizon/order/identity test |
| `apps/dashboard/tests/postgres-m16/discovery-machine-intake-admission.test.ts` | Observation and support admission tests |
| `apps/dashboard/tests/postgres-m16/discovery-machine-intake-authority.test.ts` | Current eligibility, revocation, rotation, locking and replay tests |
| `apps/dashboard/tests/postgres-m16/discovery-machine-intake-closure.test.ts` | Closed capability, ACL and RLS checks |
| `apps/dashboard/tests/postgres-m16/discovery-machine-intake-compromised-worker.test.ts` | Adversarial intake payload tests |
| `apps/dashboard/tests/postgres-m16/discovery-machine-intake-finding.test.ts` | Finding, candidate and subject admission tests |
| `apps/dashboard/tests/postgres-m16/discovery-machine-intake-identity-parity.test.ts` | TypeScript/PostgreSQL identity parity tests |
| `apps/dashboard/tests/postgres-m16/discovery-machine-intake-run.test.ts` | Run provenance and completion tests |
| `apps/dashboard/tests/postgres-m16/discovery-machine-propose.test.ts` | Closed SQL PROPOSE proof (five previously passed tests) |
| `apps/dashboard/tests/postgres-m16/discovery-machine-worker.test.ts` | Real pg/SCRAM/TLS integration, authority negatives and HUMAN replay |
| `apps/dashboard/tsconfig.tsbuildinfo` | PRE-EXISTING modification; preserved, outside implementation |
| `apps/discovery-worker/README.md` | Runtime isolation, configuration and local validation instructions |
| `apps/discovery-worker/package.json` | Independent worker workspace and integration test entry point |
| `apps/discovery-worker/src/discovery-intake.ts` | Reused scan orchestration with explicit machine admission/proposal |
| `apps/discovery-worker/src/envelope.ts` | Pure canonical envelope hashing helper |
| `apps/discovery-worker/src/execution-source.ts` | Reused execution-source assembly without dashboard persistence |
| `apps/discovery-worker/src/executor.ts` | Closed pg executor, verified TLS and durable operational journal |
| `apps/discovery-worker/src/main.ts` | Standalone CLI and inherited-authority environment rejection |
| `apps/discovery-worker/tsconfig.json` | Isolated worker typecheck |
| `docs/codex/evidence/2026-10-02-discovery-machine-s1.md` | Reused historical slice evidence, unchanged |
| `docs/codex/evidence/2026-10-02-discovery-machine-s2.md` | Reused historical slice evidence, unchanged |
| `docs/codex/evidence/2026-10-03-discovery-machine-s3.md` | Reused historical slice evidence, unchanged |
| `docs/codex/evidence/2026-10-06-discovery-machine-boundary.md` | Final integrated evidence and exact file inventory |
| `package-lock.json` | Resolve isolated worker dependencies |
| `packages/governance-review/src/discovery-machine/contracts.ts` | Branded machine identity, authority and outcome contracts |
| `packages/governance-review/src/discovery-machine/identity.ts` | Unchanged deterministic subject/command/event identity |
| `packages/governance-review/src/discovery-machine/index.ts` | Machine contract barrel |
| `packages/governance-review/src/discovery-machine/ports.ts` | Closed typed intake/proposal commands and parsers |
| `packages/governance-review/src/index.ts` | Export machine contracts |
| `packages/governance-review/test/discovery-machine-contracts.test.ts` | Closed command and authority contract tests |
| `packages/governance-review/test/discovery-machine-identity.test.ts` | Deterministic proposal identity tests |
| `packages/governance-review/test/discovery-machine-s3-contracts.test.ts` | Intake contract and strict-envelope tests |
| `packages/governance-review/test/fixtures/discovery-machine-identity-vectors.json` | Independent deterministic identity vectors |
| `packages/scanner/package.json` | Expose narrow discovery entry point |
| `packages/scanner/src/discovery/adapters/github-source-adapter.ts` | Resolve repository pin; reject redirects and mismatched source |
| `packages/scanner/src/discovery/index.ts` | Export identity APIs and DiscoveryPipelineFailure |
| `packages/scanner/src/discovery/provenance.ts` | Reuse unchanged source-connection identity derivation |
| `packages/scanner/src/discovery/source-adapter.ts` | Optional provider identity capability |
| `packages/scanner/src/discovery/source-identity.ts` | Deterministic source identity and strict locator/ref parsing |
| `packages/scanner/test/discovery-engine/github-source-identity.test.ts` | GitHub repository identity/redirect tests |
| `packages/scanner/test/discovery-engine/source-identity.test.ts` | Locator/ref parsing and deterministic source identity tests |
| `supabase/migrations/20261002190148_discovery_machine_s2_control_plane_v1.sql` | Reused S2 control-plane migration, unchanged |
| `supabase/migrations/20261003011750_discovery_machine_s3_restricted_intake_v1.sql` | Reused S3 restricted-intake migration, unchanged |
| `supabase/migrations/20261006134858_discovery_machine_propose_worker_v1.sql` | Fixed PROPOSE, audit, completion counts and machine attestation |

Boundary scope: 51 files; +7721 / -819 lines (new files included).
Pre-existing tsbuildinfo: one further file, +1 / -1; preserved outside scope.
