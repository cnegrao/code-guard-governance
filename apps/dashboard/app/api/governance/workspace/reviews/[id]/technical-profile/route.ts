import { NextResponse } from "next/server";
import { asOrganisationId } from "@council/canonical-contracts";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { toGovernanceWritePrincipal } from "@/lib/auth/governance-write-principal";
import { asReviewSubjectId } from "@/lib/governance/workspace-query";
import { getReviewTechnicalProfile, materializeReviewTechnicalProfile } from "@/lib/governance/technical-profile-materialization";
import { governedWriteErrorResponse } from "@/lib/governance/governed-write-errors";
import { reviewSubjectIdFromRouteParam } from "@/lib/governance/review-subject-route";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const principal = await requireVerifiedGovernancePrincipal();
    return NextResponse.json(await getReviewTechnicalProfile(asOrganisationId(principal.organisationId), asReviewSubjectId(reviewSubjectIdFromRouteParam((await params).id))));
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json({ error: "Unable to read technical profile proposal." }, { status: 500 });
  }
}
export async function POST(_request: Request, { params }: Context) {
  try {
    const principal = await requireVerifiedGovernancePrincipal();
    // No candidate/proposal/tenant/actor coordinates are accepted from the client body.
    const result = await materializeReviewTechnicalProfile(asOrganisationId(principal.organisationId), asReviewSubjectId(reviewSubjectIdFromRouteParam((await params).id)), toGovernanceWritePrincipal(principal));
    return NextResponse.json(result, { status: result.status === "UNAVAILABLE" ? 409 : 200 });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const security = governedWriteErrorResponse(error);
    if (security) return security;
    return NextResponse.json({ error: "Technical profile materialization failed. Verify the reviewed migration, mapping and evidence authorization." }, { status: 409 });
  }
}
