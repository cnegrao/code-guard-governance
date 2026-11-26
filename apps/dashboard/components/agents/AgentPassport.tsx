import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import type { AgentPassport360, PassportFact, PassportProvenance, PassportFamily } from '@/lib/governance/agent-passport';

import { SOURCE_NAME_LABEL } from '@/lib/governance/source-name';

function ProfileGovernance({ context }: { context: PassportProvenance }) {
  const trace = context.profileGovernance;
  if (!trace) return null;
  return <div className="mt-3 space-y-2 text-gray-300">
    <h4 className="font-semibold">Technical profile governance chain</h4>
    <p>Human certification concerns the AgentVersion review. Reconciliation concerns its canonical identity. These records do not establish individual approval of this technical field.</p>
    <p>Individual field approval: UNKNOWN. Original per-field source assertions, evidence and trust are listed separately below.</p>
    <p className="break-words">Canonical AGENT_VERSION: {trace.versionId}</p>
    <ol aria-label="Technical profile governance applications" className="space-y-3">
      {trace.applications.map(app => <li key={app.proposalId} className="border-l border-border-dark pl-3 break-words">
        <p className="font-semibold">{app.origin ? 'Origin technical proposal' : 'Other applied technical proposal'}: {app.proposalId}</p>
        <p>Proposed at: {app.proposedAt ?? 'UNKNOWN'}</p>
        <p>Discovery candidate: {app.candidateId ?? 'UNKNOWN'}</p>
        {app.discovery && <>
          <p>Discovery finding: {app.discovery.findingId}</p>
          <p>Source: {app.discovery.connectionId} · {app.discovery.externalType}: {app.discovery.externalId}</p>
        </>}
        <p className="mt-2 font-semibold">Human certification of the AgentVersion review</p>
        {app.certifications.map(cert => <div key={cert.eventId}>
          <p>Certification event: {cert.eventId} · HUMAN {cert.actorReference}</p>
          <p>Certified at: {cert.occurredAt} · recorded {cert.recordedAt}</p>
          <Link className="text-primary underline" href={`/governance/reviews/${encodeURIComponent(cert.reviewSubjectId)}`}>Open certified AgentVersion review</Link>
        </div>)}
        <p className="mt-2 font-semibold">AgentVersion identity reconciliation</p>
        {app.reconciliations.map(decision => <div key={decision.decisionId}>
          <p>Reconciliation decision: {decision.decisionId} · {decision.outcome}</p>
          <p>HUMAN {decision.actorReference} · decided {decision.decidedAt}</p>
          <p>Identity mappings: {decision.mappingIds.join(', ')}</p>
        </div>)}
        <p className="mt-2 font-semibold">Technical profile materialization</p>
        {app.materialization && <>
          <p>Materialization receipt: {app.materialization.materializationId} · {app.materialization.status}</p>
          <p>Applied at: {app.materialization.appliedAt} · recorded {app.materialization.recordedAt}</p>
        </>}
        {app.unknowns.map(unknown => <p key={unknown} className="mt-1">{unknown}</p>)}
      </li>)}
    </ol>
  </div>;
}

export function Provenance({ context }: { context: PassportProvenance }) {
  return <details className="mt-2 text-xs text-gray-400">
    <summary className="cursor-pointer text-primary">Source, trust and provenance</summary>
    <dl className="mt-2 space-y-1 break-words">
      <div><dt className="inline">Authority: </dt><dd className="inline">{context.authority} · {context.storage}</dd></div>
      {!context.profileGovernance && <>
        <div><dt className="inline">Decision: </dt><dd className="inline">{context.decisionId ?? 'UNKNOWN'}</dd></div>
        <div><dt className="inline">Decision time: </dt><dd className="inline">{context.decidedAt ?? 'UNKNOWN'}</dd></div>
      </>}
      <div><dt className="inline">Recorded / effective from: </dt><dd className="inline">{context.recordedAt ?? 'UNKNOWN'} / {context.validFrom ?? 'UNKNOWN'}</dd></div>
      {context.validTo && <div>Effective until (exclusive): {context.validTo}</div>}
      {context.revision !== undefined && <div>Governed revision: {context.revision}</div>}
      {context.profileOriginProposalId && <div>Profile origin proposal: {context.profileOriginProposalId}. Per-field support is listed below.</div>}
      {context.snapshotId && <div>Accepted source snapshot: {context.snapshotId} · observed {context.observedAt ?? 'UNKNOWN'}</div>}
      {context.policy && <div>Policy: {context.policy.policyId} · accepted version {context.policy.acceptedVersion} · active version {context.policy.activeVersion ?? 'UNKNOWN'}</div>}
      {context.l14 && <>
        <div>M16 fact state: {context.l14.factStateId} · predecessor {context.l14.predecessorStateId ?? 'none (first state)'} · trust {context.l14.trustState} · source {context.l14.sourceClass}</div>
        <div>Proposal: {context.l14.proposalId} · submitted {context.l14.proposalSubmittedAt}</div>
        <div>Governance decision: {context.l14.decisionOutcome} · {context.l14.decisionReasonCode}</div>
        <div>Authorization decision: {context.l14.authorizationDecisionId} · {context.l14.authorizationResult} · evaluated {context.l14.authorizationEvaluatedAt}</div>
        <div>Authority Policy: {context.l14.authorityPolicy.authorityPolicyId} · version {context.l14.authorityPolicy.versionId}</div>
        <div>Support: {context.l14.supportStatus} · state evidence {context.l14.factSupportEvidenceIds.length} · decision evidence {context.l14.decisionSupportEvidenceIds.length} · proposal evidence {context.l14.proposalSupportEvidenceIds.length}</div>
        <div>Read at effective {context.l14.readEffectiveAt} · recorded cutoff {context.l14.readRecordedCutoff}</div>
      </>}
      {context.policy && context.policy.acceptedVersion !== context.policy.activeVersion && <p>Historical acceptance policy. Current authority is not established by that earlier decision; the accepted fact remains governed until a new decision changes it.</p>}
    </dl>
    <ProfileGovernance context={context} />
    {context.sources.length === 0 && <p className="mt-2">Source assertion / trust: UNKNOWN</p>}
    {context.sources.map(source => <div key={source.assertionId} className="mt-2 border-l border-border-dark pl-3 break-words">
      <p>Source trust: <strong className="text-gray-200">{source.trust}</strong> · {source.assertionId}</p>
      <p>System: {source.sourceSystemId ?? 'UNKNOWN'} · connection {source.connectionId}</p>
      <p>{source.externalType}: {source.externalId}</p>
      <p>Method: {source.method} · acquisition {source.runId}</p>
      <p>Observed: {source.observedAt} · recorded: {source.recordedAt}</p>
    </div>)}
    <p className="mt-2">Evidence {context.evidence.length ? '(metadata)' : ': UNKNOWN'}</p>
    {context.evidence.map(e => <p key={e.evidenceId} className="break-words">{e.evidenceId} · {e.handling} · captured {e.capturedAt}</p>)}
    {context.reviewSubjectId && <Link className="mt-2 inline-block text-primary underline" href={`/governance/reviews/${encodeURIComponent(context.reviewSubjectId)}`}>Open governed review and evidence</Link>}
  </details>;
}

function Fact({ fact }: { fact: PassportFact }) {
  let content: React.ReactNode;
  switch (fact.type) {
    case 'execution': content = <>
      <p>{fact.fact.field === 'CAPABILITY' ? `Declared Tool capability: ${fact.fact.capabilityReference}` :
        fact.fact.field === 'PRINCIPAL' ? `Declared principal: ${fact.fact.principal.kind} · ${fact.fact.principal.providerCode} · ${fact.fact.principal.authorityReference} · ${fact.fact.principal.principalReference}` :
        fact.fact.field === 'REQUESTED_SCOPE' ? `Requested scope: ${fact.fact.scopeReference} · resource: ${fact.fact.resourceReference}` :
        `Declared endpoint: ${fact.fact.endpoint} · ${fact.fact.protocol.kind === 'API' ? fact.fact.protocol.family : fact.fact.protocol.transport}`}</p>
      <p className="text-xs text-gray-400">AgentVersion: {fact.versionId}</p>
      <p className="text-xs text-gray-400">Governed source declaration from snapshot {fact.sourceSnapshotId}.</p>
    </>; break;
    case 'governed-l14': {
      const v = fact.value;
      content = <>
        <p>{v.family === 'RESPONSIBILITY_ASSIGNMENT' ? `${v.responsibilityRole}: GovernanceParty ${v.governancePartyId}` :
          v.family === 'BUSINESS_CONTEXT_ASSIGNMENT' ? `${v.semanticKind}: ${v.domainId}` :
          v.family === 'POLICY_APPLICABILITY' ? `Policy ${v.policyId}: ${v.applicability}` :
          v.family === 'CONTROL_APPLICABILITY' ? `Control ${v.controlDefinitionId}: ${v.applicability}` :
          `Control ${v.controlDefinitionId} assessment: ${v.assessmentOutcome}`}</p>
        <p className="text-xs text-gray-400">{fact.targetKind}: {fact.targetId} · {v.family}{fact.targetKind === 'AGENT_VERSION' ? ' · exact AgentVersion fact (never inherited)' : ''}</p>
        <p className="text-xs text-gray-400">Pinned dependency: {v.family === 'RESPONSIBILITY_ASSIGNMENT' ? `GovernanceParty state ${v.partyValidatedStateId}` :
          v.family === 'BUSINESS_CONTEXT_ASSIGNMENT' ? `domain state ${v.domainValidatedStateId}` :
          v.family === 'POLICY_APPLICABILITY' ? `policy version ${v.policyVersionId} · state ${v.policyVersionValidatedStateId}` :
          v.family === 'CONTROL_APPLICABILITY' ? `control version ${v.controlDefinitionVersionId} · state ${v.controlDefinitionValidatedStateId}` :
          `applicability state ${v.controlApplicabilityStateId} · control version ${v.controlDefinitionVersionId}`}</p>
        {v.family === 'POLICY_APPLICABILITY' || v.family === 'CONTROL_APPLICABILITY' ? v.applicability === 'DOES_NOT_APPLY' &&
          <p className="text-xs text-gray-400">Explicit governed negative applicability; not coverage and not UNKNOWN.</p> : null}
      </>;
      break;
    }
    case 'identity': content = <><p>{fact.objectKind}: {fact.objectId}</p><p className="text-xs text-gray-400">Organisation: {fact.organisationId}</p></>; break;
    case 'mapping': content = <><p>{fact.externalType}: {fact.externalId}</p><p className="text-xs text-gray-400">Canonical object: {fact.objectId} · source connection: {fact.connectionId}</p></>; break;
    case 'profile': content = <><p>{fact.field}: {fact.value}</p><p className="text-xs text-gray-400">AgentVersion: {fact.versionId}</p></>; break;
    case 'relationship': content = <><p>{fact.sourceKind} {fact.sourceId} → {fact.relationshipType} → {fact.targetKind} {fact.targetId}</p><p className="text-xs text-gray-400">{fact.versionId ? `AgentVersion: ${fact.versionId} · ` : ''}Relationship state: {fact.stateId}</p></>; break;
    case 'data-field': content = <>
      <p>{fact.fact.objectKind} {fact.objectId} · {fact.fact.field}: {fact.fact.value}</p>
      <p className="text-xs text-gray-400">Governed field state: {fact.stateId} · AgentVersion: {fact.versionId} · access: {fact.accessRelationshipId}</p>
      <p className="text-xs text-gray-400">Data state at consultation time, linked through this version's governed access. This is not a historical snapshot of the data at the version's creation.</p>
      <p className="text-xs text-gray-400">Source trust: {fact.source.trust} · {fact.source.systemId} · {fact.source.connectionId} · {fact.source.externalType}: {fact.source.externalId}</p>
      {fact.competingProposalIds.length > 0 && <p className="mt-1 text-xs text-warning">Different source proposals exist ({fact.competingProposalIds.length}); they do not replace this governed state. <Link href="/governance/technical-facts" className="underline">Inspect field governance</Link></p>}
    </>; break;
  }
  return <li className="border-t border-border-dark/50 py-3 break-words">{content}<Provenance context={fact.provenance} /></li>;
}


function isGapFact(fact: PassportFact) {
  if (fact.type === 'governed-l14' && fact.value.family === 'CONTROL_ASSESSMENT') return ['INSUFFICIENT_EVIDENCE', 'NOT_ASSESSED'].includes(fact.value.assessmentOutcome);
  return false;
}

function riskLines(item: AgentPassport360['riskOverlay']['items'][number]) {
  return [
    'Lifecycle: ' + item.lifecycle, 'INHERENT: ' + item.inherentBand, 'RESIDUAL: ' + item.residualBand,
    'Acceptance: ' + item.acceptanceStatus, 'validity: ' + item.acceptanceValidity, 'support: ' + item.supportCurrency,
  ];
}
const unknownLine = (value: string) => /\b(?:UNKNOWN|NOT_EVIDENCED|SUPPORT_NONE)\b/.test(value);
function overlayFor(passport: AgentPassport360, section: PassportFamily) {
  return passport.riskOverlay.items.filter(item => item.familyId === section.id || section.id === 'provenance'
    || (section.id === 'controls' && item.controlAssessmentStateIds.length > 0));
}

function FamilySection({ passport, section, index, facts, empty }: {
  passport: AgentPassport360; section: PassportFamily; index: number; facts: readonly PassportFact[]; empty?: boolean;
}) {
  return <section id={'passport-' + section.id} aria-labelledby={'passport-title-' + section.id} className="scroll-mt-6 min-w-0">
    <Card className="h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={'passport-title-' + section.id} className="text-sm font-semibold text-white">{index + 1}. {section.label}</h3>
        <span className="text-xs text-gray-400">Coverage: {section.status}</span>
      </div>
      {empty && <p className="mt-3 text-sm text-gray-400">{section.facts.length ? 'Governed records with evidence gaps are listed below.' : 'UNKNOWN — no governed fact available in this context.'}</p>}
      <ul className="mt-3 text-sm text-gray-300">{facts.map(fact => <Fact key={fact.id} fact={fact} />)}</ul>
      {overlayFor(passport, section).map(item => <div key={item.governedRiskStateId} className="mt-3 border-t border-border-dark/50 pt-3 text-xs text-gray-300">
        <p className="font-semibold text-white">Governed risk overlay · {item.riskDomain}</p>
        {riskLines(item).filter(line => !unknownLine(line)).map(line => <p key={line}>{line}</p>)}
        <p className="break-words">Exact subject: {item.subjectKind} {item.subjectCanonicalObjectId} · scenario {item.scenarioDefinitionId}</p>
        {section.id === 'ownership' && item.accountableParties.length > 0 && <p>Accountable parties: {item.accountableParties.map(p => p.responsibilityRole + ':' + p.governancePartyId).join(', ')}</p>}
        {section.id === 'controls' && <p>Residual control dependencies: {item.controlAssessmentStateIds.join(', ')}</p>}
        {section.id === 'provenance' && <p className="break-words">L15 lineage: proposal {item.lineage.proposalId} · authorization {item.lineage.authorizationDecisionId} · decision {item.lineage.governanceDecisionId} · state {item.governedRiskStateId}</p>}
      </div>)}
    </Card>
  </section>;
}

export function AgentPassport({ passport }: { passport: AgentPassport360 }) {
  const route = '/agents/canonical/' + encodeURIComponent(passport.canonicalAgent.objectId);
  const name = passport.sourceNames?.[passport.canonicalAgent.objectId];
  const headerGaps = [
    'Display name, Agent code and versionCode: UNKNOWN. Identity coverage concerns canonical ID, kind and organisation.',
    'Current AgentVersion: UNKNOWN. Versions below have an exact governed association.',
    ...(!passport.selectedVersionId ? ['Selected AgentVersion: UNKNOWN.'] : []),
    ...(!passport.versionContexts.length ? ['Associated AgentVersions: UNKNOWN.'] : []),
    ...(!passport.riskOverlay.nonAuthoritativeAnalysis.hypotheses.length ? ['Hypotheses: UNKNOWN — none displayed.'] : []),
  ];
  const sections = passport.families.map((section, index) => {
    const known = section.facts.filter(fact => !isGapFact(fact));
    const gapFacts = section.facts.filter(isGapFact);
    const overlay = overlayFor(passport, section);
    const empty = known.length === 0 && overlay.length === 0;
    const gaps = [...section.unknowns,
      ...known.flatMap(fact => fact.type === 'execution' ? [
        'AgentVersion: ' + fact.versionId + ' · authorization: UNKNOWN.',
        'Runtime identity and reachability remain UNKNOWN.',
      ] : []),
      ...overlay.flatMap(item => riskLines(item).filter(unknownLine)),
      ...(section.id === 'ownership' && overlay.some(item => !item.accountableParties.length) ? ['Accountable parties: UNKNOWN'] : [])];
    return { section, index, known, gapFacts, empty, gaps };
  });
  const gapCount = headerGaps.length + sections.reduce((n, s) => n + s.gaps.length + s.gapFacts.length + (s.empty && !s.gaps.length && !s.gapFacts.length ? 1 : 0), 0);
  return <div className="space-y-6">
    <header className="rounded-xl border border-border-dark bg-surface-dark/50 p-6">
      <Link className="text-sm text-[#91B5FF] underline" href="/agents/canonical">← Canonical Agents</Link>
      <p className="mt-4 text-xs uppercase tracking-widest text-gray-400">Agent Passport 360</p>
      <h2 className="mt-2 break-words text-2xl font-bold text-white">{name ?? 'AGENT'}</h2>
      {name && <p className="mt-1 text-xs text-gray-400">{SOURCE_NAME_LABEL}</p>}
      <p className="mt-3 break-all text-xs text-gray-400">Canonical AGENT: {passport.canonicalAgent.objectId}</p>
      <Link className="mt-3 inline-block text-sm text-primary underline" href={`/governance/agent-chain?canonicalId=${encodeURIComponent(passport.canonicalAgent.objectId)}`}>Review agent chain</Link>
      <p className="mt-2 text-sm text-gray-300">Governed view · 16 / 16 families represented</p>
      <a className="mt-3 inline-block text-sm text-[#91B5FF] underline" href="#passport-evidence-gaps">Evidence gaps ({gapCount})</a>
    </header>
    <Card>
      <h3 className="font-semibold text-white">AgentVersion context</h3>
      {passport.selectedVersionId && <p className="mt-2 break-all text-sm text-gray-300">Selected AgentVersion: {passport.selectedVersionId}</p>}
      <ul className="mt-3 flex flex-wrap gap-3 text-sm">
        <li><Link className="text-[#91B5FF] underline" href={route}>Logical Agent only</Link></li>
        {passport.versionContexts.map(version => <li key={version.objectId} className="max-w-full break-words"><Link className="text-[#91B5FF] underline" aria-current={passport.selectedVersionId === version.objectId ? 'page' : undefined}
          href={route + '?version=' + encodeURIComponent(version.objectId)}>{passport.sourceNames?.[version.objectId] ?? version.objectId}</Link>
          {passport.sourceNames?.[version.objectId] && <span className="block text-xs text-gray-400">{SOURCE_NAME_LABEL}</span>}</li>)}
      </ul>
    </Card>
    <nav aria-label="Passport families" className="flex flex-wrap gap-2">
      {passport.families.map((section, index) => <a key={section.id} href={'#passport-' + section.id} className="rounded border border-border-dark px-3 py-2 text-xs text-gray-300 hover:text-white">{index + 1}. {section.label}</a>)}
    </nav>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {sections.filter(s => !s.empty).map(s => <FamilySection key={s.section.id} passport={passport} section={s.section} index={s.index} facts={s.known} />)}
    </div>
    <details id="passport-evidence-gaps" className="scroll-mt-6 rounded-xl border border-border-dark bg-surface-dark/50 p-5">
      <summary className="cursor-pointer font-semibold text-gray-200">Evidence gaps ({gapCount})</summary>
      <p className="mt-3 text-sm text-gray-400">UNKNOWN and NOT_EVIDENCED are evidence gaps. They do not establish compliance.</p>
      <ul className="mt-3 space-y-2 text-sm text-gray-400">{headerGaps.map(gap => <li key={gap}>{gap}</li>)}</ul>
      <div className="mt-4 space-y-4">
        {sections.map(s => <div key={s.section.id}>
          {s.empty && <FamilySection passport={passport} section={s.section} index={s.index} facts={[]} empty />}
          {(s.gaps.length > 0 || s.gapFacts.length > 0) && <div className="mt-3 text-sm text-gray-400">
            <h4 className="font-medium text-gray-300">{s.section.label}</h4>
            <ul className="mt-2 space-y-1">{s.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul>
            <ul>{s.gapFacts.map(fact => <Fact key={fact.id} fact={fact} />)}</ul>
          </div>}
        </div>)}
      </div>
    </details>
    <Card>
      <h3 className="text-sm font-semibold text-white">NON-AUTHORITATIVE ANALYSIS</h3>
      <p className="mt-2 text-xs text-gray-400">Analysis does not change governed facts or close evidence gaps.</p>
    </Card>
  </div>;
}
