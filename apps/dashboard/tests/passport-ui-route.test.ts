import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { createElement, type ReactNode } from 'react';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { PASSPORT_FAMILIES, type AgentPassport360, type DataFieldFact, type PassportFamily } from '@/lib/governance/agent-passport';

const org='11111111-1111-1111-1111-111111111111';
const secret='passport-fixture-signing-key-only-for-local-tests';
let cookie: string | undefined, received: unknown[], available: boolean;
const provenance = { storage:'canonical_objects', authority:'GOVERNED_IDENTITY', sources:[], evidence:[], decisionId:'decision:agent', decidedAt:'2026-09-14T12:00:00Z' } as const;
const identity = { type:'identity', id:'canonical:agent', objectId:'canonical:agent', objectKind:'AGENT', organisationId:org, provenance } as const;
const passport: AgentPassport360 = { canonicalAgent:identity, displayName:null, currentVersionId:null, selectedVersionId:null,
  versionContexts:[{objectId:'version:1',versionCode:null,associationMappingIds:['mapping:1']},{objectId:'version:2',versionCode:null,associationMappingIds:['mapping:2']}],
  families:PASSPORT_FAMILIES.map(([id,label])=>({id,label,status:id==='identity'?'KNOWN':'UNKNOWN',facts:id==='identity'?[identity]:[],unknowns:id==='identity'?[]:['UNKNOWN']})) as PassportFamily[],
  provenanceSummary:[provenance] };
let Page: typeof import('@/app/(dashboard)/agents/canonical/[canonicalObjectId]/page').default;
let Component: typeof import('@/components/agents/AgentPassport').AgentPassport;
let session: typeof import('@/lib/governance/passport-session');
let ListPage: typeof import('@/app/(dashboard)/agents/canonical/page').default;
let listCalls: unknown[][];

before(async()=>{
  // tsx uses the classic JSX transform for this Next.js jsx:preserve project.
  // Next itself supplies the automatic runtime; this local SSR harness supplies React.
  Object.assign(globalThis, { React });
  process.env.JWT_SECRET=secret;
  mock.module('server-only',{namedExports:{}});
  mock.module('next/headers',{namedExports:{cookies:async()=>({get:()=>cookie?{value:cookie}:undefined}),headers:async()=>new Headers({'x-codeguard-org':'attacker-tenant'})}});
  mock.module('next/navigation',{namedExports:{notFound:()=>{throw new Error('NOT_FOUND');}}});
  mock.module('next/link',{defaultExport:({children,...props}:{children:ReactNode;href:string})=>createElement('a',props,children)});
  mock.module('@/lib/governance/passport-query',{namedExports:{getAgentPassport:async(...args:unknown[])=>{received=args;return available?{...passport,selectedVersionId:args[2]??null}:undefined;}}});
  mock.module('@/lib/governance/passport-read-store',{namedExports:{passportReader:(tenant:string)=>async(table:string,filter:unknown)=>{
    listCalls.push([tenant,table,filter]); return [{canonical_object_id:'canonical:agent',kind:'AGENT',organisation_id:org}];
  }}});
  session=await import('@/lib/governance/passport-session');
  Page=(await import('@/app/(dashboard)/agents/canonical/[canonicalObjectId]/page')).default;
  Component=(await import('@/components/agents/AgentPassport')).AgentPassport;
  ListPage=(await import('@/app/(dashboard)/agents/canonical/page')).default;
});
beforeEach(async()=>{
  process.env.JWT_SECRET=secret; received=[]; available=true; listCalls=[];
  cookie=await new SignJWT({sub:'user:1',org,email:'test@example.invalid',role:'VIEWER'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(secret));
});

test('real Passport component renders exactly 16 accessible and navigable sections including UNKNOWN',()=>{
  const html=renderToStaticMarkup(createElement(Component,{passport}));
  assert.equal((html.match(/<section /g)??[]).length,16);
  for(const [id,label] of PASSPORT_FAMILIES){assert.ok(html.includes(`id="passport-${id}"`));assert.ok(html.includes(`href="#passport-${id}"`));}
  assert.ok(html.includes('UNKNOWN')); assert.ok(html.includes('canonical:agent'));assert.ok(html.includes('Current AgentVersion: UNKNOWN'));
  assert.ok(html.includes('Selected AgentVersion: UNKNOWN')); assert.ok(html.includes('version%3A1'));assert.ok(html.includes('version%3A2'));
  assert.ok(html.includes('<details'));assert.ok(html.includes('Source, trust and provenance')); assert.ok(!html.includes('17. Risk'));
});
test('page uses cryptographically verified cookie tenant, ignoring client organisation and spoofed headers',async()=>{
  const search = {version:'version:1',organisationId:'attacker-tenant',org:'attacker-tenant'};
  await Page({params:Promise.resolve({canonicalObjectId:'canonical:agent'}),searchParams:Promise.resolve(search)});
  assert.deepEqual(received,[org,'canonical:agent','version:1']);
});
test('unknown root returned by canonical query is 404',async()=>{
  available=false; await assert.rejects(Page({params:Promise.resolve({canonicalObjectId:'unknown'}),searchParams:Promise.resolve({})}),/NOT_FOUND/);
});
test('repeated version query parameters fail closed',async()=>{
  await assert.rejects(Page({params:Promise.resolve({canonicalObjectId:'canonical:agent'}),searchParams:Promise.resolve({version:['one','two']})}),/NOT_FOUND/);
  assert.deepEqual(received,[]);
});
test('missing authentication cannot enter Passport even with spoofed organisation header',async()=>{
  cookie=undefined; await assert.rejects(session.passportOrganisation(),/NOT_FOUND/);
});
test('a cookie signed by an attacker cannot select a tenant',async()=>{
  cookie=await new SignJWT({sub:'attacker',org:'foreign'}).setProtectedHeader({alg:'HS256'}).sign(new TextEncoder().encode('attacker-key'));
  await assert.rejects(session.passportOrganisation(),/NOT_FOUND/);
});
test('missing configured JWT secret fails closed instead of using development fallback',async()=>{
  delete process.env.JWT_SECRET; await assert.rejects(session.passportOrganisation(),/NOT_FOUND/);
});
test('trusted session without organisation fails closed',async()=>{
  cookie=await new SignJWT({sub:'user'}).setProtectedHeader({alg:'HS256'}).sign(new TextEncoder().encode(secret));
  await assert.rejects(session.passportOrganisation(),/NOT_FOUND/);
});
test('legacy route retains operational API and the inventory links separately to canonical browsing',()=>{
  const legacy=readFileSync('app/(dashboard)/agents/[id]/page.tsx','utf8');
  assert.ok(legacy.includes('fetch(`/api/agents/${params.id}`)'));assert.ok(!legacy.includes('passport-query'));
  const table=readFileSync('components/agents/AgentTable.tsx','utf8');assert.ok(table.includes('href={`/agents/${agent.agent_id}`}'));
  const inventory=readFileSync('app/(dashboard)/agents/page.tsx','utf8');assert.ok(inventory.includes('href="/agents/canonical"'));
});
test('new presentation and query dependency boundary contains no write RPC, Graph, Vector or LLM integration',()=>{
  for(const file of ['lib/governance/passport-query.ts','lib/governance/passport-read-store.ts','lib/governance/passport-field-query.ts']) {
    const source=readFileSync(file,'utf8'); assert.ok(!/\.(rpc|insert|update|upsert|delete)\s*\(/.test(source),file);
    assert.ok(!/from ['"][^'"]*(?:graphos|embedding|openai|workspace-commands|decision-commands|multivendor-exchange)/.test(source),file);
  }
});

test('canonical list requests only session-local AGENT objects and links to canonical detail',async()=>{
  const html=renderToStaticMarkup(await ListPage());
  assert.deepEqual(listCalls,[[org,'canonical_objects',{kind:'AGENT'}]]);
  assert.ok(html.includes('href="/agents/canonical/canonical%3Aagent"'));
});

test('detail renders the selected version alongside the stable Agent',async()=>{
  const html=renderToStaticMarkup(await Page({params:Promise.resolve({canonicalObjectId:'canonical:agent'}),searchParams:Promise.resolve({version:'version:2'})}));
  assert.ok(html.includes('Canonical AGENT: canonical:agent'));
  assert.ok(html.includes('Selected AgentVersion: version:2'));
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(html.includes('Current AgentVersion: UNKNOWN'));
});

test('imported value, evidence, trust and historical policy remain distinguishable in mixed families',()=>{
  const field:DataFieldFact={type:'data-field',id:'field',objectId:'column',versionId:'version:1',accessRelationshipId:'access',stateId:'state',
    fact:{objectKind:'DATA_ELEMENT',field:'dataType.nativeType',value:'varchar(100)'},
    source:{systemId:'purview',connectionId:'connection',externalId:'guid',externalType:'azure_sql_column',trust:'IMPORTED'},competingProposalIds:['pending'],
    provenance:{storage:'technical_field_states',authority:'GOVERNED_FIELD_STATE',decisionId:'accepted-decision',decidedAt:'2026-09-14T10:00:00Z',
      sources:[{assertionId:'assertion',connectionId:'connection',externalType:'azure_sql_column',externalId:'guid',trust:'IMPORTED',method:'purview-fixture',
        observedAt:'2026-09-14T09:00:00Z',recordedAt:'2026-09-14T09:01:00Z',runId:'run'}],
      evidence:[{evidenceId:'evidence',handling:'HASH_ONLY',capturedAt:'2026-09-14T09:00:00Z'}],
      policy:{policyId:'policy',acceptedVersion:'v1',activeVersion:'v2'},snapshotId:'accepted-snapshot'}};
  const view:AgentPassport360={...passport,selectedVersionId:'version:1',families:passport.families.map(f=>f.id==='data'?{...f,status:'PARTIAL',facts:[field]}:f)};
  const html=renderToStaticMarkup(createElement(Component,{passport:view}));
  for(const text of ['varchar(100)','IMPORTED','evidence','HASH_ONLY','accepted-decision','accepted version v1','active version v2',
    'Historical acceptance policy','accepted-snapshot','2026-09-14T09:00:00Z','UNKNOWN']) assert.ok(html.includes(text),text);
  assert.ok(!html.includes('VALIDATED')); assert.ok(!html.includes('FALSE')); assert.equal((html.match(/<section /g)??[]).length,16);
});

test('configured development fallback and expired sessions fail closed',async()=>{
  process.env.JWT_SECRET='fallback-dev-secret-change-in-production';
  await assert.rejects(session.passportOrganisation(),/NOT_FOUND/);
  process.env.JWT_SECRET=secret;
  cookie=await new SignJWT({sub:'user',org}).setProtectedHeader({alg:'HS256'}).setExpirationTime(1).sign(new TextEncoder().encode(secret));
  await assert.rejects(session.passportOrganisation(),/NOT_FOUND/);
});
