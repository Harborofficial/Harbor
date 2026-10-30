import { SettingGroup } from "./kit";
import { useSettings } from "@/lib/settings";
import { useEffect, useState } from "react";
import { Info, Link2 } from "./icons";
import { useT } from "@/lib/i18n";
import { ROW_DESC, Section, ToggleRow } from "./shared";
import { useSubTabs } from "./sub-tabs";
import { IdentityTab } from "./account/identity-tab";
import { ProfilesStrip } from "./account/profiles-strip";
import { StartupDefaults } from "./account/startup-defaults";
import { SettingsScopeCard } from "./account/settings-scope-card";
import { StremioCard } from "./account/stremio-card";
import { SyncedAddonsCard } from "./account/synced-addons-card";
import { HarborAccountPanel } from "@/views/account/harbor-account-panel";

import { NuvioCard } from "./account/nuvio-card";
import { NuvioSyncedAddonsCard } from "./account/nuvio-synced-addons-card";

import { AccountProviderPanel } from "./account/account-provider-panel";
import { NuvioProfilesTab } from "./account/nuvio-profiles-tab";

import { useProfiles } from "@/lib/profiles";
import { loadNuvioState } from "@/lib/nuvio/nuvio-client";

import { SecondaryPrivilegesCard } from "./account/secondary-privileges-card";
import { SettingsModal, ModalButton } from "./kit";
import { ShieldAlert } from "lucide-react";
import { getSecondaryPrivileges } from "@/lib/settings/defaults";
import { isStremioActivePrimary, activeProfileIsPrimary } from "@/lib/active-profile-id";

type Tab = "provider" | "you" | "profiles" | "harbor" | "stremio" | "nuvio";

export function AccountStub() {
  const t = useT();
  const { profiles, activeProfile, openPicker } = useProfiles();
  const { settings } = useSettings();
  const isNuvio = settings.accountProvider === "nuvio";
  const [nuvioState, setNuvioState] = useState(() => loadNuvioState());
  const [forceTick, setForceTick] = useState(0);
  void forceTick;
  const [restrictedModal, setRestrictedModal] = useState<{
    title: string;
    description: string;
  } | null>(null);

  useEffect(() => {
    const onSync = () => setNuvioState(loadNuvioState());
    const onProfileSync = () => setForceTick((t) => t + 1);
    const onProviderChanged = () => {
      setTab("provider");
      setForceTick((t) => t + 1);
    };
    window.addEventListener("harbor:account-provider-changed", onProviderChanged);
    window.addEventListener("harbor:nuvio-state-changed", onSync);
    window.addEventListener("harbor:nuvio-profile-changed", onSync);
    window.addEventListener("harbor:nuvio-profiles-updated", onSync);
    window.addEventListener("harbor:active-profile-changed", onProfileSync);
    window.addEventListener("harbor:profiles-updated", onProfileSync);
    window.addEventListener("harbor:secondary-privileges-changed", onProfileSync);
    window.addEventListener("harbor:settings-changed", onProfileSync);
    return () => {
      window.removeEventListener("harbor:account-provider-changed", onProviderChanged);
      window.removeEventListener("harbor:secondary-privileges-changed", onProfileSync);
      window.removeEventListener("harbor:settings-changed", onProfileSync);
      window.removeEventListener("harbor:nuvio-state-changed", onSync);
      window.removeEventListener("harbor:nuvio-profile-changed", onSync);
      window.removeEventListener("harbor:nuvio-profiles-updated", onSync);
      window.removeEventListener("harbor:active-profile-changed", onProfileSync);
      window.removeEventListener("harbor:profiles-updated", onProfileSync);
    };
  }, []);

  const isPrimary =
    activeProfileIsPrimary() ||
    (isNuvio
      ? Number(nuvioState.activeProfileIndex ?? 1) === 1
      : isStremioActivePrimary(activeProfile, profiles));
  const tabs = [
    { id: "you" as const, label: t("Your profile") },
    { id: "profiles" as const, label: t("Profiles") },
    { id: "harbor" as const, label: t("Harbor account") },
    { id: "provider" as const, label: t("Account provider") },
    ...(isNuvio
      ? [{ id: "nuvio" as const, label: t("Nuvio") }]
      : [{ id: "stremio" as const, label: t("Stremio") }]),
  ];

  const [tab, setTab] = useState<Tab>("you");

  useEffect(() => {
    const liveIsPrimary =
      activeProfileIsPrimary() ||
      (isNuvio
        ? Number(loadNuvioState().activeProfileIndex ?? 1) === 1
        : isStremioActivePrimary(activeProfile, profiles));
    if (liveIsPrimary) return;
    const currentPrivs = getSecondaryPrivileges(settings, isNuvio);
    if (tab === "provider" && !currentPrivs.canViewAccountProvider) setTab("you");
    if (tab === "harbor" && !currentPrivs.canViewHarborAccount) setTab("you");
    if ((tab === "stremio" || tab === "nuvio") && !currentPrivs.canViewProviderAccount)
      setTab("you");
  }, [tab, isPrimary, isNuvio, forceTick]);

  const handleTabSelect = (next: Tab) => {
    const liveIsPrimary =
      activeProfileIsPrimary() ||
      (isNuvio
        ? Number(loadNuvioState().activeProfileIndex ?? 1) === 1
        : isStremioActivePrimary(activeProfile, profiles));

    if (liveIsPrimary) {
      setTab(next);
      return;
    }

    if (next === "you" || next === "profiles") {
      setTab(next);
      return;
    }

    const currentPrivs = getSecondaryPrivileges(settings, isNuvio);

    if (next === "provider") {
      if (currentPrivs?.canViewAccountProvider) {
        setTab(next);
        return;
      }
      setRestrictedModal({
        title: t("Accessible for primary profile"),
        description: t(
          "Account provider settings allow switching between Stremio and Nuvio. This action is restricted to the primary profile.",
        ),
      });
      return;
    }

    if (next === "harbor") {
      if (currentPrivs?.canViewHarborAccount) {
        setTab(next);
        return;
      }
      setRestrictedModal({
        title: t("Accessible for primary profile"),
        description: t(
          "Harbor master cloud account management is restricted to the primary profile.",
        ),
      });
      return;
    }

    if (next === "stremio" || next === "nuvio") {
      if (currentPrivs?.canViewProviderAccount) {
        setTab(next);
        return;
      }
      setRestrictedModal({
        title: t("Accessible for primary profile"),
        description: isNuvio
          ? t(
              "Nuvio account credentials, profile slot mapping, and cloud addons are restricted to the primary profile.",
            )
          : t(
              "Stremio account credentials, install links, and synced addons are restricted to the primary profile.",
            ),
      });
      return;
    }

    setTab(next);
  };

  useSubTabs(tabs, tab, (id) => handleTabSelect(id as Tab));

  return (
    <>
      <div key={tab} className="harbor-cascade flex flex-col gap-10">
        {tab === "provider" && <AccountProviderPanel />}
        {tab === "you" && <IdentityTab />}
        {tab === "profiles" && <ProfilesTab />}
        {tab === "harbor" && <HarborAccountPanel />}
        {tab === "stremio" && <StremioTab />}
        {tab === "nuvio" && <NuvioTab />}
      </div>

      {restrictedModal && (
        <SettingsModal
          open={true}
          onClose={() => setRestrictedModal(null)}
          title={restrictedModal.title}
          sub={restrictedModal.description}
          actions={
            <div className="flex items-center gap-2">
              <ModalButton
                ghost
                onClick={() => {
                  setRestrictedModal(null);
                  openPicker({ kind: "list" });
                }}
              >
                {t("Switch profile")}
              </ModalButton>
              <ModalButton onClick={() => setRestrictedModal(null)}>{t("OK")}</ModalButton>
            </div>
          }
        >
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-accent/15 text-accent ring-1 ring-accent/30">
              <ShieldAlert size={28} strokeWidth={2.2} />
            </span>
            <p className="max-w-[42ch] text-[14.5px] leading-relaxed text-ink-muted">
              {t(
                "To access administrative account settings, switch to the primary profile or have the primary profile enable permissions in Settings > Profiles > Privileges for secondary profiles.",
              )}
            </p>
          </div>
        </SettingsModal>
      )}
    </>
  );
}

function NuvioTab() {
  const t = useT();
  return (
    <>
      <Section
        title={t("Nuvio account")}
        subtitle={t(
          "Connect your Nuvio account to sync watch progress, profile slots, and addons.",
        )}
      >
        <NuvioCard />
      </Section>
      <Section
        title={t("Synced addons")}
        subtitle={t("Harbor pulls addons configured in your Nuvio profile.")}
      >
        <NuvioSyncedAddonsCard />
      </Section>
    </>
  );
}

function ProfilesTab() {
  const t = useT();
  const { settings } = useSettings();
  const { profiles, activeProfile } = useProfiles();
  const isNuvio = settings.accountProvider === "nuvio";
  const isPrimary = isNuvio
    ? Number(loadNuvioState().activeProfileIndex ?? 1) === 1
    : isStremioActivePrimary(activeProfile, profiles);

  if (isNuvio) {
    return <NuvioProfilesTab />;
  }

  const canManageStartup = isPrimary || getSecondaryPrivileges(settings, isNuvio).canManageStartup;

  return (
    <Section
      title={t("Profiles")}
      subtitle={t(
        "Create profiles for the people who use Harbor. Each can have its own appearance, settings, and PIN.",
      )}
    >
      <SettingGroup label={t("Everyone on this Harbor")}>
        <p className={`max-w-[70ch] ${ROW_DESC}`}>
          {isPrimary
            ? t(
                "Choose a profile to switch. Use the pencil to edit its details and access settings.",
              )
            : t(
                "Choose a profile to switch. You can edit your own profile's details and settings.",
              )}
        </p>
        <ProfilesStrip />
      </SettingGroup>
      {canManageStartup && <StartupDefaults />}
      <SettingsScopeCard />
      {isPrimary && <SecondaryPrivilegesCard />}
    </Section>
  );
}

function StremioTab() {
  const t = useT();
  return (
    <>
      <Section
        title={t("Stremio install links")}
        subtitle={t(
          "Harbor catches stremio:// install links so the configure-and-install flow stays inside the app. Every install also syncs to your Stremio account, so the official app remains the canonical home for your library.",
        )}
      >
        <StremioDeeplinkRow />
      </Section>

      <Section
        title={t("Stremio account")}
        subtitle={t("Library, watch progress, and addon collection sync from this account.")}
      >
        <StremioCard />
      </Section>
      <Section
        title={t("Synced addons")}
        subtitle={t(
          "Harbor pulls your addon collection from Stremio. Manage individual addons in Streaming sources.",
        )}
      >
        <SyncedAddonsCard />
      </Section>
    </>
  );
}

function StremioDeeplinkRow() {
  const t = useT();
  const { settings, update } = useSettings();
  const on = settings.stremioDeeplinkInstall;
  return (
    <SettingGroup>
      <ToggleRow
        label={t("Catch stremio:// install links inside Harbor")}
        sub={t(
          "Harbor's in-app installer animates the manifest install and keeps you in context. Anything Harbor installs is also synced to your Stremio account, so the official app stays the canonical library. Turn this off and Stremio becomes the only handler for stremio:// links; Harbor still installs anything you trigger from inside the app (Configure & install, paste, drag-and-drop).",
        )}
        leading={<Link2 size={18} strokeWidth={2} />}
        value={on}
        onChange={(stremioDeeplinkInstall) => update({ stremioDeeplinkInstall })}
      />
      <div className="flex items-start gap-2.5 rounded-[10px] bg-elevated px-4 py-3">
        <Info size={18} className="mt-[2px] shrink-0 text-ink-subtle" />
        <p className={`max-w-[66ch] ${ROW_DESC}`}>
          {on
            ? t(
                "Heads up: if Stremio is also installed, Windows may ask which app to use the first time a stremio:// link fires. Pick Harbor to make it stick.",
              )
            : t(
                "stremio:// links now open in the Stremio app. Harbor will only install when you trigger it from inside Harbor.",
              )}
        </p>
      </div>
    </SettingGroup>
  );
}
