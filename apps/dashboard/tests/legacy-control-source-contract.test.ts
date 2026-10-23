import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { projectAgent, projectSystem } from '../lib/legacy-control-dto';
import type { Agent } from '../types/agents';
import type { AISystem } from '../types/systems';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const aggregates = /\b(?:compliance_score|complianceRate|cgSysComplianceRate|evidenceCoverage|computeScore|computeCompliance|computeCgSysComplianceRate|computeEvidenceCoverage)\b/;
test('L01/LX02 active routes, services, DTOs and UI have no aggregate computation, types or aliases', () => {
  for (const path of ['services/agents.ts', 'services/systems.ts', 'services/dashboard.ts', 'repositories/dashboard.ts',
    'types/agents.ts', 'types/systems.ts', 'lib/legacy-control-dto.ts',
    'app/api/agents/route.ts', 'app/api/agents/[id]/route.ts', 'app/api/systems/route.ts', 'app/api/systems/[id]/route.ts',
    'app/api/dashboard/summary/route.ts', 'app/(dashboard)/page.tsx',
    'app/(dashboard)/agents/page.tsx', 'components/agents/AgentTable.tsx',
    'app/(dashboard)/agents/[id]/page.tsx', 'app/(dashboard)/systems/[id]/page.tsx',
    'components/agents/LegacyControlRecordsPanel.tsx']) assert.doesNotMatch(read(path), aggregates, path);
  const dashboard = read('repositories/dashboard.ts');
  assert.doesNotMatch(dashboard, /systemComplianceScore|evCount|agCount|gapCount\s*\/|totalScore/);
  assert.doesNotMatch(read('repositories/agents.ts'), /agent_compliance_gaps/, 'detail never exposes the raw gap RPC row');
});
test('public allowlists discard known and future DB columns, including nested manual controls', () => {
  for (const project of [projectAgent, projectSystem]) {
    const value = project({ name: 'Retained inventory', cg_ag_unknown: true, cg_sys_unknown: true,
      external_refs: { controlStates: { fake: 'passed' }, other: 'not public' },
      compliance_score: 100, readiness: 'READY', future: 'do not serialize' } as never);
    const serialized = JSON.stringify(value);
    assert.equal(value.name, 'Retained inventory');
    assert.doesNotMatch(serialized, /cg_ag_|cg_sys_|controlStates|external_refs|compliance|readiness|future/);
  }
});
test('public types reject raw flags, controlStates and aggregate scores at compile time', () => {
  function typeContract(agent: Agent, system: AISystem) {
    // @ts-expect-error raw flags belong only to internal storage rows
    agent.cg_ag_001_registered;
    // @ts-expect-error aggregate assurance field was removed
    agent.compliance_score;
    // @ts-expect-error raw flags belong only to internal storage rows
    system.cg_sys_001_registered;
    // @ts-expect-error external_refs/controlStates cannot leak from a public system
    system.external_refs;
  }
  assert.equal(typeof typeContract, 'function');
});
test('real active consumers use legacy fields; neutral panel has no aggregate percentage/positive treatment', () => {
  const panel = read('components/agents/LegacyControlRecordsPanel.tsx');
  assert.doesNotMatch(panel, /%|text-success|bg-success|text-green|bg-green|<Badge|\bscore\b|\bCompliancePanel\b/);
  assert.match(panel, /RECORDED_PASS/); assert.match(panel, /RECORDED_WAIVED/);
  for (const family of ['agents', 'systems']) {
    const page = read(`app/(dashboard)/${family}/[id]/page.tsx`);
    assert.match(page, /data\.legacy_control_states/); assert.match(page, /data\.legacy_control_gaps/);
    assert.match(page, /Legacy Control Records/);
    assert.doesNotMatch(page, /data\.compliance|>\s*Compliance\s*</);
  }
  const home = read('app/(dashboard)/page.tsx');
  assert.doesNotMatch(home, /Legacy Control Coverage|Top Compliance Gaps|Total Governance Gaps|All CG-AG controls|cColor/);
  assert.match(home, /Recorded Legacy Control Gaps/);
  assert.match(home, /This does not establish compliance/);
  // The retained CSS width is categorical risk-distribution layout, not a public assurance ratio.
  assert.equal((home.match(/%/g) ?? []).length, 1);
  assert.match(home, /width: `\$\{data\.totalAgents > 0 \? \(item\.value \/ data\.totalAgents\) \* 100 : 0\}%`/);
  const table = read('components/agents/AgentTable.tsx');
  assert.doesNotMatch(table, /compliancePct|complianceColor|cg_ag_|%|>Compliance</);
  assert.doesNotMatch(read('app/(dashboard)/agents/page.tsx'), /compliance status/);
});
