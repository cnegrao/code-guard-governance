// Offline documentary review only. Reuse unchanged S2-S4 metadata guards once.
import './verify-s2.test.mjs';
import './verify-s3.test.mjs';
import './verify-s4.test.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {renderClosure} from './closure-render-v0.mjs';
const root='docs/trust-assurance/';
const start='38df55d8b1b1009adbb76faed63f3b7c622f914e';
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const d=json(root+'v0-closure-review.json');
const source=id=>json(d.input_inventory.find(x=>x.artifact_id===id).path);
const s0=source('S0'),catalog=source('CATALOG'),cw=source('CROSSWALK'),index=source('EVIDENCE'),gaps=source('GAPS'),claims=source('CLAIMS'),awards=source('AWARDS'),calendar=source('CALENDAR'),kpi=source('KPI');
const git=a=>execFileSync('git',a,{encoding:'utf8',maxBuffer:20*1024*1024}).trim();
const lf=s=>s.replace(/\r\n/g,'\n');
const hash=s=>createHash('sha256').update(lf(s)).digest('hex');
const unique=(xs,k)=>assert.equal(new Set(xs.map(x=>x[k])).size,xs.length,k);
const by=(xs,k,id)=>{const found=xs.find(x=>x[k]===id);assert.ok(found,'unresolved '+k+': '+id);return found;};
const count=(xs,key)=>Object.fromEntries([...new Set(xs.map(x=>x[key]))].sort().map(k=>[k,xs.filter(x=>x[key]===k).length]));
const decisions={V0_DOCUMENTARY_CLOSURE:'PASS',CONTROLLED_DEMO_READINESS:'HOLD',EXTERNAL_PUBLICATION_READINESS:'HOLD',TENANT_ASSURANCE_READINESS:'HOLD',CERTIFICATION_READINESS:'HOLD'};
const buckets={V0_DOCUMENTARY_BLOCKER:0,V1_IMPLEMENTATION_DEPENDENCY:2,EXTERNAL_PUBLICATION_GATE:49,CUSTOMER_SPECIFIC_DEPENDENCY:3,FUTURE_EXTERNAL_ARTIFACT_DEPENDENCY:2,LEGACY_PRESENTATION_GATE:5};
const pairs=[['UNKNOWN','FALSE'],['UNKNOWN','ZERO'],['UNKNOWN','NOT_APPLICABLE'],['MAPPED','SATISFIED'],['MAPPED','COMPLIANT'],['EVIDENCE_AVAILABLE','EVIDENCE_SUFFICIENT'],['READY','CERTIFIED'],['INTERNAL_READINESS','EXTERNAL_CERTIFICATION'],['FACTUAL_CAPABILITY','ALIGNMENT'],['ALIGNMENT','COMPLIANCE'],['REPOSITORY_IMPLEMENTATION','DEPLOYED_OPERATION'],['LOCAL_TEST','CI'],['CI','CUSTOMER_DEPLOYMENT'],['DEPLOYMENT','OPERATING_EFFECTIVENESS'],['AWARD_CRITERION_CORRESPONDENCE','AWARD_READINESS'],['AWARD_READINESS','NOMINATION / FINALIST / WINNER'],['KPI_DEFINITION','KPI_EXECUTION'],['PRODUCT_KPI','TENANT_KPI']];

// These are closed historical snapshots, independent of later authorized slices.
const historicalStart = '38df55d8b1b1009adbb76faed63f3b7c622f914e';
const historicalClose = 'a8b8bece4f19f105e418b89996693dfaf2d0c9e1';
const historicalBodies = new Map();
const at = (commit, path) => {
  const key = commit + ':' + path;
  if (!historicalBodies.has(key)) historicalBodies.set(key, execFileSync('git', ['show', key], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 }));
  return historicalBodies.get(key).replace(/\r\n/g, '\n');
};
const changed = (paths = []) => git(['diff', '--name-only', historicalStart, historicalClose, '--', ...paths]).trim().split('\n').filter(Boolean);
function assertClosed(end = historicalClose, begin = historicalStart) {
  git(['merge-base', '--is-ancestor', begin, end]);
  git(['merge-base', '--is-ancestor', end, 'HEAD']);
  assert.equal(begin, historicalStart, 'historical start must remain frozen');
  assert.equal(end, historicalClose, 'historical close must remain frozen');
}
function assertHistoricalPin(p, commit, exactAnchor = false) {
  assert.equal(p.selection_commit, commit, 'historical selection commit');
  const body = at(commit, p.path);
  if (p.git_blob) assert.equal(p.git_blob, git(['rev-parse', commit + ':' + p.path]).trim());
  assert.equal(createHash('sha256').update(body).digest('hex'), p.sha256_lf_utf8, p.path);
  if (p.line) {
    const line = body.split('\n')[p.line - 1];
    if (exactAnchor) assert.equal(line?.trim(), p.anchor); else assert.ok(line?.includes(p.anchor), 'historical anchor: ' + p.path);
    // Legacy S5 source observations record commit/path/line without a URL field.
    if (p.locator !== undefined) assert.equal(p.locator, 'https://github.com/cnegrao/code-guard-governance/blob/' + commit + '/' + p.path + '#L' + p.line);
  }
}
// Existing S1 evidence supplies a recorded hash/anchor/locator for scope-only guards too.
// No hash or anchor is generated from the body being verified.
function closureEvidence() {
  const e = JSON.parse(at(historicalClose, 'docs/trust-assurance/evidence-index-v0.json')).evidence[0];
  return { path: e.path, line: e.line, anchor: e.anchor, selection_commit: e.source_commit,
    sha256_lf_utf8: e.content_sha256_lf_utf8, locator: e.exact_locator };
}
const evidenceCommit = 'acb95f84036b9bd5759c8afa04460bf1a004595f';
function verifyHorizon() {
  assertClosed();
  assertHistoricalPin(closureEvidence(), evidenceCommit);
}
function rejectHistoricalMutations(scopeChecks, pin = closureEvidence(), commit = evidenceCommit) {
  verifyHorizon();
  for (const [check, files] of scopeChecks) {
    check(files);
    assert.throws(() => check([...files, 'supabase/migrations/__unauthorized_during_slice__.sql']), /scope|unchanged|Expected/i);
  }
  assert.throws(() => assertClosed(git(['rev-parse', 'HEAD']).trim()), /historical close/);
  assert.throws(() => assertClosed(git(['rev-parse', historicalStart + '^']).trim()), /Command failed/);
  assertHistoricalPin(pin, commit);
  for (const mutation of [
    { sha256_lf_utf8: '0'.repeat(64) }, { anchor: '__MUTATED_HISTORICAL_ANCHOR__' },
    { locator: pin.locator.replace(commit, git(['rev-parse', 'HEAD']).trim()) },
    { selection_commit: git(['rev-parse', 'HEAD']).trim() },
  ]) assert.throws(() => assertHistoricalPin({ ...pin, ...mutation }, commit));
}

function validateReview(x){
 assert.equal(x.review_id,'M17.5-S5-V0-CLOSURE');assert.equal(x.starting_head,start);
 assert.deepEqual(x.decisions,decisions);assert.match(x.overall_milestone,/^OPEN/);
 assert.equal(x.closure_statement,'M17.5 V0 READINESS PACK: CLOSED / PASS');
 assert.deepEqual(x.semantic_boundaries,pairs.map(([left,right])=>({left,relation:'DOES_NOT_IMPLY_OR_EQUAL',right,state:'PASS'})));
 assert.deepEqual(x.gap_bucket_vocabulary,Object.keys(buckets));assert.deepEqual(x.gap_bucket_counts,buckets);
 assert.equal(x.readiness_pack.length,7);unique(x.readiness_pack,'artifact_id');
 const inventoryIds=new Set(x.input_inventory.map(i=>i.artifact_id));
 for(const a of x.readiness_pack){assert.equal(a.status,'PRESENT');assert.equal(a.external_use,'INTERNAL_ONLY');for(const id of a.input_ids)assert.ok(inventoryIds.has(id),'unresolved pack artifact');}
 unique(x.input_inventory,'artifact_id');unique(x.input_inventory,'path');assert.equal(x.input_inventory.length,35);
 for(const a of x.input_inventory){
  for(const k of ['purpose','authority_class','current_status','unresolved_gates','external_use_status'])assert.ok(a[k],a.artifact_id+': '+k);
  for(const id of [...a.input_dependencies,...a.output_dependencies])assert.ok(id==='S5'||inventoryIds.has(id),'unresolved inventory dependency '+id);
  assert.ok(a.external_use_status.startsWith('INTERNAL_ONLY'));
 }
 assert.equal(x.gap_dispositions.length,61);unique(x.gap_dispositions,'gap_id');
 assert.deepEqual(x.gap_dispositions.map(g=>g.gap_id),gaps.gaps.map(g=>g.gap_id));
 const observed=Object.fromEntries(Object.keys(buckets).map(k=>[k,x.gap_dispositions.filter(g=>g.primary_bucket===k).length]));assert.deepEqual(observed,buckets);
 for(const g of x.gap_dispositions){
  const original=by(gaps.gaps,'gap_id',g.gap_id);assert.equal(original.status,'OPEN');assert.equal(g.original_status,'OPEN');
  assert.equal(g.title,original.title);assert.equal(g.blocks_v0_documentary_closure,'NO');
  assert.deepEqual(g.dependency_ids,original.dependency_ids);assert.deepEqual(g.required_evidence,original.required_closure_evidence);
  assert.equal(g.reviewer,original.review_approval_requirement);assert.ok(Object.hasOwn(buckets,g.primary_bucket));
  const expectedBucket=g.gap_id.startsWith('G-LEGACY-')||g.gap_id==='G-REACHABILITY-L04'?'LEGACY_PRESENTATION_GATE':
   ['G-CERTIFICATION','G-ATTESTATION'].includes(g.gap_id)?'FUTURE_EXTERNAL_ARTIFACT_DEPENDENCY':
   ['G-APPLICABILITY','G-DEPLOYMENT','G-OPERATING'].includes(g.gap_id)?'CUSTOMER_SPECIFIC_DEPENDENCY':
   ['G-KPI-EXECUTION','G-EMBEDDING-POPULATION'].includes(g.gap_id)?'V1_IMPLEMENTATION_DEPENDENCY':'EXTERNAL_PUBLICATION_GATE';
  assert.equal(g.primary_bucket,expectedBucket);
  assert.equal(g.blocks_v1,['G-KPI-EXECUTION','G-EMBEDDING-POPULATION'].includes(g.gap_id)?'OPERATIONAL_FEATURE':'NO');
  const legacy=g.gap_id.startsWith('G-LEGACY-')||g.gap_id==='G-REACHABILITY-L04';
  assert.equal(g.blocks_demo,legacy?'EXPOSED_SURFACE':'NO');
  assert.equal(g.blocks_external_publication,legacy?'EXPOSED_SURFACE':'DEPENDENT_SCOPE');
  assert.equal(g.blocks_certification_attestation_claims,'DEPENDENT_SCOPE');
  assert.equal(g.blocks_tenant_assurance,legacy?'EXPOSED_SURFACE':'DEPENDENT_SCOPE');
 }
 assert.deepEqual(x.claim_boundary_counts,{INTERNAL_ONLY:42,CONTROLLED_DEMO_ONLY:0,EXTERNAL_PUBLICATION_ELIGIBLE:0,PROHIBITED:0,UNKNOWN:0,ELIGIBLE:0,INELIGIBLE:42});
 assert.deepEqual(Object.keys(x.use_states),['INTERNAL_ONLY','CONTROLLED_DEMO_ONLY','EXTERNAL_PUBLICATION_ELIGIBLE','PROHIBITED','UNKNOWN']);
 assert.equal(x.claim_dispositions.length,42);unique(x.claim_dispositions,'claim_id');
 assert.deepEqual(x.claim_dispositions.map(c=>c.claim_id),claims.claims.map(c=>c.claim_id));
 for(const c of x.claim_dispositions){
  const original=by(claims.claims,'claim_id',c.claim_id);
  for(const key of ['claim_class','eligibility','record_disposition','claim_ceiling','capability_ids','gap_ids'])assert.deepEqual(c[key],original[key]);
  assert.equal(c.eligibility,'INELIGIBLE');assert.equal(c.use_state,'INTERNAL_ONLY');
  assert.equal(c.controlled_demo_affirmation,'PROHIBITED');assert.equal(c.external_publication,'PROHIBITED');
  assert.equal(c.required_reviewer,original.reviewer_requirement);assert.equal(c.unresolved_blockers,original.eligibility_reason);
  if(c.record_disposition==='REJECTED_PROPOSAL')assert.match(c.affirmative_internal_use,/^PROHIBITED/);
 }
 assert.deepEqual(x.claim_classes.map(c=>[c.claim_class,c.count]),claims.claim_classes.map(c=>[c,claims.claims.filter(r=>r.claim_class===c).length]));
 for(const c of x.claim_classes){assert.equal(c.current_eligibility,'INELIGIBLE');assert.equal(c.internal_use,'INTERNAL_ONLY');assert.equal(c.external_publication,'PROHIBITED');assert.equal(c.controlled_demo_use,'PROHIBITED_AS_AFFIRMATIVE_CLAIM_PENDING_REVIEW');assert.ok(c.required_reviewer&&c.unresolved_blockers);}
 assert.equal(x.ceiling_review.length,38);unique(x.ceiling_review,'capability_id');
 for(const c of x.ceiling_review){
  const original=by(claims.capability_ceilings,'capability_id',c.capability_id);
  for(const key of ['current_claim_ceiling','max_defensible_external_class','draft_alignment_ceiling'])assert.deepEqual(c[key],original[key]);
  assert.equal(c.publication_eligibility,'INELIGIBLE');assert.equal(c.semantic_state,'UNCHANGED');assert.equal(c.use_state,'INTERNAL_ONLY');
 }
 assert.equal(x.legacy_gates.length,12);unique(x.legacy_gates,'surface_id');
 for(const g of x.legacy_gates){
  const original=s0.legacy_surfaces.find(s=>s.surface_id===g.surface_id);
  assert.equal(g.classification,original?.classification??'LEGACY_NON_AUTHORITATIVE');assert.equal(g.blocks_documentary_closure,false);
  const effect=g.surface_id==='L05'?'NO_FOR_INSPECTED_GUARD_ONLY':'EXPOSED_SURFACE';
  assert.equal(g.blocks_controlled_demo,effect);assert.equal(g.blocks_external_presentation,effect);assert.ok(g.required_containment_slice);
  if(original)assert.deepEqual(g.evidence_ids,original.evidence_ids);
 }
 assert.equal(x.award_boundary.discovery_records,12);assert.equal(x.award_boundary.admitted_programs,6);assert.equal(x.award_boundary.events,25);
 assert.equal(x.award_boundary.eligibility_UNKNOWN,6);assert.deepEqual(x.award_boundary.readiness,awards.counts.readiness);
 assert.equal(x.award_boundary.INTERNALLY_USABLE,true);assert.equal(x.award_boundary.DEMO_USABLE,false);assert.equal(x.award_boundary.EXTERNALLY_PUBLISHABLE,false);assert.equal(x.award_boundary.use_state,'INTERNAL_ONLY');
 assert.deepEqual(x.award_boundary.records,awards.awards.map(a=>({edition_id:a.edition_id,eligibility:a.eligibility_state,readiness:a.readiness_state,submission:a.application_submission_status,external_award_state:a.external_award_state,source_issues:a.source_issues})));
 for(const [key,value] of Object.entries(kpi.summary))assert.equal(x.kpi_boundary[key],value);
 assert.deepEqual(x.kpi_boundary.types,['COUNT','PARTITIONED_COUNT']);
 assert.equal(x.closure_matrix.length,10);unique(x.closure_matrix,'dimension');
 for(const row of x.closure_matrix)assert.equal(row.state,row.dimension==='PUBLICATION SAFETY'?'HOLD':'PASS');
 assert.equal(x.v1_prerequisites.length,8);for(const c of x.v1_prerequisites)assert.ok(c.projection_only&&c.additive_work);
 assert.match(x.next_slice,/Proposed M17.5-V1-S0/);assert.match(x.next_slice,/separate Carlos authorization/);
 assert.deepEqual(x.delta,{runtime:0,database:0,migrations:0,API:0,UI:0,hosted_mutations:0,deployments:0,PRs:0,tenant_KPI_executions:0,award_submissions:0,commercial_publications:0});
}
test('S5: closure, 61 gap effects, 42 draft uses, 38 ceilings and independent readiness decisions',()=>validateReview(d));
test('S5: exact inventory Git commits/blobs/digests and immutable S0 -> S4 parent/byte chain',()=>{
 const expected=['acb95f84036b9bd5759c8afa04460bf1a004595f','c3fcf7228530aa5f165361d78ad76cf5f612feb0','38314b7ea20e479f4d108ea1b48fd37c78d37ebf','c354691e8dc24e771c4887a999f57f2165dc14ac','e56d9d8b9ed729b982f234e20a5658e0f9d60be3',start];
 assert.deepEqual(d.immutable_chain.map(x=>x.slice),['S0','S1','S2','S3','S4']);
 for(const [i,row] of d.immutable_chain.entries()){
  assert.equal(row.input_head,expected[i]);assert.equal(row.output_head,expected[i+1]);assert.equal(git(['rev-parse',row.output_head+'^']),row.input_head);
 }
 for(const a of d.input_inventory){
  assert.equal(a.selection_commit,start);assert.equal(a.last_change_commit,git(['log','-1','--format=%H',start,'--',a.path]));
  assert.equal(a.git_blob,git(['rev-parse',start+':'+a.path]));assert.equal(hash(at(a.selection_commit,a.path)),a.sha256_lf_utf8);
  for(const commit of expected.slice(1)){
   if(!git(['ls-tree',commit,'--',a.path]))continue;
   assert.equal(git(['rev-parse',commit+':'+a.path]),a.git_blob,'silent replacement '+a.path+' at '+commit);
  }
 }
 // Every transitive S2/S3/S4 pin selects the actual expected input and same bytes.
 for(const [doc,expectedCommit] of [[gaps,expected[2]],[claims,expected[2]],[awards,expected[3]],[kpi,expected[4]]]){
  assert.equal(doc.starting_head,expectedCommit);
  for(const pin of doc.input_artifacts??doc.source_artifacts){
   const required=doc===gaps||doc===claims?(pin.path===d.input_inventory.find(x=>x.artifact_id==='S0').path?expected[1]:expected[2]):expectedCommit;
   assert.equal(pin.commit,required,'exact historical pin');
   const text=at(pin.commit,pin.path);
   assert.equal(hash(text),by(d.input_inventory,'path',pin.path).sha256_lf_utf8);if(pin.sha256_lf_utf8)assert.equal(hash(text),pin.sha256_lf_utf8);
   if(pin.git_blob)assert.equal(git(['rev-parse',pin.commit+':'+pin.path]),pin.git_blob);
  }
 }
});
test('S5: S0/S1 identities, framework versions, all dispositions and 109 original evidence anchors resolve',()=>{
 unique(s0.capabilities,'capability_id');unique(index.evidence,'evidence_id');unique(catalog.framework_versions,'framework_version_id');
 assert.equal(s0.capabilities.length,38);assert.equal(index.evidence.length,109);assert.equal(catalog.framework_versions.length,7);assert.equal(catalog.requirements.length,9);
 assert.deepEqual(cw.capability_dispositions.map(c=>c.capability_id),s0.capabilities.map(c=>c.capability_id));
 assert.deepEqual(count(cw.capability_dispositions,'mapping_state'),{MAPPED:5,NOT_MAPPED:6,UNKNOWN:27});
 assert.deepEqual(count(s0.capabilities,'proof_status'),{NOT_PROVEN:3,PARTIALLY_PROVEN:25,PROVEN:9,UNKNOWN:1});
 for(const c of cw.capability_dispositions){
  assert.equal(c.capability_version,d.immutable_chain[0].output_head);assert.equal(c.capability_source_commit,d.immutable_chain[0].input_head);
  assert.deepEqual(c.evidence_ids,by(s0.capabilities,'capability_id',c.capability_id).evidence_ids);
  assert.equal(c.internal_readiness,'UNKNOWN');assert.equal(c.evidence_sufficiency,'NOT_ASSESSED');assert.equal(c.commercial_claim_eligibility,'INELIGIBLE');assert.equal(c.external_certification_attestation,'NOT_ASSERTED');
  if(c.requirement_id)assert.equal(by(catalog.requirements,'requirement_id',c.requirement_id).framework_version_id,c.framework_version_id);
 }
 const cache=new Map();
 for(const e of index.evidence){
  const old=by(s0.evidence_references,'evidence_id',e.evidence_id);
  for(const key of ['path','line','anchor','source_commit','content_sha256_lf_utf8'])assert.equal(e[key],old[key]);
  assert.equal(e.authority_classification,old.classification);assert.equal(e.source_execution,old.execution);assert.equal(e.verification_mode,old.mode);
  assert.equal(e.source_commit,d.immutable_chain[0].input_head);
  const loc=e.source_commit+':'+e.path;
  if(!cache.has(loc))cache.set(loc,lf(execFileSync('git',['show',loc],{encoding:'utf8'})));
  const text=cache.get(loc);assert.equal(hash(text),e.content_sha256_lf_utf8);assert.equal(text.split('\n')[e.line-1].trim(),e.anchor.trim());
  assert.deepEqual(e.capability_ids,s0.capabilities.filter(c=>c.evidence_ids.includes(e.evidence_id)).map(c=>c.capability_id));
  assert.deepEqual(e.legacy_surface_ids,s0.legacy_surfaces.filter(l=>l.evidence_ids.includes(e.evidence_id)).map(l=>l.surface_id));
  assert.ok(e.capability_ids.length||e.legacy_surface_ids.length,'orphan evidence');
  assert.equal(e.ci_status,'NOT_VERIFIED');assert.equal(e.customer_deployment_status,'NOT_VERIFIED');assert.equal(e.operating_effectiveness_status,'NOT_ESTABLISHED');assert.equal(e.certification_status,'NOT_ASSERTED');
 }
 assert.deepEqual(index.s0_verification_summaries,s0.verification);
 assert.deepEqual(d.lineage_summary,{capabilities:38,evidence:109,framework_versions:7,bounded_public_references:9,capability_dispositions:38,MAPPED:5,NOT_MAPPED:6,UNKNOWN:27,pending_framework_populations:5,pending_capability_associations:190,gaps_OPEN:61,claim_drafts:42,capability_ceilings:38,award_discovery:12,award_programs:6,calendar_events:25,kpi_definitions:11,orphan_ids:0,dangling_references:0,version_drift:0,silent_semantic_replacements:0});
});
test('S5: lawful source boundary stays bounded; no third-party authority or reconstructed normative body',()=>{
 const ids=['NIST-AI-RMF-1.0','EU-AI-ACT-2024-1689-OJ-20240712','ISO-IEC-42001-2023-ED1','ISO-IEC-38505-1-2026-ED2','ISO-IEC-23894-2023-ED1','DCAM-3','DAMA-DMBOK2-REVISED-EN'];
 assert.deepEqual(catalog.framework_versions.map(v=>v.framework_version_id),ids);assert.deepEqual(d.framework_boundary.map(v=>v.framework_version_id),ids);
 const hosts={'NIST-AI-RMF':['nvlpubs.nist.gov','www.nist.gov'],'EU-AI-ACT':['eur-lex.europa.eu'],'ISO-IEC-42001':['www.iso.org'],'ISO-IEC-38505-1':['www.iso.org'],'ISO-IEC-23894':['www.iso.org'],DCAM:['edmcouncil.org'],'DAMA-DMBOK':['dama.org']};
 for(const v of catalog.framework_versions){
  const view=by(d.framework_boundary,'framework_version_id',v.framework_version_id);assert.equal(view.identity_state,v.verification_status);assert.equal(view.population_state,v.requirement_population_status);assert.equal(view.content_permission,v.content_embedding_permission);
  assert.equal(v.verification_status,'AUTHORITATIVE_SOURCE_VERIFIED');assert.ok(hosts[v.framework_id].includes(new URL(v.authoritative_source_locator).hostname));
  for(const a of v.source_access_records)assert.ok(hosts[v.framework_id].includes(new URL(a.source_locator).hostname));
  const refs=catalog.requirements.filter(r=>r.framework_version_id===v.framework_version_id);assert.equal(view.reference_count,refs.length);
  if(!['NIST-AI-RMF','EU-AI-ACT'].includes(v.framework_id)){assert.equal(v.requirement_population_status,'EXTERNAL_REQUIREMENT_SOURCE_PENDING');assert.equal(refs.length,0);}
  for(const r of refs){assert.equal(r.normative_text,null);assert.equal(r.applicability,'UNKNOWN');assert.equal(r.source_verification_state,'AUTHORITATIVE_SOURCE_VERIFIED');by(v.source_access_records,'access_id',r.source_access_id);}
 }
 assert.equal(cw.pending_framework_gates.length,5);for(const g of cw.pending_framework_gates){assert.equal(g.mapping_state,'UNKNOWN');assert.equal(g.requirement_id,null);assert.deepEqual(g.capability_ids,s0.capabilities.map(c=>c.capability_id));}
 assert.match(d.framework_boundary[1].review,/No current operative law/);
});
test('S5: legacy locator observations, exclusions and all 12 gates remain explicit; no SAFE promotion',()=>{
 verifyHorizon(); assertDocumentaryScope();
 const legacy=at(start,d.input_inventory.find(x=>x.artifact_id==='LEGACY').path);
 for(const g of d.legacy_gates){
  if(g.evidence_ids){assert.ok(legacy.includes('| '+g.surface_id+':'));for(const e of g.evidence_ids)by(index.evidence,'evidence_id',e);}
  for(const p of [g.source,...g.related_sources??[]].filter(Boolean)) assertHistoricalPin(p,start,true);
 }
 assert.match(d.legacy_review_scope,/No tracked M18 pre-draft document was located/);
 assert.equal(d.legacy_gates.filter(g=>g.classification==='SAFE').length,1);
 assert.equal(d.legacy_gates.find(g=>g.classification==='SAFE').surface_id,'L05');
});
test('S5: all JSON metadata has exact Markdown parity and explicit copy boundaries',()=>{
 const md=lf(readFileSync(root+'v0-closure-review.md','utf8'));assert.equal(md,renderClosure(d));assert.doesNotMatch(md,/[\t ]+$/m);assert.ok(!md.endsWith('\n\n'));
 for(const c of ['SAFE INTERNAL FACTUAL LANGUAGE','SAFE CONTROLLED DEMO LANGUAGE','PROHIBITED EXTERNAL LANGUAGE','REQUIRES INDEPENDENT REVIEW','REQUIRES EXTERNAL ARTIFACT'])assert.ok(d.wording_guide.some(w=>w.category===c));
 const prohibited=d.wording_guide.find(w=>w.category==='PROHIBITED EXTERNAL LANGUAGE').copy;
 for(const w of ['GovIA is ISO 42001 compliant','GovIA is EU AI Act compliant','GovIA is certified','GovIA guarantees compliance','100% governance coverage','award-ready','award-winning','customer is compliant','controls are effective'])assert.ok(prohibited.includes(w));
 for(const w of d.wording_guide.filter(w=>w.category==='SAFE CONTROLLED DEMO LANGUAGE'))assert.match(w.boundary,/review|excerpt/i);
});
test('S5 adversarial: reject fabricated closure/publication, closed gaps, above-ceiling use, award/KPI/legacy promotion',()=>{
 const mutations=[
  x=>x.decisions.EXTERNAL_PUBLICATION_READINESS='PASS',x=>x.decisions.CONTROLLED_DEMO_READINESS='PASS',x=>x.overall_milestone='CLOSED',
  x=>x.semantic_boundaries[0].relation='EQUALS',x=>x.semantic_boundaries.pop(),x=>x.readiness_pack[0].input_ids.push('ORPHAN'),
  x=>x.gap_dispositions[0].original_status='CLOSED',x=>x.gap_dispositions[0].blocks_v0_documentary_closure='YES',x=>x.gap_dispositions.pop(),
  x=>x.claim_dispositions[0].eligibility='ELIGIBLE',x=>x.claim_dispositions[0].use_state='EXTERNAL_PUBLICATION_ELIGIBLE',x=>x.claim_dispositions[0].use_state='CONTROLLED_DEMO_ONLY',
  x=>x.claim_dispositions[0].claim_ceiling='CERTIFIED',x=>x.claim_dispositions[0].external_publication='EXTERNAL_PUBLICATION_ELIGIBLE',x=>x.claim_boundary_counts.ELIGIBLE=1,
  x=>x.ceiling_review[0].max_defensible_external_class='EXTERNAL_CERTIFICATION',x=>x.legacy_gates[0].classification='SAFE',x=>x.legacy_gates[5].blocks_controlled_demo='NO',
  x=>x.award_boundary.records[0].eligibility='ELIGIBLE',x=>x.award_boundary.records[0].external_award_state='WINNER',x=>x.award_boundary.EXTERNALLY_PUBLISHABLE=true,
  x=>x.kpi_boundary.executed_results=1,x=>x.kpi_boundary.types.push('PERCENTAGE'),x=>x.delta.UI=1,
 ];
 for(const mutate of mutations){const changed=structuredClone(d);mutate(changed);assert.throws(()=>validateReview(changed));}
});

// Same original staged-candidate path set, evaluated at its historical closure.
function assertDocumentaryScope(files = changed()) {
  assert.deepEqual([...files].sort(), [
  "docs/agent/ARCHITECTURE_INDEX.md",
  "docs/codex/evidence/2026-10-20-m17.5-s5-v0-closure.md",
  "docs/trust-assurance/closure-render-v0.mjs",
  "docs/trust-assurance/v0-closure-review.json",
  "docs/trust-assurance/v0-closure-review.md",
  "docs/trust-assurance/verify-s5-final.test.mjs",
  "docs/trust-assurance/verify-s5.test.mjs"
], 'historical documentary scope');
}

test('verify-s5: historical scope, boundary, hash, anchor and locator mutations fail closed', () => {
  rejectHistoricalMutations([[assertDocumentaryScope, changed()]]);
  const p = d.legacy_gates.flatMap(g=>[g.source,...g.related_sources??[]]).find(Boolean);
  assertHistoricalPin(p, start, true);
  for (const mutation of [
    { sha256_lf_utf8: '0'.repeat(64) }, { anchor: '__MUTATED_HISTORICAL_ANCHOR__' },
    { selection_commit: git(['rev-parse', 'HEAD']) },
  ]) assert.throws(() => assertHistoricalPin({ ...p, ...mutation }, start, true));
});
