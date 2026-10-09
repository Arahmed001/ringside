import test from "node:test";
import assert from "node:assert/strict";
import { opponentsLastFive } from "../lib/opponents-last-five";

const b = (id: number, redId: number, blueId: number, winnerId: number | null = redId, over: Record<string, unknown> = {}) => ({ id, redId, blueId, winnerId, method: "UD", status: "completed", upcoming: false, ...over }) as never;

test("adds up each of the last five opponents' records as they stood on the night", () => {
  // fighter 1 meets 11..16 in fights 101..106 (the last five count); each opponent has an earlier win and loss, then the fight against fighter 1, then a later win that must not count
  const mine = [1, 2, 3, 4, 5, 6].map((i) => b(100 + i, 1, 10 + i));
  const real = (o: number) => [b(o * 10, o, 99, o), b(o * 10 + 1, o, 98, 98), mine.find((x: { blueId: number }) => x.blueId === o)!, b(300 + o, o, 97, o)];
  const r = opponentsLastFive(mine, 1, real, () => true)!;
  assert.deepEqual(r, { fights: 5, wins: 5, losses: 5, draws: 0 });
});

test("no figure with fewer than five fights, or when an opponent's early career is not held", () => {
  const four = [1, 2, 3, 4].map((i) => b(100 + i, 1, 10 + i));
  assert.equal(opponentsLastFive(four, 1, () => [], () => true), null);
  const six = [1, 2, 3, 4, 5, 6].map((i) => b(100 + i, 1, 10 + i));
  assert.equal(opponentsLastFive(six, 1, () => [], (o) => o !== 13), null);
});

test("cancelled, upcoming and no-contest fights are not among the last five", () => {
  const fights = [...[1, 2, 3, 4, 5].map((i) => b(100 + i, 1, 10 + i)), b(120, 1, 20, 1, { upcoming: true }), b(121, 1, 21, 1, { status: "cancelled" }), b(122, 1, 22, null, { method: "NC" })];
  const seen: number[] = [];
  opponentsLastFive(fights, 1, (o) => { seen.push(o); return []; }, () => true);
  assert.deepEqual(seen.sort(), [11, 12, 13, 14, 15]);
});
