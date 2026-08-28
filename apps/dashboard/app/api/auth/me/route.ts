import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/session";
import * as orgRepo from "@/repositories/organisations";

export async function GET() {
  try {
    const { userId, organisationId, email } = await getSessionContext();

    const org = await orgRepo.getOrg(organisationId);

    return NextResponse.json({
      user: { user_id: userId, email },
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
