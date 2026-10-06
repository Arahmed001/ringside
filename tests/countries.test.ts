import test from "node:test";
import assert from "node:assert/strict";
import { countryList, countryView, countrySlug } from "../lib/countries";
import { canonicalCountry } from "../lib/format";
import { sitemapPaths } from "../lib/sitemap";

/** Country pages are built from the fighters, belts, fights and events already held. A tiny hand-made world shows what each section counts and leaves out. */
const boxer = (id: number, country: string, o: Record<string, unknown> = {}) => ({ id, slug: `f${id}`, name: `Fighter ${id}`, country, bouts: 5, active: true, rating: 1500 + id, ...o });
const world = () => {
  const boxers = [
    boxer(1, "Mexico", { rating: 1700 }), boxer(2, "Mexico", { rating: 1600, active: false }), boxer(3, "Mexico", { rating: 1650 }), boxer(4, "Mexico", { bouts: 0 }),
    boxer(5, "Japan"), boxer(6, "Côte d'Ivoire"), boxer(7, "Cote d'Ivoire"), boxer(8, "Cote d'Ivoire"), boxer(9, "", {}), boxer(10, "Mexico"),
  ];
  const bouts = [
    { id: 100, upcoming: true, status: "scheduled", redId: 1, blueId: 5, date: "2026-12-01", eventName: "A", redName: "x", blueName: "y", eventId: 1 },
    { id: 101, upcoming: true, status: "cancelled", redId: 3, blueId: 5, date: "2026-11-01", eventName: "B", redName: "x", blueName: "y", eventId: 2 },
    { id: 102, upcoming: true, status: "scheduled", redId: 5, blueId: 6, date: "2026-11-15", eventName: "C", redName: "x", blueName: "y", eventId: 3 },
    { id: 103, upcoming: false, status: "completed", redId: 1, blueId: 3, date: "2025-01-01", eventName: "D", redName: "x", blueName: "y", eventId: 4 },
    { id: 104, upcoming: true, status: "scheduled", redId: 3, blueId: 5, date: "2026-10-20", eventName: "E", redName: "x", blueName: "y", eventId: 5 },
  ];
  const events = [
    { id: 1, country: "Mexico", date: "2025-03-01", status: "completed", upcoming: false }, { id: 2, country: "Mexico", date: "2026-03-01", status: "completed", upcoming: false },
    { id: 3, country: "Mexico", date: "2026-12-01", status: "scheduled", upcoming: true }, { id: 4, country: "Mexico", date: "2024-03-01", status: "cancelled", upcoming: false },
    { id: 5, country: "Japan", date: "2025-03-01", status: "completed", upcoming: false },
  ];
  return { boxers, bouts, events, byId: new Map(boxers.map((b) => [b.id, b])), boutsByEvent: new Map(), orgs: new Map(), people: new Map(), reignsByBoxer: new Map(), today: "2026-10-03" } as never;
};

test("the list: countries with a fighter who has fought, most fighters first; one country however it is spelled, under its proper English name", () => {
  const list = countryList(world());
  assert.deepEqual(list.map((c) => [c.slug, c.name, c.fighters]), [["mexico", "Mexico", 4], ["cote-d-ivoire", "Côte d’Ivoire", 3], ["japan", "Japan", 1]], "a fighter with no fights and one with no country are not counted; two spellings of one address are one country");
  assert.equal(list[0].active, 3);
  assert.equal(countrySlug("United States"), "united-states");
});

test("spellings of one country are one page; sub-nations and unknown names are kept as given", () => {
  for (const s of ["USA", "U.S.", "us", "United States of America", " united states "]) assert.equal(countrySlug(s), "united-states", s);
  assert.equal(canonicalCountry("USA"), "United States");
  assert.equal(canonicalCountry("Great Britain"), "United Kingdom");
  assert.equal(canonicalCountry("Turkey"), "Turkey");
  assert.equal(canonicalCountry("England"), "England", "England is not folded into the UK");
  assert.equal(canonicalCountry("Northern Ireland"), "Northern Ireland");
  assert.equal(canonicalCountry("Atlantis"), "Atlantis");
  const w = world() as never as { boxers: unknown[] };
  w.boxers.push(boxer(11, "USA"), boxer(12, "United States"), boxer(13, "U.S.A."));
  const us = countryList(w as never).find((c) => c.slug === "united-states")!;
  assert.deepEqual([us.name, us.fighters], ["United States", 3]);
});

test("a country page: its fighters (active first, then by rating), its coming fights soonest first, only held and not cancelled events", () => {
  const v = countryView(world(), "mexico")!;
  assert.deepEqual(v.top.map((b) => b.id), [1, 3, 10, 2], "active first by rating, the retired one last, the unfought one not at all");
  assert.deepEqual(v.next.map((b) => b.id), [104, 100], "soonest first; the cancelled fight and the one with nobody from here are left out");
  assert.deepEqual(v.events.map((e) => e.id), [2, 1], "newest first; the upcoming and the cancelled card are not 'held here'");
  assert.equal(v.eventCount, 2);
  assert.equal(countryView(world(), "mexico", { top: 1, next: 1, events: 1 })!.top.length, 1, "the limits cut the lists, not the counts");
  assert.equal(countryView(world(), "mexico", { top: 1, next: 1, events: 1 })!.fighters, 4);
  assert.equal(countryView(world(), "atlantis"), null, "an unknown country is a 404, not an empty page");
});

test("the sitemap lists the index and every country page", () => {
  const paths = sitemapPaths(world()).map((p) => p.path);
  assert.ok(paths.includes("/countries"));
  for (const s of ["mexico", "japan", "cote-d-ivoire"]) assert.ok(paths.includes(`/countries/${s}`), s);
});

test("Serbia has its own flag and code (the platform also names the retired code YU 'Serbia', which must not win) (round 101)", async () => {
  const { flag, countryCode, canonicalCountry, countryName } = await import("../lib/format");
  assert.equal(countryCode("Serbia"), "RS"); assert.equal(countryCode("RS"), "RS"); assert.equal(flag("Serbia"), "🇷🇸"); assert.equal(canonicalCountry("RS"), "Serbia");
  assert.notEqual(countryName("Serbia", "ar"), "Serbia");
});
