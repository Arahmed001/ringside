import test from "node:test";
import assert from "node:assert/strict";
import { applyFilters, type Filters } from "../lib/ai";
import { careerCounts, knockouts } from "../lib/career";
import type { BoxerFull } from "../lib/types";

/**
 * Round 79, from looking at a partial load as a visitor would: a fighter whose page says 14-1-1 (the supplier's career total) was listed as "undefeated" because the
 * nine fights Ringside holds hold no loss. Record filters and sort keys compare the career as the page shows it.
 */
type Fake = Partial<BoxerFull> & { id: number; name: string };
const fighter = (o: Fake): BoxerFull => ({ slug: o.name, nickname: null, country: "United States", weightClass: "Lightweight", stance: null, sex: "male", active: true, rating: 1500, age: 30,
  wins: 0, losses: 0, draws: 0, bouts: 0, kos: 0, koRate: 0, koLosses: 0, winRate: 0, streak: { type: "W", count: 0 }, lastFight: null, birthPlace: null, reachCm: null, heightCm: null, turnedPro: null,
  vendorRecord: null, ...o }) as unknown as BoxerFull;

// held 9-0-0 with 3 KOs; the supplier says 14-1-1 with 5 KOs and 2 times stopped
const partial = fighter({ id: 1, name: "Partial", wins: 9, losses: 0, draws: 0, bouts: 9, kos: 3, koRate: 3 / 9, winRate: 1, vendorRecord: { wins: 14, losses: 1, draws: 1, koWins: 5, stopped: 2 } });
// the same, but the supplier gives no knockout totals
const bare = fighter({ id: 2, name: "Bare", wins: 9, losses: 0, draws: 0, bouts: 9, kos: 3, koRate: 3 / 9, winRate: 1, vendorRecord: { wins: 14, losses: 1, draws: 1 } });
// the fights held ARE the career (the supplier agrees)
const whole = fighter({ id: 3, name: "Whole", wins: 9, losses: 0, draws: 0, bouts: 9, kos: 3, koRate: 3 / 9, winRate: 1, vendorRecord: { wins: 9, losses: 0, draws: 0, koWins: 3, stopped: 0 } });
// no supplier at all (the demo league, or a feed without career totals)
const plain = fighter({ id: 4, name: "Plain", wins: 9, losses: 0, draws: 0, bouts: 9, kos: 3, koRate: 3 / 9, winRate: 1 });
const all = [partial, bare, whole, plain];
const names = (f: Filters) => applyFilters(all, f, undefined, {}).map((b) => b.name).sort();

test("the counts compared are the career as the page shows it: the supplier's total for a part-held career, the fights held otherwise", () => {
  assert.deepEqual(careerCounts(partial), { wins: 14, losses: 1, draws: 1, bouts: 16 });
  assert.deepEqual(careerCounts(whole), { wins: 9, losses: 0, draws: 0, bouts: 9 });
  assert.deepEqual(careerCounts(plain), { wins: 9, losses: 0, draws: 0, bouts: 9 });
  assert.deepEqual(knockouts(partial), { kos: 5, rate: 5 / 14, stopped: 2 });
  assert.equal(knockouts(bare), null, "a part-held career with no supplier knockouts says nothing about knockouts");
  assert.deepEqual(knockouts(whole), { kos: 3, rate: 3 / 9, stopped: 0 });
});

test("undefeated and loss counts do not list a fighter whose page shows a loss", () => {
  assert.deepEqual(names({ undefeated: true }), ["Plain", "Whole"], "Partial (14-1-1) and Bare (14-1-1) have lost");
  assert.deepEqual(names({ maxLosses: 0 }), ["Plain", "Whole"]);
  assert.deepEqual(names({ minLosses: 1 }), ["Bare", "Partial"]);
  assert.deepEqual(names({ minDraws: 1 }), ["Bare", "Partial"], "and the draw the supplier counts");
  assert.deepEqual(names({ minWins: 12 }), ["Bare", "Partial"], "wins and fights too");
  assert.deepEqual(names({ minBouts: 15 }), ["Bare", "Partial"]);
  assert.deepEqual(names({ maxBouts: 10 }), ["Plain", "Whole"]);
});

test("knockout filters use the supplier's knockouts when it gives them, and a part-held career without them never satisfies one", () => {
  assert.deepEqual(names({ minKOs: 4 }), ["Partial"], "5 knockouts in the career; Whole and Plain have 3; Bare's are unknown");
  assert.deepEqual(names({ maxKOs: 3 }), ["Plain", "Whole"], "Bare's knockouts are unknown, so it is not 'at most 3'");
  assert.deepEqual(names({ minKoRate: 0.3 }), ["Partial", "Plain", "Whole"], "5 of 14 is 36%; Bare has no knockout rate to compare");
  assert.deepEqual(names({ minStopped: 1 }), ["Partial"]);
});

test("the sort keys compare the same figures, and an unknown sorts last", () => {
  assert.deepEqual(applyFilters([...all].reverse(), { sort: "wins" }, undefined, {}).map((b) => b.name).slice(0, 2).sort(), ["Bare", "Partial"], "14 wins against 9");
  const byKos = applyFilters(all, { sort: "kos" }, undefined, {}).map((b) => b.name);
  assert.equal(byKos[0], "Partial"); assert.equal(byKos[byKos.length - 1], "Bare", "unknown knockouts last");
});
