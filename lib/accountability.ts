/**
 * Model accountability: how good are the win probabilities the site shows?
 *
 * For every completed, decisive bout we recompute what the model (the same `winProbability` and the same active weights
 * as the predictor page) would have said BEFORE the opening bell, using only what was known then: the pre-fight Elo
 * (`boutPre`, replayed chronologically at ingest), the fighters' record and layoff up to their previous fight, and their
 * age that year. The result is then compared with what happened. Fighters with no earlier bout in the database are
 * skipped (the model has nothing to go on), exactly as the fitter does, so the two always agree on which bouts count.
 *
 * This is a BACKTEST, not a live record: the weights were chosen (and the Elo scale fitted) with these results in view,
 * so the headline numbers use the most recent 25% of bouts, the period the fitter held out, and say so. A live ledger of
 * predictions locked before a card is a separate thing (it cannot be replayed after the fact).
 */
import type { World } from "./world";
import { memo } from "./memo";
import { countsInRecord, isStoppage } from "./methods";
import { activeWeights, DEFAULT_WEIGHTS, stoppageProbability, winProbability, type Features } from "./model";

export interface Call {
  boutId: number; date: string; division: string; sex: "male" | "female";
  redId: number; blueId: number;
  pRed: number; // model's chance red beats blue, given a decisive result
  eloPRed: number; // plain Elo expectation, the baseline
  koProb: number; // model's chance the fight ends inside the distance
  redWon: boolean;
  finished: boolean; // ended by KO/TKO/RTD/DQ-stoppage
  pickedRed: boolean;
  correct: boolean;
  pWinner: number; // the probability the model gave to whoever actually won
  surprise: number; // -log2(pWinner): 0 = foreseen, 1 = a coin-flip's worth, 3+ = a real shock
  eloPick: boolean; // did the higher pre-fight Elo win?
}

interface State { bouts: number; wins: number; kos: number; koLosses: number; last: string | null }
const months = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (30.4 * 86400000);

/** One Call per scored bout, chronological. */
export function calls(w: World): Call[] {
  return memo(w, "accountability.calls", () => {
    const st = new Map<number, State>();
    const get = (id: number) => st.get(id) ?? st.set(id, { bouts: 0, wins: 0, kos: 0, koLosses: 0, last: null }).get(id)!;
    const weights = activeWeights();
    const out: Call[] = [];
    for (const b of w.bouts) {
      if (b.upcoming || !countsInRecord(b.method)) continue;
      const red = w.byId.get(b.redId)!, blue = w.byId.get(b.blueId)!;
      const sr = get(b.redId), sb = get(b.blueId);
      const pre = w.boutPre.get(b.id);
      if (b.winnerId && pre && sr.bouts >= 1 && sb.bouts >= 1) {
        const feat = (s: State, f: typeof red, rating: number): Features => ({
          rating, reachCm: f.reachCm, age: Number(b.date.slice(0, 4)) - f.birthYear,
          monthsIdle: s.last ? Math.min(36, months(s.last, b.date)) : 12,
          koRate: s.wins ? s.kos / s.wins : 0, koLossRate: s.bouts ? s.koLosses / s.bouts : 0,
        });
        const a = feat(sr, red, pre.red), u = feat(sb, blue, pre.blue);
        const r = winProbability(a, u, weights);
        const pRed = r.pA / (r.pA + r.pB);
        const redWon = b.winnerId === b.redId;
        const pWinner = redWon ? pRed : 1 - pRed;
        out.push({
          boutId: b.id, date: b.date, division: b.weightClass, sex: red.sex, redId: b.redId, blueId: b.blueId,
          pRed, eloPRed: 1 / (1 + Math.pow(10, (pre.blue - pre.red) / 400)), koProb: stoppageProbability(a, u),
          redWon, finished: isStoppage(b.method), pickedRed: pRed >= 0.5, correct: (pRed >= 0.5) === redWon,
          pWinner, surprise: -Math.log2(Math.max(pWinner, 1e-6)), eloPick: (pre.red >= pre.blue) === redWon,
        });
      }
      // update running state AFTER the bout is used, never before
      for (const [id, s] of [[b.redId, sr], [b.blueId, sb]] as const) {
        s.bouts++; s.last = b.date;
        if (b.winnerId === id) { s.wins++; if (isStoppage(b.method)) s.kos++; }
        else if (b.winnerId && isStoppage(b.method)) s.koLosses++;
      }
    }
    return out;
  });
}

export interface Bin { lo: number; hi: number; n: number; predicted: number; observed: number }
export interface Summary {
  n: number; from: string | null; to: string | null;
  accuracy: number; eloAccuracy: number;
  logLoss: number; eloLogLoss: number; coinLogLoss: number; brier: number;
  /** by how confident the model was in its pick: predicted = mean confidence, observed = how often that pick won */
  calibration: Bin[];
  finish: { predicted: number; observed: number; n: number };
}

const EDGES = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
export function summarize(cs: Call[]): Summary {
  const n = cs.length;
  const mean = (f: (c: Call) => number) => (n ? cs.reduce((s, c) => s + f(c), 0) / n : 0);
  const clamp = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));
  const ll = (p: number, won: boolean) => -Math.log(clamp(won ? p : 1 - p));
  const calibration: Bin[] = EDGES.slice(0, -1).map((lo, i) => {
    const hi = EDGES[i + 1];
    const rows = cs.filter((c) => { const conf = Math.max(c.pRed, 1 - c.pRed); return conf >= lo && conf < hi; });
    const m = (f: (c: Call) => number) => (rows.length ? rows.reduce((s, c) => s + f(c), 0) / rows.length : 0);
    return { lo, hi: Math.min(hi, 1), n: rows.length, predicted: m((c) => Math.max(c.pRed, 1 - c.pRed)), observed: m((c) => (c.correct ? 1 : 0)) };
  });
  return {
    n, from: n ? cs[0].date : null, to: n ? cs[n - 1].date : null,
    accuracy: mean((c) => (c.correct ? 1 : 0)), eloAccuracy: mean((c) => (c.eloPick ? 1 : 0)),
    logLoss: mean((c) => ll(c.pRed, c.redWon)), eloLogLoss: mean((c) => ll(c.eloPRed, c.redWon)), coinLogLoss: Math.log(2),
    brier: mean((c) => (c.pRed - (c.redWon ? 1 : 0)) ** 2),
    calibration,
    finish: { predicted: mean((c) => c.koProb), observed: mean((c) => (c.finished ? 1 : 0)), n },
  };
}

export interface TrackRecord {
  all: Summary;
  /** the most recent quarter of bouts: the period the fitter held out */
  recent: Summary;
  splitDate: string | null;
  byDivision: { division: string; sex: "male" | "female"; n: number; accuracy: number }[];
  byYear: { year: number; n: number; accuracy: number; logLoss: number }[];
  upsets: Call[];
}

export function record(w: World): TrackRecord {
  return memo(w, "accountability.record", () => {
    const cs = calls(w);
    const cut = Math.floor(cs.length * 0.75);
    const recent = cs.slice(cut);
    const group = <K,>(key: (c: Call) => K) => { const m = new Map<K, Call[]>(); for (const c of cs) (m.get(key(c)) ?? m.set(key(c), []).get(key(c))!).push(c); return m; };
    const byDivision = [...group((c) => `${c.sex}|${c.division}`).entries()].map(([, v]) => ({ division: v[0].division, sex: v[0].sex, n: v.length, accuracy: summarize(v).accuracy })).filter((d) => d.n >= 30).sort((a, b) => b.n - a.n);
    const byYear = [...group((c) => Number(c.date.slice(0, 4))).entries()].map(([year, v]) => { const s = summarize(v); return { year, n: v.length, accuracy: s.accuracy, logLoss: s.logLoss }; }).sort((a, b) => a.year - b.year);
    const upsets = [...cs].sort((a, b) => a.pWinner - b.pWinner).slice(0, 10);
    return { all: summarize(cs), recent: summarize(recent), splitDate: recent[0]?.date ?? null, byDivision, byYear, upsets };
  });
}

/** The model's pre-fight call on one completed bout, or null if it was not scored (upcoming, draw, no-contest, a debut). */
export function callOf(w: World, boutId: number): Call | null {
  return memo(w, "accountability.index", () => new Map(calls(w).map((c) => [c.boutId, c]))).get(boutId) ?? null;
}

export type Verdict = "calibrated" | "under" | "over";
/**
 * Whether the model's stated confidence matches how often it was right, from the bins with enough fights to mean something.
 * "under": it wins more often than it claims (probabilities too close to 50%). "over": it wins less often than it claims.
 */
export function calibrationVerdict(bins: Bin[], minPerBin = 20, tolerance = 0.03): { verdict: Verdict; gap: number; n: number } {
  const used = bins.filter((b) => b.n >= minPerBin);
  const n = used.reduce((s, b) => s + b.n, 0);
  if (!n) return { verdict: "calibrated", gap: 0, n: 0 };
  const gap = used.reduce((s, b) => s + (b.observed - b.predicted) * b.n, 0) / n; // + means right more often than claimed
  return { verdict: gap > tolerance ? "under" : gap < -tolerance ? "over" : "calibrated", gap, n };
}

/** The same check for the model's "ends inside the distance" estimate: positive gap = it predicts more finishes than happen. */
export function finishVerdict(f: Summary["finish"], tolerance = 0.03): { verdict: "calibrated" | "high" | "low"; gap: number } {
  const gap = f.predicted - f.observed;
  return { verdict: Math.abs(gap) <= tolerance ? "calibrated" : gap > 0 ? "high" : "low", gap };
}

/** How the model's win weights were set: the hand-set defaults, or with the Elo scale fitted to results (`npm run model:fit`). */
export function weightsInUse(): { fitted: boolean; eloScale: number } {
  const r = activeWeights().rating / DEFAULT_WEIGHTS.rating;
  return { fitted: Math.abs(r - 1) > 0.01, eloScale: r };
}
