import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {asOrganisationId,asSourceSystemId,asSourceConnectionId,asIsoTimestamp,asCanonicalObjectId,validateTechnicalFact,type TrustedInboundConnection,
  type TechnicalFactProposal,type TechnicalFactObservation,type FieldAuthorityPolicy,type FieldAuthorityPolicyHead,type FieldReconciliationDecision,type GovernedTechnicalFieldState,type NormalizedObjectCandidate,type InboundAdapterEnvelope} from '@council/canonical-contracts';
import {purviewInbound,PURVIEW_ADAPTER} from '../../scanner/src/exchange/purview';
import {bindTechnicalFact,factObservation,evaluateFieldAuthority,compareTechnicalFact,reconcileTechnicalFact,StaleFieldDecisionError,StaleFieldPolicyError,type TechnicalFactPersistencePort,type FieldReviewContext} from '../src/technical-facts';
import {validateInboundExchange,intakeInboundExchange,type InboundExchangePorts} from '../src/inbound-exchange';
const org=asOrganisationId('11111111-1111-1111-1111-111111111111'),foreign=asOrganisationId('99999999-9999-9999-9999-999999999999');
const cfg:TrustedInboundConnection={organisationId:org,sourceSystem:{sourceSystemId:asSourceSystemId('system:purview'),family:'CATALOG',displayName:'Purview',provider:{providerCode:'microsoft-purview',resolution:'EXPLICIT'}},connection:{connectionId:asSourceConnectionId('connection:purview'),sourceSystemId:asSourceSystemId('system:purview')}};
const time=asIsoTimestamp('2026-09-11T10:00:00.000Z');
const json=readFileSync(new URL('../../scanner/test/exchange/fixtures/azure-sql.json',import.meta.url),'utf8');
function env(version=1,value='varchar(100)') {const b=JSON.parse(json);b.entities[1].version=version;b.entities[1].attributes.data_type=value;return purviewInbound(JSON.stringify(b),cfg,time);}
function proposal(e=env()) {const t=e.technicalFacts!.find(f=>f.fact.field==='dataType.nativeType')!;return bindTechnicalFact(cfg,t,e.candidates[1] as NormalizedObjectCandidate,e.candidates[0] as NormalizedObjectCandidate);}
const object={organisationId:org,objectId:asCanonicalObjectId('canonical:governed-column'),kind:'DATA_ELEMENT' as const};
const auth={authorize:()=>true};
class Store implements TechnicalFactPersistencePort {
  proposals=new Map<string,TechnicalFactProposal>(); observations=new Map<string,TechnicalFactObservation>();
  decisions=new Map<string,FieldReconciliationDecision>();states:GovernedTechnicalFieldState[]=[];head='';snapshot='snapshot:1';mapped=true;
  policies:FieldAuthorityPolicy[]=[{organisationId:org,policyId:'policy:datatype',version:'1',objectKind:'DATA_ELEMENT',field:'dataType.nativeType',sourceSystemId:cfg.sourceSystem.sourceSystemId,providerCode:'microsoft-purview',disposition:'AUTHORITATIVE'}];
  policyHeads:FieldAuthorityPolicyHead[]=[{organisationId:org,policyId:'policy:datatype',version:'1'}];
  async recordProposal(p:TechnicalFactProposal,o:TechnicalFactObservation) {
    if(p.organisationId!==org||o.organisationId!==org||o.proposalId!==p.proposalId)throw Error('TENANT');
    if(!this.proposals.has(p.proposalId))this.proposals.set(p.proposalId,structuredClone(p));
    if(!this.observations.has(o.observationId)){this.observations.set(o.observationId,{...structuredClone(o),snapshotId:this.snapshot});this.head=o.observationId;}
  }
  async getReviewContext(tenant:typeof org,id:string):Promise<FieldReviewContext>{
    if(tenant!==org||!this.proposals.has(id))throw Error('NOT_FOUND');
    return {proposal:this.proposals.get(id)!,observations:[...this.observations.values()].filter(o=>o.proposalId===id),canonicalObjects:this.mapped?[object]:[],policies:this.policies,policyHeads:this.policyHeads,
      currentSourceObservationId:this.head,currentSourceSnapshotId:this.snapshot,...(this.states.length?{current:this.states.at(-1)!}:{})};
  }
  async getDecision(tenant:typeof org,id:string){if(tenant!==org)throw Error('TENANT');const decision=this.decisions.get(id);return decision?{decision,...(this.states.find(s=>s.decisionId===id)?{stateId:this.states.find(s=>s.decisionId===id)!.stateId}:{})}:undefined;}
  async recordDecision(d:FieldReconciliationDecision){
    // Storage emulates the independent SQL transaction guards; no adapter truth port.
    if(d.expectedSourceObservationId!==this.head||d.expectedSourceSnapshotId!==this.snapshot)throw new StaleFieldDecisionError();
    if(d.expectedCurrentStateId!==this.states.at(-1)?.stateId)throw Error('FIELD_STALE_STATE');
    const policy=evaluateFieldAuthority(this.proposals.get(d.proposalId)!,this.policies,this.policyHeads);
    if(d.policyId!==policy?.policyId||d.policyVersion!==policy?.version)throw new StaleFieldPolicyError();
    this.decisions.set(d.decisionId,structuredClone(d));
    if(d.outcome==='ACCEPT_PROPOSED'){
      const state:GovernedTechnicalFieldState={organisationId:org,stateId:`state:${d.decisionId}`,canonicalObject:object,fact:this.proposals.get(d.proposalId)!.fact,
        proposalId:d.proposalId,decisionId:d.decisionId,recordedAt:time,...(this.states.length?{previousStateId:this.states.at(-1)!.stateId}:{})};
      this.states.push(state);return {replay:false,stateId:state.stateId};
    }return {replay:false};
  }
}
async function setup(){const s=new Store(),p=proposal();await s.recordProposal(p,factObservation(p,time));return {s,p};}
function decision(s:Store,p:TechnicalFactProposal,id='decision:1'):FieldReconciliationDecision{const policy=evaluateFieldAuthority(p,s.policies,s.policyHeads);return {decisionId:id,organisationId:org,canonicalObject:object,field:p.fact.field,proposalId:p.proposalId,
  observationIds:[...s.observations.values()].filter(o=>o.proposalId===p.proposalId).map(o=>o.observationId).sort(),expectedSourceObservationId:s.head,
  expectedSourceSnapshotId:s.snapshot,
  ...(s.states.length?{expectedCurrentStateId:s.states.at(-1)!.stateId}:{}),policyId:policy?.policyId,policyVersion:policy?.version,
  outcome:'ACCEPT_PROPOSED',actor:{authorityKind:'HUMAN',actorReference:'reviewer:1'},decidedAt:time};}
test('semantic proposal ignores observation version and support; changed value is distinct',()=>{
  const a=proposal(),b=proposal(env(2)),c=proposal(env(3,'nvarchar'));
  assert.equal(a.proposalId,b.proposalId);assert.notEqual(a.proposalId,c.proposalId);
  assert.notEqual(factObservation(a,time).observationId,factObservation(b,time).observationId);
  assert.equal(factObservation(a,time).observationId,factObservation(a,asIsoTimestamp('2026-09-12T10:00:00.000Z')).observationId);
});
test('exact replay and same-value changed snapshot retain immutable origin and both support sets',async()=>{
  const {s,p}=await setup();await s.recordProposal(p,factObservation(p,time));const newer=proposal(env(2));await s.recordProposal(newer,factObservation(newer,time));
  assert.equal(s.proposals.size,1);assert.equal(s.observations.size,2);assert.deepEqual(s.proposals.get(p.proposalId),p);assert.equal(s.states.length,0);
  const head=s.head;await s.recordProposal(p,factObservation(p,time));assert.equal(s.head,head);
});
test('field authority is source and field specific; mapping conveys no authority',async()=>{
  const {s,p}=await setup();assert.equal(evaluateFieldAuthority(p,s.policies,s.policyHeads)?.disposition,'AUTHORITATIVE');
  assert.equal(evaluateFieldAuthority({...p,fact:{objectKind:'DATA_ELEMENT',field:'technicalName',value:'reference'}},s.policies,s.policyHeads),undefined);
  assert.equal(evaluateFieldAuthority({...p,sourceSystem:{...p.sourceSystem,sourceSystemId:asSourceSystemId('other')}},s.policies,s.policyHeads),undefined);
  assert.equal(evaluateFieldAuthority(p,[{...s.policies[0],connectionId:'unrelated'}],s.policyHeads),undefined);
  assert.equal(p.trustState,'IMPORTED');
});
test('policy ambiguity fails closed without precedence',async()=>{const {s,p}=await setup();assert.throws(()=>evaluateFieldAuthority(p,[s.policies[0],{...s.policies[0],policyId:'second'}],[...s.policyHeads,{...s.policyHeads[0],policyId:'second'}]),/AMBIGUOUS/);});

test('immutable versions coexist; only an explicit head selects authority, independent of ordering',async()=>{
  const {s,p}=await setup(),v1=structuredClone(s.policies[0]);
  s.policies.push({...v1,version:'2',disposition:'NON_AUTHORITATIVE'});
  assert.equal(evaluateFieldAuthority(p,s.policies,s.policyHeads)?.version,'1');
  s.policies.reverse();assert.equal(evaluateFieldAuthority(p,s.policies,s.policyHeads)?.version,'1');
  s.policyHeads=[{organisationId:org,policyId:v1.policyId,version:'2'}];
  assert.equal(evaluateFieldAuthority(p,s.policies,s.policyHeads)?.disposition,'NON_AUTHORITATIVE');
  assert.deepEqual(s.policies.find(x=>x.version==='1'),v1);
  assert.equal(s.states.length,0);assert.equal(s.decisions.size,0);
});

test('v1 completed decision replays unchanged after v2 activation; new decision binds v2',async()=>{
  const {s,p}=await setup(),d=decision(s,p);await reconcileTechnicalFact(d,s,auth);
  const history=structuredClone({decisions:[...s.decisions.values()],states:s.states});
  s.policies.push({...s.policies[0],version:'2'});s.policyHeads=[{...s.policyHeads[0],version:'2'}];
  assert.equal((await reconcileTechnicalFact(d,s,auth)).replay,true);
  assert.deepEqual({decisions:[...s.decisions.values()],states:s.states},history);
  const next=decision(s,p,'v2-decision');assert.equal(next.policyVersion,'2');await reconcileTechnicalFact(next,s,auth);
  assert.equal(s.decisions.get(d.decisionId)?.policyVersion,'1');assert.equal(s.decisions.get(next.decisionId)?.policyVersion,'2');
  await assert.rejects(reconcileTechnicalFact({...d,policyVersion:'2'},s,auth),/REPLAY_CONFLICT/);
});

test('pending v1 review is stale after explicit v2 activation, even with unchanged authority',async()=>{
  const {s,p}=await setup(),d=decision(s,p);s.policies.push({...s.policies[0],version:'2'});s.policyHeads=[{...s.policyHeads[0],version:'2'}];
  await assert.rejects(reconcileTechnicalFact(d,s,auth),StaleFieldPolicyError);
  assert.equal(s.decisions.size,0);assert.equal(s.states.length,0);assert.equal(d.policyVersion,'1');
});

test('policy activation between application validation and durable write is rejected',async()=>{
  const {s,p}=await setup(),original=s.recordDecision.bind(s);s.policies.push({...s.policies[0],version:'2'});
  s.recordDecision=async d=>{s.policyHeads=[{...s.policyHeads[0],version:'2'}];return original(d);};
  await assert.rejects(reconcileTechnicalFact(decision(s,p),s,auth),StaleFieldPolicyError);assert.equal(s.states.length,0);
});

test('v1 deterministic rule is not inherited by current v2',async()=>{
  const {s,p}=await setup();s.policies=[{...s.policies[0],deterministicRule:{code:'safe-import',version:'rule-v1'}}];
  const machine={authorityKind:'DETERMINISTIC_RULE' as const,ruleCode:'safe-import',ruleVersion:'rule-v1'};
  const old={...decision(s,p),actor:machine};await reconcileTechnicalFact(old,s,auth);
  const {deterministicRule:unused,...base}=s.policies[0];s.policies.push({...base,version:'2'});s.policyHeads=[{...s.policyHeads[0],version:'2'}];
  assert.equal((await reconcileTechnicalFact(old,s,auth)).replay,true);
  await assert.rejects(reconcileTechnicalFact({...decision(s,p,'new-rule'),actor:machine},s,auth),/FIELD_MACHINE_AUTHORITY_FORBIDDEN/);
  assert.equal(s.states.length,1);
});

test('missing head denies acceptance even when immutable authoritative versions exist',async()=>{
  const {s,p}=await setup(),old=decision(s,p);s.policyHeads=[];
  assert.equal(evaluateFieldAuthority(p,s.policies,s.policyHeads),undefined);
  await assert.rejects(reconcileTechnicalFact(old,s,auth),StaleFieldPolicyError);
  await assert.rejects(reconcileTechnicalFact(decision(s,p),s,auth),/FIELD_NOT_AUTHORITATIVE/);
});

test('foreign policy versions and heads cannot confer or change local authority',async()=>{
  const {s,p}=await setup();const foreignPolicy={...s.policies[0],organisationId:foreign,version:'2',disposition:'NON_AUTHORITATIVE' as const};
  s.policies.push(foreignPolicy);s.policyHeads.push({organisationId:foreign,policyId:foreignPolicy.policyId,version:'2'});
  assert.equal(evaluateFieldAuthority(p,s.policies,s.policyHeads)?.version,'1');
  s.policyHeads=[{organisationId:org,policyId:foreignPolicy.policyId,version:'2'}];
  assert.throws(()=>evaluateFieldAuthority(p,s.policies,s.policyHeads),/FIELD_POLICY_HEAD_INVALID/);
  s.policyHeads=[{organisationId:foreign,policyId:foreignPolicy.policyId,version:'2'}];
  await assert.rejects(reconcileTechnicalFact(decision(s,p),s,auth),/FIELD_NOT_AUTHORITATIVE/);
});

test('general and connection-specific current policies remain ambiguous; inactive versions do not compete',async()=>{
  const {s,p}=await setup();s.policies.push({...s.policies[0],version:'2',connectionId:cfg.connection.connectionId});
  assert.equal(evaluateFieldAuthority(p,s.policies,s.policyHeads)?.version,'1');
  s.policies.push({...s.policies[0],policyId:'specific',connectionId:cfg.connection.connectionId});
  s.policyHeads.push({organisationId:org,policyId:'specific',version:'1'});
  assert.throws(()=>evaluateFieldAuthority(p,s.policies,s.policyHeads),/FIELD_POLICY_AMBIGUOUS/);
});

for(const outcome of ['KEEP_CURRENT','DEFER','REJECT_PROPOSED'] as const)test(`${outcome} binds current policy, preserves v1 replay and supports explicit policy absence`,async()=>{
  const {s,p}=await setup();await reconcileTechnicalFact(decision(s,p,'initial'),s,auth);
  const old={...decision(s,p,'old-outcome'),outcome};await reconcileTechnicalFact(old,s,auth);
  const pending={...decision(s,p,'pending'),outcome};s.policies.push({...s.policies[0],version:'2'});s.policyHeads=[{...s.policyHeads[0],version:'2'}];
  assert.equal((await reconcileTechnicalFact(old,s,auth)).replay,true);
  await assert.rejects(reconcileTechnicalFact(pending,s,auth),StaleFieldPolicyError);
  await reconcileTechnicalFact({...decision(s,p,'new-outcome'),outcome},s,auth);
  assert.equal(s.decisions.get('new-outcome')?.policyVersion,'2');
  s.policyHeads=[];await reconcileTechnicalFact({...decision(s,p,'no-policy'),outcome},s,auth);
  assert.equal(s.decisions.get('no-policy')?.policyId,undefined);assert.equal(s.states.length,1);
});
test('unmapped proposal stays pending; ambiguous and foreign canonical targets rejected',async()=>{
  const {s,p}=await setup();s.mapped=false;assert.equal(compareTechnicalFact(await s.getReviewContext(org,p.proposalId)).status,'UNMAPPED');await assert.rejects(reconcileTechnicalFact(decision(s,p),s,auth));
  const context=await s.getReviewContext(org,p.proposalId);assert.throws(()=>compareTechnicalFact({...context,canonicalObjects:[object,object]}),/AMBIGUOUS/);
  assert.throws(()=>compareTechnicalFact({...context,canonicalObjects:[{...object,organisationId:foreign}]}),/CONTEXT/);
});
test('authorized current review accepts a field and replays without duplicate truth',async()=>{
  const {s,p}=await setup(),d=decision(s,p);assert.equal(compareTechnicalFact(await s.getReviewContext(org,p.proposalId)).status,'SOURCE_ONLY');
  assert.equal((await reconcileTechnicalFact(d,s,auth)).replay,false);assert.equal((await reconcileTechnicalFact(d,s,auth)).replay,true);assert.equal(s.states.length,1);
  assert.equal(compareTechnicalFact(await s.getReviewContext(org,p.proposalId)).status,'AGREEMENT');assert.equal(s.proposals.get(p.proposalId)!.trustState,'IMPORTED');
});
test('different value exposes stable conflict; human acceptance preserves predecessor and losing provenance',async()=>{
  const {s,p}=await setup();await reconcileTechnicalFact(decision(s,p),s,auth);
  const changed=proposal(env(2,'nvarchar'));await s.recordProposal(changed,factObservation(changed,time));
  const conflict=compareTechnicalFact(await s.getReviewContext(org,changed.proposalId));assert.equal(conflict.status,'CONFLICT');assert.equal(s.states[0].fact.value,'varchar(100)');
  const newer=proposal(env(3,'nvarchar'));await s.recordProposal(newer,factObservation(newer,time));assert.deepEqual(compareTechnicalFact(await s.getReviewContext(org,changed.proposalId)),conflict);
  await reconcileTechnicalFact(decision(s,changed,'decision:2'),s,auth);assert.equal(s.states.length,2);assert.equal(s.states[1].previousStateId,s.states[0].stateId);assert.equal(s.proposals.size,2);assert.equal(s.observations.size,3);
});
for(const outcome of ['KEEP_CURRENT','REJECT_PROPOSED','DEFER'] as const)test(`${outcome} retains current value and all proposal support`,async()=>{
  const {s,p}=await setup();await reconcileTechnicalFact(decision(s,p),s,auth);const changed=proposal(env(2,'nvarchar'));await s.recordProposal(changed,factObservation(changed,time));
  await reconcileTechnicalFact({...decision(s,changed,'decision:2'),outcome},s,auth);assert.equal(s.states.length,1);assert.equal(s.decisions.size,2);assert.equal(s.proposals.size,2);
});
for(const change of ['same-value-new-snapshot','new-value'] as const)test(`stale source review fails closed: ${change}`,async()=>{
  const {s,p}=await setup(),old=decision(s,p);const newer=proposal(env(2,change==='new-value'?'nvarchar':'varchar(100)'));await s.recordProposal(newer,factObservation(newer,time));
  await assert.rejects(reconcileTechnicalFact(old,s,auth),StaleFieldDecisionError);assert.equal(s.states.length,0);assert.equal(s.decisions.size,0);
});
test('completed decision replay survives later observations but cannot apply again',async()=>{
  const {s,p}=await setup(),d=decision(s,p);await reconcileTechnicalFact(d,s,auth);const changed=proposal(env(2,'nvarchar'));await s.recordProposal(changed,factObservation(changed,time));
  assert.equal((await reconcileTechnicalFact(d,s,auth)).replay,true);assert.equal(s.states.length,1);
});
test('canonical state changing after review rejects old decision',async()=>{
  const {s,p}=await setup(),old=decision(s,p,'old');await reconcileTechnicalFact(decision(s,p,'other'),s,auth);
  await assert.rejects(reconcileTechnicalFact(old,s,auth),/FIELD_STALE_STATE/);assert.equal(s.states.length,1);
});
test('source changes during authorization-to-storage race; transaction rejects',async()=>{
  const {s,p}=await setup(),original=s.recordDecision.bind(s);s.recordDecision=async d=>{const changed=proposal(env(2,'nvarchar'));await s.recordProposal(changed,factObservation(changed,time));return original(d);};
  await assert.rejects(reconcileTechnicalFact(decision(s,p),s,auth),StaleFieldDecisionError);assert.equal(s.states.length,0);
});
test('new snapshot omitting the reviewed field invalidates old and silently refreshed decisions',async()=>{
  const {s,p}=await setup(),old=decision(s,p);s.snapshot='snapshot:field-absent';
  await assert.rejects(reconcileTechnicalFact(old,s,auth),StaleFieldDecisionError);
  await assert.rejects(reconcileTechnicalFact({...old,expectedSourceSnapshotId:s.snapshot},s,auth),StaleFieldDecisionError);
  assert.equal(s.states.length,0);assert.equal(s.proposals.size,1);
});
for(const disposition of ['absent','NON_AUTHORITATIVE'] as const)test(`${disposition} policy cannot materialize`,async()=>{
  const {s,p}=await setup();s.policies=disposition==='absent'?[]:[{...s.policies[0],disposition}];if(disposition==='absent')s.policyHeads=[];await assert.rejects(reconcileTechnicalFact(decision(s,p),s,auth),/FIELD_NOT_AUTHORITATIVE/);assert.equal(s.states.length,0);
});
test('contributing values need human governance; no machine unilateral acceptance',async()=>{
  const {s,p}=await setup();s.policies=[{...s.policies[0],disposition:'CONTRIBUTING'}];
  await assert.rejects(reconcileTechnicalFact({...decision(s,p),actor:{authorityKind:'DETERMINISTIC_RULE',ruleCode:'rule',ruleVersion:'1'}},s,auth));
  await reconcileTechnicalFact(decision(s,p),s,auth);assert.equal(s.states.length,1);
});
test('explicit versioned deterministic policy accepts only nonconflicting supported state',async()=>{
  const {s,p}=await setup();s.policies=[{...s.policies[0],deterministicRule:{code:'safe-import',version:'1'}}];
  await reconcileTechnicalFact({...decision(s,p),actor:{authorityKind:'DETERMINISTIC_RULE',ruleCode:'safe-import',ruleVersion:'1'}},s,auth);
  const changed=proposal(env(2,'nvarchar'));await s.recordProposal(changed,factObservation(changed,time));
  await assert.rejects(reconcileTechnicalFact({...decision(s,changed,'second'),actor:{authorityKind:'DETERMINISTIC_RULE',ruleCode:'safe-import',ruleVersion:'1'}},s,auth),/MACHINE/);assert.equal(s.states.length,1);
});
const substitutions:[string,(d:FieldReconciliationDecision)=>FieldReconciliationDecision][]=[
  ['tenant',d=>({...d,organisationId:foreign})],['canonical object',d=>({...d,canonicalObject:{...object,objectId:asCanonicalObjectId('wrong')}})],
  ['canonical tenant',d=>({...d,canonicalObject:{...object,organisationId:foreign}})],['field',d=>({...d,field:'technicalName'})],
  ['proposal',d=>({...d,proposalId:'other'})],['observation',d=>({...d,observationIds:['other']})],['policy version',d=>({...d,policyVersion:'2'})],
  ['LLM actor',d=>({...d,actor:{authorityKind:'LLM'} as never})],['no evidence',d=>({...d,observationIds:[]})],
];
for(const [name,mutate] of substitutions)test(`decision rejects ${name} substitution`,async()=>{const {s,p}=await setup();await assert.rejects(reconcileTechnicalFact(mutate(decision(s,p)),s,auth));assert.equal(s.states.length,0);});
test('authorization denial creates no audit or truth',async()=>{const {s,p}=await setup();await assert.rejects(reconcileTechnicalFact(decision(s,p),s,{authorize:()=>false}),/AUTHORIZATION/);assert.equal(s.decisions.size,0);});
test('reused decision id cannot select a different outcome',async()=>{const {s,p}=await setup(),d=decision(s,p);await reconcileTechnicalFact(d,s,auth);await assert.rejects(reconcileTechnicalFact({...d,outcome:'DEFER'},s,auth),/REPLAY_CONFLICT/);});
for(const f of [{objectKind:'DATA_ASSET',field:'structuralKind',value:'varchar'}, {objectKind:'DATA_ELEMENT',field:'dataType.nativeType',value:42}, {objectKind:'DATA_ASSET',field:'arbitrary.path',value:'x'}, {objectKind:'DATA_ELEMENT',field:'technicalDescription',value:'x'}])test(`invalid typed fact ${JSON.stringify(f)}`,()=>assert.throws(()=>validateTechnicalFact(f as never)));
test('declared repository support can coexist with imported proposal without changing either trust',async()=>{
  const {s,p}=await setup();const declared={...p,proposalId:'repository:datatype',trustState:'DECLARED' as const};s.proposals.set(declared.proposalId,declared);
  s.states.push({organisationId:org,stateId:'repository-state',canonicalObject:object,fact:declared.fact,proposalId:declared.proposalId,decisionId:'repository-review',recordedAt:time});
  const changed=proposal(env(2,'varchar(200)'));await s.recordProposal(changed,factObservation(changed,time));assert.equal(compareTechnicalFact(await s.getReviewContext(org,changed.proposalId)).status,'CONFLICT');
  assert.equal(s.proposals.get(declared.proposalId)!.trustState,'DECLARED');assert.equal(changed.trustState,'IMPORTED');
});
test('complete inbound reference gate accepts real adapter output',()=>validateInboundExchange(env(),cfg,PURVIEW_ADAPTER));
const envelopeMutations:[string,(e:any)=>void][]=[['tenant',e=>e.organisationId='evil'],['mapping',e=>e.canonicalMappings=[]],['connection',e=>e.connection.connectionId='evil'],
  ['source system',e=>e.run.connection.sourceSystemId='evil'],['adapter version',e=>e.run.adapterVersion='2'],['dangling snapshot',e=>e.snapshots=[]],
  ['dangling evidence',e=>e.evidence=[]],['assertion trust',e=>e.assertions[0].trustState='VALIDATED'],['finding support',e=>e.findings[0].assertionIds=['wrong']],
  ['candidate support',e=>e.candidates[0].evidenceIds=['wrong']],['fact support',e=>e.technicalFacts[0].support.assertionIds=['wrong']],['raw evidence',e=>e.evidence[0].redactedExcerpt='secret']];
for(const [name,mutate] of envelopeMutations)test(`inbound gate rejects ${name}`,()=>{const e=structuredClone(env());mutate(e);assert.throws(()=>validateInboundExchange(e,cfg,PURVIEW_ADAPTER));});

function intakeHarness() {
  const facts=new Store(), runs=new Map<string,any>(),ev=new Map<string,any>(),assertions=new Map<string,any>(),findings=new Map<string,any>(),candidates=new Map<string,any>(),reviews=new Map<string,any>();
  let mapped=false;
  const forbidden=()=>{throw Error('FORBIDDEN_CANONICAL_WRITE');};
  const ports:InboundExchangePorts={facts,async assertConfiguredConnection(context){if(context.organisationId!==org||context.connection.connectionId!==cfg.connection.connectionId)throw Error('CONFIGURED_TENANT_MISMATCH');},
    intake:{
      async startAcquisitionRun(tenant,run){assert.equal(tenant,org);const old=runs.get(run.runId);if(!old)runs.set(run.runId,run);return {runId:run.runId,replay:!!old,status:old?.status??run.status};},
      async completeAcquisitionRun(tenant,run){assert.equal(tenant,org);runs.set(run.runId,run);return {runId:run.runId,replay:false,status:run.status};},
      async recordEvidence(_org,e){const replay=ev.has(e.evidenceId);if(!replay)ev.set(e.evidenceId,e);return {evidenceId:e.evidenceId,replay};},
      async recordSourceAssertion(_org,a){assert.ok(a.evidenceIds.every(id=>ev.has(id)));const replay=assertions.has(a.assertionId);if(!replay)assertions.set(a.assertionId,a);return {assertionId:a.assertionId,replay};},
      async recordDiscoveryFinding(_org,f){assert.ok(f.assertionIds.every(id=>assertions.has(id)));const replay=findings.has(f.findingId);if(!replay)findings.set(f.findingId,f);return {findingId:f.findingId,replay};},
      async recordNormalizedCandidate(_org,c){assert.ok(findings.has(c.findingId));const replay=candidates.has(c.candidateId);if(!replay)candidates.set(c.candidateId,c);return {candidateId:c.candidateId,replay};},
      async getDiscoveryFinding(_org,id){return findings.get(id);},async getNormalizedCandidateForFinding(_org,id){return [...candidates.values()].find(c=>c.findingId===id);},
    },
    review:{async getReviewSubject(_org:string,id:string){return reviews.get(id);},async createReviewSubject(subject:any){assert.ok(findings.has(subject.findingId));reviews.set(subject.reviewSubjectId,subject);return {replay:false,subject};},
      async persistReviewTransition(t:any){reviews.set(t.subject.reviewSubjectId,t.subject);return {replay:false,subject:t.subject,event:t.event};}} as unknown as InboundExchangePorts['review'],
    materialization:{materializeObjectReconciliation:forbidden,materializeRelationshipReconciliation:forbidden,async findActiveObjectSourceMapping(input){
      assert.equal(input.organisationId,org);assert.ok(input.normalizedObjectIdentity);return mapped?{mappingId:'governed',canonicalObjectId:'canonical:existing',canonicalObjectKind:input.canonicalObjectKind!}:undefined;}},
  };
  return {ports,facts,runs,ev,assertions,findings,candidates,reviews,setMapped(){mapped=true;}};
}
test('real inbound intake persists complete support before PROPOSED review and exact replay is a no-op',async()=>{
  const h=intakeHarness(),first=await intakeInboundExchange(env(),cfg,PURVIEW_ADAPTER,h.ports);
  assert.equal(h.reviews.size,2);assert.ok([...h.reviews.values()].every(r=>r.state==='PROPOSED'));
  assert.equal(h.facts.proposals.size,6);assert.equal(h.facts.states.length,0);
  const sizes=[h.ev.size,h.assertions.size,h.facts.observations.size,h.reviews.size];
  assert.deepEqual(await intakeInboundExchange(env(),cfg,PURVIEW_ADAPTER,h.ports),first);
  assert.deepEqual([h.ev.size,h.assertions.size,h.facts.observations.size,h.reviews.size],sizes);
});
test('same value in a changed snapshot keeps semantic proposals, original evidence and observation history',async()=>{
  const h=intakeHarness();await intakeInboundExchange(env(),cfg,PURVIEW_ADAPTER,h.ports);const oldEvidence=[...h.ev.keys()];
  await intakeInboundExchange(env(2),cfg,PURVIEW_ADAPTER,h.ports);assert.equal(h.facts.proposals.size,6);assert.equal(h.facts.observations.size,8);
  assert.ok(oldEvidence.every(id=>h.ev.has(id)));assert.equal(h.facts.states.length,0);
});
test('exact governed object mapping suppresses object review but never fact observation or grants authority',async()=>{
  const h=intakeHarness();h.setMapped();await intakeInboundExchange(env(),cfg,PURVIEW_ADAPTER,h.ports);
  assert.equal(h.reviews.size,0);assert.equal(h.facts.proposals.size,6);assert.equal(h.facts.states.length,0);
});
test('cross-tenant reuse of a trusted connection fails before persistence',async()=>{
  const h=intakeHarness();await assert.rejects(intakeInboundExchange(env(),{...cfg,organisationId:foreign},PURVIEW_ADAPTER,h.ports),/TENANT/);assert.equal(h.runs.size,0);
});
test('invalid envelope is rejected before any durable mutation',async()=>{
  const h=intakeHarness(),e=env();await assert.rejects(intakeInboundExchange({...e,evidence:[]},cfg,PURVIEW_ADAPTER,h.ports));assert.equal(h.runs.size,0);
});
