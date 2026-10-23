import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { before, mock, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

before(() => {
  Object.assign(globalThis, { React });
  mock.module('../hooks/useAuth', { namedExports: { useAuth: () => ({ session: null, logout() {} }) } });
  mock.module('next/navigation', { namedExports: { usePathname: () => '/', useParams: () => ({ id: 'fixture' }) } });
});
test('control panel renders every semantic state explicitly and never promotes strings to PASS', async () => {
  const { LegacyControlRecordsPanel } = await import('../components/agents/LegacyControlRecordsPanel');
  const markup = renderToStaticMarkup(React.createElement(LegacyControlRecordsPanel, {
    states: { unknown: 'not_assessed', waived: 'waived', failed: 'failed', passed: 'passed' }, gaps: [],
  }));
  assert.equal((markup.match(/>RECORDED_PASS /g) ?? []).length, 1);
  assert.match(markup, /NOT_ASSESSED/); assert.match(markup, /RECORDED_WAIVED/); assert.match(markup, />RECORDED_FAIL /);
  assert.doesNotMatch(markup, /100%|All controls passing/);
});
test('Agent/System panel state matrix stays non-authoritative for mixed, all-pass, unknown and empty records', async () => {
  const { LegacyControlRecordsPanel } = await import('../components/agents/LegacyControlRecordsPanel');
  for (const prefix of ['cg_ag_', 'cg_sys_']) {
    for (const states of [
      { [`${prefix}001_registered`]: 'passed', [`${prefix}002_owner`]: 'failed', [`${prefix}003`]: 'waived' },
      { [`${prefix}001_registered`]: 'passed', [`${prefix}002_owner`]: 'passed' },
      { [`${prefix}001_registered`]: 'not_assessed', [`${prefix}002_owner`]: 'not_assessed' }, {},
    ] as Array<Record<string, import('../types/agents').ControlState>>) {
      const gaps = Object.values(states).includes('failed') ? ['Recorded failure'] : [];
      const markup = renderToStaticMarkup(React.createElement(LegacyControlRecordsPanel, { states, gaps }));
      assert.match(markup, /LEGACY_NON_AUTHORITATIVE/);
      assert.match(markup, /Legacy\/manual records - not a compliance or assurance determination/);
      assert.doesNotMatch(markup, /%|text-success|bg-success|text-green|bg-green|>PASS<|>COMPLIANT<|>VERIFIED<|>READY</);
      if (!gaps.length) assert.match(markup, /This does not establish compliance or assurance/);
      for (const state of Object.values(states)) assert.match(markup, new RegExp(state === 'passed' ? 'RECORDED_PASS' : state === 'failed' ? 'RECORDED_FAIL' : state === 'waived' ? 'RECORDED_WAIVED' : 'NOT_ASSESSED'));
      if (!Object.keys(states).length) assert.match(markup, /No legacy control states recorded/);
    }
  }
});
test('actual detail/home pages consume the new response and render no legacy aggregate', async t => {
  const state: unknown[] = []; let cursor = 0; let started = false; let pending: (() => void)[] = [];
  t.mock.module('react', { namedExports: { ...React,
    useState(initial: unknown) { const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], (value: unknown) => { state[index] = value; }]; },
    useEffect(setup: () => void) { if (!started) pending.push(setup); },
  } });
  const Agent = (await import('../app/(dashboard)/agents/[id]/page')).default;
  const System = (await import('../app/(dashboard)/systems/[id]/page')).default;
  const Home = (await import('../app/(dashboard)/page')).default;
  const { legacyControlEnvelope } = await import('../lib/legacy-control-dto');
  async function loaded(page: () => React.ReactNode, data: unknown) {
    state.length = 0; cursor = 0; started = false; pending = [];
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(data));
    try {
      page(); started = true; pending.forEach(fn => fn());
      await new Promise<void>(resolve => setImmediate(resolve));
      cursor = 0; return renderToStaticMarkup(page());
    } finally { fetch.mock.restore(); }
  }
  for (const [page, field] of [[Agent, 'agent'], [System, 'system']] as const) {
    const markup = await loaded(page, { [field]: { name: 'Fixture inventory', status: 'registered' },
      owner_name: 'Fixture owner', agent_count: 3,
      ...legacyControlEnvelope({ cg_ag_001_registered: 'passed' }, []) });
    assert.match(markup, /Legacy Control Records/); assert.match(markup, /RECORDED_PASS/);
    assert.match(markup, /Fixture owner/); assert.match(markup, /LEGACY_NON_AUTHORITATIVE/);
    assert.doesNotMatch(markup, /%|>Compliance</);
    // LX01 risk/status badges are a separate gate. Check positive treatment
    // only in the legacy control section, whose source and states changed here.
    assert.doesNotMatch(markup.slice(markup.indexOf('Legacy Control Records')), /text-success|bg-success/);
  }
  for (const industry of ['other', 'financial_services']) {
    const markup = await loaded(Home, { totalAgents: 0, totalSystems: 0, totalLegacyControlGaps: 0,
      legacyControlGaps: [], riskDistribution: { critical: 0, high: 0, medium: 0, low: 0 }, recentIncidents: [], industry });
    assert.match(markup, /Recorded Legacy Control Gaps/); assert.match(markup, /Legacy Control Gap Records/);
    assert.match(markup, /This does not establish compliance/);
    assert.doesNotMatch(markup, /Legacy Control Coverage|Top Compliance Gaps|Total Governance Gaps|\d+%<\/div>/);
    assert.match(markup, /grid-cols-2 gap-4/);
  }
});
test('sidebar destinations exist, canonical passports are reachable and root is active', async () => {
  const { Sidebar } = await import('../components/layout/Sidebar');
  const markup = renderToStaticMarkup(React.createElement(Sidebar));
  const hrefs = [...markup.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.ok(hrefs.includes('/agents/canonical')); assert.ok(hrefs.includes('/graph')); assert.ok(hrefs.includes('/'));
  for (const href of hrefs) assert.ok(existsSync(new URL(`../app/(dashboard)${href === '/' ? '' : href}/page.tsx`, import.meta.url)), href);
  assert.doesNotMatch(markup, /href="\/(dashboard|compliance|settings)"/);
});
test('active Agent list table exposes inventory with no derived control percentage column', async t => {
  t.mock.module('../hooks/useAgents', { namedExports: { useAgents: () => ({
    agents: [{ agent_id: 'fixture', name: 'Fixture inventory', status: 'registered', agent_type: 'assistive', risk_level: 'low',
      cg_ag_001_registered: true, cg_ag_002_owner: true, cg_ag_003_model_reg: true, cg_ag_007_oversight: true,
      cg_ag_008_audit_trail: true, cg_ag_010_classified: true, cg_ag_012_autonomous_governed: true }],
    total: 1, loading: false, error: null, refetch() {},
  }) } });
  const { AgentTable } = await import('../components/agents/AgentTable');
  const markup = renderToStaticMarkup(React.createElement(AgentTable));
  assert.match(markup, /Fixture inventory/); assert.match(markup, /href="\/agents\/fixture"/);
  assert.doesNotMatch(markup, /%|>Compliance<|>PASS<|>COMPLIANT</);
  assert.equal((markup.match(/<th /g) ?? []).length, 6);
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
