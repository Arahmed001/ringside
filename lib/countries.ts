import type { World } from "./world";
import type { BoutRow, EventRow } from "./types";
import { belts, type Belt } from "./lineage";
import { slugify } from "./slug";
import { memo } from "./memo";

/**
 * A page per country, from the data already held: its fighters, the champions among them, their next fights and the events held there. A country is the
 * name the feed gives (two spellings that make the same address are one country, under the spelling most fighters use), so nothing is guessed about which
 * names mean the same place; a feed that spells one place two ways shows it twice until the spelling is fixed at the source.
 */
export interface CountryRow { slug: string; name: string; fighters: number; active: number }

/** boxer id to the address of their country, worked out once per world (a page scans every fight, and slugifying a name 100,000 times per request is waste) */
const slugOf = (w: World): Map<number, string> => memo(w, "countrySlugOf", () => new Map(w.boxers.filter((b) => b.country).map((b) => [b.id, slugify(b.country)] as const)));

const rows = (w: World): Map<string, { name: string; spellings: Map<string, number>; fighters: number; active: number }> => memo(w, "countryRows", () => {
  const m = new Map<string, { name: string; spellings: Map<string, number>; fighters: number; active: number }>();
  for (const b of w.boxers) {
    if (b.bouts === 0 || !b.country) continue;
    const slug = slugify(b.country);
    if (!slug) continue;
    const r = m.get(slug) ?? { name: b.country, spellings: new Map(), fighters: 0, active: 0 };
    r.fighters++; if (b.active) r.active++;
    r.spellings.set(b.country, (r.spellings.get(b.country) ?? 0) + 1);
    m.set(slug, r);
  }
  for (const r of m.values()) r.name = [...r.spellings.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  return m;
});

/** Every country with at least one fighter who has fought, the one with the most fighters first. */
export const countryList = (w: World): CountryRow[] => [...rows(w)].map(([slug, r]) => ({ slug, name: r.name, fighters: r.fighters, active: r.active })).sort((a, b) => b.fighters - a.fighters || (a.name < b.name ? -1 : 1));

export const countrySlug = (name: string): string => slugify(name);

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
  const held = w.events.filter((e) => !!e.country && slugify(e.country) === slug && e.status !== "cancelled" && !e.upcoming).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  return { slug, name: r.name, fighters: r.fighters, active: r.active, top: topOf(w, slug, limits.top), champions, next, events: held.slice(0, limits.events), eventCount: held.length };
}
