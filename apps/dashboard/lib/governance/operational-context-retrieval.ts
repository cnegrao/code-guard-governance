import "server-only";
import type { VerifiedGovernancePrincipal } from "../auth/session-token";
import { parseCredentialEpochMillis } from "../auth/credential-epoch";
import type { SemanticSqlClient, SemanticSqlPool } from "./semantic-context-retrieval";
import { isAdmittedOperationalQuery, type OperationalQueryEmbeddingIdentity } from "./operational-query-embedding";
import { parseOperationalContextResult, OperationalAuthorizationError, OperationalInputError, OperationalTransportError,
  type OperationalContextResult } from "./operational-context-contract";

export interface OperationalRetrievalOptions {
  readonly limit: number; readonly threshold: number; readonly policy_version: "EXACT_COSINE_V1";
}
export interface OperationalRetrievalPort {
  retrieveOperationalContext(principal: VerifiedGovernancePrincipal, query: OperationalQueryEmbeddingIdentity,
    options: OperationalRetrievalOptions): Promise<OperationalContextResult>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timeout = () => new OperationalTransportError("QUERY_TIMEOUT");

/** Dedicated server-owned connection. No composition root imports this dormant adapter in A3. */
export function createOperationalRetrievalAdapter(pool: SemanticSqlPool): OperationalRetrievalPort {
  return Object.freeze({ async retrieveOperationalContext(principal: VerifiedGovernancePrincipal,
    query: OperationalQueryEmbeddingIdentity, options: OperationalRetrievalOptions) {
    if (!principal || typeof principal.organisationId !== "string" || !uuid.test(principal.organisationId) ||
        typeof principal.userId !== "string" || !uuid.test(principal.userId) || typeof principal.credentialEpoch !== "string" ||
        !Number.isFinite(parseCredentialEpochMillis(principal.credentialEpoch)) || !Number.isSafeInteger(principal.issuedAtSeconds) ||
        !Number.isSafeInteger(principal.expiresAtSeconds) || principal.issuedAtSeconds < 0 ||
        principal.expiresAtSeconds <= principal.issuedAtSeconds) throw new OperationalAuthorizationError();
    if (!isAdmittedOperationalQuery(query)) throw new OperationalInputError("INVALID_QUERY_EMBEDDING");
    if (!options || Reflect.ownKeys(options).length !== 3 || !["limit", "threshold", "policy_version"].every(k => Object.hasOwn(options, k)) ||
        !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 20 || typeof options.threshold !== "number" ||
        !Number.isFinite(options.threshold) || options.threshold < -1 || options.threshold > 1 || options.policy_version !== "EXACT_COSINE_V1")
      throw new OperationalInputError("INVALID_OPTIONS");
    const params = [principal.organisationId, principal.userId, principal.issuedAtSeconds, principal.expiresAtSeconds,
      principal.credentialEpoch, `[${query.vector.join(",")}]`, query.space.provider_id, query.space.model_id,
      query.space.model_version, query.space.dimension, query.space.projection_schema_version, query.query_recipe,
      options.limit, options.threshold];
    const deadline = performance.now() + 5000; let expired = false, client: SemanticSqlClient | undefined;
    let released = false, committed = false, timer: ReturnType<typeof setTimeout> | undefined;
    const release = (destroy: boolean) => { if (client && !released) { released = true; client.release(destroy); } };
    const remaining = () => { const millis = Math.floor(deadline - performance.now());
      if (expired || millis < 1) { expired = true; throw timeout(); } return Math.min(5000, millis); };
    const sql = async (statement: string, values?: unknown[]) => {
      remaining(); const answer = await client!.query(statement, values); remaining(); return answer;
    };
    const work = async () => {
      try {
        const connection = await pool.connect();
        if (expired || performance.now() >= deadline) { connection.release(true); throw timeout(); }
        client = connection; await sql("BEGIN ISOLATION LEVEL READ COMMITTED");
        await sql(`SET LOCAL statement_timeout='${remaining()}ms'`); await sql("SET LOCAL lock_timeout='5s'");
        await sql(`SET LOCAL statement_timeout='${remaining()}ms'`);
        const response = await sql("SELECT gov_repo.operational_agent_semantic_context_search_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS result", params);
        if (!response || !Array.isArray(response.rows) || response.rows.length !== 1 || !response.rows[0] ||
            Reflect.ownKeys(response.rows[0]).length !== 1 || !Object.hasOwn(response.rows[0], "result"))
          throw new OperationalTransportError("MALFORMED_RESULT");
        const result = parseOperationalContextResult(response.rows[0].result, principal.organisationId, query.space, options.limit);
        remaining(); await sql("COMMIT"); committed = true; return result;
      } catch (error) {
        if (expired || performance.now() >= deadline) throw timeout();
        if (error instanceof OperationalTransportError || error instanceof OperationalAuthorizationError || error instanceof OperationalInputError) throw error;
        const fault = error !== null && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
        const code = typeof fault.code === "string" ? fault.code : undefined;
        if (code && (/^GV00[1-5]$/.test(code) || code === "55P03")) throw new OperationalAuthorizationError();
        if (["22P02", "22000", "22003"].includes(code ?? "")) throw new OperationalInputError("INVALID_QUERY_EMBEDDING");
        if (code === "22023") {
          if (fault.message === "INVALID_OPERATIONAL_OPTIONS") throw new OperationalInputError("INVALID_OPTIONS");
          if (fault.message === "INVALID_OPERATIONAL_QUERY") throw new OperationalInputError("INVALID_QUERY_EMBEDDING");
          throw new OperationalTransportError("INTERNAL_ERROR");
        }
        throw new OperationalTransportError(code === "57014" ? "QUERY_TIMEOUT" : code && !/^08/.test(code) ? "INTERNAL_ERROR" : "TRANSPORT_ERROR");
      } finally {
        if (client && !released && !committed && !expired) { try { await sql("ROLLBACK"); } catch { release(true); } }
        release(expired || !committed);
      }
    };
    try { return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; release(true); reject(timeout()); }, 5000);
    })]); } finally { clearTimeout(timer); }
  } });
}
