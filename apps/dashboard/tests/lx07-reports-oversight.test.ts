import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';

// Synthetic records are confined to this isolated test transport. No network/database access.
const orgA = '11111111-1111-4111-8111-111111111111';
const orgB = '22222222-2222-4222-8222-222222222222';
let currentOrg = orgA;
let levels: Array<string | null> = [];
let denied = false;
const requests: URL[] = [];
const client = createClient('https://fixture.invalid', 'server-fixture', {
  db: { schema: 'gov_repo' }, auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer server-fixture');
    assert.equal(init?.method, url.pathname.includes('/rpc/') ? 'POST' : (init?.method === 'HEAD' ? 'HEAD' : 'GET'));
    if (url.pathname.includes('/rpc/')) {
      assert.ok(url.pathname.endsWith('/agent_compliance_gaps'));
      assert.equal(JSON.parse(String(init?.body)).p_organisation_id, currentOrg);
    } else {
      assert.equal(url.searchParams.get('organisation_id') ?? url.searchParams.get('control_assessments.organisation_id'), `eq.${currentOrg}`);
    }
    const table = url.pathname.split('/').at(-1);
    const select = url.searchParams.get('select');
    if (denied && table === 'agents' && select === 'oversight_level') {
      return new Response(JSON.stringify({ message: 'oversight read denied' }), { status: 403 });
    }
    let rows: Record<string, unknown>[] = [];
    if (table === 'agents') {
      assert.equal(url.searchParams.get('status'), 'neq.decommissioned');
      rows = levels.map((level, index) => ({
        agent_id: `${currentOrg}-${index}`, agent_code: `AG-${index}`, name: 'Same name across tenants',
        oversight_level: level, status: 'active', risk_level: 'low', agent_type: 'assistive',
        cg_ag_007_oversight: true, cg_ag_012_autonomous_governed: true,
        external_refs: { discovery: { evidence: ['source claims verified human supervision'] } },
      }));
    }
    if (table === 'ai_systems' && levels.length) rows = [{
      system_id: 'system-fixture', name: 'Fixture system', lifecycle: 'operation', status: 'active',
      cg_sys_001_registered: true, cg_sys_002_owner: true, cg_sys_003_risk_classified: true,
      cg_sys_004_tech_doc: true, cg_sys_005_risk_mgmt: true, cg_sys_006_human_oversight: true,
      cg_sys_007_conformity: true, cg_sys_008_post_market: true,
    }];
    return new Response(init?.method === 'HEAD' ? null : JSON.stringify(rows), {
      headers: { 'content-type': 'application/json', 'content-range': `*/${rows.length}` },
    });
  } },
});

const pdfs: Array<{ text: string[]; finished: Promise<Buffer> }> = [];
// Wrap real PDFKit to inspect actual writer calls and await its stream in tests.
// The legacy synchronous service return contract is not changed by this slice.
function CapturedPDF(options: PDFKit.PDFDocumentOptions) {
  const doc = new PDFDocument(options);
  const chunks: Buffer[] = [];
  const text: string[] = [];
  const original = doc.text.bind(doc);
  doc.text = ((...args: unknown[]) => {
    text.push(String(args[0]));
    return (original as (...values: unknown[]) => PDFKit.PDFDocument)(...args);
  }) as typeof doc.text;
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  pdfs.push({ text, finished });
  return doc;
}

let reports: typeof import('../repositories/reports');
let writers: typeof import('../services/reports');
before(async () => {
  mock.module('../lib/db', { namedExports: { db: { write: client, read: { from() { throw Error('ANON_READ_FORBIDDEN'); } } } } });
  mock.module('pdfkit', { defaultExport: CapturedPDF });
  reports = await import('../repositories/reports');
  writers = await import('../services/reports');
});

test('empty inventory remains UNKNOWN / NOT_EVIDENCED, with no fabricated level or recommendation', async () => {
  levels = []; currentOrg = orgA;
  const data = await reports.gatherReportData(currentOrg);
  assert.deepEqual(data.aiAct.oversight, {
    effectiveLevel: 'UNKNOWN', evidenceStatus: 'NOT_EVIDENCED', authority: 'NON_AUTHORITATIVE',
    recommendationStatus: 'UNKNOWN',
    source: { table: 'gov_repo.agents', field: 'oversight_level', organisationId: orgA },
    recordedLevels: [],
  });
  assert.ok(!('oversightLevels' in data.aiAct), 'ambiguous effective-level distribution was removed');
});

test('L1-L4, missing, UNKNOWN and unrecognized records retain their values but never establish supervision', async () => {
  levels = ['l1_automated', 'l2_human_review', 'l3_human_approval', 'l4_human_in_loop', null, '', 'UNKNOWN', 'unrecognized', 'l2_human_review'];
  const original = [...levels]; currentOrg = orgA; requests.length = 0;
  const data = await reports.gatherReportData(currentOrg);
  const oversight = data.aiAct.oversight;
  assert.equal(oversight.effectiveLevel, 'UNKNOWN');
  assert.equal(oversight.evidenceStatus, 'NOT_EVIDENCED');
  assert.equal(oversight.authority, 'NON_AUTHORITATIVE');
  assert.equal(oversight.recommendationStatus, 'UNKNOWN');
  assert.deepEqual(oversight.recordedLevels, [...new Set(levels)].map(recordedLevel => ({ recordedLevel, count: levels.filter(v => v === recordedLevel).length })));
  assert.deepEqual(levels, original);
  assert.ok(requests.some(u => u.searchParams.get('select') === 'oversight_level'));
  // These favourable historical metrics include oversight flags but must not affect the evidence state.
  assert.equal(data.compliance.rate, 100);
  assert.equal(data.compliance.controlCoverage, 100);
  assert.equal(data.compliance.totalGaps, 0);
  assert.ok(data.regulatory.evidenceCount > 0, 'technical evidence nodes also cannot establish oversight');
});

test('same-name records in another tenant do not mix report labels or provenance', async () => {
  currentOrg = orgB; levels = ['l4_human_in_loop'];
  const data = await reports.gatherReportData(orgB);
  assert.equal(data.aiAct.oversight.source.organisationId, orgB);
  assert.deepEqual(data.aiAct.oversight.recordedLevels, [{ recordedLevel: 'l4_human_in_loop', count: 1 }]);
  currentOrg = orgA; levels = [];
  assert.deepEqual((await reports.gatherReportData(orgA)).aiAct.oversight.recordedLevels, []);
});

test('denied oversight reads reject rather than produce empty/favourable reports', async () => {
  denied = true;
  try { await assert.rejects(reports.gatherReportData(currentOrg), /oversight read denied/); }
  finally { denied = false; }
});

test('all three real PDF writers expose UNKNOWN despite 100% legacy metrics; AI Act qualifies recorded labels', async () => {
  for (const population of [[], ['l1_automated', 'l2_human_review', 'l3_human_approval', 'l4_human_in_loop']]) {
    levels = population; currentOrg = orgA;
    const data = await reports.gatherReportData(orgA);
    for (const generate of [writers.generateExecutiveReport, writers.generateAIActReport, writers.generateDORAReport]) {
      generate(data);
      const pdf = pdfs.at(-1)!;
      const text = pdf.text.join('\n');
      assert.match(text, /Effective oversight: UNKNOWN \/ NOT_EVIDENCED/);
      assert.match(text, /heuristic recommendations: NON_AUTHORITATIVE/);
      assert.match(text, /Recommendation: UNKNOWN; recorded label origin is unverified/);
      assert.match(text, /Applicability and sufficiency are unknown/);
      assert.match(text, /rates, gaps, control flags and evidence counts do not prove supervision/);
      assert.doesNotMatch(text, /No critical (AI Act compliance|DORA) issues detected|2\. Human Oversight/);
      if (generate === writers.generateAIActReport) {
        assert.match(text, /Recorded labels \(unverified\), returned non-decommissioned rows only/);
        if (population.length === 0) assert.match(text, /No recorded labels returned; this does not prove absence of supervision/);
        for (const level of population) assert.ok(text.includes(`${level}: 1 recorded rows`));
      }
      const bytes = await pdf.finished;
      assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')), 'real PDFKit stream completed');
    }
  }
});
