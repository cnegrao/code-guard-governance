import { analyzePackageJson, analyzeConfigs, analyzeSourceCode } from '../../../src/core/analyzer';
import { detectAgentFrameworks, buildAgentsFromFrameworkMatches } from '../../../src/core/agent-detector';
import { detectRisks } from '../../../src/core/risk-detector';
import { detectShadowAI } from '../../../src/core/shadow-ai';
import { scanCodeViolations } from '../../../src/core/violations';
import { aggregatePII } from '../../../src/core/enrichment/lgpd-pii';
import { classifyAllAgents, summarizeAIAct } from '../../../src/core/classifier';
import { certifySystem } from './legacy-certification-oracle';

export type RepositoryFiles = Record<string, string>;
const pkg = (dependencies = {}, scripts = {}, devDependencies = {}) => JSON.stringify({ name: 'fixture', dependencies, scripts, devDependencies });
export const repositories: Record<string, RepositoryFiles> = {
  none: { 'README.md': 'Source observation fixture' },
  bronze: { 'package.json': pkg({}, { test: 'vitest' }, { vitest: '1', eslint: '1' }) },
  silver: {
    'package.json': pkg({ openai: '1' }), 'README.md': 'Source observation fixture',
    'app/api/session/route.ts': 'export async function GET() { const session = await getServerSession(); return session; }',
  },
  gold: {
    'package.json': pkg({ openai: '1' }, {}, { vitest: '1' }),
    'README.md': 'Source observation fixture', 'LICENSE': 'fixture', '.env.example': 'EXAMPLE=value',
    'app/api/ai/route.ts': 'export async function GET() { const session = await getServerSession(); return session; }',
    'rate-limit.ts': '// source signal', 'helmet.ts': '// source signal', 'monitoring.ts': '// source signal',
  },
  platinum: {
    'package.json': pkg({ openai: '1' }, { test: 'vitest' }, { vitest: '1', eslint: '1' }),
    'README.md': 'Source observation fixture', 'LICENSE': 'fixture', '.env.example': 'EXAMPLE=value',
    'app/api/ai/route.ts': 'export async function GET() { const session = await getServerSession(); return session; }',
    'rate-limit.ts': '// source signal', 'helmet.ts': '// source signal', 'monitoring.ts': '// source signal',
    '.github/workflows/test.yml': 'name: fixture', 'audit-log.ts': '// source signal', 'Dockerfile': '# fixture',
    'incident-response.md': 'source signal',
  },
};

/** LEGACY_NON_AUTHORITATIVE test-only replay of the removed certification inputs.
 * Production detectors are used so the fixture's prior tier is proved, not guessed.
 * Framework/memory matches do not affect these fixtures' prior tier.
 */
export function replayLegacyTier(files: RepositoryFiles) {
  const contents = new Map(Object.entries(files));
  const tree = Object.keys(files);
  const packages = analyzePackageJson(files['package.json'] || null);
  const configs = analyzeConfigs(files['package.json'] || null, tree, null, null);
  const source = analyzeSourceCode(contents, tree, {});
  source.agents = buildAgentsFromFrameworkMatches(detectAgentFrameworks(contents));
  const shadow = detectShadowAI(contents, source);
  const risks = detectRisks(packages, configs, source, tree, shadow);
  const violations = scanCodeViolations(contents).violations;
  const pii = aggregatePII(contents);
  const ai = summarizeAIAct(classifyAllAgents(source.agents, source, packages));
  const hasPII = pii.piiExposure || pii.credentialExposure || pii.biometricExposure || pii.healthExposure || pii.financialExposure;
  const hasConsent = source.authPatterns.some(a => /consent/i.test(a)) || source.dataAssets.some(d => /consent/i.test(d.name));
  const statuses = [
    hasPII ? (hasConsent ? 'partial' : 'non_compliant') : 'not_applicable',
    ai.highRiskCount > 0 ? 'partial' : ai.totalAgents > 0 ? 'compliant' : 'not_applicable',
    violations.length > 0 ? 'partial' : 'not_applicable',
  ] as const;
  const overallScore = Math.round(
    (risks.length ? risks.filter(r => r.severity !== 'critical' && r.severity !== 'high').length / risks.length * 100 : 100) * 0.4 +
    (violations.length ? violations.filter(v => v.severity !== 'critical').length / violations.length * 100 : 100) * 0.3 +
    (shadow.length === 0 ? 100 : Math.max(0, 100 - shadow.length * 15)) * 0.3,
  );
  return certifySystem(source, risks, {
    applicableRegulations: statuses.map((status, i) => ({ id: String(i), name: 'historical fixture only', authority: '', status, requirements: [], evidenceFound: [], gaps: [] })),
    overallScore, summary: 'LEGACY_NON_AUTHORITATIVE test oracle only',
  }, packages);
}
