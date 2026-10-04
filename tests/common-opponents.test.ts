import test from "node:test";
import assert from "node:assert/strict";
import { commonOpponents } from "../lib/common-opponents";

/** A hand-made world: fighters 1 (A) and 2 (B), opponents 10 and 11 in common, 12 only A's, 13 only B's. */
const boxer = (id: number, rating: number, extra: Record<string, unknown> = {}) => ({ id, slug: `f${id}`, name: `F${id}`, rating, wins: 5, losses: 0, draws: 0, ...extra });
const bout = (id: number, date: string, redId: number, blueId: number, winnerId: number | null, method: string | null = "UD", extra: Record<string, unknown> = {}) =>
  ({ id, date, redId, blueId, winnerId, method, status: "completed", upcoming: false, ...extra });
const world = (bouts: ReturnType<typeof bout>[], boxers = [boxer(1, 1600), boxer(2, 1550), boxer(10, 1500), boxer(11, 1700), boxer(12, 1400), boxer(13, 1300)]) => {
  const by = new Map<number, unknown[]>();
  for (const b of bouts) for (const id of [b.redId, b.blueId]) by.set(id, [...(by.get(id) ?? []), b]);
  return { byId: new Map(boxers.map((x) => [x.id, x])), boutsByBoxer: by } as never;
};
const [A, B] = [boxer(1, 1600), boxer(2, 1550)] as never[];

test("opponents both fought, best-rated first, with every fight each had against them in date order", () => {
  const w = world([
    bout(1, "2019-01-01", 1, 10, 1, "KO"), bout(2, "2020-01-01", 10, 1, 10, "UD"), // A and 10: a win, then a rematch loss
    bout(3, "2021-01-01", 2, 10, 10, "SD"),
    bout(4, "2018-01-01", 11, 1, 1, "TKO"), bout(5, "2018-06-01", 2, 11, 2, "UD"),
    bout(6, "2017-01-01", 1, 12, 1), bout(7, "2017-02-01", 2, 13, 2),
  ]);
  const r = commonOpponents(w, A, B);
  assert.deepEqual(r.rows.map((x) => x.opponent.id), [11, 10], "opponent 12 (only A's) and 13 (only B's) are not in common; the better-rated opponent first");
  assert.deepEqual(r.rows[1].a.map((x) => x.id), [1, 2], "a rematch is both fights, oldest first, not the last one only");
  assert.deepEqual(r.rows[1].b.map((x) => x.id), [3]);
  assert.equal(r.total, 2);
  assert.equal(r.partial, false);
});

test("a fight between the two, a no-contest, a cancelled and an upcoming fight are not a result against a common opponent", () => {
  const w = world([
    bout(1, "2019-01-01", 1, 2, 1), // they met: not an opponent in common
    bout(2, "2019-02-01", 1, 10, null, "NC"), bout(3, "2019-03-01", 2, 10, 2),
    bout(4, "2019-04-01", 1, 11, null, null, { status: "cancelled" }), bout(5, "2019-05-01", 2, 11, 2),
    bout(6, "2030-01-01", 1, 12, null, null, { upcoming: true }), bout(7, "2019-06-01", 2, 12, 2),
  ]);
  assert.equal(commonOpponents(w, A, B).rows.length, 0, "none of those is a result for A, so none is in common");
});

test("the list is cut at the limit but the total says how many there are", () => {
  const ids = [10, 11, 12, 13, 14, 15];
  const boxers = [boxer(1, 1600), boxer(2, 1550), ...ids.map((i) => boxer(i, 1000 + i))];
  const w = world(ids.flatMap((i, k) => [bout(100 + k, "2019-01-01", 1, i, 1), bout(200 + k, "2019-02-01", 2, i, 2)]), boxers);
  const r = commonOpponents(w, A, B, 4);
  assert.equal(r.rows.length, 4); assert.equal(r.total, 6);
  assert.deepEqual(r.rows.map((x) => x.opponent.id), [15, 14, 13, 12]);
});

test("a career held in part is flagged, because an opponent may be a fight Ringside does not hold", () => {
  const w = world([bout(1, "2019-01-01", 1, 10, 1), bout(2, "2019-02-01", 2, 10, 2)]);
  const partial = { ...(A as object), wins: 3, vendorRecord: { wins: 20, losses: 1, draws: 0 } } as never;
  assert.equal(commonOpponents(w, partial, B).partial, true);
  assert.equal(commonOpponents(w, A, B).partial, false);
});
