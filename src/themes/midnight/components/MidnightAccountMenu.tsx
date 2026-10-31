import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Bell,
  Check,
  ChevronDown,
  Leaf,
  Lock,
  LogIn,
  LogOut,
  Moon,
  Palette,
  PanelTop,
  Pencil,
  Plus,
  RectangleHorizontal,
  Settings as SettingsIcon,
  Shrink,
  UserRound,
  Users,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { useView } from "@/lib/view";
import { getSecondaryPrivileges } from "@/lib/settings/defaults";
import { verifyProfilePassword } from "@/lib/profile-password";
import { StatusDot, StatusPicker } from "@/chrome/sidebar/status-control";
import { PRESENCE_META } from "@/lib/social/presence";
import { ProfileAvatar, SubtitleText } from "@/chrome/account-menu/account-menu-parts";
import { useAccountMenu } from "@/chrome/account-menu/use-account-menu";
import { HarborAccountDialog } from "@/views/account/harbor-account-dialog";
import { ParentalPinModal } from "@/components/parental-pin-modal";
import { loadNuvioState } from "@/lib/nuvio/nuvio-client";
import { signOutNuvio } from "@/lib/nuvio/nuvio-auth";
import { resolveNuvioAvatar } from "@/lib/nuvio/nuvio-profiles";
import { isStremioActivePrimary } from "@/lib/active-profile-id";
import { usePreviewShape, writePreviewShape } from "../preview-style";
import {
  HERO_HEIGHT_NAME,
  HERO_RADIUS_NAME,
  HERO_SCRIM_NAME,
  HERO_STYLE_NAME,
  HERO_TEXT_NAME,
  MIDNIGHT_HERO_HEIGHTS,
  MIDNIGHT_HERO_RADII,
  MIDNIGHT_HERO_SCRIMS,
  MIDNIGHT_HERO_STYLES,
  MIDNIGHT_HERO_TEXTS,
  useHero,
  writeHero,
} from "../hero-style";
import {
  DETAIL_STYLE_NAME,
  MIDNIGHT_DETAIL_STYLES,
  useDetailStyle,
  writeDetailStyle,
} from "../detail-style";
import {
  MIDNIGHT_PALETTES,
  PALETTE_ACCENT,
  PALETTE_NAME,
  useAppearance,
  writeOled,
  writePalette,
} from "../appearance";
import { useRuntime, writeLite, writeNavShrink } from "../runtime";

export function MidnightAccountMenu({
  onOpenSettings,
  settingsActive = false,
}: {
  onOpenSettings?: () => void;
  settingsActive?: boolean;
}) {
  const t = useT();
  const { settings } = useSettings();
  const { view, openFeed, openGroups } = useView();
  const ctrl = useAccountMenu();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const {
    ref,
    user,
    activeProfile,
    author,
    status,
    menuOpen,
    setMenuOpen,
    statusOpen,
    toggleStatus,
    pickStatus,
    pendingSwitch,
    setPendingSwitch,
    selectProfile,
  } = ctrl;

  const kid = !!activeProfile?.kid;
  const harborAvatar = settings.harborAvatar?.startsWith("/kids/avatars/")
    ? null
    : settings.harborAvatar;
  const name =
    activeProfile?.name ?? user?.fullname ?? user?.email?.split("@")[0] ?? t("profile.fallback");
  const showStatus = !!author && !kid;

  // Close menu on route change and return focus to trigger
  useEffect(() => {
    if (menuOpen) {
      setMenuOpen(false);
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Return focus to trigger when closing menu
  const prevOpenRef = useRef(menuOpen);
  useEffect(() => {
    if (prevOpenRef.current && !menuOpen) {
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
    prevOpenRef.current = menuOpen;
  }, [menuOpen]);

  // Escape key handler: use capture phase to intercept before global router/keyboard nav swallows it
  useEffect(() => {
    if (!menuOpen && !statusOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(false);
        ctrl.setStatusOpen(false);
        requestAnimationFrame(() => {
          triggerRef.current?.focus();
        });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menuOpen, statusOpen, setMenuOpen, ctrl]);

  return (
    <div ref={ref} className="midnight-account-slot relative shrink-0">
      {/* 36px Compact Avatar Trigger */}
      <button
        ref={triggerRef}
        type="button"
        tabIndex={0}
        onClick={() => setMenuOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={name}
        data-midnight-account-trigger="true"
        className={`midnight-item group/account relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 ${
          menuOpen ? "midnight-item-active text-ink ring-1 ring-white/25" : "text-ink-muted hover:text-ink"
        }`}
      >
        <ProfileAvatar
          profile={activeProfile}
          user={user}
          fallbackAvatar={harborAvatar}
          size="md"
        />
      </button>

      {/* Status Dot: absolute sibling to avoid nested interactive button inside trigger */}
      {showStatus && (
        <StatusDot
          status={status}
          onActivate={(e) => {
            e.stopPropagation();
            toggleStatus();
          }}
        />
      )}

      {/* Status Picker popover */}
      {statusOpen && showStatus && (
        <StatusPicker
          current={status}
          placement="down"
          align="end"
          onPick={pickStatus}
        />
      )}

      {/* Glass Popover Menu */}
      {menuOpen && (
        <MidnightAccountPanel
          ctrl={ctrl}
          showSettings={!!onOpenSettings}
          onOpenSettings={onOpenSettings}
          settingsActive={settingsActive}
          openFeed={openFeed}
          openGroups={openGroups}
        />
      )}

      {/* Reused Auth and PIN modals */}
      {ctrl.authOpen && (
        <HarborAccountDialog
          onClose={() => ctrl.setAuthOpen(false)}
          returnFocus={ctrl.authReturnFocus.current}
        />
      )}
      {pendingSwitch && activeProfile?.kid?.parentPinHash && (
        <ParentalPinModal
          mode={{
            kind: "unlock",
            onUnlock: () => {
              const target = pendingSwitch;
              setPendingSwitch(null);
              if (target.passwordHash) ctrl.openPicker({ kind: "unlock", profileId: target.id });
              else selectProfile(target.id);
            },
            onCancel: () => setPendingSwitch(null),
          }}
          verify={(pin) => verifyProfilePassword(pin, activeProfile.kid!.parentPinHash!)}
          kids
        />
      )}
    </div>
  );
}

function MidnightAccountPanel({
  ctrl,
  showSettings,
  onOpenSettings,
  settingsActive,
  openFeed,
  openGroups,
}: {
  ctrl: ReturnType<typeof useAccountMenu>;
  showSettings: boolean;
  onOpenSettings?: () => void;
  settingsActive: boolean;
  openFeed: () => void;
  openGroups: () => void;
}) {
  const t = useT();
  const { settings } = useSettings();
  const isNuvio = settings.accountProvider === "nuvio";
  const previewShape = usePreviewShape();
  const appearance = useAppearance();
  const runtime = useRuntime();
  const hero = useHero();
  const detailStyle = useDetailStyle();
  const [themeOpen, setThemeOpen] = useState(false);
  const lang: "ar" | "en" = settings.uiLanguage.startsWith("ar") ? "ar" : "en";
  // The theme cannot reach Harbor's string catalogue, so its own controls carry both labels.
  const copy =
    lang === "ar"
      ? {
          theme: "الثيم",
          preview: "معاينة بطاقة العمل",
          card: "كرت أفقي",
          panel: "لوحة عائمة",
          hero: "الواجهة الرئيسية",
          detail: "صفحة العمل",
          heroHeight: "الارتفاع",
          heroText: "النص",
          heroScrim: "التعتيم",
          heroRadius: "الحواف",
          oled: "أسود OLED",
          oledHint: "خلفية سوداء تمامًا خلف كل سطح",
          accent: "لون الثيم",
          performance: "الأداء",
          shrink: "انكماش الشريط",
          shrinkHint: "الشريط يتقلّص أثناء التمرير",
          lite: "تخفيض الاستهلاك",
          liteHint: "بلا ضبابية ولا حركة دائمة",
        }
      : {
          theme: "Theme",
          preview: "Title preview",
          card: "Wide card",
          panel: "Floating panel",
          hero: "Home hero",
          detail: "Title page",
          heroHeight: "Height",
          heroText: "Writing",
          heroScrim: "Artwork",
          heroRadius: "Corners",
          oled: "OLED black",
          oledHint: "True black behind every surface",
          accent: "Accent",
          performance: "Performance",
          shrink: "Nav shrink",
          shrinkHint: "The bar folds back while you scroll",
          lite: "Low consumption",
          liteHint: "No blur and no ambient motion",
        };
  const paletteName = PALETTE_NAME[appearance.palette][lang];

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
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onNuvioChange = () => setNuvioState(loadNuvioState());
    window.addEventListener("harbor:nuvio-state-changed", onNuvioChange);
    window.addEventListener("harbor:nuvio-profile-changed", onNuvioChange);
    window.addEventListener("harbor:nuvio-profiles-updated", onNuvioChange);
    return () => {
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
  const otherStremioProfiles = !isNuvio
    ? profiles.filter((p) => p.id !== activeProfile?.id)
    : [];

  const name = isNuvio
    ? (activeNuvioProfile?.name ?? nuvioEmail?.split("@")[0] ?? t("profile.fallback"))
    : (activeProfile?.name ?? user?.fullname ?? user?.email?.split("@")[0] ?? t("profile.fallback"));

  const isPrimary = isNuvio
    ? activeNuvioProfile?.profile_index === 1
    : isStremioActivePrimary(activeProfile, profiles);

  const privs = getSecondaryPrivileges(settings, isNuvio);
  const canAddProfiles = isPrimary || privs.canAddProfiles;
  const canSignOutRoot = isPrimary || privs.canSignOutRoot;

  const ITEM =
    "flex items-center gap-2.5 rounded-xl px-3 py-2 text-start text-[13px] font-medium text-ink-muted transition-colors duration-150 hover:bg-white/10 hover:text-ink active:scale-[0.98]";
  const SUB_ITEM =
    "flex items-center gap-2.5 rounded-lg py-1.5 ps-7 pe-3 text-start text-[12.5px] text-ink-subtle transition-colors duration-150 hover:bg-white/10 hover:text-ink";

  return (
    <div
      role="menu"
      aria-label={t("Account")}
      data-harbor-context-layer="true"
      className={`midnight-account-popover absolute end-0 top-[calc(100%+8px)] z-[140] w-80 flex flex-col overflow-hidden rounded-2xl p-2.5 transition-[opacity,translate] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-120 motion-reduce:transition-opacity ${
        entered ? "opacity-100 [translate:none]" : "opacity-0 [translate:0_-8px] motion-reduce:[translate:none]"
      }`}
    >
      {/* 1. Header: Avatar, Display Name, Presence Status */}
      <div className="flex items-center gap-3 px-2 py-2">
        <ProfileAvatar
          profile={activeProfile}
          user={user}
          fallbackAvatar={settings.harborAvatar}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-ink">{name}</div>
          {author && !kid ? (
            <button
              type="button"
              onClick={ctrl.toggleStatus}
              className="flex items-center gap-1.5 text-start text-[11.5px] text-ink-subtle hover:text-ink transition-colors"
              title={t("Set status")}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${PRESENCE_META[ctrl.status].dot}`} />
              <span className="truncate">{t(PRESENCE_META[ctrl.status].label)}</span>
            </button>
          ) : isNuvio && nuvioEmail ? (
            <div className="truncate text-[11.5px] text-ink-subtle">{nuvioEmail} (Nuvio)</div>
          ) : (
            <div className="truncate text-[11.5px] text-ink-subtle">
              <SubtitleText author={author} />
            </div>
          )}
        </div>
      </div>

      {/* 2. Quick Entries Row for Social System */}
      {!kid && (
        <div className="my-1.5 grid grid-cols-4 gap-1 border-y border-white/10 py-1.5">
          <button
            type="button"
            tabIndex={0}
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              void viewMyProfile();
            }}
            className="midnight-account-tile"
          >
            <UserRound size={16} strokeWidth={2.2} />
            <span className="truncate">{t("Profile")}</span>
          </button>
          <button
            type="button"
            tabIndex={0}
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              openFeed();
            }}
            className="midnight-account-tile"
          >
            <Activity size={16} strokeWidth={2.2} />
            <span className="truncate">{t("Feed")}</span>
          </button>
          <button
            type="button"
            tabIndex={0}
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              openGroups();
            }}
            className="midnight-account-tile"
          >
            <Users size={16} strokeWidth={2.2} />
            <span className="truncate">{t("Groups")}</span>
          </button>
          <button
            type="button"
            tabIndex={0}
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              openNotifications();
            }}
            className="midnight-account-tile"
          >
            <Bell size={16} strokeWidth={2.2} />
            <span className="truncate">{t("Notifications")}</span>
          </button>
        </div>
      )}

      {/* 3. Settings (Gated with Parental PIN per onOpenSettings) */}
      {showSettings && onOpenSettings && (
        <button
          type="button"
          tabIndex={0}
          role="menuitem"
          onClick={() => {
            setMenuOpen(false);
            onOpenSettings();
          }}
          className={`${ITEM} ${settingsActive ? "bg-white/15 text-ink ring-1 ring-white/20" : ""}`}
        >
          <SettingsIcon size={14} strokeWidth={2.2} />
          <span className="truncate">{t("nav.settings")}</span>
        </button>
      )}

      {/* 3b. Theme settings. Harbor's settings store is outside the theme, so the theme offers its
          own appearance controls here and remembers them locally: the shape the hover preview
          opens in, true black behind every surface, and the accent its glass is tinted with. They
          share one disclosure, so the menu stays the length of a menu. */}
      <div className="mt-1 border-t border-white/10 px-1 pb-1 pt-2">
        <button
          type="button"
          tabIndex={0}
          role="menuitem"
          aria-expanded={themeOpen}
          onClick={() => setThemeOpen((o) => !o)}
          data-midnight-theme-toggle="true"
          className={ITEM}
        >
          <Palette size={14} strokeWidth={2.2} />
          <span className="flex-1 truncate">{copy.theme}</span>
          <span className="max-w-[45%] truncate text-[10.5px] font-medium text-ink-subtle">
            {paletteName} · {HERO_STYLE_NAME[hero.style][lang]}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={2.2}
            className={`shrink-0 transition-transform duration-200 ${themeOpen ? "rotate-180" : ""}`}
          />
        </button>

        {themeOpen && (
          <div className="flex flex-col gap-2.5 px-3 pb-1 pt-1">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
                {copy.preview}
              </span>
              <div
                role="group"
                aria-label={copy.preview}
                className="flex gap-1 rounded-xl bg-white/5 p-0.5"
              >
                {(["card", "panel"] as const).map((option) => {
                  const Icon = option === "card" ? RectangleHorizontal : PanelTop;
                  const selected = previewShape === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => writePreviewShape(option)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2 py-1.5 text-[12px] font-medium transition-colors duration-150 ${
                        selected
                          ? "bg-white/15 text-ink ring-1 ring-white/20"
                          : "text-ink-muted hover:bg-white/10 hover:text-ink"
                      }`}
                    >
                      <Icon size={13} strokeWidth={2.2} />
                      <span className="truncate">{option === "card" ? copy.card : copy.panel}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* The home hero is the largest surface the board draws and Harbour leaves it flat.
                This group picks the composition and then tunes it; every choice is one document
                attribute the stylesheet keys on, so the card keeps a single geometry per choice
                instead of a pile of inline styles the next render could drop. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
                {copy.hero}
              </span>
              <div role="group" aria-label={copy.hero} className="grid grid-cols-3 gap-1">
                {MIDNIGHT_HERO_STYLES.map((style) => {
                  const selected = hero.style === style;
                  return (
                    <button
                      key={style}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => writeHero({ style })}
                      data-midnight-hero-tile={style}
                      data-selected={selected}
                      className="midnight-hero-tile flex flex-col items-center gap-1 rounded-xl px-1 pb-1.5 pt-2"
                    >
                      {/* A drawn wireframe, not an icon: at this size it is the composition
                          itself that has to be recognisable, not the name of it. */}
                      <span className="midnight-hero-glyph" data-shape={style} aria-hidden="true">
                        <span />
                        <span />
                      </span>
                      <span className="w-full truncate text-center text-[10.5px] font-medium">
                        {HERO_STYLE_NAME[style][lang]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <HeroKnob
                label={copy.heroHeight}
                value={hero.height}
                options={MIDNIGHT_HERO_HEIGHTS}
                nameOf={(value) => HERO_HEIGHT_NAME[value][lang]}
                onPick={(height) => writeHero({ height })}
              />
              <HeroKnob
                label={copy.heroText}
                value={hero.text}
                options={MIDNIGHT_HERO_TEXTS}
                nameOf={(value) => HERO_TEXT_NAME[value][lang]}
                onPick={(text) => writeHero({ text })}
              />
              <HeroKnob
                label={copy.heroScrim}
                value={hero.scrim}
                options={MIDNIGHT_HERO_SCRIMS}
                nameOf={(value) => HERO_SCRIM_NAME[value][lang]}
                onPick={(scrim) => writeHero({ scrim })}
              />
              <HeroKnob
                label={copy.heroRadius}
                value={hero.radius}
                options={MIDNIGHT_HERO_RADII}
                nameOf={(value) => HERO_RADIUS_NAME[value][lang]}
                onPick={(radius) => writeHero({ radius })}
              />
            </div>

            {/* The title page is the second surface the theme rewrites, and the only one whose
                stock shape is worth keeping: `default` paints no attribute at all, which is how
                the page comes back exactly as Harbour drew it. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
                {copy.detail}
              </span>
              <div role="group" aria-label={copy.detail} className="grid grid-cols-3 gap-1">
                {MIDNIGHT_DETAIL_STYLES.map((style) => {
                  const selected = detailStyle === style;
                  return (
                    <button
                      key={style}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => writeDetailStyle(style)}
                      data-midnight-detail-tile={style}
                      data-selected={selected}
                      className="midnight-hero-tile flex flex-col items-center gap-1 rounded-xl px-1 pb-1.5 pt-2"
                    >
                      <span
                        className="midnight-hero-glyph"
                        data-detail-glyph={style}
                        aria-hidden="true"
                      >
                        <span />
                        <span />
                      </span>
                      <span className="w-full truncate text-center text-[10.5px] font-medium">
                        {DETAIL_STYLE_NAME[style][lang]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* The reading side of the card lifts off near-black in the base theme. In OLED there is
                nothing to lift from, so the switch takes the whole theme down with it. */}
            <ThemeToggle
              name="oled"
              icon={<Moon size={14} strokeWidth={2.2} />}
              label={copy.oled}
              hint={copy.oledHint}
              checked={appearance.oled}
              onToggle={() => writeOled(!appearance.oled)}
            />

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
                {copy.accent}
              </span>
              <div role="group" aria-label={copy.accent} className="flex items-center gap-2">
                {MIDNIGHT_PALETTES.map((palette) => {
                  const selected = appearance.palette === palette;
                  return (
                    <button
                      key={palette}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      title={PALETTE_NAME[palette][lang]}
                      aria-label={PALETTE_NAME[palette][lang]}
                      onClick={() => writePalette(palette)}
                      data-midnight-swatch={palette}
                      className="midnight-swatch flex h-6 w-6 items-center justify-center rounded-full"
                      data-selected={selected}
                      style={{ backgroundColor: PALETTE_ACCENT[palette] }}
                    >
                      {selected && <Check size={12} strokeWidth={3.2} className="text-black/70" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* What the theme spends, as opposed to how it looks. The recede is the theme's own
                gesture and the lite mode is what its glass and its ambient motion cost; both are
                answered by the shell and the stylesheet, never by Harbour. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
                {copy.performance}
              </span>
              <ThemeToggle
                name="shrink"
                icon={<Shrink size={14} strokeWidth={2.2} />}
                label={copy.shrink}
                hint={copy.shrinkHint}
                checked={runtime.navShrink}
                onToggle={() => writeNavShrink(!runtime.navShrink)}
              />
              <ThemeToggle
                name="lite"
                icon={<Leaf size={14} strokeWidth={2.2} />}
                label={copy.lite}
                hint={copy.liteHint}
                checked={runtime.lite}
                onToggle={() => writeLite(!runtime.lite)}
              />
            </div>
          </div>
        )}
      </div>

      {/* 4. Profiles Switch List (Nuvio) */}
      {isNuvio && otherNuvioProfiles.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-white/10 pt-1">
          <span className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
            {t("profile.switch")}
          </span>
          {otherNuvioProfiles.map((p) => {
            const avatarUrl = resolveNuvioAvatar(p);
            const color = p.avatar_color_hex || "#1E88E5";
            return (
              <button
                key={p.profile_index}
                type="button"
                tabIndex={0}
                role="menuitem"
                onClick={() => ctrl.requestNuvioSwitch(p)}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-start transition-colors duration-150 hover:bg-white/10 active:scale-[0.98]"
              >
                <span className="relative inline-flex shrink-0">
                  <span
                    className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white shadow-sm ring-1 ring-edge"
                    style={{ backgroundColor: color }}
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (p.name?.[0] || "P").toUpperCase()
                    )}
                  </span>
                  {p.pin_enabled && (
                    <span className="absolute -bottom-0.5 -end-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-canvas text-ink ring-1 ring-edge">
                      <Lock size={7} strokeWidth={2.6} />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{p.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Profiles Switch List (Stremio) */}
      {!isNuvio && otherStremioProfiles.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-white/10 pt-1">
          <span className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
            {t("profile.switch")}
          </span>
          {otherStremioProfiles.map((p) => (
            <button
              key={p.id}
              type="button"
              tabIndex={0}
              role="menuitem"
              onClick={() => requestSwitch(p)}
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-start transition-colors duration-150 hover:bg-white/10 active:scale-[0.98]"
            >
              <span className="relative inline-flex shrink-0">
                <ProfileAvatar profile={p} user={null} fallbackAvatar={null} size="sm" />
                {p.passwordHash && (
                  <span className="absolute -bottom-0.5 -end-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-canvas text-ink ring-1 ring-edge">
                    <Lock size={7} strokeWidth={2.6} />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{p.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* 5. Manage Profiles Accordion */}
      {!kid && (
        <div className="flex flex-col border-t border-white/10 pt-1">
          <button
            type="button"
            tabIndex={0}
            role="menuitem"
            aria-expanded={manageOpen}
            onClick={() => setManageOpen((o) => !o)}
            className={ITEM}
          >
            <Users size={14} strokeWidth={2.2} />
            <span className="flex-1 truncate">{t("Manage profiles")}</span>
            <ChevronDown
              size={14}
              strokeWidth={2.2}
              className={`transition-transform duration-200 ${manageOpen ? "rotate-180" : ""}`}
            />
          </button>

          {manageOpen && (
            <div className="flex flex-col py-0.5">
              <button
                type="button"
                tabIndex={0}
                role="menuitem"
                onClick={() => {
                  openPicker({ kind: "list" });
                  setMenuOpen(false);
                }}
                className={SUB_ITEM}
              >
                <Users size={13} strokeWidth={2.2} />
                <span>{t("profile.whoWatching")}</span>
              </button>
              <button
                type="button"
                tabIndex={0}
                role="menuitem"
                onClick={() => {
                  if (isNuvio) {
                    openPicker({ kind: "edit", profileId: String(activeNuvioProfile?.profile_index ?? 1) });
                  } else if (activeProfile) {
                    openPicker({ kind: "edit", profileId: activeProfile.id });
                  }
                  setMenuOpen(false);
                }}
                className={SUB_ITEM}
              >
                <Pencil size={13} strokeWidth={2.2} />
                <span>{t("profile.editThis")}</span>
              </button>
              {canAddProfiles && (
                <button
                  type="button"
                  tabIndex={0}
                  role="menuitem"
                  onClick={() => {
                    openPicker({ kind: "create" });
                    setMenuOpen(false);
                  }}
                  className={SUB_ITEM}
                >
                  <Plus size={13} strokeWidth={2.2} />
                  <span>{t("profile.new")}</span>
                </button>
              )}
            </div>
          )}

          {/* 6. Sign Out / Sign In */}
          {canSignOutRoot && isNuvio && nuvioState.session && (
            <button
              type="button"
              tabIndex={0}
              role="menuitem"
              onClick={() => {
                signOutNuvio();
                setMenuOpen(false);
              }}
              className={`${ITEM} border-t border-white/10`}
            >
              <LogOut size={14} strokeWidth={2.2} />
              <span>{t("Sign out of Nuvio")}</span>
            </button>
          )}

          {canSignOutRoot && isNuvio && !nuvioState.session && (
            <button
              type="button"
              tabIndex={0}
              role="menuitem"
              onClick={() => {
                setAuthOpen(true);
                setMenuOpen(false);
              }}
              className={`${ITEM} border-t border-white/10`}
            >
              <LogIn size={14} strokeWidth={2.2} />
              <span>{t("Sign in to Nuvio")}</span>
            </button>
          )}

          {!isNuvio && (author ? (
            <button
              type="button"
              tabIndex={0}
              role="menuitem"
              onClick={signOutHarbor}
              className={`${ITEM} border-t border-white/10`}
            >
              <LogOut size={14} strokeWidth={2.2} />
              <span>{t("Sign out of Harbor")}</span>
            </button>
          ) : (
            <button
              type="button"
              tabIndex={0}
              role="menuitem"
              onClick={openHarborAuth}
              className={`${ITEM} border-t border-white/10`}
            >
              <LogIn size={14} strokeWidth={2.2} />
              <span>{t("Sign in to Harbor")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One switch in the theme group: a name, the line that explains what flipping it buys, and the knob
 * the OLED row has always worn. Three of them in a column have to read as one block.
 */
function ThemeToggle({
  name,
  icon,
  label,
  hint,
  checked,
  onToggle,
}: {
  name: string;
  icon: ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      data-midnight-toggle={name}
      className="midnight-toggle-row flex items-center gap-2.5 rounded-xl py-1 text-start"
    >
      <span className="shrink-0 text-ink-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-ink">{label}</span>
        <span className="block text-[10.5px] leading-snug text-ink-subtle">{hint}</span>
      </span>
      <span className="midnight-switch shrink-0" data-on={checked} aria-hidden="true">
        <span className="midnight-switch-knob" />
      </span>
    </button>
  );
}

/**
 * One tuning row of the hero group: a name on the writing's own side of the menu and the choices
 * in a segmented well, so four rows read as one block instead of four separate settings.
 */
function HeroKnob<T extends string>({
  label,
  value,
  options,
  nameOf,
  onPick,
}: {
  label: string;
  value: T;
  options: readonly T[];
  nameOf: (value: T) => string;
  onPick: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[54px] shrink-0 text-[10.5px] font-medium text-ink-subtle">{label}</span>
      <div role="group" aria-label={label} className="flex flex-1 gap-0.5 rounded-lg bg-white/5 p-0.5">
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => onPick(option)}
              className={`flex-1 truncate rounded-[7px] px-1 py-1 text-[10.5px] font-medium transition-colors duration-150 ${
                selected
                  ? "bg-white/15 text-ink ring-1 ring-white/20"
                  : "text-ink-muted hover:bg-white/10 hover:text-ink"
              }`}
            >
              {nameOf(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
