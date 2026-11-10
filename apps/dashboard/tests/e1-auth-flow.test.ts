import assert from 'node:assert/strict';
import { before, after, mock, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { signToken, SESSION_COOKIE_NAME } from '../lib/auth/session-token';

// Isolated cryptographic fixtures only: no hosted user, cookie or password.
const secret = randomBytes(32).toString('hex');
const environment = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL, GOVIA_E1_AUTH_DIAGNOSTICS: process.env.GOVIA_E1_AUTH_DIAGNOSTICS };
let cookie: string | undefined;
const messages: unknown[][]=[];
let navigation: typeof import('../middleware');
let auth: typeof import('../lib/auth');
let login: typeof import('../app/api/auth/login/route');
before(async()=>{
  Object.assign(process.env,{NODE_ENV:'development',JWT_SECRET:secret,NEXT_PUBLIC_APP_URL:'http://localhost:3101',GOVIA_E1_AUTH_DIAGNOSTICS:'1'});
  mock.method(console,'info',(...args:unknown[])=>{ messages.push(args); });
  mock.module('next/headers',{namedExports:{cookies:async()=>({get:(name:string)=>name===SESSION_COOKIE_NAME&&cookie?{value:cookie}:undefined})}});
  mock.module('@/services/auth',{namedExports:{login:async()=>({session:{
    token:await signToken({sub:'local-user',org:'local-org',email:'local@example.invalid',role:'org_admin',credentialEpoch:'2026-01-01T00:00:00.000001Z'}),
    user:{user_id:'local-user',email:'local@example.invalid'},org:{organisation_id:'local-org'},
  }})}});
  navigation=await import('../middleware'); auth=await import('../lib/auth'); login=await import('../app/api/auth/login/route');
});
after(()=>{for(const [key,value] of Object.entries(environment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
function request(host='localhost:3101',value?:string,method='GET'){
  return new NextRequest(`http://${host}/governance/reviews`,{method,headers:{host,...(value?{cookie:`${SESSION_COOKIE_NAME}=${value}`}:{})}});
}
test('local alias navigation redirects before login; credential POST cannot cross host silently',async()=>{
  const response=await navigation.middleware(request('127.0.0.1:3101'));
  assert.equal(response.status,307);
  assert.equal(response.headers.get('location'),'http://localhost:3101/governance/reviews');
  assert.equal((await navigation.middleware(request('127.0.0.1:3101',undefined,'POST'))).status,409);
});
test('login response has a host-only HttpOnly cookie; real JWT fixture passes middleware and Node verifier with the same configuration',async()=>{
  const response=await login.POST(new Request('http://localhost:3101/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'local@example.invalid',password:'Local fixture only'})}));
  assert.equal(response.status,200);
  const header=response.headers.get('set-cookie')??'';
  for(const attribute of ['HttpOnly','Path=/','SameSite=Lax','Max-Age=28800']) assert.ok(header.includes(attribute),`missing ${attribute}`);
  assert.equal(/Domain=|; Secure/i.test(header),false);
  cookie=header.split(';',1)[0].slice(SESSION_COOKIE_NAME.length+1);
  assert.ok(cookie.length>0);
  const body=JSON.stringify(await response.json());assert.equal(body.includes(cookie),false);
  const result=await navigation.middleware(request('localhost:3101',cookie));
  assert.equal(result.headers.get('x-middleware-next'),'1');
  assert.equal(result.headers.has('location'),false);
  const principal=await auth.requireVerifiedGovernancePrincipal();
  assert.equal(principal.userId,'local-user');assert.equal(principal.organisationId,'local-org');
});
test('missing cookie and signing-key mismatch still reject navigation and API authentication',async()=>{
  const saved=cookie;cookie=undefined;
  const missing=await navigation.middleware(request());
  assert.equal(missing.headers.get('location'),'http://localhost:3101/login');
  await assert.rejects(auth.requireVerifiedGovernancePrincipal(),auth.SessionAuthenticationError);
  cookie=saved;process.env.JWT_SECRET=randomBytes(32).toString('hex');
  const invalid=await navigation.middleware(request('localhost:3101',cookie));
  assert.equal(invalid.headers.get('location'),'http://localhost:3101/login');
  await assert.rejects(auth.requireVerifiedGovernancePrincipal(),auth.SessionAuthenticationError);
  process.env.JWT_SECRET=secret;
});
test('E1 diagnostics distinguish failures without serialising any credential or key',()=>{
  const output=JSON.stringify(messages);
  for(const stage of ['cookie-issued','middleware-jwt-verified','node-jwt-verified','cookie-missing','middleware-jwt-invalid'])assert.ok(output.includes(stage));
  assert.equal(output.includes(secret),false);assert.equal(output.includes(cookie!),false);assert.equal(output.includes('Local fixture only'),false);
});
