import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { newSession, readBudget, requireBudget, runBudgetedCommand, timingReport } from '../budget.mjs';

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
  const preflight = JSON.parse(pass(script(dir, 'preflight', '--budget-minutes', '30')));
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
  fail(script(dir, 'preflight', '--budget-minutes', '30'), /Worktree must be clean/);
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

function session(dir) { return JSON.parse(readFileSync(path.join(dir, '.artifacts/agent/session.json'), 'utf8')); }
function setSession(dir, value) { write(dir, '.artifacts/agent/session.json', JSON.stringify(value)); }
function stateFor(dir) {
  const active = session(dir);
  return { root: dir, branch: active.branch, base: active.base, head: active.headAtStart };
}
function expire(dir) {
  const active = session(dir);
  const deadline = Date.now() - 1000;
  setSession(dir, { ...active, startedAt: new Date(deadline - active.budgetMinutes * 60_000).toISOString(), deadlineAt: new Date(deadline).toISOString() });
}

test('preflight requires an explicit positive integral budget and failed calls cannot reset it', () => {
  const dir = fixture();
  const original = session(dir);
  for (const budget of [undefined, '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740991']) {
    fail(script(dir, 'preflight', ...(budget === undefined ? [] : ['--budget-minutes', budget])), /budget/i);
    assert.deepEqual(session(dir), original);
  }
  pass(script(dir, 'preflight', '--budget-minutes', '90', '--objective', 'Explicit new session'));
  const renewed = session(dir);
  assert.notEqual(renewed.sessionId, original.sessionId);
  assert.equal(renewed.objective, 'Explicit new session');
  assert.equal(renewed.budgetMinutes, 90);
  assert.equal(Date.parse(renewed.deadlineAt) - Date.parse(renewed.startedAt), 90 * 60_000);
  assert.equal(renewed.headAtStart, git(dir, 'rev-parse', 'HEAD'));
});

test('valid budget accepts all profiles, exposes timing, and never resets after a new commit', () => {
  const dir = fixture();
  const original = session(dir);
  assert.equal(requireBudget(readBudget(stateFor(dir))).budgetStatus, 'OK');
  const checks = [
    ['focused', 'probe.test.mjs'],
    ['integration', 'packages/canonical-contracts/a.test.mjs'],
    ['final', 'packages/canonical-contracts/b.test.mjs'],
  ];
  for (const [profile, file] of checks) pass(script(dir, 'verify', '--profile', profile, '--test', file));
  write(dir, 'note.txt', 'A later commit does not reset the clock.');
  commit(dir);
  pass(script(dir, 'handoff', '--objective', 'Timing', '--next-action', 'Review'));
  assert.deepEqual(session(dir), original);
  const report = JSON.parse(readFileSync(path.join(dir, '.artifacts/agent/handoff.json'), 'utf8'));
  assert.equal(report.timing.budgetStatus, 'OK');
  assert.equal(report.timing.startedAt, original.startedAt);
  assert.equal(report.timing.preflightStartedAt, original.startedAt);
  assert.ok(report.timing.remainingMs > 0);
  assert.ok(report.timing.implementationExplorationMs >= 0);
  assert.match(report.timing.implementationExplorationNote, /Approximation/);
  for (const [profile] of checks) assert.ok(report.timing.verificationMs[profile] > 0);
  assert.equal(report.timing.totalVerificationMs, Object.values(report.timing.verificationMs).reduce((a, b) => a + b, 0));
  for (const event of events(dir).filter(event => event.phase === 'result')) {
    assert.ok(event.timeoutMs <= Date.parse(original.deadlineAt) - Date.parse(event.startedAt));
    assert.equal(event.durationMs, Date.parse(event.at) - Date.parse(event.startedAt));
  }
  const markdown = readFileSync(path.join(dir, '.artifacts/agent/handoff.md'), 'utf8');
  assert.match(markdown, /## Timing/);
  assert.match(markdown, /Budget status: OK/);
});

test('expired session blocks every verify profile and produces a non-success STOP handoff', () => {
  const dir = fixture();
  expire(dir);
  const original = session(dir);
  for (const profile of ['focused', 'integration', 'final']) {
    fail(script(dir, 'verify', '--profile', profile, '--test', 'probe.test.mjs'), /budget exhausted/);
  }
  assert.equal(existsSync(path.join(dir, '.artifacts/executed')), false);
  fail(script(dir, 'handoff', '--objective', 'Expired', '--next-action', 'New explicit preflight'), /budget exhausted/);
  const report = JSON.parse(readFileSync(path.join(dir, '.artifacts/agent/handoff.json'), 'utf8'));
  assert.equal(report.timing.budgetStatus, 'EXHAUSTED');
  assert.equal(report.timing.remainingMs, 0);
  assert.match(report.stopReason, /STOP/);
  assert.match(readFileSync(path.join(dir, '.artifacts/agent/handoff.md'), 'utf8'), /EXHAUSTED.*STOP/);
  assert.deepEqual(session(dir), original);
});

for (const field of ['branch', 'base']) {
  test(`session ${field} mismatch fails closed`, () => {
    const dir = fixture();
    setSession(dir, { ...session(dir), [field]: 'wrong' });
    assertBlocked(dir, /branch\/base mismatch/);
  });
}

for (const mode of ['missing', 'malformed', 'inconsistent deadline']) {
  test(`${mode} session fails closed`, () => {
    const dir = fixture();
    if (mode === 'missing') unlinkSync(path.join(dir, '.artifacts/agent/session.json'));
    else if (mode === 'malformed') write(dir, '.artifacts/agent/session.json', '{');
    else setSession(dir, { ...session(dir), deadlineAt: new Date(Date.now() + 1000).toISOString() });
    assertBlocked(dir, /session/i);
  });
}

test('fake clock caps each command timeout and prevents commands after expiry without sleeping', () => {
  const dir = fixture();
  const state = stateFor(dir);
  const start = Date.parse(session(dir).startedAt);
  const active = newSession(state, '90', 'Fake clock', start);
  setSession(dir, active);
  const deadline = Date.parse(active.deadlineAt);
  const step = { command: 'fake', args: [], cwd: dir };
  let clock = start;
  const timeouts = [];
  const spawn = (_command, _args, options) => {
    timeouts.push(options.timeout);
    assert.equal(options.shell, false);
    assert.equal(options.killSignal, 'SIGKILL');
    clock += 1;
    return { status: 0 };
  };
  runBudgetedCommand(state, step, active.sessionId, { now: () => clock, spawn });
  clock = deadline - 25;
  const near = runBudgetedCommand(state, step, active.sessionId, { now: () => clock, spawn });
  assert.equal(near.exhausted, false);
  clock = deadline - 10;
  const timed = runBudgetedCommand(state, step, active.sessionId, { now: () => clock, spawn: (_cmd, _args, options) => {
    assert.equal(options.timeout, 10);
    clock = deadline;
    return { status: null, signal: 'SIGKILL', error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) };
  } });
  assert.equal(timed.exhausted, true);
  assert.equal(timed.durationMs, 10);
  assert.throws(() => runBudgetedCommand(state, step, active.sessionId, { now: () => clock, spawn }), /budget exhausted/);
  assert.deepEqual(timeouts, [30 * 60_000, 25]);
  // Even a successful process exit at the deadline must be classified as exhaustion.
  clock = deadline - 1;
  assert.equal(runBudgetedCommand(state, step, active.sessionId, { now: () => clock, spawn }).exhausted, true);
});

test('timing isolates sessions, reports all profiles and labels interrupted durations as approximations', () => {
  const dir = fixture();
  const active = session(dir);
  const start = Date.parse(active.startedAt);
  const common = { sessionId: active.sessionId, run: 'run' };
  const evidence = [
    { ...common, phase: 'start', at: new Date(start + 100).toISOString() },
    ...['focused', 'integration', 'final'].map((profile, index) => ({ ...common, phase: 'result', profile, durationMs: index + 1 })),
    { ...common, phase: 'attempt', key: 'interrupted' },
    { sessionId: 'old-session', phase: 'result', profile: 'focused', durationMs: 9999 },
  ];
  const timing = timingReport(readBudget(stateFor(dir), start + 200), evidence);
  assert.deepEqual(timing.verificationMs, { focused: 1, integration: 2, final: 3 });
  assert.equal(timing.totalVerificationMs, 6);
  assert.equal(timing.implementationExplorationMs, 100);
  assert.match(timing.verificationDurationNote, /Approximation.*lower bound/);
  assert.equal(timingReport(readBudget(stateFor(dir), start), []).implementationExplorationMs, null);
});

test('expiry inside a verification command records exhaustion, stops later commands and forces STOP handoff', () => {
  const dir = fixture();
  const active = session(dir);
  const wrapper = '.artifacts/fake-timeout.mjs';
  write(dir, wrapper, `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { verify } from ${JSON.stringify(pathToFileURL(path.join(scripts, 'verify.mjs')).href)};
    const realSpawn = childProcess.spawnSync;
    let clock = ${Date.parse(active.startedAt)} + 100;
    Date.now = () => clock;
    childProcess.spawnSync = (command, args, options) => {
      if (command !== process.execPath) return realSpawn(command, args, options);
      if (options.timeout > ${Date.parse(active.deadlineAt)} - clock) throw new Error('Timeout exceeds remaining budget');
      clock = ${Date.parse(active.deadlineAt)};
      return { status: null, signal: 'SIGKILL', error: { code: 'ETIMEDOUT', message: 'Simulated timeout' } };
    };
    syncBuiltinESMExports();
    try { verify(['--profile', 'focused', '--test', 'probe.test.mjs', '--test', 'packages/canonical-contracts/a.test.mjs']); }
    catch (error) { console.error('STOP: ' + error.message); process.exitCode = 1; }
  `);
  fail(run(process.execPath, [path.join(dir, wrapper)], dir), /budget exhausted during verification/);
  const evidence = events(dir);
  assert.equal(evidence.filter(event => event.phase === 'attempt').length, 1);
  const result = evidence.find(event => event.phase === 'result');
  assert.equal(result.status, 'budget-exhausted');
  assert.ok(result.durationMs > 0);
  assert.ok(result.timeoutMs > 0);
  assert.equal(existsSync(path.join(dir, '.artifacts/executed')), false);
  fail(script(dir, 'handoff', '--objective', 'Expired in command', '--next-action', 'STOP'), /budget exhausted/);
  assert.deepEqual(session(dir), active);
});

test('real subprocess timeout is enforced with a short remaining budget', () => {
  const dir = fixture();
  const state = stateFor(dir);
  const active = newSession(state, '1', 'Short timeout');
  setSession(dir, active);
  let samples = 0;
  const deadline = Date.parse(active.deadlineAt);
  const execution = runBudgetedCommand(state, {
    command: process.execPath, args: ['-e', 'const end = Date.now() + 1000; while (Date.now() < end) {}'], cwd: dir,
  }, active.sessionId, { now: () => ++samples <= 2 ? deadline - 200 : deadline });
  assert.equal(execution.result.error?.code, 'ETIMEDOUT');
  assert.equal(execution.exhausted, true);
  assert.ok(execution.timeoutMs <= 200);
});
