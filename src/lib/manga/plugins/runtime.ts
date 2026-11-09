import type { MangaProvider } from "../types";
import type { InstalledPlugin } from "./types";
import { PluginWorker } from "./worker-host";
import { toSummaries, toSummary, toChapters, toStrings, toTags } from "./adapter";

const workers = new Map<string, PluginWorker>();

function workerFor(p: InstalledPlugin, background = false): PluginWorker {
  const key = `${background ? "background:" : ""}${p.id}`;
  let w = workers.get(key);
  if (!w) {
    w = new PluginWorker(p, { httpPolicy: { background } });
    workers.set(key, w);
  }
  return w;
}

export function pluginProvider(p: InstalledPlugin, background = false): MangaProvider {
  const w = workerFor(p, background);
  const provider: MangaProvider = {
    id: p.id,
    name: p.name,
    popular: (offset, tagId) => w.call("popular", [offset, tagId], 20_000).then(toSummaries),
    search: (query, offset, tagId) =>
      w.call("search", [query, offset, tagId], 20_000).then(toSummaries),
    detail: (id) => w.call("detail", [id], 20_000).then(toSummary),
    chapters: (id) => w.call("chapters", [id], 25_000).then(toChapters),
    pageUrls: (chapterId) => w.call("pageUrls", [chapterId], 30_000).then(toStrings),
  };
  if (p.hasTags) provider.tags = () => w.call("tags", [], 15_000).then(toTags);
  return provider;
}

export function warmPlugin(p: InstalledPlugin): void {
  void workerFor(p)
    .meta()
    .catch(() => {});
}

export function disposePlugin(id: string): void {
  for (const key of [id, `background:${id}`]) {
    workers.get(key)?.dispose();
    workers.delete(key);
  }
}

export function disposeAllPlugins(): void {
  for (const w of workers.values()) w.dispose();
  workers.clear();
}
