import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { AgentPassport360, PassportFact, PassportProvenance } from '@/lib/governance/agent-passport';

function Provenance({ context }: { context: PassportProvenance }) {
  return <details className="mt-2 text-xs text-gray-400">
    <summary className="cursor-pointer text-primary">Source, trust and provenance</summary>
    <dl className="mt-2 space-y-1 break-words">
      <div><dt className="inline">Authority: </dt><dd className="inline">{context.authority} · {context.storage}</dd></div>
      <div><dt className="inline">Decision: </dt><dd className="inline">{context.decisionId ?? 'UNKNOWN'}</dd></div>
      <div><dt className="inline">Decision time: </dt><dd className="inline">{context.decidedAt ?? 'UNKNOWN'}</dd></div>
      <div><dt className="inline">Recorded / effective from: </dt><dd className="inline">{context.recordedAt ?? 'UNKNOWN'} / {context.validFrom ?? 'UNKNOWN'}</dd></div>
      {context.validTo && <div>Effective until (exclusive): {context.validTo}</div>}
      {context.revision !== undefined && <div>Governed revision: {context.revision}</div>}
      {context.profileOriginProposalId && <div>Profile origin proposal: {context.profileOriginProposalId}. Per-field support is listed below.</div>}
      {context.snapshotId && <div>Accepted source snapshot: {context.snapshotId} · observed {context.observedAt ?? 'UNKNOWN'}</div>}
      {context.policy && <div>Policy: {context.policy.policyId} · accepted version {context.policy.acceptedVersion} · active version {context.policy.activeVersion ?? 'UNKNOWN'}</div>}
      {context.policy && context.policy.acceptedVersion !== context.policy.activeVersion && <p>Historical acceptance policy. Current authority is not established by that earlier decision; the accepted fact remains governed until a new decision changes it.</p>}
    </dl>
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
      <p className="text-xs text-gray-400">AgentVersion: {fact.versionId} · authorization: UNKNOWN.</p>
      <p className="text-xs text-gray-400">Governed source declaration from snapshot {fact.sourceSnapshotId}. Runtime identity and reachability remain UNKNOWN.</p>
    </>; break;
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

export function AgentPassport({ passport }: { passport: AgentPassport360 }) {
  const route = `/agents/canonical/${encodeURIComponent(passport.canonicalAgent.objectId)}`;
  return <div className="space-y-6">
    <header>
      <Link className="text-sm text-primary" href="/agents/canonical">← Canonical Agents</Link>
      <h2 className="mt-2 text-2xl font-bold text-white">Agent Passport 360</h2>
      <p className="mt-1 break-words text-sm text-gray-300">Canonical AGENT: {passport.canonicalAgent.objectId}</p>
      <p className="mt-1 text-sm text-gray-400">Governed view · display name: UNKNOWN · 16 / 16 families represented</p>
    </header>
    <Card>
      <h3 className="font-semibold text-white">AgentVersion context</h3>
      <p className="mt-2 text-sm text-gray-400">Current AgentVersion: UNKNOWN. Versions below have an exact governed association.</p>
      <p className="mt-1 break-words text-sm text-gray-300">Selected AgentVersion: {passport.selectedVersionId ?? 'UNKNOWN'} · versionCode: UNKNOWN</p>
      <ul className="mt-3 flex flex-wrap gap-3 text-sm">
        <li><Link className="text-primary underline" href={route}>Logical Agent only</Link></li>
        {passport.versionContexts.map(version => <li key={version.objectId} className="break-all"><Link className="text-primary underline" aria-current={passport.selectedVersionId === version.objectId ? 'page' : undefined}
          href={`${route}?version=${encodeURIComponent(version.objectId)}`}>{version.objectId}</Link></li>)}
      </ul>
      {!passport.versionContexts.length && <p className="mt-2 text-sm text-gray-400">Associated AgentVersions: UNKNOWN.</p>}
    </Card>
    <nav aria-label="Passport families" className="flex flex-wrap gap-2">
      {passport.families.map((section, index) => <a key={section.id} href={`#passport-${section.id}`} className="rounded border border-border-dark px-3 py-2 text-xs text-gray-300 hover:text-white">{index + 1}. {section.label}</a>)}
    </nav>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {passport.families.map((section, index) => <section key={section.id} id={`passport-${section.id}`} aria-labelledby={`passport-title-${section.id}`} className="scroll-mt-6 min-w-0">
        <Card className="h-full">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`passport-title-${section.id}`} className="text-sm font-semibold text-white">{index + 1}. {section.label}</h3>
            <Badge variant={section.status === 'KNOWN' ? 'registered' : 'detected'}>{section.status}</Badge>
          </div>
          {!section.facts.length && <p className="mt-3 text-sm text-gray-400">UNKNOWN — no governed fact available in this context.</p>}
          <ul className="mt-3 text-sm text-gray-300">{section.facts.map(fact => <Fact key={fact.id} fact={fact} />)}</ul>
          {section.id === 'identity' && <p className="text-xs text-gray-400">Display name, Agent code and versionCode: UNKNOWN. Identity coverage concerns canonical ID, kind and organisation.</p>}
          {section.unknowns.map(gap => <p key={gap} className="mt-2 text-xs text-gray-400">{gap}</p>)}
        </Card>
      </section>)}
    </div>
  </div>;
}
