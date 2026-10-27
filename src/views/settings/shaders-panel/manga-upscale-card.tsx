import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { openUrl } from "@/lib/window";
import {
  clearMangaPages,
  downloadMangaModel,
  mangaUpscaleStatus,
  mangaUpscaleSupport,
  removeMangaModel,
  type MangaUpscaleStatus,
} from "@/lib/manga/upscale";
import { MANGA_UPSCALE_MODEL } from "@/lib/manga/upscale/model";
import {
  bestModelStatus,
  downloadBestModel,
  preferredBestHeight,
  removeBestModels,
  type BestModelStatus,
} from "@/lib/manga/upscale/best";
import { AlertTriangle, Download, ExternalLink, Loader2, Sparkles, Trash2 } from "../icons";
import { RowNote, Section, Segmented, ToggleRow } from "../shared";
import { Nested, ROW_ACTION, ROW_ACTION_PRIMARY, SettingRow } from "../kit";

export function MangaUpscaleCard() {
  const t = useT();
  const { settings, update } = useSettings();
  const [status, setStatus] = useState<MangaUpscaleStatus | null>(null);
  const [best, setBest] = useState<BestModelStatus>({ heights: [], bytes: 0 });
  const [bestBusy, setBestBusy] = useState<number | null>(null);
  const [support, setSupport] = useState<{ worker: boolean; webgpu: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await mangaUpscaleStatus());
    setBest(await bestModelStatus());
  }, []);

  useEffect(() => {
    void refresh();
    void mangaUpscaleSupport().then(setSupport);
  }, [refresh]);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadMangaModel();
      update({ mangaUpscaleEnabled: true });
      await refresh();
    } catch (e) {
      setError(
        typeof e === "string" ? e : t("Download failed. Check your connection and try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeMangaModel();
      update({ mangaUpscaleEnabled: false });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeHigh = async () => {
    setBusy(true);
    try {
      await removeBestModels();
      update({ mangaUpscaleQuality: "fast" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const downloadHigh = async () => {
    if (bestBusy !== null) return;
    const height = preferredBestHeight();
    setBestBusy(height);
    setError(null);
    try {
      await downloadBestModel(height);
      await refresh();
    } catch (e) {
      setError(
        typeof e === "string" ? e : t("Download failed. Check your connection and try again."),
      );
    } finally {
      setBestBusy(null);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await clearMangaPages();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const installed = !!status?.installed;
  const unsupported = support !== null && !support.worker;
  const slow =
    support !== null && support.worker && (!support.webgpu || status?.provider === "wasm");
  const preferredHeight = preferredBestHeight();
  const preferredInstalled = best.heights.includes(preferredHeight);

  return (
    <Section
      title={t("Manga upscaling")}
      subtitle={t(
        "Doubles small or stretched manga, manhwa and manhua pages so lines stay sharp while you read. Runs locally on your graphics card; nothing is uploaded.",
      )}
    >
      <div className="flex items-start gap-2.5 rounded-[10px] bg-elevated px-4 py-3">
        <AlertTriangle size={18} strokeWidth={2.2} className="mt-[2px] shrink-0 text-ink-subtle" />
        <p className="max-w-[66ch] text-[15.5px] leading-[22px] text-ink-muted">
          {t(
            "Upscaling can cause lag on slower graphics cards. If MangaJaNai lags, try Fast; if Fast still lags, turn upscaling off.",
          )}
        </p>
      </div>

      {!installed ? (
        <SettingRow
          label={t(MANGA_UPSCALE_MODEL.name)}
          icon={<Sparkles size={18} strokeWidth={2.2} />}
          desc={t(
            "waifu2x upconv7, 2.1 MB. Licensed MIT, downloaded from Hugging Face. One download, then it works offline.",
          )}
          warn={
            unsupported
              ? t("This device cannot run the upscaler.")
              : slow
                ? t("No WebGPU graphics found. Pages will upscale on the CPU and take longer.")
                : undefined
          }
        >
          <button
            type="button"
            onClick={() => {
              if (!busy && !unsupported) void install();
            }}
            aria-busy={busy}
            disabled={busy || unsupported}
            className={ROW_ACTION_PRIMARY}
          >
            {busy ? (
              <Loader2 size={17} className="animate-spin motion-reduce:hidden" />
            ) : (
              <Download size={17} strokeWidth={2.2} />
            )}
            {busy ? t("Downloading…") : t("Download model")}
          </button>
        </SettingRow>
      ) : (
        <ToggleRow
          label={t("Upscale manga pages")}
          leading={<Sparkles size={18} strokeWidth={2.2} />}
          sub={t(
            "Only pages the browser is stretching. Each page is processed once and cached, so scrolling back is instant.",
          )}
          value={settings.mangaUpscaleEnabled}
          onChange={(v) => update({ mangaUpscaleEnabled: v })}
          warn={
            slow
              ? t("No WebGPU graphics found. Pages will upscale on the CPU and take longer.")
              : undefined
          }
        />
      )}

      {installed && settings.mangaUpscaleEnabled && (
        <SettingRow
          label={t("Upscaling model")}
          desc={t(
            "Fast is instant. MangaJaNai is slower but keeps lines and screentone closer to print. Color pages, including most manhwa and manhua, use the fast model.",
          )}
          wide
          warn={
            !preferredInstalled ? t("Download the MangaJaNai model below to use it.") : undefined
          }
        >
          <Segmented
            value={settings.mangaUpscaleQuality}
            options={[
              { value: "fast", label: t("Fast") },
              { value: "best", label: t("MangaJaNai") },
            ]}
            onChange={(v) => {
              if (v === "best" && !preferredInstalled) return;
              update({ mangaUpscaleQuality: v });
            }}
          />
        </SettingRow>
      )}

      <Nested>
        {error && <RowNote>{error}</RowNote>}

        {installed && (
          <>
            <SettingRow
              label={t("Fast 2x model")}
              desc={
                <span className="flex flex-col gap-1">
                  <span>{t("{name} · 2.1 MB · MIT", { name: MANGA_UPSCALE_MODEL.name })}</span>
                  {status?.provider && (
                    <span>
                      {t("Running on {provider}", {
                        provider: status.provider === "webgpu" ? "WebGPU" : "CPU",
                      })}
                    </span>
                  )}
                </span>
              }
            >
              <button
                type="button"
                onClick={() => {
                  if (!busy) void remove();
                }}
                disabled={busy}
                className={ROW_ACTION}
              >
                <Trash2 size={17} strokeWidth={2.2} />
                {t("Remove")}
              </button>
            </SettingRow>
          </>
        )}

        {(installed || best.heights.length > 0) && (
          <SettingRow
            label={t("MangaJaNai 2x")}
            desc={
              bestBusy !== null
                ? t("Downloading {height}p · 64 MB…", { height: bestBusy })
                : best.heights.length
                  ? `${best.heights.map((height) => `${height}p`).join(", ")} · ${Math.round(best.bytes / 1048576)} MB`
                  : t(
                      "One 64 MB model per page height. Download it once to unlock MangaJaNai quality.",
                    )
            }
          >
            <span className="flex items-center gap-2">
              {installed && !preferredInstalled && (
                <button
                  type="button"
                  onClick={() => {
                    if (bestBusy === null && !busy) void downloadHigh();
                  }}
                  disabled={bestBusy !== null || busy}
                  aria-busy={bestBusy !== null}
                  className={ROW_ACTION_PRIMARY}
                >
                  {bestBusy !== null ? (
                    <Loader2 size={17} className="animate-spin motion-reduce:hidden" />
                  ) : (
                    <Download size={17} strokeWidth={2.2} />
                  )}
                  {bestBusy !== null
                    ? t("Downloading…")
                    : t("Download {height}p", { height: preferredHeight })}
                </button>
              )}
              {best.heights.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (!busy && bestBusy === null) void removeHigh();
                  }}
                  disabled={busy || bestBusy !== null}
                  className={ROW_ACTION}
                >
                  <Trash2 size={17} strokeWidth={2.2} />
                  {t("Remove")}
                </button>
              )}
            </span>
          </SettingRow>
        )}

        {best.heights.length > 0 && (
          <ToggleRow
            label={t("Download missing models")}
            sub={t(
              "When a page needs a height you have not downloaded, fetch that MangaJaNai model (64 MB) in the background.",
            )}
            value={settings.mangaUpscaleAutoDownload}
            onChange={(v) => update({ mangaUpscaleAutoDownload: v })}
          />
        )}

        {installed && (
          <SettingRow
            label={t("Cached pages")}
            desc={
              status?.bestPages
                ? t("{count} pages, {best} at high quality.", {
                    count: status?.pages ?? 0,
                    best: status.bestPages,
                  })
                : t("{count} upscaled pages stored on this device.", {
                    count: status?.pages ?? 0,
                  })
            }
          >
            <button
              type="button"
              onClick={() => {
                if (!busy) void clear();
              }}
              disabled={busy || (status?.pages ?? 0) + (status?.bestPages ?? 0) === 0}
              className={ROW_ACTION}
            >
              {t("Clear")}
            </button>
          </SettingRow>
        )}

        <button
          type="button"
          className="flex min-h-11 w-fit items-center gap-2 text-start text-[14px] text-ink-muted hover:text-ink"
          onClick={() => openUrl(MANGA_UPSCALE_MODEL.source)}
        >
          <span>{t("Source")}: lookx2/waifu2x_upconv7</span>
          <ExternalLink size={15} className="shrink-0" />
        </button>
        <button
          type="button"
          className="flex min-h-11 w-fit items-center gap-2 text-start text-[14px] text-ink-muted hover:text-ink"
          onClick={() => openUrl("https://github.com/the-database/mangajanai")}
        >
          <span>{t("High-quality model")}: MangaJaNai · CC BY-NC 4.0</span>
          <ExternalLink size={15} className="shrink-0" />
        </button>
      </Nested>
    </Section>
  );
}
