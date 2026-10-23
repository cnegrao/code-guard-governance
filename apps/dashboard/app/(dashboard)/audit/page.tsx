"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AuditEventTable, AuditIntegrity, AuditReadNotice } from "@/components/audit/AuditRecords";
import { useAuditRead } from "@/components/audit/use-audit-read";
import type { TenantLedgerIntegrity, TenantLedgerPage } from "@/lib/governance/ledger-read";

export default function AuditPage() {
  const [eventType, setEventType] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const params = new URLSearchParams({ limit: "50" });
  if (eventType) params.set("event_type", eventType);
  if (cursor) params.set("cursor", cursor);
  const events = useAuditRead<TenantLedgerPage>(`/api/audit/events?${params}`, revision);
  const integrity = useAuditRead<TenantLedgerIntegrity>("/api/audit/integrity", revision);

  return <div>
    <h2 className="text-xl font-bold">Audit Center</h2>
    <p className="text-sm text-gray-400 mt-1 mb-6">Tenant audit records and V2 ledger integrity</p>
    <Button variant="secondary" className="mb-4" onClick={() => setRevision(value => value + 1)}>Refresh audit reads</Button>
    <AuditIntegrity result={integrity} />
    <div className="flex flex-wrap items-end gap-3 mb-4">
      <label className="text-sm text-gray-400">Exact event type
        <input className="block bg-transparent border border-border-dark rounded p-2" maxLength={120}
          value={eventType} onChange={event => { setEventType(event.target.value); setCursor(null); }} />
      </label>
      <Button variant="secondary" onClick={() => { setCursor(null); setRevision(value => value + 1); }}>First page</Button>
    </div>
    <AuditReadNotice state={events.state} />
    {events.state === "loaded" && <>
      <AuditEventTable events={events.data.events} />
      <Button className="mt-4" variant="secondary" disabled={!events.data.next_cursor}
        onClick={() => setCursor(events.data.next_cursor)}>Next</Button>
    </>}
  </div>;
}
