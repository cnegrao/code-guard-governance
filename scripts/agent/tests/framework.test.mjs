import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { COMMAND_TIMEOUT_MS, newSession, readBudget, runVerificationCommand, timingReport } from '../budget.mjs';

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
function ageSession(dir) {
  const active = session(dir);
  const deadline = Date.now() - 7 * 24 * 60 * 60_000;
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

test('session target accepts all profiles, exposes timing, and preserves identity after a new commit', () => {
  const dir = fixture();
  const original = session(dir);
  assert.ok(readBudget(stateFor(dir)).elapsedWallClockMs >= 0);
  const checks = [
    ['focused', 'probe.test.mjs'],
    ['integration', 'packages/canonical-contracts/a.test.mjs'],
    ['final', 'packages/canonical-contracts/b.test.mjs'],
  ];
  for (const [profile, file] of checks) pass(script(dir, 'verify', '--profile', profile, '--test', file));
  write(dir, 'note.txt', 'A later commit does not reset the clock.');
  commit(dir);
  pass(script(dir, 'handoff', '--objective', 'Timing', '--next-action', 'Review', '--reported-working-time', '7m 42s'));
  assert.deepEqual(session(dir), original);
  const report = JSON.parse(readFileSync(path.join(dir, '.artifacts/agent/handoff.json'), 'utf8'));
  assert.equal(report.timing.operationalTarget.status, 'INFORMATIVE');
  assert.equal(report.timing.wallClock.startedAt, original.startedAt);
  assert.ok(report.timing.wallClock.untilFirstVerificationMs >= 0);
  assert.match(report.timing.wallClock.note, /user\/approval idle time/);
  assert.equal(report.timing.reportedWorkingTime, '7m 42s');
  const measured = report.timing.measuredExecution;
  for (const [profile] of checks) assert.ok(measured.verificationMs[profile] > 0);
  assert.equal(measured.totalVerificationMs, Object.values(measured.verificationMs).reduce((a, b) => a + b, 0));
  for (const event of events(dir).filter(event => event.phase === 'result')) {
    assert.equal(event.timeoutMs, COMMAND_TIMEOUT_MS);
    assert.equal(measured.verificationMs[event.profile], event.durationMs);
  }
  const markdown = readFileSync(path.join(dir, '.artifacts/agent/handoff.md'), 'utf8');
  assert.match(markdown, /## Timing/);
  assert.match(markdown, /Operational target: 30 minutes; status: INFORMATIVE/);
  assert.match(markdown, /Reported working time \(explicit input\): 7m 42s/);
});

test('week-old wall clock permits every verify profile and a successful handoff without reset', () => {
  const dir = fixture();
  ageSession(dir);
  const original = session(dir);
  for (const [profile, file] of [
    ['focused', 'probe.test.mjs'], ['integration', 'packages/canonical-contracts/a.test.mjs'], ['final', 'packages/canonical-contracts/b.test.mjs'],
  ]) {
    pass(script(dir, 'verify', '--profile', profile, '--test', file));
  }
  assert.equal(existsSync(path.join(dir, '.artifacts/executed')), true);
  pass(script(dir, 'handoff', '--objective', 'Long user wait', '--next-action', 'Review'));
  const report = JSON.parse(readFileSync(path.join(dir, '.artifacts/agent/handoff.json'), 'utf8'));
  assert.equal(report.timing.operationalTarget.status, 'INFORMATIVE');
  assert.ok(report.timing.wallClock.elapsedMs > 7 * 24 * 60 * 60_000);
  assert.equal(report.stopReason, null);
  assert.equal(report.timing.reportedWorkingTime, null);
  const markdown = readFileSync(path.join(dir, '.artifacts/agent/handoff.md'), 'utf8');
  assert.match(markdown, /Wall clock: started/);
  assert.match(markdown, /user\/approval idle time/);
  assert.doesNotMatch(markdown, /EXHAUSTED/);
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

test('command limit and exact measured duration are independent of session wall clock', () => {
  const dir = fixture();
  const state = stateFor(dir);
  const start = Date.parse(session(dir).startedAt);
  const active = newSession(state, '90', 'Fake clock', start);
  setSession(dir, active);
  const deadline = Date.parse(active.deadlineAt);
  const step = { command: 'fake', args: [], cwd: dir };
  let clock = start;
  let ticks = 0;
  const timeouts = [];
  const spawn = (_command, _args, options) => {
    timeouts.push(options.timeout);
    assert.equal(options.shell, false);
    assert.equal(options.killSignal, 'SIGKILL');
    clock += 1;
    ticks += 12.5;
    return { status: 0 };
  };
  for (const wallTime of [start, deadline - 1, deadline, deadline + 7 * 24 * 60 * 60_000]) {
    clock = wallTime;
    const execution = runVerificationCommand(state, step, active.sessionId, {
      now: () => clock, monotonic: () => ticks, spawn, timeoutMs: COMMAND_TIMEOUT_MS * 2,
    });
    assert.equal(execution.timedOut, false);
    assert.equal(execution.durationMs, 12.5);
  }
  assert.deepEqual(timeouts, Array(4).fill(COMMAND_TIMEOUT_MS));
  const adjustedClock = runVerificationCommand(state, step, active.sessionId, {
    now: () => clock, monotonic: () => ticks,
    spawn: () => { clock -= 60_000; ticks += 8.25; return { status: 0 }; },
  });
  assert.equal(adjustedClock.durationMs, 8.25);
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
    { ...common, phase: 'result', profile: 'focused', durationMs: 0, status: 'budget-exhausted' },
  ];
  const timing = timingReport(readBudget(stateFor(dir), start + 200), evidence);
  assert.deepEqual(timing.measuredExecution.verificationMs, { focused: 1, integration: 2, final: 3 });
  assert.equal(timing.measuredExecution.totalVerificationMs, 6);
  assert.equal(timing.operationalTarget.status, 'INFORMATIVE');
  assert.equal(timing.wallClock.untilFirstVerificationMs, 100);
  assert.match(timing.measuredExecution.note, /lower-bound approximation/);
  assert.equal(timingReport(readBudget(stateFor(dir), start), []).wallClock.untilFirstVerificationMs, null);
});

test('individual command timeout records failure and stops later commands independently of session age', () => {
  const dir = fixture();
  ageSession(dir);
  const active = session(dir);
  const wrapper = '.artifacts/fake-timeout.mjs';
  write(dir, wrapper, `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { verify } from ${JSON.stringify(pathToFileURL(path.join(scripts, 'verify.mjs')).href)};
    const realSpawn = childProcess.spawnSync;
    childProcess.spawnSync = (command, args, options) => {
      if (command !== process.execPath) return realSpawn(command, args, options);
      if (options.timeout !== ${COMMAND_TIMEOUT_MS}) throw new Error('Unexpected command timeout');
      return { status: null, signal: 'SIGKILL', error: { code: 'ETIMEDOUT', message: 'Simulated timeout' } };
    };
    syncBuiltinESMExports();
    try { verify(['--profile', 'focused', '--test', 'probe.test.mjs', '--test', 'packages/canonical-contracts/a.test.mjs']); }
    catch (error) { console.error('STOP: ' + error.message); process.exitCode = 1; }
  `);
  fail(run(process.execPath, [path.join(dir, wrapper)], dir), /command timed out/);
  const evidence = events(dir);
  assert.equal(evidence.filter(event => event.phase === 'attempt').length, 1);
  const result = evidence.find(event => event.phase === 'result');
  assert.equal(result.status, 'timed-out');
  assert.ok(result.durationMs > 0);
  assert.ok(result.timeoutMs > 0);
  assert.equal(existsSync(path.join(dir, '.artifacts/executed')), false);
  fail(script(dir, 'verify', '--profile', 'focused', '--test', 'probe.test.mjs'), /Repeated command/);
  pass(script(dir, 'handoff', '--objective', 'Command timeout', '--next-action', 'Investigate', '--stop-reason', 'Individual command timeout'));
  assert.equal(JSON.parse(readFileSync(path.join(dir, '.artifacts/agent/handoff.json'), 'utf8')).stopReason, 'Individual command timeout');
  assert.deepEqual(session(dir), active);
});

test('real subprocess timeout is enforced independently with a short command limit', () => {
  const dir = fixture();
  const state = stateFor(dir);
  const active = newSession(state, '1', 'Short timeout');
  setSession(dir, active);
  const execution = runVerificationCommand(state, {
    command: process.execPath, args: ['-e', 'const end = Date.now() + 1000; while (Date.now() < end) {}'], cwd: dir,
  }, active.sessionId, { timeoutMs: 200 });
  assert.equal(execution.result.error?.code, 'ETIMEDOUT');
  assert.equal(execution.timedOut, true);
  assert.ok(execution.timeoutMs <= 200);
});

test('ordinary command failure still stops verification and blocks an unchanged repeat', () => {
  const dir = fixture();
  ageSession(dir);
  write(dir, 'probe.test.mjs', 'throw new Error("fixture failure");');
  const selection = ['--profile', 'focused', '--test', 'probe.test.mjs', '--test', 'packages/canonical-contracts/a.test.mjs'];
  fail(script(dir, 'verify', ...selection), /Verification failed/);
  assert.equal(events(dir).filter(event => event.phase === 'attempt').length, 1);
  assert.equal(events(dir).find(event => event.phase === 'result').status, 'failed');
  assert.equal(existsSync(path.join(dir, '.artifacts/pids')), false);
  fail(script(dir, 'verify', ...selection), /Repeated command/);
  assert.equal(events(dir).filter(event => event.phase === 'attempt').length, 1);
});
