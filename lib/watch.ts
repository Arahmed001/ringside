import type { World } from "./world";
import { recordStr } from "./world";
import { fmtDate, methodLabel } from "./format";
import { resultFor } from "./glance";
import { tEn, type T } from "./i18n/t";

export interface WatchLast { result: "W" | "L" | "D" | "NC"; opponent: string; how: string; date: string; boutId: number }
/** `next` is the home strip's one-line text; the rest feeds the watchlist page. */
export interface WatchEntry {
  slug: string; name: string; record: string; next?: string;
  rating?: number; ratingChange?: number; active?: boolean; country?: string | null;
  nextDate?: string; nextBoutId?: number; last?: WatchLast;
}

export const MAX_WATCH = 100;

/** What the home page's watchlist shows for the fighters one visitor starred (never every fighter in the database). */
export function watchEntries(w: World, slugs: string[], t: T = tEn): WatchEntry[] {
  const out: WatchEntry[] = [];
  for (const slug of new Set(slugs.slice(0, MAX_WATCH))) {
    const b = w.bySlug.get(slug);
    if (!b) continue;
    const up = (w.boutsByBoxer.get(b.id) ?? []).find((x) => x.upcoming);
    const bouts = w.boutsByBoxer.get(b.id) ?? [];
    let last: WatchLast | undefined;
    for (let i = bouts.length - 1; i >= 0 && !last; i--) {
      const x = bouts[i], r = resultFor(x, b.id);
      if (r) last = { result: r, opponent: t.name(x.redId === b.id ? x.blueName : x.redName), how: methodLabel(x.method, x.endRound, t), date: fmtDate(x.date, { month: "short", day: "numeric", year: "numeric" }, t.locale), boutId: x.id };
    }
    const hist = w.history.get(b.id) ?? [];
    const ratingChange = hist.length >= 2 ? Math.round(hist[hist.length - 1].rating) - Math.round(hist[hist.length - 2].rating) : undefined;
    out.push({
      rating: Math.round(b.rating), ratingChange, active: b.active, country: b.country, last,
      nextDate: up?.date, nextBoutId: up?.id,
      slug: b.slug, name: t.name(b.name), record: recordStr(b),
      next: up ? t("{date} vs {name}", { date: fmtDate(up.date, { month: "short", day: "numeric" }, t.locale), name: t.name(up.redId === b.id ? up.blueName : up.redName) }) : undefined,
    });
  }
  return out;
}
