import test from "node:test";
import assert from "node:assert/strict";
import { outcomesByYear } from "../lib/outcomes-by-year";

const b = (date: string, method: string, winnerId: number | null, over: Record<string, unknown> = {}) => ({ date, method, winnerId, status: "completed", upcoming: false, ...over }) as never;

test("each year split by how the fights ended, with the quiet years kept as empty rows", () => {
  const r = outcomesByYear([b("2020-02-01", "KO", 1), b("2020-09-01", "UD", 1), b("2022-05-01", "TKO", 2), b("2022-11-01", "DQ", 1), b("2022-12-01", "DRAW", null)], 1);
  assert.deepEqual(r.map((y) => [y.year, y.ko, y.decision, y.otherWin, y.draw, y.loss, y.total]), [[2020, 1, 1, 0, 0, 0, 2], [2021, 0, 0, 0, 0, 0, 0], [2022, 0, 0, 1, 1, 1, 3]]);
});

test("no-contests, cancelled and upcoming fights are left out; no fights gives no rows", () => {
  assert.deepEqual(outcomesByYear([b("2020-01-01", "NC", null), b("2020-02-01", "UD", 1, { status: "cancelled" }), b("2020-03-01", "UD", 1, { upcoming: true })], 1), []);
});

test("a majority or split decision win and a corner retirement are counted as scorecard and stoppage wins", () => {
  const r = outcomesByYear([b("2019-01-01", "SD", 1), b("2019-02-01", "MD", 1), b("2019-03-01", "RTD", 1)], 1);
  assert.deepEqual([r[0].ko, r[0].decision], [1, 2]);
});
