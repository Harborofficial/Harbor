import { useEffect, useState } from "react";
import { Check, LogIn } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import stremioLogo from "@/assets/stremio.png";
import nuvioLogo from "@/assets/nuvio.png";
import { isNuvioSignedIn, loadNuvioState } from "@/lib/nuvio/nuvio-client";
import { AuthModal } from "@/components/auth-modal";
import { NuvioAuthModal } from "@/components/nuvio-auth-modal";
import { Section } from "../shared";
import { SButton } from "../ui";

export function AccountProviderPanel() {
  const t = useT();
  const { user } = useAuth();
  const { settings, update } = useSettings();
  const [nuvioState, setNuvioState] = useState(() => loadNuvioState());
  const [showStremioAuth, setShowStremioAuth] = useState(false);
  const [showNuvioAuth, setShowNuvioAuth] = useState(false);

  useEffect(() => {
    const onNuvioChange = () => setNuvioState(loadNuvioState());
    window.addEventListener("harbor:nuvio-state-changed", onNuvioChange);
    return () => window.removeEventListener("harbor:nuvio-state-changed", onNuvioChange);
  }, []);

  const nuvioConnected = isNuvioSignedIn();
  const nuvioUser = nuvioState.session?.user;
  const activeProvider = settings.accountProvider || "stremio";

  const selectProvider = (provider: "stremio" | "nuvio") => {
    if (provider === "nuvio" && !nuvioConnected) {
      setShowNuvioAuth(true);
      return;
    }
    if (settings.accountProvider === provider) return;
    try {
      localStorage.setItem("harbor.account-provider", provider);
      const raw = localStorage.getItem("harbor.settings");
      if (raw) {
        const p = JSON.parse(raw);
        localStorage.setItem("harbor.settings", JSON.stringify({ ...p, accountProvider: provider }));
      }
      const sharedRaw = localStorage.getItem("harbor.settings.shared");
      if (sharedRaw) {
        const p = JSON.parse(sharedRaw);
        localStorage.setItem("harbor.settings.shared", JSON.stringify({ ...p, accountProvider: provider }));
      }
    } catch {}
    update({ accountProvider: provider });
    window.dispatchEvent(
      new CustomEvent("harbor:account-provider-changed", { detail: { provider } }),
    );
  };

  return (
    <Section
      title={t("Account Provider")}
      subtitle={t(
        "Choose which streaming service powers your active identity, profiles, watch progress, and addons.",
      )}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Stremio Card */}
        <div
          onClick={() => selectProvider("stremio")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selectProvider("stremio")}
          className={`relative flex flex-col justify-between rounded-2xl border p-5 transition-all cursor-pointer ${
            activeProvider === "stremio"
              ? "border-accent bg-elevated/80 shadow-[0_0_25px_-5px_rgba(var(--color-accent-rgb),0.3)] ring-1 ring-accent"
              : "border-edge-soft bg-elevated/30 hover:border-edge hover:bg-elevated/50"
          }`}
        >
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src={stremioLogo}
                  alt="Stremio"
                  className="h-9 w-9 rounded-xl object-contain shadow-md"
                />
                <div>
                  <h3 className="font-display text-[17px] font-semibold text-ink">Stremio</h3>
                  <div className="flex items-center gap-1.5 text-[12px] text-ink-subtle">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        user ? "bg-emerald-400" : "bg-neutral-500"
                      }`}
                    />
                    <span>
                      {user ? t("Connected as {email}", { email: user.email }) : t("Not connected")}
                    </span>
                  </div>
                </div>
              </div>

              {activeProvider === "stremio" && (
                <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-accent">
                  <Check size={12} strokeWidth={3} />
                  {t("Active")}
                </span>
              )}
            </div>

            <p className="mt-4 text-[13.5px] leading-relaxed text-ink-muted">
              {t(
                "Use Stremio's cloud backend. Your library, installed streaming addons, and official watch history stay synced with your Stremio account.",
              )}
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              <span
                className={`rounded-md px-2 py-0.5 text-[11.5px] transition-colors ${
                  activeProvider === "stremio"
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30 font-medium"
                    : "bg-canvas/60 text-ink-subtle ring-1 ring-edge-soft"
                }`}
              >
                {t("Single cloud account")}
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-[11.5px] transition-colors ${
                  activeProvider === "stremio"
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30 font-medium"
                    : "bg-canvas/60 text-ink-subtle ring-1 ring-edge-soft"
                }`}
              >
                {t("Stremio Addon Protocol")}
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-[11.5px] transition-colors ${
                  activeProvider === "stremio"
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30 font-medium"
                    : "bg-canvas/60 text-ink-subtle ring-1 ring-edge-soft"
                }`}
              >
                {t("Harbor local profiles")}
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-edge-soft pt-4">
            {!user ? (
              <div onClick={(e) => e.stopPropagation()}>
                <SButton
                  variant="primary"
                  onClick={() => {
                    setShowStremioAuth(true);
                  }}
                >
                  <LogIn size={14} />
                  {t("Connect Stremio")}
                </SButton>
              </div>
            ) : (
              <span className="text-[12px] text-ink-subtle font-mono truncate max-w-[200px]">
                {user.email}
              </span>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                selectProvider("stremio");
              }}
              className={`rounded-xl px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                activeProvider === "stremio"
                  ? "bg-accent text-canvas font-semibold shadow-md shadow-accent/20"
                  : "bg-raised text-ink hover:bg-elevated"
              }`}
            >
              {activeProvider === "stremio" ? t("Selected") : t("Select Stremio")}
            </button>
          </div>
        </div>

        {/* Nuvio Card */}
        <div
          onClick={() => selectProvider("nuvio")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selectProvider("nuvio")}
          className={`relative flex flex-col justify-between rounded-2xl border p-5 transition-all cursor-pointer ${
            activeProvider === "nuvio"
              ? "border-accent bg-elevated/80 shadow-[0_0_25px_-5px_rgba(var(--color-accent-rgb),0.3)] ring-1 ring-accent"
              : "border-edge-soft bg-elevated/30 hover:border-edge hover:bg-elevated/50"
          }`}
        >
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src={nuvioLogo}
                  alt="Nuvio"
                  className="h-9 w-9 rounded-xl object-contain shadow-md"
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-[17px] font-semibold text-ink">Nuvio</h3>
                    <span className="inline-flex shrink-0 items-center rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-accent ring-1 ring-accent/30">
                      {t("Experimental")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[12px] text-ink-subtle">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        nuvioConnected ? "bg-emerald-400" : "bg-neutral-500"
                      }`}
                    />
                    <span>
                      {nuvioConnected
                        ? t("Connected as {email}", {
                            email: nuvioUser?.email || nuvioUser?.id || "Nuvio User",
                          })
                        : t("Not connected")}
                    </span>
                  </div>
                </div>
              </div>

              {activeProvider === "nuvio" && (
                <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-accent">
                  <Check size={12} strokeWidth={3} />
                  {t("Active")}
                </span>
              )}
            </div>

            <p className="mt-4 text-[13.5px] leading-relaxed text-ink-muted">
              {t(
                "Use Nuvio's cloud backend. Sync up to 6 cloud profiles, server-side PIN locks, per-profile continue watching, and inherited primary addons.",
              )}
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              <span
                className={`rounded-md px-2 py-0.5 text-[11.5px] transition-colors ${
                  activeProvider === "nuvio"
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30 font-medium"
                    : "bg-canvas/60 text-ink-subtle ring-1 ring-edge-soft"
                }`}
              >
                {t("6 cloud profiles")}
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-[11.5px] transition-colors ${
                  activeProvider === "nuvio"
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30 font-medium"
                    : "bg-canvas/60 text-ink-subtle ring-1 ring-edge-soft"
                }`}
              >
                {t("Cloud PIN protection")}
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-[11.5px] transition-colors ${
                  activeProvider === "nuvio"
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30 font-medium"
                    : "bg-canvas/60 text-ink-subtle ring-1 ring-edge-soft"
                }`}
              >
                {t("Isolated continue watching")}
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-[11.5px] transition-colors ${
                  activeProvider === "nuvio"
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30 font-medium"
                    : "bg-canvas/60 text-ink-subtle ring-1 ring-edge-soft"
                }`}
              >
                {t("Use primary addons")}
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-edge-soft pt-4">
            {!nuvioConnected ? (
              <div onClick={(e) => e.stopPropagation()}>
                <SButton
                  variant="primary"
                  onClick={() => {
                    setShowNuvioAuth(true);
                  }}
                >
                  <LogIn size={14} />
                  {t("Connect Nuvio")}
                </SButton>
              </div>
            ) : (
              <span className="text-[12px] text-ink-subtle font-mono truncate max-w-[200px]">
                {nuvioUser?.email || nuvioUser?.id}
              </span>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                selectProvider("nuvio");
              }}
              className={`rounded-xl px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                activeProvider === "nuvio"
                  ? "bg-accent text-canvas font-semibold shadow-md shadow-accent/20"
                  : "bg-raised text-ink hover:bg-elevated"
              }`}
            >
              {activeProvider === "nuvio" ? t("Selected") : t("Select Nuvio")}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-edge-soft bg-elevated/30 p-4 text-[13px] leading-relaxed text-ink-muted">
        <p>
          <strong className="text-ink">{t("How Account Provider works:")}</strong>{" "}
          {t(
            "Selecting a provider shifts your profiles, watch history, and addons into that provider's ecosystem. Both accounts remain authenticated so you can switch between them at any time without losing data.",
          )}
        </p>
      </div>

      {showStremioAuth && <AuthModal onClose={() => setShowStremioAuth(false)} />}
      {showNuvioAuth && (
        <NuvioAuthModal
          onClose={() => setShowNuvioAuth(false)}
          onSuccess={() => {
            selectProvider("nuvio");
          }}
        />
      )}
    </Section>
  );
}
