import type { CloudDownload } from "./cloud-files";
import type { GameTransfer } from "./transfers";

/** TorBox temporary links are not permanent transfer identities.
 * Never infer a match from the signed URL, game title, or filename alone. */
const CDN_SUFFIX = ".tb-cdn.pw";
export function torboxFailedLink(record: GameTransfer): boolean {
  if (
    record.status !== "failed" ||
    !["transfer_http", "transfer_access", "transfer_missing", "transfer_not_file"].includes(
      record.error ?? "",
    )
  )
    return false;
  try {
    const url = new URL(record.url);
    return (
      url.protocol === "https:" &&
      (url.hostname === "tb-cdn.pw" || url.hostname.endsWith(CDN_SUFFIX))
    );
  } catch {
    return false;
  }
}

export type SourceFile = {
  kind?: "torrent" | "web";
  parent: string;
  file: string;
  name: string;
  bytes: number;
};
export type RecoveryCandidate = { record: GameTransfer; source: SourceFile };

/** Never match an unverified size. Two entries with the same name and size
 * require a unique originating torrent, determined from other files of the
 * same game or download batch, otherwise recovery is skipped. */
export function matchTorboxTransfers(
  records: readonly GameTransfer[],
  files: readonly SourceFile[],
): RecoveryCandidate[] {
  const sizes = new Map<string, SourceFile[]>();
  const matchKey = (name: string, bytes: number) =>
    JSON.stringify([name.toLocaleLowerCase(), bytes]);
  for (const file of files) {
    if (!file.parent || !file.file || !Number.isSafeInteger(file.bytes) || file.bytes <= 0)
      continue;
    const key = matchKey(file.name.split(/[\\/]/).at(-1) ?? "", file.bytes);
    sizes.set(key, [...(sizes.get(key) ?? []), file]);
  }
  const byGroup = new Map<string, GameTransfer[]>();
  for (const record of records) {
    const group = record.game?.id
      ? JSON.stringify(["game", record.profile, record.game.id, record.game.contentKind ?? "game"])
      : record.batchId
        ? JSON.stringify(["batch", record.profile, record.batchId])
        : JSON.stringify(["file", record.profile, record.id]);
    byGroup.set(group, [...(byGroup.get(group) ?? []), record]);
  }
  const result: RecoveryCandidate[] = [];
  for (const group of byGroup.values()) {
    const seen: Array<{ record: GameTransfer; options: SourceFile[] }> = [];
    const score = new Map<string, Set<string>>();
    for (const record of group) {
      const bytes = record.expectedBytes ?? record.total;
      if (bytes == null || bytes <= 0) continue;
      const name = record.destination.split(/[\\/]/).at(-1) ?? "";
      const options = sizes.get(matchKey(name, bytes)) ?? [];
      if (!options.length) continue;
      seen.push({ record, options });
      for (const source of options) {
        const set = score.get(source.parent) ?? new Set<string>();
        set.add(record.id);
        score.set(source.parent, set);
      }
    }
    const ordered = [...score.entries()].sort((a, b) => b[1].size - a[1].size);
    const best = ordered[0];
    const uniqueTorrent =
      best && best[1].size > 1 && (ordered.length === 1 || best[1].size > ordered[1][1].size)
        ? best[0]
        : null;
    for (const { record, options } of seen) {
      if (!torboxFailedLink(record)) continue;
      // A unique file across all listed torrents is already unambiguous.
      const unique =
        options.length === 1
          ? options[0]
          : uniqueTorrent
            ? options.filter((source) => source.parent === uniqueTorrent)[0]
            : null;
      if (!unique || options.filter((source) => source.parent === unique.parent).length !== 1)
        continue;
      result.push({ record, source: unique });
    }
  }
  // Never reuse one remote file for two different local games. A basename
  // plus size alone is not enough to prove two transfers share the same data.
  const counts = new Map<string, number>();
  const identity = (entry: RecoveryCandidate) =>
    JSON.stringify([entry.source.kind ?? "torrent", entry.source.parent, entry.source.file]);
  for (const entry of result) counts.set(identity(entry), (counts.get(identity(entry)) ?? 0) + 1);
  return result.filter((entry) => counts.get(identity(entry)) === 1);
}

type Client = {
  catalog(): Promise<SourceFile[]>;
  resolve(kind: "torrent" | "web", parent: string, file: string): Promise<CloudDownload>;
  relink(record: GameTransfer, file: CloudDownload): Promise<void>;
};

/** Bounded authenticated TorBox discovery. No API key, token, or signed URL
 * is persisted; the caller supplies the user's currently connected key.
 * The existing native relink function verifies saved bytes before appending. */
export async function recoverTorboxDownloads(
  records: readonly GameTransfer[],
  client: Client,
): Promise<{ recovered: number; unmatched: number }> {
  const failed = records.filter(torboxFailedLink);
  if (!failed.length) return { recovered: 0, unmatched: 0 };
  let recovered = 0;
  const legacy: GameTransfer[] = [];
  const verified = async (
    record: GameTransfer,
    source: Pick<SourceFile, "parent" | "file" | "kind">,
  ) => {
    try {
      const fresh = await client.resolve(source.kind ?? "torrent", source.parent, source.file);
      const name = record.destination.split(/[\\/]/).at(-1) ?? "";
      if (
        fresh.name.split(/[\\/]/).at(-1)?.toLocaleLowerCase() !== name.toLocaleLowerCase() ||
        fresh.expectedBytes !== (record.expectedBytes ?? record.total)
      )
        return false;
      await client.relink(record, fresh);
      return true;
    } catch {
      return false;
    }
  };
  for (const record of failed) {
    const origin = record.torboxOrigin;
    if (
      origin?.torrentId &&
      origin.fileId &&
      /^\d+$/.test(origin.torrentId) &&
      /^\d+$/.test(origin.fileId)
    ) {
      if (
        await verified(record, {
          kind: origin.kind === "web" ? "web" : "torrent",
          parent: origin.torrentId,
          file: origin.fileId,
        })
      )
        recovered++;
    } else legacy.push(record);
  }
  if (!legacy.length) return { recovered, unmatched: failed.length - recovered };
  // A single bounded native scan includes BOTH TorBox torrents and web jobs.
  // All pages are scanned before any file is judged unique. The native API
  // deliberately rejects truncated catalogs rather than guessing.
  const files = await client.catalog();
  const found = matchTorboxTransfers(legacy, files);
  for (const { record, source } of found) {
    if (await verified(record, source)) recovered++;
  }
  return { recovered, unmatched: failed.length - recovered };
}
