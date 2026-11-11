import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { buildExecutiveModel, type ExecutiveInput, type ExecutiveModel } from '../lib/workspace/executive-model';
import { agentId, assessedControl, closedOnlyRisks, emptyModel, mixedReads, noGovernedFacts, org, overlay, populatedInput, populatedModel, portfolioFacts,
  portfolioInput, portfolioOverlay, risk, scopedInput, unavailableRead, withheldRead } from './helpers/m18-executive-fixtures';

let Page: typeof import('../app/(dashboard)/workspace/page').default;
let View: typeof import('../components/workspace/ExecutiveWorkspace').ExecutiveWorkspace;
let authenticated=true, denied=false, failed=false, admissions=0;
let received: unknown[]=[];
const principal={organisationId:org,actorUserId:'user:1',issuedAtSeconds:1,expiresAtSeconds:2,credentialEpoch:'epoch'};
class ExecutiveAuthorizationError extends Error {}
before(async()=>{
 Object.assign(globalThis,{React});
 mock.module('../lib/governance/passport-session',{namedExports:{passportPrincipal:async()=>{admissions++;if(!authenticated)throw Error('NOT_FOUND');return principal;}}});
 mock.module('next/navigation',{namedExports:{notFound:()=>{throw Error('NOT_FOUND');}}});
 mock.module('../lib/workspace/executive-query',{namedExports:{ExecutiveAuthorizationError,getExecutiveWorkspace:async(...args:unknown[])=>{received=args;if(denied)throw new ExecutiveAuthorizationError();if(failed)throw Error('EXECUTIVE_ACQUISITION_FAILED');return populatedModel();}}});
 View=(await import('../components/workspace/ExecutiveWorkspace')).ExecutiveWorkspace;
 Page=(await import('../app/(dashboard)/workspace/page')).default;
});
beforeEach(()=>{authenticated=true;denied=false;failed=false;admissions=0;received=[];});
test('SEC-01 route verifies signed principal, accepts page only and renders only a committed model',async()=>{
 const node=await Page({searchParams:Promise.resolve({page:'2',organisationId:'attacker'} as {page:string})});
 assert.deepEqual(received,[principal,'2']);assert.equal(admissions,1);assert.match(renderToStaticMarkup(node),/Executive \/ Board/);
 authenticated=false;received=[];await assert.rejects(Page({searchParams:Promise.resolve({})}),/NOT_FOUND/);assert.deepEqual(received,[]);
});
test('SEC-01 authorization refusal is sanitized and transaction failure renders no model',async()=>{
 denied=true;await assert.rejects(Page({searchParams:Promise.resolve({})}),/NOT_FOUND/);
 denied=false;failed=true;await assert.rejects(Page({searchParams:Promise.resolve({})}),/EXECUTIVE_ACQUISITION_FAILED/);
});
test('populated Executive shows real state/lineage drilldowns, exact unknowns and no compliance arithmetic', () => {
  const html = renderToStaticMarkup(React.createElement(View, { model: populatedModel() }));
  for (const label of ['Organisation', org, 'Portfolio overview', 'Executive attention', 'Priority risks', 'Governance &amp; controls', 'Trust &amp; Assurance', 'decision:risk', 'app:1', 'assessment:1', 'NOT EVIDENCED', 'INSUFFICIENT_EVIDENCE']) assert.ok(html.includes(label), label);
  assert.match(html, /href="\/agents\/canonical\/agent%3Aexecutive#passport-controls"/);
  assert.match(html, /href="\/agents\/canonical\/agent%3Aexecutive#passport-provenance"/);
  assert.match(html, /1 observed assessments NOT EVIDENCED/); assert.match(html, /0 observed applicable assignments with UNKNOWN assessment/);
  assert.doesNotMatch(html, /\d+%|AI_SYSTEM|COMPLIANT|CERTIFIED|score|Talk-to-Governance/);
});
test('empty and unavailable views distinguish known zero identities from UNKNOWN acquisition', () => {
  const empty = renderToStaticMarkup(React.createElement(View, { model: emptyModel() }));
  assert.match(empty, /No canonical Agents were returned/); assert.match(empty, /empty estate does not establish compliance/);
  assert.match(empty, /Attention not evaluated: no canonical Agents were returned/);
  const unavailable = buildExecutiveModel({ organisationId: org, objects: { status: 'UNKNOWN', failure: 'UNAVAILABLE' }, subjects: [], page: 1, pageSize: 12 });
  const failed = renderToStaticMarkup(React.createElement(View, { model: unavailable }));
  assert.match(failed, /role="status"/); assert.match(failed, /Identity population: UNKNOWN/);
  assert.match(failed, /UNKNOWN Agents with UNKNOWN risk coverage/); assert.doesNotMatch(failed, /No canonical Agents were returned/);
  assert.match(failed, /Attention not evaluated: the canonical Agent population is UNKNOWN/); assert.doesNotMatch(failed, /No attention items observed/);
});

const render = (model: ExecutiveModel) => renderToStaticMarkup(React.createElement(View, { model }));
const count = (html: string, pattern: RegExp) => (html.match(new RegExp(pattern, 'g')) ?? []).length;

test('F1: page 1 cannot read as an organisation-wide all-clear; page 2 exposes Agent 13 facts', () => {
  const one = render(buildExecutiveModel(portfolioInput(1)));
  assert.match(one, /No attention items observed among the 12 Agents on this page\. Other pages have not been evaluated in this view\./);
  assert.match(one, /This is not an organisation-wide all-clear/);
  assert.equal(count(one, /Page scope · page 1 of 2 · Agents 1–12 of 24, in canonical ID order/), 3, 'attention, priority risks and controls each name their scope');
  assert.equal(count(one, /Agents on other pages \(12\) have not been evaluated in this view/), 3);
  assert.match(one, /Evaluated here: risk states for 12 of 12 Agents · control states for 12 of 12 Agents/);
  for (const anchor of ['portfolio', 'attention', 'risks', 'controls']) assert.match(one, new RegExp(`href="/workspace\\?page=2#${anchor}"`));
  assert.doesNotMatch(one, /agent:13|CRITICAL|NOT_SATISFIED/);
  const two = render(buildExecutiveModel(portfolioInput(2)));
  assert.equal(count(two, /Page scope · page 2 of 2 · Agents 13–24 of 24/), 3);
  assert.match(two, /AGENT agent:13 · control:oversight · NOT_SATISFIED/);
  assert.match(two, /Ordered by: inherent CRITICAL \(recorded; no current residual band\)/);
  assert.ok(two.indexOf('risk:agent:13') < two.indexOf('risk:agent:14'), 'CRITICAL first');
  assert.match(two, /href="\/workspace\?page=1#risks"/); assert.doesNotMatch(two, /No attention items observed/);
});

test('F2: assessment and evidence gaps render distinctly from recorded states; empty differs from unavailable', () => {
  const input = populatedInput();
  input.subjects[0].facts = { status: 'AVAILABLE', value: [assessedControl(agentId, 'SATISFIED', true, 'control:a')[0], ...assessedControl(agentId, 'SATISFIED', false, 'control:b')] };
  input.subjects[0].risks = { status: 'AVAILABLE', value: overlay([{ ...risk, inherentBand: 'CRITICAL', supportCurrency: 'SUPPORT_NONE' }]) };
  const gaps = render(buildExecutiveModel(input));
  assert.match(gaps, /Gaps in recorded assessment or evidence · 3/); assert.doesNotMatch(gaps, /Recorded states to review/);
  assert.equal(count(gaps, /ASSESSMENT GAP/), 1); assert.equal(count(gaps, /EVIDENCE GAP/), 2);
  assert.match(gaps, /control:a · APPLIES · assessment UNKNOWN/); assert.match(gaps, /control:b · SATISFIED · evidence NOT EVIDENCED/);
  assert.match(gaps, /risk:1 · SUPPORT_NONE · recorded rating unchanged/);
  input.subjects[0].facts = { status: 'AVAILABLE', value: [] }; input.subjects[0].risks = { status: 'AVAILABLE', value: overlay([]) };
  const empty = render(buildExecutiveModel(input));
  input.subjects[0].facts = { status: 'UNKNOWN', failure: 'UNAVAILABLE' }; input.subjects[0].risks = { status: 'UNKNOWN', failure: 'UNAVAILABLE' };
  const failed = render(buildExecutiveModel(input));
  // R-04: a successful but empty governed result is insufficient information, not a clean attention result.
  assert.match(empty, /Insufficient governed information: attention is UNKNOWN for the 1 Agents on this page/); assert.doesNotMatch(empty, /No attention items observed|role="status"/);
  assert.match(failed, /attention for the affected Agents is UNKNOWN/); assert.match(failed, /role="status"/);
  assert.match(failed, /risk states for 0 of 1 Agents · control states for 0 of 1 Agents/);
});

test('F3/F4: priority risks expose their recorded ordering basis and acceptance; CLOSED states are not current', () => {
  const input = populatedInput(); input.subjects[0].facts = { status: 'AVAILABLE', value: [] };
  input.subjects[0].risks = { status: 'AVAILABLE', value: overlay([
    { ...risk, governedRiskStateId: 'risk:accepted', inherentBand: 'HIGH', residualBand: 'LOW', lifecycle: 'RESIDUAL_ACCEPTED', acceptanceStatus: 'ACCEPTED', supportCurrency: 'SUPPORT_CURRENT' },
    { ...risk, governedRiskStateId: 'risk:moderate', inherentBand: 'MODERATE', residualBand: 'MODERATE', lifecycle: 'RESIDUAL_ASSESSED', supportCurrency: 'SUPPORT_CURRENT' },
    { ...risk, governedRiskStateId: 'risk:closed', inherentBand: 'CRITICAL', lifecycle: 'CLOSED' },
  ]) };
  const html = render(buildExecutiveModel(input));
  assert.ok(html.indexOf('risk:moderate') < html.indexOf('risk:accepted'));
  assert.match(html, /Ordered by: current residual MODERATE \(recorded\) · Residual assessed · no current acceptance recorded/);
  assert.match(html, /Ordered by: current residual LOW \(recorded\) · Residual accepted \(recorded acceptance; the risk remains open\)/);
  assert.match(html, /2 open governed risk states observed on this page · 1 CLOSED, not counted as current/);
  assert.equal(count(html, /<article/), 2); assert.doesNotMatch(html, /risk:closed/);
});

test('F7: integrity failures render a distinct fail-closed alert without sensitive detail', () => {
  const tenant = render(buildExecutiveModel({ organisationId: org, objects: { status: 'UNKNOWN', failure: 'TENANT_INTEGRITY' }, subjects: [], page: 1, pageSize: 12 }));
  assert.match(tenant, /role="alert"/); assert.match(tenant, /Reads outside the verified organisation scope: 1 · reads violating the governed data contract: 0/);
  assert.doesNotMatch(tenant, /role="status"|Retry reads/);
  const input = populatedInput();
  input.subjects[0].risks = { status: 'UNKNOWN', failure: 'CONTRACT_VIOLATION' };
  const contract = render(buildExecutiveModel(input));
  assert.match(contract, /reads violating the governed data contract: 1/); assert.doesNotMatch(contract, /role="status"/);
  input.subjects[0].risks = { status: 'UNKNOWN', failure: 'UNAVAILABLE' };
  const reset = render(buildExecutiveModel(input));
  assert.match(reset, /role="status"/); assert.doesNotMatch(reset, /role="alert"|Integrity check failed/);
  for (const html of [tenant, contract, reset]) assert.doesNotMatch(html, /PASSPORT_|ECONNRESET|22222222-2222/);
});

test('F8: duplicated identities and subjects render one row per canonical object', () => {
  const input = populatedInput();
  const html = render(buildExecutiveModel({ ...input, subjects: [input.subjects[0], input.subjects[0]],
    objects: { status: 'AVAILABLE', value: [...(input.objects.status === 'AVAILABLE' ? input.objects.value : []), { canonical_object_id: agentId, kind: 'AGENT' }] } }));
  assert.equal(count(html, /<article/), 1); assert.equal(count(html, /Inspect control &amp; provenance/), 1);
  assert.equal(count(html, /Inspect basis/), 2); assert.match(html, /1 open governed risk states observed/);
  assert.match(html, /<dd class="mt-2 font-semibold tracking-tight text-3xl text-white">3<\/dd>/);
});

const section = (html: string, id: string) => { const start = html.indexOf(`<section id="${id}"`); return html.slice(start, html.indexOf('</section>', start)); };
const sectionOf = (input: ExecutiveInput, id: string) => section(render(buildExecutiveModel(input)), id);
const withFacts = (id: string) => ({ status: 'AVAILABLE', value: portfolioFacts(id) }) as const;
const withOverlay = (id: string) => ({ status: 'AVAILABLE', value: portfolioOverlay(id) }) as const;
const identityFailure = (failure: 'UNAVAILABLE' | 'TENANT_INTEGRITY'): ExecutiveInput => ({ organisationId: org, objects: { status: 'UNKNOWN', failure }, subjects: [], page: 1, pageSize: 12 });
const NO_PASS = /\bPASS(ED)?\b|COMPLIANT|CERTIFIED/;

test('R-01: Governance & controls names its exact page scope, read coverage and navigation', () => {
  const one = sectionOf(portfolioInput(1), 'controls');
  assert.match(one, /Page scope · page 1 of 2 · Agents 1–12 of 24, in canonical ID order/);
  assert.match(one, /Control states evaluated for 12 of 12 Agents on this page\./);
  assert.match(one, /Control applicability returned for 12 Agents · none returned for 0 · control reads unavailable 0 · withheld after an integrity failure 0\./);
  assert.match(one, /Agents on other pages \(12\) have not been evaluated in this view/); assert.match(one, /not an organisation-wide control posture/);
  assert.match(one, /<nav aria-label="Agent scope pages · governance &amp; controls"/); assert.match(one, /href="\/workspace\?page=2#controls"/);
  assert.doesNotMatch(one, /agent:13|NOT_SATISFIED|page=0/);
  const two = sectionOf(portfolioInput(2), 'controls');
  assert.match(two, /Page scope · page 2 of 2 · Agents 13–24 of 24/); assert.match(two, /href="\/workspace\?page=1#controls"/);
  assert.match(two, /NOT_SATISFIED/); assert.doesNotMatch(two, /page=3/);
  // Partial and withheld control reads stay inside the named scope as counts; they are never dropped.
  const partial = sectionOf(scopedInput(1, (id, i) => ({ facts: i % 3 === 0 ? unavailableRead : i % 3 === 1 ? withheldRead : withFacts(id), risks: withOverlay(id) })), 'controls');
  assert.match(partial, /Control states evaluated for 4 of 12 Agents on this page\./);
  assert.match(partial, /Control applicability returned for 4 Agents · none returned for 0 · control reads unavailable 4 · withheld after an integrity failure 4\./);
  assert.equal(count(partial, /Inspect control &amp; provenance/), 4);
  const zero = sectionOf(scopedInput(1, id => ({ facts: unavailableRead, risks: withOverlay(id) })), 'controls');
  assert.match(zero, /No control read succeeded for the 12 Agents on this page \(unavailable 12 · withheld after an integrity failure 0\)/);
  assert.doesNotMatch(zero, /No current governed control applicability was returned/);
  assert.match(sectionOf(scopedInput(1, noGovernedFacts), 'controls'), /No current governed control applicability was returned for the 12 Agents on this page\. Other pages have not been evaluated/);
  const single = section(render(populatedModel()), 'controls');
  assert.match(single, /Page scope · page 1 of 1 · Agents 1–1 of 1/); assert.doesNotMatch(single, /<nav/);
});

test('R-02: Priority risks separates returned absence, partial reads, zero successful reads and unavailable populations', () => {
  const absent = sectionOf(scopedInput(1, id => ({ facts: withFacts(id), risks: { status: 'AVAILABLE', value: overlay([]) } })), 'risks');
  assert.match(absent, /No open governed risk states were returned for the 12 Agents on this page\. Other pages have not been evaluated in this view\. Returned absence does not show that no risks exist/);
  const partial = sectionOf(scopedInput(1, (id, i) => ({ facts: withFacts(id), risks: i % 2 ? unavailableRead : { status: 'AVAILABLE', value: overlay([]) } })), 'risks');
  assert.match(partial, /Risk states evaluated for 6 of 12 Agents on this page\./);
  assert.match(partial, /No open governed risk states were returned for the 6 of 12 Agents whose risk reads succeeded\. Risk reads for 6 Agents are unavailable or withheld; their open risk states are UNKNOWN\./);
  const zero = sectionOf(scopedInput(1, (id, i) => ({ facts: withFacts(id), risks: i <= 8 ? unavailableRead : withheldRead })), 'risks');
  assert.match(zero, /Open risk states: UNKNOWN\. No risk read succeeded for the 12 Agents on this page \(unavailable 8 · withheld after an integrity failure 4\)\. An empty list here does not show that no risks exist\./);
  const unavailable = sectionOf(identityFailure('UNAVAILABLE'), 'risks');
  assert.match(unavailable, /Page scope: UNKNOWN · canonical Agent population unavailable/);
  assert.match(unavailable, /Priority risks not evaluated: the canonical Agent population is UNKNOWN\. Open risk states: UNKNOWN\./);
  const empty = section(render(emptyModel()), 'risks');
  assert.match(empty, /Priority risks not evaluated: no canonical Agents were returned\. Open risk states: UNKNOWN\./);
  for (const html of [zero, unavailable, empty]) assert.doesNotMatch(html, /No open governed risk states|for the 0 Agents/);
  // Listed open risks keep the UNKNOWN remainder visible.
  const listed = sectionOf(scopedInput(2, mixedReads), 'risks');
  assert.equal(count(listed, /<article/), 1); assert.match(listed, /Risk states evaluated for 1 of 12 Agents/);
  assert.match(listed, /risk reads unavailable 5 · withheld after an integrity failure 6\./);
});

test('R-03: CLOSED-only history is shown as historical, never as current risk coverage', () => {
  const html = render(buildExecutiveModel(scopedInput(1, mixedReads))), risks = section(html, 'risks');
  assert.match(risks, /Current open risk states observed for 4 Agents · only CLOSED \(historical\) states for 4 · no risk states returned for 4 · risk reads unavailable 0 · withheld after an integrity failure 0\. Current-risk coverage is UNKNOWN for every Agent without an open state\./);
  assert.equal(count(risks, /<article/), 4); assert.doesNotMatch(risks, /risk:closed:|CRITICAL/);
  assert.match(section(html, 'portfolio'), /8 Agents with UNKNOWN risk coverage \(4 with only CLOSED historical risk states\) · 0 with UNKNOWN control coverage/);
  assert.match(html, /4 open governed risk states observed on this page · 4 CLOSED, not counted as current/);
  const closed = render(buildExecutiveModel(scopedInput(1, id => ({ facts: withFacts(id), risks: { status: 'AVAILABLE', value: closedOnlyRisks(id) } }))));
  assert.match(section(closed, 'risks'), /No open governed risk states were returned for the 12 Agents on this page\. 12 of them have only CLOSED \(historical\) states, which are not current\./);
  assert.match(closed, /12 Agents with UNKNOWN risk coverage \(12 with only CLOSED historical risk states\)/);
  assert.doesNotMatch(section(closed, 'attention'), /EVIDENCE GAP|SUPPORT_NONE|risk:closed:/);
});

test('R-04: Executive attention states insufficient or partial information instead of a clean result', () => {
  const ungoverned = sectionOf(scopedInput(1, noGovernedFacts), 'attention');
  assert.match(ungoverned, /Governed information: current open risk states for 0 of 12 Agents · control applicability for 0 of 12 Agents\./);
  assert.match(ungoverned, /Insufficient governed information: attention is UNKNOWN for the 12 Agents on this page\. No current open risk state and no control applicability was available for any of them \(risk reads succeeded for 12 of 12, control reads for 12 of 12\)\. An empty list here is not a clean result\./);
  const failed = sectionOf(scopedInput(1, () => ({ facts: unavailableRead, risks: withheldRead })), 'attention');
  assert.match(failed, /Insufficient governed information: .*\(risk reads succeeded for 0 of 12, control reads for 0 of 12\)\. An empty list here is not a clean result\. Some reads on this page are unavailable or withheld; attention for the affected Agents is UNKNOWN\./);
  const closed = sectionOf(scopedInput(1, id => ({ facts: { status: 'AVAILABLE', value: [] }, risks: { status: 'AVAILABLE', value: closedOnlyRisks(id) } })), 'attention');
  assert.match(closed, /Insufficient governed information/);
  const partial = sectionOf(scopedInput(1, mixedReads), 'attention');
  assert.match(partial, /No attention items observed within the evaluated scope: current open risk states for 4 of 12 Agents and control applicability for 12 of 12\. Attention remains UNKNOWN for 8 Agents without a current risk observation and 0 without control applicability\. Other pages have not been evaluated in this view\. This is not an organisation-wide all-clear/);
  assert.doesNotMatch(partial, /No attention items observed among/);
  assert.match(sectionOf(portfolioInput(1), 'attention'), /No attention items observed among the 12 Agents on this page\./);
  // Explicit gaps: applicable controls with UNKNOWN assessment and open risks with SUPPORT_NONE.
  const gaps = sectionOf(scopedInput(1, id => ({ facts: { status: 'AVAILABLE', value: [assessedControl(id, 'SATISFIED', true)[0]] },
    risks: { status: 'AVAILABLE', value: overlay([{ ...risk, governedRiskStateId: `risk:${id}`, subjectCanonicalObjectId: id, supportCurrency: 'SUPPORT_NONE' }]) } })), 'attention');
  assert.match(gaps, /Gaps in recorded assessment or evidence · 24/); assert.equal(count(gaps, /ASSESSMENT GAP/), 12); assert.equal(count(gaps, /EVIDENCE GAP/), 12);
  assert.doesNotMatch(gaps, /Recorded states to review|No attention items observed/);
  for (const html of [ungoverned, failed, closed]) assert.doesNotMatch(html, /No attention items observed/);
  for (const html of [ungoverned, failed, closed, partial, gaps]) assert.doesNotMatch(html, NO_PASS);
});

test('R-01..R-04 under foreign-tenant and integrity failures: every section withholds and none reads as clear', () => {
  const tenant = render(buildExecutiveModel(identityFailure('TENANT_INTEGRITY')));
  assert.match(tenant, /role="alert"/);
  assert.equal(count(tenant, /Page scope: UNKNOWN · canonical Agent population withheld after an integrity failure/), 3);
  assert.match(section(tenant, 'attention'), /Attention not evaluated: the canonical Agent population is UNKNOWN\./);
  assert.match(section(tenant, 'risks'), /Priority risks not evaluated: the canonical Agent population is UNKNOWN\./);
  assert.match(section(tenant, 'controls'), /Controls not evaluated: the canonical Agent population is UNKNOWN\./);
  // An UNKNOWN or empty population never renders an evaluated-count sentence that reads as a known zero.
  for (const html of [tenant, render(buildExecutiveModel(identityFailure('UNAVAILABLE'))), render(emptyModel())]) assert.doesNotMatch(html, /evaluated for 0 of 0|states for 0 of 0/);
  const contract = render(buildExecutiveModel(scopedInput(1, () => ({ facts: withheldRead, risks: withheldRead }))));
  assert.match(contract, /role="alert"/); assert.match(contract, /reads violating the governed data contract: 24/);
  assert.match(section(contract, 'risks'), /No risk read succeeded for the 12 Agents on this page \(unavailable 0 · withheld after an integrity failure 12\)/);
  assert.match(section(contract, 'controls'), /No control read succeeded for the 12 Agents on this page \(unavailable 0 · withheld after an integrity failure 12\)/);
  assert.match(section(contract, 'attention'), /Insufficient governed information/);
  for (const html of [tenant, contract]) {
    assert.doesNotMatch(html, /No attention items observed|No open governed risk states|No current governed control applicability/);
    assert.doesNotMatch(html, /PASSPORT_|22222222-2222/); assert.doesNotMatch(html, NO_PASS);
  }
});
