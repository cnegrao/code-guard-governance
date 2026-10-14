import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  appendEvent, artifactDir, candidate, candidateSafety, cli, digest, git, mainGuard, manyOption,
  readEvents, repository, stringOption,
} from './preflight.mjs';

export const profiles = {
  focused: 'Selected checks for the current edit; no implicit suite.',
  integration: 'Selected cross-component checks after candidate-ready; no implicit suite.',
  final: 'Selected final checks once per candidate; CI remains the independent repository gate.',
};

export function verify(args) {
  const options = cli({
    profile: stringOption, base: stringOption, script: manyOption, test: manyOption,
    syntax: manyOption, hypothesis: stringOption, plan: { type: 'boolean' },
    discover: { type: 'boolean' }, help: { type: 'boolean' },
  }, args);
  if (options.help) {
    console.log('verify.mjs --profile focused|integration|final [--script <directory>:<script>] [--test <file-or-glob>] [--syntax <file.mjs>] [--plan] [--hypothesis <new-evidence>] [--base <ref>]\nverify.mjs --discover');
    return;
  }
  const state = repository(options.base);
  const tracked = git(['ls-files', '-z'], state.root).split('\0').filter(Boolean);
  const packages = tracked.filter(file => /(^|\/)package\.json$/.test(file)).map(file => ({
    directory: path.posix.dirname(file),
    scripts: JSON.parse(readFileSync(path.join(state.root, file), 'utf8')).scripts ?? {},
  }));
  if (options.discover) {
    console.log(JSON.stringify({ profiles, packages, tests: tracked.filter(file => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)), workflows: tracked.filter(file => /^\.github\/workflows\//.test(file)) }, null, 2));
    return;
  }
  if (!Object.hasOwn(profiles, options.profile)) throw new Error('Select --profile focused, integration or final');
  candidateSafety(state);
  const steps = [];
  function localFile(file) {
    const absolute = path.resolve(state.root, file);
    const relative = path.relative(state.root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(absolute)) throw new Error(`Missing or non-repository file: ${file}`);
    return absolute;
  }
  for (const file of options.syntax) {
    if (!file.endsWith('.mjs')) throw new Error('--syntax requires an existing .mjs file');
    steps.push({ label: `syntax:${file}`, command: process.execPath, args: ['--check', localFile(file)], cwd: state.root });
  }
  for (const selection of options.script) {
    const separator = selection.indexOf(':');
    const directory = selection.slice(0, separator);
    const name = selection.slice(separator + 1);
    const pkg = packages.find(item => item.directory === directory);
    if (separator < 1 || !pkg || !Object.hasOwn(pkg.scripts, name)) throw new Error(`Unknown package script: ${selection}; use --discover`);
    if (!/^(?:test|typecheck|lint|validate)(?::|$)/.test(name)) throw new Error(`Not a validation script: ${selection}`);
    // npm.cmd needs a shell on Windows. Invoke npm's JS entrypoint instead.
    const adjacent = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const npm = process.env.npm_execpath || adjacent;
    if (!existsSync(npm) || !/npm-cli\.js$/.test(npm)) throw new Error('npm-cli.js missing; provide npm_execpath to the installed npm CLI');
    steps.push({ label: selection, source: pkg.scripts[name], command: process.execPath, args: [npm, 'run', name], cwd: path.join(state.root, directory) });
  }
  const selectedTests = new Set();
  for (const pattern of options.test) {
    const files = globSync(pattern, { cwd: state.root }).sort();
    if (!files.length) throw new Error(`No test files match ${pattern}`);
    const groups = new Map();
    for (const file of files) {
      if (!/\.(?:test|spec)\.[cm]?[jt]s$/.test(file)) throw new Error(`Unsupported test file: ${file}; use its existing package script`);
      const absolute = localFile(file);
      const relative = path.relative(state.root, absolute).split(path.sep).join('/');
      if (selectedTests.has(relative)) throw new Error(`Duplicate checks selected: ${relative}`);
      selectedTests.add(relative);
      const pkg = packages.filter(item => item.directory === '.' || relative.startsWith(`${item.directory}/`))
        .sort((a, b) => b.directory.length - a.directory.length)[0];
      const flags = [];
      if (pkg.directory === 'apps/dashboard') flags.push('--conditions=react-server', '--experimental-test-module-mocks');
      if (/\.[cm]?ts$/.test(file)) flags.push('--import', 'tsx');
      if (pkg.directory === 'packages/canonical-contracts' || pkg.directory === 'packages/governance-review') flags.push('--test-isolation=none');
      const cwd = path.join(state.root, pkg.directory);
      const key = JSON.stringify([cwd, flags]);
      if (!groups.has(key)) groups.set(key, { files: [], labels: [], flags, cwd });
      const group = groups.get(key);
      group.files.push(absolute);
      group.labels.push(relative);
    }
    for (const group of groups.values()) {
      steps.push({ label: group.labels.join(', '), command: process.execPath, args: [...group.flags, '--test', ...group.files], cwd: group.cwd });
    }
  }
  if (!steps.length) throw new Error('Select checks explicitly; use --discover to inspect existing commands and files');
  if (new Set(steps.map(step => digest(JSON.stringify(step)))).size !== steps.length) throw new Error('Duplicate checks selected; run each command once');
  const plan = { profile: options.profile, behavior: profiles[options.profile], steps };
  console.log(JSON.stringify(plan, null, 2));
  if (options.plan) return;

  const fingerprint = candidate(state);
  const history = readEvents(state.root).filter(event => event.branch === state.branch && event.candidate === fingerprint);
  if (options.profile === 'final' && history.some(event => event.profile === 'final')) throw new Error('Final verification already attempted for this candidate; STOP and hand off');
  const hypothesis = options.hypothesis?.trim() || '';
  for (const step of steps) {
    const key = digest(JSON.stringify(step));
    if (history.some(event => event.key === key && event.hypothesis === hypothesis)) {
      throw new Error(`Repeated command without new evidence/hypothesis: ${step.label}`);
    }
  }
  const directory = artifactDir(state.root);
  // Record the reservation before any subprocess, including interrupted attempts.
  const run = randomUUID();
  appendEvent(state.root, { at: new Date().toISOString(), run, phase: 'start', profile: options.profile, branch: state.branch, head: state.head, base: state.base, candidate: fingerprint, hypothesis });
  for (const [index, step] of steps.entries()) {
    const event = { at: new Date().toISOString(), run, profile: options.profile, branch: state.branch, head: state.head, base: state.base, candidate: fingerprint, hypothesis, key: digest(JSON.stringify(step)), step };
    appendEvent(state.root, { ...event, phase: 'attempt' });
    const result = spawnSync(step.command, step.args, { cwd: step.cwd, encoding: 'utf8', shell: false, timeout: 30 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 });
    const log = path.join(directory, `${run}-${index}.log`);
    writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}\n` : ''}`);
    const passed = !result.error && result.status === 0;
    appendEvent(state.root, { ...event, phase: 'result', status: passed ? 'passed' : 'failed', exitCode: result.status, signal: result.signal, log: path.relative(state.root, log) });
    console.log(`${passed ? 'PASS' : 'FAIL'} ${step.label} (${path.relative(state.root, log)})`);
    if (!passed) throw new Error(`Verification failed: ${step.label}; inspect log and form a materially new hypothesis before retrying`);
  }
}

mainGuard(import.meta.url, () => verify());
