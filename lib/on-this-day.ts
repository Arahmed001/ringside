import type { World } from "./world";
import type { BoutRow, BoxerFull } from "./types";
import { scoreFight } from "./fight-score";
import { memo } from "./memo";

/**
 * "On this day": the fights decided, and the fighters born, on a calendar day in any year of the database.
 *
 * A day is a `MM-DD` key. Keys are worked out in a leap year (2000) so 02-29 exists and the 366 days wrap around; a fight
 * on 29 February is shown on 29 February only, not moved to the 28th in other years. Only results that are on record count
 * (completed, so not cancelled or postponed, and a method present, which a bout that has not happened never has), and only on or before today, so the page never lists a
 * fight that has not happened. Birthdays use the exact `birthDate` only: a feed that knows just the year says nothing about the day.
 *
 * Which fights to show when a day has dozens: title fights first, then by the fight score (lib/fight-score.ts), then by
 * how highly rated the two were going in (`importance` below is that rule in one number). No more than PER_YEAR fights of one year are taken
 * on the first pass; places still empty after it are filled from what was skipped. The display is newest year first.
 */
export const LEAP = 2000;
export const TITLE_BONUS = 40;
export const SHOW_FIGHTS = 12, SHOW_BIRTHS = 12;
/** On a crowded day no one year may take more than this many of the places on the first pass, so one big night does not crowd out the other years. */
export const PER_YEAR = 3;

export type DayKey = string;

const pad = (n: number) => String(n).padStart(2, "0");

/** "10-03" for a valid day of the year (including 02-29), otherwise null. */
export function parseDay(s: string | null | undefined): DayKey | null {
  const m = /^(\d{2})-(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const mo = Number(m[1]), d = Number(m[2]);
  const dt = new Date(Date.UTC(LEAP, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${pad(mo)}-${pad(d)}` : null;
}

/** The day key of an ISO date, or null if it is not a real date. */
export function dayOf(iso: string | null | undefined): DayKey | null {
  const m = /^\d{4}-(\d{2}-\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const k = parseDay(m[1]);
  if (!k) return null;
  // 02-29 in a year that has no 29 February is not a date
  const y = Number((iso as string).slice(0, 4));
  return k === "02-29" && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? null : k;
}

/** The day `n` days after (or before) `key`, wrapping the 366-day year (so a step across New Year still passes through 29 February). */
export function shiftDay(key: DayKey, n: number): DayKey {
  const [mo, d] = key.split("-").map(Number);
  const start = Date.UTC(LEAP, 0, 1);
  const idx = Math.round((Date.UTC(LEAP, mo - 1, d) - start) / 86_400_000);
  const next = new Date(start + (((idx + n) % 366) + 366) % 366 * 86_400_000);
  return `${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

interface DayIndex { fights: BoutRow[]; births: BoxerFull[] }

/** Everything on record, bucketed by day of the year. Built once per world: one pass over the bouts and the boxers. */
const index = (w: World): Map<DayKey, DayIndex> => memo(w, "onThisDay:index", () => {
  const m = new Map<DayKey, DayIndex>();
  const at = (k: DayKey) => m.get(k) ?? m.set(k, { fights: [], births: [] }).get(k)!;
  for (const b of w.bouts) {
    if (b.status !== "completed" || !b.method || b.date > w.today) continue;
    const k = dayOf(b.date);
    if (k) at(k).fights.push(b);
  }
  for (const x of w.boxers) {
    const k = dayOf(x.birthDate);
    if (k && x.birthDate! <= w.today) at(k).births.push(x);
  }
  return m;
});

/** How much a fight deserves a place on a crowded day: a title (40), plus its fight score (0-100, when it has one), plus a tie-break from the ratings going in. */
export function importance(w: World, b: BoutRow): number {
  const pre = w.boutPre.get(b.id);
  const rating = pre ? (pre.red + pre.blue) / 2 : 1500;
  return (b.title ? TITLE_BONUS : 0) + (scoreFight(w, b)?.score ?? 0) + rating / 10_000;
}

export interface DayFight { bout: BoutRow; score: number | null }
export interface DayPage {
  key: DayKey;
  /** The fights shown: the most important ones, newest year first. */
  fights: DayFight[];
  fightTotal: number;
  /** How many different years those fights are spread over. */
  fightYears: number;
  births: BoxerFull[];
  birthTotal: number;
}

export function onThisDay(w: World, key: DayKey, o: { fights?: number; births?: number } = {}): DayPage {
  const maxF = o.fights ?? SHOW_FIGHTS, maxB = o.births ?? SHOW_BIRTHS;
  return memo(w, `onThisDay:${key}:${maxF}:${maxB}`, () => {
    const day = index(w).get(key) ?? { fights: [], births: [] };
    const ranked = day.fights.map((b) => ({ bout: b, imp: importance(w, b) })).sort((a, b) => b.imp - a.imp || a.bout.id - b.bout.id);
    const perYear = new Map<string, number>(), picked: typeof ranked = [], skipped: typeof ranked = [];
    for (const r of ranked) {
      const y = r.bout.date.slice(0, 4);
      if (picked.length < maxF && (perYear.get(y) ?? 0) < PER_YEAR) { picked.push(r); perYear.set(y, (perYear.get(y) ?? 0) + 1); } else skipped.push(r);
    }
    for (const r of skipped) { if (picked.length >= maxF) break; picked.push(r); }
    const fights = picked.map((x) => ({ bout: x.bout, score: scoreFight(w, x.bout)?.score ?? null }))
      .sort((a, b) => (a.bout.date < b.bout.date ? 1 : a.bout.date > b.bout.date ? -1 : 0) || a.bout.position - b.bout.position || a.bout.id - b.bout.id);
    const births = [...day.births].sort((a, b) => b.rating - a.rating || a.id - b.id).slice(0, maxB);
    return { key, fights, fightTotal: day.fights.length, fightYears: new Set(day.fights.map((b) => b.date.slice(0, 4))).size, births, birthTotal: day.births.length };
  });
}

/** The count of things on a day without ranking them (cheap: no fight scores). */
export const countOn = (w: World, key: DayKey): { fights: number; births: number } => {
  const d = index(w).get(key);
  return { fights: d?.fights.length ?? 0, births: d?.births.length ?? 0 };
};

/** The closest day, in the given direction, that has anything on it; null when the whole database has nothing. */
export function nearestWithContent(w: World, key: DayKey, dir: 1 | -1): { key: DayKey; fights: number; births: number } | null {
  for (let i = 1; i <= 366; i++) {
    const k = shiftDay(key, dir * i);
    const c = countOn(w, k);
    if (c.fights + c.births > 0) return { key: k, ...c };
  }
  return null;
}
