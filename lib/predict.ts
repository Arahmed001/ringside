import type { BoxerFull } from "./types";
import { activeWeights, TERMS, TERM_KEYS, stoppageProbability, winProbability, type Features, type Weights } from "./model";
import { nowMs } from "./clock";

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

const NOTES: Record<keyof typeof TERMS, (a: Features, b: Features) => string> = {
  rating: (a, b) => `${Math.round(a.rating)} vs ${Math.round(b.rating)} Elo`,
  reach: (a, b) => `${a.reachCm}cm vs ${b.reachCm}cm`,
  age: (a, b) => `${a.age} vs ${b.age}`,
  idle: (a, b) => `${Math.round(a.monthsIdle)} vs ${Math.round(b.monthsIdle)} months since last fight`,
  power: (a, b) => `${Math.round(a.koRate * 100)}% vs ${Math.round(b.koRate * 100)}% KO rate`,
  chin: (a, b) => `${Math.round(a.koLossRate * 100)}% vs ${Math.round(b.koLossRate * 100)}% of fights lost by KO`,
};

export function predictFeatures(a: Features, b: Features, weights: Weights = activeWeights()): Prediction {
  const r = winProbability(a, b, weights);
  const factors: Factor[] = TERM_KEYS
    .map((k) => ({ label: TERMS[k].label, shift: r.shifts[k], note: NOTES[k](a, b) }))
    .filter((f, i) => i === 0 || Math.abs(f.shift) > 0.004);
  const gap = Math.abs(r.pA - r.pB);
  return {
    pA: r.pA, pB: r.pB, pDraw: r.pDraw, factors, koProb: stoppageProbability(a, b),
    confidence: gap < 0.12 ? "Toss-up" : gap < 0.3 ? "Lean" : gap < 0.55 ? "Clear favourite" : "Heavy favourite",
  };
}

export const predict = (a: BoxerFull, b: BoxerFull): Prediction => predictFeatures(featuresOf(a), featuresOf(b));
