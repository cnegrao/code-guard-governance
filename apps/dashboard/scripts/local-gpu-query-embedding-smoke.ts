/** Explicit opt-in local qualification; never imported by an application route/composition root. */
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalGpuQueryEmbeddingProvider, LOCAL_GPU_SPACE, LOCAL_GPU_TOKEN_HEADER } from "../lib/governance/local-gpu-query-embedding-provider";
import { createQueryEmbeddingSource, QUERY_RECIPE } from "../lib/governance/semantic-context-retrieval";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(repo, "services/semantic-gpu/runtime-manifest.json"), "utf8"));
const question = "Pergunta sintética de qualificação: como registrar a proveniência de uma revisão técnica de IA?";
const config = { space: LOCAL_GPU_SPACE, query_recipe: QUERY_RECIPE, model_version_verified: true as const };
let stage = "PREFLIGHT";

async function unusedPort() {
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const address = probe.address(); assert.ok(address && typeof address === "object");
  await new Promise<void>(resolve => probe.close(() => resolve())); return address.port;
}

function start(python: string, port: number, token: string, noCuda = false) {
  // The child needs OS/DLL paths, not the parent's complete environment or application credentials.
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "LOCALAPPDATA", "SystemDrive", "PROGRAMFILES", "PROGRAMFILES(X86)"])
    if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { PYTHONDONTWRITEBYTECODE: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_PROGRESS_BARS: "1",
    GOVIA_SEMANTIC_GPU_TOKEN: token });
  if (process.env.GOVIA_SEMANTIC_GPU_CACHE) env.GOVIA_SEMANTIC_GPU_CACHE = process.env.GOVIA_SEMANTIC_GPU_CACHE;
  if (noCuda) env.CUDA_VISIBLE_DEVICES = "-1";
  const child = spawn(python, [join(repo, "services/semantic-gpu/app.py"), "--port", String(port), "--stdio-control"], {
    cwd: repo, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  child.on("error", () => { /* Report only a generic smoke failure, never executable/user paths. */ });
  child.stdin.on("error", () => { /* Process exit is checked separately. */ });
  let diagnosticBytes = 0;
  let diagnosticTail = "";
  // Count bounded diagnostics, never persist child output (may contain third-party filesystem notices).
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data: Buffer) => {
    diagnosticBytes += data.length;
    diagnosticTail = (diagnosticTail + data.toString("utf8")).slice(-4096);
    const category = /Local GPU provider startup unavailable \((RUNTIME|IMPORT|CUDA|SNAPSHOT|MODEL|WARMUP)\)/.exec(diagnosticTail);
    if (category) { console.error(`Provider startup check: ${category[1]}`); diagnosticTail = ""; }
    if (diagnosticBytes > 65536) child.kill();
  });
  return child;
}

async function stop(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  const exited = once(child, "exit");
  child.stdin.end("STOP\n");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [code] = await Promise.race([exited, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { child.kill(); reject(new Error("Provider did not stop gracefully")); }, 15000);
    })]);
    return code;
  } finally { clearTimeout(timer); }
}

function localJson(port: number, path: string, token?: string, body?: object): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const bytes = body && Buffer.from(JSON.stringify(body));
    const req = request({ hostname: "127.0.0.1", port, path, method: bytes ? "POST" : "GET", agent: false,
      signal: AbortSignal.timeout(5000), headers: bytes ? { "content-type": "application/json", "content-length": bytes.length,
        ...(token ? { [LOCAL_GPU_TOKEN_HEADER]: token } : {}) } : {},
    }, res => {
      let size = 0; const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 32768) { res.destroy(); reject(new Error("Response bound")); } else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => { try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); } catch { reject(new Error("Malformed local response")); } });
    });
    req.on("error", reject); req.end(bytes);
  });
}

async function readiness(child: ChildProcessWithoutNullStreams, port: number) {
  const deadline = performance.now() + 60000;
  let observation: Record<string, unknown> = {};
  while (performance.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Provider exited before readiness");
    try {
      const result = await localJson(port, "/health");
      observation = { http_status: result.status, model_ready: result.data.model_ready === true, cuda_ready: result.data.cuda_ready === true };
      if (result.status === 200) return result.data;
    } catch (error) {
      observation = { transport: error instanceof Error ? error.name : "Error" };
    }
    await delay(200);
  }
  console.error(`Readiness observation: ${JSON.stringify(observation)}`);
  throw new Error("Provider readiness timeout");
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--local-gpu") throw new Error("Explicit --local-gpu opt-in required");
  const python = process.env.GOVIA_SEMANTIC_GPU_PYTHON ?? (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "GovIA/venvs/semantic-gpu/Scripts/python.exe"));
  if (!python) throw new Error("Qualified external Python executable required");
  assert.deepEqual(manifest.space, LOCAL_GPU_SPACE);
  const token = randomBytes(32).toString("hex");
  const port = await unusedPort();
  const child = start(python, port, token);
  const results: Record<string, unknown> = { scope: "LOCAL_GPU_QUERY_ONLY", binding: "127.0.0.1", port,
    space: LOCAL_GPU_SPACE, precision: "FP32", question_payload_keys: ["question"], principal_fields_sent: false };
  let stopped = false;
  try {
    stage = "READINESS";
    const health = await readiness(child, port);
    assert.deepEqual(health, { status: "READY", process_alive: true, model_ready: true, cuda_ready: true,
      provider_id: LOCAL_GPU_SPACE.provider_id, model_id: LOCAL_GPU_SPACE.model_id, model_version: LOCAL_GPU_SPACE.model_version,
      dimension: 384, device_class: "NVIDIA_CUDA", precision: "FP32" });
    stage = "TOKEN_AND_REQUEST_CONTRACT";
    assert.equal((await localJson(port, "/embed", "b".repeat(64), { question })).status, 401);
    assert.equal((await localJson(port, "/embed", undefined, { question })).status, 401);
    assert.equal((await localJson(port, "/embed", token, { question, tenant: "forbidden-synthetic-field" })).status, 400);
    const acquire = createQueryEmbeddingSource(config, createLocalGpuQueryEmbeddingProvider({ endpoint: `http://127.0.0.1:${port}`, token }));
    const times: number[] = [];
    stage = "LIVE_QUERY_ADMISSION";
    for (let i = 0; i < 11; i++) {
      const startTime = performance.now();
      const result = await acquire(question);
      const duration = performance.now() - startTime;
      assert.ok("query" in result);
      assert.deepEqual(result.query.space, LOCAL_GPU_SPACE);
      assert.equal(result.query.query_recipe, QUERY_RECIPE);
      assert.equal(result.query.vector.length, 384);
      assert.ok(result.query.vector.every(Number.isFinite)); assert.ok(result.query.vector.some(n => Math.fround(n) !== 0));
      assert.ok(duration < 5000, "Every admitted query must fit the existing provider budget");
      if (i === 0) results.first_admitted_ms = duration;
      else times.push(duration);
    }
    const sorted = [...times].sort((a, b) => a - b);
    Object.assign(results, { health, warm_iterations: times.length, warm_times_ms: times, p50_ms: (sorted[4] + sorted[5]) / 2,
      p95_ms: sorted[Math.ceil(.95 * sorted.length) - 1], max_warm_ms: sorted.at(-1), bad_token: "PASS", missing_token: "PASS", unexpected_principal_field: "REJECTED" });
    stage = "GRACEFUL_STOP";
    assert.equal(await stop(child), 0); stopped = true;
    stage = "UNAVAILABLE";
    assert.deepEqual(await acquire(question), { unavailable: "PROVIDER_FAILURE" });
    results.unavailable_fails_closed = true;
  } finally { if (!stopped) await stop(child); }

  const negativePort = await unusedPort();
  stage = "CUDA_DISABLED_STARTUP";
  const negative = start(python, negativePort, token, true);
  try {
    const exit = once(negative, "exit");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const [code] = await Promise.race([exit, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("CUDA-disabled runtime failed to stop")), 60000);
      })]);
      assert.equal(code, 1); results.cuda_disabled_startup = "FAILED_CLOSED_NO_CPU_FALLBACK";
    } finally { clearTimeout(timer); }
  } finally { if (negative.exitCode === null) await stop(negative); }
  const artifact = join(repo, ".artifacts/agent/gpu-q1-live-smoke.json");
  mkdirSync(dirname(artifact), { recursive: true });
  results.outcome = "PASS";
  writeFileSync(artifact, JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
}

main().catch(() => { console.error(`Local GPU smoke failed at ${stage}; no credentials or question diagnostics emitted`); process.exitCode = 1; });
