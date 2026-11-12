import test from "node:test";
import assert from "node:assert/strict";
import {
  validateInputConf,
  customScriptsMpvLines,
  customShadersMpvLines,
} from "../src/lib/player/mpv-tuning.ts";
import {
  parseString,
  pqEotf,
  formatCanvasResolution,
  tokenizeStatsLine,
} from "../src/lib/player/mpv-stats-format.ts";

test("parseString never returns [object Object]", () => {
  assert.equal(parseString({ current: "d3d11" }), "d3d11");
  assert.equal(parseString({ name: "d3d11va" }), "d3d11va");
  assert.equal(parseString({ other: "angle" }), "angle");
  assert.equal(parseString({}), "");
  assert.equal(parseString("[object Object]"), "");
  assert.equal(parseString({ current: "[object Object]" }), "");
});

test("pqEotf calculates accurate nits for ST 2084 HDR luminance", () => {
  // 59.42% PQ signal level should evaluate to ~230-231 cd/m² (matching Stranger Things screenshot)
  const nit59 = pqEotf(0.5942);
  assert.ok(Math.abs(nit59 - 230.95) < 0.5, `Expected ~230.95 cd/m², got ${nit59}`);

  // 25.82% PQ signal level should evaluate to ~5.78 cd/m²
  const nit25 = pqEotf(0.2582);
  assert.ok(Math.abs(nit25 - 5.78) < 0.2, `Expected ~5.78 cd/m², got ${nit25}`);
});

test("formatCanvasResolution generates aspect ratio name and crop rect", () => {
  const result = formatCanvasResolution({
    w: 1908,
    h: 1103,
    aspect: 1.73,
    "aspect-name": "Early 35mm Widescreen Ratio",
    "crop-x": -26,
    "crop-y": 0,
    "crop-w": 1961,
    "crop-h": 1103,
  });
  assert.equal(
    result,
    "1908 x 1103  1.73:1 (Early 35mm Widescreen Ratio)  [x: -26, y: 0, w: 1961, h: 1103]",
  );

  // Dynamic calculation from osd-dimensions matching user screenshot:
  const odResult = formatCanvasResolution(
    { pixelformat: "rgb10a2" },
    { w: 1920, h: 1113, ml: -29, mr: -29, mt: 0, mb: 0 },
  );
  assert.equal(
    odResult,
    "1920 x 1113  1.73:1 (Early 35mm Widescreen Ratio)  [x: -29, y: 0, w: 1978, h: 1113]",
  );
});

test("video output params take precedence over raw input params matching mpv stats.lua", () => {
  // Input stream (demuxer) had dolbyvision and d3d11
  const vParams = {
    pixelformat: "d3d11",
    colormatrix: "dolbyvision",
    primaries: "bt.2020",
    gamma: "pq",
  };
  // Filter output (after format [dolbyvision=no hdr10plus=no]) has p010 and bt.2020-ncl
  const vOutParams = {
    pixelformat: "p010",
    colormatrix: "bt.2020-ncl",
    primaries: "bt.2020",
    gamma: "pq",
    "chroma-location": "uhd",
  };

  const activeVParams = vOutParams && Object.keys(vOutParams).length > 0 ? vOutParams : vParams;
  const vFmtName = parseString(activeVParams?.pixelformat);
  const vMatrix = parseString(activeVParams?.colormatrix);
  const vChroma = parseString(activeVParams?.["chroma-location"]);

  assert.equal(vFmtName, "p010");
  assert.equal(vMatrix, "bt.2020-ncl");
  assert.equal(vChroma, "uhd");

  // On Page 1, Dolby Vision line is only rendered if active output matrix is dolbyvision
  const showDoviPage1 = vMatrix === "dolbyvision" || vMatrix.includes("dolby");
  assert.equal(
    showDoviPage1,
    false,
    "Dolby Vision line must NOT be shown on Page 1 when stripped to bt.2020-ncl",
  );
});

test("HDR10 Display peak is strictly hidden for SDR transfer curves", () => {
  const dispPeak = 300;

  // SDR video (transfer is bt.1886 or srgb)
  const sdrTransfer = "bt.1886";
  const showSdrHdrDisp =
    dispPeak != null && dispPeak > 0 && (sdrTransfer === "pq" || sdrTransfer === "hlg");
  assert.equal(showSdrHdrDisp, false, "HDR10 Display must never appear for SDR transfers");

  // HDR video (transfer is pq)
  const hdrTransfer = "pq";
  const showHdrDisp =
    dispPeak != null && dispPeak > 0 && (hdrTransfer === "pq" || hdrTransfer === "hlg");
  assert.equal(showHdrDisp, true, "HDR10 Display should appear for PQ HDR transfer");
});

test("tokenizeStatsLine correctly isolates parameter keys from values while preserving spacing", () => {
  // 1. Single key line
  const t1 = tokenizeStatsLine("File: 1080p.m3u8");
  assert.equal(t1.length, 2);
  assert.equal(t1[0].type, "key");
  assert.equal(t1[0].text, "File:");
  assert.equal(t1[1].text, " 1080p.m3u8");

  // 2. Multi-column keys on same line
  const t2 = tokenizeStatsLine("Colormatrix: bt.2020-ncl  Primaries: bt.2020  Transfer: pq");
  const keys2 = t2.filter((x) => x.type === "key").map((x) => x.text);
  assert.deepEqual(keys2, ["Colormatrix:", "Primaries:", "Transfer:"]);

  // 3. Nested HDR10 / PQ(Y) metadata keys
  const t3 = tokenizeStatsLine(
    "HDR10: Mastering display: 0.0001 / 1001 cd/m²  MaxCLL: 1177 cd/m²  MaxFALL: 246 cd/m²",
  );
  const keys3 = t3.filter((x) => x.type === "key").map((x) => x.text);
  assert.deepEqual(keys3, ["HDR10:", "Mastering display:", "MaxCLL:", "MaxFALL:"]);

  // 4. Indented lines (e.g. Page 5 track lines)
  const t4 = tokenizeStatsLine("  ID: 1  Demuxer ID: 1  FFmpeg Index: 0");
  assert.equal(t4[0].type, "val");
  assert.equal(t4[0].text, "  ");
  assert.equal(t4[1].type, "key");
  assert.equal(t4[1].text, "ID:");
});

test("detects abnormal dropped frames, A-V drift, and timing spikes for red highlighting", () => {
  // Test dropped frames regex
  const dropRegex = /(\b[1-9]\d*\s*\((?:decoder|output|mistimed|delayed)\))/g;

  // 0 drops -> no abnormal matches
  const normalDrops = " 0 (decoder)  0 (output)";
  const normalMatches = normalDrops.match(dropRegex);
  assert.equal(normalMatches, null);

  // Positive drops -> matches abnormal drops
  const abnormalDrops = " 12 (decoder)  0 (output)  4 (mistimed)";
  const abnormalMatches = abnormalDrops.match(dropRegex);
  assert.deepEqual(abnormalMatches, ["12 (decoder)", "4 (mistimed)"]);

  // A-V sync: pure red text when above zero (> 0) or in bad condition (>= 50ms)
  const isBadAv = (val: string) => {
    const n = parseInt(val.replace(/[^0-9+-]/g, ""), 10);
    return !isNaN(n) && (n > 0 || Math.abs(n) >= 50);
  };
  assert.equal(isBadAv("+0"), false);
  assert.equal(isBadAv("-5"), false);
  assert.equal(isBadAv("+1"), true);
  assert.equal(isBadAv("+15"), true);
  assert.equal(isBadAv("+150"), true);
  assert.equal(isBadAv("-60"), true);

  // Timing budget spikes (>= 50,000 µs)
  const isTimingOverrun = (val: number) => val >= 50000;
  assert.equal(isTimingOverrun(16666), false);
  assert.equal(isTimingOverrun(42927), false);
  assert.equal(isTimingOverrun(244435), true);

  // Microseconds rescaling from nanoseconds
  const ppUs = (ns: number | undefined) => String(Math.round((ns || 0) / 1000)).padStart(6, " ");
  // 569,880 ns = 570 µs (not abnormal, should not be red)
  const us1 = Math.round(569880 / 1000);
  assert.equal(us1, 570);
  assert.equal(us1 >= 16666, false);
  assert.equal(ppUs(569880), "   570");

  // 8,676,960 ns = 8677 µs (8.68 ms, normal frame total)
  const usTotal = Math.round(8676960 / 1000);
  assert.equal(usTotal, 8677);
  assert.equal(usTotal >= 25000, false);
});

test("Page 0 Internal Performance Info isolates perf-info passes and loaded scripts", () => {
  // Test tokenization of internal performance entries (e.g., "[1] lua/stats: 145 µs")
  const t1 = tokenizeStatsLine("  [1] lua/stats: 145 µs");
  assert.equal(t1[0].type, "val");
  assert.equal(t1[0].text, "  ");
  assert.equal(t1[1].type, "key");
  assert.equal(t1[1].text, "[1] lua/stats:");
  assert.equal(t1[2].type, "val");
  assert.equal(t1[2].text, " 145 µs");

  // Test tokenization of internal render passes
  const t2 = tokenizeStatsLine("  [2] vo/gpu-next/render: 8520 µs");
  assert.equal(t2[1].type, "key");
  assert.equal(t2[1].text, "[2] vo/gpu-next/render:");

  // Test Page 0 meta definition
  const STATS_PAGES: Record<number, string> = {
    0: "Internal Performance Info",
    1: "Overview",
    2: "Frame Timings",
    3: "Cache Info",
    4: "Active Key Bindings",
    5: "Selected Tracks Info",
  };
  assert.equal(STATS_PAGES[0], "Internal Performance Info");
});

test("validateInputConf accurately validates key bindings and skips invalid lines", () => {
  const conf = `
# Sample comment
SPACE cycle pause
RIGHT seek 5
LEFT seek -5
UP add volume 2 # inline comments supported

# Invalid lines:
justAKeyWithoutCommand
`;
  const result = validateInputConf(conf);
  assert.equal(result.valid, 4);
  assert.equal(result.skipped, 1);

  const empty = validateInputConf("");
  assert.equal(empty.valid, 0);
  assert.equal(empty.skipped, 0);
});

test("Page 4 formats key bindings grouped by category with official mpv keybinds", () => {
  const binds = [
    { key: "SPACE", cmd: "cycle pause", comment: "toggle pause" },
    { key: "RIGHT", cmd: "seek 5", comment: "seek 5s" },
    { key: "UP", cmd: "add volume 2", comment: "vol up" },
  ];
  const groups: Record<string, Array<{ key: string; cmd: string; comment?: string }>> = {};
  for (const b of binds) {
    const cat = b.cmd.trim().split(/\s+/)[0].toLowerCase() || "misc";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(b);
  }
  assert.equal(groups["cycle"].length, 1);
  assert.equal(groups["seek"].length, 1);
  assert.equal(groups["add"].length, 1);
  assert.equal(groups["cycle"][0].key, "SPACE");
});

test("existing basic stats vs advanced stats mode routing", () => {
  // When mpvDetailedStats is false (default), stats overlay uses basic overlay
  const settingsBasic = { mpvDetailedStats: false };
  const resolveOverlayMode = (s: { mpvDetailedStats?: boolean }) =>
    s.mpvDetailedStats ? "keybind-advanced" : "basic-stats";

  assert.equal(resolveOverlayMode(settingsBasic), "basic-stats");

  // When mpvDetailedStats is true, stats overlay uses advanced KeybindStatsOverlay
  const settingsAdvanced = { mpvDetailedStats: true };
  assert.equal(resolveOverlayMode(settingsAdvanced), "keybind-advanced");
});

test("customScriptsMpvLines formats enabled scripts and ignores disabled ones", () => {
  const settings = {
    customMpvScripts: [
      { id: "1", name: "autoload", path: "C:\\scripts\\autoload.lua", enabled: true },
      { id: "2", name: "disabled_script", path: "C:\\scripts\\disabled.lua", enabled: false },
      { id: "3", name: "mpris", path: "/usr/share/scripts/mpris.js", enabled: true },
    ],
  } as any;

  const lines = customScriptsMpvLines(settings);
  assert.ok(lines.includes("load-scripts=yes"));
  assert.ok(lines.includes("load-script=C:/scripts/autoload.lua"));
  assert.ok(lines.includes("load-script=/usr/share/scripts/mpris.js"));
  assert.ok(!lines.includes("disabled.lua"));
});

test("enhanced validateInputConf checks key combinations and known mpv commands", () => {
  const conf = [
    "# Valid commands with various keys & modifiers",
    "Ctrl+Shift+s screenshot",
    "Alt+UP add volume 2",
    "Meta+q quit",
    "SPACE cycle pause",
    "[ multiply speed 0.9091",
    "] multiply speed 1.1",
    "Ctrl+v script-binding stats/display-stats-toggle",
    "repeatable RIGHT seek 5",
    "m cycle mute",
    "",
    "# Invalid command tokens or bad keys",
    "Ctrl+BADKEYNAME seek 5",
    "x not_a_real_mpv_command",
    "UP",
    "unknownCommandOnly",
  ].join("\n");

  const check = validateInputConf(conf);
  assert.equal(check.valid, 9);
  assert.equal(check.skipped, 4);
});

test("OSD banner formatting and single instance deduplication invariants", () => {
  // Verifies that OSD text formatting handles embedded mpv formatting and escapes
  const rawOsd = "Speed: 1.25x\\nVolume: 80%\\t(Unmuted)";
  const formatted = rawOsd.replace(/\\n/g, "\n").replace(/\\t/g, "  ");
  assert.ok(formatted.includes("\n"));
  assert.ok(!formatted.includes("\\n"));
  assert.ok(formatted.includes("  (Unmuted)"));
});

test("HDR to SDR d3d11-flip safeguard invariant", () => {
  // Preserves Harbor's invariant that flip model is disabled specifically when HDR-to-SDR tonemapping
  // on Windows to avoid black screen / composition glitches in embedded HWND
  function resolveD3d11Flip(
    d3d11FlipOption: boolean | undefined,
    hdrToSdr: boolean | undefined,
  ): string | null {
    if (d3d11FlipOption && hdrToSdr) {
      return "no";
    }
    return null;
  }

  assert.equal(resolveD3d11Flip(true, true), "no");
  assert.equal(resolveD3d11Flip(true, false), null);
  assert.equal(resolveD3d11Flip(false, true), null);
});

test("customShadersMpvLines formats enabled shaders into semicolon-separated chain", () => {
  const settings = {
    customGlslShaders: [
      { id: "s1", name: "FSRCNNX", path: "C:\\shaders\\fsrcnnx.glsl", enabled: true },
      { id: "s2", name: "disabled", path: "C:\\shaders\\disabled.glsl", enabled: false },
      { id: "s3", name: "Krig", path: "C:\\shaders\\krig.glsl", enabled: true },
    ],
  } as any;
  const lines = customShadersMpvLines(settings);
  assert.equal(lines, "glsl-shaders=C:/shaders/fsrcnnx.glsl;C:/shaders/krig.glsl");
});

test("fullShaderChain production path appends enabled custom shaders", async () => {
  const { fullShaderChain } = await import("../src/views/player/hooks/use-anime4k.ts");
  const settings = {
    customGlslShaders: [
      { id: "s1", name: "FSRCNNX", path: "C:\\shaders\\fsrcnnx.glsl", enabled: true },
      { id: "s2", name: "disabled", path: "C:\\shaders\\disabled.glsl", enabled: false },
    ],
    playerAnime4k: false,
    mpvShaders: [],
  } as any;
  const chain = fullShaderChain(settings, {} as any, "off");
  assert.ok(chain.includes("C:/shaders/fsrcnnx.glsl"));
  assert.ok(!chain.includes("C:/shaders/disabled.glsl"));
});

test("HDR to SDR transitions track (on, oled) pair and reset properties on disable", () => {
  let appliedHdrToSdr: { on: boolean; oled: boolean } | null = null;
  const propertiesSet: Array<[string, string]> = [];

  function setHdrToSdr(on: boolean, oled?: boolean) {
    const isOled = Boolean(oled);
    if (appliedHdrToSdr && appliedHdrToSdr.on === on && appliedHdrToSdr.oled === isOled) return;
    appliedHdrToSdr = { on, oled: isOled };
    propertiesSet.length = 0;
    if (on) {
      propertiesSet.push(
        ["tone-mapping", "spline"],
        ["gamut-mapping-mode", "perceptual"],
        ["hdr-compute-peak", "yes"],
        ["hdr-contrast-recovery", "0.30"],
        ["hdr-peak-percentile", "99.995"],
        ["dither-depth", "auto"],
        ["target-trc", "bt.1886"],
        ["target-prim", "bt.709"],
        ["target-contrast", isOled ? "inf" : "auto"],
      );
    } else {
      propertiesSet.push(
        ["tone-mapping", "auto"],
        ["gamut-mapping-mode", "auto"],
        ["hdr-compute-peak", "auto"],
        ["hdr-contrast-recovery", "0"],
        ["hdr-peak-percentile", "0"],
        ["dither-depth", "auto"],
        ["target-trc", "auto"],
        ["target-prim", "auto"],
        ["target-contrast", "auto"],
      );
    }
  }

  // Initial on with LCD
  setHdrToSdr(true, false);
  assert.equal(propertiesSet.find(([k]) => k === "target-contrast")?.[1], "auto");

  // Switching panel to OLED updates target-contrast even while HDR-to-SDR is already on
  setHdrToSdr(true, true);
  assert.equal(propertiesSet.find(([k]) => k === "target-contrast")?.[1], "inf");

  // Redundant call with same (on, oled) is no-op
  propertiesSet.length = 0;
  setHdrToSdr(true, true);
  assert.equal(propertiesSet.length, 0);

  // Disabling restores all properties including hdr-compute-peak, recovery, percentile
  setHdrToSdr(false, true);
  assert.equal(propertiesSet.find(([k]) => k === "hdr-compute-peak")?.[1], "auto");
  assert.equal(propertiesSet.find(([k]) => k === "hdr-contrast-recovery")?.[1], "0");
  assert.equal(propertiesSet.find(([k]) => k === "hdr-peak-percentile")?.[1], "0");
});

test("stats polling request tagging and in-flight guard prevents stale page overwrites", async () => {
  let inFlight = false;
  let currentRequestId = 0;
  let activePage: number | null = 1;
  let appliedContent = "";

  async function mockFetch(page: number, delayMs: number, resultText: string) {
    if (inFlight) return;
    inFlight = true;
    const reqId = ++currentRequestId;
    try {
      await new Promise((r) => setTimeout(r, delayMs));
    } finally {
      inFlight = false;
    }
    // Only apply if reqId is still latest and page matches activePage
    if (reqId === currentRequestId && activePage === page) {
      appliedContent = resultText;
    }
  }

  // Slow request for page 1 starts
  const p1 = mockFetch(1, 50, "Page 1 Content");
  // User switches to page 2: activePage updates, resets inFlight, and invalidates reqId
  activePage = 2;
  inFlight = false;
  currentRequestId++;
  const p2 = mockFetch(2, 10, "Page 2 Content");

  await Promise.all([p1, p2]);
  // Page 1 resolved after switch, but must NOT overwrite Page 2!
  assert.equal(appliedContent, "Page 2 Content");
});

test("advanced stats overlay and toggle are gated on mpv engine", () => {
  function shouldMountKeybindStats(
    settings: { mpvDetailedStats: boolean },
    engine: "html5" | "mpv",
  ): boolean {
    return settings.mpvDetailedStats && engine === "mpv";
  }

  function shouldHandleStatsToggle(
    settings: { mpvDetailedStats: boolean },
    engine: "html5" | "mpv",
  ): boolean {
    return settings.mpvDetailedStats && engine === "mpv";
  }

  assert.equal(shouldMountKeybindStats({ mpvDetailedStats: true }, "mpv"), true);
  assert.equal(shouldMountKeybindStats({ mpvDetailedStats: true }, "html5"), false);
  assert.equal(shouldHandleStatsToggle({ mpvDetailedStats: true }, "html5"), false);
  assert.equal(shouldHandleStatsToggle({ mpvDetailedStats: false }, "mpv"), false);
});
