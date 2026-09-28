import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import * as auditService from "@/services/audit";

export async function GET(request: Request) {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { searchParams } = new URL(request.url);

    const result = await auditService.getEvents(orgId, {
      page: Number(searchParams.get("page")) || 1,
      limit: Number(searchParams.get("limit")) || 50,
      event_type: searchParams.get("event_type") ?? undefined,
      subject_type: searchParams.get("subject_type") ?? undefined,
      actor_id: searchParams.get("actor_id") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      dateFrom: searchParams.get("date_from") ?? undefined,
      dateTo: searchParams.get("date_to") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load events" },
      { status: 500 }
    );
  }
}