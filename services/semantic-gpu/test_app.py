"""Deterministic contract tests: standard library only, no GPU/imported ML runtime."""
import copy
import hashlib
import http.client
import json
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import app

TOKEN = "a" * 64  # Public deterministic test credential; never a service default.


class ContractTests(unittest.TestCase):
    def test_manifest_is_closed_and_exact(self):
        manifest = app.load_manifest()
        self.assertEqual(manifest["space"], app.SPACE)
        mutations = [
            lambda m: m.update(precision="FP16"), lambda m: m.update(query_recipe="DOCUMENT"),
            lambda m: m["space"].update(model_version="latest"), lambda m: m["space"].update(model_id="other"),
            lambda m: m["space"].update(provider_id="other"), lambda m: m["space"].update(dimension=383),
            lambda m: m["space"].update(projection_schema_version="other"), lambda m: m["space"].update(extra="unsafe"),
            lambda m: m["qualification"].update(torch="2.9.1"), lambda m: m["device"].update(index=1),
            lambda m: m.update(token=TOKEN), lambda m: m["artifact_sha256"].update({"../unsafe": "0" * 64}),
            lambda m: m["artifact_sha256"].update({"model.safetensors": "unknown"}),
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            for mutate in mutations:
                value = copy.deepcopy(manifest)
                mutate(value)
                path.write_text(json.dumps(value), encoding="utf-8")
                with self.subTest(value=value), self.assertRaises(app.BoundaryError):
                    app.load_manifest(path)

    def test_token_required_and_bounded(self):
        for token in (None, "", "short", "a" * 42, "a" * 129, "a" * 63 + "\n", "é" * 64):
            with self.subTest(token=token), self.assertRaises(app.BoundaryError):
                app.require_token(token)
        self.assertEqual(app.require_token(TOKEN), TOKEN.encode())
        with self.assertRaises(app.BoundaryError):
            app.LocalServer(0, None, None)

    def test_request_closure_size_and_utf8(self):
        values = [b"{", b"null", b"[]", b'"question"', b'{"question":NaN}', b'{"question":1}', b'{"question":true}',
                  b'{"question":""}', b'{"question":"  "}', b'{"question":"q","tenant":"x"}',
                  b'{"question":"q","question":"other"}', b'{"question":"\\ud800"}', b'{"question":"\xff"}',
                  json.dumps({"question": "é" * 4097}).encode(), b"x" * (app.MAX_BODY_BYTES + 1)]
        for raw in values:
            with self.subTest(raw=raw[:80]), self.assertRaises((app.BoundaryError, ValueError, UnicodeError)):
                app.parse_question(raw)
        question = "é" * 4096
        self.assertEqual(app.parse_question(json.dumps({"question": question}).encode()), question)

    def test_vector_and_response_are_closed(self):
        vector = [0.25] * 384
        response = app.embedding_response(vector)
        self.assertEqual(set(response), {"space", "query_recipe", "vector"})
        self.assertEqual(response["space"], app.SPACE)
        self.assertEqual(response["query_recipe"], app.RECIPE)
        for bad in ([0.] * 384, [1e-100] * 384, [1e100] * 384, [1.] * 383, [float("nan")] * 384,
                    [float("inf")] * 384, [True] * 384, ["1"] * 384):
            with self.subTest(bad=bad[:1]), self.assertRaises(app.BoundaryError):
                app.embedding_response(bad)

    def test_cuda_is_required_without_fallback_or_device_substitution(self):
        def cuda(**overrides):
            values = dict(is_available=Mock(return_value=True), device_count=Mock(return_value=1),
                          get_device_name=Mock(return_value=app.DEVICE["name"]), get_device_capability=Mock(return_value=(8, 9)), set_device=Mock())
            values.update(overrides)
            return SimpleNamespace(cuda=SimpleNamespace(**values), version=SimpleNamespace(cuda="12.6"), cpu=Mock())
        good = cuda()
        app.require_cuda(good)
        good.cuda.set_device.assert_called_once_with(0)
        for bad in [cuda(is_available=Mock(return_value=False)), cuda(device_count=Mock(return_value=2)),
                    cuda(get_device_name=Mock(return_value="other GPU")), cuda(get_device_capability=Mock(return_value=(8, 6)))]:
            with self.subTest(device=bad), self.assertRaises(app.BoundaryError):
                app.require_cuda(bad)
            bad.cuda.set_device.assert_not_called()
            bad.cpu.assert_not_called()

    def test_parameter_precision_and_device_cannot_fall_back(self):
        runtime = app.CudaRuntime(app.load_manifest())
        runtime.torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True), float32="fp32")
        for device, dtype in [("cpu", "fp32"), ("cuda", "fp16"), ("cuda", "bf16")]:
            runtime.model = SimpleNamespace(parameters=lambda: [SimpleNamespace(device=SimpleNamespace(type=device, index=0),
                dtype=dtype, is_floating_point=lambda: True)])
            with self.subTest(device=device, dtype=dtype), self.assertRaises(app.BoundaryError):
                runtime.verify_parameters()

    def test_offline_resolution_revision_and_artifact_integrity(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory) / "hub" / ("models--" + app.SPACE["model_id"].replace("/", "--")) / "snapshots" / app.SPACE["model_version"]
            manifest = app.load_manifest()
            for name in app.ARTIFACTS:
                path = snapshot / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"fixture")
                manifest["artifact_sha256"][name] = hashlib.sha256(b"fixture").hexdigest()
            resolver = Mock(return_value=str(snapshot))
            self.assertEqual(app.resolve_snapshot(directory, manifest, resolver), str(snapshot))
            resolver.assert_called_once_with(app.SPACE["model_id"], revision=app.SPACE["model_version"], cache_dir=Path(directory) / "hub",
                                             allow_patterns=sorted(app.ARTIFACTS), local_files_only=True)
            missing = Mock(side_effect=FileNotFoundError("unavailable pinned revision"))
            with self.assertRaises(FileNotFoundError):
                app.resolve_snapshot(directory, manifest, missing)
            self.assertEqual(missing.call_count, 1)
            (snapshot / "model.safetensors").write_bytes(b"modified")
            with self.assertRaises(app.BoundaryError):
                app.verify_snapshot(snapshot, manifest)
            (snapshot / "model.safetensors").write_bytes(b"fixture")
            (snapshot / "adapter_config.json").write_bytes(b"unexpected")
            with self.assertRaises(app.BoundaryError):
                app.verify_snapshot(snapshot, manifest)

    def test_stdio_control_cannot_block_library_imports_before_readiness(self):
        runtime = FakeRuntime()
        runtime.ready = False
        runtime.load = Mock(side_effect=lambda: setattr(runtime, "ready", True))
        pending, controls = [], []
        case = self

        class ScheduledThread:
            def __init__(self, target, daemon):
                self.target = target
                if target.__name__ == "control":
                    case.assertTrue(runtime.ready, "stdin reader must not start during imports/model initialization")
                    runtime.load.assert_called_once()
                    controls.append(target)

            def start(self):
                if self.target.__name__ == "initialize":
                    pending.append(self.target)

            def join(self):
                pass

        server = Mock()
        server.serve_forever.side_effect = lambda **_: pending.pop()()
        with patch.object(app, "CudaRuntime", return_value=runtime), patch.object(app, "LocalServer", return_value=server), \
             patch.object(app.threading, "Thread", ScheduledThread), patch.object(app.sys, "argv", ["app.py", "--stdio-control"]), \
             patch.dict(os.environ, {"GOVIA_SEMANTIC_GPU_TOKEN": TOKEN}):
            self.assertEqual(app.main(), 0)
        self.assertEqual(len(controls), 1)


class FakeRuntime(app.CudaRuntime):
    def __init__(self):
        super().__init__(app.load_manifest())
        self.ready = self.model_ready = self.cuda_ready = True
        self.calls = []
        self.output = None

    def embed(self, question):
        self.calls.append(question)
        return self.output if self.output is not None else app.embedding_response([0.25] * 384)


class HttpContractTests(unittest.TestCase):
    def setUp(self):
        self.runtime = FakeRuntime()
        self.server = app.LocalServer(0, self.runtime, TOKEN)
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=.01))
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.assertFalse(self.thread.is_alive())

    def request(self, path="/embed", body=b'{"question":"synthetic q"}', headers=None, method="POST"):
        headers = {"Content-Type": "application/json", app.TOKEN_HEADER: TOKEN, **(headers or {})}
        connection = http.client.HTTPConnection(app.HOST, self.server.server_port, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers)
            result = connection.getresponse()
            return result.status, json.loads(result.read())
        finally:
            connection.close()

    def test_loopback_binding_and_exact_success(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        status, output = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(output, app.embedding_response([0.25] * 384))
        self.assertEqual(self.runtime.calls, ["synthetic q"])

    def test_bad_and_missing_token_are_generic(self):
        for token in ("", "b" * 64):
            self.assertEqual(self.request(headers={app.TOKEN_HEADER: token}), (401, {"error": "unauthorized"}))
        connection = http.client.HTTPConnection(app.HOST, self.server.server_port, timeout=3)
        connection.request("POST", "/embed", b'{}', {"Content-Type": "application/json"})
        response = connection.getresponse()
        self.assertEqual((response.status, json.loads(response.read())), (401, {"error": "unauthorized"}))
        connection.close()
        self.assertEqual(self.runtime.calls, [])

    def test_bad_http_shape_never_enters_inference(self):
        for headers in [{"Content-Type": "text/plain"}, {"Content-Length": str(app.MAX_BODY_BYTES + 1)},
                        {"Host": "attacker.example"}, {"Origin": "http://attacker.example"},
                        {"Content-Encoding": "gzip"}, {"Transfer-Encoding": "chunked"}]:
            with self.subTest(headers=headers):
                self.assertIn(self.request(body=b'{}', headers=headers)[0], (400, 413))
        for raw in (b'{', b'{"question":""}', b'{"question":"q","tenant":"private"}', b'{"question":1}'):
            self.assertEqual(self.request(body=raw), (400, {"error": "invalid_request"}))
        self.assertEqual(self.request(path="/embed?model=other")[0], 404)
        self.assertEqual(self.runtime.calls, [])

    def test_readiness_is_separate_and_redacted(self):
        self.runtime.ready = self.runtime.model_ready = self.runtime.cuda_ready = False
        status, health = self.request(path="/health", body=None, method="GET")
        self.assertEqual(status, 503)
        self.assertEqual(health["status"], "STARTING")
        self.assertTrue(health["process_alive"])
        self.assertFalse(health["model_ready"])
        self.assertFalse(health["cuda_ready"])
        self.assertEqual(set(health), {"status", "process_alive", "model_ready", "cuda_ready", "provider_id", "model_id",
            "model_version", "dimension", "device_class", "precision"})
        self.assertEqual(self.request()[0], 503)
        self.assertEqual(self.runtime.calls, [])

    def test_busy_inference_has_no_queue(self):
        self.runtime.inference_lock.acquire()
        try:
            self.assertEqual(self.request(), (503, {"error": "unavailable"}))
        finally:
            self.runtime.inference_lock.release()
        self.assertEqual(self.runtime.calls, [])

    def test_connection_slots_are_bounded(self):
        for _ in range(4):
            self.assertTrue(self.server.slots.acquire(blocking=False))
        try:
            with self.assertRaises((ConnectionError, http.client.RemoteDisconnected)):
                self.request()
        finally:
            for _ in range(4):
                self.server.slots.release()

    def test_runtime_failure_is_unavailable_without_raw_details(self):
        with patch.object(self.runtime, "embed", side_effect=RuntimeError("private-path-and-token")):
            self.assertEqual(self.request(), (503, {"error": "unavailable"}))
        self.assertFalse(self.runtime.ready)

    def test_wrong_runtime_identity_and_vector_cannot_escape(self):
        for output in [dict(app.embedding_response([1.] * 384), confidence=1),
                       dict(app.embedding_response([1.] * 384), space={**app.SPACE, "model_version": "other"}),
                       dict(app.embedding_response([1.] * 384), query_recipe="OTHER"),
                       dict(app.embedding_response([1.] * 384), vector=[0.] * 384)]:
            self.runtime.output, self.runtime.ready = output, True
            self.assertEqual(self.request(), (503, {"error": "unavailable"}))


if __name__ == "__main__":
    unittest.main()
