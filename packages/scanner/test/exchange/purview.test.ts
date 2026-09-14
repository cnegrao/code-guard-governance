import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { asSourceConnectionId,asSourceSystemId,asIsoTimestamp,sourceObjectIdentityKey,type SourceSystem } from '@council/canonical-contracts';
import { purviewInbound,parsePurviewEntities,PURVIEW_ADAPTER } from '../../src/exchange/purview';
const json=readFileSync(new URL('./fixtures/azure-sql.json',import.meta.url),'utf8');
const sourceSystem:SourceSystem={sourceSystemId:asSourceSystemId('system:purview'),family:'CATALOG',displayName:'Purview',provider:{providerCode:'microsoft-purview',resolution:'EXPLICIT'}};
const cfg={sourceSystem,connection:{connectionId:asSourceConnectionId('connection:purview'),sourceSystemId:sourceSystem.sourceSystemId}};
const time=asIsoTimestamp('2026-09-11T10:00:00.000Z');
const batch=()=>JSON.parse(json);
const envelope=(p=batch())=>purviewInbound(JSON.stringify(p),cfg,time);
test('real Azure SQL table and column map to exact parent with qualifiedName identity',()=>{
  const e=envelope(),[asset,column]=e.candidates;
  assert.equal(asset.candidateKind,'DATA_ASSET');assert.equal(column.candidateKind,'DATA_ELEMENT');
  if(asset.candidateKind!=='DATA_ASSET'||column.candidateKind!=='DATA_ELEMENT')throw Error();
  assert.equal(asset.proposedIdentity.sourceReference,batch().entities[0].attributes.qualifiedName);
  assert.deepEqual(column.proposedIdentity.parentDataAsset,{referenceKind:'CANDIDATE',candidateKind:'DATA_ASSET',candidateId:asset.candidateId});
  assert.equal(column.proposedIdentity.elementPath,'reference');
  assert.equal(e.sourceSystem.family,'CATALOG');assert.equal(e.sourceSystem.provider.providerCode,'microsoft-purview');
  assert.deepEqual(e.connection,cfg.connection);assert.equal(e.run.adapterName,PURVIEW_ADAPTER.name);
  assert.ok(!JSON.stringify(e).includes('canonicalObject'));assert.ok(!JSON.stringify(e).includes('organisationId'));
});
test('facts are separate from IMPORTED provenance and unmodeled metadata is omitted',()=>{
  const e=envelope();assert.ok(e.assertions.every(a=>a.trustState==='IMPORTED'&&a.sourceAttribute&&a.evidenceIds.length));
  assert.ok(e.evidence.every(e=>e.handling==='HASH_ONLY'&&!e.redactedExcerpt));
  assert.equal(e.technicalFacts?.find(f=>f.fact.field==='dataType.nativeType')?.fact.value,'varchar(100)');
  assert.ok(e.assertions.every(a=>!('value' in a)));assert.ok(!JSON.stringify(e).includes('unmapped-context'));
});
test('same snapshot replay and reordered entity lists are deterministic',()=>{
  assert.deepEqual(envelope(),envelope());const p=batch();p.entities.reverse();assert.deepEqual(envelope(p),envelope());
});
test('version change adds evidence while source identity stays exact',()=>{
  const p=batch(),old=envelope();p.entities[1].version=2;const next=envelope(p);
  assert.equal(sourceObjectIdentityKey(old.objects[1].identity),sourceObjectIdentityKey(next.objects[1].identity));
  assert.notEqual(old.evidence[1].evidenceId,next.evidence[1].evidenceId);
  assert.notEqual(old.assertions.at(-1)!.assertionId,next.assertions.at(-1)!.assertionId);
});
test('same GUID from different configured connections has different source identity',()=>{
  const other=purviewInbound(json,{...cfg,connection:{...cfg.connection,connectionId:asSourceConnectionId('connection:other')}},time);
  assert.notEqual(sourceObjectIdentityKey(other.objects[0].identity),sourceObjectIdentityKey(envelope().objects[0].identity));
});
test('missing datatype and description remain absent facts',()=>{
  const p=batch();delete p.entities[1].attributes.data_type;delete p.entities[0].attributes.description;
  assert.ok(!envelope(p).technicalFacts?.some(f=>['dataType.nativeType','technicalDescription'].includes(f.fact.field)));
});
test('names are labels except exact column identifier under explicit parent',()=>{
  const p=batch();p.entities[0].attributes.name='different label';const c=envelope(p).candidates[0];
  assert.equal(c.candidateKind==='DATA_ASSET'&&c.proposedIdentity.sourceReference,batch().entities[0].attributes.qualifiedName);
});
const mutations: [string,(p:any)=>void][]=[
  ['unknown type',p=>p.entities[0].typeName='anything_table'],['missing guid',p=>delete p.entities[0].guid],
  ['invalid guid',p=>p.entities[0].guid='-100'],['missing qualifiedName',p=>delete p.entities[0].attributes.qualifiedName],
  ['malformed attributes',p=>p.entities[0].attributes=[]],['missing name',p=>delete p.entities[1].attributes.name],
  ['duplicate guid',p=>p.entities.push(p.entities[0])],['dangling parent',p=>p.entities[1].relationshipAttributes.table.guid='33333333-aaaa-bbbb-cccc-333333333333'],
  ['name-only parent',p=>p.entities[1].relationshipAttributes.table={name:'orders',typeName:'azure_sql_table'}],
  ['absent parent',p=>delete p.entities[1].relationshipAttributes.table],['dangling column',p=>p.entities.pop()],
  ['inactive entity',p=>p.entities[0].status='DELETED'],['shell entity',p=>p.entities[0].isIncomplete=true],
  ['query credential',p=>p.entities[0].attributes.qualifiedName+='?token=secret'],['userinfo credential',p=>p.entities[0].attributes.qualifiedName='mssql://user:pass@host/db/t'],
  ['injected tenant',p=>p.organisationId='other'],['nested canonical identity',p=>p.entities[0].attributes.canonicalObjectId='chosen'],
  ['injected policy',p=>p.entities[0].authorityPolicy={}],['injected decision',p=>p.governanceDecision={}],
  ['trust promotion',p=>p.entities[0].trustState='VALIDATED'],['prototype',p=>Object.defineProperty(p.entities[0],'__proto__',{value:{polluted:true},enumerable:true})],
  ['negative version',p=>p.entities[0].version=-1],['wrong datatype type',p=>p.entities[1].attributes.data_type=123],
  ['secret in modeled description',p=>p.entities[0].attributes.description='access_token=secret'],
];
for(const [name,mutate] of mutations)test(`fail closed: ${name}`,()=>{const p=batch();mutate(p);assert.throws(()=>envelope(p));});
test('unrestricted secret-bearing metadata is never retained',()=>{
  const p=batch();p.entities[0].customAttributes={access_token:'DO-NOT-PERSIST'};assert.ok(!JSON.stringify(envelope(p)).includes('DO-NOT-PERSIST'));
});
test('payload bounds and invalid JSON fail closed',()=>{assert.throws(()=>parsePurviewEntities(' ' .repeat(1_048_577)));assert.throws(()=>parsePurviewEntities('{'));});
test('configured source system mismatch fails closed',()=>{assert.throws(()=>purviewInbound(json,{...cfg,connection:{...cfg.connection,sourceSystemId:asSourceSystemId('different')}},time));});
test('two columns with the same exact identifier under one parent fail closed',()=>{
  const p=batch(),other=structuredClone(p.entities[1]);other.guid='33333333-aaaa-bbbb-cccc-333333333333';other.attributes.qualifiedName+='_other';
  p.entities[0].relationshipAttributes.columns.push({guid:other.guid,typeName:'azure_sql_column'});p.entities.push(other);
  assert.throws(()=>envelope(p),/AMBIGUOUS_ELEMENT/);
});
test('same column identifier under two explicit distinct parents stays distinct',()=>{
  const p=batch(),table=structuredClone(p.entities[0]),column=structuredClone(p.entities[1]);
  table.guid='33333333-aaaa-bbbb-cccc-333333333333';table.attributes.qualifiedName+='_archive';
  column.guid='44444444-aaaa-bbbb-cccc-444444444444';column.relationshipAttributes.table.guid=table.guid;
  column.attributes.qualifiedName=table.attributes.qualifiedName+'#reference';table.relationshipAttributes.columns=[{guid:column.guid,typeName:'azure_sql_column'}];p.entities.push(table,column);
  const columns=envelope(p).candidates.filter(c=>c.candidateKind==='DATA_ELEMENT');assert.equal(columns.length,2);assert.notDeepEqual(columns[0].proposedIdentity.parentDataAsset,columns[1].proposedIdentity.parentDataAsset);
});
