/** Stable display/queue/notification identity; never guess a game from filenames. */
export function downloadIdentity(
  kind: "direct" | "torrent",
  record: {
    id: string;
    profile: string;
    game?: { id: string; contentKind?: string } | null;
    batchId?: string | null;
  },
): string {
  if (record.game?.id)
    return JSON.stringify([
      "game",
      record.profile,
      record.game.id,
      record.game.contentKind ?? "game",
    ]);
  if (kind === "direct" && record.batchId)
    return JSON.stringify(["batch", record.profile, record.batchId]);
  return JSON.stringify(["file", record.profile, kind, record.id]);
}
