// Offline packaging only. No connections, credentials or deployment command.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = 'ops/agent-version-profile-v1/';
const file = '20261109191942_agent_version_technical_profile_governed_mapping_v1.sql';
const historical = 'supabase/migrations/20260908120000_agent_version_technical_profile_persistence_v1.sql';
const read = f => readFileSync(path.join(root, f));
const hash = b => createHash('sha256').update(b).digest('hex');
const sql = read(dir + file).toString('utf8');
const version = file.slice(0, 14), name = file.slice(15, -4);
if (process.argv.length !== 3 || !['--build', '--check'].includes(process.argv[2])) throw Error('Use --build or --check (offline only)');
if (!sql.includes('\nBEGIN;\n') || !sql.endsWith('COMMIT;\n')) throw Error('Unexpected migration boundaries');
const delimiter = '$govia_profile_' + hash(sql).slice(0, 20) + '$';
if (sql.includes(delimiter)) throw Error('SQL delimiter collision');
const guard = `
SET LOCAL application_name='govia-technical-profile-v1';
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('govia:technical-profile-v1',0));
DO $deployment_guard$ BEGIN
 IF current_database()<>'postgres' OR (SELECT org_code FROM gov_repo.organisations
   WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af') IS DISTINCT FROM 'GOVIA_DEMO' THEN
   RAISE EXCEPTION 'PROFILE_DEPLOYMENT_TARGET_MISMATCH'; END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN
   RAISE EXCEPTION 'PROFILE_MIGRATION_ALREADY_REGISTERED'; END IF;
END $deployment_guard$;
`;
const history = `-- Exact proposed migration and metadata committed atomically with DDL.
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES('${version}','${name}',ARRAY[${delimiter}${sql}${delimiter}]::text[]);
`;
// A function replacement preserves the SQL's literal $$ delimiters in history.
const deployment = sql.replace('\nBEGIN;\n', () => '\nBEGIN;\n' + guard).replace(/COMMIT;\n$/, () => history + 'COMMIT;\n');
const files = [
  historical, dir + file, dir + 'package.mjs', dir + 'README.md', dir + 'integrity.sql',
  'apps/dashboard/lib/governance/agent-version-technical-profile-persistence.ts',
  'apps/dashboard/lib/governance/technical-profile-materialization.ts',
  'apps/dashboard/app/api/governance/workspace/reviews/[id]/technical-profile/route.ts',
  'apps/dashboard/components/workspace/TechnicalProfileMaterialization.tsx',
  'apps/dashboard/app/(dashboard)/governance/reviews/[id]/page.tsx',
  'apps/dashboard/tests/postgres-m16/technical-profile-mapping.test.ts',
  'apps/dashboard/tests/technical-profile-materialization.test.ts',
];
const manifest = {
  package: 'agent-version-profile-v1', status: 'PROPOSED_NOT_APPLIED', projectRef: 'zkqfvqwqdypgpzauzinw',
  organisationId: '082ef694-e016-4893-908c-1eef373f53af', version,
  expectedPreviousMaterializerProsrcSha256: '8754262bf27e47c7b5e502d8f2f9bcd1e18aeb482b3930b30e9f7d8c6759ecdd',
  securityDelta: { addedDefiners: ['gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz)'], closedRawServiceExecute: true, closedServiceProfileTableDml: true },
  files: files.map(file => ({ file, sha256: hash(read(file)) })),
  deployment: { file: dir + 'deployment.sql', sha256: hash(deployment) },
};
if (process.argv[2] === '--build') {
  writeFileSync(path.join(root, dir, 'deployment.sql'), deployment);
  writeFileSync(path.join(root, dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
} else {
  if (hash(read(dir + 'deployment.sql')) !== hash(deployment)) throw Error('Deployment hash mismatch');
  if (read(dir + 'manifest.json').toString() !== JSON.stringify(manifest, null, 2) + '\n') throw Error('Manifest mismatch; review changed bytes before rebuilding');
}
console.log(JSON.stringify({ status: 'PASS_OFFLINE_PACKAGE', mode: process.argv[2], migrationSha256: hash(sql), deploymentSha256: hash(deployment), files: files.length }));
