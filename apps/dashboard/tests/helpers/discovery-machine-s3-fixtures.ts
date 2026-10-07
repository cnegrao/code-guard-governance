import { readFileSync } from 'node:fs';
import { s2Cluster, s2Source } from './discovery-machine-s2-fixtures';
import {r1PostflightAfterR2,r2Postflight,r3Postflight,s1b2Postflight} from './m16-definer-surface-fixtures';
import assert from 'node:assert/strict';
export const S3_MIGRATION = '20261003011750_discovery_machine_s3_restricted_intake_v1.sql';
export const s3Source = () => readFileSync(new URL(`../../../../supabase/migrations/${S3_MIGRATION}`, import.meta.url), 'utf8');
/** R3's suffix matcher also matches the required S3 is_governed command.
 * Preserve every R3 check, but select its original six HUMAN routines exactly on the S3 horizon.
 * The original R3 postflight continues to run verbatim in s2Cluster and all historical suites. */
export function r3PostflightAfterS3() {
  const original=r3Postflight();
  const selector=String.raw`p.proname OPERATOR(pg_catalog.~~) '%\_governed\_v1'`;
  assert.equal(original.split(selector).length-1,3);
  return original.replaceAll(selector,`p.proname = ANY(ARRAY['apply_review_transition_governed_v1',
    'record_authorized_reconciliation_governed_v1','materialize_object_reconciliation_governed_v1',
    'materialize_relationship_reconciliation_governed_v1','record_technical_field_decision_governed_v1',
    'record_execution_field_decision_governed_v1'])`);
}
/** Disposable historical S2 horizon plus the single additive S3 migration. */
export async function s3Cluster(diagnostic: (message: string) => void) {
  const pg = await s2Cluster(diagnostic);
  try {
    const before=await pg.inventory();
    await pg.owner(`alter default privileges for role postgres in schema gov_repo grant execute on functions to public,anon,authenticated,service_role`);
    await pg.owner(s3Source());
    assert.deepEqual((await pg.inventory()).filter(p=>!p.name.startsWith('discovery_machine_')),before);
    // Restore this extra fixture-only function-default attack before historical R1 checks.
    // Existing S3 object ACLs are unaffected; hostile historical table defaults stay in place.
    await pg.owner(`alter default privileges for role postgres in schema gov_repo revoke execute on functions from public,anon,authenticated,service_role`);
    await pg.owner(s1b2Postflight()); await pg.owner(r1PostflightAfterR2()); await pg.owner(r2Postflight()); await pg.owner(r3PostflightAfterS3());
    const s2=s2Source(); await pg.owner(s2.slice(s2.indexOf('DO $postflight$'),s2.indexOf('$postflight$;')+'$postflight$;'.length));
    return pg;
  } catch (error) { pg.stop(); throw error; }
}

export async function provisionS3(pg: Awaited<ReturnType<typeof s3Cluster>>, locator='Acme/Producer-Fixtures') {
 const org=randomUUID(), role='s3_'+randomUUID().replaceAll('-','');
 await pg.owner(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code,is_active)
 values('${org}',${q(role.slice(0,20))},'S3','S3','BR',true)`);
 const principal=await pg.owner(`select gov_repo.machine_provision_principal_v1(${q(role)},'test','fixture','S3')`);
 await pg.owner(`create role ${role} login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
 grant govia_discovery_machine_caller to ${role} with inherit true, set true`);
 const generation=await pg.owner(`select gov_repo.machine_register_generation_v1('${principal}',${q(role)},clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','fixture','S3')`);
 await pg.owner(`select gov_repo.machine_set_generation_state_v1('${generation}','CURRENT','fixture','S3')`);
 const connection='source-connection:'+createHash('sha256').update('github:'+locator).digest('hex').slice(0,32);
 const binding=await pg.owner(`select gov_repo.machine_provision_binding_v1('${principal}','${org}','github',${q(locator)},${q(locator.toLowerCase())},${q(connection)},'123','main','github','1.0',true,false,'fixture','S3')`);
 const call=(sql:string)=>pg.login(sql,role).then(JSON.parse);
 const open=()=>call(`select gov_repo.discovery_machine_open_run_v1('${binding}',${q(locator)},'main','github','1.0','123','commit:${sha}','2026-10-02T12:00:00.000Z')`);
 return {org,role,principal,generation,connection,binding,call,open};
}

import { createHash, randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as scanner from '../../../../packages/scanner/src/discovery/index';
import { literal as q } from './discovery-machine-s2-fixtures';
export const sha = 'a'.repeat(40);
export async function producerCorpus() {
  const golden = fileURLToPath(new URL('../../../../packages/scanner/test/discovery-validation-lab/golden-repositories/', import.meta.url));
  const files = new Map<string,string>();
  function collect(directory: string) {
    for (const entry of readdirSync(directory,{withFileTypes:true})) {
      const path = join(directory,entry.name);
      if (entry.isDirectory()) collect(path);
      else if (/\.(ts|js|py|json|ya?ml|sql)$/.test(entry.name)) files.set(relative(golden,path).replaceAll('\\','/'),readFileSync(path,'utf8'));
    }
  }
  collect(golden);
  // Existing SQL fixtures from sql-column-lineage.test.ts, acquired with a GitHub-style immutable version.
  files.set('sql/schema.sql','CREATE TABLE target (a INT, b TEXT); CREATE TABLE source (x INT, y TEXT);');
  files.set('sql/load.sql','INSERT INTO target (a,b) SELECT source.x,source.y FROM source;');
  // The existing execution-context.test.ts source fixture with all four direct fact kinds.
  files.set('execution/agent.ts',`export const triageAgent = {
  kind: "agent",
  tools: [classifyRequest],
  executionPrincipal: { kind: "SERVICE_ACCOUNT", provider: "fixture", authority: "realm-a", principal: "account-a" },
  connectivity: [{ endpoint: "https://catalog.invalid/v1", protocol: { kind: "API", family: "HTTP" } }],
  requestedScopes: [{ scope: "catalog.read", resource: "catalog" }],
};`);
  files.set('technical/framework.py','from langgraph.graph import StateGraph\n');
  const adapter: scanner.SourceAdapter = {
    adapterName:'github',adapterVersion:'1.0',
    describeSource:()=>({displayName:'Acme/Producer-Fixtures',family:'REPOSITORY',providerCode:'github'}),
    resolveSourceVersion:async()=>`commit:${sha}`,
    listArtifacts:async()=>[...files].map(([locator,text])=>({locator,kind:'file',sizeBytes:Buffer.byteLength(text)})),
    readArtifact:async locator=>({ok:true,content:{locator,text:files.get(locator)!,encoding:'utf8',
      contentHash:createHash('sha256').update(files.get(locator)!).digest('hex')}}),
  };
  const result = await new scanner.DiscoveryPipeline(adapter,[
    new scanner.AgentKindDeclarationSpecification(),new scanner.ModelReferenceDeclarationSpecification(),
    new scanner.ToolListDeclarationSpecification(),new scanner.PromptDeclarationSpecification(),
    new scanner.McpServerDeclarationSpecification(),new scanner.ApiDeclarationSpecification(),
    new scanner.KnowledgeBaseDeclarationSpecification(),new scanner.SkillListDeclarationSpecification(),
    new scanner.SqlCreateTableSpecification('DATA_ASSET'),new scanner.SqlCreateTableSpecification('DATA_ELEMENT'),
    new scanner.SqlInsertSelectSpecification(),
  ],{clock:{now:()=> '2026-10-02T12:00:00.000Z'},signalSpecifications:[
    new scanner.FrameworkImportSignalSpecification(),new scanner.OrchestrationFrameworkSignalSpecification(),
  ]}).run();
  const versions = scanner.correlateAgentVersions(result.candidates,result.technicalProfileSignals,{observedAt:result.run.startedAt});
  const groups = {
    evidenceAssembly:result.candidates.filter(c=>c.finding.candidateKind!=='RELATIONSHIP'),
    technicalProfileSignals:result.technicalProfileSignals,
    sqlLineageDeclarations:result.candidates.filter(c=>c.assertion.method.code==='sql-insert-select-column-lineage'),
    executionFacts:versions.flatMap(v=>v.executionFacts??[]),
  };
  return {files,result,groups,versions};
}
