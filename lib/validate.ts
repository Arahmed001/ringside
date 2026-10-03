/**
 * Data-quality gate for any provider feed.
 *
 * `sanitizeFeed` checks a feed before it touches the database. Rows that would corrupt records (an unknown
 * division, a winner who was not in the bout, a reference to a fighter that does not exist) are dropped and
 * reported; rows that are merely suspicious (a missed-weight flag that contradicts the scale, scorecards that
 * disagree with the result) are kept and flagged. Nothing is silently fixed.
 */
import type { FeedData } from "./feed";
import { DIVISIONS, normalizeDivision } from "./divisions";
import { METHODS, endsEarly, hasScorecards, hasWinner, isDrawResult } from "./methods";
import type { ProviderBout } from "./providers";

export type Severity = "error" | "warning" | "info";
export interface Issue { severity: Severity; code: string; entity: string; ref: string; message: string }
export interface Sanitized { feed: FeedData; issues: Issue[]; dropped: Record<string, number> }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string | null | undefined) => !!s && ISO.test(s) && !Number.isNaN(Date.parse(s + "T12:00:00Z")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
const PERSON_ROLES = new Set(["head_trainer", "assistant_trainer", "strength_coach", "cutman", "manager"]);
const ORG_ROLES = new Set(["gym", "promoter"]);

export function sanitizeFeed(input: FeedData, opts: { today?: string } = {}): Sanitized {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const issues: Issue[] = [];
  const dropped: Record<string, number> = {};
  const add = (severity: Severity, code: string, entity: string, ref: string, message: string) => issues.push({ severity, code, entity, ref, message });
  const drop = (entity: string) => { dropped[entity] = (dropped[entity] ?? 0) + 1; };

  /** Keeps the first row per externalId; later duplicates are errors. */
  const unique = <T extends { externalId: string }>(rows: T[], entity: string): T[] => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (!r.externalId) { add("error", "missing_id", entity, "(blank)", `${entity} row without an externalId`); drop(entity); return false; }
      if (seen.has(r.externalId)) { add("error", "dup_id", entity, r.externalId, `duplicate ${entity} id`); drop(entity); return false; }
      seen.add(r.externalId); return true;
    });
  };

  // ---------- boxers ----------
  const boxers = unique(input.boxers, "boxer").filter((b) => {
    if (!normalizeDivision(b.weightClass)) { add("error", "unknown_division", "boxer", b.externalId, `"${b.weightClass}" is not a recognised weight class`); drop("boxer"); return false; }
    return true;
  });
  for (const b of boxers) {
    if (b.heightCm && (b.heightCm < 120 || b.heightCm > 230)) add("warning", "implausible_height", "boxer", b.externalId, `height ${b.heightCm} cm`);
    if (b.reachCm && (b.reachCm < 120 || b.reachCm > 250)) add("warning", "implausible_reach", "boxer", b.externalId, `reach ${b.reachCm} cm`);
    else if (b.heightCm && b.reachCm && (b.reachCm - b.heightCm > 25 || b.reachCm - b.heightCm < -12)) add("warning", "reach_height_mismatch", "boxer", b.externalId, `reach ${b.reachCm} cm vs height ${b.heightCm} cm`);
    if (b.turnedPro && b.birthYear && (b.turnedPro - b.birthYear < 14 || b.turnedPro - b.birthYear > 55)) add("warning", "debut_age", "boxer", b.externalId, `turned pro at ${b.turnedPro - b.birthYear}`);
    if (b.debutDate && b.retiredDate && b.retiredDate < b.debutDate) add("warning", "retired_before_debut", "boxer", b.externalId, `retired ${b.retiredDate} before debut ${b.debutDate}`);
    if (b.sex !== undefined && b.sex !== "male" && b.sex !== "female") add("warning", "unknown_sex", "boxer", b.externalId, `sex "${b.sex}" (treated as male)`);
    if (b.birthDate && !validDate(b.birthDate)) add("warning", "bad_birth_date", "boxer", b.externalId, `birth date "${b.birthDate}"`);
  }
  const boxerIds = new Set(boxers.map((b) => b.externalId));

  // ---------- events ----------
  const events = unique(input.events, "event").filter((e) => {
    if (!validDate(e.date)) { add("error", "bad_date", "event", e.externalId, `event date "${e.date}" is not a valid yyyy-mm-dd date`); drop("event"); return false; }
    return true;
  });
  const eventDate = new Map(events.map((e) => [e.externalId, e.date]));
  const eventStatus = new Map(events.map((e) => [e.externalId, e.status]));

  // ---------- bouts ----------
  const methodSet = new Set<string>(METHODS);
  const bouts = unique(input.bouts, "bout").filter((b) => {
    const err = (code: string, msg: string) => { add("error", code, "bout", b.externalId, msg); drop("bout"); return false; };
    if (!eventDate.has(b.eventExternalId)) return err("bad_reference", `event ${b.eventExternalId} does not exist`);
    if (!boxerIds.has(b.redExternalId) || !boxerIds.has(b.blueExternalId)) return err("bad_reference", `fighter ${!boxerIds.has(b.redExternalId) ? b.redExternalId : b.blueExternalId} does not exist`);
    if (b.redExternalId === b.blueExternalId) return err("same_fighter", "a fighter cannot fight himself");
    if (!normalizeDivision(b.weightClass)) return err("unknown_division", `"${b.weightClass}" is not a recognised weight class`);
    if (b.method !== null && !methodSet.has(b.method)) return err("unknown_method", `"${b.method}" is not a recognised result method`);
    if (!(b.rounds >= 1 && b.rounds <= 15)) return err("bad_round", `${b.rounds} scheduled rounds`);
    if (b.endRound !== null && b.endRound !== undefined && !(b.endRound >= 1 && b.endRound <= b.rounds)) return err("bad_round", `ended in round ${b.endRound} of ${b.rounds}`);
    if (b.method === null && b.winnerExternalId) return err("result_inconsistent", "a winner is named but no result method");
    if (b.method !== null && hasWinner(b.method) && !b.winnerExternalId) return err("result_inconsistent", `${b.method} result without a winner`);
    if (b.method !== null && !hasWinner(b.method) && b.winnerExternalId) return err("result_inconsistent", `${b.method} cannot have a winner`);
    if (b.winnerExternalId && b.winnerExternalId !== b.redExternalId && b.winnerExternalId !== b.blueExternalId) return err("winner_not_in_bout", `winner ${b.winnerExternalId} was not in the bout`);
    return true;
  });
  for (const b of bouts) {
    const date = eventDate.get(b.eventExternalId)!;
    if (b.method && date > today && b.status !== "cancelled") add("warning", "result_in_future", "bout", b.externalId, `result recorded for an event dated ${date}`);
    if (b.method && (b.status === "cancelled" || eventStatus.get(b.eventExternalId) === "cancelled")) add("warning", "result_on_cancelled", "bout", b.externalId, "result recorded on a cancelled bout/event");
    if (b.method && endsEarly(b.method) && (b.endRound === null || b.endRound === undefined)) add("warning", "missing_end_round", "bout", b.externalId, `${b.method} without the round it ended`);
    if (b.oddsRed !== undefined && b.oddsRed !== null && b.oddsRed <= 1) add("warning", "odds_invalid", "bout", b.externalId, `odds ${b.oddsRed}`);
    if ((b.kdRed ?? 0) < 0 || (b.kdBlue ?? 0) < 0) add("warning", "kd_negative", "bout", b.externalId, "negative knockdown count");
  }
  // one fighter, two bouts on the same night
  const nights = new Map<string, string[]>();
  for (const b of bouts) {
    if (b.status === "cancelled") continue;
    for (const id of [b.redExternalId, b.blueExternalId]) {
      const k = `${id}|${eventDate.get(b.eventExternalId)}`;
      (nights.get(k) ?? nights.set(k, []).get(k)!).push(b.externalId);
    }
  }
  for (const [k, list] of nights) if (list.length > 1) add("warning", "fighter_double_booked", "boxer", k.split("|")[0], `appears in ${list.length} bouts on ${k.split("|")[1]} (${list.join(", ")})`);

  const boutBy = new Map(bouts.map((b) => [b.externalId, b]));
  const inBout = (b: ProviderBout, id: string) => b.redExternalId === id || b.blueExternalId === id;

  // ---------- people / orgs ----------
  const people = unique(input.people, "person");
  const orgs = unique(input.orgs, "org");
  const personIds = new Set(people.map((p) => p.externalId)), orgIds = new Set(orgs.map((o) => o.externalId));

  // ---------- team stints ----------
  const stints = input.stints.filter((s, i) => {
    const ref = `${s.boxerExternalId}#${i}`;
    const err = (code: string, msg: string) => { add("error", code, "stint", ref, msg); drop("stint"); return false; };
    if (!boxerIds.has(s.boxerExternalId)) return err("bad_reference", `fighter ${s.boxerExternalId} does not exist`);
    if (PERSON_ROLES.has(s.role) && !s.personExternalId) return err("stint_no_entity", `${s.role} needs a person`);
    if (ORG_ROLES.has(s.role) && !s.orgExternalId) return err("stint_no_entity", `${s.role} needs an organisation`);
    if (!PERSON_ROLES.has(s.role) && !ORG_ROLES.has(s.role)) return err("unknown_role", `role "${s.role}"`);
    if (s.personExternalId && !personIds.has(s.personExternalId)) return err("bad_reference", `person ${s.personExternalId} does not exist`);
    if (s.orgExternalId && !orgIds.has(s.orgExternalId)) return err("bad_reference", `org ${s.orgExternalId} does not exist`);
    if ((s.start && !validDate(s.start)) || (s.end && !validDate(s.end))) return err("bad_date", `stint dates "${s.start}" to "${s.end}"`);
    if (s.start && s.end && s.end < s.start) return err("stint_bad_dates", `ends ${s.end} before it starts ${s.start}`);
    return true;
  });
  const heads = new Map<string, typeof stints>();
  for (const s of stints) if (s.role === "head_trainer") (heads.get(s.boxerExternalId) ?? heads.set(s.boxerExternalId, []).get(s.boxerExternalId)!).push(s);
  for (const [id, list] of heads) {
    const sorted = [...list].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
    for (let i = 1; i < sorted.length; i++) if (sorted[i].start && (sorted[i - 1].end === null || sorted[i - 1].end === undefined || sorted[i].start! < sorted[i - 1].end!)) { add("warning", "head_trainer_overlap", "boxer", id, `two head trainers overlap around ${sorted[i].start}`); break; }
  }

  // ---------- weigh-ins ----------
  const weighIns = input.weighIns.filter((w, i) => {
    const ref = `${w.boutExternalId}/${w.boxerExternalId}`;
    const b = boutBy.get(w.boutExternalId);
    if (!b || !boxerIds.has(w.boxerExternalId)) { add("error", "bad_reference", "weigh_in", ref, "bout or fighter does not exist"); drop("weigh_in"); return false; }
    if (!inBout(b, w.boxerExternalId)) { add("error", "not_in_bout", "weigh_in", ref, "fighter was not in this bout"); drop("weigh_in"); return false; }
    void i; return true;
  });
  const divLimit = (name: string) => DIVISIONS.find((d) => d.name === normalizeDivision(name))?.lb ?? null;
  for (const w of weighIns) {
    const ref = `${w.boutExternalId}/${w.boxerExternalId}`, b = boutBy.get(w.boutExternalId)!;
    if (w.officialLb !== undefined && (w.officialLb < 80 || w.officialLb > 400)) add("warning", "weight_implausible", "weigh_in", ref, `official weight ${w.officialLb} lb`);
    if (w.officialLb !== undefined && w.fightNightLb !== undefined && w.fightNightLb < w.officialLb - 6) add("warning", "fight_night_below_official", "weigh_in", ref, `fight night ${w.fightNightLb} lb vs scale ${w.officialLb} lb`);
    if (w.officialLb !== undefined && w.fightNightLb !== undefined && w.fightNightLb > w.officialLb + 40) add("warning", "rehydration_implausible", "weigh_in", ref, `gained ${(w.fightNightLb - w.officialLb).toFixed(1)} lb`);
    const std = divLimit(b.weightClass);
    if (w.limitLb && std && !b.contractLb && Math.abs(w.limitLb - std) > 8) add("warning", "limit_mismatch", "weigh_in", ref, `limit ${w.limitLb} lb in a ${std} lb division`);
    if (w.limitLb && w.officialLb !== undefined && w.madeWeight === true && w.officialLb > w.limitLb + 0.05) add("warning", "made_weight_inconsistent", "weigh_in", ref, `marked as made weight at ${w.officialLb} lb over a ${w.limitLb} lb limit`);
    if (w.limitLb && w.officialLb !== undefined && w.madeWeight === false && w.officialLb <= w.limitLb) add("warning", "made_weight_inconsistent", "weigh_in", ref, `marked as missed weight at ${w.officialLb} lb under a ${w.limitLb} lb limit`);
  }

  // ---------- officials, scorecards, corners, punches ----------
  const officials = input.officials.filter((o) => {
    const ok = boutBy.has(o.boutExternalId) && personIds.has(o.personExternalId);
    if (!ok) { add("error", "bad_reference", "official", `${o.boutExternalId}/${o.personExternalId}`, "bout or person does not exist"); drop("official"); }
    return ok;
  });
  const scorecards = input.scorecards.filter((c) => {
    const ok = boutBy.has(c.boutExternalId) && personIds.has(c.judgeExternalId);
    if (!ok) { add("error", "bad_reference", "scorecard", `${c.boutExternalId}/${c.judgeExternalId}`, "bout or judge does not exist"); drop("scorecard"); }
    return ok;
  });
  const cardsBy = new Map<string, typeof scorecards>();
  for (const c of scorecards) (cardsBy.get(c.boutExternalId) ?? cardsBy.set(c.boutExternalId, []).get(c.boutExternalId)!).push(c);
  for (const [id, cards] of cardsBy) {
    const b = boutBy.get(id)!;
    if (new Set(cards.map((c) => c.seat)).size !== cards.length) add("warning", "scorecard_duplicate_seat", "bout", id, "two cards share a judge seat");
    // technical decisions are scored over the rounds actually fought, full decisions over the scheduled distance
    const scored = (b.method === "TD" || b.method === "TDRAW") && b.endRound ? b.endRound : b.rounds;
    if (cards.some((c) => c.red > 10 * scored || c.blue > 10 * scored || c.red < 6 * scored || c.blue < 6 * scored)) add("warning", "scorecard_range", "bout", id, `a score outside ${6 * scored}-${10 * scored} for ${scored} scored rounds`);
    if (hasScorecards(b.method)) {
      if (cards.length !== 3) { add("warning", "scorecard_incomplete", "bout", id, `${cards.length} scorecard${cards.length === 1 ? "" : "s"} for a ${b.method}`); continue; }
      const sides = cards.map((c) => (c.red > c.blue ? "red" : c.blue > c.red ? "blue" : "even"));
      const win = b.winnerExternalId === b.redExternalId ? "red" : b.winnerExternalId === b.blueExternalId ? "blue" : null;
      const n = (s: string) => sides.filter((x) => x === s).length;
      let ok = true;
      if (win && b.method === "UD") ok = n(win) === 3;
      else if (win && b.method === "MD") ok = n(win) === 2 && n("even") === 1;
      else if (win && b.method === "SD") ok = n(win) === 2 && n(win === "red" ? "blue" : "red") === 1;
      else if (win && b.method === "TD") ok = n(win) >= 2;
      else if (isDrawResult(b.method)) ok = n("even") >= 2 || (n("red") === 1 && n("blue") === 1);
      if (!ok) add("warning", "scorecard_result_mismatch", "bout", id, `${cards.map((c) => `${c.red}-${c.blue}`).join(", ")} does not fit a ${b.method}${win ? ` won by ${win}` : ""}`);
    }
  }
  const corners = input.corners.filter((c) => {
    const b = boutBy.get(c.boutExternalId);
    const ok = !!b && boxerIds.has(c.boxerExternalId) && personIds.has(c.personExternalId);
    if (!ok) { add("error", "bad_reference", "corner", `${c.boutExternalId}/${c.boxerExternalId}`, "bout, fighter or person does not exist"); drop("corner"); return false; }
    if (!inBout(b, c.boxerExternalId)) { add("warning", "corner_not_in_bout", "corner", `${c.boutExternalId}/${c.boxerExternalId}`, "fighter was not in this bout"); }
    return true;
  });
  const punches = input.punches.filter((p) => {
    const b = boutBy.get(p.boutExternalId);
    const ok = !!b && boxerIds.has(p.boxerExternalId);
    if (!ok) { add("error", "bad_reference", "punch_stat", `${p.boutExternalId}/${p.boxerExternalId}`, "bout or fighter does not exist"); drop("punch_stat"); return false; }
    if (p.landed > p.thrown || p.powerLanded > p.powerThrown || p.powerThrown > p.thrown) add("warning", "punch_inconsistent", "punch_stat", `${p.boutExternalId}/${p.boxerExternalId}/r${p.round}`, `landed ${p.landed}/${p.thrown}, power ${p.powerLanded}/${p.powerThrown}`);
    return true;
  });

  // ---------- orphans ----------
  const usedPeople = new Set<string>([...stints.map((s) => s.personExternalId), ...officials.map((o) => o.personExternalId), ...scorecards.map((c) => c.judgeExternalId), ...corners.map((c) => c.personExternalId)].filter((x): x is string => !!x));
  const usedOrgs = new Set<string>([...stints.map((s) => s.orgExternalId), ...events.map((e) => e.promoterExternalId), ...bouts.map((b) => b.titleOrgExternalId)].filter((x): x is string => !!x));
  const orphanP = people.filter((p) => !usedPeople.has(p.externalId)).length, orphanO = orgs.filter((o) => !usedOrgs.has(o.externalId)).length;
  if (orphanP) add("info", "orphan_people", "person", "*", `${orphanP} people are not linked to any fighter, bout or card`);
  if (orphanO) add("info", "orphan_orgs", "org", "*", `${orphanO} organisations are not linked to anything`);

  return { feed: { boxers, events, bouts, people, orgs, stints, weighIns, officials, scorecards, corners, punches }, issues, dropped };
}

export interface IssueGroup { severity: Severity; code: string; count: number; examples: Issue[] }

/** Groups issues by code (errors first) with a couple of examples each, for reports. */
export function groupIssues(issues: Issue[], examples = 2): IssueGroup[] {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  const by = new Map<string, IssueGroup>();
  for (const i of issues) {
    const g = by.get(`${i.severity}:${i.code}`) ?? by.set(`${i.severity}:${i.code}`, { severity: i.severity, code: i.code, count: 0, examples: [] }).get(`${i.severity}:${i.code}`)!;
    g.count++; if (g.examples.length < examples) g.examples.push(i);
  }
  return [...by.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);
}

export const countBySeverity = (issues: Issue[]) => ({
  errors: issues.filter((i) => i.severity === "error").length,
  warnings: issues.filter((i) => i.severity === "warning").length,
  infos: issues.filter((i) => i.severity === "info").length,
});
