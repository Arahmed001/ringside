import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeLimiter } from "../lib/rate-limit";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

// the library and the routes open the database as soon as they are loaded, so they are imported (below) after tempDb has pointed it at a file of this test's own
const cleanup = tempDb("public-api", "2026-10-03");
let publicApiGate: typeof import("../lib/public-api").publicApiGate, paging: typeof import("../lib/public-api").paging, openApiSpec: typeof import("../lib/public-api").openApiSpec, API_PATHS: typeof import("../lib/public-api").API_PATHS;
let respond: typeof import("../lib/public-api-http").respond;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-api-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

test("the switch: on for the demo and a file feed, off for a licensed feed until BOTH the owner's switch and the redistribution statement are set", () => {
  const g = (env: Record<string, string>) => publicApiGate(env);
  assert.equal(g({}).open, true); assert.equal(g({ BOXING_PROVIDER: "demo" }).open, true); assert.equal(g({ BOXING_PROVIDER: "file" }).open, true);
  assert.equal(g({ PUBLIC_API: "0" }).open, false, "switched off for the demo too"); assert.match(g({ PUBLIC_API: "0" }).why, /switched off/);
  assert.equal(g({ BOXING_PROVIDER: "licensed" }).open, false); assert.match(g({ BOXING_PROVIDER: "licensed" }).why, /PUBLIC_API=1/);
  assert.equal(g({ BOXING_PROVIDER: "licensed", PUBLIC_API: "1" }).open, false); assert.match(g({ BOXING_PROVIDER: "licensed", PUBLIC_API: "1" }).why, /VENDOR_REDISTRIBUTION_CONFIRMED=1/);
  assert.equal(g({ BOXING_PROVIDER: "licensed", VENDOR_REDISTRIBUTION_CONFIRMED: "1" }).open, false, "the statement alone is not the switch");
  assert.equal(g({ BOXING_PROVIDER: "licensed", PUBLIC_API: "1", VENDOR_REDISTRIBUTION_CONFIRMED: "1" }).open, true);
  assert.equal(g({ BOXING_PROVIDER: "licensed", PUBLIC_API: "true", VENDOR_REDISTRIBUTION_CONFIRMED: "yes" }).open, false, "only 1 counts: a statement of this kind is not guessed from a loose value");
  assert.equal(g({ BOXING_PROVIDER: "licensed", PUBLIC_API: "0", VENDOR_REDISTRIBUTION_CONFIRMED: "1" }).open, false, "off wins");
});

test("paging: whole numbers, the limit from 1 to 50", () => {
  const p = (s: string) => paging(new URLSearchParams(s));
  assert.deepEqual(p(""), { limit: 20, offset: 0 }); assert.deepEqual(p("limit=50&offset=100"), { limit: 50, offset: 100 });
  for (const bad of ["limit=0", "limit=51", "limit=-1", "limit=x", "offset=-1", "offset=1.5", "limit=2e1", "offset=99999999"]) assert.equal(p(bad), null, bad);
});

test("the limiter: so many a window, the wait said, the window renewing, and a table that cannot grow without end", () => {
  let now = 1000;
  const l = makeLimiter({ limit: 3, windowMs: 60_000, maxKeys: 4, now: () => now });
  assert.deepEqual([l.hit("a"), l.hit("a"), l.hit("a")].map((x) => [x.ok, x.remaining]), [[true, 2], [true, 1], [true, 0]]);
  now += 10_000; const over = l.hit("a"); assert.equal(over.ok, false); assert.equal(over.retryAfterSec, 50);
  assert.equal(l.hit("b").ok, true, "another address has its own window");
  now += 50_000; assert.equal(l.hit("a").ok, true, "a new window");
  for (const k of ["c", "d", "e", "f", "g", "h"]) l.hit(k); // more keys than the table holds: the oldest go, nothing throws
  assert.equal(l.hit("h").ok, true);
});

// ---- over a league ----
type Reply = { status: number; headers: Headers; json: Record<string, unknown> & { data?: unknown; meta?: Record<string, unknown>; error?: { status: number; message: string } } };
let call: (route: string, query?: string, params?: Record<string, string>, env?: Record<string, string>) => Promise<Reply>;
let routes: Record<string, { GET: (r: Request, c?: { params: Promise<Record<string, string>> }) => Promise<Response>; OPTIONS: () => Response }>;

before(async () => {
  const feed = miniFeed();
  const names = ["Alma Ruiz", "Bea Cole", "Cyrus Dean", "Dov Eden", "Eli Fox", "Fay Gil", "Gus Hay"];
  feed.boxers = names.map((n, i) => makeBoxer(`B${i}`, i === 6 ? "Heavyweight" : "Lightweight", { name: n, country: i % 2 ? "Mexico" : "United States", ...(i === 5 ? { active: false } : {}) }));
  feed.orgs = [{ externalId: "o-wbc", name: "World Boxing Council", kind: "sanctioning_body" }];
  const ev = (id: string, date: string) => ({ externalId: id, name: `Night ${id}`, date, venue: "T-Mobile Arena", city: "Las Vegas", country: "United States" });
  const pairs: [number, number][] = []; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) pairs.push([i, j]);
  feed.events = [...pairs.map((_, k) => ev(`R${k}`, `2026-0${1 + (k % 8)}-${10 + (k % 15)}`)), ev("UP", "2026-10-20"), ev("FAR", "2026-12-01")];
  feed.bouts = [
    ...pairs.map(([i, j], k) => ({ externalId: `RB${k}`, eventExternalId: `R${k}`, redExternalId: `B${i}`, blueExternalId: `B${j}`, weightClass: "Lightweight", rounds: 12, winnerExternalId: `B${i}`, method: "UD", endRound: 12, title: k === 0 ? "WBC World Lightweight Champion" : null, titleOrgExternalId: k === 0 ? "o-wbc" : undefined, position: 0 })),
    { externalId: "UPB", eventExternalId: "UP", redExternalId: "B0", blueExternalId: "B1", weightClass: "Lightweight", rounds: 12, winnerExternalId: null, method: null, endRound: null, title: null, position: 0 },
    { externalId: "FARB", eventExternalId: "FAR", redExternalId: "B2", blueExternalId: "B3", weightClass: "Lightweight", rounds: 12, winnerExternalId: null, method: null, endRound: null, title: null, position: 0 },
  ] as never;
  feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = [];
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file; process.env.SITE_URL = "https://ringside.test";
  ({ publicApiGate, paging, openApiSpec, API_PATHS } = await import("../lib/public-api")); ({ respond } = await import("../lib/public-api-http"));
  routes = {
    divisions: await import("../app/api/v1/divisions/route"), fighters: await import("../app/api/v1/fighters/route"), fighter: await import("../app/api/v1/fighters/[slug]/route"),
    rankings: await import("../app/api/v1/rankings/[division]/route"), events: await import("../app/api/v1/events/route"), event: await import("../app/api/v1/events/[id]/route"), openapi: await import("../app/api/v1/openapi.json/route"),
  } as never;
  let n = 0;
  call = async (route, query = "", params, env) => {
    const req = new Request(`https://ringside.test/api/v1/x${query ? `?${query}` : ""}`, { headers: { "x-forwarded-for": `10.0.${Math.floor(n / 250)}.${n++ % 250}` } }); // a new address each call: the limit is tested on its own
    const saved = { ...process.env };
    if (env) Object.assign(process.env, env);
    try { const res = await routes[route].GET(req, params ? { params: Promise.resolve(params) } : undefined); const text = await res.text(); return { status: res.status, headers: res.headers, json: JSON.parse(text) }; }
    finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  };
});

test("fighters: best rated first with a total, paged, filtered by division, country, sex and activity, searched by a name with a slip", async () => {
  const all = await call("fighters", "limit=50");
  assert.equal(all.status, 200); const rows = all.json.data as { slug: string; name: string; rating: number; record: { wins: number; losses: number; draws: number; source: string }; url: string; divisionSlug: string }[];
  assert.equal(all.json.meta!.total, 7); assert.equal(rows.length, 7); assert.deepEqual(rows.map((r) => r.rating), [...rows.map((r) => r.rating)].sort((a, b) => b - a), "best rated first");
  assert.equal(rows.find((r) => r.slug === "alma-ruiz")!.url, "https://ringside.test/boxers/alma-ruiz"); assert.equal(rows.find((r) => r.slug === "alma-ruiz")!.record.wins, 5);
  const page = await call("fighters", "limit=3&offset=2"); assert.equal((page.json.data as unknown[]).length, 3); assert.deepEqual(page.json.meta, { ...page.json.meta, total: 7, limit: 3, offset: 2 });
  assert.equal(((await call("fighters", "division=heavyweight")).json.data as unknown[]).length, 1);
  assert.equal((await call("fighters", "country=mexico")).json.meta!.total, 3, "country without regard to case");
  assert.equal((await call("fighters", "active=false")).json.meta!.total, 1);
  assert.equal((await call("fighters", "sex=female")).json.meta!.total, 0);
  const found = (await call("fighters", "q=Alma%20Rui")).json.data as { slug: string }[]; assert.equal(found[0].slug, "alma-ruiz", "a letter missing still finds her");
  for (const bad of ["limit=0", "limit=99", "division=nowhere", "sex=other", "active=maybe", "offset=-1"]) { const r = await call("fighters", bad); assert.equal(r.status, 400, bad); assert.equal(r.json.error!.status, 400); assert.ok(typeof r.json.error!.message === "string" && r.json.error!.message.length > 5); }
});

test("one fighter: the record as the page shows it, the last fights newest first with the result for the fighter, the next fight, the rank", async () => {
  const r = await call("fighter", "", { slug: "alma-ruiz" }); assert.equal(r.status, 200);
  const d = r.json.data as { name: string; record: { wins: number; source: string }; lastFights: { date: string; result: { forFighter: string; method: string; winner: { slug: string } | null } }[]; nextFight: { red: { slug: string }; blue: { slug: string }; date: string } | null; divisionRank: number | null; knockouts: unknown; recordNote: string | null };
  assert.equal(d.name, "Alma Ruiz"); assert.equal(d.record.wins, 5); assert.equal(d.record.source, "loaded"); assert.equal(d.recordNote, null);
  assert.equal(d.lastFights.length, 5); assert.deepEqual(d.lastFights.map((x) => x.date), [...d.lastFights.map((x) => x.date)].sort().reverse(), "newest first");
  assert.ok(d.lastFights.every((x) => x.result.forFighter === "W" && x.result.method === "UD" && x.result.winner?.slug === "alma-ruiz"));
  assert.equal(d.nextFight!.date, "2026-10-20"); assert.equal(d.nextFight!.blue.slug, "bea-cole"); assert.equal(d.divisionRank, 1); assert.ok(d.knockouts);
  const none = await call("fighter", "", { slug: "nobody-here" }); assert.equal(none.status, 404); assert.equal(none.json.error!.message, "no such fighter");
});

test("rankings: a division by its slug, ranked by rating, with the place, the movement and the total; an unknown division is 404", async () => {
  const r = await call("rankings", "", { division: "lightweight" }); assert.equal(r.status, 200);
  const rows = r.json.data as { rank: number; slug: string }[];
  assert.deepEqual(rows.map((x) => [x.rank, x.slug]), [[1, "alma-ruiz"], [2, "bea-cole"], [3, "cyrus-dean"]], "5 fights held and a winning record: three of the six qualify");
  assert.equal(r.json.meta!.total, 3); assert.equal(r.json.meta!.division, "Lightweight"); assert.match(String(r.json.meta!.rule), /winning record/);
  assert.equal(((await call("rankings", "limit=1&offset=1", { division: "lightweight" })).json.data as { rank: number }[])[0].rank, 2);
  assert.equal((await call("rankings", "", { division: "catchweight" })).status, 404); assert.equal((await call("rankings", "sex=x", { division: "lightweight" })).status, 400);
  assert.equal(((await call("rankings", "sex=female", { division: "lightweight" })).json.data as unknown[]).length, 0);
});

test("events: upcoming soonest first, recent newest first, one event with its bouts and each result; a bad id and an unknown one", async () => {
  const up = await call("events", "when=upcoming"); const ups = up.json.data as { id: number; name: string; date: string; upcoming: boolean; mainEvent: { red: { slug: string } } }[];
  assert.deepEqual(ups.map((e) => e.date), ["2026-10-20", "2026-12-01"]); assert.equal(up.json.meta!.total, 2); assert.equal(ups[0].mainEvent.red.slug, "alma-ruiz");
  const recent = (await call("events", "when=recent&limit=3")).json.data as { date: string }[]; assert.equal(recent.length, 3); assert.deepEqual(recent.map((e) => e.date), [...recent.map((e) => e.date)].sort().reverse());
  assert.equal((await call("events", "when=past")).status, 400);
  const one = await call("event", "", { id: String(ups[0].id) }); const e = one.json.data as { bouts: { status: string; result: unknown }[] };
  assert.equal(e.bouts.length, 1); assert.equal(e.bouts[0].result, null, "a fight not yet held has no result");
  const past = (await call("events", "when=recent&limit=50")).json.data as { id: number }[];
  const decided = (await call("event", "", { id: String(past[0].id) })).json.data as { bouts: { result: { method: string; winner: { slug: string } } }[] };
  assert.equal(decided.bouts[0].result.method, "UD"); assert.ok(decided.bouts[0].result.winner.slug);
  assert.equal((await call("event", "", { id: "abc" })).status, 400); assert.equal((await call("event", "", { id: "999999" })).status, 404);
});

test("divisions, and the language: lang=ar gives Arabic text where there is any (a belt's name here)", async () => {
  const d = (await call("divisions")).json.data as { name: string; slug: string }[]; assert.equal(d.length, 17); assert.equal(d[0].slug, "minimumweight"); assert.equal(d.at(-1)!.slug, "heavyweight");
  const titled = (await call("events", "when=recent&limit=50&lang=ar")).json; assert.equal(titled.meta!.lang, "ar");
  const ids = (titled.data as { id: number }[]).map((e) => String(e.id));
  let title: string | null = null;
  for (const id of ids) { const e = (await call("event", "lang=ar", { id })).json.data as { bouts: { title: string | null; url: string }[] }; const b = e.bouts.find((x) => x.title); if (b) { title = b.title; assert.ok(b.url.includes("/ar/bouts/"), "links keep the language"); } }
  assert.equal(title, "لقب WBC العالمي في الوزن الخفيف");
  assert.equal((await call("divisions", "lang=xx")).json.meta!.lang, "en", "an unknown language is English");
});

test("every answer: one envelope, CORS for GET, a five-minute cache, the rate headers, the day of the data; OPTIONS answers the preflight", async () => {
  const r = await call("fighters", "limit=1");
  assert.deepEqual(Object.keys(r.json).sort(), ["data", "meta"]); assert.equal(r.json.meta!.updated, "2026-10-03"); assert.equal(r.json.meta!.source, "Ringside");
  assert.equal(r.headers.get("access-control-allow-origin"), "*"); assert.match(r.headers.get("content-type") ?? "", /^application\/json/); assert.match(r.headers.get("cache-control") ?? "", /public, max-age=300/);
  assert.equal(r.headers.get("x-ratelimit-limit"), "60"); assert.ok(Number(r.headers.get("x-ratelimit-remaining")) <= 59);
  const bad = await call("fighters", "limit=0"); assert.deepEqual(Object.keys(bad.json), ["error"]); assert.equal(bad.headers.get("cache-control"), "no-store"); assert.equal(bad.headers.get("access-control-allow-origin"), "*");
  const pre = routes.fighters.OPTIONS(); assert.equal(pre.status, 204); assert.equal(pre.headers.get("access-control-allow-methods"), "GET, OPTIONS");
});

test("the switch at the door: off means 404 with the reason (and CORS, so a browser can read it); a licensed feed is closed until both are set, and then credits the supplier", async () => {
  const off = await call("fighters", "", undefined, { PUBLIC_API: "0" }); assert.equal(off.status, 404); assert.match(off.json.error!.message, /switched off/); assert.equal(off.headers.get("access-control-allow-origin"), "*");
  const lic = await call("fighters", "", undefined, { BOXING_PROVIDER: "licensed" }); assert.equal(lic.status, 404); assert.match(lic.json.error!.message, /PUBLIC_API=1/);
  const open = await call("fighters", "limit=1", undefined, { BOXING_PROVIDER: "licensed", PUBLIC_API: "1", VENDOR_REDISTRIBUTION_CONFIRMED: "1" });
  assert.equal(open.status, 200); assert.match(String(open.json.meta!.credit), /Boxing Data API \(https:\/\/boxing-data\.com\)/);
  assert.equal((await call("openapi", "", undefined, { PUBLIC_API: "0" })).status, 404, "the description is behind the same door");
});

test("too many requests: the 61st from one address in a minute is a 429 that says how long to wait; another address is not affected", async () => {
  const lim = makeLimiter({ limit: 2, windowMs: 60_000, now: () => 5000 });
  const ask = (ip: string) => respond(new Request("https://ringside.test/api/v1/divisions", { headers: { "x-forwarded-for": `${ip}, 10.9.9.9` } }), () => ({ data: [] }), undefined, lim);
  assert.equal((await ask("1.1.1.1")).status, 200); assert.equal((await ask("1.1.1.1")).status, 200);
  const third = await ask("1.1.1.1"); assert.equal(third.status, 429); assert.equal(third.headers.get("retry-after"), "60"); assert.match((await third.json()).error.message, /60 seconds/);
  assert.equal((await ask("2.2.2.2")).status, 200, "the first address in X-Forwarded-For is the key");
  const boom = await respond(new Request("https://ringside.test/api/v1/x", { headers: { "x-forwarded-for": "3.3.3.3" } }), () => { throw new Error("secret detail /etc/passwd"); }, undefined, lim);
  assert.equal(boom.status, 500); assert.ok(!(await boom.text()).includes("secret detail"), "an exception's text never reaches the answer");
});

test("nothing private: no field of any answer is named like an account, a session, an address or a pick", async () => {
  const keys = new Set<string>();
  const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
  const slug = "alma-ruiz";
  const evs = (await call("events", "when=recent&limit=50")).json.data as { id: number }[];
  for (const r of [await call("divisions"), await call("fighters", "limit=50"), await call("fighter", "", { slug }), await call("rankings", "", { division: "lightweight" }), await call("events", "when=upcoming"), await call("event", "", { id: String(evs[0].id) }), await call("openapi")]) walk(r.json);
  const banned = [...keys].filter((k) => /email|password|token|session|cookie|secret|account|user|pick|ip(addr|$)|phone|address|wikidata|boxrec|photo/i.test(k));
  assert.deepEqual(banned, [], "a field that looks private");
  assert.ok(keys.size > 30, "the scan saw a good spread of fields");
});

test("the OpenAPI description is the API: its paths are exactly the routes that exist, and every parameter it names is one the code reads", async () => {
  const spec = (await call("openapi")).json as unknown as { openapi: string; servers: { url: string }[]; paths: Record<string, { get: { parameters: { name: string; in: string }[] } }> };
  assert.equal(spec.openapi, "3.0.3"); assert.equal(spec.servers[0].url, "https://ringside.test");
  assert.deepEqual(Object.keys(spec.paths).sort(), [...API_PATHS].sort());
  const onDisk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? onDisk(path.join(d, e.name)) : e.name === "route.ts" ? [d] : []);
  const base = path.join(process.cwd(), "app/api/v1");
  const real = onDisk(base).map((d) => "/api/v1/" + path.relative(base, d).split(path.sep).map((s) => s.replace(/^\[(.+)\]$/, "{$1}")).join("/")).filter((p) => p !== "/api/v1/openapi.json" && p !== "/api/v1/").sort();
  assert.deepEqual(real, Object.keys(spec.paths).sort(), "no route without a description, no description without a route");
  const code = fs.readFileSync("lib/public-api.ts", "utf8");
  for (const [, op] of Object.entries(spec.paths)) for (const p of op.get.parameters) if (p.in === "query") assert.ok(new RegExp(`["'\`]${p.name}["'\`]`).test(code), `the code reads ${p.name}`);
  assert.equal(openApiSpec("https://x.test").openapi, "3.0.3");
});

test("a request with no address to tell it apart (no proxy header) shares one bucket with everybody, so that bucket's ceiling is ten times higher: a few people cannot shut the API for all (round 110)", async () => {
  const { API_LIMIT, API_SHARED_LIMIT, clientKey } = await import("../lib/public-api-http");
  assert.equal(API_SHARED_LIMIT, API_LIMIT * 10);
  assert.equal(clientKey(new Request("https://ringside.test/x")), "unknown"); assert.equal(clientKey(new Request("https://ringside.test/x", { headers: { "x-real-ip": "5.5.5.5" } })), "5.5.5.5");
  const per = makeLimiter({ limit: 2, windowMs: 60_000, now: () => 1 }), shared = makeLimiter({ limit: 5, windowMs: 60_000, now: () => 1, maxKeys: 1 });
  const ask = (headers: Record<string, string> = {}) => respond(new Request("https://ringside.test/api/v1/divisions", { headers }), () => ({ data: [] }), undefined, per, shared);
  const codes = async (n: number, headers?: Record<string, string>) => { const out: number[] = []; for (let i = 0; i < n; i++) out.push((await ask(headers)).status); return out; };
  assert.deepEqual(await codes(5), [200, 200, 200, 200, 200], "five with no address are fine where an address would be stopped at two");
  const busy = await ask(); assert.equal(busy.status, 429); assert.match((await busy.json()).error.message, /busy/); assert.equal(busy.headers.get("x-ratelimit-limit"), String(API_SHARED_LIMIT));
  assert.deepEqual(await codes(3, { "x-forwarded-for": "9.9.9.9" }), [200, 200, 429], "an address of its own is held to its own, smaller limit, whatever the shared bucket is doing");
  const ok = await ask({ "x-forwarded-for": "8.8.8.8" }); assert.equal(ok.headers.get("x-ratelimit-limit"), String(API_LIMIT));
});
