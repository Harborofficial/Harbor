import { useEffect, useState } from "react";
import { Check, Lock, Pencil, Plus, RefreshCw, Tv } from "lucide-react";
import { useT } from "@/lib/i18n";
import { loadNuvioState, isNuvioSignedIn } from "@/lib/nuvio/nuvio-client";
import {
  pullNuvioProfiles,
  isNuvioProfileUnlocked,
  setActiveNuvioProfile,
  resolveNuvioAvatar,
  MAX_NUVIO_PROFILES,
} from "@/lib/nuvio/nuvio-profiles";
import type { NuvioProfile } from "@/lib/nuvio/nuvio-types";
import { Section, ROW_TITLE, ROW_DESC } from "../shared";
import { SettingGroup, ROW_ACTION_PRIMARY } from "../kit";
import { useSettings } from "@/lib/settings";
import { useProfiles } from "@/lib/profiles";
import { getSecondaryPrivileges } from "@/lib/settings/defaults";
import { SecondaryPrivilegesCard } from "./secondary-privileges-card";
import { StartupDefaults } from "./startup-defaults";
import { SettingsScopeCard } from "./settings-scope-card";
import { NuvioAuthModal } from "@/components/nuvio-auth-modal";
import { activateNuvioAccountProvider } from "@/lib/nuvio/nuvio-auth";

const QUAL =
  "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-[6px] px-2 text-[13px] font-bold uppercase leading-[17px] tracking-[0.72px]";

const CELL =
  "relative flex flex-col items-center gap-3 rounded-[10px] border bg-canvas p-4 transition-colors";

export function NuvioProfilesTab() {
  const t = useT();
  const { openPicker } = useProfiles();
  const [nuvioState, setNuvioState] = useState(() => loadNuvioState());
  const [loading, setLoading] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const signedIn = isNuvioSignedIn();

  const refresh = async () => {
    if (!signedIn) return;
    setLoading(true);
    try {
      await pullNuvioProfiles();
      setNuvioState(loadNuvioState());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const handleProfileChange = () => setNuvioState(loadNuvioState());
    window.addEventListener("harbor:nuvio-state-changed", handleProfileChange);
    window.addEventListener("harbor:nuvio-profile-changed", handleProfileChange);
    window.addEventListener("harbor:nuvio-profiles-updated", handleProfileChange);
    window.addEventListener("harbor:secondary-privileges-changed", handleProfileChange);
    window.addEventListener("harbor:settings-changed", handleProfileChange);

    return () => {
      window.removeEventListener("harbor:secondary-privileges-changed", handleProfileChange);
      window.removeEventListener("harbor:settings-changed", handleProfileChange);
      window.removeEventListener("harbor:nuvio-state-changed", handleProfileChange);
      window.removeEventListener("harbor:nuvio-profile-changed", handleProfileChange);
      window.removeEventListener("harbor:nuvio-profiles-updated", handleProfileChange);
    };
  }, []);

  const handleCardClick = (profile: NuvioProfile) => {
    const isCurrent = profile.profile_index === nuvioState.activeProfileIndex;
    if (isCurrent) {
      openPicker({ kind: "edit", profileId: String(profile.profile_index) });
      return;
    }

    if (profile.pin_enabled) {
      openPicker({ kind: "unlock", profileId: String(profile.profile_index) });
      return;
    }

    setActiveNuvioProfile(profile.profile_index);
  };

  if (!signedIn) {
    return (
      <Section
        title={t("Profiles")}
        subtitle={t("Create profiles for the people who use Harbor. Each can have its own appearance, settings, and PIN.")}
      >
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-edge-soft p-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Tv size={32} />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-ink">{t("Sign in to Nuvio")}</h3>
          <p className="mt-2 max-w-[45ch] text-sm text-ink-muted">
            {t(
              "Nuvio supports up to 6 cloud profiles with isolated continue watching, synced addons, and PIN locks.",
            )}
          </p>
          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            className={`${ROW_ACTION_PRIMARY} mt-6`}
          >
            {t("Connect Nuvio account")}
          </button>
        </div>
        {showAuthModal && <NuvioAuthModal onClose={() => setShowAuthModal(false)} onSuccess={activateNuvioAccountProvider} />}
      </Section>
    );
  }

  const { settings } = useSettings();
  const profiles = nuvioState.profiles;
  const isPrimary = Number(nuvioState.activeProfileIndex) === 1;
  const nuvioPrivs = getSecondaryPrivileges(settings, true);
  const canAdd =
    (isPrimary || nuvioPrivs.canAddProfiles) &&
    profiles.length < MAX_NUVIO_PROFILES;
  const canManageStartup = isPrimary || nuvioPrivs.canManageStartup;

  return (
    <Section
      title={t("Profiles")}
      subtitle={t("Create profiles for the people who use Harbor. Each can have its own appearance, settings, and PIN.")}
    >
      <SettingGroup label={t("Everyone on this Harbor")}>
        <div className="flex items-center justify-between">
          <p className={`max-w-[70ch] ${ROW_DESC}`}>
            {isPrimary
              ? t("Choose a profile to switch. Use the pencil to edit its details and access settings.")
              : t("Choose a profile to switch. You can edit your own profile's details and settings.")}
          </p>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="ml-4 flex shrink-0 items-center gap-1.5 text-xs text-ink-subtle transition hover:text-ink"
            title={t("Sync profiles now")}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            <span>{loading ? t("Syncing...") : t("Refresh")}</span>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {profiles.map((p) => {
            const active = p.profile_index === nuvioState.activeProfileIndex;
            const avatarUrl = resolveNuvioAvatar(p);
            const color = p.avatar_color_hex || "#1E88E5";
            const locked = Boolean(p.pin_enabled);

            return (
              <div
                key={p.profile_index}
                className={`group ${CELL} ${active ? "border-accent" : "border-edge-soft hover:bg-elevated"}`}
              >
                <button
                  type="button"
                  onClick={() => handleCardClick(p)}
                  aria-label={
                    active
                      ? t("Edit {name}", { name: p.name })
                      : t("Switch to {name}", { name: p.name })
                  }
                  className="flex w-full flex-col items-center gap-3 rounded-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="relative">
                    <span
                      className="block shrink-0 rounded-full p-[3px] transition-transform duration-200 group-hover:scale-[1.03]"
                      style={{ background: color }}
                    >
                      <span className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-full bg-elevated">
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            draggable={false}
                          />
                        ) : (
                          <div
                            className="flex h-full w-full items-center justify-center text-xl font-bold uppercase text-white"
                            style={{ backgroundColor: color }}
                          >
                            {p.name.slice(0, 2) || "P"}
                          </div>
                        )}
                      </span>
                    </span>
                    {locked && (
                      <span className="absolute -bottom-0.5 -end-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-canvas text-ink ring-1 ring-edge shadow-sm">
                        <Lock size={12} strokeWidth={2.4} />
                      </span>
                    )}
                  </span>
                  <span className="flex w-full flex-col items-center gap-2">
                    <span className={`max-w-full truncate text-center ${ROW_TITLE}`}>
                      {p.name}
                    </span>
                    <span className="flex min-h-[22px] items-center">
                      {active ? (
                        <span className={`${QUAL} bg-accent-soft text-accent`}>
                          <Check size={13} strokeWidth={3} />
                          {t("Active")}
                        </span>
                      ) : p.profile_index === 1 ? (
                        <span className={`${QUAL} bg-elevated text-ink-subtle`}>
                          {t("profile.primary")}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (p.pin_enabled && !isNuvioProfileUnlocked(p.profile_index)) {
                      openPicker({ kind: "unlock-for-edit", profileId: String(p.profile_index) });
                    } else {
                      openPicker({ kind: "edit", profileId: String(p.profile_index) });
                    }
                  }}
                  aria-label={t("Edit {name}", { name: p.name })}
                  className="absolute end-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-[10px] text-ink-subtle transition-colors hover:bg-elevated hover:text-ink"
                >
                  <Pencil size={18} strokeWidth={2.2} />
                </button>
              </div>
            );
          })}

          {canAdd && (
            <button
              type="button"
              onClick={() => openPicker({ kind: "create" })}
              aria-label={t("Add profile")}
              className={`${CELL} justify-center border-edge-soft text-ink-subtle hover:bg-elevated hover:text-ink`}
            >
              <span className="flex h-[78px] w-[78px] items-center justify-center rounded-full bg-elevated">
                <Plus size={26} strokeWidth={2.2} />
              </span>
              <span className={ROW_TITLE}>{t("Add")}</span>
              <span className="min-h-[22px]" />
            </button>
          )}
        </div>
      </SettingGroup>

      {canManageStartup && <StartupDefaults />}
      {isPrimary && <SecondaryPrivilegesCard />}
      <SettingsScopeCard />
    </Section>
  );
}
