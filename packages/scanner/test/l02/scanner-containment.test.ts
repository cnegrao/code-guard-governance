import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { Scanner, SCANNER_ANALYSIS_BOUNDARY, aggregatePII, analyzeSourceCode } from '../../src/index';
import type { UnifiedScanResult } from '../../src/index';
import { repositories, replayLegacyTier, type RepositoryFiles } from './fixtures/repositories';

async function scanAcquiredFixture(scanner: Scanner, files: RepositoryFiles) {
  // Only acquisition is controlled: actual analysis, detection, mapping and result builders run.
  // This represents a complete remote acquisition, including .env.example (unsupported by the local loader).
  Object.defineProperty(scanner, 'loadFiles', { value: async () => ({
    files: Object.keys(files).map(path => ({ path, name: path.split('/').pop(), type: 'file', size: files[path].length })),
    fileContents: new Map(Object.entries(files)), fileTree: Object.keys(files), languages: {},
  }) });
  return scanner.scan({ type: 'github', url: 'https://github.com/fixture/observations' });
}

async function withRepository(files: RepositoryFiles, run: (path: string) => Promise<void>) {
  const path = await mkdtemp(join(tmpdir(), 'govia-l02-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = join(path, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await run(path);
  } finally {
    // The path is the exact directory returned by mkdtemp under the OS temp directory.
    await rm(path, { recursive: true, force: true });
  }
}

function assertBounded(result: UnifiedScanResult, scanner: Scanner) {
  assert.deepEqual(result.analysisBoundary, SCANNER_ANALYSIS_BOUNDARY);
  assert.equal(result.analysisBoundary.analysisKind, 'HEURISTIC');
  assert.equal(result.analysisBoundary.authority, 'NON_AUTHORITATIVE');
  assert.deepEqual(result.analysisBoundary.limitations, ['NOT_CERTIFICATION', 'NOT_COMPLIANCE_DETERMINATION', 'NOT_ASSURANCE']);
  assert.match(result.analysisBoundary.interpretation, /Absence of a finding is not proof of satisfaction/);
  assert.deepEqual(Object.keys(result).sort(), [
    'analysisBoundary', 'acquisition', 'source', 'agents', 'decisions', 'tools', 'models', 'risks', 'evidence',
    'regulations', 'dataAssets', 'controls', 'incidents', 'owners', 'prompts', 'relationships', 'summary',
  ].sort());
  assert.deepEqual(result.summary, { totalAgents: result.agents.length, totalRisks: result.risks.length, totalEvidence: result.evidence.length });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /"(?:certResult|certification|certificates|certLevel|complianceScore|overallScore|levels|readiness|score)"\s*:/);
  assert.doesNotMatch(serialized, /"(?:bronze|silver|gold|platinum|CERTIFIED|ATTESTED|valid|compliant|ready)"/i);
  for (const engine of [scanner.toGraph(result), scanner.toGraph()]) {
    assert.equal(engine.getEntitiesByKind('certificate').length, 0);
    for (const entity of engine.entities.values()) {
      assert.deepEqual(entity.attrs?.analysisBoundary, SCANNER_ANALYSIS_BOUNDARY);
      assert.notEqual(entity.attrs?.certType, 'SOC2');
    }
  }
}

for (const [tier, files] of Object.entries(repositories)) {
  test(`repository previously qualifying ${tier} yields bounded observations only`, async () => {
    assert.equal(replayLegacyTier(files).overall, tier, 'frozen historical algorithm proves the fixture precondition');
    const scanner = new Scanner();
    const result = await scanAcquiredFixture(scanner, files);
    assertBounded(result, scanner);
    assert.ok(result.evidence.length > 0);
    assert.equal(result.acquisition.analyzedFiles, Object.keys(files).length);
  });
}

test('empty repository and no source never become a positive state; reused scanner drops prior observations', async () => {
  const scanner = new Scanner();
  await withRepository(repositories.platinum, async path => { await scanner.scan({ type: 'local', path }); });
  await withRepository({}, async path => {
    const result = await scanner.scan({ type: 'local', path });
    assertBounded(result, scanner);
    assert.equal(result.summary.totalRisks, 0);
    assert.equal(result.summary.totalEvidence, 0);
    assert.match(result.acquisition.limitations.join(' '), /No files acquired/);
  });
  assertBounded(await scanner.scan({ type: 'github' }), scanner);
});

test('zero detected risks with CI, tests and audit file still produce no assurance', async () => {
  const scanner = new Scanner();
  const result = await scanAcquiredFixture(scanner, { ...repositories.platinum, 'vendor.md': 'source signal' });
  assertBounded(result, scanner);
  assert.equal(result.risks.length, 0);
  assert.ok(result.evidence.some(e => e.attrs?.source === 'audit-log.ts'));
});

test('high risk, agent and model observations remain available without credential inference', async () => {
  await withRepository({ 'agent.ts': "import { Agent } from '@openai/agents';\nconst agent = new Agent({ name: 'Support', instructions: 'Observe' });\nconst model = 'gpt-4o';" }, async path => {
    const scanner = new Scanner();
    const result = await scanner.scan({ type: 'local', path });
    assertBounded(result, scanner);
    assert.ok(result.risks.some(r => r.attrs?.severity === 'critical'));
    assert.ok(result.agents.length > 0);
    assert.ok(result.models.length > 0);
    assert.ok(result.evidence.some(e => e.attrs?.source === 'agent.ts'));
  });
});

test('PII with consent remains a detected technical signal, never satisfaction', async () => {
  const files = { 'data.ts': "const customer = { cpf: 'fixture' };\nconst consent = true;\nsupabase.from('customer_consent').select('cpf');" };
  const contents = new Map(Object.entries(files));
  assert.ok(aggregatePII(contents).findings.length > 0);
  const source = analyzeSourceCode(contents, Object.keys(files), {});
  assert.ok(source.dataAssets.some(d => d.hasPII));
  assert.ok(source.dataAssets.some(d => /consent/i.test(d.name)));
  await withRepository(files, async path => {
    const scanner = new Scanner();
    const result = await scanner.scan({ type: 'local', path });
    assertBounded(result, scanner);
    assert.ok(result.risks.length > 0);
  });
});

test('partial acquisition identifies unread files and does not invent evidence for them', async () => {
  await withRepository({ 'README.md': 'readable', 'oversize.ts': ' '.repeat(500000) }, async path => {
    const scanner = new Scanner();
    const result = await scanner.scan({ type: 'local', path });
    assertBounded(result, scanner);
    assert.deepEqual(result.acquisition.unreadFiles, ['oversize.ts']);
    assert.equal(result.acquisition.discoveredFiles, 2);
    assert.equal(result.acquisition.analyzedFiles, 1);
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].attrs?.source, 'README.md');
  });
});

test('missing local source rejects rather than issuing an affirmative scan result', async () => {
  await withRepository({}, async path => {
    await assert.rejects(new Scanner().scan({ type: 'local', path: join(path, 'missing') }), { code: 'ENOENT' });
  });
});
