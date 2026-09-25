import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal } from "@/lib/auth";
import * as orgRepo from "@/repositories/organisations";

export async function GET() {
  try {
    const { userId, organisationId: orgId, informational } = await requireVerifiedGovernancePrincipal();

    const org = await orgRepo.getOrg(orgId);

    return NextResponse.json({
      user: { user_id: userId, email: informational.email ?? "" },
      org: org
        ? {
            organisation_id: org.organisation_id,
            name: org.name,
            industry:
              (org.external_refs as Record<string, string>)?.industry_profile ?? "other",
          }
        : null,
    });
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}
