"""Dormant, loopback-only CUDA query computation. No database or governance principal."""
import argparse
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import re
import socket
import socketserver
import struct
import sys
import threading

HOST = "127.0.0.1"  # Intentionally not configurable.
TOKEN_HEADER = "X-GovIA-Semantic-GPU-Token"
MAX_BODY_BYTES = 65536  # Allows JSON escaping of an 8192-byte question.
SPACE = {
    "projection_schema_version": "GOVIA_SEMANTIC_CONTENT_V1",
    "provider_id": "LOCAL_GPU_SENTENCE_TRANSFORMERS",
    "model_id": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "model_version": "e8f8c211226b894fcb81acc59f3b34ba3efd5f42",
    "dimension": 384,
}
RECIPE = "GOVERNANCE_SUBJECT_QUERY_V1"
QUALIFICATION = {"python": "3.11.5", "torch": "2.9.1+cu126", "cuda_runtime": "12.6", "sentence-transformers": "6.2.0",
                 "transformers": "5.20.2", "huggingface-hub": "2.3.0", "tokenizers": "0.23.3", "safetensors": "0.8.0", "numpy": "2.4.6"}
DEVICE = {"class": "NVIDIA_CUDA", "index": 0, "count": 1, "name": "NVIDIA GeForce RTX 4050 Laptop GPU", "compute_capability": [8, 9]}
ARTIFACTS = {"config.json", "config_sentence_transformers.json", "model.safetensors", "modules.json", "README.md",
             "sentencepiece.bpe.model", "sentence_bert_config.json", "special_tokens_map.json", "tokenizer.json",
             "tokenizer_config.json", "unigram.json", "1_Pooling/config.json"}


class BoundaryError(Exception):
    """Internal category only; never returned as raw client diagnostics."""


def strict_object(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise BoundaryError("Duplicate JSON key")
        obj[key] = value
    return obj


def decode_json(raw):
    def invalid_constant(_):
        raise BoundaryError("Invalid JSON constant")
    return json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=strict_object, parse_constant=invalid_constant)


def load_manifest(path=None):
    manifest = decode_json((path or Path(__file__).with_name("runtime-manifest.json")).read_bytes())
    expected_keys = {"manifest_version", "space", "query_recipe", "license", "precision", "qualification", "device", "encoding", "artifact_sha256"}
    if (not isinstance(manifest, dict) or set(manifest) != expected_keys or manifest["manifest_version"] != "GOVIA_LOCAL_GPU_QUERY_RUNTIME_V1"
        or manifest["space"] != SPACE or manifest["query_recipe"] != RECIPE or manifest["precision"] != "FP32"
        or manifest["license"] != "Apache-2.0" or manifest["qualification"] != QUALIFICATION or manifest["device"] != DEVICE
        or manifest["encoding"] != {"format": "RAW_QUESTION_UNCHANGED_V1", "max_sequence_length": 128, "normalize_embeddings": False}
        or not isinstance(manifest["artifact_sha256"], dict) or set(manifest["artifact_sha256"]) != ARTIFACTS
        or any(not isinstance(v, str) or not re.fullmatch(r"[0-9a-f]{64}", v) for v in manifest["artifact_sha256"].values())):
        raise BoundaryError("Invalid pinned manifest")
    return manifest


def require_token(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", value):
        raise BoundaryError("Local transport token required")
    return value.encode("ascii")


def parse_question(raw):
    if len(raw) > MAX_BODY_BYTES:
        raise BoundaryError("Request bound")
    value = decode_json(raw)
    if not isinstance(value, dict) or set(value) != {"question"}:
        raise BoundaryError("Question-only shape required")
    question = value["question"]
    if not isinstance(question, str) or not question.strip() or len(question.encode("utf-8", errors="strict")) > 8192:
        raise BoundaryError("Invalid question")
    return question


def embedding_response(vector):
    if (not isinstance(vector, list) or len(vector) != 384 or any(type(v) not in (int, float) or not math.isfinite(v) for v in vector)
        or not math.isfinite(sum(v * v for v in vector))):
        raise BoundaryError("Invalid vector")
    try:
        fp32 = [struct.unpack("f", struct.pack("f", v))[0] for v in vector]
    except (OverflowError, struct.error):
        raise BoundaryError("Invalid vector") from None
    if any(not math.isfinite(v) for v in fp32) or not any(v != 0 for v in fp32):
        raise BoundaryError("Invalid vector")
    return {"space": dict(SPACE), "query_recipe": RECIPE, "vector": vector}


def require_cuda(torch):
    if (not torch.cuda.is_available() or torch.cuda.device_count() != 1 or torch.version.cuda != "12.6"
        or torch.cuda.get_device_name(0) != DEVICE["name"] or list(torch.cuda.get_device_capability(0)) != [8, 9]):
        raise BoundaryError("Qualified CUDA device required")
    torch.cuda.set_device(0)


def verify_snapshot(snapshot, manifest):
    snapshot = Path(snapshot)
    if snapshot.name != SPACE["model_version"]:
        raise BoundaryError("Wrong snapshot revision")
    actual = {p.relative_to(snapshot).as_posix() for p in snapshot.rglob("*") if p.is_file()}
    if actual != ARTIFACTS:
        raise BoundaryError("Incomplete or unexpected model artifacts")
    for name, digest in manifest["artifact_sha256"].items():
        with (snapshot / name).open("rb") as content:
            if hashlib.file_digest(content, "sha256").hexdigest() != digest:
                raise BoundaryError("Model artifact integrity failure")


def resolve_snapshot(cache, manifest, resolver):
    snapshot = resolver(SPACE["model_id"], revision=SPACE["model_version"], cache_dir=Path(cache) / "hub",
                        allow_patterns=sorted(ARTIFACTS), local_files_only=True)
    expected = Path(cache) / "hub" / ("models--" + SPACE["model_id"].replace("/", "--")) / "snapshots" / SPACE["model_version"]
    if Path(snapshot).resolve() != expected.resolve():
        raise BoundaryError("Wrong model snapshot")
    verify_snapshot(snapshot, manifest)
    return snapshot


class CudaRuntime:
    def __init__(self, manifest):
        self.manifest = manifest
        self.ready = self.model_ready = self.cuda_ready = False
        self.failed = False
        self.startup_stage = "RUNTIME"
        self.inference_lock = threading.Lock()

    def load(self):
        if platform.python_version() != QUALIFICATION["python"] or sys.prefix == sys.base_prefix:
            raise BoundaryError("Qualified isolated Python required")
        for name, version in QUALIFICATION.items():
            if name not in ("python", "cuda_runtime") and importlib.metadata.version(name) != version:
                raise BoundaryError("Unqualified package revision")
        # Set before importing Hub/Transformers; neither resolution nor model loading may use network.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        os.environ["TOKENIZERS_PARALLELISM"] = "false"
        cache = os.environ.get("GOVIA_SEMANTIC_GPU_CACHE")
        if not cache:
            local = os.environ.get("LOCALAPPDATA")
            if not local:
                raise BoundaryError("Model cache configuration required")
            cache = str(Path(local) / "GovIA" / "models" / "huggingface")
        os.environ["HF_HOME"] = cache
        self.startup_stage = "IMPORT"
        import torch
        from huggingface_hub import snapshot_download
        from sentence_transformers import SentenceTransformer
        self.startup_stage = "CUDA"
        require_cuda(torch)
        self.cuda_ready = True
        torch.set_num_threads(min(8, os.cpu_count() or 1))
        torch.set_float32_matmul_precision("highest")
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        self.startup_stage = "SNAPSHOT"
        snapshot = resolve_snapshot(cache, self.manifest, snapshot_download)
        self.torch = torch
        self.startup_stage = "MODEL"
        self.model = SentenceTransformer(snapshot, device="cuda:0", local_files_only=True, trust_remote_code=False)
        self.model.eval().float()
        if self.model.get_embedding_dimension() != 384 or self.model.max_seq_length != 128:
            raise BoundaryError("Wrong model encoding")
        self.verify_parameters()
        self.model_ready = True
        self.startup_stage = "WARMUP"
        self.embed("Synthetic local CUDA readiness query.")
        self.ready = True

    def verify_parameters(self):
        if not self.torch.cuda.is_available() or any(p.device.type != "cuda" or p.device.index != 0 or
            (p.is_floating_point() and p.dtype != self.torch.float32) for p in self.model.parameters()):
            raise BoundaryError("CUDA FP32 required")

    def embed(self, question):
        self.verify_parameters()
        with self.torch.inference_mode():
            vectors = self.model.encode([question], batch_size=1, device="cuda:0", show_progress_bar=False,
                                        convert_to_numpy=True, normalize_embeddings=False)
            self.torch.cuda.synchronize(0)
        if vectors.shape != (1, 384) or str(vectors.dtype) != "float32":
            raise BoundaryError("Wrong CUDA output")
        return embedding_response(vectors[0].tolist())

    def health(self):
        return {"status": "READY" if self.ready else "UNAVAILABLE" if self.failed else "STARTING", "process_alive": True,
                "model_ready": self.model_ready, "cuda_ready": self.cuda_ready, "provider_id": SPACE["provider_id"],
                "model_id": SPACE["model_id"], "model_version": SPACE["model_version"], "dimension": 384,
                "device_class": "NVIDIA_CUDA", "precision": "FP32"}


class LocalServer(socketserver.ThreadingMixIn, HTTPServer):
    request_queue_size = 4
    daemon_threads = False
    block_on_close = True

    def __init__(self, port, runtime, token):
        self.runtime, self.token = runtime, require_token(token)
        self.slots = threading.BoundedSemaphore(4)
        super().__init__((HOST, port), Handler)

    def get_request(self):
        sock, address = super().get_request()
        sock.settimeout(2)
        return sock, address

    def process_request(self, sock, address):
        if not self.slots.acquire(blocking=False):
            # Capacity exhaustion closes at transport level; no extra handler/thread/queue.
            self.shutdown_request(sock)
            return
        try:
            super().process_request(sock, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, sock, address):
        try:
            super().process_request_thread(sock, address)
        finally:
            self.slots.release()

    def handle_error(self, *_):
        pass  # Never emit request contents, token, paths or stack traces.


class Handler(BaseHTTPRequestHandler):
    server_version = "GovIA-Local-Semantic"
    sys_version = ""
    body_consumed = False

    def log_message(self, *_):
        pass

    def send_error(self, code, message=None, explain=None):
        self.respond(code, {"error": "invalid_request"})

    def respond(self, status, value):
        if status >= 400 and not self.body_consumed:
            # Drain only bounded, declared data before close. On Windows, closing with
            # an unread body can reset TCP before the generic response reaches the caller.
            lengths = self.headers.get_all("Content-Length", []) if hasattr(self, "headers") else []
            if len(lengths) == 1 and re.fullmatch(r"[1-9][0-9]{0,5}", lengths[0]):
                length = int(lengths[0])
                try:
                    if length <= MAX_BODY_BYTES:
                        self.rfile.read(length)
                    else:
                        self.rfile.read1(8192)
                except OSError:
                    pass
            self.body_consumed = True
        data = json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.wfile.flush()
        if status >= 400:
            try:
                self.connection.shutdown(socket.SHUT_WR)
            except OSError:
                pass

    def local_headers(self):
        if (len(self.headers) > 16 or sum(len(k) + len(v) for k, v in self.headers.items()) > 8192
            or self.headers.get_all("Host") != [f"{HOST}:{self.server.server_port}"] or self.headers.get("Origin") is not None):
            self.respond(400, {"error": "invalid_request"})
            return False
        return True

    def do_GET(self):
        if not self.local_headers():
            return
        if self.path != "/health":
            self.respond(404, {"error": "not_found"})
            return
        self.respond(200 if self.server.runtime.ready else 503, self.server.runtime.health())

    def do_POST(self):
        if not self.local_headers():
            return
        if self.path != "/embed":
            self.respond(404, {"error": "not_found"})
            return
        supplied = self.headers.get_all(TOKEN_HEADER, [])
        try:
            authenticated = len(supplied) == 1 and hmac.compare_digest(supplied[0].encode("ascii"), self.server.token)
        except UnicodeError:
            authenticated = False
        if not authenticated:
            self.respond(401, {"error": "unauthorized"})
            return
        lengths = self.headers.get_all("Content-Length", [])
        types = self.headers.get_all("Content-Type", [])
        if (self.headers.get("Transfer-Encoding") is not None or self.headers.get("Content-Encoding") is not None or len(lengths) != 1
            or not re.fullmatch(r"[1-9][0-9]{0,5}", lengths[0]) or types != ["application/json"]):
            self.respond(400, {"error": "invalid_request"})
            return
        length = int(lengths[0])
        if length > MAX_BODY_BYTES:
            self.respond(413, {"error": "invalid_request"})
            return
        try:
            self.body_consumed = True
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise BoundaryError("Incomplete request")
            question = parse_question(raw)
        except (BoundaryError, ValueError, UnicodeError, OSError, RecursionError):
            self.respond(400, {"error": "invalid_request"})
            return
        runtime = self.server.runtime
        if not runtime.ready or not runtime.inference_lock.acquire(blocking=False):
            self.respond(503, {"error": "unavailable"})
            return
        try:
            output = runtime.embed(question)
            # Revalidate even an injected test runtime's output before returning an envelope.
            if set(output) != {"space", "query_recipe", "vector"} or output["space"] != SPACE or output["query_recipe"] != RECIPE:
                raise BoundaryError("Wrong output identity")
            self.respond(200, embedding_response(output["vector"]))
        except Exception:
            runtime.ready = False
            runtime.failed = True
            runtime.cuda_ready = False
            self.respond(503, {"error": "unavailable"})
        finally:
            runtime.inference_lock.release()


def main():
    parser = argparse.ArgumentParser(description="Local-only CUDA query embedding provider")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--stdio-control", action="store_true", help="Trusted parent sends STOP on stdin for graceful shutdown")
    args = parser.parse_args()
    server = None
    try:
        if not 1 <= args.port <= 65535:
            raise BoundaryError("Invalid port")
        manifest = load_manifest()
        token = os.environ.get("GOVIA_SEMANTIC_GPU_TOKEN")
        require_token(token)
        runtime = CudaRuntime(manifest)
        server = LocalServer(args.port, runtime, token)

        def control():
            # Start only after third-party imports/readiness. A blocking stdin reader
            # can hold TextIO locks needed by library console/isatty initialization.
            for line in sys.stdin:
                if line == "STOP\n":
                    break
            server.shutdown()

        def initialize():
            try:
                runtime.load()
                if args.stdio_control:
                    threading.Thread(target=control, daemon=True).start()
            except Exception:
                runtime.ready = False
                runtime.failed = True
                print(f"Local GPU provider startup unavailable ({runtime.startup_stage})", file=sys.stderr, flush=True)
                server.shutdown()

        loader = threading.Thread(target=initialize, daemon=False)
        loader.start()
        try:
            server.serve_forever(poll_interval=0.1)
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
            loader.join()
        return 1 if runtime.failed else 0
    except Exception:
        if server:
            server.server_close()
        print("Local GPU provider startup unavailable", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
