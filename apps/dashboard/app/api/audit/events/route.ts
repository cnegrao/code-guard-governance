import { requireVerifiedGovernancePrincipal } from "@/lib/auth";
import { listTenantLedgerEvents } from "@/lib/governance/ledger-read";
import { auditJson, auditReadError } from "@/lib/audit/http";

export async function GET(request: Request) {
  try {
    const principal = await requireVerifiedGovernancePrincipal();
    const { searchParams } = new URL(request.url);
    for (const key of searchParams.keys()) {
      if (!["limit", "cursor", "event_type"].includes(key) || searchParams.getAll(key).length !== 1) {
        throw new RangeError("Unsupported audit parameter");
      }
    }
    const rawLimit = searchParams.get("limit");
    if (rawLimit !== null && !/^[1-9][0-9]*$/.test(rawLimit)) throw new RangeError("Invalid limit");
    return auditJson(await listTenantLedgerEvents(principal, {
      limit: rawLimit === null ? undefined : Number(rawLimit),
      cursor: searchParams.get("cursor") ?? undefined,
      eventType: searchParams.get("event_type") ?? undefined,
    }));
  } catch (error) {
    return auditReadError(error);
  }
}
