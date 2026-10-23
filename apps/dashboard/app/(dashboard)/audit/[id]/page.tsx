"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { AuditEventDetail, AuditReadNotice } from "@/components/audit/AuditRecords";
import { useAuditRead } from "@/components/audit/use-audit-read";
import type { TenantLedgerEvent } from "@/lib/governance/ledger-read";

export default function AuditDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [revision, setRevision] = useState(0);
  const result = useAuditRead<{ event: TenantLedgerEvent }>(`/api/audit/events/${encodeURIComponent(id)}`, revision);
  return <div>
    <Link href="/audit" className="text-primary hover:underline">Back to Audit Center</Link>
    <h2 className="text-xl font-bold mt-3 mb-4">Tenant audit record</h2>
    <Button variant="secondary" className="mb-4" onClick={() => setRevision(value => value + 1)}>Retry current record</Button>
    <AuditReadNotice state={result.state} />
    {result.state === "loaded" && <AuditEventDetail event={result.data.event} />}
  </div>;
}
