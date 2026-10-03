import { nowMs } from "./clock";
import { getWorld } from "./world";
import { featuredYear, fightsOfYear } from "./fight-score";
import { signalLift, upsetRecord } from "./upsets";
import { trainerImpact } from "./trainer-impact";

const DAY = 86_400_000;
/** Milliseconds from `now` to just after the next UTC midnight (the app's day is the UTC date; see clock.ts). */
export const msUntilNextDay = (now: number, slackMs = 5_000): number => DAY - (now % DAY) + slackMs;

/**
 * Builds the in-memory world (and seeds an empty database) so the first visitor doesn't pay for it: about 0.1 s at the
 * demo size, 3.7 s at 160,000 bouts, plus the fight-of-the-year scores the home page shows. Callers that arrive while it is building share the same build (lib/world.ts).
 */
export async function warmWorld(log: (m: string) => void = console.log): Promise<void> {
  const t0 = performance.now();
  try {
    const w = await getWorld();
    log(`[ringside] world ready in ${Math.round(performance.now() - t0)} ms: ${w.boxers.length} fighters, ${w.bouts.length} bouts`);
    // the home page shows the fight of the year, which needs the punch totals and one year scored (about 0.5 s at 160,000 bouts)
    const y = featuredYear(w);
    if (y) fightsOfYear(w, y);
    // the upset-watch track record and the trainer-impact fit are the two other first-visitor costs (about 0.9 s and 0.6 s at 160,000 bouts)
    upsetRecord(w); signalLift(w); trainerImpact(w);
  } catch (e) {
    // never keep the server from starting: the first request will try again and show the real error
    log(`[ringside] warm-up failed (${e instanceof Error ? e.message : String(e)}); the first request will retry`);
  }
}

/**
 * The world is valid for one calendar day, so it goes stale at midnight UTC and the next visitor would pay for the rebuild.
 * Rebuild just after midnight instead, when traffic is lowest. Not scheduled when the clock is pinned (tests, reproducible runs).
 */
export function scheduleDailyWarm(log: (m: string) => void = console.log): void {
  if (process.env.RINGSIDE_NOW) return;
  const tick = () => {
    void warmWorld(log).finally(() => { const t = setTimeout(tick, msUntilNextDay(nowMs())); t.unref(); });
  };
  const t = setTimeout(tick, msUntilNextDay(nowMs()));
  t.unref(); // a pending timer must never keep the process alive
}
