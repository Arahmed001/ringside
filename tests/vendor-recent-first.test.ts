import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { boxingDataApiProvider } from "../lib/providers/boxing-data-api";
import { describePlan } from "../lib/vendor-backfill";
import { makeWorld, mockVendor, serveMockVendor } from "../lib/vendor-mock";

/**
 * Three days of requests at the plan's hourly limit is a long wait for a first look, so a first load can be the N most recently active fighters (coming fights
 * counting), with only the fights between two of them. These tests use the stand-in vendor: which fighters are fetched, in what order, what is left out and
 * how it is counted, that a later run costs only the rest, and the real command end to end.
 */
const KEY = "sk-recent-first-key-0123456789abcdef012345678901";
const world = makeWorld({ fighters: 80, fights: 160, upcoming: 4, seed: 11 });
const latest = (id: string) => world.fights.filter((f) => f.a === id || f.b === id).map((f) => f.date).sort().pop() ?? "";
const everyone = [...new Set(world.fights.flatMap((f) => [f.a, f.b]))];

const make = (extra: Record<string, unknown> = {}) => {
  const v = mockVendor(world);
  const logs: string[] = [];
  const p = boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: v.fetchImpl, scheduleDays: 0, maxRequests: 100_000, retries: 0, gapMs: 0, log: (m) => logs.push(m), sleep: async () => {}, ...extra });
  return { v, p, logs };
};
const load = async (p: ReturnType<typeof make>["p"]) => ({ boxers: await p.fetchBoxers(), events: await p.fetchEvents(), bouts: await p.fetchBouts() });

test("--fighters N fetches the N most recently active fighters, newest first, and loads only the fights between two of them", async () => {
  const r = make({ maxFighters: 20 });
  const out = await load(r.p);
  assert.equal(r.v.stats.fighterOrder.length, 20, "twenty fighters were asked for, not eighty");
  const chosen = new Set(r.v.stats.fighterOrder);
  for (const id of everyone) if (!chosen.has(id)) for (const c of chosen) assert.ok(latest(c) >= latest(id), `${c} (${latest(c)}) was taken, ${id} (${latest(id)}) was not`);
  const asked = r.v.stats.fighterOrder.map(latest);
  assert.deepEqual(asked, [...asked].sort().reverse(), "and they were asked for newest first, so a run that stops has the most recent ones");
  assert.equal(out.boxers.length, 20);
  const ids = new Set(out.boxers.map((b) => b.externalId));
  assert.ok(out.bouts.length > 0 && out.bouts.every((b) => ids.has(b.redExternalId) && ids.has(b.blueExternalId)), "every fight loaded is between two chosen fighters");
  const n = r.p.notes();
  assert.ok(n.boutsOutsideSelection > 0, "the fights against fighters not chosen are counted as left for a later run");
  assert.equal(n.boutsDroppedUnknownFighter, 0, "and they are not counted as a fetch that failed (that would stop the command)");
  assert.equal(out.bouts.length + n.boutsOutsideSelection, world.fights.length, "every fight is either loaded or counted");
  assert.ok(r.logs.some((l) => /taking the 20 most recently active of \d+ fighters/.test(l)));
});

test("a later run with a bigger number only fetches the rest: the first fighters are in the cache, in the same order", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bda-recent-"));
  try {
    const first = make({ maxFighters: 20, purpose: "ingest", cacheDir: dir });
    await load(first.p);
    const second = make({ maxFighters: 50, purpose: "ingest", cacheDir: dir });
    const out = await load(second.p);
    assert.equal(second.v.stats.byPath["/v2/fighters/*"], 30, "30 new fighters fetched, the first 20 came from the cache");
    assert.equal(out.boxers.length, 50);
    assert.deepEqual(second.v.stats.fighterOrder.slice(0, 1).map(latest)[0] <= latest(first.v.stats.fighterOrder[19]), true, "the new ones are older than the first twenty");
    const all = make({ purpose: "ingest", cacheDir: dir });
    const full = await load(all.p);
    assert.equal(all.v.stats.byPath["/v2/fighters/*"], everyone.length - 50);
    assert.equal(full.bouts.length, world.fights.length, "with no limit every fight is loaded");
    assert.equal(all.p.notes().boutsOutsideSelection, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("--plan with a limit prices the chosen fighters only, and shows what each size would give, from the fight list alone", async () => {
  const r = make({ maxFighters: 20 });
  const plan = await r.p.plan();
  assert.equal(plan.fighters, 20); assert.equal(plan.allFighters, everyone.length); assert.equal(plan.fighterRequests, 20);
  assert.equal(r.v.stats.fighterOrder.length, 0, "nothing was fetched to find out");
  assert.ok(plan.selection && plan.selection.length >= 1 && plan.selection.at(-1)!.fighters === everyone.length);
  const all = plan.selection!.at(-1)!;
  assert.deepEqual([all.fights, all.share, all.closed], [world.fights.length, 1, everyone.length], "all of the league is whole and closed");
  const text = describePlan({ ...plan, selection: [{ fighters: 1000, fights: 900, whole: 400, share: 0.4, closed: 120 }, { fighters: 35000, fights: 44000, whole: 35000, share: 1, closed: 35000 }] }, { gapMs: 0, perHour: 450 }).join("\n");
  assert.match(text, new RegExp(`fighters 20 chosen of ${everyone.length} \\(the most recently active first\\)`));
  assert.match(text, /1000 fighters:\s+900 fights;\s+40% of the fighters have every fight in the list loaded;\s+120 sit in groups chosen whole; about 2\.2 hours/);
  assert.match(text, /35000 fighters:.*77\.8 hours/);
  assert.doesNotMatch(describePlan({ ...plan, selection: undefined, allFighters: undefined }, { gapMs: 0 }).join("\n"), /most recently active/, "a plan with no choice says nothing about it");
});

// ---- the real command ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bda-recent-cli-"));
process.env.RINGSIDE_LOCK_DIR = path.join(root, "locks");
function run(url: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/vendor-backfill.ts", "--gap-ms", "0", ...args], {
      env: { ...process.env, BOXING_API_KEY: KEY, BOXING_API_URL: url, RINGSIDE_NOW: world.today, BOXING_API_STORAGE_CONFIRMED: "1", BOXING_PROVIDER: undefined, ...env }, cwd: process.cwd(),
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

test("the command: --fighters says what it took and what is short; a partial load is refused until allowed; the flags are checked", async () => {
  const vendor = await serveMockVendor(world, { key: KEY });
  const cache = path.join(root, "cache"), db = path.join(root, "partial.db");
  try {
    const plan = await run(vendor.url, ["--plan", "--fighters", "20", "--per-hour", "450"], { DATABASE_PATH: db });
    assert.equal(plan.code, 0, plan.out);
    assert.match(plan.out, new RegExp(`fighters 20 chosen of ${everyone.length}`)); assert.match(plan.out, /sit in groups chosen whole/); assert.match(plan.out, /fighters still to fetch: 20 request\(s\)/);
    const check = await run(vendor.url, ["--check", "--fighters", "20", "--cache-dir", cache], { DATABASE_PATH: db });
    assert.match(check.out, new RegExp(`taking the 20 most recently active of ${everyone.length} fighters`));
    assert.match(check.out, /boutsOutsideSelection\s+\d+/);
    assert.match(check.out, /selection: the 20 most recently active fighters/);
    assert.match(check.out, /records: \d+ of 20 fighters/);
    assert.doesNotMatch(check.out, /left out because a fighter could not be fetched/);
    assert.equal(vendor.stats.fighterOrder.length, 20);
    const refused = await run(vendor.url, ["--fighters", "20", "--cache-dir", cache], { DATABASE_PATH: db });
    assert.equal(refused.code, 1, refused.out);
    assert.match(refused.out, /Nothing was loaded, because only \d+\.\d% of fighters/);
    assert.ok(!fs.existsSync(db) || new DatabaseSync(db).prepare("SELECT COUNT(*) c FROM boxers").get()!.c === 0, "nothing was written");
    for (const bad of [["--fighters", "0"], ["--fighters", "abc"], ["--fighters", "2.5"]]) {
      const r = await run(vendor.url, ["--check", ...bad, "--cache-dir", cache], { DATABASE_PATH: db });
      assert.equal(r.code, 1); assert.match(r.out, /--fighters must be a whole number above 0/);
    }
    const upd = await run(vendor.url, ["--update", "--fighters", "5", "--cache-dir", cache], { DATABASE_PATH: db });
    assert.equal(upd.code, 1); assert.match(upd.out, /for the first load, not for --update/);
  } finally { await vendor.close(); }
});

test("the command: --complete-only loads the fighters whose records add up, and every record in the database equals the vendor's career total", async () => {
  const vendor = await serveMockVendor(world, { key: KEY });
  const cache = path.join(root, "cache2"), dbFile = path.join(root, "core.db");
  try {
    const r = await run(vendor.url, ["--fighters", "60", "--complete-only", "--cache-dir", cache], { DATABASE_PATH: dbFile });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /core \(--complete-only\): (\d+) of 60 fighters/);
    const db = new DatabaseSync(dbFile);
    const people = db.prepare("SELECT id, external_id FROM boxers").all() as { id: number; external_id: string }[];
    const n = Number(/core \(--complete-only\): (\d+) of/.exec(r.out)![1]);
    assert.equal(people.length, n); assert.ok(n > 0, "the core is not empty in this league");
    const ids = new Set(people.map((p) => p.id));
    const bouts = db.prepare("SELECT red_id, blue_id, winner_id FROM bouts WHERE status IS NOT 'cancelled'").all() as { red_id: number; blue_id: number; winner_id: number | null }[];
    assert.ok(bouts.every((b) => ids.has(b.red_id) && ids.has(b.blue_id)), "no fight against someone who is not loaded");
    for (const p of people) {
      const key = p.external_id.replace("bda-f-", "");
      const v = world.careers.get(key) ?? { wins: 0, losses: 0, draws: 0 };
      const wins = bouts.filter((b) => b.winner_id === p.id).length;
      const losses = bouts.filter((b) => b.winner_id !== null && b.winner_id !== p.id && (b.red_id === p.id || b.blue_id === p.id)).length;
      assert.deepEqual([wins, losses], [v.wins, v.losses], `${key}: the record in the database is the vendor's`);
    }
    // an empty core is an error, not an empty league
    const none = await run(vendor.url, ["--fighters", "1", "--complete-only", "--cache-dir", path.join(root, "cache3"), "--into-existing"], { DATABASE_PATH: path.join(root, "none.db") });
    assert.equal(none.code, 1); assert.match(none.out, /--complete-only: not one fighter/);
  } finally { await vendor.close(); }
});
