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

// Keep both public pages and internal chunks within supabase/config.toml api.max_rows.
const AUDIT_PAGE_SIZE = 1000;

export async function getEvents(
  orgId: string,
  filters?: LedgerFilters
): Promise<{ events: LedgerEntry[]; total: number }> {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 50;
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("Audit page must be a positive safe integer");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > AUDIT_PAGE_SIZE) {
    throw new RangeError(`Audit limit must be an integer between 1 and ${AUDIT_PAGE_SIZE}`);
  }
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset + limit - 1)) {
    throw new RangeError("Audit page range exceeds safe integer bounds");
  }

  // The anon client cannot read the canonical ledger; bind the tenant on the service client.
  let query = db.write
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
    // Operator layer: escape PostgreSQL regex metacharacters so user input is literal.
    // imatch (~*) is case-insensitive and unanchored (substring); no .* wrapper is needed.
    // Unlike ILIKE, imatch does not translate user '*' to '%'; '%' and '_' stay literal.
    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // C/POSIX locales need not fold non-ASCII letters with ~*. Encode simple
    // one-codepoint case pairs explicitly, keeping input literal (including É/é).
    const literal = Array.from(filters.search, character => {
      const upper = character.toUpperCase(), lower = character.toLowerCase();
      if (character.codePointAt(0)! > 127 && upper !== lower
        && Array.from(upper).length === 1 && Array.from(lower).length === 1) {
        return `(${escapeRegex(upper)}|${escapeRegex(lower)})`;
      }
      return escapeRegex(character);
    }).join("");
    // Grammar layer: quote the complete value and escape regex backslashes and quotes
    // for PostgREST. Its decoder must recover `literal` exactly. Supabase URL-encodes it.
    const pattern = `"${literal.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    query = query.or(
      `event_description.imatch.${pattern},event_type.imatch.${pattern}`
    );
  }
  if (filters?.dateFrom) {
    query = query.gte("event_timestamp", filters.dateFrom);
  }
  if (filters?.dateTo) {
    query = query.lte("event_timestamp", filters.dateTo);
  }

  const { data, count, error } = await query
    .order("entry_sequence", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);

  return {
    events: (data as LedgerEntry[]) ?? [],
    total: count ?? 0,
  };
}

export async function getEventById(
  orgId: string,
  entrySequence: number
): Promise<LedgerEntry | null> {
  const { data, error } = await db.write
    .from("governance_ledger")
    .select("*")
    .eq("organisation_id", orgId)
    .eq("entry_sequence", entrySequence)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return (data as LedgerEntry) ?? null;
}

async function getEventTypeCounts(orgId: string) {
  const typeMap = new Map<string, number>();
  for (let offset = 0; ; offset += AUDIT_PAGE_SIZE) {
    const { data, error } = await db.write
      .from("governance_ledger")
      .select("event_type")
      .eq("organisation_id", orgId)
      .order("entry_sequence", { ascending: true })
      .range(offset, offset + AUDIT_PAGE_SIZE - 1);
    // Any chunk failure rejects the entire result, never a partial aggregate.
    if (error) throw new Error(error.message);
    const rows = (data as Array<{ event_type: string }>) ?? [];
    for (const row of rows) {
      typeMap.set(row.event_type, (typeMap.get(row.event_type) ?? 0) + 1);
    }
    if (rows.length < AUDIT_PAGE_SIZE) break;
  }
  return {
    data: Array.from(typeMap, ([event_type, count]) => ({ event_type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    error: null,
  };
}

export async function getIntegrity(orgId: string): Promise<LedgerIntegrity> {
  const results =
    await Promise.all([
      db.write
        .from("governance_ledger")
        .select("*", { count: "exact", head: true })
        .eq("organisation_id", orgId),

      db.write
        .from("governance_ledger")
        .select("entry_sequence")
        .eq("organisation_id", orgId)
        .order("entry_sequence", { ascending: false })
        .limit(1),

      db.write
        .from("governance_ledger")
        .select("*", { count: "exact", head: true })
        .eq("organisation_id", orgId)
        .gte("event_timestamp", new Date(Date.now() - 30 * 86400000).toISOString()),

      getEventTypeCounts(orgId),

      db.write.rpc("ledger_verify", {
        p_from_sequence: 1,
        p_to_sequence: null,
      }),
    ]);

  // Missing rows are valid empty results; a failed query must not become a false metric.
  for (const result of results) {
    if (result.error) throw new Error(result.error.message);
  }
  const [{ count: total }, { data: latest }, { count: last30Days }, { data: byType }, { data: verifyRows }] = results;

  const latestSeq = (latest as Array<{ entry_sequence: number }>)?.[0]?.entry_sequence ?? 0;

  // ledger_verify RETURNS TABLE: one row, delivered as an array.
  const verifyResult = (verifyRows as Array<{ is_valid: boolean; entries_checked: number; first_break_at: number | null; break_reason: string | null }> | null)?.[0] ?? null;

  return {
    total_entries: total ?? 0,
    latest_sequence: latestSeq,
    hash_chain_valid: verifyResult?.is_valid ?? false,
    last_verified_at: new Date().toISOString(),
    entries_last_30_days: last30Days ?? 0,
    events_by_type: byType,
  };
}
