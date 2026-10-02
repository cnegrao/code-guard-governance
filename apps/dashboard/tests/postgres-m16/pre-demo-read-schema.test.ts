import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { fullChainCluster } from '../helpers/m16-definer-surface-fixtures';

test('pre-demo server read selections and ACLs match the full canonical migration chain', { timeout: 900_000 }, async t => {
  const pg = await fullChainCluster(message => t.diagnostic(message), { r3: true });
  t.after(() => pg.stop());
  const tables = new Set<string>();
  for (const file of ['repositories/agents.ts', 'repositories/systems.ts', 'repositories/users.ts',
    'repositories/organisations.ts', 'repositories/dashboard.ts', 'repositories/reports.ts',
    'repositories/search.ts', 'repositories/graph.ts', 'repositories/talk.ts', 'services/knowledge-graph.ts']) {
    const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const queries: Array<{ table: string; columns: string }> = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'select' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const match = node.expression.expression.getText(ast).match(/^db\.write\s*\.from\("(\w+)"\)$/);
        if (match) queries.push({ table: match[1], columns: node.arguments[0].text });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const { table, columns } of queries) {
      tables.add(table);
      const selection = columns.replace(/,?\s*control_assessments!inner\(organisation_id\)/g, '')
        .split(',').map(column => column.includes(':') ? column.split(':')[1].trim() : column.trim()).join(',');
      await pg.svc(`select ${selection} from gov_repo.${table} limit 0`);
    }
  }
  assert.ok(tables.size >= 10);
  for (const table of tables) {
    assert.equal(await pg.sql(`select relrowsecurity from pg_class where oid='gov_repo.${table}'::regclass`), 't', table);
    assert.equal(await pg.sql(`select has_table_privilege('service_role','gov_repo.${table}','SELECT')`), 't', table);
    assert.equal(await pg.sql(`select has_table_privilege('anon','gov_repo.${table}','SELECT')`), 'f', table);
  }
  await pg.svc("select f.finding_id from gov_repo.control_findings f join gov_repo.control_assessments a using(assessment_id) where a.organisation_id='11111111-1111-4111-8111-111111111111' limit 0");
  await pg.svc("select count(*) from gov_repo.ict_incidents where reporting_phase <> 'not_required'");
  // Optional legacy RAG storage is NOT supplied by the canonical chain. No hosted SQL is invented.
  assert.equal(await pg.sql("select to_regclass('gov_repo.coding_memory') is null"), 't');
  t.diagnostic(`verified tables: ${[...tables].sort().join(', ')}`);
});
