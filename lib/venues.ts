import type { World } from "./world";
import { memo } from "./memo";
import { canonicalCountry } from "./format";
import { countrySlug, countrySlugsOf } from "./countries";

/**
 * Where fights are held: every venue of the events on record, with how many cards it has held, when the last was, and, for the ones verified on Wikidata, where it is and how many it holds.
 * A venue is the feed's venue name and city together; the country is the canonical one. A venue we cannot place on the map is still listed (placing it is a separate, honest step).
 */
export interface VenueRow {
  name: string; city: string; country: string; countrySlug: string;
  events: number; lastDate: string; upcoming: number;
  lat: number | null; lon: number | null; capacity: number | null; wikidataId: string | null;
  /** only what the open data gave: never filled in by a guess */
  address: string | null; category: string | null;
  /** true when the address or category came from OpenStreetMap (its credit must then be shown) */
  osm: boolean;
}

/** A plain link to the place in Google Maps' own search (it loads nothing until pressed, and sends Google nothing about a visitor who does not press it). */
export const mapsUrl = (v: { name: string; city: string; country: string }): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([v.name, v.city, v.country].filter(Boolean).join(", "))}`;

const all = (w: World): Map<string, VenueRow> => memo(w, "venueRows", () => {
  const m = new Map<string, VenueRow>();
  for (const e of w.events) {
    if (!e.venue || e.status === "cancelled") continue;
    const key = `${e.venue}|${e.city ?? ""}`, known = w.venueOf({ venue: e.venue, city: e.city ?? "" }), place = w.placeOf({ venue: e.venue, city: e.city ?? "" });
    let r = m.get(key);
    if (!r) {
      const country = e.country ? canonicalCountry(e.country) : "";
      r = { name: e.venue, city: e.city ?? "", country, countrySlug: country ? countrySlug(country) : "", events: 0, lastDate: "", upcoming: 0, lat: known?.lat ?? place?.lat ?? null, lon: known?.lon ?? place?.lon ?? null, capacity: known?.capacity ?? null, wikidataId: known?.wikidataId ?? null, address: place?.address ?? null, category: place?.category ?? null, osm: !!place };
      m.set(key, r);
    }
    if (e.upcoming) r.upcoming++; else { r.events++; if (e.date > r.lastDate) r.lastDate = e.date; }
  }
  return m;
});

const byUse = (a: VenueRow, b: VenueRow) => b.events + b.upcoming - (a.events + a.upcoming) || (a.name < b.name ? -1 : 1);

/** The venues that have held the most cards, anywhere. */
export const topVenues = (w: World, n: number): VenueRow[] => [...all(w).values()].filter((v) => v.events + v.upcoming > 0).sort(byUse).slice(0, n);

/** The venues of one country (the United Kingdom's include England, Scotland, Wales and Northern Ireland), busiest first. */
export function venuesOfCountry(w: World, slug: string): VenueRow[] {
  return [...all(w).values()].filter((v) => v.events + v.upcoming > 0 && v.country && countrySlugsOf(v.country).includes(slug)).sort(byUse);
}

/** How many venues in all, and how many of them are placed on the map. */
export const venueCounts = (w: World): { all: number; placed: number } => { const v = [...all(w).values()].filter((x) => x.events + x.upcoming > 0); return { all: v.length, placed: v.filter((x) => x.lat !== null && x.lon !== null).length }; };
