// S2 documentation guard only. No service, network, database or product execution.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = 'docs/trust-assurance/';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const s0 = json('docs/codex/evidence/2026-10-20-m17.5-s0-trust-assurance-inventory.json');
const crosswalk = json(root + 'framework-crosswalk-v0.json');
const catalog = json(root + 'framework-source-catalog-v0.json');
const index = json(root + 'evidence-index-v0.json');
const gaps = json(root + 'gap-register-v0.json');
const register = json(root + 'commercial-claims-register-v0.json');
const start = '38314b7ea20e479f4d108ea1b48fd37c78d37ebf';
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const lf = s => s.replace(/\r\n/g, '\n');
const by = (xs, key, id) => xs.find(x => x[key] === id);
const count = (xs, key) => Object.fromEntries([...new Set(xs.map(x => x[key]))].sort().map(k => [k, xs.filter(x => x[key] === k).length]));
const unique = (xs, key) => assert.equal(new Set(xs.map(x => x[key])).size, xs.length, key);
const resolve = (ids, xs, key) => { for (const id of ids) assert.ok(by(xs, key, id), `unresolved ${key}: ${id}`); };
const required = (x, keys) => { for (const k of keys) assert.ok(Object.hasOwn(x, k), `missing ${k}`); };
const cap = id => by(s0.capabilities, 'capability_id', id);
const ceiling = id => by(register.capability_ceilings, 'capability_id', id);
const evidenceFor = ids => [...new Set(ids.flatMap(id => cap(id).evidence_ids))];
const inputIds = new Set([
  ...s0.capabilities.map(x => x.capability_id), ...index.evidence.map(x => x.evidence_id),
  ...s0.legacy_surfaces.map(x => x.surface_id), ...s0.verification.map(x => x.verification_id),
  ...catalog.framework_versions.map(x => x.framework_version_id), ...catalog.requirements.map(x => x.requirement_id),
  ...catalog.framework_versions.flatMap(x => x.source_access_records.map(a => a.access_id)),
  ...crosswalk.capability_dispositions.map(x => x.mapping_id),
]);

function validateGaps(doc) {
  unique(doc.gaps, 'gap_id');
  assert.equal(doc.gaps.length, 61);
  assert.deepEqual(doc.additional_gap_kinds, []);
  assert.deepEqual(doc.gap_kind_vocabulary, ['SOURCE_PENDING','MAPPING_MISSING','APPLICABILITY_UNKNOWN','EVIDENCE_MISSING','EVIDENCE_STALE','EVIDENCE_INSUFFICIENT','CONFLICT','EXTERNAL_BASIS_MISSING']);
  for (const g of doc.gaps) {
    required(g, ['gap_id','gap_kind','title','scope','source_input_ids','framework_version_id','requirement_id','capability_ids','evidence_ids','current_state','why_it_is_a_gap','required_closure_evidence','review_approval_requirement','dependency_ids','presentation_impact','claim_impact','owner_role','status','recorded_at','limitations']);
    assert.ok(doc.gap_kind_vocabulary.includes(g.gap_kind));
    assert.equal(g.status, 'OPEN');
    assert.equal(g.recorded_at, '2026-10-20');
    assert.ok(g.why_it_is_a_gap && g.required_closure_evidence.length && g.review_approval_requirement);
    assert.ok(g.source_input_ids.length);
    for (const id of g.source_input_ids) assert.ok(inputIds.has(id), `unresolved source/input: ${id}`);
    resolve(g.capability_ids, s0.capabilities, 'capability_id');
    resolve(g.evidence_ids, index.evidence, 'evidence_id');
    resolve(g.dependency_ids, doc.gaps, 'gap_id');
    if (g.framework_version_id) resolve([g.framework_version_id], catalog.framework_versions, 'framework_version_id');
    if (g.requirement_id) assert.equal(by(catalog.requirements, 'requirement_id', g.requirement_id)?.framework_version_id, g.framework_version_id);
  }
  const visit = (id, path = []) => {
    assert.ok(!path.includes(id), 'gap dependency cycle');
    for (const next of by(doc.gaps, 'gap_id', id).dependency_ids) visit(next, [...path, id]);
  };
  doc.gaps.forEach(g => visit(g.gap_id));
  for (const key of ['gap_kind','status','current_state']) assert.deepEqual(doc['counts_by_' + ({ gap_kind:'kind', status:'status', current_state:'current_state' }[key])], count(doc.gaps, key));
  for (const v of catalog.framework_versions.filter(v => v.requirement_population_status === 'EXTERNAL_REQUIREMENT_SOURCE_PENDING')) {
    const g = doc.gaps.find(g => g.framework_version_id === v.framework_version_id && g.gap_kind === 'SOURCE_PENDING');
    assert.ok(g);
    assert.equal(g.requirement_id, null);
  }
  for (const d of crosswalk.capability_dispositions.filter(d => d.mapping_state !== 'MAPPED')) assert.ok(doc.gaps.some(g => g.source_input_ids.includes(d.mapping_id) && g.current_state === d.mapping_state));
  for (const r of crosswalk.public_reference_gaps) assert.ok(doc.gaps.some(g => g.requirement_id === r.requirement_id && g.current_state === r.mapping_state));
  for (const id of ['G-EU-OPERATIVE','G-APPLICABILITY','G-SUFFICIENCY','G-REVIEWER','G-EXECUTION','G-CI','G-DEPLOYMENT','G-OPERATING','G-CERTIFICATION','G-ATTESTATION','G-FRESHNESS','G-REACHABILITY-L04']) assert.ok(by(doc.gaps, 'gap_id', id));
  for (const id of ['L01','L02','L03','L04']) assert.equal(by(doc.gaps, 'gap_id', 'G-LEGACY-' + id)?.current_state, by(s0.legacy_surfaces, 'surface_id', id).classification);
  assert.equal(doc.gaps.filter(g => g.gap_kind === 'EVIDENCE_STALE').length, 0, 'unknown policy must not fabricate staleness');
}

// This is an executable documentary predicate, not a product publication API.
// Factual scope does not require a positive framework axis. Every prerequisite
// actually used by the proposed assertion still fails closed on UNKNOWN.
function publicationBlockers(c) {
  const reasons = [];
  const block = (condition, reason) => { if (condition) reasons.push(reason); };
  block(!register.claim_classes.includes(c.claim_class), 'closed claim class');
  block(/\b(?:compliant|complies with|guarantees?|fully governed)\b|\d+(?:\.\d+)?\s*%/i.test(c.exact_proposed_wording), 'prohibited legal/absolute/percentage wording');
  block(c.review_approval_state !== 'APPROVED' || !c.reviewer, 'independent exact-wording approval');
  block(c.evidence_currency !== 'CURRENT', 'current evidence');
  block(c.presentation_review_state !== 'APPROVED' || c.presentation_exposure_state !== 'REVIEWED_BOUNDED', 'reviewed exposure boundary');
  for (const id of c.capability_ids) {
    const ce = ceiling(id);
    block(!ce, 'capability ceiling missing');
    if (c.claim_class === 'FACTUAL_CAPABILITY') block(ce?.max_defensible_external_class !== 'FACTUAL_CAPABILITY', 'no affirmative factual ceiling');
  }
  const inferred = c.evidence_ids.flatMap(id => by(index.evidence, 'evidence_id', id)?.legacy_surface_ids ?? []);
  for (const id of new Set([...c.presentation_surface_ids, ...inferred])) {
    block(['L01','L02','L04'].includes(id), 'unresolved NEEDS_CONTAINMENT ' + id);
    block(id === 'L03', 'unresolved L03 wording/exclusion gate');
  }
  if (c.claim_class === 'FACTUAL_CAPABILITY') {
    block(c.claim_ceiling !== 'FACTUAL_CAPABILITY_ONLY', 'factual ceiling exceeded');
    block(c.evidence_state !== 'EVIDENCE_AVAILABLE', 'available factual evidence');
  }
  if (['EVIDENCE_BACKED_ALIGNMENT','READINESS_STATEMENT'].includes(c.claim_class)) {
    block(c.applicability_state !== 'APPLICABLE', 'applicability');
    block(c.mapping_state !== 'MAPPED', 'mapping');
    block(c.evidence_state !== 'EVIDENCE_AVAILABLE' || c.evidence_sufficiency !== 'SUFFICIENT_REVIEWED', 'reviewed sufficient evidence');
    block(!c.requirement_ids.length || !c.framework_version_ids.length, 'exact reference required');
    for (const id of c.framework_version_ids) {
      const v = by(catalog.framework_versions, 'framework_version_id', id);
      block(!v || v.requirement_population_status === 'EXTERNAL_REQUIREMENT_SOURCE_PENDING', 'pending requirement source');
    }
    for (const id of c.requirement_ids) {
      const r = by(catalog.requirements, 'requirement_id', id);
      block(!r || r.source_verification_state !== 'AUTHORITATIVE_SOURCE_VERIFIED', 'verified source reference');
      block(!crosswalk.capability_dispositions.some(d => c.capability_ids.includes(d.capability_id) && d.mapping_state === 'MAPPED' && d.requirement_id === id), 'exact mapped capability');
    }
    // All S1 correspondences are author drafts; they cannot be upgraded in S2.
    block(true, 'no independently reviewed S1 mapping; S2 alignment is candidate only');
    if (c.claim_class === 'READINESS_STATEMENT') {
      block(c.readiness_state !== 'READY', 'internal READY absent');
      block(c.gap_ids.some(id => by(gaps.gaps, 'gap_id', id)?.status !== 'CLOSED'), 'unresolved scope gap');
    }
  }
  if (['EXTERNAL_CERTIFICATION','EXTERNAL_ATTESTATION'].includes(c.claim_class)) {
    block(!c.external_artifact_ids.length, 'external artifact absent');
    const kind = c.claim_class === 'EXTERNAL_CERTIFICATION' ? 'CERTIFICATION' : 'ATTESTATION';
    for (const id of c.external_artifact_ids) {
      const a = by(register.publication_policy.external_artifact_registry, 'artifact_id', id);
      block(!a || a.kind !== kind || a.verification !== 'VERIFIED_CURRENT', 'verified matching external artifact');
    }
    block(c.external_certification_attestation_state !== (kind === 'CERTIFICATION' ? 'CERTIFIED' : 'ATTESTED'), 'external state');
  }
  return reasons;
}

function validateClaims(doc) {
  unique(doc.claims, 'claim_id');
  assert.equal(doc.claims.length, 42);
  assert.deepEqual(doc.publication_policy.external_artifact_registry, []);
  assert.equal(doc.publication_policy.broad_legal_compliance_path, 'NONE_IN_V0');
  for (const c of doc.claims) {
    required(c, ['claim_id','exact_proposed_wording','claim_class','target_audience','product_scope','capability_ids','evidence_ids','framework_version_ids','requirement_ids','applicability_state','mapping_state','evidence_state','readiness_state','external_certification_attestation_state','eligibility','eligibility_reason','claim_ceiling','reviewer_requirement','validity','limitations']);
    assert.ok(doc.claim_classes.includes(c.claim_class));
    assert.ok(c.exact_proposed_wording && c.eligibility_reason && c.reviewer_requirement);
    resolve(c.capability_ids, s0.capabilities, 'capability_id');
    resolve(c.evidence_ids, index.evidence, 'evidence_id');
    assert.deepEqual(c.evidence_ids, evidenceFor(c.capability_ids));
    resolve(c.mapping_ids, crosswalk.capability_dispositions, 'mapping_id');
    assert.deepEqual(c.mapping_ids, crosswalk.capability_dispositions.filter(d => c.capability_ids.includes(d.capability_id)).map(d => d.mapping_id));
    resolve(c.framework_version_ids, catalog.framework_versions, 'framework_version_id');
    resolve(c.requirement_ids, catalog.requirements, 'requirement_id');
    for (const id of c.requirement_ids) assert.ok(c.framework_version_ids.includes(by(catalog.requirements, 'requirement_id', id).framework_version_id));
    resolve(c.gap_ids, gaps.gaps, 'gap_id');
    assert.equal(c.capability_version, crosswalk.inventory_version);
    assert.equal(c.evidence_source_commit, s0.source_commit);
    assert.equal(c.applicability_state, 'UNKNOWN');
    assert.equal(c.evidence_sufficiency, 'NOT_ASSESSED');
    assert.equal(c.readiness_state, 'UNKNOWN');
    assert.equal(c.external_certification_attestation_state, 'NOT_ASSERTED');
    assert.equal(c.eligibility, 'INELIGIBLE');
    assert.ok(publicationBlockers(c).length, 'claim improperly became publishable');
    assert.equal(c.validity.cutoff, doc.cutoff);
    assert.equal(c.validity.publication_validity, 'NOT_GRANTED');
    assert.equal(c.validity.valid_until, null, 'no fabricated validity period');
    assert.equal(c.presentation_exposure_state, 'UNKNOWN');
    assert.deepEqual(c.presentation_exclusion_ids, ['L01','L02','L03','L04']);
    if (c.claim_class === 'FACTUAL_CAPABILITY') {
      assert.equal(c.capability_ids.length, 1);
      const original = cap(c.capability_ids[0]);
      assert.ok(['PROVEN','PARTIALLY_PROVEN'].includes(original.proof_status));
      assert.ok(c.exact_proposed_wording.includes(original.proven_assertion));
      assert.ok(c.exact_proposed_wording.includes(original.limitations));
      assert.ok(c.exact_proposed_wording.includes(s0.source_commit));
      assert.ok(c.exact_proposed_wording.includes('No customer deployment proof, operating-effectiveness conclusion or certification conclusion'));
      assert.equal(c.claim_ceiling, ceiling(original.capability_id).current_claim_ceiling);
      for (const id of original.current_verification_ids) assert.ok(c.exact_proposed_wording.includes(id));
    } else {
      assert.ok(['EVIDENCE_BACKED_ALIGNMENT_CANDIDATE','REJECTED_PROPOSAL'].includes(c.record_disposition));
    }
    if (c.claim_class === 'EVIDENCE_BACKED_ALIGNMENT') {
      assert.equal(c.claim_ceiling, 'EVIDENCE_BACKED_ALIGNMENT_CANDIDATE');
      const d = by(crosswalk.capability_dispositions, 'mapping_id', c.mapping_ids[0]);
      assert.equal(d.mapping_state, 'MAPPED');
      assert.deepEqual(c.requirement_ids, [d.requirement_id]);
      assert.deepEqual(c.framework_version_ids, [d.framework_version_id]);
    }
    if (['EXTERNAL_CERTIFICATION','EXTERNAL_ATTESTATION'].includes(c.claim_class)) {
      assert.equal(c.evidence_state, 'NOT_EVIDENCED');
      assert.deepEqual(c.external_artifact_ids, []);
    }
  }
  for (const [key, field] of [['class','claim_class'],['eligibility','eligibility']]) assert.deepEqual(doc['counts_by_' + key], count(doc.claims, field));
  assert.deepEqual(count(doc.claims,'claim_class'), { EVIDENCE_BACKED_ALIGNMENT:5, EXTERNAL_ATTESTATION:1, EXTERNAL_CERTIFICATION:1, FACTUAL_CAPABILITY:34, READINESS_STATEMENT:1 });
}

test('S2 gap IDs, exact S0/S1 inputs, closure criteria, source coverage and dependency DAG', () => validateGaps(gaps));
test('S2 claims resolve complete capability/evidence/reference traces and remain within publication gates', () => validateClaims(register));
test('all 38 ceilings retain separate proof, execution, CI, deployment, effectiveness and legacy axes', () => {
  unique(register.capability_ceilings, 'capability_id');
  assert.deepEqual(register.capability_ceilings.map(c => c.capability_id), s0.capabilities.map(c => c.capability_id));
  for (const ce of register.capability_ceilings) {
    const c = cap(ce.capability_id);
    const d = by(crosswalk.capability_dispositions, 'capability_id', c.capability_id);
    assert.equal(ce.implementation_proof, c.proof_status);
    assert.equal(ce.implementation_assertion, c.proven_assertion);
    assert.deepEqual(ce.executed_verification_ids, c.current_verification_ids);
    assert.deepEqual(ce.evidence_ids, c.evidence_ids);
    assert.equal(ce.mapping_state, d.mapping_state);
    assert.equal(ce.independent_ci, 'NOT_VERIFIED');
    assert.equal(ce.deployed_evidence, 'NOT_VERIFIED');
    assert.equal(ce.operating_effectiveness, 'NOT_ESTABLISHED');
    assert.equal(ce.applicability, 'UNKNOWN');
    assert.equal(ce.sufficiency_review, 'NOT_ASSESSED');
    assert.equal(ce.evidence_currency, 'UNKNOWN');
    assert.equal(ce.external_certification_attestation, 'NOT_ASSERTED');
    assert.equal(ce.external_publication_state, 'INELIGIBLE');
    const factual = ['PROVEN','PARTIALLY_PROVEN'].includes(c.proof_status);
    assert.equal(ce.max_defensible_external_class, factual ? 'FACTUAL_CAPABILITY' : null);
    assert.equal(ce.current_claim_ceiling, factual ? 'FACTUAL_CAPABILITY_ONLY' : 'NO_AFFIRMATIVE_CLAIM');
    assert.equal(ce.draft_alignment_ceiling, d.mapping_state === 'MAPPED' ? 'EVIDENCE_BACKED_ALIGNMENT_CANDIDATE' : null);
    assert.deepEqual(ce.legacy_surface_ids, s0.legacy_surfaces.filter(l => l.evidence_ids.some(e => c.evidence_ids.includes(e))).map(l => l.surface_id));
    resolve(ce.gap_ids, gaps.gaps, 'gap_id');
    assert.ok(ce.limitations.includes(c.limitations));
  }
  assert.deepEqual(register.counts_by_ceiling, { FACTUAL_CAPABILITY_ONLY:34, NO_AFFIRMATIVE_CLAIM:4 });
});
test('adversarial unknown/source-pending/legacy/legal/external-artifact inputs fail closed', () => {
  // A hypothetical reviewed factual record demonstrates the gate is not merely
  // hard-coded false. This fixture is not written back or approved by this check.
  const f = structuredClone(register.claims.find(c => c.claim_id === 'CL-FACT-TA-C07'));
  Object.assign(f, { review_approval_state:'APPROVED', reviewer:'TEST_FIXTURE_ONLY', evidence_currency:'CURRENT', presentation_review_state:'APPROVED', presentation_exposure_state:'REVIEWED_BOUNDED' });
  assert.deepEqual(publicationBlockers(f), []);
  for (const [key, value] of [['evidence_currency','UNKNOWN'],['evidence_state','UNKNOWN'],['presentation_exposure_state','UNKNOWN'],['review_approval_state','NOT_REVIEWED'],['claim_ceiling','EVIDENCE_BACKED_ALIGNMENT_CANDIDATE']]) {
    assert.ok(publicationBlockers({ ...f, [key]:value }).length, key);
  }
  for (const id of ['L01','L02','L03','L04']) assert.ok(publicationBlockers({ ...f, presentation_surface_ids:[id] }).some(r => r.includes(id)));
  for (const id of ['E095','E089','E091','E104']) assert.ok(publicationBlockers({ ...f, evidence_ids:[id] }).some(r => /unresolved/.test(r)), 'inferred legacy reliance');
  assert.ok(publicationBlockers({ ...f, capability_ids:['TA-C37'] }).includes('no affirmative factual ceiling'));
  for (const wording of ['GovIA is EU AI Act compliant','GovIA guarantees governance','GovIA provides 100% governance']) assert.ok(publicationBlockers({ ...f, exact_proposed_wording:wording }).includes('prohibited legal/absolute/percentage wording'));
  for (const cls of ['EVIDENCE_BACKED_ALIGNMENT','READINESS_STATEMENT']) {
    for (const v of catalog.framework_versions.filter(v => v.requirement_population_status === 'EXTERNAL_REQUIREMENT_SOURCE_PENDING')) {
      const bad = { ...f, claim_class:cls, applicability_state:'APPLICABLE', mapping_state:'MAPPED', evidence_sufficiency:'SUFFICIENT_REVIEWED', readiness_state:'READY', framework_version_ids:[v.framework_version_id], requirement_ids:[] };
      assert.ok(publicationBlockers(bad).includes('pending requirement source'));
    }
    const unknown = { ...f, claim_class:cls, applicability_state:'UNKNOWN', mapping_state:'UNKNOWN', evidence_sufficiency:'NOT_ASSESSED' };
    for (const reason of ['applicability','mapping','reviewed sufficient evidence']) assert.ok(publicationBlockers(unknown).includes(reason));
  }
  for (const cls of ['EXTERNAL_CERTIFICATION','EXTERNAL_ATTESTATION']) {
    assert.ok(publicationBlockers({ ...f, claim_class:cls }).includes('external artifact absent'));
    assert.ok(publicationBlockers({ ...f, claim_class:cls, external_artifact_ids:['E089'] }).includes('verified matching external artifact'));
  }
  for (const [doc, mutate, validate] of [
    [gaps, x => x.gaps[0].source_input_ids.push('invented'), validateGaps],
    [gaps, x => x.gaps[0].dependency_ids.push(x.gaps[0].gap_id), validateGaps],
    [register, x => x.claims[0].evidence_ids = ['invented'], validateClaims],
    [register, x => x.claims[0].eligibility = 'ELIGIBLE', validateClaims],
  ]) { const bad = structuredClone(doc); mutate(bad); assert.throws(() => validate(bad)); }
});
test('human-readable register fields match machine records; no numeric assurance score or tier is introduced', () => {
  const val = v => v === null ? 'Not established / not applicable to this record' : Array.isArray(v) ? (v.length ? v.map(x => typeof x === 'object' ? JSON.stringify(x) : x).join('; ') : 'None') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  for (const [name, doc, arrays] of [
    ['gap-register-v0', gaps, ['gaps']],
    ['commercial-claims-register-v0', register, ['capability_ceilings','claims']],
  ]) {
    const md = readFileSync(root + name + '.md', 'utf8');
    const fields = r => Object.entries(r).map(([k,v]) => `- **${k}**: ${val(v)}`).join('\n');
    assert.ok(md.includes(fields(Object.fromEntries(Object.entries(doc).filter(([k]) => !arrays.includes(k))))));
    for (const key of arrays) for (const record of doc[key]) assert.ok(md.includes(fields(record)), `markdown diverged: ${record.gap_id ?? record.claim_id ?? record.capability_id}`);
    assert.doesNotMatch(md, /\b\d+(?:\.\d+)?\s*%|\b(?:bronze|silver|gold|platinum)\b/i);
    const visit = x => { if (!x || typeof x !== 'object') return; for (const [key,value] of Object.entries(x)) { assert.doesNotMatch(key, /(?:compliance_percentage|weighted_readiness_score|maturity_score|certification_probability|aggregate_compliance_state)/i); visit(value); } };
    visit(doc);
  }
});
test('all inherited S0/S1 input artifacts remain byte-equivalent at exact pinned commits', () => {
  for (const doc of [gaps, register]) {
    assert.equal(doc.starting_head, start);
    assert.equal(doc.source_commit, s0.source_commit);
    for (const pin of doc.input_artifacts) assert.equal(lf(readFileSync(pin.path,'utf8')), lf(git(['show', pin.commit + ':' + pin.path])), pin.path);
  }
});
