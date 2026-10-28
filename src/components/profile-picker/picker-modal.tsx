import { ChevronDown, Plus, X } from "@/views/settings/icons";
import { Lock, Pencil } from "lucide-react";
import { loadPickerBg } from "@/lib/theme-storage";
import { KawaiiBunny } from "./kawaii-bunny";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import { useProfiles, useActiveKid } from "@/lib/profiles";
import { useSettings } from "@/lib/settings";
import { ParentalPinModal } from "@/components/parental-pin-modal";
import { verifyProfilePassword } from "@/lib/profile-password";
import { captureFocusReturn } from "@/lib/keyboard-navigation";
import { isBackKey, isVisible } from "@/lib/keyboard-navigation/geometry";
import { EditorView } from "./editor-view";
import { PasswordPrompt } from "./password-prompt";
import { ProfileTile } from "./profile-tile";
import { PinEntry } from "./pin-entry";
import { NuvioProfileEditor } from "@/views/settings/account/nuvio-profiles-tab";
import { isNuvioSignedIn, loadNuvioState } from "@/lib/nuvio/nuvio-client";
import { getSecondaryPrivileges } from "@/lib/settings/defaults";
import {
  setActiveNuvioProfile,
  verifyNuvioPin,
  resolveNuvioAvatar,
  isNuvioProfileUnlocked,
  markNuvioProfileUnlocked,
  pullNuvioProfiles,
} from "@/lib/nuvio/nuvio-profiles";
import type { NuvioProfile } from "@/lib/nuvio/nuvio-types";
import { isStremioActivePrimary } from "@/lib/active-profile-id";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function ProfilePickerModal() {
  const {
    profiles,
    activeProfile,
    pickerOpen,
    pickerView,
    setPickerView,
    selectProfile,
    closePicker,
    sessionUnlockedIds,
  } = useProfiles();

  const { settings } = useSettings();
  const isNuvio = settings.accountProvider === "nuvio";
  const [nuvioState, setNuvioState] = useState(() => loadNuvioState());

  useEffect(() => {
    if (!isNuvio) return;
    const onNuvioSync = () => setNuvioState(loadNuvioState());
    window.addEventListener("harbor:nuvio-state-changed", onNuvioSync);
    window.addEventListener("harbor:nuvio-profile-changed", onNuvioSync);
    window.addEventListener("harbor:nuvio-profiles-updated", onNuvioSync);
    return () => {
      window.removeEventListener("harbor:nuvio-state-changed", onNuvioSync);
      window.removeEventListener("harbor:nuvio-profile-changed", onNuvioSync);
      window.removeEventListener("harbor:nuvio-profiles-updated", onNuvioSync);
    };
  }, [isNuvio]);

  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);
  const [cameFromList, setCameFromList] = useState(false);
  const timers = useRef<number[]>([]);
  const activeKid = useActiveKid();
  const [parentalPromptNuvio, setParentalPromptNuvio] = useState<NuvioProfile | null>(null);
  const [parentalPromptStremio, setParentalPromptStremio] = useState<string | null>(null);

  useEffect(() => {
    if (!pickerOpen) {
      setSelectingId(null);
      setExiting(false);
      setCameFromList(false);
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    }
  }, [pickerOpen]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
  useEffect(() => {
    if (pickerOpen && isNuvio) {
      setNuvioState(loadNuvioState());
      if (isNuvioSignedIn()) {
        void pullNuvioProfiles().then(() => setNuvioState(loadNuvioState()));
      }
    }
  }, [pickerOpen, isNuvio]);
  useEffect(() => {
    if (!pickerOpen) return;
    const restore = captureFocusReturn();
    dialogRef.current?.focus({ preventScroll: true });
    return restore;
  }, [pickerOpen]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 24);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [pickerView.kind, pickerOpen]);

  const [bg, setBg] = useState<{ image: string | null; dim: number }>({ image: null, dim: 55 });
  useEffect(() => {
    if (!pickerOpen) return;
    let alive = true;
    const mode = isNuvio ? "nuvio" : "stremio";
    const reload = () => {
      void loadPickerBg(mode).then((v) => {
        if (alive) setBg(v);
      });
    };
    reload();
    window.addEventListener("harbor:picker-bg-changed", reload);
    return () => {
      alive = false;
      window.removeEventListener("harbor:picker-bg-changed", reload);
    };
  }, [pickerOpen, isNuvio]);

  if (!pickerOpen) return null;

  const goList = () => setPickerView({ kind: "list" });
  const finishEditor = () => (cameFromList ? goList() : closePicker());
  const showClose = pickerView.kind === "create" || pickerView.kind === "edit";
  const isUnlock = pickerView.kind === "unlock" || pickerView.kind === "unlock-for-edit";

  const proceedSelect = (id: string) => {
    const target = profiles.find((p) => p.id === id);
    if (target?.passwordHash) {
      setPickerView({ kind: "unlock", profileId: id });
      return;
    }
    if (prefersReducedMotion()) {
      selectProfile(id);
      return;
    }
    setSelectingId(id);
    timers.current.push(window.setTimeout(() => setExiting(true), 340));
    timers.current.push(window.setTimeout(() => selectProfile(id), 680));
  };

  const handleSelect = (id: string) => {
    if (activeKid?.parentPinHash && id !== activeProfile?.id) {
      setParentalPromptStremio(id);
      return;
    }
    proceedSelect(id);
  };

  const proceedSelectNuvio = (p: NuvioProfile) => {
    if (p.pin_enabled && !isNuvioProfileUnlocked(p.profile_index)) {
      setPickerView({ kind: "unlock", profileId: String(p.profile_index) });
      return;
    }
    if (prefersReducedMotion()) {
      setActiveNuvioProfile(p.profile_index, { unlocked: true });
      closePicker();
      return;
    }
    setSelectingId(String(p.profile_index));
    timers.current.push(window.setTimeout(() => setExiting(true), 340));
    timers.current.push(
      window.setTimeout(() => {
        setActiveNuvioProfile(p.profile_index, { unlocked: true });
        closePicker();
      }, 680),
    );
  };

  const handleSelectNuvio = (p: NuvioProfile) => {
    if (activeKid?.parentPinHash && p.profile_index !== nuvioState.activeProfileIndex) {
      setParentalPromptNuvio(p);
      return;
    }
    proceedSelectNuvio(p);
  };


  return createPortal(
    <div
      data-tauri-drag-region
      className={`fixed inset-0 z-[180] flex items-center justify-center transition-opacity duration-[340ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
        bg.image ? "bg-black" : "bg-black/85 backdrop-blur-2xl"
      } ${exiting ? "opacity-0" : "animate-picker-scrim"}`}
    >
      {bg.image && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `url(${bg.image})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, rgb(0 0 0 / ${bg.dim / 100 + 0.14}) 0%, rgb(0 0 0 / ${bg.dim / 100}) 38%, rgb(0 0 0 / ${Math.min(0.94, bg.dim / 100 + 0.22)}) 100%)`,
            }}
          />
        </>
      )}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t(
          pickerView.kind === "create"
            ? "New profile"
            : pickerView.kind === "edit"
              ? "Edit profile"
              : "Choose a profile",
        )}
        data-profile-picker=""
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.defaultPrevented) return;
          const target = e.target as HTMLElement;
          if (target.closest('[role="dialog"]') !== e.currentTarget) return;
          if (e.key === "Tab") {
            const controls = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
              ),
            ).filter(isVisible);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (!first) {
              e.preventDefault();
              return;
            }
            if (e.shiftKey && (target === first || target === e.currentTarget)) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && target === last) {
              e.preventDefault();
              first.focus();
            }
          }
          if (isBackKey(e.nativeEvent) && !target.closest("[data-search-editing]")) {
            if (showClose && e.currentTarget.querySelector("[data-profile-editor]")) {
              e.preventDefault();
              e.stopPropagation();
              finishEditor();
            } else if (pickerView.kind === "unlock" || pickerView.kind === "unlock-for-edit") {
              e.preventDefault();
              e.stopPropagation();
              goList();
            }
          }
        }}
        className={`relative flex max-h-[calc(100vh-3rem)] w-full ${isUnlock ? "max-w-[440px]" : "max-w-[860px]"} flex-col outline-none animate-picker-in ${showClose ? "rounded-xl bg-canvas ring-1 ring-edge-soft" : ""}`}
      >
        <KawaiiBunny />
        {showClose && (
          <button
            type="button"
            onClick={closePicker}
            aria-label={t("common.close")}
            className="absolute end-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-canvas/70 text-ink-muted ring-1 ring-edge-soft backdrop-blur transition-colors hover:bg-elevated hover:text-ink"
          >
            <X size={16} strokeWidth={2.4} />
          </button>
        )}
        <div
          ref={scrollRef}
          className="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto overscroll-contain px-4 py-8 sm:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {pickerView.kind === "list" && (
            isNuvio ? (
              <NuvioListView
                selectingId={selectingId}
                nuvioProfiles={nuvioState.profiles}
                activeKid={activeKid}
                onCreate={() => {
                  setCameFromList(true);
                  setPickerView({ kind: "create" });
                }}
                onEdit={(profileIndex) => {
                  setCameFromList(true);
                  const target = nuvioState.profiles.find((p) => p.profile_index === profileIndex);
                  if (target?.pin_enabled && !isNuvioProfileUnlocked(profileIndex)) {
                    setPickerView({ kind: "unlock-for-edit", profileId: String(profileIndex) });
                    return;
                  }
                  setPickerView({ kind: "edit", profileId: String(profileIndex) });
                }}
                onSelect={handleSelectNuvio}
              />
            ) : (
              <ListView
                selectingId={selectingId}
                activeKid={activeKid}
                onCreate={() => {
                  setCameFromList(true);
                  setPickerView({ kind: "create" });
                }}
                onEdit={(id) => {
                  setCameFromList(true);
                  const target = profiles.find((p) => p.id === id);
                  if (target?.passwordHash && !sessionUnlockedIds.has(id)) {
                    setPickerView({ kind: "unlock-for-edit", profileId: id });
                    return;
                  }
                  setPickerView({ kind: "edit", profileId: id });
                }}
                onSelect={handleSelect}
              />
            )
          )}
          {pickerView.kind === "create" && (
            isNuvio ? (
              <NuvioProfileEditor mode={{ kind: "create" }} onCancel={finishEditor} onDone={finishEditor} portal={false} />
            ) : (
              <EditorView mode={{ kind: "create" }} onCancel={finishEditor} onDone={finishEditor} />
            )
          )}
          {pickerView.kind === "edit" &&
            (isNuvio ? (
              (() => {
                const target =
                  nuvioState.profiles.find((p) => String(p.profile_index) === pickerView.profileId) ||
                  nuvioState.profiles[0];
                if (!target) return <NotFoundFallback onBack={finishEditor} />;
                return (
                  <NuvioProfileEditor
                    mode={{ kind: "edit", profile: target }}
                    onCancel={finishEditor}
                    onDone={finishEditor}
                    portal={false}
                  />
                );
              })()
            ) : (
              (() => {
                const target = profiles.find((p) => p.id === pickerView.profileId);
                if (!target) {
                  return <NotFoundFallback onBack={finishEditor} />;
                }
                return (
                  <EditorView
                    mode={{ kind: "edit", profile: target }}
                    onCancel={finishEditor}
                    onDone={finishEditor}
                  />
                );
              })()
            ))}
          {pickerView.kind === "unlock" &&
            (isNuvio ? (
              (() => {
                const target = nuvioState.profiles.find(
                  (p) => String(p.profile_index) === pickerView.profileId,
                );
                if (!target || !target.pin_enabled) {
                  return <NotFoundFallback onBack={goList} />;
                }
                return (
                  <NuvioPasswordPrompt
                    profile={target}
                    onSuccess={() => {
                      setActiveNuvioProfile(target.profile_index, { unlocked: true });
                      closePicker();
                    }}
                    onCancel={goList}
                  />
                );
              })()
            ) : (
              (() => {
                const target = profiles.find((p) => p.id === pickerView.profileId);
                if (!target || !target.passwordHash) {
                  return <NotFoundFallback onBack={goList} />;
                }
                return (
                  <PasswordPrompt
                    profile={target}
                    onSuccess={() => selectProfile(target.id, { unlocked: true })}
                    onCancel={goList}
                  />
                );
              })()
            ))}
          {pickerView.kind === "unlock-for-edit" &&
            (isNuvio ? (
              (() => {
                const target = nuvioState.profiles.find(
                  (p) => String(p.profile_index) === pickerView.profileId,
                );
                if (!target || !target.pin_enabled) {
                  return <NotFoundFallback onBack={goList} />;
                }
                return (
                  <NuvioPasswordPrompt
                    profile={target}
                    subtitle={t("Enter the 4-digit PIN to edit this profile.")}
                    onSuccess={() => {
                      markNuvioProfileUnlocked(target.profile_index);
                      setPickerView({ kind: "edit", profileId: String(target.profile_index) });
                    }}
                    onCancel={goList}
                  />
                );
              })()
            ) : (
              (() => {
                const target = profiles.find((p) => p.id === pickerView.profileId);
                if (!target || !target.passwordHash) {
                  return <NotFoundFallback onBack={goList} />;
                }
                return (
                  <PasswordPrompt
                    profile={target}
                    onSuccess={() => {
                      selectProfile(target.id, { unlocked: true });
                      setPickerView({ kind: "edit", profileId: target.id });
                    }}
                    onCancel={goList}
                  />
                );
              })()
            ))}
        </div>
        {moreBelow && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />
            <button
              type="button"
              onClick={() =>
                scrollRef.current?.scrollBy({
                  top: scrollRef.current.clientHeight * 0.8,
                  behavior: "smooth",
                })
              }
              aria-label={t("Scroll down")}
              className="absolute bottom-3 left-1/2 z-20 flex h-8 w-8 -translate-x-1/2 animate-bounce items-center justify-center rounded-full bg-canvas/80 text-ink-muted ring-1 ring-edge-soft backdrop-blur transition-colors hover:text-ink"
            >
              <ChevronDown size={16} strokeWidth={2.4} />
            </button>
          </>
        )}
        {parentalPromptNuvio && activeKid?.parentPinHash && (
          <ParentalPinModal
            mode={{
              kind: "unlock",
              onUnlock: () => {
                const target = parentalPromptNuvio;
                setParentalPromptNuvio(null);
                proceedSelectNuvio(target);
              },
              onCancel: () => setParentalPromptNuvio(null),
            }}
            verify={(pin) => verifyProfilePassword(pin, activeKid.parentPinHash!)}
            kids
          />
        )}
        {parentalPromptStremio && activeKid?.parentPinHash && (
          <ParentalPinModal
            mode={{
              kind: "unlock",
              onUnlock: () => {
                const targetId = parentalPromptStremio;
                setParentalPromptStremio(null);
                proceedSelect(targetId);
              },
              onCancel: () => setParentalPromptStremio(null),
            }}
            verify={(pin) => verifyProfilePassword(pin, activeKid.parentPinHash!)}
            kids
          />
        )}

      </div>
    </div>,
    document.body,
  );
}

function ListView({
  selectingId,
  activeKid,
  onCreate,
  onEdit,
  onSelect,
}: {
  selectingId: string | null;
  activeKid?: ReturnType<typeof useActiveKid>;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const { profiles, activeProfile } = useProfiles();
  const t = useT();
  const { settings } = useSettings();
  const isPrimary = isStremioActivePrimary(activeProfile, profiles);
  const canAdd = !activeKid && (isPrimary || getSecondaryPrivileges(settings, false).canAddProfiles);
  const selecting = selectingId != null;
  return (
    <div className="flex flex-col items-center gap-10">
      <div
        className={`flex flex-col items-center gap-2.5 transition-all duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          selecting
            ? "-translate-y-1 opacity-0"
            : "animate-in fade-in slide-in-from-bottom-2 duration-500"
        }`}
      >
        <h1 className="font-display text-[40px] font-medium tracking-tight text-ink">
          {t("Who's watching?")}
        </h1>
        <p className="text-[14px] text-ink-muted">{t("Pick a profile to continue.")}</p>
      </div>
      <div className="flex flex-wrap items-start justify-center gap-x-10 gap-y-8">
        {profiles.map((p, i) => {
          const canEditThis = !activeKid;
          const chosen = selectingId === p.id;
          const dimmed = selecting && !chosen;
          return (
            <div
              key={p.id}
              className={`transition-all duration-[440ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                chosen
                  ? "z-10 scale-[1.14]"
                  : dimmed
                    ? "scale-90 opacity-0 blur-[2px]"
                    : "animate-in fade-in slide-in-from-bottom-1 duration-500"
              }`}
              style={
                selecting
                  ? undefined
                  : { animationDelay: `${140 + Math.min(i, 8) * 55}ms`, animationFillMode: "both" }
              }
            >
              <ProfileTile
                profile={p}
                onSelect={() => onSelect(p.id)}
                onEdit={canEditThis ? () => onEdit(p.id) : undefined}
              />
            </div>
          );
        })}
        {canAdd && (
          <div
            className={`transition-all duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              selecting
                ? "scale-90 opacity-0"
                : "animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-500"
            }`}
            style={
              selecting
                ? undefined
                : {
                    animationDelay: `${140 + Math.min(profiles.length, 8) * 55}ms`,
                    animationFillMode: "both",
                  }
            }
          >
            <AddProfileButton onClick={onCreate} />
          </div>
        )}
      </div>
    </div>
  );
}

function AddProfileButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center gap-2 outline-none"
      aria-label={t("Add profile")}
    >
      <span className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-edge text-ink-subtle transition-all duration-200 group-hover:scale-[1.04] group-hover:border-ink group-hover:text-ink">
        <Plus size={28} strokeWidth={2.2} />
      </span>
      <span className="text-[14px] font-medium text-ink-muted transition-colors group-hover:text-ink">
        {t("Add profile")}
      </span>
    </button>
  );
}

function NotFoundFallback({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-[14px] text-ink-muted">{t("Profile not found.")}</p>
      <button
        type="button"
        onClick={onBack}
        className="h-10 rounded-xl bg-ink px-5 text-[13px] font-semibold text-canvas"
      >
        {t("common.back")}
      </button>
    </div>
  );
}

function NuvioListView({
  selectingId,
  nuvioProfiles,
  activeKid,
  onCreate,
  onEdit,
  onSelect,
}: {
  selectingId: string | null;
  nuvioProfiles: NuvioProfile[];
  activeKid?: ReturnType<typeof useActiveKid>;
  onCreate: () => void;
  onEdit: (profileIndex: number) => void;
  onSelect: (p: NuvioProfile) => void;
}) {
  const t = useT();
  const { settings } = useSettings();
  const selecting = selectingId != null;
  const nuvioActiveIndex = loadNuvioState().activeProfileIndex;
  const isPrimary = nuvioActiveIndex === 1;
  const canAdd =
    !activeKid &&
    (isPrimary || getSecondaryPrivileges(settings, true).canAddProfiles) &&
    nuvioProfiles.length < 6;
  return (
    <div className="flex flex-col items-center gap-10">
      <div
        className={`flex flex-col items-center gap-2.5 transition-all duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          selecting
            ? "-translate-y-1 opacity-0"
            : "animate-in fade-in slide-in-from-bottom-2 duration-500"
        }`}
      >
        <h1 className="font-display text-[40px] font-medium tracking-tight text-ink">
          {t("Who's watching?")}
        </h1>
        <p className="text-[14px] text-ink-muted">{t("Pick a profile to continue.")}</p>
      </div>
      <div className="flex flex-wrap items-start justify-center gap-x-10 gap-y-8">
        {nuvioProfiles.map((p, i) => {
          const chosen = selectingId === String(p.profile_index);
          const dimmed = selecting && !chosen;
          const canEditThis = !activeKid;
          return (
            <div
              key={p.profile_index}
              className={`transition-all duration-[440ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                chosen
                  ? "z-10 scale-[1.14]"
                  : dimmed
                    ? "scale-90 opacity-0 blur-[2px]"
                    : "animate-in fade-in slide-in-from-bottom-1 duration-500"
              }`}
              style={
                selecting
                  ? undefined
                  : { animationDelay: `${140 + Math.min(i, 8) * 55}ms`, animationFillMode: "both" }
              }
            >
              <NuvioProfileTile
                profile={p}
                onSelect={() => onSelect(p)}
                onEdit={canEditThis ? () => onEdit(p.profile_index) : undefined}
              />
            </div>
          );
        })}
        {canAdd && (
          <div
            className={`transition-all duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              selecting
                ? "scale-90 opacity-0"
                : "animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-500"
            }`}
            style={
              selecting
                ? undefined
                : {
                    animationDelay: `${140 + Math.min(nuvioProfiles.length, 8) * 55}ms`,
                    animationFillMode: "both",
                  }
            }
          >
            <AddProfileButton onClick={onCreate} />
          </div>
        )}
      </div>
    </div>
  );
}


function NuvioPasswordPrompt({
  profile,
  subtitle,
  onSuccess,
  onCancel,
}: {
  profile: NuvioProfile;
  subtitle?: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const avatarUrl = resolveNuvioAvatar(profile);
  const color = profile.avatar_color_hex || "#1E88E5";

  return (
    <div className="flex w-full max-w-[420px] flex-col items-center gap-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <span className="relative inline-flex">
        <span
          className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-elevated ring-[3px]"
          style={{ boxShadow: `0 0 0 3px ${color}` }}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span
              className="flex h-full w-full items-center justify-center text-[22px] font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {profile.name.slice(0, 2).toUpperCase() || "P"}
            </span>
          )}
        </span>
        <span className="absolute -bottom-1 -end-1 flex h-7 w-7 items-center justify-center rounded-full bg-canvas text-ink shadow-md ring-1 ring-edge">
          <Lock size={13} strokeWidth={2.4} />
        </span>
      </span>
      <PinEntry
        title={t("Enter {name}'s PIN", { name: profile.name })}
        subtitle={subtitle || t("Profile is locked. Enter the 4-digit PIN to continue.")}
        mode="verify"
        verify={async (pin) => {
          const res = await verifyNuvioPin(profile.profile_index, pin);
          return { ok: res.unlocked, message: res.message };
        }}
        onComplete={onSuccess}
        onBack={onCancel}
      />
    </div>
  );
}

function NuvioProfileTile({
  profile,
  onSelect,
  onEdit,
  size = "lg",
}: {
  profile: NuvioProfile;
  onSelect: () => void;
  onEdit?: () => void;
  size?: "sm" | "md" | "lg";
}) {
  const t = useT();
  const dim = size === "lg" ? "h-24 w-24" : size === "md" ? "h-16 w-16" : "h-12 w-12";
  const ring = size === "lg" ? "ring-[3px]" : "ring-2";
  const fontName =
    size === "lg" ? "text-[14px]" : size === "md" ? "text-[12.5px]" : "text-[11px]";
  const avatarUrl = resolveNuvioAvatar(profile);
  const color = profile.avatar_color_hex || "#1E88E5";
  const isPrimary = profile.profile_index === 1;

  return (
    <div className="group flex flex-col items-center gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={onSelect}
          className="block cursor-pointer rounded-full outline-none"
          aria-label={t("Switch to {name}", { name: profile.name })}
        >
          <span
            className={`relative flex ${dim} items-center justify-center overflow-hidden rounded-full bg-elevated ${ring} transition-all duration-200 group-hover:scale-[1.04]`}
            style={{ boxShadow: `0 0 0 3px ${color}` }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span
                className="flex h-full w-full items-center justify-center text-[22px] font-bold text-white"
                style={{ backgroundColor: color }}
              >
                {profile.name.slice(0, 2).toUpperCase() || "P"}
              </span>
            )}
          </span>
        </button>
        {profile.pin_enabled && (
          <span
            aria-label={t("chrome.locked")}
            className="pointer-events-none absolute -bottom-1 -end-1 flex h-7 w-7 items-center justify-center rounded-full bg-canvas text-ink shadow-md ring-1 ring-edge"
          >
            <Lock size={12} strokeWidth={2.4} />
          </span>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={t("Edit {name}", { name: profile.name })}
            className="absolute -end-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-canvas/95 text-ink opacity-0 ring-1 ring-edge transition-opacity duration-150 group-hover:opacity-100 hover:bg-elevated"
          >
            <Pencil size={12} strokeWidth={2.4} />
          </button>
        )}
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <span className={`font-medium text-ink ${fontName}`}>{profile.name}</span>
        {isPrimary && size !== "sm" && (
          <span
            className="text-[9.5px] font-bold uppercase tracking-[0.18em]"
            style={{ color }}
          >
            {t("profile.primary")}
          </span>
        )}
      </div>
    </div>
  );
}
