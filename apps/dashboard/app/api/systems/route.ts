import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { createSystemSchema } from "@/lib/validation";
import * as systemService from "@/services/systems";

export async function GET(request: Request) {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { searchParams } = new URL(request.url);

    const systems = await systemService.listSystems(orgId, {
      risk_class: searchParams.get("risk_class") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      lifecycle: searchParams.get("lifecycle") ?? undefined,
      page: Number(searchParams.get("page")) || 1,
      limit: Number(searchParams.get("limit")) || 20,
    });

    return NextResponse.json(systems);
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch systems" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { organisationId: orgId, userId } = await requireVerifiedGovernancePrincipal();
    const body = await request.json();
    const input = createSystemSchema.parse(body);

    const system = await systemService.registerSystem(orgId, userId, input);

    return NextResponse.json({ system }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create system" },
      { status: 400 }
    );
  }
}