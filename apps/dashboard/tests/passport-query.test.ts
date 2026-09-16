import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { asOrganisationId, sourceObjectIdentityKey } from '@council/canonical-contracts';
import { executionDigest } from '@council/governance-review';
import { currentFieldState, PASSPORT_FAMILIES } from '@/lib/governance/agent-passport';

type Row = Record<string, unknown>;
const org = asOrganisationId('11111111-1111-1111-1111-111111111111');
const otherOrg = asOrganisationId('22222222-2222-2222-2222-222222222222');
const at = '2026-09-14T12:00:00.000Z';
let tables: Record<string, Row[]>;
let calls: { table: string; filters: [string, unknown][]; selection: string }[];
let dbError: string | undefined;
const db = { from(table: string) {
  const call = { table, filters: [] as [string, unknown][], selection: '*' };
  calls.push(call);
  let start = 0, end = 999, single = false;
  const query = {
    select(columns: string) { call.selection = columns; return query; },
    eq(key: string, value: unknown) { call.filters.push([key, value]); return query; },
    is(key: string, value: unknown) { call.filters.push([key, value]); return query; },
    in(key: string, values: unknown[]) { call.filters.push([key, values]); return query; },
    order() { return query; },
    limit(n: number) { end = n - 1; return query; },
    range(a: number, b: number) { start = a; end = b; return query; },
    maybeSingle() { single = true; return query; },
    then(resolve: (result: unknown) => unknown) {
      const rows = (tables[table] ?? []).filter(row => call.filters.every(([key, value]) =>
        Array.isArray(value) ? value.includes(row[key]) : (row[key] ?? null) === value)).slice(start, end + 1)
        .map(row => Object.fromEntries(call.selection.split(',').map(key => key.trim()).map(key => [key, row[key]])));
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: dbError === table ? { message: 'fixture failure' } : null }).then(resolve);
    },
  };
  return query;
}, rpc() { throw new Error('WRITE / RPC FORBIDDEN'); } };
let getPassport: typeof import('@/lib/governance/passport-query').getAgentPassport;
before(async () => {
  mock.method(Date, 'now', () => Date.parse('2026-09-15T00:00:00.000Z'));
  mock.module('@/lib/governance/persistence', { namedExports: { privilegedDb: db } });
  getPassport = (await import('@/lib/governance/passport-query')).getAgentPassport;
});
const row = (fields: Row): Row => ({ organisation_id: org, ...fields });
function add(table: string, fields: Row) { (tables[table] ??= []).push(row(fields)); }
function addObject(id: string, kind: string, tenant = org) {
  add('canonical_objects', { organisation_id: tenant, canonical_object_id: id, kind, created_by_decision_id: `d:${id}`, created_at: at, revision: 0 });
  add('reconciliation_decisions', { organisation_id: tenant, decision_id: `d:${id}`, decided_at: at, outcome: 'CREATE_NEW' });
}
function addSupport(decision = 'd:agent', trust = 'DECLARED') {
  add('reconciliation_decision_assertions', { decision_id: decision, assertion_id: `assert:${decision}` });
  add('reconciliation_decision_evidence', { decision_id: decision, evidence_id: `evidence:${decision}` });
  add('source_assertions', { assertion_id: `assert:${decision}`, source_connection_id: 'repo', source_external_type: 'file', source_external_id: 'src/agent.ts',
    trust_state: trust, method_code: 'explicit-declaration', observed_at: at, recorded_at: at, run_id: 'run:1', confidence: 1 });
  add('discovery_evidence', { evidence_id: `evidence:${decision}`, handling: 'HASH_ONLY', captured_at: at, envelope: { secret: 'PROTECTED_PROMPT_DO_NOT_EXPOSE' } });
  add('acquisition_runs', { run_id: 'run:1', source_system_id: 'repository' });
}
function addVersion(id: string, parent = 'agent') {
  addObject(id, 'AGENT_VERSION');
  add('canonical_normalized_object_mappings', { mapping_id: `m:${id}`, canonical_object_id: id, canonical_object_kind: 'AGENT_VERSION',
    parent_canonical_object_id: parent, candidate_id: `candidate:${id}`, normalized_object_identity: `version:${id}`,
    source_connection_id: 'repo', source_external_type: 'file', source_external_id: 'src/agent.ts', created_by_decision_id: `d:${id}`, valid_from: at });
}
function addProfile(id = 'version:1') {
  add('agent_version_technical_profiles', { canonical_object_id: id, source_proposal_id: 'profile:proposal',
    behavior_fingerprint_algorithm: 'sha256', behavior_fingerprint_schema_version: 'v1', behavior_fingerprint_value: 'fingerprint',
    build_reference: null, runtime_framework_reference: 'framework-x', entrypoint_reference: null, configuration_reference: null,
    revision: 2, updated_at: at });
  addSupport(`d:${id}`, 'INFERRED');
  for (const field of ['runtimeFrameworkReference', 'behaviorFingerprint']) {
    add('agent_version_technical_profile_field_assertions', { canonical_object_id: id, field_name: field, assertion_id: `assert:d:${id}` });
    add('agent_version_technical_profile_field_evidence', { canonical_object_id: id, field_name: field, evidence_id: `evidence:d:${id}` });
  }
}
function addEdge(type = 'USES_MODEL', target = 'model', targetKind = 'MODEL', source = 'version:1', sourceKind = 'AGENT_VERSION') {
  const id = `edge:${source}:${type}:${target}`;
  add('canonical_relationships', { relationship_id: id, relationship_state_id: `state:${id}`, relationship_type: type,
    source_canonical_object_id: source, source_kind: sourceKind, target_canonical_object_id: target, target_kind: targetKind,
    valid_from: at, valid_to: null, recorded_at: at, revision: 0, created_by_decision_id: `d:${id}` });
  add('reconciliation_decisions', { decision_id: `d:${id}`, decided_at: at, outcome: 'CREATE_NEW' });
  addSupport(`d:${id}`, 'DECLARED');
}
function addData() {
  addVersion('version:1'); addObject('column', 'DATA_ELEMENT'); addEdge('READS_FROM', 'column', 'DATA_ELEMENT');
  add('canonical_normalized_object_mappings', { mapping_id: 'm:column', canonical_object_id: 'column', canonical_object_kind: 'DATA_ELEMENT',
    parent_canonical_object_id: null, candidate_id: 'candidate:column', normalized_object_identity: 'column-exact',
    source_connection_id: 'purview', source_external_type: 'sql_column', source_external_id: 'column-guid', created_by_decision_id: 'd:column', valid_from: at });
  for (const [id, value] of [['p:old','old-type'], ['p:current','varchar(100)'], ['p:competing','secret-new-value']]) {
    add('technical_fact_proposals', { proposal_id: id, object_kind: 'DATA_ELEMENT', field_key: 'dataType.nativeType', native_type: value,
      connection_id: 'purview', source_system_id: 'system:purview', external_type: 'sql_column', external_id: 'column-guid',
      normalized_object_identity: 'column-exact', trust_state: 'IMPORTED' });
  }
  add('technical_field_states', { state_id: 's:old', previous_state_id: null, canonical_object_id: 'column', object_kind: 'DATA_ELEMENT', field_key: 'dataType.nativeType',
    proposal_id: 'p:old', decision_id: 'fd:old', recorded_at: '2099-01-01T00:00:00Z' });
  add('technical_field_states', { state_id: 's:current', previous_state_id: 's:old', canonical_object_id: 'column', object_kind: 'DATA_ELEMENT', field_key: 'dataType.nativeType',
    proposal_id: 'p:current', decision_id: 'fd:current', recorded_at: at });
  add('technical_field_decisions', { decision_id: 'fd:current', canonical_object_id: 'column', object_kind: 'DATA_ELEMENT', field_key: 'dataType.nativeType', proposal_id: 'p:current',
    outcome: 'ACCEPT_PROPOSED', policy_id: 'policy', policy_version: 'v1', decided_at: at, expected_source_observation_id: 'obs:accepted', expected_source_snapshot_id: 'snapshot:accepted' });
  add('technical_field_policy_heads', { policy_id: 'policy', version: 'v2' });
  add('technical_fact_observations', { observation_id: 'obs:accepted', proposal_id: 'p:current', snapshot_id: 'snapshot:accepted', observed_at: at });
  addSupport('field', 'IMPORTED');
  add('technical_fact_observation_assertions', { observation_id: 'obs:accepted', assertion_id: 'assert:field' });
  add('technical_fact_observation_evidence', { observation_id: 'obs:accepted', evidence_id: 'evidence:field' });
}
beforeEach(() => { tables = {}; calls = []; dbError = undefined; addObject('agent','AGENT'); });
const section = (p: NonNullable<Awaited<ReturnType<typeof getPassport>>>, id: string) => p.families.find(f => f.id === id)!;

function addExecution(accepted = true) {
  addVersion('version:1');
  const candidate = `candidate:agent-version:${'a'.repeat(32)}`;
  tables.canonical_normalized_object_mappings[0].normalized_object_identity = candidate;
  const source = { connectionId: 'repo', externalType: 'file', externalId: 'src/agent.ts' };
  const scope = executionDigest([sourceObjectIdentityKey(source as never),'triageAgent']);
  const facts = [
    { field:'PRINCIPAL',principal:{kind:'SERVICE_ACCOUNT',providerCode:'fixture',authorityReference:'realm',principalReference:'account'} },
    { field:'DECLARED_CONNECTIVITY',endpoint:'https://catalog.invalid/',protocol:{kind:'API',family:'HTTP'} },
    { field:'REQUESTED_SCOPE',scopeReference:'catalog.read',resourceReference:'catalog' },
    { field:'CAPABILITY',capabilityReference:'classifyRequest' },
  ];
  const items = facts.map((fact,i)=>({fact,assertionId:`assert:exec:${i}`,evidenceId:`evidence:exec:${i}`,...(fact.field==='CAPABILITY'?{toolCandidateId:'tool-candidate'}:{})}));
  const id = `execution-snapshot:${executionDigest([org,scope,candidate,'source-snapshot',items])}`;
  add('execution_source_snapshots',{snapshot_id:id,source_scope:scope,candidate_id:candidate,connection_id:'repo',source_system_id:'repository',provider_code:'fixture',
    external_type:'file',external_id:'src/agent.ts',declaration_key:'triageAgent',source_snapshot_id:'source-snapshot',fingerprint_value:'b'.repeat(32),fingerprint_schema:'1.1',authorization_state:'UNKNOWN',recorded_at:at});
  add('execution_source_heads',{source_scope:scope,snapshot_id:id});
  items.forEach((item,i)=>{
    const f=item.fact;
    add('execution_source_facts',{snapshot_id:id,ordinal:i,field_key:f.field,assertion_id:item.assertionId,evidence_id:item.evidenceId,
      principal_kind:f.principal?.kind,principal_provider:f.principal?.providerCode,principal_authority:f.principal?.authorityReference,principal_reference:f.principal?.principalReference,
      endpoint:f.endpoint,protocol_kind:f.protocol?.kind,protocol_value:f.protocol?.family,scope_reference:f.scopeReference,resource_reference:f.resourceReference,
      capability_reference:f.capabilityReference,tool_candidate_id:item.toolCandidateId});
    addSupport(`exec:${i}`);
    tables.source_assertions.at(-1)!.method_code='DIRECT_AGENT_EXECUTION_V1';
    add('execution_field_policies',{policy_id:`policy:${i}`,version:'1',field_key:f.field,source_system_id:'repository',provider_code:'fixture',disposition:'CONTRIBUTING'});
    add('execution_field_policy_heads',{policy_id:`policy:${i}`,version:'1'});
    if(accepted){
      add('execution_field_decisions',{decision_id:`exec-decision:${i}`,canonical_object_id:'version:1',snapshot_id:id,field_key:f.field,
        expected_current_state_id:null,policy_id:`policy:${i}`,policy_version:'1',outcome:'ACCEPT_PROPOSED',actor_reference:'reviewer',decided_at:at});
      add('execution_field_states',{state_id:`exec-state:${i}`,canonical_object_id:'version:1',field_key:f.field,snapshot_id:id,decision_id:`exec-decision:${i}`,previous_state_id:null,recorded_at:at});
    }
  });
  return id;
}

test('M13 accepted fields populate families 15/16 with UNKNOWN authorization and declared provenance',async()=>{
  addExecution();const p=(await getPassport(org,'agent','version:1'))!;
  assert.equal(section(p,'authorization').facts.length,3);assert.equal(section(p,'connectivity').facts.length,1);
  for(const id of ['authorization','connectivity']){
    const family=section(p,id);assert.equal(family.status,'PARTIAL');
    assert.ok(family.facts.every(f=>f.type==='execution'&&f.authorizationState==='UNKNOWN'&&f.versionId==='version:1'&&f.provenance.authority==='GOVERNED_FIELD_STATE'));
  }
  assert.equal(section(p,'runtime').status,'UNKNOWN');
  assert.ok(calls.every(c=>c.filters.some(([key,value])=>key==='organisation_id'&&value===org)));
  assert.ok(calls.every(c=>!c.selection.split(',').includes('envelope')));
});
test('M13 proposal alone cannot become Passport governed truth',async()=>{
  addExecution(false);const p=(await getPassport(org,'agent','version:1'))!;
  assert.equal(section(p,'authorization').status,'UNKNOWN');assert.equal(section(p,'connectivity').status,'UNKNOWN');
});
test('M13 governed fields require explicit selected version and never leak to another version',async()=>{
  addExecution();addVersion('version:2');
  for(const selected of [undefined,'version:2'])assert.equal(section((await getPassport(org,'agent',selected))!,'authorization').status,'UNKNOWN');
  assert.equal(await getPassport(otherOrg,'agent','version:1'),undefined);
});
for(const [name,table,change] of [
  ['foreign snapshot','execution_source_snapshots',{organisation_id:otherOrg}],
  ['foreign decision','execution_field_decisions',{organisation_id:otherOrg}],
  ['foreign evidence','discovery_evidence',{organisation_id:otherOrg}],
  ['unaccepted decision','execution_field_decisions',{outcome:'DEFER'}],
  ['wrong decision version','execution_field_decisions',{canonical_object_id:'version:other'}],
  ['wrong predecessor','execution_field_decisions',{expected_current_state_id:'unrelated'}],
  ['non-authoritative policy','execution_field_policies',{disposition:'NON_AUTHORITATIVE'}],
  ['wrong policy source','execution_field_policies',{provider_code:'other'}],
  ['wrong assertion method','source_assertions',{method_code:'copresence'}],
] as const)test(`M13 ${name} fails closed`,async()=>{
  addExecution();Object.assign(tables[table][0],change);
  await assert.rejects(getPassport(org,'agent','version:1'),/EXECUTION_/);
});
test('M13 foreign state cannot materialize local Passport facts',async()=>{
  addExecution();for(const state of tables.execution_field_states)state.organisation_id=otherOrg;
  assert.equal(section((await getPassport(org,'agent','version:1'))!,'authorization').status,'UNKNOWN');
});
test('M13 immutable historical acceptance survives policy head evolution',async()=>{
  addExecution();tables.execution_field_policy_heads=[];
  assert.equal(section((await getPassport(org,'agent','version:1'))!,'authorization').facts.length,3);
});

test('canonical root has exact tenant/kind/ID and exactly 16 ordered families', async () => {
  const p = (await getPassport(org, 'agent'))!;
  assert.equal(p.canonicalAgent.objectId, 'agent'); assert.equal(p.canonicalAgent.organisationId, org);
  assert.deepEqual(p.families.map(f => f.id), PASSPORT_FAMILIES.map(f => f[0])); assert.equal(p.families.length, 16);
  assert.ok(p.families.every(f => ['KNOWN','PARTIAL','UNKNOWN'].includes(f.status))); assert.equal(section(p,'identity').status,'KNOWN');
  assert.ok(!p.families.some(f => /risk/i.test(f.id))); assert.equal(p.displayName, null);
});
for (const kind of ['MODEL','TOOL','AGENT_VERSION']) test(`${kind} fails closed as Passport root`, async () => {
  addObject('wrong',kind); assert.equal(await getPassport(org,'wrong'),undefined);
});
test('unknown and legacy-only identifiers never resolve, even with matching name/code', async () => {
  add('agents',{agent_id:'legacy',agent_code:'agent',name:'Synthetic Name',owner_user_id:'owner',business_domain:'Finance',model_name:'legacy-model'});
  assert.equal(await getPassport(org,'missing'),undefined); assert.equal(await getPassport(org,'legacy'),undefined);
  assert.ok(!calls.some(c => c.table === 'agents'));
});
test('another tenant cannot read the canonical root', async () => { assert.equal(await getPassport(otherOrg,'agent'),undefined); });
test('all queries, including exact lookup, scope organisation', async () => {
  addData(); await getPassport(org,'agent','version:1');
  assert.ok(calls.length > 10); assert.ok(calls.every(c => c.filters.some(([k,v]) => k === 'organisation_id' && v === org)));
});
test('missing owner/business/privacy/runtime/authz/connectivity remain UNKNOWN despite legacy values', async () => {
  add('agents',{ agent_id:'agent',owner_user_id:'owner',business_domain:'Finance',status:'active',approved_for_production:true });
  const p = (await getPassport(org,'agent'))!;
  for (const id of ['ownership','business','privacy','runtime','authorization','connectivity']) {
    assert.equal(section(p,id).status,'UNKNOWN'); assert.deepEqual(section(p,id).facts,[]);
  }
  assert.ok(!JSON.stringify(p).includes('Finance')); assert.ok(!JSON.stringify(p).includes('approved_for_production'));
});
test('multiple versions are listed separately; neither latest nor single version is selected implicitly', async () => {
  addVersion('version:1'); assert.equal((await getPassport(org,'agent'))!.selectedVersionId,null);
  addVersion('version:2'); addProfile();
  const p = (await getPassport(org,'agent'))!;
  assert.deepEqual(p.versionContexts.map(v => v.objectId),['version:1','version:2']);
  assert.equal(p.currentVersionId,null); assert.equal(p.selectedVersionId,null); assert.equal(section(p,'technology').status,'UNKNOWN');
  assert.ok(p.versionContexts.every(v => v.versionCode === null));
});
test('selected profile facts remain version-scoped, partial and INFERRED', async () => {
  addVersion('version:1'); addVersion('version:2'); addProfile();
  const p = (await getPassport(org,'agent','version:1'))!;
  const tech = section(p,'technology'); assert.equal(tech.status,'PARTIAL');
  assert.equal(tech.facts[0].type,'profile');
  assert.ok(tech.facts.every(f => f.type === 'profile' && f.versionId === 'version:1'));
  assert.equal(tech.facts[0].provenance.sources[0].trust,'INFERRED');
  assert.equal(section((await getPassport(org,'agent','version:2'))!,'technology').status,'UNKNOWN');
});
test('ambiguous or missing parent association is excluded without blocking root', async () => {
  addVersion('v'); add('canonical_normalized_object_mappings',{...tables.canonical_normalized_object_mappings[0],mapping_id:'m:other',parent_canonical_object_id:'other-agent'});
  assert.deepEqual((await getPassport(org,'agent'))!.versionContexts,[]); assert.equal(await getPassport(org,'agent','v'),undefined);
  tables.canonical_normalized_object_mappings=[]; assert.deepEqual((await getPassport(org,'agent'))!.versionContexts,[]);
});
test('foreign version and mapping cannot enter local version contexts', async () => {
  addVersion('foreign-version'); tables.canonical_objects.find(r => r.canonical_object_id === 'foreign-version')!.organisation_id=otherOrg;
  assert.deepEqual((await getPassport(org,'agent'))!.versionContexts,[]);
});
test('governed MODEL and TOOL edges populate the selected version', async () => {
  addVersion('version:1'); addObject('model','MODEL'); addObject('tool','TOOL'); addEdge(); addEdge('USES_TOOL','tool','TOOL');
  const p = (await getPassport(org,'agent','version:1'))!;
  assert.equal(section(p,'model').facts.length,1); assert.equal(section(p,'tools').facts.length,1);
  assert.equal(section(p,'authorization').status,'UNKNOWN'); assert.equal(section(p,'connectivity').status,'UNKNOWN');
});
test('foreign canonical target is not surfaced through a local edge', async () => {
  addVersion('version:1'); addObject('foreign-model','MODEL',otherOrg); addEdge('USES_MODEL','foreign-model');
  assert.equal(section((await getPassport(org,'agent','version:1'))!,'model').facts.length,0);
});
test('foreign relationship itself is excluded', async () => {
  addVersion('version:1'); addObject('model','MODEL'); addEdge(); tables.canonical_relationships[0].organisation_id=otherOrg;
  assert.equal(section((await getPassport(org,'agent','version:1'))!,'model').status,'UNKNOWN');
});
test('ended relationships are not presented as active access', async () => {
  addData(); tables.canonical_relationships[0].valid_to=at;
  const p = (await getPassport(org,'agent','version:1'))!; assert.equal(section(p,'data').status,'UNKNOWN');
});
test('DERIVED_FROM alone never establishes Agent access or imports unrelated data', async () => {
  addVersion('version:1'); addObject('left','DATA_ELEMENT'); addObject('right','DATA_ELEMENT'); addEdge('DERIVED_FROM','right','DATA_ELEMENT','left','DATA_ELEMENT');
  const p = (await getPassport(org,'agent','version:1'))!;
  assert.equal(section(p,'data').status,'UNKNOWN'); assert.equal(section(p,'relationships').facts.length,0);
  assert.ok(section(p,'data').unknowns.some(g => g.startsWith('READS_FROM: UNKNOWN')));
  assert.ok(section(p,'data').unknowns.some(g => g.startsWith('WRITES_TO: UNKNOWN')));
});
test('governed access permits one-hop data lineage without creating a second access claim', async () => {
  addData(); addObject('upstream','DATA_ELEMENT'); addEdge('DERIVED_FROM','upstream','DATA_ELEMENT','column','DATA_ELEMENT');
  const p = (await getPassport(org,'agent','version:1'))!;
  assert.ok(section(p,'relationships').facts.some(f => f.type === 'relationship' && f.relationshipType === 'DERIVED_FROM'));
  assert.ok(!section(p,'data').facts.some(f => f.type === 'relationship' && f.targetId === 'upstream'));
});
test('M10 linear head wins over newer timestamps and competing imported observations', async () => {
  addData(); const p = (await getPassport(org,'agent','version:1'))!;
  const fact=section(p,'data').facts.find(f => f.type === 'data-field')!;
  assert.equal(fact.type,'data-field'); if(fact.type !== 'data-field') return;
  assert.equal(fact.fact.value,'varchar(100)'); assert.equal(fact.stateId,'s:current'); assert.equal(fact.source.trust,'IMPORTED');
  assert.ok(fact.competingProposalIds.includes('p:competing')); assert.ok(!JSON.stringify(p).includes('secret-new-value'));
  assert.equal(fact.provenance.policy?.acceptedVersion,'v1'); assert.equal(fact.provenance.policy?.activeVersion,'v2');
  assert.equal(fact.provenance.snapshotId,'snapshot:accepted'); assert.equal(fact.provenance.sources[0].trust,'IMPORTED');
});
test('raw imported proposals alone never populate accepted fields', async () => {
  addData(); tables.technical_field_states=[];
  const p = (await getPassport(org,'agent','version:1'))!;
  assert.ok(!section(p,'data').facts.some(f => f.type === 'data-field')); assert.ok(!JSON.stringify(p).includes('varchar(100)'));
});
test('M10 fields without an Agent access binding stay out of Passport', async () => {
  addData(); tables.canonical_relationships=[];
  assert.equal(section((await getPassport(org,'agent','version:1'))!,'data').status,'UNKNOWN');
  assert.ok(!calls.some(c => c.table === 'technical_fact_proposals'));
});
test('foreign M10 state is excluded', async () => {
  addData(); tables.technical_field_states.forEach(s => s.organisation_id=otherOrg);
  assert.ok(!section((await getPassport(org,'agent','version:1'))!,'data').facts.some(f=>f.type==='data-field'));
});
test('invalid accepted-state decision fails closed', async () => {
  addData(); tables.technical_field_decisions[0].outcome='DEFER'; await assert.rejects(getPassport(org,'agent','version:1'),/FIELD_STATE_INVALID/);
});
test('foreign accepted evidence cannot hydrate a governed field', async () => {
  addData(); tables.discovery_evidence.find(e => e.evidence_id === 'evidence:field')!.organisation_id=otherOrg;
  await assert.rejects(getPassport(org,'agent','version:1'),/SUPPORT_MISSING/);
});
test('field source snapshot must match the accepted decision', async () => {
  addData(); tables.technical_fact_observations[0].snapshot_id='unreviewed'; await assert.rejects(getPassport(org,'agent','version:1'),/OBSERVATION_INVALID/);
});
for (const trust of ['INFERRED','DECLARED','IMPORTED','OBSERVED','VALIDATED']) test(`source trust ${trust} is preserved independently of coverage`, async () => {
  addSupport('d:agent',trust); const p = (await getPassport(org,'agent'))!;
  assert.equal(p.canonicalAgent.provenance.sources[0].trust,trust); assert.equal(section(p,'identity').status,'KNOWN');
});
test('unknown trust vocabulary is rejected regardless of confidence', async () => {
  addSupport('d:agent','VERIFIED'); await assert.rejects(getPassport(org,'agent'),/TRUST_INVALID/);
});
test('foreign assertion/evidence do not leak and protected Prompt envelopes are never selected', async () => {
  addSupport(); tables.discovery_evidence[0].organisation_id=otherOrg; tables.source_assertions[0].organisation_id=otherOrg;
  const p = (await getPassport(org,'agent'))!;
  assert.deepEqual(p.canonicalAgent.provenance.sources,[]); assert.deepEqual(p.canonicalAgent.provenance.evidence,[]);
  assert.ok(!JSON.stringify(p).includes('PROTECTED_PROMPT')); assert.ok(calls.every(c => !c.selection.includes('envelope')));
});
test('discovery mappings preserve source, method, evidence and decision times', async () => {
  addVersion('version:1'); addSupport('d:version:1');
  const p = (await getPassport(org,'agent','version:1'))!;
  const discovery=section(p,'discovery'); assert.equal(discovery.facts.length,1);
  assert.equal(discovery.facts[0].provenance.sources[0].method,'explicit-declaration'); assert.equal(discovery.facts[0].provenance.decidedAt,at);
});
test('canonical objects and versions page past 200 rows without choosing a latest version', async () => {
  for(let i=0;i<201;i++) addVersion(`v:${String(i).padStart(3,'0')}`);
  const p=(await getPassport(org,'agent'))!; assert.equal(p.versionContexts.length,201); assert.equal(p.currentVersionId,null);
});
test('storage failure is an error, not false UNKNOWN success', async () => {
  dbError='canonical_normalized_object_mappings'; await assert.rejects(getPassport(org,'agent'),/PASSPORT_READ_FAILED/);
});
test('read composition completes against a store with no writes, command methods, providers or LLM', async () => {
  addData(); addProfile(); const p=(await getPassport(org,'agent','version:1'))!; assert.equal(p.families.length,16);
  assert.ok(calls.every(c => !['agents','outbox_events','reconciliation_command_locks'].includes(c.table)));
});
test('current-state selection rejects forks, cycles and disconnected histories', () => {
  assert.equal(currentFieldState([]),undefined);
  assert.equal(currentFieldState([{state_id:'a',previous_state_id:null},{state_id:'b',previous_state_id:'a'}])?.state_id,'b');
  for (const history of [
    [{state_id:'a',previous_state_id:null},{state_id:'b',previous_state_id:'a'},{state_id:'c',previous_state_id:'a'}],
    [{state_id:'a',previous_state_id:'b'},{state_id:'b',previous_state_id:'a'}],
    [{state_id:'a',previous_state_id:null},{state_id:'b',previous_state_id:'missing'}],
  ]) assert.throws(()=>currentFieldState(history),/HISTORY_AMBIGUOUS/);
});

test('switching version changes only the view and preserves relationship direction', async () => {
  addVersion('version:1'); addVersion('version:2'); addObject('model:1','MODEL'); addObject('model:2','MODEL');
  addEdge('USES_MODEL','model:1','MODEL','version:1'); addEdge('USES_MODEL','model:2','MODEL','version:2');
  const before = structuredClone(tables);
  const first = (await getPassport(org,'agent','version:1'))!;
  const second = (await getPassport(org,'agent','version:2'))!;
  assert.equal(first.canonicalAgent.objectId, second.canonicalAgent.objectId);
  for (const [p, version, model] of [[first,'version:1','model:1'],[second,'version:2','model:2']] as const) {
    const facts = section(p,'model').facts;
    assert.equal(facts.length,1);
    assert.ok(facts.every(f => f.type === 'relationship' && f.sourceId === version && f.targetId === model && f.versionId === version));
  }
  assert.deepEqual(tables,before);
});

test('empty, unknown and foreign selected versions fail closed', async () => {
  addVersion('version:1');
  for (const version of ['', ' ', 'missing']) assert.equal(await getPassport(org,'agent',version),undefined);
  tables.canonical_normalized_object_mappings[0].organisation_id=otherOrg;
  assert.equal(await getPassport(org,'agent','version:1'),undefined);
});

test('future relationship start cannot establish active access', async () => {
  addData(); tables.canonical_relationships[0].valid_from='2099-01-01T00:00:00Z';
  const p=(await getPassport(org,'agent','version:1'))!;
  assert.equal(section(p,'data').status,'UNKNOWN');
  assert.ok(!calls.some(c=>c.table==='technical_fact_proposals'));
});

test('scheduled relationship end retains active fact and explicit validity end', async () => {
  addData(); tables.canonical_relationships[0].valid_to='2099-01-01T00:00:00Z';
  const p=(await getPassport(org,'agent','version:1'))!;
  assert.equal(section(p,'data').facts[0].provenance.validTo,'2099-01-01T00:00:00Z');
});

test('invalid relationship temporal state fails closed', async () => {
  addData(); tables.canonical_relationships[0].valid_from='invalid';
  await assert.rejects(getPassport(org,'agent','version:1'),/TEMPORAL_STATE_INVALID/);
});

test('future governed mapping does not establish an available AgentVersion', async () => {
  addVersion('version:1'); tables.canonical_normalized_object_mappings[0].valid_from='2099-01-01T00:00:00Z';
  assert.deepEqual((await getPassport(org,'agent'))!.versionContexts,[]);
  assert.equal(await getPassport(org,'agent','version:1'),undefined);
});

test('missing field policy head preserves historical acceptance without claiming current authority', async () => {
  addData(); tables.technical_field_policy_heads=[];
  const fact=section((await getPassport(org,'agent','version:1'))!,'data').facts.find(f=>f.type==='data-field')!;
  assert.equal(fact.provenance.policy?.acceptedVersion,'v1');
  assert.equal(fact.provenance.policy?.activeVersion,undefined);
  assert.equal(fact.type==='data-field' && fact.source.trust,'IMPORTED');
});

test('foreign accepted field decision and source mapping fail closed', async () => {
  addData(); tables.technical_field_decisions[0].organisation_id=otherOrg;
  await assert.rejects(getPassport(org,'agent','version:1'),/FIELD_STATE_INVALID/);
  tables.technical_field_decisions[0].organisation_id=org;
  tables.canonical_normalized_object_mappings.find(m=>m.canonical_object_id==='column')!.organisation_id=otherOrg;
  await assert.rejects(getPassport(org,'agent','version:1'),/FIELD_MAPPING_INVALID/);
});

test('unreviewed object identity cannot surface VALIDATED source support', async () => {
  addSupport('d:agent','VALIDATED'); tables.reconciliation_decisions[0].outcome='DEFER';
  await assert.rejects(getPassport(org,'agent'),/GOVERNANCE_SUPPORT_MISSING/);
});

test('persisted runtime observation is labeled source OBSERVED without inventing Agent runtime facts', async () => {
  addSupport('d:agent','OBSERVED');
  tables.source_assertions[0].method_code='runtime-observation-fixture';
  tables.source_assertions[0].source_external_type='runtime-trace';
  const p=(await getPassport(org,'agent'))!;
  assert.equal(p.canonicalAgent.provenance.sources[0].trust,'OBSERVED');
  assert.equal(p.canonicalAgent.provenance.sources[0].method,'runtime-observation-fixture');
  assert.equal(p.canonicalAgent.provenance.evidence.length,1);
  assert.equal(section(p,'runtime').status,'UNKNOWN');
});
