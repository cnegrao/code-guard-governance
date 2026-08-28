import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/session";
import * as talkService from "@/services/talk";

export async function POST(request: Request) {
  try {
    const { organisationId, userId } = await getSessionContext();

    const { query } = await request.json();
    if (!query || typeof query !== "string" || query.length < 2) {
      return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
    }

    const result = await talkService.ask(organisationId, userId, query);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Query failed" },
      { status: 500 }
    );
  }
}
