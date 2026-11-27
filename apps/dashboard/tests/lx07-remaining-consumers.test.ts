import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { OVERSIGHT_LIMITATION } from '../lib/agent-detail-dto';

type Row = Record<string, any>;
const ORG_A = 'org-a'; const ORG_B = 'org-b';
const LEVELS = ['l1_automated', 'l2_human_review', 'l3_human_approval', 'l4_human_in_loop', 'l4_human_in_charge', null, undefined, '', 'UNKNOWN', 'unrecognized'];
let organisationId = ORG_A; let denyAuth = false; let denyRead = false; let llmAvailable = false;
let modelAnswer = ''; let codingContext = '';
let tables: Record<string, Row[]>; let semanticRows: Row[];
const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
const prompts: Array<{ system: string; context: string; org: string }> = [];
const ledger: Row[] = [];
class AuthError extends Error {}
class LedgerError extends Error {}

function agent(org: string, level: unknown): Row {
  return { organisation_id: org, agent_id: `${org}-agent`, agent_code: `AG-${org}`, name: 'Same name',
    agent_type: 'autonomous', risk_level: 'high', oversight_level: level, status: 'active',
    cg_ag_007_oversight: true, cg_ag_012_autonomous_governed: true,
    external_refs: { oversight: { effectiveLevel: 'l4_human_in_charge', authority: 'AUTHORITATIVE' },
      ledger_payload: { oversight_level: 'l3_human_approval', secret: 'PRIVATE_SENTINEL' },
      controlStates: { cg_ag_007_oversight: 'passed' }, discovery: {
        oversightLevel: 'l4_human_in_charge', oversight: { authority: 'AUTHORITATIVE' },
        framework: 'openai', repository: 'fixture-repo', filePath: 'src/agent.ts', isAutonomous: true,
        summary: { governance_priority: { oversightLevel: 'l4_human_in_charge', secret: 'PRIVATE_SENTINEL' } },
        lineage: { containsPii: true, externalSinks: ['api.fixture.invalid'], containsCredentials: true },
        lgpd: { credentialExposure: true, findings: [{ severity: 'critical', message: 'Technical fixture' }] },
      } },
    oversight: { effectiveLevel: 'l4_human_in_charge', evidenceStatus: 'VERIFIED' },
  };
}

// In-memory read transport. Real routes, Talk service/repository and graph
// service/repository execute. Every table query must bind the verified tenant.
const db = { from(table: string) {
  const call = { table, filters: {} as Record<string, unknown> }; queries.push(call);
  let fields = '*'; let head = false; let maximum = Infinity;
  const predicates: Array<(row: Row) => boolean> = [];
  const query = {
    select(value: string, options?: { head?: boolean }) { fields = value; head = options?.head ?? false; return query; },
    eq(key: string, value: unknown) { call.filters[key] = value; predicates.push(row => row[key] === value); return query; },
    neq(key: string, value: unknown) { predicates.push(row => row[key] !== value); return query; },
    or() { return query; },
    in(key: string, values: unknown[]) { predicates.push(row => values.includes(row[key])); return query; },
    is(key: string, value: unknown) { predicates.push(row => (row[key] ?? null) === value); return query; },
    not() { return query; }, order() { return query; },
    limit(value: number) { maximum = value; return query; }, throwOnError() { return query; },
    async then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      try {
        assert.equal(call.filters.organisation_id ?? call.filters['control_assessments.organisation_id'], organisationId);
        if (denyRead) throw Error('READ_DENIED');
        const rows = (tables[table] ?? []).filter(row => predicates.every(predicate => predicate(row))).slice(0, maximum);
        const data = fields === '*' ? structuredClone(rows) : rows.map(row => Object.fromEntries(
          fields.split(',').map(key => key.trim()).filter(key => key in row).map(key => [key, structuredClone(row[key])])));
        return resolve({ data: head ? null : data, count: rows.length });
      } catch (error) { return reject(error); }
    },
    async maybeSingle() { assert.equal(call.filters.organisation_id, organisationId); return { data: null }; },
  };
  return query;
}, rpc(name: string, args: Row) {
  assert.equal(args.p_organisation_id, organisationId);
  assert.ok(['agent_compliance_gaps', 'agent_semantic_search'].includes(name));
  const data = name === 'agent_semantic_search' ? semanticRows : [{ agent_id: `${organisationId}-agent`, agent_code: `AG-${organisationId}`,
    total_gaps: 0, gap_cg_ag_007: false, oversight_level: 'l4_human_in_charge', external_refs: { secret: 'PRIVATE_SENTINEL' } }];
  return { async throwOnError() { if (denyRead) throw Error('READ_DENIED'); return { data: structuredClone(data) }; } };
} };

let talk: typeof import('../repositories/talk');
let graphRoute: typeof import('../app/api/graph/estate/route');
let talkRoute: typeof import('../app/api/talk-to-governance/route');
before(async () => {
  mock.module('../lib/db', { namedExports: { db: { write: db } } });
  mock.module('../lib/auth', { namedExports: {
    requireVerifiedGovernancePrincipal: async () => {
      if (denyAuth) throw new AuthError();
      return { organisationId, userId: 'fixture-user', issuedAtSeconds: 100, expiresAtSeconds: 200, credentialEpoch: '2026-10-20T00:00:00.123456Z' };
    }, SessionAuthenticationError: AuthError,
  } });
  mock.module('../lib/governance/ledger-write', { namedExports: {
    appendLedgerEvent: async (principal: Row, event: Row) => { assert.equal(principal.organisationId, organisationId); ledger.push(event); },
    LedgerWriteUnavailableError: LedgerError,
  } });
  mock.module('../lib/llm', { namedExports: {
    getLLMProvider: () => ({ available: llmAvailable, name: 'fixture', generateEmbedding: async () => [0.1] }),
    GOVERNANCE_SYSTEM_PROMPT: 'Fixture prompt',
  } });
  mock.module('../lib/runtime/openai-governance-answer-producer', { namedExports: {
    generateGovernanceAnswer: async (_provider: unknown, org: string, system: string, context: string) => {
      prompts.push({ org, system, context }); return modelAnswer;
    },
  } });
  mock.module('../services/coding-memory', { namedExports: { semanticSearch: async (org: string) => {
    assert.equal(org, organisationId); return codingContext;
  } } });
  talk = await import('../repositories/talk');
  graphRoute = await import('../app/api/graph/estate/route');
  talkRoute = await import('../app/api/talk-to-governance/route');
});
beforeEach(() => {
  organisationId = ORG_A; denyAuth = false; denyRead = false; llmAvailable = false; modelAnswer = ''; codingContext = '';
  tables = { agents: [agent(ORG_A, 'l1_automated'), agent(ORG_B, 'l4_human_in_loop')], agent_edges: [], ai_systems: [] };
  semanticRows = []; queries.length = 0; ledger.length = 0; prompts.length = 0;
});

function contained(row: Row, level: unknown, org = organisationId) {
  assert.equal(row.oversight_level, 'UNKNOWN');
  assert.deepEqual(row.oversight, { effectiveLevel: 'UNKNOWN', evidenceStatus: 'NOT_EVIDENCED', authority: 'NON_AUTHORITATIVE',
    recordedLevel: typeof level === 'string' ? level : null,
    source: { table: 'gov_repo.agents', field: 'oversight_level', organisationId: org, agentId: `${org}-agent` } });
  assert.ok(!('cg_ag_007_oversight' in row));
  assert.ok(!JSON.stringify(row).includes('PRIVATE_SENTINEL'));
}
const request = (query: string) => new Request('http://fixture/api/talk-to-governance', { method: 'POST',
  headers: { 'x-codeguard-org': ORG_B }, body: JSON.stringify({ query, organisationId: ORG_B }) });

test('Knowledge Graph / estate API projects every historical label, manual flag and nested payload without mutating storage', async () => {
  for (const level of [...LEVELS, 4, { secret: 'PRIVATE_SENTINEL' }]) {
    tables.agents[0].oversight_level = level; const original = structuredClone(tables);
    const response = await graphRoute.GET(); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.agentCount, 1);
    const row = body.nodes.find((node: Row) => node.agent_id); contained(row, level);
    assert.equal(body.authority, 'OPERATIONAL_LEGACY'); assert.equal(body.canonical, false);
    assert.equal(row.legacy_control_authority, 'LEGACY_NON_AUTHORITATIVE');
    assert.equal(row.legacy_control_states.cg_ag_007_oversight, 'passed');
    assert.deepEqual(row.external_refs, { discovery: { repository: 'fixture-repo', framework: 'openai', filePath: 'src/agent.ts', isAutonomous: true } });
    assert.deepEqual(tables, original);
  }
});

test('Knowledge Graph contains historical supervision relationships and failed manual control metadata', async () => {
  tables.agent_edges = [{ organisation_id: ORG_A, source_agent_id: `${ORG_A}-agent`, target_agent_id: `${ORG_A}-agent`, relationship_type: 'SUPERVISES', is_active: true }];
  tables.agents[0].external_refs.controlStates.cg_ag_007_oversight = 'failed';
  tables.ai_systems = [{ organisation_id: ORG_A, system_id: 'sys-a', name: 'System', cg_sys_006_human_oversight: true }];
  const body = await (await graphRoute.GET()).json();
  const supervision = body.edges.find((edge: Row) => edge.type === 'SUPERVISES');
  assert.equal(supervision.metadata.authority, 'LEGACY_NON_AUTHORITATIVE');
  assert.equal(supervision.metadata.basis, 'RECORDED_RELATIONSHIP_NOT_EFFECTIVE_SUPERVISION');
  const control = body.nodes.find((node: Row) => node.label === 'cg_ag_007_oversight');
  assert.equal(control.metadata.authority, 'LEGACY_NON_AUTHORITATIVE');
  assert.equal(body.edges.find((edge: Row) => edge.target === control.id).metadata.authority, 'LEGACY_NON_AUTHORITATIVE');
  const system = body.nodes.find((node: Row) => node.nodeType === 'ai_system');
  assert.ok(!('cg_sys_006_human_oversight' in system.metadata));
  assert.equal(system.metadata.legacy_control_states.cg_sys_006_human_oversight, 'passed');
  const agentNode = body.nodes.find((node: Row) => node.agent_id);
  assert.equal(agentNode.legacy_control_states.cg_ag_007_oversight, 'failed');
  contained(agentNode, 'l1_automated');
});

test('F1 recorded control states take precedence consistently in agent/system nodes, derived edges and Talk payloads', async () => {
  const cases = [
    { flag: true, recorded: 'failed', expected: 'failed' },
    { flag: false, recorded: undefined, expected: 'not_assessed' },
    { flag: true, recorded: undefined, expected: 'passed' },
    { flag: true, recorded: 'waived', expected: 'waived' },
    { flag: true, recorded: 'not_assessed', expected: 'not_assessed' },
    { flag: false, recorded: 'passed', expected: 'passed' },
    { flag: false, recorded: 'failed', expected: 'failed' },
    { flag: true, recorded: 'invalid', expected: 'not_assessed' },
    { flag: false, recorded: 'invalid', expected: 'not_assessed' },
    { flag: true, recorded: '', expected: 'passed' },
    { flag: false, recorded: { state: 'failed' }, expected: 'not_assessed' },
    { flag: true, recorded: { state: 'failed' }, expected: 'not_assessed' },
    { flag: null, recorded: undefined, expected: 'not_assessed' },
    { flag: undefined, recorded: undefined, expected: 'not_assessed' },
  ];
  for (const { flag, recorded, expected } of cases) {
    const storedAgent = agent(ORG_A, 'l3_human_approval');
    storedAgent.cg_ag_007_oversight = flag; storedAgent.cg_ag_002_owner = flag;
    storedAgent.external_refs.controlStates = recorded === undefined ? {} : {
      cg_ag_007_oversight: recorded, cg_ag_002_owner: recorded,
    };
    tables.agents = [storedAgent];
    tables.ai_systems = [{ organisation_id: ORG_A, system_id: 'sys-a', name: 'System', status: 'active',
      cg_sys_006_human_oversight: flag, cg_sys_005_risk_mgmt: flag, cg_sys_007_conformity: false,
      external_refs: { controlStates: recorded === undefined ? {} : {
        cg_sys_006_human_oversight: recorded, cg_sys_005_risk_mgmt: recorded,
      } } }];
    const original = structuredClone(tables);
    const response = await graphRoute.GET(); assert.equal(response.status, 200);
    const graph = await response.json();
    const agentNode = graph.nodes.find((node: Row) => node.agent_id);
    const systemNode = graph.nodes.find((node: Row) => node.id === 'sys-a');
    contained(agentNode, 'l3_human_approval');
    assert.equal(agentNode.legacy_control_states.cg_ag_007_oversight, expected);
    assert.equal(systemNode.metadata.legacy_control_states.cg_sys_006_human_oversight, expected);
    assert.equal(agentNode.legacy_control_authority, 'LEGACY_NON_AUTHORITATIVE');
    assert.equal(systemNode.metadata.legacy_control_authority, 'LEGACY_NON_AUTHORITATIVE');
    assert.ok(!('cg_sys_006_human_oversight' in systemNode.metadata));
    for (const [entityId, key] of [
      [`${ORG_A}-agent`, 'cg_ag_007_oversight'], [`${ORG_A}-agent`, 'cg_ag_002_owner'],
      ['sys-a', 'cg_sys_006_human_oversight'], ['sys-a', 'cg_sys_005_risk_mgmt'],
    ]) {
      const control = graph.nodes.find((node: Row) => node.nodeType === 'control' && node.label === key);
      const relations = graph.edges.filter((edge: Row) => edge.type === 'violates' && edge.source === entityId && edge.target === control?.id);
      assert.equal(relations.length, expected === 'failed' ? 1 : 0, `${key}: ${String(recorded)} / ${String(flag)}`);
      assert.equal(Boolean(control), expected === 'failed', key);
      if (control) {
        assert.equal(control.metadata.authority, 'LEGACY_NON_AUTHORITATIVE');
        assert.equal(relations[0].metadata.authority, 'LEGACY_NON_AUTHORITATIVE');
      }
    }
    const agentAnswer = await (await talkRoute.POST(request('personal data agents'))).json();
    assert.equal(agentAnswer.intent, 'personal_data_agents');
    assert.deepEqual(agentAnswer.supportingData[0], agentNode);
    const systemAnswer = await (await talkRoute.POST(request('systems failing conformity'))).json();
    assert.equal(systemAnswer.intent, 'systems_failing_conformity');
    assert.deepEqual(systemAnswer.supportingData[0], systemNode);
    const violations = await (await talkRoute.POST(request('which controls fail'))).json();
    assert.equal(violations.intent, 'violating_controls');
    assert.equal(violations.supportingData.length, expected === 'failed' ? 1 : 0);
    if (expected === 'failed') assert.deepEqual(violations.supportingData[0], agentNode);
    assert.deepEqual(tables, original);
  }
});

test('derived graph evidence text and Talk evidence responses cannot repeat a historical oversight claim as proof', async () => {
  tables.agents[0].external_refs.discovery.evidence = ['Oversight: l4_human_in_charge; supervision proven'];
  const body = await (await graphRoute.GET()).json();
  const evidence = body.nodes.find((node: Row) => node.nodeType === 'evidence');
  assert.equal(evidence.metadata.matchText, OVERSIGHT_LIMITATION);
  assert.equal(evidence.metadata.authority, 'DERIVED_NON_AUTHORITATIVE');
  assert.equal(body.edges.find((edge: Row) => edge.source === evidence.id).metadata.authority, 'DERIVED_NON_AUTHORITATIVE');
  const answer = await talk.executeQuery(organisationId, 'what evidence supports risk');
  assert.ok(!JSON.stringify(answer).includes('l4_human_in_charge'));
  assert.ok(!JSON.stringify(answer).includes('supervision proven'));
});

test('Talk high-risk and autonomous answers, citations and supporting data never promote L1-L4 or governed flags', async () => {
  for (const level of LEVELS) {
    tables.agents[0].oversight_level = level;
    for (const query of ['high risk agents', 'autonomous agents']) {
      const response = await talkRoute.POST(request(query)); assert.equal(response.status, 200);
      const body = await response.json(); contained(body.supportingData[0], level);
      assert.match(body.answer, /UNKNOWN \/ NOT_EVIDENCED \/ NON_AUTHORITATIVE/);
      assert.match(body.answer, /Historical label \(unverified\)/);
      assert.match(body.citations[0].detail, /UNKNOWN.*unverified/);
      assert.doesNotMatch(body.answer, /\d+\/\d+ governed\./);
      assert.ok(!JSON.stringify(body).includes('PRIVATE_SENTINEL'));
    }
  }
});

test('Talk routes supervision questions deterministically including mixed high-risk questions and Portuguese', async () => {
  llmAvailable = true; modelAnswer = 'L4 supervision is proven';
  for (const query of ['Which high risk agents have L4 oversight?', 'Existe supervisão humana?', 'human-in-the-loop agents', 'Are agents human controlled?', 'Does CG-AG-007 prove control?']) {
    const body = await (await talkRoute.POST(request(query))).json();
    assert.equal(body.intent, 'oversight'); assert.match(body.answer, /UNKNOWN.*NOT_EVIDENCED/);
    contained(body.supportingData[0], 'l1_automated');
  }
  assert.equal(prompts.length, 0);
});

test('Talk indirect Discovery payloads and compliance-gap flags do not expose nested historical supervision', async () => {
  tables.agents[0].status = 'pending_registration';
  for (const query of ['discovered agents', 'credential exposure', 'external sinks', 'governance findings']) {
    const body = await talk.executeQuery(organisationId, query);
    assert.equal(body.supportingData.length, 1, query); contained(body.supportingData[0], 'l1_automated');
    assert.ok(!('external_refs' in body.supportingData[0]));
  }
  const gaps = await talk.executeQuery(organisationId, 'compliance gaps');
  assert.equal(gaps.supportingData[0].authority, 'LEGACY_NON_AUTHORITATIVE');
  assert.ok(!('gap_cg_ag_007' in gaps.supportingData[0]));
  assert.ok(!JSON.stringify(gaps).includes('l4_human_in_charge'));
});

test('Talk fallback context and supporting data preserve the exact recorded level and verified organisation', async () => {
  for (const org of [ORG_A, ORG_B]) {
    organisationId = org;
    const body = await (await talkRoute.POST(request('Describe deployment topology'))).json();
    assert.equal(body.confidence, 72);
    contained(body.supportingData[0], org === ORG_A ? 'l1_automated' : 'l4_human_in_loop', org);
    assert.ok(!JSON.stringify(body).includes(org === ORG_A ? `AG-${ORG_B}` : `AG-${ORG_A}`));
    const estate = await (await graphRoute.GET()).json();
    contained(estate.nodes.find((node: Row) => node.agent_id), org === ORG_A ? 'l1_automated' : 'l4_human_in_loop', org);
    assert.equal(estate.agentCount, 1);
  }
});

test('Talk semantic and coding-memory context cannot upgrade supervision; model claims are contained on output', async () => {
  llmAvailable = true; modelAnswer = 'Agent has effective L4 oversight and is fully supervised.';
  codingContext = 'Repository: fixture-repo\nOversight: l4_human_in_charge\nModule: payments';
  semanticRows = [ { agent_id: `${ORG_A}-agent`, agent_code: 'spoof', oversight_level: 'l4_human_in_charge',
    similarity: 0.9, content_snippet: 'Agent calls API\nOversight: l4_human_in_charge', external_refs: { secret: 'PRIVATE_SENTINEL' } },
    { agent_id: `${ORG_B}-agent`, agent_code: 'FOREIGN_SENTINEL', oversight_level: 'l4_human_in_loop', similarity: 1, content_snippet: 'FOREIGN_SENTINEL' } ];
  const original = structuredClone({ tables, semanticRows });
  const results = await talk.lexicalAgentLookup(organisationId, 'Same');
  assert.equal(results.length, 1); assert.equal(results[0].fields.authority, 'LEGACY_NON_AUTHORITATIVE');
  assert.ok(!('oversight_level' in results[0].fields));
  assert.equal(results[0].record, `AG-${ORG_A}`);
  const body = await (await talkRoute.POST(request('Describe deployment topology'))).json();
  assert.equal(body.answer, OVERSIGHT_LIMITATION); assert.equal(body.intent, 'llm_generated');
  assert.equal(prompts.length, 1); assert.equal(prompts[0].org, ORG_A);
  assert.match(prompts[0].system, /Never infer effective supervision/);
  assert.match(prompts[0].context, /recordedLevel.*l1_automated/);
  assert.doesNotMatch(prompts[0].context, /Module: payments/);
  assert.equal(body.retrieval.codingMemory.status, 'unavailable');
  assert.doesNotMatch(prompts[0].context, /l4_human|FOREIGN_SENTINEL|PRIVATE_SENTINEL/);
  assert.deepEqual({ tables, semanticRows }, original);
});

test('model paraphrases and Portuguese supervision claims are bounded while unrelated model answers remain compatible', async () => {
  llmAvailable = true;
  for (const text of ['Agents are human controlled.', 'A supervisão humana está comprovada.', 'CG-AG-007 proves the agents are governed.']) {
    modelAnswer = text;
    const body = await (await talkRoute.POST(request('Describe deployment topology'))).json();
    assert.equal(body.answer, OVERSIGHT_LIMITATION);
  }
  for (const text of ['The agent calls the payments API.', 'Human resources agent calls the staffing API.']) {
    modelAnswer = text;
    assert.equal((await (await talkRoute.POST(request('Describe deployment topology'))).json()).answer, modelAnswer);
  }
});

test('empty, denied and unauthenticated reads never manufacture positive supervision or query another tenant', async () => {
  tables.agents = [];
  const empty = await (await talkRoute.POST(request('oversight'))).json();
  assert.match(empty.answer, /UNKNOWN.*NOT_EVIDENCED/); assert.deepEqual(empty.supportingData, []);
  denyRead = true;
  assert.equal((await graphRoute.GET()).status, 500);
  assert.equal((await talkRoute.POST(request('oversight'))).status, 500);
  denyRead = false; denyAuth = true; queries.length = 0;
  assert.equal((await graphRoute.GET()).status, 401);
  assert.equal((await talkRoute.POST(request('oversight'))).status, 401);
  assert.equal(queries.length, 0);
});
