import type { DownloadRequest, GameTransfer } from "./transfers";

export type ReplacementFile = DownloadRequest & { filename: string };
export const transferFilename = (record: GameTransfer) =>
  record.destination.split(/[\\/]/).at(-1) ?? "";
export function replacementFile(
  record: GameTransfer,
  request: DownloadRequest,
  filename: string,
  windows: boolean,
): ReplacementFile {
  const expected = transferFilename(record);
  const fold = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const sameName = windows ? fold(expected) === fold(filename) : expected === filename;
  if (
    !sameName ||
    request.sourceLink !== record.sourceLink ||
    (request.expectedBytes != null &&
      (request.expectedBytes <= 0 ||
        ((record.expectedBytes ?? record.total) != null &&
          request.expectedBytes !== (record.expectedBytes ?? record.total)))) ||
    (request.expectedSha256 &&
      record.expectedSha256 &&
      request.expectedSha256.toLowerCase() !== record.expectedSha256.toLowerCase())
  )
    throw Error("transfer_relink_mismatch");
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw Error("transfer_url");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw Error("transfer_url");
  return { ...request, filename };
}
export const transferStateKey = (record: GameTransfer) =>
  record.status === "checking" && record.checkingPartial != null
    ? "games.download.relink.checking"
    : `games.download.state.${record.status}`;
/** Transfer progress always measures bytes already saved on disk. During
 * refreshed-CDN verification the network rechecks those bytes but must not
 * make the previously downloaded portion appear to vanish. */
export const transferProgressBytes = (record: GameTransfer) => ({
  received: record.received,
  total: record.total,
});

/** Distinct temporary progress of comparing an existing partial file against
 * the new CDN source. This must never replace the stored download progress. */
export const transferVerificationBytes = (record: GameTransfer) =>
  record.status === "checking" && record.checkingPartial != null
    ? { received: Math.min(record.received, record.checkingPartial), total: record.received }
    : null;
