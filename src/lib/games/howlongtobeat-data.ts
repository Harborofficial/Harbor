/** HowLongToBeat's unofficial search result, validated before it reaches the UI. */
export type HowLongToBeatTimes = {
  id: number;
  name: string;
  main?: number;
  extras?: number;
  complete?: number;
  url: string;
};

type SearchRow = Record<string, unknown>;
const record = (value: unknown): value is SearchRow =>
  !!value && typeof value === "object" && !Array.isArray(value);
const normalized = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
const time = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 10_000_000
    ? value
    : undefined;

/** Never choose a loose top result: remasters, DLC and sequels often share a prefix. */
export function parseHowLongToBeatSearch(
  value: unknown,
  title: string,
  releaseYear?: number,
): HowLongToBeatTimes | null {
  if (!record(value) || !Array.isArray(value.data) || !normalized(title)) return null;
  const wanted = normalized(title);
  const year =
    releaseYear && Number.isSafeInteger(releaseYear) && releaseYear > 1970
      ? releaseYear
      : undefined;
  const matches = value.data.flatMap((item: unknown) => {
    if (
      !record(item) ||
      !Number.isSafeInteger(item.game_id) ||
      (item.game_id as number) <= 0 ||
      typeof item.game_name !== "string"
    )
      return [];
    const id = item.game_id as number,
      name = item.game_name as string;
    const aliases = typeof item.game_alias === "string" ? item.game_alias.split(/[\n;]+/) : [];
    const names = [name, ...aliases].map(normalized).filter(Boolean);
    const exact = names.includes(wanted);
    const rowYear =
      typeof item.release_world === "number" && Number.isSafeInteger(item.release_world)
        ? item.release_world
        : undefined;
    // A partial title is acceptable only with release-year corroboration. Without
    // this, "Elden Ring" can accidentally resolve to "Elden Ring: Nightreign".
    const near =
      !exact &&
      !!year &&
      !!rowYear &&
      Math.abs(year - rowYear) <= 1 &&
      wanted.length >= 12 &&
      names.some(
        (candidate) => candidate.startsWith(`${wanted} `) && candidate.length - wanted.length <= 24,
      );
    if (!exact && !near) return [];
    if (year && rowYear && Math.abs(year - rowYear) > 2) return [];
    const main = time(item.comp_main),
      extras = time(item.comp_plus),
      complete = time(item.comp_100);
    if (!main && !extras && !complete) return [];
    const kind = typeof item.game_type === "string" ? item.game_type : "game";
    if (!exact && kind !== "game") return [];
    return [
      {
        exact,
        yearDelta: year && rowYear ? Math.abs(year - rowYear) : 0,
        times: { id, name, main, extras, complete, url: `https://howlongtobeat.com/game/${id}` },
      },
    ];
  });
  matches.sort((a, b) => Number(b.exact) - Number(a.exact) || a.yearDelta - b.yearDelta);
  if (!matches.length) return null;
  // If two editions are equally plausible, refuse to display an arbitrary one.
  if (
    matches.length > 1 &&
    matches[0]!.exact === matches[1]!.exact &&
    matches[0]!.yearDelta === matches[1]!.yearDelta
  )
    return null;
  return matches[0]!.times;
}
