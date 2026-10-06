import type { World } from "./world";
import type { BoutRow, BoxerFull, EventRow, Sex } from "./types";
import { careerView, koView } from "./career";
import { DIVISIONS, divisionFromSlug, slugifyDivision } from "./divisions";
import { eventBouts, isLive, recentEvents, upcomingEvents } from "./events";
import { searchFighters } from "./fighter-search";
import { resultFor } from "./glance";
import type { T } from "./i18n/t";
import { rankDivision, rankedBoxers, rankOf } from "./rankings";
import { vendorCredit } from "./site-info";

/**
 * The public, read-only data of the site as JSON (`/api/v1/...`) and as embeds (`/embed/...`): the same facts the pages show, nothing from accounts, picks or the database's
 * other tables. The builders here are pure (a world in, plain objects out) so they can be tested without a server; `lib/public-api-http.ts` does the HTTP part.
 *
 * SWITCH. Redistributing a data vendor's records to other sites is a different thing from showing them on your own: so for a licensed feed the API and the embeds are OFF
 * unless the owner has turned them on (`PUBLIC_API=1`) AND stated that the vendor's terms allow it (`VENDOR_REDISTRIBUTION_CONFIRMED=1`, like the storage statement: the
 * owner's to make, never set for them). For the demo league and a file feed they are on unless `PUBLIC_API=0`.
 */
export type Env = Record<string, string | undefined>;
export function publicApiGate(env: Env = { PUBLIC_API: process.env.PUBLIC_API, VENDOR_REDISTRIBUTION_CONFIRMED: process.env.VENDOR_REDISTRIBUTION_CONFIRMED, BOXING_PROVIDER: process.env.BOXING_PROVIDER }): { open: boolean; why: string } {
  if (env.PUBLIC_API === "0") return { open: false, why: "The public API is switched off (PUBLIC_API=0)." };
  const licensed = (env.BOXING_PROVIDER ?? "demo").trim() === "licensed";
  if (!licensed) return { open: true, why: "" };
  if (env.PUBLIC_API !== "1") return { open: false, why: "The public API is off for licensed data until the owner switches it on (PUBLIC_API=1)." };
  if (env.VENDOR_REDISTRIBUTION_CONFIRMED !== "1") return { open: false, why: "The public API is off until the owner confirms that the data vendor's terms allow redistribution (VENDOR_REDISTRIBUTION_CONFIRMED=1)." };
  return { open: true, why: "" };
}

export const API_MAX_LIMIT = 50, API_DEFAULT_LIMIT = 20;
export interface Ctx { w: World; t: T; /** an absolute address for a path on the site, in the request's language */ url: (path: string) => string }
/** an answer in the usual envelope, one with nothing around it (the OpenAPI document must be the document), or an error */
export type Result = { data: unknown; meta?: Record<string, unknown> } | { raw: unknown } | { error: number; message: string };
/** The data of an answer, or null when it is an error (or a raw document): for a page that builds on the same fields. */
export const dataOf = (r: Result): unknown => ("data" in r ? r.data : null);
const bad = (message: string, error = 400): Result => ({ error, message });

/** `limit` and `offset` from a query: whole numbers, the limit between 1 and 50. Null for a value that is not one. */
export function paging(q: URLSearchParams): { limit: number; offset: number } | null {
  const num = (k: string, dflt: number) => { const v = q.get(k); return v === null || v === "" ? dflt : /^\d{1,7}$/.test(v) ? Number(v) : NaN; };
  const limit = num("limit", API_DEFAULT_LIMIT), offset = num("offset", 0);
  return Number.isNaN(limit) || Number.isNaN(offset) || limit < 1 || limit > API_MAX_LIMIT ? null : { limit, offset };
}

const recordOf = (b: BoxerFull) => { const c = careerView(b); return { wins: c.wins, losses: c.losses, draws: c.draws, source: c.source, total: c.total, held: c.held }; };
const divisionSlug = (b: BoxerFull) => slugifyDivision(b.weightClass);

/** A fighter as a list row. */
function fighterRow(c: Ctx, b: BoxerFull) {
  const r = recordOf(b);
  return { slug: b.slug, name: c.t.name(b.name), country: b.country, sex: b.sex, division: b.weightClass, divisionSlug: divisionSlug(b), record: r, rating: Math.round(b.rating), active: b.active, lastFight: b.lastFight, url: c.url(`/boxers/${b.slug}`) };
}
const side = (c: Ctx, b: BoutRow, id: number) => { const x = c.w.byId.get(id); return x ? { slug: x.slug, name: c.t.name(id === b.redId ? b.redName : b.blueName) } : null; };
function boutRow(c: Ctx, b: BoutRow) {
  const decided = b.method !== null && !b.upcoming && b.status !== "cancelled";
  return {
    id: b.id, date: b.date, division: b.weightClass, rounds: b.rounds, title: b.title ? c.t.name(b.title) : null, status: b.status, red: side(c, b, b.redId), blue: side(c, b, b.blueId),
    result: decided ? { method: b.method, round: b.endRound, winner: b.winnerId ? side(c, b, b.winnerId) : null } : null, url: c.url(`/bouts/${b.id}`),
  };
}
function eventRow(c: Ctx, e: EventRow) {
  const main = eventBouts(c.w, e.id).find(isLive);
  return { id: e.id, name: c.t.name(e.name), date: e.date, venue: c.t.name(e.venue), city: c.t.name(e.city), country: e.country, status: e.status, upcoming: e.upcoming, mainEvent: main ? boutRow(c, main) : null, url: c.url(`/events/${e.id}`) };
}

export function apiDivisions(): Result {
  return { data: DIVISIONS.map((d) => ({ name: d.name, slug: slugifyDivision(d.name), short: d.short, limitLb: d.lb, limitKg: d.kg })) };
}

/** `q` (a name, forgiving of a slip), `division` (a slug), `country`, `sex`, `active`; best rated first when there is no `q`. */
export function apiFighters(c: Ctx, q: URLSearchParams): Result {
  const p = paging(q);
  if (!p) return bad(`limit must be a whole number from 1 to ${API_MAX_LIMIT}, and offset a whole number`);
  const division = q.get("division"), country = q.get("country"), sex = q.get("sex"), active = q.get("active"), name = (q.get("q") ?? "").slice(0, 80).trim();
  if (division && !divisionFromSlug(division)) return bad(`unknown division "${division.slice(0, 40)}" (see /api/v1/divisions)`, 400);
  if (sex && sex !== "male" && sex !== "female") return bad("sex must be male or female");
  if (active && active !== "true" && active !== "false") return bad("active must be true or false");
  let rows: BoxerFull[] = name ? searchFighters(c.w, name, { limit: 200 }) : [...c.w.boxers].sort((a, b) => b.rating - a.rating);
  rows = rows.filter((b) => (!division || divisionSlug(b) === division) && (!country || b.country.toLowerCase() === country.toLowerCase()) && (!sex || b.sex === sex) && (!active || b.active === (active === "true")));
  return { data: rows.slice(p.offset, p.offset + p.limit).map((b) => fighterRow(c, b)), meta: { total: rows.length, limit: p.limit, offset: p.offset } };
}

export function apiFighter(c: Ctx, slug: string): Result {
  const b = c.w.bySlug.get(slug);
  if (!b) return bad("no such fighter", 404);
  const career = careerView(b), ko = koView(b), bouts = c.w.boutsByBoxer.get(b.id) ?? [];
  const decided = bouts.filter((x) => resultFor(x, b.id) !== null).slice(-5).reverse();
  const next = bouts.find((x) => x.upcoming);
  return {
    data: {
      ...fighterRow(c, b), nickname: b.nickname ? c.t.name(b.nickname) : null, stance: b.stance, heightCm: b.heightCm, reachCm: b.reachCm, birthYear: b.birthYear, turnedPro: b.turnedPro, divisionRank: rankOf(c.w, b),
      knockouts: { wins: ko.kos, rate: Math.round(ko.rate * 1000) / 1000, stopped: ko.stopped, source: ko.source },
      /** the record is the supplier's total when only part of the career is held: `held` of `total` fights are in the fight list */
      recordNote: career.source === "loaded" ? null : career.source === "supplier" ? "career total from the data supplier; the fight list holds only part of it" : "the supplier's total and its own fight list disagree; the total is shown",
      lastFights: decided.map((x) => ({ ...boutRow(c, x), result: { ...(boutRow(c, x).result ?? { method: x.method, round: x.endRound, winner: null }), forFighter: resultFor(x, b.id) } })),
      nextFight: next ? boutRow(c, next) : null,
    },
  };
}

export function apiRankings(c: Ctx, divisionSlug_: string, q: URLSearchParams): Result {
  const d = divisionFromSlug(divisionSlug_);
  if (!d) return bad(`unknown division "${divisionSlug_.slice(0, 40)}" (see /api/v1/divisions)`, 404);
  const sex = (q.get("sex") ?? "male") as Sex;
  if (sex !== "male" && sex !== "female") return bad("sex must be male or female");
  const p = paging(q);
  if (!p) return bad(`limit must be a whole number from 1 to ${API_MAX_LIMIT}, and offset a whole number`);
  const rows = rankDivision(c.w, d.name, p.limit, sex, p.offset);
  return {
    data: rows.map((r) => ({ rank: r.rank, rankChange90d: r.delta, ratingChange90d: r.ratingChange, ...fighterRow(c, r.boxer) })),
    meta: { division: d.name, sex, total: rankedBoxers(c.w, d.name, sex).length, limit: p.limit, offset: p.offset, rule: "active, 5 or more fights held, a winning record, a fight in the last 24 months; by Elo-style rating" },
  };
}

export function apiEvents(c: Ctx, q: URLSearchParams): Result {
  const when = q.get("when") ?? "upcoming";
  if (when !== "upcoming" && when !== "recent") return bad("when must be upcoming or recent");
  const p = paging(q);
  if (!p) return bad(`limit must be a whole number from 1 to ${API_MAX_LIMIT}, and offset a whole number`);
  const all = when === "upcoming" ? upcomingEvents(c.w) : recentEvents(c.w, p.offset + p.limit);
  return { data: all.slice(p.offset, p.offset + p.limit).map((e) => eventRow(c, e)), meta: { when, ...(when === "upcoming" ? { total: all.length } : {}), limit: p.limit, offset: p.offset } };
}

export function apiEvent(c: Ctx, id: string): Result {
  if (!/^\d{1,9}$/.test(id)) return bad("an event id is a whole number");
  const e = c.w.eventById.get(Number(id));
  if (!e) return bad("no such event", 404);
  return { data: { ...eventRow(c, e), bouts: eventBouts(c.w, e.id).map((b) => boutRow(c, b)) } };
}

/** What every answer says about itself: the day of the data, and (for a licensed feed) the supplier to credit. */
export function apiMeta(w: World, env?: Env): Record<string, unknown> {
  const credit = vendorCredit(env);
  return { updated: w.today, source: "Ringside", ratings: "Ringside's own Elo-style ratings", ...(credit ? { credit: `Data supplier: ${credit.name} (${credit.url})` } : {}) };
}

const PATHS = ["/api/v1/divisions", "/api/v1/fighters", "/api/v1/fighters/{slug}", "/api/v1/rankings/{division}", "/api/v1/events", "/api/v1/events/{id}"] as const;
export const API_PATHS = PATHS;

/** The OpenAPI 3 description of the API (served at /api/v1/openapi.json), kept honest by a test that its paths are exactly the routes that exist. */
export function openApiSpec(baseUrl: string): Record<string, unknown> {
  const limit = { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: API_MAX_LIMIT, default: API_DEFAULT_LIMIT } };
  const offset = { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } };
  const lang = { name: "lang", in: "query", description: "ar for Arabic names", schema: { type: "string", enum: ["en", "ar"], default: "en" } };
  const ok = (what: string) => ({ "200": { description: what, content: { "application/json": { schema: { type: "object", properties: { data: {}, meta: { type: "object" } } } } } }, "400": { description: "a bad parameter" }, "404": { description: "nothing there, or the API is switched off" }, "429": { description: "too many requests: wait the number of seconds in Retry-After" } });
  return {
    openapi: "3.0.3",
    info: { title: "Ringside public API", version: "1", description: "Read-only boxing data: fighters, rankings, events. JSON, CORS open for GET, cached for five minutes, 60 requests a minute per address. Every answer is { data, meta }; meta.updated is the day of the data." },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/v1/divisions": { get: { summary: "The divisions, lightest to heaviest", parameters: [], responses: ok("the divisions") } },
      "/api/v1/fighters": { get: { summary: "Fighters: best rated first, or a name search", parameters: [{ name: "q", in: "query", schema: { type: "string", maxLength: 80 } }, { name: "division", in: "query", schema: { type: "string" } }, { name: "country", in: "query", schema: { type: "string" } }, { name: "sex", in: "query", schema: { type: "string", enum: ["male", "female"] } }, { name: "active", in: "query", schema: { type: "boolean" } }, limit, offset, lang], responses: ok("a page of fighters") } },
      "/api/v1/fighters/{slug}": { get: { summary: "One fighter", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }, lang], responses: ok("the fighter") } },
      "/api/v1/rankings/{division}": { get: { summary: "A division's ranking", parameters: [{ name: "division", in: "path", required: true, schema: { type: "string" } }, { name: "sex", in: "query", schema: { type: "string", enum: ["male", "female"], default: "male" } }, limit, offset, lang], responses: ok("a page of the ranking") } },
      "/api/v1/events": { get: { summary: "Upcoming or recent events", parameters: [{ name: "when", in: "query", schema: { type: "string", enum: ["upcoming", "recent"], default: "upcoming" } }, limit, offset, lang], responses: ok("a page of events") } },
      "/api/v1/events/{id}": { get: { summary: "One event with its bouts", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }, lang], responses: ok("the event") } },
    },
  };
}
