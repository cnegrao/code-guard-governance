import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import type { GovernedGraph } from '@council/graphos/governed';
import { CANONICAL_READABLE_ZOOM } from '../components/graph/canonical-layout';

const slots: any[] = [];
let cursor = 0;
let pending: (() => void)[] = [];
function memo(value: any, deps: unknown[]) {
  const index = cursor++;
  if (!slots[index] || deps.some((dep, i) => dep !== slots[index].deps[i])) slots[index] = { value, deps };
  return slots[index].value;
}
mock.module('react', { namedExports: { ...React,
  useState(initial: any) {
    const index = cursor++; if (!(index in slots)) slots[index] = initial;
    return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  },
  useCallback: memo, useMemo: (fn: () => unknown, deps: unknown[]) => memo(fn, deps)(),
  useEffect(setup: () => any, deps: unknown[]) {
    const index = cursor++;
    if (!slots[index] || deps.some((dep, i) => dep !== slots[index].deps[i])) {
      slots[index]?.cleanup?.();
      slots[index] = { deps };
      pending.push(() => { slots[index].cleanup = setup(); });
    }
  },
} });
mock.module('next/link', { defaultExport: ({ children, ...props }: any) => React.createElement('a', props, children) });
Object.assign(globalThis, { React });
function elements(tree: any): any[] {
  if (!React.isValidElement(tree)) return [];
  return [tree, ...React.Children.toArray((tree.props as any).children).flatMap(elements)];
}
async function flush() {
  const effects = pending; pending = []; effects.forEach(effect => effect());
  await new Promise(resolve => setImmediate(resolve));
}

test('queue toggle includes superseded items, resets pagination and updates top hidden counts without changing review state', async t => {
  slots.length = 0; pending = [];
  const requests: string[] = [];
  const row = (id: string, superseded = false) => ({ reviewSubjectId: id, candidateKind: 'AGENT', state: 'PROPOSED', sourceName: id,
    sourceExternalId: 'agent.ts', sourceExternalType: 'file', sourceConnectionId: 'conn', detectedAt: '2026-11-27T00:00:00Z', evidenceCount: 1, assertionCount: 1, superseded });
  t.mock.method(globalThis, 'fetch', async (input: any) => {
    const url = String(input); requests.push(url);
    if (url.endsWith('/summary')) return Response.json({ needsReview: 18, proposed: 18, detected: 0, confirmed: 0, certified: 0, supersededByState: { PROPOSED: 9 } });
    const params = new URL(url, 'http://localhost').searchParams;
    return Response.json({ items: [row('current'), ...(params.get('showSuperseded') ? [row('old', true)] : [])], page: Number(params.get('page')), pageSize: 25, hasMore: true, supersededCount: 9 });
  });
  const Queue = (await import('../app/(dashboard)/governance/reviews/page')).default;
  const render = () => { cursor = 0; const tree = Queue(); return { tree, html: renderToStaticMarkup(tree) }; };
  render(); await flush();
  let result = render();
  assert.match(result.html, /Show superseded \(9\)/);
  assert.match(result.html, /9 superseded hidden/);
  assert.doesNotMatch(result.html, /Superseded by newer discovery run/);
  const next = elements(result.tree).find(element => element.props.children === 'Next');
  next.props.onClick(); render(); await flush();
  result = render(); assert.match(result.html, /Page 2/);
  const toggle = elements(result.tree).find(element => element.type === 'input' && element.props.type === 'checkbox');
  toggle.props.onChange({ target: { checked: true } }); render(); await flush();
  result = render();
  assert.match(requests.at(-1)!, /showSuperseded=true/); assert.match(requests.at(-1)!, /page=1/);
  assert.match(result.html, /Superseded by newer discovery run/);
  assert.match(result.html, /0 superseded hidden/);
  assert.match(result.html, /text-warning">18</);
  assert.equal((result.html.match(/>PROPOSED</g) ?? []).length, 2);
  elements(result.tree).find(element => element.type === 'input' && element.props.type === 'checkbox').props.onChange({ target: { checked: false } });
  render(); await flush(); result = render();
  assert.doesNotMatch(requests.at(-1)!, /showSuperseded=true/);
  assert.doesNotMatch(result.html, /Superseded by newer discovery run/);
});

test('four agent groups keep readable initial fit bounds in a taller, keyboard focusable scroll canvas', async t => {
  slots.length = 0; cursor = 0;
  let flowProps: any;
  const flow = createRequire(import.meta.url)('@xyflow/react');
  const replacements = { ReactFlow: (props: any) => { flowProps = props; return React.createElement('div', null, props.children); }, Background: () => null, Controls: () => null };
  const original = Object.fromEntries(Object.keys(replacements).map(key => [key, flow[key]]));
  Object.assign(flow, replacements); t.after(() => Object.assign(flow, original));
  mock.module('@xyflow/react/dist/style.css', { defaultExport: {} });
  const { CanonicalGraph } = await import('../components/graph/CanonicalGraph');
  const graph = { nodes: ['a', 'b', 'c', 'd'].map(id => ({ nodeId: id, canonicalObjectId: id, canonicalObjectKind: 'AGENT' })), edges: [] } as unknown as GovernedGraph;
  const html = renderToStaticMarkup(React.createElement(CanonicalGraph, { graph }));
  assert.equal(flowProps.fitViewOptions.minZoom, CANONICAL_READABLE_ZOOM);
  assert.ok(flowProps.minZoom >= 0.85); assert.equal(flowProps.zoomOnScroll, false); assert.equal(flowProps.preventScrolling, false);
  assert.match(html, /overflow-auto/); assert.match(html, /max\(800px, calc\(100dvh - 260px\)\)/);
  assert.match(html, /tabindex="0" role="region" aria-label="Canonical graph/);
  assert.equal(flowProps.nodes.length, 8);
  assert.equal(new Set(flowProps.nodes.filter((n: any) => n.type === 'agentGroup').map((n: any) => n.position.x)).size, 2);
});
