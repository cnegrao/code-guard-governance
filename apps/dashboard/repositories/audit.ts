import { db } from "@/lib/db";

export interface LedgerEntry {
  entry_sequence: number;
  entry_id: string;
  event_type: string;
  event_description: string;
  subject_type: string;
  subject_id: string;
  actor_user_id: string;
  actor_ip: string | null;
  organisation_id: string;
  event_timestamp: string;
  recorded_at: string;
  previous_hash: string;
  entry_hash: string;
  payload: Record<string, unknown>;
}

export interface LedgerFilters {
  page?: number;
  limit?: number;
  event_type?: string;
  subject_type?: string;
  actor_id?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface LedgerIntegrity {
  total_entries: number;
  latest_sequence: number;
  hash_chain_valid: boolean;
  last_verified_at: string | null;
  entries_last_30_days: number;
  events_by_type: Array<{ event_type: string; count: number }>;
}

export async function getEvents(
  orgId: string,
  filters?: LedgerFilters
): Promise<{ events: LedgerEntry[]; total: number }> {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 50;
  const offset = (page - 1) * limit;

  let query = db.read
    .from("governance_ledger")
    .select("*", { count: "exact", head: false })
    .eq("organisation_id", orgId);

  if (filters?.event_type) {
    query = query.eq("event_type", filters.event_type);
  }
  if (filters?.subject_type) {
    query = query.eq("subject_type", filters.subject_type);
  }
  if (filters?.actor_id) {
    query = query.eq("actor_user_id", filters.actor_id);
  }
  if (filters?.search) {
    query = query.or(
      `event_description.ilike.%${filters.search}%,event_type.ilike.%${filters.search}%`
    );
  }
  if (filters?.dateFrom) {
    query = query.gte("event_timestamp", filters.dateFrom);
  }
  if (filters?.dateTo) {
    query = query.lte("event_timestamp", filters.dateTo);
  }

  const { data, count } = await query
    .order("entry_sequence", { ascending: false })
    .range(offset, offset + limit - 1);

  return {
    events: (data as LedgerEntry[]) ?? [],
    total: count ?? 0,
  };
}

export async function getEventById(
  orgId: string,
  entrySequence: number
): Promise<LedgerEntry | null> {
  const { data } = await db.read
    .from("governance_ledger")
    .select("*")
    .eq("organisation_id", orgId)
    .eq("entry_sequence", entrySequence)
    .single();

  return (data as LedgerEntry) ?? null;
}

export async function getIntegrity(orgId: string): Promise<LedgerIntegrity> {
  const [{ count: total }, { data: latest }, { count: last30Days }, { data: byType }, { data: verifyRows }] =
    await Promise.all([
      db.read
        .from("governance_ledger")
        .select("*", { count: "exact", head: true })
        .eq("organisation_id", orgId),

      db.read
        .from("governance_ledger")
        .select("entry_sequence")
        .eq("organisation_id", orgId)
        .order("entry_sequence", { ascending: false })
        .limit(1),

      db.read
        .from("governance_ledger")
        .select("*", { count: "exact", head: true })
        .eq("organisation_id", orgId)
        .gte("event_timestamp", new Date(Date.now() - 30 * 86400000).toISOString()),

      // governance_ledger is not readable by the anon role: tenant-bound read through the service client.
      db.write
        .from("governance_ledger")
        .select("event_type")
        .eq("organisation_id", orgId),

      db.write.rpc("ledger_verify", {
        p_from_sequence: 1,
        p_to_sequence: null,
      }),
    ]);

  const latestSeq = (latest as Array<{ entry_sequence: number }>)?.[0]?.entry_sequence ?? 0;

  const eventTypes = (byType as Array<LedgerEntry>) ?? [];
  const typeMap = new Map<string, number>();
  for (const e of eventTypes) {
    typeMap.set(e.event_type, (typeMap.get(e.event_type) ?? 0) + 1);
  }
  const eventsByType = Array.from(typeMap.entries())
    .map(([event_type, count]) => ({ event_type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // ledger_verify RETURNS TABLE: one row, delivered as an array.
  const verifyResult = (verifyRows as Array<{ is_valid: boolean; entries_checked: number; first_break_at: number | null; break_reason: string | null }> | null)?.[0] ?? null;

  return {
    total_entries: total ?? 0,
    latest_sequence: latestSeq,
    hash_chain_valid: verifyResult?.is_valid ?? false,
    last_verified_at: new Date().toISOString(),
    entries_last_30_days: last30Days ?? 0,
    events_by_type: eventsByType,
  };
}