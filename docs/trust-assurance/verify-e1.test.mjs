// E1 documentary delta only; no assurance evaluator or runtime/database execution.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {renderErrata} from './errata-render-v1.mjs';
const root='docs/trust-assurance/';
const base='a8b8bece4f19f105e418b89996693dfaf2d0c9e1';
const json=p=>JSON.parse(readFileSync(root+p+'.json','utf8'));
const d=json('v0-closure-errata-v1'),s5=json('v0-closure-review');
const claims=json('commercial-claims-register-v0'),gaps=json('gap-register-v0');
const git=args=>execFileSync('git',args,{encoding:'utf8',maxBuffer:20*1024*1024}).trim();
const hash=s=>createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const unique=(xs,key)=>assert.equal(new Set(xs.map(x=>x[key])).size,xs.length,key);
function validate(x){
 assert.equal(x.errata_id,'M17.5-V0-E1');assert.equal(x.reviewed_head,base);
 assert.equal(x.authority.reviewed_head,base);assert.equal(x.authority.reported_P0,0);assert.equal(x.authority.reported_P1,0);
 assert.equal(x.authority.repository_mutation_by_external_review,false);assert.equal(x.authority.independent_review_reperformed_in_e1,false);
 assert.match(x.authority.source_sha256_lf_utf8,/^[a-f0-9]{64}$/);
 assert.deepEqual(x.decisions,{V0_DOCUMENTARY_CLOSURE:'PASS',CONTROLLED_DEMO_READINESS:'HOLD',EXTERNAL_PUBLICATION_READINESS:'HOLD',TENANT_ASSURANCE_READINESS:'HOLD',CERTIFICATION_READINESS:'HOLD',M18:'HOLD'});
 assert.equal(x.closure_statement,'M17.5 V0 READINESS PACK: CLOSED / PASS');assert.equal(x.overall_milestone,'OPEN');
 assert.deepEqual(x.findings.map(f=>f.finding_id),['P2-1','P2-2','P2-3','P2-4','P2-5','P3-6','P3-7','P3-8','P3-9','P3-10','P3-11']);
 const u=x.claim_use_interpretation;
 assert.deepEqual(u.record_access_vocabulary,['INTERNAL_ONLY','CONTROLLED_DEMO_ONLY','EXTERNAL_PUBLICATION_ELIGIBLE','UNKNOWN']);
 assert.deepEqual(u.affirmative_use_vocabulary,['PROHIBITED','CONDITIONAL','PERMITTED','UNKNOWN']);
 assert.equal(u.historical_count_is_affirmative_use_count,false);assert.equal(u.no_new_permission,true);
 assert.deepEqual(u.current_counts,{record_access:{INTERNAL_ONLY:42,CONTROLLED_DEMO_ONLY:0,EXTERNAL_PUBLICATION_ELIGIBLE:0,UNKNOWN:0},affirmative_use:{PROHIBITED:42,CONDITIONAL:0,PERMITTED:0,UNKNOWN:0},INELIGIBLE:42});
 assert.equal(u.records.length,42);unique(u.records,'claim_id');
 assert.deepEqual(u.records.map(c=>c.claim_id),claims.claims.map(c=>c.claim_id));
 for(const [i,c] of u.records.entries()){
  assert.equal(c.record_disposition,claims.claims[i].record_disposition);assert.equal(c.eligibility,'INELIGIBLE');
  assert.equal(c.record_access_state,'INTERNAL_ONLY');assert.equal(c.affirmative_use_state,'PROHIBITED');
  assert.equal(c.controlled_demo_affirmation,'PROHIBITED');assert.equal(c.external_publication,'PROHIBITED');
 }
 assert.deepEqual(u.records.filter(c=>c.record_disposition==='REJECTED_PROPOSAL').map(c=>c.claim_id),['CL-READINESS-01','CL-CERTIFICATION-01','CL-ATTESTATION-01']);
 const p=x.claim_ceiling_precedence;
 assert.equal(p.controlling_claim_ceiling_source,'S2_COMMERCIAL_CLAIMS_REGISTER');
 assert.equal(p.controlling_field,'capability_ceilings.current_claim_ceiling');
 assert.equal(p.source.path,root+'commercial-claims-register-v0.json');
 assert.equal(p.s1_candidate_role,'HISTORICAL_MAPPING_METADATA_ONLY');assert.equal(p.s1_candidate_is_publication_ceiling,false);
 assert.equal(p.v1_may_use_s1_candidate_as_effective_external_ceiling,false);
 assert.equal(p.missing_or_inconsistent_s2_behavior,'FAIL_CLOSED_NO_AFFIRMATIVE_CLAIM');
 assert.deepEqual(p.alignment_candidates,['TA-C11','TA-C12','TA-C26','TA-C27','TA-C28']);assert.equal(p.alignment_candidate_status,'CANDIDATES_ONLY');
 assert.equal(p.effective_ceilings.length,38);unique(p.effective_ceilings,'capability_id');
 assert.deepEqual(p.effective_ceilings,claims.capability_ceilings.map(c=>({capability_id:c.capability_id,current_claim_ceiling:c.current_claim_ceiling,max_defensible_external_class:c.max_defensible_external_class,draft_alignment_ceiling:c.draft_alignment_ceiling,publication_eligibility:'INELIGIBLE'})));
 assert.deepEqual(p.effective_ceilings.filter(c=>c.current_claim_ceiling==='NO_AFFIRMATIVE_CLAIM').map(c=>c.capability_id),['TA-C35','TA-C36','TA-C37','TA-C38']);
 const pop=x.populations;
 assert.equal(pop.assurance_gap_population.source.path,root+'gap-register-v0.json');assert.equal(pop.assurance_gap_population.count,61);
 assert.deepEqual(pop.assurance_gap_population.status_counts,{OPEN:61});assert.deepEqual(pop.assurance_gap_population.member_ids,gaps.gaps.map(g=>g.gap_id));
 const e=pop.presentation_exposure_gate_population;
 assert.equal(e.policy,'APPEND_ONLY_SEPARATE_POPULATION');assert.equal(e.historical_gap_membership,false);assert.equal(e.scope_expansions_are_new_members,false);
 assert.deepEqual(e.inherited_ids,s5.legacy_gates.map(g=>g.surface_id));
 assert.deepEqual(e.appended_ids,['LX08_AUDIT_TRAIL','LX09_DORMANT_PDF_GENERATORS']);
 assert.equal(e.member_count,e.inherited_ids.length+e.appended_ids.length);assert.equal(e.closure,'OPEN_UNIVERSE_NOT_EXHAUSTIVE');
 assert.deepEqual(x.appended_exposure_gates.map(g=>g.surface_id),e.appended_ids);
 for(const g of x.appended_exposure_gates){
  assert.equal(g.classification,'NEEDS_CONTAINMENT');assert.equal(g.status,'OPEN');
  assert.equal(g.blocks_documentary_closure,false);assert.equal(g.blocks_controlled_demo,true);assert.equal(g.blocks_external_presentation,true);
  assert.equal(g.remediation_in_e1,false);assert.equal(g.hosted_reachability,'UNKNOWN');assert.ok(g.sources.length>=6);
 }
 const audit=x.appended_exposure_gates[0];assert.equal(audit.tenant_security_remediation_review_required,true);assert.equal(audit.security_review_status,'REQUIRED_NOT_PERFORMED');
 for(const phrase of ['VALID/BROKEN','without organisation filtering','Empty ledger','missing result row','legacy oversight'])assert.ok(audit.observations.join(' ').includes(phrase),phrase);
 const pdf=x.appended_exposure_gates[1];assert.equal(pdf.related_historical_surface_id,'L05');
 for(const phrase of ['Compliance Rate %','AI Act Exposure','DORA Status','re-enabling'])assert.ok(pdf.observations.join(' ').includes(phrase));
 const l04=x.exposure_scope_expansions[0];assert.equal(x.exposure_scope_expansions.length,1);assert.equal(l04.input_id,'L04_PACKAGE_COMPATIBILITY');assert.equal(l04.parent_surface_id,'L04');assert.equal(l04.classification,'NEEDS_CONTAINMENT');assert.equal(l04.remediation_in_e1,false);
 assert.deepEqual(l04.observations.slice(1),['ISO 42001 Readiness','AI Act Technical File','SOC2 Control Pack','Certification Readiness']);
 const [mapping,wording,m18]=x.corrected_interpretations;
 assert.equal(mapping.claim_id,'CL-CERTIFICATION-01');assert.equal(mapping.framework_version_id,'ISO-IEC-42001-2023-ED1');assert.equal(mapping.corrected_scoped_mapping_state,'UNKNOWN');assert.equal(mapping.historical_record_modified,false);assert.equal(mapping.external_certification_state,'NOT_ASSERTED');
 assert.equal(wording.status,'TEMPLATE_NOT_APPROVED');assert.equal(wording.wording_approval,false);assert.equal(wording.publication,false);
 assert.deepEqual(wording.prohibited_examples,['fully governed','100% compliant','supports EU AI Act compliance','audit-ready','EU AI Act ready']);assert.match(wording.semantic_rule,/semantically equivalent/);
 assert.equal(m18.classification,'FORWARD_LOOKING_PLANNING_TERMINOLOGY');assert.equal(m18.canonical_architecture_at_reviewed_head,false);assert.equal(m18.m18_formalized_in_e1,false);assert.equal(m18.m18_started,false);
 const [a1,a2]=x.mandatory_v1_acceptance_inputs;
 assert.deepEqual(x.mandatory_v1_acceptance_inputs.map(a=>a.acceptance_id),['V1-A1','V1-A2']);
 for(const a of x.mandatory_v1_acceptance_inputs){assert.equal(a.status,'UNRESOLVED');assert.equal(a.mandatory,true);assert.equal(a.decision_in_e1,false);}
 assert.equal(a1.historical_field,'known_population');assert.equal(a1.historical_kpi_framework_modified,false);assert.match(a1.required_decision,/conservation \/ UNKNOWN/);assert.match(a1.required_decision,/hidden denominator/);
 assert.equal(a2.resolvers_modified,false);assert.match(a2.required_decision,/every Hub read hop/);assert.match(a2.required_decision,/No V1 tenant assurance path may substitute service_role\/direct-table access for verified-principal authorization/);
 assert.ok(Object.values(x.delta).every(v=>v===0));assert.match(x.next_action,/V1-S0 and M18 not started/);
}
test('E1: corrected semantics, populations, exposure inputs, mandatory unresolved V1 gates and HOLDs',()=>{
 assert.equal(gaps.gaps.length,61);assert.ok(gaps.gaps.every(g=>g.status==='OPEN'));
 assert.equal(claims.claims.length,42);assert.ok(claims.claims.every(c=>c.eligibility==='INELIGIBLE'));validate(d);
});
test('E1: all historical S0-S5 inputs retain exact Git blobs and working content',()=>{
 const tree=new Map(git(['ls-tree','-r',base]).split('\n').map(l=>{const [meta,path]=l.split('\t');return [path,meta.split(' ')[2]];}));
 const expected=[...new Set([...tree.keys()].filter(p=>p.startsWith(root)).concat(s5.input_inventory.map(a=>a.path),'docs/codex/evidence/2026-10-20-m17.5-s5-v0-closure.md'))].sort();
 assert.deepEqual(d.historical_artifacts.map(a=>a.path),expected);
 for(const a of d.historical_artifacts){assert.equal(a.selection_commit,base);assert.equal(a.git_blob,tree.get(a.path));assert.equal(hash(readFileSync(a.path,'utf8')),a.sha256_lf_utf8,a.path);assert.equal(hash(execFileSync('git',['show',base+':'+a.path],{encoding:'utf8',maxBuffer:20*1024*1024})),a.sha256_lf_utf8,a.path+' base content');}
});
test('E1: source locators pin unchanged bytes and actual line anchors, Markdown fully projects JSON',()=>{
 // Shared pins are verified once, avoiding redundant Git subprocesses.
 const pins=[...d.appended_exposure_gates.flatMap(g=>g.sources),...d.exposure_scope_expansions.flatMap(g=>g.sources)];
 const blobs=new Map();
 for(const p of pins){if(!blobs.has(p.path))blobs.set(p.path,git(['rev-parse',base+':'+p.path]));assert.equal(p.selection_commit,base);assert.equal(p.git_blob,blobs.get(p.path));const body=readFileSync(p.path,'utf8');assert.equal(hash(body),p.sha256_lf_utf8);assert.ok(body.split(/\r?\n/)[p.line-1].includes(p.anchor));assert.equal(p.locator,`https://github.com/cnegrao/code-guard-governance/blob/${base}/${p.path}#L${p.line}`);}
 for(const p of [d.claim_ceiling_precedence.source,d.populations.assurance_gap_population.source,d.populations.presentation_exposure_gate_population.base_source,d.mandatory_v1_acceptance_inputs[0].historical_source]){
  assert.deepEqual(p,d.historical_artifacts.find(a=>a.path===p.path));
 }
 assert.equal(readFileSync(root+'v0-closure-errata-v1.md','utf8').replace(/\r\n/g,'\n'),renderErrata(d));
});
test('E1 negative mutations reject promotion, omitted audit/PDF, mixed populations, elevated S1 ceiling and premature V1 decisions',()=>{
 const mutations=[
  x=>x.decisions.CONTROLLED_DEMO_READINESS='PASS',
  x=>x.claim_use_interpretation.records.find(c=>c.claim_id==='CL-CERTIFICATION-01').affirmative_use_state='PERMITTED',
  x=>x.claim_use_interpretation.records[0].record_access_state='EXTERNAL_PUBLICATION_ELIGIBLE',
  x=>x.claim_ceiling_precedence.controlling_claim_ceiling_source='S1_CROSSWALK',
  x=>x.claim_ceiling_precedence.effective_ceilings.find(c=>c.capability_id==='TA-C11').current_claim_ceiling='EVIDENCE_BACKED_ALIGNMENT_CANDIDATE',
  x=>x.claim_ceiling_precedence.effective_ceilings.find(c=>c.capability_id==='TA-C35').current_claim_ceiling='FACTUAL_CAPABILITY_ONLY',
  x=>x.populations.assurance_gap_population.member_ids.push('LX08_AUDIT_TRAIL'),
  x=>x.populations.presentation_exposure_gate_population.historical_gap_membership=true,
  x=>x.appended_exposure_gates.shift(),x=>x.appended_exposure_gates.pop(),
  x=>x.appended_exposure_gates[0].classification='SAFE',
  x=>x.appended_exposure_gates[0].blocks_controlled_demo=false,
  x=>x.exposure_scope_expansions=[],
  x=>x.mandatory_v1_acceptance_inputs[0].status='RESOLVED',
  x=>x.mandatory_v1_acceptance_inputs[1].mandatory=false,
  x=>x.corrected_interpretations[0].corrected_scoped_mapping_state='NOT_MAPPED',
  x=>x.corrected_interpretations[1].wording_approval=true,
  x=>x.corrected_interpretations[2].canonical_architecture_at_reviewed_head=true,
 ];
 for(const mutate of mutations){const x=structuredClone(d);mutate(x);assert.throws(()=>validate(x));}
});
