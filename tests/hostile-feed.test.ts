import test, { after } from "node:test";
import assert from "node:assert/strict";
import { badNumbers, tempDb } from "./helpers";

/**
 * A league made of awkward values (lib/hostile-feed.ts), read through the real adapter, validator, ingest and world. What it pins down is not which fights survive (that is
 * for the tests of each rule) but that nothing throws, nothing is lost without being counted, and text that looks like code or SQL is only ever data.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("hostile");
after(cleanup);
delete process.env.BOXING_API_STORAGE_CONFIRMED;

import { boxingDataApiProvider } from "../lib/providers/boxing-data-api";
import { hostileFetch, HOSTILE_FIGHTS, HOSTILE_FIGHTERS, HOSTILE_MARKUP } from "../lib/hostile-feed";
import { loadFeed } from "../lib/feed";
import { sanitizeFeed } from "../lib/validate";

const provider = () => boxingDataApiProvider({ key: "k".repeat(40), purpose: "ingest", fetchImpl: hostileFetch(), scheduleDays: 0, maxRequests: 1e6, retries: 0, gapMs: 0, log: () => {}, sleep: async () => {} });

test("the adapter and the validator read the league without throwing, and every fight fed in is kept or counted as set aside", async () => {
  const p = provider();
  const feed = await loadFeed(p);
  const n = p.notes();
  const repeated = HOSTILE_FIGHTS.length - new Set(HOSTILE_FIGHTS.map((x) => x.id)).size;
  assert.ok(repeated >= 1, "the league repeats a fight id on purpose");
  assert.equal(HOSTILE_FIGHTS.length, repeated + n.fightsSkipped + n.boutsDroppedUnknownFighter + n.boutsOutsideSelection + n.boutsDroppedNoDivision + feed.bouts.length,
    "every fight is a repeat, skipped (and counted), dropped for a missing fighter or division (and counted), or a bout of the feed");
  const s = sanitizeFeed(feed, { today: "2026-10-03" });
  assert.equal(feed.bouts.length, s.feed.bouts.length + (s.dropped.bout ?? 0), "every bout of the feed is kept by the validator or dropped and counted");
  const errors = s.issues.filter((i) => i.severity === "error" && i.entity === "bout");
  assert.equal(errors.length, s.dropped.bout ?? 0, "and every dropped bout has an error that names it");
  assert.ok(s.feed.bouts.length >= 5, "most of the league is read, not thrown away");
});

test("ingested, the league is a world the app can use: no impossible number anywhere, text that looks like code or SQL is stored as text, and nothing references a fighter that is not there", async () => {
  process.env.BOXING_API_STORAGE_CONFIRMED = "1";
  try {
    const db = await (await import("../lib/db")).getDb();
    const { ingest } = await import("../lib/ingest");
    const report = await ingest(db, provider());
    assert.equal(typeof report.errors, "number");
    const w = await (await import("../lib/world")).getWorld();
    assert.ok(w.boxers.length >= 8 && w.bouts.length >= 5);
    assert.deepEqual(badNumbers(w.boxers), [], "no NaN or infinity in any fighter");
    assert.deepEqual(badNumbers(w.bouts), [], "none in any fight");
    const names = w.boxers.map((b) => b.name);
    assert.ok(names.some((x) => x.includes(HOSTILE_MARKUP)), "markup in a name is kept as the text it is");
    assert.ok(names.some((x) => x.startsWith("Robert'); DROP TABLE boxers;--")), "so is SQL, and the table is still there");
    assert.ok((db.prepare("SELECT count(*) AS n FROM boxers").get() as { n: number }).n >= 8);
    const slugs = w.boxers.map((b) => b.slug);
    assert.equal(new Set(slugs).size, slugs.length, "every slug is its own address, even for two fighters of one name");
    assert.ok(slugs.every((x) => /^[a-z0-9-]+$/.test(x) && x.length > 0 && x.length <= 110), "and an address (letters, digits, hyphens, short), not a copy of a 300-letter name or an emoji");
    for (const b of w.bouts) assert.ok(w.byId.has(b.redId) && w.byId.has(b.blueId), `bout ${b.id} has both fighters`);
    assert.ok(HOSTILE_FIGHTERS.length >= 12);
  } finally { delete process.env.BOXING_API_STORAGE_CONFIRMED; }
});

test("what the site computes over the league does not throw: search, rankings in every division, countries, careers and a fighter's counting facts", async () => {
  const w = await (await import("../lib/world")).getWorld();
  const { searchFighters } = await import("../lib/fighter-search");
  const { rankedBoxers } = await import("../lib/rankings");
  const { DIVISIONS } = await import("../lib/divisions");
  const { countryList } = await import("../lib/countries");
  const { careerView } = await import("../lib/career");
  const { numbersOf } = await import("../lib/by-the-numbers");
  const { form, since } = await import("../lib/glance");
  for (const q of ["O'Brien", "<script>", "Robert'); DROP", "محمد", "a", "zz", "W".repeat(40), "  ", "%", "\\"]) assert.doesNotThrow(() => searchFighters(w, q, { limit: 8 }), q);
  for (const d of DIVISIONS) for (const sex of ["male", "female"] as const) assert.doesNotThrow(() => rankedBoxers(w, d.name, sex), d.name);
  assert.doesNotThrow(() => countryList(w));
  for (const b of w.boxers) {
    assert.doesNotThrow(() => careerView(b));
    const fights = w.boutsByBoxer.get(b.id) ?? [];
    assert.doesNotThrow(() => numbersOf(fights, b.id, (id) => w.eventById.get(id)));
    assert.doesNotThrow(() => form(fights, b.id));
    if (b.lastFight) assert.doesNotThrow(() => since(w.today, b.lastFight!));
  }
});

test("a card whose every fight the validator rejected is set aside and named; a card the feed announced empty, or one with money records, is left alone", async () => {
  const { miniFeed } = await import("./helpers");
  const base = miniFeed();
  const ev = (id: string) => ({ externalId: id, name: `Card ${id}`, date: "2025-02-01", venue: "Arena", city: "Las Vegas", country: "United States" });
  const goodBout = base.bouts[0];
  const badBout = (id: string, event: string) => ({ ...goodBout, externalId: id, eventExternalId: event, rounds: 99 }); // a hundred-round fight: rejected
  const feed = {
    ...base,
    events: [...base.events, ev("EMPTIED"), ev("ANNOUNCED"), ev("MONEY"), ev("PARTLY")],
    bouts: [goodBout, badBout("b-emptied", "EMPTIED"), badBout("b-money", "MONEY"), badBout("b-partly-bad", "PARTLY"), { ...goodBout, externalId: "b-partly-good", eventExternalId: "PARTLY" }],
    financials: [{ eventExternalId: "MONEY", gateUsd: 1_000_000, basis: "disclosed" as const, source: "Test", sourceUrl: "https://example.com/g" }],
  };
  const s = sanitizeFeed(feed, { today: "2026-10-03" });
  const ids = new Set(s.feed.events.map((e) => e.externalId));
  assert.ok(!ids.has("EMPTIED"), "every fight rejected: the card is set aside");
  assert.ok(ids.has("ANNOUNCED"), "a card announced with no fights is the feed's own, and stays");
  assert.ok(ids.has("MONEY"), "a card with a money record stays, so the record has its card");
  assert.ok(ids.has("PARTLY"), "a card with a fight left stays");
  assert.ok(ids.has("E1"));
  assert.equal(s.dropped.event, 1);
  assert.ok(s.issues.some((i) => i.code === "event_emptied" && i.ref === "EMPTIED" && i.severity === "warning"), "and it is named, as a warning");
  assert.equal(s.issues.filter((i) => i.code === "event_emptied").length, 1);
});

test("no event is left without a fight: the adapter drops the events of the fights it drops, and counts them; in a partial load too, where most small cards lose every fight", async () => {
  const p = provider();
  const feed = await loadFeed(p);
  const onCard = new Set(feed.bouts.map((b) => b.eventExternalId));
  assert.deepEqual(feed.events.filter((e) => !onCard.has(e.externalId)).map((e) => e.name), [], "every event of the feed has a fight");
  assert.ok(p.notes().eventsWithoutFights >= 1, "the hostile league has a card whose only fight was dropped (a fighter with no name), and it is counted");

  // the real shape of a first load: most of a league's fighters are left out, and a fight with one of them goes too
  const { makeWorld, mockVendor } = await import("../lib/vendor-mock");
  const league = makeWorld({ fighters: 120, fights: 240, upcoming: 4, seed: 11, today: "2026-10-03" });
  const part = boxingDataApiProvider({ key: "k".repeat(40), purpose: "evaluation", fetchImpl: mockVendor(league).fetchImpl, scheduleDays: 0, maxRequests: 1e6, retries: 0, gapMs: 0, maxFighters: 25, log: () => {}, sleep: async () => {} });
  const small = await loadFeed(part);
  const cards = new Set(small.bouts.map((b) => b.eventExternalId));
  assert.ok(small.events.length > 0 && small.bouts.length > 0);
  assert.deepEqual(small.events.filter((e) => !cards.has(e.externalId)).length, 0, "a partial load has no card without a fight");
  assert.ok(part.notes().eventsWithoutFights > 0, "and the cards it left out are counted");
});
