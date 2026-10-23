# Local GPU query embedding provider — GPU-Q1

This service is dormant local infrastructure. It implements query computation for the existing `QueryEmbeddingProviderPort`; it is not connected to Talk, routes, application composition, retrieval or any database. It has no governance authority and receives no governance principal. Q1 does not qualify document/query pairing, population, semantic quality, A4, SR2 parity, LX03 closure or production operation. SR2-A1 is not started.

## Prerequisites and identity

Use the external venv qualified in GPU-Q0R, normally `%LOCALAPPDATA%\GovIA\venvs\semantic-gpu`. No repository venv, model files, cache, binaries or new Node/Python web dependencies are included. Standard-library HTTP serving is used.

`runtime-manifest.json` pins Python 3.11.5, torch 2.9.1+cu126, packaged CUDA 12.6, SentenceTransformers 6.2.0, Transformers 5.20.2 and the qualified transitive inference packages. Startup requires this isolated runtime, one RTX 4050 Laptop GPU at CUDA index 0 and compute capability 8.9. FP32 only; no CPU/other-device fallback, autocast, BF16, quantization, ONNX or TensorRT. The NVIDIA driver and installed Toolkit are not modified.

Provider: `LOCAL_GPU_SENTENCE_TRANSFORMERS`. Model: `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`; revision `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`; publisher license Apache-2.0; dimension 384. Projection/query labels remain `GOVIA_SEMANTIC_CONTENT_V1` / `GOVERNANCE_SUBJECT_QUERY_V1` for the existing query-source contract. Using these labels is not a claim that compatible documents have been populated or document/query behavior qualified.

The exact cached snapshot is resolved offline with `local_files_only=True` and verified against the manifest's complete file set and SHA256 hashes measured in Q0R (weight/tokenizer LFS hashes also matched publisher revision metadata). Missing, altered or unexpected artifacts fail startup. `trust_remote_code=False`; no network fallback or implicit download. The cache defaults to `%LOCALAPPDATA%\GovIA\models\huggingface`; trusted operators may set `GOVIA_SEMANTIC_GPU_CACHE` to the equivalent cache root. No client selects a cache/model/revision/device.

Encoding sends the unchanged question to the pinned model's standard mean-pooling pipeline, without embedding normalization. The model's fixed 128-token input window applies even though the transport accepts up to 8192 UTF-8 question bytes. Longer questions can therefore lose trailing model context. Changing this behavior requires a separately reviewed recipe/identity decision. There is no question/embedding persistence or cache in this service.

## Start and stop

From the repository root, in a private local PowerShell session:

```powershell
$gpuPython = Join-Path $env:LOCALAPPDATA 'GovIA\venvs\semantic-gpu\Scripts\python.exe'
$env:GOVIA_SEMANTIC_GPU_TOKEN = (& node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
$env:PYTHONDONTWRITEBYTECODE = '1'
& $gpuPython -B services/semantic-gpu/app.py --port 8765
```

Stop with Ctrl+C; after stopping, remove the token from that shell with `Remove-Item Env:\GOVIA_SEMANTIC_GPU_TOKEN`. Do not print, persist, share or put it in `.env`, Git, logs or the manifest. Generate at least 32 random bytes; the service/adapter accept only 43–128 ASCII base64url/hex-compatible characters. Missing/invalid configuration fails startup; a missing/wrong request token receives generic 401. Authentication uses `hmac.compare_digest`. This token authenticates local transport only, not tenant/governance permission.

The service binds **only `127.0.0.1`**. The host has no configuration option. Only the port (1–65535) is configurable. Do not forward/expose this port. `--stdio-control` is for a trusted parent process: `STOP\n` or parent EOF requests graceful shutdown; there is no remote shutdown endpoint. The service waits for an active bounded inference/handler to finish. It starts no background daemon by default.

## HTTP boundary

- `GET /health`: bounded identity/status only; separates process alive, model ready and CUDA ready. Startup returns 503/STARTING; fully warmed model returns 200/READY. Startup failure closes the service with a generic stderr message and nonzero exit. Health contains no username, paths, environment, tokens, questions or principal data.
- `POST /embed`: header `X-GovIA-Semantic-GPU-Token`; `Content-Type: application/json`; exact JSON object `{"question":"..."}`. No other fields, model hints, principal/session/tenant fields, document recipe or retrieval policy are accepted. Rejects duplicate JSON keys, invalid UTF-8/JSON, blank/non-string input and questions over 8192 UTF-8 bytes. JSON body bound is 65536 bytes to accommodate escaped input. No transfer/content encoding, browser Origin, foreign Host, arbitrary path or file serving.
- Success has exactly `space`, `query_recipe`, `vector`; space has exactly the five existing fields. No confidence/similarity/classification, principal data, paths or GPU diagnostics. Exact dimension and FP32-finite/nonzero output are checked before success. Errors are generic JSON; body/token/stack traces are not logged. No CORS access is granted.
- At most four HTTP handlers, listen backlog four, two-second socket I/O timeout, one inference lock. Busy inference/readiness returns 503 without waiting for the GPU lock. Excess connections are closed at transport level without another thread or an application queue. Rejected bounded request bodies are drained before close so Windows does not hide normal 401/400 responses behind a TCP reset.

The dormant Node factory is `apps/dashboard/lib/governance/local-gpu-query-embedding-provider.ts`. Trusted server code explicitly supplies `{endpoint, token}`; there is no environment-driven default activation. Only the literal form `http://127.0.0.1:<port>` is accepted: no credentials, hostname aliases, other addresses, path, query, fragment or redirects. `node:http` connects directly without a proxy agent/environment proxy or DNS lookup. Response headers are bounded to 8 KiB and body to 32 KiB; unsupported encodings and malformed/non-closed shapes fail transport.

The Node adapter returns an unadmitted provider envelope. Feed it through the unchanged `createQueryEmbeddingSource` with server-pinned exact configuration: that source owns SemanticSpace/recipe equality and finite/nonzero/dimension admission. Its existing five-second timeout remains intact; the transport also has a five-second deadline and honors AbortSignal during the request/body. Cancellation closes HTTP; it does not preempt a running CUDA kernel. Such inference retains the single lock until completion. There is no automatic retry, fallback or query queue.

## Verification

Deterministic Python contract/HTTP tests need only Python 3.11 standard library, no CUDA/model/runtime imports:

```powershell
& $gpuPython -B -m unittest discover -s services/semantic-gpu -p test_app.py -v
node scripts/agent/verify.mjs --base 3429fb53c80aa9c7be95fddc3e7fa3df528d8d1f --profile focused --test apps/dashboard/tests/local-gpu-query-embedding-provider.test.ts
```

Live GPU smoke is an **explicit opt-in**, never an ordinary hardware-dependent CI test:

```powershell
node --conditions=react-server --import tsx apps/dashboard/scripts/local-gpu-query-embedding-smoke.ts --local-gpu
```

The smoke resolves the external venv from LOCALAPPDATA (or trusted `GOVIA_SEMANTIC_GPU_PYTHON`), generates a temporary token, passes only OS/runtime variables to the Python child, starts an ephemeral loopback port, waits for CUDA/model readiness, exercises the actual Node port and existing query source, checks every admitted request under five seconds and reports ten warmed p50/p95 samples. It checks bad/missing token, rejection of extra principal fields, post-stop provider failure and a separate CUDA-disabled startup failing without CPU fallback. It sends `STOP` to cleanly end the primary service. Results go to ignored `.artifacts/agent/gpu-q1-live-smoke.json`; no vector, token or question body is recorded there.

The Node HTTP contract test captures the actual outbound wire object and proves it equals `{question}` with only the dedicated provider token header, no Authorization/Cookie. The live service's closed request parser rejects any extra principal fields; successful live Node/source requests therefore also satisfy that question-only schema. No database/Supabase/session credentials are passed through either request or smoke child environment.

Focused existing semantic adapter tests and dashboard typecheck remain required. No PostgreSQL/full product regression applies to this slice because no persistence/retrieval/authorization implementation changes.

See the bounded [Q1 evidence](../../docs/codex/evidence/2026-10-23-m17.5-c3-sr2-gpu-q1-local-query-provider.md) for measured results and acceptance status. Production integration, document population, quality evaluation and SR2-A1 require separate authorization.
