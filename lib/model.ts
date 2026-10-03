/**
 * Win-probability model: a logistic regression over fighter differences.
 *
 *   z = Σ weight_i · (x_i(A) − x_i(B))        P(A beats B | decisive) = σ(z)
 *
 * Features are signed so "higher is better". It is pure (no Node or DB imports),
 * so the same code runs on the server (default predictions) and in the browser
 * (interactive sliders). Default weights are hand-set to match an Elo expectation
 * plus small physical/form adjustments; once real results exist they can be fit
 * by regression and dropped into DEFAULT_WEIGHTS.
 */
export interface Features {
  rating: number; // Elo
  reachCm: number;
  age: number;
  monthsIdle: number; // months since last fight
  koRate: number; // KOs / wins
  koLossRate: number; // KO losses / bouts
}

export type Weights = Record<keyof typeof TERMS, number>;

export const TERMS = {
  rating: { label: "Rating", unit: "Elo point", min: 0, max: 0.012, step: 0.0002, x: (f: Features) => f.rating },
  reach: { label: "Reach", unit: "cm", min: 0, max: 0.08, step: 0.002, x: (f: Features) => f.reachCm },
  age: { label: "Age (past 34)", unit: "year over 34", min: 0, max: 0.12, step: 0.002, x: (f: Features) => -Math.max(0, f.age - 34) },
  idle: { label: "Ring rust (past 12 mo)", unit: "month idle", min: 0, max: 0.06, step: 0.001, x: (f: Features) => -Math.max(0, f.monthsIdle - 12) },
  power: { label: "Punching power", unit: "KO-rate point", min: 0, max: 1.2, step: 0.02, x: (f: Features) => f.koRate },
  chin: { label: "Chin", unit: "KO-loss-rate point", min: 0, max: 1.2, step: 0.02, x: (f: Features) => -f.koLossRate },
} as const;

export const DEFAULT_WEIGHTS: Weights = {
  rating: Math.LN10 / 400, // exactly the Elo expectation
  reach: 0.016,
  age: 0.03,
  idle: 0.01,
  power: 0.2,
  chin: 0.2,
};

/** Presets are expressed relative to whichever weights are active (hand-set or fitted). */
export function presetsFor(base: Weights): { name: string; blurb: string; weights: Weights }[] {
  return [
    { name: "Balanced", blurb: "Elo plus small physical and form edges", weights: base },
    { name: "Pure Elo", blurb: "Results only: ignore everything else", weights: { ...base, reach: 0, age: 0, idle: 0, power: 0, chin: 0 } },
    { name: "Old school", blurb: "Reach, power and chin decide fights", weights: { ...base, rating: base.rating * 0.6, reach: 0.04, power: 0.6, chin: 0.6 } },
    { name: "Father Time", blurb: "Age and layoffs hurt more", weights: { ...base, age: 0.09, idle: 0.04 } },
  ];
}
export const PRESETS = presetsFor(DEFAULT_WEIGHTS);

// The server swaps in weights fitted from real results (see lib/model-fit.ts). A globalThis slot keeps
// route bundles in sync; the browser always receives its weights as props instead.
const slot = globalThis as unknown as { __ringsideWeights?: Weights };
export const activeWeights = (): Weights => slot.__ringsideWeights ?? DEFAULT_WEIGHTS;
export const setActiveWeights = (w: Weights | undefined) => { slot.__ringsideWeights = w; };

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
export const DRAW_PROB = 0.03;

export type TermKey = keyof typeof TERMS;
export const TERM_KEYS = Object.keys(TERMS) as TermKey[];

/** Per-term logit contribution for A vs B. Reach is capped at ±12 cm so freak arms can't swamp the rest. */
export function contributions(a: Features, b: Features, w: Weights): Record<TermKey, number> {
  const out = {} as Record<TermKey, number>;
  for (const k of TERM_KEYS) {
    let d = TERMS[k].x(a) - TERMS[k].x(b);
    if (k === "reach") d = clamp(d, -12, 12);
    out[k] = w[k] * d;
  }
  return out;
}

export function winProbability(a: Features, b: Features, w: Weights = DEFAULT_WEIGHTS) {
  const c = contributions(a, b, w);
  const z = TERM_KEYS.reduce((s, k) => s + c[k], 0);
  const decisive = clamp(sigmoid(z), 0.04, 0.96);
  const pA = decisive * (1 - DRAW_PROB);
  const pB = (1 - decisive) * (1 - DRAW_PROB);
  // Probability-point effect of each term = P(all terms) − P(all terms except this one).
  const shifts = {} as Record<TermKey, number>;
  for (const k of TERM_KEYS) shifts[k] = sigmoid(z) - sigmoid(z - c[k]);
  return { pA, pB, pDraw: DRAW_PROB, z, shifts };
}

/** Rough chance the fight ends inside the distance, from both fighters' finishing and fragility. */
export function stoppageProbability(a: Features, b: Features) {
  return clamp(0.22 + (a.koRate + b.koRate) * 0.35 + (a.koLossRate + b.koLossRate) * 0.2, 0.1, 0.85);
}
