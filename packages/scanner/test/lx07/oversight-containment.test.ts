import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { analyzePackageJson, analyzeSourceCode } from '../../src/core/analyzer';
import { classifyAgent, type AgentClassification } from '../../src/core/classifier';
import { projectScannerOversight, type OversightLevel } from '../../src/core/oversight';
import { Scanner, classifyAllAgents, summarizeAIAct, detectAgentFrameworks, buildAgentsFromFrameworkMatches } from '../../src/index';
import type { DetectedAgent } from '../../src/index';

const source = analyzeSourceCode(new Map(), [], {});
const packages = analyzePackageJson(null);
const agent = (overrides: Partial<DetectedAgent> = {}): DetectedAgent => ({
  name: 'Neutral Agent', type: 'service', tools: [], models: [], riskLevel: 'low', critical: false, ...overrides,
});
function classify(input: DetectedAgent) { return classifyAgent(input, source, packages); }
function assertUnknown(value: ReturnType<typeof projectScannerOversight>) {
  assert.equal(value.level, 'UNKNOWN');
  assert.equal(value.evidenceState, 'NOT_EVIDENCED');
  assert.equal(value.authority, 'NON_AUTHORITATIVE');
  assert.equal(value.source.kind, 'LEGACY_SCANNER_HEURISTIC');
}

test('absence of oversight evidence never defaults to automated or a negative oversight determination', () => {
  const result = classify(agent());
  assert.equal(result.oversightLevel, 'UNKNOWN');
  assertUnknown(result.oversight);
  assert.equal(result.oversight.recommendation, null);
  assert.equal(result.oversight.source.filePath, null);
  assert.equal(result.agentId, 'neutral-agent');
  assert.equal(result.agentName, 'Neutral Agent');
  assert.equal(result.riskCategory, 'low');
  assert.equal(result.aiActCategory, 'minimal');
  assert.equal(result.domain, 'general');
  assert.match(result.evidence.join(' '), /UNKNOWN \(NOT_EVIDENCED\)/);
});

for (const level of ['l1_automated', 'l2_human_review', 'l3_human_approval', 'l4_human_in_charge'] as const) {
  test(`recognized legacy input ${level} remains an unverified recommendation`, () => {
    const input = agent({ oversightLevel: level, filePath: 'src/worker.ts' });
    const before = structuredClone(input);
    const result = classify(input);
    assertUnknown(result.oversight);
    assert.equal(result.oversightLevel, 'UNKNOWN');
    assert.deepEqual(result.oversight.recommendation, { level, basis: 'UNVERIFIED_LEGACY_INPUT' });
    assert.equal(result.oversight.source.filePath, 'src/worker.ts');
    assert.deepEqual(input, before, 'classification does not rewrite a legacy record');
  });
}

for (const level of ['', 'FULL', 'CERTIFIED', 'l5_override', 'private-token-must-not-be-reflected']) {
  test(`unsupported oversight input is not cast to an accepted level (${level || 'empty'})`, () => {
    const result = classify(agent({ oversightLevel: level }));
    assertUnknown(result.oversight);
    assert.equal(result.oversight.recommendation, null);
    if (level) assert.equal(JSON.stringify(result).includes(level), false);
  });
}

for (const [input, level, basis] of [
  [{ critical: true }, 'l3_human_approval', 'CRITICAL_AGENT_HEURISTIC'],
  [{ riskLevel: 'high' }, 'l2_human_review', 'HIGH_RISK_HEURISTIC'],
  [{ isAutonomous: true }, 'l3_human_approval', 'AUTONOMY_HEURISTIC'],
] as const) {
  test(`${basis} remains advisory without establishing human oversight`, () => {
    const result = classify(agent(input));
    assertUnknown(result.oversight);
    assert.equal(result.oversightLevel, 'UNKNOWN');
    assert.deepEqual(result.oversight.recommendation, { level, basis });
    assert.doesNotMatch(result.evidence.join(' '), /requires human (?:approval|review)/i);
    assert.equal(summarizeAIAct([result]).requiresHumanOversight, 'UNKNOWN');
  });
}

test('framework detection preserves names and source location while moving its default out of observed oversight', () => {
  const files = new Map([['src/workflow.py', 'from langgraph.graph import StateGraph\ngraph = StateGraph(dict)']]);
  const agents = buildAgentsFromFrameworkMatches(detectAgentFrameworks(files));
  const detected = agents.find(a => a.framework === 'LangGraph')!;
  assert.ok(detected);
  assert.equal(detected.name, 'LangGraph_workflow');
  assert.equal(detected.filePath, 'src/workflow.py');
  assert.equal(detected.oversightLevel, 'UNKNOWN');
  assert.equal(detected.oversightSuggestion, 'l2_human_review');
  const result = classifyAllAgents(agents, source, packages).find(a => a.agentName === detected.name)!;
  assert.equal(result.agentId, 'langgraph-workflow');
  assertUnknown(result.oversight);
  assert.deepEqual(result.oversight.recommendation, { level: 'l2_human_review', basis: 'FRAMEWORK_DEFAULT' });
  assert.equal(result.oversight.source.filePath, 'src/workflow.py');
});

test('empty, mixed, or supplied positive classifications never establish applicability', () => {
  const mixed = classifyAllAgents([agent(), agent({ name: 'High', riskLevel: 'high' }), agent({ name: 'Legacy', oversightLevel: 'l4_human_in_charge' })], source, packages);
  for (const classifications of [[], mixed, [{ ...mixed[0], oversightLevel: 'l4_human_in_charge' } as unknown as AgentClassification]]) {
    assert.equal(summarizeAIAct(classifications).requiresHumanOversight, 'UNKNOWN');
  }
});

test('classification instances do not share recommendations or propagate arbitrary input fields', () => {
  const first = classify(agent({ critical: true }));
  const other = classify({ ...agent({ name: 'Other' }), organisationId: 'foreign-tenant', canonicalObjectId: 'forged', secret: 'private-fixture-value' } as DetectedAgent);
  first.oversight.recommendation!.level = 'l1_automated';
  assert.equal(other.oversight.recommendation, null);
  assert.equal(other.oversight.source.filePath, null);
  assert.doesNotMatch(JSON.stringify(other), /foreign-tenant|forged|private-fixture-value|canonicalObjectId/);
  assert.equal(classify(agent({ critical: true })).oversight.recommendation!.level, 'l3_human_approval');
});

test('runtime non-string input cannot become oversight evidence or a recommendation', () => {
  for (const value of [null, false, 123, { level: 'l4_human_in_charge' }, ['l3_human_approval']]) {
    const result = classify(agent({ oversightLevel: value as unknown as string }));
    assertUnknown(result.oversight);
    assert.equal(result.oversight.recommendation, null);
  }
});

test('the actual local Scanner and graph projection expose UNKNOWN with bounded provenance and perform no egress', async t => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw Error('NO_EGRESS'); });
  const directory = await mkdtemp(join(tmpdir(), 'govia-lx07-'));
  try {
    await writeFile(join(directory, 'workflow.py'), 'from langgraph.graph import StateGraph\ngraph = StateGraph(dict)');
    const scanner = new Scanner();
    const result = await scanner.scan({ type: 'local', path: directory });
    assert.ok(result.agents.length > 0);
    assert.equal(result.analysisBoundary.authority, 'NON_AUTHORITATIVE');
    for (const node of result.agents) {
      assert.equal(node.attrs?.oversightLevel, 'UNKNOWN');
      const observation = node.attrs?.oversight as ReturnType<typeof projectScannerOversight>;
      assertUnknown(observation);
      assert.equal(observation.source.filePath, 'workflow.py');
      assert.equal(observation.recommendation?.basis, 'FRAMEWORK_DEFAULT');
      for (const graph of [scanner.toGraph(result), scanner.toGraph()]) {
        assert.deepEqual(graph.entities.get(node.id)?.attrs?.oversight, observation);
      }
    }
    assert.equal(network.mock.callCount(), 0);
    // Cleanup targets only the exact directory returned by mkdtemp under tmpdir().
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('public classification types reject affirmative levels and boolean oversight determinations', () => {
  function typeContract(classification: AgentClassification) {
    // @ts-expect-error recommendations cannot inhabit effective oversight
    const actual: AgentClassification['oversightLevel'] = 'l1_automated';
    // @ts-expect-error absence is not a negative applicability result
    const required: ReturnType<typeof summarizeAIAct>['requiresHumanOversight'] = false;
    // @ts-expect-error invalid recommendations are outside the closed vocabulary
    const recommendation: OversightLevel = 'CERTIFIED';
    return [classification, actual, required, recommendation];
  }
  assert.equal(typeof typeContract, 'function');
});
