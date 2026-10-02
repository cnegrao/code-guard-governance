import { db } from "@/lib/db";

export interface SearchResult {
  id: string;
  type: "agent" | "system" | "incident" | "finding";
  title: string;
  subtitle: string;
  risk_level?: string;
  status?: string;
  url: string | null;
}

export async function searchAll(
  orgId: string,
  query: string
): Promise<SearchResult[]> {
  const term = `%${query}%`;

  const [agents, systems, incidents] = await Promise.all([
    db.write
      .from("agents")
      .select("agent_id, agent_code, name, description, risk_level, status")
      .eq("organisation_id", orgId)
      .neq("status", "decommissioned")
      .or(`name.ilike.${term},description.ilike.${term},agent_code.ilike.${term}`)
      .limit(10).throwOnError(),

    db.write
      .from("ai_systems")
      .select("system_id, system_code, name, description, risk_class, status")
      .eq("organisation_id", orgId)
      .neq("status", "decommissioned")
      .or(`name.ilike.${term},description.ilike.${term},system_code.ilike.${term}`)
      .limit(5).throwOnError(),

    db.write
      .from("ict_incidents")
      .select("incident_id, incident_code, title, description, severity, status")
      .eq("organisation_id", orgId)
      .or(`title.ilike.${term},description.ilike.${term},incident_code.ilike.${term}`)
      .limit(5).throwOnError(),
  ]);

  const results: SearchResult[] = [];

  for (const a of (agents.data as Array<Record<string, string>>) ?? []) {
    results.push({
      id: a.agent_id,
      type: "agent",
      title: a.name,
      subtitle: `${a.agent_code} · ${a.status}`,
      risk_level: a.risk_level,
      status: a.status,
      url: `/agents/${a.agent_id}`,
    });
  }

  for (const s of (systems.data as Array<Record<string, string>>) ?? []) {
    results.push({
      id: s.system_id,
      type: "system",
      title: s.name,
      subtitle: `${s.system_code} · ${s.status}`,
      risk_level: s.risk_class,
      status: s.status,
      url: `/systems/${s.system_id}`,
    });
  }

  for (const i of (incidents.data as Array<Record<string, string>>) ?? []) {
    results.push({
      id: i.incident_id,
      type: "incident",
      title: i.title,
      subtitle: `${i.incident_code} · ${i.status}`,
      risk_level: i.severity,
      status: i.status,
      url: null,
    });
  }

  return results;
}