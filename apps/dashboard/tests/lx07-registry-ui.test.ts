import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { projectAgentDetail } from '../lib/agent-detail-dto';
import type { Agent } from '../types/agents';

const state: unknown[] = [];
let cursor = 0;
let started = false;
let pending: Array<() => void> = [];
const navigation: string[] = [];
const OWNER = '33333333-3333-4333-8333-333333333333';
let AgentForm: () => React.ReactElement;
let AgentTable: typeof import('../components/agents/AgentTable').AgentTable;
before(async () => {
  Object.assign(globalThis, { React });
  mock.module('react', { namedExports: { ...React,
    useState(initial: unknown) { const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], (value: unknown) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
    useEffect(setup: () => void) { if (!started) pending.push(setup); },
    useCallback(fn: unknown) { return fn; },
  } });
  mock.module('next/navigation', { namedExports: { useRouter: () => ({ push: (url: string) => navigation.push(url), back() {} }) } });
  const Form = (await import('../components/agents/AgentForm')).AgentForm;
  AgentForm = () => Form({ owners: [{ user_id: OWNER, full_name: 'Fixture owner' }] });
  AgentTable = (await import('../components/agents/AgentTable')).AgentTable;
});
beforeEach(() => { state.length = 0; cursor = 0; started = false; pending = []; navigation.length = 0; });

function render(component: () => React.ReactElement) { cursor = 0; return component() as Element; }
type Element = React.ReactElement<Record<string, any>>;
function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
const select = (tree: React.ReactNode) => elements(tree).find(element => element.props.label === 'Historical oversight label (unverified)')!;

test('actual form starts empty, blocks submission without choice and transmits only an explicitly selected historical label', async t => {
  const submitted: Record<string, unknown>[] = [];
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    assert.equal(url, '/api/agents'); assert.equal(init?.method, 'POST');
    submitted.push(JSON.parse(String(init?.body)));
    // Isolated rendering/handler coverage; the registration integration test uses the real POST.
    return Response.json({ agent: { agent_id: 'fixture-created' } }, { status: 201 });
  });
  let tree = render(AgentForm);
  const html = renderToStaticMarkup(tree);
  assert.equal(select(tree).props.value, ''); assert.equal(select(tree).props.required, true);
  assert.equal(select(tree).props['aria-describedby'], 'oversight-limitation');
  assert.match(html, /<option value="" selected="">Select a historical label explicitly<\/option>/);
  assert.doesNotMatch(html, /<option value="l[1-4][^"]*" selected=""/);
  assert.match(html, /Effective oversight: UNKNOWN \/ NOT_EVIDENCED/);
  assert.match(html, /NON_AUTHORITATIVE.*a recorded label does not prove supervision/);
  assert.match(html, /Applicability and sufficiency are unknown/);
  await tree.props.onSubmit({ preventDefault() {} });
  assert.equal(fetchMock.mock.calls.length, 0);
  assert.match(renderToStaticMarkup(render(AgentForm)), /Choose a historical oversight label explicitly/);
  elements(render(AgentForm)).find(element => element.props.name === 'owner_user_id')!
    .props.onChange({ target: { value: OWNER } });
  for (const level of ['l1_automated', 'l2_human_review', 'l3_human_approval', 'l4_human_in_loop']) {
    tree = render(AgentForm); select(tree).props.onChange({ target: { value: level } });
    tree = render(AgentForm); await tree.props.onSubmit({ preventDefault() {} });
    assert.equal(submitted.at(-1)!.oversight_level, level);
    assert.equal(submitted.at(-1)!.owner_user_id, OWNER);
    assert.ok(!('oversight' in submitted.at(-1)!));
  }
  assert.deepEqual(navigation, Array(4).fill('/agents/fixture-created'));
  tree = render(AgentForm); select(tree).props.onChange({ target: { value: '' } });
  await render(AgentForm).props.onSubmit({ preventDefault() {} });
  assert.equal(fetchMock.mock.calls.length, 4, 'returning to the placeholder cannot persist the last choice');
});

test('actual list hook/table consume projected collection data and retain identity/navigation without presenting historical oversight as effective', async t => {
  const agents = ['l2_human_review', 'l4_human_in_loop', null].map((level, i) => projectAgentDetail({
    agent_id: `id-${i}`, agent_code: `AG-${i}`, name: `Fixture ${i}`, agent_type: 'assistive',
    risk_level: 'low', status: 'registered', organisation_id: 'org-a', oversight_level: level,
  } as Agent));
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0]) => {
    assert.equal(url, '/api/agents?'); return Response.json({ agents, total: 3 });
  });
  render(AgentTable); started = true; pending.forEach(setup => setup());
  await new Promise(resolve => setImmediate(resolve));
  const html = renderToStaticMarkup(render(AgentTable));
  assert.equal(fetchMock.mock.calls.length, 1); assert.match(html, /3 agents/);
  agents.forEach((agent, i) => { assert.match(html, new RegExp(`Fixture ${i}`)); assert.ok(html.includes(`/agents/${agent.agent_id}`)); });
  assert.doesNotMatch(html, /l2_human_review|l4_human_in_loop|Oversight Level|Human Review|Human in the Loop/);
});
