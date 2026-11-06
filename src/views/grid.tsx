import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ListFilter } from "lucide-react";
import { BackToTop } from "@/components/back-to-top";
import { PickCard } from "@/components/pick-card";
import { TV_CARD_MIN } from "@/components/row";
import type { Meta } from "@/lib/cinemeta";
import { useT } from "@/lib/i18n";
import { layoutHasGlobalBack } from "@/lib/theme";
import { useSettings } from "@/lib/settings";
import { useScrollMemory, useView, type GridSpec } from "@/lib/view";

const PAGE_CAP = 40;

export function GridView({ grid }: { grid: GridSpec }) {
  const { goBack } = useView();
  const { settings } = useSettings();
  const t = useT();
  const scrollRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [metas, setMetas] = useState<Meta[]>(grid.initial ?? []);
  const [filterValue, setFilterValue] = useState(grid.filter?.initialValue ?? "");

  const filterOption = grid.filter?.options.find((option) => option.value === filterValue);
  const fetcher = filterOption?.fetcher ?? grid.fetcher;

  const initialPage =
    filterOption?.initialPage ??
    grid.initialPage ??
    ((filterOption?.initial ?? grid.initial)?.length ? 1 : 0);

  const [page, setPage] = useState(initialPage);
  const [done, setDone] = useState(initialPage >= PAGE_CAP);

  // Preview seeds are not complete pages. Provider offsets count raw results,
  // including duplicates, rather than the number of visible cards.
  const loadedRef = useRef(
    initialPage === 0 ? 0 : ((filterOption?.initial ?? grid.initial)?.length ?? 0),
  );
  const loadingRef = useRef(false);

  const changeFilter = (value: string) => {
    const option = grid.filter?.options.find((candidate) => candidate.value === value);
    const initial = option?.initial ?? [];
    const nextInitialPage = option?.initialPage ?? (initial.length > 0 ? 1 : 0);

    loadingRef.current = false;
    loadedRef.current = nextInitialPage === 0 ? 0 : initial.length;

    setFilterValue(value);
    setMetas(initial);
    setPage(nextInitialPage);
    setDone(nextInitialPage >= PAGE_CAP);

    scrollRef.current?.scrollTo({ top: 0 });
  };
  useScrollMemory(`grid:${grid.title}`, scrollRef);

  useEffect(() => {
    if (done) return;
    const el = sentinelRef.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingRef.current) return;
        loadingRef.current = true;
        const next = page + 1;
        fetcher(next, loadedRef.current)
          .then((batch) => {
            if (cancelled) return;
            setPage(next);
            loadedRef.current += batch.length;
            if (batch.length === 0 || next >= PAGE_CAP) setDone(true);
            const seen = new Set(metas.map((m) => m.id));
            const fresh = batch.filter((m) => {
              if (seen.has(m.id)) return false;
              seen.add(m.id);
              return true;
            });
            if (fresh.length > 0) setMetas((prev) => [...prev, ...fresh]);
          })
          .catch(() => {
            if (!cancelled) setDone(true);
          })
          .finally(() => {
            if (!cancelled) loadingRef.current = false;
          });
      },
      { rootMargin: "900px 0px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [fetcher, page, done, metas]);

  const hero = grid.kidsHero;
  const bgArt = metas.find((m) => m.background)?.background?.replace("/t/p/w780/", "/t/p/w1280/");

  const body = (
    <>
      <div
        className="grid gap-x-4 gap-y-8"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${
            settings.rowCardStyle === "tv" && !hero ? TV_CARD_MIN : 150
          }px, 1fr))`,
        }}
      >
        {metas.map((m, i) => (
          <PickCard key={`${m.id}-${i}`} meta={m} kids={!!hero} />
        ))}
      </div>
      {!done && <div ref={sentinelRef} className="h-24" />}
      {done &&
        metas.length === 0 &&
        (hero ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <img
              src="/kids/doodles/lilpurpocto.png"
              alt=""
              draggable={false}
              className="h-20 w-auto opacity-80"
            />
            <p className="font-display text-[24px] font-bold text-[#0e3a43]">
              {t("Nothing here yet!")}
            </p>
          </div>
        ) : (
          <p className="py-20 text-center text-[14px] text-ink-subtle">{t("Nothing here yet.")}</p>
        ))}
    </>
  );

  return (
    <main ref={scrollRef} className="absolute inset-0 z-30 overflow-y-auto bg-canvas">
      {hero ? (
        <>
          <section className="relative h-[66vh] min-h-[460px] w-full overflow-hidden">
            {bgArt ? (
              <img
                src={bgArt}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className={`absolute inset-0 bg-gradient-to-br ${hero.grad}`} />
            )}
            <div
              className={`pointer-events-none absolute inset-0 bg-gradient-to-tr ${hero.grad} opacity-25 mix-blend-overlay`}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/35 to-transparent" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/45 via-black/10 to-transparent" />
            <img
              src={hero.art}
              alt=""
              draggable={false}
              className="pointer-events-none absolute bottom-0 end-0 h-[56%] w-auto max-w-[30%] object-contain object-bottom drop-shadow-[0_14px_28px_rgba(0,0,0,0.4)]"
            />
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-2 px-12 pb-9">
              <h1 className="max-w-[62%] font-display text-[clamp(46px,7vw,88px)] font-extrabold leading-[0.92] tracking-tight text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.7)]">
                {hero.name}
              </h1>
              <p className="text-[18px] font-extrabold text-white/95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]">
                {metas.length} {metas.length === 1 ? t("title") : t("titles")}
              </p>
            </div>
          </section>
          <div className="flex w-full flex-col gap-8 px-12 pb-24 pt-6">{body}</div>
        </>
      ) : (
        <div className="flex w-full flex-col gap-8 px-12 pb-24 pt-24">
          <div className="flex items-center gap-4">
            {!layoutHasGlobalBack() && (
              <button
                onClick={goBack}
                aria-label={t("Back")}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-ink-muted transition-colors hover:text-ink"
              >
                <ArrowLeft size={18} strokeWidth={2.2} />
              </button>
            )}
            <h1 className="font-display text-[30px] font-medium leading-none tracking-tight text-ink">
              {grid.title}
            </h1>
            <span className="text-[14px] text-ink-subtle">
              {metas.length} {metas.length === 1 ? t("title") : t("titles")}
            </span>
            {grid.filter && grid.filter.options.length > 1 && (
              <label className="relative ms-auto flex h-10 items-center gap-2 rounded-full border border-edge-soft bg-elevated/40 ps-3.5 pe-9 text-[13.5px] font-semibold text-ink-muted transition-colors hover:border-edge hover:bg-elevated hover:text-ink">
                <ListFilter size={15} className="text-ink-subtle" />
                <span className="sr-only">{grid.filter.label}</span>
                <select
                  aria-label={grid.filter.label}
                  value={filterValue}
                  onChange={(event) => changeFilter(event.target.value)}
                  className="appearance-none bg-transparent pe-1 text-inherit outline-none"
                >
                  {grid.filter.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={15}
                  className="pointer-events-none absolute end-3.5 text-ink-subtle"
                />
              </label>
            )}
          </div>
          {body}
        </div>
      )}
      <BackToTop scrollRef={scrollRef} />
    </main>
  );
}
