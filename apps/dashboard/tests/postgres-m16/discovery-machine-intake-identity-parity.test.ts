import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { stableCandidateContent } from '../../../../packages/governance-review/src/canonical-endpoint-resolution';
import { s3Cluster } from '../helpers/discovery-machine-s3-fixtures';
import { literal } from '../helpers/discovery-machine-s2-fixtures';

test('S3 canonical JSON blocking parity gate against production TypeScript', { timeout: 180_000 }, async t => {
  process.env.SUPABASE_URL ??= 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
  const { canonicalStringify } = await import('../../lib/governance/persistence');
  const pg = await s3Cluster(message => t.diagnostic(message));
  t.after(() => pg.stop());
  const stringify = async (value: unknown) => JSON.parse(await pg.bootstrapSql(
    `select to_json(gov_repo.discovery_machine_canonical_json_v1(${literal(JSON.stringify(value))}::jsonb))`));
  const values: unknown[] = [null,true,false,0,-0,1,-1,0.1,0.6,0.85,0.95,1e-6,1e20,
    Number.MAX_SAFE_INTEGER,1000000000000000100,1.2345678901234567,
    'quotes " backslash \\ tab\t newline\n return\r backspace\b formfeed\f',
    '\u0001\u001f\u007f', 'ação 漢字 😀 \u2028\u2029',[],{},
    {z:[null,{beta:'é',alpha:0.9}],a:'first'}, {Z:1,a:2,A:3,aa:4,aA:5,'a_':6},
    {sourceObject:{externalType:'file',externalId:'agent.ts',connectionId:'source-connection:abc'},confidence:0.85}];
  await t.test('ASCII key ordering, escaping, Unicode, numbers and nested envelope hash parity', async () => {
    for (const value of values) {
      const actual = await stringify(value);
      assert.equal(actual,canonicalStringify(value),JSON.stringify(value));
      assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(canonicalStringify(value)).digest('hex'));
    }
    // Identity serializer comparison is exercised on its production field vocabulary.
    assert.equal(await stringify(values.at(-1)), stableCandidateContent(values.at(-1)));
  });
  await t.test('reviewed unsupported JSON domain fails closed', async () => {
    for (const json of ['{"x":0.10}','{"x":0.0000001}','{"x":1e21}','{"é":1}',
      '[0.123456789012345678901]', '['.repeat(9)+'0'+']'.repeat(9)]) {
      await assert.rejects(pg.bootstrapSql(`select gov_repo.discovery_machine_canonical_json_v1(${literal(json)}::jsonb)`),/DISCOVERY_MACHINE_MALFORMED_COMMAND/);
    }
  });
});
