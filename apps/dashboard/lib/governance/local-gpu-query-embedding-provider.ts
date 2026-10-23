import "server-only";
import { request } from "node:http";
import { TextDecoder } from "node:util";
import type { QueryEmbeddingProviderPort, SemanticSpace } from "./semantic-context-retrieval";

export const LOCAL_GPU_SPACE: SemanticSpace = Object.freeze({
  projection_schema_version: "GOVIA_SEMANTIC_CONTENT_V1",
  provider_id: "LOCAL_GPU_SENTENCE_TRANSFORMERS",
  model_id: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
  model_version: "e8f8c211226b894fcb81acc59f3b34ba3efd5f42",
  dimension: 384,
});
export const LOCAL_GPU_TOKEN_HEADER = "x-govia-semantic-gpu-token";
const MAX_RESPONSE_BYTES = 32768;
const spaceKeys = ["projection_schema_version", "provider_id", "model_id", "model_version", "dimension"];
const failure = () => new Error("Local query embedding provider unavailable");
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const closed = (x: Record<string, unknown>, keys: string[]) => Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));

function uniqueJson(text: string): unknown {
  const value: unknown = JSON.parse(text); // Validate grammar before scanning property tokens.
  const containers: (Set<string> | null)[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") containers.push(new Set());
    else if (text[i] === "[") containers.push(null);
    else if (text[i] === "}" || text[i] === "]") containers.pop();
    else if (text[i] === '"') {
      const start = i++;
      for (; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === '"') break;
      }
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] === ":") {
        const keys = containers.at(-1), key = JSON.parse(text.slice(start, i + 1)) as string;
        if (!keys || keys.has(key)) throw failure();
        keys.add(key);
      }
    }
  }
  return value;
}

/** Transport shape only. Exact identity/recipe and numeric vector admission remain in
 * createQueryEmbeddingSource; this output alone is not an admitted query. */
function parseResponse(bytes: Buffer) {
  const x = uniqueJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!record(x) || !closed(x, ["space", "query_recipe", "vector"]) || !record(x.space) || !closed(x.space, spaceKeys) ||
      !spaceKeys.slice(0, 4).every(k => typeof x.space === "object" && typeof (x.space as Record<string, unknown>)[k] === "string" &&
        Buffer.byteLength(String((x.space as Record<string, unknown>)[k]), "utf8") <= 512) ||
      !Number.isInteger(x.space.dimension) || Number(x.space.dimension) < 1 || Number(x.space.dimension) > 16000 ||
      typeof x.query_recipe !== "string" || Buffer.byteLength(x.query_recipe, "utf8") > 512 ||
      !Array.isArray(x.vector) || x.vector.length > 16000 || !x.vector.every(n => typeof n === "number")) throw failure();
  return Object.freeze({
    space: Object.freeze({ ...x.space }) as unknown as SemanticSpace,
    query_recipe: x.query_recipe,
    vector: Object.freeze([...x.vector]) as readonly number[],
  });
}

/** Dormant factory. Configuration is supplied only by trusted server code, never browser input.
 * No ambient env/default provider, composition-root import, proxy agent or redirect handling. */
export function createLocalGpuQueryEmbeddingProvider(configuration: Readonly<{ endpoint: string; token: string }>): QueryEmbeddingProviderPort {
  const match = typeof configuration?.endpoint === "string" && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(configuration.endpoint);
  if (!match || Number(match[1]) > 65535 || typeof configuration.token !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(configuration.token))
    throw new TypeError("Invalid local query embedding configuration");
  const port = Number(match[1]), token = configuration.token;
  return Object.freeze({
    async embedQuestion(question: string, signal: AbortSignal) {
      if (typeof question !== "string" || !question.trim() || Buffer.byteLength(question, "utf8") > 8192) throw new RangeError("Invalid semantic question");
      if (signal.aborted) throw failure();
      // This deliberately constructs the entire wire payload. No principal/session/config is forwarded.
      const body = Buffer.from(JSON.stringify({ question }), "utf8");
      return new Promise<Awaited<ReturnType<QueryEmbeddingProviderPort["embedQuestion"]>>>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const fail = () => {
          if (settled) return;
          settled = true; clearTimeout(timer); reject(failure());
        };
        // node:http does not consult HTTP(S)_PROXY. Literal IPv4 avoids DNS/rebinding.
        const req = request({ hostname: "127.0.0.1", port, path: "/embed", method: "POST", agent: false, signal,
          maxHeaderSize: 8192,
          headers: { "content-type": "application/json", "content-length": body.length, [LOCAL_GPU_TOKEN_HEADER]: token, connection: "close" },
        }, res => {
          const length = res.headers["content-length"], encoding = res.headers["content-encoding"];
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300 ||
              !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(res.headers["content-type"])) ||
              (encoding !== undefined && encoding !== "identity") ||
              (length !== undefined && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > MAX_RESPONSE_BYTES))) {
            fail(); res.destroy(); return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) { fail(); res.destroy(); return; }
            chunks.push(chunk);
          });
          res.on("error", fail); res.on("aborted", fail);
          res.on("end", () => {
            if (settled) return;
            try {
              if (!res.complete || signal.aborted) throw failure();
              const result = parseResponse(Buffer.concat(chunks));
              settled = true; clearTimeout(timer); resolve(result);
            } catch { fail(); }
          });
        });
        req.on("error", fail);
        req.on("upgrade", (_res, socket) => { socket.destroy(); fail(); });
        timer = setTimeout(() => { fail(); req.destroy(); }, 5000);
        req.end(body);
      });
    },
  });
}
