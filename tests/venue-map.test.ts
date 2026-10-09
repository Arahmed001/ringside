import test from "node:test";
import assert from "node:assert/strict";
import world from "../lib/geo/world-110m.json";
import { project, HEIGHT, WIDTH } from "../lib/geo/project";
import { viewFor } from "../components/WorldMap";
import { decide, nameMatches, addressOf, resolvePlaces, type OsmResult } from "../lib/importers/osm-venues";
import { mapsUrl, topVenues, venuesOfCountry, venueCounts } from "../lib/venues";
import { DatabaseSync } from "node:sqlite";

const C = world.countries as { iso: string; name: string; d: string; box: [number, number, number, number] }[];
const boxOf = (iso: string) => C.find((c) => c.iso === iso)!.box;
const inside = (iso: string, lat: number, lon: number) => { const [x, y] = project(lat, lon), b = boxOf(iso); return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; };

test("the projection puts places where the outlines are: the middle of the map is the middle, and a famous venue's town falls inside its country's box", () => {
  assert.deepEqual(project(0, 0), [WIDTH / 2, HEIGHT / 2]);
  assert.ok(project(60, 0)[1] < project(0, 0)[1] && project(0, 90)[0] > project(0, 0)[0], "north is up, east is right");
  for (const [iso, lat, lon, where] of [["US", 36.1, -115.17, "Las Vegas"], ["US", 40.75, -73.99, "New York"], ["GB", 51.55, -0.28, "Wembley"], ["JP", 35.7, 139.7, "Tokyo"], ["NG", 6.5, 3.4, "Lagos"], ["SA", 24.7, 46.7, "Riyadh"], ["MX", 19.4, -99.1, "Mexico City"], ["AU", -33.9, 151.2, "Sydney"]] as const) assert.ok(inside(iso, lat, lon), `${where} is inside ${iso}`);
});

test("the outlines: 170 or more countries, each with an ISO code once and a path, and the ones boxing cares about are there (France and Norway included)", () => {
  assert.ok(C.length >= 170); assert.equal(new Set(C.map((c) => c.iso)).size, C.length);
  for (const iso of ["US", "GB", "FR", "NO", "MX", "JP", "NG", "SA", "RU", "UA", "PH", "AR", "DE", "KZ", "AU"]) assert.ok(C.find((c) => c.iso === iso), iso);
  assert.ok(C.every((c) => c.d.startsWith("M") && c.box[2] > c.box[0] && c.box[3] > c.box[1]));
});

test("a country's own map: a box around its main land, always 2:1, never outside the world, and a small country is not zoomed in to a smear", () => {
  for (const iso of ["US", "GB", "JP", "NG", "SA", "LU"]) {
    const [x, y, w, h] = viewFor(iso);
    assert.ok(Math.abs(w / h - 2) < 0.02, `${iso}: 2:1`); assert.ok(x >= 0 && y >= 0 && x + w <= 1000.01 && y + h <= 520.01, `${iso}: inside the world`);
  }
  assert.deepEqual(viewFor(undefined).slice(0, 2), [0, 0], "no country: the whole world");
  assert.ok(viewFor("LU")[2] >= 60, "even Luxembourg is shown at least 60 units wide");
  const [lx, ly] = project(36.1, -115.17);
  const v = viewFor("US", [{ x: lx, y: ly, r: 3, label: "x" }]); assert.ok(lx >= v[0] && lx <= v[0] + v[2] && ly >= v[1] && ly <= v[1] + v[3], "a dot is always inside the view");
});

// A real answer from OpenStreetMap's Nominatim (9 October 2026): the MGM Grand Garden Arena, which is in Paradise, not Las Vegas.
const GGA: OsmResult = { osm_type: "way", osm_id: 27897908, lat: "36.1048311", lon: "-115.1685689", category: "leisure", type: "stadium", name: "MGM Grand Garden Arena", display_name: "MGM Grand Garden Arena, South Las Vegas Boulevard, Paradise, Clark County, Nevada, 89158, United States", address: { leisure: "MGM Grand Garden Arena", road: "South Las Vegas Boulevard", town: "Paradise", county: "Clark County", state: "Nevada", "ISO3166-2-lvl4": "US-NV", postcode: "89158", country: "United States", country_code: "us" } };

test("a venue is placed only when it is a venue-type place, in our country, with our name, in our city (or, failing that, named exactly): the real MGM Grand Garden Arena result is an Arena with its address", () => {
  const inTown = decide({ name: "MGM Grand Garden Arena", city: "Paradise", country: "United States" }, [GGA]);
  assert.equal(inTown.status, "found");
  if (inTown.status === "found") { assert.equal(inTown.match.category, "Arena"); assert.equal(inTown.match.address, "South Las Vegas Boulevard, Paradise, NV 89158"); assert.equal(inTown.match.lat, 36.10483); assert.equal(inTown.match.cityConfirmed, true); assert.equal(inTown.match.osmRef, "way/27897908"); }
  const vegas = decide({ name: "MGM Grand Garden Arena", city: "Las Vegas", country: "United States" }, [GGA]);
  assert.equal(vegas.status === "found" && vegas.match.cityConfirmed, false, "the exact name is placed, and it is said that the city is not in the address (the street's name does not count)");
  const loose = decide({ name: "Grand Garden Arena", city: "Las Vegas", country: "United States" }, [GGA]);
  assert.match((loose as { reason: string }).reason, /similar name exists, but not in this city/, "a similar name in another place is not enough");
});

test("what is refused: a shop, another country, another name, another city, two far-apart places with one name, no position", () => {
  const subj = { name: "Memorial Hall", city: "Springfield", country: "United States" };
  const hall = (o: Partial<OsmResult>): OsmResult => ({ osm_type: "node", osm_id: 1, lat: "39.8", lon: "-89.65", category: "amenity", type: "theatre", name: "Memorial Hall", display_name: "Memorial Hall, Springfield, Illinois, United States", address: { city: "Springfield", state: "Illinois", country_code: "us" }, ...o });
  assert.equal(decide(subj, [hall({})]).status, "found");
  assert.match((decide(subj, [hall({ category: "shop", type: "convenience" })]) as { reason: string }).reason, /not a kind of place/);
  assert.match((decide(subj, [hall({ address: { city: "Springfield", country_code: "ca" } })]) as { reason: string }).reason, /not in this country/);
  assert.match((decide(subj, [hall({ name: "Town Library", display_name: "Town Library, Springfield" })]) as { reason: string }).reason, /name/);
  assert.match((decide(subj, [hall({ address: { city: "Boston", country_code: "us" }, display_name: "Memorial Hall, Boston", name: "Memorial Hall Annex" })]) as { reason: string }).reason, /not in this city|similar name/);
  assert.equal(decide(subj, [hall({}), hall({ osm_id: 2, lat: "42.3", lon: "-71.0" })]).status, "ambiguous");
  assert.match((decide(subj, [hall({ lat: "x" })]) as { reason: string }).reason, /usable position/);
  assert.equal(decide(subj, []).status, "no_match");
  // a place OpenStreetMap tags only as a building is a venue when its own name says so, and the same rules then apply
  const wem: OsmResult = { osm_type: "way", osm_id: 9, lat: "51.556", lon: "-0.28", category: "building", type: "yes", name: "Wembley Arena", display_name: "Wembley Arena, Engineers Way, Wembley, London", address: { city: "London", country_code: "gb" } };
  const found = decide({ name: "Wembley Arena", city: "London", country: "United Kingdom" }, [wem]);
  assert.equal(found.status === "found" && found.match.category, "Arena");
  assert.equal(decide({ name: "Wembley Arena", city: "London", country: "United Kingdom" }, [{ ...wem, name: "Wembley Park Tesco", display_name: "Wembley Park Tesco, London" }]).status, "no_match");
  assert.match((decide({ name: "Memorial Hall", city: "Springfield", country: "United States" }, [{ ...wem, name: "Memorial Hall", category: "shop", type: "yes", address: { city: "Springfield", country_code: "us" } }]) as { reason: string }).reason, /not a kind of place/, "a shop named Hall is still a shop");
});

test("names and addresses are compared the way a person would, and never made up", () => {
  assert.equal(nameMatches("O2 Arena", "The O2 Arena"), "exact"); assert.equal(nameMatches("Grand Garden Arena", "MGM Grand Garden Arena"), "close");
  assert.equal(nameMatches("Wembley Stadium", "Wembley Arena"), null, "two words, one shared: not the same place");
  assert.equal(nameMatches("Wembley Arena", "OVO Arena Wembley"), "close", "every word of ours is in a sponsor's name for the same building");
  assert.equal(addressOf({ house_number: "10", road: "High St", city: "Leeds", postcode: "LS1 1AA", state: "England" }), "10 High St, Leeds, England LS1 1AA");
  assert.equal(addressOf({ road: "Only A Road" }), null, "a bare road is not an address");
  assert.equal(addressOf({ road: "Zig-a-Zag Allée Footpath", county: "Greater London", state: "England", postcode: "HA9 0SL" }), null, "no town: no address, rather than a footpath and a county");
  assert.equal(addressOf(undefined), null);
});

test("the lookup keeps OpenStreetMap's rules: an identifying contact, one at a time, a stored answer is not asked again, a venue Wikidata placed is skipped, and a 429 stops it at once", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY, venue TEXT, city TEXT, country TEXT, status TEXT);
    CREATE TABLE venues (name TEXT, city TEXT, status TEXT, lat REAL);
    CREATE TABLE venue_places (name TEXT NOT NULL, city TEXT NOT NULL, country TEXT, status TEXT NOT NULL, reason TEXT, lat REAL, lon REAL, address TEXT, category TEXT, osm_ref TEXT, checked_at TEXT, PRIMARY KEY (name, city));`);
  const ev = db.prepare("INSERT INTO events (venue, city, country, status) VALUES (?,?,?,?)");
  // the live database has no status on its events (NULL); only "cancelled" is excluded
  for (const n of [3, 2, 1]) for (let i = 0; i < n; i++) ev.run(["MGM Grand Garden Arena", "Wembley Arena", "Placed Already"][3 - n], ["Las Vegas", "London", "Leeds"][3 - n], ["United States", "United Kingdom", "United Kingdom"][3 - n], null);
  db.exec("INSERT INTO venues VALUES ('Placed Already', 'Leeds', 'matched', 53.8)");
  const seen: { url: string; ua: string }[] = [];
  const f = (async (u: URL, init?: RequestInit) => { seen.push({ url: String(u), ua: String((init?.headers as Record<string, string>)["user-agent"]) }); return new Response(JSON.stringify(String(u).includes("Grand") ? [GGA] : []), { status: 200 }); }) as unknown as typeof fetch;
  const r = await resolvePlaces(db, { contact: "me@example.org", fetchImpl: f, sleep: async () => {} });
  assert.deepEqual([r.checked, r.found, r.noMatch], [2, 1, 1], "the venue Wikidata placed is not asked about");
  assert.ok(seen.every((s) => /RingsideVenues\/1\.0 \(\+me@example\.org\)/.test(s.ua)) && seen[0].url.startsWith("https://nominatim.openstreetmap.org/search"));
  assert.equal((db.prepare("SELECT status FROM venue_places WHERE name = 'MGM Grand Garden Arena'").get() as { status: string }).status, "found");
  const again = await resolvePlaces(db, { contact: "me@example.org", fetchImpl: f, sleep: async () => {} });
  assert.equal(again.checked, 0, "answers are stored; nothing is asked twice (a miss only after 45 days)");
  await assert.rejects(resolvePlaces(db, { contact: "", fetchImpl: f }), /contact/);
  db.exec("DELETE FROM venue_places"); seen.length = 0;
  const limited = await resolvePlaces(db, { contact: "me@example.org", fetchImpl: (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch, sleep: async () => {} });
  assert.deepEqual([limited.checked, limited.errors], [1, 1], "stopped after the first 429, not 2 requests");
});

const ev = (id: number, venue: string, city: string, country: string, o: Record<string, unknown> = {}) => ({ id, venue, city, country, date: "2026-01-01", status: "completed", upcoming: false, ...o });
const w = {
  events: [ev(1, "Wembley Arena", "London", "England"), ev(2, "Wembley Arena", "London", "England", { date: "2026-05-01" }), ev(3, "O2 Arena", "London", "United Kingdom"), ev(4, "Wembley Arena", "London", "England", { upcoming: true, date: "2027-01-01", status: "scheduled" }), ev(5, "Cancelled Hall", "Leeds", "England", { status: "cancelled" }), ev(6, "T-Mobile Arena", "Las Vegas", "USA"), ev(7, "", "Nowhere", "USA")],
  venueOf: (e: { venue: string }) => (e.venue === "O2 Arena" ? { lat: 51.503, lon: 0.003, capacity: 20000, wikidataId: "Q1" } : null),
  placeOf: (e: { venue: string }) => (e.venue === "Wembley Arena" ? { lat: 51.556, lon: -0.28, address: "Arena Square, Wembley, HA9 0AA", category: "Arena", osmRef: "way/1" } : null),
} as never;

test("the venue list: events counted per venue (cancelled ones not, coming ones apart), the last card, England under the United Kingdom, Wikidata's capacity and OpenStreetMap's address and category carried through", () => {
  const uk = venuesOfCountry(w, "united-kingdom");
  assert.deepEqual(uk.map((v) => [v.name, v.events, v.upcoming]), [["Wembley Arena", 2, 1], ["O2 Arena", 1, 0]], "busiest first; the cancelled hall is not a venue that held fights");
  const wem = uk[0]; assert.deepEqual([wem.lastDate, wem.address, wem.category, wem.osm, wem.lat], ["2026-05-01", "Arena Square, Wembley, HA9 0AA", "Arena", true, 51.556]);
  assert.deepEqual([uk[1].capacity, uk[1].osm, uk[1].lat], [20000, false, 51.503]);
  assert.deepEqual(venuesOfCountry(w, "united-states").map((v) => v.name), ["T-Mobile Arena"]);
  assert.deepEqual(topVenues(w, 2).map((v) => v.name), ["Wembley Arena", "O2 Arena"]);
  assert.deepEqual(venueCounts(w), { all: 3, placed: 2 });
  assert.equal(mapsUrl({ name: "Wembley Arena", city: "London", country: "United Kingdom" }), "https://www.google.com/maps/search/?api=1&query=Wembley%20Arena%2C%20London%2C%20United%20Kingdom");
});
