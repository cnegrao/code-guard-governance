import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import * as scanner from '../../src/index';
import * as productionProvider from '../../src/semantic/embedding-provider';

import { buildSemanticContentProjection, computeSemanticContentFingerprint } from '../../src/semantic/content-projection';
import { TestOnlyDeterministicEmbeddingProvider } from './test-only-deterministic-embedding-provider';

const projection = buildSemanticContentProjection({
  subjectKind: 'CANONICAL_OBJECT',
  objectKind: 'AGENT_VERSION',
  knownTechnicalFacts: [['runtimeFramework', 'LangGraph']],
});
const fingerprint = computeSemanticContentFingerprint(projection);

describe('TestOnlyDeterministicEmbeddingProvider', () => {
  it('is absent from production scanner exports, whose provider module contains only contracts', () => {
    assert.equal('TestOnlyDeterministicEmbeddingProvider' in scanner, false);
    assert.deepEqual(Object.keys(productionProvider), []);
    const index = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
    const provider = readFileSync(new URL('../../src/semantic/embedding-provider.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(index + provider, /TestOnlyDeterministicEmbeddingProvider|test\/semantic/);
    assert.doesNotMatch(provider, /\b(class|fetch)\b/);
  });

  it('is clearly labeled non-production', () => {
    const provider = new TestOnlyDeterministicEmbeddingProvider(4);
    assert.equal(provider.providerId, 'TEST_ONLY_DETERMINISTIC');
    assert.match(provider.modelId, /test-only/);
  });

  it('produces a vector matching its declared dimension', async () => {
    const provider = new TestOnlyDeterministicEmbeddingProvider(6);
    const result = await provider.embed(projection, fingerprint);
    assert.equal(result.vector.length, 6);
    for (const component of result.vector) {
      assert.ok(Number.isFinite(component));
    }
  });

  it('is deterministic: identical content fingerprint always produces the identical vector', async () => {
    const provider = new TestOnlyDeterministicEmbeddingProvider(8);
    const a = await provider.embed(projection, fingerprint);
    const b = await provider.embed(projection, fingerprint);
    assert.deepEqual(a.vector, b.vector);
  });

  it('a different content fingerprint produces a different vector', async () => {
    const provider = new TestOnlyDeterministicEmbeddingProvider(8);
    const otherProjection = buildSemanticContentProjection({
      subjectKind: 'CANONICAL_OBJECT',
      objectKind: 'AGENT_VERSION',
      knownTechnicalFacts: [['runtimeFramework', 'CrewAI']],
    });
    const otherFingerprint = computeSemanticContentFingerprint(otherProjection);
    const a = await provider.embed(projection, fingerprint);
    const b = await provider.embed(otherProjection, otherFingerprint);
    assert.notDeepEqual(a.vector, b.vector);
  });

  it('rejects a non-positive or non-integer dimension', () => {
    assert.throws(() => new TestOnlyDeterministicEmbeddingProvider(0));
    assert.throws(() => new TestOnlyDeterministicEmbeddingProvider(-1));
    assert.throws(() => new TestOnlyDeterministicEmbeddingProvider(1.5));
  });
});
