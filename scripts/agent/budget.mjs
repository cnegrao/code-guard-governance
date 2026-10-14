import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function newSession(state, budget, objective, startedAt = Date.now()) {
  if (!/^[1-9]\d*$/.test(budget ?? '') || !Number.isSafeInteger(Number(budget))) {
    throw new Error('--budget-minutes must be a positive integer; explicit preflight is required for every implementation session');
  }
  const deadline = startedAt + Number(budget) * 60_000;
  if (!Number.isSafeInteger(deadline) || deadline > 8.64e15) throw new Error('Session budget is too large');
  return {
    sessionId: randomUUID(), objective: objective?.trim() || null,
    branch: state.branch, base: state.base, headAtStart: state.head,
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
    || deadline - started !== session.budgetMinutes * 60_000 || started > now) {
    throw new Error('Invalid active session; run explicit preflight with --budget-minutes');
  }
  if (session.branch !== state.branch || session.base !== state.base) throw new Error('Session branch/base mismatch; run explicit preflight');
  if (sessionId && session.sessionId !== sessionId) throw new Error('Active session changed during verification; STOP');
  return {
    session, elapsedMs: now - started, remainingMs: Math.max(0, deadline - now),
    budgetExceeded: now >= deadline, budgetStatus: now >= deadline ? 'EXHAUSTED' : 'OK',
  };
}

export function requireBudget(budget) {
  if (budget.budgetExceeded) throw new Error('Session budget exhausted; STOP and hand off. A new budget requires explicit preflight');
  return budget;
}

export function runBudgetedCommand(state, step, sessionId, { now = Date.now, spawn = spawnSync } = {}) {
  const budget = requireBudget(readBudget(state, now(), sessionId));
  const started = now();
  const remainingMs = Date.parse(budget.session.deadlineAt) - started;
  requireBudget({ budgetExceeded: remainingMs <= 0 });
  const timeout = Math.min(30 * 60_000, remainingMs);
  const result = spawn(step.command, step.args, {
    cwd: step.cwd, encoding: 'utf8', shell: false, timeout,
    killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024,
  });
  const ended = now();
  const exhausted = ended >= Date.parse(budget.session.deadlineAt)
    || (result.error?.code === 'ETIMEDOUT' && timeout === remainingMs);
  return { result, timeoutMs: timeout, startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(), durationMs: Math.max(0, ended - started), exhausted };
}

export function timingReport(budget, events) {
  const current = events.filter(event => event.sessionId === budget.session.sessionId);
  const starts = current.filter(event => event.phase === 'start').map(event => Date.parse(event.at)).filter(Number.isFinite);
  const results = current.filter(event => event.phase === 'result');
  const verificationMs = { focused: 0, integration: 0, final: 0 };
  for (const result of results) {
    if (Object.hasOwn(verificationMs, result.profile) && Number.isFinite(result.durationMs)) verificationMs[result.profile] += result.durationMs;
  }
  const incomplete = current.some(event => event.phase === 'attempt'
    && !results.some(result => result.run === event.run && result.key === event.key));
  const exhausted = budget.budgetExceeded || current.some(event => event.status === 'budget-exhausted');
  return {
    sessionId: budget.session.sessionId, startedAt: budget.session.startedAt,
    preflightStartedAt: budget.session.startedAt, deadlineAt: budget.session.deadlineAt,
    elapsedMs: budget.elapsedMs, budgetMinutes: budget.session.budgetMinutes, remainingMs: budget.remainingMs,
    firstVerificationAt: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    implementationExplorationMs: starts.length ? Math.min(...starts) - Date.parse(budget.session.startedAt) : null,
    implementationExplorationNote: 'Approximation: preflight start to first verification, including preflight and idle time; null until verification starts.',
    verificationMs, totalVerificationMs: Object.values(verificationMs).reduce((sum, ms) => sum + ms, 0),
    verificationDurationNote: incomplete
      ? 'Approximation / lower bound: completed subprocess durations only; interrupted attempts have unknown duration.'
      : 'Recorded subprocess wall-clock durations; excludes runner overhead and external validation.',
    budgetExceeded: exhausted, budgetStatus: exhausted ? 'EXHAUSTED' : 'OK',
  };
}
