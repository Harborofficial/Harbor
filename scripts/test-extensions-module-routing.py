"""Exercise module routing and crash recovery with an isolated deterministic backend."""
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import unittest
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parent.parent
STAGE = ROOT / "src-tauri/resources/capstan"
MANIFEST = json.loads((STAGE / "extensions-module.json").read_text())
EXE = "harbor-extensions-module.exe" if os.name == "nt" else "harbor-extensions-module"
FIXTURE = ROOT / "src-tauri/extensions-module/target/debug" / ("extensions-test-runtime.exe" if os.name == "nt" else "extensions-test-runtime")


@contextmanager
def session():
    with tempfile.TemporaryDirectory(prefix="extensions-routing-") as temp:
        root = Path(temp)
        shutil.copy2(STAGE / EXE, root / EXE)
        (root / "capstan.jar").write_bytes(b"fixture")
        data = root / "data"
        child = subprocess.Popen(
            [str(root / EXE), "--abi", "2", "--host-version", MANIFEST["version"], "--data-dir", str(data)],
            env={**os.environ, "HARBOR_JAVA": str(FIXTURE)},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        incoming = queue.Queue()
        def collect():
            for line in child.stdout:
                incoming.put(json.loads(line))
        reader = threading.Thread(target=collect, daemon=True)
        reader.start()
        def send(frame):
            child.stdin.write(json.dumps(frame) + "\n")
            child.stdin.flush()
        def receive():
            return incoming.get(timeout=15)
        child.stdin.write("start\n")
        child.stdin.flush()
        try:
            yield send, receive, data
        finally:
            child.stdin.close()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
                raise
            reader.join(timeout=5)
            child.stdout.close()
            child.stderr.close()


class RoutingTests(unittest.TestCase):
    def test_read_retries_after_backend_exit(self):
        with session() as (send, receive, data):
            send({"id":"read","command":"capstan_search","args":{"providerId":"p","query":"retry"}})
            self.assertEqual(receive(), {"id":"read","result":{"attempts":2}})
            self.assertEqual((data / "read-attempts").read_text(), "2")

    def test_mutation_not_replayed_and_next_call_recovers(self):
        with session() as (send, receive, data):
            send({"id":"write","command":"capstan_install","args":{"path":"fixture"}})
            self.assertIn("stopped before answering", receive()["error"])
            self.assertEqual((data / "mutation-attempts").read_text(), "1")
            send({"id":"ping","command":"capstan_ping","args":{}})
            self.assertTrue(receive()["result"]["pong"])

    def test_challenge_roundtrip_uses_generic_host_service(self):
        with session() as (send, receive, _):
            send({"id":"load","command":"capstan_load","args":{"providerId":"p","url":"challenge"}})
            service = receive()
            self.assertEqual(service["service"], "browser.clearance")
            self.assertEqual(service["params"]["url"], "https://example.test/challenge")
            send({"id":service["id"],"result":{"cookie":"test-clearance","userAgent":"test-agent"}})
            self.assertEqual(receive(), {"id":"load","result":{"cookie":"test-clearance","userAgent":"test-agent"}})

    def test_host_errors_keep_extension_error_contract(self):
        with session() as (send, receive, _):
            send({"id":"load","command":"capstan_load","args":{"providerId":"p","url":"challenge"}})
            service = receive()
            send({"id":service["id"],"error":"denied"})
            self.assertEqual(receive(), {"id":"load","error":"extension_error: denied"})

    def test_unknown_callback_never_reaches_host(self):
        with session() as (send, receive, _):
            send({"id":"load","command":"capstan_load","args":{"providerId":"p","url":"unknown"}})
            answer = receive()
            self.assertEqual(answer["id"], "load")
            self.assertTrue(answer["error"].startswith("unknown_method:"))

    def test_invalid_command_does_not_start_backend(self):
        with session() as (send, receive, data):
            send({"id":"unknown","command":"execute","args":{}})
            self.assertIn("Unknown extension command", receive()["error"])
            self.assertFalse(data.exists())

    def test_concurrent_requests_preserve_ids_and_arguments(self):
        with session() as (send, receive, _):
            for i in range(20):
                send({"id":str(i),"command":"capstan_search","args":{"providerId":"p","query":str(i)}})
            answers = [receive() for _ in range(20)]
            self.assertEqual({a["id"] for a in answers}, {str(i) for i in range(20)})
            for answer in answers:
                self.assertEqual(answer["id"], answer["result"]["params"]["query"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
