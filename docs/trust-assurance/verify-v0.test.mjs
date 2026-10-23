// Documentation integrity only: no network, services, database or runtime execution.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = 'docs/trust-assurance/';
const start = 'c3fcf7228530aa5f165361d78ad76cf5f612feb0';
const inventoryPath = 'docs/codex/evidence/2026-10-20-m17.5-s0-trust-assurance-inventory.json';
const s0 = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const read = name => JSON.parse(readFileSync(root + name + '.json', 'utf8'));
const catalog = read('framework-source-catalog-v0');
const crosswalk = read('framework-crosswalk-v0');
const index = read('evidence-index-v0');
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const hash = text => createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
const unique = (items, key) => assert.equal(new Set(items.map(x => x[key])).size, items.length, key);


// These are closed historical snapshots, independent of later authorized slices.
const historicalStart = 'c3fcf7228530aa5f165361d78ad76cf5f612feb0';
const historicalClose = '38314b7ea20e479f4d108ea1b48fd37c78d37ebf';
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
    assert.equal(p.locator, 'https://github.com/cnegrao/code-guard-governance/blob/' + commit + '/' + p.path + '#L' + p.line);
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

function validateSources(c) {
  unique(c.framework_versions, 'framework_version_id');
  unique(c.requirements, 'requirement_id');
  assert.equal(c.framework_versions.length, 7);
  assert.equal(c.requirements.length, 9);
  const required = ['framework_id','framework_name','publisher','framework_version_id','edition_version','publication_date',
    'source_status','revision_status','authoritative_source_locator','source_access','licensing_class','retrieved_at',
    'verification_status','content_embedding_permission','requirement_population_status','notes'];
  const publishers = {
    'NIST-AI-RMF':['nvlpubs.nist.gov','www.nist.gov'], 'EU-AI-ACT':['eur-lex.europa.eu'],
    'ISO-IEC-42001':['www.iso.org'], 'ISO-IEC-38505-1':['www.iso.org'], 'ISO-IEC-23894':['www.iso.org'],
    DCAM:['edmcouncil.org'], 'DAMA-DMBOK':['dama.org']
  };
  for (const v of c.framework_versions) {
    for (const k of required) assert.ok(Object.hasOwn(v,k), k);
    assert.ok(c.verification_states.includes(v.verification_status));
    assert.equal(v.verification_status, 'AUTHORITATIVE_SOURCE_VERIFIED');
    assert.ok(c.access_classes.includes(v.source_access));
    assert.ok(publishers[v.framework_id].includes(new URL(v.authoritative_source_locator).hostname));
    for (const a of v.source_access_records) {
      for (const k of ['publisher','framework_name','framework_version_id','edition_version','publication_date','source_status','source_locator','retrieved_at','licensing_class','source_access','authoritative_source_status','retrieval_mode']) assert.ok(Object.hasOwn(a,k),k);
      assert.equal(a.framework_version_id,v.framework_version_id);
      assert.ok(publishers[v.framework_id].includes(new URL(a.source_locator).hostname));
    }
    const refs = c.requirements.filter(r=>r.framework_version_id===v.framework_version_id);
    if (!['NIST-AI-RMF','EU-AI-ACT'].includes(v.framework_id)) {
      assert.equal(v.requirement_population_status,'EXTERNAL_REQUIREMENT_SOURCE_PENDING');
      assert.equal(refs.length,0, 'licensed/restricted requirement admitted');
    }
  }
  assert.equal(c.framework_versions.find(v=>v.framework_id==='NIST-AI-RMF').revision_status,'REVISION_IN_PROGRESS');
  assert.equal(c.framework_versions.find(v=>v.framework_id==='ISO-IEC-38505-1').framework_version_id,'ISO-IEC-38505-1-2026-ED2');
  for (const r of c.requirements) {
    const v=c.framework_versions.find(v=>v.framework_version_id===r.framework_version_id);
    assert.ok(v,'dangling FrameworkVersion');
    assert.equal(v.verification_status,'AUTHORITATIVE_SOURCE_VERIFIED');
    assert.equal(v.requirement_population_status,'BOUNDED_PUBLIC_REFERENCES_POPULATED');
    assert.equal(r.source_verification_state,'AUTHORITATIVE_SOURCE_VERIFIED');
    const access=v.source_access_records.find(a=>a.access_id===r.source_access_id);
    assert.ok(access && access.retrieval_mode!=='LIVE_ACCESS_BLOCKED','unverified requirement access');
    assert.equal(r.normative_text,null);
    assert.ok(r.publisher_identifier && r.section_locator && r.source_locator);
  }
}
function validateMappings(c, w, i) {
  unique(w.capability_dispositions,'capability_id');
  assert.equal(w.capability_dispositions.length,38);
  const counts = { MAPPED:0, NOT_MAPPED:0, UNKNOWN:0 };
  for (const d of w.capability_dispositions) {
    const cap=s0.capabilities.find(c=>c.capability_id===d.capability_id);
    assert.ok(cap,'unknown capability');
    assert.ok(Object.hasOwn(counts,d.mapping_state),'open mapping state');
    counts[d.mapping_state]++;
    assert.equal(d.capability_version,start);
    assert.equal(d.capability_source_commit,s0.source_commit);
    assert.deepEqual(d.evidence_ids,cap.evidence_ids);
    for (const id of d.evidence_ids) assert.ok(i.evidence.some(e=>e.evidence_id===id),'unknown evidence');
    if (d.mapping_state==='MAPPED') {
      const r=c.requirements.find(r=>r.requirement_id===d.requirement_id);
      assert.ok(r,'MAPPED needs a requirement, not a framework name');
      assert.equal(r.framework_version_id,d.framework_version_id);
      assert.equal(r.source_verification_state,'AUTHORITATIVE_SOURCE_VERIFIED');
      assert.equal(r.mapping_eligibility,'ELIGIBLE_FOR_BOUNDED_REPOSITORY_CORRESPONDENCE');
      assert.ok(d.rationale && d.limitation && d.evidence_ids.length);
    }
    assert.equal(d.external_certification_attestation,'NOT_ASSERTED');
    assert.equal(d.commercial_claim_eligibility,'INELIGIBLE');
    assert.equal(d.applicability,'UNKNOWN');
    assert.equal(d.internal_readiness,'UNKNOWN');
    assert.equal(d.evidence_sufficiency,'NOT_ASSESSED');
  }
  assert.deepEqual(w.counts,counts);
  assert.deepEqual(counts,{MAPPED:5,NOT_MAPPED:6,UNKNOWN:27});
  assert.equal(w.pending_framework_gates.length,5);
  for (const gate of w.pending_framework_gates) {
    assert.equal(gate.mapping_state,'UNKNOWN');
    assert.equal(gate.requirement_id,null);
    assert.deepEqual(gate.capability_ids,s0.capabilities.map(c=>c.capability_id));
    assert.equal(c.framework_versions.find(v=>v.framework_version_id===gate.framework_version_id).requirement_population_status,'EXTERNAL_REQUIREMENT_SOURCE_PENDING');
  }
}

test('catalog parses, verified publisher/version/access gates and closed pending populations hold',()=>validateSources(catalog));
test('all 38 dispositions resolve capability/evidence and MAPPED has verified versioned reference',()=>validateMappings(catalog,crosswalk,index));
test('109 one-to-one S0 locators, anchors, digests and proof classifications retain exact Git source',()=>{
  unique(index.evidence,'evidence_id');
  assert.equal(index.evidence.length,109);
  assert.equal(index.status,'SOURCE_LOCATORS_HASHES_VERIFIED_IN_S1');
  const sourceCache=new Map();
  for (const e of index.evidence) {
    const original=s0.evidence_references.find(r=>r.evidence_id===e.evidence_id);
    assert.ok(original);
    for (const key of ['path','line','anchor','source_commit','content_sha256_lf_utf8']) assert.equal(e[key],original[key],key);
    assert.equal(e.authority_classification,original.classification);
    assert.equal(e.source_execution,original.execution);
    assert.equal(e.verification_mode,original.mode);
    assert.deepEqual(e.capability_ids,s0.capabilities.filter(c=>c.evidence_ids.includes(e.evidence_id)).map(c=>c.capability_id));
    assert.deepEqual(e.legacy_surface_ids,s0.legacy_surfaces.filter(l=>l.evidence_ids.includes(e.evidence_id)).map(l=>l.surface_id));
    assert.equal(e.exact_locator,`https://github.com/cnegrao/code-guard-governance/blob/${e.source_commit}/${e.path}#L${e.line}`);
    const key=e.source_commit+':'+e.path;
    if (!sourceCache.has(key)) sourceCache.set(key,git(['show',key]).replace(/\r\n/g,'\n'));
    const source=sourceCache.get(key);
    assert.equal(hash(source),e.content_sha256_lf_utf8,key);
    assert.equal(source.split('\n')[e.line-1].trim(),e.anchor.trim(),e.evidence_id);
    assert.equal(e.current_verification_status,'SOURCE_LOCATOR_HASH_VERIFIED_IN_S1');
    assert.equal(e.ci_status,'NOT_VERIFIED');
    assert.equal(e.customer_deployment_status,'NOT_VERIFIED');
    assert.equal(e.operating_effectiveness_status,'NOT_ESTABLISHED');
    assert.equal(e.certification_status,'NOT_ASSERTED');
  }
  assert.deepEqual(index.s0_verification_summaries,s0.verification);
});
test('invalid licensed requirements, unverified references and fabricated mapping IDs fail closed',()=>{
  const licensed=structuredClone(catalog);
  licensed.requirements[0].framework_version_id='ISO-IEC-42001-2023-ED1';
  assert.throws(()=>validateSources(licensed));
  const unverified=structuredClone(catalog);
  unverified.requirements[0].source_verification_state='UNKNOWN';
  assert.throws(()=>validateSources(unverified));
  const dangling=structuredClone(crosswalk);
  dangling.capability_dispositions.find(d=>d.mapping_state==='MAPPED').requirement_id='unobserved-clause';
  assert.throws(()=>validateMappings(catalog,dangling,index));
  const falsePass=structuredClone(crosswalk);
  falsePass.capability_dispositions[0].evidence_ids=['invented'];
  assert.throws(()=>validateMappings(catalog,falsePass,index));
  const falsePending=structuredClone(crosswalk);
  falsePending.pending_framework_gates[0].mapping_state='MAPPED';
  assert.throws(()=>validateMappings(catalog,falsePending,index));
});
test('Markdown has the same 38 dispositions, 109 evidence rows and all five containment classifications',()=>{
  const matrix=readFileSync(root+'external-credibility-matrix-v0.md','utf8');
  const walk=readFileSync(root+'framework-crosswalk-v0.md','utf8');
  const evidence=readFileSync(root+'evidence-index-v0.md','utf8');
  assert.equal(matrix.split('\n').filter(l=>/^\| TA-C\d+ — /.test(l)).length,38);
  assert.equal(walk.split('\n').filter(l=>/^\| CW-TA-C/.test(l)).length,38);
  assert.equal(evidence.split('\n').filter(l=>/^\| E\d+ \|/.test(l)).length,109);
  for (const c of s0.capabilities) {
    const row=matrix.split('\n').find(l=>l.startsWith('| '+c.capability_id+' — '));
    assert.ok(row.includes('| '+c.proof_status+' |'));
    const d=crosswalk.capability_dispositions.find(d=>d.capability_id===c.capability_id);
    assert.ok(row.includes('| '+d.mapping_state+' |') && row.includes(d.external_claim_ceiling));
  }
  const legacy=readFileSync(root+'legacy-containment-register-v0.md','utf8');
  for (const l of s0.legacy_surfaces) assert.ok(legacy.includes(`| ${l.surface_id}: ${l.surface} | ${l.classification} |`));
  for (const text of [matrix,walk,evidence,legacy]) assert.doesNotMatch(text,/\b\d+(?:\.\d+)?\s*%/);
});
function assertS1Scope(files = changed()) {
  const allowed = new Set(['docs/agent/ARCHITECTURE_INDEX.md', 'docs/codex/evidence/2026-10-20-m17.5-s1-source-crosswalk.md']);
  for (const f of files) assert.ok(allowed.has(f) || f.startsWith(root), 'out-of-scope file ' + f);
}

test('S1 delta is documentation-only, S0 unchanged; no runtime/migration/API/UI/configuration delta',()=>{
  assert.equal(at(start,inventoryPath),at(historicalClose,inventoryPath));
  verifyHorizon();
  assertS1Scope();
  assert.equal(git(['rev-list', '--count', start + '..' + historicalClose]).trim(), '1');
  assert.equal(git(['diff','--name-only',start,historicalClose,'--','docs/architecture/ADR-GOVIA-TRUST-ASSURANCE-v1.md','docs/codex/evidence/2026-10-20-m17.5-s0-trust-assurance-inventory.md']).trim(),'');
});

test('verify-v0: historical scope, boundary, hash, anchor and locator mutations fail closed', () => {
  rejectHistoricalMutations([[assertS1Scope, changed()]]);
});
