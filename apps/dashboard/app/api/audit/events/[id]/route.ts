import { requireVerifiedGovernancePrincipal } from "@/lib/auth";
import { getTenantLedgerEvent } from "@/lib/governance/ledger-read";
import { parseAuditHandle } from "@/lib/audit/identity";
import { auditJson, auditReadError } from "@/lib/audit/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireVerifiedGovernancePrincipal();
    const { kind, id } = parseAuditHandle((await params).id);
    const event = await getTenantLedgerEvent(principal, kind, id);
    return event ? auditJson({ event }) : auditJson({ error: "Event not found" }, 404);
  } catch (error) {
    return auditReadError(error);
  }
}
