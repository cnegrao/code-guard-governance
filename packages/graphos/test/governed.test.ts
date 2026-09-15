import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { asOrganisationId, CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE,
  type SemanticRepresentation } from '@council/canonical-contracts';
import { compareSemanticRepresentations } from '../../scanner/src/semantic/similarity';
import { projectCanonicalGraph, governedNodeId, traverseCanonicalGraph,
  retrieveCanonicalVectors, buildAnalyticalContext, type CanonicalObjectRow, type CanonicalRelationshipRow } from '../governed';
import { GraphEngine } from '../src/engine';

const org = asOrganisationId('tenant-a'), other = asOrganisationId('tenant-b');
const at = '2026-09-14T12:00:00.000Z', before = '2026-09-14T11:00:00.000Z', after = '2026-09-14T13:00:00.000Z';
const object = (id: string, kind = 'DATA_ELEMENT', extra = {}): CanonicalObjectRow => ({ organisation_id: org,
  canonical_object_id: id, kind, created_by_decision_id: `decision:${id}`, created_at: before, revision: 0, ...extra } as CanonicalObjectRow);
const edge = (id: string, source: string, target: string, extra = {}): CanonicalRelationshipRow => ({ organisation_id: org,
  relationship_id: id, relationship_state_id: `state:${id}`, relationship_type: 'DERIVED_FROM',
  source_canonical_object_id: source, source_kind: 'DATA_ELEMENT', target_canonical_object_id: target, target_kind: 'DATA_ELEMENT',
  valid_from: before, valid_to: null, recorded_at: before, revision: 0, created_by_decision_id: `decision:${id}`, ...extra } as CanonicalRelationshipRow);
const project = (objects = [object('a'), object('b')], relationships = [edge('b-a', 'b', 'a')], asOf = at) =>
  projectCanonicalGraph({ organisationId: org, source: 'CANONICAL_PERSISTENCE', objects, relationships, asOf });
const rep = (id: string, subject = id, extra: Record<string, unknown> = {}): SemanticRepresentation => ({ organisationId: org,
  representationId: id, subject: { subjectKind: 'CANONICAL_OBJECT', organisationId: org, canonicalObjectId: subject, canonicalObjectKind: 'DATA_ELEMENT' },
  projectionSchemaVersion: 'projection-v1', contentFingerprint: { algorithm: 'sha256', schemaVersion: 'v1', value: `digest:${id}` },
  embeddingProvider: { providerId: 'test-only', modelId: 'fixture', modelVersion: 'v1', dimension: 2 },
  vector: [1, 0], support: { assertionIds: ['assertion'], evidenceIds: ['evidence'] }, generatedAt: before, ...extra } as unknown as SemanticRepresentation);
const vectors = (representations = [rep('a'), rep('b')], graph = project()) => retrieveCanonicalVectors({
  organisationId: org, graph, seedCanonicalObjectId: 'a', anchorRepresentationId: 'a', representations, minimumCosine: -1 });
const traverse = (graph = project(), policyVersion: any = 'GOVIA_BLAST_RADIUS_V1', maxDepth = 4, seed = 'a') =>
  traverseCanonicalGraph({ organisationId: org, graph, seedCanonicalObjectId: seed, maxDepth, policyVersion });
function hybrid() {
  const graph = project([object('a'), object('b'), object('c'), object('graph-only')],
    [edge('b-a','b','a'), edge('g-a','graph-only','a')]);
  return buildAnalyticalContext({ organisationId: org, graph, seedCanonicalObjectId: 'a', maxDepth: 3,
    vectorQuery: { anchorRepresentationId: 'anchor', minimumCosine: 0 },
    representations: [rep('anchor','a'), rep('b-v1','b'), rep('b-v2','b'), rep('c-v1','c')] });
}

test('01 canonical objects project all 11 closed kinds', () => {
  const graph = project(Object.values(CANONICAL_OBJECT_KIND).map(k => object(k, k)), []);
  assert.equal(graph.nodes.length, 11);
  assert.ok(graph.nodes.every(n => n.authority === 'CANONICAL_OBJECT_PROJECTION'));
});
test('02 all 12 canonical edge types enforce canonical endpoints', () => {
  const targets: Record<string, string> = { USES_MODEL: 'MODEL', USES_TOOL: 'TOOL', USES_MCP: 'MCP_SERVER', INVOKES: 'API',
    USES_PROMPT: 'PROMPT', USES_KNOWLEDGE_BASE: 'KNOWLEDGE_BASE', USES_SKILL: 'SKILL', HANDOFF_TO: 'AGENT',
    READS_FROM: 'DATA_ASSET', WRITES_TO: 'DATA_ELEMENT', DERIVED_FROM: 'DATA_ELEMENT', EXPOSES: 'TOOL' };
  for (const type of Object.values(GOVERNED_RELATIONSHIP_TYPE)) {
    const source = type === 'DERIVED_FROM' ? 'DATA_ELEMENT' : type === 'EXPOSES' ? 'MCP_SERVER' : 'AGENT_VERSION';
    const graph = project([object('s', source), object('t', targets[type])], [edge('r','s','t', {
      relationship_type: type, source_kind: source, target_kind: targets[type] })]);
    assert.equal(graph.edges[0].relationshipType, type);
  }
  assert.throws(() => project([object('a','AGENT'), object('b','MODEL')], [edge('x','a','b', {
    relationship_type: 'USES_MODEL', source_kind: 'AGENT', target_kind: 'MODEL' })]), /ENDPOINT/);
});
test('03 identity uses tenant and canonical ID, independent of display name/path', () => {
  const node = project([object('a','DATA_ELEMENT',{ displayName: 'SECRET', path: 'SECRET' })], []).nodes[0];
  assert.equal(node.nodeId, governedNodeId(org, 'a')); assert.equal(node.canonicalObjectId, 'a');
  assert.notEqual(node.nodeId, governedNodeId(other, 'a'));
});
test('04 relationship and state identity retained', () => {
  const e = project().edges[0]; assert.equal(e.canonicalRelationshipId,'b-a'); assert.equal(e.relationshipStateId,'state:b-a');
});
test('05 unknown canonical kind fails', () => assert.throws(() => project([object('a','EMBEDDING')], []), /UNKNOWN_KIND/));
test('06 arbitrary legacy relationship fails', () => assert.throws(() => project(undefined, [edge('x','b','a',{ relationship_type:'DEPENDS_ON' })]), /ENDPOINT/));
test('07 candidate alone cannot enter canonical graph', () => {
  assert.throws(() => project([{ candidate_id:'c', kind:'DATA_ELEMENT', organisation_id:org } as any], []));
  assert.throws(() => projectCanonicalGraph({ organisationId: org, source:'DISCOVERY' as any, asOf:at, objects:[], relationships:[] }), /SOURCE/);
});
test('08 PossibleMatch cannot enter canonical edges', () => assert.throws(() => project(undefined, [{ candidateId:'match', status:'ANALYTICAL' } as any])));
test('09 foreign object rejected', () => assert.throws(() => project([object('a','DATA_ELEMENT',{ organisation_id:other })], []), /TENANT/));
test('10 foreign edge and missing endpoint rejected', () => {
  assert.throws(() => project(undefined, [edge('x','b','a',{ organisation_id:other })]), /TENANT/);
  assert.throws(() => project(undefined, [edge('x','b','foreign')]), /ENDPOINT/);
});
test('11 future edge absent before valid_from', () => assert.equal(project(undefined,[edge('x','b','a',{valid_from:after})]).edges.length,0));
test('12 inclusive start and scheduled future end retained', () => {
  const graph = project(undefined,[edge('x','b','a',{valid_from:at,valid_to:after})]);
  assert.equal(graph.edges.length,1); assert.equal(graph.edges[0].validTo,after);
});
test('13 exclusive end, closed and invalid intervals', () => {
  assert.equal(project(undefined,[edge('x','b','a',{valid_to:at})]).edges.length,0);
  assert.throws(() => project(undefined,[edge('x','b','a',{valid_from:after,valid_to:before})]), /INTERVAL/);
  assert.throws(() => project(undefined,[edge('x','b','a',{valid_from:'bad'})]), /TIME/);
});
test('PostgreSQL microsecond intervals do not round future starts or premature closure', () => {
  const start='2026-09-14T12:00:00.000001Z', end='2026-09-14T12:00:00.000002Z';
  const rows=[edge('micro','b','a',{valid_from:start,valid_to:end})];
  assert.equal(project(undefined,rows,at).edges.length,0);
  assert.equal(project(undefined,rows,start).edges.length,1);
  assert.equal(project(undefined,rows,end).edges.length,0);
  assert.equal(project(undefined,rows,'2026-09-14T09:00:00.000001-03:00').edges.length,1);
  assert.throws(()=>project(undefined,undefined,'2026-02-30T00:00:00Z'),/TIME/);
});
test('14 exact compatible space compares raw cosine', () => assert.equal(vectors().neighbors[0].cosineScore,1));
for (const [number, field, value] of [[15,'providerId','different'],[16,'modelId','different'],[17,'modelVersion','v2'],[19,'dimension',3]] as const) {
  test(`${number} ${field} mismatch cannot compare or enter retrieval`, () => {
    const b = rep('b', 'b', { embeddingProvider: { ...rep('b').embeddingProvider, [field]:value }, vector: field === 'dimension' ? [1,0,0] : [1,0] });
    assert.equal(vectors([rep('a'),b]).neighbors.length,0);
    assert.throws(() => compareSemanticRepresentations({ organisationId:org, source:rep('a'), target:b, computedAt:at,
      policy:{ policyVersion:'test', comparisonFamily:'DATA_ELEMENT', metric:'COSINE', threshold:0 } }), /SPACE/);
  });
}
test('18 projection schema mismatch excluded', () => assert.equal(vectors([rep('a'),rep('b','b',{projectionSchemaVersion:'v2'})]).neighbors.length,0));
test('20 zero/nonfinite/dimension-invalid vectors fail including isolated anchor', () => {
  for (const vector of [[0,0],[NaN,1],[Infinity,0],[1]]) {
    assert.throws(() => vectors([rep('a','a',{vector})]));
    assert.throws(() => vectors([rep('a'),rep('b','b',{vector})]));
  }
});
test('21 foreign representation fails before similarity filtering', () => {
  assert.throws(() => vectors([rep('a'),rep('b','b',{organisationId:other})]), /TENANT/);
  assert.throws(() => vectors([rep('a'),rep('b','b',{subject:{...rep('b').subject,organisationId:other}})]), /TENANT/);
});
test('22 candidates excluded and candidate anchor rejected', () => {
  const candidate = rep('c','c',{subject:{subjectKind:'NORMALIZED_CANDIDATE',organisationId:org,candidateId:'c',candidateKind:'DATA_ELEMENT'}});
  assert.equal(vectors([rep('a'),candidate]).neighbors.length,0);
  assert.throws(() => vectors([{...candidate,representationId:'a'} as any]), /CANONICAL_REPRESENTATION/);
});
test('23 cosine never changes authority or emits a PossibleMatch decision', () => {
  const output = vectors().neighbors[0]; assert.equal(output.authority,'ANALYTICAL');
  assert.equal(output.metric,'COSINE'); assert.ok(!('trust' in output)); assert.ok(!('candidateId' in output));
});
test('24 canonical seed, graph context, vector neighbors and lineage returned', () => {
  const context = hybrid(); assert.equal(context.seed.canonicalObjectId,'a'); assert.equal(context.vector?.neighbors.length,3);
  assert.equal(context.neighborhood.length,2); assert.equal(context.lineage.downstream.length,2);
});
for (const [n, kind] of [[25,'GRAPH_ONLY'],[26,'VECTOR_ONLY'],[27,'GRAPH_AND_VECTOR']] as const) {
  test(`${n} ${kind} contribution explicit`, () => assert.ok(hybrid().results.some(r => r.contribution === kind)));
}
test('28 hybrid has no blended score or governance score', () => {
  for (const result of hybrid().results) {
    assert.ok(!('score' in result)); assert.ok(!('confidence' in result)); assert.ok(!('trust' in result));
  }
});
test('29 deterministic replay independent of row order and frozen snapshots', () => {
  assert.deepEqual(hybrid(),hybrid());
  const a = project([object('a'),object('b'),object('c')],[edge('z','c','a'),edge('x','b','a')]);
  const b = project([object('c'),object('b'),object('a')],[edge('x','b','a'),edge('z','c','a')]);
  assert.deepEqual(a,b); assert.deepEqual(traverse(a),traverse(b));
  assert.throws(() => (a.edges as any).push(edge('bad','a','b')));
});
test('30 lineage stored target-to-source respected', () => {
  const path = traverse(project(),'GOVIA_LINEAGE_UPSTREAM_V1',4,'b')[0].path[0];
  assert.equal(path.edge.source.canonicalObjectId,'b'); assert.equal(path.edge.target.canonicalObjectId,'a');
  assert.equal(path.traversalDirection,'STORED_FORWARD');
});
test('31 downstream explicit reverse policy includes changed source consumers', () => {
  const result = traverse()[0]; assert.equal(result.node.canonicalObjectId,'b');
  assert.equal(result.path[0].traversalDirection,'STORED_REVERSE'); assert.equal(result.policyVersion,'GOVIA_BLAST_RADIUS_V1');
});
test('32 cycles terminate without returning seed as impacted', () => {
  assert.equal(traverse(project(undefined,[edge('1','a','b'),edge('2','b','a')])).length,1);
});
test('33 max depth enforced and invalid bounds fail', () => {
  const graph = project([object('a'),object('b'),object('c')],[edge('1','b','a'),edge('2','c','b')]);
  assert.equal(traverse(graph,undefined,1).length,1); assert.equal(traverse(graph,undefined,0).length,0);
  for (const depth of [-1,17,NaN,1.5]) assert.throws(() => traverse(graph,undefined,depth), /DEPTH/);
});
test('34 every reached node retains exact shortest path with hops and stored endpoints', () => {
  const graph = project([object('a'),object('b'),object('c')],[edge('1','b','a'),edge('2','c','b')]);
  const c = traverse(graph)[1]; assert.deepEqual(c.path.map(p => [p.edge.canonicalRelationshipId,p.hop]),[['1',1],['2',2]]);
  assert.equal(c.hopCount,2);
});
test('35 unsupported blast relations excluded, behavior dependencies reverse explicitly', () => {
  const objects = [object('a','TOOL'),object('mcp','MCP_SERVER'),object('v','AGENT_VERSION')];
  const graph = project(objects,[edge('exposes','mcp','a',{relationship_type:'EXPOSES',source_kind:'MCP_SERVER',target_kind:'TOOL'}),
    edge('uses','v','a',{relationship_type:'USES_TOOL',source_kind:'AGENT_VERSION',target_kind:'TOOL'})]);
  assert.deepEqual(traverse(graph).map(r=>r.node.canonicalObjectId),['v']);
});
test('36 no READS_FROM/WRITES_TO fabricated from DERIVED_FROM or similarity', () => {
  assert.ok(hybrid().neighborhood.every(g=>g.path.every(p=>p.edge.relationshipType==='DERIVED_FROM')));
});
test('37 explanations preserve canonical IDs', () => assert.ok(hybrid().results.every(r=>r.node.canonicalObjectId && r.node.nodeId)));
test('38 explanations preserve relationship state/decision/path IDs', () => {
  const step = hybrid().results.find(r=>r.graph)!.graph!.path[0];
  assert.ok(step.edge.canonicalRelationshipId); assert.ok(step.edge.relationshipStateId); assert.ok(step.edge.createdByDecisionId);
});
test('39 vectors retain exact representation and full space metadata/support', () => {
  const ctx = hybrid(); assert.equal(ctx.vector?.anchor.representationId,'anchor');
  assert.deepEqual(ctx.results.filter(r=>r.node.canonicalObjectId==='b').map(r=>r.vector?.representation.representationId),['b-v1','b-v2']);
  assert.equal(Object.keys(ctx.vector!.semanticSpace).length,5);
  assert.deepEqual(ctx.vector!.neighbors[0].representation.support.evidenceIds,['evidence']);
  assert.deepEqual(ctx.vector!.anchor.contentFingerprint,{algorithm:'sha256',schemaVersion:'v1',value:'digest:anchor'});
  assert.equal(ctx.vector!.anchor.generatedAt,before);
  assert.deepEqual(ctx.vector!.neighbors[0].representation.contentFingerprint,{algorithm:'sha256',schemaVersion:'v1',value:'digest:b-v1'});
  assert.equal(ctx.vector!.neighbors[0].representation.generatedAt,before);
});
test('40 canonical subject and analytical authority explicit', () => assert.ok(hybrid().results.every(r=>r.subjectKind==='CANONICAL_OBJECT'&&r.authority==='ANALYTICAL')));
test('41-42 allowlisted outputs omit raw Prompt, secrets, evidence bodies and vectors', () => {
  const graph = project([object('a','PROMPT',{plaintext:'TOP_SECRET',evidence:{body:'TOP_SECRET'}}),object('b','PROMPT')],[]);
  const representations = ['a','b'].map(id=>rep(id,id,{subject:{...rep(id).subject,canonicalObjectKind:'PROMPT'},rawPrompt:'TOP_SECRET',
    support:{assertionIds:['a'],evidenceIds:['e'],body:'TOP_SECRET'}}));
  const out = JSON.stringify(vectors(representations,graph)); assert.ok(!out.includes('TOP_SECRET')); assert.ok(!out.includes('"vector":'));
});
test('43-46 read domain cannot write/reconcile/call LLM; no dependency on legacy engine', () => {
  for (const file of ['graph.ts','traversal.ts','retrieval.ts']) {
    const src = readFileSync(new URL(`../src/governed/${file}`,import.meta.url),'utf8');
    assert.doesNotMatch(src,/\.rpc\(|\.insert\(|\.update\(|\.delete\(|fetch\(|GraphEngine|materialize|recordAuthorized|createPossibleMatchCandidate/);
  }
  assert.equal(hybrid().canonicalWriteAuthority,'NONE'); assert.equal(hybrid().llmAuthority,'NONE');
});
test('47-48 immutable inputs and no M10/M11 authority fields emitted', () => {
  const objects = [object('a'),object('b')], relationships = [edge('x','b','a')];
  const saved = JSON.stringify({objects,relationships}); vectors(undefined,project(objects,relationships));
  assert.equal(JSON.stringify({objects,relationships}),saved);
  assert.ok(!('fieldAuthority' in hybrid())); assert.ok(!('passport' in hybrid()));
});
test('49 legacy GraphEngine remains operational', () => {
  const legacy = new GraphEngine(); legacy.load([{id:'legacy',kind:'agent',label:'legacy'}],[]);
  assert.equal(legacy.getEntity('legacy')?.label,'legacy'); assert.equal(legacy.size,1);
});
test('50 legacy vocabulary never extends canonical taxonomy', () => {
  for (const type of ['SIMILAR_TO','DEPENDS_ON','PROCESSES_DATA','ACCESSES_SYSTEM','RELATED_TO','IMPACTS','BLAST_RADIUS']) {
    assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).includes(type));
  }
});
test('exact anchor required; no first/latest policy; duplicate representations fail', () => {
  assert.throws(() => vectors([rep('other','a')]),/ANCHOR_NOT_FOUND/);
  assert.throws(() => vectors([rep('a'),rep('a')]),/DUPLICATE/);
  assert.throws(() => vectors([rep('a','b')]),/ANCHOR_SEED/);
});
test('forged/deserialized or foreign graph cannot traverse or retrieve', () => {
  const graph = project(); assert.throws(()=>traverse({...graph}),/UNTRUSTED/);
  assert.throws(()=>traverseCanonicalGraph({graph,organisationId:other,seedCanonicalObjectId:'a',maxDepth:1,policyVersion:'GOVIA_BLAST_RADIUS_V1'}),/TENANT/);
});
test('graph-only context explicitly has unknown vector contribution', () => {
  const context = buildAnalyticalContext({organisationId:org,graph:project(),seedCanonicalObjectId:'a',maxDepth:1,vectorQuery:null,representations:[]});
  assert.equal(context.vector,null); assert.ok(context.limitations.includes('VECTOR_RETRIEVAL_NOT_REQUESTED'));
});
test('presentation ordering is explicit, analytical and independent of input order', () => {
  const a=rep('a'), b=rep('b'), older=rep('b-old','b',{generatedAt:'2020-01-01T00:00:00Z',vector:[0,1]});
  assert.deepEqual(vectors([a,b,older]),vectors([older,b,a]));
  assert.equal(vectors().presentationOrder,'COSINE_DESC_THEN_REPRESENTATION_ID_ASC');
  assert.equal(hybrid().presentationOrder,'VECTOR_ORDER_THEN_GRAPH_ONLY_BFS_CANONICAL_EDGE_ID_ASC');
});
