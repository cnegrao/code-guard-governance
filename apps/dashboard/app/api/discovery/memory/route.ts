import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { semanticSearch, codingMemoryRepo } from "@/services/coding-memory";

export async function GET(request: Request) {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query");
    const repositoryId = searchParams.get("repository_id");
    const action = searchParams.get("action") ?? "search";

    if (action === "repo" && repositoryId) {
      const chunks = await codingMemoryRepo.getRepositoryMemory(orgId, repositoryId);
      return NextResponse.json({ chunks, total: chunks.length });
    }

    if (action === "search" && query) {
      const result = await semanticSearch(orgId, query, 10);
      return NextResponse.json({ result, empty: !result });
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