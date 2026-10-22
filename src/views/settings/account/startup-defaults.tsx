import { useEffect, useState } from "react";
import { Dropdown } from "@/components/dropdown";
import { Clock, UserCheck } from "../icons";
import { useProfiles } from "@/lib/profiles";
import { PickerBackground } from "./picker-background";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { ROW_DESC, Segmented } from "../shared";
import { SettingGroup, SettingRow } from "../kit";
import { isNuvioProviderActive } from "@/lib/active-profile-id";
import { loadNuvioState } from "@/lib/nuvio/nuvio-client";

const INTERVALS = [
  { value: "launch", label: "Every launch" },
  { value: "15m", label: "Every 15 min" },
  { value: "30m", label: "Every 30 min" },
  { value: "never", label: "Never" },
] as const;

type Interval = (typeof INTERVALS)[number]["value"];

export function StartupDefaults() {
  const t = useT();
  const { settings, update } = useSettings();
  const isNuvio = settings.accountProvider === "nuvio" || isNuvioProviderActive();
  const [nuvioState, setNuvioState] = useState(() => loadNuvioState());
  const { profiles: stremioProfiles } = useProfiles();

  useEffect(() => {
    if (!isNuvio) return;
    const onNuvioChange = () => setNuvioState(loadNuvioState());
    window.addEventListener("harbor:nuvio-state-changed", onNuvioChange);
    window.addEventListener("harbor:nuvio-profile-changed", onNuvioChange);
    window.addEventListener("harbor:nuvio-profiles-updated", onNuvioChange);
    return () => {
      window.removeEventListener("harbor:nuvio-state-changed", onNuvioChange);
      window.removeEventListener("harbor:nuvio-profile-changed", onNuvioChange);
      window.removeEventListener("harbor:nuvio-profiles-updated", onNuvioChange);
    };
  }, [isNuvio]);

  const activeProfileCount = isNuvio ? nuvioState.profiles.length : stremioProfiles.length;
  if (activeProfileCount <= 1) return null;

  const interval = settings.profilePromptInterval ?? "launch";
  const defaultId = isNuvio
    ? String(settings.nuvioDefaultProfileId ?? settings.defaultProfileId ?? "")
    : String(settings.defaultProfileId ?? "");

  const options = isNuvio
    ? [
        { value: "", label: t("No default profile") },
        ...nuvioState.profiles
          .filter((p) => !p.pin_enabled)
          .map((p) => ({
            value: String(p.profile_index),
            label: p.name || `Profile ${p.profile_index}`,
          })),
      ]
    : [
        { value: "", label: t("No default profile") },
        ...stremioProfiles
          .filter((p) => !p.passwordHash && !p.id.startsWith("nuvio-"))
          .map((p) => ({ value: p.id, label: p.name })),
      ];

  const handleDefaultChange = (v: string) => {
    if (isNuvio) {
      update({ nuvioDefaultProfileId: v, defaultProfileId: v });
      try {
        for (const storageKey of ["harbor.settings.shared", "harbor.settings"]) {
          const raw = localStorage.getItem(storageKey);
          const parsed = raw ? JSON.parse(raw) : {};
          parsed.nuvioDefaultProfileId = v;
          parsed.defaultProfileId = v;
          localStorage.setItem(storageKey, JSON.stringify(parsed));
        }
      } catch {}
    } else {
      update({ defaultProfileId: v });
    }
  };

  return (
    <>
      <SettingGroup label={t("Startup & default")}>
        <SettingRow
          wide
          icon={<Clock size={18} strokeWidth={2} />}
          label={t("Who's watching")}
          desc={t(
            "Choose when Harbor asks you to pick a profile. Timed prompts appear when you return to Harbor.",
          )}
        >
          <Segmented<Interval>
            value={interval}
            options={INTERVALS.map((o) => ({ ...o, label: t(o.label) }))}
            onChange={(v) => update({ profilePromptInterval: v })}
          />
        </SettingRow>
        <SettingRow
          icon={<UserCheck size={18} strokeWidth={2} />}
          label={t("Start as")}
          desc={t(
            "Open this profile at launch. Timed prompts can still appear later. Profiles with a PIN cannot be a default.",
          )}
        >
          <div className="w-[280px] max-w-full">
            <Dropdown
              value={defaultId}
              placeholder={t("No default profile")}
              onChange={handleDefaultChange}
              options={options}
            />
          </div>
        </SettingRow>
      </SettingGroup>
      <SettingGroup label={t("Who's watching background")}>
        <p className={`max-w-[70ch] ${ROW_DESC}`}>
          {t(
            "Shown behind the profile picker only. It does not change the app theme or wallpaper.",
          )}
        </p>
        <PickerBackground />
      </SettingGroup>
    </>
  );
}
