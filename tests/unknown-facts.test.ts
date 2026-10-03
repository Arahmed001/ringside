import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { sweepAggregates, sweepAskTools } from "./league-sweep";

/**
 * A real feed does not always say a fighter's height, reach, birth year, stance or debut year. These are carried as unknown (null) all the way through: never
 * a guess, never a zero, never an edge in the model, shown as a dash. The league here is the demo with those facts removed for two fighters in three (and the
 * reach and birth year for a further third), so every code path that reads them meets some that are missing.
 */
const cleanup = tempDb("unknown-facts");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
before(async () => {
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  db.exec("UPDATE boxers SET height_cm = NULL, reach_cm = NULL, birth_year = NULL, stance = NULL, turned_pro = NULL, birth_date = NULL, debut_date = NULL WHERE id % 3 = 0");
  db.exec("UPDATE boxers SET reach_cm = NULL, birth_year = NULL, birth_date = NULL WHERE id % 3 = 1");
  db.exec("UPDATE boxers SET birth_year = 0, reach_cm = 0 WHERE id = (SELECT MIN(id) FROM boxers WHERE id % 3 = 2)"); // what an older load wrote for "unknown"
  w = await (await import("../lib/world")).getWorld();
});

const nulls = (f: (b: World["boxers"][number]) => unknown) => w.boxers.filter((b) => f(b) === null).length;

test("the world carries unknown as null: NULL and the old 0 are both unknown, and nothing is filled in", () => {
  const n = w.boxers.length;
  assert.ok(n > 300);
  const third = (k: number) => w.boxers.filter((b) => b.id % 3 === k);
  assert.ok(third(0).every((b) => b.heightCm === null && b.reachCm === null && b.birthYear === null && b.stance === null && b.turnedPro === null && b.age === null));
  assert.ok(third(1).every((b) => b.reachCm === null && b.birthYear === null && b.age === null && b.heightCm !== null && b.stance !== null), "only reach and birth year are missing for this third");
  const legacy = w.byId.get(Math.min(...third(2).map((b) => b.id)))!;
  assert.deepEqual([legacy.birthYear, legacy.reachCm, legacy.age], [null, null, null], "a stored 0 is unknown, not a birth year of 0 or a reach of 0 cm");
  assert.ok(third(2).slice(1).every((b) => b.heightCm !== null && b.reachCm !== null && b.birthYear !== null && b.age !== null), "the rest are untouched");
  assert.equal(nulls((b) => b.age), nulls((b) => b.birthYear));
});

test("the model gives an unknown reach or age no edge, either way, and never a NaN", async () => {
  const { winProbability, contributions, DEFAULT_WEIGHTS } = await import("../lib/model");
  const base = { rating: 1600, reachCm: 180 as number | null, age: 30 as number | null, monthsIdle: 6, koRate: 0.4, koLossRate: 0.1 };
  const same = winProbability(base, { ...base }, DEFAULT_WEIGHTS);
  for (const unk of [{ reachCm: null }, { age: null }, { reachCm: null, age: null }]) {
    const a = { ...base, ...unk }, b = { ...base, reachCm: 195, age: 40 }; // b would have a big edge if the unknown counted as anything
    const c = contributions(a, b, DEFAULT_WEIGHTS);
    if ("reachCm" in unk) assert.equal(c.reach, 0, "no reach edge when one reach is unknown");
    if ("age" in unk) assert.equal(c.age, 0, "no age edge when one age is unknown");
    const p = winProbability(a, b, DEFAULT_WEIGHTS);
    assert.ok([p.pA, p.pB, p.z].every(Number.isFinite));
    assert.equal(winProbability(b, a, DEFAULT_WEIGHTS).pA.toFixed(9), p.pB.toFixed(9), "and it is symmetric");
  }
  assert.equal(winProbability({ ...base, reachCm: null, age: null }, { ...base, reachCm: null, age: null }, DEFAULT_WEIGHTS).pA, same.pA, "two unknowns are an even match on those terms");
  const known = contributions(base, { ...base, reachCm: 195, age: 40 }, DEFAULT_WEIGHTS);
  assert.ok(known.reach !== 0 && known.age !== 0, "while known facts still count (so the zero above is the rule, not a dead term)");
});

test("every aggregate and every Ask-the-data tool answers on a league with many unknown facts, without a NaN or a made-up value", async () => {
  assert.deepEqual((await sweepAggregates(w)).slice(0, 10), []);
  const { bad, runs } = await sweepAskTools(w);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} problems in ${runs} runs`);
});

test("the written text leaves an unknown out instead of guessing: no age, stance or reach in a sentence about someone who has none", async () => {
  const { rulesReport, matchupBlurb } = await import("../lib/ai");
  const { tEn } = await import("../lib/i18n/t");
  const unknown = w.boxers.find((b) => b.id % 3 === 0 && b.bouts >= 5)!;
  const known = w.boxers.find((b) => b.id % 3 === 2 && b.bouts >= 5 && b.birthYear !== null && b.reachCm !== null)!;
  const text = rulesReport(unknown, w, tEn);
  assert.doesNotMatch(text, /NaN|undefined|null|-year-old|reach-over-height|Orthodox|Southpaw|Switch/);
  assert.match(text, new RegExp(unknown.name.split(" ")[0]));
  assert.match(rulesReport(known, w, tEn), /-year-old/, "a fighter whose age is known still gets it");
  assert.doesNotMatch(matchupBlurb(unknown, known, tEn), /NaN|undefined|null/);
});

test("a preview's tale of the tape shows a dash for an unknown, claims no edge from it, and says nothing about stances or reach it cannot know", async () => {
  const { buildPreview } = await import("../lib/preview");
  const { tEn } = await import("../lib/i18n/t");
  const bout = w.bouts.find((b) => { const r = w.byId.get(b.redId)!, u = w.byId.get(b.blueId)!; return r.id % 3 === 0 && u.id % 3 === 2 && u.reachCm !== null && u.age !== null; })!;
  const pv = buildPreview(w, bout, tEn);
  const row = (label: string) => pv.tape.find((r) => r.label === label)!;
  for (const label of ["Age", "Height", "Reach", "Stance"]) assert.equal(row(label).red, "–", `${label}: the unknown side is a dash`);
  for (const label of ["Age", "Height", "Reach"]) assert.equal(row(label).edge, null, `${label}: no edge from an unknown`);
  assert.doesNotMatch(JSON.stringify(pv), /NaN|undefined|"null"| 0 cm/);
  assert.doesNotMatch(pv.style, /reach advantage|fights southpaw|fights orthodox/i, "no stance or reach claim when one side's is unknown");
});

test("a search for a reach or an age never matches a fighter whose reach or age is unknown, and sorting puts them last", async () => {
  const { applyFilters } = await import("../lib/ai");
  const reach = applyFilters(w.boxers, { minReach: 150 }, w);
  assert.ok(reach.length > 0 && reach.every((b) => b.reachCm !== null && b.reachCm >= 150), "a minimum reach excludes unknown reaches");
  const aged = applyFilters(w.boxers, { minAge: 18, maxAge: 60 }, w);
  assert.ok(aged.every((b) => b.age !== null));
  const sorted = applyFilters(w.boxers, { sort: "reach" }, w);
  const firstUnknown = sorted.findIndex((b) => b.reachCm === null);
  assert.ok(firstUnknown > 0 && sorted.slice(firstUnknown).every((b) => b.reachCm === null), "unknown reaches are all at the end");
  assert.ok(sorted.slice(0, firstUnknown).every((b, i, a) => i === 0 || a[i - 1].reachCm! >= b.reachCm!), "and the known ones are still in order");
});

test("the reach statistic counts only fights where both reaches are known, and the stance one only fighters whose stance is", async () => {
  const analytics = await import("../lib/analytics");
  let fights = 0;
  for (const b of w.bouts) {
    if (b.upcoming || !b.winnerId) continue;
    const r = w.byId.get(b.redId)!, u = w.byId.get(b.blueId)!;
    if (r.reachCm !== null && u.reachCm !== null && Math.abs(r.reachCm - u.reachCm) >= 5) fights++;
  }
  assert.equal(analytics.reachEdge(w).fights, fights);
  const known = w.boxers.filter((b) => b.stance !== null);
  assert.ok(known.length < w.boxers.length);
  const s = analytics.stanceEdge(w);
  const south = known.filter((b) => b.stance === "Southpaw"), ortho = known.filter((b) => b.stance === "Orthodox");
  const rate = (xs: typeof known) => xs.reduce((a, b) => a + b.wins, 0) / Math.max(1, xs.reduce((a, b) => a + b.bouts, 0));
  assert.equal(s.southpaw, rate(south)); assert.equal(s.orthodox, rate(ortho), "a fighter whose stance is unknown is counted as neither");
});

test("fitting the model on a league with unknown facts gives finite rows: an unknown is a zero difference, not a NaN", async () => {
  const { buildDataset } = await import("../lib/fit");
  const rows = buildDataset(w);
  assert.ok(rows.length > 500);
  assert.ok(rows.every((r) => r.x.every(Number.isFinite)));
});
