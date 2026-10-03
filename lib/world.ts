import type { DatabaseSync } from "node:sqlite";
import { getDb, dbVersion } from "./db";
import { applyFittedWeights } from "./model-fit";
import { currentYear, todayIso } from "./clock";
import { countsInRecord, isStoppage } from "./methods";
import type { Boxer, BoxerFull, BoutRow, Broadcast, Corner, Earning, EventFinancials, EventRow, Purse, Method, Official, Org, Person, Scorecard, Status, TeamStint, WeighIn } from "./types";

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
}

const g = globalThis as unknown as { __world?: World; __worldKey?: string };

/**
 * A world stays valid until something it was built from changes: the calendar day (upcoming vs past, ages and
 * ranking windows all hang off "today") or the database itself (see `dbVersion`). Checking is a pair of one-row
 * lookups; the rebuild is not (about 3.6 s, blocking, at 160k bouts), which is why it no longer runs on a timer.
 */
const worldKey = (db: DatabaseSync) => `${todayIso()}|${dbVersion(db)}`;

export function invalidateWorld() {
  g.__world = undefined;
  g.__worldKey = undefined;
}

export async function getWorld(): Promise<World> {
  const db = await getDb();
  const key = worldKey(db);
  if (g.__world && g.__worldKey === key) return g.__world;
  // The build below is synchronous, so a request that was already waiting on getDb() when another one built the
  // world sees the fresh cache here instead of building a second copy (4 simultaneous callers used to build 4).
  return buildWorld(db, key);
}

function buildWorld(db: DatabaseSync, key: string): World {
  const today = todayIso();

  const rawBoxers = db.prepare("SELECT * FROM boxers").all() as Record<string, unknown>[];
  const boxersBase: Boxer[] = rawBoxers.map((r) => ({
    id: r.id as number, slug: r.slug as string, name: r.name as string, nickname: (r.nickname as string) ?? null,
    country: r.country as string, birthYear: r.birth_year as number, stance: r.stance as Boxer["stance"], sex: ((r.sex as string) === "female" ? "female" : "male"),
    heightCm: r.height_cm as number, reachCm: r.reach_cm as number, weightClass: r.weight_class as string,
    turnedPro: r.turned_pro as number, active: !!r.active, rating: r.rating as number,
    photoUrl: (r.photo_url as string) ?? null,
    photoCredit: r.photo_credit ? (JSON.parse(r.photo_credit as string) as Boxer["photoCredit"]) : null,
    birthDate: (r.birth_date as string) ?? null, birthPlace: (r.birth_place as string) ?? null, residence: (r.residence as string) ?? null,
    wikidataId: (r.wikidata_id as string) ?? null, boxrecId: (r.boxrec_id as string) ?? null,
    aliases: r.aliases ? (JSON.parse(r.aliases as string) as string[]) : [],
    debutDate: (r.debut_date as string) ?? null, retiredDate: (r.retired_date as string) ?? null,
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
  const bouts = (db.prepare("SELECT * FROM bouts").all() as Record<string, unknown>[])
    .map((b): BoutRow => {
      const ev = evOf.get(b.event_id as number)!;
      const red = nameOf.get(b.red_id as number)!, blue = nameOf.get(b.blue_id as number)!;
      return {
        id: b.id as number, eventId: ev.id, eventName: ev.name, date: ev.date,
        status: ((b.status as Status | null) ?? (b.method ? "completed" : ev.date > today ? "scheduled" : "completed")),
        upcoming: ev.upcoming && (b.status as string | null) !== "cancelled" && !b.method,
        redId: red.id, blueId: blue.id, redName: red.name, blueName: blue.name, redSlug: red.slug, blueSlug: blue.slug,
        weightClass: b.weight_class as string, rounds: b.rounds as number, winnerId: (b.winner_id as number) ?? null,
        method: (b.method as Method) ?? null, endRound: (b.end_round as number) ?? null,
        title: (b.title as string) ?? null, position: b.position as number,
        roundTime: (b.round_time as string) ?? null, kdRed: (b.kd_red as number) ?? 0, kdBlue: (b.kd_blue as number) ?? 0,
        oddsRed: (b.odds_red as number) ?? null, oddsBlue: (b.odds_blue as number) ?? null, contractLb: (b.contract_lb as number) ?? null,
        titleOrgId: (b.title_org_id as number) ?? null, titleVacant: !!b.title_vacant,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  const boutsByBoxer = new Map<number, BoutRow[]>();
  for (const b of bouts) for (const id of [b.redId, b.blueId]) {
    if (!boutsByBoxer.has(id)) boutsByBoxer.set(id, []);
    boutsByBoxer.get(id)!.push(b);
  }

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
    start: (r.start_date as string) ?? null, end: (r.end_date as string) ?? null, source: r.source as string,
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
  const prov = (r: Record<string, unknown>) => ({ basis: r.basis as Purse["basis"], source: r.source as string, sourceUrl: (r.source_url as string) ?? null, retrievedAt: (r.retrieved_at as string) ?? null, note: (r.note as string) ?? null });
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

  const boutsByEvent = new Map<number, BoutRow[]>();
  for (const b of bouts) push(boutsByEvent, b.eventId, b);
  for (const list of boutsByEvent.values()) list.sort((a, b) => b.position - a.position);

  const history = new Map<number, World["history"] extends Map<number, infer V> ? V : never>();
  const boutPre = new Map<number, { red: number; blue: number }>();
  const hrows = db.prepare("SELECT boxer_id, bout_id, date, rating, opp_rating FROM rating_history ORDER BY date, bout_id").all() as
    { boxer_id: number; bout_id: number; date: string; rating: number; opp_rating: number }[];
  const redOf = new Map(bouts.map((b) => [b.id, b.redId]));
  for (const h of hrows) {
    if (!history.has(h.boxer_id)) history.set(h.boxer_id, []);
    history.get(h.boxer_id)!.push({ date: h.date, rating: h.rating, boutId: h.bout_id, opp: h.opp_rating });
  }
  for (const [id, hs] of history) {
    let prev = 1500;
    for (const h of hs) {
      const pre = boutPre.get(h.boutId) ?? { red: 1500, blue: 1500 };
      if (redOf.get(h.boutId) === id) pre.red = prev; else pre.blue = prev;
      boutPre.set(h.boutId, pre);
      prev = h.rating;
    }
  }

  const year = currentYear();
  const boxers = boxersBase.map((b): BoxerFull => {
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
      streak, age: year - b.birthYear,
    };
  });

  applyFittedWeights();
  g.__worldKey = key;
  g.__world = {
    today, boxers, byId: new Map(boxers.map((b) => [b.id, b])), bySlug: new Map(boxers.map((b) => [b.slug, b])),
    bouts, events, boutById: new Map(bouts.map((b) => [b.id, b])), eventById: evOf, boutsByBoxer, boutsByEvent, history, boutPre,
    people, peopleBySlug: new Map([...people.values()].map((p) => [p.slug, p])), roles,
    orgs, orgsBySlug: new Map([...orgs.values()].map((o) => [o.slug, o])),
    stints, stintsByBoxer, stintsByPerson, stintsByOrg, weighInsByBout, weighInsByBoxer, officialsByBout, officialsByPerson, scorecardsByBout, cornersByBout,
    financialsByEvent, pursesByBout, pursesByBoxer, broadcastsByEvent, earningsByBoxer,
  };
  return g.__world;
}

export const recordStr = (b: { wins: number; losses: number; draws: number }) =>
  `${b.wins}-${b.losses}-${b.draws}`;
