from __future__ import annotations
import json, os, shutil, subprocess, tempfile, threading, wave
from pathlib import Path
from queue import Queue, Empty

ROOT = Path(__file__).resolve().parent.parent
BIN = Path(os.environ.get("HARBOR_MUSIC_TEST_BINARY", str(ROOT / "src-tauri/music-module/target/debug/harbor-music-module.exe")))
MPV_DLL = ROOT / "src-tauri/libmpv/libmpv-2.dll"
assert BIN.is_file(), f"Build the Music module before testing: {BIN}"
if not (BIN.parent / "libmpv-2.dll").exists():
    shutil.copy2(MPV_DLL, BIN.parent / "libmpv-2.dll")

with tempfile.TemporaryDirectory(prefix="Harbor Music IPC ") as temp:
    path = Path(temp) / "Silent File With Spaces.wav"
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(44100)
        out.writeframes(b"\0\0" * (2 * 44100))

    env = os.environ.copy()
    env["HARBOR_MUSIC_TEST_NO_AUDIO"] = "1"
    p = subprocess.Popen(
        [str(BIN), "--serve"], stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", env=env, bufsize=1,
    )
    events = Queue()
    def read_events():
        for line in p.stderr:
            try:
                events.put(json.loads(line))
            except json.JSONDecodeError:
                pass
    threading.Thread(target=read_events, daemon=True).start()
    def request(command, **kwargs):
        assert p.poll() is None, f"Music module quit: {p.returncode}"
        p.stdin.write(json.dumps({"command": command, **kwargs}) + "\n")
        p.stdin.flush()
        response = json.loads(p.stdout.readline())
        assert response["abi"] == 1, response
        assert response["ok"], response
        return response["data"]

    try:
        assert request("handshake")["kind"] == "harbor-music"
        original = request("mpv_audio_settings_get")
        assert original["eqEnabled"] is False
        changed = dict(original)
        changed.update({
            "eqEnabled": True, "eqBands": [40.0] + [0.0] * 9,
            "preampDb": -4.0, "speed": 1.15, "volumeLimit": 3.0,
            "boostEnabled": False
        })
        applied = request("mpv_audio_settings_set", settings=changed)
        assert applied["eqBands"][0] == 12.0
        assert applied["volumeLimit"] == 1.0
        assert applied["speed"] == 1.15
        assert request("mpv_audio_settings_get") == applied
        request("mpv_audio_settings_set", settings=original)
        # Spotify IPC smoke checks use fake credentials only. No account sign-in
        # or modification of Harbor's existing secrets and Spotify cache.
        spotify = request("spotify_state")
        assert spotify["connected"] is False and spotify["live"] is False
        p.stdin.write(json.dumps({
            "command": "spotify_connect",
            "credentials": "invalid",
            "cache_path": str(Path(temp) / "spotify"),
            "device_id": ""
        }) + "\n")
        p.stdin.flush()
        bad_login = json.loads(p.stdout.readline())
        assert bad_login["ok"] is False
        assert not (Path(temp) / "spotify").exists()
        assert request("spotify_state")["connected"] is False
        request("spotify_meter_set", enabled=True)
        assert request("spotify_meter_snapshot") is None
        assert request("mpv_broadcast_status")["active"] is False
        try:
            request("mpv_broadcast_start", device="")
            raise AssertionError("Blank broadcast device should fail")
        except AssertionError as err:
            if "Blank broadcast device" in str(err):
                raise
        request("mpv_meter_set", enabled=True)
        assert request("mpv_meter_snapshot", deck=0) is None
        request("mpv_play", deck=0, url=str(path), track_id="local:fixture",
                connector_id="local", volume=0.0)
        state = request("mpv_state", deck=0)
        assert state["live"] and state["trackId"] == "local:fixture", state
        # A seek is only valid after MPV has loaded the file.
        import time
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                event = events.get(timeout=0.2)
            except Empty:
                continue
            if event.get("payload", {}).get("event") == "file-loaded":
                break
        else:
            raise AssertionError("No native MPV file-loaded event was received")
        broadcast = request("mpv_broadcast_start", device="auto")
        assert broadcast["active"] is True
        assert request("mpv_state", deck=1)["live"] is True
        request("mpv_crossfade", position=0.5)
        assert request("mpv_state", deck=1)["gain"] == 0.0
        request("mpv_pause", deck=0, paused=True)
        request("mpv_seek", deck=0, seconds=0.3)
        broadcast = request("mpv_broadcast_stop")
        assert broadcast["active"] is False
        assert request("mpv_state", deck=1)["live"] is False
        request("mpv_loop", deck=0, start=0.1, end=0.8)
        request("mpv_volume", deck=0, volume=0.0)
        request("mpv_crossfade", position=-1.0)
        request("mpv_scratch", deck=0, position=0.4, rate=1.0, holding=False)
        request("mpv_mute", deck=0, muted=True)
        request("mpv_stop", deck=0)
        assert request("mpv_state", deck=0)["live"] is False
        captured = []
        while not events.empty():
            captured.append(events.get_nowait())
        print("Native Music module commands passed; emitted events:", len(captured))
        print("No app data or real audio output was used.")
    finally:
        p.terminate()
        try:
            p.wait(timeout=4)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
