import type { World } from "./world";
import type { BoutRow, EventRow } from "./types";
import { belts, type Belt } from "./lineage";
import { slugify } from "./slug";
import { canonicalCountry } from "./format";
import { memo } from "./memo";

/**
 * A page per country, from the data already held: its fighters, the champions among them, their next fights and the events held there. A country is
 * the feed's name made canonical (USA and United States are one country); a name that cannot be identified is kept as given, so nothing is guessed.
 */
export interface CountryRow { slug: string; name: string; fighters: number; active: number }

/** The address of a country page, the same for every spelling of one country. */
export const countrySlug = (name: string): string => slugify(canonicalCountry(name));

/** boxer id to the address of their country, worked out once per world (a page scans every fight, and slugifying a name 100,000 times per request is waste) */
const slugOf = (w: World): Map<number, string> => memo(w, "countrySlugOf", () => new Map(w.boxers.filter((b) => b.country).map((b) => [b.id, countrySlug(b.country)] as const)));

const rows = (w: World): Map<string, { name: string; fighters: number; active: number }> => memo(w, "countryRows", () => {
  const m = new Map<string, { name: string; fighters: number; active: number }>();
  for (const b of w.boxers) {
    if (b.bouts === 0 || !b.country) continue;
    const slug = countrySlug(b.country);
    if (!slug) continue;
    const r = m.get(slug) ?? { name: canonicalCountry(b.country), fighters: 0, active: 0 };
    r.fighters++; if (b.active) r.active++;
    m.set(slug, r);
  }
  return m;
});

/** Every country with at least one fighter who has fought, the one with the most fighters first. */
export const countryList = (w: World): CountryRow[] => [...rows(w)].map(([slug, r]) => ({ slug, name: r.name, fighters: r.fighters, active: r.active })).sort((a, b) => b.fighters - a.fighters || (a.name < b.name ? -1 : 1));

export interface CountryView {
  slug: string; name: string; fighters: number; active: number;
  /** the best-rated active fighters, then retired ones if there are too few active */
  top: ReturnType<typeof topOf>;
  /** belts held right now (a live belt, not a dormant one) by a fighter from here */
  champions: { belt: Belt; boxerId: number }[];
  /** coming fights with a fighter from here, soonest first */
  next: BoutRow[];
  /** events held in this country, newest first */
  events: EventRow[];
  eventCount: number;
}

const topOf = (w: World, slug: string, n: number) => {
  const of = slugOf(w);
  const mine = w.boxers.filter((b) => b.bouts > 0 && of.get(b.id) === slug);
  return mine.slice().sort((a, b) => Number(b.active) - Number(a.active) || b.rating - a.rating || a.id - b.id).slice(0, n);
};

export function countryView(w: World, slug: string, limits = { top: 12, next: 8, events: 6 }): CountryView | null {
  const r = rows(w).get(slug);
  if (!r) return null;
  const of = slugOf(w);
  const fromHere = (id: number) => of.get(id) === slug;
  const champions = belts(w).filter((b) => b.current && !b.stale && fromHere(b.current.boxerId)).map((belt) => ({ belt, boxerId: belt.current!.boxerId }));
  const next = w.bouts.filter((b) => b.upcoming && b.status !== "cancelled" && (fromHere(b.redId) || fromHere(b.blueId))).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id)).slice(0, limits.next);
  const held = w.events.filter((e) => !!e.country && countrySlug(e.country) === slug && e.status !== "cancelled" && !e.upcoming).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  return { slug, name: r.name, fighters: r.fighters, active: r.active, top: topOf(w, slug, limits.top), champions, next, events: held.slice(0, limits.events), eventCount: held.length };
}
