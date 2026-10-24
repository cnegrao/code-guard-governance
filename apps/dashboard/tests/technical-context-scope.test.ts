import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTechnicalScopeSource,isResolvedTechnicalScope} from '../lib/governance/technical-context-scope';
const org='11111111-1111-4111-8111-111111111111';
const principal={organisationId:org,userId:org,credentialEpoch:'2026-10-01T00:00:00.000000Z',issuedAtSeconds:1,expiresAtSeconds:2,informational:{}};
const binding=()=>({selection_key:'opaque',organisation_id:org,repository_id:'a'.repeat(64),snapshot_id:'b'.repeat(64)});
test('trusted scope captures exact operator bindings and freezes them',()=>{
 const b=binding(),source=createTechnicalScopeSource({bindings:[b]}),x=source(principal,'opaque');assert.ok('scope' in x);
 b.snapshot_id='c'.repeat(64);assert.equal(x.scope.snapshot_id,'b'.repeat(64));assert.ok(Object.isFrozen(x.scope));
 assert.ok(isResolvedTechnicalScope(x.scope));assert.equal(isResolvedTechnicalScope({...x.scope}),false);
});
for(const selector of ['', 'missing', 'a'.repeat(64), '../path', 'main'])test('untrusted selector cannot construct resource identity '+selector,()=>{
 assert.deepEqual(createTechnicalScopeSource({bindings:[binding()]})(principal,selector),{unavailable:'SCOPE_REQUIRED'});
});
test('identical selector never crosses verified organisation',()=>{
 assert.deepEqual(createTechnicalScopeSource({bindings:[binding()]} )({...principal,organisationId:'99999999-9999-4999-8999-999999999999'},'opaque'),{unavailable:'SCOPE_REQUIRED'});
});
for(const [key,value] of [['organisation_id','wrong'],['repository_id','main'],['snapshot_id','latest'],['selection_key',' '],['extra','forbidden']] as const)
 test('scope configuration rejects '+key,()=>{const b:any=binding();b[key]=value;assert.throws(()=>createTechnicalScopeSource({bindings:[b]}),TypeError);});
test('duplicate organisation/selector is ambiguous configuration',()=>{
 assert.throws(()=>createTechnicalScopeSource({bindings:[binding(),binding()]}),TypeError);
});
