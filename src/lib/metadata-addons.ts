import type { Addon } from "./addons";
import type { Meta } from "./cinemeta";
import { addonConfigurationKey } from "./addon-configuration-key";
import { applyOrderToItems, loadDisplayOrder } from "./addons-store/reorder";

export function providesMetadata(addon: Addon): boolean {
  return (addon.manifest.resources ?? []).some((r) =>
    typeof r === "string" ? r === "meta" : r.name === "meta",
  );
}

export function metadataAddonKey(addon: Addon): string {
  return addonConfigurationKey(addon.transportUrl) ?? addon.manifest.id;
}

export function readMetadataAddonOrder(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem("harbor.settings") ?? "{}").metadataAddonOrder;
    return Array.isArray(value)
      ? value.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

export function orderedMetadataAddons(addons: Addon[], order = readMetadataAddonOrder()): Addon[] {
  const seen = new Set<string>();
  const items = applyOrderToItems(addons, loadDisplayOrder()).filter((addon) => {
    if (!providesMetadata(addon)) return false;
    const key = metadataAddonKey(addon);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rank = new Map(order.map((key, i) => [key, i]));
  return items.sort(
    (a, b) =>
      (rank.get(metadataAddonKey(a)) ?? Infinity) - (rank.get(metadataAddonKey(b)) ?? Infinity),
  );
}

function missing(value: unknown): boolean {
  return (
    value == null ||
    (typeof value === "string" && !value.trim()) ||
    (Array.isArray(value) && value.length === 0)
  );
}

type SeasonRecord = NonNullable<Meta["seasons"]>[number];

function seasonNumber(season: SeasonRecord): number | null {
  const value = season.season ?? season.number ?? season.seasonNumber;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function fillMissingSeason(target: SeasonRecord, fallback: SeasonRecord): SeasonRecord {
  const merged = { ...target } as Record<string, unknown>;
  for (const [key, value] of Object.entries(fallback)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (missing(merged[key]) && !missing(value)) merged[key] = value;
  }
  return merged as SeasonRecord;
}

function mergeSeasons(primary: SeasonRecord[], fallback: SeasonRecord[]): SeasonRecord[] {
  const merged = primary.map((season) => ({ ...season }));
  const byNumber = new Map<number, number>();
  merged.forEach((season, index) => {
    const number = seasonNumber(season);
    if (number != null) byNumber.set(number, index);
  });
  for (const season of fallback) {
    const number = seasonNumber(season);
    const index = number == null ? undefined : byNumber.get(number);
    if (index == null) {
      merged.push({ ...season });
      if (number != null) byNumber.set(number, merged.length - 1);
    } else {
      merged[index] = fillMissingSeason(merged[index], season);
    }
  }
  return merged;
}

const SEASON_MAPS = new Set(["seasonPosters", "seasonBackdrops", "seasonOverviews"]);

function mergeSeasonMap(primary: unknown, fallback: unknown): unknown {
  if (!primary || typeof primary !== "object" || !fallback || typeof fallback !== "object") {
    return primary;
  }
  const merged = { ...(primary as Record<string, unknown>) };
  for (const [key, value] of Object.entries(fallback as Record<string, unknown>)) {
    if (missing(merged[key]) && !missing(value)) merged[key] = value;
  }
  return merged;
}

export function fillMissingMetadata(primary: Meta, fallback: Meta): Meta {
  const merged = { ...primary } as Record<string, unknown>;
  for (const [key, value] of Object.entries(fallback)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (key === "seasons" && Array.isArray(merged[key]) && Array.isArray(value)) {
      merged[key] = mergeSeasons(merged[key] as SeasonRecord[], value as SeasonRecord[]);
    } else if (SEASON_MAPS.has(key) && merged[key] && value) {
      merged[key] = mergeSeasonMap(merged[key], value);
    } else if (missing(merged[key]) && !missing(value)) {
      merged[key] = value;
    }
  }
  return merged as Meta;
}

export function hasNeededMetadata(meta: Meta, requireVideos: boolean): boolean {
  return (
    [meta.name, meta.description, meta.poster, meta.background, meta.logo].every(
      (v) => !missing(v),
    ) &&
    (!requireVideos || !missing(meta.videos))
  );
}
