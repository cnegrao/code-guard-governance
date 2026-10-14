import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const COMMAND_TIMEOUT_MS = 30 * 60_000;

export function newSession(state, budget, objective, startedAt = Date.now()) {
  if (!/^[1-9]\d*$/.test(budget ?? '') || !Number.isSafeInteger(Number(budget))) {
    throw new Error('--budget-minutes must be a positive integer; explicit preflight is required for every implementation session');
  }
  const deadline = startedAt + Number(budget) * 60_000;
  if (!Number.isSafeInteger(deadline) || deadline > 8.64e15) throw new Error('Session budget target is too large');
  return {
    sessionId: randomUUID(), objective: objective?.trim() || null,
    branch: state.branch, base: state.base, headAtStart: state.head,
    // Keep the existing CLI/storage names; these are an operational target only.
    startedAt: new Date(startedAt).toISOString(), budgetMinutes: Number(budget),
    deadlineAt: new Date(deadline).toISOString(),
  };
}

// This file is local timing evidence only. The caller supplies authoritative Git state.
export function readBudget(state, now = Date.now(), sessionId) {
  let session;
  try {
    session = JSON.parse(readFileSync(path.join(state.root, '.artifacts/agent/session.json'), 'utf8'));
  } catch (error) {
    throw new Error(`Active session missing or unreadable; run explicit preflight with --budget-minutes (${error.message})`);
  }
  const started = Date.parse(session?.startedAt);
  const deadline = Date.parse(session?.deadlineAt);
  if (!session?.sessionId || !session.headAtStart || !Number.isSafeInteger(session.budgetMinutes)
    || session.budgetMinutes <= 0 || !Number.isFinite(started) || !Number.isFinite(deadline)
    || deadline - started !== session.budgetMinutes * 60_000) {
    throw new Error('Invalid active session; run explicit preflight with --budget-minutes');
  }
  if (session.branch !== state.branch || session.base !== state.base) throw new Error('Session branch/base mismatch; run explicit preflight');
  if (sessionId && session.sessionId !== sessionId) throw new Error('Active session changed during verification; STOP');
  return {
    session, elapsedWallClockMs: now - started,
  };
}

export function runVerificationCommand(state, step, sessionId, {
  now = Date.now, monotonic = () => performance.now(), spawn = spawnSync, timeoutMs = COMMAND_TIMEOUT_MS,
} = {}) {
  readBudget(state, now(), sessionId);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Command timeout must be a positive integer');
  const timeout = Math.min(COMMAND_TIMEOUT_MS, timeoutMs);
  const started = now();
  const executionStarted = monotonic();
  const result = spawn(step.command, step.args, {
    cwd: step.cwd, encoding: 'utf8', shell: false, timeout,
    killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024,
  });
  const durationMs = monotonic() - executionStarted;
  const ended = now();
  return { result, timeoutMs: timeout, startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(), durationMs, timedOut: result.error?.code === 'ETIMEDOUT' };
}

export function timingReport(budget, events, reportedWorkingTime) {
  const current = events.filter(event => event.sessionId === budget.session.sessionId);
  const starts = current.filter(event => event.phase === 'start').map(event => Date.parse(event.at)).filter(Number.isFinite);
  const results = current.filter(event => event.phase === 'result');
  const verificationMs = { focused: 0, integration: 0, final: 0 };
  for (const result of results) {
    if (Object.hasOwn(verificationMs, result.profile) && Number.isFinite(result.durationMs)) verificationMs[result.profile] += result.durationMs;
  }
  const incomplete = current.some(event => event.phase === 'attempt'
    && !results.some(result => result.run === event.run && result.key === event.key));
  return {
    sessionId: budget.session.sessionId,
    wallClock: {
      startedAt: budget.session.startedAt, elapsedMs: budget.elapsedWallClockMs,
      firstVerificationAt: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
      untilFirstVerificationMs: starts.length ? Math.min(...starts) - Date.parse(budget.session.startedAt) : null,
      note: 'Diagnostic only: wall-clock time may include user/approval idle time. It is not active-agent time or a reason to STOP. The interval to first verification is not measured reasoning/exploration time.',
    },
    measuredExecution: {
      verificationMs, totalVerificationMs: Object.values(verificationMs).reduce((sum, ms) => sum + ms, 0),
      note: incomplete
        ? 'Exact recorded command durations; total is a lower-bound approximation because interrupted attempts have unknown duration.'
        : 'Exact recorded command durations; excludes runner overhead and external validation. New commands use a monotonic clock.',
    },
    operationalTarget: { minutes: budget.session.budgetMinutes, status: 'INFORMATIVE', targetAt: budget.session.deadlineAt },
    reportedWorkingTime: reportedWorkingTime?.trim() || null,
  };
}
