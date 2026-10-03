import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boxingDataApiProvider } from "../lib/providers/boxing-data-api";
import { describePlan } from "../lib/vendor-backfill";
import { makeWorld, mockVendor, type MockOptions } from "../lib/vendor-mock";

/**
 * The first real `--check` stopped after 11 seconds: the gateway answered 429 "You have exceeded the rate limit per hour for your plan, MEGA, by the API
 * provider", with no Retry-After, and the adapter gave up after four short retries. A 35,000-request job on a plan with an hourly limit has to pace itself
 * and wait the limit out, but must stop at once when the refusal is a used-up quota (waiting an hour fixes nothing). Time is a fake clock here: a wait just moves it.
 */
const KEY = "sk-ratelimit-test-key-0123456789abcdef0123456789";
const HOUR = 3_600_000;
const TOP_OF_AN_HOUR = Date.parse("2026-10-03T21:00:00Z");
const world = makeWorld({ fighters: 40, fights: 120, upcoming: 0, seed: 5 });

function rig(o: MockOptions, extra: Record<string, unknown> = {}) {
  let now = TOP_OF_AN_HOUR;
  const waits: number[] = [];
  const logs: string[] = [];
  const v = mockVendor(world, { ...o, now: () => now });
  const make = (more: Record<string, unknown> = {}) => boxingDataApiProvider({
    key: KEY, purpose: "evaluation", fetchImpl: v.fetchImpl, scheduleDays: 0, maxRequests: 100_000, retries: 0, gapMs: 0, log: (m) => logs.push(m),
    sleep: async (ms) => { waits.push(ms); now += ms; }, ...extra, ...more,
  });
  return { v, make, waits, logs, clock: () => now };
}
const loadAll = async (p: ReturnType<ReturnType<typeof rig>["make"]>) => { const [boxers, events, bouts] = await Promise.all([p.fetchBoxers(), p.fetchEvents(), p.fetchBouts()]); return { boxers, events, bouts }; };
const unlimited = async () => { const r = rig({}); const out = await loadAll(r.make()); return { out, requests: r.v.stats.requests }; };

test("an hourly limit with no patience stops the run, and the message is the vendor's own words and says what to do, not 'retry after unknown s'", async () => {
  const r = rig({ hourlyLimit: 5 });
  await assert.rejects(() => loadAll(r.make()), (e: Error) => {
    assert.match(e.message, /rate limit per hour for your plan, MEGA, by the API provider/);
    assert.match(e.message, /--patience-min/); assert.match(e.message, /--per-hour/);
    return true;
  });
});

test("with patience the run waits the limit out and finishes: every fight and fighter arrives, none twice, and a refusal is not counted as a request the vendor served", async () => {
  const base = await unlimited();
  const r = rig({ hourlyLimit: 25 }, { patienceMs: 6 * HOUR });
  const got = await loadAll(r.make());
  assert.equal(got.bouts.length, base.out.bouts.length); assert.equal(got.boxers.length, base.out.boxers.length);
  assert.deepEqual(got.bouts.map((b) => b.externalId).sort(), base.out.bouts.map((b) => b.externalId).sort());
  assert.ok(r.v.stats.refused > 0, "the limit really was hit");
  assert.equal(r.v.stats.requests, base.requests, "the vendor served exactly as many requests as an unlimited run: nothing was fetched twice");
  assert.ok(r.waits.length > 0 && r.waits.every((w) => w >= 60_000 && w <= 600_000), `waits of one to ten minutes (${r.waits.join(", ")})`);
  assert.ok(r.logs.some((l) => /rate limit .*waiting .* minute\(s\), then carrying on/.test(l)), "it says what it is doing");
  assert.ok(r.logs.some((l) => /rate limit per hour/.test(l)), "and the vendor's words are in it");
});

test("the waits grow: a minute, two, five, then ten at a time", async () => {
  const r = rig({ hourlyLimit: 3 }, { patienceMs: 6 * HOUR });
  await loadAll(r.make());
  const first = r.waits.slice(0, 5);
  assert.deepEqual(first, [60_000, 120_000, 300_000, 600_000, 600_000]);
});

test("a used-up quota is never waited for: the run ends at once, naming the quota and where to look", async () => {
  const r = rig({ monthlyQuota: 8 }, { patienceMs: 6 * HOUR });
  await assert.rejects(() => loadAll(r.make()), (e: Error) => {
    assert.match(e.message, /quota used up/); assert.match(e.message, /MONTHLY quota/); assert.match(e.message, /RapidAPI dashboard/);
    return true;
  });
  assert.deepEqual(r.waits, [], "no wait at all");
});

test("when patience runs out the run stops and says how long it waited; what was fetched is cached, so the next run only does the rest", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bda-rl-"));
  try {
    const base = await unlimited();
    const r1 = rig({ hourlyLimit: 6 }, { patienceMs: 5 * 60_000, cacheDir: dir });
    await assert.rejects(() => loadAll(r1.make()), (e: Error) => {
      assert.match(e.message, /still in force after waiting 3 minute\(s\)/); assert.match(e.message, /everything fetched so far is cached/);
      return true;
    });
    assert.equal(r1.v.stats.requests, 6, "six requests got through before the limit");
    const r2 = rig({}, { cacheDir: dir });
    const done = await loadAll(r2.make());
    assert.equal(done.bouts.length, base.out.bouts.length);
    assert.equal(r2.v.stats.requests, base.requests - 6, "the second run made only the requests the first never completed");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("--per-hour spaces requests evenly under the limit, so the limit is never reached; the same run without it is refused", async () => {
  const base = await unlimited();
  const limit = 20;
  assert.ok(base.requests > limit, `the league needs more requests (${base.requests}) than the limit allows an hour`);
  const paced = rig({ hourlyLimit: limit }, { perHour: limit });
  const got = await loadAll(paced.make());
  assert.equal(got.bouts.length, base.out.bouts.length);
  assert.equal(paced.v.stats.refused, 0, "never refused");
  assert.ok(paced.waits.every((w) => w === HOUR / limit), "every pause is an hour divided by the limit");
  assert.equal(paced.clock() - TOP_OF_AN_HOUR, (base.requests - 1) * (HOUR / limit), "so the run took exactly what the pace says");
  const rushed = rig({ hourlyLimit: limit });
  await assert.rejects(() => loadAll(rushed.make()), /rate limit per hour/);
  const slower = rig({ hourlyLimit: limit }, { perHour: 10, gapMs: 1000 });
  await loadAll(slower.make());
  assert.ok(slower.waits.every((w) => w === HOUR / 10), "the slower of --per-hour and the gap wins");
});

test("--plan says how long a paced run takes, in hours when it is long, and is unchanged without --per-hour", () => {
  const plan = { fights: 44255, events: 11021, fighters: 35222, requestsMade: 496, fightersCached: 0, fighterRequests: 35222 } as Parameters<typeof describePlan>[0];
  const paced = describePlan(plan, { gapMs: 300, perHour: 450 }).join("\n");
  assert.match(paced, /fighters still to fetch: 35222 request\(s\), about 78\.\d hours at 450 requests an hour/);
  assert.match(describePlan(plan, { gapMs: 300, perHour: 100000 }).join("\n"), /about \d+ minute\(s\) at 100000 requests an hour|about \d+(\.\d)? hours at 100000/, "a very high limit still gives an estimate");
  assert.match(describePlan(plan, { gapMs: 300 }).join("\n"), /about 323 minute\(s\) at 300 ms between requests/, "without --per-hour the old wording and number");
});

test("bandwidth is metered by the plan, so the adapter counts what it downloads: every request adds its bytes, and nothing answered from the cache does", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bda-bytes-"));
  try {
    const first = rig({});
    const p1 = first.make({ purpose: "ingest", cacheDir: dir });
    assert.equal(p1.bytes(), 0);
    await loadAll(p1);
    assert.ok(p1.requests() > 0 && p1.bytes() > 1000, `bytes counted (${p1.bytes()})`);
    const onDisk = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".json")).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
    assert.ok(p1.bytes() > onDisk * 0.4 && p1.bytes() < onDisk * 3, `the count (${p1.bytes()}) is the size of what was fetched (${onDisk} on disk, pretty-printed or not)`);
    const second = rig({});
    const p2 = second.make({ purpose: "ingest", cacheDir: dir });
    await loadAll(p2);
    assert.equal(second.v.stats.requests, 0, "a second run is served from the cache");
    assert.equal(p2.bytes(), 0, "cached answers download nothing");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
