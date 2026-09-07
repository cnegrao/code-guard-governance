import { NextResponse } from "next/server";
import { asOrganisationId } from "@council/canonical-contracts";
import { REVIEW_STATE, type ReviewState } from "@council/governance-review";

import { getOrgId } from "@/lib/session";
import {
  REVIEW_QUEUE_DEFAULT_PAGE_SIZE,
  REVIEW_QUEUE_MAX_PAGE_SIZE,
  listReviewQueue,
} from "@/lib/governance/workspace-query";

const VALID_STATES = new Set<string>(Object.values(REVIEW_STATE));

// Mirrors gov_repo.canonical_objects_kind_check plus the RELATIONSHIP
// candidate kind — the exact closed set of candidateKind values this schema
// can ever contain (packages/canonical-contracts DiscoveryCandidateKind).
const VALID_CANDIDATE_KINDS = new Set([
  "AGENT",
  "AGENT_VERSION",
  "MODEL",
  "TOOL",
  "MCP_SERVER",
  "API",
  "PROMPT",
  "KNOWLEDGE_BASE",
  "DATA_ASSET",
  "DATA_ELEMENT",
  "SKILL",
  "RELATIONSHIP",
]);

export async function GET(request: Request) {
  try {
    const orgId = await getOrgId();
    const { searchParams } = new URL(request.url);

    const stateParam = searchParams.get("state") ?? undefined;
    if (stateParam && !VALID_STATES.has(stateParam)) {
      return NextResponse.json({ error: "Invalid state filter." }, { status: 400 });
    }

    const kindParam = searchParams.get("kind") ?? undefined;
    if (kindParam && !VALID_CANDIDATE_KINDS.has(kindParam)) {
      return NextResponse.json({ error: "Invalid kind filter." }, { status: 400 });
    }

    const searchParam = searchParams.get("search") ?? undefined;
    if (searchParam && searchParam.length > 200) {
      return NextResponse.json({ error: "Search term is too long." }, { status: 400 });
    }

    const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(
      REVIEW_QUEUE_MAX_PAGE_SIZE,
      Math.max(1, Number.parseInt(searchParams.get("pageSize") ?? String(REVIEW_QUEUE_DEFAULT_PAGE_SIZE), 10) || REVIEW_QUEUE_DEFAULT_PAGE_SIZE),
    );

    const result = await listReviewQueue(asOrganisationId(orgId), {
      state: stateParam as ReviewState | undefined,
      candidateKind: kindParam,
      sourceConnectionId: searchParams.get("source") ?? undefined,
      search: searchParam,
      page,
      pageSize,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("governance workspace queue query failed", error);
    return NextResponse.json({ error: "Unable to load the governance review queue." }, { status: 500 });
  }
}
