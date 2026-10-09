import test from "node:test";
import assert from "node:assert/strict";
import { finishRoundsOf, MIN_FINISHES } from "../lib/finish-rounds";

const win = (endRound: number | null, over: Record<string, unknown> = {}) => ({ method: "KO", winnerId: 1, status: "completed", upcoming: false, endRound, ...over }) as never;

test("average round, the common round and the count by round", () => {
  const r = finishRoundsOf([win(2), win(2), win(5), win(1)], 1)!;
  assert.equal(r.finishes, 4);
  assert.equal(r.average, 2.5);
  assert.equal(r.commonRound, 2);
  assert.deepEqual(r.byRound, [1, 2, 0, 0, 1]);
});

test("only the fighter's own stoppage wins count; a win without its round is not guessed", () => {
  const r = finishRoundsOf([win(3), win(3), win(3), win(null), win(4, { winnerId: 2 }), win(6, { method: "UD" }), win(7, { method: "DQ" }), win(8, { status: "cancelled" }), win(9, { upcoming: true })], 1)!;
  assert.equal(r.finishes, 3);
  assert.equal(r.stoppageWins, 4);
  assert.equal(r.average, 3);
  assert.deepEqual(r.byRound, [0, 0, 3]);
});

test("a corner retirement is a stoppage; too few finishes give no figure", () => {
  assert.equal(finishRoundsOf([win(4, { method: "RTD" }), win(5, { method: "TKO" }), win(6)], 1)!.finishes, MIN_FINISHES);
  assert.equal(finishRoundsOf([win(4), win(5)], 1), null);
});

test("a tie for the common round goes to the earlier round", () => {
  assert.equal(finishRoundsOf([win(3), win(3), win(6), win(6)], 1)!.commonRound, 3);
});
