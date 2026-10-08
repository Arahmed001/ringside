import test from "node:test";
import assert from "node:assert/strict";
import { lateRoundsOf, clearDecisionsOf, MIN_LATE, MIN_DECISIONS } from "../lib/late-rounds";

const b = (method: string, winnerId: number | null, rounds = 12, endRound: number | null = null, over: Record<string, unknown> = {}) => ({ method, winnerId, rounds, endRound, status: "completed", upcoming: false, ...over }) as never;

test("late rounds: stoppages from round 8 and scheduled-8-plus fights that went the distance", () => {
  const r = lateRoundsOf([b("UD", 1), b("UD", 2), b("KO", 1, 12, 9), b("KO", 1, 12, 3), b("UD", 1, 6), b("DRAW", null, 10), b("KO", 2, 12, 8), b("KO", 1, 12, null)], 1)!;
  assert.deepEqual(r, { fights: 5, wins: 2, losses: 2, draws: 1 });
});

test("late rounds: too few fights, no-contests, cancelled and upcoming fights give nothing", () => {
  assert.equal(lateRoundsOf(Array.from({ length: MIN_LATE - 1 }, () => b("UD", 1)), 1), null);
  const r = lateRoundsOf([b("UD", 1), b("UD", 1), b("UD", 1), b("NC", null), b("UD", 1, 12, null, { status: "cancelled" }), b("UD", 1, 12, null, { upcoming: true })], 1)!;
  assert.equal(r.fights, 3);
});

test("clear decisions: unanimous wins out of all scorecard wins, technical decisions left out", () => {
  const wins = [b("UD", 1), b("UD", 1), b("UD", 1), b("SD", 1), b("MD", 1), b("TD", 1), b("UD", 2), b("KO", 1)];
  assert.deepEqual(clearDecisionsOf(wins, 1), { wins: 5, unanimous: 3 });
});

test("clear decisions: needs the minimum number of decision wins", () => {
  assert.equal(clearDecisionsOf(Array.from({ length: MIN_DECISIONS - 1 }, () => b("UD", 1)), 1), null);
});
