import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';

const calls: {name:string;args:Record<string,unknown>}[]=[];
let fail: {code:string;message:string}|null=null;
mock.module('@/lib/governance/persistence',{namedExports:{privilegedDb:{rpc:async(name:string,args:Record<string,unknown>)=>{
  calls.push({name,args});
  return {data:fail?null:{email:'local@example.invalid',organisationCode:'FIXTURE'},error:fail};
}}}});
let POST: typeof import('../app/api/auth/operator-invitation/route').POST;
before(async()=>{ ({POST}=await import('../app/api/auth/operator-invitation/route')); });
process.env.NEXT_PUBLIC_APP_URL='http://127.0.0.1:3101';
const token='a'.repeat(43);
const request=(body:unknown,origin='http://127.0.0.1:3101',type='application/json')=>new Request('http://127.0.0.1:3101/api/auth/operator-invitation',{
  method:'POST',headers:{origin,host:'127.0.0.1:3101','content-type':type},body:typeof body==='string'?body:JSON.stringify(body),
});
test('invitation ingress rejects cross-origin and caller-selected identity/authority before database access',async()=>{
  calls.length=0;
  assert.equal((await POST(request({token},'http://attacker.invalid'))).status,403);
  assert.equal((await POST(request({token},'null'))).status,403);
  const hostileHost=request({token}); hostileHost.headers.set('host','attacker.invalid');
  assert.equal((await POST(hostileHost)).status,403);
  assert.equal((await POST(request({token},'http://127.0.0.1:3101','text/plain'))).status,415);
  for(const extra of [{organisationId:'any'},{email:'attacker@example.invalid'},{role:'org_admin'},{fullName:'Other'}]){
    assert.equal((await POST(request({token,...extra}))).status,400);
    assert.equal((await POST(request({token,password:'test password only',...extra}))).status,400);
  }
  assert.equal(calls.length,0);
});
test('valid preview hashes the bearer and returns only safe metadata without caching',async()=>{
  calls.length=0; fail=null;
  const res=await POST(request({token})); const body=await res.json();
  assert.equal(res.status,200); assert.equal(res.headers.get('cache-control'),'no-store');
  assert.equal(res.headers.get('referrer-policy'),'no-referrer');
  assert.equal(body.email,'local@example.invalid');
  assert.match(String(calls[0].args.p_token_hash),/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(calls).includes(token),false);
});
test('password policy respects bcrypt UTF-8 byte limit; malformed and oversized bodies fail closed',async()=>{
  calls.length=0;
  for(const password of ['short','é'.repeat(37)]) assert.equal((await POST(request({token,password}))).status,400);
  assert.equal((await POST(request('{'))).status,400);
  assert.equal((await POST(request('x'.repeat(2049)))).status,413);
  assert.equal(calls.length,0);
});
test('redeem uses bcrypt cost 12 and never returns/sets an authentication session or password',async()=>{
  calls.length=0; fail=null;
  const password='Local fixture password';
  const res=await POST(request({token,password}));
  assert.deepEqual(await res.json(),{success:true}); assert.equal(res.headers.get('set-cookie'),null);
  assert.equal(calls[1].name,'redeem_governance_operator_invitation_v1');
  assert.match(String(calls[1].args.p_password_hash),/^bcrypt:\$2[aby]\$12\$/);
  assert.equal(JSON.stringify(calls).includes(password),false);
});
test('invalid/reused capabilities and infrastructure failures expose no database diagnostics',async()=>{
  for(const code of ['22023','23505','08000']){
    calls.length=0; fail={code,message:'internal database address and sensitive diagnostics'};
    const res=await POST(request({token,password:'Local fixture password'}));
    assert.equal(res.status,code==='08000'?500:400);
    assert.equal((await res.text()).includes('internal database'),false);
    assert.equal(calls.length,1); // Invalid token does not reach bcrypt or redemption.
  }
  fail=null;
});
