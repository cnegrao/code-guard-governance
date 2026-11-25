import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyseFinOps, type FinOpsResult } from '../../../packages/scanner/src/codeguard/enrichment/finops';
import { enrichAgent, enrichSummary } from '../../../packages/scanner/src/codeguard/enrichment';
import { classifyAgent } from '../../../packages/scanner/src/codeguard/classifier';
import { FINOPS_FLAG_RULES, finOpsToSignals } from '../../../packages/scanner/src/l15/finops-signal-adapter';
import type { DiscoveredAgent, EnrichmentData } from '../../../packages/scanner/src/codeguard/types';
import type { EnrichmentData as DashboardEnrichment } from '../lib/discovery/types';

const agent: DiscoveredAgent = {
  name: 'worker', filePath: 'src/worker.ts', framework: 'openai', agentType: 'assistive',
  confidence: 55, evidence: ['OpenAI SDK source pattern'], suggestedRiskLevel: 'low',
  suggestedOversightLevel: 'l1_automated', isAutonomous: false, capabilities: ['OpenAI SDK'],
};
const boundary = {
  kind: 'HEURISTIC', authority: 'QUARANTINED', observedCostState: 'UNKNOWN', evidenceState: 'NOT_EVIDENCED',
};
const source = `import OpenAI from 'openai';
  async function load(ids) { for (const id of ids) { await client.get(id); } }
  const rows = await db.select('*'); openai.chat.completions.create({});`;
const context = {
  organisationId: '00000000-0000-4000-8000-000000000017', intakeKeyPrefix: 'lx04-scan',
  subject: { mode: 'CANONICAL_OBJECT', kind: 'AGENT_VERSION', canonicalObjectId: 'canonical-object:av' },
  detectorVersion: '1.0.0', evidence: [{ tag: 'DISCOVERY_EVIDENCE', targetId: 'evidence:scan-1' }],
} as const;

test('all five source signals survive, with legacy monetary values explicitly quarantined', async () => {
  const result = analyseFinOps(source);
  for (const rule of Object.values(FINOPS_FLAG_RULES)) assert.equal(result[rule.flag], true, rule.flag);
  assert.equal(result.monthlyCostEstimate, 520, 'preserve the legacy 320 OpenAI + 200 Database estimate');
  assert.equal(result.costRisk, 'critical');
  assert.deepEqual(result.costEvidence, boundary);
  assert.deepEqual(result.breakdown.map(item => [item.category, item.estimatedMonthly, item.confidence, item.callCount]), [
    ['LLM API (OpenAI)', 320, 55, 1], ['Database', 200, 55, 1],
  ]);
  for (const item of result.breakdown) assert.deepEqual(item.costEvidence, boundary);

  const enrichment = await enrichAgent(agent, source);
  const summary = enrichSummary(agent, enrichment);
  assert.equal(summary.monthly_cost_estimate, result.monthlyCostEstimate);
  assert.deepEqual(summary.monthly_cost_estimate_evidence, boundary);
  // Existing numeric contracts remain assignable for both public Discovery type surfaces.
  const scannerPublic: EnrichmentData = { ...enrichment, summary };
  const dashboardPublic: DashboardEnrichment = scannerPublic;
  const legacyAmount: number = dashboardPublic.summary.monthly_cost_estimate;
  assert.equal(legacyAmount, 520);
});

test('unknown observed cost never becomes zero, even when the legacy heuristic returns zero', async () => {
  const enrichment = await enrichAgent(agent, 'const x = 1;');
  assert.equal(enrichment.finops.monthlyCostEstimate, 0, 'legacy numeric compatibility only');
  assert.deepEqual(enrichment.finops.breakdown, []);
  assert.deepEqual(enrichment.finops.costEvidence, boundary);
  assert.equal(enrichSummary(agent, enrichment).monthly_cost_estimate_evidence.observedCostState, 'UNKNOWN');
  assert.deepEqual(finOpsToSignals(enrichment.finops, context), []);
});

for (const sensitiveSource of ['', 'const cpf = 1;']) {
  test(`presumed infrastructure costs alone cannot increase compliance exposure${sensitiveSource ? ' alongside a PII signal' : ''}`, async () => {
    const baseline = await enrichAgent(agent, sensitiveSource);
    const costly = await enrichAgent(agent, `${sensitiveSource}\nconst infrastructure = 'kubernetes kafka redis lambda';`);
    assert.equal(baseline.finops.costRisk, 'low');
    assert.equal(costly.finops.costRisk, 'critical');
    assert.ok(costly.finops.monthlyCostEstimate > 500);
    assert.ok(Object.values(FINOPS_FLAG_RULES).every(rule => !costly.finops[rule.flag]));
    assert.equal(costly.complianceExposure, sensitiveSource ? 'low' : 'none');
    assert.equal(costly.complianceExposure, baseline.complianceExposure);
    assert.equal(costly.complianceConfidence, baseline.complianceConfidence);
    assert.deepEqual(classifyAgent(agent, costly), classifyAgent(agent, baseline));
    assert.equal(enrichSummary(agent, costly).compliance_exposure, baseline.complianceExposure);
  });
}

test('classification and L15 signals are invariant to estimate, cost-risk and hotspot changes', async () => {
  const enrichment = await enrichAgent(agent, source);
  const expectedClassification = classifyAgent(agent, enrichment);
  const expectedSignals = finOpsToSignals(enrichment.finops, context);
  assert.equal(expectedSignals.length, 5);
  for (const costRisk of ['low', 'medium', 'high', 'critical'] as const) {
    const modified = { ...enrichment, finops: {
      ...enrichment.finops, monthlyCostEstimate: 987654321, costRisk,
      costHotspots: ['FINANCIAL_CLAIM_SENTINEL $987654321/mo'],
      breakdown: enrichment.finops.breakdown.map(item => ({ ...item, estimatedMonthly: 123456789, confidence: 100 })),
    } };
    assert.deepEqual(classifyAgent(agent, modified), expectedClassification);
    assert.deepEqual(finOpsToSignals(modified.finops, context), expectedSignals);
  }
  const reasoning = expectedClassification.reasoning.join('\n');
  assert.doesNotMatch(reasoning, /\$|\/mo|FinOps risk:|FINANCIAL_CLAIM_SENTINEL|987654321/);
  for (const rule of Object.values(FINOPS_FLAG_RULES)) {
    const line = expectedClassification.reasoning.find(text => text.includes(rule.observation));
    assert.ok(line, rule.flag);
    assert.match(line, /INFERRED \/ NON_AUTHORITATIVE/);
    assert.ok(line.endsWith(rule.signalKind === 'DETECTED_ABSENCE' ? 'not detected.' : 'pattern detected.'));
  }
  for (const signal of expectedSignals) {
    assert.equal(signal.trustState, 'INFERRED');
    assert.equal(signal.hintSeverity, null);
    assert.equal(signal.hintConfidence, null);
    assert.deepEqual(signal.subject, context.subject);
    assert.deepEqual(signal.support, context.evidence);
    assert.equal(signal.organisationId, context.organisationId);
    assert.doesNotMatch(JSON.stringify(signal), /monthlyCostEstimate|estimatedMonthly|costEvidence|costRisk|costHotspots|breakdown/);
  }
});

test('cost boundary objects are independent and cannot contaminate another result, breakdown or summary', async () => {
  const enrichment = await enrichAgent(agent, source);
  const summary = enrichSummary(agent, enrichment);
  (enrichment.finops.costEvidence as { authority: string }).authority = 'FORGED';
  assert.deepEqual(enrichment.finops.breakdown[0].costEvidence, boundary);
  assert.deepEqual(summary.monthly_cost_estimate_evidence, boundary);
  assert.deepEqual(analyseFinOps(source).costEvidence, boundary);
});

test('the existing L15 input contract still accepts legacy callers without the additive cost metadata', () => {
  const current = analyseFinOps(source);
  const { costEvidence: _boundary, ...legacyFields } = current;
  const legacy: FinOpsResult = {
    ...legacyFields,
    breakdown: current.breakdown.map(({ category, estimatedMonthly, confidence, callCount }) => ({ category, estimatedMonthly, confidence, callCount })),
  };
  assert.equal(legacy.costEvidence, undefined);
  assert.deepEqual(finOpsToSignals(legacy, context), finOpsToSignals(current, context));
});
