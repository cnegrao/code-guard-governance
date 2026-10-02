import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { before, mock, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

before(() => {
  Object.assign(globalThis, { React });
  mock.module('../hooks/useAuth', { namedExports: { useAuth: () => ({ session: null, logout() {} }) } });
  mock.module('next/navigation', { namedExports: { usePathname: () => '/' } });
});
test('control panel renders every semantic state explicitly and never promotes strings to PASS', async () => {
  const { CompliancePanel } = await import('../components/agents/CompliancePanel');
  const markup = renderToStaticMarkup(React.createElement(CompliancePanel, {
    compliance: { unknown: 'not_assessed', waived: 'waived', failed: 'failed', passed: 'passed' }, score: null, gaps: [],
  }));
  assert.equal((markup.match(/>PASS</g) ?? []).length, 1);
  assert.match(markup, /NOT_ASSESSED/); assert.match(markup, /WAIVED/); assert.match(markup, />FAIL</);
  assert.doesNotMatch(markup, /100%|All controls passing/);
});
test('sidebar destinations exist, canonical passports are reachable and root is active', async () => {
  const { Sidebar } = await import('../components/layout/Sidebar');
  const markup = renderToStaticMarkup(React.createElement(Sidebar));
  const hrefs = [...markup.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.ok(hrefs.includes('/agents/canonical')); assert.ok(hrefs.includes('/graph')); assert.ok(hrefs.includes('/'));
  for (const href of hrefs) assert.ok(existsSync(new URL(`../app/(dashboard)${href === '/' ? '' : href}/page.tsx`, import.meta.url)), href);
  assert.doesNotMatch(markup, /href="\/(dashboard|compliance|settings)"/);
});
test('reports have no download claims and Discovery has no promotion controls', async () => {
  const Reports = (await import('../app/(dashboard)/reports/page')).default;
  const Discovery = (await import('../app/(dashboard)/discovery/page')).default;
  const report = renderToStaticMarkup(React.createElement(Reports));
  assert.match(report, /NOT_ASSESSED/); assert.doesNotMatch(report, /href="\/api\/reports/);
  const discovery = renderToStaticMarkup(React.createElement(Discovery));
  assert.match(discovery, /NOT ACTIVE/); assert.doesNotMatch(discovery, />Approve<|>Activate<|>Approved</);
  const source = readFileSync(new URL('../app/(dashboard)/discovery/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!res\.ok\) throw new Error\("Inventory read failed"\)/);
  assert.match(source, /!error && !loading && pending\.length/);
});
test('visible Graph imports only the governed surface; unavailable dashboard destinations are removed', () => {
  const graph = readFileSync(new URL('../app/(dashboard)/graph/page.tsx', import.meta.url), 'utf8');
  assert.match(graph, /getGovernedGraph/); assert.doesNotMatch(graph, /ReactFlowGraph|knowledge-graph/);
  const dashboard = readFileSync(new URL('../app/(dashboard)/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(dashboard, /href="\/(compliance|incidents|settings|dashboard)"/);
});

test('Search request outcomes render empty and error states distinctly', async t => {
  // Drive the real page handler with local hook state, then SSR its returned tree.
  // This is a focused handler/render regression, not browser lifecycle coverage.
  const state: unknown[] = [];
  let cursor = 0;
  t.mock.module('react', { namedExports: { ...React, useState(initial: unknown) {
    const slot = cursor++;
    if (!(slot in state)) state[slot] = initial;
    return [state[slot], (value: unknown) => { state[slot] = value; }];
  } } });
  const Search = (await import('../app/(dashboard)/search/page')).default;
  const render = () => { cursor = 0; return Search(); };
  type InputProps = { placeholder?: string; children?: React.ReactNode;
    onChange?: (event: { target: { value: string } }) => Promise<void> };
  function findInput(node: React.ReactNode): React.ReactElement<InputProps> | undefined {
    if (!React.isValidElement<InputProps>(node)) return;
    if (node.props.placeholder === 'Search agents, systems, incidents...') return node;
    for (const child of React.Children.toArray(node.props.children)) {
      const found = findInput(child);
      if (found) return found;
    }
  }
  const search = async (response: () => Promise<Response>) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', response);
    try {
      const input = findInput(render());
      assert.ok(input?.props.onChange);
      await input.props.onChange({ target: { value: 'fraud' } });
      return renderToStaticMarkup(render());
    } finally { fetchMock.mock.restore(); }
  };
  await t.test('successful empty response renders the normal empty state', async () => {
    const html = await search(async () => Response.json({ results: [] }));
    assert.match(html, /No results for &quot;fraud&quot;/);
    assert.doesNotMatch(html, /role="alert"|ERROR:/);
  });
  await t.test('HTTP failure clears stale results and renders ERROR, never No results', async () => {
    const populated = await search(async () => Response.json({ results: [
      { id: 'one', type: 'agent', title: 'Previous result', subtitle: '', url: null },
    ] }));
    assert.match(populated, /Previous result/);
    const html = await search(async () => Response.json({ error: 'read failed' }, { status: 500 }));
    assert.match(html, /role="alert"[^>]*>ERROR: Search could not be read/);
    assert.doesNotMatch(html, /No results|Previous result/);
  });
  await t.test('network failure renders ERROR and a later empty success clears it', async () => {
    const html = await search(async () => { throw new Error('Network unavailable'); });
    assert.match(html, /role="alert"[^>]*>ERROR: Search could not be read/);
    assert.doesNotMatch(html, /No results/);
    const recovered = await search(async () => Response.json({ results: [] }));
    assert.match(recovered, /No results for &quot;fraud&quot;/);
    assert.doesNotMatch(recovered, /role="alert"|ERROR:/);
  });
});
