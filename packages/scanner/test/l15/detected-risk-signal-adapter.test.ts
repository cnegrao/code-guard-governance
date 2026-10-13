import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { L15_SIGNAL_KINDS, l15SignalObservationPresentation, type L15SupportRef } from '@council/canonical-contracts';
import { detectRisks } from '../../src/core/risk-detector';
import type { DetectedRisk } from '../../src/core/types';
import { analyseFinOps } from '../../src/codeguard/enrichment/finops';
import {
  DETECTED_RISK_RULES, SCANNER_DETECTED_RISK_METHOD_PREFIX, detectedRiskToSignal, presentDetectedRiskRule,
} from '../../src/l15/detected-risk-signal-adapter';
import { FINOPS_FLAG_RULES, finOpsToSignals } from '../../src/l15/finops-signal-adapter';

const ORG = '00000000-0000-4000-8000-000000000017';
const SUBJECT = { mode: 'CANONICAL_OBJECT', kind: 'AGENT_VERSION', canonicalObjectId: 'canonical-object:av' } as const;
const EVIDENCE: readonly L15SupportRef[] = [{ tag: 'DISCOVERY_EVIDENCE', targetId: 'evidence:scan-1' }];
const ctx = (id: string) => ({ organisationId: ORG, intakeKey: `scan-1:${id}`, subject: SUBJECT, detectorVersion: '1.0.0', evidence: EVIDENCE });

/** Every key of a value, recursively (to prove a command carries no domain / rating / amount / text field). */
const keys = (value: unknown, out = new Set<string>()): Set<string> => {
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.add(k); keys(v, out); }
  return out;
};
const FORBIDDEN_KEYS = ['domain', 'riskDomain', 'category', 'rating', 'ratingBand', 'score', 'riskLevel', 'status', 'lifecycle',
  'cgagControl', 'control', 'title', 'description', 'recommendation', 'owner', 'amount', 'cost', 'estimate', 'monthlyCostEstimate',
  'estimatedMonthly', 'costRisk', 'governedRisk', 'proposal', 'decision'];

/** A real detector run whose inputs trigger every one of the 30 current rules. */
function allRulesRun(): DetectedRisk[] {
  const routes = ['/api/a', '/api/b', '/api/c', '/api/d'].map(path => ({ path, authRequired: false }));
  return detectRisks(
    { aiDependencies: ['openai'], paymentDependencies: ['stripe'], hasTestFramework: false,
      dependencies: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`dep-${i}`, '1.0.0'])) } as never,
    { hasLicense: false, hasReadme: false, hasCICD: false, hasEnvExample: false, hasDocker: false, typescript: { strict: false } } as never,
    { authPatterns: ['process.env.KEY', 'debug'], apiRoutes: routes, dataAssets: [{ name: 'users', hasPII: true }],
      aiModels: [{ provider: 'openai', modelId: 'gpt' }], databaseTables: ['users'], fileTree: ['src/index.ts'], externalServices: [] } as never,
    [], [{ governed: false } as never]);
}

describe('M17-S1 scanner DetectedRisk -> RISK_SIGNAL adapter (O16)', () => {
  it('the closed rule table covers exactly the 30 current DetectedRisk rule ids of the detector source', () => {
    const source = readFileSync(new URL('../../src/core/risk-detector.ts', import.meta.url), 'utf8');
    const ids = [...source.matchAll(/id: '(RISK-[A-Z0-9-]+)'/g)].map(m => m[1]).sort();
    assert.equal(ids.length, 30);
    assert.deepEqual(Object.keys(DETECTED_RISK_RULES).sort(), ids);
  });

  it('a real detector run producing all 30 rules maps each to DETECTED_PATTERN / DETECTED_ABSENCE with hint_severity only', () => {
    const risks = allRulesRun();
    assert.deepEqual(risks.map(r => r.id).sort(), Object.keys(DETECTED_RISK_RULES).sort(), 'fixture covers all 30 rule ids');
    const categories = new Set<string>();
    for (const risk of risks) {
      categories.add(risk.category);
      const command = detectedRiskToSignal(risk, ctx(risk.id));
      assert.ok(command.signalKind === 'DETECTED_PATTERN' || command.signalKind === 'DETECTED_ABSENCE', risk.id);
      assert.equal(command.signalKind, DETECTED_RISK_RULES[risk.id as keyof typeof DETECTED_RISK_RULES].signalKind);
      assert.equal(command.sourceClass, 'SYSTEM_DETECTOR');
      assert.equal(command.trustState, 'INFERRED');
      assert.equal(command.methodId, `${SCANNER_DETECTED_RISK_METHOD_PREFIX}${risk.id}`);
      assert.equal(command.methodVersion, '1.0.0');
      assert.equal(command.hintSeverity, risk.severity, 'severity -> hint_severity only');
      assert.equal(command.hintConfidence, null, 'DetectedRisk carries no confidence; none is invented');
      assert.equal(command.observedAt, null, 'no observation time is defaulted');
      assert.deepEqual(command.support, EVIDENCE);
      const present = keys(command);
      for (const forbidden of FORBIDDEN_KEYS) assert.ok(!present.has(forbidden), `${risk.id}: no ${forbidden}`);
      // The serialized command never carries the category label or the scanner's free text / CG-AG control.
      const text = JSON.stringify(command);
      assert.ok(!text.includes(risk.title) && !text.includes(risk.recommendation), risk.id);
      if (risk.cgagControl) assert.ok(!text.includes(risk.cgagControl), `${risk.id}: cgagControl stays informational`);
      for (const label of ['"legal"', '"compliance"', '"financial"', '"architectural"', '"security"', '"operational"']) {
        assert.ok(!text.includes(label), `${risk.id}: no category label ${label}`);
      }
    }
    for (const category of ['legal', 'compliance', 'financial', 'architectural']) assert.ok(categories.has(category), category);
  });

  it('no domain is generated for legal / compliance / financial / architectural (nor any other) category', () => {
    for (const risk of allRulesRun().filter(r => ['legal', 'compliance', 'financial', 'architectural'].includes(r.category))) {
      const command = detectedRiskToSignal(risk, ctx(risk.id)) as unknown as Record<string, unknown>;
      assert.equal(command.domain, undefined);
      assert.equal(command.riskDomain, undefined);
      assert.ok(!['PRIVACY', 'CYBERSECURITY', 'AUTHORIZATION', 'AUTONOMY', 'MODEL', 'DATA', 'CONNECTIVITY', 'OPERATIONAL', 'FINOPS']
        .some(domain => JSON.stringify(command).includes(`"${domain}"`)), risk.id);
    }
  });

  it('unversioned detector, missing evidence and unknown rule ids are rejected', () => {
    const risk = allRulesRun()[0];
    assert.throws(() => detectedRiskToSignal(risk, { ...ctx(risk.id), detectorVersion: '' }), /DETECTOR_VERSION_REQUIRED/);
    assert.throws(() => detectedRiskToSignal(risk, { ...ctx(risk.id), evidence: [] }), /SCANNER_EVIDENCE_REQUIRED/);
    assert.throws(() => detectedRiskToSignal({ ...risk, id: 'RISK-INVENTED' }, ctx('x')), /SCANNER_RULE_UNKNOWN/);
    assert.throws(() => detectedRiskToSignal(risk, { ...ctx(risk.id), evidence: [{ tag: 'RUNTIME_OBSERVATION', targetId: 'x' }] }),
      /SUPPORT_TAG_NOT_ADMISSIBLE/, 'scanner evidence is source evidence, never a runtime row');
  });

  it('DETECTED_ABSENCE presents literally as "not detected", never as absent / failed / non-compliant', () => {
    assert.equal(l15SignalObservationPresentation('DETECTED_ABSENCE'), 'not detected');
    assert.equal(L15_SIGNAL_KINDS.filter(k => l15SignalObservationPresentation(k) === 'not detected').length, 1);
    for (const [ruleId, rule] of Object.entries(DETECTED_RISK_RULES)) {
      const text = presentDetectedRiskRule(ruleId);
      if (rule.signalKind === 'DETECTED_ABSENCE') assert.match(text, /: not detected$/, ruleId);
      assert.doesNotMatch(text, /\b(absent|missing|fail(ed)?|not[_ ]satisfied|false|non[- ]compliant|violation)\b/i, ruleId);
    }
  });
});

describe('M17-S1 FinOps adapter (O17)', () => {
  const content = `async function load(ids) { for (const id of ids) { await fetch('https://api/' + id); } }
    const rows = await db.select('*'); openai.chat.completions.create({}); redis.get('k');`;

  it('emits pattern-flag signals only; no estimated amount, breakdown, confidence or cost-risk is carried', () => {
    const result = analyseFinOps(content);
    assert.ok(result.monthlyCostEstimate > 0, 'the heuristic estimate exists in the scanner output');
    const commands = finOpsToSignals(result, { organisationId: ORG, intakeKeyPrefix: 'finops-1', subject: SUBJECT, detectorVersion: '1.0.0', evidence: EVIDENCE });
    const expected = Object.entries(FINOPS_FLAG_RULES).filter(([, r]) => result[r.flag] === true).map(([id]) => id).sort();
    assert.ok(expected.length >= 2);
    assert.deepEqual(commands.map(c => c.methodId.replace('SCANNER_FINOPS:', '')).sort(), expected);
    for (const command of commands) {
      assert.ok(command.signalKind === 'DETECTED_PATTERN' || command.signalKind === 'DETECTED_ABSENCE');
      assert.equal(command.hintSeverity, null, 'costRisk is estimate-derived and never becomes a hint');
      assert.equal(command.hintConfidence, null);
      const present = keys(command);
      for (const forbidden of FORBIDDEN_KEYS) assert.ok(!present.has(forbidden), forbidden);
      const text = JSON.stringify(command);
      assert.ok(!text.includes(String(result.monthlyCostEstimate)), 'the estimate never appears');
      for (const item of result.breakdown) assert.ok(!text.includes(`:${item.estimatedMonthly}`), item.category);
      assert.ok(!/cost|amount|monthly|estimate/i.test(Object.keys(command).join(',')));
    }
  });

  it('no flag -> no signal; evidence and detector version are mandatory', () => {
    const quiet = analyseFinOps('const x = 1;');
    assert.deepEqual(finOpsToSignals(quiet, { organisationId: ORG, intakeKeyPrefix: 'q', subject: SUBJECT, detectorVersion: '1', evidence: EVIDENCE }), []);
    assert.throws(() => finOpsToSignals(quiet, { organisationId: ORG, intakeKeyPrefix: 'q', subject: SUBJECT, detectorVersion: '1', evidence: [] }));
    assert.throws(() => finOpsToSignals(quiet, { organisationId: ORG, intakeKeyPrefix: 'q', subject: SUBJECT, detectorVersion: '', evidence: EVIDENCE }));
  });
});
