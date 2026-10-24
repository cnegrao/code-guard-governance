import "server-only";
import type { VerifiedGovernancePrincipal } from "../auth/session-token";
import { parseCredentialEpochMillis } from "../auth/credential-epoch";
import type { SemanticSqlClient, SemanticSqlPool } from "./semantic-context-retrieval";
import { isAdmittedTechnicalQuery, type TechnicalQueryEmbeddingIdentity } from "./technical-query-embedding";
import { isResolvedTechnicalScope, type ResolvedTechnicalScope } from "./technical-context-scope";
import { parseTechnicalContextResult, TechnicalAuthorizationError, TechnicalInputError, TechnicalTransportError,
  type TechnicalContextResult } from "./technical-context-contract";

export interface TechnicalRetrievalOptions {
  readonly limit: number;
  readonly threshold: number;
  readonly policy_version: "EXACT_COSINE_V1";
}
export interface TechnicalRetrievalPort {
  retrieveTechnicalContext(principal: VerifiedGovernancePrincipal, scope: ResolvedTechnicalScope,
    query: TechnicalQueryEmbeddingIdentity, options: TechnicalRetrievalOptions): Promise<TechnicalContextResult>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const timeout = () => new TechnicalTransportError("QUERY_TIMEOUT");
/** A dedicated server-owned connection. Factory is deliberately absent from product composition. */
export function createTechnicalRetrievalAdapter(pool: SemanticSqlPool): TechnicalRetrievalPort {
  return Object.freeze({ async retrieveTechnicalContext(principal: VerifiedGovernancePrincipal, scope: ResolvedTechnicalScope,
    query: TechnicalQueryEmbeddingIdentity, options: TechnicalRetrievalOptions) {
    if (!principal || typeof principal.organisationId !== "string" || !uuid.test(principal.organisationId) ||
        typeof principal.userId !== "string" || !uuid.test(principal.userId) || typeof principal.credentialEpoch !== "string" ||
        !Number.isFinite(parseCredentialEpochMillis(principal.credentialEpoch)) || !Number.isSafeInteger(principal.issuedAtSeconds) ||
        !Number.isSafeInteger(principal.expiresAtSeconds) || principal.issuedAtSeconds < 0 ||
        principal.expiresAtSeconds <= principal.issuedAtSeconds) throw new TechnicalAuthorizationError();
    if (!isResolvedTechnicalScope(scope)) throw new TechnicalInputError("INVALID_SCOPE");
    if (scope.organisation_id !== principal.organisationId) throw new TechnicalAuthorizationError();
    if (!isAdmittedTechnicalQuery(query)) throw new TechnicalInputError("INVALID_QUERY_EMBEDDING");
    if (!options || Reflect.ownKeys(options).length !== 3 || !["limit", "threshold", "policy_version"].every(k => Object.hasOwn(options, k)) ||
        !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 20 || typeof options.threshold !== "number" ||
        !Number.isFinite(options.threshold) || options.threshold < -1 || options.threshold > 1 || options.policy_version !== "EXACT_COSINE_V1")
      throw new TechnicalInputError("INVALID_OPTIONS");
    const params = [principal.organisationId, principal.userId, principal.issuedAtSeconds, principal.expiresAtSeconds, principal.credentialEpoch,
      scope.repository_id, scope.snapshot_id, `[${query.vector.join(",")}]`, query.space.provider_id, query.space.model_id,
      query.space.model_version, query.space.dimension, query.space.projection_schema_version, query.query_recipe, options.limit, options.threshold];
    const deadline = performance.now() + 5000;
    let expired = false, client: SemanticSqlClient | undefined, released = false, committed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = (destroy: boolean) => { if (client && !released) { released = true; client.release(destroy); } };
    const remaining = () => {
      const millis = Math.floor(deadline - performance.now());
      if (expired || millis < 1) { expired = true; throw timeout(); }
      return Math.min(5000, millis);
    };
    const sql = async (statement: string, values?: unknown[]) => {
      remaining(); const answer = await client!.query(statement, values); remaining(); return answer;
    };
    const work = async () => {
      try {
        const connection = await pool.connect();
        if (expired || performance.now() >= deadline) { connection.release(true); throw timeout(); }
        client = connection;
        await sql("BEGIN ISOLATION LEVEL READ COMMITTED");
        await sql(`SET LOCAL statement_timeout='${remaining()}ms'`);
        await sql("SET LOCAL lock_timeout='5s'");
        // Reset to the remaining whole-acquisition budget immediately before selection.
        await sql(`SET LOCAL statement_timeout='${remaining()}ms'`);
        const response = await sql("SELECT gov_repo.technical_semantic_context_search_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS result", params);
        if (!response || !Array.isArray(response.rows) || response.rows.length !== 1 || !response.rows[0] ||
            Reflect.ownKeys(response.rows[0]).length !== 1 || !Object.hasOwn(response.rows[0], "result"))
          throw new TechnicalTransportError("MALFORMED_RESULT");
        const result = parseTechnicalContextResult(response.rows[0].result, principal.organisationId, scope, query.space, options.limit);
        remaining(); await sql("COMMIT"); committed = true;
        return result;
      } catch (error) {
        if (expired || performance.now() >= deadline) throw timeout();
        if (error instanceof TechnicalTransportError || error instanceof TechnicalAuthorizationError || error instanceof TechnicalInputError) throw error;
        const fault = error !== null && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
        const code = typeof fault.code === "string" ? fault.code : undefined;
        if (code && (/^GV00[1-5]$/.test(code) || code === "55P03")) throw new TechnicalAuthorizationError();
        if (["22P02", "22000", "22003"].includes(code ?? "")) throw new TechnicalInputError("INVALID_QUERY_EMBEDDING");
        if (code === "22023") {
          if (fault.message === "INVALID_TECHNICAL_OPTIONS") throw new TechnicalInputError("INVALID_OPTIONS");
          if (fault.message === "INVALID_TECHNICAL_SCOPE") throw new TechnicalInputError("INVALID_SCOPE");
          if (fault.message === "INVALID_TECHNICAL_QUERY") throw new TechnicalInputError("INVALID_QUERY_EMBEDDING");
          throw new TechnicalTransportError("INTERNAL_ERROR");
        }
        throw new TechnicalTransportError(code === "57014" ? "QUERY_TIMEOUT" : code && !/^08/.test(code) ? "INTERNAL_ERROR" : "TRANSPORT_ERROR");
      } finally {
        if (client && !released && !committed && !expired) {
          try { await sql("ROLLBACK"); } catch { release(true); }
        }
        release(expired || !committed);
      }
    };
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { expired = true; release(true); reject(timeout()); }, 5000);
      })]);
    } finally { clearTimeout(timer); }
  } });
}
