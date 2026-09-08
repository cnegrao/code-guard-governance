import "server-only";

import type { CanonicalObjectKind, OrganisationId } from "@council/canonical-contracts";

import { privilegedDb } from "./persistence";

/**
 * Reconciliation & Materialization Workspace V1 — minimal, read-only,
 * tenant-scoped canonical-object lookup.
 *
 * Closes a real gap: MATCH_EXISTING reconciliation requires a human to pick
 * which already-governed canonical object a certified candidate matches, but
 * no such capability existed anywhere in this codebase before this milestone
 * (no deterministic outcome resolver, no canonical-object search/list API).
 * This is intentionally the narrowest possible new read surface: it lists
 * existing gov_repo.canonical_objects rows for one organisation+kind, plus
 * their currently-active gov_repo.canonical_object_source_mappings (both
 * tables already exist — Canonical Materialization V1, closed). It never
 * accepts a client-supplied canonicalObjectId as authority on its own —
 * decision-commands.ts re-verifies a selected id against this same table
 * before it can be used in a reconciliation command.
 *
 * gov_repo.canonical_objects carries no name/display-name column by design
 * (see its migration comment): a canonical object's only durable
 * human-recognizable signal is the raw source identifier(s) it was bound
 * from. This lookup surfaces exactly that — never a fabricated label.
 */

export interface CanonicalObjectSourceMappingSummary {
  readonly connectionId: string;
  readonly externalType: string;
  readonly externalId: string;
}

export interface CanonicalObjectMatchCandidate {
  readonly canonicalObjectId: string;
  readonly kind: CanonicalObjectKind;
  readonly createdAt: string;
  readonly sourceMappings: readonly CanonicalObjectSourceMappingSummary[];
}

const MATCH_CANDIDATE_LIST_LIMIT = 25;

interface CanonicalObjectRow {
  canonical_object_id: string;
  kind: CanonicalObjectKind;
  created_at: string;
}

interface SourceMappingRow {
  canonical_object_id: string;
  source_connection_id: string;
  source_external_type: string;
  source_external_id: string;
}

async function hydrateSourceMappings(
  organisationId: OrganisationId,
  canonicalObjectIds: readonly string[],
): Promise<Map<string, CanonicalObjectSourceMappingSummary[]>> {
  const byObject = new Map<string, CanonicalObjectSourceMappingSummary[]>();
  if (canonicalObjectIds.length === 0) return byObject;

  const { data, error } = await privilegedDb
    .from("canonical_object_source_mappings")
    .select("canonical_object_id, source_connection_id, source_external_type, source_external_id")
    .eq("organisation_id", organisationId)
    .in("canonical_object_id", [...canonicalObjectIds])
    .is("valid_to", null);
  if (error) throw new Error(`canonical_object_source_mappings query failed: ${error.message}`);

  for (const row of (data ?? []) as SourceMappingRow[]) {
    const summary: CanonicalObjectSourceMappingSummary = {
      connectionId: row.source_connection_id,
      externalType: row.source_external_type,
      externalId: row.source_external_id,
    };
    const existing = byObject.get(row.canonical_object_id);
    if (existing) existing.push(summary);
    else byObject.set(row.canonical_object_id, [summary]);
  }
  return byObject;
}

/** Lists existing governed canonical objects of one kind, for a human to pick a MATCH_EXISTING target from. Tenant- and kind-scoped; never returns another organisation's or another kind's objects. */
export async function listCanonicalObjectsForMatch(
  organisationId: OrganisationId,
  kind: CanonicalObjectKind,
  limit: number = MATCH_CANDIDATE_LIST_LIMIT,
): Promise<CanonicalObjectMatchCandidate[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit) || MATCH_CANDIDATE_LIST_LIMIT, 1), MATCH_CANDIDATE_LIST_LIMIT);

  const { data, error } = await privilegedDb
    .from("canonical_objects")
    .select("canonical_object_id, kind, created_at")
    .eq("organisation_id", organisationId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(boundedLimit);
  if (error) throw new Error(`canonical_objects query failed: ${error.message}`);

  const rows = (data ?? []) as CanonicalObjectRow[];
  const mappingsByObject = await hydrateSourceMappings(
    organisationId,
    rows.map((row) => row.canonical_object_id),
  );

  return rows.map((row) => ({
    canonicalObjectId: row.canonical_object_id,
    kind: row.kind,
    createdAt: row.created_at,
    sourceMappings: mappingsByObject.get(row.canonical_object_id) ?? [],
  }));
}

/**
 * Re-verifies one specific canonicalObjectId against persisted truth before a
 * MATCH_EXISTING command may use it. Never trust a client-supplied id merely
 * because it appeared in a previous listCanonicalObjectsForMatch response —
 * it may have been tampered with, or another operator's decision may have
 * changed the tenant's state since that list was fetched.
 */
export async function getCanonicalObjectForMatch(
  organisationId: OrganisationId,
  kind: CanonicalObjectKind,
  canonicalObjectId: string,
): Promise<CanonicalObjectMatchCandidate | undefined> {
  const { data, error } = await privilegedDb
    .from("canonical_objects")
    .select("canonical_object_id, kind, created_at")
    .eq("organisation_id", organisationId)
    .eq("kind", kind)
    .eq("canonical_object_id", canonicalObjectId)
    .maybeSingle();
  if (error) throw new Error(`canonical_objects lookup failed: ${error.message}`);
  if (!data) return undefined;

  const row = data as CanonicalObjectRow;
  const mappingsByObject = await hydrateSourceMappings(organisationId, [row.canonical_object_id]);
  return {
    canonicalObjectId: row.canonical_object_id,
    kind: row.kind,
    createdAt: row.created_at,
    sourceMappings: mappingsByObject.get(row.canonical_object_id) ?? [],
  };
}
