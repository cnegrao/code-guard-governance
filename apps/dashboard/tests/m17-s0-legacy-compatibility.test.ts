import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, mock, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * M17-S0 application acceptance (ADR-GOVIA-RISK-INTELLIGENCE-v1 §23.1, O85 / O87 / O88; D-12 + legacy consumer labeling).
 * - D-12: the discovery scan route, run end-to-end over a real golden fixture repository with the REAL scanner, writes no
 *   gov_repo.agents row (so neither a heuristic nor a column default can be fabricated) and no heuristic risk in any new
 *   ledger payload.
 * - Every remaining legacy-risk consumer renders / returns the LEGACY / NON-AUTHORITATIVE marker (one test per consumer).
 * - No L15 code reads a legacy risk surface.
 */

const LABEL = 'LEGACY / NON-AUTHORITATIVE';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const dashboard = fileURLToPath(new URL('../', import.meta.url));
const source = (path: string) => readFileSync(join(dashboard, path), 'utf8');
const golden = join(root, 'packages/scanner/test/discovery-validation-lab/golden-repositories/04-mcp-not-agent');

// ---- One recording db stub shared by every consumer: reads return per-table fixtures, every write is recorded + refused.
const tableRows: Record<string, Array<Record<string, unknown>>> = {};
const writes: string[] = [];
const ledger: Array<Record<string, any>> = [];
function chain(table: string): any {
  const result = () => {
    const rows = tableRows[table] ?? [];
    return { data: rows, count: rows.length, error: null };
  };
  const proxy: any = new Proxy(function () {}, {
    get(_target, key) {
      if (key === 'then') return (accept: (value: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(result()).then(accept, reject);
      if (['insert', 'update', 'upsert', 'delete'].includes(String(key))) {
        return () => { writes.push(`${String(key)}:${table}`); throw new Error(`write refused in fixture: ${table}`); };
      }
      if (key === 'single' || key === 'maybeSingle') return async () => ({ data: (tableRows[table] ?? [])[0] ?? null, error: null });
      return () => proxy;
    },
  });
  return proxy;
}
const dbStub = {
  write: {
    from: (table: string) => chain(table),
    rpc: async (name: string, args: Record<string, any>) => {
      if (name === 'ledger_append_v2') { ledger.push(args); return { data: '44444444-4444-4444-8444-444444444444', error: null }; }
      return { data: tableRows[`rpc:${name}`] ?? [], error: null };
    },
  },
};

before(() => {
  mock.module('server-only', { namedExports: {} });
  Object.assign(globalThis, { React });
  mock.module('../lib/db', { namedExports: { db: { ...dbStub, read: dbStub.write } } });
  mock.module('../lib/auth', { namedExports: {
    requireVerifiedGovernancePrincipal: async () => ({ organisationId: 'org-1', userId: 'user-1', issuedAtSeconds: 100, expiresAtSeconds: 200, credentialEpoch: '2026-10-20T00:00:00.123456Z' }),
    SessionAuthenticationError: class extends Error {},
  } });
  // Disk-backed provider over a committed golden fixture repository (no network, no hosted service).
  const walk = (dir: string): Array<{ path: string; name: string; type: 'file' }> => readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [{ path: relative(golden, full).split('\\').join('/'), name, type: 'file' as const }];
  });
  mock.module('../lib/discovery/providers', { namedExports: { getProvider: () => ({
    name: 'fixture',
    fetchFiles: async () => walk(golden),
    fetchFileContent: async (_owner: string, _repo: string, path: string) => readFileSync(join(golden, path), 'utf8'),
  }) } });
  mock.module('../services/coding-memory', { namedExports: { indexRepoIntelligence: async () => 0, indexAgentCode: async () => 0 } });
  mock.module('../hooks/useAgents', { namedExports: { useAgents: () => ({
    agents: [{ agent_id: 'a1', agent_code: 'AG-1', name: 'Fixture agent', agent_type: 'assistive', risk_level: 'critical', status: 'active' }],
    total: 1, loading: false, error: null, refresh() {},
  }) } });
});

const deepKeys = (value: unknown, keys: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(value)) value.forEach(v => deepKeys(v, keys));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { keys.add(k); deepKeys(v, keys); }
  return keys;
};

test('O85 / D-12: scan over a real golden repository writes no agents row (no heuristic, no default) and no heuristic risk in ledger payloads', async () => {
  writes.length = 0; ledger.length = 0;
  const { POST } = await import('../app/api/discovery/scan/route');
  const response = await POST(new Request('http://fixture/api/discovery/scan', {
    method: 'POST', body: JSON.stringify({ provider: 'github', owner: 'fixture', repo: '04-mcp-not-agent' }) }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.discovered >= 1, 'the real scanner detects the fixture agent');
  assert.deepEqual(writes, [], 'no table write of any kind');
  assert.equal(body.inventoryStored, 0);
  assert.equal(body.legacyInventoryWrite, 'STOPPED_M17_S0_D12');
  assert.equal(body.heuristicRiskAuthority, LABEL);
  const detected = ledger.filter(e => e.p_event_type === 'inventory.discovery.agent.detected');
  assert.equal(detected.length, body.discovered);
  for (const event of ledger) {
    const keys = deepKeys(event.p_payload);
    for (const forbidden of ['risk_level', 'riskLevel', 'aiActRiskClass', 'ai_act_risk_class', 'suggestedRiskLevel']) {
      assert.ok(!keys.has(forbidden), `${event.p_event_type} carries ${forbidden}`);
    }
  }
});

test('O85 static: no scanner / discovery path inserts legacy agent risk fields', () => {
  const scan = source('app/api/discovery/scan/route.ts');
  assert.doesNotMatch(scan, /\.from\(\s*["']agents["']\s*\)/);
  assert.doesNotMatch(scan, /risk_level\s*:|ai_act_risk_class\s*:|\?\?\s*["']limited["']/);
  const offenders: string[] = [];
  const scanDir = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'tests' || name === 'test' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { scanDir(full); continue; }
      if (!/\.(ts|tsx|js|mjs)$/.test(name)) continue;
      const text = readFileSync(full, 'utf8');
      if (/from\(\s*["']agents["']\s*\)\s*\.(insert|upsert)/.test(text) && /risk_level/.test(text)) offenders.push(relative(root, full));
    }
  };
  for (const dir of ['apps/dashboard/app/api/discovery', 'apps/dashboard/lib/discovery', 'apps/discovery-worker', 'packages/scanner/src']) {
    scanDir(join(root, dir));
  }
  assert.deepEqual(offenders, []);
});

test('O87 agents list: AgentTable renders every legacy risk value with the LEGACY / NON-AUTHORITATIVE marker', async () => {
  const { AgentTable } = await import('../components/agents/AgentTable');
  const markup = renderToStaticMarkup(React.createElement(AgentTable as any, {}));
  assert.match(markup, /critical/);
  assert.ok(markup.includes(LABEL), markup);
  assert.match(markup, /data-authority="LEGACY_NON_AUTHORITATIVE"/);
});

test('O87 shared badge: absent values render as unknown (never low / none), always labelled', async () => {
  const { LegacyRiskBadge } = await import('../components/ui/LegacyRiskBadge');
  const empty = renderToStaticMarkup(React.createElement(LegacyRiskBadge, { value: null }));
  assert.match(empty, />unknown</); assert.ok(empty.includes(LABEL)); assert.doesNotMatch(empty, />low<|>none</);
  const { legacyRisk, legacyRiskText } = await import('../lib/legacy-risk');
  assert.deepEqual(legacyRisk('high'), { value: 'high', authority: 'LEGACY_NON_AUTHORITATIVE', label: LABEL });
  assert.ok(legacyRiskText(undefined).includes('unknown') && legacyRiskText('high').includes(LABEL));
});

test('O87 agent detail: risk level and AI Act class render only through the labelled legacy badge', () => {
  const page = source('app/(dashboard)/agents/[id]/page.tsx');
  assert.equal((page.match(/<LegacyRiskBadge value=\{agent\.(risk_level|ai_act_risk_class)\} \/>/g) ?? []).length, 2);
  assert.doesNotMatch(page, />\s*\{agent\.(risk_level|ai_act_risk_class)\}\s*</);
});

test('O87 dashboard aggregates: the summary carries the legacy authority marker and the page labels every legacy aggregate', () => {
  const repo = source('repositories/dashboard.ts');
  assert.match(repo, /legacyRiskAuthority: typeof LEGACY_RISK_LABEL/);
  assert.match(repo, /legacyRiskAuthority: LEGACY_RISK_LABEL,/);
  const page = source('app/(dashboard)/page.tsx');
  assert.match(page, /Legacy High-Risk Agent Labels/); assert.match(page, /Legacy High-Risk AI System Labels/);
  assert.match(page, /Legacy Risk Label Distribution/); assert.match(page, /<LegacyRiskBadge value=\{gap\.risk_level\} \/>/);
  assert.doesNotMatch(page, /label="High Risk Agents"|label="High-Risk AI Systems"|>\s*Risk Distribution\s*</);
});

test('O87 reports: report data and every PDF section label legacy risk as LEGACY / NON-AUTHORITATIVE', () => {
  const repo = source('repositories/reports.ts');
  assert.equal((repo.match(/legacyRiskAuthority: LEGACY_RISK_LABEL/g) ?? []).length, 2);
  const pdf = source('services/reports.ts');
  assert.match(pdf, /Legacy Risk Label Distribution \(\$\{LEGACY_RISK_LABEL\}\)/);
  assert.match(pdf, /4\. Legacy Risk Labels \(\$\{LEGACY_RISK_LABEL\}\)/);
  assert.doesNotMatch(pdf, /"Risk Distribution"|"4\. Risk Classification"|agents classified as high risk|row\("High-Risk (Systems|Agents)"/);
});

test('O87 search: agent / system results carry the legacy authority marker and render the labelled badge', async () => {
  tableRows.agents = [{ agent_id: 'a1', agent_code: 'AG-1', name: 'Fixture', description: '', risk_level: 'high', status: 'active' }];
  tableRows.ai_systems = [{ system_id: 's1', system_code: 'SYS-1', name: 'Fixture system', description: '', risk_class: 'high', status: 'active' }];
  tableRows.ict_incidents = [];
  const { searchAll } = await import('../repositories/search');
  const results = await searchAll('org-1', 'Fixture');
  assert.equal(results.length, 2);
  for (const r of results) assert.equal(r.risk_level_authority, LABEL);
  assert.match(source('app/(dashboard)/search/page.tsx'), /<LegacyRiskBadge value=\{r\.risk_level\} \/>/);
  delete tableRows.agents; delete tableRows.ai_systems; delete tableRows.ict_incidents;
});

test('O87 knowledge-graph overlay: agent nodes and legacy-risk-inferred edges carry the legacy marker', async () => {
  tableRows.agents = [{ agent_id: 'a1', agent_code: 'AG-1', name: 'Fixture', agent_type: 'assistive', risk_level: 'critical', status: 'active' }];
  tableRows.ict_incidents = [{ incident_id: 'i1', incident_code: 'INC-1', title: 'Incident', severity: 'high', status: 'open' }];
  const { getUnifiedGraph, isAgentNode } = await import('../services/knowledge-graph');
  const graph = await getUnifiedGraph('org-1');
  const agent = graph.nodes.find(n => isAgentNode(n)) as any;
  assert.equal(agent.risk_level, 'critical'); assert.equal(agent.risk_level_authority, LABEL);
  const inferred = graph.edges.filter((e: any) => e.type === 'affects');
  assert.ok(inferred.length >= 1);
  for (const edge of inferred as any[]) assert.deepEqual(edge.metadata, { basis: 'LEGACY_RISK_LABEL', authority: LABEL });
  assert.match(source('components/graph/ReactFlowGraph.tsx'), /<LegacyRiskBadge value=\{selectedNode\.risk_level\} \/>/);
  delete tableRows.agents; delete tableRows.ict_incidents;
});

test('O87 agents API: output and the ?risk= filter are declared legacy / non-authoritative', async () => {
  tableRows.agents = [{ agent_id: 'a1', risk_level: 'critical', ai_act_risk_class: 'high' }];
  const { GET } = await import('../app/api/agents/route');
  const response = await GET(new Request('http://fixture/api/agents?risk=critical'));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.legacyRiskAuthority, LABEL);
  assert.deepEqual(body.legacyRiskFields, ['risk_level', 'ai_act_risk_class']);
  assert.equal(body.legacyRiskFilter, 'critical');
  delete tableRows.agents;
});

test('O87 talk-to-governance / discovery review / agent form: legacy labels are never presented as governed risk', async () => {
  tableRows.agents = [];
  const { HANDLERS } = await import('../repositories/talk');
  const answer = await HANDLERS.find(h => h.name === 'high_risk_agents')!.handler('org-1');
  assert.ok(answer.answer.includes(LABEL)); assert.match(answer.answer, /UNKNOWN/);
  assert.doesNotMatch(answer.answer, /No high-risk or critical agents found/);
  delete tableRows.agents;
  assert.match(source('app/api/discovery/review/route.ts'), /legacyRiskAuthority: LEGACY_RISK_LABEL/);
  assert.match(source('app/(dashboard)/discovery/page.tsx'), /<LegacyRiskBadge value=\{a\.risk_level\} \/>/);
  const form = source('components/agents/AgentForm.tsx');
  assert.ok(form.includes(`Legacy risk label (${LABEL})`) && form.includes(`Legacy AI Act risk class (${LABEL})`));
});

test('O88 static: no L15 code reads a legacy risk surface', () => {
  const l15Sources = [
    readFileSync(join(root, 'packages/canonical-contracts/src/l15-risk-intelligence.ts'), 'utf8'),
    ...readFileSync(join(root, 'supabase/migrations/20261012200000_m17_s0_authority_policy_l15_extension_v1.sql'), 'utf8')
      .split(/CREATE FUNCTION gov_repo\.l15_/).slice(1).map(body => body.slice(0, body.indexOf('$guard$;') + 1 || body.indexOf('$map$;') + 1)),
  ];
  for (const text of l15Sources) {
    assert.doesNotMatch(text, /risk_entries|risk_treatments|agent_risk_propagation|risk_refs|residual_risk_level|\brisk_level\b|ai_act_risk_class/);
  }
});
