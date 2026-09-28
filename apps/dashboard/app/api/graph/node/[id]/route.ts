import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import * as graphService from "@/services/graph";
import { db } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { id } = await params;

    const traversal = await graphService.getTraversal(orgId, id, 5);

    if (traversal.length > 0) {
      const ids = traversal.map((t) => t.agent_id);
      const { count } = await db.read
        .from("agents")
        .select("*", { count: "exact", head: true })
        .eq("organisation_id", orgId)
        .in("agent_id", ids);

      if ((count ?? 0) !== ids.length) {
        return NextResponse.json(
          { error: "Cross-tenant traversal detected. Some nodes belong to other organisations." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json({ node_id: id, traversal });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load node" },
      { status: 500 }
    );
  }
}