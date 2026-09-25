import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import * as orgRepo from "@/repositories/organisations";

export async function GET() {
  let principal;
  try {
    principal = await requireVerifiedGovernancePrincipal();
  } catch (error) {
    return error instanceof SessionAuthenticationError
      ? NextResponse.json({ error: "Not authenticated" }, { status: 401 })
      : NextResponse.json({ error: "Unable to load account" }, { status: 500 });
  }
  try {
    const { userId, organisationId: orgId, informational } = principal;
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
    return NextResponse.json({ error: "Unable to load account" }, { status: 500 });
  }
}
