import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// M16 security profile: real identity/RLS/default privileges before credential cutover.
export const credentialMigration = '20260925150000_m16_s0_credential_epoch_v1.sql';
export const m16Prerequisites = [
  '20260818003539_gov_repo_types_and_organisations.sql',
  '20260818003710_gov_repo_identity_and_ledger.sql',
  '20260818013113_grant_service_role_gov_repo_access.sql',
  '20260903200000_canonical_email_identity.sql',
  '20260903200100_atomic_signup_legacy_rpc.sql',
];
export function migrationSource(name: string) {
  assert.ok([...m16Prerequisites, credentialMigration].includes(name));
  return readFileSync(fileURLToPath(new URL(`../../../../supabase/migrations/${name}`, import.meta.url)), 'utf8');
}

export async function disposableM16Postgres(diagnostic: (message: string) => void) {
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
  function stop() {
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
    for (const migration of m16Prerequisites) await migrate(migration);
    return { sql, bootstrapSql, migrate, stop };
  } catch (error) {
    if (existsSync(log)) diagnostic(readFileSync(log, 'utf8'));
    stop();
    throw error;
  }
}
