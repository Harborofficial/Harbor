import { useEffect } from "react";
import { useProfiles } from "./profiles";
import { useSettings } from "./settings";

export function SettingsProfileBridge() {
  const { activeProfile } = useProfiles();
  const { settings, switchProfile } = useSettings();
  const isNuvio = settings.accountProvider === "nuvio";

  useEffect(() => {
    // In Nuvio mode, all profiles share the user's unified Harbor app settings.
    // In Stremio mode, handle per-profile settings switching if active.
    if (!isNuvio && activeProfile) {
      switchProfile(activeProfile.id, activeProfile.settingsLinked !== false);
    }
  }, [isNuvio, activeProfile?.id, activeProfile?.settingsLinked, switchProfile]);

  return null;
}
