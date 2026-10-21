import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import * as scanner from '../../src/index';
import type { ScannerResult, UnifiedScanResult } from '../../src/index';

test('actual package export surface has no certification capability', () => {
  assert.equal('certifySystem' in scanner, false);
  assert.equal(typeof scanner.Scanner, 'function');
  assert.equal(typeof scanner.DiscoveryPipeline, 'function');
  assert.equal(typeof scanner.detectRisks, 'function');
  assert.equal(typeof scanner.aggregatePII, 'function');
  assert.equal(typeof scanner.scanCodeViolations, 'function');
  assert.equal(existsSync(resolve('src/core/certification.ts')), false);
});

test('active producer and public type/export boundary cannot restore the old model', () => {
  for (const path of ['src/index.ts', 'src/unified.ts', 'src/core/types.ts']) {
    const source = readFileSync(resolve(path), 'utf8');
    assert.doesNotMatch(source, /certifySystem|CertificationResult|certResult|\bcertification\s*[:?]|certLevel|complianceScore|\bbronze\b|\bsilver\b|\bgold\b|\bplatinum\b|kind:\s*['"]certificate['"]|certType/);
  }
  const unified = readFileSync(resolve('src/unified.ts'), 'utf8');
  assert.doesNotMatch(unified, /criticalPct|highPct|overallScore|ComplianceAnalysis|complianceAnalysis/);
});

test('public types reject removed fields and old exports at compile time', () => {
  function typeContract(result: UnifiedScanResult, core: ScannerResult) {
    // @ts-expect-error no active public certification API
    scanner.certifySystem;
    // @ts-expect-error old result type is no longer exported
    const oldType: import('../../src/index').CertificationResult = {};
    // @ts-expect-error no inferred credential collection
    result.certificates;
    // @ts-expect-error no tier result
    result.certResult;
    // @ts-expect-error no aggregate assurance score
    result.summary.complianceScore;
    // @ts-expect-error no assurance tier
    result.summary.certLevel;
    // @ts-expect-error core scanner contract also excludes tier authority
    core.certification;
    // @ts-expect-error each technical collection allowlists its entity kind
    result.evidence.push({ id: 'inferred', kind: 'certificate', label: 'inferred' });
    // @ts-expect-error envelope must not permit affirmative authority
    const authority: UnifiedScanResult['analysisBoundary']['authority'] = 'CERTIFIED';
    return [oldType, authority];
  }
  assert.equal(typeof typeContract, 'function');
});
