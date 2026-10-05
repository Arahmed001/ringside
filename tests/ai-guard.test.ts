import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/**
 * Anonymous visitors can reach the model through the plain-English search, scouting reports and fight previews.
 * These tests keep that bounded: per-client and daily limits, repeats served from a cache, concurrent identical
 * searches sharing one call, and a refused call falling back to the rules without poisoning the cache for anyone else.
 */
const cleanup = tempDb("ai-guard");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let guard: typeof import("../lib/ai-guard");
let ai: typeof import("../lib/ai");
let preview: typeof import("../lib/preview");
let lruMod: typeof import("../lib/lru");
before(async () => {
  w = await (await import("../lib/world")).getWorld();
  guard = await import("../lib/ai-guard"); ai = await import("../lib/ai"); preview = await import("../lib/preview"); lruMod = await import("../lib/lru");
});

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
let sent: { system: string; user: string }[] = [];
const mockModel = (reply: (n: number) => string = () => '{"stance":"Southpaw"}', delayMs = 0) => {
  sent = [];
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    const b = JSON.parse(init!.body!);
    sent.push({ system: b.system, user: b.messages[0].content });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return new Response(JSON.stringify({ content: [{ type: "text", text: reply(sent.length) }] }), { status: 200 });
  }) as typeof fetch;
};
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ["ANTHROPIC_API_KEY", "AI_DAILY_BUDGET", "AI_CLIENT_LIMIT", "AI_CLIENT_WINDOW_MS"]) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  guard.resetAiGuard();
});

test("per-client limit: refuses the extra call, other clients are unaffected, the window expires", () => {
  process.env.AI_CLIENT_LIMIT = "3"; process.env.AI_CLIENT_WINDOW_MS = "1000";
  const t0 = 1_000_000;
  assert.deepEqual([1, 2, 3, 4].map((i) => guard.reserveAiCall("a", t0 + i)), ["ok", "ok", "ok", "client"]);
  assert.equal(guard.reserveAiCall("b", t0 + 5), "ok", "a different client has its own allowance");
  assert.equal(guard.reserveAiCall("a", t0 + 500), "client", "still inside the window");
  assert.equal(guard.reserveAiCall("a", t0 + 1100), "ok", "the oldest calls have aged out");
  assert.equal(guard.aiUsage().used, 5, "refused calls are not counted against the budget");
});

test("daily budget is the hard stop across all clients, and resets on a new day", () => {
  process.env.AI_DAILY_BUDGET = "4"; process.env.AI_CLIENT_LIMIT = "100";
  assert.deepEqual(["a", "b", "c", "d", "e"].map((c) => guard.reserveAiCall(c)), ["ok", "ok", "ok", "ok", "budget"]);
  assert.equal(guard.reserveAiCall("fresh-client"), "budget", "rotating client ids does not get around it");
  const pinned = process.env.RINGSIDE_NOW;
  process.env.RINGSIDE_NOW = "2026-10-04";
  try { assert.equal(guard.reserveAiCall("a"), "ok", "a new UTC day starts a new budget"); } finally { process.env.RINGSIDE_NOW = pinned; }
});

test("the client table is bounded, and a budget of 0 turns the model off", () => {
  process.env.AI_CLIENT_LIMIT = "100000"; process.env.AI_DAILY_BUDGET = "1000000";
  for (let i = 0; i < 6000; i++) guard.reserveAiCall(`c${i}`);
  assert.ok(guard.aiUsage().clients <= 5000, "an attacker inventing ids cannot grow memory without limit");
  guard.resetAiGuard(); process.env.AI_DAILY_BUDGET = "0";
  assert.equal(guard.reserveAiCall("x"), "budget");
});

test("client id: first X-Forwarded-For hop, then X-Real-IP, then a shared bucket; bounded length", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
  assert.equal(guard.clientId(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  assert.equal(guard.clientId(h({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(guard.clientId(h({})), "anon");
  assert.equal(guard.clientId(h({ "x-forwarded-for": "x".repeat(500) })).length, 64);
});

test("the LRU keeps the most recently used entries and forgets the rest", () => {
  const l = new lruMod.Lru<string, number>(3);
  l.set("a", 1); l.set("b", 2); l.set("c", 3);
  assert.equal(l.get("a"), 1); // a is now the most recent
  l.set("d", 4);
  assert.deepEqual(["a", "b", "c", "d"].map((k) => l.get(k)), [1, undefined, 3, 4], "b was the least recently used");
  assert.equal(l.size, 3);
});

test("search: a repeat is free, spelling variants share an entry, concurrent identical searches share one call, long input is cut", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  mockModel(() => '{"stance":"Southpaw"}', 20);
  const [a, b] = await Promise.all([ai.parseQuery("southpaw welterweights", w, "c1"), ai.parseQuery("southpaw welterweights", w, "c2")]);
  assert.equal(sent.length, 1, "two simultaneous identical searches make one model call");
  assert.deepEqual([a.source, b.source], ["ai", "ai"]);
  assert.equal((await ai.parseQuery("  Southpaw   WELTERWEIGHTS ", w, "c3")).source, "ai");
  assert.equal(sent.length, 1, "case and spacing do not make a new query");
  await ai.parseQuery("x".repeat(5000), w, "c1");
  assert.equal(sent[1].user.length, 200, "the model never sees more than 200 characters");
});

test("a refused call answers with the rules for that visitor only, and is not remembered", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key"; process.env.AI_CLIENT_LIMIT = "1";
  mockModel();
  assert.equal((await ai.parseQuery("lightweights", w, "greedy")).source, "ai");
  const refused = await ai.parseQuery("heavyweights", w, "greedy");
  assert.equal(refused.source, "rules"); assert.equal(sent.length, 1, "no model call for a refused visitor");
  assert.ok(Object.keys(refused.filters).length > 0, "the rule-based answer is still a real answer");
  assert.equal((await ai.parseQuery("heavyweights", w, "someone-else")).source, "ai", "the refusal was not cached for the next visitor");
  assert.equal(sent.length, 2);
});

test("a model that errors (a refused key, an outage): the rules answer, nothing is remembered, calls pause for a minute, the cause is logged once, then it recovers", async () => {
  process.env.ANTHROPIC_API_KEY = "bad-key";
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("{}", { status: 401 }); }) as typeof fetch;
  try {
    const first = await ai.parseQuery("southpaw bantamweights", w, "u1");
    assert.equal(first.source, "rules");
    assert.ok(Object.keys(first.filters).length > 0, "the plain answer is a real answer");
    assert.equal(calls, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /401.*refused/, "the log says why, for whoever runs the server");
    assert.equal((await ai.parseQuery("orthodox cruiserweights", w, "u2")).source, "rules");
    assert.equal(calls, 1, "no second call during the pause: no waiting, no hammering");
    assert.equal(warnings.length, 1, "one log line per cause, not one per visitor");
    // the key is fixed (or the outage ends) and the pause is over: the same search, which was not cached, now reaches the model
    guard.resetAiPause();
    mockModel();
    assert.equal((await ai.parseQuery("southpaw bantamweights", w, "u1")).source, "ai", "the failed answer was not remembered for the day");
  } finally { console.warn = realWarn; }
});

test("scouting reports and previews: the same, with the cache bounded and refusals not remembered", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key"; process.env.AI_DAILY_BUDGET = "0";
  mockModel(() => "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
  const b = w.boxers.find((x) => x.bouts > 5)!, bout = w.bouts.find((x) => x.upcoming && x.status !== "cancelled")!;
  const { tEn } = await import("../lib/i18n/t");
  assert.equal((await ai.scoutingReport(b, w, tEn, "c")).source, "rules");
  assert.equal((await preview.previewArticle(w, bout, tEn, "c")).source, "rules");
  assert.equal(sent.length, 0, "a spent budget means no model call at all");
  process.env.AI_DAILY_BUDGET = "1000";
  assert.equal((await ai.scoutingReport(b, w, tEn, "c")).source, "ai", "once there is budget the model answers: the earlier refusal was not cached");
  assert.equal((await preview.previewArticle(w, bout, tEn, "c")).source, "ai");
  const n = sent.length;
  await ai.scoutingReport(b, w, tEn, "c"); await preview.previewArticle(w, bout, tEn, "c");
  assert.equal(sent.length, n, "and now they are cached");
});

test("the API routes identify the caller from the request headers", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key"; process.env.AI_CLIENT_LIMIT = "1";
  mockModel(() => "A scouting report.");
  const scout = await import("../app/api/scout/[slug]/route");
  const [, x, y] = w.boxers.filter((b) => b.bouts > 5); // not the first one: the previous test already cached its report
  const call = (slug: string, ip: string) => scout.GET(new Request(`http://x/api/scout/${slug}`, { headers: { "x-forwarded-for": ip } }), { params: Promise.resolve({ slug }) }).then((r) => r.json());
  assert.equal((await call(x.slug, "198.51.100.1")).source, "ai");
  assert.equal((await call(y.slug, "198.51.100.1")).source, "rules", "same address, over its limit");
  assert.equal((await call(y.slug, "198.51.100.2")).source, "ai", "a different address is not");
});
