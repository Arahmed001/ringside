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

/** `countrySlug` with a memory of what it was asked, for loops over every fighter or event: there are a few hundred distinct country names among 100,000 rows, and slugifying each row took 65-150 ms. */
const slugger = () => { const seen = new Map<string, string>(); return (name: string): string => { let s = seen.get(name); if (s === undefined) { s = countrySlug(name); seen.set(name, s); } return s; }; };

/** boxer id to the address of their country, worked out once per world (a page scans every fight, and slugifying a name 100,000 times per request is waste) */
const slugOf = (w: World): Map<number, string> => memo(w, "countrySlugOf", () => { const slug = slugger(); return new Map(w.boxers.filter((b) => b.country).map((b) => [b.id, slug(b.country)] as const)); });

const rows = (w: World): Map<string, { name: string; fighters: number; active: number }> => memo(w, "countryRows", () => {
  const m = new Map<string, { name: string; fighters: number; active: number }>(), slugFor = slugger();
  for (const b of w.boxers) {
    if (b.bouts === 0 || !b.country) continue;
    const slug = slugFor(b.country);
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

/** The coming fights, once per world: a country page used to look through all 160,000 bouts for them on every view. */
const upcomingBouts = (w: World): BoutRow[] => memo(w, "countryUpcomingBouts", () => w.bouts.filter((b) => b.upcoming && b.status !== "cancelled"));

/** Events already held, by the country's address, newest first (date, then id), once per world: a page used to work out the country of all 74,000 events on every view. */
const heldBySlug = (w: World): Map<string, EventRow[]> => memo(w, "countryEventsHeld", () => {
  const m = new Map<string, EventRow[]>(), slugFor = slugger();
  for (const e of w.events) {
    if (!e.country || e.status === "cancelled" || e.upcoming) continue;
    const s = slugFor(e.country);
    (m.get(s) ?? m.set(s, []).get(s)!).push(e);
  }
  for (const list of m.values()) list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  return m;
});

export function countryView(w: World, slug: string, limits = { top: 12, next: 8, events: 6 }): CountryView | null {
  const r = rows(w).get(slug);
  if (!r) return null;
  const of = slugOf(w);
  const fromHere = (id: number) => of.get(id) === slug;
  const champions = belts(w).filter((b) => b.current && !b.stale && fromHere(b.current.boxerId)).map((belt) => ({ belt, boxerId: belt.current!.boxerId }));
  const next = upcomingBouts(w).filter((b) => fromHere(b.redId) || fromHere(b.blueId)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id)).slice(0, limits.next);
  const held = heldBySlug(w).get(slug) ?? [];
  return { slug, name: r.name, fighters: r.fighters, active: r.active, top: topOf(w, slug, limits.top), champions, next, events: held.slice(0, limits.events), eventCount: held.length };
}
