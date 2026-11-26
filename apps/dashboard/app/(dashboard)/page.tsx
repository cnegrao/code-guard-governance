"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CANONICAL_OBJECT_KIND } from '@council/canonical-contracts';
import { StatCard } from '@/components/dashboard/StatCard';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';
import { organisationDisplayName } from '@/lib/brand';

interface Estate {
  byKind: Record<string, number>;
  canonicalObjects: number;
  canonicalRelationships: number;
  pendingReview: number;
  asOf: string;
}

export default function DashboardPage() {
  const { session } = useAuth();
  const [data, setData] = useState<Estate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/estate')
      .then(res => { if (!res.ok) throw new Error('Governed estate could not be read.'); return res.json(); })
      .then(value => { if (active) setData(value); })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <div className="space-y-6" aria-busy={loading}>
    <header className="rounded-xl border border-border-dark bg-surface-dark/50 p-6">
      <p className="text-xs font-semibold tracking-[0.2em] text-gray-400">GOVERNYX</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">AI Governance Intelligence</h2>
      <p className="mt-2 text-sm text-gray-400">{organisationDisplayName(session?.org?.name)} · Canonical inventory and human review</p>
    </header>
    <section aria-labelledby="estate-title" className="space-y-4">
      <div>
        <h3 id="estate-title" className="text-lg font-semibold text-white">Governed estate</h3>
        <p className="mt-1 text-sm text-gray-400">Canonical objects and effective canonical relationships. These counts do not establish compliance.</p>
      </div>
      {loading && <p role="status" className="text-sm text-gray-400">Reading canonical state… Counts remain UNKNOWN until the read completes.</p>}
      {error && <p role="alert" className="text-sm text-warning">{error} Counts are UNKNOWN; no governance conclusion is available.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Canonical objects" value={data?.canonicalObjects ?? 'UNKNOWN'} color="gray" />
        <Link href="/graph"><StatCard label="Canonical relationships" value={data?.canonicalRelationships ?? 'UNKNOWN'} color="gray" subtitle="Open governed graph" /></Link>
        <Link href="/governance/reviews"><StatCard label="Pending review" value={data?.pendingReview ?? 'UNKNOWN'} color="gray" subtitle="DETECTED · PROPOSED · CONFIRMED" /></Link>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Object.values(CANONICAL_OBJECT_KIND).map(kind => <StatCard key={kind} label={kind} value={data?.byKind?.[kind] ?? 'UNKNOWN'} color="gray" />)}
      </div>
      {data?.asOf && <p className="text-xs text-gray-400">Effective at {data.asOf}. Reads are not a transaction-wide snapshot.</p>}
    </section>
    <Card>
      <h3 className="font-semibold text-white">Explore the estate</h3>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <Link href="/agents/canonical" className="text-[#91B5FF] underline">Agent Passports</Link>
        <Link href="/governance/reviews" className="text-[#91B5FF] underline">Review Queue</Link>
        <Link href="/graph" className="text-[#91B5FF] underline">Governed Graph</Link>
      </div>
    </Card>
  </div>;
}