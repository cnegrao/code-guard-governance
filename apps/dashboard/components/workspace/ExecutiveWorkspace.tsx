import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { executiveSubjectHref, type ExecutiveAttention, type ExecutiveModel, type RiskOrdering } from '@/lib/workspace/executive-model';

function State({ children }: { children: string }) {
  const warning = ['CRITICAL', 'HIGH', 'NOT_SATISFIED', 'INSUFFICIENT_EVIDENCE', 'SUPPORT_DEGRADED', 'GAP'].includes(children);
  return <Badge variant={warning ? 'proposed' : 'detected'}>{children}</Badge>;
}

function Section({ id, title, description, children, aside }: {
  id: string; title: string; description: string; children: ReactNode; aside?: ReactNode;
}) {
  return <section id={id} aria-labelledby={`${id}-title`} className="min-w-0 scroll-mt-6">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h2 id={`${id}-title`} className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-400">{description}</p></div>
      {aside}
    </div>
    {children}
  </section>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border-dark p-5 text-sm leading-relaxed text-gray-400">{children}</p>;
}

function Metric({ label, value, children }: { label: string; value: number | null; children: ReactNode }) {
  return <div className="min-w-0 py-5 sm:px-5">
    <dt className="text-sm text-gray-400">{label}</dt>
    <dd className={`mt-2 font-semibold tracking-tight ${value === null ? 'text-lg text-gray-300' : 'text-3xl text-white'}`}>{value ?? 'UNKNOWN'}</dd>
    <dd className="mt-2 text-xs leading-relaxed text-gray-400">{children}</dd>
  </div>;
}

function PageNav({ m, anchor, label }: { m: ExecutiveModel; anchor: string; label: string }) {
  if (!m.pageCount || m.pageCount < 2) return null;
  return <nav aria-label={`Agent scope pages · ${label}`} className="mt-3 flex flex-wrap items-center gap-4 text-sm">
    {m.page > 1 && <Link className="text-gray-200 underline" href={`/workspace?page=${m.page - 1}#${anchor}`}>← Previous Agents</Link>}
    <span className="text-gray-400">Page {m.page} / {m.pageCount}</span>
    {m.page < m.pageCount && <Link className="text-gray-200 underline" href={`/workspace?page=${m.page + 1}#${anchor}`}>Next Agents →</Link>}
  </nav>;
}

const scopeLabel = (m: ExecutiveModel) => m.agentCount === null
  ? `Page scope: UNKNOWN · canonical Agent population ${m.identityFailure === 'UNAVAILABLE' ? 'unavailable' : 'withheld after an integrity failure'}`
  : m.agentCount === 0 ? 'Page scope: no canonical Agents returned'
  : `Page scope · page ${m.page} of ${m.pageCount} · Agents ${m.pageFirst}–${m.pageLast} of ${m.agentCount}, in canonical ID order`;

/** Every local evaluation names its page and Agent coverage; nothing here is an organisation-wide conclusion. */
function PageScope({ m, anchor, label, children }: { m: ExecutiveModel; anchor: string; label: string; children: ReactNode }) {
  return <div className="mb-4 border-l-2 border-border-dark pl-4 text-xs leading-relaxed text-gray-400">
    <p className="font-medium text-gray-300">{scopeLabel(m)}</p>
    {children}
    {m.agentCount !== null && m.pageCount !== null && m.pageCount > 1 && <p className="mt-1">Agents on other pages ({m.agentCount - m.subjects.length}) have not been evaluated in this view.</p>}
    <PageNav m={m} anchor={anchor} label={label} />
  </div>;
}

const pageNotEvaluated = (m: ExecutiveModel) => m.pageCount !== null && m.pageCount > 1 ? ' Other pages have not been evaluated in this view.' : '';
const failedReads = (m: ExecutiveModel) => m.failedRiskReads + m.failedControlReads
  ? ' Some reads on this page are unavailable or withheld; attention for the affected Agents is UNKNOWN.' : '';
const NOT_ORG_WIDE = ' This is not an organisation-wide all-clear; decision requests remain UNKNOWN.';

/** Empty attention never reads as clear unless every Agent on the page has current risk and control information. */
function attentionEmpty(m: ExecutiveModel) {
  const n = m.subjects.length;
  switch (m.attentionCoverage) {
    case 'POPULATION_UNKNOWN': return 'Attention not evaluated: the canonical Agent population is UNKNOWN.';
    case 'NO_AGENTS': return 'Attention not evaluated: no canonical Agents were returned.';
    case 'NO_GOVERNED_INFORMATION': return `Insufficient governed information: attention is UNKNOWN for the ${n} Agents on this page. No current open risk state and no control applicability was available for any of them (risk reads succeeded for ${m.riskEvaluatedSubjects} of ${n}, control reads for ${m.controlEvaluatedSubjects} of ${n}). An empty list here is not a clean result.${failedReads(m)}${pageNotEvaluated(m)}`;
    case 'PARTIAL': return `No attention items observed within the evaluated scope: current open risk states for ${m.riskCoverage.openObserved} of ${n} Agents and control applicability for ${m.controlCoverage.applicabilityReturned} of ${n}. Attention remains UNKNOWN for ${m.unknownRiskSubjects} Agents without a current risk observation and ${m.unknownControlSubjects} without control applicability.${failedReads(m)}${pageNotEvaluated(m)}${NOT_ORG_WIDE}`;
    case 'EVALUATED': return `No attention items observed among the ${n} Agents on this page.${pageNotEvaluated(m)}${NOT_ORG_WIDE}`;
  }
}

/** A failed read is UNKNOWN, never an absence; a successful empty read is an absence of returned states only. */
function risksEmpty(m: ExecutiveModel) {
  const n = m.subjects.length, rc = m.riskCoverage;
  if (m.agentCount === null) return 'Priority risks not evaluated: the canonical Agent population is UNKNOWN. Open risk states: UNKNOWN.';
  if (!n) return 'Priority risks not evaluated: no canonical Agents were returned. Open risk states: UNKNOWN.';
  if (!m.riskEvaluatedSubjects) return `Open risk states: UNKNOWN. No risk read succeeded for the ${n} Agents on this page (unavailable ${rc.unavailable} · withheld after an integrity failure ${rc.withheld}). An empty list here does not show that no risks exist.`;
  const scope = m.riskEvaluatedSubjects < n ? `the ${m.riskEvaluatedSubjects} of ${n} Agents whose risk reads succeeded` : `the ${n} Agents on this page`;
  return `No open governed risk states were returned for ${scope}.${rc.closedOnly ? ` ${rc.closedOnly} of them have only CLOSED (historical) states, which are not current.` : ''}${m.failedRiskReads ? ` Risk reads for ${m.failedRiskReads} Agents are unavailable or withheld; their open risk states are UNKNOWN.` : ''}${pageNotEvaluated(m)} Returned absence does not show that no risks exist: current-risk coverage for these Agents, ratings and treatment coverage remain UNKNOWN.`;
}

function controlsEmpty(m: ExecutiveModel) {
  const n = m.subjects.length, cc = m.controlCoverage;
  if (m.agentCount === null) return 'Controls not evaluated: the canonical Agent population is UNKNOWN. Applicable controls and assessment coverage: UNKNOWN.';
  if (!n) return 'Controls not evaluated: no canonical Agents were returned. Applicable controls and assessment coverage: UNKNOWN.';
  if (!m.controlEvaluatedSubjects) return `Applicable controls and assessment coverage: UNKNOWN. No control read succeeded for the ${n} Agents on this page (unavailable ${cc.unavailable} · withheld after an integrity failure ${cc.withheld}).`;
  const scope = m.controlEvaluatedSubjects < n ? `the ${m.controlEvaluatedSubjects} of ${n} Agents whose control reads succeeded` : `the ${n} Agents on this page`;
  return `Applicable controls and assessment coverage: UNKNOWN. No current governed control applicability was returned for ${scope}.${m.failedControlReads ? ` Control reads for ${m.failedControlReads} Agents are unavailable or withheld; their control states are UNKNOWN.` : ''}${pageNotEvaluated(m)}`;
}

const KIND_LABEL: Record<ExecutiveAttention['kind'], string> = {
  RECORDED_STATE: 'RECORDED STATE', ASSESSMENT_GAP: 'ASSESSMENT GAP', EVIDENCE_GAP: 'EVIDENCE GAP',
};

function AttentionList({ title, items }: { title: string; items: readonly ExecutiveAttention[] }) {
  if (!items.length) return null;
  return <div>
    <h3 className="border-b border-border-dark/60 px-5 py-3 text-xs font-medium uppercase tracking-wider text-gray-400">{title} · {items.length}</h3>
    <ul className="divide-y divide-border-dark/60">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="min-w-0 flex-1"><p className="text-sm font-medium text-white">{item.title} <Badge variant={item.kind === 'RECORDED_STATE' ? 'proposed' : 'detected'}>{KIND_LABEL[item.kind]}</Badge></p>
        <p className="mt-1 break-all text-xs text-gray-400">AGENT {item.subjectId} · {item.basis}</p></div>
      <Link className="shrink-0 text-sm text-gray-200 underline underline-offset-4" href={executiveSubjectHref(item.subjectId, item.section)}>Inspect basis →</Link>
    </li>)}</ul>
  </div>;
}

const orderingLabel = (o: RiskOrdering) => o.basis === 'CURRENT_RESIDUAL' ? `current residual ${o.band} (recorded)`
  : o.basis === 'INHERENT' ? `inherent ${o.band} (recorded; no current residual band)` : 'UNRATED · no recorded band';
const acceptanceLabel = (lifecycle: string) => lifecycle === 'RESIDUAL_ACCEPTED' ? 'Residual accepted (recorded acceptance; the risk remains open)'
  : lifecycle === 'RESIDUAL_ASSESSED' ? 'Residual assessed · no current acceptance recorded' : 'No current residual assessment or acceptance recorded';

export function ExecutiveWorkspace({ model: m }: { model: ExecutiveModel }) {
  const integrity = m.readFailures.tenantIntegrity + m.readFailures.contractViolation;
  const n = m.subjects.length, rc = m.riskCoverage, cc = m.controlCoverage;
  return <div className="mx-auto max-w-7xl space-y-9 pb-8">
    <header className="border-b border-border-dark pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-widest text-gray-400">Business Workspace</p>
        <span className="rounded-full border border-border-dark px-3 py-1 text-xs text-gray-300">Executive / Board</span>
      </div>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Governance at a glance</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-400">A management view of recorded governance, the evidence behind it and what needs attention.</p>
      <p className="mt-4 break-all text-xs text-gray-400">Organisation <span className="font-mono text-gray-300">{m.organisationId}</span></p>
      <nav aria-label="Executive sections" className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-sm">
        {[["portfolio", "Portfolio"], ["attention", "Executive attention"], ["risks", "Priority risks"], ["controls", "Governance & controls"], ["assurance", "Assurance"]].map(([id, label]) =>
          <a key={id} href={`#${id}`} className="text-gray-300 underline-offset-4 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{label}</a>)}
      </nav>
    </header>

    <Section id="portfolio" title="Portfolio overview" description="Canonical identities across the organisation. Risk and control observations below cover only the logical Agents on this page.">
      <dl className="grid grid-cols-1 divide-y divide-border-dark rounded-xl border border-border-dark bg-surface-dark/50 px-5 sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">
        <Metric label="Governed objects" value={m.objectCount}>Existing canonical identities · all kinds</Metric>
        <Metric label="AI Agent identities" value={m.aiObjectCount}>AGENT and AGENT_VERSION identities · versions counted separately</Metric>
        <Metric label="Governed risks · organisation" value={null}>{m.openRiskCount} open governed risk states observed on this page · {m.closedRiskCount} CLOSED, not counted as current</Metric>
        <Metric label="Controls · organisation" value={null}>{m.applicableCount} applicable control assignments observed on this page</Metric>
      </dl>
      {m.kinds.length > 0 && <details className="mt-3 text-xs text-gray-400"><summary className="cursor-pointer py-1 hover:text-white">Inspect identity counts by kind</summary>
        <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">{m.kinds.map(k => <li key={k.kind}>{k.kind}: <span className="text-gray-200">{k.count}</span></li>)}</ul>
      </details>}
      <div className="mt-5 border-l-2 border-border-dark pl-4 text-xs leading-relaxed text-gray-400">
        <p className="font-medium text-gray-300">Read scope · page {m.page} of {m.pageCount ?? 'UNKNOWN'} · {n} of {m.agentCount ?? 'UNKNOWN'} canonical Agents</p>
        <p className="mt-1">AgentVersion, relationship and other object risk/control coverage: UNKNOWN. Independent current reads do not form an atomic estate snapshot.</p>
        <p className="mt-1">{m.objectCount === null ? 'UNKNOWN' : m.unknownRiskSubjects} Agents with UNKNOWN risk coverage{m.objectCount !== null && rc.closedOnly > 0 && ` (${rc.closedOnly} with only CLOSED historical risk states)`} · {m.objectCount === null ? 'UNKNOWN' : m.unknownControlSubjects} with UNKNOWN control coverage · {m.unknownAssessments} observed applicable assignments with UNKNOWN assessment.</p>
        <p className="mt-1">{m.notEvidencedAssessments} observed assessments NOT EVIDENCED · {m.unknownEvidenceAssessments} observed applicable assignments with UNKNOWN assessment evidence.</p>
      </div>
      {integrity > 0 && <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm text-gray-200">
        Integrity check failed. Reads outside the verified organisation scope: {m.readFailures.tenantIntegrity} · reads violating the governed data contract: {m.readFailures.contractViolation}. The affected data was withheld and the event recorded in server diagnostics. This view is incomplete until the cause is resolved.
      </p>}
      {m.readFailures.unavailable > 0 && <p role="status" className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm text-gray-300">
        Some reads are unavailable. Identity population: {m.identityFailure === null ? 'available' : m.identityFailure === 'UNAVAILABLE' ? 'UNKNOWN' : 'WITHHELD'}; risk reads unavailable or withheld: {m.failedRiskReads}; control reads unavailable or withheld: {m.failedControlReads}. These observations are incomplete. <Link href={`/workspace?page=${m.page}`} className="underline">Retry reads</Link>
      </p>}
      {m.agentCount === 0 && <div className="mt-4"><Empty>No canonical Agents were returned. Risk, control and assurance coverage remain UNKNOWN; an empty estate does not establish compliance.</Empty></div>}
      <PageNav m={m} anchor="portfolio" label="portfolio" />
    </Section>

    <Section id="attention" title="Executive attention" description="Review prompts from explicit returned states, kept separate from gaps in recorded assessment or evidence. A gap is not a failed control or a risk rating. No inferred decisions or urgency.">
      <PageScope m={m} anchor="attention" label="attention">
        {n > 0 && <p className="mt-1">Evaluated here: risk states for {m.riskEvaluatedSubjects} of {n} Agents · control states for {m.controlEvaluatedSubjects} of {n} Agents. AgentVersion, relationship and other subject kinds are not evaluated.</p>}
        {n > 0 && <p className="mt-1">Governed information: current open risk states for {rc.openObserved} of {n} Agents · control applicability for {cc.applicabilityReturned} of {n} Agents. Attention for an Agent without current risk or control information is UNKNOWN, never clear.</p>}
      </PageScope>
      <Card className="!p-0 overflow-hidden">
        {m.attention.length ? <>
          <AttentionList title="Recorded states to review" items={m.attention.filter(a => a.kind === 'RECORDED_STATE')} />
          <AttentionList title="Gaps in recorded assessment or evidence" items={m.attention.filter(a => a.kind !== 'RECORDED_STATE')} />
        </> : <p className="p-5 text-sm text-gray-400">{attentionEmpty(m)}</p>}
      </Card>
    </Section>

    <Section id="risks" title="Priority risks" description="Open current governed risk states, ordered by a recorded band: the current residual band where the lifecycle records a CURRENT residual assessment (RESIDUAL_ASSESSED / RESIDUAL_ACCEPTED), otherwise the inherent band. Within a band, risks without a recorded residual acceptance come first; unrated risks come last. The ordering creates no new rating. Closed states are excluded here.">
      <PageScope m={m} anchor="risks" label="priority risks">
        {n > 0 && <p className="mt-1">Risk states evaluated for {m.riskEvaluatedSubjects} of {n} Agents on this page.</p>}
        {n > 0 && <p className="mt-1">Current open risk states observed for {rc.openObserved} Agents · only CLOSED (historical) states for {rc.closedOnly} · no risk states returned for {rc.noneReturned} · risk reads unavailable {rc.unavailable} · withheld after an integrity failure {rc.withheld}. Current-risk coverage is UNKNOWN for every Agent without an open state.</p>}
      </PageScope>
      {m.priorityRisks.length ? <div className="space-y-3">{m.priorityRisks.map(risk => <article key={risk.governedRiskStateId} className="rounded-xl border border-border-dark/70 bg-surface-dark/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-white">{risk.riskDomain}</h3><p className="mt-1 break-all font-mono text-xs text-gray-400">{risk.governedRiskStateId}</p></div>
          <State>{risk.lifecycle}</State>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 text-xs sm:grid-cols-4">
          <div><dt className="mb-2 text-gray-400">Inherent rating</dt><dd><State>{risk.inherentBand}</State></dd></div>
          <div><dt className="mb-2 text-gray-400">Residual rating</dt><dd><State>{risk.residualBand}</State></dd></div>
          <div><dt className="mb-2 text-gray-400">Acceptance</dt><dd><State>{risk.acceptanceStatus}</State><span className="mt-1 block break-words text-gray-400">Validity: {risk.acceptanceValidity}</span></dd></div>
          <div><dt className="mb-2 text-gray-400">Evidence support</dt><dd><State>{risk.supportCurrency}</State></dd></div>
        </dl>
        <p className="mt-4 text-xs text-gray-400">Ordered by: {orderingLabel(risk.ordering)} · {acceptanceLabel(risk.lifecycle)}</p>
        <p className="mt-1 text-xs text-gray-400">Treatment detail: UNKNOWN · governed lifecycle shown above.</p>
        <details className="mt-3 text-xs text-gray-400"><summary className="cursor-pointer hover:text-white">Subject, scenario & decision lineage</summary>
          <dl className="mt-3 space-y-2 break-all"><div><dt className="inline">AGENT: </dt><dd className="inline">{risk.subjectCanonicalObjectId}</dd></div>
            <div><dt className="inline">Scenario: </dt><dd className="inline">{risk.scenarioDefinitionId}</dd></div>
            <div><dt className="inline">Decision: </dt><dd className="inline">{risk.lineage.governanceDecisionId}</dd></div>
            <div><dt className="inline">Recorded at: </dt><dd className="inline">{risk.lineage.recordedAt}</dd></div>
          </dl>
        </details>
        <Link className="mt-4 inline-block text-sm text-gray-200 underline underline-offset-4" href={executiveSubjectHref(risk.subjectCanonicalObjectId)}>Open governed Passport →</Link>
      </article>)}</div> : <Empty>{risksEmpty(m)}</Empty>}
    </Section>

    <Section id="controls" title="Governance & controls" description="Exact governed applicability and assessment states for the Agents on this page. An assessment applies only to its pinned applicability state. No compliance percentage is computed.">
      <PageScope m={m} anchor="controls" label="governance & controls">
        {n > 0 && <p className="mt-1">Control states evaluated for {m.controlEvaluatedSubjects} of {n} Agents on this page.</p>}
        {n > 0 && <p className="mt-1">Control applicability returned for {cc.applicabilityReturned} Agents · none returned for {cc.noneReturned} · control reads unavailable {cc.unavailable} · withheld after an integrity failure {cc.withheld}. These observations cover only the Agents on this page and are not an organisation-wide control posture.</p>}
      </PageScope>
      {m.controls.length ? <ul className="divide-y divide-border-dark rounded-xl border border-border-dark bg-surface-dark/40">{m.controls.map(control => <li key={control.id} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="break-all text-sm font-medium text-white">{control.controlId}</h3><p className="mt-1 break-all text-xs text-gray-400">Version {control.versionId} · AGENT {control.subjectId}</p></div>
          <State>{control.applicability === 'DOES_NOT_APPLY' ? 'NOT APPLICABLE' : control.assessment}</State>
        </div>
        <p className="mt-3 text-xs text-gray-400">Applicability: {control.applicability} · Assessment evidence: {control.evidence}</p>
        {control.applicability === 'DOES_NOT_APPLY' && <p className="mt-1 text-xs text-gray-400">Explicit governed negative applicability; no assessment or readiness inferred.</p>}
        <details className="mt-3 text-xs text-gray-400"><summary className="cursor-pointer hover:text-white">State & evidence references</summary>
          <div className="mt-2 space-y-2 break-all">
            <p>Applicability state: {control.id} · decision {control.fact.lineage.governanceDecisionId}</p>
            <p>Assessment state: {control.assessmentStateId ?? 'UNKNOWN'} · decision {control.assessmentFact?.lineage.governanceDecisionId ?? 'UNKNOWN'}</p>
            <p>Assessment support IDs: {control.evidenceIds.length ? control.evidenceIds.join(', ') : control.evidence}</p>
            <p>Referenced support is not a sufficiency or accessibility assertion.</p>
            <p>Applicability read coordinates: {control.fact.lineage.readEffectiveAt} / {control.fact.lineage.readRecordedCutoff}</p>
          </div>
        </details>
        <Link className="mt-3 inline-block text-sm text-gray-200 underline underline-offset-4" href={executiveSubjectHref(control.subjectId, 'controls')}>Inspect control & provenance →</Link>
      </li>)}</ul> : <Empty>{controlsEmpty(m)}</Empty>}
    </Section>

    <Section id="assurance" title="Trust & Assurance" description="Tenant assurance stays separate from product documentation. A framework mapping does not establish compliance, evidence sufficiency or certification.">
      <Card>
        <dl className="grid grid-cols-1 gap-5 text-sm sm:grid-cols-3">
          {['Framework mappings', 'Evidence availability', 'Assurance gaps'].map(label => <div key={label}><dt className="text-gray-400">{label}</dt><dd className="mt-2"><State>UNKNOWN</State></dd></div>)}
        </dl>
        <p className="mt-5 max-w-3xl text-xs leading-relaxed text-gray-400">No supported operational tenant-assurance or framework-mapping read is available for this view. Product evidence and repository crosswalks do not prove this organisation’s assurance. Control evidence references above retain their original scope.</p>
      </Card>
    </Section>

    <footer className="flex flex-wrap items-start justify-between gap-4 border-t border-border-dark pt-5 text-xs leading-relaxed text-gray-400">
      <p className="max-w-2xl">Read projection · existing governance authority preserved. UNKNOWN means unavailable or not established; NOT EVIDENCED means an explicitly empty recorded assessment support set. Counts describe returned records, not operating effectiveness.</p>
      <Link className="text-gray-200 underline" href="/agents/canonical">Browse canonical Agent Passports →</Link>
    </footer>
  </div>;
}
