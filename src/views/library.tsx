import {
  BarChart3,
  Bookmark,
  Check,
  Clock,
  Eye,
  EyeOff,
  HardDrive,
  Library,
  Server,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import { UiIcon } from "@/components/ui-icon";
import { Profiled } from "@/components/profiled";
import { AnchoredMenu } from "@/components/anchored-menu";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import traktLogo from "@/assets/trakt.svg";
import anilistLogo from "@/assets/anilist.png";
import simklLogo from "@/assets/simkl.png";
import publicmetadbLogo from "@/assets/publicmetadb.svg";
import letterboxdLogo from "@/assets/addon-logos/letterboxd.png";
import { MalLogo } from "@/components/icons/mal-logo";
import { useAnilist } from "@/lib/anilist/provider";
import { useMal } from "@/lib/mal/provider";
import { useSimkl } from "@/lib/simkl/provider";
import { usePublicMetaDb } from "@/lib/publicmetadb/provider";
import { useTrakt } from "@/lib/trakt/provider";
import { useScrollMemory, useView } from "@/lib/view";
import { useSettings } from "@/lib/settings";
import { useContentDrag } from "@/lib/window-drag";
import { useT } from "@/lib/i18n";
import { watchlistHas } from "@/lib/watchlist";
import { useLetterboxd } from "@/lib/stremboxd/provider";
import { AnilistTab } from "./library/anilist-tab";
import { HistoryTab } from "./library/history-tab";
import { LocalTab } from "./library/local-tab";
import { MalTab } from "./library/mal-tab";
import { MyListsTab } from "./library/my-lists-tab";
import { MyGroupsTab } from "./library/my-groups-tab";
import { FavoritesTab } from "./library/favorites-tab";
import { TabBtn, type Tab } from "./library/shared";
import {
  hiddenLibraryTabs,
  isLibraryTabShown,
  toggleHiddenLibraryTab,
} from "./library/tab-visibility";
import { SimklTab } from "./library/simkl-tab";
import { PublicMetaDbTab } from "./library/publicmetadb-tab";
import { TraktTab } from "./library/trakt-tab";
import { WatchlistTab } from "./library/watchlist-tab";
import { LetterboxdTab } from "./library/letterboxd-tab";
import { MediaServersTab } from "./library/media-servers-tab";
import { TorboxTab } from "./library/torbox-tab";
import torboxLogo from "@/assets/addon-logos/torbox.png";
import { pushActivityHint } from "@/lib/discord/activity-hint";
import { HeroCarousel } from "@/components/hero-carousel";
import { LibraryFeaturedProvider, useLibraryFeatured } from "./library/featured-context";
import { pickFeatured } from "./library/featured-picks";

const LIBRARY_TAB_KEY = "harbor.library.tab";

function readSavedTab(): Tab {
  try {
    let v = localStorage.getItem(LIBRARY_TAB_KEY);
    const migrated = "harbor.library.tab.split.v1";
    if (!localStorage.getItem(migrated)) {
      localStorage.setItem(migrated, "1");
      if (v === "watchlist") {
        localStorage.setItem(LIBRARY_TAB_KEY, "library");
        v = "library";
      }
    }
    if (
      v === "library" ||
      v === "watchlist" ||
      v === "history" ||
      v === "local" ||
      v === "media-servers" ||
      v === "torbox" ||
      v === "lists" ||
      v === "groups" ||
      v === "favorites" ||
      v === "trakt" ||
      v === "anilist" ||
      v === "simkl" ||
      v === "publicmetadb" ||
      v === "letterboxd" ||
      v === "mal"
    )
      return v;
  } catch {}
  return "library";
}

export function LibraryView({ active }: { active: boolean }) {
  const [tab, setTab] = useState<Tab>(readSavedTab);
  const { settings } = useSettings();
  const { isConnected: traktConnected } = useTrakt();
  const { isConnected: anilistConnected } = useAnilist();
  const { isConnected: malConnected } = useMal();
  const { isConnected: simklConnected } = useSimkl();
  const { isConnected: pmdbConnected } = usePublicMetaDb();
  const lb = useLetterboxd();
  const scrollRef = useRef<HTMLElement>(null);
  useScrollMemory("library", scrollRef, active);
  const contentDrag = useContentDrag();
  useEffect(() => {
    const openGroup = () => setTab("groups");
    window.addEventListener("harbor:open-library-group", openGroup);
    return () => window.removeEventListener("harbor:open-library-group", openGroup);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_TAB_KEY, tab);
    } catch {}
  }, [tab]);

  useEffect(() => {
    if (tab === "trakt" && !traktConnected) setTab("library");
  }, [tab, traktConnected]);

  useEffect(() => {
    if (tab === "anilist" && !anilistConnected) setTab("library");
  }, [tab, anilistConnected]);

  useEffect(() => {
    if (tab === "simkl" && !simklConnected) setTab("library");
  }, [tab, simklConnected]);

  useEffect(() => {
    if (tab === "publicmetadb" && !pmdbConnected) setTab("library");
  }, [tab, pmdbConnected]);

  useEffect(() => {
    if (tab === "letterboxd" && !lb.isActive) setTab("library");
  }, [tab, lb.isActive]);

  useEffect(() => {
    if (tab === "mal" && !malConnected) setTab("library");
  }, [tab, malConnected]);

  useEffect(() => {
    if (!active) return;
    const label =
      tab === "watchlist"
        ? "Browsing their watchlist"
        : tab === "history"
          ? "Browsing their watch history"
          : tab === "lists"
            ? "Browsing their lists"
            : tab === "trakt"
              ? "Browsing their Trakt library"
              : tab === "simkl"
                ? "Browsing their Simkl library"
                : tab === "letterboxd"
                  ? "Browsing their Letterboxd library"
                  : tab === "mal"
                    ? "Browsing their MyAnimeList library"
                    : "Browsing their Stremio library";
    return pushActivityHint({ details: label, state: "Library" });
  }, [active, tab]);

  return (
    <main
      ref={scrollRef}
      data-harbor-library
      className="flex-1 overflow-y-auto px-5 pt-24 pb-14 sm:px-8 lg:px-12 lg:pt-28"
    >
      <LibraryFeaturedProvider>
        <div {...contentDrag} data-context-page-background className="flex flex-col gap-7">
          {settings.libraryHero && <LibraryHero tabKey={tab} />}
          <Header
            tab={tab}
            onTab={setTab}
            traktConnected={traktConnected}
            anilistConnected={anilistConnected}
            malConnected={malConnected}
            simklConnected={simklConnected}
            pmdbConnected={pmdbConnected}
            lbConnected={lb.isActive}
          />
          {tab === "library" && (
            <Profiled id="library.collection">
              <WatchlistTab mode="library" scrollRef={scrollRef} />
            </Profiled>
          )}
          {tab === "watchlist" && (
            <Profiled id="library.watchlist">
              <WatchlistTab mode="watchlist" scrollRef={scrollRef} />
            </Profiled>
          )}
          {tab === "history" && (
            <Profiled id="library.history">
              <HistoryTab />
            </Profiled>
          )}
          {tab === "local" && <LocalTab scrollRef={scrollRef} />}
          {tab === "media-servers" && <MediaServersTab scrollRef={scrollRef} />}
          {tab === "torbox" && <TorboxTab />}
          {tab === "lists" && <MyListsTab />}
          {tab === "groups" && <MyGroupsTab />}
          {tab === "favorites" && <FavoritesTab />}
          {tab === "trakt" && traktConnected && <TraktTab />}
          {tab === "anilist" && anilistConnected && <AnilistTab />}
          {tab === "simkl" && simklConnected && <SimklTab />}
          {tab === "publicmetadb" && pmdbConnected && <PublicMetaDbTab />}
          {tab === "letterboxd" && lb.isActive && <LetterboxdTab />}
          {tab === "mal" && malConnected && <MalTab />}
        </div>
      </LibraryFeaturedProvider>
    </main>
  );
}

/**
 * Featured carousel above the tab bar, drawn from whatever the open tab is
 * showing. Hidden below two slides so a small or unhydrated tab doesn't render
 * a dead carousel.
 */
function LibraryHero({ tabKey }: { tabKey: Tab }) {
  const metas = useLibraryFeatured();
  const slides = useMemo(
    () => pickFeatured(metas, tabKey).map((meta) => ({ meta })),
    [metas, tabKey],
  );
  if (slides.length < 2) return null;
  return <HeroCarousel slides={slides} />;
}

function Header({
  tab,
  onTab,
  traktConnected,
  anilistConnected,
  malConnected,
  simklConnected,
  pmdbConnected,
  lbConnected,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  traktConnected: boolean;
  anilistConnected: boolean;
  malConnected: boolean;
  simklConnected: boolean;
  pmdbConnected: boolean;
  lbConnected: boolean;
}) {
  const t = useT();
  const { setView } = useView();
  const { settings, update } = useSettings();
  const tabsButtonRef = useRef<HTMLButtonElement>(null);
  const [tabsMenuOpen, setTabsMenuOpen] = useState(false);
  const hidden = useMemo(
    () => hiddenLibraryTabs(settings.libraryHiddenTabs),
    [settings.libraryHiddenTabs],
  );
  const toggleTab = (id: Tab) => {
    const next = toggleHiddenLibraryTab(hidden, id);
    update({ libraryHiddenTabs: next });
    if (id === tab && next.includes(id)) onTab("library");
  };
  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "library", label: t("Library"), icon: <Library size={14} strokeWidth={2.2} /> },
    { id: "watchlist", label: t("Watchlist"), icon: <Bookmark size={14} strokeWidth={2.2} /> },
    { id: "history", label: t("History"), icon: <Clock size={14} strokeWidth={2.2} /> },
    { id: "local", label: t("Local"), icon: <HardDrive size={14} strokeWidth={2.2} /> },
    {
      id: "media-servers",
      label: t("Media Servers"),
      icon: <Server size={14} strokeWidth={2.2} />,
    },
    {
      id: "torbox",
      label: "TorBox",
      icon: <img src={torboxLogo} alt="" className="h-3.5 w-3.5 object-contain" />,
    },
    { id: "lists", label: t("My Lists"), icon: <UiIcon name="list" className="h-3.5 w-3.5" /> },
    { id: "groups", label: t("My Groups"), icon: <UiIcon name="list" className="h-3.5 w-3.5" /> },
    { id: "favorites", label: t("Favorites"), icon: <Star size={14} strokeWidth={2.2} /> },
  ];
  if (traktConnected)
    tabs.push({
      id: "trakt",
      label: "Trakt",
      icon: <img src={traktLogo} alt="" className="h-3.5 w-3.5 object-contain" />,
    });
  if (anilistConnected)
    tabs.push({
      id: "anilist",
      label: "AniList",
      icon: <img src={anilistLogo} alt="" className="h-3.5 w-3.5 rounded-[3px] object-contain" />,
    });
  if (malConnected)
    tabs.push({ id: "mal", label: "MAL", icon: <MalLogo className="h-3.5 w-3.5" /> });
  if (simklConnected)
    tabs.push({
      id: "simkl",
      label: "Simkl",
      icon: <img src={simklLogo} alt="" className="h-3.5 w-3.5 object-contain" />,
    });
  if (pmdbConnected)
    tabs.push({
      id: "publicmetadb",
      label: "PMDB",
      icon: (
        <img src={publicmetadbLogo} alt="" className="h-3.5 w-3.5 rounded-[3px] object-contain" />
      ),
    });
  if (lbConnected)
    tabs.push({
      id: "letterboxd",
      label: "Letterboxd",
      icon: (
        <img src={letterboxdLogo} alt="" className="h-3.5 w-3.5 rounded-[3px] object-contain" />
      ),
    });
  return (
    <header className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.28em] text-ink-subtle">
            {t("My library")}
          </span>
          <h1 className="font-display text-[44px] font-medium leading-[1.05] text-ink">
            {t("Your collection.")}
          </h1>
          <p className="text-[14px] leading-snug text-ink-muted">
            {t(
              "Library is everything from Stremio, Trakt, and this device. Watchlist is only titles you haven't watched yet. History is what you've watched. Local is files on your computer.",
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4 self-center">
          <button
            ref={tabsButtonRef}
            type="button"
            onClick={() => setTabsMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={tabsMenuOpen}
            title={t("Choose which tabs appear in your library")}
            className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors ${
              tabsMenuOpen || hidden.size > 0 ? "text-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            <SlidersHorizontal size={15} strokeWidth={2} />
            {t("Tabs")}
          </button>
          <button
            type="button"
            onClick={() => update({ libraryHero: !settings.libraryHero })}
            title={t("Show a featured banner at the top of your library")}
            className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors ${
              settings.libraryHero ? "text-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            {settings.libraryHero ? (
              <Eye size={15} strokeWidth={2} />
            ) : (
              <EyeOff size={15} strokeWidth={2} />
            )}
            {t("Featured")}
          </button>
          {settings.wrappedButton && (
            <button
              type="button"
              onClick={() => setView("wrapped")}
              className="flex items-center gap-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
            >
              <BarChart3 size={15} strokeWidth={2} />
              {t("Stats")}
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-edge-soft [&>button]:shrink-0">
        {tabs
          .filter((entry) => isLibraryTabShown(entry.id, hidden, tab))
          .map((entry) => (
            <TabBtn key={entry.id} active={tab === entry.id} onClick={() => onTab(entry.id)}>
              {entry.icon}
              {entry.label}
            </TabBtn>
          ))}
      </div>
      <AnchoredMenu
        anchorRef={tabsButtonRef}
        open={tabsMenuOpen}
        onClose={() => setTabsMenuOpen(false)}
        width={240}
      >
        <div className="animate-menu-pop overflow-hidden rounded-md bg-elevated shadow-[0_18px_44px_-18px_rgba(0,0,0,0.85)]">
          <div className="px-3 pt-2.5 pb-1.5">
            <span className="text-[10.5px] font-medium uppercase tracking-wider text-ink-subtle">
              {t("Show tabs")}
            </span>
          </div>
          <div className="max-h-[352px] overflow-y-auto pb-1">
            {tabs
              .filter((entry) => entry.id !== "library")
              .map((entry) => {
                const shown = !hidden.has(entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={shown}
                    onClick={() => toggleTab(entry.id)}
                    className="flex min-h-[40px] w-full items-center gap-2.5 px-3 py-2 text-start text-[13px] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
                  >
                    <span
                      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] transition-colors ${
                        shown
                          ? "bg-accent text-canvas"
                          : "bg-canvas ring-1 ring-inset ring-edge-soft"
                      }`}
                    >
                      {shown && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="flex shrink-0 items-center">{entry.icon}</span>
                    <span className="flex-1 truncate">{entry.label}</span>
                  </button>
                );
              })}
          </div>
        </div>
      </AnchoredMenu>
    </header>
  );
}

void watchlistHas;
