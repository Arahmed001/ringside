/** The shape of a count-up (components/CountUp.tsx), apart from the page: a figure that starts at 80 % of its value and eases out to it. Kept here so a test can check it. */
export const COUNT_START = 0.8;
export const COUNT_MS = 700;
/** Where the figure is `elapsedMs` into the animation: eased out (fast first, slow at the end), always a whole number, and exactly `value` at the end. */
export function countAt(value: number, elapsedMs: number, durationMs = COUNT_MS, startShare = COUNT_START): number {
  if (!Number.isFinite(value)) return value;
  if (elapsedMs >= durationMs) return value;
  const p = Math.max(0, elapsedMs) / durationMs, eased = 1 - Math.pow(1 - p, 3), from = value * startShare;
  return Math.round(from + (value - from) * eased);
}
