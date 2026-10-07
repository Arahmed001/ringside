import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";

/**
 * docs/capacity.md, "Midnight": a new calendar day used to rebuild the world at once with every visitor waiting for it (4.7 s at 160,000 fights). Now the world of the
 * day before keeps answering while the new one is built beside it in slices, warmed, and then swapped in. The clock is injected (RINGSIDE_NOW and the scheduler's
 * own clock and timer): nothing here waits for a real midnight.
 */
process.env.RINGSIDE_MEMO_LOG = "1"; // makes the rebuild log its `world_built` / `world_swapped` lines, which these tests count
const cleanup = tempDb("midnight", "2026-10-03T23:59:00Z");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let W: typeof import("../lib/world");
let M: typeof import("../lib/memo");
let Warm: typeof import("../lib/warm");
before(async () => {
  W = await import("../lib/world"); M = await import("../lib/memo"); Warm = await import("../lib/warm");
  W.setDayRollover("background"); // a pinned clock means "block" by default (other tests move the date by hand); this file tests the real behaviour
  await W.getWorld();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 15_000) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await sleep(20); } }
function capture() {
  const lines: { out: "log" | "error"; text: string }[] = [];
  const log = console.log, error = console.error;
  console.log = (...a: unknown[]) => { lines.push({ out: "log", text: a.map(String).join(" ") }); };
  console.error = (...a: unknown[]) => { lines.push({ out: "error", text: a.map(String).join(" ") }); };
  return { lines, stop: () => { console.log = log; console.error = error; }, count: (ev: string) => lines.filter((l) => l.text.includes(`"event":"${ev}"`)).length };
}

test("past midnight, visitors keep getting yesterday's whole world until the new day's is built and warm, then get it", async () => {
  const cap = capture();
  try {
    const yesterday = await W.getWorld();
    assert.equal(yesterday.today, "2026-10-03");
    process.env.RINGSIDE_NOW = "2026-10-04T00:00:05Z"; // the clock passes midnight
    const seen = new Set<World>();
    let worst = 0, calls = 0, bad = 0, running = true;
    const visitors = (async () => {
      while (running) {
        const t0 = performance.now();
        const x = await W.getWorld();
        worst = Math.max(worst, performance.now() - t0); calls++;
        if (!x || x.boxers.length === 0 || x.bouts.length === 0) bad++;
        seen.add(x);
        await sleep(5);
      }
    })();
    assert.equal(await W.getWorld(), yesterday, "the first request after midnight is answered from the old world, at once");
    await until(() => seen.size >= 2);
    running = false; await visitors;
    assert.equal(bad, 0, "nobody saw an empty world");
    assert.ok(calls > 10, `visitors were answered throughout (${calls} calls)`);
    assert.ok(worst < 400, `no visitor waited behind the rebuild (slowest ${Math.round(worst)} ms)`);
    assert.equal(cap.count("world_built"), 1, "one rebuild for the new day, however many requests came");
    assert.equal(cap.count("world_swapped"), 1);
    const today = await W.getWorld();
    assert.notEqual(today, yesterday);
    assert.equal(today.today, "2026-10-04", "the new world is the new day's");
    assert.ok(M.memoKeys(today).length > 10, `it arrives warm (${M.memoKeys(today).length} aggregates)`);
  } finally { cap.stop(); }
});

test("a day change with our own write pending, or invalidateWorld, still builds at once (nothing right to show)", async () => {
  process.env.RINGSIDE_NOW = "2026-10-04T12:00:00Z";
  const a = await W.getWorld();
  W.invalidateWorld();
  process.env.RINGSIDE_NOW = "2026-10-05T00:00:01Z";
  const b = await W.getWorld(); // no world to keep serving: it waits for the build, as it must
  assert.notEqual(a, b);
  assert.equal(b.today, "2026-10-05");
});

test("the scheduler runs on an injected clock: it asks for the world at just after midnight, waits for the rebuild, and sets the next one", async () => {
  const cap = capture();
  try {
    process.env.RINGSIDE_NOW = "2026-10-05T23:59:30Z";
    const before = await W.getWorld();
    let clock = Date.parse("2026-10-05T23:59:30Z");
    const timers: { fn: () => void; ms: number }[] = [];
    const logged: string[] = [];
    Warm.scheduleDailyWarm((m) => logged.push(m), { now: () => clock, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 30_000 + 5_000, "thirty seconds to midnight plus the slack");
    clock = Date.parse("2026-10-06T00:00:05Z"); process.env.RINGSIDE_NOW = "2026-10-06T00:00:05Z"; // the timer fires
    timers[0].fn();
    assert.equal(await W.getWorld(), before, "while the tick's rebuild runs, visitors are still answered");
    await until(() => timers.length === 2);
    assert.equal(timers[1].ms, 86_400_000 - 5_000 + 5_000, "the next tick is a day (less the five seconds already gone) away");
    const now = await W.getWorld();
    assert.equal(now.today, "2026-10-06");
    assert.ok(logged.some((l) => l.includes("new day: world rebuilt")), logged.join("\n"));
    assert.equal(cap.count("world_built"), 1);
  } finally { cap.stop(); }
});

test("a rebuild that fails at midnight leaves yesterday's world serving and is logged once", async () => {
  const cap = capture();
  const other = new DatabaseSync(process.env.DATABASE_PATH!);
  try {
    process.env.RINGSIDE_NOW = "2026-10-06T12:00:00Z";
    const ok = await W.getWorld();
    other.exec("ALTER TABLE honours RENAME TO honours_off");
    process.env.RINGSIDE_NOW = "2026-10-07T00:00:05Z";
    assert.equal(await W.getWorld(), ok);
    await until(() => cap.lines.some((l) => l.out === "error" && l.text.includes("world rebuild failed")));
    for (let i = 0; i < 20; i++) assert.equal(await W.getWorld(), ok, "still the old world, every time");
    assert.equal(cap.lines.filter((l) => l.text.includes("world rebuild failed")).length, 1, "logged once, however many requests came");
  } finally {
    other.exec("ALTER TABLE honours_off RENAME TO honours"); other.close(); cap.stop();
  }
});
