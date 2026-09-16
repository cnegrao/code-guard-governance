import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DiscoveryPipeline } from '../../src/discovery/pipeline';
import { correlateAgentVersions } from '../../src/discovery/agent-version-correlation';
import { RelationshipCorrelationStrategy } from '../../src/discovery/relationship-correlation';
import { AgentKindDeclarationSpecification } from '../../src/discovery/strategies/agent-kind-declaration';
import { ToolListDeclarationSpecification } from '../../src/discovery/strategies/tool-list-declaration';
import { ApiDeclarationSpecification } from '../../src/discovery/strategies/api-declaration';
import type { SourceAdapter } from '../../src/discovery/source-adapter';
import { asOrganisationId } from '@council/canonical-contracts';

const principal = 'executionPrincipal: { kind: "SERVICE_ACCOUNT", provider: "fixture", authority: "realm-a", principal: "account-a" },';
const connectivity = 'connectivity: [{ endpoint: "https://catalog.invalid/v1", protocol: { kind: "API", family: "HTTP" } }],';
const scopes = 'requestedScopes: [{ scope: "catalog.read", resource: "catalog" }],';
const source = (extra = '') => `export const triageAgent = {\n  kind: "agent",\n  tools: [classifyRequest],\n  ${extra}\n};\n`;
async function scan(text: string, other = '') {
  const files = new Map([['agent.ts', text], ['sibling.ts', other]]);
  const adapter: SourceAdapter = { adapterName: 'fixture', adapterVersion: '1',
    describeSource: () => ({ displayName: 'm13-fixture', family: 'REPOSITORY', providerCode: 'fixture' }),
    listArtifacts: async () => [...files].map(([locator, value]) => ({ locator, kind: 'file' as const, sizeBytes: value.length })),
    readArtifact: async locator => ({ ok: true, content: { locator, text: files.get(locator)!, encoding: 'utf8',
      contentHash: createHash('sha256').update(files.get(locator)!).digest('hex') } }) };
  const result = await new DiscoveryPipeline(adapter, [new AgentKindDeclarationSpecification(), new ToolListDeclarationSpecification(), new ApiDeclarationSpecification()]).run();
  const versions = correlateAgentVersions(result.candidates, [], { observedAt: result.run.startedAt });
  return { ...result, versions, facts: versions.flatMap(v => v.executionFacts ?? []) };
}
test('real triage golden source produces capability on exact L9 version, without a second Tool identity', async () => {
  const text = readFileSync(new URL('../discovery-validation-lab/golden-repositories/02-multi-agent/src/triage_agent.ts', import.meta.url), 'utf8');
  const r = await scan(text);
  assert.equal(r.versions.length, 1); assert.equal(r.facts.length, 1);
  assert.deepEqual(r.facts[0].fact, { field: 'CAPABILITY', capabilityReference: 'classifyRequest' });
  const edges = new RelationshipCorrelationStrategy().correlate(r.candidates, r.run.startedAt,
    { organisationId: asOrganisationId('org-a'), connectionId: r.run.connection.connectionId, agentVersions: r.versions, technicalProfileSignals: [] });
  assert.equal(edges.length, 1);
  assert.equal(edges[0].candidate.sourceEndpoint.referenceKind, 'CANDIDATE');
  assert.equal(edges[0].candidate.sourceEndpoint.candidateKind, 'AGENT_VERSION');
  assert.equal((edges[0].candidate.sourceEndpoint as { candidateId: string }).candidateId, r.versions[0].candidate.candidateId);
  assert.equal((edges[0].candidate.targetEndpoint as { candidateId: string }).candidateId, r.facts[0].toolCandidateId);
});
test('all four supported fact types are DECLARED and have independent hash-only source support', async () => {
  const r = await scan(source([principal, connectivity, scopes].join('\n  ')));
  assert.equal(r.facts.length, 4);
  assert.deepEqual(r.facts.map(f => f.fact.field).sort(), ['CAPABILITY','DECLARED_CONNECTIVITY','PRINCIPAL','REQUESTED_SCOPE']);
  for (const f of r.facts) {
    assert.equal(f.assertion.trustState, 'DECLARED'); assert.equal(f.evidence.handling, 'HASH_ONLY');
    assert.equal(f.evidence.redactedExcerpt, undefined); assert.deepEqual(f.assertion.evidenceIds, [f.evidence.evidenceId]);
    assert.ok(f.assertion.snapshot?.snapshotId); assert.equal(Object.hasOwn(f.fact, 'state'), false);
  }
  assert.equal(r.candidates.find(c => c.finding.candidateKind === 'TOOL')!.assertion.trustState, 'INFERRED');
});
test('principal-only changes preserve exact revision while retaining different temporal support', async () => {
  const a = await scan(source(principal)); const b = await scan(source(principal.replace('account-a','account-b')));
  assert.equal(a.versions[0].candidate.candidateId, b.versions[0].candidate.candidateId);
  assert.notEqual(a.facts.find(f=>f.fact.field==='PRINCIPAL')!.assertion.assertionId, b.facts.find(f=>f.fact.field==='PRINCIPAL')!.assertion.assertionId);
  assert.equal(a.versions[0].technicalRevisionFingerprint, (await scan(source())).versions[0].technicalRevisionFingerprint);
});
test('connectivity and requested scopes extend the existing revision prospectively', async () => {
  const a = await scan(source(connectivity + '\n  ' + scopes));
  for (const changed of [connectivity.replace('/v1','/v2')+'\n  '+scopes, connectivity+'\n  '+scopes.replace('catalog.read','catalog.write')]) {
    assert.notEqual(a.versions[0].candidate.candidateId, (await scan(source(changed))).versions[0].candidate.candidateId);
  }
  assert.equal(a.versions[0].behaviorFingerprintSchemaVersion, '1.1');
  const reorder = await scan('\n\n' + source(scopes + '\n  ' + connectivity).replace('kind: "API", family: "HTTP"','family: "HTTP", kind: "API"'));
  assert.equal(a.versions[0].candidate.candidateId, reorder.versions[0].candidate.candidateId);
});
test('same repository/directory and API co-presence do not bind M13 facts', async () => {
  const sibling = `const SOME_API = {\n id: "catalog",\n base_url: "https://catalog.invalid"\n};\nconst configuration = {\n ${principal}\n ${connectivity}\n};\n`;
  const r = await scan(source(), sibling);
  assert.deepEqual(r.facts.map(f=>f.fact.field), ['CAPABILITY']);
  const two = await scan(source(principal), source().replace('triageAgent','otherAgent').replace('classifyRequest','otherTool'));
  assert.equal(two.versions.length, 2);
  assert.equal(two.versions.find(v => v.executionFacts?.some(f => f.fact.field === 'CAPABILITY' && f.fact.capabilityReference === 'otherTool'))!.executionFacts!.length, 1);
});
for (const invalid of [
  principal.replace('account-a','password=synthetic'), principal.replace('account-a','Bearer synthetic'),
  principal.replace('principal: "account-a"','clientSecret: "synthetic"'),
  principal.replace('"account-a"','process.env.ACCOUNT'), principal.replace('"account-a"','getAccount()'),
  principal.replace('principal: "account-a"','...configuration'),
  connectivity.replace('https://catalog.invalid/v1','https://user:synthetic@catalog.invalid/v1'),
  connectivity.replace('https://catalog.invalid/v1','https://catalog.invalid/v1?token=synthetic'),
  connectivity.replace('"HTTP"','"WEBSOCKET"'), connectivity.replace('protocol: { kind: "API", family: "HTTP" }','protocol: "https"'),
  scopes.replace('"catalog.read"','requestedScope'), 'grantedScopes: ["catalog.read"],',
  'permissions: ["read"],', 'roles: ["admin"],', 'authorizationState: "ALLOWED",', 'authorizationState: "DENIED",',
  principal + '\n  ' + principal,
]) test(`unsupported/unsafe source fails closed (${invalid.slice(0,30)})`, async () => {
  assert.equal((await scan(source(invalid))).facts.length, 0);
});
test('ordering scopes and connectivity entries is semantically stable', async () => {
  const a = scopes.replace('}],', '}, { scope: "catalog.write", resource: "catalog" }],');
  const b = 'requestedScopes: [{ resource: "catalog", scope: "catalog.write" }, { resource: "catalog", scope: "catalog.read" }],';
  assert.equal((await scan(source(a))).versions[0].candidate.candidateId, (await scan(source(b))).versions[0].candidate.candidateId);
});
