import { useEffect, useRef, useState, type FormEvent } from "react";
import { createRefractAttemptGuard } from "@/lib/refract/identity";
import { useT } from "@/lib/i18n";
import {
  getRefractKey,
  clearRefractWatchlistStatus,
  refractWatchlistStatus,
  subscribeRefractWatchlistStatus,
  getRefractAutoThreshold,
  REFRACT_AUTO_THRESHOLDS,
  setRefractAutoThreshold,
  refractEnabled,
  saveRefractKey,
  setRefractEnabled,
  verifyRefractKey,
} from "@/lib/refract/client";
import {
  refractStatus,
  resetRefractSync,
  retryRefractSync,
  startRefractSync,
  subscribeRefractStatus,
} from "@/lib/refract/sync";
import { Section, ToggleRow } from "./shared";
import { ROW_ACTION_PRIMARY, ROW_DESC } from "./kit";

export function RefractPanel() {
  const t = useT();
  const [connected, setConnected] = useState(() => getRefractKey() !== null);
  const [enabled, setEnabled] = useState(() => refractEnabled());
  const [threshold, setThreshold] = useState(getRefractAutoThreshold);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState(refractStatus);
  const [watchlist, setWatchlist] = useState(refractWatchlistStatus);
  const attemptGuard = useRef(createRefractAttemptGuard());

  useEffect(() => {
    const guard = attemptGuard.current;
    return () => guard.invalidate();
  }, []);

  useEffect(
    () => subscribeRefractWatchlistStatus(() => setWatchlist(refractWatchlistStatus())),
    [],
  );

  useEffect(
    () =>
      subscribeRefractStatus(() => {
        setStatus(refractStatus());
      }),
    [],
  );

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    const key = input.trim();
    if (!key) return;
    const isCurrent = attemptGuard.current.begin();
    setBusy(true);
    setMessage("");
    try {
      const identity = await verifyRefractKey(key);
      if (!isCurrent()) return;
      // Never replay watches from another Refract account after replacing a key.
      resetRefractSync();
      clearRefractWatchlistStatus();
      saveRefractKey(key);
      setRefractEnabled(true);
      setConnected(true);
      setEnabled(true);
      setInput("");
      setMessage(`Connected to Refract (${identity}). Watched history sync is enabled.`);
      startRefractSync();
    } catch {
      if (!isCurrent()) return;
      setMessage(
        "Could not verify the key via Refract /v1/me. Check permissions and connectivity.",
      );
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };

  const disconnect = () => {
    attemptGuard.current.invalidate();
    setRefractEnabled(false);
    saveRefractKey(null);
    resetRefractSync();
    clearRefractWatchlistStatus();
    setConnected(false);
    setEnabled(false);
    setMessage("Disconnected from Refract.");
  };

  return (
    <Section
      title={t("Refract sync")}
      subtitle={t("Sync watched history and Harbor watchlist changes with Refract.")}
    >
      {!connected ? (
        <form onSubmit={connect} className="flex max-w-xl flex-col gap-3">
          <p className={ROW_DESC}>
            Create a personal API key in Refract with profile:read, library:read, library:write and
            history:write. Never share or commit the key.
          </p>
          <label htmlFor="refract-api-key" className="text-[14px] font-medium text-ink">
            {t("Refract personal API key")}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="refract-api-key"
              type={showKey ? "text" : "password"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="rfk_..."
              autoComplete="off"
              spellCheck={false}
              className="h-11 min-w-0 flex-1 rounded-[10px] border border-edge bg-elevated px-3 font-mono text-[14px] text-ink"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="h-11 rounded-[10px] border border-edge px-3 text-ink-muted"
            >
              {showKey ? t("Hide") : t("Show")}
            </button>
          </div>
          <button type="submit" disabled={busy || !input.trim()} className={ROW_ACTION_PRIMARY}>
            {busy ? t("Verifying...") : t("Connect Refract")}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] text-ink">{t("Refract key saved in Harbor's secret store")}</p>
          <ToggleRow
            label={t("Sync watched history and watchlist")}
            sub={t(
              "Send watched history and watchlist changes from Harbor to Refract. Only the primary Harbor profile is synced.",
            )}
            value={enabled}
            onChange={(value) => {
              setRefractEnabled(value);
              setEnabled(value);
              if (value) {
                retryRefractSync();
              }
            }}
          />
          <div className="flex max-w-xl flex-col gap-2">
            <label htmlFor="refract-auto-threshold" className="text-[14px] font-medium text-ink">
              Automatic watch threshold
            </label>
            <select
              id="refract-auto-threshold"
              value={threshold}
              disabled={!enabled}
              onChange={(event) => {
                const value = REFRACT_AUTO_THRESHOLDS.find(
                  (option) => String(option) === event.target.value,
                );
                if (value === undefined) return;
                setRefractAutoThreshold(value);
                setThreshold(value);
              }}
              className="h-11 w-48 rounded-[10px] border border-edge bg-elevated px-3 text-ink"
            >
              {REFRACT_AUTO_THRESHOLDS.map((value) => (
                <option key={value} value={value}>
                  {typeof value === "string"
                    ? `After ${Number.parseInt(value, 10)} minutes`
                    : `${value}%${value === 70 ? " (default)" : ""}`}
                </option>
              ))}
            </select>
            <p className={ROW_DESC}>
              Log a movie or episode in Refract when playback reaches the selected time or
              percentage. Seeking past it also qualifies. Early logging counts as watched in
              Refract, not partially watched. Harbor's own completion threshold is unchanged.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[14px] font-medium text-ink">Harbor → Refract Plan to Watch</p>
            <p className={ROW_DESC}>
              New watchlist additions and removals are sent automatically while sync is enabled.
              Requires library:write; reconnect with an updated key if needed. Existing Refract
              history and other library statuses are preserved.
            </p>
            {watchlist && (
              <p role="status" className={ROW_DESC}>
                {watchlist}
              </p>
            )}
          </div>
          <p className={ROW_DESC}>
            {status.synced} sent · {status.pending} pending · {status.failed} unmatched
            {status.message ? ` · ${status.message}` : ""}
          </p>
          {status.failures.length > 0 && (
            <details className="text-[13px] text-ink-muted">
              <summary>Unmatched items</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {status.failures.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                retryRefractSync();
              }}
              className="rounded-[10px] border border-edge px-4 py-2 text-ink"
            >
              {t("Retry pending watches")}
            </button>
            <button
              type="button"
              onClick={disconnect}
              className="rounded-[10px] border border-danger px-4 py-2 text-danger"
            >
              {t("Disconnect Refract")}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className={ROW_DESC}>
          {message}
        </p>
      )}
    </Section>
  );
}
