import type { World } from "./world";
import type { BoxerFull, BoutRow } from "./types";
import { DIVISIONS, divisionLabel } from "./divisions";
import { archetype } from "./style";
import { predict } from "./predict";
import { rankDivision } from "./rankings";
import { belts, beltsHeld } from "./lineage";
import { countryName } from "./format";
import { tEn, type T } from "./i18n/t";
import { memo } from "./memo";

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const divIndex = new Map(DIVISIONS.map((d, i) => [d.name, i]));
const monthsBetween = (a: string, b: string) => (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / (30.4 * 86400000);

export interface Parts { competitive: number; relevance: number; style: number; availability: number; novelty: number; stakes: number }
export interface Pairing {
  a: BoxerFull; b: BoxerFull;
  score: number; // 0-100
  parts: Parts; // each 0-1
  pA: number; pB: number; pDraw: number; koProb: number;
  reasons: string[]; // already in the reader's language
  /** The same reasons labelled by what they are about, so a page can pick the kinds it wants. */
  tagged: { kind: "competitive" | "stakes" | "relevance" | "style" | "length" | "novelty" | "availability" | "promoter"; text: string }[];
  meetings: BoutRow[];
}

/** Weights of the parts of a pairing's score: a fight worth making is close, relevant, entertaining, bookable, fresh and meaningful. */
export const WEIGHTS: Parts = { competitive: 0.28, relevance: 0.18, style: 0.14, availability: 0.14, novelty: 0.12, stakes: 0.14 };

/** How well two styles make a fight: finishers against finishers and counter-punchers against pressure sell; two journeymen do not. */
function styleClash(a: BoxerFull, b: BoxerFull): number {
  const pair = [archetype(a), archetype(b)].sort().join("|");
  const base: Record<string, number> = {
    "Iron-Chin Brawler|Knockout Artist": 1, "Knockout Artist|Knockout Artist": 0.9, "Iron-Chin Brawler|Iron-Chin Brawler": 0.85,
    "Counter-Puncher|Knockout Artist": 0.85, "Counter-Puncher|Volume Boxer": 0.78, "Counter-Puncher|Iron-Chin Brawler": 0.8,
    "Technician|Volume Boxer": 0.7, "Counter-Puncher|Technician": 0.55, "Technician|Technician": 0.45, "Volume Boxer|Volume Boxer": 0.6,
    "Knockout Artist|Technician": 0.75, "Knockout Artist|Volume Boxer": 0.8, "Iron-Chin Brawler|Technician": 0.7, "Iron-Chin Brawler|Volume Boxer": 0.75,
  };
  const clash = base[pair] ?? (pair.includes("Journeyman") ? 0.2 : pair.includes("Prospect") ? 0.35 : 0.5);
  const finish = (a.koRate + b.koRate) / 2;
  const star = clamp(((a.rating + b.rating) / 2 - 1450) / 300);
  return clamp(0.4 * clash + 0.35 * finish + 0.25 * star);
}

/** Time since a fighter's last fight as a booking signal: rested but not rusty. */
function freshness(w: World, b: BoxerFull): { v: number; months: number | null } {
  if (!b.active) return { v: 0, months: null };
  if (!b.lastFight) return { v: 0.5, months: null };
  const m = monthsBetween(b.lastFight, w.today);
  const v = m < 1.5 ? 0.15 : m < 2 ? 0.45 : m <= 9 ? 1 : m <= 18 ? 0.7 : m <= 30 ? 0.4 : 0.15;
  return { v, months: m };
}

const meetingsOf = (w: World, a: BoxerFull, b: BoxerFull): BoutRow[] => (w.boutsByBoxer.get(a.id) ?? []).filter((x) => !x.upcoming && x.method && x.method !== "NC" && (x.redId === b.id || x.blueId === b.id));

function currentOrg(w: World, id: number, role: "gym" | "promoter"): number | null {
  return (w.stintsByBoxer.get(id) ?? []).find((s) => s.role === role && s.end === null)?.orgId ?? null;
}

const topRank = (w: World, b: BoxerFull): number | null => {
  const r = memo(w, `rankIndex:${b.sex}:${b.weightClass}`, () => new Map(rankDivision(w, b.weightClass, 200, b.sex).map((x) => [x.boxer.id, x.rank]))).get(b.id);
  return r ?? null;
};

/** How much a fight would mean: a unification (champions of different bodies) or a champion against a top-5 contender. */
function stakes(w: World, a: BoxerFull, b: BoxerFull): { v: number; kind: "unification" | "defence" | null } {
  const ba = beltsHeld(w, a.id).filter((x) => !x.stale), bb = beltsHeld(w, b.id).filter((x) => !x.stale);
  if (ba.some((x) => bb.some((y) => y.division === x.division && y.sex === x.sex && y.orgId !== x.orgId && y.title === x.title))) return { v: 1, kind: "unification" };
  if (ba.length || bb.length) {
    const challenger = ba.length ? b : a;
    const r = topRank(w, challenger);
    if (r !== null && r <= 5) return { v: 0.75, kind: "defence" };
    return { v: 0.3, kind: "defence" };
  }
  return { v: 0, kind: null };
}

/** Scores a possible fight between two fighters. Symmetric: pairing(a, b) and pairing(b, a) agree. */
export function pairing(w: World, a: BoxerFull, b: BoxerFull, t: T = tEn, opts: { subjectIsA?: boolean } = {}): Pairing {
  const p = predict(a, b, t);
  const meetings = meetingsOf(w, a, b);
  const competitive = clamp(1 - Math.abs(p.pA - p.pB));
  const gap = Math.abs(a.rating - b.rating);
  const ra = topRank(w, a), rb = topRank(w, b);
  const relevance = clamp(1 - gap / 320 + (ra !== null && ra <= 10 && rb !== null && rb <= 10 ? 0.2 : 0));
  const style = styleClash(a, b);
  const fa = freshness(w, a), fb = freshness(w, b);
  // when planning an opponent for `a`, only the opponent's readiness decides whether the fight can be booked (a's own layoff is shown, not scored against every candidate)
  const availability = opts.subjectIsA ? fb.v : Math.min(fa.v, fb.v);
  const novelty = meetings.length === 0 ? 1 : meetings.length === 1 ? (meetings[0].method && ["SD", "MD", "DRAW", "TD", "TDRAW"].includes(meetings[0].method) ? 0.7 : 0.35) : 0.15;
  const st = stakes(w, a, b);
  const parts: Parts = { competitive, relevance, style, availability, novelty, stakes: st.v };
  const score = Math.round(100 * (Object.keys(WEIGHTS) as (keyof Parts)[]).reduce((s, k) => s + WEIGHTS[k] * parts[k], 0));

  const reasons: string[] = [];
  const tagged: Pairing["tagged"] = [];
  const say = (kind: Pairing["tagged"][number]["kind"], text: string) => { reasons.push(text); tagged.push({ kind, text }); };
  const fav = p.pA >= p.pB ? a : b;
  if (competitive >= 0.85) say("competitive", t("The model sees a near coin-flip: {name} {pct}%", { name: t.name(fav.name), pct: Math.round(Math.max(p.pA, p.pB) * 100) }));
  else if (competitive >= 0.6) say("competitive", t("A competitive fight on paper: {name} {pct}%", { name: t.name(fav.name), pct: Math.round(Math.max(p.pA, p.pB) * 100) }));
  if (st.kind === "unification") say("stakes", t("A unification: champions of different bodies in the same division"));
  else if (st.kind === "defence") say("stakes", t("A title fight: a champion against a top-5 contender"));
  if (ra !== null && ra <= 10 && rb !== null && rb <= 10) say("relevance", t("Both are top-10 in the division (#{a} and #{b})", { a: ra, b: rb }));
  if (style >= 0.7) say("style", t("Style clash: {a} against {b}", { a: t(archetype(a)), b: t(archetype(b)) }));
  if (p.koProb > 0.6) say("length", t("Likely to end early: {pct}% chance of a stoppage", { pct: Math.round(p.koProb * 100) }));
  if (meetings.length === 0) say("novelty", t("They have never met"));
  else {
    const m = meetings[meetings.length - 1];
    const winner = m.winnerId ? (m.winnerId === a.id ? a : b) : null;
    say("novelty", winner ? t("A rematch: {name} won their last fight", { name: t.name(winner.name) }) : t("A rematch of a draw"));
  }
  const fresh = [fa, fb].filter((f) => f.months !== null);
  if (availability >= 0.99 && fresh.length === 2) say("availability", t("Both are rested and active: last fought {a} and {b} months ago", { a: Math.round(fa.months!), b: Math.round(fb.months!) }));
  else for (const [f, x] of (opts.subjectIsA ? [[fb, b]] : [[fa, a], [fb, b]]) as [typeof fa, BoxerFull][]) if (f.v <= 0.45 && f.months !== null) say("availability", f.months < 2 ? t("{name} fought {n} weeks ago, a quick turnaround", { name: t.name(x.name), n: Math.max(1, Math.round(f.months * 4.3)) }) : t("{name} has been out for {n} months", { name: t.name(x.name), n: Math.round(f.months) }));
  const pa = currentOrg(w, a.id, "promoter"), pb = currentOrg(w, b.id, "promoter");
  if (pa !== null && pa === pb) say("promoter", t("Same promoter: {name}", { name: t.name(w.orgs.get(pa)?.name ?? "") }));
  return { a, b, score, parts, pA: p.pA, pB: p.pB, pDraw: p.pDraw, koProb: p.koProb, reasons, tagged, meetings };
}

const booked = (w: World, id: number) => (w.boutsByBoxer.get(id) ?? []).some((x) => x.upcoming && x.status !== "cancelled");

/**
 * Who `boxer` should fight next. Candidates are active fighters of the same sex in the same division or one either side
 * (a natural move up or down), who are not already booked, are not training partners (same gym), and have a few bouts behind them.
 */
export function suggestOpponents(w: World, boxer: BoxerFull, n = 6, t: T = tEn): Pairing[] {
  const di = divIndex.get(boxer.weightClass) ?? 0;
  const gym = currentOrg(w, boxer.id, "gym");
  const out: Pairing[] = [];
  for (const c of w.boxers) {
    if (c.id === boxer.id || c.sex !== boxer.sex || !c.active || c.bouts < 4 || booked(w, c.id)) continue;
    if (Math.abs((divIndex.get(c.weightClass) ?? -9) - di) > 1) continue;
    if (gym !== null && currentOrg(w, c.id, "gym") === gym) continue;
    if (Math.abs(c.rating - boxer.rating) > 260) continue; // a fight nobody would sign
    out.push(pairing(w, boxer, c, t, { subjectIsA: true }));
  }
  return out.sort((x, y) => y.score - x.score || y.b.rating - x.b.rating).slice(0, n);
}

export interface FightToMake extends Pairing { division: string }

/**
 * The best fight to make in each division right now, from the top eight available fighters there, best first overall.
 * "Available" means active, not already booked and not a training partner of the other.
 */
export const fightsToMake = (w: World, n = 8, t: T = tEn): FightToMake[] => memo(w, `fightsToMake:${n}:${t.locale}`, () => {
  const best: FightToMake[] = [];
  for (const sex of ["male", "female"] as const) for (const d of DIVISIONS) {
    const pool = rankDivision(w, d.name, 30, sex).map((r) => r.boxer).filter((b) => b.bouts >= 8 && !booked(w, b.id)).slice(0, 8);
    let top: FightToMake | null = null;
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      const ga = currentOrg(w, pool[i].id, "gym");
      if (ga !== null && ga === currentOrg(w, pool[j].id, "gym")) continue;
      const p = pairing(w, pool[i], pool[j], t);
      if (!top || p.score > top.score) top = { ...p, division: d.name };
    }
    if (top) best.push(top);
  }
  return best.sort((x, y) => y.score - x.score).slice(0, n);
});

export interface Dream {
  p: Pairing;
  flags: string[];
  catchweight: string | null; // a suggested limit when the two fight in different divisions
  common: { opponent: BoxerFull; a: BoutRow; b: BoutRow }[];
}

/** An imagined fight between any two fighters: the model's view, why it may never happen, a catchweight, and what their records say. */
export function dreamFight(w: World, a: BoxerFull, b: BoxerFull, t: T = tEn): Dream {
  const p = pairing(w, a, b, t);
  const flags: string[] = [];
  const ia = divIndex.get(a.weightClass) ?? 0, ib = divIndex.get(b.weightClass) ?? 0;
  let catchweight: string | null = null;
  if (a.sex !== b.sex) flags.push(t("Different sexes: boxing does not make this fight"));
  if (ia !== ib) {
    const la = DIVISIONS[ia].lb, lb = DIVISIONS[ib].lb;
    flags.push(t("Different divisions: {a} and {b}", { a: divisionLabel(a.weightClass, a.sex, t), b: divisionLabel(b.weightClass, b.sex, t) }));
    if (la !== null && lb !== null) catchweight = t("{lb} lb catchweight", { lb: Math.round((la + lb) / 2) });
    else catchweight = t("At the heavier division’s limit");
  }
  for (const x of [a, b]) if (!x.active) flags.push(t("{name} is retired or inactive", { name: t.name(x.name) }));
  const first = (x: BoxerFull) => (w.boutsByBoxer.get(x.id) ?? [])[0]?.date ?? null;
  const [fa, fb] = [first(a), first(b)];
  if (fa && fb && a.lastFight && b.lastFight && (a.lastFight < fb || b.lastFight < fa)) flags.push(t("Their careers did not overlap"));
  if (p.meetings.length) flags.push(t.n(p.meetings.length, "They have already fought {n} time", "They have already fought {n} times"));
  if (booked(w, a.id) || booked(w, b.id)) flags.push(t("At least one of them is already booked"));
  if (a.reachCm !== null && b.reachCm !== null && Math.abs(a.reachCm - b.reachCm) >= 10) flags.push(t("A big reach gap: {a} cm against {b} cm", { a: a.reachCm, b: b.reachCm }));
  if (a.country === b.country) flags.push(t("An all-{country} fight", { country: countryName(a.country, t.locale) }));

  const opp = (x: BoxerFull) => new Map((w.boutsByBoxer.get(x.id) ?? []).filter((y) => !y.upcoming && y.method && y.method !== "NC").map((y) => [y.redId === x.id ? y.blueId : y.redId, y]));
  const oa = opp(a), ob = opp(b);
  const common: Dream["common"] = [];
  for (const [id, ba] of oa) { const bb = ob.get(id); const o = w.byId.get(id); if (bb && o && id !== a.id && id !== b.id) common.push({ opponent: o, a: ba, b: bb }); }
  common.sort((x, y) => y.opponent.rating - x.opponent.rating);
  return { p, flags, catchweight, common: common.slice(0, 8) };
}

/** All belts in a division, for linking a pairing to the titles involved. */
export const beltsOfDivision = (w: World, division: string, sex: "male" | "female") => belts(w).filter((b) => b.division === division && b.sex === sex);
