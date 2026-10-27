import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  Bell,
  ChevronDown,
  Lock,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  UserRound,
  Users,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { getSecondaryPrivileges } from "@/lib/settings/defaults";
import { ProfileAvatar, SubtitleText } from "./account-menu-parts";
import type { AccountMenuController } from "./use-account-menu";
import { loadNuvioState } from "@/lib/nuvio/nuvio-client";
import { signOutNuvio } from "@/lib/nuvio/nuvio-auth";
import { resolveNuvioAvatar } from "@/lib/nuvio/nuvio-profiles";
import type { NuvioProfile } from "@/lib/nuvio/nuvio-types";
import {
  isStremioActivePrimary,
  activeProfileIsPrimary,
  isNuvioProviderActive,
} from "@/lib/active-profile-id";
import { isPlaceholderName } from "@/lib/profiles";

const ITEM =
  "flex items-center gap-2.5 px-4 py-2.5 text-start text-[13.5px] text-ink-muted transition-colors duration-150 ease-[var(--ease-out)] hover:bg-raised hover:text-ink active:scale-[0.98]";
const SUB_ITEM =
  "flex items-center gap-2.5 py-2 ps-11 pe-4 text-start text-[13px] text-ink-subtle transition-colors duration-150 ease-[var(--ease-out)] hover:bg-raised hover:text-ink";

export function AccountMenuPanel({
  ctrl,
  positionClass,
  showHeader = false,
  showSettings = false,
  onOpenSettings,
  settingsActive = false,
}: {
  ctrl: AccountMenuController;
  positionClass: string;
  showHeader?: boolean;
  showSettings?: boolean;
  onOpenSettings?: () => void;
  settingsActive?: boolean;
}) {
  const t = useT();
  const { signOut } = useAuth();
  const { settings } = useSettings();
  const isNuvio = settings.accountProvider === "nuvio" || isNuvioProviderActive();

  const {
    user,
    profiles,
    activeProfile,
    author,
    openPicker,
    requestSwitch,
    viewMyProfile,
    openNotifications,
    openHarborAuth,
    signOutHarbor,
    manageOpen,
    setManageOpen,
    setMenuOpen,
    setAuthOpen,
    activeKid,
  } = ctrl;

  const kid = activeKid != null;

  const [nuvioState, setNuvioState] = useState(() => loadNuvioState());

  useEffect(() => {
    const onNuvioChange = () => setNuvioState(loadNuvioState());
    window.addEventListener("harbor:nuvio-state-changed", onNuvioChange);
    window.addEventListener("harbor:nuvio-profile-changed", onNuvioChange);
    window.addEventListener("harbor:nuvio-profiles-updated", onNuvioChange);
    window.addEventListener("harbor:secondary-privileges-changed", onNuvioChange);
    window.addEventListener("harbor:settings-changed", onNuvioChange);
    window.addEventListener("harbor:profiles-updated", onNuvioChange);
    window.addEventListener("harbor:active-profile-changed", onNuvioChange);
    return () => {
      window.removeEventListener("harbor:secondary-privileges-changed", onNuvioChange);
      window.removeEventListener("harbor:settings-changed", onNuvioChange);
      window.removeEventListener("harbor:profiles-updated", onNuvioChange);
      window.removeEventListener("harbor:active-profile-changed", onNuvioChange);
      window.removeEventListener("harbor:nuvio-state-changed", onNuvioChange);
      window.removeEventListener("harbor:nuvio-profile-changed", onNuvioChange);
      window.removeEventListener("harbor:nuvio-profiles-updated", onNuvioChange);
    };
  }, []);

  const nuvioEmail = nuvioState.session?.user?.email;
  const activeNuvioProfile = isNuvio
    ? nuvioState.profiles.find((p) => p.profile_index === nuvioState.activeProfileIndex) ||
      nuvioState.profiles[0] ||
      null
    : null;

  const otherNuvioProfiles = isNuvio
    ? nuvioState.profiles.filter((p) => p.profile_index !== nuvioState.activeProfileIndex)
    : [];
  const otherStremioProfiles = !isNuvio ? profiles.filter((p) => p.id !== activeProfile?.id) : [];

  const isPlaceholder = isPlaceholderName(activeProfile?.name);
  const name = isNuvio
    ? (activeNuvioProfile?.name ?? nuvioEmail?.split("@")[0] ?? t("profile.fallback"))
    : isPlaceholder
      ? (user?.fullname ??
        user?.email?.split("@")[0] ??
        activeProfile?.name ??
        t("profile.fallback"))
      : (activeProfile?.name ??
        user?.fullname ??
        user?.email?.split("@")[0] ??
        t("profile.fallback"));

  const isPrimary =
    activeProfileIsPrimary() ||
    (isNuvio
      ? activeNuvioProfile?.profile_index === 1
      : isStremioActivePrimary(activeProfile, profiles));

  const privs = getSecondaryPrivileges(settings, isNuvio);
  const canAddProfiles = isPrimary || privs.canAddProfiles;
  const canSignOutRoot = isPrimary || privs.canSignOutRoot;

  const handleNuvioSwitch = (p: NuvioProfile) => {
    ctrl.requestNuvioSwitch(p);
  };

  return (
    <>
      <div
        className={`harbor-profile-dropdown absolute z-40 overflow-hidden rounded-md bg-elevated ring-1 ring-edge shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] ${positionClass}`}
      >
        {showHeader && (
          <div className="border-b border-edge-soft px-4 py-2.5">
            <div className="truncate text-[13.5px] font-semibold text-ink">{name}</div>
            {isNuvio && nuvioEmail ? (
              <div className="truncate text-[11.5px] text-ink-subtle">{nuvioEmail} (Nuvio)</div>
            ) : (
              <div className="truncate text-[11.5px] text-ink-subtle">
                <SubtitleText author={author} />
              </div>
            )}
          </div>
        )}

        {/* NUVIO PROFILES SWITCH LIST */}
        {isNuvio && otherNuvioProfiles.length > 0 && (
          <div className="flex flex-col gap-0.5 border-b border-edge-soft p-1.5">
            <span className="px-2.5 pb-1 pt-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
              {t("profile.switch")}
            </span>
            {otherNuvioProfiles.map((p) => {
              const avatarUrl = resolveNuvioAvatar(p);
              const color = p.avatar_color_hex || "#1E88E5";
              return (
                <button
                  key={p.profile_index}
                  onClick={() => handleNuvioSwitch(p)}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-start transition-colors duration-150 ease-[var(--ease-out)] hover:bg-raised active:scale-[0.98]"
                >
                  <span className="relative inline-flex shrink-0">
                    <span
                      className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white shadow-sm ring-1 ring-edge"
                      style={{ backgroundColor: color }}
                    >
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        (p.name?.[0] || "P").toUpperCase()
                      )}
                    </span>
                    {p.pin_enabled && (
                      <span className="absolute -bottom-0.5 -end-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-canvas text-ink ring-1 ring-edge">
                        <Lock size={8} strokeWidth={2.6} />
                      </span>
                    )}
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium text-ink">{p.name}</span>
                    {p.profile_index === 1 && (
                      <span
                        className="shrink-0 text-[9px] font-bold uppercase leading-none tracking-[0.18em]"
                        style={{ color: "#38bdf8" }}
                      >
                        {t("profile.primary")}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* STREMIO PROFILES SWITCH LIST */}
        {!isNuvio && otherStremioProfiles.length > 0 && (
          <div className="flex flex-col gap-0.5 border-b border-edge-soft p-1.5">
            <span className="px-2.5 pb-1 pt-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
              {t("profile.switch")}
            </span>
            {otherStremioProfiles.map((p) => (
              <button
                key={p.id}
                onClick={() => requestSwitch(p)}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-start transition-colors duration-150 ease-[var(--ease-out)] hover:bg-raised active:scale-[0.98]"
              >
                <span className="relative inline-flex shrink-0">
                  <ProfileAvatar profile={p} user={null} fallbackAvatar={null} size="sm" />
                  {p.passwordHash && (
                    <span className="absolute -bottom-0.5 -end-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-canvas text-ink ring-1 ring-edge">
                      <Lock size={8} strokeWidth={2.6} />
                    </span>
                  )}
                </span>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-ink">{p.name}</span>
                  {p.isPrimary && (
                    <span
                      className="shrink-0 text-[9px] font-bold uppercase leading-none tracking-[0.18em]"
                      style={{ color: p.color }}
                    >
                      {t("profile.primary")}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {!kid && (
          <div className="flex flex-col">
            {isPrimary && author && (
              <button onClick={viewMyProfile} className={ITEM}>
                <UserRound size={14} strokeWidth={2.2} />
                {t("View my profile")}
              </button>
            )}
            {author && (
              <button onClick={openNotifications} className={ITEM}>
                <Bell size={14} strokeWidth={2.2} />
                {t("Notifications")}
              </button>
            )}
            <button
              onClick={() => setManageOpen((o) => !o)}
              className={`${ITEM} ${author ? "border-t border-edge-soft" : ""}`}
            >
              <Users size={14} strokeWidth={2.2} />
              {t("Manage profiles")}
              <ChevronDown
                size={14}
                strokeWidth={2.2}
                className={`ms-auto transition-transform duration-200 ${manageOpen ? "rotate-180" : ""}`}
              />
            </button>

            {manageOpen && (
              <div className="flex flex-col bg-canvas/50">
                <button
                  onClick={() => {
                    openPicker({ kind: "list" });
                    setMenuOpen(false);
                  }}
                  className={SUB_ITEM}
                >
                  <Users size={13} strokeWidth={2.2} />
                  {t("profile.whoWatching")}
                </button>
                <button
                  onClick={() => {
                    if (isNuvio) {
                      openPicker({
                        kind: "edit",
                        profileId: String(activeNuvioProfile?.profile_index ?? 1),
                      });
                    } else if (activeProfile) {
                      openPicker({ kind: "edit", profileId: activeProfile.id });
                    }
                    setMenuOpen(false);
                  }}
                  className={SUB_ITEM}
                >
                  <Pencil size={13} strokeWidth={2.2} />
                  {t("profile.editThis")}
                </button>
                {canAddProfiles && (
                  <button
                    onClick={() => {
                      openPicker({ kind: "create" });
                      setMenuOpen(false);
                    }}
                    className={SUB_ITEM}
                  >
                    <Plus size={13} strokeWidth={2.2} />
                    {t("profile.new")}
                  </button>
                )}
              </div>
            )}

            {showSettings && onOpenSettings && (
              <button
                onClick={() => {
                  onOpenSettings();
                  setMenuOpen(false);
                }}
                className={`${ITEM} border-t border-edge-soft ${settingsActive ? "text-ink" : ""}`}
              >
                <SettingsIcon size={14} strokeWidth={2.2} />
                {t("nav.settings")}
              </button>
            )}

            {/* NUVIO SIGN OUT / SIGN IN */}
            {canSignOutRoot && isNuvio && nuvioState.session && (
              <button
                onClick={() => {
                  signOutNuvio();
                  setMenuOpen(false);
                }}
                className={`${ITEM} border-t border-edge-soft`}
              >
                <LogOut size={14} strokeWidth={2.2} />
                {t("Sign out of Nuvio")}
              </button>
            )}

            {canSignOutRoot && isNuvio && !nuvioState.session && (
              <button
                onClick={() => {
                  setAuthOpen(true);
                  setMenuOpen(false);
                }}
                className={`${ITEM} border-t border-edge-soft`}
              >
                <LogIn size={14} strokeWidth={2.2} />
                {t("Sign in to Nuvio")}
              </button>
            )}

            {/* STREMIO SIGN OUT */}
            {!isNuvio && user && canSignOutRoot && (
              <button
                onClick={() => {
                  signOut();
                  setMenuOpen(false);
                }}
                className={`${ITEM} border-t border-edge-soft`}
              >
                <LogOut size={14} strokeWidth={2.2} />
                {t("Sign out of Stremio")}
              </button>
            )}

            {/* HARBOR SIGN OUT / SIGN IN */}
            {author ? (
              <button onClick={signOutHarbor} className={`${ITEM} border-t border-edge-soft`}>
                <LogOut size={14} strokeWidth={2.2} />
                {t("Sign out of Harbor")}
              </button>
            ) : !isNuvio ? (
              <button onClick={openHarborAuth} className={`${ITEM} border-t border-edge-soft`}>
                <LogIn size={14} strokeWidth={2.2} />
                {t("Sign in to Harbor")}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
