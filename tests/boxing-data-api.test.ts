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

const KEY = "sk-test-key-123";
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

test("a fighter: the documented Fury example maps field for field; birth year comes from the age and is counted", () => {
  const n = notes();
  const m = B.mapFighter(fury, n)!;
  assert.equal(m.externalId, "bda-f-6715fc1faf69bb50508b7a83"); assert.equal(m.name, "Tyson Fury"); assert.equal(m.country, "United Kingdom");
  assert.equal(m.stance, "Orthodox"); assert.equal(m.sex, "male"); assert.equal(m.heightCm, 206); assert.equal(m.reachCm, 216);
  assert.equal(m.weightClass, "Heavyweight"); assert.equal(m.turnedPro, 2008);
  assert.equal(m.birthYear, 2026 - 36, "today is pinned to 2026-10-03"); assert.equal(n.birthYearFromAge, 1);
  assert.equal(B.mapFighter(fighter("g", "G G", { gender: "f", nickname: null, alias: "The Ace", stance: "Southpaw" }), n)!.sex, "female");
  assert.equal(B.mapFighter(fighter("g", "G G", { alias: "The Ace" }), n)!.nickname, "The Ace");
  assert.equal(B.mapFighter(fighter("g", "G G", { stance: "ambidextrous" }), n)!.stance, "Switch");
  assert.equal(B.mapFighter(fighter("g", "G G", { stance: null }), n)!.stance, "Orthodox"); assert.equal(n.stanceDefaulted, 1);
  assert.equal(B.mapFighter(fighter("g", "G G", { age: null }), n)!.birthYear, 0); assert.equal(n.birthYearUnknown, 1);
  assert.equal(B.mapFighter({ id: "", name: "x" }, n), null);
});

test("missing height or reach is filled (from the other, then the division's median, then everyone's, then 175) and counted: no boxer is stored with a zero", () => {
  const n = notes();
  const rows = ([
    fighter("a", "A", { height_cm: 180, reach_cm: 182 }), fighter("b", "B", { height_cm: 190, reach_cm: 195 }), fighter("c", "C", { height_cm: 170, reach_cm: 171 }),
    fighter("d", "D", { height_cm: 185, reach_cm: null }), fighter("e", "E", { height_cm: null, reach_cm: 190 }),
    fighter("f", "F", { height_cm: null, reach_cm: null }), fighter("g", "G", { height_cm: null, reach_cm: null, division: { name: "Flyweight" } }),
  ].map((f) => B.mapFighter(f, n)!));
  const out = B.imputePhysicals(rows, n);
  const by = Object.fromEntries(out.map((r) => [r.name, r]));
  assert.equal(by.D.reachCm, 185, "reach from height"); assert.equal(by.E.heightCm, 190, "height from reach");
  assert.equal(by.F.heightCm, 185, "the median height of the other heavyweights (185 is the middle of 170, 180, 185, 190, 190)");
  assert.equal(by.G.heightCm, 185, "no other flyweight: everyone's median");
  assert.equal(n.physicalsImputed, 4);
  assert.ok(out.every((r) => r.heightCm! > 0 && r.reachCm! > 0));
  const alone = B.imputePhysicals([B.mapFighter(fighter("z", "Z", { height_cm: null, reach_cm: null }), notes())!], notes());
  assert.equal(alone[0].heightCm, 175, "with nothing to go on, a neutral value rather than zero");
});

test("active means a fight in the last 30 months; a missing debut year is the first fight seen", () => {
  const n = notes();
  const loose = [B.mapFighter(fighter("a", "A", { debut: null }), n)!, B.mapFighter(fighter("b", "B"), n)!, B.mapFighter(fighter("c", "C"), n)!];
  const mk = (id: string, red: string, blue: string, ev: string) => ({ externalId: id, eventExternalId: ev, redExternalId: `bda-f-${red}`, blueExternalId: `bda-f-${blue}`, weightClass: "Heavyweight", rounds: 12, winnerExternalId: null, method: null, endRound: null, title: null, position: 0 });
  const bouts = [mk("1", "a", "b", "e1"), mk("2", "a", "c", "e2")];
  const dates = new Map([["e1", "2019-05-01"], ["e2", "2026-05-01"]]);
  const out = Object.fromEntries(B.finishBoxers(loose, bouts, dates, n).map((r) => [r.name, r]));
  assert.equal(out.A.turnedPro, 2019); assert.equal(n.turnedProFromFirstFight, 1);
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
  assert.ok(boxers.find((b) => b.name === "Charlie One")!.heightCm > 0, "a fighter with no physicals is filled, not zero");
  assert.equal(p.notes().physicalsImputed, 1);
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
      return { body: env([fight(`p${p}`, "A1", "B1")], { pagination: { page: p, total_pages: 3, next_page: null } }) };
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

test("the database is not filled until the storage terms are confirmed; evaluating a sample is always allowed", () => {
  delete process.env.BOXING_API_STORAGE_CONFIRMED;
  assert.throws(() => B.boxingDataApiProvider({ key: KEY, purpose: "ingest" }), /storing data are unconfirmed/);
  assert.doesNotThrow(() => B.boxingDataApiProvider({ key: KEY, purpose: "evaluation" }));
  process.env.BOXING_API_STORAGE_CONFIRMED = "1";
  try { assert.doesNotThrow(() => B.boxingDataApiProvider({ key: KEY, purpose: "ingest" })); } finally { delete process.env.BOXING_API_STORAGE_CONFIRMED; }
});

test("BOXING_PROVIDER=licensed needs a key, and without the storage confirmation it refuses to fill the database", async () => {
  const { licensedProvider } = await import("../lib/providers/licensed");
  const saved = { ...process.env };
  try {
    delete process.env.BOXING_API_KEY; delete process.env.BOXING_API_STORAGE_CONFIRMED;
    assert.throws(() => licensedProvider(), /BOXING_API_KEY/);
    process.env.BOXING_API_KEY = KEY;
    assert.throws(() => licensedProvider(), /unconfirmed/);
    process.env.BOXING_API_STORAGE_CONFIRMED = "1";
    assert.equal(licensedProvider().name, "boxing-data-api");
  } finally { for (const k of ["BOXING_API_KEY", "BOXING_API_STORAGE_CONFIRMED"]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
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
