import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');
const scripts = path.join(root, 'scripts/agent');
const scratch = path.join(root, '.artifacts/agent/framework-tests');

function run(command, args, cwd) {
  // Exercise independent CLI invocations, not recursive runs inside this test runner.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', shell: false });
  assert.ifError(result.error);
  return result;
}
function pass(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
function fail(result, message) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
}
function git(dir, ...args) { return pass(run('git', args, dir)).trim(); }
function script(dir, name, ...args) { return run(process.execPath, [path.join(scripts, `${name}.mjs`), ...args], dir); }
function write(dir, file, content) {
  const target = path.join(dir, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}
function commit(dir) {
  git(dir, 'add', '.');
  git(dir, '-c', 'core.hooksPath=', 'commit', '-m', 'fixture');
}
function fixture() {
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(path.join(scratch, 'case-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.name', 'Framework fixture');
  git(dir, 'config', 'user.email', 'fixture@example.invalid');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'remote', 'add', 'origin', 'https://github.com/cnegrao/code-guard-governance.git');
  write(dir, '.gitignore', '.artifacts/\n');
  write(dir, 'db/migrations/001.sql', 'select 1;\n');
  write(dir, '.github/workflows/local.yml', 'name: fixture\n');
  write(dir, 'package.json', '{"private":true}\n');
  write(dir, 'probe.test.mjs', "import { writeFileSync } from 'node:fs'; writeFileSync('.artifacts/executed', 'yes');\n");
  write(dir, 'packages/canonical-contracts/package.json', '{"private":true}\n');
  for (const name of ['a', 'b']) {
    write(dir, `packages/canonical-contracts/${name}.test.mjs`, `import { appendFileSync } from 'node:fs';\nimport { test } from 'node:test';\ntest('${name}', () => appendFileSync('../../.artifacts/pids', '${name}:' + process.pid + '\\n'));\n`);
  }
  commit(dir);
  git(dir, 'update-ref', 'refs/remotes/origin/main', git(dir, 'rev-parse', 'HEAD'));
  git(dir, 'switch', '-c', 'feature/framework');
  const preflight = JSON.parse(pass(script(dir, 'preflight')));
  assert.equal(preflight.migrationBaseline.count, 1);
  return dir;
}
function events(dir) {
  return readFileSync(path.join(dir, '.artifacts/agent/verification.jsonl'), 'utf8')
    .trim().split('\n').map(line => JSON.parse(line));
}
function assertBlocked(dir, reason, profiles = ['focused']) {
  for (const profile of profiles) fail(script(dir, 'verify', '--profile', profile, '--test', 'probe.test.mjs'), reason);
  assert.equal(existsSync(path.join(dir, '.artifacts/executed')), false);
  assert.equal(existsSync(path.join(dir, '.artifacts/agent/verification.jsonl')), false);
  fail(script(dir, 'handoff', '--objective', 'Fixture', '--next-action', 'Review'), reason);
  assert.equal(existsSync(path.join(dir, '.artifacts/agent/handoff.json')), false);
  assert.equal(existsSync(path.join(dir, '.artifacts/agent/handoff.md')), false);
}

for (const mode of ['unstaged', 'staged', 'committed', 'staged with restored worktree', 'renamed', 'deleted']) {
  test(`historical migration ${mode} after preflight blocks validation and handoff`, () => {
    const dir = fixture();
    const file = 'db/migrations/001.sql';
    if (mode === 'renamed') renameSync(path.join(dir, file), path.join(dir, 'db/migrations/renamed.sql'));
    else if (mode === 'deleted') unlinkSync(path.join(dir, file));
    else write(dir, file, 'select 2;\n');
    if (mode.startsWith('staged')) git(dir, 'add', file);
    if (mode === 'staged with restored worktree') write(dir, file, 'select 1;\n');
    if (mode === 'committed') commit(dir);
    assertBlocked(dir, /Historical migration changes/, mode === 'unstaged' ? ['focused', 'integration', 'final'] : ['focused']);
  });
}

test('additive migration after preflight allows dirty candidate validation and handoff', () => {
  const dir = fixture();
  write(dir, 'db/migrations/002.sql', 'select 2;\n');
  pass(script(dir, 'verify', '--profile', 'focused', '--test', 'probe.test.mjs'));
  assert.equal(readFileSync(path.join(dir, '.artifacts/executed'), 'utf8'), 'yes');
  pass(script(dir, 'handoff', '--objective', 'Add migration', '--next-action', 'Review'));
  const report = JSON.parse(readFileSync(path.join(dir, '.artifacts/agent/handoff.json'), 'utf8'));
  assert.deepEqual(report.changedFiles, ['db/migrations/002.sql']);
  assert.equal(report.validation[0].status, 'passed');
  fail(script(dir, 'preflight'), /Worktree must be clean/);
});

for (const file of ['.github/workflows/local.yml', 'vercel.json']) {
  test(`protected path ${file} changed after preflight blocks validation and handoff`, () => {
    const dir = fixture();
    write(dir, file, '{}\n');
    assertBlocked(dir, /hosted\/deployment scope/);
  });
}

test('compatible files in one pattern use one runner invocation and retain isolation flags', () => {
  const dir = fixture();
  const selection = ['--profile', 'focused', '--test', 'packages/canonical-contracts/*.test.mjs'];
  const plan = JSON.parse(pass(script(dir, 'verify', ...selection, '--plan')));
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(plan.steps[0].args, [
    '--test-isolation=none', '--test',
    path.join(dir, 'packages/canonical-contracts/a.test.mjs'),
    path.join(dir, 'packages/canonical-contracts/b.test.mjs'),
  ]);
  pass(script(dir, 'verify', ...selection));
  const evidence = events(dir);
  assert.equal(evidence.filter(event => event.phase === 'attempt').length, 1);
  assert.equal(evidence.find(event => event.phase === 'result').status, 'passed');
  const pids = readFileSync(path.join(dir, '.artifacts/pids'), 'utf8').trim().split('\n');
  assert.deepEqual(pids.map(line => line.split(':')[0]).sort(), ['a', 'b']);
  assert.equal(new Set(pids.map(line => line.split(':')[1])).size, 1);
  fail(script(dir, 'verify', ...selection), /Repeated command/);
  fail(script(dir, 'verify', ...selection, '--test', 'packages/canonical-contracts/a.test.mjs'), /Duplicate checks/);
});

test('one pattern keeps different packages and runner flags in separate invocations', () => {
  const dir = fixture();
  write(dir, 'packages/canonical-contracts/c.test.ts', 'export {};\n');
  const plan = JSON.parse(pass(script(dir, 'verify', '--profile', 'focused', '--test', '**/*.test.*', '--plan')));
  assert.equal(plan.steps.length, 3);
  const rootStep = plan.steps.find(step => step.cwd === dir);
  assert.deepEqual(rootStep.args, ['--test', path.join(dir, 'probe.test.mjs')]);
  const typed = plan.steps.find(step => step.args.includes('tsx'));
  assert.deepEqual(typed.args.slice(0, 4), ['--import', 'tsx', '--test-isolation=none', '--test']);
  assert.equal(typed.args.length, 5);
  const untyped = plan.steps.find(step => step !== rootStep && step !== typed);
  assert.equal(untyped.args.length, 4);
});

test('grouped final verification is still final-once and requires an explicit profile', () => {
  const dir = fixture();
  const selection = ['--test', 'packages/canonical-contracts/*.test.mjs'];
  fail(script(dir, 'verify', ...selection), /Select --profile/);
  pass(script(dir, 'verify', '--profile', 'final', ...selection));
  fail(script(dir, 'verify', '--profile', 'final', ...selection, '--hypothesis', 'No candidate change'), /Final verification already attempted/);
  assert.equal(events(dir).filter(event => event.phase === 'attempt').length, 1);
});
