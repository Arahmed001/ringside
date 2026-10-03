/**
 * The live ledger: predictions written down BEFORE a fight and graded AFTER it.
 *
 * A backtest (lib/accountability.ts) can be flattered by hindsight however carefully it is built, because the model's
 * settings were chosen with the results in view. A ledger cannot: each row is written while the bout is still in the
 * future and is never edited. Every day the server runs it appends one snapshot per upcoming bout (so a long build-up
 * is recorded as it drifts with ratings and layoffs), and a bout is graded on its LAST snapshot taken strictly before the
 * event date, the model's final word. Each row keeps the inputs and a fingerprint of the weights, so any call can be
 * audited or reproduced. A bout that was never snapshotted while upcoming (it first appeared already decided) is not in the
 * record: we cannot claim a prediction we did not make.
 */
import type { DatabaseSync } from "node:sqlite";
import type { World } from "./world";
import { featuresOf, predictFeatures } from "./predict";
import { activeFinish, activeWeights } from "./model";
import { hash } from "./hash";
import { countsInRecord, isStoppage } from "./methods";
import { summarize, type Call, type Summary } from "./accountability";
import { todayIso } from "./clock";

/** A short fingerprint of the weights in force, so a row says which model made it. */
export const modelVersion = (): string => {
  const f = activeFinish();
  return `w${hash(JSON.stringify(activeWeights()) + (f ? JSON.stringify(f) : "")).toString(36)}`; // unchanged while no finish model is fitted
};

export interface SnapshotReport { inserted: number; upcoming: number }

/**
 * Appends today's snapshot for every upcoming, not-cancelled bout that does not have one yet. Cheap (one insert per bout
 * per day), safe to call often, and it never touches an existing row.
 */
export function snapshotUpcoming(db: DatabaseSync, w: World): SnapshotReport {
  const today = todayIso();
  const version = modelVersion();
  const upcoming = w.bouts.filter((b) => b.upcoming && b.status !== "cancelled");
  const have = new Set((db.prepare("SELECT bout_id FROM prediction_snapshots WHERE locked_on = ?").all(today) as { bout_id: number }[]).map((r) => r.bout_id));
  const ins = db.prepare(`INSERT OR IGNORE INTO prediction_snapshots (bout_id, locked_on, locked_at, model, p_red, p_draw, ko_prob, elo_p_red, inputs) VALUES (?,?,?,?,?,?,?,?,?)`);
  let inserted = 0;
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    for (const b of upcoming) {
      if (have.has(b.id)) continue;
      const red = w.byId.get(b.redId), blue = w.byId.get(b.blueId);
      if (!red || !blue) continue;
      const fa = featuresOf(red), fb = featuresOf(blue);
      const p = predictFeatures(fa, fb);
      const eloP = 1 / (1 + Math.pow(10, (blue.rating - red.rating) / 400));
      ins.run(b.id, today, now, version, p.pA / (p.pA + p.pB), p.pDraw, p.koProb, eloP, JSON.stringify({ red: fa, blue: fb, weights: activeWeights(), ...(activeFinish() ? { finish: activeFinish() } : {}) }));
      inserted++;
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return { inserted, upcoming: upcoming.length };
}

/** `snapshotUpcoming`, but a failure (a locked database, a missing table on an old file) is never allowed to break a page. */
export function snapshotUpcomingSafe(db: DatabaseSync, w: World): void {
  try { snapshotUpcoming(db, w); } catch { /* the next rebuild tries again */ }
}

interface Row { bout_id: number; locked_on: string; p_red: number; ko_prob: number; elo_p_red: number; model: string }

export interface LiveCall extends Call { lockedOn: string; eventDate: string; model: string }
export interface Pending { boutId: number; eventDate: string; lockedOn: string; pRed: number; snapshots: number }
export interface LiveRecord {
  /** distinct bouts that have ever been snapshotted */
  locked: number;
  firstLockedOn: string | null;
  graded: Summary; // over `calls`
  calls: LiveCall[];
  /** upcoming bouts with a prediction on file, soonest first */
  pending: Pending[];
  /** snapshotted bouts that ended without a winner (draw, no-contest) or were cancelled: nothing to grade */
  voided: number;
  /** models that made the graded calls, most recent first */
  models: string[];
}

export function liveRecord(db: DatabaseSync, w: World): LiveRecord {
  const rows = db.prepare("SELECT bout_id, locked_on, p_red, ko_prob, elo_p_red, model FROM prediction_snapshots ORDER BY bout_id, locked_on").all() as unknown as Row[];
  const byBout = new Map<number, Row[]>();
  for (const r of rows) (byBout.get(r.bout_id) ?? byBout.set(r.bout_id, []).get(r.bout_id)!).push(r);
  const calls: LiveCall[] = [], pending: Pending[] = [];
  let voided = 0;
  for (const [boutId, snaps] of byBout) {
    const b = w.boutById.get(boutId);
    if (!b) continue;
    if (b.upcoming && b.status !== "cancelled") { pending.push({ boutId, eventDate: b.date, lockedOn: snaps[snaps.length - 1].locked_on, pRed: snaps[snaps.length - 1].p_red, snapshots: snaps.length }); continue; }
    if (b.status === "cancelled" || !b.method || !countsInRecord(b.method) || !b.winnerId) { voided++; continue; }
    // the model's final word: the last snapshot taken strictly before the event date
    const last = [...snaps].reverse().find((s) => s.locked_on < b.date);
    if (!last) continue; // first seen on or after the event date: no prediction was made in time
    const red = w.byId.get(b.redId)!;
    const redWon = b.winnerId === b.redId, pWinner = redWon ? last.p_red : 1 - last.p_red;
    calls.push({
      boutId, date: b.date, eventDate: b.date, lockedOn: last.locked_on, model: last.model, division: b.weightClass, sex: red.sex, redId: b.redId, blueId: b.blueId,
      pRed: last.p_red, eloPRed: last.elo_p_red, koProb: last.ko_prob, redWon, finished: isStoppage(b.method), pickedRed: last.p_red >= 0.5,
      correct: (last.p_red >= 0.5) === redWon, pWinner, surprise: -Math.log2(Math.max(pWinner, 1e-6)), eloPick: (last.elo_p_red >= 0.5) === redWon,
    });
  }
  calls.sort((a, b) => a.date.localeCompare(b.date) || a.boutId - b.boutId);
  pending.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.boutId - b.boutId);
  const models = [...new Set([...calls].reverse().map((c) => c.model))];
  return { locked: byBout.size, firstLockedOn: rows.length ? rows.reduce((m, r) => (r.locked_on < m ? r.locked_on : m), rows[0].locked_on) : null, graded: summarize(calls), calls, pending, voided, models };
}

/** The prediction on file for one upcoming bout, or null. */
export function lockedFor(db: DatabaseSync, boutId: number): { lockedOn: string; pRed: number; snapshots: number } | null {
  const r = db.prepare("SELECT locked_on, p_red, (SELECT COUNT(*) FROM prediction_snapshots WHERE bout_id = ?) AS n FROM prediction_snapshots WHERE bout_id = ? ORDER BY locked_on DESC LIMIT 1").get(boutId, boutId) as { locked_on: string; p_red: number; n: number } | undefined;
  return r ? { lockedOn: r.locked_on, pRed: r.p_red, snapshots: r.n } : null;
}
