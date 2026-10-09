import test from "node:test";
import assert from "node:assert/strict";
import { oppositionOf, MIN_FIGHTS } from "../lib/opposition";

const bout = (id: number, redId: number, blueId: number, over: Record<string, unknown> = {}) => ({ id, redId, blueId, method: "UD", status: "completed", upcoming: false, ...over }) as never;
const pre = (m: Record<number, { red: number; blue: number }>) => (id: number) => m[id];

test("averages the rating each opponent carried into the fight, from whichever corner they were in", () => {
  const bouts = [bout(1, 1, 2), bout(2, 3, 1), bout(3, 1, 4), bout(4, 5, 1), bout(5, 1, 6)];
  const r = oppositionOf(bouts, 1, pre({ 1: { red: 1500, blue: 1400 }, 2: { red: 1600, blue: 1500 }, 3: { red: 1500, blue: 1700 }, 4: { red: 1300, blue: 1500 }, 5: { red: 1500, blue: 1500 } }))!;
  assert.equal(r.fights, 5);
  assert.equal(r.average, (1400 + 1600 + 1700 + 1300 + 1500) / 5);
  assert.deepEqual(r.strongest, { boutId: 3, opponentId: 4, rating: 1700 });
});

test("no figure from fewer than the minimum number of fights", () => {
  const bouts = Array.from({ length: MIN_FIGHTS - 1 }, (_, i) => bout(i + 1, 1, i + 10));
  assert.equal(oppositionOf(bouts, 1, () => ({ red: 1500, blue: 1500 })), null);
});

test("cancelled, upcoming, no-record and unrated fights are left out", () => {
  const good = Array.from({ length: MIN_FIGHTS }, (_, i) => bout(i + 1, 1, i + 10));
  const noise = [bout(90, 1, 99, { status: "cancelled" }), bout(91, 1, 98, { upcoming: true }), bout(92, 1, 97, { method: "NC" }), bout(93, 1, 96)];
  const r = oppositionOf([...good, ...noise], 1, (id) => (id === 93 ? undefined : { red: 1500, blue: 1450 }))!;
  assert.equal(r.fights, MIN_FIGHTS);
  assert.equal(r.average, 1450);
});
