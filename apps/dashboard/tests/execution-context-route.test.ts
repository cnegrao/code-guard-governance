import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { SignJWT } from 'jose';

const secret='execution-route-fixture-key-local-only';
const org='11111111-1111-1111-1111-111111111111';
let cookie:string|undefined;
let reads:string[]=[];
let writes:unknown[][]=[];
let route:typeof import('@/app/api/governance/workspace/execution-context/route');
before(async()=>{
  process.env.JWT_SECRET=secret;
  mock.module('next/headers',{namedExports:{cookies:async()=>({get:()=>cookie?{value:cookie}:undefined}),headers:async()=>new Headers({'x-codeguard-org':'forged','x-codeguard-user':'forged','x-codeguard-role':'org_admin'})}});
  mock.module('@/lib/governance/execution-context-review',{namedExports:{
    executionReviewQueue:async(tenant:string)=>{reads.push(tenant);return [];},
    submitExecutionDecision:async(...args:unknown[])=>{writes.push(args);return {replay:false};},
  }});
  route=await import('@/app/api/governance/workspace/execution-context/route');
});
async function token(role='org_admin'){
  return new SignJWT({sub:'human',org,email:'fixture@example.invalid',role}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(secret));
}
beforeEach(async()=>{process.env.JWT_SECRET=secret;cookie=await token();reads=[];writes=[];});
const request=(body:unknown={decisionId:'decision'})=>new Request('https://example.invalid/api/governance/workspace/execution-context',{method:'POST',headers:{'x-codeguard-org':'forged'},body:JSON.stringify(body)});
test('M13 GET and POST derive tenant and human exclusively from a verified cookie',async()=>{
  assert.equal((await route.GET()).status,200);assert.deepEqual(reads,[org]);
  assert.equal((await route.POST(request())).status,200);
  assert.deepEqual(writes[0][1],{organisationId:org,actorReference:'human',role:'org_admin'});
});
test('M13 forged headers cannot authenticate or grant reviewer authority',async()=>{
  cookie=undefined;assert.equal((await route.GET()).status,401);assert.equal((await route.POST(request())).status,401);
  cookie=await token('user');assert.equal((await route.POST(request())).status,403);
  assert.deepEqual(writes,[]);assert.deepEqual(reads,[]);
});
test('M13 invalid signed cookie and development fallback cannot enable privileged reads',async()=>{
  cookie='invalid';assert.equal((await route.GET()).status,401);
  cookie=await token();delete process.env.JWT_SECRET;assert.equal((await route.GET()).status,401);
  process.env.JWT_SECRET='fallback-dev-secret-change-in-production';assert.equal((await route.POST(request())).status,401);
  assert.deepEqual(reads,[]);assert.deepEqual(writes,[]);
});
test('M13 oversized and malformed requests never reach the command service',async()=>{
  assert.equal((await route.POST(request({padding:'x'.repeat(16385)}))).status,400);
  const malformed=new Request('https://example.invalid',{method:'POST',body:'{'});
  assert.equal((await route.POST(malformed)).status,409);assert.deepEqual(writes,[]);
});
