import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { normalizedObjectIdentity } from '@council/governance-review';
import { SOURCE_FAMILY } from '@council/canonical-contracts';
import { DiscoveryPipeline } from '../../src/discovery/pipeline';
import { SqlCreateTableSpecification } from '../../src/discovery/strategies/sql-create-table';
import { normalizeObjectCandidate } from '../../src/discovery/object-candidate-normalization';
import type { DiscoveryCandidate } from '../../src/discovery/evidence-assembly';
import type { SourceAdapter } from '../../src/discovery/source-adapter';

async function scan(sql: string, locator = 'db/schema.sql', reverse = false) {
  return scanFiles([[locator, sql]], reverse);
}
async function scanFiles(files: [string, string][], reverse = false) {
  const adapter: SourceAdapter = {
    adapterName: 'memory-sql-test', adapterVersion: '1.0.0',
    describeSource: () => ({ displayName: 'sql-fixture', family: SOURCE_FAMILY.REPOSITORY, providerCode: 'test' }),
    listArtifacts: async () => (reverse ? [...files].reverse() : files).map(([locator, text]) => ({ locator, kind: 'file', sizeBytes: Buffer.byteLength(text) })),
    readArtifact: async locator => {
      const text = files.find(([path]) => path === locator)![1];
      return { ok: true, content: { locator, text, encoding: 'utf8', contentHash: createHash('sha256').update(text).digest('hex') } };
    },
  };
  const specs = [new SqlCreateTableSpecification('DATA_ASSET'), new SqlCreateTableSpecification('DATA_ELEMENT')];
  return new DiscoveryPipeline(adapter, reverse ? specs.reverse() : specs,
    { clock: { now: () => '2026-09-10T12:00:00.000Z' } }).run();
}
function normalized(candidates: readonly DiscoveryCandidate[]) {
  return candidates.map(candidate => {
    const result = normalizeObjectCandidate(candidate, { candidates });
    assert.equal(result.status, 'NORMALIZED');
    if (result.status !== 'NORMALIZED') throw new Error('not normalized');
    return result;
  });
}
function identities(candidates: readonly DiscoveryCandidate[]) {
  return normalized(candidates).map(result => JSON.stringify([
    result.candidate.sourceObject, result.candidate.candidateKind,
    normalizedObjectIdentity(result.candidate, result.parentDataAsset),
  ])).sort();
}

describe('Strict SQL data discovery: declarations, normalization and M7 identity', () => {
  for (const [label, sql, asset, columns] of [
    ['simple', 'CREATE TABLE customers (id TEXT, email TEXT NOT NULL);', 'customers', ['id', 'email']],
    ['schema-qualified', 'CREATE TABLE crm.customers (id INTEGER PRIMARY KEY);', 'crm.customers', ['id']],
    ['IF NOT EXISTS', 'CREATE TABLE IF NOT EXISTS crm.customers (id UUID);', 'crm.customers', ['id']],
    ['quoted identifiers', 'CREATE TABLE "CRM"."Customer.Table" ("ID" UUID, "a.b" TEXT, "a""b" TEXT);', '"CRM"."Customer.Table"', ['"ID"', '"a.b"', '"a""b"']],
    ['quoted reserved names', 'CREATE TABLE "select" ("from" INT);', '"select"', ['"from"']],
    ['numeric commas', 'CREATE TABLE amounts (amount numeric(10,2), label varchar(40));', 'amounts', ['amount', 'label']],
    ['nested defaults', "CREATE TABLE amounts (amount numeric(10,2) DEFAULT round(coalesce(1, 2), 2), label text DEFAULT concat('a,b', 'secret'));", 'amounts', ['amount', 'label']],
    ['quoted statement boundary', "CREATE TABLE strings (value TEXT DEFAULT 'x); CREATE TABLE fake (id INT);');", 'strings', ['value']],
    ['constraint filtering', 'CREATE TABLE t (id INT, email TEXT, n INT CHECK (n > 0), CONSTRAINT pk PRIMARY KEY (id), UNIQUE (email), FOREIGN KEY (id) REFERENCES parent (id), CHECK (n > 0));', 't', ['id', 'email', 'n']],
    ['multiline comments', '/* outer /* nested */ end */ CREATE\nTABLE /* table */ t (id /* type */ INT,\n -- comment\n name TEXT);', 't', ['id', 'name']],
    ['timestamp and casts', "CREATE TABLE t (created TIMESTAMP(3) WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid);", 't', ['created', 'id']],
  ] as const) {
    it(`accepts ${label}`, async () => {
      const { candidates, warnings } = await scan(sql);
      assert.deepEqual(warnings, []);
      const results = normalized(candidates);
      assert.equal(results.length, 1 + columns.length);
      assert.equal(results[0].candidate.candidateKind, 'DATA_ASSET');
      assert.deepEqual(results[0].candidate.proposedIdentity, { sourceReference: asset });
      assert.deepEqual(results.slice(1).map(r => r.candidate.candidateKind === 'DATA_ELEMENT' && r.candidate.proposedIdentity.elementPath), columns);
      for (const result of results.slice(1)) {
        assert.equal(result.candidate.candidateKind, 'DATA_ELEMENT');
        if (result.candidate.candidateKind !== 'DATA_ELEMENT') continue;
        assert.deepEqual(result.candidate.proposedIdentity.parentDataAsset, {
          referenceKind: 'CANDIDATE', candidateKind: 'DATA_ASSET', candidateId: results[0].candidate.candidateId,
        });
        assert.deepEqual(result.parentDataAsset, results[0].candidate);
      }
    });
  }

  for (const [label, sql, path = 'db/schema.sql'] of [
    ['line comment', '-- CREATE TABLE fake (id INT);'],
    ['block comment', '/* CREATE TABLE fake (id INT); */'],
    ['quoted string', "SELECT 'CREATE TABLE fake (id INT);';"],
    ['dollar quoted body', 'DO $body$ BEGIN CREATE TABLE fake (id INT); END $body$;'],
    ['prose', 'This document mentions CREATE TABLE fake (id INT);'],
    ['markdown fenced SQL', 'CREATE TABLE fake (id INT);', 'README.md'],
    ['code import', 'import databaseClient from "db"; const table = "customers";', 'client.ts'],
    ['SQL-shaped filename only', '', 'CREATE TABLE customers.sql'],
    ['missing table', 'CREATE TABLE (id INT);'],
    ['reserved table keyword', 'CREATE TABLE SELECT (id INT);'],
    ['reserved column keyword', 'CREATE TABLE t (FROM INT);'],
    ['keyword as default', 'CREATE TABLE t (id INT DEFAULT SELECT);'],
    ['bare column as default', 'CREATE TABLE t (id INT DEFAULT other_column);'],
    ['nested column as default', 'CREATE TABLE t (id INT DEFAULT coalesce(other_column, 1));'],
    ['zero type precision', 'CREATE TABLE t (id NUMERIC(0,2));'],
    ['out-of-subset scale', 'CREATE TABLE t (id NUMERIC(10,11));'],
    ['invalid timestamp precision', 'CREATE TABLE t (id TIMESTAMP(10));'],
    ['zero varchar length', 'CREATE TABLE t (id VARCHAR(0));'],
    ['missing datatype', 'CREATE TABLE t (id);'],
    ['missing parenthesis', 'CREATE TABLE t (id INT;'],
    ['missing terminator', 'CREATE TABLE t (id INT)'],
    ['trailing column comma', 'CREATE TABLE t (id INT,);'],
    ['unterminated string', "CREATE TABLE t (id TEXT DEFAULT 'unterminated);"],
    ['unterminated comment', 'CREATE TABLE t (id INT); /*'],
    ['AS SELECT', 'CREATE TABLE t AS SELECT id FROM other;'],
    ['typed AS SELECT', 'CREATE TABLE t (id INT) AS SELECT id FROM other;'],
    ['view', 'CREATE VIEW t AS SELECT id FROM other;'],
    ['ALTER', 'ALTER TABLE t ADD COLUMN id INT;'],
    ['unknown type', 'CREATE TABLE t (id imagined_type);'],
    ['unsupported column clause', 'CREATE TABLE t (id INT GENERATED ALWAYS AS IDENTITY);'],
    ['malformed default', 'CREATE TABLE t (id INT DEFAULT (1 +));'],
    ['empty default', 'CREATE TABLE t (id INT DEFAULT);'],
    ['missing column comma', 'CREATE TABLE t (id INT name TEXT);'],
    ['invalid constraint', 'CREATE TABLE t (id INT, CONSTRAINT p PRIMARY id);'],
    ['duplicate column', 'CREATE TABLE t (id INT, id TEXT);'],
    ['physical quoted alias column', 'CREATE TABLE t (id INT, "id" TEXT);'],
    ['duplicate declaration', 'CREATE TABLE t (id INT); CREATE TABLE t (id INT);'],
    ['conflicting declaration', 'CREATE TABLE t (id INT); CREATE TABLE t (id TEXT);'],
    ['physical case alias table', 'CREATE TABLE t (id INT); CREATE TABLE T (id INT);'],
    ['unsupported duplicate table', 'CREATE TABLE t (id INT); CREATE TABLE t AS SELECT 1;'],
  ] as const) {
    it(`fails closed: ${label}`, async () => assert.deepEqual((await scan(sql, path)).candidates, []));
  }

  it('replay and traversal/specification order preserve semantic identities', async () => {
    const files: [string, string][] = [['a.sql', 'CREATE TABLE a (id INT);'], ['b.sql', 'CREATE TABLE b (id INT);']];
    const first = await scanFiles(files);
    const replay = await scanFiles(files);
    assert.deepEqual(normalized(first.candidates), normalized(replay.candidates));
    assert.deepEqual(identities(first.candidates), identities((await scanFiles(files, true)).candidates));
  });
  it('line/comment/whitespace movement preserves identities, while retaining snapshot-specific row evidence', async () => {
    const first = await scan('CREATE TABLE t (id INT, name TEXT);');
    const moved = await scan('-- introduction\n\nCREATE /* comment */ TABLE t\n(\nid INT,\nname TEXT\n);');
    assert.deepEqual(identities(first.candidates), identities(moved.candidates));
    assert.notEqual(first.candidates[0].evidence.evidenceId, moved.candidates[0].evidence.evidenceId);
  });
  it('CR-only comments preserve real evidence line positions', async () => {
    const { candidates } = await scan('-- comment\rCREATE TABLE t (\rid INT\r);');
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].evidence.locations[0].lineStart, 2);
    assert.equal(candidates[1].evidence.locations[0].lineStart, 3);
  });
  it('datatype/default changes do not change semantic identity or reuse stale evidence rows', async () => {
    const first = await scan('CREATE TABLE t (id INT DEFAULT 1);');
    const changed = await scan('CREATE TABLE t (id TEXT DEFAULT \'private-value\');');
    assert.deepEqual(identities(first.candidates), identities(changed.candidates));
    assert.notEqual(first.candidates[1].finding.findingId, changed.candidates[1].finding.findingId);
    assert.ok(!JSON.stringify(changed.candidates).includes('private-value'));
  });
  it('table/column renames change the corresponding identities', async () => {
    const first = await scan('CREATE TABLE t (id INT);');
    assert.notDeepEqual(identities(first.candidates), identities((await scan('CREATE TABLE other (id INT);')).candidates));
    assert.notDeepEqual(identities(first.candidates), identities((await scan('CREATE TABLE t (other INT);')).candidates));
  });
  it('same column under distinct same-file assets cannot collide in rows or semantic identity', async () => {
    const { candidates } = await scan('CREATE TABLE a (id INT); CREATE TABLE b (id INT);');
    const results = normalized(candidates);
    assert.equal(new Set(results.map(r => r.candidate.candidateId)).size, 4);
    assert.equal(new Set(identities(candidates)).size, 4);
    const children = results.filter(r => r.candidate.candidateKind === 'DATA_ELEMENT');
    assert.notEqual(normalizedObjectIdentity(children[0].candidate, children[0].parentDataAsset),
      normalizedObjectIdentity(children[1].candidate, children[1].parentDataAsset));
  });
  it('preserves quoted case and punctuation without silent folding', async () => {
    const { candidates } = await scan('CREATE TABLE "A" ("ID" INT); CREATE TABLE "a" ("id" INT);');
    assert.equal(new Set(identities(candidates)).size, 4);
  });
  it('requires an exact parent, rejecting missing, duplicate, wrong-table and stale-snapshot parents', async () => {
    const { candidates } = await scan('CREATE TABLE t (id INT);');
    const [parent, child] = candidates;
    const other = (await scan('CREATE TABLE other (id INT);')).candidates[0];
    const stale = (await scan('CREATE TABLE t (id TEXT);')).candidates[0];
    for (const parents of [[], [parent, parent], [other], [stale]]) {
      assert.equal(normalizeObjectCandidate(child, { candidates: parents }).status, 'NOT_SAFELY_NORMALIZABLE');
    }
    assert.equal(normalizeObjectCandidate(child).status, 'NOT_SAFELY_NORMALIZABLE');
  });
  it('retains declaration evidence/assertion and the non-authoritative review flags for each object', async () => {
    const { candidates } = await scan('CREATE TABLE crm.t (id INT, secret TEXT DEFAULT \'password-value\');');
    const results = normalized(candidates);
    candidates.forEach((candidate, i) => {
      assert.equal(candidate.assertion.trustState, 'DECLARED');
      assert.equal(candidate.finding.requiresReview, true);
      assert.equal(candidate.finding.createsCanonicalObject, false);
      assert.equal(candidate.finding.reviewStatus, 'UNREVIEWED');
      assert.equal(results[i].candidate.requiresReconciliation, true);
      assert.deepEqual(results[i].candidate.evidenceIds, [candidate.evidence.evidenceId]);
      assert.deepEqual(results[i].candidate.assertionIds, [candidate.assertion.assertionId]);
      assert.ok(candidate.evidence.locations.length);
      assert.ok(candidate.evidence.redactedExcerpt?.includes(candidate.displayValue.replace('crm.', 'crm . ')) ||
        candidate.evidence.redactedExcerpt?.includes(candidate.displayValue));
    });
    assert.ok(!JSON.stringify(candidates).includes('password-value'));
  });
  it('missing evidence, identity or declaration proof never normalizes', async () => {
    const { candidates } = await scan('CREATE TABLE t (id INT);');
    for (const candidate of candidates) {
      const mutations: DiscoveryCandidate[] = [
        { ...candidate, dataDeclaration: undefined },
        { ...candidate, dataDeclaration: { ...candidate.dataDeclaration!, sourceReference: '' } },
        { ...candidate, evidence: { ...candidate.evidence, locations: [] } },
        { ...candidate, evidence: { ...candidate.evidence, redactedExcerpt: '' } },
        { ...candidate, finding: { ...candidate.finding, assertionIds: [] } },
        { ...candidate, finding: { ...candidate.finding, evidenceIds: [] } },
        { ...candidate, assertion: { ...candidate.assertion, trustState: 'OBSERVED' } },
        { ...candidate, assertion: { ...candidate.assertion, trustState: 'VALIDATED' } },
      ];
      for (const mutation of mutations) assert.equal(normalizeObjectCandidate(mutation, { candidates }).status, 'NOT_SAFELY_NORMALIZABLE');
    }
  });
  it('does not emit access or lineage from SQL statements', async () => {
    const { candidates } = await scan('CREATE TABLE t (id INT); SELECT id FROM t; INSERT INTO t VALUES (1); UPDATE t SET id = 2; DELETE FROM t;');
    assert.deepEqual(candidates.map(c => c.finding.candidateKind), ['DATA_ASSET', 'DATA_ELEMENT']);
    assert.ok(!/READS_FROM|WRITES_TO|DERIVED_FROM/.test(JSON.stringify(candidates)));
  });
});
