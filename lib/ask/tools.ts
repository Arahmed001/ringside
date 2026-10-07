import { orDash } from "../facts";
import type { BoutRow, BoxerFull } from "../types";
import { WEIGHT_CLASSES } from "../types";
import { careerCounts, careerView, koView, recordStr } from "../world";
import { applyFilters, matchupBlurb, sanitizeFilters, type Filters } from "../ai";
import { searchFighters } from "../fighter-search";
import { LISTS, listDef, recordList, rowText, type ListId, type Scope } from "../records";
import { rankDivision, pound4pound, rankOf } from "../rankings";
import { belts, beltLabel, reignsOf } from "../lineage";
import { eventViews, recentEvents, upcomingEvents } from "../events";
import { topFightsOfYear, fightScoreOf, fightOfTheYear, resultLine, fightReasons } from "../fight-score";
import { secondsIn } from "../records";
import { countsInRecord, isDecision, isStoppage } from "../methods";
import { upsetWatch, TIER_LABEL } from "../upsets";
import { trainerImpact, VERDICT_LABEL, underdogRecordOf } from "../trainer-impact";
import { personStable } from "../team";
import { topGates, topPpv, topPurses, topEarners, usd } from "../money";
import { predict } from "../predict";
import { divisionLabel } from "../divisions";
import { archetype } from "../style";
import { countryName, fmtDate, methodLabel } from "../format";
import { normalize } from "../fighter-search";
import { msg } from "../i18n/t";
import type { ArgSpec, Cell, Ctx, Tool, ToolResult } from "./types";

const LIMIT: ArgSpec = { name: "limit", kind: "number", about: "how many rows, 1 to 25 (default 10)", min: 1, max: 25 };
const SEX: ArgSpec = { name: "sex", kind: "enum", about: "men or women", values: ["male", "female"] };
const DIVISION: ArgSpec = { name: "division", kind: "enum", about: "weight division", values: WEIGHT_CLASSES };
const METHODS = ["KO", "TKO", "RTD", "UD", "SD", "MD", "DRAW", "DQ", "TD"] as const;

const boxerCell = (b: BoxerFull, t: Ctx["t"]): Cell => ({ text: t.name(b.name), href: `/boxers/${b.slug}` });
const boutCell = (b: BoutRow, t: Ctx["t"]): Cell => ({ text: `${t.name(b.redName)} ${t("vs")} ${t.name(b.blueName)}`, href: `/bouts/${b.id}` });
const num = (a: Record<string, unknown>, k: string, d: number) => (typeof a[k] === "number" ? (a[k] as number) : d);
const str = (a: Record<string, unknown>, k: string) => (typeof a[k] === "string" && a[k] ? (a[k] as string) : undefined);
const take = (a: Record<string, unknown>) => Math.max(1, Math.min(25, Math.round(num(a, "limit", 10))));
const done = (w: Ctx["w"]) => w.bouts.filter((b) => !b.upcoming && b.status === "completed" && !!b.method);

/** A fighter by name: the best match among names, nicknames and aliases, in English or Arabic. */
export function findFighter(ctx: Ctx, name: string | undefined, minBouts = 0): BoxerFull | undefined {
  return name ? searchFighters(ctx.w, name, { limit: 1, minBouts, names: ctx.names })[0] : undefined;
}

const empty = (tool: string, args: Record<string, unknown>, t: Ctx["t"], what: string): ToolResult => ({ tool, args, summary: what, lines: [what], tables: [] });

// ---- the tools ----

const fighters: Tool = {
  name: "fighters",
  about: "Find fighters by filters (division, stance, sex, country, active, undefeated, minimum wins or knockouts, KO rate, age, style, trainer, gym) and sort them. Also counts how many match.",
  args: [
    DIVISION, { name: "stance", kind: "enum", about: "stance", values: ["Orthodox", "Southpaw", "Switch"] }, SEX,
    { name: "country", kind: "string", about: "country, e.g. Mexico or United States" }, { name: "active", kind: "boolean", about: "still active" }, { name: "undefeated", kind: "boolean", about: "no losses" },
    { name: "minWins", kind: "number", about: "at least this many wins", min: 0, max: 100 }, { name: "maxWins", kind: "number", about: "at most this many wins", min: 0, max: 100 },
    { name: "minKOs", kind: "number", about: "at least this many knockouts", min: 0, max: 100 }, { name: "maxKOs", kind: "number", about: "at most this many knockouts", min: 0, max: 100 },
    { name: "minLosses", kind: "number", about: "at least this many losses", min: 0, max: 100 }, { name: "maxLosses", kind: "number", about: "at most this many losses (0 for none)", min: 0, max: 100 },
    { name: "minStopped", kind: "number", about: "lost by knockout at least this many times", min: 0, max: 100 }, { name: "maxStopped", kind: "number", about: "lost by knockout at most this many times (0 for never stopped)", min: 0, max: 100 },
    { name: "minDraws", kind: "number", about: "at least this many draws", min: 0, max: 50 }, { name: "maxDraws", kind: "number", about: "at most this many draws (0 for none)", min: 0, max: 50 },
    { name: "minWinStreak", kind: "number", about: "on a current winning streak of at least this many", min: 1, max: 100 }, { name: "minLossStreak", kind: "number", about: "on a current losing streak of at least this many", min: 1, max: 100 },
    { name: "unbeatenIn", kind: "number", about: "no loss in the last this many fights", min: 1, max: 100 },
    { name: "lastFightAfter", kind: "string", about: "last fought on or after this date, YYYY-MM-DD" }, { name: "lastFightBefore", kind: "string", about: "last fought on or before this date, YYYY-MM-DD" },
    { name: "minBouts", kind: "number", about: "at least this many fights", min: 0, max: 200 }, { name: "maxBouts", kind: "number", about: "at most this many fights", min: 0, max: 200 },
    { name: "record", kind: "enum", about: "a winning record (more wins than losses) or a losing one", values: ["winning", "losing"] },
    { name: "champion", kind: "enum", about: "holds a belt now, held one and no longer does, or has ever held one", values: ["current", "former", "ever"] },
    { name: "minReach", kind: "number", about: "at least this reach, cm", min: 100, max: 250 }, { name: "maxReach", kind: "number", about: "at most this reach, cm", min: 100, max: 250 },
    { name: "minRating", kind: "number", about: "rated at least this (the rating as shown)", min: 800, max: 2500 }, { name: "maxRating", kind: "number", about: "rated at most this", min: 800, max: 2500 },
    { name: "minHeight", kind: "number", about: "at least this tall, cm", min: 100, max: 250 }, { name: "maxHeight", kind: "number", about: "at most this tall, cm", min: 100, max: 250 },
    { name: "minKoRate", kind: "number", about: "knockouts as a share of wins, 0 to 1", min: 0, max: 1 }, { name: "minAge", kind: "number", about: "at least this age", min: 16, max: 60 }, { name: "maxAge", kind: "number", about: "at most this age", min: 16, max: 60 },
    { name: "archetype", kind: "string", about: "style: Knockout Artist, Volume Boxer, Technician, Iron-Chin Brawler, Counter-Puncher, Journeyman" },
    { name: "trainer", kind: "string", about: "head trainer name" }, { name: "gym", kind: "string", about: "gym name" },
    { name: "sort", kind: "enum", about: "sort order (default rating)", values: ["rating", "wins", "kos", "koRate", "age", "youngest", "reach", "height", "shortest", "bouts", "lowRating", "lowKoRate", "winRate", "losses", "draws", "stopped"] }, LIMIT,
  ],
  run({ w, t, names }, args) {
    const countries = [...new Set(w.boxers.map((b) => b.country))];
    // a country nobody in the data is from is an answer ("no one"), not a filter to drop: dropping it would list everyone and look like an answer
    if (typeof args.country === "string" && args.country && !countries.includes(args.country)) return empty("fighters", args, t, t("No fighters in the data are from {country}.", { country: countryName(args.country, t.locale) }));
    const f: Filters = sanitizeFilters(args, countries);
    const all = applyFilters(w.boxers.filter((b) => b.bouts > 0), f, w, names);
    const top = all.slice(0, take(args));
    if (!all.length) return empty("fighters", args, t, t("No fighters match those filters."));
    const sort = f.sort ?? "rating";
    const lead = top[0];
    return {
      tool: "fighters", args,
      summary: t.n(all.length, "{n} fighter matches. The first, by {sort}, is {name} ({record}).", "{n} fighters match. The first, by {sort}, is {name} ({record}).", { sort: t(SORT_NAME[sort]), name: t.name(lead.name), record: recordStr(lead) }),
      lines: [`${all.length} fighters match; sorted by ${sort}.`, ...top.map((b, i) => `${i + 1}. ${t.name(b.name)}: ${recordStr(b)}, ${koView(b).kos} KOs, rating ${Math.round(b.rating)}, ${b.weightClass}, ${b.stance}, age ${b.age}`)],
      tables: [{ id: "fighters", title: t("Matching fighters"), columns: ["#", t("Fighter"), t("Record"), t("KOs"), t("Rating"), t("Division")],
        rows: top.map((b, i) => [String(i + 1), boxerCell(b, t), recordStr(b), String(koView(b).kos), String(Math.round(b.rating)), divisionLabel(b.weightClass, b.sex, t)]),
        note: all.length > top.length ? t("Showing {n} of {total}.", { n: top.length, total: all.length }) : undefined }],
    };
  },
};
const SORT_NAME: Record<string, string> = { rating: msg("rating"), wins: msg("wins"), kos: msg("knockouts"), koRate: msg("KO rate"), age: msg("age, oldest first"), youngest: msg("age, youngest first"), reach: msg("reach"), height: msg("height"), shortest: msg("height, shortest first"), bouts: msg("fights"), lowRating: msg("rating, lowest first"), lowKoRate: msg("KO rate, lowest first"), winRate: msg("win rate"), losses: msg("losses"), draws: msg("draws"), stopped: msg("times stopped") };

const recordListTool: Tool = {
  name: "record_list",
  about: `All-time record lists: ${LISTS.map((l) => `${l.id} (${l.title})`).join("; ")}. Optional sex and division filters.`,
  args: [{ name: "list", kind: "enum", about: "which list", values: LISTS.map((l) => l.id) }, SEX, DIVISION, LIMIT],
  run({ w, t }, args) {
    const def = listDef(str(args, "list") ?? "");
    if (!def) return empty("record_list", args, t, t("That record list does not exist."));
    const scope: Scope = { sex: args.sex === "female" ? "female" : args.sex === "male" ? "male" : undefined, division: (WEIGHT_CLASSES as readonly string[]).includes(String(args.division)) ? String(args.division) : undefined };
    const rows = recordList(w, def.id as ListId, scope, take(args));
    if (!rows.length) return empty("record_list", args, t, t("Nobody qualifies for “{list}” in this data.", { list: t(def.title) }));
    const text = rows.map((r) => ({ r, x: rowText(def.id, r, t) }));
    const who = (r: (typeof rows)[number]) => (r.boxer ? t.name(r.boxer.name) : r.bout ? `${t.name(r.bout.redName)} ${t("vs")} ${t.name(r.bout.blueName)}` : "");
    return {
      tool: "record_list", args,
      summary: t("{list}: {name} leads with {value}.", { list: t(def.title), name: who(rows[0]), value: text[0].x.value }),
      lines: [`${def.title} (${def.blurb})`, ...text.map(({ r, x }) => `${r.rank}. ${who(r)}: ${x.value}${x.sub ? ` (${x.sub})` : ""}`)],
      tables: [{ id: def.id, title: t(def.title), columns: ["#", def.subject === "bout" ? t("Fight") : t("Fighter"), t("Value"), t("Detail")],
        rows: text.map(({ r, x }) => [String(r.rank), r.boxer ? boxerCell(r.boxer, t) : r.bout ? boutCell(r.bout, t) : "", x.value, x.sub ?? ""]), note: t(def.blurb) }],
    };
  },
};

/** The sentence that answers one question about one fighter, or says plainly that the data does not give the fact: an unknown is never filled in. */
function factSentence(ctx: Ctx, b: BoxerFull, fact: FighterFact, more: { rank: number | null; held: ReturnType<typeof reignsOf>; trainer: { name: string } | undefined; recent: BoutRow[] }): string {
  const { w, t } = ctx;
  const name = t.name(b.name);
  const gap = (what: string) => t("The data does not give {what} for {name}.", { what, name });
  switch (fact) {
    case "height": return b.heightCm !== null ? t("{name} is {cm} cm tall.", { name, cm: b.heightCm }) : gap(t("a height"));
    case "reach": return b.reachCm !== null ? t("{name}’s reach is {cm} cm.", { name, cm: b.reachCm }) : gap(t("a reach"));
    case "age": return b.age !== null ? t("{name} is {age} years old.", { name, age: b.age }) : gap(t("an age"));
    case "stance": return b.stance ? t("{name}’s stance is {stance}.", { name, stance: t(b.stance) }) : gap(t("a stance"));
    case "country": return t("{name} is from {country}.", { name, country: countryName(b.country, t.locale) });
    case "division": return t("{name} fights at {division}.", { name, division: divisionLabel(b.weightClass, b.sex, t) });
    case "trainer": return more.trainer ? t("{name}’s head trainer is {trainer}.", { name, trainer: t.name(more.trainer.name) }) : t("The data has no current head trainer for {name}.", { name });
    case "gym": {
      const stint = (w.stintsByBoxer.get(b.id) ?? []).find((x) => x.role === "gym" && x.end === null);
      const gym = stint?.orgId ? w.orgs.get(stint.orgId) : undefined;
      return gym ? t("{name} trains at {gym}.", { name, gym: t.name(gym.name) }) : t("The data has no current gym for {name}.", { name });
    }
    case "manager": {
      const stint = (w.stintsByBoxer.get(b.id) ?? []).find((x) => x.role === "manager" && x.end === null && x.personId);
      const person = stint?.personId ? w.people.get(stint.personId) : undefined;
      return person ? t("{name}’s manager is {manager}.", { name, manager: t.name(person.name) }) : t("The data has no current manager for {name}.", { name });
    }
    case "title_fights": {
      const title = (w.boutsByBoxer.get(b.id) ?? []).filter((x) => x.title && !x.upcoming && x.method);
      const won = title.filter((x) => x.winnerId === b.id).length;
      return title.length ? t.n(title.length, "{name} has won {won} of {n} title fight.", "{name} has won {won} of {n} title fights.", { name, won }) : t("{name} has not fought for a title on record.", { name });
    }
    case "stopped": {
      const lost = (w.boutsByBoxer.get(b.id) ?? []).filter((x) => !x.upcoming && x.method && x.winnerId !== null && x.winnerId !== b.id);
      const stopped = lost.filter((x) => isStoppage(x.method)).length;
      return stopped ? t.n(stopped, "{name} has been stopped {n} time (losses in all: {losses}).", "{name} has been stopped {n} times (losses in all: {losses}).", { name, losses: lost.length }) : t("{name} has never been knocked out or stopped on record.", { name });
    }
    case "status": {
      const record = recordStr(b);
      const lost = careerCounts(b).losses; // the career as the page shows it, not only the fights held
      if (lost === 0) return b.active ? t("{name} is active and unbeaten ({record}).", { name, record }) : t("{name} is retired and unbeaten ({record}).", { name, record });
      return b.active ? t.n(lost, "{name} is active and has lost {n} time ({record}).", "{name} is active and has lost {n} times ({record}).", { name, record }) : t("{name} is retired; the record is {record}.", { name, record });
    }
    case "last_fight": {
      const x = more.recent[0];
      if (!x) return t("{name} has no completed fights on record.", { name });
      const result = x.winnerId === null ? t("a draw") : x.winnerId === b.id ? t("a win") : t("a loss");
      return t("{name}’s last fight was on {date}: {result} against {opponent} ({method}).", { name, date: fmtDate(x.date, { month: "short", day: "numeric", year: "numeric" }, t.locale), result, opponent: t.name(x.redId === b.id ? x.blueName : x.redName), method: methodLabel(x.method, x.endRound, t) });
    }
    case "next_fight": {
      const next = (w.boutsByBoxer.get(b.id) ?? []).filter((x) => x.upcoming).sort((p, q) => p.date.localeCompare(q.date))[0]; // (a bout that fell off the card, or on a called-off one, is not upcoming)
      return next ? t("{name}’s next fight is against {opponent} on {date}.", { name, opponent: t.name(next.redId === b.id ? next.blueName : next.redName), date: fmtDate(next.date, { month: "short", day: "numeric", year: "numeric" }, t.locale) }) : t("No upcoming fight is scheduled for {name}.", { name });
    }
    case "record": return t("{name} has had {n} fights: {record}.", { name, n: (({ wins, losses, draws }) => wins + losses + draws)(careerCounts(b)), record: recordStr(b) });
    case "knockouts": { // the career's knockouts when the supplier states them for a career held in part; otherwise what the fights held add up to
      const k = koView(b), wins = k.source === "supplier" ? careerView(b).wins : b.wins;
      return t("{name} has {kos} knockouts in {wins} wins ({pct}%).", { name, kos: k.kos, wins, pct: wins ? Math.round((100 * k.kos) / wins) : 0 });
    }
    case "rating": return t("{name} is rated {elo}{rank}.", { name, elo: Math.round(b.rating), rank: more.rank ? t(", number {n} in the division", { n: more.rank }) : "" });
    case "debut": return b.turnedPro !== null ? t("{name} turned pro in {year}.", { name, year: b.turnedPro }) : gap(t("a pro debut year"));
    case "nickname": return b.nickname ? t("{name} is known as “{nickname}”.", { name, nickname: t.name(b.nickname) }) : t("{name} has no nickname on record.", { name });
    case "style": return t("{name}’s style is {style}.", { name, style: t(archetype(b)) });
    case "promoter": {
      const stint = (w.stintsByBoxer.get(b.id) ?? []).find((x) => x.role === "promoter" && x.end === null && x.orgId);
      const org = stint?.orgId ? w.orgs.get(stint.orgId) : undefined;
      return org ? t("{name}’s promoter is {promoter}.", { name, promoter: t.name(org.name) }) : t("The data has no current promoter for {name}.", { name });
    }
    case "streak": {
      const list = (w.boutsByBoxer.get(b.id) ?? []).filter((x) => !x.upcoming && countsInRecord(x.method));
      let longest = 0, run = 0;
      for (const x of list) { run = x.winnerId === b.id ? run + 1 : 0; longest = Math.max(longest, run); }
      if (!list.length) return t("{name} has no completed fights on record.", { name });
      if (b.streak.type === "W") return t("{name} is on a winning streak of {n} (the longest winning run: {longest}).", { name, n: b.streak.count, longest });
      if (b.streak.type === "L") return t("{name} is on a losing streak of {n} (the longest winning run: {longest}).", { name, n: b.streak.count, longest });
      return t("{name} is not on a streak (the longest winning run: {longest}).", { name, longest });
    }
    case "decisions": {
      const list = (w.boutsByBoxer.get(b.id) ?? []).filter((x) => !x.upcoming && isDecision(x.method) && x.winnerId !== null);
      return t("{name}: {won} wins and {lost} losses by decision.", { name, won: list.filter((x) => x.winnerId === b.id).length, lost: list.filter((x) => x.winnerId !== b.id).length });
    }
    case "belts": return more.held.length ? t("{name} holds {belts}.", { name, belts: more.held.map((h) => beltLabel(h.belt, t)).join("; ") }) : t("{name} holds no current belt.", { name });
  }
}

/** What a question about one fighter can ask for, so the answer is that fact and not the whole profile. */
export const FIGHTER_FACTS = ["height", "reach", "age", "stance", "country", "division", "trainer", "gym", "manager", "last_fight", "next_fight", "record", "knockouts", "stopped", "title_fights", "status", "rating", "belts", "debut", "nickname", "style", "promoter", "streak", "decisions"] as const;
export type FighterFact = (typeof FIGHTER_FACTS)[number];

const fighter: Tool = {
  name: "fighter",
  about: "Everything about one fighter, by name: record, rating, rank, style, streak, belts, team and recent fights. Give `about` when the question asks for one fact, such as a height or the next fight.",
  args: [{ name: "name", kind: "string", about: "the fighter's name" }, { name: "about", kind: "enum", about: "the one fact asked for, if only one", values: FIGHTER_FACTS }],
  run(ctx, args) {
    const { w, t } = ctx;
    const b = findFighter(ctx, str(args, "name"));
    if (!b) return empty("fighter", args, t, t("No fighter found by that name."));
    const rank = rankOf(w, b);
    const held = reignsOf(w, b.id).filter((h) => h.reign.end === null && !h.belt.stale);
    const head = (w.stintsByBoxer.get(b.id) ?? []).find((s) => s.role === "head_trainer" && s.end === null);
    const trainer = head?.personId ? w.people.get(head.personId) : undefined;
    const recent = (w.boutsByBoxer.get(b.id) ?? []).filter((x) => !x.upcoming && x.method).slice(-5).reverse();
    const res = (x: BoutRow) => (x.winnerId === null ? t("D") : x.winnerId === b.id ? t("W") : t("L"));
    const fact = FIGHTER_FACTS.find((x) => x === str(args, "about"));
    const direct = fact ? factSentence(ctx, b, fact, { rank, held, trainer, recent }) : null;
    return {
      tool: "fighter", args,
      summary: direct ?? (() => {
        const v = { name: t.name(b.name), division: divisionLabel(b.weightClass, b.sex, t), country: countryName(b.country, t.locale), record: recordStr(b), elo: Math.round(b.rating), rank: rank ? t(", number {n} in the division", { n: rank }) : "" };
        return b.age !== null ? t("{name} is a {age}-year-old {division} from {country}: {record}, rated {elo}{rank}.", { ...v, age: b.age }) : t("{name} is a {division} from {country}: {record}, rated {elo}{rank}.", v); // an unknown age is left out, not guessed
      })(),
      lines: [
        `${t.name(b.name)}: ${recordStr(b)}, ${koView(b).kos} KOs, rating ${Math.round(b.rating)}, ${b.weightClass}, ${b.stance ?? "stance unknown"}, age ${b.age ?? "unknown"}, ${b.country}, style ${archetype(b)}${rank ? `, rank ${rank} in division` : ""}.`,
        `Streak: ${b.streak.type}${b.streak.count}. ${b.active ? "Active" : "Retired"}.`,
        held.length ? `Holds: ${held.map((h) => beltLabel(h.belt, t)).join("; ")}.` : "Holds no current belt.",
        trainer ? `Head trainer: ${t.name(trainer.name)}.` : "",
        ...recent.map((x) => `${fmtDate(x.date)}: ${res(x)} ${methodLabel(x.method, x.endRound, t)} against ${t.name(x.redId === b.id ? x.blueName : x.redName)}`),
      ].filter(Boolean),
      tables: [{ id: "recent", title: t("Recent fights of {name}", { name: t.name(b.name) }), columns: [t("Date"), t("Result"), t("Opponent"), t("Method")],
        rows: recent.map((x) => [fmtDate(x.date, { month: "short", day: "numeric", year: "numeric" }, t.locale), res(x), { text: t.name(x.redId === b.id ? x.blueName : x.redName), href: `/bouts/${x.id}` }, methodLabel(x.method, x.endRound, t)]),
        note: undefined }],
    };
  },
};

const headToHead: Tool = {
  name: "head_to_head",
  about: "Two fighters side by side: the model's prediction, who has fought whom before, and a tale of the tape.",
  args: [{ name: "a", kind: "string", about: "first fighter's name" }, { name: "b", kind: "string", about: "second fighter's name" }],
  run(ctx, args) {
    const { w, t } = ctx;
    const a = findFighter(ctx, str(args, "a")), b = findFighter(ctx, str(args, "b"));
    if (!a || !b || a.id === b.id) return empty("head_to_head", args, t, t("I could not find two different fighters by those names."));
    const p = predict(a, b, t);
    const met = (w.boutsByBoxer.get(a.id) ?? []).filter((x) => !x.upcoming && x.method && (x.redId === b.id || x.blueId === b.id)).reverse();
    const winsA = met.filter((x) => x.winnerId === a.id).length, winsB = met.filter((x) => x.winnerId === b.id).length;
    const row = (label: string, x: string, y: string): Cell[] => [label, x, y];
    return {
      tool: "head_to_head", args,
      summary: `${matchupBlurb(a, b, t)} ${met.length ? t("They have met {n} times: {a} {wa}, {b} {wb}.", { n: met.length, a: t.name(a.name), wa: winsA, b: t.name(b.name), wb: winsB }) : t("They have never met.")}`,
      lines: [
        `Model: ${t.name(a.name)} ${Math.round(p.pA * 100)}%, ${t.name(b.name)} ${Math.round(p.pB * 100)}%, draw ${Math.round(p.pDraw * 100)}%; stoppage chance ${Math.round(p.koProb * 100)}%.`,
        `${t.name(a.name)}: ${recordStr(a)}, rating ${Math.round(a.rating)}, age ${a.age ?? "unknown"}, reach ${a.reachCm === null ? "unknown" : a.reachCm + "cm"}, KO rate ${Math.round(koView(a).rate * 100)}%.`,
        `${t.name(b.name)}: ${recordStr(b)}, rating ${Math.round(b.rating)}, age ${b.age ?? "unknown"}, reach ${b.reachCm === null ? "unknown" : b.reachCm + "cm"}, KO rate ${Math.round(koView(b).rate * 100)}%.`,
        met.length ? `Previous meetings: ${met.length}; ${t.name(a.name)} won ${winsA}, ${t.name(b.name)} won ${winsB}.` : "They have not fought each other.",
      ],
      tables: [
        { id: "tape", title: t("Tale of the tape"), columns: ["", t.name(a.name), t.name(b.name)], rows: [
          row(t("Record"), recordStr(a), recordStr(b)), row(t("Rating"), String(Math.round(a.rating)), String(Math.round(b.rating))), row(t("Age"), orDash(a.age, String), orDash(b.age, String)),
          row(t("Reach"), orDash(a.reachCm, (n) => `${n}cm`), orDash(b.reachCm, (n) => `${n}cm`)), row(t("KO rate"), `${Math.round(koView(a).rate * 100)}%`, `${Math.round(koView(b).rate * 100)}%`),
          row(t("Win chance"), `${Math.round(p.pA * 100)}%`, `${Math.round(p.pB * 100)}%`)], note: undefined },
        ...(met.length ? [{ id: "meetings", title: t("Previous meetings"), columns: [t("Date"), t("Fight"), t("Result")], rows: met.slice(0, 5).map((x) => [fmtDate(x.date, { month: "short", year: "numeric" }, t.locale), boutCell(x, t), resultLine(w, x, t)]), note: undefined }] : []),
      ],
    };
  },
};

const rankings: Tool = {
  name: "rankings",
  about: "Current rankings: one division, or pound for pound when no division is given. Give `position` for one place in it (2 is the number two fighter).",
  args: [DIVISION, SEX, LIMIT, { name: "position", kind: "number", about: "one place in the ranking, 2 to 25, when the question asks who is number two, third best and so on", min: 2, max: 25 }],
  run({ w, t }, args) {
    const sex = args.sex === "female" ? "female" : "male";
    const division = (WEIGHT_CLASSES as readonly string[]).includes(String(args.division)) ? String(args.division) : undefined;
    const position = typeof args.position === "number" && args.position >= 2 ? Math.min(25, Math.round(args.position)) : undefined;
    const n = Math.max(take(args), position ?? 0);
    const rows = division ? rankDivision(w, division, n, sex).map((r) => r.boxer) : pound4pound(w, n, sex);
    if (!rows.length || (position !== undefined && rows.length < position)) return empty("rankings", args, t, t("Nobody is ranked there."));
    const title = division ? t("{division} rankings", { division: divisionLabel(division, sex, t) }) : t("Pound for pound");
    const at = rows[(position ?? 1) - 1];
    return {
      tool: "rankings", args,
      summary: position ? t("{title}: {name} is number {n} ({record}, rated {elo}).", { title, name: t.name(at.name), n: position, record: recordStr(at), elo: Math.round(at.rating) })
        : t("{title}: {name} is number one ({record}, rated {elo}).", { title, name: t.name(rows[0].name), record: recordStr(rows[0]), elo: Math.round(rows[0].rating) }),
      lines: [title, ...rows.map((b, i) => `${i + 1}. ${t.name(b.name)}: ${recordStr(b)}, rating ${Math.round(b.rating)}`)],
      tables: [{ id: "rankings", title, columns: ["#", t("Fighter"), t("Record"), t("Rating")], rows: rows.map((b, i) => [String(i + 1), boxerCell(b, t), recordStr(b), String(Math.round(b.rating))]), note: undefined }],
    };
  },
};

const champions: Tool = {
  name: "champions",
  about: "Who holds each belt right now (belts whose champion is active and defended in the last 18 months), optionally for one division. `by` orders the champions by age: the youngest or the oldest first.",
  args: [DIVISION, SEX, { name: "by", kind: "enum", about: "order the champions by age", values: ["youngest", "oldest"] }],
  run({ w, t }, args) {
    const sex = args.sex === "female" ? "female" : "male";
    const division = (WEIGHT_CLASSES as readonly string[]).includes(String(args.division)) ? String(args.division) : undefined;
    const rows = belts(w).filter((b) => b.sex === sex && b.current && !b.stale && (!division || b.division === division));
    if (!rows.length) return empty("champions", args, t, t("No live champions found there."));
    const line = (b: (typeof rows)[number]) => { const c = w.byId.get(b.current!.boxerId)!; return { c, b }; };
    const by = args.by === "youngest" || args.by === "oldest" ? args.by : undefined;
    if (by) {
      // the champions whose age the data gives, in the order asked (a champion with no known age is left out, not placed)
      const aged = rows.map((b) => ({ ...line(b) })).filter((x) => x.c.age !== null).sort((p, q) => (by === "youngest" ? p.c.age! - q.c.age! : q.c.age! - p.c.age!) || p.c.name.localeCompare(q.c.name));
      if (!aged.length) return empty("champions", args, t, t("The data gives no champion’s age."));
      const top = aged[0];
      return {
        tool: "champions", args,
        summary: by === "youngest" ? t("The youngest champion is {name}, {age}, who holds {belt}.", { name: t.name(top.c.name), age: top.c.age!, belt: beltLabel(top.b, t) }) : t("The oldest champion is {name}, {age}, who holds {belt}.", { name: t.name(top.c.name), age: top.c.age!, belt: beltLabel(top.b, t) }),
        lines: aged.slice(0, 25).map(({ c, b }) => `${t.name(c.name)}, age ${c.age}: ${beltLabel(b, t)} (${b.division})`),
        tables: [{ id: "champions", title: by === "youngest" ? t("Youngest champions") : t("Oldest champions"), columns: [t("Champion"), t("Age"), t("Belt"), t("Division")],
          rows: aged.slice(0, 25).map(({ c, b }) => [boxerCell(c, t), String(c.age), { text: beltLabel(b, t), href: `/titles/${b.slug}` }, divisionLabel(b.division, b.sex, t)]),
          note: rows.length > aged.length ? t("{n} champions are left out because the data gives no age for them.", { n: rows.length - aged.length }) : undefined }],
      };
    }
    return {
      tool: "champions", args,
      summary: t.n(rows.length, "{n} belt has a live champion. {first}", "{n} belts have live champions. {first}", { first: (() => { const { c, b } = line(rows[0]); return t("{belt}: {name}.", { belt: `${beltLabel(b, t)} (${divisionLabel(b.division, b.sex, t)})`, name: t.name(c.name) }); })() }),
      lines: rows.map((b) => { const { c } = line(b); return `${beltLabel(b, t)} (${b.division}): ${t.name(c.name)}, champion since ${b.current!.start}, ${b.current!.defenses.length} defences`; }),
      tables: [{ id: "champions", title: t("Current champions"), columns: [t("Belt"), t("Division"), t("Champion"), t("Since"), t("Defences")],
        rows: rows.slice(0, 25).map((b) => { const { c } = line(b); return [{ text: beltLabel(b, t), href: `/titles/${b.slug}` }, divisionLabel(b.division, b.sex, t), boxerCell(c, t), fmtDate(b.current!.start, { month: "short", year: "numeric" }, t.locale), String(b.current!.defenses.length)]; }),
        note: rows.length > 25 ? t("Showing 25 of {total}.", { total: rows.length }) : undefined }],
    };
  },
};

const bouts: Tool = {
  name: "bouts",
  about: "Search completed fights: by year, division, how it ended, title fights only, one fighter, minimum scheduled rounds; sorted by recency, fight score, fastest finish or knockdowns.",
  args: [
    { name: "year", kind: "number", about: "calendar year", min: 2000, max: 2100 }, DIVISION, { name: "method", kind: "enum", about: "how it ended; \"stoppage\" is KO, TKO or retirement and \"decision\" any decision", values: [...METHODS, "stoppage", "decision"] },
    { name: "title", kind: "boolean", about: "title fights only" }, { name: "fighter", kind: "string", about: "a fighter's name" }, { name: "minRounds", kind: "number", about: "scheduled for at least this many rounds", min: 1, max: 12 },
    { name: "sort", kind: "enum", about: "order (default recent)", values: ["recent", "fight score", "fastest", "knockdowns"] }, LIMIT,
  ],
  run(ctx, args) {
    const { w, t } = ctx;
    const year = typeof args.year === "number" ? String(Math.round(args.year)) : null;
    const fighterName = str(args, "fighter");
    const who = fighterName ? findFighter(ctx, fighterName) : undefined;
    if (fighterName && !who) return empty("bouts", args, t, t("No fighter found by that name."));
    const method = ([...METHODS, "stoppage", "decision"] as readonly string[]).includes(String(args.method)) ? String(args.method) : null;
    const howItEnded = (m: string | null) => (!method ? true : method === "stoppage" ? isStoppage(m) : method === "decision" ? isDecision(m) : m === method);
    const division = (WEIGHT_CLASSES as readonly string[]).includes(String(args.division)) ? String(args.division) : null;
    let list = done(w).filter((b) => (!year || b.date.startsWith(year)) && (!division || b.weightClass === division) && howItEnded(b.method) && (!args.title || !!b.title)
      && (!who || b.redId === who.id || b.blueId === who.id) && (typeof args.minRounds !== "number" || b.rounds >= args.minRounds));
    const sort = str(args, "sort") ?? "recent";
    const total = list.length;
    if (sort === "fight score") {
      const scored = list.map((b) => ({ b, s: fightScoreOf(w, b) ?? -1 })).filter((x) => x.s >= 0).sort((a, c) => c.s - a.s);
      list = scored.map((x) => x.b);
    } else if (sort === "fastest") list = list.filter((b) => secondsIn(b) !== null && ["KO", "TKO", "RTD"].includes(b.method!)).sort((a, c) => secondsIn(a)! - secondsIn(c)!);
    else if (sort === "knockdowns") list = list.filter((b) => b.kdRed + b.kdBlue > 0).sort((a, c) => c.kdRed + c.kdBlue - (a.kdRed + a.kdBlue));
    else list = [...list].sort((a, c) => c.date.localeCompare(a.date) || c.id - a.id);
    const top = list.slice(0, take(args));
    if (!top.length) return empty("bouts", args, t, t("No completed fights match that."));
    return {
      tool: "bouts", args,
      summary: t.n(total, "{n} fight matches. The first is {fight}, {result}.", "{n} fights match. The first is {fight}, {result}.", { fight: `${t.name(top[0].redName)} ${t("vs")} ${t.name(top[0].blueName)}`, result: resultLine(w, top[0], t) }),
      lines: [`${total} completed fights match; ordered by ${sort}.`, ...top.map((b) => `${b.date}: ${t.name(b.redName)} vs ${t.name(b.blueName)}, ${resultLine(w, b, t)}, ${methodLabel(b.method, b.endRound, t)}${b.title ? `, ${b.title}` : ""}`)],
      tables: [{ id: "bouts", title: t("Matching fights"), columns: [t("Date"), t("Fight"), t("Result"), t("Method")],
        rows: top.map((b) => [fmtDate(b.date, { month: "short", day: "numeric", year: "numeric" }, t.locale), boutCell(b, t), resultLine(w, b, t), methodLabel(b.method, b.endRound, t)]),
        note: total > top.length ? t("Showing {n} of {total}.", { n: top.length, total }) : undefined }],
    };
  },
};

const events: Tool = {
  name: "events",
  about: "The fight calendar: upcoming cards, or the most recent completed ones, with each card's main event. `when: all` or a `year` counts the completed cards (the latest are listed).",
  args: [{ name: "when", kind: "enum", about: "upcoming, recent, or all completed cards", values: ["upcoming", "recent", "all"] }, { name: "year", kind: "number", about: "count the completed cards of one calendar year", min: 2000, max: 2100 }, LIMIT],
  run({ w, t }, args) {
    const n = take(args);
    const year = typeof args.year === "number" ? Math.round(args.year) : undefined;
    if (args.when === "all" || year !== undefined) {
      const done = w.events.filter((e) => !e.upcoming && e.status !== "cancelled" && (year === undefined || e.date.startsWith(String(year)))).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      if (!done.length) return empty("events", args, t, t("No cards found."));
      const views = eventViews(w, done.slice(0, n));
      const label = (v: (typeof views)[number]) => `${t.name(v.red.name)} ${t("vs")} ${t.name(v.blue.name)}`;
      const latest = { event: t.name(done[0].name), date: fmtDate(done[0].date, undefined, t.locale) };
      return {
        tool: "events", args,
        summary: year !== undefined ? t.n(done.length, "There was {n} completed card in {year}; the latest was {event} on {date}.", "There were {n} completed cards in {year}; the latest was {event} on {date}.", { year, ...latest })
          : t.n(done.length, "There has been {n} completed card; the latest was {event} on {date}.", "There have been {n} completed cards; the latest was {event} on {date}.", latest),
        lines: [`${done.length} completed cards${year !== undefined ? ` in ${year}` : ""}.`, ...views.map((v) => `${v.event.date}: ${t.name(v.event.name)} in ${t.name(v.event.city)}; main event ${label(v)}`)],
        tables: [{ id: "events", title: t("Recent cards"), columns: [t("Date"), t("Event"), t("Main event"), t("City")],
          rows: views.map((v) => [fmtDate(v.event.date, { month: "short", day: "numeric", year: "numeric" }, t.locale), { text: t.name(v.event.name), href: `/events/${v.event.id}` }, label(v), t.name(v.event.city)]),
          note: done.length > views.length ? t("Showing {n} of {total}.", { n: views.length, total: done.length }) : undefined }],
      };
    }
    const upcoming = args.when !== "recent";
    const views = eventViews(w, upcoming ? upcomingEvents(w).slice(0, n) : recentEvents(w, n));
    if (!views.length) return empty("events", args, t, t("No cards found."));
    const label = (v: (typeof views)[number]) => `${t.name(v.red.name)} ${t("vs")} ${t.name(v.blue.name)}`;
    return {
      tool: "events", args,
      summary: upcoming ? t("The next card is {event} on {date}, headlined by {fight}.", { event: t.name(views[0].event.name), date: fmtDate(views[0].event.date, undefined, t.locale), fight: label(views[0]) })
        : t("The latest card was {event} on {date}, headlined by {fight}.", { event: t.name(views[0].event.name), date: fmtDate(views[0].event.date, undefined, t.locale), fight: label(views[0]) }),
      lines: views.map((v) => `${v.event.date}: ${t.name(v.event.name)} in ${t.name(v.event.city)}; main event ${label(v)}`),
      tables: [{ id: "events", title: upcoming ? t("Upcoming cards") : t("Recent cards"), columns: [t("Date"), t("Event"), t("Main event"), t("City")],
        rows: views.map((v) => [fmtDate(v.event.date, { month: "short", day: "numeric", year: "numeric" }, t.locale), { text: t.name(v.event.name), href: `/events/${v.event.id}` }, label(v), t.name(v.event.city)]), note: undefined }],
    };
  },
};

const fightOfYear: Tool = {
  name: "fight_of_the_year",
  about: "The fight of the year by the published fight score: one year's top fights, or each year's winner when no year is given.",
  args: [{ name: "year", kind: "number", about: "calendar year", min: 2000, max: 2100 }, LIMIT],
  run({ w, t }, args) {
    const n = take(args);
    if (typeof args.year === "number") {
      const list = topFightsOfYear(w, Math.round(args.year), n);
      if (!list.length) return empty("fight_of_the_year", args, t, t("No fights were scored for that year."));
      const top = list[0];
      const reasons = fightReasons(w, top, t, 3).map((r) => r.text);
      return {
        tool: "fight_of_the_year", args,
        summary: t("The best fight of {year} is {fight} (fight score {score}).", { year: Math.round(args.year), fight: `${t.name(top.bout.redName)} ${t("vs")} ${t.name(top.bout.blueName)}`, score: top.score }),
        lines: list.map((s, i) => `${i + 1}. ${t.name(s.bout.redName)} vs ${t.name(s.bout.blueName)}: score ${s.score}, ${resultLine(w, s.bout, t)}`).concat(reasons.map((r) => `Why #1: ${r}`)),
        tables: [{ id: "foty", title: t("Fight of the year {year}", { year: Math.round(args.year) }), columns: ["#", t("Fight"), t("Result"), t("Score")], rows: list.map((s, i) => [String(i + 1), boutCell(s.bout, t), resultLine(w, s.bout, t), String(s.score)]), note: undefined }],
      };
    }
    const winners = fightOfTheYear(w).slice(0, n);
    if (!winners.length) return empty("fight_of_the_year", args, t, t("No fights were scored."));
    return {
      tool: "fight_of_the_year", args,
      summary: t("Fight of the year, {year}: {fight}.", { year: winners[0].year, fight: `${t.name(winners[0].top.bout.redName)} ${t("vs")} ${t.name(winners[0].top.bout.blueName)}` }),
      lines: winners.map((x) => `${x.year}: ${t.name(x.top.bout.redName)} vs ${t.name(x.top.bout.blueName)} (score ${x.top.score})`),
      tables: [{ id: "foty-years", title: t("Fight of the year winners"), columns: [t("Year"), t("Fight"), t("Score")], rows: winners.map((x) => [String(x.year), boutCell(x.top.bout, t), String(x.top.score)]), note: undefined }],
    };
  },
};

const upsets: Tool = {
  name: "upset_watch",
  about: "Upcoming fights ranked by the underdog's chance of winning, with the reasons.",
  args: [{ name: "tier", kind: "enum", about: "live (28-40%), longshot (under 28%) or toss-up (40%+); omit for all", values: ["live", "longshot", "toss-up"] }, LIMIT],
  run({ w, t }, args) {
    const tier = ["live", "longshot", "toss-up"].includes(String(args.tier)) ? String(args.tier) : null;
    const list = upsetWatch(w, t).filter((x) => !tier || x.tier === tier).slice(0, take(args));
    if (!list.length) return empty("upset_watch", args, t, t("No upcoming fights to watch right now."));
    const x = list[0];
    return {
      tool: "upset_watch", args,
      summary: t("The likeliest upset: {name} has a {pct}% chance against {other}.", { name: t.name(x.underdog.name), pct: Math.round(x.chance * 100), other: t.name(x.favourite.name) }),
      lines: list.map((y) => `${t.name(y.underdog.name)} vs ${t.name(y.favourite.name)} on ${y.event.date}: underdog ${Math.round(y.chance * 100)}% (${y.tier}). ${y.signals.map((s) => s.text).join("; ")}`),
      tables: [{ id: "upsets", title: t("Upset watch"), columns: [t("Underdog"), t("Against"), t("Chance"), t("Date"), t("Why")],
        rows: list.map((y) => [boxerCell(y.underdog, t), boxerCell(y.favourite, t), `${Math.round(y.chance * 100)}% · ${t(TIER_LABEL[y.tier])}`, fmtDate(y.event.date, { month: "short", day: "numeric" }, t.locale), y.signals.slice(0, 2).map((s) => s.text).join(" · ")]), note: undefined }],
    };
  },
};

const trainers: Tool = {
  name: "trainers",
  about: "Head-trainer impact: the trainers with the largest estimated effect on their fighters' results, or one trainer by name. The estimates are uncertain and say so.",
  args: [{ name: "name", kind: "string", about: "a trainer's name" }, LIMIT],
  run({ w, t }, args) {
    const T = trainerImpact(w);
    const name = str(args, "name");
    if (name) {
      const q = normalize(name);
      const imp = T.all.filter((x) => normalize(x.person.name).includes(q) || q.includes(normalize(x.person.name)))[0];
      if (!imp) return empty("trainers", args, t, t("No head trainer found by that name."));
      const stable = personStable(w, imp.person.id, ["head_trainer"]);
      const ud = underdogRecordOf(w, imp.person.id);
      return {
        tool: "trainers", args,
        summary: t("{name}: estimated effect {effect} Elo against an average trainer ({verdict}); {fighters} fighters, {record} together.", { name: t.name(imp.person.name), effect: `${imp.effect >= 0 ? "+" : "−"}${Math.abs(Math.round(imp.effect))}`, verdict: t(VERDICT_LABEL[imp.verdict]).toLowerCase(), fighters: stable.fighters, record: `${stable.record.wins}-${stable.record.losses}-${stable.record.draws}` }),
        lines: [`${t.name(imp.person.name)}: estimated effect ${Math.round(imp.effect)} Elo (95% range ±${Math.round(1.96 * imp.se)}), ${imp.verdict}; ${imp.fights} fights of ${imp.fighters} fighters, ${imp.informative} informative.`, `Record together: ${stable.record.wins}-${stable.record.losses}-${stable.record.draws}.`, ud ? `As underdogs: ${ud.wins} wins in ${ud.underdogFights} fights, ${ud.expected.toFixed(1)} expected.` : ""].filter(Boolean),
        tables: [{ id: "trainer", title: t.name(imp.person.name), columns: [t("Effect (Elo)"), t("95% range"), t("Fighters"), t("Fights")], rows: [[`${Math.round(imp.effect)}`, `${Math.round(imp.effect - 1.96 * imp.se)} … ${Math.round(imp.effect + 1.96 * imp.se)}`, String(imp.fighters), String(imp.fights)]], note: t("Most trainers cannot be told from average; see how this is worked out.") }],
      };
    }
    const top = T.ranked.slice(0, take(args));
    if (!top.length) return empty("trainers", args, t, t("The data cannot separate any trainer from average."));
    return {
      tool: "trainers", args,
      summary: t("The trainer with the largest estimated effect is {name} ({effect} Elo, {verdict}); the ranges are wide, so treat this as a lean, not a ranking.", { name: t.name(top[0].person.name), effect: `+${Math.round(top[0].effect)}`, verdict: t(VERDICT_LABEL[top[0].verdict]).toLowerCase() }),
      lines: top.map((x, i) => `${i + 1}. ${t.name(x.person.name)}: ${Math.round(x.effect)} Elo (±${Math.round(1.96 * x.se)}), ${x.verdict}`),
      tables: [{ id: "trainers", title: t("Trainer impact"), columns: ["#", t("Trainer"), t("Effect (Elo)"), t("Verdict")], rows: top.map((x, i) => [String(i + 1), { text: t.name(x.person.name), href: `/people/${x.person.slug}` }, `${x.effect >= 0 ? "+" : "−"}${Math.abs(Math.round(x.effect))}`, t(VERDICT_LABEL[x.verdict])]), note: t("Estimates with wide error bars; most trainers cannot be told from average.") }],
    };
  },
};

const money: Tool = {
  name: "money",
  about: "Fight money leaderboards: highest gates, pay-per-view buys, purses or annual earners. Each figure has a basis (official, reported or estimated).",
  args: [{ name: "kind", kind: "enum", about: "which leaderboard", values: ["gates", "ppv", "purses", "earners"] }, LIMIT],
  run({ w, t }, args) {
    const n = take(args);
    const kind = ["gates", "ppv", "purses", "earners"].includes(String(args.kind)) ? String(args.kind) : "gates";
    const basis = (b: string) => t(b === "disclosed" ? "Official" : b === "reported" ? "Reported" : "Estimated");
    let rows: { who: Cell; value: string; basis: string }[] = [], title = "";
    if (kind === "gates" || kind === "ppv") {
      title = kind === "gates" ? t("Highest gates") : t("Most pay-per-view buys");
      rows = (kind === "gates" ? topGates(w, n) : topPpv(w, n)).map((e) => ({ who: { text: t.name(e.event.name), href: `/events/${e.event.id}` }, value: kind === "gates" ? usd(e.value) : e.value.toLocaleString("en-US"), basis: basis(e.prov.basis) }));
    } else if (kind === "purses") {
      title = t("Biggest purses");
      rows = topPurses(w, n).map((p) => ({ who: { text: `${t.name(p.boxer.name)} · ${t.name(p.event.name)}`, href: `/bouts/${p.bout.id}` }, value: usd(p.purse.totalUsd), basis: basis(p.purse.basis) }));
    } else {
      title = t("Highest earners");
      rows = topEarners(w, n).map((e) => ({ who: boxerCell(e.boxer, t), value: usd(e.total), basis: `${Math.round(e.disclosedShare * 100)}% ${t("official")}` }));
    }
    if (!rows.length) return empty("money", args, t, t("There is no money data of that kind."));
    const first = typeof rows[0].who === "string" ? rows[0].who : rows[0].who.text;
    return {
      tool: "money", args,
      summary: t("{title}: {who} leads with {value} ({basis}).", { title, who: first, value: rows[0].value, basis: rows[0].basis.toLowerCase() }),
      lines: [title, ...rows.map((r, i) => `${i + 1}. ${typeof r.who === "string" ? r.who : r.who.text}: ${r.value} (${r.basis})`)],
      tables: [{ id: "money", title, columns: ["#", t("Who"), t("Amount"), t("Basis")], rows: rows.map((r, i) => [String(i + 1), r.who, r.value, r.basis]), note: t("Every figure shows how it is known; estimated figures are approximate.") }],
    };
  },
};

export const TOOLS: Tool[] = [fighters, recordListTool, fighter, headToHead, rankings, champions, bouts, events, fightOfYear, upsets, trainers, money];
export const toolByName = (name: string): Tool | undefined => TOOLS.find((x) => x.name === name);

/** Keeps only the arguments a tool declares, coerced to their type and clamped; everything else (including anything a model made up) is dropped. */
export function sanitizeArgs(tool: Tool, raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const spec of tool.args) {
    const v = r[spec.name];
    if (v === undefined || v === null) continue;
    if (spec.kind === "string" && typeof v === "string" && v.trim()) out[spec.name] = v.trim().slice(0, 60);
    else if (spec.kind === "number" && typeof v === "number" && Number.isFinite(v)) out[spec.name] = Math.min(spec.max, Math.max(spec.min, v));
    else if (spec.kind === "boolean" && typeof v === "boolean") out[spec.name] = v;
    else if (spec.kind === "enum" && typeof v === "string" && spec.values.includes(v)) out[spec.name] = v;
  }
  return out;
}

