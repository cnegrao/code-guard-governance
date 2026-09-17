param(
 [ValidateSet('Supabase','HostedSupabase','AuxiliaryPG16')][string]$Mode = 'Supabase',
 [string]$PostgresBin = 'C:\Program Files\PostgreSQL\16\bin',
 [int]$Port = 55442,
 [switch]$ResetLocal
)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$psql = Join-Path $PostgresBin 'psql.exe'
if ($Mode -eq 'HostedSupabase') {
 if ($ResetLocal) { throw 'M14_HOSTED_RESET_FORBIDDEN' }
 # Names/refs were independently resolved through the authenticated project API.
 # The Node helper rechecks these ignored CLI link files before EVERY query.
 $expectedRef = 'zkqfvqwqdypgpzauzinw'
 $protectedRef = 'bbisimozudihadfozyfz'
 $linkedRef = (Get-Content -LiteralPath (Join-Path $repository 'supabase/.temp/project-ref') -Raw).Trim()
 $metadata = Get-Content -LiteralPath (Join-Path $repository 'supabase/.temp/linked-project.json') -Raw | ConvertFrom-Json
 if ($linkedRef -ne $expectedRef -or $linkedRef -eq $protectedRef -or $metadata.ref -ne $expectedRef -or $metadata.name -ne 'ov-ia-g2-test') { throw 'STOP_WRONG_SUPABASE_TARGET' }
 $env:M14_DATABASE_MODE = 'supabase-hosted'
 $env:M14_HOSTED_DB_TEST = '1'
 $env:M14_HOSTED_PROJECT_REF = $expectedRef
 Write-Output "M14_HOSTED_TEST_TARGET: ov-ia-g2-test / $expectedRef; existing CLI credentials only; no reset or role creation"
 return
}
Remove-Item -LiteralPath 'Env:M14_HOSTED_DB_TEST' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'Env:M14_HOSTED_PROJECT_REF' -ErrorAction SilentlyContinue
if ($Mode -eq 'Supabase') {
 $cli = Join-Path $repository 'node_modules/.bin/supabase.cmd'
 $configuration = Get-Content -LiteralPath (Join-Path $repository 'supabase/config.toml') -Raw
 if ($configuration -notmatch 'project_id\s*=\s*"code-guard-governance"' -or $configuration -notmatch 'major_version\s*=\s*17') { throw 'M14_PROJECT_CONFIGURATION_MISMATCH' }
 $statusText = & $cli --workdir $repository status --output json
 if ($LASTEXITCODE -ne 0) { throw 'M14_SUPABASE_LOCAL_UNAVAILABLE' }
 $localStatus = $statusText | ConvertFrom-Json
 $localUrl = [uri]$localStatus.DB_URL
 if ($localUrl.Scheme -notin @('postgres','postgresql') -or $localUrl.Host -notin @('127.0.0.1','localhost') -or $localUrl.Port -lt 1) { throw 'M14_LOCAL_TARGET_INVALID' }
 # Never use --linked/--db-url or hosted project metadata. Only the local CLI stack.
 if ($ResetLocal) {
  & $cli --workdir $repository db reset --local --yes
  if ($LASTEXITCODE -ne 0) { throw 'M14_SUPABASE_LOCAL_MIGRATIONS_FAILED' }
 }
 $userinfo = $localUrl.UserInfo -split ':',2
 if ($userinfo.Count -ne 2) { throw 'M14_LOCAL_CONNECTION_MISSING' }
 $env:M14_DATABASE_MODE = 'supabase'
 $env:M14_SUPABASE_PROJECT_ID = 'code-guard-governance'
 $env:M14_LOCAL_DB_HOST = $localUrl.Host
 $env:M14_LOCAL_DB_PORT = [string]$localUrl.Port
 $env:M14_LOCAL_DB_NAME = [uri]::UnescapeDataString($localUrl.AbsolutePath.TrimStart('/'))
 $env:M14_LOCAL_DB_USER = [uri]::UnescapeDataString($userinfo[0])
 $env:M14_LOCAL_DB_PASSWORD = [uri]::UnescapeDataString($userinfo[1])
 $env:M14_PSQL_PATH = $psql
 $env:M14_LOCAL_DB_TEST = '1'
 Write-Output 'M14_SUPABASE_LOCAL_TARGET_CONFIGURED; TEST PREFLIGHT STILL REQUIRES SERVER 17, EXISTING ROLES AND MIGRATION HISTORY'
 return
}
# Explicit auxiliary mode only. Not Supabase/PostgreSQL 17 acceptance.
$env:M14_DATABASE_MODE = 'pg16-auxiliary'
$env:M14_LOCAL_DB_HOST = '127.0.0.1'
$env:M14_LOCAL_DB_PORT = [string]$Port
$env:M14_LOCAL_DB_NAME = 'm14_acceptance'
$env:M14_LOCAL_DB_USER = 'postgres'
$env:M14_LOCAL_DB_PASSWORD = ''
$env:M14_PSQL_PATH = $psql
$env:M14_LOCAL_DB_TEST = '1'
$savedPg = @{ PGHOSTADDR=$env:PGHOSTADDR; PGSERVICE=$env:PGSERVICE; PGSERVICEFILE=$env:PGSERVICEFILE; PGPASSWORD=$env:PGPASSWORD; PGCONNECT_TIMEOUT=$env:PGCONNECT_TIMEOUT }
try {
$env:PGHOSTADDR='127.0.0.1'
Remove-Item -LiteralPath 'Env:PGSERVICE' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'Env:PGSERVICEFILE' -ErrorAction SilentlyContinue
$env:PGPASSWORD=''
$env:PGCONNECT_TIMEOUT='5'
$arguments = @('-X', '-q', '-h', '127.0.0.1', '-p', "$Port", '-U', 'postgres', '-v', 'ON_ERROR_STOP=1')
# Only an explicitly started local disposable cluster. Fails if the acceptance DB exists.
& $psql @arguments -d postgres -c 'create database m14_acceptance;'
if ($LASTEXITCODE -ne 0) { throw 'M14_ACCEPTANCE_DATABASE_CREATION_FAILED' }
$setup = @'
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema extensions;
create extension pgcrypto with schema extensions;
'@
$setup | & $psql @arguments -d m14_acceptance
if ($LASTEXITCODE -ne 0) { throw 'M14_ACCEPTANCE_BOOTSTRAP_FAILED' }
# Unmodified dependency migrations; excludes unrelated legacy/UI/vector migrations.
$migrations = @(
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
 '20260917021203_runtime_observability_v1.sql'
)
foreach ($migration in $migrations) {
 & $psql @arguments -d m14_acceptance -f (Join-Path $repository "supabase/migrations/$migration")
 if ($LASTEXITCODE -ne 0) { throw "M14_MIGRATION_FAILED: $migration" }
}
Write-Output 'M14_PG16_AUXILIARY_DEPENDENCY_MIGRATIONS_APPLIED; NOT SUPABASE ACCEPTANCE'
} finally {
 foreach ($name in $savedPg.Keys) {
  if ($null -eq $savedPg[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
  else { Set-Item -LiteralPath "Env:$name" -Value $savedPg[$name] }
 }
}
