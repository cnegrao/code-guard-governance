import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { ledgerFoundationCluster, ledgerRepo, orgA, lit } from '../helpers/ledger-v2-foundation-fixtures';

test('discovery and Talk routes -> principal adapter -> actual PG17 RPC/capture, sanitized failures and no fallback', { timeout: 900_000 }, async t=>{
  const pg=await ledgerFoundationCluster(m=>t.diagnostic(m)); t.after(()=>pg.stop());
  await pg.applyFoundation();
  await pg.owner(`INSERT INTO gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code)
    VALUES('${orgA}','V2_APP','App','App','BR')`);
  await pg.owner(readFileSync(join(ledgerRepo,'supabase/migrations/20261021134359_m175_v1_s1a1_2a_ledger_v2_write_cutover.sql'),'utf8'));
  const userId=randomUUID();
  await pg.owner(`INSERT INTO gov_repo.governance_users(user_id,email,full_name,organisation_id,status,role_ids)
    SELECT '${userId}','${userId}@example.invalid','Writer','${orgA}','active',ARRAY[role_id]
    FROM gov_repo.governance_roles WHERE role_code='POLICY_OWNER'`);
  await pg.bootstrapSql(`BEGIN; ALTER TABLE gov_repo.governance_users DISABLE TRIGGER trg_governance_users_credential_epoch_v1;
    UPDATE gov_repo.governance_users SET password_changed_at=clock_timestamp()-interval '12 hours' WHERE user_id='${userId}';
    ALTER TABLE gov_repo.governance_users ENABLE ALWAYS TRIGGER trg_governance_users_credential_epoch_v1; COMMIT;`);
  const credentialEpoch=await pg.owner(`SELECT password_changed_at::text FROM gov_repo.governance_users WHERE user_id='${userId}'`);
  const seconds=Number(await pg.owner('SELECT floor(extract(epoch from clock_timestamp()))::bigint'));
  const principal={userId,organisationId:orgA,credentialEpoch,issuedAtSeconds:seconds-10,expiresAtSeconds:seconds+3600};
  const rpcCalls: { name: string; args: Record<string,unknown> }[]=[];
  mock.module('@/lib/auth', {namedExports:{requireVerifiedGovernancePrincipal:async()=>principal,SessionAuthenticationError:class extends Error{}}});
  mock.module('@/lib/db',{namedExports:{db:{write:{rpc:async(name: string,args:Record<string,unknown>)=>{
    rpcCalls.push({name,args}); assert.equal(name,'ledger_append_v2');
    try {
      const sql=`SELECT gov_repo.ledger_append_v2(${Object.entries(args).map(([k,v])=>`${k}=>${v===null?'NULL':lit(typeof v==='object'?JSON.stringify(v):v)}`).join(',')});`;
      return {data:await pg.svc(sql),error:null};
    }catch(error){return {data:null,error:{message:(error as Error).message}};}
  }}}}});
  mock.module('@/lib/discovery/providers',{namedExports:{getProvider:()=>({fetchFiles:async()=>[],fetchFileContent:async()=>''})}});
  mock.module('@council/scanner/codeguard/agent-detector',{namedExports:{detectAgents:async()=>[]}});
  mock.module('@council/scanner/codeguard/system-detector',{namedExports:{groupAgentsIntoLSystems:()=>[]}});
  mock.module('@council/scanner/codeguard/classifier',{namedExports:{classifyAgent:()=>({})}});
  mock.module('@council/scanner/codeguard/enrichment',{namedExports:{enrichAgent:async()=>({}),enrichSummary:()=>({})}});
  mock.module('@council/scanner/codeguard/repo-intelligence',{namedExports:{generateRepoIntelligence:async()=>({domains:[],services:[],frameworks:[],entrypoints:[],businessCapabilities:[]})}});
  mock.module('@council/scanner/codeguard/repo-knowledge-graph',{namedExports:{buildKnowledgeGraph:()=>({nodes:[],edges:[]})}});
  mock.module('@council/scanner/codeguard/enrichment/cross-file-lineage',{namedExports:{traceCrossFileLineage:()=>({totalFlows:0})}});
  mock.module('@/services/coding-memory',{namedExports:{indexRepoIntelligence:async()=>0,indexAgentCode:async()=>0,semanticSearch:async()=>''}});
  mock.module('@/repositories/talk',{namedExports:{executeQuery:async()=>({answer:'Retained operational answer',confidence:90,intent:'fixture',citations:[]}),
    buildGovernanceContext:async()=>[],formatContextForLLM:()=>'',semanticSearch:async()=>[]}});
  mock.module('@/lib/llm',{namedExports:{getLLMProvider:()=>({available:false}),GOVERNANCE_SYSTEM_PROMPT:'fixture'}});
  const discovery=(await import('../../app/api/discovery/scan/route')).POST;
  const talk=(await import('../../app/api/talk-to-governance/route')).POST;
  const scanRequest=()=>new Request('http://fixture/api/discovery/scan',{method:'POST',body:JSON.stringify({provider:'github',owner:'fixture',repo:'empty',organisationId:randomUUID(),actorUserId:randomUUID()})});
  const talkRequest=()=>new Request('http://fixture/api/talk-to-governance',{method:'POST',body:JSON.stringify({query:'fixture query',organisationId:randomUUID(),actorUserId:randomUUID()})});
  assert.equal((await discovery(scanRequest())).status,503,'prepared/inactive never falls back');
  assert.equal(await pg.owner('SELECT count(*) FROM gov_repo.governance_ledger'),'0');
  await pg.owner(`CALL gov_repo.ledger_v2_activate(ARRAY['discovery_scan','talk_governance_logging']);`);
  const scan=await discovery(scanRequest()); assert.equal(scan.status,200);
  const result=await scan.json(); assert.equal(result.authority,'OPERATIONAL_LEGACY'); assert.equal(result.inventoryStored,0);
  const answer=await talk(talkRequest()); assert.equal(answer.status,200); assert.equal((await answer.json()).answer,'Retained operational answer');
  assert.equal(await pg.owner('SELECT count(*) FROM gov_repo.ledger_tenant_entries_v2'),'6');
  assert.equal(await pg.owner('SELECT legacy_high_watermark FROM gov_repo.ledger_integrity_epochs_v2'),'0');
  assert.equal(await pg.owner(`SELECT previous_hash::text=encode(sha256(convert_to('CODEGUARD-GENESIS-2026','UTF8')),'hex') FROM gov_repo.governance_ledger ORDER BY entry_sequence LIMIT 1`),'t');
  assert.equal(await pg.owner(`SELECT bool_and(organisation_id='${orgA}'::uuid AND actor_user_id='${userId}'::uuid) FROM gov_repo.ledger_tenant_entries_v2`),'t');
  assert.ok(rpcCalls.every(({args})=>args.p_verified_credential_epoch===credentialEpoch && args.p_actor_user_id===undefined));
  // Real credential mutation: the existing trigger deliberately ignores direct
  // authored password_changed_at assignments without a credential change.
  await pg.owner(`UPDATE gov_repo.governance_users SET external_id='rotated-${randomUUID()}' WHERE user_id='${userId}'`);
  assert.notEqual(await pg.owner(`SELECT password_changed_at::text FROM gov_repo.governance_users WHERE user_id='${userId}'`),credentialEpoch);
  for(const [handler,request] of [[discovery,scanRequest],[talk,talkRequest]] as const) {
    const response=await handler(request()); assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:'Ledger recording unavailable'});
  }
  assert.equal(await pg.owner('SELECT count(*) FROM gov_repo.ledger_tenant_entries_v2'),'6');
  assert.equal(await pg.owner('SELECT count(*) FROM gov_repo.governance_ledger'),'6');
  assert.ok(rpcCalls.every(c=>c.name==='ledger_append_v2'));
});
