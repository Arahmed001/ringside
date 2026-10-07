import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";

/**
 * docs/capacity.md, "A data update while serving": another process's update commits several times (fights, ratings, run record), and each commit moved
 * dbVersion, so the site rebuilt its world twice (4.7 s each at full size) and answered nothing meanwhile. Now: commits that arrive close together cause ONE
 * rebuild, visitors are answered from the previous world until the new one is ready, the page aggregates are warm when it is swapped in, and a rebuild that
 * fails leaves the old world in place.
 */
process.env.RINGSIDE_MEMO_LOG = "1"; // makes the rebuild log its `world_built` line, which is what these tests count
process.env.RINGSIDE_WORLD_SETTLE_MS = "400";
const cleanup = tempDb("capacity-update");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let W: typeof import("../lib/world");
let M: typeof import("../lib/memo");
before(async () => { W = await import("../lib/world"); M = await import("../lib/memo"); await W.getWorld(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** another process, as the nightly update is: its own connection to the same file, one commit per step */
const otherProcess = () => new DatabaseSync(process.env.DATABASE_PATH!);

function capture() {
  const lines: { out: "log" | "error"; text: string }[] = [];
  const log = console.log, error = console.error;
  console.log = (...a: unknown[]) => { lines.push({ out: "log", text: a.map(String).join(" ") }); };
  console.error = (...a: unknown[]) => { lines.push({ out: "error", text: a.map(String).join(" ") }); };
  return { lines, stop: () => { console.log = log; console.error = error; }, built: () => lines.filter((l) => l.text.includes('"event":"world_built"')).length };
}

async function until(cond: () => boolean, ms = 15_000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await sleep(20); }
}

test("three commits in quick succession cause one rebuild, and nobody is answered with an empty or blocked world", async () => {
  const cap = capture();
  try {
    const current = await W.getWorld();
    const firstRating = current.boxers[0].rating, id = current.boxers[0].id;
    const seen = new Set<World>();
    let worst = 0, calls = 0, bad = 0, running = true;
    // visitors, all the while: every one must be answered at once with a whole world
    const visitors = (async () => {
      while (running) {
        const t0 = performance.now();
        const w = await W.getWorld();
        worst = Math.max(worst, performance.now() - t0); calls++;
        if (!w || w.boxers.length === 0 || w.bouts.length === 0) bad++;
        seen.add(w);
        await sleep(5);
      }
    })();
    const db = otherProcess();
    // the update's three commits: its data, its recomputed ratings, its run record
    db.prepare("UPDATE boxers SET rating = rating + 25 WHERE id = ?").run(id);
    await sleep(80);
    db.exec("UPDATE boxers SET nickname = nickname WHERE id = 1");
    await sleep(80);
    db.prepare("INSERT INTO ingest_runs (at, provider, errors, warnings, infos, counts, dropped) VALUES ('2026-10-03', 'test', 0, 0, 0, '{}', '{}')").run();
    db.close();
    // straight after the last commit the previous world is still the one shown
    assert.equal(await W.getWorld(), current, "the previous world keeps being served while the commits settle");
    await until(() => seen.size >= 2);
    running = false; await visitors;
    assert.equal(cap.built(), 1, "one rebuild for three commits");
    assert.equal(bad, 0, "no visitor saw an empty world");
    assert.ok(calls > 20, `visitors were being answered throughout (${calls} calls)`);
    assert.ok(worst < 400, `no call waited behind a rebuild (slowest ${Math.round(worst)} ms)`);
    const now = await W.getWorld();
    assert.notEqual(now, current);
    assert.equal(now.byId.get(id)!.rating, firstRating + 25, "the new world has the update");
  } finally { cap.stop(); }
});

test("the page aggregates are warm on the new world before it is shown", async () => {
  const cap = capture();
  try {
    const before = await W.getWorld();
    const db = otherProcess();
    db.prepare("INSERT INTO ingest_runs (at, provider, errors, warnings, infos, counts, dropped) VALUES ('2026-10-03', 'test', 0, 0, 0, '{}', '{}')").run();
    db.close();
    await W.getWorld(); // notices; starts the settle timer
    assert.equal(M.memoKeys(before).length > 10, true, "the first test's rebuild was warm too");
    let now = before;
    await until(() => { void W.getWorld().then((x) => { now = x; }); return now !== before; });
    // by the time anyone is given it, the aggregates a first visitor would have computed are there
    assert.ok(M.memoKeys(now).length > 10, `the new world arrives warm (${M.memoKeys(now).length} aggregates)`);
  } finally { cap.stop(); }
});

test("a rebuild that fails keeps the old world serving, logs once, and recovers when the data is right", async () => {
  const cap = capture();
  try {
    const ok = await W.getWorld();
    const db = otherProcess();
    db.exec("ALTER TABLE honours RENAME TO honours_off"); // the build reads it, so it cannot succeed now
    await W.getWorld();
    await until(() => cap.lines.some((l) => l.out === "error" && l.text.includes("world rebuild failed")));
    for (let i = 0; i < 20; i++) assert.equal(await W.getWorld(), ok, "still the old world, every time");
    await sleep(700);
    const failures = cap.lines.filter((l) => l.text.includes("world rebuild failed"));
    assert.equal(failures.length, 1, "logged once, however many requests came");
    // the data is repaired: a new version, so the next settle builds it
    db.exec("ALTER TABLE honours_off RENAME TO honours");
    db.close();
    let now = ok;
    await until(() => { void W.getWorld().then((x) => { now = x; }); return now !== ok; });
    assert.ok(now.boxers.length > 0);
  } finally { cap.stop(); }
});

test("our own writes and invalidateWorld still rebuild at once (nothing stale to show)", async () => {
  const { bumpDbVersion } = await import("../lib/db");
  const a = await W.getWorld();
  bumpDbVersion();
  const b = await W.getWorld();
  assert.notEqual(a, b);
  W.invalidateWorld();
  const c = await W.getWorld();
  assert.notEqual(b, c);
  assert.equal(await W.getWorld(), c);
});

test("callers that arrive while the first world is being built share the one build", async () => {
  W.invalidateWorld();
  const cap = capture();
  try {
    const all = await Promise.all(Array.from({ length: 8 }, () => W.getWorld()));
    assert.ok(all.every((x) => x === all[0]));
    assert.equal(cap.built(), 1);
  } finally { cap.stop(); }
});
