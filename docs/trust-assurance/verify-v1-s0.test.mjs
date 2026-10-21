// Documentary design checks only. No Hub evaluator, API, UI, tenant reads or DB execution.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
const base='a85f97225777e1dd1fd67109a349c3be6e45d0ad';
const root='docs/trust-assurance/';
const read=p=>readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const json=n=>JSON.parse(read(root+n+'.json'));
const d=json('v1-hub-read-contract'),e=json('v0-closure-errata-v1'),s5=json('v0-closure-review');
const claims=json('commercial-claims-register-v0'),gaps=json('gap-register-v0'),catalog=json('framework-source-catalog-v0');
const git=args=>execFileSync('git',args,{encoding:'utf8',maxBuffer:30*1024*1024}).trim();
const hash=s=>createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const ordered=(xs,key)=>xs.map(x=>x[key]);
const unique=xs=>assert.equal(new Set(xs).size,xs.length);
const ids=(prefix,n)=>Array.from({length:n},(_,i)=>prefix+String(i+1).padStart(2,'0'));

// Invariant validator used by the negative design mutations below, not a runtime consumer.
function validate(x){
 assert.equal(x.contract_id,'M17.5-V1-S0');assert.equal(x.starting_head,base);
 assert.equal(x.branch,'feat/m17.5-trust-assurance-v0');assert.equal(x.status,'ARCHITECTURE_CONTRACT_ONLY');
 assert.deepEqual(x.frozen,d.frozen);assert.equal(x.frozen.new_canonical_authority,false);assert.equal(x.frozen.new_authority_permissions,0);
 assert.deepEqual(x.decisions,{V0_READINESS_PACK:'CLOSED / PASS',V0_E1:'CLOSED / PASS',V1_S0:'CLOSED / PASS',M17_5_OVERALL:'OPEN',CONTROLLED_DEMO_READINESS:'HOLD',EXTERNAL_PUBLICATION_READINESS:'HOLD',TENANT_ASSURANCE_READINESS:'HOLD',CERTIFICATION_READINESS:'HOLD',M18:'HOLD'});
 assert.equal(x.modes.PRODUCT_ASSURANCE.organisation_id,null);assert.equal(x.modes.PRODUCT_ASSURANCE.mix_with_tenant,false);
 assert.equal(x.modes.TENANT_ASSURANCE.mix_with_product,false);assert.equal(x.modes.TENANT_ASSURANCE.mutates_product_claims,false);assert.equal(x.modes.TENANT_ASSURANCE.execution_available,false);
 assert.deepEqual(ordered(x.architecture_decisions,'decision_id'),ids('D-V1-',15));
 assert.deepEqual(ordered(x.acceptance,'acceptance_id'),ids('W-V1-',20));
 const readIDs=ordered(x.read_inventory,'read_id');unique(readIDs);assert.equal(readIDs.length,40);
 const classes=new Set(ordered(x.read_security_classes,'id'));
 const required=['source_projection','data_class','tenant_bound','subject_scope','verified_principal_bound','authorization_enforcement','security_definer','direct_table','service_role','effective_at_support','recorded_cutoff_support','atomic_support','fail_closed','usable_by_v1','additive_projection_required','security_class','sources'];
 for(const r of x.read_inventory){
  for(const k of required)assert.ok(Object.hasOwn(r,k),r.read_id+': '+k);
  assert.ok(classes.has(r.security_class));assert.ok(r.sources.length);
  if(r.security_class==='PRIVILEGED_APP_FILTERED'||r.security_class==='UNSAFE_FOR_V1'){
   assert.equal(r.usable_by_v1,'NO',r.read_id);assert.equal(r.additive_projection_required,true);assert.equal(r.verified_principal_bound,false);
  }
  if(r.usable_by_v1==='CONDITIONAL_COMPONENT_ONLY'){
   assert.equal(r.verified_principal_bound,true);assert.equal(r.security_definer,true);assert.equal(r.direct_table,false);
   assert.equal(r.transport_class,'PRIVILEGED_TRANSPORT_WITH_DB_AUTHZ');assert.equal(r.atomic_support,'NOT_ESTABLISHED');
   assert.match(r.effective_at_support,/non-null pinned/);assert.match(r.recorded_cutoff_support,/non-null pinned/);
  }
  assert.notEqual(r.usable_by_v1,'TENANT_ASSURANCE_READY');
 }
 for(const id of ['R-IDENTITY','R-RELATIONSHIP','R-PROFILE','R-RECONCILIATION','R-EVIDENCE','R-TECHNICAL','R-LOOKUP','R-EXECUTION','R-PASSPORT-COMPOSITE','R-RUNTIME-EXACT','R-CROSS-SIGNAL','R-AUDIT'])assert.ok(readIDs.includes(id),id);
 assert.equal(x.scope_manifest.canonical_object,false);
 const scope=x.scope_manifest.fields;
 for(const field of ['organisation_id','intended_assurance_use','selected_framework_versions','requirement_population_mode','governed_subject_population','allowed_source_connections','evidence_source_versions','effective_at','recorded_cutoff','access_permission_context','acquisition_completeness_state','excluded_sources','population_limitations','UNKNOWN_conditions'])assert.ok(Object.hasOwn(scope,field),field);
 assert.deepEqual(scope.requirement_population_mode,['EXPLICIT_REFERENCE_SET','FULL_FRAMEWORK']);
 assert.equal(x.temporal_contract.atomicity.required,'ATOMIC');assert.match(x.temporal_contract.atomicity.database,/consistent transaction snapshot/);
 assert.match(x.temporal_contract.atomicity.failure,/NON_ATOMIC -> UNKNOWN/);assert.match(x.temporal_contract.latest_rule,/PROHIBITED/);
 assert.deepEqual(ordered(x.failure_contract,'state'),['UNKNOWN','NOT_MAPPED','NOT_APPLICABLE','NOT_ASSESSED','INSUFFICIENT_EVIDENCE','SOURCE_PENDING','ACCESS_DENIED','PARTIAL_ACQUISITION','DEPENDENCY_INVALID','NOT_ASSERTED']);
 const k=x.kpi_denominator_decision,g=k.generic_projection;
 assert.equal(k.acceptance_id,'V1-A1');assert.equal(k.status,'RESOLVED_ARCHITECTURALLY_ONLY');assert.equal(k.historical_framework_modified,false);
 assert.equal(k.selected,'B_TYPED_NON_COMPOSABLE_COUNTS_WITH_AUDIT_IDENTITY_SEPARATION');assert.deepEqual(ordered(k.alternatives,'id'),['A','B','C']);
 assert.ok(g.absent_fields.includes('known_population'));assert.ok(g.absent_fields.includes('denominator'));
 assert.deepEqual(g.allowed_operations,['DISPLAY_INTEGER','DISPLAY_CLOSED_PARTITIONS','FILTER_DECLARED_DIMENSION','DRILL_DOWN_AUTHORIZED']);
 assert.deepEqual(g.renderers,['COUNT','PARTITIONED_COUNT','STATE','DEFINITION']);
 for(const op of ['DIVIDE','RATIO','PERCENT','SUM_PARTITIONS_AS_DENOMINATOR'])assert.ok(g.prohibited_operations.includes(op));
 assert.ok(g.fields.every(f=>!['known_population','denominator','total_population'].includes(f)));
 assert.match(k.audit_projection.conservation,/disjoint union/);assert.match(k.audit_projection.no_hidden_denominator,/No denominator/);
 assert.match(k.enforcement,/serialization allowlist/);assert.match(k.limit,/off-system arithmetic/);
 assert.equal(x.claim_contract.controlling_source,'S2_COMMERCIAL_CLAIMS_REGISTER');assert.equal(x.claim_contract.controlling_field,'capability_ceilings.current_claim_ceiling');assert.equal(x.claim_contract.s1_effective_publication_ceiling,false);
 assert.deepEqual(x.claim_contract.current_counts,{INELIGIBLE:42,INTERNAL_ONLY:42,PROHIBITED:42});
 assert.deepEqual(x.claim_contract.claim_ids,ordered(claims.claims,'claim_id'));
 assert.deepEqual(x.claim_contract.capability_ceilings,claims.capability_ceilings.map(c=>({capability_id:c.capability_id,current_claim_ceiling:c.current_claim_ceiling})));
 assert.equal(x.populations.cross_population_sum,false);assert.equal(x.populations.ASSURANCE_GAPS.count,61);
 assert.deepEqual(x.populations.ASSURANCE_GAPS.member_ids,ordered(gaps.gaps,'gap_id'));
 assert.deepEqual(x.populations.PRESENTATION_EXPOSURE_GATES.member_ids,[...e.populations.presentation_exposure_gate_population.inherited_ids,...e.populations.presentation_exposure_gate_population.appended_ids]);
 assert.equal(x.populations.PRESENTATION_EXPOSURE_GATES.known_member_count,14);assert.equal(x.populations.PRESENTATION_EXPOSURE_GATES.completeness,'OPEN_UNIVERSE_NOT_EXHAUSTIVE');
 assert.equal(x.certification_contract.current_state,'NOT_ASSERTED');assert.equal(x.certification_contract.external_artifacts_in_pack,0);assert.equal(x.certification_contract.positive_requires.length,10);
 assert.equal(x.european_profile.aggregate_legal_compliance_state,false);assert.equal(x.european_profile.operative_law_state,'UNKNOWN');assert.equal(x.european_profile.applicability_state,'UNKNOWN');assert.equal(x.european_profile.axes.length,7);
 assert.deepEqual(ordered(x.exposure_levels,'level'),['INTERNAL_REVIEW','CONTROLLED_DOCUMENT_WALKTHROUGH','CONTROLLED_PRODUCT_DEMO','EXTERNAL_PUBLICATION','TENANT_ASSURANCE','EXTERNAL_CERTIFICATION_ASSERTION']);assert.ok(x.exposure_levels.every(v=>v.granted_by_s0===false));
 const exposureIDs=ordered(x.legacy_dependencies,'surface_id');assert.deepEqual(exposureIDs,x.populations.PRESENTATION_EXPOSURE_GATES.member_ids);
 assert.ok(x.legacy_dependencies.every(l=>!l.implemented&&l.independent_review_required));
 assert.match(x.legacy_dependencies.find(l=>l.surface_id==='L04').boundary,/package compatibility/);
 assert.match(x.legacy_dependencies.find(l=>l.surface_id==='LX08_AUDIT_TRAIL').boundary,/principal authorization/);
 assert.match(x.legacy_dependencies.find(l=>l.surface_id==='L05').boundary,/SAFE only/);
 assert.deepEqual(ordered(x.views,'view_id'),Array.from('ABCDEFGHIJK'));
 for(const v of x.views){
  for(const id of v.authoritative_projection_inputs)assert.ok(readIDs.includes(id),id);
  assert.deepEqual(v.legacy_blockers,x.legacy_dependencies.filter(l=>l.blocked_view_ids.includes(v.view_id)).map(l=>l.surface_id));
  assert.ok(v.exposure_boundary.independent_review_required);assert.ok(v.implementation_classification.length);
  for(const c of v.implementation_classification)assert.ok(x.implementation_classes.includes(c));
 }
 const sliceIDs=ordered(x.slices,'slice_id');unique(sliceIDs);
 for(const [i,s]of x.slices.entries()){assert.equal(s.status,'PROPOSED_NOT_STARTED');assert.ok(s.requires_separate_owner_authorization);for(const dep of s.depends_on)assert.ok(sliceIDs.indexOf(dep)<i&&sliceIDs.indexOf(dep)>=0);}
 assert.equal(x.slices[0].slice_id,'V1-S1A');assert.equal(x.future_consumer_interface.M18_canonical,false);assert.equal(x.future_consumer_interface.M18_started,false);assert.equal(x.future_consumer_interface.M18_specific_API,false);
 assert.ok(Object.values(x.delta).every(v=>v===0));
}

test('V1-S0 documentary decisions, exact populations and fail-closed state',()=>{
 assert.deepEqual([d.frozen.canonical_object_kinds,d.frozen.governed_relationship_types,d.frozen.passport_families],[11,12,16]);validate(d);
 assert.ok(gaps.gaps.every(g=>g.status==='OPEN'));assert.ok(claims.claims.every(c=>c.eligibility==='INELIGIBLE'));
 assert.equal(e.mandatory_v1_acceptance_inputs[0].status,'UNRESOLVED');assert.equal(e.mandatory_v1_acceptance_inputs[1].status,'UNRESOLVED');
});

test('V1-S0 preserves every historical artifact and pins every code/source anchor',()=>{
 const tree=new Map(git(['ls-tree','-r',base]).split('\n').map(l=>{const[meta,path]=l.split('\t');return[path,meta.split(' ')[2]];}));
 const paths=[...new Set([...tree.keys()].filter(p=>p.startsWith(root)).concat(s5.input_inventory.map(x=>x.path),'docs/architecture/ADR-GOVIA-TRUST-ASSURANCE-v1.md','docs/codex/evidence/2026-10-20-m17.5-s0-trust-assurance-inventory.json'))].sort();
 assert.deepEqual(ordered(d.historical_inputs,'path'),paths);assert.equal(paths.length,45);
 const pins=[...d.historical_inputs,...d.read_inventory.flatMap(r=>r.sources)];
 const checked=new Map();
 for(const p of pins){
  assert.equal(p.selection_commit,base);assert.equal(p.git_blob,tree.get(p.path));
  if(!checked.has(p.path))checked.set(p.path,hash(read(p.path)));
  assert.equal(p.sha256_lf_utf8,checked.get(p.path),p.path);
  if(p.line){assert.ok(read(p.path).split('\n')[p.line-1].includes(p.anchor));assert.equal(p.locator,`https://github.com/cnegrao/code-guard-governance/blob/${base}/${p.path}#L${p.line}`);}
 }
 // A verified unchanged base blob proves all historical nested source versions remain immutable too.
 for(const p of d.historical_inputs)assert.equal(hash(execFileSync('git',['show',base+':'+p.path],{encoding:'utf8',maxBuffer:25*1024*1024})),p.sha256_lf_utf8);
});

test('V1-S0 read inventory covers actual Passport/execution tables, runtime lookup and authorized SQL categories',()=>{
 const passport=read('apps/dashboard/lib/governance/passport-read-store.ts');
 const actual=[...passport.matchAll(/^  ([a-z_]+): \[/gm)].map(m=>m[1]).sort();
 const groups=['R-IDENTITY','R-RELATIONSHIP','R-PROFILE','R-RECONCILIATION','R-EVIDENCE','R-TECHNICAL'];
 assert.deepEqual(d.read_inventory.filter(r=>groups.includes(r.read_id)).flatMap(r=>r.underlying_tables).sort(),actual);
 const execution=read('apps/dashboard/lib/governance/execution-context-read.ts');
 assert.deepEqual(d.read_inventory.find(r=>r.read_id==='R-EXECUTION').underlying_tables,[...execution.matchAll(/^  ([a-z_]+): '/gm)].map(m=>m[1]));
 for(const r of d.read_inventory.filter(r=>r.source_projection.startsWith('l14_read_')||r.source_projection.startsWith('l15_read_'))){
  const p=r.sources[0];const sql=read(p.path).slice(read(p.path).indexOf('FUNCTION gov_repo.'+r.source_projection+'('));
  assert.match(sql,/p_verified_organisation_id/);assert.match(sql,/SECURITY DEFINER/);assert.match(sql,/l14_session_basis_v1|l15_require_member_v1/);
  if(r.usable_by_v1==='CONDITIONAL_COMPONENT_ONLY')assert.match(sql,/p_effective_at[\s\S]*p_recorded_cutoff/);
 }
 const runtime=d.read_inventory.find(r=>r.read_id==='R-RUNTIME-EXACT');assert.equal(runtime.verified_principal_bound,false);assert.equal(runtime.security_class,'UNSAFE_FOR_V1');
 assert.match(runtime.authorization_enforcement,/scoped lookup is not principal authorization/);
 const internal=d.read_inventory.find(r=>r.read_id==='R-INTERNAL-RESOLVERS');
 assert.equal(internal.security_definer,'ROUTINE_SPECIFIC_OWNER_ONLY');assert.equal(internal.service_role,false);
 assert.match(internal.internal_subhop_rule,/do not blanket-classify internal resolvers as SECURITY DEFINER/);
 for(const id of ['R-M16-POLICY','R-M17-SIGNALS','R-M17-HYPOTHESES'])assert.equal(d.read_inventory.find(r=>r.read_id===id).usable_by_v1,'NO_TENANT_AS_OF_USE');
});

test('V1-S0 all view, source, capability, evidence, requirement, claim, gap and slice references resolve',()=>{
 const inv=JSON.parse(read('docs/codex/evidence/2026-10-20-m17.5-s0-trust-assurance-inventory.json'));
 const evidence=new Set(json('evidence-index-v0').evidence.map(v=>v.evidence_id));
 const caps=new Set(inv.capabilities.map(v=>v.capability_id));
 const requirements=new Set(catalog.requirements.map(r=>r.requirement_id));const versions=new Set(catalog.framework_versions.map(r=>r.framework_version_id));
 for(const v of json('framework-crosswalk-v0').capability_dispositions){assert.ok(caps.has(v.capability_id));for(const id of v.evidence_ids)assert.ok(evidence.has(id));if(v.requirement_id)assert.ok(requirements.has(v.requirement_id));if(v.framework_version_id)assert.ok(versions.has(v.framework_version_id));}
 for(const c of claims.claims){for(const id of c.capability_ids)assert.ok(caps.has(id));for(const id of c.evidence_ids)assert.ok(evidence.has(id));for(const id of c.gap_ids)assert.ok(d.populations.ASSURANCE_GAPS.member_ids.includes(id));}
 for(const c of d.claim_contract.capability_ceilings)assert.ok(caps.has(c.capability_id));
 assert.ok(versions.has(d.european_profile.base_reference));for(const id of d.european_profile.reference_ids)assert.ok(requirements.has(id));
 for(const cap of d.additional_capabilities){for(const id of cap.read_ids)assert.ok(d.read_inventory.some(r=>r.read_id===id));for(const c of cap.implementation_classification)assert.ok(d.implementation_classes.includes(c));}
});

test('V1-S0 negative design mutations reject authority, transport, snapshot, denominator, claims and exposure promotion',()=>{
 const mutations=[
  x=>x.frozen.new_canonical_authority=true,x=>x.frozen.new_authority_permissions=1,
  x=>x.modes.TENANT_ASSURANCE.mix_with_product=true,x=>x.modes.TENANT_ASSURANCE.execution_available=true,
  x=>x.read_inventory.find(r=>r.read_id==='R-EVIDENCE').usable_by_v1='CONDITIONAL_COMPONENT_ONLY',
  x=>x.read_inventory.find(r=>r.read_id==='R-RUNTIME-EXACT').verified_principal_bound=true,
  x=>x.read_inventory.find(r=>r.read_id==='R-M17-LIFECYCLE').transport_class='SERVICE_ROLE_AUTHORITY',
  x=>x.read_inventory.pop(),x=>x.scope_manifest.canonical_object=true,
  x=>x.temporal_contract.atomicity.required='MATCHING_TIMESTAMPS_ONLY',x=>x.temporal_contract.atomicity.failure='READY',
  x=>x.kpi_denominator_decision.generic_projection.fields.push('known_population'),
  x=>x.kpi_denominator_decision.generic_projection.allowed_operations.push('DIVIDE'),
  x=>x.kpi_denominator_decision.generic_projection.renderers.push('PERCENT'),
  x=>x.kpi_denominator_decision.historical_framework_modified=true,
  x=>x.claim_contract.controlling_source='S1_CROSSWALK',x=>x.claim_contract.s1_effective_publication_ceiling=true,
  x=>x.claim_contract.current_counts.PROHIBITED=41,
  x=>x.claim_contract.capability_ceilings.find(c=>c.capability_id==='TA-C35').current_claim_ceiling='FACTUAL_CAPABILITY_ONLY',
  x=>x.populations.cross_population_sum=true,x=>x.populations.ASSURANCE_GAPS.member_ids.push('LX08_AUDIT_TRAIL'),
  x=>x.populations.PRESENTATION_EXPOSURE_GATES.member_ids.pop(),
  x=>x.certification_contract.current_state='CERTIFIED',x=>x.european_profile.aggregate_legal_compliance_state=true,
  x=>x.european_profile.operative_law_state='CURRENT',x=>x.exposure_levels[1].granted_by_s0=true,
  x=>x.legacy_dependencies.find(l=>l.surface_id==='LX08_AUDIT_TRAIL').implemented=true,
  x=>x.slices[0].status='STARTED',x=>x.future_consumer_interface.M18_canonical=true,
  x=>x.decisions.CONTROLLED_DEMO_READINESS='PASS',x=>x.delta.API=1
 ];
 for(const [i,mutate]of mutations.entries()){const x=structuredClone(d);mutate(x);assert.throws(()=>validate(x),'mutation '+i);}
});

test('V1-S0 human documents expose all decisions, reads, views, gates and local links',()=>{
 const md=read(root+'v1-hub-read-contract.md');const adr=read('docs/architecture/ADR-GOVIA-TRUST-ASSURANCE-HUB-v1.md');
 for(const x of d.architecture_decisions){assert.ok(md.includes(x.decision_id));assert.ok(adr.includes(x.decision_id));assert.ok(md.includes(x.decision));}
 for(const r of d.read_inventory){assert.ok(md.includes(r.read_id));assert.ok(md.includes(r.fail_closed.replaceAll('|',' / ')));for(const p of r.sources)assert.ok(md.includes(p.locator));}
 for(const v of d.views)assert.ok(md.includes(`### ${v.view_id}. ${v.name}`));
 for(const a of d.acceptance)assert.ok(md.includes(a.acceptance_id));for(const l of d.legacy_dependencies)assert.ok(md.includes(l.surface_id));
 for(const phrase of ['RESOLVED_ARCHITECTURALLY_ONLY','disjoint union','No exposure level is granted','V1-S1A','M18','UNKNOWN','HOLD'])assert.ok(md.includes(phrase),phrase);
 for(const p of [root+'v1-hub-read-contract.md','docs/architecture/ADR-GOVIA-TRUST-ASSURANCE-HUB-v1.md'])for(const m of read(p).matchAll(/\]\(([^)]+)\)/g)){const target=m[1].split('#')[0];if(target&&!target.includes('://'))assert.ok(existsSync(resolve(dirname(p),target)),p+': '+target);}
});
