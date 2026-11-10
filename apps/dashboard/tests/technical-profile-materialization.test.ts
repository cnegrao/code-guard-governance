import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { asOrganisationId } from '@council/canonical-contracts';
import { asReviewSubjectId } from '@council/governance-review';
const org=asOrganisationId('11111111-1111-1111-1111-111111111111'),id=asReviewSubjectId('review-subject:profile');
const principal={organisationId:org,actorUserId:'human',issuedAtSeconds:1,expiresAtSeconds:2,credentialEpoch:'epoch'};
let subject: any,decision: any,proposals: any[],materialized: any,calls: any[],auth=true;
let service: typeof import('@/lib/governance/technical-profile-materialization');
let route: typeof import('@/app/api/governance/workspace/reviews/[id]/technical-profile/route');
class SessionAuthenticationError extends Error {}
before(async()=>{
  mock.module('@/lib/governance/persistence',{namedExports:{governanceReviewPersistence:{getReviewSubject:async()=>subject},privilegedDb:{from(table:string){
    const call={table,filters:[] as any[]};calls.push(call);const q={select(){return q},eq(k:string,v:any){call.filters.push([k,v]);return q},maybeSingle(){return q},then(resolve:any){return Promise.resolve({data:table==='agent_version_technical_profile_proposals'?proposals:materialized,error:null}).then(resolve)}};return q}}}});
  mock.module('@/lib/governance/decision-query',{namedExports:{getGovernanceDecisionDetail:async()=>decision}});
  mock.module('@/lib/governance/reconciliation-input',{namedExports:{getReconciliationInputForReviewSubject:async()=>({status:'OBJECT_INPUT_AVAILABLE',candidate:{candidateKind:'AGENT_VERSION',candidateId:'candidate:exact'}})}});
  mock.module('@/lib/governance/agent-version-technical-profile-persistence',{namedExports:{createGovernedAgentVersionTechnicalProfilePersistence:(p:any)=>({materializeAgentVersionTechnicalProfile:async(input:any)=>{calls.push({write:true,principal:p,input});return{replay:!!materialized,status:'APPLIED',canonicalObjectId:input.canonicalObjectId}}})}});
  mock.module('@/lib/auth',{namedExports:{SessionAuthenticationError,requireVerifiedGovernancePrincipal:async()=>{if(!auth)throw new SessionAuthenticationError();return{userId:principal.actorUserId,...principal}}}});
  service=await import('@/lib/governance/technical-profile-materialization');
  route=await import('@/app/api/governance/workspace/reviews/[id]/technical-profile/route');
});
beforeEach(()=>{subject={candidateKind:'AGENT_VERSION',state:'CERTIFIED'};decision={materialization:{status:'APPLIED',canonicalObjectId:'canonical-object:version'},reconciliation:{family:'OBJECT',actorReference:'human',outcome:'CREATE_NEW'}};
  proposals=[{proposal_id:'proposal:exact',runtime_framework_reference:'LangGraph',build_reference:null,entrypoint_reference:null,configuration_reference:null}];materialized=null;calls=[];auth=true;});
test('read derives one exact candidate proposal, scopes every table and never writes',async()=>{
 const r=await service.getReviewTechnicalProfile(org,id);assert.equal(r.status,'READY');assert.equal(r.values?.runtimeFrameworkReference,'LangGraph');
 assert.equal(r.values?.buildReference,null);assert(calls.every(c=>c.filters?.some(([k,v]:any)=>k==='organisation_id'&&v===org)));assert(!calls.some(c=>c.write));
 assert(calls[0].filters.some(([k,v]:any)=>k==='agent_version_candidate_id'&&v==='candidate:exact'));
});
test('uncertified, unreconciled and multiple proposal contexts never become writable',async()=>{
 subject.state='CONFIRMED';assert.equal((await service.getReviewTechnicalProfile(org,id)).status,'UNAVAILABLE');
 subject.state='CERTIFIED';decision.materialization=null;assert.equal((await service.getReviewTechnicalProfile(org,id)).status,'UNAVAILABLE');
 decision.materialization={status:'APPLIED',canonicalObjectId:'canonical-object:version'};proposals.push({...proposals[0],proposal_id:'other'});
 assert.equal((await service.materializeReviewTechnicalProfile(org,id,principal)).status,'UNAVAILABLE');assert(!calls.some(c=>c.write));
});
test('explicit POST uses verified principal and server-derived coordinates; GET never materializes',async()=>{
 const context={params:Promise.resolve({id:'review-subject%3Aprofile'})};
 assert.equal((await route.GET(new Request('http://localhost/profile'),context)).status,200);assert(!calls.some(c=>c.write));
 assert.equal((await route.POST(new Request('http://localhost/profile',{method:'POST',body:JSON.stringify({proposalId:'forged',organisationId:'foreign',canonicalVersionId:'wrong'})}),context)).status,200);
 const write=calls.find(c=>c.write);assert.equal(write.input.proposalId,'proposal:exact');assert.equal(write.input.canonicalObjectId,'canonical-object:version');assert.equal(write.principal.organisationId,org);
});
test('missing authentication cannot read or materialize; cross-tenant principal is rejected',async()=>{
 auth=false;const context={params:Promise.resolve({id})};assert.equal((await route.POST(new Request('http://localhost/profile'),context)).status,401);
 assert.equal((await route.GET(new Request('http://localhost/profile'),context)).status,401);assert(!calls.some(c=>c.write));
 await assert.rejects(service.materializeReviewTechnicalProfile(org,id,{...principal,organisationId:'foreign'}),/organisation mismatch/);
});
test('UI keeps pending values distinct from canonical facts and writes only on explicit action',()=>{
 const source=readFileSync(new URL('../components/workspace/TechnicalProfileMaterialization.tsx',import.meta.url),'utf8');
 assert.match(source,/Proposed values — not canonical facts/);assert.match(source,/Materialize technical profile/);assert.match(source,/onClick=\{materialize\}/);
 assert.match(source,/useEffect\(\(\) => \{ void load\(\); \}/);assert.match(source,/UNKNOWN/);
});
