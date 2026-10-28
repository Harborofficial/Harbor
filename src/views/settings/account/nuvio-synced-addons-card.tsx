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

  return (
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
  );
}
