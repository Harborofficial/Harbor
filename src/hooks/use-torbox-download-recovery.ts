import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GameTransfers } from "./use-game-transfers";
import type { CloudDownload } from "@/lib/games/cloud-files";
import {
  recoverTorboxDownloads,
  torboxFailedLink,
  type SourceFile,
} from "@/lib/games/torbox-download-recovery";
import type { GameTransfer } from "@/lib/games/transfers";

export type TorboxRecoveryStatus = {
  phase: "idle" | "running" | "finished" | "error";
  recovered: number;
  unmatched: number;
  error: string | null;
  retry: () => void;
};
/** Runs in the Games workspace, even when the user is browsing Sources or
 * Library rather than the Downloads tab. Never persists API credentials. */
export function useTorboxDownloadRecovery(
  downloads: GameTransfers,
  apiKey: string | undefined,
  active: boolean,
) {
  const profile = downloads.profile;
  const key = apiKey?.trim() ?? "";
  const attempted = useRef(new Set<string>());
  const pending = useRef(false);
  const scope = useRef({ profile, key });
  const relink = useRef(downloads.relink);
  const refresh = useRef(downloads.refresh);
  const alive = useRef(true);
  relink.current = downloads.relink;
  refresh.current = downloads.refresh;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [revision, setRevision] = useState(0);
  const [outcome, setOutcome] = useState<Omit<TorboxRecoveryStatus, "retry">>({
    phase: "idle",
    recovered: 0,
    unmatched: 0,
    error: null,
  });
  const retry = () => {
    if (pending.current) return;
    attempted.current.clear();
    setOutcome({ phase: "idle", recovered: 0, unmatched: 0, error: null });
    setRevision((value) => value + 1);
  };
  if (scope.current.profile !== profile || scope.current.key !== key) {
    scope.current = { profile, key };
    attempted.current.clear();
  }
  const failed = downloads.records.filter(torboxFailedLink);
  const signature = failed
    .map((record) => record.id)
    .sort()
    .join("|");
  useEffect(() => {
    if (!active || !key || downloads.loading || !failed.length || pending.current) return;
    const outstanding = failed.filter((record) => !attempted.current.has(record.id));
    if (!outstanding.length) return;
    for (const record of outstanding) attempted.current.add(record.id);
    pending.current = true;
    setOutcome({ phase: "running", recovered: 0, unmatched: outstanding.length, error: null });
    const args = { provider: "tb", key };
    const client = {
      catalog: () => invoke<SourceFile[]>("games_cloud_tb_recovery_catalog", { args }),
      resolve: (kind: "torrent" | "web", parent: string, file: string) =>
        invoke<CloudDownload>(
          kind === "web" ? "games_cloud_web_download" : "games_cloud_download",
          {
            args: { ...args, parent, file },
          },
        ),
      relink: async (record: GameTransfer, value: CloudDownload) => {
        if (!alive.current || scope.current.profile !== profile || scope.current.key !== key)
          throw Error("transfer_profile");
        await relink.current(record, {
          url: value.url,
          filename: record.destination.split(/[\\/]/).at(-1) ?? "",
          sourceLink: record.sourceLink,
          expectedBytes: value.expectedBytes ?? undefined,
        });
      },
    };
    void recoverTorboxDownloads(downloads.records, client)
      .then((result) => {
        if (alive.current && scope.current.profile === profile && scope.current.key === key)
          setOutcome({
            phase: "finished",
            recovered: result.recovered,
            unmatched: result.unmatched,
            error: null,
          });
        if (
          alive.current &&
          scope.current.profile === profile &&
          scope.current.key === key &&
          result.recovered
        )
          void refresh.current();
      })
      .catch((error) => {
        const message = String(error instanceof Error ? error.message : error);
        const code = /^cloud_[a-z_]+$/.test(message) ? message : "cloud_network";
        if (alive.current && scope.current.profile === profile && scope.current.key === key)
          setOutcome({ phase: "error", recovered: 0, unmatched: outstanding.length, error: code });
      })
      .finally(() => {
        pending.current = false;
        if (alive.current) setRevision((value) => value + 1);
      });
    // The signature intentionally excludes progress timestamps and URLs (which
    // contain sensitive TorBox tokens). Polling for failed transfers is event-driven.
  }, [profile, key, active, downloads.loading, signature, revision]);
  return { ...outcome, retry };
}
