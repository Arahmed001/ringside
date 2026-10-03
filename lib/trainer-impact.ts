/**
 * Trainer impact: how much does a head trainer change the results of the fighters they work with?
 *
 * The simple answer ("their fighters' ratings went up") is badly biased: young fighters rise whoever trains them, and a
 * trainer who inherits an established champion looks like they added nothing. So the question is put to a model instead.
 * Every completed bout is one observation of
 *
 *     P(red wins) = σ( level(red) + effect(red's head trainer) − level(blue) − effect(blue's head trainer) )
 *
 * where `level` is the fighter's own ability (the same for their whole career) and `effect` is what the trainer adds.
 * Both are fitted together, with a penalty that pulls every effect toward zero unless the data insist (a ridge /
 * random-effects fit). A trainer's effect is only separable from their fighters' ability where fighters have worked with
 * more than one trainer, so those are the fights that carry the evidence; trainers whose fighters never moved have
 * little evidence behind them, are said to be thin, and are never ranked.
 *
 * Units: Elo points, relative to the average trainer (0). Checked against the demo league, where each trainer's true
 * boost is built in: the fitted effects correlate with it at about 0.4 (tests/trainer-impact.test.ts keeps that honest).
 *
 * Limits, all of which the pages repeat: fighters do not change trainer at random (they often move after a bad run), the
 * ability of a fighter is treated as fixed through a career, the penalty is a judgment (a typical trainer within about
 * ±55 Elo), and the evidence labels use an approximate standard error that ignores how fighter and trainer effects overlap.
 */
import type { World } from "./world";
import type { BoxerFull, Person } from "./types";
import { countsInRecord } from "./methods";
import { ratingAt } from "./rankings";
import { memo } from "./memo";
import { msg } from "./i18n/t";

export const LOGIT_TO_ELO = 400 / Math.LN10;
/**
 * Ridge penalties on the logit scale. A trainer's effect is pulled toward zero (prior sd about 0.35, i.e. ~60 Elo). A
 * fighter's level is penalised only a little (0.05, prior sd about 4.5, i.e. almost unconstrained) ON PURPOSE: with a
 * firmer penalty the model quietly credits a trainer with the average strength of their fighters, which is only fair if
 * fighters are assigned to trainers at random, and they are not (strong gyms recruit strong fighters). Left nearly free,
 * a fighter's level can absorb that, and a trainer's effect is learned from fighters who changed trainer. On the demo
 * league, where assignment IS random, the firmer penalty tracks the built-in truth better (r 0.53 against 0.40); the
 * weaker one is chosen for the real-world reason, and costs that accuracy here.
 */
export const PENALTY = { fighter: 0.05, trainer: 8 };
/** Fights a trainer needs, of fighters who have also worked with someone else, before their effect is ranked. */
export const MIN_INFORMATIVE_FIGHTS = 8;
const ITERATIONS = 70;
const STEP = 0.8;

export interface Observation { red: number; blue: number; redTrainer: number; blueTrainer: number; y: number }

export interface Fit { fighter: Float64Array; trainer: Float64Array; info: Float64Array }

/**
 * The fit itself, on plain index arrays so it can be tested without a database. `redTrainer`/`blueTrainer` are -1 when
 * unknown. Each pass takes a damped Newton step for every parameter at once (diagonal curvature); 70 passes converge to
 * within a fraction of an Elo point. `info` is the curvature each trainer's effect has from fighters who switched.
 */
export function fitEffects(obs: Observation[], nFighters: number, nTrainers: number, penalty = PENALTY): Fit {
  const fighter = new Float64Array(nFighters), trainer = new Float64Array(nTrainers);
  const gF = new Float64Array(nFighters), hF = new Float64Array(nFighters), gT = new Float64Array(nTrainers), hT = new Float64Array(nTrainers);
  for (let it = 0; it < ITERATIONS; it++) {
    gF.fill(0); hF.fill(0); gT.fill(0); hT.fill(0);
    for (const o of obs) {
      const z = fighter[o.red] + (o.redTrainer >= 0 ? trainer[o.redTrainer] : 0) - fighter[o.blue] - (o.blueTrainer >= 0 ? trainer[o.blueTrainer] : 0);
      const p = 1 / (1 + Math.exp(-z)), g = o.y - p, h = p * (1 - p);
      gF[o.red] += g; hF[o.red] += h; gF[o.blue] -= g; hF[o.blue] += h;
      if (o.redTrainer >= 0) { gT[o.redTrainer] += g; hT[o.redTrainer] += h; }
      if (o.blueTrainer >= 0) { gT[o.blueTrainer] -= g; hT[o.blueTrainer] += h; }
    }
    for (let i = 0; i < nFighters; i++) fighter[i] += STEP * (gF[i] - penalty.fighter * fighter[i]) / (hF[i] + penalty.fighter);
    for (let i = 0; i < nTrainers; i++) trainer[i] += STEP * (gT[i] - penalty.trainer * trainer[i]) / (hT[i] + penalty.trainer);
  }
  // evidence: curvature from fights of fighters who have had two or more trainers (only they can tell a trainer from their fighters)
  const seen = new Map<number, Set<number>>();
  for (const o of obs) for (const [f, t] of [[o.red, o.redTrainer], [o.blue, o.blueTrainer]] as const) if (t >= 0) (seen.get(f) ?? seen.set(f, new Set()).get(f)!).add(t);
  const info = new Float64Array(nTrainers);
  for (const o of obs) {
    const z = fighter[o.red] + (o.redTrainer >= 0 ? trainer[o.redTrainer] : 0) - fighter[o.blue] - (o.blueTrainer >= 0 ? trainer[o.blueTrainer] : 0);
    const p = 1 / (1 + Math.exp(-z)), h = p * (1 - p);
    if (o.redTrainer >= 0 && (seen.get(o.red)?.size ?? 0) > 1) info[o.redTrainer] += h;
    if (o.blueTrainer >= 0 && (seen.get(o.blue)?.size ?? 0) > 1) info[o.blueTrainer] += h;
  }
  return { fighter, trainer, info };
}

export type Evidence = "strong" | "some" | "thin";
/** Whether the 95% range around the effect (±1.96 standard errors) clears zero, or failing that the 80% range (±1.28). Most trainers are "unclear": the data cannot separate them from average. */
export type Verdict = "above" | "below" | "leaning above" | "leaning below" | "unclear";

export const VERDICT_LABEL: Record<Verdict, string> = {
  above: msg("Clearly above average"), "leaning above": msg("Leaning above average"), unclear: msg("Cannot tell from average"),
  "leaning below": msg("Leaning below average"), below: msg("Clearly below average"),
};

export interface Impact {
  person: Person;
  /** Elo points added relative to the average trainer. */
  effect: number;
  /** Approximate standard error in Elo points. */
  se: number;
  evidence: Evidence;
  verdict: Verdict;
  fights: number; // fights of their fighters while they were head trainer
  informative: number; // of those, fights of fighters who also worked with someone else
  fighters: number;
  arrivals: number; // fighters who joined them from another head trainer
  departures: number; // fighters who left them for another
}

export interface ImpactTable {
  all: Impact[]; // every head trainer with a fight
  ranked: Impact[]; // those with enough informative fights, best first
  byPerson: Map<number, Impact>;
  fights: number; // fights that had a known head trainer on at least one side
  switchers: number; // fighters who had two or more head trainers
}

const headAt = (w: World, boxerId: number, date: string): number | null => {
  for (const s of w.stintsByBoxer.get(boxerId) ?? []) if (s.role === "head_trainer" && s.personId && (!s.start || s.start <= date) && (!s.end || s.end > date)) return s.personId;
  return null;
};

export const trainerImpact = (w: World): ImpactTable => memo(w, "trainerImpact", () => {
  const fIdx = new Map<number, number>(), tIdx = new Map<number, number>(), tIds: number[] = [];
  const fi = (id: number) => fIdx.get(id) ?? (fIdx.set(id, fIdx.size), fIdx.size - 1);
  const ti = (id: number | null) => (id === null ? -1 : tIdx.get(id) ?? (tIdx.set(id, tIds.length), tIds.push(id), tIds.length - 1));
  const obs: Observation[] = [];
  const stats = new Map<number, { fights: number; fighters: Set<number> }>();
  for (const b of w.bouts) {
    if (b.upcoming || !countsInRecord(b.method)) continue;
    const rt = headAt(w, b.redId, b.date), bt = headAt(w, b.blueId, b.date);
    if (rt === null && bt === null) continue;
    obs.push({ red: fi(b.redId), blue: fi(b.blueId), redTrainer: ti(rt), blueTrainer: ti(bt), y: b.winnerId === null ? 0.5 : b.winnerId === b.redId ? 1 : 0 });
    for (const [t, f] of [[rt, b.redId], [bt, b.blueId]] as const) if (t !== null) { const s = stats.get(t) ?? stats.set(t, { fights: 0, fighters: new Set() }).get(t)!; s.fights++; s.fighters.add(f); }
  }
  const fit = fitEffects(obs, fIdx.size, tIds.length);
  let switchers = 0;
  const heads = new Map<number, Set<number>>();
  for (const [boxerId, list] of w.stintsByBoxer) for (const s of list) if (s.role === "head_trainer" && s.personId) (heads.get(boxerId) ?? heads.set(boxerId, new Set()).get(boxerId)!).add(s.personId);
  for (const set of heads.values()) if (set.size > 1) switchers++;
  const flows = switchFlows(w);
  const all: Impact[] = tIds.map((personId, i) => {
    const person = w.people.get(personId)!;
    const se = LOGIT_TO_ELO / Math.sqrt(fit.info[i] + PENALTY.trainer);
    const informative = Math.round(fit.info[i] * 4); // p(1-p) is at most 1/4, so this is the count of informative fights for an even match
    const s = stats.get(personId)!;
    const evidence: Evidence = informative >= 40 ? "strong" : informative >= MIN_INFORMATIVE_FIGHTS ? "some" : "thin";
    const f = flows.get(personId) ?? { arrivals: 0, departures: 0 };
    const effect = fit.trainer[i] * LOGIT_TO_ELO;
    const verdict: Verdict = evidence === "thin" ? "unclear"
      : effect - 1.96 * se > 0 ? "above" : effect + 1.96 * se < 0 ? "below"
      : effect - 1.28 * se > 0 ? "leaning above" : effect + 1.28 * se < 0 ? "leaning below" : "unclear";
    return { person, effect, se, evidence, verdict, fights: s.fights, informative, fighters: s.fighters.size, arrivals: f.arrivals, departures: f.departures };
  });
  const ranked = all.filter((x) => x.evidence !== "thin").sort((a, b) => b.effect - a.effect);
  return { all, ranked, byPerson: new Map(all.map((x) => [x.person.id, x])), fights: obs.length, switchers };
});

function switchFlows(w: World): Map<number, { arrivals: number; departures: number }> {
  const out = new Map<number, { arrivals: number; departures: number }>();
  const get = (id: number) => out.get(id) ?? out.set(id, { arrivals: 0, departures: 0 }).get(id)!;
  for (const list of w.stintsByBoxer.values()) {
    const heads = list.filter((s) => s.role === "head_trainer" && s.personId).sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
    for (let i = 1; i < heads.length; i++) if (heads[i].personId !== heads[i - 1].personId) { get(heads[i].personId!).arrivals++; get(heads[i - 1].personId!).departures++; }
  }
  return out;
}

// ---- who moved, and what happened next ----

export interface Move {
  boxer: BoxerFull;
  date: string;
  from: Person | null;
  to: Person | null;
  before: number; // rating when the move happened
  after: number | null; // rating after up to `AFTER` fights with the new trainer
  fightsAfter: number;
  fightsBefore: number;
}
const AFTER = 6;
const MIN_AFTER = 3;
const MIN_BEFORE = 2;

/** Every change of head trainer with enough fights on either side to say what happened. Newest first. */
export const moves = (w: World): Move[] => memo(w, "trainerMoves", () => {
  const out: Move[] = [];
  for (const [boxerId, list] of w.stintsByBoxer) {
    const boxer = w.byId.get(boxerId);
    if (!boxer) continue;
    const heads = list.filter((s) => s.role === "head_trainer" && s.start).sort((a, b) => a.start!.localeCompare(b.start!));
    const fights = (w.boutsByBoxer.get(boxerId) ?? []).filter((b) => !b.upcoming && countsInRecord(b.method));
    for (let i = 1; i < heads.length; i++) {
      const cur = heads[i], prev = heads[i - 1];
      if (cur.personId === prev.personId) continue;
      const during = fights.filter((b) => b.date >= cur.start! && (!cur.end || b.date < cur.end)).slice(0, AFTER);
      const before = fights.filter((b) => b.date < cur.start! && (!prev.start || b.date >= prev.start));
      if (during.length < MIN_AFTER || before.length < MIN_BEFORE) continue;
      out.push({
        boxer, date: cur.start!, from: prev.personId ? w.people.get(prev.personId) ?? null : null, to: cur.personId ? w.people.get(cur.personId) ?? null : null,
        before: ratingAt(w, boxerId, cur.start!) ?? 1500, after: ratingAt(w, boxerId, during[during.length - 1].date), fightsAfter: during.length, fightsBefore: before.length,
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
});

export interface SwitchStudy {
  switched: { n: number; mean: number; sd: number };
  stayed: { n: number; mean: number; sd: number };
  /** switched minus stayed, in Elo points, and its standard error: the part of the change that is not just what happens to every fighter. */
  difference: number;
  se: number;
}

const meanSd = (xs: number[]) => {
  const n = xs.length, mean = n ? xs.reduce((a, b) => a + b, 0) / n : 0;
  return { n, mean, sd: n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0 };
};

/**
 * "Does changing trainer change anything?" Fighters who changed head trainer: their rating after up to six fights with
 * the new one minus the rating on the day they moved. Compared with fighters who did not change: the same measure taken
 * at the midpoint of a stretch of fights with one head trainer. The gap is the change that is not just what happens to
 * everyone (young fighters rise, old ones fall). It is not causal: fighters switch for reasons, often after a bad run.
 */
export const switchStudy = (w: World): SwitchStudy | null => memo(w, "switchStudy", () => {
  const sw = moves(w).filter((m) => m.after !== null).map((m) => m.after! - m.before);
  const control: number[] = [];
  for (const [boxerId, list] of w.stintsByBoxer) {
    const heads = list.filter((s) => s.role === "head_trainer" && s.start);
    if (!heads.length) continue;
    const fights = (w.boutsByBoxer.get(boxerId) ?? []).filter((b) => !b.upcoming && countsInRecord(b.method));
    for (const s of heads) {
      const inside = fights.filter((b) => b.date >= s.start! && (!s.end || b.date < s.end));
      if (inside.length < MIN_BEFORE + AFTER) continue;
      const pivot = Math.min(inside.length - AFTER - 1, Math.max(MIN_BEFORE - 1, Math.floor(inside.length / 2)));
      const a = ratingAt(w, boxerId, inside[pivot].date), z = ratingAt(w, boxerId, inside[pivot + AFTER].date);
      if (a !== null && z !== null) control.push(z - a);
    }
  }
  if (sw.length < 10 || control.length < 10) return null;
  const s = meanSd(sw), c = meanSd(control);
  return { switched: s, stayed: c, difference: s.mean - c.mean, se: Math.sqrt(s.sd ** 2 / s.n + c.sd ** 2 / c.n) };
});

// ---- underdogs ----

export interface Lifter { person: Person; underdogFights: number; wins: number; expected: number; over: number }

const UNDERDOG = 0.4;
const MIN_UNDERDOG_FIGHTS = 12;

/** Every head trainer's fighters as underdogs: wins against the wins the ratings expected (Elo going in; a draw counts half). */
const underdogTable = (w: World): Map<number, Lifter> => memo(w, "underdogTable", () => {
  const by = new Map<number, Lifter>();
  for (const b of w.bouts) {
    if (b.upcoming || !countsInRecord(b.method)) continue;
    const pre = w.boutPre.get(b.id);
    if (!pre) continue;
    for (const [id, own, opp] of [[b.redId, pre.red, pre.blue], [b.blueId, pre.blue, pre.red]] as const) {
      const p = 1 / (1 + 10 ** ((opp - own) / 400));
      if (p >= UNDERDOG) continue;
      const t = headAt(w, id, b.date);
      if (t === null) continue;
      const person = w.people.get(t);
      if (!person) continue;
      const l = by.get(t) ?? by.set(t, { person, underdogFights: 0, wins: 0, expected: 0, over: 0 }).get(t)!;
      l.underdogFights++; l.expected += p;
      l.wins += b.winnerId === id ? 1 : b.winnerId === null ? 0.5 : 0;
    }
  }
  for (const l of by.values()) l.over = l.wins - l.expected;
  return by;
});

/** Head trainers with enough underdog fights to list, biggest over-performance first. */
export const underdogLifters = (w: World): Lifter[] => memo(w, "underdogLifters", () =>
  [...underdogTable(w).values()].filter((l) => l.underdogFights >= MIN_UNDERDOG_FIGHTS).sort((a, b) => b.over - a.over));

export const underdogRecordOf = (w: World, personId: number): Lifter | null => underdogTable(w).get(personId) ?? null;

/** One trainer's moves in and out, newest first (for their page). */
export const movesOf = (w: World, personId: number): { arrived: Move[]; left: Move[] } => {
  const all = moves(w);
  return { arrived: all.filter((m) => m.to?.id === personId), left: all.filter((m) => m.from?.id === personId) };
};

