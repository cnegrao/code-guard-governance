import { requireVerifiedGovernancePrincipal } from "@/lib/auth";
import { verifyTenantLedger } from "@/lib/governance/ledger-read";
import { auditJson, auditReadError } from "@/lib/audit/http";

export async function GET() {
  try {
    const principal = await requireVerifiedGovernancePrincipal();
    return auditJson(await verifyTenantLedger(principal));
  } catch (error) {
    return auditReadError(error);
  }
}
