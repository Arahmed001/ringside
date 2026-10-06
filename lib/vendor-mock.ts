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
  /** the rankings endpoint: `"refused"` answers 403 (a plan without it); omit for the real behaviour */
  rankings?: "refused";
  now?: () => number;
}

export interface MockFight {
  id: string; date: string; a: string; b: string; status: "FINISHED" | "NOT_STARTED" | "CANCELLED"; /** the event's own title, when it is not the plain "Card x" (an Olympic card, say) */ eventTitle?: string; /** belt names on the line, as the feed spells them */ titles?: string[]; winner: "a" | "b" | null; outcome: string | null; round: number | null; division: string; event: string;
}
export interface MockFighter { id: string; name: string; birthYear: number; division: string; country: string; /** what the feed's `nationality` says when it is not the country's name (a demonym, a home nation), with its own `nationality_code` */ nationality?: string; code?: string }
export interface MockWorld { today: string; fighters: Map<string, MockFighter>; fights: MockFight[]; careers: Map<string, { wins: number; losses: number; draws: number }>; /** set by `degradeWorld`: the fighters whose vendor totals were made too low */ faults?: { wrongTotals: string[] } }

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

/**
 * What the real feed looked like on the first full fetch, laid over a clean league (which always adds up, so it cannot show the load-day paths):
 * - `priorShare`: this share of fighters has an earlier career the fight list does not reach, so the vendor's total is above what their fights add up to (partial);
 * - `unrecorded`: this many finished fights have no winner but a decision outcome, and the vendor's totals do NOT count them (a result not yet posted: the importer's draw guess made these conflicts);
 * - `wrongTotals`: this many fighters have a vendor total of wins one below what their fights give (a wrong winner, a stale total, an exhibition counted in the list: a conflict nothing in the fights explains; their ids are in `world.faults`);
 * - `disagree`: this many fights are listed again a day later with the OTHER fighter as winner (the vendor counts the original once);
 * - `reversed`: this many fights have their winner reversed in the fight list while the vendor's totals stay as they were (the list's flag is the wrong way round: both fighters' records come out wrong, in opposite directions);
 * - `duplicates`: this many fights are listed twice (same pair, same card) while the vendor's totals count them once (a conflict: "repeat" and "same-day").
 * The league is changed in place and returned; deterministic for a seed.
 */
export function degradeWorld(w: MockWorld, o: { seed?: number; priorShare?: number; unrecorded?: number; duplicates?: number; wrongTotals?: number; disagree?: number; reversed?: number }): MockWorld {
  const rand = mulberry32(o.seed ?? 3);
  const done = w.fights.filter((f) => f.status === "FINISHED");
  const career = (id: string) => w.careers.get(id) ?? w.careers.set(id, { wins: 0, losses: 0, draws: 0 }).get(id)!;
  const drop = (f: MockFight) => { // the vendor's totals leave the fight out
    if (f.winner === "a") { career(f.a).wins--; career(f.b).losses--; } else if (f.winner === "b") { career(f.b).wins--; career(f.a).losses--; } else { career(f.a).draws--; career(f.b).draws--; }
  };
  const used = new Set<string>();
  const decided = done.filter((f) => f.winner !== null); // a fight that already has no winner is a real draw: leave those alone
  const pick = () => { for (let k = 0; k < 20; k++) { const f = decided[Math.floor(rand() * decided.length)]; if (!used.has(f.id)) { used.add(f.id); return f; } } return null; };
  for (let i = 0; i < (o.unrecorded ?? 0); i++) { const f = pick(); if (!f) break; drop(f); f.winner = null; f.outcome = "UD"; f.round = null; }
  for (let i = 0; i < (o.reversed ?? 0); i++) { const f = pick(); if (f) f.winner = f.winner === "a" ? "b" : "a"; } // the fight list only: `careers` keep the true results
  const copies: MockFight[] = [];
  for (let i = 0; i < (o.duplicates ?? 0); i++) { const f = pick(); if (f) copies.push({ ...f, id: `d${i}` }); }
  for (let i = 0; i < (o.disagree ?? 0); i++) {
    const f = pick(); if (!f) break;
    const d = new Date(Date.parse(`${f.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    copies.push({ ...f, id: `g${i}`, date: d, event: `${f.event}-g${i}`, winner: f.winner === "a" ? "b" : "a", outcome: "UD", round: null });
  }
  w.fights.push(...copies);
  const wrong: string[] = [];
  for (const [id, c] of w.careers) { if (wrong.length >= (o.wrongTotals ?? 0)) break; if (c.wins >= 3 && rand() < 0.05) { c.wins--; wrong.push(id); } }
  w.faults = { wrongTotals: wrong };
  for (const id of new Set(done.flatMap((f) => [f.a, f.b]))) {
    if (rand() < (o.priorShare ?? 0)) { const c = career(id); c.wins += 1 + Math.floor(rand() * 8); c.losses += Math.floor(rand() * 5); }
  }
  return w;
}

/**
 * The things the real feed does that a clean league does not, laid over a league (in place, deterministic for a seed). Every one of them is something the importer had to learn
 * from the first real cache, so this is the league to prove the whole load-and-audit path on:
 * - `cancelled`: this many decided fights are listed as CANCELLED (no result; the vendor's totals do not count them); every other one shares the card of a fight that went ahead, so half of them are on a card that stays and half are a card of their own;
 * - `cancelledCards`: this many whole cards of nothing but CANCELLED fights;
 * - `amateur`: this many decided fights sit on an Olympic or games card (the vendor's totals leave them out; the fight list has them as ordinary fights);
 * - `demonyms`: fighters whose nationality is a demonym with its ISO code ("Mexican"/MX), a home nation ("Scottish"/SC) or a spelling with a note ("Croatia (Hrvatska)"/HR);
 * - `belts`: this many decided fights carry a belt, in the feed's spelling (a body, a modifier, "World", a division, "Champion").
 */
const DEMONYM: Record<string, [string, string]> = { Mexico: ["Mexican", "MX"], Japan: ["Japanese", "JP"], "United States": ["American", "US"], Ukraine: ["Ukrainian", "UA"], Philippines: ["Filipino", "PH"], Nigeria: ["Nigerian", "NG"], Argentina: ["Argentine", "AR"], Germany: ["German", "DE"], Cuba: ["Cuban", "CU"], "United Kingdom": ["British", "GB"] };
const BELTS = ["WBC World Welterweight Champion", "WBA Super World Lightweight Champion", "IBF Interim World Heavyweight Champion", "The Ring Middleweight Champion", "WBO World Junior Welterweight Champion", "WBA World Minimumweight"];
export function addQuirks(w: MockWorld, o: { seed?: number; cancelled?: number; cancelledCards?: number; amateur?: number; demonyms?: boolean; belts?: number }): MockWorld {
  const rand = mulberry32(o.seed ?? 5);
  const career = (id: string) => w.careers.get(id) ?? w.careers.set(id, { wins: 0, losses: 0, draws: 0 }).get(id)!;
  const drop = (f: MockFight) => { if (f.winner === "a") { career(f.a).wins--; career(f.b).losses--; } else if (f.winner === "b") { career(f.b).wins--; career(f.a).losses--; } else { career(f.a).draws--; career(f.b).draws--; } };
  const decided = w.fights.filter((f) => f.status === "FINISHED" && f.winner !== null && !f.id.startsWith("d") && !f.id.startsWith("g"));
  const used = new Set<string>();
  const pick = () => { for (let k = 0; k < 30; k++) { const f = decided[Math.floor(rand() * decided.length)]; if (f && !used.has(f.id)) { used.add(f.id); return f; } } return null; };
  // every other cancelled fight is put on a card that went ahead (a card with one fight cancelled stays); the rest keep their own card, which is then nothing but a cancelled fight
  for (let i = 0; i < (o.cancelled ?? 0); i++) {
    const f = pick(); if (!f) break;
    drop(f); f.status = "CANCELLED"; f.winner = null; f.outcome = null; f.round = null;
    if (i % 2 === 0) { const host = pick(); if (host) { f.event = host.event; f.date = host.date; } }
  }
  for (let i = 0; i < (o.amateur ?? 0); i++) { const f = pick(); if (!f) break; drop(f); f.eventTitle = i % 2 ? `2016 Rio Olympics: Boxing Day ${1 + (i % 11)}` : `2014 Glasgow Commonwealth Games: Boxing Day ${1 + (i % 7)}`; }
  for (let i = 0; i < (o.belts ?? 0); i++) { const f = pick(); if (!f) break; f.titles = [BELTS[i % BELTS.length]]; }
  const ids = [...w.fighters.keys()];
  for (let i = 0; i < (o.cancelledCards ?? 0); i++) {
    const a = ids[Math.floor(rand() * ids.length)], A = w.fighters.get(a)!;
    const b = ids.find((id) => id !== a && w.fighters.get(id)!.division === A.division); if (!b) continue;
    const date = new Date(Date.parse(`${w.today}T00:00:00Z`) - (30 + i * 11) * 86400000).toISOString().slice(0, 10);
    for (let k = 0; k < 2; k++) w.fights.push({ id: `cc${i}-${k}`, date, a, b, status: "CANCELLED", winner: null, outcome: null, round: null, division: A.division, event: `cc${i}` });
  }
  if (o.demonyms) {
    [...w.fighters.values()].forEach((f, i) => {
      if (i % 9 === 0) { f.nationality = "Scottish"; f.code = "SC"; }
      else if (i % 11 === 0) { f.nationality = "Croatia (Hrvatska)"; f.code = "HR"; }
      else if (i % 3 === 0 && DEMONYM[f.country]) [f.nationality, f.code] = DEMONYM[f.country];
    });
  }
  return w;
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
    event: { id: f.event, title: f.eventTitle ?? `Card ${f.event}`, date: `${f.date}T00:00:00`, location: city, venue: "Arena" },
    division: { name: f.division }, titles: (f.titles ?? []).map((name, i) => ({ name, id: `t${i}` })),
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
const BODIES = [
  { id: "o1", name: "International Boxing Federation", slug: "ibf" }, { id: "o2", name: "World Boxing Association", slug: "wba" },
  { id: "o3", name: "World Boxing Council", slug: "wbc" }, { id: "o4", name: "World Boxing Organization (WBO)", slug: "world-boxing-organization" },
];
/** One page of `/v2/rankings/` as the docs show it: a division (heavyweight first), one entry per body, champions apart from the ranked contenders, and the odd gap: a fighter nobody else knows and a vacant place. */
function apiRankings(w: MockWorld, page: number) {
  const name = DIVISIONS[page - 1];
  const here = [...w.fighters.values()].filter((f) => f.division === name).sort((x, y) => (w.careers.get(y.id)?.wins ?? 0) - (w.careers.get(x.id)?.wins ?? 0) || (x.id < y.id ? -1 : 1));
  return BODIES.map((org, k) => {
    const pool = here.slice(k % Math.max(1, here.length)).concat(here.slice(0, k % Math.max(1, here.length)));
    const champ = pool[0];
    const rest = pool.slice(1, 9);
    const rankings: { rank: number; fighter_id: string | null; fighter_name: string | null; is_vacant: boolean }[] = rest.map((f, i) => ({ rank: i + 1, fighter_id: f.id, fighter_name: f.name, is_vacant: false }));
    rankings.push({ rank: rest.length + 1, fighter_id: `unseen-${org.slug}-${page}`, fighter_name: `Unlisted Fighter ${page}`, is_vacant: false });
    rankings.push({ rank: rest.length + 2, fighter_id: null, fighter_name: null, is_vacant: true });
    return {
      id: `r${page}-${k}`, organization: org, division: { id: `div${page}`, name, weight_lb: null, weight_kg: null }, gender: "male",
      title_ids: { full: `t${page}-${k}`, regular: null, interim: null }, updated_at: `${w.today}T00:00:00.000000`,
      champions: champ ? [{ fighter_id: champ.id, fighter_name: champ.name, title_type: "full", is_vacant: false }] : [{ fighter_id: null, fighter_name: null, title_type: "full", is_vacant: true }],
      rankings,
    };
  });
}
function apiFighter(w: MockWorld, id: string) {
  const p = w.fighters.get(id)!, c = w.careers.get(id) ?? { wins: 0, losses: 0, draws: 0 };
  return {
    id, name: p.name, alias: null, gender: "m", birth_year: p.birthYear, height: null, height_cm: 160 + (p.birthYear % 30), height_in: null, nationality: p.nationality ?? p.country, nationality_code: p.code ?? "XX", nickname: null,
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
    if (p === "/v2/rankings/") {
      if (o.rankings === "refused") return { status: 403, body: { message: "this plan does not include rankings" } };
      const page = Number(q.get("page_num") ?? 1);
      if (!(page >= 1 && page <= DIVISIONS.length)) return { status: 200, body: env([], { pagination: { page, items: 0, total_pages: DIVISIONS.length, total_items: DIVISIONS.length * 4 } }) };
      return { status: 200, body: env(apiRankings(w, page), { pagination: { page, items: 4, total_pages: DIVISIONS.length, total_items: DIVISIONS.length * 4 } }) };
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
