import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, mock, test } from 'node:test';
import { spawnSync as actualSpawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const cli=fileURLToPath(new URL('../../../scripts/admin/issue-operator-invitation.mjs',import.meta.url));
const repo=path.resolve(path.dirname(cli),'../..'),privateParent=path.resolve(repo,'.artifacts/agent/operator-invitations');
const input={ 'project-ref':'zkqfvqwqdypgpzauzinw','org-id':'11111111-1111-1111-1111-111111111111','org-code':'FIXTURE',email:'Operator@Example.invalid',name:'Offline operator',reason:'Offline CLI regression only',hours:'2' };
let validate:(input:Record<string,string>)=>Record<string,unknown>,main:(args:string[])=>Promise<void>;
let directory:string,fail=false,wrongReceipt=false,aclFail=false,prints:string[],calls:{exe:string;args:string[];cwd?:string}[],created:string[];
before(async()=>{
  mock.module('node:child_process',{namedExports:{spawnSync:(exe:string,args:string[],opts:{cwd?:string})=>{
    calls.push({exe,args,cwd:opts.cwd});
    if(exe==='powershell.exe')return{status:0,stdout:'S-1-5-21-111-222-333-1001\n'};
    if(exe==='icacls.exe'){created.push(args[0]);return{status:aclFail?1:0,stdout:''};}
    assert.equal(exe,process.execPath);assert.deepEqual(args.slice(1,6),['db','query','--linked','--output','json']);
    assert.equal(args[6],'--file');
    return{status:fail?1:0,stderr:'PRIVATE_DATABASE_DETAIL',stdout:JSON.stringify({rows:[{invitation:{invitationId:'offline-receipt',email:'operator@example.invalid',organisationId:wrongReceipt?'foreign':input['org-id']}}]})};
  }}});
  ({validateInvitationInput:validate,main}=await import(new URL('../../../scripts/admin/issue-operator-invitation.mjs',import.meta.url).href));
});
beforeEach(()=>{
  directory=mkdtempSync(path.join(tmpdir(),'govia-cli-offline-'));mkdirSync(path.join(directory,'supabase/.temp'),{recursive:true});
  writeFileSync(path.join(directory,'supabase/.temp/linked-project.json'),JSON.stringify({ref:input['project-ref']}));
  fail=false;wrongReceipt=false;aclFail=false;prints=[];calls=[];created=[];
  mock.method(console,'log',(s:unknown)=>prints.push(String(s)));
});
afterEach(()=>{
  for(const d of created){const resolved=path.resolve(d);assert.equal(path.dirname(resolved),privateParent);assert.match(path.basename(resolved),/^[0-9a-f-]{36}$/);rmSync(resolved,{recursive:true,force:true});}
  const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(tmpdir()));assert.ok(path.basename(resolved).startsWith('govia-cli-offline-'));rmSync(resolved,{recursive:true,force:true});
});
const args=(extra:Record<string,string>={})=>Object.entries({...input,'linked-workdir':directory,...extra}).flatMap(([k,v])=>['--'+k,v]);
test('CLI validator normalizes input and rejects wrong target, malformed identity and unbounded lifetime offline',()=>{
  assert.equal(validate(input).email,'operator@example.invalid');assert.equal(validate(input).hours,2);
  for(const invalid of [{'project-ref':'unapproved'}, {'org-id':'invalid'}, {'org-code':'lowercase'}, {email:'invalid'}, {name:'x'}, {reason:'short'}, {hours:'0'}, {hours:'25'}, {hours:'NaN'}])assert.throws(()=>validate({...input,...invalid}));
  assert.equal(calls.length,0);
});
test('CLI orchestration pins the link, protects delivery, hashes the code and sends only the exact administrative query',async()=>{
  await main(args());const receipt=JSON.parse(prints[0]);const token=readFileSync(receipt.codeFile,'utf8').trim();
  assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.ok(!prints.join('').includes(token));
  const acl=calls.find(c=>c.exe==='icacls.exe')!;assert.ok(acl.args.includes('/inheritance:r'));assert.ok(acl.args.some(a=>a.includes('*S-1-5-18:')));
  const query=calls.find(c=>c.exe===process.execPath)!;assert.equal(query.cwd,directory);
  const sql=readFileSync(query.args[7],'utf8');assert.ok(sql.includes('issue_governance_operator_invitation_v1'));assert.ok(sql.includes(input['org-id']));
  assert.ok(sql.includes(createHash('sha256').update(token).digest('hex')));assert.ok(!sql.includes(token));
  assert.equal(receipt.projectRef,input['project-ref']);assert.equal(receipt.activationUrl,'http://localhost:3101/accept-invitation');
});
test('CLI rejects a foreign project link before token delivery or any process invocation',async()=>{
  writeFileSync(path.join(directory,'supabase/.temp/linked-project.json'),JSON.stringify({ref:'unapproved'}));
  await assert.rejects(main(args()),/Linked project mismatch/);assert.deepEqual(calls,[]);assert.deepEqual(prints,[]);
});
test('CLI fails closed on private ACL failure, transport error and mismatched receipt',async()=>{
  aclFail=true;await assert.rejects(main(args()),/Cannot protect/);assert.equal(calls.some(c=>c.exe===process.execPath),false);
  aclFail=false;fail=true;await assert.rejects(main(args()),/Administrative CLI query failed/);assert.equal(prints.length,0);
  fail=false;wrongReceipt=true;await assert.rejects(main(args()),/Unexpected invitation receipt/);assert.equal(prints.length,0);
});
test('actual CLI entrypoint exits before network access for wrong target and mismatched local link',()=>{
  const wrong=actualSpawnSync(process.execPath,[cli,...args({'project-ref':'unapproved'})],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(wrong.status,1);assert.match(wrong.stderr,/explicitly authorised/);assert.equal(wrong.stdout,'');
  writeFileSync(path.join(directory,'supabase/.temp/linked-project.json'),JSON.stringify({ref:'unapproved'}));
  const linked=actualSpawnSync(process.execPath,[cli,...args()],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(linked.status,1);assert.match(linked.stderr,/Linked project mismatch/);assert.equal(linked.stdout,'');
});
