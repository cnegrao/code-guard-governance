import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Same canonical dependency chain as runtime-bootstrap.ps1 AuxiliaryPG16,
// followed by M14 review fixes and M15. No replacement prerequisite tables.
const migrations = [
  '20260818003539_gov_repo_types_and_organisations.sql',
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
  '20260917021203_runtime_observability_v1.sql',
  '20260917192615_runtime_observability_v1_review_fixes.sql',
  '20260923060000_cross_signal_persistence_v1.sql',
];

export async function disposablePostgres(diagnostic: (message: string) => void) {
  const bin = process.env.PG_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/16/bin' : '');
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
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'govia-m15-postgres-')));
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
  const sql = async (query: string) => run('psql', [
    '-X', '-q', '-A', '-t', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
  ], query);
  try {
    run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
    appendFileSync(join(data, 'postgresql.conf'), `\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = ''\nplpgsql.variable_conflict = error\n`);
    run('pg_ctl', ['-D', data, '-l', log, '-w', '-t', '30', 'start']);
    started = true;
    assert.equal(realpathSync(await sql('show data_directory;')), realpathSync(data));
    assert.equal(await sql('show plpgsql.variable_conflict;'), 'error');
    diagnostic(`Real server: ${await sql('select version();')} at 127.0.0.1:${port}; owned disposable cluster verified`);
    await sql(`create role anon nologin; create role authenticated nologin;
      create role service_role nologin bypassrls; create schema extensions;
      create extension pgcrypto with schema extensions;`);
    for (const migration of migrations) {
      const path = fileURLToPath(new URL(`../../../../supabase/migrations/${migration}`, import.meta.url));
      await sql(readFileSync(path, 'utf8'));
      diagnostic(`Executed canonical migration: ${migration}`);
    }
    return { sql, stop };
  } catch (error) {
    if (existsSync(log)) diagnostic(readFileSync(log, 'utf8'));
    stop();
    throw error;
  }
}
