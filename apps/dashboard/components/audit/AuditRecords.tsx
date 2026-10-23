import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { auditEventHandle } from "@/lib/audit/identity";
import type { TenantLedgerEvent, TenantLedgerIntegrity, LedgerHistory } from "@/lib/governance/ledger-read";
import type { AuditReadState } from "./use-audit-read";

export const INTEGRITY_LIMITATION = "Integrity verification confirms retained-record chain consistency within the current tenant V2 scope. It does not establish governance correctness, compliance, control effectiveness, completeness of real-world activity, or certification.";
const historyText: Record<LedgerHistory, string> = {
  LEGACY_GLOBAL_ONLY: "Historical records before the V2 cutover use the legacy global chain and do not constitute tenant-local cryptographic verification.",
  NO_LEGACY_ENTRIES: "No legacy entries are present in this tenant history.",
  UNKNOWN: "History state has not been established.",
};
const integrityPresentation = {
  VALID: { variant: "passed", label: "V2 ledger integrity verified" },
  BROKEN: { variant: "failed", label: "V2 ledger integrity issue detected" },
  EMPTY: { variant: "detected", label: "No V2 ledger entries to verify" },
  UNKNOWN: { variant: "proposed", label: "V2 ledger integrity could not be established" },
} as const;

export function AuditReadNotice({ state }: { state: AuditReadState<unknown>["state"] }) {
  if (state === "loading") return <div role="status"><Spinner /><p>Loading audit records...</p></div>;
  if (state === "loaded") return null;
  const messages = {
    unauthenticated: "Sign in to read tenant audit records.", denied: "Access to tenant audit records denied.",
    unavailable: "Audit reading temporarily unavailable. Retry to request current records.",
    invalid: "Invalid audit request or unavailable cursor. Return to the first page.",
    not_found: "Event not found or legacy link unavailable.",
  };
  return <p role="alert" className="text-warning text-sm">{messages[state]}</p>;
}

export function AuditIntegrity({ result }: { result: AuditReadState<TenantLedgerIntegrity> }) {
  if (result.state !== "loaded") return <Card className="mb-6"><h3>V2 ledger integrity</h3><AuditReadNotice state={result.state} /></Card>;
  const integrity = result.data;
  const presentation = integrityPresentation[integrity.status];
  return <Card className="mb-6">
    <h3 className="text-sm font-semibold mb-3">Current tenant V2 integrity</h3>
    <Badge variant={presentation.variant}>{integrity.status}</Badge>
    <p className="mt-2">{presentation.label}</p>
    <dl className="text-sm text-gray-400 mt-3 space-y-2">
      <div><dt>Scope</dt><dd>Retained records in the current tenant V2 scope</dd></div>
      {integrity.checked_entries !== null && <div><dt>V2 entries checked</dt><dd>{integrity.checked_entries}</dd></div>}
      {integrity.status === "VALID" && <div><dt>Verified through tenant sequence</dt><dd>{integrity.verified_through}</dd></div>}
      <div><dt>Activation time</dt><dd>{integrity.activated_at ?? "Not established"}</dd></div>
      <div><dt>Algorithm / serialization version</dt><dd>{integrity.algorithm_version ?? "Unknown"} / {integrity.serialization_version ?? "Unknown"}</dd></div>
    </dl>
    <h4 className="mt-4 font-semibold text-sm">History (separate from V2 integrity)</h4>
    <p className="text-sm text-gray-400">{integrity.history}: {historyText[integrity.history]}</p>
    <p className="text-sm text-gray-400 mt-3">{INTEGRITY_LIMITATION}</p>
  </Card>;
}

export function AuditEventTable({ events }: { events: TenantLedgerEvent[] }) {
  if (events.length === 0) return <p className="text-gray-400 py-8">No tenant audit records found for this request.</p>;
  return <div className="overflow-x-auto"><table className="w-full text-sm">
    <caption className="text-left text-gray-400 py-2">Retained tenant records; payload authority is independent of chain integrity.</caption>
    <thead><tr className="text-left text-gray-400">{["Record", "Timestamp", "Event / description", "Subject", "Actor", "Payload authority"].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
    <tbody>{events.map(event => <tr key={auditEventHandle(event)} className="border-t border-border-dark">
      <td className="p-3"><Link className="text-primary hover:underline" href={`/audit/${encodeURIComponent(auditEventHandle(event))}`}>{event.kind === "V2" ? `V2 #${event.tenant_sequence}` : "Legacy"}</Link></td>
      <td className="p-3">{event.event_timestamp}</td>
      <td className="p-3"><div>{event.event_type}</div><p className="text-gray-400">{event.description}</p></td>
      <td className="p-3">{event.subject_type}: {event.subject_id}</td>
      <td className="p-3">{event.actor_user_id ?? "Not recorded"}</td>
      <td className="p-3 text-gray-400">{event.payload_authority}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function AuditEventDetail({ event }: { event: TenantLedgerEvent }) {
  const metadata = {
    "Event kind": event.kind, "Tenant sequence": event.kind === "V2" ? event.tenant_sequence : "Not applicable (Legacy)",
    "Event type": event.event_type, Description: event.description, Subject: `${event.subject_type}: ${event.subject_id}`,
    Actor: event.actor_user_id ?? "Not recorded", "Actor IP": event.actor_ip ?? "Not recorded",
    "Actor session": event.actor_session_id ?? "Not recorded", "Event timestamp": event.event_timestamp,
    "Recorded at": event.recorded_at, "History classification": event.history,
  };
  return <>
    <Card className="mb-6"><h3 className="font-semibold mb-3">Retained event details</h3>
      <dl className="space-y-3 text-sm">{Object.entries(metadata).map(([label, value]) => <div key={label}><dt className="text-gray-400">{label}</dt><dd className="break-all">{value}</dd></div>)}</dl>
    </Card>
    <Card><h3 className="font-semibold">Retained payload</h3>
      <p className="text-sm mt-2">Payload authority: {event.payload_authority}</p>
      <p className="text-sm text-gray-400">Legacy-field authority: {event.legacy_payload_authority}. Legacy oversight/default fields do not establish governance truth.</p>
      <p className="text-sm text-warning my-3">Ledger integrity does not establish the semantic truth of payload contents.</p>
      <pre className="overflow-auto text-xs whitespace-pre-wrap break-all">{JSON.stringify(event.payload, null, 2)}</pre>
    </Card>
  </>;
}
