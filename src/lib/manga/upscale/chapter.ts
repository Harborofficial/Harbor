import { chapterPages } from "../api";
import { pageHeadersFor } from "../plugins/adapter";
import { downloadedPages } from "../../manga-downloads";
import { isColorPage, readBlob } from "@/views/manga/manga-reader/manga-upscale";
import {
  cachedMangaPage,
  downloadMangaModel,
  mangaUpscaleStatus,
  retainMangaUpscaler,
  upscaleMangaPage,
} from "./index";
import {
  bestModelInstalled,
  cachedBestPage,
  downloadBestModel,
  retainBestUpscaler,
  upscaleBestPage,
} from "./best";
import { nearestBestHeight } from "./model";
import { MAX_GPU_PAGE_PIXELS } from "./eligibility";

type Options = {
  quality: "fast" | "best";
  autoDownload: boolean;
  sourceId?: string;
  isValid?: () => boolean;
};
const jobs = new Map<string, Promise<void>>();
let pending: Promise<void> = Promise.resolve();

/** Serial chapter jobs share the reader's stable cache keys and model workers. */
export function preUpscaleChapter(
  mangaId: string,
  chapterId: string,
  options: Options,
): Promise<void> {
  const id = JSON.stringify([mangaId, chapterId, options.sourceId, options.quality]);
  const existing = jobs.get(id);
  if (existing) return existing;
  const task = pending.then(async () => {
    const valid = () => {
      if (options.isValid && !options.isValid()) throw new Error("Chapter is no longer available");
    };
    valid();
    const resolvedId =
      chapterId.includes("::") || !options.sourceId
        ? chapterId
        : `${options.sourceId}::${chapterId}`;
    const pages = (await downloadedPages(chapterId)) ?? (await chapterPages(resolvedId));
    if (!pages.length) throw new Error("No chapter pages are available");
    const releaseFast = retainMangaUpscaler();
    const releaseBest = retainBestUpscaler();
    let bestHeight: number | undefined;
    try {
      for (let index = 0; index < pages.length; index++) {
        valid();
        const key = `${mangaId}:${chapterId}:${index}`;
        if (options.quality === "best" ? await cachedBestPage(key) : await cachedMangaPage(key))
          continue;
        const url = pages[index];
        const blob = await readBlob(url, pageHeadersFor(url));
        if (!blob) throw new Error(`Could not load page ${index + 1}`);
        const bitmap = await createImageBitmap(blob);
        try {
          if (bitmap.width * bitmap.height > MAX_GPU_PAGE_PIXELS)
            throw new Error(`Page ${index + 1} is too large to upscale`);
          valid();
          if (options.quality === "best" && !(await isColorPage(blob))) {
            bestHeight ??= nearestBestHeight(bitmap.height);
            if (!(await bestModelInstalled(bestHeight))) {
              if (!options.autoDownload)
                throw new Error("Install the manga upscale model in Reader settings first");
              await downloadBestModel(bestHeight);
            }
            valid();
            await upscaleBestPage(key, blob, bestHeight);
          } else {
            if (await cachedMangaPage(key)) continue;
            if (!(await mangaUpscaleStatus()).installed) {
              if (!options.autoDownload)
                throw new Error("Install the manga upscale model in Reader settings first");
              await downloadMangaModel();
            }
            valid();
            await upscaleMangaPage(key, bitmap);
          }
        } finally {
          bitmap.close();
        }
      }
    } finally {
      releaseFast();
      releaseBest();
    }
  });
  jobs.set(id, task);
  pending = task.catch(() => {});
  void task.finally(() => jobs.delete(id)).catch(() => {});
  return task;
}
