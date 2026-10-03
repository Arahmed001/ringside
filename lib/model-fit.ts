import fs from "node:fs";
import path from "node:path";
import type { FitReport } from "./fit";
import { DEFAULT_WEIGHTS, setActiveWeights } from "./model";

const FILE = path.join(process.cwd(), "data", "model-fit.json");
let cache: { mtime: number; report: FitReport | null } | null = null;

/** The latest `npm run model:fit` report, or null when none exists or it can't be read. */
export function loadFit(): FitReport | null {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (cache?.mtime === mtime) return cache.report;
    const report = JSON.parse(fs.readFileSync(FILE, "utf8")) as FitReport;
    cache = { mtime, report };
    return report;
  } catch {
    cache = { mtime: 0, report: null };
    return null;
  }
}

/**
 * Applies the one fitted parameter with overwhelming evidence, the Elo scale, to the server's default predictions.
 * Hand-set reach/age/layoff/power/chin terms stay as they are; the fit report shows how each compares so you can decide.
 * Plain Elo wins only when nothing fitted beats it on held-out bouts, in which case defaults are left alone.
 */
export function applyFittedWeights(): { applied: boolean; ratingWeight: number } {
  const fit = loadFit();
  if (!fit || fit.recommended === "plain Elo" || !(fit.eloRefit?.perPoint > 0)) { setActiveWeights(undefined); return { applied: false, ratingWeight: DEFAULT_WEIGHTS.rating }; }
  setActiveWeights({ ...DEFAULT_WEIGHTS, rating: fit.eloRefit.perPoint });
  return { applied: true, ratingWeight: fit.eloRefit.perPoint };
}
