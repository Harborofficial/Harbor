import { useEffect, useState, memo } from "react";

function isRawCommand(s: string): boolean {
  // Only filter out unparsed command templates
  return /^\s*(cycle-values|show-text|set|add|cycle)\s+["']/i.test(s);
}

function isStatsPage(s: string): boolean {
  if (!s || s.length < 30) return false;
  return /Selected Tracks Info|Tracks Info|Extended Frame Timings|Frame Timings|Cache Info|Cache Statistics|Packet-Queue|Active Key Bindings|Internal stuff|Demuxer ID|Program ID|Hardware Decode/i.test(
    s
  );
}

export const OsdBanner = memo(function OsdBanner({
  text,
  seq,
}: {
  text?: string | null;
  seq?: number;
}) {
  const [visibleText, setVisibleText] = useState<string | null>(null);

  useEffect(() => {
    const handleStatsOpen = () => setVisibleText(null);
    window.addEventListener("harbor:toggle-stats-page", handleStatsOpen);
    return () => window.removeEventListener("harbor:toggle-stats-page", handleStatsOpen);
  }, []);

  useEffect(() => {
    const handleOsd = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail) {
        const clean = customEvent.detail.replace(/\{[^}]+\}/g, "").trim();
        if (clean && !isRawCommand(clean)) setVisibleText(clean);
      }
    };
    window.addEventListener("harbor:osd", handleOsd);
    return () => window.removeEventListener("harbor:osd", handleOsd);
  }, []);

  useEffect(() => {
    if (!text) {
      setVisibleText(null);
      return;
    }
    // Strip ASS formatting tags if present, e.g. {\an7}, {\b1}, etc.
    const clean = text.replace(/\{[^}]+\}/g, "").trim();
    if (!clean || isRawCommand(clean)) {
      setVisibleText(null);
      return;
    }

    setVisibleText(clean);
  }, [text, seq]);

  useEffect(() => {
    if (!visibleText) return;

    // Dynamically adjust auto-fade duration based on output size/lines
    const normalized = visibleText.replace(/\\n/g, "\n").replace(/\\N/g, "\n");
    const lineCount = normalized.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
    const duration = Math.min(8000, Math.max(2600, lineCount * 700));

    const timer = window.setTimeout(() => {
      setVisibleText(null);
    }, duration);

    return () => {
      window.clearTimeout(timer);
    };
  }, [visibleText, seq]);

  if (!visibleText || isStatsPage(visibleText)) return null;

  const normalized = visibleText
    .replace(/\\n/g, "\n")
    .replace(/\\N/g, "\n")
    .replace(/\\t/g, "  ");
  const rawLines = normalized.split(/\r?\n/);
  const isMultiLine = rawLines.length > 1 || normalized.length > 65;

  if (isMultiLine) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed left-7 top-6 z-[99999] flex max-h-[75vh] min-w-[280px] max-w-2xl select-none flex-col gap-2.5 rounded-2xl border border-edge-soft bg-canvas/92 p-4 shadow-2xl backdrop-blur-md transition-all duration-150 animate-in fade-in slide-in-from-top-2"
      >
        <div className="flex items-center gap-2 border-b border-edge-soft/60 pb-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_8px_var(--accent,#f97316)] animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">
            Harbor OSD
          </span>
        </div>
        <div className="flex flex-col gap-1 overflow-y-auto pr-1 font-mono text-[12px] leading-relaxed text-ink tabular-nums">
          {rawLines.map((line, idx) => (
            <div key={idx} className="whitespace-pre-wrap">
              {line || "\u00A0"}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-7 top-6 z-[99999] flex select-none items-center gap-2.5 rounded-xl border border-edge-soft bg-canvas/92 px-3.5 py-2 shadow-2xl backdrop-blur-md transition-all duration-150 animate-in fade-in slide-in-from-top-2"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_8px_var(--accent,#f97316)] animate-pulse" />
      <span className="font-mono text-[13px] font-medium tracking-wide text-ink tabular-nums">
        {normalized}
      </span>
    </div>
  );
});
