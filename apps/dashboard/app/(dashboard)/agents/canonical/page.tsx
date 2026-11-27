import Link from 'next/link';
import { passportOrganisation } from '@/lib/governance/passport-session';
import { passportReader } from '@/lib/governance/passport-read-store';
import { Card } from '@/components/ui/Card';
import { readCanonicalSourceNames } from '@/lib/governance/source-name-query';
import { SOURCE_NAME_LABEL } from '@/lib/governance/source-name';

export const dynamic = 'force-dynamic';

export default async function CanonicalAgentsPage() {
  const org = await passportOrganisation();
  const read = passportReader(org);
  const agents = await read('canonical_objects', { kind: 'AGENT' });
  const names = await readCanonicalSourceNames(org, agents.map(agent => ({ objectId: agent.canonical_object_id, kind: agent.kind })), new Date().toISOString());
  return <div className="space-y-4">
    <h2 className="text-xl font-bold text-white">Canonical Agent Passports</h2>
    <p className="text-sm text-gray-400">Select a governed canonical identity. Display names are UNKNOWN where no governed name exists.</p>
    <Card>
      {!agents.length && <p className="text-gray-400">No canonical AGENT is available in this organisation.</p>}
      <ul className="space-y-4">{agents.map(agent => <li key={agent.canonical_object_id} className="break-words">
        <Link className="text-primary font-semibold underline" href={`/agents/canonical/${encodeURIComponent(agent.canonical_object_id)}`}>{names[agent.canonical_object_id] ?? 'UNKNOWN'}</Link>
        <p className="mt-1 text-xs text-gray-400">{SOURCE_NAME_LABEL} · {agent.kind}</p>
        <p className="mt-1 break-all text-xs text-gray-500">{agent.canonical_object_id}</p>
      </li>)}</ul>
    </Card>
  </div>;
}
