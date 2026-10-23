// Documentation/reference guards only; offline, no product or PostgreSQL execution.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { renderMatrix, renderCalendar } from './award-render-v0.mjs';

const root='docs/trust-assurance/';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const matrix=read(root+'award-readiness-matrix-v0.json');
const calendar=read(root+'award-calendar-v0.json');
const s0=read('docs/codex/evidence/2026-10-20-m17.5-s0-trust-assurance-inventory.json');
const index=read(root+'evidence-index-v0.json');
const gaps=read(root+'gap-register-v0.json');
const claims=read(root+'commercial-claims-register-v0.json');
const start='c354691e8dc24e771c4887a999f57f2165dc14ac';
const by=(xs,key,id)=>xs.find(x=>x[key]===id);
const uniq=xs=>[...new Set(xs)];
const count=(xs,k)=>Object.fromEntries(uniq(xs.map(x=>x[k])).sort().map(v=>[v,xs.filter(x=>x[k]===v).length]));
const hash=s=>createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const lf=s=>s.replace(/\r\n/g,'\n');
const required=(obj,keys)=>{for(const k of keys)assert.ok(Object.hasOwn(obj,k),'missing '+k);};
const unique=(xs,k)=>assert.equal(uniq(xs.map(x=>x[k])).length,xs.length,k);
const resolve=(ids,xs,k)=>ids.forEach(id=>assert.ok(by(xs,k,id),'unresolved '+k+': '+id));
const clone=()=>structuredClone(matrix);
const expectedEditions=['WITSA-AI-2026','APDSI-TD-2026-6','EAIF-AI-2026','DMI-EUROPE-2026','CYBER-2027','PNI-9-2025-26'];
const dimensions=['legal_entity','geography','incorporation_country','company_age','company_size','revenue_funding','product_launch','customer_deployment','category_fit','nomination','membership','fee','language','conflict_exclusion'];
const sourceUrls={
  'SRC-W':'https://www.witsa.org/witsa-global-ai-awards-2026',
  'SRC-A':'https://apdsi.pt/2026/inscricoes-abertas-6a-edicao-do-premio-transformacao-digital/',
  'SRC-AR':'https://apdsi.pt/wp-content/uploads/2026/09/Regulamento-Premio-Transformacao-Digital-2026.pdf',
  'SRC-AF':'https://apdsi.pt/wp-content/uploads/2026/09/Formulario-de-candidatura-Premio-Transformacao-Digital_2026.pdf',
  'SRC-E':'https://eaiforum.org/eaif-awards/eaif-awards-2026',
  'SRC-ER':'https://assets.super.so/cbdb2971-67c2-4627-9101-9e5ffbbe0b93/files/1a4d6f9e-33cc-4cb1-89de-47a918772415/european_ai_awards_2026_terms_and_conditions.pdf',
  'SRC-D':'https://a-teaminsight.com/awards/data-management-insight-awards-europe/',
  'SRC-DE':'https://a-teaminsight.com/awards/data-management-insight-awards-europe/?section=enter',
  'SRC-DC':'https://a-teaminsight.com/awards/data-management-insight-awards-europe/?section=categories',
  'SRC-C':'https://www.cybersecurityawards.com/',
  'SRC-CM':'https://www.cybersecurityawards.com/methodology/',
  'SRC-P':'https://www.premiodeinovacao.com.br/',
  'SRC-PR':'https://www.premiodeinovacao.com.br/media/filer_public/0d/93/0d938d43-12da-4490-9123-f1eb1e0fcbce/regulamento_retificado_empresas_pesquisadores.pdf',
};
function reference(doc,ref,edition) {
  assert.ok(ref?.locator && ref.source_id,'exact source locator required');
  const source=by(doc.sources,'source_id',ref.source_id);
  assert.ok(source,'unresolved source');
  assert.equal(source.source_status,'AUTHORITATIVE_SOURCE_VERIFIED');
  if(edition)assert.ok(source.edition_ids.includes(edition),'source edition mismatch');
}
function expectedReadiness(r) {
  if(!r.criteria.length || r.submission_window_state==='UNKNOWN')return 'SOURCE_PENDING';
  if(r.eligibility_state==='INELIGIBLE')return 'NOT_ELIGIBLE';
  if(r.eligibility_state!=='ELIGIBLE' || r.eligibility_checks.some(c=>c.assessment==='UNKNOWN'))return 'ELIGIBILITY_UNKNOWN';
  if(r.criteria.some(c=>c.satisfaction_state!=='SUFFICIENT_REVIEWED'))return 'EVIDENCE_INSUFFICIENT';
  if(r.gap_ids.length || r.review_state!=='APPROVED' || !r.reviewer)return 'GAPS_OPEN';
  return 'READY_FOR_INTERNAL_REVIEW';
}
function prohibitedNumbers(value,path='') {
  if(!value || typeof value!=='object')return;
  for(const [k,v] of Object.entries(value)) {
    if(/(?:score|probability|percentage|award_chance|maturity|rating|tier)/i.test(k) && k!=='official_weight_percent') {
      assert.equal(v,'PROHIBITED','invented assurance value '+path+'.'+k);
    }
    if(typeof v==='string')assert.ok(!/\b\d+(?:\.\d+)?\s*%|\b(?:Bronze|Silver|Gold|Platinum)\b/i.test(v),'invented numeric/tier language');
    prohibitedNumbers(v,path+'.'+k);
  }
}
function validate(doc,cal=calendar) {
  assert.equal(doc.starting_head,start);
  assert.equal(doc.cutoff,'2026-10-20');
  assert.equal(doc.record_version,1);
  assert.equal(doc.supersedes_record_version,null);
  assert.equal(doc.status,'INTERNAL_REFERENCE_ONLY_PUBLICATION_AND_SUBMISSION_PROHIBITED');
  assert.deepEqual(doc.awards.map(r=>r.edition_id),expectedEditions);
  assert.equal(doc.readiness_policy.unknown_required_input,'FAIL_CLOSED');
  assert.deepEqual(doc.eligibility_states,['ELIGIBLE','INELIGIBLE','UNKNOWN','NOT_ASSESSED']);
  assert.deepEqual(doc.readiness_states,['READY_FOR_INTERNAL_REVIEW','GAPS_OPEN','SOURCE_PENDING','ELIGIBILITY_UNKNOWN','EVIDENCE_INSUFFICIENT','NOT_ELIGIBLE','UNKNOWN']);
  unique(doc.sources,'source_id'); unique(doc.awards,'edition_id'); unique(doc.awards,'award_program_id');
  assert.equal(doc.sources.length,Object.keys(sourceUrls).length);
  for(const source of doc.sources) {
    required(source,['published_at','updated_at','retrieved_at','source_status','access_status','edition_ids','fingerprint_limitation']);
    assert.equal(source.url,sourceUrls[source.source_id],'only manually verified organizer locators admitted');
    assert.equal(source.retrieved_at,doc.cutoff);
    assert.equal(source.source_status,'AUTHORITATIVE_SOURCE_VERIFIED');
    assert.equal(source.access_status,'AVAILABLE');
    if(source.source_id==='SRC-ER') {
      assert.equal(source.authority,'FORMALLY_DESIGNATED_BY_ORGANIZER');
      assert.equal(source.designated_by,'SRC-E');
    } else assert.equal(source.authority,'ORGANIZER_CONTROLLED');
  }
  assert.equal(by(doc.sources,'source_id','SRC-CM').edition_ids.length,0,'undated methodology is not 2027 criteria');
  for(const r of doc.awards) {
    assert.ok(!/\b(?:award-winning|award nominated|recognized by|recognised by|certified by|approved by)\b/i.test(JSON.stringify(r)),'unsupported external commercial wording');
    required(r,['organizer','official_program_name','edition_year','edition_status','geographic_scope','category_id','category_name','source_verification','eligibility_rationale','eligibility_gaps','criteria','required_external_evidence','independent_review_requirement','readiness_limitations','source_issues']);
    assert.equal(r.source_verification,'AUTHORITATIVE_SOURCE_VERIFIED');
    for(const source_id of r.source_ids)reference(doc,{source_id,locator:'edition identity'},r.edition_id);
    assert.equal(r.edition_year,r.edition_id==='CYBER-2027'?2027:2026);
    const historical=r.edition_id==='PNI-9-2025-26';
    assert.equal(r.current_candidate,!historical);
    assert.equal(r.edition_status,historical?'HISTORICAL_IDENTITY_VERIFIED':'IDENTITY_VERIFIED');
    if(historical)assert.match(r.edition_label,/2025.*historical/);
    assert.equal(r.application_submission_status,'NOT_SUBMITTED');
    assert.equal(r.eligibility_state,'UNKNOWN','no applicant dossier independently established in S3');
    assert.ok(r.eligibility_rationale && r.eligibility_gaps.length && r.required_external_evidence.length);
    assert.deepEqual(r.eligibility_checks.map(x=>x.dimension).sort(),[...dimensions].sort());
    for(const check of r.eligibility_checks) {
      assert.equal(check.assessment,'UNKNOWN','no verified applicant criterion conclusion');
      assert.ok(check.applicant_fact);
      if(check.source_state==='PUBLISHED') {
        assert.ok(check.published_condition);reference(doc,check.reference,r.edition_id);
      } else {
        assert.equal(check.source_state,'NOT_ESTABLISHED_IN_RETRIEVED_SOURCES');
        assert.equal(check.published_condition,null);assert.equal(check.reference,null);
      }
    }
    assert.equal(r.readiness_state,expectedReadiness(r),'fail-closed readiness');
    assert.equal(r.review_state,'NOT_REVIEWED');assert.equal(r.reviewer,null);
    assert.ok(r.independent_review_requirement && r.readiness_limitations.length);
    assert.equal(r.publication_prohibition_state,'PROHIBITED');assert.equal(r.submission_prohibition_state,'PROHIBITED');
    assert.equal(r.external_award_state,'NOT_ASSERTED');assert.deepEqual(r.external_artifact_ids,[]);
    assert.equal(r.approved_application_wording,null);
    assert.deepEqual(r.affirmative_legacy_inputs,[]);
    for(const id of ['L01','L02','L03','L04','legacy risk scores','heuristic cost estimates','legacy registry claims'])assert.ok(r.excluded_legacy_inputs.includes(id));
    resolve(r.capability_ids,s0.capabilities,'capability_id');
    resolve(r.evidence_ids,index.evidence,'evidence_id');
    resolve(r.gap_ids,gaps.gaps,'gap_id');
    resolve(r.claim_ids,claims.claims,'claim_id');
    unique(r.criteria,'criterion_id');
    assert.deepEqual(r.capability_ids,uniq(r.criteria.flatMap(c=>c.capability_ids)));
    assert.deepEqual(r.evidence_ids,uniq(r.criteria.flatMap(c=>c.evidence_ids)));
    assert.deepEqual(r.claim_ids,r.capability_ids.map(id=>'CL-FACT-'+id));
    for(const c of r.criteria) {
      reference(doc,c.reference,r.edition_id);
      assert.equal(c.reference.locator,c.official_criterion_reference);
      assert.equal(c.label_type,'PARAPHRASE_EXACT_SOURCE_LOCATOR');
      assert.equal(c.satisfaction_state,'NOT_ASSESSED');
      assert.equal(c.correspondence_state,c.capability_ids.length?'BOUNDED_REPOSITORY_CORRESPONDENCE':'NOT_MAPPED');
      resolve(c.capability_ids,s0.capabilities,'capability_id');resolve(c.gap_ids,gaps.gaps,'gap_id');
      assert.deepEqual(c.evidence_ids,uniq(c.capability_ids.flatMap(id=>by(s0.capabilities,'capability_id',id).evidence_ids)));
      assert.ok(c.limitation && c.required_external_evidence.length);
      if(r.edition_id!=='WITSA-AI-2026')assert.equal(c.official_weight_percent,null,'no fabricated organizer weights');
    }
    for(const id of r.evidence_ids) {
      const e=by(index.evidence,'evidence_id',id);
      assert.deepEqual(e.legacy_surface_ids,[],'legacy evidence cannot establish readiness');
      assert.equal(e.customer_deployment_status,'NOT_VERIFIED');
      assert.equal(e.operating_effectiveness_status,'NOT_ESTABLISHED');
    }
    assert.deepEqual(r.claim_trace,r.claim_ids.map(id=>{
      const c=by(claims.claims,'claim_id',id);
      assert.equal(c.eligibility,'INELIGIBLE');
      assert.equal(c.claim_ceiling,'FACTUAL_CAPABILITY_ONLY');
      for(const cap of c.capability_ids)assert.equal(by(claims.capability_ceilings,'capability_id',cap).max_defensible_external_class,'FACTUAL_CAPABILITY');
      return {claim_id:id,eligibility:c.eligibility,claim_ceiling:c.claim_ceiling,use:'TRACEABILITY_ONLY_NOT_APPROVED_WORDING'};
    }));
    assert.equal(r.submission_window_state,cal.submission_window_counts && ({'WITSA-AI-2026':'CLOSED','APDSI-TD-2026-6':'OPEN','EAIF-AI-2026':'UNKNOWN','DMI-EUROPE-2026':'CLOSED','CYBER-2027':'FUTURE','PNI-9-2025-26':'CLOSED'}[r.edition_id]));
  }
  assert.equal(by(doc.awards,'edition_id','CYBER-2027').category_id,null);
  assert.deepEqual(by(doc.awards,'edition_id','CYBER-2027').criteria,[]);
  assert.deepEqual(by(doc.awards,'edition_id','WITSA-AI-2026').criteria.map(c=>c.official_weight_percent),[30,30,20,20]);
  assert.deepEqual(doc.counts,{discovered:12,admitted:6,eligibility:count(doc.awards,'eligibility_state'),readiness:count(doc.awards,'readiness_state'),submission_windows:count(doc.awards,'submission_window_state')});
  assert.equal(doc.discovery_leads.length,12);
  assert.equal(doc.discovery_leads.filter(d=>d.disposition==='ADMITTED').length,6);
  assert.equal(doc.search_strategy.areas.length,13);
  assert.ok(doc.search_strategy.queries.length>=10);
  prohibitedNumbers(doc);
}
function validateCalendar(cal,doc=matrix) {
  assert.equal(cal.starting_head,start);assert.equal(cal.cutoff,doc.cutoff);
  assert.equal(cal.record_version,doc.record_version);assert.equal(cal.matrix_record_version,doc.record_version);
  assert.equal(cal.matrix_path,root+'award-readiness-matrix-v0.json');
  unique(cal.events,'event_id');
  assert.equal(cal.events.length,25);
  for(const e of cal.events) {
    const r=by(doc.awards,'edition_id',e.edition_id);assert.ok(r);
    assert.equal(e.award_program_id,r.award_program_id);
    reference(doc,e.source_locator,e.edition_id);
    required(e,['opens_at','closes_at','timezone','date_precision','retrieved_at','status','source_reliability','status_basis','historical','source_assertions']);
    assert.equal(e.retrieved_at,doc.cutoff);assert.equal(e.timezone,'UNKNOWN');
    assert.ok(['OPEN','FUTURE','CLOSED','UNKNOWN'].includes(e.status));
    assert.ok(e.status_basis);
    assert.equal(e.historical,e.status==='CLOSED');
    for(const date of [e.opens_at,e.closes_at].filter(Boolean)) {
      assert.ok(/^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2})$/.test(date),'preserve date precision, no invented time');
      assert.equal(date.length===10?'DAY':'MONTH',e.date_precision);
    }
    if(e.source_reliability==='CONFLICTING') {
      assert.equal(e.opens_at,null);assert.equal(e.closes_at,null);assert.ok(e.source_assertions.length);
      assert.ok(['UNKNOWN','CLOSED'].includes(e.status));
    }
    if(e.status==='OPEN')assert.ok(e.opens_at<doc.cutoff && e.closes_at>doc.cutoff);
    if(e.status==='FUTURE')assert.ok(e.opens_at>doc.cutoff);
    if(e.opens_at && e.closes_at)assert.ok(e.opens_at<=e.closes_at);
    for(const a of e.source_assertions) {
      reference(doc,a.reference,e.edition_id);assert.ok(a.timezone && a.date_precision && a.role);
      if(a.published_closes_at?.includes('T'))assert.equal(a.timezone,'Brasília (as published)');
    }
  }
  const event=id=>by(cal.events,'event_id',id);
  assert.equal(event('WITSA-AI-2026-GLOBAL').closes_at,'2026-07-10');
  assert.equal(event('WITSA-AI-2026-LOCAL-DEADLINE').closes_at,null);
  assert.deepEqual([event('APDSI-TD-2026-6-APPLICATION').opens_at,event('APDSI-TD-2026-6-APPLICATION').closes_at],['2026-09-14','2026-12-18']);
  assert.deepEqual(event('EAIF-AI-2026-APPLICATION').source_assertions.map(a=>[a.published_opens_at,a.published_closes_at]),[['2026-10-05','2026-10-31'],['2026-07-01','2026-10-15']]);
  assert.deepEqual(['JUDGING','FINALISTS','CEREMONY'].map(id=>event('APDSI-TD-2026-6-'+id).source_assertions[0].published_closes_at),['2026-01-20','2026-01-27','2026-02-18']);
  assert.deepEqual([event('CYBER-2027-APPLICATION').opens_at,event('CYBER-2027-APPLICATION').closes_at],['2026-12-01','2027-02-28']);
  assert.deepEqual(event('PNI-9-2025-26-APPLICATION').source_assertions.map(a=>[a.published_closes_at,a.timezone]),[['2025-11-21T23:59','Brasília (as published)'],['2025-12-05','UNKNOWN']]);
  assert.equal(event('PNI-9-2025-26-FINALISTS').published_period,'Second week of March 2026');
  assert.deepEqual(cal.counts_by_status,count(cal.events,'status'));
  assert.deepEqual(cal.submission_window_counts,doc.counts.submission_windows);
  prohibitedNumbers(cal);
}

test('S3: verified organizer/edition/eligibility and categorical fail-closed matrix',()=>validate(matrix));
test('S3: exact dates, explicit precision/timezone, source conflicts and historical stages',()=>validateCalendar(calendar));
test('S3: S0/S1/S2 input hashes and Git bytes unchanged; original evidence/ceilings pinned',()=>{
  assert.equal(matrix.input_artifacts.length,7);
  for(const input of matrix.input_artifacts) {
    assert.equal(input.commit,start);
    const original=execFileSync('git',['show',start+':'+input.path],{encoding:'utf8',maxBuffer:4*1024*1024});
    assert.equal(hash(original),input.sha256_lf_utf8);
    assert.equal(hash(readFileSync(input.path,'utf8')),input.sha256_lf_utf8);
  }
  assert.equal(claims.claims.length,42);
  assert.ok(claims.claims.every(c=>c.eligibility==='INELIGIBLE'));
});
test('S3: complete JSON/Markdown deterministic parity',()=>{
  assert.equal(lf(readFileSync(root+'award-readiness-matrix-v0.md','utf8')),renderMatrix(matrix));
  assert.equal(lf(readFileSync(root+'award-calendar-v0.md','utf8')),renderCalendar(calendar));
  for(const text of [renderMatrix(matrix),renderCalendar(calendar)])assert.ok(!/[\t ]+$/m.test(text),'renderer whitespace');
});
test('S3 adversarial: unknown eligibility/readiness, criteria satisfaction and draft promotion rejected',()=>{
  for(const mutate of [d=>d.awards[0].eligibility_state='ELIGIBLE',d=>d.awards[0].readiness_state='READY_FOR_INTERNAL_REVIEW',d=>d.awards[0].eligibility_checks[0].assessment='SATISFIED',d=>d.awards[0].criteria[0].satisfaction_state='SUFFICIENT_REVIEWED',d=>d.awards[0].claim_trace[0].eligibility='ELIGIBLE',d=>d.awards[0].claim_trace[0].claim_ceiling='READINESS',d=>d.awards[0].approved_application_wording='award-winning GovIA',d=>d.awards[0].publication_prohibition_state='ALLOWED']) {
    const d=clone();mutate(d);assert.throws(()=>validate(d));
  }
});
test('S3 adversarial: fake IDs, source authority, recurrence and edition leakage rejected',()=>{
  for(const mutate of [d=>d.awards[0].capability_ids.push('FAKE'),d=>d.awards[0].evidence_ids.push('FAKE'),d=>d.awards[0].gap_ids.push('FAKE'),d=>d.awards[0].claim_ids.push('FAKE'),d=>d.sources[0].url='https://award-aggregator.invalid/',d=>d.sources[0].source_status='NON_AUTHORITATIVE_SOURCE',d=>d.sources[0].edition_ids=['WITSA-AI-2025'],d=>d.awards[5].current_candidate=true,d=>d.awards[4].criteria.push(structuredClone(d.awards[0].criteria[0]))]) {
    const d=clone();mutate(d);assert.throws(()=>validate(d));
  }
});
test('S3 adversarial: legacy inputs, scores/probabilities and unsupported external status rejected',()=>{
  for(const mutate of [d=>d.awards[0].affirmative_legacy_inputs=['L01'],d=>d.awards[0].affirmative_legacy_inputs=['legacy risk scores'],d=>d.awards[0].readiness_score=90,d=>d.awards[0].award_probability=0.9,d=>d.awards[0].external_award_state='NOMINATED',d=>d.awards[0].external_award_state='FINALIST',d=>d.awards[0].external_award_state='WINNER',d=>d.awards[0].external_artifact_ids=['self-issued'],d=>d.awards[0].criteria[0].official_weight_percent=99]) {
    const d=clone();mutate(d);assert.throws(()=>validate(d));
  }
});
test('S3 adversarial: fabricated exact time, missing timezone/source and repaired conflicts rejected',()=>{
  for(const mutate of [d=>d.events[0].closes_at='2026-07-10T23:59',d=>delete d.events[0].timezone,d=>d.events[0].source_locator.source_id='FAKE',d=>d.events.find(e=>e.event_id==='EAIF-AI-2026-APPLICATION').closes_at='2026-10-31',d=>d.events.find(e=>e.event_id==='APDSI-TD-2026-6-CEREMONY').source_assertions[0].published_closes_at='2027-02-18']) {
    const d=structuredClone(calendar);mutate(d);assert.throws(()=>validateCalendar(d));
  }
});
