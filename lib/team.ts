import type { World } from "./world";
import type { BoutRow, BoxerFull, Org, Person, TeamRole, TeamStint } from "./types";
import { ratingAt } from "./rankings";

export const ROLE_LABEL: Record<TeamRole, string> = {
  head_trainer: "Head trainer", assistant_trainer: "Assistant trainer", strength_coach: "Strength & conditioning",
  cutman: "Cutman", manager: "Manager", promoter: "Promoter", gym: "Gym",
};

export interface Record3 { wins: number; losses: number; draws: number; kos: number; bouts: number; winRate: number; koRate: number }

const emptyRecord = (): Record3 => ({ wins: 0, losses: 0, draws: 0, kos: 0, bouts: 0, winRate: 0, koRate: 0 });
const isKO = (m: string | null) => m === "KO" || m === "TKO";

/** A fighter's completed bouts that fall inside [start, end). Null bounds are open. */
export function boutsInWindow(w: World, boxerId: number, start: string | null, end: string | null): BoutRow[] {
  return (w.boutsByBoxer.get(boxerId) ?? []).filter((b) => !b.upcoming && b.method && b.method !== "NC" && (!start || b.date >= start) && (!end || b.date < end));
}

export function recordOf(boxerId: number, bouts: BoutRow[]): Record3 {
  const r = emptyRecord();
  for (const b of bouts) {
    r.bouts++;
    if (b.winnerId === null) r.draws++;
    else if (b.winnerId === boxerId) { r.wins++; if (isKO(b.method)) r.kos++; }
    else r.losses++;
  }
  r.winRate = r.bouts ? r.wins / r.bouts : 0;
  r.koRate = r.wins ? r.kos / r.wins : 0;
  return r;
}

const addRecord = (a: Record3, b: Record3): Record3 => {
  const r = { wins: a.wins + b.wins, losses: a.losses + b.losses, draws: a.draws + b.draws, kos: a.kos + b.kos, bouts: a.bouts + b.bouts, winRate: 0, koRate: 0 };
  r.winRate = r.bouts ? r.wins / r.bouts : 0; r.koRate = r.wins ? r.kos / r.wins : 0;
  return r;
};

export interface StintView {
  stint: TeamStint;
  person: Person | null;
  org: Org | null;
  current: boolean;
  record: Record3;
  ratingChange: number | null; // Elo change across the stint (null when no fights)
}

/** Everything a fighter's corner looked like over time, grouped by role. */
export function boxerTeam(w: World, boxerId: number): Map<TeamRole, StintView[]> {
  const out = new Map<TeamRole, StintView[]>();
  for (const st of w.stintsByBoxer.get(boxerId) ?? []) {
    const bouts = boutsInWindow(w, boxerId, st.start, st.end);
    const endDate = st.end ?? w.today;
    const ratingChange = bouts.length ? (ratingAt(w, boxerId, endDate) ?? 1500) - (ratingAt(w, boxerId, st.start ?? "0000-00-00") ?? 1500) : null;
    const view: StintView = { stint: st, person: st.personId ? w.people.get(st.personId) ?? null : null, org: st.orgId ? w.orgs.get(st.orgId) ?? null : null,
      current: st.end === null, record: recordOf(boxerId, bouts), ratingChange };
    const list = out.get(st.role) ?? [];
    list.push(view);
    out.set(st.role, list);
  }
  for (const list of out.values()) list.sort((a, b) => (a.stint.start ?? "").localeCompare(b.stint.start ?? ""));
  return out;
}

export const currentOf = (team: Map<TeamRole, StintView[]>, role: TeamRole) => (team.get(role) ?? []).find((v) => v.current) ?? null;

export interface FighterTenure { boxer: BoxerFull; stint: TeamStint; record: Record3; ratingChange: number | null; current: boolean }

/** Aggregate view of a trainer, manager or organisation: who they worked with and how those fighters fared meanwhile. */
export interface Stable {
  tenures: FighterTenure[];
  record: Record3;
  fighters: number;
  currentFighters: number;
  avgRatingChange: number | null; // mean Elo change per tenure that had fights
  titleWins: number;
  best: FighterTenure | null;
}

function buildStable(w: World, stints: TeamStint[], roleFilter?: TeamRole[]): Stable {
  const tenures: FighterTenure[] = [];
  for (const st of stints) {
    if (roleFilter && !roleFilter.includes(st.role)) continue;
    const boxer = w.byId.get(st.boxerId);
    if (!boxer) continue;
    const bouts = boutsInWindow(w, st.boxerId, st.start, st.end);
    const rc = bouts.length ? (ratingAt(w, st.boxerId, st.end ?? w.today) ?? 1500) - (ratingAt(w, st.boxerId, st.start ?? "0000-00-00") ?? 1500) : null;
    tenures.push({ boxer, stint: st, record: recordOf(st.boxerId, bouts), ratingChange: rc, current: st.end === null });
  }
  tenures.sort((a, b) => (b.stint.start ?? "").localeCompare(a.stint.start ?? ""));
  let record = emptyRecord();
  for (const t of tenures) record = addRecord(record, t.record);
  const rcs = tenures.map((t) => t.ratingChange).filter((x): x is number => x !== null);
  let titleWins = 0;
  for (const t of tenures) for (const b of boutsInWindow(w, t.boxer.id, t.stint.start, t.stint.end)) if (b.title && !b.titleVacant && b.winnerId === t.boxer.id) titleWins++;
  const best = [...tenures].sort((a, b) => b.boxer.rating - a.boxer.rating)[0] ?? null;
  return {
    tenures, record, fighters: new Set(tenures.map((t) => t.boxer.id)).size, currentFighters: tenures.filter((t) => t.current).length,
    avgRatingChange: rcs.length ? rcs.reduce((a, b) => a + b, 0) / rcs.length : null, titleWins, best,
  };
}

export const personStable = (w: World, personId: number, roles?: TeamRole[]) => buildStable(w, w.stintsByPerson.get(personId) ?? [], roles);
export const orgStable = (w: World, orgId: number, roles?: TeamRole[]) => buildStable(w, w.stintsByOrg.get(orgId) ?? [], roles);

export interface TrainerRow { person: Person; stable: Stable }

/** Head trainers ranked by how much their fighters' ratings rose while working together. */
export function trainerLeaderboard(w: World, minTenureFights = 4): TrainerRow[] {
  const rows: TrainerRow[] = [];
  for (const p of w.people.values()) {
    if (!w.roles.get(p.id)?.has("trainer")) continue;
    const stable = personStable(w, p.id, ["head_trainer"]);
    if (stable.record.bouts >= minTenureFights) rows.push({ person: p, stable });
  }
  return rows.sort((a, b) => (b.stable.avgRatingChange ?? -999) - (a.stable.avgRatingChange ?? -999));
}

/** Fighters whose head trainer changed in the last `months`, a cue worth watching before a fight. */
export function recentTrainerChanges(w: World, months = 9): { boxer: BoxerFull; from: Person | null; to: Person | null; date: string }[] {
  const cutoff = new Date(Date.now() - months * 30.4 * 86400000).toISOString().slice(0, 10);
  const out: { boxer: BoxerFull; from: Person | null; to: Person | null; date: string }[] = [];
  for (const [boxerId, list] of w.stintsByBoxer) {
    const heads = list.filter((s) => s.role === "head_trainer").sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
    for (let i = 1; i < heads.length; i++) {
      const to = heads[i];
      if (to.start && to.start >= cutoff && to.start <= w.today) {
        const boxer = w.byId.get(boxerId);
        if (boxer?.active) out.push({ boxer, from: heads[i - 1].personId ? w.people.get(heads[i - 1].personId!) ?? null : null, to: to.personId ? w.people.get(to.personId) ?? null : null, date: to.start });
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Months with the current head trainer, or null when unknown. */
export function monthsWithCurrentTrainer(w: World, boxerId: number): number | null {
  const cur = (w.stintsByBoxer.get(boxerId) ?? []).find((s) => s.role === "head_trainer" && s.end === null);
  if (!cur?.start) return null;
  return Math.max(0, (Date.parse(w.today) - Date.parse(cur.start)) / (30.4 * 86400000));
}

/** Trainer's average Elo change per fight-tenure; used as an (initially unweighted) model feature. */
export function trainerEdge(w: World, boxerId: number): number {
  const cur = (w.stintsByBoxer.get(boxerId) ?? []).find((s) => s.role === "head_trainer" && s.end === null);
  if (!cur?.personId) return 0;
  const stable = personStable(w, cur.personId, ["head_trainer"]);
  return stable.avgRatingChange ?? 0;
}
