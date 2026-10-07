# Discovery machine F-1/F-2 — independent delta review evidence

Status: **READY FOR INDEPENDENT DELTA REVIEW**. This does not close the product
gate or authorize commit, merge, deployment, hosted work, or S1B.3.

Branch: `feat/m16-s1b-governed-registries`.
HEAD, unchanged: `df6d1ea0b9cc63798c2c9e22cc4122317fa8b384`.
The F-1/F-2 pass began with 52 dirty paths (13 tracked, 39 new). The controlled
resume found the existing two-file functional fix and S4 test adaptation already
present, with the HUMAN-before-PROPOSE integration scenario still outstanding.
The working tree was preserved throughout. The pass-start snapshot and hashes
are local scratch at `out/f1f2-baseline/`; only this pass's delta was reviewed.

## F-1 root cause and minimal fix

SQL already returned the correct `STATE_CONFLICT` result. The executor accepted
the outcome vocabulary, journaled it, then threw `MachineAuthorityError` because
only APPLIED/REPLAYED/READ could return. The orchestration independently rejected
everything except APPLIED/REPLAYED and propagated authority errors, aborting the
scan. No SQL correction was needed.

The executor now returns STATE_CONFLICT only for the `propose` command and only
with a valid non-DETECTED current review state. Malformed/impossible conflict
responses still throw. The orchestration returns from that item without adding
a proposal or a scan failure, then processes the next item. The existing database
invocation audit records the finding/run and STATE_CONFLICT; the existing journal
records the outcome. No second audit/result subsystem was added.

DENIED, CONTENT_CONFLICT, authentication, database/transport failures and other
invalid responses retain fatal handling. No raw fallback, HUMAN impersonation,
new authority, counter/reconciliation redesign or dependency change was made.

## F-1 integrated evidence

The existing real-pg/SCRAM/TLS integration fixture now includes two additional
cases, using its actual GitHub adapter with deterministic HTTP fixtures:

1. A two-item source is scanned. Immediately after the first DETECTED subject is
   admitted, a legitimate HUMAN actor invokes the unchanged governed wrapper for
   DETECTED -> REJECTED. The actual machine PROPOSE returns STATE_CONFLICT. The
   next item returns APPLIED. The scan and run finish SUCCEEDED, with exactly one
   proposal. The conflicted finding has no machine transition event, its HUMAN
   history is unchanged, and canonical objects remain absent.
2. The same source is rescanned: STATE_CONFLICT then REPLAYED, SUCCEEDED, zero new
   proposals. Each run contains exactly one finding-specific conflict invocation
   with no event ID. The journal contains the two conflict outcomes.
3. In a further scan, the generation is retired after the first subject admission
   and before PROPOSE. MACHINE_DENIED propagates; only one item reaches subject
   admission and run completion is not called. The existing tests also prove
   revoked/absent/foreign binding denial, authentication/TLS failure, HUMAN
   confirmation preservation, and rejection on a previously open generation.

F1-G1 through F1-G7: demonstrated by these assertions. Conflict handling changes
no transition history, no canonical data, and no proposal count for the conflict.

## F-2 final-horizon closure evidence

The new test-only S4 fixture builds on the existing S3 fixture, applies the exact
unchanged S4 migration under hostile function defaults (and the existing hostile
table/sequence defaults), and checks that the HUMAN callable inventory is
unchanged. `M16_DISCOVERY_HORIZON=S4` selects it in the three existing adversarial
suites. With the variable absent, their historical S3 horizon is preserved.

The tests retain actual adversarial LOGIN execution, not merely catalog checks:

- Exactly 11 machine commands, 22 HUMAN functions, seven retained raw functions.
- PUBLIC ACL inspection plus actual PUBLIC-only/anon/authenticated/service_role
  denial of the machine proposal/audit helper; raw transition calls denied for
  both machine LOGIN and service_role.
- Owners verified NOLOGIN/NOSUPERUSER/NOBYPASSRLS, without unexpected memberships;
  exact new definer owners checked. Attempts to SET ROLE to privileged roles and
  owners fail. Selecting the already-granted caller group confers no owner access.
  No claim is made that selecting that existing caller group itself is forbidden.
- Transitive routine/trigger/CHECK/RLS traversal checks search paths, private
  helpers and absence of runtime dynamic SQL. The private raw transition edge is
  permitted only inside the S4 propose command; it remains uncallable by LOGIN.
- Role-safety attacks inject extra helpers, definers, overloads, table grants,
  schema CREATE and membership. Actual command admission denies them. Rename,
  owner and OID-recreation drift also deny admission.
- **150 noncertified routine invocations denied**.
- **131 tables x five direct operations probed**: SELECT, INSERT, UPDATE, DELETE,
  TRUNCATE. Zero effective direct table privileges, including canonical and audit
  stores. Frozen unconditional DO INSTEAD NOTHING rules may eliminate UPDATE or
  DELETE before ACL evaluation; those remain no-ops rather than successful DML.
- **115 protected-store checksums unchanged**, including canonical, HUMAN and
  control-plane stores; foreign run provenance unchanged. S4's legitimate
  invocation-audit appends are explicitly allowed in the checksum inventory;
  direct audit DML is still tested and denied. An intake-only binding cannot
  invoke PROPOSE successfully or produce a transition event.
- Hostile temporary objects, search_path and forged request JWT GUCs do not
  redirect the qualified command or replace session identity.
- Final-horizon authority tests retain disablement/revocation/revision checks,
  current-generation replay, concurrent admission and expiry during a real lock
  wait with rollback of tentative writes.

F2-G1 through F2-G7: demonstrated. S4 production SQL and its postflight were not
changed. The original S3 postflight tests remain on their historical horizon;
additional owner postflight work (F-4) remains deferred.

## Commands and results

All counts are Node-reported counts, including parent tests. Zero failures,
zero skipped tests in the final runs; 162 tests in total.

From repository root — worker integration **8/8**, including F-1:

```powershell
$env:M16_PG17_BIN='D:\code-guard-governance\out\m16-tools\pgsql\bin'
npm test --workspace=apps/discovery-worker
```

From `apps/dashboard` — post-S4 closure, compromised worker and authority **16/16**:

```powershell
$env:M16_PG17_BIN='D:\code-guard-governance\out\m16-tools\pgsql\bin'
$env:M16_DISCOVERY_HORIZON='S4'
node --conditions=react-server --import tsx --test tests/postgres-m16/discovery-machine-intake-closure.test.ts tests/postgres-m16/discovery-machine-intake-compromised-worker.test.ts tests/postgres-m16/discovery-machine-intake-authority.test.ts
```

From `apps/dashboard` — service/cutover/HUMAN regression **138/138**:

```powershell
node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/discovery-intake-service.test.ts tests/governed-write-cutover.test.ts
```

From root — both typechecks **PASS**:

```powershell
npm run typecheck --workspace=apps/discovery-worker
npm run typecheck:dashboard -- --incremental false
```

Logs: `out/f1-worker-integrated.log`, `out/f2-s4-adversarial.log`,
`out/discovery-cutover-tests.log`. These are ignored local scratch.

## Files changed in this F-1/F-2 pass

| Path | Change |
| --- | --- |
| `apps/discovery-worker/src/executor.ts` | Return the valid PROPOSE conflict item outcome; retain fatal handling otherwise |
| `apps/discovery-worker/src/discovery-intake.ts` | Continue after the audited conflicted item, without counting a proposal |
| `apps/dashboard/tests/postgres-m16/discovery-machine-worker.test.ts` | Integrated HUMAN interleaving/rescan and fatal retirement cases |
| `apps/dashboard/tests/helpers/discovery-machine-s4-fixtures.ts` | New test-only final-horizon fixture with hostile defaults |
| `apps/dashboard/tests/postgres-m16/discovery-machine-intake-closure.test.ts` | Reuse closure/role-safety at S4 with its exact permitted surface |
| `apps/dashboard/tests/postgres-m16/discovery-machine-intake-compromised-worker.test.ts` | Reuse actual invocation/DML/search_path attacks and checksums at S4 |
| `apps/dashboard/tests/postgres-m16/discovery-machine-intake-authority.test.ts` | Select S4 for existing authority/concurrency cases |
| `docs/codex/evidence/2026-10-06-discovery-machine-f1-f2-delta.md` | This delta evidence |

The sole functional change is eight added lines in the two worker source files.
The remaining changes are tests, a test fixture and evidence. No migration,
dependency, HUMAN adapter, RLS policy, postflight or architecture file changed.
The pre-existing `apps/dashboard/tsconfig.tsbuildinfo` and all other initial dirty
paths outside this delta remain byte-identical to the pass-start snapshot.

## Conformance and deferred findings

- ARCHITECTURE CONFORMANCE: PASS — authority boundaries and frozen architecture unchanged.
- ROADMAP CONFORMANCE: PASS — only the current post-review gate; no S1B.3 or hosted work.
- SCOPE CONFORMANCE: PASS — F-1 functional fix and F-2 test evidence only.
- ANTI-LOOP CHECK: PASS — resumed existing changes, targeted proof, no reopened architecture audit.

F-3 USING(true): DEFERRED. F-4 additional owner postflight: DEFERRED.
F-5 journal classification: DEFERRED. F-6 SCRAM/channel binding/tsx runtime:
DEFERRED. F-7 counters/runs reconciliation: DEFERRED.

Next gate: independent review of this F-1/F-2 delta, then explicit closure by the
architecture control plane and Carlos. That gate has not been started here.
