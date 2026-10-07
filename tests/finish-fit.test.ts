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
let D: typeof import("../lib/divisions");
before(async () => { wm = await import("../lib/world"); w = await wm.getWorld(); M = await import("../lib/model"); F = await import("../lib/fit"); MF = await import("../lib/model-fit"); A = await import("../lib/accountability"); D = await import("../lib/divisions"); });

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
    assert.deepEqual(M.activeFinish(), { intercept: -0.5, koRate: 0.2, koLoss: 0.1, mismatch: 0, weight: 0 }, "a report without the newer inputs applies them as zero");
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

// ---- the finish estimate's other inputs: rating mismatch and weight class ----

const at = (rating: number, weightLb?: number | null, koRate = 0.3, koLossRate = 0.1) => ({ ...feat(koRate, koLossRate), rating, ...(weightLb === undefined ? {} : { weightLb }) });

test("finish inputs: mismatch runs from 0 (even) towards 1 (a rating certainty), weight from 0 at 150 lb to 1 at 220 lb and no limit", () => {
  const [, , even, w0] = M.finishInputs(at(1500, 147), at(1500, 147));
  assert.equal(even, 0);
  assert.ok(Math.abs(w0 - (147 - 150) / 70) < 1e-12);
  const gap = (d: number) => M.finishInputs(at(1500 + d), at(1500))[2];
  assert.ok(gap(100) > 0 && gap(300) > gap(100) && gap(900) < 1, "grows with the gap");
  assert.equal(gap(300), M.finishInputs(at(1500), at(1500 + 300))[2], "does not depend on who is red");
  assert.equal(M.weightScale(150), 0);
  assert.equal(M.weightScale(220), 1);
  assert.equal(M.weightScale(null), 1, "no limit is the heaviest");
  assert.equal(M.weightScale(300), 1, "capped");
  assert.ok(M.weightScale(112) < 0, "lighter divisions are below zero");
  assert.equal(M.weightScale(undefined), 0.5, "unknown is mid-range");
  assert.equal(M.finishInputs(at(1500, 147), at(1500, 175))[3], M.weightScale(175), "two classes: the heavier limit");
  assert.equal(M.finishInputs(at(1500, 147), at(1500))[3], M.weightScale(147), "one unknown: the known one");
  assert.equal(M.finishInputs(at(1500, null), at(1500, 147))[3], 1, "a heavyweight in the fight");
});

test("a finish model with mismatch and weight terms: bigger mismatch and heavier division raise the estimate; an older model without them is unchanged", () => {
  const fm = { intercept: -0.5, koRate: 0.2, koLoss: 0.1, mismatch: 0.8, weight: 0.35 };
  const even = M.stoppageProbability(at(1500, 147), at(1500, 147), fm);
  assert.ok(M.stoppageProbability(at(1700, 147), at(1500, 147), fm) > even, "a mismatch ends early more often");
  assert.ok(M.stoppageProbability(at(1500, null), at(1500, null), fm) > even, "heavyweights end early more often");
  assert.ok(M.stoppageProbability(at(1500, 112), at(1500, 112), fm) < even, "and flyweights less");
  const old = { intercept: -0.5, koRate: 0.2, koLoss: 0.1 };
  const a = at(1800, null), b = at(1500, null);
  assert.equal(M.stoppageProbability(a, b, old), M.stoppageProbability(a, b, { ...old, mismatch: 0, weight: 0 }), "absent terms count as zero");
  assert.ok(Math.abs(M.stoppageProbability(a, b, old) - 1 / (1 + Math.exp(-(-0.5 + 0.2 * 0.6 + 0.1 * 0.2)))) < 1e-12, "the same arithmetic as before they existed");
  // the hand-set rule ignores them
  M.setActiveFinish(undefined);
  assert.equal(M.stoppageProbability(at(1800, null), at(1500, null)), M.stoppageProbability(at(1500, 112), at(1500, 112)));
});

test("the backtest uses each fight's own division and the ratings before it, and the fit keeps only inputs that clear |z| >= 2", () => {
  const cs = A.callsForFit(w);
  const byBout = new Map(w.bouts.map((b) => [b.id, b]));
  assert.ok(cs.length > 400);
  const { divisionInfo } = D;
  for (const c of cs.slice(0, 300)) {
    const x = c.finishX!;
    assert.equal(x.length, M.FINISH_INPUTS.length);
    assert.equal(x[3], M.weightScale(divisionInfo(byBout.get(c.boutId)!.weightClass)?.lb), "the weight scale of the fight's division");
    assert.ok(Math.abs(x[2] - Math.abs(2 * c.eloPRed - 1)) < 1e-9, "mismatch is the plain-Elo gap before the fight");
  }
  const f = F.runFinishFit(w)!;
  for (const k of M.FINISH_INPUTS) {
    const kept = f.coef.kept.includes(k);
    assert.equal(kept, Math.abs(f.coef.z[k]) >= 2, `${k}: kept exactly when |z| >= 2`);
    if (!kept) assert.equal(f.coef[k], 0, `${k} is dropped, so its coefficient is exactly zero`);
    else assert.notEqual(f.coef[k], 0);
  }
  assert.ok(f.coef.kept.includes("mismatch") && f.coef.kept.includes("weight"), "the two new inputs earn their place on this league");
  assert.ok(f.coef.mismatch > 0 && f.coef.weight > 0, "mismatches and heavier divisions end early more often");
});

test("the extra inputs are worth having: held-out log-loss beats the KO-rate-only fit by more than the noise bar", () => {
  const f = F.runFinishFit(w)!;
  assert.ok(f.test.fitted.logLoss < f.test.koOnly.logLoss - F.MIN_GAIN, `${f.test.fitted.logLoss} vs ${f.test.koOnly.logLoss}`);
  assert.ok(f.test.koOnly.logLoss < f.test.heuristic.logLoss);
  assert.ok(Math.abs(f.test.fitted.predicted - f.test.fitted.observed) < 0.03);
});

test("applying a fitted report carries the new terms; a report from before them still applies", () => {
  const f = F.runFinishFit(w)!;
  const rep = (coef: object) => ({ finish: { recommended: "fitted", coef } }) as unknown as import("../lib/fit").FitReport;
  try {
    assert.equal(MF.applyFittedFinish(rep(f.coef)), true);
    assert.deepEqual(M.activeFinish(), { intercept: f.coef.intercept, koRate: f.coef.koRate, koLoss: f.coef.koLoss, mismatch: f.coef.mismatch, weight: f.coef.weight });
    assert.equal(MF.applyFittedFinish(rep({ intercept: -0.5, koRate: 0.2, koLoss: 0.1 })), true, "an older report has no mismatch or weight");
    assert.deepEqual(M.activeFinish(), { intercept: -0.5, koRate: 0.2, koLoss: 0.1, mismatch: 0, weight: 0 });
  } finally { M.setActiveFinish(undefined); }
});
