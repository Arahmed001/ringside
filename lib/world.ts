import type { DatabaseSync, StatementSync } from "node:sqlite";
import { getDb, dbVersion, openSnapshot } from "./db";
import { collectGarbage } from "./gc";
import { applyFittedWeights } from "./model-fit";
import { snapshotUpcomingSafe } from "./ledger";
import { currentYear, todayIso } from "./clock";
import { countsInRecord, isStoppage } from "./methods";
import { buildOfficial, type OfficialIndex, type OfficialRow } from "./official";
import { officialRankingsShown } from "./site-info";
import type { Boxer, BoxerFull, BoutRow, Broadcast, Corner, Earning, Honour, TitleReign, Venue, EventFinancials, EventRow, Purse, Method, Official, Org, Person, Picture, Scorecard, Status, TeamStint, WeighIn } from "./types";

/** Punches over a whole bout, one entry per fighter (in the order the rows were stored; match by `boxers`). */
export interface PunchTotals { boxers: number[]; landed: number[]; thrown: number[]; /** rounds with their own rows; 0 when the feed only has a whole-fight total */ rounds: number }

/** The supplier's career knockouts and times stopped, when stored and no larger than the wins or losses they are part of. */
function supplierTotals(r: Record<string, unknown>): { koWins?: number; stopped?: number } {
  const ok = (x: unknown, of: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && typeof of === "number" && x <= of;
  return { ...(ok(r.vendor_ko_wins, r.vendor_wins) ? { koWins: r.vendor_ko_wins as number } : {}), ...(ok(r.vendor_stopped, r.vendor_losses) ? { stopped: r.vendor_stopped as number } : {}) };
}

/** The stored scores (a JSON list of "116-109" strings) back to a list; anything that is not that is none. */
function parseScores(v: unknown): string[] | null {
  if (typeof v !== "string") return null;
  try { const a = JSON.parse(v); return Array.isArray(a) && a.every((x) => typeof x === "string") && a.length ? a : null; } catch { return null; }
}

export interface World {
  today: string;
  boxers: BoxerFull[];
  byId: Map<number, BoxerFull>;
  bySlug: Map<string, BoxerFull>;
  bouts: BoutRow[]; // chronological
  events: EventRow[];
  boutById: Map<number, BoutRow>;
  eventById: Map<number, EventRow>;
  boutsByBoxer: Map<number, BoutRow[]>; // chronological
  boutsByEvent: Map<number, BoutRow[]>; // main event first
  history: Map<number, { date: string; rating: number; boutId: number; opp: number }[]>;
  boutPre: Map<number, { red: number; blue: number }>; // pre-fight ratings
  people: Map<number, Person>;
  peopleBySlug: Map<string, Person>;
  roles: Map<number, Set<string>>; // person id -> trainer / manager / judge / referee ...
  orgs: Map<number, Org>;
  orgsBySlug: Map<string, Org>;
  stints: TeamStint[];
  stintsByBoxer: Map<number, TeamStint[]>; // chronological
  stintsByPerson: Map<number, TeamStint[]>;
  stintsByOrg: Map<number, TeamStint[]>;
  weighInsByBout: Map<number, WeighIn[]>;
  weighInsByBoxer: Map<number, WeighIn[]>; // chronological
  officialsByBout: Map<number, Official[]>;
  officialsByPerson: Map<number, Official[]>; // every assignment a judge or referee has worked
  scorecardsByBout: Map<number, Scorecard[]>;
  cornersByBout: Map<number, Corner[]>;
  financialsByEvent: Map<number, EventFinancials[]>; // one row per source
  pursesByBout: Map<number, Purse[]>;
  pursesByBoxer: Map<number, Purse[]>;
  broadcastsByEvent: Map<number, Broadcast[]>;
  earningsByBoxer: Map<number, Earning[]>;
  venueOf: (e: { venue: string; city: string }) => Venue | null; // only venues verified on Wikidata
  /** a sanctioning body's belt (by code: WBA, WBC, IBF, WBO) and an organisation's logo (by org id), where a free-licensed one was found */
  beltPicture: (code: string) => Picture | null;
  orgLogo: (orgId: number) => Picture | null;
  /** every picture of those three kinds, for the list of outside hosts the privacy page declares */
  pictureList: Picture[];
  reignsByBoxer: Map<number, TitleReign[]>; // linked reigns only, by start
  /** the sanctioning bodies' official lists (lib/official.ts), apart from our own rankings */
  official: OfficialIndex;
  honoursByBoxer: Map<number, Honour[]>; // hall of fame first, then awards, then titles; each by year
  /** Whole-bout punch totals, read from punch_stats the first time something asks (about 1 s at 160k bouts, so not part of the build). */
  punchTotals: () => Map<number, PunchTotals>;
}

interface Refresh {
  /** the newest version seen while the served world was behind it, and when it first and last moved */
  seen?: string; lastChange: number; firstChange: number;
  timer?: ReturnType<typeof setTimeout>;
  /** a background rebuild in progress */
  building?: Promise<void>;
  /** the version a rebuild failed on (logged once), and when to try again */
  failedKey?: string; retryAt: number;
}
const g = globalThis as unknown as { __world?: World; __worldKey?: string; __worldBuild?: Promise<World>; __worldGen?: number; __worldRefresh?: Refresh };

/**
 * A world stays valid until something it was built from changes: the calendar day (upcoming vs past, ages and
 * ranking windows all hang off "today") or the database itself (see `dbVersion`). Checking is a pair of one-row
 * lookups; the rebuild is not (about 4.7 s at 160k bouts), which is why it no longer runs on a timer.
 */
const worldKey = (db: DatabaseSync) => `${todayIso()}|${dbVersion(db)}`;
/** "day|dataVersion.run.bump": the day and our own bump decide whether an old world may still be shown; only the first two parts move for another process's commits */
const keyParts = (k: string) => { const [day, v] = k.split("|"); const [dv, run, bump] = v.split("."); return { day, ext: `${dv}.${run}`, bump }; };

export function invalidateWorld() {
  g.__world = undefined;
  g.__worldKey = undefined;
  g.__worldGen = (g.__worldGen ?? 0) + 1;
  const r = g.__worldRefresh;
  if (r?.timer) clearTimeout(r.timer);
  g.__worldRefresh = undefined;
}

/**
 * How long the data must stay unchanged before the world is rebuilt (RINGSIDE_WORLD_SETTLE_MS, default 5 s). One update by another process commits several
 * times (its fights, then its recomputed ratings, then its run record), each of which moves `dbVersion`; waiting for quiet turns them into one rebuild.
 */
const settleMs = () => {
  const raw = process.env.RINGSIDE_WORLD_SETTLE_MS;
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 5000;
};
/** A writer that never goes quiet must not keep the site on an old world for ever: rebuild after this long whatever happens. */
const MAX_WAIT_MS = 60_000;
const RETRY_AFTER_FAIL_MS = 60_000;

/**
 * Lets the event loop answer the requests that are waiting: called from inside the build, so a rebuild runs in slices of about 25 ms, not as one block of
 * seconds (a 4.7 s block was what visitors waited behind). A slice that has run 25 ms yields once.
 */
let sliceStart = 0;
/** Above zero while a rebuild runs in the background: nobody is waiting for it, so it gives way for longer (see `pause`). */
let gentle = 0;
export async function pause(): Promise<void> {
  const now = performance.now();
  if (now - sliceStart < 25) return;
  // A request takes several turns of the event loop to answer (the database, the render, the stream), and the build gets a turn between each. Giving way for one
  // turn per slice made a request wait for a dozen slices; a background rebuild sleeps a little instead, so a request gets whole stretches of the thread between slices.
  await new Promise<void>((r) => (gentle > 0 ? setTimeout(r, 15) : setImmediate(r)));
  sliceStart = performance.now();
}

export async function getWorld(): Promise<World> {
  const db = await getDb();
  const key = worldKey(db);
  if (g.__world && g.__worldKey === key) return g.__world;
  // The data changed under a world we hold, by another process's commit and not our own bump or the calendar: keep answering from the world we have
  // and rebuild in the background once the commits have stopped (stale while revalidate), instead of making every visitor wait for the build.
  if (g.__world && g.__worldKey) {
    const have = keyParts(g.__worldKey), want = keyParts(key);
    if (have.day === want.day && have.bump === want.bump) { noteChange(db, key); return g.__world; }
    // A new calendar day is the same: yesterday's world is still a whole, consistent answer, and the new one is built beside it in slices and warmed before it is shown
    // (docs/capacity.md, "Midnight"), where it used to be built at once with every visitor waiting. Our own write, invalidateWorld() and the first build still wait.
    if (have.day !== want.day && have.bump === want.bump && dayRollsInBackground()) { startDayRebuild(db, key); return g.__world; }
  }
  // Nothing to show (first build, a new day, our own write, invalidateWorld): visitors wait, and they all wait for the same build.
  return buildShared(db, key);
}

let dayMode: "background" | "block" | undefined;
/**
 * How a new calendar day is taken: "background" (the default: keep serving the old world, build the new one beside it) or "block" (every visitor waits for the
 * build). A pinned clock (RINGSIDE_NOW: tests, reproducible runs) means "block", because those callers move the date by hand and expect the next call to see it;
 * `setDayRollover` is how a test that wants to exercise the real behaviour says so.
 */
const dayRollsInBackground = () => (dayMode ?? (process.env.RINGSIDE_NOW ? "block" : "background")) === "background";
export function setDayRollover(mode: "background" | "block" | undefined) { dayMode = mode; }

/** The new day's world, built in slices behind the old one. Many requests call this; the first starts the build and the rest find it running (or, after a failure, waiting to retry). */
function startDayRebuild(db: DatabaseSync, key: string) {
  const r = (g.__worldRefresh ??= { lastChange: Date.now(), firstChange: Date.now(), retryAt: 0 });
  if (r.building) return;
  if (r.failedKey === key && Date.now() < r.retryAt) return; // it failed on this very data a moment ago: keep showing yesterday's world and try again later
  void rebuildInBackground(db, key, r);
}

/** Resolves when the background rebuild that is running now (a new day's, or a data change's) has been shown or has failed; at once when none is running. */
export async function whenRebuilt(): Promise<void> { await g.__worldRefresh?.building; }

function buildShared(db: DatabaseSync, key: string): Promise<World> {
  if (!g.__worldBuild) {
    const gen = g.__worldGen ?? 0;
    const p: Promise<World> = buildAndPublish(db, key, gen).finally(() => { if (g.__worldBuild === p) g.__worldBuild = undefined; });
    g.__worldBuild = p;
  }
  return g.__worldBuild;
}

async function buildAndPublish(db: DatabaseSync, key: string, gen: number, beforePublish?: (w: World) => Promise<void>): Promise<World> {
  const previous = g.__worldKey;
  const t0 = performance.now();
  const built = await buildWorld(db, key);
  // a rebuild is a several-second event at scale and discards everything computed on the old world: say when and why (the key is "day|data version")
  if (process.env.NODE_ENV === "production" || process.env.RINGSIDE_MEMO_LOG === "1") console.log(JSON.stringify({ event: "world_built", ms: Math.round(performance.now() - t0), key, previous: previous ?? null, bouts: built.bouts.length }));
  // a background rebuild: what the build left behind (the scratch maps, the strings of rows already turned into objects) goes now, before the warm-up adds to it
  if (beforePublish) { await collectGarbage(); await beforePublish(built); }
  if ((g.__worldGen ?? 0) !== gen) return built; // invalidated while it was building: it is not shown, and whoever asks next builds again
  g.__world = built; g.__worldKey = key; // the swap: one assignment, so a request sees the whole old world or the whole new one
  if (beforePublish && (process.env.NODE_ENV === "production" || process.env.RINGSIDE_MEMO_LOG === "1")) console.log(JSON.stringify({ event: "world_swapped", ms: Math.round(performance.now() - t0), key })); // build and warm-up together: how long the data waited to be shown
  snapshotUpcomingSafe(db, built); // write today's pre-fight predictions down (lib/ledger.ts); never fails a page
  // the world it replaced, with everything computed on it, is garbage now (several hundred MB at the real size): collect it now, not whenever V8 gets round to it
  if (previous !== undefined) void collectGarbage();
  return built;
}

/** Called by a request that found the data newer than the world: starts the settle timer if it is not running. Cheap; many requests call it. */
function noteChange(db: DatabaseSync, key: string) {
  const now = Date.now();
  const r = (g.__worldRefresh ??= { lastChange: now, firstChange: now, retryAt: 0 });
  if (r.seen !== key) { if (r.seen === undefined) r.firstChange = now; r.seen = key; r.lastChange = now; }
  if (r.timer || r.building) return;
  const arm = (ms: number) => { r.timer = setTimeout(check, ms); r.timer.unref(); };
  const check = () => {
    r.timer = undefined;
    const t = Date.now(), settle = settleMs();
    let cur: string;
    try { cur = worldKey(db); } catch { return arm(1000); }
    if (g.__world && g.__worldKey === cur) { r.seen = undefined; return; } // changed back, or somebody rebuilt: nothing to do
    if (cur !== r.seen) { r.seen = cur; r.lastChange = t; }
    const quiet = t - r.lastChange >= settle, waited = t - r.firstChange >= MAX_WAIT_MS;
    if (!quiet && !waited) return arm(Math.max(20, Math.min(settle - (t - r.lastChange), 1000)));
    if (r.failedKey === cur && t < r.retryAt) return; // it failed on this very data a moment ago: the next request that finds it still behind starts the wait again, and a repair (a new version) goes ahead at once
    void rebuildInBackground(db, cur, r);
  };
  arm(settleMs());
}

async function rebuildInBackground(db: DatabaseSync, key: string, r: Refresh) {
  const gen = g.__worldGen ?? 0;
  r.building = (async () => {
    try {
      // the aggregates the pages share are computed on the NEW world before it is shown, so the first visitors after the swap do not pay for them
      gentle++;
      await buildAndPublish(db, key, gen, async (w) => { const { warmAggregates } = await import("./warm"); await warmAggregates(w, { gentle: true }); });
      r.failedKey = undefined;
    } catch (e) {
      // keep serving the old world; say so once per version of the data, and try again later
      if (r.failedKey !== key) console.error(`[ringside] world rebuild failed (${e instanceof Error ? e.message : String(e)}); still showing the previous data, will retry`);
      r.failedKey = key; r.retryAt = Date.now() + RETRY_AFTER_FAIL_MS;
    } finally { gentle--; r.building = undefined; r.seen = undefined; r.firstChange = Date.now(); }
  })();
  await r.building;
}

/** `a.map(f)` that lets the event loop answer requests every 1,024 items (see `pause`). */
async function mapSlices<T, U>(a: readonly T[], f: (x: T) => U): Promise<U[]> {
  const out = new Array<U>(a.length);
  for (let i = 0; i < a.length; i++) { out[i] = f(a[i]); if ((i & 1023) === 1023) await pause(); }
  return out;
}

/**
 * The rows of a query one at a time, mapped as they come, letting the event loop answer requests every 1,024 rows (see `pause`). `.all()` first held every raw row
 * of the table (a plain object with thirty fields and its own copy of every string, 160,000 times for the bouts): a third of a gigabyte of garbage per rebuild.
 */
async function mapRows<U>(stmt: StatementSync, f: (r: Record<string, unknown>) => U): Promise<U[]> {
  const out: U[] = [];
  let i = 0;
  for (const r of stmt.iterate() as Iterable<Record<string, unknown>>) { out.push(f(r)); if ((++i & 1023) === 0) await pause(); }
  return out;
}

/** A stored number that is really there: NULL, and the 0 an older load wrote for "unknown", are both unknown. */
const known = (v: unknown): number | null => (typeof v === "number" && v > 0 ? v : null);

/**
 * Builds from a read snapshot on a connection of its own, so the build can give way to requests between steps (`pause`) and still see one consistent
 * state of the data (another process's update may commit meanwhile; the next check then sees a newer version and builds again). `main` is kept for
 * what the world reads later, on demand (punch totals).
 */
async function buildWorld(main: DatabaseSync, key: string): Promise<World> {
  let snap: DatabaseSync | null = null;
  try { snap = openSnapshot(); } catch { snap = null; } // no second connection (a read-only volume, say): read from the shared one
  try { return await buildWorldFrom(snap ?? main, main, key); } finally { try { snap?.exec("ROLLBACK"); snap?.close(); } catch { /* closing is best effort */ } }
}

async function buildWorldFrom(db: DatabaseSync, main: DatabaseSync, key: string): Promise<World> {
  void key;
  const today = todayIso();
  // Every string the database hands over is a new string, so "Heavyweight" was stored once per fight (160,000 times) and a date once per rating-history row. Values that repeat are
  // kept once: `S` returns the first copy it saw. The pool only lives for the build; the objects keep the strings.
  const pool = new Map<string, string>();
  const S = <T extends string | null | undefined>(v: T): T => { if (typeof v !== "string") return v; const have = pool.get(v); if (have !== undefined) return have as T; pool.set(v, v); return v; };

  const boxersBase: Boxer[] = await mapRows(db.prepare("SELECT * FROM boxers"), (r) => ({
    id: r.id as number, slug: r.slug as string, name: r.name as string, nickname: (r.nickname as string) ?? null,
    country: S(r.country as string), birthYear: known(r.birth_year), stance: S(r.stance as Boxer["stance"]) || null, sex: ((r.sex as string) === "female" ? "female" : "male"),
    heightCm: known(r.height_cm), reachCm: known(r.reach_cm), weightClass: S(r.weight_class as string),
    turnedPro: known(r.turned_pro), active: !!r.active, rating: r.rating as number,
    recordDisputed: r.record_disputed === 1,
    vendorRecord: [r.vendor_wins, r.vendor_losses, r.vendor_draws].every((x) => typeof x === "number" && x >= 0) ? { wins: r.vendor_wins as number, losses: r.vendor_losses as number, draws: r.vendor_draws as number, ...supplierTotals(r) } : null,
    photoUrl: (r.photo_url as string) ?? null,
    photoCredit: r.photo_credit ? (JSON.parse(r.photo_credit as string) as Boxer["photoCredit"]) : null,
    birthDate: (r.birth_date as string) ?? null, birthPlace: S((r.birth_place as string) ?? null), residence: S((r.residence as string) ?? null),
    wikidataId: (r.wikidata_id as string) ?? null, boxrecId: (r.boxrec_id as string) ?? null,
    ibhofId: (r.ibhof_id as string) ?? null, olympediaId: (r.olympedia_id as string) ?? null, wikipediaTitle: (r.wikipedia_title as string) ?? null,
    aliases: r.aliases ? (JSON.parse(r.aliases as string) as string[]) : [],
    debutDate: S((r.debut_date as string) ?? null), retiredDate: S((r.retired_date as string) ?? null),
  }));

  const events = (db.prepare("SELECT * FROM events ORDER BY date").all() as Record<string, unknown>[]).map((e): EventRow => ({
    id: e.id as number, name: e.name as string, date: e.date as string, venue: e.venue as string,
    city: e.city as string, country: e.country as string,
    // a cancelled event never counts as upcoming; a postponed one does, under its new date
    status: ((e.status as Status | null) ?? ((e.date as string) > today ? "scheduled" : "completed")),
    upcoming: (e.date as string) > today && (e.status as string | null) !== "cancelled",
    posterUrl: (e.poster_url as string) ?? null,
    promoterOrgId: (e.promoter_org_id as number) ?? null, broadcaster: (e.broadcaster as string) ?? null, attendance: (e.attendance as number) ?? null,
  }));

  const nameOf = new Map(boxersBase.map((b) => [b.id, b]));
  const evOf = new Map(events.map((e) => [e.id, e]));
  await pause();
  const bouts = (await mapRows(db.prepare("SELECT * FROM bouts"), (b): BoutRow => {
      const ev = evOf.get(b.event_id as number)!;
      const red = nameOf.get(b.red_id as number)!, blue = nameOf.get(b.blue_id as number)!;
      return {
        id: b.id as number, eventId: ev.id, eventName: ev.name, date: ev.date,
        status: S((b.status as Status | null) ?? (b.method ? "completed" : ev.date > today ? "scheduled" : "completed")),
        upcoming: ev.upcoming && (b.status as string | null) !== "cancelled" && !b.method,
        redId: red.id, blueId: blue.id, redName: red.name, blueName: blue.name, redSlug: red.slug, blueSlug: blue.slug,
        weightClass: S(b.weight_class as string), rounds: b.rounds as number, winnerId: (b.winner_id as number) ?? null,
        method: S((b.method as Method) ?? null), endRound: (b.end_round as number) ?? null,
        title: S((b.title as string) ?? null), position: b.position as number,
        vendorScores: parseScores(b.vendor_scores), roundTime: S((b.round_time as string) ?? null), kdRed: (b.kd_red as number) ?? 0, kdBlue: (b.kd_blue as number) ?? 0,
        oddsRed: (b.odds_red as number) ?? null, oddsBlue: (b.odds_blue as number) ?? null, contractLb: (b.contract_lb as number) ?? null,
        titleOrgId: (b.title_org_id as number) ?? null, titleVacant: !!b.title_vacant,
      };
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  await pause();

  const boutsByBoxer = new Map<number, BoutRow[]>();
  for (const b of bouts) for (const id of [b.redId, b.blueId]) {
    if (!boutsByBoxer.has(id)) boutsByBoxer.set(id, []);
    boutsByBoxer.get(id)!.push(b);
  }
  await pause();

  // ----- people, organisations, team history, weigh-ins, officials -----
  const people = new Map<number, Person>(), orgs = new Map<number, Org>();
  for (const r of db.prepare("SELECT * FROM people").all() as Record<string, unknown>[])
    people.set(r.id as number, { id: r.id as number, slug: r.slug as string, name: r.name as string, country: (r.country as string) ?? null, wikidataId: (r.wikidata_id as string) ?? null });
  for (const r of db.prepare("SELECT * FROM orgs").all() as Record<string, unknown>[])
    orgs.set(r.id as number, { id: r.id as number, slug: r.slug as string, name: r.name as string, kind: r.kind as Org["kind"], country: (r.country as string) ?? null, city: (r.city as string) ?? null });

  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  const roles = new Map<number, Set<string>>();
  const addRole = (id: number, role: string) => { const s = roles.get(id); if (s) s.add(role); else roles.set(id, new Set([role])); };

  const stints: TeamStint[] = (db.prepare("SELECT * FROM team_stints ORDER BY start_date, id").all() as Record<string, unknown>[]).map((r) => ({
    id: r.id as number, boxerId: r.boxer_id as number, role: r.role as TeamStint["role"], personId: (r.person_id as number) ?? null, orgId: (r.org_id as number) ?? null,
    start: (r.start_date as string) ?? null, end: (r.end_date as string) ?? null, source: S(r.source as string), sourceUrl: (r.source_url as string) ?? null, note: (r.note as string) ?? null,
  }));
  const stintsByBoxer = new Map<number, TeamStint[]>(), stintsByPerson = new Map<number, TeamStint[]>(), stintsByOrg = new Map<number, TeamStint[]>();
  for (const st of stints) {
    push(stintsByBoxer, st.boxerId, st);
    if (st.personId) { push(stintsByPerson, st.personId, st); addRole(st.personId, st.role.includes("trainer") || st.role === "strength_coach" || st.role === "cutman" ? "trainer" : st.role); }
    if (st.orgId) push(stintsByOrg, st.orgId, st);
  }

  const weighInsByBout = new Map<number, WeighIn[]>(), weighInsByBoxer = new Map<number, WeighIn[]>();
  for (const r of db.prepare("SELECT * FROM weigh_ins").all() as Record<string, unknown>[]) {
    const wi: WeighIn = { boutId: r.bout_id as number, boxerId: r.boxer_id as number, officialLb: (r.official_lb as number) ?? null, fightNightLb: (r.fight_night_lb as number) ?? null,
      limitLb: (r.limit_lb as number) ?? null, madeWeight: r.made_weight === null || r.made_weight === undefined ? null : !!r.made_weight, source: r.source as string };
    push(weighInsByBout, wi.boutId, wi); push(weighInsByBoxer, wi.boxerId, wi);
  }
  const boutDate = new Map(bouts.map((b) => [b.id, b.date]));
  for (const list of weighInsByBoxer.values()) list.sort((a, b) => (boutDate.get(a.boutId) ?? "").localeCompare(boutDate.get(b.boutId) ?? ""));

  const officialsByBout = new Map<number, Official[]>(), officialsByPerson = new Map<number, Official[]>();
  for (const r of db.prepare("SELECT * FROM officials ORDER BY seat").all() as Record<string, unknown>[]) {
    const o: Official = { boutId: r.bout_id as number, role: r.role as Official["role"], personId: r.person_id as number, seat: (r.seat as number) ?? null };
    push(officialsByBout, o.boutId, o); push(officialsByPerson, o.personId, o); addRole(o.personId, o.role);
  }
  const scorecardsByBout = new Map<number, Scorecard[]>();
  for (const r of db.prepare("SELECT * FROM scorecards ORDER BY seat").all() as Record<string, unknown>[])
    push(scorecardsByBout, r.bout_id as number, { boutId: r.bout_id as number, judgeId: r.judge_id as number, seat: r.seat as number, red: r.red_score as number, blue: r.blue_score as number });
  const cornersByBout = new Map<number, Corner[]>();
  for (const r of db.prepare("SELECT * FROM corners").all() as Record<string, unknown>[])
    push(cornersByBout, r.bout_id as number, { boutId: r.bout_id as number, boxerId: r.boxer_id as number, role: r.role as Corner["role"], personId: r.person_id as number });

  // ----- money -----
  const prov = (r: Record<string, unknown>) => ({ basis: S(r.basis as Purse["basis"]), source: S(r.source as string), sourceUrl: (r.source_url as string) ?? null, retrievedAt: S((r.retrieved_at as string) ?? null), note: (r.note as string) ?? null });
  const n0 = (v: unknown) => (v === null || v === undefined ? null : (v as number));
  const financialsByEvent = new Map<number, EventFinancials[]>();
  for (const r of db.prepare("SELECT * FROM event_financials").all() as Record<string, unknown>[])
    push(financialsByEvent, r.event_id as number, { eventId: r.event_id as number, gateUsd: n0(r.gate_usd), ticketsSold: n0(r.tickets_sold), capacity: n0(r.capacity), siteFeeUsd: n0(r.site_fee_usd), ppvBuys: n0(r.ppv_buys), ppvPriceUsd: n0(r.ppv_price_usd), ppvRevenueUsd: n0(r.ppv_revenue_usd), sponsorshipUsd: n0(r.sponsorship_usd), ...prov(r) });
  const pursesByBout = new Map<number, Purse[]>(), pursesByBoxer = new Map<number, Purse[]>();
  for (const r of db.prepare("SELECT * FROM purses").all() as Record<string, unknown>[]) {
    const p: Purse = { boutId: r.bout_id as number, boxerId: r.boxer_id as number, guaranteedUsd: n0(r.guaranteed_usd), bonusUsd: n0(r.bonus_usd), totalUsd: (r.total_usd as number) ?? 0, ...prov(r) };
    push(pursesByBout, p.boutId, p); push(pursesByBoxer, p.boxerId, p);
  }
  const broadcastsByEvent = new Map<number, Broadcast[]>();
  for (const r of db.prepare("SELECT * FROM event_broadcasts").all() as Record<string, unknown>[])
    push(broadcastsByEvent, r.event_id as number, { eventId: r.event_id as number, broadcaster: r.broadcaster as string, platform: r.platform as Broadcast["platform"], region: r.region as string, viewersAvg: n0(r.viewers_avg), viewersPeak: n0(r.viewers_peak), ...prov(r) });
  const earningsByBoxer = new Map<number, Earning[]>();
  for (const r of db.prepare("SELECT * FROM earnings ORDER BY year").all() as Record<string, unknown>[])
    push(earningsByBoxer, r.boxer_id as number, { boxerId: r.boxer_id as number, year: r.year as number, totalUsd: r.total_usd as number, ringUsd: n0(r.ring_usd), offRingUsd: n0(r.off_ring_usd), ...prov(r) });
  const honoursByBoxer = new Map<number, Honour[]>();
  const KIND_ORDER: Record<string, number> = { hall_of_fame: 0, award: 1, title: 2 };
  for (const r of db.prepare("SELECT * FROM honours ORDER BY year, label").all() as Record<string, unknown>[])
    push(honoursByBoxer, r.boxer_id as number, { boxerId: r.boxer_id as number, kind: S(r.kind as Honour["kind"]), label: S(r.label as string), year: n0(r.year), source: S(r.source as string) });
  for (const list of honoursByBoxer.values()) list.sort((a, b) => (KIND_ORDER[a.kind] ?? 3) - (KIND_ORDER[b.kind] ?? 3) || (a.year ?? 9999) - (b.year ?? 9999));

  const reignsByBoxer = new Map<number, TitleReign[]>();
  for (const r of db.prepare("SELECT * FROM title_reigns WHERE boxer_id IS NOT NULL ORDER BY start_date, org, division").all() as Record<string, unknown>[])
    push(reignsByBoxer, r.boxer_id as number, { boxerId: r.boxer_id as number, org: S(r.org as string), division: S(r.division as string), category: S(r.category as string), status: S((r.status as string | null) ?? null), start: (r.start_date as string | null) ?? null, end: (r.end_date as string | null) ?? null, current: r.current === 1, defences: n0(r.defences), endNote: (r.end_note as string | null) ?? null, source: S(r.source as string) });

  // on a licensed feed the official lists are shown only once the owner has confirmed the vendor allows it (lib/site-info.ts), whatever the database holds
  const official = buildOfficial(officialRankingsShown() ? (db.prepare("SELECT * FROM official_rankings").all() as unknown as OfficialRow[]) : []);

  // pictures of things that are not fighters: only the ones that passed the licence rules, with the credit each carries
  const pictures = { org_logo: new Map<string, Picture>(), belt: new Map<string, Picture>(), venue: new Map<string, Picture>() };
  for (const r of db.prepare("SELECT * FROM entity_media WHERE status = 'matched' AND thumb_url IS NOT NULL").all() as Record<string, unknown>[]) {
    const bucket = pictures[r.kind as keyof typeof pictures];
    if (bucket) bucket.set(r.ref as string, { url: r.thumb_url as string, credit: { text: r.credit as string, license: r.license as string, licenseUrl: (r.license_url as string) ?? null, pageUrl: r.page_url as string, source: "Wikimedia Commons" } });
  }
  const venues = new Map<string, Venue>();
  for (const r of db.prepare("SELECT * FROM venues WHERE status = 'matched'").all() as Record<string, unknown>[])
    venues.set(`${r.name}|${r.city}`, { name: r.name as string, city: r.city as string, wikidataId: r.wikidata_id as string, label: r.label as string, lat: n0(r.lat), lon: n0(r.lon), capacity: n0(r.capacity), picture: pictures.venue.get(`${r.name}|${r.city}`) ?? null });
  const venueOf = (e: { venue: string; city: string }) => venues.get(`${e.venue}|${e.city}`) ?? null;

  const boutsByEvent = new Map<number, BoutRow[]>();
  for (const b of bouts) push(boutsByEvent, b.eventId, b);
  for (const list of boutsByEvent.values()) list.sort((a, b) => b.position - a.position);

  const history = new Map<number, World["history"] extends Map<number, infer V> ? V : never>();
  const boutPre = new Map<number, { red: number; blue: number }>();
  await pause();
  const redOf = new Map(bouts.map((b) => [b.id, b.redId]));
  let hi = 0;
  for (const h of db.prepare("SELECT boxer_id, bout_id, date, rating, opp_rating FROM rating_history ORDER BY date, bout_id").iterate() as Iterable<{ boxer_id: number; bout_id: number; date: string; rating: number; opp_rating: number }>) {
    let list = history.get(h.boxer_id);
    if (!list) history.set(h.boxer_id, (list = []));
    list.push({ date: S(h.date), rating: h.rating, boutId: h.bout_id, opp: h.opp_rating });
    if ((++hi & 4095) === 0) await pause();
  }
  await pause();
  let pre_i = 0;
  for (const [id, hs] of history) {
    if ((++pre_i & 255) === 0) await pause();
    let prev = 1500;
    for (const h of hs) {
      const pre = boutPre.get(h.boutId) ?? { red: 1500, blue: 1500 };
      if (redOf.get(h.boutId) === id) pre.red = prev; else pre.blue = prev;
      boutPre.set(h.boutId, pre);
      prev = h.rating;
    }
  }

  const year = currentYear();
  await pause();
  const boxers = await mapSlices(boxersBase, (b): BoxerFull => {
    const list = (boutsByBoxer.get(b.id) ?? []).filter((x) => !x.upcoming && countsInRecord(x.method));
    let wins = 0, losses = 0, draws = 0, kos = 0, koLosses = 0, rounds = 0;
    for (const x of list) {
      rounds += x.endRound ?? x.rounds;
      if (x.winnerId === null) draws++;
      else if (x.winnerId === b.id) { wins++; if (isStoppage(x.method)) kos++; }
      else { losses++; if (isStoppage(x.method)) koLosses++; }
    }
    let streak: BoxerFull["streak"] = { type: "-", count: 0 };
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i].winnerId === null ? "D" : list[i].winnerId === b.id ? "W" : "L";
      if (streak.type === "-") streak = { type: t, count: 1 };
      else if (streak.type === t) streak.count++;
      else break;
    }
    const n = list.length;
    return {
      ...b, wins, losses, draws, kos, koLosses, bouts: n, koRate: wins ? kos / wins : 0,
      winRate: n ? wins / n : 0, avgRounds: n ? rounds / n : 0, lastFight: n ? list[n - 1].date : null,
      streak, age: b.birthYear === null ? null : year - b.birthYear,
    };
  });

  applyFittedWeights();
  let punchTotals: Map<number, PunchTotals> | null = null;
  const world: World = {
    today, boxers, byId: new Map(boxers.map((b) => [b.id, b])), bySlug: new Map(boxers.map((b) => [b.slug, b])),
    bouts, events, boutById: new Map(bouts.map((b) => [b.id, b])), eventById: evOf, boutsByBoxer, boutsByEvent, history, boutPre,
    people, peopleBySlug: new Map([...people.values()].map((p) => [p.slug, p])), roles,
    orgs, orgsBySlug: new Map([...orgs.values()].map((o) => [o.slug, o])),
    stints, stintsByBoxer, stintsByPerson, stintsByOrg, weighInsByBout, weighInsByBoxer, officialsByBout, officialsByPerson, scorecardsByBout, cornersByBout,
    financialsByEvent, pursesByBout, pursesByBoxer, broadcastsByEvent, earningsByBoxer, honoursByBoxer, reignsByBoxer, official, venueOf,
    beltPicture: (code) => pictures.belt.get(code.toUpperCase()) ?? null, orgLogo: (id) => pictures.org_logo.get(String(id)) ?? null, pictureList: [...pictures.org_logo.values(), ...pictures.belt.values(), ...pictures.venue.values()],
    punchTotals: () => {
      if (punchTotals) return punchTotals;
      punchTotals = new Map();
      // round 0 is the whole-fight total when a feed has one; otherwise the rounds are added up
      const rows = main.prepare(`SELECT bout_id, boxer_id,
          SUM(CASE WHEN round = 0 THEN landed END) AS l0, SUM(CASE WHEN round = 0 THEN thrown END) AS t0,
          SUM(CASE WHEN round > 0 THEN landed END) AS lr, SUM(CASE WHEN round > 0 THEN thrown END) AS tr,
          COUNT(CASE WHEN round > 0 THEN 1 END) AS r
        FROM punch_stats GROUP BY bout_id, boxer_id`).all() as { bout_id: number; boxer_id: number; l0: number | null; t0: number | null; lr: number | null; tr: number | null; r: number }[];
      for (const r of rows) {
        const e = punchTotals.get(r.bout_id) ?? punchTotals.set(r.bout_id, { boxers: [], landed: [], thrown: [], rounds: 0 }).get(r.bout_id)!;
        e.boxers.push(r.boxer_id); e.landed.push(r.l0 ?? r.lr ?? 0); e.thrown.push(r.t0 ?? r.tr ?? 0); e.rounds = Math.max(e.rounds, r.r);
      }
      return punchTotals;
    },
  };
  return world;
}

export { careerView, careerCounts, knockouts, koView, recordStr, type CareerView, type KoView } from "./career";
