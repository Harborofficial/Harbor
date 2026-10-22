import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Layers,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Tv,
  Unlock,
  X,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { loadNuvioState, isNuvioSignedIn } from "@/lib/nuvio/nuvio-client";
import {
  pullNuvioProfiles,
  createNuvioProfile,
  updateNuvioProfile,
  deleteNuvioProfile,
  transferPrimaryNuvioProfile,
  verifyNuvioPin,
  setNuvioPin,
  clearNuvioPin,
  isNuvioProfileUnlocked,
  markNuvioProfileUnlocked,
  setActiveNuvioProfile,
  resolveNuvioAvatar,
  uploadNuvioCustomAvatar,
  fetchNuvioAvatarCatalog,
  NUVIO_PROFILE_COLORS,
  MAX_NUVIO_PROFILES,
} from "@/lib/nuvio/nuvio-profiles";
import type { NuvioProfile } from "@/lib/nuvio/nuvio-types";
import { Section, ROW_TITLE, ROW_DESC } from "../shared";
import { SettingGroup, ROW_ACTION_PRIMARY } from "../kit";
import { useSettings } from "@/lib/settings";
import { getSecondaryPrivileges } from "@/lib/settings/defaults";
import { SecondaryPrivilegesCard } from "./secondary-privileges-card";
import { StartupDefaults } from "./startup-defaults";
import { SettingsScopeCard } from "./settings-scope-card";
import { AvatarRing } from "./avatar-ring";
import { resizeAvatar } from "./avatar-utils";
import { AvatarFan } from "@/components/avatar-picker/avatar-fan";
import { AvatarCatalogModal } from "@/components/avatar-picker/avatar-catalog-modal";
import { ColorPicker } from "@/views/settings/color-picker";
import { KidToggle } from "@/components/profile-picker/kid-toggle";
import { KidsSetupPanel } from "@/components/profile-picker/kids-setup-panel";
import { PinEntry } from "@/components/profile-picker/pin-entry";
import { NuvioAuthModal } from "@/components/nuvio-auth-modal";
import { activateNuvioAccountProvider } from "@/lib/nuvio/nuvio-auth";
import { hashProfilePassword, verifyProfilePassword } from "@/lib/profile-password";
import type { KidConfig } from "@/lib/profiles";

const QUAL =
  "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-[6px] px-2 text-[13px] font-bold uppercase leading-[17px] tracking-[0.72px]";

const CELL =
  "relative flex flex-col items-center gap-3 rounded-[10px] border bg-canvas p-4 transition-colors";

export function NuvioProfilesTab() {
  const t = useT();
  const [nuvioState, setNuvioState] = useState(() => loadNuvioState());
  const [loading, setLoading] = useState(false);
  const [unlockedSlots, setUnlockedSlots] = useState<Set<number>>(new Set());

  // Modal targets
  const [unlockTarget, setUnlockTarget] = useState<NuvioProfile | null>(null);
  const [editTarget, setEditTarget] = useState<NuvioProfile | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
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
    fetchNuvioAvatarCatalog();
    const handleProfileChange = () => setNuvioState(loadNuvioState());
    window.addEventListener("harbor:nuvio-state-changed", handleProfileChange);
    window.addEventListener("harbor:nuvio-profile-changed", handleProfileChange);
    window.addEventListener("harbor:nuvio-profiles-updated", handleProfileChange);

    return () => {
      window.removeEventListener("harbor:nuvio-state-changed", handleProfileChange);
      window.removeEventListener("harbor:nuvio-profile-changed", handleProfileChange);
      window.removeEventListener("harbor:nuvio-profiles-updated", handleProfileChange);
    };
  }, []);

  const handleCardClick = (profile: NuvioProfile) => {
    const isCurrent = profile.profile_index === nuvioState.activeProfileIndex;
    if (isCurrent) {
      setEditTarget(profile);
      return;
    }

    if (profile.pin_enabled && !isNuvioProfileUnlocked(profile.profile_index) && !unlockedSlots.has(profile.profile_index)) {
      setUnlockTarget(profile);
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
                    setEditTarget(p);
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
              onClick={() => setCreateOpen(true)}
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

      {/* Unlock PIN Modal */}
      {unlockTarget && (
        <NuvioUnlockModal
          target={unlockTarget}
          onSuccess={() => {
            markNuvioProfileUnlocked(unlockTarget.profile_index);
            setUnlockedSlots((prev) => new Set([...prev, unlockTarget.profile_index]));
            setActiveNuvioProfile(unlockTarget.profile_index, { unlocked: true });
            setUnlockTarget(null);
          }}
          onClose={() => setUnlockTarget(null)}
        />
      )}

      {/* Create / Edit Modal with exact Stremio EditorView layout */}
      {createOpen && (
        <NuvioProfileEditor
          mode={{ kind: "create" }}
          onCancel={() => setCreateOpen(false)}
          onDone={async () => {
            setCreateOpen(false);
            await refresh();
          }}
        />
      )}

      {editTarget && (
        <NuvioProfileEditor
          mode={{ kind: "edit", profile: editTarget }}
          onCancel={() => setEditTarget(null)}
          onDone={async () => {
            setEditTarget(null);
            await refresh();
          }}
        />
      )}
    </Section>
  );
}

// Fullscreen Editor Modal matching Harbor's EditorView 1:1
export function NuvioProfileEditor({
  mode,
  onCancel,
  onDone,
  portal = true,
}: {
  mode: { kind: "create" } | { kind: "edit"; profile: NuvioProfile };
  onCancel: () => void;
  onDone: () => void;
  portal?: boolean;
}) {
  const t = useT();
  const editing = mode.kind === "edit" ? mode.profile : null;
  const isPrimary = editing?.profile_index === 1;

  const allProfiles = loadNuvioState().profiles;
  const transferTargets = allProfiles.filter((p) => {
    if (p.profile_index === 1) return false;
    const rawKid = localStorage.getItem(`harbor.nuvio.kid.${p.profile_index}`);
    if (rawKid) {
      try {
        if (JSON.parse(rawKid)) return false;
      } catch {}
    }
    return true;
  });
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState(editing?.avatar_color_hex || NUVIO_PROFILE_COLORS[0]);
  const [avatar, setAvatar] = useState<string | null>(editing ? resolveNuvioAvatar(editing) : null);
  const [avatarId, setAvatarId] = useState<string | null>(editing?.avatar_id ?? null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(editing?.avatar_url ?? null);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);

  const [usesPrimaryAddons, setUsesPrimaryAddons] = useState(editing?.uses_primary_addons ?? true);
  const [draftKid, setDraftKid] = useState<KidConfig | null>(() => {
    if (!editing) return null;
    const raw = localStorage.getItem(`harbor.nuvio.kid.${editing.profile_index}`);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
    return null;
  });
  const [draftParentPin, setDraftParentPin] = useState<string | null>(null);

  const [pinEnabled, setPinEnabled] = useState(Boolean(editing?.pin_enabled));
  const [subView, setSubView] = useState<
    | { kind: "main" }
    | { kind: "security" }
    | { kind: "pin-set" }
    | { kind: "pin-change" }
    | { kind: "pin-remove" }
    | { kind: "pin-delete" }
  >({ kind: "main" });

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pinChangeStep, setPinChangeStep] = useState<"verify" | "set">("verify");
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && (!draftKid || !draftParentPin || draftParentPin.length === 4);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await resizeAvatar(file, 320);
      setAvatar(dataUrl);
      setPendingAvatarFile(file);
      setAvatarId(null);
      setAvatarUrl(null);
    } catch (err) {
      console.warn("[nuvio-editor] avatar resize failed", err);
    }
  };

  const onRemoveAvatar = () => {
    setAvatar(null);
    setAvatarId(null);
    setAvatarUrl(null);
    setPendingAvatarFile(null);
  };

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      let finalAvatarUrl = avatarUrl;
      const targetSlot = editing?.profile_index ?? (loadNuvioState().profiles.length + 1);

      if (pendingAvatarFile) {
        const uploadedUrl = await uploadNuvioCustomAvatar(pendingAvatarFile, targetSlot);
        if (uploadedUrl) {
          finalAvatarUrl = uploadedUrl;
        }
      }

      let kidToSave: (KidConfig & { avatar?: string }) | null = null;
      if (draftKid && !isPrimary) {
        let parentPinHash = draftKid.parentPinHash ?? null;
        if (draftParentPin && draftParentPin.length === 4) {
          parentPinHash = await hashProfilePassword(draftParentPin);
        }
        kidToSave = {
          age: draftKid.age ?? 7,
          curfewMinutes: draftKid.curfewMinutes ?? null,
          parentPinHash,
          avatar: (avatar || finalAvatarUrl) ?? undefined,
        };
      }

      if (mode.kind === "create") {
        await createNuvioProfile({
          name: trimmed,
          avatarColorHex: color,
          avatarId: finalAvatarUrl ? null : avatarId,
          avatarUrl: finalAvatarUrl,
          usesPrimaryAddons,
        });
        if (kidToSave && targetSlot !== 1) {
          localStorage.setItem(`harbor.nuvio.kid.${targetSlot}`, JSON.stringify(kidToSave));
        } else {
          localStorage.removeItem(`harbor.nuvio.kid.${targetSlot}`);
        }
      } else {
        await updateNuvioProfile(editing!.profile_index, {
          name: trimmed,
          avatar_color_hex: color,
          avatar_id: finalAvatarUrl ? null : avatarId,
          avatar_url: finalAvatarUrl,
          uses_primary_addons: isPrimary ? false : usesPrimaryAddons,
        });
        if (kidToSave && !isPrimary && editing!.profile_index !== 1) {
          localStorage.setItem(`harbor.nuvio.kid.${editing!.profile_index}`, JSON.stringify(kidToSave));
        } else {
          localStorage.removeItem(`harbor.nuvio.kid.${editing!.profile_index}`);
        }
      }
      window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing || isPrimary) return;
    setSaving(true);
    try {
      localStorage.removeItem(`harbor.nuvio.kid.${editing.profile_index}`);
      await deleteNuvioProfile(editing.profile_index);
      window.dispatchEvent(new CustomEvent("harbor:nuvio-profile-changed"));
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const { settings } = useSettings();
  const currentActiveSlot = loadNuvioState().activeProfileIndex;
  const activeIsPrimary = currentActiveSlot === 1;
  const isOwnProfile = editing?.profile_index === currentActiveSlot;
  const canEditAdvanced = activeIsPrimary;
  const canCreate = activeIsPrimary || getSecondaryPrivileges(settings, true).canAddProfiles;

  if (editing && !isOwnProfile && !canEditAdvanced) {
    const content = (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <p className="text-[14px] text-ink-muted">
          {t("Only the primary profile can edit other profiles.")}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-xl bg-ink px-5 text-[15px] font-semibold text-canvas"
        >
          {t("common.back")}
        </button>
      </div>
    );
    if (!portal) return content;
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-[480px] rounded-2xl border border-edge bg-canvas p-6 shadow-2xl">
          {content}
        </div>
      </div>,
      document.body,
    );
  }

  if (mode.kind === "create" && !canCreate) {
    const content = (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <p className="text-[14px] text-ink-muted">
          {t("Only the primary profile can create profiles.")}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-xl bg-ink px-5 text-[15px] font-semibold text-canvas"
        >
          {t("common.back")}
        </button>
      </div>
    );
    if (!portal) return content;
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-[480px] rounded-2xl border border-edge bg-canvas p-6 shadow-2xl">
          {content}
        </div>
      </div>,
      document.body,
    );
  }

  const isPinView = subView.kind.startsWith("pin-");
  const inner = (
    <div
      className={`relative my-auto w-full ${isPinView ? "max-w-[440px]" : "max-w-[680px]"} rounded-3xl bg-surface p-7 shadow-2xl border border-edge transition-all`}
    >
      <button
        type="button"
        onClick={onCancel}
        className="absolute end-5 top-5 flex h-9 w-9 items-center justify-center rounded-full text-ink-subtle hover:bg-elevated hover:text-ink transition"
      >
        <X size={18} />
      </button>

        {subView.kind === "main" && (
          <div data-profile-editor="" className="flex w-full flex-col gap-5">
            <div className="flex flex-col items-center gap-1">
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink">
                {editing ? t("Edit {name}", { name: editing.name }) : t("profile.new")}
              </h1>
            </div>

            {/* Avatar & Display Name */}
            <div className="flex flex-col gap-4 border-b border-edge-soft pb-6">
              <div className="hset-profile-editor-identity flex items-center gap-5">
                <AvatarRing src={avatar} size={76} color={color} onClick={() => fileRef.current?.click()} />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={onPickFile}
                  className="hidden"
                />
                <div className="hset-profile-editor-fields flex min-w-0 flex-1 flex-col gap-2.5">
                  <label className="flex flex-col gap-2 text-[14px] text-ink-muted">
                    {t("Display name")}
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={32}
                      placeholder={t("Display name")}
                      className="h-12 rounded-xl border border-edge bg-canvas px-4 text-[15.5px] font-medium text-ink outline-none transition-colors focus:border-ink-subtle"
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="h-8 rounded-lg border border-edge-soft px-2.5 text-[14px] font-medium text-ink-muted transition-colors hover:border-edge hover:text-ink"
                    >
                      {t("Upload photo")}
                    </button>
                    {avatar && (
                      <button
                        type="button"
                        onClick={onRemoveAvatar}
                        className="h-8 rounded-lg border border-edge-soft px-2.5 text-[14px] font-medium text-ink-subtle transition-colors hover:border-danger/40 hover:text-danger"
                      >
                        {t("common.remove")}
                      </button>
                    )}
                  </div>
                  <AvatarFan
                    label={t("Choose an avatar")}
                    onClick={() => setAvatarPickerOpen(true)}
                    onRandomize={(val) => {
                      setAvatar(val);
                      setAvatarUrl(val);
                      setAvatarId(null);
                      setPendingAvatarFile(null);
                    }}
                  />
                </div>
              </div>
              <div className="border-t border-edge-soft/60 pt-4">
                <ColorPicker value={color} onChange={setColor} />
              </div>
            </div>

            {/* Kids Profile Toggle (secondary profiles only) */}
            {canEditAdvanced && !isPrimary && (
              <KidToggle
                value={draftKid}
                onChange={(next) => {
                  setDraftKid(next);
                  if (next && !avatar?.startsWith("/kids/avatars/")) {
                    setAvatar("/kids/avatars/kid-1.webp");
                    setAvatarUrl("/kids/avatars/kid-1.webp");
                  }
                }}
              />
            )}

            {/* Kids Setup Panel */}
            {draftKid && (
              <KidsSetupPanel
                avatar={avatar}
                setAvatar={(v) => {
                  setAvatar(v);
                  setAvatarUrl(v);
                  setAvatarId(null);
                  setPendingAvatarFile(null);
                }}
                kid={draftKid}
                setKid={setDraftKid}
                parentPin={draftParentPin}
                setParentPin={setDraftParentPin}
                hasExistingPin={!!draftKid?.parentPinHash}
              />
            )}

            {/* Security Row */}
            {!draftKid && (
              <div
                onClick={() => setSubView({ kind: "security" })}
                className="flex items-center justify-between gap-3 rounded-xl border border-edge-soft bg-canvas/40 px-4 py-3.5 text-start transition-colors hover:border-edge hover:bg-canvas/60 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full ring-1 ${
                      pinEnabled
                        ? "bg-emerald-400/15 text-emerald-200 ring-emerald-400/30"
                        : "bg-canvas/60 text-ink-muted ring-edge-soft"
                    }`}
                  >
                    {pinEnabled ? <Lock size={14} strokeWidth={2.4} /> : <Unlock size={14} strokeWidth={2.2} />}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[16px] font-semibold text-ink">{t("Security")}</span>
                    <span className="text-[14px] text-ink-subtle">
                      {pinEnabled ? t("PIN on (Nuvio cloud protected)") : t("PIN off • no tab locks")}
                    </span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-ink-subtle" />
              </div>
            )}

            {/* Nuvio Addons Section (Only for secondary non-kid profiles) */}
            {!draftKid && !isPrimary && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                  {t("Nuvio addons")}
                </span>
                <div className="flex items-center justify-between rounded-xl border border-edge-soft bg-elevated/30 p-3.5">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/12 text-accent">
                      <Layers size={16} strokeWidth={2.2} />
                    </span>
                    <div className="flex flex-col">
                      <span className="text-[15px] font-semibold text-ink">{t("Use primary addons")}</span>
                      <span className="text-[14px] leading-snug text-ink-subtle">
                        {t("Use the primary profile's configured addons and streaming sources.")}
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={usesPrimaryAddons}
                    onChange={(e) => setUsesPrimaryAddons(e.target.checked)}
                    className="h-5 w-5 accent-accent cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* Primary Profile Section */}
            {isPrimary && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                  {t("Primary profile")}
                </span>
                <div className="flex flex-col gap-2.5 rounded-xl border border-edge-soft bg-elevated/30 p-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/12 text-accent">
                      <Crown size={16} strokeWidth={2.2} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[15px] font-semibold text-ink">
                        {t("This is the primary profile")}
                      </span>
                      <span className="text-[14px] leading-snug text-ink-subtle">
                        {t(
                          "It manages profiles and can't be deleted. Hand primary to another profile to delete this one.",
                        )}
                      </span>
                    </div>
                  </div>
                  {transferTargets.length > 0 && (
                    transferTargets.length === 1 ? (
                      <button
                        type="button"
                        disabled={transferring}
                        onClick={async () => {
                          setTransferring(true);
                          await transferPrimaryNuvioProfile(transferTargets[0].profile_index);
                          setTransferring(false);
                          onDone();
                        }}
                        className="h-9 self-start rounded-lg bg-accent/20 px-3.5 text-[14.5px] font-semibold text-accent transition-colors hover:bg-accent/30 disabled:opacity-40 cursor-pointer"
                      >
                        {transferring
                          ? t("Transferring…")
                          : t("Transfer to {name}", { name: transferTargets[0].name })}
                      </button>
                    ) : !transferOpen ? (
                      <button
                        type="button"
                        onClick={() => setTransferOpen(true)}
                        className="h-9 self-start rounded-lg border border-edge-soft px-3 text-[15px] font-semibold text-ink-muted transition-colors hover:border-edge hover:text-ink cursor-pointer"
                      >
                        {t("Transfer to another profile")}
                      </button>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[13px] font-medium text-ink-muted">
                          {t("Select profile to transfer primary to:")}
                        </span>
                        {transferTargets.map((p) => {
                          const targetAvatarUrl = resolveNuvioAvatar(p);
                          return (
                            <button
                              key={p.profile_index}
                              type="button"
                              disabled={transferring}
                              onClick={async () => {
                                setTransferring(true);
                                await transferPrimaryNuvioProfile(p.profile_index);
                                setTransferring(false);
                                onDone();
                              }}
                              className="flex items-center justify-between rounded-lg border border-edge-soft p-2.5 text-start transition-colors hover:border-accent hover:bg-accent/10 cursor-pointer"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-elevated"
                                  style={{ boxShadow: `0 0 0 2px ${p.avatar_color_hex || "var(--color-accent)"}` }}
                                >
                                  {targetAvatarUrl ? (
                                    <img
                                      src={targetAvatarUrl}
                                      alt=""
                                      className="h-full w-full object-cover"
                                      draggable={false}
                                    />
                                  ) : (
                                    <span
                                      className="flex h-full w-full items-center justify-center text-[10px] font-bold text-white"
                                      style={{ backgroundColor: p.avatar_color_hex || "#1E88E5" }}
                                    >
                                      {p.name.slice(0, 2) || "P"}
                                    </span>
                                  )}
                                </span>
                                <span className="min-w-0 truncate text-[15px] font-medium text-ink">
                                  {p.name}
                                </span>
                              </div>
                              <span className="text-[12.5px] font-semibold text-accent shrink-0">
                                {transferring ? t("Transferring…") : t("Make primary")}
                              </span>
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setTransferOpen(false)}
                          className="self-start text-[13px] text-ink-muted transition-colors hover:text-ink pt-1"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Secondary Profile: Make this the primary profile */}
            {canEditAdvanced && !isPrimary && !draftKid && editing && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                  {t("Primary profile")}
                </span>
                <div className="flex items-center gap-3 rounded-xl border border-edge-soft bg-elevated/30 p-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/12 text-accent">
                    <Crown size={16} strokeWidth={2.2} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-semibold text-ink">
                      {t("Make this the primary profile")}
                    </span>
                    <span className="text-[14px] leading-snug text-ink-subtle">
                      {t(
                        "The primary manages profiles and can't be deleted. Transfer it here to delete the old one.",
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={transferring}
                    onClick={async () => {
                      setTransferring(true);
                      await transferPrimaryNuvioProfile(editing.profile_index);
                      setTransferring(false);
                      onDone();
                    }}
                    className="h-9 shrink-0 rounded-lg bg-accent/20 px-3.5 text-[14.5px] font-semibold text-accent transition-colors hover:bg-accent/30 disabled:opacity-40 cursor-pointer"
                  >
                    {transferring ? t("Transferring…") : t("Set as primary")}
                  </button>
                </div>
              </div>
            )}

            {/* Bottom Actions */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  className="h-11 rounded-xl border border-edge-soft px-4 text-[15px] font-medium text-ink-muted transition-colors hover:border-edge hover:text-ink"
                >
                  {t("common.cancel")}
                </button>
                {canEditAdvanced && editing && !isPrimary && (
                  !confirmingDelete ? (
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                      className="flex items-center gap-1.5 text-[14px] font-medium text-ink-subtle transition-colors hover:text-red-300"
                    >
                      <Trash2 size={13} />
                      {t("Delete profile")}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-[14px]">
                      <span className="text-red-200">{t("Delete this profile?")}</span>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(false)}
                        className="text-ink-muted hover:text-ink"
                      >
                        {t("common.cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (editing.pin_enabled || draftKid?.parentPinHash) {
                            setSubView({ kind: "pin-delete" });
                          } else {
                            void handleDelete();
                          }
                        }}
                        className="rounded-md bg-red-400/20 px-2 py-0.5 font-semibold text-red-200 hover:bg-red-400/30"
                      >
                        {t("common.confirm")}
                      </button>
                    </div>
                  )
                )}
              </div>
              <button
                type="button"
                onClick={submit}
                disabled={!canSave || saving}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-ink px-5 text-[15px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : editing ? (
                  t("Save changes")
                ) : (
                  t("Create profile")
                )}
              </button>
            </div>
          </div>
        )}

        {/* Security Subview */}
        {subView.kind === "security" && (
          <div className="flex w-full flex-col gap-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setSubView({ kind: "main" })}
                className="flex h-10 items-center gap-1.5 rounded-lg px-2 text-[15px] font-medium text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
              >
                <ChevronLeft size={16} />
                {t("common.back")}
              </button>
            </div>
            <div className="flex flex-col items-center gap-2">
              <h1 className="text-[26px] font-semibold tracking-tight text-ink">
                {t("PIN Protection")}
              </h1>
              <p className="text-center text-[15px] text-ink-muted">
                {t("Protect this Nuvio profile across all your devices with a 4-digit PIN.")}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-xl border border-edge-soft bg-canvas/40 p-4">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full ring-1 ${
                      pinEnabled
                        ? "bg-emerald-400/15 text-emerald-200 ring-emerald-400/30"
                        : "bg-canvas/60 text-ink-muted ring-edge-soft"
                    }`}
                  >
                    {pinEnabled ? <Lock size={15} strokeWidth={2.4} /> : <Unlock size={15} strokeWidth={2.2} />}
                  </span>
                  <div>
                    <span className="text-[15px] font-semibold text-ink block">
                      {pinEnabled ? t("PIN is active") : t("No PIN set")}
                    </span>
                    <span className="text-[13px] text-ink-subtle">
                      {pinEnabled
                        ? t("Required when switching to this profile")
                        : t("Anyone can switch into this profile")}
                    </span>
                  </div>
                </div>

                {pinEnabled ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSubView({ kind: "pin-change" })}
                      className="rounded-lg border border-edge-soft px-3 py-1.5 text-sm font-medium text-ink-muted hover:border-edge hover:text-ink transition"
                    >
                      {t("Change PIN")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubView({ kind: "pin-remove" })}
                      className="rounded-lg border border-edge-soft px-3 py-1.5 text-sm font-medium text-red-300 hover:border-danger/40 transition"
                    >
                      {t("Remove PIN")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSubView({ kind: "pin-set" })}
                    className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition"
                  >
                    {t("Set PIN")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Set PIN view */}
        {subView.kind === "pin-set" && (
          <div className="w-full">
            <PinEntry
              title={t("Set a 4-digit PIN")}
              subtitle={t("Enter a 4-digit PIN to lock this profile")}
              mode="set"
              onComplete={async (newPin) => {
                if (editing) {
                  await setNuvioPin(editing.profile_index, newPin);
                  setPinEnabled(true);
                }
                setSubView({ kind: "security" });
              }}
              onBack={() => setSubView({ kind: "security" })}
            />
          </div>
        )}

        {/* Change PIN view */}
        {subView.kind === "pin-change" && editing && (
          <div className="w-full">
            {pinChangeStep === "verify" ? (
              <PinEntry
                title={t("Verify current PIN")}
                subtitle={t("Enter your current PIN to continue")}
                mode="verify"
                verify={async (pin) => {
                  const res = await verifyNuvioPin(editing.profile_index, pin);
                  return { ok: res.unlocked, message: res.message };
                }}
                onComplete={() => setPinChangeStep("set")}
                onBack={() => setSubView({ kind: "security" })}
              />
            ) : (
              <PinEntry
                title={t("Set new PIN")}
                subtitle={t("Enter a new 4-digit PIN")}
                mode="set"
                onComplete={async (newPin) => {
                  await setNuvioPin(editing.profile_index, newPin);
                  setPinEnabled(true);
                  setPinChangeStep("verify");
                  setSubView({ kind: "security" });
                }}
                onBack={() => setPinChangeStep("verify")}
              />
            )}
          </div>
        )}

        {/* Remove PIN view */}
        {subView.kind === "pin-remove" && editing && (
          <div className="w-full">
            <PinEntry
              title={t("Remove profile PIN")}
              subtitle={t("Enter your current PIN to remove protection")}
              mode="verify"
              verify={async (pin) => {
                const res = await verifyNuvioPin(editing.profile_index, pin);
                return { ok: res.unlocked, message: res.message };
              }}
              onComplete={async () => {
                await clearNuvioPin(editing.profile_index);
                setPinEnabled(false);
                setSubView({ kind: "security" });
              }}
              onBack={() => setSubView({ kind: "security" })}
            />
          </div>
        )}

        {/* Delete PIN confirmation view */}
        {subView.kind === "pin-delete" && editing && (
          <div className="w-full">
            <PinEntry
              title={t("Enter PIN to delete")}
              subtitle={t(
                draftKid?.parentPinHash && !editing.pin_enabled
                  ? "Enter the parent PIN to permanently delete this profile."
                  : "Enter the PIN for {name} to permanently delete this profile.",
                { name: editing.name },
              )}
              mode="verify"
              verify={async (pin) => {
                if (editing.pin_enabled) {
                  const res = await verifyNuvioPin(editing.profile_index, pin);
                  return { ok: res.unlocked, message: res.message };
                }
                if (draftKid?.parentPinHash) {
                  const ok = await verifyProfilePassword(pin, draftKid.parentPinHash);
                  return ok;
                }
                return false;
              }}
              onComplete={async () => {
                await handleDelete();
              }}
              onBack={() => {
                setConfirmingDelete(false);
                setSubView({ kind: "main" });
              }}
            />
          </div>
        )}

        {avatarPickerOpen && (
          <AvatarCatalogModal
            current={avatar}
            onPick={(value) => {
              setAvatar(value);
              setAvatarUrl(value);
              setAvatarId(null);
              setPendingAvatarFile(null);
              setAvatarPickerOpen(false);
            }}
            onClose={() => setAvatarPickerOpen(false)}
          />
        )}
    </div>
  );

  if (!portal) {
    return inner;
  }

  return createPortal(
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/85 backdrop-blur-2xl animate-in fade-in duration-300 p-4 overflow-y-auto">
      {inner}
    </div>,
    document.body
  );
}

function NuvioUnlockModal({
  target,
  onSuccess,
  onClose,
}: {
  target: NuvioProfile;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return createPortal(
    <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/85 backdrop-blur-2xl animate-in fade-in duration-200 p-4">
      <div className="relative w-full max-w-[420px] rounded-3xl bg-surface p-7 shadow-2xl border border-edge">
        <button
          type="button"
          onClick={onClose}
          className="absolute end-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-ink-subtle hover:bg-elevated hover:text-ink transition"
        >
          <X size={16} />
        </button>
        <PinEntry
          title={target.name}
          subtitle={t("Enter 4-digit PIN")}
          mode="verify"
          verify={async (pin) => {
            const res = await verifyNuvioPin(target.profile_index, pin);
            return res.unlocked;
          }}
          onComplete={onSuccess}
          onBack={onClose}
        />
      </div>
    </div>,
    document.body
  );
}
