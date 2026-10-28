"""Native Extensions integration checks against the staged runtime; uses temporary data only."""
import json
import queue
import threading
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
STAGE = ROOT / "src-tauri" / "resources" / "capstan"
MANIFEST = json.loads((STAGE / "extensions-module.json").read_text())
EXE = "harbor-extensions-module.exe" if "windows" in MANIFEST["target"] else "harbor-extensions-module"


def run(directory, data, content="", abi="2", version=MANIFEST["version"]):
    return subprocess.run(
        [str(directory / EXE), "--abi", abi, "--host-version", version, "--data-dir", str(data)],
        input=content, text=True, capture_output=True, timeout=25,
    )


def exchange(directory, data):
    frames = [
        {"id": "ping", "command": "capstan_ping", "args": {}},
        {"id": "extensions", "command": "capstan_extensions", "args": {}},
        {"id": "providers", "command": "capstan_providers", "args": {}},
    ]
    child = subprocess.Popen(
        [str(directory / EXE), "--abi", "2", "--host-version", MANIFEST["version"], "--data-dir", str(data)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    incoming = queue.Queue()
    def collect():
        for line in child.stdout:
            incoming.put(line)
    reader = threading.Thread(target=collect, daemon=True)
    reader.start()
    replies = {}
    try:
        child.stdin.write("start\n" + "".join(json.dumps(frame) + "\n" for frame in frames))
        child.stdin.flush()
        while len(replies) < len(frames):
            frame = json.loads(incoming.get(timeout=20))
            replies[frame["id"]] = frame
        child.stdin.close()
        self_exit = child.wait(timeout=10)
        assert self_exit == 0, child.stderr.read()
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        reader.join(timeout=5)
        child.stdout.close()
        child.stderr.close()
        if not child.stdin.closed:
            child.stdin.close()
    assert replies["ping"]["result"]["pong"]
    assert "result" in replies["extensions"]
    assert "result" in replies["providers"]
    return replies


class ExtensionsModuleTests(unittest.TestCase):
    def test_describe(self):
        result = subprocess.run([str(STAGE / EXE), "--describe"], capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout), {
            "kind": "harbor-extensions", "abi": 2, "version": MANIFEST["version"],
        })

    def test_incompatible_hosts_do_not_touch_data(self):
        with tempfile.TemporaryDirectory(prefix="harbor-extensions-test-") as tmp:
            data = Path(tmp) / "untouched"
            for abi, version in [("3", MANIFEST["version"]), ("2", "0.0.0")]:
                with self.subTest(abi=abi, version=version):
                    result = run(STAGE, data, "start\n", abi=abi, version=version)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("incompatible", result.stderr)
                    self.assertFalse(data.exists())

    def test_startup_requires_host_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "untouched"
            result = run(STAGE, data, "")
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(data.exists())

    def test_missing_runtime_has_no_core_or_checkout_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            shutil.copy2(STAGE / EXE, directory / EXE)
            data = directory / "untouched"
            child = subprocess.Popen(
                [str(directory / EXE), "--abi", "2", "--host-version", MANIFEST["version"], "--data-dir", str(data)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            try:
                child.stdin.write('start\n{"id":"missing","command":"capstan_ping","args":{}}\n')
                child.stdin.flush()
                frame = json.loads(child.stdout.readline())
                self.assertIn("runtime is missing", frame["error"])
                self.assertFalse(data.exists())
            finally:
                child.stdin.close()
                child.wait(timeout=10)
                child.stdout.close()
                child.stderr.close()

    def test_native_protocol_and_eof_shutdown(self):
        with tempfile.TemporaryDirectory(prefix="harbor-extensions-data-") as tmp:
            exchange(STAGE, Path(tmp))

    def test_remove_reinstall_preserves_data(self):
        with tempfile.TemporaryDirectory(prefix="harbor-extensions-lifecycle-") as tmp:
            root = Path(tmp)
            component = root / "installation with spaces" / "capstan"
            data = root / "existing AppData" / "capstan"
            data.mkdir(parents=True)
            marker = data / "preserved-user-settings.json"
            contents = b'{"existing":"settings and extension data"}'
            marker.write_bytes(contents)
            shutil.copytree(STAGE, component)
            exchange(component, data)
            shutil.rmtree(component)
            self.assertEqual(marker.read_bytes(), contents)
            self.assertFalse((component / EXE).exists())
            shutil.copytree(STAGE, component)
            exchange(component, data)
            self.assertEqual(marker.read_bytes(), contents)


if __name__ == "__main__":
    unittest.main(verbosity=2)
