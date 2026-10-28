import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, LayoutGrid, List } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { useScrollMemory, useView } from "@/lib/view";
import { layoutHasGlobalBack } from "@/lib/theme";
import type { Meta } from "@/lib/cinemeta";
import { tmdbDiscover, tmdbCollection } from "@/lib/providers/tmdb";
import { fetchTraktList } from "@/lib/trakt/lists";
import { hydrateTraktItems } from "@/lib/trakt/hydrate";
import { BackToTop } from "@/components/back-to-top";
import { PickCard } from "@/components/pick-card";
import { Row, usePosterRow, TV_CARD_MIN } from "@/components/row";
import {
  folderLayout,
  tmdbSourceParams,
  updateSourceFolder,
  type NativeSource,
  type SourceFolder,
} from "@/lib/custom-sources";
import { gatherCatalogAddons, createAddonCatalogFetcher } from "@/lib/addons";
import { useT } from "@/lib/i18n";

const PAGE_CAP = 40;

type HubSource = {
  id: string;
  title: string;
  fetcher: (page: number, loaded?: number) => Promise<Meta[]>;
};

function nativeFetcher(source: NativeSource, tmdbKey: string | undefined) {
  if (source.provider === "tmdb") {
    return async (page: number): Promise<Meta[]> => {
      if (!tmdbKey) return [];
      if (source.tmdbSourceType === "COLLECTION" && source.tmdbId) {
        if (page > 1) return [];
        const collection = await tmdbCollection(tmdbKey, Number(source.tmdbId));
        return collection?.parts || [];
      }
      if (source.tmdbSourceType === "DISCOVER" || source.tmdbSourceType === "COMPANY") {
        return tmdbDiscover(
          tmdbKey,
          source.mediaType.toLowerCase() as "movie" | "tv",
          tmdbSourceParams(source, page),
        );
      }
      return [];
    };
  }
  if (source.provider === "trakt" && source.traktListId) {
    return async (page: number): Promise<Meta[]> => {
      if (!tmdbKey) return [];
      const items = await fetchTraktList(source.traktListId!, page, 20);
      return hydrateTraktItems(items, tmdbKey);
    };
  }
  return null;
}

function FolderHubGridTab({ fetcher }: { fetcher: HubSource["fetcher"] }) {
  const { settings } = useSettings();
  const [metas, setMetas] = useState<Meta[]>([]);
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(false);
  const loadedRef = useRef(0);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (done) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingRef.current) return;
        loadingRef.current = true;
        const next = page + 1;
        fetcher(next, loadedRef.current)
          .then((batch) => {
            setPage(next);
            loadedRef.current += batch.length;
            if (batch.length === 0 || next >= PAGE_CAP) {
              setDone(true);
              return;
            }
            setMetas((prev) => {
              const seen = new Set(prev.map((m) => m.id));
              return [...prev, ...batch.filter((m) => !seen.has(m.id))];
            });
          })
          .catch(() => setDone(true))
          .finally(() => {
            loadingRef.current = false;
          });
      },
      { rootMargin: "900px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [fetcher, page, done]);

  return (
    <>
      <div
        className="grid gap-x-4 gap-y-8"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${
            settings.rowCardStyle === "tv" ? TV_CARD_MIN : 150
          }px, 1fr))`,
        }}
      >
        {metas.map((m, i) => (
          <PickCard key={`${m.id}-${i}`} meta={m} />
        ))}
      </div>
      {!done && <div ref={sentinelRef} className="h-24 w-full" />}
      {done && metas.length === 0 && (
        <p className="py-20 text-center text-[14px] text-ink-subtle">{t("Nothing here yet!")}</p>
      )}
    </>
  );
}

function FolderHubTabs({
  active,
  options,
  onChange,
}: {
  active: string | null;
  options: HubSource[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex w-full items-center gap-6 overflow-x-auto border-b border-edge-soft pb-2">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`shrink-0 text-[15px] font-medium transition-colors hover:text-ink ${
            active === o.id ? "text-ink" : "text-ink-subtle"
          }`}
        >
          {o.title}
          {active === o.id && <div className="mt-2 h-0.5 w-full rounded-t-full bg-ink" />}
        </button>
      ))}
    </div>
  );
}

function FolderHubRow({ source, scrollKey }: { source: HubSource; scrollKey: string }) {
  const { openGrid } = useView();
  const sizing = usePosterRow(148);
  const [items, setItems] = useState<Meta[] | null>(null);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    let active = true;
    source
      .fetcher(1, 0)
      .then((res) => {
        if (active) setItems(res || []);
      })
      .catch(() => {
        if (active) setItems([]);
      });
    return () => {
      active = false;
    };
  }, [source, inView]);

  if (items === null) {
    return (
      <div ref={containerRef}>
        <Row {...sizing} title={source.title} scrollKey={scrollKey} alwaysActive>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`${
                sizing.shape === "landscape" ? "aspect-[16/9]" : "aspect-[2/3]"
              } rounded-xl bg-elevated/35 animate-pulse`}
            />
          ))}
        </Row>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <Row
      {...sizing}
      title={source.title}
      scrollKey={scrollKey}
      onViewAll={() => openGrid({ title: source.title, fetcher: source.fetcher, initial: items })}
    >
      {items.map((m) => (
        <PickCard key={m.id} meta={m} />
      ))}
    </Row>
  );
}

export function FolderHubView({
  folder,
  sourceId,
  active = true,
}: {
  folder: SourceFolder;
  sourceId: string;
  active?: boolean;
}) {
  const { goBack } = useView();
  const { settings, update } = useSettings();
  const { authKey } = useAuth();
  const t = useT();
  const scrollRef = useRef<HTMLElement>(null);
  useScrollMemory(`folder-hub:${sourceId}:${folder.id}`, scrollRef, active);

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const layout =
    folderLayout(settings.homeRows.customSources, sourceId, folder.id) ??
    folder.layout ??
    "CLASSIC";

  const sources = useMemo<HubSource[]>(() => {
    const tmdbKey = settings.tmdbKey;
    const out: HubSource[] = [];
    let addons: ReturnType<typeof gatherCatalogAddons> | null = null;
    const loadAddons = () => (addons ??= gatherCatalogAddons(authKey));
    folder.sources?.forEach((source, index) => {
      const fetcher = nativeFetcher(source, tmdbKey);
      if (fetcher) {
        out.push({ id: `native-${index}`, title: source.title || folder.title, fetcher });
      }
    });
    folder.catalogSources?.forEach((source, index) => {
      out.push({
        id: `catalog-${index}`,
        title: source.catalogId,
        fetcher: async (page, loaded) => {
          const addon = (await loadAddons()).find((a) => a.manifest.id === source.addonId);
          if (!addon) return [];
          return createAddonCatalogFetcher({
            base: addon.transportUrl.replace(/\/manifest\.json$/, ""),
            type: source.type,
            id: source.catalogId,
          })(page, loaded);
        },
      });
    });
    return out;
  }, [folder, settings.tmdbKey, authKey]);

  const currentTab = activeTab ?? sources[0]?.id ?? null;
  const currentSource = sources.find((s) => s.id === currentTab) ?? sources[0] ?? null;

  const changeLayout = (next: "CLASSIC" | "GRID") => {
    update({
      homeRows: {
        ...settings.homeRows,
        customSources: updateSourceFolder(settings.homeRows.customSources, sourceId, folder.id, {
          layout: next,
        }),
      },
    });
  };

  return (
    <main ref={scrollRef} className="absolute inset-0 z-30 overflow-y-auto bg-canvas">
      {(folder.focusGifUrl || folder.coverImageUrl) && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[70vh] min-h-[400px] overflow-hidden">
          <img
            src={folder.focusGifUrl || folder.coverImageUrl || undefined}
            alt=""
            draggable={false}
            className={`absolute inset-0 h-full w-full object-cover saturate-[1.5] ${
              folder.focusGifUrl ? "opacity-40 blur-sm" : "opacity-25 blur-[80px]"
            }`}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/60 to-transparent" />
        </div>
      )}

      <div className="relative z-10 flex w-full flex-col gap-10 px-10 pb-24 pt-24 md:px-12">
        <div className="flex items-center gap-4">
          {!layoutHasGlobalBack() && (
            <button
              onClick={() => goBack()}
              aria-label={t("Back")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-elevated text-ink-muted transition-colors hover:text-ink"
            >
              <ArrowLeft size={18} strokeWidth={2.2} />
            </button>
          )}
          <h1 className="line-clamp-1 font-display text-[32px] font-medium leading-none tracking-tight text-ink drop-shadow-sm">
            {folder.title}
          </h1>
          <div className="flex-1" />
          <button
            onClick={() => changeLayout("CLASSIC")}
            aria-label={t("Classic layout")}
            aria-pressed={layout === "CLASSIC"}
            className={`rounded-md p-1.5 transition-colors ${
              layout === "CLASSIC" ? "bg-ink text-canvas" : "text-ink-subtle hover:text-ink"
            }`}
          >
            <List size={18} />
          </button>
          <button
            onClick={() => changeLayout("GRID")}
            aria-label={t("Grid layout")}
            aria-pressed={layout === "GRID"}
            className={`rounded-md p-1.5 transition-colors ${
              layout === "GRID" ? "bg-ink text-canvas" : "text-ink-subtle hover:text-ink"
            }`}
          >
            <LayoutGrid size={18} />
          </button>
        </div>

        {sources.length === 0 ? (
          <p className="py-20 text-center text-[14px] text-ink-subtle">{t("Nothing here yet!")}</p>
        ) : layout === "GRID" ? (
          <div className="flex flex-col gap-6">
            {sources.length > 1 && (
              <FolderHubTabs
                active={currentSource?.id ?? null}
                options={sources}
                onChange={setActiveTab}
              />
            )}
            {currentSource && (
              <FolderHubGridTab key={currentSource.id} fetcher={currentSource.fetcher} />
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-12">
            {sources.map((source) => (
              <FolderHubRow
                key={source.id}
                source={source}
                scrollKey={`folder-hub:${folder.id}:${source.id}`}
              />
            ))}
          </div>
        )}
      </div>

      <BackToTop scrollRef={scrollRef} />
    </main>
  );
}
