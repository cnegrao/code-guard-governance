import type { TenantLedgerEvent } from "../governance/ledger-read";

export function parseAuditHandle(handle: string): { kind: "V2" | "LEGACY"; id: string } {
  const match = /^(V2|LEGACY):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(handle);
  if (!match || !["V2", "LEGACY"].includes(match[1])) throw new RangeError("Invalid audit event identity");
  return { kind: match[1] as "V2" | "LEGACY", id: match[2] };
}

export function auditEventHandle(event: Pick<TenantLedgerEvent, "kind" | "event_id">): string {
  return `${event.kind}:${event.event_id}`;
}
