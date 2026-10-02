import { db } from "@/lib/db";

export interface CodingMemoryChunk {
  memory_id: string;
  path: string;
  symbol_type: string;
  symbol_name: string;
  summary: string;
  metadata: Record<string, unknown>;
  similarity?: number;
}

export interface CodingMemorySearchResult {
  chunks: CodingMemoryChunk[];
  total: number;
}

export async function storeChunk(
  orgId: string,
  repositoryId: string,
  chunk: {
    path: string;
    symbol_type: string;
    symbol_name: string;
    summary: string;
    embedding: number[];
    metadata: Record<string, unknown>;
  }
): Promise<string | null> {
  try {
    const { data, error } = await db.write
      .from("coding_memory")
      .insert({
        organisation_id: orgId,
        repository_id: repositoryId,
        path: chunk.path,
        symbol_type: chunk.symbol_type,
        symbol_name: chunk.symbol_name,
        summary: chunk.summary,
        embedding: chunk.embedding,
        metadata: chunk.metadata,
      })
      .select("memory_id")
      .single();

    if (error) throw new Error(error.message);
    return (data as { memory_id: string })?.memory_id ?? null;
  } catch {
    return null;
  }
}

export async function storeChunks(
  orgId: string,
  repositoryId: string,
  chunks: Array<{
    path: string;
    symbol_type: string;
    symbol_name: string;
    summary: string;
    embedding: number[];
    metadata: Record<string, unknown>;
  }>
): Promise<number> {
  let stored = 0;
  for (const chunk of chunks) {
    const id = await storeChunk(orgId, repositoryId, chunk);
    if (id) stored++;
  }
  return stored;
}

export async function searchSimilar(
  orgId: string,
  embedding: number[],
  limit: number = 10,
  threshold: number = 0.5
): Promise<CodingMemorySearchResult> {
  try {
    const { data } = await db.write.rpc("coding_memory_search", {
      p_organisation_id: orgId,
      p_embedding: embedding,
      p_limit: limit,
      p_threshold: threshold,
    }).throwOnError();

    const chunks = (data as Array<Record<string, unknown>>) ?? [];
    return {
      chunks: chunks.map((c) => ({
        memory_id: c.memory_id as string,
        path: c.path as string,
        symbol_type: c.symbol_type as string,
        symbol_name: c.symbol_name as string,
        summary: c.summary as string,
        metadata: (c.metadata as Record<string, unknown>) ?? {},
        similarity: c.similarity as number,
      })),
      total: chunks.length,
    };
  } catch {
    throw new Error("Coding memory read failed");
  }
}

export async function getRepositoryMemory(
  orgId: string,
  repositoryId: string
): Promise<CodingMemoryChunk[]> {
  try {
    const { data } = await db.write
      .from("coding_memory")
      .select("memory_id, path, symbol_type, symbol_name, summary, metadata")
      .eq("organisation_id", orgId)
      .eq("repository_id", repositoryId)
      .order("created_at", { ascending: false })
      .limit(100).throwOnError();

    return ((data as Array<Record<string, unknown>>) ?? []).map((c) => ({
      memory_id: c.memory_id as string,
      path: c.path as string,
      symbol_type: c.symbol_type as string,
      symbol_name: c.symbol_name as string,
      summary: c.summary as string,
      metadata: (c.metadata as Record<string, unknown>) ?? {},
    }));
  } catch {
    throw new Error("Coding memory read failed");
  }
}

export async function deleteRepositoryMemory(
  orgId: string,
  repositoryId: string
): Promise<number> {
  try {
    const { error, count } = await db.write
      .from("coding_memory")
      .delete({ count: "exact" })
      .eq("organisation_id", orgId)
      .eq("repository_id", repositoryId);

    if (error) throw new Error(error.message);
    return count ?? 0;
  } catch {
    return 0;
  }
}
