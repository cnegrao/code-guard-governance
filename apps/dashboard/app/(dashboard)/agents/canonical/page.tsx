import Link from 'next/link';
import { passportOrganisation } from '@/lib/governance/passport-session';
import { passportReader } from '@/lib/governance/passport-read-store';
import { Card } from '@/components/ui/Card';

export const dynamic = 'force-dynamic';

export default async function CanonicalAgentsPage() {
  const read = passportReader(await passportOrganisation());
  const agents = await read('canonical_objects', { kind: 'AGENT' });
  return <div className="space-y-4">
    <Link className="text-primary text-sm" href="/agents">← Agent inventory</Link>
    <h2 className="text-xl font-bold text-white">Canonical Agent Passports</h2>
    <p className="text-sm text-gray-400">Select a governed canonical identity. Display names are UNKNOWN where no governed name exists.</p>
    <Card>
      {!agents.length && <p className="text-gray-400">No canonical AGENT is available in this organisation.</p>}
      <ul className="space-y-3">{agents.map(agent => <li key={agent.canonical_object_id} className="break-all">
        <Link className="text-primary underline" href={`/agents/canonical/${encodeURIComponent(agent.canonical_object_id)}`}>{agent.canonical_object_id}</Link>
      </li>)}</ul>
    </Card>
  </div>;
}
