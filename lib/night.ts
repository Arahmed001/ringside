/**
 * Night in review: what a whole card did, summarised from the recap of every decided fight on it (lib/recap.ts), so the
 * numbers cannot disagree with the bout pages. Built from facts, language-free; `nightLines` turns it into sentences.
 * Cancelled, upcoming and undecided fights are left out; a card with no decided fight has no review.
 */
import type { World } from "./world";
import { buildRecap, type Recap, type RankMove } from "./recap";
import { callOf } from "./accountability";
import { beltBySlug, beltLabel } from "./lineage";
import { isStoppage } from "./methods";
import { divisionLabel } from "./divisions";
import { tEn, type T } from "./i18n/t";

export interface Night {
  eventId: number; date: string;
  decided: number; // fights with a winner
  endedEarly: number; // by stoppage
  upset: { boutId: number; winnerId: number; loserId: number; pWinner: number } | null; // the model gave the winner under 40%
  crowned: { boutId: number; winnerId: number; beltSlug: string }[];
  defended: { boutId: number; winnerId: number; beltSlug: string }[];
  model: { n: number; right: number } | null; // fights the model had a call on
  fastest: { boutId: number; winnerId: number; loserId: number; round: number; time: string | null } | null;
  climb: (RankMove & { division: string; sex: "male" | "female" }) | null; // the biggest rise within a top 15
  streak: { boxerId: number; n: number } | null; // the longest win streak run up on the night (3+)
  unbeatenEnded: { boxerId: number; n: number }[];
}

const secs = (t: string | null) => { const m = t?.match(/^(\d+):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

export function buildNight(w: World, eventId: number): Night | null {
  const e = w.eventById.get(eventId);
  if (!e || e.upcoming || e.status === "cancelled") return null;
  const bouts = (w.boutsByEvent.get(eventId) ?? []).filter((b) => !b.upcoming && b.status !== "cancelled");
  const recaps = bouts.map((b) => ({ b, r: buildRecap(w, b.id) })).filter((x): x is { b: (typeof bouts)[number]; r: Recap } => x.r !== null);
  if (!recaps.length) return null;

  let upset: Night["upset"] = null;
  for (const { b, r } of recaps) {
    if (r.surprise && r.surprise.pWinner < 0.4 && (!upset || r.surprise.pWinner < upset.pWinner)) upset = { boutId: b.id, winnerId: r.winnerId, loserId: r.loserId, pWinner: r.surprise.pWinner };
  }
  const crowned: Night["crowned"] = [], defended: Night["defended"] = [];
  for (const { b, r } of recaps) {
    if (r.title?.kind === "crowned") crowned.push({ boutId: b.id, winnerId: r.winnerId, beltSlug: r.title.beltSlug });
    else if (r.title?.kind === "defended") defended.push({ boutId: b.id, winnerId: r.winnerId, beltSlug: r.title.beltSlug });
  }
  const called = recaps.map(({ b }) => callOf(w, b.id)).filter((c): c is NonNullable<typeof c> => c !== null);
  const model = called.length ? { n: called.length, right: called.filter((c) => c.correct).length } : null;

  const finishes = recaps.filter(({ b }) => isStoppage(b.method) && b.endRound);
  const fastest = finishes.length
    ? finishes.map(({ b, r }) => ({ boutId: b.id, winnerId: r.winnerId, loserId: r.loserId, round: b.endRound!, time: b.roundTime }))
      .sort((a, c) => a.round - c.round || secs(a.time) - secs(c.time) || a.boutId - c.boutId)[0]
    : null;

  let climb: Night["climb"] = null, best = 0;
  for (const { r } of recaps) {
    for (const m of r.ranks) {
      if (m.after === null || m.after > 15) continue;
      const rise = m.before === null ? 16 - m.after : m.before - m.after; // entering the list counts as a rise from just outside it
      if (rise > best) { best = rise; climb = { ...m, division: r.division, sex: r.sex }; }
    }
  }

  const streaks = recaps.filter(({ r }) => r.winStreak >= 3).sort((a, c) => c.r.winStreak - a.r.winStreak || a.b.id - c.b.id);
  const unbeatenEnded = recaps.filter(({ r }) => r.loserUnbeatenEnded).map(({ r }) => ({ boxerId: r.loserId, n: r.loserUnbeatenEnded! }));

  return {
    eventId, date: e.date, decided: recaps.length, endedEarly: recaps.filter(({ b }) => isStoppage(b.method)).length, upset, crowned, defended, model, fastest, climb,
    streak: streaks.length ? { boxerId: streaks[0].r.winnerId, n: streaks[0].r.winStreak } : null, unbeatenEnded,
  };
}

/** The night in sentences, most newsworthy first: belts, the surprise, how the card went, the model, then movers. */
export function nightLines(n: Night, w: World, t: T = tEn): string[] {
  const name = (id: number) => t.name(w.byId.get(id)?.name ?? "");
  const belt = (slug: string) => { const b = beltBySlug(w, slug); return b ? beltLabel(b, t) : ""; };
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const out: string[] = [];
  for (const c of n.crowned.slice(0, 3)) out.push(t("New champion: {name}, {belt}.", { name: name(c.winnerId), belt: belt(c.beltSlug) }));
  for (const d of n.defended.slice(0, 3)) out.push(t("Title defended: {name}, {belt}.", { name: name(d.winnerId), belt: belt(d.beltSlug) }));
  if (n.upset) out.push(t("The night’s biggest surprise: {winner} beat {loser}, a {p} chance in the model’s eyes.", { winner: name(n.upset.winnerId), loser: name(n.upset.loserId), p: pct(n.upset.pWinner) }));
  out.push(t.n(n.decided, "{n} fight decided, {s} ended inside the distance.", "{n} fights decided, {s} ended inside the distance.", { s: n.endedEarly }));
  if (n.fastest) out.push(n.fastest.time ? t("Fastest finish: {winner} stopped {loser} in round {r}, at {time}.", { winner: name(n.fastest.winnerId), loser: name(n.fastest.loserId), r: n.fastest.round, time: n.fastest.time })
    : t("Fastest finish: {winner} stopped {loser} in round {r}.", { winner: name(n.fastest.winnerId), loser: name(n.fastest.loserId), r: n.fastest.round }));
  if (n.model) out.push(t("The model picked {r} of {n} winners ({p}).", { r: n.model.right, n: n.model.n, p: pct(n.model.right / n.model.n) }));
  if (n.climb) {
    const div = divisionLabel(n.climb.division, n.climb.sex, t);
    out.push(n.climb.before === null ? t("Biggest mover: {name} entered the {division} top 15 at #{n}.", { name: name(n.climb.boxerId), division: div, n: n.climb.after ?? 0 })
      : t("Biggest climb: {name}, from #{a} to #{b} at {division}.", { name: name(n.climb.boxerId), a: n.climb.before, b: n.climb.after ?? 0, division: div }));
  }
  if (n.streak) out.push(t("Longest streak run up: {name}, {n} wins in a row.", { name: name(n.streak.boxerId), n: n.streak.n }));
  for (const u of n.unbeatenEnded.slice(0, 2)) out.push(t("{name}’s unbeaten run of {n} fights ended.", { name: name(u.boxerId), n: u.n }));
  return out;
}

