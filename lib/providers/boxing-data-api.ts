import { chooseByMode, previewModes, previewSelection, rankByRecency, selectionSizes, type ModePreview, type SelectionMode, type SelectionPreview } from "../vendor-selection";
import type { DataProvider, ProviderBoxer, ProviderBout, ProviderEvent, ProviderOfficialRanking, RankingBody } from "./index";
import fs from "node:fs";
import path from "node:path";
import type { Method, Stance } from "../types";
import { DIVISIONS, normalizeDivision } from "../divisions";
import { hasScorecards, hasWinner, normalizeMethod } from "../methods";
import { currentYear, nowMs, todayIso } from "../clock";

/**
 * Adapter for the Boxing Data API (boxing-data.com, via RapidAPI), written against its published docs
 * (https://boxing-data.com/docs/endpoints/fighters, /fights, /events) and then corrected by runs on the free plan's real
 * answers (location format, `birth_year`, reach in inches, the schedule 403, `date_to` required). The free plan covers only a few
 * weeks, so nothing here has been run against a full history; docs/real-data-readiness.md lists what to check. Nothing here scrapes any site.
 *
 * The feed has no corner colours, birth dates, round times, odds or card order, and some fields are loose (a free-text
 * `location`, a generic `PTS` result, no draw value). Wherever the mapping has to approximate, it does so the same way every
 * time and COUNTS it in `notes()`, so a reader can see how much of a feed rests on an assumption. A request budget is hard-wired
 * (the free tier is 100 a month). Storing the data is ON by default, as the owner decided while the vendor's answer on storage is
 * pending: every run says so (STORAGE_WARNING) until BOXING_API_STORAGE_CONFIRMED=1 records that the vendor agreed in writing, and
 * BOXING_API_STORAGE_CONFIRMED=0 switches storing off.
 */

// ---- the documented response shapes (only the fields used here) ----
interface Envelope<T> { error?: Record<string, unknown> | null; pagination?: { page?: number; total_pages?: number; next_page?: unknown }; data: T }
export interface ApiFighter {
  id: string; name?: string | null; nickname?: string | null; alias?: string | null; gender?: string | null;
  /** the docs' example has `age`; the real records have `birth_year` (seen on the first free-tier sample) */
  age?: number | null; birth_year?: number | null;
  nationality?: string | null; stance?: string | null; debut?: string | null;
  /** the real records give height and reach in several forms, and often only one of them */
  height_cm?: number | null; height_in?: number | null; height_ft?: string | null; height?: string | null;
  reach_cm?: number | null; reach_in?: number | null; reach?: string | null;
  stats?: { wins?: number | null; losses?: number | null; draws?: number | null; total_bouts?: number | null; ko_wins?: number | null; stopped?: number | null; total_rounds?: number | null } | null;
  division?: { id?: string | null; name?: string | null; weight_lb?: number | null } | null;
}
interface ApiSide { name?: string | null; full_name?: string | null; winner?: boolean | null; fighter_id?: string | null }
export interface ApiEvent { id?: string | null; title?: string | null; date?: string | null; location?: string | null; venue?: string | null; broadcasters?: { [country: string]: string }[] | null; poster_image_url?: string | null }
export interface ApiFight {
  id: string; title?: string | null; date?: string | null; location?: string | null; venue?: string | null; scheduled_rounds?: number | null;
  status?: string | null; fighters?: { fighter_1?: ApiSide | null; fighter_2?: ApiSide | null } | null;
  results?: { outcome?: string | null; round?: string | number | null } | null;
  /** the judges' scores, one string a card ("116-109"), when the scorecards were used (the docs' Fights page) */
  scores?: (string | null)[] | null;
  event?: ApiEvent | null; division?: { name?: string | null; id?: string | null } | null; titles?: { name?: string | null; id?: string | null }[] | null;
}

/** One page of `/v2/rankings/`: one division, one entry per sanctioning body (see the docs' Rankings page). */
export interface ApiRanking {
  organization?: { id?: string | null; name?: string | null; slug?: string | null } | null;
  division?: { id?: string | null; name?: string | null } | null;
  gender?: string | null; updated_at?: string | null;
  champions?: { fighter_id?: string | null; fighter_name?: string | null; title_type?: string | null; is_vacant?: boolean | null }[] | null;
  rankings?: { rank?: number | null; fighter_id?: string | null; fighter_name?: string | null; is_vacant?: boolean | null }[] | null;
}

/** Which of the four bodies a supplier's organisation is, by name or slug; `null` for anything else (a list we do not know is not shown). */
export function rankingBody(org: ApiRanking["organization"]): RankingBody | null {
  const t = `${org?.name ?? ""} ${org?.slug ?? ""}`.toLowerCase();
  if (/\bibf\b|international boxing federation/.test(t)) return "IBF";
  if (/\bwba\b|world boxing association/.test(t)) return "WBA";
  if (/\bwbc\b|world boxing council/.test(t)) return "WBC";
  if (/\bwbo\b|world boxing organi[sz]ation/.test(t)) return "WBO";
  return null;
}

/**
 * One page of rankings to our shape. A list is kept only for a body and a division we recognise, men's only (the supplier has no women's lists); a belt or place
 * with no holder is kept as vacant. Ranks that are not whole positive numbers are dropped, and a contender who appears twice keeps the better place.
 */
export function mapRanking(raw: ApiRanking, notes: Notes): ProviderOfficialRanking | null {
  const body = rankingBody(raw.organization);
  let division: string | null = null;
  try { division = raw.division?.name ? normalizeDivision(raw.division.name) : null; } catch { division = null; }
  if (!body || !division || (raw.gender && raw.gender.toLowerCase() !== "male")) { notes.rankingsSkipped++; return null; }
  const id = (x?: string | null) => (x ? fighterId(x) : null);
  const kind = (t?: string | null): "full" | "regular" | "interim" | null => (t === "full" || t === "regular" || t === "interim" ? t : null);
  const champions = (raw.champions ?? []).map((c) => ({
    boxerExternalId: c.is_vacant ? null : id(c.fighter_id), name: c.is_vacant ? null : c.fighter_name ?? null, titleType: kind(c.title_type), vacant: !!c.is_vacant || !c.fighter_id,
  }));
  const seen = new Set<string>();
  const contenders = (raw.rankings ?? [])
    .filter((c) => Number.isInteger(c.rank) && (c.rank as number) > 0)
    .sort((a, b) => (a.rank as number) - (b.rank as number))
    .map((c) => ({ rank: c.rank as number, boxerExternalId: c.is_vacant ? null : id(c.fighter_id), name: c.is_vacant ? null : c.fighter_name ?? null, vacant: !!c.is_vacant || !c.fighter_id }))
    .filter((c) => { if (!c.boxerExternalId) return true; if (seen.has(c.boxerExternalId)) return false; seen.add(c.boxerExternalId); return true; });
  return { body, division, sex: "male", updatedAt: raw.updated_at ?? null, champions, contenders };
}

/**
 * A division as the feed names it, or null. The champions importer must keep Bridgerweight (200 to 224 lb) apart from Heavyweight, because the title lineages are
 * separate; a fighter or a fight is not a title, and "over 200 lb" is the heavyweight limit, so here Bridgerweight and Super Heavyweight are Heavyweight rather than
 * a division the site does not list (which would drop the fighter, and every fight of his).
 */
export const divisionOf = (raw: string): string | null => normalizeDivision(raw) ?? (/^(?:bridger|super ?heavy)/.test(raw.toLowerCase().replace(/[\s.\-_]/g, "")) ? "Heavyweight" : null);

/** How often the mapping had to approximate. Every key is a count; zero means the feed supplied the fact itself. */
export type Notes = Record<
  | "ptsAsUnanimousDecision" | "drawInferred" | "resultMissing" | "liveTreatedAsUpcoming" | "fightsSkipped" | "boutsDroppedUnknownFighter" | "boutsOutsideSelection" | "stoppageWithoutWinner" | "drawDemoted" | "roundsRaisedToEnd" | "fightersDroppedNoDivision" | "boutsDroppedNoDivision"
  | "locationCountryInferred" | "locationRegionAmbiguous" | "scheduleUnavailable" | "upcomingUnavailable" | "rankingsUnavailable" | "rankingsSkipped" | "divisionFromFight" | "boutDivisionFromFighters" | "outcomeMapped" | "outcomeUnreadable" | "roundUnreadable" | "bothMarkedWinner" | "eventsWithoutFights" | "birthYearUnknown" | "physicalsConverted" | "debutUnknown" | "physicalsUnknown" | "stanceUnknown" | "locationUnparsed" | "divisionUnknown" | "windowTooBig",
  number
>;
const emptyNotes = (): Notes => ({
  ptsAsUnanimousDecision: 0, rankingsUnavailable: 0, rankingsSkipped: 0, drawInferred: 0, resultMissing: 0, liveTreatedAsUpcoming: 0, fightsSkipped: 0, boutsDroppedUnknownFighter: 0, boutsOutsideSelection: 0, stoppageWithoutWinner: 0, drawDemoted: 0, roundsRaisedToEnd: 0, fightersDroppedNoDivision: 0, boutsDroppedNoDivision: 0, locationCountryInferred: 0, locationRegionAmbiguous: 0, scheduleUnavailable: 0, upcomingUnavailable: 0,
  birthYearUnknown: 0, physicalsConverted: 0, debutUnknown: 0, physicalsUnknown: 0, stanceUnknown: 0, locationUnparsed: 0, divisionUnknown: 0, divisionFromFight: 0, boutDivisionFromFighters: 0, outcomeMapped: 0, outcomeUnreadable: 0, roundUnreadable: 0, bothMarkedWinner: 0, eventsWithoutFights: 0, windowTooBig: 0,
});

export const fighterId = (id: string) => `bda-f-${id}`;
export const eventId = (id: string) => `bda-e-${id}`;
export const boutId = (id: string) => `bda-b-${id}`;

/**
 * Regions the feed puts where a country would go ("Quebec City, Quebec" has no country at all), and the country they belong to.
 * A region that is also a country's name ("Georgia") is left alone and counted: the same text means Atlanta and Tbilisi.
 */
const REGIONS: Record<string, string> = {};
const region = (country: string, names: string) => names.split(",").forEach((n) => { REGIONS[n.trim().toLowerCase()] = country; });
region("United States", "Alabama, Alaska, Arizona, Arkansas, California, Colorado, Connecticut, Delaware, Florida, Hawaii, Idaho, Illinois, Indiana, Iowa, Kansas, Kentucky, Louisiana, Maine, Maryland, Massachusetts, Michigan, Minnesota, Mississippi, Missouri, Montana, Nebraska, Nevada, New Hampshire, New Jersey, New Mexico, New York, North Carolina, North Dakota, Ohio, Oklahoma, Oregon, Pennsylvania, Rhode Island, South Carolina, South Dakota, Tennessee, Texas, Utah, Vermont, Virginia, Washington, West Virginia, Wisconsin, Wyoming, District of Columbia");
region("Canada", "Alberta, British Columbia, Manitoba, New Brunswick, Newfoundland and Labrador, Nova Scotia, Ontario, Prince Edward Island, Quebec, Québec, Saskatchewan, Yukon, Northwest Territories, Nunavut");
region("United Kingdom", "England, Scotland, Wales, Northern Ireland");
region("Australia", "New South Wales, Victoria, Queensland, Western Australia, South Australia, Tasmania, Northern Territory, Australian Capital Territory");
region("Mexico", "Aguascalientes, Baja California, Baja California Sur, Campeche, Chiapas, Chihuahua, Coahuila, Colima, Durango, Guanajuato, Guerrero, Hidalgo, Jalisco, Michoacán, Morelos, Nayarit, Nuevo León, Oaxaca, Puebla, Querétaro, Quintana Roo, San Luis Potosí, Sinaloa, Sonora, Tabasco, Tamaulipas, Tlaxcala, Veracruz, Yucatán, Zacatecas, Ciudad de México, Estado de México");
const AMBIGUOUS_REGIONS = new Set(["georgia"]);

/** "Quebec City, Quebec" -> city "Quebec City", country Canada; "Las Vegas, Nevada, United States" -> "Las Vegas", "United States". The feed's text is "City, Region" or "City, Country", so the last part is looked up as a region first; anything else is taken as the country, and what cannot be split is counted. */
export function parseLocation(raw: string | null | undefined, notes: Notes): { city: string; country: string } {
  const parts = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) { notes.locationUnparsed++; return { city: parts[0] ?? "Unknown", country: "Unknown" }; }
  const last = parts[parts.length - 1], key = last.toLowerCase();
  if (AMBIGUOUS_REGIONS.has(key)) notes.locationRegionAmbiguous++;
  else if (REGIONS[key]) { notes.locationCountryInferred++; return { city: parts[0], country: REGIONS[key] }; }
  return { city: parts[0], country: last };
}

const DECISIONS = new Set(["UD", "MD", "SD", "PTS"]);

/** The judges' scores that are really scores: "116-109" (two whole numbers, a hyphen or a dash). Anything else is dropped; at most three cards. */
export function cleanScores(raw: (string | null)[] | null | undefined): string[] {
  return (raw ?? []).map((x) => (typeof x === "string" ? x.trim().replace(/[–—]/g, "-") : "")).filter((x) => /^\d{1,3}-\d{1,3}$/.test(x)).slice(0, 3);
}

/** Career knockouts and times stopped from a stats block, each only when it is a whole number no larger than the wins or losses it is part of (a total that contradicts its own record is not used). */
export function careerTotals(s: NonNullable<ApiFighter["stats"]>): { koWins?: number; stopped?: number } {
  const ok = (x: unknown, of: number | null | undefined): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && typeof of === "number" && x <= of;
  return { ...(ok(s.ko_wins, s.wins) ? { koWins: s.ko_wins } : {}), ...(ok(s.stopped, s.losses) ? { stopped: s.stopped } : {}) };
}

/** One fight -> a bout, the event it belongs to, and the two fighter ids to fetch. Null when it has no date or fewer than two fighters. */
export function mapFight(f: ApiFight, notes: Notes, index = 0): { bout: ProviderBout; event: ProviderEvent; fighterIds: [string, string] } | null {
  const a = f.fighters?.fighter_1, b = f.fighters?.fighter_2;
  const date = (f.event?.date ?? f.date ?? "").slice(0, 10); // a UTC calendar date: an evening card in the Americas can land a day late (see the readiness doc)
  if (!f.id || !a?.fighter_id || !b?.fighter_id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { notes.fightsSkipped++; return null; }
  if (a.fighter_id === b.fighter_id) { notes.fightsSkipped++; return null; } // a fighter cannot fight himself: a feed slip, not a fight

  const loc = parseLocation(f.event?.location ?? f.location, notes);
  const eId = f.event?.id ? eventId(f.event.id) : `bda-e-fight-${f.id}`;
  const event: ProviderEvent = {
    externalId: eId, name: f.event?.title ?? f.title ?? "Boxing card", date, venue: f.event?.venue ?? f.venue ?? loc.city, city: loc.city, country: loc.country,
    ...(f.event?.poster_image_url ? { posterUrl: f.event.poster_image_url } : {}),
    ...(f.event?.broadcasters?.length ? { broadcaster: Object.values(f.event.broadcasters[0])[0] } : {}),
  };

  const finished = f.status === "FINISHED";
  if (f.status === "LIVE") notes.liveTreatedAsUpcoming++;
  const outcome = finished ? (f.results?.outcome ?? null) : null;
  // both fighters marked the winner: a feed slip. Neither is picked (that would be inventing a result) and the fight is left "no result yet", not read as a draw
  const bothMarked = finished && !!a.winner && !!b.winner;
  if (bothMarked) notes.bothMarkedWinner++;
  const winner = finished && !bothMarked ? (a.winner ? a : b.winner ? b : null) : null;
  let method: Method | null = null;
  if (finished && outcome && !bothMarked) {
    if (outcome === "PTS") { method = "UD"; notes.ptsAsUnanimousDecision++; }
    else if (outcome === "UD" || outcome === "MD" || outcome === "SD" || outcome === "KO" || outcome === "TKO") method = outcome;
    else { const m = normalizeMethod(outcome); if (m) { method = m; notes.outcomeMapped++; } } // "DQ", "RTD", "Technical Decision", "No Contest"...: the words the feed's own list does not show but a real feed has
  }
  // a decision with no winner is a draw; a finished fight with neither a winner nor an outcome is left "no result yet" rather than guessed
  if (finished && !bothMarked && !winner && outcome && DECISIONS.has(outcome)) { method = "DRAW"; notes.drawInferred++; }
  // a result that needs a winner and has none (a knockout, a disqualification...) is a feed slip (the validator rejects it): left as no result rather than a winner guessed
  if (finished && !winner && method && hasWinner(method)) { method = null; notes.stoppageWithoutWinner++; }
  if (finished && !bothMarked && !winner && !method) notes.resultMissing++;
  // the other way round: a winner with an outcome the feed gave no readable word for, or one that says there was no winner (a draw, a no-contest). The validator would reject the
  // fight and both fighters would lose a real result; it stays in their history as "no result yet", with no winner named, and is counted
  let winnerOf = winner;
  if (winner && (!method || !hasWinner(method))) { winnerOf = null; method = null; notes.outcomeUnreadable++; }
  const rawRound = f.results?.round === null || f.results?.round === undefined ? NaN : parseInt(String(f.results.round), 10);
  const round = Number.isFinite(rawRound) && rawRound >= 1 ? rawRound : NaN; // round 0 or below is not a round (the validator rejects the fight): the end round is unknown
  if (Number.isFinite(rawRound) && !Number.isFinite(round)) notes.roundUnreadable++;
  let rounds = f.scheduled_rounds && f.scheduled_rounds > 0 ? f.scheduled_rounds : 10;
  const endRound = !method ? null : method === "KO" || method === "TKO" ? (Number.isFinite(round) ? round : null) : Number.isFinite(round) ? round : rounds;

  // a fight that ended after its scheduled rounds ("round 12 of 10") had more rounds scheduled than the feed says
  if (endRound !== null && endRound > rounds) { rounds = endRound; notes.roundsRaisedToEnd++; }
  const divName = f.division?.name ?? "";
  const weightClass = divisionOf(divName) ?? (divName || "Unknown");
  if (!divisionOf(divName)) notes.divisionUnknown++;
  const bout: ProviderBout = {
    externalId: boutId(f.id), eventExternalId: eId, redExternalId: fighterId(a.fighter_id), blueExternalId: fighterId(b.fighter_id), // no corner colours in the feed: fighter_1 is "red"
    weightClass, rounds, winnerExternalId: winnerOf ? fighterId(winnerOf.fighter_id!) : null, method, endRound,
    title: f.titles?.[0]?.name ?? null, position: index, // card order is not in the feed: the order the fights came back in
  };
  const scores = finished && hasScorecards(method) ? cleanScores(f.scores) : []; // only a fight that went to the cards has scores: a stoppage with scores attached is a feed slip, not a result
  if (scores.length) bout.scores = scores;
  return { bout, event, fighterIds: [a.fighter_id, b.fighter_id] };
}

const STANCES: Record<string, Stance> = { orthodox: "Orthodox", southpaw: "Southpaw", switch: "Switch", ambidextrous: "Switch" };

/** Centimetres from whichever form the feed gave: cm, inches, a feet-and-inches string like 6'1", or the docs' combined text like `6' 9" / 206 cm`. */
export function lengthCm(cm: number | null | undefined, inches: number | null | undefined, text: string | null | undefined, notes: Notes): number | null {
  if (typeof cm === "number" && cm > 0) return Math.round(cm);
  if (typeof inches === "number" && inches > 0) { notes.physicalsConverted++; return Math.round(inches * 2.54); }
  const t = text ?? "";
  const metric = t.match(/(\d{2,3}(?:\.\d+)?)\s*cm/i);
  if (metric) { notes.physicalsConverted++; return Math.round(Number(metric[1])); }
  const ft = t.match(/(\d)\s*'\s*(\d{1,2})?/);
  if (ft) { notes.physicalsConverted++; return Math.round((Number(ft[1]) * 12 + Number(ft[2] ?? 0)) * 2.54); }
  const inch = t.match(/(\d{2,3}(?:\.\d+)?)\s*(?:"|in\b)/i);
  if (inch) { notes.physicalsConverted++; return Math.round(Number(inch[1]) * 2.54); }
  return null;
}

/**
 * A fighter -> a boxer. A fact the feed does not give is null, never a guess: no birth year from an age (it can be a year out), no stance, height or reach
 * filled in from a median, no debut year taken from the first fight we happen to hold. Each is counted in the notes, so the load says how much is unknown.
 */
export function mapFighter(f: ApiFighter, notes: Notes): ProviderBoxer | null {
  if (!f.id || !f.name) return null;
  let birthYear: number | null = null;
  if (Number.isInteger(f.birth_year) && f.birth_year! >= 1900 && f.birth_year! <= currentYear() - 10) birthYear = f.birth_year!; // the feed's own birth year
  else notes.birthYearUnknown++;
  const stance = STANCES[(f.stance ?? "").toLowerCase()] ?? null;
  if (!stance) notes.stanceUnknown++;
  const debut = parseInt(String(f.debut ?? ""), 10);
  const turnedPro = Number.isFinite(debut) && debut >= 1900 && debut <= currentYear() ? debut : null;
  if (turnedPro === null) notes.debutUnknown++;
  const heightCm = lengthCm(f.height_cm, f.height_in, f.height_ft ?? f.height, notes), reachCm = lengthCm(f.reach_cm, f.reach_in, f.reach, notes);
  if (heightCm === null || reachCm === null) notes.physicalsUnknown++;
  const div = f.division?.name ?? "";
  return {
    externalId: fighterId(f.id), name: f.name, ...(f.nickname || f.alias ? { nickname: (f.nickname ?? f.alias)! } : {}),
    country: f.nationality ?? "Unknown", birthYear, stance, sex: (f.gender ?? "").toLowerCase().startsWith("f") ? "female" : "male",
    heightCm, reachCm, weightClass: divisionOf(div) ?? (div || "Unknown"),
    turnedPro, active: false, // settled in `finishBoxers`, which can see the fights
  };
}

type Loose = ProviderBoxer;

/**
 * A fight whose division the feed does not give, or gives as something Ringside has no division for ("Catchweight", "Open weight"), takes the division of its
 * fighters (the heavier, when the two are in different ones: a catchweight fight is usually made between two divisions). Without this the validator rejects the
 * fight, and both fighters lose a real result from their record, their form and their rating. Only a fight where neither fighter has a division stays unplaced.
 */
export function placeBouts(bouts: ProviderBout[], boxers: ProviderBoxer[], notes: Notes): ProviderBout[] {
  const index = new Map(DIVISIONS.map((d, i) => [d.name, i] as const));
  const classOf = new Map(boxers.map((r) => [r.externalId, normalizeDivision(r.weightClass)] as const));
  return bouts.map((b) => {
    if (normalizeDivision(b.weightClass)) return b;
    const known = [classOf.get(b.redExternalId), classOf.get(b.blueExternalId)].filter((x): x is string => !!x);
    if (!known.length) return b;
    notes.boutDivisionFromFighters++;
    return { ...b, weightClass: known.sort((x, y) => (index.get(y) ?? 0) - (index.get(x) ?? 0))[0] };
  });
}

/** Settles `active` (fought in the last 30 months, or has a fight coming up) and a missing division (taken from the fighter's latest fight), which need the fights. */
export function finishBoxers(rows: Loose[], bouts: ProviderBout[], eventDates: Map<string, string>, notes: Notes): ProviderBoxer[] {
  const last = new Map<string, string>(), lastClass = new Map<string, string>();
  for (const b of bouts) {
    const d = eventDates.get(b.eventExternalId);
    if (!d) continue;
    for (const id of [b.redExternalId, b.blueExternalId]) {
      if (!last.has(id) || d > last.get(id)!) { last.set(id, d); if (normalizeDivision(b.weightClass)) lastClass.set(id, b.weightClass); }
    }
  }
  // a fighter the feed gives no division for (the validator rejects "Unknown") fights at a known one: the division of their most recent fight
  rows = rows.map((r) => {
    if (normalizeDivision(r.weightClass) || !lastClass.has(r.externalId)) return r;
    notes.divisionFromFight++;
    return { ...r, weightClass: lastClass.get(r.externalId)! };
  });
  const cutoff = new Date(nowMs() - 30 * 30.4 * 86400000).toISOString().slice(0, 10);
  return rows.map((r) => ({ ...r, active: (last.get(r.externalId) ?? "") >= cutoff }));
}

// ---- the client ----
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
/**
 * A decision with no winner is taken as a draw by `mapFight`, but the feed also leaves the winner out of fights it has not settled (a result not yet posted,
 * a no contest): a draw the vendor never recorded then shows up as a conflict ("loaded 0-0-1, vendor 18-0-0"). So a drawn fight is kept only where each fighter's
 * career record has room for it: the vendor's draws, counted fight by fight, never exceeded. A fighter with no career record cannot be checked, and keeps the
 * draw. A demoted fight is "no result yet", as a decision with no outcome at all already is, and is counted as `drawDemoted`.
 */
export function demoteUnsupportedDraws(bouts: ProviderBout[], vendor: Map<string, CareerRecord>, notes: Notes): ProviderBout[] {
  const used = new Map<string, number>();
  const room = (id: string) => { const v = vendor.get(id); return !v || (used.get(id) ?? 0) < v.draws; };
  return bouts.map((b) => {
    if (b.method !== "DRAW") return b;
    if (!room(b.redExternalId) || !room(b.blueExternalId)) {
      notes.drawDemoted++;
      const { scores: _scores, ...rest } = b; void _scores;
      return { ...rest, method: null, endRound: null };
    }
    for (const id of [b.redExternalId, b.blueExternalId]) used.set(id, (used.get(id) ?? 0) + 1);
    return b;
  });
}

export class BudgetError extends Error {}

/**
 * A stand-in for `fetch` that answers from responses saved by `rawDir` (the files `001-v2_fights.json`, `002-v2_fighters_<id>.json`, ...),
 * so a mapping can be changed and re-run over real responses without spending a single request. A request with no saved answer is a 404.
 */
export function replayFetch(dir: string): typeof fetch {
  const queues = new Map<string, string[]>(), served = new Map<string, number>();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const key = f.replace(/^\d+-/, "").replace(/\.json$/, "");
    queues.set(key, [...(queues.get(key) ?? []), f]);
  }
  return (async (input: string | URL | Request) => {
    const key = new URL(String(input)).pathname.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
    const i = served.get(key) ?? 0, file = queues.get(key)?.[i];
    if (!file) return new Response(JSON.stringify({ message: "not in the saved responses" }), { status: 404 });
    served.set(key, i + 1);
    return new Response(fs.readFileSync(path.join(dir, file), "utf8"), { status: 200 });
  }) as typeof fetch;
}
/** An HTTP failure from the API, with the status so the caller can tell "not on your plan" from "broken". The message carries the vendor's own explanation. */
export class HttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export interface BoxingDataApiOptions {
  key: string; baseUrl?: string; fetchImpl?: typeof fetch;
  /** Hard cap on requests per load (the free tier is 100 a month). Default 90. A retry counts as a request, as it does for the vendor. */
  maxRequests?: number; pageSize?: number; since?: string; /** documents reachable by page number (the docs say 10,000): a list longer than that is read in date windows. Default 10,000. */ offsetLimit?: number; maxFights?: number; /** days of upcoming fights to include (default 60; 0 for none) */ scheduleDays?: number; gapMs?: number; /** save every raw response here, so a mapping can be fixed offline without spending more requests */ rawDir?: string; log?: (m: string) => void;
  /**
   * A read-through cache of every successful response (the backfill's checkpoint): a re-run after a crash, a rate limit or a closed laptop
   * costs only the requests that never completed, and a mapping fix costs none. This is vendor data on disk, so it is only for "ingest"
   * (storage confirmed) or an evaluation you are keeping out of git.
   */
  cacheDir?: string;
  /** with cacheDir: ignore what is cached and fetch again (and overwrite it) */
  refresh?: boolean;
  /** with cacheDir: ignore cached fight-list pages (a daily update must see today's results) but still reuse cached fighters */
  refreshLists?: boolean;
  /** extra attempts after a 429, a 500/502/503/504 or a network failure, waiting out Retry-After or backing off 1, 2, 4 ... seconds (max 30). Default 0. */
  retries?: number;
  /**
   * Never send more than this many requests an hour: they are spaced evenly (3,600,000 / perHour ms apart, or `gapMs` if that is longer). The first real
   * run showed the plan has its own limit per hour, set by the API provider, well below what the default spacing would send.
   */
  perHour?: number;
  /**
   * Fetch only this many fighters: the ones with the most recent (or coming) fight first. The fights between two of them are loaded and no others, so a
   * first load of a few thousand fighters is a league that holds together, in hours instead of days; a later run with a larger number (or none) only
   * fetches the rest, the first ones being in the cache. Unset: every fighter in the list.
   */
  maxFighters?: number;
  /** how `maxFighters` chooses: the most recently active (default), those and all their opponents, or whole groups of fighters (see lib/vendor-selection.ts) */
  selectMode?: SelectionMode;
  /**
   * When the gateway refuses with a rate limit (a 429 that is not a used-up quota), wait and try the same request again, for up to this many ms in all for
   * that request: 1, 2, 5, then 10 minutes at a time (or the Retry-After it gives). A refusal that says the quota is used up is never waited for: it ends
   * the run at once with the vendor's own words. Default 0 (give up after `retries`). Everything fetched so far is in the cache either way.
   */
  patienceMs?: number;
  /** replaces the real wait, for tests */
  sleep?: (ms: number) => Promise<void>;
  /** "evaluation" fetches a sample for `npm run data:check`; "ingest" fills the database (refused only when BOXING_API_STORAGE_CONFIRMED=0). */
  purpose: "evaluation" | "ingest";
}
export interface BackfillPlan {
  /** fights, events and distinct fighters the list pages came to */
  fights: number; events: number; fighters: number;
  /** fighters already in the cache, and so free */
  fightersCached: number;
  /** requests still to make for the fighters (the list pages are already done by the time this is known) */
  fighterRequests: number;
  /** requests made so far (list pages) */
  requestsMade: number;
  /** what taking only the most recently active fighters would give, for a few sizes (from the fight list alone; nothing is fetched to know it) */
  selection?: SelectionPreview[];
  /** what the other two ways of choosing (`--with-opponents`, `--whole-groups`) would ask for at the same sizes */
  modes?: ModePreview[];
  /** set when `maxFighters` is in force: fighters, fighterRequests and fightersCached then count only the chosen ones, and this is how many the list holds */
  allFighters?: number;
}
/** A fighter's career record as the vendor states it (wins, losses, draws): the only independent figure in the feed to check the loaded fights against. */
export interface CareerRecord { wins: number; losses: number; draws: number }
export interface BoxingDataApiProvider extends DataProvider {
  notes(): Notes; requests(): number; cacheHits(): number;
  /** Bytes downloaded from the vendor so far (answers served from the cache are not counted): the plan's bandwidth is metered. */
  bytes(): number;
  /** Career records the vendor gave, by our fighter id (`bda-f-...`), for fighters that came with all three numbers. */
  vendorRecords(): Map<string, CareerRecord>;
  /** Fetches the fight list pages only and says what the fighters will cost, without fetching them: "what will this backfill cost" before it is spent. */
  plan(): Promise<BackfillPlan>;
}

/** the pace a run adopts after a rate-limit refusal when it was given no `perHour`: under the Mega plan's 500 an hour, with room for what else was asked in the same hour */
const AUTO_PER_HOUR = 400;
const backoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);
/** how long to wait after the 1st, 2nd, 3rd ... rate-limit refusal of one request when the gateway names no time (the last step repeats) */
const RATE_STEPS_MS = [60_000, 120_000, 300_000, 600_000];
/** a refusal that says an allowance is used up (monthly, daily): waiting an hour will not help */
const QUOTA_USED = /\b(monthly|daily|weekly)\b|quota/i;
const slug = (x: string) => x.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");

/** Said on every run that stores data while the vendor has not yet confirmed that it may be kept. */
export const STORAGE_WARNING = "Storing the vendor's data PROVISIONALLY: it has not yet confirmed in writing that stored data may be kept (docs/boxing-data-api-enquiry.md). If it says no, delete the cache and the database (docs/real-data-runbook.md, \"Undoing it\"). Set BOXING_API_STORAGE_CONFIRMED=1 once it agrees, or =0 to refuse to store.";
/**
 * Whether the vendor's data may be stored: "confirmed" (BOXING_API_STORAGE_CONFIRMED=1) or "provisional" (the default, until the vendor's answer
 * comes). Throws when storing is switched off (=0). Callers that do other work first (open a database) call this first.
 */
export function storageStatus(): "confirmed" | "provisional" {
  const v = process.env.BOXING_API_STORAGE_CONFIRMED;
  if (v === "0") throw new Error("Storing the Boxing Data API's data is switched off (BOXING_API_STORAGE_CONFIRMED=0). Unset it to store provisionally, or set it to 1 once the vendor has confirmed in writing. A sample can still be evaluated with `npm run vendor:sample`.");
  return v === "1" ? "confirmed" : "provisional";
}

/**
 * An API key is printable ASCII with no spaces, and a real one is long (RapidAPI's are about 50 characters). Anything else (a space, an accent,
 * an ellipsis "…", or a stand-in like "..." or "your-key") is a placeholder pasted by mistake; sending it fails with a cryptic message deep inside
 * the HTTP library, or a 403 that looks like a bad plan. The length is only checked when the key will go to a real server (no injected fetch).
 */
export const MIN_KEY_LENGTH = 16;
export function assertPlausibleKey(key: string, willBeSent = true): void {
  if (!/^[\x21-\x7e]+$/.test(key) || (willBeSent && key.length < MIN_KEY_LENGTH)) {
    throw new Error("BOXING_API_KEY is not a plausible API key (it has a space, an accent or an ellipsis such as `…`, or it is too short): it looks like a placeholder was pasted instead of the real key (a real one is about 50 characters). Set the real one with `read -s \"BOXING_API_KEY?RapidAPI key: \"; export BOXING_API_KEY` (docs/real-data-runbook.md).");
  }
}

export function boxingDataApiProvider(o: BoxingDataApiOptions): BoxingDataApiProvider {
  assertPlausibleKey(o.key, !o.fetchImpl);
  if (o.purpose === "ingest" && storageStatus() === "provisional") (o.log ?? (() => {}))(STORAGE_WARNING);
  const base = (o.baseUrl ?? "https://boxing-data-api.p.rapidapi.com").replace(/\/+$/, "");
  const host = new URL(base).host;
  const doFetch = o.fetchImpl ?? fetch;
  const max = o.maxRequests ?? 90, log = o.log ?? (() => {});
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let used = 0, hits = 0, downloaded = 0, notes = emptyNotes(), cache: Promise<{ boxers: ProviderBoxer[]; events: ProviderEvent[]; bouts: ProviderBout[] }> | null = null;
  let listed: Promise<{ events: Map<string, ProviderEvent>; bouts: ProviderBout[]; ids: Set<string> }> | null = null;
  const careers = new Map<string, CareerRecord>();
  /** set by the first rate-limit refusal of a run that was given no `perHour`: the run paces itself from then on (see AUTO_PER_HOUR) */
  let autoPerHour: number | undefined;

  /** The vendor's own reason for a refusal ("not subscribed", "invalid key", "endpoint not on your plan"), with the key scrubbed out. */
  async function explain(res: Response): Promise<string> {
    const text = (await res.text().catch(() => "")).trim();
    let msg = text;
    try { const j = JSON.parse(text) as { message?: unknown; error?: unknown }; msg = String(j.message ?? (j.error && JSON.stringify(j.error)) ?? text); } catch { /* not JSON: use the text */ }
    return (msg.split(o.key).join("***").replace(/\s+/g, " ").slice(0, 200)) || "no explanation given";
  }

  const cacheFile = (p: string, params: Record<string, string | number | undefined>) => {
    const q = Object.entries(params).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}-${v}`).join("__");
    return path.join(o.cacheDir!, `${slug(p)}${q ? `__${slug(q)}` : ""}.json`);
  };
  const fromCache = <T,>(file: string): Envelope<T> | undefined => {
    try { return JSON.parse(fs.readFileSync(file, "utf8")) as Envelope<T>; } catch { return undefined; } // missing or half-written: fetch it again
  };
  const toCache = (file: string, body: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(body));
    fs.renameSync(tmp, file); // a crash mid-write leaves no half file for the next run to trust
  };

  /** the gap between requests: the larger of `gapMs` and what `perHour` (or the pace a rate-limit refusal made the run adopt) asks for */
  const pacing = () => { const per = o.perHour && o.perHour > 0 ? o.perHour : autoPerHour; return Math.max(o.gapMs ?? 0, per ? Math.ceil(3_600_000 / per) : 0); };

  async function get<T>(p: string, params: Record<string, string | number | undefined> = {}): Promise<Envelope<T>> {
    const file = o.cacheDir ? cacheFile(p, params) : undefined;
    if (file && !o.refresh && !(o.refreshLists && p.startsWith("/v2/fights"))) { const hit = fromCache<T>(file); if (hit) { hits++; return hit; } }
    const qs = Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
    const attempts = 1 + (o.retries ?? 0);
    let rateWaits = 0, waited = 0;
    for (let attempt = 0; ; attempt++) {
      const spacing = pacing();
      if (used >= max) throw new BudgetError(`Stopped after ${used} requests (limit ${max}; raise BOXING_API_MAX_REQUESTS only if your plan allows it).`);
      used++;
      if (used > 1 && spacing) await sleep(spacing);
      let res: Response;
      try { res = await doFetch(`${base}${p}${qs ? `?${qs}` : ""}`, { headers: { "x-rapidapi-key": o.key, "x-rapidapi-host": host, accept: "application/json" } }); }
      catch (e) {
        if (attempt + 1 < attempts) { log(`network error on ${p} (${e instanceof Error ? e.message : e}); retrying`); await sleep(backoff(attempt)); continue; }
        throw new Error(`Boxing Data API unreachable on ${p}: ${e instanceof Error ? e.message : e}`);
      }
      if (res.status === 429) {
        const said = await explain(res);
        const after = Number(res.headers.get("retry-after"));
        // an allowance that is used up (monthly, daily): no wait helps, so say so now, in the vendor's words
        if (QUOTA_USED.test(said)) throw new HttpError(`Boxing Data API quota used up on ${p}: ${said}. Waiting will not help: check the plan and the key's app in the RapidAPI dashboard.`, 429);
        if (!(o.perHour && o.perHour > 0) && !autoPerHour) { autoPerHour = AUTO_PER_HOUR; log(`the plan refused: no --per-hour was given, so from now on this run sends at most ${AUTO_PER_HOUR} requests an hour (one every ${Math.ceil(3_600_000 / AUTO_PER_HOUR / 1000)} s). Give --per-hour N yourself to choose the pace from the start.`); }
        if ((o.patienceMs ?? 0) > 0) {
          const wait = Number.isFinite(after) && after > 0 ? Math.min(after, 3600) * 1000 : RATE_STEPS_MS[Math.min(rateWaits, RATE_STEPS_MS.length - 1)];
          if (waited + wait > o.patienceMs!) throw new HttpError(`Boxing Data API rate limit on ${p} still in force after waiting ${Math.round(waited / 60000)} minute(s): ${said}. Run the same command again later: everything fetched so far is cached. (--per-hour spaces the requests under the limit instead.)`, 429);
          rateWaits++; waited += wait; attempt--; // this refusal does not use up the ordinary retries
          log(`rate limit on ${p} ("${said}"); waiting ${Math.round(wait / 60000 * 10) / 10} minute(s), then carrying on. ${o.cacheDir ? "What is fetched is cached, so Ctrl-C is safe" : "Nothing is being cached in this mode, so stopping loses what has been read (give --cache-dir to keep it)"}`);
          await sleep(wait);
          continue;
        }
        if (attempt + 1 < attempts) {
          log(`429 on ${p}; retrying (attempt ${attempt + 2} of ${attempts})`);
          await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 120) * 1000 : backoff(attempt));
          continue;
        }
        throw new HttpError(`Boxing Data API rate limit hit on ${p}: ${said} (retry after ${res.headers.get("retry-after") ?? "unknown"} s). --patience-min makes a run wait such a limit out; --per-hour N keeps under it.`, 429);
      }
      if ([500, 502, 503, 504].includes(res.status) && attempt + 1 < attempts) {
        const wait = Number(res.headers.get("retry-after"));
        log(`${res.status} on ${p}; retrying (attempt ${attempt + 2} of ${attempts})`);
        await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 120) * 1000 : backoff(attempt));
        continue;
      }
      if (!res.ok) throw new HttpError(`Boxing Data API ${res.status} on ${p}: ${await explain(res)}`, res.status);
      const raw = await res.text();
      downloaded += Buffer.byteLength(raw);
      let body: Envelope<T>;
      try { body = JSON.parse(raw) as Envelope<T>; } catch { throw new Error(`Boxing Data API sent something that is not JSON on ${p}: ${raw.slice(0, 120).split(o.key).join("***")}`); }
      if (o.rawDir) { fs.mkdirSync(o.rawDir, { recursive: true }); fs.writeFileSync(path.join(o.rawDir, `${String(used).padStart(3, "0")}-${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}.json`), JSON.stringify(body, null, 2)); }
      if (body.error && Object.keys(body.error).length) throw new Error(`Boxing Data API error on ${p}: ${JSON.stringify(body.error).slice(0, 200).split(o.key).join("***")}`);
      if (file) toCache(file, body); // only a good answer is kept: an error body is never a checkpoint
      return body;
    }
  }

  /** The fight list pages (and the schedule, if the list showed no coming fights): the fights, their events and the fighters they involve. */
  async function listFights() {
    notes = emptyNotes();
    const limit = o.maxFights ?? Infinity;
    const events = new Map<string, ProviderEvent>(), bouts: ProviderBout[] = [], ids = new Set<string>(), seen = new Set<string>();
    // the list endpoint (newest first) and the schedule endpoint (the coming weeks); a fight in both is taken once
    const collect = async (endpoint: string, params: Record<string, string | number | undefined>, cap: number) => {
      let taken = 0;
      const size = Math.min(o.pageSize ?? 100, cap);
      const LIMIT = o.offsetLimit ?? 10_000;
      const reachable = Math.max(1, Math.floor(LIMIT / size)); // pages a page number can reach
      const consume = (r: Envelope<ApiFight[]>) => {
        for (const f of r.data ?? []) {
          if (taken >= cap) break;
          if (f.id && seen.has(f.id)) continue;
          const m = mapFight(f, notes, bouts.length);
          if (!m) continue;
          seen.add(f.id); taken++;
          events.set(m.event.externalId, m.event); bouts.push(m.bout); m.fighterIds.forEach((i) => ids.add(i));
        }
      };
      // pages 1..total of one query; `first` is page 1 when the caller already has it
      const walk = async (q: Record<string, string | number | undefined>, first?: Envelope<ApiFight[]>) => {
        for (let page = 1; taken < cap; page++) {
          const r = page === 1 && first ? first : await get<ApiFight[]>(endpoint, { ...q, page_size: size, page_num: page });
          consume(r);
          const total = r.pagination?.total_pages ?? page;
          if (page % 25 === 0) log(`fight pages: ${page} of ${total}`);
          if (page >= total || !(r.data ?? []).length) break;
          if (page >= reachable) break; // the next page number is past what the API will give
        }
      };
      const probe = await get<ApiFight[]>(endpoint, { ...params, page_size: size, page_num: 1 });
      const total = probe.pagination?.total_pages ?? 1;
      if (endpoint !== "/v2/fights/" || total < reachable) return walk(params, probe);
      // The list is longer than a page number can reach (or the API stopped counting at the limit). What happens past it is not known (an error, or an
      // empty page that looks like the end), so rather than depend on either, ask for the history in date windows, splitting any window that is still
      // too long. Only a list this long gets here: a plan with a short history never sends a date range (a limited plan refuses one).
      const from = String(params.date_from ?? "1900-01-01"), to = String(params.date_to ?? addDays(todayIso(), o.scheduleDays ?? 60));
      log(`the fight list is longer than ${LIMIT} documents (${total} pages): reading it in date windows`);
      let windows = 0;
      const window = async (f: string, t: string): Promise<void> => {
        const q = { ...params, date_from: f, date_to: t };
        const first = await get<ApiFight[]>(endpoint, { ...q, page_size: size, page_num: 1 });
        const pages = first.pagination?.total_pages ?? 1;
        if (pages >= reachable && f < t) {
          const mid = addDays(f, Math.floor((Date.parse(t) - Date.parse(f)) / 86400000 / 2));
          await window(f, mid); await window(addDays(mid, 1), t);
          return;
        }
        if (pages >= reachable) { notes.windowTooBig++; log(`${f}: more fights than a page number can reach (${pages} pages); the ones that can be reached are loaded`); }
        windows++;
        await walk(q, first);
      };
      await window(from, to);
      log(`read in ${windows} date windows`);
    };
    // the API rejects date_from without date_to ("InvalidDateRange"), so a start date always comes with an end
    await collect("/v2/fights/", { date_from: o.since, date_to: o.since ? todayIso() : undefined, date_sort: "DESC" }, limit);
    // the list endpoint already includes coming (NOT_STARTED) fights on the free plan, which makes the schedule endpoint redundant there; ask for it only when the list showed none
    const comingInList = bouts.some((b) => (events.get(b.eventExternalId)?.date ?? "") >= todayIso());
    if (o.scheduleDays !== 0 && !comingInList) {
      try { await collect("/v2/fights/schedule", { days: o.scheduleDays ?? 60, date_sort: "ASC" }, limit); }
      catch (e) {
        // some plans do not include the schedule endpoint: the coming fights are then asked for from the list endpoint, from today on
        if (!(e instanceof HttpError) || (e.status !== 403 && e.status !== 404)) throw e;
        notes.scheduleUnavailable++;
        log(`schedule endpoint refused (${e.message}); asking the list endpoint for the coming ${o.scheduleDays ?? 60} days`);
        try { await collect("/v2/fights/", { date_from: todayIso(), date_to: addDays(todayIso(), o.scheduleDays ?? 60), date_sort: "ASC" }, limit); }
        catch (e2) {
          // a plan whose allowed date range stops at today cannot see coming fights at all: keep what history it gives, say so, and count it
          if (!(e2 instanceof HttpError) || ![400, 403, 404].includes(e2.status)) throw e2;
          notes.upcomingUnavailable++;
          log(`no coming fights available on this plan (${e2.message}); loading history only`);
        }
      }
    }
    log(`fights: ${bouts.length}, events: ${events.size}, fighters to fetch: ${ids.size}`);
    return { events, bouts, ids };
  }
  const fightsOnce = () => (listed ??= listFights());

  /** the fighters this run fetches (raw ids, most recently active first), and the ones it leaves for a later run */
  async function chooseFighters() {
    const { events, bouts, ids } = await fightsOnce();
    const dateOf = new Map([...events.values()].map((e) => [e.externalId, e.date]));
    const ranked = rankByRecency(bouts, dateOf); // external ids
    const n = o.maxFighters && o.maxFighters > 0 ? Math.min(o.maxFighters, ranked.length) : ranked.length;
    const cut = fighterId("").length;
    const pick = chooseByMode(bouts, ranked, n, o.maxFighters && o.maxFighters > 0 ? o.selectMode ?? "recent" : "recent");
    const inPick = new Set(pick.chosen);
    return { ranked, chosen: pick.chosen.map((x) => x.slice(cut)), left: new Set(ranked.filter((x) => !inPick.has(x))), total: ids.size, pick };
  }

  async function load() {
    const { events, bouts } = await fightsOnce();
    const { chosen, left, total } = await chooseFighters();
    if (left.size) log(`taking the ${chosen.length} most recently active of ${total} fighters; the other ${left.size} are left for a later run (their fights are not loaded)`);
    const rows: Loose[] = [];
    let n = 0, cachedFighters = 0;
    const started = Date.now();
    // what is not in the cache yet is what costs requests: say so before spending them, and what pace they will be sent at
    const toFetch = o.cacheDir && !o.refresh ? chosen.filter((id) => !fs.existsSync(cacheFile(`/v2/fighters/${id}`, {}))).length : chosen.length;
    if (toFetch > 300 && !(o.perHour && o.perHour > 0)) log(`${toFetch} fighters are not in the cache and no --per-hour was given: a plan with an hourly limit (Mega: 500) refuses a burst. Use --per-hour 400 to pace the run from the start; without it the first refusal makes the run slow itself to 400 an hour.`);
    else if (toFetch > 0) log(`${toFetch} fighters to fetch${o.perHour ? `, about ${Math.ceil((toFetch * 3600) / o.perHour)} minute(s) at ${o.perHour} an hour` : ""}`);
    let windowAt = started, windowFetched = 0;
    for (const id of chosen) {
      const before = hits;
      try {
        const raw = (await get<ApiFighter>(`/v2/fighters/${id}`)).data;
        const m = mapFighter(raw, notes);
        if (m) {
          const s = raw.stats;
          const career = s && [s.wins, s.losses, s.draws].every((x) => typeof x === "number" && x >= 0) ? { wins: s.wins!, losses: s.losses!, draws: s.draws!, ...careerTotals(s) } : null;
          rows.push(career ? { ...m, careerRecord: career } : m);
          if (career) careers.set(m.externalId, career);
        }
      } catch (e) { if (e instanceof BudgetError || (e instanceof HttpError && e.status === 429)) throw e; /* a plan that refuses (a limit, a quota) refuses the next fighter too: stop, do not skip a thousand */ log(`fighter ${id} skipped: ${e instanceof Error ? e.message : e}`); }
      if (hits > before) cachedFighters++;
      if (++n % 100 === 0) {
        const fetched = n - cachedFighters, now = Date.now();
        const perRequest = Math.max(pacing(), (now - windowAt) / Math.max(1, fetched - windowFetched)); // the rate of the last 100, waits included, never faster than the pace set
        windowAt = now; windowFetched = fetched;
        const left = Math.max(0, toFetch - fetched);
        log(`fighters: ${n} of ${chosen.length}${cachedFighters ? ` (${cachedFighters} from the cache)` : ""}${left ? `, ${left} to fetch, at most ${Math.ceil((left * perRequest) / 60000)} min to go` : ""}`);
      }
    }
    const have = new Set(rows.map((r) => r.externalId));
    const keep = bouts.filter((b) => {
      const ok = have.has(b.redExternalId) && have.has(b.blueExternalId);
      if (!ok) { if (left.has(b.redExternalId) || left.has(b.blueExternalId)) notes.boutsOutsideSelection++; else notes.boutsDroppedUnknownFighter++; }
      return ok;
    });
    const eventDates = new Map([...events.values()].map((e) => [e.externalId, e.date]));
    // a fighter with no division even from his fights cannot be placed (the validator rejects "Unknown" and would drop him, and every fight of his with a bad reference): left out here, and his fights with him
    const finished = finishBoxers(rows, keep, eventDates, notes);
    const placed = finished.filter((r) => normalizeDivision(r.weightClass));
    notes.fightersDroppedNoDivision += finished.length - placed.length;
    const placedIds = new Set(placed.map((r) => r.externalId));
    const kept = placeBouts(keep.filter((b) => { const ok = placedIds.has(b.redExternalId) && placedIds.has(b.blueExternalId); if (!ok) notes.boutsDroppedNoDivision++; return ok; }), placed, notes);
    // an event exists here only because a fight said so: one whose every fight was dropped (a fighter outside the selection, an unplaceable division) is not a card with a page,
    // and would be a 404 in the sitemap, the search and the country pages. In a partial load that is most small cards, so it is left out and counted
    const finalBouts = demoteUnsupportedDraws(kept, careers, notes), onCard = new Set(finalBouts.map((b) => b.eventExternalId));
    const cards = [...events.values()].filter((e) => onCard.has(e.externalId));
    notes.eventsWithoutFights += events.size - cards.length;
    return { boxers: placed, events: cards, bouts: finalBouts };
  }
  const once = () => (cache ??= load());
  /** The official lists: 17 requests (one page per division, the pages being the same four bodies each), cached like every other page (so a stopped load resumes, and a reload asks for nothing; the daily `--update` refreshes everything), and never fatal: a plan without them just has none. */
  let rankingsCache: Promise<ProviderOfficialRanking[]> | undefined; // asked for once per run, like the fighters and fights: the feed is read for the check and again for the load
  async function loadRankings(): Promise<ProviderOfficialRanking[]> {
    const out: ProviderOfficialRanking[] = [];
    try {
      const first = await get<ApiRanking[]>("/v2/rankings/", { page_num: 1 });
      const pages = Math.min(first.pagination?.total_pages ?? 1, 30);
      const take = (rows: ApiRanking[] | undefined) => { for (const r of rows ?? []) { const m = mapRanking(r, notes); if (m) out.push(m); } };
      take(first.data as ApiRanking[]);
      for (let page = 2; page <= pages; page++) take((await get<ApiRanking[]>("/v2/rankings/", { page_num: page })).data as ApiRanking[]);
      log(`official rankings: ${out.length} lists over ${pages} pages`);
    } catch (e) {
      // a plan that does not include rankings (403/404) has none: say so and carry on; anything else (a limit, a quota, a network failure) is the run's problem as everywhere else
      if (!(e instanceof HttpError) || ![400, 403, 404].includes(e.status)) throw e;
      notes.rankingsUnavailable++;
      log(`rankings refused (${e.message}); the official lists are left as they were`);
      return [];
    }
    return out;
  }
  return {
    name: "boxing-data-api",
    fetchOfficialRankings: () => (rankingsCache ??= loadRankings()),
    fetchBoxers: async () => (await once()).boxers, fetchEvents: async () => (await once()).events, fetchBouts: async () => (await once()).bouts,
    notes: () => ({ ...notes }), requests: () => used, cacheHits: () => hits, bytes: () => downloaded, vendorRecords: () => new Map(careers),
    async plan() {
      const { events, bouts, ids } = await fightsOnce();
      const { ranked, chosen } = await chooseFighters();
      const cached = o.cacheDir && !o.refresh ? chosen.filter((id) => fromCache(cacheFile(`/v2/fighters/${id}`, {}))).length : 0;
      const limited = chosen.length < ids.size;
      return {
        fights: bouts.length, events: events.size, fighters: chosen.length, fightersCached: cached, fighterRequests: chosen.length - cached, requestsMade: used,
        selection: selectionSizes(ranked.length).map((n) => previewSelection(bouts, ranked, n)), modes: selectionSizes(ranked.length).map((n) => previewModes(bouts, ranked, n)), ...(limited ? { allFighters: ids.size } : {}),
      };
    },
  };
}
