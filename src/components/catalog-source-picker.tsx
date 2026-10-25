import { useState, useSyncExternalStore } from "react";
import { Dropdown } from "./dropdown";
import { useProfiles } from "@/lib/profiles";
import { useT } from "@/lib/i18n";
import { getUserAddonsRaw } from "@/lib/addons";
import { activeProfileId } from "@/lib/active-profile-id";
import {
  catalogSource,
  rememberCatalogAddons,
  setCatalogSource,
  subscribeLocalCatalogs,
  type CatalogSource,
} from "@/lib/local-catalogs";

export function useCatalogSource(): CatalogSource {
  useProfiles();
  return useSyncExternalStore(subscribeLocalCatalogs, catalogSource, () => "combined");
}

export function CatalogSourcePicker({ authKey }: { authKey: string | null }) {
  const source = useCatalogSource();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const saveAccount = async () => {
    if (!authKey || busy) return;
    const profile = activeProfileId();
    setBusy(true);
    setStatus("");
    try {
      const addons = await getUserAddonsRaw(authKey);
      if (!addons) throw new Error("account unavailable");
      rememberCatalogAddons(addons, profile);
      if (activeProfileId() === profile) setStatus(t("Account catalogs saved on this device."));
    } catch {
      setStatus(t("Couldn't save account catalogs. Your previous local copy is unchanged."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Dropdown
        ariaLabel={t("Catalog source")}
        value={source}
        options={[
          { value: "combined", label: t("Account + device") },
          { value: "stremio", label: t("Stremio account") },
          { value: "local", label: t("Local / no login") },
        ]}
        onChange={(value) => {
          setCatalogSource(value as CatalogSource);
          setStatus("");
        }}
      />
      {authKey && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveAccount()}
          className="rounded-full bg-elevated px-4 py-2 text-[13px] text-ink-muted disabled:opacity-40"
        >
          {busy ? t("Saving…") : t("Save account catalogs locally")}
        </button>
      )}
      <p className="text-[12px] text-ink-subtle" role="status">
        {status ||
          (source === "local"
            ? t(
                "Saved account catalogs and device addons. No Stremio login needed; addons still need their own connection.",
              )
            : source === "stremio" && !authKey
              ? t("Sign in to Stremio, or choose Local / no login.")
              : "")}
      </p>
    </div>
  );
}
