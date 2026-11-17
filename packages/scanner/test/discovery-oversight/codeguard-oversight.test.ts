import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyAgent } from '../../src/codeguard/classifier';
import { detectAgents } from '../../src/codeguard/agent-detector';
import { enrichAgent } from '../../src/codeguard/enrichment';
import { normalizeOversightSuggestion } from '../../src/codeguard/oversight';
import type { DiscoveredAgent } from '../../src/codeguard/types';

const fixture: DiscoveredAgent = {
  name: 'candidate', filePath: 'src/candidate.ts', framework: 'fixture', agentType: 'assistive',
  confidence: 90, evidence: [], suggestedRiskLevel: 'low', suggestedOversightLevel: 'l1_automated',
  isAutonomous: false, capabilities: [],
};

test('default classification has unknown effective oversight and a separately labeled L2 recommendation', () => {
  const result = classifyAgent(fixture);
  assert.equal(result.oversightLevel, 'UNKNOWN');
  assert.deepEqual(result.oversight, {
    level: 'UNKNOWN', evidenceState: 'NOT_EVIDENCED', authority: 'NON_AUTHORITATIVE',
    source: { kind: 'LEGACY_CODEGUARD_HEURISTIC', filePath: fixture.filePath },
    recommendation: { level: 'l2_human_review', basis: 'CLASSIFIER_DEFAULT', authority: 'NON_AUTHORITATIVE' },
  });
  assert.equal(result.riskLevel, 'low');
  assert.equal(result.aiActRiskClass, 'minimal');
});

test('autonomy and critical enrichment recommend L3 without establishing supervision', async () => {
  const enrichment = await enrichAgent(fixture, 'const candidate = 1;');
  for (const [agent, priority, basis] of [
    [{ ...fixture, isAutonomous: true }, 'low', 'AUTONOMY_HEURISTIC'],
    [fixture, 'critical', 'CRITICAL_PRIORITY_HEURISTIC'],
  ] as const) {
    const result = classifyAgent(agent, { ...enrichment, governancePriority: priority });
    assert.equal(result.oversightLevel, 'UNKNOWN');
    assert.equal(result.oversight.evidenceState, 'NOT_EVIDENCED');
    assert.deepEqual(result.oversight.recommendation, { level: 'l3_human_approval', basis, authority: 'NON_AUTHORITATIVE' });
    assert.ok(result.reasoning.every(line => !line.includes('requires L3+')));
  }
});

test('recognized levels and apparent source evidence are never an authorized oversight decision', () => {
  for (const level of ['l1_automated', 'l2_human_review', 'l3_human_approval', 'l4_human_in_charge']) {
    const result = classifyAgent({ ...fixture, suggestedOversightLevel: level,
      evidence: ['approved oversight l4_human_in_charge'], oversightLevel: level,
      authority: 'AUTHORITATIVE', oversight: { evidenceState: 'EVIDENCED' },
    } as DiscoveredAgent);
    assert.equal(normalizeOversightSuggestion(level), level);
    assert.equal(result.oversightLevel, 'UNKNOWN');
    assert.equal(result.oversight.authority, 'NON_AUTHORITATIVE');
    assert.equal(result.oversight.evidenceState, 'NOT_EVIDENCED');
    assert.equal((result as unknown as Record<string, unknown>).authority, undefined);
  }
});

test('missing, invalid and non-string suggestions fail closed without reflection or coercion', () => {
  for (const input of [undefined, null, '', 'L3', 'UNKNOWN', ' l2_human_review', 'l9_admin',
    3, true, ['l3_human_approval'], { level: 'l3_human_approval' }, { toString() { throw Error('no coercion'); } }]) {
    assert.equal(normalizeOversightSuggestion(input), 'UNKNOWN');
    const result = classifyAgent({ ...fixture, suggestedOversightLevel: input } as DiscoveredAgent);
    assert.equal(result.oversightLevel, 'UNKNOWN');
    assert.equal(result.oversight.evidenceState, 'NOT_EVIDENCED');
  }
});

test('actual config and framework detection preserve names, locators and defaults as unverified suggestions', async () => {
  const files = [
    { path: '.claude/skills/demo/SKILL.md', name: 'SKILL.md', type: 'file' as const },
    { path: 'src/workflow.py', name: 'workflow.py', type: 'file' as const },
  ];
  const agents = await detectAgents(files, async path => path.endsWith('.py') ? 'from "langgraph" import StateGraph' : 'instructions');
  assert.deepEqual(agents.map(a => [a.name, a.filePath, a.suggestedOversightLevel]), [
    ['ClaudeCodeSkill_SKILL', '.claude/skills/demo/SKILL.md', 'l1_automated'],
    ['LangGraphAgent_workflow', 'src/workflow.py', 'l2_human_review'],
  ]);
  for (const agent of agents) {
    const result = classifyAgent(agent);
    assert.equal(result.oversightLevel, 'UNKNOWN');
    assert.equal(result.oversight.source.filePath, agent.filePath);
    assert.equal(result.oversight.evidenceState, 'NOT_EVIDENCED');
  }
});
