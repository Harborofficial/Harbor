import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { X, Trash2, Terminal, Search } from "lucide-react";
import { useT } from "@/lib/i18n";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type LogEntry = {
  id: string;
  time: string;
  level: "error" | "warn" | "info" | "debug" | "cmd";
  prefix: string;
  text: string;
};

export function ConsoleOverlay({ onClose }: { onClose: () => void }) {
  const tr = useT();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "shaders" | "warnings">("all");
  const [search, setSearch] = useState("");
  const [inputVal, setInputVal] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Initial read of harbor-mpv.log from AppData
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;

    const readInitialLog = async () => {
      try {
        const { appDataDir, join } = await import("@tauri-apps/api/path");
        const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");
        const logPath = await join(await appDataDir(), "harbor-mpv.log");
        if (!(await exists(logPath))) return;

        const content = await readTextFile(logPath);
        if (cancelled || !content) return;

        const rawLines = content.split("\n").filter((l) => l.trim().length > 0);
        // Take the latest 200 lines
        const sliced = rawLines.slice(-200);

        const initialEntries: LogEntry[] = sliced.map((line, idx) => {
          // Format in harbor-mpv.log: "[prefix] level: message"
          const match = line.match(/^\[(.*?)\]\s*([a-zA-Z0-9]+):\s*(.*)$/);
          if (match) {
            const [, prefix, rawLevel, text] = match;
            const lvl = rawLevel.toLowerCase();
            const level: LogEntry["level"] =
              lvl === "error" || lvl === "fatal"
                ? "error"
                : lvl === "warn" || lvl === "warning"
                ? "warn"
                : lvl === "info"
                ? "info"
                : "debug";
            return {
              id: `init-${idx}-${Date.now()}`,
              time: new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
              prefix: prefix || "mpv",
              level,
              text,
            };
          }
          return {
            id: `init-${idx}-${Date.now()}`,
            time: new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            prefix: "mpv",
            level: "info",
            text: line,
          };
        });

        setLogs(initialEntries);
      } catch {
        // Log reading fallback
      }
    };

    void readInitialLog();
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen to live mpv events (including warn/error/log events)
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen<{
          event: string;
          prefix?: string;
          level?: string;
          text?: string;
          name?: string;
          reason?: string;
        }>("mpv://event", (ev) => {
          const payload = ev.payload;
          if (!payload) return;

          const now = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

          if (payload.event === "log" && payload.text) {
            const lvl = (payload.level || "info").toLowerCase();
            const level: LogEntry["level"] =
              lvl === "fatal" || lvl === "error"
                ? "error"
                : lvl === "warn"
                ? "warn"
                : "info";

            setLogs((prev) => [
              ...prev.slice(-300),
              {
                id: `evt-${Date.now()}-${Math.random()}`,
                time: now,
                level,
                prefix: payload.prefix || "mpv",
                text: payload.text || "",
              },
            ]);
          } else if (payload.event === "end-file") {
            setLogs((prev) => [
              ...prev.slice(-300),
              {
                id: `evt-${Date.now()}-${Math.random()}`,
                time: now,
                level: payload.reason === "error" ? "error" : "info",
                prefix: "cplayer",
                text: `end-file (reason=${payload.reason ?? "unknown"})`,
              },
            ]);
          } else if (payload.event === "file-loaded") {
            setLogs((prev) => [
              ...prev.slice(-300),
              {
                id: `evt-${Date.now()}-${Math.random()}`,
                time: now,
                level: "info",
                prefix: "cplayer",
                text: "file-loaded: media pipeline ready",
              },
            ]);
          }
        });
      } catch {
        // Listener fallback
      }
    };

    void setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Auto-scroll to bottom if autoScroll is enabled
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If within 30px of bottom, auto-scroll stays true
    autoScrollRef.current = scrollHeight - (scrollTop + clientHeight) < 30;
  };

  const handleExecute = async () => {
    const raw = inputVal.trim();
    if (!raw) return;

    // Add to history
    setHistory((prev) => [...prev, raw]);
    setHistoryIndex(-1);
    setInputVal("");

    const now = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

    // Echo command in console
    setLogs((prev) => [
      ...prev.slice(-300),
      {
        id: `cmd-${Date.now()}`,
        time: now,
        level: "cmd",
        prefix: "input",
        text: `> ${raw}`,
      },
    ]);

    // Handle local commands
    if (raw === "clear" || raw === "cls") {
      setLogs([]);
      return;
    }
    if (raw === "help") {
      setLogs((prev) => [
        ...prev.slice(-300),
        {
          id: `cmd-${Date.now()}-help`,
          time: now,
          level: "info",
          prefix: "console",
          text: "Commands: Any mpv command e.g. 'show-text \"hello\"', 'set pause yes', 'set volume 80', 'clear'",
        },
      ]);
      return;
    }

    // Split args respecting quotes
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    const args: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(raw)) !== null) {
      args.push(match[1] ?? match[2] ?? match[0]);
    }

    try {
      await invoke("mpv_command", { cmd: args });
      setLogs((prev) => [
        ...prev.slice(-300),
        {
          id: `res-${Date.now()}`,
          time: now,
          level: "info",
          prefix: "mpv",
          text: `[OK] Command '${args[0]}' executed successfully`,
        },
      ]);
    } catch (err) {
      setLogs((prev) => [
        ...prev.slice(-300),
        {
          id: `err-${Date.now()}`,
          time: now,
          level: "error",
          prefix: "mpv",
          text: `[Error] ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleExecute();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInputVal(history[nextIndex] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        setInputVal("");
      } else {
        setHistoryIndex(nextIndex);
        setInputVal(history[nextIndex] ?? "");
      }
    } else if (e.key === "Escape" || e.key === "`" || e.key === "~") {
      e.preventDefault();
      onClose();
    }
  };

  // Filter logs based on filter mode and search query
  const filteredLogs = logs.filter((l) => {
    if (filter === "shaders") {
      const isShaderOrVo =
        l.prefix.toLowerCase().includes("vo") ||
        l.prefix.toLowerCase().includes("gpu") ||
        l.prefix.toLowerCase().includes("shader") ||
        l.text.toLowerCase().includes("shader") ||
        l.text.toLowerCase().includes("anime4k") ||
        l.text.toLowerCase().includes("pass");
      if (!isShaderOrVo) return false;
    } else if (filter === "warnings") {
      if (l.level !== "warn" && l.level !== "error") return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return l.text.toLowerCase().includes(q) || l.prefix.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div
      className="fixed inset-x-0 top-0 z-30 flex h-[26vh] min-h-[180px] max-h-[35vh] flex-col border-b border-edge-soft/80 bg-canvas/95 font-mono text-[11px] leading-relaxed text-ink shadow-[0_20px_60px_rgba(0,0,0,0.85)] backdrop-blur-md animate-fade-in"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top Console Bar */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-edge-soft/50 px-4 bg-surface/40">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-accent font-semibold text-[11px]">
            <Terminal size={14} className="text-accent" />
            <span>{tr("MPV Console & Log")}</span>
          </div>

          <div className="flex items-center gap-1 text-[10px]">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                filter === "all" ? "bg-accent/20 text-accent font-bold" : "text-ink-muted hover:text-ink"
              }`}
            >
              {tr("All")} ({logs.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("shaders")}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                filter === "shaders" ? "bg-accent/20 text-accent font-bold" : "text-ink-muted hover:text-ink"
              }`}
            >
              {tr("Shaders & VO")}
            </button>
            <button
              type="button"
              onClick={() => setFilter("warnings")}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                filter === "warnings" ? "bg-accent/20 text-accent font-bold" : "text-ink-muted hover:text-ink"
              }`}
            >
              {tr("Warnings / Errors")}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Quick Search */}
          <div className="relative flex items-center">
            <Search size={12} className="absolute left-2 text-ink-subtle pointer-events-none" />
            <input
              type="text"
              placeholder={tr("Filter...")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-6 w-32 rounded-md border border-edge-soft/60 bg-surface/70 pl-6 pr-2 text-[10px] text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setLogs([])}
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-ink-subtle transition hover:bg-surface hover:text-ink"
            title={tr("Clear console")}
          >
            <Trash2 size={12} />
            <span>{tr("Clear")}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-subtle transition hover:bg-surface hover:text-ink"
            aria-label={tr("Close console")}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Log Output Body */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-0.5 select-text selection:bg-accent/30"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-ink-subtle text-[10.5px]">
            {tr("No log messages matching filter.")}
          </div>
        ) : (
          filteredLogs.map((item) => {
            const isShader =
              item.text.toLowerCase().includes("shader") ||
              item.text.toLowerCase().includes("anime4k") ||
              item.prefix.toLowerCase().includes("gpu") ||
              item.prefix.toLowerCase().includes("vo");

            const levelColor =
              item.level === "error"
                ? "text-rose-400 font-bold"
                : item.level === "warn"
                ? "text-amber-400 font-semibold"
                : item.level === "cmd"
                ? "text-accent font-bold"
                : isShader
                ? "text-cyan-400"
                : "text-ink";

            const levelBadge =
              item.level === "error"
                ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                : item.level === "warn"
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                : item.level === "cmd"
                ? "bg-accent/20 text-accent border border-accent/40"
                : "bg-surface/80 text-ink-muted border border-edge-soft/40";

            return (
              <div key={item.id} className="flex items-baseline gap-2 py-0.2 hover:bg-surface/30 px-1 rounded">
                <span className="text-[9.5px] tabular-nums text-ink-subtle shrink-0">{item.time}</span>
                <span className={`rounded px-1 py-0.2 text-[8.5px] uppercase shrink-0 ${levelBadge}`}>
                  {item.level}
                </span>
                <span className="text-ink-muted shrink-0 text-[10px]">[{item.prefix}]</span>
                <span className={`break-all ${levelColor}`}>{item.text}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Interactive Command Input Footer */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-t border-edge-soft/50 bg-surface/50 px-4">
        <span className="text-accent font-bold text-[13px] leading-none">&gt;</span>
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tr("Type mpv command (e.g. show-text \"hello\", set volume 80) or press ` to hide...")}
          className="flex-1 bg-transparent text-[11px] text-ink placeholder:text-ink-subtle focus:outline-none"
        />
        <span className="text-[9.5px] text-ink-subtle shrink-0">
          {tr("` or Esc to close")}
        </span>
      </div>
    </div>
  );
}
