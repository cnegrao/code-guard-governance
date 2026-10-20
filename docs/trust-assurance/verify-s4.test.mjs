// Offline documentation guards only; no evaluator, tenant query or runtime suite.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {renderFramework} from './kpi-render-v0.mjs';
const root='docs/trust-assurance/';
const start='e56d9d8b9ed729b982f234e20a5658e0f9d60be3';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const doc=read(root+'kpi-framework-v0.json');
const git=a=>execFileSync('git',a,{encoding:'utf8'}).trim();
const hash=s=>createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const by=(xs,key,id)=>{const r=xs.find(x=>x[key]===id);assert.ok(r,`unresolved ${key}: ${id}`);return r;};
const unique=xs=>assert.equal(new Set(xs).size,xs.length,'duplicate identity');
const required=(o,keys)=>keys.forEach(k=>assert.ok(Object.hasOwn(o,k),'missing '+k));
const expected={
 'TENANT.GOVERNED_OBJECTS_WITH_EVIDENCE':['canonical_object_id',['organisation_id','canonical_object_id']],
 'TENANT.UNRESOLVED_ASSURANCE_GAPS':['gap_id',['organisation_id','scope_ref','gap_id']],
 'TENANT.REQUIREMENTS_WITH_EVIDENCE':['framework_requirement_reference',['organisation_id','framework_version_id','requirement_id','scope_ref']],
 'TENANT.UNKNOWN_REQUIREMENTS_BY_AXIS':['framework_requirement_reference_axis',['organisation_id','framework_version_id','requirement_id','scope_ref','axis']],
 'TENANT.STALE_EVIDENCE_REFERENCES':['evidence_reference_version',['organisation_id','scope_ref','evidence_reference_id','evidence_reference_version']],
 'TENANT.GOVERNED_SUPPORTING_DECISIONS':['governance_decision_id',['organisation_id','governance_decision_id']],
 'PRODUCT.UNRESOLVED_ASSURANCE_GAPS':['gap_id',['gap_id']],
 'PRODUCT.STALE_EVIDENCE_REFERENCES':['evidence_reference_version',['EVIDENCE.commit','evidence_id']],
 'PRODUCT.CAPABILITIES_BY_PROOF_STATUS':['capability_id',['capability_id']],
 'PRODUCT.MAPPINGS_BY_STATE':['capability_mapping_id',['mapping_id']],
 'PRODUCT.CLAIM_DRAFTS_BY_ELIGIBILITY':['claim_id',['claim_id']],
};
const fields=['kpi_id','kpi_version','predicate_version','supersedes','title','description','scope','purpose','kpi_type','unit','population_ref','population_definition','population_source','authoritative_upstream_sources','allowed_sources','authority_requirement','inclusion_predicate','exclusion_predicate','deduplication_key','grouping_dimensions','grouping_vocabularies','evidence_lineage','temporal_model','effective_at_semantics','recorded_cutoff_semantics','known_population_rule','UNKNOWN_rule','unknown_reasons','inaccessible_population_rule','partial_population_rule','zero_rule','not_applicable_rule','execution_status','execution_preconditions','permission_read_requirements','limitations','prohibited_interpretations'];
const reasons=['MISSING_REQUIRED_SOURCE','ACCESS_DENIED_OR_UNAVAILABLE','PARTIAL_ACQUISITION','POPULATION_NOT_ENUMERABLE','MISSING_TENANT_PROJECTION','UNRESOLVED_IDENTITY','MISSING_APPLICABILITY','UNKNOWN_EVIDENCE_CURRENCY','INCOMPLETE_TEMPORAL_CUTOFF','DEPENDENCY_INVALID','MISSING_FRESHNESS_POLICY','UNRESOLVED_AXIS_STATE'];
const kpi=(d,id)=>by(d.definitions,'kpi_id',id);
function validate(d) {
 assert.equal(d.framework_version,'1.0.0');assert.equal(d.starting_head,start);
 assert.deepEqual(d.type_vocabulary,['COUNT','PARTITIONED_COUNT']);
 assert.deepEqual(d.execution_status_vocabulary,['DEFINITION_ONLY','PRODUCT_DOCUMENTARY_ONLY']);
 assert.deepEqual(d.definitions.map(k=>k.kpi_id),Object.keys(expected));
 unique(d.definitions.map(k=>k.kpi_id));unique(d.definitions.map(k=>k.kpi_id+'@'+k.kpi_version));
 unique(d.source_artifacts.map(s=>s.source_id));
 assert.deepEqual(Object.keys(d.unknown_reasons),reasons);
 assert.deepEqual(d.summary,{definitions:11,product:5,tenant:6,DEFINITION_ONLY:7,PRODUCT_DOCUMENTARY_ONLY:4,operationally_executable:0,executed_results:0});
 for(const k of d.definitions) {
  required(k,fields);
  assert.ok(Object.keys(k).every(f=>fields.includes(f)||f==='freshness_policy_ref'),'unknown field/result/numeric measure');
  assert.equal(k.kpi_version,'1.0.0');assert.equal(k.predicate_version,k.kpi_version);assert.equal(k.supersedes,null);
  assert.ok(d.type_vocabulary.includes(k.kpi_type));assert.ok(d.execution_status_vocabulary.includes(k.execution_status));
  assert.equal(k.scope,k.kpi_id.split('.')[0]);assert.equal(k.unit,expected[k.kpi_id][0]);
  assert.equal(k.population_definition.grain,k.unit);assert.deepEqual(k.deduplication_key,expected[k.kpi_id][1]);
  assert.deepEqual(k.population_definition.deduplication_key,k.deduplication_key);
  unique(k.deduplication_key);assert.equal(k.population_definition.identity,k.population_ref);
  assert.deepEqual(k.allowed_sources,k.population_source);assert.deepEqual(k.authoritative_upstream_sources,k.allowed_sources);
  for(const s of k.allowed_sources)by(d.source_artifacts,'source_id',s);
  assert.ok(k.inclusion_predicate.all_of.length>=2);assert.ok(k.exclusion_predicate.length>=2);
  assert.equal(k.kpi_type,k.grouping_dimensions.length?'PARTITIONED_COUNT':'COUNT');
  assert.deepEqual(Object.keys(k.grouping_vocabularies),k.grouping_dimensions);
  assert.ok(k.known_population_rule.startsWith('COMPLETE_EVALUABLE_V1:'));
  assert.ok(k.UNKNOWN_rule.startsWith('UNKNOWN_V1:'));assert.ok(k.zero_rule.startsWith('ZERO_V1:'));
  assert.match(k.UNKNOWN_rule,/null/);assert.match(k.UNKNOWN_rule,/never become false, zero or NOT_APPLICABLE/);
  assert.match(k.zero_rule,/complete enumerable population/);assert.match(k.zero_rule,/complete scope access and zero matches/);
  assert.match(k.inaccessible_population_rule,/value=null/);assert.match(k.partial_population_rule,/value=null/);
  assert.match(k.not_applicable_rule,/explicit reviewed/);
  for(const r of k.unknown_reasons)assert.ok(d.unknown_reasons[r]);
  for(const r of reasons.filter(r=>k.scope==='TENANT'||r!=='MISSING_TENANT_PROJECTION'))assert.ok(k.unknown_reasons.includes(r));
  assert.ok(k.prohibited_interpretations.includes('REQUIREMENT_SATISFACTION'));
  assert.ok(k.prohibited_interpretations.includes('DECISION_QUALITY_OR_SUFFICIENCY'));
  assert.ok(k.evidence_lineage.length>=2);assert.ok(k.execution_preconditions.length>=2);
  assert.ok(d.temporal_models[k.temporal_model]);assert.equal(k.population_definition.temporal_boundary,k.temporal_model);
  if(k.scope==='TENANT') {
   assert.equal(k.execution_status,'DEFINITION_ONLY');assert.equal(k.temporal_model,'TENANT_BITEMPORAL');
   assert.match(k.authority_requirement,/definition lineage only/);
   assert.match(k.population_definition.scope_binding,/verified principal/);
   assert.match(k.population_definition.scope_binding,/SCOPE_V1/);
   assert.ok(k.permission_read_requirements.some(s=>/same subject\/scope/.test(s)));
   assert.ok(k.execution_preconditions.some(s=>/Separate explicit authorization/.test(s)));
  } else {
   assert.equal(k.temporal_model,'PRODUCT_GIT_SNAPSHOT');assert.match(k.population_definition.scope_binding,/organisation_id must be null/);
   assert.equal(k.execution_status,k.kpi_id.includes('STALE')?'DEFINITION_ONLY':'PRODUCT_DOCUMENTARY_ONLY');
  }
  assert.ok(!/percentage|ratio|score|maturity|probability|\d+\s*%/i.test(k.kpi_type+' '+k.title+' '+k.unit));
  if(k.kpi_id.includes('STALE')) {
   assert.equal(k.freshness_policy_ref,null);assert.equal(k.execution_status,'DEFINITION_ONLY');
   assert.match(k.inclusion_predicate.all_of.join(' '),/policy/);
   assert.match(k.inclusion_predicate.all_of.join(' '),/UNKNOWN/);
   assert.match(k.limitations.join(' '),/NOT_ASSESSED/);
  }
 }
 assert.deepEqual(d.shared_contract.ZERO_V1.requires,['population_proven_enumerable','all_required_sources_successfully_evaluated','complete_access_for_scope','every_predicate_dependency_evaluable','zero_matching_members']);
 assert.equal(d.shared_contract.ZERO_V1.unknown_is_zero,false);assert.equal(d.shared_contract.UNKNOWN_V1.value,null);
 assert.deepEqual(Object.keys(d.axis_vocabularies),['applicability','mapping','evidence_availability','internal_readiness','external_certification_attestation','commercial_claim_eligibility']);
 for(const states of Object.values(d.axis_vocabularies)){unique(states);assert.ok(states.includes('UNKNOWN'));}
 assert.deepEqual(kpi(d,'TENANT.UNKNOWN_REQUIREMENTS_BY_AXIS').grouping_dimensions,['axis','state']);
 assert.match(kpi(d,'TENANT.UNKNOWN_REQUIREMENTS_BY_AXIS').inclusion_predicate.all_of[1],/each of the six/);
 assert.match(kpi(d,'TENANT.REQUIREMENTS_WITH_EVIDENCE').limitations.join(' '),/!= requirement satisfied != compliant/);
 assert.match(kpi(d,'TENANT.GOVERNED_SUPPORTING_DECISIONS').limitations.join(' '),/!= decision quality or sufficiency/);
 assert.match(d.temporal_models.TENANT_BITEMPORAL.recorded_cutoff,/atomic snapshot/);
 assert.match(d.temporal_models.TENANT_BITEMPORAL.non_atomic,/UNKNOWN/);
 assert.equal(d.temporal_models.PRODUCT_GIT_SNAPSHOT.recorded_cutoff.selection_commit,start);
 assert.match(d.version_policy,/new immutable kpi_version AND predicate_version/);
 assert.match(d.shared_contract.SCOPE_V1.scope_ref,/immutable manifest identity\/version/);
 assert.match(d.shared_contract.SCOPE_V1.requirements,/EXPLICIT_REFERENCE_SET/);
 assert.match(d.shared_contract.SCOPE_V1.requirements,/never silently FULL_FRAMEWORK/);
 assert.match(d.shared_contract.SCOPE_V1.binding_limit,/No runtime schema/);
 assert.deepEqual(d.legacy_exclusions,['CompliancePanel percentages','scanner bronze/silver/gold/platinum tiers','graphos-complete scores','legacy risk scores','legacy governance scores','heuristic cost estimates','extension budget defaults','legacy agents/ai_systems counts','legacy ict_incidents']);
 assert.match(d.legacy_boundary,/not proof of containment/);
 assert.equal(d.readiness_pack.length,7);for(const r of d.readiness_pack)assert.equal(r.status,'PRESENT');
 assert.match(d.closure_boundary,/not complete/);assert.match(d.proposed_s5,/S5 not started/);
}
test('S4: complete closed versioned registry, single grains, scopes, predicates and execution limits',()=>validate(doc));
test('S4: full source commits/blobs/digests resolve and unchanged S0-S3 inputs remain pinned',()=>{
 for(const s of doc.source_artifacts) {
  assert.equal(s.commit,start);assert.match(s.git_blob,/^[a-f0-9]{40}$/);assert.match(s.sha256_lf_utf8,/^[a-f0-9]{64}$/);
  assert.equal(git(['rev-parse',`${s.commit}:${s.path}`]),s.git_blob);
  const original=execFileSync('git',['show',`${s.commit}:${s.path}`],{encoding:'utf8'});
  assert.equal(hash(original),s.sha256_lf_utf8);assert.equal(hash(readFileSync(s.path,'utf8')),s.sha256_lf_utf8);
  assert.equal(git(['diff',start,'--',s.path]),'');
 }
 const kinds=readFileSync(by(doc.source_artifacts,'source_id','KINDS').path,'utf8');
 const declared=kinds.match(/export const CANONICAL_OBJECT_KIND = \{([\s\S]*?)\} as const;/)[1];
 assert.deepEqual(kpi(doc,'TENANT.GOVERNED_OBJECTS_WITH_EVIDENCE').population_definition.included_object_kinds,[...declared.matchAll(/\w+: "(\w+)"/g)].map(m=>m[1]));
});
test('S4: exact documentary population selectors/IDs and upstream lineage resolve without executing KPIs',()=>{
 const source=id=>read(by(doc.source_artifacts,'source_id',id).path);
 const s0=source('S0'),catalog=source('CATALOG'),index=source('EVIDENCE'),cw=source('CROSSWALK'),gaps=source('GAPS'),claims=source('CLAIMS');
 assert.equal(s0.capabilities.length,38);assert.equal(index.evidence.length,109);assert.equal(gaps.gaps.length,61);assert.equal(claims.claims.length,42);
 assert.equal(source('AWARDS').awards.length,6);assert.equal(source('CALENDAR').events.length,25);
 for(const [id,src,field,key] of [['PRODUCT.UNRESOLVED_ASSURANCE_GAPS','GAPS','gaps','gap_id'],['PRODUCT.STALE_EVIDENCE_REFERENCES','EVIDENCE','evidence','evidence_id'],['PRODUCT.CAPABILITIES_BY_PROOF_STATUS','S0','capabilities','capability_id'],['PRODUCT.MAPPINGS_BY_STATE','CROSSWALK','capability_dispositions','mapping_id'],['PRODUCT.CLAIM_DRAFTS_BY_ELIGIBILITY','CLAIMS','claims','claim_id']]) {
  const k=kpi(doc,id);assert.equal(k.population_ref,src+'#/'+field);assert.equal(k.inclusion_predicate.selector,'/'+field);
  const rows=source(src)[field];assert.ok(Array.isArray(rows));unique(rows.map(r=>r[key]));
  for(const g of k.grouping_dimensions)for(const row of rows)assert.ok(k.grouping_vocabularies[g].includes(row[g]),'illegal category');
 }
 for(const c of s0.capabilities)for(const e of c.evidence_ids)by(index.evidence,'evidence_id',e);
 for(const row of cw.capability_dispositions) {
  by(s0.capabilities,'capability_id',row.capability_id);
  if(row.requirement_id)by(catalog.requirements,'requirement_id',row.requirement_id);
  if(row.framework_version_id)by(catalog.framework_versions,'framework_version_id',row.framework_version_id);
  for(const e of row.evidence_ids)by(index.evidence,'evidence_id',e);
 }
 for(const r of catalog.requirements)by(catalog.framework_versions,'framework_version_id',r.framework_version_id);
 for(const c of claims.claims){for(const e of c.evidence_ids)by(index.evidence,'evidence_id',e);for(const g of c.gap_ids)by(gaps.gaps,'gap_id',g);}
 assert.ok(gaps.gaps.some(g=>g.gap_id==='G-FRESHNESS'));
 // Upstream records supply identities/metadata, never tenant rows or KPI results.
 assert.equal(catalog.requirements.length,9);assert.equal(cw.capability_dispositions.length,38);
});
test('S4: human-readable Markdown parity covers every JSON field without trailing spaces',()=>{
 const md=readFileSync(root+'kpi-framework-v0.md','utf8').replace(/\r\n/g,'\n');
 assert.equal(md,renderFramework(doc));assert.ok(!/ +$/m.test(md));assert.ok(!md.endsWith('\n\n'),'single terminal newline');
 for(const k of doc.definitions)assert.ok(md.includes('### '+k.kpi_id+' / '+k.kpi_version));
});
test('S4: adversarial metadata mutations reject mixed scopes/grains, fake sources/results and certainty',()=>{
 const mutations=[
  d=>d.definitions.push(structuredClone(d.definitions[0])),
  d=>d.definitions[0].kpi_type='PERCENTAGE',
  d=>d.definitions[0].scope='PRODUCT',
  d=>d.definitions[0].unit='canonical_object_id + finding_id',
  d=>d.definitions[0].deduplication_key=['evidence_id'],
  d=>d.definitions[0].allowed_sources.push('CompliancePanel'),
  d=>d.definitions[0].result=0,
  d=>d.definitions[0].execution_status='EXECUTABLE',
  d=>d.definitions[0].UNKNOWN_rule='missing = false',
  d=>d.shared_contract.ZERO_V1.unknown_is_zero=true,
  d=>d.shared_contract.ZERO_V1.requires.pop(),
  d=>d.definitions[0].unknown_reasons.splice(0,1),
  d=>kpi(d,'TENANT.REQUIREMENTS_WITH_EVIDENCE').limitations=['Requirement satisfied'],
  d=>kpi(d,'TENANT.GOVERNED_SUPPORTING_DECISIONS').limitations=['Sufficient decisions'],
  d=>kpi(d,'PRODUCT.STALE_EVIDENCE_REFERENCES').execution_status='PRODUCT_DOCUMENTARY_ONLY',
  d=>kpi(d,'PRODUCT.STALE_EVIDENCE_REFERENCES').inclusion_predicate.all_of=['Unknown is STALE'],
  d=>d.axis_vocabularies.applicability.pop(),
  d=>d.definitions[0].kpi_version='1.0.1',
  d=>d.legacy_exclusions.pop(),
  d=>d.shared_contract.SCOPE_V1.requirements='Assume all frameworks complete',
 ];
 for(const mutate of mutations){const changed=structuredClone(doc);mutate(changed);assert.throws(()=>validate(changed));}
});
test('S4: semantic revisions cannot silently reuse a historical definition version',()=>{
 const semantic=k=>JSON.stringify(Object.fromEntries(Object.entries(k).filter(([key])=>!['title','description','purpose'].includes(key))));
 const compare=(old,current)=>{for(const before of old.definitions){const after=current.definitions.find(k=>k.kpi_id===before.kpi_id&&k.kpi_version===before.kpi_version);assert.ok(after,'retain historical definition');assert.equal(semantic(after),semantic(before),'same version must preserve semantics');}};
 const changed=structuredClone(doc);changed.definitions[0].inclusion_predicate.all_of.push('changed predicate');assert.throws(()=>compare(doc,changed));
 const revised=structuredClone(doc);revised.definitions.push({...changed.definitions[0],kpi_version:'1.1.0',predicate_version:'1.1.0',supersedes:'1.0.0'});assert.doesNotThrow(()=>compare(doc,revised));
 const path=root+'kpi-framework-v0.json';
 if(git(['ls-tree','HEAD','--',path]))compare(JSON.parse(execFileSync('git',['show','HEAD:'+path],{encoding:'utf8'})),doc);
});
