/**
 * The post-fight recap: what one decided fight changed, built entirely from the data (so it is complete with no key,
 * identical in both languages and reproducible). Facts first (`buildRecap`, language-free and testable), sentences second
 * (`recapLines`, through the translator). Draws, no-contests and fights not yet fought have no recap.
 *
 * Ranks use the same rules as the published rankings (5+ bouts, a winning record, a fight in the last 24 months, ordered by
 * Elo) evaluated as of the night before and the night of the card. They ignore the "active" flag, which is only known today,
 * so a historic rank can differ slightly from what the site showed at the time.
 */
import type { World } from "./world";
import type { BoutRow } from "./types";
import { countsInRecord, hasWinner, isStoppage } from "./methods";
import { callOf } from "./accountability";
import { belts, beltBySlug, beltLabel } from "./lineage";
import { divisionLabel } from "./divisions";
import { tEn, type T } from "./i18n/t";

export type Tier = "major-upset" | "upset" | "close" | "expected" | "heavy-favourite";
export interface RankMove { boxerId: number; before: number | null; after: number | null }
export type TitleChange =
  | { kind: "crowned"; beltSlug: string; how: "won" | "vacant" | "inherited" | "first"; days: number | null; defenses: number | null }
  | { kind: "defended"; beltSlug: string; number: number }
  | { kind: "unchanged" };
export interface Rec { w: number; l: number; d: number; kos: number }

export interface Recap {
  boutId: number; winnerId: number; loserId: number; division: string; sex: "male" | "female";
  surprise: { pWinner: number; tier: Tier } | null;
  ratings: { id: number; before: number; after: number }[]; // winner first
  ranks: RankMove[];
  title: TitleChange | null;
  records: { id: number; rec: Rec }[]; // after the fight, winner first
  winStreak: number; // the winner's, including this fight
  loserLossStreak: number; // including this fight
  loserUnbeatenEnded: number | null; // fights the loser had gone without a defeat (5+), now over
  loserFirstStoppage: number | null; // fights fought before the first time the loser was stopped (3+)
}

export const tierOf = (pWinner: number): Tier => (pWinner < 0.25 ? "major-upset" : pWinner < 0.4 ? "upset" : pWinner >= 0.75 ? "heavy-favourite" : pWinner >= 0.6 ? "expected" : "close");

const monthsBefore = (date: string, m: number) => new Date(Date.parse(date + "T12:00:00Z") - m * 30.4 * 86400000).toISOString().slice(0, 10);
const TOP = 15;

function recordUpTo(list: BoutRow[], id: number, upto: (b: BoutRow) => boolean): Rec & { last: string | null; n: number } {
  let wins = 0, l = 0, d = 0, kos = 0, last: string | null = null, n = 0;
  for (const b of list) {
    if (!upto(b) || b.upcoming || !countsInRecord(b.method)) continue;
    n++; last = b.date;
    if (b.winnerId === id) { wins++; if (isStoppage(b.method)) kos++; } else if (b.winnerId === null) d++; else l++;
  }
  return { w: wins, l, d, kos, last, n };
}

/** Ranks of everyone eligible in a division as of a date (`before`: strictly earlier cards; otherwise up to and including that day). */
function ranksAsOf(w: World, division: string, sex: "male" | "female", date: string, before: boolean): Map<number, number> {
  const cutoff = monthsBefore(date, 24);
  const scored: { id: number; rating: number }[] = [];
  for (const b of w.boxers) {
    if (b.sex !== sex || b.weightClass !== division) continue;
    const list = w.boutsByBoxer.get(b.id) ?? [];
    const rec = recordUpTo(list, b.id, before ? (x) => x.date < date : (x) => x.date <= date);
    const total = rec.w + rec.l + rec.d;
    if (rec.n < 5 || rec.w / total < 0.5 || (rec.last ?? "") < cutoff) continue;
    const h = w.history.get(b.id);
    if (!h) continue;
    let r: number | null = null;
    for (const x of h) { if (before ? x.date < date : x.date <= date) r = x.rating; else break; }
    if (r !== null) scored.push({ id: b.id, rating: r });
  }
  scored.sort((a, b) => b.rating - a.rating || a.id - b.id);
  return new Map(scored.map((s, i) => [s.id, i + 1]));
}

/** The recap for one fight, or null when it was not decided (upcoming, cancelled, draw, no-contest). */
export function buildRecap(w: World, boutId: number): Recap | null {
  const b = w.boutById.get(boutId);
  if (!b || b.upcoming || b.status === "cancelled" || !hasWinner(b.method) || !b.winnerId) return null;
  const winner = w.byId.get(b.winnerId), loser = w.byId.get(b.winnerId === b.redId ? b.blueId : b.redId);
  if (!winner || !loser) return null;
  const pre = w.boutPre.get(b.id);
  const after = (id: number) => (w.history.get(id) ?? []).find((h) => h.boutId === b.id)?.rating ?? null;
  const ratings = [winner, loser].map((f) => {
    const was = pre ? (f.id === b.redId ? pre.red : pre.blue) : null, now = after(f.id);
    return was !== null && now !== null ? { id: f.id, before: was, after: now } : null;
  }).filter((x): x is { id: number; before: number; after: number } => x !== null);

  const call = callOf(w, b.id);
  const surprise = call ? { pWinner: call.pWinner, tier: tierOf(call.pWinner) } : null;

  const sex = winner.sex;
  const prior = ranksAsOf(w, b.weightClass, sex, b.date, true), now = ranksAsOf(w, b.weightClass, sex, b.date, false);
  const ranks: RankMove[] = [winner, loser].map((f) => ({ boxerId: f.id, before: prior.get(f.id) ?? null, after: now.get(f.id) ?? null }))
    .filter((m) => m.before !== m.after && ((m.before ?? 99) <= TOP || (m.after ?? 99) <= TOP));

  let title: TitleChange | null = null;
  if (b.title) {
    title = { kind: "unchanged" }; // a draw, or a belt whose lineage the data cannot place
    for (const belt of belts(w)) {
      for (const r of belt.reigns) {
        if (r.boutId === b.id) {
          const ended = belt.reigns.find((x) => x.endedByBoutId === b.id);
          title = { kind: "crowned", beltSlug: belt.slug, how: r.how, days: ended ? ended.days : null, defenses: ended ? ended.defenses.length : null };
        } else if (r.defenses.some((d) => d.boutId === b.id)) title = { kind: "defended", beltSlug: belt.slug, number: r.defenses.findIndex((d) => d.boutId === b.id) + 1 };
      }
    }
  }

  const list = (id: number) => w.boutsByBoxer.get(id) ?? [];
  const upToThis = (x: BoutRow) => x.date < b.date || (x.date === b.date && x.id <= b.id);
  const wr = recordUpTo(list(winner.id), winner.id, upToThis), lr = recordUpTo(list(loser.id), loser.id, upToThis);
  const through = (id: number) => list(id).filter((x) => upToThis(x) && !x.upcoming && countsInRecord(x.method));
  let winStreak = 0;
  for (const x of through(winner.id).reverse()) { if (x.winnerId === winner.id) winStreak++; else break; }
  let lossStreak = 0;
  for (const x of through(loser.id).reverse()) { if (x.winnerId !== null && x.winnerId !== loser.id) lossStreak++; else break; }
  const loserBefore = through(loser.id).slice(0, -1);
  const unbeaten = loserBefore.length >= 5 && loserBefore.every((x) => x.winnerId === null || x.winnerId === loser.id) ? loserBefore.length : null;
  const stoppedBefore = loserBefore.some((x) => x.winnerId !== null && x.winnerId !== loser.id && isStoppage(x.method));
  const firstStoppage = isStoppage(b.method) && !stoppedBefore && loserBefore.length >= 3 && unbeaten === null ? loserBefore.length : null;

  return {
    boutId: b.id, winnerId: winner.id, loserId: loser.id, division: b.weightClass, sex, surprise, ratings, ranks, title,
    records: [{ id: winner.id, rec: wr }, { id: loser.id, rec: lr }].map(({ id, rec }) => ({ id, rec: { w: rec.w, l: rec.l, d: rec.d, kos: rec.kos } })),
    winStreak, loserLossStreak: lossStreak, loserUnbeatenEnded: unbeaten, loserFirstStoppage: firstStoppage,
  };
}

/** The recap as sentences in the reader's language, most important first. Names are used instead of pronouns (Arabic and English differ). */
export function recapLines(r: Recap, w: World, t: T = tEn): string[] {
  const n = (id: number) => t.name(w.byId.get(id)?.name ?? "");
  const winner = n(r.winnerId), loser = n(r.loserId);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const div = divisionLabel(r.division, r.sex, t);
  let surpriseLine: string | null = null, titleLine: string | null = null;
  if (r.surprise) {
    const p = pct(r.surprise.pWinner);
    surpriseLine = (r.surprise.tier === "major-upset" ? t("A major upset: the model gave {name} only {p}.", { name: winner, p })
      : r.surprise.tier === "upset" ? t("An upset: the model gave {name} {p}.", { name: winner, p })
      : r.surprise.tier === "close" ? t("A close call on paper: the model had {name} at {p}.", { name: winner, p })
      : r.surprise.tier === "expected" ? t("A win the model saw coming: {p} for {name}.", { name: winner, p })
      : t("As expected: the model had {name} at {p}.", { name: winner, p }));
  }
  if (r.title) {
    const beltName = (slug: string) => { const belt = beltBySlug(w, slug); return belt ? beltLabel(belt, t) : ""; };
    if (r.title.kind === "crowned") {
      const belt = beltName(r.title.beltSlug);
      titleLine = (r.title.how === "vacant" ? t("{name} won the vacant {belt}.", { name: winner, belt })
        : r.title.how === "first" ? t("{name} became the first champion on record of the {belt}.", { name: winner, belt })
        : r.title.how === "inherited" ? t("{name} took the {belt}: the champion was not in the ring.", { name: winner, belt })
        : r.title.days !== null && r.title.defenses !== null ? t.n(r.title.defenses, "{name} took the {belt}, ending {loser}'s reign of {days} days and {n} defence.", "{name} took the {belt}, ending {loser}'s reign of {days} days and {n} defences.", { name: winner, belt, loser, days: r.title.days })
        : t("{name} beat the champion and took the {belt}.", { name: winner, belt }));
    } else if (r.title.kind === "defended") titleLine = (t("{name} made defence number {n} of the {belt}.", { name: winner, n: r.title.number, belt: beltName(r.title.beltSlug) }));
    else titleLine = t("A title fight, but the belt did not change hands.");
  }
  // a belt changing hands is the story of the night; otherwise how surprising the result was leads
  const out: string[] = (r.title?.kind === "crowned" ? [titleLine, surpriseLine] : [surpriseLine, titleLine]).filter((x): x is string => x !== null);
  const rec = new Map(r.ratings.map((x) => [x.id, x]));
  const rw = rec.get(r.winnerId), rl = rec.get(r.loserId);
  if (rw && rl) out.push(t("{winner} gained {a} rating points, to {ra}; {loser} lost {b}, to {rb}.", { winner, a: Math.round(rw.after - rw.before), ra: Math.round(rw.after), loser, b: Math.round(rl.before - rl.after), rb: Math.round(rl.after) }));
  for (const m of r.ranks) {
    const name = n(m.boxerId);
    out.push(m.before === null && m.after !== null ? t("{name} moved into the {division} top 15 at #{n}.", { name, division: div, n: m.after })
      : m.after === null ? t("{name} dropped out of the {division} ranking.", { name, division: div })
      : m.after < (m.before ?? 99) ? t("{name} climbed from #{a} to #{b} at {division}.", { name, a: m.before ?? 0, b: m.after, division: div })
      : t("{name} fell from #{a} to #{b} at {division}.", { name, a: m.before ?? 0, b: m.after, division: div }));
  }
  if (r.winStreak >= 3) out.push(t("{name} has now won {n} in a row.", { name: winner, n: r.winStreak }));
  if (r.loserUnbeatenEnded) out.push(t("{name}'s unbeaten run of {n} fights is over.", { name: loser, n: r.loserUnbeatenEnded }));
  else if (r.loserLossStreak >= 2) out.push(t("{name} has now lost {n} in a row.", { name: loser, n: r.loserLossStreak }));
  if (r.loserFirstStoppage) out.push(t("The first time {name} has been stopped in {n} fights.", { name: loser, n: r.loserFirstStoppage + 1 }));
  const fmt = (x: Rec) => `${x.w}-${x.l}-${x.d}`;
  const rw2 = r.records[0].rec, rl2 = r.records[1].rec;
  out.push(t("Records now: {winner} {a}, {loser} {b}.", { winner, a: fmt(rw2), loser, b: fmt(rl2) }));
  return out;
}
