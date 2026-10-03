import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/**
 * A league small enough to work out by hand. Every expected number below is written from this table, not copied from the code's output.
 *
 *  bout  date        fight (red vs blue)        result                       weights (limit 135 for Lightweight)
 *   1    2025-01-01  A v B  Lightweight          A KO R2                      A 134.0/140.0 made; B 136.0/141.0 missed
 *   2    2025-02-01  A v C  Lightweight          A UD                         A 133.0/136.0 made; C 135.0/138.0 made
 *   3    2025-03-01  A v D  Lightweight          no contest                   -
 *   4    2025-04-01  A v E  Lightweight          A UD                         -
 *   5    2025-05-01  E v B  Lightweight          E TKO R7                     E 134.0 made; B 137.0 missed (official only)
 *   6    2025-06-01  B v D  Lightweight          B UD                         B 135.5/150.0 missed; D night 142.0 only
 *   7    2025-07-01  F v G  Heavyweight          F KO R12                     F 230/236; G 235/240 (no limit)
 *   8    2027-01-01  A v B  Lightweight          upcoming                     A 134.0 made; B 138.0 MISSED (left out of lists, history and averages, but see missCount)
 *
 *  fighter  stance     reach  country
 *   A       Southpaw   180    Mexico      B Orthodox 170 Mexico     C Orthodox 176 United Kingdom   D Southpaw 175 Cuba
 *   E       Orthodox   190    United Kingdom                        F, G Orthodox 180 United States (Heavyweight)
 */
const cleanup = tempDb("league-stats");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-league-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
const id = (name: string) => w.boxers.find((b) => b.name === `Fighter ${name}`)!.id;

before(async () => {
  const feed = miniFeed();
  feed.boxers = [
    makeBoxer("A", "Lightweight", { stance: "Southpaw", reachCm: 180, country: "Mexico" }), makeBoxer("B", "Lightweight", { stance: "Orthodox", reachCm: 170, country: "Mexico" }),
    makeBoxer("C", "Lightweight", { stance: "Orthodox", reachCm: 176, country: "United Kingdom" }), makeBoxer("D", "Lightweight", { stance: "Southpaw", reachCm: 175, country: "Cuba" }),
    makeBoxer("E", "Lightweight", { stance: "Orthodox", reachCm: 190, country: "United Kingdom" }),
    makeBoxer("F", "Heavyweight", { reachCm: 180, country: "United States" }), makeBoxer("G", "Heavyweight", { reachCm: 180, country: "United States" }),
  ];
  const bouts: [string, string, string, string, string | null, string, number | undefined, string][] = [
    ["2025-01-01", "A", "B", "Lightweight", "A", "KO", 2, "1"], ["2025-02-01", "A", "C", "Lightweight", "A", "UD", 12, "2"], ["2025-03-01", "A", "D", "Lightweight", null, "NC", 3, "3"],
    ["2025-04-01", "A", "E", "Lightweight", "A", "UD", 12, "4"], ["2025-05-01", "E", "B", "Lightweight", "E", "TKO", 7, "5"], ["2025-06-01", "B", "D", "Lightweight", "B", "UD", 12, "6"],
    ["2025-07-01", "F", "G", "Heavyweight", "F", "KO", 12, "7"], ["2027-01-01", "A", "B", "Lightweight", null, "", undefined, "8"],
  ];
  feed.events = bouts.map(([date, , , , , , , n]) => ({ externalId: `EV${n}`, name: `Card ${n}`, date, venue: "Arena", city: "Reno", country: "United States" }));
  feed.bouts = bouts.map(([, r, u, wc, win, method, end, n]) => ({
    externalId: `B${n}`, eventExternalId: `EV${n}`, redExternalId: r, blueExternalId: u, weightClass: wc, rounds: 12, winnerExternalId: win, method: (method || null) as never,
    endRound: end ?? null, title: null, position: 1,
  }) as never);
  const wi = (bout: string, boxer: string, off: number | undefined, night: number | undefined, made: boolean, limit: number | null = 135) =>
    ({ boutExternalId: `B${bout}`, boxerExternalId: boxer, officialLb: off, fightNightLb: night, limitLb: limit, madeWeight: made });
  feed.weighIns = [
    wi("1", "A", 134.0, 140.0, true), wi("1", "B", 136.0, 141.0, false), wi("2", "A", 133.0, 136.0, true), wi("2", "C", 135.0, 138.0, true),
    wi("5", "B", 137.0, undefined, false), wi("5", "E", 134.0, undefined, true), wi("6", "B", 135.5, 150.0, false), wi("6", "D", undefined, 142.0, true),
    wi("7", "F", 230, 236, true, null), wi("7", "G", 235, 240, true, null), wi("8", "A", 134.0, undefined, true), wi("8", "B", 138.0, undefined, false),
  ] as never;
  feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = []; feed.stints = [];
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
});

test("division weights: miss rate, how far under the limit, and how much is regained, from the weigh-ins that exist", async () => {
  const { divisionWeights } = await import("../lib/weights");
  const rows = divisionWeights(w);
  const lw = rows.find((r) => r.division === "Lightweight")!, hw = rows.find((r) => r.division === "Heavyweight")!;
  assert.equal(lw.n, 7, "seven Lightweight weigh-ins have an official weight (D's has none; the upcoming card is ignored)");
  assert.equal(lw.limitLb, 135);
  assert.ok(Math.abs(lw.missRate - 3 / 7) < 1e-9, "B missed three times in seven");
  assert.ok(Math.abs(lw.avgUnderLimit - 1) < 1e-9, "made-weight fighters were 1, 2, 0 and 1 lb under: mean 1");
  assert.ok(Math.abs(lw.avgGain - 6.3) < 1e-9, "(6 + 5 + 3 + 3 + 14.5) / 5");
  assert.ok(Math.abs(lw.avgFightNight - 141) < 1e-9, "(140 + 141 + 136 + 138 + 150) / 5");
  assert.equal(hw.limitLb, null);
  assert.deepEqual([hw.n, hw.missRate, hw.avgUnderLimit, hw.avgGain, hw.avgFightNight], [2, 0, 0, 5.5, 238], "no limit means no miss rate and no distance under it");
  assert.deepEqual(rows.filter((r) => r.n === 0).map((r) => [r.missRate, r.avgGain]).filter(([m, g]) => m !== 0 || g !== 0), [], "a division with no weigh-ins reads zero, not NaN");
});

test("fight-night edge: a pair is bucketed the same way from both sides, including exactly on a boundary", async () => {
  const { fightNightEdge } = await import("../lib/weights");
  const e = Object.fromEntries(fightNightEdge(w).map((b) => [b.label, b]));
  const row = (label: string) => [e[label].n, Math.round(e[label].winRate * 100) / 100];
  assert.deepEqual(row("8+ lb lighter"), [1, 0], "D, 8 lb lighter than B, lost");
  assert.deepEqual(row("8+ lb heavier"), [1, 1], "B, 8 lb heavier than D, won: exactly 8 counts as 8+ on both sides");
  assert.deepEqual(row("4–8 lb lighter"), [1, 1], "F, exactly 4 lb lighter than G, won");
  assert.deepEqual(row("4–8 lb heavier"), [1, 0], "G, exactly 4 lb heavier than F, lost: the mirror of the row above");
  assert.deepEqual(row("1.5–4 lb lighter"), [1, 1], "A, 2 lb lighter than C, won");
  assert.deepEqual(row("1.5–4 lb heavier"), [1, 0]);
  assert.deepEqual(row("within 1.5 lb"), [2, 0.5], "A and B, 1 lb apart, A won");
  const labels = fightNightEdge(w).map((b) => b.label);
  const lighter = labels.filter((l) => /lighter/.test(l)), heavier = labels.filter((l) => /heavier/.test(l));
  for (const l of lighter) { const m = l.replace("lighter", "heavier"); assert.equal(e[l].n, e[m].n, `${l} and ${m} hold the same number of fighters: every fight has one of each`); }
  assert.equal(lighter.length, heavier.length);
  assert.equal(fightNightEdge(w).reduce((s, b) => s + b.n, 0), 8, "four decided fights with both fight-night weights, two fighters each; bout 5 has none and the upcoming card does not count");
});

test("missed weights: newest first, how far over, who won, who the opponent was; the upcoming card is ignored", async () => {
  const { missedWeights, weightHistory, avgRehydration, missCount } = await import("../lib/weights");
  const m = missedWeights(w);
  assert.equal(m.total, 3);
  assert.deepEqual(m.misses.map((x) => [x.date, x.over, x.won, x.opponent]), [["2025-06-01", 0.5, true, "Fighter D"], ["2025-05-01", 2, false, "Fighter E"], ["2025-01-01", 1, false, "Fighter A"]]);
  assert.ok(Math.abs(m.winRate - 1 / 3) < 1e-9, "he won one of the three");
  assert.equal(missedWeights(w, 2).misses.length, 2, "the limit trims the list but not the total");
  assert.equal(missedWeights(w, 2).total, 3);
  const b = weightHistory(w, id("B"));
  assert.deepEqual(b.map((p) => [p.date, p.official, p.fightNight, p.made]), [["2025-01-01", 136, 141, false], ["2025-05-01", 137, null, false], ["2025-06-01", 135.5, 150, false]]);
  assert.equal(weightHistory(w, id("A")).length, 2, "A's upcoming weigh-in is not history");
  assert.deepEqual(weightHistory(w, 99999), []);
  assert.equal(missCount(w, id("B")), 4, "three past misses and the one for the coming fight: counted on purpose, it is what the upset-watch warning (\"has missed weight\") is about");
  assert.equal(missCount(w, id("A")), 0);
  assert.equal(avgRehydration(w, id("A")), (6 + 3) / 2, "A regained 6 and 3 lb");
  assert.equal(avgRehydration(w, id("E")), null, "no fight-night weight, no rehydration figure");
});

test("league aggregates: overview, weight classes, finishes by round, countries, stance, reach and streaks", async () => {
  const A = await import("../lib/analytics");
  const o = A.overview(w);
  assert.deepEqual([o.boxers, o.bouts, o.countries], [7, 6, 4], "the no-contest and the upcoming bout are not counted as bouts");
  assert.equal(o.finishRate, 0.5, "three of six ended early: KO, TKO, KO");
  const byWc = Object.fromEntries(A.byWeightClass(w).map((r) => [r.weightClass, r]));
  assert.deepEqual([byWc.Lightweight.bouts, byWc.Lightweight.koRate, byWc.Heavyweight.bouts, byWc.Heavyweight.koRate], [5, 0.4, 1, 1]);
  const heat = Object.fromEntries(A.finishHeat(w).map((r) => [r.weightClass, r]));
  assert.equal(heat.Lightweight.total, 2); assert.deepEqual([heat.Lightweight.cells[1], heat.Lightweight.cells[6], heat.Lightweight.cells[0]], [0.5, 0.5, 0], "round 2 and round 7");
  assert.equal(heat.Heavyweight.cells[11], 1, "round 12 is the last of twelve cells");
  assert.equal(heat.Flyweight.total, 0); assert.ok(heat.Flyweight.cells.every((c) => c === 0), "no knockouts means zeros, not NaN");
  const c = A.countryLeaders(w);
  assert.deepEqual(c.map((x) => [x.country, x.boxers, x.wins, x.bouts]), [["Mexico", 2, 4, 6], ["United Kingdom", 2, 1, 3], ["United States", 2, 1, 2], ["Cuba", 1, 0, 1]]);
  assert.equal(c[0].winRate, 4 / 6);
  const s = A.stanceEdge(w);
  assert.deepEqual([s.southpaw, s.orthodox], [3 / 4, 3 / 8], "southpaws (A, D) won 3 of their 4 bouts; orthodox fighters (B, C, E, F, G) 3 of their 8");
  const r = A.reachEdge(w);
  assert.equal(r.fights, 4, "reach gaps of 5 cm or more: A-B (10), A-E (10), E-B (20), B-D (exactly 5); A-C (4) and the rest are too close");
  assert.equal(r.winPct, 0.5, "the longer fighter won two of the four");
  const streaks = A.longestStreaks(w, 3);
  assert.deepEqual([streaks[0].boxer.name, streaks[0].len], ["Fighter A", 3], "a no-contest between two wins does not end a win streak (it is not in his record either)");
});

test("upsets are the biggest rating gaps a winner overcame, and never involve an unrated fighter", async () => {
  const { biggestUpsets } = await import("../lib/analytics");
  const all = biggestUpsets(w, 10);
  for (const u of all) {
    const pre = w.boutPre.get(u.bout.id)!;
    const [win, lose] = u.bout.winnerId === u.bout.redId ? [pre.red, pre.blue] : [pre.blue, pre.red];
    assert.equal(u.gap, lose - win); assert.ok(u.winnerRating !== 1500 && u.loserRating !== 1500);
  }
  assert.deepEqual(all.map((u) => u.gap), [...all.map((u) => u.gap)].sort((a, b) => b - a), "largest first");
  assert.ok(all.length >= 1 && all.length <= 10);
  assert.ok(all.every((u) => u.bout.date >= "2025-01-01"));
  assert.ok(biggestUpsets(w, 10, "2027-01-01").length === 0, "since: nothing on or after the upcoming card has a result");
  assert.ok(biggestUpsets(w, 1).length <= 1);
});
