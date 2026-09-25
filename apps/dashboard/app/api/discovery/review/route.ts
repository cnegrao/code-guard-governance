import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTransition, LifecycleError } from "@/lib/lifecycle";

export async function GET() {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();

    const { data: agents } = await db.read
      .from("agents")
      .select("agent_id, agent_code, name, agent_type, risk_level, status, external_refs, created_at, business_domain")
      .eq("organisation_id", orgId)
      .eq("status", "pending_registration")
      .not("external_refs", "is", null)
      .order("created_at", { ascending: false });

    const discovered = (agents as Array<Record<string, unknown>>) ?? [];

    const { data: approved } = await db.read
      .from("agents")
      .select("agent_id, agent_code, name, agent_type, risk_level, status, external_refs")
      .eq("organisation_id", orgId)
      .in("status", ["registered", "active"])
      .not("external_refs", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);

    return NextResponse.json({
      pending: discovered,
      pendingCount: discovered.length,
      approved: (approved as Array<Record<string, unknown>>) ?? [],
      approvedCount: (approved as Array<Record<string, unknown>>)?.length ?? 0,
    });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const { organisationId: orgId, userId } = await requireVerifiedGovernancePrincipal();
    const { agentId, action } = await request.json();

    if (!agentId || !action) {
      return NextResponse.json({ error: "agentId and action required" }, { status: 400 });
    }

    const status = action === "approve" ? "registered" : action === "activate" ? "active" : action === "reject" ? "decommissioned" : "registered";

    if (action !== "approve" && action !== "activate" && action !== "reject") {
      return NextResponse.json({ error: "action must be approve, activate, or reject" }, { status: 400 });
    }

    // ── Lifecycle enforcement: validate transition from CURRENT status ──
    const { data: current, error: fetchErr } = await db.read
      .from("agents")
      .select("status")
      .eq("organisation_id", orgId)
      .eq("agent_id", agentId)
      .single();
    if (fetchErr || !current) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    try {
      assertTransition((current as { status: string }).status, status);
    } catch (e) {
      if (e instanceof LifecycleError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: 409 });
      }
      throw e;
    }

    const { data, error } = await db.write
      .from("agents")
      .update({ status })
      .eq("organisation_id", orgId)
      .eq("agent_id", agentId)
      .select("agent_id, agent_code, status, name, external_refs")
      .single();

    if (error) throw new Error(error.message);

    const agent = data as Record<string, unknown>;
    const eventType = action === "approve" ? "discovery.agent.approved"
      : action === "activate" ? "discovery.agent.activated"
      : "discovery.agent.rejected";

    try {
      await db.write.rpc("ledger_append", {
        p_event_type: eventType,
        p_event_desc: `${action}: agent ${agent.agent_code}`,
        p_subject_type: "discovery",
        p_subject_id: agentId,
        p_actor_user_id: userId,
        p_actor_ip: null,
        p_organisation_id: orgId,
        p_payload: {
          action,
          status,
          agent_code: agent.agent_code,
          agent_name: agent.name,
          repository: (agent.external_refs as Record<string, Record<string, unknown>>)?.discovery?.repository,
        },
      });
    } catch {}

    return NextResponse.json({ agent, action, status });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Review failed" },
      { status: 500 }
    );
  }
}