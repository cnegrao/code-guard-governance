import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { before, mock, test } from 'node:test';

/**
 * M16-S1B.2R1 consumer migration: ledger_verify and the three legacy read RPCs are service_role-only
 * definers, so every tracked consumer calls them through the server-side service client (db.write) with the
 * organisation bound from the verified governance principal; agent_graph_traverse (no tenant argument) is
 * preceded by a same-organisation root check and fails closed BEFORE the elevated traversal.
 */
type Call = { client: 'read' | 'write'; kind: 'from' | 'rpc'; name: string; args?: unknown; ops: unknown[][] };
const calls: Call[] = [];
let fromResult: (call: Call) => unknown = () => ({ data: [], count: 0, error: null });
let rpcResult: (call: Call) => unknown = () => ({ data: [], error: null });
function client(which: 'read' | 'write') {
  return {
    from(table: string) {
      const call: Call = { client: which, kind: 'from', name: table, ops: [] };
      calls.push(call);
      const proxy: unknown = new Proxy({}, {
        get(_target, prop) {
          if (prop === 'then') return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(fromResult(call)).then(resolve, reject);
          if (prop === 'maybeSingle' || prop === 'single') return () => { call.ops.push([prop]); return Promise.resolve(fromResult(call)); };
          return (...args: unknown[]) => { call.ops.push([String(prop), ...args]); return proxy; };
        },
      });
      return proxy;
    },
    rpc(name: string, args: unknown) {
      const call: Call = { client: which, kind: 'rpc', name, args, ops: [] };
      calls.push(call);
      return Promise.resolve(rpcResult(call));
    },
  };
}
const ORG = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
let graph: typeof import('../repositories/graph');
let audit: typeof import('../repositories/audit');
let agents: typeof import('../repositories/agents');

before(async () => {
  mock.module('../lib/db', { namedExports: { db: { read: client('read'), write: client('write') } } });
  graph = await import('../repositories/graph');
  audit = await import('../repositories/audit');
  agents = await import('../repositories/agents');
});
const reset = () => {
  calls.length = 0;
  fromResult = () => ({ data: [], count: 0, error: null });
  rpcResult = () => ({ data: [], error: null });
};
const rpcCalls = () => calls.filter(call => call.kind === 'rpc');

test('agent_graph_traverse: a root agent outside the verified organisation fails closed BEFORE the elevated traversal', async () => {
  reset();
  fromResult = () => ({ data: null, error: null });
  await assert.rejects(graph.getTraversal(ORG, AGENT, 5), graph.CrossTenantAgentError);
  assert.deepEqual(rpcCalls(), [], 'no traversal RPC was issued');
  const [check] = calls;
  assert.equal(check.client, 'write');
  assert.equal(check.name, 'agents');
  assert.deepEqual(check.ops, [['select', 'agent_id'], ['eq', 'organisation_id', ORG], ['eq', 'agent_id', AGENT], ['maybeSingle']]);
});

test('agent_graph_traverse: same-organisation root runs through the service client only', async () => {
  reset();
  fromResult = () => ({ data: { agent_id: AGENT }, error: null });
  rpcResult = () => ({ data: [{ agent_id: 'child' }], error: null });
  assert.deepEqual(await graph.getTraversal(ORG, AGENT, 3), [{ agent_id: 'child' }]);
  assert.deepEqual(rpcCalls().map(({ client, name, args }) => ({ client, name, args })), [
    { client: 'write', name: 'agent_graph_traverse', args: { p_root_agent_id: AGENT, p_max_depth: 3, p_edge_types: null, p_active_only: true } }]);
  reset();
  fromResult = () => ({ data: null, error: { message: 'boom' } });
  await assert.rejects(graph.getTraversal(ORG, AGENT, 3), /boom/);
  assert.deepEqual(rpcCalls(), []);
});

test('ledger_verify (audit integrity) and agent_compliance_gaps use the service client with the bound organisation', async () => {
  reset();
  rpcResult = call => (call.name === 'ledger_verify'
    ? { data: [{ is_valid: true, entries_checked: 0, first_break_at: null, break_reason: null }], error: null } : { data: [], error: null });
  await audit.getIntegrity(ORG);
  assert.deepEqual(rpcCalls().map(({ client, name, args }) => ({ client, name, args })), [
    { client: 'write', name: 'ledger_verify', args: { p_from_sequence: 1, p_to_sequence: null } }]);
  reset();
  fromResult = call => (call.ops.some(op => op[0] === 'single' || op[0] === 'maybeSingle') ? { data: null, error: null } : { data: [], count: 0, error: null });
  await agents.getAgentWithOwner(ORG, AGENT);
  assert.deepEqual(rpcCalls().map(({ client, name, args }) => ({ client, name, args })), [
    { client: 'write', name: 'agent_compliance_gaps', args: { p_organisation_id: ORG } }]);
});

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const SERVICE_ONLY_RPCS = ['ledger_verify', 'agent_compliance_gaps', 'agent_graph_traverse', 'agent_semantic_search', 'ledger_append', 'recompute_risk_propagation'];

test('static: no tracked consumer calls a service_role-only definer through the anon client', () => {
  for (const path of ['repositories/agents.ts', 'repositories/audit.ts', 'repositories/dashboard.ts', 'repositories/graph.ts',
    'repositories/reports.ts', 'repositories/talk.ts', 'services/talk.ts', 'app/api/discovery/review/route.ts', 'app/api/discovery/scan/route.ts']) {
    const text = source(path);
    for (const rpc of SERVICE_ONLY_RPCS) assert.doesNotMatch(text, new RegExp(`db\\.read\\s*\\.rpc\\(\\s*["']${rpc}["']`), `${path} ${rpc}`);
  }
  assert.equal((source('repositories/talk.ts').match(/db\.write\.rpc\("agent_semantic_search"/g) ?? []).length, 1);
  assert.equal((source('repositories/dashboard.ts').match(/db\.write\.rpc\("agent_compliance_gaps"/g) ?? []).length, 3);
});

test('static: every route reaching these RPCs binds the organisation from the verified governance principal', () => {
  for (const path of ['app/api/agents/[id]/route.ts', 'app/api/agents/route.ts', 'app/api/audit/integrity/route.ts', 'app/api/dashboard/summary/route.ts',
    'app/api/graph/estate/route.ts', 'app/api/graph/node/[id]/route.ts', 'app/api/graph/risk/[agentId]/route.ts', 'app/api/reports/ai-act/route.ts',
    'app/api/reports/dora/route.ts', 'app/api/reports/executive/route.ts', 'app/api/talk-to-governance/route.ts']) {
    const text = source(path);
    assert.match(text, /const \{ organisationId: orgId(?:, [^}]*)? \} = await requireVerifiedGovernancePrincipal\(\)/, path);
    assert.doesNotMatch(text, /(searchParams|body|params)[^\n]*organisation_?[iI]d/, `${path} takes no client-supplied organisation`);
  }
  const node = source('app/api/graph/node/[id]/route.ts');
  assert.match(node, /if \(error instanceof CrossTenantAgentError\) return NextResponse\.json\(\{ error: "Agent not found" \}, \{ status: 404 \}\)/);
});
