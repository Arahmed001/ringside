import type { DatabaseSync } from "node:sqlite";
import type { World } from "../world";
import { grade, type GradedPick, type PickInfo } from "../picks-grade";
import { pickInfos } from "../picks";
import { accountsDb } from "./store";
import { resolve } from "./picks";
import type { T } from "../i18n/t";
import { tEn } from "../i18n/t";

/**
 * The pick'em leaderboard.
 *
 * Scoring: a right pick scores 1 plus the model's pre-fight doubt about it (1 - the model's probability for the side you picked),
 * a wrong pick scores 0. Calling the favourite right is worth between 1 and 1.5 points, calling a real underdog right is worth up to 2.
 * It is deliberately not "points for upsets only": with these numbers the pick with the best expected score is always the side
 * you think more likely to win (expected points = p * (2 - p) rises with p), so there is nothing to gain by picking underdogs to
 * look bold. Where the ledger has no pre-fight prediction for a fight, the model is taken as 50/50 (1.5 points for a right pick).
 *
 * Only graded picks count (a result in, not a draw, no-contest or cancellation), only picks locked before fight day, and only
 * people who have not turned their picks private. Someone is ranked after MIN_RANKED graded picks: fewer says more about luck.
 * The model is scored by the same rule on the same fights (every fight a ranked player picked), as the benchmark to beat.
 */
export const MIN_RANKED = 10;

export const pickPoints = (g: GradedPick): number => {
  if (g.state !== "right") return 0;
  const p = g.info.modelPRed === null ? 0.5 : g.pickId === g.info.red.id ? g.info.modelPRed : 1 - g.info.modelPRed;
  return 1 + (1 - p);
};

export interface Standing { rank: number; username: string; points: number; right: number; graded: number; accuracy: number; perPick: number; bestStreak: number; pending: number }
export interface Leaderboard { standings: Standing[]; unranked: number; model: { points: number; right: number; graded: number; accuracy: number; perPick: number; fights: number } | null; minRanked: number }

export function leaderboard(main: DatabaseSync, w: World, t: T = tEn, acc: DatabaseSync = accountsDb()): Leaderboard {
  const users = acc.prepare("SELECT id, username FROM users WHERE picks_public = 1 AND disabled = 0").all() as { id: number; username: string }[];
  const rows = acc.prepare("SELECT user_id, bout_ext, boxer_ext FROM picks").all() as { user_id: number; bout_ext: string; boxer_ext: string }[];
  const byUser = new Map<number, { bout_ext: string; boxer_ext: string }[]>();
  for (const r of rows) (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)!).push(r);
  const resolved = new Map<number, Record<number, number>>();
  const allBouts = new Set<number>();
  for (const u of users) { const m = resolve(byUser.get(u.id) ?? [], main); resolved.set(u.id, m); for (const b of Object.keys(m)) allBouts.add(Number(b)); }
  const infos: PickInfo[] = pickInfos(main, w, [...allBouts], t, Infinity);
  const standings: Omit<Standing, "rank">[] = [];
  const modelSeen = new Map<number, GradedPick>();
  let unranked = 0;
  for (const u of users) {
    const picks = resolved.get(u.id)!;
    if (!Object.keys(picks).length) continue;
    const { rows: graded, summary } = grade(picks, infos);
    const scored = graded.filter((r) => r.state === "right" || r.state === "wrong");
    if (scored.length < MIN_RANKED) { unranked++; continue; }
    const points = scored.reduce((s, r) => s + pickPoints(r), 0);
    standings.push({ username: u.username, points, right: summary.right, graded: summary.graded, accuracy: summary.accuracy, perPick: points / scored.length, bestStreak: summary.streak.best, pending: summary.pending });
    for (const r of scored) if (r.modelPickId !== null && !modelSeen.has(r.info.boutId)) modelSeen.set(r.info.boutId, r);
  }
  standings.sort((a, b) => b.points - a.points || b.accuracy - a.accuracy || a.username.localeCompare(b.username));
  let model: Leaderboard["model"] = null;
  if (modelSeen.size) {
    let points = 0, right = 0;
    for (const r of modelSeen.values()) {
      const pRed = r.info.modelPRed as number, pickRed = pRed >= 0.5;
      const won = r.info.winnerId === (pickRed ? r.info.red.id : r.info.blue.id);
      if (won) { right++; points += 1 + (1 - Math.max(pRed, 1 - pRed)); }
    }
    model = { points, right, graded: modelSeen.size, accuracy: right / modelSeen.size, perPick: points / modelSeen.size, fights: modelSeen.size };
  }
  let rank = 0, last: Omit<Standing, "rank"> | null = null, shown = 0;
  const out = standings.map((s): Standing => { shown++; if (!last || s.points !== last.points || s.accuracy !== last.accuracy) rank = shown; last = s; return { ...s, rank }; });
  return { standings: out.slice(0, 100), unranked, model, minRanked: MIN_RANKED };
}
