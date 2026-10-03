import type { World } from "./world";
import type { BoutRow, Person } from "./types";
import { isRefereeStoppage } from "./methods";

export interface JudgeStats {
  person: Person;
  cards: number;
  agreeWithMajority: number; // 0-1
  dissents: number;
  avgMargin: number; // points, absolute
  homePickRate: number | null; // when exactly one fighter was a home national and the judge picked a side
  homeSamples: number;
}
export interface RefereeStats { person: Person; bouts: number; stoppages: number; stopRate: number; avgStopRound: number | null; earlyStopRate: number }

const side = (red: number, blue: number): "red" | "blue" | "even" => (red > blue ? "red" : blue > red ? "blue" : "even");

function homeSide(w: World, b: BoutRow): "red" | "blue" | null {
  const ev = w.events.find((e) => e.id === b.eventId);
  if (!ev) return null;
  const r = w.byId.get(b.redId)?.country === ev.country, u = w.byId.get(b.blueId)?.country === ev.country;
  return r && !u ? "red" : u && !r ? "blue" : null;
}

export function judgeStats(w: World): { judges: JudgeStats[]; leagueHomePickRate: number } {
  const boutById = new Map(w.bouts.map((b) => [b.id, b]));
  const acc = new Map<number, { cards: number; agree: number; dissent: number; margin: number; homePick: number; homeN: number }>();
  let lgPick = 0, lgN = 0;
  for (const [boutId, cards] of w.scorecardsByBout) {
    const b = boutById.get(boutId);
    if (!b || cards.length < 3) continue;
    const sides = cards.map((c) => side(c.red, c.blue));
    const tally = { red: 0, blue: 0, even: 0 };
    for (const s of sides) tally[s]++;
    const majority = tally.red >= 2 ? "red" : tally.blue >= 2 ? "blue" : tally.even >= 2 ? "even" : null;
    const home = homeSide(w, b);
    cards.forEach((c, i) => {
      const a = acc.get(c.judgeId) ?? { cards: 0, agree: 0, dissent: 0, margin: 0, homePick: 0, homeN: 0 };
      a.cards++; a.margin += Math.abs(c.red - c.blue);
      if (majority && sides[i] === majority) a.agree++; else if (majority) a.dissent++;
      if (home && sides[i] !== "even") { a.homeN++; lgN++; if (sides[i] === home) { a.homePick++; lgPick++; } }
      acc.set(c.judgeId, a);
    });
  }
  const judges: JudgeStats[] = [];
  for (const [id, a] of acc) {
    const person = w.people.get(id);
    if (!person) continue;
    judges.push({ person, cards: a.cards, agreeWithMajority: a.agree / a.cards, dissents: a.dissent, avgMargin: a.margin / a.cards, homePickRate: a.homeN ? a.homePick / a.homeN : null, homeSamples: a.homeN });
  }
  return { judges: judges.sort((a, b) => b.cards - a.cards), leagueHomePickRate: lgN ? lgPick / lgN : 0.5 };
}

export function refereeStats(w: World): { referees: RefereeStats[]; leagueAvgStopRound: number } {
  const boutById = new Map(w.bouts.map((b) => [b.id, b]));
  const acc = new Map<number, { bouts: number; stops: number; roundSum: number; early: number }>();
  let rs = 0, rn = 0;
  for (const [boutId, offs] of w.officialsByBout) {
    const b = boutById.get(boutId);
    if (!b || b.upcoming || !b.method) continue;
    const ref = offs.find((o) => o.role === "referee");
    if (!ref) continue;
    const a = acc.get(ref.personId) ?? { bouts: 0, stops: 0, roundSum: 0, early: 0 };
    a.bouts++;
    if (isRefereeStoppage(b.method) && b.endRound) { a.stops++; a.roundSum += b.endRound; if (b.endRound <= 3) a.early++; rs += b.endRound; rn++; }
    acc.set(ref.personId, a);
  }
  const referees: RefereeStats[] = [];
  for (const [id, a] of acc) {
    const person = w.people.get(id);
    if (person) referees.push({ person, bouts: a.bouts, stoppages: a.stops, stopRate: a.stops / a.bouts, avgStopRound: a.stops ? a.roundSum / a.stops : null, earlyStopRate: a.stops ? a.early / a.stops : 0 });
  }
  return { referees: referees.sort((a, b) => b.bouts - a.bouts), leagueAvgStopRound: rn ? rs / rn : 0 };
}

export interface Dispute { bout: BoutRow; spread: number; cards: { judge: string; red: number; blue: number }[] }

/** Decisions where judges disagreed most: the biggest gap between how far one judge favoured red and another favoured blue. */
export function scoringDisputes(w: World, n = 8): Dispute[] {
  const out: Dispute[] = [];
  for (const b of w.bouts) {
    if (b.upcoming) continue;
    const cards = w.scorecardsByBout.get(b.id);
    if (!cards || cards.length < 3) continue;
    const m = cards.map((c) => c.red - c.blue);
    const spread = Math.max(...m) - Math.min(...m);
    if (Math.max(...m) > 0 && Math.min(...m) < 0) out.push({ bout: b, spread, cards: cards.map((c) => ({ judge: w.people.get(c.judgeId)?.name ?? "?", red: c.red, blue: c.blue })) });
  }
  return out.sort((a, b) => b.spread - a.spread || b.bout.date.localeCompare(a.bout.date)).slice(0, n);
}
