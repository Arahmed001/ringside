import test from "node:test";
import assert from "node:assert/strict";
import { highlightsOf } from "../lib/highlights";

/** The best win, the biggest upset and the longest run, from the fights held and the ratings going in. */
const F = 7;
let id = 0;
const fight = (opp: number, result: "W" | "L" | "D", o: Record<string, unknown> = {}) =>
  ({ id: ++id, date: `2020-01-${String(id).padStart(2, "0")}`, redId: F, blueId: opp, winnerId: result === "W" ? F : result === "L" ? opp : null, method: result === "D" ? "DRAW" : "UD", status: "completed", upcoming: false, ...o }) as never;
const pre = (rows: [number, number, number][]) => new Map(rows.map(([i, own, opp]) => [i, { red: own, blue: opp }]));

test("best win: the win over the highest-rated opponent going in; losses and draws do not count", () => {
  id = 0;
  const fs = [fight(1, "W"), fight(2, "W"), fight(3, "L"), fight(4, "D")];
  const h = highlightsOf(fs, F, pre([[1, 1500, 1520], [2, 1520, 1610], [3, 1540, 1700], [4, 1500, 1800]]));
  assert.deepEqual(h.bestWin, { boutId: 2, opponentId: 2, opponentRating: 1610 });
});

test("biggest upset: only a win over someone rated at least 100 above, the largest gap", () => {
  id = 0;
  const fs = [fight(1, "W"), fight(2, "W"), fight(3, "W")];
  const h = highlightsOf(fs, F, pre([[1, 1500, 1590], [2, 1500, 1640], [3, 1500, 1720]]));
  assert.deepEqual(h.biggestUpset, { boutId: 3, opponentId: 3, gap: 220 });
  id = 0;
  assert.equal(highlightsOf([fight(1, "W")], F, pre([[1, 1500, 1599]])).biggestUpset, null, "99 points is not an upset");
  id = 0;
  assert.equal(highlightsOf([fight(1, "L")], F, pre([[1, 1500, 1900]])).biggestUpset, null, "a loss is not an upset win");
});

test("the fighter as the blue corner is read from the blue side", () => {
  id = 0;
  const x = fight(9, "W", { redId: 9, blueId: F, winnerId: F }) as unknown as { id: number };
  const h = highlightsOf([x] as never, F, new Map([[x.id, { red: 1700, blue: 1500 }]]));
  assert.deepEqual(h.bestWin, { boutId: 1, opponentId: 9, opponentRating: 1700 });
  assert.equal(h.biggestUpset?.gap, 200);
});

test("longest streak: a run of 3 or more, ended by a draw or loss; the cancelled, upcoming and no-contest fights are not in the run", () => {
  id = 0;
  const fs = [fight(1, "W"), fight(2, "W"), fight(3, "L"), fight(4, "W"), fight(5, "W", { method: "NC", winnerId: null }), fight(6, "W"), fight(7, "W"), fight(8, "W", { status: "cancelled", winnerId: null, method: null }), fight(9, "D"), fight(10, "W")];
  const h = highlightsOf(fs, F, new Map());
  assert.deepEqual(h.longestStreak, { wins: 3, endedBoutId: 9 }, "4, 6 and 7 are three wins (the no-contest between 4 and 6 does not break it), ended by the draw");
  id = 0;
  assert.equal(highlightsOf([fight(1, "W"), fight(2, "W"), fight(3, "L")], F, new Map()).longestStreak, null, "two is not a streak");
  id = 0;
  assert.deepEqual(highlightsOf([fight(1, "W"), fight(2, "W"), fight(3, "W")], F, new Map()).longestStreak, { wins: 3, endedBoutId: null }, "still going");
  assert.deepEqual(highlightsOf([], F, new Map()), { bestWin: null, biggestUpset: null, longestStreak: null });
});
