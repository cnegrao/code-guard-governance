import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
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
export function migrationSource(name: string) {
  assert.ok([...m16Prerequisites, ...governanceWriteChain, credentialMigration, eligibilityMigration, epochBindingMigration, objectMaterializationCompatMigration, governedWriteWrapperMigration].includes(name));
  return readFileSync(fileURLToPath(new URL(`../../../../supabase/migrations/${name}`, import.meta.url)), 'utf8');
}

export interface DisposableM16Options {
  /** Apply the real governance persistence chain (S0.3.3B). Off keeps the S0.3.1/S0.3.2 profiles unchanged. */
  readonly governanceWriteChain?: boolean;
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
    await bootstrapSql(`create role postgres login nosuperuser bypassrls;
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
    if (options.governanceWriteChain) {
      // The real chain calls extensions.digest(): pgcrypto lives in schema "extensions" (as on
      // Supabase). Established only in this disposable bootstrap; no migration is altered.
      await bootstrapSql(`create schema extensions authorization postgres;
        create extension pgcrypto with schema extensions;
        grant usage on schema extensions to postgres, service_role, anon, authenticated;`);
    }
    for (const migration of m16Prerequisites) await migrate(migration);
    if (options.governanceWriteChain) for (const migration of governanceWriteChain) await migrate(migration);
    return { sql, bootstrapSql, migrate, session, stop };
  } catch (error) {
    if (existsSync(log)) diagnostic(readFileSync(log, 'utf8'));
    stop();
    throw error;
  }
}
