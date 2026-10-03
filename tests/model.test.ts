import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WEIGHTS, DRAW_PROB, presetsFor, winProbability, type Features } from "../lib/model";

const base: Features = { rating: 1600, reachCm: 180, age: 30, monthsIdle: 6, koRate: 0.5, koLossRate: 0.05 };

test("identical fighters are a coin flip (less the draw chance)", () => {
  const r = winProbability(base, base);
  assert.ok(Math.abs(r.pA - r.pB) < 1e-12);
  assert.ok(Math.abs(r.pA + r.pB + r.pDraw - 1) < 1e-12);
  assert.equal(r.pDraw, DRAW_PROB);
});

test("with only the rating weight, the model equals the Elo expectation", () => {
  const elo = { ...DEFAULT_WEIGHTS, reach: 0, age: 0, idle: 0, power: 0, chin: 0 };
  const r = winProbability({ ...base, rating: 1700 }, { ...base, rating: 1500 }, elo);
  assert.ok(Math.abs(r.pA / (1 - DRAW_PROB) - 1 / (1 + 10 ** (-200 / 400))) < 1e-9);
});

test("swapping the fighters swaps the probabilities", () => {
  const a = base, b = { ...base, rating: 1550, age: 36 };
  const x = winProbability(a, b), y = winProbability(b, a);
  assert.ok(Math.abs(x.pA - y.pB) < 1e-12 && Math.abs(x.pB - y.pA) < 1e-12);
});

test("each factor pushes the right way", () => {
  const p = (over: Partial<Features>) => winProbability({ ...base, ...over }, base).pA;
  const even = p({});
  assert.ok(p({ rating: 1700 }) > even, "higher rating helps");
  assert.ok(p({ reachCm: 190 }) > even, "longer reach helps");
  assert.ok(p({ age: 40 }) < even, "age past 34 hurts");
  assert.ok(p({ age: 33 }) === even, "age 33 is not penalised");
  assert.ok(p({ monthsIdle: 30 }) < even, "a long layoff hurts");
  assert.ok(p({ monthsIdle: 10 }) === even, "under a year is not penalised");
  assert.ok(p({ koRate: 0.8 }) > even, "power helps");
  assert.ok(p({ koLossRate: 0.3 }) < even, "a weak chin hurts");
});

test("reach is capped so a freak arm cannot swamp everything", () => {
  const p12 = winProbability({ ...base, reachCm: 192 }, base).pA, p40 = winProbability({ ...base, reachCm: 220 }, base).pA;
  assert.equal(p12, p40);
});

test("probabilities stay inside 4%..96% of the decisive share", () => {
  const r = winProbability({ ...base, rating: 3000 }, { ...base, rating: 0 });
  assert.ok(r.pA <= 0.96 * (1 - DRAW_PROB) + 1e-12 && r.pB >= 0.04 * (1 - DRAW_PROB) - 1e-12);
});

test("per-factor shifts add up to roughly the total move", () => {
  const r = winProbability({ ...base, rating: 1650, age: 38 }, base);
  assert.ok(r.shifts.rating > 0 && r.shifts.age < 0);
  assert.ok(Object.values(r.shifts).every(Number.isFinite));
});

test("presets are built from whatever weights are active", () => {
  const fitted = { ...DEFAULT_WEIGHTS, rating: 0.02 };
  const presets = presetsFor(fitted);
  assert.equal(presets[0].weights.rating, 0.02);
  assert.equal(presets.find((p) => p.name === "Pure Elo")!.weights.reach, 0);
  assert.equal(presets.find((p) => p.name === "Pure Elo")!.weights.rating, 0.02);
});
