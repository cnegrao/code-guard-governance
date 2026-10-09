import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// M16 security profile: real identity/RLS/default privileges before credential cutover.
export const credentialMigration = '20260925150000_m16_s0_credential_epoch_v1.sql';
// S0.3.2 chain step: applied after credentialMigration by its own test file.
export const eligibilityMigration = '20260925160000_m16_s0_transactional_eligibility_v1.sql';
// S0.3.2R chain step: replaces the four-argument helper with the epoch-bound five-argument helper.
export const epochBindingMigration = '20260925170000_m16_s0_credential_epoch_binding_v1.sql';
// S0.3.3B0 chain step (committed, audited, CLOSED): fixes materialize_object_reconciliation's
// PG17-incompatible ON CONFLICT before the S0.3.3B wrappers are layered over it. Applied after
// epochBindingMigration and before governedWriteWrapperMigration; never re-authored here.
export const objectMaterializationCompatMigration = '20260925175000_m16_s0_object_materialization_rule_compat_v1.sql';
// S0.3.3B chain step: governed write wrappers over the real authoritative write functions.
export const governedWriteWrapperMigration = '20260925180000_m16_s0_governed_write_wrappers_v1.sql';
// S0.3.3D chain step: revokes service_role/PUBLIC/anon/authenticated EXECUTE on the seven
// now-unused raw write RPCs (the CONTRACT half of S0.3.3's expand/contract). Applied after
// governedWriteWrapperMigration; never re-authored here.
export const contractRawRpcRevocationMigration = '20260928190000_m16_s0_contract_raw_write_rpc_revocation_v1.sql';
// M16-S1A.1 chain step: L14 Authority Policy foundation + first-policy bootstrap. Applied after
// contractRawRpcRevocationMigration on the full governance chain; never re-authored here.
export const l14AuthorityPolicyMigration = '20260929120000_m16_s1a_l14_authority_policy_v1.sql';
// M16-S1A.2 chain step: additive successor lifecycle on top of l14AuthorityPolicyMigration.
export const l14AuthorityPolicySuccessorMigration = '20260929130000_m16_s1a2_l14_authority_policy_successor_v1.sql';
// M16-S1A.2R1 chain step: additive no-resurrection corrective (F-1/F-2) on top of the successor migration.
export const l14NoResurrectionMigration = '20260929140000_m16_s1a2r1_l14_no_resurrection_v1.sql';
// M16-S1B.0 chain step: additive governed-registry framework + typed target-scope evidence. Applied
// only by the S1B migration horizon (m16-l14-fixtures.ts); the S1A horizon ends at S1A.2R1.
export const l14RegistryFrameworkMigration = '20260930120000_m16_s1b0_l14_registry_framework_v1.sql';
// M16-S1B.1 chain step: additive GOVERNANCE_PARTY registry + PII boundary on top of S1B.0. Applied
// only by the S1B1 migration horizon; the S1A and S1B0 horizons end before it.
export const l14GovernancePartyMigration = '20260930130000_m16_s1b1_l14_governance_party_v1.sql';
// M16-S1B.1R1 chain step: additive pending-cancellation corrective (REVOKE at >= the target's
// effective_from). Applied only by the S1B1R1 horizon; the S1B1 horizon ends before it.
export const l14GovernancePartyPendingCancelMigration = '20260930140000_m16_s1b1r1_governance_party_pending_cancel_v1.sql';
// M16-S1B.2 chain step: additive hardening of the REUSED policy stores (governance_policies /
// policy_versions). Applied only by the S1B2 horizon, which also needs policyStorePrerequisites.
export const l14PolicyStoreHardeningMigration = '20260930150000_m16_s1b2_policy_store_hardening_v1.sql';
// M16-S1B.2R1 chain step: closed application SECURITY DEFINER surface (22) + least-privilege technical
// owners. Applied only on the FULL primary chain (fullPrimaryChain), which is its canonical target.
export const definerCapabilitySurfaceMigration = '20260930160000_m16_s1b2r1_definer_capability_surface_v1.sql';
// M16-S1B.2R2 chain step: pins the runtime routines' execution closure to search_path with pg_temp named last
// (no body/owner/ACL change). Applied after definerCapabilitySurfaceMigration on the full primary chain only.
export const runtimeExecutionClosureMigration = '20260930170000_m16_s1b2r2_runtime_execution_closure_v1.sql';
// M16-S1B.2R3 chain step: pins the frozen S0 governed wrappers' inner execution closure to search_path with pg_temp named
// last (no body/owner/ACL change). Applied after runtimeExecutionClosureMigration on the full primary chain only.
export const s0ExecutionContextClosureMigration = '20260930180000_m16_s1b2r3_s0_execution_context_closure_v1.sql';
// Canonical migrations AFTER the R3 horizon, in timestamp order: the governed discovery machine S2 / S3 / S4 slices
// (their own fixtures apply them with extra adversarial checks) and M16-S1B.3 policy content admission. Applied
// verbatim after R1/R2/R3 only by the S1B3 L14 horizon; every historical horizon keeps its exact chain.
export const postR3PrimaryChainMigrations = [
  '20261002190148_discovery_machine_s2_control_plane_v1.sql',
  '20261003011750_discovery_machine_s3_restricted_intake_v1.sql',
  '20261006134858_discovery_machine_propose_worker_v1.sql',
] as const;
export const l14PolicyAdmissionMigration = '20261007120000_m16_s1b3_policy_admission_v1.sql';
// M16-S1B.4 chain step: POLICY_VERSION governance validation on top of S1B.3. Applied only by the S1B4 L14 horizon;
// the S1B3 horizon (and every older one) keeps its exact chain and its exact historical postflight expectations.
export const l14PolicyVersionValidationMigration = '20261008120000_m16_s1b4_policy_version_validation_v1.sql';
// M16-S1B.5 chain step: BUSINESS_DOMAIN / INFORMATION_DOMAIN governed registries on top of S1B.4. Applied only by the S1B5
// L14 horizon; the S1B4 horizon (and every older one) keeps its exact chain and its exact historical postflight expectations.
export const l14DomainRegistryMigration = '20261008180000_m16_s1b5_domain_registries_v1.sql';
// M16-S1B.6 chain step: CONTROL_DEFINITION registry + immutable definition versions on top of S1B.5. Applied only by the S1B6
// L14 horizon; the S1B5 horizon (and every older one) keeps its exact chain and its exact historical postflight expectations.
export const l14ControlDefinitionRegistryMigration = '20261008200000_m16_s1b6_control_definition_registry_v1.sql';
// M16-S1C.1 chain step: RESPONSIBILITY_ASSIGNMENT (the first authoritative M16 fact family) on top of S1B.6. Applied only by the
// S1C1 L14 horizon; the S1B6 horizon (and every older one) keeps its exact chain and its exact historical postflight expectations.
export const l14ResponsibilityAssignmentMigration = '20261008220000_m16_s1c1_responsibility_assignment_v1.sql';
// M16-S1C.2 chain step: BUSINESS_CONTEXT_ASSIGNMENT (the second authoritative M16 fact family) on top of S1C.1. Applied only by the
// S1C2 L14 horizon; the S1C1 horizon (and every older one) keeps its exact chain and its exact historical postflight expectations.
export const l14BusinessContextAssignmentMigration = '20261009120000_m16_s1c2_business_context_assignment_v1.sql';
// M16-S1C.1R1 chain step: S1C.1 Party dependency commit-boundary closure on top of S1C.2. Applied only by the S1C1R1 L14 horizon;
// the S1C2 horizon (and every older one) keeps its exact chain and its exact historical postflight expectations.
export const l14PartyDependencyGuardMigration = '20261009121000_m16_s1c1r1_party_dependency_guard_v1.sql';
// The only statement of the full chain that needs a real pgvector index access method.
export const hnswIndexMigration = '20260818004053_agent_registry_graph_part_3.sql';
const migrationsDirectory = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));
/**
 * Every canonical migration under supabase/migrations (the ONLY Governance Core migration authority), in
 * timestamp order, ending before S1B.2R1 (S1B.2R1, S1B.2R2 and S1B.2R3 are applied on top by fullChainCluster). Noncanonical roots (apps/dashboard/supabase-setup-8.2.sql,
 * apps/extension/supabase/migrations, graphos-complete/supabase/migrations) are never composed here.
 */
export function fullPrimaryChainMigrations(): readonly string[] {
  const names = readdirSync(migrationsDirectory).filter(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
  return historicalPrimaryChainMigrations(names);
}
/** Explicit R3 horizon: later additive migrations belong to their own fixtures, never old suites. */
export function historicalPrimaryChainMigrations(names: readonly string[]): readonly string[] {
  assert.deepEqual([...names], [...names].sort(), 'canonical migration order');
  assert.equal(new Set(names).size, names.length, 'unique migration identities');
  const historical = names.filter(name => name <= s0ExecutionContextClosureMigration);
  assert.deepEqual(historical.slice(-3), [definerCapabilitySurfaceMigration, runtimeExecutionClosureMigration, s0ExecutionContextClosureMigration]);
  return historical.slice(0, -3);
}
// Real governance persistence chain (same order/content as the M15 profile, WITHOUT the M15
// runtime/cross-signal tail) needed by the six real underlying authoritative write functions.
// Applied chronologically AFTER the broad service_role default-grant migration, so tables and
// functions receive the same legacy default privileges as production (nothing is stubbed).
export const governanceWriteChain = [
  '20260905060000_governance_persistence_v1.sql',
  '20260906120000_canonical_materialization_v1.sql',
  '20260906180000_discovery_intake_v1.sql',
  '20260906190000_governance_workspace_queue_v1.sql',
  '20260907120000_discovery_governance_input_persistence_v1.sql',
  '20260907130000_reconciliation_materialization_workspace_v1.sql',
  '20260908120000_agent_version_technical_profile_persistence_v1.sql',
  '20260909210640_relationship_decision_to_truth_v1.sql',
  '20260911120904_lineage_support_observations_v1.sql',
  '20260911184613_technical_field_governance_v1.sql',
  '20260915230551_execution_context_v1.sql',
];
export const m16Prerequisites = [
  '20260818003539_gov_repo_types_and_organisations.sql',
  '20260818003710_gov_repo_identity_and_ledger.sql',
  '20260818013113_grant_service_role_gov_repo_access.sql',
  '20260903200000_canonical_email_identity.sql',
  '20260903200100_atomic_signup_legacy_rpc.sql',
];
/**
 * Existing (never edited, never copied) migrations that create and shape the reused policy stores.
 * Merged chronologically into m16Prerequisites only when DisposableM16Options.policyStorePrerequisites
 * is set (the S1B2 horizon), so every historical horizon keeps its exact chain:
 * - 003755 part_1 creates gov_repo.governance_policies and gov_repo.policy_versions (the historical
 *   ON DELETE CASCADE version FK, the USING(true)/org-scoped RLS policies, the updated_at trigger) and
 *   gov_repo.mandates, which part_2's policy_mandate_mappings references.
 * - 003822 part_2 completes the same unit: policy_versions indexes/RLS policies, the legacy
 *   governance_policies.current_version_id -> policy_versions FK, and policy_mandate_mappings.
 * - 003836 part_3 is the tail of the same split migration (the gov_repo.evidence indexes/RLS and
 *   evidence_files); no deployed database holds parts 1-2 without it.
 * All three precede 20260818013113, so its hostile blanket GRANT ALL lands on them exactly as in production.
 * - 134812 (after 013113) adds governance_policies_organisation_policy_unique (organisation_id, policy_id),
 *   the parent key the S1B.2 tenant-safe version FK must reuse, and the invoker mapping triggers that
 *   read governance_policies.
 */
export const policyStorePrerequisites = [
  '20260818003755_gov_repo_policies_risks_evidence_part_1.sql',
  '20260818003822_gov_repo_policies_risks_evidence_part_2.sql',
  '20260818003836_gov_repo_policies_risks_evidence_part_3.sql',
  '20260901134812_policy_mandate_mapping_tenant_isolation.sql',
];
export function m16PrerequisiteChain(policyStore = false): readonly string[] {
  if (!policyStore) return m16Prerequisites;
  // Timestamped names sort chronologically: the three parts land before the broad-grant migration.
  const chain = [...m16Prerequisites, ...policyStorePrerequisites].sort();
  assert.ok(chain.indexOf('20260818013113_grant_service_role_gov_repo_access.sql') > chain.indexOf(policyStorePrerequisites[2])
    && chain.indexOf('20260818013113_grant_service_role_gov_repo_access.sql') < chain.indexOf(policyStorePrerequisites[3]));
  return chain;
}
export function migrationSource(name: string) {
  assert.ok([...m16Prerequisites, ...policyStorePrerequisites, ...governanceWriteChain, credentialMigration, eligibilityMigration, epochBindingMigration, objectMaterializationCompatMigration, governedWriteWrapperMigration, contractRawRpcRevocationMigration, l14AuthorityPolicyMigration, l14AuthorityPolicySuccessorMigration, l14NoResurrectionMigration, l14RegistryFrameworkMigration, l14GovernancePartyMigration, l14GovernancePartyPendingCancelMigration, l14PolicyStoreHardeningMigration, definerCapabilitySurfaceMigration, runtimeExecutionClosureMigration, s0ExecutionContextClosureMigration, ...postR3PrimaryChainMigrations, l14PolicyAdmissionMigration, l14PolicyVersionValidationMigration, l14DomainRegistryMigration, l14ControlDefinitionRegistryMigration, l14ResponsibilityAssignmentMigration, l14BusinessContextAssignmentMigration, l14PartyDependencyGuardMigration].includes(name)
    || fullPrimaryChainMigrations().includes(name));
  return readFileSync(fileURLToPath(new URL(`../../../../supabase/migrations/${name}`, import.meta.url)), 'utf8');
}

export interface DisposableM16Options {
  /** Apply the real governance persistence chain (S0.3.3B). Off keeps the S0.3.1/S0.3.2 profiles unchanged. */
  readonly governanceWriteChain?: boolean;
  /** Merge policyStorePrerequisites into the prerequisite chain (S1B2 horizon only). Off keeps every older profile unchanged. */
  readonly policyStorePrerequisites?: boolean;
  /**
   * Apply EVERY canonical migration (fullPrimaryChainMigrations) instead of the historical horizons: the
   * S1B.2R1 target. Uses real pgvector when installed; otherwise a disposable, labelled stand-in type (text
   * I/O + typmod, vector_dims, <=>) registered as extension "vector", and then the one HNSW index statement is
   * the only statement allowed to fail (asserted exactly). Excludes governanceWriteChain/policyStorePrerequisites.
   */
  readonly fullPrimaryChain?: boolean;
}

export async function disposableM16Postgres(diagnostic: (message: string) => void, options: DisposableM16Options = {}) {
  const bin = process.env.M16_PG17_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/17/bin' : '');
  // Never inherit libpq service, connection, options, or credential overrides.
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('PG')) delete env[key];
  Object.assign(env, { PGHOSTADDR: '127.0.0.1', PGCONNECT_TIMEOUT: '5', PGCLIENTENCODING: 'UTF8' });
  function run(name: string, args: string[], input?: string): string {
    const result = spawnSync(bin ? join(bin, name) : name, args, {
      env, input, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024,
      // A Windows postgres descendant can retain pg_ctl's pipe handles.
      // Server diagnostics go to -l; no inherited pipes may keep this call open.
      stdio: name === 'pg_ctl' ? 'ignore' : 'pipe',
    });
    if (result.error || result.status !== 0) {
      throw new Error(`${name} failed: ${result.error?.message ?? result.status}\n${result.stderr ?? ''}\n${result.stdout ?? ''}`);
    }
    return result.stdout?.trim() ?? '';
  }
  for (const name of ['initdb', 'pg_ctl', 'psql']) run(name, ['--version']);
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'govia-m16-pg17-')));
  const data = join(directory, 'data');
  const log = join(directory, 'server.log');
  const port = await new Promise<number>((accept, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      server.close(error => error ? reject(error) : accept(address.port));
    });
  });
  let started = false;
  const sessions = new Set<ChildProcess>();
  function stop() {
    for (const child of sessions) child.kill();
    sessions.clear();
    if (started || existsSync(join(data, 'postmaster.pid'))) {
      run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '30', 'stop']);
      started = false;
    }
    // Only the unique directory allocated above; never a supplied DB/data path.
    assert.equal(dirname(resolve(data)), directory);
    assert.ok(directory.startsWith(realpathSync(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')));
    rmSync(directory, { recursive: true, force: true });
    diagnostic('Disposable PostgreSQL stopped; temporary cluster removed');
  }
  type Role = 'postgres' | 'service_role' | 'm16_bootstrap' | 'anon' | 'authenticated';
  // Separate actual login roles: application DML never runs as the bootstrap user.
  // Async psql permits tests with concurrent writer/migration sessions.
  const sql = (query: string, role: Role = 'service_role'): Promise<string> => new Promise((accept, reject) => {
    const child = spawn(bin ? join(bin, 'psql') : 'psql', [
      '-X', '-q', '-A', '-t', '-h', '127.0.0.1', '-p', String(port), '-U', role, '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    ], { env, windowsHide: true, stdio: 'pipe' });
    let out = '', err = '';
    const timeout = setTimeout(() => child.kill(), 60000);
    child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { err += chunk; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) accept(out.trim());
      else reject(new Error(`psql (${role}) failed: ${code}\n${err}\n${out}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(query);
  });
  // Long-lived interactive psql session for real concurrent-transaction tests.
  // Statements run serially; an error does not end the session (no ON_ERROR_STOP).
  // Completion is detected via sentinels on both stdout and stderr.
  const session = (role: Role) => {
    const child = spawn(bin ? join(bin, 'psql') : 'psql', [
      '-X', '-q', '-A', '-t', '-h', '127.0.0.1', '-p', String(port), '-U', role, '-d', 'postgres',
      '-v', 'VERBOSITY=verbose',
    ], { env, windowsHide: true, stdio: 'pipe' });
    sessions.add(child);
    let closed = false;
    child.on('close', () => { closed = true; });
    let out = '', err = '', seq = 0;
    let pending: null | { id: string; done: (result: { out: string; err: string }) => void } = null;
    const settle = () => {
      if (pending && out.includes(pending.id) && err.includes(pending.id)) {
        const { id, done } = pending;
        pending = null;
        done({ out: out.replace(id, '').trim(), err: err.replace(id, '').trim() });
      }
    };
    child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk; settle(); });
    child.stderr.setEncoding('utf8').on('data', chunk => { err += chunk; settle(); });
    child.stdin.on('error', () => {});
    const run = (query: string, timeoutMs = 60000) => new Promise<{ out: string; err: string }>((accept, reject) => {
      assert.equal(pending, null, 'session statements are serial');
      const id = `__M16_DONE_${++seq}__`;
      out = ''; err = '';
      const timer = setTimeout(() => { pending = null; reject(new Error(`session (${role}) timed out: ${query}`)); }, timeoutMs);
      pending = { id, done: result => { clearTimeout(timer); accept(result); } };
      child.stdin.write(`${query}\n\\echo ${id}\n\\warn ${id}\n`);
    });
    const close = () => new Promise<void>(accept => {
      if (closed) return accept();
      child.on('close', () => accept());
      child.stdin.end('\\q\n');
    });
    return { run, close };
  };
  const bootstrapSql = (query: string) => sql(query, 'm16_bootstrap');
  // Statement-granular run (no ON_ERROR_STOP): resolves with stderr so the caller asserts the exact failures.
  const sqlLenient = (query: string, role: Role): Promise<string> => new Promise((accept, reject) => {
    const child = spawn(bin ? join(bin, 'psql') : 'psql', [
      '-X', '-q', '-A', '-t', '-h', '127.0.0.1', '-p', String(port), '-U', role, '-d', 'postgres', '-v', 'VERBOSITY=terse',
    ], { env, windowsHide: true, stdio: 'pipe' });
    let err = '';
    child.stdout.resume();
    child.stderr.setEncoding('utf8').on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? accept(err) : reject(new Error(`psql (${role}) failed: ${code}\n${err}`))));
    child.stdin.on('error', () => {});
    child.stdin.end(query);
  });
  const migrate = async (name: string) => {
    await sql(migrationSource(name), 'postgres');
    diagnostic(`Executed canonical migration as postgres NOSUPERUSER: ${name}`);
  };
  try {
    run('initdb', ['-D', data, '-U', 'm16_bootstrap', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
    appendFileSync(join(data, 'postgresql.conf'), `\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = ''\nplpgsql.variable_conflict = error\n`);
    run('pg_ctl', ['-D', data, '-l', log, '-w', '-t', '30', 'start']);
    started = true;
    assert.equal(realpathSync(await bootstrapSql('show data_directory;')), realpathSync(data));
    assert.equal(await bootstrapSql('show plpgsql.variable_conflict;'), 'error');
    const version = Number(await bootstrapSql('show server_version_num;'));
    assert.ok(version >= 170000 && version < 180000, `Canonical M16 profile requires PostgreSQL 17.x; got ${version}`);
    diagnostic(`Real PG17 server: ${await bootstrapSql('select version();')} at 127.0.0.1:${port}; owned disposable cluster verified`);
    // postgres mirrors the architecture-owner READ-ONLY measurement of hosted Supabase: NOSUPERUSER,
    // CREATEROLE, CREATEDB, BYPASSRLS. CREATEROLE is what lets S1B.2R1 create its NOLOGIN technical owners.
    await bootstrapSql(`create role postgres login nosuperuser createrole createdb bypassrls;
      create role service_role login nosuperuser bypassrls;
      create role anon login nosuperuser nobypassrls;
      create role authenticated login nosuperuser nobypassrls;
      alter database postgres owner to postgres;
      create schema auth authorization postgres;
      set role postgres;
      create function auth.email() returns text language sql stable
        set search_path = pg_catalog as 'select null::text';
      comment on function auth.email() is 'Harness-only inert RLS creation stub, never application authentication';
      grant usage on schema auth to anon, authenticated, service_role;`);
    if (options.governanceWriteChain || options.fullPrimaryChain) {
      // The real chain calls extensions.digest(): pgcrypto lives in schema "extensions" (as on
      // Supabase). Established only in this disposable bootstrap; no migration is altered.
      await bootstrapSql(`create schema extensions authorization postgres;
        create extension pgcrypto with schema extensions;
        grant usage on schema extensions to postgres, service_role, anon, authenticated;`);
    }
    if (options.fullPrimaryChain) {
      assert.ok(!options.governanceWriteChain && !options.policyStorePrerequisites);
      const realVector = await bootstrapSql(`select count(*) from pg_available_extensions where name = 'vector';`) === '1';
      if (realVector) await bootstrapSql('create extension vector with schema public;');
      else await bootstrapSql(vectorStandIn);
      diagnostic(`Full primary chain: pgvector ${realVector ? 'REAL extension' : 'NOT INSTALLED -> disposable stand-in type (HNSW index statement expected to fail)'}`);
      for (const migration of fullPrimaryChainMigrations()) {
        if (migration === hnswIndexMigration && !realVector) {
          const errors = (await sqlLenient(migrationSource(migration), 'postgres')).split(/\r?\n/).filter(line => /\bERROR\b/.test(line));
          assert.equal(errors.length, 1, errors.join('\n'));
          assert.match(errors[0], /access method "hnsw" does not exist/);
          diagnostic(`Executed canonical migration as postgres NOSUPERUSER: ${migration} (only the HNSW index statement failed: stand-in pgvector)`);
        } else await migrate(migration);
      }
    } else {
      for (const migration of m16PrerequisiteChain(options.policyStorePrerequisites)) await migrate(migration);
      if (options.governanceWriteChain) for (const migration of governanceWriteChain) await migrate(migration);
    }
    return { sql, bootstrapSql, migrate, session, stop };
  } catch (error) {
    if (existsSync(log)) diagnostic(readFileSync(log, 'utf8'));
    stop();
    throw error;
  }
}

/**
 * Harness-only pgvector stand-in for hosts without the extension: a text-backed varlena type with a typmod,
 * vector_dims() and <=>, registered in pg_extension as "vector" so the canonical "create extension if not
 * exists" statements are no-ops. It never computes similarity (distance is always 0); CI installs real pgvector.
 */
const vectorStandIn = `create type public.vector;
  create function public.vector_in(cstring, oid, int4) returns public.vector language internal immutable strict as 'textin';
  create function public.vector_out(public.vector) returns cstring language internal immutable strict as 'textout';
  create function public.vector_typmod_in(cstring[]) returns int4 language internal immutable strict as 'varchartypmodin';
  create type public.vector (input = public.vector_in, output = public.vector_out, typmod_in = public.vector_typmod_in,
    internallength = variable, storage = extended);
  create function public.vector_dims(public.vector) returns integer language sql immutable strict as 'select 0';
  create function public.vector_cosine_distance(public.vector, public.vector) returns float8 language sql immutable strict as 'select 0::float8';
  create operator public.<=> (leftarg = public.vector, rightarg = public.vector, function = public.vector_cosine_distance);
  comment on type public.vector is 'M16 harness stand-in for pgvector (not installed on this host); never a product type';
  insert into pg_catalog.pg_extension(oid, extname, extowner, extnamespace, extrelocatable, extversion)
    values ((select max(oid)::int + 1000 from pg_catalog.pg_extension)::oid, 'vector', 'm16_bootstrap'::regrole, 'public'::regnamespace, true, '0.0-harness');`;
