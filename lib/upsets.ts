/**
 * Upset watch: which upcoming fights have an underdog worth worrying about, why, and how much that is worth.
 *
 * The chance comes from the same win model as the predictor page (Elo plus reach, age, layoff, power and chin), so there
 * is one number for a fight everywhere on the site. On top of it each fight lists the reasons the underdog could win:
 * the model's own factors that favour them, and warning signs about the favourite that the model does not use (a long
 * layoff, age, coming off a knockout loss, a new head trainer, missed weights ...). Those extra signs are then checked
 * against past fights (`signalLift`): when the favourite had that sign, did the underdog win more often than the model
 * said? Where the answer is "no", the page says so.
 */
import type { World } from "./world";
import { koView } from "./career";
import type { BoutRow, BoxerFull, EventRow } from "./types";
import { predict } from "./predict";
import { countsInRecord, isStoppage } from "./methods";
import { missCount } from "./weights";
import { recentTrainerChanges } from "./team";
import { calls, type Call } from "./accountability";
import { isLive } from "./events";
import { msg, type T } from "./i18n/t";
import { memo } from "./memo";

export type Tier = "toss-up" | "live" | "longshot";
/** Chance the underdog wins: at least this for a toss-up, this for a live underdog, below it a longshot. */
export const TIER_AT = { tossUp: 0.4, live: 0.28 };
export const tierOf = (chance: number): Tier => (chance >= TIER_AT.tossUp ? "toss-up" : chance >= TIER_AT.live ? "live" : "longshot");
export const TIER_LABEL: Record<Tier, string> = { "toss-up": msg("Too close to call"), live: msg("Live underdog"), longshot: msg("Longshot") };

export type SignalKind = "model" | "layoff" | "age" | "ko-loss" | "lost-last" | "trainer" | "streak" | "weight" | "chin";
export interface Signal { kind: SignalKind; text: string; weight: number }

export interface Watch {
  bout: BoutRow;
  event: EventRow;
  favourite: BoxerFull;
  underdog: BoxerFull;
  /** The underdog's chance of winning, from the model (a draw is not a win). */
  chance: number;
  favouriteChance: number;
  pRed: number; pBlue: number; pDraw: number;
  tier: Tier;
  signals: Signal[];
}

// thresholds for the warning signs about a favourite; the same ones `signalLift` tests against history
export const SIGNS = { layoffMonths: 15, age: 36, streak: 4, trainerMonths: 9, misses: 1 };

const monthsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (30.4 * 86400000);
const lastFight = (w: World, id: number, before: string): BoutRow | null => {
  const list = w.boutsByBoxer.get(id) ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].date < before && !list[i].upcoming && countsInRecord(list[i].method)) return list[i];
  return null;
};

/** Every upcoming fight with a live bout, the likeliest upset first. The chance is of the underdog winning outright. */
export const upsetWatch = (w: World, t: T): Watch[] => memo(w, `upsetWatch:${t.locale}`, () => {
  const changes = new Map(recentTrainerChanges(w, SIGNS.trainerMonths).map((c) => [c.boxer.id, c]));
  const out: Watch[] = [];
  for (const b of w.bouts) {
    if (!b.upcoming || !isLive(b)) continue;
    const red = w.byId.get(b.redId), blue = w.byId.get(b.blueId), event = w.eventById.get(b.eventId);
    if (!red || !blue || !event) continue;
    const p = predict(red, blue, t);
    const redFav = p.pA >= p.pB;
    const favourite = redFav ? red : blue, underdog = redFav ? blue : red;
    const chance = redFav ? p.pB : p.pA;
    const signals: Signal[] = [];
    // the model's own factors that favour the underdog (positive shift favours red)
    for (const f of p.factors) {
      const forUnderdog = redFav ? -f.shift : f.shift;
      if (forUnderdog >= 0.01) signals.push({ kind: "model", text: `${t(f.label)}: ${f.note}`, weight: forUnderdog });
    }
    const fname = t.name(favourite.name), uname = t.name(underdog.name);
    const last = lastFight(w, favourite.id, b.date);
    if (last) {
      const idle = monthsBetween(last.date, b.date);
      if (idle >= SIGNS.layoffMonths) signals.push({ kind: "layoff", text: t.n(Math.round(idle), "{name} has not fought for {n} month", "{name} has not fought for {n} months", { name: fname }), weight: 0.05 });
      if (last.winnerId !== null && last.winnerId !== favourite.id) {
        signals.push(isStoppage(last.method)
          ? { kind: "ko-loss", text: t("{name} is coming off a stoppage loss", { name: fname }), weight: 0.06 }
          : { kind: "lost-last", text: t("{name} lost last time out", { name: fname }), weight: 0.035 });
      }
    }
    if (favourite.age !== null && favourite.age >= SIGNS.age) signals.push({ kind: "age", text: t.n(favourite.age, "{name} is {n} year old", "{name} is {n} years old", { name: fname }), weight: 0.04 });
    const ch = changes.get(favourite.id);
    if (ch) {
      const since = Math.max(0, Math.round(monthsBetween(ch.date, b.date)));
      signals.push({ kind: "trainer", text: t.n(since, "{name} changed head trainer {n} month ago", "{name} changed head trainer {n} months ago", { name: fname }), weight: 0.03 });
    }
    if (underdog.streak.type === "W" && underdog.streak.count >= SIGNS.streak) signals.push({ kind: "streak", text: t.n(underdog.streak.count, "{name} is on a {n}-fight winning run", "{name} is on a {n}-fight winning run", { name: uname }), weight: 0.03 });
    const misses = missCount(w, favourite.id);
    if (misses >= SIGNS.misses) signals.push({ kind: "weight", text: t.n(misses, "{name} has missed weight {n} time", "{name} has missed weight {n} times", { name: fname }), weight: 0.03 });
    const stopped = favourite.bouts ? favourite.koLosses / favourite.bouts : 0;
    if (stopped >= 0.15 && koView(underdog).rate >= 0.5) signals.push({ kind: "chin", text: t("{a} has been stopped in {pa}% of fights; {b} finishes {pb}% of wins", { a: fname, pa: Math.round(stopped * 100), b: uname, pb: Math.round(koView(underdog).rate * 100) }), weight: 0.05 });
    signals.sort((a, c) => c.weight - a.weight);
    out.push({ bout: b, event, favourite, underdog, chance, favouriteChance: 1 - chance - p.pDraw, pRed: p.pA, pBlue: p.pB, pDraw: p.pDraw, tier: tierOf(chance), signals: signals.slice(0, 4) });
  }
  return out.sort((a, b) => b.chance - a.chance || a.event.date.localeCompare(b.event.date));
});

// ---- how the same call fared in the past ----

export interface TierRecord { tier: Tier; n: number; predicted: number; observed: number }

/**
 * For every scored past fight, how often the underdog won against how often the model said they would, by tier. The
 * model's probabilities here are the pre-fight ones from `accountability.calls` (point-in-time), and "recent" is the last
 * quarter of fights, the stretch the model was not tuned on.
 */
export function tierRecord(cs: Call[]): TierRecord[] {
  const under = (c: Call) => Math.min(c.pRed, 1 - c.pRed);
  const won = (c: Call) => (c.pRed < 0.5) === c.redWon;
  return (["toss-up", "live", "longshot"] as Tier[]).map((tier) => {
    const rows = cs.filter((c) => tierOf(under(c)) === tier);
    const n = rows.length;
    return { tier, n, predicted: n ? rows.reduce((s, c) => s + under(c), 0) / n : 0, observed: n ? rows.filter(won).length / n : 0 };
  });
}

export const upsetRecord = (w: World): { all: TierRecord[]; recent: TierRecord[]; since: string | null } => memo(w, "upsetRecord", () => {
  const cs = calls(w);
  const recent = cs.slice(Math.floor(cs.length * 0.75));
  return { all: tierRecord(cs), recent: tierRecord(recent), since: recent[0]?.date ?? null };
});

export interface Lift { kind: SignalKind; n: number; predicted: number; observed: number }

/**
 * Do the warning signs the model does not use actually matter? For past fights where the favourite had the sign going in,
 * the underdog's win rate against what the model had said. Only signs that can be rebuilt as of fight night are tested
 * (layoff, age, a knockout loss last time, a loss last time, a long winning run for the underdog).
 */
export const signalLift = (w: World): Lift[] => memo(w, "signalLift", () => {
  const prev = new Map<string, BoutRow>(); // `${boxerId}:${boutId}` -> that boxer's previous completed bout
  for (const [id, list] of w.boutsByBoxer) {
    let last: BoutRow | null = null;
    for (const b of list) {
      if (b.upcoming || !countsInRecord(b.method)) continue;
      if (last) prev.set(`${id}:${b.id}`, last);
      last = b;
    }
  }
  const streakBefore = new Map<string, number>(); // `${boxerId}:${boutId}` -> winning run going in
  for (const [id, list] of w.boutsByBoxer) {
    let run = 0;
    for (const b of list) {
      if (b.upcoming || !countsInRecord(b.method)) continue;
      streakBefore.set(`${id}:${b.id}`, run);
      run = b.winnerId === id ? run + 1 : b.winnerId === null ? run : 0;
    }
  }
  const tests: { kind: SignalKind; has: (c: Call, fav: BoxerFull, favLast: BoutRow | null, ud: BoxerFull) => boolean }[] = [
    { kind: "layoff", has: (c, _f, l) => !!l && monthsBetween(l.date, c.date) >= SIGNS.layoffMonths },
    { kind: "age", has: (c, f) => f.birthYear !== null && Number(c.date.slice(0, 4)) - f.birthYear >= SIGNS.age },
    { kind: "ko-loss", has: (_c, f, l) => !!l && l.winnerId !== null && l.winnerId !== f.id && isStoppage(l.method) },
    { kind: "lost-last", has: (_c, f, l) => !!l && l.winnerId !== null && l.winnerId !== f.id && !isStoppage(l.method) },
    { kind: "streak", has: (c, _f, _l, u) => (streakBefore.get(`${u.id}:${c.boutId}`) ?? 0) >= SIGNS.streak },
  ];
  const rows = tests.map((x) => ({ kind: x.kind, n: 0, predicted: 0, won: 0 }));
  for (const c of calls(w)) {
    const redFav = c.pRed >= 0.5;
    const fav = w.byId.get(redFav ? c.redId : c.blueId), ud = w.byId.get(redFav ? c.blueId : c.redId);
    if (!fav || !ud) continue;
    const favLast = prev.get(`${fav.id}:${c.boutId}`) ?? null;
    const underWon = redFav !== c.redWon;
    tests.forEach((x, i) => { if (x.has(c, fav, favLast, ud)) { rows[i].n++; rows[i].predicted += Math.min(c.pRed, 1 - c.pRed); if (underWon) rows[i].won++; } });
  }
  return rows.map((r) => ({ kind: r.kind, n: r.n, predicted: r.n ? r.predicted / r.n : 0, observed: r.n ? r.won / r.n : 0 }));
});

/** The biggest surprises of the last `months` months: fights the model gave the winner the smallest chance in. */
export const recentShocks = (w: World, months = 12, n = 5): Call[] => memo(w, `recentShocks:${months}:${n}`, () => {
  const cutoff = new Date(Date.parse(w.today + "T12:00:00Z") - months * 30.4 * 86400000).toISOString().slice(0, 10);
  return calls(w).filter((c) => c.date >= cutoff).sort((a, b) => a.pWinner - b.pWinner).slice(0, n);
});

/** Upcoming fights where one of these fighters is the underdog or favourite, for the fighter and event pages. */
export const watchFor = (w: World, t: T, boutId: number): Watch | null => upsetWatch(w, t).find((x) => x.bout.id === boutId) ?? null;
