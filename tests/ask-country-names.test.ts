import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/**
 * A real league has 196 countries, and many names contain another's: Somalia holds Mali, South Sudan holds Sudan, Papua New Guinea holds Guinea, French Polynesia
 * and American Samoa begin with a nationality, "United Arab Emirates" holds "Arab", and "South Africa" holds the region word Africa. The first real league had all of
 * them, and the question planner answered for the wrong country (found by asking "fighters from X" for every country in it: 14 of 196 were wrong).
 */
const cleanup = tempDb("ask-country-names");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-acn-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

const COUNTRIES = ["Mali", "Somalia", "Guinea", "Papua New Guinea", "Sudan", "South Sudan", "France", "French Polynesia", "United States", "American Samoa", "China", "Hong Kong SAR China",
  "United Arab Emirates", "South Africa", "Central African Republic", "Niger", "Nigeria", "Mexico", "Georgia"];
type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let plan: typeof import("../lib/ask/rules").planByRules;

before(async () => {
  const feed = miniFeed();
  feed.boxers = [...COUNTRIES.map((c, i) => makeBoxer(`c${i}`, "Lightweight", { name: `Fighter${String.fromCharCode(65 + i)} Test${String.fromCharCode(97 + i)}`, country: c })), makeBoxer("k1", "Lightweight", { name: "Jong Seon Kang", country: "South Korea" })];
  feed.bouts = []; feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = []; feed.stints = [];
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
  plan = (await import("../lib/ask/rules")).planByRules;
});

test("a country is found by its whole name, the longest first: no country is read for another that its name contains", () => {
  const bad = COUNTRIES.flatMap((c) => [`fighters from ${c}`, `best boxers from ${c}`, `how many fighters are from ${c}`, `${c} fighters`.toLowerCase()].flatMap((q) => {
    const p = plan(q, w, {})[0];
    return p && p.tool === "fighters" && p.args.country === c ? [] : [`"${q}" -> ${p ? p.tool + JSON.stringify(p.args) : "none"}`];
  }));
  assert.deepEqual(bad, []);
});

test("a nationality still names its country, and a word of a country's name is not a nationality inside it", () => {
  const country = (q: string) => plan(q, w, {})[0]?.args.country;
  assert.equal(country("South African fighters"), "South Africa");
  assert.equal(country("American fighters"), "United States");
  assert.equal(country("Mexican fighters"), "Mexico");
  assert.equal(country("French fighters"), "France");
  assert.equal(country("fighters from French Polynesia"), "French Polynesia", "not France");
  assert.equal(country("fighters from American Samoa"), "American Samoa", "not the United States");
});

test("a region is still not a country, though two countries are named with a region word", () => {
  for (const q of ["best fighters from Africa", "fighters from Europe", "best boxers from the Middle East", "Arab fighters", "African fighters"]) assert.equal(plan(q, w, {}).length, 0, q);
});

test("a country with a space in its name is not taken for a fighter a slip or two away", () => {
  const p = plan("fighters from Hong Kong SAR China", w, {})[0];
  assert.equal(p?.tool, "fighters");
  assert.equal(p?.args.country, "Hong Kong SAR China");
});
