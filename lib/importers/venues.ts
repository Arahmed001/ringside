/**
 * Resolves the venues on our fight cards to Wikidata (CC0) for coordinates and capacity.
 *
 * Wikidata has almost no professional fight cards (its boxing "events" are amateur championships and multi-sport
 * Games, located at city level), so there is nothing to import wholesale; instead each venue name from our own events
 * is looked up and accepted only when it can be verified, in the spirit of the headshot resolver: a wrong stadium
 * is worse than none.
 *
 * A candidate is accepted only if ALL hold:
 *  1. it is an instance of a venue class (stadium, arena, sports venue, convention centre, casino, theatre, event venue);
 *  2. its name is the venue we have (label or alias, ignoring case, accents and punctuation) AND exactly one such candidate exists;
 *  3. it is in our city (anywhere up its "located in" chain, e.g. Barclays Center → Brooklyn → New York City) or, failing that,
 *     it is in our country, because Wikidata files some venues under a district (T-Mobile Arena is in Paradise, not Las Vegas).
 * Capacity is the median of Wikidata's best-ranked values; it is a general figure, not the boxing configuration.
 */
import { unifyVenueSpellings } from "../venue-spellings";
import { linkBroadcasters } from "../broadcaster-link";
import type { DatabaseSync } from "node:sqlite";
import { api, userAgent } from "../media/wikimedia";
import { sparql, type Binding } from "./wikidata";

const WIKIDATA = "https://www.wikidata.org/w/api.php";
// stadium, arena, sports venue, convention center, casino, theatre (building), event venue
export const VENUE_CLASSES = ["Q483110", "Q641226", "Q1076486", "Q1329623", "Q133215", "Q24354", "Q18674739"];

export interface VenueSubject { name: string; city: string; country: string }
export interface VenueMatch { qid: string; label: string; lat: number | null; lon: number | null; capacity: number | null; basis: "city" | "country" }
export type VenueOutcome = { status: "matched"; match: VenueMatch } | { status: "no_match" | "ambiguous"; reason: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

export function candidateQuery(qids: string[]): string {
  return `SELECT ?v ?vLabel ?alt ?coord ?cap ?placeLabel ?countryLabel WHERE {
  VALUES ?v { ${qids.map((q) => `wd:${q}`).join(" ")} }
  VALUES ?cls { ${VENUE_CLASSES.map((q) => `wd:${q}`).join(" ")} }
  ?v wdt:P31/wdt:P279* ?cls .
  OPTIONAL { ?v wdt:P625 ?coord }
  OPTIONAL { ?v wdt:P1083 ?cap }
  OPTIONAL { ?v wdt:P131* ?place }
  OPTIONAL { ?v wdt:P17 ?country }
  OPTIONAL { ?v skos:altLabel ?alt FILTER(LANG(?alt) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

export interface Cand { qid: string; names: Set<string>; label: string; lat: number | null; lon: number | null; caps: number[]; places: Set<string>; countries: Set<string> }

export function parseCandidates(bindings: Binding[]): Cand[] {
  const by = new Map<string, Cand>();
  for (const b of bindings) {
    const qid = b.v?.value.split("/").pop();
    if (!qid) continue;
    const c = by.get(qid) ?? by.set(qid, { qid, names: new Set(), label: qid, lat: null, lon: null, caps: [], places: new Set(), countries: new Set() }).get(qid)!;
    const lab = b.vLabel?.value;
    if (lab && !/^Q\d+$/.test(lab)) { c.label = lab; c.names.add(norm(lab)); }
    if (b.alt?.value) c.names.add(norm(b.alt.value));
    const pt = b.coord?.value.match(/^Point\((-?[\d.]+) (-?[\d.]+)\)$/);
    if (pt && c.lat === null) { const lon = Number(pt[1]), lat = Number(pt[2]); if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { c.lat = Math.round(lat * 1e5) / 1e5; c.lon = Math.round(lon * 1e5) / 1e5; } }
    const cap = Number(b.cap?.value);
    if (b.cap && Number.isFinite(cap) && cap >= 50 && cap <= 400000 && !c.caps.includes(cap)) c.caps.push(cap);
    if (b.placeLabel?.value && !/^Q\d+$/.test(b.placeLabel.value)) c.places.add(norm(b.placeLabel.value));
    if (b.countryLabel?.value && !/^Q\d+$/.test(b.countryLabel.value)) c.countries.add(norm(b.countryLabel.value));
  }
  return [...by.values()];
}

/** Pure decision step, exported so every rule can be tested without a network. */
export function decide(s: VenueSubject, cands: Cand[]): VenueOutcome {
  const named = cands.filter((c) => c.names.has(norm(s.name)));
  if (!named.length) return { status: "no_match", reason: cands.length ? "no venue by that name" : "no venue-type entity found" };
  const city = norm(s.city), country = norm(s.country);
  const inCity = named.filter((c) => c.places.has(city));
  const pool = inCity.length ? inCity : named.filter((c) => c.countries.has(country));
  if (!pool.length) return { status: "no_match", reason: "a venue with that name exists, but not in this city or country" };
  // an alias can name a neighbour (the O2 district is also called "O2 Arena"): when exactly one candidate is LABELLED as ours, that is the venue
  const byLabel = pool.length > 1 ? pool.filter((c) => norm(c.label) === norm(s.name)) : [];
  if (byLabel.length === 1) pool.splice(0, pool.length, byLabel[0]);
  if (pool.length > 1) return { status: "ambiguous", reason: `${pool.length} venues share that name in ${inCity.length ? "this city" : "this country"} (${pool.map((c) => c.qid).join(", ")})` };
  const c = pool[0];
  return { status: "matched", match: { qid: c.qid, label: c.label, lat: c.lat, lon: c.lon, capacity: c.caps.length ? median(c.caps) : null, basis: inCity.length ? "city" : "country" } };
}

export async function findVenue(s: VenueSubject): Promise<VenueOutcome> {
  const found = await api<{ search?: { id: string }[] }>(WIKIDATA, { action: "wbsearchentities", search: s.name, language: "en", type: "item", limit: "10" });
  const ids = (found.search ?? []).map((x) => x.id);
  if (!ids.length) return { status: "no_match", reason: "no Wikidata entity with that name" };
  return decide(s, parseCandidates(await sparql(candidateQuery(ids))));
}

export interface VenueSummary { checked: number; matched: number; noMatch: number; ambiguous: number; errors: number }
const RECHECK_DAYS = 45;

/** Looks up venues from our events that have not been checked yet (busiest first); misses are retried after 45 days. */
export async function resolveVenues(db: DatabaseSync, opts: { limit?: number; log?: (m: string) => void } = {}): Promise<VenueSummary> {
  const { limit = 50, log = () => {} } = opts;
  userAgent(); // fail fast, before any work, if WIKIMEDIA_CONTACT is not set
  const folded = unifyVenueSpellings(db);
  const bc = linkBroadcasters(db);
  if (bc.broadcasters) log(`broadcasters: ${bc.broadcasters} channels linked to ${bc.events} cards`);
  if (folded.spellings || folded.cities) log(`venues: ${folded.spellings} spellings folded into ${folded.groups} halls (${folded.events} events renamed); ${folded.cities} events given the hall's real city`);
  const cutoff = new Date(Date.now() - RECHECK_DAYS * 86400000).toISOString();
  const rows = db.prepare(`
    SELECT e.venue AS name, e.city, e.country, COUNT(*) AS n FROM events e
    LEFT JOIN venues v ON v.name = e.venue AND v.city = e.city
    WHERE v.name IS NULL OR (v.status <> 'matched' AND v.checked_at < ?)
    GROUP BY e.venue, e.city, e.country ORDER BY n DESC, e.venue LIMIT ?`).all(cutoff, limit) as unknown as (VenueSubject & { n: number })[];
  const save = db.prepare(`INSERT INTO venues (name, city, country, status, reason, wikidata_id, label, lat, lon, capacity, basis, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(name, city) DO UPDATE SET country=excluded.country, status=excluded.status, reason=excluded.reason, wikidata_id=excluded.wikidata_id, label=excluded.label,
    lat=excluded.lat, lon=excluded.lon, capacity=excluded.capacity, basis=excluded.basis, checked_at=excluded.checked_at`);
  const s: VenueSummary = { checked: 0, matched: 0, noMatch: 0, ambiguous: 0, errors: 0 };
  for (const r of rows) {
    s.checked++;
    try {
      const out = await findVenue(r);
      const now = new Date().toISOString();
      if (out.status === "matched") {
        const m = out.match;
        save.run(r.name, r.city, r.country, "matched", null, m.qid, m.label, m.lat, m.lon, m.capacity, m.basis, now);
        s.matched++;
        log(`✓ ${r.name}, ${r.city} → ${m.qid} ${m.label}${m.capacity ? ` · ${m.capacity.toLocaleString("en")} seats` : ""} (${m.basis})`);
      } else {
        save.run(r.name, r.city, r.country, out.status, out.reason, null, null, null, null, null, null, now);
        if (out.status === "ambiguous") s.ambiguous++; else s.noMatch++;
        log(`– ${r.name}, ${r.city}: ${out.reason}`);
      }
    } catch (e) {
      s.errors++;
      log(`! ${r.name}: ${(e as Error).message}`);
    }
  }
  return s;
}
