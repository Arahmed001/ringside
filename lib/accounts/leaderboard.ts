import type { DatabaseSync } from "node:sqlite";
import type { World } from "../world";
import { grade, type GradedPick, type PickInfo } from "../picks-grade";
import { pickInfos } from "../picks";
import { accountsDb } from "./store";
import { resolve } from "./picks";
import type { T } from "../i18n/t";
import { tEn } from "../i18n/t";
import { dbVersion } from "../db";
import { todayIso } from "../clock";

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
export interface Leaderboard { standings: Standing[]; /** every ranked player's score, best first (the standings above show only the top 100), so anyone's place can be worked out */ field: { points: number; accuracy: number }[]; unranked: number; model: { points: number; right: number; graded: number; accuracy: number; perPick: number; fights: number } | null; minRanked: number }

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
  return { standings: out.slice(0, 100), field: out.map((x) => ({ points: x.points, accuracy: x.accuracy })), unranked, model, minRanked: MIN_RANKED };
}

/**
 * `leaderboard()` grades every public player's picks, which is a second of blocking work at 5,000 players with 100 picks each (measured), so
 * pages use this: the result is kept until something it depends on changes. That is the day, the sports database (results come in), any pick
 * made or changed, and who is public or disabled or new. One entry per language.
 */
const cache = new Map<string, { key: string; value: Leaderboard }>();
export function leaderboardCached(main: DatabaseSync, w: World, t: T = tEn, acc: DatabaseSync = accountsDb()): Leaderboard {
  const sig = acc.prepare(`SELECT (SELECT COUNT(*) FROM picks) p, (SELECT COALESCE(MAX(picked_at), '') FROM picks) m,
    (SELECT COUNT(*) FROM users WHERE picks_public = 1 AND disabled = 0) u, (SELECT COALESCE(MAX(id), 0) FROM users) i`).get() as Record<string, string | number>;
  const key = `${todayIso()}|${dbVersion(main)}|${sig.p}|${sig.m}|${sig.u}|${sig.i}`;
  const id = `${t.locale}`;
  const hit = cache.get(id);
  if (hit?.key === key) return hit.value;
  const value = leaderboard(main, w, t, acc);
  cache.set(id, { key, value });
  return value;
}
export const clearLeaderboardCache = () => cache.clear();


/** The place a score would take on the board: one more than the number of ranked players strictly ahead of it (same points and accuracy share a place, as on the board). */
export const rankIn = (lb: Pick<Leaderboard, "field">, points: number, accuracy: number): number =>
  1 + lb.field.filter((f) => f.points > points || (f.points === points && f.accuracy > accuracy)).length;

export interface MyStanding {
  graded: number; right: number; wrong: number; pending: number; points: number; perPick: number; accuracy: number;
  /** their place among ranked players, or null until they have MIN_RANKED graded picks */
  rank: number | null; ranked: number; minRanked: number; stillNeeded: number;
  /** whether others can see them on the board */
  public: boolean;
  /** the model's score by the same rule on the fights this person picked and the model had a call on */
  model: { fights: number; right: number; points: number } | null;
}

/** One person's own record, for them only: counted whether or not they are on the public board, and with their place if they would be ranked. */
export function myStanding(main: DatabaseSync, w: World, t: T, userId: number, acc: DatabaseSync = accountsDb(), lb: Leaderboard = leaderboardCached(main, w, t, acc)): MyStanding {
  const me = acc.prepare("SELECT picks_public FROM users WHERE id = ?").get(userId) as { picks_public: number } | undefined;
  const picks = resolve(acc.prepare("SELECT bout_ext, boxer_ext FROM picks WHERE user_id = ?").all(userId) as { bout_ext: string; boxer_ext: string }[], main);
  const infos = pickInfos(main, w, Object.keys(picks).map(Number), t, Infinity);
  const { rows, summary } = grade(picks, infos);
  const scored = rows.filter((r) => r.state === "right" || r.state === "wrong");
  const points = scored.reduce((s, r) => s + pickPoints(r), 0);
  const accuracy = summary.accuracy;
  const ranked = scored.length >= MIN_RANKED;
  let mp = 0, mr = 0, mf = 0;
  for (const r of scored) {
    if (r.modelPickId === null) continue;
    mf++;
    const pRed = r.info.modelPRed as number;
    if (r.info.winnerId === r.modelPickId) { mr++; mp += 1 + (1 - Math.max(pRed, 1 - pRed)); }
  }
  return {
    graded: scored.length, right: summary.right, wrong: scored.length - summary.right, pending: summary.pending, points, perPick: scored.length ? points / scored.length : 0, accuracy,
    rank: ranked ? rankIn(lb, points, accuracy) : null, ranked: lb.field.length, minRanked: MIN_RANKED, stillNeeded: Math.max(0, MIN_RANKED - scored.length),
    public: !!me?.picks_public, model: mf ? { fights: mf, right: mr, points: mp } : null,
  };
}

export interface Recap { right: number; wrong: number; items: { boutId: number; fight: string; pick: string; right: boolean; date: string }[]; through: string }

/**
 * What was graded since the person last looked: their decided picks on fights after the last one they were shown ("seen through").
 * Dismissing the recap moves that mark to the latest decided fight, so each fight is reported once, whatever the clock says.
 * Null when nothing new has been graded.
 */
export function picksRecap(main: DatabaseSync, w: World, t: T, userId: number, acc: DatabaseSync = accountsDb()): Recap | null {
  const seen = (acc.prepare("SELECT picks_seen_through s FROM users WHERE id = ?").get(userId) as { s: string | null } | undefined)?.s ?? null;
  const picks = resolve(acc.prepare("SELECT bout_ext, boxer_ext FROM picks WHERE user_id = ?").all(userId) as { bout_ext: string; boxer_ext: string }[], main);
  const { rows } = grade(picks, pickInfos(main, w, Object.keys(picks).map(Number), t, Infinity));
  const decided = rows.filter((r) => r.state === "right" || r.state === "wrong");
  if (!decided.length) return null;
  const through = decided.reduce((m, r) => (r.info.date > m ? r.info.date : m), "");
  const fresh = decided.filter((r) => !seen || r.info.date > seen).sort((a, b) => b.info.date.localeCompare(a.info.date) || b.info.boutId - a.info.boutId);
  if (!fresh.length) return null;
  return {
    right: fresh.filter((r) => r.state === "right").length, wrong: fresh.filter((r) => r.state === "wrong").length, through,
    items: fresh.slice(0, 5).map((r) => ({ boutId: r.info.boutId, fight: `${r.info.red.name} – ${r.info.blue.name}`, pick: r.pickId === r.info.red.id ? r.info.red.name : r.info.blue.name, right: r.state === "right", date: r.info.date })),
  };
}

/** Records that everything graded up to `through` has been shown (it never moves backwards). */
export function markRecapSeen(userId: number, through: string, acc: DatabaseSync = accountsDb()): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) return;
  acc.prepare("UPDATE users SET picks_seen_through = ? WHERE id = ? AND (picks_seen_through IS NULL OR picks_seen_through < ?)").run(through, userId, through);
}
