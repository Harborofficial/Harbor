import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, ImagePlus, Palette } from "../icons";
import { useProfiles } from "@/lib/profiles";
import { isStremioActivePrimary } from "@/lib/active-profile-id";
import { useSettings } from "@/lib/settings";
import { useTogether } from "@/lib/together/provider";
import { useT } from "@/lib/i18n";
import { currentAuthor, subscribeAuthor } from "@/lib/theme-auth";
import { useAuth } from "@/lib/auth";
import { loadNuvioState, getNuvioProfileIndexForHarborProfile } from "@/lib/nuvio/nuvio-client";
import { nameEquals } from "@/lib/account/name-sync";
import {
  getNameSyncState,
  retryNameSync,
  subscribeNameSyncState,
} from "@/lib/account/name-sync-state";
import { navOwnsFocus } from "@/lib/keyboard-navigation/geometry";
import { AvatarFan } from "@/components/avatar-picker/avatar-fan";
import { AvatarCatalogModal } from "@/components/avatar-picker/avatar-catalog-modal";
import { CustomColorPanel, HARBOR_COLOR_SWATCHES } from "../color-picker";
import {
  ModalButton,
  SettingsModal,
  SettingRow,
  ROW_ACTION,
  ROW_ACTION_DANGER,
  ROW_ACTION_PRIMARY,
} from "../kit";
import { Section } from "../shared";
import { ProfileAudioSetting } from "../profile-audio-setting";
import { AvatarRing } from "./avatar-ring";
import { resizeAvatar } from "./avatar-utils";

import { updateNuvioProfile, resolveNuvioAvatar, pullNuvioProfiles, NUVIO_PROFILE_COLORS } from "@/lib/nuvio/nuvio-profiles";

export function IdentityTab() {
  const t = useT();
  const { user } = useAuth();
  const { settings, update } = useSettings();
  const { displayName, setDisplayName } = useTogether();
  const { profiles, activeProfile, updateProfile } = useProfiles();
  const [harborAuthor, setHarborAuthor] = useState(currentAuthor);
  const nameSync = useSyncExternalStore(subscribeNameSyncState, getNameSyncState, getNameSyncState);
  const syncPhase = nameSync.accountId === harborAuthor?.id ? nameSync.phase : "idle";
  useEffect(() => subscribeAuthor(() => setHarborAuthor(currentAuthor())), []);

  const isNuvio = settings.accountProvider === "nuvio";
  const [nuvioState, setNuvioState] = useState(() => loadNuvioState());

  useEffect(() => {
    if (isNuvio) {
      pullNuvioProfiles().then(() => setNuvioState(loadNuvioState()));
    }
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

  const activeNuvioProfile = isNuvio
    ? nuvioState.profiles.find((p) => p.profile_index === nuvioState.activeProfileIndex) || nuvioState.profiles[0] || null
    : null;

  const currentDisplayName = isNuvio && activeNuvioProfile ? activeNuvioProfile.name : displayName;

  const [nameDraft, setNameDraft] = useState(currentDisplayName);
  const draftRef = useRef(currentDisplayName);
  const previousNameRef = useRef(currentDisplayName);
  const previousScopeRef = useRef({ accountId: harborAuthor?.id, profileId: activeProfile?.id });
  const [colorOpen, setColorOpen] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setDraft = (next: string) => {
    draftRef.current = next;
    setNameDraft(next);
  };

  useEffect(() => {
    // A late account read must not erase text still being edited in this field.
    const scope = previousScopeRef.current;
    if (
      scope.accountId !== harborAuthor?.id ||
      scope.profileId !== activeProfile?.id ||
      nameEquals(draftRef.current, previousNameRef.current)
    ) {
      draftRef.current = currentDisplayName;
      setNameDraft(currentDisplayName);
    }
    previousNameRef.current = currentDisplayName;
    previousScopeRef.current = { accountId: harborAuthor?.id, profileId: activeProfile?.id };
  }, [currentDisplayName, harborAuthor?.id, activeProfile?.id]);

  const pushIdentity = (patch: { harborColor?: string; harborAvatar?: string | null }) => {
    update(patch);
    if (activeProfile && patch.harborAvatar !== undefined) {
      updateProfile(activeProfile.id, { avatar: patch.harborAvatar });
    }
    if (isNuvio && activeNuvioProfile) {
      const nuvioPatch: { avatarColorHex?: string; avatarUrl?: string | null } = {};
      if (patch.harborColor !== undefined) nuvioPatch.avatarColorHex = patch.harborColor;
      if (patch.harborAvatar !== undefined) nuvioPatch.avatarUrl = patch.harborAvatar;
      updateNuvioProfile(activeNuvioProfile.profile_index, nuvioPatch);
      return;
    }
    if (!activeProfile) return;
    const profilePatch: { color?: string; avatar?: string | null } = {};
    if (patch.harborColor !== undefined) profilePatch.color = patch.harborColor;
    if (patch.harborAvatar !== undefined) profilePatch.avatar = patch.harborAvatar;
    if (Object.keys(profilePatch).length > 0) updateProfile(activeProfile.id, profilePatch);
  };

  const pushDisplayName = (next: string) => {
    const trimmed = next.trim();
    if (nameEquals(trimmed, currentDisplayName)) return;
    setDisplayName(trimmed);
    if (isNuvio && activeNuvioProfile) {
      updateNuvioProfile(activeNuvioProfile.profile_index, { name: trimmed });
    } else if (activeProfile && trimmed && trimmed !== activeProfile.name) {
      updateProfile(activeProfile.id, { name: trimmed });
    }
  };

  const stremioAvatar = user?.avatar ?? null;
  const nuvioSlot = activeProfile ? getNuvioProfileIndexForHarborProfile(activeProfile.id) : 1;
  const nuvioProfileLegacy = nuvioState.profiles.find((p) => p.profile_index === nuvioSlot);
  const customAvatar = isNuvio
    ? (activeNuvioProfile?.avatar_url || activeNuvioProfile?.avatar_id || null)
    : (activeProfile?.avatar ?? settings.harborAvatar ?? null);

  const effectiveAvatar = isNuvio && activeNuvioProfile
    ? (resolveNuvioAvatar(activeNuvioProfile) || settings.harborAvatar || null)
    : (customAvatar ?? stremioAvatar ?? (nuvioProfileLegacy ? resolveNuvioAvatar(nuvioProfileLegacy) : null));

  const nameDirty = !nameEquals(nameDraft.trim(), currentDisplayName);
  const commitName = () => pushDisplayName(draftRef.current.trim() || currentDisplayName);

  const color = isNuvio && activeNuvioProfile?.avatar_color_hex
    ? activeNuvioProfile.avatar_color_hex
    : settings.harborColor;
  const isPresetColor = HARBOR_COLOR_SWATCHES.includes(color.toLowerCase());

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await resizeAvatar(file, 320);
      pushIdentity({ harborAvatar: dataUrl });
    } catch (err) {
      console.warn("[avatar] resize failed", err);
    }
  };

  return (
    <>
      <Section
        title={t("Your profile")}
        subtitle={t("Your avatar, name, and handle across Harbor.")}
      >
        <div className="hset-profile-identity flex items-center gap-6 py-3">
          <AvatarRing
            src={effectiveAvatar}
            size={88}
            color={color}
            onClick={() => fileRef.current?.click()}
          />
          <div className="flex min-w-0 max-w-[560px] flex-1 flex-col gap-2">
            <div className="flex items-end gap-3">
              <label className="flex min-w-0 max-w-[420px] flex-1 flex-col gap-2 text-[15.5px] leading-[22px] text-ink-muted">
                <span>{isNuvio ? t("Profile name") : t("Display name")}</span>
                <span className="flex h-12 w-full min-w-0 items-center gap-3 rounded-[10px] border border-edge-soft bg-elevated px-3 transition-colors hover:border-edge focus-within:border-ink-muted">
                  <input
                    value={nameDraft}
                    maxLength={32}
                    aria-label={t("Display name")}
                    aria-describedby={[
                      harborAuthor?.handle ? "hset-profile-handle" : "",
                      "hset-name-sync",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitName}
                    onKeyDown={(e) => {
                      if (
                        e.currentTarget.hasAttribute("data-search-editing") ||
                        navOwnsFocus(e.currentTarget)
                      )
                        return;
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        commitName();
                        e.currentTarget.blur();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setDraft(currentDisplayName);
                        e.currentTarget.blur();
                      }
                    }}
                    className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[17px] font-medium text-ink outline-none"
                  />
                  {harborAuthor?.handle && (isNuvio ? activeNuvioProfile?.profile_index === 1 : isStremioActivePrimary(activeProfile, profiles)) && (
                    <span
                      id="hset-profile-handle"
                      dir="ltr"
                      title={`@${harborAuthor.handle}`}
                      className="max-w-[45%] shrink-0 truncate text-[14px] leading-5 text-ink-muted"
                    >
                      @{harborAuthor.handle}
                    </span>
                  )}
                </span>
              </label>
              {(nameDirty || syncPhase === "error") && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={nameDirty ? commitName : retryNameSync}
                  className={`${ROW_ACTION_PRIMARY} shrink-0`}
                >
                  {t(nameDirty ? "Save" : "Try again")}
                </button>
              )}
            </div>
            <p id="hset-name-sync" role="status" className="text-sm text-ink-muted">
              {isNuvio
                ? t("Profile name is synced directly with your Nuvio account.")
                : syncPhase === "error"
                  ? t("Could not sync your display name. Check your connection and try again.")
                  : syncPhase === "saving"
                    ? t("Syncing display name…")
                    : syncPhase === "saved" && !nameDirty
                      ? t("Display name saved to your Harbor account.")
                      : ""}
            </p>
          </div>
        </div>

        <SettingRow
          wide
          icon={<ImagePlus size={18} strokeWidth={2} />}
          label={t("Avatar")}
          desc={t("Upload a picture of your own, or pick one from the Harbor catalog.")}
        >
          <div className="flex w-full flex-wrap items-center gap-2.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={onPickFile}
              className="hidden"
            />
            <button type="button" onClick={() => fileRef.current?.click()} className={ROW_ACTION}>
              {t("Upload photo")}
            </button>
            <AvatarFan
              onClick={() => setAvatarPickerOpen(true)}
              onRandomize={(value) => pushIdentity({ harborAvatar: value })}
            />
            {(customAvatar || (isNuvio && (activeNuvioProfile?.avatar_url || activeNuvioProfile?.avatar_id))) && (
              <button
                type="button"
                onClick={() => pushIdentity({ harborAvatar: null })}
                className={ROW_ACTION_DANGER}
              >
                {isNuvio
                  ? (activeNuvioProfile?.avatar_url || nuvioProfileLegacy?.avatar_url || activeNuvioProfile?.avatar_id)
                    ? t("Reset to Nuvio avatar")
                    : t("Reset to default")
                  : stremioAvatar
                    ? t("Reset to Stremio avatar")
                    : t("Reset to default")}
              </button>
            )}
          </div>
        </SettingRow>

        <SettingRow
          wide
          icon={<Palette size={18} strokeWidth={2} />}
          label={t("Your color")}
          desc={t(
            "Colors your name, your cursor in Watch Together, and the ring around your avatar.",
          )}
        >
          <div className="flex w-full flex-wrap items-center gap-2.5">
            {(isNuvio ? NUVIO_PROFILE_COLORS : HARBOR_COLOR_SWATCHES).map((hex) => {
              const selected = color.toLowerCase() === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => pushIdentity({ harborColor: hex })}
                  aria-label={hex}
                  aria-pressed={selected}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] transition-colors hover:bg-elevated"
                >
                  <span
                    className="grid h-8 w-8 place-items-center rounded-full"
                    style={{ background: hex }}
                  >
                    {selected && (
                      <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-ink text-canvas">
                        <Check size={13} strokeWidth={3.2} />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            <button type="button" onClick={() => setColorOpen(true)} className={ROW_ACTION}>
              <span
                aria-hidden
                className="h-4 w-4 shrink-0 rounded-full"
                style={{ background: color }}
              />
              {isPresetColor ? t("Custom") : color.toUpperCase()}
            </button>
          </div>
        </SettingRow>
      </Section>

      <ProfileAudioSetting />

      <SettingsModal
        open={colorOpen}
        onClose={() => setColorOpen(false)}
        title={t("Your color")}
        width={380}
        actions={<ModalButton onClick={() => setColorOpen(false)}>{t("Done")}</ModalButton>}
      >
        <CustomColorPanel value={color} onChange={(c) => pushIdentity({ harborColor: c })} />
      </SettingsModal>

      {avatarPickerOpen && (
        <AvatarCatalogModal
          current={effectiveAvatar}
          onPick={(value) => {
            pushIdentity({ harborAvatar: value });
            setAvatarPickerOpen(false);
          }}
          onClose={() => setAvatarPickerOpen(false)}
        />
      )}
    </>
  );
}
