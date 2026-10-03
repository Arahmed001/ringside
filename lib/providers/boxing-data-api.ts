import type { DataProvider, ProviderBoxer, ProviderBout, ProviderEvent } from "./index";
import fs from "node:fs";
import path from "node:path";
import type { Method, Stance } from "../types";
import { normalizeDivision } from "../divisions";
import { currentYear, nowMs, todayIso } from "../clock";

/**
 * Adapter for the Boxing Data API (boxing-data.com, via RapidAPI), written against its published docs
 * (https://boxing-data.com/docs/endpoints/fighters, /fights, /events), not against a live key: the first run on the free
 * tier is the real test, and docs/real-data-readiness.md lists what to check. Nothing here scrapes any site.
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
  stats?: { wins?: number | null; losses?: number | null; draws?: number | null; total_bouts?: number | null } | null;
  division?: { id?: string | null; name?: string | null; weight_lb?: number | null } | null;
}
interface ApiSide { name?: string | null; full_name?: string | null; winner?: boolean | null; fighter_id?: string | null }
export interface ApiEvent { id?: string | null; title?: string | null; date?: string | null; location?: string | null; venue?: string | null; broadcasters?: { [country: string]: string }[] | null; poster_image_url?: string | null }
export interface ApiFight {
  id: string; title?: string | null; date?: string | null; location?: string | null; venue?: string | null; scheduled_rounds?: number | null;
  status?: string | null; fighters?: { fighter_1?: ApiSide | null; fighter_2?: ApiSide | null } | null;
  results?: { outcome?: string | null; round?: string | number | null } | null;
  event?: ApiEvent | null; division?: { name?: string | null; id?: string | null } | null; titles?: { name?: string | null; id?: string | null }[] | null;
}

/** How often the mapping had to approximate. Every key is a count; zero means the feed supplied the fact itself. */
export type Notes = Record<
  | "ptsAsUnanimousDecision" | "drawInferred" | "resultMissing" | "liveTreatedAsUpcoming" | "fightsSkipped" | "boutsDroppedUnknownFighter"
  | "locationCountryInferred" | "locationRegionAmbiguous" | "scheduleUnavailable" | "upcomingUnavailable" | "divisionFromFight" | "birthYearFromAge" | "birthYearUnknown" | "physicalsConverted" | "turnedProFromFirstFight" | "physicalsImputed" | "stanceDefaulted" | "locationUnparsed" | "divisionUnknown",
  number
>;
const emptyNotes = (): Notes => ({
  ptsAsUnanimousDecision: 0, drawInferred: 0, resultMissing: 0, liveTreatedAsUpcoming: 0, fightsSkipped: 0, boutsDroppedUnknownFighter: 0, locationCountryInferred: 0, locationRegionAmbiguous: 0, scheduleUnavailable: 0, upcomingUnavailable: 0,
  birthYearFromAge: 0, birthYearUnknown: 0, physicalsConverted: 0, turnedProFromFirstFight: 0, physicalsImputed: 0, stanceDefaulted: 0, locationUnparsed: 0, divisionUnknown: 0, divisionFromFight: 0,
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

/** One fight -> a bout, the event it belongs to, and the two fighter ids to fetch. Null when it has no date or fewer than two fighters. */
export function mapFight(f: ApiFight, notes: Notes, index = 0): { bout: ProviderBout; event: ProviderEvent; fighterIds: [string, string] } | null {
  const a = f.fighters?.fighter_1, b = f.fighters?.fighter_2;
  const date = (f.event?.date ?? f.date ?? "").slice(0, 10); // a UTC calendar date: an evening card in the Americas can land a day late (see the readiness doc)
  if (!f.id || !a?.fighter_id || !b?.fighter_id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { notes.fightsSkipped++; return null; }

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
  const winner = finished ? (a.winner ? a : b.winner ? b : null) : null;
  let method: Method | null = null;
  if (finished && outcome) {
    if (outcome === "PTS") { method = "UD"; notes.ptsAsUnanimousDecision++; }
    else if (outcome === "UD" || outcome === "MD" || outcome === "SD" || outcome === "KO" || outcome === "TKO") method = outcome;
  }
  // a decision with no winner is a draw; a finished fight with neither a winner nor an outcome is left "no result yet" rather than guessed
  if (finished && !winner && outcome && DECISIONS.has(outcome)) { method = "DRAW"; notes.drawInferred++; }
  if (finished && !winner && !method) notes.resultMissing++;
  const round = f.results?.round === null || f.results?.round === undefined ? NaN : parseInt(String(f.results.round), 10);
  const rounds = f.scheduled_rounds && f.scheduled_rounds > 0 ? f.scheduled_rounds : 10;
  const endRound = !method ? null : method === "KO" || method === "TKO" ? (Number.isFinite(round) ? round : null) : Number.isFinite(round) ? round : rounds;

  const divName = f.division?.name ?? "";
  const weightClass = normalizeDivision(divName) ?? (divName || "Unknown");
  if (!normalizeDivision(divName)) notes.divisionUnknown++;
  const bout: ProviderBout = {
    externalId: boutId(f.id), eventExternalId: eId, redExternalId: fighterId(a.fighter_id), blueExternalId: fighterId(b.fighter_id), // no corner colours in the feed: fighter_1 is "red"
    weightClass, rounds, winnerExternalId: winner ? fighterId(winner.fighter_id!) : null, method, endRound,
    title: f.titles?.[0]?.name ?? null, position: index, // card order is not in the feed: the order the fights came back in
  };
  return { bout, event, fighterIds: [a.fighter_id, b.fighter_id] };
}

const STANCES: Record<string, Stance> = { orthodox: "Orthodox", southpaw: "Southpaw", switch: "Switch", ambidextrous: "Switch" };

/** A fighter -> a boxer. Height and reach come back null for some fighters; `null` here means "fill it in later" (see `imputePhysicals`). */
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

/** A fighter -> a boxer. Height and reach come back null for some fighters; `null` here means "fill it in later" (see `imputePhysicals`). */
export function mapFighter(f: ApiFighter, notes: Notes): (Omit<ProviderBoxer, "heightCm" | "reachCm"> & { heightCm: number | null; reachCm: number | null }) | null {
  if (!f.id || !f.name) return null;
  let birthYear = 0;
  if (Number.isInteger(f.birth_year) && f.birth_year! >= 1900 && f.birth_year! <= currentYear() - 10) birthYear = f.birth_year!; // the feed's own birth year
  else if (typeof f.age === "number" && f.age > 0) { birthYear = currentYear() - f.age; notes.birthYearFromAge++; } // only an age: can be a year out
  else notes.birthYearUnknown++;
  const stance = STANCES[(f.stance ?? "").toLowerCase()];
  if (!stance) notes.stanceDefaulted++;
  const debut = parseInt(String(f.debut ?? ""), 10);
  const div = f.division?.name ?? "";
  return {
    externalId: fighterId(f.id), name: f.name, ...(f.nickname || f.alias ? { nickname: (f.nickname ?? f.alias)! } : {}),
    country: f.nationality ?? "Unknown", birthYear, stance: stance ?? "Orthodox", sex: (f.gender ?? "").toLowerCase().startsWith("f") ? "female" : "male",
    heightCm: lengthCm(f.height_cm, f.height_in, f.height_ft ?? f.height, notes), reachCm: lengthCm(f.reach_cm, f.reach_in, f.reach, notes),
    weightClass: normalizeDivision(div) ?? (div || "Unknown"),
    turnedPro: Number.isFinite(debut) ? debut : 0, active: false, // both settled in `finishBoxers`, which can see the fights
  };
}

type Loose = NonNullable<ReturnType<typeof mapFighter>>;

/**
 * Fills the facts the feed leaves out so a boxer is never stored with a zero: missing reach from height (and the reverse),
 * then the median of the same division, then of everyone, then a neutral 175 cm. This is imputation, not data: each fill is
 * counted in `physicalsImputed`, and the model's reach term is small and capped, but a real deployment should make these
 * columns nullable instead (see docs/real-data-readiness.md).
 */
export function imputePhysicals(rows: Loose[], notes: Notes): Loose[] {
  const median = (xs: number[]) => { const s = [...xs].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const known = (k: "heightCm" | "reachCm", div?: string) => rows.filter((r) => r[k] && (!div || r.weightClass === div)).map((r) => r[k] as number);
  return rows.map((r) => {
    let { heightCm, reachCm } = r;
    if (heightCm && reachCm) return r;
    notes.physicalsImputed++;
    heightCm = heightCm ?? reachCm ?? median(known("heightCm", r.weightClass)) ?? median(known("heightCm")) ?? 175;
    reachCm = reachCm ?? heightCm;
    return { ...r, heightCm, reachCm };
  });
}

/** Settles `active` (fought in the last 30 months, or has a fight coming up) and a missing `turnedPro` (the first fight we saw), which need the fights. */
export function finishBoxers(rows: Loose[], bouts: ProviderBout[], eventDates: Map<string, string>, notes: Notes): ProviderBoxer[] {
  const first = new Map<string, string>(), last = new Map<string, string>(), lastClass = new Map<string, string>();
  for (const b of bouts) {
    const d = eventDates.get(b.eventExternalId);
    if (!d) continue;
    for (const id of [b.redExternalId, b.blueExternalId]) {
      if (!first.has(id) || d < first.get(id)!) first.set(id, d);
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
  return imputePhysicals(rows, notes).map((r) => {
    let turnedPro = r.turnedPro;
    if (!turnedPro && first.has(r.externalId)) { turnedPro = Number(first.get(r.externalId)!.slice(0, 4)); notes.turnedProFromFirstFight++; }
    return { ...r, heightCm: r.heightCm as number, reachCm: r.reachCm as number, turnedPro, active: (last.get(r.externalId) ?? "") >= cutoff };
  });
}

// ---- the client ----
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
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
  maxRequests?: number; pageSize?: number; since?: string; maxFights?: number; /** days of upcoming fights to include (default 60; 0 for none) */ scheduleDays?: number; gapMs?: number; /** save every raw response here, so a mapping can be fixed offline without spending more requests */ rawDir?: string; log?: (m: string) => void;
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
}
export interface BoxingDataApiProvider extends DataProvider {
  notes(): Notes; requests(): number; cacheHits(): number;
  /** Fetches the fight list pages only and says what the fighters will cost, without fetching them: "what will this backfill cost" before it is spent. */
  plan(): Promise<BackfillPlan>;
}

const backoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);
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

export function boxingDataApiProvider(o: BoxingDataApiOptions): BoxingDataApiProvider {
  if (o.purpose === "ingest" && storageStatus() === "provisional") (o.log ?? (() => {}))(STORAGE_WARNING);
  const base = (o.baseUrl ?? "https://boxing-data-api.p.rapidapi.com").replace(/\/+$/, "");
  const host = new URL(base).host;
  const doFetch = o.fetchImpl ?? fetch;
  const max = o.maxRequests ?? 90, log = o.log ?? (() => {});
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let used = 0, hits = 0, notes = emptyNotes(), cache: Promise<{ boxers: ProviderBoxer[]; events: ProviderEvent[]; bouts: ProviderBout[] }> | null = null;
  let listed: Promise<{ events: Map<string, ProviderEvent>; bouts: ProviderBout[]; ids: Set<string> }> | null = null;

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

  async function get<T>(p: string, params: Record<string, string | number | undefined> = {}): Promise<Envelope<T>> {
    const file = o.cacheDir ? cacheFile(p, params) : undefined;
    if (file && !o.refresh && !(o.refreshLists && p.startsWith("/v2/fights"))) { const hit = fromCache<T>(file); if (hit) { hits++; return hit; } }
    const qs = Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
    const attempts = 1 + (o.retries ?? 0);
    for (let attempt = 0; ; attempt++) {
      if (used >= max) throw new BudgetError(`Stopped after ${used} requests (limit ${max}; raise BOXING_API_MAX_REQUESTS only if your plan allows it).`);
      used++;
      if (used > 1 && o.gapMs) await sleep(o.gapMs);
      let res: Response;
      try { res = await doFetch(`${base}${p}${qs ? `?${qs}` : ""}`, { headers: { "x-rapidapi-key": o.key, "x-rapidapi-host": host, accept: "application/json" } }); }
      catch (e) {
        if (attempt + 1 < attempts) { log(`network error on ${p} (${e instanceof Error ? e.message : e}); retrying`); await sleep(backoff(attempt)); continue; }
        throw new Error(`Boxing Data API unreachable on ${p}: ${e instanceof Error ? e.message : e}`);
      }
      if ((res.status === 429 || [500, 502, 503, 504].includes(res.status)) && attempt + 1 < attempts) {
        const wait = Number(res.headers.get("retry-after"));
        log(`${res.status} on ${p}; retrying (attempt ${attempt + 2} of ${attempts})`);
        await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 120) * 1000 : backoff(attempt));
        continue;
      }
      if (res.status === 429) throw new Error(`Boxing Data API rate limit hit on ${p} (retry after ${res.headers.get("retry-after") ?? "unknown"} s).`);
      if (!res.ok) throw new HttpError(`Boxing Data API ${res.status} on ${p}: ${await explain(res)}`, res.status);
      const body = (await res.json()) as Envelope<T>;
      if (o.rawDir) { fs.mkdirSync(o.rawDir, { recursive: true }); fs.writeFileSync(path.join(o.rawDir, `${String(used).padStart(3, "0")}-${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}.json`), JSON.stringify(body, null, 2)); }
      if (body.error && Object.keys(body.error).length) throw new Error(`Boxing Data API error on ${p}: ${JSON.stringify(body.error).slice(0, 200)}`);
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
      for (let page = 1; taken < cap; page++) {
        const r = await get<ApiFight[]>(endpoint, { ...params, page_size: Math.min(o.pageSize ?? 100, cap), page_num: page });
        for (const f of r.data ?? []) {
          if (taken >= cap) break;
          if (f.id && seen.has(f.id)) continue;
          const m = mapFight(f, notes, bouts.length);
          if (!m) continue;
          seen.add(f.id); taken++;
          events.set(m.event.externalId, m.event); bouts.push(m.bout); m.fighterIds.forEach((i) => ids.add(i));
        }
        const total = r.pagination?.total_pages ?? page;
        if (page % 25 === 0) log(`fight pages: ${page} of ${total}`);
        if (page >= total || !(r.data ?? []).length) break;
      }
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

  async function load() {
    const { events, bouts, ids } = await fightsOnce();
    const rows: Loose[] = [];
    let n = 0, cachedFighters = 0;
    const started = Date.now();
    for (const id of ids) {
      const before = hits;
      try {
        const m = mapFighter((await get<ApiFighter>(`/v2/fighters/${id}`)).data, notes);
        if (m) rows.push(m);
      } catch (e) { if (e instanceof BudgetError) throw e; log(`fighter ${id} skipped: ${e instanceof Error ? e.message : e}`); }
      if (hits > before) cachedFighters++;
      if (++n % 100 === 0) {
        const perRequest = (Date.now() - started) / Math.max(1, n - cachedFighters); // cached fighters cost nothing, so time per fighter actually fetched
        log(`fighters: ${n} of ${ids.size}${cachedFighters ? ` (${cachedFighters} from the cache)` : ""}, at most ${Math.ceil(((ids.size - n) * perRequest) / 60000)} min to go`);
      }
    }
    const have = new Set(rows.map((r) => r.externalId));
    const keep = bouts.filter((b) => { const ok = have.has(b.redExternalId) && have.has(b.blueExternalId); if (!ok) notes.boutsDroppedUnknownFighter++; return ok; });
    const eventDates = new Map([...events.values()].map((e) => [e.externalId, e.date]));
    return { boxers: finishBoxers(rows, keep, eventDates, notes), events: [...events.values()], bouts: keep };
  }
  const once = () => (cache ??= load());
  return {
    name: "boxing-data-api",
    fetchBoxers: async () => (await once()).boxers, fetchEvents: async () => (await once()).events, fetchBouts: async () => (await once()).bouts,
    notes: () => ({ ...notes }), requests: () => used, cacheHits: () => hits,
    async plan() {
      const { events, bouts, ids } = await fightsOnce();
      const cached = o.cacheDir && !o.refresh ? [...ids].filter((id) => fromCache(cacheFile(`/v2/fighters/${id}`, {}))).length : 0;
      return { fights: bouts.length, events: events.size, fighters: ids.size, fightersCached: cached, fighterRequests: ids.size - cached, requestsMade: used };
    },
  };
}
