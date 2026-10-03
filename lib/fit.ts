/**
 * Fits win-probability weights from historical bouts with L2-regularised logistic regression (Newton / IRLS).
 *
 * Every feature is something known BEFORE the opening bell (running statistics up to the previous fight, the
 * pre-fight Elo rating, and, for `weightEdge`, the fight-night weight, which a commission knows on fight day).
 * The model is evaluated on the most recent 25% of bouts it never saw, against an Elo-only baseline, so a
 * feature earns its place only if it improves out-of-sample log-loss.
 *
 * It runs on whatever the database holds. On the demo league it recovers effects the simulator planted
 * (a fight-night weight edge, trainers, a home-judge bias); on real data it finds whatever is actually there.
 */
import type { World } from "./world";

export const FEATURES = [
  { key: "elo", label: "Elo rating gap", unit: "per 100 pts", scale: 1 },
  { key: "reach", label: "Reach", unit: "per cm", scale: 1 },
  { key: "age", label: "Age", unit: "per year", scale: 1 },
  { key: "idle", label: "Layoff", unit: "per month", scale: 1 },
  { key: "ko", label: "Knockout rate", unit: "per 10 pts", scale: 0.1 },
  { key: "chin", label: "KO-loss rate", unit: "per 10 pts", scale: 0.1 },
  { key: "exp", label: "Experience (log fights)", unit: "per unit", scale: 1 },
  { key: "rehyd", label: "Usual rehydration", unit: "per lb", scale: 1 },
  { key: "weightEdge", label: "Fight-night weight edge", unit: "per lb", scale: 1 },
  { key: "newTrainer", label: "New trainer (<6 mo)", unit: "vs not", scale: 1 },
  { key: "trainerWins", label: "Trainer's prior win rate", unit: "per 10 pts", scale: 0.1 },
] as const;
export type FeatureKey = (typeof FEATURES)[number]["key"];

export interface Row { date: string; boutId: number; x: number[]; y: 0 | 1 }

interface State { bouts: number; wins: number; kos: number; koLosses: number; last: string | null; rehydSum: number; rehydN: number }
const blank = (): State => ({ bouts: 0, wins: 0, kos: 0, koLosses: 0, last: null, rehydSum: 0, rehydN: 0 });
const months = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (30.4 * 86400000);

/** Builds one row per decisive, completed bout from red's point of view (feature = red minus blue). */
export function buildDataset(w: World): Row[] {
  const st = new Map<number, State>();
  const get = (id: number) => st.get(id) ?? st.set(id, blank()).get(id)!;
  // head-trainer tenures per boxer, and each trainer's running results (updated as we replay time)
  const heads = new Map<number, { person: number; start: string; end: string | null }[]>();
  for (const s of w.stints) if (s.role === "head_trainer" && s.personId && s.start) (heads.get(s.boxerId) ?? heads.set(s.boxerId, []).get(s.boxerId)!).push({ person: s.personId, start: s.start, end: s.end });
  const trainerRec = new Map<number, { w: number; n: number }>();
  const headAt = (id: number, date: string) => heads.get(id)?.find((t) => t.start <= date && (t.end === null || date < t.end)) ?? null;

  const rows: Row[] = [];
  for (const b of w.bouts) {
    if (b.upcoming || !b.method || b.method === "NC") continue;
    const red = w.byId.get(b.redId)!, blue = w.byId.get(b.blueId)!;
    const sr = get(b.redId), sb = get(b.blueId);
    const pre = w.boutPre.get(b.id);
    const wi = w.weighInsByBout.get(b.id);
    const wr = wi?.find((x) => x.boxerId === b.redId), wb = wi?.find((x) => x.boxerId === b.blueId);
    const hr = headAt(b.redId, b.date), hb = headAt(b.blueId, b.date);
    const side = (id: number, s: State, h: typeof hr, f: typeof red) => ({
      reach: f.reachCm, age: Number(b.date.slice(0, 4)) - f.birthYear, idle: s.last ? Math.min(36, months(s.last, b.date)) : 12,
      ko: s.wins ? s.kos / s.wins : 0, chin: s.bouts ? s.koLosses / s.bouts : 0, exp: Math.log1p(s.bouts),
      rehyd: s.rehydN ? s.rehydSum / s.rehydN : 0,
      newTrainer: h && months(h.start, b.date) < 6 ? 1 : 0,
      trainerWins: h ? (() => { const r = trainerRec.get(h.person); return r && r.n >= 8 ? r.w / r.n : 0.5; })() : 0.5,
    });
    const r = side(b.redId, sr, hr, red), u = side(b.blueId, sb, hb, blue);
    if (b.winnerId && pre && sr.bouts >= 1 && sb.bouts >= 1) {
      const x = [
        (pre.red - pre.blue) / 100, r.reach - u.reach, r.age - u.age, r.idle - u.idle, r.ko - u.ko, r.chin - u.chin, r.exp - u.exp, r.rehyd - u.rehyd,
        wr?.fightNightLb && wb?.fightNightLb ? wr.fightNightLb - wb.fightNightLb : 0, r.newTrainer - u.newTrainer, r.trainerWins - u.trainerWins,
      ];
      rows.push({ date: b.date, boutId: b.id, x, y: b.winnerId === b.redId ? 1 : 0 });
    }
    // update running state AFTER the bout is used
    for (const [id, s, f, fw] of [[b.redId, sr, red, wr], [b.blueId, sb, blue, wb]] as const) {
      s.bouts++; s.last = b.date;
      if (b.winnerId === id) { s.wins++; if (b.method === "KO" || b.method === "TKO") s.kos++; }
      else if (b.winnerId && (b.method === "KO" || b.method === "TKO")) s.koLosses++;
      if (fw?.fightNightLb && fw.officialLb) { s.rehydSum += fw.fightNightLb - fw.officialLb; s.rehydN++; }
      void f;
    }
    for (const [id, h] of [[b.redId, hr], [b.blueId, hb]] as const) {
      if (!h) continue;
      const rec = trainerRec.get(h.person) ?? trainerRec.set(h.person, { w: 0, n: 0 }).get(h.person)!;
      if (b.winnerId) { rec.n++; if (b.winnerId === id) rec.w++; }
    }
  }
  return rows;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/** Solves A x = b by Gaussian elimination with partial pivoting. Also returns diag(A^-1) when `invDiag` is requested. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let k = c; k <= n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r) => r[n]);
}
function invertDiag(A: number[][]): number[] {
  const n = A.length;
  return Array.from({ length: n }, (_, j) => solve(A, Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)))[j]);
}

export interface Fit {
  intercept: number;
  weights: number[]; // on original feature units
  se: number[];
  z: number[];
}

/** L2-regularised logistic regression on standardised features, Newton iterations. Intercept is not penalised. */
export function fitLogistic(rows: Row[], lambda = 1): Fit {
  const k = rows[0].x.length, n = rows.length;
  const mean = Array.from({ length: k }, (_, j) => rows.reduce((s, r) => s + r.x[j], 0) / n);
  const sd = Array.from({ length: k }, (_, j) => Math.sqrt(rows.reduce((s, r) => s + (r.x[j] - mean[j]) ** 2, 0) / n) || 1);
  const Z = rows.map((r) => [1, ...r.x.map((v, j) => (v - mean[j]) / sd[j])]);
  let beta = new Array(k + 1).fill(0);
  let H: number[][] = [];
  for (let it = 0; it < 30; it++) {
    const g = new Array(k + 1).fill(0);
    H = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const p = sigmoid(Z[i].reduce((s, v, j) => s + v * beta[j], 0)), wgt = p * (1 - p);
      for (let a = 0; a <= k; a++) { g[a] += Z[i][a] * (p - rows[i].y); for (let b = a; b <= k; b++) H[a][b] += wgt * Z[i][a] * Z[i][b]; }
    }
    for (let a = 0; a <= k; a++) { for (let b = 0; b < a; b++) H[a][b] = H[b][a]; if (a > 0) { H[a][a] += lambda; g[a] += lambda * beta[a]; } }
    const step = solve(H, g);
    beta = beta.map((v, j) => v - step[j]);
    if (Math.sqrt(step.reduce((s, v) => s + v * v, 0)) < 1e-7) break;
  }
  const varDiag = invertDiag(H);
  // back to original units
  const weights = beta.slice(1).map((b, j) => b / sd[j]);
  const se = varDiag.slice(1).map((v, j) => Math.sqrt(v) / sd[j]);
  const intercept = beta[0] - weights.reduce((s, w, j) => s + w * mean[j], 0);
  return { intercept, weights, se, z: weights.map((w, j) => w / (se[j] || 1)) };
}

export interface Metrics { n: number; logLoss: number; accuracy: number; brier: number }
export function evaluate(rows: Row[], prob: (x: number[]) => number): Metrics {
  let ll = 0, ok = 0, br = 0;
  for (const r of rows) {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, prob(r.x)));
    ll += -(r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p));
    br += (p - r.y) ** 2;
    if ((p >= 0.5 ? 1 : 0) === r.y) ok++;
  }
  return { n: rows.length, logLoss: ll / rows.length, accuracy: ok / rows.length, brier: br / rows.length };
}

export interface FitReport {
  generatedAt: string;
  rows: { train: number; test: number; from: string; to: string; splitDate: string };
  /** Full model: every feature. `selected` marks the ones with |z| >= 2 on the training data. */
  features: { key: FeatureKey; label: string; unit: string; weight: number; se: number; z: number; effect: number; effectSe: number; selected: boolean }[];
  intercept: number;
  /** Elo-only refit: log-odds per rating point, and the corner intercept. */
  eloRefit: { perPoint: number; intercept: number };
  /** Weights (original feature units) of the model refit on selected features only; 0 for dropped ones. */
  selectedWeights: number[];
  selectedIntercept: number;
  test: { baseline: Metrics; eloOnly: Metrics; full: Metrics; selected: Metrics };
  recommended: "plain Elo" | "Elo refit" | "all features" | "selected features";
  calibration: { bucket: string; n: number; predicted: number; actual: number }[]; // for the recommended model
}

export function runFit(w: World): FitReport {
  const rows = buildDataset(w).sort((a, b) => a.date.localeCompare(b.date) || a.boutId - b.boutId);
  if (rows.length < 400) throw new Error(`Only ${rows.length} usable bouts; need at least 400 to fit ${FEATURES.length} features sensibly.`);
  const cut = Math.floor(rows.length * 0.75);
  const train = rows.slice(0, cut), test = rows.slice(cut);

  const full = fitLogistic(train);
  const eloOnly = fitLogistic(train.map((r) => ({ ...r, x: [r.x[0]] })));
  // Keep Elo plus any feature that is clearly non-zero on the training data, then refit: drops noise features.
  const keep = FEATURES.map((_, j) => j === 0 || Math.abs(full.z[j]) >= 2);
  const idx = keep.flatMap((k, j) => (k ? [j] : []));
  const sel = fitLogistic(train.map((r) => ({ ...r, x: idx.map((j) => r.x[j]) })));
  const selectedWeights = FEATURES.map((_, j) => { const i = idx.indexOf(j); return i >= 0 ? sel.weights[i] : 0; });

  const lin = (b0: number, wts: number[]) => (x: number[]) => sigmoid(b0 + x.reduce((s, v, j) => s + v * wts[j], 0));
  const pFull = lin(full.intercept, full.weights), pSel = lin(sel.intercept, selectedWeights);
  const pElo = (x: number[]) => sigmoid(eloOnly.intercept + x[0] * eloOnly.weights[0]);
  const pBase = (x: number[]) => sigmoid(x[0] * (Math.LN10 / 4)); // x[0] is in units of 100 Elo points; plain Elo expectation, nothing fitted
  const metrics = { baseline: evaluate(test, pBase), eloOnly: evaluate(test, pElo), full: evaluate(test, pFull), selected: evaluate(test, pSel) };
  const ranked = (Object.entries({ "plain Elo": metrics.baseline, "Elo refit": metrics.eloOnly, "all features": metrics.full, "selected features": metrics.selected }) as [FitReport["recommended"], Metrics][]).sort((a, b) => a[1].logLoss - b[1].logLoss);
  const recommended = ranked[0][0];
  const pBest = recommended === "plain Elo" ? pBase : recommended === "Elo refit" ? pElo : recommended === "all features" ? pFull : pSel;

  const buckets = [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1.0001];
  const calibration = buckets.slice(0, -1).map((lo, i) => {
    const hi = buckets[i + 1];
    const r = test.filter((t) => { const p = pBest(t.x); return p >= lo && p < hi; });
    return { bucket: `${Math.round(lo * 100)}–${Math.round(Math.min(1, hi) * 100)}%`, n: r.length, predicted: r.length ? r.reduce((s, t) => s + pBest(t.x), 0) / r.length : 0, actual: r.length ? r.reduce((s, t) => s + t.y, 0) / r.length : 0 };
  });
  return {
    generatedAt: new Date().toISOString(),
    rows: { train: train.length, test: test.length, from: rows[0].date, to: rows[rows.length - 1].date, splitDate: test[0].date },
    features: FEATURES.map((f, j) => ({ key: f.key, label: f.label, unit: f.unit, weight: full.weights[j], se: full.se[j], z: full.z[j], effect: full.weights[j] * f.scale, effectSe: full.se[j] * f.scale, selected: keep[j] })),
    intercept: full.intercept, eloRefit: { perPoint: eloOnly.weights[0] / 100, intercept: eloOnly.intercept }, selectedWeights, selectedIntercept: sel.intercept,
    test: metrics, recommended, calibration,
  };
}
