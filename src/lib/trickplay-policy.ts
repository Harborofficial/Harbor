export function previewWindow(
  time: number,
  durationSec: number,
  direction: number,
  step = 2,
): number[] {
  if (!Number.isFinite(time) || !Number.isFinite(durationSec) || durationSec <= 0) return [];
  return [0, 1, 2, 3, -1]
    .map((offset) => Math.round((time + offset * step * direction) / 2) * 2)
    .filter(
      (value, index, values) =>
        value >= 0 && value < durationSec && values.indexOf(value) === index,
    );
}
