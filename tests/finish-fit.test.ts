import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/**
 * The model's early-finish estimate was found, by the Track record page, to expect about 55% of fights to end by stoppage
 * when about 40% do. `npm run model:fit` now fits it on results and applies the fit only when it beats the hand-set rule
 * on held-out fights. These tests pin the old rule, the new one, the decision, and the effect the page shows.
 */
const cleanup = tempDb("finish-fit");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let M: typeof import("../lib/model");
let F: typeof import("../lib/fit");
let MF: typeof import("../lib/model-fit");
let A: typeof import("../lib/accountability");
let wm: typeof import("../lib/world");
before(async () => { wm = await import("../lib/world"); w = await wm.getWorld(); M = await import("../lib/model"); F = await import("../lib/fit"); MF = await import("../lib/model-fit"); A = await import("../lib/accountability"); });

const feat = (koRate: number, koLossRate: number) => ({ rating: 1500, reachCm: 175, age: 28, monthsIdle: 6, koRate, koLossRate });

test("the hand-set rule is unchanged when nothing is fitted, and a fitted model is a clamped logistic", () => {
  M.setActiveFinish(undefined);
  assert.equal(M.activeFinish(), null);
  assert.ok(Math.abs(M.stoppageProbability(feat(0.5, 0.1), feat(0.3, 0.2)) - (0.22 + 0.8 * 0.35 + 0.3 * 0.2)) < 1e-12, "0.22 + 0.35·KO rates + 0.2·KO-loss rates");
  assert.equal(M.stoppageProbability(feat(0, 0), feat(0, 0)), 0.22);
  assert.equal(M.stoppageProbability(feat(1, 1), feat(1, 1)), 0.85, "clamped at 85%");
  const fm = { intercept: -0.5, koRate: 0.25, koLoss: 0.1 };
  const p = M.stoppageProbability(feat(0.5, 0.1), feat(0.3, 0.2), fm);
  assert.ok(Math.abs(p - 1 / (1 + Math.exp(-(-0.5 + 0.25 * 0.8 + 0.1 * 0.3)))) < 1e-12);
  assert.equal(M.stoppageProbability(feat(9, 9), feat(9, 9), { intercept: 5, koRate: 5, koLoss: 5 }), 0.95, "never certain");
  assert.equal(M.stoppageProbability(feat(0, 0), feat(0, 0), { intercept: -9, koRate: 0, koLoss: 0 }), 0.03, "never impossible");
});

test("predictions use the active finish model, an explicit one overrides it, and the browser can be handed one", async () => {
  const { predictFeatures } = await import("../lib/predict");
  const a = feat(0.5, 0.1), b = feat(0.3, 0.2);
  M.setActiveFinish(undefined);
  const plain = predictFeatures(a, b).koProb;
  M.setActiveFinish({ intercept: -0.5, koRate: 0.2, koLoss: 0.1 });
  try {
    assert.notEqual(predictFeatures(a, b).koProb, plain);
    assert.equal(predictFeatures(a, b).koProb, M.stoppageProbability(a, b));
    assert.equal(predictFeatures(a, b, undefined, undefined, null).koProb, plain, "null forces the hand-set rule (what the lab uses with no model)");
    assert.equal(predictFeatures(a, b, undefined, undefined, { intercept: 0, koRate: 0, koLoss: 0 }).koProb, 0.5);
  } finally { M.setActiveFinish(undefined); }
});

test("the fit: same bouts and split as the win model, a fitted model that beats the hand-set rule, and the numbers add up", () => {
  const f = F.runFinishFit(w)!;
  const win = F.runFit(w);
  assert.ok(f);
  assert.equal(f.rows.train + f.rows.test, win.rows.train + win.rows.test, "the same bouts");
  assert.equal(f.rows.splitDate, win.rows.splitDate, "the same time split, so the two reports are comparable");
  assert.ok(f.observed.test > 0.2 && f.observed.test < 0.7);
  assert.ok(f.test.fitted.logLoss < f.test.heuristic.logLoss, "fitted beats the hand-set rule");
  assert.ok(f.test.constant.logLoss < f.test.heuristic.logLoss, "on this league even the base rate beats the hand-set rule");
  assert.ok(Math.abs(f.test.fitted.predicted - f.test.fitted.observed) < 0.03, "the fitted estimate averages what happened");
  assert.ok(Math.abs(f.test.heuristic.predicted - f.test.heuristic.observed) > 0.1, "the hand-set rule is off by more than 10 points");
  assert.equal(f.recommended, "fitted");
  assert.ok(Number.isFinite(f.coef.intercept) && f.coef.se.koRate > 0 && f.coef.se.koLoss > 0);
});

test("the recommendation needs a real gain: a fit that is no better than the hand-set rule is not applied", () => {
  const m = (logLoss: number) => ({ logLoss, brier: 0.25, predicted: 0.4, observed: 0.4 });
  const mk = (heuristic: number, fitted: number) => ({ constant: m(0.69), heuristic: m(heuristic), fitted: m(fitted) });
  assert.equal(F.chooseFinish(mk(0.70, 0.60)), "fitted");
  assert.equal(F.chooseFinish(mk(0.70, 0.699)), "heuristic", "a gain of 0.001 is noise");
  assert.equal(F.chooseFinish(mk(0.70, 0.6975)), "fitted", "a gain of more than 0.002 counts");
  assert.equal(F.chooseFinish(mk(0.70, 0.6985)), "heuristic", "0.0015 does not");
  assert.equal(F.chooseFinish(mk(0.60, 0.65)), "heuristic");
});

test("applying a report sets the finish model only when it recommends one, and clears it otherwise", () => {
  const rep = (recommended: "heuristic" | "fitted") => ({ finish: { recommended, coef: { intercept: -0.5, koRate: 0.2, koLoss: 0.1 } } }) as unknown as import("../lib/fit").FitReport;
  try {
    assert.equal(MF.applyFittedFinish(rep("fitted")), true);
    assert.deepEqual(M.activeFinish(), { intercept: -0.5, koRate: 0.2, koLoss: 0.1 });
    assert.equal(A.weightsInUse().finishFitted, true);
    assert.equal(MF.applyFittedFinish(rep("heuristic")), false);
    assert.equal(M.activeFinish(), null);
    MF.applyFittedFinish(rep("fitted")); assert.equal(MF.applyFittedFinish(null), false); assert.equal(M.activeFinish(), null, "no report clears a stale model");
    assert.equal(MF.applyFittedFinish({} as import("../lib/fit").FitReport), false, "an older report without a finish section changes nothing");
    assert.equal(A.weightsInUse().finishFitted, false);
  } finally { M.setActiveFinish(undefined); }
});

test("the effect the Track record page shows: the finish estimate goes from 'runs high' to calibrated", async () => {
  // a fresh world applies any data/model-fit.json found on disk (as the app does); the test then sets the finish model itself
  wm.invalidateWorld();
  const world = await wm.getWorld();
  M.setActiveFinish(undefined);
  const before = A.finishVerdict(A.record(world).recent.finish);
  assert.equal(before.verdict, "high"); assert.ok(before.gap > 0.1);
  const f = F.runFinishFit(world)!;
  try {
    wm.invalidateWorld();
    const fresh = await wm.getWorld();
    M.setActiveFinish({ intercept: f.coef.intercept, koRate: f.coef.koRate, koLoss: f.coef.koLoss });
    const after = A.finishVerdict(A.record(fresh).recent.finish);
    assert.equal(after.verdict, "calibrated"); assert.ok(Math.abs(after.gap) < 0.03);
  } finally { M.setActiveFinish(undefined); wm.invalidateWorld(); }
});

test("the ledger's model fingerprint is unchanged while no finish model is fitted, and changes when one is", async () => {
  const { modelVersion } = await import("../lib/ledger");
  const { hash } = await import("../lib/hash");
  M.setActiveFinish(undefined);
  assert.equal(modelVersion(), `w${hash(JSON.stringify(M.activeWeights())).toString(36)}`, "earlier ledger rows keep their fingerprint");
  const before = modelVersion();
  M.setActiveFinish({ intercept: -0.5, koRate: 0.2, koLoss: 0.1 });
  try { assert.notEqual(modelVersion(), before, "a different finish model is a different model"); } finally { M.setActiveFinish(undefined); }
});
