import type { CustomGame } from "./custom-library";
import { downloadGroup, type DownloadGroup, type DownloadItem } from "./download-presentation";
import { downloadGroupKey } from "./download-game-groups";
import { torrentSharing } from "./torrents";
import { setupRunStage, setupVerificationFailed } from "./setup-progress";
import { setupJobForSource, type SetupJob } from "./setup";
import { registeredArchiveGame, registeredSetupGame } from "./setup-context";
import {
  archiveNeedsAttention,
  archiveSetupSource,
  downloadArchive,
  type ArchiveJob,
} from "./archives";

export type DownloadSetup =
  | {
      job: SetupJob;
      phase: "installing" | "checking" | "registering" | "ready" | "attention";
      game?: CustomGame;
      error?: string;
    }
  | { job?: undefined; archive: ArchiveJob; phase: "ready"; game: CustomGame; error?: undefined };

/** A completed transfer is only the input to setup, not evidence of a playable game. */
export function downloadSetup(
  item: DownloadItem,
  profile: string,
  jobs: SetupJob[],
  games: CustomGame[],
  registering: string[],
  errors: Record<string, string>,
  archives: ArchiveJob[] = [],
): DownloadSetup | undefined {
  if (item.record.status !== "complete" || item.record.profile !== profile) return;
  const archive = downloadArchive(item, profile, archives),
    extracted = archive && archiveSetupSource(archive);
  if (archive && !extracted) return;
  const job = setupJobForSource(
    jobs.filter(
      (job) => job.profile === profile && (!archive || job.startedAt >= archive.startedAt),
    ),
    extracted?.source ?? item.record.destination,
  );
  if (!job) {
    const game = archive && registeredArchiveGame(archive, games);
    return archive && game ? { archive, phase: "ready", game } : undefined;
  }
  if (job.status === "running")
    return { job, phase: job.progress?.stage === "checking" ? "checking" : "installing" };
  if (setupVerificationFailed(job))
    return { job, phase: "attention", error: "games.setup.setup_verification" };
  if (registering.includes(job.id)) return { job, phase: "registering" };
  const game = registeredSetupGame(job, item.record.game?.name ?? item.record.name, games);
  if (game) return { job, phase: "ready", game };
  return { job, phase: "attention", error: errors[job.id] };
}

export const setupIsBusy = (setup?: DownloadSetup) =>
  setup?.phase === "installing" || setup?.phase === "checking" || setup?.phase === "registering";
export const downloadSetupGroup = (
  item: DownloadItem,
  setup?: DownloadSetup,
  archive?: ArchiveJob,
): DownloadGroup =>
  archive?.status === "running" || setupIsBusy(setup)
    ? "active"
    : archiveNeedsAttention(archive) || setup?.phase === "attention"
      ? "attention"
      : downloadGroup(item);
export function downloadSetupSummary(
  items: DownloadItem[],
  resolve: (item: DownloadItem) => DownloadSetup | undefined,
  archives: ArchiveJob[] = [],
) {
  // The Games navigation badge counts whole game groups, not repack files.
  const summary = { total: 0, active: 0, queued: 0, paused: 0, failed: 0 };
  const groups = new Map<
    string,
    { active: boolean; queued: boolean; paused: boolean; failed: boolean }
  >();
  const claimed = new Set(
    archives
      .filter((archive) =>
        items.some((item) => !!downloadArchive(item, item.record.profile, [archive])),
      )
      .map((archive) => archive.id),
  );
  for (const item of items) {
    const key = downloadGroupKey(item);
    const state = groups.get(key) ?? { active: false, queued: false, paused: false, failed: false };
    groups.set(key, state);
    const record = item.record;
    if (item.kind === "torrent" && torrentSharing(item.record)) state.active = true;
    else if (item.kind === "torrent" && item.record.sharing?.status === "failed")
      state.failed = true;
    else if (
      ["connecting", "retrying", "downloading", "checking", "pausing", "canceling"].includes(
        record.status,
      )
    )
      state.active = true;
    else if (record.status === "failed") state.failed = true;
    else if (record.status === "queued") state.queued = true;
    else if (record.status === "paused") state.paused = true;
    if (record.status === "complete") {
      const archive = downloadArchive(item, item.record.profile, archives);
      if (archive) claimed.add(archive.id);
      if (archive?.status === "running") state.active = true;
      else if (archiveNeedsAttention(archive)) state.failed = true;
      const setup = resolve(item);
      if (setupIsBusy(setup)) state.active = true;
      else if (setup?.phase === "attention") state.failed = true;
    }
  }
  for (const state of groups.values()) {
    const phase = state.active
      ? "active"
      : state.failed
        ? "failed"
        : state.queued
          ? "queued"
          : state.paused
            ? "paused"
            : null;
    if (phase) {
      summary.total++;
      summary[phase]++;
    }
  }
  for (const archive of archives) {
    if (claimed.has(archive.id)) continue;
    if (archive.status === "running") {
      summary.total++;
      summary.active++;
    } else if (archiveNeedsAttention(archive)) {
      summary.total++;
      summary.failed++;
    }
  }
  return summary;
}
export function downloadSetupLabel(setup: DownloadSetup, now = Date.now()) {
  if (setup.phase === "ready") return "games.setup.phase.ready";
  if (!setup.job) return "games.setup.review";
  if (
    !setupIsBusy(setup) &&
    (setup.job.error === "setup_verification" || setupVerificationFailed(setup.job))
  )
    return "games.setup.state.verificationFailed";
  if (setup.job.error === "setup_verification_unknown")
    return "games.setup.state.verificationUnknown";
  if (setup.job.error === "setup_review") return "games.setup.review";
  if (setup.phase === "checking") return "games.setup.state.checking";
  if (setup.phase === "registering") return "games.setup.registering";
  if (setup.phase === "installing" && setup.job.status === "running")
    return `games.setup.state.${setupRunStage(setup.job, now)}`;
  if (setup.job.status === "finished") return "games.setup.review";
  return `games.setup.state.${setup.phase === "installing" && setup.job.destination ? "installing" : setup.job.status}`;
}
