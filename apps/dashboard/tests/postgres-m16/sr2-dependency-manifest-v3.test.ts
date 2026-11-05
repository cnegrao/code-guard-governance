import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { m2Baseline, applyM2, collectV3, v3FixtureUrl, m2Migrations } from '../helpers/sr2-m2-fixtures';

test('H1 V3 independent empty 108-migration replay matches the frozen current horizon',{timeout:900000},async t=>{
 const pg=await m2Baseline(m=>t.diagnostic(m));t.after(()=>pg.stop());await applyM2(pg);
 const actual=await collectV3(pg.owner),expected=JSON.parse(readFileSync(v3FixtureUrl,'utf8'));
 assert.deepEqual(actual.document,expected.document);assert.equal(actual.sha256,expected.sha256);assert.deepEqual(m2Migrations(),expected.migrations);
 assert.equal(expected.migrations.length,108);assert.equal(actual.document.routines.length,23);assert.equal(actual.document.relations.length,43);
 t.diagnostic('H1_V3_INDEPENDENT_REPLAY: '+actual.sha256);
});
