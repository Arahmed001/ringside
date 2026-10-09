import type { DatabaseSync } from "node:sqlite";
import { countryCode } from "../format";

/**
 * Places venues on the map and gives them an address and a category, from OpenStreetMap through Nominatim (data © OpenStreetMap contributors, ODbL: the credit is printed wherever
 * the data is shown). For the venues Wikidata could not place. In the spirit of the Wikidata resolver, **a wrong stadium is worse than none**: a result is accepted only if ALL hold:
 *  1. it is a kind of place a fight is held in (a stadium, arena, sports hall, theatre, events venue, casino, hotel, club, convention or arts centre);
 *  2. it is in our country (when we can tell which that is);
 *  3. its name is our venue's name (either contains the other, or most of the words agree);
 *  4. it is in our city (named in its address); or, failing that (a venue filed under a district, as the MGM Grand Garden Arena is under Paradise, not Las Vegas), its name is exactly
 *     ours. Such a match is marked `cityConfirmed: false`. A merely similar name ("Grand Garden Arena" for "MGM Grand Garden Arena") is placed only when the city is confirmed.
 *  5. no other accepted result is more than 2 km away.
 * Two accepted results that are far apart make the answer "ambiguous" and nothing is stored. Nominatim's rules are kept: one request a second at most, an identifying User-Agent with a
 * contact, and every answer stored so it is never asked twice (a miss is asked again after 45 days).
 */
export interface OsmResult { osm_type?: string; osm_id?: number; lat: string; lon: string; category?: string; class?: string; type?: string; name?: string; display_name?: string; address?: Record<string, string> }
export interface Subject { name: string; city: string; country: string }
export interface PlaceMatch { lat: number; lon: number; address: string | null; category: string; osmRef: string; label: string; /** false when it was accepted on the name alone (the city is not in the address): worth a look */ cityConfirmed: boolean }
export type PlaceOutcome = { status: "found"; match: PlaceMatch } | { status: "no_match" | "ambiguous"; reason: string };

/** OSM "class:type" to the label shown, for the kinds of place a fight is held in. */
const KINDS: Record<string, string> = {
  "leisure:stadium": "Stadium", "building:stadium": "Stadium", "leisure:sports_centre": "Sports hall", "leisure:sports_hall": "Sports hall", "building:sports_hall": "Sports hall", "building:sports_centre": "Sports hall",
  "amenity:theatre": "Theatre", "building:theatre": "Theatre", "amenity:events_venue": "Events venue", "amenity:casino": "Casino", "amenity:nightclub": "Club",
  "amenity:conference_centre": "Convention centre", "amenity:exhibition_centre": "Convention centre", "building:exhibition_hall": "Convention centre", "amenity:arts_centre": "Arts centre",
  "tourism:hotel": "Casino hotel", "building:hotel": "Casino hotel", "leisure:arena": "Arena", "building:arena": "Arena", "building:civic": "Events venue", "building:public": "Events venue",
};
/** A place OpenStreetMap tags only as "a building" is taken for a venue when its own name says so ("Wembley Arena"): the name's word gives the kind. Only buildings, amenities, tourism and leisure places. */
const WORD_KIND: [RegExp, string][] = [[/\barena\b/i, "Arena"], [/\b(stadium|dome|coliseum|colosseum)\b/i, "Stadium"], [/\b(theatre|theater)\b/i, "Theatre"], [/\b(casino|resort|hotel)\b/i, "Casino hotel"], [/\b(hall|garden|gardens|centre|center|pavilion|forum|ballroom|palace)\b/i, "Events venue"]];
export const kindOf = (r: OsmResult): string | null => {
  const tagged = KINDS[`${r.category ?? r.class}:${r.type}`];
  if (tagged) return tagged;
  if (!["building", "amenity", "tourism", "leisure"].includes(r.category ?? r.class ?? "")) return null;
  return WORD_KIND.find(([re]) => re.test(r.name ?? ""))?.[1] ?? null;
};

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
const words = (s: string) => norm(s).split(" ").filter((w) => w.length > 1 && !["the", "and", "of", "de", "la"].includes(w));

export function nameMatches(ours: string, theirs: string): "exact" | "close" | null {
  const a = norm(ours), b = norm(theirs);
  if (!a || !b) return null;
  if (a === b) return "exact";
  if ((a.length >= 6 && b.includes(a)) || (b.length >= 6 && a.includes(b))) return "close";
  const wa = words(ours), wb = new Set(words(theirs));
  const shared = wa.filter((w) => wb.has(w)).length;
  // every word of ours is in theirs (a renamed or sponsored venue: "Wembley Arena" and "OVO Arena Wembley"), or at least 70% of the words agree
  return wa.length >= 2 && (shared === wa.length || shared >= Math.ceil(Math.max(wa.length, wb.size) * 0.7)) ? "close" : null;
}

const km = (a: [number, number], b: [number, number]) => {
  const R = 6371, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
/** The address as a person writes it: "3799 S Las Vegas Blvd, Paradise, NV 89158". Only parts the data has; nothing is filled in. */
export function addressOf(a: Record<string, string> | undefined): string | null {
  if (!a) return null;
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const place = a.city ?? a.town ?? a.village ?? a.suburb ?? a.municipality; // a county is not a place to post to: without a town the address is left out
  const region = a["ISO3166-2-lvl4"]?.startsWith("US-") ? a["ISO3166-2-lvl4"].slice(3) : a.state;
  const tail = [region, a.postcode].filter(Boolean).join(" ");
  return place && street ? [street, place, tail].filter(Boolean).join(", ") : null;
}
const cityIn = (city: string, a: Record<string, string> | undefined, display: string) => {
  const c = norm(city);
  if (!c) return false;
  // the address's own parts (never the street, which can carry a city's name, as South Las Vegas Boulevard does), or a whole comma-separated piece of the full name when there is no address
  if (a) return Object.entries(a).some(([k, v]) => !/^(ISO|country|postcode|house_number|road|leisure|amenity|building|tourism|shop|name)/.test(k) && norm(v) === c);
  return display.split(",").some((piece) => norm(piece) === c);
};

/** The pure decision step, so every rule can be tested without a network. */
export function decide(s: Subject, results: OsmResult[]): PlaceOutcome {
  if (!results.length) return { status: "no_match", reason: "OpenStreetMap has nothing by that name" };
  const code = countryCode(s.country)?.toLowerCase();
  const kinds = results.filter((r) => kindOf(r));
  if (!kinds.length) return { status: "no_match", reason: "found, but not a kind of place a fight is held in" };
  const here = kinds.filter((r) => !code || r.address?.country_code === code || (code === "gb" && r.address?.country_code === "gb"));
  if (!here.length) return { status: "no_match", reason: "a place with that name exists, but not in this country" };
  const named = here.map((r) => ({ r, how: nameMatches(s.name, r.name ?? r.display_name?.split(",")[0] ?? "") })).filter((x): x is { r: OsmResult; how: "exact" | "close" } => !!x.how);
  if (!named.length) return { status: "no_match", reason: "no result with the venue's name" };
  const inCity = named.filter((x) => cityIn(s.city, x.r.address, x.r.display_name ?? ""));
  const pool = inCity.length ? inCity : named.filter((x) => x.how === "exact");
  if (!pool.length) return { status: "no_match", reason: "a place with a similar name exists, but not in this city" };
  const pts = pool.map((x) => [Number(x.r.lat), Number(x.r.lon)] as [number, number]);
  if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180)) return { status: "no_match", reason: "OpenStreetMap gave no usable position" };
  if (pts.some((p) => km(p, pts[0]) > 2)) return { status: "ambiguous", reason: `${pool.length} places share that name in ${inCity.length ? "this city" : "this country"}, more than 2 km apart` };
  const best = pool.slice().sort((a, b) => Number(a.how !== "exact") - Number(b.how !== "exact"))[0].r;
  let category = kindOf(best)!;
  if (/\barena\b/i.test(best.name ?? s.name) && ["Stadium", "Sports hall", "Events venue"].includes(category)) category = "Arena";
  return { status: "found", match: { lat: Math.round(Number(best.lat) * 1e5) / 1e5, lon: Math.round(Number(best.lon) * 1e5) / 1e5, address: addressOf(best.address), category, osmRef: `${best.osm_type ?? "node"}/${best.osm_id ?? ""}`, label: best.name ?? s.name, cityConfirmed: inCity.length > 0 } };
}

export const NOMINATIM = "https://nominatim.openstreetmap.org/search";
export async function findPlace(s: Subject, o: { contact: string; fetchImpl?: typeof fetch }): Promise<PlaceOutcome> {
  const q = [s.name, s.city, s.country].filter(Boolean).join(", ");
  const u = new URL(NOMINATIM); for (const [k, v] of Object.entries({ q, format: "jsonv2", addressdetails: "1", limit: "6", "accept-language": "en" })) u.searchParams.set(k, v);
  const res = await (o.fetchImpl ?? fetch)(u, { headers: { "user-agent": `RingsideVenues/1.0 (+${o.contact})`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (res.status === 429 || res.status === 403) throw new RateLimited(`OpenStreetMap said ${res.status}: stop and try later`);
  if (!res.ok) throw new Error(`OpenStreetMap answered ${res.status}`);
  const body = await res.json();
  return decide(s, Array.isArray(body) ? (body as OsmResult[]) : []);
}
export class RateLimited extends Error {}

export interface PlaceSummary { checked: number; found: number; noMatch: number; ambiguous: number; errors: number }
const RECHECK_DAYS = 45, GAP_MS = 1100;

/** Looks up the venues of our events that have not been checked (busiest first, Wikidata-placed ones skipped); misses are retried after 45 days. Stops at once if OpenStreetMap asks it to. */
export async function resolvePlaces(db: DatabaseSync, o: { limit?: number; contact: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; gapMs?: number; log?: (m: string) => void }): Promise<PlaceSummary> {
  if (!o.contact || !/@|^https?:\/\//.test(o.contact)) throw new Error("A contact (an email address or web page) is needed: OpenStreetMap asks automated clients to identify themselves. Set WIKIMEDIA_CONTACT.");
  const log = o.log ?? (() => {}), sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cutoff = new Date(Date.now() - RECHECK_DAYS * 86400000).toISOString();
  const rows = db.prepare(`
    SELECT e.venue AS name, COALESCE(e.city, '') AS city, e.country, COUNT(*) AS n FROM events e
    LEFT JOIN venues w ON w.name = e.venue AND w.city = e.city AND w.status = 'matched' AND w.lat IS NOT NULL
    LEFT JOIN venue_places p ON p.name = e.venue AND p.city = COALESCE(e.city, '')
    WHERE e.venue IS NOT NULL AND e.venue <> '' AND e.status <> 'cancelled' AND w.name IS NULL AND (p.name IS NULL OR (p.status <> 'found' AND p.checked_at < ?))
    GROUP BY e.venue, e.city, e.country ORDER BY n DESC, e.venue LIMIT ?`).all(cutoff, o.limit ?? 100) as unknown as (Subject & { n: number })[];
  const save = db.prepare(`INSERT INTO venue_places (name, city, country, status, reason, lat, lon, address, category, osm_ref, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(name, city) DO UPDATE SET country=excluded.country, status=excluded.status, reason=excluded.reason, lat=excluded.lat, lon=excluded.lon, address=excluded.address, category=excluded.category, osm_ref=excluded.osm_ref, checked_at=excluded.checked_at`);
  const s: PlaceSummary = { checked: 0, found: 0, noMatch: 0, ambiguous: 0, errors: 0 };
  for (const r of rows) {
    s.checked++;
    try {
      const out = await findPlace(r, { contact: o.contact, fetchImpl: o.fetchImpl }), now = new Date().toISOString();
      if (out.status === "found") { const m = out.match; save.run(r.name, r.city, r.country, "found", m.cityConfirmed ? null : "accepted on the name alone: the city is not in its address", m.lat, m.lon, m.address, m.category, m.osmRef, now); s.found++; log(`✓ ${r.name}, ${r.city} → ${m.category}${m.address ? `, ${m.address}` : ""}${m.cityConfirmed ? "" : " (city not confirmed)"}`); }
      else { save.run(r.name, r.city, r.country, out.status, out.reason, null, null, null, null, null, now); if (out.status === "ambiguous") s.ambiguous++; else s.noMatch++; log(`– ${r.name}, ${r.city}: ${out.reason}`); }
    } catch (e) {
      s.errors++; log(`! ${r.name}: ${(e as Error).message}`);
      if (e instanceof RateLimited) break;
    }
    await sleep(o.gapMs ?? GAP_MS);
  }
  return s;
}
