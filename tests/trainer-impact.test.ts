import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";
import { fitEffects, LOGIT_TO_ELO, MIN_INFORMATIVE_FIGHTS, PENALTY, type Observation } from "../lib/trainer-impact";
import { mulberry32 } from "../lib/prng";

const cleanup = tempDb("trainer-impact");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-ti-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

const corr = (p: [number, number][]) => {
  const n = p.length, mx = p.reduce((s, x) => s + x[0], 0) / n, my = p.reduce((s, x) => s + x[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** A league where the truth is known: 400 fighters of different ability, 40 trainers with real effects, fights decided by the model's own formula. */
function simulate(opts: { moving: boolean; seed: number }) {
  const r = mulberry32(opts.seed);
  const nF = 400, nT = 40;
  const level = Array.from({ length: nF }, () => gauss(r) * 1.0);
  const effect = Array.from({ length: nT }, () => gauss(r) * 0.3);
  // each fighter: a first trainer, and (when moving) a second one for the second half of their career
  const first = Array.from({ length: nF }, () => Math.floor(r() * nT));
  const second = Array.from({ length: nF }, (_, f) => (opts.moving ? (first[f] + 1 + Math.floor(r() * (nT - 1))) % nT : first[f]));
  const obs: Observation[] = [];
  for (let k = 0; k < 6000; k++) {
    const a = Math.floor(r() * nF); let b = Math.floor(r() * nF); if (b === a) b = (b + 1) % nF;
    const late = k >= 3000;
    const ta = late ? second[a] : first[a], tb = late ? second[b] : first[b];
    const z = level[a] + effect[ta] - level[b] - effect[tb];
    obs.push({ red: a, blue: b, redTrainer: ta, blueTrainer: tb, y: r() < 1 / (1 + Math.exp(-z)) ? 1 : 0 });
  }
  return { obs, effect, nF, nT };
}

test("fitted trainer effects recover the truth when fighters have changed trainer", () => {
  const { obs, effect, nF, nT } = simulate({ moving: true, seed: 11 });
  const fit = fitEffects(obs, nF, nT);
  const r = corr(effect.map((e, i) => [fit.trainer[i], e]));
  assert.ok(r > 0.6, `correlation with the true effects was ${r.toFixed(2)}`);
  const big = effect.map((e, i) => [e, fit.trainer[i]]).filter(([e]) => Math.abs(e) > 0.3);
  const agree = big.filter(([e, f]) => Math.sign(e) === Math.sign(f)).length / big.length;
  assert.ok(agree > 0.75, `sign agreement on the big effects was ${agree.toFixed(2)}`);
  assert.ok(Math.max(...fit.trainer) * LOGIT_TO_ELO < 150, "estimates stay on a believable scale");
});

test("a trainer whose fighters never left cannot be told apart from their fighters' ability, so little is claimed", () => {
  const { obs, effect, nF, nT } = simulate({ moving: false, seed: 12 });
  const fit = fitEffects(obs, nF, nT);
  const sd = (xs: ArrayLike<number>) => Math.sqrt(Array.from(xs).reduce((s, x) => s + x * x, 0) / xs.length);
  assert.ok(sd(fit.trainer) < 0.4 * sd(effect), `estimated spread ${sd(fit.trainer).toFixed(3)} against a true spread of ${sd(effect).toFixed(3)}`);
  assert.equal(fit.info.reduce((s, x) => s + x, 0), 0, "no fight carries evidence when nobody switched");
});

test("the penalty does what it says: a huge one zeroes every effect", () => {
  const { obs, nF, nT } = simulate({ moving: true, seed: 13 });
  const flat = fitEffects(obs, nF, nT, { fighter: PENALTY.fighter, trainer: 1e9 });
  assert.ok(Math.max(...Array.from(flat.trainer).map(Math.abs)) < 1e-6);
});

test("on the demo league the fitted effects track the boost the generator built in, and the error bars hold", async () => {
  const { getWorld } = await import("../lib/world");
  const { trainerImpact, VERDICT_LABEL } = await import("../lib/trainer-impact");
  const { demoProvider, demoTruth } = await import("../lib/providers/demo");
  const w = await getWorld();
  demoProvider(new Date("2026-10-03"));
  const truth = demoTruth()!.trainerBoost;
  const T = trainerImpact(w);
  const pairs = T.all.map((x) => [x.effect, truth.get(x.person.name) ?? NaN] as [number, number]).filter((x) => !Number.isNaN(x[1]));
  assert.ok(pairs.length > 100);
  assert.ok(corr(pairs) > 0.3, `correlation with the demo's true trainer boost was ${corr(pairs).toFixed(2)}`);
  const covered = T.all.filter((x) => Math.abs(x.effect - (truth.get(x.person.name) ?? 1e9)) <= 1.96 * x.se).length / T.all.length;
  assert.ok(covered > 0.85, `the 95% range held the truth for ${(covered * 100).toFixed(0)}% of trainers`);
  // the verdicts follow the stated rule exactly
  for (const x of T.all) {
    const want = x.evidence === "thin" ? "unclear" : x.effect - 1.96 * x.se > 0 ? "above" : x.effect + 1.96 * x.se < 0 ? "below" : x.effect - 1.28 * x.se > 0 ? "leaning above" : x.effect + 1.28 * x.se < 0 ? "leaning below" : "unclear";
    assert.equal(x.verdict, want, x.person.name);
    assert.ok(VERDICT_LABEL[x.verdict]);
    assert.equal(x.evidence === "thin", x.informative < MIN_INFORMATIVE_FIGHTS);
  }
  assert.deepEqual(T.ranked.map((x) => x.effect), [...T.ranked.map((x) => x.effect)].sort((a, b) => b - a));
  assert.ok(T.ranked.every((x) => x.evidence !== "thin"));
});

test("underdog records match a brute-force count from the raw fights", async () => {
  const { getWorld } = await import("../lib/world");
  const { underdogLifters, underdogRecordOf } = await import("../lib/trainer-impact");
  const w = await getWorld();
  const head = (id: number, date: string) => (w.stintsByBoxer.get(id) ?? []).find((s) => s.role === "head_trainer" && s.personId && (!s.start || s.start <= date) && (!s.end || s.end > date))?.personId;
  const mine = new Map<number, { n: number; wins: number; exp: number }>();
  for (const b of w.bouts) {
    if (b.upcoming || b.method === null || b.method === "NC") continue;
    const pre = w.boutPre.get(b.id); if (!pre) continue;
    for (const [id, own, opp] of [[b.redId, pre.red, pre.blue], [b.blueId, pre.blue, pre.red]]) {
      const p = 1 / (1 + 10 ** ((opp - own) / 400)); if (p >= 0.4) continue;
      const t = head(id, b.date); if (!t) continue;
      const e = mine.get(t) ?? { n: 0, wins: 0, exp: 0 }; e.n++; e.exp += p; e.wins += b.winnerId === id ? 1 : b.winnerId === null ? 0.5 : 0; mine.set(t, e);
    }
  }
  for (const l of underdogLifters(w)) { const m = mine.get(l.person.id)!; assert.equal(l.underdogFights, m.n); assert.ok(Math.abs(l.wins - m.wins) < 1e-9 && Math.abs(l.expected - m.exp) < 1e-9); assert.ok(l.underdogFights >= 12); }
  const one = [...mine].find(([, m]) => m.n >= 3)!;
  assert.equal(underdogRecordOf(w, one[0])!.underdogFights, one[1].n);
});
