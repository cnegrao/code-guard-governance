import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'node:fs';

const org = '11111111-1111-4111-8111-111111111111';
const requests: URL[] = [];
let failedTable = '';
const client = createClient('https://fixture.invalid', 'server-fixture', {
  db: { schema: 'gov_repo' }, auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer server-fixture');
    if (url.pathname.endsWith('/' + failedTable)) return new Response(JSON.stringify({ message: 'fixture read denied' }), { status: 403 });
    if (url.pathname.includes('/rpc/')) {
      assert.equal(JSON.parse(String(init?.body)).p_organisation_id, org);
    } else {
      const tenant = url.searchParams.get('organisation_id') ?? url.searchParams.get('control_assessments.organisation_id');
      assert.equal(tenant, `eq.${org}`, `unbound read: ${url}`);
    }
    return new Response('[]', { headers: { 'content-type': 'application/json', 'content-range': '*/0' } });
  } },
});
let dashboard: typeof import('../repositories/dashboard');
let reports: typeof import('../repositories/reports');
let agents: typeof import('../repositories/agents');
let systems: typeof import('../repositories/systems');
let search: typeof import('../repositories/search');
before(async () => {
  mock.module('../lib/auth', { namedExports: {
    requireVerifiedGovernancePrincipal: async () => ({ organisationId: org }),
    SessionAuthenticationError: class extends Error {},
  } });
  mock.module('../lib/db', { namedExports: { db: { write: client, read: { from() { throw Error('ANON_READ_FORBIDDEN'); } } } } });
  dashboard = await import('../repositories/dashboard'); reports = await import('../repositories/reports');
  agents = await import('../repositories/agents'); systems = await import('../repositories/systems');
  search = await import('../repositories/search');
});
test('product reads use server credentials and tenant predicates, including findings parent join', async () => {
  failedTable = ''; requests.length = 0;
  await dashboard.getDashboardData(org); await reports.gatherReportData(org);
  await agents.getAgents(org); await systems.getSystems(org);
  await search.searchAll(org, 'fixture');
  assert.ok(requests.some(u => u.pathname.endsWith('/control_findings') && u.searchParams.get('select')?.includes('control_assessments!inner')));
  assert.ok(requests.some(u => u.pathname.endsWith('/governance_ledger')));
});
test('empty inventory has no favourable coverage score; unassessed and waived controls have no score', async () => {
  failedTable = '';
  const empty = await dashboard.getDashboardData(org);
  assert.equal(empty.complianceRate, null);
  assert.equal(empty.cgSysComplianceRate, null);
  assert.equal(empty.evidenceCoverage, null);
  const report = await reports.gatherReportData(org);
  assert.equal(report.compliance.rate, null);
  assert.equal(report.compliance.controlCoverage, null);
  for (const service of [await import('../services/agents'), await import('../services/systems')]) {
    assert.equal(service.computeScore({} as never), null);
    assert.equal(service.computeScore({ a: 'not_assessed', b: 'waived' } as never), null);
    assert.equal(service.computeScore({ a: 'passed', b: 'failed' } as never), 50);
    assert.equal(service.computeScore({ a: 'passed' } as never), 100);
  }
});
test('Discovery promotion and regulatory exports are blocked at API ingress without a database write', async () => {
  requests.length = 0;
  const discovery = await import('../app/api/discovery/review/route');
  assert.equal((await discovery.PUT()).status, 409);
  for (const route of [await import('../app/api/reports/executive/route'), await import('../app/api/reports/ai-act/route'), await import('../app/api/reports/dora/route')]) {
    const response = await route.GET();
    assert.equal(response.status, 409);
    assert.equal((await response.json()).status, 'NOT_ASSESSED');
  }
  assert.equal(requests.length, 0);
});
test('permission failures never become empty product populations or favourable reports', async () => {
  for (const table of ['agents', 'ai_systems', 'control_findings', 'governance_ledger']) {
    failedTable = table;
    await assert.rejects(dashboard.getDashboardData(org));
    if (table !== 'governance_ledger') await assert.rejects(reports.gatherReportData(org));
  }
  failedTable = 'agents'; await assert.rejects(agents.getAgents(org));
  failedTable = 'ai_systems'; await assert.rejects(systems.getSystems(org));
  failedTable = '';
});
test('supporting memory reads reject unavailable legacy storage and Talk never infers universal compliance', async () => {
  const memory = await import('../repositories/coding-memory');
  failedTable = 'coding_memory'; await assert.rejects(memory.getRepositoryMemory(org, 'repo'), /read failed/);
  failedTable = 'coding_memory_search'; await assert.rejects(memory.searchSimilar(org, [1]), /read failed/);
  failedTable = '';
  const talk = await import('../repositories/talk');
  for (const query of ['compliance gaps', 'agents without owner', 'systems without conformity']) {
    const result = await talk.executeQuery(org, query);
    assert.doesNotMatch(result.answer, /All agents|All AI systems|fully compliant|All pass/);
    assert.equal(result.explanation.source, 'operational_legacy');
  }
});
test('all product consumers have left the anonymous database boundary; service client is server-only', () => {
  function check(directory: URL) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) check(file);
      else if (/\.tsx?$/.test(entry.name)) assert.doesNotMatch(readFileSync(file, 'utf8'), /db\.read\b/, file.pathname);
    }
  }
  for (const directory of ['repositories', 'services', 'app']) check(new URL(`../${directory}/`, import.meta.url));
  assert.match(readFileSync(new URL('../lib/db.ts', import.meta.url), 'utf8'), /^import "server-only";/);
  const config = readFileSync(new URL('../../../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /^schemas\s*=\s*\[[^\n]*"gov_repo"/m);
  assert.match(config, /^max_rows\s*=\s*1000\s*$/m);
});
