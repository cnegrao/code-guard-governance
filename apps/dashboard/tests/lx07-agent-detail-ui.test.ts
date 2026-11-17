import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { projectAgentDetail } from '../lib/agent-detail-dto';
import type { Agent } from '../types/agents';

test('actual detail page renders fetched historical labels separately, never as effective supervision', async t => {
  Object.assign(globalThis, { React });
  const state: unknown[] = []; let cursor = 0; let started = false;
  let pending: Array<() => void> = [];
  t.mock.module('react', { namedExports: { ...React,
    useState(initial: unknown) { const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], (value: unknown) => { state[index] = value; }]; },
    useEffect(setup: () => void) { if (!started) pending.push(setup); },
  } });
  mock.module('next/navigation', { namedExports: { useParams: () => ({ id: 'agent-fixture' }) } });
  const Page = (await import('../app/(dashboard)/agents/[id]/page')).default;
  for (const level of ['l1_automated', 'l2_human_review', 'l3_human_approval', 'l4_human_in_loop', 'l4_human_in_charge', null, '', 'UNKNOWN', 'unrecognized']) {
    state.length = 0; cursor = 0; started = false; pending = [];
    const agent = projectAgentDetail({ agent_id: 'agent-fixture', organisation_id: 'org-fixture', name: 'Agent fixture',
      agent_code: 'AG-1', version: 'v1', status: 'active', oversight_level: level } as Agent);
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0]) => {
      assert.equal(url, '/api/agents/agent-fixture');
      return Response.json({ agent, owner_name: 'Owner fixture', legacy_control_states: { cg_ag_007_oversight: 'passed' }, legacy_control_gaps: [] });
    });
    const render = () => { cursor = 0; return renderToStaticMarkup(React.createElement(Page)); };
    render(); started = true; pending.forEach(setup => setup());
    await new Promise(resolve => setImmediate(resolve));
    const html = render();
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.match(html, /Effective oversight<\/dt><dd[^>]*>UNKNOWN \/ NOT_EVIDENCED<\/dd>/);
    assert.match(html, /Historical oversight label \(unverified\)/);
    assert.match(html, /NON_AUTHORITATIVE.*Historical labels and recorded control states do not prove supervision/);
    assert.match(html, /Applicability and sufficiency are unknown/);
    assert.match(html, /Owner fixture/); assert.match(html, /Agent fixture/); assert.match(html, /AG-1/);
    assert.doesNotMatch(html, />Oversight Level</);
    const oversightMarkup = html.slice(html.indexOf('<dt class="text-gray-500">Effective oversight'), html.indexOf('<dt class="text-gray-500">Model'));
    assert.doesNotMatch(oversightMarkup, /text-success|bg-success/);
    if (level) assert.match(html, new RegExp(`Historical oversight label \\(unverified\\)<\\/dt><dd[^>]*>${level}<\\/dd>`));
    if (level === null) assert.match(html, /No recorded label returned/);
    fetchMock.mock.restore();
  }
});
