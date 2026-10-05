import test, { after } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/**
 * The Boxing Data API adapter, tested against the shapes in the vendor's published docs (the Tyson Fury fighter example, the
 * fight response structure) with a mocked fetch: no key, no network. What this cannot show is the real feed's quirks; the first
 * run on the free tier is the real test (docs/real-data-readiness.md). What it does pin down: every approximation is counted,
 * nothing is stored without the storage confirmation, the request budget holds, and the key never leaks into an error.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("bda"); // pins "today" to 2026-10-03
after(cleanup);
delete process.env.BOXING_API_STORAGE_CONFIRMED;

import * as B from "../lib/providers/boxing-data-api";
import { sanitizeFeed } from "../lib/validate";
import { emptyFeed } from "../lib/feed";

const KEY = "sk-test-key-0123456789abcdef0123456789";
const notes = () => ({ ...B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: (async () => new Response("{}")) as typeof fetch }).notes() });

// the Tyson Fury example from https://boxing-data.com/docs/endpoints/fighters
const fury: B.ApiFighter = {
  id: "6715fc1faf69bb50508b7a83", name: "Tyson Fury", age: 36, gender: "m", nationality: "United Kingdom", nickname: null, stance: "orthodox",
  debut: "2008", height_cm: 206, reach_cm: 216, division: { name: "Heavyweight" },
};
const fighter = (id: string, name: string, over: Partial<B.ApiFighter> = {}): B.ApiFighter => ({ ...fury, id, name, ...over });

// the structure from https://boxing-data.com/docs/endpoints/fights
const fight = (id: string, a: string, b: string, over: Partial<B.ApiFight> = {}): B.ApiFight => ({
  id, title: "Usyk vs Fury II", date: "2024-12-21T21:00:00+00:00", location: "Riyadh, Saudi Arabia", venue: "Kingdom Arena", scheduled_rounds: 12, status: "FINISHED",
  fighters: { fighter_1: { name: "A", full_name: "A A", winner: true, fighter_id: a }, fighter_2: { name: "B", full_name: "B B", winner: false, fighter_id: b } },
  results: { outcome: "UD", round: null }, event: { id: `ev-${id}`, title: "Reignited", date: "2024-12-21T21:00:00+00:00", location: "Riyadh, Saudi Arabia", venue: "Kingdom Arena", broadcasters: [{ US: "DAZN" }], poster_image_url: null },
  division: { name: "Heavyweight" }, titles: [{ name: "WBA, WBC, WBO", id: "t1" }], ...over,
});
const side = (id: string, winner: boolean) => ({ name: "x", full_name: "x x", winner, fighter_id: id });

test("a decision: red is fighter 1, the winner is whoever the feed marks, the division is normalised, scheduled rounds are the length", () => {
  const n = notes();
  const m = B.mapFight(fight("f1", "A1", "B1", { fighters: { fighter_1: side("A1", false), fighter_2: side("B1", true) } }), n, 3)!;
  assert.equal(m.bout.redExternalId, "bda-f-A1"); assert.equal(m.bout.blueExternalId, "bda-f-B1");
  assert.equal(m.bout.winnerExternalId, "bda-f-B1");
  assert.equal(m.bout.method, "UD"); assert.equal(m.bout.rounds, 12); assert.equal(m.bout.endRound, 12, "a decision goes the distance");
  assert.equal(m.bout.weightClass, "Heavyweight"); assert.equal(m.bout.title, "WBA, WBC, WBO"); assert.equal(m.bout.position, 3);
  assert.equal(m.event.date, "2024-12-21"); assert.equal(m.event.name, "Reignited"); assert.equal(m.event.venue, "Kingdom Arena");
  assert.deepEqual([m.event.city, m.event.country], ["Riyadh", "Saudi Arabia"]); assert.equal(m.event.broadcaster, "DAZN");
  assert.deepEqual(m.fighterIds, ["A1", "B1"]);
  assert.equal(Object.values(n).reduce((s, v) => s + v, 0), 0, "nothing needed approximating");
});

test("stoppages carry their round; PTS is a unanimous decision only by approximation, and is counted", () => {
  const n = notes();
  const ko = B.mapFight(fight("f2", "A", "B", { results: { outcome: "KO", round: "5" } }), n)!.bout;
  assert.equal(ko.method, "KO"); assert.equal(ko.endRound, 5);
  assert.equal(B.mapFight(fight("f3", "A", "B", { results: { outcome: "TKO", round: 9 } }), n)!.bout.endRound, 9, "a numeric round works too");
  assert.equal(B.mapFight(fight("f4", "A", "B", { results: { outcome: "KO", round: null } }), n)!.bout.endRound, null, "an unknown round is not invented");
  const pts = B.mapFight(fight("f5", "A", "B", { results: { outcome: "PTS", round: null } }), n)!.bout;
  assert.equal(pts.method, "UD"); assert.equal(n.ptsAsUnanimousDecision, 1);
});

test("draws and unresolved results: a decision with no winner is a draw; a finished fight with nothing is left 'no result yet', not guessed", () => {
  const n = notes();
  const draw = B.mapFight(fight("f6", "A", "B", { fighters: { fighter_1: side("A", false), fighter_2: side("B", false) }, results: { outcome: "SD", round: null } }), n)!.bout;
  assert.equal(draw.method, "DRAW"); assert.equal(draw.winnerExternalId, null); assert.equal(n.drawInferred, 1);
  const none = B.mapFight(fight("f7", "A", "B", { fighters: { fighter_1: side("A", false), fighter_2: side("B", false) }, results: { outcome: null, round: null } }), n)!.bout;
  assert.equal(none.method, null); assert.equal(none.winnerExternalId, null); assert.equal(none.endRound, null); assert.equal(n.resultMissing, 1);
});

test("fights not yet fought carry no result, even if the feed has stray fields; LIVE counts as not finished", () => {
  const n = notes();
  for (const status of ["NOT_STARTED", "LIVE"]) {
    const b = B.mapFight(fight(`u-${status}`, "A", "B", { status, results: { outcome: "UD", round: null }, fighters: { fighter_1: side("A", true), fighter_2: side("B", false) } }), n)!.bout;
    assert.equal(b.method, null, status); assert.equal(b.winnerExternalId, null, status);
  }
  assert.equal(n.liveTreatedAsUpcoming, 1);
});

test("a CANCELLED fight is kept as a cancelled bout with no result, counted, and never read as a fight with no result", () => {
  const n = notes();
  const b = B.mapFight(fight("c1", "A", "B", { status: "CANCELLED", results: { outcome: "UD", round: null }, fighters: { fighter_1: side("A", true), fighter_2: side("B", false) } }), n)!.bout;
  assert.equal(b.status, "cancelled"); assert.equal(b.method, null); assert.equal(b.winnerExternalId, null);
  assert.equal(n.cancelledFights, 1); assert.equal(n.resultMissing, 0);
  const done = B.mapFight(fight("c2", "A", "B", { status: "FINISHED", results: { outcome: "UD", round: null }, fighters: { fighter_1: side("A", true), fighter_2: side("B", false) } }), n)!.bout;
  assert.equal(done.status, undefined); assert.equal(n.cancelledFights, 1);
});

test("rows that cannot be used are skipped and counted, not half-mapped", () => {
  const n = notes();
  assert.equal(B.mapFight(fight("x1", "A", "B", { date: null, event: { id: "e", date: null } }), n), null);
  assert.equal(B.mapFight(fight("x2", "A", "B", { fighters: { fighter_1: side("A", false), fighter_2: { name: "?", winner: false, fighter_id: null } } }), n), null);
  assert.equal(B.mapFight({ ...fight("x3", "A", "B"), id: "" }, n), null);
  assert.equal(n.fightsSkipped, 3);
});

test("locations: the first part is the city, the last the country; an unsplittable one is counted, never dropped", () => {
  const n = notes();
  assert.deepEqual(B.parseLocation("Las Vegas, Nevada, United States", n), { city: "Las Vegas", country: "United States" });
  assert.deepEqual(B.parseLocation("London, United Kingdom", n), { city: "London", country: "United Kingdom" });
  assert.equal(n.locationUnparsed, 0);
  assert.deepEqual(B.parseLocation("Wembley", n), { city: "Wembley", country: "Unknown" });
  assert.deepEqual(B.parseLocation(null, n), { city: "Unknown", country: "Unknown" });
  assert.equal(n.locationUnparsed, 2);
});

test("a fighter: the documented Fury example maps field for field; an age alone is not a birth year, so it is unknown and counted", () => {
  const n = notes();
  const m = B.mapFighter(fury, n)!;
  assert.equal(m.externalId, "bda-f-6715fc1faf69bb50508b7a83"); assert.equal(m.name, "Tyson Fury"); assert.equal(m.country, "United Kingdom");
  assert.equal(m.stance, "Orthodox"); assert.equal(m.sex, "male"); assert.equal(m.heightCm, 206); assert.equal(m.reachCm, 216);
  assert.equal(m.weightClass, "Heavyweight"); assert.equal(m.turnedPro, 2008);
  assert.equal(m.birthYear, null, "the example gives an age (36), which can be a year out, so no birth year is made up from it"); assert.equal(n.birthYearUnknown, 1);
  assert.equal(B.mapFighter(fighter("g", "G G", { gender: "f", nickname: null, alias: "The Ace", stance: "Southpaw" }), n)!.sex, "female");
  assert.equal(B.mapFighter(fighter("g", "G G", { alias: "The Ace" }), n)!.nickname, "The Ace");
  assert.equal(B.mapFighter(fighter("g", "G G", { stance: "ambidextrous" }), n)!.stance, "Switch");
  assert.equal(B.mapFighter(fighter("g", "G G", { stance: null }), n)!.stance, null, "an unknown stance stays unknown, it is not Orthodox"); assert.equal(n.stanceUnknown, 1);
  assert.equal(B.mapFighter(fighter("g", "G G", { age: null }), n)!.birthYear, null);
  assert.equal(n.birthYearUnknown, 6, "none of the six fighters mapped here has a birth_year: each is counted once");
  assert.equal(B.mapFighter({ id: "", name: "x" }, n), null);
});

test("missing height or reach stays unknown and is counted: nothing is filled in from the other, a median or a neutral value", () => {
  const n = notes();
  const out = ([
    fighter("a", "A", { height_cm: 180, reach_cm: 182 }), fighter("b", "B", { height_cm: 190, reach_cm: 195 }),
    fighter("d", "D", { height_cm: 185, reach_cm: null }), fighter("e", "E", { height_cm: null, reach_cm: 190 }),
    fighter("f", "F", { height_cm: null, reach_cm: null }),
  ].map((f) => B.mapFighter(f, n)!));
  const by = Object.fromEntries(out.map((r) => [r.name, r]));
  assert.equal(by.D.heightCm, 185); assert.equal(by.D.reachCm, null, "a missing reach is not taken from the height");
  assert.equal(by.E.reachCm, 190); assert.equal(by.E.heightCm, null, "a missing height is not taken from the reach");
  assert.deepEqual([by.F.heightCm, by.F.reachCm], [null, null], "and not from a median, and not 175");
  assert.equal(by.A.heightCm, 180);
  assert.equal(n.physicalsUnknown, 3, "D, E and F are each counted once");
  assert.equal((B as Record<string, unknown>).imputePhysicals, undefined, "the imputation is gone");
});

test("active means a fight in the last 30 months; a missing debut year stays unknown, it is not the first fight held", () => {
  const n = notes();
  const loose = [B.mapFighter(fighter("a", "A", { debut: null }), n)!, B.mapFighter(fighter("b", "B"), n)!, B.mapFighter(fighter("c", "C"), n)!];
  const mk = (id: string, red: string, blue: string, ev: string) => ({ externalId: id, eventExternalId: ev, redExternalId: `bda-f-${red}`, blueExternalId: `bda-f-${blue}`, weightClass: "Heavyweight", rounds: 12, winnerExternalId: null, method: null, endRound: null, title: null, position: 0 });
  const bouts = [mk("1", "a", "b", "e1"), mk("2", "a", "c", "e2")];
  const dates = new Map([["e1", "2019-05-01"], ["e2", "2026-05-01"]]);
  const out = Object.fromEntries(B.finishBoxers(loose, bouts, dates, n).map((r) => [r.name, r]));
  assert.equal(out.A.turnedPro, null, "the feed gives no debut, and the first fight we hold (2019) may not be the first fight"); assert.equal(n.debutUnknown, 1);
  assert.equal(out.A.active, true, "fought in May 2026"); assert.equal(out.C.active, true);
  assert.equal(out.B.active, false, "last fought in 2019");
  assert.equal(out.B.turnedPro, 2008, "a debut the feed gives is kept");
});

// ---- the client, with a mocked fetch ----
type Handler = (path: string, params: URLSearchParams) => { status?: number; headers?: Record<string, string>; body: unknown };
function mockFetch(handler: Handler) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    const u = new URL(url);
    const r = handler(u.pathname, u.searchParams);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const env = <T>(data: T, extra: object = {}) => ({ metadata: {}, pagination: { page: 1, total_pages: 1, next_page: null }, error: {}, data, ...extra });
const FIGHTERS: Record<string, B.ApiFighter> = { A1: fighter("A1", "Alpha One"), B1: fighter("B1", "Bravo One", { stance: "southpaw", age: 31 }), C1: fighter("C1", "Charlie One", { height_cm: null, reach_cm: null }) };
const FIGHTS = [fight("1", "A1", "B1"), fight("2", "A1", "C1", { date: "2025-03-01T20:00:00Z", event: { id: "ev-2", title: "Spring Card", date: "2025-03-01T20:00:00Z", location: "London, United Kingdom", venue: "The O2" } })];
const UPCOMING = fight("3", "B1", "C1", { status: "NOT_STARTED", date: "2026-11-14T20:00:00Z", results: { outcome: null, round: null }, event: { id: "ev-3", title: "Winter Night", date: "2026-11-14T20:00:00Z", location: "Manchester, United Kingdom", venue: "AO Arena" }, fighters: { fighter_1: side("B1", false), fighter_2: side("C1", false) } });
const standard: Handler = (path, q) => {
  // the real API refuses a start date without an end date
  if (q?.get("date_from") && !q.get("date_to")) return { status: 400, body: { code: "InvalidDateRange", message: "date_from must be earlier than or equal to date_to and in format YYYY-MM-DD" } };
  if (path === "/v2/fights/") return { body: env(FIGHTS) };
  if (path === "/v2/fights/schedule") return { body: env([UPCOMING, FIGHTS[1]]) }; // FIGHTS[1] is in both lists
  const m = path.match(/^\/v2\/fighters\/(.+)$/);
  if (m && FIGHTERS[m[1]]) return { body: env(FIGHTERS[m[1]]) };
  return { status: 404, body: { error: { message: "not found" } } };
};

test("a full load: fights first, then each fighter once; events come from the fights; the key is sent as RapidAPI headers", async () => {
  const { impl, calls } = mockFetch(standard);
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl });
  const [boxers, events, bouts] = await Promise.all([p.fetchBoxers(), p.fetchEvents(), p.fetchBouts()]);
  assert.equal(boxers.length, 3); assert.equal(events.length, 3); assert.equal(bouts.length, 3, "two past fights and one coming up; the one in both lists is taken once");
  assert.equal(p.requests(), 5, "the list, the schedule, and 3 distinct fighters (Alpha is in both fights but fetched once)");
  assert.equal(calls.length, 5);
  assert.equal(calls[0].headers["x-rapidapi-key"], KEY); assert.equal(calls[0].headers["x-rapidapi-host"], "boxing-data-api.p.rapidapi.com");
  assert.match(calls[0].url, /^https:\/\/boxing-data-api\.p\.rapidapi\.com\/v2\/fights\/\?/);
  const charlie = boxers.find((b) => b.name === "Charlie One")!;
  assert.deepEqual([charlie.heightCm, charlie.reachCm], [null, null], "a fighter with no physicals has none, not a made-up value");
  assert.equal(p.notes().physicalsUnknown, 1);
  // the result is a feed the validator accepts without errors
  const { issues } = sanitizeFeed({ ...emptyFeed(), boxers, events, bouts }, { today: "2026-10-03" });
  assert.deepEqual(issues.filter((i) => i.severity === "error"), []);
});

test("it ingests into the database like any provider, and the result is a record the app can show", async () => {
  process.env.BOXING_API_STORAGE_CONFIRMED = "1";
  try {
    const { impl } = mockFetch(standard);
    const db = await (await import("../lib/db")).getDb();
    const { ingest } = await import("../lib/ingest");
    const report = await ingest(db, B.boxingDataApiProvider({ key: KEY, purpose: "ingest", fetchImpl: impl }));
    assert.equal(report.errors, 0, JSON.stringify(report));
    const w = await (await import("../lib/world")).getWorld();
    const alpha = w.boxers.find((b) => b.name === "Alpha One")!;
    assert.equal(alpha.wins, 2); assert.equal(alpha.bouts, 2);
    assert.equal(w.bouts.length, 3);
    const coming = w.bouts.find((b) => b.date === "2026-11-14")!;
    assert.ok(coming.upcoming && coming.method === null, "the scheduled fight is upcoming, with no result");
  } finally { delete process.env.BOXING_API_STORAGE_CONFIRMED; }
});

test("pagination: it follows total_pages and stops at the fight limit", async () => {
  const pages: string[] = [];
  const { impl } = mockFetch((path, q) => {
    if (path === "/v2/fights/") {
      pages.push(`${q.get("page_num")}/${q.get("page_size")}/${q.get("date_sort")}`);
      const p = Number(q.get("page_num"));
      const date = `2024-0${p}-01T21:00:00+00:00`; // three different cards: the same two fighters within a day would be one fight listed three times (round 78)
      return { body: env([fight(`p${p}`, "A1", "B1", { date, event: { id: `ev-p${p}`, title: "Card", date, location: "Riyadh, Saudi Arabia", venue: "Arena" } })], { pagination: { page: p, total_pages: 3, next_page: null } }) };
    }
    return standard(path, q);
  });
  const all = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, scheduleDays: 0 });
  assert.equal((await all.fetchBouts()).length, 3);
  assert.deepEqual(pages, ["1/100/DESC", "2/100/DESC", "3/100/DESC"]);
  pages.length = 0;
  const two = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, maxFights: 2, pageSize: 1, scheduleDays: 0 });
  assert.equal((await two.fetchBouts()).length, 2);
  assert.deepEqual(pages, ["1/1/DESC", "2/1/DESC"]);
});

test("the request budget holds: it stops with a plain message instead of spending the allowance", async () => {
  const { impl, calls } = mockFetch(standard);
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, maxRequests: 3 });
  await assert.rejects(() => p.fetchBoxers(), (e: Error) => e instanceof B.BudgetError && /limit 3/.test(e.message) && !e.message.includes(KEY));
  assert.equal(calls.length, 3, "exactly the budget, never one more");
});

test("failures are loud and never leak the key: an API error, a rate limit, a server error; one missing fighter drops only its bouts", async () => {
  const bad = (status: number, body: unknown, headers?: Record<string, string>) => B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: mockFetch(() => ({ status, body, headers })).impl });
  await assert.rejects(() => bad(200, env([], { error: { message: "invalid subscription" } })).fetchBouts(), (e: Error) => /invalid subscription/.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(() => bad(429, {}, { "retry-after": "30" }).fetchBouts(), (e: Error) => /rate limit/.test(e.message) && /30/.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(() => bad(500, {}).fetchBouts(), (e: Error) => /500/.test(e.message) && !e.message.includes(KEY));
  const logs: string[] = [];
  const { impl } = mockFetch((path, q) => (path === "/v2/fighters/C1" ? { status: 404, body: {} } : standard(path, q)));
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, log: (m) => logs.push(m) });
  assert.equal((await p.fetchBouts()).length, 1, "the fight with the missing fighter is dropped");
  assert.equal(p.notes().boutsDroppedUnknownFighter, 2, "both fights that involve the missing fighter");
  assert.ok(logs.some((l) => /fighter C1 skipped/.test(l)));
});

test("storing is on by default, provisionally and with a warning, until the vendor confirms; =1 silences the warning, =0 refuses", () => {
  const logs: string[] = [];
  try {
    delete process.env.BOXING_API_STORAGE_CONFIRMED;
    assert.equal(B.storageStatus(), "provisional");
    assert.doesNotThrow(() => B.boxingDataApiProvider({ key: KEY, purpose: "ingest", log: (m) => logs.push(m) }));
    assert.deepEqual(logs, [B.STORAGE_WARNING], "it says so, once");
    assert.match(B.STORAGE_WARNING, /PROVISIONALLY/); assert.match(B.STORAGE_WARNING, /Undoing it/); assert.match(B.STORAGE_WARNING, /BOXING_API_STORAGE_CONFIRMED=1/);
    logs.length = 0;
    assert.doesNotThrow(() => B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", log: (m) => logs.push(m) }));
    assert.equal(logs.length, 0, "an evaluation stores nothing, so it says nothing");

    process.env.BOXING_API_STORAGE_CONFIRMED = "1";
    assert.equal(B.storageStatus(), "confirmed");
    assert.doesNotThrow(() => B.boxingDataApiProvider({ key: KEY, purpose: "ingest", log: (m) => logs.push(m) }));
    assert.equal(logs.length, 0, "confirmed: no warning");

    process.env.BOXING_API_STORAGE_CONFIRMED = "0";
    assert.throws(() => B.storageStatus(), /switched off/);
    assert.throws(() => B.boxingDataApiProvider({ key: KEY, purpose: "ingest" }), /switched off/);
    assert.doesNotThrow(() => B.boxingDataApiProvider({ key: KEY, purpose: "evaluation" }), "a sample can still be evaluated");
  } finally { delete process.env.BOXING_API_STORAGE_CONFIRMED; }
});

test("BOXING_PROVIDER=licensed needs a key; storing is allowed by default and refused only when switched off", async () => {
  const { licensedProvider } = await import("../lib/providers/licensed");
  const saved = { ...process.env };
  const log = console.log; const said: string[] = [];
  console.log = (...a: unknown[]) => { said.push(a.join(" ")); };
  try {
    delete process.env.BOXING_API_KEY; delete process.env.BOXING_API_STORAGE_CONFIRMED;
    assert.throws(() => licensedProvider(), /BOXING_API_KEY/);
    process.env.BOXING_API_KEY = KEY;
    assert.equal(licensedProvider().name, "boxing-data-api");
    assert.ok(said.some((m) => /PROVISIONALLY/.test(m)), "and it says it is storing provisionally");
    process.env.BOXING_API_STORAGE_CONFIRMED = "0";
    assert.throws(() => licensedProvider(), /switched off/);
    process.env.BOXING_API_STORAGE_CONFIRMED = "1";
    assert.equal(licensedProvider().name, "boxing-data-api");
  } finally { console.log = log; for (const k of ["BOXING_API_KEY", "BOXING_API_STORAGE_CONFIRMED"]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
});

test("upcoming fights come from the schedule endpoint: asked for the coming days, no result carried, and a fight in both lists is taken once", async () => {
  const seen: string[] = [];
  const { impl } = mockFetch((path, q) => { if (path === "/v2/fights/schedule") seen.push(`days=${q.get("days")} sort=${q.get("date_sort")}`); return standard(path, q); });
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, scheduleDays: 45 });
  const bouts = await p.fetchBouts();
  assert.deepEqual(seen, ["days=45 sort=ASC"]);
  assert.equal(bouts.filter((b) => b.externalId === "bda-b-2").length, 1, "in both lists, taken once");
  const up = bouts.find((b) => b.externalId === "bda-b-3")!;
  assert.equal(up.method, null); assert.equal(up.winnerExternalId, null);
  const none = mockFetch((path, q) => { assert.notEqual(path, "/v2/fights/schedule"); return standard(path, q); });
  assert.equal((await B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: none.impl, scheduleDays: 0 }).fetchBouts()).length, 2, "0 days: no schedule request at all");
});

test("a refusal says why: the vendor's message is in the error (with the key scrubbed), and its status is kept", async () => {
  const refuse = (status: number, body: unknown) => B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", scheduleDays: 0, fetchImpl: mockFetch(() => ({ status, body })).impl });
  await assert.rejects(() => refuse(403, { message: "You are not subscribed to this API." }).fetchBouts(),
    (e: Error) => e instanceof B.HttpError && e.status === 403 && /403 on \/v2\/fights\/: You are not subscribed to this API\./.test(e.message));
  await assert.rejects(() => refuse(403, { message: `Invalid API key ${KEY} for this host` }).fetchBouts(), (e: Error) => /Invalid API key \*\*\* for this host/.test(e.message) && !e.message.includes(KEY), "a key echoed back by the server is scrubbed");
  await assert.rejects(() => refuse(500, "<html>upstream down</html>").fetchBouts(), (e: Error) => /500 on \/v2\/fights\/: .*upstream down/.test(e.message), "a non-JSON body is shown as text");
  await assert.rejects(() => refuse(403, {}).fetchBouts(), (e: Error) => /403 on \/v2\/fights\//.test(e.message), "and an empty one still names the endpoint");
});

test("a plan without the schedule endpoint still loads: the coming fights are asked for from the list, from today on, and it is counted", async () => {
  const asked: string[] = [];
  const { impl } = mockFetch((path, q) => {
    asked.push(`${path}${q.get("date_from") ? `?from=${q.get("date_from")}&to=${q.get("date_to")}&sort=${q.get("date_sort")}` : ""}`);
    if (path === "/v2/fights/schedule") return { status: 403, body: { message: "This endpoint is not included in your plan." } };
    if (path === "/v2/fights/" && q.get("date_from") === "2026-10-03") return { body: env([UPCOMING]) };
    return standard(path, q);
  });
  const logs: string[] = [];
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, log: (m) => logs.push(m) });
  const bouts = await p.fetchBouts();
  assert.ok(bouts.some((b) => b.externalId === "bda-b-3"), "the upcoming fight arrived by the fallback");
  assert.equal(p.notes().scheduleUnavailable, 1);
  assert.deepEqual(asked.filter((a) => a !== "/v2/fights/" && !a.startsWith("/v2/fighters/")), ["/v2/fights/schedule", "/v2/fights/?from=2026-10-03&to=2026-12-02&sort=ASC"]);
  assert.ok(logs.some((l) => /schedule endpoint refused \(.*not included in your plan/.test(l)), "and the reason is shown");
  // a server error is NOT a missing plan: it must stay loud
  const broken = mockFetch((path, q) => (path === "/v2/fights/schedule" ? { status: 500, body: {} } : standard(path, q)));
  await assert.rejects(() => B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: broken.impl }).fetchBouts(), /500 on \/v2\/fights\/schedule/);
});

test("raw responses can be kept for offline fixes: one file per request, nothing secret in them, and off unless asked", async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bda-raw-"));
  const { impl } = mockFetch(standard);
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, rawDir: dir });
  await p.fetchBouts();
  const files = fs.readdirSync(dir).sort();
  assert.equal(files.length, p.requests(), "one file per request");
  assert.match(files[0], /^001-v2_fights\.json$/); assert.match(files[1], /^002-v2_fights_schedule\.json$/); assert.match(files[2], /^003-v2_fighters_/);
  for (const f of files) assert.ok(!fs.readFileSync(path.join(dir, f), "utf8").includes(KEY), "responses never contain the key");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8")).data.length, 2, "the body as the API sent it");
  const none = fs.mkdtempSync(path.join(os.tmpdir(), "bda-raw-off-"));
  await B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: mockFetch(standard).impl }).fetchBouts();
  assert.deepEqual(fs.readdirSync(none), [], "off by default");
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(none, { recursive: true, force: true });
});

test("a start date always travels with an end date, as the API requires; the real refusals from the first free-tier run are handled", async () => {
  const sent: string[] = [];
  const { impl } = mockFetch((path, q) => { if (path === "/v2/fights/") sent.push(`${q.get("date_from")}..${q.get("date_to")}`); return standard(path, q); });
  await B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, scheduleDays: 0, since: "2025-01-01" }).fetchBouts();
  assert.deepEqual(sent, ["2025-01-01..2026-10-03"], "since -> date_from, with date_to today");
  sent.length = 0;
  await B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, scheduleDays: 0 }).fetchBouts();
  assert.deepEqual(sent, ["null..null"], "no dates asked for when none are wanted");

  // what the free plan actually answered: the schedule is outside the allowed range, and so is the future in the list
  const free = mockFetch((path, q) => {
    if (path === "/v2/fights/schedule" || (path === "/v2/fights/" && q.get("date_from"))) return { status: 403, body: { code: "DateOutOfRange", message: "Requested date is outside your subscription's allowed date range" } };
    return standard(path, q);
  });
  const logs: string[] = [];
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: free.impl, log: (m) => logs.push(m) });
  const bouts = await p.fetchBouts();
  assert.ok(bouts.length >= 2, "the history it is allowed to see still loads");
  assert.equal(p.notes().scheduleUnavailable, 1); assert.equal(p.notes().upcomingUnavailable, 1);
  assert.ok(logs.some((l) => /no coming fights available on this plan \(.*allowed date range/.test(l)), "and the reason is shown");
  // a broken server in the fallback is NOT "no coming fights on this plan": it stays loud
  const broken = mockFetch((path, q) => {
    if (path === "/v2/fights/schedule") return { status: 403, body: { message: "not on your plan" } };
    if (path === "/v2/fights/" && q.get("date_from")) return { status: 500, body: {} };
    return standard(path, q);
  });
  await assert.rejects(() => B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: broken.impl }).fetchBouts(), /500 on \/v2\/fights\//);
  // but a refusal of the HISTORY itself is not hidden: the sample would otherwise look fine and be empty
  const noHistory = mockFetch(() => ({ status: 403, body: { code: "DateOutOfRange", message: "Requested date is outside your subscription's allowed date range" } }));
  await assert.rejects(() => B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: noHistory.impl, since: "1990-01-01" }).fetchBouts(), /allowed date range/);
});

// a record as the real API sent it (first free-tier run, 2026-10-03): note the location has a region and no country
const REAL_UPCOMING: B.ApiFight & Record<string, unknown> = {
  id: "real-1", title: "Mathieu vs. Shishkin", slug: null, date: "2026-10-09T02:00:00", venue: "Capitole de Quebec", location: "Quebec City, Quebec",
  results: null, scheduled_rounds: 10, scores: null, card_billing: "Main Card", status: "NOT_STARTED", statistics: null,
  fighters: { fighter_1: { fighter_id: "68288a82162efadfc8bc4577", name: "Mathieu", full_name: "Wilkens Mathieu", winner: false }, fighter_2: { fighter_id: "6715fc1faf69bb50508b7c2a", name: "Shishkin", full_name: "Vladimir Shishkin", winner: false } },
  event: { id: "6a7deb3ff8d3c8223feb8382", title: "Iglesias vs. Zaren", slug: null, date: "2026-10-09T00:00:00", location: "Quebec City, Quebec" } as B.ApiEvent,
  division: { name: "Super Middleweight" },
};

test("the real record: an upcoming fight with null results maps with the event's plain date and a country worked out from the region", () => {
  const n = notes();
  const m = B.mapFight(REAL_UPCOMING, n)!;
  assert.equal(m.event.date, "2026-10-09", "the event's own date (midnight, so a plain date), not the fight's UTC time");
  assert.deepEqual([m.event.city, m.event.country], ["Quebec City", "Canada"]);
  assert.equal(m.event.venue, "Capitole de Quebec"); assert.equal(m.event.name, "Iglesias vs. Zaren");
  assert.equal(m.bout.method, null); assert.equal(m.bout.winnerExternalId, null); assert.equal(m.bout.rounds, 10); assert.equal(m.bout.weightClass, "Super Middleweight");
  assert.equal(n.locationCountryInferred, 1);
});

test("regions become countries: US states, Canadian provinces, UK nations, Australian and Mexican states; a country name is left alone; Georgia is ambiguous and says so", () => {
  const n = notes();
  const country = (loc: string) => B.parseLocation(loc, n).country;
  assert.equal(country("Las Vegas, Nevada"), "United States"); assert.equal(country("New York, New York"), "United States");
  assert.equal(country("Quebec City, Quebec"), "Canada"); assert.equal(country("Montréal, Québec"), "Canada");
  assert.equal(country("Cardiff, Wales"), "United Kingdom"); assert.equal(country("Belfast, Northern Ireland"), "United Kingdom");
  assert.equal(country("Sydney, New South Wales"), "Australia"); assert.equal(country("Guadalajara, Jalisco"), "Mexico");
  assert.equal(n.locationCountryInferred, 8);
  assert.equal(country("Riyadh, Saudi Arabia"), "Saudi Arabia"); assert.equal(country("London, United Kingdom"), "United Kingdom");
  assert.equal(country("Las Vegas, Nevada, United States"), "United States", "a country as the last part wins");
  assert.equal(n.locationCountryInferred, 8, "none of those needed inferring");
  assert.equal(country("Atlanta, Georgia"), "Georgia"); assert.equal(n.locationRegionAmbiguous, 1, "the same text means Atlanta and Tbilisi: not guessed");
});

test("when the list already shows coming fights, the schedule endpoint is not asked for at all", async () => {
  const asked: string[] = [];
  const { impl } = mockFetch((path, q) => {
    asked.push(path);
    if (path === "/v2/fights/") return { body: env([REAL_UPCOMING, FIGHTS[0]]) };
    if (path === "/v2/fighters/68288a82162efadfc8bc4577") return { body: env(fighter("68288a82162efadfc8bc4577", "Wilkens Mathieu")) };
    if (path === "/v2/fighters/6715fc1faf69bb50508b7c2a") return { body: env(fighter("6715fc1faf69bb50508b7c2a", "Vladimir Shishkin")) };
    return standard(path, q);
  });
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl });
  const bouts = await p.fetchBouts();
  assert.ok(bouts.some((b) => b.externalId === "bda-b-real-1"), "the coming fight came from the list");
  assert.ok(!asked.includes("/v2/fights/schedule"), "no redundant (and, on the free plan, refused) schedule request");
  assert.equal(p.notes().scheduleUnavailable, 0);
});

// a fighter record as the real API sent it (first free-tier sample, 2026-10-03): birth_year, not age; reach only in inches
const ZAREN: B.ApiFighter & Record<string, unknown> = {
  id: "68289564162efadfc8bc584c", name: "Oliver Zaren", alias: "Great Dane", gender: "m", birth_year: 1999,
  height: null, height_ft: "6'1\"", height_cm: 187, height_in: null, nationality: "Denmark", nationality_code: "DK", nickname: "Great Dane",
  reach: null, reach_cm: null, reach_in: 70, stance: "southpaw", stats: { wins: 19, losses: 0, draws: 1, total_bouts: 20 }, debut: "2019",
  division: { id: "671513530ad13034eb882657", name: "Super Middleweight", weight_lb: 168 },
};

test("the real fighter record: birth_year is used as given, reach comes from inches, nothing is unknown", () => {
  const n = notes();
  const m = B.mapFighter(ZAREN, n)!;
  assert.equal(m.birthYear, 1999, "the feed's own birth year, not derived from an age");
  assert.equal(m.heightCm, 187); assert.equal(m.reachCm, 178, "70 in = 177.8 cm");
  assert.equal(m.stance, "Southpaw"); assert.equal(m.nickname, "Great Dane"); assert.equal(m.country, "Denmark");
  assert.equal(m.weightClass, "Super Middleweight"); assert.equal(m.turnedPro, 2019);
  assert.equal(n.birthYearUnknown, 0); assert.equal(n.stanceUnknown, 0); assert.equal(n.debutUnknown, 0);
  assert.equal(n.physicalsConverted, 1, "the one inch-to-cm conversion is counted");
  assert.equal(n.physicalsUnknown, 0);
});

test("birth_year is only trusted when plausible; an age alone, an absurd year or nothing is unknown", () => {
  const n = notes();
  assert.equal(B.mapFighter({ ...ZAREN, birth_year: 0, age: 30 }, n)!.birthYear, null, "an age alone is not a birth year: it can be a year out"); assert.equal(n.birthYearUnknown, 1);
  assert.equal(B.mapFighter({ ...ZAREN, birth_year: 2025 }, n)!.birthYear, null, "a 1-year-old boxer is not a birth year");
  assert.equal(B.mapFighter({ ...ZAREN, birth_year: 1850 }, n)!.birthYear, null);
  assert.equal(B.mapFighter({ ...ZAREN, birth_year: null, age: null }, n)!.birthYear, null);
  assert.equal(n.birthYearUnknown, 4);
  assert.equal(B.mapFighter({ ...ZAREN, debut: "1850" }, notes())!.turnedPro, null, "an absurd debut year is unknown too");
});

test("lengths come from whichever form the feed gives: cm, inches, 6'1\", or the docs' combined text; and null when none", () => {
  const n = notes();
  assert.equal(B.lengthCm(187, 74, "6'1\"", n), 187, "cm wins when present");
  assert.equal(n.physicalsConverted, 0);
  assert.equal(B.lengthCm(null, 70, null, n), 178);
  assert.equal(B.lengthCm(null, null, "6'1\"", n), 185, "6 ft 1 in");
  assert.equal(B.lengthCm(null, null, "6' 9\" / 206 cm", n), 206, "the combined text's centimetres");
  assert.equal(B.lengthCm(null, null, "85\" / 216 cm", n), 216);
  assert.equal(B.lengthCm(null, null, "70\"", n), 178, "inches alone");
  assert.equal(B.lengthCm(null, null, "6'", n), 183, "feet alone");
  assert.equal(n.physicalsConverted, 6);
  assert.equal(B.lengthCm(null, null, null, n), null); assert.equal(B.lengthCm(0, 0, "", n), null); assert.equal(B.lengthCm(null, null, "n/a", n), null);
  assert.equal(n.physicalsConverted, 6, "nothing converted when nothing was there");
});

test("saved responses can be replayed with no requests: the same league comes out, and a request that was never saved is a 404", async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bda-replay-"));
  const live = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: mockFetch(standard).impl, rawDir: dir });
  const [boxers, events, bouts] = [await live.fetchBoxers(), await live.fetchEvents(), await live.fetchBouts()];
  const replay = B.boxingDataApiProvider({ key: "replay", purpose: "evaluation", fetchImpl: B.replayFetch(dir) });
  assert.deepEqual([await replay.fetchBoxers(), await replay.fetchEvents(), await replay.fetchBouts()], [boxers, events, bouts], "identical output from the saved responses alone");
  assert.deepEqual(replay.notes(), live.notes());
  const miss = await B.replayFetch(dir)("https://boxing-data-api.p.rapidapi.com/v2/fighters/never-saved");
  assert.equal(miss.status, 404); assert.match(String((await miss.json() as { message: string }).message), /not in the saved responses/);
  const again = B.replayFetch(dir);
  await again("https://x.example/v2/fights/");
  assert.equal((await again("https://x.example/v2/fights/")).status, 404, "a page that was saved once is served once");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a fighter with no division in the feed takes the division of their most recent fight, counted; one with no fights stays unknown for the validator to report", () => {
  const n = notes();
  const loose = ["a", "b", "c", "d"].map((id) => B.mapFighter(fighter(id, id.toUpperCase(), id === "d" ? { division: { name: "Cruiserweight" } } : { division: null }), n)!);
  assert.ok(loose.slice(0, 3).every((r) => r.weightClass === "Unknown"), "the feed gave none");
  const mk = (id: string, red: string, blue: string, ev: string, weightClass: string) => ({ externalId: id, eventExternalId: ev, redExternalId: `bda-f-${red}`, blueExternalId: `bda-f-${blue}`, weightClass, rounds: 12, winnerExternalId: null, method: null, endRound: null, title: null, position: 0 });
  const bouts = [mk("1", "a", "d", "e1", "Middleweight"), mk("2", "a", "d", "e2", "Super Middleweight"), mk("3", "b", "d", "e1", "Not A Division")];
  const dates = new Map([["e1", "2025-01-01"], ["e2", "2026-05-01"]]);
  const out = Object.fromEntries(B.finishBoxers(loose, bouts, dates, n).map((r) => [r.name, r]));
  assert.equal(out.A.weightClass, "Super Middleweight", "the most recent fight's class, not the first");
  assert.equal(out.B.weightClass, "Unknown", "its only fight has an unrecognised class: nothing to go on");
  assert.equal(out.C.weightClass, "Unknown", "no fights at all");
  assert.equal(out.D.weightClass, "Cruiserweight", "a division the feed gave is kept");
  assert.equal(n.divisionFromFight, 1);
  const { issues } = sanitizeFeed({ ...emptyFeed(), boxers: [out.A, out.D], events: [{ externalId: "e1", name: "x", date: "2025-01-01", venue: "v", city: "c", country: "k" }, { externalId: "e2", name: "y", date: "2026-05-01", venue: "v", city: "c", country: "k" }], bouts: bouts.slice(0, 2) }, { today: "2026-10-03" });
  assert.deepEqual(issues.filter((i) => i.code === "unknown_division"), [], "the validator no longer rejects the fighter");
});

// ---- the backfill: resumable, patient, and priced before it is spent ----
const tmp = async (tag: string) => (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), `bda-${tag}-`));
const countCalls = (calls: { url: string }[], part: string) => calls.filter((c) => c.url.includes(part)).length;

test("a backfill resumes: a crashed run costs only the requests that never completed, a finished one costs none, and --refresh starts over", async () => {
  const fs = await import("node:fs");
  const dir = await tmp("resume");
  let failC1 = true;
  const handler: Handler = (path, q) => (failC1 && path === "/v2/fighters/C1" ? { status: 500, body: {} } : standard(path, q));
  const run = async (opts: Partial<B.BoxingDataApiOptions> = {}) => {
    const m = mockFetch(handler);
    const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: m.impl, cacheDir: dir, scheduleDays: 0, ...opts });
    const bouts = await p.fetchBouts();
    return { p, bouts, calls: m.calls };
  };

  const first = await run();
  assert.equal(first.p.requests(), 4, "the list and three fighters");
  assert.equal(first.bouts.length, 1, "the fighter that failed took its fight with it");
  assert.equal(first.p.notes().boutsDroppedUnknownFighter, 1);
  assert.ok(fs.existsSync(`${dir}/v2-fighters-A1.json`) && fs.existsSync(`${dir}/v2-fighters-B1.json`), "what worked is kept, under a name you can read");
  assert.ok(!fs.existsSync(`${dir}/v2-fighters-C1.json`), "what failed is not");

  failC1 = false;
  const second = await run();
  assert.equal(second.p.requests(), 1, "only the fighter that never completed");
  assert.equal(countCalls(second.calls, "/v2/fighters/C1"), 1); assert.equal(countCalls(second.calls, "/v2/fights"), 0, "the list pages came from the cache");
  assert.equal(second.p.cacheHits(), 3); assert.equal(second.bouts.length, 2); assert.equal(second.p.notes().boutsDroppedUnknownFighter, 0);

  const third = await run();
  assert.equal(third.p.requests(), 0, "a finished backfill is free to run again (a mapping fix costs nothing)"); assert.equal(third.bouts.length, 2);

  const refreshed = await run({ refresh: true });
  assert.equal(refreshed.p.requests(), 4, "refresh fetches everything again");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("only a good answer is kept as a checkpoint; a damaged cache file is fetched again, not trusted", async () => {
  const fs = await import("node:fs");
  const dir = await tmp("good");
  const refuse = mockFetch(() => ({ status: 403, body: { message: "not on your plan" } }));
  await assert.rejects(() => B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: refuse.impl, cacheDir: dir, scheduleDays: 0 }).fetchBouts(), /403/);
  assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], [], "a refusal leaves nothing behind");
  const apiError = mockFetch(() => ({ body: env([], { error: { message: "quota" } }) }));
  await assert.rejects(() => B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: apiError.impl, cacheDir: dir, scheduleDays: 0 }).fetchBouts(), /quota/);
  assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], [], "and so does an error body");

  const ok = mockFetch(standard);
  await B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: ok.impl, cacheDir: dir, scheduleDays: 0 }).fetchBouts();
  const list = fs.readdirSync(dir).find((f) => f.startsWith("v2-fights"))!;
  fs.writeFileSync(`${dir}/${list}`, '{"data": [ {"id": "cut off mid-wri');
  const again = mockFetch(standard);
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: again.impl, cacheDir: dir, scheduleDays: 0 });
  assert.equal((await p.fetchBouts()).length, 2);
  assert.equal(countCalls(again.calls, "/v2/fights"), 1, "the damaged page was fetched again; the fighters still came from the cache");
  assert.equal(p.requests(), 1);
  assert.ok(fs.readdirSync(dir).every((f) => !f.endsWith(".tmp")), "no temporary files left");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("retries wait out Retry-After or back off 1, 2, 4 ... seconds (capped at 30), count against the budget, and give up with the real reason", async () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => { sleeps.push(ms); };
  const flaky = (statuses: number[], headers: Record<string, string> = {}) => {
    let i = 0;
    return mockFetch((path, q) => { if (path !== "/v2/fights/") return standard(path, q); const s = statuses[Math.min(i++, statuses.length - 1)]; return s === 200 ? { body: env(FIGHTS) } : { status: s, body: { message: "slow down" }, headers }; });
  };
  const make = (m: ReturnType<typeof flaky>, opts: Partial<B.BoxingDataApiOptions> = {}) => B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: m.impl, sleep, scheduleDays: 0, retries: 3, ...opts });

  let m = flaky([429, 200], { "retry-after": "2" });
  let p = make(m); await p.fetchBouts();
  assert.equal(sleeps.splice(0)[0], 2000, "Retry-After is obeyed (the requests after a refusal are then paced: round 75)"); assert.equal(countCalls(m.calls, "/v2/fights"), 2);

  m = flaky([503, 502, 200]); p = make(m); await p.fetchBouts();
  assert.deepEqual(sleeps.splice(0), [1000, 2000], "no Retry-After: 1 s, then 2 s");

  m = flaky([500]); p = make(m, { retries: 2 });
  await assert.rejects(() => p.fetchBouts(), (e: Error) => /500 on \/v2\/fights\/: slow down/.test(e.message) && !e.message.includes(KEY));
  assert.deepEqual(sleeps.splice(0), [1000, 2000]); assert.equal(countCalls(m.calls, "/v2/fights"), 3, "the first try and two retries");

  m = flaky([403]); p = make(m);
  await assert.rejects(() => p.fetchBouts(), /403/);
  assert.deepEqual(sleeps.splice(0), [], "a refusal is not retried"); assert.equal(countCalls(m.calls, "/v2/fights"), 1);

  m = flaky([500]); p = make(m, { retries: 8 });
  await assert.rejects(() => p.fetchBouts(), /500/);
  assert.deepEqual(sleeps.splice(0), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000], "the wait is capped");

  m = flaky([500]); p = make(m, { retries: 5, maxRequests: 2 });
  await assert.rejects(() => p.fetchBouts(), (e: Error) => e instanceof B.BudgetError);
  assert.equal(countCalls(m.calls, "/v2/fights"), 2, "a retry spends the budget like any request");
  sleeps.length = 0;

  let tries = 0;
  const net = (async (url: string) => { if (String(url).includes("/v2/fights/") && tries++ < 1) throw new Error("socket hang up"); return mockFetch(standard).impl(url); }) as unknown as typeof fetch;
  await B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: net, sleep, scheduleDays: 0, retries: 2 }).fetchBouts();
  assert.deepEqual(sleeps.splice(0), [1000], "a dropped connection is retried");
  const dead = (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as unknown as typeof fetch;
  await assert.rejects(() => B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: dead, sleep, scheduleDays: 0, retries: 1 }).fetchBouts(), (e: Error) => /unreachable on \/v2\/fights\/: getaddrinfo ENOTFOUND/.test(e.message) && !e.message.includes(KEY));
});

test("plan prices the backfill before it is spent: the list pages are fetched, the fighters are counted and not fetched, and a cache makes them free", async () => {
  const fs = await import("node:fs");
  const dir = await tmp("plan");
  const m = mockFetch(standard);
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: m.impl, cacheDir: dir, scheduleDays: 0 });
  const sizes = (x: Awaited<ReturnType<typeof p.plan>>) => { const { selection, modes, ...rest } = x; assert.ok(modes && modes.length >= 1, "and what the other two ways of choosing would give"); assert.ok(selection && selection.length >= 1, "the plan also says what taking only the most recent fighters would give"); return rest; };
  assert.deepEqual(sizes(await p.plan()), { fights: 2, events: 2, fighters: 3, fightersCached: 0, fighterRequests: 3, requestsMade: 1 });
  assert.equal(countCalls(m.calls, "/v2/fighters/"), 0, "no fighter was fetched to find out");
  await p.fetchBouts();
  assert.equal(countCalls(m.calls, "/v2/fights"), 1, "the list pages were not fetched twice");

  const later = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: mockFetch(standard).impl, cacheDir: dir, scheduleDays: 0 });
  assert.deepEqual(sizes(await later.plan()), { fights: 2, events: 2, fighters: 3, fightersCached: 3, fighterRequests: 0, requestsMade: 0 }, "everything is already in the cache");
  const fresh = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: mockFetch(standard).impl, cacheDir: dir, refresh: true, scheduleDays: 0 });
  assert.equal((await fresh.plan()).fighterRequests, 3, "with refresh nothing counts as cached");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a placeholder pasted instead of the key is refused at once with a plain message (not four retries and a cryptic one), and a real-looking bad key is never echoed", () => {
  for (const bad of ["…", "...", "xxx", "your-key", "paste the real key here please", "kéy", "", "0123456789abcdef0123456789\n"]) {
    assert.throws(() => B.boxingDataApiProvider({ key: bad, purpose: "evaluation" }), (e: Error) => /not a plausible API key/.test(e.message) && /read -s/.test(e.message), JSON.stringify(bad));
  }
  const secretish = "sécret-0123456789abcdefghij-value";
  assert.throws(() => B.boxingDataApiProvider({ key: secretish, purpose: "evaluation" }), (e: Error) => /not a plausible API key/.test(e.message) && !e.message.includes("sécret") && !e.message.includes("0123456789abcdefghij"));
  // a real key's shape (long, printable, no spaces) is accepted; a short key is fine when no real server will see it (tests, replay)
  assert.doesNotThrow(() => B.boxingDataApiProvider({ key: "670ff79763msh4f16640bd83dd54p15aae0jsn46b3a23a82ed", purpose: "evaluation" }));
  assert.doesNotThrow(() => B.boxingDataApiProvider({ key: "replay", purpose: "evaluation", fetchImpl: (async () => new Response("{}")) as typeof fetch }));
  assert.throws(() => B.boxingDataApiProvider({ key: "replay", purpose: "evaluation" }), /not a plausible API key/, "but the same short key to the real server is refused");
});

test("importer hygiene (round 73): a fighter against himself is skipped, a knockout with no winner becomes a no result, 'round 12 of 10' lengthens the fight", () => {
  const n = notes();
  assert.equal(B.mapFight(fight("h1", "A", "A"), n), null, "a fight of a fighter against himself");
  assert.equal(n.fightsSkipped, 1);
  const noWinner = { fighter_1: side("A", false), fighter_2: side("B", false) };
  const ko = B.mapFight(fight("h2", "A", "B", { fighters: noWinner, results: { outcome: "KO", round: 4 } }), n)!.bout;
  assert.equal(ko.winnerExternalId ?? null, null); assert.equal(ko.method ?? null, null, "no winner, so not a knockout"); assert.equal(n.stoppageWithoutWinner, 1);
  const draw = B.mapFight(fight("h3", "A", "B", { fighters: noWinner, results: { outcome: "MD", round: null } }), n)!.bout;
  assert.equal(draw.method, "DRAW", "a decision with no winner is still a draw"); assert.equal(n.stoppageWithoutWinner, 1);
  const long = B.mapFight(fight("h4", "A", "B", { scheduled_rounds: 10, results: { outcome: "KO", round: 12 } }), n)!.bout;
  assert.equal(long.rounds, 12); assert.equal(long.endRound, 12); assert.equal(n.roundsRaisedToEnd, 1);
  const fine = B.mapFight(fight("h5", "A", "B", { scheduled_rounds: 10, results: { outcome: "KO", round: 7 } }), n)!.bout;
  assert.equal(fine.rounds, 10); assert.equal(n.roundsRaisedToEnd, 1, "a stoppage inside the schedule is untouched");
});

test("a drawn fight is kept only where each fighter's career record has room for a draw; one the vendor never recorded becomes 'no result yet' (round 74)", () => {
  const n = notes();
  const d = (id: string, a: string, b: string) => B.mapFight(fight(id, a, b, { fighters: { fighter_1: side(a, false), fighter_2: side(b, false) }, results: { outcome: "SD", round: null } }), n)!.bout;
  const bouts = [d("d1", "A", "B"), d("d2", "C", "D"), d("d3", "A", "E"), d("d4", "F", "G")];
  const vendor = new Map([["bda-f-A", { wins: 5, losses: 0, draws: 1 }], ["bda-f-B", { wins: 0, losses: 0, draws: 2 }], ["bda-f-C", { wins: 18, losses: 0, draws: 0 }], ["bda-f-D", { wins: 1, losses: 0, draws: 1 }], ["bda-f-E", { wins: 0, losses: 0, draws: 3 }]]);
  const out = B.demoteUnsupportedDraws(bouts, vendor, n);
  assert.deepEqual(out.map((b) => b.method), ["DRAW", null, null, "DRAW"], "C has no draws (demoted); A's one draw is used up by the first; F and G have no record, so the draw stays");
  assert.equal(out[1].endRound, null); assert.equal(out[1].scores, undefined); assert.equal(n.drawDemoted, 2);
});

test("through a real load: a decision with no winner is a draw only if the vendor's totals have room for it (round 74)", async () => {
  const noWinner = { fighter_1: side("A1", false), fighter_2: side("B1", false) };
  const both: Record<string, B.ApiFighter> = {
    A1: fighter("A1", "Alpha One", { stats: { wins: 18, losses: 0, draws: 0, total_bouts: 18 } }),
    B1: fighter("B1", "Bravo One", { stats: { wins: 3, losses: 1, draws: 1, total_bouts: 5 } }),
    C1: fighter("C1", "Charlie One", { stats: { wins: 2, losses: 0, draws: 1, total_bouts: 3 } }),
  };
  const fights = [fight("1", "A1", "B1", { fighters: noWinner, results: { outcome: "SD", round: null } }), fight("2", "B1", "C1", { fighters: { fighter_1: side("B1", false), fighter_2: side("C1", false) }, results: { outcome: "MD", round: null }, date: "2025-03-01T20:00:00Z", event: { id: "ev-2", title: "Spring", date: "2025-03-01T20:00:00Z", location: "London, United Kingdom", venue: "O2" } })];
  const { impl } = mockFetch((path) => path === "/v2/fights/" ? { body: env(fights) } : path === "/v2/fights/schedule" ? { body: env([]) } : { body: env(both[path.split("/").pop()!]) });
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, scheduleDays: 0 });
  const bouts = await p.fetchBouts();
  const by = Object.fromEntries(bouts.map((b) => [b.externalId, b.method]));
  assert.deepEqual([by["bda-b-1"], by["bda-b-2"]], [null, "DRAW"], "Alpha has no draws (his fight with Bravo is not a draw); Bravo and Charlie each have one");
  assert.equal(p.notes().drawDemoted, 1); assert.equal(p.notes().drawInferred, 2);
});

test("a run given no --per-hour slows itself after the first rate-limit refusal; one given --per-hour is paced from the start; the run says so (round 75)", async () => {
  const fighters = ["A1", "B1", "C1", "D1"];
  const run = async (extra: Partial<Parameters<typeof B.boxingDataApiProvider>[0]>) => {
    let refused = false;
    const sleeps: number[] = [], lines: string[] = [];
    const { impl } = mockFetch((path) => {
      if (path === "/v2/fights/") return { body: env(fighters.slice(1).map((f, i) => fight(`f${i}`, fighters[i], f))) };
      if (path === "/v2/fights/schedule") return { body: env([]) };
      if (path === "/v2/fighters/C1" && !refused) { refused = true; return { status: 429, body: { message: "You have exceeded the rate limit per hour for your plan, MEGA, by the API provider" } }; }
      return { body: env(fighter(path.split("/").pop()!, `F ${path.split("/").pop()}`)) };
    });
    const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, scheduleDays: 0, sleep: async (ms) => { sleeps.push(ms); }, log: (m) => lines.push(m), patienceMs: 3_600_000, ...extra });
    await p.fetchBoxers();
    return { sleeps, lines };
  };
  const auto = await run({});
  assert.ok(auto.lines.some((l) => /no --per-hour was given, so from now on .* 400 requests an hour/.test(l)), auto.lines.join("\n"));
  assert.ok(auto.sleeps.filter((ms) => ms === 9000).length >= 1, `after the refusal each request waits 9 s (400 an hour): ${auto.sleeps}`);
  const given = await run({ perHour: 450 });
  assert.ok(!given.lines.some((l) => /no --per-hour was given, so from now on/.test(l)), "a run with its own pace keeps it");
  assert.ok(given.sleeps.includes(8000), `450 an hour is 8 s apart: ${given.sleeps}`);
});

test("before fetching, the run says how many fighters are not cached, and warns when that is a burst with no --per-hour (round 75)", async () => {
  const many = Array.from({ length: 320 }, (_, i) => `X${i}`);
  const lines: string[] = [];
  const dir = await tmp("burst");
  const { impl } = mockFetch((path) => {
    if (path === "/v2/fights/") return { body: env(many.slice(1).map((f, i) => fight(`g${i}`, many[i], f))) };
    if (path === "/v2/fights/schedule") return { body: env([]) };
    return { body: env(fighter(path.split("/").pop()!, "F")) };
  });
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, scheduleDays: 0, cacheDir: dir, log: (m) => lines.push(m), maxFights: 400, maxRequests: 10_000 });
  await p.fetchBoxers();
  assert.ok(lines.some((l) => /^320 fighters are not in the cache and no --per-hour was given/.test(l)), lines.join("\n"));
  lines.length = 0;
  const q = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, scheduleDays: 0, cacheDir: dir, log: (m) => lines.push(m), maxFights: 400, maxRequests: 10_000, perHour: 450 });
  await q.fetchBoxers();
  assert.ok(!lines.some((l) => /not in the cache/.test(l)) && !lines.some((l) => /^\d+ fighters to fetch/.test(l)), lines.join("\n"));
  // the estimate is in minutes: 320 fighters at 450 an hour is 320 * 60 / 450 = 43 minutes (a first version printed seconds under the word minutes)
  const r = await tmp("eta");
  const s1 = (m: string[]) => m.find((l) => /^\d+ fighters to fetch/.test(l)) ?? "";
  const l2: string[] = [];
  await B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, scheduleDays: 0, cacheDir: r, log: (m) => l2.push(m), maxFights: 400, maxRequests: 10_000, perHour: 450, sleep: async () => {} }).fetchBoxers();
  assert.match(s1(l2), /^320 fighters to fetch, about 43 minute\(s\) at 450 an hour$/);
});

test("through a real load: a fight listed under two profiles of the same opponent is one bout (round 82)", async () => {
  const both: Record<string, B.ApiFighter> = { A1: fighter("A1", "Alpha One"), B1: fighter("B1", "Bravo One"), B2: fighter("B2", "Bravo One") };
  const day2 = "2024-12-22T21:00:00+00:00";
  const fights = [fight("1", "A1", "B1"), fight("2", "A1", "B2", { date: day2, event: { id: "ev-2", title: "Reignited", date: day2, location: "Riyadh, Saudi Arabia", venue: "Kingdom Arena" } })];
  const { impl } = mockFetch((path) => path === "/v2/fights/" ? { body: env(fights) } : path === "/v2/fights/schedule" ? { body: env([]) } : { body: env(both[path.split("/").pop()!]) });
  const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: impl, scheduleDays: 0 });
  const bouts = await p.fetchBouts();
  assert.equal(bouts.length, 1, "one fight, not two against 'Bravo One'");
  assert.equal(p.notes().duplicateFightsMerged, 1); assert.equal(p.notes().duplicateFightsAcrossProfiles, 1);
});

test("a run with patience waits out a network outage instead of skipping fighters; one whose network stays down stops; one without patience skips as before (round 84)", async () => {
  const run = async (failures: number, extra: Partial<B.BoxingDataApiOptions>) => {
    const sleeps: number[] = [], lines: string[] = [];
    let seen = 0;
    const inner = mockFetch(standard).impl;
    const flaky = (async (url: string, init?: RequestInit) => { if (String(url).includes("/v2/fighters/A1") && seen++ < failures) throw new TypeError("fetch failed"); return inner(url, init); }) as unknown as typeof fetch;
    const p = B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: flaky, scheduleDays: 0, retries: 4, sleep: async (ms) => { sleeps.push(ms); }, log: (m) => lines.push(m), ...extra });
    const boxers = await p.fetchBoxers().then((b) => b, (e: Error) => e);
    return { boxers, sleeps, lines };
  };
  // five failures in a row, then the network is back: every fighter arrives, none skipped, the waits grow
  const back = await run(5, { patienceMs: 3_600_000 });
  assert.ok(Array.isArray(back.boxers) && back.boxers.length === 3, "all three fighters, none skipped");
  assert.deepEqual(back.sleeps.filter((ms) => ms >= 10_000), [10_000, 30_000, 60_000, 120_000, 300_000]);
  assert.ok(!back.lines.some((l) => /skipped/.test(l)));
  // the network never comes back: the run stops with a message that says so, after the patience, rather than skipping
  const down = await run(1e9, { patienceMs: 5 * 60_000 });
  assert.ok(down.boxers instanceof B.NetworkError, String(down.boxers));
  assert.match((down.boxers as Error).message, /network looks down: run the same command again/);
  assert.deepEqual(down.sleeps.filter((ms) => ms >= 10_000), [10_000, 30_000, 60_000, 120_000], "220 s waited; the next step (300 s) would pass the 5 minutes");
  // no patience: the quick retries and then the fighter is skipped, as it always was
  const none = await run(1e9, {});
  assert.ok(Array.isArray(none.boxers) && none.boxers.length === 2, "A1 skipped, the others loaded");
  assert.ok(none.lines.some((l) => /fighter A1 skipped: Boxing Data API unreachable/.test(l)));
});
