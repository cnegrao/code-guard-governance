'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import type { FieldReviewContext } from '@council/governance-review';
import type { FieldAuthorityPolicy,FieldDecisionOutcome,FieldReconciliationDecision } from '@council/canonical-contracts';
type Item=FieldReviewContext & {comparison:{status:string;conflictId?:string};policy?:FieldAuthorityPolicy;isCurrentSource:boolean;decisions:FieldReconciliationDecision[]};
export default function TechnicalFieldReviews() {
  const [items,setItems]=useState<Item[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function load() { const response=await fetch('/api/governance/workspace/technical-facts'); if (!response.ok) throw new Error('Unable to load field reviews.'); setItems(await response.json()); }
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function decide(item:Item,outcome:FieldDecisionOutcome) {
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/governance/workspace/technical-facts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        decisionId:crypto.randomUUID(),canonicalObject:item.canonicalObjects[0],field:item.proposal.fact.field,proposalId:item.proposal.proposalId,
        observationIds:item.observations.map(o=>o.observationId).sort(),expectedSourceObservationId:item.currentSourceObservationId,
        expectedSourceSnapshotId:item.currentSourceSnapshotId,
        ...(item.current ? {expectedCurrentStateId:item.current.stateId}:{}),...(item.policy ? {policyId:item.policy.policyId,policyVersion:item.policy.version}:{}),outcome})});
      if (!response.ok) throw new Error((await response.json()).error);
      await load();
    } catch(e) {setError(e instanceof Error?e.message:'Unable to record decision.');} finally {setBusy(false);}
  }
  return <main className="space-y-6 p-6 text-gray-100"><Link href="/governance/reviews">Object reviews</Link>
    <h1 className="text-2xl font-semibold">Technical field reviews</h1>
    <p>Review source values and their authority before changing governed technical metadata.</p>
    {error&&<p role="alert" className="text-red-400">{error}</p>}
    {!items.length&&!error&&<p>No imported field proposals.</p>}
    {items.map(item=><article key={item.proposal.proposalId} className="rounded border border-gray-700 p-4 space-y-2">
      <h2 className="font-semibold">{item.proposal.fact.objectKind} · {item.proposal.fact.field}</h2>
      <p className="break-all">Source: {item.proposal.sourceSystem.displayName} · {item.proposal.sourceObject.externalId}</p>
      <p>Proposed: {item.proposal.fact.value} · {item.proposal.trustState}</p>
      <p>Governed: {item.current?.fact.value??'UNKNOWN'} · {item.comparison.status}</p>
      <p>Field authority: {item.policy?.disposition??'No configured policy'}</p>
      {!item.isCurrentSource&&<p>A newer source observation requires a new review.</p>}
      <details><summary>{item.observations.length} source observations and evidence</summary>
        {item.observations.map(o=><p key={o.observationId} className="break-all">{o.observedAt} · Assertions: {o.support.assertionIds.join(', ')} · Evidence: {o.support.evidenceIds.join(', ')}</p>)}
        {item.current&&<p className="break-all">Current decision: {item.current.decisionId}; previous state: {item.current.previousStateId??'none'}</p>}
        {item.decisions.map(d=><p key={d.decisionId}>{d.decidedAt} · {d.outcome} · {d.actor.authorityKind==='HUMAN'?d.actor.actorReference:d.actor.ruleCode}</p>)}
      </details>
      {item.canonicalObjects.length===1&&item.isCurrentSource&&<div className="flex gap-3 flex-wrap">
        {(['ACCEPT_PROPOSED','KEEP_CURRENT','DEFER','REJECT_PROPOSED'] as const).map(outcome=><button className="border rounded px-3 py-2 disabled:opacity-40" key={outcome}
          disabled={busy||(outcome==='ACCEPT_PROPOSED'&&(!item.policy||item.policy.disposition==='NON_AUTHORITATIVE'))||(outcome==='KEEP_CURRENT'&&!item.current)} onClick={()=>decide(item,outcome)}>
          {{ACCEPT_PROPOSED:'Accept proposed',KEEP_CURRENT:'Keep current',DEFER:'Defer',REJECT_PROPOSED:'Reject proposed'}[outcome]}</button>)}
      </div>}
    </article>)}
  </main>;
}
