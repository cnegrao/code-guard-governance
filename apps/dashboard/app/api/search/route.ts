import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import * as searchService from "@/services/search";

export async function GET(request: Request) {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";

    if (q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const results = await searchService.search(orgId, q);

    return NextResponse.json({ results, query: q });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}