'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { AgentChainPlan, AgentChainResult, AlreadyGovernedChainItem } from '@/lib/governance/agent-chain';

export function AlreadyGovernedAgents({ items }: { items: readonly AlreadyGovernedChainItem[] }) {
  if (!items.length) return null;
  return <Card>
    <h2 className="text-lg font-semibold">Already governed (not included in decisions)</h2>
    <ul className="mt-3 space-y-3" aria-label="Already governed agent identities">{items.map(item => <li key={item.candidateId} className="break-words">
      <strong>{item.sourceName}</strong> · {item.kind}
      <p>Already governed — mapped to {item.mappedSourceName} ({item.canonicalId}) by an earlier decision</p>
      <p className="text-xs">Review state: No review (already governed)</p>
      <p className="text-xs">Source: {item.sourceId} · Earlier decision: {item.earlierDecisionId}</p>
      <p className="text-sm">This candidate is not selectable and will not be changed by this batch.</p>
    </li>)}</ul>
  </Card>;
}

export function AgentChainReview({ reviewId, canonicalId }: { reviewId?: string; canonicalId?: string }) {
  const [plan, setPlan] = useState<AgentChainPlan | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<AgentChainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (reviewId) params.set('reviewId', reviewId);
    if (canonicalId) params.set('canonicalId', canonicalId);
    setPlan(null); setError(null); setResult(null);
    void fetch(`/api/governance/workspace/agent-chain?${params}`, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to load chain.');
      if (!controller.signal.aborted) {
        setPlan(data);
        setSelected((data as AgentChainPlan).errors.length ? [] : (data as AgentChainPlan).items.filter(item => !item.needsIndividualReview).map(item => item.reviewSubjectId));
      }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load chain.'); });
    return () => controller.abort();
  }, [reviewId, canonicalId, revision]);
  const missingDependencies = plan?.items.some(item => selected.includes(item.reviewSubjectId) && item.dependencies.some(id => !selected.includes(id)));
  async function approve() {
    if (!plan || submitting.current) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch('/api/governance/workspace/agent-chain', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anchor: { reviewId, canonicalId }, previewKey: plan.previewKey, batchId: plan.batchId,
          selectedIds: selected, justification: reason }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to approve chain.');
      setResult(data);
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : 'Unable to approve chain.'} If the request was interrupted, some items may have committed. Reload the preview and inspect individual reviews before retrying.`);
    } finally { submitting.current = false; setBusy(false); }
  }
  const selectedItems = plan?.items.filter(item => selected.includes(item.reviewSubjectId)) ?? [];
  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">Review agent chain</h1>
    <p>Review each proposed reconciliation below. Your confirmation authorizes one individual decision per selected item, using your human identity and the same justification.</p>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {!plan && !error && <p role="status">Loading chain preview…</p>}
    {plan && <Card>
      <h2 className="text-lg font-semibold">Chain preview</h2>
      <p className="mt-2 text-sm">Names below are source names (not governed). Execution follows the displayed dependency order.</p>
      {plan.errors.length > 0 && <div role="alert" className="mt-4 text-red-400"><p>This preview cannot be approved.</p>
        <ul>{plan.errors.map(message => <li key={message}>{message}</li>)}</ul></div>}
      {!plan.items.length && <p className="mt-4">No pending chain items were found.</p>}
      <ol className="mt-4 space-y-4" aria-label="Agent chain execution order">
        {plan.items.map((item, index) => <li key={item.reviewSubjectId} className="rounded border border-border-dark p-3 break-words">
          <label className="flex gap-3 items-start">
            <input type="checkbox" aria-label={`Include ${item.sourceName}`} checked={selected.includes(item.reviewSubjectId)}
              disabled={busy || !!result || !!item.needsIndividualReview} onChange={event => setSelected(previous => event.target.checked
                ? [...previous, item.reviewSubjectId] : previous.filter(id => id !== item.reviewSubjectId))} />
            <span><strong>{index + 1}. {item.sourceName}</strong> · {item.kind}<br />{item.outcome.replaceAll('_', ' ')}
              {item.match && <span> — {item.match.label} ({item.match.id})</span>}</span>
          </label>
          <p className="mt-2 text-xs text-gray-400">Source: {item.sourceId} · Review state: {item.state ?? 'No review'}</p>
          {item.needsIndividualReview && <p className="mt-2 text-amber-300">Needs individual review: {item.needsIndividualReview}</p>}
          {item.dependencies.length > 0 && <p className="mt-2 text-xs">Requires pending reviews: {(item.dependencyLabels ?? item.dependencies).join(', ')}</p>}
          {!item.reviewSubjectId.startsWith('missing:') && <Link className="mt-2 inline-block text-primary underline" href={`/governance/reviews/${encodeURIComponent(item.reviewSubjectId)}`}>Inspect individual review</Link>}
        </li>)}
      </ol>
      <p className="mt-4 text-sm">Selected execution: {selectedItems.map(item => item.sourceName).join(' → ') || 'None'}</p>
      <label className="mt-4 block" htmlFor="chain-justification">Justification for this chain</label>
      <textarea id="chain-justification" required maxLength={4000} value={reason} disabled={busy || !!result}
        onChange={event => setReason(event.target.value)} className="mt-2 w-full rounded border border-border-dark bg-surface-dark p-3" rows={4} />
      {missingDependencies && <p role="alert" className="mt-2 text-amber-300">Select every pending dependency or deselect its dependent items.</p>}
      <p className="mt-3 text-sm">Stops at the first error. Completed writes remain recorded. Batch: {plan.batchId}</p>
      <Button className="mt-4" disabled={busy || !!result || !!plan.errors.length || !selected.length || !reason.trim() || !!missingDependencies} onClick={() => void approve()}>
        {busy ? 'Applying governed decisions…' : `Confirm ${selected.length} individual decisions`}
      </Button>
    </Card>}
    {plan && <AlreadyGovernedAgents items={plan.alreadyGoverned} />}
    {plan && plan.superseded.length > 0 && <Card>
      <h2 className="text-lg font-semibold">Superseded by newer discovery run (not included)</h2>
      <p className="mt-2 text-sm">These earlier proposals are not selectable and will not be changed by this batch.</p>
      <ul className="mt-3 space-y-3" aria-label="Superseded discovery proposals">{plan.superseded.map(item => <li key={item.candidateId} className="break-words">
        <strong>{item.sourceName}</strong> · {item.kind}<p className="text-xs">Source: {item.sourceId}</p>
        <p className="text-xs">Discovery run: {item.runId}{item.sourceVersion ? ` · ${item.sourceVersion}` : ''}</p>
        <p className="text-xs">Superseded by run: {item.newerRunId}{item.newerSourceVersion ? ` · ${item.newerSourceVersion}` : ''}</p>
      </li>)}</ul>
    </Card>}
    {result && <Card>
      <h2 className="text-lg font-semibold">Batch result</h2>
      <p>Batch: {result.batchId}</p>
      <ol className="mt-3 space-y-3" aria-label="Agent chain results">{result.items.map(item => <li key={item.reviewSubjectId}>
        <Link className="text-primary underline break-all" href={`/governance/reviews/${encodeURIComponent(item.reviewSubjectId)}`}>{plan?.items.find(i => i.reviewSubjectId === item.reviewSubjectId)?.sourceName ?? item.reviewSubjectId}</Link>
        <p>{item.status === 'NOT_RUN' ? 'NOT MATERIALIZED — not run' : item.status === 'FAILED' ? 'NOT MATERIALIZED — failed' : item.status === 'UNKNOWN' ? 'MATERIALIZATION UNKNOWN — inspect individual review' : 'MATERIALIZED'}</p>
        <p>Completed steps: {item.completedSteps.join(', ') || 'None'}{item.failedStep ? ` · Stopped at ${item.failedStep}` : ''}</p>
        {item.error && <p role="alert">{item.error}</p>}
        {item.decisionId && <p className="break-all">Decision: {item.decisionId}</p>}
        {item.canonicalId && <p className="break-all">Canonical result: {item.canonicalId}</p>}
      </li>)}</ol>
    </Card>}
    <Button disabled={busy} onClick={() => { setReason(''); setRevision(value => value + 1); }}>Reload preview</Button>
    <Link className="ml-4 text-primary underline" href="/governance/reviews">Review queue</Link>
  </div>;
}
