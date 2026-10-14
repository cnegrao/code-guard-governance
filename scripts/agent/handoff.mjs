import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  artifactDir, candidate, candidateSafety, cli, mainGuard, manyOption,
  readEvents, repository, stringOption, writeJson,
} from './preflight.mjs';
import { readBudget, timingReport } from './budget.mjs';

export function handoff(args) {
  const options = cli({
    objective: stringOption, base: stringOption, 'next-action': stringOption, 'reported-working-time': stringOption,
    blocker: manyOption, 'stop-reason': stringOption, attempt: manyOption,
    validation: manyOption, phase: { type: 'string', default: 'handoff' }, help: { type: 'boolean' },
  }, args);
  if (options.help) {
    console.log('handoff.mjs --objective <text> --next-action <text> [--base <ref>] [--phase <phase>] [--blocker <text>] [--stop-reason <text>] [--attempt <text>] [--validation <external-command-and-result>] [--reported-working-time <text>]');
    return;
  }
  if (!options.objective?.trim() || !options['next-action']?.trim()) throw new Error('--objective and --next-action are required');
  const state = repository(options.base);
  const safety = candidateSafety(state);
  const fingerprint = candidate(state);
  const events = readEvents(state.root).filter(event => event.branch === state.branch && event.base === state.base);
  const attempts = events.filter(event => event.phase === 'attempt');
  const results = events.filter(event => event.phase === 'result').map(event => ({
    ...event, currentCandidate: event.candidate === fingerprint,
  }));
  const interrupted = attempts.filter(attempt => !results.some(result => result.run === attempt.run && result.key === attempt.key));
  const timing = timingReport(readBudget(state), events, options['reported-working-time']);
  const stopReason = options['stop-reason'] || null;
  const { wallClock, measuredExecution, operationalTarget } = timing;
  const report = {
    objective: options.objective, phase: options.phase, at: new Date().toISOString(),
    branch: state.branch, head: state.head, base: state.base, candidate: fingerprint,
    changedFiles: safety.filesChanged, worktree: state.status || 'clean',
    validation: results, externalValidation: options.validation,
    attempts: { recorded: attempts.length, interrupted: interrupted.map(event => event.step.label), notes: options.attempt },
    timing, blockers: options.blocker, stopReason, nextAction: options['next-action'],
  };
  const lines = [
    '# Agent handoff', '', `Objective: ${report.objective}`, `Phase: ${report.phase}`,
    `Branch: ${report.branch}`, `HEAD: ${report.head}`, `Base: ${report.base}`,
    `Worktree: ${report.worktree}`, '', '## Timing', '',
    `Wall clock: started ${wallClock.startedAt}; elapsed ${wallClock.elapsedMs} ms`, wallClock.note,
    `First verification: ${wallClock.firstVerificationAt ?? 'not recorded'}; interval from preflight: ${wallClock.untilFirstVerificationMs ?? 'not recorded'} ms`,
    `Measured execution: focused ${measuredExecution.verificationMs.focused} ms; integration ${measuredExecution.verificationMs.integration} ms; final ${measuredExecution.verificationMs.final} ms; total ${measuredExecution.totalVerificationMs} ms`,
    measuredExecution.note,
    `Operational target: ${operationalTarget.minutes} minutes; status: ${operationalTarget.status}; diagnostic target timestamp: ${operationalTarget.targetAt}`,
    `Reported working time (explicit input): ${timing.reportedWorkingTime ?? 'not supplied'}`, '', 'Changed files:',
    ...report.changedFiles.map(file => `- ${file}`), '', 'Validation:',
    ...results.map(result => `- ${result.profile}: ${result.step.label}: ${result.status} (${result.currentCandidate ? 'current candidate' : `earlier candidate ${result.candidate.slice(0, 12)}`}); ${result.log}`),
    ...options.validation.map(note => `- External: ${note}`),
    ...(results.length || options.validation.length ? [] : ['- None recorded']), '',
    `Attempts: ${attempts.length}; interrupted: ${interrupted.length}`,
    ...options.attempt.map(note => `- ${note}`),
    `Blockers: ${options.blocker.join('; ') || 'none reported'}`,
    `STOP reason: ${report.stopReason || 'none'}`, `Next action: ${report.nextAction}`, '',
  ];
  writeJson(state.root, 'handoff.json', report);
  const markdown = lines.join('\n');
  writeFileSync(path.join(artifactDir(state.root), 'handoff.md'), markdown);
  console.log(markdown);
}

mainGuard(import.meta.url, () => handoff());
