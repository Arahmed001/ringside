import { DASH } from "./facts";
import type { World } from "./world";
import { koView, recordStr } from "./world";
import type { BoutRow, BoxerFull, EventRow } from "./types";
import { divisionLabel } from "./divisions";
import { archetype } from "./style";
import { predict } from "./predict";
import { pairing } from "./matchmaking";
import { belts, beltLabel } from "./lineage";
import { countsInRecord } from "./methods";
import { countryName, fmtDate } from "./format";
import { missCount } from "./weights";
import { monthsWithCurrentTrainer } from "./team";
import { notRemembered } from "./ai-guard";
import { Lru } from "./lru";
import { rankDivision } from "./rankings";
import { eventMoney } from "./money";
import { tEn, type T } from "./i18n/t";
import { memo } from "./memo";

export interface TapeRow { label: string; red: string; blue: string; edge: "red" | "blue" | null }
export interface Ending { label: string; pct: number; side: "red" | "blue" | "even" }
export interface Form { boxer: BoxerFull; results: ("W" | "L" | "D")[]; line: string; last: string | null }

export interface Preview {
  bout: BoutRow; event: EventRow; red: BoxerFull; blue: BoxerFull;
  headline: string;
  standfirst: string;
  stakes: string[];
  tape: TapeRow[];
  form: Form[];
  style: string;
  pick: { favourite: BoxerFull; pct: number; confidence: string; pA: number; pB: number; pDraw: number; koProb: number; endings: Ending[] };
  factors: { label: string; note: string; shift: number }[];
  cases: { red: string[]; blue: string[] };
  meetings: BoutRow[];
  head2head: string;
  commonOpponents: number;
  watch: string[];
  where: string[];
  score: number;
  /** The same preview as three plain paragraphs: what the page shows when no AI writer is configured. */
  prose: string[];
  /** The facts an AI writer is given (and nothing else), in the reader's language. */
  facts: Record<string, unknown>;
}

const months = (w: World, d: string | null) => (d ? Math.max(0, Math.round((Date.parse(w.today + "T12:00:00Z") - Date.parse(d + "T12:00:00Z")) / (30.4 * 86400000))) : null);

function recent(w: World, b: BoxerFull, n = 5) {
  return (w.boutsByBoxer.get(b.id) ?? []).filter((x) => !x.upcoming && countsInRecord(x.method)).slice(-n);
}

/**
 * A written preview for a bout, built only from what the database knows: stakes and lineage, the tale of the tape, form,
 * styles, the model's pick and how it expects the fight to end, the cases for each corner, what to watch and where it airs.
 * Everything is a sentence in the reader's language (`t`); the paragraphs in `prose` are the no-AI version of the article.
 */
export function buildPreview(w: World, bout: BoutRow, t: T = tEn): Preview {
  const red = w.byId.get(bout.redId)!, blue = w.byId.get(bout.blueId)!;
  const event = w.eventById.get(bout.eventId)!;
  const name = (b: BoxerFull) => t.name(b.name);
  const p = predict(red, blue, t);
  const pair = pairing(w, red, blue, t);
  const division = divisionLabel(bout.weightClass, red.sex, t);

  // ---- stakes: the belt and its lineage, then what the matchmaking score noticed ----
  const stakes: string[] = [];
  let beltName: string | null = null;
  let beltLineAddsNothing = false; // the standfirst already says the belt is at stake; only a defence adds information (how many so far)
  if (bout.title) {
    const belt = belts(w).find((b) => b.orgId === bout.titleOrgId && b.title === bout.title && b.division === bout.weightClass && b.sex === red.sex);
    const label = belt ? beltLabel(belt, t) : t.name(bout.title);
    beltName = label;
    const champ = belt?.current && !bout.titleVacant ? w.byId.get(belt.current.boxerId) : undefined;
    if (bout.titleVacant || !champ) { stakes.push(t("The vacant {belt} is on the line.", { belt: label })); beltLineAddsNothing = true; }
    else if (champ.id === red.id || champ.id === blue.id) stakes.push(t.n(belt!.current!.defenses.length, "{name} defends the {belt}: {n} defence so far in a reign that began {date}.", "{name} defends the {belt}: {n} defences so far in a reign that began {date}.", { name: name(champ), belt: label, date: fmtDate(belt!.current!.start, { month: "short", year: "numeric" }, t.locale) }));
    else { stakes.push(t("The {belt} is on the line.", { belt: label })); beltLineAddsNothing = true; }
  }
  for (const r of pair.tagged) if (r.kind !== "competitive" && stakes.length < 4 && !stakes.includes(r.text)) stakes.push(r.text); // the odds get their own section

  // ---- tale of the tape ----
  const rankIn = (b: BoxerFull) => memo(w, `rankIndex:${b.sex}:${b.weightClass}`, () => new Map(rankDivision(w, b.weightClass, 200, b.sex).map((x) => [x.boxer.id, x.rank]))).get(b.id) ?? null;
  const edge = (a: number | null, b: number | null, higherBetter = true): "red" | "blue" | null => (a === null || b === null || a === b ? null : (a > b) === higherBetter ? "red" : "blue"); // no edge is claimed from a fact that is unknown
  const num = (n: number | null, f: (x: number) => string = String) => (n === null ? DASH : f(n));
  const ra = rankIn(red), rb = rankIn(blue);
  const mAgo = (b: BoxerFull) => months(w, b.lastFight);
  const tape: TapeRow[] = [
    { label: t("Record"), red: recordStr(red), blue: recordStr(blue), edge: edge(red.winRate, blue.winRate) },
    { label: t("Knockouts"), red: `${koView(red).kos} (${Math.round(koView(red).rate * 100)}%)`, blue: `${koView(blue).kos} (${Math.round(koView(blue).rate * 100)}%)`, edge: edge(koView(red).rate, koView(blue).rate) },
    { label: t("Elo rating"), red: String(Math.round(red.rating)), blue: String(Math.round(blue.rating)), edge: edge(red.rating, blue.rating) },
    { label: t("Division rank"), red: ra ? `#${ra}` : "–", blue: rb ? `#${rb}` : "–", edge: ra && rb ? edge(ra, rb, false) : null },
    { label: t("Age"), red: num(red.age), blue: num(blue.age), edge: edge(red.age, blue.age, false) },
    { label: t("Height"), red: num(red.heightCm, (n) => t("{n} cm", { n })), blue: num(blue.heightCm, (n) => t("{n} cm", { n })), edge: edge(red.heightCm, blue.heightCm) },
    { label: t("Reach"), red: num(red.reachCm, (n) => t("{n} cm", { n })), blue: num(blue.reachCm, (n) => t("{n} cm", { n })), edge: edge(red.reachCm, blue.reachCm) },
    { label: t("Stance"), red: red.stance ? t(red.stance) : DASH, blue: blue.stance ? t(blue.stance) : DASH, edge: null },
    { label: t("Style"), red: t(archetype(red)), blue: t(archetype(blue)), edge: null },
    { label: t("Last fought"), red: mAgo(red) === null ? "–" : t("{n} months ago", { n: mAgo(red)! }), blue: mAgo(blue) === null ? "–" : t("{n} months ago", { n: mAgo(blue)! }), edge: mAgo(red) !== null && mAgo(blue) !== null ? edge(mAgo(red)!, mAgo(blue)!, false) : null },
  ];

  // ---- form ----
  const form: Form[] = [red, blue].map((b) => {
    const last = recent(w, b);
    const results = last.map((x) => (x.winnerId === null ? "D" : x.winnerId === b.id ? "W" : "L")) as Form["results"];
    const wins = results.filter((r) => r === "W").length;
    const line = b.streak.type === "W" && b.streak.count >= 2 ? t("{name} is on a {n}-fight win streak.", { name: name(b), n: b.streak.count })
      : b.streak.type === "L" && b.streak.count >= 2 ? t("{name} has lost the last {n} fights.", { name: name(b), n: b.streak.count })
      : t("{name} has won {w} of the last {n} fights.", { name: name(b), w: wins, n: results.length });
    const lastBout = last[last.length - 1];
    const opp = lastBout ? (lastBout.redId === b.id ? lastBout.blueName : lastBout.redName) : null;
    const res = lastBout ? (lastBout.winnerId === null ? t("a draw") : lastBout.winnerId === b.id ? t("a win") : t("a loss")) : "";
    return { boxer: b, results, line, last: lastBout && opp ? t("Last fight: {result} against {opp}, {n} months ago.", { result: res, opp: t.name(opp), n: months(w, lastBout.date) ?? 0 }) : null };
  });

  // ---- how it might end ----
  const wA = p.pA * (0.3 + red.koRate), wB = p.pB * (0.3 + blue.koRate);
  const stopA = Math.min(p.pA * 0.95, p.koProb * (wA / (wA + wB))), stopB = Math.min(p.pB * 0.95, p.koProb * (wB / (wA + wB)));
  const endings: Ending[] = [
    { label: t("{name} by stoppage", { name: name(red) }), pct: stopA, side: "red" },
    { label: t("{name} on points", { name: name(red) }), pct: p.pA - stopA, side: "red" },
    { label: t("Draw"), pct: p.pDraw, side: "even" },
    { label: t("{name} on points", { name: name(blue) }), pct: p.pB - stopB, side: "blue" },
    { label: t("{name} by stoppage", { name: name(blue) }), pct: stopB, side: "blue" },
  ];
  const favourite = p.pA >= p.pB ? red : blue;
  const pct = Math.round(Math.max(p.pA, p.pB) * 100);

  // ---- style ----
  const sa = archetype(red), sb = archetype(blue);
  const styleParts = [t("{a} ({sa}) meets {b} ({sb}).", { a: name(red), sa: t(sa), b: name(blue), sb: t(sb) })];
  if (red.stance && blue.stance && red.stance !== blue.stance) styleParts.push(t("{a} fights {sa}, {b} fights {sb}: the angles will matter.", { a: name(red), sa: t(red.stance).toLowerCase(), b: name(blue), sb: t(blue.stance).toLowerCase() }));
  const gap = red.reachCm !== null && blue.reachCm !== null ? red.reachCm - blue.reachCm : 0;
  if (Math.abs(gap) >= 5) styleParts.push(t("{name} has a {n} cm reach advantage.", { name: name(gap > 0 ? red : blue), n: Math.abs(gap) }));
  const style = styleParts.join(" ");

  // ---- factors and the case for each corner ----
  const factors = [...p.factors].sort((x, y) => Math.abs(y.shift) - Math.abs(x.shift)).slice(0, 3).map((f) => ({ label: t(f.label), note: f.note, shift: f.shift }));
  const caseOf = (side: "red" | "blue"): string[] => {
    const b = side === "red" ? red : blue, o = side === "red" ? blue : red;
    const out = p.factors.filter((f) => (side === "red" ? f.shift > 0.004 : f.shift < -0.004)).sort((x, y) => Math.abs(y.shift) - Math.abs(x.shift)).map((f) => `${t(f.label)}: ${f.note}`);
    if (b.streak.type === "W" && b.streak.count >= 3) out.push(t("{n} wins in a row", { n: b.streak.count }));
    if (koView(b).rate >= 0.5 && koView(b).rate > koView(o).rate) out.push(t("Finishing power: {pct}% of wins by stoppage", { pct: Math.round(koView(b).rate * 100) }));
    if (b.bouts >= o.bouts + 8) out.push(t("More experience: {a} fights against {b}", { a: b.bouts, b: o.bouts }));
    return out.slice(0, 3);
  };

  // ---- head to head and common opponents ----
  const meetings = (w.boutsByBoxer.get(red.id) ?? []).filter((x) => !x.upcoming && x.method && x.method !== "NC" && (x.redId === blue.id || x.blueId === blue.id));
  const oppsOf = (b: BoxerFull) => new Set((w.boutsByBoxer.get(b.id) ?? []).filter((x) => !x.upcoming && x.method && x.method !== "NC").map((x) => (x.redId === b.id ? x.blueId : x.redId)));
  const oa = oppsOf(red), ob = oppsOf(blue);
  const commonOpponents = [...oa].filter((id) => ob.has(id) && id !== red.id && id !== blue.id).length;
  let head2head: string;
  if (!meetings.length) head2head = commonOpponents ? t.n(commonOpponents, "They have never met; they share {n} opponent.", "They have never met; they share {n} opponents.") : t("They have never met and have no opponent in common.");
  else {
    const last = meetings[meetings.length - 1];
    const winner = last.winnerId ? (last.winnerId === red.id ? red : blue) : null;
    head2head = winner ? t("They have met before: {name} won their last fight ({date}).", { name: name(winner), date: fmtDate(last.date, { month: "short", year: "numeric" }, t.locale) }) : t("They have met before and drew ({date}).", { date: fmtDate(last.date, { month: "short", year: "numeric" }, t.locale) });
  }

  // ---- things to watch ----
  const watch: string[] = [];
  for (const b of [red, blue]) {
    const idle = months(w, b.lastFight);
    if (idle !== null && idle >= 12) watch.push(t("{name} has been out for {n} months: ring rust is the question.", { name: name(b), n: idle }));
    if (b.age !== null && b.age >= 36) watch.push(t("{name} is {age}: how much is left?", { name: name(b), age: b.age }));
    if (b.bouts >= 6 && b.koLosses / Math.max(1, b.bouts) >= 0.2) watch.push(t("{name} has been stopped in {n} fights: the chin will be tested.", { name: name(b), n: b.koLosses }));
    const missed = missCount(w, b.id);
    if (missed > 0) watch.push(t.n(missed, "{name} has missed weight {n} time before: watch the scale.", "{name} has missed weight {n} times before: watch the scale.", { name: name(b) }));
    const tr = monthsWithCurrentTrainer(w, b.id);
    if (tr !== null && tr < 6) watch.push(t("{name} is working with a new trainer ({n} months).", { name: name(b), n: Math.round(tr) }));
  }
  if (bout.rounds >= 12 && red.avgRounds < 7 && blue.avgRounds < 7) watch.push(t("A {n}-round fight, but neither usually goes past round {r}: can they last?", { n: bout.rounds, r: Math.ceil(Math.max(red.avgRounds, blue.avgRounds)) }));
  if (p.koProb > 0.6) watch.push(t("The model gives a {pct}% chance that this ends before the final bell.", { pct: Math.round(p.koProb * 100) }));

  // ---- where it airs ----
  const where = eventMoney(w, event.id).broadcasts.map((b) => `${t.name(b.broadcaster)}${b.region ? ` · ${countryName(b.region, t.locale) !== b.region ? countryName(b.region, t.locale) : t.name(b.region)}` : ""}`);

  // ---- headline, standfirst, and the plain-prose version ----
  const v = { red: name(red), rr: recordStr(red), blue: name(blue), br: recordStr(blue), rounds: bout.rounds, division, venue: t.name(event.venue), city: t.name(event.city), date: fmtDate(event.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }, t.locale) };
  const headline = t("{red} vs {blue}: preview, prediction and what to watch", v);
  const standfirst = beltName
    ? t("{red} ({rr}) faces {blue} ({br}) in a {rounds}-round {division} fight for the {belt} at {venue}, {city}, on {date}.", { ...v, belt: beltName })
    : t("{red} ({rr}) faces {blue} ({br}) in a {rounds}-round {division} fight at {venue}, {city}, on {date}.", v);
  const pickLine = t("The model favours {name} at {pct}% ({confidence}), with a {ko}% chance of a stoppage.", { name: name(favourite), pct, confidence: t(p.confidence).toLowerCase(), ko: Math.round(p.koProb * 100) });
  const prose = [
    [standfirst, ...stakes.slice(beltLineAddsNothing ? 1 : 0, beltLineAddsNothing ? 3 : 2)].join(" "),
    [style, form[0].line, form[1].line, head2head].join(" "),
    [pickLine, factors[0] ? t("The biggest factor is {factor}: {note}.", { factor: factors[0].label.toLowerCase(), note: factors[0].note }) : "", watch[0] ?? ""].filter(Boolean).join(" "),
  ];

  const facts = {
    fight: { red: name(red), blue: name(blue), division, rounds: bout.rounds, date: event.date, venue: v.venue, city: v.city, belt: beltName, event: t.name(event.name) },
    stakes, tape: tape.map((r) => `${r.label}: ${r.red} | ${r.blue}`), form: form.map((f) => ({ fighter: name(f.boxer), last5: f.results.join(""), note: f.line, last: f.last })),
    style, head2head, pick: { favourite: name(favourite), percent: pct, confidence: p.confidence, stoppageChance: Math.round(p.koProb * 100) },
    factors: factors.map((f) => `${f.label}: ${f.note}`), watch, where,
  };
  return { bout, event, red, blue, headline, standfirst, stakes, tape, form, style, pick: { favourite, pct, confidence: p.confidence, pA: p.pA, pB: p.pB, pDraw: p.pDraw, koProb: p.koProb, endings }, factors, cases: { red: caseOf("red"), blue: caseOf("blue") }, meetings, head2head, commonOpponents, watch, where, score: pair.score, prose, facts };
}

// ---------- the written article: Claude when a key is set, the plain prose otherwise ----------
const cache = new Lru<string, { paragraphs: string[]; source: "ai" | "rules" }>(2000);

/** The preview as paragraphs. With ANTHROPIC_API_KEY, Claude writes it from the facts above (and only those); on any failure the plain version stands. */
export async function previewArticle(w: World, bout: BoutRow, t: T = tEn, client?: string): Promise<{ paragraphs: string[]; source: "ai" | "rules" }> {
  const key = `${bout.id}|${w.today}|${t.locale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pv = buildPreview(w, bout, t);
  let out: { paragraphs: string[]; source: "ai" | "rules" } = { paragraphs: pv.prose, source: "rules" };
  const ai = await import("./ai");
  let cacheable = true;
  if (ai.hasKey()) {
    try {
      const language = t.locale === "ar" ? " Write in clear Modern Standard Arabic, the way a Saudi sports desk would; keep names exactly as given in the facts and use Western digits (0-9)." : "";
      const text = await ai.claude(
        `You are a boxing writer producing a fight preview for a statistics site: three short paragraphs (170-230 words in total), plain text, no headings or lists. Use ONLY the facts in the JSON: do not invent results, quotes, injuries, opinions of third parties, odds or biography. Lead with the stakes, then the tape and form, then how it is likely to be won (cite the model's percentage as the model's view, not as certainty). Never claim anything about the future as fact.${language}`,
        JSON.stringify(pv.facts), 700, client,
      );
      const paragraphs = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
      if (paragraphs.length >= 2) out = { paragraphs, source: "ai" };
    } catch (e) { if (notRemembered(e)) cacheable = false; /* keep the plain version; a refused or failed call is not remembered */ }
  }
  if (cacheable) cache.set(key, out);
  return out;
}
