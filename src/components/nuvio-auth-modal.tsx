import { Check, ExternalLink, Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import { openUrl } from "@/lib/window";
import { activateNuvioAccountProvider, signInWithEmailPassword, startNuvioWebAuth } from "@/lib/nuvio/nuvio-auth";
import { NUVIO_OFFICIAL_WEB_URL } from "@/lib/nuvio/nuvio-client";

export function NuvioAuthModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Web auth state
  const [webBusy, setWebBusy] = useState(false);
  const [webCode, setWebCode] = useState<string | null>(null);
  const [webError, setWebError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await signInWithEmailPassword(email, password, remember);
      if (res.ok) {
        activateNuvioAccountProvider();
        onSuccess?.();
        onClose();
      } else {
        setError(res.error || t("Sign-in failed"));
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Sign-in failed"));
      setBusy(false);
    }
  };

  const startWeb = async () => {
    setWebBusy(true);
    setWebError(null);
    try {
      await startNuvioWebAuth((info) => {
        setWebCode(info.userCode);
      });
      activateNuvioAccountProvider();
      onSuccess?.();
      onClose();
    } catch (e) {
      setWebError(e instanceof Error ? e.message : t("Sign-in failed."));
      setWebBusy(false);
      setWebCode(null);
    }
  };

  return createPortal(
    <div
      className="animate-scrim-in fixed inset-0 z-[240] flex items-center justify-center p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="animate-dialog-in flex w-[min(92vw,420px)] flex-col gap-5 rounded-md bg-surface p-7 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink-subtle">
            {t("Nuvio")}
          </span>
          <h2 className="font-display text-[22px] font-medium tracking-tight text-ink">
            {t("Sign in")}
          </h2>
          <p className="text-[12.5px] leading-relaxed text-ink-subtle">
            {t("Brings in your library, watchlist, and installed addons.")}
          </p>
        </div>

        {/* Nuvio browser web auth button (analogous to StremioWebButton) */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={startWeb}
            disabled={webBusy || busy}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-ink text-[14.5px] font-semibold text-canvas transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
          >
            {webBusy ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                {webCode ? `${t("Waiting in browser...")} (${webCode})` : t("Continue in your browser...")}
              </>
            ) : (
              <>
                {t("Sign in with Nuvio")}
                <ExternalLink size={14} />
              </>
            )}
          </button>
          <p className="text-center text-[11.5px] leading-snug text-ink-subtle">
            {t("Opens nuvio.tv/link in your browser. Enter code or approve online.")}
          </p>
          {webError && (
            <p className="rounded-lg bg-danger/15 px-3 py-2 text-[12px] text-danger">{webError}</p>
          )}
        </div>

        <span className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink-subtle">
          {t("or use email")}
        </span>

        <div className="flex flex-col gap-3">
          <Field
            label={t("Email")}
            type="email"
            value={email}
            onChange={setEmail}
            disabled={busy || webBusy}
          />
          <Field
            label={t("Password")}
            type="password"
            value={password}
            onChange={setPassword}
            disabled={busy || webBusy}
          />
        </div>

        <button
          type="button"
          onClick={() => setRemember((v) => !v)}
          disabled={busy || webBusy}
          className="flex items-center gap-2.5 self-start text-start"
        >
          <span
            className={`flex h-4 w-4 items-center justify-center rounded-[4px] transition-colors ${
              remember ? "bg-ink" : "bg-edge"
            }`}
          >
            {remember && <Check size={11} strokeWidth={3} className="text-canvas" />}
          </span>
          <span className="flex flex-col">
            <span className="text-[13px] font-medium text-ink">{t("Remember me")}</span>
            <span className="text-[11.5px] text-ink-subtle">
              {t("Stays signed in on this device only.")}
            </span>
          </span>
        </button>

        {error && (
          <p className="rounded-md bg-danger/10 px-3.5 py-2.5 text-[12.5px] leading-snug text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || webBusy || !email || !password}
          className="harbor-press-pop flex h-11 items-center justify-center gap-2 rounded-md bg-ink text-[13.5px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              {t("Signing in...")}
            </>
          ) : (
            t("Sign in with email")
          )}
        </button>

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-[12.5px] text-ink-subtle transition-colors hover:text-ink-muted"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={() => openUrl(NUVIO_OFFICIAL_WEB_URL)}
            className="flex items-center gap-1.5 text-[12.5px] text-ink-subtle transition-colors hover:text-ink-muted"
          >
            <span>{t("Create account")}</span>
            <ExternalLink size={11} />
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoFocus,
  disabled,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink-subtle">
        {label}
      </span>
      <div className="relative">
        <input
          type={isPassword && show ? "text" : type}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoComplete={isPassword ? "current-password" : "email"}
          className={`h-11 w-full rounded-md bg-canvas px-3.5 text-[14px] text-ink outline-none transition-colors focus:bg-elevated disabled:opacity-50 ${
            isPassword ? "pe-11" : ""
          }`}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShow((v) => !v)}
            disabled={disabled}
            aria-label={show ? t("Hide password") : t("Show password")}
            title={show ? t("Hide password") : t("Show password")}
            className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-ink-subtle transition-colors hover:text-ink disabled:opacity-50"
          >
            {show ? <EyeOff size={17} strokeWidth={2} /> : <Eye size={17} strokeWidth={2} />}
          </button>
        )}
      </div>
    </label>
  );
}
