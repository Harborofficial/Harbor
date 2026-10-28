import { ArrowLeftRight, Clock, Cloud, KeyRound, LogOut, UserPlus } from "lucide-react";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { SettingGroup } from "../kit";
import { ROW_DESC, ToggleRow } from "../shared";
import type { SecondaryProfilePrivileges } from "@/lib/settings/types";

import { getSecondaryPrivileges } from "@/lib/settings/defaults";

export function SecondaryPrivilegesCard() {
  const t = useT();
  const { settings, update } = useSettings();
  const isNuvio = settings.accountProvider === "nuvio";

  const privs = getSecondaryPrivileges(settings, isNuvio);

  const updatePriv = (key: keyof SecondaryProfilePrivileges, val: boolean) => {
    const nextPrivs = {
      ...privs,
      [key]: val,
    };
    if (isNuvio) {
      update({
        nuvioSecondaryPrivileges: nextPrivs,
      });
    } else {
      update({
        secondaryPrivileges: nextPrivs,
      });
    }

    try {
      for (const storageKey of ["harbor.settings.shared", "harbor.settings"]) {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (isNuvio) {
            parsed.nuvioSecondaryPrivileges = nextPrivs;
          } else {
            parsed.secondaryPrivileges = nextPrivs;
          }
          localStorage.setItem(storageKey, JSON.stringify(parsed));
        }
      }
    } catch {}
  };

  return (
    <SettingGroup label={t("Privileges for secondary profiles")}>
      <p className={`max-w-[70ch] ${ROW_DESC}`}>
        {t(
          "By default, secondary profiles can only customize their own profile and preferences. You can grant secondary profiles permission to perform administrative actions below.",
        )}
      </p>

      {/* 1. Add / Create profiles */}
      <ToggleRow
        leading={<UserPlus size={18} strokeWidth={2} />}
        label={t("Allow adding new profiles")}
        sub={t(
          "Displays the '+ Add profile' button in Settings and 'Who's watching' for secondary profiles.",
        )}
        value={privs.canAddProfiles}
        onChange={(v) => updatePriv("canAddProfiles", v)}
      />

      {/* 2. Configure Startup Defaults */}
      <ToggleRow
        leading={<Clock size={18} strokeWidth={2} />}
        label={t("Allow configuring startup defaults & background")}
        sub={t(
          "Allows secondary profiles to configure the default startup profile ('Start as'), prompt interval, and Who's watching background.",
        )}
        value={privs.canManageStartup}
        onChange={(v) => updatePriv("canManageStartup", v)}
      />

      {/* 3. Account Provider tab */}
      <ToggleRow
        leading={<ArrowLeftRight size={18} strokeWidth={2} />}
        label={t("Allow switching account provider")}
        sub={t(
          "Allows secondary profiles to access the Account Provider tab and switch between Stremio and Nuvio modes.",
        )}
        value={privs.canViewAccountProvider}
        onChange={(v) => updatePriv("canViewAccountProvider", v)}
      />

      {/* 4. Harbor Account tab */}
      <ToggleRow
        leading={<Cloud size={18} strokeWidth={2} />}
        label={t("Allow managing Harbor account")}
        sub={t(
          "Allows secondary profiles to access the Harbor account tab to view sync status and manage cloud credentials.",
        )}
        value={privs.canViewHarborAccount}
        onChange={(v) => updatePriv("canViewHarborAccount", v)}
      />

      {/* 5. Provider Account tab */}
      {/* 5. Provider Account tab */}
      <ToggleRow
        leading={<KeyRound size={18} strokeWidth={2} />}
        label={t("Allow managing Stremio & Nuvio account")}
        sub={t(
          "Allows secondary profiles to access the Stremio or Nuvio account tab to view credentials, profile mapping, install links, and synced addons.",
        )}
        value={privs.canViewProviderAccount}
        onChange={(v) => updatePriv("canViewProviderAccount", v)}
      />

      {/* 6. Root account sign out / disconnect in Chrome menu */}
      <ToggleRow
        leading={<LogOut size={18} strokeWidth={2} />}
        label={t("Allow signing out of Stremio & Nuvio from menu")}
        sub={t(
          "Allows secondary profiles to disconnect or log out of the root Stremio or Nuvio account from the top-right profile dropdown.",
        )}
        value={privs.canSignOutRoot}
        onChange={(v) => updatePriv("canSignOutRoot", v)}
      />
    </SettingGroup>
  );
}
