import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mulberry32 } from "../lib/prng";
import { chooseModel, evaluate, fitLogistic, MIN_GAIN, type Metrics, type Row } from "../lib/fit";
import { tempDb } from "./helpers";

const cleanup = tempDb("fit");
after(cleanup);
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function synthetic(n: number, truth: number[], intercept = 0): Row[] {
  const r = mulberry32(42);
  const g = () => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return Array.from({ length: n }, (_, i) => {
    const x = truth.map(() => g());
    const p = sigmoid(intercept + x.reduce((s, v, j) => s + v * truth[j], 0));
    return { date: "2020-01-01", boutId: i, x, y: r() < p ? 1 : 0 } as Row;
  });
}

test("logistic regression recovers known coefficients within sampling error", () => {
  const truth = [0.9, -0.5, 0, 0.3];
  const fit = fitLogistic(synthetic(6000, truth, 0.2), 0.5);
  truth.forEach((t, j) => assert.ok(Math.abs(fit.weights[j] - t) < 3 * fit.se[j] + 0.03, `weight ${j}: fitted ${fit.weights[j].toFixed(3)} vs true ${t} (se ${fit.se[j].toFixed(3)})`));
  assert.ok(Math.abs(fit.intercept - 0.2) < 0.1);
  assert.ok(Math.abs(fit.z[0]) > 10 && Math.abs(fit.z[2]) < 3, "a real effect is highly significant; a null one is not");
});

test("standard errors shrink with more data", () => {
  const small = fitLogistic(synthetic(800, [0.8]), 0.5), big = fitLogistic(synthetic(8000, [0.8]), 0.5);
  assert.ok(big.se[0] < small.se[0] / 2);
});

test("evaluate: a perfect predictor beats a coin flip, and metrics are sane", () => {
  const rows = synthetic(2000, [1.5]);
  const fit = fitLogistic(rows);
  const good = evaluate(rows, (x) => sigmoid(fit.intercept + x[0] * fit.weights[0]));
  const coin = evaluate(rows, () => 0.5);
  assert.ok(good.logLoss < coin.logLoss && good.brier < coin.brier && good.accuracy > 0.6);
  assert.ok(Math.abs(coin.logLoss - Math.log(2)) < 1e-9);
});

test("the fitter runs end to end on the demo league and reports honestly", async () => {
  const { getWorld } = await import("../lib/world");
  const { runFit } = await import("../lib/fit");
  const report = runFit(await getWorld());
  assert.ok(report.rows.train > 2000 && report.rows.test > 600);
  assert.ok(report.rows.splitDate > report.rows.from, "test bouts are the most recent ones");
  assert.equal(report.features.length, 11);
  const elo = report.features.find((f) => f.key === "elo")!;
  assert.ok(elo.z > 8 && elo.selected, "the rating gap is overwhelmingly predictive");
  assert.ok(report.eloRefit.perPoint > 0);
  assert.ok(report.test.eloOnly.logLoss < report.test.baseline.logLoss, "refitting the Elo scale beats a plain Elo expectation");
  assert.ok(["plain Elo", "Elo refit", "all features", "selected features"].includes(report.recommended));
  assert.equal(report.calibration.reduce((s, c) => s + c.n, 0), report.rows.test);
});

const m = (logLoss: number): Metrics => ({ n: 1000, logLoss, accuracy: 0.65, brier: 0.2 });
const candidates = (base: number, elo: number, selected: number, full: number) => ({ baseline: m(base), eloOnly: m(elo), selected: m(selected), full: m(full) });

test("model choice prefers the simpler model unless the complex one clearly wins", () => {
  assert.equal(chooseModel(candidates(0.617, 0.581, 0.581, 0.5796)), "Elo refit", "a 0.0017 gain is within noise");
  assert.equal(chooseModel(candidates(0.617, 0.581, 0.581, 0.581 - MIN_GAIN - 0.001)), "all features", "a clear gain wins");
  assert.equal(chooseModel(candidates(0.600, 0.601, 0.602, 0.603)), "plain Elo", "refitting that does not help is not used");
  assert.equal(chooseModel(candidates(0.617, 0.590, 0.585, 0.584)), "selected features", "selected features win, but all-features is not a clear step beyond them");
});
