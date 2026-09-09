import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SEMANTIC_CONTENT_PROJECTION_SCHEMA_VERSION,
  buildSemanticContentProjection,
  computeSemanticContentFingerprint,
} from '../../src/semantic/content-projection';

function projectionInput(facts: ReadonlyArray<readonly [string, string]>, objectKind = 'AGENT_VERSION') {
  return {
    subjectKind: 'CANONICAL_OBJECT' as const,
    objectKind,
    knownTechnicalFacts: facts,
  };
}

describe('buildSemanticContentProjection / computeSemanticContentFingerprint', () => {
  it('is deterministic: identical semantic input produces the identical fingerprint', () => {
    const a = computeSemanticContentFingerprint(buildSemanticContentProjection(projectionInput([['runtimeFramework', 'LangGraph']])));
    const b = computeSemanticContentFingerprint(buildSemanticContentProjection(projectionInput([['runtimeFramework', 'LangGraph']])));
    assert.equal(a.value, b.value);
    assert.equal(a.schemaVersion, SEMANTIC_CONTENT_PROJECTION_SCHEMA_VERSION);
  });

  it('fact insertion/traversal order does not affect the fingerprint', () => {
    const a = computeSemanticContentFingerprint(
      buildSemanticContentProjection(projectionInput([['b', '2'], ['a', '1']])),
    );
    const b = computeSemanticContentFingerprint(
      buildSemanticContentProjection(projectionInput([['a', '1'], ['b', '2']])),
    );
    assert.equal(a.value, b.value);
  });

  it('a genuine semantic field change produces a different fingerprint', () => {
    const a = computeSemanticContentFingerprint(buildSemanticContentProjection(projectionInput([['runtimeFramework', 'LangGraph']])));
    const b = computeSemanticContentFingerprint(buildSemanticContentProjection(projectionInput([['runtimeFramework', 'CrewAI']])));
    assert.notEqual(a.value, b.value);
  });

  it('sorts distinct values under the same key independently of traversal order', () => {
    const a = buildSemanticContentProjection(projectionInput([['tool', 'B'], ['tool', 'A']]));
    const b = buildSemanticContentProjection(projectionInput([['tool', 'A'], ['tool', 'B']]));
    assert.deepEqual(a.knownTechnicalFacts, [['tool', 'A'], ['tool', 'B']]);
    assert.deepEqual(a, b);
    assert.deepEqual(computeSemanticContentFingerprint(a), computeSemanticContentFingerprint(b));
  });

  it('deduplicates exact pairs without dropping distinct values for the same key', () => {
    const a = buildSemanticContentProjection(projectionInput([['tool', 'B'], ['tool', 'A'], ['tool', 'B'], ['tool', 'A']]));
    const b = buildSemanticContentProjection(projectionInput([['tool', 'A'], ['tool', 'B']]));
    assert.deepEqual(a, b);
    assert.deepEqual(computeSemanticContentFingerprint(a), computeSemanticContentFingerprint(b));
  });

  it('a genuinely different value set under the same key changes the fingerprint', () => {
    const a = buildSemanticContentProjection(projectionInput([['tool', 'A'], ['tool', 'B']]));
    for (const facts of [[['tool', 'A']], [['tool', 'A'], ['tool', 'C']]] as const) {
      const b = buildSemanticContentProjection(projectionInput(facts));
      assert.notEqual(computeSemanticContentFingerprint(a).value, computeSemanticContentFingerprint(b).value);
    }
  });

  it('rejects non-string keys and values before sorting', () => {
    for (const facts of [[[null, 'A']], [['tool', 12]]]) {
      assert.throws(() => buildSemanticContentProjection(projectionInput(facts as unknown as [string, string][])), TypeError);
    }
  });

  it('a different objectKind produces a different fingerprint', () => {
    const a = computeSemanticContentFingerprint(buildSemanticContentProjection(projectionInput([], 'AGENT_VERSION')));
    const b = computeSemanticContentFingerprint(buildSemanticContentProjection(projectionInput([], 'MODEL')));
    assert.notEqual(a.value, b.value);
  });

  it('a different projection schema version participates in the fingerprint by construction', () => {
    const projection = buildSemanticContentProjection(projectionInput([]));
    assert.equal(projection.projectionSchemaVersion, SEMANTIC_CONTENT_PROJECTION_SCHEMA_VERSION);
  });

  it('refuses a fact value that looks like a secret/credential', () => {
    assert.throws(() => buildSemanticContentProjection(projectionInput([['configKey', 'api_key: sk-abcdef123456']])));
    assert.throws(() => buildSemanticContentProjection(projectionInput([['token', 'Bearer abcdefghijklmnopqrst']])));
  });

  it('rejects an empty fact key', () => {
    assert.throws(() => buildSemanticContentProjection(projectionInput([['', 'value']])));
  });

  it('rejects an empty objectKind', () => {
    assert.throws(() => buildSemanticContentProjection(projectionInput([], '')));
  });
});
