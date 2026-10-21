import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, mock, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { integrity, event, org, id } from './helpers/audit-v2-fixtures';

// Drive real page handlers and the real read hook with deterministic effect
// setup/cleanup, then render the actual component tree. No browser timing claims.
const values: unknown[] = [];
let slot = 0;
const effects = new Map<number, { deps: unknown[]; cleanup?: () => void }>();
let pending: (() => void)[] = [];
let routeId = `V2:${id}`;
let Records: typeof import('../components/audit/AuditRecords');
let Page: typeof import('../app/(dashboard)/audit/page').default;
let Detail: typeof import('../app/(dashboard)/audit/[id]/page').default;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
before(async () => {
  Object.assign(globalThis, { React });
  mock.module('react', { namedExports: { ...React,
    useState(initial: unknown) {
      const index = slot++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (value: unknown) => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
    },
    useEffect(setup: () => (() => void), deps: unknown[]) {
      const index = slot++, old = effects.get(index);
      if (!old || deps.some((d, i) => !Object.is(d, old.deps[i]))) {
        pending.push(() => { old?.cleanup?.(); effects.set(index, { deps, cleanup: setup() }); });
      }
    },
  } });
  mock.module('next/link', { defaultExport: ({ children, ...props }: { children: React.ReactNode; href: string }) => React.createElement('a', props, children) });
  mock.module('next/navigation', { namedExports: { useParams: () => ({ id: routeId }) } });
  Records = await import('../components/audit/AuditRecords');
  Page = (await import('../app/(dashboard)/audit/page')).default;
  Detail = (await import('../app/(dashboard)/audit/[id]/page')).default;
});
function reset() { for (const effect of effects.values()) effect.cleanup?.(); effects.clear(); values.length = 0; pending = []; slot = 0; }
beforeEach(reset); afterEach(reset);
const html = (node: React.ReactNode) => renderToStaticMarkup(node);
function render(page = Page) { slot = 0; const node = page(); const work = pending; pending = []; work.forEach(fn => fn()); return node; }
type Interactive = { children?: React.ReactNode; onClick?: () => void; onChange?: (e: { target: { value: string } }) => void; value?: string; maxLength?: number; disabled?: boolean };
function find(node: React.ReactNode, predicate: (el: React.ReactElement<Interactive>) => boolean): React.ReactElement<Interactive> | undefined {
  if (!React.isValidElement<Interactive>(node)) return;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props.children)) { const found = find(child, predicate); if (found) return found; }
}
function click(node: React.ReactNode, label: string) { const target = find(node, el => el.props.children === label); assert.ok(target?.props.onClick, label); target.props.onClick(); }
const pageData = (next: string | null = null) => ({ organisation_id: org, events: [event()], next_cursor: next });

test('four integrity states render distinct wording and visuals; EMPTY neutral, UNKNOWN amber, history independent', () => {
  const expected = { VALID: ['V2 ledger integrity verified', 'text-success'], BROKEN: ['V2 ledger integrity issue detected', 'text-danger'],
    UNKNOWN: ['V2 ledger integrity could not be established', 'text-warning'], EMPTY: ['No V2 ledger entries to verify', 'text-gray-300'] };
  for (const status of ['VALID', 'BROKEN', 'UNKNOWN', 'EMPTY'] as const) {
    const markup = html(React.createElement(Records.AuditIntegrity, { result: { state: 'loaded', data: integrity(status) } }));
    for (const text of expected[status]) assert.ok(markup.includes(text), `${status}: ${text}`);
    assert.match(markup, /retained-record chain consistency|retained-record/);
    assert.match(markup, /Historical records before the V2 cutover use the legacy global chain/);
    assert.match(markup, /do not constitute tenant-local cryptographic verification/);
    if (status !== 'VALID') assert.doesNotMatch(markup, /text-success|Verified through tenant sequence/);
    if (status === 'UNKNOWN') assert.doesNotMatch(markup, /text-danger|BROKEN|V2 entries checked/);
  }
  for (const history of ['NO_LEGACY_ENTRIES', 'UNKNOWN'] as const) {
    const markup = html(React.createElement(Records.AuditIntegrity, { result: { state: 'loaded', data: integrity('EMPTY', history) } }));
    assert.match(markup, history === 'UNKNOWN' ? /History state has not been established/ : /No legacy entries are present/);
  }
});
test('loading, denial, unauthenticated, transport, invalid cursor and missing record never imply integrity', () => {
  for (const state of ['loading', 'denied', 'unauthenticated', 'unavailable', 'invalid', 'not_found'] as const) {
    const markup = html(React.createElement(Records.AuditIntegrity, { result: { state } }));
    assert.match(markup, state === 'loading' ? /role="status"/ : /role="alert"/);
    assert.doesNotMatch(markup, /text-success|>VALID<|>BROKEN<|>EMPTY<|>UNKNOWN</);
  }
});
test('list and V2/legacy detail show bounded metadata, opaque links and explicit payload authority', () => {
  const markup = html(React.createElement(Records.AuditEventTable, { events: [event(), event('LEGACY')] }));
  assert.ok(markup.includes(`/audit/V2%3A${id}`)); assert.ok(markup.includes(`/audit/LEGACY%3A${id}`));
  assert.match(markup, /V2 #3/); assert.match(markup, />Legacy</); assert.doesNotMatch(markup, /Verified|Governed|Approved|Compliant/);
  for (const kind of ['V2', 'LEGACY'] as const) {
    const detail = html(React.createElement(Records.AuditEventDetail, { event: event(kind) }));
    assert.match(detail, kind === 'V2' ? /RETAINED_RECORD_ONLY/ : /LEGACY_NON_AUTHORITATIVE/);
    assert.match(detail, /Ledger integrity does not establish the semantic truth of payload contents/);
    assert.match(detail, /Legacy-field authority: LEGACY_NON_AUTHORITATIVE/);
    assert.match(detail, /human_oversight_verified/); assert.match(detail, /semantic_truth/);
    assert.doesNotMatch(detail, /entry_sequence|entry_hash|previous_hash|Hash Chain|Immutable|>Verified<|>Approved</);
    if (kind === 'LEGACY') assert.match(detail, /Not applicable \(Legacy\)/);
  }
});
test('real page first request, Next cursor and exact filter reset; unsupported filters/totals absent', async t => {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => { requests.push(String(url));
    return Response.json(String(url).includes('/integrity') ? integrity() : pageData(`V2:${id}`)); });
  assert.match(html(render()), /Loading audit records/); await tick(); let tree = render();
  assert.match(html(tree), /V2 ledger integrity verified/); assert.match(html(tree), /Retained description/);
  assert.ok(requests.includes('/api/audit/events?limit=50'));
  click(tree, 'Next'); assert.doesNotMatch(html(render()), /Retained description/); await tick(); tree = render();
  assert.ok(requests.some(url => url.includes(`cursor=V2%3A${id}`)));
  const input = find(tree, el => el.props.maxLength === 120); assert.ok(input?.props.onChange);
  input.props.onChange({ target: { value: 'TEST' } }); render(); await tick(); tree = render();
  assert.equal(requests.at(-1), '/api/audit/events?limit=50&event_type=TEST');
  assert.doesNotMatch(html(tree), /totalPages|Showing .* of|Search events|All subjects|Last 30 Days|Total Entries|Latest Sequence/);
  // Pagination/filter changes leave the independently obtained integrity request alone.
  assert.equal(requests.filter(url => url.includes('/integrity')).length, 1);
});
test('successful integrity and events are cleared on refresh, HTTP failure and transport failure; recover explicitly', async t => {
  let status = 200, networkError = false;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    if (networkError) throw new Error('private transport');
    return Response.json(status === 200 ? String(url).includes('/integrity') ? integrity() : pageData() : { error: 'private' }, { status });
  });
  render(); await tick(); let tree = render(); assert.match(html(tree), /V2 ledger integrity verified/);
  for (const failure of [503, 401, 403, 500, 400]) {
    status = failure; click(tree, 'Refresh audit reads');
    assert.doesNotMatch(html(render()), /V2 ledger integrity verified|Retained description/); await tick(); tree = render();
    const markup = html(tree); assert.match(markup, /role="alert"/); assert.doesNotMatch(markup, /V2 ledger integrity verified|Retained description|>VALID<|private/);
  }
  networkError = true; click(tree, 'Refresh audit reads'); render(); await tick(); tree = render(); assert.match(html(tree), /temporarily unavailable/);
  networkError = false; status = 200; click(tree, 'Refresh audit reads'); render(); await tick(); tree = render(); assert.match(html(tree), /V2 ledger integrity verified/);
});
test('late old requests cannot overwrite the current filtered page or refreshed integrity', async t => {
  const old: ((response: Response) => void)[] = [];
  const signals: AbortSignal[] = [];
  let first = true;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    if (first) { signals.push(options!.signal!); return new Promise<Response>(resolve => old.push(resolve)); }
    return Response.json(String(url).includes('/integrity') ? integrity('UNKNOWN') : { organisation_id: org, events: [], next_cursor: null });
  });
  let tree = render(); first = false; click(tree, 'Refresh audit reads'); render(); await tick();
  assert.ok(signals.every(signal => signal.aborted));
  old[0](Response.json(pageData())); old[1](Response.json(integrity())); await tick();
  tree = render(); assert.match(html(tree), /V2 ledger integrity could not be established/); assert.doesNotMatch(html(tree), /V2 ledger integrity verified|Retained description/);
});
test('detail route changes mask old events immediately, fetch opaque handle and cannot retain success after denial/not-found', async t => {
  let status = 200;
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => { requests.push(String(url)); return Response.json(status === 200 ? { event: event() } : { error: 'private' }, { status }); });
  render(Detail); await tick(); let tree = render(Detail); assert.match(html(tree), /Retained description/);
  assert.equal(requests[0], `/api/audit/events/V2%3A${id}`);
  status = 404; routeId = '123'; assert.doesNotMatch(html(render(Detail)), /Retained description/); await tick(); tree = render(Detail);
  assert.match(html(tree), /Event not found or legacy link unavailable/);
  status = 403; click(tree, 'Retry current record'); render(Detail); await tick(); assert.match(html(render(Detail)), /records denied/);
});
