import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { newSession } from './budget.mjs';

export function git(args, cwd = process.cwd()) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr.trim() || 'Git failed');
  }
  return result.stdout.trimEnd();
}

export function node24() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node major version 24 required');
}

export function cli(options, args = process.argv.slice(2)) {
  return parseArgs({ args, options, strict: true, allowPositionals: false }).values;
}

export const stringOption = { type: 'string' };
export const manyOption = { type: 'string', multiple: true, default: [] };

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function repository(baseRef = 'origin/main') {
  node24();
  const root = git(['rev-parse', '--show-toplevel']);
  const remote = git(['remote', 'get-url', 'origin'], root);
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)cnegrao\/code-guard-governance(?:\.git)?\/?$/.test(remote)) {
    throw new Error(`origin must be cnegrao/code-guard-governance; got ${remote}`);
  }
  const base = git(['rev-parse', '--verify', `${baseRef}^{commit}`], root);
  git(['merge-base', '--is-ancestor', base, 'HEAD'], root);
  return {
    root, remote, base,
    branch: git(['branch', '--show-current'], root),
    head: git(['rev-parse', 'HEAD'], root),
    status: git(['status', '--porcelain=v1', '--untracked-files=all'], root),
  };
}

export function changedFiles(state) {
  return [...new Set([
    ...git(['diff', '--no-renames', '--name-only', '-z', state.base, '--'], state.root).split('\0'),
    ...git(['diff', '--cached', '--no-renames', '--name-only', '-z', state.base, '--'], state.root).split('\0'),
    ...git(['ls-files', '--others', '--exclude-standard', '-z'], state.root).split('\0'),
  ].filter(Boolean))].sort();
}

// Candidate safety is independent of worktree cleanliness and applies at every gate.
export function candidateSafety(state) {
  const files = changedFiles(state);
  const migrationEntries = git(['ls-tree', '-r', '-z', state.base], state.root).split('\0')
    .filter(entry => /(^|\/)migrations\//i.test(entry.split('\t')[1] || ''));
  const historical = new Set(migrationEntries.map(entry => entry.split('\t')[1]));
  const violations = [];
  const touchedHistory = files.filter(file => historical.has(file));
  if (touchedHistory.length) violations.push(`Historical migration changes: ${touchedHistory.join(', ')}`);
  const protectedFiles = files.filter(file => /(^|\/)(?:\.github\/workflows\/|\.vercel(?:\/|$)|\.env(?:[./]|$)|vercel\.json$|netlify\.toml$|supabase\/config\.toml$|(?:deploy|deployment|deployments|infra|terraform)(?:\/|[.-]))/i.test(file));
  if (protectedFiles.length) violations.push(`Review hosted/deployment scope before proceeding: ${protectedFiles.join(', ')}`);
  if (violations.length) throw new Error(violations.join('\n'));
  return {
    filesChanged: files,
    migrationBaseline: { count: historical.size, treeSha256: digest(migrationEntries.join('\0')) },
  };
}

export function candidate(state) {
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], state.root)
    .split('\0').filter(Boolean).sort().map(file => [file, digest(readFileSync(path.join(state.root, file)))]);
  return digest(JSON.stringify([state.head, git(['diff', '--binary', 'HEAD', '--'], state.root), untracked]));
}

export function artifactDir(root) {
  // Fail closed rather than creating visible session files in an unconfigured repo.
  git(['check-ignore', '-q', '--', '.artifacts/agent/probe'], root);
  const directory = path.join(root, '.artifacts', 'agent');
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function writeJson(root, name, value) {
  writeFileSync(path.join(artifactDir(root), name), `${JSON.stringify(value, null, 2)}\n`);
}

export function appendEvent(root, event) {
  appendFileSync(path.join(artifactDir(root), 'verification.jsonl'), `${JSON.stringify(event)}\n`);
}

export function readEvents(root) {
  try {
    return readFileSync(path.join(root, '.artifacts', 'agent', 'verification.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function mainGuard(url, main) {
  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url)) {
    try { main(); } catch (error) { console.error(`STOP: ${error.message}`); process.exitCode = 1; }
  }
}

export function preflight(args) {
  const startedAt = Date.now();
  const options = cli({
    'expected-base': stringOption, base: stringOption, branch: stringOption,
    'budget-minutes': stringOption, objective: stringOption,
    scope: { type: 'string', default: 'local' }, help: { type: 'boolean' },
  }, args);
  if (options.help) {
    console.log('preflight.mjs --budget-minutes <positive-integer> [--objective <text>] [--expected-base <full-sha>] [--base <ref>] [--branch <name>] [--scope local]\n--budget-minutes declares an informative active-work target, not a wall-clock timeout.');
    return;
  }
  const state = repository(options.base);
  const session = newSession(state, options['budget-minutes'], options.objective, startedAt);
  const violations = [];
  if (options.scope !== 'local') violations.push('Hosted/deployment scope requires STOP and explicit authorization outside this framework');
  if (!state.branch || ['main', 'master'].includes(state.branch)) violations.push('Implementation requires a named non-main branch');
  if (options.branch && state.branch !== options.branch) violations.push(`Expected branch ${options.branch}; got ${state.branch}`);
  if (options['expected-base'] && state.base !== options['expected-base']) violations.push(`Expected base ${options['expected-base']}; got ${state.base}`);
  if (state.status) violations.push('Worktree must be clean (including index and untracked files)');

  // Failed preflight must still work before .artifacts is configured.
  if (violations.length) throw new Error(violations.join('\n'));
  const report = { phase: 'preflight', at: session.startedAt, sessionId: session.sessionId, ...state, ...candidateSafety(state), violations };
  // Only a successful, explicit preflight creates/replaces the session and its target.
  writeJson(state.root, 'session.json', session);
  writeJson(state.root, 'preflight.json', report);
  console.log(JSON.stringify(report, null, 2));
}

mainGuard(import.meta.url, () => preflight());
