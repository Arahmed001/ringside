import type { World } from "./world";
import { fmtDate, methodLabel } from "./format";
import { resultFor, type Result } from "./glance";
import { tEn, type T } from "./i18n/t";
import { MAX_WATCH } from "./watch";

/**
 * "Since you last looked", for the fighters one visitor follows: the results since a day, how each rating moved, and the fights coming up this fortnight. Built from the
 * fights and the rating history alone, so it is the same in both languages and needs nothing stored about the visitor: the page keeps the day it was last seen in the
 * browser and asks for what came after it. A fight is "since" when its date is after that day (the day itself was already seen) and not after the data's own today.
 */
export const DIGEST_MAX_DAYS = 365;
export const DIGEST_SOON_DAYS = 14;
export const DIGEST_MAX_RESULTS = 5;

export interface DigestResult { boutId: number; date: string; dateLabel: string; result: Result; opponent: string; how: string; /** how much the rating moved on that fight, when the history says */ ratingDelta: number | null }
export interface DigestItem {
  slug: string; name: string; results: DigestResult[]; /** results beyond the five shown */ moreResults: number;
  /** the rating at the end of `since` and now, only when they differ */ rating: { from: number; to: number } | null;
  /** the next fight, only when it is within the fortnight */ next: { boutId: number; date: string; dateLabel: string; opponent: string; days: number } | null;
}
export interface Digest { today: string; since: string; /** `since` was older than a year and was brought forward to that */ clamped: boolean; watched: number; items: DigestItem[] }

/** A calendar day written YYYY-MM-DD that exists (2026-02-31 and 2026-13-01 do not: a date parser would roll them over, so the day is built and compared). */
export function isRealDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);

export function watchDigest(w: World, slugs: string[], since: string, t: T = tEn): Digest {
  const floor = addDays(w.today, -DIGEST_MAX_DAYS);
  const day = since > w.today ? w.today : since; // a day in the future (a clock that is ahead) means nothing is newer
  const from = day < floor ? floor : day;
  const items: DigestItem[] = [];
  let watched = 0;
  for (const slug of new Set(slugs.slice(0, MAX_WATCH))) {
    const b = w.bySlug.get(slug);
    if (!b) continue;
    watched++;
    const bouts = w.boutsByBoxer.get(b.id) ?? [], hist = w.history.get(b.id) ?? [];
    const fresh = bouts.filter((x) => !x.upcoming && x.date > from && x.date <= w.today && resultFor(x, b.id) !== null);
    const shown: DigestResult[] = fresh.slice(-DIGEST_MAX_RESULTS).map((x) => {
      const i = hist.findIndex((h) => h.boutId === x.id);
      return { boutId: x.id, date: x.date, dateLabel: fmtDate(x.date, { month: "short", day: "numeric" }, t.locale), result: resultFor(x, b.id)!, opponent: t.name(x.redId === b.id ? x.blueName : x.redName), how: methodLabel(x.method, x.endRound, t), ratingDelta: i > 0 ? Math.round(hist[i].rating) - Math.round(hist[i - 1].rating) : null };
    });
    let before: number | null = null;
    for (const h of hist) if (h.date <= from) before = h.rating;
    const now = hist.length ? hist[hist.length - 1].rating : null;
    const rating = before !== null && now !== null && Math.round(before) !== Math.round(now) ? { from: Math.round(before), to: Math.round(now) } : null;
    const up = bouts.find((x) => x.upcoming); // the world never marks a cancelled bout as upcoming
    const days = up ? daysBetween(w.today, up.date) : null;
    const next = up && days !== null && days >= 0 && days <= DIGEST_SOON_DAYS ? { boutId: up.id, date: up.date, dateLabel: fmtDate(up.date, { month: "short", day: "numeric" }, t.locale), opponent: t.name(up.redId === b.id ? up.blueName : up.redName), days } : null;
    if (shown.length || rating || next) items.push({ slug: b.slug, name: t.name(b.name), results: shown, moreResults: fresh.length - shown.length, rating, next });
  }
  // the freshest news first: those with a new result (the latest first), then those with a fight coming up (the soonest first), then a rating move alone; by name within each
  const rank = (i: DigestItem) => (i.results.length ? 0 : i.next ? 1 : 2);
  items.sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 0 ? b.results[b.results.length - 1].date.localeCompare(a.results[a.results.length - 1].date) : rank(a) === 1 ? a.next!.date.localeCompare(b.next!.date) : 0)
    || a.name.localeCompare(b.name));
  return { today: w.today, since: from, clamped: from !== day, watched, items };
}
