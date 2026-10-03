import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import type { Call } from "../lib/accountability";

/**
 * The track record is only worth publishing if it cannot flatter the model. These tests pin down the rules:
 * each fight is scored with what was known BEFORE it (a later result must never change an earlier call), the bouts
 * scored are exactly the ones the fitter uses, and the numbers are computed as stated.
 */
const cleanup = tempDb("accountability");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let A: typeof import("../lib/accountability");
before(async () => { w = await (await import("../lib/world")).getWorld(); A = await import("../lib/accountability"); });

test("the bouts scored are exactly the bouts the model fitter trains and tests on", async () => {
  const { buildDataset } = await import("../lib/fit");
  const mine = A.calls(w).map((c) => c.boutId), theirs = buildDataset(w).map((r) => r.boutId);
  assert.ok(mine.length > 1000);
  assert.deepEqual(mine, theirs, "same fights, same order: the two can never disagree about what counts");
});

test("a call is the model's own number: with pure-Elo weights it equals the Elo expectation, and a call's fields agree", async () => {
  const model = await import("../lib/model");
  const world = await import("../lib/world");
  world.invalidateWorld();
  const fresh = await world.getWorld();
  model.setActiveWeights({ ...model.DEFAULT_WEIGHTS, reach: 0, age: 0, idle: 0, power: 0, chin: 0 });
  try {
    for (const c of A.calls(fresh).slice(0, 400)) {
      if (c.eloPRed > 0.05 && c.eloPRed < 0.95) assert.ok(Math.abs(c.pRed - c.eloPRed) < 1e-9, `bout ${c.boutId}`);
    }
  } finally { model.setActiveWeights(undefined); world.invalidateWorld(); w = await world.getWorld(); }
  for (const c of A.calls(w).slice(0, 300)) {
    assert.equal(c.pickedRed, c.pRed >= 0.5);
    assert.equal(c.correct, c.pickedRed === c.redWon);
    assert.ok(Math.abs(c.pWinner - (c.redWon ? c.pRed : 1 - c.pRed)) < 1e-12);
    assert.ok(Math.abs(c.surprise - -Math.log2(c.pWinner)) < 1e-9);
  }
});

test("scored fights come in date order, no debuts, no upcoming bouts, no draws", () => {
  const cs = A.calls(w);
  for (let i = 1; i < cs.length; i++) assert.ok(cs[i - 1].date <= cs[i].date);
  const seen = new Map<number, number>();
  for (const b of w.bouts) {
    if (b.upcoming || !b.method) continue;
    const c = A.callOf(w, b.id);
    if (b.winnerId === null) assert.equal(c, null, "a draw is not scored");
    for (const id of [b.redId, b.blueId]) {
      if (c && !(seen.get(id))) assert.fail(`bout ${b.id} scored although fighter ${id} had no earlier bout`);
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  for (const b of w.bouts.filter((x) => x.upcoming)) assert.equal(A.callOf(w, b.id), null);
});

test("summary arithmetic: accuracy, log loss, Brier, baselines, calibration bins and finishes on a hand-made set", () => {
  const mk = (pRed: number, redWon: boolean, eloPRed: number, finished: boolean): Call => ({
    boutId: 1, date: "2025-01-01", division: "Lightweight", sex: "male", redId: 1, blueId: 2, pRed, eloPRed, koProb: 0.4, redWon, finished,
    pickedRed: pRed >= 0.5, correct: (pRed >= 0.5) === redWon, pWinner: redWon ? pRed : 1 - pRed, surprise: 0, eloPick: (eloPRed >= 0.5) === redWon,
  });
  const s = A.summarize([mk(0.8, true, 0.6, true), mk(0.8, false, 0.4, false), mk(0.25, false, 0.45, false), mk(0.6, true, 0.7, true)]);
  const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-4, `${what}: ${a} vs ${b}`);
  assert.equal(s.n, 4);
  assert.equal(s.accuracy, 0.75, "the 0.8 pick for red lost; the other three picks won");
  assert.equal(s.eloAccuracy, 1, "the higher-rated fighter won all four");
  close(s.logLoss, (0.223144 + 1.609438 + 0.287682 + 0.510826) / 4, "log loss");
  close(s.eloLogLoss, (0.510826 + 0.510826 + 0.597837 + 0.356675) / 4, "Elo log loss");
  close(s.coinLogLoss, 0.693147, "a coin flip");
  close(s.brier, (0.04 + 0.64 + 0.0625 + 0.16) / 4, "Brier");
  assert.deepEqual(s.calibration.map((b) => b.n), [0, 1, 1, 2, 0], "by the model's confidence in its pick: 60s, 70s, 80s");
  const b80 = s.calibration[3];
  close(b80.predicted, 0.8, "80s said"); close(b80.observed, 0.5, "80s won");
  close(s.finish.predicted, 0.4, "finish predicted"); close(s.finish.observed, 0.5, "finish observed");
  assert.equal(A.summarize([]).n, 0, "an empty set does not divide by zero");
});

test("verdicts: calibrated within 3 points, under- or over-confident beyond, and tiny bins are ignored", () => {
  const bin = (predicted: number, observed: number, n: number) => ({ lo: 0, hi: 1, n, predicted, observed });
  assert.equal(A.calibrationVerdict([bin(0.7, 0.72, 100), bin(0.6, 0.59, 100)]).verdict, "calibrated");
  assert.equal(A.calibrationVerdict([bin(0.65, 0.78, 400), bin(0.74, 0.89, 160)]).verdict, "under", "right more often than it says");
  assert.equal(A.calibrationVerdict([bin(0.7, 0.55, 100)]).verdict, "over");
  assert.equal(A.calibrationVerdict([bin(0.7, 0.2, 5), bin(0.6, 0.61, 200)]).verdict, "calibrated", "a bin of 5 fights is noise");
  assert.equal(A.calibrationVerdict([]).verdict, "calibrated");
  assert.equal(A.finishVerdict({ predicted: 0.54, observed: 0.41, n: 100 }).verdict, "high");
  assert.equal(A.finishVerdict({ predicted: 0.3, observed: 0.41, n: 100 }).verdict, "low");
  assert.equal(A.finishVerdict({ predicted: 0.42, observed: 0.41, n: 100 }).verdict, "calibrated");
});

test("the record: headline is the latest quarter, upsets are the model's lowest-probability winners, divisions need 30 fights", () => {
  const r = A.record(w), cs = A.calls(w);
  assert.equal(r.recent.n, cs.length - Math.floor(cs.length * 0.75));
  assert.equal(r.splitDate, cs[Math.floor(cs.length * 0.75)].date);
  assert.equal(r.recent.from, r.splitDate);
  assert.equal(r.upsets.length, 10);
  for (let i = 1; i < r.upsets.length; i++) assert.ok(r.upsets[i - 1].pWinner <= r.upsets[i].pWinner);
  assert.ok(cs.every((c) => c.pWinner >= r.upsets[9].pWinner || r.upsets.includes(c)), "nothing less likely was left out");
  assert.ok(r.byDivision.every((d) => d.n >= 30));
  assert.equal(r.byYear.reduce((s, y) => s + y.n, 0), cs.length);
  assert.equal(r.all.n, cs.length);
  for (const b of r.recent.calibration) assert.ok(b.lo >= 0.5 && b.hi <= 1);
  assert.equal(r.recent.calibration.reduce((s, b) => s + b.n, 0), r.recent.n, "every call lands in exactly one confidence bin");
});
