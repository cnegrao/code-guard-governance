import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ledgerRepo } from './helpers/ledger-v2-foundation-fixtures';
const migration='20261021201316_m175_v1_s1a1_2b_ledger_v2_tenant_read.sql';
const sql=readFileSync(join(ledgerRepo,'supabase/migrations',migration),'utf8');
test('2B adds exactly three checked read definers and one private invoker; write/cutover and serializer bodies untouched',()=>{
  assert.equal((sql.match(/SECURITY DEFINER/g)||[]).length,3);
  assert.equal((sql.match(/PERFORM 1 FROM gov_repo\.l14_session_basis_v1/g)||[]).length,3);
  assert.doesNotMatch(sql,/CREATE (?:OR REPLACE )?(?:FUNCTION|PROCEDURE) gov_repo\.(?:ledger_append|ledger_v2_activate|ledger_v2_(?:entry_bytes|genesis_bytes))\(/);
  assert.doesNotMatch(sql,/GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)\b|CALL gov_repo\.ledger_v2_activate/i);
  assert.doesNotMatch(sql,/gov_repo\.ledger_verify\(|gov_repo\.ledger_global_append_head_v2/);
});
test('verifier integrity reads reside in one CTE statement; bounded full population, no client range',()=>{
  const verifier=sql.split('$verify$')[1];
  assert.equal((verifier.match(/INTO result/g)||[]).length,1);
  assert.match(verifier,/WITH epoch AS MATERIALIZED/);assert.match(verifier,/FULL JOIN sources/);
  assert.equal((verifier.match(/LIMIT 10001/g)||[]).length,2);
  assert.match(verifier,/sha256\(gov_repo\.ledger_v2_entry_bytes/);assert.match(verifier,/sha256\(gov_repo\.ledger_v2_genesis_bytes/);
  assert.doesNotMatch(verifier,/FOR UPDATE|SKIP LOCKED/);
});
test('Audit routes/repository/pages and historical migrations unchanged; adapter isolated and no legacy/global fallback',()=>{
  // Preserve the historical 2B isolation receipt at its committed endpoint.
  // audit-v2-source-contract.test.ts checks the authorized current Audit graph.
  const end='af5657213aec858c4896063c271621d12327849a';
  const paths=['apps/dashboard/app/api/audit','apps/dashboard/app/(dashboard)/audit','apps/dashboard/repositories/audit.ts',
    'apps/dashboard/components/audit','docs/architecture','packages/canonical-contracts','packages/governance-review'];
  assert.equal(execFileSync('git',['diff','--name-only','a8a72f2df1d57196e83cd512525e6dd10e6611de',end,'--',...paths],{cwd:ledgerRepo,encoding:'utf8'}).trim(),'');
  const changes=execFileSync('git',['diff','--name-only','a8a72f2df1d57196e83cd512525e6dd10e6611de',end,'--','supabase/migrations'],{cwd:ledgerRepo,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
  assert.ok(changes.every(p=>p.endsWith(migration)));
  const adapter=readFileSync(join(ledgerRepo,'apps/dashboard/lib/governance/ledger-read.ts'),'utf8');
  assert.match(adapter,/import "server-only"/);assert.match(adapter,/VerifiedGovernancePrincipal/);
  assert.doesNotMatch(adapter,/ledger_verify|governance_ledger|repositories\/audit|db\.read|\.from\(/);
  const consumers=spawnSync('git',['grep','-l','ledger-read',end,'--','apps/dashboard/app','apps/dashboard/repositories','apps/dashboard/services'],{cwd:ledgerRepo,encoding:'utf8'});
  assert.equal(consumers.status,1);assert.equal(consumers.stdout.trim(),'');
});
