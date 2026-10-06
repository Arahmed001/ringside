import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { makeBoxer, miniFeed, providerOf, tempDb } from "./helpers";
import type { DatabaseSync } from "node:sqlite";
import type { FeedData } from "../lib/feed";

/**
 * The real league is loaded twice into one database: a partial load first, the complete one later. A second load must bring a fighter's
 * division, country, birth year, first pro year and nickname up to date when the vendor gives a value, and must never blank one it
 * already holds (the vendor leaving a field empty, "Unknown" for a country, or a value an enrichment filled in).
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("reload-updates", "2026-10-03");
after(cleanup);

let db: DatabaseSync;
const row = (ext: string) => db.prepare("SELECT weight_class, country, birth_year, turned_pro, nickname FROM boxers WHERE external_id = ?").get(ext) as
  { weight_class: string; country: string; birth_year: number | null; turned_pro: number | null; nickname: string | null };

const feed = (boxers: FeedData["boxers"]): FeedData => {
  const f = miniFeed();
  f.boxers = boxers; f.bouts = []; f.events = []; f.weighIns = []; f.scorecards = []; f.officials = []; f.corners = []; f.punches = []; f.stints = []; f.people = []; f.orgs = [];
  return f;
};

before(async () => {
  const { getDb } = await import("../lib/db");
  const { ingest } = await import("../lib/ingest");
  db = await getDb();
  await ingest(db, providerOf(feed([
    makeBoxer("A", "Lightweight", { country: "Mexico", birthYear: 1994, turnedPro: 2014 }),
    makeBoxer("B", "Lightweight", { country: "Mexico", birthYear: 1990, turnedPro: 2010, nickname: "Bee" }),
    makeBoxer("C", "Lightweight", { country: "Mexico", birthYear: null, turnedPro: null }),
  ]), "vendor"));
  db.prepare("UPDATE boxers SET birth_year = 1991 WHERE external_id = 'C'").run(); // what the Wikidata enrichment writes into a blank
  await ingest(db, providerOf(feed([
    makeBoxer("A", "Welterweight", { country: "United States", birthYear: 1995, turnedPro: 2015, nickname: "Ace" }),
    makeBoxer("B", "Lightweight", { country: "Unknown", birthYear: null, turnedPro: null }),
    makeBoxer("C", "Lightweight", { country: "Mexico", birthYear: null, turnedPro: null }),
  ]), "vendor"));
});

test("a second load brings the division, country, birth year, first pro year and nickname up to date", () => {
  assert.deepEqual({ ...row("A") }, { weight_class: "Welterweight", country: "United States", birth_year: 1995, turned_pro: 2015, nickname: "Ace" });
});

test("a field the vendor leaves empty, or a country it gives as Unknown, never blanks what is held", () => {
  assert.deepEqual({ ...row("B") }, { weight_class: "Lightweight", country: "Mexico", birth_year: 1990, turned_pro: 2010, nickname: "Bee" });
});

test("a birth year an enrichment filled in survives a load where the vendor still has none", () => {
  assert.equal(row("C").birth_year, 1991);
});
