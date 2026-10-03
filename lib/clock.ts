/**
 * The app's notion of "now". Everything that depends on today's date (upcoming vs past, rankings windows,
 * months since last fight) goes through here, so tests can pin the date with RINGSIDE_NOW=2026-10-03.
 */
export const nowMs = (): number => {
  const pinned = process.env.RINGSIDE_NOW;
  const t = pinned ? Date.parse(pinned) : NaN;
  return Number.isFinite(t) ? t : Date.now();
};
export const todayIso = (): string => new Date(nowMs()).toISOString().slice(0, 10);
export const currentYear = (): number => new Date(nowMs()).getUTCFullYear();
