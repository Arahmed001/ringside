import type { World } from "./world";
import { recordStr } from "./world";
import { fmtDate } from "./format";
import { tEn, type T } from "./i18n/t";

export interface WatchEntry { slug: string; name: string; record: string; next?: string }

export const MAX_WATCH = 100;

/** What the home page's watchlist shows for the fighters one visitor starred (never every fighter in the database). */
export function watchEntries(w: World, slugs: string[], t: T = tEn): WatchEntry[] {
  const out: WatchEntry[] = [];
  for (const slug of new Set(slugs.slice(0, MAX_WATCH))) {
    const b = w.bySlug.get(slug);
    if (!b) continue;
    const up = (w.boutsByBoxer.get(b.id) ?? []).find((x) => x.upcoming);
    out.push({
      slug: b.slug, name: t.name(b.name), record: recordStr(b),
      next: up ? t("{date} vs {name}", { date: fmtDate(up.date, { month: "short", day: "numeric" }, t.locale), name: t.name(up.redId === b.id ? up.blueName : up.redName) }) : undefined,
    });
  }
  return out;
}
