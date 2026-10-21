import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import * as talkService from "@/services/talk";
import { toGovernanceWritePrincipal } from "@/lib/auth/governance-write-principal";
import { LedgerWriteUnavailableError } from "@/lib/governance/ledger-write";

export async function POST(request: Request) {
  try {
    const principal = toGovernanceWritePrincipal(await requireVerifiedGovernancePrincipal());

    const { query } = await request.json();
    if (!query || typeof query !== "string" || query.length < 2) {
      return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
    }

    const result = await talkService.ask(principal, query);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LedgerWriteUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Query failed" },
      { status: 500 }
    );
  }
}
