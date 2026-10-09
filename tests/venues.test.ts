import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import type { DatabaseSync } from "node:sqlite";

process.env.WIKIMEDIA_CONTACT = "tests@invalid.example"; // identifies the bot; no real request is ever made (fetch is mocked)
process.env.WIKIMEDIA_GAP_MS = "0";
process.env.RINGSIDE_NO_SEED = "1"; // an empty database: this file inserts its own events
const cleanup = tempDb("venues");
after(cleanup);

let v: typeof import("../lib/importers/venues");
let db: DatabaseSync;
before(async () => { v = await import("../lib/importers/venues"); db = await (await import("../lib/db")).getDb(); });

interface Fake { qid: string; label: string; alts?: string[]; coord?: string; caps?: string[]; places?: string[]; countries?: string[]; notVenue?: boolean }
let SEARCH: string[] = [];
let FAKES: Fake[] = [];
let calls = { search: 0, sparql: 0 };
const realFetch = globalThis.fetch;
const row = (f: Fake, extra: Record<string, string>) => {
  const o: Record<string, { value: string }> = { v: { value: `http://www.wikidata.org/entity/${f.qid}` }, vLabel: { value: f.label } };
  for (const [k, val] of Object.entries(extra)) o[k] = { value: val };
  return o;
};
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
  if (u.hostname === "www.wikidata.org" && u.searchParams.get("action") === "wbsearchentities") { calls.search++; return json({ search: SEARCH.map((id) => ({ id })) }); }
  if (u.hostname === "query.wikidata.org") {
    calls.sparql++;
    const q = String(init?.body instanceof URLSearchParams ? init.body.get("query") : "");
    const ids = [...q.matchAll(/wd:(Q\d+) /g)].map((m) => m[1]).filter((id) => FAKES.some((f) => f.qid === id));
    const bindings = FAKES.filter((f) => !f.notVenue && ids.includes(f.qid)).flatMap((f) => {
      const rows: Record<string, { value: string }>[] = [];
      const n = Math.max(1, f.caps?.length ?? 0, f.places?.length ?? 0, f.alts?.length ?? 0, f.countries?.length ?? 0);
      for (let i = 0; i < n; i++) rows.push(row(f, {
        ...(f.coord ? { coord: f.coord } : {}), ...(f.caps?.[i] ? { cap: f.caps[i] } : {}), ...(f.places?.[i] ? { placeLabel: f.places[i] } : {}),
        ...(f.alts?.[i] ? { alt: f.alts[i] } : {}), ...(f.countries?.[i] ? { countryLabel: f.countries[i] } : {}),
      }));
      return rows;
    });
    return json({ results: { bindings } });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;
afterEach(() => { SEARCH = []; FAKES = []; calls = { search: 0, sparql: 0 }; });
test.after(() => { globalThis.fetch = realFetch; });

const S = { name: "T-Mobile Arena", city: "Las Vegas", country: "United States" };
const setup = (fakes: Fake[]) => { FAKES = fakes; SEARCH = fakes.map((f) => f.qid); };
const arena = (over: Partial<Fake> = {}): Fake => ({ qid: "Q1", label: "T-Mobile Arena", coord: "Point(-115.178 36.1029)", caps: ["20000"], places: ["Las Vegas", "Clark County", "Nevada"], countries: ["United States"], ...over });

test("accepts a verified venue in our city, with coordinates and capacity", async () => {
  setup([arena()]);
  const r = await v.findVenue(S);
  assert.equal(r.status, "matched");
  if (r.status === "matched") assert.deepEqual(r.match, { qid: "Q1", label: "T-Mobile Arena", lat: 36.1029, lon: -115.178, capacity: 20000, basis: "city" });
});

test("a venue filed under a district is accepted on the country, and says so", async () => {
  setup([arena({ places: ["Paradise", "Clark County", "Nevada"] })]);
  const r = await v.findVenue(S);
  assert.equal(r.status, "matched");
  if (r.status === "matched") assert.equal(r.match.basis, "country");
});

test("name matching ignores case, accents, punctuation, a leading 'the', and uses aliases", async () => {
  setup([arena({ label: "The Ryōgoku Kokugikan", alts: ["Kokugikan"] })]);
  assert.equal((await v.findVenue({ ...S, name: "RYOGOKU KOKUGIKAN" })).status, "matched");
  assert.equal((await v.findVenue({ ...S, name: "Kokugikan" })).status, "matched", "an alias is a name too");
  assert.equal((await v.findVenue({ ...S, name: "Kokugikan Annex" })).status, "no_match");
});

test("refuses what it cannot verify: wrong city and country, not a venue, wrong name, nothing found", async () => {
  const why = async (fakes: Fake[], s = S) => { setup(fakes); const r = await v.findVenue(s); assert.notEqual(r.status, "matched"); return r.status === "matched" ? "" : r.reason; };
  assert.match(await why([arena({ places: ["Berlin"], countries: ["Germany"] })]), /not in this city or country/, "same name, different country");
  assert.match(await why([arena({ notVenue: true })]), /no venue-type entity/, "a person or a district that happens to share the name");
  assert.match(await why([arena({ label: "Garden Arena" })]), /no venue by that name/);
  assert.match(await why([]), /no Wikidata entity/);
});

test("two venues with the same name are ambiguous, unless exactly one is labelled as ours (the alias trap)", async () => {
  setup([arena({ qid: "Q1" }), arena({ qid: "Q2" })]);
  const both = await v.findVenue(S);
  assert.equal(both.status, "ambiguous");
  assert.match(both.status === "ambiguous" ? both.reason : "", /Q1, Q2/, "names the candidates so a person can look");
  // the O2 case: the district's alias is "O2 Arena", the arena's label is "The O2 Arena"
  setup([arena({ qid: "Q10", label: "The O2", alts: ["O2 Arena"], caps: [] }), arena({ qid: "Q11", label: "The O2 Arena", caps: ["20000"] })]);
  const o2 = await v.findVenue({ name: "O2 Arena", city: "Las Vegas", country: "United States" });
  assert.equal(o2.status, "matched");
  if (o2.status === "matched") assert.equal(o2.match.qid, "Q11");
});

test("capacity is the median of the values, and implausible values and bad coordinates are dropped", async () => {
  setup([arena({ caps: ["18000", "20000", "22000", "5", "99999999"], coord: "Point(500 99)" })]);
  const r = await v.findVenue(S);
  assert.equal(r.status, "matched");
  if (r.status === "matched") { assert.equal(r.match.capacity, 20000); assert.equal(r.match.lat, null); assert.equal(r.match.lon, null); }
  setup([arena({ caps: [] })]);
  const none = await v.findVenue(S);
  assert.ok(none.status === "matched" && none.match.capacity === null, "no capacity on Wikidata: none, not a guess");
});

test("the worker checks each venue once, busiest first, keeps misses for 45 days, and never overwrites a match", async () => {
  const ins = db.prepare("INSERT INTO events (external_id, name, date, venue, city, country, status) VALUES (?,?,?,?,?,?,?)");
  for (let i = 0; i < 3; i++) ins.run(`a${i}`, `A${i}`, `2026-01-0${i + 1}`, "T-Mobile Arena", "Las Vegas", "United States", "completed");
  ins.run("b0", "B0", "2026-02-01", "Nowhere Hall", "Atlantis", "Nowhereland", "completed");
  setup([arena()]);
  const logs: string[] = [];
  const s1 = await v.resolveVenues(db, { log: (m) => logs.push(m) });
  assert.deepEqual(s1, { checked: 2, matched: 1, noMatch: 1, ambiguous: 0, errors: 0 });
  assert.match(logs[0], /T-Mobile Arena/, "the venue with three cards goes first");
  const saved = db.prepare("SELECT status, wikidata_id, capacity, basis FROM venues WHERE name = 'T-Mobile Arena'").get() as Record<string, unknown>;
  assert.deepEqual({ ...saved }, { status: "matched", wikidata_id: "Q1", capacity: 20000, basis: "city" });
  calls = { search: 0, sparql: 0 };
  const s2 = await v.resolveVenues(db);
  assert.equal(s2.checked, 0, "checked venues are not asked about again");
  assert.equal(calls.search, 0);
  db.exec("UPDATE venues SET checked_at = '2020-01-01T00:00:00.000Z'");
  const s3 = await v.resolveVenues(db);
  assert.equal(s3.checked, 1, "only the miss is retried after 45 days; the match stays");
});

test("verified venues reach the world and the event page data, and unverified ones do not", async () => {
  const worldMod = await import("../lib/world");
  worldMod.invalidateWorld();
  const w = await worldMod.getWorld();
  const e = w.events.find((x) => x.venue === "T-Mobile Arena")!;
  assert.deepEqual(w.venueOf(e) && { id: w.venueOf(e)!.wikidataId, cap: w.venueOf(e)!.capacity }, { id: "Q1", cap: 20000 });
  assert.equal(w.venueOf({ venue: "Nowhere Hall", city: "Atlantis" }), null);
  db.prepare("INSERT INTO venues (name, city, status, reason, checked_at) VALUES ('X Arena','Y','ambiguous','two',?)").run(new Date().toISOString());
  worldMod.invalidateWorld();
  assert.equal((await worldMod.getWorld()).venueOf({ venue: "X Arena", city: "Y" }), null, "an ambiguous result is never shown");
});

test("one hall written several ways in one city becomes one venue, and a different hall in the same city does not", async () => {
  const { unifyVenueSpellings } = await import("../lib/venue-spellings");
  const ins = db.prepare("INSERT INTO events (name, date, venue, city, country) VALUES (?,?,?,?,?)");
  db.exec("DELETE FROM events");
  for (const [i, [venue, city]] of ([["AT&T Stadium", "Arlington"], ["AT&T Stadium", "Arlington"], ["AT & T Stadium", "Arlington"], ["Casino de Montreal", "Montreal"], ["Casino de Montréal", "Montreal"], ["Casino de Montreal", "Montreal"], ["Arena Two", "Arlington"], ["AT&T Stadium", "Dallas"]] as const).entries())
    ins.run(`E${i}`, `2025-01-0${i + 1}`, venue, city, "X");
  const r = unifyVenueSpellings(db);
  assert.deepEqual([r.groups, r.spellings, r.events, r.cities], [2, 2, 2, 0]);
  const names = (city: string) => (db.prepare("SELECT venue, COUNT(*) n FROM events WHERE city = ? GROUP BY venue ORDER BY venue").all(city) as { venue: string; n: number }[]).map((x) => `${x.venue}:${x.n}`);
  assert.deepEqual(names("Arlington"), ["AT&T Stadium:3", "Arena Two:1"]);
  assert.deepEqual(names("Montreal"), ["Casino de Montreal:3"], "the spelling most events use wins");
  assert.deepEqual(names("Dallas"), ["AT&T Stadium:1"], "the same name in another city is another venue");
  assert.deepEqual(unifyVenueSpellings(db), { groups: 0, spellings: 0, events: 0, cities: 0 }, "running it again changes nothing");
});

test("a city field that only repeats the hall's name takes the real city the same hall has elsewhere, when that is clear", async () => {
  const { unifyVenueSpellings } = await import("../lib/venue-spellings");
  const ins = db.prepare("INSERT INTO events (name, date, venue, city, country) VALUES (?,?,?,?,?)");
  db.exec("DELETE FROM events");
  const rows: [string, string, string][] = [["Manchester Arena", "Manchester", "England"], ["Manchester Arena", "Manchester", "England"], ["Manchester Arena", "Manchester Arena", "England"], ["Aberdeen", "Aberdeen", "Scotland"], ["Hall X", "Town A", "France"], ["Hall X", "Town B", "France"], ["Hall X", "Hall X", "France"]];
  rows.forEach(([venue, city, country], i) => ins.run(`F${i}`, `2025-02-0${i + 1}`, venue, city, country));
  assert.equal(unifyVenueSpellings(db).cities, 1, "only the clear case is changed");
  const cities = (venue: string) => (db.prepare("SELECT city, COUNT(*) n FROM events WHERE venue = ? GROUP BY city ORDER BY city").all(venue) as { city: string; n: number }[]).map((x) => `${x.city}:${x.n}`);
  assert.deepEqual(cities("Manchester Arena"), ["Manchester:3"]);
  assert.deepEqual(cities("Aberdeen"), ["Aberdeen:1"], "a venue that is only a city stays as it is");
  assert.deepEqual(cities("Hall X"), ["Hall X:1", "Town A:1", "Town B:1"], "an even split between two cities is left alone");
});
