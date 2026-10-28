import { useSyncExternalStore } from "react";
import { episodeReleaseCountdown } from "@/lib/episode-release-countdown";
import { useT } from "@/lib/i18n";

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let now = Date.now();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((notify) => notify());
    }, 60000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const snapshot = () => now;
const subscribeInactive = () => () => {};

export function EpisodeReleaseCountdown({
  date,
  className = "text-[12px]",
}: {
  date: string | null | undefined;
  className?: string;
}) {
  const t = useT();
  const active = episodeReleaseCountdown(date) != null;
  const clock = useSyncExternalStore(active ? subscribe : subscribeInactive, snapshot, snapshot);
  const countdown = episodeReleaseCountdown(date, active ? clock : Date.now());
  if (!countdown) return null;
  let label: string;
  if (countdown.kind === "days") {
    label = countdown.days === 1 ? t("Tomorrow") : t("In {n} days", { n: countdown.days });
  } else if (countdown.days > 0) {
    label = t("In {d}d {h}h {m}m", { d: countdown.days, h: countdown.hours, m: countdown.minutes });
  } else if (countdown.hours > 0) {
    label = t("In {h}h {m}m", { h: countdown.hours, m: countdown.minutes });
  } else {
    label = t("In {n} min", { n: countdown.minutes });
  }
  return (
    <time dateTime={date ?? undefined} className={`text-accent tabular-nums ${className}`}>
      {label}
    </time>
  );
}
