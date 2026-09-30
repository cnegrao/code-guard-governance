import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  definerCapabilitySurfaceMigration, disposableM16Postgres, l14PolicyStoreHardeningMigration, migrationSource,
  runtimeExecutionClosureMigration,
} from './disposable-m16-postgres';
import { hex32, jsonLit, lit } from './m16-governed-write-fixtures';

/**
 * M16-S1B.2R1 disposable PG17 fixtures on the FULL canonical primary chain (every supabase/migrations
 * file). Administrator-only support rows are inserted directly as the owner, exactly like the S0/M15
 * fixtures; every routine under test runs through its real SQL surface as service_role.
 */
export const APP_ROLES = ['anon', 'authenticated', 'service_role'] as const;
export const EXECUTORS = ['govia_ledger_executor', 'govia_runtime_executor', 'govia_legacy_read_executor', 'govia_legacy_graph_executor'] as const;

/** The closed canonical application SECURITY DEFINER surface: exactly 22 identities and owner classes. */
export const APPROVED_SURFACE: ReadonlyArray<readonly [name: string, owner: string]> = [
  ['apply_review_transition_governed_v1', 'postgres'], ['materialize_object_reconciliation_governed_v1', 'postgres'],
  ['materialize_relationship_reconciliation_governed_v1', 'postgres'], ['record_authorized_reconciliation_governed_v1', 'postgres'],
  ['record_execution_field_decision_governed_v1', 'postgres'], ['record_technical_field_decision_governed_v1', 'postgres'],
  ['l14_admit_authority_policy_version_v1', 'postgres'], ['l14_submit_proposal_v1', 'postgres'],
  ['l14_decide_authority_policy_proposal_v1', 'postgres'], ['l14_admit_governance_party_v1', 'postgres'],
  ['l14_submit_governance_party_proposal_v1', 'postgres'], ['l14_decide_governance_party_proposal_v1', 'postgres'],
  ['ledger_append', 'govia_ledger_executor'], ['ledger_verify', 'govia_ledger_executor'],
  ['record_execution_snapshot', 'govia_runtime_executor'], ['admit_runtime_observation', 'govia_runtime_executor'],
  ['read_runtime_observation_exact', 'govia_runtime_executor'], ['record_cross_signal_comparison_result', 'govia_runtime_executor'],
  ['agent_compliance_gaps', 'govia_legacy_read_executor'], ['agent_graph_traverse', 'govia_legacy_read_executor'],
  ['agent_semantic_search', 'govia_legacy_read_executor'], ['recompute_risk_propagation', 'govia_legacy_graph_executor'],
];

const blockOf = (name: string, tag: string) => {
  const text = migrationSource(name);
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.startsWith('DO $postflight$') && block.includes(tag), `${tag} extracted`);
  return block;
};
export const r1Postflight = () => blockOf(definerCapabilitySurfaceMigration, 'M16_S1B2R1_POSTFLIGHT');
export const r2Postflight = () => blockOf(runtimeExecutionClosureMigration, 'M16_S1B2R2_POSTFLIGHT');
/** The four runtime definers whose config S1B.2R2 moves from `pg_catalog` to `pg_catalog, pg_temp`. */
export const RUNTIME_DEFINERS = [
  'gov_repo.record_execution_snapshot(uuid,jsonb,text)', 'gov_repo.admit_runtime_observation(uuid,text,gov_repo.runtime_observations)',
  'gov_repo.read_runtime_observation_exact(uuid,gov_repo.runtime_reference,uuid)', 'gov_repo.record_cross_signal_comparison_result(uuid,text,jsonb)',
] as const;
/**
 * The S1B.2R1 postflight re-executed on the post-R2 catalog: byte-identical except that the four runtime definers'
 * audited config is the R2 successor (`search_path=pg_catalog, pg_temp`). Every other R1 check runs verbatim.
 */
export function r1PostflightAfterR2(): string {
  let block = r1Postflight();
  for (const sig of RUNTIME_DEFINERS) {
    const before = `('${sig}', 'govia_runtime_executor', `;
    const at = block.indexOf(before);
    assert.ok(at > 0 && block.indexOf(before, at + 1) < 0, `${sig} audited exactly once`);
    const end = block.indexOf(')', block.indexOf("'search_path=pg_catalog'", at));
    const entry = block.slice(at, end + 1);
    assert.ok(entry.endsWith(", 'search_path=pg_catalog')"), entry);
    block = block.slice(0, at) + entry.replace(", 'search_path=pg_catalog')", ", 'search_path=pg_catalog, pg_temp')") + block.slice(end + 1);
  }
  return block;
}
export const s1b2Postflight = () => blockOf(l14PolicyStoreHardeningMigration, 'M16_S1B2_POSTFLIGHT');

/** Effective-capability inventory of every non-system SECURITY DEFINER routine (JSON rows). */
export const INVENTORY_SQL = `
select coalesce(json_agg(json_build_object(
  'fn', p.oid::regprocedure::text, 'name', p.proname, 'schema', p.pronamespace::regnamespace::text, 'owner', pg_get_userbyid(p.proowner),
  'app', exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      or has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or has_function_privilege('service_role', p.oid, 'EXECUTE'),
  'public', exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'anon', has_function_privilege('anon', p.oid, 'EXECUTE'), 'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
  'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'),
  'owner_store', (select r.rolsuper or r.rolbypassrls from pg_roles r where r.oid = p.proowner)
      or exists(select 1 from unnest(array['gov_repo.governance_policies'::regclass, 'gov_repo.policy_versions'::regclass]) t(rel)
                cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr(privilege)
                where has_table_privilege(p.proowner, t.rel, pr.privilege)),
  'config', coalesce(array_to_string(p.proconfig, ';'), '-'),
  'sha256', encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex')) order by p.oid::regprocedure::text), '[]')
from pg_proc p where p.prosecdef and p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace);`;
export interface InventoryRow {
  fn: string; name: string; schema: string; owner: string; app: boolean; public: boolean; anon: boolean; authenticated: boolean;
  service_role: boolean; owner_store: boolean; config: string; sha256: string;
}

/** Full primary chain + S1B.2R1 (default) and, with `r2`, the S1B.2R2 runtime execution closure on top. */
export async function fullChainCluster(diagnostic: (message: string) => void, options: { readonly r1?: boolean; readonly r2?: boolean } = {}) {
  const pg = await disposableM16Postgres(diagnostic, { fullPrimaryChain: true });
  try {
    if (options.r1 ?? true) await pg.migrate(definerCapabilitySurfaceMigration);
    if (options.r2) await pg.migrate(runtimeExecutionClosureMigration);
  } catch (error) { pg.stop(); throw error; }
  const owner = (query: string) => pg.sql(query, 'postgres');
  const svc = (query: string) => pg.sql(query, 'service_role');
  const inventory = async (): Promise<InventoryRow[]> => JSON.parse(await pg.bootstrapSql(INVENTORY_SQL));
  return { ...pg, owner, svc, inventory };
}

// ---------------------------------------------------------------------------------------------------------
// Tracked noncanonical definitions (read, never edited): replayed only into disposable attack clusters.
// ---------------------------------------------------------------------------------------------------------
const repoFile = (path: string) => readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), 'utf8');
/** The exact CREATE [OR REPLACE] FUNCTION statement for `signaturePrefix` in a tracked SQL file. */
export function trackedFunction(path: string, signaturePrefix: string): string {
  const text = repoFile(path);
  const start = text.search(new RegExp(`CREATE OR REPLACE FUNCTION ${signaturePrefix.replace(/[.()]/g, '\\$&')}`, 'i'));
  assert.ok(start >= 0, `${signaturePrefix} in ${path}`);
  const open = text.indexOf('$$', start);
  const close = text.indexOf('$$', open + 2);
  const end = text.indexOf(';', close);
  assert.ok(open > start && close > open && end > close);
  return text.slice(start, end + 1);
}
export const GRAPHOS_BRIDGE = 'graphos-complete/supabase/migrations/20260622_expose_gov_repo_bridge.sql';
/** The tracked bridge executors with their tracked ACL statements (service_role EXECUTE). */
export function graphosExecutorsSql(): string {
  const bridge = repoFile(GRAPHOS_BRIDGE);
  const acl = bridge.split(/\r?\n/).filter(line => /^(REVOKE|GRANT) .*public\.gov_exec(_dml)?\(text\)/.test(line));
  assert.equal(acl.length, 4);
  return [trackedFunction(GRAPHOS_BRIDGE, 'public.gov_exec('), trackedFunction(GRAPHOS_BRIDGE, 'public.gov_exec_dml('), ...acl].join('\n');
}
/** GraphOS trigger functions (tracked bodies) bound to harness-only minimal tables, as in their tracked files. */
export function graphosTriggersSql(): string {
  return `create table if not exists auth.users(id uuid primary key, email text);
    create table public.tenants(id uuid primary key, name text);
    create table public.profiles(id uuid primary key, email text, tenant_id uuid references public.tenants(id), role text);
    create table public.graphos_entities(id uuid primary key, name text, updated_at timestamptz);
    grant select, insert, update on auth.users, public.graphos_entities to service_role;
    ${trackedFunction('graphos-complete/supabase/migrations/99_fix_tenants_trigger.sql', 'public.handle_new_user(')}
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
    ${trackedFunction('graphos-complete/supabase/migrations/20260620_graphos_phase4.sql', 'public.set_graphos_updated_at(')}
    create trigger trg_graphos_entities_updated_at before update on public.graphos_entities for each row execute function public.set_graphos_updated_at();`;
}
/** The obsolete apps/dashboard/supabase-setup-8.2.sql ledger overload, exactly as tracked. */
export const legacyLedgerOverloadSql = () => trackedFunction('apps/dashboard/supabase-setup-8.2.sql', 'gov_repo.ledger_append(');

// ---------------------------------------------------------------------------------------------------------
// Support rows.
// ---------------------------------------------------------------------------------------------------------
export async function newOrg(owner: (query: string) => Promise<string>, label: string) {
  const id = randomUUID();
  await owner(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code)
    values('${id}',${lit(`R1_${label}`.slice(0, 20))},${lit(label)},${lit(label)},'PT')`);
  return id;
}
export async function newUser(owner: (query: string) => Promise<string>, org: string, name: string) {
  const id = randomUUID();
  await owner(`insert into gov_repo.governance_users(user_id,email,full_name,organisation_id,status)
    values('${id}','${id}@example.invalid',${lit(name)},'${org}','active')`);
  return id;
}
export async function newAgent(owner: (query: string) => Promise<string>, org: string, user: string, code: string,
  risk: 'critical' | 'high' | 'medium' | 'low' = 'high') {
  const id = randomUUID();
  await owner(`insert into gov_repo.agents(agent_id,agent_code,name,description,agent_type,owner_user_id,organisation_id,created_by,risk_level,status)
    values('${id}',${lit(code)},${lit(`Agent ${code}`)},'fixture','assistive','${user}','${org}','${user}','${risk}','active')`);
  return id;
}
export const vectorLiteral = `'[${Array.from({ length: 1536 }, (_, i) => (i === 0 ? '1' : '0')).join(',')}]'`;

/** AGENT_VERSION candidate + DECLARED direct-execution assertion + HASH_ONLY evidence + technical profile proposal. */
export function executionSnapshotKit(org: string, label: string) {
  const candidate = `candidate:agent-version:${hex32(label)}`;
  const connection = `conn-${label}`, externalId = `${label}.ts`, run = `run-${label}`, finding = `finding-${label}`;
  const sourceSnapshot = `source-snapshot-${label}`, assertion = `assertion-${label}`, evidence = `evidence-${label}`;
  const fingerprint = hex32(`fingerprint-${label}`);
  const envelope = { candidateId: candidate, candidateKind: 'AGENT_VERSION', sourceObject: { connectionId: connection, externalType: 'source', externalId } };
  const sql = `insert into gov_repo.acquisition_runs(run_id,organisation_id,source_connection_id,source_system_id,adapter_name,adapter_version,mode,status,started_at)
      values(${lit(run)},'${org}',${lit(connection)},'catalog','fixture','1','FULL','RUNNING',now());
    insert into gov_repo.discovery_findings(organisation_id,finding_id,finding_nature,candidate_kind,source_connection_id,source_external_type,source_external_id,
      confidence,review_status,requires_review,creates_canonical_object,detected_at,acquisition_run_id,contract_version,envelope,envelope_hash)
      values('${org}',${lit(finding)},'CANDIDATE','AGENT_VERSION',${lit(connection)},'source',${lit(externalId)},1,'ACCEPTED',true,false,now(),${lit(run)},'1.0','{}',repeat('a',64));
    insert into gov_repo.discovery_candidates(organisation_id,candidate_id,candidate_kind,candidate_family,finding_id,source_connection_id,source_external_type,source_external_id,
      confidence,requires_reconciliation,proposed_identity,acquisition_run_id,contract_version,envelope,envelope_hash)
      values('${org}',${lit(candidate)},'AGENT_VERSION','OBJECT',${lit(finding)},${lit(connection)},'source',${lit(externalId)},1,true,'{}'::jsonb,
      ${lit(run)},'1.0',${jsonLit(envelope)},repeat('a',64));
    insert into gov_repo.source_assertions(organisation_id,assertion_id,run_id,source_connection_id,source_external_type,source_external_id,snapshot_id,
      method_code,trust_state,observed_at,recorded_at,contract_version,envelope,envelope_hash)
      values('${org}',${lit(assertion)},${lit(run)},${lit(connection)},'source',${lit(externalId)},${lit(sourceSnapshot)},'DIRECT_AGENT_EXECUTION_V1','DECLARED',now(),now(),'1.0','{}',repeat('a',64));
    insert into gov_repo.discovery_evidence(organisation_id,evidence_id,handling,captured_at,content_hash,contract_version,envelope,envelope_hash)
      values('${org}',${lit(evidence)},'HASH_ONLY',now(),repeat('b',64),'1.0','{}',repeat('a',64));
    insert into gov_repo.source_assertion_evidence(organisation_id,assertion_id,evidence_id) values('${org}',${lit(assertion)},${lit(evidence)});
    insert into gov_repo.agent_version_technical_profile_proposals(organisation_id,proposal_id,agent_version_candidate_id,behavior_fingerprint_algorithm,
      behavior_fingerprint_schema_version,behavior_fingerprint_value,contract_version)
      values('${org}',${lit(`proposal-${label}`)},${lit(candidate)},'sha256','1.0',${lit(fingerprint)},'1.0');`;
  const snapshot = {
    organisationId: org, authorizationState: 'UNKNOWN', snapshotId: `snapshot-${label}`, sourceScope: `scope-${label}`,
    agentVersionCandidateId: candidate, sourceObject: { connectionId: connection, externalType: 'source', externalId },
    behaviorFingerprint: { value: fingerprint, schemaVersion: '1.0' }, sourceSystemId: 'catalog', providerCode: 'provider',
    declarationKey: 'entrypoint', sourceSnapshotId: sourceSnapshot, recordedAt: '2026-09-30T12:00:00.000Z',
    facts: [{ assertionId: assertion, evidenceId: evidence,
      fact: { field: 'PRINCIPAL', principal: { kind: 'SERVICE_ACCOUNT', providerCode: 'provider', authorityReference: 'realm', principalReference: 'svc' } } }],
  };
  return { sql, snapshot };
}
