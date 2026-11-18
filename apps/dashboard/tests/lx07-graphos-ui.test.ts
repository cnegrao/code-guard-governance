import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { projectAgentOversight } from '../lib/agent-detail-dto';

test('actual GraphOS fetch, selection and detail render separate history from effective UNKNOWN with neutral presentation', async t => {
  Object.assign(globalThis, { React });
  const state: unknown[] = []; let cursor = 0; let started = false;
  let pending: Array<() => void> = []; let flowProps: any;
  function useState(initial: unknown) {
    const index = cursor++; if (!(index in state)) state[index] = initial;
    return [state[index], (value: any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  }
  mock.module('react', { namedExports: { ...React, useState,
    useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(),
    useEffect: (setup: () => void) => { if (!started) pending.push(setup); },
  } });
  const passthrough = ({ children }: any) => React.createElement('div', null, children);
  // TSX's CommonJS package loader bypasses Node's ESM module-mock hook.
  // Replace methods on the actual mutable package export instead.
  const flowModule = createRequire(import.meta.url)('@xyflow/react');
  const flowMocks = {
    ReactFlowProvider: passthrough,
    ReactFlow: (props: any) => { flowProps = props; return passthrough(props); },
    Background: () => null, Controls: () => null, MiniMap: () => null, Panel: passthrough,
    useNodesState: () => [...useState([]), () => {}], useEdgesState: () => [...useState([]), () => {}],
    useReactFlow: () => ({ fitView() {} }),
  };
  const originalExports = Object.fromEntries(Object.keys(flowMocks).map(key => [key, flowModule[key]]));
  Object.assign(flowModule, flowMocks);
  t.after(() => Object.assign(flowModule, originalExports));
  mock.module('@xyflow/react/dist/style.css', { defaultExport: {} });
  const Graph = (await import('../components/graph/ReactFlowGraph')).default;
  for (const level of ['l1_automated', 'l2_human_review', 'l3_human_approval', 'l4_human_in_loop', 'l4_human_in_charge', null, '', 'UNKNOWN', 'unrecognized']) {
    state.length = 0; cursor = 0; started = false; pending = [];
    const agent = { agent_id: 'agent-a', agent_code: 'AG-A', name: 'Agent A', agent_type: 'autonomous', risk_level: 'high',
      oversight_level: 'UNKNOWN', status: 'active', model_name: 'fixture-model',
      oversight: { ...projectAgentOversight({ oversight_level: level, organisation_id: 'org-a', agent_id: 'agent-a' }),
        // Even a stale/injected positive envelope cannot change the effective UI.
        effectiveLevel: 'l4_human_in_charge', evidenceStatus: 'VERIFIED', authority: 'AUTHORITATIVE' },
      legacy_control_states: { cg_ag_007_oversight: 'passed' }, legacy_control_authority: 'LEGACY_NON_AUTHORITATIVE' };
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0]) => {
      assert.equal(url, '/api/graph/estate');
      return Response.json({ nodes: [agent], edges: [{ id: 'rel', source: 'agent-a', target: 'agent-a', type: 'SUPERVISES' }], agentCount: 1 });
    });
    const render = () => { cursor = 0; return renderToStaticMarkup(React.createElement(Graph)); };
    render(); started = true; pending.forEach(setup => setup());
    await new Promise(resolve => setImmediate(resolve)); render();
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(flowProps.edges[0].label, 'recorded supervision relation (unverified)');
    await flowProps.onNodeClick({}, { id: 'agent-a' });
    const html = render();
    assert.match(html, /Effective oversight<\/span><span[^>]*>UNKNOWN \/ NOT_EVIDENCED<\/span>/);
    assert.match(html, /Historical oversight label \(unverified\)/);
    assert.match(html, /NON_AUTHORITATIVE.*Historical labels and manual flags do not prove effective supervision/);
    assert.match(html, /Applicability and sufficiency are unknown/);
    assert.doesNotMatch(html, />VERIFIED<|>AUTHORITATIVE</);
    assert.match(html, /gov_repo.agents.*oversight_level.*organisation org-a.*agent agent-a/);
    assert.match(html, /Agent A/); assert.match(html, /fixture-model/);
    const start = html.indexOf('Effective oversight'); const end = html.indexOf('Status</span>', start);
    assert.doesNotMatch(html.slice(start, end), /text-success|bg-success|text-green|bg-green/);
    if (level) assert.ok(html.includes(level));
    if (level === null) assert.match(html, /No recorded label returned/);
    if (level === '') assert.match(html, /\(empty\)/);
    fetchMock.mock.restore();
  }
});
