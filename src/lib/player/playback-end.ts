import type { PlayerSnapshot } from "./bridge";
import { getWatchedThresholdRatio } from "@/lib/watched-threshold";

export function isNaturalEnd(snap: PlayerSnapshot, positionSec: number): boolean {
  if (snap.status !== "ended") return false;
  if (!Number.isFinite(snap.durationSec) || snap.durationSec <= 0) return true;
  return positionSec / snap.durationSec >= getWatchedThresholdRatio() || positionSec >= snap.durationSec - 2;
}

export function isTruncatedEnd(snap: PlayerSnapshot, positionSec: number): boolean {
  return snap.status === "ended" && !isNaturalEnd(snap, positionSec);
}
