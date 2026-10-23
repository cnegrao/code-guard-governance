// Offline documentation renderer. No product/runtime, network or database use.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const pretty = value => value === null ? 'UNKNOWN / not supplied' : String(value);
const cell = value => pretty(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const table = (headers, rows) => [
  '| '+headers.join(' | ')+' |', '| '+headers.map(()=>'---').join(' | ')+' |',
  ...rows.map(row=>'| '+row.map(cell).join(' | ')+' |'), '',
].join('\n');
// Full field projection makes even less visible metadata reviewable and enforces parity.
function fields(value, depth=0) {
  if (value === null || typeof value !== 'object') return pretty(value);
  const entries=Array.isArray(value) ? value.map((v,i)=>[i+1,v]) : Object.entries(value);
  if (!entries.length) return Array.isArray(value) ? '(empty list)' : '(empty object)';
  return '\n'+entries.map(([key,v])=>{
    const rendered=fields(v,depth+1);
    return '  '.repeat(depth)+'- **'+key+'**:'+(rendered.startsWith('\n')?'':' ')+rendered;
  }).join('\n');
}

export function renderMatrix(doc) {
  return [
    '# V0 Award Readiness Matrix', '',
    'Version '+doc.record_version+' · cutoff '+doc.cutoff+' ('+doc.cutoff_timezone+').', '',
    '**Internal reference only. Publication and submission PROHIBITED.** All S2 claims remain INELIGIBLE. No application wording is approved. READY_FOR_INTERNAL_REVIEW never means READY_TO_SUBMIT, NOMINATED, FINALIST or WINNER. External award-ready language is prohibited.', '',
    'Admission verifies a programme identity and source, not GovIA eligibility. The applicant legal entity is UNKNOWN. Criteria links identify bounded repository correspondence; they never establish criterion satisfaction, deployment, adoption, effectiveness or novelty. Source conflicts and missing facts fail closed. L01/L02/L03/L04 and legacy numeric/registry outputs cannot establish readiness; S2 presentation gates remain unresolved.', '',
    table(['Edition','Category (local reference)','Eligibility','Readiness','Submission window'],doc.awards.map(r=>[r.edition_id,r.category_name,r.eligibility_state,r.readiness_state,r.submission_window_state])),
    'Submission-window counts and calendar event counts use different units. Past records stay historical. No annual recurrence or 2027 edition is inferred. PNI is the historical ninth edition, with 2025 applications and 2026 ceremony.', '',
    '## Sources', '',
    ...doc.sources.map(s=>'- **'+s.source_id+'**: ['+s.title+']('+s.url+') — '+s.locator+'; retrieved '+s.retrieved_at+'; publication '+pretty(s.published_at)+'; '+s.source_status+'.'), '',
    'Remote pages are mutable. No full-page byte archive is claimed. Bibliographic locators and bounded observations below are the versioned reference record; independent revalidation is required before any decision.', '',
    '## Programme records', '',
    ...doc.awards.flatMap(r=>['### '+r.edition_id+' — '+r.official_program_name,'',fields(r),'']),
    '## Version, policy, discovery and source metadata', '',
    'The following is a complete field projection of the JSON envelope (programme records above). It preserves nulls, omissions, provenance, search scope and discovery exclusions for deterministic parity.', '',
    fields(Object.fromEntries(Object.entries(doc).filter(([key])=>key!=='awards'))), '',
  ].join('\n');
}

export function renderCalendar(doc) {
  return [
    '# V0 Award Calendar', '',
    'Version '+doc.record_version+' · frozen cutoff '+doc.cutoff+' ('+doc.cutoff_timezone+'). No live availability or submission authorization.', '',
    'Dates retain organizer precision. UNKNOWN timezone never means local time or an invented end-of-day. Conflicting effective dates stay UNKNOWN while original published assertions remain visible. Programme events are not GovIA status; an organizer announcement never makes GovIA a nominee, finalist or winner.', '',
    table(['Event','Type','Opens / event begins','Closes / event ends','Precision','Timezone','Status'],doc.events.map(e=>[e.event_id,e.event_type,e.opens_at,e.closes_at,e.date_precision,e.timezone,e.status])),
    '## Source and status details', '',
    ...doc.events.flatMap(e=>['### '+e.event_id,'',fields(e),'']),
    '## Version and counting metadata', '',
    fields(Object.fromEntries(Object.entries(doc).filter(([key])=>key!=='events'))), '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for(const [name,render] of [['award-readiness-matrix-v0',renderMatrix],['award-calendar-v0',renderCalendar]]) {
    writeFileSync('docs/trust-assurance/'+name+'.md',render(JSON.parse(readFileSync('docs/trust-assurance/'+name+'.json','utf8'))));
  }
}
