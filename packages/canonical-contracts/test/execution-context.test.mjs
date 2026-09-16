import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createExecutionFact, classifyExecutionFact, declaredExecutionSemanticValues,
  CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE,
} from '../src/index.ts';

const principal = Object.freeze({ kind: 'SERVICE_ACCOUNT', providerCode: 'fixture-provider',
  authorityReference: 'directory-fixture', principalReference: 'account-fixture' });
const capability = { field: 'CAPABILITY', capabilityReference: 'call-api' };
const requested = { field: 'REQUESTED_SCOPE', scopeReference: 'catalog.read', resourceReference: 'catalog' };
const declaredEndpoint = { field: 'DECLARED_CONNECTIVITY', endpoint: 'https://catalog.invalid/v1', protocol: { kind: 'API', family: 'UNKNOWN' } };
const temporal = [
  { field: 'PRINCIPAL', principal },
  { field: 'ROLE_REFERENCE', principal, roleReference: 'reader' },
  { field: 'GRANTED_SCOPE', principal, scopeReference: 'catalog.read', resourceReference: 'catalog' },
  { field: 'PERMISSION', principal, actionReference: 'read', resourceReference: 'catalog', state: 'UNKNOWN' },
  { field: 'ENVIRONMENT', environment: 'UNKNOWN' },
  { field: 'NETWORK_CONTEXT', networkReference: 'network-fixture', vpcReference: 'vpc-fixture' },
  { field: 'EGRESS', egressReference: 'egress-policy-fixture' },
  { field: 'DEPLOYMENT_CONNECTIVITY', endpoint: 'https://catalog.invalid/v1', protocol: { kind: 'MCP', transport: 'STREAMABLE_HTTP' }, classification: 'UNKNOWN' },
];

test('foundation adds no canonical kind or relationship type', () => {
  assert.equal(Object.keys(CANONICAL_OBJECT_KIND).length, 11);
  assert.equal(Object.keys(GOVERNED_RELATIONSHIP_TYPE).length, 12);
});
test('declared capability/requested scope remain their own facts without authority/grants', () => {
  assert.deepEqual(createExecutionFact(capability), capability);
  assert.deepEqual(createExecutionFact(requested), requested);
  assert.equal(classifyExecutionFact(capability), 'BEHAVIOR_VERSIONED');
  assert.equal(classifyExecutionFact(requested), 'BEHAVIOR_VERSIONED');
});
test('all temporal kinds are excluded from declared behavior input', () => {
  for (const fact of temporal) {
    assert.equal(classifyExecutionFact(fact), 'EXECUTION_CONTEXT_TEMPORAL');
    assert.throws(() => declaredExecutionSemanticValues([fact]), { message: 'INVALID_EXECUTION_FACT' });
  }
});
test('endpoint role is explicit; protocol UNKNOWN remains UNKNOWN despite port', () => {
  const value = { ...declaredEndpoint, endpoint: 'https://catalog.invalid:443/v1' };
  assert.equal(createExecutionFact(value).protocol.family, 'UNKNOWN');
  assert.equal(classifyExecutionFact(value), 'BEHAVIOR_VERSIONED');
  assert.equal(classifyExecutionFact(temporal.at(-1)), 'EXECUTION_CONTEXT_TEMPORAL');
});
test('capability and requested-scope changes change prospective semantic input', () => {
  for (const [original, changed] of [
    [capability, { ...capability, capabilityReference: 'read-catalog' }],
    [requested, { ...requested, scopeReference: 'catalog.write' }],
    [declaredEndpoint, { ...declaredEndpoint, endpoint: 'https://catalog.invalid/v2' }],
  ]) assert.notDeepEqual(declaredExecutionSemanticValues([original]), declaredExecutionSemanticValues([changed]));
});
test('semantic projection is stable under property order, repetition and input order', () => {
  assert.deepEqual(declaredExecutionSemanticValues([capability, requested, capability]),
    declaredExecutionSemanticValues([{ resourceReference: 'catalog', scopeReference: 'catalog.read', field: 'REQUESTED_SCOPE' },
      { capabilityReference: 'call-api', field: 'CAPABILITY' }]));
});
test('projection excludes provenance by rejecting fields outside the closed semantic shape', () => {
  for (const extra of [{ evidenceId: 'e' }, { timestamp: 'now' }, { trustState: 'OBSERVED' }, { organisationId: 'foreign' },
    { policyVersion: 'v2' }, { valueJson: {} }, { confidence: 1 }]) {
    assert.throws(() => declaredExecutionSemanticValues([{ ...capability, ...extra }]), { message: 'INVALID_EXECUTION_FACT' });
  }
});
test('principal variants preserve provider/authority/reference identity independently', () => {
  for (const kind of ['SERVICE_ACCOUNT', 'OAUTH_CLIENT', 'MANAGED_IDENTITY', 'WORKLOAD_IDENTITY', 'USER_DELEGATED']) {
    const fact = createExecutionFact({ field: 'PRINCIPAL', principal: { ...principal, kind } });
    assert.equal(fact.principal.kind, kind);
    assert.equal(fact.principal.authorityReference, principal.authorityReference);
    assert.ok(Object.isFrozen(fact.principal));
  }
});
test('human directory/group/connector credential shapes are not principal references', () => {
  for (const value of [{ email: 'synthetic@example.invalid', groups: ['AI'] },
    { provider: 'fixture', clientId: 'connector', clientSecret: 'synthetic' },
    { ...principal, kind: 'GROUP' }, { ...principal, kind: 'IAM_ROLE' }, { ...principal, jobTitle: 'AI' }]) {
    assert.throws(() => createExecutionFact({ field: 'PRINCIPAL', principal: value }), { message: 'INVALID_EXECUTION_FACT' });
  }
});
test('role reference is retained independently and never resolves a permission', () => {
  const value = createExecutionFact(temporal[1]);
  assert.equal(value.field, 'ROLE_REFERENCE');
  assert.equal(Object.hasOwn(value, 'state'), false);
});
test('explicit permission tuple preserves UNKNOWN and does not default missing state', () => {
  const permission = temporal[3];
  for (const state of ['UNKNOWN', 'ALLOWED', 'DENIED']) assert.equal(createExecutionFact({ ...permission, state }).state, state);
  const { state, ...missing } = permission;
  assert.throws(() => createExecutionFact(missing), { message: 'INVALID_EXECUTION_FACT' });
  const { principal: ignored, ...unbound } = permission;
  assert.throws(() => createExecutionFact(unbound), { message: 'INVALID_EXECUTION_FACT' });
});
test('missing environment or protocol is rejected rather than guessed', () => {
  assert.throws(() => createExecutionFact({ field: 'ENVIRONMENT' }), { message: 'INVALID_EXECUTION_FACT' });
  assert.throws(() => createExecutionFact({ ...declaredEndpoint, protocol: {} }), { message: 'INVALID_EXECUTION_FACT' });
  assert.throws(() => createExecutionFact({ field: 'ENVIRONMENT', environment: 'prod-east' }), { message: 'INVALID_EXECUTION_FACT' });
});
test('unknown fields, effects and protocol synonyms fail closed', () => {
  for (const fact of [{ field: 'CUSTOM', value: 'x' }, { ...capability, permission: 'read' },
    { ...temporal[3], state: 'NOT_AUTHORIZED' }, { ...declaredEndpoint, protocol: { kind: 'API', family: 'HTTPS' } }]) {
    assert.throws(() => createExecutionFact(fact), { message: 'INVALID_EXECUTION_FACT' });
  }
});
test('credential fields and recognizable credential material fail with value-free errors', () => {
  // Synthetic sentinels only. Assertions print no rejected value.
  for (const value of ['client_secret=synthetic', 'api_key=synthetic', 'access_token=synthetic',
    'Bearer synthetic', 'Basic synthetic', 'password=synthetic', 'Authorization=synthetic',
    'refresh-token=synthetic', 'cookie=synthetic', '-----BEGIN PRIVATE KEY-----',
    'eyJfixture.signature', 'sk-syntheticfixture']) {
    assert.throws(() => createExecutionFact({ field: 'PRINCIPAL', principal: { ...principal, principalReference: value } }),
      { name: 'TypeError', message: 'INVALID_EXECUTION_FACT' });
  }
  for (const field of ['clientSecret', 'apiKey', 'token', 'privateKey', 'rawAttributes']) {
    assert.throws(() => createExecutionFact({ field: 'PRINCIPAL', principal: { ...principal, [field]: 'synthetic' } }),
      { message: 'INVALID_EXECUTION_FACT' });
  }
});
test('credential URLs, query/fragment payloads and command/file endpoints are rejected', () => {
  for (const endpoint of ['https://user:synthetic@catalog.invalid/v1', 'https://catalog.invalid/v1?token=synthetic',
    'https://catalog.invalid/v1#synthetic', 'file:///tmp/catalog', 'npx-server', 'https://catalog.invalid/api_key=synthetic',
    'https://catalog.invalid/api%5fkey%3dsynthetic']) {
    assert.throws(() => createExecutionFact({ ...declaredEndpoint, endpoint }), { message: 'INVALID_EXECUTION_FACT' });
  }
});
test('nested values are copied and frozen without mutating input', () => {
  const input = { field: 'PRINCIPAL', principal: { ...principal } };
  const copy = createExecutionFact(input);
  input.principal.principalReference = 'changed';
  assert.equal(copy.principal.principalReference, 'account-fixture');
  assert.ok(Object.isFrozen(copy));
});
test('accessors and arrays are rejected without evaluating untrusted getters', () => {
  let calls = 0;
  for (const value of [[], { get field() { calls++; return 'CAPABILITY'; } },
    { ...declaredEndpoint, protocol: { get kind() { calls++; return 'API'; }, family: 'HTTP' } },
    { field: 'PRINCIPAL', principal: { ...principal, get kind() { calls++; return 'SERVICE_ACCOUNT'; } } }]) {
    assert.throws(() => createExecutionFact(value), { message: 'INVALID_EXECUTION_FACT' });
  }
  assert.equal(calls, 0);
});
