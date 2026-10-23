import { ArrowRight, Loader2 } from "../icons";
import { useEffect, useState } from "react";
import { AddonLogoStack } from "@/components/addon-logo";
import type { Addon } from "@/lib/addons";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { requestAddonsTab } from "@/views/addons";
import { SettingRow } from "../kit";
import { SButton } from "../ui";
import nuvioIcon from "@/assets/nuvio.png";
import { loadNuvioState } from "@/lib/nuvio/nuvio-client";
import { pullAddonsFromNuvio } from "@/lib/nuvio/nuvio-sync";
import { recordAddonOrigins } from "@/lib/nuvio/nuvio-addon-registry";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { Layers, Network } from "lucide-react";
import { userAddons } from "@/lib/addons";

const CAPTION = "text-[13px] font-bold uppercase leading-[17px] tracking-[0.72px] text-ink-subtle";

export function NuvioSyncedAddonsCard() {
  const t = useT();
  const { authKey } = useAuth();
  const [nuvioAddons, setNuvioAddons] = useState<Addon[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const { setView } = useView();
  const state = loadNuvioState();
  const isConnected = state.session != null;

  const sync = async () => {
    if (!isConnected || busy) return;
    setBusy(true);
    try {
      const nuvioItems = await pullAddonsFromNuvio("primary");
      const mapped: Addon[] = nuvioItems.map((n) => ({
        transportUrl: n.url,
        manifest: {
          id: n.url,
          name: n.name || "Addon",
        },
      }));
      setNuvioAddons(mapped);
      setLastSynced(Date.now());

      // Update origin registry between Stremio and Nuvio
      const stremioList = authKey ? await userAddons(authKey).catch(() => [] as Addon[]) : [];
      recordAddonOrigins(
        stremioList.map((a) => a.transportUrl),
        nuvioItems.map((a) => a.url),
      );
    } catch {
      setNuvioAddons(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (isConnected && nuvioAddons == null) void sync();
  }, [isConnected]);

  if (!isConnected) {
    return (
      <SettingRow
        icon={<img src={nuvioIcon} alt="Nuvio" className="h-5 w-5 rounded-md object-contain" />}
        label={t("Nuvio collection")}
        desc={t("Connect your Nuvio account first. Your installed addons sync from there.")}
      />
    );
  }

  const count = nuvioAddons?.length ?? null;
  const MAX_VISIBLE = 4;

  const { settings, update } = useSettings();
  const addonMode = settings.nuvioAddonMode ?? "separate";

  const setMode = (mode: "separate" | "combined") => {
    update({ nuvioAddonMode: mode });
    window.dispatchEvent(new CustomEvent("harbor:addons-changed"));
    window.dispatchEvent(new CustomEvent("harbor:nuvio-addons-changed"));
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        wide
        icon={<img src={nuvioIcon} alt="Nuvio" className="h-5 w-5 rounded-md object-contain" />}
        label={t("Nuvio collection")}
        desc={
          lastSynced
            ? t("Last synced {n}s ago.", { n: Math.round((Date.now() - lastSynced) / 1000) })
            : t("Pulled from your Nuvio account.")
        }
      >
        <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex shrink-0 items-baseline gap-2">
            <span className="font-display text-[28px] font-medium leading-none tracking-tight text-ink">
              {count != null ? count : "…"}
            </span>
            <span className={CAPTION}>{count === 1 ? t("addon synced") : t("addons synced")}</span>
          </div>
          {nuvioAddons && nuvioAddons.length > 0 && (
            <div className="flex items-center">
              <AddonLogoStack
                addons={nuvioAddons.slice(0, MAX_VISIBLE).map((a) => ({
                  id: a.manifest.id,
                  name: a.manifest.name,
                  logo: a.manifest.logo,
                }))}
              />
            </div>
          )}
          <div aria-busy={busy} className="ms-auto flex shrink-0 flex-wrap items-center gap-2.5">
            <SButton variant="primary" onClick={sync}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              {busy ? t("Syncing…") : t("Sync now")}
            </SButton>
            <SButton
              onClick={() => {
                requestAddonsTab("installed");
                setView("addons");
              }}
            >
              {t("Manage")}
              <ArrowRight size={16} strokeWidth={2.2} className="dir-icon" />
            </SButton>
          </div>
        </div>
      </SettingRow>

      <SettingRow
        wide
        label={t("Addon collection mode")}
        desc={t("Choose whether Nuvio operates with its own isolated addons or merges with your Stremio library.")}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("separate")}
            className={`group flex flex-col gap-2 rounded-xl border p-4 text-start transition-all cursor-pointer ${
              addonMode === "separate"
                ? "border-accent bg-accent/10 shadow-sm ring-1 ring-accent"
                : "border-edge-soft bg-canvas/40 hover:border-edge hover:bg-canvas/70"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Layers
                  size={17}
                  className={addonMode === "separate" ? "text-accent" : "text-ink-subtle"}
                />
                <span className="text-[14.5px] font-semibold text-ink">
                  {t("Maintain separate addons")}
                </span>
              </div>
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  addonMode === "separate"
                    ? "bg-accent text-canvas"
                    : "bg-elevated text-ink-subtle"
                }`}
              >
                {t("Isolated")}
              </span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-subtle">
              {t(
                "Maintain an independent addon roster for Nuvio. Stremio addons are kept separate and will not leach into Nuvio pages or playback stream sources.",
              )}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setMode("combined")}
            className={`group flex flex-col gap-2 rounded-xl border p-4 text-start transition-all cursor-pointer ${
              addonMode === "combined"
                ? "border-accent bg-accent/10 shadow-sm ring-1 ring-accent"
                : "border-edge-soft bg-canvas/40 hover:border-edge hover:bg-canvas/70"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Network
                  size={17}
                  className={addonMode === "combined" ? "text-accent" : "text-ink-subtle"}
                />
                <span className="text-[14.5px] font-semibold text-ink">
                  {t("Display combined addons")}
                </span>
              </div>
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  addonMode === "combined"
                    ? "bg-accent text-canvas"
                    : "bg-elevated text-ink-subtle"
                }`}
              >
                {t("With tags")}
              </span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-subtle">
              {t(
                "Show both Nuvio and Stremio addons together in your library, with [Nuvio] and [Stremio] origin tags across the Addons manager and streaming sources.",
              )}
            </p>
          </button>
        </div>
      </SettingRow>
    </div>
  );
}
