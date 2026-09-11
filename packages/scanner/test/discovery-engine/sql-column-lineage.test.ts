import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { asOrganisationId } from '@council/canonical-contracts';
import { normalizedObjectIdentity } from '@council/governance-review';
import { DiscoveryPipeline } from '../../src/discovery/pipeline';
import { SqlCreateTableSpecification, SqlInsertSelectSpecification } from '../../src/discovery/strategies/sql-create-table';
import { RelationshipCorrelationStrategy } from '../../src/discovery/relationship-correlation';
import { normalizeObjectCandidate } from '../../src/discovery/object-candidate-normalization';
import { correlateAgentVersions } from '../../src/discovery/agent-version-correlation';
import { AgentKindDeclarationSpecification } from '../../src/discovery/strategies/agent-kind-declaration';
import { ModelReferenceDeclarationSpecification } from '../../src/discovery/strategies/model-reference-declaration';
import type { DiscoveryCandidate } from '../../src/discovery/evidence-assembly';
import type { SourceAdapter } from '../../src/discovery/source-adapter';

const time = '2026-09-10T12:00:00.000Z';
const ddl = 'CREATE TABLE target (a INT, b TEXT); CREATE TABLE source (x INT, y TEXT);';
const insert = 'INSERT INTO target (a,b) SELECT source.x,source.y FROM source;';
async function scan(sql = insert, declarations = ddl, extra: [string, string][] = []) {
  const files: [string, string][] = [['schema.sql', declarations], ['load.sql', sql], ...extra];
  const adapter: SourceAdapter = {
    adapterName: 'sql-lineage-fixture', adapterVersion: '1',
    describeSource: () => ({ displayName: 'sql-lineage', family: 'REPOSITORY', providerCode: 'test' }),
    listArtifacts: async () => files.map(([locator, text]) => ({ locator, kind: 'file', sizeBytes: Buffer.byteLength(text) })),
    readArtifact: async locator => {
      const text = files.find(([path]) => path === locator)![1];
      return { ok: true, content: { locator, text, encoding: 'utf8', contentHash: createHash('sha256').update(text).digest('hex') } };
    },
  };
  return (await new DiscoveryPipeline(adapter, [new SqlCreateTableSpecification('DATA_ASSET'),
    new SqlCreateTableSpecification('DATA_ELEMENT'), new SqlInsertSelectSpecification(),
    new AgentKindDeclarationSpecification(), new ModelReferenceDeclarationSpecification()],
  { clock: { now: () => time } }).run()).candidates;
}
function correlate(candidates: readonly DiscoveryCandidate[], observedAt = time) {
  return new RelationshipCorrelationStrategy().correlate(candidates, observedAt, {
    organisationId: asOrganisationId('org-lineage'), connectionId: candidates[0].finding.sourceObject.connectionId,
    agentVersions: correlateAgentVersions(candidates, [], { observedAt }), technicalProfileSignals: [],
  });
}
function edges(candidates: readonly DiscoveryCandidate[]) {
  const objects = candidates.flatMap(item => {
    const result = normalizeObjectCandidate(item, { candidates });
    return result.status === 'NORMALIZED' ? [result] : [];
  });
  return correlate(candidates).map(({ candidate }) => {
    const endpoint = (ref: typeof candidate.sourceEndpoint) => {
      assert.equal(ref.referenceKind, 'CANDIDATE');
      if (ref.referenceKind !== 'CANDIDATE') throw new Error('wrong endpoint');
      const object = objects.find(item => item.candidate.candidateId === ref.candidateId)!;
      assert.equal(object.candidate.candidateKind, 'DATA_ELEMENT');
      assert.ok(normalizedObjectIdentity(object.candidate, object.parentDataAsset));
      if (object.candidate.candidateKind !== 'DATA_ELEMENT') throw new Error('wrong kind');
      return [object.parentDataAsset!.proposedIdentity.sourceReference, object.candidate.proposedIdentity.elementPath];
    };
    return [endpoint(candidate.sourceEndpoint), endpoint(candidate.targetEndpoint)];
  }).sort();
}

describe('Milestone 9 strict direct column lineage', () => {
  it('cross-file explicit position maps TARGET DERIVED_FROM SOURCE with exact M7-compatible endpoints', async () => {
    assert.deepEqual(edges(await scan()), [[['target', 'a'], ['source', 'x']], [['target', 'b'], ['source', 'y']]]);
  });
  for (const sql of [
    'INSERT INTO target (a,b) SELECT s.x,s.y FROM source s;',
    'INSERT INTO target (a,b) SELECT s.x,s.y FROM source AS s;',
    'INSERT INTO target (b,a) SELECT y,x FROM source;',
  ]) it(`exact alias/unqualified projection: ${sql}`, async () => {
    assert.deepEqual(edges(await scan(sql)), edges(await scan()));
  });
  it('schema-qualified tables and M8 effective quoted/unquoted identifiers share identity', async () => {
    const declarations = 'CREATE TABLE CRM.Target (ID INT); CREATE TABLE "crm"."source" ("id" INT);';
    assert.deepEqual(edges(await scan('INSERT INTO "crm".TARGET ("id") SELECT s.ID FROM CRM.source s;', declarations)),
      [[['crm.target', 'id'], ['crm.source', 'id']]]);
  });
  it('quoted case, dots and escaped quotes retain component boundaries', async () => {
    const declarations = 'CREATE TABLE "T.X" ("ID" INT); CREATE TABLE "S"."a""b" ("x.y" INT);';
    assert.deepEqual(edges(await scan('INSERT INTO "T.X" ("ID") SELECT "s"."x.y" FROM "S"."a""b" "s";', declarations)),
      [[['"T.X"', '"ID"'], ['"S"."a""b"', '"x.y"']]]);
  });
  it('same-named columns under different assets stay distinct', async () => {
    const declarations = 'CREATE TABLE target (id INT); CREATE TABLE source (id INT);';
    const candidates = await scan('INSERT INTO target (id) SELECT id FROM source;', declarations);
    const [result] = correlate(candidates);
    assert.notDeepEqual(result.candidate.sourceEndpoint, result.candidate.targetEndpoint);
    assert.deepEqual(edges(candidates), [[['target', 'id'], ['source', 'id']]]);
  });

  for (const sql of [
    'INSERT INTO target (a,b) SELECT * FROM source;',
    'INSERT INTO target (a,b) SELECT s.* FROM source s;',
    'INSERT INTO target SELECT x,y FROM source;',
    'INSERT INTO target (a,b) SELECT x FROM source;',
    'INSERT INTO target (a) SELECT x,y FROM source;',
    'INSERT INTO target (a,a) SELECT x,y FROM source;',
    'INSERT INTO target (a,b) SELECT q.x,q.y FROM source s;',
    'INSERT INTO target (a,b) SELECT source.x,source.y FROM source s;',
    'INSERT INTO target (a,b) SELECT x,y FROM source JOIN other ON source.x=other.x;',
    'INSERT INTO target (a,b) SELECT x,y FROM source, other;',
    'INSERT INTO target (a) SELECT upper(y) FROM source;',
    'INSERT INTO target (a) SELECT sum(x) FROM source;',
    'INSERT INTO target (a) SELECT x+1 FROM source;',
    'INSERT INTO target (a) SELECT x::text FROM source;',
    'INSERT INTO target (a) SELECT CAST(x AS text) FROM source;',
    'INSERT INTO target (a) SELECT CASE WHEN x=1 THEN x END FROM source;',
    'INSERT INTO target (a) SELECT x FROM source GROUP BY x;',
    'INSERT INTO target (a) SELECT x FROM source HAVING x=1;',
    'INSERT INTO target (a) SELECT row_number() OVER () FROM source;',
    'INSERT INTO target (a) SELECT x FROM source UNION SELECT x FROM source;',
    'INSERT INTO target (a) SELECT x FROM source INTERSECT SELECT x FROM source;',
    'INSERT INTO target (a) SELECT x FROM source EXCEPT SELECT x FROM source;',
    'WITH q AS (SELECT x FROM source) INSERT INTO target (a) SELECT x FROM q;',
    'INSERT INTO target (a) SELECT x FROM (SELECT x FROM source) s;',
    'INSERT INTO target (a) SELECT x FROM LATERAL source;',
    'INSERT INTO target (a) SELECT x FROM source WHERE x=1;',
    'INSERT INTO target (a) SELECT x FROM source ON CONFLICT DO NOTHING;',
    'INSERT INTO target (a) VALUES (1);',
    'CREATE TABLE target AS SELECT x FROM source;',
    'CREATE VIEW target AS SELECT x FROM source;',
    'UPDATE target SET a=source.x FROM source;',
    'DELETE FROM target;',
    'MERGE INTO target USING source ON target.a=source.x WHEN MATCHED THEN UPDATE SET a=x;',
    "DO $$ BEGIN INSERT INTO target (a) SELECT x FROM source; END $$;",
    'CREATE PROCEDURE p() LANGUAGE SQL BEGIN ATOMIC SELECT 1; INSERT INTO target (a) SELECT x FROM source; END;',
    'CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE SQL BEGIN ATOMIC SELECT 1; INSERT INTO target (a) SELECT x FROM source; END;',
    "SELECT 'INSERT INTO target (a) SELECT x FROM source;';",
    '-- INSERT INTO target (a) SELECT x FROM source;',
    '/* INSERT INTO target (a) SELECT x FROM source; */',
    'INSERT INTO target (a,) SELECT x FROM source;',
    'INSERT INTO target (a) SELECT x FROM source',
    'INSERT INTO target (a SELECT x FROM source;',
    'INSERT INTO target (a) SELECT x FROM source; /* unterminated',
  ]) it(`fails closed SQL: ${sql}`, async () => assert.deepEqual(correlate(await scan(sql)), []));

  for (const [label, declarations, extra] of [
    ['missing source asset', 'CREATE TABLE target (a INT,b TEXT);', []],
    ['missing target asset', 'CREATE TABLE source (x INT,y TEXT);', []],
    ['missing source element', 'CREATE TABLE target (a INT,b TEXT); CREATE TABLE source (x INT);', []],
    ['missing target element', 'CREATE TABLE target (a INT); CREATE TABLE source (x INT,y TEXT);', []],
    ['ambiguous source asset across files', ddl, [['duplicate.sql', 'CREATE TABLE "source" (x INT,y TEXT);']]],
    ['ambiguous target asset across files', ddl, [['duplicate.sql', 'CREATE TABLE TARGET (a INT,b TEXT);']]],
    ['same-file duplicate source', ddl + 'CREATE TABLE source (x INT,y TEXT);', []],
    ['quoted case mismatch', 'CREATE TABLE "Target" (a INT,b TEXT); CREATE TABLE source (x INT,y TEXT);', []],
  ] as [string, string, [string, string][]][]) it(`endpoint fail closed: ${label}`, async () => {
    assert.deepEqual(correlate(await scan(insert, declarations, extra)), []);
  });

  it('ambiguous normalized elements fail closed', async () => {
    const candidates = await scan();
    const element = candidates.find(c => c.dataDeclaration?.elementPath === 'x')!;
    assert.deepEqual(correlate([...candidates, element]), []);
    const invalidDuplicate = { ...element, evidence: { ...element.evidence, locations: [] } };
    assert.deepEqual(correlate([...candidates, invalidDuplicate]), []);
  });
  it('requires transformation statement, snapshot, method/version, support and DECLARED trust', async () => {
    const candidates = await scan();
    const transformation = candidates.find(c => c.transformation)!;
    const mutations: DiscoveryCandidate[] = [
      { ...transformation, transformation: undefined },
      { ...transformation, transformation: { ...transformation.transformation!, pairs: [{ targetElement: 'a', sourceElement: 'y' }] } },
      { ...transformation, evidence: { ...transformation.evidence, redactedExcerpt: '' } },
      { ...transformation, evidence: { ...transformation.evidence, hashes: transformation.evidence.hashes.slice(0, 1) } },
      { ...transformation, assertion: { ...transformation.assertion, snapshot: undefined } },
      { ...transformation, assertion: { ...transformation.assertion,
        snapshot: { ...transformation.assertion.snapshot!, snapshotId: '' as never } } },
      { ...transformation, assertion: { ...transformation.assertion, method: { code: 'unknown', version: '1.0.0' } } },
      { ...transformation, assertion: { ...transformation.assertion, method: { code: transformation.assertion.method.code, version: '2.0.0' } } },
      { ...transformation, assertion: { ...transformation.assertion, trustState: 'OBSERVED' } },
      { ...transformation, assertion: { ...transformation.assertion, trustState: 'VALIDATED' } },
      { ...transformation, finding: { ...transformation.finding, evidenceIds: [] } },
      { ...transformation, finding: { ...transformation.finding, assertionIds: [] } },
    ];
    for (const changed of mutations) assert.deepEqual(correlate(candidates.map(c => c === transformation ? changed : c)), []);
    assert.deepEqual(correlate(candidates.filter(c => c !== transformation)), []);
    for (const { candidate, finding } of correlate(candidates)) {
      assert.ok(candidate.evidenceIds.includes(transformation.evidence.evidenceId));
      assert.ok(candidate.assertionIds.includes(transformation.assertion.assertionId));
      assert.equal(candidate.requiresReconciliation, true);
      assert.equal(finding.requiresReview, true);
      assert.equal(finding.createsCanonicalObject, false);
      assert.equal(finding.reviewStatus, 'UNREVIEWED');
    }
    assert.equal(transformation.assertion.trustState, 'DECLARED');
    assert.ok(transformation.assertion.snapshot!.contentHash.value);
    assert.equal(transformation.assertion.method.version, '1.0.0');
  });
  it('replay, enumeration, time and line/comment movement preserve semantic edge IDs and trace changed support', async () => {
    const candidates = await scan();
    const first = correlate(candidates);
    assert.deepEqual(correlate(await scan()), first);
    assert.deepEqual(correlate([...candidates].reverse()), first);
    const ids = (input: readonly DiscoveryCandidate[], at = time) => correlate(input, at).map(r => r.candidate.candidateId);
    assert.deepEqual(ids(candidates, '2026-09-11T12:00:00.000Z'), ids(candidates));
    const moved = await scan('-- secret-comment\n' + insert.replace('SELECT', 'SELECT /* secret */\n'), '\n-- moved\n' + ddl);
    assert.deepEqual(ids(moved), ids(candidates));
    assert.notDeepEqual(correlate(moved)[0].candidate.evidenceIds, first[0].candidate.evidenceIds);
    assert.ok(!JSON.stringify(moved).includes('secret-comment'));
    const aliased = await scan('INSERT INTO target (a,b) SELECT s.x,s.y FROM source s;');
    assert.deepEqual(ids(aliased), ids(candidates));
    assert.notEqual(aliased.find(c => c.transformation)!.transformation!.statementFingerprint,
      candidates.find(c => c.transformation)!.transformation!.statementFingerprint);
    assert.notDeepEqual(ids(await scan('INSERT INTO target (a,b) SELECT y,x FROM source;')), ids(candidates));
  });
  it('duplicate mappings deduplicate with deterministic union of all statement support; distinct mappings remain distinct', async () => {
    const candidates = await scan(insert + '\n' + insert);
    assert.equal(correlate(candidates).length, 2);
    for (const result of correlate(candidates)) for (const support of candidates.filter(c => c.transformation)) {
      assert.ok(result.candidate.evidenceIds.includes(support.evidence.evidenceId));
    }
    assert.deepEqual(correlate([...candidates].reverse()), correlate(candidates));
    assert.equal(correlate(await scan(insert + 'INSERT INTO target (a,b) SELECT y,x FROM source;')).length, 4);
  });
  it('AgentVersion repository and same-directory co-presence never emits READS_FROM/WRITES_TO', async () => {
    const candidates = await scan(insert, ddl, [['agent.py', 'class Assistant:\n    kind = "agent"\n    modelReference = "model-a"\n']]);
    assert.equal(correlateAgentVersions(candidates, [], { observedAt: time }).length, 1);
    const results = correlate(candidates);
    assert.equal(results.filter(r => r.candidate.relationshipTypeCode === 'DERIVED_FROM').length, 2);
    assert.equal(results.filter(r => ['READS_FROM', 'WRITES_TO'].includes(r.candidate.relationshipTypeCode)).length, 0);
    assert.ok(results.every(r => r.candidate.sourceEndpoint.candidateKind !== 'AGENT'));
  });
  it('requires trusted tenant/connection context', async () => {
    const candidates = await scan();
    assert.deepEqual(new RelationshipCorrelationStrategy().correlate(candidates, time), []);
    assert.deepEqual(new RelationshipCorrelationStrategy().correlate(candidates, time, {
      organisationId: asOrganisationId('other'), connectionId: 'wrong' as never, agentVersions: [], technicalProfileSignals: [],
    }), []);
  });
});
