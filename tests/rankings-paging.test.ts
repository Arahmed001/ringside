import test, { after } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import type { World } from "../lib/world";
import type { BoxerFull } from "../lib/types";
import { rankDivision, rankOf, rankRow, rankedBoxers } from "../lib/rankings";

/**
 * A division's ranking can be read to the end: pages of it, each fighter with the place held in the whole division, the rank of anyone ranked (the 260th
 * has one), and the movement since three months ago. A league worked out by hand, 260 men in a division, so the numbers can be checked.
 */
const cleanup = tempDb("rankings-paging"); // pins today to 2026-10-03
after(cleanup);

const boxer = (id: number, over: Partial<BoxerFull>): BoxerFull => ({ id, name: `Fighter ${id}`, sex: "male", weightClass: "Welterweight", active: true, bouts: 8, winRate: 0.6, lastFight: "2026-08-01", rating: 1500, ...over }) as BoxerFull;
const N = 260;
const boxers: BoxerFull[] = [];
// ids 1..260: rated 2000 down to 1741, so id n is ranked n
for (let i = 1; i <= N; i++) boxers.push(boxer(i, { rating: 2001 - i }));
boxers.push(boxer(301, { active: false, rating: 2500 }), boxer(302, { bouts: 4, rating: 2500 }), boxer(303, { winRate: 0.4, rating: 2500 }), boxer(304, { lastFight: "2023-01-01", rating: 2500 }));
boxers.push(boxer(401, { sex: "female", rating: 1900 }), boxer(402, { weightClass: "Heavyweight", rating: 1900 }));
// three months ago, fighter 3 was rated below ten others and fighter 10 above everyone: (history needs only dates before the day three months back)
const history = new Map<number, { date: string; rating: number }[]>();
for (const b of boxers) history.set(b.id, [{ date: "2026-01-01", rating: b.rating }]);
history.set(3, [{ date: "2026-01-01", rating: 1000 }]);
history.set(10, [{ date: "2026-01-01", rating: 3000 }]);
history.set(260, [{ date: "2026-09-15", rating: boxers[259].rating }]); // first rated after the day three months back: a new entry
const w = { boxers, history } as unknown as World;
const ids = (rows: { boxer: BoxerFull }[]) => rows.map((r) => r.boxer.id);

test("the ranking holds exactly the eligible fighters of the division and sex, best first", () => {
  const all = rankedBoxers(w, "Welterweight", "male");
  assert.equal(all.length, N, "the inactive, the four-fight, the losing and the long-idle fighter are not ranked");
  assert.deepEqual(all.map((b) => b.id), Array.from({ length: N }, (_, i) => i + 1));
  assert.deepEqual(rankedBoxers(w, "Welterweight", "female").map((b) => b.id), [401]);
  assert.deepEqual(rankedBoxers(w, "Heavyweight", "male").map((b) => b.id), [402]);
  assert.equal(rankedBoxers(w, "Welterweight", "male"), all, "computed once per world");
});

test("a page of the ranking continues the numbers from where the last stopped", () => {
  const first = rankDivision(w, "Welterweight", 25, "male");
  assert.deepEqual(first.map((r) => r.rank), Array.from({ length: 25 }, (_, i) => i + 1));
  const second = rankDivision(w, "Welterweight", 25, "male", 25);
  assert.deepEqual(second.map((r) => r.rank), Array.from({ length: 25 }, (_, i) => 26 + i));
  assert.deepEqual(ids(second), Array.from({ length: 25 }, (_, i) => 26 + i));
  const last = rankDivision(w, "Welterweight", 25, "male", 250);
  assert.deepEqual([last.length, last[0].rank, last[9].rank], [10, 251, 260], "the last page is short and the last fighter is on it");
  assert.deepEqual(rankDivision(w, "Welterweight", 25, "male", 9999), [], "past the end is empty");
  // every page together is the whole division, once
  const joined = Array.from({ length: Math.ceil(N / 25) }, (_, p) => rankDivision(w, "Welterweight", 25, "male", p * 25)).flat();
  assert.deepEqual(ids(joined), Array.from({ length: N }, (_, i) => i + 1));
});

test("anyone ranked has a rank, including past the 200th; anyone not ranked has none", () => {
  assert.equal(rankOf(w, boxers[0]), 1);
  assert.equal(rankOf(w, boxers[199]), 200);
  assert.equal(rankOf(w, boxers[200]), 201, "this was once cut off at 200");
  assert.equal(rankOf(w, boxers[N - 1]), 260);
  for (const id of [301, 302, 303, 304]) assert.equal(rankOf(w, boxers.find((b) => b.id === id)!), null, `fighter ${id}`);
  assert.equal(rankOf(w, boxers.find((b) => b.id === 401)!), 1, "the only woman of the division is first among women");
});

test("movement since three months ago, and the row for one fighter built from the whole list", () => {
  // fighter 3 was rated lowest of all three months ago (last of the 259 who were rated then) and is third now; fighter 10 was rated highest and is tenth
  const rows = rankDivision(w, "Welterweight", 12, "male");
  const r3 = rows.find((r) => r.boxer.id === 3)!, r10 = rows.find((r) => r.boxer.id === 10)!;
  assert.equal(r3.delta, 259 - 3, "climbed from 259th to 3rd");
  assert.equal(r10.delta, 1 - 10, "fell from 1st to 10th");
  assert.equal(r3.ratingChange, boxers[2].rating - 1000);
  assert.equal(rows[0].delta, 1, "fighter 1 was second behind fighter 10 and is first: up one");
  assert.equal(rows.find((r) => r.boxer.id === 4)!.delta, 0, "an unmoved fighter has a zero, not null");
  const fresh = rankDivision(w, "Welterweight", 1, "male", 259)[0];
  assert.deepEqual([fresh.boxer.id, fresh.delta, fresh.ratingChange], [260, null, 0], "a fighter not rated three months ago is a new entry: no movement, not zero");
  // the page builds its rows from the list: the same row as the ranking gives
  for (const r of rows) assert.deepEqual(rankRow(w, "Welterweight", "male", r.boxer, r.rank), r);
});
