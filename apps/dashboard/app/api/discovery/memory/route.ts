import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { CODING_MEMORY_UNAVAILABLE } from "@/lib/talk-retrieval-state";

export async function GET(request: Request) {
  try {
    await requireVerifiedGovernancePrincipal();
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query");
    const repositoryId = searchParams.get("repository_id");
    const action = searchParams.get("action") ?? "search";

    if ((action === "repo" && repositoryId) || (action === "search" && query)) {
      // Legacy chunks have no admitted SR2 projection. The adjacent repo mode is not a fallback.
      return NextResponse.json(CODING_MEMORY_UNAVAILABLE);
    }

    return NextResponse.json({ error: "action=search requires query, action=repo requires repository_id" }, { status: 400 });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Memory query failed" },
      { status: 500 }
    );
  }
}