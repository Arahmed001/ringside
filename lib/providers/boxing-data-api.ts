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
 * time and COUNTS it in `notes()`, so a reader can see how much of a feed rests on an assumption. Two things are deliberately
 * hard-wired for safety: a request budget (the free tier is 100 a month) and a refusal to fill the database until the
 * licence's storage terms are confirmed (BOXING_API_STORAGE_CONFIRMED=1); evaluating a sample is always allowed.
 */

// ---- the documented response shapes (only the fields used here) ----
interface Envelope<T> { error?: Record<string, unknown> | null; pagination?: { page?: number; total_pages?: number; next_page?: unknown }; data: T }
export interface ApiFighter {
  id: string; name?: string | null; nickname?: string | null; alias?: string | null; age?: number | null; gender?: string | null;
  nationality?: string | null; stance?: string | null; height_cm?: number | null; reach_cm?: number | null; debut?: string | null;
  division?: { name?: string | null } | null;
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
  | "scheduleUnavailable" | "birthYearFromAge" | "birthYearUnknown" | "turnedProFromFirstFight" | "physicalsImputed" | "stanceDefaulted" | "locationUnparsed" | "divisionUnknown",
  number
>;
const emptyNotes = (): Notes => ({
  ptsAsUnanimousDecision: 0, drawInferred: 0, resultMissing: 0, liveTreatedAsUpcoming: 0, fightsSkipped: 0, boutsDroppedUnknownFighter: 0, scheduleUnavailable: 0,
  birthYearFromAge: 0, birthYearUnknown: 0, turnedProFromFirstFight: 0, physicalsImputed: 0, stanceDefaulted: 0, locationUnparsed: 0, divisionUnknown: 0,
});

export const fighterId = (id: string) => `bda-f-${id}`;
export const eventId = (id: string) => `bda-e-${id}`;
export const boutId = (id: string) => `bda-b-${id}`;

/** "Las Vegas, Nevada, United States" -> city "Las Vegas", country "United States". The docs only say `location` is a string, so this is tolerant and counts what it cannot split. */
export function parseLocation(raw: string | null | undefined, notes: Notes): { city: string; country: string } {
  const parts = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], country: parts[parts.length - 1] };
  notes.locationUnparsed++;
  return { city: parts[0] ?? "Unknown", country: "Unknown" };
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
export function mapFighter(f: ApiFighter, notes: Notes): (Omit<ProviderBoxer, "heightCm" | "reachCm"> & { heightCm: number | null; reachCm: number | null }) | null {
  if (!f.id || !f.name) return null;
  let birthYear = 0;
  if (typeof f.age === "number" && f.age > 0) { birthYear = currentYear() - f.age; notes.birthYearFromAge++; } else notes.birthYearUnknown++; // only an age is published, so this can be a year out
  const stance = STANCES[(f.stance ?? "").toLowerCase()];
  if (!stance) notes.stanceDefaulted++;
  const debut = parseInt(String(f.debut ?? ""), 10);
  const div = f.division?.name ?? "";
  return {
    externalId: fighterId(f.id), name: f.name, ...(f.nickname || f.alias ? { nickname: (f.nickname ?? f.alias)! } : {}),
    country: f.nationality ?? "Unknown", birthYear, stance: stance ?? "Orthodox", sex: (f.gender ?? "").toLowerCase().startsWith("f") ? "female" : "male",
    heightCm: f.height_cm ?? null, reachCm: f.reach_cm ?? null, weightClass: normalizeDivision(div) ?? (div || "Unknown"),
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
  const first = new Map<string, string>(), last = new Map<string, string>();
  for (const b of bouts) {
    const d = eventDates.get(b.eventExternalId);
    if (!d) continue;
    for (const id of [b.redExternalId, b.blueExternalId]) {
      if (!first.has(id) || d < first.get(id)!) first.set(id, d);
      if (!last.has(id) || d > last.get(id)!) last.set(id, d);
    }
  }
  const cutoff = new Date(nowMs() - 30 * 30.4 * 86400000).toISOString().slice(0, 10);
  return imputePhysicals(rows, notes).map((r) => {
    let turnedPro = r.turnedPro;
    if (!turnedPro && first.has(r.externalId)) { turnedPro = Number(first.get(r.externalId)!.slice(0, 4)); notes.turnedProFromFirstFight++; }
    return { ...r, heightCm: r.heightCm as number, reachCm: r.reachCm as number, turnedPro, active: (last.get(r.externalId) ?? "") >= cutoff };
  });
}

// ---- the client ----
export class BudgetError extends Error {}
/** An HTTP failure from the API, with the status so the caller can tell "not on your plan" from "broken". The message carries the vendor's own explanation. */
export class HttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export interface BoxingDataApiOptions {
  key: string; baseUrl?: string; fetchImpl?: typeof fetch;
  /** Hard cap on requests per load (the free tier is 100 a month). Default 90. */
  maxRequests?: number; pageSize?: number; since?: string; maxFights?: number; /** days of upcoming fights to include (default 60; 0 for none) */ scheduleDays?: number; gapMs?: number; /** save every raw response here, so a mapping can be fixed offline without spending more requests */ rawDir?: string; log?: (m: string) => void;
  /** "evaluation" fetches a sample for `npm run data:check`; "ingest" fills the database and needs BOXING_API_STORAGE_CONFIRMED=1. */
  purpose: "evaluation" | "ingest";
}
export interface BoxingDataApiProvider extends DataProvider { notes(): Notes; requests(): number }

export function boxingDataApiProvider(o: BoxingDataApiOptions): BoxingDataApiProvider {
  if (o.purpose === "ingest" && process.env.BOXING_API_STORAGE_CONFIRMED !== "1") {
    throw new Error("Not filling the database from the Boxing Data API yet: its terms on storing data are unconfirmed (docs/boxing-data-api-enquiry.md). Evaluate a sample with `npm run vendor:sample`, and set BOXING_API_STORAGE_CONFIRMED=1 once the operator has confirmed in writing that stored data may be kept.");
  }
  const base = (o.baseUrl ?? "https://boxing-data-api.p.rapidapi.com").replace(/\/+$/, "");
  const host = new URL(base).host;
  const doFetch = o.fetchImpl ?? fetch;
  const max = o.maxRequests ?? 90, log = o.log ?? (() => {});
  let used = 0, notes = emptyNotes(), cache: Promise<{ boxers: ProviderBoxer[]; events: ProviderEvent[]; bouts: ProviderBout[] }> | null = null;

  /** The vendor's own reason for a refusal ("not subscribed", "invalid key", "endpoint not on your plan"), with the key scrubbed out. */
  async function explain(res: Response): Promise<string> {
    const text = (await res.text().catch(() => "")).trim();
    let msg = text;
    try { const j = JSON.parse(text) as { message?: unknown; error?: unknown }; msg = String(j.message ?? (j.error && JSON.stringify(j.error)) ?? text); } catch { /* not JSON: use the text */ }
    return (msg.split(o.key).join("***").replace(/\s+/g, " ").slice(0, 200)) || "no explanation given";
  }

  async function get<T>(p: string, params: Record<string, string | number | undefined> = {}): Promise<Envelope<T>> {
    if (used >= max) throw new BudgetError(`Stopped after ${used} requests (limit ${max}; raise BOXING_API_MAX_REQUESTS only if your plan allows it).`);
    used++;
    if (used > 1 && o.gapMs) await new Promise((r) => setTimeout(r, o.gapMs));
    const qs = Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
    const res = await doFetch(`${base}${p}${qs ? `?${qs}` : ""}`, { headers: { "x-rapidapi-key": o.key, "x-rapidapi-host": host, accept: "application/json" } });
    if (res.status === 429) throw new Error(`Boxing Data API rate limit hit on ${p} (retry after ${res.headers.get("retry-after") ?? "unknown"} s).`);
    if (!res.ok) throw new HttpError(`Boxing Data API ${res.status} on ${p}: ${await explain(res)}`, res.status);
    const body = (await res.json()) as Envelope<T>;
    if (o.rawDir) { fs.mkdirSync(o.rawDir, { recursive: true }); fs.writeFileSync(path.join(o.rawDir, `${String(used).padStart(3, "0")}-${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}.json`), JSON.stringify(body, null, 2)); }
    if (body.error && Object.keys(body.error).length) throw new Error(`Boxing Data API error on ${p}: ${JSON.stringify(body.error).slice(0, 200)}`);
    return body;
  }

  async function load() {
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
        if (page >= total || !(r.data ?? []).length) break;
      }
    };
    await collect("/v2/fights/", { date_from: o.since, date_sort: "DESC" }, limit);
    if (o.scheduleDays !== 0) {
      try { await collect("/v2/fights/schedule", { days: o.scheduleDays ?? 60, date_sort: "ASC" }, limit); }
      catch (e) {
        // some plans do not include the schedule endpoint: the coming fights are then asked for from the list endpoint, from today on
        if (!(e instanceof HttpError) || (e.status !== 403 && e.status !== 404)) throw e;
        notes.scheduleUnavailable++;
        log(`schedule endpoint refused (${e.message}); asking the list endpoint for fights from today on`);
        await collect("/v2/fights/", { date_from: todayIso(), date_sort: "ASC" }, limit);
      }
    }
    log(`fights: ${bouts.length}, events: ${events.size}, fighters to fetch: ${ids.size}`);
    const rows: Loose[] = [];
    for (const id of ids) {
      try {
        const m = mapFighter((await get<ApiFighter>(`/v2/fighters/${id}`)).data, notes);
        if (m) rows.push(m);
      } catch (e) { if (e instanceof BudgetError) throw e; log(`fighter ${id} skipped: ${e instanceof Error ? e.message : e}`); }
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
    notes: () => ({ ...notes }), requests: () => used,
  };
}
