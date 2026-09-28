import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import * as talkService from "@/services/talk";

export async function POST(request: Request) {
  try {
    const { organisationId: orgId, userId } = await requireVerifiedGovernancePrincipal();
    if (!orgId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { query } = await request.json();
    if (!query || typeof query !== "string" || query.length < 2) {
      return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
    }

    const result = await talkService.ask(orgId, userId, query);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Query failed" },
      { status: 500 }
    );
  }
}