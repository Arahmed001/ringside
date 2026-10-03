import type { BoxerFull } from "./types";
import { activeWeights, TERMS, TERM_KEYS, stoppageProbability, winProbability, type Features, type Weights } from "./model";
import { nowMs } from "./clock";
import { tEn, type T } from "./i18n/t";

export interface Factor { label: string; shift: number; note: string }
export interface Prediction {
  pA: number; pB: number; pDraw: number;
  koProb: number; // probability fight ends inside the distance
  factors: Factor[];
  confidence: "Toss-up" | "Lean" | "Clear favourite" | "Heavy favourite";
}

export function featuresOf(b: BoxerFull, now = nowMs()): Features {
  const idle = b.lastFight ? Math.max(0, (now - Date.parse(b.lastFight)) / (30.4 * 86400000)) : 24;
  return {
    rating: b.rating, reachCm: b.reachCm, age: b.age, monthsIdle: idle,
    koRate: b.koRate, koLossRate: b.bouts ? b.koLosses / b.bouts : 0,
  };
}

const NOTES: Record<keyof typeof TERMS, (a: Features, b: Features, t: T) => string> = {
  rating: (a, b, t) => t("{a} vs {b} Elo", { a: Math.round(a.rating), b: Math.round(b.rating) }),
  reach: (a, b, t) => t("{a}cm vs {b}cm", { a: a.reachCm, b: b.reachCm }),
  age: (a, b, t) => t("{a} vs {b}", { a: a.age, b: b.age }),
  idle: (a, b, t) => t("{a} vs {b} months since last fight", { a: Math.round(a.monthsIdle), b: Math.round(b.monthsIdle) }),
  power: (a, b, t) => t("{a}% vs {b}% KO rate", { a: Math.round(a.koRate * 100), b: Math.round(b.koRate * 100) }),
  chin: (a, b, t) => t("{a}% vs {b}% of fights lost by KO", { a: Math.round(a.koLossRate * 100), b: Math.round(b.koLossRate * 100) }),
};

/** `t` localises the factor notes; `label` and `confidence` stay English keys for the caller to translate with t(). */
export function predictFeatures(a: Features, b: Features, weights: Weights = activeWeights(), t: T = tEn): Prediction {
  const r = winProbability(a, b, weights);
  const factors: Factor[] = TERM_KEYS
    .map((k) => ({ label: TERMS[k].label, shift: r.shifts[k], note: NOTES[k](a, b, t) }))
    .filter((f, i) => i === 0 || Math.abs(f.shift) > 0.004);
  const gap = Math.abs(r.pA - r.pB);
  return {
    pA: r.pA, pB: r.pB, pDraw: r.pDraw, factors, koProb: stoppageProbability(a, b),
    confidence: gap < 0.12 ? "Toss-up" : gap < 0.3 ? "Lean" : gap < 0.55 ? "Clear favourite" : "Heavy favourite",
  };
}

export const predict = (a: BoxerFull, b: BoxerFull, t: T = tEn): Prediction => predictFeatures(featuresOf(a), featuresOf(b), activeWeights(), t);
