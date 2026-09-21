import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeToRow } from '../../lib/governance/runtime-row';
import { fixture } from './runtime-fixtures';

// Hosted opt-in is pinned to the independently confirmed TEST project. No app credentials.
export const databaseEnabled = process.env.M14_LOCAL_DB_TEST === '1' || process.env.M14_HOSTED_DB_TEST === '1';
export const databaseMode = process.env.M14_DATABASE_MODE ?? 'pg16-auxiliary';
export const hostedProject = { name: 'ov-ia-g2-test', ref: 'zkqfvqwqdypgpzauzinw' } as const;
export const protectedProjectRef = 'bbisimozudihadfozyfz';
const repository = fileURLToPath(new URL('../../../../', import.meta.url));
export function verifyHostedTarget(linkedRef: string, metadata: { ref?: string; name?: string }, requestedRef: string | undefined): void {
  if (linkedRef === protectedProjectRef || requestedRef !== hostedProject.ref || linkedRef !== hostedProject.ref ||
    metadata.ref !== hostedProject.ref || metadata.name !== hostedProject.name) throw new Error('STOP_WRONG_SUPABASE_TARGET');
}
// Supabase CLI `db query --output json` has been observed to return either a bare array of
// row objects, or an envelope object of shape {rows:[...]}. Accept exactly those two legitimate
// shapes; reject everything else (malformed JSON, non-array rows, non-object row entries).
export function parseHostedRows(out: string): Record<string, unknown>[] {
  let parsed: unknown;
  try { parsed = JSON.parse(out); } catch { throw new Error('M14_HOSTED_QUERY_RESPONSE_INVALID'); }
  const rows = Array.isArray(parsed) ? parsed
    : parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : undefined;
  if (rows === undefined) throw new Error('M14_HOSTED_QUERY_RESPONSE_INVALID');
  for (const row of rows) if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('M14_HOSTED_QUERY_RESPONSE_INVALID');
  return rows as Record<string, unknown>[];
}
export function formatHostedRows(rows: Record<string, unknown>[]): string {
  return rows.map(row => Object.values(row).map(value=>typeof value==='boolean'?(value?'t':'f'):
    value===null?'':typeof value==='object'?JSON.stringify(value):String(value)).join('|')).join('\n').trim();
}
function hostedSql(query: string): Promise<string> {
  if (process.env.M14_HOSTED_DB_TEST !== '1') throw new Error('M14_HOSTED_DATABASE_NOT_ENABLED');
  // Recheck every command, including reads. Never infer project identity from tenant data.
  verifyHostedTarget(readFileSync(join(repository,'supabase/.temp/project-ref'),'utf8').trim(),
    JSON.parse(readFileSync(join(repository,'supabase/.temp/linked-project.json'),'utf8')), process.env.M14_HOSTED_PROJECT_REF);
  const directory = mkdtempSync(join(tmpdir(),'m142-query-'));
  const file = join(directory,'query.sql');
  writeFileSync(file,query);
  return new Promise<string>((resolve,reject)=>{
    const child = spawn(process.execPath,[join(repository,'node_modules/supabase/dist/supabase.js'),'db','query',
      '--workdir',repository,'--linked','--output','json','--file',file],{windowsHide:true});
    let out=''; let err='';
    child.stdout.on('data',data=>{out+=data;}); child.stderr.on('data',data=>{err+=data;});
    child.on('error',()=>reject(new Error('M14_HOSTED_QUERY_PROCESS_FAILED')));
    child.on('close',code=>{
      if(code!==0) { reject(new Error(err.match(/RUNTIME_[A-Z_]+|permission denied|out of range|violates [a-z ]+constraint/)?.[0] ?? 'M14_HOSTED_QUERY_FAILED')); return; }
      try {
        resolve(formatHostedRows(parseHostedRows(out)));
      } catch { reject(new Error('M14_HOSTED_QUERY_RESPONSE_INVALID')); }
    });
  }).finally(()=>{unlinkSync(file);rmdirSync(directory);});
}
const psql = process.env.M14_PSQL_PATH ?? 'psql';
export function databaseTarget(env: Readonly<Record<string, string | undefined>> = process.env) {
  const mode = env.M14_DATABASE_MODE ?? 'pg16-auxiliary';
  const host = env.M14_LOCAL_DB_HOST ?? '127.0.0.1';
  const port = env.M14_LOCAL_DB_PORT ?? (mode === 'supabase' ? '' : '55442');
  const database = env.M14_LOCAL_DB_NAME ?? (mode === 'supabase' ? '' : 'm14_acceptance');
  const user = env.M14_LOCAL_DB_USER ?? (mode === 'supabase' ? '' : 'postgres');
  if (!['supabase','pg16-auxiliary'].includes(mode) || !['127.0.0.1','localhost'].includes(host) ||
    !/^\d{4,5}$/.test(port) || Number(port)>65535 || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(database) ||
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(user) ||
    (mode === 'supabase' && env.M14_SUPABASE_PROJECT_ID !== 'code-guard-governance')) throw new Error('M14_LOCAL_TARGET_INVALID');
  return { mode, host, port, database, user };
}
export function sql(query: string): Promise<string> {
  if (!databaseEnabled) throw new Error('M14_LOCAL_DATABASE_NOT_ENABLED');
  if (process.env.M14_HOSTED_DB_TEST === '1' && databaseMode !== 'supabase-hosted') throw new Error('STOP_WRONG_SUPABASE_TARGET');
  if (databaseMode === 'supabase-hosted') return hostedSql(query);
  const target = databaseTarget();
  return new Promise((resolve, reject) => {
    const environment: NodeJS.ProcessEnv = { ...process.env, PGHOSTADDR: '127.0.0.1',
      PGPASSWORD: process.env.M14_LOCAL_DB_PASSWORD ?? '', PGCONNECT_TIMEOUT: '5' };
    delete environment.PGSERVICE;
    delete environment.PGSERVICEFILE;
    const child = spawn(psql, ['-X', '-q', '-A', '-t', '-h', target.host, '-p', target.port, '-U', target.user, '-d', target.database, '-v', 'ON_ERROR_STOP=1'], {
      windowsHide: true, env: environment,
    });
    let out = ''; let err = '';
    child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim())));
    child.stdin.end(query);
  });
}
export async function verifyDatabaseEnvironment(): Promise<void> {
  const result = JSON.parse(await sql(`select json_build_object('version',current_setting('server_version_num')::integer,
    'roles',(select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')),
    'auth_schema',to_regnamespace('auth') is not null,'migration_history',to_regclass('supabase_migrations.schema_migrations') is not null);`));
  if (result.roles !== 3 || (databaseMode === 'supabase' || databaseMode === 'supabase-hosted'
    ? result.version < 170000 || result.version >= 180000 || !result.auth_schema || !result.migration_history
    : result.version < 160000 || result.version >= 170000)) throw new Error('M14_DATABASE_PLATFORM_MISMATCH');
  if ((databaseMode === 'supabase' || databaseMode === 'supabase-hosted') && await sql("select count(*) from supabase_migrations.schema_migrations where version='20260917021203';") !== '1') {
    throw new Error('M14_SUPABASE_MIGRATION_NOT_APPLIED');
  }
}
export const literal = (v: string): string => "'" + v.replaceAll("'", "''") + "'";
export const org = '14200000-0917-4142-8142-000000000001';
export const foreign = '14200000-0917-4142-8142-000000000002';
export const composite = (value: unknown, table: string): string => `jsonb_populate_record(null::gov_repo.${table},${literal(JSON.stringify(value))}::jsonb)`;
export function admission(row: Record<string, unknown>, tenant = org, connection = 'm142-20260917-runtime-a', concurrent = false): string {
  const call = `gov_repo.admit_runtime_observation(${literal(tenant)},${literal(connection)},${composite(row,'runtime_observations')})`;
  // Hold the winner's transaction lock while independent callers overlap. One result set for both transports.
  return concurrent ? `with admitted as materialized (select * from ${call})
    select json_build_object('replay',r.replay,'observation',r.observation,'backend',pg_backend_pid()) from admitted r
    cross join lateral (select pg_sleep(case when r.replay then 0.1 else 2 end)) hold;`
    : `select row_to_json(r) from ${call} r;`;
}
export function observationRow(span = 'bbbbbbbbbbbbbbbb', kind: Parameters<typeof fixture>[0] = 'MODEL_CALL'): Record<string, unknown> {
  const row = runtimeToRow(fixture(kind)); row.span_id = span; row.source_event_key = row.trace_id + ':' + span;
  const id = '33333333-3333-4333-8333-' + span.slice(4);
  for (const key of Object.keys(row)) if (key === 'observation_id' || key.endsWith('_observation')) { if (row[key] !== null) row[key] = id; }
  return row;
}
export function config(connection = 'm142-20260917-runtime-a', tenant = org, version = '1') {
  return {
    organisation_id: tenant, connection_id: connection, configuration_version: version, family: 'RUNTIME', source_system_id: 'system',
    provider_code: 'provider', producer_identity: 'producer', instrumentation_name: 'govia.producer', instrumentation_version: '1.0.0',
    sdk_name: 'opentelemetry', sdk_version: '2.0.1', method_code: 'MANUAL_SPAN', method_version: '1.0.0',
    supported_kinds: ['EXECUTION','MODEL_CALL','TOOL_CALL','MCP_CALL','API_CALL'],
    supported_facts: ['END_TIME','SOURCE_TIME','PARENT','TARGET','CANONICAL_TARGET','EXACT_BINDING','OUTCOME','DURATION','ERROR','TOKENS','SUPPLIED_COST','DERIVED_COST','PRINCIPAL','ENVIRONMENT','NETWORK','SAMPLING','DROPPED_COUNTS','PROTOCOL'],
    adapter_version: '1.0.0', schema_version: '1.0.0', mapping_version: '1.0.0', binding_method: 'VERIFIED_RELEASE_ASSOCIATION_V1', binding_version: '1.0.0',
    max_payload_bytes: 65536, max_batch_size: 100, max_observations: 10000,
    admission_from: new Date(Date.now()-86400000).toISOString(), admission_until: new Date(Date.now()+29*86400000).toISOString(),
    approved_target_references: ['requested-model','tool','api','mcp'], approved_target_providers: ['provider'], approved_model_references: ['reported-model'],
    approved_deployments: ['deployment'], approved_charge_references: ['charge'], approved_pricing_references: ['tariff'],
    approved_principal_references: ['workload'], approved_authority_references: ['realm'], approved_network_references: ['network-1'], created_by: 'test-admin',
  };
}
export async function registerSource(connection = 'm142-20260917-runtime-a', tenant = org): Promise<void> {
  await sql(`select gov_repo.register_runtime_source(${literal(tenant)},${literal(connection)},'system','provider','producer','test-admin');
    select gov_repo.configure_runtime_source(${literal(tenant)},${literal(connection)},${composite(config(connection,tenant),'runtime_source_configurations')});
    select gov_repo.activate_runtime_source(${literal(tenant)},${literal(connection)},'1',true,'test-admin');`);
}
export const migrationPath = new URL('../../../../supabase/migrations/20260917021203_runtime_observability_v1.sql',import.meta.url);
export const migrationSql = readFileSync(migrationPath,'utf8');
