// Shared by the play/pause key and the video surface so a hold feels the same
// wherever it starts. The delay is what separates a tap (play/pause) from a
// hold (speed up); below it every press is a normal click.
export const HOLD_SPEED_DELAY_MS = 350;
export const HOLD_SPEED_RATE = 2;

/**
 * A hold never slows playback down: at 1x it goes to 2x, and above 2x it keeps
 * the rate the viewer already chose.
 */
export function holdSpeedRate(baseRate: number): number {
  return Math.max(HOLD_SPEED_RATE, baseRate);
}
