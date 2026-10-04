import http from "node:http";
import { mulberry32 } from "./prng";

/**
 * A stand-in for the Boxing Data API, with the real answer shapes (the ones the first live runs showed): the envelope, `/v2/fights/` with
 * `page_num`, `page_size`, `date_from`/`date_to` and `date_sort`, `/v2/fighters/<id>` with a career record that adds up to the fights it
 * serves. It exists so the first full-size load can be rehearsed for nothing (`npm run vendor:rehearse`) and so tests can reach cases a free
 * key never shows.
 *
 * One thing is modelled that the live runs could not show: the docs say page numbers stop at 10,000 documents. What the real API does beyond
 * that is not known, so both ways are available: `reject` (an HTTP error) and `silent` (an empty page, as if the list had ended).
 */
export interface MockOptions {
  /** documents reachable by page number (the docs say 10,000) */
  offsetLimit?: number;
  /** what happens past it: an error, or an empty page that looks like the end of the list */
  beyond?: "reject" | "silent";
  /** whether `total_pages` is the true count or is capped at what is reachable */
  totalPages?: "true" | "capped";
  /** the cheapest plan: only this many days back are visible (omit for full history) */
  historyDays?: number;
  /**
   * The plan's own limits, refused the way the real gateway refused the first full run (HTTP 429 with a JSON message, no Retry-After):
   * `hourlyLimit` requests in any clock hour ("You have exceeded the rate limit per hour for your plan, MEGA, by the API provider"), and `monthlyQuota`
   * requests in all ("You have exceeded the MONTHLY quota ..."). A refused request is not counted. `now` is the clock (ms), so a test can move it.
   */
  hourlyLimit?: number;
  monthlyQuota?: number;
  now?: () => number;
}

export interface MockFight {
  id: string; date: string; a: string; b: string; status: "FINISHED" | "NOT_STARTED"; winner: "a" | "b" | null; outcome: string | null; round: number | null; division: string; event: string;
}
export interface MockFighter { id: string; name: string; birthYear: number; division: string; country: string }
export interface MockWorld { today: string; fighters: Map<string, MockFighter>; fights: MockFight[]; careers: Map<string, { wins: number; losses: number; draws: number }> }

const DIVISIONS = ["Heavyweight", "Cruiserweight", "Light Heavyweight", "Super Middleweight", "Middleweight", "Super Welterweight", "Welterweight", "Super Lightweight", "Lightweight", "Super Featherweight", "Featherweight", "Super Bantamweight", "Bantamweight", "Super Flyweight", "Flyweight", "Light Flyweight", "Minimumweight"];
const COUNTRIES = ["United States", "Mexico", "United Kingdom", "Japan", "Ukraine", "Philippines", "Nigeria", "Argentina", "Germany", "Cuba"];
const CITIES = ["Las Vegas, Nevada", "London, England", "Tokyo, Japan", "Manchester, England", "Los Angeles, California", "Mexico City, Mexico", "Riyadh, Saudi Arabia"];
const day = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

/** A deterministic league: `fighters` people and `fights` decided fights spread over `years`, plus a few coming ones. Each fighter's career record is what their fights add up to. */
export function makeWorld(o: { fighters: number; fights: number; years?: number; today?: string; seed?: number; upcoming?: number }): MockWorld {
  const rand = mulberry32(o.seed ?? 7), today = o.today ?? "2026-10-03", years = o.years ?? 35;
  const fighters = new Map<string, MockFighter>();
  const byDivision = new Map<string, string[]>();
  for (let i = 0; i < o.fighters; i++) {
    const division = DIVISIONS[Math.floor(rand() * DIVISIONS.length)], id = `f${i}`;
    fighters.set(id, { id, name: `Fighter ${i}`, birthYear: 1960 + Math.floor(rand() * 45), division, country: COUNTRIES[Math.floor(rand() * COUNTRIES.length)] });
    (byDivision.get(division) ?? byDivision.set(division, []).get(division)!).push(id);
  }
  const pools = [...byDivision.values()].filter((p) => p.length >= 2);
  if (!pools.length) throw new Error("need at least two fighters in one division");
  const start = day(today, -Math.round(years * 365.25));
  const span = Math.round(years * 365.25);
  const fights: MockFight[] = [];
  const careers = new Map<string, { wins: number; losses: number; draws: number }>();
  const career = (id: string) => careers.get(id) ?? careers.set(id, { wins: 0, losses: 0, draws: 0 }).get(id)!;
  const total = o.fights + (o.upcoming ?? 3);
  for (let i = 0; i < total; i++) {
    const coming = i >= o.fights;
    const pool = pools[Math.floor(rand() * pools.length)];
    const a = pool[Math.floor(rand() * pool.length)];
    let b = pool[Math.floor(rand() * pool.length)];
    if (b === a) b = pool[(pool.indexOf(a) + 1) % pool.length];
    const date = coming ? day(today, 3 + Math.floor(rand() * 40)) : day(start, Math.floor(rand() * (span - 1)));
    const r = rand();
    const f: MockFight = { id: `x${i}`, date, a, b, status: coming ? "NOT_STARTED" : "FINISHED", winner: coming ? null : r < 0.47 ? "a" : r < 0.94 ? "b" : null, outcome: coming ? null : r < 0.94 ? (rand() < 0.4 ? "KO" : "UD") : "UD", round: null, division: fighters.get(a)!.division, event: `e${date}-${Math.floor(i % 7)}` };
    if (f.outcome === "KO") f.round = 1 + Math.floor(rand() * 11);
    fights.push(f);
    if (!coming) {
      if (f.winner === "a") { career(a).wins++; career(b).losses++; } else if (f.winner === "b") { career(b).wins++; career(a).losses++; } else { career(a).draws++; career(b).draws++; }
    }
  }
  return { today, fighters, fights, careers };
}

const side = (id: string, name: string, winner: boolean) => ({ fighter_id: id, name, full_name: name, winner });
function apiFight(w: MockWorld, f: MockFight) {
  const A = w.fighters.get(f.a)!, B = w.fighters.get(f.b)!, done = f.status === "FINISHED";
  const city = CITIES[Number(f.id.slice(1)) % CITIES.length];
  return {
    id: f.id, title: `${A.name} vs ${B.name}`, date: `${f.date}T02:00:00`, venue: "Arena", location: city, scheduled_rounds: 12, status: f.status,
    fighters: { fighter_1: side(f.a, A.name, f.winner === "a"), fighter_2: side(f.b, B.name, f.winner === "b") },
    results: done ? { outcome: f.outcome, outcome_long: f.outcome, round: f.round } : null,
    scores: done && f.outcome === "UD" ? ["116-112", "115-113", "117-111"] : null,
    event: { id: f.event, title: `Card ${f.event}`, date: `${f.date}T00:00:00`, location: city, venue: "Arena" },
    division: { name: f.division }, titles: [],
  };
}
/** A fighter's knockouts and times stopped, counted from the league's own fights (so they agree with the career record the mock states). */
function knockouts(w: MockWorld, id: string) {
  let koWins = 0, stopped = 0;
  for (const f of w.fights) {
    if (f.status !== "FINISHED" || (f.outcome !== "KO" && f.outcome !== "TKO") || (f.a !== id && f.b !== id)) continue;
    const won = f.winner === "a" ? f.a : f.winner === "b" ? f.b : null;
    if (won === id) koWins++; else if (won) stopped++;
  }
  return { ko_wins: koWins, stopped };
}
function apiFighter(w: MockWorld, id: string) {
  const p = w.fighters.get(id)!, c = w.careers.get(id) ?? { wins: 0, losses: 0, draws: 0 };
  return {
    id, name: p.name, alias: null, gender: "m", birth_year: p.birthYear, height: null, height_cm: 160 + (p.birthYear % 30), height_in: null, nationality: p.country, nationality_code: "XX", nickname: null,
    reach: null, reach_cm: null, reach_in: 66 + (p.birthYear % 10), stance: p.birthYear % 3 ? "orthodox" : "southpaw", stats: { ...c, total_bouts: c.wins + c.losses + c.draws, ...knockouts(w, id), total_rounds: 0 },
    debut: null, division: { id: "d", name: p.division, weight_lb: 147 }, titles: [], updated_at: "2026-09-29T18:04:12.400000",
  };
}

export interface MockResponse { status: number; body: unknown }
export interface MockStats { requests: number; byPath: Record<string, number>; pastLimit: number; refused: number; /** fighter ids asked for, in the order asked */ fighterOrder: string[] }

/** The vendor as a function of a URL: what it answers, and counts what it was asked. */
export function mockVendor(w: MockWorld, o: MockOptions = {}) {
  const limit = o.offsetLimit ?? 10_000;
  const stats: MockStats = { requests: 0, byPath: {}, pastLimit: 0, refused: 0, fighterOrder: [] };
  const clock = o.now ?? Date.now;
  const perHour = new Map<number, number>();
  let accepted = 0;
  const visible = o.historyDays === undefined ? undefined : day(w.today, -o.historyDays);
  const sorted = { DESC: [...w.fights].sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : x.id < y.id ? -1 : 1)), ASC: [] as MockFight[] };
  sorted.ASC = [...sorted.DESC].reverse();
  const env = (data: unknown, extra: object = {}) => ({ metadata: {}, pagination: { page: 1, total_pages: 1, next_page: null }, error: {}, data, ...extra });
  const handle = (rawUrl: string): MockResponse => {
    const u = new URL(rawUrl, "http://mock"), p = u.pathname, q = u.searchParams;
    const hour = Math.floor(clock() / 3_600_000);
    if (o.monthlyQuota !== undefined && accepted >= o.monthlyQuota) { stats.refused++; return { status: 429, body: { message: "You have exceeded the MONTHLY quota for Requests on your current plan, MEGA. Upgrade your plan at https://rapidapi.com/" } }; }
    if (o.hourlyLimit !== undefined && (perHour.get(hour) ?? 0) >= o.hourlyLimit) { stats.refused++; return { status: 429, body: { message: "You have exceeded the rate limit per hour for your plan, MEGA, by the API provider" } }; }
    accepted++; perHour.set(hour, (perHour.get(hour) ?? 0) + 1);
    stats.requests++; stats.byPath[p.startsWith("/v2/fighters/") ? "/v2/fighters/*" : p] = (stats.byPath[p.startsWith("/v2/fighters/") ? "/v2/fighters/*" : p] ?? 0) + 1;
    if (p === "/v2/fights/") {
      const from = q.get("date_from"), to = q.get("date_to");
      if (from && !to) return { status: 400, body: { code: "InvalidDateRange", message: "date_from must be earlier than or equal to date_to and in format YYYY-MM-DD" } };
      if (visible && from && from < visible) return { status: 403, body: { code: "DateOutOfRange", message: "this plan covers fewer days" } };
      let rows = (q.get("date_sort") === "ASC" ? sorted.ASC : sorted.DESC).filter((f) => (!from || f.date >= from) && (!to || f.date <= to) && (!visible || f.date >= visible || f.status === "NOT_STARTED"));
      if (visible && !from) rows = rows.filter((f) => f.date >= visible);
      const size = Math.min(100, Number(q.get("page_size") ?? 100)), page = Number(q.get("page_num") ?? 1);
      const truePages = Math.max(1, Math.ceil(rows.length / size));
      const reachable = Math.max(1, Math.floor(limit / size));
      if (page > reachable) {
        stats.pastLimit++;
        if (o.beyond === "silent") return { status: 200, body: env([], { pagination: { page, total_pages: o.totalPages === "capped" ? reachable : truePages, next_page: null } }) };
        return { status: 400, body: { code: "OffsetLimitExceeded", message: `page_num * page_size must not exceed ${limit}` } };
      }
      const slice = rows.slice((page - 1) * size, page * size);
      const tp = o.totalPages === "capped" ? Math.min(truePages, reachable) : truePages;
      return { status: 200, body: env(slice.map((f) => apiFight(w, f)), { pagination: { page, total_pages: tp, next_page: page < tp ? page + 1 : null } }) };
    }
    if (p === "/v2/fights/schedule") return { status: 200, body: env(w.fights.filter((f) => f.status === "NOT_STARTED").map((f) => apiFight(w, f))) };
    const m = p.match(/^\/v2\/fighters\/(.+)$/);
    if (m && w.fighters.has(m[1])) { stats.fighterOrder.push(m[1]); return { status: 200, body: env(apiFighter(w, m[1])) }; }
    return { status: 404, body: { message: "not found" } };
  };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const r = handle(String(input));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { handle, fetchImpl, stats };
}

/** The same vendor behind a real local port, for running the actual command against it. Returns its base URL and a closer. */
export async function serveMockVendor(w: MockWorld, o: MockOptions & { key?: string } = {}) {
  const v = mockVendor(w, o);
  const server = http.createServer((req, res) => {
    if (o.key && req.headers["x-rapidapi-key"] !== o.key) { res.writeHead(403, { "content-type": "application/json" }); return void res.end(JSON.stringify({ message: "Invalid API key." })); }
    const r = v.handle(req.url ?? "/");
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(JSON.stringify(r.body));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, stats: v.stats, close: () => new Promise<void>((ok) => { server.close(() => ok()); server.closeAllConnections?.(); }) };
}
