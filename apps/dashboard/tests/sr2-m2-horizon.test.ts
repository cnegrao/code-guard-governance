import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { m2Migration, m2Migrations, m2Source, v3FixtureUrl } from './helpers/sr2-m2-fixtures';
import { a2Source } from './helpers/sr2-a2-fixtures';
import { v2FixtureUrl, m1Migrations } from './helpers/sr1-numeric-fixtures';

test('H1 V3 append-only M2 horizon preserves frozen V2 and changes only the exact A2 body',()=>{
 const v2=JSON.parse(readFileSync(v2FixtureUrl,'utf8')),v3=JSON.parse(readFileSync(v3FixtureUrl,'utf8'));
 assert.deepEqual(v2.migrations,m1Migrations());assert.deepEqual(v3.migrations,m2Migrations());
 assert.deepEqual(v3.migrations.slice(0,-1),v2.migrations);assert.equal(v3.migrations.length,108);
 assert.equal(v3.migrations.at(-1).name,m2Migration);
 assert.equal(v3.document.manifest,'GOVIA_SR2_DEPENDENCY_MANIFEST_V3');
 assert.deepEqual(v3.document.horizon,{canonical_migrations:108,through:m2Migration});
 const target='gov_repo.technical_semantic_context_search_v1(';
 const changed=v3.document.routines.filter((r:any)=>r.identity.startsWith(target));assert.equal(changed.length,1);
 const old=v2.document.routines.find((r:any)=>r.identity===changed[0].identity);assert.notEqual(changed[0].body_sha256,old.body_sha256);
 const normalized={...v3.document,manifest:v2.document.manifest,horizon:v2.document.horizon,
  routines:v3.document.routines.map((r:any)=>r.identity===old.identity?{...r,body_sha256:old.body_sha256}:r)};
 assert.deepEqual(normalized,v2.document,'only the reviewed body hash and declared horizon differ');
});

test('F-1 current admission validation is per-entry materialized; candidate edges use only set membership',()=>{
 const sql=m2Source().replaceAll('\r','');
 const memo=sql.slice(sql.indexOf(' current_entry_eligibility AS MATERIALIZED'),sql.indexOf(' eligible AS MATERIALIZED'));
 const eligible=sql.slice(sql.indexOf(' eligible AS MATERIALIZED'),sql.indexOf(' scoreable AS MATERIALIZED'));
 assert.ok(memo);assert.doesNotMatch(memo,/\b(?:ps|r)\./,'entry validation cannot depend on candidate/source edges');
 const prior=a2Source().replaceAll('\r','');
 const current=prior.match(/AND \(ch\.source_admission_id IS NULL OR \(ch\.head_revision>=1 AND ([\s\S]*?)\)\)\) IS NOT TRUE AS support_fault/)![1]
  .replace(/ AND cu.source_fingerprint=e.source_fingerprint[\s\S]*$/,'');
 assert.ok(memo.includes(current),'same current admission predicates and exact frame expressions');
 assert.doesNotMatch(eligible,/frame_identity|sr2_source_admission(?:s|_heads)_v1/);
 assert.match(eligible,/\(ps.entry_id,ps.admission_basis_fingerprint\) IN \([\s\S]*SELECT entry_id,admission_basis_fingerprint FROM current_entry_eligibility WHERE eligible/);
});

test('F-3 selected reason precedence remains fail-closed with empty hits on every reason',()=>{
 const sql=m2Source();const fault=sql.slice(sql.indexOf(' fault AS MATERIALIZED'),sql.indexOf(" SELECT jsonb_build_object('contract_version'",sql.indexOf(' fault AS MATERIALIZED')));
 assert.deepEqual([...fault.matchAll(/THEN '([A-Z_]+)'/g)].map(x=>x[1]),
  ['CONTENT_WITHHELD','SOURCE_UNAVAILABLE','INVALID_SOURCE_SUPPORT','CONTENT_WITHHELD','PROVENANCE_BOUND','CONTENT_BOUND']);
 assert.ok(fault.indexOf('(SELECT reason FROM base_fault)')<fault.indexOf("THEN 'CONTENT_WITHHELD'"));
 assert.match(sql,/FROM graphs WHERE f.reason IS NULL/);
});

test('M2 preserves exact authorization, numeric/tie expressions and all graph/DTO predicates through mechanical lateral joins',()=>{
 const prior=a2Source().replaceAll('\r','').match(/\$definition\$([\s\S]*?)\$definition\$/)![1];
 const next=m2Source().replaceAll('\r','').match(/\$definition\$([\s\S]*?)\$definition\$/)![1];
 const prefix=(s:string)=>s.slice(s.indexOf('$technical$'),s.indexOf(' WITH acquired_clock'));
 assert.equal(prefix(next),prefix(prior));
 const graph=(s:string)=>s.slice(s.indexOf(' graphs AS MATERIALIZED'),s.indexOf(' fault AS MATERIALIZED'));
 let count=0;
 const boundedGraph=graph(prior).replace('SELECT r.*,s.subject_family,g.* FROM selected r','SELECT r.*,g.* FROM ranked r')
  .replace(/^(\s*)LEFT JOIN gov_repo\.(sr2_(?:subjects|projections|protected_projections|manifest_entries|chunk_locators|symbol_locators|source_admissions|source_admission_heads)_v1) (\w+) ON ([^\n]+)\n/gm,
   (_,indent,table,alias,predicate)=>{count++;return `${indent}LEFT JOIN LATERAL (SELECT ${alias}.* FROM gov_repo.${table} ${alias} WHERE ${predicate} OFFSET 0) ${alias} ON true\n`;});
 assert.equal(count,14);assert.equal(graph(next),boundedGraph,'no predicate, framed identity or DTO construction change');
 const score=(s:string)=>s.match(/scored AS MATERIALIZED[^\n]+/)![0];assert.equal(score(next),score(prior));
 const rank=(s:string)=>s.match(/ranked AS MATERIALIZED[\s\S]*?LIMIT p_limit\)/)![0];assert.equal(rank(next),rank(prior));
});
